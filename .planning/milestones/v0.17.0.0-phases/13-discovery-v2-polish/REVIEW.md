---
phase: 13
slug: discovery-v2-polish
review_date: 2026-04-28
reviewer: gsd-code-reviewer (sonnet)
verdict: APPROVE-WITH-FIXES
scope: 12 commits between 0dffbd0..6ddab6a — 26 files, +3485/-340
---

# Phase 13 Code Review — Discovery v2 Polish

## Verdict
**APPROVE-WITH-FIXES** — no critical security/correctness blockers. 5 MEDIUMs + 5 LOWs.

## Findings

### MEDIUM-1 — UI-SPEC layout-contract drift in `StrategyFilters` row order
- **File:** `src/components/strategy/StrategyFilters.tsx:313-424`
- **Severity:** MEDIUM
- **Plan:** `13-UI-SPEC.md` filter row order: search → All Filters → leadingSlot → Hide-examples → Sort → Customize → ViewToggle
- **Evidence:** Sort group at line 354 carries `ml-auto`, pushing Sort/Customize/ViewToggle to the far right. Wide viewports show a giant gap between Hide-examples and Sort; narrow viewports wrap unpredictably.
- **Fix:** Drop `ml-auto` on the Sort group; let the row flow naturally with `gap-3`.

### MEDIUM-2 — `useDiscoveryPrefs` mirror effect re-runs on every prefs change, clobbers in-flight legacy state
- **File:** `src/components/strategy/StrategyTable.tsx:168-177`
- **Severity:** MEDIUM
- **Evidence:** Deps `[prefsHydrated, prefs]` re-run mirror every time `prefs` reference changes. `setPrefs(draftPrefs)` returns a new object reference, causing post-save re-render to clobber any user-driven column-sort or view-toggle change that hasn't been persisted via Save. `setDraftPrefs(prefs)` line silently discards in-flight unsaved edits if the user re-opens the drawer between two saves.
- **Fix:** Run mirror exactly once on hydration: gate on `prefsHydrated` only, drop `prefs` from deps. Seed `draftPrefs` separately in `handleOpenCustomize` (already at line 180).

### MEDIUM-3 — `StarToggle` retry chain has no unmount cleanup
- **File:** `src/components/strategy/StarToggle.tsx:70-97`
- **Severity:** MEDIUM
- **Evidence:** The 600ms retry gap + 4-second `setTimeout` for retry hint can fire on an unmounted component → React warning + slow accumulating leak when users navigate quickly.
- **Fix:** Track mount via a ref or `AbortController`; cancel retry chain and 4-second hint timer on unmount.

### MEDIUM-4 — `WatchlistTabs` arrow-key handler doesn't activate on focus move
- **File:** `src/components/strategy/WatchlistTabs.tsx:33-42`
- **Severity:** MEDIUM
- **Evidence:** ArrowLeft/ArrowRight only `.focus()` the other tab — they do NOT call `onScopeChange`. No Space/Enter handler either. ArrowLeft from "All" should be a no-op but always swaps focus.
- **Fix:** On ArrowLeft/ArrowRight, both `.focus()` AND call `onScopeChange(next)` (automatic activation pattern). ArrowLeft from "All" should be a no-op.

### MEDIUM-5 — Drawer `dirty` check is brittle to key order
- **File:** `src/components/strategy/CustomizeDrawer.tsx:91`
- **Severity:** MEDIUM
- **Evidence:** `JSON.stringify(draft) !== JSON.stringify(persisted)` — works only because both are constructed with the same key order. Fragile to refactor.
- **Fix:** Replace with explicit field-by-field equality check.

### LOW-1 — Migration 091 idempotency note (doc only)
- **File:** `supabase/migrations/091_seed_is_example_backfill.sql:23-34`
- **Severity:** LOW
- **Evidence:** Bare UPDATE + DO $$ probe. Supabase wraps each migration in a transaction; idempotency holds. NOTICE visibility depends on CLI flags. Not a bug.
- **Fix (optional):** Wrap in explicit `BEGIN; … COMMIT;` for documentation value.

### LOW-2 — `getMyWatchlist` swallows errors silently (acknowledged design)
- **File:** `src/lib/queries.ts:1709-1717`
- **Severity:** LOW
- **Evidence:** Returns empty Set on error. Already logged via `console.error` (per M3 fix in commit 7dd132c). No user-visible breakage because optimistic add hits idempotent route.
- **Fix:** None required.

### LOW-3 — `StarToggle` retry hint is `sr-only` only
- **File:** `src/components/strategy/StarToggle.tsx:113-117`
- **Severity:** LOW
- **Evidence:** UI-SPEC State Matrix says "inline retry hint copy". Implementation renders only `<span className="sr-only">` — sighted users see nothing on failure beyond icon flipping back.
- **Fix:** Add a tiny inline visual hint (e.g. red tint for 4s) OR fire a toast via the existing project toast system.

### LOW-4 — `discovery-prefs.ts` lint suppressions
- **File:** `src/lib/discovery-prefs.ts:96, 100, 102`
- **Severity:** LOW
- **Evidence:** Three `eslint-disable-next-line react-hooks/set-state-in-effect`. Pattern is correct (mount-time hydration) but smells.
- **Fix (optional):** Migrate to `useSyncExternalStore`-based hook.

### LOW-5 — Migration UPDATE doesn't filter `status='published'`
- **File:** `supabase/migrations/091_seed_is_example_backfill.sql:23-34`
- **Severity:** LOW
- **Evidence:** UPDATE filters only by `id IN (...)`. Audit query in comment filters `is_example=true AND status='published'`. UUIDs are pinned to seeds so collateral is unlikely; defensive add of `AND status='published'` to UPDATE matches audit predicate.
- **Fix (optional):** Add `AND status='published'` to UPDATE WHERE clause.

## Fix Prioritization (recommended order before merge)
1. **MEDIUM-1** — drop `ml-auto`; trivial CSS fix
2. **MEDIUM-2** — split mirror effect; prevents draft loss
3. **MEDIUM-4** — auto-activate tab on arrow-key focus move; closes a11y gap
4. **MEDIUM-5** — explicit dirty check; refactor-safety
5. **MEDIUM-3** — AbortController + unmount cleanup; defensive
6. **LOW-3** — visible retry hint OR explicit "audio-only" comment
7. **LOW-1, LOW-4, LOW-5** — defer to next maintenance pass

## Strengths
- Plan compliance is tight — components/routes/migration match plan signatures
- Security: PUT route order (CSRF → auth → rate-limit → validation → DB) is correct, fail-closed, uses limiter key `watchlist:{user.id}`. RLS + redundant `.eq("user_id", user.id)` on DELETE
- Cross-plan integration: `DEFAULTS.hide_examples=true` (13-02) + migration 091 (13-05) backfill — fresh allocator sees zero example strategies
- `getMyWatchlist` parallel fan-out (no waterfall)
- Idempotent: `upsert + ignoreDuplicates` for add, plain `.delete().eq()` for remove; migration is `SET is_example = true`
- Test coverage: 12 backend route tests, 12+ discovery-prefs, 9 StarToggle, 15 CustomizeDrawer, 6 sparkline; tests test contract not implementation
- DESIGN.md DIFF-05 sparkline rule correctly enforced via `sparklineColor()` helper at both call sites; drawdown stays static red per design exception
- StrategyGrid star-as-sibling-of-Link pattern avoids nested-button-in-anchor a11y trap

## Fix Application Log

Applied 2026-04-28 on `feature/v0.17-sprint-13`. All 5 MEDIUMs fixed; 5 LOWs deferred per Fix Prioritization. Test baseline 2369 → 2372 (+3 new regression tests: 2 in WatchlistTabs, 1 in StarToggle). `npm run build` exit 0.

| Finding | Commit | Summary |
|---|---|---|
| MEDIUM-1 | `bf23dce` | Drop `ml-auto` on Sort group in `StrategyFilters.tsx` so the row flows naturally with `gap-3` per UI-SPEC layout contract. |
| MEDIUM-2 | `8ff56e3` | Split mirror effect in `StrategyTable.tsx`: gate on `prefsHydrated` only (drop `prefs` from deps); remove redundant `setDraftPrefs(prefs)` (handled by `handleOpenCustomize`). |
| MEDIUM-3 | `66e5da7` | Add `isMountedRef` + `hintTimeoutRef` to `StarToggle.tsx`; guard post-retry revert/hint side effects; clear 4s timer in unmount cleanup. |
| MEDIUM-4 | `2b271e7` | `WatchlistTabs.tsx` Arrow keys now BOTH `.focus()` and call `onScopeChange` (automatic-activation pattern); ArrowLeft from "All" and ArrowRight from "watchlist" are no-ops. |
| MEDIUM-5 | `48224ad` | Replace `JSON.stringify` dirty check in `CustomizeDrawer.tsx` with explicit field-by-field equality on `view`, `hide_examples`, `sort.key`, `sort.dir`. |
