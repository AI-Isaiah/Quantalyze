---
phase: 109-role-predicate-unification-page-guards
verified: 2026-07-16T00:00:00Z
status: human_needed
score: 5/5 code-level must-haves verified
overrides_applied: 0
re_verification:
  previous_status: none
  previous_score: n/a
human_verification:
  - test: "Live redirect-loop matrix across the full role × is_admin matrix on a real deploy, including a NESTED manager route"
    expected: "Log in as manager, allocator, both, and is_admin+manager; direct-URL a cross-role route incl. a nested one (e.g. /portfolios/<id>/manage and /strategies/new/wizard as an allocator). Each is a single-hop server redirect to the visitor's role home — no loop, no 403, no half-rendered page."
    why_human: "The end-to-end SSR redirect chain (proxy bounce → discovery/layout → strategies/layout, plus segment-layout coverage of nested routes) can only be confirmed against a live deploy with each role account. Unit tests cover the guard branches and the loop-free matrix in isolation; the wired chain is the manual confirm (per 109-VALIDATION.md Manual-Only)."
  - test: "Visual nav confirmation per role on a live deploy"
    expected: "manager account: no My Allocation / Scenario / Recommendations / Compare / Decks / Discovery in nav. allocator account: no Strategies / Portfolios. is_admin+manager: manager workspace + Admin section, NOT the allocator workspace. role='both': both workspaces + Admin."
    why_human: "Rendered nav visibility per live session is a visual/UX confirmation; unit tests prove the derivation but not the live render."
---

# Phase 109: ROLE — Predicate Unification + Page Guards Verification Report

**Phase Goal:** One predicate (`profiles.role` = marketplace persona; `is_admin` = ops overlay only) drives nav, page access, and APIs, so an account only ever sees its own workspace — with staff access preserved via `role='both'`.
**Verified:** 2026-07-16
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (mapped to ROADMAP Success Criteria + ROLE-01..06)

| # | Truth | Status | Evidence |
| --- | ----- | ------ | -------- |
| SC1 / ROLE-01+02 | Manager sees no allocator workspace or Discovery; allocator sees zero sell-side (Strategies/Portfolios) in nav | ✓ VERIFIED (code) | `Sidebar.tsx` L53-55 `showsAllocatorWorkspace = isAllocator`, `showsManagerWorkspace = isManager`, `showsDiscovery = isAllocator` (pure role); L204-205 same in `buildPrimaryMobileNav`. OR-in grep returns 0 hits. 179 nav+guard tests green incl. flipped admin/manager/allocator/both fixtures. Live visual → human. |
| SC2 / ROLE-03 | `is_admin` adds only the Admin section, no marketplace surface; is_admin+manager does NOT see allocator workspace | ✓ VERIFIED | Admin section gated on `isAdmin` alone (`Sidebar.tsx` L135 `...(isAdmin`); workspace derivations no longer read isAdmin. Guard `requireRolePage.ts` selects `"role"` only — `grep -c is_admin` = 0. Nav test asserts admin+manager fixture lacks allocator items. |
| SC3 / ROLE-04 | Direct URL to an unowned route → server-side redirect to role home; three-branch (DB-error does NOT redirect); role×is_admin matrix loop-free | ✓ VERIFIED (code+unit) | `requireRolePage.ts`: DB-error → throw (L76), missing-profile → throw (L95), wrong-role → `redirect(homeHref)` at top level OUTSIDE any try/catch (L118, file has zero `try {`). homeHref derived internally (L110-115); unknown → terminal `/pending-approval`; `both` never redirected. Test file enumerates the full `role × is_admin redirect-loop matrix` describe block + deny-by-default. 7 guard sites attached. Live chain → human. |
| SC4 / ROLE-05 [GATE] | `role='both'` backfill lands atomically with the `|| isAdmin` drop; empty-set SQL assertion `is_admin=true AND role NOT IN ('both')` = ∅ | ✓ VERIFIED | Migration `20260716120000_backfill_staff_role_both.sql` (`UPDATE profiles SET role='both' WHERE is_admin=true AND role<>'both'`) + Sidebar OR-in drop both landed in Phase 109 (commits ec80b857 + c0dabdb4, same phase/PR). RED-guarded SQL assertion `test_staff_role_both_backfill.sql` present. Orchestrator applied migration to TEST project (qmnijlgmdhviwzwfyzlc): violations 2→0, A2 trigger did NOT block — empty-set invariant PROVEN live. CI SQL job re-proves. |
| SC5 / ROLE-06 | Role-denied action shows honest copy naming the role, no impossible retry | ✓ VERIFIED | `withAllocatorAuth.test.ts:92` asserts 403 body `{ error: "Forbidden — allocator role required" }` (names the role; no retry affordance). Pages covered by redirect (denied user never sees dead-end). |

**Score:** 5/5 code-level must-haves verified

### Required Artifacts

| Artifact | Expected | Status | Details |
| -------- | -------- | ------ | ------- |
| `src/lib/auth/requireRolePage.ts` | Three-branch guard on profiles.role, redirect outside try/catch, internal homeHref | ✓ VERIFIED | 119 lines; `import "server-only"`; selects `"role"` only; no is_admin key; no `src/lib/auth.ts`/`user_app_roles` import; redirect at top level. |
| `src/lib/auth/requireRolePage.test.ts` | Branch + full role×is_admin matrix | ✓ VERIFIED | Matrix describe block + DB-error/missing-profile/owner/both/deny-by-default cases. Green. |
| `src/components/layout/Sidebar.tsx` | Pure-role nav, no `|| isAdmin` in derivations | ✓ VERIFIED | 0 OR-in hits; Admin gate intact at L135. |
| `supabase/migrations/20260716120000_backfill_staff_role_both.sql` | Idempotent staff backfill | ✓ VERIFIED | Guarded `WHERE is_admin=true AND role<>'both'`; applied to test project. |
| `supabase/tests/test_staff_role_both_backfill.sql` | RED-guarded empty-set assertion | ✓ VERIFIED | Bare `BEGIN; DO $$ … RAISE EXCEPTION … $$; ROLLBACK;`, no pgTAP plan(). |
| `src/app/(dashboard)/strategies/layout.tsx` (NEW) | Manager segment layout | ✓ VERIFIED | force-dynamic + createClient + getUser + !user redirect + `requireRolePage(...,"manager")` outside try/catch. |
| `src/app/(dashboard)/portfolios/layout.tsx` (NEW) | Manager segment layout | ✓ VERIFIED | Same shell; `redirect("/login?redirect=/portfolios")`. |
| 4 allocator flat pages + `discovery/layout.tsx` | allocator guard attached | ✓ VERIFIED | allocations L54, recommendations L47, compare L34, decks L15, discovery/layout L45 — each after !user, before any try. |

### Key Link Verification

| From | To | Via | Status |
| ---- | -- | --- | ------ |
| 4 allocator pages + discovery/layout | requireRolePage | `requireRolePage(supabase, user, "allocator")` | ✓ WIRED (5 sites) |
| strategies/layout + portfolios/layout | requireRolePage | `requireRolePage(supabase, user, "manager")` | ✓ WIRED (2 sites) |
| Sidebar buildNavSections/buildPrimaryMobileNav | role flags | pure `isAllocator`/`isManager` | ✓ WIRED (OR-in dropped) |
| migration | profiles.role | `UPDATE profiles ... WHERE is_admin=true AND role<>'both'` | ✓ WIRED + applied to test DB |

**7 guard sites confirmed** via `grep -rl "requireRolePage(supabase, user," "src/app/(dashboard)"` → exactly 7. All 8 nested manager `page.tsx` (strategies/{new,new/wizard,[id]/edit}, portfolios/{[id],[id]/manage,[id]/documents}) are wrapped by the two segment layouts.

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| -------- | ------- | ------ | ------ |
| Type check | `npx tsc --noEmit` | exit 0 | ✓ PASS |
| Guard + nav unit suites | `npx vitest run src/lib/auth src/components/layout --no-file-parallelism` | 9 files, 179 tests passed | ✓ PASS |
| OR-in absent | grep four OR-in expressions in Sidebar.tsx | 0 hits | ✓ PASS |
| 7 guard sites | grep guard sites under (dashboard) | 7 files | ✓ PASS |
| proxy.ts untouched | git status | clean (committed, byte-unchanged) | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan | Status | Evidence |
| ----------- | ---------- | ------ | -------- |
| ROLE-01 | 109-02 | ✓ SATISFIED (code) | pure-role manager nav; live visual → human |
| ROLE-02 | 109-02 | ✓ SATISFIED (code) | pure-role allocator nav (no Strategies/Portfolios) |
| ROLE-03 | 109-02 | ✓ SATISFIED | Admin gate on isAdmin alone; guard selects role only |
| ROLE-04 | 109-01, 109-03 | ✓ SATISFIED (code+unit) | guard + 7 attach sites + matrix test; live chain → human |
| ROLE-05 | 109-02 | ✓ SATISFIED | atomic backfill + empty-set invariant proven live on test DB |
| ROLE-06 | 109-01 | ✓ SATISFIED | 403 copy assertion pins role-naming, no retry |

### Anti-Patterns Found

None. No TBD/FIXME/XXX debt markers in the phase-modified files. One pre-existing `react-hooks/exhaustive-deps` warning in `allocations/widgets/performance/EquityChart.tsx:1119` is unrelated to this phase (out of scope, 0 lint errors).

### Human Verification Required

1. **Live redirect-loop matrix (role × is_admin, incl. nested routes)** — After deploy, log in as manager / allocator / both / is_admin+manager and direct-URL a cross-role route including a nested one (`/portfolios/<id>/manage`, `/strategies/new/wizard` as an allocator). Confirm single-hop redirect to role home, no loop, no 403/half-render.
2. **Live nav visibility per role** — Confirm each role's rendered nav matches the pure-role derivation (manager: no allocator workspace/Discovery; allocator: no sell-side; is_admin+manager: manager + Admin only; both: both + Admin).

### Gaps Summary

No code-level gaps. Every code-verifiable truth is satisfied: the shared three-branch `requireRolePage` guard exists with the redirect provably outside try/catch, the full role×is_admin matrix is enumerated and green, the `|| isAdmin` OR-in is dropped from both nav derivations with the Admin section still is_admin-gated, all 7 owned-route entry points are guarded (nested manager routes covered by segment layouts), the atomic `role='both'` backfill shipped with the drop and its empty-set invariant is proven live on the test project (violations 2→0, trigger did not block), and the ROLE-06 denied-action copy is test-pinned. tsc is clean and 179 unit tests pass. The only outstanding items are the live end-to-end redirect-chain and nav-visibility confirmations across the full role×is_admin matrix, which require a live deploy with each role account — routed to human verification per 109-VALIDATION.md.

---

_Verified: 2026-07-16_
_Verifier: Claude (gsd-verifier)_
