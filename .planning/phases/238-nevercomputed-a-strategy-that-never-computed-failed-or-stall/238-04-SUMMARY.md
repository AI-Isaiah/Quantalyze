---
phase: 238-nevercomputed-a-strategy-that-never-computed-failed-or-stall
plan: 04
subsystem: database
tags: [gate, prod-probe, migration-lane, FACT-03]
status: complete
requires: [238-01, 238-02, 238-03]
provides:
  - "gate answered by the coordinator: 233 merged (#1360 / c020d03ca), lane order after Phase 230's #1358"
  - "migration version 20261126130000"
  - "predicate confirmed on PROD 2026-11-26: 11 never-computed rows selected, 0 rows with figures selected"
  - "post-233 reader delta: no new reader file; new read sites inside src/lib/queries.ts (Phase 252); factsheet cache key now v29"
affects: [238-05, 238-06, 238-08, 238-09]
key-files:
  created: []
  modified: []
key-decisions:
  - "Migration stamped 20261126130000: above the PROD ledger tip 20261125212222, above the newest file on disk (the same version), and above Phase 230's 20261126120000, which merges first in the serial lane"
  - "Executed by the phase orchestrator, not a gsd-executor: Task 1 is a blocking-human gate whose answer came from the coordinator, and Task 2's PROD reads go through the Supabase MCP, which the executor agent has no access to. The plan writes no source"
requirements-completed: []
completed: 2026-11-26
commits: 1
---

# Phase 238 Plan 04: PR-2 gate and re-measured premises Summary

The PR-2 gate is answered, the PROD backfill predicate is confirmed on the 2026-11-26 table, and the migration version is picked.

## Task 1: Gate (blocking-human), answered by the coordinator on 2026-11-26

Recorded verbatim:

"(1) 233 DERIBITTRUTH merged: #1360 / c020d03ca, which carries FRESH-02.
(2) Migration lane: Phase 230's migration PR #1358 is ahead of you in the serial lane and merges first. Stamp your migration after main's latest at push time; if #1358 has merged by then, that's after its 20261126120000. Record this confirmation in 238-04-SUMMARY."

Re-checked here, at branch HEAD e510ef6c1 (origin/main merged in at ef5c7a78d):

| Check | Result |
|---|---|
| `git log origin/main --oneline \| grep -i DERIBITTRUTH` | `c020d03ca v0.133.83.0 — Phase 233 DERIBITTRUTH ... (#1360)` |
| `git merge-base --is-ancestor c020d03ca HEAD` (233) | exit 0 |
| `git merge-base --is-ancestor dae5bf9fd HEAD` (PR-1, #1331) | exit 0 |
| `gh pr view 1358` | OPEN at 2026-11-26 (Phase 230 MT5NIGHTLY); it merges first |

## Task 2: Re-measured premises

### PROD reads (Supabase MCP only, one query per call, marker query before each read)

The marker query was run 3 times, before the aggregate read and paired with each of the two later reads. The last two pairs were sent in one parallel batch, so marker-then-read ordering is guaranteed only for the aggregate. Every call targeted the same project, and the marker answer was the same each time: `which_database` = `⛔ PRODUCTION — real customer data. No seeds, no fixtures, no DELETE without a scoped id.`

Aggregate (counts only):

| computation_status | has_headline | has_daily | has_returns_series | no_clock | count |
|---|---|---|---|---|---|
| complete | true | false | true | true | 16 |
| complete_with_warnings | true | false | true | true | 8 |
| failed | false | false | false | true | 11 |
| failed | true | false | true | true | 7 |

Against the 2026-11-24 reading: identical shapes. Failed with no figures 11; failed with headline and series 7; no `pending` or `computing` row (so 0 `computing` rows with a NULL clock); no figure-less success row (A2 holds); no row with a series but no headline or the reverse. `daily_returns` is empty on every row, so the series test rests on `returns_series`.

**Predicate confirmed: 11 never-computed rows selected, 0 rows with figures selected.** No HALT condition is met.

Table owner: `postgres` (RESEARCH A3). `DISABLE TRIGGER` on a named user trigger needs table ownership; the migration apply role in `supabase-migrate.yml` is not named by any read here, so A3 is proven only by the TEST `apply-test` log of the merge (a refusal rolls back on TEST and blocks PROD).

PROD ledger tip: `20261125212222`.

### Migration version

`20261126130000`. Newest file in `supabase/migrations/` at HEAD and on origin/main: `20261125212222_computation_error_copy_contact_form.sql`. The version sits above both and above #1358's `20261126120000`. 238-05 writes `supabase/migrations/20261126130000_strategy_analytics_computed_at_nullable.sql` and `supabase/migrations/down/20261126130000-rollback.sql`. If main's tip has moved past it at push time, the ship step re-stamps.

### Post-233 reader delta (for 238-08)

`git grep -lw` for `computed_at|computedAt|analytics_computed_at|last_success_computed_at` over non-test `src/**/*.ts(x)` (comments not stripped): 60 files. Against RESEARCH's census table, three files are new, and each mention is a comment only: `src/components/ui/CardShell.tsx`, `src/lib/closed-sets.ts`, `src/lib/status-surface-copy.ts`.

Python (`analytics-service/**/*.py`, non-test): 11 files name the word. The two not in RESEARCH's nine, `services/analytics_status.py` and `services/db.py`, mention it only in docstrings or comments.

SQL: `supabase/schema/functions/` files naming both `computed_at` and `strategy_analytics` are the three RESEARCH listed for the strategy column (the hold trigger and `get_allocator_recommendations`; the view lives in `baseline.sql`), plus `cutover_strategy_metrics_keys_atomic` and `upsert_strategy_analytics_series_batch` (both `strategy_analytics_series`, other-table) and `sync_strategy_analytics_status` (comment only).

233's FRESH-02 check (`scripts/prod-prober/arms/freshness.mjs`) reads `allocator_equity_derived.computed_at`, not `strategy_analytics.computed_at`. It is other-table, and it sits outside the census corpus (`src/`, `analytics-service/`, `supabase/schema/`).

Added lines across the whole merge (`git diff ef5c7a78d^1 ef5c7a78d -U0 -- src analytics-service supabase/schema`, non-test, the four tokens, word match), so that readers added inside files RESEARCH already lists are seen too:
- `src/lib/queries.ts` (Phase 252): new snapshot-aware projections select `computed_at` and `last_success_computed_at:data_quality_flags->last_success_snapshot->>computed_at` (the `RECORD_*`/list column strings and the `getMyAllocationDashboard` shaper, which destructures `computed_at: _ca` and strips it from the payload). These are reader-evidence through the `usesLastSuccessSnapshot` / `isSameInstant` rule, which fails closed on a NULL date. The per-file token counts RESEARCH gave for this file are therefore stale.
- `src/app/factsheet/[id]/v2/page.tsx`: the payload cache key is now `factsheet-v2-payload-v29` (RESEARCH quoted v27). It is the same reader-key site, and `computedAt` still falls back to `"0"` for NULL.
- `src/app/(dashboard)/recommendations/page.tsx`: one added comment line.
- No added `strategy_analytics (*)` wildcard select.

**Delta: no new reader FILE of `strategy_analytics.computed_at`, but new read sites inside `src/lib/queries.ts`, and the factsheet cache key moved to v29.** 238-08 must measure the comment-stripped census at its own HEAD and must not copy RESEARCH's per-file counts.

## Merge sanity before PR-2 work (run by the orchestrator)

- `npx tsc --noEmit -p tsconfig.json` at e510ef6c1: clean (no output).
- 11 factsheet test files around the auto-merged `src/app/factsheet/[id]/v2/FactsheetView.tsx` and `v2/page.tsx` (recipient-share, owner-notice, unreadable-reason, withheld-renderings, recency-line, page.owner-compute-state, page.owner-lane, page.public-cache-key, page.stale-analytics, page.viewer-chrome, page.composite-read-error): 11 passed, 232 tests passed.

## Deviations

- Executed by the orchestrator instead of a gsd-executor (see key-decisions). No source file is written.
