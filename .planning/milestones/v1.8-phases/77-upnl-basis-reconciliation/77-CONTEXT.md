# Phase 77: uPnL Basis Reconciliation - Context

**Gathered:** 2026-07-06
**Status:** Ready for planning
**Mode:** Autonomous smart-discuss (decisions from ROADMAP SCs + PROJECT decision; research resolves historical-mark retrievability)

<domain>
## Phase Boundary
Make the realized-vs-mark-to-market basis wedge EXPLICIT: the anchor equity is
mark-to-market (incl. open uPnL) but the daily pnl stream is realized-only, so the
reconstructed intra-window NAV has a uPnL gap. The backward roll is realized-basis;
uPnL is re-added ONLY to the reported CURRENT NAV; a MATERIAL wedge FAILS LOUD /
flags rather than silently drifting every intra-window NAV. Requirement: FLOW-04.
</domain>

<decisions>
## Implementation Decisions — LOCKED (ROADMAP SC 1-4 + PROJECT decision 2026-07-05)
1. **Companion uPnL read** — `exchange.py` gains an open-uPnL read alongside the
   equity anchor (the one genuinely new upstream data dependency), per venue.
2. **Realized-basis terminal (already wired):** the core holds
   `terminal_nav = anchor_nav − open_unrealized_usd` for the backward roll (the
   param already exists in `nav_twr.reconstruct_nav_and_twr`, defaulting 0.0) so
   the roll and the daily increments share ONE realized basis. uPnL is re-added
   ONLY to the reported CURRENT NAV — NO silent mark-to-market/realized blend. An
   account with a large open position across the window-end reconstructs with NO
   step discontinuity at the anchor day.
3. **Materiality flag:** raise `unrealized_pnl_in_anchor` (`complete_with_warnings`)
   when `|open_unrealized_usd| / anchor_equity` exceeds the materiality threshold —
   honest surfacing over false precision. Reuse the existing DQ-flag machinery
   (like the P73-76 guard flags), not a parallel status.
4. **Historical-mark availability — research resolves per venue.** A per-day uPnL
   true-up lands ONLY if historical open-position marks are retrievable on
   READ-ONLY keys; otherwise the realized-basis-intraday / mark-to-market-at-
   endpoint invariant STANDS, documented in the core docstring and flagged. Do NOT
   fabricate historical marks.

### Research resolutions (77-RESEARCH.md — fold into plans)
- **⭐Q2 THE LOAD-BEARING FINDING — the wedge is VENUE-SPECIFIC:** OKX `totalEq`
  and Deribit per-ccy `equity` are MARK-TO-MARKET (include uPnL) → SUBTRACT
  `open_unrealized_usd`. **Bybit maps to `walletBalance` and Binance is spot
  `walletBalance` — BOTH realized-basis → wedge = 0, do NOT subtract.** Blindly
  subtracting uPnL for ALL venues would DOUBLE-COUNT on Bybit/Binance and INFLATE
  the return (a new corruption). The uPnL read + subtract is GATED to the MTM
  venues (OKX, Deribit) only. (Verified against ccxt 4.5.59 source.)
- **Q1 uPnL read (no new fetch):** OKX `data[0].upl` rides the SAME
  `private_get_account_balance()` that reads `totalEq` (exchange.py:2705-2717);
  Deribit session-uPnL rides `get_account_summaries` (exact field A1 — confirm
  live; safe fallback = wedge 0 + flag, NEVER fabricate). Bybit/Binance: no read.
- **Q3 RESOLVED (HIGH-confidence negative):** historical open-position marks are
  NOT retrievable on read-only keys on ANY of the 4 venues → per-day uPnL true-up
  is DEFERRED; the realized-basis-intraday / MTM-at-endpoint invariant STANDS,
  documented in the core docstring + flagged.
- **Q4 no step discontinuity BY CONSTRUCTION:** uPnL is subtracted from
  `terminal_nav` BEFORE the backward roll (nav_twr.py:507-511), so the whole
  series is realized-basis; uPnL never enters an intra-window day. The "re-add"
  is definitional (keep the stored MTM equity; frontend untouched). Confirm no
  derive-path code mutates a stored equity scalar with the wedge (Q4 tail).
  `reconcile_flow_residual` is unaffected (wedge shifts terminal + reconstructed
  start identically — no spurious breach).
- **Q5 materiality = 5%** of anchor, warning-only, `NavTWRMeta.unrealized_pnl_in_anchor`,
  lifted via the existing P73-76 DQ bridge (`_BROKER_WARN_FLAGS` job_worker.py:2378
  + analytics_runner promotion predicate). Guard against dust/heuristic anchors.
- **A3 (P78 coupling):** if Phase 78 re-scopes Binance to USDⓈ-M `marginBalance`
  (which DOES include uPnL), the Binance wedge becomes NON-zero — document so P78
  revisits it.

### Grey areas — research to confirm
- Per-venue uPnL read: Deribit (equity vs realized in the txn-log / account
  summary), Binance (USDⓈ-M positionAmt/unRealizedProfit), Bybit (UNIFIED uPnL),
  OKX (`totalEq` is MTM; `upl`/`uplLastPx` fields). What read-only endpoint gives
  CURRENT open uPnL per venue?
- Historical marks on read-only keys: retrievable? (STATE: MEDIUM confidence.)
  Almost certainly NOT for a read-only key without position history → realized-
  basis invariant stands + flag. Research confirms per venue.
- Materiality threshold value (e.g. 5%/10% of anchor) — pick a defensible default;
  flag, don't fail-hard, on breach (the reported return is still realized-basis-
  honest; the flag surfaces that intra-window NAV excludes uPnL drift).
</decisions>

<code_context>
## Existing Code Insights
- `nav_twr.reconstruct_nav_and_twr(..., open_unrealized_usd=0.0)` — the wedge param
  already exists; terminal = anchor − open_unrealized_usd. Phase 77 supplies a real
  value + the materiality flag + the current-NAV re-add.
- `exchange.py`: `fetch_account_equity_usd:2727` / `fetch_okx_total_equity_usd:2690`
  (`totalEq` = OKX MTM equity incl uPnL). The anchor is already MTM.
- The DQ-flag channel (NavTWRMeta + the broker→CSV bridge from P76) carries
  `unrealized_pnl_in_anchor` to the factsheet as `complete_with_warnings`.
- Count-once with P73-76: uPnL is NOT a flow and NOT realized pnl — it's a basis
  adjustment on the terminal only. Do not double-count.
</code_context>

<specifics>
## Specific Ideas
- Smallest correct change: read uPnL at the anchor, subtract for the roll (already
  the param), re-add for reported current NAV, flag if material. Per-day true-up
  only if research says marks are retrievable (likely deferred).
- Mutation-honest: a large-open-position account must reconstruct with NO step
  discontinuity at the anchor day; the materiality flag must fire on a material
  wedge and stay clear on an immaterial one.
</specifics>

<deferred>
## Deferred Ideas
- Golden parity + P72 LTP068 acceptance + wallet-scope wrong-anchor detection +
  founder confirmation — Phase 78 (HARD GATE).
- Per-day historical uPnL true-up — only if research proves marks retrievable;
  else explicitly deferred with the realized-basis invariant documented.
- Dead `deribit_linear_external_flow_usd` removal — milestone cleanup.
</deferred>
