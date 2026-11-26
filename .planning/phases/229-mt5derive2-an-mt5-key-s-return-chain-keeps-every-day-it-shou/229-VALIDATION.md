---
phase: "229"
slug: "mt5derive2-an-mt5-key-s-return-chain-keeps-every-day-it-should-and-a-key-with-no-writer-basis-never-composes-silently"
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: "2026-11-24"
---

# Phase 229 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Source: 229-RESEARCH.md "## Validation Architecture".

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | pytest (asyncio_mode auto), mypy strict |
| **Config file** | `analytics-service/pytest.ini`, `analytics-service/pyproject.toml` |
| **Quick run command** | `cd analytics-service && python -m pytest tests/test_nav_twr.py::<node> -q -p no:cacheprovider` |
| **Full suite command** | `cd analytics-service && pytest -n auto --dist loadgroup --cov=services --cov=routers --cov=main_worker --cov-report=term-missing --cov-fail-under=80` |
| **Type gate** | `cd analytics-service && mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py` |
| **Estimated runtime** | ~15 s per node selection; full suite several minutes |

---

## Sampling Rate

- **After every task commit:** the node or `-k` selection for that task, plus mypy when `services/` changes
- **After every plan wave:** `test_nav_twr.py`, `test_mt5_soak.py` (after wave 1 exactly one expected RED node, `test_one_checked_day_among_knife_edge_sweep_days_is_not_green[10000.0-10050.0]` with `timed_day_not_nan`, until plan 04 lands in wave 2; green from wave 2 on), `test_allocator_equity_writer_basis.py`, `test_derive_allocator_equity_job.py`, `test_mt5_derive_branch.py`, `test_broker_dailies.py`, `test_native_nav.py`, `test_golden_parity.py`, `test_mt5_golden_fixtures.py`
- **Before `/gsd-verify-work`:** full suite and type gate green
- **Max feedback latency:** ~160 s

---

## Per-Task Verification Map

Filled by the planner per task; see RESEARCH.md "Phase Requirements -> Test Map" and the PROOF-01 neuter table.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 229-01-T1 | 01 | 1 | MT5D-04 | T-229-01 | a re-fund day into an emptied account publishes its measured return | e2e (combiner) | `pytest tests/test_nav_twr.py::test_a_refund_into_an_emptied_mt5_account_is_published_end_to_end` | ❌ W0 | ⬜ pending |
| 229-01-T2 | 01 | 1 | MT5D-04 | T-229-01 | re-fund classes measured, 188 tiny precedence kept, moved pin replaced | unit | `pytest tests/test_nav_twr.py -k "refund or empty_cohort_zero or cohort_zero_with_pnl or flow_only_day_on_an_emptied or test_inception_with_a_timing_measures"` | ❌ W0 | ⬜ pending |
| 229-01-T3 | 01 | 1 | MT5D-06 | T-229-02 | band pin bites at ratio 0.5; ratio stays 1.0; one expected soak RED handed to 04 | unit + suites | neighbour suites, `tests/test_mt5_soak.py` (exactly 1 expected failure), mypy | ✅ | ⬜ pending |
| 229-02-T1 | 02 | 2 | MT5D-05 | T-229-03, T-229-04 | day-0 P&L counted by name, bool reaches the pre-stamp, status stays complete | unit + e2e (derive) | `pytest tests/test_nav_twr.py tests/test_job_worker.py -k "inception_day_zero_pnl or single_inception_day_with_pnl or day_zero_pnl_on_an_inception_day or small_base_is_an_annotation"` | ❌ W0 | ⬜ pending |
| 229-02-T2 | 02 | 2 | MT5D-05 | T-229-03 | runner and ccxt carries; MT5 and Deribit day-0 paths flagged | unit | carry suites, mypy, three vitest literal pins | ❌ W0 | ⬜ pending |
| 229-03-T1 | 03 | 1 | MT5D-07 | T-229-05, T-229-06 | silent no-basis shape blocks as key_inputs_mismatch with its branch named | e2e (derive to compose) | `pytest tests/test_allocator_equity_writer_basis.py::test_a_timed_btc_key_with_a_trailing_unpriced_close_is_blocked_by_name`, mypy | ❌ W0 | ⬜ pending |
| 229-03-T2 | 03 | 1 | MT5D-07 | T-229-07 | all three read sites, removal, token census, malformed token is corrupt input | unit + e2e | writer-basis and compose suites, mypy, two vitest literal pins | ❌ W0 | ⬜ pending |
| 229-04-T1 | 04 | 2 | MT5D-04 | T-229-08 | the soak verifies a re-fund day by its own independent walk | e2e (soak) | `pytest tests/test_mt5_soak.py -k "refund_day_into_an_emptied_account or hand_fraction_walk_on_the_refund_day"` | ❌ W0 | ⬜ pending |
| 229-04-T2 | 04 | 2 | MT5D-04 | T-229-09 | knife-edge family keeps its CR-04 intent on a judged base | e2e (soak) | `pytest tests/test_mt5_soak.py tests/test_mt5_deal_reconstruction.py tests/test_broker_dailies.py` | ✅ (fixture moves) | ⬜ pending |
| 229-05-T1 | 05 | 3 | HOLD-03 | T-229-10 | a same-terminal re-derive pair with a quiet-day correction is refused | e2e (derive to compose) | `pytest tests/test_allocator_equity_writer_basis.py::test_a_same_terminal_rederive_pair_with_a_quiet_day_correction_is_refused`, mypy | ❌ W0 | ⬜ pending |
| 229-05-T2 | 05 | 3 | HOLD-03 | T-229-10, T-229-12 | timed, stitched and departed pairs refused; each exit stamps only what it wrote | e2e | `pytest tests/test_allocator_equity_writer_basis.py -k "rederive_pair or stamp"` | ❌ W0 | ⬜ pending |
| 229-05-T3 | 05 | 3 | HOLD-03 | T-229-11, T-229-12, T-229-13 | no healthy pair refused; malformed and non-finite stamps handled; determinism | unit + e2e | compose and derive suites, mypy, two vitest literal pins | ❌ W0 | ⬜ pending |
| 229-06-T1 | 06 | 4 | all five | T-229-14, T-229-15 | merged head green, spine untouched, PROOF-01 ledger complete, soak entry loads | suite | full pytest with coverage, mypy, vitest pins, soak entry exit 3 | ✅ | ⬜ pending |
| 229-06-T2 | 06 | 4 | all five (SC-5) | T-229-14 | live soak against the changed derive recorded as verdict lines | live, human | `<main-checkout venv python> -m scripts.mt5_soak` from the PHASE checkout's analytics-service/ with the analytics-service tree hash Task 1 recorded (founder pastes `git rev-parse --short HEAD:analytics-service` and an empty `git status --porcelain -- analytics-service`; MT5_SPIKE_* set; MT5_SOAK_LOG_DIR outside the repo) | n/a | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] New RED fixtures in `analytics-service/tests/test_nav_twr.py` (refund classes, day-0 flag)
- [ ] New RED fixtures in `analytics-service/tests/test_allocator_equity_writer_basis.py` (silent no-basis shape, mismatched pair, healthy-pair family)
- [ ] New knife-edge zero-base sweep fixture in `analytics-service/tests/test_mt5_soak.py`

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Live soak against the changed derive | SC-5 | needs the private MT5 gateway and credentials | from the PHASE checkout's `analytics-service/` (not the main checkout, which lacks the phase code), run the main checkout's venv python `-m scripts.mt5_soak` with `MT5_SPIKE_*` set and `MT5_SOAK_LOG_DIR` outside the repo; record the analytics-service tree hash (must equal plan 06 Task 1's), an empty `git status --porcelain -- analytics-service`, and the verdict lines verbatim |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 160s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
