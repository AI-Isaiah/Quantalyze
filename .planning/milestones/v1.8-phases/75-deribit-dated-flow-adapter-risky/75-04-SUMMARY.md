---
phase: 75-deribit-dated-flow-adapter-risky
plan: 04
subsystem: analytics
tags: [python, deribit, external-flows, twr, flow-neutral, flow-dominated-guard, ltp068, acceptance, risky, pytest, tdd]

# Dependency graph
requires:
  - phase: 75-03
    provides: "The full honest path wired end-to-end — crawl -> CompletenessReport.dated_external_flows -> combine_realized_and_funding(external_flows=...) -> reconstruct_nav_and_twr; equity anchor UNADJUSTED so the core's F_t is the single flow correction"
  - phase: 75-02
    provides: "deribit_dated_external_flows_usd (the honest dated list[ExternalFlow] producer with same-day settlement-index valuation)"
  - phase: 75-01
    provides: "5 LTP068-shaped synthetic Deribit txn-log fixtures + known same-day BTC settlement-index constants"
  - phase: 73
    provides: "reconstruct_nav_and_twr flow-neutral algebra + DQ-01 flow_dominated_guard (FLOW_DOM_RATIO=1.0)"
provides:
  - "LTP068 dual-case acceptance (SC4, reconciled) pinning BOTH honest outcomes end-to-end through the integration seam: a sub-NAV pure-flow day -> r_t==0 (complete); a dominating withdrawal -> NaN + flow_dominated_guard + complete_with_warnings"
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Integration-level acceptance: the real seam (deribit_dated_external_flows_usd -> combine_realized_and_funding -> reconstruct_nav_and_twr) is exercised on LTP068-shaped fixtures — no mocks of the compute path, so the acceptance pins production behavior end-to-end"
    - "Reconciled boundary pinning: the SAME machinery yields r_t==0 (sub-NAV) and the guard (dominating); both are pinned in one file so a future change cannot collapse them into one another (75-CONTEXT SC4 nuance)"
    - "Test-only acceptance of already-complete production (75-03): mutation-honesty is proven by falsifiable assertions (wrong-day index, dropped flow, guard-removal -> a number instead of NaN) rather than a RED-before-GREEN implementation step"

key-files:
  created: []
  modified:
    - analytics-service/tests/test_derive_broker_dailies_dualmode.py

key-decisions:
  - "The event-time proof pins the exact valued USD (change * same-day index) AND asserts it differs from a cross-time (wrong-day) index — the flow-neutral r_t==0 alone is NOT falsifiable by a wrong flow MAGNITUDE (the flow always cancels in the numerator on a zero-pnl day), so value-correctness needs its own falsifiable assertion."
  - "The dropped-flow proof pins the CUMULATIVE return (not the pure-flow day's own r_t): r_t==0 holds with OR without the flow on a zero-pnl day, but the flow is load-bearing on the NAV LEVEL, so removing it changes the cumulative return / the trading day's denominator — that is the honest place to prove the flow is not silently dropped."
  - "The dominating-withdrawal case necessarily carries a large same-day gain (close 5000, day pnl +15000, withdrawal -90000): backward reconstruction makes NAV_{t-1} = close - pnl + |F|, so to get |F| >= NAV_{t-1} the account must have gained enough intraday to fund a withdrawal exceeding prior-day capital — the genuine LTP068 shape (LP withdrew nearly the whole account after an up day). Sized so ONLY flow_dominated_guard fires (no negative/dust guard contamination)."

requirements-completed: [FLOW-02]

# Metrics
duration: 25min
completed: 2026-07-06
---

# Phase 75 Plan 04: LTP068 Dual-Case Acceptance (SC4, Reconciled) Summary

**The whole RISKY path is proven honest end-to-end: a real BTC withdrawal becomes a correctly-signed, event-time-valued `F_t` on its actual UTC day through the real seam `deribit_dated_external_flows_usd -> combine_realized_and_funding -> reconstruct_nav_and_twr`; a sub-NAV pure-flow day yields `r_t == 0` (flow-neutral, `complete`); and a dominating withdrawal (`|F| >= NAV_{t-1}`) trips `flow_dominated_guard` (NaN + `complete_with_warnings`) instead of fabricating a ±100% day — both reconciled SC4 outcomes pinned, mutation-honest.**

## Performance

- **Duration:** ~25 min
- **Completed:** 2026-07-06
- **Tasks:** 2 (both test-only acceptance of the 75-03-complete production path)
- **Files:** 0 created, 1 modified

## Accomplishments

- **Task 1 — sub-NAV pure-flow -> `r_t == 0`.** Drove the scenario-2 LTP068-shaped fixture (`inverse_flow_day_with_index_rows`, a -0.5 BTC withdrawal on 2026-03-14 with its OWN same-day index-bearing settlement row) through the full seam. Three falsifiable proofs: (a) **event-time + sign** — the withdrawal `ExternalFlow` is negative and equals `change * same-day BTC index` (-0.5 * 42000 = -21000) on its actual UTC day, and `!= -0.5 * 45000` (a cross-time substitution reddens it); (b) **flow-neutral** — with anchor 100k and pnl [+1000, 0] the reconstructed `NAV_{03-13}=121000`, `|F|=21000` strictly under it, so `r_t==0` with `complete` status and NO guard; (c) **dropped-flow** — removing the flow from `external_flows` changes the reconstructed cumulative return (0.008333 -> 0.010101), proving the flow is load-bearing.
- **Task 2 — dominating withdrawal -> `flow_dominated_guard`.** Drove the scenario-4 fixture (`dominating_withdrawal_rows`, a -2.0 BTC withdrawal valued -90000 via its own same-day index) through the same seam. With anchor 5000 and pnl [+800, +15000] the reconstructed `NAV_{03-15}=80000`; `|F|=90000 >= 80000` breaks the chain-link: the day is **NaN** (not `r_t==0`, not a fabricated magnitude), `meta` carries `flow_dominated_guard`, status is `complete_with_warnings`. Pinned the boundary distinction: ONLY the flow-dominated guard fires (no negative/dust guard), and the prior day is a healthy finite non-zero return — the two SC4 outcomes stay distinct.

## Task Commits

Each task committed atomically:

1. **Task 1: sub-NAV pure-flow -> r_t==0 acceptance** — `31ea4578` (test)
2. **Task 2: dominating withdrawal -> flow_dominated_guard acceptance** — `af1d9abd` (test)

## Files Created/Modified

- `analytics-service/tests/test_derive_broker_dailies_dualmode.py` — +2 module-level helpers (`_daily_pnl_record`, `_cumulative_twr`) and +2 acceptance classes (`TestLtp068AcceptanceSubNavPureFlow`, `TestLtp068AcceptanceDominatingWithdrawal`); +6 fixture/seam imports.

## Decisions Made

- **Event-time value pinned separately from flow-neutrality** — the `r_t==0` property is invariant to the flow's magnitude on a zero-pnl day (the flow always cancels in the numerator), so it cannot catch a wrong valuation on its own. The event-time proof pins the exact `change * same-day index` value and its inequality against a wrong-day index, making value-correctness falsifiable.
- **Dropped-flow proof targets the cumulative return, not the pure-flow day** — `r_t==0` holds with or without the flow on a zero-pnl day; the flow's load-bearing effect is on the NAV level (and hence the trading day's denominator / cumulative return), which is where "the flow is not silently dropped" is honestly provable.
- **The dominating case carries a real intraday gain by construction** — backward reconstruction (`NAV_{t-1} = close - pnl + |F|`) means a withdrawal exceeding prior-day NAV is only reachable when the day's gains funded it (the genuine LTP068 shape). Sized so only `flow_dominated_guard` fires.

## Deviations from Plan

None — plan executed exactly as written. Test-only, no production code touched (`deribit_txn.py` / `deribit_ingest.py` / `job_worker.py` untouched, per scope).

## Mutation-Honesty Verification (RISKY proofs)

- **Event-time (Task 1)** — `flow.usd_signed == -0.5 * BTC_INDEX_2026_03_14` AND `!= -0.5 * BTC_INDEX_2026_03_16`. A wrong-day / 1.0 / current-price valuation reddens (confirmed: -21000 vs -22500).
- **Dropped-flow (Task 1)** — `_cumulative_twr(with_flow) != _cumulative_twr(without_flow)` (0.008333 vs 0.010101). Silently dropping the flow reddens.
- **Guard-removal (Task 2)** — `np.isnan(returns.loc[2026-03-16])`. Removing `flow_dominated_guard` would divide the -90000 flow through the 80000 base and surface +0.1875 (a number, a fabricated magnitude) instead of NaN -> reddens.
- **Boundary distinction (Task 2)** — `flow_dominated_guard is True` while `negative_nav_guard`/`dust_nav_guard` absent, and the sub-NAV case fires NO guard. A change collapsing the two SC4 outcomes reddens one side.

## Known Stubs

None. This plan is a pure acceptance of the already-complete 75-03 production path; no placeholders, no hardcoded empties flowing to UI. The LTP068-shaped fixtures consumed are intentional test scaffold (documented in 75-01).

## Threat Flags

None new. The plan adds no production surface — it exercises the existing crawl/valuation/core seam (which already fetches `get_delivery_prices` at 75-02 and accepts `external_flows` at 74-02). All three threat-register entries (T-75-04-NEU flow-neutral, T-75-04-DOM dominating guard, T-75-04-EVT event-time valuation) are covered by the mutation-honest proofs above.

## Verification

- `pytest tests/test_derive_broker_dailies_dualmode.py -k ltp068` -> **2 passed** (both SC4 cases).
- `pytest tests/test_derive_broker_dailies_dualmode.py` -> **12 passed** (10 prior + 2 new).
- Phase-75 set (`test_deribit_txn.py test_deribit_ingest.py test_nav_twr.py test_external_flows.py`) -> **138 passed**.
- **Full analytics suite: 3023 passed, 92 skipped** in the CI-3.12 venv (baseline 3021/92 from 75-03; +2 new). Warnings are pre-existing quantstats noise in `test_metrics.py`, not attributable to this change.

## TDD Gate Compliance

This plan is `type: tdd` but test-only: the production path is complete after 75-03, so there is no RED-before-GREEN implementation step. Per the fail-fast rule, a passing acceptance against already-complete production is expected here (the feature exists by design). Mutation-honesty (the RED substitute for test-only acceptance) is proven by the falsifiable assertions documented above rather than a `feat` commit. Both tasks committed as `test(75-04)` (`31ea4578`, `af1d9abd`); no `feat`/`refactor` commits by design.

## Next Phase Readiness

- **FLOW-02 acceptance COMPLETE** — the RISKY Deribit dated-flow path is proven honest end-to-end. The LTP068 +458% class is now an event-time-valued `F_t` on its actual day (sub-NAV -> r_t==0; dominating -> guard, never a fabricated day).
- **Phase 76** (Binance/Bybit/OKX adapters + reconciliation gate) can proceed on the same `external_flows=` seam; only the per-venue dated-flow producer differs.
- **Deferred cleanup (from 75-03):** remove the now-dead `deribit_linear_external_flow_usd` from `deribit_txn.py` in a future non-RISKY pass.
- No blockers.

---
*Phase: 75-deribit-dated-flow-adapter-risky*
*Completed: 2026-07-06*

## Self-Check: PASSED
Both task commits (31ea4578, af1d9abd) in git log; 75-04-SUMMARY.md present; the acceptance test file carries 2 `ltp068` tests; full analytics suite 3023 passed / 92 skipped in the CI-3.12 venv.
