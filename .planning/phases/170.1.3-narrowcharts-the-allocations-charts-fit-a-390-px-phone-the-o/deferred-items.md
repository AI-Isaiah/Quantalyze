# Phase 170.1.3 deferred items (out of scope, found by plan 07)

- `src/lib/factsheet/compute.conventions.test.ts`, "compute() with no conventions argument is byte-identical to the pre-change
  compute() (D-36, W1, FROZEN)": fixture B and fixture C inline snapshots differ from this machine's output in the last digit of
  `skew` (`-0.11360716852722537` expected, `-0.11360716852722538` received; `0.036844507138639` expected,
  `0.036844507138638946` received). Found 2026-10-26 running `npx vitest run src/lib ...` on the plan-07 worktree. No `src/lib`
  file differs from the merge-base with `origin/main`, so no plan of this phase caused it; it reads as a 1-ulp float difference
  between this host and the host that wrote the snapshot. Not fixed, not investigated further (SCOPE BOUNDARY).
