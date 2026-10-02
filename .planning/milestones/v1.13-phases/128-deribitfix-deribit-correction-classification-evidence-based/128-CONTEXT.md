# Phase 128: DERIBITFIX — deribit `correction` classification (evidence-based) - Context

**Gathered:** 2026-07-19
**Status:** BLOCKED on founder evidence (the key3 `correction` ledger entry) — founder chose "paste the key3 entry, I classify on it"
**Mode:** Auto-generated (autonomous; evidence-gated — NO guessing the classification)

<domain>
## Phase Boundary

A deribit account containing a `correction` txn-log entry ingests cleanly with
correct equity — classified on EVIDENCE of what deribit `correction` means —
while genuinely-unknown types keep failing loud.

Current bug (dogfood 2026-07-18, Railway key3): `LedgerValuationError` because
`correction` is in neither `CASH_BEARING_TYPES` nor `INFORMATIONAL_TYPES` in
`analytics-service/services/deribit_txn.py`. The allow-list design fails loud on
any unknown type carrying nonzero `change`. key1/key2 ingest clean.
</domain>

<evidence>
## Evidence gathered (DERIBITFIX-01 requires the evidence written down)

### Documentary (deribit) — INCONCLUSIVE on semantics
- `correction` IS a documented deribit `get_transaction_log` `type`, in the
  EXTENSIBLE common-types enum (`trade, deposit, withdrawal, settlement, delivery,
  transfer, swap, correction, expiry, ...`; "New types can be added any time").
- The `change` field is documented as "Change in cash balance" (a required field).
- Deribit publishes **NO explicit definition** of what a `correction` entry
  represents. The Support "Transaction log" article was 403/blocked.
- Ecosystem tools (ccxt ledger mapping, cointracking/coinpanda tax imports) do
  NOT distinctly document/categorize `correction`.
- Sources: docs.deribit.com/api-reference/account-management/private-get_transaction_log ;
  support.deribit.com/hc/en-us/articles/25944587269021-Transaction-log

### Inferential (from our own code) — the key3 correction carries NONZERO change
- `deribit_txn.py` CASH_BEARING is an ALLOW-LIST: an unknown type with nonzero
  `change` FAILS LOUD; a zero-change unknown type falls through harmlessly
  (see the `options_settlement_summary` INERT comment ~L609). Therefore the key3
  `correction` that raised `LedgerValuationError` MUST carry a **nonzero cash
  balance change** — a real balance movement, not an annotation.
- A `correction` is an EXCHANGE-SIDE balance adjustment (fixing a discrepancy) —
  not a user trade, not a user deposit/withdrawal.

### ⭐DECISIVE EVIDENCE — the actual key3 `correction` row (read-only Railway recrawl 2026-07-19, founder-authorized, DERIBIT_CLIENT_ID_3/_SECRET_3)
Pulled directly from the live key3 `private/get_transaction_log` (read-only; secret
stayed in the Railway container). The single `correction` row:
```
type: correction
change:  -3.2469e-4  (= -0.00032469 BTC — matches the dogfood LedgerValuationError exactly)
currency: BTC
instrument_name: null
timestamp: 1784203977644  (2026-07-15)
id: 952844476
side: "-"   cashflow: -3.2469e-4   equity: 0.0973569
info.reason: "2026-07-15 BTC-PERPETUAL funding calculation correction"
```
**⇒ DETERMINATION (evidence-based, CONFIRMED): CASH_BEARING.** The `info.reason`
proves it is a correction to **BTC-PERPETUAL FUNDING**. Perpetual funding is ALREADY
CASH_BEARING in this codebase — booked via `settlement` ("Futures session PNL +
perpetual session funding"). A correction to a funding calculation is therefore an
adjustment to REALIZED trading cash → it must be SUMMED into realized PnL exactly
like settlement/funding. It is NOT external capital (a −0.0003 BTC funding-calc fix
is not a deposit/withdrawal/transfer) and NOT a zero-change annotation (nonzero).
The earlier external-flow lean is refuted; the mistrade-research lean (CASH_BEARING)
is confirmed by the actual `info.reason`.

### ⭐Practitioner/rulebook research (2026-07-19) — REVERSED the lean to CASH_BEARING
- Deribit publishes NO definition of the transaction-log `type=correction`
  specifically (confirmed across API ref / .md / llms.txt / support-403 / web
  archive blocked / ccxt / tax tools / GitHub — no one defines it).
- BUT Deribit has a formal **MISTRADE / price-adjustment process**: a trade at an
  abnormal/non-orderly (mispriced) level can have its **price adjusted or the
  trade reversed** by the Exchange ("Price adjustments or reversal of options
  trades will be done only if the traded price... was further than mistrade
  correction value away from the theoretical price"; the Exchange "may declare a
  Mistrade at its own initiative or on application"). Sources: Deribit Exchange
  Rulebook (support 25944555524125), Order Management Best Practices (29514039279773).
- ⇒ The most plausible origin of a `correction` ledger row is a Deribit-initiated
  **trade price correction / mistrade reversal** — a TRADING cash adjustment that
  corrects an already-booked `trade`. This carries a real nonzero `change`
  (consistent with the fail-loud inference) and is NOT external capital.
- ⇒ **Evidence-based lean is now CASH_BEARING** (sum `correction.change` into
  realized PnL like `trade`/`settlement`/`delivery`), REVERSING the earlier
  external-flow/informational lean. The key3 row's `instrument_name` is the
  clincher: a derivative contract name ⇒ trade-correction ⇒ CASH_BEARING;
  a bare currency w/ no instrument ⇒ reconsider (could be a balance-level fix).

### Classifier semantics (deribit_txn.py) — where correction must land
- `CASH_BEARING_TYPES` {trade, settlement, delivery, liquidation, negative_balance_fee}:
  `change` summed as realized PnL.
- `INFORMATIONAL_TYPES` {transfer, deposit, withdrawal, usdc_reward, swap}:
  `change` UNCONDITIONALLY skipped from realized even when nonzero.
- `_EXTERNAL_FLOW_TYPES` {transfer, deposit, withdrawal, usdc_reward}: the equity
  anchor SUBTRACTS their net (identity `initial = equity_today − Σrealized`), so a
  large flow doesn't distort initial_capital.
- The two sets MUST stay disjoint (import-time assert). A native-sibling reclass
  exists for `swap` (internal rebalance → native cash-bearing).
</evidence>

<decisions>
## Implementation Decisions

### ⭐REFINED DESIGN (founder 2026-07-19): gate `correction` on `info.reason`, don't blanket-classify
A blanket `correction → CASH_BEARING` assumes EVERY correction is trading
performance — a guess for reasons we haven't observed. The evidence is a FUNDING
correction. A future CAPITAL correction (deposit/withdrawal/transfer fix) counted
as performance would corrupt returns. So classify PER ROW on `info.reason`:
- reason matches a TRADING/PnL pattern (funding/settlement/session/pnl/delivery/
  trade/fee/interest/liquidation/premium/mark/expiry) → CASH_BEARING (sum into
  realized like settlement/funding). The observed row matches on "funding".
- unrecognized / missing / capital-flavored (deposit/withdrawal/transfer/wallet)
  reason → FAIL LOUD (LedgerValuationError naming the reason) — keeps the
  fail-loud safety exactly where the risk is (never silently count capital as
  performance). Applies on BOTH the USD and native paths (consistent).
Why this over blanket: it is evidence-FAITHFUL (classify on the actual reason,
not a type guess) and preserves the founder's "fail-loud > silent-wrong" rule.
See the architecture Q&A: the equity anchor (`initial = equity_today − Σrealized`)
makes the TERMINAL equity self-correcting, but the DAILY curve + performance-vs-
capital split REQUIRE each cash flow (incl. corrections) to be dated + bucketed —
which is why a correction must be read/classified, not ignored.

### Classification = FOUNDER evidence-gated (DERIBITFIX-01) — RESOLVED via the reason-gate above
Founder chose to PASTE the actual key3 `correction` entry so the classification
is made on hard evidence, not a guess. Once provided, classify:
- If the correction is an exchange BALANCE ADJUSTMENT (not trading result): most
  likely EXTERNAL-FLOW / INFORMATIONAL (exclude from realized, subtract net at the
  anchor) — the evidence-based lean.
- If it is a genuine TRADING-COST adjustment (fee/settlement reversal): CASH_BEARING.
- Decision + the pasted evidence written down together, in the fix + SUMMARY.

### Buildable once classified (DERIBITFIX-02)
- Regression fixture: a `correction`-bearing ledger → ingest succeeds with the
  CORRECT equity for the chosen classification, and FAILS without the fix.
- A genuinely-unknown FUTURE type STILL raises `LedgerValuationError` — the fix
  classifies `correction` SPECIFICALLY, never broadening the allow-list to absorb
  the unknown class (no corruption path opened). Preserve the import-time
  disjointness asserts.

### Claude's Discretion
Fixture construction + exact code placement, once the classification is set.
</decisions>

<specifics>
## Specific Ideas

Await the founder's key3 `correction` row (change/currency/timestamp/info),
classify definitively, then build the specific fix + the two DERIBITFIX-02 guards.
</specifics>

<deferred>
## Deferred Ideas

None — scope is exactly the `correction` classification + its guards.
</deferred>
