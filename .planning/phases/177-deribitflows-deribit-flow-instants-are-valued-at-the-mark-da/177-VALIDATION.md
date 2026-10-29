---
phase: "177"
slug: "deribitflows-deribit-flow-instants-are-valued-at-the-mark-da"
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: "2026-10-28"
---

# Phase 177 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Source: 177-RESEARCH.md "## Validation Architecture" (the per-requirement test map there is authoritative; this file binds it to tasks once plans exist).

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | pytest 9.x (`asyncio_mode = auto`), vitest, SQL gates via `scripts/mutation-runner/run.mjs` |
| **Config file** | `analytics-service/pytest.ini`, `vitest.config.ts` |
| **Quick run command** | `cd analytics-service && python3 -m pytest tests/test_nav_marks_flow_instants.py tests/test_nav_marks_apply.py tests/test_nav_marks_derive_apply.py tests/test_nav_marks_compose_roundtrip.py tests/test_nav_marks_composite.py tests/test_flow_price_store.py -q` |
| **Full suite command** | `cd analytics-service && pytest -n auto --dist loadgroup --cov=services --cov=routers --cov=main_worker --cov-report=term-missing --cov-fail-under=80` |
| **Type gate** | `cd analytics-service && mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py` |
| **Estimated runtime** | ~60 seconds quick; several minutes full |

---

## Sampling Rate

- **After every task commit:** quick run command plus `pytest tests/test_deribit_ingest.py -k minute_prices`
- **After every plan wave:** quick run plus the mypy line; SQL gate file through the mutation runner when the migration changes
- **Before `/gsd-verify-work`:** full suite, mypy, census vitest files and one full mutation runner pass green
- **Max feedback latency:** 120 seconds

---

## Per-Task Verification Map

To be filled from the plans' task IDs. Requirement rows (SC-1, SC-2, SC-3) and their commands are listed in 177-RESEARCH.md "Phase Requirements -> Test Map".

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `analytics-service/tests/test_nav_marks_compose_roundtrip.py` — Deribit BTC moved-flow RED test (expected r(03-10) = 22.92/1171, RED at 22.42/1171), failure, 429, no-data, no-read, stored-price cases
- [ ] `analytics-service/tests/test_flow_price_store.py` — new store module tests
- [ ] New SQL gate file under `supabase/tests/` and the migration with its `down/` rollback
- [ ] `npm ci` in the worktree before running census vitest files

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Real moved-flow count after deploy | SC-1 | Needs PROD worker logs | Orchestrator reads `deribit flows moved by marks` lines after the next nightly derives |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 120s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
