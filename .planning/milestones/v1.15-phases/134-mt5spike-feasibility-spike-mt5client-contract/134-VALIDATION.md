---
phase: 134
slug: mt5spike-feasibility-spike-mt5client-contract
status: planned
nyquist_compliant: true
wave_0_complete: false
created: 2026-07-23
---

# Phase 134 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | pytest 7.x (analytics-service) |
| **Config file** | analytics-service/pyproject.toml / pytest.ini |
| **Quick run command** | `cd analytics-service && pytest tests/test_mt5_client_contract.py -x` |
| **Full suite command** | `cd analytics-service && pytest -q` |
| **Estimated runtime** | ~5 seconds (contract file); full suite minutes |

---

## Sampling Rate

- **After every task commit:** Run the quick run command
- **After every plan wave:** Run the full suite command
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 10 seconds (contract file)

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 134-01/T1 | 134-01 | 1 | MT5GW-02 | T-134-01, T-134-04, T-134-05 | fail-loud None≠(); secret scrub; dual-timeout ordering; lazy mt5linux import | unit (TDD) | `cd analytics-service && pytest tests/test_mt5_client_contract.py -x -q` | ❌ W0 (task creates) | ⬜ pending |
| 134-01/T2 | 134-01 | 1 | MT5GW-02 | T-134-02 | structural read-only: parametrized forbidden surface + exact public surface + no __getattr__ | unit (TDD) | `cd analytics-service && pytest tests/test_mt5_client_contract.py -x -q && grep -c "order_send(" services/mt5_client.py` (=0) | ❌ W0 (task creates) | ⬜ pending |
| 134-02/T1 | 134-02 | 2 | MT5SPIKE-01 | T-134-06, T-134-07 | harness never touches trade path; sanitized report; None-error never coerced to zero deals | unit (TDD, offline via injected client_factory) | `cd analytics-service && pytest tests/test_mt5_spike_harness.py -x -q` | ❌ W0 (task creates) | ⬜ pending |
| 134-02/T2 | 134-02 | 2 | MT5SPIKE-01 | T-134-08, T-134-09 | go/no-go template: human_needed placeholders, escape hatch, private-network constraint, normalization note | doc grep gates | `grep -c "human_needed" analytics-service/docs/mt5-spike-gonogo.md` (>=6) + Windows VPS / private network / combine_mt5_deal_ledger greps | ❌ W0 (task creates) | ⬜ pending |
| 134-03/T1 | 134-03 | 3 | MT5GW-02 | T-134-SC | package legitimacy human gate (blocking, never auto-approvable) | checkpoint:human-verify | — (human approval) | n/a | ⬜ pending |
| 134-03/T2 | 134-03 | 3 | MT5GW-02 | T-134-SC | exact pin lands via make lock; clean lock diff; lazy-import guard still green | unit + grep | `grep -q "^mt5linux==1.0.3" analytics-service/requirements.in && grep -q "rpyc==5.2.3" analytics-service/requirements.txt && cd analytics-service && pytest -q` | requirements.in ✅ exists | ⬜ pending |
| 134-03/T3 | 134-03 | 3 | MT5SPIKE-01 | T-134-10..12 | four live legs founder-run OR recorded human_needed — never claimed done | checkpoint:human-verify (`human_needed`) | — (founder runs `python -m scripts.mt5_spike`) | n/a | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `analytics-service/tests/test_mt5_client_contract.py` — offline RPyC-double contract tests for MT5GW-02 (created by plan 134-01 Task 1, TDD tests-first)
- [ ] In-memory RPyC-shaped double / fixture (`_FakeNamedTuple` + `_FakeMt5` + `_connect_factory`) — no live terminal, no Windows-only import (plan 134-01 Task 1)
- [ ] `analytics-service/tests/test_mt5_spike_harness.py` — offline harness tests via injected `client_factory` (plan 134-02 Task 1, TDD tests-first)

*Refined against the final plan set 2026-07-23. TDD ordering inside each task = the Wave 0 discipline: failing tests land before implementation.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Unattended Wine auto-login reliability (repeated login→read cycles) | MT5SPIKE-01 | Needs founder demo creds + running gmag11 v2.3 gateway container | Run `scripts/mt5_spike.py` against demo account; record go/no-go |
| `order_check` investor-vs-master read-only distinction (no `order_send`) | MT5SPIKE-01 | Needs a live master + investor login pair | Spike harness reports retcode/ trade_allowed distinction |
| `history_deals_get` deal-reconstruction viability + None≠() on live data | MT5SPIKE-01 | Needs real broker deal history | Spike harness dumps deals + BALANCE flows |
| Broker-server-time-vs-UTC offset established | MT5SPIKE-01 | Broker-specific server tz | Spike harness prints server time vs UTC; doc normalization |

*The four MT5SPIKE-01 live legs are `human_needed` — harness + runbook land now; founder executes.*

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies (checkpoints 134-03/T1,T3 are human gates by design — MT5SPIKE-01 live legs are `human_needed`)
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (TDD tests-first inside each task)
- [x] No watch-mode flags
- [x] Feedback latency < 10s (contract file ~5s)
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** planner 2026-07-23 (plans 134-01..03)
