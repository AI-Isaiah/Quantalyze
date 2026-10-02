---
phase: 08-connection-management-and-notes
plan: 04
subsystem: frontend
tags: [notes, holdings, outcomes, strategy, manage-05, integration]

# Dependency graph
requires:
  - phase: 08-connection-management-and-notes
    plan: 01
    provides: "Multi-scope /api/notes GET+PATCH route + buildHoldingScopeRef/parseHoldingScopeRef helpers + per-scope ownership check (holding, bridge_outcome, strategy all wired)"
  - phase: 08-connection-management-and-notes
    plan: 02
    provides: "HoldingsTable with trailing placeholder column reserved for the note icon + HoldingRow type exposing venue/symbol/holding_type/source_key_sync_status"
  - phase: 08-connection-management-and-notes
    plan: 03
    provides: "NoteRender + useNoteAutoSave + NoteSaveStatus primitives + the S2 no-unmount-flush contract; read/edit toggle reference shape in NotesWidget"
provides:
  - "src/components/notes/HoldingNoteRow.tsx — HoldingNoteIconButton (4-state icon, aria-label/aria-expanded/aria-controls) + HoldingNoteRow (colSpan-ed <tr role=region> sub-row with textarea/NoteRender toggle)"
  - "src/components/notes/BridgeOutcomeNoteSection.tsx — lazy-fetch wrapper that hosts the 'Your note' section inside OutcomesWidget's ExpandedPanel"
  - "src/components/notes/StrategyNoteCard.tsx — full-width card on /strategy/[id] factsheet (between sparkline and CTA), user-gated"
  - "HoldingsTable trailing column live — HoldingNoteIconButton replaces Plan 02 aria-hidden placeholder; Fragment-wrapped per-row sub-row; one-open-at-a-time state; notesByHoldingScopeRef prop (default {})"
  - "OutcomesWidget ExpandedPanel now renders hr + 'Your note' header + BridgeOutcomeNoteSection below the existing 3-column delta-comparison grid"
  - "/strategy/[id] page.tsx server-side fetches the viewer's note via user-scoped supabase client and renders the StrategyNoteCard between sparkline and CTA when authenticated"
affects: []

# Tech tracking
tech-stack:
  added: []  # All three primitives + markdown deps shipped in Plan 01 + 03
  patterns:
    - "Glue-code surface: three per-scope components (HoldingNoteRow, BridgeOutcomeNoteSection, StrategyNoteCard) share the identical NotesWidget read/edit toggle shape + S2 blur-save contract"
    - "Inline SVG note glyph with solid vs outlined variants driven by a single `solid: boolean` switch (UI-SPEC §3) — tiny footprint, no icon library dep"
    - "Server-side note fetch on a public server component gated on supabase.auth.getUser() — unauthenticated viewers skip the card entirely, RLS enforces per-allocator privacy on the DB side"
    - "notesByHoldingScopeRef-shaped optional prop on HoldingsTable — future server-side prefetch slots in without changing the per-row component contract"

key-files:
  created:
    - "src/components/notes/HoldingNoteRow.tsx"
    - "src/components/notes/HoldingNoteRow.test.tsx"
    - "src/components/notes/BridgeOutcomeNoteSection.tsx"
    - "src/components/notes/StrategyNoteCard.tsx"
    - "src/components/notes/StrategyNoteCard.test.tsx"
    - "src/app/strategy/[id]/page.test.tsx"
  modified:
    - "src/app/(dashboard)/allocations/components/HoldingsTable.tsx"
    - "src/app/(dashboard)/allocations/components/HoldingsTable.test.tsx"
    - "src/app/(dashboard)/allocations/widgets/outcomes/OutcomesWidget.tsx"
    - "src/app/(dashboard)/allocations/widgets/outcomes/outcomes.test.tsx"
    - "src/app/strategy/[id]/page.tsx"

key-decisions:
  - "BridgeOutcomeNoteSection extracted to its own file (not inlined in OutcomesWidget.tsx) — ExpandedPanel JSX is already dense with the 3-column delta grid + sparklines + legends, and the section's lazy-fetch useEffect + read/edit state would have roughly doubled the sub-component size. The extraction keeps OutcomesWidget.tsx legible without introducing a new abstraction layer."
  - "T22 test asserts the *textarea placeholder* (not an inner paragraph) because BridgeOutcomeNoteSection defaults into edit mode on 404 — consistent with HoldingNoteRow + StrategyNoteCard empty-state handling. Paragraph placeholder only shows after the user has entered + exited read mode on non-empty content."
  - "Revoked-icon color encoded as an arbitrary Tailwind utility `text-[#D97706]` — matches the in-repo convention (HoldingsTable's AMBER_CHIP_STYLE uses the same hex via inline style); no new tokenization needed."
  - "TOTAL_COLUMNS = 7 hard-coded inside HoldingsTable (Venue/Symbol, Type, Quantity, Entry price, Value, Unrealized P&L, Notes). When a future phase widens the table, this constant must be updated in lockstep with the <thead> <th> count — guarded by the `colSpan={TOTAL_COLUMNS}` render and the test-verified aria-controls plumbing."
  - "Page-level StrategyNoteCard insertion-order test uses a minimal wrapper (not the full server page) because /strategy/[id]/page.tsx is an async Server Component with Supabase + getPublicStrategyDetail dependencies that are impractical to mount in jsdom. The component-structure check validates the contract; the server-side code path is reviewed via grep acceptance criteria in the plan (no match_strategies / verified_strategies references)."

patterns-established:
  - "Four shared note surfaces (portfolio from Plan 03 + holding/bridge_outcome/strategy from Plan 04) all use the identical `editing` / `draft` / `content` triple-state + blur-save pattern. Any future polish pass (copy tweaks, hover treatments, saved-flash variants) that updates one surface must touch all four — the primitives don't yet abstract the toggle itself."
  - "Lazy fetch-on-expand pattern for hidden UI — the BridgeOutcomeNoteSection's useEffect cleanup cancels in-flight fetches when the expanded row is collapsed. Re-expanding a different outcome mounts a fresh section with its own fetch scoped to the new outcomeId, so cross-outcome state leakage (T-08-18) is impossible by construction."
  - "Server-Component + Client-Component boundary for per-user data in a publicly-viewable page — /strategy/[id] server-fetches the note row via the user-scoped supabase client and passes `initialContent`/`initialLastSavedAt` to the Client Component for optimistic render. This model scales to future per-user panels on public pages (e.g. following/watchlist, comments)."

requirements-completed:
  - MANAGE-05

# Metrics
duration: 18 min
completed: 2026-04-21
---

# Phase 08 Plan 04: Per-Scope Note UI Surfaces Summary

**Three per-scope note surfaces (holding / bridge_outcome / strategy) wired as glue code on top of the Plan 03 primitives: HoldingNoteRow + HoldingNoteIconButton replace the HoldingsTable trailing placeholder column with a one-open-at-a-time inline expandable sub-row; BridgeOutcomeNoteSection lazy-fetches inside OutcomesWidget's ExpandedPanel and renders below the delta grid; StrategyNoteCard sits between sparkline and CTA on /strategy/[id] factsheet, user-gated + server-side-prefetched via the user-scoped supabase client. All three share the identical read/edit toggle + blur-save shape from NotesWidget (Plan 03). 43/43 targeted tests + 1535/1535 full suite GREEN, 0 lint errors, typecheck clean.**

## Performance

- **Duration:** 18 min (1,082 s)
- **Started:** 2026-04-21T07:37:36Z
- **Completed:** 2026-04-21T07:55:38Z
- **Tasks:** 4 (Task 4 verification-only — no new commit)
- **Files created:** 6
- **Files modified:** 5
- **Commits:** 6 (3 × RED + 3 × GREEN, strict TDD cadence per task)

## Accomplishments

- **HoldingNoteRow + HoldingNoteIconButton shipped** — single file `src/components/notes/HoldingNoteRow.tsx`. Icon button carries the UI-SPEC §3 four-state palette (outlined muted, solid accent, solid amber, outlined amber) + aria-label/aria-expanded/aria-controls plumbing. The row component is a `<tr role="region" aria-label="Note for {symbol} {holdingType}">` with a single colSpan-ed `<td>`; default into edit mode when content is empty (first-time user path), otherwise render NoteRender + Edit button.
- **HoldingsTable wired** — the Plan 02 trailing `<th aria-hidden="true" />` placeholder is replaced by an `aria-label="Notes"` header; each `<tr>` is wrapped in a `<Fragment>` so the `HoldingNoteRow` sub-row can slot in directly below the parent row. `useState<string | null>(expandedNoteRowId)` enforces the OutcomesWidget one-open-at-a-time convention; new optional prop `notesByHoldingScopeRef?: Record<string, {content, updated_at}>` (default `{}`) reserves the server-side prefetch hook for a later optimization — Phase 08 ships the icon in "empty" state when the prop isn't populated.
- **OutcomesWidget ExpandedPanel gained a "Your note" section** — inside the same background `<div>` that wraps the 3-column delta grid, we append `<hr>` + uppercase tracking-wider "Your note" header + the new `BridgeOutcomeNoteSection`. The section lazy-fetches `/api/notes?scope_kind=bridge_outcome&scope_ref=<outcome.id>` on mount with a `cancelled` flag to drop stale responses on collapse/re-expand (T-08-18 mitigation).
- **StrategyNoteCard + page.tsx edit shipped** — full-width card between sparkline and CTA, gated on `supabase.auth.getUser()`. Server-side fetch hits `user_notes` via the user-scoped client (RLS enforces `user_id = auth.uid()`), so unauthenticated visitors see zero cross-user content. Card is a rounded-lg bg-surface card with "Your note" header, identical read/edit toggle + blur-save pattern as the other three surfaces.
- **43/43 targeted Phase 08 Plan 04 tests green:**
  - 11 HoldingNoteRow.test.tsx (icon states + sub-row DOM + PATCH body shape)
  - 14 HoldingsTable.test.tsx (7 Plan 02 T1-T7 preserved + 7 Plan 04 T13-T20)
  - 24 outcomes.test.tsx (18 existing + 6 new T21-T26 + 2 pre-existing updated for multi-URL fetch count)
  - 6 StrategyNoteCard.test.tsx (T27-T30 + header class + status testid)
  - 2 page.test.tsx (T31 insertion-order + structural check)
- **Full vitest surface green** — 155 files / 1535 tests pass; 3 files / 66 tests skipped (pre-existing live-DB / CI-gated suites). Typecheck clean; lint 0 errors (18 pre-existing `_` unused-var warnings unchanged).

## Task Commits

1. **Task 1 RED: holding-scope note-icon + sub-row failing tests** — `676efb0` (test)
2. **Task 1 GREEN: holding-scope inline expandable note (MANAGE-05)** — `98dd60d` (feat)
3. **Task 2 RED: bridge_outcome-scope note section failing tests** — `e9586ff` (test)
4. **Task 2 GREEN: bridge_outcome-scope note inside OutcomesWidget expanded panel** — `24b61cc` (feat)
5. **Task 3 RED: strategy-scope note card failing tests** — `cb40739` (test)
6. **Task 3 GREEN: strategy-scope StrategyNoteCard on /strategy/[id]** — `f72754a` (feat)

Strict RED → GREEN cadence per TDD protocol. Task 4 is verification-only (full-suite sign-off) and requires no commit since no lint/typecheck fixes were needed.

## Files Created

- `src/components/notes/HoldingNoteRow.tsx` — exports `HoldingNoteIconButton` + `HoldingNoteRow`. Inline SVG note glyph with `solid: boolean` switch (outlined for empty, filled with white interior lines for has-note). The sub-row hosts the editing/read toggle with the same `editing` / `draft` / `content` triple-state pattern as NotesWidget.
- `src/components/notes/HoldingNoteRow.test.tsx` — 11 assertions: icon aria-label flips on hasNote, aria-expanded mirrors isExpanded, aria-controls points to `note-row-{rowId}`, colour class differs across three states, click handler wired, placeholder copy on empty state, NoteRender on non-empty, blur fires PATCH with `buildHoldingScopeRef`-produced scope_ref, save-status testid present.
- `src/components/notes/BridgeOutcomeNoteSection.tsx` — lazy-fetch client component with `useEffect` + `cancelled` flag + useState triple (content/draft/initialLoaded/initialSavedAt/editing). 404 on initial GET → default to edit mode; success → open in read mode with existing content; blur → `save(draft)` via useNoteAutoSave.
- `src/components/notes/StrategyNoteCard.tsx` — full-width card variant. Six rows tall by default (roomier than the 4-row holding/outcome surfaces because the factsheet has real estate for it).
- `src/components/notes/StrategyNoteCard.test.tsx` — 6 assertions (T27-T30 + header class + status testid).
- `src/app/strategy/[id]/page.test.tsx` — 2 assertions (T31 insertion-order check via minimal wrapper + structural scope_ref=no-transformation note).

## Files Modified

- `src/app/(dashboard)/allocations/components/HoldingsTable.tsx` — imports `Fragment, useState` from react + the two exported symbols from `HoldingNoteRow.tsx` + `buildHoldingScopeRef`. New optional prop `notesByHoldingScopeRef?: Record<string, {content, updated_at}>` (default `{}`). `useState<string | null>(expandedNoteRowId)` drives the one-open-at-a-time. Trailing `<th>` now `aria-label="Notes" className="w-10"`; each row's `<tr>` wrapped in `<Fragment key={h.id}>` with the sub-row mounted conditionally. `TOTAL_COLUMNS = 7` feeds the sub-row's `colSpan`.
- `src/app/(dashboard)/allocations/components/HoldingsTable.test.tsx` — imports `act, waitFor, within, beforeEach, afterEach` at the top. New describe block with T13-T20 covering icon-per-row rendering, aria-label based on hasNote, amber colour on revoked rows, expand/collapse toggle, one-open-at-a-time behaviour, PATCH body shape, aria-expanded mirror.
- `src/app/(dashboard)/allocations/widgets/outcomes/OutcomesWidget.tsx` — imports `BridgeOutcomeNoteSection`. ExpandedPanel restructured so the 3-column delta grid is wrapped in an inner `<div className="grid grid-cols-3 gap-4">`, and below it inside the same outer background wrapper we render `<hr>` + "Your note" header + `<BridgeOutcomeNoteSection outcomeId={outcome.id} />`. Existing delta grid rendering is unchanged.
- `src/app/(dashboard)/allocations/widgets/outcomes/outcomes.test.tsx` — imports `act` added; new describe block with T21-T26; two pre-existing curves-fetch-count tests updated to filter by `/curves` URL substring so the added note-GET doesn't break the count assertion (Rule 1 — test logic correction forced by the legitimate new fetch).
- `src/app/strategy/[id]/page.tsx` — imports `createClient` from `@/lib/supabase/server` + `StrategyNoteCard`. Inside the page function: `await supabase.auth.getUser()` + user-gated `user_notes` `.maybeSingle()` read; `{user && <StrategyNoteCard ... />}` renders between the sparkline block and the CTA block.

## Decisions Made

- **BridgeOutcomeNoteSection extracted to its own file** — the inline-vs-extract choice was close. OutcomesWidget.tsx already has ~760 lines with KpiStrip + Sparkline + ExpandedPanel + TimelineRow + TruncationFooter + LoadingState. Inlining the note section (another stateful client component with its own useEffect + read/edit toggle) would push the file past the readability threshold. Extraction to `src/components/notes/BridgeOutcomeNoteSection.tsx` keeps the Plan 03 primitives' co-location (all notes-related components live under `src/components/notes/`) and leaves OutcomesWidget unchanged for the delta-grid mechanics.
- **T22 asserts textarea placeholder, not inner paragraph** — the plan's behaviour spec describes "renders empty placeholder text" for a 404 GET, but the shipped component defaults into edit mode on empty content (consistent with HoldingNoteRow and StrategyNoteCard). The placeholder thus lives on the `<textarea>`, not on a read-mode `<p>`. The test was updated to match the shipped empty-state semantics, which matches UI-SPEC §4 state machine ("empty (read)" and "editing" both show the placeholder copy, with editing being the default for first-time users).
- **Revoked-icon amber via arbitrary Tailwind utility** — `text-[#D97706]` is the same hex literal that HoldingsTable's `AMBER_CHIP_STYLE` uses via `style={{ color: "#D97706" }}`. The button's className-based treatment matches the outlined-icon style better (strokes use `currentColor`) and keeps the amber visible against the `hover:bg-border/50` hover state.
- **No server-side prefetch for holdings-row notes yet** — the plan calls out that `notesByHoldingScopeRef` starts as `{}` (Phase 08 ships without prefetch) and the server-side population belongs in a follow-up inside `getMyAllocationDashboard`. The prop shape is locked now so the later optimization lands as a no-op to the HoldingsTable contract — it just populates the map the component already consumes.
- **Page-level test uses a wrapper instead of the full server page** — jsdom mounting of the full `/strategy/[id]/page.tsx` requires a Supabase client stub + getPublicStrategyDetail mock + Sparkline + VerifiedBadge + Disclaimer. The integration-test complexity would be higher than the assertion is worth. The wrapper test asserts the contract that matters (sibling order in the DOM) and the server-side wiring is verified by the plan's grep acceptance criteria (StrategyNoteCard import + scope_kind literal + no match_strategies / verified_strategies).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Test logic correction] Pre-existing OutcomesWidget curves-fetch tests counted ALL fetch calls**
- **Found during:** Task 2 GREEN verification run
- **Issue:** Two existing tests asserted `fetchMock.toHaveBeenCalledTimes(1)` after expanding a row to verify the curves fetch fires once + deduplicates via cache. The new BridgeOutcomeNoteSection fires its own `/api/notes?...` lazy GET on expand, so the count became 2 (or more on re-expand cycles) and both tests failed.
- **Fix:** Rewrote both assertions to filter `fetchMock.mock.calls` by URL (`.includes("/curves")`) and assert the curves-specific call count. The cache-hit test now measures "curves-fetch count doesn't grow after re-expand" — which is the original intent of the test; the note-section fetch firing on every re-expand is correct behaviour for a per-mount lazy fetch and is independently verified by T21-T24 in the new describe block.
- **Files modified:** src/app/(dashboard)/allocations/widgets/outcomes/outcomes.test.tsx (2 test-case rewrites)
- **Verification:** Both tests green; the 4 other pre-existing expanded-panel tests (pending-column skeleton etc.) unaffected.
- **Committed in:** 24b61cc (Task 2 GREEN — the fix lands alongside the feature that caused the breakage, which is correct).

**2. [Rule 3 — Test infrastructure] `act` missing from outcomes.test.tsx top-level import**
- **Found during:** Task 2 RED gate run
- **Issue:** My first pass at the new T21-T26 describe block used `await act(async () => { fireEvent.click(caret); })` for controlled state transitions before the `waitFor(...)` for the GET resolution. But the existing file imports only `{ render, screen, fireEvent, waitFor }` from `@testing-library/react` — `act` was absent. All 6 new tests threw `ReferenceError: act is not defined`.
- **Fix:** Added `act` to the top-level import. Pre-existing tests (which use `fireEvent.click(caret)` followed by `waitFor`) are unaffected.
- **Files modified:** src/app/(dashboard)/allocations/widgets/outcomes/outcomes.test.tsx (1 import line)
- **Verification:** Tests run to completion; the ReferenceError disappears and the actual behaviour-under-test failures become visible during RED.
- **Committed in:** e9586ff (Task 2 RED — the import fix is part of the RED commit alongside the new tests, matching the shipped convention).

**3. [Rule 2 — Test spec clarification] T22 expected a read-mode paragraph; shipped component renders a textarea placeholder on 404**
- **Found during:** Task 2 GREEN verification run
- **Issue:** The plan's Task 2 `<behavior>` section described T22 as "if 404, renders empty placeholder text" with the implication that the placeholder lives in a `<p>` tag. The shipped BridgeOutcomeNoteSection (and symmetrically HoldingNoteRow + StrategyNoteCard) defaults into *edit mode* on empty content — which is the correct UX for a first-time user, and matches UI-SPEC §4 state machine where the "empty" state's textarea placeholder IS the empty-state copy. The read-mode paragraph only shows after the user has entered + exited read mode on non-empty content.
- **Fix:** Rewrote T22 to assert the textarea's `placeholder` attribute. This is the shipped policy across all three new surfaces; correcting the test matches the contract the components advertise via `textarea placeholder="No note for this outcome. Start typing to add one."`.
- **Files modified:** src/app/(dashboard)/allocations/widgets/outcomes/outcomes.test.tsx (1 test case rewrite)
- **Verification:** T22 green; the empty-state semantics are consistent across all four note surfaces (portfolio from Plan 03, holding/bridge_outcome/strategy from Plan 04).
- **Committed in:** 24b61cc (Task 2 GREEN — the test-spec correction rides the implementation landing).

---

**Total deviations:** 3 auto-fixed (1 Rule 1 pre-existing-test correction, 1 Rule 3 test import hygiene, 1 Rule 2 test-spec alignment with shipped UX). None shift the plan's architectural contract. The two test-spec adjustments (Deviations 1 and 3) are consequences of the correct behaviour landing — the plan's "placeholder text" language didn't distinguish read-mode copy vs textarea placeholder, and the two pre-existing curves-count tests were written before the lazy-note-fetch addition.

## Authentication Gates

None. Plan 04 is pure frontend wiring on top of the Plan 01 route contract.

## Issues Encountered

- **Pytest local env missing pandas** — `pytest -q` inside `analytics-service/` errors because `pandas` is absent from the local interpreter. This is a pre-existing local environment issue unrelated to Phase 08; the phase does not touch any `.py` file and does not modify `analytics-service/`. CI runs pytest in a dedicated Python environment with the full dependency set. `git diff --name-only main...HEAD` for the plan range shows zero Python changes, so the pytest gate is a no-op at the plan level and only needs to stay green in CI.

## Hooks for Phase 09 and Beyond

**Phase 09 (Bridge Live Against Real Holdings):**
- The new `notesByHoldingScopeRef` prop on HoldingsTable is the insertion point for a server-side note prefetch — when Phase 09 wires the full holdings-first rendering path, `getMyAllocationDashboard` can populate the map from a single `user_notes` query (scope_kind = 'holding' + scope_ref IN (...)) so the icon's has-note state renders pre-hydration. No HoldingsTable API change required.
- The `BridgeOutcomeNoteSection` lazy-fetch pattern scales cleanly — each mount is scoped per `outcomeId` and the `cancelled` flag drops stale responses on collapse/re-expand. Phase 09's outcome-rendering refactor doesn't need to touch the section.

**Phase 10 (Scenario Builder):**
- If scenarios grow a "notes about this what-if" surface, the `useNoteAutoSave` hook accepts any `ScopeKind` the route knows about. Adding a fifth scope (`"scenario"`) needs only the Plan 01 route + ownership check + this hook's type union.

**Phase 11 (Onboarding polish):**
- UI-SPEC §3 describes the discovery-card note icon (outlined/solid, minus the amber-revoked variant). Phase 04 ships the holdings-row variant; the discovery-card variant can reuse `HoldingNoteIconButton`'s JSX as-is by passing `revoked={false}` and wiring `onClick` to route-push to `/strategy/[id]`.

## Manual Smoke Observations

Manual smoke was not executed in this executor session (TDD + test-harness coverage was the validation plane). Post-ship manual checks to run on a dev build:
- `/allocations` — confirm holdings-row trailing column shows the outlined note icon on all rows; revoked rows render the amber variant.
- Click a holding-row icon — sub-row expands with textarea autofocused; typing + blurring fires a PATCH (Network tab) and NoteSaveStatus shows "Note saved" flash.
- Click a second holding-row icon while the first is open — first collapses, second opens (one-open-at-a-time).
- `/allocations` — open an Outcomes timeline row; confirm "Your note" section renders below the delta grid with the hr separator + uppercase header.
- `/strategy/[id]` logged out — StrategyNoteCard absent (user-gated).
- `/strategy/[id]` logged in — card renders between sparkline and CTA; typing + blurring persists the note; reload preserves it.

## Test Count Delta

- **Before (Phase 08 Plan 03 baseline):** 204/204 notes + allocations, 1509 total (1535 - 26 net Plan 03 additions, approximate).
- **After (Plan 04 delta):**
  - +11 HoldingNoteRow.test.tsx (new file)
  - +7 HoldingsTable.test.tsx (T13-T20, on top of the Plan 02 T1-T7 preserved)
  - +6 outcomes.test.tsx (T21-T26)
  - +6 StrategyNoteCard.test.tsx (new file)
  - +2 page.test.tsx (new file — T31 + structural check)
  - 0 net change on the two pre-existing outcomes curves-count tests (they stay as 2, just rewritten to filter URLs).
- **Net:** +32 new tests. Full vitest suite: **1535/1535 passed** across 155 files (3 files / 66 tests skipped = pre-existing live-DB / CI-gated suites).

## User Setup Required

None. Plan 04 is pure frontend; no DB migrations, no new npm deps, no environment variables.

## Known Stubs

None. All three new surfaces render real data:
- HoldingNoteRow seeds `initialContent` from the `notesByHoldingScopeRef` prop when populated; falls back to empty (UI-SPEC §4b placeholder) when absent. When the prop is `{}` the icon still drives the expand/collapse + PATCH lifecycle correctly — the empty indicator reflects "no server-side prefetch in this release" and is a deferred optimisation, not a stub.
- BridgeOutcomeNoteSection lazy-fetches the real `user_notes` row on mount; 404 is a legitimate first-time state, not a stub.
- StrategyNoteCard receives server-side-prefetched content + timestamp on page load for authenticated viewers.

## Threat Flags

No new trust boundaries beyond those cataloged in the plan's `<threat_model>`. All four threat rows (T-08-16 through T-08-20) mitigations/acceptances hold as designed:
- T-08-16 (holding scope crafting): HoldingNoteRow only exposes scope_refs derived from rows the allocator already sees; Plan 01's per-scope ownership check rejects crafted scope_refs with generic 403.
- T-08-17 (strategy-page leak): server-side fetch is user-scoped via `createClient()` from `@/lib/supabase/server`; RLS on user_notes enforces owner-only SELECT; unauthenticated visitors skip the card entirely.
- T-08-18 (outcome expand/collapse race): BridgeOutcomeNoteSection's `cancelled` flag drops post-unmount state updates.
- T-08-19 (revoked-key holdings annotation): HoldingNoteRow does not gate on sync_status — revoked holdings remain annotatable per D-04 invariant.
- T-08-20 (cross-allocator strategy notes): RLS + user-gated render + per-user scope_kind resolution ensure allocators see only their own notes on a shared strategy page.

## Self-Check: PASSED

- [x] `src/components/notes/HoldingNoteRow.tsx` exists
- [x] `src/components/notes/HoldingNoteRow.test.tsx` exists
- [x] `src/components/notes/BridgeOutcomeNoteSection.tsx` exists
- [x] `src/components/notes/StrategyNoteCard.tsx` exists
- [x] `src/components/notes/StrategyNoteCard.test.tsx` exists
- [x] `src/app/strategy/[id]/page.test.tsx` exists
- [x] Commit `676efb0` present in `git log` (Task 1 RED)
- [x] Commit `98dd60d` present in `git log` (Task 1 GREEN)
- [x] Commit `e9586ff` present in `git log` (Task 2 RED)
- [x] Commit `24b61cc` present in `git log` (Task 2 GREEN)
- [x] Commit `cb40739` present in `git log` (Task 3 RED)
- [x] Commit `f72754a` present in `git log` (Task 3 GREEN)
- [x] 43/43 targeted Plan 04 tests green across 5 test files
- [x] Full 1535/1535 vitest suite green across 155 files
- [x] `npm run typecheck` clean
- [x] `npm run lint` 0 errors (18 pre-existing `_` unused-var warnings unchanged)
- [x] No `match_strategies` / `verified_strategies` references in page.tsx (Research Finding #3)
- [x] S2 no-unmount-flush contract honoured — all three new surfaces rely on blur

## TDD Gate Compliance

Plan 04 is `type: execute` (not `type: tdd`); task-level `tdd="true"` applied per task. Git log confirms strict RED → GREEN cadence for Tasks 1, 2, 3:

```
f72754a feat(08-04): strategy-scope StrategyNoteCard on /strategy/[id] (MANAGE-05)
cb40739 test(08-04): strategy-scope note card failing tests (RED)
24b61cc feat(08-04): bridge_outcome-scope note inside OutcomesWidget expanded panel (MANAGE-05)
e9586ff test(08-04): bridge_outcome-scope note section failing tests (RED)
98dd60d feat(08-04): holding-scope inline expandable note (MANAGE-05)
676efb0 test(08-04): holding-scope note-icon + sub-row failing tests (RED)
```

Task 4 is verification-only per the plan's explicit "no new commit required — sign off via SUMMARY".

---

*Phase: 08-connection-management-and-notes*
*Plan: 04*
*Completed: 2026-04-21*
