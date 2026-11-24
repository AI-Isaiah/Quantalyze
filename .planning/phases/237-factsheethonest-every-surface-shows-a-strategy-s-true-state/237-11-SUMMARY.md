---
phase: 237-factsheethonest-every-surface-shows-a-strategy-s-true-state
plan: 11
subsystem: testing
tags: [census, source-scan, fact-02, sc-2, vitest]
requires:
  - phase: 237 plans 01-10, 12, 13
    provides: analyticsHold, every holding surface, retired-surface removals
provides:
  - "src/__tests__/recompute-verdict-census.test.ts: the (file, symbol) call-site census of the recompute verdict, the FACT-02 surface ledger, the retired-surface assertions and planted self-tests"
affects: [237 ship step, 164.6.6.3.3-WITHHELD-RESIDUE close, 190-RERUN-SURFACES-NOT-HOLDING close]
tech-stack:
  added: []
  patterns: ["count-keyed (file, symbol) census with a closed class set, stale-entry failure, anti-vacuity floors and temp-directory self-tests"]
key-files:
  created:
    - src/__tests__/recompute-verdict-census.test.ts
  modified: []
key-decisions:
  - "One class per (file, symbol) pair; the two mixed pairs say so in their reason and are pinned by exact count"
  - "strategies/page.tsx share-note pair is classified progress-terminal PROVISIONALLY and reported as finding F-1; the orchestrator decides"
  - "No repo-wide pin moved: copy-census, figure-gate-census, complete-status-scan, FactsheetBody.census and degrade-warning-scan were green untouched"
status: complete
commits: 2
plan_head_before: 06603e03aefa4d868839c05a4a7dd1a4fc3c3e17
plan_head_after: 8f958b605cd063474c49024194cfcf828caf247c
actuals:
  tokens: 11000
  tasks: 2
  commits: 2
---

# Phase 237 Plan 11: Recompute verdict census Summary

**A census test keys every reader of the recompute verdict by (file, symbol) with an exact count and one of seven classes, asserts the founder's FACT-02 surfaces live, census-only or write-gate, asserts the retired surfaces gone, and was proven RED on a deleted row and on a neutered judge.**

Agent branch: `worktree-agent-a2ab397dd80465b6e`. Re-based to `06603e03aefa4d868839c05a4a7dd1a4fc3c3e17` before any work. `plan_head_after` above is the last code commit (the commit count of 2 is the two task commits); this SUMMARY's own commit sits on top of it.

## Accomplishments

- `src/__tests__/recompute-verdict-census.test.ts` (new, 14 tests): walks every non-test `.ts` and `.tsx` under `src/` (755 files), comment-stripped with `stripCommentsPreserveLines`, and counts per file the call sites of the ten scanned symbols (`isComputedAnalytics`, `isRankableAnalyticsRow`, `isRecomputeOverStoredResult`, `hasStoredAnalyticsResult`, `hasUnboundDerivePrestamp`, `isStoredResultReadable`, `storedCashHeadlineGate`, `usesLastSuccessSnapshot`, `effectiveDataQualityFlags`, `analyticsHold`) and the four success-literal comparisons (`===` and `!==` against `"complete"` and `"complete_with_warnings"`, both operand orders).
- 74 (file, symbol) pairs found on the merged tree, all classified. By class: `definition` 12, `holds` 18, `other-table` 10, `owner` 17, `percentile-cohort` 1, `progress-terminal` 12, `write-gate` 4. (Printed by the test as `recompute-verdict-census: walked=755 pairs=74 classified=74 ...`.)
- Failure wording names the file, the symbol, both counts and the legal classes. A classified pair the walk no longer finds fails as stale; a count change fails with both counts; an illegal class or an empty reason fails.
- Surface ledger (10 rows), each asserted mechanically against stripped source: share card, tear sheet (page and PDF route), factsheet PDF route, returns API, recommendations, composer (strict `analytics_updating === true` parse, `ANALYTICS_UPDATING_LINE`, no verdict symbol called, book rows decided by `analyticsHold` in `queries.ts`), factsheet resolve stage (owner), Phase 190 lists (owner and holds), `getFactsheetDetail` (census-only: select still interpolates `PUBLIC_ANALYTICS_COLUMNS`, calls no verdict symbol), composite approval 409 (write-gate: exactly one `isRecomputeOverStoredResult(` and both `hasStoredAnalyticsResult(` sites).
- Retired surfaces asserted by the test: zero word-bounded non-test occurrences after comment stripping of `StrategyBreakdownTable`, `getStrategyDetailV2`, `getPublicStrategyDetail`, `getStrategyDetail` (every residual hit at HEAD is inside a comment), and `src/app/portfolio-pdf/[id]/page.tsx` imports none of `closed-sets`, `analytics-hold`, `stored-analytics-result`, `display-sign`.
- Anti-vacuity: walked floor 700 (measured 755), pair floor 70 (measured 74), every ledger anchor walked, nine anchors that carry a scanned symbol must have at least one pair, and the class set the map uses equals the legal set exactly. Nine planted self-tests (temp directory, `rmSync` in `finally`): unclassified reader, literal forms in both operators and operand orders, comment-only mention (no pair), test file not walked, stale entry, count change, illegal class and empty reason, planted retired symbol (and word-bound, and comment-only), portfolio PDF page importing a verdict module.

## Task commits

1. Task 1 (tracer): `cc583654f` test(237-11): recompute verdict census, FACT-02 surface ledger and retired-surface assertions
2. Task 1 follow-up: `8f958b605` test(237-11): census reasons cut back to what the code shows, matched-anchor assertion
3. Task 2: no commit, nothing was red that a pin edit could legitimately fix (see below). No pin file was edited.

The full `npm test` run below was at `cc583654f`. Only `src/__tests__/recompute-verdict-census.test.ts` changed afterwards (reasons reworded after review, one added assertion). The six pins and the PROOF-01 REDs were re-run on the final bytes.

## Findings and deviations

**F-1 (finding, needs an orchestrator decision): `src/app/(dashboard)/strategies/page.tsx::isComputedAnalytics` does not apply the held re-run verdict.** The owner-facing share-link note on `/strategies` starts at `isComputedAnalytics(embedStatus)`. A pending or computing row over a stored success is therefore "uncomputed" there, takes `uncomputedNote`, and `unbuildableNoteKindOf("not_computed")` answers null, so the note is `recipientShareNote(mode, arm)`. For a published strategy that is `PUBLIC_URL_NOTE`, "Right now, this strategy's factsheet link shows that the factsheet is not available yet." Meanwhile the factsheet resolve stage (Phase 190) admits that same row and the public factsheet shows held figures. For a private link the note says "being prepared ... numbers appear once a computation succeeds", which is likewise not what the held page shows. It is copy only (no figure), it predates this phase (Phase 167.2.1 D-04/D-08, Phase 190 did not touch it), and it is not on the founder's FACT-02 surface list, so I did not fix it (declared files only). None of the seven classes is a true description of it, so the census row is `progress-terminal` and its reason begins `PROVISIONAL, 237-11 finding F-1` and says the above. The plan's stop rule says an unclassifiable pair is a finding; I recorded it and finished the rest rather than leave the census unwritten, because the row is one line the orchestrator can reclassify (or the class set can gain a "divergence" class) without touching anything else. Decision needed: reclassify and book it, or route a fix.

**D-1 (deviation, recorded): `strategy-review/route.ts::hasStoredAnalyticsResult` is a mixed pair.** Site 1 (line ~267) feeds the first-pass gate (the plan lists the admin first-pass gate under `holds`), site 2 (line ~402) is the 409 re-check evidence rule (`write-gate`, founder's FACT-02 (c) ruling). One class per pair, so the pair is `write-gate` (the route is an approval write) and the reason says so; count 2 pins both. The founder's ruling covers only the 409 arm, so the first-pass half being `write-gate` rather than `holds` is my call.

**D-2 (mixed pair): `queries.ts::isRankableAnalyticsRow` count 4** is `percentile-cohort` for three cohort filters (`getPercentiles`, `getOwnRowPercentiles` and the cohort read) and the fourth is `shapeRowAnalytics`' terminal-success branch (owner). Exact count pins both.

**N-1 (note): `composite-read-path.ts::shouldReadCashSettlementSeries` and `shouldReadSingleKeyCashSeries` have no non-test caller at HEAD** (grep: only their docblocks name a future "first caller"). The two `isComputedAnalytics` sites are classified `owner` with that fact in the reason. They are exported dead code today; not a FACT-02 surface.

**N-2: `AdminTabs.tsx::isComputedAnalytics` and `strategy-health.ts::isComputedAnalytics`** are `holds`; reasons cite their git-measured origin (Phase 166.5 computed_at stamp and Phase 199 MANAGERHOME), not Phase 190.

No Rule 1 to 3 deviation. No migration, no analytics-service change, no undeclared file touched, `TODOS.md` untouched.

## Reasons that name a decision (all in the CENSUS map)

Resolve stage rows: Phase 190 plan 03 (three refusals, D-02 evidence rule, D-04 unbound prestamp). `analytics-hold.ts` rows: Phase 237 plan 01. Surface rows: Phase 237 plans 05 (share card, og-metrics), 06 (both PDF doors), 07 (recommendations, ruling 2), 13 (composer book rows). `strategyGate`: Phase 190 D-02. `compare/page.tsx`: Phase 190 plan 07. `StrategyTable`: Phase 190 OQ-2 default. `percentile-cohort`: Phase 190 OQ-2 default. Admin approval rows: Phase 190 D-02 and the founder's FACT-02 (c) ruling. Progress rows: `closed-sets.ts` "deliberately separate from isComputedAnalytics" plus per-site behaviour. Share-note row: Phase 167.2.1 D-08 (F-1). LP readiness: strict `complete` only by design (withhold plus fail-loud).

## PROOF-01 (final bytes)

Byte backup `cp`'d outside the repo, restored by `cp`, `cmp` exit 0 each time.

**RED 1: one real classification row deleted** (the share card's `analyticsHold` row; vitest `RUN` header line dropped because it carries a home path):

```
 ❯ |jsdom| src/__tests__/recompute-verdict-census.test.ts (14 tests | 1 failed) 48ms
   ❯ recompute verdict census (Phase 237 plan 11, SC-2) (14)
     × every reader of the recompute verdict is classified, with an exact count 14ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  |jsdom| src/__tests__/recompute-verdict-census.test.ts > recompute verdict census (Phase 237 plan 11, SC-2) > every reader of the recompute verdict is classified, with an exact count
AssertionError: unclassified: src/app/api/og/factsheet/[id]/route.tsx reads the recompute verdict through analyticsHold 1x and has no CENSUS row; classify it on purpose (legal classes: owner, holds, progress-terminal, percentile-cohort, write-gate, other-table, definition): expected [ Array(1) ] to deeply equal []
- Expected
+ Received
- []
+ [
+   "unclassified: src/app/api/og/factsheet/[id]/route.tsx reads the recompute verdict through analyticsHold 1x and has no CENSUS row; classify it on purpose (legal classes: owner, holds, progress-terminal, percentile-cohort, write-gate, other-table, definition)",
+ ]
 ❯ src/__tests__/recompute-verdict-census.test.ts:527:43
⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯
 Test Files  1 failed (1)
      Tests  1 failed | 13 passed (14)
```

Restored: `cmp exit=0`. GREEN: `Test Files  1 passed (1)` / `Tests  14 passed (14)`.

**RED 2: judge's unclassified branch neutered** (`if (!entry) continue;` inserted before the push). The real-tree case stays green (the real tree is fully classified, so there is nothing for the branch to catch there); the planted-reader arm is the census's own RED-capable arm and goes RED:

```
 ❯ |jsdom| src/__tests__/recompute-verdict-census.test.ts (14 tests | 1 failed) 41ms
   ❯ recompute verdict census (Phase 237 plan 11, SC-2) (14)
     ❯ self-test: the census can fire (planted files in a temp directory) (9)
       × an unclassified reader fails, naming the file and the symbol 9ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  |jsdom| src/__tests__/recompute-verdict-census.test.ts > recompute verdict census (Phase 237 plan 11, SC-2) > self-test: the census can fire (planted files in a temp directory) > an unclassified reader fails, naming the file and the symbol
AssertionError: expected '' to contain 'unclassified: src/lib/planted-reader.…'
- Expected
+ Received
- unclassified: src/lib/planted-reader.ts
 ❯ src/__tests__/recompute-verdict-census.test.ts:593:28
 Test Files  1 failed (1)
      Tests  1 failed | 13 passed (14)
```

Restored: `cmp exit=0`, GREEN again.

**RED 3 (earlier bytes, ledger arm): a ledger needle neutered** (`ANALYTICS_UPDATING_LINE` replaced by an absent name in the share card row):

```
AssertionError: surface: share card (OG route): src/app/api/og/factsheet/[id]/route.tsx no longer contains ANALYTICS_UPDATING_LINE_PLANTED_ABSENT: expected [ Array(1) ] to deeply equal []
 Tests  1 failed | 13 passed (14)
```

Restored by `cp`, `cmp exit=0`. (An earlier attempt at the neuter broke syntax and produced a parse failure, not a RED; it was discarded and restored, and is not counted.)

## Task 2: the full gate

Targeted pins, final bytes: `npx vitest run` on the census, `copy-census`, `figure-gate-census`, `complete-status-scan`, `FactsheetBody.census` and `degrade-warning-scan`: `Test Files  6 passed (6)`, `Tests  101 passed (101)`. No pin moved, so none of the five repo-wide pin files was edited.

`npm test` (once, on the merged tree at `cc583654f`): wall clock 823 s (about 13 min 43 s), exit 1:

```
 Test Files  10 failed | 1243 passed | 20 skipped (1273)
      Tests  11 failed | 26891 passed | 306 skipped (27208)
```

The non-zero exit against the plan's "npm test exits 0" criterion is stated plainly. The 11 failures:

- **Known pre-existing, not caused by this phase (orchestrator evidence: fails identically at the pre-phase base `4002cf06e`):** `src/lib/factsheet/compute.conventions.test.ts` fixture B (`a series with zero-return days`) and fixture C (`a series with interior calendar gaps`), both a FROZEN snapshot mismatch. Not edited.
- **Nine contention timeouts, each green alone.** Machine was shared with other agents. Messages in the log: four `Test timed out in 5000ms`, two `Test timed out in 30000ms`, one `ci-apt.sh --self-test ... SIGKILL (55 s spawn timeout)`, plus two assertion failures from the same loaded run. Files: `scripts/factsheet-census/count.test.tsx` (profile A), `mutation-annotation-parser.test.ts`, `mutation-runner-floors.test.ts`, `return-stats.single-source.test.ts`, `seam-venue-vocabulary.invariant.test.ts`, `contracts/ci-apt-bounded.contract.test.ts`, `contracts/ci-docs-path-filter.contract.test.ts`, `RiskTabPanel.book-series.test.tsx`, `FactsheetBody.advanced.test.tsx` (the same one plan 12 recorded). Re-run alone with `--maxWorkers=2`: `Test Files  9 passed (9)`, `Tests  485 passed (485)`. No code was changed for any of them.

`npm run typecheck`: green (`tsc --noEmit`, no output). `npm run lint` (run with this SUMMARY present): eslint 0 errors and 4 warnings, all in files this plan did not touch (unused `nativeUnitReason` import in `MetricsColumn.tsx`, unused `isRankableAnalyticsRow` import in `composite-read-path.ts`, unused `WARNED_ROW` and `COMPUTING_ROW` in `queries.stale-analytics-detail.test.ts`; unused-var warnings, not this plan's scope, recorded and left); then `check-admin-route-manifest`, `check-route-contract`, `check-planning-hygiene` (rules 1, 6, 7) and `check-canonical-domain` all OK.

## TODOS ids this phase closes

The five ids the ship step deletes from `TODOS.md` (this plan does not edit `TODOS.md`; `git diff --quiet 06603e03a..HEAD -- TODOS.md` exits 0):

| id | closed by (plan SUMMARY) |
|---|---|
| `164.6.6.3.3-WITHHELD-RESIDUE` | 237-03, 237-09, 237-12 |
| `[190-RERUN-SURFACES-NOT-HOLDING]` | 237-01, 237-05, 237-06, 237-07, 237-08, 237-13, and this census (237-11) as the closure evidence. Note F-1 above is a related surface the entry's closure basis (every FACT-02-listed live surface holds, retired ones gone, (c) ruled out) does not cover |
| `164.6.6.2.1-OWNER-TRUST-TIER-UNPUBLISHED` | 237-10 |
| `170.3-OG-NOTFOUND-CACHE` | 237-02 |
| `164.6.6.2.1-USDVIEW-READFAIL-CACHED` | 237-04 |

## Known Stubs

None.

## Threat Flags

None. A test file only; no endpoint, auth path or schema surface.

## Self-Check

PASSED. `src/__tests__/recompute-verdict-census.test.ts` exists; commits `cc583654f` and `8f958b605` are ancestors of HEAD; `TODOS.md` unchanged against the base; no home path or username in the test file or this SUMMARY (0 grep hits); the branch name and base sha above match `git rev-parse`.
