---
phase: 01-outcome-tracker
fixed_at: 2026-04-18T11:14:00Z
review_path: .planning/phases/01-outcome-tracker/01-REVIEW.md
iteration: 1
findings_in_scope: 5
fixed: 5
skipped: 0
status: all_fixed
---

# Phase 01: Code Review Fix Report

**Fixed at:** 2026-04-18T11:14:00Z
**Source review:** .planning/phases/01-outcome-tracker/01-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 5
- Fixed: 5
- Skipped: 0

## Fixed Issues

### CR-01: Dismiss upsert does not refresh `dismissed_at` on re-dismiss

**Files modified:** `src/app/api/bridge/outcome/dismiss/route.ts`
**Commit:** 3c127aa
**Applied fix:** Replaced the bare `Date.now()` inline with `const now = new Date()` and added `dismissed_at: now.toISOString()` explicitly to the upsert payload. On conflict (re-dismiss) PostgREST will now overwrite the `dismissed_at` column rather than retaining the original INSERT value. Added an inline comment explaining the invariant.

---

### WR-01: Unclosed JSX fragment nesting in AllocationDashboard

**Files modified:** `src/app/(dashboard)/allocations/AllocationDashboard.tsx`
**Commit:** 491b7cd
**Applied fix:** Indented `<main` by two additional spaces to match `<AlertBanner>` as a true sibling inside the `<>` fragment. Replaced the ambiguous inline comment with a clear block comment explaining that `AlertBanner` intentionally sits outside the `IntersectionObserver` root (`dashboardContainerRef`) because it is not a dashboard widget.

---

### WR-02: Insert-vs-update heuristic break in same transaction

**Files modified:** `src/app/api/bridge/outcome/route.ts`
**Commit:** a70e106
**Applied fix:** Added a `NOTE` block comment immediately above the `isInsert` constant documenting that Postgres `now()` returns the transaction start time, making the `created_at === updated_at` heuristic unreliable when multiple upserts share one transaction. The comment explicitly forbids use in batch/direct-DB contexts. No logic was changed; the heuristic is sound for single-statement HTTP paths.
**Status note:** Documentation-only fix — requires human verification that no existing batch or direct-DB callers depend on this path.

---

### WR-03: Admin client used for eligibility fan-out selects

**Files modified:** `src/lib/queries.ts`
**Commit:** 0268cf9
**Applied fix:** Replaced the `admin` client with the user-scoped `supabase` client for all three Sprint 8 Phase 1 eligibility fan-outs: `match_decisions`, `bridge_outcomes`, and `bridge_outcome_dismissals`. The `admin` client is retained only for `portfolio_analytics` and `portfolio_strategies` where `daily_returns` column-level REVOKE requires service-role access. Updated the Step 2 comment to document the split. All 12 existing `queries.my-allocation.test.ts` tests pass.

---

### WR-04: Missing 400/Zod test for dismiss route

**Files modified:** `src/app/api/bridge/outcome/dismiss/route.test.ts`
**Commit:** 80338ed
**Applied fix:** Added TC4 to the dismiss route test suite. TC4 sends `strategy_id: "not-a-uuid"`, asserts status 200→400, checks `body.error === "Invalid request body"` and `Array.isArray(body.issues)`, and confirms no audit RPC was emitted. Mirrors the TC6a pattern from the outcome route tests. All 4 dismiss tests now pass.

---

_Fixed: 2026-04-18T11:14:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
