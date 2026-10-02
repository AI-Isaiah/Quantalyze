# Phase 75: Deribit Dated-Flow Adapter (RISKY) - Context

**Gathered:** 2026-07-06
**Status:** Ready for planning
**Mode:** Autonomous smart-discuss (RISKY phase — decisions below are locked from the ROADMAP SCs + STATE risk notes)

<domain>
## Phase Boundary

Deribit external flows become DATED per-day and inverse-valued in-band from the
already-crawled txn-log. The imprecise F1 net-scalar anchor correction is
DELETED. The shared dated-flow contract every later adapter (Phase 76 ccxt
venues) targets is established. Requirements: FLOW-01, FLOW-02.

**RISKY:** inverse-coin (BTC/ETH) valuation is the milestone's silent-corruption
risk. Valuing a coin flow at the WRONG time, at 1.0, at a current price, or
DROPPING it entirely fabricates a ±100% day. The only safe valuation is the
same-day settlement index, fail-loud if absent.
</domain>

<decisions>
## Implementation Decisions — LOCKED (ROADMAP SC 1-4)

1. **The ONE dated-flow contract** — `services/external_flows.py` defines
   `ExternalFlow = (utc_day_iso, usd_signed)` (deposit +, withdrawal −),
   consumed by the core `reconstruct_nav_and_twr(external_flows=...)` regardless
   of venue, keyed on the SAME `_row_utc_day` UTC-day helper the realized/funding
   buckets use (a midnight-adjacent flow must not drift onto the wrong day).
2. **`deribit_linear_external_flow_usd` emits a dated per-day LIST** (no longer a
   net scalar). Inverse BTC/ETH flow rows are valued at the same-day
   `get_delivery_prices` settlement index via the EXISTING
   `txn_change_to_usd` / `supplemental_index` path (the P72 quiet-day fix), and
   **fail loud (`LedgerValuationError`) if no same-day index exists** — NEVER
   valued at 1.0, NEVER at a current/most-recent price, NEVER dropped.
3. **Delete the F1 scalar anchor correction** (`equity −= net_external_flow_usd`)
   in `job_worker.py`. Deribit flows feed ONLY the NAV `F_t` term (via the core's
   `external_flows`) and stay EXCLUDED from the realized daily sum — the
   count-once invariant is preserved via `INFORMATIONAL_TYPES`.
4. **VCR fixtures on LTP068's known flow days:** a real BTC withdrawal becomes a
   correctly-signed, event-time-valued `F_t` on its ACTUAL day; a pure-flow day
   with no trading yields `r_t == 0` (flow cancels in the numerator — the
   flow-neutral TWR property proven in Phase 73).

### Research corrections (75-RESEARCH.md — fold into plans)
- **FINDING C1 (the critical non-obvious task):** `inverse_days_needing_index`
  filters on `CASH_BEARING_TYPES` (`deribit_txn.py:483`), so inverse deposit/
  withdrawal days (which are INFORMATIONAL, not cash-bearing) get NO
  `get_delivery_prices` fetch — a real BTC withdrawal on a quiet day would
  `LedgerValuationError` the WHOLE job for lack of an index. The index-fetch MUST
  be extended to cover inverse `_EXTERNAL_FLOW_TYPES` rows. This is the phase's
  highest-risk work — plan it explicitly with a mutation-honest test.
- **SC4 nuance (reconciled):** "pure-flow day → r_t == 0" holds ONLY when
  `|F| < NAV_{t-1}`. A DOMINATING withdrawal (LTP068 withdrew ~$2.5M) correctly
  trips `flow_dominated_guard` → r_t = NaN + flag, NOT 0. VCR fixtures must cover
  BOTH: a normal flow day → r_t==0, AND a dominating flow → flow_dominated_guard
  (this is correct honest behavior, not a bug).
- Taxonomy (verified): `_EXTERNAL_FLOW_TYPES = {transfer, deposit, withdrawal,
  usdc_reward}` (→ F_t); return-bearing `{trade, settlement, delivery,
  liquidation, negative_balance_fee}` (funding is inside settlement.change);
  `swap` informational. Count-once is structural (external-flow types are in
  `INFORMATIONAL_TYPES`, skipped from the realized sum). F1 scalar to delete:
  `job_worker.py:1968-1979` (sole consumer). `usdc_reward` flow-vs-income is an
  Open Q — keep current behavior, do not expand scope.

### Grey areas — auto-decided (research to confirm mechanics)
- **Which txn-log types are external flows?** deposits / withdrawals / transfers
  that move cash IN/OUT — NOT trades / settlements (return-bearing). Research MUST
  enumerate the exact Deribit `type` taxonomy and which are flows vs
  return-bearing vs informational. The `change` field is authoritative (P70
  re-probe); credit(+)/debit(−) sign trusted verbatim.
- **Sign mapping:** `usd_signed` follows the `change` sign (deposit credit +,
  withdrawal debit −). No re-derivation.
- **Single-scope:** each Deribit key = its own subaccount (STATE). Funding is
  settlement-bundled and is return-bearing (NOT a flow) — do not double-count.
</decisions>

<code_context>
## Existing Code Insights
- `analytics-service/services/deribit_txn.py`: `LedgerValuationError`,
  `txn_change_to_usd` (row `change` → USD, fee-inclusive), `classify_instrument_settlement`,
  `_row_utc_day`, `INFORMATIONAL_TYPES`, the `change`-not-cashflow rule, funding
  settlement-bundling. The P72 quiet-day inverse fix (get_delivery_prices same-day
  settlement mark + fail-loud) is the valuation pattern to GENERALIZE to flows.
- The core: `nav_twr.reconstruct_nav_and_twr(daily_pnl, anchor_nav, *,
  external_flows=None, ...)` already accepts the `ExternalFlow` list and dates it
  via `_flows_to_daily_usd` (Phase 73). Phase 74 threaded the param through.
- `job_worker.py`: the F1 scalar anchor correction to delete; the Deribit ingest
  path that produces the txn-log.
</code_context>

<specifics>
## Specific Ideas
- The `external_flows.py` contract must be venue-agnostic — Phase 76 ccxt adapters
  target it verbatim. Keep it a pure dataclass/tuple + validation, no I/O.
- Reuse `txn_change_to_usd` / the supplemental-index path — do NOT write a second
  inverse-valuation routine (one honest valuation path).
- Every regression test that could ever fabricate a ±100% day (mis-valued or
  dropped inverse flow) must be mutation-honest: fail if the flow is valued at the
  wrong time, at 1.0, or dropped.
</specifics>

<deferred>
## Deferred Ideas
- ccxt venue flow adapters (Binance/Bybit/OKX) + reconciliation gate — Phase 76.
- uPnL basis reconciliation — Phase 77.
- Golden parity + P72 LTP068 acceptance canary — Phase 78 (the hard gate; this
  phase's LTP068 dated flows are what make that canary go honest).
- Broker→CSV guard-meta propagation gap (TODOS.md, P74) — Phase 76/78.
</deferred>
