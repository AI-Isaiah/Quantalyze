# Phase 27: Forward Uncertainty (Monte-Carlo Bands) - Context

**Gathered:** 2026-06-22
**Status:** Ready for planning
**Mode:** Smart discuss (autonomous) — grey-area answers proposed + auto-accepted (no clients yet; decisions taken autonomously per the standing directive). Most areas are pre-locked by the ROADMAP success criteria + the carried v1.1.0 risk gate ("Phase 22's sample-floor gate is the single source of truth reused by 26 + 27 — pin it once") and heavy reuse of the frozen `computeScenario` engine output. Phase 26 (Stress/VaR) is the immediate structural template (pure math lib + props-only presentational section + floor SoT + own-book-composer mount).

<domain>
## Phase Boundary

On the own-book Scenario composer, an allocator sees **forward confidence bands / a return distribution** for the projected blend, produced by a **joint block bootstrap** over the historical daily returns — **no Normal-tail assumption**, honest to sample size, and **floor-gated** below the Phase-22 minimum. The bands answer "where could this blend be in N trading days, given how its returns have actually behaved?" without implying precision the data can't support.

**Method (locked):** a **moving-block / circular block bootstrap of the engine's `portfolio_daily_returns` series** (the full-resolution, UNROUNDED, leverage-and-weight-baked daily-return series `computeScenario` already produces). Resampling contiguous **blocks of whole portfolio days** is the joint resample required by SIM-01: each portfolio day is the *joint* realization of all strategies that day, so contemporaneous cross-strategy correlation is preserved intrinsically (never broken apart), and contiguous blocks preserve short-horizon **autocorrelation**. This is the root-cause-correct, no-drift reading — it reuses the engine's already-correct joint series rather than re-deriving per-strategy weighting/leverage inside a worker (which would be a second, divergent compute path).

Forward paths are built by drawing blocks until the horizon length is reached, compounding each path to cumulative wealth, then taking **empirical quantile bands across paths at each forward step** (and a terminal-return distribution). Band width is honest to N: short histories produce visibly wider bands, with explicit copy. The chart discloses **method, path count, block length, and overlapping-N**. Below the Phase-22 floor (`SAMPLE_FLOOR_OVERLAPPING_DAYS = 60`) the bands are **not rendered** — the shared honest empty state appears instead. The simulation **runs off the main thread** in a Web Worker so a high path count never freezes the composer UI.

In scope: a pure, seedable, deterministic-by-seed Monte-Carlo lib (`scenario-montecarlo.ts`, no DOM / no `Math.random` / no time reads) + a thin Web Worker wrapper that imports it + a presentational `MonteCarloSection` (band chart, disclosure, computing/empty states) mounted in the own-book `ScenarioComposer` + golden/degeneracy/floor tests + a worker-message-contract test.

Out of scope (deferred / other phases): the Weight Optimizer (Phase 28, the lone Python endpoint); parametric/Normal-tail VaR or Monte-Carlo (explicitly forbidden by SIM-01); GARCH / regime-switching / fat-tail parametric models; per-strategy forward simulation (we bootstrap the joint portfolio series, not each strategy independently); sandbox (example-universe) bands; any new migration / Python / dependency / npm install.
</domain>

<decisions>
## Implementation Decisions

### Area 1 — Bootstrap method & shape (SIM-01.1)
- **Moving/circular block bootstrap of `portfolio_daily_returns`** (the engine's leverage+weight-baked joint daily series). NOT per-strategy independent simulation, NOT IID single-day resampling (that destroys autocorrelation), NOT any parametric/Normal draw. Circular wrap on the historical index so every start position is equally likely and blocks near the series end aren't under-sampled.
- **Block length:** auto-derived from sample size (a conservative rule-of-thumb, e.g. `max(2, round(n^(1/3)))` — the standard block-bootstrap heuristic), clamped to `[2, n]`; the resolved block length is **disclosed in the chart** and overridable by the planner. A length of 1 would degrade to IID (kills autocorrelation) — never allow < 2 unless `n` itself forces it.
- **Horizon:** a forward horizon in trading days (default **252 ≈ 1 year**, product-wide annualization convention); planner may expose a small preset control (e.g. 63 / 126 / 252) but a single sensible default is the must.
- **Path count:** **1000 paths** default (enough for stable 5th/95th quantiles, cheap enough for sub-second compute even on-thread; the Worker keeps the UI free regardless). Disclosed in the chart.
- **Output bands:** per-forward-step empirical quantiles — **p5 / p25 / p50(median) / p75 / p95** — in cumulative form aligned to the projection's wealth convention, plus a **terminal return distribution** summary (e.g. median + the 5–95 interval). No mean-path line implying a point forecast; the median band is labeled as a band, not a forecast.

### Area 2 — Honesty: no false precision, honest-to-N width (SIM-01.2 / cross-cutting)
- **No Normal-tail assumption anywhere** — purely empirical resampling; the disclosure says so verbatim ("block bootstrap of realized returns · not a Normal model · not a forecast").
- **Band width must widen with horizon and narrow with more history** as a natural consequence of the resampling (do not artificially cap/clamp the band). Short common history → visibly wider bands → explicit copy noting the wide interval reflects limited history.
- **Disclosure (mandatory, inline):** method ("block bootstrap of realized daily returns"), **path count**, **block length**, and **overlapping-N** (reuse the `methodologyLine(n)` shape / `scenario-history.ts`), ending with the "not a forecast" framing. Reuse the Phase-24/26 methodology-line presentation verbatim.
- **Determinism for tests:** the lib takes an explicit **seed** and uses a small seedable PRNG (e.g. mulberry32) — NOT `Math.random` (un-seedable, and banned in some runtimes). Identical (series, seed, params) → identical bands, so golden-fixture tests are stable and a method change fails CI loudly. The live component may seed from a fixed constant (reproducible bands per identical draft) — bands are an honesty surface, not a slot machine.

### Area 3 — Floor gating & degeneracy (SIM-01.3)
- Gate on the **Phase-22 single source of truth**: `evaluateSampleFloor(n, SAMPLE_FLOOR_OVERLAPPING_DAYS)` where `n` is the historical overlap N (`metrics.n` / the length of `portfolio_daily_returns`). Below floor → `SampleFloorEmptyState` with a Monte-Carlo `feature` label; `no-usable-n` (null/NaN/Inf/negative, or empty `portfolio_daily_returns` from a degenerate engine return) → `noUsableSampleBody`; 0/1-strategy (call-site `strategyCount < 2`) → `fewStrategiesBody`. **Do NOT introduce a second floor primitive** — reuse `evaluateSampleFloor`; guard order is no-usable-n FIRST, then below-floor, then ok (already enforced by the primitive).
- **Degenerate input → honest empty state, never fabricated bands and never a 0.** A constant/`n<10`/non-finite series (engine returns null KPIs + empty `portfolio_daily_returns`) routes to the empty state. Empty-state heading must match its body (the #509 invariant carried from Phase 26).

### Area 4 — Off-main-thread execution (SIM-01.3) & UI placement
- **Web Worker.** This phase introduces the repo's **first** Web Worker (none exist today). Keep ALL math in the pure `scenario-montecarlo.ts` (vitest-testable, no worker/DOM); the worker (`montecarlo.worker.ts`) is a thin message wrapper that imports the pure lib, runs the sim, and posts the bands back. The Next 16 worker instantiation mechanism (`new Worker(new URL("./montecarlo.worker.ts", import.meta.url))` or the framework's documented equivalent) is to be **confirmed against `node_modules/next/dist/docs/` at execute time** (AGENTS.md mandate — this is not the Next you know). Component shows a brief **"computing…" state** while the worker runs, then renders bands; a worker error degrades to an honest "couldn't compute the simulation" empty state (never a fabricated band, never a thrown page). The worker must be torn down / not leak on unmount or rapid re-draft (debounce the recompute).
- Mount a new **"Forward uncertainty" / Monte-Carlo** section in the own-book `ScenarioComposer`, **after the Stress & VaR section** (the established seam — Phase 26 mounted after `ScenarioBenchmarkSection`; 27 mounts after Stress/VaR). Presentational, props-only over the pure lib's typed output where possible; the worker lifecycle is the section's only local concern.
- **Own-book composer ONLY for v1** (consistent with benchmark + stress sections; the example-universe Sandbox deliberately omits these). Sandbox bands deferred.
- Return/percentage form; PROJECTED framing intact; conform to **DESIGN.md** + reuse existing card / empty-state / typography / chart primitives (reuse the `EquityChart`/SVG band-shading approach if it already supports a shaded interval; otherwise a minimal DESIGN.md-conformant band overlay — no new visual language, read DESIGN.md before any visual decision).

### Claude's Discretion
- Exact block-length heuristic + whether to expose a block-length / horizon / path-count control vs fixed defaults; the precise band chart rendering (shaded area vs fan vs distribution histogram for terminal) within DESIGN.md; the exact quantile-interpolation method (be explicit + consistent, mirror the Phase-26 VaR convention); the worker debounce interval; whether to also show a terminal-distribution mini-histogram. All deferred to the planner within the locked invariants above.
</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- **Engine + joint leveraged series:** `src/lib/scenario.ts` `computeScenario` → `ComputedMetrics.portfolio_daily_returns` (full-resolution, UNROUNDED, cumulative-RETURN-per-day form, leverage+weights already baked via `w·L·r`; `[]` on every degenerate early-return; `n<10` → null KPIs). This IS the bootstrap input — do not re-derive weighting/leverage.
- **`DailyPoint`** = `{ date: string; value: number }` (`@/lib/portfolio-math-utils`, re-exported from `@/lib/scenario`). `toWealth()` / `computeStrategyCurve()` for wealth-form conversion (chart needs wealth form starting ~1.0; bands likely rendered in wealth form too).
- **Sample-floor SoT (Phase 22):** `src/lib/sample-floor.ts` (`SAMPLE_FLOOR_OVERLAPPING_DAYS = 60`, `evaluateSampleFloor`, `belowFloorBody`/`noUsableSampleBody`/`fewStrategiesBody`/`sampleFloorBody`) + `src/components/scenarios/SampleFloorEmptyState.tsx` (heading "Not enough history for this estimate"; renders null on `ok`). The doc header of `sample-floor.ts` explicitly names Phase 27 as a consumer.
- **Phase 26 template:** `src/app/(dashboard)/allocations/lib/scenario-stress.ts` (pure wrap-not-fork math lib, null-on-degenerate envelope) + `src/app/(dashboard)/allocations/components/StressVarSection.tsx` (props-only presentational section, 3 honest empty states, methodologyLine, em-dash, mounted in `ScenarioComposer` after `ScenarioBenchmarkSection`) + their `.test.ts(x)` (golden + state-matrix). Mirror these structurally.
- **Disclosure:** `src/lib/scenario-history.ts` `methodologyLine(n)` ("Historical realized · {n} overlapping days · not a forecast.") + `shortestHistoryName`; `formatPercent`/`formatNumber` render "—" for null.
- **Chart:** `src/app/(dashboard)/allocations/widgets/performance/EquityChart` (`"use client"` SVG; exports `toWealth` re-export). Confirm whether it can shade an interval band; if not, a minimal sibling band overlay.

### Established Patterns
- Pure, props-only presentational sections (extract math into a lib; section takes resolved props / runs the worker) — `ScenarioBenchmarkSection` / `StressVarSection` are the templates (honest empty states; methodology line; em-dash on null).
- Reuse the single sample-floor gate; never a second floor primitive.
- Degenerate / constant / below-floor → null/empty state, never a fabricated 0 or band.
- Pure libs: file-level header, never-throws, no DOM/time/`Math.random` — seedable PRNG for any randomness so tests pin determinism (mirror `scenario-share-token.test.ts` known-vector discipline).

### Integration Points
- New pure lib `src/app/(dashboard)/allocations/lib/scenario-montecarlo.ts` (block bootstrap over `portfolio_daily_returns`, seedable, floor-aware, typed band output).
- New `src/app/(dashboard)/allocations/lib/montecarlo.worker.ts` (thin wrapper importing the pure lib; typed request/response message contract).
- New presentational `MonteCarloSection` mounted in `ScenarioComposer` after `StressVarSection`; owns the worker lifecycle (spawn / debounce / teardown / error→empty-state).
- Tests mirror `scenario-stress.test.ts` (golden + degeneracy + leverage), `sample-floor.test.ts`, `StressVarSection.test.tsx` (state matrix), plus a worker message-contract test and a determinism (same-seed) test.
</code_context>

<specifics>
## Specific Ideas
- Bands = p5/p25/p50/p75/p95 across 1000 block-bootstrap paths over `portfolio_daily_returns`, horizon 252d, block length ≈ `max(2, round(n^(1/3)))`, disclosed inline.
- Disclosure: "Block bootstrap of realized daily returns · {paths} paths · block {L}d · {n} overlapping days · not a Normal model · not a forecast."
- Determinism test: same (series, seed, params) → byte-identical bands; a method tweak fails CI.
- Floor: `evaluateSampleFloor(n, 60)`; below → `SampleFloorEmptyState(feature="Monte-Carlo")`; 0/1-strategy → fewStrategiesBody.
- Off-thread: pure lib in `scenario-montecarlo.ts`; `montecarlo.worker.ts` thin wrapper; section shows "computing…", worker error → honest empty state, torn down on unmount.
</specifics>

<deferred>
## Deferred Ideas
- Weight Optimizer (Phase 28).
- Parametric / Normal-tail / GARCH / regime-switching / fat-tail models (forbidden by SIM-01).
- Per-strategy independent forward simulation; sandbox (example-universe) bands.
- A user-tunable block-length / horizon / path-count control if the planner ships fixed defaults; a terminal-distribution histogram if not built.
</deferred>
