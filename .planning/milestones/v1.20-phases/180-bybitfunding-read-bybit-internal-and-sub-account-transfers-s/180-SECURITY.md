---
phase: "180"
slug: "bybitfunding-read-bybit-internal-and-sub-account-transfers-s"
status: secured
# threats_open = count of OPEN threats at or above workflow.security_block_on severity (the blocking gate)
threats_open: 0
asvs_level: 1
created: "2026-10-29"
---

# Phase 180 - Security

> Per-phase security contract: threat register, accepted risks, operator-pending threats, and audit trail.
> Audited against `git diff 3b065928f..HEAD -- . ':!.planning'` at HEAD `c9043ecb1` (branch `feat/180-bybitfunding`). Implementation files were read only.

**Verdict: SECURED for everything the code owns.** 25 of 25 code-owned `mitigate` threats are CLOSED, 3 are accepted with a log entry, and 6 are owned by operator plan 08 (not yet run) and are recorded as PENDING-OPERATOR, not open. `threats_open: 0`.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| Bybit REST (private GETs) -> analytics worker / probe | `GET /v5/account/transaction-log`, the five asset record and transfer-list reads, `GET /v5/user/query-api`, the deposit and withdraw record reads inside `fetch_ccxt_transfers` | rows, ids, member ids, UIDs, amounts, venue error text: untrusted input, held in memory only |
| probe stdout -> tracked SUMMARY / `TODOS.md` (public repo) | operator pastes records at SC-3 | counts, booleans, closed buckets, closed tokens, `field-absent` only (`FUNDING_VALIDATORS`, `_ACCOUNT_VALIDATORS`, `emit_record`, `assert_sanitized`) |
| analytics worker logs | an exception text can carry a signed request URL | exception CLASS and counts only |
| rebuild -> `allocator_equity_snapshots` | a forced rebuild replaces a stored window in one write | a refusal returns before the persist half; nothing is written |
| operator -> backfill worker / PROD database | plan 08, not run | procedural controls, see the PENDING-OPERATOR section |

---

## Threat Register

Status vocabulary: `closed` (mitigation found in HEAD code), `accepted` (documented below), `pending-operator` (owned by plan 08, which has not run; not counted as open).

| Threat ID | Category | Component | Severity | Disposition | Evidence (file:symbol) | Status |
|-----------|----------|-----------|----------|-------------|------------------------|--------|
| T-180-01 | Information disclosure | evidence record fields | high | mitigate | `analytics-service/scripts/bybit_funding_record.py`: `FUNDING_VALIDATORS` (counts via `_is_count_or_absent`, buckets via `_is_one_of_or_absent(AGE_BUCKETS)`, states via `_is_one_of`), `_source_values` emits only `len(...)`, bucket and state values; `read_key_info` keeps two booleans (`isMaster` strictly bool, `uta` only 0 or 1) and drops both UIDs. `scripts/allocator_history_probe.py`: `ACCOUNT_RECORD_KEYS` spreads `FUNDING_KEYS`, `_ACCOUNT_VALIDATORS` spreads `FUNDING_VALIDATORS`, `emit_record` -> `validate_record` -> `_check_keys` (extra or missing key raises) + `assert_sanitized`; the validation message names the path, never the value | closed |
| T-180-02 | Tampering | venue write reachable from the evidence code | high | mitigate | `bybit_funding_record.py` names exactly seven `private_get_v5_*` methods (grep of HEAD confirms: five `EvidenceSource.method`, `private_get_v5_account_transaction_log`, `private_get_v5_user_query_api`); `tests/test_bybit_funding_record.py::test_the_record_module_names_only_read_endpoints` pins that set plus no `create_order/cancel_order/withdraw/transfer(` and no `private_(post|put|delete)_` and no DB writer; probe pins `test_the_probe_source_calls_no_writer` and `test_the_probe_source_calls_no_venue_write` in `tests/test_allocator_history_probe.py`; my own grep of the four changed source files finds no post/put/delete method name | closed |
| T-180-03 | Tampering (data integrity) | a source that failed read as 0 | high | mitigate | `bybit_funding_record.py::_source_values` returns every count and bucket as `FIELD_ABSENT` unless `sink.deepest_start is not None`; `_census_values` the same; `measure_funding` records the failure by `_state_of` and keeps later sources running; `_stamp_of` raises `EvidenceShapeError` instead of inventing a stamp; tests `test_a_source_the_key_cannot_read_is_a_state_never_a_count`, `test_a_source_past_its_bound_is_a_timeout_and_the_next_source_still_runs`, `test_a_success_row_without_a_readable_stamp_is_malformed_never_invented` | closed |
| T-180-04 | Denial of service | evidence reads hanging the probe | medium | mitigate | `bybit_funding_record.py`: `EVIDENCE_SOURCE_TIMEOUT_S = 420.0` wraps each source and `read_key_info` in `asyncio.wait_for`; `CENSUS_TIMEOUT_S = 600.0` wraps the census; `EVIDENCE_PAGE_CAP = 200` ends a walk as `ceiling`. `allocator_history_probe.py::_bybit_funding_evidence` runs after the member snapshot, outside the crawl bound. Note: the generic failure arm takes evidence only for `TruncatedTradeRead` (a read that did read trades), still under the same bounds. Tests `test_the_key_info_read_is_bounded_too`, `test_a_source_that_times_out_after_a_window_keeps_that_window_and_says_timeout` | closed |
| T-180-05 | Information disclosure | venue exception text | medium | mitigate | `bybit_funding_record.py::_state_of` and `read_key_info` use `classify_failure` (`scripts/bybit_upnl_probe.py`, class from `isinstance`, never the message); grep of `bybit_funding_record.py`, `allocator_history_probe.py` and `bybit_unified_flows.py` for `str(exc)`, `repr(exc)`, `.args`, `scrub_freeform_string` finds nothing; evidence classes are the closed `SOURCE_STATES` | closed |
| T-180-06 | Tampering (data integrity) | the gate's kind mapping | high | mitigate | `allocator_history_probe.py::_UNIFIED_FLOW_KINDS` maps `TRANSFER_IN` to `deposits` and `TRANSFER_OUT` to `withdrawals`; `bybit_transfers_verdict` is outside every changed hunk of the diff (unchanged); the recorder appends the Unified rows to the same per-kind list; `tests/test_bybit_unified_flows.py::test_the_flow_types_are_the_probes_and_disjoint_from_the_census`, `test_the_probe_recorder_sees_the_unified_read_as_deposits_and_withdrawals` | closed |
| T-180-07 | Repudiation / data integrity | hidden shut-gate reason, unreadable source read as "no withdrawal" | high | mitigate | `allocator_history_probe.py::bybit_transfers_cause`: refusal `_FLOW_SOURCE_REFUSAL`, `malformed`, or a state in `_PERMANENT_UNIFIED_STATES` gives `flow_source_unreadable` first; any other non-`read` state (a transient class, `not-run`, `Timeout`) or a failure before any trade call gives `read_incomplete`; counts are consulted only after both; `_probe_member` relabels `read` to `malformed` when the member's refusal is the flow-source token and the recorder saw no fault; `_reader_accepts_unified_row` mirrors the reader (parity test `test_the_probes_unified_row_check_agrees_with_the_readers`); cause is validated by `_BYBIT_TRANSFERS_CAUSES` | closed |
| T-180-08 | Tampering | recorder altering or swallowing the rebuild's answer | high | mitigate | `allocator_history_probe.py::_TradeRecorder._recording_unified_log`: `except Exception: ...; raise` (same object), `except asyncio.CancelledError: ...; raise`, `return answer` (same object, including the malformed arm); non-flow types pass straight through to the unwrapped fetcher | closed |
| T-180-09 | Information disclosure | Unified ids, stamps, amounts | high | mitigate | recorder keeps `(kind, id, stamp)` tuples in memory only (`self.unified`, `self.transfers`); `_probe_account` emits `bybit_unified_in_rows`, `bybit_unified_out_rows`, `bybit_unified_sign_mismatch_rows` (`_is_count`) and `bybit_unified_state` (`_is_one_of(_UNIFIED_STATES)`); no logger call in the probe diff; `tests/test_allocator_history_probe.py::test_a_fully_populated_evidence_record_is_emitted_and_leaks_nothing` asserts `fake-transfer`, `fake-member`, `fake-userid`, `fake-parentuid`, both amounts and every stamp are absent from stdout and stderr | closed |
| T-180-10 | Tampering (data integrity) | dropped page or stalled cursor truncating flows | high | mitigate | `services/bybit_unified_flows.py::fetch_bybit_unified_flows`: `ProviderPaginationContract(stop_on_short_page=False, stuck_cursor_is_stop=False, on_ceiling="raise", ceiling_exc=BybitUnifiedFlowReadError)`; `_fetch_page` raises when `items and next_cursor == req.cursor`; walk raises at `UNIFIED_FLOW_PAGE_CAP` (`services/exchange_pagination.py::walk_paginated`); tests `test_every_page_of_a_window_is_read`, `test_a_repeated_cursor_raises_and_stops_at_once`, `test_a_window_past_the_page_cap_raises` | closed |
| T-180-11 | Tampering (data integrity) | venue ignoring the `type` filter; malformed row dropped | high | mitigate | `bybit_unified_flows.py::normalise_unified_flow_row` refuses a non-object, `item.get("type") != log_type`, an unusable id, `transactionTime`, currency, or an unparseable `_amount_of`; `_fetch_page` builds `rows` from every item so one refusal raises the whole read; tests `test_a_row_of_another_type_is_refused`, `test_a_row_is_normalised_or_refused`, `test_a_malformed_answer_is_refused` | closed |
| T-180-12 | Information disclosure | venue exception text in logs | medium | mitigate | `bybit_unified_flows.py::_fetch_page` logs `exc_class=%s` only (review round 1 M-3 removed the scrubbed text, stricter than the plan); `_refuse` text is static plus the closed `log_type` and, for the stalled cursor, window bounds; the ceiling text from `walk_paginated` is `fetcher`, `ceiling_label`, `page_cap`, `inst_type`, window bounds; `tests/test_bybit_unified_flows.py::test_a_failed_page_logs_the_exception_class_never_the_venue_text` | closed |
| T-180-13 | Denial of service | the read silently swallowing a permission or network fault | high | mitigate | `bybit_unified_flows.py::_fetch_page` `except Exception: log; raise`; no other handler in the module; `walk_paginated` swallows nothing for this contract (`gated_inst_types=frozenset()`, no `skip_inst_type`); `tests/test_bybit_unified_flows.py::test_venue_errors_pass_through_unchanged`; mapping to the named refusal and to `permanent` is T-180-19 and T-180-31 | closed |
| T-180-14 | Tampering (data integrity) | rows past a 50-row Bybit page dropped | high | mitigate | `services/ccxt_flow_fetch.py::_read_bybit_transfer_window` follows `_bybit_next_cursor(response)` from the call's own answer (`result.nextPageCursor`), `limit` 50 via `_BYBIT_TRANSFER_PAGE_LIMIT`; `fetch_ccxt_transfers` dispatches `exchange_id == "bybit"` to it; tests `test_a_bybit_window_holding_more_than_one_page_returns_every_row`, `test_a_bybit_page_whose_cursor_row_is_dropped_by_parsing_still_continues`, `test_a_full_bybit_page_whose_rows_all_parse_away_still_continues` | closed |
| T-180-15 | Tampering / denial of service | a cursor that never advances | medium | mitigate | `_read_bybit_transfer_window`: `seen_cursors` set raises `TransferPageStalled` on a repeat or cycle; the `range(1000)` loop falls through to a raise; empty raw page ends the window; tests `test_a_repeated_bybit_cursor_raises_instead_of_truncating`, `test_a_cycling_bybit_cursor_raises_instead_of_truncating`, `test_a_bybit_window_past_the_page_ceiling_raises_instead_of_truncating`, `test_an_empty_bybit_page_ends_the_window_even_when_its_cursor_repeats` | closed |
| T-180-16 | Tampering (data integrity) | live broker-dailies and composite flow lists change for busy Bybit keys | medium | accept | see Accepted Risks Log AR-180-16 | accepted |
| T-180-17 | Information disclosure | `TransferPageStalled` text | low | mitigate | both raise sites in `ccxt_flow_fetch.py::_read_bybit_transfer_window` build static text with `kind` and `window_start_ms` only; the drop warning logs `kind`, `window_start_ms`, `raw_rows`, `parsed_rows` counts only (`test_a_bybit_page_whose_rows_parsing_drops_logs_the_counts_only`) | closed |
| T-180-18 | Tampering (data integrity) | Bybit replay fed both the on-chain pair and the Unified rows, or the on-chain pair only | high | mitigate | `services/equity_reconstruction.py::_fetch_and_price_window`: `is_bybit` reads `fetch_bybit_unified_flows` into `deposits`/`withdrawals`, and the `fetch_ccxt_transfers` pair sits under `if not is_bybit:`; grep shows `fetch_ccxt_transfers` called in this module only at that non-Bybit site | closed |
| T-180-19 | Tampering (data integrity) | forced rebuild over an unreadable flow source (silent 0) | high | mitigate | `_fetch_and_price_window` catches `ccxt.AuthenticationError`, `ccxt.PermissionDenied`, `ccxt.BadRequest`, `BybitUnifiedFlowReadError` and, when `require_anchor`, raises `ForcedRebuildRefusedError("account_flow_source_unreadable") from None`, before any trade request; the refusal propagates through `_crawl_account_key` and `_crawl_whole_account` (`isinstance(outcome, ForcedRebuildRefusedError)` -> `raise outcome`) to the `except ForcedRebuildRefusedError` arms that return `_forced_refusal_result` before the persist half; the token is a member of `FORCED_REBUILD_ACCOUNT_REASONS`; tests `test_a_forced_bybit_read_whose_flow_source_is_unreadable_refuses_by_name`, `test_a_forced_bybit_job_on_an_unreadable_flow_source_fails_permanent_and_writes_nothing` (no row, marker or audit completion written) | closed |
| T-180-20 | Denial of service | transient fault turned into a permanent refusal or failure | medium | mitigate | only the permanent venue classes plus the reader's own class are caught in `_fetch_and_price_window`; a transient class is not in the tuple and propagates as the same object; tests `test_a_transient_flow_source_fault_is_not_a_refusal`, `test_an_unforced_transient_flow_fault_still_retries` (error_kind `transient`, nothing written) | closed |
| T-180-21 | Tampering | pre-midnight crawl mislabelled as an unreadable flow source | medium | mitigate | `equity_reconstruction.py::_refuse_bybit_start_past_terminus(start_ms, now_ms)` is called before the `try` that wraps `fetch_bybit_unified_flows`, so its `ccxt.BadRequest` never reaches the flow-source handler; `_fetch_bybit_trades` calls the same helper; `tests/test_bybit_two_year_window.py` keeps the `account_key_read_failed` disposition | closed |
| T-180-22 | Repudiation | runbook and code disagreeing on the token set | medium | mitigate | `FORCED_REBUILD_REFUSAL_REASONS` has 17 tokens (new `account_flow_source_unreadable` in `FORCED_REBUILD_ACCOUNT_REASONS`); `docs/runbooks/marksource-okx-history-correction.md` states 17 and lists the token in the record-only list; `tests/test_reconstruct_force_rebuild.py::test_the_runbook_lists_every_refusal_token_once` | closed |
| T-180-23 | Information disclosure | refusal and failure text | low | mitigate | `ForcedRebuildRefusedError.__init__` builds `forced rebuild refused (<reason>)` only; the flow-source raise is `from None`, with one warning carrying `type(exc).__name__` only; `services/job_worker.py::classify_exception` arm for `BybitUnifiedFlowReadError` returns `("permanent", str(exc)[:500])`, and that text is static by construction (`_refuse`, `walk_paginated` ceiling); tests assert `LEAKED_SIGNATURE` absent from the refusal text, the log and the cause chain | closed |
| T-180-24 | Denial of service | backfill worker start command | high | mitigate | operator plan 08 Task 1 (`worker-restored: yes` gated in GATES_OK); no code surface | pending-operator |
| T-180-25 | Tampering (data integrity) | forced rebuild of a6 over a shut gate | high | mitigate | operator plan 08 Tasks 2 and 3 (OPTION_OK / DECISION_OK refuse `rebuild` unless a6's gate is `ok`); code backstop already in place: a forced rebuild over an unreadable flow source refuses and writes nothing (T-180-19) | pending-operator |
| T-180-26 | Tampering | deploy mismatch | medium | mitigate | operator plan 08 import check (`0 17 True True True True True True`); code backstop already in place: `DEPLOYED_ER_NAMES` plus `missing_deployed_names()` make `run()` refuse before any decrypt, and the probe does not import `services.bybit_unified_flows` (`grep -ac` = 0) | pending-operator |
| T-180-27 | Information disclosure | SUMMARY and `TODOS.md` | high | mitigate | operator plan 08 uuid, ten-plus digit and home-path gates; code half already closed: emitter allow-list (T-180-01, T-180-09, T-180-33) | pending-operator |
| T-180-28 | Tampering | wrong database | high | mitigate | operator plan 08 marker query (`shobj_description`) before any write; no code surface | pending-operator |
| T-180-29 | Repudiation | ledger closes | medium | mitigate | operator plan 08 Task 3 DECISION_OK if-and-only-if checks | pending-operator |
| T-180-30 | Denial of service | flow read re-run on every claim of a multi-claim unforced job | low | accept | see Accepted Risks Log AR-180-30 | accepted |
| T-180-31 | Denial of service | unreadable Unified read retried by the queue (about 210 requests a retry) | medium | mitigate | `services/job_worker.py::classify_exception`: `isinstance(exc, BybitUnifiedFlowReadError)` returns `permanent`, placed above the HTTPException, geo-block and ccxt arms; `tests/test_job_worker.py::test_a_bybit_unified_flow_read_error_is_permanent`; `test_an_unforced_bybit_read_whose_flow_source_is_unreadable_fails_loud_and_writes_nothing` (FAILED, `permanent`, nothing written) | closed |
| T-180-32 | Tampering (data integrity) | a census row of another type counted | medium | mitigate | `bybit_funding_record.py::_read_census._fetch_page` raises `EvidenceShapeError("census row is not of the requested type")` when `item.get("type") != req.inst_type`, before `sink.rows.extend`; state becomes `malformed` via `_state_of`; `CENSUS_LOG_TYPES` disjoint from `UNIFIED_FLOW_TYPES` (`test_the_flow_types_are_the_probes_and_disjoint_from_the_census`) | closed |
| T-180-33 | Information disclosure | a fully populated evidence record | high | mitigate | `tests/test_allocator_history_probe.py::test_a_fully_populated_evidence_record_is_emitted_and_leaks_nothing` (every funding key differs from its default, so a leak had every chance to show; needles and stamps absent from stdout and stderr); passes at HEAD | closed |
| T-180-SC | Tampering | npm/pip/cargo installs | low | accept | see Accepted Risks Log AR-180-SC | accepted |

*Severity: critical > high > medium > low. Only OPEN threats at or above `block_on: high` count toward `threats_open`.*
*Counts: 34 registered (T-180-01..33 plus T-180-SC): 25 closed, 3 accepted, 6 pending-operator, 0 open.*

---

## Pending operator verification (plan 08 has not run)

T-180-24 (high), T-180-25 (high), T-180-26 (medium), T-180-27 (high), T-180-28 (high), T-180-29 (medium) are controls of a procedure, not of this diff: a temporary start-command change on a PROD service, a guarded forced-rebuild enqueue, a marker query, and redaction gates over a tracked SUMMARY and `TODOS.md`. They are recorded as PENDING-OPERATOR and are not counted in `threats_open`. They need an auditor pass over `180-08-SUMMARY.md` after plan 08 runs: `worker-restored: yes` written before any gate line, `import-check:` exactly the plan's expected line, `rebuild-marker: names PRODUCTION` before any enqueue, `rebuild-option: rebuild` only with a6's gate `ok`, and the uuid, digit-run and home-path greps over the SUMMARY and the added `TODOS.md` lines. Code-side backstops that already exist are named in the table (T-180-19, T-180-26, T-180-27).

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-180-16 | T-180-16 | The Bybit transfer fix applies to every caller of `fetch_ccxt_transfers` (D-02, "for every caller"): the live broker-dailies and composite stitch lists now hold the rows past a 50-row page that the venue already held; no row the venue held before is dropped, and the walk raises (`TransferPageStalled`) rather than return a short list. The change is named for the CHANGELOG in `180-05-SUMMARY.md`, section "Live-reader effect (for the CHANGELOG)". | plan threat model (D-02) | 2026-10-29 |
| AR-180-30 | T-180-30 | An unforced multi-claim Bybit job re-reads the Unified flows on each claim (about 210 requests, about 90 s) against the 900 s soft claim budget `_TRADE_READ_CLAIM_BUDGET_S`; the trade windows are stored so the job still progresses. The cost is stated in the code comment in `equity_reconstruction.py::_fetch_and_price_window` and in `180-06-SUMMARY.md`. | plan threat model | 2026-10-29 |
| AR-180-SC | T-180-SC | No dependency file changed: the diff touches only `analytics-service/services`, `analytics-service/scripts`, `analytics-service/tests` and one runbook. | plan threat model | 2026-10-29 |

---

## Unregistered Flags

SUMMARY `## Threat Flags` sections of plans 01 to 07 all read "None" and each maps to registered IDs. No unregistered flag.

### Non-blocking observations (not registered threats, no action required for ship)

- **Static pin coverage is snake_case only.** The `private_(post|put|delete)_` pins in `tests/test_bybit_funding_record.py` and `tests/test_allocator_history_probe.py` do not match ccxt's camelCase spellings (`privatePost...`). The only camelCase venue names in the diff are the two GETs in `services/ccxt_flow_fetch.py` (`privateGetV5AssetDepositQueryRecord`, `privateGetV5AssetWithdrawQueryRecord`), confirmed by grep; there is no static pin on that file. A future camelCase write name would not turn a test red.
- **`OverflowError` edge.** `bybit_unified_flows.py::_amount_of` and the probe mirror `_reader_accepts_unified_row` catch `TypeError` and `ValueError` only; a JSON integer above float range (about 1e308) would raise `OverflowError` out of `float()`, uncaught as `BybitUnifiedFlowReadError`. Bybit sends amounts as strings, so this needs a pathological answer; the message is static and no write results (the forced path would classify it as an unknown fault and retry).
- **Pagination contract (SFH M-2, accepted by the caller in review).** A full 50-row Unified page with an empty cursor ends its window as complete, on Bybit's documented cursor-authoritative contract. Recorded in `180-REVIEW-FIX.md`, not a security threat.
- **Working tree at audit time.** `git status` showed an uncommitted edit to `analytics-service/services/equity_reconstruction.py` that replaces the `fetch_bybit_unified_flows` call with the on-chain pair (a mutation proof by the parallel agent, not part of the branch). This audit reads HEAD; the verdict assumes that edit is restored before commit.

---

## Verification performed

- Read the eight `<threat_model>` blocks, summaries 01 to 07, `180-REVIEW-FIX.md` (rounds 1 to 3) and the Security Domain of `180-RESEARCH.md`.
- Read in full at HEAD: `services/bybit_unified_flows.py`, `scripts/bybit_funding_record.py`; read the diffs of `services/ccxt_flow_fetch.py`, `services/job_worker.py`, `services/equity_reconstruction.py`, `scripts/allocator_history_probe.py` and the runbook.
- Grep of the four changed source files for venue write names, exception-message reads and scrub calls (none found where the register forbids them).
- Ran `tests/test_bybit_funding_record.py`, `test_bybit_unified_flows.py`, `test_ccxt_flow_fetch.py`, `test_allocator_history_probe.py`, `test_reconstruct_force_rebuild.py`, `test_job_worker.py`: 480 passed, 1 skipped, before the working-tree edit above appeared. No source file was modified by this audit.

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Accepted | Pending operator | Open | Run By |
|------------|---------------|--------|----------|------------------|------|--------|
| 2026-10-29 | 34 | 25 | 3 | 6 | 0 | gsd-security-auditor (ASVS L1, block_on high) |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [ ] Plan 08 operator threats (T-180-24..29) verified after the plan runs (pending)
