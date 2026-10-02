# Phase 143: JOB — Dropped-enqueue reconciliation sweep - Research

**Researched:** 2026-08-16
**Domain:** Postgres / pg_cron reconciliation sweep + Python worker alerting (Supabase + Railway)
**Confidence:** HIGH on all in-repo facts (every claim below carries a verified `file:line`). LOW / UNVERIFIED on the live-DB census only — see `## Environment Availability`.

## Summary

The phase is almost entirely an in-repo archaeology problem, not a library-selection problem. There is a
near-exact template (Phase 142's reaper migration + its LIMIT-bound follow-up), a CI-visible SQL gate
harness that already executes deployed cron bodies, and an existing partial unique index that delivers
SC#2 for free. This research verified every object CONTEXT.md names, and found **five corrections and
three previously-unsurfaced landmines** that materially change the plan.

The three findings that most change the plan:

1. **The worker process has NO Sentry.** `analytics-service/main_worker.py` is a standalone process
   (`python -m main_worker`) and never calls `init_sentry()` — it contains zero references to Sentry
   anywhere. A `sentry_sdk.capture_*` call added to the claim path today would be a **silent no-op**,
   which is precisely the "alerting channel that fails silently" defect class CONTEXT.md rejected
   `pg_net` for. Wiring `init_sentry()` into `main_worker.main()` is a **required task**, not an
   assumption.
2. **`compute_jobs` carries `FORCE ROW LEVEL SECURITY` with a deny-all policy.** The table-owner bypass
   is deliberately closed. The empirical precedent that a pg_cron body can still write it is
   `retention_compute_jobs_orphaned_running`, which `DELETE`s from `public.compute_jobs` on a schedule
   — but *that is inference from a sibling cron, not a measurement*. It must be measured on TEST before
   the sweep is trusted.
3. **Composite strategies write `csv_daily_returns` and are chain-terminal.** `run_stitch_composite_job`
   upserts the stitched series into `csv_daily_returns` and `JOB_CHAIN_FOLLOW_ON["stitch_composite"]`
   is the empty tuple — a composite *never* gets a `compute_analytics_from_csv` job. CONTEXT.md's
   "re-enqueued kind = `compute_analytics_from_csv`, correct for every source" does **not** hold for
   composites. This is a live false-positive population the predicate must address explicitly.

**Primary recommendation:** Build the sweep as a direct `INSERT ... ON CONFLICT DO NOTHING` into
`public.compute_jobs` inside an inline pg_cron body shaped on `20260803130000`'s MATERIALIZED-CTE
skeleton — **not** a call to `enqueue_compute_job`, whose race-loss arm `RAISE`s `serialization_failure`
and would abort the whole cron tick. Add a mandatory Wave-0 task wiring `init_sentry()` into
`main_worker.main()` before any Sentry-emission task, and resolve the composite question before the
predicate is written.

## Project Constraints (from CLAUDE.md / AGENTS.md)

| Directive | Source | Bearing on this phase |
|---|---|---|
| Rule 6 — root-cause obsession, no bandaids | `~/.claude/CLAUDE.md` | The Sentry-not-initialized finding must be *fixed*, not routed around with a log line. |
| Rule 7 — surface conflicts, don't average them | `~/.claude/CLAUDE.md` | migration-reviewer invariant #14 (no `BEGIN`/`COMMIT`) conflicts with repo convention; 142 picked repo convention and pre-documented it. Do the same, do not blend. |
| Rule 11 — conformance over taste inside the codebase | `~/.claude/CLAUDE.md` | Migration header style, `BEGIN`/`COMMIT` + `SET lock_timeout`, self-verifying `DO` blocks, single-literal `RAISE` format strings. |
| Rule 12 — fail loud | `~/.claude/CLAUDE.md` | pg_cron-absent must `RAISE EXCEPTION`, never a silent skip (matches `20260802120000:441-445`). |
| Rule 9 — tests verify intent, not behavior | `~/.claude/CLAUDE.md` | Every gate must be shown to fail when neutered; see `## Validation Architecture`. |
| Coverage gate is blocking CI | `CLAUDE.md` (Test Coverage) | A new TS test file must not drop lines/statements/functions/branches below 82/80/74/72. Adding a pure text-assertion test raises, never lowers, these. |
| `node_modules/next/dist/docs/` is authoritative for Next.js | `AGENTS.md` | Not load-bearing here — this phase writes no Next.js code. Read only if a task ends up touching `csv-finalize/route.ts` (it should not; that is Phase 145). |
| No emojis in assistant output | user CLAUDE.md | Applies to prose, not to migration files (which use `⚠️`/`⛔` heavily by convention — see `20260803130000:64,70`). |

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Detection Predicate — "what counts as orphaned"**

- **Dailies anchor = `public.csv_daily_returns`, one table, no source filter.** Despite the name, this is
  the *single canonical* daily-returns store: `derive_broker_dailies` upserts into it for API-source
  strategies too (`analytics-service/services/job_worker.py:4720,4742`), which is what the v1.10 backbone
  unification delivered. There is no second dailies table — `strategy_analytics_series` holds derived heavy
  series, not the canonical dailies. So the predicate is **source-agnostic** (`csv`, `okx`, `binance`,
  `bybit`, `deribit`, `sfox`, mt5 all behave identically) and needs no join to `strategies.source`.

- **"No `compute_jobs` row" means ANY kind AND ANY status — not `kind = 'compute_analytics_from_csv'`.**
  This is load-bearing, not pedantry. Scoping the NOT EXISTS to the analytics kind would match a strategy
  legitimately mid-chain: `derive_broker_dailies` upserts dailies and *then* enqueues the follow-on before
  returning DONE, so there is a real window with dailies present, a `running` parent job, and no
  `compute_analytics_from_csv` row yet. Kind-scoping would re-enqueue that healthy in-flight chain. Matches
  SC#1 verbatim ("NO `compute_jobs` row of ANY status").

- **⚠️ The terminal-`strategy_analytics` conjunct is the ONLY thing protecting healthy old strategies,
  because `retention_compute_jobs_done` DELETEs `done` rows at 30 days**
  (`supabase/migrations/20260417110539_retention_crons.sql:88`; `retention_compute_jobs_failed` at 90 days).
  Every healthy 31-day-old strategy therefore matches "dailies present + zero `compute_jobs` rows". Without
  the analytics conjunct this sweep would re-enqueue the entire historical corpus on its first run. Any
  future edit that weakens or reorders that conjunct re-opens a mass-re-enqueue incident — say so in the
  migration header and pin it with a test.

- **Non-racing split with Phase 142's reaper (`20260802120000`), by `computation_status`:**

  | `strategy_analytics` state | Owner | Action |
  |---|---|---|
  | row ABSENT | **143 (this phase)** | re-enqueue |
  | `pending` | **143 (this phase)** | re-enqueue |
  | `computing` | **142's reaper** | terminalize after 16h — 143 must NOT touch |
  | `complete` / `complete_with_warnings` / `failed` | nobody | terminal, skip |

  Full vocabulary is exactly these five values (`20260602120000_..._add_complete_with_warnings.sql:46`).
  Excluding `computing` is what keeps the two mechanisms from racing the same row, which 142's header
  explicitly asked for ("The reaper TERMINALIZES ONLY — it never re-enqueues. Re-enqueue is JOB-04,
  Phase 143. Keeping it out avoids two mechanisms racing the same row.").

- **Wizard first-hop drop is OUT OF SCOPE, documented as known non-coverage.** A `finalize-wizard`
  strategy whose `sync_trades` enqueue dropped has *no dailies at all*, and "no dailies AND no jobs" is
  byte-identical to a brand-new strategy that has not synced yet and to a key whose first sync legitimately
  returned nothing. No predicate catches the drop without also catching those. Closing it needs a distinct
  signal (`api_key_id` present + no job EVER + a longer grace) with its own false-positive profile — a
  separate mechanism, not a second predicate bolted into this migration. Record the non-coverage in the
  migration header, in the phase SUMMARY, and as a TODOS.md item. Do **not** let the phase's
  success-criteria prose imply it is covered.

**Grace Window, Cadence and Bounding**

- **Grace window = 1 hour, derived (not guessed).** The legitimate gap this must clear is route-commit →
  `after()` enqueue-commit, which is sub-second in the happy path and bounded by the request lifetime. It is
  explicitly **not** the 16h chain-inclusive figure from 142: that bounds how long a row may legitimately sit
  `computing` *with a chain in flight*, whereas this predicate already requires **zero** job rows, so no chain
  can be in flight by construction. 1 hour is ~3 orders of magnitude over the legitimate gap and absorbs
  worker-host/Postgres clock skew, which is NTP-bounded at seconds. State this derivation in the migration
  header the way 142 did — a bare number with no derivation is what Phase 106's janitor got reverted for.

- **Cadence hourly (`0 * * * *`).** Post-threshold detection latency, so worst case end-to-end is
  ~grace + 1h. Say that plainly in the header; do **not** describe the cadence as bounding user-visible
  spinner time (142's "CADENCE HONESTY" note is the standard to match). The live wizard poller self-escalates
  at 15 min (`SyncPreviewStep.tsx` `RETRY_THRESHOLD_MS = 900_000`), so this sweep's value is the
  page-refresh / return-later path and the factsheet surface, not a live-wizard rescue.

- **Bounded per run via a materialized-CTE `LIMIT`**, following
  `20260803130000_reaper_limit_bound_materialized_cte.sql` — the same planner-blindness fix already applied
  to 142's reaper. Do not re-derive; reuse that file's shape.

- **Re-enqueued kind = `compute_analytics_from_csv`**, correct for every source because the handler reads
  `csv_daily_returns`, which the predicate already proved is populated.

- **Idempotency (SC#2) rides the EXISTING partial unique index** —
  `compute_jobs_one_inflight_per_kind_strategy` on `(strategy_id, kind) WHERE strategy_id IS NOT NULL AND
  kind <> 'compute_intro_snapshot' AND status IN ('pending','running','done_pending_children')`, current
  definition in `20260416125430_contact_request_metadata.sql:156`. **Re-base on that definition, not on the
  original `20260411144407:179`** — the original was DROPped and replaced. No new index. Running the sweep
  twice must be a provable no-op.
- ⛔ **MECHANISM CORRECTED 2026-08-16 by an observed neuter — the heading above is WRONG as written and is kept only so this correction has an anchor.** SC#2 does NOT ride the partial unique index. SEQUENTIAL re-run is a no-op because of the **zero-jobs conjunct**: tick 1's INSERT removes the strategy from the predicate, so tick 2's batch is empty and the INSERT is never reached (confirmed live on TEST 2026-08-17, `143-CENSUS.md` part B §12). CONCURRENT races are handled first by `FOR UPDATE SKIP LOCKED` (an INSERT into `compute_jobs` key-share-locks its parent `strategies` row) and only then by `ON CONFLICT DO NOTHING`; the index is the last arbiter and is reached only when BOTH are removed. ⚠️ Corollary: any gate that "proves" `ON CONFLICT` by running the body twice in one session CANNOT FAIL. The re-base instruction below is still correct and still required.

**Alerting and Observability**

- **Sentry fires worker-side on claim, not from cron.** The sweep stamps
  `metadata = {source: 'reconcile-sweep', detected_at: <ts>}`; the Python worker emits a Sentry event when
  it claims a job carrying that marker. This is a *real* Sentry event through wiring that already exists in
  `analytics-service`, with no new infra and no DSN secret in a world-readable migration. It makes SC#1 true
  as written.
  - Honest limitation to document: alert latency is sweep → next worker claim, and a fully-down worker means
    no alert. A down worker is independently alarmed, so this adds no new blind spot — but write that down
    rather than letting the reader assume instant paging.
  - ⛔ Rejected: a `pg_net` → Sentry-store bridge from inside the cron body. `pg_net` is fire-and-forget, so
    a failed POST is itself silent — an alerting channel that fails silently is precisely the defect class
    this milestone already closed twice.
  - ⛔ Rejected: claiming an alert that does not exist. 142's header is explicit that there is no
    cron→Sentry bridge in this repo; inventing the claim in prose is the failure being avoided.

- **pg_cron run log is the secondary surface.** `RAISE NOTICE` the healed count so
  `cron.job_run_details.return_message` carries it; include the inspection query in the header verbatim in
  142's style (`SELECT d.start_time, d.status, d.return_message ... WHERE j.jobname = ...`). Per project
  convention every `RAISE` format string is a single literal.

- **No new callable SQL surface.** The sweep is an **INLINE cron body**, not a `SECURITY DEFINER` function —
  no EXECUTE grant, no caller-suppliable interval. 142's header names the reason: a caller-supplied
  `INTERVAL` on a cross-tenant SECDEF reaper is the `20260516170100` incident class ("The parameter IS the
  attack surface"). Same rule here.

- **CI-visible gates only.** The SQL gate MUST be `supabase/tests/test_*.sql` — `*_live.py` and `skipIf`
  vitest never run in CI. Pair it with a TS migration-content test in the style of
  `src/__tests__/compute-jobs-kind-check-csv-2026-05-25.test.ts`, and a pytest for the worker-side Sentry
  emission. Every test must be shown to fail when its target is neutered (standing founder rule) — in
  particular the false-positive guards: an in-grace strategy, a strategy with any job row, and a strategy
  with a terminal analytics row must each be proven untouched (SC#3).

### Claude's Discretion

- Exact migration filename/timestamp, cron job name, `LIMIT` value, and the precise SQL shape of the predicate.
- Whether the worker-side Sentry emission lives in the claim path or at handler entry.
- Test file names and how the neutering proof is recorded.
- Whether a pre-merge census (in 142's style) is run against TEST and PROD; strongly encouraged — the expected
  count on both is the number this sweep would re-enqueue on its first run, and that number should be looked
  at before merge, not after.

### Deferred Ideas (OUT OF SCOPE)

- **Wizard/API first-hop enqueue drop** (`finalize-wizard` → `sync_trades` never enqueued; strategy has no
  dailies and no jobs). Needs its own signal and its own false-positive analysis. → TODOS.md.
- A general cron→Sentry bridge usable by 142's reaper, this sweep, and 144's cadence job. Rejected here on
  blast radius; revisit if a third cron needs alerting.
- Retiring or shortening `retention_compute_jobs_done`'s 30-day window so job history is a usable forensic
  signal. Out of scope; noted because this phase's safety currently leans on the analytics conjunct precisely
  because that retention exists.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| JOB-04 | "A reconciliation sweep detects strategies with persisted daily-returns data but NO `compute_jobs` row of any status and no terminal `strategy_analytics` row past a grace window — the '`after()` never ran at all' hole that the in-closure placeholder guard structurally cannot catch — and idempotently re-enqueues + alerts Sentry." (`.planning/REQUIREMENTS.md:54`) | Detection: `## Verified Object Inventory` §1–§5 pins every table/column/CHECK the predicate reads. Idempotency: ⛔ CORRECTED 2026-08-16 — §2's partial unique index is NOT the operative mechanism; the zero-jobs conjunct makes a sequential re-run a no-op and `FOR UPDATE SKIP LOCKED` handles the concurrent race. The index is the last arbiter only. Alerting: `## Landmine L-1` establishes the Sentry gap and the exact fix. Template: `## Architecture Patterns` §Pattern 1 gives the reusable migration skeleton. |

`.planning/REQUIREMENTS.md:1405` maps JOB-04 → Phase 143, status `Pending`.
`.planning/REQUIREMENTS.md:58` (JOB-07, mapped to Phase 142) is the constraint: no reaper/sweep on the
worker's shared asyncio event loop — pg_cron only.
</phase_requirements>

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Orphan detection (dailies ∧ ¬jobs ∧ ¬terminal-analytics ∧ grace) | Database (pg_cron inline body) | — | JOB-07 forbids the worker loop; the predicate is a 3-table join that belongs where the data is. Also: detection-by-absence is architecturally impossible from the route handler (the whole point of the phase). |
| Idempotent re-enqueue | Database (zero-jobs conjunct; then `FOR UPDATE SKIP LOCKED`; then `ON CONFLICT DO NOTHING`) | — | ⛔ CORRECTED 2026-08-16 by observed neuter: SC#2 is NOT a property of the partial unique index. Sequential re-run is a no-op via the zero-jobs conjunct; the index is reached only when SKIP LOCKED *and* ON CONFLICT are both removed. |
| Blast-radius bound (`LIMIT`) | Database (MATERIALIZED CTE) | — | The D-19 lesson: the bound only exists if the batch CTE is fenced (`20260803130000:111`). |
| Alerting on a healed orphan | Python worker (`main_worker.dispatch_tick`) | pg_cron run log (`cron.job_run_details.return_message`) | No cron→Sentry bridge exists (`20260802120000:153-155`); the worker already has the claimed row's `metadata` (`main_worker.py:87`). |
| Sentry transport initialization | Python worker process bootstrap (`main_worker.main()`) | — | **Currently missing entirely** — see Landmine L-1. |
| CI enforcement | GitHub Actions `sql-tests` job + vitest + pytest | — | `ci.yml:833` is the only job that EXECUTEs a deployed cron body. |

---

## Verified Object Inventory

Every claim in this section was read from the source-of-truth file **this session**, with the value quoted
verbatim beside the citation.

### §1 — `compute_jobs_one_inflight_per_kind_strategy` (the SC#2 mechanism)

Grepped **all** migrations (per the project's re-base rule). Four hits mention it, only two define it:

- `supabase/migrations/20260411144407_compute_jobs_queue.sql:179` — ORIGINAL, superseded.
- `supabase/migrations/20260416125430_contact_request_metadata.sql:154` — `DROP INDEX IF EXISTS compute_jobs_one_inflight_per_kind_strategy;`
- `supabase/migrations/20260416125430_contact_request_metadata.sql:156-160` — **CURRENT definition**, verbatim:
  ```sql
  CREATE UNIQUE INDEX compute_jobs_one_inflight_per_kind_strategy
    ON compute_jobs (strategy_id, kind)
    WHERE strategy_id IS NOT NULL
      AND kind <> 'compute_intro_snapshot'
      AND status IN ('pending', 'running', 'done_pending_children');
  ```

Every later mention (`20260418194206:147,157`, `20260420073003:294`, `20260528061155:14,141,318`,
`20260601193000:169`, `20260603120000:88,256`, `20260719073701:141`) is a comment or a sibling-index
COMMENT — no later redefinition exists.
`[VERIFIED: supabase/migrations/20260416125430_contact_request_metadata.sql:154-161]`

**CONTEXT.md's citation of `:156` is CORRECT.**

**SC#2 consequence:** the index does NOT cover `failed_final` / `failed_retry` / `done`. So a strategy with
only a `failed_final` row for that kind would *not* be blocked by the index. That is moot for this sweep,
because the predicate requires **zero `compute_jobs` rows of any status** — such a strategy is out of scope
before the insert is ever attempted. Stated so the planner does not weaken the predicate under the mistaken
belief that the index backstops it.

### §2 — `enqueue_compute_job` / `_enqueue_compute_job_internal` (⚠️ do NOT call from cron)

**Latest public wrapper:** `supabase/migrations/20260515210300_scoring_weight_overrides_high_hardening.sql:255-268`

```sql
CREATE OR REPLACE FUNCTION public.enqueue_compute_job(
  p_strategy_id     UUID,
  p_kind            TEXT,
  p_idempotency_key TEXT DEFAULT NULL,
  p_parent_job_ids  UUID[] DEFAULT '{}',
  p_exchange        TEXT DEFAULT NULL,
  p_metadata        JSONB DEFAULT NULL,
  p_allocator_id    UUID DEFAULT NULL,
  p_api_key_id      UUID DEFAULT NULL,
  p_run_at          TIMESTAMPTZ DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
```
Grants: `REVOKE ALL ... FROM PUBLIC, anon, authenticated; GRANT EXECUTE ... TO service_role;`
(`20260515210300:230-236`). `[VERIFIED: supabase/migrations/20260515210300_scoring_weight_overrides_high_hardening.sql:230-268]`

**Strategy branch** delegates through `_assert_owner`:
```sql
PERFORM _assert_owner('strategies'::regclass, p_strategy_id, 'enqueue_compute_job');
```
`[VERIFIED: supabase/migrations/20260515210300_scoring_weight_overrides_high_hardening.sql:277]`

**`_assert_owner` latest definition:** `supabase/migrations/20260516131500_compute_jobs_residual_apply.sql:193`,
and its first statement is:
```sql
IF v_auth_uid IS NULL THEN
  RETURN;  -- service-role path, skip the check
END IF;
```
`[VERIFIED: supabase/migrations/20260516131500_compute_jobs_residual_apply.sql:209-211]`

**Answering CONTEXT's open question directly:** a pg_cron session has no JWT, so `auth.uid()` is NULL and
`_assert_owner` returns immediately. **Ownership is NOT a blocker** for calling `enqueue_compute_job` from
a cron body.

**But there is a stronger reason not to call it.** The latest `_enqueue_compute_job_internal` is
`supabase/migrations/20260716090000_retire_compute_analytics_kind_rpc_guard.sql:49` (7-param) and `:181`
(10-param). The 7-param body's race-loss tail:

```sql
IF v_new_id IS NULL THEN
  RAISE EXCEPTION '_enqueue_compute_job_internal: enqueue race lost and winner already terminal (target strategy=%, portfolio=%, kind=%)',
    p_strategy_id, p_portfolio_id, p_kind
    USING ERRCODE = 'serialization_failure';
END IF;
```
`[VERIFIED: supabase/migrations/20260716090000_retire_compute_analytics_kind_rpc_guard.sql:162-171]`

The 10-param body instead uses `SELECT id INTO STRICT v_new_id` on the re-read
(`20260716090000:285`), which raises `NO_DATA_FOUND` (`P0002`) on the same race.

**Consequence:** a `RAISE` from inside a pg_cron body aborts the whole tick — the healed count is lost, the
`RAISE NOTICE` never runs, and the remaining candidates in the batch are not processed. This is a real
outcome, not a theoretical one: this sweep runs concurrently with the live enqueue path it exists to
backstop. **Recommendation: the sweep INSERTs directly into `public.compute_jobs` with a bare
`ON CONFLICT DO NOTHING`** (which covers all constraints and indexes, including the partial unique). That
is also strictly more faithful to CONTEXT's "no new callable SQL surface / inline cron body" decision.

### §3 — `strategy_analytics.computation_status` vocabulary

Current CHECK, verbatim:
```sql
CHECK (computation_status IN ('pending', 'computing', 'complete', 'complete_with_warnings', 'failed'));
```
`[VERIFIED: supabase/migrations/20260602120000_strategy_analytics_add_complete_with_warnings.sql:46]`

Column default at creation: `computation_status TEXT NOT NULL DEFAULT 'pending'`
`[VERIFIED: supabase/migrations/20260405061911_initial_schema.sql:73]`

**CONTEXT.md's five-value vocabulary is CONFIRMED, and its `:46` citation is CORRECT.**
The TS single-source-of-truth is `src/lib/closed-sets.ts STRATEGY_ANALYTICS_COMPUTATION_STATUSES`, pinned
against this CHECK by `src/__tests__/contracts/check-zod-db-check-parity.test.ts`
(`20260602120000:4-9`).

`strategy_analytics` has `computed_at TIMESTAMPTZ NOT NULL DEFAULT now()`
(`20260405061911:72`), `computing_started_at timestamptz` nullable/no-default added by
`20260802120000:219-220`, and **no `updated_at` column at all** (`20260802120000:681`).

### §4 — `csv_daily_returns` schema and indexes

Base DDL, verbatim:
```sql
CREATE TABLE IF NOT EXISTS public.csv_daily_returns (
  strategy_id  UUID             NOT NULL REFERENCES public.strategies(id) ON DELETE CASCADE,
  date         DATE             NOT NULL,
  daily_return DOUBLE PRECISION NOT NULL,
  created_at   TIMESTAMPTZ      NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ      NOT NULL DEFAULT now(),
  CONSTRAINT csv_daily_returns_pkey PRIMARY KEY (strategy_id, date)
);
```
`[VERIFIED: supabase/migrations/20260522111839_csv_daily_returns.sql:36-42]`

Later widened to a per-key axis (`20260624120000_csv_daily_returns_per_key_axis.sql`), which:
- made `strategy_id` **nullable** and added `api_key_id` + `allocator_id`;
- added `CONSTRAINT csv_daily_returns_source_xor CHECK (num_nonnulls(strategy_id, api_key_id) = 1)`
  `[VERIFIED: supabase/migrations/20260624120000_csv_daily_returns_per_key_axis.sql:44-45]`
- recreated `CREATE UNIQUE INDEX csv_daily_returns_strategy_date_key ON public.csv_daily_returns (strategy_id, date);`
  `[VERIFIED: supabase/migrations/20260624120000_csv_daily_returns_per_key_axis.sql:55-56]`

**Index usable by the sweep predicate: YES.** `csv_daily_returns_strategy_date_key` on `(strategy_id, date)`
serves an `EXISTS (SELECT 1 FROM public.csv_daily_returns WHERE strategy_id = s.id)` semi-join directly, and
NULL-`strategy_id` per-key rows are excluded for free by the equality. **There is no index on `created_at`**
— see Landmine L-4 for the grace-window-anchor consequence.

RLS on `csv_daily_returns` is `ENABLE ROW LEVEL SECURITY` with a service-role-all policy plus owner/admin
SELECT policies; `FORCE ROW LEVEL SECURITY` is **not** set on this table
(`20260522111839:55-90`; the repo-wide `FORCE` grep returns only `compute_jobs` / `compute_job_kinds` /
a `weight_snapshots` assertion — see §6).

### §5 — Retention crons (⚠️ CONTEXT's citation points at a stale header comment)

CONTEXT.md cites `20260417110539_retention_crons.sql:88`. That line is a **prose table inside the migration
header**, not the deployed body:
```
--      retention_compute_jobs_done       | 20 3 * * *     | 30 days
```
`[VERIFIED: supabase/migrations/20260417110539_retention_crons.sql:88]`

The **currently-deployed bodies** are later re-registrations. Cite these instead:

| Job | Cadence | Predicate (verbatim) | Current definition |
|---|---|---|---|
| `retention_compute_jobs_done` | `20 3 * * *` | `DELETE FROM compute_jobs WHERE status = 'done' AND created_at < now() - interval '30 days';` | `supabase/migrations/20260515113853_retention_crons_safe.sql:192-200` |
| `retention_compute_jobs_failed` | `30 3 * * *` | `DELETE FROM compute_jobs WHERE status IN ('failed_final', 'failed_retry') AND COALESCE(next_attempt_at, created_at) < now() - interval '90 days';` | `supabase/migrations/20260515210200_retention_crons_high_hardening.sql:250-259` |

`[VERIFIED: supabase/migrations/20260515113853_retention_crons_safe.sql:192-200]`
`[VERIFIED: supabase/migrations/20260515210200_retention_crons_high_hardening.sql:250-259]`

Note the second differs from the header table: the `failed` job keys on
`COALESCE(next_attempt_at, created_at)`, not bare `created_at` (H-0921, so a `failed_retry` row in slow-burn
recovery is not reaped mid-recovery — `20260515210200:239-244`).

**The window VALUES CONTEXT.md relies on (30d / 90d) are CORRECT.** Only the citation needs correcting.
**The safety argument therefore stands unchanged**, and is if anything stronger: nothing sweeps stale
`pending` at all (`.planning/REQUIREMENTS.md:57`, JOB-08), so a 31-day-old healthy strategy genuinely has
zero `compute_jobs` rows and the terminal-analytics conjunct is genuinely the only protection.

### §6 — `compute_jobs` write surface (RLS, CHECKs, trigger, columns)

- **`ALTER TABLE compute_jobs FORCE ROW LEVEL SECURITY;`**
  `[VERIFIED: supabase/migrations/20260516104201_compute_jobs_audit_2026_05_07_residual.sql:209]`
  with the rationale directly above it: *"Without FORCE, the table owner (postgres / migration applier /
  dashboard SQL editor) bypasses the deny-all policy. Supabase's service-role uses BYPASSRLS at the role
  level, not ownership, so the service-role admin path is unaffected."* (`:203-208`).
- Policy: `compute_jobs_deny_all` (`20260411144407:233-239`). `REVOKE ALL ON TABLE compute_jobs FROM PUBLIC,
  anon, authenticated;` (`20260516104201:220`).
- **Trigger:** `compute_jobs_set_updated_at_trigger` BEFORE UPDATE
  (`20260411144407:265-266`). No INSERT trigger. No row-count guard trigger on this table — the
  `retention_delete_guard()` statement trigger is attached only to `audit_log` / `audit_log_cold`
  (`20260719120000:33-38`).
- **`compute_jobs_kind_target_coherence`** — latest of 14 definitions is
  `supabase/migrations/20260717233529_allocator_equity_derived_surface.sql:168-181`. The relevant arm,
  verbatim:
  ```sql
  OR ((kind = ANY (ARRAY['sync_trades', 'compute_analytics', 'poll_positions', 'sync_funding', 'reconcile_strategy', 'compute_intro_snapshot', 'compute_analytics_from_csv', 'derive_broker_dailies', 'stitch_composite'])) AND (strategy_id IS NOT NULL) AND (portfolio_id IS NULL) AND (allocator_id IS NULL))
  ```
  `[VERIFIED: supabase/migrations/20260717233529_allocator_equity_derived_surface.sql:171]`
  A strategy-scoped `compute_analytics_from_csv` INSERT with `portfolio_id`/`allocator_id`/`api_key_id` NULL
  satisfies it.
- **`compute_jobs.status` CHECK**: `'pending','running','done','done_pending_children','failed_retry','failed_final'`
  `[VERIFIED: supabase/migrations/20260411144407_compute_jobs_queue.sql:112-120]`
- **`compute_jobs.priority`**: `TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high'))`
  `[VERIFIED: supabase/migrations/20260428120836_compute_jobs_priority.sql:53-55]`
- **`compute_jobs.metadata JSONB`** (nullable, no default)
  `[VERIFIED: supabase/migrations/20260411144407_compute_jobs_queue.sql:136]`

A minimal direct INSERT therefore needs only `(strategy_id, kind, metadata)`; `status`, `priority`,
`attempts`, `max_attempts`, `next_attempt_at`, `parent_job_ids`, `created_at`, `updated_at` all have
column defaults.

### §7 — `strategies` lifecycle

```sql
status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'pending_review', 'published', 'archived'))
```
`[VERIFIED: supabase/migrations/20260405061911_initial_schema.sql:63]`

Widened to five values:
```sql
CHECK (status IN ('draft', 'pending_review', 'published', 'archived', 'private'));
```
`[VERIFIED: supabase/migrations/20260716130000_strategies_status_private.sql:57-61]`

`strategies` has `created_at TIMESTAMPTZ NOT NULL DEFAULT now()` and **no `updated_at`, no `deleted_at`**
(`20260405061911:46-66`; a repo-wide grep for a `deleted_at` on `strategies` returns nothing). Rows are
hard-deleted via `ON DELETE CASCADE` from `profiles`. **There is no soft-delete to exclude.**

### §8 — Existing pg_cron job names (collision check)

All jobnames referenced anywhere in `supabase/migrations/**`:
`api_key_rotation_reminder`, `audit_log_cold_purge`, `audit_log_hot_to_cold`,
`compute_bridge_outcome_deltas`, `derive-allocator-key-dailies`, `match_engine_cron`,
`poll-allocator-positions`, `reap_strategy_analytics_stuck_computing`, `refresh-allocator-equity`,
`resend_message_correlation_retention_90d`, `retention_audit_log`, `retention_compute_jobs_done`,
`retention_compute_jobs_failed`, `retention_compute_jobs_orphaned_running`,
`retention_notification_dispatches`. **15 names; no `reconcile*` name is taken.**
`[VERIFIED: grep of jobname literals across supabase/migrations/*.sql, this session]`

pg_cron has no documented cap on job count relevant at this scale; the practical constraint on Supabase is
`cron.max_running_jobs` (default 32 on Supabase's pg_cron build) `[ASSUMED]`. At 16 jobs with staggered
schedules this is not a concern — but do **not** schedule at `0 3 * * *`/`:15`/`:20`/`:30` (occupied) or
`*/15` (the reaper). `0 * * * *` per CONTEXT is clear of every existing slot except the top of hour 3,
where `audit_log_hot_to_cold` runs at `0 3 * * *`. Consider `35 * * * *` if hour-3 contention matters;
this is Claude's-discretion territory.

### §9 — `derive_broker_dailies` mid-chain window (CONTEXT's "ANY kind" justification)

```python
ctx.supabase.table("csv_daily_returns")          # reconcile-span DELETE
```
`[VERIFIED: analytics-service/services/job_worker.py:4720]`
```python
ctx.supabase.table("csv_daily_returns").upsert(  # the dailies write
```
`[VERIFIED: analytics-service/services/job_worker.py:4742]`
```python
_csv_analytics_kind = JOB_CHAIN_FOLLOW_ON["derive_broker_dailies"][0]

def _enqueue_csv_analytics() -> None:
    ctx.supabase.rpc(
        "enqueue_compute_job",
        {"p_strategy_id": strategy_id, "p_kind": _csv_analytics_kind},
    ).execute()
```
`[VERIFIED: analytics-service/services/job_worker.py:5201-5209]`

The dailies land at :4742 and the follow-on enqueue happens at :5203-5209, both inside the still-`running`
`derive_broker_dailies` job. **CONTEXT.md's "ANY kind" decision is confirmed correct** — kind-scoping the
NOT EXISTS would re-enqueue this healthy in-flight chain.

Chain map, verbatim:
```python
JOB_CHAIN_FOLLOW_ON: Final[dict[str, tuple[str, ...]]] = {
    "process_key_long": ("derive_broker_dailies", "sync_trades"),
    "sync_trades": ("derive_broker_dailies",),
    "derive_broker_dailies": ("compute_analytics_from_csv",),
    "compute_analytics_from_csv": (),
    "stitch_composite": (),
}
```
`[VERIFIED: analytics-service/services/job_worker.py:521-528]`
```python
STRATEGY_ANALYTICS_REAP_THRESHOLD: Final[str] = "16 hours"
```
`[VERIFIED: analytics-service/services/job_worker.py:559]`

### §10 — The hole itself (`csv-finalize`)

```ts
function enqueueCsvAnalyticsAfter(
```
`[VERIFIED: src/app/api/strategies/csv-finalize/route.ts:808]`
```ts
  after(async () => {
```
`[VERIFIED: src/app/api/strategies/csv-finalize/route.ts:813]`

Every guard — the `enqueueErr` branch's `captureToSentry` (`:833-837`), the `catch` branch's
(`:846-850`), and the `writeFailedStrategyAnalyticsPlaceholder` call (`:858-863`) — is lexically inside
that `after()` closure. CONTEXT.md's architectural-invisibility claim is confirmed at the source.
The `captureToSentry` tag/extra shape to mirror:
```ts
captureToSentry(enqueueErr, {
  tags: { surface: "csv-finalize", step: "csv-analytics-enqueue" },
  extra: { strategy_id: strategyId, correlation_id: opts.correlationId },
});
```
`[VERIFIED: src/app/api/strategies/csv-finalize/route.ts:833-837]`
(CONTEXT cites "~836" — close enough; the exact call spans 833-837.)

---

## Architecture Patterns

### System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  THE HOLE (existing, unchanged by this phase)                               │
│                                                                             │
│  POST /api/strategies/csv-finalize                                          │
│      │                                                                      │
│      ├─ finalize_csv_strategy()          ── COMMITS (synchronous)           │
│      ├─ persist_csv_daily_returns()      ── COMMITS (synchronous)           │
│      │      └──────────────► public.csv_daily_returns  [rows now present]   │
│      │                                                                      │
│      └─ after(() => { ... })   route.ts:813                                 │
│               │                                                             │
│               ├─ enqueue_compute_job(...)         ┐                         │
│               ├─ captureToSentry(enqueueErr)      │ ALL of this is inside   │
│               └─ writeFailedStrategyAnalytics...  ┘ the closure             │
│                                                                             │
│           ⚡ INSTANCE TORN DOWN BEFORE CALLBACK RUNS ⚡                       │
│           ⇒ dailies present · 0 compute_jobs rows · 0 strategy_analytics    │
│           ⇒ NO guard executed, NO signal emitted, NO state to poll          │
└─────────────────────────────────────────────────────────────────────────────┘
                                     │
                                     │  detection BY ABSENCE
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  THIS PHASE — pg_cron `0 * * * *` (inline body, no callable surface)        │
│                                                                             │
│   WITH batch AS MATERIALIZED (            ◄── LIMIT fence (D-19 lesson)     │
│     SELECT s.id                                                             │
│       FROM public.strategies s                                              │
│      WHERE EXISTS (dailies for s.id)          ── csv_daily_returns          │
│        AND NOT EXISTS (ANY compute_jobs)      ── compute_jobs (ANY status)  │
│        AND NOT EXISTS (terminal analytics)    ── strategy_analytics         │
│        AND <grace anchor> < now() - '1 hour'                                │
│      ORDER BY <grace anchor> ASC                                            │
│      LIMIT n  FOR UPDATE SKIP LOCKED                                        │
│   )                                                                         │
│   INSERT INTO public.compute_jobs (strategy_id, kind, metadata)             │
│   SELECT id, 'compute_analytics_from_csv',                                  │
│          jsonb_build_object('source','reconcile-sweep','detected_at',now()) │
│     FROM batch                                                              │
│   ON CONFLICT DO NOTHING;    ◄── SC#2 rides compute_jobs_one_inflight_...   │
│                                                                             │
│   RAISE NOTICE '<single literal>'  ─────► cron.job_run_details.return_message│
└─────────────────────────────────────────────────────────────────────────────┘
                                     │
                                     ▼  row sits 'pending'
┌─────────────────────────────────────────────────────────────────────────────┐
│  ALERT PATH — analytics-service worker (Railway, `python -m main_worker`)   │
│                                                                             │
│   main_worker.main()                                                        │
│     └─ ⚠️ init_sentry()  ◄── MISSING TODAY. Must be added (Landmine L-1)     │
│                                                                             │
│   dispatch_loop → dispatch_tick(worker_id)                                  │
│     └─ claim_compute_jobs_with_priority(batch=5, worker_id)                 │
│          └─ for job in jobs:            main_worker.py:605                  │
│               job["metadata"]["source"] == 'reconcile-sweep'                │
│                   └─► sentry_sdk.capture_message(..., level="warning")      │
│               dispatch(job) → run_csv_strategy_analytics → factsheet        │
│                                                                             │
│   Honest latency: sweep-tick → next claim (≤30s dispatch interval).         │
│   Down worker ⇒ no alert (independently alarmed by healthz).                │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | File | Responsibility in this phase |
|---|---|---|
| New migration | `supabase/migrations/<ts>_<name>.sql` (NEW) | Register the sweep cron; self-verify the deployed body. Touches nothing else. |
| Sweep cron body | inline `$cron$...$cron$` literal | Detection + bounded idempotent re-enqueue + `RAISE NOTICE`. |
| SQL gate | `supabase/tests/test_<name>.sql` (NEW) | EXECUTE the REAL deployed body against seeded fixtures. The only gate that can falsify the predicate. |
| TS content gate | `src/__tests__/<name>.test.ts` (NEW) | Text assertions on the migration file — runs with no DB, in every vitest shard. |
| Worker Sentry bootstrap | `analytics-service/main_worker.py` (MODIFY `main()`) | `init_sentry()` — without it the emission is a no-op. |
| Worker emission | `analytics-service/main_worker.py` `dispatch_tick` (MODIFY) | Read `job["metadata"]["source"]`, capture. |
| pytest gate | `analytics-service/tests/test_main_worker.py` (MODIFY) or new file | Assert the capture fires; assert `init_sentry` is called from `main()`. |

### Recommended Project Structure

```
supabase/migrations/
└── <14-digit-ts>_reconcile_dropped_enqueue_sweep.sql   # NEW — the only migration
supabase/tests/
└── test_reconcile_dropped_enqueue_sweep.sql            # NEW — CI-visible SQL gate
src/__tests__/
└── reconcile-dropped-enqueue-sweep.test.ts             # NEW — migration-content gate
analytics-service/
├── main_worker.py                                      # MODIFY main() + dispatch_tick()
└── tests/
    └── test_main_worker.py                             # MODIFY — 2 new test classes
.planning/  (TODOS.md)                                  # MODIFY — record the wizard non-coverage
```

### Pattern 1: The migration skeleton (copy the shape, not the content)

Source of truth: `supabase/migrations/20260802120000_strategy_analytics_stuck_computing_reaper.sql`
(690 lines) and `20260803130000_reaper_limit_bound_materialized_cte.sql` (213 lines).

**Header sections to reproduce, in order** (all present in `20260802120000:1-207`):

| Section | 142's lines | What it must carry here |
|---|---|---|
| `Why this migration exists` | `:5-30` | The `after()` hole; why no in-request guard can see it. |
| `WHERE THE VALUE LANDS (do not overclaim)` | `:23-30` | Page-refresh / factsheet path, NOT a live-wizard rescue (poller self-escalates at 15 min). |
| `CADENCE HONESTY` | `:32-36` | `0 * * * *` is post-threshold detection latency ⇒ worst case ≈ grace + 1 h. |
| `Threshold rationale` | `:38-61` | The 1-hour derivation + the explicit rejection of 16 h and of the 4 h `compute_jobs` number. |
| `SAFETY vs DEBOUNCE` | `:63-68` | Here the safety carrier is the **terminal-analytics conjunct**, and the interval is debounce. Say so; 142's safety carrier was a different conjunct. |
| `CLOCK SKEW` | `:70-74` | Grace anchor is DB-side `now()`-stamped; skew argument. |
| `<Grace anchor> rationale` | `:76-101` (142's "Backfill anchor") | **The Phase-106 lesson.** Argue the chosen column and name why each alternative is wrong. |
| `CENSUS AT AUTHORING TIME` | `:92-101` | TEST + PROD counts of the predicate. See `## Environment Availability`. |
| `Scope discipline` | `:109-123` | ONE cron job, no DDL, no RLS, no claim RPC; Phase 144 owns `retention_compute_jobs_orphaned_running`. |
| `Idempotency` | `:125-131` | `cron.unschedule`-then-`cron.schedule` is the canonical re-apply. |
| `Convention deviation (pre-documented)` | `:133-149` | migration-reviewer #14. See `## Common Pitfalls` P-6. |
| `Operator observability` | `:151-168` | The verbatim `cron.job_run_details` inspection query. |
| `PROD-AUTO-APPLY WARNING` | `:170-177` | Merging to `main` auto-applies to PROD; apply to TEST and run the gate first. |

**Body conventions:**
```sql
BEGIN;
SET lock_timeout = '5s';
...
COMMIT;
```
`[VERIFIED: supabase/migrations/20260802120000_strategy_analytics_stuck_computing_reaper.sql:209-210,690]`

Fail-loud pg_cron presence check + idempotent re-register:
```sql
DO $$
DECLARE v_has_pg_cron BOOLEAN;
BEGIN
  SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') INTO v_has_pg_cron;
  IF NOT v_has_pg_cron THEN
    RAISE EXCEPTION 'JOB-04: pg_cron extension is NOT installed. ...'
      USING ERRCODE = 'feature_not_supported';
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = '<name>') THEN
    PERFORM cron.unschedule('<name>');
  END IF;
  PERFORM cron.schedule('<name>', '<cadence>', $cron$ ... $cron$);
  RAISE NOTICE '<single literal>';
END $$;
```
`[VERIFIED: supabase/migrations/20260802120000_strategy_analytics_stuck_computing_reaper.sql:434-531]`

Terminal self-verify block reading the DEPLOYED body back out of `cron.job.command`, with positive AND
negative anchors: `[VERIFIED: supabase/migrations/20260802120000_strategy_analytics_stuck_computing_reaper.sql:634-688]`
and the single-job assertion `[VERIFIED: supabase/migrations/20260803130000_reaper_limit_bound_materialized_cte.sql:172-176]`.

### Pattern 2: The MATERIALIZED-CTE LIMIT fence — what D-19 fixed

**The defect (do not re-introduce):**
```
UPDATE ... WHERE strategy_id IN ( SELECT ... ORDER BY ... LIMIT 25 FOR UPDATE SKIP LOCKED )
```
`FOR UPDATE` makes the subplan un-hashable, so the planner attaches it as the INNER side of a nested-loop
semi-join and RE-EXECUTES it once per outer row. Each re-execution applies its own fresh LIMIT, so the cap
is per-rescan, never global. Measured on TEST (Postgres 17.6): **26 seeded rows, one tick → 26 of 26
processed. Expected 25.**
`[VERIFIED: supabase/migrations/20260803130000_reaper_limit_bound_materialized_cte.sql:17-37]`

**The fix, verbatim shape:**
```sql
WITH batch AS MATERIALIZED (
  SELECT s.strategy_id
    FROM public.strategy_analytics s
   WHERE ...
   ORDER BY s.computing_started_at ASC
   LIMIT 25
   FOR UPDATE SKIP LOCKED
)
UPDATE public.strategy_analytics sa
   SET ...
  FROM batch
 WHERE sa.strategy_id = batch.strategy_id
   AND sa.computation_status = 'computing';
```
`[VERIFIED: supabase/migrations/20260803130000_reaper_limit_bound_materialized_cte.sql:132-155]`

Three warnings carried verbatim in that file and which must be reproduced here:
- *"MATERIALIZED is REQUIRED and must not be 'simplified' away. Since Postgres 12 a bare `WITH` is inlined
  when referenced once, which reintroduces exactly the re-execution this migration removes. The keyword IS
  the fix."* (`:64-68`)
- *"Do NOT rewrite either arm back to `WHERE ... IN (SELECT ... LIMIT n)`, and do not 'optimize' the CTE
  into a FROM-clause subquery: the FROM form was also measured on TEST and reaps 26 of 26 as well"*
  (`:70-73`)
- *"Every gate in phases 142 and 142.1 passed over this, because each one greps for the PRESENCE of `LIMIT`
  / `SKIP LOCKED` in the deployed body — and the tokens are there. Only executing the body against real
  rows falsifies it."* (`:35-37`)

⚠️ **Adaptation note for this phase.** 142's fenced batch and its mutation target are the SAME table, so
`FOR UPDATE SKIP LOCKED` locks the rows it then updates. Here the batch selects from `strategies` (or
`strategy_analytics`) but INSERTs into `compute_jobs`. `FOR UPDATE` on `strategies` still serialises two
concurrent sweep ticks against the same candidate — which is what SC#2's "run twice" needs at the
statement level — but the *real* idempotency arbiter is `ON CONFLICT DO NOTHING` against the partial unique
index, and that holds with or without the row lock. **`FOR UPDATE SKIP LOCKED` is therefore about the LIMIT
bound and about not blocking live writers, not about correctness.** Note also: `FOR UPDATE` is illegal on
the nullable side of an outer join and on aggregates — keep the batch CTE a plain `SELECT ... FROM
strategies` with `EXISTS`/`NOT EXISTS` subqueries only.

### Pattern 3: The SQL gate — oracle discipline

`supabase/tests/test_strategy_analytics_stuck_computing_reaper.sql` (925 lines) is the model. Load-bearing
properties, quoted from its header:

- **Oracle independence.** *"The behavioral parts read the REAL deployed body out of `cron.job.command` and
  `EXECUTE v_command` it. They NEVER re-type the predicate. A gate that re-implements the predicate passes
  when the DEPLOYED predicate is wrong."* `[VERIFIED: supabase/tests/test_strategy_analytics_stuck_computing_reaper.sql:33-43]`
- **Anti-green-skip.** *"Part 1 is DELIBERATELY UNGATED and MUST FAIL when migration 20260802120000 is
  unapplied — that is this file's TDD RED proof. ... A gate that green-skips when the object under test is
  absent is not evidence."* `[VERIFIED: …:45-60]`
- **Transaction framing (per-part only).** *"Every part that writes opens its OWN `BEGIN;`, immediately sets
  `SET LOCAL lock_timeout = '5s'`, and closes with `ROLLBACK;`. There is NO outer whole-file transaction, and
  adding one would be a silent data hazard: psql's nested BEGIN emits `WARNING: there is already a
  transaction in progress` and creates NO savepoint, so the FIRST inner rollback would end the outer
  transaction and every later part would AUTOCOMMIT its seeds onto the SHARED test project."*
  `[VERIFIED: …:62-79]`
- **Isolation by construction, never cross-tenant writes.** Seeds are stamped `now() - interval '100 years'`
  so they win the global `ORDER BY ... LIMIT` budget without touching another tenant's rows. Three
  cross-tenant neutralizing `UPDATE`s were DELETED in 142.1/D-18. `[VERIFIED: …:81-104]`
- **No sleeps, ever.** *"All ages are clock-offset arithmetic; there are no sleeps anywhere in this file."*
  `[VERIFIED: …:122-123]`
- **Frozen-clock trap.** *"Each part runs inside a single transaction, so `now()` is CONSTANT for the whole
  part."* A test that compares two `now()`-derived values inside one part CANNOT FAIL. Use a pre-set
  **sentinel** value instead. `[VERIFIED: …:114-123]`
- **pgTAP is NOT installed.** Assertions are plain `RAISE EXCEPTION`; a clean run prints NOTICEs only.
  `[VERIFIED: …:128-130]` and `.github/workflows/ci.yml:878-880`.

**Answering the research question "how does a test cross a grace window without sleeping":** it does not
advance the clock — it **backdates the seed**. Verbatim from Part 2:
```sql
INSERT INTO public.strategy_analytics
  (strategy_id, computation_status, computation_warned, computing_started_at, computed_at)
VALUES (v_a, 'computing', TRUE, v_fresh - interval '100 years', v_fresh);
```
`[VERIFIED: supabase/tests/test_strategy_analytics_stuck_computing_reaper.sql:357-361]`
and the in-grace control is seeded at `v_fresh` (`:364-366`). ⚠️ This means the grace anchor column **must
be directly writable by the test's INSERT** — see Landmine L-4.

**The FK seed chain** (reusable verbatim):
```sql
INSERT INTO auth.users (id, email) VALUES (v_user, '...@invalid.local');
INSERT INTO public.profiles (id, display_name) VALUES (v_user, '...') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.strategies (user_id, name) VALUES (v_user, '...') RETURNING id INTO v_a;
```
`[VERIFIED: supabase/tests/test_strategy_analytics_stuck_computing_reaper.sql:337-346]`
and a `compute_jobs` seed:
```sql
INSERT INTO public.compute_jobs
  (kind, strategy_id, status, priority, attempts, next_attempt_at, claim_token, claimed_at)
VALUES ('compute_analytics_from_csv', v_c, 'running', 'normal', 1, now(), gen_random_uuid(), now());
```
`[VERIFIED: supabase/tests/test_strategy_analytics_stuck_computing_reaper.sql:373-375]`

### Pattern 4: The TS migration-content gate

`src/__tests__/compute-jobs-kind-check-csv-2026-05-25.test.ts` (137 lines). Shape:
```ts
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

const REPO_ROOT = join(__dirname, "..", "..");
const MIGRATIONS_DIR = join(REPO_ROOT, "supabase", "migrations");
const FIX_FILENAME = "<14-digit-ts>_<name>.sql";
const FIX_PATH = join(MIGRATIONS_DIR, FIX_FILENAME);
```
`[VERIFIED: src/__tests__/compute-jobs-kind-check-csv-2026-05-25.test.ts:1-36]`
It is described as *"Pure text-based — no live DB required"* (`:29`) and declares its oracle literals
**locally** (the `PRIOR_KINDS` array at `:42-56`) rather than importing them — this is the
oracle-independence convention CONTEXT.md names.

### Pattern 5: The pytest drift/content gate

`analytics-service/tests/test_main_worker.py` extracts the cron body from the **migration file text**, not
the DB, and guards the extraction against vacuity:
```python
def _reaper_cron_body() -> str:
    src = _reaper_migration_path().read_text(encoding="utf-8")
    match = re.search(r"\$cron\$(.*?)\$cron\$", src, flags=re.DOTALL)
    assert match is not None, ...
    body = match.group(1)
    assert "UPDATE public.strategy_analytics" in body, (
        "extracted $cron$ body does not contain the reaping UPDATE — the "
        "extraction is broken, so the assertions below prove nothing. ...")
```
`[VERIFIED: analytics-service/tests/test_main_worker.py:2213-2243]`
And the reason it scopes to the `$cron$` body rather than the whole file, verbatim: *"A whole-file grep would
therefore be TRIPPED by a comment and by correct code. Grep-gate hygiene: prose must neither satisfy nor
trip the gate."* (`:2219-2224`). The repo path is resolved as
`pathlib.Path(__file__).resolve().parents[2] / "supabase" / "migrations" / NAME` (`:2199-2210`).

### Anti-Patterns to Avoid

- **`WHERE ... IN (SELECT ... LIMIT n FOR UPDATE SKIP LOCKED)`** — the D-19 defect. The bound does not exist.
- **A bare `WITH batch AS (...)`** — inlined since PG12 when referenced once; the `MATERIALIZED` keyword IS the fix.
- **A grep-only gate on `LIMIT` / `SKIP LOCKED`** — every 142/142.1 gate passed over a body whose bound did
  not exist, because the tokens were present.
- **Calling `enqueue_compute_job` from the cron body** — its race-loss arm `RAISE`s and aborts the tick (§2).
- **Keying the grace window on a column a writer re-stamps** — the Phase 106 revert (`20260802120000:17-21`).
- **A whole-file `BEGIN;` in the SQL gate** — psql nested BEGIN creates no savepoint; the first `ROLLBACK`
  ends the outer transaction and every later part AUTOCOMMITs onto the shared TEST project.
- **Comparing two `now()`-derived values inside one transaction** — frozen clock; the assertion cannot fail.
- **Cross-tenant neutralizing `UPDATE`s in the SQL gate** — deleted in 142.1/D-18; isolate by construction.
- **Multi-part `RAISE` format strings** — migration-reviewer invariant #21 is CRITICAL conf 10.
- **Adding this cron to `supabase/tests/test_retention_crons_safe.sql`** — that file's loop asserts every
  listed body matches `%where%created_at%` (`test_strategy_analytics_stuck_computing_reaper.sql:131-134`).

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---|---|---|---|
| Enqueue idempotency (SC#2) | A "does a job already exist" pre-check, a new unique index, or an advisory lock | `ON CONFLICT DO NOTHING` against the existing `compute_jobs_one_inflight_per_kind_strategy` | Already the arbiter for every other enqueue path (`20260716090000:123-134`). A pre-check is TOCTOU-racy against the live enqueue path. |
| Bounding the batch | A `count(*)` pre-check, a row-limit trigger, or a loop | `WITH batch AS MATERIALIZED (... LIMIT n FOR UPDATE SKIP LOCKED)` | D-19 measured every plausible alternative shape and only this one holds. |
| Re-apply safety | A `IF NOT EXISTS` around `cron.schedule` | `cron.unschedule`-then-`cron.schedule` | `cron.schedule` upserts by name; the canonical repo pattern (`20260802120000:447-450`, `20260719120000:79-82`, `20260515210200:164-167`). |
| Cron→Sentry alerting | A `pg_net` POST to the Sentry store endpoint | Worker-side capture on claim | Fire-and-forget: a failed POST is itself silent. Explicitly rejected in CONTEXT.md and consistent with `20260802120000:153-155`. |
| Test-time clock advancement | `pg_sleep`, a mocked `now()`, or a settable interval parameter | Backdate the seed by an interval | No sleeps anywhere in the model gate; a settable interval is the `20260516170100` attack-surface class. |
| Threshold single-sourcing | Duplicating the interval literal in SQL and Python | If (and only if) a Python constant is introduced, mirror 142's `TestReaperThresholdDriftGate` | ⚠️ **Recommendation: do NOT introduce a Python constant here.** 142 needed one because `STRATEGY_ANALYTICS_REAP_THRESHOLD` is derived from `JOB_CHAIN_FOLLOW_ON`, which production reads. A 1-hour grace has no Python consumer, so a mirrored constant would be a *decorative* drift gate — the exact thing the 142-01 `JOB_CHAIN_FOLLOW_ON` lesson warns against (`.planning/phases/143-.../143-CONTEXT.md` "Established Patterns"). Pin the literal in the SQL gate and the TS content gate instead. |

**Key insight:** almost nothing in this phase is new machinery. The failure mode is not "we built the wrong
abstraction" — it is "we copied a 690-line template and silently dropped one of its load-bearing clauses."
Every reuse above should be verified by executing the deployed body, not by grepping for a token.

---

## Landmines

Each was actively hunted per the research brief. Verdict is stated even where the seed was refuted.

### L-1 (CRITICAL) — The worker process has no Sentry at all

`analytics-service/main_worker.py` is a standalone process:
> *"Standalone worker entry point for the durable compute_jobs queue. Runs 3 interleaved asyncio loops on
> Railway (CMD override: `python -m main_worker`)"*
`[VERIFIED: analytics-service/main_worker.py:1-3]`

Its `main()`:
```python
async def main() -> None:
    """Entry point. Validates KEK, sets signal handlers, runs all loops."""
    logging.basicConfig(...)
    logger.info("Worker starting as %s", WORKER_ID)
    validate_kek_on_startup()
    ...
    await asyncio.gather(
        dispatch_loop(WORKER_ID), watchdog_loop(), daily_enqueue_loop(), start_healthz_server(),
    )
```
`[VERIFIED: analytics-service/main_worker.py:961-993]`

A repo-wide grep for `sentry_sdk` across `analytics-service/**/*.py` returns hits **only** in
`sentry_init.py`, `main.py`, `routers/internal.py`, `services/logging_config.py`, `services/audit.py`, and
tests. **`main_worker.py` contains zero references to Sentry** (grep for `sentry|Sentry|init_sentry` in
`main_worker.py`: no matches). `services/job_worker.py` mentions Sentry only in two comments (`:1379`,
`:7367`) — CONTEXT.md's "the existing Sentry wiring in `job_worker.py`" **does not exist**.

`init_sentry()` is:
```python
def init_sentry() -> None:
    dsn = os.getenv("SENTRY_DSN")
    if not dsn:
        return
    sentry_sdk.init(dsn=dsn, traces_sample_rate=0.1, send_default_pii=False,
                    integrations=[StarletteIntegration(), FastApiIntegration()],
                    before_send=_redact_before_send, environment=_resolve_environment())
```
`[VERIFIED: analytics-service/sentry_init.py:347-363]`
Environment resolution is `VERCEL_ENV or RAILWAY_ENVIRONMENT_NAME or "development"`
`[VERIFIED: analytics-service/sentry_init.py:344-348]`.
`sentry-sdk[fastapi]==2.64.0` is a declared dependency `[VERIFIED: analytics-service/requirements.txt:222]`.

**Impact:** `sentry_sdk.capture_message(...)` with no initialized client is a **silent no-op**. Shipping the
emission without the init would make SC#1's "a Sentry alert fires" false in production while every unit test
(which mocks the SDK) stays green — the exact silent-alerting defect class CONTEXT.md rejected `pg_net` for.

**Required plan changes:**
1. A Wave-0 task adding `init_sentry()` to `main_worker.main()` (before `asyncio.gather`), sequenced
   **before** the emission task.
2. A pytest that asserts `main()` calls `init_sentry` — not just that the capture helper works.
3. A verification item: confirm `SENTRY_DSN` is set on the **worker** Railway service (it is a separate
   service from the FastAPI app). ⚠️ **UNVERIFIED this session** — Railway env was not read. Analogous to the
   known `RESEND_API_KEY` Vercel gap; the founder may need to set it.
4. ⚠️ `init_sentry()` passes `StarletteIntegration()` and `FastApiIntegration()`. In a process with no ASGI
   app these should be harmless, but this is **UNVERIFIED** for sentry-sdk 2.64.0 — a smoke run of
   `python -m main_worker` with `SENTRY_DSN` set is the cheapest proof. If they misbehave, the fix is a
   worker-specific init path, not removing the init.

### L-2 (HIGH) — `compute_jobs` is `FORCE ROW LEVEL SECURITY` + deny-all

`ALTER TABLE compute_jobs FORCE ROW LEVEL SECURITY;`
`[VERIFIED: supabase/migrations/20260516104201_compute_jobs_audit_2026_05_07_residual.sql:209]`
Policy `compute_jobs_deny_all` `[VERIFIED: supabase/migrations/20260411144407_compute_jobs_queue.sql:233-239]`.
`REVOKE ALL ON TABLE compute_jobs FROM PUBLIC, anon, authenticated;`
`[VERIFIED: supabase/migrations/20260516104201_compute_jobs_audit_2026_05_07_residual.sql:220]`

`FORCE` exists specifically to close the table-owner bypass. pg_cron runs a job as the role that scheduled
it — `postgres` on a Supabase migration apply. Whether that role bypasses RLS depends on its `BYPASSRLS`
attribute, which the migration header asserts belongs to `service_role`, not to ownership (`:203-208`).

**Empirical precedent (strong, but inference):** `retention_compute_jobs_orphaned_running` runs
```sql
DELETE FROM public.compute_jobs
 WHERE status = 'running' AND claimed_at IS NOT NULL AND claimed_at < now() - interval '2 hours';
```
from an inline pg_cron body `[VERIFIED: supabase/migrations/20260719120000_retention_orphaned_running_compute_jobs.sql:98-104]`,
and the project's own memory records it as *deleting real rows on PROD* (the deferred
"orphaned-running purge DELETEs not resets → prod job-loss" item, owned by Phase 144). If RLS blocked the
cron role, that DELETE would silently affect zero rows and no such incident could exist.
`retention_compute_jobs_done` / `_failed` are the same shape.

**Verdict: almost certainly not a blocker — but MEASURE it, do not assume.** Two cheap proofs, both of which
the plan should carry:
```sql
-- (a) who runs the cron, and does that role bypass RLS?
SELECT j.jobname, j.username, r.rolbypassrls, r.rolsuper
  FROM cron.job j JOIN pg_roles r ON r.rolname = j.username;
-- (b) does an INSERT from that role actually land?
--     the SQL gate's Part that EXECUTEs the deployed body already proves the
--     *statement* works; it does NOT prove it works as the CRON role.
```
⚠️ **Testing gap worth stating in the plan:** the `sql-tests` gate connects as the psql user in
`TEST_SUPABASE_DB_URL` and `EXECUTE`s the body in *that* session. It therefore validates the predicate but
**not** the cron role's RLS posture. The only proof of the latter is inspecting
`cron.job_run_details.return_message`/`status` after a real tick on TEST. Add that as a human-verify item.

### L-3 (HIGH, previously unsurfaced) — Composite strategies write dailies and are chain-terminal

`run_stitch_composite_job` deletes and upserts the stitched series into `csv_daily_returns`:
```python
supabase.table("csv_daily_returns").delete().eq("strategy_id", strategy_id).execute()
```
`[VERIFIED: analytics-service/services/job_worker.py:6786-6792]`
```python
supabase.table("csv_daily_returns").upsert(batch, on_conflict="strategy_id,date").execute()
```
`[VERIFIED: analytics-service/services/job_worker.py:6801-6803]`
and it writes `strategy_analytics` itself (`supabase.table("strategy_analytics")` at `:6881`), because
```python
"stitch_composite": (),            # chain-terminal — Phase 86 / COMP-02 fan-out
```
`[VERIFIED: analytics-service/services/job_worker.py:527]`

**Consequence:** a composite strategy has `csv_daily_returns` rows and **never** has a
`compute_analytics_from_csv` job. Once its `stitch_composite` job is retention-deleted at 30 days it matches
"dailies present + zero compute_jobs rows". If its `strategy_analytics` row is terminal it is protected —
but if it is absent or `pending` (e.g. a stitch that failed before the terminal write), the sweep would
enqueue `compute_analytics_from_csv` on a composite. That kind's handler explicitly does NOT own the
composite headline: `run_stitch_composite_job`'s own comment says the headline *"no longer routes through
that recompute"* because `run_csv_strategy_analytics` *"re-read the SPARSE `csv_daily_returns` and applied
SINGLE-KEY semantics that diverged"* — naming a concrete √252-vs-√365 annualization divergence and a
0.0 gap-fill that *"fabricated flat performance for refused/guard days"*
`[VERIFIED: analytics-service/services/job_worker.py:6808-6822]`.

**This directly contradicts CONTEXT.md's "Re-enqueued kind = `compute_analytics_from_csv`, correct for every
source."** Re-enqueuing the wrong kind on a composite would not merely waste work — it would overwrite the
composite headline with the divergent single-key computation, on a money surface.

**Planner decision required (this is a scope question, not an implementation detail):**
- **(a) EXCLUDE composites** from the predicate and record the non-coverage in the header alongside the
  wizard first-hop non-coverage. Detection: a composite is a strategy with rows in `public.strategy_keys`
  (the worker reads `supabase.table("strategy_keys")` at `job_worker.py:5472`) and/or `api_key_id IS NULL`
  on `strategies` for a wizard composite draft (`20260710180000:96-97,111`). ⚠️ The exact composite
  predicate is **UNVERIFIED** — I did not read `20260710130000_stitch_composite_kind.sql` or
  `20260710120000_strategy_keys.sql` in full. The planner must pin it before writing the predicate.
- **(b) BRANCH the kind** — `stitch_composite` for composites, `compute_analytics_from_csv` otherwise. More
  coverage, more surface, and a second false-positive profile to argue.
- **Recommendation: (a).** It matches the phase's stated shape ("one detection predicate, one bounded
  re-enqueue") and CONTEXT's own precedent for handling an uncoverable population (the wizard first-hop
  drop) — exclude it, document it, file it to TODOS.md.

If SC#1's prose has to change, remember the standing rule: **a scope amendment touching one file is
incomplete** — ROADMAP.md, STATE.md and REQUIREMENTS.md move together.

### L-4 (HIGH) — The grace-window anchor is genuinely unresolved, and Phase 106 is the cautionary tale

CONTEXT.md locks the grace *value* (1 hour) but explicitly leaves the *column* to be argued. Candidates,
each with its failure mode:

| Candidate | Verdict | Why |
|---|---|---|
| `csv_daily_returns.created_at` (MAX per strategy) | **Recommended** | `NOT NULL DEFAULT now()` (`20260522111839:40`), stamped when the dailies landed — i.e. exactly the event after which an enqueue should have followed. Directly writable by an INSERT, so the SQL gate can backdate it. ⚠️ **No index on this column** — see the cost note below. |
| `csv_daily_returns.updated_at` | Reject | `persist_csv_daily_returns` upserts and `derive_broker_dailies` re-upserts a span, so this advances on every refresh — the Phase 106 "writer re-stamps the key" shape in a new column. |
| `strategies.created_at` | Reject | Bears no relation to when the dailies landed. A strategy created a year ago whose CSV was uploaded 10 minutes ago is instantly past grace ⇒ the sweep races the live `after()`. This is the false-positive direction. |
| `strategy_analytics.computed_at` | Reject | The exact Phase-106 revert cause; wrong in both directions (`20260802120000:80-90`). Also absent for the row-ABSENT arm. |
| `compute_jobs.created_at` | Impossible | The predicate requires zero rows. |

**The Phase 106 argument the header must make**, mirroring `20260802120000:76-101`: name each rejected
column and say *how* it is wrong, not merely that it is.

**Cost note (must be resolved before the LIMIT is chosen).** `csv_daily_returns` has no index on
`created_at`. A per-candidate `MAX(created_at)` is a PK-prefix scan of that strategy's ~365 rows — cheap
individually, but the driving query shape matters. Two options:
- Drive from `strategies` with the three `EXISTS`/`NOT EXISTS` conjuncts first (cheap, index-served), and
  evaluate the `MAX(created_at)` grace conjunct **last**, only on survivors. On PROD this is a handful of
  rows (39 `strategy_analytics` rows at 2026-08-02 — `20260802120000:95-96`). On TEST it is larger.
- Or add `CREATE INDEX ... ON public.csv_daily_returns (strategy_id, created_at DESC)`. ⚠️ **Weigh against
  the table's own DDL comment**, which records that a redundant secondary index was *dropped* in PR #272
  because it *"would double write I/O for zero planner benefit"* (`20260522111839:31-34`). Given PROD scale,
  **do not add the index**; drive from `strategies` and put the grace conjunct last. Document the
  measurement in the header.

⚠️ **`ORDER BY` for determinism.** 142's reap arm orders by the stamp; its clock-start arm cannot order (all
values NULL) and its determinism argument is stated honestly as a residual assumption
(`test_strategy_analytics_stuck_computing_reaper.sql:391-400`). Here the anchor is orderable, so **order by
it ASC** — that is what lets the SQL gate seed a century-old candidate and guarantee it wins the LIMIT
budget on a shared TEST project.

### L-5 (MEDIUM) — What else writes `compute_jobs` on a schedule (race check)

| Cron | Schedule | Writes | Races this sweep? |
|---|---|---|---|
| `derive-allocator-key-dailies` | `30 5 * * *` (`20260717233529:269-282`) | Fans out **api_key-scoped** `derive_broker_dailies` | **No** — different target axis (`api_key_id`, not `strategy_id`); a different partial unique index arbitrates. |
| `poll-allocator-positions` | `0 4 * * *` (`20260420073003:692`) | `poll_allocator_positions`, api_key-scoped | No. |
| `refresh-allocator-equity` | `0 5 * * *` (`20260420213754:379`) | allocator-scoped | No. |
| `retention_compute_jobs_done` / `_failed` / `_orphaned_running` | `20 3` / `30 3` / `15 4` | DELETE only | **Interaction, not a race:** these are what *create* the population the terminal-analytics conjunct must protect. Never overlap them (03:15–04:30 UTC). |
| `reap_strategy_analytics_stuck_computing` | `*/15 * * * *` | UPDATEs `strategy_analytics` only | **Adjacent, non-racing by design** — CONTEXT's `computation_status` split. ⚠️ It runs at `:00` of every hour too. If this sweep is also at `0 * * * *`, both touch the same triangle in the same minute. They mutate disjoint state (one UPDATEs `strategy_analytics` rows at `computing`, the other INSERTs `compute_jobs` for rows NOT at `computing`), so it is safe — but **prefer an off-`:00` minute** (e.g. `35 * * * *`) to keep the pg_cron slot uncontended and the run logs readable. |
| Live enqueue path (`enqueue_compute_job` from the route / worker) | continuous | INSERT | **The real concurrent writer.** `ON CONFLICT DO NOTHING` handles it. |

**Verdict: no genuine race.** But note that if 142's reaper terminalizes a stranded row to `failed` at
`:00`, this sweep will then see a *terminal* analytics row and correctly skip it — the two mechanisms
compose in the right direction.

### L-6 (MEDIUM) — Should `strategies.status` gate the sweep?

Values: `'draft' | 'pending_review' | 'published' | 'archived' | 'private'`
`[VERIFIED: supabase/migrations/20260716130000_strategies_status_private.sql:57-61]`.

- No soft-delete column exists (§7) — nothing to exclude on that axis.
- `archived`: re-enqueuing analytics wastes a worker slot but corrupts nothing. **Recommend excluding it**
  for hygiene, and say so explicitly in the header (an unexplained absence reads as an oversight).
- `draft`: ⚠️ **do NOT exclude.** A CSV-finalize strategy whose `after()` dropped may well still be at a
  pre-terminal status precisely *because* nothing advanced it. Excluding `draft` could excise the exact
  population the phase exists to heal. **This must be measured in the census, not reasoned about**: count
  candidates broken down by `strategies.status`.
- `pending_review` / `published` / `private`: include.

**This is a genuine open decision** — see `## Open Questions` Q2.

### L-7 (LOW) — `_prestamp_dq_flags` creates a `pending` analytics row

`derive_broker_dailies` upserts `strategy_analytics` (with `on_conflict="strategy_id"`) before enqueuing the
follow-on `[VERIFIED: analytics-service/services/job_worker.py:5190-5196]`. On a fresh insert the column
DEFAULT applies, giving `computation_status = 'pending'` (`20260405061911:73`). That is inside CONTEXT's
"pending → 143 re-enqueues" arm, so it is handled — but note the row is created by a path that *did* enqueue,
so it will normally also have job rows and be out of scope. No action; recorded so it is not rediscovered.

### L-8 (LOW) — Migration timestamp must exceed the remote tip

`.github/workflows/migration-policy.yml` is a `pull_request` check that fetches the remote tip fresh and
blocks any newly-added migration whose 14-digit prefix is older, unless listed in
`.github/migrate-backdated-allowlist.txt` `[VERIFIED: .github/workflows/migration-policy.yml:15-19,196-272]`.
Repo tip on disk is `20260814120000_wizard_rpcs_revoke_authenticated.sql`, so the new file must be
`> 20260814120000`. Also `migration-drift-check.yml`, `sql-function-snapshot.yml` and `supabase-migrate.yml`
exist and may need consideration — **UNVERIFIED**, not read this session.

---

## Common Pitfalls

### P-1: A presence-grep gate that cannot fail
**What goes wrong:** the gate asserts `LIMIT` / `SKIP LOCKED` / `MATERIALIZED` appear in the deployed body.
The tokens are there. The property is not.
**Why:** D-19, verbatim: *"Every gate in phases 142 and 142.1 passed over this ... Only executing the body
against real rows falsifies it."* (`20260803130000:35-37`)
**Avoid:** the SQL gate must SEED n+1 candidates, EXECUTE the real body, and assert exactly n were healed
and the (n+1)-th was not; then run it again and assert the last one is healed (bounded AND progressing).
That is Part 3's shape (`test_strategy_analytics_stuck_computing_reaper.sql:454-559`).
**Warning sign:** the gate passes on a body you deliberately broke.

### P-2: Prose in the migration trips or satisfies a mechanical gate
**What goes wrong:** the header must *discuss* the rejected anchor columns; a whole-file grep for
`computed_at` then reddens on correct prose.
**Avoid:** scope every gate to the `$cron$...$cron$` body, with a vacuity assertion on the extraction —
`_reaper_cron_body()`'s shape (`test_main_worker.py:2213-2243`). 142's own header notes it *"deliberately
does NOT spell the sequence out: prose must never satisfy or trip a mechanical gate"* (`20260802120000:205-207`).

### P-3: The frozen-clock non-test
**What goes wrong:** inside one transaction `now()` is constant, so any assertion comparing two
`now()`-derived values passes under both the correct and the broken implementation.
**Avoid:** backdate seeds; use a **sentinel** value where a "did it change?" property is under test
(`test_strategy_analytics_stuck_computing_reaper.sql:114-123`).

### P-4: An outer `BEGIN;` in the SQL gate silently autocommits seeds onto the shared TEST project
**Avoid:** per-part `BEGIN;` + `SET LOCAL lock_timeout = '5s'` + `ROLLBACK;`, no outer transaction
(`test_strategy_analytics_stuck_computing_reaper.sql:62-79`).

### P-5: Global assertions on a shared TEST project
**What goes wrong:** the `python`, `e2e-seeded` and `sql-tests` jobs all write project
`qmnijlgmdhviwzwfyzlc`; a global count or a global empty-state assertion reddens on interleaving.
**Avoid:** scope every count to your own seeded id set (`= ANY (v_seeded)`), and seed old enough to win the
`ORDER BY ... LIMIT` budget by construction. The new job must carry
`concurrency: { group: shared-test-db, cancel-in-progress: false }` — **already true**, the gate is added to
the existing `sql-tests` job which has it (`ci.yml:882-885`). ⛔ Do NOT add a new CI job with its own group
(`ci.yml:895-901` explains why).

### P-6: Re-litigating migration-reviewer invariant #14
**What goes wrong:** the reviewer flags `BEGIN`/`COMMIT` and session-level `SET` as HIGH.
**Why it happens:** the doc is stale against repo convention — *"150 of 231 migrations in this repo use
BEGIN/COMMIT, including the repo tip ... and both pg_cron janitor analogs"* (`20260802120000:135-142`).
**Avoid:** pre-document the deviation in the header exactly as 142 did, and confirm every OTHER invariant
was checked (`#1` filename, `#3` SECDEF search_path — N/A here, no function created, `#5` no CONCURRENTLY in
transaction, `#6` no 23502 timebomb — N/A, no DDL, `#16` template-artifact scan, `#20` ACLs, `#21` single
`RAISE` literal). ⚠️ Note this migration creates **no function and no policy**, so invariants #3, #12, #13,
#17, #19, #20 are vacuously satisfied — say so, don't leave the reviewer to infer it. The
`rls-policy-auditor` should still be run (it triggers on anything touching `compute_jobs`), and its
BYPASSRLS-aware section (`.claude/agents/rls-policy-auditor.md:29+`) is directly relevant to L-2.

### P-7: A drift gate that guards a superseded body
**What goes wrong:** the pg_cron job is re-registered by a later migration; the pytest still reads the
older file, stays green, and guards nothing.
**Why:** 142's own header records this happening — *"This name and tests/test_main_worker.py::
`_REAPER_MIGRATION_NAME` move together — always name the migration that registers the body pg_cron actually
runs. Leaving either behind keeps the drift gate green while it guards a superseded body, which is how
D-19's own pointer went stale."* (`analytics-service/services/job_worker.py:535-543`)
**Avoid:** if this phase ever needs a follow-up migration, move the test's filename constant in the SAME
commit.

### P-8: pytest run from the wrong directory
`analytics-service` pytest MUST be run from `analytics-service/` (`pytest.ini` sets `testpaths = tests`,
`pythonpath = .` — `analytics-service/pytest.ini:1-4`). A repo-root run misses VCR cassettes and can make
live broker calls. Use `python3`, not `python`.

### P-9: `mypy --strict` is not run by the GSD milestone loop
Changes to `main_worker.py` must clear `mypy --strict` before `/ship`, or the errors surface only in PR CI.
Fix via `cast()`, not `# type: ignore`.

---

## Code Examples

### Sweep body sketch (⚠️ ILLUSTRATIVE — every literal below must be re-derived by the planner)

```sql
-- ⚠️ This is a SHAPE, not a specification. The grace anchor (L-4), the composite
-- exclusion (L-3), the status gate (L-6), the LIMIT value, the cadence minute and
-- the jobname are all Claude's-discretion decisions the planner must make and
-- ARGUE IN THE HEADER.
WITH batch AS MATERIALIZED (
  SELECT s.id AS strategy_id
    FROM public.strategies s
   WHERE EXISTS (
           SELECT 1 FROM public.csv_daily_returns d WHERE d.strategy_id = s.id
         )
     AND NOT EXISTS (
           SELECT 1 FROM public.compute_jobs cj WHERE cj.strategy_id = s.id
         )                                        -- ANY kind, ANY status
     AND NOT EXISTS (
           SELECT 1 FROM public.strategy_analytics sa
            WHERE sa.strategy_id = s.id
              AND sa.computation_status IN
                  ('computing', 'complete', 'complete_with_warnings', 'failed')
         )                                        -- absent OR 'pending' pass
     AND (SELECT max(d2.created_at) FROM public.csv_daily_returns d2
           WHERE d2.strategy_id = s.id) < now() - interval '1 hour'
   ORDER BY (SELECT max(d3.created_at) FROM public.csv_daily_returns d3
              WHERE d3.strategy_id = s.id) ASC
   LIMIT 25
   FOR UPDATE SKIP LOCKED
)
INSERT INTO public.compute_jobs (strategy_id, kind, metadata)
SELECT b.strategy_id,
       'compute_analytics_from_csv',
       jsonb_build_object('source', 'reconcile-sweep', 'detected_at', now())
  FROM batch b
ON CONFLICT DO NOTHING;
```

Notes on the sketch:
- The analytics conjunct is written as `NOT EXISTS (... status IN (four values))` rather than
  `NOT EXISTS (any row) OR status = 'pending'` so that **absent** and **`pending`** both pass with one
  clause. Enumerating the four excluded values (rather than negating `'pending'`) means a future sixth
  CHECK value defaults to **excluded** — the safe direction. Say this in the header; it is the
  mass-re-enqueue tripwire CONTEXT.md demands be pinned.
- `ON CONFLICT DO NOTHING` with **no conflict target** is required — a targeted
  `ON CONFLICT (strategy_id, kind)` cannot name a *partial* unique index without repeating its predicate.
- The `metadata` marker is what the worker reads. Keep the key names exactly as CONTEXT specifies
  (`source` / `detected_at`) and pin them in both the SQL gate and the pytest.
- ⚠️ The correlated `max()` appears three times. The planner should measure whether a
  `LEFT JOIN LATERAL` or a grouped CTE plans better — but **any rewrite must preserve the MATERIALIZED
  fence and must not put the batch on the inner side of a nested loop** (D-19).

### Worker Sentry bootstrap (`main_worker.main()`)

```python
async def main() -> None:
    """Entry point. Validates KEK, sets signal handlers, runs all loops."""
    logging.basicConfig(...)

    # JOB-04 (Phase 143): the worker had NO Sentry client. Without this, every
    # capture_* below is a silent no-op — an alerting channel that fails silently
    # is the defect class this milestone closed twice. No-op when SENTRY_DSN unset.
    from sentry_init import init_sentry
    init_sentry()

    logger.info("Worker starting as %s", WORKER_ID)
    ...
```

### Worker emission in `dispatch_tick` (insertion point)

The claim loop begins at `main_worker.py:605` (`for job in jobs:`) and the healthz refresh is the first
statement (`:615`). The cheapest correct insertion point is immediately after `claim_token = job.get("claim_token")`
(`:625`) and before the `try:` that wraps `dispatch()` (`:626`) — the marker read must not be inside the
heartbeat task's `try/finally`.

```python
        # JOB-04 (Phase 143): a job carrying the reconcile-sweep marker means an
        # enqueue was DROPPED and healed by absence. Alert on claim — there is no
        # cron -> Sentry bridge in this repo (20260802120000 header) and pg_net is
        # fire-and-forget. Latency is sweep -> next claim; a fully-down worker means
        # no alert, which is independently alarmed by healthz.
        _meta = job.get("metadata") or {}
        if _meta.get("source") == "reconcile-sweep":
            with sentry_sdk.new_scope() as scope:
                scope.set_tag("surface", "reconcile-sweep")
                scope.set_tag("job_kind", job.get("kind"))
                scope.set_extra("strategy_id", job.get("strategy_id"))
                scope.set_extra("detected_at", _meta.get("detected_at"))
                sentry_sdk.capture_message(
                    "Dropped compute-job enqueue healed by reconciliation sweep",
                    level="warning",
                )
```

Mirrors the repo's tag-then-capture-inside-`new_scope()` idiom
`[VERIFIED: analytics-service/main.py:196-201]` (which itself follows `services/audit.py:441`,
per `main.py:184`) and the Next.js side's `tags: {surface, step} / extra: {strategy_id, ...}` shape
`[VERIFIED: src/app/api/strategies/csv-finalize/route.ts:833-837]`.

⚠️ Import `sentry_sdk` as a **module** at `main_worker.py` top level, not `from sentry_sdk import
capture_message`. `main.py:16-20` records why: *"imported as a MODULE ... so the operator-signal captures
below resolve through `main.sentry_sdk` and can be [patched by tests]"*. Every existing pytest patches via
`monkeypatch.setattr(main, "sentry_sdk", spy)` (`tests/test_secret_misconfig_signal.py:103`) or
`patch.object(audit_module.sentry_sdk, ...)` (`tests/test_audit_emit.py:89-90`). A `from`-import makes the
emission untestable with the existing idiom.

⚠️ `services/redact.py` has a leaf-module invariant forbidding `import sentry_sdk`
(`tests/test_redact.py:280-283`) — that constraint is on `redact.py` only and does not apply here.

---

## Validation Architecture

### Test Framework

| Property | Value |
|---|---|
| SQL gate framework | Plain PL/pgSQL `RAISE EXCEPTION` under `psql -v ON_ERROR_STOP=1`. **pgTAP is NOT installed.** (`ci.yml:878-880`) |
| SQL gate config | `.github/workflows/ci.yml:833` job `sql-tests`; discovers `supabase/tests/test_*.sql` and runs each with `psql "$TEST_SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f "$f"` (`ci.yml:1017-1032`) |
| SQL gate gating | `if: (push OR non-fork PR) AND vars.E2E_TEST_DB_CONFIGURED == 'true'`; `needs: [python]`; `concurrency: shared-test-db` (`ci.yml:879-887`) |
| SQL gate preflight | Rejects `\!`, `\copy`, `\COPY`, `\o` in any test file (`ci.yml:951-1000`) |
| TS framework | Vitest (`vitest.config.ts`), sharded, coverage-gated at 82/80/74/72 |
| TS quick run | `npx vitest run src/__tests__/<file>.test.ts` |
| TS full suite | `npm test` (add `--no-file-parallelism` if locally flaky) |
| Python framework | pytest, `asyncio_mode = auto` (`analytics-service/pytest.ini:1-4`) |
| Python quick run | `cd analytics-service && python3 -m pytest tests/test_main_worker.py -x -q` |
| Python full suite | `cd analytics-service && python3 -m pytest --cov-fail-under=80` |
| Phase gate | Full suite green + a real TEST tick inspected in `cron.job_run_details` before merge |

### Phase Requirements → Test Map

| Req | Behavior | Test type | Automated command | File |
|---|---|---|---|---|
| JOB-04 / SC#1 (detect+heal) | A backdated candidate with dailies, zero jobs, no terminal analytics gets exactly one `compute_analytics_from_csv` row with `metadata->>'source' = 'reconcile-sweep'` | SQL gate (EXECUTE deployed body) | `psql "$TEST_SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/test_reconcile_dropped_enqueue_sweep.sql` | ❌ Wave 0 |
| JOB-04 / SC#1 (alert) | Claiming a job whose `metadata.source == 'reconcile-sweep'` emits a Sentry event | pytest | `cd analytics-service && python3 -m pytest tests/test_main_worker.py -k reconcile -x` | ❌ Wave 0 |
| JOB-04 / SC#1 (alert is real) | `main_worker.main()` calls `init_sentry()` | pytest | same | ❌ Wave 0 |
| JOB-04 / SC#2 (idempotent) | Two consecutive `EXECUTE`s of the deployed body produce exactly ONE job row for the healed strategy | SQL gate | same SQL file, Part 3 | ❌ Wave 0 |
| JOB-04 / SC#2 (bound) | n+1 seeded candidates → exactly n healed on tick 1, the (n+1)-th on tick 2 | SQL gate | same SQL file, Part 4 | ❌ Wave 0 |
| JOB-04 / SC#3 (in-grace) | A candidate whose anchor is inside the grace window is untouched | SQL gate | same SQL file, Part 2 arm B | ❌ Wave 0 |
| JOB-04 / SC#3 (has a job) | A candidate with ANY `compute_jobs` row (including `failed_final` and `done`) is untouched | SQL gate | same SQL file, Part 2 arms C1/C2/C3 | ❌ Wave 0 |
| JOB-04 / SC#3 (terminal analytics) | A candidate at `complete` / `complete_with_warnings` / `failed` / `computing` is untouched | SQL gate | same SQL file, Part 2 arms D1–D4 | ❌ Wave 0 |
| JOB-04 (deployed shape) | The migration file's `$cron$` body carries `AS MATERIALIZED`, `FOR UPDATE SKIP LOCKED`, `ON CONFLICT DO NOTHING`, the grace literal, and never references a rejected anchor column | TS content gate | `npx vitest run src/__tests__/reconcile-dropped-enqueue-sweep.test.ts` | ❌ Wave 0 |
| JOB-07 (no worker-loop work) | The sweep is a cron body, not a worker tick | static | covered by the TS gate asserting `cron.schedule` + the absence of any new worker loop | ❌ Wave 0 |

### Neutering proof — what to break for each assertion

This is the standing founder rule (*"a test that CANNOT FAIL is worse than none"*): each gate must be
observed RED before being trusted. Concrete neuterings:

| Gate | Neuter | Expected RED |
|---|---|---|
| SC#1 detect | Delete the `INSERT` statement from the cron body | healed count = 0 |
| SC#1 detect (vacuity) | Delete the `$cron$` body entirely | the body-extraction assertion in the TS/pytest gate fires (never a silent pass) |
| SC#1 alert | Remove `init_sentry()` from `main()` | the `main()` test fails; **note the capture test alone will still pass** because it mocks the SDK — that is exactly why the `main()` test is separate and load-bearing |
| SC#1 alert | Change the metadata key from `source` to anything else | the pytest marker assertion fires |
| SC#2 idempotent | Change `ON CONFLICT DO NOTHING` to a bare `INSERT` | tick 2 raises `23505` (or, if the whole tick aborts, the healed count assertion fires) |
| SC#2 bound | Replace `WITH batch AS MATERIALIZED` with a bare `WITH batch AS` | n+1 of n+1 healed on tick 1 — the D-19 signature |
| SC#2 bound | Rewrite to `WHERE id IN (SELECT ... LIMIT n FOR UPDATE SKIP LOCKED)` | same; plus the TS gate's `IN\s*\(\s*SELECT[^)]*LIMIT` negative anchor fires (`20260803130000:188-190`) |
| SC#3 in-grace | Delete the grace conjunct | the in-grace arm is healed |
| SC#3 has-a-job | Scope the NOT EXISTS to `kind = 'compute_analytics_from_csv'` | the arm seeded with a `running derive_broker_dailies` job is healed |
| SC#3 terminal-analytics | Drop `'complete'` from the excluded status list | the `complete` arm is healed — **this is the mass-re-enqueue tripwire**; its failure message must say so |
| SC#3 terminal-analytics | Drop `'computing'` from the excluded list | the `computing` arm is healed — proves the non-racing split with 142's reaper |

### Sampling Rate

- **Per task commit:** `npx vitest run src/__tests__/reconcile-dropped-enqueue-sweep.test.ts` and
  `cd analytics-service && python3 -m pytest tests/test_main_worker.py -x -q`
- **Per wave merge:** `npm test` + `cd analytics-service && python3 -m pytest` + `mypy --strict`
- **Before merge (mandatory, cannot be automated in CI on a PR branch):** apply the migration to TEST
  (`qmnijlgmdhviwzwfyzlc`) via the Supabase MCP, then run the SQL gate. `supabase/migrations/**` merged to
  `main` AUTO-APPLIES to PROD (`khslejtfbuezsmvmtsdn`) with no separate deploy step.
- **Phase gate:** full suite green + one real TEST cron tick inspected via
  `SELECT d.start_time, d.status, d.return_message FROM cron.job_run_details d JOIN cron.job j ON j.jobid = d.jobid WHERE j.jobname = '<name>' ORDER BY d.start_time DESC LIMIT 50;`
  — this is the ONLY proof of L-2 (the cron role's RLS posture).

### Wave 0 Gaps

- [ ] `supabase/tests/test_reconcile_dropped_enqueue_sweep.sql` — SC#1/#2/#3
- [ ] `src/__tests__/reconcile-dropped-enqueue-sweep.test.ts` — deployed-shape anchors
- [ ] `analytics-service/tests/test_main_worker.py` — new test class for the marker capture AND for
      `main()` calling `init_sentry()`
- [ ] `analytics-service/main_worker.py` — `init_sentry()` in `main()` (**blocks the emission task**)
- [ ] No framework install needed — vitest, pytest and the `sql-tests` job all already exist.

---

## Environment Availability

| Dependency | Required by | Available | Version | Fallback |
|---|---|---|---|---|
| `pg_cron` on TEST + PROD | the sweep | ✓ (16 jobs registered across migrations) | — | none; the migration `RAISE`s if absent |
| `sentry-sdk[fastapi]` in analytics-service | worker emission | ✓ | `2.64.0` (`analytics-service/requirements.txt:222`) | — |
| `SENTRY_DSN` on the **worker** Railway service | the alert actually reaching Sentry | ✗ **UNVERIFIED** | — | none — without it `init_sentry()` returns early and SC#1 is false in prod |
| `supabase` CLI locally | applying to TEST | ✓ (`<home>/.local/bin/supabase`) | not checked | Supabase MCP |
| `psql` locally | running the SQL gate locally | ✗ | — | CI `sql-tests` job installs `postgresql-client` (`ci.yml:944-947`) |
| Supabase MCP (read-only census) | the pre-merge census | ✗ **not available in this agent session** | — | run it in the planner/executor session |
| `vars.E2E_TEST_DB_CONFIGURED` + `secrets.TEST_SUPABASE_DB_URL` | the `sql-tests` job running at all | assumed ✓ (the 142 gate runs) | — | the job silently no-ops if unset |

### ⛔ CENSUS NOT OBTAINED

**I could not run the read-only census.** The Supabase MCP tools were not present in this session's tool
set, no `psql` binary exists on this machine, and I deliberately did not go looking for database credentials.
**This is the single most important gap in this research** — CONTEXT.md flags it as strongly encouraged, and
142 set the precedent of embedding the census in the migration header (`20260802120000:92-101`).

Run this **read-only** on BOTH projects before writing the predicate, and paste the results into the
migration header:

```sql
-- (1) HEADLINE: how many rows would the sweep enqueue on its first run?
--     (grace conjunct deliberately omitted — an old candidate is past grace by definition)
SELECT count(*) AS candidates
  FROM public.strategies s
 WHERE EXISTS (SELECT 1 FROM public.csv_daily_returns d WHERE d.strategy_id = s.id)
   AND NOT EXISTS (SELECT 1 FROM public.compute_jobs cj WHERE cj.strategy_id = s.id)
   AND NOT EXISTS (
         SELECT 1 FROM public.strategy_analytics sa
          WHERE sa.strategy_id = s.id
            AND sa.computation_status IN ('computing','complete','complete_with_warnings','failed'));

-- (2) BREAKDOWN by strategies.status  -> answers Open Question Q2 (L-6)
SELECT s.status, count(*) FROM public.strategies s WHERE <same predicate> GROUP BY 1 ORDER BY 2 DESC;

-- (3) BREAKDOWN by analytics presence -> absent vs 'pending'
SELECT (sa.strategy_id IS NULL) AS analytics_absent, sa.computation_status, count(*)
  FROM public.strategies s LEFT JOIN public.strategy_analytics sa ON sa.strategy_id = s.id
 WHERE <same predicate> GROUP BY 1,2;

-- (4) COMPOSITE exposure -> answers Open Question Q1 (L-3)
SELECT count(*) FROM public.strategies s
 WHERE <same predicate>
   AND EXISTS (SELECT 1 FROM public.strategy_keys sk WHERE sk.strategy_id = s.id);

-- (5) L-2 proof: who runs the crons, and does that role bypass RLS?
SELECT j.jobname, j.username, r.rolbypassrls, r.rolsuper
  FROM cron.job j JOIN pg_roles r ON r.rolname = j.username ORDER BY 1;

-- (6) slot check: existing schedules, so the new cadence does not collide
SELECT jobid, jobname, schedule, active FROM cron.job ORDER BY jobname;
```

Projects: TEST `qmnijlgmdhviwzwfyzlc`, PROD `khslejtfbuezsmvmtsdn`.
For scale calibration: at 2026-08-02 TEST held **7,371** `strategy_analytics` rows and PROD held **39**
(`20260802120000:92-96`). PROD's candidate count is therefore likely single-digit; TEST's could be large,
which is what makes the LIMIT choice matter.

**If (1) returns a large number on PROD, STOP and escalate before merging** — merging auto-applies, and the
first tick would enqueue that many jobs.

---

## Security Domain

`security_enforcement` is not present in `.planning/config.json`, so treat as enabled.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard control in this phase |
|---|---|---|
| V2 Authentication | no | The sweep is a cron body; no user auth path is touched. |
| V3 Session Management | no | — |
| V4 Access Control | **yes** | No new callable SQL surface, so no new EXECUTE grant and no privilege-escalation surface. `compute_jobs` RLS/grants are NOT modified (L-2 is a *question about* the existing posture, not a change to it). The `20260516170100` incident class — a caller-supplied `INTERVAL` on a cross-tenant SECDEF function — is avoided by construction: the interval is a fixed literal inside the cron body. |
| V5 Input Validation | **yes** | The cron body is a FIXED LITERAL: no interpolation, no `EXECUTE format(...)`, no dynamic SQL, schema-qualified to `public.*` so resolution is independent of the cron session `search_path` (`20260802120000:452-455`). |
| V6 Cryptography | no | — |
| V7 Error Handling / Logging | **yes** | `RAISE NOTICE` → `cron.job_run_details.return_message` must carry no row data or identifiers. The Sentry capture must not leak PII — `init_sentry()` sets `send_default_pii=False` and installs `_redact_before_send` (`sentry_init.py:356-362`). Pass `strategy_id` (a UUID, already used in the csv-finalize captures), never user email or CSV contents. |

### Known Threat Patterns

| Pattern | STRIDE | Mitigation |
|---|---|---|
| Cross-tenant mass mutation from a scheduled job | Tampering / DoS | Bounded MATERIALIZED batch + `FOR UPDATE SKIP LOCKED` + the terminal-analytics conjunct. The mass-re-enqueue tripwire is pinned by a test whose failure message names the incident. |
| Caller-suppliable threshold on a SECDEF reaper | Elevation of Privilege | Not applicable — no function is created. Pre-documented in the header per `20260802120000:115-120`. |
| Secret in a world-readable migration | Information Disclosure | ⚠️ **The repo is PUBLIC and `.planning/` is TRACKED.** No DSN, no connection string, no credential may appear in the migration, the gate, or this research file. The census SQL above contains none. Run a no-allowlist gitleaks scan before push (the allowlist is path-based over `.planning/`). |
| Silent alerting failure | Repudiation | L-1: `init_sentry()` must be wired AND `SENTRY_DSN` verified on the worker service. A test that only mocks the SDK does not prove the channel works. |
| psql meta-command exfiltration from a test file | Information Disclosure | `ci.yml:951-1000` preflight rejects `\!`, `\copy`, `\COPY`, `\o`. Do not use them. |

---

## State of the Art

| Old approach | Current approach | When changed | Impact |
|---|---|---|---|
| `WHERE id IN (SELECT ... LIMIT n FOR UPDATE SKIP LOCKED)` | `WITH batch AS MATERIALIZED (... LIMIT n FOR UPDATE SKIP LOCKED)` | 2026-08-03, `20260803130000` (D-19) | The LIMIT is real. Measured: 26/26 → 25/26. |
| Bare `WITH` CTE as an optimization fence | Requires the explicit `MATERIALIZED` keyword | PostgreSQL 12 | A bare `WITH` referenced once is inlined; the fence disappears. |
| Reaper keyed on `computed_at` / `updated_at` | Dedicated writer-stamped `computing_started_at` | Phase 106 revert → Phase 142 (`20260802120000`) | The Phase 106 janitor was REVERTED for this. Any new time-keyed janitor must argue its anchor. |
| Cross-tenant neutralizing `UPDATE`s in SQL gates | Isolation by construction (century-old seeds + identity-scoped assertions) | Phase 142.1 D-05/D-18 | Gates no longer mutate other PRs' rows on the shared TEST project. |
| Separate `sql-tests` concurrency group | Shared `shared-test-db` group + `needs: [python]` | Phase 142.1 D-05 (`ci.yml:879-901`) | Prevents a three-member group evicting a pending job into a grey (non-blocking) check. |
| `retention_compute_jobs_failed` keyed on `created_at` | Keyed on `COALESCE(next_attempt_at, created_at)` | `20260515210200` (H-0921) | A `failed_retry` row in slow-burn recovery is no longer reaped mid-recovery. |

**Deprecated / superseded — do NOT copy from these:**
- `20260411144407:179` — the ORIGINAL `compute_jobs_one_inflight_per_kind_strategy` (DROPped at
  `20260416125430:154`).
- `20260417110539:268-310` and `20260515113853:203-213` — superseded `retention_compute_jobs_failed` bodies.
- `compute_analytics` as a job kind — retired at the RPC (`20260716090000:83-86`); the registry and CHECKs
  still admit it only because 45 historical PROD rows FK-reference it.

---

## Assumptions Log

| # | Claim | Section | Risk if wrong |
|---|---|---|---|
| A1 | Supabase's pg_cron default `cron.max_running_jobs` is 32 and 16 registered jobs is not near any cap | §8 | LOW — the sweep silently never runs. Detectable in `cron.job_run_details`; the pre-merge tick inspection catches it. |
| A2 | The pg_cron job role bypasses RLS on `compute_jobs` (inferred from `retention_compute_jobs_orphaned_running` demonstrably deleting rows in PROD) | L-2 | **HIGH** — the sweep silently inserts zero rows forever and every CI gate stays green (the gate runs as the psql user, not the cron role). Census query (5) + a real TEST tick resolve it. |
| A3 | `SENTRY_DSN` is set on the analytics-service **worker** Railway service | L-1 | **HIGH** — SC#1 is false in production while unit tests pass. Verify in the Railway dashboard/MCP. |
| A4 | `StarletteIntegration()` / `FastApiIntegration()` are harmless in a non-ASGI process on sentry-sdk 2.64.0 | L-1 | MEDIUM — worker startup could warn or (worst case) fail. A local `python -m main_worker` smoke run with a DSN set proves it. |
| A5 | A composite strategy is identified by rows in `public.strategy_keys` | L-3 | MEDIUM — a wrong predicate either fails to exclude composites (headline corruption risk) or over-excludes real candidates. I did not read `20260710120000_strategy_keys.sql`. **Planner must pin this.** |
| A6 | `csv_daily_returns.created_at` is the right grace anchor | L-4 | MEDIUM — a wrong anchor is the Phase 106 revert class. The reasoning is sound but the alternative-column argument has not been stress-tested against a reviewer. |
| A7 | `migration-drift-check.yml`, `sql-function-snapshot.yml` and `supabase-migrate.yml` impose no additional constraints on a cron-only migration | L-8 | LOW — a red CI check on the PR, immediately visible. |
| A8 | No `csv_daily_returns` index on `created_at` is needed at PROD scale (39 analytics rows) | L-4 | LOW on PROD, MEDIUM on TEST (7,371 rows) — a slow cron tick, visible in `cron.job_run_details`. |

---

## Open Questions (RESOLVED)

> All six were discharged during planning (2026-08-16). Each carries a `RESOLVED:` pointer to the
> plan decision that adopted it. Read the pointer, not the recommendation — the recommendation is
> what research proposed, the pointer is what the plan actually committed to.

1. **Do composites get excluded, or does the sweep branch the kind?** (L-3)
   - What we know: composites write `csv_daily_returns`, are chain-terminal, and `compute_analytics_from_csv`
     on a composite applies divergent single-key semantics that the composite handler explicitly abandoned
     (`job_worker.py:6808-6822`).
   - What's unclear: how many composites are actually in the candidate population (census query 4), and the
     exact composite-detection predicate (A5).
   - Recommendation: **exclude**, document as a second known non-coverage alongside the wizard first-hop
     drop, and file to TODOS.md. Reconsider only if the census shows a meaningful composite population.
   - **RESOLVED: DX-01 (143-02).** Excluded via `NOT EXISTS strategy_keys`; `api_key_id IS NULL` rejected as a discriminator because CSV single-key strategies also have it NULL. Non-coverage documented in the migration header + TODOS.md; pinned by SQL gate arm E and its neuter.

2. **Does `strategies.status` gate the sweep, and if so which values?** (L-6)
   - What we know: five values; no soft-delete column; `archived` is wasted work; `draft` may be the
     population the phase exists to heal.
   - What's unclear: the actual distribution — census query (2).
   - Recommendation: exclude `archived` only; include `draft`; decide from the census, not from reasoning,
     and put the counts in the header.
   - **RESOLVED: DX-02 (143-02).** Exclude `archived` only; `draft` INCLUDED. Census breakdown lands in the migration header as evidence.

3. **Grace anchor: `MAX(csv_daily_returns.created_at)` — is it defensible under review?** (L-4, A6)
   - What we know: it is directly writable (so the gate can backdate it), never re-stamped by a writer, and
     semantically the right event.
   - What's unclear: whether a reviewer finds a fourth candidate I did not consider.
   - Recommendation: write the full four-way rejection argument in the header (142's `:76-101` is the
     standard) and let `migration-reviewer` attack it.
   - **RESOLVED: DX-03 (143-02).** `MAX(csv_daily_returns.created_at)` adopted, with the four-way rejection argument in the header (the Phase-106 wrong-timestamp lesson). Query driven from `strategies` with the grace conjunct LAST; no new index.

4. **`LIMIT` value.** 142 uses 25 at `*/15` (100 rows/hour). At `0 * * * *` a LIMIT of 25 drains 25/hour.
   - What's unclear: the TEST candidate count (census 1). If TEST holds hundreds, the SQL gate's
     "n+1 seeded, n healed" assertion needs n small enough to seed cheaply but the production LIMIT may want
     to be larger.
   - Recommendation: pick the LIMIT from the census, and note that the gate's `n` need not equal the
     production LIMIT as long as the gate seeds `LIMIT + 1`.
   - **RESOLVED: DX-04 (143-02).** LIMIT 25, matching 142's bound; census sanity-checks it before the migration is authored.

5. **Cadence minute.** `0 * * * *` collides with `audit_log_hot_to_cold` (`0 3 * * *`) and coincides with
   the reaper's `:00` tick every hour.
   - Recommendation: `35 * * * *` — clear of every registered slot (`:00`, `:10`, `:15`, `:20`, `:30`) and
     off the reaper's quarter-hour grid. Restate the "post-threshold detection latency" honesty note either way.
   - **RESOLVED: DX-05 (143-02).** `35 * * * *` — hourly preserved per the locked decision, minute moved off `:00` to clear 142's reaper grid and `audit_log_hot_to_cold`.

6. **UNVERIFIED: `.github/workflows/migration-drift-check.yml` and `sql-function-snapshot.yml`.** I did not
   read these. `sql-function-snapshot` in particular may expect a snapshot refresh when SQL objects change —
   though this migration creates no function, so it is likely a no-op. The planner should read both.
   - **RESOLVED: 143-02 Task 1.** Both workflows are read as an explicit planned step before the migration is authored; findings feed the drift-gate design rather than remaining an assumption.

---

## Sources

### Primary (HIGH confidence) — read directly this session

| Path | What was read |
|---|---|
| `supabase/migrations/20260802120000_strategy_analytics_stuck_computing_reaper.sql` | full file (690 lines) — the template |
| `supabase/migrations/20260803130000_reaper_limit_bound_materialized_cte.sql` | full file (213 lines) — the LIMIT fence |
| `supabase/migrations/20260416125430_contact_request_metadata.sql` | :140-180 — current index def |
| `supabase/migrations/20260411144407_compute_jobs_queue.sql` | :1-200, :233-266 — table DDL, RLS, trigger |
| `supabase/migrations/20260716090000_retire_compute_analytics_kind_rpc_guard.sql` | full file — both `_enqueue_compute_job_internal` overloads |
| `supabase/migrations/20260515210300_scoring_weight_overrides_high_hardening.sql` | :230-340 — `enqueue_compute_job` wrapper + grants |
| `supabase/migrations/20260516131500_compute_jobs_residual_apply.sql` | :185-250 — `_assert_owner` |
| `supabase/migrations/20260516104201_compute_jobs_audit_2026_05_07_residual.sql` | :190-230 — FORCE RLS + REVOKEs |
| `supabase/migrations/20260517233529…`→`20260717233529_allocator_equity_derived_surface.sql` | :160-200 — current kind/target coherence CHECK |
| `supabase/migrations/20260522111839_csv_daily_returns.sql` | :1-90 — table DDL + RLS |
| `supabase/migrations/20260624120000_csv_daily_returns_per_key_axis.sql` | :40-75 — xor + unique indexes |
| `supabase/migrations/20260602120000_..._add_complete_with_warnings.sql` | :30-70 — computation_status CHECK |
| `supabase/migrations/20260405061911_initial_schema.sql` | :40-90 — `strategies` + `strategy_analytics` DDL |
| `supabase/migrations/20260716130000_strategies_status_private.sql` | :1-64 — status CHECK widening |
| `supabase/migrations/20260515113853_retention_crons_safe.sql` | :180-235 — `retention_compute_jobs_done` body |
| `supabase/migrations/20260515210200_retention_crons_high_hardening.sql` | :150-270 — `retention_compute_jobs_failed` body |
| `supabase/migrations/20260719120000_retention_orphaned_running_compute_jobs.sql` | full file — the pg_cron-writes-compute_jobs precedent |
| `supabase/migrations/20260428120836_compute_jobs_priority.sql` | :50-60 — priority column |
| `supabase/tests/test_strategy_analytics_stuck_computing_reaper.sql` | :1-460 + part map — the gate model |
| `.github/workflows/ci.yml` | :825-1035 — the `sql-tests` job |
| `analytics-service/main_worker.py` | :1-145, :587-680, :955-999 — ClaimedJob, dispatch_tick, main() |
| `analytics-service/services/job_worker.py` | :505-565, :4700-4760, :5190-5210, :6760-6830 — chain map, dailies writes, composite |
| `analytics-service/sentry_init.py` | :330-400 — `init_sentry()` |
| `analytics-service/main.py` | :180-215 — the capture idiom |
| `analytics-service/tests/test_main_worker.py` | :2194-2320 — the drift-gate pattern |
| `analytics-service/pytest.ini`, `requirements.txt:222` | config + sentry-sdk version |
| `src/app/api/strategies/csv-finalize/route.ts` | :780-870 — the `after()` hole |
| `src/__tests__/compute-jobs-kind-check-csv-2026-05-25.test.ts` | :1-60 — TS content-gate idiom |
| `.claude/agents/migration-reviewer.md` | header + invariant index (21 invariants) |
| `.claude/agents/rls-policy-auditor.md` | :1-30 — scope + BYPASSRLS section |
| `.planning/REQUIREMENTS.md` | :51-58, :1402-1409 — JOB-01..08 + phase mapping |
| `.planning/STATE.md` | grep of `142` / `JOB-0` — phase-142 history |
| `.planning/config.json` | full — `nyquist_validation: true` |

### Secondary (MEDIUM confidence)
- `.planning/phases/143-.../143-CONTEXT.md` — locked decisions (verified against source, five citation
  corrections noted).

### Tertiary (LOW confidence)
- pg_cron `cron.max_running_jobs` default on Supabase — training knowledge, not verified (A1).
- sentry-sdk 2.64.0 behavior of ASGI integrations in a non-ASGI process — training knowledge (A4).

**No external package research was required. This phase installs zero new dependencies**, so the
`## Package Legitimacy Audit` section is omitted per its own "required whenever this phase installs external
packages" condition. `sentry-sdk[fastapi]==2.64.0` is an already-declared, already-installed dependency
(`analytics-service/requirements.txt:222`); this phase adds no new import of it beyond a module already in
the project's dependency tree.

---

## Metadata

**Confidence breakdown:**
- In-repo object inventory (§1–§10): **HIGH** — every value quoted verbatim from a file read this session,
  with `file:line`. All five CONTEXT.md citations were independently re-derived; four confirmed, one
  (retention crons) corrected to the deployed body.
- Architecture patterns / template: **HIGH** — both template migrations read in full.
- Landmines L-1, L-3: **HIGH** — direct source evidence, and both contradict CONTEXT.md assumptions.
- Landmine L-2 (RLS): **MEDIUM** — strong empirical inference from a sibling cron, not a measurement.
- Landmine L-4 (grace anchor): **MEDIUM** — the recommendation is reasoned, not measured.
- Census: **NOT OBTAINED** — see `## Environment Availability`.
- Validation architecture: **HIGH** — the CI job, its gating, its concurrency group and the gate idioms were
  all read directly.

**Research date:** 2026-08-16
**Valid until:** 2026-09-15 (30 days — the codebase is the sole dependency and it moves fast; re-verify
`compute_jobs_one_inflight_per_kind_strategy`, the retention cron bodies, and the `sql-tests` job gating if
any migration lands in the interim).
