---
phase: 170-pagecopy
review: silent-failure-hunter
scope: "git diff 25182655c..HEAD -- src e2e (72 files)"
head: b71658a1f
reviewed: 2026-10-01
threshold: MEDIUM and above only (founder rule)
findings:
  critical: 0
  high: 0
  medium: 5
---

# Phase 170: silent-failure review

Scope: the 72 files in `git diff 25182655c..HEAD -- src e2e` at `b71658a1f`. Only MEDIUM-or-higher findings are listed. The checked-clean section at the end answers each focus question from the brief.

## Findings

### SFH-170-01: the N-TABLE row never checks that it reached the overlap it is named for (MEDIUM)

- **Location:** `e2e/layout-narrow.spec.ts:514-537`
- **What is wrong:**
  - Line 514 sets `#main-content.scrollTop = scrollHeight`, so the page is already fully scrolled. The 40-step loop at :519-529 then adds `+= 80` to a scroller that is already at its maximum. It moves nothing, so it is dead code.
  - The loop also returns silently when `[data-strategy-table] thead` or `[aria-label="Sort by"]` → `.closest(".sticky")` matches nothing.
  - No assertion checks that any table content passed under the filter bar. The test then runs `assertNotCovered` on the two Sort selects whatever state it is in.
  - At `StrategyTable.tsx:873` the `<thead>` has no sticky class. The box that actually slides under the filter bar is the sticky first-column `td` at `StrategyTable.tsx:1091` (`sticky z-10`). The `isolate` fix at `StrategyTable.tsx:823` exists for exactly that box. The test never measures it.
- **Failing scenario:** the seeded table is too short to reach the filter bar at a given viewport, or a selector or class rename makes the loop return early. In either case the selects are probed on a resting page, where nothing can cover them, and the row passes. If `isolate` later regresses, the sticky `td` covers the Sort control again and this row stays green. VERIFICATION already records that V960 passed, and nothing shows the overlap was reached there.
- **What the user sees:** on `/my-strategies` after scrolling, the Sort by and Sort direction selects sit under the sticky strategy-name column and do not respond to taps. The gate that claims to guard this reports green.
- **Recommendation:** remove the dead loop. After scrolling, measure the filter bar rect and the first sticky `td` rect in the same evaluate. Throw unless they intersect vertically, with a message like "N-TABLE precondition not reached: sticky td top=… filter bottom=…". Only then run `assertNotCovered`. Throw instead of `return` when either element is missing.

### SFH-170-02: the geometry helpers cannot see a control clipped by an `overflow-hidden` ancestor, and SC2-PROFILE claims they can (MEDIUM)

- **Location:**
  - `e2e/layout-narrow.spec.ts:369-375`: the comment says "Scroll it into view so the check measures clipping".
  - `e2e/helpers/geometry.ts:50` (`assertInsideViewport`, which uses `boundingBox()`) and `:76` (`assertNotCovered`, which probes the centre point only).
  - `e2e/helpers/reflow.ts:140-141`: an `overflow-x: hidden` or `clip` ancestor counts as "contained".
  - Target: `src/components/exchanges/AllocatorExchangeManager.tsx:1307`. The key list wrapper is `divide-y … rounded-lg overflow-hidden`.
- **What is wrong:**
  - `boundingBox()` returns the element's own rect and ignores ancestor clipping.
  - `assertNotCovered` fails only when the centre point is clipped.
  - Content inside an `overflow: hidden` box adds nothing to `scrollWidth`, so `assertNoReflow` cannot see it either. Its offender walk deliberately treats `hidden` and `clip` ancestors as containment.
  - So a Disconnect button whose right part is cut off by the wrapper at :1307 passes all three checks. `scrollIntoViewIfNeeded` also scrolls horizontally, so a control that is only reachable by sideways scrolling is moved into view before it is measured.
- **Failing scenario:** at 390 px, a longer exchange label or an extra MT5 "Update password" button pushes the action group past the row edge. The `overflow-hidden` wrapper cuts Disconnect in half. SC2-PROFILE stays green.
- **What the user sees:** a destructive control that is partly or fully cut off, while the phase's gate reports that it fits.
- **Recommendation:** run `assertChildrenInside(page, keyRow, …)` on `[data-testid="allocator-key-row"]`, since that helper measures descendants against their container. Or add a helper that walks from the button to every ancestor whose computed `overflow-x` is `hidden` or `clip` and asserts the button rect lies inside each one. Correct the :369-372 comment: what is measured today is viewport containment, not clipping.

### SFH-170-03: the diff widened a select whose error renders "All caught up" (MEDIUM, pre-existing, touched by this diff)

- **Location:** `src/app/(dashboard)/admin/page.tsx:36-37` (select now `profiles!strategies_user_id_fkey(display_name, email)`), `:70` (`pendingStrategies.data ?? []`). Empty state at `src/components/admin/AdminTabs.tsx:443`.
- **What is wrong:** the `error` from this query is never read. Any PostgREST failure (embed or column drift, a renamed FK, a timeout) turns into `[]`. The Strategy Review tab then reads "All caught up. No strategies pending review." and its tab count shows 0 (`AdminTabs.tsx:120`). The swallow predates this phase. Phase 170 edited this exact select (adding `email`) without addressing it. The realistic trigger is low: the client is service-role and `profiles.email` exists. The cost of a trigger is high, though: strategies awaiting review disappear without any signal.
- **What the user sees:** the admin sees an empty review queue and moves on. Managers' strategies sit in `pending_review` with nothing to show it.
- **Recommendation:** check `pendingStrategies.error` (and the three sibling queries), log it with the query name, and throw, or render an explicit "Could not load pending strategies" state. The same pattern already exists in `src/lib/admin/match.ts:151-157`.

### SFH-170-04: the masthead session read swallows every exception without logging and without `unstable_rethrow` (MEDIUM)

- **Location:** `src/components/marketing/MarketingHeaderActions.tsx:37-46` (bare `catch { signedIn = false; }` at :44).
- **What is wrong:** failing closed to the signed-out links is a documented decision (170-07-SUMMARY:125). The catch, however, is untyped and silent. A thrown `createClient()` (missing env or a cookie-store fault) and a network failure inside `getUser()` both become "signed out" with no log line. The Next 16 docs (`node_modules/next/dist/docs/01-app/03-api-reference/04-functions/unstable_rethrow.md`) list `cookies()` among the request-time APIs whose framework errors "should not be caught by the developer", and `createClient` calls `cookies()` inside this try. The static-prerender risk is not claimed here: the SC2-HEADER rows in CI showed "Go to app" on signed-in `/security` and `/legal/privacy`.
- **Failing scenario:** auth starts throwing on marketing routes after a deploy, for example from an env change. Every signed-in visitor to `/security`, `/legal/*` and `/demo` sees Sign in and Sign up. Nothing reaches the logs or Sentry, so nobody learns that the session read is failing.
- **What the user sees:** a signed-in user is offered "Sign in", which looks like a lost session.
- **Recommendation:** call `unstable_rethrow(err)` first in the catch, then `console.error("[marketing-header] session read failed", err)` (or the project's Sentry capture). Then fall back to signed-out. Leave the documented `error` return path (anonymous `AuthSessionMissingError`) unlogged.

### SFH-170-05: a confirmed recompute is dropped silently, and Save still writes, once the viewport falls below 768 px with the preferences panel open (MEDIUM)

- **Location:**
  - `src/components/admin/AllocatorMatchQueue.tsx:179`: `readOnly = forceReadOnly || !isMd`.
  - `:235`: `if (readOnly) return;` in `handleRecompute`, with no message.
  - `:864`: `onRecomputeRequested={handleRecompute}`, passed unguarded.
  - `src/components/admin/PreferencesPanel.tsx:155-162`: after a successful PUT it asks `confirm("Preferences saved. Recompute the match queue now…?")` and calls `onRecomputeRequested()`.
  - `PreferencesPanel.tsx:175`: the panel is `fixed inset-0`, so CSS does not hide it below md.
- **What is wrong:** the read-only contract below 768 px is enforced by hiding the openers with CSS and by early returns in the handlers. If the panel is already open when the viewport crosses below md, two things go wrong:
  - **Silent drop:** `handleRecompute` returns without doing anything after the admin explicitly confirmed the recompute. No error, toast or banner tells them.
  - **Write still allowed:** the panel's Save button still PUTs `/api/admin/match/preferences/<id>`. That breaks the "no write control below 768 px" contract the N-MATCH row asserts.
- **Failing scenario:** an admin opens Edit preferences on an iPad mini in landscape (≥768 px), rotates to portrait (744 px), saves, and answers OK to "Recompute now?". The preferences are written, the recompute never runs, and the queue keeps showing candidates scored against the old preferences. Shrinking a desktop window or zooming in does the same.
- **What the user sees:** "Preferences saved." and an accepted recompute prompt, followed by an unchanged match queue that looks freshly confirmed.
- **Recommendation:** gate the panel the same way: close it, or disable Save with an explanation, when `readOnly` becomes true. When `handleRecompute` refuses because of `readOnly`, surface it ("Recompute is available at 768 px or wider") instead of returning silently. Apply the same treatment to the `handleDecision` early return at `:312`.

## Checked clean (no MEDIUM+ finding)

- **`src/lib/admin/match.ts` castRowOrNull (focus question).** `preferencesRes.error` is thrown at `match.ts:153`, before the cast at :168/:231. A `null` that reaches `castRowOrNull` can only be a genuine missing row. `.maybeSingle()` returns an error (PGRST116) on more than one row, and that error is thrown as well. So a failed read cannot be shown as "no preferences". Showing an allocator with no preferences row as having no preferences is correct, and it fixes the 500 that VERIFICATION recorded (row 12-13).
- **`monthRowLabel` (`MetricsColumn.tsx:438-444`).** `end` comes from `compute.ts:253` (`dates[n-1]`, an ISO date from the daily series). Real data cannot reach the empty or unparseable fallback to "Month-to-date". An empty series also nulls `mtd`, so that row would show "—" anyway. The component is `"use client"` and the label is computed at render, so a cached payload cannot freeze it.
- **`assertNoReflow` on an unrendered page.** Its anchor's visibility is still awaited first, so a blank, 404 or login page fails loudly. Both scrollers are always measured, and `#main-content` being absent falls back to the document gate (documented). A `position: fixed` box is excluded only from offender naming, never from the slop measure.
- **`assertFitsOrScrollsInside` on zero tabs.** Zero matching elements throws (`geometry.ts:159-163`), and zero laid-out children throws (`:178-182`). A wrapped strip throws, and an overflowing non-scroller throws. The four self-test fixtures in `e2e/reflow.spec.ts` cover fit, scroll, wrap and overflow.
- **"Last tab reachable" through keyboard End (SC2-(a)).** The strip's own effect scrolls the active tab into view, so a pointer user also reaches each partly visible tab by activating it. The test drives the same mechanism the product uses, so it hides nothing.
- **ResponsiveTable `relative` and `sr-only` (focus question).** `sr-only` already applies its own `clip` and `overflow: hidden`, so a second clipping box changes nothing in the accessibility tree. Playwright `getByLabel` resolves by accessible name, not geometry. The remaining non-`sr-only` `absolute` descendants in the consumers all have a nearer positioned ancestor (ScenarioComposer.tsx:7363/:7561 under a `relative` span), or sit outside the scroller (StrategyTable.tsx:1441, a sibling under the `relative isolate` root). The new containing block clips none of them.
- **Button `callerOwnsDisplay` (`Button.tsx:36`).** The only callers that pass `hidden` are the new N-MATCH buttons, so no existing control was hidden by the change.
