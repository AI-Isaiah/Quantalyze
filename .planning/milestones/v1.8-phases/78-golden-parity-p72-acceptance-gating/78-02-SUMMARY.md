---
phase: 78-golden-parity-p72-acceptance-gating
plan: 02
subsystem: analytics-service
tags: [golden-parity, acc-01, panel-gate, classify-delta, mutation-honest, twr]
requires:
  - "78-01: scripts/golden_parity.py::old_anchor_to_today_returns (frozen OLD oracle)"
  - "services/parity_diff.py::classify_delta (bucket primitive — reused, not reimplemented)"
  - "services/nav_twr.py::reconstruct_nav_and_twr (NEW live flow-aware core)"
provides:
  - "scripts/golden_parity.py::gate_account (OLD-vs-NEW per-account classifier, fail-closed on UNEXPLAINED)"
  - "scripts/golden_parity.py::main (panel driver — nonzero exit on any mismatch/UNEXPLAINED)"
  - "tests/fixtures/golden_parity/panel_fixtures.py (per-venue flow-less controls + LTP068-shaped mover)"
  - "tests/test_golden_parity.py (mutation-honest ACC-01 CI self-test)"
affects:
  - "78-03 (Wave 3 live deribit_acceptance re-run consumes this gate structure; autonomous:false)"
tech-stack:
  added: []
  patterns:
    - "Dual-compute gate: frozen OLD oracle vs live NEW core diffed through a shared bucket primitive"
    - "Function-local service-graph imports keep the frozen-oracle module dependency-free for its golden-pin importer"
    - "Mutation-honest self-test proven RED under classifier-neuter / gate-neuter / has_flows-flip scratch mutations"
key-files:
  created:
    - analytics-service/tests/fixtures/golden_parity/panel_fixtures.py
  modified:
    - analytics-service/scripts/golden_parity.py
    - analytics-service/tests/test_golden_parity.py
decisions:
  - "gate_account calls reconstruct_nav_and_twr DIRECTLY (the terminus transforms/broker_dailies delegate to) with anchor_nav=account_balance — matching the honest daily_pnl branch exactly; no reimplemented chain-link."
  - "LOW-3 REANNUALIZATION is exercised ONLY by a direct classify_delta call with a synthetic 252-basis old_metrics vs the real 365-basis new_metrics; through the both-at-HEAD driver a byte-identical control is UNCHANGED (the branch is unreachable there, by design)."
  - "The has_flows-flip mutation is meaningful only on a MOVED fixture (the unexplained injection), since a byte-identical control never consults has_flows; test_any_unexplained_fails_gate asserts the RAISE to catch it."
metrics:
  duration: ~40m
  completed: 2026-07-07
---

# Phase 78 Plan 02: ACC-01 Panel Gate Summary

Built the ACC-01 panel gate — the hard blocker that authorizes the v1.8
production flip — as a thin driver over the shipped `classify_delta` primitive:
per-venue flow-less controls prove byte-identity survived the P73/P74 shared-path
refactor (classify UNCHANGED), an LTP068-shaped fixture proves the honest move
happens (FLOW_MOVED), and any UNEXPLAINED delta fails the gate closed. Backed by a
CI-enforced, mutation-honest self-test proven RED under three scratch mutations.

## What Was Built

- **`tests/fixtures/golden_parity/panel_fixtures.py`** — SYNTHETIC, committed,
  no-live-key fixtures:
  - `flowless_controls()` — one `estimated_start > 0` byte-identity control per
    live venue (Deribit, OKX, Bybit, Binance), each `has_flows=False`, expected
    `UNCHANGED`. Distinct P&L shapes; all balances well above the $1000 dust floor.
  - `ltp068_mover()` — profits-withdrawn shape (total P&L > current balance ⇒
    `estimated_start <= 0`, the OLD `account_balance` fallback bug) carrying a REAL
    dated sub-NAV withdrawal fed only to the NEW core. `has_flows=True`, expected
    `FLOW_MOVED`.
  - `unexplained_injection()` — the mover's moving inputs declared `has_flows=False`
    (the fail-closed / T-78-04 defeat-the-net case), deliberately NOT in the clean
    panel.
- **`scripts/golden_parity.py`** extended with the panel driver:
  - `gate_account(daily_pnl, account_balance, *, external_flows, open_unrealized_usd,
    has_flows, expected_bucket) -> bool` — OLD via the frozen
    `old_anchor_to_today_returns`, NEW via the live
    `reconstruct_nav_and_twr` (anchor_nav = account_balance, the exact honest
    daily_pnl-branch anchor), `{"cagr","calmar"}` from HEAD `compute_all_metrics`,
    then `classify_delta` with caller-supplied `has_flows`. Asserts
    `bucket != UNEXPLAINED` (fail closed) and returns `bucket == expected_bucket`.
  - `main(accounts=None) -> int` — iterates the panel, prints buckets/counts/booleans
    only (T-78-01), exits nonzero on any mismatch or UNEXPLAINED.
  - Service-graph imports are function-local so `import scripts.golden_parity` and
    the frozen-oracle transcription stay dependency-free (the 78-01 golden pin
    imports only the oracle). NO `.github/workflows/ci.yml` wiring (RESEARCH Pitfall 4).
- **`tests/test_golden_parity.py`** — the mutation-honest CI self-test (4 new
  behaviours; the 78-01 golden pin untouched).

## Verification Evidence

- **Self-test:** `pytest tests/test_golden_parity.py` — **8 passed** in the
  CI-3.12 venv (1 pre-existing golden pin + 4 controls parametrized + reannualization
  + flow_moved + unexplained).
- **Panel invariants (driver run):** deribit/okx/bybit/binance flow-less controls
  → `unchanged`; ltp068-shaped mover → `flow_moved`; `ACC-01 panel: 5 passed, 0
  failed`, exit 0. Zero UNEXPLAINED.
- **LOW-3 reachability:** `test_flowless_control_cagr_is_reannualization` feeds
  `classify_delta` a synthetic 252-basis `old_metrics` vs the real 365-basis
  `new_metrics` (inverting the 365/252 factor) on a byte-identical series →
  `REANNUALIZATION` (never UNEXPLAINED); the same series with no metric delta →
  `UNCHANGED`. Proves the no-move invariant is keyed on the SERIES, not CAGR.
- **Mutation honesty (each RED then reverted via `git checkout -- <file>`):**
  1. Force `classify_delta -> UNCHANGED` unconditionally → **3 failed**
     (reannualization, flow_moved, unexplained). Reverted.
  2. Drop the driver's `assert bucket != UNEXPLAINED` → **1 failed**
     (`test_any_unexplained_fails_gate` — the RAISE assertion). Reverted.
  3. Flip the injection's `has_flows` False→True → **1 failed**
     (`test_any_unexplained_fails_gate` — the move reclassifies FLOW_MOVED and the
     RAISE no longer fires). Reverted.
- **Full analytics suite:** **3155 passed / 92 skipped** in the CI-3.12 venv
  (78-01 baseline 3148 + this plan's 7 new cases). Green; all P73–P77 pins intact.

## Commits

- `087903ea` — test(78-02): per-venue flow-less controls + LTP068-shaped mover fixtures
- `0b962b12` — feat(78-02): ACC-01 panel-gate driver (gate_account + main) over classify_delta
- `e8a4005f` — test(78-02): mutation-honest ACC-01 panel-gate self-test

## Deviations from Plan

None — plan executed as written. `classify_delta` / `nav_twr` / `metrics` /
`transforms` and the P74 pins were untouched (scope fence: only
`scripts/golden_parity.py`, `tests/test_golden_parity.py`,
`tests/fixtures/golden_parity/panel_fixtures.py`). No `.github/workflows/ci.yml`
change; no live keys; no write path to production factsheet tables.

Note (not a deviation): `compute_all_metrics` emits harmless quantstats
RuntimeWarnings ("Mean of empty slice" for CVaR) on the short 4-day fixture
series. These are pre-existing quantstats behaviour on tiny series, out of scope
for this plan (metrics.py is scope-fenced), and do not affect any assertion.

## Known Stubs

None. The driver and self-test are fully wired end-to-end over the frozen oracle
(78-01) and the live core. The Wave 3 live `deribit_acceptance.py` re-run
(autonomous:false) is the only remaining ACC-01 piece and is deliberately out of
this CI-gated wave.

## Self-Check: PASSED

- FOUND: analytics-service/scripts/golden_parity.py
- FOUND: analytics-service/tests/test_golden_parity.py
- FOUND: analytics-service/tests/fixtures/golden_parity/panel_fixtures.py
- FOUND: commit 087903ea
- FOUND: commit 0b962b12
- FOUND: commit e8a4005f
