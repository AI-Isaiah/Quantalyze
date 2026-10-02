---
phase: 23
slug: scenario-persistence-compare
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-21
---

# Phase 23 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Derived from 23-RESEARCH.md §Validation Architecture + §Security Domain.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest (TS unit/route/component) + plain PL/pgSQL `DO $$` blocks under `psql` (SQL/RLS) |
| **Config file** | `vitest.config.ts` (coverage gate: lines 82 / stmts 80 / fns 74 / branches 72) |
| **Quick run command** | `npx vitest run <touched test file(s)>` |
| **Full suite command** | `npm test` + `sql-tests` CI job (`psql -v ON_ERROR_STOP=1 -f supabase/tests/test_*.sql`) |
| **Estimated runtime** | ~30 s quick · full suite several min |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run <touched test file(s)>` (< 30 s).
- **After every plan wave:** Run `npm test` (full vitest) + `npm run typecheck` + `npm run lint`.
- **Before `/gsd:verify-work`:** Full suite green + `sql-tests` green (where the test DB is configured). Coverage is a blocking CI gate (`frontend-coverage`).
- **Max feedback latency:** 30 s

---

## Per-Task Verification Map

| Req | Behavior | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|-----|----------|------------|-----------------|-----------|-------------------|-------------|--------|
| PERSIST-01 | Save validates draft (zod) + writes RLS-scoped row; name 1..120 trim | V5 / T-malformed-draft | 400 before rate-limit; `allocator_id = user.id` never client-supplied | route (vitest) | `npx vitest run src/app/api/allocator/scenario/saved/route.test.ts` | ❌ W0 | ⬜ pending |
| PERSIST-01 | Cross-tenant: A cannot read/update/delete B's scenario (assert by row id) | V4 / T-cross-tenant | RLS owner policy USING+WITH CHECK + content assertion | SQL/RLS | `psql … -f supabase/tests/test_scenarios_rls.sql` | ❌ W0 | ⬜ pending |
| PERSIST-01 | DB types expose `scenarios` Row/Insert + nullability | — | hand-patched types match migration | type (vitest) | `npx vitest run src/lib/database.types.test.ts` | ⚠️ extend | ⬜ pending |
| PERSIST-02 | Reopen `ok` hydrates; drift → banner; `reset` → honest notice (no empty composer); `readonly` → block edits | — (honesty) | no silent default; codec applied before hydrate | hook/component (vitest) | `npx vitest run src/app/(dashboard)/allocations/hooks/useScenarioState` | ❌ W0 | ⬜ pending |
| PERSIST-03 | List/rename/delete RLS-scoped; rename re-validates length | V4/V5 | owner-scoped; 400 on bad name | route (vitest) | `npx vitest run "src/app/api/allocator/scenario/saved/[id]/route.test.ts"` | ❌ W0 | ⬜ pending |
| PERSIST-04 | Each draft → `computeScenario` over live payload; per-column N; degenerate → "—"; Sharpe-leader/winner highlight | — (honesty) | em-dash never fabricated 0; independent windows | math+component (vitest) | `npx vitest run src/app/(dashboard)/allocations/lib/scenario-compare.test.ts` | ❌ W0 | ⬜ pending |
| PERSIST-04 | `computeScenario` behaviors not regressed | — | — | math (vitest) | `npx vitest run src/lib/scenario.test.ts` | ✅ (no regress) | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `supabase/tests/test_scenarios_rls.sql` — two-tenant cross-content RLS (covers PERSIST-01 isolation; mirror `test_funding_fees_rls.sql`, assert by row id).
- [ ] `src/app/api/allocator/scenario/saved/route.test.ts` + `[id]/route.test.ts` — CRUD route conventions (covers PERSIST-01/03; copy `commit/route.test.ts`).
- [ ] `src/app/(dashboard)/allocations/lib/scenario-compare.ts` + `.test.ts` — pure draft→metrics helper (covers PERSIST-04 math).
- [ ] Hydration-seam test in/near `useScenarioState` — covers PERSIST-02 drift/version honesty.
- [ ] Extend `src/lib/database.types.test.ts` with `scenarios` `expectTypeOf` pins.
- [ ] No framework install needed — vitest + psql already wired.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Migration applies cleanly to prod; RLS live-verified anon NO-EXEC | PERSIST-01 | Executor does NOT push to prod; migration applies at `/land-and-deploy` | At land: confirm migration in deploy, then anon query of `scenarios` returns 0 rows / RLS denies (per the project's land-time migration verify) |

---

## Validation Sign-Off

- [ ] All tasks have automated verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30 s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
