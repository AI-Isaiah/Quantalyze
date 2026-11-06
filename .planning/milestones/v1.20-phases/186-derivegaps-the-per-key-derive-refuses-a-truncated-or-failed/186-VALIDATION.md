---
phase: "186"
slug: "derivegaps-the-per-key-derive-refuses-a-truncated-or-failed"
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: "2026-11-03"
---

# Phase 186 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Source: `186-RESEARCH.md` `## Validation Architecture`.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | pytest (`analytics-service/`, `asyncio_mode = auto`); vitest for the TS reader/census twins |
| **Config file** | `analytics-service/pytest.ini`, `analytics-service/pyproject.toml`, `vitest.config.ts` |
| **Quick run command** | from `analytics-service/`: `python -m pytest tests/<touched file> -q -x` |
| **Full suite command** | from `analytics-service/`: `python -m pytest -q` and `mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py`; TS: `npx vitest run` |
| **Estimated runtime** | ~5 s per touched file; full suites several minutes |

---

## Sampling Rate

- **After every task commit:** the touched test file plus the CI mypy line
- **After every plan wave:** `tests/test_derive_*`, `tests/test_exchange_harness.py`, `tests/test_funding_fetch.py`, `tests/test_trade_pages.py`, `tests/test_writer_residual_parity.py`, `tests/test_job_worker.py`, the TS twins, full mypy line
- **Before `/gsd-verify-work`:** full pytest, full mypy line, `npx vitest run`, `npm run lint`, typecheck
- **Max feedback latency:** ~60 seconds per task

---

## Per-Task Verification Map

Filled in by the plans; each SC maps to the tests below (RED on today's behaviour where stated).

| SC | Behavior | Test Type | Command | RED today? |
|----|----------|-----------|---------|------------|
| SC-1 | PROD counts recorded before code change (read-only) | manual/probe | marker query then SQL files; worker probe | n/a |
| SC-2 | truncated/failed realized or funding read refuses the key by name, writes nothing | job unit | `pytest tests/test_derive_broker_dailies_dualmode.py` | YES |
| D-06 | caps are module constants, deadline-bounded walk | exchange unit | `pytest tests/test_exchange_harness.py` | YES |
| SC-3 | Bybit internal transfer is a flow; no P&L spike vs independent TWR oracle | job unit | `pytest tests/test_derive_broker_dailies_dualmode.py -k unified` | YES |
| SC-4 | failing key exits the book on its own; rest draws; readers name the key | compose job + vitest | `pytest tests/test_derive_allocator_equity_job.py`; vitest twins | YES |
| SC-6 | refusal leaves prior rows untouched; uncomputable day is null | job unit | dualmode file | n/a |
| SC-7 | two legs in one hour kept (only if SC-1 finds pairs) | unit | `pytest tests/test_funding_fetch.py` | YES |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] SC-1 probe tooling and SQL (see RESEARCH `## SC-1 Measurement Design`)
- [ ] module-level cap constants + shared DQ-flag reader in `services/exchange.py`
- [ ] refusal-row / writer-residual fixture updates for the retired token
- [ ] `npm ci` (and a Python venv) in the worktree for the TS twins and pytest

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| PROD counts per gap | SC-1 | read-only PROD + venue API | marker query alone first, then counts |
| Post-deploy PROD reading | SC-5 | needs the deployed worker | re-read the counts after deploy |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
