# Phase 76: Binance/Bybit/OKX Flow Adapters + Reconciliation Gate - Context

**Gathered:** 2026-07-06
**Status:** Ready for planning
**Mode:** Autonomous smart-discuss (decisions from ROADMAP SCs + STATE; research to confirm ccxt mechanics + wallet scope)

<domain>
## Phase Boundary
The three ccxt venues (Binance, Bybit, OKX) source DATED external flows through
ONE promoted-shared helper, each excluding own-wallet transfers, and a
missing-flow RECONCILIATION GATE refuses to silently attribute a coverage gap to
performance (the LTP068-inflation class at venue scope). Requirements: FLOW-03,
DQ-02.
</domain>

<decisions>
## Implementation Decisions — LOCKED (ROADMAP SC 1-4)
1. **Promote the shared fetch:** `equity_reconstruction._fetch_transfers`
   (paginates ccxt fetch_deposits/withdrawals in 90-day windows) + a transfer→USD
   valuation helper are promoted to a shared importable module with NO behavior
   change to the allocator-dashboard job that owns it today, then wrapped per-venue
   in `external_flows.py` (emitting the P75 `ExternalFlow=(utc_day_iso, usd_signed)`
   contract). ONE flow-fetch path, not three copies.
2. **Own-transfer exclusion per venue** (a self-transfer is NOT external cash):
   - **Binance:** `transferType==0` external-only (==1 internal → EXCLUDE).
   - **Bybit:** on-chain deposit/withdraw only; inter/internal-transfer EXCLUDED.
   - **OKX:** deposit-history / withdrawal-history (auto-excludes own-transfers —
     they only appear in asset/transfer).
   One fixture per venue asserts: a real deposit + an internal own-transfer →
   ONLY the deposit becomes `F_t`.
3. **Reconciliation gate (DQ-02):** `NAV_today − reconstructed_start − Σpnl ≈ Σflows`
   within tolerance. On mismatch (e.g. a deposit OUTSIDE OKX's 90-day retention),
   FAIL LOUD: segment the series at the terminus and refuse pre-terminus
   reconstruction rather than attributing the gap to performance. Distinguish a
   TRANSIENT fetch failure from a genuine end-of-history (WR-04 precedent — do not
   permanently truncate on a transient error).
4. **Binance SPOT-vs-USDⓈ-M wallet scope** verified against the live account
   roster so anchor, PnL, and flows all read the SAME pool of capital (research
   flag, MEDIUM confidence — may need a runtime/roster probe, not just code).

### Research corrections (76-RESEARCH.md — fold into plans)
- **CORRECTION to SC1/D-1:** there is NO existing transfer→USD valuation helper to
  "promote." `_fetch_transfers` returns raw ccxt rows; its only consumer marks the
  WHOLE balance at daily close (stablecoins forced to 1.0) — mark-to-market, NOT
  per-flow event-time. BUILD the ccxt flow→USD valuation NEW, mirroring P75's
  `deribit_dated_external_flows_usd`: stablecoins {USDT,USDC,DAI,BUSD,TUSD,FDUSD,USD}
  → 1.0; every other coin → SAME-UTC-day daily close via the existing
  OHLCV/CoinGecko/`token_price_history` source; FAIL LOUD if no same-day price
  (never 1.0, never current). Promote `_fetch_transfers` itself (the fetch) with
  ZERO behavior change to its allocator-dashboard consumer; keep the pure valuation
  in a stdlib-only module (split pure/IO like deribit_txn.py / deribit_ingest.py).
- **Own-transfer filter (introspected ccxt 4.5.59):** Binance = unified
  `row['internal'] is False`; **Bybit `internal` is None** → read raw
  `info.withdrawType == '0'`; OKX deposit/withdraw-history structurally excludes.
- **DQ-02 gate:** the identity residual `(anchor−uPnL) − reconstructed_start − Σpnl
  − Σflows` holds BY CONSTRUCTION in the backward roll → it is a MUTATION DETECTOR
  (reddens on a dropped/mis-valued flow), tolerance `max($1, 1e-6·|anchor|)`, pure
  in nav_twr.py. The REAL gap detector is TERMINUS SEGMENTATION: a missing old
  deposit (OKX ~90-day retention) drives early NAV ≤ 0 → DQ-01 guards fire; DQ-02
  segments at the last trustworthy day, refuses pre-terminus TWR, flags
  `complete_with_warnings`. Reuse OKX terminus (`equity_reconstruction.py:576-601`)
  + `pre_terminus_balance_unknown` (:1962). Transient-vs-terminal reuses
  `_fetch_transfers` error bubbling (:665-676) — only a clean empty at the
  retention boundary segments.
- **Wallet scope (Q4/Q5) — do NOT block the run on live verification.** Build to the
  best-known scope (research's determination). The DQ-02 reconciliation gate makes a
  WRONG scope FAIL LOUD (Σflows won't reconcile → segment/flag, never silent
  mis-attribution). Additionally flag Binance SPOT-vs-USDⓈ-M and Bybit
  FUND/UNIFIED/CONTRACT for FOUNDER CONFIRMATION at the Phase 78 acceptance gate —
  a `checkpoint:human-verify`/autonomous:false note, not a phase-76 blocker.
- **NEW pitfall (fix opportunistically):** the promoted `_fetch_transfers`
  under-paginates OKX (100/page) and Bybit (50/page) — it breaks on `len(page)<500`.
  Latent today, load-bearing on the full-history factsheet path.

### Grey areas — research to confirm
- **Flow→USD event-time valuation (the ccxt analog of the P75 inverse risk):**
  ccxt deposits/withdrawals are amount+currency+timestamp. A non-USD/non-stable
  coin flow (BTC deposit) must be valued at EVENT-TIME price, fail-loud if no
  price — NEVER at 1.0 or a current price. Research: what price source does the
  existing `_fetch_transfers`/valuation helper use, and is it event-time?
- **Bybit wallet accounts:** FUND↔UNIFIED own-transfer inflates the UNIFIED anchor;
  anchor must cover FUND+UNIFIED+CONTRACT combined OR net them (STATE note).
- **Reconciliation tolerance + terminus segmentation:** exact tolerance, and the
  WR-04 transient-vs-terminal distinction mechanism.
</decisions>

<code_context>
## Existing Code Insights
- `services/equity_reconstruction.py:642 _fetch_transfers` (paginate
  fetch_deposits/withdrawals, 90-day windows), consumed at :1739-1742 by the
  allocator-dashboard equity reconstruction — MUST NOT change its behavior when
  promoting it to shared.
- `services/external_flows.py` (P75): the `ExternalFlow` contract to emit.
- `services/nav_twr.py` (P75-05): `_union_flow_days` already handles flow-only
  days — ccxt flows inherit it (a deposit before first trade won't orphan).
- Deribit's `deribit_dated_external_flows_usd` (P75) is the per-venue-adapter
  precedent: dated list, event-time valuation, fail-loud, count-once.
</code_context>

<specifics>
## Specific Ideas
- Reuse the ONE promoted fetch+valuation helper for all three venues; per-venue
  code is only the own-transfer FILTER + wallet-scope selection.
- The reconciliation gate is a NEW DQ mechanism — model it on the existing
  data_quality_flags / complete_with_warnings machinery (do NOT invent a parallel
  status system). A segmented series flags, it does not fabricate.
- Every fixture that could hide a coverage gap (missing flow attributed to
  performance) must be mutation-honest: fail if the gate lets a gap through.
</specifics>

<deferred>
## Deferred Ideas
- uPnL basis reconciliation (Phase 77).
- Golden parity + P72 LTP068 acceptance (Phase 78, hard gate).
- Broker→CSV guard-meta propagation gap (TODOS.md, P74) — candidate to close here
  or P78 (this phase touches the ccxt/broker reconciliation surface).
- Short-window CAGR DQ flag (TODOS.md, P73) — P78 parity gate.
- Dead `deribit_linear_external_flow_usd` removal (P75) — milestone cleanup.
</deferred>
