---
phase: 77
slug: upnl-basis-reconciliation
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-06
---

# Phase 77 — Validation Strategy

> Full architecture in `77-RESEARCH.md`. Mutation-honest; the new corruption risk
> is DOUBLE-COUNTING uPnL on a realized-basis venue (Bybit/Binance).

## Test Infrastructure
| Property | Value |
|----------|-------|
| **Framework** | pytest 7.x |
| **Quick run** | `cd analytics-service && $PY312 -m pytest tests/test_nav_twr.py tests/test_exchange*.py tests/test_job_worker*.py -q` |
| **Full suite** | `cd analytics-service && $PY312 -m pytest -q` |
| **Interpreter** | `$PY312` = the CI-3.12 venv (local 3.14 SIGSEGVs on pandas) — MANDATORY |

## Critical Validation Requirements (plan must_haves — mutation-honest)
1. **Venue-gated wedge (THE risk):** OKX/Deribit (MTM anchor) → `open_unrealized_usd`
   is subtracted; Bybit/Binance (realized-basis anchor) → wedge == 0.0, NOT
   subtracted. Mutation: subtracting uPnL on Bybit/Binance → return inflates → RED.
   Subtracting on OKX/Deribit → realized-basis terminal (test the sign + value).
2. **No step discontinuity:** a large-open-position account across the window-end
   reconstructs with NO jump at the anchor day (the whole series is realized-basis).
   Mutation: leaking uPnL into an intra-window day → discontinuity → RED.
3. **Materiality flag:** `|open_unrealized_usd| / anchor_equity > 5%` →
   `unrealized_pnl_in_anchor` + `complete_with_warnings`; below → clean `complete`.
   Both directions pinned; guarded against dust/heuristic anchors.
4. **Residual unaffected:** `reconcile_flow_residual` does not spuriously breach with
   a non-zero wedge (terminal + reconstructed_start shift identically).
5. **No fabricated marks:** per-day true-up is NOT implemented; the realized-basis
   invariant is documented in the core docstring. A missing/uncertain uPnL field
   (Deribit A1) → wedge 0 + flag, NEVER a fabricated mark.
6. **Reported current NAV re-add is definitional:** the stored MTM equity is kept as
   the reported current NAV; no derive-path code mutates a stored equity scalar with
   the wedge (Q4 tail — confirm the CSV/derive path writes only csv_daily_returns).

## Wave 0 (pre-flight)
- Fixtures: an OKX/Deribit account with a large open position (material wedge) and a
  Bybit/Binance account (zero wedge) — anchor the venue-gating + no-discontinuity +
  materiality proofs.
