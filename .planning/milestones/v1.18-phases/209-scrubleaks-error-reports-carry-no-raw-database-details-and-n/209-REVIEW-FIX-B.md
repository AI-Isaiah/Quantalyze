---
phase: 209-scrubleaks-error-reports-carry-no-raw-database-details-and-n
fixed_at: 2026-11-14T03:00:00Z
review_path: .planning/phases/209-scrubleaks-error-reports-carry-no-raw-database-details-and-n/209-REVIEW.md
iteration: 2
findings_in_scope: 1
fixed: 1
skipped: 0
status: all_fixed
---

# Phase 209: Code Review Fix Report (round 2, topic split B)

**Fixed at:** 2026-11-14
**Source review:** `.planning/phases/209-scrubleaks-error-reports-carry-no-raw-database-details-and-n/209-REVIEW.md`
**Iteration:** 2

**Summary:**
- Findings in scope: 1 (WR-09; everything else in REVIEW.md is owned by fixer A or is INFO)
- Fixed: 1
- Skipped: 0

## Fixed Issues

### WR-09: Plausible still loads on `/scenario-share/<token>` and reports the capability path to a third party

**Files modified:** `src/lib/scrub-share-path.ts`, `src/app/PlausibleScript.tsx`, `src/lib/scrub-share-path.test.ts`, `src/app/PlausibleScript.test.tsx`
**Commit:** 8d520ceaf
**Status:** fixed (a gate change, not a logic-heavy edit; the pins below prove both directions)

**Consumers of `isSharePath` (read before editing):**
- `src/app/PlausibleScript.tsx` loads or withholds the tracker.
- `src/app/factsheet/[id]/v2/factsheet-analytics.ts` is a PostHog capture no-op. It runs inside `FactsheetView`, which the scenario-share page also renders.
- The test files `scrub-share-path.test.ts` and `PlausibleScript.test.tsx`.
- `src/proxy.ts` does NOT use it. It has its own inline `/scenario-share` check.

**Decision:** gate Plausible specifically, do not widen `isSharePath`. Widening would also change PostHog behaviour on the scenario lane, which is not part of this finding. I added `isScenarioSharePath` next to `isSharePath` (same fail-closed shape: the bare prefix counts, takes a pathname, not a URL). `PlausibleScript` returns `null` when either predicate matches. The `isSharePath` docblock and the `SHARE_PATH_RE` comment now say this on purpose.

**Pins moved on purpose:**
- `PlausibleScript.test.tsx`: `/scenario-share/abcdef` moved from "emits the tracker" to the suppression table, with `/scenario-share/<TOKEN>` and `/scenario-share`. Reason: the scenario lane is a capability lane (WR-04), so the tracker must not load there. A prefix-adjacent `/scenario-shared/abc` was added to "still loads" to prove the boundary.
- `scrub-share-path.test.ts`: the `isSharePath(/scenario-share/abcdef) === false` pin STAYS, because `isSharePath` is deliberately not widened. New `isScenarioSharePath` block: TRUE for token, short segment and bare prefix; FALSE for the factsheet lane, `/scenario-shared/abc`, `/allocations`, `/`, and a full URL.

**Neuter-to-RED:** backed up `PlausibleScript.tsx` to `<scratchpad>/PlausibleScript.tsx.bak` and removed the `isScenarioSharePath` clause. `PlausibleScript.test.tsx` went RED with 2 failures (`/scenario-share/<TOKEN>` and `/scenario-share` rendered a script), 12 passed. Restored with `cp`; `cmp` confirmed byte-equal.

**Verification (ran in the main-worktree path `<worktree>/`, not an isolated temp worktree):**
- Vitest by name filter over every test file referencing `isSharePath`, `PlausibleScript` or `scenario-share`, plus the proxy and factsheet-analytics tests: 40 files, 1284 tests, all passed. (An explicit-path invocation failed to match any file because of the bracketed and parenthesised directory names, so I used name filters instead.)
- `npm run typecheck`: clean.
- `npm run lint`: 0 errors, 4 warnings, none in files I touched (`composite-read-path.ts`, `queries.stale-analytics-detail.test.ts`). Hygiene checks printed OK.

## Residual, recorded rather than fixed (not in my scope)

- PostHog on the scenario lane: `factsheet-analytics.ts` still captures on `/scenario-share/<token>`, and PostHog attaches `$current_url`. It is currently blocked only by the CSP omitting the PostHog host, an accident the `factsheet-analytics.ts` comment itself refuses to count as a control. If that matters, widen `isSharePath` or gate it separately in a follow-up.
- The WR-02 invariant test (no client navigation into the lane) scans for `/factsheet-share` only. I grepped for in-app links or navigation into `/scenario-share` and found none, so the load-time gate is sufficient today, but the scan was not extended.

---

_Fixed: 2026-11-14_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 2_
