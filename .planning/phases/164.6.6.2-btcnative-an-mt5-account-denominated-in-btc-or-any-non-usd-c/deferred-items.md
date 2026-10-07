# Deferred items, phase 164.6.6.2

## From plan 05 (2026-10-07)

- `src/lib/factsheet/compute.conventions.test.ts`, "compute() with no conventions argument is byte-identical to the pre-change compute() (D-36, W1, FROZEN)", fixtures B (zero-return days) and C (interior calendar gaps): inline snapshots disagree with the received `skew` by one unit in the last place (`-0.11360716852722537` vs `-0.11360716852722538`; `0.036844507138639` vs `0.036844507138638946`).
  - Pre-existing: fails identically on a clean detached checkout of `735f44690`, before any plan 05 change. `compute.ts` imports only `./types` (type) and `@/lib/return-stats`.
  - Likely cause: a platform or Node/V8 floating-point difference in the skew summation, so the frozen literal was recorded on another runtime. Not investigated further; out of scope for a labels-only plan.
  - Needs: someone owning `compute.ts` / `return-stats` to decide whether to re-record the literal (it is marked FROZEN) or compare with a tolerance.
