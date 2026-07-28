---
phase: 67
plan: 67-03
status: complete
completed: 2026-07-04
requirement: DRB-01
evidence: analytics-service/docs/deribit-ground-truth.md + docs/evidence/drb01-deribit-ground-truth-2026-07-04.json
---

# 67-03 SUMMARY — Deribit ground-truth live capture (DRB-01)

## Outcome
DRB-01 answered from THREE live read-only LTP Deribit keys (founder provisioned
them on the Railway worker as env vars; harness run per-account via
`railway ssh` with the exact var name mapped to `DERIBIT_CLIENT_ID/SECRET`).
All three validated read-only (scope grants all `:read`, zero `:read_write`) —
which also confirms the Phase 68 suffix-match scope gate against the real
Deribit scope-string format.

### The three answers (recorded, evidence-backed)
1. **Funding-netting shape: SEPARATE rows.** Perpetual funding is a distinct
   `type=settlement` transaction-log entry per perpetual, amount in `cashflow`,
   coin-denominated (inverse perps settle in coin). NOT netted into trade PnL.
   Evidence: acct-3 ETH-PERPETUAL settlement (cashflow -5.032e-5 ETH).
2. **Instrument mix: options + inverse perpetuals + spot.** acct-3 classified
   option:192, inverse_perpetual:167 (BTC options, ETH-PERPETUAL); no
   linear-perp or dated-future in window. Accts 1&2 show the same kinds in the
   txn log despite an empty `instrument_mix` roll-up (caveat below).
3. **Geo-block: none observed** from Amsterdam (NL) egress on all 3 keys.
   Marker stays deferred-to-observed; #415 classifier is the fail-safe.

## ⭐ CRITICAL FINDING (surfaced by the run — feeds Phase 70/72)
Main-account history queries returned **<5% of the known account totals**
(captured 3.5% / 4.1% / 0.8% of 18,778 / 21,014 / 61,248 expected trades),
with `trade_max_pages_hit=false` everywhere — so NOT a pagination cap. Both
`get_user_trades_by_currency_and_time` (0/0/359) and the txn-log fetch
(650/860/481) under-return. Each key sees **2 subaccounts**. Leading
hypothesis: the LTP trading lives in subaccounts the harness never iterates.
**Phase 70 MUST fetch history per-subaccount (`subaccount_id` param) and verify
against the known totals** before dailies are trusted — the BYB-02 silent
under-fetch lesson in a new form. Also: instrument-mix should be classified
from the txn-log `instrument_name` (complete) not solely `get_user_trades`.

## Carry-forward
- Phase 70: subaccount iteration (blocker); txn-log as authoritative trade
  source; inverse coin→USD funding conversion; native-id/exact-ts funding dedup
  (NOT floor bucket — BYB-02); handle `-32602 not-supported-for-wallet-type` and
  `10028 rate-limit` incidental errors.
- Phase 72: model each LTP account's 2-subaccount structure (accounts→strategies).
- Harness enhancement (add subaccount loop) is Phase 70 fixture work; the
  shipped harness did its job — it SURFACED the structure gap.
- Keys rotate after LTP onboarding (ONB-02 / Phase 72); env-var-only, never tracked.
