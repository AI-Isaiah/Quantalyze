---
status: passed
verified_at_sha: c245999bd7d21e3285cdb4a35a678f992f834439
drift_subjects:
  - analytics-service/services/exchange.py
  - analytics-service/services/job_worker.py
  - analytics-service/services/funding_fetch.py
  - analytics-service/services/bybit_unified_flows.py
  - analytics-service/services/allocator_equity_compose.py
  - analytics-service/services/allocator_equity_derive.py
  - analytics-service/services/analytics_runner.py
  - src/lib/queries.ts
  - src/app/(dashboard)/allocations/AllocationDashboardV2.tsx
  - supabase/migrations/20261105120000_sync_status_protect_refused_derive.sql
  - supabase/schema/functions/sync_strategy_analytics_status.sql
---

# Phase 186: DERIVEGAPS Verification Report

**Phase Goal:** The new curve's path (per-key `derive_broker_dailies` plus the compose) carries the protections the legacy engine got from ACCTREBUILD, TRADEPAGES, READCEILING, OKXANCHOR, OKXREWRITE and BYBITFUNDING. A truncated or failed realized or funding read refuses that key by name; Bybit Unified internal, sub-account and universal transfers are flows, not P&L; a failing key is left out or flagged on its own while the rest of the book draws normally.
**Verified:** 2026-11-05, branch `feat/186-derivegaps` at the sha above. The branch's source tree equals the shipped merge (`8f452313`, PR #1197): `git diff 8f452313 HEAD -- . ':!.planning'` touches only CHANGELOG.md, VERSION and package.json.
**Status:** passed
**Re-verification:** No, initial verification.

Method: ROADMAP `### Phase 186` SC-1..SC-7 are the contract. Each was checked against the code, not the SUMMARYs. Test evidence was re-run in this session (below).

## Goal Achievement

### Observable Truths

| # | Success criterion | Status | Evidence |
|---|---|---|---|
| SC-1 | A read-only PROD count of the keys each gap affects is recorded before any code change | VERIFIED | 186-01 SUMMARY holds the database counts (marker query first, `marker: PRODUCTION`, no writing statement). 186-04 SUMMARY holds the venue probe records and the `g1-*`/`g2-*`/`g4-pairs` gate lines. Commit order: the 186-01 and 186-04 doc commits (2026-11-03 19:29 and 22:27) precede the first code commit to `exchange.py`/`job_worker.py` (`714d1ac97`, 22:37). |
| SC-2 | A truncated or failed realized or funding read refuses that key by name and is never published as complete; a test goes RED on the old behaviour | VERIFIED | Realized: `fetch_all_trades(..., read_deadline_s=DAILY_PNL_READ_DEADLINE_S)` is followed on the next statement by `get_and_clear_last_dq_flags()` and `daily_pnl_read_verdict()` (`job_worker.py`, `run_derive_broker_dailies_job`). Any reason calls `_refuse_incomplete_read(token, error_class, permanent=...)`, which returns before any series, `key_inputs`, nav mark or compute enqueue. In key mode it writes only the owner-only `read_incomplete:<api_key_id>` marker (closed token set `READ_INCOMPLETE_TOKENS`, class name only, never venue text) and enqueues the compose. Funding: all three funding fetchers take `on_malformed="raise"`; `PaginationCeilingExceeded` and `FundingRowsMalformed` refuse (`funding_truncated`, `funding_rows_malformed`), other funding errors are named `funding_fetch_error`, timeouts `read_timeout`. The Bybit swallowed-error arm sets `daily_pnl_fetch_error` (pre-existing 164.5.1.4), so it is covered. Tests re-run: `test_okx_truncation_refuses_the_key_and_writes_only_the_marker`, `test_bybit_truncation_is_refused_permanently`, `test_binance_income_fallback_is_refused_permanently`, `test_a_funding_page_ceiling_is_refused_permanently`, `test_malformed_funding_rows_are_refused_and_asked_for_with_raise`, `test_a_clean_read_is_not_refused`. Founder decisions honoured: D-05 (hold last good, name it), D-06 (caps sized from SC-1, deadline inside the walk), D-10 (`BYBIT_CLOSED_PNL_LIMIT = 100`), D-11 (migration `20261105120000` makes the status updater treat a refused derive over published figures as protected), D-12 (a malformed realized row is flagged, not refused: `daily_pnl_read_verdict` ignores `daily_pnl_malformed_*`, the flag is persisted via the pre-stamp and carried by `run_csv_strategy_analytics`), D-13/D-14 (marker only on a final refusal; a retryable refusal over figures writes nothing). |
| SC-3 | Bybit derive counts Unified internal and sub-account transfers as flows; an internally funded account shows no P&L spike | VERIFIED | For `venue == "bybit"` the derive calls `fetch_bybit_unified_flows(ctx.exchange, _flow_since_ms, now_ms)` instead of the two on-chain `fetch_ccxt_transfers` reads (REPLACE, per the SC-1 overlap count, so nothing counts twice); every other venue keeps the on-chain reads. A failed Unified read is named `bybit_unified_flow_error`. Tests re-run: `test_oracle_b_the_marks_show_no_pnl_spike_on_the_transfer_day`, `test_unified_rows_replace_the_on_chain_reads_and_count_once`, `test_a_unified_withdrawal_is_a_negative_flow`, `test_other_venues_keep_the_on_chain_reads_and_never_read_unified`. |
| SC-4 | A failing key no longer refuses or downgrades the book; it is excluded or flagged on its own and the readers say which key | VERIFIED | `DegradeReason.FAILING_KEY_SERIES_ENDED` is removed from `_BLOCKING_REASONS` and never raised (only its enum definition remains, kept for stored pre-186 rows). In the compose block of `job_worker.py` a failing (not `working_holder_predicate`) or `read_incomplete`-marked counted key whose series ends before the book's last day goes into `departed_end_by_key` (history to its last good day, capital then leaves as a flow) and into `failing_key_exit_by_key`; a failing/marked key with no returns is exempted or dropped instead of raising `COMPOSE_INCOMPLETE`/`dropped_key` (D-08). `compose_allocator_equity` emits the benign flag `failing_key_exited` and `payload["failing_key_exits"]` (key id, closed reason, ISO day; no amount, level or venue). The TS reader `readFailingKeyExits` resolves only keys the owner holds and `AllocationDashboardV2` renders `FailingKeyExitNote` for it. Tests re-run: Python `test_sc2_failing_single_key_ending_early_exits_the_book_and_is_named` (independent hand oracle: days after the exit read exactly the working key's +1%, curve trustworthy, no `failing_key_series_ended`), `test_sc2_read_incomplete_working_key_exits_and_is_named`, `test_sc2_marked_counted_member_of_a_shared_account_exits_the_book_and_is_named`, the ten `test_failing_key_exit_*` compose tests; vitest `AllocationDashboardV2.failing-key.test.tsx` (7) and `queries.test.ts`. |
| SC-5 | A post-deploy PROD reading confirms all three | VERIFIED (see Gap 3 note) | 186-14 SUMMARY: probe re-run on the deployed worker (exit 0, worker start command restored, fingerprint matched), database reading after the first nightly fan-out on the deployed head (31 key derives and 9 compose jobs done, all 7 curves composed after deploy). `sc5-gap1: confirmed`, `sc5-gap2: confirmed`, `sc5-gap3: confirmed`, `sc5-verdict: confirmed`. Gap 2 is a NON-vacuous before/after: the one live Bybit key had `stored_flows_positive 0` at SC-1 and `1` after deploy. |
| SC-6 | Never invent data: an uncomputable day is null | VERIFIED | A refused read writes nothing (no partial days, no zero fill); the key's last good stored days stay. A named exit with no history carries `day: None` (the compose rejects any non-ISO, non-None day with `ValueError`), and a key with no returns is left out rather than given a made-up series. The marker payload holds only token, class name and ISO days. |
| SC-7 | A read-only same-hour funding-pair count per (instrument, hour) on OKX and Bybit is recorded first; if pairs exist the dedup key keeps distinct positions and a two-leg test goes RED on the current key | VERIFIED (conditional branch not triggered) | 186-04: `g4-pairs: okx=0 bybit=0 same_id=110` (the 110 are one id appearing twice in a group, which the existing dedup correctly collapses) and `q-g4: no-pairs`. 186-06 recorded `sc7: no-change` and left `_build_match_key` and the `funding_fees` unique key untouched, and added a Bybit guard test (`TestBybitKeepsBothSameHourLegs`). SC-7's key change is conditional on pairs existing; none do. |

**Score:** 7/7 truths verified. `behavior_unverified`: 0.

### Gap 3 PROD vacuity (the caller's question)

`sc5-gap3-note` is accurate: PROD has no eligible failing or marked key, now or at SC-1, so every Gap 3 count is 0 and the PROD reading only shows that no bad token (`failing_key_series_ended`, unexplained `compose_incomplete`, unnamed exit) appeared on any curve composed after deploy. It does not exercise the exit path live. Judgement: the synthetic tests do carry the exit-path proof, and they are behavioural, not presence checks. They run the real `derive_allocator_equity` job against a fake store with a failing key (status `error`) and, separately, a working key with a `read_incomplete:` marker row, and assert the resulting stored payload: the post-exit book return equals the surviving key's return to 1e-12 (an independent hand oracle, not the compose's own arithmetic), `is_trustworthy` stays true, the stored `failing_key_exits` names the key, reason and last good day, and `failing_key_series_ended` is absent. The compose-level tests pin the outflow-not-loss behaviour, the closed reason vocabulary, sort order and the no-amount-or-venue payload. The TS reader and the dashboard note have their own tests. Residual risk is limited to the live-data shape of a real failing key, which cannot be measured until one exists. No human decision is requested.

The same applies to Gap 1: the SC-1 probe found no truncated, failed or timed-out key on any venue, so the PROD reading of Gap 1 is also "none appeared" and the refusal path rests on the tests above.

### Required Artifacts

| Artifact | Expected | Status | Details |
|---|---|---|---|
| `analytics-service/services/exchange.py` | sized caps, `read_deadline_s`, `daily_pnl_read_verdict`, `daily_pnl_malformed_*` flags, Bybit limit 100 | VERIFIED | Present, substantive, imported by `job_worker.py`. |
| `analytics-service/services/job_worker.py` | refusal, markers, Unified wiring, failing-key exit | VERIFIED | `_refuse_incomplete_read`, `_record_read_incomplete`, `_clear_read_incomplete`, `_name_key_whose_derive_overran`, the compose exit block. |
| `analytics-service/services/funding_fetch.py` | `on_malformed="raise"` and `FundingRowsMalformed` | VERIFIED | All three fetchers; Bybit counts a skipped settlement as dropped. |
| `analytics-service/services/bybit_unified_flows.py` | reader wired for the derive | VERIFIED | Imported and called in the derive's Bybit branch. |
| `analytics-service/services/allocator_equity_compose.py` | `failing_key_exit_by_key` and `failing_key_exits` payload | VERIFIED | Closed reasons, ISO-day validation, benign flag. |
| `analytics-service/services/allocator_equity_derive.py` | `FAILING_KEY_SERIES_ENDED` no longer blocking | VERIFIED | Removed from `_BLOCKING_REASONS`; enum member kept for stored rows. |
| `supabase/migrations/20261105120000_sync_status_protect_refused_derive.sql` plus rollback and schema function | D-11 status protection | VERIFIED | Present with rollback and an extended SQL test file; applied to PROD (186-14 reading); main CI green with the SQL corpus. |
| `src/lib/queries.ts`, `AllocationDashboardV2.tsx` | reader and muted note | VERIFIED | `readFailingKeyExits` and `FailingKeyExitNote` wired through the page props. |

### Key Link Verification

| From | To | Via | Status |
|---|---|---|---|
| realized read | refusal | `get_and_clear_last_dq_flags` then `daily_pnl_read_verdict` then `_refuse_incomplete_read`, before any write | WIRED |
| funding read | refusal | `on_malformed="raise"` and the `PaginationCeilingExceeded`/`FundingRowsMalformed` arms | WIRED |
| refusal | compose | `read_incomplete:` marker plus `_enqueue_allocator_compose` | WIRED |
| marker/failing status | exit | `_load_read_incomplete_markers` then `marked_ids` then `departed_end_by_key` and `failing_key_exit_by_key` | WIRED |
| compose payload | UI | `failing_key_exits` then `readFailingKeyExits` then `FailingKeyExitNote` | WIRED |
| Bybit derive | Unified reader | `fetch_bybit_unified_flows` replaces the on-chain deposit/withdrawal reads | WIRED |

### Data-Flow Trace (Level 4)

The exit note renders from the stored compose payload (`failing_key_exits`) resolved against the owner's own key list; the payload is produced by the compose from real per-key inputs. No hardcoded-empty prop was found. The PROD reading cannot show it flowing (population is empty), so the flow is carried by the job-level and vitest tests above.

### Behavioural Spot-Checks (run in this session)

| Check | Result |
|---|---|
| pytest (from `analytics-service/`): `test_daily_pnl_read_verdict`, `test_allocator_equity_failing_key_exit`, `test_derive_broker_dailies_dualmode`, `test_funding_fetch`, `test_exchange_harness`, `test_derive_allocator_equity_job` | 890 passed |
| mypy `--strict --follow-imports=silent` with CI's exact file list | no issues found in 132 source files |
| vitest: `queries.test.ts`, `derive-refusal-rows.test.ts`, `writer-residual-parity.test.ts` | 232 passed |
| vitest: `AllocationDashboardV2.failing-key.test.tsx` | 7 passed |
| Debt markers (TBD, FIXME, XXX) in the phase's added source lines | none |

### Probe Execution

The phase's SC-1 and SC-5 probe (`scripts/derivegaps_probe.py`) is an operator run on the deployed worker, not a repo probe script. It ran for plan 04 and again for plan 14 (exit 0, fingerprint matched, worker restored). No repo-level `probe-*.sh` is declared by this phase. SKIPPED (operator-run, evidence recorded in 186-04 and 186-14).

### Requirements Coverage

No REQUIREMENTS.md IDs (ROADMAP: `Requirements: TBD`). SC-1..SC-7 above are the coverage. All 14 plans have SUMMARYs.

### Anti-Patterns Found

None blocking. Notes (INFO):
- `BYBIT_PNL_PAGE_CAP` was raised from 50 to 200 after review (the 186-04 probe measured 44 pages in the one Bybit key's busiest week, leaving 12% headroom). D-10 said "keeps today's caps"; D-06 ("raise the caps so a normal key reads its full history") governs and `DAILY_PNL_READ_DEADLINE_S` still bounds the walk. Consistent with the founder's intent.
- `FAILING_KEY_SERIES_ENDED` remains an enum member and in the TS token map so rows stored before Phase 186 still map to a reader line. It is never raised.
- The round-5 review left three below-threshold notes (a stale PR3-01 comment, one missing negative test for a retryable refusal with no figures, `computation_warned` staying true on a warned row's non-refusal failure, which is pre-phase behaviour). None is MEDIUM or above.

### Routed, not in scope

Booked in TODOS.md per the phase decisions: the refusal-marker read-modify-write race (`[186-REFUSAL-MARKER-RMW-RACE]`, follow-up phase), the missing name test (`[186-REFUSAL-MARKER-NAME-CONTRACT]`), the malformed-row production count (`[186-REALIZED-MALFORMED-COUNT]`), the composite member read gaps and the shared account with no working key (no PROD exposure). Bybit P&L depth (365 days against 730) was explicitly out of scope.

### Human Verification Required

None. The only item a human could add is a live failing key on PROD, which does not exist; the synthetic tests are the proof of record.

### Gaps Summary

No gaps. Every success criterion is met in the code and exercised by tests that were re-run here. The PROD post-deploy reading is non-vacuous for Gap 2 and vacuous-by-population for Gaps 1 and 3, which the tests cover.

---

_Verified: 2026-11-05_
_Verifier: Claude (gsd-verifier)_
