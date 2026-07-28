---
phase: 29
plan: 04
subsystem: allocator-composer-ui
tags: [unify-01, unify-02, unify-04, unify-05, entry-mode, lazy-returns, copy-relabel, scenario-composer]
requires:
  - "Plan 01 GET /api/strategies/[id]/returns (RLS-scoped, published-only, { daily_returns } envelope)"
  - "Plan 02 browse route emits is_example (additive; consumed transparently by the drawer)"
  - "Plan 03 is_example-aware drawer + SavedScenariosList 'portfolio' copy"
provides:
  - "Entry-mode segmented control ('From my book' / 'Blank slate') routed through the existing reset-confirmation discipline (no silent wipe)"
  - "Lazy-returns plumbing: an added catalog strategy fetches its daily_returns and moves the projection through the UNCHANGED adapter + frozen engine"
  - "Honest in-flight 'Loading returns…' affordance; added strategy contributes [] (warm-up-gated), never a fabricated series"
  - "'portfolio' copy across save/update/save-as-new/name-input/empty-state/reopen-notices; codec ok/readonly/reset trichotomy preserved byte-for-byte"
affects:
  - "Plan 05 (factsheet graphs, later) consumes the same projection output — no contract change here"
tech-stack:
  added: []
  patterns:
    - "Entry mode narrows holdingsSummary at ONE switch (blank → []); every downstream reference (hook, adapter, composition, fingerprint, empty-state) honors the mode with no per-site change"
    - "Dirty-draft mode switch parks pendingMode + opens the existing ResetConfirmationModal; applied only on confirm via handleReset (Pitfall 5)"
    - "addedStrategyReturnsLookup merges fromBook ?? addedReturnsById[id] ?? [] (payload wins) — the series flows through the frozen computeScenario, zero engine diff"
    - "Lazy fetch mirrors the btc-effect honest-degrade posture: non-ok / abort / throw → [] + log, AbortController-cancelled on unmount"
key-files:
  created: []
  modified:
    - "src/app/(dashboard)/allocations/components/ScenarioComposer.tsx"
    - "src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx"
    - "src/app/(dashboard)/allocations/components/ScenarioComposer.save.test.tsx"
decisions:
  - "Blank-slate is implemented as a single mode-narrowed holdingsSummary (entryMode === 'blank' ? [] : rawHoldingsSummary), NOT a new hook/draft concept — the useScenarioState hook always seeds from the holdings it is given, so feeding [] yields an empty working composition with zero hook/engine change."
  - "isEmptyState now gates on the RAW book (hasLiveBook), NOT the mode-narrowed holdingsSummary: a book allocator who toggles to 'blank' with nothing added must STILL reach the main body so the entry-mode control stays on-screen (otherwise blank mode would trap them in the empty-state card with no way back to 'From my book')."
  - "A clean draft (diffCount === 0) switches mode immediately (lossless); a dirty draft parks the target in pendingMode and routes through the existing ResetConfirmationModal — the confirm path (handleReset) is the ONLY mutator, so a mode switch can never silently wipe edits. Modal Cancel abandons the parked mode."
  - "Lazy returns fired from a single handleAddStrategy seam (empty-state drawer, main-body drawer) + an inline Bridge-add guard; the fetch is skipped when the id is already in the book (payload.strategies) — payload wins in the merge, so a book overlap is handled for free (Open Question #1)."
  - "Honest in-flight affordance is a role='status' aria-live='polite' banner naming the still-loading added strategies (Loading returns…) rather than a per-row prop threaded through CompositionList — smaller surface, no CompositionList interface change, still warm-up-gated [] (no fabricated series, Pitfall 4)."
  - "Copy relabel is UI-facing strings ONLY (per UI-SPEC §Copywriting verbatim table): the H2 'Scenario' (tab name), the fingerprint-mismatch banner, the ResetConfirmationModal title ('Discard your scenario draft?'), and the 'Add more strategies' body were left as-is — they are NOT in the verbatim relabel table, and the modal title is asserted by T_C12/T_C14 which must stay green."
  - "Codec trichotomy preserved byte-for-byte: scenarioDraftCodec(defaultDraft).decode(...) count unchanged (3→3 vs baseline), no bare JSON.parse(row.draft) as ScenarioDraft introduced (the only grep hit is the M-0153 warning comment), reset still does NOT hydrate."
metrics:
  duration: "~20 min"
  completed: "2026-06-23T10:11:09Z"
  tasks: 3
  files: 3
  tests_passing: 75
---

# Phase 29 Plan 04: Unified Composer — Entry Mode + Lazy Returns + Portfolio Copy Summary

Wired the three genuinely-new client behaviors into the existing `ScenarioComposer`: an entry-mode segmented control ("From my book" / "Blank slate") routed through the existing reset/confirm discipline (UNIFY-01/02), lazy-returns plumbing so an added catalog strategy's `daily_returns` actually move the projection through the UNCHANGED adapter + frozen engine (UNIFY-04), and the "portfolio" copy + reopen-notice relabel that preserves the LOCKED ok/readonly/reset codec trichotomy (UNIFY-05). Zero diff to `src/lib/scenario.ts`; no migration.

## What Was Built

### Task 1 — Entry-mode segmented control routed through the reset discipline (commit `a8d6393f`)
- Added a `role="radiogroup"` control at the composer title row (after the PROJECTED pill, before the save toolbar) with two `role="radio"` segments: "From my book" (default when a live book exists) and "Blank slate". Arrow-key navigation; `aria-checked`; visible accent focus ring. Active segment uses the **accent OUTLINE** (`border border-accent text-accent`, the drawer FilterPill recipe) — never an accent fill (accent = action/verified; a mode toggle is neither, 29-UI-SPEC §1).
- Entry mode narrows `holdingsSummary` at one switch (`entryMode === "blank" ? [] : rawHoldingsSummary`), so the hook, adapter, composition list, fingerprint, and empty-state all honor the mode with no per-site change. The frozen adapter/engine path is untouched.
- A no-book allocator defaults to Blank-slate-only — no dead "From my book" segment is rendered.
- `isEmptyState` now gates on the RAW book (`hasLiveBook`), so a book allocator in blank mode still reaches the main body (and can toggle back).
- A dirty-draft switch (`scenario.diffCount > 0`) parks `pendingMode` and opens the existing `ResetConfirmationModal`; the mode applies only on confirm via `handleReset`. A clean draft switches immediately. Modal Cancel abandons the parked mode.
- 4 new tests (T_C_MODE1–4) incl. the **non-vacuous** dirty-switch test: a dirty switch opens the modal AND does NOT flip `aria-checked` / wipe the draft until confirm. Verified non-vacuous by neutering the gate to a direct `setEntryMode` — the test fails (the modal never opens).

### Task 2 — Lazy-returns plumbing (TDD: RED `bac82cdb` → GREEN `35700c49`)
- **RED:** T_C_LAZY1 (add → GET `/api/strategies/<id>/returns`; the adapter's returns-lookup carries the non-empty series once resolved, `[]` before) + T_C_LAZY2 (rejected fetch → `[]`, no crash, no fabricated series). Both fail without the plumbing (the fetch never fires).
- **GREEN:** `addedReturnsById` state map + a per-id loading set + an `AbortController` registry. A single `handleAddStrategy` seam (empty-state drawer, main-body drawer) + an inline Bridge-add guard fires the lazy fetch when the id is not already in the book and not yet fetched. `addedStrategyReturnsLookup` merges `fromBook ?? addedReturnsById[id] ?? []` (payload wins). The series flows through the UNCHANGED `buildStrategyForBuilderSet` + `computeScenario` — no second annualization path, no `scenario.ts` edit.
- Honest in-flight affordance: a `role="status"` "Loading returns…" banner names the still-loading added strategies; the strategy contributes `[]` (warm-up-gated), never a fabricated flat/zero series (Pitfall 4). Non-ok / abort / throw all degrade to `[]` + a `console.warn` (btc-effect posture); in-flight fetches are aborted on unmount.
- Verified non-vacuous: neutering the merge to `[]` fails T_C_LAZY1 (the lazy series no longer reaches the lookup).

### Task 3 — "Portfolio" copy relabel + reopen-notice relabel (commit `59a83274`, lint `d4ea3340`)
- Relabeled per UI-SPEC §Copywriting verbatim: "Save/Update/Save as new scenario" → "…portfolio"; name-input placeholder + aria "Name this scenario" → "Name this portfolio"; empty-state heading "Scenario builder needs holdings" → "Start a portfolio" + the UI-SPEC blank-slate body; name validation + save-error copy → "portfolio"; reopen notices ("This saved portfolio uses an older format…" / "This portfolio was saved by a newer version…").
- **Codec trichotomy UNTOUCHED:** `scenarioDraftCodec(...).decode(...)` preserved (count 3→3), no bare cast, `reset` still does NOT hydrate.
- Tests in lockstep: save test relabeled across T_SAVE1–10; **T_SAVE6 strengthened** to a non-vacuous no-hydrate proof — a distinctive reset-draft `addedStrategy` (`RESET_MARKER_STRATEGY`) must NOT render after a reset-open (a wrong hydrate would surface it). The main test's two empty-state heading assertions (T_C1 + the empty→composer transition) updated to "Start a portfolio".
- The H2 "Scenario" (tab name), fingerprint-mismatch banner, `ResetConfirmationModal` title, and "Add more strategies" body were left as-is (not in the verbatim relabel table; the modal title is pinned by T_C12/T_C14).
- Lint follow-up: underscore-prefixed `_pendingMode` (value read only inside the `handleReset` functional updater) to clear a `no-unused-vars` warning my Task-1 change introduced.

## Verification

- `npx vitest run ScenarioComposer.test.tsx ScenarioComposer.save.test.tsx` → **75 passed**.
- Full allocations suite (`npx vitest run "src/app/(dashboard)/allocations/"`) → **89 files / 1086 tests passed** (no sibling regression, incl. the scenario-state-preservation + drawer suites).
- `git diff --exit-code src/lib/scenario.ts` → **clean** (frozen engine, SCENARIO-05).
- `git status --porcelain supabase/migrations/` → **empty** (no migration).
- `npx tsc --noEmit` → no ScenarioComposer errors. `npx eslint` on the three files → clean.
- Acceptance greps: `radiogroup` ≥1; "From my book|Blank slate" ≥2 (no `bg-accent` on the segments); `addedReturnsById` = 7 (≥3); lazy fetch URL = 4 (≥1); "Loading returns…" affordance = 3 (≥1); no `fill(0)`; "portfolio" copy = 7 (≥5); old empty-state heading = 0; codec count unchanged.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Empty-state heading assertions in ScenarioComposer.test.tsx (not just save.test.tsx)**
- **Found during:** Task 3.
- **Issue:** The plan listed `ScenarioComposer.save.test.tsx` for Task 3's test updates, but the empty-state heading relabel ("Scenario builder needs holdings" → "Start a portfolio") also broke two assertions in `ScenarioComposer.test.tsx` (T_C1 and the empty→composer transition test).
- **Fix:** Updated both assertions to "Start a portfolio" — a necessary lockstep change to keep the suite green; the same file was already in this plan's `files_modified`.
- **Commit:** `59a83274`.

**2. [Rule 1 - Lint] no-unused-vars warning on the new pendingMode state**
- **Found during:** post-Task-3 lint.
- **Issue:** `pendingMode`'s value is only read inside the `handleReset` functional updater (apply-on-confirm); the rendered control derives selection from `entryMode`, so the destructured value tripped `@typescript-eslint/no-unused-vars`.
- **Fix:** Renamed to `_pendingMode` (the array-destructure `/^_/` allowance); behavior unchanged.
- **Commit:** `d4ea3340`.

## Known Stubs

None. The lazy-returns in-flight `[]` is an honest warm-up-gated state with a visible "Loading returns…" affordance, not a stub — it resolves to the real series on fetch completion (or degrades to `[]` + a log on failure), and is covered by T_C_LAZY1/2.

## Self-Check: PASSED

- Modified files exist on disk: `ScenarioComposer.tsx`, `ScenarioComposer.test.tsx`, `ScenarioComposer.save.test.tsx` — all FOUND.
- SUMMARY.md exists: `.planning/phases/29-unified-composer-spine/29-04-SUMMARY.md` — FOUND.
- Commits exist: `a8d6393f` (Task 1), `bac82cdb` (Task 2 RED), `35700c49` (Task 2 GREEN), `59a83274` (Task 3), `d4ea3340` (lint) — all FOUND.
