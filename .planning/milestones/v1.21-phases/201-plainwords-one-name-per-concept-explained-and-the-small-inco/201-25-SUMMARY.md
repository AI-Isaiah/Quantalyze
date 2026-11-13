---
phase: 201-plainwords-one-name-per-concept-explained-and-the-small-inco
plan: 25
subsystem: copy-census
tags: [census, ledgers, vitest, worklist-runner, retired-words, glossary, dates]
requires: [201-06, 201-07]
provides:
  - src/__tests__/copy-census.test.ts: the census over src/ (exact per-file per-rule counts, stale, ownership, closed reasons, pins, anti-vacuity, planted trees)
  - scripts/copy-census/ledgers/plan-08.ts .. plan-22.ts, plan-27.ts (sixteen modules) and index.ts (LEDGERS)
  - scripts/copy-census/run.ts: read-only worklist (--ledger, --file, --summary)
  - scripts/copy-census/scan.ts: listScannedFiles, the walker scanTree already used, now exported
affects: [201-08, 201-09, 201-10, 201-11, 201-12, 201-13, 201-14, 201-15, 201-16, 201-17, 201-18, 201-19, 201-20, 201-21, 201-22, 201-27, 201-23]
tech-stack:
  added: []
  patterns: [one ledger module per surface plan, exact per-file per-rule counts, exceptions consumed as a multiset, judge exercised on planted hits, read-only runner]
key-files:
  created:
    - src/__tests__/copy-census.test.ts
    - scripts/copy-census/run.ts
    - scripts/copy-census/ledgers/index.ts
    - scripts/copy-census/ledgers/plan-08.ts
    - scripts/copy-census/ledgers/plan-09.ts
    - scripts/copy-census/ledgers/plan-10.ts
    - scripts/copy-census/ledgers/plan-11.ts
    - scripts/copy-census/ledgers/plan-12.ts
    - scripts/copy-census/ledgers/plan-13.ts
    - scripts/copy-census/ledgers/plan-14.ts
    - scripts/copy-census/ledgers/plan-15.ts
    - scripts/copy-census/ledgers/plan-16.ts
    - scripts/copy-census/ledgers/plan-17.ts
    - scripts/copy-census/ledgers/plan-18.ts
    - scripts/copy-census/ledgers/plan-19.ts
    - scripts/copy-census/ledgers/plan-20.ts
    - scripts/copy-census/ledgers/plan-21.ts
    - scripts/copy-census/ledgers/plan-22.ts
    - scripts/copy-census/ledgers/plan-27.ts
  modified:
    - scripts/copy-census/scan.ts
    - scripts/copy-census/scan.test.ts
key-decisions:
  - "Every live hit is pending under its owner except the three policy-seeded exceptions; no new exception was classified (the plan's 'when unsure, choose pending')."
  - "The per-rule live-hit floor (wave-3 value divided by two) was NOT shipped; it is replaced by a walked-file floor, four walked anchors in every rule's scope, an owner for every walked path, and planted trees per rule (Deviation 1)."
  - "An exception row consumes one live hit with the same rule, file and exact (whitespace-normalised) text, so one row cannot cover two occurrences."
requirements-completed: [CLAR-03, CLAR-04, CLAR-06]
status: complete
duration: 10min
completed: 2026-11-11
actuals:
  tokens: 13400
  tasks: 2
  commits: 4
plan_head_before: a82abbc8724db28bcec22316b2f120c938cdd8b5
plan_head_after: 7c15c892b
---

# Phase 201 Plan 25: the copy census ledgers and gate Summary

The census test now runs plan 201-06's scanner over `src/`, and every one of the 463 live offenders sits on a named surface plan's ledger at an exact per-file per-rule count. It goes red on a new retired word, an unwrapped registered term or a non-helper date, and a read-only runner prints each plan's worklist.

## Performance

About 10 minutes. `commits: 4` is `git rev-list --count a82abbc87..HEAD` with this SUMMARY's own commit included; `plan_head_after` is the last code commit (the SUMMARY commit follows and cannot name itself).

## Task Commits

| Commit | Type | What |
|--------|------|------|
| 90a835827 | test | RED: census test, judge and planted arms, empty ledgers, `listScannedFiles` export with an arm |
| bd33cced5 | feat | GREEN: sixteen ledgers with exact counts, the index, `run.ts` |
| 7c15c892b | test | Task 2: ownership, duplicate, closed reasons, pins, typed policy lists, anti-vacuity, planted trees |
| (this commit) | docs | SUMMARY |

TDD: the RED commit is a real assertion failure, not an unresolved import. With the ledgers scaffolded empty, the first test failed with 158 `unregistered: <file> rule <X>: n live hit(s), none pinned in any ledger` problems against the live tree (`expected [ ...(158) ] to deeply equal []`); the planted judge arms were green. The real ledgers then made it green.

## What was built

- `src/__tests__/copy-census.test.ts` (header sections THE PROPERTY, ORACLE INDEPENDENCE, HOW A FILE IS READ, THE LEDGERS, THE STRUCTURE RULES, ANTI-VACUITY; names plan 201-23 as the plan that deletes the ledgers and folds the exceptions; states that a surface plan never edits `scan.ts`, `policy.ts` or another plan's ledger). It scans once in `beforeAll`, applies `EXCEPTIONS` and every ledger's `exceptions` as a multiset, then for each file and rule compares the live count with the summed pinned count: `unregistered`, `stale` or `count: <file> rule <R>: pinned P, live L (delta +/-n)`. A second judge enforces ownership (`ownership: <file> belongs to <owner>, listed in <ledger>`), no file in two ledgers (`duplicate:`), reasons in the closed set and longer than 20 characters, and `exceptions.length === pinnedExceptionCount` per ledger. It prints `copy-census: walked=… A=… B=… C=… pending=… exceptions=…`.
- `scripts/copy-census/ledgers/`: sixteen modules and `index.ts` exporting `LEDGERS`, generated once by a throwaway script in the scratchpad (not committed) that called `scanTree` with the policy, netted out the three seeded exceptions and grouped by `ownerOf` and rule. Every module is written, `pending: {}` where an owner has no hits (none is empty today).
- `scripts/copy-census/run.ts`: `--ledger plan-NN`, `--file <path>`, `--summary`. Prints `<rule> <file>:<line> <text>` (repo-relative path, line, matched copy), net of exceptions. `grep -a -c "writeFile" scripts/copy-census/run.ts` prints 0 (the word is kept out of comments too). It also marks `MISMATCH` in `--summary` if a ledger's pinned counts differ from live.
- `scan.ts` exports `listScannedFiles` (the walker `scanTree` already used); `scan.test.ts` has an arm for it. This lets the census count `walked` from the walker itself.

## Verification

- `node scripts/verify-plan-anchors.mjs <plan>`: OK, 6 claims, no stale.
- `npx vitest run src/__tests__/copy-census.test.ts scripts/copy-census/scan.test.ts src/__tests__/figure-gate-census.test.ts src/__tests__/public-truth-census.test.tsx src/__tests__/no-email-in-copy.test.ts`: 5 files, 259 tests green. The census changes none of the three always-run guards.
- Measured on the wave-3 tree: `walked=750 A=218 B=199 C=49` raw hits; `pending=463` (A 215 + B 199 + C 49; the 466 raw hits less the 3 consumed by `EXCEPTIONS`), `exceptions=3`. The `--summary` output is below.
- `ls scripts/copy-census/ledgers/plan-*.ts | wc -l` prints 16.
- `gc-201-25-gates: vitest=green eslint=clean tsc=clean`

### `npx tsx scripts/copy-census/run.ts --summary`

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
plan-22  files=9  live A=16 B=10 C=0  pinned A=16 B=10 C=0
plan-27  files=4  live A=18 B=8 C=1  pinned A=18 B=8 C=1
total  live A=215 B=199 C=49
```

scanner-fixes: none. No false-positive or missed class was found on the live tree that the contract would not already allow (see "Classes the owners must rule on" below), so `scan.ts` changed only by exporting `listScannedFiles`.

## Neuter proofs (each: `cp -p` backup to the scratchpad, neuter, RED naming the cause, `cp -p` back, `cmp` exit 0, GREEN)

The three required lines (command for each: `npx vitest run src/__tests__/copy-census.test.ts`):

- `gc-201-25-neuter: gate=A result=red restored=identical` Appended `export const NEUTER_A = "Your portfolio is empty";` to `src/lib/degrade-warnings.ts`, ledger untouched. RED: `count: src/lib/degrade-warnings.ts rule A: pinned 5, live 6 (delta +1)`.
- `gc-201-25-neuter: gate=B result=red restored=identical` Appended `export const NeuterB = () => <span>Sharpe</span>;` to `src/components/layout/Sidebar.tsx`. RED: `count: src/components/layout/Sidebar.tsx rule B: pinned 1, live 2 (delta +1)`.
- `gc-201-25-neuter: gate=C result=red restored=identical` Appended a bare `d.toLocaleDateString()` to `src/lib/degrade-warnings.ts`. RED: `unregistered: src/lib/degrade-warnings.ts rule C: 1 live hit(s), none pinned in any ledger`.

Break-the-input proofs for the structure and anti-vacuity arms (same backup discipline, each restored with `cmp` exit 0):

| gate | input broken | RED |
|------|--------------|-----|
| ownership and duplicate | plan-12's ledger given a plan-16 file | `ownership: …discovery-columns.ts belongs to plan-16, listed in plan-12` and `duplicate: …` |
| pin | plan-08 `pinnedExceptionCount` set to 1 | `pin: plan-08 pins 1 exception(s) but lists 0` |
| closed reason | a ledger exception with a free-text reason | `reason: exception in plan-17 ledger for …WatchlistTabs.tsx "My Watchlist" has a reason outside the closed set…` |
| typed policy list | the `resilient-fetch.ts` row removed from `EXCLUDED_FILES` | `pins the policy EXCLUDED_FILES list at its typed rows` fails (and the file's hit is unregistered) |
| anchor | one anchor pointed at a missing file | `walks every anchor file, and every rule covers it` fails |

## Deviations from Plan

**1. [Rule 1 - Bug in the plan] No per-rule floor on live hits; replaced by checks wave 4 cannot lower.** Task 2 asked for a floor on each rule's live total of half the wave-3 value (A 109, B 99, C 24). Wave 4 exists to take every count to zero and plan 201-23 asserts zero, so such a floor goes red at the wave-4 merge for finishing the job, and no wave-4 plan owns this test file. A hit-count floor also cannot tell "fixed" from "scanner blind": while any ledger is non-empty the exact-count rule already catches a blind scanner (ledger says 20, scan finds 0, `stale`), and at zero the planted trees are the proof. What shipped instead, none of which wave 4 can lower: a walked-file floor of 375 (half the measured `walked=750`), the four named anchors asserted as walked and inside every rule's scope (not as having hits; Sidebar's one rule B hit is plan-14's to remove), every walked path having an owner, and a planted tree per rule through `scanTree` and the judge. Flagged for the orchestrator to overrule.

**2. [Note] `EXCEPTIONS` holds three rows, not four.** The plan 201-06 SUMMARY says four; `policy.ts` has three (two `— No preference —`, one `PORTFOLIO`). The census pins what the file has.

**3. [Rule 3 - blocking] `scan.ts` export.** Counting `walked` needed the file list, and `scanTree` returned hits only. I exported `listScannedFiles` (the existing walker, extracted) rather than writing a second walker that could drift, with a planted arm in `scan.test.ts`. No behaviour change to `scanTree`.

No other deviation. No scanner defect was fixed; no exception was added to `policy.ts`.

## Classes the owners must rule on (named doubtful classes, all pending)

Per the plan ("when unsure, choose pending") these are ledgered as pending, and the owning plan may move any of them to an exception with a closed-set reason:

- Thrown `Error` messages in lib (`portfolio-exposure.ts`, `queries.ts`): rule A reports them, the contract does not skip `new Error(...)` arguments, and `err.message` often reaches the UI. Plan-22's call.
- Internal note strings in `src/lib/wizardErrors.ts` (concatenated developer prose naming `portfolio-optimizer`, `_compute_portfolio_analytics`, and so on). Plan-19's call: likely `not user-visible:` exceptions, each with a reason.
- API JSON error strings under `src/app/api/` (plan-21): user-visible when a client shows them.
- Email HTML in `src/lib/email.ts` (plan-22) and metadata `description` strings in `(marketing)/security/page.tsx` (plan-22).
- Rule C month-name arrays and chart tick formatters (`EquityChart` month ticks, `trade-fetch-lines.tsx`, `returns-unit.ts`, heatmap and `TimeSeriesChart`): a plain axis tick is a `chart axis tick (D-21)` exception, a hover or cell title is not (U-15); I did not read each to decide, so all are pending.
- Ownership as applied literally (plan 201-06 Deviation 5): `ScenarioFlaggedHoldingsList.tsx` and `ScenarioStub.tsx` are plan-15's.

## Known limits

- The census inherits the scanner's heuristics (a retired word assembled at run time or split across JSX elements is invisible; a lowercase single token outside a copy-named position is treated as an identifier). Plan 06's header lists them.
- An exception's literal must equal the hit's text after whitespace normalisation, so a surface plan copies the text `run.ts` prints (JSX entities such as `&apos;` appear as written).
- The ledgers fix counts at the wave-3 tree. If plan 201-26 changed copy the census matches, its merge turns a ledger red in that file; that is plan 201-26's defect, not a ledger to raise (`census-neutral` is that plan's record).

## wave-4 worklist

| ledger | files | A | B | C |
|--------|-------|---|---|---|
| plan-08 | 1 | 0 | 45 | 1 |
| plan-09 | 5 | 4 | 36 | 1 |
| plan-10 | 9 | 4 | 0 | 6 |
| plan-11 | 1 | 33 | 1 | 1 |
| plan-12 | 10 | 22 | 9 | 0 |
| plan-13 | 11 | 41 | 10 | 0 |
| plan-14 | 15 | 6 | 19 | 10 |
| plan-15 | 8 | 14 | 5 | 2 |
| plan-16 | 8 | 2 | 36 | 6 |
| plan-17 | 6 | 6 | 3 | 2 |
| plan-18 | 12 | 3 | 7 | 6 |
| plan-19 | 4 | 13 | 10 | 0 |
| plan-20 | 13 | 19 | 0 | 11 |
| plan-21 | 12 | 14 | 0 | 2 |
| plan-22 | 9 | 16 | 10 | 0 |
| plan-27 | 4 | 18 | 8 | 1 |
| total | 128 | 215 | 199 | 49 |

## Known Stubs

None.

## Threat Flags

None. Test and script tier only; nothing ships to the browser, no package added. `run.ts` prints repo-relative paths, line numbers and matched copy only, and reads no environment (T-201-09).

## Self-Check: PASSED

- FOUND: src/__tests__/copy-census.test.ts, scripts/copy-census/run.ts, scripts/copy-census/ledgers/index.ts and 16 `plan-*.ts` modules
- FOUND commits: 90a835827, bd33cced5, 7c15c892b, ancestors of HEAD on wt/201-p25
- STATE.md and ROADMAP.md untouched
