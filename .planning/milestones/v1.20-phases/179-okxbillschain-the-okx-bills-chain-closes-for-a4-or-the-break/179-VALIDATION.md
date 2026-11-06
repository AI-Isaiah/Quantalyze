---
phase: "179"
slug: "okxbillschain-the-okx-bills-chain-closes-for-a4-or-the-break"
status: draft
nyquist_compliant: false
wave_0_complete: false
created: "2026-10-28"
---

# Phase 179 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Source: `179-RESEARCH.md` `## Validation Architecture`.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | pytest, `asyncio_mode = auto` |
| **Config file** | `analytics-service/pytest.ini` |
| **Quick run command** | `cd analytics-service && python3 -m pytest tests/test_okx_opening_balance.py tests/test_okx_anchor_rule.py tests/test_okx_bills_chain.py tests/test_okx_chain_record.py tests/test_allocator_history_probe.py -x -q` |
| **Full suite command** | `cd analytics-service && python3 -m pytest -q` plus `mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py` |
| **Estimated runtime** | ~60 seconds (quick), several minutes (full) |

---

## Sampling Rate

- **After every task commit:** Run the quick run command
- **After every plan wave:** Run the full suite command and the mypy line
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 120 seconds

---

## Per-Task Verification Map

Filled by the planner per task (`<automated>` + `<fails_when>`). The SC-to-test map is in `179-RESEARCH.md` `### Phase Requirements -> Test Map`; the neuter-and-restore mutations N1..N10 are listed there.

---

## Wave 0 Requirements

- [ ] `analytics-service/tests/test_okx_bills_chain.py` — SC-1 (new)
- [ ] `analytics-service/tests/test_okx_chain_record.py` — SC-1 vocabulary and redaction (new)
- [ ] Extend `analytics-service/tests/_okx_bills.py` additively (ties, inversions, 7-day `bills` fake, subtypes fake, balance sequence, `uTime`/`subType`/`mgnMode`/`posBalChg`), default-off
- [ ] One appended end-to-end test at the END of `analytics-service/tests/test_allocator_history_probe.py`

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| The deployed probe on a4 prints a `chain_arm` other than `not-run` | SC-1 | PROD read on the Railway backfill worker; founder approval per run | Operator checkpoint, 172 plan 05 delivery pattern |
| Post-deploy re-read of a4 and the tolerance decision | SC-3 | PROD read plus founder decision | Operator checkpoint after the fix ships |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 120s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
