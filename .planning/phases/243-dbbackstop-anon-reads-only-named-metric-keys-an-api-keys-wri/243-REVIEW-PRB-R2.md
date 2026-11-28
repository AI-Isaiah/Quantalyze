---
phase: 243-dbbackstop-anon-reads-only-named-metric-keys-an-api-keys-wri
reviewed: 2026-11-27T18:57:47Z
depth: standard
scope: "plan 09, git diff 786f1c82e HEAD -- . ':!.planning'"
files_reviewed: 15
files_reviewed_list:
  - .github/workflows/ci.yml
  - TODOS.md
  - scripts/mutation-floors.mjs
  - scripts/pg-lane/fixtures/45-fixture-strategy-analytics-by-basis.sql
  - src/__tests__/contracts/ci-anti-skip-gate.contract.test.ts
  - src/__tests__/drift-check-scripts.test.ts
  - src/__tests__/gate-family-meta.test.ts
  - src/__tests__/lint-sql-gates.test.ts
  - src/__tests__/mutation-annotation-parser.test.ts
  - src/__tests__/mutation-runner-floors.test.ts
  - src/lib/anon-strategies-live-probe.test.ts
  - src/lib/factsheet/by-basis-projection.ts
  - supabase/migrations/20261127220000_strategy_analytics_anon_column_revoke.sql
  - supabase/migrations/down/20261127220000-rollback.sql
  - supabase/tests/test_strategy_analytics_anon_grants.sql
findings:
  critical: 0
  warning: 0
  info: 3
  total: 3
  necessity: 0
status: issues_found
---

# Phase 243: Code Review Report (PR-B, plan 09, round 2)

**Reviewed:** 2026-11-27T18:57:47Z
**Depth:** standard
**Files Reviewed:** 15
**Status:** issues_found (Info only; **no MEDIUM or higher finding**)

## Summary

I reviewed the plan 09 diff: the anon column revoke migration and its rollback, the new SQL gate with
seven twinned arms, pg-lane fixture 45, the anon live-probe arms (r), (s) and (t) with the moved
`api_keys` seed, the census and floor moves, and the deletion of TODOS `RANK-SPLAT-01`. I found no
correctness, security or data-integrity defect at MEDIUM or above. I checked each focus area against
the code or a run I did myself, not against the SUMMARY's claims.

**Gate arms: each one can fail and tests the right thing.**
- I ran `node scripts/mutation-runner/run.mjs --file supabase/tests/test_strategy_analytics_anon_grants.sql`
  myself. Baseline exit 0, and all 7 arms went `RED (identity ok)`: `arms: 7/7/0`, `biting: 7`,
  `lane-invocations: 7`.
- I also ran pg-lane with the gate's fixtures (01, 02, 03, 45) and without the migration. It went RED
  on `TEST FAILED (GRANT 1)`, so "RED without the migration" is real and not a skip.
- GRANT 2 and GRANT 4 neuter GRANT 1 correctly. Both of their twins hand the column back, which GRANT 1
  would catch first.
- WRITE 2 reads `has_any_column_privilege`. A column-level grant is invisible to WRITE 1's table-level
  sweep, so this arm is needed.
- GRANT 3-SETUP stops the column sweep from passing on an empty column set.
- The GRANT 4 assertions are read after `RESET ROLE`, which keeps lint rule R1 satisfied.

**Census numbers agree with each other.** I re-measured each one.
- `--parse-only` printed `coverage: files 100/127`, `arms: 0/1117/0` and `No static defects`. That
  matches `FILES_FLOOR = 100` and `ARMS_FLOOR = 1117` in `scripts/mutation-floors.mjs`, the
  gate-family-meta keys, `armsSeen`, `totalAnchored`, `filesTotal`, `filesAnnotated` and every
  synthetic GREEN_LOG literal (1117 and 100/100, with offsets 1116 and 1118).
- The `ARMS_FLOOR=627` comment in `ci.yml` is a 42-term derivation sum. It evaluates to 627 (checked
  with `bc`), and 42 terms equals `SENTINEL_FLOOR=42`.
- `okCount` = 2 is right. Exactly two `supabase/tests` files print `ALL 7 ARMS EXECUTED`:
  `test_sync_status_curated_sentence_survives.sql` and the new gate. The `ci.yml` sentinel check greps
  each file's own `$out`, so the two files sharing the same text cannot mask each other.
- I ran the census test files: `ci-anti-skip-gate.contract`, `mutation-runner-floors`,
  `mutation-annotation-parser`, `gate-family-meta` and `lint-sql-gates` (369/369 passed), plus
  `drift-check-scripts -t OPS-08-F9` (passed).
- Linters: `lint-sql-gates` printed `scanned 127 file(s); 0 finding(s)`, and
  `lint-migration-data-dependence` printed `0 NEW`.

**Anon probe assertions.**
- (r) and (s) require a non-null error, code `42501`, the message
  `permission denied for table strategy_analytics` and `data === null`. PostgreSQL reports a
  column-privilege failure at table level, so the message pin is correct.
- (t) reads granted columns of the published row and pins `sharpe === 1`, the i=0 seed value.
- The seed now goes through `createTestApiKey` (the `insert_api_key` RPC). Cleanup still deletes it by
  id, and the user_id immutability trigger does not block deletes.

**No direct `api_keys` insert is left in the client-role corpus.** I scanned `src`, `e2e`, `scripts`,
`tests`, `tools` and `analytics-service` with node for `.from/.table("api_keys").insert|upsert(` and
for SQL `INSERT INTO api_keys`. Three kinds of hit remain:
- **Comments and mocks.** `validate-and-encrypt/route.ts:740` is a lineage comment. `route.test.ts`,
  `StrategyForm.test.tsx` and `sec-005-api-keys-projection.test.ts` are a mock, a recorder and doc
  text. `test_walletoffset_probe.py:1756` writes to an in-memory fake.
- **SQL run as `postgres`.** The `supabase/tests` gates, the `*-sql-exec` vitest files, pg-lane
  fixture 25, and the Python lane tests `test_csv_daily_returns_*_live.py` and
  `test_trigger_rls_audit.py`. All of them run as `postgres` on a lane DSN, which the CONTEXT's
  allow-list fence (`current_user IN ('postgres','supabase_admin')`) admits.
- **The e2e seed** already uses `insertApiKeyViaRpc`.

**Outage risk of the revoke.**
- **TS readers.** No anon-client reader selects `metrics_json_by_basis` or `strategy_analytics (*)`.
  `getMyStrategies` is owner-scoped and authenticated. The payload builder and the OG route use
  `createAdminClient`.
- **Database objects.** In `baseline.sql`, the only SECURITY INVOKER function that touches the table
  is `apply_okx_archive_rebuild`, and only service_role can execute it. The only view over the table
  is `ledger_refresh_staleness`, granted to service_role only. No realtime subscription targets the
  table.
- **Grant shape.** The PROD grant line in the baseline (`SELECT,INSERT,REFERENCES,DELETE,UPDATE` to
  anon, no TRUNCATE or TRIGGER) matches fixture 45. The migration's self-check covers every verb anon
  held. The migration matches the shape of the `20261022120000` strategies precedent.

## Info

LOW/Info findings are recorded here only and not booked in `TODOS.md` (CLAUDE.md rule (a)).

### IN-01: GRANT 4's positive half has no twin that reaches it first

**File:** `supabase/tests/test_strategy_analytics_anon_grants.sql:171`
**Issue:** The `v_state_ok IS NOT NULL` raise (a granted-column read refused) belongs to arm GRANT 4.
That arm's only twin re-grants the hidden column, which hits the denial half. Every column-revoke
mutation trips GRANT 3 (the catalogue sweep) first, so this second raise site has never been shown
able to bite by itself. A refusal that the catalogue does not see, such as an RLS-policy subquery
error, can still reach it, so the branch is not dead. The strategies precedent gate has the same
shape.
**Fix:** Optional. Add a twin that breaks the behavioural read without touching the column ACL, and
neuter GRANT 3 if it is needed. Alternatively, leave the branch as is and accept it as covered by
GRANT 3.

### IN-02: CURRENCY lineage out of order in the totalAnchored block

**File:** `src/__tests__/mutation-runner-floors.test.ts:777-778`
**Issue:** The plan 09 note (1110 -> 1117) sits above the WR-02 note (1099 -> 1100). The block has
no 1100 -> 1110 (Phase 242) note, so the lineage jumps from 1099 -> 1100 to 1110 -> 1117. Only the
comments are affected; the asserted value 1117 is right.
**Fix:** Move the plan 09 line below the WR-02 line and add the Phase 242 step if anyone wants the
lineage complete.

### IN-03: The probe comment credits the wrong mechanism with anti-vacuity

**File:** `src/lib/anon-strategies-live-probe.test.ts:218-219`
**Issue:** The comment says the non-null `metrics_json_by_basis` seed means "an anon refusal of the
column cannot pass for an empty read". Arms (r) and (s) assert `error !== null`, and an empty read
returns no error, so they would fail on an empty read with or without the seed. What shows they can
fail is the measured anti-vacuity run (a temporary table-level GRANT turned exactly (r) and (s) red).
The seed only matters if a later arm asserts on returned data.
**Fix:** Optional. Reword the comment to say the seed makes a re-granted column return real data.

---

_Reviewed: 2026-11-27T18:57:47Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_

## Other lanes on the plan 09 diff (2026-11-27)
- migration-reviewer: CLEAN (0 findings; `lint-migration-data-dependence` 0 NEW).
- rls-policy-auditor: CLEAN (0 findings, no new leak scope; the authenticated non-owner read is the CONTEXT-deferred known limit).
- silent-failure-hunter: 0 MEDIUM+; LOW only (house `skipIf` pattern for unprovisioned runs, default-deny for future columns, REFERENCES not asserted, O-1 ordering is operational: the orchestrator measured PR-A's Production deploy `success` before plan 09 ran).
- Orchestrator PROD read (marker first): the only view over `strategy_analytics` is `ledger_refresh_staleness`, security_invoker, anon has no SELECT on it, and it does not reference `metrics_json_by_basis`.
