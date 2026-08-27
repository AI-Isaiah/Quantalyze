# Phase 164 — deferred items (out of scope for the plan that found them)

## D-164-A — `scripts/**/*.test.ts` is invisible to vitest, so `scripts/check-gdpr-export-coverage.test.ts` never runs

**Found during:** plan 164-02, Task 1 (while adding a `strategy_shares` entry to the GDPR export manifest).

**Measured 2026-08-27:** `vitest.config.ts:22-42` defines `INCLUDE` as
`src/**/*.test.{ts,tsx}`, `tests/a11y/**`, `tests/visual/**`, `tests/lib/**`,
`tests/integration/**`, `tools/eslint-plugin-quantalyze/tests/**`. There is no
`scripts/**` glob. Passing the path explicitly confirms it:

```
$ ./node_modules/.bin/vitest run ... scripts/check-gdpr-export-coverage.test.ts
Test Files  3 passed (3)        # 4 paths given, 3 files collected
```

`scripts/check-gdpr-export-coverage.test.ts` is 20 KB of assertions that has
never executed in this repo's CI. Its sibling
`src/__tests__/gdpr-export-coverage-hook.test.ts` DOES run and shells out to the
script, so the surface is not wholly untested — but whatever the scripts-side
file asserts beyond that is unverified.

**Why not fixed here:** out of the 164-02 blast radius (plan scope is the
`strategy_shares` migration, the phase-29 guard narrowing, and the SQL gate).
Adding `scripts/**/*.test.ts` to `INCLUDE` would pull an unknown number of
never-run test files into the suite in the middle of a phase whose own gates are
deliberately red; that belongs in its own change with its own green run. Likely
home: Phase 164.1 (which already owns "gates that no longer bite") or root
`TODOS.md`.

**Remedy when picked up:** add `"scripts/**/*.test.ts"` to `INCLUDE` in
`vitest.config.ts`, run the full suite once, and triage whatever it surfaces.
Check for the same blind spot in other top-level directories.
