---
phase: 23-scenario-persistence-compare
plan: 04
subsystem: allocations-scenario-persistence
tags: [scenario, persistence, reopen, codec, honesty, persist-02, tdd]
requires:
  - "scenarioDraftCodec trichotomy (scenario-state.ts:521 — ok/readonly/reset)"
  - "useCrossTabStorage setValue/removeStored primitive (cross-tab.ts)"
  - "fingerprint-mismatch banner derivation (useScenarioState storedMismatch)"
  - "POST /api/allocator/scenario/saved + PUT /[id] (Plan 23-02)"
  - "Button primitive variants primary/secondary/ghost (Button.tsx)"
provides:
  - "useScenarioState.hydrateFromSaved(draft) — one-shot reopen seam routed through setValue (not removeStored)"
  - "ScenarioComposer Save/Update/Save-as-new toolbar + loadedScenarioId tracking"
  - "ScenarioComposer codec-trichotomy Open(savedRow) via the onRegisterOpen seam"
  - "SavedScenarioRow type ({ id, name, draft: unknown })"
affects:
  - "Plan 23-05 / SavedScenariosList — calls onRegisterOpen's Open handler to reopen a row"
tech-stack:
  added: []
  patterns:
    - "Imperative reopen seam routed through the hook's own setValue so derived state (fingerprint banner) updates with no special-case branch"
    - "Codec trichotomy applied at the caller layer before hydrating (ok/readonly/reset); reset = honest notice, never a silent empty composer"
    - "onRegisterOpen callback-registration seam so a sibling component can drive an imperative Open"
key-files:
  created:
    - "src/app/(dashboard)/allocations/hooks/useScenarioState.hydrate.test.tsx"
    - "src/app/(dashboard)/allocations/components/ScenarioComposer.save.test.tsx"
  modified:
    - "src/app/(dashboard)/allocations/hooks/useScenarioState.ts"
    - "src/app/(dashboard)/allocations/components/ScenarioComposer.tsx"
decisions:
  - "hydrateFromSaved routes through setValue (the mutator path), NOT removeStored — the localStorage key is never destructively wiped on reopen (Pitfall 6), and the fingerprint-mismatch banner derives automatically with no loadedFromDb bypass (Pitfall 2)."
  - "Open decodes row.draft through scenarioDraftCodec(defaultDraft).decode(JSON.stringify(row.draft)) (M-0153 — never a bare cast). reset → honest 'older format' notice + NO hydrate; readonly → hydrate user data + block Update + read-only notice; ok → hydrate + adopt id."
  - "loadedScenarioId/Name/readonly live in composer useState (not the hook). handleReset wraps scenario.reset() and clears all three; every reset path (banner, ResetConfirmationModal, commit success) routes through it so the loaded-id can never go stale."
  - "Open is driven via an onRegisterOpen(open) prop — the composer hands the parent its imperative Open handler (the saved-scenarios list wires it in a later plan). Both 'Save scenario' and 'Save as new scenario' POST a new row, so no mode flag is needed."
metrics:
  duration: "~30 min"
  completed: 2026-06-21
  tasks: 2
  files: 4
---

# Phase 23 Plan 04: Reopen Seam + Save/Update Toolbar Summary

The reopen spine for PERSIST-02: a one-shot `hydrateFromSaved(draft)` on `useScenarioState` routed through the hook's OWN `setValue` (so the existing fingerprint-mismatch banner derives automatically, with no special-case branch), plus the composer's Save / Update / Save-as-new toolbar tracking `loadedScenarioId` and a codec-trichotomy `Open(savedRow)` that hydrates an `ok`/`readonly` draft or shows an honest notice on a `reset` (older-format) draft — never a silent empty composer.

## What Was Built

### Task 1 — `hydrateFromSaved` one-shot seam (`useScenarioState.ts`)

`hydrateFromSaved: (draft: ScenarioDraft) => void` added to `UseScenarioStateReturn` and the return object. Implemented via the RESEARCH Q2 seam:

```ts
const hydrateFromSaved = useCallback((saved: ScenarioDraft) => {
  setValue(() => saved);          // mutator path — NOT removeStored
  setMismatchDismissed(false);    // a fresh open gets a fresh banner
}, [setValue]);
```

Load-bearing properties (all test-pinned in `useScenarioState.hydrate.test.tsx`):
- **Banner derives automatically.** The saved draft carries its own `init_holdings_fingerprint`; writing it into `value` makes `storedMismatch = value.init_holdings_fingerprint !== fingerprint` fire for a drifted draft with **no `loadedFromDb` special-case** (Pitfall 2). A matching-fingerprint draft adopts with no banner; a mismatched one fires `fingerprintMismatch`.
- **No destructive wipe.** Routes through `setValue` (the same path the mutators use), NOT `removeStored` (which `reset()` uses). The allocator-scoped localStorage key is **not** `removeItem`-ed on reopen (Pitfall 6) — proven by asserting zero `removeItem` calls on the scoped key and the key remaining present.
- **Fresh banner.** `setMismatchDismissed(false)` so a freshly-opened drifted scenario re-shows the banner even after a prior dismissal.

### Task 2 — Save/Update toolbar + `loadedScenarioId` + codec Open (`ScenarioComposer.tsx`)

Added the Save/Update control set INTO the existing `flex flex-wrap items-center gap-3` header row (UI-SPEC §Component Inventory 1) using `Button` variants, plus `loadedScenarioId`/`loadedScenarioName`/`loadedReadonly` composer state, an inline name input (NO modal), and the `Open(savedRow)` codec-trichotomy handler exposed via `onRegisterOpen`.

Behavior (all test-pinned in `ScenarioComposer.save.test.tsx`):
- **Toolbar split on `loadedScenarioId`.** No scenario open → a single primary "Save scenario" → click reveals the inline "Name this scenario" input + "Save"/"Cancel" (no `role="dialog"`). A saved scenario open → primary "Update scenario" (PUT that row) + secondary "Save as new scenario" (POST a new row). A `readonly` open omits the editable Update and offers only the fork.
- **Inline name validation (exact UI-SPEC copy).** Empty/whitespace → "Enter a name to save this scenario."; >120 chars → "Scenario names are limited to 120 characters." — neither fires a POST.
- **Save → POST, Update → PUT, Save-as-new → POST.** POST `/api/allocator/scenario/saved` with `{name, draft: scenario.draft}` → on success adopt `data.id` as `loadedScenarioId` (toolbar flips to Update). PUT `/api/allocator/scenario/saved/{id}` with `{name, draft}`.
- **Codec-trichotomy Open** decodes `row.draft` through `scenarioDraftCodec(defaultDraftFromHoldings(holdingsSummary)).decode(JSON.stringify(row.draft))` — never a bare cast (M-0153):
  - `ok` → `hydrateFromSaved(decoded.value)` + adopt id (editable);
  - `readonly` (newer `schema_version`) → hydrate the user's real data + adopt id + render "This scenario was saved by a newer version and is read-only here." + block the Update gesture;
  - `reset` (older incompatible / corrupt) → render "This saved scenario uses an older format and can't be reopened." and do **NOT** hydrate (the id stays null → still "Save scenario", never a silent empty composer that adopts the id).
- **Drifted reopen reuses the existing banner verbatim.** An `ok` draft whose fingerprint drifted from current holdings surfaces the existing `#scenario-fingerprint-mismatch-banner` (not re-styled).
- **Hard failure → canonical copy.** A non-`ok` save response routes "Couldn't save this scenario. Check your connection and try again."; `loadedScenarioId` is NOT adopted.
- **`handleReset` wraps `scenario.reset()`** and clears `loadedScenarioId`/`Name`/`readonly`/notice — wired into all three reset paths (fingerprint-banner Reset, `ResetConfirmationModal` confirm, commit `onSubmitSuccess`).

Only UI-SPEC tokens/copy used; no new icons; the PROJECTED badge + fingerprint banner are reused verbatim (not re-styled). No per-holding leverage UI reintroduced.

## Deviations from Plan

None — plan executed as written. Both tasks followed RED → GREEN with no auto-fixes needed; no Rule 1–4 deviations, no auth gates.

One faithful-DOM test-design choice (not a deviation from intent): the Open path is exercised through the `onRegisterOpen` prop (the registration seam the plan's interface notes call for) rather than an in-component button, because the saved-scenarios list that triggers Open is a later plan. The composer hands its imperative `Open` handler to the parent the same way the future list will consume it.

## TDD Gate Compliance

Both tasks followed RED → GREEN with explicit commits; RED failed for the right reason (missing symbol), no false-green:
- Task 1: `b68937d7` (test, RED — `hydrateFromSaved is not a function`) → `8c8e0a2a` (feat, GREEN).
- Task 2: `8cd53e37` (test, RED — no "Save scenario" button / missing `onRegisterOpen`) → `9da4ab16` (feat, GREEN).

No REFACTOR commits needed — both implementations are minimal seams over existing primitives.

## Verification

- `npx vitest run useScenarioState.hydrate.test.tsx ScenarioComposer.save.test.tsx ScenarioComposer.test.tsx useScenarioState.test.tsx` → **96 passed (4 files)** (4 hydrate + 9 save + 58 composer-regression + 25 hook-regression).
- AllocationsTabs mount tests (real composer): **61 passed (3 files)** — no regression from the new props/state.
- `npx tsc --noEmit` → exit 0 (full project).
- `npx eslint` over all four touched files → 0 problems.
- The reopen `reset` path renders the honest notice and never silently empties the composer (T_SAVE6, with an explicit "Update scenario absent / Save scenario present" assertion so a silent-empty default FAILS).

## Known Stubs

None. Both seams are fully wired: `hydrateFromSaved` routes real saved data through the live `setValue` path; the toolbar POSTs/PUTs to the live Plan-02 routes; Open decodes through the live codec. The one `placeholder="Name this scenario"` is the locked UI-SPEC input placeholder, not a data stub.

## Self-Check: PASSED
