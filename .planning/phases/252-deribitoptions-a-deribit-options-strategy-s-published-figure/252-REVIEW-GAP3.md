---
phase: 252-deribitoptions-a-deribit-options-strategy-s-published-figure
plan: 11
reviewed: 2026-11-28T00:00:00Z
depth: standard
diff_range: 00e61bf13..f750af94c (analytics-service only)
files_reviewed: 6
files_reviewed_list:
  - analytics-service/services/job_worker.py
  - analytics-service/services/deribit_ingest.py
  - analytics-service/tests/test_stitch_composite_job.py
  - analytics-service/tests/test_composite_headline_parity.py
  - analytics-service/tests/test_nav_marks_composite_allocated.py
  - analytics-service/tests/test_deribit_options_basis_ledger.py
findings:
  critical: 0
  warning: 1
  info: 5
  total: 6
  necessity: 1
status: issues_found
---

# Phase 252: Code Review Report, gap plan 11 (the composite smoothed pass reuses the cash crawl)

**Reviewed:** 2026-11-28
**Depth:** standard, plus cross-function tracing inside `run_stitch_composite_job` and into `services/deribit_ingest.py` / `services/deribit_txn.py`
**Files Reviewed:** 6
**Status:** issues_found (1 MEDIUM, 5 LOW/Info)

## Summary

Scope: `git diff 00e61bf13..HEAD -- . ':!.planning'`. That covers `run_stitch_composite_job` (`member_cash_crawl`, `_release_cash_crawl`, `_reconstruct_deribit`, `_reconstruct_all`, the cash-pass call, step 6b), `build_deribit_options_basis_ledger`'s new `exclude_spot_extraction` keyword, and four test files.

What I checked and found sound, each traced in source and not taken from the SUMMARY:

- **Raw-row completeness and pagination.** `build_deribit_native_ledger(..., retain_raw_rows=True)` stores `tuple(raw_rows)`. That is the flat concatenation `_crawl_deribit_ledger` returns across every scope, currency and page. The cash assembly does not mutate the row dicts in place: a grep of `deribit_ingest.py`, `deribit_txn.py` and `basis_series.py` for item writes on row objects finds only `_account_summary_snapshot_row`, which builds its own dict. So the retained rows are the rows a fresh crawl would return at the cash-pass moment.
- **Shared objects between the cash and options reports.** `options_report = replace(report, ...)` is a shallow copy, so `dated_external_flows`, `entries` and `expected` are shared with the cash report. Nothing mutates them after the crawl. `dated_external_flows` is only `.extend`ed inside the crawl. The assembly reassigns `balance_identity_open_option_ccys`, `pre_coverage_option_days`, `pre_mark_retention_option_days` and `has_option_activity` rather than mutating them, and `job_worker.py` has no field writes on a report other than `raw_rows = None`. `DeribitNativeAccountState` is `@dataclass(frozen=True)`.
- **Extraction mode.** The keyword reaches `_assemble_deribit_native_ledger`. The smoothed call passes `exclude_spot`, the same variable the cash build uses. On the smoothed pass `_twin_kwargs` is `{}`, because `allocated_mark_seq` is None there, so the old smoothed build had no NAV twin either and `nav_twin=False` in the options builder changes nothing.
- **P3 source.** `has_option_activity` and the MED-01 `pre_mark_retention_option_dailies` bridge read the report RETURNED by the options builder. That report is where the assembly writes the retention list. N3 in the SUMMARY proves the case goes red when this is wrong.
- **Entry presence.** The cash pass never degrades a Deribit member. Every Deribit failure arm in `_reconstruct_all` either returns a `DispatchResult` or re-raises, and only ccxt members go into `degraded`. So every Deribit member that reaches step 6b has an entry. The `ValueError` arm is unreachable today (IN-05).
- **Release.**
  - The cash-pass release condition `not smoothed_mtm_available(member_signals)` is the same expression that sets `smoothed_ok` on the same unmutated list.
  - The budget-refusal branch and the step-6b `finally` both release.
  - A cancelled member build (the outer `wait_for` firing) runs its own `finally`.
  - Early `return`s between the cash pass and 6b release with the frame.
  - `mark_to_market_available` returns False whenever any member has option activity (`stitch_composite.py`), so retained rows never coexist with the MTM pass's own crawl.
- **Degrade, retry and promotion arms.** The 6b call site and every arm after it are byte-unchanged except the added `finally` and INFO line. A per-member `asyncio.TimeoutError` on the options build still maps to the transient arm. `ValueError` is not in `_PERMANENT_LEDGER_ERRORS`, so a missing entry cannot become a silent structural degrade. The ccxt arm is untouched.
- **No fallback crawl.** The reuse branch has no path to `fetch_deribit_native_account_state` or `build_deribit_native_ledger`.
- **Exchange handle.** The options build uses the smoothed pass's own freshly preflighted `ctx.exchange`, not the cash pass's closed one, and its reads are public (charts, index). `state_in` is supplied, so no private account read happens.
- **Key mode and single key.** `run_derive_broker_dailies_job` source hash re-measured: `b30930d1074f79c1` (matches the plan). `stitch_composite.py`, `deribit_txn.py`, `test_deribit_key_mode_options_basis.py` and `test_mtm_single_key.py` have zero diff. Every `job_worker.py` hunk header names `run_stitch_composite_job`.
- **MT5.** No routing line changed: `_COMPOSITE_DEGRADE_VENUES` and the `venue != "deribit"` permanent arm are untouched.
- **Leak.** The new INFO line carries the elapsed seconds, the bound and `strategy_id`, and no member id, amount or date. `strategy_id` is the id the plan specified, and every sibling 6b warning logs it too. `raw_rows` is `repr=False`. The reuse `ValueError` names the member's ordinal `seq`, not a key id.
- **Tests.** I re-ran the Task 1 set plus `test_stamp_io_exhaustive.py`: `416 passed`.

The one MEDIUM is a timing interaction the plan's Design 5 did not consider. "Rows and anchor from one moment" is true, but the option-mark cap in the smoothed assembly is read from the wall clock at assembly time. Reuse therefore widens the window in which a stitch straddles the 08:00 UTC Deribit settlement.

## Warnings

### WR-01: The reused crawl's account state can sit on the far side of the 08:00 UTC settlement from the option-mark cap, and reuse widens that window about N-fold

**Files:** `analytics-service/services/job_worker.py` (`_reconstruct_deribit`, the `reuse_cash_crawl` branch), `analytics-service/services/deribit_ingest.py` (`_last_settled_option_mark_day`, `_build_smoothed_option_mtm`), `analytics-service/services/deribit_txn.py` (`_assert_smoothed_book_channel`)

**Issue:**
- **The two sides of the reconciliation.** The smoothed assembly reconciles the replayed terminal option book against the anchor's settled book, `native_options_value − native_options_session_upl`, with tolerance `max($1-equiv, 1e-4·max(throughput, |settled anchor|))` (`_assert_smoothed_book_channel`).
  - The anchor side comes from the account state, which is now the CASH pass's read, taken at that member's cash-pass start.
  - The book side is positions × the close of the bar stamped `_last_settled_option_mark_day()`. That function reads `datetime.now(timezone.utc)` at assembly time, which is now the SMOOTHED pass.
- **What happens on a straddle.** Suppose an 08:00 UTC boundary falls between the two moments. The anchor then decomposes to yesterday's settlement, while `last_settled` has advanced one bar and the book is marked at today's settlement. The rows also miss the 08:00 settlement and delivery rows. For a member whose option book is open at the boundary, the residual is one settlement-day move of the book. That is well above `1e-4` of it, so `LedgerValuationError` is raised.
- **What the user sees.** The error reaches step 6b's `_PERMANENT_LEDGER_ERRORS` arm, the smoothed object degrades and the headline is not promoted. That is the safe direction: no wrong number is published. But it is user-facing. A previously promoted composite flips back to the cash headline with `unsmoothed_options_book` until its next stitch. Unlike a transient, it is not retried, because WR-01 of gap 2 retries transients only.
- **Why this is new exposure, not just inherited.**
  - Before plan 11, the window for each member was its own smoothed state read, then its crawl, then its assembly: roughly one member's crawl time, about 230 s of the PROD-measured 690 s cash pass for a 3-member composite.
  - Now each member's window runs from its cash-pass state read to its smoothed assembly. That is roughly the whole remaining cash pass, plus stitch and compute, plus the earlier members' smoothed builds: about 700 s per member.
  - At a uniformly distributed stitch start, the chance that one member straddles goes from about 0.3% to about 0.8% per member per stitch, around 2–3% per 3-member stitch.
  - That figure is unmeasured. It depends on when composite refreshes actually start: the composite ledger-refresh schedule is not registered in `supabase/migrations`, so it cannot be read from the repo.
  - Key mode carries the same shape, with a shorter gap (cash assembly only).
  - No test covers it: every stub returns the same state and the same marks at any wall time.
- **Design 5's claim.** Design 5 says "no founder checkpoint is needed" because rows and anchor come from one moment. That holds for rows and anchor, but the mark cap is a third input bound to a different moment.

**Fix (minimal, keeps "no third crawl"):** record the settled-bar key at the cash state read and refuse a straddle as a TRANSIENT. That way gap 2's WR-01 handling retries the whole job on earlier attempts, where a fresh attempt reads rows, state and marks on one side of the boundary, and degrades only on the last attempt.

```python
# cash pass, beside the store:
member_cash_crawl[member_seq] = (completeness, account_state, _last_settled_option_mark_day())
# reuse branch, before build_deribit_options_basis_ledger:
_cash_report, account_state, _settled_at_read = _kept
if _last_settled_option_mark_day() != _settled_at_read:
    _cash_report.raw_rows = None
    raise DeribitTransientReadError(
        "run_stitch_composite_job: the 08:00 UTC settlement passed between the member's "
        "cash-pass read and its smoothed assembly; retrying so both read one side"
    )
```

`DeribitTransientReadError` is already one of the exceptions 6b catches (retry on earlier attempts, degrade on the last). Add a test that freezes the wall clock across the boundary between the two passes and asserts a transient on an earlier attempt and a degrade with no promotion on the last. A cleaner alternative is to thread the state's read instant into `_build_smoothed_option_mtm` as the `last_settled` anchor. That touches `deribit_ingest.py` beyond this plan's write scope and key mode's call, so it is a founder-scope choice.

## Info (LOW, recorded here only, per the TODOS rule)

### IN-01: The allocated-mode equality gate never enters the ΔMTM merge

**File:** `analytics-service/tests/test_deribit_options_basis_ledger.py` (`test_same_crawl_smoothed_ledger_equals_an_independent_build_in_allocated_mode`)

**Issue:** The nav-twin fixture (`tests/test_deribit_nav_twin.py` `_crawl_rows`) has no option rows: a deposit, a `BTC-PERPETUAL` settlement and `BTC_USDC` spot trades. `deribit_raw_rows_have_option_activity` is therefore False, and the `smoothed_mtm` assembly takes the same branch as the cash one. The test proves the extraction-mode keyword is threaded (N4 bites), but not "smoothed equals a fresh smoothed crawl in allocated mode" for an option-active member.
- The real-ingest tracer covers ΔMTM in NAV mode only.
- The `[configured]` identity case stubs both builders.

Must-have truth 2 is therefore proven on its extraction axis only. Behaviour risk is low: it is the same `_assemble_deribit_native_ledger` over the same rows. **Fix:** add a combined fixture (option rows from `_IN_RET_ROWS` plus an extraction pair), or state the limit in the test docstring.

### IN-02: The per-member timeout arm's text says "member crawl" on a pass that no longer crawls

**File:** `analytics-service/services/job_worker.py` (`_reconstruct_all`, `except asyncio.TimeoutError` arm)

**Issue:** On the smoothed pass, `_BROKER_CRAWL_TIMEOUT_S` now bounds the options assembly (chart and index reads), but the transient message still reads "member crawl exceeded the … per-crawl bound". This misleads the post-deploy reader. The plan forbids rewording existing lines that tests match, so record it and leave it.

### IN-03: Impossible-state guard: `member_seq: int | None = None` on `_reconstruct_deribit`

**File:** `analytics-service/services/job_worker.py` (`_reconstruct_deribit` signature; `if retain_cash_crawl and member_seq is not None`)
**Category:** necessity

**Issue:** The only call site (`_reconstruct_all`'s Deribit arm) always passes `member_seq=seq` (`grep -n "_reconstruct_deribit(" services/job_worker.py`: one call). The None guard on the store therefore defends against nothing. If a future caller ever omitted it, the store would be silently skipped in the cash pass and the failure would surface later as the reuse `ValueError`. **Fix:** make it `member_seq: int` with no default.

### IN-04: The INFO line says "built" before the smoothed object can still degrade

**File:** `analytics-service/services/job_worker.py` (step 6b, the new `logger.info`)

**Issue:** The line fires as soon as `_reconstruct_all` returns a tuple. That is before the last-attempt divergence check, the degraded-member invariant, the `<2` interpretable-days degrade and the chain-break degrade. The post-deploy reading must pair it with the promotion line, which `252-11-PLAN.md` Post-deploy step 2 already asks for. Its payload is seconds, bound and `strategy_id`, with no member id or amount.

### IN-05: The reuse-path `ValueError` is unreachable and untested

**File:** `analytics-service/services/job_worker.py` (`_reconstruct_deribit`, `if _kept is None: raise ValueError(...)`)

**Issue:** By construction every Deribit member either stores an entry in the cash pass or ends the job there, so the arm cannot fire today. If it ever did, no 6b arm catches `ValueError`, and it would leave as an unclassified error retried by the dispatcher. That is loud, which is the plan's intent. No test pins it. The no-fallback property is pinned indirectly by the tracer's paginate count (N1).

---

_Reviewed: 2026-11-28_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_

---

## Round 2 (2026-11-28): WR-01 fix verification and final MEDIUM+ verdict

**Fix under review:** commit `636dce4d5` (`git diff b75a79df6..HEAD -- . ':!.planning'`: `services/job_worker.py` +21/−4, `tests/test_stitch_composite_job.py` +115), report `252-REVIEW-FIX-GAP3.md`.
**Final scope:** `git diff 00e61bf13..HEAD -- . ':!.planning'` (`deribit_ingest.py`, `job_worker.py`, four test files). The only change since round 1 is the fix commit, so the round-1 findings above carry over unchanged except WR-01.

**Round-2 counts:** critical 0, warning 0 open (WR-01 fixed), info 6 (IN-01 to IN-05 from round 1, plus IN-06 below), necessity 1 (IN-03).

### WR-01: FIXED (verified in source, not taken from the fix report)

- **Cash side, ordering.** In the non-reuse branch of `_reconstruct_deribit`, `_settled_at_read = _last_settled_option_mark_day()` (`job_worker.py:14663`) runs AFTER `fetch_deribit_native_account_state` returns and BEFORE `build_deribit_native_ledger` crawls. So a settlement during the crawl is also caught, and the state-read-to-day-read gap is a synchronous step with no await. The entry stored at `:14676` is the three-tuple. `_settled_at_read` is bound whenever `retain_cash_crawl` is true, which is the only case that stores it, so there is no unbound-local path.
- **Reuse side.** `:14633` compares the current settled day with the stored one and, on a mismatch, releases the popped report's rows and raises `DeribitTransientReadError` before `build_deribit_options_basis_ledger` is awaited.
- **The exception reaches the right arm.** `DeribitTransientReadError(RuntimeError)` (`deribit_ingest.py:134`) is not in `_PERMANENT_LEDGER_ERRORS` (`job_worker.py:14183`). In `_reconstruct_all`'s Deribit arm it falls to the generic `except Exception`, which returns a `DispatchResult` only for `is_geo_blocked` and otherwise re-raises. The message contains none of the `_GEO_BLOCK_MARKERS` and no word-boundary `451`, so it re-raises. Step 6b's `except (DeribitTransientReadError, ccxt.NetworkError)` then re-raises on an earlier attempt (whole-job retry) and degrades on the last (`smoothed_result = None`, cash headline plus `unsmoothed_options_book`). The 6b `finally` releases every other member's retained rows on both paths.
- **The escaped exception is retried by the queue, not terminalised.** `dispatch` (`job_worker.py`, `async def dispatch`) catches the handler's exception and calls `classify_exception`. That function has no arm for `DeribitTransientReadError`, a plain `RuntimeError` subclass, so it reaches the final `return ("unknown", ...)` ("Everything else (RuntimeError, ValueError, KeyError, ...)"). In `mark_compute_job_failed` only `'permanent'` goes to `failed_final` on the first failure. `'unknown'` shares the transient arm and is retried against `max_attempts`. This is the same path gap 2's WR-01 marks-read transient already takes, so the fix's "nothing written this attempt" outcome is a retry, never a permanent sink.
- **The residual window is the single-pass one, as the fix report says.** From the guard, `build_deribit_options_basis_ledger` → `_assemble_deribit_native_ledger` → `txn_rows_to_native_daily` (synchronous) → `_build_smoothed_option_mtm` → `last_settled = _last_settled_option_mark_day()` (`deribit_ingest.py:2573`). There is no `await` on that chain before the clock read. The only possible yield is the `asyncio.wait_for` task start. That is the window a fresh single-pass build always had.
- **The tests bite.** The patch target `services.deribit_ingest._last_settled_option_mark_day` is effective because `run_stitch_composite_job` imports the name inside the function body, at call time. In the straddle helper the day advances inside member 1's cash crawl, so member 1 stores `2026-11-26` and the reuse sees `2026-11-27`. Without the guard the options stub would run and `options_bases == []` would fail. That matches the fixer's recorded neuter (2 red, mirror green). The mirror test pins that an unchanged day still promotes with both members built.
- **Gates re-run by me** from `analytics-service/` with `.venv/bin/python`:
  - `pytest tests/test_stitch_composite_job.py tests/test_stitch_composite.py tests/test_composite_headline_parity.py tests/test_nav_marks_composite_allocated.py tests/test_deribit_options_basis_ledger.py tests/test_stamp_io_exhaustive.py -q -p no:cacheprovider`: `330 passed, 117 warnings`.
  - `mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py`: `Success: no issues found in 151 source files`.
  - I did not repeat the neuter, because this review does not edit source. The fixer's PROOF-01 is recorded in `252-REVIEW-FIX-GAP3.md`.

### No new MEDIUM+ from the fix

Checked and clean:
- the 6b promotion, divergence and degraded-member arms are untouched;
- `_release_cash_crawl` unpacks the three-tuple, so every release path still runs;
- the publish-status source scan still passes;
- no new log line;
- the new exception message carries no member id, amount or key id.

### IN-06 (LOW, new in round 2): the straddle guard also fires for members whose smoothed assembly does not read the clock

**File:** `analytics-service/services/job_worker.py:14633` (the guard), compared with `analytics-service/services/deribit_ingest.py` (`_assemble_deribit_native_ledger`: the `_build_smoothed_option_mtm` branch runs only when `deribit_raw_rows_have_option_activity(raw_rows)`)

**Issue:** The settled-day cap only affects a member whose retained rows have option activity. The guard runs for every Deribit member on the smoothed pass, including a perp-only or spot-only member in a composite where some other member is option-active.
- For such a member, a straddle now forces a whole-job retry on an earlier attempt, and a degrade of the smoothed headline on the last.
- At plan-11 HEAD before the fix, and before plan 11, the same straddle built normally.

It is the safe direction: a retry or a named withhold, never a wrong number. The user sees it only when the straddle lands on the final attempt, so I record it as LOW.

**Fix (if ever taken):** gate the guard on `_cash_report.has_option_activity`. The cash assembly sets that flag from the same rows (`deribit_ingest.py:2724`), and the smoothed branch tests those rows too.

### Final verdict on `git diff 00e61bf13..HEAD -- . ':!.planning'`

**No open MEDIUM or higher.** WR-01 is fixed and verified. The remaining items, IN-01 to IN-06, are LOW or Info and are recorded here only, per the TODOS rule. Status for the gate: **clean at MEDIUM+**.

_Round 2 reviewed: 2026-11-28_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
