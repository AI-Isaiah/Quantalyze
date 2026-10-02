# Phase 21 — Deferred Items (out-of-scope discoveries during execution)

These are issues discovered during plan execution that are NOT directly caused
by the executing plan's changes. Per the executor SCOPE BOUNDARY rule they are
logged here, not fixed in-plan.

---

## DI-21-01 — `AllocationsTabs.test.tsx` not updated when 21-01 surfaced the Scenario tab — ✅ RESOLVED

- **Resolved:** 2026-06-21 by the orchestrator (post-execution integration gate),
  commit `e4ceee7d`. The `?tab=scenario` test now asserts the Scenario tab is
  present + selected; the ArrowRight-wrap `order` array includes Scenario as the
  last visible tab; a stale URL-state docstring in `AllocationsTabs.tsx` was also
  corrected. `AllocationsTabs.test.tsx` → 42/42; full phase-21 spec set → 185/185;
  `tsc --noEmit` → 0 errors.
- **Discovered during:** Plan 21-04 execution (Wave-3 verification batch).
- **Symptom:** 2 failing tests in
  `src/app/(dashboard)/allocations/AllocationsTabs.test.tsx`:
  - `ArrowRight wraps focus across the visible tabs in VISIBLE_TAB_KEYS order (Scenario excluded)`
    (`AllocationsTabs.test.tsx:355` — `expect(url.includes("tab=")).toBe(false)` now sees `tab=...`)
  - a sibling assertion in the same `Phase 09.1 D-04 / D-05 / D-06` block.
- **Root cause:** Commit `3540cd9a feat(21-01): add visible Scenario tab to
  dashboard tablist (SURF-01)` added `"scenario"` to `VISIBLE_TAB_KEYS` (and the
  keyboard-nav array), but the keyboard-wrap test still encodes the
  pre-21-01 expectation that Scenario is excluded from the visible strip /
  arrow-nav order. The test literal lags the source change from Plan 21-01.
- **Why out of scope for 21-04:** Plan 21-04 touches only
  `src/components/scenarios/ScenarioBuilder.tsx` and the net-new
  `ScenarioBuilder.honesty.test.tsx`. `AllocationsTabs.tsx` /
  `AllocationsTabs.test.tsx` are not in this plan's diff, and the failure
  reproduces with the 21-04 changes absent (the test file does not import
  `ScenarioBuilder`). This is a stale-test artifact owned by Plan 21-01's
  scope (SURF-01), not a regression introduced here.
- **Suggested owner/fix:** Update `AllocationsTabs.test.tsx` to expect Scenario
  in the visible-strip / ArrowRight wrap order (it is now a visible,
  keyboard-reachable tab per the 21-01 SURF-01 decision in STATE.md). Best
  handled in a 21-01 follow-up or the phase verifier pass.

---

## Note — foreign WIP stash on `main` (not this agent's)

- `git stash list` shows `stash@{0}: On main: FOREIGN-WIP-on-main-not-mine-2026-06-21`.
- This executor did NOT create it and will NOT touch it (the stash list is shared
  across worktrees; popping/dropping it could apply or destroy another session's
  WIP). Flagged for the human/orchestrator only.
