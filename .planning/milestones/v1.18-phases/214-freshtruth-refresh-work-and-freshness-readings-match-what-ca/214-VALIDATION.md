---
phase: "214"
slug: "freshtruth"
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: "2026-11-14"
---

# Phase 214 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Source: 214-RESEARCH.md "Validation Architecture" and the verify commands in 214-01 to 214-07.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | PL/pgSQL gates on the throwaway pg-lane plus the mutation runner (`RED-UNDER-M` twins); vitest (Node 22); pytest from `analytics-service/`; Playwright on the seeded local stack |
| **Config file** | `scripts/mutation-runner/GRAMMAR.md`, `vitest.config.ts`, `analytics-service/pytest.ini`, `playwright.config.ts` |
| **Quick run command** | one touched gate: `APPLY=$(node -e '…RED-UNDER-SETUP…' <gate.sql>) && bash scripts/pg-lane/run.sh --workdir "$TMPDIR/pglane-214-NN" --apply $APPLY --gate <gate.sql>`; one vitest file: `PATH=/opt/homebrew/opt/node@22/bin:$PATH npx vitest run <file>`; one pytest file: `cd analytics-service && python3 -m pytest tests/<file> -q` |
| **Full suite command** | `PATH=/opt/homebrew/opt/node@22/bin:$PATH npm test`, `npm run typecheck`, `npm run lint`, `npm run schema:functions:check`; the analytics-service pytest files that read `supabase/(tests|migrations)`; subset mutation run over the four touched gate files (CI owns the FULL run) |
| **Estimated runtime** | quick: about 5-60 s per gate or file; full: several minutes (npm test) plus about 1 s per mutation arm |

---

## Sampling Rate

- **After every task commit:** the task's own `<automated>` command (one gate on the lane, one vitest file, or one pytest file).
- **After every plan wave:** every touched gate on the lane, the subset mutation run for those files, `pytest tests/test_ledger_refresh_gates.py tests/test_sql_gate_scoped_updates.py`. Census vitest files are expected RED from wave 1 until plan 07, by construction.
- **Before `/gsd-verify-work`:** full suite green (plan 07 Task 2).
- **Max feedback latency:** 214 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 214-01-01 | 01 | 1 | SC-1, SC-7 | T-214-02 | services/ byte-identical after neuter | pytest characterization | `cd analytics-service && python3 -m pytest tests/test_mt5_series_end_is_last_ledger_day.py -q` | ❌ W0 | ⬜ pending |
| 214-01-02 | 01 | 1 | SC-1 | T-214-01 | no ids or home paths in the record | grep | `grep -a -c -E '<uuid regex>' 214-DIAGNOSIS.md; test $? -eq 1` | ❌ W0 | ⬜ pending |
| 214-02-01 | 02 | 1 | SC-3, SC-6 | T-214-03 | security_invoker + service_role-only asserted at apply | SQL gate + static gate | lane: `test_ledger_refresh_staleness.sql` (ALL 9); `python3 -m pytest tests/test_ledger_refresh_gates.py -q`; `lint-migration-data-dependence.mjs` | ✅ | ⬜ pending |
| 214-02-02 | 02 | 1 | SC-3, SC-7 | T-214-05 | is_stale / is_closed never NULL | SQL gate + twins | lane (ALL 14); `run.mjs --subset-from` staleness | ✅ | ⬜ pending |
| 214-02-03 | 02 | 1 | SC-3, SC-7 | T-214-07 | rollback restores ACL and verdict | SQL gate + rollback lane | lane: composite gate (ALL 24); staleness gate + rollback fails at arm I | ✅ | ⬜ pending |
| 214-03-01 | 03 | 2 | SC-2, SC-6 | T-214-08, T-214-12 | SECDEF search_path, REVOKE, VAC-04 ack | SQL gate + static gate | lane: `test_ledger_refresh_fanout.sql` (ALL 32); gates pytest | ✅ | ⬜ pending |
| 214-03-02 | 03 | 2 | SC-2, SC-7 | T-214-09, T-214-10 | cap narrow, never exclude | SQL gate + twins | lane (ALL 35); subset mutation run | ✅ | ⬜ pending |
| 214-03-03 | 03 | 2 | SC-6, SC-7 | T-214-11 | catalogue-only verify; rollback | snapshot + rollback lane | `npm run schema:functions:check`; rollback lane fails at NA1 | ✅ | ⬜ pending |
| 214-04-01 | 04 | 1 | SC-8, SC-7 | T-214-13 | id shape allowlisted | vitest + SQL gate | `npx vitest run src/app/api/strategies/finalize-wizard/route.test.ts`; lane dedup gate (ALL 17) | ✅ | ⬜ pending |
| 214-04-02 | 04 | 1 | SC-8, SC-7 | T-214-15 | marker callers retract nothing | vitest + twins | `npx vitest run src/__tests__/csv-validate-route.test.ts …`; subset run | ✅ | ⬜ pending |
| 214-04-03 | 04 | 1 | SC-8 | — | N/A (prose) | vitest + lane + lint | marker tests; lane (ALL 18); `lint-sql-gates.mjs` | ✅ | ⬜ pending |
| 214-05-01 | 05 | 1 | SC-5 | T-214-16, T-214-18 | lane-only seeding; no vacuous green | Playwright | `npx playwright test e2e/freshness-chip-width.spec.ts --list`; `npx tsc --noEmit` | ❌ W0 | ⬜ pending |
| 214-05-02 | 05 | 1 | SC-5, SC-7 | T-214-18 | GREEN only with column ≤ about 230px | vitest + Playwright | chip-honesty and recency-line vitest; the spec on the booted lane, no skips | ✅ | ⬜ pending |
| 214-05-03 | 05 | 1 | SC-5 | — | N/A | grep + vitest | `grep -a -c 'e2e/freshness-chip-width.spec.ts' .github/workflows/ci.yml`; `critical-regressions.test.ts` | ✅ | ⬜ pending |
| 214-06-01 | 06 | 3 | SC-2, SC-6 | T-214-19, T-214-20 | skip row error NULL; best-effort after unlock | SQL gate | lane fan-out gate (ALL 36) | ✅ | ⬜ pending |
| 214-06-02 | 06 | 3 | SC-2, SC-7 | T-214-19 | only cap-caused skips counted | SQL gate + twins | lane (ALL 38); subset mutation run | ✅ | ⬜ pending |
| 214-06-03 | 06 | 3 | SC-6 | T-214-22 | snapshot current | snapshot + static | `schema:functions:check`; gates pytest; `lint-migration-data-dependence.mjs` | ✅ | ⬜ pending |
| 214-07-01 | 07 | 4 | SC-7 | T-214-23 | floors raised, ratchet bites | vitest | census vitest files; `run.mjs --parse-only` | ✅ | ⬜ pending |
| 214-07-02 | 07 | 4 | SC-7 | T-214-23, T-214-24 | table re-derivable | vitest + full suite | anti-skip contract tests; `npm test`; scoped-updates + gates + SC-1 pytest; typecheck + lint | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

### Per-success-criterion map

| SC | Proof | Can fail when reverted |
|----|-------|------------------------|
| SC-1 | `214-DIAGNOSIS.md` (verdict H1, inferred flag reconciliation, two residuals) + characterization pytest | pytest RED with `gap_fill_daily_returns` extended to today |
| SC-2 | fan-out arms NA1-NA4 (cap), SK1-SK3 (skip count) | NA1 RED on the pre-phase body and on the rollback lane; SK1 RED on plan 03's body |
| SC-3 | staleness arms I-N, composite arm CL | arm I RED without the view migration and on the rollback lane |
| SC-4 | orchestrator: post-merge PROD read via MCP, marker query first | n/a (measurement) |
| SC-5 | seeded 1485px spec (column ≤ about 230px) + jsdom pin | spec and pin RED on the old markup (byte-backup neuter) |
| SC-6 | catalogue-only apply checks, restated ACL, VAC-04 ack; orchestrator runs migration-reviewer + rls-policy-auditor before merge | n/a (review) |
| SC-7 | every new arm has a biting twin; census floors raised | ratchet neuters N1/N2 in plan 07 |
| SC-8 | exact-object TS tests + SQL arms FINALIZE-WIZARD-SHAPE, CSV-FINALIZE-SHAPE | TS tests RED on the Phase 211 code and on a neuter |

---

## Wave 0 Requirements

- [ ] `PATH=/opt/homebrew/opt/node@22/bin:$PATH npm ci` in each executing worktree (no `node_modules`; it does not travel between worktrees, so plans 02-07 each run it first)
- [ ] `analytics-service/tests/test_mt5_series_end_is_last_ledger_day.py` (plan 01)
- [ ] `e2e/freshness-chip-width.spec.ts` (plan 05), plus a booted local stack (`scripts/local-stack/run.sh up`, Docker)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Stale count drained on PROD, or each remaining row named with its reason | SC-4 | PROD read after merge; executors never touch PROD | Orchestrator: Supabase MCP, marker query first, then read `ledger_refresh_staleness` (counts and ages only) |
| migration-reviewer and rls-policy-auditor clean | SC-6 | Review agents run by the orchestrator before merge | Run both on the two migrations and the rollbacks |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 214s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
