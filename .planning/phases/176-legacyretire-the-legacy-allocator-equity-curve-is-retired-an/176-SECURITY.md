---
phase: "176"
slug: legacyretire-the-legacy-allocator-equity-curve-is-retired-an
status: verified
# threats_open = count of OPEN threats at or above workflow.security_block_on severity (the blocking gate)
threats_open: 0
asvs_level: 1
created: "2026-11-03"
---

# Phase 176 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.
> Register authored at plan time (17 plans). Audited at the head of `feat/176-legacyretire`, whose non-planning tree equals the merged PR 3 squash (differences: CHANGELOG, TODOS, VERSION, the package.json version line). Block threshold: high.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| operator shell -> PROD | rendered runbook forms run through the PROD-linked CLI | SQL read forms; three guarded write forms |
| readings -> public repo | SUMMARY files, runbook and ledgers are tracked in a public repo | counts, booleans, dates, object names only |
| merge -> PROD schema | migrations auto-apply after the TEST apply, no human stop; the drop is one-way | DDL |
| worker-written JSONB -> SQL batch | the derived payload is untrusted input to a SECURITY DEFINER batch | JSONB payload |
| authenticated user -> SECURITY DEFINER RPC | `request_allocator_holdings_sync`, `delete_allocator_api_key` run as owner on a user call | key ids, ownership checks |
| owner-scoped reads -> payload / browser | book membership and dashboard payload built server-side from owner-RLS reads | allocator book data |
| compute_jobs queue -> worker | a queued row of a retired kind reaches dispatch | job kind and id |
| worker code -> PROD database / PostgREST | after PR 3 the replace RPCs and the table no longer exist | table and RPC names |
| data subject -> GDPR export; CI checker -> manifest | the coverage gate decides what a data subject receives | user-owned table set |
| runbook -> operator -> PROD cron.job / TEST | a hand-run write to pg_cron; shared TEST | cron job rows |
| test suite / fixtures -> CI verdict | fixtures and the coverage floor decide what CI proves | test code |

---

## Threat Register

Evidence marked "recorded reading" is a value taken from a SUMMARY, the runbook or the committed PROD baseline dump. The auditor queried no database.

| Threat ID | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-176-01 | Spoofing | a form run on TEST/dashboard and reported as PROD | high | mitigate | `marker_is_prod` first column of every PROD read form; write forms refuse with `IS DISTINCT FROM __MARKER__`, marker from the manifest (runbook `docs/runbooks/legacyretire-go-live.md`; pin `src/__tests__/legacyretire-runbook-forms.test.ts`) | closed |
| T-176-02 | Tampering | a write slipping into a read form | high | mitigate | pin test fixes the exact form set and refuses write keywords in read forms; write forms are compare-and-set guarded | closed |
| T-176-03 | Information disclosure | ids, amounts, paths in tracked text | medium | mitigate | pin test refuses uuids, home paths and planning paths; 0 uuid / 0 home path across runbook, 17 SUMMARYs and the lines the three PRs added | closed |
| T-176-04 | Information disclosure | `derived_account_return_over` called directly | high | mitigate | SECURITY INVOKER; REVOKE from PUBLIC/anon/authenticated by full signature; verify asserts it; arms C1, C1b-C1d (`supabase/tests/test_bridge_outcome_deltas_derived.sql`); PROD dump grants service_role only | closed |
| T-176-05 | Denial of service | malformed or aged derived row aborts the daily batch | high | mitigate | text date matching, `jsonb_typeof` guards, window conjunct; arms B5a-g, G1, G2, G2b, R3 each with a RED-UNDER mutation | closed |
| T-176-06 | Tampering | reset widening to strategy/voluntary/rejected rows | high | mitigate | reset population equals holding candidates; arm R2 goes RED when the EXISTS is deleted | closed |
| T-176-07 | Denial of service | data-reading verify block refusing on empty TEST | high | mitigate | catalogue-only `$verify$`; data-dependence lint re-run by auditor: 314 migrations, 0 NEW | closed |
| T-176-08 | Elevation of privilege | ACL drift on CREATE OR REPLACE | medium | mitigate | REVOKE/GRANT re-issued with full signatures; verify asserts no anon/authenticated EXECUTE; recorded PROD ACL service_role only. See evidence gap 1 | closed |
| T-176-09 | Information disclosure | a key outside the owner's set entering the book | medium | mitigate | set is `eligibleKeyIds` from the owner's own RLS-scoped read; userId equals auth.uid() backstop; test `T-176-09` in `src/lib/queries.my-allocation.test.ts` | closed |
| T-176-10 | Repudiation | link-read failure silently changing membership | low | accept | membership no longer depends on link reads; failure only warns to Sentry | closed (accepted) |
| T-176-11 | Repudiation | a skipped live test counted as a pass | medium | mitigate | local skip recorded as skip; CI `frontend-live-db-lane` on PR 1's head SHA concluded success with the file's 4 tests passed, not skipped | closed |
| T-176-12 | Information disclosure | real ids in the live test or docs | low | mitigate | synthetic placeholder ids and run-day-relative dates; no uuid in runbook or docs | closed |
| T-176-13 | Tampering | false 30-day countdown over a held-back history | medium | mitigate | `snapshotCount` null unless ready; KpiStrip null guard; tests N and O in `KpiStrip.warmup.test.tsx` | closed |
| T-176-14 | Information disclosure | removal widening what the payload carries | low | accept | PR 1 and PR 3 `queries.ts` diffs add no `.from`, `.rpc`, `.select` or admin-client line | closed (accepted) |
| T-176-15 | Repudiation | sweep weakening assertions to get green | medium | mitigate | SUMMARY 06 lists deleted/rewritten tests; no `as any`, ts-expect-error, ts-ignore or eslint-disable added by the three PRs | closed |
| T-176-16 | Spoofing | a TEST reading reported as PROD (plan 07) | high | mitigate | recorded reading: `marker_is_prod=1` on every PROD session (SUMMARY 07); pin enforces marker column first | closed |
| T-176-17 | Tampering | unreviewed migration applied to PROD by merge (PR 1) | high | mitigate | lint 0 NEW; VAC-04 `prod-body-ack`; catalogue-only verify; TEST apply first; 3-round review `176-REVIEW.md`. See evidence gap 1 | closed |
| T-176-18 | Information disclosure | ids/amounts in SUMMARYs | medium | mitigate | SUMMARY 07, 12, 16 hold counts only; no uuid or home path in any SUMMARY | closed |
| T-176-19 | Denial of service | merge during derive/bridge window | low | mitigate | merge hold 00:30Z-03:45Z in the runbook; the three PR merges landed at 20:38Z, 16:02Z and 20:24Z, outside it | closed |
| T-176-20 | Tampering | straggler job writing legacy rows | medium | mitigate | both kinds route to `run_retired_allocator_equity_job` (`analytics-service/services/job_worker.py`); tests patch `get_supabase` to raise; passed | closed |
| T-176-21 | Denial of service | retired-kind rows becoming failed_final noise | low | mitigate | stub returns DONE; no phase migration touches `compute_job_kinds` | closed |
| T-176-22 | Information disclosure | stub log carrying an allocator/key id | low | mitigate | log names only kind and job id; caplog test asserts allocator id absent | closed |
| T-176-23 | Elevation of privilege | ACL/search_path drift on re-based SECDEF RPC | high | mitigate | `20261103120000_request_allocator_holdings_sync_no_reconstruct.sql`: SECDEF + search_path pin, REVOKE/GRANT, verify of proconfig and ACL; recorded PROD ACL authenticated + service_role only | closed |
| T-176-24 | Spoofing | caller syncing another user's key | high | mitigate | ownership and disconnected checks unchanged; auditor diff against prior definer shows removals only | closed |
| T-176-25 | Tampering | hidden reconstruct enqueue surviving re-base | medium | mitigate | no enqueue in body or schema snapshot; arm R3 re-inserts it as its mutation and goes RED | closed |
| T-176-26 | Denial of service | data-reading verify block blocking PROD apply | high | mitigate | catalogue-only verify; lint 0 NEW | closed |
| T-176-27 | Tampering | refresh cron re-created from an old rollback form | medium | mitigate | RETIRED banners on both chain-move runbooks; `reschedule-refresh` form refuses once the fan-out function is gone; pinned | closed |
| T-176-28 | Repudiation | forced rebuild enqueued from old runbook read as done | low | mitigate | banner on `marksource-okx-history-correction.md`; stub logs kind and id. Note: banner says no-op, code now fails a `force_rebuild` row permanent (stricter) | closed |
| T-176-29 | Denial of service | surviving Python caller of a dropped RPC | high | mitigate | `test_the_legacy_writers_are_gone` and whole-service pin `test_legacy_table_not_named.py` pass (7 passed); auditor AST scan: 155 files, 0 offences; mypy strict recorded | closed |
| T-176-30 | Denial of service | deleting a symbol another module imports | high | mitigate | worker import smoke passed in audit; SUMMARY 17 records full suite under CI flags (13124 passed, 94.45% coverage, mypy clean) | closed |
| T-176-31 | Repudiation | test deletions hiding a regression | medium | mitigate | SUMMARY 17 lists removed tests of surviving code; all ten keep-list survivors present | closed |
| T-176-32 | Tampering | unscheduling the wrong job / wrong database | high | mitigate | `unschedule-refresh` DO guard: marker, exactly one job, compare-and-set on schedule and command, by name, read-back; recorded read-back (SUMMARY 12): marker PROD, 0 refresh jobs, 3 other jobs | closed |
| T-176-33 | Spoofing | TEST reading reported as PROD or reverse | high | mitigate | recorded reading: marker form first for PROD and TEST sessions (SUMMARY 12) | closed |
| T-176-34 | Tampering | unreviewed SECDEF re-base applied to PROD (PR 2) | high | mitigate | review recorded in SUMMARY 12 and `176-PR2-REVIEW.md` (HIGH VAC-04 finding fixed); lint 0 NEW; post-apply body-check recorded | closed |
| T-176-35 | Repudiation | manifest edited by hand to hide drift | medium | mitigate | commit changes only `captured_at` plus the one removed refresh job object; current manifest has 0 occurrences | closed |
| T-176-36 | Denial of service | `delete_allocator_api_key` failing on 42P01 after drop | high | mitigate | RPC re-based before `DROP TABLE` in `20261104120000_drop_allocator_equity_snapshots.sql`; verify catches any function still naming the table; atomicity test Parts 1 and 3; PROD dump carries new body | closed |
| T-176-37 | Tampering | missed dependent silently dropped | high | mitigate | no CASCADE, no IF EXISTS; recorded R5 preflight `dependent_objects` 0; TEST apply succeeded first | closed |
| T-176-38 | Elevation of privilege | ACL/search_path drift on re-based delete RPC | high | mitigate | REVOKE/GRANT re-issued; verify asserts SECDEF, pin, lock_timeout, ACL; PROD dump authenticated + service_role only; `176-PR3-REVIEW.md` rounds 1 and 3 reviewers clean | closed |
| T-176-39 | Denial of service | refresh cron calling the dropped fan-out | medium | mitigate | recorded reading: `cron_jobs_naming_table_or_fanout` 0 before merge, 3 jobs after (SUMMARY 16) | closed |
| T-176-40 | Information disclosure | rows surviving in a rollback | low | accept | rollback re-creates an empty table only (`supabase/migrations/down/20261104120000-rollback.sql`) | closed (accepted) |
| T-176-41 | Information disclosure | user-owned table silently leaving GDPR export | high | mitigate | `scripts/check-gdpr-export-coverage.ts` applies CREATE/DROP in file order, a later CREATE re-requires the table; fixtures A-C; checker passes with 25 tables; drill recorded (SUMMARY 14) | closed |
| T-176-42 | Tampering | EXCLUDED_TABLES shortcut | medium | mitigate | PR 3 diff adds no EXCLUDED_TABLES key | closed |
| T-176-43 | Denial of service | export route failing on dropped-table manifest entry | high | mitigate | manifest entry and order override removed together; checker passes | closed |
| T-176-44 | Denial of service | re-introduced read/write of the dropped table | medium | mitigate | whole-service constant pin passes; drill recorded (SUMMARY 15) | closed |
| T-176-45 | Repudiation | TODOS closed before the PROD apply is true | low | mitigate | closures name migration `20261104120000` and say closed by its PROD apply; R6 reading in SUMMARY 16 | closed |
| T-176-46 | Information disclosure | ids/amounts in the public ledger | low | mitigate | no uuid or home path in added TODOS lines | closed |
| T-176-47 | Tampering | irreversible drop on an unexpected PROD state | high | mitigate | R5 stop rules in runbook; recorded preflight, `dependent_objects` 0, cron 0 (SUMMARY 16); no CASCADE; TEST first | closed |
| T-176-48 | Repudiation | dropped rows leaving no record | medium | mitigate | SUMMARY 16 records row count, allocator count, oldest/newest dates | closed |
| T-176-49 | Spoofing | TEST reading reported as PROD (plan 16) | high | mitigate | recorded reading: marker form first naming PRODUCTION on each PROD session (SUMMARY 16) | closed |
| T-176-50 | Information disclosure | ids/amounts in plan 16 SUMMARY | medium | mitigate | counts and dates only; uuid grep empty | closed |
| T-176-51 | Tampering | D-04 inert helpers deleted | medium | mitigate | `test_the_d04_inert_helpers_stay` passes; byte-identity of ten keep-list defs recorded | closed |
| T-176-52 | Repudiation | completed phases' tooling removed unseen | medium | mitigate | founder go recorded as D-08 in `176-CONTEXT.md`; removed tooling listed in SUMMARY 11; TODOS entry `176-RECONSTRUCT-CAP-MARKER-INERT` | closed |
| T-176-53 | Repudiation | text reader left pointing at deleted code | medium | mitigate | SUMMARY 17 handles each reader by name; drills A and B went RED and were restored | closed |
| T-176-54 | Denial of service | python job coverage floor failing PR 2 | medium | mitigate | full suite with CI flags and `--cov-fail-under=80` at 94.45%; no threshold edited | closed |
| T-176-SC | Tampering | npm/pip/cargo installs (identical in all 17 plans) | low | accept | no dependency added: package.json changes only the version line; no lockfile, requirements or pyproject touched | closed (accepted) |

*Status: open · closed · open — below high threshold (non-blocking)*
*Severity counts: 23 high, 20 medium, 11 low, plus T-176-SC (low). Total 55, closed 55, open 0.*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-176-01 | T-176-10 | A link-read failure only warns to Sentry and changes no book membership. | plan-time disposition (accept), re-checked at audit | 2026-11-03 |
| AR-176-02 | T-176-14 | Only fields were removed; PR 1 and PR 3 add no read. | plan-time disposition (accept), re-checked at audit | 2026-11-03 |
| AR-176-03 | T-176-40 | The rollback re-creates an empty table only; the pre-drop row count is recorded, the rows are not. | plan-time disposition (accept), re-checked at audit | 2026-11-03 |
| AR-176-04 | T-176-SC | The phase installs no package. | plan-time disposition (accept), re-checked at audit | 2026-11-03 |

---

## Evidence Notes (non-blocking)

1. **T-176-08 and T-176-17, PR 1 migration `20261102120000`.** SUMMARY 07 states the migration-reviewer and rls-policy-auditor verdicts for this migration were not written to any tracked record. Both threats are closed on direct inspection (ACL, search_path, SECURITY INVOKER and catalogue-only verify in the migration; PROD ACL in the committed baseline dump; lint 0 NEW; the 3-round review in `176-REVIEW.md`; a successful TEST apply before the PROD apply). The closure rests on this audit, not on the two reviewers' verdicts. PR 2 (T-176-34) and PR 3 (T-176-38) have reviewer records.
2. **Recorded readings, not observed by the audit:** T-176-16, 19, 32, 33, 37, 39, 45, 47, 48, 49.
3. **Outside the register (recorded, not blocking):** SFH-1 (the drop migration does not check cron; consistent with D-04; PROD and TEST read 0 such jobs); after a last-key hard delete, rows of other kinds can survive (`key_capture:` booked as `167.1.2.2.1-KEY-CAPTURE-ORPHAN`) and a one-round-trip window exists where a running compose could re-upsert a curve. MD-01/SFH-2 and CR-01 were fixed.

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-11-03 | 55 | 55 | 0 | gsd-security-auditor (sonnet), orchestrated by /gsd-secure-phase |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-11-03
