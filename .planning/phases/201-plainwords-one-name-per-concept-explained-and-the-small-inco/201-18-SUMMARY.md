---
phase: 201-plainwords-one-name-per-concept-explained-and-the-small-inco
plan: 18
subsystem: ui
tags: [copy, glossary, terms, tooltip, formatDay, copy-census]
requires:
  - phase: 201-25
    provides: copy census ledgers and ownerOf assignment
  - phase: 201-26
    provides: owner viewer passed to the resolver
provides:
  - Profile Mandate tab as a Form B term (Tooltip around the trigger)
  - mandate form help copy says allocation; Mandate and Correlation as Term
  - TWR and Sharpe as Term on the public landing card
  - every remaining no-option locale date in src/components routed through formatDay
  - ledger plan-18 with pending {}
key-files:
  created:
    - src/components/landing/VerificationResults.terms.test.tsx
    - src/components/strategy/SyncProgress.last-synced.test.tsx
  modified:
    - src/components/auth/ProfileTabs.tsx
    - src/components/auth/DeleteAccountButton.tsx
    - src/components/mandate/MandateForm.tsx
    - src/components/mandate/MandateSlider.tsx
    - src/components/org/OrganizationTab.tsx
    - src/components/deck/DeckCard.tsx
    - src/components/strategy/ApiKeyManager.tsx
    - src/components/strategy/FactsheetPreview.tsx
    - src/components/strategy/HoldingFactsheet.tsx
    - src/components/strategy/PendingIntros.tsx
    - src/components/strategy/SyncProgress.tsx
    - src/components/landing/VerificationResults.tsx
    - scripts/copy-census/ledgers/plan-18.ts
status: complete
commits: 4
plan_head_before: 8724de1ab
plan_head_after: 3a1bd4fb4cca5e98771b1cf4e7bc00d1ebe416a4
actuals:
  tasks: 3
  commits: 4
---

# Phase 201 Plan 18: remaining src/components hits Summary

The Profile Mandate tab explains "mandate" through a Tooltip around the existing trigger (no nested tab stop), the mandate form says "allocation", the public landing card explains TWR and Sharpe through Term, every leftover locale date prints through formatDay, and the plan-18 census ledger is empty.

This is a resumed run: the previous executor was interrupted after the three task commits. This run verified each task's criteria again, found and fixed one typecheck failure left in a test, re-ran the neuter checks and wrote this summary.

## Task to commit map

| Task | Commit | Result |
|------|--------|--------|
| 1 (tracer) Profile Mandate tab, Form B | 657042d52 | `termDefinition` count in ProfileTabs.tsx is 2 (0 at HEAD before) |
| 2 mandate help copy, landing TWR | ea2a1e2b1 | `your portfolio` count in MandateForm.tsx is 0 (2 before) |
| 3 remaining locale dates, ledger empty | d78f7f5be | `toLocaleDateString()` is 0 in all six named files; `pending: {}` |
| fix (this run) | 3a1bd4fb4 | terms test passes the required `matchedStrategyId` prop |

## What changed

- **ProfileTabs**: the `mandate` entry carries `term: "mandate"`; only that trigger is wrapped in `Tooltip` with `termDefinition("mandate")` (Form B). The trigger gets `aria-describedby`; the other tabs render no tooltip.
- **MandateForm**: the two help sentences read the UI-SPEC After strings (`Largest share of your allocation any single strategy can hold. 5%-50%.`, `Worst peak-to-trough loss you can accept across your allocation.`). The archetype label wraps "Mandate" in `Term`. `MandateSlider` gained an optional `term` prop that wraps only the label's opening words in `Term`, and the Correlation ceiling label uses it.
- **VerificationResults**: `MetricCard` takes an optional `term`; TWR and Sharpe render as `Term` (`data-term` twr and sharpe).
- **Dates (D-11)**: `formatDay` replaces the bare locale date in DeleteAccountButton, OrganizationTab, DeckCard, ApiKeyManager (Key checked stamp), FactsheetPreview, HoldingFactsheet, PendingIntros and SyncProgress. Each call site keeps its null and invalid guards.
- **Ledger plan-18**: `pending: {}`, one identifier-style exception (`MandateSaveStatus.tsx` "Mandate saved", an aria-live status flash that must not gain a tab stop), `pinnedExceptionCount: 1`.

## Verification (real output, this run, HEAD 3a1bd4fb4)

| Command | Result |
|---------|--------|
| `npx tsx scripts/copy-census/run.ts --ledger plan-18` | no hits listed, exit 0 |
| Task 3 vitest scope (auth, mandate, notes, org, deck, strategy x4, landing, factsheet, charts, ui, copy-census, figure-gate-census) | 67 files passed, 748 tests passed, 0 failed |
| Re-run after the test fix: ProfileTabs, landing, PendingIntros, copy-census | 7 files passed, 92 tests passed |
| `npx eslint` on every touched source file | exit 0, clean |
| `npm run typecheck` | first run: 2 errors (TS2741, VerificationResults.terms.test.tsx lines 27 and 37); after the fix: exit 0 |
| `node scripts/verify-plan-anchors.mjs <plan>` | exit non-zero: one `symbol-absent` miss, SyncProgress.tsx `toLocaleDateString` (see deviations) |

gc-201-18-gates: vitest=green eslint=clean tsc=clean

## Neuter evidence

Each neuter was made on a `cp -p` byte backup in the scratchpad, seen RED, restored with `cp -p`, `cmp` exit 0, then GREEN.

- ProfileTabs: `if (!("term" in tab)) return trigger();` replaced by `return trigger();` (no Tooltip). RED: `ProfileTabs: the Mandate tab explains mandate (Form B) > focusing the Mandate tab shows the registry definition after 150 ms and the tab describes itself by it` (1 failed, 17 passed). cmp 0.
- VerificationResults: `<Term>` wrapper removed. RED: both arms in `VerificationResults.terms.test.tsx` (2 failed). cmp 0.
- PendingIntros: `formatDay(r.created_at)` replaced by `toLocaleDateString()`. RED: `prints the request date through formatDay (D-11)` (1 failed, 10 passed). cmp 0.

gc-201-18-neuter: gate=src/components/auth/ProfileTabs.test.tsx result=red restored=identical
gc-201-18-neuter: gate=src/components/landing/VerificationResults.terms.test.tsx result=red restored=identical
gc-201-18-neuter: gate=src/components/strategy/PendingIntros.test.tsx result=red restored=identical

After restore, `git status` showed only the intended test fix as modified.

## Deviations from Plan

**1. [Rule 1 - Bug] Landing terms test did not typecheck**
- **Found during:** resume verification (`npm run typecheck`)
- **Issue:** `VerificationResults.terms.test.tsx` rendered `VerificationResults` without the required `matchedStrategyId` prop (TS2741, twice). Vitest does not typecheck, so the tests were green while tsc was red.
- **Fix:** pass `matchedStrategyId={null}` in both renders.
- **Files modified:** src/components/landing/VerificationResults.terms.test.tsx
- **Commit:** 3a1bd4fb4

**2. [Rule 3 - plan versus dispatch rule] ApiKeyManager.tsx was edited**
- The plan lists `ApiKeyManager.tsx` and `ApiKeyManager.test.tsx` in `files_modified` and its Task 3 acceptance criterion requires `toLocaleDateString()` to be 0 in that file. The dispatch brief says not to edit `ApiKeyManager.tsx` (a phase-200 file) and to record such a change as reported-not-edited.
- The interrupted executor made the edit in commit d78f7f5be: one import line and the single "Key checked" stamp line (no key-row layout touched; test change is one regex). Phase 200's PR (#1251) is already merged into the base, and the hunk is two lines, so a textual conflict with a layout change is unlikely.
- **Decision for the orchestrator:** keep it (the ledger cannot reach `pending: {}` without it), or drop the two ApiKeyManager hunks and give plan-18 an `ApiKeyManager.tsx` pending count of 1. I kept it because the plan's acceptance criteria require it and reverting would break the census.

**3. [Anchor check] verify-plan-anchors reports one stale claim**
- `<!-- verify-symbol: src/components/strategy/SyncProgress.tsx toLocaleDateString -->` no longer resolves, because this plan removed that call. The claim described the tree before the plan ran, so the miss is the expected result of completing Task 3, not a defect. Not re-measured on the pre-plan tree.

**4. Files beyond the plan's list**
- `MandateSlider.tsx` (the `term` prop), `HoldingFactsheet.tsx` (+ test) and `DeleteAccountButton.test.tsx`, `DeckCard.test.tsx`, `SyncProgress.last-synced.test.tsx` (new, replaces the planned `SyncProgress.test.ts` edit) were touched. `HoldingFactsheet.tsx` and `MandateSlider.tsx` are assigned to plan-18 by `ownerOf`, which the plan says to add to the file list.

Auth gates: none.

## cross-plan-pins

None found. `grep -a -rn -F` for the old help sentences ("Largest share of your portfolio", "across your portfolio.") over src, e2e and tests returns no hits outside this plan's files.

## reported-not-edited

None. (`ConfirmKeyChangeDialog.tsx`, `e2e/api-key-flow.spec.ts` and `e2e/sync-analytics-flow.spec.ts` were not touched; see deviation 2 for the one ApiKeyManager.tsx line.)

## Known Stubs

None.

## Threat Flags

None. The landing card renders static registry text; PendingIntros changed only its date (T-201-24 accepted).

## Self-Check: PASSED

Commits 657042d52, ea2a1e2b1, d78f7f5be and 3a1bd4fb4 are ancestors of HEAD; `plan-18.ts` has `pending: {}`; `VerificationResults.terms.test.tsx` exists.
