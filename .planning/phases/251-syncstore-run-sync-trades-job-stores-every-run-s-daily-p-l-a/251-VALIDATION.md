---
phase: "251"
slug: "syncstore-run-sync-trades-job-stores-every-run-s-daily-p-l-a"
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: "2026-11-26"
---

# Phase 251 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Source: `251-RESEARCH.md` § Validation Architecture.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | pytest 9 + pytest-asyncio |
| **Config file** | `analytics-service/pytest.ini` |
| **Quick run command** | `cd analytics-service && python3 -m pytest tests/test_sync_trades_store_truth.py -q -p no:cacheprovider` |
| **Full suite command** | not run locally (load limit); the CI `python` job runs the full suite |
| **Estimated runtime** | ~15 seconds per regression set |

---

## Sampling Rate

- **After every task commit:** quick command + `cd analytics-service && python3 -m mypy --strict --follow-imports=silent --config-file=pyproject.toml services/job_worker.py`
- **After every plan wave:** the four regression sets named in RESEARCH (drivers, handler subset, censuses, MT5 pin)
- **Before verify:** the four sets + mypy green locally; the live bridge file green in CI's `python` job
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Criterion | Behavior | Test Type | Automated Command | File Exists | Status |
|-----------|----------|-----------|-------------------|-------------|--------|
| SC-1 | daily store before balance + Phase 2; cancelled walk keeps the store | mocked handler | quick command `-k "store_before or cancelled"` | ❌ W0 | ⬜ pending |
| SC-2 | refusal stores nothing, holds last_sync_at, no persist-failed stamp, trade_count 0; 429 arm | mocked handler | quick command `-k "refus or rate_limit"` | ❌ W0 | ⬜ pending |
| SC-3 | clean read pops owned keys, keeps malformed + unrelated keys | mocked handler | quick command `-k "clean or owned"` | ❌ W0 | ⬜ pending |
| SC-4 | flag OFF + refusal reaches data_quality_flags; failed flag read writes nothing | mocked handler | quick command `-k "flag_off or load_failed or no_row"` | ❌ W0 | ⬜ pending |
| SC-5 | re-read raising after zero-row write → DONE; write raising → FAILED | mocked + live lane | quick command `-k reread`; live in CI `python` job | ❌ W0 / edit existing | ⬜ pending |
| SC-6 | PROOF-01 neuter rows N1-N20 as listed per task in the plans, byte-backup restore | procedure | recorded in SUMMARY | n/a | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `analytics-service/tests/test_sync_trades_store_truth.py` — SC-1..SC-4 and the SC-5 mocked arm
- [ ] `analytics-service/tests/test_sync_trades_enqueue_failure_bridge_live.py` — re-read-raises arm
- [ ] owned-flag pin over `services/exchange.py` `_record_dq_flag("daily_pnl_...")` literals

---

## Manual-Only Verifications

All phase behaviors have automated verification. The live-lane arm is verified in CI only (no local Docker under the load limit).

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
