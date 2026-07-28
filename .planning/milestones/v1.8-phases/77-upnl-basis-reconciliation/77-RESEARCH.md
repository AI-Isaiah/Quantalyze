# Phase 77: uPnL Basis Reconciliation — Research

**Researched:** 2026-07-06
**Domain:** Per-venue open-unrealized-PnL reads (ccxt 4.5.59) + realized-vs-mark-to-market basis wedge in the v1.8 NAV/TWR core
**Confidence:** HIGH (per-venue anchor MTM-ness verified against installed ccxt source + repo code; historical-mark negative verdict HIGH)

## Summary

The v1.8 core already holds the exact seam this phase fills: `nav_twr.reconstruct_nav_and_twr(..., open_unrealized_usd=0.0)` computes `terminal_nav = anchor_nav − open_unrealized_usd` BEFORE the backward roll (`nav_twr.py:507-509`), so the ENTIRE reconstructed NAV series is realized-basis and uPnL is never injected into any intra-window day. Phase 77 supplies a real per-venue `open_unrealized_usd`, a `unrealized_pnl_in_anchor` materiality flag, and confirms the historical-mark retrievability verdict.

The single most important — and non-obvious — finding: **the uPnL wedge is venue-specific because ccxt maps each venue's balance to a DIFFERENT field, some mark-to-market and some realized-basis.** Verified against ccxt 4.5.59 in the CI-3.12 venv:

| Venue | Anchor field (as coded) | Includes uPnL? | Wedge to subtract |
|-------|-------------------------|----------------|-------------------|
| **OKX** | raw `totalEq` (`exchange.py:2717`) | **YES** (MTM) | `data[0].upl` — subtract |
| **Deribit** | per-ccy `equity` (`deribit_txn.py:278`) | **YES** (incl session uPnL) | session uPnL — subtract |
| **Bybit** | coin `walletBalance` (ccxt `bybit.py:3376`) | **NO** (realized) | **0 — do NOT subtract** |
| **Binance** | spot `walletBalance` (defaultType=`spot`) | **NO** (realized) | **0 — do NOT subtract** |

Blindly subtracting a raw position-uPnL for all venues would DOUBLE-COUNT on Bybit and Binance (removing uPnL that was never in the anchor), driving the terminal too low and INFLATING the realized-basis return — the exact harm class v1.8 exists to kill. The companion read must return *the uPnL embedded in the specific anchor field*, which is 0 for the walletBalance venues.

**Primary recommendation:** Read the venue-matched uPnL alongside the existing anchor (OKX: reuse `data[0].upl` from the call `fetch_okx_total_equity_usd` already makes — NO new fetch; Deribit: read the session-uPnL field from the `get_account_summaries` response already fetched — NO new fetch; Bybit/Binance: wedge is structurally 0, so `open_unrealized_usd=0.0` — no read needed for the roll). Subtract ONLY the MTM-venue wedge from the roll terminal (already the code path). Raise `unrealized_pnl_in_anchor` (→ `complete_with_warnings`) when `|open_unrealized_usd|/anchor_equity > 0.05`. Per-day true-up is DEFERRED — historical open-position marks are NOT retrievable on read-only keys on any of the four venues; the realized-basis-intraday / MTM-at-endpoint invariant STANDS, documented in the core docstring + flagged.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Current open-uPnL read (per venue) | API/Backend — `services/exchange.py` (+ `deribit_ingest.py`) | ccxt/exchange | Companion to the equity anchor; venue-matched field |
| Realized-basis terminal (`anchor − uPnL`) | Pure core — `services/nav_twr.py` | — | Already wired at `:507-509`; I/O-free |
| Materiality flag | Pure core `NavTWRMeta` → DQ bridge | `job_worker.py` pre-stamp + `analytics_runner.py` promotion | Reuses P73-76 DQ-flag channel |
| Wedge wiring into the roll | `job_worker.py` derive path | `broker_dailies.combine_realized_and_funding` | Thread `open_unrealized_usd` at the same seam as `external_flows` |
| Displayed current NAV (MTM) | stored `account_balance_usdt` scalar | frontend (UNTOUCHED) | Keep the full MTM anchor; only the roll terminal subtracts uPnL |

## User Constraints (from CONTEXT.md)

### Locked Decisions
1. **Companion uPnL read** — `exchange.py` gains an open-uPnL read alongside the equity anchor, per venue.
2. **Realized-basis terminal (already wired):** the core holds `terminal_nav = anchor_nav − open_unrealized_usd` for the backward roll (param exists, defaults 0.0) so the roll and the daily increments share ONE realized basis. uPnL is re-added ONLY to the reported CURRENT NAV — NO silent MTM/realized blend. A large-open-position account reconstructs with NO step discontinuity at the anchor day.
3. **Materiality flag:** raise `unrealized_pnl_in_anchor` (`complete_with_warnings`) when `|open_unrealized_usd| / anchor_equity` exceeds the materiality threshold. Reuse the existing DQ-flag machinery (P73-76 pattern), not a parallel status.
4. **Historical-mark availability — research resolves per venue.** A per-day uPnL true-up lands ONLY if historical open-position marks are retrievable on READ-ONLY keys; otherwise the realized-basis-intraday / MTM-at-endpoint invariant STANDS, documented + flagged. Do NOT fabricate historical marks.

### Claude's Discretion
- Per-venue uPnL read endpoint/field choice (research confirms).
- Materiality threshold value (pick a defensible default; flag, don't fail-hard, on breach).

### Deferred Ideas (OUT OF SCOPE)
- Golden parity + P72 LTP068 acceptance + wallet-scope wrong-anchor detection + founder confirmation — **Phase 78 (HARD GATE)**.
- Per-day historical uPnL true-up — only if research proves marks retrievable (research says NO → explicitly deferred).
- Dead `deribit_linear_external_flow_usd` removal — milestone cleanup.

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| FLOW-04 | uPnL basis reconciliation — `exchange.py` companion open-uPnL read; core holds a realized-basis terminal for the backward roll and re-adds uPnL only to the reported *current* NAV; `unrealized_pnl_in_anchor` DQ flag when the wedge is material. Per-day true-up only if historical marks prove retrievable on read-only keys. | Per-venue uPnL field map (Q1/Q2 verified); historical-mark verdict = NOT retrievable → true-up deferred (Q3); `open_unrealized_usd` seam already exists at `nav_twr.py:507-509`; DQ bridge from P73-76 (`NavTWRMeta` + `_BROKER_WARN_FLAGS` at `job_worker.py:2378`). |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| ccxt | 4.5.59 | Per-venue balance/positions reads | Already pinned; [VERIFIED: CI-3.12 venv `import ccxt; ccxt.__version__` == 4.5.59] |
| pandas | 2.2.3 | NAV/return Series math | Already in the pure core |
| numpy | 2.4.6 | Fail-loud finite coercion | Already in the pure core |

**No new dependencies.** This phase reads one additional field from calls the worker already makes and threads one float through an existing param. [VERIFIED: repo `requirements.txt:26` ccxt==4.5.59; `nav_twr.py` imports numpy/pandas only]

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Reading uPnL from the already-fetched anchor response (OKX `upl`, Deribit summary) | A separate `fetch_positions()` sum | Extra round-trip + must reconcile position uPnL against the anchor's wallet scope (Binance SPOT-vs-USDⓈ-M) — strictly worse; only needed where the anchor field itself carries no uPnL (Bybit/Binance, where the wedge is 0 anyway). |

**Installation:** none — no packages added.

## Package Legitimacy Audit

> This phase installs NO external packages. No slopcheck run required.

| Package | Registry | Disposition |
|---------|----------|-------------|
| (none) | — | No new dependencies — reuses ccxt 4.5.59 / pandas 2.2.3 / numpy 2.4.6 already pinned |

## Per-Venue uPnL Read — Verified Findings (Q1 + Q2)

### OKX — anchor IS MTM; wedge = `upl` (NO new fetch)
`fetch_okx_total_equity_usd` (`exchange.py:2690-2724`) calls `private_get_account_balance()` and reads `data[0].totalEq`. The SAME response object carries `data[0].upl` — OKX's total account unrealized PnL in USD (per-currency `details[].upl` also available). [CITED: OKX `/api/v5/account/balance` schema — `totalEq`, `upl` are documented sibling fields]
- **`totalEq` includes open-position uPnL** — stated in the function docstring (`exchange.py:2691-2693`, "total equity … incl. open-position unrealized PnL") and in `equity_reconstruction.py:1952-1953` ("totalEq already includes open-position unrealized PnL"). [VERIFIED: repo code + docstring]
- **Wedge = `upl`.** `open_unrealized_usd = float(data[0]["upl"])`. Implementation: extend `fetch_okx_total_equity_usd` (or a sibling) to return `(totalEq, upl)`; no extra call.

### Deribit — anchor IS MTM; wedge = session uPnL (NO new fetch)
`fetch_deribit_account_equity_usd` (`deribit_ingest.py:706-761`) calls `private_get_get_account_summaries({})` and `deribit_equity_to_usd` sums per-currency `summ.get("equity")` (`deribit_txn.py:278`). **Deribit `equity` includes unrealized session PnL** (Deribit account-summary `equity = balance + session_upl + session_rpl`). [CITED: Deribit `private/get_account_summary` — `equity`, `session_upl`, `total_pl` fields] The same `summaries` response carries the session-uPnL component per currency; the wedge is that component, USD-converted with the SAME `index_prices` already resolved for the anchor.
- **Field name for the uPnL component needs live confirmation** — Deribit exposes `session_upl` and/or `total_pl`; the exact field to treat as "open unrealized" on `get_account_summaries` should be confirmed against a live read (tagged `[ASSUMED]`, see Assumptions Log A1). The safe fallback if unconfirmed: treat Deribit wedge as 0 (realized-basis terminal on `equity` is then slightly conservative) and flag — never fabricate.

### Bybit — anchor is REALIZED-basis; wedge = 0 (do NOT subtract)
`fetch_account_equity_usd(venue="bybit")` → `fetch_usdt_balance_with_status` → `exchange.fetch_balance()["total"]["USDT"]`. ccxt 4.5.59 `bybit.parse_balance` sets the coin total from **`walletBalance`**, NOT `equity`:
```python
# ccxt/bybit.py:3376  (UNIFIED / CONTRACT / SPOT branch)
account['total'] = self.safe_string(coinEntry, 'walletBalance')
```
[VERIFIED: `inspect.getsource(ccxt.bybit.parse_balance)` in CI-3.12 venv] `walletBalance` is the settled cash balance and **EXCLUDES** uPnL (Bybit `equity = walletBalance + unrealisedPnl`; ccxt does NOT use the per-coin `equity` field nor the account-level `totalEquity`). defaultType=`swap` [VERIFIED]. → Bybit anchor is already realized-basis → **`open_unrealized_usd = 0.0`**. Subtracting a real position uPnL here would double-count.
- Current uPnL for the display re-add (if ever surfaced) is available via `fetch_positions()` summed `unrealisedPnl` or per-coin `unrealisedPnl` — a NEW call, NOT needed for the roll.

### Binance — anchor is REALIZED-basis (as coded); wedge = 0
`create_exchange("binance")` sets NO `defaultType` → ccxt default **`spot`** [VERIFIED: `ccxt.binance().options["defaultType"] == "spot"`]. `fetch_balance()["total"]["USDT"]` therefore reads the SPOT wallet (walletBalance, no uPnL, no futures marking). → **`open_unrealized_usd = 0.0`** under the anchor as currently coded.
- NOTE (Phase 78 scope): the Binance SPOT-vs-USDⓈ-M wallet-scope question (does the anchor read the wallet the perps actually trade in?) is a SEPARATE, already-tracked concern (FLOW-03 / STATE blocker; Phase 76-05 / 78). If a future change points the Binance anchor at USDⓈ-M `marginBalance`, that field DOES include uPnL (ccxt `binance.parse_balance_custom:96` `safe_string_2(balance,'marginBalance','balance')`) and the wedge would then be `marginBalance − balance = unrealizedProfit`. Phase 77 does NOT change wallet scope; it takes the anchor as given and computes the wedge for the field actually returned (0 for spot). Document this coupling so Phase 78 revisits the wedge if it re-scopes the anchor.

## Historical Open-Position Marks on Read-Only Keys (Q3) — VERDICT

**Per-venue verdict: NOT retrievable on read-only keys. Per-day uPnL true-up is DEFERRED.** [Confidence: HIGH]

| Venue | Historical daily uPnL / position mark on a read-only key? | Basis |
|-------|-----------------------------------------------------------|-------|
| OKX | NO — `account/balance` (`upl`) is a CURRENT snapshot only; no historical-equity/mark endpoint | ccxt `has` exposes no historical-uPnL method; OKX bills give realized cash, not marks |
| Binance | NO — `fapi` account/positions return current uPnL only; income history is REALIZED | ccxt `fetchLedger`/positions = current or realized |
| Bybit | NO — position `unrealisedPnl` is current-snapshot; closed-PnL history is realized | Bybit closed-PnL endpoint = realized |
| Deribit | NO — `get_account_summaries` is a live snapshot; txn-log `change` is realized settlement cash | `deribit_txn` uses `change` (realized), STATE note |

None of the four venues expose a read-only endpoint that returns a per-day historical *mark* of open positions. What IS available historically everywhere is REALIZED cash (bills / income / txn-log `change`) — which is already the daily-pnl stream. ccxt 4.5.59 has no `fetchPositionsHistory`-with-uPnL capability that yields per-day marks [VERIFIED: `has` flags checked — no historical-uPnL method]. This upgrades the STATE "MEDIUM confidence" note to a HIGH-confidence negative for the true-up.

**Consequence for the plan:** implement the FLAG-ONLY path (terminal wedge + materiality flag). Do NOT attempt a per-day true-up. Document in `reconstruct_nav_and_twr`'s docstring: *"Intra-window NAV is realized-basis; uPnL is reconciled only at the terminal (endpoint), because historical open-position marks are not retrievable on read-only keys. A material terminal wedge is surfaced via `unrealized_pnl_in_anchor`, never spread across history (that would fabricate marks)."*

## The Current-NAV Re-add (Q4) — Traced

The chain-linked return SERIES (`csv_daily_returns` → `run_csv_strategy_analytics` → `compute_all_metrics`) is realized-basis **end-to-end by construction**: `open_unrealized_usd` is subtracted from `terminal_nav` BEFORE the backward roll (`nav_twr.py:507-511`), so every reconstructed intra-window NAV — including day n-1 → day n — excludes uPnL. **There is NO point at which uPnL enters the series, so there is no step discontinuity at the anchor day.** The re-add is NOT an operation on the series.

The "reported CURRENT NAV" is a SEPARATE scalar. The MTM equity read (`equity` from `fetch_account_equity_usd`) is what a displayed current-AUM figure should show. The correct "re-add" is therefore *definitional, not procedural*: **keep the stored/displayed current-equity value at the FULL MTM anchor (`equity`); apply the wedge subtraction ONLY to the roll terminal fed into `reconstruct_nav_and_twr`.** The two already diverge correctly if the plan passes `open_unrealized_usd` to the core WITHOUT mutating the stored `equity`.

- REQUIREMENTS explicitly scopes frontend/factsheet UI as UNTOUCHED ("Presentation is untouched; this is an analytics-service return-math correction"). So Q4 requires NO series write and NO UI change — only the discipline that the wedge never leaks into `csv_daily_returns` (a guarded/adjusted day is already handled by the 74-04 NaN-skip policy at `job_worker.py:2304-2327`).
- **Open (LIVE) sub-question:** whether any stored current-equity scalar (`api_keys.account_balance_usdt`, written on the sync_trades path at `job_worker.py:1442`) needs to remain MTM vs be recomputed. The derive_broker_dailies path does NOT write `account_balance_usdt`; it writes only `csv_daily_returns`. So under the current wiring the re-add is a no-op for the series and the displayed AUM keeps its existing MTM source. The planner should confirm no derive-path code subtracts the wedge from a stored equity scalar.

## Materiality Threshold (Q5)

**Default: `|open_unrealized_usd| / anchor_equity > 0.05` (5%) → raise `unrealized_pnl_in_anchor` → `complete_with_warnings`.** [Confidence: MEDIUM — defensible default, tune at Phase 78 like FLOW_DOM_RATIO]

Rationale:
- Warning-only (never fail-hard): the reported return stays realized-basis-honest regardless; the flag surfaces that intra-window NAV excludes uPnL drift. A false positive costs nothing.
- 5% is the smallest wedge that would visibly move the terminal relative to a typical daily return; below it the realized-basis approximation is immaterial. Sits above measurement noise, below the account-scale guards (`DUST_NAV_FLOOR=1000`, `FLOW_DOM_RATIO=1.0`).
- Guard against divide-by-zero / dust base: only evaluate the ratio when `anchor_equity > DUST_NAV_FLOOR` and `balance_error is False`; on a heuristic/failed anchor the wedge is meaningless — do NOT flag on noise, and do NOT subtract a wedge onto a heuristic base.

**Flag placement (reuse the P73-76 bridge, no parallel status):**
1. Add `unrealized_pnl_in_anchor: bool` to `NavTWRMeta` (`nav_twr.py:90`, `total=False`) and set it in `_build_nav_meta` (`nav_twr.py:334`) when the ratio breaches. Because the core is I/O-free, pass the already-computed ratio breach in (or compute it in the core from `open_unrealized_usd` + `anchor_nav`, both already available at `:507-509`). Computing it IN the core is cleanest — the core owns the wedge.
2. Lift it into `DataQualityFlags` TypedDict + the `analytics_runner.py` promotion predicate (`~:1775-1788`, alongside `negative_nav_guard`/`dust_nav_guard`/`flow_dominated_guard`/`flow_coverage_incomplete`).
3. Pre-stamp it in `derive_broker_dailies` `_BROKER_WARN_FLAGS` (`job_worker.py:2378`) so the broker→CSV bridge (MED-2/MED-3 from P76) carries it to the factsheet and a healed account clears it.

## Common Pitfalls (Q6)

### Pitfall 1: Double-counting uPnL as a flow or a pnl row
**What goes wrong:** uPnL fed into `external_flows` or into a `daily_pnl` record corrupts a specific return day's numerator.
**Why:** uPnL is NEITHER a flow (not external cash) NOR realized pnl (not settled). It is a TERMINAL-only scalar.
**How to avoid:** pass it ONLY as `open_unrealized_usd`; never append it to `external_flows`/`realized`. The seam at `nav_twr.py:507-509` is the sole injection point.
**Warning sign:** a single day's return spikes; `reconcile_flow_residual` stays clean (it sums the same corrupted inputs).

### Pitfall 2: Subtracting a wedge on a walletBalance venue (the big one)
**What goes wrong:** reading raw position uPnL and subtracting it for Bybit/Binance removes uPnL that was NEVER in the anchor (walletBalance) → terminal too low → realized-basis return INFLATED.
**Why:** ccxt maps Bybit/Binance-spot balance to `walletBalance` (realized), OKX/Deribit to MTM `totalEq`/`equity`.
**How to avoid:** the companion read returns *the uPnL embedded in the anchor field* — structurally 0 for Bybit and Binance-spot. Gate the wedge by venue, matching the anchor field. `open_unrealized_usd` defaults 0.0 → the safe default is "no subtraction."
**Warning sign:** Bybit/Binance flow-less accounts MOVE at the Phase 78 parity gate (they must NOT).

### Pitfall 3: Step discontinuity at the anchor day
**What goes wrong:** injecting uPnL into the last intra-window NAV instead of subtracting from the terminal creates a jump at day n.
**How to avoid:** subtract-before-roll (already the code path). The whole series is realized-basis; verify no code adds uPnL to `nav.iloc[-1]` post-roll.

### Pitfall 4: Sign of uPnL
**What goes wrong:** a flipped sign shifts every return the wrong way.
**Why:** uPnL positive (positions in profit) → anchor MTM > realized basis → `terminal = anchor − (+uPnL)` is LOWER. A loss uPnL is negative → terminal HIGHER.
**How to avoid:** trust the field's sign verbatim (OKX `upl`, Deribit `session_upl`), coerce via the core's fail-loud `_coerce_float`; a non-finite uPnL fails loud, never a silent NaN terminal.

### Pitfall 5: Wedge onto a heuristic/failed anchor
**What goes wrong:** subtracting a stale uPnL when `balance_error is True` (anchor read failed → heuristic capital) compounds the base error.
**How to avoid:** when `balance_error` or `anchor_equity <= DUST_NAV_FLOOR`, force `open_unrealized_usd = 0.0` and do not flag materiality on noise.

### Pitfall 6 (non-issue, confirm): reconcile_flow_residual interaction
The DQ-02 construction self-check (`nav_twr.py:361-418`) sums `terminal − reconstructed_start − Σpnl − Σflows`, with `reconstructed_start` derived from the SAME rolled `nav`. A terminal shifted by `open_unrealized_usd` shifts `reconstructed_start` identically → residual stays ~0 by construction → **no spurious breach**. [VERIFIED: the wedge subtraction is on `terminal_nav` at `:507-509`, upstream of `reconcile_flow_residual` at `:524` — already correctly ordered.]

## Runtime State Inventory

> Not a rename/migration phase — this is a data-read + math phase. No stored strings to rename.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — `csv_daily_returns` gets only interpretable realized-basis returns (uPnL never written). Verified: derive path writes only the returns Series (`job_worker.py:2304-2340`). | none |
| Live service config | None | none |
| OS-registered state | None | none |
| Secrets/env vars | None — no new env var (materiality threshold is a module constant like `FLOW_DOM_RATIO`) | none |
| Build artifacts | None | none |

## Code Examples

### Existing seam Phase 77 fills (do NOT re-plumb — supply the value)
```python
# Source: services/nav_twr.py:507-511 (VERIFIED in repo)
terminal_nav = _coerce_float(
    anchor_nav, field="anchor_nav", row={}
) - _coerce_float(open_unrealized_usd, field="open_unrealized_usd", row={})
nav = reconstruct_nav(daily_pnl, terminal_nav, flows_by_day)
```

### OKX — reuse the already-fetched response (NO new call)
```python
# Source pattern: services/exchange.py:2704-2724 (VERIFIED)
raw = await exchange.private_get_account_balance()
data = (raw or {}).get("data") or []
row0 = data[0] if data and isinstance(data[0], dict) else {}
total_eq = row0.get("totalEq")   # MTM anchor (already read)
upl      = row0.get("upl")       # <-- companion wedge, same response
# open_unrealized_usd = float(upl)  -> subtract for OKX
```

### Venue-gated wedge (the correct default = 0)
```python
# Bybit walletBalance / Binance spot -> anchor excludes uPnL -> wedge is 0.
# OKX totalEq / Deribit equity -> anchor includes uPnL -> wedge = read value.
open_unrealized_usd = 0.0
if venue == "okx":
    open_unrealized_usd = float(upl or 0.0)
elif venue == "deribit":
    open_unrealized_usd = deribit_session_upl_usd  # confirm field (A1)
# bybit / binance: leave 0.0  (subtracting would double-count — Pitfall 2)
```

## State of the Art

| Old Approach | Current Approach | Impact |
|--------------|------------------|--------|
| Anchor-to-today MTM equity as the base, realized-only daily pnl → silent MTM/realized blend | Realized-basis terminal (`anchor − uPnL`) for the roll; uPnL reconciled at the endpoint + flagged | Removes the last silent basis blend in v1.8 |
| Assume uPnL retrievable historically for a per-day true-up | Confirmed NOT retrievable on read-only keys (all 4 venues) → flag-only | Locks scope to the smallest correct change |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Deribit "open unrealized" is exposed on `get_account_summaries` as `session_upl` (or `total_pl`'s unrealized component) | Per-Venue Read — Deribit | If the field name differs, the Deribit wedge is mis-read. Mitigation: fall back to wedge=0 (realized-basis terminal on `equity`, conservative) + flag, never fabricate. Confirm on a live LTP read at plan/execute time. |
| A2 | 5% is a defensible materiality default | Materiality Threshold | Too-low → over-flags (harmless, warning-only); too-high → misses a material wedge. Tuned at Phase 78 against real accounts, like FLOW_DOM_RATIO. |
| A3 | Binance anchor stays spot-scoped in Phase 77 (wedge 0) | Per-Venue Read — Binance | If Phase 78 re-scopes Binance to USDⓈ-M `marginBalance`, the wedge becomes `unrealizedProfit` and must be added there. Documented coupling; Phase 77 does not change scope. |

## Open Questions

1. **[RESOLVED] Per-venue current open-uPnL read (Q1).** OKX `data[0].upl` (same call as `totalEq`); Deribit session-uPnL field on `get_account_summaries` (same call as the anchor — exact field A1); Bybit/Binance not needed for the roll (wedge 0). No new fetch for the MTM venues.
2. **[RESOLVED] Is the anchor already MTM per venue (Q2).** OKX YES, Deribit YES → subtract. Bybit NO (walletBalance), Binance NO (spot walletBalance) → wedge 0. Verified against ccxt 4.5.59 source in the CI venv.
3. **[RESOLVED] Historical marks retrievable? (Q3)** NO on all four read-only venues → **per-day true-up DEFERRED; realized-basis invariant STANDS + flag.** HIGH confidence.
4. **[RESOLVED-with-LIVE-tail] Current-NAV re-add (Q4).** Series is realized-basis by construction (no step). Re-add is definitional: keep stored MTM equity, subtract wedge only at the roll terminal; frontend untouched. LIVE tail: planner confirms no derive-path code mutates a stored equity scalar with the wedge.
5. **[LIVE] Deribit uPnL field name (A1)** — confirm `session_upl` vs `total_pl` on a live `get_account_summaries` read before locking the Deribit branch; safe fallback = wedge 0 + flag.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| ccxt | uPnL reads | ✓ | 4.5.59 (CI-3.12 venv) | — |
| pandas | core math | ✓ | 2.2.3 | — |
| numpy | fail-loud coercion | ✓ | 2.4.6 | — |
| CI-3.12 venv python | test execution | ✓ | 3.12 | Local Python 3.14 SIGSEGVs on pandas tslibs — MUST use the CI-3.12 venv |

**Missing dependencies with no fallback:** none.
Live-exchange reads (Deribit field confirmation A1) require a live read-only key — not available in unit tests; use in-process stubs for tests and confirm A1 at execute time against a live LTP account.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | pytest (analytics-service suite; 3092 pass / 92 skip baseline, CI-3.12) |
| Config file | `analytics-service/pytest.ini` / `pyproject.toml` (existing) |
| Quick run command | `<CI-3.12-venv>/bin/python -m pytest analytics-service/tests/test_nav_twr.py -x` |
| Full suite command | `<CI-3.12-venv>/bin/python -m pytest analytics-service/tests -q` |

> `<CI-3.12-venv>` = `/private/tmp/claude-501/-Users-helios-mammut-claude-projects-quantalyze/fcce1bd5-15ef-4e42-adb9-85cfc9ad484c/scratchpad/venv312/bin/python`. Never run under local Python 3.14 (SIGSEGV in pandas tslibs).

### Phase Requirements → Test Map
| Req | Behavior | Test Type | Automated Command | File Exists? |
|-----|----------|-----------|-------------------|-------------|
| FLOW-04 | terminal = anchor − uPnL; whole series realized-basis, NO step at anchor day | unit | `pytest tests/test_nav_twr.py -k terminal_wedge -x` | ❌ Wave 0 (extend existing test_nav_twr.py) |
| FLOW-04 | wedge byte-identity: `reconstruct(anchor, uPnL=X)` == `reconstruct(anchor−X, uPnL=0)` | unit | `pytest tests/test_nav_twr.py -k wedge_equivalence -x` | ❌ Wave 0 |
| FLOW-04 | materiality flag fires >5%, clean ≤5% (mutation: flip comparator → RED) | unit | `pytest tests/test_nav_twr.py -k unrealized_pnl_in_anchor -x` | ❌ Wave 0 |
| FLOW-04 | Bybit/Binance wedge stays 0 (no double-count) | unit | `pytest tests/test_job_worker.py -k upnl_wedge_venue -x` | ❌ Wave 0 |
| FLOW-04 | no-fabricated-marks: source-scan — no per-day uPnL array constructed | unit | `pytest tests/test_nav_twr.py -k no_historical_mark -x` | ❌ Wave 0 |
| FLOW-04 | OKX `upl` read from the same response (stub) → wedge subtracted | unit | `pytest tests/test_exchange.py -k okx_upl -x` | ❌ Wave 0 |
| FLOW-04 | flag lifts to `complete_with_warnings` via the DQ bridge (pre-stamp + promotion) | integration | `pytest tests/test_analytics_runner.py -k unrealized_pnl_in_anchor -x` | ❌ Wave 0 |

### The three required proofs
1. **No-step-discontinuity proof.** Fixture: an account with a large open position across the window end (`open_unrealized_usd = X`, `anchor = A`). Assert `nav.iloc[-1] == A − X` and the day n-1→n return equals `pnl_n / NAV_{n-1}` with NO uPnL term (uPnL never touches an intra-window day). Assert byte-identity (rtol 1e-12) to a run with `anchor = A−X, open_unrealized_usd = 0` — proves the wedge is a pure terminal shift. Mutation: inject uPnL into `nav.iloc[-1]` post-roll → the continuity assertion goes RED.
2. **Materiality-flag proof.** `|uPnL|/anchor` just above 5% → `unrealized_pnl_in_anchor` set, `computation_status_hint == complete_with_warnings`. Just below → flag absent, `complete`. Mutation: flip `>` to `>=`/`<` → boundary test RED. Zero/dust anchor or `balance_error` → NOT flagged (noise guard).
3. **No-fabricated-marks proof.** Source-scan test (mirror the P73 forbidden-substitution scan): assert the wedge is applied as a single scalar on `terminal_nav` and no per-day historical-uPnL Series/array is constructed anywhere in the roll. Encodes the Q3 verdict as an executable invariant.

### Sampling Rate
- **Per task commit:** `pytest tests/test_nav_twr.py -x` (+ the touched adapter test).
- **Per wave merge:** full analytics suite in the CI-3.12 venv (all P73-76 byte-identity + delegation + DQ pins must stay GREEN).
- **Phase gate:** full suite green before `/gsd:verify-work`; mypy --strict clean on the 3-4 touched files.

### Wave 0 Gaps
- [ ] `tests/test_nav_twr.py` — terminal-wedge equivalence, no-step-discontinuity, materiality-flag boundary, no-fabricated-marks source-scan (extend existing file).
- [ ] `tests/test_exchange.py` — OKX `upl` companion read (stubbed response).
- [ ] `tests/test_job_worker.py` — venue-gated wedge (Bybit/Binance = 0), heuristic-anchor no-flag.
- [ ] `tests/test_analytics_runner.py` — `unrealized_pnl_in_anchor` promotion predicate + pre-stamp lift.
- [ ] Deribit branch: confirm A1 field name via a live read before locking (or ship wedge=0 fallback + flag).

## Security Domain

> `security_enforcement` not explicitly false → included. This phase reads exchange balances on READ-ONLY keys and writes no user input.

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V5 Input Validation | yes | Fail-loud `_coerce_float` on every uPnL/anchor value (non-finite → `NavReconstructionError`, never silent NaN) — `nav_twr.py:117-139` |
| V6 Cryptography | no | No crypto; no secrets handled beyond existing scrubbed API-key flow |
| V7 Error Handling / Logging | yes | NO raw NAV/uPnL USD in any log or raise message (account-size leak class T-73-02 / T-76-03-LEAK) — reuse `scrub_freeform_string`; materiality flag carries a BOOL, never the USD wedge |
| V2/V3/V4 Auth/Session/Access | no | Worker uses service-role; no new surface |

### Known Threat Patterns
| Pattern | STRIDE | Mitigation |
|---------|--------|------------|
| Account-size leak via logged uPnL/NAV USD | Information Disclosure | Flag is boolean; no USD in logs/raises (existing discipline) |
| Silent NaN terminal from a malformed uPnL field | Tampering | `_coerce_float` rejects non-finite → permanent `NavReconstructionError`, never a silent `complete` |
| Double-count uPnL inflating a track record (Bybit/Binance) | Tampering (integrity) | Venue-gated wedge default 0; Phase 78 parity gate on flow-less accounts |

## Sources

### Primary (HIGH confidence)
- ccxt 4.5.59 source in CI-3.12 venv — `bybit.parse_balance` (`walletBalance` total), `binance.parse_balance_custom` (`marginBalance`/`balance`; defaultType spot), `okx` raw `totalEq`/`upl`. [VERIFIED via `inspect.getsource` + `.options`/`.has`]
- Repo: `services/nav_twr.py` (`:507-511` wedge seam, `:361-418` reconcile self-check, `:90` NavTWRMeta), `services/exchange.py` (`:2690-2745` OKX totalEq/anchor), `services/deribit_ingest.py` (`:706-761` account-summary anchor), `services/deribit_txn.py` (`:245-300` equity-to-USD), `services/broker_dailies.py` (`:130-160` combine seam), `services/job_worker.py` (`:2101` anchor read, `:2172` combine call, `:2378` `_BROKER_WARN_FLAGS`), `services/equity_reconstruction.py` (`:1924-2063` per-venue uPnL semantics: unified-margin vs additive).
- `.planning/REQUIREMENTS.md` (FLOW-04), `.planning/STATE.md`, `77-CONTEXT.md`.

### Secondary (MEDIUM confidence)
- OKX `/api/v5/account/balance` (`totalEq`, `upl`) and Deribit `private/get_account_summary` (`equity`, `session_upl`, `total_pl`) field schemas — from provider API docs / training; Deribit exact uPnL field flagged A1 for live confirmation.

## Metadata

**Confidence breakdown:**
- Per-venue anchor MTM-ness + uPnL source (Q1/Q2): HIGH — verified against installed ccxt source + repo code.
- Historical-mark verdict (Q3): HIGH — negative confirmed across four venues via ccxt `has` + endpoint semantics.
- Current-NAV re-add (Q4): HIGH for the series (by construction); MEDIUM live tail (stored-scalar confirmation).
- Materiality threshold (Q5): MEDIUM — defensible default, tune at Phase 78.
- Deribit uPnL field name (A1): MEDIUM — confirm live.

**Research date:** 2026-07-06
**Valid until:** ~2026-08-05 (stable; re-verify if ccxt is bumped from 4.5.59 or an anchor's wallet scope changes)
