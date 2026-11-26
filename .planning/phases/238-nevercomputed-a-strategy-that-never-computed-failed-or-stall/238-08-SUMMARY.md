---
phase: 238-nevercomputed-a-strategy-that-never-computed-failed-or-stall
plan: 08
subsystem: testing
tags: [census, computed_at, null-arm, proof-01, FACT-03]
status: complete
requires: [238-04, 238-05, 238-06, 238-07]
provides:
  - "src/__tests__/computed-at-reader-census.test.ts: the SC-1 reader census over TS, Python and SQL with a pinned NULL arm per reader and 12 planted self-tests"
  - "Stale comments in queries.ts, StrategyTable.tsx, stored-analytics-result.ts refreshed (comment-only)"
affects: [238-09]
key-files:
  created:
    - src/__tests__/computed-at-reader-census.test.ts
  modified:
    - src/lib/queries.ts
    - src/components/strategy/StrategyTable.tsx
    - src/lib/stored-analytics-result.ts
key-decisions:
  - "Python corpus scans the BARE word, not the quoted literal the plan named: the quoted-only scan missed job_worker.py's strategy_analytics prestamp read `.select(\"data_quality_flags, computed_at\")`. Strictly a superset; Neuter Q still applies"
  - "Every reader-* class carries `arm` (a literal or pattern that must still appear in the file's stripped source) and a reason starting `NULL arm:`; the plan only asked for the reason to name it. Neuter R proves the pin"
  - "Mixed pairs take the strictest role present (reader-* over plumbing and sort-name over other-table and synthetic); the reason lists every site by role"
  - "database.types.ts is keyed with exact counts (excluded-generated) rather than excluded from the walk, so a regeneration that adds a column moves a count"
requirements-completed: [FACT-03]
completed: 2026-11-26
commits: 2
plan_head_before: bf30bdebd90de36648c04b48745a94a743bd0e94
plan_head_after: 5363c83938374eadd1f27e5b2e11f6d8269d6c30
actuals:
  tokens: 21000
  tasks: 2
  commits: 2
---

# Phase 238 Plan 08: the computed_at reader census Summary

A new reader of `strategy_analytics.computed_at` in TypeScript, Python or SQL can no longer land without a classification, an exact count and, for a reader, a pinned NULL arm.

## Commits

- `129463e35` test(238-08): the census (Task 1, tracer)
- `5363c8393` docs(238-08): comment refresh (Task 2)

## Census result (measured at this plan's HEAD by the scanner itself)

| Corpus | Files walked | Pairs (file::token) | Classes (pairs) |
|---|---|---|---|
| TS (`src/`, non-test) | 759 | 74 (55 files, incl. 1 wildcard) | plumbing 24, other-table 14, reader-render 10, reader-evidence 9, reader-fresh 4, sort-name 4, synthetic 4, reader-key 3, excluded-generated 2 |
| Python (`analytics-service/`, non-test) | 174 | 9 | other-table 5, reader-evidence 2, reader-render 1, writer-stamp 1 |
| SQL (`supabase/schema/functions/*.sql` plus baseline views) | 142 files, 4 views | 8 | other-table 5, plumbing 2, writer-stamp 1 |

Floors, set a little under: TS walked 740, TS pairs 70, Python walked 165, Python pairs 8, SQL files 135, SQL pairs 7, views 3. RESEARCH's seed (55 TS files, 9 Python files, 4 SQL objects at `4b89c54cb`) was a seed only; the TS and Python file counts happen to agree, the pair counts were taken from the scanner.

**Readers:** 29 reader-* pairs (TS 26: render 10, fresh 4, key 3, evidence 9; Python 3: render 1, evidence 2; SQL none), every one with a pinned NULL arm found in the file's stripped source. The arms are: the never-computed stamp and null dash (factsheet, Terms), `computed ? ... : null` (recommendations), `isSameInstant` failing closed (stored-analytics-result), `?? ""`/`?? "0"` as a distinct key value (PDF ETag, factsheet cache key), `== null` stale and `!computedAt` zero (freshness, health score, FreshnessBadge), `Date.parse(computedAt ?? "")` (finalize re-run), `_non_empty_str(computed_at)` (snapshot in `job_worker.py`) and `_minute(None)` printing n/a.

**NULL-arm audit: zero reader sites lack an arm.** No NULL-arm fix was needed, so there is no "files_modified extension" and the cap of 4 was never in play. 238-06's flip and 238-07's pins already covered the readers; the census found nothing they missed. Read to the consumer: `queries.ts` `:1610`/`:2018` selects and the two `_ca` strips (the date is read by the snapshot rule before it is dropped), `StrategyTable` sort (`?? ""`, 238-07), `SyncPreviewStep` (`typeof` narrowing, `existing?.computed_at ? Date.parse(...) : null`).

### Post-233 and Phase 252 classification

- `src/lib/queries.ts` Phase 252 projections: the new `computed_at` and `last_success_computed_at:data_quality_flags->last_success_snapshot->>computed_at` strings are select lists (percentile `PERCENTILE_WITHHOLD_COLUMNS`, record scalars, `CATEGORY_RANKING_ANALYTICS_COLUMNS`) and two dashboard selects whose date is destructured to `_ca` and stripped. They are `plumbing` with no decision; the rule that reads them is `usesLastSuccessSnapshot`/`isSameInstant`, a reader-evidence row on `stored-analytics-result.ts` that fails closed on NULL. `queries.ts::computed_at` is a MIXED pair (21): 13 strategy-side plumbing, 8 other-table (portfolio_analytics orders 3, `allocator_equity_derived` 4, match_batches 1), all named in the reason.
- Factsheet cache key `factsheet-v2-payload-v29` (`app/factsheet/[id]/v2/page.tsx`): reader-key, NULL arm `signAnalytics?.computed_at ?? "0"`.
- 233's FRESH-02 arm (`scripts/prod-prober/arms/freshness.mjs`) reads `allocator_equity_derived`, not the strategy column; it sits outside the three corpora and is pinned as such by its own test (it fails if the file starts naming `strategy_analytics`).
- Wildcards: the census sees `getMyStrategies`' `strategy_analytics (*)` embed (the only live one; `plumbing`, tsc carries the NULL to every consumer). The coordinator's grep found a second file, `src/app/(dashboard)/strategies/page.tsx`: its `strategy_analytics (*)` is inside a comment (`:553`); the code embed there is a column list (`:560`, `CATEGORY_RANKING_ANALYTICS_COLUMNS`), so it is not a wildcard. The census also scans the hinted embed (`!inner`), the table-level `.from(...).select("*")` and Python `.table(...)` twin, and SQL `alias.*`; none has a live hit.

## Deviations from Plan

**1. [Rule 2 - missing critical scan] Python corpus scans the bare word.** The plan said quoted `"computed_at"`/`'computed_at'`. That misses `.select("data_quality_flags, computed_at")` (`job_worker.py`, the strategy_analytics prestamp read) and the `computed_at = row.get(...)` variables. A diff of the quoted and bare file sets: same 9 files, bare count higher (job_worker 17 vs 13, match_eval 10 vs 6, mt5_parity_capture 8 vs 5, match 7 vs 5). Files: the test. Commit `129463e35`.

**2. [Rule 2] Mechanical NULL-arm pin.** Added `arm` per reader-* row and a `NULL arm:` reason rule (the plan asked only that the reason name it). Commit `129463e35`.

**3. SQL baseline views keyed per view** (`baseline.sql::view:NAME`) and `maskSql` failures are problems, not skips. Within the plan's intent.

Otherwise as written. Source files changed beyond `files_modified`: none.

## PROOF-01 (byte backups in the session scratchpad; `cmp backup file` printed before each GREEN)

Every neuter: `cp` to backup, edit, `vitest run src/__tests__/computed-at-reader-census.test.ts --maxWorkers=2`, `cp` back, `cmp`, re-run. All RED lines verbatim (truncated only at the legal-class list):

- **Neuter O** (append a `computed_at` read to `src/lib/closed-sets.ts`, which had no entry): `AssertionError: unclassified: src/lib/closed-sets.ts names computed_at through computed_at 2x and has no TS CENSUS row; classify it on purpose (legal classes: reader-render, ...` / `Tests  1 failed | 16 passed (17)` / `cmp=0` / GREEN `Tests  17 passed (17)`.
- **Neuter P1** (delete the `src/lib/utils.ts::computed_at` row): `AssertionError: unclassified: src/lib/utils.ts names computed_at through computed_at 1x and has no TS CENSUS row; ...` / `Tests  1 failed | 16 passed (17)` / `cmp=0` / `Tests  17 passed (17)`.
- **Neuter P2** (rename a listed reader's token in `for-quants/page.tsx`, `computedAt={null}` to `asOf={null}`): `AssertionError: stale: TS CENSUS row src/app/(marketing)/for-quants/page.tsx computedAt (synthetic, 1) names a pair the walk no longer finds` / `Tests  1 failed | 16 passed (17)` / `cmp=0` / `Tests  17 passed (17)`.
- **Neuter Q** (add `_NEUTER_Q = {"computed_at": None}` to `analytics-service/services/db.py`, comment-only mention before): `AssertionError: unclassified: analytics-service/services/db.py names computed_at through computed_at 1x and has no Python CENSUS row; ...` / `Tests  1 failed | 16 passed (17)` / `cmp=0` / `Tests  17 passed (17)`.
- **Neuter R** (extra, the arm pin: `if (computedAt == null) return "stale";` in `freshness.ts` changed to `=== undefined`): `AssertionError: arm: src/lib/freshness.ts computedAt (reader-fresh) no longer contains its NULL arm if (computedAt == null) return "stale";` / `Tests  1 failed | 16 passed (17)` / `cmp=0` / `Tests  17 passed (17)`.

Neuter P1 was first run once as a key rename (RED with both `unclassified:` and `stale:`), then redone as a true line deletion above.

### Census counts before and after the Task 2 comment edits (identical)

Before: `ts walked=759 pairs=74 (excluded-generated=2 other-table=14 plumbing=24 reader-evidence=9 reader-fresh=4 reader-key=3 reader-render=10 sort-name=4 synthetic=4) | py walked=174 pairs=9 (other-table=5 reader-evidence=2 reader-render=1 writer-stamp=1) | sql files=142 views=4 pairs=8 (other-table=5 plumbing=2 writer-stamp=1)`. After: the same line, character for character; the census test also asserts every exact count.

## Verification run

- `npx vitest run src/__tests__/computed-at-reader-census.test.ts --maxWorkers=2`: 17 passed (5 census arms, 12 planted self-tests).
- Census plus `src/lib/stored-analytics-result.test.ts`: 2 files, 69 tests passed.
- `npm run typecheck` (`tsc --noEmit`): no output, exit 0. `npx eslint` on the four touched files: exit 0. `npx tsx scripts/check-planning-hygiene.ts`: exit 0.
- Not run, by the load limit: the full suite, Docker, pytest, mypy (no analytics file touched).
- `node scripts/verify-plan-anchors.mjs` on the plan: exit 0 (11 claims).

## Known Stubs

None.

## Notes for 238-09 and later

- **A types regeneration or a baseline re-dump moves pinned counts.** `database.types.ts` (`computed_at` 20, `analytics_computed_at` 1) and the `ledger_refresh_staleness` view row are keyed exactly. 238-09's regen is expected to leave the strategy_analytics block identical; if the file's count moves, update `TS_CENSUS` in the same commit.
- **Adjacent defect, not fixed (not the strategy column):** `src/lib/factsheet/allocator-portfolio-payload.ts` `computedAt: meta.computedAt ?? new Date().toISOString()` claims "now" for a missing portfolio date. Its only caller passes `portfolio_analytics.computed_at`, so it is `other-table`; recorded in that row's reason.
- The census counts string contents (select lists, log text); rewording the `[factsheet] ... computed_at` log messages in `fetch-and-build-payload.ts` moves a count on purpose.
- The `ops_staleness_check()`-style prober arm is outside the corpora; its one pin is the FRESH-02 test.

## Threat Flags

None. No new endpoint, auth path or trust boundary; one test file and comment edits.

## Self-Check: PASSED

`src/__tests__/computed-at-reader-census.test.ts` present; commits `129463e35` and `5363c8393` are ancestors of HEAD; `git status --short` shows no tracked changes.
