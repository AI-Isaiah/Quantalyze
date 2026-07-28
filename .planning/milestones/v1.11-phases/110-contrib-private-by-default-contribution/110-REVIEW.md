---
phase: 110-contrib-private-by-default-contribution
reviewed: 2026-07-16T00:00:00Z
depth: deep
files_reviewed: 21
files_reviewed_list:
  - supabase/migrations/20260716130000_strategies_status_private.sql
  - supabase/migrations/20260716130500_finalize_terminal_status_param.sql
  - supabase/schema/functions/finalize_csv_strategy.sql
  - supabase/schema/functions/finalize_wizard_strategy.sql
  - src/lib/visibility.ts
  - src/app/api/strategies/browse/route.ts
  - src/app/api/strategies/finalize-wizard/route.ts
  - src/app/api/strategies/csv-finalize/route.ts
  - tools/eslint-plugin-quantalyze/rules/no-owner-or-on-admin-client.mjs
  - tools/eslint-plugin-quantalyze/index.mjs
  - eslint.config.mjs
  - src/app/(dashboard)/allocations/components/ContributionWizardOverlay.tsx
  - src/app/(dashboard)/allocations/components/StrategyBrowseDrawer.tsx
  - src/app/(dashboard)/allocations/components/ScenarioComposer.tsx
  - src/app/(dashboard)/strategies/new/wizard/WizardClient.tsx
  - src/app/(dashboard)/strategies/new/wizard/steps/SubmitStep.tsx
  - src/app/(dashboard)/strategies/new/wizard/steps/CsvSubmitStep.tsx
  - src/components/layout/DashboardChrome.tsx
  - src/components/layout/Sidebar.tsx
  - src/components/layout/MobileNav.tsx
  - src/components/layout/MobileSidebarDrawer.tsx
findings:
  blocker: 0
  high: 0
  medium: 1
  low: 3
  total: 4
status: findings
---

# Phase 110: Code Review Report

**Reviewed:** 2026-07-16
**Depth:** deep (cross-file: finalize routes ↔ RPCs ↔ RLS ↔ admin publish queue; nav union ↔ all consumers)
**Files Reviewed:** 21 (source only; tests + Phase-109 files excluded)
**Status:** findings (1 MEDIUM, 3 LOW — no BLOCKER/HIGH)

## Summary

Phase 110's core security invariants hold. I traced the never-publish (CONTRIB-02)
and no-leakage (CONTRIB-04) claims end-to-end and could not break them:

- **CONTRIB-02 never-publish — VERIFIED.** Both finalize routes derive
  `terminalStatus` from `entry_context` and can only ever produce
  `pending_review` or `private`. `entry_context` is validated against a closed
  set (garbage → hard 400) and is a *hint only*: even the manager value yields
  `pending_review`, never `published`. Both RPCs guard `p_terminal_status IN
  ('pending_review','private')` as their FIRST statement (RAISE otherwise), so a
  direct PostgREST call cannot reach `published` either. The admin publish queue
  keys on `status='pending_review'` (`admin/page.tsx:40`) and the promote path
  pins `.eq("status","pending_review")` before flipping to `published`
  (`strategy-review/route.ts:333`), so a `private` row is unreachable by the
  reviewer. No finalize arm was found that skips the `entry_context` branch: the
  single-key API contribution and composite contribution both route through
  `runLegacyFinalize` with `terminalStatus='private'`; the unified arm (reached
  only by the manager flow) correctly terminates `pending_review` by
  construction. The founder review-notification email is suppressed for `private`.
- **CONTRIB-04 no-leakage — VERIFIED.** `withPublishedOrOwner`'s owner id is
  `user.id` from `withAllocatorAuth` (session-only, never a request param). The
  RLS `strategies_read` backstop still gates the read. The
  `no-owner-or-on-admin-client` lint rule matches any `.or(...user_id.eq...)`
  regardless of client type (it tests the predicate source text), so it *does*
  catch the admin/service-role case; it is registered `error` on
  `src/**/*.{ts,tsx}`. I searched for status-filter consumers that could leak a
  `private` row and found none — every consumer checks `status === "published"`
  positively, so `private` is correctly treated as non-public.
- **NavItem discriminated union — VERIFIED.** `NavLinkItem` (`href`, `action?:
  never`) vs `NavActionItem` (`action`, `href?: never`) narrow correctly; every
  consumer that dereferences `.href` (`NavItemLink`, `MobileNav`) first branches
  on `item.action` and returns a `<button>` before the `item.href` active-state
  computation, so the action item never hits an `href`-assuming path.

The one real issue is an interaction defect on the mobile launch path (below).

## Medium

### MD-01: Mobile hamburger drawer stays open when "Add a Strategy" opens the overlay — competing focus trap (keyboard trap)

**File:** `src/components/layout/DashboardChrome.tsx:67` (`openContribute`)
**Issue:** `openContribute = () => setContributeOpen(true)` opens the
`ContributionWizardOverlay` but does not close the mobile sidebar drawer
(`setMenuOpen(false)`). The "Add a Strategy" nav action is wired into the drawer's
`Sidebar` (`onNavAction={openContribute}` at `:229`/`:153`) and, unlike a
`<Link>`, it does not change the route — so `MobileSidebarDrawer`'s auto-close-on-
pathname-change (`MobileSidebarDrawer.tsx:65-70`) never fires and the drawer stays
mounted. `MobileSidebarDrawer` runs an active **`window`-level Tab focus trap**
(`MobileSidebarDrawer.tsx:96-136`) that calls `e.preventDefault()` and re-focuses
its own panel whenever focus is outside it (`!panel.contains(active)`). The overlay
is `createPortal`-ed to `document.body` (outside the drawer panel), so every Tab
press inside the wizard overlay is hijacked back into the drawer — a genuine
keyboard trap (WCAG 2.1.2), on a project that locks WCAG-AA. Secondary effects:
both components set `document.body.style.overflow='hidden'`, and a single Escape
fires both close handlers at once.
**Fix:** Close the drawer when launching the overlay so the two modals are never
stacked:
```ts
const openContribute = () => {
  setMenuOpen(false);
  setContributeOpen(true);
};
```

## Low

### LW-01: `withPublishedOrOwner` interpolates `authUserId` into the PostgREST `.or()` filter without asserting UUID shape

**File:** `src/lib/visibility.ts:122-124`
**Issue:** `.or(\`status.eq.published,user_id.eq.${authUserId}\`)` string-interpolates
the id into a PostgREST filter grammar where `,`, `.`, and `()` are metacharacters.
The sole caller passes a trusted session UUID, so this is safe today, but the helper
is the by-construction chokepoint the lint rule funnels *all* future owner-inclusive
queries toward — a later caller passing a less-trusted id would get filter
breakage/widening with no guard here. Defense-in-depth only.
**Fix:** Assert the shape at the boundary, e.g. `if (!isUuid(authUserId)) throw new
Error("withPublishedOrOwner: authUserId must be a UUID")` before building the filter.

### LW-02: Owner-inclusive Browse predicate surfaces the owner's `draft`/`archived` rows, not only `private`

**File:** `src/app/api/strategies/browse/route.ts:129-142`; `src/lib/visibility.ts:115-125`
**Issue:** The predicate mirrors `strategies_read` exactly (`published OR
user_id=<id>`), so for a `role='both'` staff user the Browse drawer now lists their
own `draft`/`pending_review`/`archived` strategies — not just the intended `private`
contributions — as selectable scenario legs. A `draft` has no computed analytics, so
adding it could produce an empty/NaN scenario leg depending on how the composer
handles a series-less strategy. This matches locked decision D (RLS-mirroring), so it
is intended visibility, but the addable-draft edge is worth a conscious confirmation.
**Fix:** If only published + own-`private` should be addable, tighten to
`status.eq.published,and(user_id.eq.${id},status.eq.private)`; otherwise confirm the
composer degrades gracefully on a no-analytics leg and leave as-is.

### LW-03: `ContributionWizardOverlay` is `aria-modal="true"` with no focus containment or initial focus

**File:** `src/app/(dashboard)/allocations/components/ContributionWizardOverlay.tsx:73-142`
**Issue:** The overlay declares `role="dialog" aria-modal="true"` but implements only
Esc-to-dismiss — no Tab focus trap and no initial focus move into the dialog. This is
consistent with the cited sibling (`StrategyBrowseDrawer` is also `aria-modal` without
a trap), so it is not a Phase-110 regression, but the project's own
`MobileSidebarDrawer` shows the established trap pattern. Pre-existing a11y debt
inherited by the new surface; noting for completeness.
**Fix:** Optionally add the same Tab-cycle containment + initial-focus that
`MobileSidebarDrawer` uses, scoped to the overlay panel.

---

_Reviewed: 2026-07-16_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
