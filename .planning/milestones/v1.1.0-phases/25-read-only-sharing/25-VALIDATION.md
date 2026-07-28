---
phase: 25
slug: read-only-sharing
status: ready
nyquist_compliant: true
wave_0_complete: false
created: 2026-06-22
---

# Phase 25 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Read-Only
> Sharing is a security phase: the load-bearing proof is the two-tenant + anon
> CONTENT-leak SQL test (RLS/SECURITY DEFINER fail SILENTLY → assert sensitive
> fields ABSENT by field, never a 200/row-count). Every threat mitigation in the
> plans' `<threat_model>` blocks has a test that fails when the mitigation is removed.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework (TS)** | Vitest + `@vitest/coverage-v8` (coverage is a BLOCKING CI gate: lines 82 / stmts 80 / fns 74 / branches 72 per CLAUDE.md) |
| **Framework (SQL)** | Plain PL/pgSQL `DO $$ … RAISE EXCEPTION` under `psql -v ON_ERROR_STOP=1` (NO pgTAP) — auto-discovered by the `sql-tests` CI job's `supabase/tests/test_*.sql` glob |
| **Config file** | `vitest.config.ts` (thresholds); `.github/workflows/ci.yml` (`sql-tests`, `frontend-coverage`) |
| **Quick run command** | `npx vitest run <touched test file>` (per-file) |
| **Full suite command** | `npm run test:coverage` (TS) + `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/test_scenario_shares_rls.sql` (SQL, runs in CI after the migration applies to the test DB) |
| **Estimated runtime** | ~5s per TS file; full coverage suite ~minutes; SQL test seconds in CI |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run <touched test file>`.
- **After every plan wave:** Run `npm run test:coverage` (TS full + coverage gate); when the migration is applied to the test DB, the `sql-tests` job runs `test_scenario_shares_rls.sql`.
- **Before `/gsd:verify-work`:** Full TS suite green + coverage thresholds held + `test_scenario_shares_rls.sql` green.
- **Max feedback latency:** < 10s for the per-file TS quick runs.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 25-01-01 | 01 | 1 | SHARE-02 / SHARE-03 | T-25-01 / T-25-02 / T-25-03 / T-25-04 | anon/cross-tenant RPC returns ONLY own added-strategy series; no holdings/AUM/api_keys; empty-addedStrategies→[]; revoke→0 rows; anon direct→42501 | integration (SQL) | `psql … -f supabase/tests/test_scenario_shares_rls.sql` | ❌ W0 | ⬜ pending |
| 25-01-02 | 01 | 1 | SHARE-02 / SHARE-03 | T-25-01 / T-25-04 / T-25-05 | leak-scoped SECURITY DEFINER RPC + REVOKE PUBLIC/anon + self-verify + partial unique index; rollback | migration self-test + grep gate | (self-verify DO-block fails the apply on leak) + grep gates on the migration | ❌ W0 | ⬜ pending |
| 25-01-03 | 01 | 1 | SHARE-02 | — | scenario_shares typed in database.types; #14 notify_* tripwire intact | unit (type) | `npx vitest run src/lib/database.types.test.ts` | ❌ W0 | ⬜ pending |
| 25-02-01 | 02 | 1 | SHARE-01 | T-25-06 / T-25-07 | 256-bit base64url token; sha256 hex hash; raw≠hash; deterministic; no env secret | unit | `npx vitest run src/lib/scenario-share-token.test.ts` | ❌ W0 | ⬜ pending |
| 25-03-01 | 03 | 2 | SHARE-01 / SHARE-03 | T-25-08 / T-25-09 / T-25-10 / T-25-11 / T-25-12 | generate stores hash-not-raw, created_by-from-auth, pre-revoke, NEXT_PUBLIC_APP_URL origin; revoke sets revoked_at (no DELETE), 0-rows→404 | route | `npx vitest run src/app/api/allocator/scenario/share/route.test.ts src/app/api/allocator/scenario/share/revoke/route.test.ts` | ❌ W0 | ⬜ pending |
| 25-03-02 | 03 | 2 | SHARE-01 / SHARE-03 | T-25-12 | Share state machine: copied-only-on-real-success; generate/revoke failure→role=alert + onMutated NOT fired | component | `npx vitest run "src/app/(dashboard)/allocations/components/SavedScenariosList.test.tsx"` | ❌ W0 (extend existing) | ⬜ pending |
| 25-04-01 | 04 | 2 | SHARE-02 | T-25-13 | version-ahead/garbage draft → honest-absence, NEVER a rendered curve / live-book substitution (DI-23-01); empty-series→degenerate; ok→metrics | unit | `npx vitest run "src/app/scenario-share/[token]/share-resolve.test.ts"` | ❌ W0 | ⬜ pending |
| 25-04-02 | 04 | 2 | SHARE-02 / SHARE-03 | T-25-14 / T-25-15 / T-25-16 / T-25-17 / T-25-07 | force-dynamic + limit-first + RPC-gated; resolve→revoke→404 (route-layer immediacy); no getMyAllocationDashboard/USD/identity; honest-absence on version-ahead | integration (page) | `npx vitest run "src/app/scenario-share/[token]/page.test.tsx"` + grep gates on page.tsx | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `supabase/tests/test_scenario_shares_rls.sql` — two-tenant + anon CONTENT leak + empty-addedStrategies + unknown-token + revoke-immediacy + cross-tenant direct-read denial (SHARE-02, SHARE-03) [Plan 25-01 Task 1]
- [ ] `src/lib/database.types.test.ts` (extend) — scenario_shares hand-patch type guard, #14 tripwire intact (SHARE-02) [Plan 25-01 Task 3]
- [ ] `src/lib/scenario-share-token.test.ts` — token entropy/format/hash/determinism (SHARE-01) [Plan 25-02 Task 1]
- [ ] `src/app/api/allocator/scenario/share/route.test.ts` + `.../revoke/route.test.ts` — generate/revoke route behavior (SHARE-01, SHARE-03) [Plan 25-03 Task 1]
- [ ] `src/app/(dashboard)/allocations/components/SavedScenariosList.test.tsx` (extend) — Share/Copy/Revoke state machine (SHARE-01, SHARE-03) [Plan 25-03 Task 2]
- [ ] `src/app/scenario-share/[token]/share-resolve.test.ts` — DI-23-01 honest-absence branch (SHARE-02) [Plan 25-04 Task 1]
- [ ] `src/app/scenario-share/[token]/page.test.tsx` — resolve→revoke→404 + no-leak (SHARE-02, SHARE-03) [Plan 25-04 Task 2]
- [ ] Framework install: none — Vitest + the SQL test harness already exist.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Migration applies to the test DB | SHARE-02/03 | DDL applies at /ship-time (test project, sql-tests CI prereq) + /land (prod, Supabase Migrate workflow) — NOT during the autonomous build; do not `supabase db push` | At /ship: the `sql-tests` CI job applies the migration to the test project and runs `test_scenario_shares_rls.sql`. At /land: the `Supabase Migrate` GitHub workflow applies it to prod on push-to-main; verify anon NO-EXEC. |
| Real-browser recipient render (clipboard, hydration, visual) | SHARE-01/02 | Headless browse cannot hydrate authed pages; a real-Chromium pass proves the Share button + recipient page visually | `/qa` pass post-deploy: generate a link as an allocator, open it anon, confirm name-only header + PROJECTED framing + no USD/identity, then revoke and confirm 404. |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 10s (per-file TS quick runs)
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-06-22
