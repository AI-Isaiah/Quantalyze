---
phase: 106-cutover-flip-delete-legacy-janitor
plan: 07
subsystem: onboarding-backbone
tags: [stage-b, cutover, dead-code-deletion, feature-flags, unified-backbone]
requires: ["106-05"]
provides:
  - "keys/sync unconditional unified handler (legacyKeysSyncHandler + re-entry #3 retired)"
  - "analytics-client without computeAnalytics"
  - "csv-finalize / finalize-wizard / csv-validate / verify-strategy unified arms unconditional"
  - "all USE_COMPUTE_JOBS_QUEUE reads removed from src"
affects:
  - "every wizard/teaser finalize + validate + verify path (now single unified route)"
tech-stack:
  added: []
  patterns:
    - "delete-only-flag-off-exclusive with per-site dormancy proof (SC-4)"
    - "legacy-path tests re-pointed at the surviving unified path"
key-files:
  created: []
  modified:
    - src/app/api/keys/sync/route.ts
    - src/app/api/keys/sync/route.test.ts
    - src/lib/analytics-client.ts
    - src/app/api/strategies/csv-finalize/route.ts
    - src/app/api/strategies/finalize-wizard/route.ts
    - src/app/api/strategies/finalize-wizard/route.test.ts
    - src/__tests__/csv-finalize-c14-regression.test.ts
    - src/__tests__/csv-finalize-after-failloud.test.ts
    - src/app/api/strategies/csv-validate/route.ts
    - src/__tests__/csv-validate-route.test.ts
    - src/app/api/verify-strategy/route.ts
    - src/app/api/verify-strategy/route.test.ts
    - src/app/api/keys/validate-and-encrypt/route.ts
    - tests/integration/process-key-thin-adapters.test.ts
  deleted:
    - tests/integration/phase-19-pra-write.test.ts
decisions:
  - "runLegacyFinalize KEPT (not a false arm) — reachable on the TRUE path via the composite hoist; only the flag-off single-key dispatch was deleted"
  - "csv-finalize legacy fall-through arm deleted whole (flag-off-exclusive); shared helpers (applyCsvMetadataUpdate/persist/enqueue) STAY (unified true path calls them)"
  - "legacy-path tests re-pointed at the unified path or the composite hoist; legacy-only tests (23505 recovery, F5b legacy error-mapping, flag-off enqueue, phase-19 SV-upsert shim) deleted as dead-code coverage"
metrics:
  duration: "~1 session (Tasks 2 & 3; Task 1 committed prior session)"
  completed: "2026-07-15"
  commits: 3
---

# Phase 106 Plan 07: Delete TS-Route Flag Arms + Legacy keys/sync Handler Summary

Deleted every `isUnifiedBackboneActive()===false` / `USE_COMPUTE_JOBS_QUEUE!=="true"` false arm from the six TS onboarding routes, retiring dark-path re-entry #3 (`legacyKeysSyncHandler` → `computeAnalytics`) one wave ahead of the Python core, with a written dormancy proof per deleted site (both flags pinned on in prod since 2026-05-25).

## What shipped (per task)

**Task 1 (commit `02e3a734`, prior session):** keys/sync — `legacyKeysSyncHandler` (re-entry #3) + queue-off composite arm deleted, unified handler unconditional; `computeAnalytics` removed from `analytics-client` (zero callers). Verified: zero `legacyKeysSyncHandler` / `computeAnalytics` references in src.

**Task 2 (commit `7d61ea6a`):** csv-finalize + finalize-wizard.
- csv-finalize: deleted the `enqueueCsvAnalyticsAfter` flag-off placeholder block and the entire flag-off legacy direct-RPC fall-through arm (finalize_csv_strategy, 23505 recovery, metadata/persist/enqueue); `unifiedCsvFinalizeHandler` now unconditional. Shared helpers (`writeFailedStrategyAnalyticsPlaceholder`, `applyCsvMetadataUpdate`, `persistDailyReturnsOrErrorResponse`, `enqueueCsvAnalyticsAfter`) KEPT — the unified true path calls all four.
- finalize-wizard: unified single-key arm made unconditional; flag-off legacy dispatch deleted; both `USE_COMPUTE_JOBS_QUEUE` arms inside `runLegacyFinalize`'s `after()` deleted (enqueue now unconditional).
- Verify gate: **FINALIZE-CLEAN** (all four finalize suites green; zero `USE_COMPUTE_JOBS_QUEUE` in both routes).

**Task 3 (commit `1a83bbd1`):** csv-validate + verify-strategy + validate-and-encrypt + plan-level gate.
- csv-validate: unified handler unconditional; flag-off `validateCsv()` arm deleted; unused imports removed.
- verify-strategy: `legacyVerifyStrategyHandler` (own comment "DEPRECATED: remove after 2026-05-15") deleted; `unifiedVerifyStrategyHandler` unconditional; 6 now-unused imports/consts removed.
- validate-and-encrypt: dormant `isUnifiedBackboneActive` import + `void` suppression removed (never had a live flag branch); `getCorrelationId` kept.
- Verify gate: **TS-ARMS-CLEAN** — `git grep USE_COMPUTE_JOBS_QUEUE -- src` == 0; full `vitest run --coverage` green; `npm run lint` exit 0.

## runLegacyFinalize disposition (LOCKED SC-4 check)

**KEPT — reachable on the TRUE path, NOT a false arm.** `runLegacyFinalize` is invoked at finalize-wizard `:618` via the composite hoist (`apiKeyId === null && memberCount > 0`), which runs regardless of the backbone flag. Every composite routes through it for the `stitch_composite` enqueue + founder-email / `last_sync_at` touch / `sync_trades` fan-out that the unified arm does NOT replicate (the `:1015` load-bearing comment + its Sentry warning are preserved byte-for-byte). Only the flag-off single-key dispatch at the old `:692` was deleted. The unified-path tests (`STATE.unifiedBackboneActive = true`) pass UNCHANGED — the SC-4 byte-identical evidence.

`writeFailedStrategyAnalyticsPlaceholder` and `stampCompositeFailedUnlessComplete`/`compositeMemberCount` similarly kept (their non-flag-off callers survive on the true path).

## Deviations from Plan

### [Rule 1/3] Legacy-path test blast radius exceeded the plan's declared file set

Deleting the flag-off legacy arms is behavior-preserving in prod (flag on for ~2 months), but the routes' unit/integration tests were written against the flag-off legacy path and broke. The direction is locked by `must_haves` (delete every false arm), so these tests were re-pointed at the surviving unified path or deleted as dead-code coverage. Files touched beyond the plan's task `<files>`:

| File | Action | Reason |
|------|--------|--------|
| `src/__tests__/csv-finalize-c14-regression.test.ts` | convert + delete | success-path tests re-pointed at unified (`postProcessKey` success + `INTERNAL_API_TOKEN`); legacy-only 23505 idempotent-recovery tests deleted (deleted code) |
| `src/__tests__/csv-finalize-after-failloud.test.ts` | convert | D7 fail-loud tests exercise the SHARED persist/enqueue/placeholder helpers — re-pointed at the unified path; token scrubbed |
| `src/app/api/verify-strategy/route.test.ts` | delete legacy | legacy `verifyStrategy` delegate + F5b error-mapping + per-email rate-limit tests deleted (unified path covered by NEW-C35-01/02) |
| `tests/integration/process-key-thin-adapters.test.ts` | delete block | "flag=off preserves legacy path" describe (5 tests) removed — asserts deleted behavior |
| `tests/integration/phase-19-pra-write.test.ts` | delete file | phase-19 shim-step-a legacy SV-upsert integration test; surviving unified SV upsert (trust_tier / metrics_snapshot) covered by NEW-C35-01/02 |

`finalize-wizard/route.test.ts` (in-scope): legacy-path cases re-pointed at the composite hoist via a `routeThroughLegacyFinalize()` helper; obsolete single-key-flag-off enqueue + Phase-86 composite-dispatch blocks removed (Phase-88 hoist tests retain full composite coverage); neutrality-OFF rewritten to assert single-key now always unified.

All `USE_COMPUTE_JOBS_QUEUE` literal occurrences (code AND comments AND test env lines) scrubbed from src to satisfy the plan-level grep-gate.

## Orphaned env (cleanup optional, post-phase)

`USE_COMPUTE_JOBS_QUEUE` remains SET in Vercel but is now read nowhere in src — harmless orphan. Cleanup deferred (out of scope for this plan).

## Verification

- Task 1 gate: KEYS-SYNC-CLEAN (prior session).
- Task 2 gate: FINALIZE-CLEAN — `finalize-wizard/route.test.ts` + `csv-finalize-{rpc,c14-regression,after-failloud}.test.ts` green; zero `USE_COMPUTE_JOBS_QUEUE` in both finalize routes.
- Task 3 gate: TS-ARMS-CLEAN — `git grep USE_COMPUTE_JOBS_QUEUE -- src` == 0; full suite **669 files / 8171 tests passed, 0 failed**; coverage lines 86.66 / stmts 84.53 / funcs 81.48 / branches 77.81 (all above the 82/80/74/72 thresholds); `npm run lint` exit 0; `tsc --noEmit` clean.

## Self-Check: PASSED

- Files created/modified exist on disk (verified via git status + tsc).
- Commits exist: `02e3a734` (Task 1), `7d61ea6a` (Task 2), `1a83bbd1` (Task 3) — all on `feat/106-stage-b-cutover-delete-legacy`.
- Stayed on the feature branch throughout (no branch ops); no PR/push created.
