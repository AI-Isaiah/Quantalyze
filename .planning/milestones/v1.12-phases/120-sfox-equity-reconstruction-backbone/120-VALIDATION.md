---
phase: 120
slug: sfox-equity-reconstruction-backbone
status: planned
nyquist_compliant: true
wave_0_complete: false  # test scaffolds are embedded RED-first in plans 02/04
created: 2026-07-18
---

# Phase 120 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | pytest (analytics-service) |
| **Config file** | `analytics-service/pytest.ini` |
| **Quick run command** | `cd analytics-service && .venv/bin/python -m pytest tests/test_sfox_*.py -q` |
| **Full suite command** | `cd analytics-service && .venv/bin/python -m pytest -q` |
| **Estimated runtime** | ~5s subset; full ~40s |

---

## Sampling Rate

- **After every task commit:** the sfox subset
- **After every plan wave:** full analytics suite (backbone regression — one path, many consumers)
- **Before verify:** full suite green; the fixture parity test green; ground-truth harness committed
- **Max feedback latency:** ~40s (full suite — backbone touches many consumers)

---

## Per-Task Verification Map

| Task ID | Wave | Requirement | Secure/Correct Behavior | Test Type | Command | Status |
|---------|------|-------------|--------------------------|-----------|---------|--------|
| sfox-adapter-register | 1 | SFOX-05 | Source Literal + _FACTORIES + SUPPORTED_SOURCES admit sfox together (both parity tests green); SfoxAdapter.compute_metrics fails loud | unit | `pytest tests/test_boundary_literals_parity.py tests/test_ingestion_*.py -q` | ⬜ |
| combine-sfox-dailies | 1 | SFOX-05 | balance-history usd_value + transactions flows → cashflow-neutral TWR via chain_linked_twr → derive_basis_series (ONE path) | unit | `pytest tests/test_sfox_reconstruct.py -q` | ⬜ |
| api-verified-stamp | 2 | SFOX-05 | reconstructed sfox strategy carries trust_tier=api_verified | unit | `pytest tests/test_sfox_reconstruct.py -k api_verified -q` | ⬜ |
| degenerate-gates | 2 | SFOX-05 | empty/<10d/non-finite → honest gated empty, never invented (inherits backbone gates) | unit | `pytest tests/test_sfox_reconstruct.py -k degenerate -q` | ⬜ |
| crawl-timeout | 2 | SFOX-05 | balance-history/txn crawl bounded by asyncio.wait_for (FLIPRETRY-01 worker-wedge guard) | unit | `pytest tests/test_sfox_reconstruct.py -k timeout -q` | ⬜ |
| ground-truth-parity | 2 | SFOX-06 | reconstructed curve vs INDEPENDENT oracle (raw usd_value anchors + txn running account_balance); material divergence FAILS LOUD | unit+harness | `pytest tests/test_sfox_ground_truth.py -q` | ⬜ |
| live-parity | 2 | SFOX-06 | live prod-key parity (founder-gated on phase-121 egress) | live | skipIf(no key) `pytest tests/test_sfox_ground_truth_live.py -q` | ⬜ (human_needed) |

*Status: ⬜ pending · ✅ green · ❌ red*

---

## Wave 0 Requirements

- [ ] `analytics-service/tests/test_sfox_reconstruct.py` — the combine→TWR→backbone unit (mocked SfoxClient reads; known fixture NAV + flows → expected cashflow-neutral returns via an INDEPENDENT hand-derivation, P115)
- [ ] `analytics-service/tests/test_sfox_ground_truth.py` — the fixture parity oracle (usd_value vs txn running balance)
- [ ] `analytics-service/tests/test_sfox_ground_truth_live.py` — skipIf(no prod key) live parity

*Backbone (derive_basis_series), TWR engine (chain_linked_twr), and its degenerate guards already exist — sfox inherits them; no new backbone code.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Live prod ground-truth parity | SFOX-06 | Needs a real IP-whitelisted sFOX key + phase-121 egress; A2 (account_balance independence) + A3 (day-0 convention) resolve from this evidence run | Founder runs `sfox_ground_truth.py` against a real key; a material divergence must FAIL LOUD |

---

## Validation Sign-Off

- [ ] All tasks have automated verify or Wave 0 dependencies
- [ ] ONE backbone: no parallel metrics path (grep proves sfox routes through derive_basis_series)
- [ ] P115: parity oracle is economically independent (not the module's own transform)
- [ ] compute_metrics fails loud (corruption guard)
- [ ] crawl bounded by asyncio.wait_for (worker-wedge guard)
- [ ] `nyquist_compliant: true` set

**Approval:** pending
