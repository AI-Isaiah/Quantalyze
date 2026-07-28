---
phase: 73
slug: pure-nav-twr-core
status: approved
nyquist_compliant: true
wave_0_complete: true
created: 2026-07-05
---

# Phase 73 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | pytest (analytics-service) |
| **Config file** | `analytics-service/pytest.ini` / `pyproject.toml` |
| **Quick run command** | `cd analytics-service && <CI-3.12 venv>/bin/python -m pytest tests/test_nav_twr.py tests/test_metrics_parity.py -q` |
| **Full suite command** | `cd analytics-service && <CI-3.12 venv>/bin/python -m pytest -q` |
| **Estimated runtime** | ~30–90s (targeted); full suite minutes |

⚠️ **Interpreter constraint (from RESEARCH Pitfall 3):** the local `.venv` is Python 3.14 and **SIGSEGVs** at pytest collection in native pandas tslibs (numpy 2.4.6 vs pandas 2.2.3). Run against the CI-matching 3.12/3.13 pinned venv:
`/private/tmp/claude-501/-Users-helios-mammut-claude-projects-quantalyze/fcce1bd5-15ef-4e42-adb9-85cfc9ad484c/scratchpad/venv312/bin/python`. Coverage gate runs in CI.

---

## Sampling Rate

- **After every task commit:** Run the quick command (targeted `test_nav_twr.py` + `test_metrics_parity.py`).
- **After every plan wave:** Run the full analytics suite.
- **Before `/gsd:verify-work`:** Full suite green in the 3.12 venv.
- **Max feedback latency:** ~90s (targeted).

---

## Per-Task Verification Map

*Filled by gsd-planner per task. Each task covering TWR-01/02/05/DQ-01 must carry an `<automated>` pytest command. Key anchors from RESEARCH:*

| Task ID | Plan | Wave | Requirement | Secure Behavior | Test Type | Automated Command | Status |
|---------|------|------|-------------|-----------------|-----------|-------------------|--------|
| (planner) | 01 | 1 | TWR-01 | backward NAV reconstruction; numpy-pinned oracle to fp precision | unit | `pytest tests/test_nav_twr.py -q` | ⬜ pending |
| (planner) | 01 | 1 | TWR-02 | chain-linked TWR + edge cases (same-day multi-flow, day-0, zero-NAV, partial window) | unit | `pytest tests/test_nav_twr.py -q` | ⬜ pending |
| (planner) | 01 | 1 | DQ-01 | every denominator fail-loud; source-scan forbids clamp/floor/replace(0,…) | unit + source-scan | `pytest tests/test_nav_twr.py -q` | ⬜ pending |
| (planner) | 02 | 1 | TWR-05 | CAGR/Calmar on calendar clock, Sharpe unchanged (rescale-proof) | unit | `pytest tests/test_metrics_parity.py -q` (extends L994-1052 template) | ⬜ pending |
| (planner) | 01 | 1 | SC-4 pin | F=0 byte-identity vs today's `trades_to_daily_returns_with_status` (account with `balance−Σpnl > $1000`) | regression | `pytest tests/test_nav_twr.py::test_zero_flow_byte_identical -q` | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/test_nav_twr.py` — new; stubs for TWR-01/02 + DQ-01 (revert-proof, modeled on `test_deribit_txn.py`).
- [ ] Extend `tests/test_metrics_parity.py` — TWR-05 rescale proof reuses the existing L994-1052 template (CAGR changes by the expected 365/252 factor; Sharpe unchanged).
- [ ] Fixtures: a byte-identity account (`balance − Σpnl > $1000`), an `≤0` account (must FLAG not substitute), a 365-day series for the annualization proof.

---

## Manual-Only Verifications

*None — all Phase 73 behaviors (pure math + annualization) have automated verification. (Live-account acceptance is Phase 78, not here.)*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 90s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
