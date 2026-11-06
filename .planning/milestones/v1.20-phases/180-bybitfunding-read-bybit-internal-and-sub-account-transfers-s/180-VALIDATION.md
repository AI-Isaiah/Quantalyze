---
phase: "180"
slug: "bybitfunding-read-bybit-internal-and-sub-account-transfers-s"
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: "2026-10-28"
---

# Phase 180 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Source: `180-RESEARCH.md` § Validation Architecture.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | pytest with pytest-asyncio (`asyncio_mode = auto`), run from `analytics-service/` |
| **Config file** | `analytics-service/pytest.ini`, `analytics-service/pyproject.toml` |
| **Quick run command** | `cd analytics-service && python -m pytest tests/test_ccxt_flow_fetch.py tests/test_bybit_unified_flows.py tests/test_allocator_history_probe.py -q` |
| **Full suite command** | `cd analytics-service && pytest -n auto --dist loadgroup --cov=services --cov=routers --cov=main_worker --cov-report=term-missing --cov-fail-under=80` |
| **Type gate (CI, verbatim)** | `mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py` |
| **Probe type check** | `mypy --strict --follow-imports=silent --config-file=pyproject.toml scripts/allocator_history_probe.py` |
| **Estimated runtime** | ~10 seconds (quick run) |

---

## Sampling Rate

- **After every task commit:** the focused pytest set for the touched file + CI's mypy line
- **After every plan wave:** the quick run plus `tests/test_reconstruct_force_rebuild.py tests/test_bybit_two_year_window.py tests/test_trade_pages.py tests/test_exchange_pagination.py`
- **Before `/gsd-verify-work`:** full suite green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

Filled by the planner per task; the requirement-to-test map in `180-RESEARCH.md` § Validation Architecture is the source (SC-1, SC-2, D-03, time budget). SC-3 is an operator checkpoint, not an executor task.

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

Every row's automated command is the task's `<automated>` block in its PLAN.md (focused tests by node id, then the file-level run, the probe mypy line and CI's mypy line verbatim, from `analytics-service/`). "Mutation" names the plan's neuter (procedure: byte backup, neuter, named test RED, restore from the backup, `cmp` clean); the executor records each in the plan SUMMARY's `## Mutation checks`.

| Task | Requirement | Behaviour | Automated (named tests) | Mutation seen RED | Status |
|------|-------------|-----------|-------------------------|-------------------|--------|
| 180-01 T1 (tracer) | SC-1, D-03 | A Bybit member's on-chain deposit evidence reaches the emitted account record | `test_a_bybit_members_onchain_deposit_evidence_reaches_the_account_record`; vocabulary and no-writer pins | tracer test RED before the splice | ⬜ |
| 180-01 T2 | SC-1, D-03 | Five sources each read their own endpoint, window and success status; key info read strictly; a sub key never calls the master-only source; a refusal is a state, never a 0; evidence runs after the snapshot | `test_each_evidence_source_reads_its_own_endpoint_window_and_success_status`, `test_the_key_info_is_read_strictly_and_never_keeps_an_id`, `test_a_master_only_source_is_not_called_for_a_sub_key`, `test_a_source_the_key_cannot_read_is_a_state_never_a_count`, `test_a_malformed_page_or_a_page_cap_is_named`, `test_age_buckets_match_the_probes`, `test_the_evidence_runs_after_the_snapshot_and_changes_no_member_outcome` | m1 status filter dropped, m2 raised source as `read` 0, m3 master-only called for a sub key, m4 evidence before the snapshot | ⬜ |
| 180-02 T1 (tracer) | SC-1, reading 3 | The transfer-like census of eight log types reaches the emitted account record as one count and a state | `test_the_census_counts_transfer_like_log_rows_under_its_own_bound`, `test_a_bybit_members_census_reaches_the_account_record` | m1 census type check dropped | ⬜ |
| 180-02 T2 | SC-1, reading 4 | 420 s per source and a timeout is a state; never raises; 35 funding keys; read-only static pin; a full record leaks nothing; Earn limitation stated | `test_a_source_past_its_bound_is_a_timeout_and_the_next_source_still_runs`, `test_measure_funding_never_raises_and_returns_only_funding_keys`, `test_the_funding_keys_are_the_written_list`, `test_the_record_module_names_only_read_endpoints`, `test_a_fully_populated_evidence_record_is_emitted_and_leaks_nothing` | m2 timed-out source recorded as `read` | ⬜ |
| 180-03 T1 (tracer) | D-01 | The rebuild's own Unified-log rows become the gate's deposit and withdrawal kinds | `test_the_unified_log_rows_the_rebuild_reads_are_its_deposits_and_withdrawals`, `test_a_member_that_never_reads_the_unified_log_prints_not_run`, `test_the_bybit_transfers_verdict_needs_both_kinds_on_a_full_bybit_window` | m1 TRANSFER_OUT mapped to deposits | ⬜ |
| 180-03 T2 | SC-1 | A failed or malformed Unified read is named and re-raised; a contradicting sign is counted; the funding explanation is derived | `test_a_unified_log_call_that_raises_is_named_and_reraised`, `test_a_malformed_unified_answer_is_named_and_handed_back_unchanged`, `test_a_unified_row_whose_sign_contradicts_its_type_is_counted`, `test_other_log_types_are_not_recorded`, `test_the_funding_explanation_is_derived_from_the_unified_edge_and_the_evidence` | m2 wrapper swallows the raise, m3 `explained` branch dropped | ⬜ |
| 180-03 T3 | D-03, SC-3 | A shut gate prints its named cause; a transient Unified fault reads `read_incomplete`, a permanent one `flow_source_unreadable`; vocabulary pins; lineage-kept docstrings | `test_the_bybit_transfers_cause_names_why_the_gate_is_shut`, `test_a_shut_bybit_gate_prints_its_cause_and_the_funding_explanation`, `test_the_unified_keys_refuse_values_outside_their_vocabulary`, `test_every_rebuild_name_the_probe_reads_is_declared` | m4 flow-source refusal not tested in the cause, m5 cause `none` on either kind, m6 transient states mapped to `flow_source_unreadable` | ⬜ |
| 180-04 T1 (tracer) | D-01 | One TRANSFER_IN row becomes a deposit the replay reads, over tiled 7-day windows asking both types | `test_one_transfer_in_row_becomes_a_deposit_the_replay_can_read`, `test_the_unified_read_asks_both_types_over_tiled_seven_day_windows` | tracer test RED before the module exists | ⬜ |
| 180-04 T2 | SC-2 | Every page of a window is read; a repeated cursor on a page with rows or the page cap raises; an empty page ends its window | `test_every_page_of_a_window_is_read`, `test_a_repeated_cursor_raises_and_stops_at_once`, `test_an_empty_page_ends_the_window_even_when_its_cursor_repeats`, `test_a_window_past_the_page_cap_raises` | m1 `nextPageCursor` ignored (dropped page), m2 repeated-cursor raise deleted | ⬜ |
| 180-04 T3 | D-01, SC-2, reading 3 | Rows normalised or refused; venue errors pass through; the probe recorder sees the read; flow types disjoint from the census | `test_a_row_is_normalised_or_refused`, `test_a_row_of_another_type_is_refused`, `test_a_row_read_twice_is_counted_once`, `test_a_malformed_answer_is_refused`, `test_venue_errors_pass_through_unchanged`, `test_the_probe_recorder_sees_the_unified_read_as_deposits_and_withdrawals`, `test_the_flow_types_are_the_probes_and_disjoint_from_the_census` | m3 direction from the sign, m4 `funding` before `change`, m5 type check dropped, m6 PermissionDenied swallowed | ⬜ |
| 180-05 T1 (tracer) | D-02, SC-2 | A Bybit transfer window served newest first returns every row through `fetch_ccxt_transfers` | `test_a_bybit_window_holding_more_than_one_page_returns_every_row`, `test_bybit_backfill_bounds_interval_and_passes_endtime`, `test_bybit_windows_tile_the_full_history_without_gaps`, `test_non_bybit_keeps_90_day_window` | m1 Bybit routed through the generic loop (dropped page) | ⬜ |
| 180-05 T2 | D-02, WR-04 | A stalled cursor raises; a missing cursor ends the window; NotSupported returns what was read; a boundary row counts once | `test_a_repeated_bybit_cursor_raises_instead_of_truncating`, `test_a_bybit_page_without_a_cursor_ends_the_window`, `test_not_supported_on_a_later_bybit_page_returns_what_was_read`, `test_a_boundary_row_two_windows_return_is_kept_once` | m2 stall raise replaced by `break` | ⬜ |
| 180-06 T1 (tracer) | D-01, SC-2, reading 1 | A Bybit rebuild reads the Unified flows before its trades and replays only them; per-claim cost stated | `test_the_bybit_replay_takes_only_the_unified_flows`, `test_the_bybit_flows_are_read_before_the_trades`, `test_only_the_rebuild_reads_the_unified_flows`, the two midnight-crossing tests | m1 on-chain-only read, m2 add-both read, m3 flows read after the trades | ⬜ |
| 180-07 T1 (tracer) | D-03 | 17th refusal token on the forced path; transient faults pass through; two-year guard outside the refusal; vocabulary, pins and runbook moved together | `test_forced_rebuild_refusal_reasons_are_a_closed_set`, `test_a_forced_bybit_read_whose_flow_source_is_unreadable_refuses_by_name`, `test_a_transient_flow_source_fault_is_not_a_refusal`, `test_the_runbook_lists_every_refusal_token_once`, `test_the_two_year_refusal_adds_no_token`, `test_the_two_year_guard_runs_before_the_flow_read_and_outside_its_refusal`, `test_the_declared_vocabulary_is_the_rebuilds_own_refusal_tokens`; import line `0 17 True True True True True True` | m1 token raised through a variable, m2 caught tuple widened to `Exception`, m3 two-year guard inside the refusal, m4 token removed from the runbook | ⬜ |
| 180-07 T2 | reading 2 | An unforced unreadable Unified read fails permanent with nothing written (PermissionDenied and the four reader causes); transient classes still retry | `test_a_bybit_unified_flow_read_error_is_permanent`, `test_an_unforced_bybit_read_whose_flow_source_is_unreadable_fails_loud_and_writes_nothing`, `test_an_unforced_transient_flow_fault_still_retries` | m5 token on the unforced path, m6 classifier arm deleted | ⬜ |
| 180-08 T1 (operator) | SC-1, SC-2, SC-3 | Founder-approved deployed probe; a6's per-source, Unified and gate lines copied from its record | GATES_OK chain | 7 synthetic-SUMMARY mutations RED at planning time (bash and zsh) | ⬜ |
| 180-08 T2 (operator) | SC-3 | Founder decides a6's rebuild; `rebuild` only over an open gate | OPTION_OK chain | `rebuild` over a shut gate RED at planning time | ⬜ |
| 180-08 T3 (operator) | SC-3, D-02, reading 3 | Guarded rebuild only on `rebuild`; dated readings; if-and-only-if closes; routed items | DECISION_OK chain | 13 scratch-repository mutations RED at planning time (bash and zsh) | ⬜ |

---

## Wave 0 Requirements

Each double is created inside the plan that first needs it (no separate Wave 0 plan); the tracer task of that plan is its first consumer.

- [ ] `tests/_bybit_evidence.py` (new, plan 01; plan 02 adds the transaction-log method) — `EvidenceBook`: per-source rows, newest-first windows, 50 per page, opaque cursor, status values, scripted refusals
- [ ] `tests/test_bybit_funding_record.py` (new, plan 01; plan 02 adds five tests)
- [ ] `tests/test_bybit_unified_flows.py` (new, plan 04)
- [ ] `tests/_trade_pages.py` (plan 04) — `unified_flow`, `UnifiedLogBook` (newest first, 50 per page, opaque cursor, `type` filter, `repeat_cursor`, `wrong_type`) and `install_unified_log` for `AsyncMock` Bybit exchanges
- [ ] Sweep (plan 06) — `_crawl_exchange` in `tests/test_reconstruct_marker_writer.py` answers an empty Unified log; `tests/test_equity_reconstruction.py::test_history_depth_months_per_venue` and the quiet-first-week test in `tests/test_trade_pages.py` install it
- [ ] Edits: `tests/test_allocator_history_probe.py` (plans 01, 02, 03), `tests/test_ccxt_flow_fetch.py` (plan 05), `tests/test_reconstruct_force_rebuild.py` and `tests/test_bybit_two_year_window.py` (plan 07), `tests/test_job_worker.py` (plan 07)

`tests/test_exchange_pagination.py` needs no edit: `walk_paginated` is reused unchanged, and its four transfer tests (a non-Bybit capped fetcher) must pass unchanged after plan 05.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Post-deploy probe re-reads a6; gate `ok` or `unmeasured` with a named cause; founder rebuild decision | SC-3 | Needs the deployed worker and a real Bybit key | Orchestrator operator checkpoint after deploy, founder-approved |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] Data-integrity gates proven RED by neuter → RED → restore from a byte backup
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
