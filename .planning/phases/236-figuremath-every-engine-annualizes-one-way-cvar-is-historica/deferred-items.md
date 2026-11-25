# Phase 236 deferred items (out of scope, found during execution)

## 236-01

- `src/lib/factsheet/compute.conventions.test.ts` fixtures B ("a series with zero-return days") and C ("a series with interior calendar gaps") fail on this machine on a last-digit float difference of `skew` only (`-0.11360716852722537` expected, `-0.11360716852722538` received; `0.036844507138639` expected, `0.036844507138638946` received). `compute.ts` and the test were not touched by plan 236-01. Likely a `Math.pow` precision difference of the local Node build. Not re-pinned. Plan 236-05 moves compute.ts and will re-baseline this snapshot with a decision; check there whether CI reproduces it.
