---
phase: "238"
slug: "nevercomputed"
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: "2026-11-24"
---

# Phase 238 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Source: 238-RESEARCH.md `## Validation Architecture`.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (jsdom default; node project list in `vitest.node-env.ts`); SQL-exec tests boot a throwaway PostgreSQL cluster |
| **Config file** | `vitest.config.ts`, `vitest.node-env.ts` |
| **Quick run command** | `npx vitest run "src/app/(dashboard)/strategies" src/lib/status-surface-copy.test.ts "src/app/factsheet/[id]/v2/page.owner-compute-state.test.tsx" src/lib/degrade-warnings.test.tsx src/__tests__/degrade-warning-scan.test.ts src/__tests__/copy-census.test.ts src/__tests__/no-email-in-copy.test.ts` |
| **Full suite command** | `npm test && npx tsc --noEmit && npm run lint` |
| **Estimated runtime** | quick ~90 s; full suite several minutes |

---

## Sampling Rate

- **After every task commit:** the quick run command for the files that task touched
- **After every plan wave:** quick run command plus `npx tsc --noEmit` (and, PR-2, `node scripts/lint-migration-data-dependence.mjs`)
- **Before `/gsd-verify-work`:** full suite green
- **Max feedback latency:** 120 seconds for the quick command

---

## Per-Task Verification Map

Per task (planner, 2026-11-24; PR-2 rows run only after the 238-04 gate):

| Task | Req | Automated command | Gate seen RED (PROOF-01) |
|------|-----|-------------------|--------------------------|
| 238-01 T1 (tracer) | FACT-05 | `npx vitest run "src/app/(dashboard)/strategies/page.key-pill.test.tsx" -t "NEVERCOMPUTED"` | Neuter A |
| 238-01 T2 | FACT-05 | strategies suite + degrade/copy censuses; `npm run typecheck && npm run lint` | Neuters A, B |
| 238-02 T1 (tracer) | FACT-05 | `npx vitest run ...page.merged.test.tsx ...page.key-pill.test.tsx -t "NEVERCOMPUTED\|PUBLIC"` | Neuter E |
| 238-02 T2 | FACT-05 | strategies suite + censuses; typecheck + lint | Neuters C, D |
| 238-03 T1 (tracer) | FACT-05 | `npx vitest run "src/app/factsheet/[id]/v2/page.owner-compute-state.test.tsx"` | Neuter H |
| 238-03 T2 | FACT-05 | `npx vitest run src/lib/status-surface-copy.test.ts ...` | Neuters F, G |
| 238-03 T3 | FACT-05 | PR-1 quick suite; typecheck + lint | n/a (ledger) |
| 238-04 T1-T2 | FACT-03 | blocking-human gate; SUMMARY records the PROD counts | n/a (gate) |
| 238-05 T1 (tracer) | FACT-03 | `npx vitest run src/__tests__/nevercomputed-backfill-sql-exec.test.ts`; data-dependence lint | Neuters I to L |
| 238-05 T2 | FACT-03 | same file; both SQL linters | Neuter M |
| 238-06 T1 (tracer) | FACT-03 | `npx vitest run src/lib/factsheet/never-computed-stamp.test.ts "src/app/factsheet/[id]/v2"` | Neuter N |
| 238-06 T2 | FACT-03 | `npm run typecheck`; the cast-count gate | the type flip itself |
| 238-07 T1 (tracer) | FACT-03 | `npx vitest run src/components/strategy/SyncBadge.trade-fetch.test.tsx -t "NEVERCOMPUTED"` | SyncBadge neuter |
| 238-07 T2 | FACT-03 | five NULL-pin files; typecheck + lint | AdminTabs, FactsheetPreview, HealthScore, sort-key neuters |
| 238-08 T1 (tracer) | FACT-03 | `npx vitest run src/__tests__/computed-at-reader-census.test.ts` | planted self-tests |
| 238-08 T2 | FACT-03 | census + `stored-analytics-result.test.ts`; typecheck + lint | Neuters O, P, Q |
| 238-09 T1 (tracer) | FACT-03 | `run.sh --check-currency`; lane SQL gates; `run.sh --assert-teardown` | n/a (replay) |
| 238-09 T2 | FACT-03 | exec test + data-dependence lint after review fixes | n/a (review) |
| 238-09 T3 | FACT-03 | `npm test && npm run typecheck && npm run lint`; SQL linters; `<human-check>` on the `apply-test` log | n/a |

Requirement-level map (from research):

| Requirement | Behavior | Test Type | Automated Command | File Exists | Status |
|-------------|----------|-----------|-------------------|-------------|--------|
| FACT-05 | failed / stalled / never-started note names the remedy, never waits | component | `npx vitest run "src/app/(dashboard)/strategies/page.key-pill.test.tsx"` | ✅ extend | ⬜ pending |
| FACT-05 | allocator-only viewer never gets edit/CSV link; parity with Health detail | component | `npx vitest run "src/app/(dashboard)/strategies/page.merged.test.tsx"` | ✅ extend | ⬜ pending |
| FACT-05 | published row: unknown state → KCS12-PUBLIC-UNKNOWN with no RPC; known state → action note, one jobs read | component | key-pill file | ✅ re-point | ⬜ pending |
| FACT-05 | owner pending page note ends on the page's remedy action | component | `npx vitest run "src/app/factsheet/[id]/v2/page.owner-compute-state.test.tsx"` | ✅ re-point | ⬜ pending |
| FACT-05 | copy constants exact; no `yet` / `once a computation succeeds` on the kind-less not-available arm; floor re-measured | unit | `npx vitest run src/lib/status-surface-copy.test.ts` | ✅ extend | ⬜ pending |
| FACT-03 | migration nulls exactly the never-computed rows, fails loud without the trigger bypass, idempotent, rollback writes epoch | node + cluster | `npx vitest run src/__tests__/nevercomputed-backfill-sql-exec.test.ts` | ❌ W0 | ⬜ pending |
| FACT-03 | reader census fails on an unclassified or stale reader | unit | `npx vitest run src/__tests__/computed-at-reader-census.test.ts` | ❌ W0 | ⬜ pending |
| FACT-03 | NULL date renders no date (SyncBadge, factsheet Terms row and footer stamp `—`) | component | SyncBadge test + new factsheet focused test | partial / ❌ W0 | ⬜ pending |
| FACT-03 | typecheck after `computed_at: string \| null` | static | `npx tsc --noEmit` | n/a | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [x] `npm ci` in the worktree (done 2026-11-24)
- [x] PROD aggregate probe (done 2026-11-24, recorded in RESEARCH Open Question 1; re-run at PR-2 wave 0)
- [ ] `src/__tests__/computed-at-reader-census.test.ts` — FACT-03 SC-1 (PR-2)
- [ ] `src/__tests__/nevercomputed-backfill-sql-exec.test.ts` — FACT-03 backfill, rollback, post-migration (PR-2)
- [ ] focused factsheet NULL-date test (PR-2)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| `DISABLE TRIGGER` is permitted to the managed migration role | FACT-03 | only the TEST `apply-test` run can show managed-role privilege | read the `apply-test` log of the PR-2 merge; a refusal rolls back the transaction |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 120s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
