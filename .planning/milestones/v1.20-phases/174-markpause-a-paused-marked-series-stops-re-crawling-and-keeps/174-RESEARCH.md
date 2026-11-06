# Phase 174 MARKPAUSE - Research

**Researched:** 2026-10-27 at origin/main 53f25ac3 (worktree branch feat/174-markpause)
**Confidence:** high on code shape (read at HEAD); the PROD cohort is measured below.

## Q1. Where the daily re-crawl of a paused strategy comes from

- `public.enqueue_ledger_refresh_for_strategies` (single-key arm) ticks hourly (`25 * * * *`, `scripts/prod-prober/cron-manifest.json`). Its current body is the one `supabase/migrations/20260924120000_ledger_fanout_failure_count.sql` created; `supabase/schema/functions/enqueue_ledger_refresh_for_strategies.sql` is the PROD dump of it ("source migration: 20260924120000"). No later migration re-creates it (20260928140000 and 20261021120000 touch other functions).
- Candidate CTE: `FROM public.ledger_refresh_staleness lrs JOIN public.strategies s ... LEFT JOIN public.api_keys ak ... WHERE lrs.is_stale AND lrs.is_composite = FALSE AND s.status IN (...) AND <key eligibility> AND NOT EXISTS (<attempt cooldown>) AND NOT EXISTS (<failed-attempt cooldown>) AND NOT EXISTS (<in-flight>)`, then `venue_rank <= 2 ... LIMIT 4`.
- The attempt cooldown is the binding bound: `NOT EXISTS (SELECT 1 FROM public.compute_jobs cj WHERE cj.strategy_id = lrs.strategy_id AND cj.kind IN ('derive_broker_dailies','compute_analytics_from_csv') AND cj.created_at > now() - INTERVAL '20 hours')`. So a stale strategy costs about one derive a day, not 24.
- A strategy whose marks paused stays `is_stale` (its `returns_series` stops advancing), so it is re-derived daily, forever. That daily derive is also the only recurring path that clears `marks_trailing_since` for deribit, sfox and mt5 once marks resume (`DAILY_PNL_VENUES` excludes them; key-mode derives never enqueue a strategy derive).

**Design (D-01, weekly re-admit):** change only the attempt-cooldown window, per strategy:
`cj.created_at > now() - CASE WHEN EXISTS (SELECT 1 FROM public.strategy_analytics sa WHERE sa.strategy_id = lrs.strategy_id AND sa.data_quality_flags ? 'marks_trailing_since') THEN INTERVAL '7 days' ELSE INTERVAL '20 hours' END`.
- The view (`ledger_refresh_staleness`, verdict built to fail toward stale; static gate bans time columns in its verdict) is untouched. The composite arm is untouched (161.1 D-01).
- `compute_jobs` retention deletes `done` rows after 30 days and failed rows after 90 (cron-manifest `retention_compute_jobs_done` / `_failed`), both longer than 7 days, so the weekly window is never erased early.
- A paused strategy with no attempt in 7 days is admitted, its derive either clears the flag (marks resumed: back to daily) or re-stamps it (still paused: next attempt in 7 days).

## Q2. Where the refusal token is today

- `_write_nav_mark_for_this_derive` (`analytics-service/services/job_worker.py`, the nested seam both modes reach) returns `(None, token)` on a refused read and only logs it in strategy mode (SFH-2 F3). Key mode copies it into `key_inputs:<id>` as `nav_mark_refusal` (no first-seen day).
- Owner identity in the seam is `ctx.key_row["user_id"]` (`_mark_owner_id`), used as `allocator_id` for `write_nav_mark`. `allocator_equity_derived` is owner-SELECT, service-role write, `kind` has no CHECK ("a new family = INSERT a new row; no ALTER TABLE"); precedent `_persist_key_capture`-style helper writing `kind = "key_capture:" + api_key_id`, upsert `on_conflict="allocator_id,kind"`, additive, never raises.
- `MARK_REFUSAL_TOKENS` (17, `services/nav_marks.py`) is the closed set; `mark_day_for(marked_at)` gives the label day.
- `strategy_analytics` is publicly readable for published strategies (`analytics_read`), so `data_quality_flags` must never carry a token.

## Q3. PROD cohort (measured 2026-10-27, counts only, marker query first)

`strategy_analytics`: 42 rows, 4 carry `marks_since`, 0 carry `marks_trailing_since`. The change has no live effect today; it bounds the cost when a mark pauses.

## Q4. Gate and census mechanics (the expensive part of SC-1)

- `supabase/tests/test_ledger_refresh_fanout.sql` (2442 lines, 70 `RED-UNDER` lines): its `RED-UNDER-SETUP` apply list ends with 20260924120000; every edit-kind twin names the LAST migration that re-creates the single-key body, with `occurrences`/`nth` counted on that file's bytes (20260924120000 holds both bodies, single-key first, so many twins carry `occurrences: 2, nth: 1`). A new migration that re-creates the single-key body ALONE means: append it to the apply list, re-point every edit-kind twin to it, and recount every `find` on the new file (most drop to `occurrences: 1`, no `nth`). Twins left on the old file mutate an overwritten body and report `no-red`.
- The pg-lane fixture `scripts/pg-lane/fixtures/03-fixture-compute-jobs.sql` declares `strategy_analytics` with only the columns gates read; `data_quality_flags JSONB` must be added there (IF NOT EXISTS, harmless to other gates).
- Census files that move with new arms (grep each for the file name and its counts): `.github/workflows/ci.yml` (sentinel table, `test_ledger_refresh_fanout.sql 26`), `scripts/mutation-floors.mjs` (FILES_FLOOR/ARMS_FLOOR and their derivation comments), `src/__tests__/mutation-runner-floors.test.ts`, `src/__tests__/mutation-annotation-parser.test.ts`, `src/__tests__/contracts/ci-anti-skip-gate.contract.test.ts`, `src/__tests__/gate-family-meta.test.ts`. `supabase/tests/test_ledger_refresh_composite_arm.sql` must NOT change.
- `analytics-service/tests/test_ledger_refresh_gates.py` DOES pin the live fan-out file by name: `_FANOUT_MIGRATION_NAME` (today 20260924120000; the extractors find each body by its `$fanout$`, `$composite$`, `$verify$` dollar-quote tags), `_FANOUT_SUPERSEDED_MIGRATION_NAMES` (every earlier generation enumerated, never dropped), `_PHASE_MIGRATION_NAMES` (a set, not a count) and one-second half-open scan windows (`_PHASE_MIGRATION_WINDOW_5_START/_END`) inside which floor 4 scans the raw file for the schedule/unschedule verbs and a `PERFORM` on a fan-out. The 164.5.1.1 precedent (20260917120000, fan-out only) is the model: the new file carries `$fanout$` and `$verify$` and NOT `$composite$`; `_FANOUT_MIGRATION_NAME` moves to it, 20260924120000 joins the superseded set, `_COMPOSITE_MIGRATION_NAME` stays on 20260924120000, and a sixth window range is added for the new stamp after measuring 0 schedule/unschedule/PERFORM occurrences in the new file.
- Migration rules: catalogue-only verify block (TEST is empty), no `cron.schedule`, full `CREATE OR REPLACE` re-based byte-for-byte on 20260924120000's single-key body (cross-checked against the schema snapshot), migration-reviewer + rls-policy-auditor clean before merge. The schema snapshot and baseline are regenerated by the post-apply re-dump PR (Supabase Migrate `redump-pr`); a `SNAPSHOT_MISSING`/drift red on the ship PR is stale-baseline drift.

## Pitfalls

1. Putting the pause test in the view's `is_stale` (fails open, leaks into the composite arm, needs the static gate re-pointed). Rejected in CONTEXT.
2. Keying the weekly window on the last success instead of the last attempt: a permanently failing paused strategy would then be retried daily again.
3. Writing the token anywhere under `strategy_analytics` (public).
4. A refusal-record write failure must not fail the derive (the mark refusal never fails a derive, NAVMTM L3); follow the additive-row precedent (WARNING with the exception class name only).
