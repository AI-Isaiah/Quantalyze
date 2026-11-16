---
phase: "215"
slug: "testreach-every-test-that-guards-money-math-or-error-contrac"
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: "2026-11-15"
---

# Phase 215 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Source: 215-RESEARCH.md `## Validation Architecture`.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | pytest 9 (+ pytest-xdist in CI), vitest (Node 22), mypy strict |
| **Config file** | `analytics-service/pytest.ini`, `vitest.config.ts`, `analytics-service/pyproject.toml` `[tool.mypy]` |
| **Quick run command** | from `analytics-service/`: `python3 -m pytest -p no:cacheprovider -q tests/<file>.py`; TS: `PATH=/opt/homebrew/opt/node@22/bin:$PATH npx vitest run <files>` |
| **Full suite command** | from `analytics-service/`: `python3 -m pytest -q` (serial locally; CI runs `-n auto --dist loadgroup`); repo root: `PATH=/opt/homebrew/opt/node@22/bin:$PATH npm test` |
| **Estimated runtime** | quick ~10 s; full pytest ~15 min serial; npm test ~10 min |

---

## Sampling Rate

- **After every task commit:** the touched module's quick command; mypy strict (`mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py`) when `services/`, `routers/` or `main.py` changed.
- **After every plan wave:** full pytest plus the touched vitest files.
- **Before `/gsd-verify-work`:** full suite green; never run the 21 FastAPI modules together as a subset (20 baseline failures from shared limiter state).
- **Max feedback latency:** 60 seconds per task.

---

## Per-Task Verification Map

Filled by the planner per task; the SC map in 215-RESEARCH.md `### Phase Requirements -> Test Map` is the source.

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `node_modules` in the worktree (`npm ci`) before any vitest/tsc command
- [ ] New test files named in 215-RESEARCH.md `### Wave 0 Gaps`

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Revert-RED proof per fix | SC-9 | needs a deliberate neuter | back up the file bytes, neuter the fix, run the pin and see RED, restore from the byte backup (never git checkout/restore/stash) |
| SC-2 cases green on the lane | SC-2 | needs a booted local-stack lane or the CI `python` job | read the CI `python` job log on the PR head SHA |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
