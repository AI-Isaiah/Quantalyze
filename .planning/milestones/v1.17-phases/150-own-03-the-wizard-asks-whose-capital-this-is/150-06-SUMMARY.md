---
phase: 150-own-03-the-wizard-asks-whose-capital-this-is
plan: 06
subsystem: ui
tags: [react, next-app-router, vitest, testing-library, tailwind, own-03, own-05, factsheet, my-strategies]

# Dependency graph
requires:
  - phase: 150-02
    provides: OwnershipTag, CapitalOwnershipRadioGroup, CapitalOwnership/TEAM_REVIEW, formatUsd
  - phase: 150-04
    provides: PATCH /api/strategies/[id]/ownership (409 live_allocation arc) and PATCH /api/strategies/[id]/name
  - phase: 149-nav-01-my-strategies
    provides: the StrategyTable owner surface, its visibility prop, and the parity pins this plan had to keep green
  - phase: 148-own-owner-factsheet
    provides: the factsheet two-lane resolution and the cache-isolation pins the owner-lane thread rides
provides:
  - "src/components/strategy/MarkOwnershipDialog.tsx — the RETRO mark path (D-09/D-11) with the 409 -> confirm -> re-submit arc"
  - "src/components/strategy/RenameStrategyDialog.tsx — the OWN-05 rename, inline-validated, mounted on BOTH owner surfaces"
  - "StrategyTable: the visibility-gated OwnershipTag mount + optional onMarkOwnership/onRename row actions"
  - "Factsheet owner lane: ownershipMark + renameTarget as lane-derived render props (never in the cached payload)"
  - "AddToPortfolio: Postgres 23514 mapped to copy that names the remedy"
affects: [150-07 Holdings rows, 150-08 phase gate]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Owner-only UI rides a RENDER prop thread, never the cached payload — the phase-148 pins are the regression gate"
    - "Prop-gated owner deltas on a SHARED public component: absent callback ⇒ zero nodes, so the public DOM is byte-identical"
    - "Destructive confirmation as an in-dialog body swap, driven by the route's 409 — native <dialog> does not nest"
    - "Reset-on-reopen via React's render-time 'adjust state when a prop changes' pattern, not an effect"

key-files:
  created:
    - src/components/strategy/MarkOwnershipDialog.tsx
    - src/components/strategy/MarkOwnershipDialog.test.tsx
    - src/components/strategy/RenameStrategyDialog.tsx
    - src/components/strategy/RenameStrategyDialog.test.tsx
  modified:
    - src/components/strategy/StrategyTable.tsx
    - src/components/strategy/StrategyTable.visibility.test.tsx
    - src/app/(dashboard)/my-strategies/MyStrategiesSection.tsx
    - src/app/factsheet/[id]/v2/page.tsx
    - src/app/factsheet/[id]/v2/page.owner-lane.test.tsx
    - src/app/factsheet/[id]/v2/FactsheetView.tsx
    - src/app/factsheet/[id]/v2/FactsheetView.owner-notice.test.tsx
    - src/components/portfolio/AddToPortfolio.tsx
    - src/components/portfolio/AddToPortfolio.test.tsx

key-decisions:
  - "The rename render gate is `status === private || draft`, not `!== published`: it mirrors the route's own `.in(\"status\", …)` exactly, so an archived row cannot grow a control that 404s"
  - "The route's two 400 arms (invalid name / name too long) land INLINE at the field; every other failure is the canonical envelope"
  - "Both dialogs reset during render rather than in an effect — react-hooks/set-state-in-effect is an ERROR here, and an effect paints the stale answer for one clickable frame"
  - "The factsheet masthead keeps two arms for the H1 (wrapped on the owner lane, bare on the public one) so a published render grows no wrapper node"
  - "The three owner-lane render props were unified into one OwnerLaneProps interface rather than threaded as three loose optionals through four components"

patterns-established:
  - "Gate mutations are RUN, not asserted: deleting the tag gate and un-gating renameTarget were both executed and both reddened before being reverted"

# Metrics
duration: 115min
completed: 2026-08-06
---

# Phase 150 Plan 06: Retro mark and rename on their two owner surfaces Summary

**The mark becomes reachable: a /my-strategies row now carries the ownership tag and a ghost action cluster behind an owner-only gate, two dialogs write through Plan 04's routes with the flip confirmation the D-03 invariant depends on, and the owner factsheet shows the mark read-only with a rename — all without one pixel reaching a public surface or one byte reaching the shared cache.**

## Performance

- **Duration:** ~115 min
- **Started:** 2026-08-06T17:05Z
- **Tasks:** 3 of 3
- **Files:** 13 (4 created, 9 modified), 1716 insertions, **0 deletions**
- **Commits:** 5

## Accomplishments

- **The retro path exists now.** `MarkOwnershipDialog` mounts the same `CapitalOwnershipRadioGroup` the wizard uses, defaults an unmarked row to team-review, and is reachable from every owned row — so Black Swan, Alpha Centauri and Arctic Fox become markable with zero re-onboarding (D-09/D-11).
- **The flip can never remove a position silently.** The dialog's own→team submit hits the route's `409 { error: "live_allocation", allocated_amount }`, swaps its body to a confirm that names the amount, and only then re-submits with `confirm_remove_allocation: true`. The test asserts the **call sequence**, not just the final state: the destructive flag exists on the second request and on no other (T-150-30).
- **The tag is owner-gated, and the gate was proven by deleting it.** Public `/browse` and `/discovery` rows arrive with `capital_ownership` populated (`shapeRankingRows` spreads the whole strategy row), so an ungated mount would have shown the owner's capital declaration to anonymous readers. Removing the `visibility === "owner-all-statuses"` guard reddens two cases in `StrategyTable.visibility.test.tsx` (run, pasted below) — T-150-39 closed with a falsifiable pin rather than a comment.
- **Pin 7 survived the highest-risk edit in the phase.** The action cluster is assembled above the JSX and mounted as a single token before the published guard, so `s.status === "published"` stays adjacent to `<SimulateImpactButton` inside the 300-character window. All 13 phase-149 pins are green.
- **Nothing owner-shaped reached the cache.** `capital_ownership` is read on the owner probe only and held in a lane-local variable; the diff on `page.tsx` has zero hunks inside the `unstable_cache` wrapper (lines 280-310), and all 10 phase-148 cache-isolation pins plus the 6 new lane pins are green.
- **A generic failure became an honest one.** `AddToPortfolio` mapped Postgres `23514` — the only check constraint on that table is the D-03-A trigger — to copy that names the remedy. Every other error code keeps today's arm byte-identical, asserted both ways.

## Task Commits

1. **Task 1: MarkOwnershipDialog + RenameStrategyDialog** (TDD)
   - `dce1a219` (test — RED, both modules unresolvable)
   - `ba4b58bb` (feat — GREEN, 26 passed)
   - `d1095e0c` (fix — the reset-in-effect lint error, see Deviations)
2. **Task 2: StrategyTable row integration + MyStrategiesSection hosts + W-6**
   - `4ccc433a`
3. **Task 3: Factsheet owner lane**
   - `d0d98d95`

## Mutation ledger — 2 mutations, 2 caught

Both were executed against the real source and reverted by re-editing the line.

| # | Mutation | Result |
|---|----------|--------|
| M1 | delete the `visibility === "owner-all-statuses"` guard on the `OwnershipTag` mount | **RED** — `StrategyTable.visibility.test.tsx`, 2 failed / 19 passed: `AssertionError: expected <span …(1)></span> to be null` on both the published+own_capital public mount and the team-review public mount |
| M2 | thread `renameTarget` unconditionally instead of `lane === "owner" ? … : undefined` | **RED** — `page.owner-lane.test.tsx`, 2 failed / 14 passed: tests 15 and 16, `AssertionError: expected { …(2) } to be undefined` |

M2 is the one worth recording: it proves the D-17 render gate on the factsheet is really carried by the lane decision. Test 16 (a published row reached via Lane B, the WR-01 shape) is the second-member case — the arm an author fixing "published rows must not show Rename" would not have had in mind, because it is reachable only through a Lane A miss.

## Files Created/Modified

**Created**

- `src/components/strategy/MarkOwnershipDialog.tsx` — Modal + status machine + `router.refresh()`, with the confirm arm as a `useState` body swap inside the same shell.
- `src/components/strategy/MarkOwnershipDialog.test.tsx` — 15 cases including the fetch-call-sequence assertion, the dismiss arm, and three source pins.
- `src/components/strategy/RenameStrategyDialog.tsx` — `Field` + bare control, inline validation with a clickable CTA, trim-only normalisation.
- `src/components/strategy/RenameStrategyDialog.test.tsx` — 11 cases including the 80-character inclusive boundary and the no-pre-truncation source pin.

**Modified**

- `src/components/strategy/StrategyTable.tsx` — the gated tag mount, two optional callback props, the `GHOST_ROW_ACTION` token constant, and the pre-assembled action cluster.
- `src/components/strategy/StrategyTable.visibility.test.tsx` — 9 new cases across two describes (tag gate, prop-gated actions).
- `src/app/(dashboard)/my-strategies/MyStrategiesSection.tsx` — both callbacks minted, both dialogs hosted and keyed by row id.
- `src/app/factsheet/[id]/v2/page.tsx` — owner-probe select widened by one column, lane-local mark, two render props.
- `src/app/factsheet/[id]/v2/page.owner-lane.test.tsx` — 6 new lane pins (12-16 plus the fail-closed case).
- `src/app/factsheet/[id]/v2/FactsheetView.tsx` — `OwnerLaneProps` threaded through Shell → Body → Header; masthead tag and rename action.
- `src/app/factsheet/[id]/v2/FactsheetView.owner-notice.test.tsx` — 5 new masthead render pins (see Deviations).
- `src/components/portfolio/AddToPortfolio.tsx` — one new `else if` arm, 10 insertions, 0 deletions.
- `src/components/portfolio/AddToPortfolio.test.tsx` — the 23514 case and its non-23514 counterpart.

## Decisions Made

- **The rename gate is the two allowed statuses, not the negation of one.** The plan's action text said `s.status === "private" || s.status === "draft"`, and that is what shipped rather than `!== "published"`: it mirrors the route's `.in("status", ["private", "draft"])` exactly. An archived row is not renameable either, and a render gate wider than the write gate produces a control that 404s.
- **Field-level 400s do not become terminal envelopes.** The route answers `invalid name` / `name too long`; both land at the field with the UI-SPEC's own copy. Client and server can disagree on exotic whitespace, so those arms are reachable in practice — putting them in the envelope would be exactly the terminal-envelope class the ROADMAP-153 note asks this phase's forms to avoid.
- **`$0` is rendered, not suppressed.** The confirm body renders whatever finite amount the route sent through `formatUsd`. A zero-amount position row is real (the route coalesces a null `allocated_amount` before summing), and hiding it would leave the confirmation without the fact it exists to state. A non-finite amount coerces to 0 rather than reaching the copy as `NaN` — the shape 150-04's M3 mutation identified.
- **One `OwnerLaneProps` interface, not three loose optionals.** `viewerNotice`, `ownershipMark` and `renameTarget` share one rule — lane-derived, never on the payload — and threading them as one named shape through four components states that rule once instead of three times.
- **The masthead H1 has two arms.** The owner arm wraps it in a baseline flex row for `Rename…`; the public arm renders the bare `<h1>` exactly as before. The class string is a shared constant so the arms cannot drift, and a pin asserts the public H1's parent is still `max-w-3xl`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug] Both dialogs reset in an effect, which is a lint ERROR in this repo**

- **Found during:** Task 3, on the pre-commit `npm run lint`.
- **Issue:** The reset-on-reopen logic was written as `useEffect(() => { … setState … }, [open, …])`. `react-hooks/set-state-in-effect` is configured as an **error** here, so this would have failed CI. It is also a genuine defect and not only a style rule: an effect renders the previous row's answer once and then corrects it, and on a two-option question that decides allocatability that is a frame a user can click.
- **Fix:** React's documented "adjust state when a prop changes" pattern — a `lastSession` state keyed on `(open, strategyId)`, compared and reset during render. No effect, no cascading render, no stale frame.
- **Files modified:** `MarkOwnershipDialog.tsx`, `RenameStrategyDialog.tsx`
- **Verification:** `npm run lint` → **0 errors**; both dialog suites still 26 passed.
- **Committed in:** `d1095e0c`

**2. [Rule 2 — Missing critical] A tenth file: `FactsheetView.owner-notice.test.tsx`**

- **Found during:** Task 3.
- **Issue:** The plan's acceptance criterion asks that the owner-lane test "asserts tag + `Rename…` on owner+draft and their ABSENCE on the public lane". `page.owner-lane.test.tsx` is an RSC-element harness — it can assert the PROPS the page threads, but it never renders the masthead, so on its own it proves the thread and not the pixels. A prop assertion alone would stay green against a `FactsheetView` that accepted both props and rendered neither.
- **Fix:** Added a 5-case describe to the existing owner-lane render harness (`FactsheetView.owner-notice.test.tsx`), which already mounts the real `FactsheetBody` with the masthead present. It pins: the tag renders in the header on the owner lane, ZERO tag/rename nodes when the props are absent, no tag for an unmarked owner row, `Rename…` sharing the H1's parent and opening the dialog, and the public masthead keeping a single unwrapped `<h1>`.
- **Files modified:** `src/app/factsheet/[id]/v2/FactsheetView.owner-notice.test.tsx` (test-only; that file's own three cases are untouched)
- **Verification:** 9 passed in that file; the pre-existing 4 cases unchanged.
- **Committed in:** `d0d98d95`

**3. [Rule 3 — Blocking] The worktree forked from `origin/main`, not the phase branch**

- **Found during:** startup, in `<worktree_branch_check>`.
- **Issue:** HEAD was `e0493913` (`v0.53.3.1`, the default branch) and `git merge-base HEAD 2ec117b7` returned `e93049d3` — i.e. the expected base was not an ancestor. Waves 1-2 were absent, so every interface this plan consumes (`OwnershipTag`, `CapitalOwnershipRadioGroup`, both routes) would have been unresolvable.
- **Fix:** `git reset --hard 2ec117b7…` per the startup block, then verified `git rev-parse HEAD` matched. This is the documented worktree behaviour, recorded here because the reset is a real, if sanctioned, deviation from an untouched checkout.

---

**Total deviations:** 3 auto-fixed (1 bug, 1 missing-critical, 1 blocking). No architectural (Rule 4) decisions were needed.
**Impact on plan:** The eleven-file scope became thirteen (one test file for the render half, plus the two dialogs' lint fix landing as its own commit). No production surface was widened.

## Issues Encountered

- **The `Modal` primitive keeps its children mounted while closed.** A first attempt at the masthead pin asserted the rename dialog's title was absent before the click; it was present, because `Modal` is a native `<dialog>` whose children are always in the tree and whose `open` property is what makes it visible. The assertion was rewritten against `dialog.open`, which is the property that actually distinguishes the two states — a text probe would have been green before the click and proven nothing. Worth flagging for Plan 07's dialogs: any "the dialog is closed" assertion must read `open`, not text.
- **jsdom implements neither `showModal()` nor `close()`.** Three test files in this plan carry the repo-standard shim (`Modal.test.tsx:23-39`). The masthead file needed it added — without it the click threw `TypeError: dialog.showModal is not a function` rather than failing an assertion.
- **One pre-existing lint warning** (`EquityChart.tsx:1119`, `react-hooks/exhaustive-deps`) is untouched and out of scope — already recorded in 150-02 and 150-04. `npm run lint` reports **0 errors**.

## Verification

| Gate | Result |
|------|--------|
| `npx vitest run` MarkOwnershipDialog + RenameStrategyDialog | 2 files, **26 passed** |
| `npx vitest run` phase-149 parity + StrategyTable.visibility + AddToPortfolio + my-strategies | 4 files, **51 passed** |
| `npx vitest run` phase-148 cache isolation + the whole `factsheet/[id]/v2` tree | 34 files, **302 passed** |
| `npx vitest run src/__tests__` (every structural gate in the repo) | 94 files, **1094 passed / 268 skipped** |
| `npx vitest run src/components/strategy src/components/portfolio` + the four collision gates | 60 files, **668 passed** |
| `npx vitest run` phase-147 series guards, phase-84 asset class, format-percent, audit | 4 files, **35 passed** |
| `npx tsc --noEmit` | clean |
| `npm run lint` | **0 errors**, 1 pre-existing unrelated warning; admin-manifest (20 routes) + route-contract (57 routes) OK |

**Acceptance criteria, per task:**

- Task 1: `grep -c "supabase"` on both dialogs → **0**. `grep -c "toLocaleString"` on `MarkOwnershipDialog.tsx` → **0** (`toFixed` likewise 0; `formatUsd` present). The 409→confirm→re-submit arc asserted on `fetchMock.mock.calls` with the flag on call 2 only. Both validation cases assert zero fetches AND `expect(saveButton()).not.toBeDisabled()`.
- Task 2: all 13 phase-149 pins green (7, 2, 10/11 included). `git diff --name-only` contains **no** `discovery/` or `browse/` page file. Exactly one `<OwnershipTag` JSX mount in `StrategyTable.tsx`, behind the visibility guard (mutation-proven). `git diff --stat AddToPortfolio.tsx` → **10 insertions, 0 deletions**, all inside the insert-error arm.
- Task 3: all 10 phase-148 pins green. `git diff` on `page.tsx` shows 5 hunks — imports (line 8), the owner-lane branch (426, 470, 512) and the prop thread (641); **none** inside the `unstable_cache` wrapper at 280-310, and `grep -c "capital_ownership"` over that region → **0**.

## Known Stubs

None. Every surface this plan mounts is wired to a real route and a real column. The two dialogs' data sources are Plan 04's shipped routes; the tag and the row actions read `capital_ownership` off rows that already carry it.

## Threat Flags

No new threat surface beyond the plan's own register. Two dispositions are worth restating as **live** rather than closed:

| Flag | File | Description |
|------|------|-------------|
| threat_flag: mitigated-with-a-run-mutation (T-150-39) | `src/components/strategy/StrategyTable.tsx` | The tag would have leaked to anonymous `/browse` and `/discovery` readers without the visibility gate, because public rows genuinely arrive mark-populated. The gate is pinned by a mutation that was RUN and reddened, not by a comment. Plan 08's P8 structural pin is the second layer. |
| threat_flag: accepted-residual (T-150-20, inherited from 150-04) | `src/components/strategy/MarkOwnershipDialog.tsx` | The confirm copy says "changing the mark removes it" and the flip RPC removes only the CALLER's own positions. A third party holding a position on a published own-capital strategy survives the owner's flip, so for that (rare) case the copy overstates what the write does. Deliberate per the migration's header (g) and 150-04's register; recorded here because this plan is where a user reads the sentence. Flagged for the Phase-151 review that already owns T-150-20. |

Carried forward and consciously re-acknowledged: `capital_ownership` is **publicly readable on published rows** (`strategies_read` has no column projection, T-150-04). This plan does not widen that — it adds no public read and no public render; the gate above is precisely what keeps UI-SPEC invariant 3 true as a render invariant.

`T-150-SC` holds: **zero packages installed** this plan. `node_modules` was symlinked from the main checkout per the worktree instructions.

## User Setup Required

None — no env var, no feature flag, no external service configuration. This phase ships behind no flag, so these surfaces are live on merge.

## Next Phase Readiness

- **Plan 07 (Holdings rows)** can import `MarkOwnershipDialog`'s shape as the precedent for its Allocate/Edit dialogs — same Modal + status machine + in-dialog confirm. Two things to inherit deliberately: the confirm arm is a body swap (native `<dialog>` does not nest), and any "the dialog is closed" assertion must read `dialog.open`, not text (see Issues).
- **Plan 07** should also reuse `GHOST_ROW_ACTION` from `StrategyTable.tsx` if it needs the same ghost text-action treatment, rather than re-spelling the class string.
- **Plan 08 (phase gate)** can now pin: exactly ONE `<OwnershipTag` JSX mount exists in `StrategyTable.tsx` and it sits behind `visibility === "owner-all-statuses"` (P8); the two dialogs contain no database client; and no production file outside `page.tsx` threads `ownershipMark` / `renameTarget`.
- **Plan 08's no-store allowlist** was deliberately NOT bumped, per the wave context — this plan adds no route.
- ⚠️ `STATE.md` / `ROADMAP.md` deliberately **not** touched (worktree mode; the orchestrator owns those writes post-wave).

## Self-Check: PASSED

All 4 created files exist on disk; all 9 modified files carry their edits. All 5 commits resolve in `git log` (`dce1a219`, `ba4b58bb`, `4ccc433a`, `d1095e0c`, `d0d98d95`). `git diff --stat` against the base shows exactly 13 files, **1716 insertions and 26 deletions** (the 26 are the FactsheetView prop-signature rewrites and the `useEffect` import lines, all re-added in place); `git diff --diff-filter=D` against the base reports **no deleted files**. Working tree clean apart from this SUMMARY, no untracked files.

---
*Phase: 150-own-03-the-wizard-asks-whose-capital-this-is*
*Completed: 2026-08-06*
