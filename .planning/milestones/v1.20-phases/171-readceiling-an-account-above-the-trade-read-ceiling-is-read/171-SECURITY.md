---
phase: "171"
slug: readceiling
status: verified
# threats_open = count of OPEN threats at or above workflow.security_block_on severity (the blocking gate)
threats_open: 0
asvs_level: 1
block_on: high
created: "2026-10-28"
audited_at_sha: 43fbfdc98
---

# Phase 171 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

Auditor: gsd-security-auditor (register authored at plan time across plans 01-12, ASVS L1, block on high). It modified no file and made no PROD, TEST or Railway access. Evidence is cited by file and symbol. `ER` = `analytics-service/services/equity_reconstruction.py`, `STORE` = `analytics-service/services/trade_read_store.py`, `PROBE` = `analytics-service/scripts/allocator_history_probe.py`, `MIG` = `supabase/migrations/20261031120000_allocator_trade_reads.sql`.

**Verdict: SECURED.** 40 threats (T-171-01 to T-171-39, plus the shared T-171-SC). 40 are closed, 2 of them accepted. 0 are open.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| worker (service_role) -> trade-read tables | the only reader and writer; BYPASSRLS, so the grants are the control | per-fill trades of an allocator (sensitive) |
| browser (anon / authenticated) -> tables via PostgREST | must reach nothing | none permitted |
| key / account deletion -> tables | cascades must erase the stored trades | GDPR erasure |
| venue -> trade read | page contents, cursors and timestamps are untrusted | venue responses |
| trade read -> stored history | nothing may be written before the read is whole | equity history |
| worker -> compute_jobs (defer RPC) | claim-token fenced | job state |
| worker -> logs, last_error, audit | static text and counts only | operational metadata |
| probe / operator -> PROD database and Railway worker | reads only; temporary start command restored | decrypted keys in memory only |
| live store probe -> database | writes, so loopback lane only | throwaway rows |
| phase records -> public repo | SUMMARYs are tracked | counts and closed tokens only |
| migration -> shared TEST then PROD | auto-applies with no human stop | catalogue only |

---

## Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation (evidence) | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-171-01 | Information disclosure | probe record keys | high | mitigate | `PROBE` `emit_record` -> `validate_record`; new keys have closed validators (`_is_one_of`, `_is_count`); planted-value `capsys` tests in `test_allocator_history_probe.py` | closed |
| T-171-02 | Tampering | probe reaching a writer or the resumable store | high | mitigate | `ReadOnlySupabase` / `_ReadOnlyTable` expose `select` only; `test_the_probe_names_only_the_two_tables_it_reads`, `test_the_probe_never_touches_the_resumable_trade_read` | closed |
| T-171-03 | Repudiation | probe against older deployed code | medium | mitigate | `DEPLOYED_ER_NAMES` + `missing_deployed_names()` first in `run()`, `EXIT_REFUSED` before any decrypt; 171-05-SUMMARY `deployed-names: 11 declared, 0 missing` | closed |
| T-171-04 | Tampering | partial window returned as whole | high | mitigate | `ER` `_read_bybit_window`: continuation lowers the end bound strictly or raises `TruncatedTradeRead`; uncertain stops return `False` and are never stored. See note 1 | closed |
| T-171-05 | Denial of service | venue that never runs out | medium | mitigate | `_BYBIT_WINDOW_PAGE_CEILING = 100`, `_BYBIT_WINDOW_SEGMENT_CEILING = 100`, outer `asyncio.wait_for(..., _RECONSTRUCT_CRAWL_TIMEOUT_S)`, `_validated_claim_budget` | closed |
| T-171-06 | Information disclosure | venue text in new WARNINGs | medium | mitigate | new `ER` WARNINGs carry venue, age, counts only; `_SIGNATURE` planted-signature asserts in `test_trade_pages.py` | closed |
| T-171-07 | Information disclosure | PostgREST read of per-fill rows | high | mitigate | `MIG` ENABLE + FORCE RLS on both tables, no `CREATE POLICY`, `REVOKE ALL ... FROM PUBLIC, anon, authenticated, service_role` then service_role-only grant; SQL gate arms 1 and 8 with RED-UNDER twins. PROD catalogue read 2026-10-28: tables 2, rls forced 2, policies 0, anon/authenticated privileges 0 (171-12-SUMMARY) | closed |
| T-171-08 | Tampering | anon/authenticated writing a poisoned window | high | mitigate | same grants: no INSERT/UPDATE/DELETE for either role; arms 1 and 2 | closed |
| T-171-09 | Information disclosure | trades surviving key or account deletion | high | mitigate | `MIG` both tables `REFERENCES public.api_keys(id) ON DELETE CASCADE`; arms 3 and 4 delete via the key and via `auth.users` | closed |
| T-171-10 | Denial of service | data-reading verify refusing on empty TEST | high | mitigate | `MIG` `DO $verify$` uses `to_regclass` and `pg_constraint` only | closed |
| T-171-11 | Denial of service | oversized row | medium | mitigate | `allocator_trade_read_windows_count_chk` (0..5000) and `_array_chk`; arm 6; `STORE_CHUNK_TRADES = 5000` | closed |
| T-171-12 | Tampering | stale window reused | high | mitigate | `STORE` `_state_usable` (version, expiry, origin) -> `_delete_keys`; `_meta_of` per-chunk checks; `test_stale_state_is_discarded` | closed |
| T-171-13 | Tampering | half-written or malformed window | high | mitigate | `STORE` `_meta_of` chunk-set/count checks, `load_window` returns `None` on mismatch, `save_window` clears before upsert, `_storable` rejects non-finite; `test_a_half_written_window_is_not_used` | closed |
| T-171-14 | Information disclosure | stored values in store logs | medium | mitigate | `STORE` logs class name, counts, key id only; `test_no_store_log_line_carries_a_stored_value` | closed |
| T-171-15 | Denial of service | endless deferral / unbounded storage | medium | mitigate | `STALLED_CLAIMS_LIMIT = 3`, `JOB_BACKSTOP_S = 24h`, `STORE_EXPIRY_S = 7d`, scoped `purge_keys` / `purge_expired` | closed |
| T-171-16 | Tampering | temporary start command left on the worker | high | mitigate | 171-05-SUMMARY `start-command: restored`, `service-variable: removed` (record) | closed |
| T-171-17 | Information disclosure | ids or cursors in tracked record | medium | mitigate | uuid-pattern grep of 171-05 and 171-12 SUMMARYs: no match | closed |
| T-171-18 | Repudiation | reading on a mismatched deployed commit | medium | mitigate | as T-171-03; exit 2 is `EXIT_REFUSED` | closed |
| T-171-19 | Repudiation | store gate removed silently | medium | mitigate | `scripts/mutation-floors.mjs` floors raised, `WAIVED_CEILING = 0`; gate registered in the `ci.yml` sentinel table; `mutation-runner-floors.test.ts` updated | closed |
| T-171-20 | Information disclosure | per-fill rows absent from Art. 15 export | low | accept | see Accepted Risks Log | closed (accepted) |
| T-171-21 | Tampering | partial read persisted | high | mitigate | `ER` `except store.TradeReadDeferred` returns `_defer_reconstruct(...)` before the persist half; `test_a_bybit_book_too_big_for_one_claim_defers_then_completes` | closed |
| T-171-22 | Denial of service | job that defers forever | high | mitigate | `begin_claim` raises `TradeReadStalled("stalled_claims")` at 3; `TradeReadStalled("job_age")` at the defer point; unreadable `created_at` counts as too old | closed |
| T-171-23 | Tampering | stale-token deferral | medium | mitigate | `p_claim_token` fence; `_defer_lost_ownership` (55006) -> DEFERRED; test in `test_trade_read_resume.py` | closed |
| T-171-24 | Information disclosure | venue text in p_reason / last_error / audit | medium | mitigate | static prefix + integers; `test_no_deferral_text_carries_venue_text`, `test_a_stalled_job_carries_no_venue_text` | closed |
| T-171-25 | Tampering | deferral masking a sibling's verdict | high | mitigate | `ER` `_crawl_whole_account` re-raises `first_deferral` only after the outcome loop; precedence tests in both key orders | closed |
| T-171-26 | Tampering | forced window from one member's partial read | high | mitigate | deferral raised before `_sum_account_rows` and persist; `test_a_forced_account_whose_bybit_read_is_deferred_writes_nothing_then_completes` | closed |
| T-171-27 | Repudiation | new token unknown to the handoff | medium | mitigate | `account_key_read_stalled` in `FORCED_REBUILD_REFUSAL_REASONS`; pins in force-rebuild, two-year-window and probe tests; handoff amendment in 167.2.1.1.2-09-SUMMARY | closed |
| T-171-28 | Tampering | live probe writing to shared TEST or PROD | high | mitigate | `test_trade_read_store_live.py` `_require_loopback_lane` (hostname in {127.0.0.1, localhost, ::1}) before each test; look-alike host refused; `_cleanup` in `finally` | closed |
| T-171-29 | Tampering | value changed by jsonb/PostgREST | high | mitigate | `test_a_stored_window_round_trips_through_postgrest` over 5001 trades with extreme and `None` values | closed |
| T-171-30 | Tampering | temporary start command left on the worker | high | mitigate | 171-12-SUMMARY `start-command: restored` (record) | closed |
| T-171-31 | Information disclosure | a6 ids in tracked record | high | mitigate | uuid-pattern grep: no match | closed |
| T-171-32 | Tampering | operator write or enqueue on PROD | high | mitigate | 171-12-SUMMARY: marker names PRODUCTION, SELECT-only files, `a6-job: none enqueued` (record; see note 3) | closed |
| T-171-33 | Denial of service | store fault crashing reconstruct | high | mitigate | `STORE` one `except Exception` per public call (CancelledError propagates), None/False/normal returns, one class-only WARNING; `test_a_store_fault_is_a_disposition_not_a_crash` | closed |
| T-171-34 | Denial of service | absent or failing store breaking Bybit reconstruct | high | mitigate | `ER` `state is None` -> layer-1 `_read_bybit_range`; failed save keeps the trades; two store-fault tests | closed |
| T-171-35 | Information disclosure | abandoned key's rows outliving expiry | medium | mitigate | `main_worker.py` `sweep_expired_trade_reads` from `watchdog_loop`; test pins it | closed |
| T-171-36 | Denial of service | sweep stalling the watchdog | medium | mitigate | own `try/except` after reclaim and orphan sweep; time stamped before purge; `_TRADE_READ_SWEEP_INTERVAL_S = 3600.0` | closed |
| T-171-37 | Tampering | forced window after a stalled member | high | mitigate | `TradeReadStalled` -> `ForcedRebuildRefusedError("account_key_read_stalled")` before sum and persist; `_assert_account_rebuild_refused` | closed |
| T-171-38 | Repudiation | phase PR before the D-01 reading | high | mitigate | 171-12-SUMMARY `ship-gate: d01-ship go` above `merge-sha:` (record) | closed |
| T-171-39 | Repudiation | ship against an uncleared D-01 verdict | high | mitigate | 171-05-SUMMARY has exactly one `d01-ship:` line, reading `go` | closed |
| T-171-SC | Tampering | package installs | low | accept | no requirements, package, lockfile or pyproject change on the branch | closed (accepted) |

*Status: open · closed · open — below high threshold (non-blocking)*
*Severity: critical > high > medium > low — only open threats at or above workflow.security_block_on count toward threats_open*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

### Notes

1. **T-171-04, recorded deviation from the register's wording.** The register says every stop other than an empty page or a page with no cursor raises. A SHORT page that repeats its cursor or adds no new row instead ends the window with one counts-only WARNING and no raise (`ER` `_read_bybit_window`, the `TRADEPAGES D-02` branch). This is the deployed TRADEPAGES D-02 behaviour, which fix round 1 (WR-02) restored and fix round 2 (R2-1) made loud (171-REVIEW). It is closed because the phase did not introduce it, every continuation path raises, and such a window returns `False` so it is never kept in the layer-2 store. Making it raise would change deployed behaviour, not fill a missing mitigation.
2. **T-171-20** is accepted, not mitigated. See the log below.
3. **T-171-16, -30, -32, -38, -39 are operational** and close on the tracked SUMMARY records, not on code. Line formats and ordering were checked and the uuid grep ran. PROD and Railway state were not re-read in this audit. T-171-32 carries the recorded deviation that the marker query ran as its own file before `catalogue.sql` and `jobs.sql`, not inside each.

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-171-01 | T-171-20 | The two tables are a transient processing cache: 7-day expiry, deleted on a successful rebuild, service-role only, erased with the key and the account by cascade. They are not counted by the GDPR export hook; no allowlist key was added, because a key without a manifest entry fails the hook. Rationale in 171-06-SUMMARY and the `MIG` header. | plan 06 threat model | 2026-10-28 |
| AR-171-02 | T-171-SC | No package is installed by any plan; the venv and node_modules are git-ignored symlinks after byte-identical requirements and lockfile checks. | plan threat models 01-12 | 2026-10-28 |

*Accepted risks do not resurface in future audit runs.*

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-10-28 | 40 | 40 | 0 | gsd-security-auditor (sonnet), at 43fbfdc98 |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-10-28
