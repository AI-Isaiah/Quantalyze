---
phase: "222"
slug: "alerttruth-python-and-sql-error-copy-and-portfolio-benchmark"
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: "2026-11-25"
---

# Phase 222 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. The test map, sampling
> rate and PROOF-01 table live in `222-RESEARCH.md` `## Validation Architecture`; plans bind each
> task to one row of it.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | pytest (analytics-service, py3.12, ccxt 4.5.89 pin), vitest (repo root), psql SQL gates on the local-stack lane |
| **Config file** | `analytics-service/pytest.ini`, `vitest.config.ts` |
| **Quick run command** | `cd analytics-service && .venv/bin/pytest tests/<file>.py -x -q` / `npx vitest run <file>` |
| **Full suite command** | CI pytest (`pytest -n auto --dist loadgroup ...`), CI `mypy --strict ...`, `npx vitest run`, local-stack `supabase/tests` corpus |
| **Estimated runtime** | ~600 seconds (machine under load) |

---

## Sampling Rate

- **After every task commit:** the single named test file for that task
- **After every plan wave:** the per-wave set in RESEARCH `### Sampling Rate`
- **Before `/gsd-verify-work`:** full suite green, including the whole `supabase/tests` corpus on the lane
- **Max feedback latency:** 600 seconds

---

## Per-Task Verification Map

Filled by the plans (each task's `<automated>` + `<fails_when>`). See RESEARCH `### Phase Requirements -> Test Map`.

---

## Wave 0 Requirements

- [ ] `analytics-service/tests/test_no_contact_support_copy.py` — ERRC-01 Python gate
- [ ] `analytics-service/tests/test_sync_trades_enqueue_failure_bridge_live.py` — ERRC-03 through-the-bridge gate
- [ ] pinned Python venv in the worktree (`make install`)

---

## Manual-Only Verifications

All phase behaviors have automated verification.

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 600s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
