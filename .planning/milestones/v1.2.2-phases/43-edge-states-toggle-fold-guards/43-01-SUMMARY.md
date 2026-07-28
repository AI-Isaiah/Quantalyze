---
phase: 43-edge-states-toggle-fold-guards
plan: 01
subsystem: ui
tags: [react, tailwind-v4, factsheet, scenario-composer, design-tokens, byte-identity, collapsible-section]

# Dependency graph
requires:
  - phase: 38-scenario-tab-hardening
    provides: ScenarioFactsheetChart body mount (FactsheetBody under persist={false}); additive scenarioMode prop on FactsheetBody/ControlBar/MetricsColumn
  - phase: 37-per-source-toggle
    provides: the Data-sources include/exclude role=group controls + includeByApiKeyId channel
  - phase: 41-diversification
    provides: the Diversification CollapsibleSection + too-similar badge + PCR risk-reducing tag
  - phase: 42-mandate-peer
    provides: ConstituentMandatePanel (MandatePanels.tsx) leverage chip
provides:
  - "GUARD-01 fold: the Phase-37 Data-sources toggle reads as a factsheet-shaped CollapsibleSection sibling around the body mount (compose + read on one surface)"
  - "Additive scenarioMode prop on FactsheetFooter — page-stamp gated only in scenarioMode; real /factsheet/[id]/v2 route byte-identical"
  - "Formalized --color-text / --color-text-2 @theme inline light-mode tokens (border-text/text-text-2 resolve correctly without class repointing)"
  - "Six accumulated P40/41/42 UI-review polish carry-forwards landed additively/byte-safely"
affects: [43-02-guard-02-byte-identity, 43-03-guard-03-axe-guard-04-bleed, milestone-v1.2.2-close]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Factsheet-shaped fold: wrap existing controls in Card + CollapsibleSection (Diversification precedent), storageKey deliberately omitted (GUARD-04)"
    - "Additive prop defaulting false → byte-identical real route (the scenarioMode pattern, GUARD-02-pinnable)"
    - "@theme inline token formalization over live-class repointing — fix CSS resolution while keeping the class string byte-identical"

key-files:
  created: []
  modified:
    - "src/app/(dashboard)/allocations/components/ScenarioComposer.tsx"
    - "src/app/factsheet/[id]/v2/FactsheetView.tsx"
    - "src/app/factsheet/[id]/v2/MandatePanels.tsx"
    - "src/app/globals.css"
    - "src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx"
    - "src/app/factsheet/[id]/v2/FactsheetBody.scenario-mode.test.tsx"
    - "src/app/factsheet/[id]/v2/MandatePanels.scenario.test.tsx"

key-decisions:
  - "Data-sources fold wraps the EXISTING role=group controls in Card + CollapsibleSection (mirrors Diversification :2601); per-key switch rows verbatim, no redesign; storageKey omitted (GUARD-04)"
  - "FactsheetFooter scenarioMode additive (default false) gates ONLY the 'Page 1 / 1' <p>; disclaimer + footer class string unconditional → real route byte-identical (GUARD-02 pins it)"
  - "--color-text = #CBD5E1 (editorial divider rule, one step stronger than --color-border #E2E8F0, mirroring the dark override #3D4661 sitting one stop above border-border #2A3144); --color-text-2 = #4A5568 (= text-secondary, exactly matching the dark override which equals dark text-secondary)"
  - "Mount-seam: composer wrapper mt-6 → mt-0 so the factsheet article's own responsive top padding (py-6/10/12) is the SINGLE seam gap — composer-side only, factsheet article class untouched"
  - "h3 type-contract item (e) was a no-op by construction: the new factsheet-shaped sections render their titles via the shared CollapsibleSection <h2> and span-based sub-labels; the only tracking-wider <h3>s are PRE-EXISTING Phase-30 cards which the plan explicitly excludes from churn"
  - "PCR-tag-decorative-bar (bg-positive at line 2754) left as-is — the plan scoped only the TAG token swap, not the separate hedge-bar fill"

patterns-established:
  - "Comment hygiene under static guards: a literal 'FactsheetBody' in even a CODE COMMENT trips the grep -c == 0 static guard — refer to 'the factsheet <article>' lowercase, never the component literal, in ScenarioComposer.tsx"

requirements-completed: [GUARD-01]

# Metrics
duration: 30min
completed: 2026-06-26
---

# Phase 43 Plan 01: Edge states, toggle fold & guards (GUARD-01) Summary

**Folded the Phase-37 Data-sources toggle into a factsheet-shaped CollapsibleSection sibling and landed all seven accumulated P40/41/42 UI-review polish carry-forwards (scenarioMode-gated footer stamp, warning/accent token swaps, 1× leverage-chip guard, formalized --color-text/-2 @theme tokens, normalized seam padding) — every change additive or byte-identity-preserving, with scenario.ts frozen (zero-diff) and the FactsheetBody static guard intact.**

## Performance

- **Duration:** ~30 min
- **Started:** 2026-06-26T16:58:00Z
- **Completed:** 2026-06-26T17:10:00Z
- **Tasks:** 3
- **Files modified:** 7 (4 source, 3 test)

## Accomplishments
- GUARD-01 fold: the Data-sources include/exclude controls now read as a factsheet-shaped `Card` + `CollapsibleSection` sibling with Diversification + Strategies-&-weights — compose + read on one surface, controls repositioned verbatim (no redesign), `storageKey` deliberately omitted.
- Additive `scenarioMode` on `FactsheetFooter` — the "Page 1 / 1" print-stamp is suppressed on the composer mount (`scenarioMode={true}`) while the disclaimer stays; the real `/factsheet/[id]/v2` route stays byte-identical at default false (the `FactsheetBody.scenario-mode.test.tsx` innerHTML-equality test holds, proving the stamp is still present at default).
- Six polish carry-forwards: too-similar badge hex → `bg-warning-bg border-warning-border`; risk-reducing PCR tag `bg-positive/10 text-positive` → `bg-accent/10 text-accent` (neutral, no P&L-green connotation); `1×` leverage chip suppressed (`c.leverage > 1`, mutation-verified falsifiable); `--color-text`/`--color-text-2` `@theme inline` light-mode tokens formalized (no live-class repointing); seam padding compensated composer-side; h3-contract confirmed already-conformant.
- Invariants held: `grep -c FactsheetBody ScenarioComposer.tsx == 0`; `git diff src/lib/scenario.ts` empty (FROZEN); all 5 frozen-spine guard files (39 tests) green; full `src/app/factsheet/[id]/v2/` + `src/app/(dashboard)/allocations/` suite = 101 files / 1215 tests green; tsc clean; eslint 0 errors on touched files.

## Task Commits

Each task was committed atomically:

1. **Task 1: Fold the Data-sources toggle into a factsheet-shaped CollapsibleSection** - `3cb0bf01` (feat)
2. **Task 2: scenarioMode-gate the footer page-stamp (TDD)** - `26c2358b` (test, RED) → `675ba6b7` (feat, GREEN)
3. **Task 3: Token swaps + leverage guard + @theme tokens + seam padding** - `c9474db1` (feat)

_Task 2 followed the RED→GREEN TDD cycle: the failing footer-stamp assertion committed first (`26c2358b`), then the additive `scenarioMode` implementation (`675ba6b7`). No REFACTOR commit needed (implementation minimal)._

## Files Created/Modified
- `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx` - Data-sources `role=group` repositioned into `Card` + `CollapsibleSection`; badge + PCR-tag token swaps; seam wrapper `mt-6`→`mt-0`
- `src/app/factsheet/[id]/v2/FactsheetView.tsx` - `FactsheetFooter` takes additive `scenarioMode?: boolean` (default false); page-stamp `<p>` gated; threaded from the `FactsheetBody` call site
- `src/app/factsheet/[id]/v2/MandatePanels.tsx` - leverage chip guarded by `c.leverage > 1`
- `src/app/globals.css` - `--color-text` (#CBD5E1) / `--color-text-2` (#4A5568) light-mode `@theme inline` entries
- `src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx` - PCR-tag assertion updated `text-positive` → `text-accent`
- `src/app/factsheet/[id]/v2/FactsheetBody.scenario-mode.test.tsx` - extended with footer-stamp suppression + present-at-false assertions (RED→GREEN)
- `src/app/factsheet/[id]/v2/MandatePanels.scenario.test.tsx` - new falsifiable `1×`-suppression guard test (populated-but-1× constituent suppresses chip; >1× renders)

## Decisions Made
- **Data-sources fold container:** a new `Card` + `CollapsibleSection` (Diversification :2601 precedent), reusing the existing per-key `role="switch"` rows verbatim. `storageKey` omitted on purpose (GUARD-04 — no new persisted key on the composer surface).
- **Footer scenarioMode additive default false** so every existing call site (page.tsx, Discovery, Overview EquityChartWidget — none pass scenarioMode) renders identical HTML; only the composer mount (which threads `scenarioMode={true}`) hides the stamp.
- **--color-text / --color-text-2 values** derived from the dark-mode override intent: `text-text-2` dark equals dark `text-text-secondary` → light = `--color-text-secondary` #4A5568; `border-text` dark #3D4661 is one stop above `border-border` dark #2A3144 → light = #CBD5E1 (slate-300), one stop above `--color-border` #E2E8F0 (slate-200). Editorial rule, not near-black; no live-class repointing (byte-identity preserved).
- **Seam fix** = composer wrapper `mt-6` → `mt-0`; the factsheet `<article>`'s own responsive top padding becomes the single seam gap. The factsheet article class (`py-6 sm:py-10 lg:py-12`) is untouched.
- **h3 contract (item e)** is a no-op by construction (see Issues Encountered) — the new factsheet-shaped sections already conform via the shared `CollapsibleSection <h2>` + span sub-labels.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] A literal "FactsheetBody" in a new code COMMENT tripped the static guard**
- **Found during:** Task 3 (seam-padding comment)
- **Issue:** My new seam-padding comment in ScenarioComposer.tsx contained the literal "the mounted FactsheetBody <article>". The static guard test (T-30-05, "no factsheet import on the blend path") greps the WHOLE source for `/FactsheetBody|MetricsColumn|.../` and counts `FactsheetBody == 0` — the comment literal made the count 1, failing the guard.
- **Fix:** Reworded the comment to "the mounted factsheet <article>" (lowercase, no component literal). `grep -c FactsheetBody` back to 0.
- **Files modified:** src/app/(dashboard)/allocations/components/ScenarioComposer.tsx
- **Verification:** `grep -c "FactsheetBody" ScenarioComposer.tsx` == 0; the static-guard test passes.
- **Committed in:** c9474db1 (Task 3 commit)

**2. [Rule 1 - Bug] PCR-tag test pinned the OLD positive token; updated to the new accent token**
- **Found during:** Task 3 (PCR token swap)
- **Issue:** `ScenarioComposer.test.tsx` WR-03 asserted the risk-reducing tag `className` contains `text-positive` — the exact token the plan replaces. After the swap to `text-accent`, the assertion failed.
- **Fix:** Updated the assertion to `toContain("text-accent")` and `not.toMatch(/text-positive|text-negative|text-warning/)`; reworded the rationale comment to "neutral accent (muted teal), not P&L-positive green". The decorative hedge bar (`bg-positive` at line 2754, asserted separately at test line 3787) was NOT in scope and stays — the plan scoped only the tag.
- **Files modified:** src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx
- **Verification:** WR-03 passes; full composer suite (100 tests) green.
- **Committed in:** c9474db1 (Task 3 commit)

**3. [Rule 9 - Test verifies intent] Added a falsifiable 1×-leverage-chip-suppression regression test**
- **Found during:** Task 3 (leverage guard)
- **Issue:** The existing `MandatePanels.scenario.test.tsx` only asserted `1×` absence on the EMPTY-constituent path (no chips at all), not the new behavior: a POPULATED constituent (types+markets present) at exactly `leverage === 1` must suppress the leverage chip.
- **Fix:** Added a dedicated test: a populated `leverage: 1` constituent renders its type/market chips but NOT `1×`; a `leverage: 3` constituent renders `3×`. Mutation-verified falsifiable — changing `> 1` to `>= 1` turns the test RED (then reverted).
- **Files modified:** src/app/factsheet/[id]/v2/MandatePanels.scenario.test.tsx
- **Verification:** 4/4 MandatePanels tests pass; mutation (>=1) confirmed RED.
- **Committed in:** c9474db1 (Task 3 commit)

---

**Total deviations:** 3 auto-fixed (1 blocking — self-inflicted comment-literal static-guard trip; 1 bug — stale test token; 1 test-intent — new falsifiable guard).
**Impact on plan:** All three are necessary correctness/test-fidelity fixes directly caused by this plan's own changes. No scope creep — the decorative hedge bar, pre-existing Phase-30 h3s, and 4 pre-existing eslint warnings in FactsheetView.tsx were all left untouched per scope boundary.

## Issues Encountered
- **h3 type-contract (Task 3 item e) is a no-op by construction.** The plan's item (e) targets "the NEW factsheet-shaped composer sections' h3/heading (the tracking-wider headings)". On inspection: the new Data-sources fold and the Phase-41 Diversification section render their titles via the SHARED `CollapsibleSection` `<h2>` (text-sm uppercase tracking-wider — shared by Diversification/Strategies, must NOT churn) and span-based sub-labels (text-[12px]/[18px]); neither has a standalone `<h3 tracking-wider>`. The ONLY `tracking-wider` `<h3>`s in the file are the PRE-EXISTING Phase-30 cards (`blend-returns-distribution` :2817/2823, `blend-rolling` :2870/2885), which the plan explicitly excludes ("do NOT churn pre-existing factsheet h3s"). So there was no new-section h3 to normalize — the new sections already conform to the v2 contract via the shared component. Documented rather than forcing an out-of-scope edit.
- **Plan's Task-3 grep `bg-accent/10 text-accent` (contiguous) reports a false-negative.** The PCR tag's real class interleaves utilities (`bg-accent/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-accent`), exactly as the original `bg-positive/10 ... text-positive` did. Both tokens are present and the old tokens removed; the acceptance criterion ("tag uses bg-accent/10 text-accent, no bg-positive/text-positive") is met. Verified with non-contiguous greps.

## User Setup Required
None - no external service configuration required (pure client JSX/CSS + tests; no env vars, no migrations, no endpoints).

## Next Phase Readiness
- GUARD-01 complete; the composer reads as one factsheet surface and all polish debt is folded.
- The additive `FactsheetFooter` scenarioMode + the `FactsheetBody.scenario-mode.test.tsx` innerHTML-equality test are the surface GUARD-02 (43-02) will PROMOTE into the permanent byte-identity gate (plus the Overview-untouched assertion).
- The `storageKey`-omitted Data-sources fold + the existing `composer-collapse:controls` key are the surface GUARD-04 (43-03) will assert against (no new factsheet-keyspace/URL write under `persist={false}`).
- No blockers. scenario.ts FROZEN (zero-diff); static guard intact; frozen-spine guards green.

## Self-Check: PASSED

- SUMMARY file: created at .planning/phases/43-edge-states-toggle-fold-guards/43-01-SUMMARY.md
- Commit 3cb0bf01: FOUND (Task 1 fold)
- Commit 26c2358b: FOUND (Task 2 RED)
- Commit 675ba6b7: FOUND (Task 2 GREEN)
- Commit c9474db1: FOUND (Task 3)
- Static guard: FactsheetBody count == 0 (PASS); scenario.ts diff empty (PASS)
- Suites: 1215 tests green; tsc clean; frozen-spine guards green

---
*Phase: 43-edge-states-toggle-fold-guards*
*Completed: 2026-06-26*
