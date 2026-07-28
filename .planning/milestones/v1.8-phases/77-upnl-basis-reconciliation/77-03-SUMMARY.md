---
phase: 77-upnl-basis-reconciliation
plan: 03
subsystem: analytics
tags: [upnl, flow-aware-twr, venue-gating, derive-path, dq-bridge, realized-basis, double-count-guard, noise-guard, python]

# Dependency graph
requires:
  - phase: 77-upnl-basis-reconciliation
    plan: 01
    provides: unrealized_pnl_in_anchor flag + open_unrealized_usd terminal seam + UNREALIZED_MATERIALITY_RATIO + DUST_NAV_FLOOR
  - phase: 77-upnl-basis-reconciliation
    plan: 02
    provides: fetch_account_equity_and_upnl_usd / fetch_deribit_account_equity_and_upnl_usd companion 3-tuple reads
  - phase: 76-venue-flows-reconciliation
    provides: _BROKER_WARN_FLAGS broker→CSV DQ bridge, post-combine meta-flag pattern (flow_coverage_incomplete)
provides:
  - "derive_broker_dailies threads the venue-gated, noise-guarded open_unrealized_usd into combine_realized_and_funding (realized-basis roll terminal) for OKX/Deribit; Bybit/Binance pass structural 0.0"
  - "noise guard: open_unrealized_usd forced 0.0 on balance_error / equity None / |equity| <= DUST_NAV_FLOOR (never a wedge onto a heuristic/dust base)"
  - "unrealized_pnl_in_anchor surfaced onto meta post-combine + pre-stamped via _BROKER_WARN_FLAGS + lifted/promoted in analytics_runner → material-wedge factsheet reads complete_with_warnings"
  - "Q4-tail invariant: the derive path never mutates a stored equity scalar with the wedge (writes only csv_daily_returns; full equity reaches combine unmutated)"
affects: [78-golden-parity]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Venue-gated wedge threading: the companion 3-tuple wedge (OKX upl / Deribit session_upl real; Bybit/Binance structural 0.0) is noise-guarded to 0.0 on any untrustworthy anchor before it threads to the honest core's terminal seam — a downstream subtract can never double-count or land on a dust/heuristic base"
    - "Post-combine meta-flag surfacing (mirrors flow_coverage_incomplete): a core-raised DQ key dropped by the P74-pinned transforms._merge_status_meta boundary is recomputed on meta in job_worker so the Phase 74 byte-identity pins stay GREEN"
    - "Definitional NAV re-add: the derive path writes ONLY csv_daily_returns and never mutates the stored MTM equity scalar — the reported current NAV keeps its source (Q4 tail), pinned by a mutation-honest no-stored-scalar test"

key-files:
  created: []
  modified:
    - analytics-service/services/job_worker.py
    - analytics-service/services/analytics_runner.py
    - analytics-service/tests/test_job_worker.py
    - analytics-service/tests/test_analytics_runner.py
    - analytics-service/tests/test_job_worker_deribit.py
    - analytics-service/tests/test_broker_dailies.py

key-decisions:
  - "unrealized_pnl_in_anchor is surfaced onto meta POST-COMBINE in job_worker (recomputing the core's |wedge|/anchor > 5% test), NOT threaded through transforms._merge_status_meta — that boundary drops the core-raised key and is explicitly P74-pinned/out-of-scope. Faithful because the noise-guard forces the wedge to 0.0 exactly when transforms would use a non-equity anchor, so the flag fires only where anchor_nav == equity. This mirrors the identical in-repo flow_coverage_incomplete post-combine pattern."
  - "Noise guard placed at a single point before the combine call (balance_error OR equity is None OR |equity| <= DUST_NAV_FLOOR → wedge 0.0) — one shared guard covers both the deribit and ccxt branches (Pitfall 5 / T-77-08)."
  - "Bybit/Binance double-count protection is inherited from 77-02 (exchange.py returns structural 0.0); job_worker faithfully threads whatever the read returns. The job-level pin asserts the threaded wedge is exactly 0.0 AND is load-bearing (a non-zero wedge shifts the series), so the structural 0.0 genuinely protects the realized-basis walletBalance series."
  - "Stored MTM equity is KEPT full — the reported current NAV re-add is definitional (Q4 tail); the wedge reaches ONLY combine's open_unrealized_usd kwarg. Pinned by a mutation-honest test (equity - wedge → RED)."

patterns-established:
  - "Recompute-on-meta post-combine to surface a core DQ flag across a pinned pure-boundary that drops it, keeping upstream byte-identity pins green"

requirements-completed: [FLOW-04]  # 77-01 (core flag) + 77-02 (reads) + 77-03 (wiring) — now end-to-end

# Metrics
duration: 55min
completed: 2026-07-06
---

# Phase 77 Plan 03: Venue-Gated uPnL Wedge Wiring + DQ Bridge Summary

**The venue-gated, noise-guarded open-uPnL wedge now threads through `derive_broker_dailies` into `combine_realized_and_funding(open_unrealized_usd=...)` so the OKX/Deribit roll terminal is realized-basis, while Bybit/Binance stay byte-identical at a structural 0.0 (no double-count); a material wedge raises `unrealized_pnl_in_anchor`, which rides the P73-76 `_BROKER_WARN_FLAGS` pre-stamp bridge and the analytics_runner lift/promotion predicate to surface the factsheet as `complete_with_warnings`. The stored MTM equity is untouched (the current-NAV re-add is definitional) — this closes FLOW-04 end-to-end.**

## Performance
- **Duration:** ~55 min
- **Tasks:** 3 (Task 1/2 TDD RED→GREEN, Task 3 full-suite + invariant pin)
- **Files modified:** 6 (2 source, 4 test)

## Accomplishments
- **job_worker (derive_broker_dailies):** switched both anchor reads to the 77-02 companion 3-tuples — deribit `fetch_deribit_account_equity_and_upnl_usd` and ccxt `fetch_account_equity_and_upnl_usd` — capturing `open_unrealized_usd` alongside `equity, balance_error`. Added a single shared **noise guard** (force wedge 0.0 on `balance_error` / `equity is None` / `|equity| <= DUST_NAV_FLOOR`) before the combine call, threaded `open_unrealized_usd=` into `combine_realized_and_funding`, surfaced `unrealized_pnl_in_anchor` onto `meta` post-combine (mirroring `flow_coverage_incomplete`), and added the flag to the `_BROKER_WARN_FLAGS` pre-stamp tuple.
- **analytics_runner:** added `unrealized_pnl_in_anchor: bool` to `DataQualityFlags`, to the `run_strategy_analytics` NavTWRMeta guard-key lift loop, to the `consumer_specific_flags` promotion predicate, and to the `run_csv_strategy_analytics` broker `_BROKER_WARN_FLAGS` lift — so a pre-stamped material wedge promotes `computation_status` to `complete_with_warnings` and is preserved (not wiped) on the completion upsert.
- **Double-count + noise + Q4 pins:** Bybit/Binance thread exactly 0.0 with a load-bearing mutation partner; heuristic/dust anchors force 0.0; the stored MTM equity reaches combine unmutated (`account_balance == equity`, wedge only on the terminal seam). An OKX material-wedge fixture completes DONE (residual never spuriously breached).

## Task Commits
1. **Task 1: RED — venue-gated wedge + DQ-bridge tests** - `677414aa` (test)
2. **Task 2: GREEN — thread the wedge + lift the flag through the DQ bridge** - `75241800` (feat)
3. **Task 3: Q4-tail no-stored-scalar pin + deribit harness 3-tuple** - `1b303274` (test)

_`.planning/` is gitignored (local-only); no docs metadata commit — code commits are the record._

## Files Created/Modified
- `analytics-service/services/job_worker.py` - 3-tuple companion reads (deribit + ccxt); shared noise guard; `open_unrealized_usd` threaded into combine; `unrealized_pnl_in_anchor` surfaced on meta post-combine + added to `_BROKER_WARN_FLAGS`.
- `analytics-service/services/analytics_runner.py` - `unrealized_pnl_in_anchor` added to `DataQualityFlags`, the NavTWRMeta lift loop, the promotion predicate, and the broker `_BROKER_WARN_FLAGS` lift.
- `analytics-service/tests/test_job_worker.py` - `_flow_harness` extended with the companion 3-tuple read (`upnl`/`balance_error`) + combine-spy `account_balance` capture; 6 new tests (OKX material threading+flag; Bybit/Binance double-count byte-identity; heuristic guard; dust guard; no-stored-scalar Q4 pin).
- `analytics-service/tests/test_analytics_runner.py` - 3 new tests (run_strategy_analytics lift+promote; CSV broker-path promote; CSV SC-4 stays-complete).
- `analytics-service/tests/test_job_worker_deribit.py` - shared deribit harness patches the companion 3-tuple.
- `analytics-service/tests/test_broker_dailies.py` - shared deribit harness patches the companion 3-tuple.

## Decisions Made
- **Post-combine meta surfacing over touching transforms** — the honest core (`reconstruct_nav_and_twr`) raises `unrealized_pnl_in_anchor`, but `transforms._merge_status_meta` (a P74-pinned pure boundary, explicitly out of scope) does not carry the key through. Rather than disturb the Phase 74 byte-identity pins, job_worker recomputes the SAME `|wedge|/anchor > 5%` test on the already-noise-guarded wedge — faithful because the guard forces the wedge to 0.0 exactly when transforms would use a non-equity anchor — mirroring the identical in-repo `flow_coverage_incomplete` post-combine pattern.
- **Single shared noise guard** — one predicate before the combine call covers both branches (Pitfall 5 / T-77-08).
- **Definitional NAV re-add** — the derive path writes only `csv_daily_returns`; the wedge never mutates a stored equity scalar (Q4 tail; T-77-10).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Core-raised `unrealized_pnl_in_anchor` dropped by the P74-pinned transforms boundary**
- **Found during:** Task 2 GREEN (the OKX material-wedge pre-stamp test stayed RED after threading the wedge).
- **Issue:** 77-01 raises the flag inside `reconstruct_nav_and_twr`, but the broker daily-PnL path returns through `transforms._merge_status_meta`, which carries through only the dust/negative/flow-dominated guard keys — it silently drops `unrealized_pnl_in_anchor`, so `meta.get("unrealized_pnl_in_anchor")` at the pre-stamp was always False. The plan's `key_links` assumed the flag reached meta unaided (a 77-01 propagation gap the plan did not anticipate).
- **Fix:** surfaced the flag onto `meta` POST-COMBINE in job_worker (recomputing the core's materiality test on the noise-guarded wedge), rather than touching the explicitly-out-of-scope, P74-pinned `transforms.py`. This mirrors the established in-repo `flow_coverage_incomplete` post-combine pattern (job_worker.py, same file) and keeps the Phase 74 byte-identity pins untouched.
- **Files modified:** `analytics-service/services/job_worker.py`.
- **Commit:** `75241800`.

**2. [Rule 3 - Blocking] Shared deribit derive harnesses patched the retired 2-tuple read**
- **Found during:** Task 3 full-suite (4 deribit tests reddened: 2 in `test_broker_dailies.py`, 2 in `test_job_worker_deribit.py`).
- **Issue:** switching the deribit anchor read to the 3-tuple `fetch_deribit_account_equity_and_upnl_usd` meant the harnesses' `fetch_deribit_account_equity_usd` patches no longer intercepted, so the real (mock-exchange) read produced a `None` anchor.
- **Fix:** updated both shared deribit harnesses to patch the companion 3-tuple (`(equity, balance_error, upnl)`), adding an `upnl` param to the `test_job_worker_deribit` helper.
- **Files modified:** `test_job_worker_deribit.py`, `test_broker_dailies.py`.
- **Commit:** `1b303274`.

## Threat Model Compliance
- **T-77-07 (Bybit/Binance double-count):** mitigated — job threads the structural 0.0 (inherited from 77-02); the flow-less byte-identity pin + a load-bearing mutation partner prove the 0.0 is protective.
- **T-77-08 (wedge onto heuristic/dust anchor):** mitigated — the single noise guard forces 0.0 on balance_error / None / dust (`test_heuristic_anchor_forces_wedge_zero`, `test_dust_anchor_forces_wedge_zero`).
- **T-77-09 (account-size leak):** honored — the flag is a BOOL; no raw USD wedge/NAV in logs, raises, or the DQ flags JSON.
- **T-77-10 (stored equity scalar mutation, Q4):** mitigated — the no-stored-scalar test pins `account_balance == equity` (unmutated) with the wedge only on the terminal seam; derive writes only `csv_daily_returns`.
- **T-77-SC (pip installs):** honored — no packages installed.

## Known Stubs
None. FLOW-04 is now end-to-end (77-01 core flag + 77-02 reads + 77-03 wiring). Per-day uPnL true-up remains deliberately NOT implemented (77-01 Q3 verdict; historical marks are not retrievable on read-only keys) — a documented, source-scanned invariant, not a stub.

## Verification Evidence
- `pytest tests/test_job_worker.py tests/test_analytics_runner.py` — 243 passed, 1 skipped.
- `pytest tests/test_broker_dailies.py tests/test_job_worker_deribit.py` — 41 passed.
- **Full analytics suite — 3117 passed, 92 skipped** (CI-3.12 venv); 77-02 baseline 3108 + 9 new, all P73-76 pins GREEN.
- `mypy --strict services/job_worker.py` — clean. `analytics_runner.py` carries 1 PRE-EXISTING `literal-required` error at the P76 `_BROKER_WARN_FLAGS` loop body (identical at HEAD; the local venv312 mypy is stricter than CI's pinned mypy — main ships green), untouched by 77-03 and logged to `deferred-items.md`; 77-03 introduces ZERO new mypy errors.
- RED honesty: the OKX threading, Bybit/Binance byte-identity (load-bearing), run_strategy_analytics lift, and CSV-promotion tests all failed pre-GREEN for the right reasons (wedge not threaded; predicate term missing).

## Deferred Issues
None from 77-03's own surface. Pre-existing out-of-scope mypy findings (analytics_runner `_BROKER_WARN_FLAGS` loop, parity_diff.py:117, metrics.py:509) logged to `deferred-items.md`.

## Next Phase Readiness
- Phase 78 (golden parity) can now assert the realized-basis terminal end-to-end for OKX/Deribit and the Bybit/Binance flow-less byte-identity, plus the `complete_with_warnings` promotion on a material-wedge account.
- If a live Deribit LTP read contradicts the `session_upl` field name (77-02 A1), the wedge degrades safely to 0.0 (flag stays clear) until the name is corrected in `_deribit_session_upl_to_usd`.
- No blockers.

## Self-Check: PASSED
- Commit `677414aa` (Task 1 RED) — FOUND
- Commit `75241800` (Task 2 GREEN) — FOUND
- Commit `1b303274` (Task 3 pin) — FOUND
- `analytics-service/services/job_worker.py` — FOUND (3 unrealized_pnl_in_anchor references)
- `analytics-service/services/analytics_runner.py` — FOUND (4 unrealized_pnl_in_anchor references)
- `.planning/phases/77-upnl-basis-reconciliation/77-03-SUMMARY.md` — FOUND

---
*Phase: 77-upnl-basis-reconciliation*
*Completed: 2026-07-06*
</content>
</invoke>
