# Phase 108: Scenario-planner onto the backbone - Context

**Gathered:** 2026-07-15
**Status:** Ready for planning

<domain>
## Phase Boundary

Route the scenario-planner/blend flows through the ONE canonical backbone (dailies → the
factsheet backbone rolling/metrics primitives), retiring the bespoke "second Sharpe" TS compute.
DELETE `src/lib/scenario-blend-panels.ts` (~211 LOC) — its single consumer (`ScenarioComposer.tsx`)
reads backbone-derived blend panels instead. KEEP `src/__tests__/metrics-parity.test.ts` (now guards
the Python↔TS backbone identity, more load-bearing after the reorg). The engine `src/lib/scenario.ts`
is byte-frozen (107 left it untouched; 108 touches only the panel-derivation layer).
Frontend/TS-only. Stacks on Phase 107 (same branch; `deriveSeriesBundle` already exported).
OUT OF SCOPE (do NOT touch): `portfolio-stats.ts`, `health-score.ts`, and the Tier-4 items
(portfolio_metrics.py, equity_reconstruction.py, match.py) per the ROADMAP OUT-OF-SCOPE note.

</domain>

<decisions>
## Implementation Decisions

### Parity std — accept backbone as canonical (USER DECISION, RE-CONFIRMED 2026-07-15)
- The old `scenario-blend-panels.ts` uses SAMPLE std (÷n−1); the canonical backbone uses POPULATION
  std (÷n). ACCEPT the backbone (population-std) value as canonical — the backbone is the single
  source of truth (milestone thesis).
- ⚠️CORRECTION (Fable red team, user re-confirmed): the shift is NOT invisible. The chart LINE moves
  ~1px (visually the same), but the rolling vol/Sharpe HOVER TOOLTIPS render 2-decimal PERCENT
  (`(v*100).toFixed(2)`), so the ~0.2–0.8% relative shift IS hover-visible — e.g. 3M vol
  25.00%→24.80%, 6M vol 11.95%→11.91%, 3M Sharpe 2.00→2.02. The user RE-CONFIRMED accepting the
  canonical population-std value knowing it is a small hover-visible change (SC-4 read as "chart
  visually unchanged; tooltips show the more-correct canonical value", not literal byte parity).
- RE-PIN the affected test expectations to the population-std values: `metrics-parity.test.ts` and
  the PAYLOAD-03 tension in `scenario-factsheet-payload.test.ts:212`. Document the re-pin as an
  intentional convention unification (one rolling-std path), NOT a regression.
- Do NOT fork a sample-std variant off the backbone — one canonical convention only.

### Adapter route — backbone rolling primitives, keep the toggle (USER DECISION)
- Route the blend panels through the canonical backbone `factsheet/rolling.ts` PRIMITIVES (the same
  population-std code `deriveSeriesBundle` itself calls), passing the user's SELECTED rolling window,
  NOT the full `deriveSeriesBundle` (whose window is fixed/auto-picked).
- This preserves the blend UI's 3M/6M/12M window toggle (ZERO UX regression) and is lighter, while
  still satisfying SC-1's intent: no second Sharpe/annualization stack; only canonical primitives.
- The engine already emits `portfolio_daily_returns` on `computeScenario` output (`scenario.ts:440`) —
  feed THAT into the backbone rolling primitives (the "synthesize a minimal payload off
  portfolio_daily_returns" pattern already used by `scenario-factsheet-payload.ts`).

### Quantile whiskers — keep min/max (USER DECISION)
- Preserve the existing min/max whiskers (`{All:[min…max]}`) — adapt the backbone output back to
  min/max for the blend panel. The backbone's p05/p95 shape is NOT adopted here.
- Rationale: the whisker shape is orthogonal to removing the second-Sharpe compute; switching to
  p05/p95 would be a visible change (tighter whiskers) = a user-facing regression vs pre-change (SC-4).

### usableN degenerate gate — Claude's Discretion (re-home cleanly)
- The bespoke `usableN` degenerate gate (drives 3 composer UI keys) has no backbone equivalent.
  Re-home it in the smallest surgical way that preserves current behavior — keep the gate logic
  alongside the new backbone-routed panel derivation (a thin adapter), not inside the deleted module.
  Confirm the 3 composer keys still render identically at plan/impl time.

### Backbone identity (SC-3) — metrics-parity.test.ts is load-bearing
- KEEP `metrics-parity.test.ts` green; it now guards the Python↔TS backbone identity. It does NOT
  import the deleted module, so it stays — re-pin only if a population-std value it asserts moved.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `factsheet/rolling.ts` primitives — canonical population-std rolling stats; accept an explicit
  window (enables the toggle-preserving route). The backbone entry `deriveSeriesBundle`
  (`build-payload.ts:186`, exported by Phase 107) calls these.
- `scenario-factsheet-payload.ts` — the LIVE sibling precedent: already routes the scenario CHART
  onto backbone primitives (population-std `compute`) by synthesizing a minimal payload off
  `portfolio_daily_returns`. Mirror this pattern for the blend panels.
- `computeScenario` (`scenario.ts:440`) — already emits `portfolio_daily_returns`; the blend-panel
  input already exists. Engine byte-frozen.

### Established Patterns
- Backbone-routing precedent from Phase 107: a dailies transform → canonical backbone re-derive,
  delete the bespoke second compute, keep a permanent grep-gate. Read
  `.planning/phases/107-leverage-as-a-dailies-transform/RESEARCH.md` + `107-01-SUMMARY.md`.

### Integration Points
- DELETE target: `src/lib/scenario-blend-panels.ts` (~211 LOC). Single live consumer:
  `ScenarioComposer.tsx:102` import + `:2818-2823` call → rewire to the backbone-derived panels.
- KEEP untouched: `portfolio-stats.ts`, `health-score.ts`, `scenario.ts`, `metrics-parity.test.ts`.
- Seams to resolve (per RESEARCH): sample→population std (decided: accept backbone), fixed-window
  vs toggle (decided: primitives + explicit window), quantiles (decided: keep min/max), usableN
  re-home (discretion).

</code_context>

<specifics>
## Specific Ideas

- SC-2 delete-gate: after the refactor, a permanent grep-gate that `scenario-blend-panels.ts` (and
  its `buildBlendPanels` export) no longer exists / is not imported anywhere.
- SC-4 parity pin: a test that the backbone-routed blend panels reproduce the population-std rolling
  values for a representative blend, at each window (3M/6M/12M), with min/max whiskers.
- Re-anchor the `buildBlendPanels` source-scan positive control + delete the ~251-LOC blend-panels
  test (per RESEARCH Wave-0 gaps).

</specifics>

<deferred>
## Deferred Ideas

- Tier-4 OUT-OF-SCOPE (v1.11): portfolio_metrics.py second Sharpe/TWR (MWR/Dietz stay), allocator
  equity_reconstruction.py, allocator match.py. Tier-5 remainder: portfolio-stats.ts / health-score.ts
  stay (out-of-scope live Sharpe stacks: optimizer, allocated_capital, NAV builder).
- Adopting backbone p05/p95 quantile whiskers factsheet-wide — a separate visual-consistency pass,
  not this phase.

</deferred>
