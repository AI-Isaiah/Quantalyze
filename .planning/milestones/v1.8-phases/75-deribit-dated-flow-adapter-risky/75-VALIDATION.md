---
phase: 75
slug: deribit-dated-flow-adapter-risky
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-06
---

# Phase 75 — Validation Strategy (RISKY)

> Full architecture in `75-RESEARCH.md` ("## Validation Architecture"). This is
> the milestone's silent-corruption-risk phase — every proof below must be
> mutation-honest (fail if an inverse flow is mis-valued or dropped).

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | pytest 7.x (analytics-service); Deribit uses in-process STUBS (no vcrpy cassettes) |
| **Quick run** | `cd analytics-service && $PY312 -m pytest tests/test_deribit_txn*.py tests/test_nav_twr.py tests/test_external_flows*.py -q` |
| **Full suite** | `cd analytics-service && $PY312 -m pytest -q` |
| **Interpreter** | `$PY312` = the CI-3.12 venv (local 3.14 SIGSEGVs on pandas) — MANDATORY |

## Critical Validation Requirements (plan must_haves — RISKY, mutation-honest)

1. **Inverse flow valued at EVENT-TIME index:** a BTC/ETH withdrawal `change` is
   valued at its SAME-DAY `get_delivery_prices` settlement index — a test that
   FAILS if valued at 1.0, at a current/most-recent price, or dropped.
2. **Fail-loud on missing index (C1):** an inverse flow on a day with NO same-day
   index raises `LedgerValuationError` (permanent) — never silently valued/dropped.
   AND the index-fetch (`inverse_days_needing_index`) is EXTENDED so a legitimate
   inverse-flow day gets its index fetched (does not spuriously fail a real job).
3. **Count-once invariant:** a flow row feeds F_t and is EXCLUDED from the realized
   daily sum (test asserts a flow type never appears in both).
4. **Correct sign + date:** deposit → +usd on its actual UTC day; withdrawal →
   −usd; midnight-adjacent flow does not drift (same `_row_utc_day` bucketing).
5. **F1 scalar deleted:** `job_worker.py:1968-1979` net-scalar anchor correction
   is gone; flows feed ONLY the core F_t. A test/grep proves the scalar is not
   re-applied (no double-correction).
6. **TWR flow-neutrality (SC4, reconciled):** a non-dominating pure-flow day
   (`|F| < NAV_{t-1}`) → r_t == 0; a DOMINATING withdrawal → `flow_dominated_guard`
   (NaN + flag), NOT a fabricated ±100% day. BOTH pinned.
7. **Contract:** `ExternalFlow = (utc_day_iso, usd_signed)` is pure/no-I/O and is
   the SAME type the Phase 76 ccxt adapters will import.

## Wave 0 (pre-flight)
- Snapshot LTP068-shaped Deribit txn-log fixtures (synthesized from schema —
  no LTP068 rows exist in-repo) covering: a linear flow day, an inverse flow day
  WITH same-day index, an inverse flow day WITHOUT index (fail-loud), a
  dominating-withdrawal day, and a pure-flow no-trade day.
