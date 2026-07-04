# Deribit Ground-Truth Answers (DRB-01)

**Provenance:** Recorded 2026-07-04 from THREE live read-only LTP Deribit keys via
`scripts/deribit_ground_truth.py`, run on the Railway worker (Amsterdam egress).
This is the Plan 67-03 live capture. Sanitized raw evidence:
`docs/evidence/drb01-deribit-ground-truth-2026-07-04.json`.

All three keys validated read-only: scope grants were
`account:read trade:read wallet:read custody:read block_trade:read`
(+ `block_rfq:read` on one), **zero `:read_write`**. This confirms the
Phase 68 suffix-match scope gate against the real Deribit scope-string format
(space-separated `domain:action` tokens plus a `name:…` and `session:` prefix).

Phases 68 (DRB-02 boundary — DONE) and 70 (DRB-04..07 dailies/funding) design
against this file. Every answer is backed by a sanitized evidence excerpt.

> ⚠ **CRITICAL FINDING for Phase 70 — main-account queries miss >95% of trades.**
> Both history sources returned a tiny fraction of the known account totals:
>
> | Account | Expected trades | `get_user_trades` | txn-log `trade` rows | Captured |
> |---------|----------------:|------------------:|---------------------:|---------:|
> | 1 | 18,778 | 0 | 650 | **3.5%** |
> | 2 | 21,014 | 0 | 860 | **4.1%** |
> | 3 | 61,248 | 359 | 481 | **0.8%** |
>
> `trade_max_pages_hit` was **false** on every currency — so this is NOT a
> pagination cap; the endpoints genuinely returned almost nothing for the
> queried scope. Each key sees **2 subaccounts** (`subaccounts_observation:
> count=2, sees_any=true`). The overwhelmingly likely cause is that the LTP
> trading lives in **subaccounts**, which the harness (and any naive
> main-account ingestion) never iterates into. **Phase 70 MUST fetch history
> per-subaccount** (the `subaccount_id` parameter on the trades /
> transaction-log endpoints) and verify the per-account totals against
> 18,778 / 21,014 / 61,248 before the dailies are trusted. This is the
> BYB-02 lesson in a new form: a silent under-fetch that every dashboard
> would render as complete.

---

## Funding-netting shape

THE phase question: is Deribit funding netted into realized PnL, or a separate
transaction-log row? ccxt exposes no `fetchFundingHistory` for Deribit — funding
lives ONLY in `private/get_transaction_log`.

**Answer: SEPARATE rows.** Perpetual funding is a distinct `type=settlement`
transaction-log entry per perpetual instrument, with the funding amount in the
`cashflow` field (coin-denominated — Deribit perps are **inverse**, so an
ETH-PERPETUAL funding settles in ETH). It is NOT netted into `type=trade` PnL.
Related distinct types also observed: `delivery` (option/future expiry),
`options_settlement_summary`, `transfer`, `deposit`, `usdc_reward`,
`negative_balance_fee`. Phase 70 funding ingestion must read `type=settlement`
from the transaction log, dedup on a native-id / exact-timestamp axis (NOT a
floor bucket — see the BYB-02 finding), and convert inverse coin cashflow → USD.

**Evidence** (account 3, ETH-PERPETUAL settlement; balance/equity/position masked):

```json
{
  "type": "settlement",
  "amount": "0",
  "cashflow": "-5.032e-5",
  "instrument_name": "ETH-PERPETUAL",
  "side": "-",
  "timestamp": "1703923200046",
  "currency": "ETH"
}
```

**Status: RECORDED (Plan 67-03, 2026-07-04).**

---

## Instrument mix (inverse / linear / options)

Per-kind classification by `instrument_name` (`classify_instrument`).

**Answer: options + inverse perpetuals + spot.** Account 3 (most main-account
activity) classified **option: 192, inverse_perpetual: 167**, with samples like
`BTC-24JUL26-57000-P`, `BTC-17JUL26-65000-C` (options) and `ETH-PERPETUAL`
(inverse perp); plus spot pairs (`BTC_USDC`, `ETH_BTC`, `ETH_USDC`) and option
`delivery` rows (`ETH-19JAN24-2800-C`). Accounts 1 & 2 show the SAME kinds in
their transaction log (`ETH-PERPETUAL` settlements, `options_settlement_summary`)
even though their `instrument_mix` roll-up is empty — see the caveat below.
**No `linear_perpetual` or dated `future` observed** in the captured window.

⚠ **Caveat (feeds the CRITICAL finding above):** `instrument_mix` is derived
from `get_user_trades_by_currency_and_time`, which returned 0 trades for
accounts 1 & 2 — so their mix is empty despite real perp/option activity in the
transaction log. The transaction log is the more complete source; Phase 70
should classify instrument kind from the txn-log `instrument_name` (trade /
settlement / delivery rows), not solely from the trades endpoint. Even so, the
true mix is only knowable once subaccount history is fetched.

**Evidence:** `instrument_mix.counts` + `txn_log_instrument_samples` per account
in the evidence JSON.

**Status: RECORDED (Plan 67-03) — kinds confirmed; counts are main-account-only
and under-represent true volume (subaccount fetch required, see above).**

---

## Geo-block body marker

**Answer: no block observed.** All three keys authenticated and read cleanly
from the Amsterdam (NL) egress — `geo_block_observation.blocked = false` on every
account. Per the locked decision, NO marker is fabricated; the `#415` classifier
remains the fail-safe, and a `_GEO_BLOCK_MARKERS` substring is added to
`services/geo_block.py` only if a real block body is ever observed. Dynamic
egress caveat stands: re-probe after worker region changes.

Incidental (non-geo) errors worth noting for Phase 70 error handling:
`-32602 "not supported for wallet type"` on `account_summary` for certain
non-margin currencies (LINK/BCH/AVAX/ADA), and one `10028 too_many_requests`
rate-limit on the transaction-log endpoint.

**Evidence:** `geo_block.blocked=false`, `egress_country="NL"` per account.

**Status: RECORDED (Plan 67-03, 2026-07-04) — marker deferred-to-observed.**

---

## Bonus observations (non-blocking)

- **LTP account structure (Phase 72):** each of the 3 read-only keys sees
  `count: 2` subaccounts (`sees_any: true`). This is now load-bearing, not
  bonus — it is the leading hypothesis for the >95% history under-capture and a
  Phase 70 requirement (iterate subaccounts), and Phase 72 must model each LTP
  account's subaccount structure when mapping accounts → strategies.

- **Per-account history completeness:** captured 3.5% / 4.1% / 0.8% of the known
  18,778 / 21,014 / 61,248 totals with `trade_max_pages_hit=false` — see the
  CRITICAL FINDING at the top. Recorded in `history_completeness` per account in
  the evidence JSON.

- **Currencies held:** ~14 per account (spot balances across XRP/USDC/USDT/ETH/
  BTC/SOL/PAXG/BNB/…), consistent with spot + derivative-margin usage.

---

## Run metadata

Egress country NL (ipinfo 200), full-history window
(`start_ms=1420070400000` … now), `max_pages=500`, `count=1000` per page.
ccxt raw-endpoint fallthrough used for `private/get_transaction_log` and
`private/get_user_trades_by_currency_and_time`. UTC run 2026-07-04T18:5x.

**Status: RECORDED (Plan 67-03, 2026-07-04).**
