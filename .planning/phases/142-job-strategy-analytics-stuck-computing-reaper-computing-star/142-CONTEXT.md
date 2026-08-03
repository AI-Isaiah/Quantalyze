# Phase 142: JOB — strategy_analytics stuck-computing reaper + computing_started_at DDL - Context

**Gathered:** 2026-08-02
**Revised:** 2026-08-02 — post-research correction pass (see banner below)
**Status:** Ready for planning
**Mode:** Smart discuss (autonomous) — proposals auto-accepted per standing founder policy (decide autonomously; no blocking either/ors mid-campaign)

> ⚠️ **Post-research correction (2026-08-02).** `142-RESEARCH.md` §Collisions C-1..C-7 falsified
> several coordinates and one locked decision in the first draft of this file. Per Rule 7 (surface
> conflicts, pick the better-evidenced side — never blend), the research wins and the affected
> decisions below have been **rewritten in place**. The corrections were:
> **C-1** `strategy_analytics` has **no `updated_at` column** — the backfill anchor is `computed_at`.
> **C-2** `computed_at` is wrong in *both* directions (SQL bridge re-stamps it `now()`; the Python
> upsert omits it so it keeps the prior `complete`'s value) — which is what makes SC#2 falsifiable.
> **C-3** the SQL writer is `PERFORM`ed on *every* job transition, so an unconditional stamp
> re-implements the 106-janitor bug in a new column.
> **C-4** two of the three writer coordinates named here were wrong (`portfolio.py:652` is a
> `portfolio_analytics` writer; `job_worker.py:1853` is a comment).
> **C-5** the "superseded" one-off script is **broken code** (42703), not a reference implementation.
> **C-6** the formula `batch_size × max_per_kind_timeout` *is* the `compute_jobs` formula — copying
> the formula is the same mistake as copying the number, one level up.
> Two decisions were also **added** from research (`computation_warned` clearing; the dropped Sentry
> claim), and one **withdrawn** (the live-poll rescue claim).

<domain>
## Phase Boundary

Deliver the `strategy_analytics` stuck-`computing` janitor and the DDL it keys on:

- **IN:** a new `strategy_analytics.computing_started_at` column, writer-side stamping in the
  same statement that sets `computation_status='computing'`, a recurring **pg_cron** reaper that
  transitions stranded rows to a terminal `failed` with a user-recoverable message, a threshold
  re-derived from `strategy_analytics`'s own batch-tail math, a CI invariant that fails when any
  handler's batch-inclusive worst case exceeds that threshold, and the JOB-07 regression proving
  no janitor work touches the worker's shared asyncio event loop.
- **OUT:** the `compute_jobs.status='running'` purge (JOB-05 → Phase 144 — a *distinct*
  mechanism on a distinct table, per requirements Decision #1); dropped-enqueue reconciliation
  and re-enqueue (JOB-04 → Phase 143); csv-finalize atomicity (JOB-06 → Phase 145).

Requirements covered: **JOB-01, JOB-02, JOB-03, JOB-07**.

</domain>

<decisions>
## Implementation Decisions

### Reaper mechanism & scheduling
- The reaper runs as a **pg_cron-scheduled SQL function**. JOB-07 forbids heavy janitor work on
  the worker's shared asyncio event loop; pg_cron satisfies that constraint *by construction*
  rather than by discipline.
- Cadence: **every 15 minutes** — bounds how long a user stares at a spinner without hammering
  the DB. (Distinct from Phase 144's `compute_jobs` cadence; do not couple them.)
- Delivered as a **NEW migration**, layered independently of
  `20260720120000_retention_orphaned_running_window_4h.sql`. Requirements Decision #1: the two
  janitors are two distinct mechanisms; neither implies the other.
- Each run is **bounded** — an explicit `LIMIT` with deterministic ordering — so a large backlog
  cannot blow the cron slot or hold locks for an unbounded window.

### `computing_started_at` DDL & writer stamping
- Column shape: **`timestamptz`, nullable, no default.** NULL means "not currently computing".
  A `NOT NULL DEFAULT now()` would be a 23502 timebomb against existing writers.
- **One-time backfill at migration time**, inside the migration and *before* `cron.schedule`, for
  rows currently at `computation_status='computing'`: stamp `computing_started_at` from
  **`computed_at`** (C-1 — there is no `updated_at` on this table). Without it, every already-stranded
  prod row has a NULL stamp and is skipped forever. This is a **one-shot anchor only**: the migration
  header must state that `computed_at` is acceptable here and never as the ongoing key, and say why
  (C-2 — the SQL bridge re-stamps it `now()` on every hop ⇒ never reap; the Python upsert omits it
  ⇒ it holds the prior `complete`'s value ⇒ reap immediately. Both wrong, in opposite directions).
- Enforcement is **static, not runtime**: every writer that sets
  `computation_status='computing'` also sets `computing_started_at` in the *same*
  statement/transaction, and a **CI invariant** fails if any such write site lacks the co-located
  stamp. A runtime `CHECK` constraint is rejected — a missed writer would surface as a 23514 on
  the live money path instead of a red build. The invariant must cover **both** the Python and the
  SQL writer; a Python-only gate is a false pass (research P-11).
- **The writer set is exactly two** (C-4 — audited census supersedes this file's first draft):
  1. `analytics-service/services/analytics_runner.py:1227-1232` — the Python `.upsert(...)`.
  2. `sync_strategy_analytics_status` branch (a) — a **SQL function**, latest definition
     `supabase/migrations/20260710150000:113-125`. Re-base on that definition before any
     `CREATE OR REPLACE`.
  (`routers/portfolio.py:652` writes `portfolio_analytics` — different table. `job_worker.py:1853`
  is a comment.)
- **The SQL writer must stamp conditionally, not unconditionally** (C-3). It is `PERFORM`ed in-RPC by
  `mark_compute_job_done`/`_failed` on *every* job transition, so `computing_started_at = now()` in
  that `ON CONFLICT DO UPDATE` would reset the stamp on every hop of a multi-hop chain — the
  106-janitor bug re-implemented in a new column, and it would still pass a naive "the writer sets the
  stamp" gate. Stamp only on the **transition into** `computing`, keyed off the **resolved** status
  (branch (a) can resolve to `complete_with_warnings`). The CI invariant must be written so that an
  unconditional stamp **fails** it.
- `computing_started_at` is **cleared to NULL** when a row leaves `computing` (to `complete`,
  `complete_with_warnings`, or `failed`), so a stale stamp can never re-trigger the reaper. The
  reaper is itself an exit transition and must obey this in its own UPDATE.
- A `computing` row with a **NULL** stamp is a writer bug, not a stranded job: the reaper **skips
  it**, never reaps it. **Detection is the static CI stamp invariant, not a runtime alert** — pg_cron
  has no Sentry path in this repo, and claiming an alert that does not exist is the SEAMUX-08 defect
  class this milestone spent two phases closing. Do not build a cron→Sentry bridge for this. If
  planning finds an *already-shipped* cron alerting path, it may use it; otherwise the guarantee is
  the build-time gate plus the migration backfill, which empties the legacy NULL population.

### Terminal state & user-facing message
- Terminal status is **`failed`** — JOB-02 names it. No new enum value.
- The message column is **`computation_error`** (confirmed writer → poller → render:
  `useStrategySyncPoller.ts:199-231` → `SyncPreviewStep.tsx:890-908` → `wizardErrors.ts:1457-1463`).
  It is appended as a `Details: …` line under the already-shipped `GATE_ANALYTICS_FAILED` copy,
  which **already** carries our-fault attribution ("The fault is in our pipeline, not at your
  exchange") — so the reaper's string must not duplicate, contradict, or re-attribute that
  sentence, and must make no claim about how much prior work completed (the SEAMUX-04 B-16/C-02
  rule). Short, e.g. *"Analytics was interrupted before it could finish and did not recover. Retry
  the sync."* Do **not** reuse the one-off script's "during platform upgrade" — a false, dated cause.
- **The same UPDATE must also set `computation_warned = FALSE`** (research P-4). Every other
  terminal-`failed` writer in the repo does this; the one-off script does not. Skipping it lets the
  status bridge launder the reap into `complete_with_warnings` — turning a spinner into a **false
  success on a money surface**, strictly worse than the bug being fixed.
- The reaper **terminalizes only — it never re-enqueues.** Re-enqueue is JOB-04, Phase 143.
  Keeping that out here preserves the phase boundary and avoids two mechanisms racing the same row.
- The recovery affordance is **already shipped and non-destructive**: `GATE_ANALYTICS_FAILED`
  carries `clear_and_retry`, so `SyncPreviewStep.tsx:1655-1680` already renders a retry.
  **Verify this; do not rebuild it.** No frontend work is in scope.
- **Do not claim the live-poll rescue.** `SyncPreviewStep.tsx:112` already escalates a live wizard
  session at `RETRY_THRESHOLD_MS = 900_000` (15 min). With a threshold in the hours this reaper does
  not rescue a live poll — its value is the **page-refresh / return-later** path and the factsheet
  surface, which is exactly what the ROADMAP criterion says. Plans and prose must not overclaim.
- `analytics-service/scripts/reset_stuck_computing_rows.py` is **deleted** in this phase. It is not a
  working reference — it selects and filters on `updated_at`, a column that does not exist, so it
  raises 42703 under PostgREST (C-5). Nothing imports it; no test covers it. Its *semantics* (how it
  defines "no active `compute_jobs` row") are still the right reference and should be carried into
  the SQL predicate.

### Threshold derivation + JOB-07 proof
- The staleness threshold is **re-derived**, and the formula named in JOB-03 and in this file's first
  draft — `batch_size × max_per_kind_timeout` — is **itself the `compute_jobs` formula** (verbatim
  from `20260720120000:24-25`) and must NOT be re-applied (C-6). It bounds how long *one claimed job*
  may sit `running`; a `strategy_analytics` row is `computing` for a whole multi-hop chain, a strictly
  larger quantity. Copying the formula is the same mistake as copying the number, one level up.
- **The `NOT EXISTS (active compute_jobs)` conjunct carries the safety; the interval is a debounce.**
  A healthy in-flight chain always has a non-terminal `compute_jobs` row (each follow-on is enqueued
  *inside* the parent handler before it returns DONE). So the threshold should be derived as the
  **maximum legitimate gap during which a row can be `computing` with zero active `compute_jobs`
  rows**, plus margin — enumerating the real generators of that gap (notably `long_fetch.py:585-600`,
  which logs but does not write `failed`, and the daily orphan purge of C-7).
- **Single source of truth:** the Python-side constant is canonical. The migration carries the
  derived literal with a comment naming its source, and a test asserts the SQL literal equals the
  Python-derived value — so drift between the two fails CI rather than silently mis-reaping.
- The CI invariant lives **beside `test_every_kind_has_watchdog_headroom`** in
  `analytics-service/tests/test_main_worker.py:~1020`, mirroring its structure. It must compute the
  **chain-inclusive** ceiling, not `batch_size × max(TIMEOUT_PER_KIND)`. The chain topology (which
  kind enqueues which) is lifted into a **named module-level constant** so the test reads it rather
  than re-deriving it — otherwise the oracle is self-referential and cannot fail when the expression
  is wrong (Rule 9; the money-math oracle lesson).
- **JOB-07's naive test cannot fail** and must not be written as one: because the reaper is pg_cron,
  there is no worker-loop code path to stall, so "drive a backlog, assert healthz" passes trivially
  and forever. The real gate is **structural** — an AST/static check that no reaper or sweep work is
  scheduled onto the worker's shared event loop — **plus a positive control** proving the check fires
  when the property is violated. Mirror `analytics-service/tests/test_worker_isolation_e2e.py:119,182`.
  A test that cannot fail is not evidence.

### Migration conventions (conflict resolved)
- `.claude/agents/migration-reviewer.md` invariant #14 forbids `BEGIN`/`COMMIT` in migrations, but
  **150 of 231 migrations in this repo use them, including the newest**. Per Rule 11 (conformance
  over taste inside the codebase) and Rule 7 (pick one, don't blend), **follow the repo convention**
  and pre-document the deviation in the migration header so review does not re-litigate it. Surface
  the reviewer-doc staleness as a backlog item; do not fix it here.
- Every other `migration-reviewer` / `rls-policy-auditor` invariant still applies — in particular the
  timestamp-prefix convention, SECURITY DEFINER `search_path` pinning, no caller-controlled threshold
  parameter on a SECDEF function (research P-5), and a bounded UPDATE (P-6).
- The threshold must **not** be exposed as a caller-supplied argument on a SECURITY DEFINER function.

### Claude's Discretion
- Exact `LIMIT` size, cron expression/cadence syntax, function naming, and SECURITY DEFINER vs.
  invoker — subject to the migration invariants above.
- The exact `computation_error` wording, within the constraints already fixed above.
- The precise numeric threshold, given the derivation method is fixed above.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `supabase/migrations/20260720120000_retention_orphaned_running_window_4h.sql` and
  `20260719120000_retention_orphaned_running_compute_jobs.sql` — the established pg_cron
  retention/janitor migration shape in this repo.
- `analytics-service/tests/test_main_worker.py::TestWatchdogInvariant::test_every_kind_has_watchdog_headroom`
  (line ~1020) — the invariant JOB-03 explicitly says to mirror; `main_worker.py:203,215` carry
  the pointers and the strictly-greater rationale.
- `analytics-service/tests/test_job_worker_csv_kind.py:109` re-asserts the same headroom
  invariant — a second consumer to keep consistent.
- `analytics-service/scripts/reset_stuck_computing_rows.py` — the one-off being **deleted**. Its
  *semantics* (how it defines "no active `compute_jobs` row") are the reference; its *code* is
  broken (42703 on a non-existent `updated_at`) and must not be copied.

### Established Patterns
- `computation_status` is written through `ComputationStatus.*` enum members on the Python side,
  not bare strings.
- `analytics-service/routers/cron.py:840-960` contains an orphan-`computing` reap for the
  **`portfolio_analytics`** surface — prior art for the semantics on a *different table*. Do not
  create a second divergent implementation, and do not assume it covers `strategy_analytics`.
- pg_cron is the project's standing mechanism for recurring DB maintenance (`cron.schedule` across
  six migrations). The house shape is documented in `142-RESEARCH.md` §pg_cron Migration Pattern —
  prose header with cited evidence, `SET lock_timeout`, a `DO $$` block that RAISEs if `pg_cron` is
  absent (fail loud, never a silent skip), and an idempotency note.

### Integration Points
- New DDL + pg_cron job: `supabase/migrations/`. ⚠️ Merging `supabase/migrations/**` to `main`
  **auto-applies to PROD** — apply to the TEST project (`qmnijlgmdhviwzwfyzlc`) via MCP before merge,
  and re-verify the writer census immediately before authoring the migration.
- Writer stamping: `services/analytics_runner.py` (Python) **and** the
  `sync_strategy_analytics_status` SQL function (re-base on `20260710150000:113-125`).
- CI invariant + JOB-07 structural gate: `analytics-service/tests/`. Note the harness constraints —
  pytest must run from `analytics-service/`; SQL/RLS gates only run in CI as
  `supabase/tests/test_*.sql`; `*_live.py` and `skipIf` vitest never run in CI.
- Consumer of the terminal state: `useStrategySyncPoller.ts` → `SyncPreviewStep.tsx` (retry already
  shipped) and the factsheet/PDF routes that gate on `computation_status`.

### Known coupling
- Phase 144's `retention_compute_jobs_orphaned_running` **DELETE** is today's dominant *generator*
  of the reapable condition (C-7): after it deletes the orphan, the strategy has
  `computation_status='computing'` and zero `compute_jobs` rows — exactly the JOB-02 predicate.
  Phase 144's DELETE→terminal-UPDATE change will **not** heal those rows by itself (the cron UPDATE
  does not call `sync_strategy_analytics_status`), so this reaper remains required after 144 lands.

</code_context>

<specifics>
## Specific Ideas

- The 106-janitor revert is the governing cautionary tale: `computed_at` is the WRONG ongoing key.
  This phase exists partly to add the dedicated `computing_started_at` that revert said was required.
- SC #2 is a *falsification* criterion, not a description. Since there is no `updated_at`, read it
  against `computed_at`: the tests must include a row with fresh `computed_at` + old
  `computing_started_at` (**reaped**) and a row with old `computed_at` + fresh
  `computing_started_at` (**not reaped**). Both directions, or the test cannot fail when the key is
  wrong. Research C-2 shows both directions are *live* today, so both are real regressions, not
  hypotheticals.
- One more falsification the plan should carry: an **unconditional** stamp in the SQL bridge must
  make a test go red. That is the C-3 trap, and a naive "the writer sets the stamp" gate passes it.
- Per project testing policy, oracles must pin the *invariant*, not the implementation's own
  formula — a threshold test that recomputes the impl's expression cannot fail when the
  expression is wrong.

</specifics>

<deferred>
## Deferred Ideas

- `compute_jobs` orphaned-`running` DELETE→terminal UPDATE + cadence (JOB-05) — Phase 144. The
  standing TEST-DELETE / PROD-reset split is resolved there, not here.
- Dropped-enqueue reconciliation sweep and idempotent re-enqueue (JOB-04) — Phase 143.
- csv-finalize atomicity, and the reproduce-first 42501 gate (JOB-06) — Phase 145.
- Any consolidation of the `portfolio_analytics` orphan reap in `routers/cron.py` with this new
  `strategy_analytics` reaper — noted as a possible future de-duplication, out of scope here.

</deferred>
