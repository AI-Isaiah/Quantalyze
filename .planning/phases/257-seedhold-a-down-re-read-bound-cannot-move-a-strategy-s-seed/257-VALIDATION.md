---
phase: "257"
slug: "seedhold-a-down-re-read-bound-cannot-move-a-strategy-s-seed"
status: draft
nyquist_compliant: false
wave_0_complete: false
created: "2026-11-28"
---

# Phase 257 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Source: `257-RESEARCH.md` `## Validation Architecture`.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | pytest 9.x (`asyncio_mode = auto`); SQL self-test corpus under `supabase/tests` for the migration |
| **Config file** | `analytics-service/pytest.ini` |
| **Quick run command** | `cd analytics-service && python3 -m pytest tests/test_seedhold_bound.py tests/test_nullanchor_bound.py -q` |
| **Full suite command** | census command in RESEARCH plus `cd analytics-service && mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py` |
| **Estimated runtime** | ~200 seconds (census) |

---

## Sampling Rate

- **After every task commit:** quick run command plus mypy strict.
- **After every plan wave:** census command plus mypy strict.
- **Before `/gsd-verify-work`:** CI `python` job command green.
- **Max feedback latency:** 200 seconds.

---

## Per-Task Verification Map

Filled by the planner per task (each task carries an `<automated>` verify). Gates: SC-1 matrix (`-k matrix`), SC-2 Bybit arms (`-k bybit`), SC-3 census, SC-5 PROOF-01 neuters B1-B8 and H1-H5 recorded in plan SUMMARYs.

---

## Wave 0 Requirements

- [ ] `analytics-service/tests/test_seedhold_bound.py` — matrix, Bybit arms, pins, a fake jobs store that models status and recency.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| PROOF-01 neuter/restore | SC-5 | Requires editing source and observing RED | byte backup, neuter, RED with named arm, `cp` back, `cmp`, GREEN, recorded verbatim |
| TODOS deletion | SC-4 | Ship-time ledger edit | `grep -a -c` of both ids in `TODOS.md` is 0 |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 200s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
