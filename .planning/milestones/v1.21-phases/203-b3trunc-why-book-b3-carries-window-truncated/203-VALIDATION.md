---
phase: "203"
slug: "b3trunc-why-book-b3-carries-window-truncated"
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: "2026-11-07"
---

# Phase 203 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | pytest (asyncio_mode = auto) |
| **Config file** | analytics-service/pytest.ini, analytics-service/pyproject.toml |
| **Quick run command** | `cd analytics-service && python3 -m pytest tests/test_e2_equity_curve_layer.py -q` |
| **Full suite command** | `cd analytics-service && python3 -m pytest tests/test_e2_equity_curve_layer.py tests/test_allocator_equity_writer_basis.py -q` (CI runs the full suite in the `python` job) |
| **Estimated runtime** | ~10 seconds |

---

## Sampling Rate

- **After every task commit:** Run the quick run command
- **After every plan wave:** Run the full suite command, plus mypy strict as the `python` job's "Type gate - mypy strict over the running-service surface" step runs it
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

Filled by the planner per plan task (see each PLAN.md `<verify>`).

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 203-01-01 | 01 | 1 | RESID-02 | — | N/A | unit | `python3 -m pytest tests/test_e2_equity_curve_layer.py -q -k staggered_starts` | ❌ W0 | ⬜ pending |
| 203-01-02 | 01 | 1 | RESID-02 | T-203-01 | report carries labels only, no uuids | doc grep | `grep -a "allocator_equity_curve" .planning/phases/203-*/203-REPORT.md` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `analytics-service/tests/test_e2_equity_curve_layer.py` — staggered-starts characterization test (new test in an existing file), with neuter-to-RED recorded
- [ ] `.planning/phases/203-b3trunc-why-book-b3-carries-window-truncated/203-REPORT.md` — the record

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| The report explains b3's flag as intended and closes 202's `unexplained` | RESID-02 | a written explanation | read 203-REPORT.md against the rule in `allocator_equity_curve` |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
