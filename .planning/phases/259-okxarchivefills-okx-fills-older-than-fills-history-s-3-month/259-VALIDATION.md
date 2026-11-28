---
phase: "259"
slug: "okxarchivefills-okx-fills-older-than-fills-history-s-3-month"
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: "2026-11-27"
---

# Phase 259 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Source: `259-RESEARCH.md` "Validation Architecture (Q5)".

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | pytest 8-series (`analytics-service/requirements-dev.txt`, `asyncio_mode = auto`) |
| **Config file** | `analytics-service/pytest.ini`; mypy strict in `analytics-service/pyproject.toml` |
| **Quick run command** | `cd analytics-service && .venv/bin/python -m pytest tests/test_okx_normalize_fill_golden.py tests/test_okx_archive_fills_parse.py tests/test_okx_archive_fills_map.py tests/test_okx_archive_fills_job.py tests/test_okx_archive_fills_apply.py tests/test_okx_archive_fills_chain.py -x -q` (the 3.12 venv; the machine default 3.14 segfaults the numpy/pandas stack) |
| **Full suite command** | `cd analytics-service && make test && make typecheck` |
| **Estimated runtime** | ~30 seconds quick; several minutes full |

Rules: pytest only from `analytics-service/`; never `importlib.reload`; neutered files are restored from a byte backup (`cp`, then `cmp`), never by git checkout, restore or stash.

---

## Sampling Rate

- **After every task commit:** the quick command plus `python -m mypy --config-file=pyproject.toml <new modules>`
- **After every plan wave:** the regression pins below plus `make typecheck`
- **Before `/gsd-verify-work`:** full suite green
- **Max feedback latency:** 60 seconds

---

## Per-Task Verification Map

| Req | Behavior | Test Type | Automated Command | File Exists | Status |
|-----|----------|-----------|-------------------|-------------|--------|
| SC-1 | Extracted live helper is behaviour-preserving (golden recorded pre-extraction, plan 01) | unit (golden) | `pytest tests/test_okx_normalize_fill_golden.py -x` + `pytest tests/test_exchange.py -k "okx or Okx" -x` | ❌ W0 | ⬜ pending |
| SC-1 | Parser keeps the trade cells; pins unchanged (plan 02) | unit | `pytest tests/test_okx_archive_fills_parse.py -x` | ❌ W0 | ⬜ pending |
| SC-1 | Mapped archive row equals the literal expected row and the live helper's row; subTypes 1-6 (plan 04) | unit | `pytest tests/test_okx_archive_fills_map.py -k "map_" -x` | ❌ W0 | ⬜ pending |
| SC-2 | Reconcile by value: quantity, price, fee, side, symbol, fee_currency, timestamp (both columns), absent either side, count (plan 04) | unit | `pytest tests/test_okx_archive_fills_map.py -k reconcile -x` | ❌ W0 | ⬜ pending |
| SC-2 | Refusals: unproven instType or settle, unmapped trade subType, unreadable trade bill, unknown contract size, duplicate tradeId (plan 04) | unit | `pytest tests/test_okx_archive_fills_map.py -k refuse -x` | ❌ W0 | ⬜ pending |
| SC-2 | Reconcile miss on any target stops the whole read (plan 07) | unit | `pytest tests/test_okx_archive_fills_apply.py -k "reconcile_miss or writes_nothing" -x` | ❌ W0 | ⬜ pending |
| SC-3 | Idempotent second run; every gate failure writes nothing; named resumable write failures (plan 07) | unit | `pytest tests/test_okx_archive_fills_apply.py -x` | ❌ W0 | ⬜ pending |
| SC-3 | Unread spans named (over_cap, not_requested, pre_archive, unreachable, per-strategy before_anchor); over-cap quarters listed by tag in `info.over_cap_quarters` (known gap `259-ARCHIVE-QUARTER-CAP`); legacy reading counts only read quarters (plans 05 and 06) | unit | `pytest tests/test_okx_archive_fills_job.py -k "plan_quarters or before_anchor or legacy_reading or nothing_to_read or without_anchor" -x` | ❌ W0 | ⬜ pending |
| SC-3 | `fills_apply` stops `fills_legacy_mismatch` (permanent, nothing written for any target) on a non-zero legacy `unequal`, `absent_in_archive` or `unreadable`; a calibrate reports it and ends DONE; rows in unread spans never trip it (plans 07 and 05) | unit | `pytest tests/test_okx_archive_fills_apply.py tests/test_okx_archive_fills_job.py -k "legacy" -x` | ❌ W0 | ⬜ pending |
| SC-4 | GET-first apply budget with the persisted count; DEFERRED while waiting; no link/ts/amount/tradeId leaks (plan 06) | unit | `pytest tests/test_okx_archive_fills_job.py -k "apply_budget or never_sleeps or leaks" -x` | ❌ W0 | ⬜ pending |
| SC-4 | Chain seam order, isolation, fills-only gate, account-scoped cooldown (plan 03) | unit | `pytest tests/test_okx_archive_fills_chain.py -x` | ❌ W0 | ⬜ pending |
| Pins | Existing OKX archive and main_worker tests pass unedited | regression | `pytest tests/test_okx_archive_parse.py tests/test_okx_archive_job.py tests/test_okx_archive_apply.py tests/test_okx_archive_rebuild.py tests/test_okx_archive_reconcile.py tests/test_okx_archive_download.py tests/test_main_worker.py -x` | ✅ | ⬜ pending |
| SC-6 | PROOF-01 neuters N1-N33 (259-08-PLAN.md table) recorded verbatim in 259-08-SUMMARY.md | neuter | `proof.sh` per neuter; `RED_OK` / `GREEN_OK` / `restore cmp exit=0` lines | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/fixtures/okx_archive/fills_q2_2026.csv` and `fills_q3_2026.csv`: new fixtures with trade cells (plan 02); existing `q2_like.csv`/`q3_like.csv` untouched
- [ ] A fake `trades` table with `trades_dedup_fill` semantics (ignore-duplicates returns only inserted rows; merge returns every row sent), shared by the job and apply tests
- [ ] Golden of the live OKX normaliser output, recorded before extraction
- [ ] `tests/test_okx_normalize_fill_golden.py` (plan 01), `tests/test_okx_archive_fills_parse.py` and `tests/_okx_archive_fills_fixtures.py` (plan 02), `tests/test_okx_archive_fills_chain.py` (plan 03), `tests/test_okx_archive_fills_map.py` (plan 04), `tests/_okx_archive_fills_fakes.py` and `tests/test_okx_archive_fills_job.py` (plan 05, extended by plan 06), `tests/test_okx_archive_fills_apply.py` (plan 07)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| PROD `fills_calibrate` census (trade cells populated, reconcile reading) | SC-1, SC-2 | Needs the real archive file and OKX account | After deploy: enqueue `okx_archive_rebuild` mode `fills_calibrate`, marker query first, read the result block by MCP |
| PROD backfill, fills before and after per strategy | SC-5 | PROD data | Marker query, count fills per strategy, enqueue `sync_trades` per strategy via `enqueue_compute_job`, wait for chained `fills_apply`, recount (runbook, plan 09) |
| PROD quarters beyond the cap, only if a result lists `info.over_cap_quarters` | SC-5 | PROD data | Runbook section 14: manual `fills_apply` jobs with a `quarters` override of up to 4 contiguous listed quarters each, newest first |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
