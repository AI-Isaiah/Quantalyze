---
phase: "234"
slug: "nocapital-a-no-capital-key-takes-one-named-path-and-a-transient-read-never-drops-a-funded-key"
status: draft
nyquist_compliant: false
wave_0_complete: false
created: "2026-11-24"
---

# Phase 234 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Source: `234-RESEARCH.md` § Validation Architecture.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | pytest + pytest-asyncio (`analytics-service/pytest.ini`) |
| **Config file** | `analytics-service/pytest.ini` |
| **Quick run command** | `cd analytics-service && python3 -m pytest tests/test_allocator_equity_no_capital_exit.py tests/test_allocator_equity_inception.py -q -p no:cacheprovider && python3 -m pytest tests/test_derive_allocator_equity_job.py -k no_capital -q -p no:cacheprovider` |
| **Full suite command** | `cd analytics-service && python3 -m pytest tests/test_allocator_equity_*.py tests/test_e2_*.py tests/test_derive_allocator_equity_job.py tests/test_derive_refusal_rows.py -q -p no:cacheprovider` plus CI's strict mypy |
| **Estimated runtime** | ~80 seconds (quick) |

---

## Sampling Rate

- **After every task commit:** quick run command
- **After every plan wave:** full suite command plus `python3 -m mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py`
- **Before `/gsd-verify-work`:** full analytics pytest (CI pins ccxt 4.5.89) green
- **Max feedback latency:** 120 seconds

---

## Per-Task Verification Map

Filled by the planner per task. Requirement coverage: NOCAP-01, NOCAP-02, NOCAP-03, NOCAP-04 and the out-of-window ruling, per the RESEARCH map.

---

## Wave 0 Requirements

- [ ] Re-fixture the four MT5 candidate tests that carry no basis (RESEARCH finding 3)
- [ ] New fixtures: funded-ledger MT5 candidate, no-basis MT5 candidate, negative-terminal candidate, missing-terminals hole candidate, stated-tail-day replay book
- [ ] Pop-the-field helper for the two whole-payload equality tests

---

## Manual-Only Verifications

All phase behaviors have automated verification.

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 120s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
