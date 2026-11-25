---
phase: "232"
slug: "okxtrades"
status: draft
nyquist_compliant: false
wave_0_complete: false
created: "2026-11-24"
---

# Phase 232 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Source: 232-RESEARCH.md `## Validation Architecture`.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | pytest (<9.2) + pytest-asyncio (`asyncio_mode = auto`) |
| **Config file** | `analytics-service/pytest.ini` |
| **Quick run command** | `cd analytics-service && python -m pytest tests/test_exchange_harness.py tests/test_daily_pnl_read_verdict.py tests/test_sync_trades_resume_seed.py -q` |
| **Full suite command** | `cd analytics-service && python -m pytest tests/test_exchange.py tests/test_cron_router.py tests/test_job_worker.py tests/test_derive_broker_dailies_dualmode.py tests/test_okx_archive_apply.py tests/test_okx_archive_parse.py tests/test_walletoffset_probe.py tests/test_derivegaps_probe.py tests/test_ana_recon_audit.py tests/test_mt5_sync_path.py tests/test_writer_residual_parity.py tests/test_derive_allocator_equity_job.py tests/test_job_worker_flipretry.py -q` plus `mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py` |
| **Estimated runtime** | ~16 s quick, ~65 s affected set |

CI pins ccxt 4.5.89 (`analytics-service/requirements.txt`); test against it.

---

## Sampling Rate

- **After every task commit:** quick run command plus the plan's new test file
- **After every plan wave:** affected-set command and the mypy command
- **Before `/gsd-verify-work`:** full suite + mypy green; PROOF-01 transcript in each plan SUMMARY
- **Max feedback latency:** 70 seconds per task command (the widened affected sets measured 13 s for their added files at `abcd9d8ab`); the one exception is 232-04 Task 3's whole-suite diff, minutes long, run twice in the background

---

## Per-Task Verification Map

Filled by the planner per task. Requirement to test file map: VREAD-06 → `tests/test_okxtrades_ccy.py` (+ verdict, derive and cron registration edits); VREAD-07 → `tests/test_okxtrades_walk.py` (+ cron prefix arms in `tests/test_cron_router.py`); VREAD-08 → `tests/test_okxtrades_cursor.py`.

Every command runs from the checkout root under the worktree's CI-pinned `analytics-service/.venv` (ccxt 4.5.89, bootstrapped by each plan's Task 1). `MYPY` = `cd analytics-service && .venv/bin/python -m mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py`.

| Task | Wave | Req | Arms (RED first) | Automated command (`cd analytics-service && .venv/bin/python -m pytest ... -q -p no:cacheprovider`) | Status |
|------|------|-----|------------------|------------------------------------------------------------------------------------------------------|--------|
| 232-01 T1 (tracer) | 1 | VREAD-08 | refused read holds, stamp = newest stored fill | `tests/test_okxtrades_cursor.py` | ⬜ |
| 232-01 T2 | 1 | VREAD-08 | ahead clamp, Q1 seed table, bootstrap anchor, Q7 hold, two refuse-then-clean sequences | `tests/test_okxtrades_cursor.py tests/test_sync_trades_resume_seed.py` + `MYPY` | ⬜ |
| 232-01 T3 | 1 | VREAD-08, PROOF-01 | flips, formula test driven through the job, MT5 arm leaves the column untouched, partial-batch hold left green, N1..N7 | the plan's affected-set command (the `run_sync_trades_job` / fills-cursor census) + `MYPY` | ⬜ |
| 232-02 T1 (tracer) | 1 | VREAD-07 | long first window completes, caps pinned at 100, windows day-aligned | `tests/test_okxtrades_walk.py tests/test_okx_archive_parse.py` | ⬜ |
| 232-02 T2 | 1 | VREAD-07 | whole-window stops, ticks complete, self-checks, age routing, edges, reach clamp | `tests/test_okxtrades_walk.py tests/test_okx_archive_parse.py tests/test_okx_bills_backoff.py` + `MYPY` | ⬜ |
| 232-02 T3 | 1 | VREAD-07, PROOF-01 | re-fixtures, calendar rot, N1..N8 | the plan's affected-set command + `MYPY` | ⬜ |
| 232-03 T1 (tracer) | 2 | VREAD-06 | mixed-currency day refused, named by the cron reader | `tests/test_okxtrades_ccy.py tests/test_daily_pnl_read_verdict.py` | ⬜ |
| 232-03 T2 | 2 | VREAD-06 | currency arms, derive permanent refusal, parity matrix 960, cron FLAGS | `tests/test_okxtrades_ccy.py tests/test_daily_pnl_read_verdict.py tests/test_derive_broker_dailies_dualmode.py tests/test_cron_router.py` + `MYPY` | ⬜ |
| 232-03 T3 | 2 | VREAD-06, PROOF-01 | ccy-less fixtures, N1..N8 | the plan's affected-set command + `MYPY` | ⬜ |
| 232-04 T1 (tracer) | 3 | VREAD-07 | long first window completes across cron ticks inside the key budget; catch-up heartbeat rows name only `held=1`, the completing row is `ok` | `"tests/test_cron_router.py::TestAnOkxPrefixIsStoredAndHeld"` | ⬜ |
| 232-04 T2 | 3 | VREAD-07 | prefix stored and held, empty prefix, present marker, venue split, degraded wins | `tests/test_cron_router.py` + `MYPY` | ⬜ |
| 232-04 T3 | 3 | VREAD-07, PROOF-01 | N1..N6, runbook corrections, whole-suite failure diff against the phase base | the phase affected-set command + `MYPY` + the whole analytics suite at HEAD and at `git merge-base HEAD origin/main` (no failure new at HEAD) | ⬜ |

Wave 0 is folded into the plans: each new test file is written by its plan's first task, RED before any code.

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/test_okxtrades_ccy.py`, `tests/test_okxtrades_walk.py`, `tests/test_okxtrades_cursor.py`
- [ ] Re-fixture the OKX harness tests named in RESEARCH "Tests that flip or rot", the two `tests/test_exchange.py` ccy-less fixtures, the walletoffset calendar rot

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| PROOF-01 neuter → RED → `cp` restore → `cmp` → GREEN | all | a procedure on the source, recorded verbatim | RESEARCH PROOF-01 neuter table |
| Post-merge PROD repeated read: keys ahead of newest stored fill | VREAD-08 | needs PROD, after the coordinator's repair decision | marker query first, counts only |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 70s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
