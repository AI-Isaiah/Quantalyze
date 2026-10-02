# Phase 56: Factsheet Parity Re-Verify - Context

**Gathered:** 2026-07-01
**Status:** Ready for planning
**Mode:** Smart discuss (autonomous) — verification/assertion phase; parity-by-construction is a LOCKED invariant; no open product grey area. Orchestrator-scouted the factsheet path directly.

<domain>
## Phase Boundary

Confirm — with a **single-source-of-truth guard, not an assumption** — that the real
factsheet on the scenario blend stays **parity-by-construction** after the v1.5 engine
change: it consumes `computeScenario`'s emitted (now member-windowed) `portfolio_daily_returns`
series and runs the SAME factsheet `compute()` on it, never re-deriving the blend. The
single requirement is **PARITY-01**.

**In scope:** trace the factsheet payload path; add/strengthen a guard that asserts
single-source-of-truth (the factsheet metrics equal `computeScenario`'s metrics on the
identical series, and the payload builder never re-derives the blend); extend/re-run the
v1.2.2 parity specs on the coverage-window series.

**Out of scope:** UI window control (Phase 57), coverage legibility (58), persistence (59),
golden re-bake (60), authed canary (61). No engine change (that was Phase 55). No new
factsheet features.
</domain>

<decisions>
## Implementation Decisions

### Product decisions (LOCKED)
- **Parity-by-construction is a LOCKED invariant.** The factsheet is computed on the SAME
  blended series `computeScenario` emits (`compute.ts` runs on `portfolio_daily_returns`).
  The v1.5 change is to how the *series* is built (coverage-window membership), not the
  metric formulas — so parity holds iff the factsheet path consumes `computeScenario`'s
  output rather than re-deriving the blend. This phase PROVES that with a guard.
- 252-annualization, no-invented-data, WCAG-AA stay green.

### Claude's Discretion (assertion approach — grounded in existing conventions)
- **Two-layer guard (recommended):** (1) a STRUCTURAL guard that pins
  `buildScenarioFactsheetPayload` consumes `ComputedMetrics.portfolio_daily_returns` and
  contains NO blend/divisor math of its own (it calls `compute()` on the engine series);
  (2) a RUNTIME parity assertion — for a representative scenario WITH an explicit coverage
  `window`, the factsheet payload's headline metrics (twr/cagr/vol/sharpe/sortino/maxDD)
  equal `computeScenario`'s `ComputedMetrics` on the identical member-windowed series, to
  fp precision. Extend the existing v1.2.2 parity spec(s) rather than inventing a new
  harness where one exists.
- Where an existing parity spec (`scenario-factsheet-payload.test.ts`, `scenario-adapter.test.ts`,
  `scenario-blend-panels.test.ts`) already asserts parity on the union series, ADD a
  coverage-window case (explicit `window` passed) so parity is proven on the NEW path too.
- No behavior change to the payload builder unless the trace reveals it re-derives the
  blend (it does not, per scout) — this is a re-verify + assert phase, surgical (Rule 3).

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets / the factsheet path (scouted)
- `src/app/(dashboard)/allocations/widgets/performance/scenario-factsheet-payload.ts` —
  `buildScenarioFactsheetPayload(metrics, ...)` synthesizes the ENTIRE returns-derived
  payload from the blend's `portfolio_daily_returns` (daily RETURN form) via
  `compute()` from `@/lib/factsheet/compute` — the SAME compute the real `build-payload.ts`
  runs (parity-by-construction, Phase 38 PARITY-01). "The blend never hits the Python
  compute" (payload header, ~:378). It does NOT re-derive the blend — it consumes the
  engine series. This is the crux the guard must pin.
- `src/app/(dashboard)/allocations/widgets/performance/ScenarioFactsheetChart.tsx` —
  the chart mount consuming the payload.
- `ComputedMetrics.portfolio_daily_returns` (from `scenario.ts`, Phase 55) — the
  full-resolution daily-RETURN series. In v1.5, when `state.window` is present the engine
  emits the member-windowed series here; the factsheet consumes whatever the engine emits.

### Existing parity specs to extend / re-run
`scenario-factsheet-payload.test.ts`, `scenario-adapter.test.ts`, `scenario-blend-panels.test.ts`,
`scenario-sample-ratios.test.ts`, `AllocationsTabs.scenario-composer.test.tsx`,
`ScenarioComposer.test.tsx`, `percent-allocated-parity.test.ts`. These encode the v1.2.2
parity-by-construction contract; add coverage-window cases.

### Established Patterns
- Factsheet parity convention (v1.2.2): the scenario blend renders through the SAME
  factsheet `compute()` + `TimeSeriesChart`/`MasterBrush` as the real strategy factsheet.
- Cumulative-RETURN vs wealth (NEW-C18-09): `portfolio_daily_returns` is RETURN form; the
  payload converts as needed via `toWealth()`. Do not regress.

### Integration Points
- The factsheet payload is downstream of `computeScenario` (via the adapter) — coverage
  spans / window are handled INSIDE the engine; the factsheet just consumes the emitted
  series. No window plumbing added to the payload builder.

</code_context>

<specifics>
## Specific Ideas

- The v1.5 risk this phase de-risks: after the engine emits a SHORTER (member-windowed)
  series, the factsheet must reflect the SAME shorter series and the SAME metrics — not a
  stale union series or a re-derived blend. The guard makes a silent divergence fail loud.
- Phase 55 already preserved union-when-absent byte-compat, so the union parity specs stay
  green; the NEW assertion is the coverage-window (explicit-window) case.
</specifics>

<deferred>
## Deferred Ideas

- The scenario tab actually PASSING a window to the engine at runtime is Phase 57 — this
  phase asserts parity holds when a window IS passed (via a test that passes one), but
  does not wire the UI.
- Golden/e2e re-bake (Phase 60). Persistence (59).
</deferred>
