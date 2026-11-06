---
phase: "175"
slug: "mt5offset-mt5-deal-times-follow-the-broker-s-daylight-saving"
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: "2026-10-27"
---

# Phase 175 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Source: `175-RESEARCH.md` `## Validation Architecture`.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | pytest (+ pytest-asyncio auto mode), run only from `analytics-service/` |
| **Config file** | `analytics-service/pytest.ini`, `analytics-service/pyproject.toml` |
| **Quick run command** | `pytest tests/test_mt5_server_clock.py tests/test_mt5_deal_timing.py tests/test_mt5_deal_reconstruction.py -q -p no:cacheprovider` |
| **Full suite command** | offline subset: `pytest tests/test_mt5_server_clock.py tests/test_mt5_deal_timing.py tests/test_mt5_deal_reconstruction.py tests/test_mt5_derive_branch.py tests/test_equity_reconstruction.py tests/test_mt5_soak.py tests/test_nav_marks_derive_apply.py tests/test_nav_marks_compose_roundtrip.py tests/test_allocator_equity_writer_basis.py tests/test_derive_allocator_equity_job.py tests/test_reconstruct_whole_account.py tests/test_flowtiming_dry_run.py -q -p no:cacheprovider` plus `mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py`; the whole tree runs in CI |
| **Estimated runtime** | ~30 seconds (quick ~10 s) |

---

## Sampling Rate

- **After every task commit:** quick run command
- **After every plan wave:** offline subset plus the mypy line
- **Before `/gsd-verify-work`:** CI green bound to the head SHA
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

Filled by the planner per task; the requirement-level map is in `175-RESEARCH.md` `### Phase Requirements -> Test Map`.

| Req | Behavior | Test Type | Automated Command | File Exists | Status |
|-----|----------|-----------|-------------------|-------------|--------|
| SC-2 | rule offsets equal `zoneinfo` 2024-2029; golden vectors; repeated/missing hour | unit, oracle | `pytest tests/test_mt5_server_clock.py -q` | ❌ W0 | ⬜ pending |
| SC-2 | reviewer repro through `apply_marks`: rule 0.02, fixed 10800 0.549804 (RED under fixed) | integration | `pytest tests/test_mt5_server_clock.py -k mark -q` | ❌ W0 | ⬜ pending |
| SC-2 | seam accepts int and clock; ledger straddling a transition buckets each deal by its own offset | unit | `pytest tests/test_mt5_deal_timing.py tests/test_mt5_deal_reconstruction.py -q` | ✅ extend | ⬜ pending |
| SC-2 | derive and allocator-history paths thread one clock; config fault not a classification error, no stamp | integration | `pytest tests/test_mt5_derive_branch.py tests/test_equity_reconstruction.py -q` | ✅ extend | ⬜ pending |
| D-01 | resolver table and single env reader | unit, source pin | `pytest tests/test_mt5_server_clock.py -k "resolve or single_reader" -q` | ❌ W0 | ⬜ pending |
| D-03 | dry-run counts moved days, no amounts/ids/server text | unit | `pytest tests/test_mt5offset_dry_run.py -q` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

Neuter proof: with the resolver forced to the fixed 10800 (or the seam ignoring the clock) the SC-2 tests go RED with the arm named; restore from a byte backup; both runs recorded in the SUMMARY.

---

## Wave 0 Requirements

- [ ] `analytics-service/tests/test_mt5_server_clock.py` — oracle, golden vectors, property, resolver table, single-reader pin, `apply_marks` repro
- [ ] `analytics-service/tests/test_mt5offset_dry_run.py` — if the dry-run script is built
- [ ] `analytics-service/tests/conftest.py` — autouse default for the tests that lean on the silent `"0"` default (census over all of `tests/` first)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Broker rule measured and recorded | SC-1 | only a human at the MT5 terminal can read the broker clock | founder reads the server clock on 2026-10-27 and after 2026-11-01; rule id and dated readings recorded in the SUMMARY and runbook |
| Interim offset set before marks | SC-3 | worker env lives in Railway | runbook pre-flight item; live value matches the reading |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
