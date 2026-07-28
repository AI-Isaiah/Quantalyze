---
phase: 59-saved-shared-compared-windows
verified: 2026-07-02T12:10:00Z
status: passed
score: 12/12 must-haves verified
overrides_applied: 0
human_verification:
  - test: "Open a saved scenario that has a coverage window stored in its draft (a v3 row with a non-null window). Confirm the window picker reflects the owner's persisted window, not the intersection default, and that the 'Update portfolio' PUT carries the same window."
    expected: "Window readout matches draft.window from the DB row. PUT body includes a 'window' key whose start/end match. No ProvenanceNote is shown."
    why_human: "Requires an authed prod session, a pre-saved v3 scenario, and inspection of the PUT body in DevTools — not unit-testable without a live DB."
  - test: "Open a saved v2 (windowless) scenario. Confirm the ProvenanceNote banner appears with 'This saved scenario predates coverage windows', is dismissible via the × button, and reappears on the next reopen."
    expected: "ProvenanceNote renders. Clicking × hides it. Reopening the same scenario shows it again (per-open nonce remounts a fresh component)."
    why_human: "Requires an authed session with a real v2 DB row and interactive dismiss/reopen cycles."
  - test: "Visit a shared scenario link whose token was created from a v3 scenario with a coverage window. Confirm the page computes at the owner's window, not the recipient's default, and that no api_key / allocated_amount / account_balance / value_usd values appear in the response."
    expected: "Scenario share page shows metrics computed over the owner's date range. Network DevTools / RSC payload contains no sensitive field names."
    why_human: "Requires minting a real share token from an authed session and visiting the share URL — the SQL RLS and TS wiring is unit-tested but end-to-end rendering requires a deployed environment."
  - test: "Open the Compare tab with two saved scenarios, each stored with a different coverage window. Confirm the tfoot of the ScenarioCompareTable shows a distinct date range under each column's verdict stamp, and that the Live Book column (if selected) shows no date range."
    expected: "Column A tfoot: 'N days · YYYY-MM-DD – YYYY-MM-DD' for its window. Column B tfoot: a different date range. Live Book tfoot: 'N days' with no date range appended."
    why_human: "Requires two authed v3 scenarios with distinct windows, the Compare tab in a live session, and visual inspection of the tfoot text."
---

# Phase 59: saved-shared-compared-windows Verification Report

**Phase Goal:** The coverage window is durable — a saved scenario reopens at the owner's window, a shared link recomputes at that same window with no leak, and compare works across each scenario's own window.
**Verified:** 2026-07-02T12:10:00Z
**Status:** human_needed — all 12 technical must-haves VERIFIED; 4 authed-prod canary items deferred to Phase 61 VERIFY-02 per user instruction.
**Re-verification:** No — initial verification.

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `ScenarioDraft` carries an optional `window?: CoverageWindow` field with a zod-validated schema | VERIFIED | `scenario-state.ts:118` (`window?: CoverageWindow`) + `:645` (`z.object({ start: z.string().max(32), end: z.string().max(32) }).optional()`) |
| 2 | Schema bumped to v3; v2 is a named constant; codec upgrades v2 → v3 non-destructively (never reset) | VERIFIED | `:66` `SCENARIO_SCHEMA_VERSION = 3`; `:73` `SCENARIO_SCHEMA_VERSION_PREV = 2`; `:724-738` codec branch returns `outcome:"ok", reason:"upgraded_v2_windowless"` when `rawVersion === SCENARIO_SCHEMA_VERSION_PREV` |
| 3 | `setWindow()` is the sole production writer of `draft.window` — pure transform, same-window no-op, defensive copy | VERIFIED | `scenario-state.ts:562-578`; M9 no-op guard on same window; `scenario-state.test.ts` `describe("setWindow")` 51 passed |
| 4 | `applyWindow` gesture path writes through to the draft (CR-01 fix): calls both `seedWindowLocal` and `scenario.setWindow` | VERIFIED | `ScenarioComposer.tsx:1974-1983` `applyWindow = useCallback` calls `seedWindowLocal(range)` then `scenario.setWindow(range)`; covers Common-period preset (:3176), Full-range preset (:3195), CustomRangePicker (:3216), ProvenanceNote "Show full range" (:3113), DefaultChangeNote "Show full range" (:3127) |
| 5 | Drifted reopen does NOT seed the owner's window (honesty invariant, WR-01 fix) | VERIFIED | `ScenarioComposer.tsx:1200-1202` synchronous drift detection; `openSavedScenario` ok branch `:1266-1273`: drifted → no `seedWindowLocal`; window present + non-drifted → `seedWindowLocal`; else `resetWindowToDefaultOnReopen`; seed invalidation effect `:1864-1887` clears stale view state when `draft.window` transitions set → absent |
| 6 | ProvenanceNote renders for v2 upgrades, dismisses ephemerally per-open via component-local state, never writes localStorage or a cross-tab key | VERIFIED | `ProvenanceNote.tsx` uses `useState(false)` only; `grep useCrossTabStorage ProvenanceNote.tsx` = 0 matches; per-open nonce `provenanceOpenNonceRef` + composite key `"${loadedScenarioId}-${nonce}"` in `:3173` ensures reopen remounts a fresh note; ProvenanceNote.test.tsx 5/5 passed |
| 7 | Save route round-trip: v3 draft with window → POST/PUT persists `draft.window` intact; v3 windowless draft validates and inserts without a window key | VERIFIED | `src/app/api/allocator/scenario/saved/route.test.ts` T_S19 (`schema_version === 3`, `draft.window` captured intact) + T_S20 (windowless validates); autosave writes same `scenario.draft` object that POST/PUT handlers serialize |
| 8 | Share-resolve threads the owner's window verbatim — no re-derivation, no leak | VERIFIED | `src/app/scenario-share/[token]/share-resolve.ts:194-199` spread `...(draft.window ? { window: draft.window } : {})`; 47 share-page tests passed including 6 in `page.test.tsx` |
| 9 | SQL leak-scan: `test_scenario_shares_rls.sql` seeds a windowed draft AND asserts positive round-trip; negative over-return guard is byte-intact | VERIFIED | SQL line 156: `'window', jsonb_build_object(...)` in seed INSERT; lines 255-261: positive `draft->'window'->>'start'` assertion raises on mismatch; lines 244-246: negative `IF payload_text ~ 'api_key|allocated_amount|account_balance|value_usd'` guard present and unweakened |
| 10 | Frozen-spine pin is non-vacuous: asserts the OPERATIVE IF-line verbatim with occurrence count >= 3 (CR-02 fix) | VERIFIED | `phase-29-frozen-spine-guards.test.ts:202-242` pins `"IF payload_text ~ 'api_key|allocated_amount|account_balance|value_usd' THEN"` substring + `alternationOccurrences >= 3` belt-and-braces; `test_scenarios_rls.sql` byte-unchanged pin intact at `:192-199` |
| 11 | Compare computes each scenario column at its own `draft.window` via POST-collapse injection; live-book column stays windowless | VERIFIED | `scenario-compare.ts:155-171`: after `collapseAliasedHoldingStrategies`, injects `{ ...deAliased.state, window: draft.window }` when `draft.window` is set; `buildLiveBookDraft()` omits `window` (union path); ScenarioCompareTable.test.tsx 24/24 passed |
| 12 | ScenarioCompareTable renders a per-column effective date range in `<tfoot>` under `verdict.ok`; suppressed on undecodable and below-floor | VERIFIED | `ScenarioCompareTable.tsx:267-292` verdict.ok branch: `{c.metrics.effective_start && c.metrics.effective_end ? (<> · <span>{effective_start}</span>–<span>{effective_end}</span></>) : null}`; below-floor and undecodable branches contain no date-range render; 5 PERSIST-03 pins + all-columns guard passed |

**Score:** 12/12 truths verified

---

## Cross-Cutting Invariants

| Invariant | Status | Evidence |
|-----------|--------|----------|
| No SQL migration touching `scenarios` / `scenario_shares` / RPC | VERIFIED | `phase-29-frozen-spine-guards.test.ts` exit gate (a): frozen-spine test passes; `git diff origin/main HEAD -- supabase/migrations/` = no scenario/share migration |
| `src/lib/scenario.ts` and `src/lib/scenario-window.ts` byte-unchanged | VERIFIED | `git diff 221a6daa..HEAD -- src/lib/scenario.ts src/lib/scenario-window.ts` = 0 lines; phase-29 exit gate and BLEND-07 numpy oracle protect this |
| v2 drafts are never reset — codec always returns `outcome:"ok"` for `rawVersion === 2` | VERIFIED | `scenario-state.ts:724-738`; `scenario-state.test.ts` upgraded_v2_windowless test in 51 passed; no reset path exists for `rawVersion === SCENARIO_SCHEMA_VERSION_PREV` |
| Displayed window == persisted window (honesty invariant) | VERIFIED | `coverageWindow` prefers `scenario.draft.window` over local seed (`:1865-1869`); drifted-reopen no-seed (`:1200-1273`); seed invalidation effect (`:1864-1887`) clears stale view state; T_WIN_SAVE4 + T_WIN_SAVE5 regression pins in `ScenarioComposer.save.test.tsx` 15/15 |

---

## Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/app/(dashboard)/allocations/lib/scenario-state.ts` | `ScenarioDraft.window?`, SCHEMA_VERSION=3, setWindow, non-destructive codec | VERIFIED | Window field :118, version constants :66/:73, setWindow :562-578, codec branch :724-738 |
| `src/app/(dashboard)/allocations/hooks/useScenarioState.ts` | `setWindow` exposed on state object | VERIFIED | Interface :94, impl :266-268 (`setWindowPure(baseOf(prev), window)`) |
| `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx` | applyWindow write-through, openSavedScenario reopen seeding, drift guard, seed invalidation effect | VERIFIED | applyWindow :1974-1983, openSavedScenario :1200-1273, invalidation effect :1864-1887 |
| `src/app/(dashboard)/allocations/components/ProvenanceNote.tsx` | Ephemeral dismissal via component-local state; no cross-tab storage | VERIFIED | `useState(false)` only; 0 `useCrossTabStorage` references; 5/5 unit tests passed |
| `src/app/scenario-share/[token]/share-resolve.ts` | Verbatim window spread; no re-derivation | VERIFIED | Lines 194-199; 47 share tests passed |
| `supabase/tests/test_scenario_shares_rls.sql` | Window seed + positive round-trip assertion + negative over-return guard intact | VERIFIED | Lines 156 (seed), 244-246 (negative guard), 255-261 (positive assertion) |
| `src/__tests__/phase-29-frozen-spine-guards.test.ts` | Non-vacuous pin on operative IF-line + occurrence count | VERIFIED | Lines 202-242; CR-02 fix (a24f324c); 4/4 frozen-spine tests passed |
| `src/app/(dashboard)/allocations/lib/scenario-compare.ts` | POST-collapse window injection; live-book windowless | VERIFIED | Lines 155-171 injection; `buildLiveBookDraft()` has no window assignment |
| `src/app/(dashboard)/allocations/components/ScenarioCompareTable.tsx` | Per-column effective window in tfoot, verdict.ok only | VERIFIED | Lines 267-292; 9 new PERSIST-03 test cases + all-columns guard; 24/24 passed |

---

## Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `applyWindow` gesture | `draft.window` | `scenario.setWindow(range)` in ScenarioComposer:1983 | VERIFIED | CR-01 fix (bd1b2c24); both `seedWindowLocal` and `scenario.setWindow` called in sequence |
| `draft.window` | autosave / POST / PUT | `scenario.draft` serialized in postNewScenario/putUpdateScenario | VERIFIED | Same draft object; T_WIN_SAVE1 + T_WIN_SAVE3 pin the gesture → wire |
| `draft.window` → reopen seed | `seedWindowLocal(draft.window)` | `openSavedScenario` ok branch, non-drifted only | VERIFIED | WR-01 fix (79ef3a14); drifted path omits seed |
| `draft.window` | `share-resolve.ts` state | `...(draft.window ? { window: draft.window } : {})` spread | VERIFIED | Verbatim; no fallback re-derivation |
| Scenario `draft.window` | `computeScenario` call | `engineState = { ...deAliased.state, window: draft.window }` in scenario-compare:155-171 | VERIFIED | POST-collapse injection after `collapseAliasedHoldingStrategies` |
| `c.metrics.effective_start/end` | `<tfoot>` render | Conditional `{effective_start}–{effective_end}` in ScenarioCompareTable:267-292 | VERIFIED | Suppressed correctly on undecodable and below-floor paths |

---

## Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| v2 → v3 codec returns upgraded_v2_windowless, never reset | `npx vitest run scenario-state.test.ts --reporter verbose` | 51 passed / 0 failed | PASS |
| ProvenanceNote ephemeral dismiss, no cross-tab storage | `npx vitest run ProvenanceNote.test.tsx --reporter verbose` | 5 passed / 0 failed | PASS |
| PERSIST-03 per-column window labels, heterogeneous dates, suppression | `npx vitest run ScenarioCompareTable.test.tsx --reporter verbose` | 24 passed / 0 failed | PASS |
| Share-resolve threads window verbatim, no leak | `npx vitest run page.test.tsx --reporter verbose` (scenario-share) | 6 passed / 0 failed | PASS |
| Frozen-spine pin operative guard non-vacuous | `npx vitest run phase-29-frozen-spine-guards.test.ts --reporter verbose` | 4 passed / 0 failed | PASS |
| Full PERSIST-01/02/03 suite (6 test files) | `npx vitest run scenario-share scenario-compare ScenarioCompareTable` | 47 passed / 0 failed | PASS |

---

## Probe Execution

Step 7c: SKIPPED — no `scripts/*/tests/probe-*.sh` probes defined for this phase. Functional verification is covered by the Vitest suite above.

---

## Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| PERSIST-01 | 59-01-PLAN.md, 59-02-PLAN.md | Coverage window persisted in saved scenario draft; v2 upgrades non-destructively; reopen seeds from draft.window; provenance note for v2 upgrades | SATISFIED | Truths 1-7 above; T_S19/T_S20; scenario-state.test.ts 51/51; ScenarioComposer.save.test.tsx 15/15 |
| PERSIST-02 | 59-02-PLAN.md | Shared link recomputes at owner's window; no SECDEF over-return leak; frozen-spine guard extended non-destructively | SATISFIED | Truths 8-10 above; share-resolve.ts verbatim spread; SQL positive round-trip + negative guard; phase-29 frozen-spine 4/4 |
| PERSIST-03 | 59-03-PLAN.md | Compare uses each scenario's own window; live-book column windowless; per-column effective window label in tfoot | SATISFIED | Truths 11-12 above; scenario-compare.ts POST-collapse injection; ScenarioCompareTable.tsx :267-292; 24/24 tests |

No orphaned requirements. All three PERSIST-* IDs from PLAN frontmatter map to implemented code with test coverage.

---

## Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| (none) | — | — | — | No TBD / FIXME / XXX / placeholder patterns found in phase-59 touched files |

Review INFO items accepted-as-info in 59-REVIEW.md:
- **IN-01** (`setWindow` accepts structurally unvalidated windows): defensive gap only; all callers use scenario-window.ts helpers or the picker. Accepted: no crash path, degrades honestly.
- **IN-02** (window-only edit not counted as dirty for mode-switch confirm): soft impact; stored blob survives the mismatch and is restored on toggle-back. Accepted: comment correction is sufficient.

---

## Human Verification Required

These items require an authed deployed environment and are scoped to Phase 61 VERIFY-02 canary per user instruction. They are not gaps — the supporting code is fully wired and unit-tested.

### 1. Reopen at saved window

**Test:** In an authed prod session, open a scenario that was saved after applying a non-default coverage window (a v3 row with `draft.window` set). Open it again.
**Expected:** The window picker displays the owner's persisted window (not the intersection default). The "Update portfolio" PUT body contains a `window` key whose `start`/`end` match the displayed dates. No ProvenanceNote is shown.
**Why human:** Requires a live authed session, a pre-saved v3 DB row, and DevTools inspection of the PUT payload.

### 2. ProvenanceNote interactive flow

**Test:** In an authed prod session, open a scenario that was saved before Phase 59 (a v2 windowless row). Confirm the ProvenanceNote banner appears. Click ×. Confirm it disappears. Reopen the same scenario. Confirm it reappears.
**Expected:** Note renders on open, dismisses on ×, reappears on next open (per-open ephemeral state).
**Why human:** Requires a live authed session with a real v2 DB row and interactive dismiss/reopen cycles.

### 3. Shared link at owner's window

**Test:** From an authed session, create a share link for a scenario with a coverage window set. Open the link in an incognito browser (or as a different user). Inspect the rendered metrics date range and the RSC payload.
**Expected:** The share page computes and displays metrics at the owner's window dates. No `api_key`, `allocated_amount`, `account_balance`, or `value_usd` fields appear in the RSC payload.
**Why human:** Requires minting a real share token, a second browser session, and network payload inspection.

### 4. Compare per-column window labels

**Test:** In an authed prod session, open the Compare tab with two scenarios, each carrying a different coverage window. Optionally add the Live Book column.
**Expected:** Each scenario column's tfoot shows its own date range: `N days · YYYY-MM-DD – YYYY-MM-DD`. The columns show different date ranges. The Live Book column (if present) shows `N days` with no date range suffix.
**Why human:** Requires an authed session, two v3 scenarios with distinct windows, and visual inspection of tfoot rendering in the Compare tab.

---

## Gaps Summary

No gaps. All 12 technical must-haves are verified at all levels (exists, substantive, wired, data-flowing). The phase goal is achieved in the codebase. The 4 human verification items above are authed-prod canary checks deferred to Phase 61 VERIFY-02 per user instruction — they are not implementation gaps.

---

_Verified: 2026-07-02T12:10:00Z_
_Verifier: Claude (gsd-verifier)_

## Addendum 2026-07-03 — human_needed items CLOSED by Phase 61 (+ PR #570)

The four authed-session items were executed live during the Phase-61 canary:
save→reopen window round-trip PASS (B3, survives full reload); share
round-trip and heterogeneous compare initially FAILED for book-mode drafts
(P61-BUG-2, pre-existing adapter-path divergence discovered BY the canary) and
were FIXED in PR #570 v0.35.0.31 and re-verified live (compare column computes
at its persisted window; book-only shares 409 honestly at mint; added-bearing
shares compute at the owner's window); provenance note covered by construction
for shareable drafts. See 61-VERIFICATION.md §B + 2026-07-03 addendum. Phase 59
is fully verified; effective status: passed.
