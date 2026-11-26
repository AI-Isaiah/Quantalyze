---
phase: 225-oneaccountonce-a-user-cannot-connect-the-same-exchange-accou
plan: 10
subsystem: database-identity
tags: [account-identity, mt5, venue-server, unique-index, reconnect, conn-03, once-02, migration-b]
requires:
  - phase: 225-07
    provides: app-layer wildcard fences
  - phase: 225-12
    provides: the poll's server backfill and the gate-A5 census runbook
provides:
  - api_keys_user_exchange_venue_account_uniq keyed on (user_id, exchange, venue_account_id, COALESCE(venue_server, '')), same name, same predicates
  - reconnect_allocator_api_key refuses only a live same-owner sibling that reads the same account by the wildcard rule
affects: [225 PR-3]
tech-stack:
  added: []
  patterns: [catalogue-only self-verify, CREATE OR REPLACE re-based on the latest body with the ACL pair re-issued]
key-files:
  created:
    - supabase/migrations/20261125083433_api_keys_venue_server_index.sql
    - supabase/migrations/down/20261125083433-rollback.sql
  modified:
    - supabase/schema/functions/reconnect_allocator_api_key.sql
    - supabase/tests/test_api_keys_venue_identity_uniq.sql
    - supabase/tests/test_api_keys_account_identity.sql
    - scripts/accounttruth-census.mjs
    - src/__tests__/accounttruth-census.test.ts
    - scripts/mutation-floors.mjs
    - src/__tests__/gate-family-meta.test.ts
    - src/__tests__/mutation-runner-floors.test.ts
    - src/__tests__/mutation-annotation-parser.test.ts
key-decisions:
  - "The placeholder 20261126120000 became 20261125083433 (UTC time when Task 1 ran). It is later than origin/main's newest migration and the PROD ledger tip, both 20261124120700 (PROD tip read 2026-11-25)."
  - "baseline-content-drift reports a DRIFT row for reconnect_allocator_api_key/1 until the next re-dump after the PROD apply. It is expected and is not allowlisted."
requirements-completed: [CONN-03, ONCE-02]
status: complete
actuals:
  tasks: 4
  commits: 3
---

# Phase 225 Plan 10: Migration B, the identity index gains the server member

The unique identity index keeps its name and both predicates and now keys on the broker server too, so the same MT5 login on two servers never collides. Reconnect agrees with it by the wildcard rule. Gate A5 passed on PROD.

## Tasks

- **Task 1 (tracer), commit dce263327.** Migration `20261125083433_api_keys_venue_server_index.sql` rebuilds `api_keys_user_exchange_venue_account_uniq` with `COALESCE(venue_server, '')` as its fourth key, re-bases `reconnect_allocator_api_key` on `20260925120000` with the wildcard in its live-sibling EXISTS, re-issues the ACL pair, and self-verifies from the catalogue only. Manual rollback in `down/20261125083433-rollback.sql`. The uniqueness gate's arm 2 asserts the 4-key expression shape (`indnkeyatts`), and five new behavioural arms (6s-null-null, 6s-two-servers, 6s-same-server, 6s-null-vs-set, 6s-two-owners) each bite under a twin.
- **Task 2, commit ac341adbf.** The five existing RECON twins now edit the migration B body. Three new arms (RECON-server-other, RECON-server-null, RECON-server-keynull) pin the wildcard rule; review fix WR-01 added a fourth, RECON-server-same, for its equality leg. The census fixture index matches the new definition and gains `venue_server`.
- **Task 3, commit 402a8630d.** Census values moved by measurement. The previous phase agent wrote most of this before the machine restart; this run finished it (the two per-file rows in the synthetic FULL log) and committed it.
  - `ARMS_FLOOR` 1020 -> 1029 (`scripts/mutation-floors.mjs`; 1028 at this commit, +1 for the review fix WR-01 arm RECON-server-same), `FILES_FLOOR` stays 93, `WAIVED_CEILING` stays 0.
  - `gate-family-meta.test.ts` registry entry `ARMS_FLOOR=1029`.
  - `mutation-runner-floors.test.ts`: `totalAnchored` 1029; synthetic FULL log arms/biting/lane-invocations/mean 1029 and derived offsets 1028/1030; per-file rows `test_api_keys_account_identity.sql` 41 -> 45 (sections 45) and `test_api_keys_venue_identity_uniq.sql` 14 -> 19 (sections 12 -> 17).
  - `mutation-annotation-parser.test.ts`: `armsSeen` 1020 -> 1029, `stepsSeen` 1171 -> 1175, `needles.length` 1171 -> 1175, the values the test reported.
- **Task 4 (gate A5).** Run by the phase agent on PROD, read-only, below.

## Runner records (PROOF-01)

- `node scripts/mutation-runner/run.mjs --parse-only`: `coverage: files 93/120`, `arms: 0/1029/0`, `No static defects`.
- `--file supabase/tests/test_api_keys_venue_identity_uniq.sql` (exit 2 by design): `arms: 19/19/0`, `biting: 19`, `lane-invocations: 19`, every arm `RED (identity ok)`, `No defects in the narrowed scope.`
- `--file supabase/tests/test_api_keys_account_identity.sql` (exit 2 by design): `arms: 45/45/0`, `biting: 45`, `lane-invocations: 45`, 45 arms `RED (identity ok)`, `No defects in the narrowed scope.`
- `node scripts/lint-sql-gates.mjs`: 120 files, 0 findings.
- `node scripts/lint-migration-data-dependence.mjs`: 83 refusals, 83 allowlisted, 0 NEW.
- `npm run schema:functions:check`: snapshot current (142 functions).
- `node scripts/baseline-content-drift-check.mjs`: findings 1, the expected DRIFT row for `reconnect_allocator_api_key/1`. Not allowlisted; it clears at the next re-dump after the PROD apply.
- Census vitest set (4 files, 336 tests) and `accounttruth-census.test.ts` (54 tests) green.

## Gate A5

Run 2026-11-25 through the PROD Supabase MCP, one read-only query per call, never chained.

1. Marker: answered the PRODUCTION marker (`⛔ PRODUCTION — real customer data. ...`), first, before any census query.
2. PR-2 deploy time: PR-2 (`576ab6e4f`) went live on the `quantalyze-analytics` Railway service at 2026-11-24T15:28:33Z, the moment the previous deployment was removed. Used for the `{{PR2_DEPLOYED_AT}}` token.
3. Census 1 (live active MT5 keys with no server, by cause class): **zero rows. PASS.** Context count: 11 of 11 live active MT5 keys carry a server.
4. Census 2 (a poll after the PR-2 deploy): `newest_mt5_last_sync_at` 2026-11-25 01:09:01Z, `a_poll_ran_after_deploy` **true. PASS.**
5. 155.2 freeze: neither `155.2-12-SUMMARY.md` nor `155.2-14-SUMMARY.md` exists, so the plan-12 SUMMARY is absent and the freeze allows PR-3. Re-check before PR-3 merges.

The former same-owner-groups census was dropped in review (WR-05, commit 2d5286599) because the live unique index makes it unable to return a row.

## Ship note for PR-3

The ship deletes `TODOS.md` entry A-3 (`venue_account_id` is the MT5 login alone) and names it in the CHANGELOG entry. Before merge: migration-reviewer and rls-policy-auditor clean at MEDIUM+, and no other open PR touches `supabase/migrations`. After merge: read the index definition from `pg_indexes` and the reconnect body from `pg_proc` on PROD and record both.

## Hold (2026-11-25)

PR-3 is held on review finding CR-01 (`225-REVIEW-PR3.md`). After the index admits one owner's same login on two servers, the derive's login-only identity token refuses that owner's book. CONN-03 is complete at the index and at reconnect, but it must not ship until the same-owner readers are server-aware. That change needs a founder rule for a NULL-server key on a login with two or more set servers. Re-run four checks before PR-3 opens: the migration-name rule, gate A5, the 155.2 freeze, and the check for open PRs touching migrations.

## Rename (2026-11-26, plan 225-19)

Migration B and its rollback were renamed from `20261125083433` to `20261126102346` (UTC at the rename, later than every migration on origin/main at v0.133.89.0) so the migration-policy backdated-addition gate passes once plans 13 and 16 apply to PROD. The old name stays above as lineage; every non-planning reference moved in the same merge.

## Second rename (2026-11-26, plan 225-19 round 2)

Migration B and its rollback were renamed again, from `20261126102346` to `20261126140500`. origin/main then carried `20261126140000_mt5_terminal_lease.sql`, a future-dated name, so no honest current UTC sorted after it before 14:00Z. The name only has to sort after every migration on main and the PROD ledger tip (the allowlist is never used). Every non-planning reference moved in the same commit.
