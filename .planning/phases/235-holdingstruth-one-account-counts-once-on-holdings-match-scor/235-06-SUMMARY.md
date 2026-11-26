---
phase: 235-holdingstruth-one-account-counts-once-on-holdings-match-scor
plan: 06
subsystem: allocations-ui
tags: [hold-05, missing-data-message, degrade-registry, proof-01]
requires: ["235-04", "235-05"]
provides:
  - "missingDataLines sharedFailingGroups argument and the shared-account coverage rule"
  - "registry entry allocation.key-gap.shared-account-failing-undated"
  - "Overview wire-up of the payload's sharedAccountFailingGroups"
affects: ["/allocations missing-data message"]
tech-stack:
  added: []
  patterns: ["undated labelled line from a registry entry rendered at a literal-id site"]
key-files:
  created:
    - src/app/(dashboard)/allocations/AllocationDashboardV2.shared-account-named.test.tsx
  modified:
    - src/app/(dashboard)/allocations/components/MissingDataMessage.tsx
    - src/app/(dashboard)/allocations/components/MissingDataMessage.test.tsx
    - src/lib/degrade-warnings.ts
    - src/lib/degrade-warnings.test.tsx
    - src/__tests__/degrade-warning-scan.test.ts
    - src/app/(dashboard)/allocations/AllocationDashboardV2.tsx
decisions:
  - "Undated copy adopted verbatim from RESEARCH (planner decision 1); scope key, never key_day."
  - "The two-key literal of CONTEXT bullet 4 is no longer GREEN-only: under the S1 correction it prints the undated labelled line, so it is RED at HEAD (arm M6)."
  - "RED fixture is two all-failing accounts (four keys), not CONTEXT's literal two keys (CD-4)."
metrics:
  duration: "about 25 minutes"
  completed: "2026-11-26"
status: complete
estimate_actuals_note: "estimate carried tokens 85000"
actuals:
  tokens: 5850
  tasks: 2
  commits: 3
plan_head_before: baa642faa2cd282e87168ec12ff7f506280a942c
plan_head_after: aab15d8fc93017e56fd6ba8fb2e8c69c86b4b795
commits: 3
---

# Phase 235 Plan 06: every failing shared-account key is named Summary

`missingDataLines` now takes the payload's attributed all-failing shared accounts and names every one of them by label. A second account whose history reaches yesterday (no dated gap) gets its own undated line from the new registry entry `allocation.key-gap.shared-account-failing-undated`, and the book fallback prints only for a group with a key the owner's list cannot label.

`commits: 3` is the measured count of task commits at SUMMARY write (`git rev-list --count ${plan_head_before}..HEAD`); the SUMMARY commit follows it. `actuals.tokens` is chars/4 over the realized diff (23410 chars).

## What was built

- **Rule (MissingDataMessage.tsx).** Optional `sharedFailingGroups` (absent, null or `[]` is byte-identical to before). A group is named by a printed dated gap carrying exactly its ids (sorted id lists compared), else by an undated labelled line when no gap of that cause carries those ids and every id labels via `apiKeyLabelById(apiKeys)`, else not named. `shared_account_failing` joins `causesPrinted` only when every group is named, and is deleted otherwise. Undated lines join `keyLines` before the existing sort.
- **Registry (degrade-warnings.ts).** One entry directly after `allocation.key-gap.shared-account-failing`: class `degrade`, scope `key`, action `A-FIX-ONE-OF-THESE`, text `<labels>: these keys read one exchange account and every one of them is failing to sync. ` plus the action sentence. No day.
- **Overview (AllocationDashboardV2.tsx).** `sharedFailingGroups: sharedAccountFailingGroups` in the existing `missingDataLines` call and the `useMemo` dependency list. Plan 04's Mount A is untouched.
- **Gates.** Arms M1 to M8 (MissingDataMessage.test.tsx), registry `SAMPLES` row and pin arm (degrade-warnings.test.tsx), `[MISSING_DATA]` ledger id (degrade-warning-scan.test.ts, `tripHits` unchanged and measured green), new file with O1 and O2.

## Deviations from Plan

1. **[Rule 1 - Bug] Typecheck failure in my own new test.** `A_GAP` was declared `as const`, making `apiKeyIds` readonly, which `npm run typecheck` rejected (TS2322). Fixed by typing it `KeyDataGap` (commit `aab15d8fc`). No behaviour change.
2. **Observation, not changed.** Step (e) of the plan adds `shared_account_failing` to `causesPrinted` when every group is named. If a payload carried an UNPRINTED shared-account gap whose ids match no group, that gap would no longer hold the fallback. The producer derives gaps and groups from the same source, so this needs a skewed payload; the plan's rule was implemented as written and no arm covers it.
3. **Transcript note.** Each transcript below shows `(cmp: identical)` after the silent `cmp`; that line is echoed by my wrapper only when `cmp` exits 0. `cmp` itself printed nothing.
4. **Conflict note (CLAUDE.md Rule 7), resolved toward S1.** UI-SPEC `## UI Considerations` row zero-one-many still says "One all-failing account reaching yesterday prints the fallback only". That contradicts UI-SPEC S1 and CONTEXT's dated correction; this plan follows S1 (such an account prints its undated labelled line and no fallback, arm M6). The stale UI-SPEC sentence is flagged for the records pass, not edited here.

## Pre-existing skip (not this plan's)

The sweep's 1 skipped test is `src/app/api/allocator/scenario/commit/route.test.ts` > `T_R8` live-DB arm (`[live-DB] second bridge_recommended commit REUSEs ...`, needs a seeded Supabase). It is a pre-existing `skipIf`, outside plans 04 to 06.

## PROOF-01 transcripts (verbatim; `$SCRATCH` is the session scratchpad, backups under `p235/plan-06/`)

### Pre-fix RED (Task 1 Step 1: tests added, component untouched)

Command: `npx vitest run "src/app/(dashboard)/allocations/components/MissingDataMessage.test.tsx"`

M1 (only A's line prints, B is named nowhere):

```
 FAIL  |jsdom| ... > Phase 235 HOLD-05: every failing shared-account key is named > M1: two all-failing accounts, A dated and B reaching yesterday: A's line, then B by label, and no fallback
AssertionError: expected [ Array(1) ] to deeply equal [ …(2) ]

- Expected
+ Received

  [
    "Binance — a1 and Binance — a2: no data for Oct 5, 2026 – Oct 11, 2026. Fix or reconnect one of these keys on the Exchanges page.",
-   "Binance — b1 and Binance — b2: these keys read one exchange account and every one of them is failing to sync. Fix or reconnect one of these keys on the Exchanges page.",
  ]
```

M6 (the book fallback prints instead of the undated line):

```
 FAIL  |jsdom| ... > M6: one all-failing account reaching yesterday (no gap) prints its undated labelled line and no fallback
AssertionError: expected [ Array(1) ] to deeply equal [ Array(1) ]

-   "Binance — b1 and Binance — b2: these keys read one exchange account and every one of them is failing to sync. Fix or reconnect one of these keys on the Exchanges page.",
+   "The equity chart and the ratios built from it are hidden for your whole history. The keys that read one of your exchange accounts are all failing to sync, so that account's history stops. Fix or reconnect one of them on the Exchanges page.",
```

Summary line: `Tests  6 failed | 57 passed (63)` (M1, M2, M3, M4, M6, M8 RED; M5 and M7 pass on pre-fix code by design, they are pinned by Q5 and Q6).

O1 pre-fix RED (Task 2 Step 1, Overview not yet wired):

```
 FAIL  |jsdom| ...AllocationDashboardV2.shared-account-named.test.tsx > AllocationDashboardV2: the payload's shared-account groups reach the missing-data message (HOLD-05) > O1: a two-account payload names every failing key and prints no book fallback
AssertionError: expected 'What is missingBinance — a1 and Binan…' to contain 'Binance — b1 and Binance — b2: these …'

Expected: "Binance — b1 and Binance — b2: these keys read one exchange account and every one of them is failing to sync."
Received: "What is missingBinance — a1 and Binance — a2: no data for Oct 5, 2026 – Oct 11, 2026. Fix or reconnect one of these keys on the Exchanges page."
 Test Files  1 failed (1)
      Tests  1 failed | 1 passed (2)
```

### Neuter transcripts

#### Q1 (MissingDataMessage.tsx): skip the undated push. Expected RED: M1, M6.

```
$ cp 'src/app/(dashboard)/allocations/components/MissingDataMessage.tsx' "$SCRATCH/235-06-Q1.bak"
$ npx vitest run src/app/(dashboard)/allocations/components/MissingDataMessage.test.tsx (neutered: Q1)
 FAIL src/app/(dashboard)/allocations/components/MissingDataMessage.test.tsx > Phase 235 HOLD-05: every failing shared-account key is named > M1: two all-failing accounts, A dated and B reaching yesterday: A's line, then B by label, and no fallback
 FAIL src/app/(dashboard)/allocations/components/MissingDataMessage.test.tsx > Phase 235 HOLD-05: every failing shared-account key is named > M2 (P1): B's line states no 'no complete history yet' and no date
 FAIL src/app/(dashboard)/allocations/components/MissingDataMessage.test.tsx > Phase 235 HOLD-05: every failing shared-account key is named > M3 (P2): each account's line names only its own keys
 FAIL src/app/(dashboard)/allocations/components/MissingDataMessage.test.tsx > Phase 235 HOLD-05: every failing shared-account key is named > M6: one all-failing account reaching yesterday (no gap) prints its undated labelled line and no fallback
 FAIL src/app/(dashboard)/allocations/components/MissingDataMessage.test.tsx > Phase 235 HOLD-05: every failing shared-account key is named > M8: undated lines join the key lines before the sort, whatever the group input order
 Test Files  1 failed (1)
      Tests  5 failed | 58 passed (63)
$ cp "$SCRATCH/235-06-Q1.bak" 'src/app/(dashboard)/allocations/components/MissingDataMessage.tsx'
$ cmp "$SCRATCH/235-06-Q1.bak" 'src/app/(dashboard)/allocations/components/MissingDataMessage.tsx'   # silent
(cmp: identical)
$ npx vitest run src/app/(dashboard)/allocations/components/MissingDataMessage.test.tsx (restored)
 Test Files  1 passed (1)
      Tests  63 passed (63)
```

#### Q2 (MissingDataMessage.tsx): render the undated group through `GapLine` with cause `shared_account_failing` and null coverage. Expected RED: M2.

```
$ cp 'src/app/(dashboard)/allocations/components/MissingDataMessage.tsx' "$SCRATCH/235-06-Q2.bak"
$ npx vitest run src/app/(dashboard)/allocations/components/MissingDataMessage.test.tsx (neutered: Q2)
 FAIL src/app/(dashboard)/allocations/components/MissingDataMessage.test.tsx > Phase 235 HOLD-05: every failing shared-account key is named > M1: two all-failing accounts, A dated and B reaching yesterday: A's line, then B by label, and no fallback
 FAIL src/app/(dashboard)/allocations/components/MissingDataMessage.test.tsx > Phase 235 HOLD-05: every failing shared-account key is named > M2 (P1): B's line states no 'no complete history yet' and no date
 FAIL src/app/(dashboard)/allocations/components/MissingDataMessage.test.tsx > Phase 235 HOLD-05: every failing shared-account key is named > M6: one all-failing account reaching yesterday (no gap) prints its undated labelled line and no fallback
 FAIL src/app/(dashboard)/allocations/components/MissingDataMessage.test.tsx > Phase 235 HOLD-05: every failing shared-account key is named > M8: undated lines join the key lines before the sort, whatever the group input order
 Test Files  1 failed (1)
      Tests  4 failed | 59 passed (63)
$ cp "$SCRATCH/235-06-Q2.bak" 'src/app/(dashboard)/allocations/components/MissingDataMessage.tsx'
$ cmp "$SCRATCH/235-06-Q2.bak" 'src/app/(dashboard)/allocations/components/MissingDataMessage.tsx'   # silent
(cmp: identical)
$ npx vitest run src/app/(dashboard)/allocations/components/MissingDataMessage.test.tsx (restored)
 Test Files  1 passed (1)
      Tests  63 passed (63)
```

#### Q3 (MissingDataMessage.tsx): the undated line's labels are every group's labels. Expected RED: M3.

```
$ cp 'src/app/(dashboard)/allocations/components/MissingDataMessage.tsx' "$SCRATCH/235-06-Q3.bak"
$ npx vitest run src/app/(dashboard)/allocations/components/MissingDataMessage.test.tsx (neutered: Q3)
 FAIL src/app/(dashboard)/allocations/components/MissingDataMessage.test.tsx > Phase 235 HOLD-05: every failing shared-account key is named > M1: two all-failing accounts, A dated and B reaching yesterday: A's line, then B by label, and no fallback
 FAIL src/app/(dashboard)/allocations/components/MissingDataMessage.test.tsx > Phase 235 HOLD-05: every failing shared-account key is named > M3 (P2): each account's line names only its own keys
 FAIL src/app/(dashboard)/allocations/components/MissingDataMessage.test.tsx > Phase 235 HOLD-05: every failing shared-account key is named > M8: undated lines join the key lines before the sort, whatever the group input order
 Test Files  1 failed (1)
      Tests  3 failed | 60 passed (63)
$ cp "$SCRATCH/235-06-Q3.bak" 'src/app/(dashboard)/allocations/components/MissingDataMessage.tsx'
$ cmp "$SCRATCH/235-06-Q3.bak" 'src/app/(dashboard)/allocations/components/MissingDataMessage.tsx'   # silent
(cmp: identical)
$ npx vitest run src/app/(dashboard)/allocations/components/MissingDataMessage.test.tsx (restored)
 Test Files  1 passed (1)
      Tests  63 passed (63)
```

#### Q4 (MissingDataMessage.tsx): an unresolvable id falls back to its raw id and the group counts as named. Expected RED: M4.

```
$ cp 'src/app/(dashboard)/allocations/components/MissingDataMessage.tsx' "$SCRATCH/235-06-Q4.bak"
$ npx vitest run src/app/(dashboard)/allocations/components/MissingDataMessage.test.tsx (neutered: Q4)
 FAIL src/app/(dashboard)/allocations/components/MissingDataMessage.test.tsx > Phase 235 HOLD-05: every failing shared-account key is named > M4 (P3, SFH-4): a group with a key the owner's list cannot label names nothing, no raw id prints, the book fallback st
 Test Files  1 failed (1)
      Tests  1 failed | 62 passed (63)
$ cp "$SCRATCH/235-06-Q4.bak" 'src/app/(dashboard)/allocations/components/MissingDataMessage.tsx'
$ cmp "$SCRATCH/235-06-Q4.bak" 'src/app/(dashboard)/allocations/components/MissingDataMessage.tsx'   # silent
(cmp: identical)
$ npx vitest run src/app/(dashboard)/allocations/components/MissingDataMessage.test.tsx (restored)
 Test Files  1 passed (1)
      Tests  63 passed (63)
```

#### Q5 (MissingDataMessage.tsx): the shared-account cause is never marked covered when groups are given. Expected RED: M5, M1.

```
$ cp 'src/app/(dashboard)/allocations/components/MissingDataMessage.tsx' "$SCRATCH/235-06-Q5.bak"
$ npx vitest run src/app/(dashboard)/allocations/components/MissingDataMessage.test.tsx (neutered: Q5)
 FAIL src/app/(dashboard)/allocations/components/MissingDataMessage.test.tsx > Phase 235 HOLD-05: every failing shared-account key is named > M1: two all-failing accounts, A dated and B reaching yesterday: A's line, then B by label, and no fallback
 FAIL src/app/(dashboard)/allocations/components/MissingDataMessage.test.tsx > Phase 235 HOLD-05: every failing shared-account key is named > M5 (P4): both groups carry a printed dated gap: two dated lines, no undated line, no fallback
 FAIL src/app/(dashboard)/allocations/components/MissingDataMessage.test.tsx > Phase 235 HOLD-05: every failing shared-account key is named > M6: one all-failing account reaching yesterday (no gap) prints its undated labelled line and no fallback
 FAIL src/app/(dashboard)/allocations/components/MissingDataMessage.test.tsx > Phase 235 HOLD-05: every failing shared-account key is named > M8: undated lines join the key lines before the sort, whatever the group input order
 Test Files  1 failed (1)
      Tests  4 failed | 59 passed (63)
$ cp "$SCRATCH/235-06-Q5.bak" 'src/app/(dashboard)/allocations/components/MissingDataMessage.tsx'
$ cmp "$SCRATCH/235-06-Q5.bak" 'src/app/(dashboard)/allocations/components/MissingDataMessage.tsx'   # silent
(cmp: identical)
$ npx vitest run src/app/(dashboard)/allocations/components/MissingDataMessage.test.tsx (restored)
 Test Files  1 passed (1)
      Tests  63 passed (63)
```

#### Q6 (MissingDataMessage.tsx): an absent or empty argument is treated as `[]` and the rule runs. Expected RED: the pre-existing `it.each` fallback row, M7.

```
$ cp 'src/app/(dashboard)/allocations/components/MissingDataMessage.tsx' "$SCRATCH/235-06-Q6.bak"
$ npx vitest run src/app/(dashboard)/allocations/components/MissingDataMessage.test.tsx (neutered: Q6)
 FAIL src/app/(dashboard)/allocations/components/MissingDataMessage.test.tsx > MissingDataMessage: the shipped fallbacks, once, and only when no line covers the reason > shared_account_no_working_key with no gap line: the shipped unnamed sentence under its sco
 FAIL src/app/(dashboard)/allocations/components/MissingDataMessage.test.tsx > MissingDataMessage: the shipped fallbacks, once, and only when no line covers the reason > history_read_failed says reload and names no page; the waiting reasons name neither
 FAIL src/app/(dashboard)/allocations/components/MissingDataMessage.test.tsx > MissingDataMessage: book-wide lines state their whole-history scope, one action, and never return or risk (D-10, R-03) > shared_account_no_working_key: the rendered line has the sco
 FAIL src/app/(dashboard)/allocations/components/MissingDataMessage.test.tsx > Phase 235 HOLD-05: every failing shared-account key is named > M7: with the argument absent or [], a rebuilding shared-account book prints exactly the shipped fallback
 Test Files  1 failed (1)
      Tests  4 failed | 59 passed (63)
$ cp "$SCRATCH/235-06-Q6.bak" 'src/app/(dashboard)/allocations/components/MissingDataMessage.tsx'
$ cmp "$SCRATCH/235-06-Q6.bak" 'src/app/(dashboard)/allocations/components/MissingDataMessage.tsx'   # silent
(cmp: identical)
$ npx vitest run src/app/(dashboard)/allocations/components/MissingDataMessage.test.tsx (restored)
 Test Files  1 passed (1)
      Tests  63 passed (63)
```

#### Q7 (MissingDataMessage.tsx): undated lines are appended after the sort. Expected RED: M8.

```
$ cp 'src/app/(dashboard)/allocations/components/MissingDataMessage.tsx' "$SCRATCH/235-06-Q7.bak"
$ npx vitest run src/app/(dashboard)/allocations/components/MissingDataMessage.test.tsx (neutered: Q7)
 FAIL src/app/(dashboard)/allocations/components/MissingDataMessage.test.tsx > Phase 235 HOLD-05: every failing shared-account key is named > M8: undated lines join the key lines before the sort, whatever the group input order
 Test Files  1 failed (1)
      Tests  1 failed | 62 passed (63)
$ cp "$SCRATCH/235-06-Q7.bak" 'src/app/(dashboard)/allocations/components/MissingDataMessage.tsx'
$ cmp "$SCRATCH/235-06-Q7.bak" 'src/app/(dashboard)/allocations/components/MissingDataMessage.tsx'   # silent
(cmp: identical)
$ npx vitest run src/app/(dashboard)/allocations/components/MissingDataMessage.test.tsx (restored)
 Test Files  1 passed (1)
      Tests  63 passed (63)
```

#### Q8 (degrade-warnings.ts): the text gains a date-shaped clause. Expected RED: the pin arm.

```
$ cp 'src/lib/degrade-warnings.ts' "$SCRATCH/235-06-Q8.bak"
$ npx vitest run src/lib/degrade-warnings.test.tsx (neutered: Q8)
 FAIL src/lib/degrade-warnings.test.tsx > the Phase 198 per-key lines read word for word what shipped (199-05 Task 1) > shared-account-failing-undated (Phase 235 HOLD-05) names its keys, states no day and no 'no complete history yet'
 Test Files  1 failed (1)
      Tests  1 failed | 82 passed (83)
$ cp "$SCRATCH/235-06-Q8.bak" 'src/lib/degrade-warnings.ts'
$ cmp "$SCRATCH/235-06-Q8.bak" 'src/lib/degrade-warnings.ts'   # silent
(cmp: identical)
$ npx vitest run src/lib/degrade-warnings.test.tsx (restored)
 Test Files  1 passed (1)
      Tests  83 passed (83)
```

#### Q9 (AllocationDashboardV2.tsx): the `sharedFailingGroups` argument is removed. Expected RED: O1.

```
$ cp 'src/app/(dashboard)/allocations/AllocationDashboardV2.tsx' "$SCRATCH/235-06-Q9.bak"
$ npx vitest run src/app/(dashboard)/allocations/AllocationDashboardV2.shared-account-named.test.tsx (neutered: Q9)
 FAIL src/app/(dashboard)/allocations/AllocationDashboardV2.shared-account-named.test.tsx > AllocationDashboardV2: the payload's shared-account groups reach the missing-data message (HOLD-05) > O1: a two-account payload names every failing key and prints no bo
 Test Files  1 failed (1)
      Tests  1 failed | 1 passed (2)
$ cp "$SCRATCH/235-06-Q9.bak" 'src/app/(dashboard)/allocations/AllocationDashboardV2.tsx'
$ cmp "$SCRATCH/235-06-Q9.bak" 'src/app/(dashboard)/allocations/AllocationDashboardV2.tsx'   # silent
(cmp: identical)
$ npx vitest run src/app/(dashboard)/allocations/AllocationDashboardV2.shared-account-named.test.tsx (restored)
 Test Files  1 passed (1)
      Tests  2 passed (2)
```

#### Q6 re-run against the new Overview test file (MissingDataMessage.tsx). Expected RED: O2.

```
$ cp 'src/app/(dashboard)/allocations/components/MissingDataMessage.tsx' "$SCRATCH/235-06-Q6-O2.bak"
$ npx vitest run src/app/(dashboard)/allocations/AllocationDashboardV2.shared-account-named.test.tsx (neutered: Q6-O2)
 FAIL src/app/(dashboard)/allocations/AllocationDashboardV2.shared-account-named.test.tsx > AllocationDashboardV2: the payload's shared-account groups reach the missing-data message (HOLD-05) > O2: a legacy payload without the field keeps the book fallback and
 Test Files  1 failed (1)
      Tests  1 failed | 1 passed (2)
$ cp "$SCRATCH/235-06-Q6-O2.bak" 'src/app/(dashboard)/allocations/components/MissingDataMessage.tsx'
$ cmp "$SCRATCH/235-06-Q6-O2.bak" 'src/app/(dashboard)/allocations/components/MissingDataMessage.tsx'   # silent
(cmp: identical)
$ npx vitest run src/app/(dashboard)/allocations/AllocationDashboardV2.shared-account-named.test.tsx (restored)
 Test Files  1 passed (1)
      Tests  2 passed (2)
```


## Phase-wide gate sweep (merged code at head `aab15d8fc`)

Vitest (the 24-file sweep command of Task 2):

```
 Test Files  24 passed (24)
      Tests  1070 passed | 1 skipped (1071)
```

`npm run typecheck`: exit 0, 0 lines containing `error TS` (after deviation 1).

Python replay: `tests/test_match_native_unpriced_account_day.py tests/test_match_portfolio_aum_native_unpriced.py tests/test_match_portfolio_aum_per_key.py`:

```
26 passed in 10.15s
```

mypy strict: `Success: no issues found in 146 source files`.

eslint over 23 TS files (this plan's seven plus plans 01 to 05's `files_modified`): exit 0, no output.

Task 1 verify command: `Test Files  4 passed (4)`, `Tests  192 passed (192)`. Acceptance greps: registry literal count 1, MissingDataMessage.tsx literal count 2 (render site id and `degradeSegments` call), `sharedFailingGroups` count 5, scan ledger count 1. Task 2: `sharedFailingGroups: sharedAccountFailingGroups` count 1 in AllocationDashboardV2.tsx; plan 04's `dashboard-holdings-unpriced-check-note` mount still present (sweep arms U1 to U3 green).

The two pre-existing reds RESEARCH recorded (`factsheet/compute.conventions.test.ts`, `return-stats.single-source.test.ts`) are outside this sweep and were not run.

## Known Stubs

None.

## Threat Flags

None. T-235-12 is mitigated (labels only through `apiKeyLabelById`; arm M4 and Q4). T-235-13 is mitigated (arms M1, M5, M6; Q1, Q5).

## For the ship (executors do NOT run these)

1. **TODOS.md deletions (rule (b)).** Delete, by id, with the measured lines at this head: `198-SHARED-ACCOUNT-FALLBACK-UNNAMED` (single bullet, TODOS.md line 304), and the three `###` blocks `170.4-IDENTITY-READ-COMPLETENESS` (line 2946), `170.4-DASHBOARD-MARKER-READ-SILENT` (line 2956), `170.4-MATCH-UNPRICED-PER-KEY` (line 2976), each up to the next heading. Greps for each id across `src scripts analytics-service docs CLAUDE.md`: three ids have no hits; **`170.4-DASHBOARD-MARKER-READ-SILENT` has ONE new hit, `src/lib/degrade-warnings.ts:959`** (a comment plan 04 added: "TODOS `170.4-DASHBOARD-MARKER-READ-SILENT`"). Fix that comment in the same PR (drop the id or say the entry is closed) before deleting the entry.
2. **CHANGELOG and VERSION.** One unified entry in a `chore(release)` commit with the four-digit VERSION bump, `VERSION` and `package.json` byte-equal, never `npm version`; map every branch commit to a bullet. Themes: HOLD-01 fail loud on an identity gap; HOLD-02 matcher marker per account; HOLD-04 unpriced-check note and the Sentry capture; HOLD-05 every failing shared-account key named, with the new undated line; tests and the new cross-runtime case table. Name the four closed TODOS ids. Known limits to carry: the Scenario tab shows no unpriced-check note (CD-2); the matcher mirrors only the marker reading day, not the TS reader's clean-poll reading days (`cleanPollAsof`, `cleanEmptyPollDay`), so "match AUM equals Holdings" does not cover a clean-poll reading; SC-2 "unpriced days" is met by the shared rule, not by a new output field; the stale `read_native_unpriced_days` docstring; deviation 2 above (an unprinted shared gap matching no group no longer holds the fallback). Never write a CI skip token, not even to deny it.
3. **Founder-overridable choices for the PR body.** CD-1 the note copy; CD-2 the two mounts, none on Scenario; CD-3 muted styling; CD-4 the two-account RED fixture; the three Sentry tags; the 6 h capture window; the kept `accountByKey = {}` default with a strict lookup; the undated-line copy; the matcher skipping the marker read for a book with no holdings rows.
4. **Records after merge (to main, never on the ship branch).** Fix UI-SPEC's stale zero-one-many sentence, set VALIDATION's `nyquist_compliant`, tick ROADMAP and STATE.

## Self-Check: PASSED

- Commits `14147765b`, `be7487cbf`, `aab15d8fc` are ancestors of HEAD.
- All seven files named in `key-files` exist on disk.
