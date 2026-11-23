---
phase: 213-keyflow-a-key-and-its-draft-can-never-be-silently-mixed-up-a
plan: 08
subsystem: testing
tags: [vitest, multi-key-connect, wizform-05, long-wait, decision-c, sc-3, sc-6]

requires:
  - phase: 153.4-05
    provides: "WIZFORM-05 per-panel long-wait cases (the six re-seated here)"
provides:
  - "Six venue-independent WIZFORM-05 cases pinned on twoCcxtPanels() with hand-typed default-budget constants, green against the unmodified component"
  - "A comment block at the top of the WIZFORM-05 describe naming the re-seated cases and the three left for plan 12"
affects: [213-12]

actuals:
  tokens: 5000
  tasks: 2
  commits: 2
plan_head_before: d16d5ccd840488448c3b5cc71c045b45fd07e94a
plan_head_after: 36b1e0a47e7598f942009e5de2b95bdd1f9baf59

tech-stack:
  added: []
  patterns:
    - "Hand-typed expected budgets and deadlines in the test, never derived from the component or validate-budget.ts"

key-files:
  created: []
  modified:
    - "src/app/(dashboard)/strategies/new/wizard/steps/MultiKeyConnectStep.test.tsx"

key-decisions:
  - "The ccxt ladder has no queue sentence (MetaTrader-only), so the re-seated escalation case asserts the 40% rung as the Stop waiting control with the queue line absent, and the 75% rung as the amber 30s slow line at the 23 000 ms tick"
  - "The no-give-up case probes twice: just past budget+grace (45 000 ms) and the last whole tick before the route worst case (99 500 ms)"
  - "Three constants whose only users were re-seated cases were removed (SERIALIZED_DEADLINE_TICK_MS, SLOW_LINE_120, DEADLINE_CAUSE_120); its tick-rounding rationale moved onto DEFAULT_DEADLINE_TICK_MS"

requirements-completed: [SC-3, SC-6]

duration: 20 min
completed: 2026-11-14

coverage:
  - deliverable: "Six venue-independent long-wait behaviours pinned on ccxt panels, green at HEAD"
    verification:
      - kind: test
        ref: "src/app/(dashboard)/strategies/new/wizard/steps/MultiKeyConnectStep.test.tsx"
        status: pass
    human_judgment: false
---

# Phase 213 Plan 08: Long-wait coverage re-seated onto ccxt panels Summary

Six WIZFORM-05 long-wait cases (ladder, no give-up while encrypting, stated deadline verdict, one wizard_error, kept-details verdict, ASCII busy label) now run on two ccxt panels with hand-typed default-budget constants, green against the unmodified component, so they survive decision (c) removing MT5 member panels.

## Accomplishments

- Added hand-typed constants `DEFAULT_DEADLINE_MS` (30 000 + 30 000 + 25 500 + 15 000 = 100 500), `DEFAULT_DEADLINE_TICK_MS` (101 000, first tick at or after), `DEFAULT_SLOW_RUNG_TICK_MS` (23 000), `SLOW_LINE_30` and `DEADLINE_CAUSE_30`.
- Re-seated the six cases from `mixedVenuePanels()` onto `twoCcxtPanels()`; every title is unchanged and each carries the one-line comment "re-seated onto ccxt panels: Phase 213 decision (c) removes MT5 member panels".
- Task 2 added a 19-line comment-only block listing re-seated cases and the three cases left for plan 12.
- Result: `MultiKeyConnectStep.test.tsx` 89 passed (89); with `src/lib/wizardErrors.roster-render.test.tsx` 200 passed (200).

## Task Commits

1. Task 1 (re-seat six cases): `a1fb78a15`
2. Task 2 (comment block, comment lines only): `36b1e0a47`

Both touch only the test file (`git show --stat`).

## Cases re-seated (6, none failed the faithful re-seat)

1. escalates at 40% and 75% of THAT panel's budget, and nothing goes red inside it
2. a panel does NOT give up while the route is still encrypting and storing its key
3. a panel past its budget ends in a STATED verdict, and its sibling is untouched
4. the deadline path records EXACTLY ONE wizard_error, on this step's own funnel step
5. the deadline verdict tells the user their key details are still on the page
6. the panel's busy label stays ASCII `Validating...` for the whole wait

## Left for plan 12 (decision-(c) conversion, unmodified, still on MT5 panels)

- "a serialized member panel names what is happening and the deadline it was granted"
- "mixed venues: each panel's ladder is cut from ITS OWN venue's budget"
- "a serialized member's failure never offers a remedy that presupposes another venue (D-17)"

No case that the plan expected to re-seat was left on its HEAD body; all six held on a ccxt panel.

## Acceptance evidence

- `it(` / `it.each(` count: 88 at the merge base and 88 now (no case dropped).
- `grep -c "twoCcxtPanels()"`: 14 before, 20 after (six re-seated).
- `git diff --stat <merge-base> -- supabase/` prints nothing (SC-5).
- `npx tsc --noEmit -p tsconfig.json` exit 0; `npm run lint` 0 errors (4 warnings, none in this file: eslint on the file is clean).

## SC-6 neuter evidence (backup to a `mktemp -d` dir, break, run, restore with `cp`, `shasum -a 256` equal: b17789e3...7e14a before and after)

The budget is derived in `src/lib/wizard/validate-budget.ts` (the component only calls it), so the neuters were applied there, not to `MultiKeyConnectStep.tsx`.

1. `VALIDATE_KEY_BUDGET_MS` 30 000 -> 60 000: 12 cases RED, including the re-seated "escalates at 40% and 75% of THAT panel's budget, and nothing goes red inside it" (`AssertionError: expected null not to be null`), "a panel past its budget ends in a STATED verdict, and its sibling is untouched", "the deadline path records EXACTLY ONE wizard_error...", "the deadline verdict tells the user their key details are still on the page".
2. `connectAbortDeadlineMsFor` reduced to the validate budget alone (drops encrypt, breaker store and grace): exactly one case RED, "a panel does NOT give up while the route is still encrypting and storing its key" (a deadline envelope rendered inside the route's budget). Rerun after the final edit of that case, same result.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocker] SC-6 neuter target is validate-budget.ts, not MultiKeyConnectStep.tsx**
- **Found during:** Task 1 acceptance
- **Issue:** the plan says to change "the default per-panel budget in the component", but the budget and the deadline sum live in `validate-budget.ts`.
- **Fix:** neutered that module instead; component never edited.
- **Files modified:** none persisted (restored byte-identical).

**2. [Rule 1 - Cleanup of own mess] Three constants removed**
- **Found during:** Task 1 lint
- **Issue:** re-seating left `SERIALIZED_DEADLINE_TICK_MS`, `SLOW_LINE_120` and `DEADLINE_CAUSE_120` unused (eslint warnings introduced by this plan); none is referenced by plan 12 or by a remaining case.
- **Fix:** deleted them; the tick-rounding rationale was carried onto `DEFAULT_DEADLINE_TICK_MS`. `SERIALIZED_BUDGET_MS`, `SERIALIZED_DEADLINE_MS`, `WAIT_PROMISE_120` and `SIGNING_IN` stay because the three left cases still use them.
- **Commit:** a1fb78a15

**3. [Scope note] Case 2 gained a second probe**
- The no-give-up case now also checks the last whole tick before the route's 100 500 ms worst case (so `DEFAULT_DEADLINE_MS` is used and the property is pinned up to the boundary, not only at 45 001 ms). Same property, stricter.

**Total deviations:** 3 (1 blocker-target note, 1 cleanup, 1 strengthening). **Impact:** none on scope; component untouched.

## Known Stubs

None.

## Threat Flags

None (test-only).

## Issues Encountered

None.

## Self-Check: PASSED

- Test file exists; commits `a1fb78a15` and `36b1e0a47` are ancestors of HEAD.
- Final verify commands passed: 89/89 and 200/200.
