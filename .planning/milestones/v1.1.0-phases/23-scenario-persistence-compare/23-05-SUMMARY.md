---
phase: 23-scenario-persistence-compare
plan: 05
subsystem: allocations-scenario-persistence-compare
tags: [scenario, persistence, compare, list, rename, delete, honesty, persist-03, persist-04, tdd, integration]
requires:
  - "GET/POST /api/allocator/scenario/saved + PATCH/PUT/DELETE /[id] (Plan 23-02)"
  - "computeMetricsForDraft + buildLiveBookDraft + ScenarioCompareTable (Plan 23-03)"
  - "ScenarioComposer onRegisterOpen codec-trichotomy Open + loadedScenarioId (Plan 23-04)"
  - "EmptyStateCard + Button primitives (UI-SPEC)"
  - "scenarioDraftCodec + defaultDraftFromHoldings (scenario-state.ts)"
provides:
  - "SavedScenariosList — list rows (Open/Rename/Delete + selection checkbox), EmptyStateCard, Compare-selected CTA, Live book pseudo-row"
  - "ScenarioComparePanel — derives ScenarioCompareInputs from the live payload, computes each selection + live book via one engine path, mounts ScenarioCompareTable"
  - "ScenarioTabContent (in AllocationsTabs) — the wired Scenario-tab surface (composer + list + compare panel) on the V2 path"
  - "ScenarioComposer onScenarioSaved seam — fires after a Save/Update so the host list refetches"
  - "GET /api/allocator/scenario/saved now returns draft (Open/Compare need no second round-trip)"
affects:
  - "Phase 24 (Benchmark) + Phase 25 (Sharing) read the saved-scenarios spine this plan surfaces"
tech-stack:
  added: []
  patterns:
    - "Integration sub-component (ScenarioTabContent) holds tab-scoped state so its hooks stay unconditional behind the V2/ScenarioStub gate"
    - "Imperative Open seam consumed: list Open -> composer's registered codec-trichotomy handler"
    - "Per-column compute off the React render path: decode draft (codec) -> computeMetricsForDraft; reset/degenerate -> null metrics (em-dash), never 0"
    - "fetch-on-mount effect with a scoped set-state-in-effect disable (async setState post-await), matching BridgeDrawer/StrategyBrowseDrawer convention"
key-files:
  created:
    - "src/app/(dashboard)/allocations/components/SavedScenariosList.tsx"
    - "src/app/(dashboard)/allocations/components/SavedScenariosList.test.tsx"
    - "src/app/(dashboard)/allocations/components/ScenarioComparePanel.tsx"
    - "src/app/(dashboard)/allocations/components/ScenarioComparePanel.test.tsx"
  modified:
    - "src/app/(dashboard)/allocations/AllocationsTabs.tsx"
    - "src/app/(dashboard)/allocations/AllocationsTabs.scenario-composer.test.tsx"
    - "src/app/(dashboard)/allocations/components/ScenarioComposer.tsx"
    - "src/app/api/allocator/scenario/saved/route.ts"
decisions:
  - "ScenarioTabContent is a dedicated sub-component (not inline in the activeTab===scenario branch) so its hooks (list fetch state, compare selection, composer Open ref) are unconditional — the V2/ScenarioStub gate lives one level up. The ScenarioStub rollback path renders neither the list nor the compare panel (V2-only surfaces)."
  - "The list GET (Plan 02) shipped metadata-only; added `draft` to the GET select (Rule 3, the Plan 05 interfaces-note default) so Open + Compare have the draft without a per-row round-trip. The T_S11 select-substring assertion stays green (draft appended at the end)."
  - "Added an optional onScenarioSaved() seam to ScenarioComposer (Rule 2 — the integration requires the list to refetch after a Save/Update the composer owns). Fired on POST success + PUT success. ScenarioComposer.tsx is touched only for this 12-line additive seam; no existing behavior changed (109 composer/mount regression tests green)."
  - "ScenarioComparePanel decodes each row's draft through the codec trichotomy (M-0153, never a bare cast): ok/readonly -> computeMetricsForDraft; reset (older incompatible format) -> a NULL-metrics column (em-dash), never a fabricated 0. No `?? 0` anywhere in the panel."
  - "List rows do NOT stamp N/overlap (only name + timestamp) — N is a per-COLUMN stamp in the compare table where the engine runs, honoring the tested honesty invariant."
metrics:
  duration_minutes: 38
  tasks_completed: 3
  files_created: 4
  files_modified: 4
  tests_added: 21
  completed_date: 2026-06-21
---

# Phase 23 Plan 05: Scenario Persistence & Compare — Integration Summary

The integration plan for PERSIST-03 + PERSIST-04: the prior waves become a working surface on the allocations **Scenario tab**. `SavedScenariosList` lists the allocator's saved scenarios (Open / inline-Rename → PATCH / inline-danger-Delete → DELETE + selection checkboxes + a "Live book" pseudo-row + a Compare-selected CTA, with an honest EmptyStateCard when none exist); `ScenarioComparePanel` derives the live inputs from the SSR-lifted payload, computes each selection + the live book through the SAME `computeMetricsForDraft` engine path, and mounts `ScenarioCompareTable`; and `AllocationsTabs` wires both adjacent to `ScenarioComposer` on the V2 path — Open delegating to the composer's codec-trichotomy handler, Compare mounting the in-tab panel, the list refetching after every Save/Update/rename/delete. No new authenticated route.

## What Was Built

### Task 1 — `SavedScenariosList` (PERSIST-03)

One row per saved scenario mirroring the composer's list-row shell: a name-labeled, keyboard-focusable selection checkbox + the name (14px) + a saved/updated timestamp (12px `text-text-muted`); right-side `Open` (ghost) · `Rename` (inline edit → PATCH the trimmed name) · `Delete` (small inline `Delete "{name}"?` danger confirm → DELETE, **not a modal**). A "Live book" pseudo-row participates in selection. The Compare-selected CTA (`secondary`) is disabled until ≥2 selections (incl. the live book) and raises `{ rows, includeLiveBook }` to the parent. Empty list → `EmptyStateCard` heading "No saved scenarios yet" matching the UI-SPEC body (the #509 heading-matches-body lesson). Rename validates trim + 1..120 inline ("Enter a name to save this scenario." / "Scenario names are limited to 120 characters.") and does not PATCH on a bad length. Only UI-SPEC tokens/copy; no new icons. 11 tests.

### Task 2 — `ScenarioComparePanel` (PERSIST-04)

Given the selected rows (each with its draft) + an `includeLiveBook` flag + the live payload, it derives a `ScenarioCompareInputs` from the payload using the SAME derivation the composer does (`strategyById` lookups → `addedStrategy{Returns,Metadata}Lookup`, `symbolByHoldingId` via `buildHoldingRef`) — **no second fetch**. Each selection's draft is decoded through the codec trichotomy (never a bare cast): `ok`/`readonly` → `computeMetricsForDraft`; `reset` (older incompatible format) → a NULL-metrics column (em-dash, honest absence), **never a fabricated 0**. The live-book column is computed via the synthetic all-on `buildLiveBookDraft` through the same engine path so all six metrics populate honestly. Under-selection (<2 columns) routes to `ScenarioCompareTable`'s honest hint; degenerate columns reach the table as null metrics. There is **no `?? 0`** anywhere in the panel. 6 tests.

### Task 3 — Mount on the Scenario tab (`AllocationsTabs`)

A new `ScenarioTabContent` sub-component (rendered only on the V2 path) holds the integration state: the saved-row list (fetched via `GET /api/allocator/scenario/saved` on mount, refetched after Save/Update/rename/delete), the compare selection, and the composer's imperative Open handler (captured via `onRegisterOpen`, held in a ref). It renders `ScenarioComposer` + `SavedScenariosList` + (when a ≥2 selection is active) `ScenarioComparePanel` with a `space-y-6` gap, all handed the SAME `props` payload + `props.allocator_id`. `onOpen` → the composer's codec-trichotomy Open handler (Plan 04); `onCompare` → mounts the compare panel; a new `onScenarioSaved` composer seam refetches the list after a Save/Update. The `ScenarioStub` rollback path is untouched (neither surface mounts there). The existing scenario-tab test was extended (T_AT5a–d). 4 tests added; `npm run typecheck` clean.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — blocking] GET list select did not return `draft`**
- **Found during:** Task 3.
- **Issue:** Plan 02 shipped the list `GET` with a metadata-only select (`id, name, schema_version, created_at, updated_at`). Open + Compare both need the row's `draft`; without it the list could neither hydrate the composer nor compute a compare column, and the plan forbids a new authenticated route.
- **Fix:** Appended `draft` to the GET select — the planner's discretion default named in the Plan 05 `<interfaces>` note ("include draft in the list payload so Open + Compare have it without a second round-trip"). RLS already scopes rows to the caller; `NO_STORE_HEADERS` unchanged. The T_S11 select-substring assertion stays green (draft appended at the end).
- **Files modified:** `src/app/api/allocator/scenario/saved/route.ts`.
- **Commit:** `9be0084f`

**2. [Rule 2 — missing critical functionality] `onScenarioSaved` composer seam**
- **Found during:** Task 3.
- **Issue:** "The list refetches after a Save/Update/rename/delete so it stays consistent" is a plan success criterion, but Save/Update happen inside `ScenarioComposer` and it exposed no post-save callback — so after a Save the new row would not appear in the list until a full page reload.
- **Fix:** Added an optional `onScenarioSaved?: () => void` prop fired on POST success (after adopting the returned id) and PUT success. Additive only (12 lines); no existing behavior changed. `ScenarioTabContent` wires it to the list refetch. 109 composer/mount regression tests stay green.
- **Files modified:** `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx`.
- **Commit:** `9be0084f`

### Out-of-scope (deferred, NOT fixed)

- `AllocationsTabs.tsx:33` carries a pre-existing unused-import eslint **warning** (`trackUsageEventClient`) that was present on HEAD before this plan; left untouched per the SCOPE BOUNDARY rule (logged to `deferred-items.md`).
- A foreign WIP git stash (`stash@{0}`, "FOREIGN-WIP-on-main-not-mine") is present and not owned by this plan; left untouched per the destructive-git-prohibition.

## TDD Gate Compliance

Tasks 1 and 2 (`tdd="true"`) followed RED → GREEN with the test written first and run to failure (module-not-found) before the component existed; Task 3 (`type="auto"`) extended the existing scenario-tab test alongside the wiring. Per-task commits:

- Task 1: `1024bc75` — RED (SavedScenariosList module missing) → GREEN, 11 tests.
- Task 2: `dbb7c12b` — RED (ScenarioComparePanel module missing) → GREEN, 6 tests.
- Task 3: `9be0084f` — AllocationsTabs wiring + ScenarioComposer seam + GET draft; T_AT5a–d added, 4 tests.

(RED and GREEN landed in one per-task commit each on `feat/v1.1.0-scenario-persistence`; both RED runs are captured in this summary as failing on the missing module, the right reason — no false-green.)

## Verification

- Plan verify command — `npx vitest run SavedScenariosList ScenarioComparePanel ScenarioCompareTable AllocationsTabs.scenario-composer` → **green**.
- Full scenario sweep (9 suites: the 4 above + AllocationsTabs.test + ScenarioComposer.test + ScenarioComposer.save.test + saved/route.test + saved/[id]/route.test) → **181 passed**.
- Whole allocations directory → **962 passed (79 files)** — no regression.
- `npm run typecheck` (`tsc --noEmit`) → exit 0 (full project).
- `npx eslint` over all 8 touched files → 0 errors (1 pre-existing unrelated warning, deferred).
- Coverage gate: `SavedScenariosList` (11 tests) + `ScenarioComparePanel` (6 tests) both carry their own tests; the AllocationsTabs mount test was extended — no coverage regression.
- Honesty: the panel carries **no `?? 0`** (grep-confirmed); a degenerate/older-format column reaches the table as null metrics → em-dash; list rows stamp only name + timestamp (N is per-column in the table).

## Known Stubs

None. The list is wired to the live Plan-02 CRUD routes (GET/PATCH/DELETE), the compare panel computes through the live frozen engine path over the real SSR-lifted payload, and Open decodes through the live codec. The one `placeholder` string is the UI-SPEC name-input placeholder, not a data stub.

## Self-Check: PASSED
