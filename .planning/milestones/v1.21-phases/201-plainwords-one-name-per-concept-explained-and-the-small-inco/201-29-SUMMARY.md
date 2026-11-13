---
phase: 201-plainwords-one-name-per-concept-explained-and-the-small-inco
plan: 29
subsystem: ui-copy
tags: [copy, plain-words, F-04, U-26, allocations, mandate, onboarding]
requires: [201-08, 201-09, 201-10, 201-11, 201-12, 201-13, 201-14, 201-15, 201-16, 201-17, 201-18, 201-19, 201-20, 201-21, 201-22, 201-27]
provides:
  - mandate quick-set, Mandate tab, holding detail and onboarding banner copy in plain words, no retired product word
  - onboarding banner names the three real tabs
affects: [201-33 copy census word list]
tech-stack:
  added: []
  patterns: [rendered no-retired-word arm (text, aria-label, title), hand-typed tab oracle independent of TAB_LABELS]
key-files:
  created: []
  modified:
    - src/app/(dashboard)/allocations/components/MandateQuickSetCard.tsx
    - src/app/(dashboard)/allocations/components/MandateQuickSetCard.test.tsx
    - src/app/(dashboard)/allocations/MandateTabPanel.tsx
    - src/app/(dashboard)/allocations/MandateTabPanel.test.tsx
    - src/app/(dashboard)/allocations/components/HoldingDetail.tsx
    - src/app/(dashboard)/allocations/components/HoldingDetail.test.tsx
    - src/app/(dashboard)/allocations/components/HoldingsTable.sub-row.test.tsx
    - src/app/(dashboard)/allocations/components/OnboardingBanner.tsx
    - src/app/(dashboard)/allocations/components/OnboardingBanner.test.tsx
decisions:
  - "Followed the UI-SPEC 'Scenario (was Bridge)' table word for word for all six sentences (F-04, U-26)."
  - "The max-weight help is wrapped so 'is flagged for review' sits on one source line; the plan's line-based acceptance grep needs that, rendered text is unchanged."
metrics:
  duration: ~25m
  completed: 2026-11-11
status: complete
actuals:
  tokens: 6000
  tasks: 2
  commits: 2
plan_head_before: 7a8543ac6feeaab34480b10f874f3c1008c45985
plan_head_after: 4f55afb8490c5bfc75c8a90b4cdafdcc40168704
---

# Phase 201 Plan 29: mandate, holding detail and onboarding copy in plain words Summary

Six sentences across four allocation components now say what the feature does (holdings are checked against the mandate, replacements are suggested) instead of naming the retired product word, and the onboarding banner names the three tabs the page actually shows (Overview, Holdings and Scenario).

## Commits

| Task | Commit | What |
|------|--------|------|
| 1 (tracer) | d72d68e44 | MandateQuickSetCard (intro, max-weight help, strategy-types help) and MandateTabPanel note; tests first |
| 2 | 4f55afb84 | HoldingDetail not-flagged line, OnboardingBanner tab list, sub-row locator; tests first |

## Copy now rendered

- Quick-set intro: `Set the mandate your holdings are checked against. We've suggested defaults — review and save, or skip for now.`
- Max-weight help: `Suggested: 15%. Any holding above this share of your allocation is flagged for review.`
- Strategy-types help: `Suggested: none — keep open until you've seen a few replacement suggestions.`
- Mandate tab note: `Edit your mandate in the profile surface. Changes apply at once to the mandate check and the replacement suggestions.`
- Holding detail: `This holding is not flagged as outside your mandate — no replacement to record against.`
- Banner: `Add a read-only API key — we'll pull your real holdings within one sync cycle and populate Overview, Holdings and Scenario.`

Each is pinned as exact text. Each of the four components has a rendered arm failing on `/\bBridge\b/` in text, `aria-label` or `title`. The `mandate` Term arms on the headings still pass. The banner test hand-types `Overview`, `Holdings`, `Scenario` and does not import `TAB_LABELS` (T-201-38).

## Verification

- `node scripts/verify-plan-anchors.mjs <plan>`: OK, 7 claims, no stale claims (exit 0).
- Task 2 automated vitest set (HoldingDetail, HoldingsTable.sub-row, OnboardingBanner, MandateQuickSetCard, MandateTabPanel, copy-census): 6 files, 98 tests passed, 0 failed.
- `npx eslint` over the four component files and the five test files: exit 0, clean.
- `npm run typecheck`: exit 0.
- Acceptance greps (`grep -a -c`): `checked against` 1, `is flagged for review` 1, `the mandate check and the replacement suggestions` 1, `not flagged as outside your mandate` 1, `populate Overview, Holdings and Scenario` 1.
- Context grep over the four components prints exactly one line, a comment: `HoldingDetail.tsx:12: *  the row is not a Bridge candidate.` (a header doc comment, not user-visible, left alone per the plan).
- Copy census: `src/__tests__/copy-census.test.ts` green, no file under `scripts/copy-census/` touched, no ledger edited.
- RED before GREEN: for task 1, 6 tests failed on the new pins before the copy changed (3 exact-text arms, 2 rendered arms, plus the Mandate tab note); for task 2, 5 tests failed before the copy changed.

## Neuter record

gc-201-29-neuter: gate=MandateQuickSetCard.test.tsx result=red restored=identical
- Put the old intro sentence back; RED lines: `renders the verbatim UI-SPEC §S2 body copy` and `renders no retired product word in text, aria-label or title (F-04)` with `AssertionError: expected 'Mandate quick-setSet how the Bridge r…' not to match /\bBridge\b/`. Restored with `cp -p` from the byte backup, `cmp` exit 0, 17 tests GREEN.

gc-201-29-neuter: gate=OnboardingBanner.test.tsx result=red restored=identical
- Put the old tab list (Performance, Bridge, and Scenario) back; RED lines: `renders body copy verbatim per UI-SPEC §S1` and `renders no retired product word in text, aria-label or title (F-04)`. Restored with `cp -p`, `cmp` exit 0, 11 tests GREEN.

gc-201-29-gates: vitest=green eslint=clean tsc=clean

## Deviations from Plan

None in substance. One mechanical adjustment: the max-weight help's JSX line break was moved so `is flagged for review` stays on one source line, because the plan's acceptance criterion is a line-based `grep -c` that expects 1. It was first written wrapped (grep printed 0), then re-wrapped; the rendered text is identical. The re-wrap is in commit 4f55afb84 together with task 2.

## cross-plan-pins: none

`grep -a -rn -F` over `src e2e tests` for every old literal ("Set how the Bridge ranks", "The Bridge flags any holding", "a few Bridge", "across the Bridge engine", "not flagged for Bridge", "populate Performance, Bridge") hit only files in this plan's `files_modified`.

## reported-not-edited

None. `ApiKeyManager.tsx`, `ConfirmKeyChangeDialog.tsx`, `e2e/api-key-flow.spec.ts`, `e2e/sync-analytics-flow.spec.ts` carry no `\bBridge\b` (re-grepped at HEAD) and were not touched.

## Known Stubs

None.

## Threat Flags

None. T-201-38 (banner promising a tab that does not exist) is mitigated by the hand-typed tab oracle in `OnboardingBanner.test.tsx`.

## Self-Check: PASSED

- Commits d72d68e44 and 4f55afb84 are ancestors of HEAD; `git rev-list --count 7a8543ac6..HEAD` = 2.
- All nine files_modified paths exist and were committed; no file deletions in either commit.
