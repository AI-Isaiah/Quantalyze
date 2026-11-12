---
phase: 201-plainwords-one-name-per-concept-explained-and-the-small-inco
plan: 17
subsystem: copy-plainwords
tags: [watchlist, mandate, freshness, formatDay, term, copy-census, discovery, recommendations]
requires: [201-01, 201-03, 201-06, 201-25, 201-26]
provides:
  - "discovery tab reads `My watchlist` (component, test and e2e anchor)"
  - "recommendations: `Set your mandate →`, plain body sentence, `your mandate` relax link, all on /preferences"
  - "Term on the recommendations metric labels (CAGR, Sharpe, Max DD) and on the no-batch mandate wording"
  - "intro request placeholder `Mandate details: horizon, constraints, preferred styles...`"
  - "empty watchlist and watchlist-unavailable copy with no favorite or starred wording"
  - "FreshnessBadge and StaleSeriesChip print the full day through formatDay"
  - "ledger plan-17 is empty (`pending: {}`), census green"
affects: [201-16, 201-24]
tech-stack:
  added: []
  patterns: ["Term Form A on a static label inside a Metric row", "metric row located by [data-metric] in tests, not by the label's parent"]
key-files:
  modified:
    - src/components/strategy/WatchlistTabs.tsx
    - src/components/strategy/WatchlistTabs.test.tsx
    - src/components/strategy/EmptyWatchlist.tsx
    - src/components/strategy/FreshnessBadge.tsx
    - src/components/strategy/FreshnessBadge.test.tsx
    - src/components/strategy/StaleSeriesChip.tsx
    - src/components/strategy/RequestIntroButton.tsx
    - src/components/strategy/RequestIntroButton.test.tsx
    - src/app/(dashboard)/discovery/[slug]/page.tsx
    - src/app/(dashboard)/discovery/[slug]/page.test.tsx
    - src/app/(dashboard)/recommendations/page.tsx
    - src/app/(dashboard)/recommendations/page.mandate-gate.test.tsx
    - src/app/(dashboard)/recommendations/page.figure-gate.test.tsx
    - src/app/(dashboard)/recommendations/page.max-dd-tone.test.tsx
    - e2e/discovery-watchlist.spec.ts
    - scripts/copy-census/ledgers/plan-17.ts
  created:
    - src/components/strategy/EmptyWatchlist.test.tsx
    - src/components/strategy/StaleSeriesChip.test.tsx
key-decisions:
  - "The Mandate Term on /recommendations wraps the words `mandate` in the no-batch card (`Your mandate is set.`), the one place the page names the concept in running text outside a link or a heading a test pins by exact text."
  - "FreshnessBadge keeps its finite-timestamp guard: formatDay answers an em dash for a bad input, and the badge must show no date at all."
status: complete
requirements-completed: [CLAR-03, CLAR-04, CLAR-06]
duration: 20min
completed: 2026-11-11
actuals:
  tokens: 14000
  tasks: 3
  commits: 4
plan_head_before: 8724de1ab708bff9ef2d452ffeb07ac6c4a2d03b
plan_head_after: 8030faf2e3c1f058fc6f9cf5c7e4847a21d15417
---

# Phase 201 Plan 17: watchlist, mandate and freshness copy Summary

The discovery tab, the empty watchlist, the recommendations page and the intro request now call the same things by the same names (watchlist, mandate), the freshness and staleness chips print a full day, and ledger plan-17 is empty with the census green.

`commits: 4` is `git rev-list --count 8724de1ab..HEAD` with this SUMMARY's own commit included; `plan_head_after` is the last code commit.

## Task Commits

| Commit | Type | What |
|--------|------|------|
| cc559a8f9 | feat | Task 1 (tracer): `My watchlist` in WatchlistTabs, its test and the e2e anchor |
| 9be9613b6 | feat | Task 2: mandate on recommendations and the intro request, Terms on the metric labels |
| 8030faf2e | feat | Task 3: empty watchlist, freshness and staleness chips through `formatDay`, ledger emptied |
| (this commit) | docs | SUMMARY |

## What was built

- Task 1: the tab text is `My watchlist` (the badge is unchanged). `WatchlistTabs.test.tsx` and `e2e/discovery-watchlist.spec.ts` name the same string, including comments and failure messages (`grep -a -c "My Watchlist"` prints 0 in all three files; it was 1, 21 and 20 at HEAD). The test header cites U-10 and D-07.
- Task 2: `NoMandateState` reads `Set your mandate →` and `Tell us your strategy type, ticket size, and exchanges. …`; the no-candidates sentence reads `Try relaxing [your mandate] — the match engine …`; both links keep `/preferences` (T-201-23). `Metric` takes a `ReactNode` label, so CAGR, Sharpe and Max DD render through `Term` (`data-term` cagr, sharpe, max_drawdown); the row carries `data-metric`. The intro placeholder reads `Mandate details: horizon, constraints, preferred styles...`; the two `— No preference —` options stay (count 2).
- Task 3: `EmptyWatchlist` reads `Use the star on a strategy in the All tab to add it to your watchlist.`; the discovery page's unavailable notice reads `… strategies on your watchlist may not appear. Refresh to retry.`; `FreshnessBadge` prints `Sep 25, 2026` (guard kept; `formatAbsoluteDate` count 0) and `StaleSeriesChip` prints `Data from Oct 9, 2026` (`formatIsoDay` removed; the census flagged it as a rule C hit).

## Verification

- `node scripts/verify-plan-anchors.mjs <plan>`: OK, 2 claims checked, no stale.
- `npx tsx scripts/copy-census/run.ts --ledger plan-17` prints nothing (exit 0); the ledger has `pending: {}`, `exceptions: []`, `pinnedExceptionCount: 0`.
- Scoped vitest (WatchlistTabs, FreshnessBadge, StaleSeriesChip, EmptyWatchlist, RequestIntroButton, `discovery/`, `recommendations/`, copy-census, scan.test, figure-gate-census, public-truth-census, no-email-in-copy): 15 files, 374 tests green.
- `npx eslint` on every touched source, spec and ledger file: clean.
- `npm run typecheck`: clean (see the gates line).

## Neuter proofs (each: `cp -p` backup to the scratchpad, neuter, RED naming the cause, `cp -p` back, `cmp` exit 0, GREEN)

- `gc-201-17-neuter: gate=WatchlistTabs.test result=red restored=identical` Restored the title-case label in `WatchlistTabs.tsx`; RED: 12 tab-role arms could not find `/My watchlist/` and the census named the count change. cmp 0, GREEN.
- `gc-201-17-neuter: gate=RequestIntroButton.test result=red restored=identical` Restored `style preferences...`; RED: `Unable to find an element with the placeholder text of: Mandate details: horizon, constraints, preferred styles...`.
- `gc-201-17-neuter: gate=page.mandate-gate.test result=red restored=identical` Restored `Set preferences →` in recommendations `page.tsx`; RED: PW1 failed on the CTA text.
- `gc-201-17-neuter: gate=EmptyWatchlist.test result=red restored=identical` Restored `Star strategies from the All tab to track them here.`.
- `gc-201-17-neuter: gate=discovery-page.test result=red restored=identical` Restored `your starred strategies may not appear`; RED on the watchlist-unavailable arm.
- `gc-201-17-neuter: gate=StaleSeriesChip.test result=red restored=identical` Replaced `formatDay(seriesEnd)` with the raw ISO day; RED on `Data from Oct 9, 2026`.
- `gc-201-17-neuter: gate=FreshnessBadge.test result=red restored=identical` Replaced the helper with a yearless slice; RED on the two `Sep 25, 2026` arms.

Test-first RED was observed directly for Task 1 (12 failing arms before the rename), PW1 to PW3 (3 failing before the page change) and the FreshnessBadge, StaleSeriesChip arms. The RequestIntroButton, EmptyWatchlist and discovery-page arms were written after their one-line implementation edits, so their RED is the neuter proof above rather than a before-the-change run.

## cross-plan-pins (for plan 201-24; plan 201-16 owns the StrategyTable family)

These pins go red in this worktree by construction and are NOT edited here:

- `src/components/strategy/StrategyTable.test.tsx` lines with `getByRole("tab", { name: /My Watchlist/ })` (four) and the comments naming `My Watchlist`: new string `/My watchlist/`.
- `src/components/strategy/StrategyTable.test.tsx` the empty-watchlist arm `getByText(/Star strategies from the All tab to track them here/)`: new string `Use the star on a strategy in the All tab to add it to your watchlist.`
- `src/components/strategy/StrategyTable.selection.test.tsx` `getByRole("tab", { name: /My Watchlist/ })`: new string `/My watchlist/`.
- `src/components/strategy/__fixtures__/strategy-table-default-mounts.json`: the `discovery` mount carries `My Watchlist` (one occurrence); new string `My watchlist`.
- `src/components/strategy/StrategyTable.stale-series.test.tsx` the `Data from ${daysAgo(n)}` assertions (four, ISO form): the chip now prints `formatDay`, e.g. `Data from Oct 9, 2026`; the oracle must be typed by hand.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `page.test.tsx` does not exist in `recommendations/`**
- **Found during:** Task 2
- **Issue:** the plan lists `recommendations/page.test.tsx`; the directory holds `page.mandate-gate.test.tsx`, `page.figure-gate.test.tsx`, `page.max-dd-tone.test.tsx` and `page.stale-analytics.test.tsx`.
- **Fix:** the new mandate arms (PW1 to PW3) went into `page.mandate-gate.test.tsx`, which the plan does list.

**2. [Rule 1 - Bug] Colocated recommendation tests located the metric value through the label's parent**
- **Found during:** Task 2
- **Issue:** with the label inside a `Term`, `label.parentElement.lastElementChild` is no longer the value cell (13 failures in `page.figure-gate.test.tsx` and `page.max-dd-tone.test.tsx`).
- **Fix:** `Metric` carries `data-metric`; both helpers use `closest("[data-metric]")`. Both files are colocated tests of the file this plan owns.
- **Commit:** 9be9613b6

**3. [Rule 2 - Missing critical] Test files the plan did not list**
- **Found during:** Tasks 2 and 3
- **Issue:** no colocated test could fail for the EmptyWatchlist sentence, the StaleSeriesChip date or the discovery notice.
- **Fix:** added `EmptyWatchlist.test.tsx` and `StaleSeriesChip.test.tsx`, and an arm in `discovery/[slug]/page.test.tsx`.
- **Commit:** 8030faf2e

**4. The `[data-term="mandate"]` behavior line has no heading or label to attach to**
- The plan says the page's Mandate label renders through Term, but the census reports no mandate label on `/recommendations`: its rule B hits are the metric labels (CAGR, Sharpe, Max DD), which were wrapped. `mandate` itself appears in the page only in headings and exact-text copy that the 169.3 tests pin, the relax link (a link, so no Form A) and the no-batch sentence. The Term for `mandate` went on the no-batch sentence; PW3 pins it.

### Out-of-scope observations (not changed)

- `e2e/discovery-watchlist.spec.ts` has one failure-message string reading `user-A's favorites`; it is a test message, not user copy, and the census does not scan `e2e/`.
- A historical comment in `recommendations/page.tsx` and one in `page.mandate-gate.test.tsx` quote the old `relaxing your filters` wording as lineage.

## Known Stubs

None.

## Threat Flags

None. Copy only; the intro request payload and every route are unchanged (T-201-23: both `/preferences` links asserted in PW1 and PW2).

## Self-Check

Run before the SUMMARY commit: see the result appended below.
