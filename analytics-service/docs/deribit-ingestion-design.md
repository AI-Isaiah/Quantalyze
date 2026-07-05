# Deribit Ingestion Design — resolved recipe (P70 Wave-0)

**Status:** Design locked from 3 research passes (2 official-docs walks + 1 practitioner/best-practices) cross-checked against 3 live LTP keys on the Railway worker, 2026-07-05. Supersedes the pre-probe assumptions in `70-CONTEXT.md`/`70-RESEARCH.md` where they conflict.

## The count "blocker" was fetch bugs, not a data wall

The Wave-0 probe first showed the API returning 1–7% of the known trade counts (18,778/21,014/61,248). Root-caused to three harness fetch bugs, none a data-availability limit:

1. **`include_old=true` does not exist on the current API** → the trades endpoint defaulted to `historical=false` = only the last 24h. Correct param: **`historical=true`**. (Live proof: account 3 trades 674 → 2,962 once fixed.)
2. **Both `start_timestamp` AND `end_timestamp` were passed** to `get_user_trades_by_currency_and_time`. With `count` truncating a large window and both bounds set, the endpoint anchors the page at `end_timestamp` (newest `count`); advancing `start_timestamp` to the last (newest) trade collapses the window → `has_more=false` after ONE page (the "BTC 1000-then-stop" stall). Fix: pass only `start_timestamp`, `sorting=asc`, and continue while `has_more` **or** the page is full (`len==count`) — `has_more` has no documented reliability guarantee.
3. **`get_transaction_log count=1000` exceeds the documented max of 250**, and the crawl hit the txn-log's harsh rate limit (see below) → `10028` truncation. Fix: `count=250`, follow `continuation` to null, paced ≤1 req/s with backoff.

The full multi-year history IS reachable (txn-log spans 2023→2026); it just needs the correct fetch.

## The authoritative ledger for daily returns: `private/get_transaction_log`

For the track record, **the transaction log is the single authoritative realized-cash ledger** — the only endpoint recording *every* cash movement (trade cash + fees, settlement PnL, funding, delivery, transfers, deposits/withdrawals, corrections). **Daily return = sum of the per-row cash delta (`cashflow`/`change`) bucketed by UTC day**, then through the existing `combine_realized_and_funding → trades_to_daily_returns_with_status → compute_all_metrics` path.
- Params: `currency` (req), `start_timestamp`+`end_timestamp` (req), `count` **max 250**, `continuation` (integer, null when done), `subaccount_id`, `query` (keyword filter).
- The trades endpoint is **not** a P&L ledger (fills/fees only; realized PnL on perp/inverse crystallizes at settlement) — use it only for execution detail / a fill-count integrity cross-check.
- `get_settlement_history_by_currency` is funding-inclusive but a SUBSET (omits fees/transfers/deposits) → cross-check only, not the return series.

## Funding is settlement-BUNDLED — do NOT add a separate funding stream

Decisive, corroborated across all sources: on perpetuals **funding is realized into the session PnL and booked inside the `settlement` cash delta**. There is **no separate `funding` transaction type**; `interest_pl` is a *breakdown* line ("actual funding rate of trades and settlements on perpetual instruments"), not an additional cashflow. **Summing settlement cashflow already includes funding — adding a separate funding stream double-counts.**
➡️ **Plan impact: DROP the separate funding native-id dedup path (70-04 as written).** Funding correctness = summing the settlement rows once. `_FUNDING_BUCKET_HOURS` stays deribit-free (still correct — deribit isn't bucket-funded here at all).

## Inverse (coin-margined) coin→USD

- Live-confirmed A1: `type=settlement` rows carry an event-time **`index_price`** (account 3: 218/218 present; `mark_price` absent). Convert each coin cash delta: **`usd = coin_delta × index_price`** at the row's own timestamp (NEVER a current/period-end index — cross-time is category-invalid).
- **Trust the ledger's sign** (credit +/debit −); do NOT re-derive sign from position side (that's where hand-rolled calcs flip). A3 live-confirmed: `type=trade` rows carry ZERO cashflow, so realized cash is only in settlement/delivery rows — no trade-vs-settlement double-count.
- Only INVERSE needs conversion; linear (`_USDC`/`_USDT`/`_EURR`) settles in USD already (`classify_instrument` separates them).

## Subaccounts

- Live: `get_subaccounts` returns `id` as a **string** (fixed the harness int-filter bug; count=2 per key restored). A2: subaccount history IS reachable, but the read-only keys hit `-32602 {"reason":"Not allowed","param":"subaccount_id"}` on cross-account reads.
- Per docs, `subaccount_id` requires the key be a **main-account** key with `account:read`/`trade:read`. If these LTP keys are subaccount-scoped (or lack the scope), use **`public/exchange_token`** (param is `subject_id`, not `subaccount_id`) to mint a read-scoped token per subaccount from the refresh token, OR issue **a separate read-only key per subaccount**. This is a Phase-72 onboarding/key-provisioning consideration — the fetch code must support per-scope auth.

## Rate limits (10028)

- Non-matching reads: cost 500, pool 50,000, refill 10,000/s (~20 req/s sustained), burst 100.
- **`get_transaction_log` is special: cost 10,000, pool 80,000, 1 req/s, burst 8** — the ledger crawl MUST be paced to ~1 req/s with exponential backoff on `10028`. This dominates ingestion latency for multi-year × multi-currency × multi-subaccount crawls.
- Skip ccxt for P&L (no ledger / `fetchTransactions` unsupported / timestamp paging) — call raw private endpoints. Use `history.deribit.com` for bulk historical reads.

## Net plan revisions (for the 70-0x replan)

1. **Dailies source = `get_transaction_log` cash-delta-by-day** (settlement funding-inclusive + fees + delivery), NOT reconstructed from fills. 70-06 wires this into the ONE path.
2. **Drop the separate funding ingestion/dedup path (70-04).** Funding is in settlement cashflow.
3. **Trade fetch (70-03)** = id-cursor `get_user_trades_by_currency` (or single-bound `_and_time`), `historical=true`, continue-while-full — needed for the fill-count integrity check + execution detail, not for returns.
4. **Count gate (D-02)** anchors on **txn-log/settlement completeness over the date range** (continuation-to-null, rate-limit-complete, no truncation), not fill-count reconciliation to 18,778/21,014/61,248 (those are a separate, likely fill-level, integrity cross-check).
5. **Rate-limit pacing + backoff** is a first-class ingestion requirement (1 req/s on the txn-log).
6. **Subaccount auth** via `exchange_token`/per-sub keys — support per-scope auth in the fetch loop (finalize key provisioning in P72).
