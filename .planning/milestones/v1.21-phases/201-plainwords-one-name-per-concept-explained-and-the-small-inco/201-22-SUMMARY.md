---
phase: 201-plainwords-one-name-per-concept-explained-and-the-small-inco
plan: 22
subsystem: copy
tags: [plainwords, copy-census, public-pages, allocation-words]
requires: ["201-25", "201-26"]
provides:
  - "retired report page, security page, /for-quants and scenario-share in canonical words"
  - "ledger plan-22 empty (pending: {})"
affects: [201-23, 201-24]
key-files:
  modified:
    - src/app/portfolio-pdf/[id]/page.tsx
    - src/app/portfolio-pdf/[id]/page.test.tsx
    - e2e/route-redirects.spec.ts
    - src/app/(marketing)/security/page.tsx
    - src/app/(marketing)/security/page.test.tsx
    - src/app/(marketing)/for-quants/page.tsx
    - src/__tests__/public-truth-copy.test.tsx
    - src/app/scenario-share/[token]/page.tsx
    - src/app/scenario-share/[token]/page.test.tsx
    - src/app/scenario-share/[token]/page.figure-gate.test.tsx
    - src/lib/email.ts
    - src/lib/email.test.ts
    - src/lib/auth-types.ts
    - scripts/copy-census/ledgers/plan-22.ts
decisions:
  - "Three diagnostic strings (notes ownership reason, portfolio-exposure and queries error messages) are recorded as not-user-visible exceptions, not renamed"
metrics:
  tasks: 3
  completed: 2026-11-11
status: complete
actuals:
  tasks: 3
  commits: 3
plan_head_before: 8724de1ab708bff9ef2d452ffeb07ac6c4a2d03b
plan_head_after: 533abcad3ef1b9f6b710d1efd2b1aec161a9c065
---

# Phase 201 Plan 22: last src bucket Summary

The retired report page, security description, /for-quants public-name claims, scenario-share page and the remaining lib copy now use the canonical allocation words, and ledger plan-22 is empty. This run resumed an interrupted executor: tasks 1 and 2 were already committed (e51c72c35, d1c204d2b), task 3 was left uncommitted and was verified and committed here (533abcad3).

## Tasks

| Task | Commit | What |
|------|--------|------|
| 1 (tracer) | e51c72c35 | Retired report page: title `Allocation report retired`, eyebrow `Allocation report · Retired`, heading `This allocation report has been retired`, link `Open My allocation`; route path and href unchanged; e2e anonymous-visitor arm follows the new heading |
| 2 | d1c204d2b | Security description and Open Graph description say `allocation data`; /for-quants four sentences replaced with the exact After strings; scenario-share registered KPI labels render through Term, copy says allocation |
| 3 | 533abcad3 | `ROLE_META.allocator` description, allocator welcome intent (`build an allocation`), alert digest heading (`Allocation alerts`); `notifyAllocatorOfIntroRequest` docblock corrected (comment only); ledger emptied with 3 recorded exceptions |

## Exceptions recorded (ledger plan-22, pinnedExceptionCount 3)

- `src/lib/notes/ownership.ts` "portfolio not owned": diagnostic reason string, the notes route returns a generic 403 and never surfaces it (route comment, D-09).
- `src/lib/portfolio-exposure.ts` row-cap error message: thrown and logged, names the api_keys table, never rendered.
- `src/lib/queries.ts` `getAllocatorAggregates portfolios failed:`: thrown error naming the function and the portfolios table, never rendered.

## for-quants-kept:

Left unchanged because a codename is still picked at listing: metadata description and hero phrase "codename anonymization", the hero badge, the footer's "codename selection", how-it-works step 03's title, the factsheet sample's strategy name, the "Codename anonymization" row title. "never your firm name" kept as at HEAD; no new firm-name or tier claim.

## Files with no plan-22 hits (untouched)

`src/app/(dashboard)/preferences/page.tsx`, `src/app/(dashboard)/profile/page.tsx`, `src/lib/allocation-helpers.ts`, `src/lib/intro/snapshot.ts`, `src/lib/scenario.ts`, `src/lib/nav-marks-start.ts`, `src/app/scenario-share/[token]/share-resolve.ts` (name handling left as is, T-201-29), `src/lib/notes/ownership.ts` (exception only). The runner assigned them no hits at HEAD.

## Verification (real output)

- `node scripts/verify-plan-anchors.mjs <plan>`: `claims: 2 checked`, `OK`, exit 0.
- Scoped vitest (email, notes, auth-types, allocation-helpers, intro, scenario, nav-marks-start, portfolio-pdf, scenario-share, `(marketing)`, copy-census, figure-gate-census, public-truth-copy, public-truth-census): `Test Files 32 passed (32)`, `Tests 550 passed (550)`.
- `npx eslint` on all touched source files: exit 0, clean.
- `npm run typecheck` (`tsc --noEmit`): no errors.
- `npx tsx scripts/copy-census/run.ts --ledger plan-22`: no hits, exit 0.
- Old-literal grep (`Portfolio Alerts`, `build a portfolio`, `own portfolios`, `This portfolio report has been retired`) across src, e2e, tests: only negative assertions in `email.test.ts` and an unrelated code comment in `api/strategies/[id]/ownership/route.ts`. No stale pins.

gc-201-22-gates: vitest=green eslint=clean tsc=clean

## Neuter evidence (re-run on this resume; byte backups, cp -p + cmp)

- gc-201-22-neuter: gate=src/app/portfolio-pdf/[id]/page.test.tsx result=red restored=identical (heading reverted to "This portfolio report has been retired": 4 tests FAIL incl. the U-23 eyebrow/body test; cmp=0, then green)
- gc-201-22-neuter: gate=src/__tests__/public-truth-copy.test.tsx result=red restored=identical (public-listing row body reverted to the codename claim: `/for-quants ... says what a signed-out request returns` FAIL, `expected 'Public, under your strategy's nameA …' to contain 'A published factsheet is listed on Br…'`; cmp=0, then green)
- gc-201-22-neuter: gate=src/lib/email.test.ts result=red restored=identical (welcome intent reverted to "build a portfolio": `allocator welcome email says build an allocation, never build a portfolio (D-04)` FAIL; cmp=0, then 46/46 green)

## Tree-wide census reading after this plan (`--summary`)

```
plan-08  files=1  live A=0 B=45 C=1  pinned A=0 B=45 C=1
plan-09  files=5  live A=4 B=36 C=1  pinned A=4 B=36 C=1
plan-10  files=9  live A=4 B=0 C=6  pinned A=4 B=0 C=6
plan-11  files=1  live A=33 B=1 C=1  pinned A=33 B=1 C=1
plan-12  files=10  live A=22 B=9 C=0  pinned A=22 B=9 C=0
plan-13  files=11  live A=41 B=10 C=0  pinned A=41 B=10 C=0
plan-14  files=15  live A=6 B=19 C=10  pinned A=6 B=19 C=10
plan-15  files=8  live A=14 B=5 C=2  pinned A=14 B=5 C=2
plan-16  files=8  live A=2 B=36 C=6  pinned A=2 B=36 C=6
plan-17  files=6  live A=6 B=3 C=2  pinned A=6 B=3 C=2
plan-18  files=12  live A=3 B=7 C=6  pinned A=3 B=7 C=6
plan-19  files=4  live A=13 B=10 C=0  pinned A=13 B=10 C=0
plan-20  files=13  live A=19 B=0 C=11  pinned A=19 B=0 C=11
plan-21  files=12  live A=14 B=0 C=2  pinned A=14 B=0 C=2
plan-22  files=0  live A=0 B=0 C=0  pinned A=0 B=0 C=0
plan-27  files=4  live A=18 B=8 C=1  pinned A=18 B=8 C=1
total  live A=199 B=189 C=49
```

Other plans' ledgers are still pending (this worktree forks before their merges); plan-22 is at zero.

## cross-plan-pins:

None found.

## reported-not-edited

None. No phase-200 file (ApiKeyManager, ConfirmKeyChangeDialog, api-key-flow, sync-analytics-flow) was edited, and no F-04 Bridge or F-12 egress change was applied.

## Deviations from Plan

None in scope. Resume note: the interrupted executor's task-3 working-tree changes (auth-types, email, email.test, ledger) were verified correct and kept; the neuter RED lines were re-measured because the earlier run's evidence was lost with it.

## Known Stubs

None.

## Threat Flags

None. Copy and term wrappers only; no new endpoint, auth path or name source.

## Self-Check: PASSED

Commits e51c72c35, d1c204d2b, 533abcad3 are ancestors of HEAD; working tree clean before the SUMMARY.
