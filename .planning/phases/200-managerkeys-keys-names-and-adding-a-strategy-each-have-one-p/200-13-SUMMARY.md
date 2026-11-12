---
phase: 200-managerkeys-keys-names-and-adding-a-strategy-each-have-one-p
plan: 13
subsystem: e2e-gating
tags: [e2e, playwright, ci-gating, seeded-lane, key-panel]
requires: []
provides:
  - "e2e/manager-keys.spec.ts: the edit page's one-key panel tests (10), seeded and logged in, in the blocking e2e-seeded list, no env self-skip"
  - "seedManagerKeyPanel / readStrategyApiKeyId / cleanupManagerKeyPanel in e2e/helpers/seed-test-project.ts"
  - "src/__tests__/manager-keys-e2e-wiring.test.ts: the wiring and no-skip pin"
affects:
  - .github/workflows/ci.yml
  - TODOS.md
  - e2e/api-key-flow.spec.ts
  - e2e/sync-analytics-flow.spec.ts
tech-stack:
  added: []
  patterns: ["a seeded e2e spec with NO env self-skip: without seed env the seed helper throws, so it fails instead of skipping", "an unchanged-state assertion made falsifiable by a sibling test that proves the database read sees a write"]
key-files:
  created:
    - e2e/manager-keys.spec.ts
    - src/__tests__/manager-keys-e2e-wiring.test.ts
  modified:
    - e2e/helpers/seed-test-project.ts
    - e2e/api-key-flow.spec.ts
    - e2e/sync-analytics-flow.spec.ts
    - e2e/csv-upload-flow.spec.ts
    - .github/workflows/ci.yml
    - src/__tests__/e2e-seeded-hydration-guard.test.ts
    - src/__tests__/observ12-fixtures-presence.test.ts
    - TODOS.md
decisions:
  - "The panel tests MOVE to a new seeded spec; the unauthenticated contract describes stay in the unseeded specs on Playwright's unauthenticated request fixture (planner layout decision, followed)."
  - "The new spec carries no HAS_SEED_ENV skip (second documented exception to the MA-8 place-2 rule, beside full-flow); a missing seed env fails every test."
metrics:
  tasks: 3
  completed: 2026-11-11
  duration: "about 45 min (start time was not clocked)"
status: complete
actuals:
  tokens: 10900
  tasks: 3
  commits: 3
plan_head_before: d8b2df29e1a8063c5f09c45ea1f7a8d248e39534
plan_head_after: f930f7a251b4a9692acb48b4f09a56b7caf51416
requirements-completed: [ROUTE-09, LEAN-04]
coverage:
  - id: D1
    description: "A pick in the Change key… picker opens the confirm and writes nothing before the dialog's Change key button; Cancel writes nothing; the button re-points the strategy, all read from strategies.api_key_id"
    requirement: ROUTE-09
    verification:
      - kind: e2e
        ref: "e2e/manager-keys.spec.ts#Change key… opens the picker, a pick opens the confirm, and nothing is written before Change key"
        status: pass
      - kind: e2e
        ref: "e2e/manager-keys.spec.ts#pressing the dialog's Change key re-points the strategy to the picked key"
        status: pass
    human_judgment: false
  - id: D2
    description: "The panel's heading, its link to the Profile API keys tab, the absence of Add Key and Delete, and the Resync states and failure lines run seeded and logged in"
    requirement: LEAN-04
    verification:
      - kind: e2e
        ref: "e2e/manager-keys.spec.ts (tests 3-10, 10 passed, 0 skipped)"
        status: pass
    human_judgment: false
  - id: D3
    description: "The panel spec stays in the blocking e2e-seeded list, out of the advisory list, with no skip and no failure tolerance in the seeded step"
    verification:
      - kind: unit
        ref: "src/__tests__/manager-keys-e2e-wiring.test.ts"
        status: pass
    human_judgment: false
---

# Phase 200 Plan 13: the one-key panel e2e tests run for real in the blocking e2e-seeded job Summary

The edit page's one-key panel tests now live in `e2e/manager-keys.spec.ts`: a seeded manager-only user signs in through the /login form, owns a private strategy with a linked key and a spare key, and the "nothing is written before Change key" claims are read from `strategies.api_key_id` with the service role. The spec is in the `e2e-seeded` list, which the `frontend` aggregator judges, and it cannot pass by skipping.

## What changed

- **Task 1 (tracer), commit `d0b5eaffd`.** `seedManagerKeyPanel`, `readStrategyApiKeyId` (throws on a read error or a missing row) and `cleanupManagerKeyPanel` in the seed helper; the new spec with the pick-and-confirm test; the spec added as the last entry of the seeded else-arm list with a place-1 note; `SEEDED_SPEC_COUNT` 24 -> 25.
- **Task 2, commit `7b52fc4aa`.** The other nine tests moved in (heading and Profile link, no Add Key or Delete, the Profile link navigation, the Resync visible, syncing and return-to-normal states, the 500 JSON and 502 HTML failures), plus a new test that presses the dialog's `Change key` and polls the database read until it returns the spare key. `api-key-flow.spec.ts` keeps its 3 contract tests and `sync-analytics-flow.spec.ts` keeps its 3 contract tests, the 6 env-gated analytics tests and the retired-URL test, each with a pointer comment. The `observ12` floor for `api-key-flow.spec.ts` was re-measured (5750 bytes recorded, floor 6000 -> 4600). `csv-upload-flow.spec.ts` comment re-pointed.
- **Task 3, commit `f930f7a25`.** `manager-keys-e2e-wiring.test.ts` (4 tests); the dated CORRECTED note under the 158-REVIEW WR-06 paragraph of ci.yml and a matching note under the `[158-OPS-03]` advisory entry in TODOS.md (the entry stays open, checkbox unchecked).

## Verification evidence (local seeded lane)

Lane: `scripts/local-stack/run.sh up` (exit 0), `--assert-local-handoff` exit 0, `next dev -p 3100 --hostname 127.0.0.1` (the plan's 127.0.0.1 form worked, no fallback to `localhost` was needed), `CI=1 npx playwright test ... --retries 0 --timeout 60000`.

Final run of the panel spec on restored product code:

```
  ✓   1 [chromium] › e2e/manager-keys.spec.ts:72:7 › ... › Change key… opens the picker, a pick opens the confirm, and nothing is written before Change key (2.5s)
  ✓   2 [chromium] › e2e/manager-keys.spec.ts:105:7 › ... › pressing the dialog's Change key re-points the strategy to the picked key (1.9s)
  ✓   3 [chromium] › e2e/manager-keys.spec.ts:138:7 › ... › edit page renders the panel heading and the Profile link (1.2s)
  ✓   4 [chromium] › e2e/manager-keys.spec.ts:147:7 › ... › edit page no longer offers Add Key or Delete (1.2s)
  ✓   5 [chromium] › e2e/manager-keys.spec.ts:158:7 › ... › Add or remove keys opens the Profile API keys tab (1.4s)
  ✓   6 [chromium] › e2e/manager-keys.spec.ts:164:7 › ... › Resync button is visible for the currently linked key (935ms)
  ✓   7 [chromium] › e2e/manager-keys.spec.ts:169:7 › ... › clicking Resync shows syncing state (1.7s)
  ✓   8 [chromium] › e2e/manager-keys.spec.ts:190:7 › ... › sync button returns to normal state after completion (1.7s)
  ✓   9 [chromium] › e2e/manager-keys.spec.ts:209:7 › ... › sync failure shows error message (1.7s)
  ✓  10 [chromium] › e2e/manager-keys.spec.ts:230:7 › ... › sync failure with non-JSON response shows service unavailable (1.7s)

  10 passed (16.6s)
```

Tracer run (Task 1, one test): `✓ 1 [chromium] › e2e/manager-keys.spec.ts:72:7 › ... Change key… opens the picker, a pick opens the confirm, and nothing is written before Change key (7.6s)` then `1 passed (9.3s)`.

Old specs on the same server (`e2e/api-key-flow.spec.ts e2e/sync-analytics-flow.spec.ts`): `6 skipped` and `7 passed (2.6s)`, no failure. The 3 + 3 contract tests and the retired-URL test passed; the 6 analytics tests skipped on their own env gate. This matches the plan's expected 7 passed and 6 skipped, so there is no deviation.

### RED proof 1: a product neuter turns the Playwright run red

`src/components/strategy/ApiKeyManager.tsx` copied byte for byte to the scratchpad. The picker option's onClick got `void handleSyncTrades(key.id, currentKeyId);` after `setPendingKeyId(key.id);`, so the dialog still opens but the pick has written. Result:

```
  ✘   1 [chromium] › e2e/manager-keys.spec.ts:72:7 › ... › Change key… opens the picker, a pick opens the confirm, and nothing is written before Change key (2.3s)
  ✓   2 ... through  ✓  10 ...
    Error: the strategy was re-pointed by the pick itself, before the dialog's Change key button (ROUTE-09 D-03)
    expect(received).toBe(expected) // Object.is equality
    Expected: "26d092f8-dbc4-4d3f-9368-745dbe6adecf"
    Received: "e31d794a-49a6-41c3-98ea-193ae3b8dd51"
    > 92 |     ).toBe(seeded.linkedKey.id);
  1 failed
  9 passed (16.0s)
playwright exit 1
```

It failed on the first neutered run, so the settle before the read was long enough and no test change was needed. Restore: `cp <scratchpad>/ApiKeyManager.tsx.bak src/components/strategy/ApiKeyManager.tsx`, then `cmp` exit 0 and `git status --short` on that path empty.

### RED proof 2: the wiring pin bites (each on a byte copy, restored with cp, cmp exit 0)

- (a) `e2e/manager-keys.spec.ts \` list line deleted from ci.yml: `AssertionError: e2e/manager-keys.spec.ts is not in the e2e-seeded list. Without it the panel's confirm-before-re-point tests run nowhere that can fail a merge (Phase 200 gap 1).: expected [ …(24) ] to include 'e2e/manager-keys.spec.ts'` (`1 failed | 3 passed`). Restore `cmp` exit 0.
- (b) `test.skip(true, "neuter");` inserted as the first statement of the spec's describe: `AssertionError: e2e/manager-keys.spec.ts contains \`test.skip(\`: the panel tests could pass without running, which is the Phase 200 gap 1 failure mode: expected true to be false` (`1 failed | 3 passed`). Restore `cmp` exit 0.
- Beyond the plan, two more neuters on the other assertions, both RED and restored with `cmp` exit 0: the spec appended to the advisory `e2e` job line (`... is in the advisory unseeded list ...`), and `|| true` appended to the seeded `--timeout 60000` (`... is followed by \`|| true\`, so it can never fail`).

### Other checks

- `npx vitest run` on `manager-keys-e2e-wiring`, `e2e-seeded-hydration-guard` (parsed list 25), `critical-regressions`, `ci-docs-path-filter.contract`: 4 files, 282 tests passed. `observ12-fixtures-presence`: 2 passed.
- `npx tsc --noEmit`: exit 0. `npx eslint` on the five touched e2e files: exit 0. `npm run lint`: 0 errors, 4 warnings, all in files this plan did not touch (`MetricsColumn.tsx`, `composite-read-path.ts`, `queries.stale-analytics-detail.test.ts`); out of scope.
- `node scripts/verify-plan-anchors.mjs` on the plan: exit 0 before starting.
- Teardown: dev server killed, nothing listening on 3100, `run.sh down` exit 0, `run.sh --assert-teardown` exit 0 (`surviving quantalyze containers -> 0`).

## Deviations from Plan

None - plan executed exactly as written.

One housekeeping note, not a deviation: `next dev` rewrote `AGENTS.md` (it re-adds its own agent-rules block on boot). That is a tool artifact, not plan work. It was never staged, and after the dev server stopped it was restored from `git show HEAD:AGENTS.md`, so `git status --short` is clean.

## Known Stubs

None. No stub, placeholder or hardcoded empty value was added. (The edit page's `KeyPermissionBadge` 502s without an analytics service in the lane; no panel test asserts on it, per the plan.)

## Threat Flags

None. The only new surface is test-only service-role seeding, routed through `getAdmin()` (T-200-24); the lane env file lived in the scratchpad and was not committed; the dev server bound to 127.0.0.1 (T-200-28).

## Self-Check: PASSED

- Created files present: `e2e/manager-keys.spec.ts`, `src/__tests__/manager-keys-e2e-wiring.test.ts`, this SUMMARY.
- Commits present on the branch: `d0b5eaffd`, `7b52fc4aa`, `f930f7a25` (measured `git rev-list --count d8b2df29e..HEAD` = 3 before this SUMMARY's own commit).
- Acceptance greps: one `e2e/manager-keys.spec.ts \` line in ci.yml between `role-home.spec.ts \` and `--timeout 60000`; `SEEDED_SPEC_COUNT = 25`; three seed exports; the guard import in the spec; `test(` counts: `api-key-flow.spec.ts` 3 (was 6), `sync-analytics-flow.spec.ts` 10 (was 16: 3 contract + 6 analytics + 1 retired URL), `manager-keys.spec.ts` 10; pointer comments present in both old specs.
