---
phase: 149-nav-my-strategies-a-ranking-at-discovery-parity
plan: 03
subsystem: ui
tags: [ranking, honest-pending, placeholder-rows, chips, tdd, vitest]

# Dependency graph
requires:
  - phase: 149-01
    provides: the `visibility` prop (closed union, literal `"published-only"` default) every new branch here gates on
  - phase: 149-02
    provides: the `analyticsPresent` absent-row signal and the `private` Badge status mapping
  - phase: 147-scen-01-real-series
    provides: deriveEmptySeriesState + MISSING_ROW_COMPUTING_WINDOW_MS (the ONE empty-series discriminator) and the chip token family
provides:
  - "Delta 3 status marker: a muted Badge on every non-published own row"
  - "Delta 4 honest pending chip: ONE derivation site, gated on isComputedAnalytics, with the absent-row status coercion that terminates the never-enqueued spinner"
  - "W-B SyncBadge render-site gate — an uncomputed owner row never claims 'Synced …' beside a Syncing chip"
  - "Delta 5: `PlaceholderKeyRow` type + `placeholderKeys` / `onFinishSetup` props and the unranked placeholder <tr>"
  - "StrategyTable.pending-chip.test.tsx — chip-state and placeholder falsifiers over REAL pipeline states"
affects: [149-04, 149-05, my-strategies]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Coerce the absent-row signal at the ONE derivation site, never at the render site — a hardcoded fallback status must not reach a state machine"
    - "Gate a data-state chip on 'has no computed metrics' (isComputedAnalytics), never on a nullable timestamp that live jobs also populate"
    - "A new branch is proved dead on public surfaces by the DATA it needs (a published-only row set) rather than by a second predicate that can drift"
    - "Placeholder rows pin their td count AGAINST the header th count — a column-drift falsifier, not a hand-counted literal"

key-files:
  created:
    - src/components/strategy/StrategyTable.pending-chip.test.tsx
  modified:
    - src/components/strategy/StrategyTable.tsx

key-decisions:
  - "Delta 3 carries NO visibility gate: a published-only row set can never contain a row the `status !== 'published'` branch fires on, so the branch is dead by the DATA. A second predicate would be one more thing that can drift from the first."
  - "Delta 4 and Delta 5 DO carry visibility/prop gates — those branches would otherwise fire on a published row awaiting a recompute (/discovery) or on a page that passes placeholder data."
  - "The 147 chip TOKENS are copied, not the CoverageStateChip component: importing an allocations-scoped component into the shared discovery table would drag a second chip vocabulary onto every public surface."
  - "Placeholder rows render an empty star <td> when `showStarColumn` is true (Rule 2) so the placeholder td count can never drift from the header th count in any configuration."

patterns-established:
  - "Vacuity guard: any spec whose assertions live inside a `for` loop asserts the collection length FIRST, or it passes green against an unimplemented feature"
  - "Pin BOTH dashes of a copy literal (en dash inside '10–15', em dash joining the aria-label clauses) as named constants in the spec"

requirements-completed: [NAV-01]

# Metrics
duration: 21 min
completed: 2026-08-05
---

# Phase 149 Plan 03: Owner row treatments (status marker, honest pending chip, placeholder rows) Summary

**The owner surface's three row treatments landed on the shared `StrategyTable`: a muted status marker on non-published own rows, an honest `Syncing`/`No data` chip derived from REAL pipeline states with the never-enqueued spinner terminated by the shared 16h bound, and unranked `bg-surface-subtle` placeholder rows for keys that produced no strategy — every one of them a dead branch on `/discovery` and `/browse`.**

## Performance

- **Duration:** ~21 min
- **Started:** 2026-08-05T14:58:00Z
- **Completed:** 2026-08-05T15:19:00Z
- **Tasks:** 2 (both TDD: RED observed before every GREEN)
- **Files modified:** 2 (1 created, 1 modified)

## Accomplishments

- **Closed the B-1/B-2 defect pair at its root.** The chip gates on `isComputedAnalytics(chipStatus)` and the status is coerced through `analyticsPresent === false`. Both halves are pinned by falsifiers that go red against the naive shape (see the RED output below).
- **Killed the "Synced … beside Syncing" contradiction (W-B)** without touching the `SyncBadge` component: its *render site* gained an owner-surface-only gate, and the public path stays unconditional.
- **Placeholder anatomy is pinned against the header, not against a hand-counted literal.** `placeholder td count === header th count` reddens if any column is ever added, instead of the placeholder rows silently misaligning.
- **Every new branch is provably dead on the public surfaces,** by three different mechanisms (dead by data, dead by `visibility`, dead by absent props) — each with its own invariance case that is green *before and after* the implementation.
- **Zero edits to `StrategyTable.test.tsx` and `StrategyTable.visibility.test.tsx`** — 43 pre-existing tests passing unchanged is itself the public-invariance proof.

## Task Commits

1. **Task 1: Delta 3 status marker + Delta 4 pending chip**
   - `4c0d8786` (test — RED spec)
   - `a7d2fbf9` (feat — implementation)
2. **Task 2: Delta 5 placeholder rows**
   - `47ebc026` (test — RED spec)
   - `b624c2e9` (feat — implementation)

**Plan metadata:** this SUMMARY (docs commit).

## Observed RED output (required by the plan)

**Task 1** — `npx vitest run src/components/strategy/StrategyTable.pending-chip.test.tsx --no-file-parallelism`, against the post-plan-01 source:

```
 × renders a muted 'Private' marker on a private row
 × renders a 'Draft' marker on a draft row
 × shows the amber Syncing chip for a LIVE job — the falsifier for any !computed_at gate
 × shows Syncing for a NEVER-ENQUEUED row inside the 16h window
 × shows 'No data' for a NEVER-ENQUEUED row PAST the 16h window (the B-1 falsifier)
 × shows a MUTED 'No data' chip for a failed job — never red, row still clickable

      Tests  6 failed | 4 passed (10)
```

The **4 passing** cases are the invariance half, green before *and* after: no marker on a published own row, no chip on a computed row, the W-C omitted-signal case (computed row keeps its `SyncBadge`), and the public-invariance case (the same live-job row under the DEFAULT recipe renders no chip and keeps its unconditional `SyncBadge`).

**Task 2** — the same file after the placeholder describe block was appended:

```
 × renders one subordinate placeholder row per bare key BELOW the ranked rows, outside #n numbering
 × W-1: a placeholder row's <td> count equals the header <th> count (column-drift falsifier)
 × names the key as '{exchange} · {label}' with NO factsheet link and a muted 'No strategy yet' chip
 × renders em-dash, untinted metric cells — never a fabricated zero
 × fires onFinishSetup exactly once from a real <button>, not a link into /strategies
 × a strategy-less account gets placeholders and NO misleading filter message
 × W-5: an active filter that matches nothing shows the message ABOVE the placeholders

      Tests  7 failed | 11 passed (18)
```

The remaining placeholder case ("with `placeholderKeys` omitted, zero subordinate rows render") is the invariance half and was green throughout.

After both implementations: **61/61 green** across the three StrategyTable spec files.

## The two chip defects, and what closes each

| Defect | The naive shape | Why it is wrong | What closes it |
|---|---|---|---|
| **B-2** (vacuous gate) | render the chip when `!s.analytics.computed_at` | A LIVE `pending`/`computing` row carries a `computed_at` **default**, so the gate never fires for the state it was written to catch. Simultaneously, `EMPTY_ANALYTICS.computed_at` is `""` (falsy), so every absent row stayed chip-eligible forever. | Gate on `!isComputedAnalytics(chipStatus)` — literally "this row has no computed metrics". |
| **B-1** (forever spinner) | feed `s.analytics.computation_status` raw to `deriveEmptySeriesState` | Plan 02's shaper substitutes `EMPTY_ANALYTICS` for an ABSENT `strategy_analytics` row, and that constant hardcodes `computation_status: "pending"`. A strategy whose job was never enqueued would therefore read as a live job and spin `Syncing` forever — the exact permanent-spinner class Phase 142 killed. | Coerce first: `analyticsPresent === false ? null : (computation_status ?? null)`. A null status routes into the 16h `MISSING_ROW_COMPUTING_WINDOW_MS` bound, which degrades to `No data`. |

`=== false` and not truthiness is load-bearing (W-C): the shared prop is **optional**, so an *omitted* field means "no signal — trust the raw status", and only the explicit absent-row `false` coerces. The owner path can never omit it (plan 04 types the section prop as `RankedStrategyRow[]`, where it is required). The W-C spec case pins this: a computed row built without the field renders no chip *and* keeps its `SyncBadge`.

A **stuck live pending row keeps `Syncing`** — deliberately. That is the phase-147 semantic ("a live job is authoritative; age is the reaper's problem") and it lives inside `deriveEmptySeriesState`, untouched here.

## Files Created/Modified

- `src/components/strategy/StrategyTable.pending-chip.test.tsx` **(created, 710 lines)** — Delta 3 marker cases (muted `Private`/`Draft`, never `text-negative`/`text-warning`, no marker on published); Delta 4 cases over five REAL pipeline states (live job, never-enqueued young, never-enqueued old, failed, computed) with literal copy/class assertions, `—` metric-cell assertions and `0.00`/`+0.0%` negative assertions; the W-B no-`Synced` assertion; the W-C omitted-signal case; the public-invariance case; and a Delta 5 describe block covering subordination, the td-count-vs-th-count anatomy, name/chip/no-link, untinted em-dash cells, the `onFinishSetup` click, the omitted-prop invariance, the true-empty interplay and the W-5 message-above-placeholders DOM ordering.
- `src/components/strategy/StrategyTable.tsx` **(modified)** — `isComputedAnalytics`/`deriveEmptySeriesState` imports; `analyticsPresent?: boolean` on the row prop type; the `DATA_STATE_CHIP` base constant (147 tokens verbatim); the ONE `chipStatus`/`chipState`/`hasComputedAnalytics` derivation in the row map; the Delta 3 `Badge type="status"` in the name cell's first line; the W-B `SyncBadge` render-site gate; the Delta 4 chip; `PlaceholderKeyRow` export; `placeholderKeys`/`onFinishSetup` props; `placeholders`/`showPlaceholders` derived outside the memo; the three-arm filter-empty condition; and the placeholder `<tr>` block.

## Decisions Made

1. **Delta 3 gets no `visibility` gate.** A `published-only` row set cannot contain a row that `status !== "published"` fires on, so the branch is dead by the *data*. Adding a second predicate would create a second thing that can drift from the first. Deltas 4 and 5 *do* carry gates because their branches would otherwise fire on legitimate public rows (a published row awaiting a recompute) or on data a public page might one day pass.
2. **Copy the 147 chip tokens, not the component.** `CoverageStateChip` lives under `(dashboard)/allocations`; importing it into the shared discovery table would put a second chip vocabulary into every public bundle. The `DATA_STATE_CHIP` constant carries the "do NOT harmonize `rounded-sm` vs the Badge's `rounded-md`" rationale inline, and the spec pins both `rounded-sm` and `text-fixed-11`.
3. **`SyncBadge` component untouched; only its render site gated.** The component is used elsewhere; the contradiction is a *composition* problem on one surface, so the fix belongs at the composition point.
4. **Placeholders derived outside `filtered`/`paged`/`rank`,** and rendered on the last page only (`page >= totalPages - 1`, which also covers `totalPages === 0` since `0 >= -1`). `#n`, `totalPages` and the "Showing 1–N of N" footer never read them.
5. **`emptyRowColSpan` left untouched** — placeholders render full td sequences, not a colSpan row.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing correctness guard] Placeholder rows render an empty star `<td>` when the star column is present**
- **Found during:** Task 2
- **Issue:** The plan specifies a fixed 13-td placeholder row ("no star column on this surface — userId/watchlist omitted"). That is true of the owner surface *today*, but the star column is driven by `showStarColumn = userId !== undefined`, a prop any future caller can set. A caller passing both `userId` and `placeholderKeys` would get 14-td ranked rows against 13-td placeholder rows — every placeholder column shifted one to the left, with the sticky name cell landing under the star header. The plan's own W-1 assertion (`placeholder td count === header th count`) is the falsifier for exactly this class, so leaving the row count unconditional would have shipped the defect the assertion was written to catch.
- **Fix:** `{showStarColumn && <td className="sticky left-14 z-10 w-11 bg-surface-subtle px-2 py-3 align-middle" />}`, and the name cell's sticky offset mirrors the ranked row's `showStarColumn ? "left-[6.25rem]" : "left-14"` ternary. Dead on the owner surface today (no `userId`), so the spec still sees exactly 13 tds.
- **Files modified:** `src/components/strategy/StrategyTable.tsx`
- **Verification:** the W-1 case asserts `cells(p).length === headerCount` and `headerCount === 13` under the no-`userId` recipe; all 61 tests green.
- **Committed in:** `b624c2e9`

### Non-code corrections to the plan's own gates

**2. The `deriveEmptySeriesState` done-criterion is unachievable as literally written**
- The plan's done criterion is `grep -c 'deriveEmptySeriesState' src/components/strategy/StrategyTable.tsx` → **exactly 1**. That count can never be 1: the `import` statement itself is one matching line, so the floor is 2 for any file that calls the function at all.
- The **intent** — stated in the plan's own `<interfaces>` block and again in the action step ("the plan-05 gate pins exactly one call in StrategyTable") — is one CALL SITE. The enforceable form is `grep -c 'deriveEmptySeriesState(' …` → **1** (the import line and any prose reference carry no open paren). That grep returns `1`, and `grep -c 'deriveEmptySeriesState'` returns `2` (import + call).
- **Action taken:** the row-map comment was reworded to reference "the shared 16h `MISSING_ROW_COMPUTING_WINDOW_MS` bound in closed-sets.ts" rather than repeating the identifier, so the un-parenthesised count is the minimum possible 2. **Plan 05 should use the `(`-suffixed form.**

**3. The `ContributionWizardOverlay` verification grep counts prose, not imports**
- `grep -c ContributionWizardOverlay src/components/strategy/StrategyTable.tsx` → 0 is the plan's requirement, and its stated purpose is "no new *import*". The two prop doc-comments initially named the overlay to explain *why* it is deliberately absent, which made the count 2 with zero imports.
- **Action taken:** both comments reworded to "the contribution wizard overlay" / "that overlay". The grep now returns **0** as required, the explanation survives, and there is (and was) no import.

---

**Total deviations:** 1 auto-fixed (Rule 2) + 2 plan-gate corrections
**Impact on plan:** None to scope. No file outside `files_modified` was touched. Every plan-time claim verified against source during execution held: the `:726-748` name-cell slots, `SyncBadge.tsx:28`'s null return, `EMPTY_ANALYTICS`'s `computation_status: "pending"` / `computed_at: ""`, the `makeStrategy` factory clobber (checker I-1 — the clone applies analytics overrides after the spread), and the 13-column header count.

## Issues Encountered

None blocking. Two notes:

- The RED runs pass cleanly under vitest even though `placeholderKeys` / `onFinishSetup` / `analyticsPresent` were not yet declared props — esbuild transforms without type-checking, so the TS errors do not block the RED observation. `npx tsc --noEmit` was run after each GREEN and is clean.
- Two placeholder cases initially passed **vacuously** (their assertions live inside `for … of placeholderRows()` loops, which iterate zero times when the feature does not exist). Both gained an explicit `expect(placeholderRows()).toHaveLength(2)` guard *before* the RED commit, which moved them from green-4 to red-7. A loop-bodied assertion without a length guard is not a falsifier.
- `node_modules` was absent in the worktree and was symlinked to the main repo's install — no package manager was run, zero packages installed (threat register T-149-SC).

## Verification Results

| Check | Result |
|---|---|
| `npx vitest run StrategyTable.pending-chip.test.tsx StrategyTable.visibility.test.tsx StrategyTable.test.tsx --no-file-parallelism` | **61 passed / 61** (3 files) |
| `npx vitest run src/components/strategy --no-file-parallelism` | **362 passed / 362** (34 files) |
| `npx tsc --noEmit` | clean |
| `npx eslint` on both touched files | clean |
| `grep -c 'deriveEmptySeriesState(' StrategyTable.tsx` | `1` — exactly one call site (see deviation 2) |
| `grep -c ContributionWizardOverlay StrategyTable.tsx` | `0` |
| `grep -n 'placeholderKeys' '(dashboard)/discovery/[slug]/page.tsx' 'browse/[slug]/page.tsx'` | **0 hits** |
| `git diff` inside the `filtered` useMemo | **empty** — every delta is render-layer; the derivations and the filter-empty condition edit are outside the memo |
| commit deletion check (`--diff-filter=D`) on all 4 commits | none |
| `git status --short` after each commit | clean |

## Threat Flags

None. No new network endpoint, auth path, file-access pattern or schema change. The three registered mitigations are implemented as specified:

- **T-149-08** (placeholder rows on public surfaces) — `placeholderKeys` is a prop the public pages do not pass; asserted by the omitted-prop invariance case and by the 0-hit page grep. The data itself is the session owner's own keys, formatted server-side in plan 04.
- **T-149-09** (chip leaking compute state to anon) — the chip branch is gated on `visibility === "owner-all-statuses"`; the public-invariance case renders the SAME live-job row under the default recipe and asserts no chip.
- **T-149-10** (invented data / dishonest state) — em-dash literal assertions plus "never `0.00`/`+0.0%`" negative assertions on both the pending rows and the placeholder rows; the `analyticsPresent` coercion + the 16h bound kill the permanent-`Syncing` misstate.
- **T-149-SC** — zero packages installed.

## Known Stubs

None. The one deliberately-unwired seam is `onFinishSetup`, which opens the wizard **FRESH** rather than with the key preselected — `ContributionWizardOverlay` has no preselect seam today. That is a binding plan ruling, not a stub: the button is fully functional (the spec pins that it fires exactly once from a real `<button>`), and the preselect follow-up is routed to TODOS.md in plan 05.

Both `placeholderKeys` and `onFinishSetup` have no production consumer yet **by design** — plan 04's `MyStrategiesSection` supplies them. Until then they are exercised only by this spec, and every existing call site continues to pass neither.

## Next Phase Readiness

Exact contracts for **plan 04**:

```tsx
export type PlaceholderKeyRow = { id: string; exchangeLabel: string; keyLabel: string };

<StrategyTable
  strategies={ownRows}              // RankedStrategyRow[] — analyticsPresent REQUIRED there (W-C)
  visibility="owner-all-statuses"
  placeholderKeys={bareKeys}        // server-formatted: EXCHANGE_DISPLAY applied upstream
  onFinishSetup={openWizard}        // client→client; opens the wizard fresh
  categorySlug={…}
  percentiles={ownMap}
/>
```

- `exchangeLabel` must be **display-formatted server-side** — this component renders it verbatim.
- Do NOT pass `userId` on the owner surface unless the watchlist is genuinely wanted there; the star column is supported by the placeholder rows but changes the column count.
- For **plan 05's structural gate**: use `grep -c 'deriveEmptySeriesState(' src/components/strategy/StrategyTable.tsx` → `1` (the `(`-suffixed form; see deviation 2), `grep -c ContributionWizardOverlay …` → `0`, and the absence of `placeholderKeys=` / `visibility=` under `src/app/(dashboard)/discovery` and `src/app/browse`.
- **Carry to plan 05 / TODOS.md:** the `ContributionWizardOverlay` preselect seam (Delta 5's "Finish setup →" currently opens the wizard fresh rather than with the key preselected).

## Self-Check: PASSED

- `src/components/strategy/StrategyTable.pending-chip.test.tsx` exists on disk (710 lines; `min_lines: 80` satisfied).
- `src/components/strategy/StrategyTable.tsx` exists and contains the `must_haves.artifacts.contains` literal `placeholderKeys`.
- All four task commits found in `git log`: `4c0d8786`, `a7d2fbf9`, `47ebc026`, `b624c2e9`.
- All three `must_haves.key_links` verified in source: the ONE `deriveEmptySeriesState(chipStatus, s.created_at ?? null)` call fed the COERCED status; the chip gate reading `isComputedAnalytics`; and `onClick={onFinishSetup}` on the placeholder Actions-cell button.

---
*Phase: 149-nav-my-strategies-a-ranking-at-discovery-parity*
*Completed: 2026-08-05*
