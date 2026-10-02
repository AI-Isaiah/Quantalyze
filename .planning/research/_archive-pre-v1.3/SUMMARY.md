# Research Summary — v1.2.2 scenario-tab-factsheet-parity

**Project:** Quantalyze
**Domain:** Client-side factsheet parity for a hypothetical scenario blend
**Researched:** 2026-06-25
**Confidence:** HIGH (all four research files grounded in direct codebase reads; domain conventions verified against institutional sources)

---

## Executive Summary

The v1.2.2 milestone collapses to a single high-leverage move: extend one adapter file (`buildScenarioFactsheetPayload`) from minimal to complete, then mount the already-exported `FactsheetBody` under the existing `persist={false}` provider. Every metric the factsheet displays — skew, kurtosis, VaR/CVaR, profit factor, win rate, MTD/YTD/3M/6M/1Y, Calmar-by-year, bootstrap CIs, style drift, monthly/daily heatmaps, EoY table, quantiles, streaks, stress windows — is already computed by the pure-TS `src/lib/factsheet/compute.ts` family from a bare `number[]` of daily returns. The production strategy factsheet renders through this exact path, NOT through Python `compute_all_metrics`. Feeding the blend's `portfolio_daily_returns` (already emitted by the frozen engine) into the same assembler is parity-by-construction. Zero new dependencies, zero new math.

The genuinely new content is exactly two things: (1) mounting the complete `FactsheetBody` in the composer, shaped by a complete synthesized payload, and (2) one new constituent-correlation panel — for which the matrix math already exists in the frozen engine's `correlation_matrix` output and a prior-art renderer (`CorrelationMatrix.tsx`) already ships in the repo. The user's override of the no-peer-rank-a-hypothetical invariant creates a structural decision: the `FactsheetCsvPayload` discriminated union must be extended additively (new optional `scenarioPeer` field + `scenarioMode` flag) to expose peer-percentile without flipping the entire `ingestSource` discriminant — which would silently unlock three unauthorized synthetic panels (demo allocator portfolios, strategy event-signatures, benchmark event-signatures).

The two load-bearing correctness risks are: (a) the population-vs-sample stdev split between `compute.ts` (population, factsheet convention) and `scenario-blend-panels.ts` (sample, engine convention), which must be resolved in Phase 1 with a golden-parity fixture; and (b) the `ingestSource`/`api`-arm blast radius on the peer override, which requires an explicit ADR before any code touches `FactsheetCsvPayload`. Both are solvable; neither is novel; both have clear mitigation paths from research.

---

## Key Findings

### Recommended Stack

**No new dependencies.** The codebase already contains a complete, tested TypeScript port of every factsheet metric. Any phase proposal that includes a new npm stats package (`jstat`, `simple-statistics`, `mathjs`, etc.) is a red flag: those primitives are already hand-rolled, tested, and convention-locked in-repo.

**Core technologies (all existing — reuse, do not add):**

- `src/lib/factsheet/compute.ts` `compute(rets, dates)` — produces the entire `ComputeResult` scalar set from bare daily returns. This IS the parity reference; the production factsheet renders through it.
- `src/lib/factsheet/build-payload.ts` `buildFactsheetPayload(...)` — the model "complete" payload assembly. The scenario adapter's job is to call the same helpers it calls.
- Supporting pure helpers: `bootstrap.ts` (stationary block bootstrap), `style-drift.ts` (hand-rolled two-sample KS), `calmar-by-year.ts`, `streak.ts`, `period-buckets.ts`, `rolling.ts`, `stress-windows.ts`, `comparator-block.ts` — each maps to a payload field the adapter currently zeroes.
- `src/lib/scenario.ts` (FROZEN) — already emits `portfolio_daily_returns` + `correlation_matrix`. These are the two input sources; never edit this file.
- `widgets/risk/CorrelationMatrix.tsx` — existing renderer for the new constituent panel.
- `src/lib/factsheet/peer-cohort.ts` `computePeerPercentile(sharpe, sortino, max_dd)` — existing helper for the peer override; 20-peer seed-42 synthesized demo cohort.

**Critical convention requirement:** match `compute.ts`'s **population stdev + 252-basis vol + 365.25-basis CAGR**, NOT Python `metrics.py`. The TS factsheet never reads Python scalars; matching Python would break parity with every real strategy factsheet.

### Expected Features

**Must have (table stakes — all populate-existing-panel work via the adapter):**
- Full KPI strip (CAGR, ann-vol, Sharpe, Sortino, Calmar, max-DD, cum-ret) — one `compute()` call
- Distribution / tail moments (skew, kurtosis, VaR95, CVaR95, best/worst period buckets) — one `compute()` call
- Period returns (MTD, YTD, 3M, 6M, 1Y) — one `compute()` call
- Calmar-by-year, monthly/daily heatmaps, EoY table — `period-buckets.ts` + `calmar-by-year.ts`
- Bootstrap CIs on Sharpe/Sortino/max-DD — `bootstrap.ts` (reuse v1.1 Web Worker path)
- Constituent correlation matrix + "too similar" flag (>0.85 threshold) + DR + ENB — engine `correlation_matrix` + `CorrelationMatrix.tsx`
- Per-constituent mandate chips (OMIT aggregate mandate panel — a blend has no single mandate)
- Honest peer-percentile with on-panel "hypothetical blend · demo cohort" disclosure + sample-floor gate — user override 2026-06-25
- Fold on/off/add-strategy compose toggles into the factsheet-shaped layout

**Should have (P2 — add after validation):**
- Percent-contribution-to-risk per constituent (PCRᵢ = wᵢ·(Σw)ᵢ / (wᵀΣw)) — cheap once Σ built
- Hierarchical-cluster reorder of constituent matrix
- Own-book head-to-head delta alongside the percentile

**Defer to v1.x / v2+:**
- Crisis-window sub-correlation, style-drift on blend, full dendrogram, scenario factsheet export

**Anti-features (never implement):**
- Aggregate trade-level win-rate / profit-factor on the blend (no trades; relabel or omit)
- Aggregate mandate/thesis panel (no single mandate; chips only)
- Peer-percentile via `ingestSource: "api"` flip (blast radius: 3 unauthorized synthetic panels)
- Tiny-N peer-percentile without sample-floor suppression

### Architecture Approach

The entire heavy lift is the adapter. `FactsheetBody` (already exported from `FactsheetView.tsx:156`) mounts under the existing `<FactsheetProvider persist={false}>`. All display-field work reuses pure functions that `buildFactsheetPayload` already composes, fed `blendRet/dates` instead of a strategy series. The constituent-correlation panel is **composer-owned** (outside the factsheet tree), avoiding any factsheet-file fork. Factsheet files stay **byte-identical** — all new behavior enters as optional props defaulting to current behavior (`scenarioMode?: boolean`, default `false`) or optional payload fields (`scenarioPeer?`, absent on real CSV payloads).

**Major components:**

1. `buildScenarioFactsheetPayload` (extend minimal→complete) — the one adapter; calls the same pure helpers `buildFactsheetPayload` calls, fed engine's `portfolio_daily_returns`; forces `ingestSource: "csv"` so api-only panels stay absent by construction; adds optional `scenarioPeer` for the peer override.
2. `FactsheetBody` + `FactsheetProvider persist={false}` — the real factsheet component; additive `scenarioMode` flag (default `false`, real-route unchanged).
3. Constituent-correlation panel — composer-owned; reads `scenarioMetrics.correlation_matrix` (already mounted at `ScenarioComposer.tsx:2352`); reposition/restyle into factsheet-shaped layout.
4. `MetricsColumn` — one additive gate: render `PeerPercentilePanel` when `ingestSource === "api"` OR `(scenarioMode && scenarioPeer != null)`.

**Key data flow:**
```
portfolio_daily_returns → compute() → strategyMetrics → KpiStrip + MetricsColumn
correlation_matrix (engine, frozen) → <CorrelationHeatmap> (constituent panel, composer-owned)
compute() ratios → computePeerPercentile() → scenarioPeer → gated PeerPercentilePanel
```

### Critical Pitfalls

1. **Population-vs-sample stdev drift** — `compute.ts` uses population stdev (÷n) for factsheet metrics; `scenario-blend-panels.ts` uses sample stdev (÷n−1) for blend graphs. Both coexist in production today. Mitigation: commit to `compute.ts` (population) for `strategyMetrics` / MetricsColumn / KpiStrip; keep sample-std helpers for blend-graph rolling panels; add a golden-parity fixture in Phase 1.

2. **`ingestSource`/`api`-arm blast radius** — flipping `ingestSource: "csv"` → `"api"` to unlock peer silently enables three other synthetic panels across six+ files. `scenario-factsheet-payload.test.ts:124` encodes the current invariant. Mitigation: extend `FactsheetCsvPayload` additively with `scenarioPeer?` + OR-branch in `MetricsColumn`. Never flip the discriminant. ADR required before Phase 4.

3. **Malformed payload crashing a panel** — completing the payload means every field the adapter currently zeroes must become a real, valid value. `next/dynamic` lazy panels (heatmaps, signatures) only surface at scroll-time. Mitigation: build from `compute()` output (never hand-fill zeros); render-test every panel including lazy ones against healthy / 1-strategy / <N-overlap / non-finite blend shapes.

4. **Doubly-synthetic peer rank** — the existing demo cohort (seed-42, 20 fabricated peers) ranks a hypothetical blend against fabricated peers. Mitigation: expose ONLY with on-panel disclosure ("hypothetical blend · demo cohort"), enforce sample-floor gate (`n < 252` → suppress), and write the cohort definition into REQUIREMENTS.

5. **Constituent correlation on thin overlap** — pairs with <10 overlapping days show noisy ρ. Single-constituent blend has no pairwise correlation. Mitigation: per-cell overlap floor (reuse `MIN_USABLE`) — below floor renders "—"; suppress panel for 0/1-constituent blends with honest empty state. Never touch `scenario.ts`.

6. **Breaking the real factsheet route / Overview** — every change to shared components touches the real route, discovery detail page, and `AllocationDashboardV2`. Mitigation: additive-only props (default preserving current behavior); verify `git diff` touches no `factsheet/[id]/v2/*` file beyond optional props; run `AllocationDashboardV2.staleness.test.tsx` as gate.

---

## Implications for Roadmap

The four researchers converged on the same 5-phase dependency order, driven by one rule: the adapter (Phase 1) is the foundation everything reads from; the full body mount (Phase 2) validates the adapter in the UI; the constituent panel (Phase 3) is already wired (data-only repositioning); the peer override (Phase 4) is the highest-judgment item; polish/guards (Phase 5) close the milestone.

### Phase 1: Complete Payload Adapter

**Rationale:** Everything downstream reads the complete payload. Pure TS, no UI risk, fully unit-testable in isolation. The annualization-convention reconciliation must happen here — it's the one real correctness landmine. The golden-parity test belongs here.

**Delivers:** `buildScenarioFactsheetPayload` extended minimal→complete. Every metric field populated from real `compute()` output. Degenerate-collapse guards extended to the full metric set. Golden-parity fixture (TS `compute()` ≈ existing factsheet on a known blend series). Convention pins documented in comments. `strategyMetrics.n` = true overlapping-observation count (not `dates.length`) so `n < 252` caveats fire honestly.

**Addresses:** Full KPI strip, distribution/tail moments, period returns, Calmar-by-year, monthly/daily heatmaps, EoY, bootstrap CIs, style drift, quantiles, streaks, stress windows, benchmark comparators.

**Avoids:** Pitfalls 1 (stdev drift — convention locked here), 3 (malformed payload — NaN/Inf degenerate-collapse contract extended here).

**Research flag: YES** — annualization-convention reconciliation spike required. Read `compute.ts` vs `scenario-blend-panels.ts` side-by-side; write one parity fixture; lock convention before writing adapter. ~½ day.

### Phase 2: Mount Real FactsheetBody

**Rationale:** With the payload complete, render the REAL `FactsheetBody` under the existing `persist={false}` provider. Add `scenarioMode` (default false) and thread to `MetricsColumn`; suppress Mandate Terms; decide Thesis copy or omit. Byte-identity gate belongs here.

**Delivers:** Full factsheet renders in composer. api-only panels confirmed absent by construction. `scenarioMode?: boolean` additive prop (default `false`, real-route unchanged). Byte-identity oracle: factsheet-route snapshot unchanged with `scenarioMode={false}`. Per-panel RTL render test for healthy / 1-strategy / <N-overlap / non-finite blends (including lazy panels forced into view).

**Avoids:** Pitfalls 2 (shared-component regression), 3 (lazy panel crashes). `AllocationDashboardV2.staleness.test.tsx` green as gate.

**Research flag: NO** — additive props + reuse of established Phase-38 pattern. Standard integration.

### Phase 3: Constituent Correlation Panel

**Rationale:** Data already flows at `ScenarioComposer.tsx:2352`. Work is reposition/restyle into the factsheet-shaped layout + per-cell overlap floor + diversification scorecard (DR + ENB off same Σ). Lowest-risk phase.

**Delivers:** Constituent-correlation panel in factsheet-shaped layout (DESIGN.md palette + editorial section). Per-cell overlap floor ("—" for <MIN_USABLE overlapping days). Single-constituent honest empty state ("Add a second strategy to see diversification"). DR + ENB headline. Correct constituent labels (strategy vs api-key-strategy, de-aliased names). Composer-owned (zero factsheet-file edits). WCAG-audited palette (reuse existing).

**Avoids:** Pitfall 5 (thin-overlap correlation). Anti-pattern: conflating constituent matrix with factsheet's strategy-vs-benchmark `correlationMatrix` field.

**Research flag: NO** — data already wired; renderer prior art in-repo. Standard integration.

### Phase 4: Peer-Cohort Override + Mandate Disposition

**Rationale:** Highest-judgment item. The `ingestSource` discriminant blast radius makes this an ADR before any code changes `FactsheetCsvPayload`. Route through CEO + Design review + fresh-Claude no-invented-data red-team. Cohort-source decision must be in REQUIREMENTS before implementation starts.

**Delivers:** `scenarioPeer?: PeerPercentilePayload` additive field on `FactsheetCsvPayload` (absent on real CSV strategies — real route unchanged). `MetricsColumn` OR-gate. Peer panel with on-panel "hypothetical blend · demo cohort" disclosure. Sample-floor gate (`n < 252` → suppress). Reload-stable rank. Allocator/signatures asserted STILL SUPPRESSED on blend (new test assertion replacing — not deleting — the old invariant tests). Every `ingestSource === "api"` site enumerated. ADR produced.

**Avoids:** Pitfalls 4 (doubly-synthetic rank), 6 (blast radius).

**Research flag: YES** — highest-judgment phase; overrides a locked PROJECT.md invariant. Requires CEO + Design review + no-invented-data red-team. ADR ("peer-percentile carve-out without api-arm flip") is the prerequisite gate. Cohort-source product decision must be in REQUIREMENTS.

### Phase 5: Edge States, Toggle Fold, and Guards

**Rationale:** Closes the milestone. Fold compose toggles into factsheet-shaped layout; wire honest empty states for all degenerate blends; extend WCAG-AA axe gate; add byte-identity regression as permanent CI gate; validate `storageKey` non-collision.

**Delivers:** All degenerate inputs render honest empty states (never fabricated zeros or NaN). Compose toggles integrated. WCAG-AA axe gate extended. Permanent byte-identity regression: `scenarioMode={false}` with real payload → factsheet-route snapshot unchanged. `storageKey` collision verified. Coverage gate still green (lines 82 / fns 74 / branches 72).

**Avoids:** Pitfalls 3 (degenerate blends), 2 (persistence bleed). Regression pins are a permanent milestone artifact.

**Research flag: NO** — standard guard patterns from Phase 38 and v1.1. No research needed.

---

### Phase Ordering Rationale

- Phase 1 before Phase 2: adapter must be complete and tested before the UI renders anything — otherwise malformed zeros fill the UI and it's impossible to distinguish "works" from "renders silent zeros."
- Phase 2 before Phases 3 and 4: the full body mount is the validation harness; new panels bolt onto an already-working factsheet body.
- Phase 3 before Phase 4: the constituent panel is data-only (already wired), cheapest new panel; ship it before the higher-judgment peer override.
- Phase 4 before Phase 5: the peer override's ADR may change payload/type shapes; finalize shapes before writing final regression pins.
- Phase 5 last: guards and regression pins are most meaningful once all panels are in their final form.

### Research Flags

**Needs research / spike during planning:**
- **Phase 1:** Annualization-convention reconciliation spike — ~½ day. Read `compute.ts` vs `scenario-blend-panels.ts` side-by-side; write one golden-parity fixture; lock convention before writing adapter. Highest-value guard in the milestone.
- **Phase 4:** CEO + Design review + no-invented-data red-team required. ADR ("peer-percentile carve-out without api-arm flip") is prerequisite. Cohort-source product decision must be in REQUIREMENTS before code.

**Standard patterns (skip research):**
- **Phase 2:** Established Phase-38 additive-props pattern. No research.
- **Phase 3:** Data already wired; renderer prior art in-repo. No research.
- **Phase 5:** Standard guard/regression pattern from Phase 38 + v1.1. No research.

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All findings from direct codebase reads. Zero new dependencies confirmed by reading `package.json` (no stats library). The "no new math" headline is code-verified, not assumed. |
| Features | HIGH / MEDIUM (two product decisions) | Metric set, constituent-correlation spec, and mandate disposition are HIGH. The peer-cohort option ranking is MEDIUM — the cohort-source choice is a pending product judgment call. |
| Architecture | HIGH | Every integration point read in full. The `FactsheetBody` vs `FactsheetView` mount distinction is code-verified (double-provider risk documented). |
| Pitfalls | HIGH | All six pitfalls grounded in reading the actual files where the bugs would occur. The `ingestSource` blast-radius sites were enumerated by filename. The stdev-convention split was verified by reading both files. |

**Overall confidence: HIGH** — the codebase already contains the solution; the question was "where is it and how do you wire it," not "what should we build." Both open decisions (peer-cohort source, mandate disposition) are product judgment calls with documented options, not research gaps.

### Gaps to Address

- **Peer-cohort source decision (open product call):** demo cohort with disclosure vs platform verified-strategy DB query — must be written into REQUIREMENTS before Phase 4. If the DB path is chosen, a small server fetch is the one place the otherwise-pure-client adapter touches data — scope it explicitly.
- **ADR prerequisite for Phase 4:** the exact mechanism for exposing peer-percentile without flipping the discriminant (new optional `scenarioPeer?` field on the `csv` arm) needs a short ADR before Phase 4.
- **`strategyMetrics.n` real overlap count:** the adapter must set `n` to the true overlapping-observation count (not `dates.length`) so existing `n < 252` caveats fire honestly. Trivial but easy to miss; flagged in the Phase-1 task spec.
- **Bootstrap Web Worker accessibility from composer context:** the v1.1 block-bootstrap already runs in a Web Worker; confirm it's reachable from the composer context before Phase 1 to avoid a main-thread freeze on recompute.

---

## Sources

### Primary (HIGH — direct codebase reads)

- `src/lib/factsheet/compute.ts`, `build-payload.ts`, `bootstrap.ts`, `style-drift.ts`, `calmar-by-year.ts`, `rolling.ts`, `period-buckets.ts`, `streak.ts`, `peer-cohort.ts`, `types.ts` — complete TS factsheet metric port and assembler
- `src/lib/scenario.ts` — frozen engine; confirms `portfolio_daily_returns` + `correlation_matrix` already emitted
- `src/lib/scenario-blend-panels.ts` — v1.2 blend-graph derivations; documents the sample-std convention split
- `src/lib/correlation-math.ts`, `widgets/risk/CorrelationMatrix.tsx` — prior art for the constituent panel
- `src/app/factsheet/[id]/v2/page.tsx` — proves production factsheet renders via TS `buildFactsheetPayload`, NOT Python
- `src/app/(dashboard)/allocations/AllocationDashboardV2.tsx`, `ScenarioFactsheetChart.tsx`, `scenario-factsheet-payload.ts` — render-side mount + minimal adapter to extend
- `src/app/factsheet/[id]/v2/FactsheetView.tsx`, `MetricsColumn.tsx`, `factsheet-context.tsx`, `MandatePanels.tsx`, `BatchDPanels.tsx` — shared component internals; gating mechanisms verified
- `analytics-service/services/metrics.py` — confirms Python upstream-series-producer-only role
- `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx:2352` — existing `<CorrelationHeatmap>` mount confirmed; constituent panel already wired
- `package.json` — no stats library; confirms zero-new-dependency finding
- `.planning/PROJECT.md` — north-star, locked invariants, IMPACT-02 / GRAPH-04 guards, Phase-38 precedent

### Secondary (institutional sources)

- Diversification Ratio (DR = wᵀσ/√(wᵀΣw)); Effective Number of Bets (Meucci 2009); correlation thresholds (>0.85 = "one risk unit"); hierarchical clustering distance ½(1−ρ); risk-budgeting / PCR; peer cohort min-N (20–30 minimum); SEC Marketing Rule hypothetical-performance framing.

---

*Research completed: 2026-06-25*
*Ready for roadmap: yes*
