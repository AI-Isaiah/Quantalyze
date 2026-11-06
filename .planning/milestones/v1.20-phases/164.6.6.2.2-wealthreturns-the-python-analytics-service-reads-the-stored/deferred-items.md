# Deferred items (plan 164.6.6.2.2-07, found by the full-suite gate, out of scope)

## src/lib/factsheet/compute.conventions.test.ts: two FROZEN inline snapshots differ in the last digit of `skew`

- Fixture B: expected `-0.11360716852722537`, received `-0.11360716852722538`.
- Fixture C: expected `0.036844507138639`, received `0.036844507138638946`.
- `vitest run` on the plan 07 head (Node 25.8.1, macOS): 18924 passed, 3 failed; these are 2 of the 3.
- Not caused by this phase: `compute.ts` imports only `./types` and `@/lib/return-stats`, and neither
  file nor the test appears in `git diff 31c00d6a0f..HEAD -- src` (the phase touched resolve-series,
  queries, the og/returns/scenario-share routes only). The delta is one ulp in a floating-point
  accumulation, the signature of a runtime or platform difference between where the snapshot was
  written and where it ran. Re-measure on CI's Node before acting; do not loosen the FROZEN snapshot.
- Owner: whoever next touches `src/lib/return-stats.ts` or the FROZEN snapshots.
