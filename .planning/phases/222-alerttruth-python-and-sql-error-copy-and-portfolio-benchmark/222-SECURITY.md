---
phase: "222"
slug: "alerttruth-python-and-sql-error-copy-and-portfolio-benchmark"
status: secured
verdict: SECURED
# threats_open = count of OPEN threats at or above workflow.security_block_on severity (the blocking gate)
threats_total: 14
threats_closed: 14
threats_open: 0
asvs_level: 1
block_on: high
created: "2026-11-25"
audited_at_sha: "a6d13c9c8"
audited_range: "017ba2e08..a6d13c9c8 (code, excluding .planning)"
---

# Phase 222 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.
> Verification method: each declared mitigation was located in the implemented code (or, for `accept`, in the accepted-risks log below). Plan text, SUMMARY text and review prose were not taken as evidence.
> Threat IDs: T-222-01 to T-222-13 are unique to one plan each. `T-222-SC` is registered in all four plans with the same text and disposition, so it is counted once (14 unique threats).

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| repo migration -> shared TEST, then PROD | Auto-applied on merge with no human gate; the migration self-verify is the last automated stop | Function body and ACL for `computation_error_copy` |
| status bridge -> `strategy_analytics.computation_error` | The bridge writes `computation_error_copy(kind)` into a column the strategy owner reads | Five fixed sentences, selected by an error kind |
| analytics-service -> HTTP bodies and `strategy_analytics.computation_error` | Five Python user strings reach the account holder | Fixed sentences |
| analytics-service -> `portfolio_analytics.benchmark_comparison` / `data_quality` (JSONB) | Fixed benchmark notes reach the account holder | Fixed sentences; operator-only `benchmark_error` |
| worker (service role) -> compute_jobs mark RPCs -> status bridge -> `strategy_analytics` | The handler outcome decides what the owner's row reads, with no user present | Job outcome, `error_kind`, `error_message` -> `last_error` |
| live test -> lane database | The test writes rows and must never reach shared TEST or PROD | Throwaway user, strategy and job rows |

---

## Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation (evidence in code) | Status |
|-----------|----------|-----------|----------|-------------|-------------------------------|--------|
| T-222-01 | Information disclosure | `computation_error_copy` | medium | mitigate | Body is a single `CASE p_error_kind` over five string literals (permanent, transient, unknown, orphaned, ELSE) with no concatenation, `format` or interpolation. Signature `(p_error_kind TEXT) RETURNS TEXT`, `IMMUTABLE`, no `STRICT` keyword (NULL reaches ELSE), `SET search_path = pg_catalog`: `supabase/migrations/20261127120000_computation_error_copy_contact_form.sql:89-93`. Self-verify asserts every arm by literal and `computation_error_copy(NULL)` for ELSE (same file, `DO $verify$` block, from :159). Both curated and marked-refresh SQL gates load the new migration and pass on a freshly booted pg-lane (audit re-run, see trail). | closed |
| T-222-02 | Elevation of privilege | `computation_error_copy` ACL | medium | mitigate | `REVOKE ALL ... FROM PUBLIC, anon, authenticated` and `GRANT EXECUTE ... TO service_role` re-asserted at migration :155-156; self-verify asserts service_role has EXECUTE and anon and authenticated do not (:193-201). Function is not `SECURITY DEFINER`. No other migration re-grants it (grep: only 20260826120000 and this one carry REVOKE/GRANT for it). Rollback re-asserts the same ACL. | closed |
| T-222-03 | Tampering | unattended PROD apply | high | mitigate | In-tree controls present: self-verify raises on any wrong arm or ACL (migration `DO $verify$`); `apply` is `needs: [plan, apply-test]` with `if: ... needs.apply-test.result == 'success'` (`.github/workflows/supabase-migrate.yml:1485-1486`), unchanged by this phase; both SQL gates list the new file in `RED-UNDER-SETUP` and pass on the pg-lane (audit re-run). The "migration-reviewer and rls-policy-auditor clean at MEDIUM+ before merge" clause is a pre-merge process gate with no in-tree artifact yet: carried as a ship precondition below, not counted as an open threat. | closed |
| T-222-04 | Information disclosure | migration, rollback, SUMMARY text in a public repo | low | mitigate | Grep over the full phase diff (code and `.planning/phases/222-*`): no home paths, no PROD project ref (the pinned literal in `src/lib/test-safety.ts:26` appears nowhere in the diff), no JWT-, key- or DSN-shaped strings. Rollback names "the marker query in CLAUDE.md" rather than a database (`down/20261127120000-rollback.sql`, precondition RAISE and header). | closed |
| T-222-05 | Information disclosure | the five Python user strings | low | mitigate | All five are fixed literals: `routers/portfolio.py` `_fail_vr(...)`, `services/exchange.py` VALIDATION_UNEXPECTED, `services/csv_validator.py` percent-form note (interpolates only a computed float `median_abs`, as before), `services/job_worker.py` stitch-composite limit message (interpolates two ints) and the enqueue-failure sentence. No `str(exc)` introduced anywhere in the code diff (grep). `analytics-service/tests/test_no_contact_support_copy.py` (ast scan of tracked production `.py`, plus five per-function pins) passes: 39 passed with the census and benchmark gates. | closed |
| T-222-06 | Tampering | provenance census of the enqueue-failure payload | medium | mitigate | Payload keys are exactly `strategy_id, computation_status, computation_warned, computing_started_at, computation_error`, unstamped (`services/job_worker.py:2981`, `_enqueue_failed_payload`). `tests/test_computation_error_provenance_census.py` diff is prose only; `EXPECTED_INERT_SITES: Final[int] = 1` unchanged (:197); gate passes. Offline test pins the exact five-key set and the new sentence. | closed |
| T-222-07 | Information disclosure | benchmark note | low | mitigate | `BENCHMARK_NOTE_NO_SOURCE = "benchmark unavailable: no price source"` is a module constant (`routers/portfolio.py:114`), written at :1052; `stale` is `benchmark_note == BENCHMARK_NOTE_STALE` (:1107). The only exception text path (`benchmark_error = f"{type(exc).__name__}: {exc}"`, :1092) is pre-existing and untouched, and `benchmark_error` is read by no file under `src/` (grep), so it stays operator-side. `tests/test_portfolio_benchmark_pairing.py` passes (15). | closed |
| T-222-08 | Tampering | `get_benchmark_returns` contract | low | mitigate | `analytics-service/services/benchmark.py` has no diff in `017ba2e08..HEAD`. `get_benchmark_returns` still has a single `None` exit (`return None, True`, :496), so `BENCHMARK_NOTE_NO_SOURCE` cannot capture another exit. `tests/test_benchmark.py` passes (17). | closed |
| T-222-09 | Denial of service | `run_sync_trades_job` enqueue-failure outcome | high | mitigate | Publish read precedes any write (`services/job_worker.py:2903-2922`). Published (`complete`, `complete_with_warnings`, or `computing` with non-null `metrics_json`) -> `_nothing_published` stays False (:2920, only set True at :2947) -> no write -> falls through to the DONE return. Unreadable state -> `except` arm sets nothing -> DONE, no write. FAILED/transient is returned only inside `if _nothing_published:` (:2978, return at :3047-3048). `test_published_strategy_is_left_alone_and_returns_done` (three published shapes), `test_unreadable_publish_state_writes_nothing_and_returns_done`, `test_a_non_success_row_with_old_figures_is_not_published` and the live `test_published_complete_stays_complete` / `test_computing_with_figures_keeps_them_and_resolves_to_complete` pin it. Offline gates pass (24 selected `SyncTrades` tests). Live module not re-booted by this audit; see trail. | closed |
| T-222-10 | Tampering | the failed write on a published row | medium | mitigate | No write at all when published. The write for the not-published case is a conditional UPDATE, the exact inverse of the predicate: `.not_.in_("computation_status", sorted(STRATEGY_ANALYTICS_TERMINAL_SUCCESS_STATUSES))` and `.or_("computation_status.neq.computing,metrics_json.is.null")` (:3016-3020), both argument strings pinned by `test_failed_write_is_conditional_on_nothing_published`. Zero-row result triggers a re-read and a DONE return if published in between (:3023-3034). Live `test_published_complete_with_warnings_keeps_status_and_warned_flag` asserts status, `computation_warned`, error and figures survive. Filter strings are constants; `strategy_id` goes through `.eq()`. | closed |
| T-222-11 | Information disclosure | `DispatchResult.error_message` -> `compute_jobs.last_error` | low | mitigate | `error_message` is the constant "sync_trades: the follow-on analytics enqueue failed and the strategy has nothing published" (:3050-3054), no exception text, no ids. `test_job_worker.py:3131` asserts the simulated exception text is absent from `result.error_message`; passes. `error_kind="transient"` is inside the set `mark_compute_job_failed` accepts (`supabase/schema/functions/mark_compute_job_failed.sql:45-46`). | closed |
| T-222-12 | Tampering | live test writes | medium | mitigate | `_require_loopback_lane` (`tests/test_sync_trades_enqueue_failure_bridge_live.py:69`) is called, after `_need_supabase()` and before `_lane_client()`, in each of the seven writing tests (lines 315, 339, 364, 385, 405, 429, 461); self-test `test_loopback_guard_refuses_every_non_lane_host` (:116) covers a remote host, a look-alike hostname, empty and None. The handler ctx is built on the lane client (`_HandlerSupabase(admin)`) in `_drive`. Only a throwaway user, strategy (cascade) and job are created and removed in `finally` (:294-306). `tests/conftest.py` sentinels (`SUPABASE_TEST_URL`, `_need_supabase`) put the module in the `shared_test_db` xdist group; roster entry added in `test_live_db_reach_roster.py:231`. | closed |
| T-222-13 | Repudiation | double fault: enqueue AND publish read both fail on a never-published strategy | low | accept | See Accepted Risks Log R-222-01. Residual is documented in `222-04-SUMMARY.md` ("Known limit (T-222-13)") and in the handler's `except` arm comment (`job_worker.py:2926`), and the branch logs at ERROR naming the strategy. | closed (accepted) |
| T-222-SC | Tampering | npm/pip/cargo installs | low | accept | See Accepted Risks Log R-222-02. `git diff 017ba2e08..HEAD` touches no `requirements*.txt`, `package.json`, lockfile or `pyproject.toml`; no package was added. | closed (accepted) |

*Status: open · closed · open — below high threshold (non-blocking)*
*Severity: critical > high > medium > low — only open threats at or above `block_on: high` count toward `threats_open`*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| R-222-01 | T-222-13 | If the follow-on enqueue AND the first publish read both fail on a never-published strategy, the handler writes nothing and returns DONE, so the status bridge leaves the row reading `complete` (today's pre-phase outcome, no regression). FAILED is reserved for "nothing published", and an unreadable state is not that: a read hiccup must never unpublish a live strategy (T-222-09). `db_read_with_retry` absorbs transient 504s; the branch logs at ERROR naming the strategy. Recorded as a known limit in `222-04-SUMMARY.md`; the CHANGELOG line is a ship step. | Plan 222-04 threat register (disposition accept); the FAILED/DONE boundary is set by founder rulings OQ2 and OQ4 (2026-11-25). No separate founder acceptance of this residual by name was found in the phase record. | 2026-11-25 |
| R-222-02 | T-222-SC | The phase installs no package; supply-chain surface is unchanged. Verified against the diff (no manifest or lockfile touched). | Plans 222-01 to 222-04 threat registers (disposition accept) | 2026-11-25 |

*Accepted risks do not resurface in future audit runs.*

---

## Unregistered Flags

SUMMARY `## Threat Flags`: plans 01-04 each report "None". No attack surface appeared that lacks a threat mapping: the review-fix rounds added a conditional PostgREST UPDATE and a re-read, both built from constant filter strings and a `.eq()` on the job's own `strategy_id`.

Informational residuals recorded by the code reviews (not security threats, not blockers, none counted in `threats_open`). All sit in the T-222-09 / T-222-13 family and were deliberately not fixed under the repo's LOW/INFO rule:

| Source | Residual | Relation |
|--------|----------|----------|
| 222-REVIEW R3-IN-02 / SFH-R3-01 | Triple fault (enqueue fails, a publisher lands between the read and the write, and the re-read raises) returns FAILED; on the last attempt bridge branch (b) can write `failed` over the published row. Routed to Phase 251 SYNCSTORE by the ship PR (TODOS entry not yet created, ship step). | Below T-222-09's guarantee: requires three coincident faults and a concurrent publish, and cannot be triggered by a systematic enqueue fault alone (a systemic read failure takes the first-read DONE path). |
| 222-REVIEW R2-IN-03 | With no row and a failed mark RPC, the strategy stays row-less until the reaper requeues. | Double fault. |
| 222-REVIEW R2-IN-02 | A jsonb `null` in `metrics_json` splits the Python read from the PostgREST filter; no writer of jsonb `null` was found. | Parity edge. |
| 222-REVIEW R3-IN-03 | A publisher landing after the handler's last decision still meets `sync_trades` `failed_final` at bridge branch (b) on the last attempt. | Pre-existing per-kind supersession behaviour (accepted ERRC-03 option a), not a handler race. |
| 222-REVIEW IN-02 | Publish read and failed UPDATE are not atomic (window narrowed by the conditional UPDATE and the re-read). | Narrowed by R2-WR-01 fix. |

---

## Ship Preconditions Carried Forward (not open threats)

1. T-222-03: `migration-reviewer` and `rls-policy-auditor` must both be clean at MEDIUM+ before merge. A repo-wide search (`.planning` text and `git log --all` messages) found no verdict from either for Phase 222; earlier phases record theirs in a ship-time commit (for example Phase 211's), and Phase 222's has not been made. Do not merge until both are recorded.
2. The migration stamp `20261127120000` must be re-picked from origin/main immediately before the single CI run (it must sort after every other migration on main); a re-stamp moves the migration, the rollback name and header, the snapshot's `-- source migration:` line, both `RED-UNDER-SETUP` entries and the RAISE/NOTICE texts together (see `222-01-SUMMARY.md`). PROD applies automatically after `apply-test` succeeds.
3. CHANGELOG entry must record the T-222-13 double-fault residual and delete the closed TODOS entries; book the Phase 251 entry for SFH-R3-01.

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-11-25 | 14 | 14 | 0 | gsd-security-auditor (ASVS L1, block_on high) |

Audit evidence gathered this run (not copied from SUMMARY or review text): code and migration read at head `a6d13c9c8`; offline gates re-run and green (`test_computation_error_provenance_census.py`, `test_failed_status_logged.py`, `test_no_contact_support_copy.py`, `test_portfolio_benchmark_pairing.py`: 39 passed; `test_job_worker.py -k "SyncTrades or enqueue"`: 24 passed; `test_benchmark.py`: 17 passed); the two SQL gates `test_sync_status_curated_sentence_survives.sql` (ALL 7 ARMS EXECUTED) and `test_sync_status_marked_refresh_protected.sql` (ALL 35 ARMS EXECUTED) re-run on a throwaway local PostgreSQL via `scripts/pg-lane/run.sh` with the new migration applied, exit 0; vitest `csv-finalize/route.test.ts`, `portfolio-analytics-adapter.test.ts`, `wizardErrors.test.ts`: 415 passed. Code binding: `git diff 12b56c5e4..HEAD -- . ':!.planning'` is empty, so the code at the audited head is byte-identical to what the round-3 reviewer measured, and its live-module result (8 passed, with the mutation REDs for the publish and race gates) applies to this head. NOT re-run by this audit: the live local-stack module `test_sync_trades_enqueue_failure_bridge_live.py` (no lane was booted; its GREEN and mutation RED results come from the round-3 code review, and it is a hard-fail-in-CI gate on the python job), and the mutation runner.

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: secured` set in frontmatter (matches sibling phase SECURITY files)
- [ ] migration-reviewer and rls-policy-auditor verdicts recorded, clean at MEDIUM+ (T-222-03 ship precondition, NOT yet met; see Ship Preconditions)

**Approval:** secured 2026-11-25 at ASVS L1 on the in-tree controls. Merge is still gated on the unchecked reviewer-verdict item above.

## Pre-merge reviewer verdicts (recorded by the orchestrator, 2026-11-25, at 80b5140a4)

- migration-reviewer: CLEAN (0 CRITICAL / 0 HIGH / 0 MEDIUM). Ship note: re-pick the 20261127120000 stamp from origin/main and rewrite every reference (`grep -rIl 20261127120000`), keeping the entry last in both gates' RED-UNDER-SETUP lists.
- rls-policy-auditor: CLEAN (0 findings; leak scopes none).
- Both verdicts are bound to the migration text at this commit; a re-stamp that changes only the timestamp keeps them valid, any other edit to the migration needs a re-run.
