---
phase: 78
slug: golden-parity-p72-acceptance-gating
status: planned
nyquist_compliant: true
wave_0_complete: false  # gates true once 78-01/78-02 land
created: 2026-07-07
---

# Phase 78 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | pytest (CI-3.12 venv — local Python 3.14 SIGSEGVs on pandas) |
| **Config file** | `analytics-service/pyproject.toml` / `pytest.ini` |
| **Quick run command** | `PYTHONPATH=. <ci-venv>/bin/python -m pytest tests/test_golden_parity.py -q` |
| **Full suite command** | `PYTHONPATH=. <ci-venv>/bin/python -m pytest -q` (baseline 3147 passed / 92 skipped) |
| **Estimated runtime** | ~55s full suite; <5s for the golden-parity self-test |

---

## Sampling Rate

- **After every task commit:** Run the quick golden-parity self-test.
- **After every plan wave:** Run the full suite; must stay at/above the 3147-passed baseline.
- **Before `/gsd:verify-work`:** Full suite green.
- **Max feedback latency:** ~60 seconds.

---

## Per-Task Verification Map

*(Filled by the planner. ACC-01 tasks are fixture-backed CI unit tests; ACC-02 tasks are the live `deribit_acceptance.py` canary re-run, `autonomous: false`.)*

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | Status |
|---------|------|------|-------------|-----------|-------------------|--------|
| 78-01 T1 | 01 | 1 | ACC-01 | (source) frozen oracle transcription | `python -c "import ast; ast.parse(open('scripts/golden_parity.py').read())"` | ⬜ pending |
| 78-01 T2 | 01 | 1 | ACC-01 | unit (golden pin) | `pytest tests/test_golden_parity.py::test_oracle_matches_pre73_golden -x` | ⬜ pending |
| 78-02 T1 | 02 | 2 | ACC-01 | fixture import | `python -c "from tests.fixtures.golden_parity import panel_fixtures"` | ⬜ pending |
| 78-02 T2 | 02 | 2 | ACC-01 | (source) panel-gate driver | `python -c "from scripts.golden_parity import gate_account, main"` | ⬜ pending |
| 78-02 T3 | 02 | 2 | ACC-01 | unit (mutation-honest gate) | `pytest tests/test_golden_parity.py -x` | ⬜ pending |
| 78-03 T1 | 03 | 3 | ACC-02 | manual (snapshot + re-derive) | `railway ssh` snapshot + `derive_broker_dailies` enqueue (autonomous:false) | ⬜ pending |
| 78-03 T2 | 03 | 3 | ACC-02 | manual (live canary) | `railway ssh … python -m scripts.deribit_acceptance …` (autonomous:false) | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `analytics-service/tests/test_golden_parity.py` — mutation-honest self-test: flow-less control → `UNCHANGED`, LTP068-shaped → `FLOW_MOVED`, any `UNEXPLAINED` fails the gate. Must fail if `classify_delta` or the panel gate is neutered.
- [ ] `analytics-service/tests/fixtures/golden_parity/` — per-venue flow-less control fixtures + a pre-73 golden JSON baseline (frozen-oracle output).

*Existing infrastructure (pytest + CI-3.12 venv) covers execution.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| LTP056/068/016 correct vs exchange statements; LTP068 no longer +458% | ACC-02 | Needs prod secrets + real exchange statements (founder-held) | Re-derive the 3 LTP strategies under corrected returns, then `railway ssh` run `scripts/deribit_acceptance.py --account <uuid>:<idx>:<label>:<start>:<end>`; founder confirms magnitudes + trade counts + funding + inverse signs |
| Deribit `session_upl` field name `[ASSUMED A1]` | ACC-02 | Needs a live read-only Deribit key | Confirm the account-summary field name against a live read; degrades safe (wedge→0.0) if wrong |
| OKX/Bybit wallet-scope wrong-anchor (Binance SPOT vs USDⓈ-M; Bybit FUND/UNIFIED) | ACC-01/ACC-02 | No automated net — reconciliation residual is self-consistent by construction (P76) | Golden parity divergence vs real statements; founder confirms the anchor scope |

---

## Validation Sign-Off

- [x] ACC-01 has a fixture-backed automated self-test that fails when neutered (78-02 T3, mutation-honest)
- [x] ACC-02 live gates enumerated as `autonomous: false` with founder instructions (78-03)
- [x] No production factsheet ships until the panel is clean AND founder confirms ACC-02 (gate is a HARD blocker)
- [x] `nyquist_compliant: true` set — per-task map filled

**Approval:** planner-signed 2026-07-07 (per-task map filled; nyquist_compliant true)
