---
phase: "230"
slug: "mt5nightly-every-mt5-nightly-derive-ends-done-on-its-first-attempt-for-a-named-reason"
status: draft
nyquist_compliant: false
wave_0_complete: false
created: "2026-11-25"
---

# Phase 230 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. The source is `230-RESEARCH.md` `## Validation Architecture`.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | pytest (`analytics-service/pytest.ini`, asyncio auto), vitest for census pins, plain-SQL `DO` gates under `supabase/tests` with the mutation runner |
| **Config file** | `analytics-service/pytest.ini`, `scripts/mutation-floors.mjs` |
| **Quick run command** | `cd analytics-service && python3 -m pytest tests/test_mt5_xlease.py tests/test_mt5_concurrency.py -q -p no:cacheprovider` |
| **Full suite command** | `cd analytics-service && pytest -n auto --dist loadgroup` ; mypy strict (CI command) ; `node scripts/mutation-runner/run.mjs --parse-only` ; `node scripts/lint-sql-gates.mjs` ; the census vitest files |
| **Estimated runtime** | ~30 seconds quick; full analytics suite several minutes |

---

## Sampling Rate

- **After every task commit:** the quick run command
- **After every plan wave:** the full suite command
- **Before `/gsd-verify-work`:** full suite green, plus one full mutation-runner run on the new gate file
- **Max feedback latency:** 60 seconds

---

## Per-Task Verification Map

| Requirement | Behavior | Test Type | Automated Command | File Exists | Status |
|-------------|----------|-----------|-------------------|-------------|--------|
| MT5D-02 | two holders on two lock registries never overlap (PROOF-01, RED when neutered) | unit | `pytest tests/test_mt5_xlease.py -k two_registries -x` | ❌ W0 | ⬜ pending |
| MT5D-02 | bounded caller gets `Mt5TerminalBusyError`, local lock released, nothing stamped | unit | `pytest tests/test_mt5_xlease.py -k bound -x` | ❌ W0 | ⬜ pending |
| MT5D-02 | RPC errors: fail closed (transient), missing RPC falls back loud | unit | `pytest tests/test_mt5_xlease.py -k "unavailable or missing_rpc" -x` | ❌ W0 | ⬜ pending |
| MT5D-02 | late grant released; cancel never strands the local lock; lost lease bumps epoch | unit | `pytest tests/test_mt5_xlease.py -k "late_grant or cancel or lost" -x` | ❌ W0 | ⬜ pending |
| MT5D-02 | site edits (holdings sync_error, validate arms, classify transient) | unit | `pytest tests/test_allocator_positions_non_ccxt.py tests/test_process_key.py tests/test_job_worker.py -k lease -x` | extend | ⬜ pending |
| MT5D-02 | existing lease behaviour unchanged | unit | `pytest tests/test_mt5_concurrency.py tests/test_mt5_abandon_fence.py tests/test_mt5_handover.py -q` | ✅ | ⬜ pending |
| MT5D-02 | SQL: exclusivity, expiry takeover, foreign release refused, renew, grants | SQL gate | `node scripts/mutation-runner/run.mjs --file supabase/tests/test_mt5_terminal_lease.sql` | ❌ W0 | ⬜ pending |
| MT5D-02 | RPC answer shapes against a real database | live lane | `cd analytics-service && pytest tests/test_mt5_xlease_live.py -x` | ❌ W0 | ⬜ pending |
| MT5D-03 | `--days-out` writes day sets only to the named path; report stays counts-only | unit | `pytest tests/test_mt5offset_dry_run.py -x` | extend | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `analytics-service/tests/test_mt5_xlease.py` (MT5D-02 unit and PROOF-01)
- [ ] `analytics-service/tests/conftest.py` autouse default lease backend that grants
- [ ] `analytics-service/tests/test_mt5_xlease_live.py`
- [ ] `supabase/tests/test_mt5_terminal_lease.sql` with the migration and its down file

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Seven consecutive clean nights after the lease deploy | MT5D-02 | needs real nights on PROD | the nightly query in `230-RESEARCH.md`, marker first, from night 1 = the first 00:40Z derive after both the backfill and the API deploys carry the fix |
| Clock replay of the 202 moved values | MT5D-03 | live read-only capture on the worker, run by the coordinator (D-02) | the capture and replay steps in the MT5D-03 plan |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
