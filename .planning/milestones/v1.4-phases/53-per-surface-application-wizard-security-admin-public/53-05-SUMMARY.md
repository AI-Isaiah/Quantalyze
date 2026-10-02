---
phase: 53-per-surface-application-wizard-security-admin-public
plan: 05
subsystem: admin
tags: [admin, route-state, container-queries, fluid-type, truncation, STATE-05, APPLY-04, BP-02]
requires:
  - "Phase 49 fluid --text-* spine (globals.css @theme)"
  - "Phase 50 ResponsiveTable + Table primitives"
  - "Phase 52 @container parent/child idiom (StrategyTable precedent)"
provides:
  - "shared admin/loading.tsx (data-table-anchored skeleton, sr-only role=status)"
  - "shared admin/error.tsx (digest-only retry boundary, T-53-09)"
  - "@container parent/child reshape on the three admin data tables with falsifiable structural tests"
  - "admin glob clean of raw px font-size (0 text-[Npx]) — unblocks Plan 06 admin eslint flip"
affects:
  - "src/app/(dashboard)/admin/** (route-state + type)"
  - "src/components/admin/** (tables + type)"
tech-stack:
  added: []
  patterns:
    - "@container host on ResponsiveTable parent; @max-*/@min- variants on child th/td (#551 rule)"
    - "falsifiable STRUCTURAL @container guard (host is strict ANCESTOR of variant cells) over class-string jsdom"
    - "no-clip recovery via title= on already-rendered data only (T-53-10)"
    - "raw px/named-scale type → named fluid --text-* tiers (data category ≤ h3/body/small/caption + micro)"
key-files:
  created:
    - "src/app/(dashboard)/admin/loading.tsx"
    - "src/app/(dashboard)/admin/loading.test.tsx"
    - "src/app/(dashboard)/admin/error.tsx"
    - "src/app/(dashboard)/admin/error.test.tsx"
    - "src/components/admin/MatchQueueIndex.test.tsx"
  modified:
    - "src/components/admin/ComputeJobsTable.tsx (+test)"
    - "src/components/admin/AllocatorMatchQueue.tsx (+test)"
    - "src/components/admin/MatchQueueIndex.tsx"
    - "src/app/(dashboard)/admin/partner-pilot/[partner_tag]/page.tsx"
    - "+ ~21 other admin page-tree + components/admin files (type migration)"
decisions:
  - "Shared admin loading/error pair covers the whole subtree; NO per-sub-page skeletons added (UI-SPEC 'shared covers most'; match-detail client renders its own MatchQueueSkeleton, so a route-level loading there would barely flash)"
  - "ComputeJobsTable/MatchQueueIndex/AllocatorMatchQueue all collapse the lowest-priority columns at @max-2xl and RELOCATE the real values into a narrow-only sub-line (no fabricated em-dash/zero, no-invented-data LOCKED)"
  - "PATTERNS:189 claim that AllocatorMatchQueue already imports ResponsiveTable was inaccurate — the file used 3 raw <table>s; added a ResponsiveTable @container host to each (plan body :166 was correct)"
  - "verify grep gates BOTH text-[Npx] AND named text-(xs|sm|base|lg|xl) to 0 (53-03 precedent); migrated both. text-2xl/3xl also folded to text-h3 for the ≤4-tier data cap even though they are not in the verify grep"
metrics:
  duration_min: 16
  completed: "2026-06-29"
  tasks: 3
  files: 32
  commits: 3
---

# Phase 53 Plan 05: Admin Surface — Route-State, @container Tables, Clips & Fluid Type Summary

Brought the highest-sensitivity in-scope surface (admin, staff-facing + access-gated) to the v1.4 bar: a shared data-table-anchored `loading.tsx` + digest-only `error.tsx`, a falsifiable parent/child `@container` reshape on all three admin data tables, recovery of the partner-pilot email mid-clip and the dense-table clips, and a glob-wide type migration to the fluid `--text-*` tiers — without removing any access gate and without touching the shared `eslint.config.mjs` (Plan 06 owns the admin error-ratchet flip).

## What Was Built

**Task 1 — shared admin route-state pair (commit 375847b9):**
- `admin/loading.tsx` (RSC): page-title bar + a `border border-border bg-surface` block with a header rule + 8 placeholder rows + `sr-only role="status" aria-live="polite"` "Loading admin." Single `animate-pulse` on the shell. Does NOT re-impose `max-w-7xl` (DashboardChrome owns the measure once Plan 06 widens admin).
- `admin/error.tsx` ("use client"): `{ error, unstable_retry }`, "Something went wrong" + body + "Try again" → `unstable_retry()`, `Error ID: {digest}` only when present, `console.error("[admin-error]", ...)`. NEVER renders `error.message` (T-53-09).
- Co-located render tests (8): role=status node + table-anchor structure; heading/body, retry-once, digest-when-present, Error-ID-omitted-without-digest, **message-never-rendered (info-leak guard)**, console tag.

**Task 2 — @container reshape, all three tables (commit 91ccd473):**
- `ComputeJobsTable`: `@container` added to the existing ResponsiveTable host; Attempts + Age collapse at `@max-2xl`, real values relocate into the Kind cell.
- `MatchQueueIndex`: raw `<table>` wrapped in `ResponsiveTable className="@container"`; Last intro + Recomputed collapse, real values relocate into the Allocator cell.
- `AllocatorMatchQueue`: all THREE raw `<table>`s (left rail, excluded, history) wrapped in `@container` hosts; #/Detail/When collapse with real-value relocation.
- Falsifiable STRUCTURAL tests for ALL THREE: the `@container` host must be a **strict ancestor** of every `@-`variant cell (never same-element #551), host carries NO `@-`variant, tabular-nums preserved. Mutation-verified: moving `@container` onto a cell turns the guard RED.

**Task 3 — clips + fluid type (commit 4abadfde):**
- partner-pilot `[partner_tag]/page.tsx`: allocator name, **email (mid-clip — now recovers via title=)**, staged strategy name, and status·manager line all gain `title=` (T-53-10: only already-rendered data).
- Glob-wide type migration to named fluid tiers across the admin page tree (~11 files) + `components/admin` (~13 files): `text-[10/11px]`→`text-micro`, `text-[13px]`→`text-caption`, `text-[20/24/32px]`→`text-h3`, `text-xs`→`text-caption`, `text-sm`→`text-small`, `text-base`→`text-body`, `text-lg/xl/2xl/3xl`→`text-h3`.
- Legitimate clips preserved (ComputeJobsTable :240/261 title=, compute-jobs/page :126 ID slice + :135 title=).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] JSX/JSDoc comment `*/` parse-break**
- **Found during:** Task 2
- **Issue:** Doc/JSX comments containing the literal `@max-*/@min-*` closed the `/* */` comment early → oxc parse error.
- **Fix:** Reworded comments to `@max-` / `@min-` (no `*/` sequence) in ComputeJobsTable.tsx + .test.tsx.
- **Commit:** 91ccd473

**2. [Rule 3 - Blocking] error.message in doc comment trips the acceptance grep**
- **Found during:** Task 1
- **Issue:** `grep -c 'error\.message' == 0` failed because the doc comment said "Never render `error.message`".
- **Fix:** Reworded the comment to "the thrown message string is never rendered into the DOM" (same self-trip lesson as 43-01/43-03).
- **Commit:** 375847b9

### Cross-task overlap (documented, not a deviation)
- The three dense-table clip `title=` fixes (MatchQueueIndex mandate :289, AllocatorMatchQueue reason :560 + founder-note :701) were applied INLINE during the Task-2 `@container` restructure of those exact cells, rather than in Task 3, to avoid re-touching the same cell (Rule 3 surgical). Task 3 owns the partner-pilot clips + the remaining glob-wide type migration.

### Plan inaccuracy corrected
- `53-PATTERNS.md:189` stated AllocatorMatchQueue "ALREADY imports ResponsiveTable" — it did not (3 raw `<table>`s). The plan body (`:166`) correctly said "needs a containment host added"; followed the plan body.

## Known Stubs
None. The "placeholder" hits in touched files are the intended skeleton placeholder rows, a `<select>` "All statuses" option, and an `<input>` search placeholder — not data stubs.

## Threat Flags
None. No new endpoints/auth paths/schema. `title=` exposes only already-rendered admin data (T-53-10). Access gates (`redirect("/login")` then `isAdminUser` redirect) verified intact on admin/page.tsx, partner-pilot, and match-detail.

## Verification Results
- `npx vitest run` (5 named files): **22/22 green**.
- `grep -RnE "text-\[[0-9]+px\]|text-(xs|sm|base|lg|xl)"` over admin page tree + components/admin: **0**.
- `npm run lint`: **0 errors** (286 pre-existing raw-px warnings, all OUTSIDE this plan's scope; no admin no-raw-font-px warnings); route-contract guard + admin-route-manifest green.
- `npx tsc --noEmit`: **exit 0**.
- Full admin test suite (13 files): **61/61 green**.
- Admin ultra-wide responsiveness proven via the component structural tests + (Plan 07) conformance — NOT e2e (Pitfall 7: allocator seed redirects non-admins; documented gap, admin-seeded e2e is Phase 54).

## Self-Check: PASSED
All created files present on disk; all three task commits (375847b9, 91ccd473, 4abadfde) present in git log.
