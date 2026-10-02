---
phase: 07-demo-mode-purge
plan: 06
subsystem: testing
tags: [vitest, audit, static-scan, regression-guard, supabase, onboarding]

# Dependency graph
requires:
  - phase: 06-allocator-api-ingestion
    provides: "allocator_holdings table + api_keys sync_status taxonomy — referenced by the migration co-occurrence scan"
provides:
  - "Import-graph scan in src/__tests__/seed-integrity.test.ts mechanically enforcing PURGE-01/PURGE-06 via explicit allowlist"
  - "Migration co-occurrence scan (VOICES-ACCEPTED f4) asserting no supabase/migrations/*.sql file contains BOTH `ON auth.users` AND `INSERT INTO public.(portfolios|allocator_holdings|allocator_equity_snapshots)`"
  - "Positive-control test locking migration 002 `on_auth_user_created` trigger as profiles-only"
  - "OnboardingWizard noseed regression test (PURGE-05) asserting handleComplete only writes to profiles"
affects: [phase-08-connection-management, phase-09-bridge-live, phase-10-scenario, phase-11-onboarding-security]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Filesystem-walking regex audit via node:fs readdirSync/statSync — no glob dependency"
    - "Per-migration-file co-occurrence check (f4 pattern) — stricter than a global single-occurrence assertion"
    - "Component-level noseed regression via vi.mock('@/lib/supabase/client') capturing .from(table) + .update/.insert calls"

key-files:
  created:
    - "src/components/auth/OnboardingWizard.noseeed.test.tsx"
    - ".planning/phases/07-demo-mode-purge/deferred-items.md (pre-existing GDPR manifest failure logged out of scope)"
  modified:
    - "src/__tests__/seed-integrity.test.ts (extended with 2 new describe blocks, 7 new tests)"

key-decisions:
  - "Task 3b (DROP TRIGGER migration) NOT required — pre-flight grep confirms migration 002 is the only `ON auth.users` site and inserts only into `public.profiles`"
  - "Allowlist kept as plan-specified: demo.ts + demo.test.ts + seed-integrity.test.ts + admin/match.ts + src/app/demo/ prefix + src/app/api/demo/ prefix. admin/match.ts has no current demo-constant reference but stays in the list per RESEARCH.md §4 row"
  - "OnboardingWizard noseed test drives handleComplete via UI (Continue → Get started); asserts router.push is called to settle the async chain before making mock-call assertions"

patterns-established:
  - "Pattern: Explicit allowlist + per-file path check for forbidden-import scans. Copy this block for future PURGE-style audits"
  - "Pattern: f4 co-occurrence scan — stronger than naive single-substring global assertions"

requirements-completed: [PURGE-01, PURGE-05, PURGE-06]

# Metrics
duration: ~5 min (elapsed wall-clock)
completed: 2026-04-20
---

# Phase 07 Plan 06: Demolition Close — Audit + Regression Tests Summary

**Mechanically enforces PURGE-01 / PURGE-05 / PURGE-06 via two test artefacts: a filesystem import-graph scan with explicit allowlist + VOICES-ACCEPTED f4 per-migration co-occurrence audit, and a component-level OnboardingWizard noseed regression. Zero production code changed — the codebase is already in the target state.**

## Performance

- **Duration:** ~5 min (wall-clock)
- **Started:** 2026-04-20T17:04:00Z
- **Completed:** 2026-04-20T17:09:30Z (approx)
- **Tasks:** 3
- **Files modified:** 2 (1 extended, 1 created) + 1 deferred-items ledger

## Accomplishments

- Extended `src/__tests__/seed-integrity.test.ts` with two new describe blocks: PURGE-01/PURGE-06 import-graph scan (5 new tests) and PURGE-05 / VOICES-ACCEPTED f4 migration co-occurrence + positive-control scan (2 new tests).
- Created `src/components/auth/OnboardingWizard.noseeed.test.tsx` (5 tests) asserting `handleComplete` only calls `supabase.from('profiles').update(...)` and never fires `.insert` on any table.
- Confirmed the VOICES-ACCEPTED f4 pre-flight: `grep -rn "ON auth.users" supabase/migrations/` yields exactly one hit (migration 002:82), the benign `on_auth_user_created` trigger — Task 3b (DROP TRIGGER migration) was NOT required.
- All 7 new seed-integrity tests + 5 new OnboardingWizard tests PASS against the current codebase.

## Task Commits

Each task was committed atomically:

1. **Task 1: Extend seed-integrity.test.ts with PURGE-01/06 import-graph scan + f4 co-occurrence** — `2eb383d` (test)
2. **Task 2: OnboardingWizard noseed regression test** — `281b917` (test)
3. **Task 3: SUMMARY.md + audit table + decision traceability** — this file (committed with metadata commit alongside STATE.md + ROADMAP.md)

_TDD note: The plan marks Tasks 1–2 as `tdd="true"`, but production code is already seed-free (see RESEARCH.md §4 + §5). The new tests are regression guards that pass GREEN against the current codebase — there is no RED → GREEN cycle. This is the intended shape per VOICES-ACCEPTED f4 ("doc-only strengthened to test-enforced"); see "Deviations from Plan" below for the TDD gate notation._

## Files Created/Modified

- `src/__tests__/seed-integrity.test.ts` — Extended with:
  - `describe("PURGE-01 / PURGE-06: demo constants confined to /demo + test fixtures")` with 5 `it` tests covering queries.ts, src/app/(dashboard), src/app/api (excl. /api/demo), src/lib (excl. demo files + admin/match.ts), and an exact-allowlist assertion.
  - `describe("PURGE-05 / VOICES-ACCEPTED f4: no migration file co-occurs ON auth.users + seed-INSERT")` with 2 `it` tests: co-occurrence negative check + migration 002 positive control.
  - Uses node:fs `readdirSync` + `statSync` — zero external glob dependency.
  - 483 lines total (up from 322). 31/31 tests GREEN.
- `src/components/auth/OnboardingWizard.noseeed.test.tsx` — New file, 146 lines, 5 tests. Mocks `@/lib/supabase/client` (capturing `.from(table)` + `.update/.insert` calls) and `next/navigation`. Drives `handleComplete` via the UI (`fireEvent.click` on "Continue" then "Get started"), awaits `router.push` via `waitFor` to settle the async chain, then asserts the mock call shape.
- `.planning/phases/07-demo-mode-purge/deferred-items.md` — New ledger for one pre-existing out-of-scope test failure (GDPR manifest coverage hook).

## Audit Tables

### PURGE-01 / PURGE-06 Call-Site Audit (per RESEARCH.md §4, enforced by Task 1)

| File | Symbol | Path Type | Phase 07 Action | Test enforces |
|------|--------|-----------|------------------|---------------|
| `src/lib/demo.ts` | `ALLOCATOR_ACTIVE_ID`, `isDemoPortfolioId` | Library (demo-only) | No change (D-14) | Allowlist entry |
| `src/lib/demo.test.ts` | `ALLOCATOR_ACTIVE_ID`, `isDemoPortfolioId` | Test (demo-only) | No change (D-14) | Allowlist entry |
| `src/__tests__/seed-integrity.test.ts` | `ALLOCATOR_ACTIVE_ID` | Test (demo fixture) | No change (D-14) | Allowlist entry |
| `src/app/api/demo/match/[allocator_id]/route.ts` | `ALLOCATOR_ACTIVE_ID` | Public `/api/demo` (marketing) | No change (D-14) | `src/app/api/demo/` prefix allowlist |
| `src/app/api/demo/portfolio-pdf/[id]/route.ts` | `isDemoPortfolioId` | Public `/api/demo` (marketing) | No change (D-14) | `src/app/api/demo/` prefix allowlist |
| `src/app/demo/founder-view/page.tsx` | `ALLOCATOR_ACTIVE_ID` | Public `/demo` (marketing) | No change (D-14) | `src/app/demo/` prefix allowlist |
| `src/app/demo/page.tsx` | `isDemoPortfolioId` | Public `/demo` (marketing) | No change (D-14) | `src/app/demo/` prefix allowlist |
| `src/lib/admin/match.ts` | (none — documented in RESEARCH.md §4 as admin-only doc comment; current grep shows no reference) | Admin-only tooling | No change (D-14) | Allowlist entry (forward-compatible) |
| `src/lib/portfolio-insights.ts` | None | Authenticated but not imported | Confirmed clean | src/lib forbidden-import test |
| `src/lib/queries.ts` | None | Authenticated (`getMyAllocationDashboard`) | Confirmed clean | Dedicated queries.ts test |

**Conclusion:** Zero authenticated code paths reference seed constants. The exact-allowlist test asserts the `referencing` set is a subset of the allowlist on every run — any future regression fails CI. No call sites remain deferred; all are accounted for.

### PURGE-05 OnboardingWizard Disposition

`OnboardingWizard.handleComplete` (`src/components/auth/OnboardingWizard.tsx` lines 21–65) is seed-free today — verified by Task 2's 5 regression tests. It calls `supabase.auth.getUser()` then `supabase.from("profiles").update(...).eq("id", user.id).select()` and redirects. No portfolios insert, no allocator_holdings insert, no allocator_equity_snapshots insert. The DB-level trigger `on_auth_user_created` (migration 002 lines 71–83) inserts only into `public.profiles`. No code deletion required.

### VOICES-ACCEPTED f4 Migration Audit

**Pre-flight grep output (2026-04-20):**

```bash
$ grep -rn "ON auth.users" supabase/migrations/
supabase/migrations/002_rls_policies.sql:82:  AFTER INSERT ON auth.users
```

Exactly one hit — the benign `on_auth_user_created` trigger whose body inserts only into `public.profiles`.

**Co-occurrence scan result:** Task 1's f4 block iterates every `supabase/migrations/*.sql` file and tests for the conjunction `ON auth.users` AND `INSERT INTO (public.)?(portfolios|allocator_holdings|allocator_equity_snapshots)` (case-insensitive). Result across all 70 migration files: **zero offenders**.

**Positive control (locking the benign trigger):** Task 1 also asserts migration 002 contains `CREATE TRIGGER on_auth_user_created`, the identifier `handle_new_user`, and `INSERT INTO public.profiles`; AND asserts it does NOT contain `INSERT INTO public.portfolios`, `INSERT INTO allocator_holdings`, or `INSERT INTO allocator_equity_snapshots`.

**Task 3b status:** NOT required. The pre-flight found no seed-inserting trigger on `auth.users` anywhere, so there is no DROP TRIGGER migration to author. If a future migration regresses this, the f4 co-occurrence test surfaces the offender and a Task 3b can be added to the next phase.

## Decision Traceability

| Decision | Phase-07 Context | Verifying Test |
|----------|------------------|----------------|
| **D-12** (Audit scope narrower than expected — authenticated paths already clean) | `07-CONTEXT.md` | `src/__tests__/seed-integrity.test.ts` PURGE-01/06 describe (5 tests) |
| **D-13** (New-user signup → `profiles.update` only, no seed portfolio) | `07-CONTEXT.md` | `src/components/auth/OnboardingWizard.noseeed.test.tsx` (5 tests) |
| **D-14** (Keep `/demo` unchanged — allowlisted, untouched) | `07-CONTEXT.md` | Explicit `DEMO_REFERENCE_ALLOWLIST` + `DEMO_ROUTE_PREFIXES` in Task 1 |
| **D-15** (No `ALLOCATOR_ACTIVE` feature flag — only the ID constant; nothing to remove) | `07-CONTEXT.md` | PURGE-01 describe; the demo-pattern regex matches `ALLOCATOR_ACTIVE_ID` but not a feature-flag symbol — there is none |

## Decisions Made

See frontmatter `key-decisions`. Three execution-level decisions, all minor.

## Deviations from Plan

**None — plan executed exactly as written.**

The TDD `<task ... tdd="true">` annotation is present on Tasks 1 and 2 but a literal RED-then-GREEN cycle would have required breaking production code to make the test fail first. The plan's own `<objective>` states "Zero production code change (no seed code to delete — it already isn't there; f4 migration audit confirmed clean)" — the tests are designed as regression guards, which are inherently green-on-first-run. This is NOT a deviation: the plan body explicitly narrates this ("the codebase is already in the target state; these tests prevent regression" — see plan `<success_criteria>`). The TDD attribute signals "test-first authoring discipline" (the tests were authored before any potential production adjustment), not "must fail first".

## Issues Encountered

**Pre-existing, out-of-scope failure (logged, not fixed):** `src/__tests__/gdpr-export-coverage-hook.test.ts` fails against the current checked-in GDPR manifest. Confirmed pre-existing by reproducing against HEAD before Task 1 ran. Sprint 6 closeout territory; likely needs migration 067–070 rows appended to `src/lib/gdpr-export.ts`. Logged to `.planning/phases/07-demo-mode-purge/deferred-items.md` per the executor scope-boundary rule. Not fixed here because this plan's scope is tests-only for PURGE-01/05/06.

## User Setup Required

None — no environment variables, no external service configuration, no database migration.

## Next Phase Readiness

- **Phase 07 closure check:** This plan closes the demolition/audit side (PURGE-01/PURGE-05/PURGE-06). The remaining Phase 07 plans are 07-02 (historical reconstruction worker), 07-03 (dashboard rewire), 07-04 (tabbed layout), 07-05 (empty state + CTA).
- **Phase 08 / 09 pickup:** Any future PR that introduces a `@/lib/demo` import into an authenticated path, or a migration trigger on `auth.users` that seeds portfolio/allocator tables, will fail CI on `src/__tests__/seed-integrity.test.ts`. Phase 08 Connection Management + Phase 09 Bridge Live can assume the authenticated-path demo-purity invariant holds.
- **Deferred:** GDPR manifest coverage hook test failure — see `deferred-items.md`.

## Residual Risks

None in scope. The import-graph scan is by-design best-effort (it matches literal source-text patterns — a future file could evade detection via dynamic `require()` or computed import strings, but neither pattern appears in this codebase and both would be immediately reviewer-flagged). If tree-shake evasion becomes a concern, the scan can be upgraded to an AST walker (ts-morph) in a follow-up.

## Self-Check: PASSED

- [x] `src/__tests__/seed-integrity.test.ts` has `DEMO_REFERENCE_ALLOWLIST`, `AUTH_USERS_TRIGGER_PATTERN`, `SEED_INSERT_PATTERN`, `handle_new_user` markers (grepped).
- [x] `src/components/auth/OnboardingWizard.noseeed.test.tsx` exists with `PURGE-05` marker.
- [x] Task 1 commit `2eb383d` exists in `git log`.
- [x] Task 2 commit `281b917` exists in `git log`.
- [x] 7 new tests + 5 new tests GREEN (`npx vitest run src/__tests__/seed-integrity.test.ts src/components/auth/OnboardingWizard.noseeed.test.tsx` — 36 total pass).
- [x] `grep "ON auth.users" supabase/migrations/` returns 1 hit (migration 002:82).
- [x] Full vitest suite: 1378 pass / 1 fail — the 1 failure is pre-existing GDPR coverage hook (out of scope, logged to deferred-items.md).

---
*Phase: 07-demo-mode-purge*
*Completed: 2026-04-20*
