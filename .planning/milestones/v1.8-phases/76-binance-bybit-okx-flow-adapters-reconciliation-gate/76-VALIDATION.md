---
phase: 76
slug: binance-bybit-okx-flow-adapters-reconciliation-gate
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-06
---

# Phase 76 — Validation Strategy

> Full architecture in `76-RESEARCH.md` ("## Validation Architecture"). Every
> proof mutation-honest — the risk class is a missing/mis-valued ccxt flow
> silently attributed to performance (LTP068 class at venue scope).

## Test Infrastructure
| Property | Value |
|----------|-------|
| **Framework** | pytest 7.x; OKX/Bybit use vcrpy cassettes (Binance too where present) |
| **Quick run** | `cd analytics-service && $PY312 -m pytest tests/test_external_flows*.py tests/test_equity_reconstruction*.py tests/test_nav_twr.py -q` |
| **Full suite** | `cd analytics-service && $PY312 -m pytest -q` |
| **Interpreter** | `$PY312` = the CI-3.12 venv (local 3.14 SIGSEGVs on pandas) — MANDATORY |

## Critical Validation Requirements (plan must_haves — mutation-honest)
1. **Event-time flow valuation:** a non-stable coin ccxt flow (BTC deposit) → valued
   at same-UTC-day close; test FAILS if valued at 1.0, current price, or dropped.
   Stablecoins → 1.0. No same-day price → FAIL LOUD.
2. **Promotion, zero behavior change:** `_fetch_transfers` promoted to shared; the
   allocator-dashboard equity-reconstruction job (its current consumer) is
   byte-identical (a characterization test pins it before/after the move).
3. **Own-transfer exclusion per venue:** Binance `internal is False`; Bybit
   `info.withdrawType=='0'`; OKX structural — one fixture per venue: real deposit +
   internal own-transfer → ONLY the deposit becomes F_t (mutation: dropping the
   filter lets the own-transfer through → RED).
4. **Reconciliation gate (DQ-02) identity residual:** the mutation-detector residual
   reddens on a dropped/mis-valued flow within tolerance `max($1, 1e-6·|anchor|)`.
5. **Terminus segmentation:** a deposit outside OKX 90-day retention → early NAV ≤ 0
   → segment at the last trustworthy day, refuse pre-terminus TWR, flag
   `complete_with_warnings` — NEVER attribute the gap to performance. Mutation:
   removing the segment fabricates a return over the gap → RED.
6. **Transient vs terminal:** a transient fetch error → retryable (not a permanent
   truncation); only a clean empty at the retention boundary segments (WR-04).
7. **Pagination:** OKX/Bybit multi-page flow history is fully fetched (the
   `len(page)<500` break bug does not truncate) — a >1-page fixture proves it.
8. **Wallet-scope fail-loud:** a deliberately mis-scoped anchor vs flows → the DQ-02
   residual does NOT reconcile → gate fails loud (proves a wrong Binance
   SPOT/USDⓈ-M or Bybit FUND/UNIFIED scope cannot silently mis-attribute).

## Wave 0 (pre-flight)
- Characterization snapshot of the allocator-dashboard equity-reconstruction output
  BEFORE promoting `_fetch_transfers` (requirement 2's before/after pin).
- Per-venue flow-history fixtures/cassettes incl. a multi-page history and a
  retention-boundary gap.
