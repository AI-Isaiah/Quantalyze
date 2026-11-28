---
phase: 223
slug: flowkinds-every-derive-and-compose-path-reads-the-same-capit
status: secured
asvs_level: 2
block_on: high
threats_total: 14
threats_closed: 14
threats_open: 0
audited_at_sha: a1aeda57a474819c06942150b52c0b2eb02fe18a
audited_range: 62c402d19..HEAD -- analytics-service
---

# Phase 223 Security Verification

Verified against the implemented code in the worktree (not against SUMMARY prose). Plans 01 to 05, 14 register rows (T-223-01 to T-223-13 plus the T-223-SC install row repeated per plan, counted once).

## Threat verification

| Threat ID | Category | Severity | Disposition | Status | Evidence |
|-----------|----------|----------|-------------|--------|----------|
| T-223-01 | Tampering | high | mitigate | CLOSED | `analytics-service/services/okx_archive_job.py` `_live_reference`: `fetch_funding_okx(..., on_malformed="raise")` inside `_within`, `except FundingRowsMalformed` -> `raise _Stop("live_anchor_unusable", "live_funding=malformed") from None`. `_live_reference` is called from `_evaluate` (`_evaluate` L2267), which `_run_evaluation` awaits before `_apply_targets` (L2534); `_Stop` is caught by the handler and routed to `_finish_stop` (L2556/2586/2601). `funding_fetch._raise_if_malformed("okx", ...)` fires after the walk (L641). Pinned by `tests/test_okx_archive_apply.py::TestLiveFundingMalformed` (parametrized calibrate and apply, `_no_writes_but_progress`, `_apply_calls(db) == []`, plus a clean-read negative control). |
| T-223-02 | Information disclosure | low | mitigate | CLOSED | Detail is the fixed literal `"live_funding=malformed"`; `from None` drops the chain (which carried only venue and count). Test asserts the exact string `okx_archive_rebuild: live_anchor_unusable live_funding=malformed`. |
| T-223-03 | Repudiation | low | mitigate | CLOSED | `_finish_stop` sets `result["stop_class"]` and awaits `_write_result` before returning FAILED (L443-L470); test reads `world.result()["stop_class"] == "live_anchor_unusable"`. |
| T-223-04 | Denial of service | medium | mitigate | CLOSED | `daily_pnl_read_verdict` (`services/exchange.py`) builds reasons only from fetch_error, binance fallback, `daily_pnl_truncated_*`, `daily_pnl_deadline_*`; no `malformed` term, so D-12 holds. `tests/test_daily_pnl_read_verdict.py::test_a_dropped_malformed_row_is_not_a_reason_the_key_keeps_publishing` asserts `reasons == ()` for okx, bybit and binance. Guard grep re-run: `daily_pnl_malformed` has 0 mentions in `routers/cron.py` and `services/okx_archive_job.py` (the other two readers). |
| T-223-05 | Information disclosure | low | mitigate | CLOSED | The `daily_pnl_read_verdict` docstring and the test docstring carry only "0 flags", the date and the founder ruling. Regex scan of the `analytics-service` diff and `223-PROD-MALFORMED-COUNT.md` for supabase project refs, UUIDs and `\/Users\/` paths: 0 hits. |
| T-223-06 | Tampering | medium | mitigate | CLOSED | `funding_fetch.bybit_funding_windows` calls the same `exchange_pagination._windows(start, now_ms, 7)` that `walk_paginated` iterates (next start = prev end + 1 ms, span at most 7 d). `fetch_funding_bybit(until_ms=...)` bounds `now_ms` and sends no request on an empty or inverted range. Pinned by `tests/test_funding_fetch.py::TestBybitUntilMs` (`..._windows_equals_the_windows_one_walk_sends`, until bounds every request, until==since sends none, 365 d lookback from until, 53 contiguous windows). I also traced the edge: each helper window re-walked with `_windows(w_start, w_end, 7)` yields exactly one window. |
| T-223-07 | Tampering | high | mitigate | CLOSED | `job_worker.run_sync_funding_job` Bybit arm iterates `bybit_funding_windows` oldest first and calls `_store_funding_window` after each window. `_store_funding_window` does `sorted(rows, key=timestamp)`, slices by `FUNDING_UPSERT_BATCH_SIZE` (500), calls the unchanged `upsert_funding_rows` per slice, and returns FAILED transient at the first slice with errors, so no newer row is stored over an unstored older one. Pinned by `TestC27WindowedBybitWalk` (`test_c27_*`: ascending order and ties, 500-row slices, stops at first failing slice, resume point, empty window, 429 mid-walk). |
| T-223-08 | Repudiation | medium | mitigate | CLOSED | Region guard re-run over `run_sync_funding_job` and `_store_funding_window`: 0 matches for `CancelledError`, `TimeoutError`, `wait_for`, `asyncio.timeout`; the only `except Exception` is the pre-existing `aclose_exchange` in `finally`. `_classify` maps `asyncio.TimeoutError` to transient `Handler exceeded timeout` (`job_worker.py` L1262). Pinned through the real `dispatch` and `wait_for` by `test_c27_a_cancelled_walk_keeps_the_windows_it_finished_and_fails_transient` (FAILED, transient, message starts `Handler exceeded timeout`). Note: the region guard exists as a one-time check recorded in the plan 04 SUMMARY, not as a persisted test. |
| T-223-09 | Denial of service | low | accept | CLOSED (accepted) | Recorded in `223-04-SUMMARY.md` ("a key without inverse scope now sends one refused inverse request and one WARNING per window") and in the plan register. See accepted risks log. |
| T-223-10 | Denial of service | low | accept | CLOSED (accepted) | Window list is finite (`_windows` terminates when `w_start >= now_ms`); `max_attempts` unchanged; no new loop beyond it. See accepted risks log. |
| T-223-11 | Information disclosure | low | accept | CLOSED (accepted) | `_store_funding_window` reuses the H-1115 message shape (`upsert_errors[:3]`); `upsert_funding_rows` truncates each error to 200 characters (`str(exc)[:200]`). See accepted risks log. |
| T-223-12 | Tampering | medium | accept | CLOSED (accepted) | The drop is logged with venue and count in all three fetchers (`binance/okx/bybit funding_fetch: dropped %d malformed rows`, `funding_fetch.py` L478, L637, L866); `run_sync_funding_job` passes no `on_malformed` (grep: the word occurs only in its docstring); the docstring records the decision, readers and revisit trigger; pinned for all three venues by `TestSyncFundingMalformedRowDecision`. |
| T-223-13 | Denial of service | low | mitigate | CLOSED | The caller keeps the default `drop`: no `on_malformed="raise"` in the sync arms (`job_worker.py`; the only `raise` call sites are the unrelated derive paths at L8765-8779). `TestSyncFundingMalformedRowDecision` runs the real fetchers and asserts DONE plus the good row stored; a caller that raised would hit `FundingRowsMalformed` and fail the test. |
| T-223-SC | Tampering | low | accept | CLOSED (accepted) | Diff touches no `requirements*.txt`, `pyproject`, lockfile or `package.json` (file list: 4 service files, 6 test files). |

## Accepted risks log

| Threat ID | Accepted risk | Basis |
|-----------|---------------|-------|
| T-223-09 | A key without inverse scope sends one refused inverse request per Bybit window (about 53 on a first walk, two or three a day after). | Bounded by the finite window list; recorded in 223-04-SUMMARY.md. |
| T-223-10 | A long first walk can be cut by the 180 s budget and retried. | Finite windows, `max_attempts` 3, each attempt keeps stored windows and the daily cron resumes from the cursor. |
| T-223-11 | Upsert error text (at most three, 200 characters each) can reach `compute_jobs.last_error`. | Unchanged H-1115 shape. |
| T-223-12 | `run_sync_funding_job` drops a malformed funding row and ends DONE. | No published number reads `funding_fees` (readers per docstring: `reconstruct_positions` with no non-test caller, GDPR export, `sanitize_user`, `scripts/bybit_reconcile.py`); revisit when a published reader appears. This is a sync-time decision only. |
| T-223-SC | No package installed or bumped. | Verified against the diff. |

## Unregistered flags

None. All five SUMMARY `## Threat Flags` sections state "None" or map to a registered id (plan 04: T-223-07, T-223-08; plan 05: T-223-12, T-223-13; plan 03: T-223-06).

## Informational (non-blocking, no threat mapping required)

- 223-REVIEW.md SFH-1 (MEDIUM, booked as a known limit): empty leading Bybit windows do not advance the funding cursor. Availability and efficiency only, not a security property; no published reader of `funding_fees`.
- A Bybit key whose stored cursor is very old produces many windows (finite, not capped at 53 except on an empty table). Bounded by the handler budget plus the cursor resume. Not a gap against any declared threat.
- The T-223-08 region guard is not persisted as a test; the behavioural pin (cancelled walk through the real `dispatch`) is what keeps the property under CI.

**threats_open:** 0

## Security Audit 2026-11-28

| Metric | Count |
|---|---|
| Threats found | 14 |
| Closed | 14 |
| Open | 0 |

Re-run by `/gsd-secure-phase 223` at origin/main 98178ff2b (ASVS 1, block_on high): an independent gsd-security-auditor re-verified all 14 register rows at HEAD and agrees with the verdict above (SECURED, 0 open). The file was renamed from `SECURITY.md` to `223-SECURITY.md` in the same change, because the workflow and the milestone audit look for `*-SECURITY.md` and reported the phase as having none.
