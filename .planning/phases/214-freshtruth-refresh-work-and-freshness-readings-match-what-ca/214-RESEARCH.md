# Phase 214: FRESHTRUTH — refresh work and freshness readings match what can actually change - Research

**Researched:** 2026-11-14
**Domain:** PostgreSQL SECURITY DEFINER fan-out + staleness view (SQL gates, mutation runner), MT5 broker-dailies derive (Python), Next.js route payloads, React masthead chip
**Confidence:** MEDIUM-HIGH. SC-2, SC-3, SC-8, SC-5-structure and the gate/census file set are HIGH (read from source this session). SC-1's mechanism is code-proven in two respects and `[ASSUMED]` in one (see SC-1); it needs the PROD reads named below.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

### SC-2 — fan-out treatment of a strategy whose refresh cannot advance (founder, Q1 = A)
- Weekly cap, never exclude. Trigger on the generic signal, not on the dust flag: a completed derive + compute run happened after the strategy went stale and `last_return_date` has stayed unmoved for 3 or more days. Then the single-key fan-out's attempt cooldown goes from 20 hours to 7 days. — **Reversibility:** costly — it redefines the live hourly SECURITY DEFINER `enqueue_ledger_refresh_for_strategies` through an auto-applying migration (TEST then PROD on merge, no human gate).
- The throttle lives in the fan-out's candidate cooldown, never in the staleness view (Phase 174 D-01/D-04 precedent: the view's verdict fails toward stale and its static gate bans time columns in the verdict region).
- Each skip is counted per tick with its reason in `public.cron_runs`, under an error/cause tag that cannot collide with `candidate_enqueue_failed` (the prober's `cron-obs` arm counts that tag and the fan-out's own failed-attempt cooldown reads it).

### SC-8 — the two uncorrelated enqueue callers (founder, Q2 = A)
- Both routes send their request's `correlation_id` in `p_metadata`: finalize-wizard `stitch_composite` and csv-finalize `compute_analytics_from_csv`. No SQL widening of `_record_enqueue_dedup`. — **Reversibility:** costly — it changes what lands in `compute_jobs.metadata` / `compute_job_dedup_events` and turns on the Phase 211 D11-2 retraction for those callers.
- Proof: a TypeScript test that goes RED when either route stops sending the id, plus a SQL gate arm pinning both routes' exact payloads (with `correlation_id`) retracting an inherited marker. The SQL is unchanged, so the "RED on Phase 211 code" clause of SC-8 is met by the TS test (founder accepted this).
- Consistent with Phase 211 D11-8: a `correlation_id` means user-initiated; no background path retracts.

### SC-5 — chip label overflow (founder, Q3 = a)
- Let the label row wrap at that width and keep the full `Track record · future — check data` sentence. No copy change. Measure at 1485px in a real browser, per DESIGN.md.

### Decided autonomously
- [SC-3] Q: "When does a composite read as closed?" → Selected: "Every strategy_keys member has window_end set AND the series' last_return_date has reached the last day the windows allow (max(window_end) - 1, window_end being exclusive). Closed excuses only the series_behind reason; no_analytics_row, status_not_success and no_return_date still read stale. A composite whose series has not reached its window end stays stale." — fails toward stale, and a forward migration can revise the predicate.
- [SC-3] Q: "How is closed exposed?" → Selected: "New columns appended at the END of the view (CREATE OR REPLACE VIEW can only append); security_invoker and service_role-only grants restated and asserted after apply; the verdict-region and venue-set static gates in test_ledger_refresh_gates.py must still pass; composite fan-out stays unscheduled and simply stops seeing a closed composite as stale." — view-only change, revisable by a forward migration.
- [SC-4] Q: "When is the PROD drain measured?" → Selected: "After merge (this agent does not merge). The post-deploy read goes through the Supabase MCP with the marker query first. Expected remaining stale rows: the 81-day MT5 strategy with a disconnected key (fan-out already excludes it) and the capped 36-day one, each named with its reason." — measurement step, no code.
- [SC-1] Q: "How far does the 36-day diagnosis go?" → Selected: "Research confirms the cause from code and read-only PROD reads; it is recorded in the phase artifacts. Working hypothesis: the account fell under the $100 dust-NAV floor (nav_twr.py / transforms.py) and the derive stops emitting days. A money-math derive defect, if found, is recorded and routed, not fixed here." — diagnosis only.
- [Ship] Q: "Which TODOS entries does the ship delete?" → Selected: "0.1, 0.12 and 211-D11-RESIDUAL-UNCORRELATED-SENDERS, named in the CHANGELOG; 0.3 was already removed by #1267." — ledger edit.
- [Hygiene] Q: "PROD identifiers in tracked text?" → Selected: "None: no PROD strategy ids in CONTEXT, RESEARCH, PLAN, CHANGELOG or commit messages; ages and counts only." — public repo rule.

### Claude's Discretion
- Exact column names for the closed verdict, the exact cron_runs tag/metadata shape for skip counts, and whether a tick with zero skips writes a row, provided the prober's existing counts are not disturbed.
- Migration timestamp: pick one unlikely to collide with parallel phases and re-check against origin/main before shipping.

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

The ROADMAP lists `Requirements: TBD`; the eight success criteria are used as IDs.

| ID | Description (ROADMAP `### Phase 214`) | Research Support |
|----|---------------------------------------|------------------|
| SC-1 | The 36-day MT5 case is diagnosed and its cause is recorded. | "SC-1 diagnosis": ledger-end mechanism, dust tail, marks exclusion, PROD reads R1-R7 |
| SC-2 | The fan-out excludes or caps a strategy whose derive leaves `last_return_date` unmoved, and counts each skip with a reason. | "SC-2 design": CASE edit (age + completed-analytics signal), skip-count row, reader audit |
| SC-3 | A composite whose member windows have all closed reads as closed in `ledger_refresh_staleness`, not stale; composite fan-out stays unscheduled. | "SC-3 design": lateral + appended columns, gate pointer moves, twin retargeting |
| SC-4 | After deploy, a PROD read (marker query first) shows the stale count drained, or names each remaining row and why. | Post-merge read list; no code (decided) |
| SC-5 | The freshness chip's "future" label fits at 1485px, measured in a real browser. | "SC-5 chip": re-measure first, wrap the text span (not the row), e2e seed path |
| SC-6 | Migration-reviewer and rls-policy-auditor both clean before merge. | Migration structure, ACL restatement, VAC-04 ack, catalogue-only DO blocks |
| SC-7 | Each fix has a test that goes RED when reverted. | `## Validation Architecture` |
| SC-8 | finalize-wizard `stitch_composite` and csv-finalize `compute_analytics_from_csv` enqueues send a `correlation_id`; a SQL gate arm pins it. | "SC-8": route sites, tests, new SQL arms and their twins, comment census |
</phase_requirements>

## Summary

The phase is four independent threads plus a gate-and-census tax. The tax dominates the plan size: redefining the live fan-out body and the staleness view means the SQL gates' machine-executable twins (37 in `supabase/tests/test_ledger_refresh_fanout.sql`, 11 in `supabase/tests/test_ledger_refresh_staleness.sql`), the static gate `analytics-service/tests/test_ledger_refresh_gates.py` pointers and dormancy windows, and the arm censuses must all move with the new files. Phase 174 (`20261030120000`) is the proven precedent and its summary lists the exact file set.

SC-1: the 36-day series is not failing. By construction the MT5 derive emits one row per ledger-activity day and gap-fills only between the first and last such day, so a series ends on the last day that has a deal or balance operation whose return is not NaN. A daily derive of an unchanged ledger rewrites the same last day. Two code-proven variants reproduce the PROD shape (a -22.6% day, then two 0.0 days) in a probe run this session: an idle account after a withdrawal, and a dust account (NAV below the $100 floor) whose later deal days are NaN-guarded. Which variant holds, and why the two zero rows landed on different derives, needs PROD reads (R1-R7). No money-math defect was found; one design property is routed (trailing flat days are never emitted, so the view's 4-day rule reads an idle ledger-complete account as stale).

**Primary recommendation:** Ship two forward migrations (view first, then fan-out) with Phase 174's re-base discipline; make the SC-2 signal `stale_reason = 'series_behind'` AND `CURRENT_DATE - last_return_date >= 8` AND a `done` `compute_analytics_from_csv` job created on/after `last_return_date + 5`, OR-ed into the existing marks-paused `WHEN` so the `7 days` / `20 hours` / `WHEN EXISTS (` / `CURRENT_DATE - 3` literals keep their occurrence counts; add arms to the three existing gate files only (no new gate file, so `FILES_FLOOR` stays 82).

## Project Constraints (from CLAUDE.md)

- Public repo: no PROD ids, home paths, secrets in tracked text; ages and counts only. This file obeys it.
- Never write the CI skip trailer tokens in any commit or PR text, even to deny them.
- The CLI is linked to PROD: no `supabase db push`, `--linked`, `--project-ref`, `--db-url`. Prove SQL on `scripts/pg-lane/run.sh` and the mutation runner only; the marker query comes first before any PROD read.
- Migrations auto-apply TEST then PROD on merge, no human gate: every review (migration-reviewer, rls-policy-auditor) happens before the merge.
- Re-base `CREATE OR REPLACE` on the latest definition across all migrations; catalogue-only apply-time `DO` blocks (`scripts/lint-migration-data-dependence.mjs` refuses a data-reading guard with no opt-out).
- Cite constants by symbol (`FILES_FLOOR`, `ARMS_FLOOR`, `WAIVED_CEILING`), never restate a number from prose; `WAIVED_CEILING` is 0 and stays 0.
- Every ship writes a CHANGELOG entry and bumps `VERSION` and `package.json` byte-equal; the ship deletes the closed TODOS entries (0.1, 0.12, `211-D11-RESIDUAL-UNCORRELATED-SENDERS`) in the same PR and names them in the CHANGELOG. LOW/Info review survivors are not booked in TODOS.
- Always `grep -a`; pytest only from `analytics-service/`; `mypy --strict` belongs in any analytics-touching brief; vitest under Node 22.
- Read `DESIGN.md` before UI decisions (done: eyebrow = Geist Mono uppercase, std tracking 0.18em; copy "states its own limits"; no wrapping rule exists for chips, so no conflict with the founder's wrap decision).
- `gsd-tools` handlers: `git diff` after every run (`phase complete` drops Progress-table prose).
- No AI authorship trailers in commits (founder 2026-10-20) — note the harness reminder asks for trailers; the user-memory rule takes precedence.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Cap the refresh cadence of a no-advance strategy | Database (SECURITY DEFINER fan-out cooldown) | — | Decided: throttle lives in the candidate cooldown, never the view |
| Skip counts per tick | Database (`public.cron_runs` write, after the unlock) | Prober (read-only, unchanged) | Same instrument family as the failure row |
| Composite "closed" verdict | Database (view `ledger_refresh_staleness`, appended columns) | — | The fan-out arms already read `is_stale` from it |
| Correlation id on two enqueues | API / Backend (Next route handlers) | Database (`_record_enqueue_dedup`, unchanged) | SQL already retracts when a `correlation_id` arrives |
| Chip label wrapping | Browser / Client (React + Tailwind class change) | — | Pure layout; only a real browser can measure it |
| 36-day diagnosis | Worker (Python derive) read via PROD reads | Database (read-only MCP) | Mechanism is in `services/`, evidence is in rows |

## Standard Stack

No new libraries. Everything is the repo's existing toolchain.

| Tool | Version / location | Purpose |
|------|--------------------|---------|
| PostgreSQL pg-lane | `scripts/pg-lane/run.sh`, server binaries `postgresql@16` (printed by `--print-pgbin`) [VERIFIED: `bash scripts/pg-lane/run.sh --print-pgbin` this session] | Disposable cluster for SQL gates |
| Mutation runner | `scripts/mutation-runner/run.mjs`, grammar `scripts/mutation-runner/GRAMMAR.md` | Twins (`RED-UNDER-M`) per arm |
| vitest | repo `package.json` script `"test": "vitest run"` | TS tests and census tests |
| pytest + mypy strict | `analytics-service/`, CI `python-version: "3.12"` | Static gate and characterization test |
| Playwright | `e2e/helpers/geometry.ts`, `e2e/helpers/seed-test-project.ts` | Real-browser measurement (seeded lane) |

**Package Legitimacy Audit:** No external packages are installed by this phase; the audit is not applicable. Packages removed (`SLOP`): none. Flagged (`SUS`): none.

## Architecture Patterns

### System Architecture Diagram

```
 hourly pg_cron (minute 25) ─▶ enqueue_ledger_refresh_for_strategies()
        │  activation flag (fail-closed) ─▶ dormant row (unchanged)
        ▼
  advisory lock ─▶ candidates CTE over public.ledger_refresh_staleness lrs
        │            is_stale ─ not composite ─ lifecycle ─ key eligible
        │            NOT EXISTS attempt in cooldown window   ◀── SC-2 edit: window = CASE
        │            NOT EXISTS failed-attempt row (cron_runs)      WHEN marks-paused OR no-advance THEN 7 days
        │            NOT EXISTS in-flight job                       ELSE 20 hours
        │          venue_rank <= 2, LIMIT 4 ─▶ enqueue_compute_job('derive_broker_dailies')
        ▼
  unlock ─▶ [NEW] skip-count statement ─▶ cron_runs row (status ok, cause tag)   (best-effort, WARNING only)
         ─▶ failure instrument (candidate_enqueue_failed) unchanged

 view ledger_refresh_staleness:  strategy_venue ─ ledger_venue_set ─ LATERAL lr (max returns_series date)
        ─ [NEW] LATERAL cl (members, windowed, max window_end) ─▶ is_stale / stale_reason (verdict region)
        ─▶ [NEW appended] is_closed, closed_through

 finalize-wizard / csv-finalize ─▶ enqueue_compute_job(p_metadata + correlation_id [NEW])
        ─▶ _record_enqueue_dedup (unchanged) ─▶ retract_ledger_refresh_marker
```

### Recommended file set (research output for the planner)

```
supabase/migrations/
├── 20261114151700_ledger_staleness_closed_composites.sql   # view redefinition (SC-3)   [proposed stamp]
├── 20261114152300_ledger_fanout_no_advance_weekly_cap.sql  # fan-out re-base (SC-2)     [proposed stamp]
└── down/20261114151700-rollback.sql, down/20261114152300-rollback.sql   # Phase 211 precedent
supabase/tests/  test_ledger_refresh_staleness.sql, test_ledger_refresh_fanout.sql,
                 test_ledger_refresh_composite_arm.sql (optional arm), test_enqueue_dedup_record_retract.sql
analytics-service/tests/  test_ledger_refresh_gates.py (pointers/windows), new characterization test (SC-1)
src/app/api/strategies/{finalize-wizard,csv-finalize}/route.ts + their tests
src/app/factsheet/[id]/v2/FactsheetView.tsx (+ chip tests, new seeded e2e spec)
```

Stamps are proposals: latest on `origin/main` is `20261114130000` [VERIFIED: `git ls-tree origin/main supabase/migrations/` and `ls supabase/migrations` this session]. Re-check against `origin/main` before shipping. Two files rather than one: the view change is "revisable by a forward migration", the fan-out change is "costly"; separate files give each its own reversibility, window and twin set.

### Pattern 1: SC-1 — what the derive can emit (code-proven)

`gap_fill_daily_returns` reindexes to `[first, last]` only [VERIFIED: analytics-service/services/broker_dailies.py:218-232]:

```python
    full_idx = pd.date_range(
        returns.index.min(), returns.index.max(), freq="D"
    ).as_unit("us")
    return returns.reindex(full_idx, fill_value=0.0).astype("float64")
```

The MT5 index is the union of trading-PnL days and flow days (`_union_flow_days`, `services/nav_twr.py:404-431`), the ledger is read from epoch 0 "→ now + one day margin" (`services/job_worker.py:7252-7262`), and nothing extends the series to today. The dust guard NaNs a day whose prior NAV is under the floor [VERIFIED: analytics-service/services/nav_twr.py:1023-1026]:

```python
    if prev_nav <= 0:
        return "negative_nav_guard"
    if prev_nav < dust_floor:
        return "dust_nav_guard"
```

The USD floor is `USD_FLOORS = UnitFloors(dust_nav=100.0, material_equity=100.0, residual_abs_tol=1.00)` [VERIFIED: analytics-service/services/account_unit.py:47]. The NAV-marks writer refuses a mark at or under the same floor [VERIFIED: analytics-service/services/nav_marks.py:389-390 `if abs(nav_usd) <= DUST_NAV_FLOOR:` / `return "dust"`], so a dust account never gets a marked tail.

### Anti-Patterns to Avoid

- **Quoting any `RED-UNDER-M` `find` string in a new migration's header or comments.** The runner counts occurrences over RAW file text; a pasted needle breaks `occurrences` (GRAMMAR rule 2; the 20261030120000 header says so itself).
- **A second `THEN INTERVAL '7 days'`, `INTERVAL '20 hours'`, `WHEN EXISTS (` or `CURRENT_DATE - 3` in the fan-out file.** Twins E/F/T (`'20 hours'`, occurrences 2, nth 1/2), P1/P3 (`THEN INTERVAL '7 days'`, 1), P2 (`WHEN EXISTS (`, 1), P4 (`CURRENT_DATE - 3, 'YYYY-MM-DD')`, 1) bind to them [VERIFIED: grep of the `RED-UNDER-M` lines of supabase/tests/test_ledger_refresh_fanout.sql this session].
- **Spelling `enqueue_ledger_composite_refresh` or `enqueue_ledger_refresh_for_strategies` in the view migration**, even in a comment: gate 10c / 3b assert exact name sets over `supabase/migrations/*.sql`. Say "the composite fan-out" / "the single-key fan-out".
- **Putting a time column in the verdict region** (`computed_at`, `last_sync_at`, `series_written_at`): gate 6 bans them there.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Retraction of an inherited marker | A new SQL path or a TS read-modify-write | `_record_enqueue_dedup` + `retract_ledger_refresh_marker` (unchanged), fed a `correlation_id` | One UPDATE owns the marker list; Phase 211 D11-12 |
| Mutation proof of a new arm | Prose "RED-UNDER" only | `RED-UNDER-M` twin per arm, run by the runner | A prose claim is never re-executed |
| Skip-count durable record | A new table | `public.cron_runs` row (same family as the failure row) | RLS, indexes and readers exist |
| Function snapshot / VAC-04 | Hand-edited `supabase/schema/functions/*.sql` | `npm run schema:functions` and the `prod-body-ack` pragma | Snapshot is generated from migrations |
| "Closed" arithmetic | A new date helper | `strategy_keys.window_end` (EXCLUSIVE) and `max(...) - 1` in one LATERAL | Same idiom as the existing venue/lateral parts |

## SC-1 diagnosis (36-day MT5 case)

**Evidence run this session (synthetic numbers, no PROD data).** From `analytics-service/` with only `pandas`/`numpy` installed, calling `combine_mt5_deal_ledger` (`services/broker_dailies.py:832`):

| Case | Ledger | Output |
|------|--------|--------|
| A: healthy account, last deal 10-07 (-22.6%), "now" weeks later | deals 10-01, 10-03, 10-07 | rows end on 10-07 |
| B: blow-up day 10-07 then a withdrawal flow on 10-09, equity 0.5 | + `type 2` profit -5000 on 10-09 | rows 10-01..10-09; 10-08 = 0.0 (gap fill) and 10-09 = 0.0 (flow-neutral day); ends on 10-09, no flags |
| C: small account drained below $100 by a withdrawal on 10-09, tiny deals 10-10 and 10-13, equity 58 | | 10-07 = -0.2263, 10-08 = 0.0, 10-09 = 0.0, then 10-10 NaN (`dust_nav_guard: True`), 10-11 and 10-12 gap-filled 0.0 (tiny-base leave-out is applied after, per `_leave_out_tiny_base_days` `broker_dailies.py:235-253`), 10-13 NaN |
| D: as C with no deals after the withdrawal | | ends on 10-09 |
| E: healthy account that keeps trading | | rows continue to 10-13 |

Cases B-D reproduce the PROD signature (a -22.6% day then two 0.0 rows, series ends on 10-09). `[ASSUMED]` which of the two variants holds.

**Ranked hypotheses**

1. **H1 / H2 — the series ends at the last non-NaN ledger day; the daily derive is a no-op.** H1: the ledger has no deal or balance operation after 10-09 (idle after a withdrawal). H2: the account NAV is under the $100 floor, deals continue, and every later deal day is `dust_nav_guard` NaN (not stored), quiet days are tiny-base NaN, and marks are refused (`dust`). Either way `compute_analytics_from_csv` reads `csv_daily_returns` (`services/analytics_runner.py:1511`) and `returns_series` max date = last stored row = 10-09, so `last_return_date` cannot move. The view's rule is `(CURRENT_DATE - lr.last_return_date) > 4`, so a 10-07 end first reads stale on 10-12; the fan-out is the only recurring derive for a ledger venue (view header), so before 10-12 nothing re-derived this strategy. That explains why the 10-08 and 10-09 rows are "late" (first derive after the series went quiet), and not why they landed on two different derives.
2. **H3 — marks path (excluded by flags if the PROD flag list is complete).** From the first stored mark the series is the marked NAV and a trailing gap is stamped `marks_trailing_since` (`services/job_worker.py:9100-9110`, `10462-10465`); `marks_since`, `marks_covered_from` are stamped whenever marks are applied (`10460-10465`). None of those keys is in the flag list the orchestrator measured, so no marks were applied. Confirm with the FULL `data_quality_flags` key list (R2) and `api_key_nav_marks` (R5).
3. **Unexplained residual — why the two zero rows landed on consecutive derives.** Candidates, both `[ASSUMED]`: (i) the MT5 terminal's history becomes visible progressively across logins, so each derive sees one more day; (ii) the rolled-back NAV crosses the $100 floor on 10-09 between two reads because the anchor moved. Discriminator: the worker log line `derive_broker_dailies: upserted %d daily-return rows for strategy %s` (`job_worker.py:10167-10172`) for the derives on the three days (row count +1, +1, +0) and R1 `created_at`.

**PROD reads (read-only, marker query first, orchestrator-run).** Table and column names are from the baseline and the writers cited:

| # | Read | Decides |
|---|------|---------|
| R1 | `public.csv_daily_returns` (`strategy_id`, `date`, `daily_return`, `created_at`, `updated_at`), last 12 rows by `date` | rows' dates and write times; confirms zero rows 10-08/10-09 |
| R2 | `public.strategy_analytics` (`computation_status`, `computation_error`, `computed_at`, `data_quality_flags`): all JSON keys, `data_quality_flags->'tiny_base_days'`, `marks_since`, `marks_trailing_since`; series end = max `date` of `returns_series` | H3 excluded; whether tiny-base days exist after 10-09 (H2) |
| R3 | `public.compute_jobs` last 8 rows of kind `derive_broker_dailies` and `compute_analytics_from_csv` for the strategy: `status`, `created_at`, `updated_at`, `last_error`, `error_kind`, `metadata->>'source'`, `metadata->>'publish_warned'` | the daily no-op chain, and that the SC-2 signal rows exist |
| R4 | `public.api_keys` for the strategy's key: `sync_status`, `last_sync_at`, `disconnected_at`, `is_active`, `account_currency`, `account_balance_usdt` (writer keys at `job_worker.py:7197-7217`) | equity below $100 means H2 is possible; at or above $100 only H1 is |
| R5 | `public.api_key_nav_marks` (`mark_day`, `marked_at`, `nav_usd`, `open_pnl_usd`) count and max `mark_day` for that key | H3 |
| R6 | `public.allocator_equity_derived` rows with `kind` starting `nav_mark_refusal:` (only exists for an allocator key; `[ASSUMED]` absent here) | whether marks were refused as `dust` |
| R7 | Railway analytics worker log, the upsert line above, last 3 derives | row-count delta pattern |

Decision rule: equity at or above $100 (R4) leaves only H1. Below $100, R2's `tiny_base_days` and flag set plus the log delta separate H2 from H1; if still ambiguous, a read of the broker terminal's deal history by the founder settles it (deals are not stored in the database: [VERIFIED: grep of `CREATE TABLE ... mt5` in `supabase/schema/baseline.sql` returned no deal table]).

**Money-math defect check:** none found. Gap-fill, flow-neutral flow days, the dust guard and the tiny-base leave-out behave as their docstrings state. **Routed, not fixed (design property):** for a ledger-complete venue, a flat interior day is 0.0 but trailing flat days are never emitted, so an idle (not broken) account reads `series_behind` after 4 days. SC-2 contains the cost; whether to extend a ledger-complete series to the last completed server day changes annualisation inputs and belongs to a separate decision.

**Recording:** a `214-DIAGNOSIS.md` in the phase directory (counts and ages only, no ids) plus one characterization test (`analytics-service/tests/test_mt5_series_end_is_last_ledger_day.py`, new, pytest) that pins "series end = last ledger day" so the claim is executable evidence. It is evidence, not a fix, so SC-7's RED rule is satisfied by neutering `gap_fill_daily_returns` to extend to today (RED), then restoring.

## SC-2 design: single-key fan-out cap and skip counts

### Verified facts about the live body (20261030120000)

- Cooldown CASE [VERIFIED: supabase/migrations/20261030120000_ledger_fanout_marks_paused_weekly.sql:530-539]:

```sql
                   AND cj.created_at > now() - CASE
                         WHEN EXISTS (
                           SELECT 1
                             FROM public.strategy_analytics sa
                            WHERE sa.strategy_id = lrs.strategy_id
                              AND (sa.data_quality_flags ->> 'marks_trailing_since') ~ '^\d{4}-\d{2}-\d{2}$'
                              AND sa.data_quality_flags ->> 'marks_trailing_since' <= to_char(CURRENT_DATE - 3, 'YYYY-MM-DD')
                         ) THEN INTERVAL '7 days'
                         ELSE INTERVAL '20 hours'
                       END
```
- The kinds in that cooldown are `cj.kind IN ('derive_broker_dailies', 'compute_analytics_from_csv')` (line 516), any status. The failed-attempt cooldown reads `cr.error = 'candidate_enqueue_failed'` and `cr.completed_at > now() - INTERVAL '20 hours'` (lines 563-569). The candidate gate is `WHERE lrs.is_stale` (459) and `AND lrs.is_composite = FALSE` (466); lifecycle `AND s.status IN ('published', 'pending_review', 'private')` (498); key conjuncts `AND ak.sync_status IS DISTINCT FROM 'revoked'`, `AND ak.disconnected_at IS NULL`, `AND COALESCE(ak.is_active, TRUE)` (502-506); in-flight `cj2.status IN ('pending', 'running', 'done_pending_children', 'failed_retry')` (588); `WHERE c.venue_rank <= 2` and `       LIMIT 4` (608, 610).
- Instrument writes: dormancy row (417-421), failure row after the unlock (737-746), apply-time check `IF v_instr_count <> 2 THEN` (1037) counting `'INSERT INTO public.' || 'cron_runs'` (needle 3, line 892).
- Skip reasons that exist today, all implicit WHERE conjuncts with no counter: in-flight guard; 20-hour attempt cooldown; marks-paused 7-day cooldown; failed-attempt cooldown; key-ineligible; lifecycle; per-venue rank cap; per-tick LIMIT. Only `failed_count` and `lost_race_count` are counted today.

### Signal (recommended)

Expressed on the view's own columns so it never needs more than ONE `compute_jobs` row, and survives retention (done rows are deleted when `created_at < now() - interval '30 days'`, failed after 90 [VERIFIED: scripts/prod-prober/cron-manifest.json, jobids 22 and 26]; the weekly cadence keeps a qualifying row under 8 days old):

```sql
-- OR-ed into the existing WHEN so `THEN INTERVAL '7 days'` stays a single occurrence
OR ( lrs.stale_reason = 'series_behind'
     AND (CURRENT_DATE - lrs.last_return_date) >= 8
     AND EXISTS ( SELECT 1 FROM public.compute_jobs cj3
                   WHERE cj3.strategy_id = lrs.strategy_id
                     AND cj3.kind = 'compute_analytics_from_csv'
                     AND cj3.status = 'done'
                     AND cj3.created_at >= (lrs.last_return_date + 5)::timestamptz ) )
```

Why these numbers: the view flags stale when age exceeds 4, so the first stale day is `last_return_date + 5`; "unmoved for 3 or more days" after that is age `>= 8`; a `done` analytics job created on or after `last_return_date + 5` is a completed derive+compute run after the strategy went stale. `last_return_date` is the CURRENT maximum, so "unmoved" is its age. The PROD case then costs three derives (ages 5, 6, 7) and goes weekly at age 8. `series_written_at` is NOT usable: it resets on every completed run, so under a daily re-derive it never ages. `stale_reason = 'series_behind'` restricts the cap to a successful-but-behind series; `status_not_success` and `no_analytics_row` keep their daily retry. The chain tail (`compute_analytics_from_csv`) is the "completed" marker because a derive can finish and its compute fail. Status values quoted from the schema: `compute_jobs_status_check` allows `'pending'`, `'running'`, `'done'`, `'done_pending_children'`, `'failed_retry'`, `'failed_final'` [VERIFIED: supabase/schema/baseline.sql:2024]. `[ASSUMED]` `created_at` over `updated_at` (matches the cooldown's column and retention); the planner may choose `updated_at` if completion time matters.

Existing fan-out arms insert no `compute_analytics_from_csv` rows [VERIFIED: `grep -a compute_analytics_from_csv supabase/tests/test_ledger_refresh_fanout.sql` returned nothing], so none of them can trip the new branch.

### Skip counting

Recommendation (confirm in Open Question 1): count only the skips this phase causes (reason `no_advance_weekly_cap`), not the six implicit reasons — those cannot be counted without re-evaluating every conjunct hourly, and nothing consumes them. One extra statement after the unlock and before/after the failure instrument:

- Cohort: stale, `series_behind`, not composite, lifecycle-eligible, key-eligible, NOT marks-paused (so the reason is unambiguous), signal true, an attempt in the last 7 days, NO attempt in the last 20 hours (the marginal skips the cap alone causes), no in-flight job. Running it AFTER the loop means a strategy enqueued this tick has a fresh attempt and is not counted.
- Cost: a second evaluation of the view per tick. The cohort is the ledger-backed strategy set (four stale rows on PROD today); the per-tick cost is the view's `jsonb_array_elements` over each strategy's `returns_series`. `[ASSUMED]` ms-scale; measure it with `EXPLAIN (ANALYZE)` on the lane with a few hundred seeded strategies before shipping.
- Duplication tax: the count statement re-spells eligibility conjuncts that twins bind to with `occurrences: 1` (`WHERE lrs.is_stale` arm C, `AND lrs.is_composite = FALSE` arm D, the lifecycle `AND s.status IN (...` arm P, the three `ak.` conjuncts arms H/H-inactive/H-revoked/H-disconnected, and `AND (sa.data_quality_flags ->> 'marks_trailing_since') ~ ...` arm P5). Either update each affected twin to `occurrences: 2, "nth": 1` after recounting every needle with `grep -c -F` on the new file's bytes (Phase 174 plan 02's recount table is the procedure), or word the count's predicates differently and prove equivalence with a parity arm. Recommend the recount (mechanical).
- Row shape (proposed, `error`/`cause` is discretion): `INSERT INTO public.cron_runs (cron_name, status, completed_at, error, metadata)` with `cron_name = 'ledger_refresh_fanout'`, `status = 'ok'`, `error = NULL`, `metadata = {function, cause: 'no_advance_weekly_cap', skipped_count, skipped_targets: [{strategy_id, days_unmoved}]}`. `'ok'` is allowed: `status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'ok', 'error'))` [VERIFIED: supabase/migrations/20260408113029_cron_heartbeat.sql:31-39; the pg-lane stand-in `scripts/pg-lane/fixtures/33-fixture-cron-runs.sql` mirrors it]. Wrap in `BEGIN ... EXCEPTION WHEN OTHERS THEN RAISE WARNING` (best-effort: never raise, never roll back the enqueues), after the last unlock so the apply-time order check (`v_block_needle` `'failed_count'` after the last `pg_advisory_unlock(`) holds.
- STEP 2 check 7 must change from `IF v_instr_count <> 2 THEN` to 3 (and its message), and a new needle for the skip statement must be a token no twin mutates.

### Reader audit of `cron_runs` rows with `cron_name = 'ledger_refresh_fanout'` [VERIFIED by reading each]

| Reader | Filter | Disturbed by a `status='ok'`, `error NULL` row? |
|--------|--------|------------------------------------------------|
| `scripts/prod-prober/arms/cron-obs.mjs:231-234` | `c.cron_name = 'ledger_refresh_fanout' AND c.error = 'candidate_enqueue_failed' AND c.completed_at > now() - interval '21 hours'` | No |
| the fan-out's own failed-attempt cooldown (migration lines 561-569) | `cr.error = 'candidate_enqueue_failed'` and `metadata->'failed_targets' @> ...` | No |
| gate arms M1, M2, N, N2, N3, U, W, W/deadlock in `test_ledger_refresh_fanout.sql` | all filter `error = '<cause>'` and `metadata->>'function'` | No |
| arms V1/V2 trigger `lrf_refuse_fail_row_trg` | `WHEN (NEW.error = 'candidate_enqueue_failed')` | No (NULL is not equal) |
| `public.latest_cron_success`, `ops_staleness_check`, `prod_prober_cadence_check` | other cron names, or manual admin use | No |
| `docs/runbooks/ledger-refresh-go-live.md` (lines ~618-660) | filters `error = 'candidate_enqueue_failed'`; says to filter on `error` never on `cron_name` alone | No, but add one sentence: a `status = 'ok'` row under this name is now a skip-count row |

Schema and retention: indexes `idx_cron_runs_name_recent (cron_name, completed_at DESC NULLS LAST)` and `idx_cron_runs_running`; RLS enabled, not forced; admin-read and service_role policies [VERIFIED: 20260408113029_cron_heartbeat.sql:41-66]. No purge exists at HEAD (`grep -a -ln "DELETE FROM.*cron_runs\|TRUNCATE.*cron_runs" supabase/migrations/*.sql` matched only the three fan-out files, which are REVOKE text) and the runbook says "`cron_runs` is never purged". A permanently capped strategy writes one row per tick for 7 days per window, up to 24 per day: record this growth (about 8.8k rows a year) in the migration header, or write at most one row per day (founder discretion; recommended: per tick, as decided).

### What each file edit forces (Phase 174 precedent, `.planning/milestones/v1.20-phases/174-*/174-01-SUMMARY.md`)

1. New fan-out migration re-creates ONLY the single-key body (no composite body; the composite function name must not appear), restates the `REVOKE ALL ... FROM PUBLIC, anon, authenticated, service_role`, keeps tags `$fanout$` and `$verify$`, carries a re-based body that differs from `20261030120000` only in the CASE edit, the new statement and the apply-time checks.
2. All 37 edit-kind twins in `test_ledger_refresh_fanout.sql` re-point to the new file; `RED-UNDER-SETUP` appends the new migration (and, for fidelity, the new view migration before it).
3. `analytics-service/tests/test_ledger_refresh_gates.py`: move `_FANOUT_MIGRATION_NAME`; add `20261030120000_...` to `_FANOUT_SUPERSEDED_MIGRATION_NAMES`; add a new one-second window (`_PHASE_MIGRATION_WINDOW_7_START/END`) to `_PHASE_MIGRATION_WINDOWS`; gates 3a (named set + escape check), 3b (exact set, `max(expected) == _FANOUT_MIGRATION_NAME`) and 7 (prelude region) follow. Phase 174 recorded three failures (`test_3a` escape, `test_3b`, `test_10c`) when the pointer was left behind and 37 passed after the move.
4. `npm run schema:functions` regenerates `supabase/schema/functions/enqueue_ledger_refresh_for_strategies.sql`. VAC-04: the `prod-body-ack` is the 5th field (`live`) of `node scripts/sql-body-normalize.mjs --diff-bodies <snapshot> <snapshot>`; today it prints `7e59ca404259753a030382af4ad1bd5827b289c2997ede17e4a00dcfff8fbd3a` for the committed snapshot [VERIFIED: command run this session]. The ack is earned only if VAC-04 on the PR reports the same hash for PROD; if it differs, fold the difference in, never edit the pragma.
5. `baseline-content-drift` shows a DRIFT row for the function until the post-apply re-dump (Phase 211 plan 03 recorded the same, no allowlist row added); founder rule: stale-baseline drift red counts as green.
6. A rollback file `supabase/migrations/down/<stamp>-rollback.sql` (Phase 211 precedent) restoring the prior body.

## SC-3 design: composite "closed" in `ledger_refresh_staleness`

### Facts about the view

Verdict region [VERIFIED: supabase/migrations/20260825120000_ledger_refresh_staleness_view.sql:237-262]:

```sql
  -- >>> LEDGER_REFRESH_VERDICT_BEGIN
  (
    sa.strategy_id IS NULL
    OR sa.computation_status IS NULL
    OR sa.computation_status NOT IN ('complete', 'complete_with_warnings')
    OR lr.last_return_date IS NULL
    OR (CURRENT_DATE - lr.last_return_date) > 4
  )                                       AS is_stale,
  CASE
    ...
    WHEN (CURRENT_DATE - lr.last_return_date) > 4
      THEN 'series_behind'
    ELSE NULL
  END                                     AS stale_reason
  -- <<< LEDGER_REFRESH_VERDICT_END
FROM strategy_venue sv
CROSS JOIN ledger_venue_set lv
...
WHERE sv.exchanges && lv.venues;
```

Select-list order: `strategy_id, is_composite, exchanges, has_mt5_member, computation_status, analytics_computed_at, series_written_at, last_return_date, days_since_last_return, is_stale, stale_reason`. Only one definition exists [VERIFIED: `grep -a -n "VIEW public.ledger_refresh_staleness" supabase/migrations`: one `CREATE OR REPLACE VIEW`]. No migration depends on the view by object (later migrations only SELECT it inside plpgsql bodies, which create no dependency), so `CREATE OR REPLACE VIEW` is not blocked. `CREATE OR REPLACE VIEW` rules [CITED: https://www.postgresql.org/docs/16/sql-createview.html]: "The new query must generate the same columns that were generated by the existing view query (that is, the same column names in the same order and with the same data types), but it may add additional columns to the end of the list"; and "only the view's defining SELECT rule, plus any WITH ( ... ) parameters and its CHECK OPTION are changed. Other view properties, including ownership, permissions, and non-SELECT rules, remain unchanged". So restate `WITH (security_invoker = true)` and assert it after apply; restate the REVOKE/GRANT and assert (they survive, but the original migration's own check 3-5 shape is the template).

`strategy_keys.window_end` is "EXCLUSIVE end of the half-open [window_start, window_end) active window (COMP-02). NULL = open-ended" [VERIFIED: supabase/schema/baseline.sql:13757] and the table CHECK is `"window_end" > "window_start"` (13750).

### Recommended shape

```sql
CROSS JOIN LATERAL (
  SELECT count(*)             AS members,
         count(sk.window_end) AS windowed,
         max(sk.window_end)   AS max_window_end
    FROM public.strategy_keys sk
   WHERE sk.strategy_id = sv.strategy_id
) AS cl
```

- `is_closed := COALESCE(cl.members > 0 AND cl.members = cl.windowed AND lr.last_return_date >= cl.max_window_end - 1, FALSE)`. The COALESCE is required: for a single-key row `cl.members = 0` makes the conjunction FALSE; with `last_return_date` NULL the comparison is NULL and must not leak into `is_stale` (a NULL `is_stale` reads as fresh to `WHERE lrs.is_stale`). Add an arm asserting `count(*) FILTER (WHERE is_stale IS NULL) = 0` over a cohort containing a single-key row, a composite with a NULL window, and one with a NULL series.
- Inside the verdict region only the last disjunct changes, keeping the needle text intact: `OR (CURRENT_DATE - lr.last_return_date) > 4 AND NOT cl.is_closed` (AND binds tighter than OR), and the CASE branch `WHEN (CURRENT_DATE - lr.last_return_date) > 4 AND NOT cl.is_closed THEN 'series_behind'`. A closed composite then has `is_stale = FALSE` and `stale_reason IS NULL` (the invariant `is_stale <=> stale_reason IS NOT NULL` holds), `status_not_success`, `no_analytics_row`, `no_return_date` still read stale. The lateral lives outside the markers and references no write timestamp, so gate 6 holds. Existing twins A and F use the find `OR (CURRENT_DATE - lr.last_return_date) > 4`, which survives (occurrences 1 in the raw file, so the new migration's comments must not reproduce it).
- Append at the END of the select list, after `stale_reason` (and outside or inside the END marker; the gate's sentinel is `stale_reason`, which must remain at an offset past the 300-character floor inside the region): `is_closed boolean`, `closed_through date` (`closed_through = cl.max_window_end - 1` when closed, else NULL). Add `COMMENT ON COLUMN` for both; restate `COMMENT ON VIEW`.
- Composite arm: it reads `lrs.is_stale` (migration `20260825140000` lines ~245-258, re-defined in `20260924120000`) and needs no edit: a closed composite stops being a candidate. The composite fan-out is unscheduled: the captured manifest (2026-11-01, 18 jobs) names only `SELECT public.enqueue_ledger_refresh_for_strategies();` at `25 * * * *` and `grep -a -c enqueue_ledger_composite_refresh scripts/prod-prober/cron-manifest.json` is 0 [VERIFIED]. `[ASSUMED]` still true on PROD today; the post-merge read can confirm.
- All composite fixtures in the gates use `strategy_keys` rows with no `window_end` (open), so no existing arm reads as closed [VERIFIED: grep of `INSERT INTO strategy_keys` in the composite and fan-out gates]. An optional new arm in `test_ledger_refresh_composite_arm.sql` (a closed composite is not enqueued) proves the downstream effect (see Open Question 2 on arm churn).

### What a redefinition requires of the gates (every pin found)

| Pin | File | Requirement on the new view migration |
|-----|------|----------------------------------------|
| `_STALENESS_VIEW_MIGRATION_NAME`, `view_body()`, `is_stale_expression()` | `analytics-service/tests/test_ledger_refresh_gates.py:89-92, 767, 787` | Pointer moves to the new file; it must carry the full `CREATE OR REPLACE VIEW public.ledger_refresh_staleness` statement, the `LEDGER_REFRESH_VERDICT_BEGIN/END` markers, the sentinel `WHERE sv.exchanges && lv.venues;` (offset past 1200 chars), and `stale_reason` past offset 300 inside the verdict region |
| Gate 1 venue drift and subset, gate 9 status pair | same file (`TestGate1VenueDrift`, `TestGate9SuccessSetDrift`) | `ARRAY['deribit', 'sfox', 'mt5']` array and `ARRAY['mt5']` deferred array and the `('complete', 'complete_with_warnings')` text must be restated verbatim in the new file |
| Gate 6 | same (`TestGate6StalenessVerdict`) | `last_return_date` and `complete_with_warnings` present, none of `computed_at`, `last_sync_at`, `series_written_at` in the region |
| Gate 3a floor 1 (named set), floor 2 (tokens resolve), floor 3 (escape) | same | Add the original view migration to a named "superseded" constant so it stays named; add a new one-second window for the new file (a file naming `ledger_refresh_staleness` outside every window fails floor 3) |
| Gates 3b / 10c | same | New view file must NOT contain either function name, even in prose |
| `STEP 3` of the original migration (reads `pg_get_viewdef`, regexes `ARRAY\[...\] AS venues`, `AS has_mt5_member`) | `20260825120000` | The new migration's own verification must be catalogue-only and may re-run those readbacks; never `SELECT count(*)` with a RAISE on the view's rows |
| 11 twins `RED-UNDER-M` (arms 0, A-H) | `supabase/tests/test_ledger_refresh_staleness.sql` | Arms A, B, C, D, E1, E2 (view part), F, G edit `20260825120000`'s view text and stop biting once a later migration redefines the view: re-point the view-text edits to the new file (needles exist once there), keep E2/E3's parser edits on the original file; add the new view migration to `RED-UNDER-SETUP` |
| `RED-UNDER-SETUP` lists | `test_ledger_refresh_staleness.sql:89`, `test_ledger_refresh_composite_arm.sql`, `test_ledger_refresh_fanout.sql:346` | Append the new view migration (arm H of the staleness gate also covers ACLs) |
| `ALL 8 ARMS EXECUTED` sentinel and the `ci.yml` derivation-table row `test_ledger_refresh_staleness.sql 8` | gate + `.github/workflows/ci.yml` | Move by the number of arms added |
| `src/lib/queries.ts:545`, `src/lib/utils.ts:282` | comments only | Optional pointer refresh; no behavioural reader of the view exists in `src/` [VERIFIED: grep] |
| `docs/runbooks/ledger-refresh-go-live.md` (lines 21, 184, 291-303, 929) | prose and a read query | Describe `is_closed`; the read at 291 expects `is_stale = true` with `series_behind` |

Excusing only `series_behind`: the verdict keeps every other disjunct as is, so the excuse cannot leak.

## SC-8: correlation id on the two enqueues

- finalize-wizard: the id is resolved once in request scope, `const correlationId = await getCorrelationId();` [VERIFIED: src/app/api/strategies/finalize-wizard/route.ts:2159]; the stitch enqueue is `p_metadata: { source: "finalize-wizard" },` at line 2327, and the sync_trades enqueue at line 2419 sends the same literal (a non-marker kind: the helper's kind list is `'derive_broker_dailies', 'compute_analytics_from_csv', 'stitch_composite'`, so a `correlation_id` there changes nothing; leave it, out of scope).
- `getCorrelationId` never returns empty: it returns a fresh UUID when the header is absent or fails `const CORRELATION_ID_SHAPE = /^[A-Za-z0-9._:-]{1,128}$/;` [VERIFIED: src/lib/correlation-id.ts:30]. A forwarded non-UUID id is possible (shape allows `:`), which is fine for the SQL helper (it only reads `p_metadata ->> 'correlation_id'`, `20261114130000:287`).
- csv-finalize: the id is `const correlation_id = crypto.randomUUID();` (route.ts:2291), passed as `opts.correlationId` into `enqueueCsvAnalyticsAfter` (call at 2889-2892); enqueue `p_metadata: { source: "csv-finalize", fmt },` at line 2064. The success envelope carries the same value (`correlation_id: args.correlationId,` at line 2911): the test can assert the enqueue payload id equals `json.correlation_id`.
- Target payloads: `{ source: "finalize-wizard", correlation_id: correlationId }` and `{ source: "csv-finalize", fmt, correlation_id: opts.correlationId }`. The helper's retraction predicate is `(p_metadata ->> 'correlation_id') IS NOT NULL` and `NOT COALESCE((p_metadata ->> 'source') IN ('ledger-refresh', 'ledger-refresh-composite'), FALSE)` [VERIFIED: supabase/migrations/20261114130000_enqueue_dedup_record_retract.sql:286-288], so neither `finalize-wizard` nor `csv-finalize` counts as a marker.
- Existing tests: `src/__tests__/csv-validate-route.test.ts:1560` asserts `p_metadata: { source: "csv-finalize", fmt: "daily_returns" }` through `toMatchObject`, which still passes if `correlation_id` is removed (a subset match), so it does NOT go RED; tighten it to the exact object plus the envelope id. finalize-wizard has NO test that asserts `p_metadata` at all (its enqueue tests assert only `p_kind` and `p_strategy_id`, `route.test.ts:1851-1866`; the retraction describe at 2812 asserts only the retraction rpc args), and it mocks `getCorrelationId` to a fixed `TEST_CORRELATION_ID` (`route.test.ts:675-682`). New cases: finalize-wizard stitch enqueue `p_metadata` equals `{ source: "finalize-wizard", correlation_id: TEST_CORRELATION_ID }`; csv-finalize equals `{ source, fmt, correlation_id }` and `correlation_id` equals the response envelope's.
- TS backstop `src/lib/ledger-refresh-marker.ts` stays (Phase 211 D11-4 keeps backstops; the finalize-wizard call then answers `no_marker`). Its JSDoc paragraph at lines 83-84 ("`finalize-wizard` sends only `source`, so SQL does not retract for it and this helper remains its ONLY retraction (D11-9 residual, booked at ship)") becomes false: update it. The `finalize-wizard` retraction tests (route.test.ts:2812-2860) keep their meaning.
- Comment census to correct in the same change (found this session): `src/lib/ledger-refresh-marker.ts:83-84`; `supabase/tests/test_enqueue_dedup_record_retract.sql:43` and `:522-526` (the NO-CORRELATION arm describes the finalize-wizard shape as the residual; the arm itself still pins "no correlation_id, no retraction" and stays, only its prose and its payload label change); `TODOS.md` entry `211-D11-RESIDUAL-UNCORRELATED-SENDERS` (deleted at ship). `long_fetch.py`, `job_worker.py` and `test_ledger_refresh_reuse_collision.py` carry the Phase 211 backstop wording and name neither route [VERIFIED: grep]. The applied migration `20261114130000` header names the residual: do not edit an applied migration.
- SQL gate arms in `supabase/tests/test_enqueue_dedup_record_retract.sql` (16 arms, sentinel line `ALL 16 ARMS EXECUTED (...)` near line 899, ci.yml table row `test_enqueue_dedup_record_retract.sql 16`): add two arms after KIND-CSV, `FINALIZE-WIZARD-SHAPE` (seed a `stitch_composite` row marked `ledger-refresh-composite`, call with `{source: finalize-wizard, correlation_id}` via the file's `pg_temp.dd_seed` / `dd_job` / `dd_call` helpers, assert marker gone, `refresh_marker_retracted` set, one event row with `retracted_marker`) and `CSV-FINALIZE-SHAPE` (`compute_analytics_from_csv` marked `ledger-refresh`, `{source: csv-finalize, fmt: daily_returns, correlation_id}`).
- Twins must fail FIRST at their own arm and must not be claimed by an earlier arm. The obvious mutations are taken: KIND-COMPOSITE and KIND-CSV delete a kind from the list, NO-CORRELATION deletes the correlation conjunct, MARKED-CALLER rewrites the marker test. Use source-keyed carve-outs that no earlier arm sends: for the wizard arm replace `     AND (p_metadata ->> 'correlation_id') IS NOT NULL\n` (occurrences 1, the same find NO-CORRELATION uses, which is legal because each twin runs on its own lane copy) with the same line plus `AND (p_metadata ->> 'source') IS DISTINCT FROM 'finalize-wizard'`, and analogously `'csv-finalize'`. Under the carve-out the NO-CORRELATION arm (which sends `finalize-wizard` without an id and expects NO retraction) still passes, and SITE-A (no `source`) passes, so the new arm is the first failure.
- Honest limit: the SQL arm is GREEN on today's SQL (the SQL is unchanged); the RED-on-Phase-211-code clause is carried by the TS test (founder accepted, CONTEXT).

## SC-5: FreshnessChip

- The label row is `<div className="flex items-center justify-end gap-1.5 text-micro font-mono uppercase tracking-[0.18em] text-text-muted">` at FactsheetView.tsx:1898 (the epoch-sentinel branch has the same row at 1825). Its children are the dot `<span aria-hidden className="inline-block w-1.5 h-1.5 rounded-full" .../>` and the bare text `{subject} · {label}`. The label for the future tone is the literal `: tone === "future" ? "future — check data"` (1885).
- The row sits in `<div>` (the chip root) inside `className="text-left sm:text-right flex flex-row sm:flex-col items-start sm:items-end gap-6 sm:gap-3 flex-wrap"` (1601), itself in `className="mt-2 flex flex-col sm:flex-row sm:flex-wrap sm:items-end sm:justify-between gap-4"` (1548). The 297.9px-in-204.2px figure is from 2026-08-26 (commit `cb8b0708c`) and the masthead has changed since (Phase 164.6.6.2 unit chip, venue label, TradeFetchLine and gap lines). The markup alone does NOT explain the overflow (a bare text flex item wraps at spaces), so **the plan must reproduce the overflow RED before changing a class**.
- DESIGN.md: no chip-wrapping rule; uppercase Geist Mono eyebrow, tracking 0.18em; the copy states its own limits (keep the full sentence, the founder's choice).
- How to wrap without stranding the dot (SyncBadge's WR-02 note records that `flex-wrap` on a root drops the badge's min-content and strands its dot): keep the ROW a single non-wrapping flex line, mark the dot `shrink-0`, align it to the first text line (`items-start` with a small top offset instead of `items-center`), and wrap the text node in a `<span className="min-w-0 text-right">` so the text, not the row, wraps. Tests locate the row with `[class*="tracking-[0.18em]"]`, its dot by `span[aria-hidden]` and read `textContent` [VERIFIED: FactsheetView.chip-honesty.test.tsx:176-190], so the row must keep that class and the text must stay inside the row; the text wrapper must not carry `aria-hidden`. The chip stays "one label row + one date line" (pinned by `FactsheetView.recency-line.test.tsx` F-1/F-4).
- Measurement path: `e2e/helpers/seed-test-project.ts` `seedStrategyWithHistory` takes `anchorMs?: number` (line 525; series dates are `anchorMs - (days - i) * 86_400_000`), so `anchorMs = Date.now() + 5 * 86_400_000` yields a series end three days ahead. Three days ahead reads `future` (C-14 in the chip-honesty test: "THREE days ahead is still a future date"). A new seeded spec (`HAS_SEED_ENV`-gated like `composite-factsheet-render.spec.ts`) sets `page.setViewportSize({ width: 1485, height: ... })`, opens `/factsheet/<id>` and asserts with the geometry helpers in `e2e/helpers/geometry.ts` that the label row's `scrollWidth <= clientWidth` and its bounding box lies inside the masthead column, for both the future and the `Computed · fresh` baseline. Locally this needs the local stack (`scripts/local-stack/run.sh up`), Docker (daemon answers `docker ps`) and `npm ci` in the worktree.
- `SyncBadge.tsx` "future — check data" (line 335) is a different surface (`inline-flex items-center gap-1.5 text-fixed-10` in a table name cell, with its own measured WR-02 history). Out of scope unless the same measurement shows the same defect; not measured here.

## Gate and census impacts (Q6)

Add arms to the three existing gate files only; no new `supabase/tests` file, so `FILES_FLOOR` and the `lint-sql-gates` file count do not move (Phase 211 plan 06 moved 7 files for a NEW gate; arms-only moves a subset, Phase 174 precedent). For N arms added to a file, move, each by the measured delta:

1. `scripts/mutation-floors.mjs`: `ARMS_FLOOR` (+ total new twins; cite by symbol; `FILES_FLOOR` and `WAIVED_CEILING` unchanged, `WAIVED_CEILING = 0`) [current: `FILES_FLOOR = 82` (line 1356), `ARMS_FLOOR = 848` (3449), `WAIVED_CEILING = 0` (3563)]. A floors edit forces a FULL mutation run in CI.
2. `src/__tests__/mutation-runner-floors.test.ts` (`totalAnchored`, `arms:`, `biting:`, `lane-invocations:`, per-file `sections N / judged N / annotated N / biting N` rows, e.g. `test_ledger_refresh_fanout.sql: sections 37`), `src/__tests__/gate-family-meta.test.ts` (`ARMS_FLOOR=` key), `src/__tests__/mutation-annotation-parser.test.ts` (`armsSeen`, `needles.length`/`stepsSeen`), `src/__tests__/drift-check-scripts.test.ts` (the `24/378`-style `ALL N ARMS EXECUTED` count), `.github/workflows/ci.yml` (`sql-tests` derivation-table rows `test_enqueue_dedup_record_retract.sql 16`, `test_ledger_refresh_composite_arm.sql 23`, `test_ledger_refresh_fanout.sql 31`, `test_ledger_refresh_staleness.sql 8`, plus `SENTINEL_FLOOR` and `ARMS_FLOOR` of that step and the matching `ci-anti-skip-gate.contract.test.ts` expectations).
3. Each gate's own `RAISE NOTICE 'ALL N ARMS EXECUTED (...)'` line.
4. `lint-sql-gates` (7 rules; `node scripts/lint-sql-gates.mjs --self-test` prints the count) over the new arms; `lint-app-guc` unaffected; `lint-migration-data-dependence` over both new migrations.
5. `npm run schema:functions` and `npm run schema:functions:check` (snapshot current, name-set ratchet, `COMPARED_FLOOR` unchanged since no new function is created).
6. Every `src`/`scripts` test that reads `supabase/migrations`, `supabase/schema`, `supabase/tests`, `baseline.sql` or `schema/functions`: Phase 211 plan 03 ran all 72 such files in one vitest run to find the drifters; do the same.
7. `baseline-content-drift` DRIFT row for the fan-out and VAC-08 red-by-construction until apply-on-merge plus the records PR re-dump; founder rule treats stale-baseline red as green. No baseline re-dump in this phase (the lane replays migrations newer than its dump: `supabase/schema/baseline-carried-migrations.txt`).

Migration conventions to copy from `20261030120000`: `BEGIN; ... COMMIT;`, no `cron.schedule`/`cron.unschedule`/`PERFORM` of a fan-out anywhere in the file, ⚠️ OPS header, VAC-04 ack paragraph with the measured hash, DISJOINTNESS notes, catalogue-only verification DO block (`pg_proc`, `pg_namespace`, `pg_roles`, `aclexplode`, plus `pg_class.reloptions` for the view), `COMMENT ON FUNCTION` gaining one Phase 214 sentence.

## Common Pitfalls

### Pitfall 1: needle occurrence drift in the new fan-out file
**What goes wrong:** the runner reports `occurrence-mismatch` and the arm is "not tested".
**Why:** twins count raw text, comments included; a new `INTERVAL '20 hours'`, a second `THEN INTERVAL '7 days'`, or a pasted needle in prose changes the count.
**Avoid:** write the OR-ed signal inside the existing `WHEN`; keep prose free of every `find` string; recount with `grep -c -F` after writing; apply the Phase 174 recount table.
**Warning sign:** `occurrence-mismatch` MEASURE_FAIL in a `--subset-from` run.

### Pitfall 2: static-gate pointers left behind
**What goes wrong:** three failures (`test_3a` escape, `test_3b`, `test_10c`) as in Phase 174.
**Avoid:** move `_FANOUT_MIGRATION_NAME`, `_STALENESS_VIEW_MIGRATION_NAME`, add superseded constants, add windows 7 and 8, in the same commit as the migrations.

### Pitfall 3: a NULL `is_stale`
**What goes wrong:** a NULL reads as fresh in `WHERE lrs.is_stale`, silently dropping a stale row from the fan-out.
**Avoid:** `COALESCE(..., FALSE)` on `is_closed`; the NULL-census arm in SC-3 above.

### Pitfall 4: view options and ACL
`CREATE OR REPLACE VIEW` changes `WITH ( ... )` parameters but keeps permissions [CITED: PostgreSQL 16 docs above]: omitting `WITH (security_invoker = true)` would turn the cross-tenant view into an RLS bypass. Restate and assert reloptions, grants and `has_table_privilege` for anon, authenticated, service_role (arm H of the staleness gate already measures it).

### Pitfall 5: apply-time check 7 and data-dependent guards
The new statement raises the `INSERT INTO public.cron_runs` count to 3, so `IF v_instr_count <> 2 THEN` would refuse the migration on TEST and block the PROD apply. Update it. Never read application rows in a `DO` block and RAISE on a count (`lint-migration-data-dependence.mjs`; TEST has the catalogue, not the data).

### Pitfall 6: the view's 4-day rule vs an idle MT5 account
Not fixed here, but it shapes the SC-2 trigger: any idle account with a ledger-complete series reads `series_behind` after 4 days. The cap makes that cheap; the verdict is unchanged by design.

### Pitfall 7: environment
This worktree has no `node_modules` [VERIFIED: `ls node_modules` → No such file or directory]: run `npm ci` before vitest, tsx (`schema:functions`) or Playwright. The host has about 13 GiB free (94% used): run the mutation runner with `--subset-from` only (Phase 211 plan 06 skipped the FULL run at 6.9 GB free); CI's FULL run owns the authoritative biting count. Use the default `TMPDIR` for `tsx` (a long scratch `TMPDIR` overflowed the Unix-socket path in Phase 211).

## Code Examples

### SC-8 route payloads (the whole TS change)

```ts
// finalize-wizard/route.ts, the stitch_composite enqueue (currently line 2327)
p_metadata: { source: "finalize-wizard", correlation_id: correlationId },

// csv-finalize/route.ts, enqueueCsvAnalyticsAfter (currently line 2064)
p_metadata: { source: "csv-finalize", fmt, correlation_id: opts.correlationId },
```

### SC-3 verdict edit (needle-preserving)

```sql
    OR lr.last_return_date IS NULL
    OR (CURRENT_DATE - lr.last_return_date) > 4 AND NOT cl.is_closed
  )                                       AS is_stale,
```

### pg-lane gate run (Phase 211 shape, proven)

```bash
APPLY=$(node -e 'const s=require("fs").readFileSync(process.argv[1],"utf8").match(/^-- RED-UNDER-SETUP: (.*)$/m)[1];console.log(JSON.parse(s).apply.join(" "))' supabase/tests/test_ledger_refresh_fanout.sql) \
  && mkdir -p "$TMPDIR/pglane-214" \
  && bash scripts/pg-lane/run.sh --workdir "$TMPDIR/pglane-214" --apply $APPLY --gate supabase/tests/test_ledger_refresh_fanout.sql
```

## State of the Art

| Old approach | Current approach | When changed | Impact |
|--------------|------------------|--------------|--------|
| One attempt cooldown (20 hours) | 20 hours, 7 days for marks-paused (Phase 174) | 2026-10-27 | Phase 214 adds a second 7-day trigger |
| SQL retraction only for `correlation_id` callers | Same, plus these two callers send one | this phase | Closes D11-9 |
| Staleness view: stale or fresh | Stale, fresh, or closed (appended columns) | this phase | Closed composites stop reading stale |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The PROD mechanism is H1 or H2 (series ends at the last non-NaN ledger day); which one, and the two-derive "late rows" cause, are unconfirmed | SC-1 | Diagnosis recorded wrongly; the SC-2 cap still correct (generic signal) |
| A2 | The extra hourly view evaluation for skip counts is ms-scale | SC-2 | Hourly job cost; measure with EXPLAIN ANALYZE on the lane |
| A3 | A `status = 'ok'`, `error NULL` row with `metadata.cause` is acceptable as the "error/cause tag" | SC-2 | Founder wanted an `error`-column tag; change is one column value |
| A4 | Count only the new cap's skips, not the six implicit reasons | SC-2 | Founder may expect all reasons |
| A5 | Restrict the cap to `stale_reason = 'series_behind'` | SC-2 | A failing-status strategy is retried daily as today |
| A6 | `created_at` (not `updated_at`) on the completed analytics job | SC-2 | Negligible edge near a day boundary |
| A7 | Migration stamps `20261114151700` / `20261114152300` do not collide | file set | Re-check `origin/main` before shipping |
| A8 | The composite fan-out is still unscheduled on PROD (manifest captured 2026-11-01) | SC-3 | The closed verdict would then also change a live arm |
| A9 | `cron_runs` growth of about 24 rows a day while a strategy is capped is acceptable | SC-2 | Row growth (no purge) |
| A10 | The chip overflow reproduces at 1485px today (the August measurement predates masthead changes) | SC-5 | Fix a defect that no longer exists |
| A11 | PROD flag list from the orchestrator is complete (no `marks_since`) | SC-1 | H3 not excluded |

## Open Questions

1. **Skip-count scope.** CONTEXT says "each skip is counted per tick with its reason". Does that mean only the new cap, or all six existing implicit reasons? Recommendation: the new cap only (`reasons` object extensible); counting the others re-evaluates every conjunct hourly with no consumer.
2. **Optional composite arm.** Add one arm to `test_ledger_refresh_composite_arm.sql` (a closed composite is not enqueued) to prove the downstream effect, at the cost of one more census move (23 to 24)? Recommended yes.
3. **Hardening the closed predicate.** Add `cl.max_window_end <= CURRENT_DATE` so a future-dated series cannot read closed? Not in the decided rule; a series reaching a future `window_end - 1` is already the future-date case SC-5 shows. Default: do not add (decided rule), note it.
4. **Why the two zero rows landed on consecutive derives.** Needs R1/R7; see SC-1 residual.
5. **SyncBadge.** Measure at the same viewport; fix only if the same defect.
6. **Trailing flat days.** Routed to the founder as a separate decision, not this phase.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node 22 | vitest, tsx | yes | v22.22.1 at `/opt/homebrew/opt/node@22/bin` (default shell Node is v25.8.1; some `compute.conventions` snapshots fail there, per Phase 211) | prefix `PATH=/opt/homebrew/opt/node@22/bin:$PATH` |
| `node_modules` in this worktree | vitest, tsx, Playwright | no | — | `npm ci` in the worktree (Wave 0) |
| PostgreSQL 16 binaries (pg-lane) | SQL gates, mutation runner | yes | `/opt/homebrew/opt/postgresql@16/bin` | — |
| Python for pytest/mypy | static gate, SC-1 test | partial | 3.13 and 3.14 present, no analytics venv (CI uses 3.12) | `python3.13 -m venv`, `pip install -r requirements-dev.txt` (a bare `pandas==3.0.3` venv sufficed to run the SC-1 probe) |
| Docker daemon | local-stack lane (seeded e2e) | yes (`docker ps` answers, no containers) | CLI 29.9.2 | CI `e2e-seeded` |
| Playwright Chromium | real-browser chip measurement | yes (cached builds under the Playwright cache) | — | CI `e2e-seeded` |
| Disk | FULL mutation run | marginal | about 13 GiB free (94% used) | `--subset-from` only; CI FULL |

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | PL/pgSQL gates on the pg-lane + mutation runner; vitest; pytest (`analytics-service/`); Playwright (seeded lane) |
| Config file | `scripts/mutation-runner/GRAMMAR.md`, `vitest.config.ts`, `analytics-service/pytest.ini`, `playwright.config.ts` |
| Quick run command | the pg-lane command in "Code Examples" per touched gate; `PATH=/opt/homebrew/opt/node@22/bin:$PATH npx vitest run <file>`; `cd analytics-service && python3 -m pytest tests/<file> -q` |
| Full suite command | `PATH=/opt/homebrew/opt/node@22/bin:$PATH npm test`; `npm run typecheck`; `npm run lint`; CI pytest and `mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py` from `analytics-service/` (needed only if Python source changes; the SC-1 test is a test file) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SC-1 | MT5 series ends on the last ledger day; trailing flat days not emitted; dust days NaN | pytest characterization | `cd analytics-service && python3 -m pytest tests/test_mt5_series_end_is_last_ledger_day.py -q`; neuter: make `gap_fill_daily_returns` extend to today, see RED, restore from a byte backup | Wave 0 (new) |
| SC-2 | no-advance strategy with a done analytics job after stale and age >= 8 is NOT enqueued inside 7 days, IS enqueued after 7 days (never excluded); age 7 or no done job keeps 20 hours; marks-paused unchanged; skip row written with cause tag, count and target; no row on a tick with no cap skip; `candidate_enqueue_failed` count undisturbed; disconnected-key strategy not counted | SQL gate arms (new, in `test_ledger_refresh_fanout.sql`) + twins | pg-lane command; twins: `printf '%s\n' supabase/tests/test_ledger_refresh_fanout.sql > "$TMPDIR/subset-214" && node scripts/mutation-runner/run.mjs --subset-from "$TMPDIR/subset-214"`; RED-at-base: run the gate with the apply list ending at `20261030120000` and see the new arm fail | gate exists; arms Wave 0 |
| SC-3 | closed composite reads `is_stale = FALSE`, `stale_reason NULL`, `is_closed TRUE`, `closed_through = max(window_end) - 1`; one NULL window, series one day short, failed status, no return date, single-key, all read stale; `is_stale` never NULL; ACL and `security_invoker` intact; closed composite not enqueued by the composite arm (optional) | SQL gate arms (new, in `test_ledger_refresh_staleness.sql`, optional one in the composite gate) + twins; static gate | pg-lane command on each gate; `cd analytics-service && python3 -m pytest tests/test_ledger_refresh_gates.py -q` | gate exists; arms Wave 0 |
| SC-5 | label wraps inside the masthead column at 1485px, full sentence, dot aligned; chip anatomy unchanged | vitest structural pin + seeded Playwright measurement | `npx vitest run "src/app/factsheet/[id]/v2/FactsheetView.chip-honesty.test.tsx" "src/app/factsheet/[id]/v2/FactsheetView.recency-line.test.tsx"`; Playwright spec with `anchorMs` ahead (needs the seed env / local stack) | specs exist; e2e spec Wave 0 |
| SC-6 | catalogue-only verify blocks; ACL restated; VAC-04 ack; snapshot current | static + lane | `npm run schema:functions:check`; `node scripts/lint-migration-data-dependence.mjs`; `node scripts/lint-sql-gates.mjs`; migration-reviewer and rls-policy-auditor agents before merge | scripts exist |
| SC-7 | each fix RED when reverted | neuter-restore drills per fix, from byte backups, never `git checkout`/`stash` on uncommitted work | per row above | — |
| SC-8 | both routes send the id | vitest | `PATH=/opt/homebrew/opt/node@22/bin:$PATH npx vitest run src/app/api/strategies/finalize-wizard/route.test.ts src/__tests__/csv-validate-route.test.ts src/lib/ledger-refresh-marker.test.ts`; neuter: delete `correlation_id` from either payload, see the new exact-object test RED | tests exist; new cases Wave 0 |
| SC-8 (SQL) | wizard and csv payload shapes retract an inherited marker | SQL gate arms (new, in `test_enqueue_dedup_record_retract.sql`) + source-keyed twins | pg-lane command for that gate; subset mutation run | gate exists; arms Wave 0 |

### Sampling Rate
- **Per task commit:** the task's own command (one gate, one vitest file, or one pytest file).
- **Per wave merge:** all touched gates on the lane plus the subset mutation run for those files, `pytest tests/test_ledger_refresh_gates.py`, and the census vitest files (`mutation-runner-floors`, `gate-family-meta`, `mutation-annotation-parser`, `drift-check-scripts`, `ci-anti-skip-gate.contract`, `lint-sql-gates`).
- **Phase gate:** full `npm test` (Node 22), typecheck, lint, `schema:functions:check`; CI FULL mutation run on the PR head SHA.

### Wave 0 Gaps
- [ ] `npm ci` in the worktree (no `node_modules`).
- [ ] `analytics-service/tests/test_mt5_series_end_is_last_ledger_day.py` — covers SC-1.
- [ ] New arms in the three gate files, with `RED-UNDER` prose and `RED-UNDER-M` twins, and the `RED-UNDER-SETUP` appends.
- [ ] A seeded e2e spec for the chip (and a RED reproduction at 1485px before the class change).
- [ ] The census moves listed under "Gate and census impacts".
- [ ] `214-DIAGNOSIS.md` recording SC-1 (counts and ages only).

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | — |
| V3 Session Management | no | — |
| V4 Access Control | yes | view `security_invoker = true`, grants `service_role` only; fan-out EXECUTE owner-only (apply-time check 11 of the live migration); `cron_runs` RLS (admin read, service_role) |
| V5 Input Validation | yes | `getCorrelationId` allowlist `^[A-Za-z0-9._:-]{1,128}$`; the id travels only as JSON metadata, bounded by the 8192-byte `compute_jobs_metadata_size_bounded` |
| V6 Cryptography | no | — |
| V7 Logging | yes | strategy ids only in `cron_runs.metadata` (admin/service_role readable), never in RAISE text or tracked files; the public repo carries no PROD ids |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Unpinned `search_path` on a cross-tenant SECURITY DEFINER | Elevation | `SET search_path = public, pg_catalog`, asserted at apply |
| View replaced without `security_invoker` | Information disclosure | restate `WITH (security_invoker = true)`, assert `reloptions` |
| Heartbeat write breaking FORCE RLS later | Denial | the live body documents it; the new write is best-effort (WARNING only) |
| Log/header injection via a forwarded correlation id | Tampering | shape allowlist in `getCorrelationId` |
| Skip row mistaken for a failure row | Repudiation/ops confusion | distinct `status`/`error`/`cause`; reader audit above |

## Sources

### Primary (HIGH confidence — read in this session)
- `supabase/migrations/20261030120000_ledger_fanout_marks_paused_weekly.sql`, `20260825120000_ledger_refresh_staleness_view.sql`, `20260825140000_ledger_refresh_composite_arm.sql`, `20261114130000_enqueue_dedup_record_retract.sql`, `20260408113029_cron_heartbeat.sql`
- `supabase/tests/test_ledger_refresh_fanout.sql`, `test_ledger_refresh_staleness.sql`, `test_enqueue_dedup_record_retract.sql`; `scripts/mutation-runner/GRAMMAR.md`; `scripts/mutation-floors.mjs`; `scripts/prod-prober/arms/cron-obs.mjs`, `cron-manifest.json`
- `analytics-service/tests/test_ledger_refresh_gates.py`; `analytics-service/services/{broker_dailies,nav_twr,nav_marks,account_unit,job_worker}.py`; probe run of `combine_mt5_deal_ledger` (cases A-E above)
- `src/app/api/strategies/{finalize-wizard,csv-finalize}/route.ts`, `src/lib/{correlation-id,ledger-refresh-marker}.ts`, `src/app/factsheet/[id]/v2/FactsheetView.tsx`, `FactsheetView.chip-honesty.test.tsx`, `src/components/strategy/SyncBadge.tsx`, `DESIGN.md`, `e2e/helpers/{seed-test-project,geometry}.ts`
- Precedents: `.planning/milestones/v1.20-phases/174-*/174-01-SUMMARY.md`, `.planning/phases/211-*/211-03-SUMMARY.md`, `211-06-SUMMARY.md`, `211-07-SUMMARY.md`
### Secondary (MEDIUM — official docs)
- https://www.postgresql.org/docs/16/sql-createview.html (CREATE OR REPLACE VIEW column and option rules)
### Tertiary (LOW)
- none; all `[ASSUMED]` items are in the Assumptions Log.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — existing toolchain, nothing installed.
- Architecture (SC-2, SC-3, SC-8): HIGH — every needle, reader and pin read from source; twins and windows follow the Phase 174 precedent.
- SC-1 mechanism: MEDIUM — code-proven and probe-reproduced shape, root cause between H1 and H2 needs PROD reads.
- SC-5 fix shape: MEDIUM — the overflow was not reproducible from markup alone; re-measure first.
- Pitfalls: HIGH.

**Research date:** 2026-11-14
**Valid until:** 2026-11-21 (the migration stamp, origin/main head and the gate census numbers move quickly with parallel phases)

## Addendum 2026-11-14 — SC-1 PROD confirmation (orchestrator, read-only MCP, marker query first)

- R4: the strategy's key reports `account_currency = USD` and a stored account balance far above the $100 dust floor; `is_active` true.
- R5: zero `api_key_nav_marks` rows for that key (H3, marks-driven extension, excluded).
- R1/R2/R3 were read before research (see CONTEXT `<specifics>`): daily rows end 2026-10-09; flags as listed; three consecutive daily fan-out chains finished `done` / `publish_warned`.
- **Verdict under the decision rule above: H1.** The account's ledger has had no deal or balance-operation day since 2026-10-09, and the derive emits days only over `[first, last]` ledger day, so the series cannot advance while the account is idle. No money-math defect. The design property (trailing flat days of a ledger-complete account are never emitted) is recorded and routed, not fixed here. Open question 4 (one zero row per derive) stays unexplained without the Railway worker log (R7) and does not affect SC-2's design.
- Decisions taken on the research's open questions (orchestrator, reversible): (1) skip counting covers the new no-advance cap only, with its reason; (2) yes, one composite-gate arm proving a closed composite is not enqueued; (3) yes, `is_closed` additionally requires `max(window_end) <= CURRENT_DATE` (stricter, fails toward stale); (5) SyncBadge measured at the same viewport, fixed only if the same defect shows; (6) extending ledger-complete series is out of scope.
