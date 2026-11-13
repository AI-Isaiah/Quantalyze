---
phase: 201-plainwords-one-name-per-concept-explained-and-the-small-inco
plan: 23
subsystem: copy-census
tags: [plainwords, copy-census, glossary, term, print-view, clar-03, clar-04, clar-06]
requires: ["201-08", "201-09", "201-10", "201-11", "201-12", "201-13", "201-14", "201-15", "201-16", "201-17", "201-18", "201-19", "201-20", "201-21", "201-22", "201-27", "201-28", "201-29", "201-30", "201-31", "201-32", "201-33", "201-34"]
provides:
  - "permanent copy census: zero non-excepted hits, no pending mechanism, 36 count-pinned reasoned exceptions"
  - "transitional date helpers, formatCloseDay option and the book noun deleted"
  - "tearsheet route print-view assertion (no data-term, no Term tab stop)"
affects: [201-24]
tech-stack:
  added: []
  patterns: ["exception list typed again in the census test and count-pinned", "neuter on a byte backup, RED naming file and rule, cp -p back, cmp"]
key-files:
  modified:
    - scripts/copy-census/policy.ts
    - scripts/copy-census/run.ts
    - scripts/copy-census/scan.test.ts
    - src/__tests__/copy-census.test.ts
    - src/lib/utils.ts
    - src/lib/utils.test.ts
    - src/lib/factsheet/returns-unit.ts
    - src/lib/factsheet/returns-unit.test.ts
    - src/lib/factsheet/joint.ts
    - src/lib/factsheet/joint.test.ts
    - src/app/(dashboard)/allocations/widgets/attribution/AlphaBetaDecomposition.tsx
    - src/app/(dashboard)/allocations/widgets/attribution/AlphaBetaDecomposition.book-btc.test.tsx
    - src/lib/glossary.test.ts
    - src/app/factsheet/[id]/tearsheet/page.test.tsx
  deleted:
    - scripts/copy-census/ledgers/ (index.ts and plan-08, 09, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 27)
decisions:
  - "The OWNERSHIP table, ownerOf and the Ledger type are removed with the ledgers: they existed only to say which ledger a hit belonged to, so keeping them would leave dead policy."
  - "The Rule C `deprecatedHelpers` list in policy.ts still names formatAbsoluteDate and formatIsoDay: the helpers are deleted, and the census now guards against their reintroduction."
status: complete
plan_head_before: 09ff9a2153cca19e60dd3ab6f22a6a3c335cd571
plan_head_after: 3510193f2503e884fc6cdff4f6af41fb02377813
commits: 3
actuals:
  tokens: 28700
  tasks: 3
  commits: 3
metrics:
  completed: 2026-11-11
---

# Phase 201 Plan 23: permanent census, transitional code gone, print view asserted Summary

The sixteen per-plan ledgers are folded into one permanent census gate that fails on any rule A, B or C hit that is not a reasoned exception; the two deprecated date helpers, the inert `formatCloseDay` option and the `book` noun are deleted; and the tearsheet route is asserted to render no `Term`.

## Task commits

| Task | Commit | What |
|------|--------|------|
| 1 (tracer) | 2be3fe9d0 | Folded the ledgers into `EXCEPTIONS`, deleted `scripts/copy-census/ledgers/`, removed the per-plan mode, ownership table and pending handling, rewrote the census test to zero hits plus the pin, stale and reason rules |
| 2 | 3a11fbcbd | Deleted `formatAbsoluteDate`, `formatIsoDay`, the `formatCloseDay` second parameter and the `book` member; widget now says "this allocation has {n}." |
| 3 | 3510193f2 | Tearsheet print arm (real `FactsheetView` under the page, plus an on-screen control); retired the tautological discovery parity arm in `glossary.test.ts` |

## Merged exception count

**36** = 4 policy rows (2 "No preference" options, the PORTFOLIO sentinel, the F-04 `scenario` definition) + 32 ledger rows (plan-09 1, plan-13 2, plan-14 1, plan-15 1, plan-16 18, plan-18 1, plan-19 6, plan-22 3, plan-27 1). Rows were moved unchanged (rule, file, literal, reason). Before folding, `npx tsx scripts/copy-census/run.ts --summary` showed every per-plan list at `live A=0 B=0 C=0 pinned A=0 B=0 C=0` and a programmatic read of `LEDGERS` gave 0 pending files and a pin sum of 32 equal to the rows. After: `remaining files=0 A=0 B=0 C=0 exceptions=36`. No exception's subject was deleted by Task 2, so the pin did not move. The former-name arm now counts `EXCEPTIONS` alone and still finds exactly one row (`A|src/lib/glossary.ts`); `Bridge` is still a case-sensitive retired word (`RETIRED_WORDS` untouched, `scan.test.ts` lowercase arm untouched).

## gc-201-23-neuter lines

- gc-201-23-neuter: gate=copy-census.test.ts rule A (a retired word) result=red restored=identical. Neuter: `<span>Saved portfolios</span>` inserted next to `{item.label}` in `src/components/layout/Sidebar.tsx`. RED: `unregistered: src/components/layout/Sidebar.tsx:507 rule A: "Saved portfolios" is not a reasoned exception in policy EXCEPTIONS` (1 failed, 20 passed). `cp -p` back, `cmp` exit 0.
- gc-201-23-neuter: gate=copy-census.test.ts rule B (an unwrapped registered term) result=red restored=identical. Neuter: unwrapped `<Term k="scenario">Scenario</Term> blend` in `ScenarioComposer.tsx` (a Term this phase added by plan 201-34). RED: `unregistered: src/app/(dashboard)/allocations/components/ScenarioComposer.tsx:6029 rule B: "Scenario blend" is not a reasoned exception in policy EXCEPTIONS`. `cmp` exit 0.
- gc-201-23-neuter: gate=copy-census.test.ts rule C (a locale date call) result=red restored=identical. Neuter: `<span>{new Date().toLocaleDateString()}</span>` in `Sidebar.tsx`. RED: `unregistered: src/components/layout/Sidebar.tsx:506 rule C: "new Date().toLocaleDateString()" is not a reasoned exception in policy EXCEPTIONS`. `cmp` exit 0.
- gc-201-23-neuter: gate=copy-census.test.ts pin and stale (T-201-30, an exception row deleted from policy.ts) result=red restored=identical. Neuter: removed the `Scenario comparison` row. RED: `unregistered: ...ScenarioCompareTable.tsx:267 rule B: "Scenario comparison" ...` plus the pin arms `pins the exception count at the merged total` and `pins the EXCEPTIONS list at its typed rows, in both directions` (3 failed). `cmp` exit 0.
- gc-201-23-neuter: gate=tearsheet/page.test.tsx "has no [data-term] and no Term tab stop" result=red restored=identical. Neuter: `return printView ? <PlainTerms>{tree}</PlainTerms> : tree;` replaced by `return tree;` in `FactsheetView.tsx`. RED: `AssertionError: expected <span tabindex="0" ...></span>` (1 failed, 50 passed). `cmp` exit 0.
- Task 2 RED before implementation: `formatCloseDay.length` expected 1 got 2; `utils` still had `formatAbsoluteDate`; the widget test read "this book" against "this allocation"; the `@ts-expect-error` for the `book` noun was `TS2578 Unused '@ts-expect-error' directive` under `tsc` until the member was removed.

## Verify commands (real output)

| Command | Result |
|---------|--------|
| `node scripts/verify-plan-anchors.mjs <201-23-PLAN.md>` | `claims: 4 checked`, `OK: 1 plan file(s), no stale claims.` exit 0 |
| `npx vitest run src/__tests__/copy-census.test.ts scripts/copy-census/scan.test.ts` | 2 files, 97 passed, 0 failed |
| `test ! -d scripts/copy-census/ledgers` | exit 0 |
| `grep -a -c -- "--ledger" scripts/copy-census/run.ts` | 0 |
| Task 2: `npx vitest run src/lib/utils.test.ts src/lib/factsheet/returns-unit.test.ts src/lib/factsheet/joint.test.ts "src/app/(dashboard)/allocations/widgets/attribution/" src/__tests__/copy-census.test.ts` | 7 files, 175 passed, 0 failed |
| `grep -a -c "@deprecated" src/lib/utils.ts` | 0 (was 2) |
| `grep -a -c "opts?: { year" src/lib/factsheet/returns-unit.ts` | 0 (was 1) |
| Task 3: `npx vitest run "src/app/factsheet/[id]/tearsheet/" src/lib/glossary.test.ts src/components/strategy/discovery-columns.tooltips.test.ts src/__tests__/copy-census.test.ts` | 7 files, 120 passed, 0 failed |
| `npx eslint` (the plan's file list, plus `scripts/copy-census` and the census test earlier) | exit 0 |
| `npm run typecheck` | exit 0 (run after Task 1, Task 2 and Task 3) |

gc-201-23-gates: vitest=green eslint=clean tsc=clean

## Deviations from plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] The alpha-beta widget test failed at HEAD on a Term wrap, inside this plan's verify set**
- **Found during:** Task 2
- **Issue:** `AlphaBetaDecomposition.book-btc.test.tsx` read the alpha cell as `screen.getByText("α vs BTC").parentElement`. Since the label became a `Term` (an earlier wave), that parent is the Term's wrapper span, so three arms failed on a clean HEAD (confirmed by running the HEAD copy of the file as a scratch test and deleting it). The task verify runs this directory, so it could not go green without the fix.
- **Fix:** both locators now read `.closest("p")!.parentElement!` (the label's paragraph, then the cell). The sentence assertion and the comment moved to "allocation".
- **Files modified:** `AlphaBetaDecomposition.book-btc.test.tsx`
- **Commit:** 3a11fbcbd

**2. [Rule 1 - cleanup] The OWNERSHIP table, `ownerOf` and the `Ledger` type were removed**
- **Issue:** the plan's fold text names the ledgers, `run.ts` and the test but not the ownership table. Without ledgers nothing reads it, and `scan.test.ts` carried a 140-line `OWNERSHIP` describe pinning it.
- **Fix:** removed the table, helper, type and that describe (`scan.test.ts` is in `files_modified`).
- **Commit:** 2be3fe9d0

**3. [Rule 3 - mount idiom] The tearsheet page test now delegates its `FactsheetView` stub**
- **Issue:** the file stubs `FactsheetView` to a recorder, so a neuter of `FactsheetView`'s print path could not turn the page test RED.
- **Fix:** the stub renders the real view only when a hoisted `renderReal` flag is set (reset in `beforeEach`), and the mocks gained `useRouter` and `@/lib/sentry-capture`, which only the real view reads. Every other arm in the file still sees the recorder.
- **Commit:** 3510193f2

## Reported, not edited

- `scripts/copy-census/scan.ts` header still says "a ledger's pending count moves by one when one string is fixed" (stale prose, not in this plan's file list).
- `src/components/strategy/StrategyTable.manager-rows.test.tsx` line 718 has a comment naming `formatIsoDay`, now deleted (comment only, not in this plan's file list).
- No phase-200 file was touched, so nothing is recorded for `ApiKeyManager.tsx`, `ConfirmKeyChangeDialog.tsx`, `e2e/api-key-flow.spec.ts` or `e2e/sync-analytics-flow.spec.ts`.

## Known Stubs

None.

## Threat Flags

None. No endpoint, auth path, file access or schema surface was added. T-201-30 is mitigated as planned: count pin, stale rule and closed reason set, each seen to fail.

## Self-Check: PASSED

- FOUND: scripts/copy-census/policy.ts, scripts/copy-census/run.ts, src/__tests__/copy-census.test.ts, src/lib/utils.ts
- MISSING (intended): scripts/copy-census/ledgers/
- FOUND: 2be3fe9d0, 3a11fbcbd, 3510193f2 are ancestors of HEAD (`git rev-list --count 09ff9a2153cca19e60dd3ab6f22a6a3c335cd571..HEAD` = 3 before this summary commit)
