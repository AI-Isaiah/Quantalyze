---
phase: 136-mt5recon-equity-reconstruction
plan: 01
subsystem: api
tags: [mt5, money-math, daily-returns, twr, annualization, fail-loud, oracle-discipline]

# Dependency graph
requires:
  - phase: 134-mt5-feasibility-spike
    provides: "Mt5Client contract (account_info().equity, history_deals_get None!=() discipline, raw server-time epochs)"
  - phase: 135-mt5src
    provides: "'mt5' Source literal + api_verified trust tier; Mt5Adapter RAISE stubs"
provides:
  - "services/mt5_deals.py — pure I/O-free fail-loud DEAL_TYPE classifier (classify_deal), Mt5DealClassificationError, deal_utc_day server-time->UTC seam, deal_cash_effect"
  - "broker_dailies.combine_mt5_deal_ledger — the THIRD combiner sibling (returns, meta) shape, anchor-to-equity, flow-in-numerator"
  - "tests/test_mt5_deal_reconstruction.py — hand-derived economic oracles (deposit-not-a-spike, zero-rotation F=0, sqrt252 mutation guard)"
affects: [136-02, 136-03, 136-05, 137-mt5conc, mt5-worker-branch]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pure classifier core (stdlib+typing only) — network-free correctness tests, mirrors deribit_txn.py"
    - "Third combiner sibling converging on combine_realized_and_funding -> chain_linked_twr (the ONE engine)"
    - "Allow-list classification with import-time disjointness assert; unknown/ambiguous DEAL_TYPE fails loud"
    - "Hand-derived money oracles (literals + shown arithmetic), never regenerated from the SUT"

key-files:
  created:
    - "analytics-service/services/mt5_deals.py"
    - "analytics-service/tests/test_mt5_deal_reconstruction.py"
  modified:
    - "analytics-service/services/broker_dailies.py"

key-decisions:
  - "Ambiguous DEAL_TYPE middle (CHARGE/CORRECTION/INTEREST/CANCELED/DIVIDEND/TAX) defaults FAIL-LOUD; exact table locked behind the 136-05 human-verify checkpoint"
  - "External flow amount = sum of the BALANCE-row profit field only (not full cash effect); trading PnL = profit+swap+commission+fee"
  - "Anchor to account_equity, open_unrealized_usd = equity - balance (v1.8 realized-basis uPnL wedge threaded to the honest core)"
  - "Zero-rotation fixture anchor = 100_500 (initial 100_000 + Sigma-pnl 500) so r_day2 == 400/100_000 exactly — honors the stated return literal over the plan's parenthetical 100_700"

patterns-established:
  - "Pattern: MT5 is single-currency + ledger-COMPLETE (like Deribit) — gap_fill 0.0 for no-activity days is CORRECT (contrast sFOX sampled NAV)"
  - "Pattern: leak-safe raises carry the DEAL_TYPE code / field name only, never a raw USD amount"

requirements-completed: [MT5RECON-01, MT5RECON-02]

# Metrics
duration: 20min
completed: 2026-07-23
---

# Phase 136 Plan 01: MT5 deal-ledger reconstruction core Summary

**Pure fail-loud MT5 DEAL_TYPE classifier + `combine_mt5_deal_ledger` (third combiner sibling), pinned by hand-derived economic oracles including the load-bearing deposit-day-is-not-a-spike test and a √252-vs-√365 mutation guard.**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-07-23T19:00:00Z
- **Completed:** 2026-07-23T19:20:00Z
- **Tasks:** 3
- **Files modified:** 3 (2 created, 1 modified)

## Accomplishments
- `services/mt5_deals.py`: a PURE, I/O-free classifier — `classify_deal` allow-lists BUY/SELL/COMMISSION (trading) and BALANCE/CREDIT/BONUS (external flow), with an import-time disjointness assert. Every ambiguous/unlisted type (CORRECTION included) raises `Mt5DealClassificationError` — leak-safe (type code only, never USD).
- `deal_utc_day` is the ONE server-time→UTC normalize seam (subtracts the recorded offset before bucketing, fail-loud on undatable input); `deal_cash_effect` sums the four money fields with NaN/Inf/non-numeric/bool rejection.
- `broker_dailies.combine_mt5_deal_ledger` folds the deal ledger into the byte-identical `(returns, meta)` sibling shape, anchoring to `account_equity` and threading external flows + the uPnL wedge through `combine_realized_and_funding` → `chain_linked_twr` (the ONE engine — no bespoke r_t loop). The two existing siblings were untouched.
- Hand-derived oracles prove a +10_000 deposit landing the same UTC day as +300 PnL books `300/100_400`, never the +10.26% spike; a −5_000 withdrawal neither depresses nor inflates; zero-cash-rotation ⇒ F=0; a CORRECTION row kills the whole combine; and the reconstructed series annualizes on √252 (√365 flip turns the mutation test RED). `mt5` confirmed absent from `CRYPTO_VENUES`.

## Task Commits

Each task committed atomically (TDD RED → GREEN):

1. **Task 1 (RED): classifier oracles** - `1f29440c` (test)
2. **Task 1 (GREEN): mt5_deals.py classifier** - `486f7e2d` (feat)
3. **Task 2 (RED): combine_mt5_deal_ledger money oracles** - `aad6e782` (test)
4. **Task 2 (GREEN): combine_mt5_deal_ledger** - `e1574a35` (feat)
5. **Task 3: √252 mutation guard + crypto-registry + quantstats guards** - `2db0a87e` (test)

## Files Created/Modified
- `analytics-service/services/mt5_deals.py` - Pure fail-loud DEAL_TYPE classifier, UTC-day seam, cash-effect coercion (created)
- `analytics-service/services/broker_dailies.py` - Added `combine_mt5_deal_ledger` beside the deribit/sfox siblings; imports from `services.mt5_deals` + `services.external_flows` (modified)
- `analytics-service/tests/test_mt5_deal_reconstruction.py` - 47 hand-derived economic oracles (created, 387 lines)

## Decisions Made
- **Ambiguous middle fails loud:** CHARGE/CORRECTION/INTEREST/CANCELED/DIVIDEND/TAX are absent from both allow-lists → raise. Exact classification is locked behind the 136-05 human-verify checkpoint (user decision Q2), tagged `[ASSUMED]` in comments.
- **Flow = BALANCE `profit` only:** external flow per day sums the `profit` field of external-flow rows (a BALANCE deal books its deposit/withdrawal there), distinct from `deal_cash_effect` used for trading rows.
- **Zero-rotation anchor = 100_500:** chosen so `initial = 100_000` and `r_day2 == 400/100_000 = 0.0040` exactly, honoring the plan's stated return literal (`+400/100_000`) over its parenthetical `anchor 100_700` (which would give `initial 100_200`, contradicting the literal). Documented in the test with full arithmetic. This is the oracle-disciplined reading.

## Deviations from Plan

None requiring auto-fix rules. One documented interpretation: the zero-cash-rotation variant's anchor was set to 100_500 (not the plan's parenthetical 100_700) to satisfy the explicitly-stated hand return literal `+400/100_000`; the 100_700 figure equals NAV-after-day4 in that fixture, an apparent label slip in the plan. The behavioral contract (F=0, pure-PnL literals) is fully honored. No product-code deviations; no scope creep.

## Issues Encountered
- quantstats emits `RuntimeWarning: Mean of empty slice` when computing cVaR on the 4-point mutation fixture — harmless KPI-engine internal on a tiny series; the volatility oracle (the assertion under test) matches to rel=1e-9. Not a defect.

## User Setup Required
None - no external service configuration required. (Built entirely against the Phase-134 `Mt5Client` contract; no live broker.)

## Next Phase Readiness
- `combine_mt5_deal_ledger` + `mt5_deals` are ready for 136-03 (the `venue == "mt5"` worker branch composes them) and 136-02 (TS annualization narrowing — the Python `mt5 ∉ CRYPTO_VENUES` half is already asserted here).
- The `[ASSUMED]` DEAL_TYPE middle, the A2 server-time offset, and the A3 fold rule remain locked behind the 136-05 human-verify checkpoint — do not silently classify them before then.

## Verification
- `pytest tests/test_mt5_deal_reconstruction.py -x` → 47 passed.
- Sibling suites (`test_mt5_golden_fixtures.py`, `test_equity_reconstruction.py`, `test_broker_dailies.py`, `test_basis_series.py`, `test_native_nav.py`, `test_sfox_reconstruct.py`, `test_cash_basis_series_sc4.py`) green.
- Full analytics-service suite: **4372 passed, 96 skipped** (no regressions).

## Self-Check: PASSED
- FOUND: analytics-service/services/mt5_deals.py
- FOUND: analytics-service/tests/test_mt5_deal_reconstruction.py
- FOUND: def combine_mt5_deal_ledger in analytics-service/services/broker_dailies.py (line 394)
- FOUND commits: 1f29440c, 486f7e2d, aad6e782, e1574a35, 2db0a87e

---
*Phase: 136-mt5recon-equity-reconstruction*
*Completed: 2026-07-23*
