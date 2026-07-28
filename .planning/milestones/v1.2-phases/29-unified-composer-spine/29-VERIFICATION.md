---
phase: 29-unified-composer-spine
verified: 2026-06-23T13:00:00Z
status: passed
score: 5/5 must-haves verified
overrides_applied: 0
human_verification_resolved: "2026-06-23 — all 3 items confirmed live via headed-browser /qa (Playwright, real prod data, qa-demo@quantalyze.app). (1) Entry-mode segmented control renders ('Blank slate' active, accent-outline not filled; 'From my book' correctly absent for a no-book account). (2) 'Example' pill on 15 example rows, computed neutral-outline #64748B border+text / transparent bg / 10px uppercase — NOT accent #1b6b5a; pseudonymous codenames un-tagged. (3) Dirty draft → reset-confirmation modal 'Discard your scenario draft?' → Cancel preserves AV-IC2 + '2 changes' (no silent wipe). Bonus: 'Portfolio' H2 (W2 fix) live; UNIFY-04 lazy-fetch→940-day projection live; 0 console errors."
human_verification:
  - test: "Open /allocations as an authenticated allocator. Verify the ScenarioComposer entry-mode segmented control renders two visually distinct, mutually-exclusive pill buttons labeled exactly 'From my book' and 'Blank slate'. The active pill must be clearly distinguished (filled/darkened background) from the inactive one."
    expected: "Two legible pill buttons with the correct labels and a clear active/inactive visual distinction. Neither label reads 'Scenario builder' or 'Add strategies' — those are the pre-phase labels."
    why_human: "role=radiogroup and the two labels are present in the DOM (verified by grep), but visual rendering, contrast, and active-state styling require a real browser render."
  - test: "Open the strategy catalog (browse drawer) inside ScenarioComposer and find a strategy row that is marked as an example strategy (is_example=true in the DB). Confirm a 'EXAMPLE' (or 'Example') provenance pill is visible on that row and absent on non-example rows."
    expected: "The neutral-outline pill (border border-text-muted, text-[10px] uppercase tracking-wide) appears only on example strategies and is visually coherent with the DESIGN.md token system."
    why_human: "The is_example field is co-fetched in /api/strategies/browse (verified) and the pill class is present in StrategyBrowseDrawer.tsx (verified), but correct conditional rendering and visual fidelity require a browser render with real data."
  - test: "Open a saved portfolio (SavedScenariosList row click) while the composer has unsaved changes (dirty draft). Confirm the reset-confirmation modal appears and the user must confirm before the draft is replaced. Click cancel — verify the current draft is preserved unchanged."
    expected: "Modal gates the switch (Pitfall 5 guard). Cancel leaves the draft intact. Confirm replaces it. No silent wipe occurs."
    why_human: "setResetModalOpen(true) branch wiring was verified by grep (line 762), but the interaction flow — modal appearance, cancel/confirm behavior — requires live UI exercise."
---

# Phase 29: Unified Composer Spine — Verification Report

**Phase Goal:** An allocator reaches ONE portfolio composer — composing from a blank slate or seeded from their live book in the same surface, browsing verified + example strategies in one tagged catalog, adding in one gesture, and saving/reopening named portfolios against the existing `scenarios` store.
**Verified:** 2026-06-23T13:00:00Z
**Status:** passed (human gates verified via headed-browser /qa 2026-06-23)
**Re-verification:** No — initial verification; human items closed live in-browser

---

## Goal Achievement

### Observable Truths (UNIFY-01 through UNIFY-05)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | UNIFY-01: RLS-scoped lazy-returns route exists (`/api/strategies/[id]/returns`), uses `createClient()` (never `createAdminClient`), guards with `withPublishedOnly`, returns 400 on non-UUID, 404 on missing/unpublished, and never leaks admin data | VERIFIED | `src/app/api/strategies/[id]/returns/route.ts`: `createClient()` found ×2, `createAdminClient` = 0, `withPublishedOnly` ×3, `isUuid` 400 before auth/rate-limit, `maybeSingle()` probe returns null → 404. Route classified in B15 limiter-ordering `NO_INPUT` bucket (commit `c5bffdb8`). 9/9 tests pass. |
| 2 | UNIFY-02: Browse catalog co-fetches `is_example`, uses `withPublishedOnly` (no `.or()` bypass), and `displayStrategyName` for pseudonymity. Example provenance is surfaced to the client. | VERIFIED | `src/app/api/strategies/browse/route.ts`: `is_example` in select, `withPublishedOnly` ×2, `displayStrategyName` ×1, `createAdminClient` = 0. `StrategyBrowseDrawer.tsx`: pill rendered conditionally on `strategy.is_example`. 25/25 tests pass. |
| 3 | UNIFY-03: StrategyBrowseDrawer shows Example provenance pill; SavedScenariosList uses "portfolio" copy (no "scenario" user-facing strings left from the pre-phase labels). | VERIFIED | `StrategyBrowseDrawer.tsx`: neutral-outline pill class present (`border-text-muted … text-[10px] uppercase tracking-wide`). `SavedScenariosList.tsx`: "portfolio" copy count ≥ 5. 46/46 tests pass (drawer + saved-list combined). |
| 4 | UNIFY-04: ScenarioComposer wires the entry-mode control (`role="radiogroup"`, "From my book" / "Blank slate"), lazy-fetches returns via `/api/strategies/[id]/returns`, merges results into `addedStrategyReturnsLookup`, degrades gracefully on failure (undefined, not `[]`, so re-add retries), aborts in-flight fetches on remove (WR-02 fix), and dirty-draft mode-switch routes through reset modal (never silent wipe). | VERIFIED | `ScenarioComposer.tsx`: `role="radiogroup"` line 1666; "From my book" line 1691; "Blank slate" line 1707. Lazy fetch URL: `` fetch(`/api/strategies/${encodeURIComponent(id)}/returns`) ``. `addedStrategyReturnsLookup` useMemo: `fromBook ?? addedReturnsById[a.id] ?? []` (line 1069). `handleRemoveAdded` (lines 1113–1134): aborts AbortController, purges `addedReturnsById`/`loadingReturnsIds`/`lazyAbortRef`. WR-01 fix: failed fetch leaves entry `undefined` (not `[]`) so re-add retries. `setResetModalOpen(true)` at line 762 (dirty-draft guard). `scenarioDraftCodec` ×3 (ok/readonly/reset trichotomy preserved). 81/81 tests pass. |
| 5 | UNIFY-05: Frozen-spine exit gates hold — no migration touching `scenarios`/`scenario_shares`/`get_shared_scenario`/`create_scenario_share`; `src/lib/scenario.ts` zero-diff; RLS sql test files byte-unchanged; honesty invariant (no peer/percentile panels). | VERIFIED | `phase-29-frozen-spine-guards.test.ts`: 4/4 passing, non-vacuous (`touch` a dummy migration trips gate). `git diff origin/main..HEAD -- supabase/migrations/ src/lib/scenario.ts supabase/tests/test_scenarios_rls.sql supabase/tests/test_scenario_shares_rls.sql` = 0 output (clean). `ScenarioComposer.tsx`: grep for "peer\|percentile\|signature" in blend context = 0 matches. |

**Score: 5/5 truths verified**

---

### LOCKED Exit Gates (explicit phase contract)

| Gate | Condition | Status | Evidence |
|------|-----------|--------|----------|
| No-schema-change | `git diff origin/main..HEAD -- supabase/migrations/` is empty | CLEAR | Diff produces no output; guard assertion (a) passes |
| Frozen engine (SCENARIO-05) | `src/lib/scenario.ts` zero-diff | CLEAR | `git diff --exit-code` exits 0; guard assertion (b) passes |
| RLS sql byte-unchanged | `test_scenarios_rls.sql` and `test_scenario_shares_rls.sql` not in changed set | CLEAR | Guard assertion (c) passes with non-vacuous proof |
| No `createAdminClient` in new routes | Neither `returns/route.ts` nor `browse/route.ts` calls `createAdminClient` | CLEAR | grep count = 0 in both files |
| No scope creep | No changes to `/scenarios/` routes, `ScenarioBuilder.tsx`, or factsheet graph components | CLEAR | `git diff --name-only origin/main..HEAD` contains none of these |

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/app/api/strategies/[id]/returns/route.ts` | Lazy-returns route (UNIFY-04 server side) | VERIFIED | 88 lines, `withPublishedOnly` ×3, `createClient()` ×2, `isUuid` 400 guard |
| `src/app/api/strategies/[id]/returns/route.test.ts` | Route test suite | VERIFIED | 9/9 passing |
| `src/app/api/strategies/browse/route.ts` | Browse route with `is_example` | VERIFIED | `is_example` in select, `withPublishedOnly` ×2 |
| `src/app/(dashboard)/allocations/components/StrategyBrowseDrawer.tsx` | Example pill + relabeled title | VERIFIED | Pill class present, "strategy catalog" copy updated |
| `src/app/(dashboard)/allocations/components/SavedScenariosList.tsx` | Portfolio copy | VERIFIED | "portfolio" ×5+ occurrences |
| `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx` | Entry-mode control + lazy-returns wiring | VERIFIED | `role="radiogroup"`, both segment labels, `addedReturnsById`, lazy fetch URL, `handleRemoveAdded` abort wiring |
| `src/__tests__/phase-29-frozen-spine-guards.test.ts` | Frozen-spine exit-gate guard | VERIFIED | 4/4 passing, `execFileSync` (no shell injection), fail-loud on unresolvable base |
| `src/lib/api/limiter-ordering.test.ts` | B15 registry includes returns route | VERIFIED | `strategies/[id]/returns/route.ts` in `NO_INPUT` bucket (commit `c5bffdb8`) |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `ScenarioComposer.tsx` add-strategy handler | `/api/strategies/[id]/returns` | `fetch(\`/api/strategies/${encodeURIComponent(id)}/returns\`, { signal })` | WIRED | Line 671; AbortController wired; response parsed to `DailyPoint[]` |
| `ScenarioComposer.tsx` | `addedStrategyReturnsLookup` → `buildStrategyForBuilderSet` → `projectionState` → `computeScenario` | useMemo merge + adapter call | WIRED | `fromBook ?? addedReturnsById[a.id] ?? []` feeds the same adapter that feeds `computeScenario`; engine is frozen and unchanged |
| `ScenarioComposer.tsx` dirty-draft mode switch | reset modal | `setResetModalOpen(true)` at line 762 | WIRED | Never silent wipe; modal gates all draft-replacing navigation |
| `StrategyBrowseDrawer.tsx` | `is_example` from browse API | `strategy.is_example` conditional on pill render | WIRED | Prop flows from browse response → drawer row |
| `SavedScenariosList.tsx` | `scenarioDraftCodec` reopen | codec trichotomy (ok/readonly/reset) | WIRED | `scenarioDraftCodec` ×3 in `ScenarioComposer.tsx`; codec untouched this phase |

---

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `ScenarioComposer.tsx` | `addedStrategyReturnsLookup` | `fetch(/api/strategies/${id}/returns)` → `addedReturnsById` state → useMemo | Yes — route queries `daily_returns` from `strategy_analytics` via RLS-scoped Supabase client | FLOWING |
| `ScenarioComposer.tsx` | `projectionState` | `buildStrategyForBuilderSet(addedStrategyReturnsLookup)` → `computeScenario` | Yes — feeds the frozen 252-day annualization engine | FLOWING |
| `StrategyBrowseDrawer.tsx` | `is_example` | `/api/strategies/browse` SELECT includes `is_example` | Yes — co-fetched from `strategies` table, not hardcoded | FLOWING |
| Lazy-fetch failure path | `addedReturnsById[id]` | Failed fetch leaves entry `undefined` (not `[]`) | WR-01: `undefined` means re-add retries (no permanent poison) | FLOWING (correct degradation) |

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Frozen-spine guard runs clean | `npx vitest run 'src/__tests__/phase-29-frozen-spine-guards.test.ts'` | 4/4 passed | PASS |
| Returns route tests all pass | `npx vitest run 'src/app/api/strategies/[[]id[]]/returns/route.test.ts'` | 9/9 passed | PASS |
| Browse route tests all pass | `npx vitest run 'src/app/api/strategies/browse/route.test.ts'` | 25/25 passed | PASS |
| Composer tests pass | `npx vitest run 'src/app/.*/ScenarioComposer.test.tsx'` | 81/81 passed | PASS |
| Drawer + saved-list tests pass | `npx vitest run` (filtered to 29-03 files) | 46/46 passed | PASS |
| B15 limiter registry complete | `npx vitest run 'src/lib/api/limiter-ordering.test.ts'` | 6/6 passed | PASS |
| SCENARIO-05 pins hold | `npx vitest run 'src/lib/scenario.test.ts'` | 37/37 passed | PASS |

---

### Probe Execution

No conventional `scripts/*/tests/probe-*.sh` probes declared for Phase 29. The exit-gate guard (`phase-29-frozen-spine-guards.test.ts`) is the declared probe mechanism for this phase's LOCKED gates; it is executed via vitest and passes 4/4 (see Behavioral Spot-Checks above).

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| UNIFY-01 | 29-01 | RLS-scoped lazy-returns route, no admin client, withPublishedOnly, B15 ordering | SATISFIED | Full route verification + 9/9 tests + B15 registry entry |
| UNIFY-02 | 29-02 | Browse catalog co-fetches is_example, withPublishedOnly, displayStrategyName | SATISFIED | Route grep verification + 25/25 tests |
| UNIFY-03 | 29-03 | Example pill in drawer, portfolio copy in SavedScenariosList | SATISFIED | DOM-level grep verification + 46/46 tests; visual render is human_needed |
| UNIFY-04 | 29-04 | Entry-mode control, lazy-returns wiring, WR-01/02 fixes, portfolio copy in composer | SATISFIED | Full ScenarioComposer grep + 81/81 tests; visual render of segmented control and reset modal flow is human_needed |
| UNIFY-05 | 29-05 | Frozen-spine exit-gate guard, consolidation gate, full suite green | SATISFIED | 4/4 guard tests + 6535/6535 (0 failed) full suite |

All 5 requirements mapped to Phase 29 in REQUIREMENTS.md are satisfied. GRAPH-01 through GRAPH-04 (Phase 30), LAYOUT (Phase 31), FLOW (Phase 32), JOURNEY (Phase 33) are correctly deferred — no scope creep found.

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/app/(dashboard)/allocations/components/SavedScenariosList.tsx` | (pre-existing) | WR-03: `copyExistingShare` silently rotates the share token on every "Copy link" click — the old link becomes invalid without warning. | WARNING | Pre-existing from commit `1d7b2eb1` (Phase 25-03); Phase 29 does not introduce or worsen it. Not a phase-29 blocker. See "Deferred Items" below. |

No `TBD`, `FIXME`, `XXX`, or unreferenced debt markers found in phase-delta files. No empty returns (`return null`, `return {}`, `return []`) in user-visible render paths. No `createAdminClient` in new routes. No fabricated projection series (all degradation paths produce honest empties).

---

### Human Verification Required

#### 1. Entry-Mode Segmented Control Visual Appearance

**Test:** Open `/allocations` as an authenticated allocator. Locate the ScenarioComposer entry-mode control at the top of the composer panel. Verify two visually distinct, mutually-exclusive pill/segment buttons labeled exactly "From my book" and "Blank slate".
**Expected:** Active segment is clearly distinguished (e.g., filled background matching DESIGN.md `--accent` or `--surface-raised` token). Inactive segment is visibly unselected. Labels match exactly — no "Scenario builder" or "Blank slate (empty)" variants.
**Why human:** `role="radiogroup"` and both labels verified by grep, but active-state styling and visual contrast require a browser render.

#### 2. Example Provenance Pill in Strategy Catalog

**Test:** Open the strategy browse drawer inside ScenarioComposer. If any example strategies exist (`is_example=true`), confirm the "EXAMPLE" pill appears on their rows and is absent on non-example rows.
**Expected:** Neutral-outline pill with `border border-text-muted`, `text-[10px] uppercase tracking-wide font-semibold text-text-muted` (per DESIGN.md conventions). Pill is not present on standard verified strategies.
**Why human:** The conditional render and CSS class are verified by grep, but correct visual appearance with real catalog data requires a browser render.

#### 3. Dirty-Draft Reset Modal Flow

**Test:** With an active draft in ScenarioComposer (at least one strategy added or weight changed), click "Blank slate" (the entry-mode switch). Confirm a reset-confirmation modal appears. Click Cancel — verify draft is fully preserved. Re-trigger the modal and click Confirm — verify draft is replaced with a clean slate.
**Expected:** No silent wipe. Modal always gates the switch. Cancel is safe. Confirm destroys draft (expected, correct).
**Why human:** `setResetModalOpen(true)` wiring is verified by grep (line 762), but the interactive modal flow requires live UI exercise.

#### 4. WR-03 Advisory: Copy Link Silent Token Rotation (pre-existing, not a phase-29 blocker)

**Test:** In SavedScenariosList, share a scenario. Copy the share link. Click "Copy link" a second time on the same row. Verify the first link is now invalid (or warn users it will be).
**Expected:** Either (a) both links remain valid, or (b) a tooltip/dialog warns "A new link will be generated; the previous link will be deactivated."
**Why human:** WR-03 is a pre-existing UX footgun from Phase 25-03, not introduced by Phase 29. No fix was scoped for this phase. Flagged here for product decision: either accept the behavior or schedule a fix in a future phase.

---

### Deferred Items

Items not introduced by Phase 29 and not scoped for fix in this phase.

| # | Item | Origin | Addressed In | Evidence |
|---|------|--------|-------------|----------|
| 1 | WR-03: "Copy link" silently rotates the share token — previous recipients lose access without warning | Phase 25-03 (commit `1d7b2eb1`) | Not yet scheduled | Explicitly documented as deferred in `29-REVIEW.md` (WR-03 section): "pre-existing from Plan 25-03, not Phase 29 scope" |

---

### Gaps Summary

No automated gaps. All 5 UNIFY requirements are verified in the codebase. All LOCKED exit gates are clean. The phase-29 source delta contains exactly the 13 expected files — no unexpected changes, no schema drift, no scope creep.

Three human verification items (segmented control appearance, Example pill appearance, and the reset modal flow) are the sole pending items before a full PASS can be declared. These are visual/interactive checks that cannot be completed by static analysis.

The WR-03 pre-existing issue is advisory only and does not block the phase goal.

---

_Verified: 2026-06-23T13:00:00Z_
_Verifier: Claude (gsd-verifier)_
