---
phase: 176-legacyretire-the-legacy-allocator-equity-curve-is-retired-an
plan: 10
subsystem: docs-and-census-test
tags: [runbooks, retirement-banners, census-test, D-02, D-04]
requires: ["176-07"]
provides:
  - "dated retirement banners on six operator documents"
  - "a census test that no longer reads the reconstruct crawl or requires the refresh cron"
affects: ["176-11 (crawl deletion)", "176-12 (manifest re-capture)"]
key-files:
  modified:
    - docs/runbooks/marksource-okx-history-correction.md
    - docs/runbooks/marksource-okx-census/README.md
    - docs/runbooks/marksource-legacy-chain-move-go-live.md
    - docs/runbooks/navmtm-chain-move-go-live.md
    - docs/runbooks/ledger-refresh-go-live.md
    - docs/runbooks/flipretry-derived-equity-go-live.md
    - src/__tests__/marksource-okx-census-sql.test.ts
decisions:
  - "Banners are blockquotes in the house AMENDED form; the history-correction and chain-move runbooks and the census README carry them directly under the H1, so the heading stays the first line."
  - "ledger-refresh-go-live.md: the banner sits above the Part C paragraph that introduces the reading form, not between that paragraph's closing colon and its code fence, so the sentence still leads into its query."
status: complete
commits: 2
plan_head_before: 0b6c199ff347ff285793cb07f3807c5273704343
plan_head_after: d1c04a4c31f45bd662d5250ccb48b1d892cdf536
actuals:
  tokens: 9000
  tasks: 2
  commits: 2
---

# Phase 176 Plan 10: retirement banners and the census test Summary

The operator's forced-rebuild procedure, the refresh-cron move and rollback runbooks, the census README, the
ledger-refresh reading and the E2 harness step now say at the top that they are retired or amended, and the one
TS test that read the reconstruct crawl by text no longer does.

## Commits

| Task | Commit | Subject |
|---|---|---|
| 1 (tracer) | 7de30c18a | docs(176-10): the forced-rebuild procedure is retired (D-04); census test no longer pins the retired cron or the crawl constant |
| 2 | d1c04a4c3 | docs(176-10): retirement banners on the refresh-cron, census and E2 runbooks (D-02, D-04) |

## Task 1: RED on the base, then GREEN

Base test, two drills (each edit restored from a byte backup, then `cmp`):

- Manifest drill (the `refresh-allocator-equity` job removed, 19 jobs to 18):
  `AssertionError: the manifest has no job named refresh-allocator-equity: the runbook points the operator at a slot that is not there`
  and `Tests  1 failed | 141 passed (142)`. Restore `cmp` exit 0.
- Emptied-module drill (`equity_reconstruction.py` replaced by an empty file):
  `Error: ANCHOR MISSING: "FORCED_REBUILD_ANCHOR_REASONS: Final[frozenset[str]] = frozenset(" is not present in the subject text.`
  and `Tests  no tests` (the file dies at collection). Restore `cmp` exit 0.

Edited test, same two drills: `Tests  136 passed (136)` for each. Restores `cmp` exit 0 again.

Changes to `src/__tests__/marksource-okx-census-sql.test.ts` (4 insertions, 105 deletions before the P7 and B'3a
edits; each deletion leaves a one-line Phase 176 comment): the `enqueue` form's `it` that read the three
`RECONSTRUCT_EXPECTED_*` literals; the whole Phase 178 "refusal vocabulary" describe (parsed `FORCED_REBUILD_*`
frozensets at describe time); in the P7 test the `recon` read, the `pollCompleted` match and its two expectations;
in the B'3a test the loop is now `["poll-allocator-positions"]` only. `grep -an equity_reconstruction` on the file
prints nothing (baseline: four reading lines).

Banner on `marksource-okx-history-correction.md`: `RETIRED 2026-10-31 (Phase 176 LEGACYRETIRE, D-02 and D-04)`;
forced and unforced `reconstruct_allocator_history` jobs finish as no-ops; the `enqueue` and `newjob` forms must
not be run; the legacy table is dropped by the phase's last migration; the history probe script is deleted;
live reads point to `docs/runbooks/legacyretire-go-live.md`.

## Task 2

Banners (all dated 2026-10-31, naming Phase 176 LEGACYRETIRE and the decision): the two chain-move runbooks (job
unscheduled by a hand-run step, manifest re-captured, handler a no-op, move/re-create rollback forms must not be
run, legacy rows stop growing at PR 2, `poll-allocator-positions` kept); the census README (files read the legacy
table, kept as the MARKSOURCE record, no `.sql` name quoted); `ledger-refresh-go-live.md` (the
`refresh_allocator_equity_daily` row of the reading stops growing after PR 2); `flipretry-derived-equity-go-live.md`
(after the Step 4 amendment: the E2 harness script is deleted, the audit item stays as recorded).

## Verification

| Command | Result |
|---|---|
| `npx vitest run src/__tests__/marksource-okx-census-sql.test.ts src/__tests__/marksource-okx-nonworking-keys-exec.test.ts` | 2 files, 171 passed |
| `npx vitest run` the census test + `legacyretire-runbook-forms.test.ts` + `marksource-okx-nonworking-keys-exec.test.ts` (after the Task 2 banners) | 3 files, 356 passed |
| `npm run typecheck` | exit 0 |
| `npm run lint` | exit 0, 0 errors, 2 warnings (unused vars in `src/app/factsheet/[id]/v2/MetricsColumn.tsx` and `src/lib/factsheet/composite-read-path.ts`, files this plan did not touch) |
| `git diff --stat <base> HEAD -- scripts/prod-prober/cron-manifest.json analytics-service/` | empty (the drills left no trace) |
| `git diff --numstat <base> HEAD -- docs/` | 2 additions and 0 deletions for each of the six files |

Other readers of the touched runbooks by file name: `src/__tests__/legacyretire-runbook-forms.test.ts` (run, green)
and `scripts/prod-prober/arms/cron-obs.mjs` (cites `ledger-refresh-go-live.md` in prober messages only).

## Deviations from Plan

None - plan executed as written. One placement judgement: the `ledger-refresh-go-live.md` banner sits above the
Part C paragraph that introduces the reading form (see decisions).

## CHANGELOG inputs (retired procedures)

- Retired: the operator's forced rebuild (`reconstruct_allocator_history` with `force_rebuild`) and its runbook forms
  `enqueue` and `newjob`; the job finishes as a no-op since PR 2.
- Retired: the move and rollback forms for the `refresh-allocator-equity` cron in the MARKSOURCE and NAVMTM chain-move runbooks.
- Retired: the MARKSOURCE snapshot census reads (legacy table) once the table is dropped.
- Amended: the `refresh_allocator_equity_daily` row of the ledger-refresh reading stops growing.
- Amended: the E2 harness command in the flipretry runbook cannot run (script deleted by plan 11).
- Test: the census test no longer requires the refresh cron in the manifest or any text of `equity_reconstruction.py`.

## Known Stubs

None.

## Threat Flags

None.

## Self-Check: PASSED

- Commits 7de30c18a and d1c04a4c3 are on feat/176-legacyretire.
- All six banners present (`grep -aF 'Phase 176 LEGACYRETIRE'`); no home or planning paths in the banner files.
- Backups of `cron-manifest.json` and `equity_reconstruction.py` `cmp` equal after every drill; STATE.md and ROADMAP.md untouched.
