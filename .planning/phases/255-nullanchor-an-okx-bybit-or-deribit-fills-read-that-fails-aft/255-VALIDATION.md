---
phase: "255"
slug: "nullanchor-an-okx-bybit-or-deribit-fills-read-that-fails-aft"
status: draft
nyquist_compliant: false
wave_0_complete: false
created: "2026-11-26"
---

# Phase 255 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Source: 255-RESEARCH.md "## Validation Architecture".

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | pytest 9.0.2, `asyncio_mode = auto` |
| **Config file** | `analytics-service/pytest.ini` |
| **Quick run command** | `cd analytics-service && python3 -m pytest tests/test_nullanchor_bound.py tests/test_binancefills_cursor.py tests/test_okxtrades_cursor.py -q` |
| **Full suite command** | `cd analytics-service && pytest -n auto --dist loadgroup --cov=services --cov=routers --cov=main_worker --cov-report=term-missing --cov-fail-under=80` |
| **Type gate** | `cd analytics-service && mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py` |
| **Estimated runtime** | ~60 seconds quick + census; full suite several minutes |

---

## Sampling Rate

- **After every task commit:** quick run command plus the type gate
- **After every plan wave:** the census command in 255-RESEARCH.md (18 files) plus the type gate
- **Before `/gsd-verify-work`:** full suite and type gate green
- **Max feedback latency:** 120 seconds

---

## Per-Task Verification Map

Filled by the planner per task (each task carries an `<automated>` verify). Requirement map: SC-1 → `tests/test_nullanchor_bound.py` matrix; SC-2 → golden-value pin in the same module plus `tests/test_binancefills_cursor.py`; SC-3 → ship-time `grep -a -c '253-NULL-COLUMN-ANCHOR-ALL-VENUES' TODOS.md` is 0; SC-4 → PROOF-01 neuters N1–N8 recorded verbatim in each SUMMARY.

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `analytics-service/tests/test_nullanchor_bound.py` — new parametrised module (matrix, mechanism, SC-2 pin, pinned clock)
- [ ] The three hand-rolled RPC fakes and three Binance-file assertions named in the research census, updated in the same wave as the code change

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| PROOF-01 neuter → RED → restore → GREEN | SC-4 | needs a neutered copy of production code | byte backup, neuter, run the named arm RED, `cp` back, `cmp`, GREEN; record verbatim in the SUMMARY |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 120s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
