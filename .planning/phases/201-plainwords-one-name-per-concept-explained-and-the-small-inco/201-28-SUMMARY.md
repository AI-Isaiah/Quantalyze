---
phase: 201-plainwords-one-name-per-concept-explained-and-the-small-inco
plan: 28
subsystem: allocations-flagged-holdings-card
tags: [copy, plainwords, term, f-04, u-26, accessible-names]
requires: [201-14, 201-27]
provides:
  - BridgeWidget reads in plain words in all five states (Mandate check eyebrow with Term Form A around Mandate, Replacement suggestions region names, outside-your-mandate subtle line)
  - BridgeDrawer dialog named Replacement review
  - BridgeOutcomeBanner region named Record outcome for a suggested replacement, question reads Did you act on this replacement suggestion?
  - rendered no-retired-word arms in the widget, drawer and banner tests
affects: [201-24, 201-33]
tech-stack:
  added: []
  patterns: [rendered arm that reads container text plus every aria-label and title and fails on the retired word]
key-files:
  created: []
  modified:
    - src/app/(dashboard)/allocations/components/BridgeWidget.tsx
    - src/app/(dashboard)/allocations/components/BridgeWidget.test.tsx
    - src/app/(dashboard)/allocations/components/BridgeWidget.variants.test.tsx
    - src/app/(dashboard)/allocations/components/BridgeDrawer.tsx
    - src/app/(dashboard)/allocations/components/BridgeDrawer.test.tsx
    - src/app/(dashboard)/allocations/components/BridgeOutcomeBanner.tsx
    - src/app/(dashboard)/allocations/components/BridgeOutcomeBanner.test.tsx
    - src/app/(dashboard)/allocations/HoldingsTabPanel.flagged-rows.test.tsx
key-decisions:
  - "The three Term wrappers with the retired key (load-failed, empty, card/full eyebrows) and the subtle variant's inline wrapper are gone; the subtle line is prose and wraps nothing (UI-SPEC D-19 note: outside your mandate is not wrapped)."
  - "Tests assert the ' check' suffix via closest('span.inline').nextSibling, because Tooltip nests the Term span three wrappers deep."
patterns-established:
  - "Eyebrow = Term Form A around Mandate only, followed by plain ' check', outside any button."
requirements-completed: [CLAR-03, CLAR-04]
status: complete
duration: 30min
completed: 2026-11-11
commits: 2
plan_head_before: 7a8543ac6feeaab34480b10f874f3c1008c45985
plan_head_after: 6d01e5d1b84ba696923f1afacc227153696f1941
actuals:
  tokens: 6300
  tasks: 2
  commits: 2
---

# Phase 201 Plan 28: Mandate-check card, replacement dialog and outcome banner in plain words Summary

The flagged-holdings card, the replacement review dialog and the outcome banner no longer show the retired name "Bridge" in any text or accessible name. The card's eyebrows read "Mandate check" and open the `mandate` definition.

## Commits

- `2292e5b1b` feat(201-28): mandate-check card reads in plain words in all five states
- `6d01e5d1b` feat(201-28): replacement dialog and outcome banner say what they are

## What changed

Task 1, `BridgeWidget.tsx`:
- Load-failed: region `Mandate check unavailable`, eyebrow `Mandate check` (Term k=mandate around `Mandate`), message `Couldn’t check your holdings against your mandate.`, Retry unchanged.
- Empty: region `Mandate check`, same eyebrow; `All clear` and `Within mandate.` unchanged.
- `subtle`, `card`, `full`: region `Replacement suggestions`. Subtle line `{count} holding{plural} outside your mandate —` with no Term. Card and full eyebrows `Mandate check` with the `mandate` Term. `{count} holding{plural} flagged`, `Review candidates →` and `need{s} review` unchanged.
- Two comments that quoted the old copy were updated (the "Bridge status unavailable" doc comments and the "Bridge will alert..." comment). Remaining "Bridge" mentions are comments naming the component or feature (lines 6, 7, 125, 173, 236).

Task 2:
- `BridgeDrawer.tsx` dialog `aria-label` is `Replacement review`; the `mandate`-wrapped "Mandate gates failed" heading is untouched.
- `BridgeOutcomeBanner.tsx` region is `Record outcome for a suggested replacement`; question is `Did you act on this replacement suggestion?`.
- `HoldingsTabPanel.flagged-rows.test.tsx` `BANNER` constant follows the new region name.

Tests: BridgeWidget.test.tsx has a header note citing F-04 and U-26 and a rendered arm over all five states (text plus every `aria-label` and `title`, case-sensitive `/\bBridge\b/`, plus no `[data-term="bridge"]`). Drawer and banner tests carry the same arm. The variants test gained a plural subtle-line case (`2 holdings outside your mandate —`).

## Verification

- `node scripts/verify-plan-anchors.mjs <plan>`: OK, 6 claims checked, exit 0.
- Task 1 verify: `BridgeWidget.test.tsx`, `BridgeWidget.variants.test.tsx`, `copy-census.test.ts`: 3 files, 59 tests passed.
- Task 2 verify: BridgeWidget (both files), BridgeDrawer, BridgeOutcomeBanner, HoldingsTabPanel.flagged-rows, copy-census, figure-gate-census: 7 files, 113 tests passed. `npx eslint` on the three components and the four test files: exit 0. `npm run typecheck` (`tsc --noEmit`): exit 0, no output.
- Re-measured `grep -a -H -n -E '(^|[^A-Za-z0-9_])Bridge([^A-Za-z0-9_]|$)'` over the three components after the change: five lines, all comments (BridgeWidget.tsx lines 6, 7, 125, 173, 236). No Term with the `bridge` key remains in these files.
- Acceptance counts: `Mandate check` 4 in BridgeWidget.tsx (3 JSX plus a doc comment), `Replacement suggestions` 3, `outside your mandate` 1, non-comment `Bridge recommendations` 0, `Replacement review` 1, `a suggested replacement` 1, `replacement suggestion?` 1.

## Neuter gates (data-integrity / user-facing gates shown able to fail)

gc-201-28-neuter: gate=BridgeWidget.test.tsx + BridgeWidget.variants.test.tsx result=red restored=identical
- Neuter: the full variant's eyebrow put back to the retired word (`Bridge flagged`), on a `cp -p` byte backup.
- RED lines: `× full: no /\bBridge\b/ in text, aria-label or title, and no bridge Term`; `AssertionError: expected 'Bridge flagged1 holding needs review•…' not to match /\bBridge\b/`; `× full variant (default) — singular copy …` and `× still renders the hero card …` with `expected undefined to be 'Mandate'`.
- Restore: `cp -p` back, `cmp` exit 0, then 59/59 green.

gc-201-28-neuter: gate=BridgeOutcomeBanner.test.tsx result=red restored=identical
- Neuter: the old question put back in BridgeOutcomeBanner.tsx.
- RED lines: `× is found by its plain-words region name and carries no retired word`; `AssertionError: expected 'Did you act on this Bridge suggestion…' not to match /\bBridge\b/`; `× renders the prompt + Allocated/Rejected CTAs + dismiss button`; `× dismiss failure (non-OK response) …`.
- Restore: `cp -p` back, `cmp` exit 0, then green.

Tests-first RED was also seen for both tasks before the component edits (12 failures in the widget files; 6 in drawer, banner and flagged-rows).

gc-201-28-gates: vitest=green eslint=clean tsc=clean

## cross-plan-pins

none. `grep -a -rn -F` for the old literals (`Bridge status`, `Bridge status unavailable`, `Bridge review`, `Bridge-introduced`, `Bridge suggestion`) across `src`, `e2e` and `tests` found only this plan's own files (all updated). Not pins on this plan's literals, noted for their own plans: `ScenarioComposer.tsx:6811` prose "Bridge recommendations." and `InsightStrip.tsx:164` / `InsightStrip.test.tsx` "Bridge flagged N holding(s)" (both listed in the UI-SPEC table for other plans).

## reported-not-edited

None. No phase-200 file (`ApiKeyManager.tsx`, `ConfirmKeyChangeDialog.tsx`, `e2e/api-key-flow.spec.ts`, `e2e/sync-analytics-flow.spec.ts`) was opened or edited; the re-grep over this plan's files found none of them relevant.

## Deviations from Plan

None - plan executed exactly as written. No census, ledger or registry file changed; the census test stayed green without edits.

## Known Stubs

None.

## Threat Flags

None. Copy and accessible names only; T-201-37 mitigated by the pre-commit literal grep and the same-commit test updates.

## Self-Check: PASSED

- FOUND: all 8 files_modified paths changed in the two commits.
- FOUND: commits 2292e5b1b and 6d01e5d1b are ancestors of HEAD (`wt/201-p28`).
