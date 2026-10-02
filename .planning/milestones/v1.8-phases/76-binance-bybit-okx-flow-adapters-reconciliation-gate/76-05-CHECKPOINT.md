# Phase 76-05 — Wallet-Scope Founder Confirmation (DEFERRED to Phase 78)

**Type:** checkpoint:human-verify · **autonomous:** false · **Status:** DEFERRED-RECORDED (not blocking phase 76)
**Requirement:** FLOW-03 (wallet-scope leg) · **Resolves at:** Phase 78 acceptance gate

## What needs founder confirmation
The ccxt flow adapters (76-01..76-04) are built and the per-venue own-transfer
exclusion is proven. What CANNOT be closed from code alone — it needs the live
account roster / founder knowledge — is whether **anchor, PnL, and flows read the
SAME pool of capital** on two venues:

1. **Binance SPOT vs USDⓈ-M.** `create_exchange` sets no `defaultType`, so the
   Binance anchor likely reads the SPOT wallet while PnL is USDⓈ-M futures. If the
   account holds capital in both, anchor/PnL/flows may span different pools.
   → Confirm: which wallet(s) hold this account's capital; must the anchor combine
     SPOT + USDⓈ-M?
2. **Bybit FUND / UNIFIED / CONTRACT.** The Bybit anchor is UNIFIED-only today. A
   FUND→UNIFIED own-transfer inflates the UNIFIED anchor.
   → Confirm: should the anchor combine FUND + UNIFIED + CONTRACT (or net them)?

## Why this is NOT a phase-76 blocker (and the honest limits of the interim net)
There is **NO automated interim net for a wrong wallet-scope.** The DQ-02
`reconcile_flow_residual` self-check (76-03, tolerance `max($1,1e-6·|anchor|)`) is a
**CONSTRUCTION tautology, not a wrong-scope guard** (HIGH-1, red-team 2026-07-06):
`reconstruct_nav_and_twr` derives `reconstructed_start` from day-0 of the SAME rolled
NAV built off the anchor, so `terminal` and `reconstructed_start` move together and the
residual is ~0 for **ANY** anchor value — including a mis-scoped one. Proven: a 20%-low
anchor sails through `complete` with a +22% relative return change and never raises. The
residual DOES catch a roll-loop-vs-Σ **code** divergence (a dropped/mis-valued flow),
which is a legitimate and retained construction check — but it says nothing about whether
the anchor reads the right pool of capital.

The real net for a wrong scope is:
1. **Phase 78 golden old-vs-new parity panel** — divergence of the new flow-aware TWR
   from the known-good baseline on known accounts surfaces a mis-scoped anchor.
2. **Founder confirmation** of the wallet-scope questions below.

No LTP / production factsheet ships from this path until Phase 78 clears both. Until then,
a mis-scoped anchor would silently re-scale every daily return with no loud failure.

## Action at Phase 78
- Present the Binance + Bybit wallet-scope questions to the founder alongside the
  golden old-vs-new parity panel and the LTP068 acceptance canary — this parity panel,
  NOT the residual, is what catches a wrong scope.
- If a scope needs to combine wallets, adjust the anchor read (exchange.py) and re-run the
  parity panel; only then mark FLOW-03's wallet-scope leg fully complete.
