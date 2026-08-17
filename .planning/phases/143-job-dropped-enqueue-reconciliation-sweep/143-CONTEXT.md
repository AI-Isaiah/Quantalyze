# Phase 143: JOB — Dropped-enqueue reconciliation sweep - Context

**Gathered:** 2026-08-16
**Status:** Ready for planning
**Mode:** Smart discuss (autonomous)

<domain>
## Phase Boundary

A pg_cron sweep detects, **by absence**, the one enqueue-drop shape that no in-request guard
can catch — `after()` never ran at all, so neither the `enqueue_compute_job` error branch nor
`writeFailedStrategyAnalyticsPlaceholder` ever executed — and heals it by re-enqueueing.

The hole, concretely (`src/app/api/strategies/csv-finalize/route.ts`): `finalize_csv_strategy`
and `persist_csv_daily_returns` run **synchronously in the request** and commit; the
`compute_analytics_from_csv` enqueue is scheduled via `after()` at `route.ts:813`. If the
serverless instance is torn down before that callback runs, the strategy is left with persisted
daily-returns rows, **zero** `compute_jobs` rows, and **no** `strategy_analytics` row at all.
Every guard in that file lives *inside* the closure that never ran, so the condition is
architecturally invisible from the route.

IN SCOPE: one detection predicate (dailies present + zero jobs + no terminal analytics + grace
elapsed), one bounded re-enqueue, one alert path, one migration, CI-visible SQL gates.

OUT OF SCOPE: terminalizing stranded `computing` rows (Phase 142's reaper owns that — see the
non-racing split below); orphaned `running` `compute_jobs` rows (Phase 144); csv-finalize
atomicity (Phase 145); the wizard first-hop drop (see Detection Predicate Q4).

</domain>

<decisions>
## Implementation Decisions

### Detection Predicate — "what counts as orphaned"

- **Dailies anchor = `public.csv_daily_returns`, one table, no source filter.** Despite the
  name, this is the *single canonical* daily-returns store: `derive_broker_dailies` upserts
  into it for API-source strategies too (`analytics-service/services/job_worker.py:4720,4742`),
  which is what the v1.10 backbone unification delivered. There is no second dailies table —
  `strategy_analytics_series` holds derived heavy series, not the canonical dailies. So the
  predicate is **source-agnostic** (`csv`, `okx`, `binance`, `bybit`, `deribit`, `sfox`, mt5
  all behave identically) and needs no join to `strategies.source`.

- **"No `compute_jobs` row" means ANY kind AND ANY status — not `kind = 'compute_analytics_from_csv'`.**
  This is load-bearing, not pedantry. Scoping the NOT EXISTS to the analytics kind would match a
  strategy legitimately mid-chain: `derive_broker_dailies` upserts dailies and *then* enqueues
  the follow-on before returning DONE, so there is a real window with dailies present, a
  `running` parent job, and no `compute_analytics_from_csv` row yet. Kind-scoping would
  re-enqueue that healthy in-flight chain. Matches SC#1 verbatim ("NO `compute_jobs` row of ANY
  status").

- **⚠️ The terminal-`strategy_analytics` conjunct is the ONLY thing protecting healthy old
  strategies, because `retention_compute_jobs_done` DELETEs `done` rows at 30 days**
  (`supabase/migrations/20260417110539_retention_crons.sql:88`; `retention_compute_jobs_failed`
  at 90 days). Every healthy 31-day-old strategy therefore matches "dailies present + zero
  `compute_jobs` rows". Without the analytics conjunct this sweep would re-enqueue the entire
  historical corpus on its first run. Any future edit that weakens or reorders that conjunct
  re-opens a mass-re-enqueue incident — say so in the migration header and pin it with a test.

- **Non-racing split with Phase 142's reaper (`20260802120000`), by `computation_status`:**

  | `strategy_analytics` state | Owner | Action |
  |---|---|---|
  | row ABSENT | **143 (this phase)** | re-enqueue |
  | `pending` | **143 (this phase)** | re-enqueue |
  | `computing` | **142's reaper** | terminalize after 16h — 143 must NOT touch |
  | `complete` / `complete_with_warnings` / `failed` | nobody | terminal, skip |

  Full vocabulary is exactly these five values
  (`20260602120000_..._add_complete_with_warnings.sql:46`). Excluding `computing` is what keeps
  the two mechanisms from racing the same row, which 142's header explicitly asked for ("The
  reaper TERMINALIZES ONLY — it never re-enqueues. Re-enqueue is JOB-04, Phase 143. Keeping it
  out avoids two mechanisms racing the same row.").

- **Wizard first-hop drop is OUT OF SCOPE, documented as known non-coverage.** A
  `finalize-wizard` strategy whose `sync_trades` enqueue dropped has *no dailies at all*, and
  "no dailies AND no jobs" is byte-identical to a brand-new strategy that has not synced yet
  and to a key whose first sync legitimately returned nothing. No predicate catches the drop
  without also catching those. Closing it needs a distinct signal (`api_key_id` present + no
  job EVER + a longer grace) with its own false-positive profile — a separate mechanism, not a
  second predicate bolted into this migration. Record the non-coverage in the migration header,
  in the phase SUMMARY, and as a TODOS.md item. Do **not** let the phase's success-criteria
  prose imply it is covered.

### Grace Window, Cadence and Bounding

- **Grace window = 1 hour, derived (not guessed).** The legitimate gap this must clear is
  route-commit → `after()` enqueue-commit, which is sub-second in the happy path and bounded by
  the request lifetime. It is explicitly **not** the 16h chain-inclusive figure from 142: that
  bounds how long a row may legitimately sit `computing` *with a chain in flight*, whereas this
  predicate already requires **zero** job rows, so no chain can be in flight by construction.
  1 hour is ~3 orders of magnitude over the legitimate gap and absorbs worker-host/Postgres
  clock skew, which is NTP-bounded at seconds. State this derivation in the migration header
  the way 142 did — a bare number with no derivation is what Phase 106's janitor got reverted for.

- **Cadence hourly (`0 * * * *`).** Post-threshold detection latency, so worst case end-to-end
  is ~grace + 1h. Say that plainly in the header; do **not** describe the cadence as bounding
  user-visible spinner time (142's "CADENCE HONESTY" note is the standard to match). The live
  wizard poller self-escalates at 15 min (`SyncPreviewStep.tsx` `RETRY_THRESHOLD_MS = 900_000`),
  so this sweep's value is the page-refresh / return-later path and the factsheet surface, not
  a live-wizard rescue.

- **Bounded per run via a materialized-CTE `LIMIT`**, following
  `20260803130000_reaper_limit_bound_materialized_cte.sql` — the same planner-blindness fix
  already applied to 142's reaper. Do not re-derive; reuse that file's shape.

- **Re-enqueued kind = `compute_analytics_from_csv`**, correct for every source because the
  handler reads `csv_daily_returns`, which the predicate already proved is populated —
  **except composites, which must be EXCLUDED.** (Added 2026-08-16 from `143-RESEARCH.md`; this
  is a live false-positive population, not a hypothetical.) `run_stitch_composite_job` writes
  `csv_daily_returns` (`job_worker.py:6786-6803`) but `JOB_CHAIN_FOLLOW_ON["stitch_composite"]`
  is `()` (`job_worker.py:527`), so a composite legitimately NEVER gets a
  `compute_analytics_from_csv` job. Enqueuing one would overwrite the composite headline with
  the single-key computation its own handler deliberately abandoned — the √252-vs-√365
  annualization split plus a 0.0 gap-fill that "fabricated flat performance"
  (`job_worker.py:6808-6822`). That is silent money-math corruption of a correct row, strictly
  worse than the un-healed hole this phase exists to close. Exclude composites in the predicate
  and record the non-coverage in the migration header and the SUMMARY.

- **Idempotency (SC#2) rides the EXISTING partial unique index** —
  `compute_jobs_one_inflight_per_kind_strategy` on `(strategy_id, kind) WHERE strategy_id IS NOT
  NULL AND kind <> 'compute_intro_snapshot' AND status IN ('pending','running','done_pending_children')`,
  current definition in `20260416125430_contact_request_metadata.sql:156`. **Re-base on that
  definition, not on the original `20260411144407:179`** — the original was DROPped and
  replaced. No new index. Running the sweep twice must be a provable no-op.

### Alerting and Observability

- **Sentry fires worker-side on claim, not from cron.** The sweep stamps
  `metadata = {source: 'reconcile-sweep', detected_at: <ts>}`; the Python worker emits a Sentry
  event when it claims a job carrying that marker. Real Sentry event, no new infra, no DSN
  secret in a world-readable migration. It makes SC#1 true as written.

- **⛔ CORRECTION (2026-08-16, from `143-RESEARCH.md` — supersedes this decision's original
  premise): the worker has NO Sentry wiring to hook into.** This decision was accepted on the
  stated premise that `analytics-service` already had live Sentry the alert could reuse. Research
  falsified that: `analytics-service/main_worker.py` is a standalone process whose `main()`
  contains zero Sentry references, and `services/job_worker.py` mentions Sentry only in two
  comments. **`sentry_sdk.capture_*` without a prior `init_sentry()` is a silent no-op** — which
  would make this alert path fail exactly the way the rejected `pg_net` bridge would have, and
  for the same reason it was rejected. The decision STANDS (it is still the cheapest correct
  option), but it now carries a mandatory prerequisite task:
  - **Wire `init_sentry()` into `main_worker.py::main()`** before any capture call is added, and
  - **verify `SENTRY_DSN` is actually set on the worker's Railway service** (UNVERIFIED at
    research time — a DSN present on the web app does not imply one on the worker).
  - The test that the capture fires is NOT sufficient: it mocks the SDK, so it stays green with
    `init_sentry()` removed. A separate assertion that `main()` calls `init_sentry()` is
    load-bearing, not decorative.

- **✅ RESOLVED 2026-08-17 (Phase 143-04, measured against live Railway) — and the CORRECTION
  above was itself too pessimistic about PRODUCTION.** Both halves now have evidence:
  - **There is no standalone worker service.** The `quantalyze-analytics` Railway project has ONE
    service, and the worker loops were MERGED into the FastAPI process — `main.py:80-86` records
    why ("Previously `main_worker.py` ran these as a separate Railway service; merging them
    eliminates the *forgot to deploy the worker* failure mode (incident 2026-04-20 → 2026-04-22,
    jobs queued but never processed)"). `dispatch_loop` runs as an asyncio task in the app
    lifespan (`main.py:271`).
  - **That process HAS had Sentry since Phase 16** — `main.py:69` calls `init_sentry()` at import,
    before `app = FastAPI()`.
  - **`SENTRY_DSN` IS set on that service** (verified via Railway CLI; value never read or copied
    — presence and length only). `MT5_ENABLED=true` and `MT5_GATEWAY_HOST` sit on the same
    service, independently confirming it is the worker.
  - ⇒ **SC#1's "a Sentry alert fires" is TRUE in production.** `dispatch_tick` — where 143-01 put
    the reconcile-sweep capture — runs inside an already-Sentry-initialized process.
  - **143-01's `init_sentry()` in `main_worker.main()` remains correct and is NOT dead code**, but
    be precise about what it covers: it closes the **standalone** invocation path
    (`python -m main_worker`, `npm run worker:dev`, and any future re-split), which genuinely had
    zero Sentry. It is not the production path. Do not let a future reader infer from it that
    production was previously unalerted — it was not.
  - Honest limitation to document: alert latency is sweep → next worker claim, and a fully-down
    worker means no alert. A down worker is independently alarmed, so this adds no new blind
    spot — but write that down rather than letting the reader assume instant paging.
  - ⛔ Rejected: a `pg_net` → Sentry-store bridge from inside the cron body. `pg_net` is
    fire-and-forget, so a failed POST is itself silent — an alerting channel that fails silently
    is precisely the defect class this milestone already closed twice.
  - ⛔ Rejected: claiming an alert that does not exist. 142's header is explicit that there is
    no cron→Sentry bridge in this repo; inventing the claim in prose is the failure being
    avoided.

- **pg_cron run log is the secondary surface.** `RAISE NOTICE` the healed count so
  `cron.job_run_details.return_message` carries it; include the inspection query in the header
  verbatim in 142's style (`SELECT d.start_time, d.status, d.return_message ... WHERE
  j.jobname = ...`). Per project convention every `RAISE` format string is a single literal.

- **No new callable SQL surface.** The sweep is an **INLINE cron body**, not a
  `SECURITY DEFINER` function — no EXECUTE grant, no caller-suppliable interval. 142's header
  names the reason: a caller-supplied `INTERVAL` on a cross-tenant SECDEF reaper is the
  `20260516170100` incident class ("The parameter IS the attack surface"). Same rule here.

- **CI-visible gates only.** The SQL gate MUST be `supabase/tests/test_*.sql` — `*_live.py` and
  `skipIf` vitest never run in CI. Pair it with a TS migration-content test in the style of
  `src/__tests__/compute-jobs-kind-check-csv-2026-05-25.test.ts`, and a pytest for the
  worker-side Sentry emission. Every test must be shown to fail when its target is neutered
  (standing founder rule) — in particular the false-positive guards: an in-grace strategy, a
  strategy with any job row, and a strategy with a terminal analytics row must each be proven
  untouched (SC#3).

### Claude's Discretion

- Exact migration filename/timestamp, cron job name, `LIMIT` value, and the precise SQL shape of
  the predicate.
- Whether the worker-side Sentry emission lives in the claim path or at handler entry.
- Test file names and how the neutering proof is recorded.
- Whether a pre-merge census (in 142's style) is run against TEST and PROD; strongly encouraged
  — the expected count on both is the number this sweep would re-enqueue on its first run, and
  that number should be looked at before merge, not after.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `supabase/migrations/20260802120000_strategy_analytics_stuck_computing_reaper.sql` — the
  closest analog by far. Reuse its structure wholesale: header discipline (why-it-exists,
  threshold derivation, cadence honesty, clock skew, scope discipline, operator observability,
  prod-auto-apply warning), the `cron.unschedule`-then-`cron.schedule` re-apply pattern, and
  the `BEGIN`/`COMMIT` + session `lock_timeout = '5s'` convention.
- `supabase/migrations/20260803130000_reaper_limit_bound_materialized_cte.sql` — the
  materialized-CTE `LIMIT` shape.
- `supabase/migrations/20260719120000_retention_orphaned_running_compute_jobs.sql` and
  `20260720120000_..._window_4h.sql` — pg_cron janitor analogs. ⚠️ Phase 144 owns these; 143
  must not touch them.
- `compute_jobs_one_inflight_per_kind_strategy` (current def:
  `20260416125430_contact_request_metadata.sql:156`) — the idempotency mechanism, already built.
- `analytics-service/services/job_worker.py` — `STRATEGY_ANALYTICS_REAP_THRESHOLD`,
  `JOB_CHAIN_FOLLOW_ON`, and the existing Sentry wiring the worker-side alert hooks into.
- `captureToSentry` usage in `src/app/api/strategies/csv-finalize/route.ts:~836` — the tag/extra
  shape (`tags: {surface, step}`, `extra: {strategy_id, correlation_id}`) to mirror.

### Established Patterns
- Migration headers are long, adversarial, and carry the derivation of every magic number,
  plus explicit "convention deviation" pre-documentation so review does not re-litigate.
- Self-verifying `DO $$` block at the end of a migration asserting the objects it created.
- Load-bearing constants over decorative drift gates: production reads the constant, so a wrong
  value changes real behavior (the 142-01 `JOB_CHAIN_FOLLOW_ON` lesson).
- Oracle independence: tests declare literals locally naming their production `file:line`
  rather than importing the value under test.

### Integration Points
- `pg_cron` schedule (new job; must not collide with existing job names).
- `public.csv_daily_returns`, `public.compute_jobs`, `public.strategy_analytics` — the same
  three-table triangle Phase 142 worked in.
- The Python worker claim path, for the Sentry emission.
- ⚠️ **Merging `supabase/migrations/**` to `main` AUTO-APPLIES to PROD** — apply to TEST
  (`qmnijlgmdhviwzwfyzlc`) and run the SQL gate before merge.

</code_context>

<specifics>
## Specific Ideas

- SC#1's "and a Sentry alert fires" is satisfied by the worker-side-on-claim mechanism above.
  If planning finds that mechanism unworkable, SC#1 must be **amended in ROADMAP.md, STATE.md
  and REQUIREMENTS.md together** — a scope amendment touching one file is incomplete (standing
  founder rule).
- Phase 106's janitor was REVERTED for keying on the wrong timestamp column. Whatever column
  this sweep keys its grace window on must be argued for in the header the way 142 argued
  `computing_started_at` over `computed_at` — including why the alternatives are wrong.
- The migration-reviewer agent (`.claude/agents/migration-reviewer.md`) should be run on the
  migration before the PR; note that its invariant #14 (no `BEGIN`/`COMMIT`) is known-stale
  against this repo's convention and 142 pre-documented that deviation.

</specifics>

<deferred>
## Deferred Ideas

- **Composite strategies stranded without analytics.** Excluded from this sweep because the
  healing action (`compute_analytics_from_csv`) is actively wrong for them; a composite needs
  `stitch_composite` re-run, which is a different mechanism with a different predicate. → TODOS.md.
- **Wizard/API first-hop enqueue drop** (`finalize-wizard` → `sync_trades` never enqueued;
  strategy has no dailies and no jobs). Needs its own signal and its own false-positive
  analysis. → TODOS.md.
- A general cron→Sentry bridge usable by 142's reaper, this sweep, and 144's cadence job.
  Rejected here on blast radius; revisit if a third cron needs alerting.
- Retiring or shortening `retention_compute_jobs_done`'s 30-day window so job history is a
  usable forensic signal. Out of scope; noted because this phase's safety currently leans on
  the analytics conjunct precisely because that retention exists.

</deferred>
