---
phase: 137
slug: mt5conc-concurrency-terminal-hardening
status: planned
nyquist_compliant: true
wave_0_complete: false
created: 2026-07-23
---

# Phase 137 — Validation Strategy

> Per-phase validation contract. Substance verified by the plan-checker (8a–8d pass);
> this file satisfies the 8e artifact gate. All behaviors are offline-provable against the
> Phase-134 `_connect` / `_FakeMt5Transport` double — NO live broker.

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | pytest 7.x (analytics-service) |
| **Quick run** | `cd analytics-service && pytest tests/test_mt5_derive_branch.py tests/test_mt5_client_contract.py -x -q` |
| **Full suite** | `cd analytics-service && pytest -q` (coverage gate `--cov-fail-under=80`) |
| **Estimated runtime** | ~6s (mt5 files); full suite minutes |

## Sampling Rate
- After every task commit: quick run. After each wave / before verify: full suite. Max latency ~10s (mt5 files).

## Per-Task Verification Map

| Task | Plan | Wave | Requirement | Secure Behavior | Automated Command | Status |
|------|------|------|-------------|-----------------|-------------------|--------|
| 137-01/T1 | 137-01 | 1 | MT5CONC-01 | `Mt5Client.restart()` bounded shutdown+reconnect | `pytest tests/test_mt5_client_contract.py -k restart -q` | ⬜ |
| 137-01/T2 | 137-01 | 1 | MT5CONC-01 | hung terminal → wait_for → restart invoked → transient re-queue; loop/healthz live; restart itself bounded | `pytest tests/test_mt5_derive_branch.py -k "hang or restart" -q` | ⬜ |
| 137-02/T1 | 137-02 | 2 | MT5CONC-02 | module-level per-terminal lock (host:port); two concurrent syncs cannot interleave | `pytest tests/test_mt5_derive_branch.py -k "lock or concurrent" -q` | ⬜ |
| 137-02/T2 | 137-02 | 2 | MT5CONC-02 | `account_info()["login"]==expected` pre+post; mismatch → transient+restart+persist-NOTHING; `Mt5AccountMismatchError` not absorbed by classify/stamp arm | `pytest tests/test_mt5_derive_branch.py -k "login or mismatch" -q` | ⬜ |
| 137-02/T3 | 137-02 | 2 | MT5CONC-01/02 | full-suite phase gate (no regressions) | `pytest -q` | ⬜ |

*Status: ⬜ pending · ✅ green · ❌ red*

## Wave 0 Requirements
- Existing `test_mt5_derive_branch.py` + `test_mt5_client_contract.py` doubles are extended in-place (add `"login"` field + hang injection + lock-reset autouse fixture). No new framework.

## Manual-Only Verifications
| Behavior | Why Manual |
|----------|------------|
| Live terminal restart against a real hung Wine terminal | Needs the Phase-139 gateway; offline double is authoritative for the wiring. A1/A2 `[ASSUMED]` gated to 139. |

## Validation Sign-Off
- [x] All impl tasks have automated pytest verify (8a)
- [x] No E2E/watch-mode latency traps (8b)
- [x] Continuous sampling across both waves (8c)
- [x] No dangling Wave-0 references — doubles extended in-place (8d)
- [x] `nyquist_compliant: true`

**Approval:** planner/orchestrator 2026-07-23
