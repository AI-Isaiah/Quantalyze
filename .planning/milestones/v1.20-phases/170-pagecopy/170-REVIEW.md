---
phase: 170-pagecopy
reviewed: 2026-10-01T06:38:45Z
depth: standard
reviewed_at_sha: b71658a1f
diff_base: 25182655c
files_reviewed: 72
files_reviewed_list:
  - e2e/composer-axe.spec.ts
  - e2e/helpers/geometry.ts
  - e2e/helpers/reflow.ts
  - e2e/helpers/seed-test-project.ts
  - e2e/layout-narrow.spec.ts
  - e2e/mobile-drawer-keyboard.spec.ts
  - e2e/reflow-sweep-authed.spec.ts
  - e2e/reflow-sweep.spec.ts
  - e2e/reflow.spec.ts
  - e2e/svg-chart-parity.spec.ts-snapshots/bootstrap-ci-portrait-320-chromium-linux.png
  - e2e/svg-chart-parity.spec.ts-snapshots/correlation-strip-portrait-320-chromium-linux.png
  - e2e/svg-chart-parity.spec.ts-snapshots/quantile-box-plot-portrait-320-chromium-linux.png
  - e2e/svg-chart-parity.spec.ts-snapshots/streak-distribution-portrait-320-chromium-linux.png
  - src/app/(dashboard)/admin/page.tsx
  - src/app/(dashboard)/allocations/AllocationsTabs.tabstrip-scroll.test.ts
  - src/app/(dashboard)/allocations/AllocationsTabs.test.tsx
  - src/app/(dashboard)/allocations/AllocationsTabs.tsx
  - src/app/(dashboard)/allocations/components/CoverageStateChip.test.tsx
  - src/app/(dashboard)/allocations/components/CoverageStateChip.tsx
  - src/app/(dashboard)/allocations/components/KpiStrip.tsx
  - src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx
  - src/app/(dashboard)/allocations/components/ScenarioComposer.tsx
  - src/app/(dashboard)/allocations/components/ScenarioFooter.test.tsx
  - src/app/(dashboard)/allocations/components/ScenarioFooter.tsx
  - src/app/(dashboard)/allocations/components/Tweaks.test.tsx
  - src/app/(dashboard)/allocations/components/Tweaks.tsx
  - src/app/(dashboard)/allocations/components/TweaksToggle.tsx
  - src/app/(dashboard)/compare/page.test.tsx
  - src/app/(dashboard)/compare/page.tsx
  - src/app/(dashboard)/strategies/page.share-affordance.test.tsx
  - src/app/(dashboard)/strategies/page.tsx
  - src/app/(marketing)/layout.tsx
  - src/app/(marketing)/page.tsx
  - src/app/factsheet/[id]/v2/FactsheetView.kpistrip.test.tsx
  - src/app/factsheet/[id]/v2/FactsheetView.tsx
  - src/app/factsheet/[id]/v2/MetricsColumn.final-month.test.tsx
  - src/app/factsheet/[id]/v2/MetricsColumn.record-length.test.tsx
  - src/app/factsheet/[id]/v2/MetricsColumn.tsx
  - src/app/factsheet/[id]/v2/MetricsColumn.window-rows.test.tsx
  - src/app/factsheet/[id]/v2/page.owner-compute-state.test.tsx
  - src/components/ResponsiveTable.test.tsx
  - src/components/ResponsiveTable.tsx
  - src/components/admin/AdminTabs.test.tsx
  - src/components/admin/AdminTabs.tsx
  - src/components/admin/AllocatorMatchQueue.test.tsx
  - src/components/admin/AllocatorMatchQueue.tsx
  - src/components/admin/CandidateDetail.tsx
  - src/components/admin/match/ShortlistCard.tsx
  - src/components/exchanges/AllocatorExchangeManager.test.tsx
  - src/components/exchanges/AllocatorExchangeManager.tsx
  - src/components/kpi/KpiPanel.test.tsx
  - src/components/kpi/KpiPanel.tsx
  - src/components/marketing/MarketingHeaderActions.test.tsx
  - src/components/marketing/MarketingHeaderActions.tsx
  - src/components/strategy/ShareableLink.test.tsx
  - src/components/strategy/ShareableLink.tsx
  - src/components/strategy/StrategyFilters.tsx
  - src/components/strategy/StrategyTable.pending-chip.test.tsx
  - src/components/strategy/StrategyTable.test.tsx
  - src/components/strategy/StrategyTable.tsx
  - src/components/strategy/StrategyTable.visibility.test.tsx
  - src/components/strategy/SyncBadge.staler-of-two.test.tsx
  - src/components/ui/Button.tsx
  - src/components/ui/NowrapWords.test.tsx
  - src/components/ui/NowrapWords.tsx
  - src/components/ui/Tabs.test.tsx
  - src/components/ui/Tabs.tsx
  - src/lib/admin/match.test.ts
  - src/lib/admin/match.ts
  - src/lib/routing/default-route.ts
  - src/lib/tab-strip-scroll.ts
  - src/proxy.ts
findings:
  critical: 1
  warning: 4
  info: 0
  total: 5
status: issues_found
---

# Phase 170: Code Review Report

**Reviewed:** 2026-10-01T06:38:45Z
**Depth:** standard
**Files Reviewed:** 72 (`git diff 25182655c..b71658a1f -- src e2e`)
**Status:** issues_found

## Summary

Founder rule applied: **MEDIUM or higher only**. LOW and INFO observations are not
recorded as findings.

I reviewed every source and e2e file in scope against 170-CONTEXT (including
GC-01..GC-03), 170-UI-SPEC, 170-VERIFICATION and the 170 SUMMARYs. Most of the gap
closure holds up. One layout defect remains at a width the founder supports
(desktop 200% zoom on 1536 to 1680 px displays). It is the same "never overlap"
criterion GC-02 was written to close. I also found one keyboard-order regression,
one overflow risk introduced by `NowrapWords`, one wrong label on live factsheets,
and one e2e gate that can pass without reaching the state it is meant to test.

**Areas checked and found clean (no finding):**

- **`match.ts` `castRowOrNull`.** Every fan-out error still throws before any
  cast (`match.ts:152-156`). `profile` stays on the throwing `castRow`. Every
  consumer of a null `preferences` is null-safe (`AllocatorMatchQueue.tsx:489`,
  `PreferencesPanel.tsx:25-62`, all `preferences?.`).
- **ResponsiveTable `relative` on all consumers.** No consumer passes a position
  class through `className` (only `@container`). No absolutely positioned
  descendant inside any of the scroll regions relied on escaping it. The
  StrategyTable scroll cue (`StrategyTable.tsx:1441`) is a sibling of the region,
  not a child. `HeatmapPanels`, `DistributionPanels` and `CompareTable` mention
  ResponsiveTable only in comments. `relative` with no offset or z-index creates
  no stacking context, so the sticky rank and name cells keep the region as their
  scroll container. The `isolate` on the StrategyTable root keeps the z-30 header
  cells below the z-10 sticky filter bar.
- **AllocationsTabs strip.** It is one line at every width (`flex-nowrap`), it
  shrinks (`min-w-0`, `sm:basis-auto`), and every action is `shrink-0`. The roving
  tabindex plus `computeTabStripScroll` keep the active tab reachable, and the
  e2e End-key check covers the last tab. Underline `TabsList` uses
  `focus-visible:ring-inset`, so the scroller does not clip the focus ring.
- **Reflow helper.** Pass or fail depends only on the slop of the document and of
  `#main-content`. The containing-block walker only names the offender, so a
  walker defect cannot turn a red gate green. `e2e/reflow.spec.ts:130` adds the
  fixture VERIFICATION asked for (an abspos escapee with `#main-content` present).
- **`assertFitsOrScrollsInside`.** It throws when there are zero children, when
  the strip wraps (`maxTop >= minBottom`), and when the strip overflows without
  being an `auto`/`scroll` scroller. It cannot pass on a wrapped strip or on one
  that clips without scrolling.
- **Hydration across midnight (170-13 note), rated LOW.** The page is
  `force-dynamic`. Both sides use UTC. The mismatch window is the seconds between
  SSR and hydration that straddle 00:00 UTC on the 1st, and React patches the one
  text node. Below the reporting threshold. The real problem with the label is a
  different one (WR-03).
- **Re-coloured chips.** `#4A5568` on `#F1F5F9` is about 7:1, which passes AA.
- **`Button` `hidden` regex.** It matches only a bare `hidden` token. `md:hidden`
  and `overflow-hidden` do not match. Only the three N-MATCH callers pass `hidden`.
- **Mobile offsets.** `MobileNav` is `fixed bottom-0` and has no safe-area
  padding, so `ScenarioFooter bottom-16` and `Tweaks bottom-20` clear it.

## Critical Issues

### CR-01: `/strategies` row: from `md` to about 960 px the name block shrinks to 0 px and the name paints over the controls (desktop 200% zoom band)

**File:** `src/app/(dashboard)/strategies/page.tsx:774`, `:790`
**Issue:** From `md` up the row is `md:flex-row`. The name block is `flex-1 min-w-0`
(flex-basis 0, minimum width 0). The control group is
`flex flex-wrap ... md:ml-4 md:shrink-0`. Because of `md:shrink-0`, the group's
flex-basis is its max-content width on a single line, so its own `flex-wrap` can
never wrap. If that width is larger than the row, the name block gets exactly 0 px.
The `<Link>` text then overflows its 0-wide box and paints under or over the
private-link button and the status badge. That is the overlap SC1-PRIVLINK
forbids. In milder cases the name gets less than the 160 px floor from GC-02.

GC-02 assumed that "from `md` up it is one row with the control group at its
natural width". That does not hold once the 260 px sidebar is there:

- At 768 px the row has about 768 − 260 (sidebar) − 64 (`md:px-8`) − 48 (Card
  `p-6`) − 16 (`md:ml-4`) ≈ **380 px**.
- A **draft** row's group is about 400–430 px: "Get private link" (sm, about
  145) + "draft" badge + "Submit for Review" (sm, about 135) + date + 3 × 12 px
  gaps. It overflows the card, and the name gets 0 px.
- A **published** row (about 380 px) leaves the name only a few pixels at 768.
- A failed copy ("Copy failed — copy the URL manually") adds about 120 px more.
- By the same arithmetic the 160 px floor is only met from about 950–980 px.

Desktop 200% zoom on 1536, 1600 and 1680 px displays gives 768, 800 and 840 CSS px,
which are all in this band. The e2e only measured V960 (1920 at 200%), and
`setSeededStrategyNameAndTags` makes the seeded row **published**, so it measured
the shorter control set. A draft row at V960 would get about 138 px.
**These widths are calculated, not measured.** The fixer should first measure
768×540 and 800×600 with a draft row seeded.

**Fix:** Let the group wrap and keep a hard floor for the name. One option:

```tsx
<div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
  <div className="min-w-0 md:min-w-[160px] md:flex-1">…</div>
  {/* no md:shrink-0: the group can shrink and wrap its own items */}
  <div className="flex flex-wrap items-center gap-3 md:ml-4 md:min-w-0 md:justify-end">…</div>
</div>
```

Another option is to move the stack breakpoint to `lg`. Either way, add a draft-row
N-STRAT case at 768 and 800 px wide (desktop 200% zoom) that asserts
name ≥ 160 px and that the name and the controls do not intersect.

## Warnings

### WR-01: Tweaks toggle moved to the header but the dialog stays at the end of the DOM, so a keyboard user must tab through the whole tab panel to reach it

**File:** `src/app/(dashboard)/allocations/AllocationsTabs.tsx:918` (toggle), `:1032` (`<Tweaks />`); `src/app/(dashboard)/allocations/components/Tweaks.tsx:27-48`
**Issue:** Before this phase `<TweaksToggle />` and `<Tweaks />` were DOM neighbours.
Pressing Tab after opening the panel went straight into it. Now the toggle sits in
the header action row and the `role="dialog"` still renders after all the tab
content. `Tweaks` does not move focus in on open or back on Escape.

Failing scenario: on `/allocations?tab=scenario` a keyboard user presses Space on
"Tweaks". The panel appears at the bottom-right. Their next Tab goes to
"+ Strategy", then through the tab panel: every composer row's weight, mode,
leverage and notional input, the collapsibles, and the footer. Only after all of
those does focus reach the panel's first control. This breaks WCAG 2.4.3 (focus
order), and it is new in this phase.
**Fix:** Move focus into the dialog when it opens and back to the toggle when it closes:

```tsx
useEffect(() => {
  if (!panelOpen) return;
  panelRef.current?.querySelector<HTMLElement>("button, [href], input, select")?.focus();
  return () => document.querySelector<HTMLElement>("[data-tweaks-toggle]")?.focus();
}, [panelOpen]);
```

The panel is `fixed`, so another option is to render `<Tweaks />` right after
`<TweaksToggle />` in the action row. Its DOM position does not affect where it paints.

### WR-02: `NowrapWords` makes a long hyphenated name impossible to break, and on `/strategies` nothing contains the overflow

**File:** `src/components/ui/NowrapWords.tsx:17-27`; used at `src/app/(dashboard)/strategies/page.tsx:777`
**Issue:** Each space-separated token becomes a `whitespace-nowrap` span. A token the
browser used to break at its hyphens now cannot break at all. On `/strategies` the
name block (`flex-1 min-w-0`) is not inside a scroller and does not clip. At V390 the
card's inner width is about 390 − 32 − 48 ≈ 310 px. A name such as
`Delta-Neutral-Funding-Rate-Arbitrage-BTC` (about 40 characters, about 320 px at
DM Sans 16 px) overflows the card, and with it `#main-content`. That is the phase's
own SC2 page-overflow failure. No maximum strategy-name length is enforced anywhere
in `src/`. Adding `overflow-wrap` does not help, because it cannot break inside a
`whitespace-nowrap` span. In StrategyTable the same name is inside the ResponsiveTable
scroller, so it is contained there and that site is not a finding.
**Fix:** Give the `/strategies` name a guaranteed fallback, for example
`className="block truncate …"` on the `<Link>` with `title={s.name}`, or
`overflow-hidden` on the name block. Another option is for `NowrapWords` to only
apply nowrap to tokens under a length cap (for example 24 characters) and leave
longer tokens breakable.

### WR-03: "Final month (MMM YYYY)" appears on live strategies whenever the last daily is in the previous month

**File:** `src/app/factsheet/[id]/v2/MetricsColumn.tsx:438-444` (used at `:178` and `:566`)
**Issue:** `m.end` is `dates[n - 1]` (`src/lib/factsheet/compute.ts:253`), which is the
last *return date*, not an "ended" marker. `monthRowLabel` treats "last month ≠
current UTC month" as "the record ended". `FactsheetPayload` has no ended or
archived field (`src/lib/factsheet/types.ts`). Real cases where this is wrong:

- On the 1st of every month, every live daily strategy reads `Final month (Sep 2026)`
  until that day's daily arrives.
- For traditional-asset strategies over a weekend at the start of a month,
  2026-11-01 is a Sunday, so they read `Final month (Oct 2026)` through about Nov 2–3.
- A live strategy whose sync has stalled across a month boundary reads it until the
  sync recovers.

In each case a public, published factsheet says a running record has ended.
**Fix:** Use a "Final" label only when there is a known-ended signal. The payload has
none today. One way to add it is to thread `strategies.status` (archived) or an
explicit end flag into the payload and branch on that. Until then, use a label that
does not claim the record ended, for example
`` `Month-to-date` `` when `end` falls in the current month or the previous month,
and `` `Last month on record (${MMM} ${YYYY})` `` otherwise. Add a test for
end = 2026-09-30, now = 2026-10-01 on a live record.

### WR-04: The N-TABLE (k) gate can pass without the sticky header ever reaching the filter bar

**File:** `e2e/layout-narrow.spec.ts:518-535`
**Issue:** The scroll loop returns silently when `headerEl` or `filterEl` is missing
(`:522`). It also exits after 40 steps if the header never reaches `filterBottom`.
The comment says the selects are "checked either way". `assertNotCovered` then runs
on the Sort selects in whatever state the page is in. If the seeded table is too
short to scroll the header under the filter at a given viewport, or if a selector
drifts and `filterEl` is null, the test goes green without exercising the overlap
it exists to catch. That overlap is the z-30 header painted over the z-10 filter,
which the `isolate` fix addresses. This is the gate that pins a user-facing fix,
so a vacuous pass hides a regression.
**Fix:** Make the precondition a check that can fail:

```ts
const reached = await page.locator("#main-content").evaluate((main) => {
  const headerEl = document.querySelector("[data-strategy-table] thead");
  const filterEl = document.querySelector('[aria-label="Sort by"]')?.closest(".sticky");
  if (!headerEl || !filterEl) return "missing";
  const filterBottom = filterEl.getBoundingClientRect().bottom;
  for (let i = 0; i < 40; i++) {
    if (headerEl.getBoundingClientRect().top <= filterBottom) return "reached";
    main.scrollTop += 80;
  }
  return "not-reached";
});
expect(reached, `${vp.id}: header never passed the filter bar — seed more rows`).toBe("reached");
```

Also remove the unused `header` and `filter` locators (`:512-513`, `:530-531`).

---

_Reviewed: 2026-10-01T06:38:45Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
