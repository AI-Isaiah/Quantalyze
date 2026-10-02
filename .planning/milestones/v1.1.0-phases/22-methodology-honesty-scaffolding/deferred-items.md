# Phase 22 — Deferred Items

## DI-22-01 — Extract a shared `EmptyStateCard` primitive (code-review WR-03)
- **What:** `SampleFloorEmptyState` reuses the `CorrelationHeatmap` empty-state shell
  tokens by verbatim copy (not a shared component). With 4 expected consumers
  (correlation, sample-floor, P26 stress, P27 MC) this is a drift surface.
- **Why deferred:** This is a DRY/presentational consolidation — exactly the
  pre-ship `/simplify` pass's job. Doing it ad-hoc now would touch frozen Phase-21
  `CorrelationHeatmap` and risk its tests. Aligns with PROJECT.md "defer
  consolidation until a feature forces convergence" — the 3rd/4th consumer (P26/27)
  is the genuine forcing moment.
- **Owner:** pre-ship `/simplify` pass, or Phase 26/27 when the next consumer lands.

## DI-22-02 — Single-source LITERAL-BAN for the 60-day floor (code-review WR-01 residual)
- **What:** The CONTRACT_GUARDS pin pins the floor VALUE but does not detect a future
  consumer that hardcodes `60` instead of importing `SAMPLE_FLOOR_OVERLAPPING_DAYS`.
- **Why deferred:** No consumer exists until P26/27; an ESLint literal-ban rule now
  is speculative (B16/B17 precedent). Add the grep/AST sweep when P26/27 consumers land.
- **Owner:** Phase 26/27.

## DI-22-03 — Body-builder routing duplication (code-review IN-01)
- **What:** `belowFloorBody`/`noUsableSampleBody`/`fewStrategiesBody` return raw
  strings; `SampleFloorEmptyState` re-derives which to call from `reason`. Adding a
  reason means editing two places. Consider a single `sampleFloorBody(verdict, …)`.
- **Why deferred:** Benign single-consumer today; revisit at P26/27 wiring (IN-01 said defer).

## Note — IN-03 (intentional forward-wiring, NOT a defect)
`src/lib/sample-floor.ts` + `SampleFloorEmptyState.tsx` exports are intentionally
unreferenced this phase (build+pin+export for P26/27). Allowlist them in any
`ts-prune`/knip dead-export sweep — do NOT delete.
