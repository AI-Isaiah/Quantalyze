# Deribit Ingestion Design — resolved recipe (P70 Wave-0)

**Status:** Design locked from 3 research passes (2 official-docs walks + 1 practitioner/best-practices) cross-checked against 3 live LTP keys on the Railway worker, 2026-07-05. Supersedes the pre-probe assumptions in `70-CONTEXT.md`/`70-RESEARCH.md` where they conflict.

## The count "blocker" was fetch bugs, not a data wall

The Wave-0 probe first showed the API returning 1–7% of the known trade counts (18,778/21,014/61,248). Root-caused to three harness fetch bugs, none a data-availability limit:

1. **`include_old=true` does not exist on the current API** → the trades endpoint defaulted to `historical=false` = only the last 24h. Correct param: **`historical=true`**. (Live proof: account 3 trades 674 → 2,962 once fixed.)
2. **Both `start_timestamp` AND `end_timestamp` were passed** to `get_user_trades_by_currency_and_time`. With `count` truncating a large window and both bounds set, the endpoint anchors the page at `end_timestamp` (newest `count`); advancing `start_timestamp` to the last (newest) trade collapses the window → `has_more=false` after ONE page (the "BTC 1000-then-stop" stall). Fix: pass only `start_timestamp`, `sorting=asc`, and continue while `has_more` **or** the page is full (`len==count`) — `has_more` has no documented reliability guarantee.
3. **`get_transaction_log count=1000` exceeds the documented max of 250**, and the crawl hit the txn-log's harsh rate limit (see below) → `10028` truncation. Fix: `count=250`, follow `continuation` to null, paced ≤1 req/s with backoff.

The full multi-year history IS reachable (txn-log spans 2023→2026); it just needs the correct fetch.

## The authoritative ledger for daily returns: `private/get_transaction_log`

For the track record, **the transaction log is the single authoritative realized-cash ledger** — the only endpoint recording *every* cash movement (trade cash + fees, settlement PnL, funding, delivery, transfers, deposits/withdrawals, corrections). Push through the existing `combine_realized_and_funding → trades_to_daily_returns_with_status → compute_all_metrics` path.
- Params: `currency` (req), `start_timestamp`+`end_timestamp` (req), `count` **max 250**, `continuation` (integer, null when done), `subaccount_id`, `query` (keyword filter).
- The trades endpoint is **not** a P&L ledger (fills/fees only; realized PnL on perp/inverse crystallizes at settlement) — use it only for execution detail / a fill-count integrity cross-check.
- `get_settlement_history_by_currency` is funding-inclusive but a SUBSET (omits fees/transfers/deposits) → cross-check only, not the return series.

## ⚠️ THE FIELD IS `change`, NOT `cashflow` (P70 re-probe correction, 2026-07-05)

**Daily return = sum of the per-row `change` field bucketed by UTC day** — NOT `cashflow`. The
earlier "`cashflow`/`change`" interchangeability was WRONG and would have dropped every trading fee
and mis-timed PnL (a BYB-02-class silent over-statement — green but wrong). Grounded in Deribit's
official OpenAPI schema + practitioner sources + ccxt source + a 3-account live re-probe:

- **`change`** = *"Change in cash balance. For trades: fees and options premium paid/received. For
  settlement: Futures session PNL and perpetual session funding."* By construction
  `balance_i = balance_{i-1} + change_i`, so **Σ`change` = exact cash-balance delta** — the
  reconciling field. It captures fees + funding + realized PnL each exactly once.
- **`cashflow`** = *"Realized session PNL (since last settlement)"* — DEFERRED (`profit_as_cashflow=true`),
  **fee-EXCLUDED**, and **0 at fill time** for perps. Summing `cashflow` DROPS all per-fill trading
  fees and reports pending (not cash) PnL. NEVER sum it for the return series.
- **No per-row `fee` field.** `commission` is *cumulative* ("paid so far") — NEVER sum it. Fees are
  already inside `change`; adding a fee term double-counts.
- **Live proof (bounded re-probe, `--max-pages 12`):** on SOL_USDC option trade rows,
  `change = cashflow − fee` per row (fee 1.7–8.8 each); acct-1 trade Σ`cashflow`=−207049.6 vs
  Σ`change`=−206454.0 (Δ≈595.6 = net fee/premium-vs-PnL gap). On inverse-perp trade rows,
  `cashflow`=session PnL (deferred) while `change`=fee only. Evidence:
  `docs/evidence/drb02-deribit-field-semantics-2026-07-05.json`.

### Type allow-list (fail loud on unknown — the enum is officially extensible)

- **INCLUDE (return-bearing, sum `change`):** `trade`, `settlement`, `delivery`, `liquidation`,
  `negative_balance_fee`. (Settlement/delivery carry the realized PnL + funding — MUST include.
  `negative_balance_fee` is a genuine cost, live-confirmed cash-bearing.)
- **EXCLUDE (external flow / informational — NOT trading return):** `deposit`, `withdrawal`,
  `transfer`, `swap`, `correction`, `usdc_reward`, `options_settlement_summary`.
  (`options_settlement_summary` is a zero-cash aggregate — live-confirmed Σ`change`=0.0 on all 3
  accounts; excluding it also avoids double-counting the real `settlement`/`delivery` rows.)
- **Unknown `type` with nonzero `change` → FAIL LOUD** (never silently include or drop). Deribit
  documents new types can appear at any time, so this is an allow-list, not a block-list.

### Numeric fields are STRINGS

The raw `private_get_get_transaction_log` (via ccxt) returns amount/cashflow/change/index_price/
balance as STRINGS, incl. scientific notation (`"5.3e3"`, `"-1.6328e-4"`). Production already
coerces via `float(row.get(...) or 0.0)` — keep that; never assume native numbers.

### Equity development & the initial-capital anchor (P70 review F1/F2/F3)

The reconstruction is anchor-to-today: `initial_capital = equity_today − Σrealized` (shared
`transforms`). Deribit-specific corrections:
- **F1 (external flows):** `Σrealized` EXCLUDES transfers/deposits/withdrawals while `equity_today`
  REFLECTS them, so the raw anchor is off by the net flow (live acct3: net −628k transfers on ~219k
  equity → ~4× return overstatement, unflagged). Fix: `account_balance = equity_today − net_external_flow`
  where the net flow is the sum of linear `transfer/deposit/withdrawal/usdc_reward` `change` (Deribit
  flows are overwhelmingly USDC/USDT). An INVERSE (coin) flow that can't be valued cheaply → flag
  heuristic capital rather than under-correct (`deribit_linear_external_flow_usd`).
- **F2 (residual, KNOWN LIMITATION):** for held OPTIONS, `equity_today` includes open-option UPL that
  `Σrealized` does not → a residual anchor error bounded by open UPL. For PERPS this is negligible
  (Deribit settles ~daily, so `settlement.change` already crystallizes MTM into the series). Documented
  follow-up; not fixed this phase (needs the shared anchor to become UPL-aware — affects all exchanges).
- **F3 (equity anchor currency scope):** the EQUITY anchor values EVERY held currency with a resolvable
  `{ccy}_usd` index (a live account holds SOL dust) — unlike the LEDGER `change` conversion which is
  BTC/ETH-only + fail-loud. A wrong equity multiply only mis-anchors; a wrong ledger multiply corrupts
  the return series.
- **C2 (empty-green floor):** a materially-funded account (>$100 equity) that produced ZERO
  return-bearing rows fails loud rather than rendering an empty-but-green "insufficient history" record.

For a raw equity CURVE (not the anchor), prefer `account_summary.equity_usd` (mark-to-market). The
per-row `balance`/`equity` are event-stamped snapshots, not a daily grid.

## Funding is settlement-BUNDLED — do NOT add a separate funding stream

Decisive, corroborated across all sources: on perpetuals **funding is realized into the session PnL and booked inside the `settlement` `change` delta** (the schema states settlement `change` = "Futures session PNL and perpetual session funding"). There is **no separate `funding` transaction type**; `interest_pl` is a *breakdown* line ("actual funding rate of trades and settlements on perpetual instruments"), not an additional cashflow. **Summing the settlement `change` already includes funding — adding a separate funding stream double-counts.**
➡️ **Plan impact: DROP the separate funding native-id dedup path (70-04 as written).** Funding correctness = summing the settlement rows once. `_FUNDING_BUCKET_HOURS` stays deribit-free (still correct — deribit isn't bucket-funded here at all).

## Inverse (coin-margined) coin→USD

- Live-confirmed A1: `type=settlement` rows carry an event-time **`index_price`** (account 3: 218/218 present; `mark_price` absent). Convert each coin cash delta: **`usd = coin_delta × index_price`** at the row's own timestamp (NEVER a current/period-end index — cross-time is category-invalid).
- **Trust the ledger's `change` sign** (credit +/debit −); do NOT re-derive sign from position side (that's where hand-rolled calcs flip). Trade rows carry nonzero `change` (the fee; `cashflow`=deferred session PnL). Σ`change` over the ledger is the balance identity, so each row is counted once with no trade-vs-settlement double-count.
- Only INVERSE (**BTC/ETH only** — fail loud on any other non-linear currency) needs conversion; linear (`_USDC`/`_USDT`/`_EURR` or a USD-family currency) settles in USD already (`classify_instrument`/`_row_is_linear` separate them). Reject a non-positive `index_price` (never value coin cash at ≤0).

## Subaccounts — SINGLE-SCOPE: the key IS its own account (drb03 correction, 2026-07-05)

**Crawl the key's OWN authenticated account as a SINGLE scope. Do NOT enumerate/crawl sibling subaccounts.** The Wave-0 "trades live in 2 subaccounts, main got <5%" was the *fetch* bug (`include_old`/`count>250`/one-page-stall), NOT a scope problem — once the fetch is correct the key's own crawl returns the complete account.

Live evidence (drb03, `docs/evidence/drb03-deribit-scope-equity-2026-07-05.json`):
- Each LTP read-only key authenticates AS one Deribit subaccount. Its `get_account_summaries` / `get_transaction_log` / `get_user_trades` already return that account's COMPLETE data.
- `get_subaccounts(with_portfolio=true)` returns an empty `type=main` parent shell + the key's own account; the key's own equity is **byte-identical** to that account's portfolio (acct2 USDC 622,923.41; acct3 USDT 232,500 — exact match). So the siblings only duplicate the key's own data.
- The siblings are **NOT separately reachable**: `subaccount_id` → `-32602` (Wave-0), and `public/exchange_token` → **BadRequest** (it needs an OAuth refresh_token, which client-credentials API-key auth does not provide). So a multi-scope crawl would only **fail loud on the token mint** — never fetch anything new.
- ➡️ **`enumerate_scopes` returns a single `main` scope.** The equity anchor `get_account_summaries({})` on the key is the correct TOTAL equity (single scope). The `resolve_scope_auth`/`exchange_token` machinery is retained for a possible P72 provisioning revisit but is unused by the single-scope crawl.
- Provisioning contract (P72): **one read-only key per trading subaccount** — exactly what the LTP keys already are.

## Currency universe — the AUTHORITATIVE, balance-independent expected set

The completeness gate's `expected` currencies = the FULL `public/get_currencies` universe (18 wallet currencies), NOT held balances. A now-zero currency that HELD history must still be crawled, else the gate — graded against a held-derived set — is blind to the drop (self-referential-gate class). `enumerate_currencies` **fails loud** (`CurrencyEnumerationError`) if the list can't be read or is empty. A currency the account never funded surfaces at the crawl as empty or a per-currency `-32602` "no wallet" → recorded **complete-empty** (`reached_end=True, rows=0`), never a gap.

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
