---
phase: 147-scen-01-the-scenario-engine-receives-the-real-series
plan: 05
subsystem: ui
tags: [react, typescript, scenario-composer, coverage-chip, honest-empty-state, vitest, tdd, scen-01]

# Dependency graph
requires:
  - "147-02 — ReturnsResponse.series_state on the lazy /api/strategies/[id]/returns body"
  - "147-04 — MyAllocationDashboardPayload strategies[].strategy.series_state on the book payload"
  - "147-01 — SeriesState union in src/lib/closed-sets.ts"
provides:
  - "CoverageState extended in place with 'syncing' + 'no-series' (five members, ONE chip vocabulary)"
  - "narrowSeriesState — the single client-side series_state trust-boundary narrowing, shared by both supply lines"
  - "addedSeriesStateById + addedSeriesStateByRef — the per-row discriminator with all four lifecycle seams"
  - "data-series-state attribute on <li data-testid='scenario-constituent-added'>"
  - "data-testid='scenario-series-state-note' — the two locked excluded-from-blend notes"
affects: [147-06]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "One narrowing helper per additive wire field, called by EVERY supply line — a mutation in it reddens both paths at once, which is the 'one derivation table' claim proving itself"
    - "Chip + note keyed off the SAME derived chipState so a row structurally cannot carry two competing signals"
    - "Exhaustive test ladder via Record<UnionType, string> — a new union member that is not enumerated is a compile error, so a base-shape pin cannot go partially vacuous"
    - "Escape a module-mocked child for one assertion: capture the real props the component under test passed to the mock, then render the REAL child with them (wiring, not helper)"

key-files:
  created: []
  modified:
    - src/app/(dashboard)/allocations/components/CoverageStateChip.tsx
    - src/app/(dashboard)/allocations/components/CoverageStateChip.test.tsx
    - src/app/(dashboard)/allocations/components/ScenarioComposer.tsx
    - src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx
    - .planning/phases/147-scen-01-the-scenario-engine-receives-the-real-series/147-VALIDATION.md

key-decisions:
  - "The note is keyed off chipState, not off seriesState — so a manually-excluded row says 'Excluded' and stops. Keying it off seriesState would have printed a series note under an Excluded chip: two competing explanations for one row"
  - "data-series-state reports the SERVER fact even when user intent hides the chip. Intent suppresses the label, it does not rewrite what the server said — the attribute stays a faithful probe"
  - "UI-SPEC item 5's 'no negative class anywhere in the row' is scoped to APPLIED tokens; the Remove ×'s hover:border-negative/hover:text-negative is a pre-existing destructive-action affordance present in every state including in-blend. A non-vacuity assertion proves the scanner does see those tokens and is deliberately excluding them"
  - "UI-SPEC item 7 asserted against the REAL KpiStrip rendered with the composer's own captured props, because KpiStrip is module-mocked in this file and asserting against the mock would have been vacuous"

requirements-completed: [SCEN-01]

# Metrics
duration: 30min
completed: 2026-08-05
---

# Phase 147 Plan 05: Honest empty/degraded composer state Summary

**An added strategy with no return series now says which kind of empty it is — an amber `SYNCING` chip with "First metrics arrive in ~10–15 min" while the server computes, a muted `NO DATA` chip when the series is genuinely absent — instead of rendering "0 overlapping days" and 0.00 with no signal at all, and the discriminator arrives through ONE narrowing helper shared by both reader paths so the two can never disagree.**

## Performance

- **Duration:** ~30 min
- **Started:** 2026-08-05T06:38Z (worktree base corrected first)
- **Completed:** 2026-08-05T07:08Z
- **Tasks:** 3 (Tasks 1–2 TDD RED→GREEN, Task 3 test-only)
- **Files modified:** 5 (0 created)

## Accomplishments

- **ROADMAP SC4 is closed at the component level.** The row that used to assert a number it did not have now carries a chip and a note that both name the reason, and the `—` contract holds at the blend level: with zero contributing constituents the REAL `KpiStrip`, fed the composer's own props, renders em-dash and contains no `0.00`.
- **One chip vocabulary, not two.** `CoverageState` was extended **in place** to five members. `syncing` reuses the exact amber trio `auto-excluded` uses and `no-series` the exact muted pair `manually-excluded` uses — deliberate reuse, because the semantics agree and the differing text labels do all the disambiguating (WCAG 1.4.1). No second chip component exists (`grep -ci "serieschip\|seriesstatechip"` → 0), and the component stays presentation-only (`grep -c "closed-sets\|computation_status"` → 0).
- **Both supply lines narrow through ONE function.** `narrowSeriesState` is called by the lazy-fetch `.then` and by the book merge memo. The SC-4 mutation landed in that single helper and reddened **both** the lazy test (SC4-2) and the book test (SC4-6) — the "one derivation table" claim (UI-SPEC §3 / SC2) demonstrating itself rather than being asserted.
- **The client never gets a vote on what empty means.** No branch derives state from array length; `grep -c "daily_returns.length === 0"` in the composer is **0**. SC4-5 and SC4-3/-4 supply the *identical* empty array and differ only in the server's discriminator — precisely the distinction length cannot make.
- **Tolerance is proven against both degradation modes.** A stale deploy that omits `series_state` (SC4-3) and a garbage value (SC4-4) both collapse to `available`: no chip, no note, no throw, and critically no **false** Syncing — the permanent-spinner class Phase 142 exists to kill (T-147-13).
- **The map has all four seams.** Settle writer, purge on remove, book-vs-lazy merged lookup, and a conservative default. SC4-9 proves the purge: a remove + re-add starts clean rather than showing a stale `Syncing` against a retry that has not answered.
- **All eight UI-SPEC falsifiable acceptance items have a named covering test**, including item 7, which **passed** — no escalation was required.

## Task Commits

1. **Task 1 (RED): failing tests for syncing + no-series chip states** — `866c5594` (test) — 3 failed | 4 passed
2. **Task 1 (GREEN): CoverageState extended with syncing + no-series** — `dbdb6e80` (feat) — 7 passed
3. **Task 2 (RED): failing SC4 tests for composer series_state** — `b8b4f3b7` (test) — 9 failed
4. **Task 2 (GREEN): series_state threaded through the composer** — `9bd6df21` (feat) — 210 passed
5. **Task 3: the eight UI-SPEC acceptance items** — `e56c48c2` (test) — 223 passed across both files

No REFACTOR commits — neither GREEN implementation needed cleanup.

## Files Created/Modified

- `CoverageStateChip.tsx` — union extended to five members; two CHIP entries added; docstring state→label→token table extended in the same format and its "coverage-window blend" phrasing rewritten to name the widened axis (blend membership **and** series availability), with the never-red rationale recorded for both new states.
- `CoverageStateChip.test.tsx` — two per-state tests with the never-red negative assertion; the base-shape ladder rebuilt on a `Record<CoverageState, string>` so it is exhaustive at compile time. The three existing per-state tests are byte-unchanged.
- `ScenarioComposer.tsx` — `narrowSeriesState` boundary helper beside `normalizeBookReturns`; `SeriesState` added to the existing `closed-sets` import; `addedSeriesStateById` state + settle/purge seams; `addedSeriesStateByRef` merged memo; `addedSeriesStateByRef` prop threaded into `CompositionList`; chip precedence widened to the UI-SPEC ladder; `data-series-state` on the added `<li>`; the two notes rendered below the identity cluster.
- `ScenarioComposer.test.tsx` — one new describe block: SC4-1…SC4-9 plus the eight `UI-SPEC #n` tests, with local `stubReturnsFetch` / `makeBookPayload` / `chipsIn` / `appliedNegativeTokens` fixtures. No existing test modified.
- `147-VALIDATION.md` — row SC-4 moved to ✅ with pasted RED evidence.

## Decisions Made

- **The note follows the chip, not the raw state.** Rendering it off `seriesState` would have put "No return series available" under an `Excluded` chip — two explanations competing for one row. Keying both off the single derived `chipState` makes "exactly one signal per row" structural rather than a thing tests hope for. SC4-7 pins it.
- **`data-series-state` keeps reporting the server fact under a manual exclusion.** The attribute is a probe of what the server said; the chip is a projection of what the user should read. Collapsing the probe to match the chip would have made the attribute unable to distinguish "excluded and computing" from "excluded and fine".
- **Item 5's negative-token scan excludes `hover:` tokens deliberately.** The Remove × carries `hover:border-negative hover:text-negative` on **every** row in every state. A naive "no negative class in the row" assertion fails on an in-blend row too, so it would have been failing for a reason unrelated to the claim — and the tempting "fix" would have been editing an untouched destructive affordance. The test scans applied tokens only and asserts non-vacuously that the scanner *does* see the hover tokens it is skipping.
- **Item 7 escapes the module mock rather than asserting against it.** `KpiStrip` is `vi.mock`'d in this file, so `queryAllByText("0.00")` against the composer render would pass no matter what `KpiStrip` did. The test captures the exact props the composer handed the mock, then renders the REAL `KpiStrip` (`vi.importActual`) with them. That is a genuine wiring assertion — real engine output into the real KPI renderer — and it is why no escalation was needed.
- **The ladder test uses `Record<CoverageState, string>`.** A sixth union member added later without a label entry is a compile error, so the base-shape pin can never silently cover only some of the states.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `node_modules` absent in the worktree**
- **Found during:** setup, before Task 1
- **Issue:** the worktree had no `node_modules`, so `npx vitest` / `npx tsc` / `npm run lint` were all impossible.
- **Fix:** symlinked the main repo's **existing** install. No package manager ran and no package was resolved from a registry (the Rule 3 package-install exclusion is not engaged).
- **Files modified:** none tracked (`node_modules` is gitignored; `git status` stayed clean).
- **Verification:** `node_modules/.bin/vitest` resolved; all three commands ran.

**2. [Rule 1 - Bug] My own comment prose false-positived the acceptance grep**
- **Found during:** Task 2, running the acceptance criteria
- **Issue:** the `narrowSeriesState` docstring explained the ban by quoting `daily_returns.length === 0`, so the criterion's grep returned 1 — the exact trap 147-02 flagged ("reword your own comments rather than leave prose that false-positives an acceptance grep").
- **Fix:** reworded to "an EMPTY returns array"; the ban is stated more plainly and the grep is now 0. No behavior change.
- **Files modified:** `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx`
- **Committed in:** `9bd6df21`

**3. [Rule 1 - Bug] Loop-scoped tests leaked draft state through localStorage**
- **Found during:** Task 3, first run of UI-SPEC #6
- **Issue:** the scenario draft persists to localStorage, and the describe's `beforeEach` clears it once per *test*, not per loop iteration. The second iteration re-hydrated a draft whose row was already toggled OFF, so the test's toggle gesture turned it back ON and the `Excluded` assertion failed — a real test bug that would have looked like a production precedence bug.
- **Fix:** `lsStore.clear()` beside each in-loop `cleanup()` in the three multi-state tests, with a comment naming the leak.
- **Files modified:** `src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx`
- **Verification:** 8/8 UI-SPEC tests green; the gesture now genuinely toggles OFF in both iterations.
- **Committed in:** `e56c48c2`

---

**Total deviations:** 3 auto-fixed (1 blocking, 2 bugs). No architectural changes, no Rule 4 escalations, zero package installs.
**Impact on plan:** none on scope — one unblocked execution, one was a self-inflicted grep collision in comment prose, one was a test-harness leak. All three plan tasks landed in exactly their specified files.

## Issues Encountered

- **The worktree base was wrong on spawn.** HEAD sat at `764038a7` (`origin/main`, before the phase-147 planning commits), so `resolve-series.ts` and the wave-1/2 `series_state` producers would have been absent. The prompt's `EXPECTED_BASE` (`d70ee8dd`) was valid this time — the branch-namespace assertion passed first, then the mandated `git reset --hard` corrected it, and all three wave-1/2 artifacts were verified present before any work began. Sibling agents in this phase reported the same wrong-base spawn (see 147-02 / 147-04), so it is systematic, not incidental.
- Pre-existing lint warning in `src/app/(dashboard)/allocations/widgets/performance/EquityChart.tsx:1119` (`react-hooks/exhaustive-deps`) — untouched by this plan, out of scope, not fixed.

## Verification Results

- `npx vitest run "…/ScenarioComposer.test.tsx" "…/CoverageStateChip.test.tsx" --no-file-parallelism` → **223 passed / 2 files**, zero skipped
- Regression sweep `npx vitest run "src/app/(dashboard)/allocations" --no-file-parallelism` → **119 files / 1616 passed**
- `npx tsc --noEmit` → exit 0
- `npm run lint` → **0 errors** (1 pre-existing warning in an untouched file); route-contract and admin-manifest checks OK
- `ls …/components/ | grep -ci "serieschip\|seriesstatechip"` → **0** (no second chip component)
- `grep -c "closed-sets\|computation_status" CoverageStateChip.tsx` → **0** (presentation-only intact)
- `grep -c "daily_returns.length === 0" ScenarioComposer.tsx` → **0** (UI-SPEC §3 ban)
- Both note strings → exactly **1** verbatim hit each in the component
- `git diff -- src/lib/scenario.ts` → **0 lines** (frozen engine untouched)
- `git diff --name-only` over the plan's commits → exactly the 5 files listed above; no file deletions in any commit; no untracked files left behind

### Falsifiability (147-VALIDATION.md)

| SC | Mutation | Result |
|----|----------|--------|
| SC-4 | `narrowSeriesState` — map `"empty"` to `"computing"` | ✅ RED: 2 failed. SC4-2 `expect(element).toHaveAttribute("data-series-state", "empty")` → `Received: data-series-state="computing"`; SC4-6 (book path) fell with the same symptom, because the mutation sits in the ONE shared helper. Reverted **by re-editing the mutated line** (never a file-level `git checkout --`, per the 147-02 lesson); 210/210 green after revert. |

## TDD Gate Compliance

Tasks 1 and 2 followed RED → GREEN in order, each gate its own commit with the observed counts in the message: Task 1 `866c5594` (test) → `dbdb6e80` (feat); Task 2 `b8b4f3b7` (test) → `9bd6df21` (feat). Task 3 is test-only by design (plan `type="auto"`, no `tdd` flag) and touched no production file. No REFACTOR gate was needed.

## Known Stubs

None — no placeholder values, TODOs, or unwired data paths. Every rendered state is driven by a live server-derived discriminator; the `"available"` default is a deliberate conservative fallback (no chip, no note), not a stub.

## Threat Flags

None. This plan adds no endpoint, no query and no trust boundary — it consumes two fields that already crossed. The registered mitigations are all discharged by test: **T-147-13** (malformed `series_state` injection) by SC4-3/-4, which prove a garbage or absent value collapses to `available` rather than throwing or fabricating a Syncing row; **T-147-14** (client re-derivation drift) by the `daily_returns.length === 0` grep returning 0 plus SC4-5/-6, where identical empty arrays render differently *only* because the server said so; **T-147-15** (0.00 rendered as a real metric) by UI-SPEC #7 against the real `KpiStrip`. Zero package installs, zero new components, zero icons or spinners (T-147-SC).

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- **147-06's grep gate** will find `narrowSeriesState(` with exactly **two** call sites in `ScenarioComposer.tsx` (the lazy `.then` and the book merge memo) and **one** definition. A third call site appearing without going through the helper is the drift signal to look for.
- The chip vocabulary is now five members. Any future consumer of `CoverageState` must handle `syncing` / `no-series`; the `Record<CoverageState, …>` in both the component and its test ladder makes an omission a compile error rather than a runtime `undefined`.
- `data-series-state` and `data-testid="scenario-series-state-note"` are the stable probes for any downstream e2e or QA pass on this surface.
- **Out of scope by contract and still open:** composer legibility/density (Phase 152), the AUM input's zeros-on-screen symptom (Phase 151), and any factsheet link from these rows (blocked until Phase 148 — a link shipped here would land on `notFound()`).

## Self-Check: PASSED

- Files claimed modified exist on disk and are in the diff: `CoverageStateChip.tsx`, `CoverageStateChip.test.tsx`, `ScenarioComposer.tsx`, `ScenarioComposer.test.tsx`, `147-VALIDATION.md`
- Commits claimed exist in this worktree's history: `866c5594`, `dbdb6e80`, `b8b4f3b7`, `9bd6df21`, `e56c48c2`
- No missing items.

---
*Phase: 147-scen-01-the-scenario-engine-receives-the-real-series*
*Completed: 2026-08-05*
