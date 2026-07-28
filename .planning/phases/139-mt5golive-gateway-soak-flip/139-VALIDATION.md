---
phase: 139
slug: mt5golive-gateway-soak-flip
status: planned
nyquist_compliant: true
wave_0_complete: false
created: 2026-07-24
---

# Phase 139 — Validation Strategy

> Substance verified by the plan-checker (8a–8d pass); this satisfies 8e. Wave 1 is
> offline-testable; Wave 2 is founder LIVE ops (`human_needed`, evidence founder-produced).

## Test Infrastructure
| Property | Value |
|----------|-------|
| Framework | pytest 7.x (analytics-service) |
| Quick run | `cd analytics-service && pytest tests/test_mt5_soak.py -x -q` |
| Full suite | `cd analytics-service && pytest -q` (CI coverage gate `--cov-fail-under=80`) |
| Runtime | ~5s (soak test); full suite minutes |

## Per-Task Verification Map
| Task | Plan | Wave | Requirement | Verify | Status |
|------|------|------|-------------|--------|--------|
| 139-01/T1 | 139-01 | 1 | MT5GOLIVE-02 | `pytest tests/test_mt5_soak.py -x -q` (compose 134+136; $2-drift neg control; INCONCLUSIVE-on-empty; fail-loud None≠(); secret sanitize) | ⬜ |
| 139-01/T2 | 139-01 | 1 | MT5GOLIVE-02 | soak-log section in mt5-spike-gonogo.md; full-suite regression | ⬜ |
| 139-02/T1 | 139-02 | 1 | MT5GW-01, MT5GOLIVE-01/02 | runbook grep gates: PRIVATE NETWORK ONLY, GATE-CHECK list, exact flip commands, rollback, Railway-primary/dual-stack, no auto-update-disable | ⬜ |
| 139-02/T2 | 139-02 | 1 | MT5GOLIVE-01 | config templates reference verified ports 8001/3000, /config volume, env vars; private-only binding | ⬜ |
| 139-03/T1-3 | 139-03 | 2 | MT5GW-01, MT5GOLIVE-01/02 | `checkpoint:human-verify gate="blocking-human"` — hosting decision+A2 / broker onboard+soak / gate-check+flip+prod verify | ⬜ human_needed |

## Wave 0 Requirements
- `analytics-service/tests/test_mt5_soak.py` created in 139-01 Task 1 (tdd) — no external framework.

## Manual-Only Verifications (the founder LIVE legs — human_needed)
| Behavior | Why Manual |
|----------|------------|
| Prod gateway stand-up (hosting decision + A2 dual-stack check + VNC install + investor login + private network) | Founder hosting decision + VNC + LIVE infra |
| Real broker investor account onboard + soak to parity | Needs a real broker account + N-day soak window |
| LIVE flag flip (Railway MT5_ENABLED + Vercel NEXT_PUBLIC_MT5_ENABLED) + prod verify across roles | LIVE env ops after every gate green |

## Validation Sign-Off
- [x] Wave-1 impl tasks have automated pytest verify (8a)
- [x] No E2E/watch-mode latency traps; soak test is a fast offline unit (8b)
- [x] Continuous sampling (8c)
- [x] No dangling Wave-0 refs — soak test created in 139-01 (8d)
- [x] `nyquist_compliant: true`
- [x] Live legs modeled as blocking human-verify checkpoints — never claimed done

**Approval:** orchestrator 2026-07-24
