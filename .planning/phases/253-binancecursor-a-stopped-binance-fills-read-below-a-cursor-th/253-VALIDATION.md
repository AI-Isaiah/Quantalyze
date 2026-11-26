---
phase: "253"
slug: "binancecursor-a-stopped-binance-fills-read-below-a-cursor-th"
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: draft
nyquist_compliant: true
wave_0_complete: false
created: "2026-11-26"
---

# Phase 253 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | pytest (run only from `analytics-service/`), mypy strict, plain PL/pgSQL `DO` gates under `supabase/tests` on the pg-lane (local Postgres, no Docker) through `scripts/mutation-runner/run.mjs`, vitest for census pins |
| **Config file** | `analytics-service/pytest.ini`, `analytics-service/pyproject.toml`, `vitest.config.ts`, `scripts/mutation-runner/GRAMMAR.md` |
| **Quick run command** | `cd analytics-service && python3 -m pytest tests/test_binancefills_cursor.py -q -p no:cacheprovider` |
| **Full suite command** | targeted only (LOAD LIMIT): the per-plan `<automated>` lines; no full pytest or vitest suite |
| **Estimated runtime** | ~30 s per pytest group, ~2-4 min for the narrowed mutation run |

---

## Sampling Rate

- **After every task commit:** the task's own `<automated>` command(s)
- **After every plan wave:** wave 1: plan 01's narrowed mutation run + plan 02's cursor suites; wave 2: plan 03's four census vitest files (`--maxWorkers=2`) + plan 04's six pytest files + mypy strict on touched services
- **Before `/gsd-verify-work`:** every plan's PROOF-01 neuters recorded verbatim in its SUMMARY
- **Max feedback latency:** 240 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 253-01-01 | 01 | 1 | SC-1, D-01, D-05 | T-253-01, T-253-04 | table + fenced SECDEF RPC apply; case C1 written | SQL gate (pg-lane) | `node scripts/mutation-runner/run.mjs --file supabase/tests/test_strategy_fills_reread_bound.sql` | ❌ W0 | ⬜ pending |
| 253-01-02 | 01 | 1 | SC-1, D-03, D-05 | T-253-02, T-253-03, T-253-05 | C0-C10, FENCE, ACL, POLICY, CASCADE arms bite; rollback file exists | SQL gate + lint | same + `node scripts/lint-sql-gates.mjs --self-test && node scripts/lint-sql-gates.mjs` | ❌ W0 | ⬜ pending |
| 253-01-03 | 01 | 1 | SC-5, D-11 | T-253-02 | N1 reds C4, N2 reds FENCE 1; migration byte-restored | neuter | `cmp` of the scratch backup against the migration | ❌ W0 | ⬜ pending |
| 253-02-01 | 02 | 1 | SC-1, D-01, D-04 | T-253-06 | run 2 seeds at the stop bound; OKX makes no bound call | unit | `cd analytics-service && python3 -m pytest tests/test_binancefills_cursor.py tests/test_okxtrades_cursor.py tests/test_binancefills_e2e.py -q` | ✅ (extend) | ⬜ pending |
| 253-02-02 | 02 | 1 | SC-2, D-05, D-06, D-07 | T-253-07, T-253-08 | stop+partial, partial-only, raised read flagged on Binance only; failed bound write holds the stamp | unit | `cd analytics-service && python3 -m pytest tests/test_binancefills_cursor.py tests/test_okxtrades_cursor.py -q` | ✅ (extend) | ⬜ pending |
| 253-02-03 | 02 | 1 | D-02, D-03, D-04, SC-5 | T-253-09 | three-step interleave, stall, mirror == case table, contract blocks of plans 01 and 02 diff empty; P0-P5 neuters | unit + neuter + mypy + diff | the task's four `<automated>` lines | ✅ (extend) | ⬜ pending |
| 253-03-01 | 03 | 2 | D-12 | T-253-11 | snapshot generated; ratchet row; COMPARED_FLOOR measured | script check | `npm run schema:functions:check` | ❌ W0 (generated) | ⬜ pending |
| 253-03-02 | 03 | 2 | D-12 | T-253-10 | floors and vitest pins equal the runner's measured corpus | vitest | `npx vitest run --maxWorkers=2` on the four census test files | ✅ (edit) | ⬜ pending |
| 253-04-01 | 04 | 2 | SC-3, D-08 | T-253-13, T-253-14, T-253-16 | both named keys survive the derive prestamp, the CSV rebuild and every failure writer (`_derive_failed_payload`, `_mark_failed`, `_mark_truncated`, `_mark_config_failed`, `_mark_unrecoverable`); first derive unchanged; a failing guarded read never blocks a failure stamp | unit | `cd analytics-service && python3 -m pytest tests/test_derive_broker_dailies_dualmode.py tests/test_csv_analytics_runner.py -q -k "binance or BinanceSyncFlag or daily_pnl_malformed or DroppedRow or NavReconstruction or insufficient or truncat or config"` | ✅ (extend) | ⬜ pending |
| 253-04-02 | 04 | 2 | SC-3, D-09 | T-253-12, T-253-15 | next clean sync clears; raised/off/non-Binance/load-failed keep; parity scan | unit | `cd analytics-service && python3 -m pytest tests/test_binance_sync_flags.py tests/test_binancefills_cursor.py tests/test_okxtrades_cursor.py -q` | ❌ W0 (new file) | ⬜ pending |
| 253-04-03 | 04 | 2 | SC-4, SC-5, D-10, D-11 | — | comment rewritten, TODOS entry deleted, switch unchanged; F1-F7 neuters | mypy + unit + grep | mypy strict on four services + the six pytest files | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `supabase/tests/test_strategy_fills_reread_bound.sql` — new SQL gate (plan 01), RED-UNDER annotated, no `ARMS EXECUTED` sentinel
- [ ] `analytics-service/tests/_binance_fills.py` — `bound_after_set` mirror + `RereadBounds` stateful fake (plan 02 task 1, before any worker edit)
- [ ] `analytics-service/tests/test_okxtrades_cursor.py` — `_make_supabase(bounds=)` routing and `_run_job(exchange=, strategy_id=)` (plan 02 task 1)
- [ ] `analytics-service/tests/test_binance_sync_flags.py` — new (plan 04 task 2)
- No framework install: pytest, mypy, vitest and the pg-lane already exist.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| The new gate on the REAL schema (local-stack lane) | SC-5, D-12 | the gate seeds api_keys and compute_jobs rows the real schema constrains more strictly than the pg-lane stand-ins (Phase 225 measured exactly this miss) | plan 01 task 2: one `scripts/local-stack/run.sh up`, psql the gate, then `down` and `--assert-teardown`; if Docker is unavailable CI `sql-tests` is the first real-schema run, recorded in the SUMMARY |
| Migration review | D-12 | migration-reviewer and rls-policy-auditor clean at MEDIUM+ before merge (auto-applies to TEST then PROD with no human stop) | at review/ship time, after plan 01 |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 240s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending (set by /gsd-validate-phase)
