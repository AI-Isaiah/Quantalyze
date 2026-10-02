# Phase 06 — Deferred Items

## From Plan 03 execution (2026-04-19)

### Pre-existing Vitest failures surfaced during Task 3 full-suite gate

Running `npx vitest run` with `HAS_LIVE_DB` credentials loaded surfaced 11
pre-existing test failures in 5 files. None of them touch the Plan 03
surface area (route.ts, route.test.ts, allocator-holdings-rls.test.ts) —
each failure is in a test file the plan did not create or modify.

Per scope boundary rule, these are logged here and NOT fixed as part of
Plan 03. They existed at the base commit `fb62439` and were not introduced
by the Plan 03 work.

| File | Failing tests | Likely cause |
|------|---------------|--------------|
| `src/__tests__/retention-crons.test.ts` | 7/7 | `Invalid schema: cron` — the test queries `cron.job` via the PostgREST client which does not expose the `cron` schema. Either the test needs the service-role client to use the `pg` SQL path, or the live-DB harness needs a schema-exposure migration. Pre-existing; likely regressed during a Phase 05 Supabase schema-visibility change. |
| `src/__tests__/bridge-outcome-cron.test.ts` | 1 | Live-DB cron test — same pg_cron schema visibility issue as above (Phase 05 surface). |
| `src/__tests__/gdpr-export-coverage-hook.test.ts` | 1 | Manifest hook reports `allocator_holdings` missing from the GDPR export manifest. Phase 06 added the table in migration 066 but did not update the export manifest. **Flag for Phase 08** (revoke/delete UX — that's where the GDPR manifest fanout naturally lands) or a standalone follow-up. |
| `src/__tests__/match-decisions-schema.test.ts` | 2 | Phase 5 migration 064/065 schema smoke — `match_decisions.original_strategy_id` column/index check. Either migration 064 didn't apply to the current live DB or the test's assertion is stale. |
| `src/__tests__/outcomes-join-rls.test.ts` | 1 | Phase 5 outcomes fan-out with nested match_decisions join. Depends on migration 064/065 columns the schema test above says are missing — cascade from the same root cause. |

**Plan 03 surface results (proven green against live DB on 2026-04-19):**
- `src/app/api/allocator/holdings/sync/route.test.ts` → 7/7 pass
- `src/__tests__/allocator-holdings-rls.test.ts` → 2/2 pass (anti-leak + skip-advertise)
- Combined plan 03 test surface: 9/9 pass.

**Recommended follow-up owner:**
- retention-crons / bridge-outcome-cron — Phase 05 or platform maintainer
- gdpr-export-coverage — Phase 08 (manage/revoke UX) adds allocator_holdings to the manifest
- match-decisions-schema + outcomes-join-rls — verify migration 064/065 applied to the live DB currently targeted by `.env.local`
