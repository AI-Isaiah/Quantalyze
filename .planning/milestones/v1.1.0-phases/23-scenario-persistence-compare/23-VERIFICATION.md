---
phase: 23-scenario-persistence-compare
verified: 2026-06-22T00:00:00Z
status: human_needed
score: 4/4 must-haves verified
overrides_applied: 0
human_verification:
  - test: "Save a named scenario, close the tab, reopen the Scenario tab, and click Open on the saved row."
    expected: "The composer rehydrates to the saved state. If no holdings drifted the fingerprint-mismatch banner does NOT appear. If you swap an allocation before saving and then reload the live book, the banner appears on reopen."
    why_human: "Round-trip requires a real Supabase DB write + RLS enforcement via PostgREST; codec trichotomy paths (ok/readonly/reset) depend on runtime schema_version evaluation not greppable from static code."
  - test: "With the compare panel open showing 2+ scenarios including Live Book, inspect the rendered table for null metrics (a scenario with only 1 overlapping day will produce NaN Sharpe)."
    expected: "Each degenerate cell shows an em-dash (—), not 0 or blank. The winner highlight is absent from columns where all values are null. Per-column overlap-window stamps are independent."
    why_human: "Em-dash rendering, CSS winner-highlight, and stamp positioning require browser pixel-level inspection; vitest tests cover logic but not visual output."
  - test: "Rename a saved scenario to a name with leading/trailing spaces. Then try to rename it to an empty string or a name >120 chars."
    expected: "Rename trims whitespace and accepts the trimmed name. Empty or >120-char attempts are rejected inline (error shown, row stays editable)."
    why_human: "Inline edit UX with validation feedback requires real browser interaction; keyboard accessibility (Enter to confirm, Escape to cancel) cannot be verified by grep."
  - test: "After /land-and-deploy applies the migration, verify anon cannot read the scenarios table."
    expected: "curl with anon key returns 42501 (insufficient privilege). Authenticated request from tenant A cannot read tenant B rows by id."
    why_human: "Migration has not been pushed to prod; RLS behaviour requires live Supabase context. The test_scenarios_rls.sql SQL tests verify the logic but run against the test project only."
---

# Phase 23: Scenario Persistence & Compare Verification Report

**Phase Goal:** Allocators can durably save named scenarios, reopen them into the composer, manage the list, and compare 2+ scenarios (and the live book) side-by-side.
**Verified:** 2026-06-22T00:00:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Allocator saves a named scenario to DB (ScenarioDraft JSONB, never raw series), RLS-scoped to owner | VERIFIED | Migration creates `scenarios` table with RLS policy `FOR ALL TO authenticated USING/WITH CHECK (allocator_id = auth.uid())` + `REVOKE ALL FROM anon`. POST route sources `allocator_id` from `user.id` (auth), never from request body. Body schema (`SaveScenarioBodySchema`) has no `allocator_id` field. `scenarioDraftSchema` validates the persisted shape. Two-tenant RLS test (`test_scenarios_rls.sql`) asserts cross-tenant content by row id. |
| 2 | Reopen rehydrates into the composer, re-resolving series from live payload, fingerprint-mismatch banner on drift (never silent recompute) | VERIFIED | `hydrateFromSaved` calls `setValue(() => saved)` (not `removeStored`), so `fingerprintMismatch` auto-derives from `value.init_holdings_fingerprint !== fingerprint`. `openSavedScenario` decodes via `scenarioDraftCodec` trichotomy: reset → honest notice only (no hydrate); readonly → hydrate + blocked notice; ok → `hydrateFromSaved` + set `loadedScenarioId`. Tests T_SAVE6/T_SAVE7/T_SAVE8 cover all three paths. |
| 3 | Allocator lists, renames, and deletes own saved scenarios | VERIFIED | `SavedScenariosList` renders rows from GET `/api/allocator/scenario/saved`; inline rename → PATCH `saved/[id]` (RenameBodySchema, PGRST116 → 404); inline danger-confirm delete → DELETE `saved/[id]` (0 rows → 404). `AllocationsTabs` mounts the list and calls `refetchSaved` after mutations. Tests T_SL1–T_SL13 pass. |
| 4 | Compare 2+ scenarios (and live book) side-by-side: ranked by Sharpe/return, per-column overlap+N stamp, degenerate scenario shows em-dash not fabricated 0 | VERIFIED | `ScenarioCompareTable` maps null `getValue` result → `formatValue(null) → "—"` (em-dash); `findWinner` skips nulls; `Max Drawdown higherIsBetter: true` is correct (negative signed representation — less-severe wins). Per-column independent `methodologyLine(n)`. `ScenarioComparePanel` computes all selected scenarios + live book via `computeMetricsForDraft` / `buildLiveBookDraft`. Comment at line 40 of ComparePanel: "There is NO `?? 0` anywhere in this panel". No `?? 0` found in `scenario-compare.ts`. Tests T_CP1–T_CP7 and ScenarioCompareTable unit tests pass. |

**Score:** 4/4 truths verified

---

### Deferred Items

Items not yet met but logged as out-of-scope or future-phase work.

| # | Item | Addressed In | Evidence |
|---|------|-------------|----------|
| 1 | DI-23-01: `version_ahead` + `safeParse` failure silently substitutes live book as fabricated column | Phase 26/27/28 | Deferred-items.md: "UNREACHABLE until next SCENARIO_SCHEMA_VERSION bump. Correct fix: apply at the NEXT bump." Every save today goes through schema_version 2; routes validate shape before persist so the failure arm cannot be reached now. |

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `supabase/migrations/20260621120000_scenarios_table_and_rls.sql` | DB schema + RLS + REVOKE anon + index | VERIFIED | 80 lines. Creates `scenarios` table, enables RLS, owner policy, `REVOKE ALL ON scenarios FROM anon`, compound index. |
| `supabase/migrations/down/20260621120000-rollback.sql` | Rollback | VERIFIED | `DROP TABLE scenarios CASCADE` |
| `supabase/tests/test_scenarios_rls.sql` | Two-tenant RLS proof | VERIFIED | 268 lines. 5 assertions including cross-tenant CONTENT check by row id (CROSS-TENANT LEAK), anon 42501 path. Plain PL/pgSQL DO blocks, no pgTAP. |
| `src/lib/database.types.ts` (lines 1098–1151) | Hand-patched type | VERIFIED | HAND-PATCHED tripwire comment present. `scenarios.Row` typed with `draft: Json`, `schema_version: number`. Relationships to `profiles` present. |
| `src/app/api/allocator/scenario/saved/route.ts` | POST + GET + byte cap | VERIFIED | `MAX_DRAFT_BODY_BYTES = 256_000` exported. POST: byte cap (413) → safeParse (400) → B15 rate-limit → insert with `allocator_id: user.id`. GET: select + order. `NO_STORE_HEADERS` on every response. |
| `src/app/api/allocator/scenario/saved/[id]/route.ts` | PATCH + PUT + DELETE | VERIFIED | Async params (`ctx.params: Promise<{id: string}>`). `isUuid` guard → 400. PATCH: rename + PGRST116 → 404. PUT: full update with `updated_at`. DELETE: delete + 0-length check → 404. `MAX_DRAFT_BODY_BYTES` imported from parent. |
| `src/app/(dashboard)/allocations/hooks/useScenarioState.ts` | `hydrateFromSaved` seam | VERIFIED | Exported from `UseScenarioStateReturn`. Implementation: `setValue(() => saved); setMismatchDismissed(false)`. Does NOT call `removeStored` — localStorage key preserved, fingerprint-mismatch auto-derives. |
| `src/app/(dashboard)/allocations/lib/scenario-compare.ts` | `computeMetricsForDraft` + `buildLiveBookDraft` | VERIFIED | Both exported. Full engine chain (adapter→projectionState→deAlias→buildDateMapCache→computeScenario). `buildLiveBookDraft` synthetic all-on equity-weight. Comment "NO `?? 0`". No `?? 0` pattern found in file. |
| `src/app/(dashboard)/allocations/components/ScenarioCompareTable.tsx` | Em-dash, winner, per-column stamps | VERIFIED | 285 lines. `formatValue(null) → "—"`. `findWinner` skips nulls. `Max Drawdown higherIsBetter: true` with inline comment. Per-column independent `methodologyLine(n)`. `data-testid="sharpe-leader"` present. |
| `src/app/(dashboard)/allocations/components/ScenarioComparePanel.tsx` | Multi-scenario + live book compute | VERIFIED | 253 lines. Lines 211, 228-230: `computeMetricsForDraft` for saved + live book. Comment "There is NO `?? 0` anywhere in this panel". Under-selection hint present. |
| `src/app/(dashboard)/allocations/components/SavedScenariosList.tsx` | List + rename + delete + selection | VERIFIED | 425 lines. PATCH/DELETE calls to API. `EmptyStateCard` present. Inline rename + danger confirm. Selection checkboxes. Live book pseudo-row. Compare CTA disabled <2. |
| `src/app/(dashboard)/allocations/AllocationsTabs.tsx` | Mount + wiring | VERIFIED | Imports `SavedScenariosList`, `ScenarioComparePanel`. `ScenarioTabContent` holds `savedRows`, `listLoadError`, `compareSelection`. `refetchSaved` on mount + after mutations. Honest `listLoadError` (does NOT fabricate empty card on fetch failure). |
| `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx` | Save/Update toolbar + codec trichotomy | VERIFIED | `loadedScenarioId` state. Toolbar: null → "Save scenario"; set → "Update scenario" + "Save as new scenario". `openSavedScenario`: reset → honest notice, readonly → hydrate + readonly block, ok → `hydrateFromSaved`. |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `AllocationsTabs` | `SavedScenariosList` | import + JSX render | WIRED | Line 14 import, rendered inside `ScenarioTabContent` |
| `AllocationsTabs` | `ScenarioComparePanel` | import + conditional render | WIRED | Line 20 import, conditional on compareSelection ≥ 2 |
| `ScenarioComposer` | `useScenarioState.hydrateFromSaved` | `scenario.hydrateFromSaved(decoded.value)` | WIRED | Called in both `readonly` and `ok` codec paths |
| `ScenarioComparePanel` | `computeMetricsForDraft` | import + call per row | WIRED | Lines 211, 228-230 |
| `ScenarioComparePanel` | `buildLiveBookDraft` | import + call | WIRED | Line 228-230 |
| `ScenarioComparePanel` | `ScenarioCompareTable` | import + JSX render | WIRED | Rendered with `columns` prop derived from compute |
| `SavedScenariosList` | `PATCH /api/allocator/scenario/saved/[id]` | fetch call | WIRED | Rename inline handler |
| `SavedScenariosList` | `DELETE /api/allocator/scenario/saved/[id]` | fetch call | WIRED | Delete confirm handler |
| `AllocationsTabs.refetchSaved` | `GET /api/allocator/scenario/saved` | fetch call | WIRED | On mount + after mutations |
| `POST route` | `scenarioDraftSchema` | import from scenario-state | WIRED | `SaveScenarioBodySchema.draft` field |
| `[id] route` | `MAX_DRAFT_BODY_BYTES` | import from `../route` | WIRED | Imported constant used in PUT byte-cap check |
| RLS policy | `allocator_id = auth.uid()` | Supabase PostgREST | WIRED | Migration line 60–64, with `TO authenticated` scoping |

---

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|-------------------|--------|
| `SavedScenariosList` | `savedRows` | `AllocationsTabs.refetchSaved` → GET `/api/allocator/scenario/saved` → `supabase.from("scenarios").select(...)` | Yes — Supabase DB query, RLS-scoped | FLOWING |
| `ScenarioCompareTable` | `columns[].metrics` | `ScenarioComparePanel` → `computeMetricsForDraft` → full engine chain | Yes — derives from live allocator inputs (weights, series, dates) | FLOWING |
| `ScenarioComposer` (reopened) | `scenario.value` | `hydrateFromSaved(decoded.value)` → `setValue` hook | Yes — decoded from DB row's `draft` JSONB, validated by codec | FLOWING |

---

### Behavioral Spot-Checks

All vitest tests run on branch `feat/v1.1.0-scenario-persistence`:

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Route tests (T-23-01 through T-23-10) | `npm test -- scenario` | 95 tests, 8 suites — all passing | PASS |
| Codec trichotomy (T_SAVE6/T_SAVE7/T_SAVE8) | Covered above | Tests pass | PASS |
| List/rename/delete (T_SL1–T_SL13) | Covered above | Tests pass | PASS |
| Compare metrics + em-dash (T_CP1–T_CP7) | Covered above | Tests pass | PASS |
| ScenarioCompareTable unit tests | Covered above | Tests pass | PASS |
| No `?? 0` fabrication | `grep -n "?? 0" scenario-compare.ts ScenarioComparePanel.tsx` | 0 matches | PASS |
| No debt markers (TBD/FIXME/XXX) | `grep -rn "TBD\|FIXME\|XXX"` phase files | 0 matches in phase-modified files | PASS |

---

### Probe Execution

No probes declared in phase plans. Step 7c: SKIPPED (no probe-*.sh scripts declared or conventional for this phase).

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| PERSIST-01 | 23-01, 23-02 | Save ScenarioDraft to DB (JSONB), RLS-scoped | SATISFIED | Migration + POST route + RLS test |
| PERSIST-02 | 23-04 | Reopen/rehydrate from saved, drift banner, codec trichotomy | SATISFIED | `hydrateFromSaved` seam + `openSavedScenario` + tests T_SAVE6–T_SAVE8 |
| PERSIST-03 | 23-02, 23-05 | List, rename, delete own scenarios | SATISFIED | `SavedScenariosList` + PATCH/DELETE routes + tests T_SL1–T_SL13 |
| PERSIST-04 | 23-03, 23-05 | Compare 2+ scenarios side-by-side, honest em-dash, per-column stamps | SATISFIED | `ScenarioCompareTable` + `ScenarioComparePanel` + tests T_CP1–T_CP7 |

---

### Anti-Patterns Found

No debt markers (TBD/FIXME/XXX) found in phase-modified files. No unreferenced stubs detected. One pre-existing ESLint warning (unused import `trackUsageEventClient` in `AllocationsTabs.tsx`, logged as deferred-items.md entry, present on HEAD before Plan 23-05) — out of scope per phase boundary, not a blocker.

DI-23-01 (`version_ahead` + `safeParse` failure substituting live book) is unreachable today and logged with a fix plan in `deferred-items.md`.

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| None | — | — | — | — |

---

### Human Verification Required

#### 1. Save/reopen round-trip against real DB (codec trichotomy + drift banner)

**Test:** Log in as an allocator. Save a named scenario. Optionally swap one holding. Reload the page. On the Scenarios tab, click Open on the saved row.
**Expected:** Composer rehydrates to the saved state. If holdings drifted since save, the fingerprint-mismatch banner appears. If no drift, the banner does not appear. "Update scenario" / "Save as new scenario" toolbar appears instead of "Save scenario".
**Why human:** Round-trip requires a real Supabase DB write + RLS enforcement via PostgREST. Codec trichotomy (ok/readonly/reset) depends on runtime schema_version evaluation. The fingerprint-mismatch banner display requires live DOM rendering.

#### 2. Compare table visual rendering (em-dash, winner highlight, per-column stamps)

**Test:** Select 2+ scenarios plus Live Book in the compare panel. Ensure at least one scenario has insufficient overlap days to produce a Sharpe (degenerate column). Inspect the rendered table.
**Expected:** Degenerate metric cells show "—" (em-dash), not 0, blank, or "?". The winner column highlight is absent for rows where all values are null. Each column shows its own overlap-window + N stamp independently (heterogeneous windows render correctly, not a single shared window).
**Why human:** Em-dash rendering, CSS winner highlight class application, and per-column stamp layout require browser pixel-level inspection. Vitest tests cover the logic but not visual output.

#### 3. Rename/delete UX + keyboard accessibility

**Test:** In the SavedScenariosList, rename a scenario to a name with leading spaces. Try to rename to empty string. Try to rename to a 121-character name. Delete a scenario by confirming the danger prompt.
**Expected:** Rename trims whitespace and accepts the trimmed name. Empty or >120-char names are rejected inline (error message shown, row stays editable). Delete confirm works. Keyboard: Enter confirms rename, Escape cancels.
**Why human:** Inline edit UX with validation feedback and keyboard behaviour (Enter/Escape handling) cannot be verified by static grep.

#### 4. Post-/land-and-deploy RLS enforcement in prod

**Test:** After the migration is applied at /land-and-deploy: (a) attempt a `curl` with the anon Supabase key against `GET /rest/v1/scenarios`; (b) log in as tenant A and verify you cannot read tenant B's scenario id via the REST API.
**Expected:** (a) anon returns HTTP 403 / PostgREST `42501` (permission denied). (b) tenant A gets 0 rows when querying tenant B's row id.
**Why human:** The migration has not been pushed to prod. The `test_scenarios_rls.sql` SQL tests verify the intent against the test project, but prod-live RLS enforcement requires a post-deploy manual check.

---

### Gaps Summary

No gaps. All 4 success criteria are technically VERIFIED via codebase inspection and passing test suites. The `human_needed` status reflects 4 items that require browser or prod-DB interaction to confirm — these are standard post-deploy UAT checks, not code deficiencies.

---

_Verified: 2026-06-22T00:00:00Z_
_Verifier: Claude (gsd-verifier)_
