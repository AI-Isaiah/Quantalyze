---
phase: "223"
slug: "flowkinds-every-derive-and-compose-path-reads-the-same-capit"
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: "2026-11-24"
---

# Phase 223 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Source: `223-RESEARCH.md` `## Validation Architecture`.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | pytest (`pytest<9.2`, `asyncio_mode = auto`) |
| **Config file** | `analytics-service/pytest.ini` |
| **Quick run command** | `cd analytics-service && python -m pytest tests/test_job_worker_sync_funding.py tests/test_job_worker_funding_cursor.py tests/test_funding_fetch.py tests/test_bybitreads_census_pins.py tests/test_okx_archive_apply.py tests/test_okx_archive_job.py tests/test_daily_pnl_read_verdict.py -q -p no:cacheprovider` |
| **Full suite command** | `cd analytics-service && python -m pytest -n auto --dist loadgroup --cov=services --cov=routers --cov=main_worker --cov-report=term-missing --cov-fail-under=80` |
| **Type gate** | `cd analytics-service && mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py` |
| **Estimated runtime** | ~60 seconds (quick), several minutes (full) |

---

## Sampling Rate

- **After every task commit:** Run the quick run command on the files touched
- **After every plan wave:** Run the quick run command (all 7 files) plus the type gate
- **Before `/gsd-verify-work`:** Full suite and type gate must be green
- **Max feedback latency:** 90 seconds

---

## Per-Task Verification Map

Filled by the planner per plan. Requirement map:

| Req / SC | Behavior | Test Type | Automated Command | File Exists | Status |
|----------|----------|-----------|-------------------|-------------|--------|
| FLOWK-02 / SC-1 (okx) | malformed live OKX funding row → `live_anchor_unusable live_funding=malformed`, no write | integration | `pytest tests/test_okx_archive_apply.py -k malformed_live_funding` | ❌ W0 | ⬜ pending |
| FLOWK-02 / SC-1 (sync_funding) | `run_sync_funding_job` drops a malformed row per venue, DONE | unit | `pytest tests/test_job_worker_sync_funding.py -k malformed` | ❌ W0 | ⬜ pending |
| SC-5 | cancelled Bybit walk keeps finished windows; resume from newest stored minus 2 d; ascending slices; stop at first failing slice | integration | `pytest tests/test_job_worker_sync_funding.py -k c27` | ❌ W0 | ⬜ pending |
| SC-5 | `until_ms` bounds the fetcher; window helper matches a full walk | unit | `pytest tests/test_funding_fetch.py -k until_ms` | ❌ W0 | ⬜ pending |
| SC-5 | 231 C27 pin stays true | unit | `pytest tests/test_bybitreads_census_pins.py` | ✅ | ⬜ pending |
| FLOWK-03 / SC-2 | malformed realized row is a flag, not a refusal | unit | `pytest tests/test_daily_pnl_read_verdict.py -k malformed` | ✅ | ⬜ pending |
| SC-3 | TODOS entries deleted, CHANGELOG names them | grep | `grep -a -c "186-OTHER-FUNDING-CALLERS-DROP\|186-REALIZED-MALFORMED-COUNT" TODOS.md` → 0 | n/a | ⬜ pending |

Per plan and task (planner, 2026-11-24). Every command runs from the checkout root as `cd analytics-service && python -m pytest <target> -q -p no:cacheprovider` unless it is the mypy or full-suite command.

| Plan-Task | Wave | Req / SC | Automated target | PROOF-01 neuter |
|-----------|------|----------|------------------|-----------------|
| 223-01-T1 (tracer) | 1 | FLOWK-02 / SC-1 | `tests/test_okx_archive_apply.py::TestLiveFundingMalformed` | (Task 3) |
| 223-01-T2 | 1 | FLOWK-02 / SC-1 | `tests/test_okx_archive_apply.py tests/test_okx_archive_job.py tests/test_daily_pnl_read_verdict.py`, plus mypy | (Task 3) |
| 223-01-T3 | 1 | SC-4 | `tests/test_okx_archive_apply.py tests/test_okx_archive_job.py` | A: drop the raise keyword; B: drop the `FundingRowsMalformed` mapping |
| 223-02-T1 (tracer) | 1 | FLOWK-03 / SC-2 | `tests/test_daily_pnl_read_verdict.py` (passed count equal to the count measured at the task's start; 492 at f9d6d770e) | (Task 2) |
| 223-02-T2 | 1 | SC-4 | `tests/test_daily_pnl_read_verdict.py` | the malformed-flag prefix added to the verdict's reasons filter |
| 223-03-T1 (tracer) | 1 | SC-5 (fetcher) | `tests/test_funding_fetch.py::TestBybitUntilMs` | (Task 3) |
| 223-03-T2 | 1 | SC-5 (fetcher) | `tests/test_funding_fetch.py tests/test_bybitreads_census_pins.py`, plus mypy | (Task 3) |
| 223-03-T3 | 1 | SC-4, SC-5 | `tests/test_funding_fetch.py tests/test_bybitreads_census_pins.py` | A `until_ms` ignored; B the helper's window width changed |
| 223-04-T1 (tracer) | 2 | SC-5 (handler) | the four funding files, plus the cancelled-walk node id (real fetcher, 1.5 s budget) | (Task 3) |
| 223-04-T2 | 2 | SC-5 (handler) | `TestC27WindowedBybitWalk`, the census file, plus mypy | (Task 3) |
| 223-04-T3 | 2 | SC-4, SC-5 | the four funding files | 1 store once, 2 newest first, 3 no sort, 4 continue past a failure, 5 no slicing |
| 223-05-T1 (tracer) | 3 | FLOWK-02 / SC-1 | `tests/test_job_worker_sync_funding.py::TestSyncFundingMalformedRowDecision` | (Task 3) |
| 223-05-T2 | 3 | FLOWK-02 / SC-1 | the same class plus the whole file | (Task 3) |
| 223-05-T3 | 3 | SC-4, phase gate | the 7-file quick set, the full suite with `--cov-fail-under=80`, mypy | B, O, Y: the raise keyword on one venue's fetch call |

SC-3 (TODOS deletions, CHANGELOG, VERSION) is done by the orchestrator at ship time from the `closes-todos:` lines in the 223-02 and 223-05 SUMMARYs; no plan edits those files.

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/test_okx_archive_apply.py` — `**kwargs` on the two `_funding` fakes, then the decision test
- [ ] `tests/test_job_worker_sync_funding.py` — drop pin (three venues), C27 tests
- [ ] `tests/test_job_worker_funding_cursor.py` — the two deliberate updates
- [ ] `tests/test_funding_fetch.py` — `until_ms` and window-helper tests

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| PROD count recorded | FLOWK-03 | read-only PROD read | done 2026-11-24, `223-PROD-MALFORMED-COUNT.md` |
| First Bybit walk fills `funding_fees` on PROD | SC-5 | needs a deploy and a daily cron | after deploy, read `funding_fees` row count for the Bybit strategy and the `sync_funding` job outcomes (read-only) |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 90s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
