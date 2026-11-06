---
phase: 176-legacyretire-the-legacy-allocator-equity-curve-is-retired-an
plan: 09
subsystem: database
tags: [PR-2, D-04, migration, secdef-rpc, pg-lane, mutation-runner, legacy-retire, tdd]
status: complete

requires:
  - phase: 176-legacyretire
    provides: "plan 07: PR 1 live; plan 08: the reconstruct job kind finishes as a no-op in the worker"
provides:
  - "public.request_allocator_holdings_sync(uuid) re-based without the reconstruct gate and its guarded enqueue (D-04, enqueue path 2 of 3 stops)"
  - "a rollback file restoring the 20261014120000 body"
  - "the reconstruct-marker gate's R group rewritten for D-04 (R3 proves no reconstruct and one poll job; R4 re-pointed; R1, R2, R5 retired)"
  - "ARMS_FLOOR lowered 862 -> 859 with the reason written beside the constant"
affects: [176-10 (operator force path), 176-12 (cron unschedule, migration-reviewer + rls-policy-auditor)]

key-files:
  created:
    - supabase/migrations/20261103120000_request_allocator_holdings_sync_no_reconstruct.sql
    - supabase/migrations/down/20261103120000-rollback.sql
  modified:
    - supabase/tests/test_api_keys_history_reconstruct_marker.sql
    - supabase/schema/functions/request_allocator_holdings_sync.sql
    - src/app/api/allocator/holdings/sync/route.ts
    - scripts/mutation-floors.mjs
    - src/__tests__/mutation-runner-floors.test.ts
    - src/__tests__/mutation-annotation-parser.test.ts
    - src/__tests__/gate-family-meta.test.ts

key-decisions:
  - "D-04: the RPC loses the per-key reconstruct gate; the compute_job_kinds row, the marker column and the attempts column stay (inert)"
  - "The migration's verify block reads the catalogue only and asserts no body text, so each mutation twin is one edit and none can trip the verify"

actuals:
  tokens: 39000
  tasks: 3
  commits: 3
plan_head_before: 5813085814f6a649a79d9cc5cce76d10d53c507d
plan_head_after: 625cc6d1dea12ca0b395666ec06833ef783f14ef
---

# Phase 176 Plan 09: a holdings sync no longer enqueues a history reconstruct Summary

`request_allocator_holdings_sync(uuid)` is re-based in migration `20261103120000` on its newest definition and loses
the per-key reconstruct gate and its guarded enqueue. A first sync of a new key now enqueues its poll job and nothing
else; the RPC still answers `{ok, job_id}` or `{already_inflight, next_attempt_at}`. This stops enqueue path 2 of 3 in
D-04 (path 1, the cron, stops at plan 12; path 3, the operator force procedure, at plan 10).

## What changed

- `supabase/migrations/20261103120000_request_allocator_holdings_sync_no_reconstruct.sql` (new). Opens with
  `SET LOCAL lock_timeout = '3s'`, no BEGIN/COMMIT, schema-qualified `CREATE OR REPLACE`, `REVOKE ALL ... FROM PUBLIC,
  anon` and `GRANT EXECUTE ... TO authenticated` re-issued with the full signature, a rewritten COMMENT, and a
  catalogue-only `$verify$` block (one overload; prosecdef; proconfig exactly `search_path=public, pg_catalog`; no
  EXECUTE for PUBLIC via `aclexplode`, none for anon, EXECUTE for authenticated). It asserts no body text. No cron
  statement, no compute_job_kinds change.
- `supabase/migrations/down/20261103120000-rollback.sql` (new): the 20261014120000 body, ACL and comment back, with the
  note that the plan 08 stub turns any reconstruct it enqueues into a no-op, and that the ledger row stays.
- `supabase/tests/test_api_keys_history_reconstruct_marker.sql`: R3 rewritten, R4 re-pointed, R1, R2 and R5 retired,
  header (arm list, matched pairs, apply survival, interference walk) brought to 27 arms, the new migration appended
  last to `RED-UNDER-SETUP`.
- `supabase/schema/functions/request_allocator_holdings_sync.sql`: regenerated with `npm run schema:functions`.
- `src/app/api/allocator/holdings/sync/route.ts`: header item 5 now says the RPC has no exception handler since
  Phase 176 (D-04), so a 40001 aborts its own transaction. Comment only.
- `scripts/mutation-floors.mjs`: `ARMS_FLOOR` 862 -> 859 with the dated reason above it. `FILES_FLOOR` stays 83,
  `WAIVED_CEILING` stays 0.
- Census pins: `mutation-runner-floors.test.ts` (arms, biting, lane-invocations, per-file row 30 -> 27, mean line,
  `totalAnchored`, the derived mutated-log values), `mutation-annotation-parser.test.ts` (`armsSeen` 862 -> 859,
  `stepsSeen` and `needles.length` 981 -> 975), `gate-family-meta.test.ts` (`ARMS_FLOOR=859`).

## Re-base evidence

- Definer list (`grep -l 'FUNCTION public.request_allocator_holdings_sync' supabase/migrations/*.sql`):
  `20260422101911_api_keys_disconnected_at.sql`, `20260924233749_allocator_sync_restore_inflight_prefetch.sql`,
  `20261014120000_api_keys_history_reconstruct_marker.sql` (newest, the re-base source).
- `diff` of the old and new function bodies: 0 added lines, 38 removed lines (declarations, the gate comment, the
  existence probe, the marker read and fold, the guarded enqueue with its handler). Everything else is byte-identical.
- Outside comments, the old body names `reconstruct_allocator_history` / `v_prior_reconstruct` 6 times; the new one 0.
- Migration file name: `git ls-tree origin/main supabase/migrations/` newest was `20261102120000`; `20261103120000` was
  free, no rename.

## Verification (exact results)

- RED on the base body: gate with the new migration absent from the apply list, pg-lane: `TEST FAILED (R3): ... it
  answered {"ok": true, "job_id": ...} with 1 poll job(s) and 1 reconstruct job(s)`, exit 3.
- GREEN: gate with the new migration applied, every arm passed (`C1 through R4`), exit 0, no `TEST FAILED`.
- Narrowed mutation run on the gate: `arm R3 exit 3 RED (identity ok)`, `arm R4 exit 3 RED (identity ok)`; whole file
  `sections 27 / judged 27 / annotated 27 / waived 0 / biting 27`, `arms: 27/27/0`, no `no-red`,
  `occurrence-mismatch` or MEASURE_FAIL; "No defects in the narrowed scope".
- Hand drill: R3's twin edit applied by hand to a byte backup of the new migration, gate run: `TEST FAILED (R3)`, exit 3;
  migration restored from the backup, `cmp` exit 0.
- Rollback: applying the new migration then the rollback on the pg-lane exits 0 (its post-condition block passes).
- ONE full `node scripts/mutation-runner/run.mjs`, no file edited during it: `scope: FULL 83/83 annotated files`,
  `coverage: files 83/110`, `arms: 859/859/0`, `biting: 859`, `lane-invocations: 859 ... plus 83 baseline / 83 restore
  leg(s)` (tallies agree), `lane-blocked: 0`. The only defect, at the old floor, was `ARMS_FLOOR regression: 859
  biting arm(s) < floor 862`; the floor was then set to 859 from the run's number, not by subtraction.
- `node scripts/lint-migration-data-dependence.mjs --self-test` OK (5 refusals, red+green each); corpus run: 313
  migrations, 83 refusals, 83 allowlisted, **0 NEW**.
- `node scripts/lint-sql-gates.mjs`: 110 files scanned, 0 findings, 0 measure-fail, 0 allowlist error.
  `node scripts/lint-app-guc.mjs --self-test` OK; corpus `findings 0`.
- `npm run schema:functions:check` and `npx tsx scripts/dump-sql-functions.ts --check`: "SQL function snapshot is
  current (134 functions)".
- `npx vitest run` on mutation-runner-floors, mutation-annotation-parser, gate-family-meta, ci-anti-skip-gate.contract,
  lint-sql-gates, drift-check-scripts: **6 files passed, 1278 tests passed**. Also the route test
  (`src/app/api/allocator/holdings/sync/route.test.ts`): 11 passed.
- `npm run typecheck`: exit 0. `npm run lint`: exit 0 (0 errors, 2 pre-existing warnings in unrelated factsheet files).

## baseline-content-drift (expected, not cleared here)

`node scripts/baseline-content-drift-check.mjs` reports 4 findings: `DRIFT request_allocator_holdings_sync/1` (this
plan, the committed baseline dump still carries the 20261014120000 body) plus three from migration 20261102120000
(`DRIFT compute_bridge_outcome_deltas/0`, `SNAPSHOT_MISSING derived_account_return_over/3` and
`reset_holding_bridge_outcomes_to_derived_basis/0`, present before this plan). The gate's own message says the list may
only shrink and that a baseline regeneration from PROD clears the rows; that is the post-apply re-dump, not part of this
plan. No allowlist row was added.

## For the migration-reviewer and rls-policy-auditor (plan 12 Task 1)

Files to review before PR 2 merges:

- `supabase/migrations/20261103120000_request_allocator_holdings_sync_no_reconstruct.sql`
- `supabase/migrations/down/20261103120000-rollback.sql`

I could not read PROD, so whether PROD's live body of this function equals the committed baseline body (the
20261014120000 definition) is unmeasured here; the VAC-04 body gate on the migration PR measures it. No `prod-body-ack`
header was added because the re-base source is the newest repo definition.
CORRECTED 2026-11-01 (PR 2 review fix round 1): that sentence was wrong. VAC-04 compares the PROD body (the committed
baseline on main, hash `1f3190144ca0...`, which is the 20261014120000 body) against the body the migration overwrites,
and it goes RED without a `-- prod-body-ack:` pragma carrying that hash regardless of the re-base source. The pragma
is now in the migration header, measured with `node scripts/sql-body-normalize.mjs --diff-bodies` against
`origin/main:supabase/schema/baseline.sql` (the migration's own 20261014120000 predecessor reads MATCH at that hash).
The sentence above is kept as lineage.

## Deviations from Plan

None - plan executed as written. Three small notes:

- Task 1 also re-pointed R4's twin and wrote R3's `RED-UNDER` / `RED-UNDER-M` pair (the plan assigns them to Task 2),
  because Task 1's commit adds the new migration to `RED-UNDER-SETUP` and an arm with a placeholder annotation would
  have left that commit inconsistent. Task 2 then did the R1/R2 retirement, header and the narrowed run as planned.
- Task 3's census edits covered more lines than the plan named: the derived values inside the floors test (the
  mutated-log fixtures built from `GREEN_LOG`: 861/863 and 862/863 style numbers) and `stepsSeen` / `needles.length`
  in the parser test (-6 file steps), all found by running the census set and read from this run's numbers.
- `baseline-content-drift` is red at four rows for the reason above; the plan anticipated a body DRIFT row.

## CHANGELOG inputs

- Changed: a first holdings sync of a new key no longer enqueues a `reconstruct_allocator_history` job (Phase 176
  LEGACYRETIRE, D-04); it enqueues only its poll job. Migration `20261103120000`, rollback in `migrations/down`.
- Tests: three arms (R1, R2, R5) of `test_api_keys_history_reconstruct_marker.sql` retired because the per-key
  reconstruct gate they tested no longer exists; R3 rewritten to prove no reconstruct job, R4 re-pointed at the new
  migration. `ARMS_FLOOR` lowered 862 -> 859 with the reason beside the constant (`WAIVED_CEILING` stays 0).

## Known Stubs

None.

## Threat Flags

None. The threat register's mitigations are in place: ACL and `search_path` re-issued and verified (T-176-23), the
ownership and disconnected checks copied byte for byte (T-176-24, `rebase.diff` shows only removals), arm R3 asserts
zero reconstruct jobs and bites (T-176-25), the verify block is catalogue-only and the data-dependence lint reports 0 NEW
(T-176-26).

## Self-Check: PASSED

- FOUND: `supabase/migrations/20261103120000_request_allocator_holdings_sync_no_reconstruct.sql`
- FOUND: `supabase/migrations/down/20261103120000-rollback.sql`
- FOUND commits `4add324e0`, `8db1b3a3f`, `625cc6d1d` on `feat/176-legacyretire`; `git rev-list --count` from the plan
  base to HEAD before this file: 3.
