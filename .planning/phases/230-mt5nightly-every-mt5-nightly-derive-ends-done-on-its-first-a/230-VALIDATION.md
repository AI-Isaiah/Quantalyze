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

| Task | Requirement | Behavior | Automated Command | Test Type | File Exists | Status |
|------|-------------|----------|-------------------|-----------|-------------|--------|
| 230-01-T1 | MT5D-02 | tracer: table, acquire RPC, grants, arm L1 | `node scripts/mutation-runner/run.mjs --file supabase/tests/test_mt5_terminal_lease.sql` | SQL gate (pg-lane) | ✅ `supabase/tests/test_mt5_terminal_lease.sql` | ✅ green (plan 01 SUMMARY) |
| 230-01-T2 | MT5D-02 | renew, release, expiry takeover, arms L2 L3 L4 L7 | same file, same command | SQL gate (pg-lane) | ✅ | ✅ green (plan 01 SUMMARY) |
| 230-01-T3 | MT5D-02 | input validation, grants, holder CHECK, self-verify, rollback, mirrors, PROOF-01 | `node scripts/lint-migration-data-dependence.mjs && node scripts/lint-sql-gates.mjs && node scripts/mutation-runner/run.mjs --file supabase/tests/test_mt5_terminal_lease.sql && npx tsx scripts/dump-sql-functions.ts --check` | SQL gate + lint | ✅ migration, down file, three mirrors | ✅ green (plan 01 SUMMARY) |
| 230-02-T1 | MT5D-02 | tracer: two registries never overlap (XPROC-01, PROOF-01), suite default backend, wiring | `cd analytics-service && .venv/bin/python -m pytest tests/test_mt5_xlease.py tests/test_mt5_concurrency.py tests/test_mt5_abandon_fence.py tests/test_mt5_handover.py -q -p no:cacheprovider` | unit | ✅ `tests/test_mt5_xlease.py`, `tests/xlease_fakes.py`, conftest default backend | ✅ green (plan 02 SUMMARY) |
| 230-02-T2 | MT5D-02 | bound, late grant, cancellation, wait event, redaction | `pytest tests/test_mt5_xlease.py tests/test_mt5_concurrency.py -q -p no:cacheprovider` | unit | ✅ | ✅ green (plan 02 SUMMARY) |
| 230-02-T3 | MT5D-02 | renewal during the body, self-fence, timing validation, reset hook | pytest of the two lease files plus CI-form mypy strict | unit + type | ✅ | ✅ green (plan 02 SUMMARY) |
| 230-03-T1 | MT5D-03 | tracer: `--days-out` writes day sets to the named path only; report stays counts-only | `cd analytics-service && .venv/bin/python -m pytest tests/test_mt5offset_dry_run.py -q -p no:cacheprovider` | unit (CLI end to end) | ✅ extended `tests/test_mt5offset_dry_run.py` | ✅ green, 20 passed (plan 03 SUMMARY) |
| 230-03-T2 | MT5D-03 | replay runbook: capture contract, write review at a sha, command, fallback, replay, attribution | `grep -a -c CAPTURE-JSON docs/runbooks/mt5-clock-replay.md` and the plan's other greps | doc check | ✅ `docs/runbooks/mt5-clock-replay.md` | ✅ green (plan 03 SUMMARY) |
| 230-04-T1 | MT5D-02 | tracer: a missing lease RPC degrades loudly (`is_missing_rpc`, fallback hold, relog clock) | `pytest tests/test_db_is_missing_rpc.py tests/test_mt5_xlease.py -q -p no:cacheprovider` | unit | ✅ `tests/test_db_is_missing_rpc.py` | ✅ green (plan 04 SUMMARY) |
| 230-04-T2 | MT5D-02 | every other database error fails closed: error budget, bounded deadline, renew and release paths | pytest of the xlease, concurrency and is_missing_rpc files plus CI-form mypy strict | unit + type | ✅ | ✅ green (plan 04 SUMMARY) |
| 230-05-T1 | MT5D-02 | tracer: a derive that cannot reach the lease is classified transient | `pytest tests/test_job_worker.py -q -p no:cacheprovider -k "lease or classify"` | unit | ✅ extended `tests/test_job_worker.py` | ✅ green (plan 05 SUMMARY) |
| 230-05-T2 | MT5D-02 | holdings sync error and the two validate arms | `pytest tests/test_allocator_positions_non_ccxt.py tests/test_process_key.py tests/test_mt5_concurrency.py -q -p no:cacheprovider` | unit | ✅ extended | ✅ green (plan 05 SUMMARY) |
| 230-06-T1 | MT5D-02 | tracer: the new gate counts in the corpus (floors, runner pins) | `npx vitest run src/__tests__/mutation-runner-floors.test.ts src/__tests__/mutation-annotation-parser.test.ts src/__tests__/gate-family-meta.test.ts` | vitest census | ✅ | ✅ green; full mutation run clean (plan 06 SUMMARY) |
| 230-06-T2 | MT5D-02 | function and table censuses: NAME_SET_RATCHET, compared floor, types | `npx tsx scripts/dump-sql-functions.ts --check && node scripts/baseline-content-drift-check.mjs` | script + census | ✅ | ✅ green (plan 06 SUMMARY) |
| 230-06-T3 | MT5D-02 | gate-file censuses: lint count, anti-skip sentinels, ci.yml tables | `npx vitest run src/__tests__/lint-sql-gates.test.ts src/__tests__/drift-check-scripts.test.ts src/__tests__/contracts/ci-anti-skip-gate.contract.test.ts && node scripts/lint-sql-gates.mjs --self-test` | vitest census + lint | ✅ | ✅ green (plan 06 SUMMARY) |
| 230-07-T1 | MT5D-02 | [BLOCKING] migration applies on the lane, corpus passes, client reaches the RPCs through PostgREST | CI `sql-tests` (prints the `baseline-replay:` line) and CI `python` (`tests/test_mt5_xlease_live.py`, fails not skips under `CI=true`) at the PR head SHA | live lane | ✅ `tests/test_mt5_xlease_live.py` | ⚠️ NOT run locally (load limit); evidence is CI at the PR head SHA |
| 230-07-T2 | MT5D-02 | every suite the phase touches green on the lane the way CI runs it | CI `python`, `sql-tests`, frontend shards at the PR head SHA; locally only mypy, lints and targeted tests (plan 07 SUMMARY table) | CI | ✅ | ⚠️ full suites deferred to CI |
| 230-08-T1 | MT5D-02 | tracer: a ship-time re-stamp moves every pointer (rehearsal on a throwaway worktree) | the rehearsal in plan 08 Task 1 (`--parse-only`, `lint-sql-gates`, `dump-sql-functions --check`) | rehearsal | ✅ this file + the plan 08 SUMMARY checklist | ✅ green, worktree removed (plan 08 SUMMARY) |
| 230-08-T2 | MT5D-02, MT5D-03 | operator runbook, corrected single-replica invariant, ship records | `grep -a -c mt5_xlease_waited docs/runbooks/mt5-terminal-lease.md` and the TODOS lookups | doc check | ✅ `docs/runbooks/mt5-terminal-lease.md` | ✅ green (plan 08 SUMMARY) |
| 230-08-T3 | MT5D-02 | [BLOCKING] reviewer gates: migration-reviewer and rls-policy-auditor verdicts recorded | `grep -a -c "pending Task 3"` in the plan 08 SUMMARY prints 0 after the resume | human-action checkpoint | ✅ plan 08 SUMMARY | ⬜ pending |
| 230-09-T1 | MT5D-02 | tracer: the nightly read counts exactly the MT5 derives (lane-proven query in the runbook) | the plan 09 verify command (lane seed, extracted marked block, row equals `3|3|2|1|0|1|0|1|0`) | live lane | ❌ section not yet written | ⬜ pending (after ship) |
| 230-09-T2 | MT5D-02 | seven consecutive clean nights after both deploys | manual, see Manual-Only Verifications | manual | n/a | ⬜ pending |
| 230-09-T3 | MT5D-02 | record the nights and the close schedule | `grep -a -c "^| 2026-"` in the plan 09 SUMMARY | doc check | ❌ | ⬜ pending |
| 230-10-T1 | MT5D-03 | tracer: the hand-off works offline before the coordinator touches anything | the plan 10 verify (capture harness and contract check) | offline harness | ❌ | ⬜ pending |
| 230-10-T2 | MT5D-03 | the coordinator runs capture, restart and replay (D-02) | manual, see Manual-Only Verifications | manual | n/a | ⬜ pending |
| 230-10-T3 | MT5D-03 | per-scope attribution and close schedule | `grep -a -c -E "^\| s(2|5|6|8|9|10|13) "` in the plan 10 SUMMARY | doc check | ❌ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ not run locally, covered by CI at the PR head SHA*

Load-limit note (coordinator deviation 2026-11-25): plans 06 to 10 ran under a limit that forbids the full vitest suite, full pytest, the full mutation runner, e2e and Docker locally. A row marked ⚠️ has its evidence in CI's jobs bound to the PR head SHA, never in a local transcript.

---

## Wave 0 Requirements

- [x] `analytics-service/tests/test_mt5_xlease.py` (MT5D-02 unit and PROOF-01) — delivered by plan 02 (`230-02-SUMMARY.md`)
- [x] `analytics-service/tests/conftest.py` autouse default lease backend that grants — delivered by plan 02 (`230-02-SUMMARY.md`)
- [x] `analytics-service/tests/test_mt5_xlease_live.py` — file delivered by plan 07 (`230-07-SUMMARY.md`); its lane run is CI's, not a local transcript
- [x] `supabase/tests/test_mt5_terminal_lease.sql` with the migration and its down file — delivered by plan 01 (`230-01-SUMMARY.md`)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Seven consecutive clean nights after the lease deploy | MT5D-02 | needs real nights on PROD | plan 09: the nightly query in `docs/runbooks/mt5-terminal-lease.md` (section added by plan 09), marker first, from night 1 = the first 00:40Z derive after both the backfill and the API deploys carry the fix and after the migration's PROD apply |
| Clock replay of the 202 moved values (capture and replay) | MT5D-03 | live read-only capture on the worker, run by the coordinator (D-02) | plan 10: the capture and replay steps in `docs/runbooks/mt5-clock-replay.md`; the phase's agents never run the capture |
| Post-deploy checks (a) to (d) | MT5D-02 | read the live Railway deployments, variables, logs and PROD ledger | `docs/runbooks/mt5-terminal-lease.md` section 5, recorded as counts and yes/no only |
| Post-apply re-dump of `supabase/schema/baseline.sql` | MT5D-02 | needs the migration applied to PROD first | after the PROD apply, re-dump the baseline in a records PR; it clears the three NAME_SET_RATCHET rows in `scripts/dump-sql-functions.ts` (acquire, renew, release) and the SNAPSHOT_MISSING findings, and regenerates `baseline-carried-migrations.txt` in the same commit |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
