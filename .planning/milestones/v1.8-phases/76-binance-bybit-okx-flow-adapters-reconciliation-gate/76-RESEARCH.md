# Phase 76: Binance/Bybit/OKX Flow Adapters + Reconciliation Gate - Research

**Researched:** 2026-07-06
**Domain:** ccxt deposit/withdrawal flow sourcing + event-time USD valuation + fail-loud NAV reconciliation (analytics-service, Python)
**Confidence:** HIGH (ccxt semantics introspected against the pinned 4.5.59 in the CI-3.12 venv; all seams read at file:line)

## Summary

Phase 76 makes the three ccxt venues (Binance, Bybit, OKX) source **dated external
flows** through ONE promoted-shared fetch helper, each excluding own-wallet
transfers, valued at **event-time USD**, emitted as the P75 `ExternalFlow`
contract, and threaded into the honest core exactly where the Deribit branch
already threads its flows (`job_worker.py:1979` → `combine_realized_and_funding`
→ `reconstruct_nav_and_twr`). It then adds a **reconciliation gate** (DQ-02) that
refuses to attribute a flow-coverage gap (a deposit older than OKX's ~90-day
deposit-history retention) to performance.

The single highest-risk finding is **Q2**: there is **NO existing event-time
transfer→USD valuation helper to "promote."** `_fetch_transfers`
(`equity_reconstruction.py:642`) returns raw ccxt rows (`amount` + `currency` +
`timestamp`); its only consumer folds the coin *quantity* into a running balance
and marks the *whole balance* at each replay day's daily close
(`_compute_daily_equity` L1205-1243, stablecoins → `1.0`). That is a
mark-to-market equity curve, **not** a per-flow event-time value. The ccxt
event-time valuation must be **built new**, mirroring P75's
`deribit_dated_external_flows_usd` — fail loud if a non-stable coin has no
same-UTC-day price, NEVER `1.0`, NEVER a current price. The price source already
exists (`_fetch_ohlcv_daily` daily close + CoinGecko fallback + `token_price_history`
cache), so this is a wiring/discipline problem, not a missing-data problem.

**Primary recommendation:** Mirror the Deribit pure/I-O split precedent verbatim.
A **pure** `ccxt_rows_to_dated_flows(rows, *, venue, price_index)` (per-venue
own-transfer filter + event-time valuation, injected price resolver, fail-loud) in
a pure module; an **I/O** layer that fetches rows via the promoted `_fetch_transfers`
and supplies `price_index`, exactly as `deribit_ingest.fetch_deribit_ledger_daily_records`
supplies `supplemental_index` to the pure `deribit_dated_external_flows_usd`
(`deribit_ingest.py:682`). Wire the result into the `else` branch at
`job_worker.py:1982-2001`, setting `external_flows` before the `combine_realized_and_funding`
call at `:2012`.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions (ROADMAP SC 1-4)
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

### Claude's Discretion (Grey areas — research to confirm)
- **Flow→USD event-time valuation:** confirm what price source `_fetch_transfers`/
  valuation uses and whether it is event-time. (RESOLVED below — Q2.)
- **Bybit wallet accounts:** FUND↔UNIFIED own-transfer inflates the UNIFIED anchor;
  anchor must cover FUND+UNIFIED+CONTRACT combined OR net them. (RESOLVED below — Q5.)
- **Reconciliation tolerance + terminus segmentation:** exact tolerance and the
  WR-04 transient-vs-terminal mechanism. (RESOLVED below — Q6.)

### Deferred Ideas (OUT OF SCOPE)
- uPnL basis reconciliation (Phase 77).
- Golden parity + P72 LTP068 acceptance (Phase 78, hard gate).
- Broker→CSV guard-meta propagation gap (P74) — candidate for P78.
- Short-window CAGR DQ flag (P73) — P78 parity gate.
- Dead `deribit_linear_external_flow_usd` removal — milestone cleanup.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| FLOW-03 | Binance/Bybit/OKX dated flows via promoted-shared `_fetch_transfers`, each with own-transfer EXCLUSION; one fixture per venue (real deposit + internal own-transfer → only deposit becomes `F_t`); Binance SPOT-vs-USDⓈ-M wallet scope verified against live roster | Q1 (promotion home + no-behavior-change constraint), Q2 (event-time valuation MUST be built), Q3 (per-venue filter fields — introspected), Q4 (Binance wallet scope — code-mapped + live-roster flag), Q5 (Bybit FUND/UNIFIED anchor) |
| DQ-02 | Missing-flow reconciliation gate: `NAV_today − reconstructed_start − Σpnl ≈ Σflows`; mismatch fails loud + refuses pre-terminus reconstruction; transient vs end-of-history distinguished (WR-04); series segmented at terminus | Q6 (gate design + tolerance + terminus segmentation), Q7 (OKX 90-day retention pitfall), reuse of `pre_terminus_balance_unknown` + DQ-01 guard machinery |
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Fetch ccxt deposits/withdrawals (paginated, 90-day windows) | analytics-service I/O layer (`_fetch_transfers`, promoted) | — | Network + ccxt; must not be pure |
| Event-time coin→USD valuation of a flow | Pure valuation module (mirror `deribit_txn.py`) | I/O layer supplies `price_index` | Purity = revert-proof, unit-testable, no network in the math |
| Per-venue own-transfer exclusion filter | Pure valuation module | — | Deterministic field predicate on already-fetched rows |
| Wire flows into the NAV/TWR core | `job_worker.py` derive_broker_dailies `else` branch (:1982) | `broker_dailies.combine_realized_and_funding` (passthrough) | Same seam the Deribit branch uses (:1979) |
| Reconciliation gate (identity residual + terminus segmentation) | Pure core (`nav_twr.py`, new fn) for the residual math; I/O layer supplies `hit_terminus`/retention | `analytics_runner` lifts flags → `data_quality_flags` | DQ math is pure; coverage-window signal is I/O-derived |
| Anchor (today's equity) | `exchange.fetch_account_equity_usd` (existing) | — | Unchanged; flows correct the base, anchor stays anchor-to-today |

## Standard Stack

**No new dependencies.** Everything is already pinned and verified in the CI-3.12 venv.

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `ccxt` | 4.5.59 | `fetch_deposits`/`fetch_withdrawals` (all 3 venues `has==True`) | Already the venue client for trades/funding/anchor `[VERIFIED: introspected in venv312]` |
| `pandas` | 2.2.3 | NAV/TWR series math (via the existing core) | Already the core's engine `[CITED: REQUIREMENTS.md L10]` |
| `numpy` | 2.4.6 | fail-loud finite coercion, reconstruction arrays | Already in `nav_twr.py` `[VERIFIED: nav_twr.py:37]` |

**Version verification:**
```
ccxt==4.5.59  # requirements.txt; venv312 introspection confirmed 4.5.59
has[fetchDeposits]=True / has[fetchWithdrawals]=True for binance, bybit, okx
has[fetchDepositsWithdrawals]=False everywhere → the two-call pattern is mandatory
```
`[VERIFIED: python -c introspection in the CI-3.12 venv312, 2026-07-06]`

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Two-call `fetch_deposits`+`fetch_withdrawals` | `fetch_deposits_withdrawals` | `has==False` on all three venues — not an option `[VERIFIED]` |
| Manual cursor loop in `_fetch_transfers` | ccxt `params={'paginate': True}` (cursor/dynamic) | ccxt's built-in pagination respects per-venue page-size caps; the hand-rolled loop does NOT (see Pitfall 3) |

## Package Legitimacy Audit

**Not applicable** — Phase 76 installs no external packages. `ccxt`/`pandas`/`numpy`
are already pinned in `analytics-service/requirements.txt` and used throughout the
service. No slopcheck run required.

## Architecture Patterns

### System Data Flow (derive_broker_dailies factsheet path)

```
job_worker.dispatch(derive_broker_dailies)
  └─ venue == binance|bybit|okx  (else branch, job_worker.py:1982)
       ├─ equity, balance_error = fetch_account_equity_usd(exchange, venue)   # ANCHOR (today)
       ├─ realized = fetch_all_trades(exchange, since_ms=None)                # trading PnL
       ├─ funding  = fetch_funding_{binance|okx|bybit}(exchange, ...)         # funding PnL
       ├─ NEW: rows = _fetch_transfers(exchange,"deposits"/"withdrawals",...) # PROMOTED I/O
       ├─ NEW: price_index = resolve event-time daily closes for non-stable ccys (I/O)
       ├─ NEW: external_flows = ccxt_rows_to_dated_flows(rows, venue, price_index) # PURE
       │        · per-venue own-transfer filter   · event-time coin→USD   · fail-loud
       └─ returns, meta = combine_realized_and_funding(
                             realized, funding, account_balance=equity,
                             external_flows=external_flows)          # SAME seam as :2012
                └─ trades_to_daily_returns_with_status
                     └─ nav_twr.reconstruct_nav_and_twr(external_flows=...)   # F_t in numerator
                          ├─ _union_flow_days   (quiet-day flow = zero-pnl NAV day; HIGH-1)
                          ├─ reconstruct_nav    (NAV_{t-1}=NAV_t−pnl_t−F_t, backward)
                          ├─ chain_linked_twr   (r_t=(NAV_t−NAV_{t-1}−F_t)/NAV_{t-1})
                          └─ DQ-01 guards       (dust/negative/flow_dominated)
       └─ NEW: reconciliation gate (DQ-02) — residual + terminus segmentation → flags
```

### Pattern 1: Pure valuation + I/O fetch split (the Deribit precedent — mirror exactly)
**What:** The row→USD math is a pure function; the network fetch and the price
resolver are I/O and inject their result.
**Why:** revert-proof, unit-testable without vcr, and keeps `external_flows.py`
purity intact (it is stdlib+typing only — `external_flows.py:25-28`).
**Precedent (verbatim to copy):**
```python
# services/deribit_ingest.py:682 (I/O layer supplies the price fallback)
dated_external_flows.extend(
    deribit_dated_external_flows_usd(rows, supplemental_index=supplemental)
)
# services/deribit_txn.py:581 (PURE valuation — no network, injected index)
def deribit_dated_external_flows_usd(rows, *, supplemental_index=None) -> list[ExternalFlow]:
    ...  # own-index FIRST, else supplemental; fail-loud LedgerValuationError if neither
```
`deribit_txn.py` is pure; `deribit_ingest.py` does the fetch. `[VERIFIED: deribit_ingest.py:37-40,682]`

### Pattern 2: The own-transfer filter is the unified `internal` field — EXCEPT Bybit
`ccxt.binance.parse_transaction` maps `transferType` into the **unified** `internal`
field:
```python
# ccxt 4.5.59 binance.parse_transaction (introspected)
internalInteger = self.safe_integer(transaction, 'transferType')
internal = True if (internalInteger != 0) else False
```
So the Binance filter is simply `row['internal'] is False`. **Bybit does NOT populate
`internal`** (`parse_transaction` sets `'internal': None`) — its filter must read the
raw `info.withdrawType` (`0` = on-chain). OKX also leaves `internal: None` but its
deposit/withdrawal-history endpoints structurally exclude own funding↔trading moves.
`[VERIFIED: introspected binance/bybit/okx parse_transaction in venv312]`

### Anti-Patterns to Avoid
- **Valuing a non-stable coin flow at 1.0 or at the current price.** This is the
  ccxt analog of the P75 inverse-risk. Fail loud (`NavReconstructionError`) if no
  same-UTC-day price exists — never substitute.
- **Re-deriving the sign from deposit/withdrawal direction after already signing it.**
  Deposit → `+`, withdrawal → `−`; trust one source (mirror the Deribit `change`-sign
  discipline).
- **Hand-rolling `break on len(page) < page_limit`** across venues with different
  page-size caps (see Pitfall 3).
- **Adding a parallel status system.** Reuse `NavTWRMeta` guards + `data_quality_flags`
  + `complete_with_warnings` (the machinery 74-03 already wired).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Distinguish external vs internal Binance transfer | Parse `info.transferType` yourself | ccxt unified `row['internal']` | ccxt already maps `transferType!=0 → internal=True` |
| Coin→USD event-time price | New price fetcher | Existing `_fetch_ohlcv_daily` + CoinGecko + `token_price_history` cache | Already handles OHLCV gaps, retries, and the stablecoin=1.0 rule |
| Flow placement onto pnl days | Custom reindex | `nav_twr._union_flow_days` (HIGH-1) | A quiet-day/boundary flow already becomes a valid zero-pnl NAV day |
| Cross-venue transfer pagination | `break on short page` loop | ccxt `params={'paginate': True}` cursor pagination | Per-venue caps differ (Binance ~1000, OKX 100, Bybit 50) |
| Status/flag propagation | New DQ enum | `NavTWRMeta` → `analytics_runner` DQF lift (74-03) + `pre_terminus_balance_unknown` | The segmentation flag channel already exists |

**Key insight:** The flow *fetch* and the flow *valuation* already have battle-tested
precedents in-repo (Deribit). The only genuinely new engineering is (a) the ccxt
event-time price resolver, and (b) the reconciliation/terminus gate.

## Runtime State Inventory

Not a rename/refactor phase — but there IS live-service state that gates correctness:

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Live service config | **Binance account roster** (which subaccounts/wallets the live keys point at — SPOT vs USDⓈ-M) is NOT in git; it lives in the exchange + the encrypted key rows | **Runtime probe / founder confirmation at plan time** (Q4) — code alone cannot prove the anchor wallet matches the flow wallet |
| Live service config | **Bybit wallet composition** (FUND / UNIFIED / CONTRACT balances) determines whether the anchor covers the pool flows land in | Verify against a live Bybit key (Q5) |
| Stored data | ccxt deposit/withdrawal history beyond a venue's retention (OKX ~90 days) is **unfetchable** — a genuine coverage gap, not a code bug | DQ-02 gate must segment, not fabricate |
| Secrets/env vars | `BROKER_DAILIES_VIA_FUNDING` kill-switch (`job_worker.py:177`) gates the whole broker-dailies path | None — flows ride the same path; inherit the switch |
| Build artifacts | None | None |

## Common Pitfalls

### Pitfall 1: Event-time valuation is NOT free from the existing code (HIGHEST RISK — Q2)
**What goes wrong:** Assuming `_fetch_transfers` or `_compute_daily_equity` already
returns an event-time USD flow value. It does not — it marks a running balance at
each replay day's close and forces stablecoins to `1.0`.
**Why it happens:** Decision-1 says "a transfer→USD valuation helper … [is] promoted"
— but no such standalone helper exists.
**How to avoid:** Build `ccxt_rows_to_dated_flows` new. Value stablecoins
(`closed_sets.STABLECOINS = {USDT,USDC,DAI,BUSD,TUSD,FDUSD,USD}`) at `1.0`; value
everything else at the same-UTC-day daily close from the OHLCV/CoinGecko/token_price_history
source; **fail loud** if the coin has no same-day price.
**Warning signs:** a BTC deposit showing up as `$X` where X == the BTC *quantity*
(valued at 1.0), or valued at today's price on a historical day.

### Pitfall 2: Bybit's `internal` field is None — the filter silently passes everything
**What goes wrong:** Copying the Binance `row['internal'] is False` filter to Bybit
lets off-chain (internal-UID) withdrawals through, inflating flows.
**How to avoid:** Bybit filter reads raw `info.withdrawType == '0'` (on-chain);
deposit-record is on-chain by nature. `[VERIFIED: bybit.parse_transaction → internal:None]`
**Warning signs:** the per-venue own-transfer fixture (mandated by SC-2) does not
redden when the filter is neutered.

### Pitfall 3: The promoted `_fetch_transfers` under-paginates OKX and Bybit
**What goes wrong:** `_fetch_transfers` calls `fetcher(None, inner_cursor, page_limit=500)`
and breaks on `len(page) < page_limit` (`equity_reconstruction.py:674,681`). OKX
caps deposit-history at **100/page** and Bybit at **50/page**, so a full page
(< 500) trips the break and **drops rows beyond the first page** inside a 90-day
window. Latent today (few allocators exceed 100 transfers/90d) but the full-history
factsheet path makes it load-bearing.
**How to avoid:** either per-venue `page_limit` (Binance ~1000, OKX 100, Bybit 50)
with a cursor-advance that does NOT break on a full-but-capped page, or hand off to
ccxt `params={'paginate': True}`. Whichever is chosen MUST NOT change the
allocator-dashboard behavior (Decision-1 constraint) — cover with a Bybit/OKX
>page-cap pagination fixture.
**Warning signs:** exactly 50 (Bybit) or 100 (OKX) flows returned for an account
known to have more.

### Pitfall 4: OKX 90-day deposit-history retention → a genuine coverage gap (Q7)
**What goes wrong:** A deposit that funded the account >90 days ago is unfetchable.
The backward roll then reconstructs an early-window NAV that is missing that capital
→ goes negative/dust → without segmentation the missing deposit is silently
attributed to performance (the LTP068 class at venue scope).
**How to avoid:** DQ-02 terminus segmentation (Q6). Reuse the existing OKX terminus
signal (`_fetch_trades_with_pagination` → `hit_terminus`, `equity_reconstruction.py:576-601`)
and the `pre_terminus_balance_unknown` flag pattern (`:1962`).
**Warning signs:** reconstructed pre-history NAV < 0 on an account with a known old
deposit; `dust_nav_guard`/`negative_nav_guard` firing on the earliest days.

### Pitfall 5: Wallet-scope mismatch — anchor reads SPOT, PnL is USDⓈ-M (Q4)
**What goes wrong:** `create_exchange` (`exchange.py:792`) sets **no** `options.defaultType`,
so Binance `fetch_balance()` (via `fetch_usdt_balance_with_status`, `:2662`) reads the
**SPOT** wallet `total.USDT`, while realized PnL/funding come from **USDⓈ-M futures**
(`fapiPrivate_get_income`, `funding_fetch.py:379`). If the anchor and PnL read
different pools, `initial_capital = anchor − Σpnl` is nonsense and flows land in the
wrong pool.
**How to avoid:** confirm — against the live roster — which wallet holds the traded
capital and ensure anchor + flows read it. This is a **live-roster** question, not a
pure-code one (see Open Questions).
**Warning signs:** a Binance account whose reconstructed base is implausible vs the
known principal.

## Code Examples

### The wiring seam (where ccxt flows attach)
```python
# services/job_worker.py:1982-2015 (the else branch; deribit sets flows at :1979)
equity, balance_error = await fetch_account_equity_usd(ctx.exchange, venue)  # ANCHOR
realized = await fetch_all_trades(ctx.exchange, since_ms=None)
if venue == "binance":
    funding = await fetch_funding_binance(ctx.exchange, funding_label, None)
# ... okx / bybit ...
# NEW (Phase 76): set external_flows here, per venue, before the combine call:
#   rows_dep = await _fetch_transfers(ctx.exchange, "deposits", since_ms, now_ms)
#   rows_wd  = await _fetch_transfers(ctx.exchange, "withdrawals", since_ms, now_ms)
#   price_index = await _resolve_event_time_prices(non_stable_ccys, days)   # I/O
#   external_flows = ccxt_rows_to_dated_flows(rows_dep + rows_wd, venue=venue,
#                                             price_index=price_index)        # PURE
returns, meta = combine_realized_and_funding(
    realized, funding, account_balance=equity, balance_error=balance_error,
    external_flows=external_flows,          # threaded straight to reconstruct_nav_and_twr
)
```
`[VERIFIED: job_worker.py:1982-2015]`

### The backward-roll identity DQ-02 is built on
```python
# services/nav_twr.py:214-217 (reconstruct_nav)
nav[n-1] = terminal                       # terminal_nav = anchor_nav - open_unrealized_usd
for t in range(n-1, 0, -1):
    nav[t-1] = nav[t] - pnl[t] - flows[t]
# ⇒ reconstructed_start (pre-history) = terminal - Σ_all_t (pnl_t + F_t)
# ⇒ NAV_today - reconstructed_start - Σpnl == Σflows  BY CONSTRUCTION when flows complete
```
`[VERIFIED: nav_twr.py:189-217]`

## Validation Architecture

> `workflow.nyquist_validation` not disabled in config → section included.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | pytest (analytics-service) |
| Coverage gate | `--cov-fail-under=80` (Python suite) `[CITED: CLAUDE.md]` |
| Quick run command | `<venv312>/bin/python -m pytest analytics-service/tests/test_external_flows.py analytics-service/tests/test_nav_twr.py -x` |
| Full suite command | `<venv312>/bin/python -m pytest analytics-service/tests -q` (baseline 3036 passed / 92 skipped, STATE.md) |
| venv | `/private/tmp/claude-501/-Users-helios-mammut-claude-projects-quantalyze/fcce1bd5-15ef-4e42-adb9-85cfc9ad484c/scratchpad/venv312/bin/python` (ccxt 4.5.59 confirmed). **Local Python 3.14 SIGSEGVs on pandas — use the 3.12 venv.** |

### Fixtures: vcrpy cassettes (OKX/Bybit) vs in-process stubs (Deribit)
- Cassettes live in `analytics-service/tests/cassettes/{okx,bybit}/*.yaml`; the singleton
  harness is `tests/conftest_vcr.py` (`record_mode='once'`, PII/signature filters for
  bybit `x-bapi-*`, okx `ok-access-*`, binance query-param signing). `[VERIFIED: ls + conftest_vcr.py]`
- P75 Deribit flows used **in-process synthetic stubs** (`tests/fixtures/deribit_flow_fixtures.py`),
  NOT cassettes. For Phase 76 the per-venue own-transfer fixture (SC-2) can be a
  **hand-built row list** fed to the PURE `ccxt_rows_to_dated_flows` (no network) — this
  is the cleanest revert-proof proof and mirrors the P75 fixture discipline. Reserve
  vcr cassettes for the I/O `_fetch_transfers` pagination proof (Pitfall 3).

### Phase Requirements → Test Map
| Req | Behavior | Test Type | Command | Exists? |
|-----|----------|-----------|---------|---------|
| FLOW-03 | Binance: `internal==False` deposit becomes `F_t`; internal (`transferType==1`) excluded | unit (pure) | `pytest tests/test_external_flows.py -k binance_own_transfer -x` | ❌ Wave 0 |
| FLOW-03 | Bybit: on-chain (`info.withdrawType=='0'`) only; off-chain/internal excluded | unit (pure) | `pytest -k bybit_own_transfer -x` | ❌ Wave 0 |
| FLOW-03 | OKX: deposit/withdrawal-history counted; asset-transfer never appears | unit (pure) | `pytest -k okx_own_transfer -x` | ❌ Wave 0 |
| FLOW-03 | Event-time: BTC deposit valued at same-UTC-day close, NOT 1.0/current; fail-loud if no price | unit (pure) | `pytest -k event_time_valuation -x` | ❌ Wave 0 (mutation-honest: reddens under 1.0 / cross-day price) |
| FLOW-03 | `_fetch_transfers` promotion: allocator-dashboard equity path byte-identical | integration | `pytest tests/test_equity_reconstruction*.py -x` | ✅ (existing — must stay green) |
| FLOW-03 | Bybit/OKX >page-cap pagination returns all rows | integration (vcr) | `pytest tests/test_exchange_pagination.py -k transfers -x` | ❌ Wave 0 |
| DQ-02 | Identity residual ≈ 0 by construction; mutation-reddens under a dropped flow | unit (pure) | `pytest tests/test_nav_twr.py -k reconcile -x` | ❌ Wave 0 |
| DQ-02 | Deposit outside OKX retention → segment at terminus, `complete_with_warnings`, no fabricated pre-terminus TWR | unit + integration | `pytest -k terminus_segmentation -x` | ❌ Wave 0 |
| DQ-02 | Transient fetch failure ≠ end-of-history (does NOT segment; stays retryable) | unit | `pytest -k transient_not_terminal -x` | ❌ Wave 0 |

### Reconciliation-gate design (DQ-02) — the three proofs
1. **Identity residual (construction sanity):**
   `residual = (anchor_nav − open_unrealized_usd) − reconstructed_start − Σpnl − Σflows`.
   By the backward roll this is ~0 when flows are complete → the check is a
   **mutation detector** (a dropped/mis-valued flow makes it non-zero).
   **Recommended tolerance:** `abs(residual) <= max(1.00, 1e-6 * abs(terminal_nav))`
   (absolute cent-floor + relative; consistent with DUST_NAV_FLOOR=$1000 scale).
   Lives as a **pure** function in `nav_twr.py` (I/O-free, numpy finite-checked).
2. **Coverage / terminus segmentation (the real gap detector):** a missing old
   deposit (OKX retention) drives the early reconstructed NAV ≤ 0 → the existing
   DQ-01 `negative_nav_guard`/`dust_nav_guard` already fire per-day. DQ-02 adds a
   **window-level** decision: when the flow-retention window < the pnl window
   (`hit_terminus`-style signal), segment at the last trustworthy day, refuse
   pre-terminus TWR, and raise a `flow_coverage_incomplete` (or reuse
   `pre_terminus_balance_unknown`) flag → `complete_with_warnings`. Reuse the OKX
   terminus mechanism at `equity_reconstruction.py:576-601` and the flag-stamp
   pattern at `:1947-1962`.
3. **Transient vs terminal (WR-04):** a flow fetch that raises a network/auth error
   MUST bubble (it already does — `_fetch_transfers` deliberately catches only
   `ccxt.NotSupported` and lets everything else propagate, `:665-676`) and fail the
   job **transient-retryable**; only a clean empty result at the retention boundary
   triggers segmentation. Mirror `fetch_usdt_balance_with_status`'s
   `(None,False)`=no-data vs `(None,True)`=error distinction (`exchange.py:2642-2687`).

### Sampling Rate
- **Per task commit:** the two pure suites (`test_external_flows.py`, `test_nav_twr.py`).
- **Per wave merge:** full analytics suite in venv312 (baseline 3036/92).
- **Phase gate:** full suite green + the promotion no-behavior-change integration
  (`test_equity_reconstruction*.py`) green before `/gsd:verify-work`.

### Wave 0 Gaps
- [ ] `tests/test_external_flows.py` — extend with the three per-venue own-transfer
      fixtures + the event-time valuation proof (pure, hand-built rows).
- [ ] `tests/test_nav_twr.py` — reconciliation residual + terminus-segmentation +
      transient-vs-terminal.
- [ ] `tests/test_exchange_pagination.py` — Bybit/OKX >page-cap transfer pagination
      (vcr cassette or synthetic paged fetcher).
- [ ] New pure module (e.g. `services/ccxt_flows.py` or an addition to a pure home)
      for `ccxt_rows_to_dated_flows` — keep `external_flows.py` stdlib-only pure.

## Security Domain

> `security_enforcement` absent → enabled. This phase handles read-only exchange
> API keys and signed requests.

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V5 Input Validation | yes | Untrusted ccxt row fields (`amount`/`currency`/`timestamp`/`transferType`/`withdrawType`) → fail-loud coercion (`nav_twr._coerce_float`, `deribit_txn._coerce_float`); NEVER coalesce a missing balance-delta to 0 |
| V6 Cryptography | yes (indirect) | Never log signed-request errors raw — `scrub_freeform_string` strips HMAC/`&signature=` (already used at `exchange.py:2670`, `job_worker.py:1857`) |
| V7 Error Handling / Logging | yes | vcr cassettes filter `x-bapi-*`/`ok-access-*`/binance query signing (`conftest_vcr.py`); no raw NAV/flow USD in logs (account-size leak T-73-02, `nav_twr.py:21`) |

### Known Threat Patterns
| Pattern | STRIDE | Mitigation |
|---------|--------|-----------|
| HMAC signature leak in a ccxt error string → Sentry/stdout | Information Disclosure | `scrub_freeform_string` before every `logger.warning` on an exchange exception |
| Schema-drifted flow row silently coalesced to 0 → dropped capital → mis-anchored TWR | Tampering (data integrity) | Fail loud on missing/blank `amount` (mirror P75 `_MISSING` guard, `deribit_txn.py:629-650`) |
| Cassette records a real signature in a 200/429 body | Information Disclosure | `before_record_response` deep-redact (`conftest_vcr.py`) |

## State of the Art

| Old Approach | Current Approach | When | Impact |
|--------------|------------------|------|--------|
| Broker dailies ignore flows ("Read-only keys cannot enumerate deposits/withdrawals … we do NOT depend on flow data", `broker_dailies.py:34-36`) | ccxt venues DO enumerate deposits/withdrawals; flows now correct the TWR numerator | Phase 76 | The docstring premise is now **partially obsolete** — update it; mid-window flows are no longer an "accepted, flagged limitation" for ccxt venues |
| Anchor-to-today silently over/under-states flow-heavy accounts | Backward daily-NAV + chain-linked TWR with dated flows | v1.8 (P73-76) | The whole milestone |

**Deprecated/outdated:**
- `deribit_linear_external_flow_usd` (net scalar) — superseded by
  `deribit_dated_external_flows_usd`; removal deferred to milestone cleanup.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Binance `fetch_balance()` (no `defaultType` set) reads the SPOT wallet, so the anchor may not match USDⓈ-M PnL | Pitfall 5 / Q4 | If the live keys point at a futures-scoped read, the anchor is already correct and no fix is needed; if not, base is wrong. **Must be confirmed against the live roster.** `[ASSUMED from ccxt default + no defaultType at exchange.py:792]` |
| A2 | Bybit off-chain withdrawal (`withdrawType==1`) can be an own-transfer to the founder's other Bybit UID and should be excluded per the locked decision | Q5 / Pitfall 2 | If some off-chain withdrawals are genuine external cash-out to third parties, excluding them under-counts a real outflow. Locked decision says exclude; confirm intent. `[ASSUMED]` |
| A3 | OKX deposit-history retention is ~90 days (mirrors the trade-history 3-month terminus already coded) | Q7 / Pitfall 4 | If OKX retains deposit-history longer, the segmentation triggers less often (safe direction). `[ASSUMED — verify against OKX docs / live probe]` |
| A4 | Event-time price = same-UTC-day daily close (not intra-day tick) is "event-time enough," matching P75's same-day settlement-index convention | Q2 | Intra-day volatility on a large deposit day could shift the valued USD; same-day close is the established D-07 convention. `[ASSUMED — consistent with P75]` |

## Open Questions

1. **[LIVE — Binance wallet scope] Which Binance wallet holds the traded capital, and does the anchor read it?** (Q4, A1)
   - What we know: `create_exchange` sets no `defaultType` (`exchange.py:792`); `fetch_usdt_balance_with_status` reads `fetch_balance().total.USDT` (`:2662-2674`); funding = `fapiPrivate_get_income` (USDⓈ-M). Code strongly suggests anchor=SPOT, PnL=USDⓈ-M.
   - What's unclear: the LIVE roster — do the production Binance keys trade on USDⓈ-M with margin in the futures wallet (anchor undercounts) or is capital held in SPOT? Not determinable from code alone.
   - Recommendation: **runtime probe or founder confirmation at plan time.** If futures-scoped, the plan must set `options['defaultType']='future'` (or read the futures wallet) so anchor + flows + PnL share one pool. Flag as a `checkpoint:human-verify` in the plan.

2. **[LIVE — Bybit anchor pool] Does the Bybit anchor cover FUND+UNIFIED+CONTRACT, and does a FUND→UNIFIED own-transfer inflate it?** (Q5)
   - What we know: `fetch_usdt_balance_with_status` reads `total.USDT` from a single `fetch_balance()`; ccxt bybit unified defaults to the UNIFIED account. FUND↔UNIFIED moves are internal-transfer records (NOT in deposit/withdraw-record), so flows already exclude them.
   - What's unclear: whether real principal sits in FUND (uncovered by a UNIFIED-only anchor) on the live keys.
   - Recommendation: verify against a live Bybit key; if capital spans wallets, net/combine the anchor. `checkpoint:human-verify`.

3. **[RESOLVED — with a design choice for the planner] DQ-02 reconciliation target semantics.**
   - The identity `NAV_today − reconstructed_start − Σpnl == Σflows` holds **by construction** in the backward roll, so a non-zero residual only appears under a dropped/mis-valued flow (mutation detector), NOT under a *retention gap* (a retention gap instead drives the early NAV ≤ 0 and trips DQ-01, then the terminus segmentation). Recommendation: implement BOTH — the residual as a construction-sanity assertion (tolerance `max($1, 1e-6·|anchor|)`) AND the terminus segmentation as the real coverage gate. Documented in Validation Architecture.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| ccxt | flow fetch (all 3 venues) | ✓ | 4.5.59 (venv312) | — |
| pandas / numpy | NAV/TWR core | ✓ | 2.2.3 / 2.4.6 | — |
| vcrpy | OKX/Bybit cassette replay | ✓ | 8.1.1 `[CITED: conftest_vcr.py]` | in-process synthetic rows (pure tests) |
| CI-3.12 venv | run the suite (local 3.14 SIGSEGVs) | ✓ | venv312 path above | none — do NOT run under local 3.14 |
| Live exchange keys | Q4/Q5 wallet-scope confirmation | ✗ (not in this env) | — | founder confirmation / Railway one-off probe |

**Missing with no fallback:** live-roster wallet-scope confirmation (Q4/Q5) — requires
a runtime probe or founder answer; blocks *certainty* on the anchor pool, not the
adapter code itself.

## Sources

### Primary (HIGH confidence)
- ccxt 4.5.59 source, introspected in venv312: `binance/bybit/okx.fetch_deposits`,
  `fetch_withdrawals`, `parse_transaction`, `has[...]` flags (2026-07-06).
- In-repo file:line: `equity_reconstruction.py` (`_fetch_transfers`:642, consumers
  :1739-1744, terminus :576-601/:1947-1962, valuation :1205-1243/:978-994),
  `nav_twr.py` (:111-361), `external_flows.py` (:1-77), `deribit_txn.py`
  (:581-670), `deribit_ingest.py` (:682), `broker_dailies.py` (:119-149),
  `job_worker.py` (:1828-2015), `exchange.py` (:792-819/:2616-2745),
  `funding_fetch.py` (:347-379), `closed_sets.py` (:85-100), `conftest_vcr.py`.
- CONTEXT.md, REQUIREMENTS.md (FLOW-03/DQ-02), STATE.md (74-03, 75-02, HIGH-1).

### Secondary (MEDIUM confidence)
- ccxt docstring endpoint URLs (Binance capital deposit/withdraw history; Bybit v5
  deposit/withdraw-record; OKX funding deposit/withdrawal-history) — from the
  introspected source docstrings.

### Tertiary (LOW confidence — flagged)
- OKX deposit-history 90-day retention exact window (A3) — inferred from the coded
  trade-history 3-month terminus; verify against OKX docs or a live probe.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new deps; versions introspected in the exact CI venv.
- ccxt own-transfer semantics (Q3): HIGH — introspected `parse_transaction` per venue.
- Event-time valuation gap (Q2): HIGH — confirmed no helper exists; source is available.
- Wallet scope (Q4/Q5): MEDIUM — code-mapped; final answer needs the live roster.
- Reconciliation/terminus (Q6): HIGH on mechanism (existing terminus precedent);
  MEDIUM on exact tolerance (recommended, tune at Phase 78).
- OKX retention window (Q7): LOW-MEDIUM — verify the exact day count.

**Research date:** 2026-07-06
**Valid until:** 2026-08-05 (stable; re-verify if ccxt is bumped past 4.5.59)
