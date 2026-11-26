---
phase: "250"
slug: "binancefills-a-binance-fills-read-walks-every-window-and-never-stalls-its-cursor"
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: "2026-11-25"
---

# Phase 250 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Source: `250-RESEARCH.md` `## Validation Architecture` (its arm table and neuters N1-N17 are binding on the plans; the plans add N0, N1r, N8b, N10e and N18-N30, so the phase set is N0-N30; N21 now neuters the cap WARNING for any cap stop; N29, added at plan revision 2026-11-25, neuters the overlap-page exemption; N30, added the same day for the third caller, neuters the onboarding adapter's walk from the reach).

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | pytest with pytest-asyncio (`asyncio_mode = auto`) |
| **Config file** | `analytics-service/pytest.ini` |
| **Quick run command** | `cd analytics-service && .venv/bin/pytest tests/test_binancefills_harness.py tests/test_binancefills_e2e.py tests/test_binancefills_walk.py tests/test_binancefills_cursor.py tests/test_binancefills_adapter.py -q -p no:cacheprovider` (each file exists from the plan that creates it: harness and e2e from 250-01, cursor from 250-02, walk from 250-04, adapter from 250-05) |
| **Full suite command** | `cd analytics-service && .venv/bin/pytest -n auto --dist loadgroup --cov=services --cov=routers --cov=main_worker --cov-report=term-missing --cov-fail-under=80` |
| **Estimated runtime** | ~30 seconds quick; several minutes full |

---

## Sampling Rate

- **After every task commit:** quick run command plus the migrated Binance tests in `tests/test_exchange.py`
- **After every plan wave:** `tests/test_exchange.py tests/test_okxtrades_cursor.py tests/test_ana_recon_audit.py tests/test_job_worker.py tests/test_job_worker_reconcile_audit.py tests/test_sync_trades_resume_seed.py` plus CI mypy strict
- **Before `/gsd-verify-work`:** full suite green with `--cov-fail-under=80`, mypy strict green
- **Max feedback latency:** 60 seconds

---

## Per-Task Verification Map

Filled by the planner per task, copied from the `## Per-task verification map` section of each of the eight plans (250-01 to 250-08, refreshed 2026-11-25 after the founder ruling on the quiet-prefix deadline case, and again at plan revision 2026-11-25 for the overlap-page exemption and the 250-08 split). Each row's plan names the arms and the PROOF-01 neuters (N0-N30, each in exactly one plan) that make its command able to fail.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 250-01-01 | 01 | 1 | SC-1, SC-5 | T-250-04 | R2-02 reproduced through the real job | e2e | `cd analytics-service && .venv/bin/pytest tests/test_binancefills_e2e.py -q -p no:cacheprovider -rxX` | created in task | ⬜ pending |
| 250-01-02 | 01 | 1 | SC-5 | — | the fake cannot serve everything after since (N0) | unit | `cd analytics-service && .venv/bin/pytest tests/test_binancefills_harness.py tests/test_binancefills_e2e.py -q -p no:cacheprovider -rxX` | created in task | ⬜ pending |
| 250-02-01 | 02 | 1 | SC-3, SC-5 | T-250-06 | stamp never past the bound | unit (real handler) | `cd analytics-service && .venv/bin/pytest tests/test_binancefills_cursor.py -q -p no:cacheprovider` | created in task | ⬜ pending |
| 250-02-02 | 02 | 1 | SC-3, SC-5 | T-250-05, T-250-08 | holds win; lost bound holds | unit (real handler) | `cd analytics-service && .venv/bin/pytest tests/test_binancefills_cursor.py tests/test_okxtrades_cursor.py -q -p no:cacheprovider` | created in task 1 | ⬜ pending |
| 250-02-03 | 02 | 1 | SC-2, SC-4, SC-5 | T-250-07 | unlisted never holds; transient re-read | unit (real handler) | `cd analytics-service && .venv/bin/pytest tests/test_binancefills_cursor.py tests/test_okxtrades_cursor.py tests/test_sync_trades_resume_seed.py tests/test_job_worker.py -q -p no:cacheprovider` | created in task 1 | ⬜ pending |
| 250-03-01 | 03 | 2 | SC-1, SC-3, SC-5 | T-250-01, T-250-02 | no request without an end; quiet stretch stamped through the real job | e2e | `cd analytics-service && .venv/bin/pytest tests/test_binancefills_e2e.py tests/test_binancefills_harness.py -q -p no:cacheprovider -rxX` | yes (250-01) | ⬜ pending |
| 250-03-02 | 03 | 2 | SC-1 | — | legacy Binance contracts kept | unit | `cd analytics-service && .venv/bin/pytest tests/test_exchange.py tests/test_ana_recon_audit.py tests/test_binancefills_e2e.py tests/test_binancefills_harness.py -q -p no:cacheprovider -k "inance or c13_03"` | yes | ⬜ pending |
| 250-04-01 | 04 | 3 | SC-1, SC-5 | — | clamp named, never held, through the real job | e2e + unit | `cd analytics-service && .venv/bin/pytest tests/test_binancefills_walk.py tests/test_binancefills_e2e.py -q -p no:cacheprovider` | created in task | ⬜ pending |
| 250-04-02 | 04 | 3 | SC-1, SC-5 | T-250-01 | out-of-window rows refused by name; spans within one window | unit | `cd analytics-service && .venv/bin/pytest tests/test_binancefills_walk.py -q -p no:cacheprovider` | created in task 1 | ⬜ pending |
| 250-04-03 | 04 | 3 | SC-1, SC-5 | T-250-03 | reconcile one request per symbol; same-ms flag reaches the drain | unit | `cd analytics-service && .venv/bin/pytest tests/test_binancefills_walk.py tests/test_binancefills_e2e.py tests/test_binancefills_harness.py tests/test_exchange.py tests/test_ana_recon_audit.py tests/test_okxtrades_cursor.py tests/test_sync_trades_resume_seed.py -q -p no:cacheprovider` | yes | ⬜ pending |
| 250-05-01 | 05 | 4 | SC-2, SC-5 | T-250-09, T-250-13 | only BadSymbol skips without a hold | e2e + unit | `cd analytics-service && .venv/bin/pytest tests/test_binancefills_walk.py tests/test_binancefills_e2e.py tests/test_binancefills_cursor.py -q -p no:cacheprovider` | yes (250-01, 250-04) | ⬜ pending |
| 250-05-02 | 05 | 4 | SC-1, SC-2, SC-5 | T-250-09, T-250-12, T-250-14, T-250-22 | linear names never read from spot; transient failure holds and is re-read; the LIVE onboarding caller `BinanceAdapter.fetch_raw` (no `since_ms`) walks from the reach and returns a fill older than 7 days that HEAD loses (`test_onboarding_without_a_since_walks_from_the_reach_and_returns_a_fill_older_than_seven_days`, RED on HEAD, N30) | e2e + unit | `cd analytics-service && .venv/bin/pytest tests/test_binancefills_walk.py tests/test_binancefills_e2e.py tests/test_binancefills_adapter.py tests/test_binancefills_harness.py tests/test_binancefills_cursor.py tests/test_exchange.py tests/test_ana_recon_audit.py -q -p no:cacheprovider -k "inance or c13_03"` | yes | ⬜ pending |
| 250-06-01 | 06 | 5 | SC-3, SC-5 | T-250-11 | stamp never past a capped symbol's unread fills; resume past the cap; cap WARNING | e2e + unit | `cd analytics-service && .venv/bin/pytest tests/test_binancefills_walk.py tests/test_binancefills_e2e.py tests/test_binancefills_cursor.py -q -p no:cacheprovider` | yes | ⬜ pending |
| 250-06-02 | 06 | 5 | SC-3, SC-5 | T-250-11, T-250-15, T-250-16 | overlap pages exempt so a cap stamp whose overlap hour is full is passed on the next run (`test_a_cap_stamp_whose_overlap_hour_is_full_resumes_past_the_cap`, N29); bound recorded once; untimed page named with a bound | e2e + unit | `cd analytics-service && .venv/bin/pytest tests/test_binancefills_walk.py tests/test_binancefills_e2e.py tests/test_binancefills_cursor.py tests/test_exchange.py tests/test_ana_recon_audit.py -q -p no:cacheprovider -k "inance or c13_03" --durations=5` | yes | ⬜ pending |
| 250-07-01 | 07 | 6 | SC-1, SC-3, SC-5 | T-250-17, T-250-18, T-250-19 | repeated deadline stops advance the stamp; every symbol starts each run; the sync job reads with 840 s (its constant comment carries the sync handler tail ledger) | e2e | `cd analytics-service && .venv/bin/pytest tests/test_binancefills_e2e.py tests/test_binancefills_walk.py tests/test_binancefills_cursor.py tests/test_okxtrades_cursor.py tests/test_sync_trades_resume_seed.py -q -p no:cacheprovider` | yes | ⬜ pending |
| 250-07-02 | 07 | 6 | SC-1, SC-3, SC-5 | T-250-10 | no request after the deadline, exempt overlap pages included; bound per stop state; budget per caller | unit + e2e | `cd analytics-service && .venv/bin/pytest tests/test_binancefills_walk.py tests/test_binancefills_e2e.py tests/test_binancefills_harness.py tests/test_binancefills_cursor.py tests/test_exchange.py tests/test_okxtrades_cursor.py tests/test_ana_recon_audit.py tests/test_job_worker.py tests/test_job_worker_reconcile_audit.py tests/test_sync_trades_resume_seed.py -q -p no:cacheprovider` | yes | ⬜ pending |
| 250-08-01 | 08 | 7 | SC-5 | T-250-20, T-250-21 | the merged phase passes every pre-push gate, no new failure against the base, no credential reaches a test | full suite | 250-08 Task 1's four commands (`cd analytics-service && env -i PATH="$PATH" HOME="$HOME" .venv/bin/pytest -n auto --dist loadgroup --cov=services --cov=routers --cov=main_worker --cov-report=term-missing --cov-fail-under=80` among them) | yes | ⬜ pending |
| 250-08-02 | 08 | 7 | SC-4, SC-5 | — | every ship hand-over line present (the reconcile endpoint fix, the sync budget and the third caller on their own lines); source audit re-checked | doc check | 250-08 Task 2's hand-over check | created in task | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `analytics-service/tests/_binance_fills.py` — real `ccxt.binance`, recorded markets, venue-modelling fake
- [ ] recorded markets fixture (unified market dicts from a public `load_markets()`)
- [ ] `tests/test_binancefills_walk.py`, `tests/test_binancefills_cursor.py`
- [ ] migrate 13 census tests to the fake (250-03; RESEARCH counted 14, and the 14th, the source-inspection `test_c13_03_binance_cursor_advances_without_plus_one`, is kept green unedited by its literal `next_since == current_since`, beside 250-04's behavioural same-ms pins `test_a_same_millisecond_cluster_across_pages_is_read_in_full` and `test_a_full_page_on_one_millisecond_steps_past_it`)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Precondition recorded at the flag declaration, naming the quiet-prefix deadline known limit as its one exception (founder ruling 2026-11-25 UTC) | SC-4 | prose is not tested (CONTEXT) | read the `_RAW_TRADE_INGESTION_ENABLED` comment and the CHANGELOG entry; both name the exception |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
