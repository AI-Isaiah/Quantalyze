---
phase: "231"
slug: "bybitreads-a-bybit-read-covers-every-coin-settle-type-window"
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: "2026-11-23"
---

# Phase 231 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Source: 231-RESEARCH.md `## Validation Architecture`.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | pytest (<9.2), pytest-asyncio `asyncio_mode = auto`, xdist, cov |
| **Config file** | `analytics-service/pytest.ini` |
| **Quick run command** | `cd analytics-service && python3 -m pytest tests/test_upnl_venues.py tests/test_positions.py -q -p no:cacheprovider` |
| **Full suite command** | `cd analytics-service && pytest -n auto --dist loadgroup --cov=services --cov=routers --cov=main_worker --cov-report=term-missing --cov-fail-under=80` |
| **Type gate** | `cd analytics-service && mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py` |
| **Estimated runtime** | quick ~20 s; full suite several minutes |

---

## Sampling Rate

- **After every task commit:** the new or flipped test file, `-q -p no:cacheprovider`
- **After every plan wave:** `tests/test_exchange.py tests/test_positions.py tests/test_upnl_venues.py tests/test_nav_marks_bybit_uta.py tests/test_nav_marks_l4_read.py tests/test_allocator_positions.py tests/test_derivegaps_probe.py` plus the mypy type gate
- **Before `/gsd-verify-work`:** full suite green
- **Max feedback latency:** 60 seconds for the per-task sample

---

## Per-Task Verification Map

Filled by the planner per task; the requirement-level map is:

| Requirement | Behavior | Test Type | Automated Command | File Exists | Status |
|-------------|----------|-----------|-------------------|-------------|--------|
| VREAD-01 | derive anchor == stable-coin wallet sum, wedge 0.0, reconstruct == derive + uPnL | unit (real parse_balance) | `pytest tests/test_upnl_venues.py -q -p no:cacheprovider -k coin_coverage` | ✅ flip | ⬜ pending |
| VREAD-01 | one shared constant (`price_rule._STABLE_VALUE`) | unit | `pytest tests/test_upnl_venues.py -q -k shared_stable_set` | ❌ W0 | ⬜ pending |
| VREAD-01 | USDC mark admitted, non-stable still `wallet_basis_mismatch` | unit | `pytest tests/test_nav_marks_l4_read.py -q` | ❌ add case | ⬜ pending |
| VREAD-02 | settleCoin USDT, USDC and inverse requested on ccxt and raw paths, limit + cursor | unit | `pytest tests/test_positions.py -q -k bybit` | ❌ W0 | ⬜ pending |
| VREAD-02 | symbols, USD fields, inverse uPnL at mark, unusable mark refuses | unit (real parse_position) | `pytest tests/test_positions.py -q -k "inverse or usdc"` | ❌ W0 | ⬜ pending |
| VREAD-03 | old start returns every fill in 7-day windows; cap hit raises named error | unit (venue-rule fake) | `pytest tests/test_exchange.py -q -k "bybit and window"` | ❌ W0 | ⬜ pending |
| VREAD-04 | `replace` and pairing rule pinned; verdict recorded | unit | `pytest tests/test_derive_broker_dailies_dualmode.py tests/test_bybit_unified_flows.py -q -k "unified or pair"` | ✅ | ⬜ pending |
| VREAD-03/04 | probe vocabulary, redaction, read-only view, fingerprint | unit | `pytest tests/test_bybitreads_probe.py -q` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/test_bybitreads_probe.py`
- [ ] shared offline real-market fixture helper (cassette to ccxt markets)
- [ ] params-aware `_fake_bybit`
- [ ] venue-rule `execution_list` fake

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Founder confirms the egress allow-list (or removal of the IP binding) with its date; derive stays `done` | VREAD-05 | exchange settings and Railway networking are founder-only | orchestrator relays the question; counts-only PROD read of the key's derive jobs after |
| Probe run on the Railway backfill worker | VREAD-03/04 evidence | needs decrypted keys inside the worker | orchestrator runs it via a temporary start command, restores and verifies the start command |
| PROOF-01 RED/GREEN record per gate | all | protocol, recorded verbatim in each SUMMARY | neuter, RED on named arm, `cp` back + `cmp`, GREEN |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
