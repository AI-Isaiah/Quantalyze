# Phase 41: Constituent correlation & diversification - Context

**Gathered:** 2026-06-26
**Status:** Ready for planning

<domain>
## Phase Boundary

A NEW constituent-correlation diversification view in the /allocations Scenario
composer: pairwise correlation between the actual strategies / API-key-strategies
that make up the blend (from the FROZEN engine's already-emitted
`correlation_matrix`), with a "too similar" flag (ρ ≥ 0.85), a Diversification
Ratio + Effective-Number-of-Bets headline, per-constituent percent-contribution-
to-risk, de-aliased labels, honest empty states, and hierarchical-clustering
reorder. The `scenario.ts` engine stays FROZEN (reads `correlation_matrix`; the
DR/ENB/PCR math is derived client-side from per-constituent `daily_returns` +
weights, which the engine does NOT emit). Requirements CORR-01..06.

</domain>

<decisions>
## Implementation Decisions

### Placement, renderer & data source
- **REFINED 2026-06-26 after research (supersedes the original "in
  ScenarioFactsheetChart" placement):** the `CorrelationHeatmap` is ALREADY
  mounted at `ScenarioComposer.tsx:2353` (immediately below the Phase-40
  FactsheetBody mount at ~:2219), with ALL constituent data already in scope
  (`deAliased.strategies` + `strategyNames` + `scenarioMetrics.correlation_matrix`).
  So the panel is **ENHANCED IN PLACE in `ScenarioComposer.tsx`**: wrap that
  existing heatmap region in a NEW factsheet-shaped "Diversification"
  `CollapsibleSection` (DESIGN.md editorial styling) and add the new elements
  around it. This is more surgical than relocating to `ScenarioFactsheetChart`
  and re-threading all the constituent data through a new prop, for ~zero visual
  gain (the heatmap already sits right under the body). It satisfies the same
  constraints: static-guard-safe (`CorrelationHeatmap` ≠ the forbidden
  `FactsheetBody` literal at ScenarioComposer.test.tsx:3377), and
  `FactsheetCsvPayload` stays clean (the diversification data is composer-local,
  never in the payload). "Factsheet-shaped editorial layout" (CORR-01) is met via
  the `CollapsibleSection` + DESIGN.md styling. Rationale: the original
  ScenarioFactsheetChart placement was chosen before research revealed the heatmap
  + data already live in the composer; the user intent (a factsheet-shaped
  diversification view) is fully served by either file — the implementation
  detail changed on new evidence (Rule 1/7).
- **Reuse the existing `src/components/portfolio/CorrelationHeatmap.tsx`** — it's
  WCAG-audited (diverging teal→burnt-orange palette, colorblind-safe), empty-state
  routed, and accepts `{ correlationMatrix, strategyNames, overlappingDays,
  avgAbsCorrelation }`. Do not build a new heatmap.
- **Matrix data = the engine's `correlation_matrix`** (CORR-01; frozen, already
  emitted as `Record<id, Record<id, number>>`, 3-decimal). Never recompute ρ in
  the panel.
- **Labels = the existing `strategyNames` de-aliased memo**
  (ScenarioComposer.tsx:1531, keyed off `deAliased.strategies`) — already human
  names, not UUIDs (CORR-04 done-by-reuse via `scenario-dealias.ts`).

### Diversification math & thresholds
- **Diversification Ratio = (Σ wᵢσᵢ) / σ_portfolio** (Choueifaty); σᵢ derived from
  each constituent's `daily_returns`; σ_portfolio from
  `scenarioMetrics.portfolio_daily_returns`.
- **Effective Number of Bets = 1 / Σ PCRᵢ²** (RISK-based, correlation-aware — uses
  the per-constituent risk contributions, NOT the naive weight-HHI 1/Σwᵢ²). The
  formula is DISCLOSED on the panel.
- **"Too similar" flag at ρ ≥ 0.85** (CORR-02, locked).
- **Empty gate = GLOBAL n** — the engine nulls the whole `correlation_matrix` at
  n<10 → whole-panel honest empty state; 0/1-constituent → "add a second
  strategy" empty. The engine emits NO per-pair overlap metadata, so the floor is
  global-n, NOT per-cell; DOCUMENT this (do not fabricate per-pair overlap
  tracking). Any genuinely-missing cell renders "—".

### Risk contribution & clustering
- **PCRᵢ = wᵢ·(Σw)ᵢ / (wᵀΣw)** (CORR-05, user-included), where Σ is a covariance
  matrix DERIVED client-side from the constituents' `daily_returns` (the engine
  emits only ρ, not Σ or σ). Show per-constituent %-of-risk alongside the matrix.
- **Cluster reorder (CORR-06, user-included)** = hand-rolled pure-TS
  **average-linkage** hierarchical clustering on distance ½(1−ρ); reorder the
  matrix rows/cols so correlated clusters group visually. No new dependency
  (package.json has no clustering/linalg lib). Full dendrogram viz is v2
  (CORR-V2-02).
- **Math home = a NEW pure-TS `src/lib/diversification.ts`** (DR, risk-based ENB,
  PCR, covariance-from-returns, average-linkage order) with golden unit tests.
  Keep `correlation_matrix` consumption read-only.
- **Honest empties:** 0/1-constituent → "add a second strategy to see
  diversification"; n<10 → the engine-null empty state (reason-routed by
  `CorrelationHeatmap`).
- Reaffirm the **leverage-invariance** note on the panel header (correlation does
  not shift with per-strategy leverage; live at ScenarioComposer.tsx:2204).

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/components/portfolio/CorrelationHeatmap.tsx` — the heatmap renderer
  (props above; `correlationBg`/`textColor` diverging palette; empty-state routing
  by reason; aria labels).
- Engine `correlation_matrix` — `src/lib/scenario.ts:94,401-432` (UUID-keyed,
  sample-covariance Pearson, 3-decimal, null at n<10 / non-finite).
- `strategyNames` memo — `ScenarioComposer.tsx:1531-1535` (de-aliased id→name).
- `deAliased.strategies` (+ `.daily_returns` per constituent) + `deAliased.state`
  (normalized weights/leverage) at `ScenarioComposer.tsx:1438-1510` — the inputs
  for DR/ENB/PCR.
- `scenarioMetrics.portfolio_daily_returns` (full-res blended returns) — for
  σ_portfolio.
- `src/lib/correlation-math.ts` (`pearson`, returns null on zero-variance — the
  audit-2026-05-07 pin) + `src/lib/portfolio-math-utils.ts` (`mean`, `stdDev`).
- `CollapsibleSection` pattern (FactsheetView.tsx:204) for the factsheet-shaped
  section wrapper.

### Established Patterns
- Pure-TS math helper + golden test, then memoized composer wiring tested via
  `ScenarioComposer.test.tsx`.
- DESIGN.md correlation-heatmap guidance: colorblind-safe diverging palette,
  neutral midpoint `#F1F5F9`, WCAG non-text 3:1 / cell text 4.5:1.

### Integration Points
- New additive prop on `ScenarioFactsheetChart` (e.g. `constituents`) carrying
  `{ correlationMatrix, strategyNames, weights, perConstituentDailyReturns or
  precomputed σ/cov, n }` from the composer.
- The panel renders the heatmap + a DR/ENB headline + a PCR list, all in a
  `CollapsibleSection` styled to match the body's editorial sections.

</code_context>

<specifics>
## Specific Ideas

- CORR-05 (PCR) and CORR-06 (cluster reorder) are explicitly P2 user-INCLUDED
  extras — in scope this phase.
- North-star: the diversification view lets the allocator spot redundant
  (too-similar) constituents while composing — the matrix + the DR/ENB headline +
  PCR together answer "is this blend actually diversified or just stacked?".

</specifics>

<deferred>
## Deferred Ideas

- Crisis-window sub-correlation (CORR-V2-01) — v2.
- Full dendrogram visualization (CORR-V2-02) — v2 (this phase reorders only).
- Peer-cohort / mandate → Phase 42. Toggle fold + guards + the Phase-40 UI-review
  carry-forwards → Phase 43.

</deferred>
