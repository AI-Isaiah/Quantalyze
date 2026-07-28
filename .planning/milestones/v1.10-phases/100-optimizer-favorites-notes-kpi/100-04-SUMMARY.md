---
phase: 100-optimizer-favorites-notes-kpi
plan: 04
subsystem: ui
tags: [react, nextjs, supabase, allocations, notes, watchlist, optimizer, wave-2, sc-4]
requires:
  - phase: 100-01
    provides: DashboardNoteCard {initialContent, initialLastSavedAt}; user_notes dashboard scope
  - phase: 100-02
    provides: WatchlistPanel / OptimizerPanel; watchlist-read.ts getFavoritesWithStrategies/getOptimizerPrefetch + FavoriteRow/OptimizerPrefetch
  - phase: 99
    provides: additive Promise.all + prop-threading precedent, throw-to-error.tsx read discipline
provides:
  - "getDashboardNote (owner-scoped user_notes dashboard-scope initial read, throw-on-PostgREST) — colocated helper owned by 100-04"
  - "/allocations Holdings tab: Watchlist & Optimizer + Notes sections mounted below the Phase-99 exposure trio"
  - "page.tsx additive Promise.all (favorites/optimizer/note) threaded as NEW props through AllocationsTabs → HoldingsTabPanel"
affects: [PI-04, PI-05, /allocations demo-hero surface]
tech-stack:
  added: []
  patterns:
    - "Additive Promise.all + new-prop threading (Phase-99 precedent), polled payload byte-untouched (SC-4)"
    - "Optional additive props at the shared-client boundary → pre-existing test call-sites stay unmodified"
    - "@container host on a separate ancestor from @5xl:grid-cols-2 (CompareTable idiom) for own-width reflow"
key-files:
  created:
    - "src/app/(dashboard)/allocations/lib/dashboard-note-read.ts"
  modified:
    - "src/app/(dashboard)/allocations/page.tsx"
    - "src/app/(dashboard)/allocations/AllocationsTabs.tsx"
    - "src/app/(dashboard)/allocations/HoldingsTabPanel.tsx"
    - "src/app/(dashboard)/allocations/HoldingsTabPanel.test.tsx"
    - "src/__tests__/contracts/check-zod-db-check-parity.test.ts"
decisions:
  - "getDashboardNote is a NEW colocated helper owned by 100-04 (NOT plan-02's watchlist-read.ts export contract) — mirrors watchlist-read error discipline (throw-on-PostgREST, maybeSingle 0-row = honest-empty)"
  - "additive props typed OPTIONAL at AllocationsTabs/HoldingsTabPanel so pre-existing AllocationsTabs test call-sites stay byte-unmodified; page.tsx always threads all three (SC-4 regression gate intact)"
  - "section order: Strategies → Exposure → Watchlist & Optimizer → Notes → Exchange Positions (UI-SPEC 'below the exposure trio', exchange positions still last)"
requirements-completed: [PI-04, PI-05]
metrics:
  tasks: 2
  files_created: 1
  files_modified: 5
  commits: 4
  completed: 2026-07-12
---

# Phase 100 Plan 04: /allocations demo-hero wiring Summary

Wave-2 wiring that takes the /allocations consolidated demo-hero surface live: three NEW owner-scoped server reads (favorites, optimizer prefetch, dashboard-note initial content) join `page.tsx`'s `Promise.all` on the `auth.getUser()` id, thread as NEW props through `AllocationsTabs` → `HoldingsTabPanel`, and mount the "Watchlist & Optimizer" (2-col container-query grid) + full-width "Notes" sections directly below the Phase-99 exposure trio — the exact Phase-99 additive precedent, SC-4-safe.

## What was built

**Task 1 — page reads + prop threading** — commit `8b39aed6`
- `lib/dashboard-note-read.ts` (NEW, owned by this plan): `getDashboardNote(supabase, userId)` — owner-scoped `user_notes` select where `scope_kind='dashboard' AND scope_ref='allocations'`, returning `{ initialContent, initialLastSavedAt }`. `.maybeSingle()` → `{data:null,error:null}` for 0 rows (honest-empty `"" / null`); THROWS on real PostgREST error (reaches `allocations/error.tsx`). USER client + explicit `.eq("user_id", …)`; never admin. `userId` is the `auth.getUser()` id.
- `page.tsx`: appended `getFavoritesWithStrategies(supabase, user.id)`, `getOptimizerPrefetch(supabase, user.id)`, `getDashboardNote(supabase, user.id)` to the existing `Promise.all`; threaded `favorites` / `optimizer` / `note` as NEW props to `<AllocationsTabs>`. `getMyAllocationDashboard`/exposure calls byte-identical (only whitespace reindent from wrapping the assignment); `exposure` threading + `AllocationProvider` untouched.
- `AllocationsTabs.tsx`: extended the props intersection with the three (spread already passes them through).

**Task 2 — mount sections + integration test (TDD)** — RED `1da8532f`, GREEN `bd420a3f`
- `HoldingsTabPanel.tsx`: inserted two `<section>`s between Exposure and Exchange Positions — `aria-label="Watchlist & Optimizer"` (exposure heading idiom `text-sm font-semibold uppercase tracking-wider`, `@container` host on a separate ancestor from `@5xl:grid-cols-2`, `gap-6`, stacked <1024px) hosting `WatchlistPanel` + `OptimizerPanel`; `aria-label="Notes"` full-width hosting `DashboardNoteCard` (owns its own heading). `suggestedIds` = memo over `optimizer.initialSuggestions` strategy_ids (real cross-link; `[]` when uncomputed). New props defaulted honest-empty when absent.
- `HoldingsTabPanel.test.tsx`: new describe — section order, SC-4 exposure-section-unchanged, honest-empty (all three, zero fabricated rows), and the Suggested cross-link (favorite present in `initialSuggestions` → exactly one chip; empty suggestions → none). PortfolioOptimizer stubbed to a marker (avoids `useRouter`).

## Verification evidence
- `npx tsc --noEmit`: clean.
- grep gate: exactly ONE `getMyAllocationDashboard(user.id)` in page.tsx.
- `npx vitest run "src/app/(dashboard)/allocations/"`: 1483 passed (115 files) — all pre-existing allocations + exposure + AllocationsTabs tests green, unmodified.
- `npm run lint`: 0 errors (1 pre-existing `EquityChart.tsx` exhaustive-deps warning, out of scope).
- `npm run test:coverage`: 8129 passed / 0 failed; thresholds hold — Stmts 84.41 (≥80), Branch 77.54 (≥72), Funcs 81.38 (≥74), Lines 86.54 (≥82).
- SC-4 diff: page.tsx read-calls byte-identical (indentation-only reflow); no read folded into `getMyAllocationDashboard`; `exposure` prop preserved.

## Auth + SC-4 confirmation
- **Auth (source-lock):** all three new reads use `supabase.auth.getUser()`-derived `user.id` + the page's USER (RLS) client — never the admin client, never a client/route param. Mirrors Phase-99.
- **SC-4 additive:** the new data is a DISTINCT set of `Promise.all` items and DISTINCT props — NOT folded into the polled `getMyAllocationDashboard` payload; `exposure` threading untouched; errors propagate to `error.tsx` (throw-on-PostgREST, no try/catch collapse). Pre-existing tests green with zero fixture edits.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Stale scope_kind parity mirror from plan 100-01** — commit `77ba654e`
- **Found during:** Task 2 coverage gate (`npm run test:coverage`).
- **Issue:** `src/__tests__/contracts/check-zod-db-check-parity.test.ts:313` hardcodes a TS mirror of `user_notes.scope_kind` at the old 4-value set `["portfolio","holding","bridge_outcome","strategy"]`. Plan 100-01 added the 5th value `dashboard` to the SQL CHECK (mig `20260715090000`) AND the runtime TS sets (`ownership.ts` ScopeKind, `route.ts` ALLOWED_KINDS) — but this test's mirror was never synced, and the contract test only runs in the full coverage suite (not run in 100-01). Result: red gate on `onlyInSql: ['dashboard']`.
- **Fix:** Added `"dashboard"` to the mirror + a comment pinning it to the shipped truth. Root-cause alignment to already-shipped, already-RLS-tested behavior (100-01's `test_user_notes_dashboard_scope.sql`); no runtime change.
- **Files modified:** `src/__tests__/contracts/check-zod-db-check-parity.test.ts`
- **Verification:** parity suite 19/19 green; full coverage suite green.

**2. [Rule 3 - Blocking] Additive props typed OPTIONAL (plan wrote required)**
- **Found during:** Task 1 (tsc).
- **Issue:** Typing `favorites`/`optimizer`/`note` as REQUIRED on the shared `AllocationsTabs` broke ~24 pre-existing `AllocationsTabs.*.test.tsx` call-sites at compile time (they construct props inline without the new fields) — contradicting "existing tests green, unmodified".
- **Fix:** The three props are OPTIONAL at the `AllocationsTabs`/`HoldingsTabPanel` boundary (honest-empty default when absent); `page.tsx` ALWAYS threads all three, so the real page contract is unweakened and SC-4's regression gate (unchanged tests) stays intact.
- **Files modified:** `AllocationsTabs.tsx`, `HoldingsTabPanel.tsx`

**3. [Rule 1 - Test robustness] getAttribute over CSS `&` attribute selector**
- **Found during:** Task 2 GREEN.
- **Issue:** `querySelector('section[aria-label="Watchlist & Optimizer"]')` returned null in jsdom — its selector parser mishandles the literal `&` in the attribute value (the section IS in the DOM; the `indexOf` order assertions passed).
- **Fix:** assert landmarks via `getAttribute("aria-label")` matching instead. Test-only robustness; no source change.

## Known Stubs
None — every rendered value flows from a real read/prop; empty/degraded states are honest (Watchlist "No favorites yet", Optimizer 0-portfolio gate, Notes placeholder), never fabricated.

## Threat Flags
None beyond the plan's `<threat_model>`. T-100-09 (info disclosure) mitigated: `getDashboardNote` is RLS user-client only + explicit `.eq("user_id", …)`, admin client never used; favorites/optimizer reads inherit 100-02's owner-scoping. T-100-10 (SC-4 drift) mitigated: additive-only Promise.all + unchanged pre-existing tests as the regression gate.

## Self-Check: PASSED
- Created file present: `src/app/(dashboard)/allocations/lib/dashboard-note-read.ts`.
- All 4 commits present: `8b39aed6`, `1da8532f`, `bd420a3f`, `77ba654e`.
- Full allocations suite (1483) + full coverage suite (8129) green; tsc + lint clean.
- Note: `.planning/` is gitignored (local ledger) — this SUMMARY is not committed by convention.
