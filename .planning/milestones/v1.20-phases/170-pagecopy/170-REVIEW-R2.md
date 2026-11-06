---
phase: 170-pagecopy
review: round-2 confirmation (gsd-code-reviewer)
reviewed: 2026-10-01T09:30:00Z
reviewed_at_sha: a82496148
diff_base: 37dfad67d
depth: standard
threshold: MEDIUM and above only (founder rule)
files_reviewed: 21
files_reviewed_list:
  - DESIGN.md
  - e2e/helpers/geometry.ts
  - e2e/helpers/seed-test-project.ts
  - e2e/layout-narrow.spec.ts
  - e2e/reflow.spec.ts
  - src/app/(dashboard)/admin/page.test.tsx
  - src/app/(dashboard)/admin/page.tsx
  - src/app/(dashboard)/allocations/components/Tweaks.test.tsx
  - src/app/(dashboard)/allocations/components/Tweaks.tsx
  - src/app/(dashboard)/allocations/components/TweaksToggle.tsx
  - src/app/(dashboard)/strategies/page.share-affordance.test.tsx
  - src/app/(dashboard)/strategies/page.tsx
  - src/app/factsheet/[id]/v2/MetricsColumn.final-month.test.tsx
  - src/app/factsheet/[id]/v2/MetricsColumn.tsx
  - src/components/admin/AllocatorMatchQueue.test.tsx
  - src/components/admin/AllocatorMatchQueue.tsx
  - src/components/admin/PreferencesPanel.tsx
  - src/components/marketing/MarketingHeaderActions.test.tsx
  - src/components/marketing/MarketingHeaderActions.tsx
  - src/components/ui/NowrapWords.test.tsx
  - src/components/ui/NowrapWords.tsx
findings:
  critical: 0
  high: 0
  medium: 1
  warning: 1
  info: 0
  total: 1
status: issues_found
---

# Phase 170: Round-2 Confirmation Code Review

**Reviewed:** 2026-10-01
**Scope:** `git diff 37dfad67d..a82496148 -- src e2e DESIGN.md` (21 files: 20 source and test files plus DESIGN.md)
**Depth:** standard
**Status:** issues_found (1 MEDIUM)

## Summary

This round had two goals:

1. Confirm that each round-1 finding the fixers marked fixed is actually fixed in the merged HEAD.
2. Look for regressions the fixes introduced.

Founder rule: only MEDIUM or higher is reported. The frontmatter maps MEDIUM to `warning`.

All ten round-1 findings are fixed in source. One fix brings a new MEDIUM problem: the admin dashboard now throws on any queue-query error, so a persistent failure in one query takes down all four queues, including the only approval surface.

**Checks run on the merged HEAD.** Each fixer ran gates on its own branch, so these were re-run after the merge:

- `npx tsc --noEmit -p tsconfig.json`: exit 0.
- `npx vitest run` on the 7 touched test files (NowrapWords, page.share-affordance, MetricsColumn.final-month, Tweaks, admin/page, AllocatorMatchQueue, MarketingHeaderActions): 7 files and 98 tests passed.
- `CI=1 npx playwright test e2e/reflow.spec.ts -g "self-test"`: 12 passed, including the 3 new ancestor-clip fixtures.
- `CI=1 npx playwright test e2e/layout-narrow.spec.ts --list`: both `N-STRAT draft row (CR-01)` cases are listed.
- Accessible-name probe, run in Chromium without a server: the inline-block word spans that `breakOverlong` now emits still resolve through `getByRole("link", { name, exact: true })` with the exact multi-word name. So the three existing published N-STRAT rows, which select the name link that way, are not broken by WR-02. The probe file was temporary and deleted; it was not committed.

## Round-1 findings: confirmation

| Round-1 id | Confirmed by (source) | Pin |
|---|---|---|
| CR-01 `/strategies` row 0 px name at 768–960 | `strategies/page.tsx:781` name block `flex-1 min-w-0 md:min-w-[160px]`; `:796` group `md:min-w-0 md:justify-end` and no `md:shrink-0` | vitest N-STRAT class pin, which rejects `md:shrink-0` and `shrink-0`; e2e draft row at V768 and V800 (`layout-narrow.spec.ts`, CI-pending) |
| WR-01 Tweaks focus order | `Tweaks.tsx:59-68` focuses the first control on open and returns focus to `[data-tweaks-toggle]` on close only when focus was inside the panel or on `<body>`; `TweaksToggle.tsx:35-36` sets `aria-expanded` and `aria-controls` only while the panel is open | `Tweaks.test.tsx` (5 cases, neuter-verified per FIX-C) |
| WR-02 nowrap long name | `NowrapWords.tsx:32-34` adds an opt-in `breakOverlong`; `/strategies` passes it at `page.tsx:783`; the default stays `whitespace-nowrap` (StrategyTable `:1098`) | `NowrapWords.test.tsx` (both paths); N-STRAT word-span pin |
| WR-03 "Final month" on live records | `MetricsColumn.tsx:444-453`: `monthsBehind` uses UTC year×12 + month; ≤0 gives `Month-to-date`, 1 gives `Last month (…)`, 2 or more gives `Final month (…)` | `final-month.test.tsx`: 1st of month, the review's own case, month-start weekend, Dec→Jan rollover, two months back |
| WR-04 / SFH-170-01 N-TABLE vacuous pass | `layout-narrow.spec.ts` N-TABLE: per select, scroll is reset to 0 and stepped 8 px until `elementsFromPoint` at the select's centre includes a sticky, z-indexed table cell. Anything else asserts `"reached"` and fails. Every StrategyTable header cell is `sticky top-0 z-20/z-30` (`StrategyTable.tsx:881-953`), so a right-side select at V960 can also reach one | seeded, CI-pending |
| SFH-170-02 clip-blind helpers | `geometry.ts` `assertNotClippedByAncestors` walks the containing-block chain and intersects with every non-`visible` overflow axis; SC2-PROFILE calls it | 3 server-free self-tests passed at HEAD |
| SFH-170-03 admin "All caught up" on error | `admin/page.tsx:65-84` logs and throws on any of the four query errors | `admin/page.test.tsx` (but see WR-01 below) |
| SFH-170-04 silent masthead catch | `MarketingHeaderActions.tsx:45-57`: `unstable_rethrow(err)` is the first statement in the catch, then the error message is logged, then the signed-out fallback | `MarketingHeaderActions.test.tsx` (real `redirect()` rethrow, log lines, anonymous path not logged) |
| SFH-170-05 below-md Save and silent recompute drop | `PreferencesPanel.tsx:108-109` guards submit; `:484` disables Save; there is a `role="status"` notice; `AllocatorMatchQueue.tsx:189-197` uses a ref-synced `readOnly`; `:254-257` refuses a recompute with a visible notice, rendered at `:500` in the main view (outside the `error` card, so a refusal never replaces the queue) | `AllocatorMatchQueue.test.tsx` cases (A) and (B) |

## Warnings

### WR-01 (MEDIUM): admin dashboard throws on any one queue error, so one persistently failing query blanks all four queues, including the only approval surface

**File:** `src/app/(dashboard)/admin/page.tsx:65-84` (error boundary `src/app/(dashboard)/admin/error.tsx`)

**Issue:**
- The SFH-170-03 fix runs all four `Promise.all` results (`introRequests`, `pendingStrategies`, `pendingAllocators`, `pendingManagers`) through one loop. The first `res.error` throws, and the `/admin` error boundary then replaces the whole page with "Something went wrong".
- The four queries do not depend on each other. Before the fix, a failure degraded to one empty tab, which was wrong because it was silent. Now a failure in any one query hides all four.
- Approving pending allocators and managers exists only in `AdminTabs`. `approve()` is at `AdminTabs.tsx:592` and `:640`. `/admin/users/[id]` only displays `allocator_status` and `manager_status`, and grep finds no other approve action.
- Concrete case: a persistent failure in the `contact_requests` read. One example is embed drift on `profiles!contact_requests_allocator_id_fkey` or `strategies!contact_requests_strategy_id_fkey`, both named in the select at `:25`. That failure now stops the founder from approving any new allocator or manager, and from reviewing pending strategies, until the unrelated intro query is fixed.
- That gate keeps every new user out of the dashboard, so the effect reaches users and is not limited to the admin.
- Transient failures are covered: `error.tsx` offers `unstable_retry`. This finding is about *persistent* failures only.
- The round-1 SFH text offered "throw" as an acceptable option, so this is a blast-radius cost that recommendation did not weigh. It is not a fixer error.

**Fix:** Keep the per-query log. Replace the page-level throw with a per-queue error state, so each tab shows its own failure and the others keep working:

```tsx
const failed = {
  introRequests: !!introRequests.error,
  pendingStrategies: !!pendingStrategies.error,
  pendingAllocators: !!pendingAllocators.error,
  pendingManagers: !!pendingManagers.error,
};
for (const [name, res] of Object.entries(results)) {
  if (res.error) console.error(`[admin] ${name} query failed`, { code: res.error.code, message: res.error.message });
}
// AdminTabs: when failed[x], render "Could not load <queue>. Reload to retry."
// (role="alert") in that tab instead of the "All caught up" empty state, and
// show the tab count as "—" rather than 0.
<AdminTabs ... failed={failed} />
```

Keep the page-level throw only for the case where all four fail, if at all. Update `admin/page.test.tsx` so that a failing `contact_requests` read still renders the pending-strategies and approval queues, and the intros tab shows the load-error copy and not "All caught up".

## Checked clean (no MEDIUM+ finding)

- **`/strategies` row at 768–1000 px.**
  - Flex arithmetic: the name has basis 0, grow 1 and a 160 px minimum from `md` up. The group has basis = max-content, shrinks, and has `min-w-0`. When the row is narrower than the group's one-line width plus 160 + 16, the name holds 160 px and the group takes the rest and wraps its own items.
  - The group cannot drop below about 200 px at any `md`+ width: at 768 the row is about 380 px.
  - FIX-A measured this with the real components: 160 px name and no overlap at 768/800/840/960 for draft, published and copy-failed rows; no item spills out of the group.
  - At wide widths (1280+) the group fits on one line, so the result is the same as before.
- **`/strategies` row at 390/640 px.** Every new utility on the row is `md:`-scoped, so the stacked layout is unchanged. With `breakOverlong`, a word wider than the full-width name block now breaks inside the block and no longer overflows `#main-content` (FIX-A WR-02 table).
- **`NowrapWords` default for other callers.** The only other caller is `StrategyTable.tsx:1098` (`<NowrapWords text={s.name} />`). It gets exactly `whitespace-nowrap`, pinned by the default-path test. `max-w-full` on the opt-in path resolves against the name block, because the `<a>` and the `display: contents` root are not containing blocks.
- **Month label boundaries.**
  - `new Date("YYYY-MM-DD")` parses as UTC midnight, and every comparison uses `getUTC*`.
  - `(Δyear × 12) + Δmonth` makes Dec 2025 → Jan 2026 equal 1.
  - A future `end` gives a value ≤ 0, which reads `Month-to-date`.
  - The three branches (current month, previous month, two or more back) and the year rollover are each pinned with a faked clock.
  - `window-rows` and `record-length` still pin `Final month (Jun 2024)` without a faked clock, which stays correct because June 2024 is always two or more months back.
  - The DESIGN.md AD-10 row has a dated amendment, and the original text is kept.
- **Tweaks focus management.**
  - There is exactly one `<TweaksToggle />` (`AllocationsTabs.tsx:918`), so `querySelector("[data-tweaks-toggle]")` cannot pick a hidden duplicate.
  - `panelOpen` is in-memory `useState(false)` (`TweaksContext.tsx:221`) and is never restored from storage. Focus-in therefore never fires on page load.
  - Escape from inside the panel: the panel unmounts, focus falls to `<body>`, and the cleanup returns it to the toggle.
  - Escape or an outside click while focus is elsewhere: focus stays where it is.
  - If the whole subtree unmounts (route change), the toggle is gone too. `querySelector` then returns null and nothing is focused, which is harmless.
  - `aria-controls` is set only while the panel is mounted, so there is no dangling id reference.
- **`unstable_rethrow` placement.** It is the first statement of the catch in `MarketingHeaderActions.tsx`, before the log, so framework errors from `cookies()`, redirects and not-found are rethrown untouched. `next.config.ts` has no `cacheComponents` or PPR, and the marketing layout already renders dynamically, so the rethrow does not change the rendering mode. The log sends only `err.message`, with no session or cookie data.
- **PreferencesPanel read-only.**
  - The panel receives `readOnly` from the current render, so a narrowed viewport re-renders it with Save disabled, and `handleSubmit` refuses.
  - `handleRecompute` checks both the closure value and `readOnlyRef.current`. That covers the post-save `setTimeout` confirm that closed over the submit-time render.
  - Order of events: `onSuccess` runs `load()`, which clears the notice, *before* the 100 ms confirm calls `handleRecompute`. So the refusal notice is not erased by the reload it follows.
  - `forceReadOnly` (the demo) cannot open the panel: the opener is inside `!forceReadOnly` and also behind `guard`. So the "Read-only on mobile" copy cannot appear on the desktop demo.
- **`setSeededStrategyNameAndTags` status param and the draft-row e2e on shared TEST.**
  - The default stays `"published"`, so existing callers are unchanged. The update is scoped by `.eq("id", strategyId)` and goes through `getAdmin()`, which keeps the production-URL guard.
  - The new describe's `afterAll` cleans only `NAME_PREFIX`, which is per worker (`TEST_PARALLEL_INDEX`).
  - Cross-run collisions on shared TEST are prevented because `e2e-seeded` holds the shared-TEST advisory mutex.
  - The case seeds a draft with an attached key, so `StrategyActions` renders "Submit for Review" (`StrategyActions.tsx:53-62`). The case asserts that button, so a row seeded as published cannot pass on the narrower published control group.
  - The name-box intersection check is present as well as the block check, so a 0 px block cannot pass vacuously.
- **`assertNotClippedByAncestors`.** A zero-match locator throws. Absolute boxes jump to `offsetParent`, and the walk stops at a fixed box. The rule "every non-`visible` axis clips" also counts scrollers, which is correct after `scrollIntoViewIfNeeded`. `reflow.ts` was deliberately left unchanged (it answers whether `scrollWidth` grew), and that reasoning holds.

## Not verifiable here (CI-pending, not findings)

- **N-TABLE (seeded) at V390/V640/V960.** The new precondition fails red with a `not-reached` diagnostic if the 12 seeded rows cannot slide a sticky header cell under a Sort select at some viewport. That would be a correct red that calls for more seeded rows, not a code defect. The first `e2e-seeded` run is the proof.
- **The two `N-STRAT draft row (CR-01)` cases at V768/V800.** They were proven only through FIX-A's harness running the assertion lines. The login, seed and `/strategies` path is first exercised in `e2e-seeded`.
- **SC2-PROFILE with `assertNotClippedByAncestors`.** This is a seeded row and runs only in CI.

---

_Reviewed: 2026-10-01_
_Reviewer: Claude (gsd-code-reviewer), round 2_
_Depth: standard_
