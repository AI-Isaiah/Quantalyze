# Phase 164.9.6 — deferred items

## From plan 04 (found 2026-10-03, out of plan 04's scope)

- **`npx tsc --noEmit` reports TS2769 at `src/__tests__/mutation-runner-floors.test.ts:3019`.** That is the
  `spawnSync("bash", …, { env: { ...childEnv, … } })` call in the executed-mutate-step block, which commit
  `e6c8fd05b` (plan 03) introduced. The project's `ProcessEnv` requires `NODE_ENV`, so the object literal does
  not satisfy it. vitest strips types and the file is green, but CI's `frontend-typecheck` job runs tsc over
  `src/`, so it is expected to go red on this branch.
  - **Remedy (one line):** build the env as `Record<string, string | undefined>` and pass `as NodeJS.ProcessEnv`.
    Plan 04 applied the same fix to its own file in `6f2927341`. This line was not fixed in plan 04 because the
    file belongs to plan 03, and the scope boundary limits each plan to its own changes.
  - **Measured:** apart from this line, the other 117 tsc errors are all in `self-referential-oracle.test.ts` and
    `seam-log-coverage.test.ts`, and come from the shared node_modules TypeScript 7.0.2 environment.
