---
phase: 196-onestrategypage-a-strategy-has-one-page-the-factsheet-and-it
plan: 17
subsystem: routing
tags: [route-removal, lean-02, route-02, browse]
requires: ["196-02"]
provides:
  - "no page backs /browse/[slug]/[strategyId]; the URL reaches /factsheet/[id] through plan 02's 308"
affects: ["196-08"]
key-files:
  deleted:
    - "src/app/browse/[slug]/[strategyId]/page.tsx"
    - "src/app/browse/[slug]/[strategyId]/page.figure-gate.test.tsx"
    - "src/app/browse/[slug]/[strategyId]/page.max-dd-tone.test.tsx"
    - "src/app/browse/[slug]/[strategyId]/page.verified-badge.test.tsx"
  modified:
    - src/__tests__/trim-removed-surfaces.test.tsx
    - src/app/browse/breadcrumb-root.test.tsx
    - src/app/browse/disclaimer-once.test.tsx
    - src/__tests__/figure-gate-census.test.ts
decisions:
  - "figure-gate-census ANCHORS/GATED_ANCHORS lose the deleted page; StrategyTable stays as the gated anchor"
metrics:
  completed: 2026-11-09
  tasks: 1
status: complete
commits: 1
plan_head_before: aab9f6a1abc16d008aea11e447054698e1767686
plan_head_after: 3c332179d9fa241235ed87fd96976d8e71b24bc3
actuals:
  tokens: 6000
  tasks: 1
  commits: 1
---

# Phase 196 Plan 17: Browse detail route removed Summary

The retired `/browse/[slug]/[strategyId]` page tree (page plus three colocated tests) is deleted in one `git rm -r`, and every test that imported or scanned it moved in the same commit; the old URL keeps working through plan 02's redirect.

## Task 1 (tracer) - commit 3c332179d

- `git rm -r` of the 4-file tree (declared in `files_deleted`).
- `trim-removed-surfaces.test.tsx`: removed the browse detail page's disclaimer COUNTS row and the "strategy-page variant" arm. Reason: the page that carried the variant is gone; the one-disclaimer rule for the factsheet is Phase 195 D-09's and is covered by the factsheet's own tests. The positive control that `Disclaimer.tsx` still defines the `strategy-page` variant is kept (the discovery page, plan 15, still uses it).
- `breadcrumb-root.test.tsx`: removed the `StrategyDetailPage` import, the `renderStrategy` helper and the three `/browse/<cat>/<id>` and `/browse/<other>/<id>` arms. The three category arms are unchanged.
- `disclaimer-once.test.tsx`: removed the `StrategyDetailPage` import, the `/browse/<cat>/<id>` combined-block arm, and the two sentence constants only that arm used. Layout, root and category arms unchanged.

## Grep gates (HEAD -> after)

| Gate | HEAD | After |
|---|---|---|
| files under `src/app/browse/[slug]/[strategyId]` | 4 | 0 |
| non-comment `[slug]/[strategyId]/page` in trim-removed-surfaces | 2 | 0 |
| same, breadcrumb-root / disclaimer-once | 1 / 1 | 0 / 0 |
| `src/app/browse/layout.tsx` and `[slug]/page.tsx` exist | yes | yes |

## Verification

- `npx vitest run src/__tests__/trim-removed-surfaces.test.tsx src/app/browse src/__tests__/figure-gate-census.test.ts src/__tests__/strategy-route-redirects.test.ts`: 6 files, 76 tests passed.
- `npx tsc --noEmit`: clean.
- `npm run check:route-contract`: `OK - 51 page routes, all declared in the manifest.`

## 194.1 exclusion-row result

The sequencing note was live: `src/__tests__/figure-gate-census.test.ts` (Phase 194.1) listed the deleted page in `ANCHORS` and `GATED_ANCHORS` (it asserts each anchor is walked, matched and gated, so it would have gone red). The browse page was not in `EXCLUDED`; the two anchor entries were removed and `StrategyTable.tsx` remains the gated anchor, so the detector-fires-on-a-real-file control is intact. The `EXCLUDED` six-file redirect set is untouched (it names `src/app/strategy/[id]/page.tsx`, plan 18's file).

## Deviations from Plan

**1. [Rule 3 - Blocking] figure-gate-census anchors** - found during the 194.1 sequencing grep; edit described above; listed here because it was outside `files_modified`. Commit 3c332179d.

## Notes and known limits

- The deleted `page.figure-gate`, `page.max-dd-tone` and `page.verified-badge` tests loaded only the deleted page. The plan deletes them with the page; their invariants (annualised-figure gate, drawdown tone, verified badge from trust tier) now belong to the factsheet's own coverage. Not re-verified here that the factsheet carries an equivalent test for each; recorded as a limit, not measured.
- `e2e/mt5-badge.spec.ts:174` and `e2e/sfox-badge.spec.ts:168` still `page.goto` the old browse URL; plan 02 owns e2e, untouched here. With the 308 they land on the factsheet.
- No new gate was added, so no RED-once evidence is required. No PROD access, no migration, no package install.

## Threat flags

None.

## Self-Check: PASSED

- `src/app/browse/[slug]/[strategyId]` absent; commit 3c332179d is HEAD and an ancestor of the branch.
