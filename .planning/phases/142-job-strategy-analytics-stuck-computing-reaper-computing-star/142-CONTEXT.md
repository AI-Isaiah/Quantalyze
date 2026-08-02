# Phase 142: JOB — strategy_analytics stuck-computing reaper + computing_started_at DDL - Context

**Gathered:** 2026-08-02
**Status:** Ready for planning
**Mode:** Smart discuss (autonomous) — proposals auto-accepted per standing founder policy (decide autonomously; no blocking either/ors mid-campaign)

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
- **One-time backfill at migration time** for rows *currently* sitting at
  `computation_status='computing'` (stamp from `updated_at`), so rows already stranded in prod
  become reapable. Explicitly a migration-only backfill, not an ongoing fallback — the reaper
  itself must never read `updated_at`/`computed_at` (the exact mistake that forced the
  106-janitor revert).
- Enforcement is **static, not runtime**: every writer that sets
  `computation_status='computing'` also sets `computing_started_at` in the *same*
  statement/transaction, and a **CI invariant** fails if any such write site lacks the co-located
  stamp. A runtime `CHECK` constraint is rejected — a missed writer would surface as a 23514 on
  the live money path instead of a red build.
- Known writer sites to cover (grep-verified starting set; planning must re-grep for
  completeness): `analytics-service/services/analytics_runner.py:~1229`,
  `analytics-service/routers/portfolio.py:~652`, `analytics-service/services/job_worker.py:~1853`.
- `computing_started_at` is **cleared to NULL** when a row leaves `computing` (to `complete` or
  `failed`), so a stale stamp can never re-trigger the reaper.
- A `computing` row with a **NULL** stamp is a writer bug, not a stranded job: the reaper
  **skips it and emits a Sentry warning**. Fail loud, but never destructively reap a job that may
  have started seconds ago.

### Terminal state & user-facing message
- Terminal status is **`failed`** — JOB-02 names it. No new enum value.
- The message is **our-fault attribution with a retry path**, following the copy standard settled
  in 140.3/140.5: never attribute our own janitor's action to the user or their venue. Planning
  must confirm the exact column the runner already writes failure messages into and reuse it
  rather than inventing a field.
- The reaper **terminalizes only — it never re-enqueues.** Re-enqueue is JOB-04, Phase 143.
  Keeping that out here preserves the phase boundary and avoids two mechanisms racing the same row.
- The surfaced recovery affordance is **non-destructive** (retry), per the 140.4 decision that a
  destructive control is never offered as the way forward.
- Supersedes `analytics-service/scripts/reset_stuck_computing_rows.py` — the one-off script's
  disposition (delete vs. mark superseded) is planning's call, but it must not remain as a second,
  divergent implementation of the same reap.

### Threshold derivation + JOB-07 proof
- The staleness threshold is **re-derived from `strategy_analytics`'s own batch-tail math**
  (`batch_size × max_per_kind_timeout`). The `compute_jobs` 4h number is **not** copied — JOB-03
  makes that explicit.
- **Single source of truth:** the Python-side constant is canonical. The migration carries the
  derived literal with a comment naming its source, and a test asserts the SQL literal equals the
  Python-derived value — so drift between the two fails CI rather than silently mis-reaping.
- The CI invariant lives **beside `test_every_kind_has_watchdog_headroom`** in
  `analytics-service/tests/test_main_worker.py:~1020`, mirroring its structure: it fails if any
  relevant handler's batch-inclusive worst case exceeds the reaper threshold.
- The JOB-07 regression drives a **large synthetic backlog** and asserts worker `healthz` stays
  inside `STALE_THRESHOLD` — the WEDGE-01 crash class this janitor exists to clean up after.

### Claude's Discretion
- Exact `LIMIT` size, cron expression syntax, function naming, and SQL structure
  (SECURITY DEFINER vs. invoker) — subject to the project's migration invariants.
- The precise error-message column and copy wording, confirmed against the existing failure path.
- Whether the superseded one-off script is deleted or retained with a superseded header.

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
- `analytics-service/scripts/reset_stuck_computing_rows.py` — the one-off being superseded;
  its query shape (`computation_status='computing'` + no active job) is the reference semantics.

### Established Patterns
- `computation_status` is written through `ComputationStatus.COMPUTING.value` enum members
  (`routers/portfolio.py:652`, `:1605`), not bare strings, on the Python side.
- `analytics-service/routers/cron.py:868-939` already contains an orphan-`computing` reap for the
  **portfolio_analytics** surface — prior art for the semantics, and a place where a second,
  divergent implementation must not be created.
- pg_cron is the project's standing mechanism for recurring DB maintenance
  (`cron.schedule` across six migrations).

### Integration Points
- New DDL + pg_cron job: `supabase/migrations/` (merging to `main` auto-applies to PROD — apply to
  the TEST project via MCP before merge).
- Writer stamping: `services/analytics_runner.py`, `routers/portfolio.py`, `services/job_worker.py`.
- CI invariant + JOB-07 regression: `analytics-service/tests/`.
- Consumer of the terminal state: the wizard poll / factsheet page that today spins forever.

</code_context>

<specifics>
## Specific Ideas

- The 106-janitor revert is the governing cautionary tale: `computed_at`/`updated_at` are the
  WRONG key (a mid-compute write refreshes them and the reaper mis-reads liveness). This phase
  exists partly to add the dedicated `computing_started_at` that revert said was required.
- SC #2 is a *falsification* criterion, not a description: the tests must include a row with
  fresh `updated_at` + old `computing_started_at` (**reaped**) and a row with old `updated_at` +
  fresh `computing_started_at` (**not reaped**). Both directions, or the test cannot fail when
  the key is wrong.
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
