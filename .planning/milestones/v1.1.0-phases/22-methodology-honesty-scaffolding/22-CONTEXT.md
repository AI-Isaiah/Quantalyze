# Phase 22: Methodology-Honesty Scaffolding - Context

**Gathered:** 2026-06-21
**Status:** Ready for planning

<domain>
## Phase Boundary

Two cross-cutting honesty primitives that Phases 26 (Stress/VaR) and 27 (Monte-Carlo)
will reuse:

1. **HONEST-01** — every projected statistic discloses HOW it was computed: a canonical
   methodology line ("{method} · {N} overlapping days · not a forecast") on each
   projection block, on BOTH the own-book Scenario composer and the `/scenarios` Sandbox.
2. **HONEST-02** — a single shared minimum-sample floor gate (new `src/lib/sample-floor.ts`):
   a tunable conservative floor (default **60 overlapping days** for distributional/tail
   outputs), a gate function, and a shared honest empty state. It is the ONE source of
   truth later reused by Stress and Monte-Carlo — regression-pinned so no feature defines
   its own floor.

Builds on Phase 21's PROJECTED badge + coverage caveat (the HONEST-01 seed). The scenario
engine is FROZEN (already exposes `n`, `effective_start`, `effective_end`). No stress, MC,
optimizer, persistence, sharing, or benchmark here (Phases 23-28).
</domain>

<decisions>
## Implementation Decisions

### HONEST-01 — per-stat method disclosure (accepted as recommended)
- **Mechanism:** upgrade the existing Phase-21 projection caveat into a canonical
  **methodology line**: "{method} · {N} overlapping days · not a forecast" — one honest line
  per projection block (not a tooltip on every KPI cell).
- **Method label for the current scenario stats:** "Historical realized" — the engine computes
  realized statistics over the overlap window; label the ACTUAL method (bootstrap is Phase 27,
  do not claim it here).
- **Horizon wording:** "not a forecast".
- **Scope:** BOTH the own-book composer (`ScenarioComposer`) and the `/scenarios` Sandbox
  (`ScenarioBuilder`) — consistent with Phase 21's framing placement.
- Compose with the existing Phase-21 caveat ("Projected from N overlapping days. Shortest
  history: {name}.") — fold the method + horizon into one coherent disclosure rather than
  stacking two separate lines.

### HONEST-02 — shared minimum-sample floor gate (accepted as recommended)
- **Location:** new pure module `src/lib/sample-floor.ts` — no fetch / no side effects / no
  time reads (mirrors `scenario-history.ts` conventions). The SINGLE source of truth.
- **Default floor:** **60 overlapping days** for distributional/tail outputs (conservative,
  tunable). Distinct from — and does NOT replace — Phase 21 correlation's existing 10-day bar.
- **Tunability:** a named default constant + an optional per-call override parameter (Stress/MC
  default to the shared floor but may pass their own if a feature genuinely needs a different bar).
- **Below-floor empty state:** a shared honest empty state that NAMES the actual N and the floor
  (e.g. "Need ≥{floor} overlapping days for a {feature} estimate") — reused by 26/27.
- Export shape: a floor constant, a gate predicate (e.g. `isBelowSampleFloor(n, floor?)` or a
  richer `evaluateSampleFloor(...)` returning `{ ok, n, floor, reason }`), and the empty-state
  reason string. Planner picks the exact signature; keep it minimal and reuse-friendly.

### Degenerate inputs + single-source enforcement (accepted as recommended)
- The gate routes ALL of: 0/1 strategy, below-floor overlap, and non-finite returns → the honest
  empty state. (Non-finite returns are already nulled by the frozen engine; the gate must treat a
  null/NaN `n` as below-floor, never as a passing value.)
- **Single-source enforcement:** a regression test pins the floor constant + gate behavior so
  Phases 26/27 reuse it; no second floor definition. (A lint/grep guard against re-declaring a
  floor is acceptable but optional — the test is the gate.)
- **Do NOT retrofit** Phase 21's `<10`-overlapping-day correlation empty state onto this floor —
  correlation is a separate, lower statistic-specific threshold. Avoid scope creep / collision.

### Claude's Discretion
- Exact gate function signature/return shape, the precise methodology-line composition with the
  existing caveat, and the empty-state copy wording are at Claude's discretion within the above.
</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/lib/scenario.ts` (FROZEN) — `ComputedMetrics` exposes `n` (overlapping days),
  `effective_start`, `effective_end`. The method/horizon disclosure reads these read-only.
- `src/lib/scenario-history.ts` — convention model for the new pure `sample-floor.ts` (pure,
  no side effects, well-tested, single export).
- `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx:1063` — the Phase-21 coverage
  caveat ("Projected from {n} overlapping days. Shortest history: …") to upgrade into the
  methodology line.
- `src/components/scenarios/ScenarioBuilder.tsx` — the Sandbox projection caveat (same upgrade).
- Phase 21's honest-empty-state convention (`CorrelationHeatmap` reason-routed empty states) as
  the pattern for the below-floor empty state.

### Established Patterns
- No-invented-data invariant: degenerate inputs render honest empty states, never fabricated
  numbers or false precision. HONEST-02 is the generalized primitive for this on distributional/tail outputs.
- Pure-lib + golden/regression test convention (`scenario.test.ts` SCENARIO-05 pins, `scenario-history.test.ts`).
- Coverage is a BLOCKING CI gate — the new lib module + UI changes ship with tests.

### Integration Points
- ScenarioComposer + ScenarioBuilder projection blocks (methodology line).
- `src/lib/sample-floor.ts` (new) — consumed in this phase's UI for the honest empty state;
  exported for Phases 26/27.
</code_context>

<specifics>
## Specific Ideas

- Example disclosure target: "Historical realized · 412 overlapping days · not a forecast".
- Floor default 60 overlapping days — name it as a clearly-labeled exported constant so the
  intent (conservative distributional/tail bar) is self-documenting.
- The regression test is the single-source mechanism: it must fail if a future feature hardcodes
  a different floor instead of importing the shared one.
</specifics>

<deferred>
## Deferred Ideas

- Actually consuming the floor in Stress (Phase 26) and Monte-Carlo (Phase 27) — this phase only
  builds + pins the primitive and applies HONEST-01 disclosure; the consumers come later.
- Per-statistic distinct floors (e.g. VaR vs MC) — single shared default now; per-call override
  is the escape hatch if a later phase proves a need.
- Unifying the correlation 10-day bar with the 60-day floor — explicitly out of scope.
</deferred>
