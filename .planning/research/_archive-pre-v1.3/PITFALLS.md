# Pitfalls Research

**Domain:** Client-side financial-factsheet parity for a hypothetical portfolio blend — reusing a shared, context-coupled factsheet component (Quantalyze v1.2.2 scenario-tab-factsheet-parity)
**Researched:** 2026-06-25
**Confidence:** HIGH (grounded in the actual codebase: `scenario-factsheet-payload.ts`, `compute.ts`, `scenario-blend-panels.ts`, `metrics.py`, `FactsheetView.tsx`, `build-payload.ts`, `types.ts`, `peer-cohort.ts`, `BatchDPanels.tsx`, `MetricsColumn.tsx`)

This milestone has **two highest-cost pitfalls**, both called out by the downstream consumer:
1. **Client-side metric parity vs the Python 252-basis** (Pitfall 1) — the codebase already has *two coexisting stdev conventions* (`compute.ts` population vs `scenario-blend-panels.ts` sample n−1) and a CAGR-on-365.25 vs vol-on-252 split. Feed the wrong returns to the wrong function and the factsheet silently disagrees with every other surface.
2. **Honesty-invariant reversal blast radius** (Pitfall 6) — flipping the scenario payload from the `csv` arm to the `api` arm does **not** "just turn on peer-percentile." It structurally unlocks **four** synthetic panels (peer cohort, demo allocator portfolios, strategy event-signatures, benchmark event-signatures), all gated on the single `ingestSource === "api"` discriminant across six+ files.

---

## Critical Pitfalls

### Pitfall 1: Client-side metric drift vs the Python `compute_all_metrics` 252-basis

**What goes wrong:**
The blend's metrics (Sharpe / Sortino / Calmar / VaR / CVaR / skew / kurtosis / CAGR / win-rate / profit-factor) are computed client-side in TS and visibly disagree with the same metrics shown for real strategies on `/factsheet/[id]` (which come from Python `quantstats` via `metrics.py`). An allocator sees Sharpe 1.42 on a constituent's own factsheet but the blend math implies a different per-constituent Sharpe, eroding trust in the whole surface.

**Why it happens:**
The codebase has **two different, both-correct, mutually-incompatible numerical conventions already shipped**, and it is dangerously easy to pick the wrong one:
- `src/lib/factsheet/compute.ts` (the factsheet metric port) uses **population stdev** (`pstdev`, ÷n) to match Python `statistics.pstdev` / `quantstats`, and annualizes **CAGR over 365.25 calendar-day years** while annualizing **vol/Sharpe over 252**. This is the function whose output shape (`ComputeResult`/`ComputeSummary`) the factsheet `MetricsColumn` + `KpiStrip` actually read.
- `src/lib/scenario-blend-panels.ts` (the v1.2 blend graphs) uses **sample stdev (n−1)** to mirror the frozen engine (`scenario.ts`) and `portfolio-stats.ts`, with a different rolling-Sortino convention (downside RMS ÷ *total* window n, not ÷ down-day count).
- The frozen `scenario.ts` engine produces the blend's `portfolio_daily_returns`; those are the inputs you'd feed to a metric function. If you feed engine returns into `compute()` you mix the engine's blend (sample-std internally for some series) with `compute()`'s population-std headline metrics — and nobody will notice until a careful reader cross-checks two numbers.

Additional drift sources unique to client TS:
- **Annualization basis confusion:** `metrics.py` threads `DEFAULT_PERIODS_PER_YEAR = 252` through every annualized scalar (Phase-34 ANNUAL work). `compute.ts` hardcodes `Math.sqrt(252)` for vol but `365.25` for CAGR's `years`. A naive new metric (e.g. annualized downside deviation for a new ratio) added with the "obvious" `* 252` or `/ 365` will silently diverge.
- **VaR/CVaR index convention:** `compute.ts` uses `sortedRets[Math.floor(0.05*n)]` (a specific positional quantile, NOT interpolated); `quantstats` uses its own. With a short blend (e.g. 60 days) the index choice moves VaR by a whole observation.
- **skew/kurtosis:** `compute.ts` uses population moments (÷n) with **excess** kurtosis (−3). `quantstats`/`scipy` default to *sample* (bias-corrected) skew/kurt. On a 90-day blend the difference is material and visible.
- **NaN/Inf from degenerate blends:** a blend with 0 down-days → Sortino denominator 0; <2 distinct values → stdev 0 → Sharpe 0/0; CAGR with `eq[-1] <= 0` (a blend that lost >100% via leverage) → `Math.pow(negative, 1/years)` = NaN. `compute.ts` guards *some* of these (returns 0 or null) but it was written for real uploaded CSVs that never go below −100%; a leveraged blend can.
- **Look-ahead / overlap-N in rolling & bootstrap:** rolling Sharpe/vol/Sortino over an `overlap-N`-day window must not emit values before the window fills (warmup nulls). Block-bootstrap CIs on a 60-day blend resample a tiny population → absurdly wide or degenerate CIs presented as if precise.

**How to avoid:**
- **Decide and document ONE path: reuse `compute.ts` verbatim, feeding it the engine's blend daily returns.** Do NOT write a third metric function. `compute.ts` is the function the factsheet already trusts; the blend is "just another return series." Accept that its CAGR-on-365.25 / vol-on-252 split is the product convention and do not "fix" it inside this milestone.
- **Add a golden-parity test against Python.** The repo already has TS↔Py golden-parity precedent (v1.1.0 optimizer TS↔Py, and `compute.metrics.test.ts` / `compute.dd.test.ts` pin `compute.ts`). Add a fixture: a known blend return series → assert TS `compute()` output matches `metrics.py compute_all_metrics()` within a tight epsilon for Sharpe/Sortino/Calmar/skew/kurt/VaR/CVaR. This is the single highest-value guard in the milestone.
- **Reuse the existing sample-floor gates.** v1.1 Phase-22 + `scenario-blend-panels.ts` already define `MIN_USABLE = 10` and `usableN < window` collapse-to-empty, and `FactsheetView`/`KpiStrip` already render the `m.n < 252` short-track caveat and `enough: false` "Not enough data" panels. The blend payload MUST drive these honestly — set `strategyMetrics.n` to the real overlap count so the existing `n < 252` warning fires.
- **Match the degenerate-collapse contract that `scenario-factsheet-payload.ts` already enforces:** any non-finite value → safe empty payload, never propagate NaN. Extend that rule from the 2 charts to the *full* metric set.
- **Pin VaR/CVaR/skew/kurt convention explicitly in a comment + test** so a future reader doesn't "correct" `compute.ts` toward scipy and silently break parity with the real factsheets.

**Warning signs:**
- A reviewer cross-checks the blend's Sharpe against a hand calc and it's off in the 2nd decimal.
- New metric code contains a bare `* 252`, `/ 365`, `n - 1`, or `pstdev` that doesn't cite which convention it's matching.
- Bootstrap CIs render with `lo === hi` or implausibly wide bands on a short blend.
- `strategyMetrics.n` is set to a placeholder (e.g. `dates.length`) rather than the true overlapping-observation count.

**Phase to address:**
The **payload-completion phase** (extend `buildScenarioFactsheetPayload` minimal→complete). This phase owns the golden-parity test and the convention pins. It is the riskiest phase and should be flagged for deeper research / a dedicated parity-oracle sub-task.

---

### Pitfall 2: Breaking the shared `/factsheet/[id]` route or Overview widget by reusing the context-coupled `FactsheetView`

**What goes wrong:**
Mounting the full `FactsheetBody` (KPI strip + 380px MetricsColumn rail + all panel sections) in the composer changes a shared component, and the real factsheet route or the Overview `EquityChartWidget` regresses — a panel renders differently, a hook order changes, or the byte-identity the v1.2.1 Phase-38 work fought for is lost.

**Why it happens:**
- `FactsheetView` / `FactsheetBody` / `MetricsColumn` / `BatchDPanels` are **shared** across `/factsheet/[id]/v2`, the discovery detail page, the allocator Overview (`AllocationDashboardV2`), and now the composer. Any prop, default, or conditional added "for the scenario case" touches every caller.
- The v1.2.1 win was *additive-only* parity: the chart reuse passed `persist={false}` and kept factsheet files byte-identical. The temptation here is to add an `isScenario`/`hideX` prop *inside* `FactsheetBody` — exactly the kind of edit that breaks byte-identity and risks the route.
- `FactsheetBody` already has `hideHeader` / `hideAllocatorSection` / `hideFooter` / `topSlot` options (added for the Overview top-slot). More flags → combinatorial render paths that the factsheet's own tests don't cover.

**How to avoid:**
- **Stay additive.** Pass a fully-formed `FactsheetPayload` into the *existing* `FactsheetView`/`FactsheetBody` and reuse the existing option flags. Do not add scenario-specific branches inside the shared components — shape the *payload* instead. This is the literal north-star directive: "feed it the blend as its input," one adapter.
- **Keep the factsheet files byte-identical** (the milestone's stated success bar). If a genuinely new shared capability is unavoidable, gate it behind a new optional prop that defaults to the current behavior, and add a factsheet-route regression test proving the default path is unchanged.
- **Protect the Overview path explicitly:** `AllocationDashboardV2.staleness.test.tsx` + `.baseline-unknown.test.tsx` already pin the Overview's factsheet usage. Run them as a gate; the composer must not change anything they assert.
- **Reuse `persist={false}`** (already in `factsheet-context.tsx`, the RT2 fix) for the scenario provider so the full body's view-state never touches the real factsheet's URL/localStorage.

**Warning signs:**
- A diff touches any file under `src/app/factsheet/[id]/v2/` beyond adding an optional, default-preserving prop.
- A new boolean prop on `FactsheetBody` with scenario-specific semantics.
- Factsheet-route or `AllocationDashboardV2` tests change assertions (not just gain new ones).

**Phase to address:**
The **factsheet-body mount phase** (mount the full body in the composer). Owns the byte-identity gate + Overview regression run.

---

### Pitfall 3: A subtly-malformed synthesized payload crashes a factsheet panel

**What goes wrong:**
A field in the synthesized "complete" payload is the wrong shape/`undefined`/`null` where a panel dereferences it, and a sub-panel throws at runtime (e.g. `MetricsColumn` reads `payload.strategyMetrics.start.slice(0,4)`; `StrategyThesisPanel` reads `strategyMetrics.n.toLocaleString()`; `PerformanceCharts` reads `payload.rollingWindow.label`). The current `csv`-arm scenario payload *zeroes* `strategyMetrics` and sets `rollingWindow: { enough:false }` precisely because no metric panels mount today — completing the payload means every one of those fields must now be a real, valid value.

**Why it happens:**
- The current `zeroedComputeSummary()` returns `start: ""`, `end: ""`. `MetricsColumn`'s `StrategyThesisPanel` does `payload.strategyMetrics.start.slice(0,4)` (safe on `""`) but the *meaning* is wrong (renders blank years). Other consumers (`isoToMonthDay(m.start)`) tolerate `""` only by accident.
- The factsheet payload is a large nested structure (`FactsheetCommon` has ~40 fields plus `comparators.{btc,spx,none}`, `bootstrapCI`, `streaks`, `monthlyReturns`, `dailyHeatmap`, `correlationMatrix`, `stressWindows`, `quantiles`). TypeScript guarantees presence but **not validity** — `[]` and `0` typecheck everywhere and silently render empty/zero panels that *look* like real data.
- Lazy/dynamic panels (`MonthlyReturnsHeatmap`, `DailyReturnsHeatmap`, `SignaturesSection`) are `next/dynamic` with `ssr:false`; a bad field surfaces only when that panel scrolls into view, escaping a smoke test that doesn't scroll.

**How to avoid:**
- **Build the complete payload from `compute()` output**, not by hand-filling — derive `strategyMetrics`, `monthlyReturns`, `dailyHeatmap`, `calmarByYear`, `bootstrapCI`, `quantiles`, `streaks` from the same helpers the real `build-payload.ts` uses (`compute`, `calmar-by-year`, `bootstrap`, `period-buckets`, `streak`, `rolling`). Reuse, don't synthesize zeros.
- **Render-test every panel against the synthesized payload**, including the lazy ones — mount `FactsheetBody` in RTL and assert each section renders without throwing for: a healthy blend, a 1-strategy blend, an <N-overlap blend, and a non-finite blend.
- **Honor `rollingWindow.enough` honestly** — derive it from the real overlap-N via the existing `rolling.ts` window-picker so short blends show "Not enough data" instead of a fabricated warmup band.
- Distinguish "structurally absent" (e.g. `styleDrift: null` when n too small for a 50/50 split — `StyleDriftPanel` already early-returns on null) from "empty array" — pick the one each panel's guard actually checks.

**Warning signs:**
- Any payload field set to `0`/`""`/`[]` "for now."
- A panel renders a flat zero line or a blank table instead of an empty-state.
- Tests mount `FactsheetView` but never scroll/trigger the `next/dynamic` lazy panels.

**Phase to address:**
The **payload-completion phase** (validity) + the **factsheet-body mount phase** (per-panel render tests). The "looks done but isn't" risk is highest here.

---

### Pitfall 4: Peer-ranking a synthetic blend against a fake demo cohort (the invariant override)

**What goes wrong:**
The user override ("show Peer-Percentile on the blend") is implemented by reusing `computePeerPercentile()` — which ranks against a **hardcoded, seed-42, 20-strategy *synthesized* demo cohort** (`peer-cohort.ts`). The blend is hypothetical *and* the cohort is fake: a doubly-synthetic "73rd percentile Sharpe" reads to an allocator as a real competitive rank when it is neither a real track record nor a real peer set. This is false precision squared — exactly the no-invented-data violation the original invariant existed to prevent.

**Why it happens:**
- `peer-cohort.ts` is explicitly a demo (its own comment: "Production should replace this with a query against the platform's strategy DB"). The footer disclaimer already says "Demo cohorts and demo portfolios are flagged inline." But a *hypothetical blend* ranked against a *demo cohort* compounds two unrealities the disclaimer wasn't written for.
- Survivorship/selection bias: even if the cohort were real platform strategies, a blend's percentile depends entirely on cohort definition (which strategies, which window, only-survivors?). An ill-defined cohort produces a confident-looking but meaningless number.
- The override removes the *structural* guarantee (the `csv` arm made peer-percentile unrepresentable) and replaces it with a *judgment call* about disclosure framing — and judgment calls regress under deadline pressure.

**How to avoid (honoring the override WHILE staying honest):**
- **Define the cohort explicitly and disclose it on the panel**, not just in a global footer. Decide: is the cohort the platform's real verified strategies (preferred), the existing demo cohort (must be loudly labeled), or the blend's own constituents (a different, defensible "how does the blend rank vs its parts" framing)? Document the choice in REQUIREMENTS.
- **Frame the percentile as "blend vs cohort," never "blend's track record."** Reuse the existing `DemoBadge "Demo cohort"` tag and add explicit "hypothetical blend — projected" framing adjacent to the percentile (the v1.1 "PROJECTED — hypothetical" language already exists in the scenario surface).
- **Suppress the percentile when the blend is too short to rank** (reuse the `n < 252` / sample-floor gate) — a 40-day blend has no business carrying a percentile.
- **Do NOT silently reuse the demo allocator-portfolios / event-signatures** that ride the same `api` arm (see Pitfall 6) just because peer-percentile needs the `api` arm. Enable peer-percentile *intentionally and alone*.
- Keep the cohort deterministic (seed-42 already is) so the same blend doesn't show a different rank on reload.

**Warning signs:**
- The percentile renders with no "hypothetical / demo cohort" qualifier next to it.
- Enabling peer-percentile silently also turns on the demo allocator section or event signatures.
- A short blend (e.g. <126 days) shows a confident percentile.
- The cohort definition isn't written down anywhere.

**Phase to address:**
A dedicated **peer-cohort & invariant-override phase** — owns the cohort definition, the disclosure framing, the sample-floor suppression, and the *scoped* enablement (peer only, not the whole `api` arm). This is the second-highest-cost item; flag for CEO/honesty review.

---

### Pitfall 5: Constituent correlation matrix on insufficient / unstable overlapping history

**What goes wrong:**
The new constituent-correlation panel (pairwise ρ across the blend's strategies / API-key-strategies) reports confident correlations computed on too few overlapping days, or on non-overlapping windows, or mislabels an api-key-strategy — so the "too similar?" diversification check is wrong, or a single-strategy blend renders a degenerate 1×1 "matrix."

**Why it happens:**
- Constituents have different histories. The frozen engine (`scenario.ts:229-233`) already intersects to `commonDates` for the *blend*, but a **pairwise** correlation should ideally use each *pair's* overlap, not the global intersection — using the global intersection silently drops the longest-overlapping pair's data; using per-pair overlap can produce a non-PSD matrix with wildly different sample sizes per cell.
- Short overlap → unstable ρ. Two strategies with 15 common days can show ρ = 0.9 by noise. Presented in a heatmap, that reads as "dangerously similar."
- **api-key-strategies vs registry strategies are different axes** (the v1.2.1 dual-axis `csv_daily_returns` strategy XOR `api_key_id` work). Mislabeling a per-key series as a strategy, or vice versa, mislabels the matrix rows.
- A 0- or 1-constituent blend has no pairwise correlation; treating it as a 1×1 matrix (diagonal 1.0) renders a meaningless "fully correlated with itself" cell.
- The factsheet *already* has a `correlationMatrix` field + renderer (`DistributionPanels.tsx:425`), but it is **strategy-vs-benchmark** — structurally a different matrix. Reusing that field's renderer for constituents risks conflating the two.

**How to avoid:**
- **Apply a per-cell overlap floor** (reuse `MIN_USABLE`/sample-floor) — render a cell as "—" / insufficient when the pair's overlap is below the floor, never a fabricated ρ.
- **Decide the overlap policy explicitly**: per-pair overlap (more data, possibly non-PSD/uneven n) vs global-intersection (consistent n, less data). Document it; for a *diversification check* per-pair-with-floor is usually right.
- **Suppress the panel entirely for 0/1-constituent blends** (honest empty state — "add a second strategy to see diversification") rather than a 1×1 matrix.
- **Label rows by their real axis** — reuse the constituent's display name + a tag distinguishing registry-strategy vs api-key-strategy, sourced from the same place the toggle list is.
- **Derive constituent series additively** (re-align per-constituent returns to common dates in a new adapter); do NOT modify the frozen `scenario.ts` to expose its intermediate `strategyReturns` map (SCENARIO-05 freeze).
- Reuse the WCAG-audited correlation palette already established (v1.2 noted the 3 correlation surfaces; don't introduce a 4th palette).

**Warning signs:**
- A correlation cell shows a value with <~30 overlapping days behind it.
- A single-strategy blend renders any correlation UI.
- Row labels don't distinguish strategy from api-key.
- A diff touches `scenario.ts` to read per-constituent returns.

**Phase to address:**
A dedicated **constituent-correlation phase** — owns the overlap policy, the floor-driven suppression, the single-constituent empty state, and correct axis labeling.

---

### Pitfall 6: Honesty-invariant reversal blast radius — the `ingestSource`/`api`-arm gate is a load-bearing structural guard

**What goes wrong (HIGHEST-COST):**
The override is implemented by flipping the scenario payload from `ingestSource: "csv"` to `"api"` to unlock peer-percentile — but the `api` arm is the **single discriminant** that structurally gates **four** synthetic panels at once. Flipping it silently turns on:
1. `PeerPercentilePanel` (the intended one),
2. the **demo `AllocatorSection`** (seed-data demo portfolios) — `FactsheetBody` renders it when `ingestSource === "api"` and `!hideAllocatorSection`,
3. `SignaturesSection` (strategy event-study) — rendered when `hasComparator && ingestSource === "api"`,
4. `CrossSignaturesSection` (benchmark event-study).

All four also appear in `SectionNav` (it adds the "Signatures"/"Allocator" nav anchors on the `api` arm). The result is a hypothetical blend showing *demo allocator portfolios* and *event signatures stitched against a BTC fixture* — gross no-invented-data violations the override never authorized.

**Why it happens:**
- The discriminated union `FactsheetPayload = FactsheetApiPayload | FactsheetCsvPayload` (`types.ts`) makes `peerPercentile`/`allocatorPortfolios`/`eventSignatures`/`benchEventSignatures` exist **only** on the `api` arm. That was the *intended* B6/NEW-C20-01 design: the `csv` arm makes them *unrepresentable*. The override needs ONE of the four, but the union forces all-or-nothing.
- The `ingestSource === "api"` check is referenced across `FactsheetView.tsx`, `BatchDPanels.tsx`, `MetricsColumn.tsx`, `SignaturePanels.tsx`, `CrossSignaturePanels.tsx`, `SectionNav`, `build-payload.ts`, and is asserted in `scenario-factsheet-payload.test.ts` (line 124: `expect(p.ingestSource).toBe("csv")`) and `ScenarioComposer.test.tsx` + `audit-c20.test.ts`. Flipping it touches/breaks all of them.
- `IMPACT-02` guard (the v1.1 "no FactsheetBody on the scenario impact view") + `GRAPH-04` are the documented locks; tests encode them. The reversal must *consciously* update these, and a blind flip will either break the tests (good) or, worse, pass them while shipping the demo panels (if the tests only check peer).

**How to avoid:**
- **Do NOT flip `csv`→`api` wholesale.** Two safer options, pick one and document:
  - **(A) Pass the demo-bearing panels as suppressed via existing flags.** `FactsheetBody` already supports `hideAllocatorSection`. There is *no* flag for signatures — so the `api` arm still leaks event signatures. This option is insufficient alone.
  - **(B) Make peer-percentile representable without the full `api` arm.** Cleanest: add `peerPercentile` to `FactsheetCommon` (or a third arm / an explicit per-panel `showPeerPercentile` flag) so the scenario can carry *peer only* while `allocatorPortfolios`/`eventSignatures` stay structurally absent. This preserves the no-invented-data structural guarantee for the three panels the override did *not* authorize, and confines the invariant reversal to exactly peer-percentile.
- **Enumerate and consciously update every `ingestSource === "api"` site** before changing the discriminant. Treat each as a decision: does the blend get this panel? (peer = yes per override; allocator/signatures = no).
- **Update the locked tests deliberately, not reflexively.** `scenario-factsheet-payload.test.ts:124`, `audit-c20.test.ts`, `ScenarioComposer.test.tsx` encode the invariant. Each change to those is a documented invariant reversal — add a test asserting allocator/signatures stay *suppressed* on the blend even when peer is shown (encode the *new* honesty boundary, per Rule 9).
- **Re-confirm the `IMPACT-02` guard's continued meaning.** v1.2 shipped graphs-only with peer suppressed; v1.2.2 reverses peer. The guard's tests must be updated to assert the *new* contract (peer allowed + framed, allocator/signatures still blocked), not deleted.

**Warning signs:**
- The scenario payload literal changes `ingestSource: "csv"` → `"api"` with no accompanying suppression of allocator/signatures.
- A "Demo portfolios" or "Returns Signatures" section appears in the composer.
- `scenario-factsheet-payload.test.ts` or `audit-c20.test.ts` is edited to *remove* an assertion rather than *replace* it with a tighter one.
- `SectionNav` shows "Allocator" or "Signatures" anchors on the scenario tab.

**Phase to address:**
The **peer-cohort & invariant-override phase** (Pitfall 4's phase) owns the union/arm decision and the per-site enumeration. This is the milestone's structural keystone — flag for engineering-architecture review (it's effectively an ADR: "how does a hypothetical blend carry peer-percentile without unlocking the other three synthetic panels").

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Flip scenario payload `csv`→`api` wholesale to get peer-percentile | One-line change, peer panel appears | Silently ships demo allocator portfolios + BTC event signatures on a hypothetical; reverses no-invented-data for 3 unauthorized panels; breaks the structural guarantee | **Never** — confine the reversal to peer-percentile via a flag/arm |
| Write a fresh "blend metrics" TS function instead of reusing `compute.ts` | Tailored to blend inputs, no convention archaeology | A *third* stdev/annualization convention; guaranteed drift vs `/factsheet/[id]`; new untested surface | **Never** — reuse `compute.ts`, add golden parity |
| Set `strategyMetrics.n` / `start` / `end` to placeholders | Payload typechecks, charts render | The `n < 252` short-track caveat never fires; thesis/start-date render blank; false confidence | **Never** — derive from real overlap |
| Add an `isScenario` branch *inside* `FactsheetBody` | Quick visual tweak | Breaks byte-identity; new render paths the factsheet tests don't cover; risks `/factsheet/[id]` + Overview | **Never** — shape the payload, not the component |
| Reuse the demo seed-42 cohort for the blend's percentile | Peer panel works immediately | Doubly-synthetic rank reads as real competitive standing | Only with explicit on-panel "demo cohort + hypothetical" disclosure and a sample-floor suppression |
| Global-intersection (not per-pair) overlap for constituent correlation | Simpler, consistent matrix `n` | Drops the longest-overlapping pair's data; understates available signal | Acceptable as a documented v1 simplification *if* the per-cell floor + disclosure are honest |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Python `metrics.py` parity oracle | Assume TS `compute.ts` already matches Python because both say "252" | Add an explicit golden fixture: blend returns → assert TS vs `compute_all_metrics` within epsilon (Sharpe/Sortino/Calmar/skew/kurt/VaR/CVaR) |
| Frozen `scenario.ts` engine (SCENARIO-05) | Modify it to expose per-constituent `strategyReturns` for the correlation matrix | Re-derive/re-align constituent series in a NEW additive adapter; never touch the frozen engine |
| `factsheet-context` persistence | Mount the full `FactsheetBody` and inherit its `storageKey`/URL view-state, bleeding across tabs (the Phase-38 RT2 bug class) | Reuse `persist={false}` on the scenario `FactsheetProvider`; verify collapsible `storageKey`s (`factsheet-collapse:scenario:*`) don't collide with the real route |
| Existing `correlationMatrix` payload field | Reuse it for constituents — it's already there | It is strategy-vs-benchmark; constituent correlation is a *new* panel/field. Keep them distinct |
| `next/dynamic` lazy panels (heatmaps, signatures) | Smoke-test without scrolling → miss a malformed-field crash | Force-mount/scroll lazy panels in render tests for every degenerate blend shape |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Full metric recompute (`compute()` + bootstrap + heatmaps + correlation) on every toggle/reweight | Composer jank when toggling a constituent | Memoize on the blend's return-series identity; only recompute when the blend actually changes (the toggles re-blend via the engine first) | Blends with many constituents × frequent toggling |
| Block-bootstrap CIs computed on the main thread for the blend | UI freeze on each blend change | v1.1 already runs MC in a Web Worker — reuse that worker path for the blend's bootstrap, don't inline it | Long blends / many resamples |
| O(constituents²) pairwise correlation recomputed unmemoized | Heatmap recompute on unrelated state changes | Memoize the matrix on the constituent set + window; recompute only on membership/window change | Many constituents |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Constituent correlation / per-key labels leak another tenant's strategy identity in a shared scenario | Cross-tenant data leak via the scenario share link (RLS surface noted in PROJECT constraints) | The blend's constituents are the allocator's own book; never include non-owned strategy names; re-verify the leak-scoped share RPC doesn't serialize constituent identities |
| Synthesized `api`-arm payload accidentally serialized into a shared/SSR blob with demo data presented as real | A recipient sees fabricated allocator portfolios as the allocator's real holdings | Keep the invariant reversal confined to peer; never let demo allocator/signatures into a shareable blend payload |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Peer-percentile shown with no "hypothetical / demo cohort" qualifier | Allocator treats a what-if's rank as a real competitive standing | Inline "projected — hypothetical blend · demo cohort" framing next to the percentile (reuse existing PROJECTED + DemoBadge language) |
| Blend factsheet looks identical to a real strategy factsheet | User forgets they're looking at a what-if, screenshots it as a real track record | Keep a persistent "Scenario / hypothetical blend" header treatment distinct from a real strategy name |
| Short-blend metrics shown without the `n < 252` caveat | False confidence in annualized Sharpe/Sortino/Calmar on a 60-day blend | Drive the existing `n < 252` warning + sample-floor empty-states from the real overlap count |
| Single-constituent blend shows a 1×1 correlation "matrix" | Meaningless "100% correlated with itself" reads as a bug | Empty state: "Add a second strategy to assess diversification" |

## "Looks Done But Isn't" Checklist

- [ ] **Client metrics:** Often missing the Python golden-parity test — verify TS `compute()` matches `compute_all_metrics()` within epsilon on a fixture blend.
- [ ] **Degenerate blends:** Often missing the non-finite / <100%-loss / <N-overlap cases — verify each renders an honest empty state, never NaN/Inf or a fabricated zero.
- [ ] **`strategyMetrics.n`:** Often a placeholder — verify it's the real overlap count so the `n < 252` caveat fires.
- [ ] **Invariant reversal:** Often only peer is checked — verify `allocatorPortfolios` + `eventSignatures` + `benchEventSignatures` are STILL suppressed on the blend (assert it).
- [ ] **Byte-identity:** Often assumed — verify `git diff` touches no `factsheet/[id]/v2/*` file beyond default-preserving optional props; run the factsheet-route + `AllocationDashboardV2` regression tests.
- [ ] **Lazy panels:** Often untested — verify heatmaps/signatures render (or stay suppressed) when scrolled into view for the synthesized payload.
- [ ] **Persistence:** Often bleeds — verify the scenario provider uses `persist={false}` and its collapsible `storageKey`s don't collide with the real route.
- [ ] **Constituent correlation floor:** Often missing — verify a pair with <floor overlapping days shows "—", not a fabricated ρ.
- [ ] **Peer disclosure:** Often footer-only — verify the "hypothetical + demo cohort" qualifier is ON the peer panel itself.

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Metric drift vs Python ships | MEDIUM | Add the golden-parity test (would have caught it), pin the convention, re-derive from `compute.ts`; redeploy |
| `api`-arm flip leaked demo allocator/signatures | HIGH | Revert the discriminant flip; re-architect peer onto a flag/`FactsheetCommon` field; re-assert suppression — this is a public no-invented-data violation, treat as a hotfix |
| Broke `/factsheet/[id]` or Overview via shared edit | MEDIUM-HIGH | Revert the shared-component change; move the behavior into the payload adapter; restore byte-identity |
| Constituent correlation on thin overlap published | LOW-MEDIUM | Add per-cell floor + suppression; re-render; the engine/data are unaffected |
| Peer percentile shown un-disclosed | LOW | Add the inline qualifier + sample-floor suppression |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| 1. Client metric parity vs Python 252-basis | Payload-completion (extend `buildScenarioFactsheetPayload` minimal→complete) | Golden-parity test TS↔Py within epsilon; convention pins documented; `n<252` caveat fires on short blends |
| 2. Breaking shared factsheet route / Overview | Factsheet-body mount | `git diff` adds only default-preserving optional props; factsheet-route + `AllocationDashboardV2` tests green |
| 3. Malformed payload crashes a panel | Payload-completion (validity) + factsheet-body mount | Per-panel RTL render test (incl. lazy panels) for healthy/1-strat/<N-overlap/non-finite blends |
| 4. Peer-rank a synthetic blend dishonestly | Peer-cohort & invariant-override | Cohort defined + on-panel disclosure + sample-floor suppression; reload-stable rank |
| 5. Constituent correlation on thin/unstable overlap | Constituent-correlation | Per-cell overlap floor → "—"; single-constituent empty state; correct strategy/api-key labels; `scenario.ts` untouched |
| 6. Invariant-reversal blast radius (`api`-arm) | Peer-cohort & invariant-override (keystone — ADR/eng-review) | Every `ingestSource==="api"` site enumerated; allocator/signatures asserted SUPPRESSED on blend; locked tests replaced (not deleted) with tighter assertions |

## Sources

- Codebase (HIGH): `src/app/(dashboard)/allocations/widgets/performance/scenario-factsheet-payload.ts` + `.test.ts`; `src/lib/factsheet/{compute.ts,types.ts,build-payload.ts,peer-cohort.ts,scenario-blend-panels.ts}`; `src/app/factsheet/[id]/v2/{FactsheetView.tsx,BatchDPanels.tsx,MetricsColumn.tsx,MandatePanels.tsx,factsheet-context.tsx,DistributionPanels.tsx}`; `analytics-service/services/metrics.py`; `src/lib/scenario.ts`.
- `.planning/PROJECT.md` (HIGH): no-invented-data invariant, Key Decisions (IMPACT-02 / GRAPH-04 / ANNUAL-02..05 / 252-basis), Out-of-Scope rationale (`ingestSource:"api"` false-precision risk), v1.2.1 `persist={false}` byte-identity precedent.
- Project MEMORY (HIGH): Phase-38 RT2 cross-tab persist bug; v1.1 TS↔Py golden-parity precedent; v1.1 Web-Worker Monte-Carlo; the `n<252` / sample-floor disclosure gates from v1.1 Phase 22.

---
*Pitfalls research for: client-side factsheet parity on a hypothetical blend + honesty-invariant override*
*Researched: 2026-06-25*
