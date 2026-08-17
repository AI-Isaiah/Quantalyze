# Phase 144: JOB — WR-02 orphaned-running DELETE→terminal UPDATE + cadence - Context

**Gathered:** 2026-08-17
**Status:** Ready for planning
**Mode:** Smart discuss (autonomous), with a live read-only census taken FIRST

<domain>
## Phase Boundary

An orphaned `running` `compute_jobs` row terminates **visibly**: a poller sees a real outcome and
the row survives for audit until the existing retention crons collect it. Delivered as ONE new
migration layered on `20260720120000` — the shipped migration is never edited.

IN SCOPE: DELETE → terminal UPDATE; a tightened cadence at an UNCHANGED threshold; the
NULL-`claimed_at` immortal-orphan class (added by measurement, see below); SC#4's stale-`pending`
disposition; CI-visible gates.

OUT OF SCOPE: the reconciliation sweep (Phase 143, shipped); csv-finalize atomicity (Phase 145);
rate limits (Phase 146); any change to `retention_compute_jobs_done` (jobid 4) or
`retention_compute_jobs_failed` (jobid 8); ⛔ `cron.unschedule(9)` — named trap.

</domain>

<measurements>
## Live census — taken 2026-08-17, read-only, BEFORE any decision

SC#4 mandates measure-first. This is that measurement, and it also falsified two standing claims.

### `public.compute_jobs` by status

| status | PROD `khslejtfbuezsmvmtsdn` | TEST `qmnijlgmdhviwzwfyzlc` |
|---|---|---|
| `pending` | **0** | **2819** (2026-08-11 → 08-15) |
| `running` | **0** | **6** (2026-08-03 → 08-12) |
| `done` | 1545 (07-18 → 08-17) | 0 |
| `failed_final` | 121 (05-20 → 08-17) | 0 |

### ⭐ Finding 1 — the NULL-`claimed_at` immortal orphan (NEW, drives a scope addition)

All **6** TEST `running` rows have **`claimed_at IS NULL`**, `attempts = 1`, `kind = poll_positions`.
The deployed purge (`20260720120000:68-71`) reads:

```sql
DELETE FROM public.compute_jobs
 WHERE status = 'running'
   AND claimed_at IS NOT NULL          -- excludes them BY NAME
   AND claimed_at < now() - interval '4 hours';
```

So these rows are **immortal**: the janitor built to clear orphaned `running` jobs structurally
cannot see them, and `NULL < x` is NULL (never TRUE) even without the explicit guard. Oldest has been
stuck **14 days**. `status='running'` with `claimed_at IS NULL` is also an **invariant violation** —
a claim is supposed to stamp `claimed_at` — so there is a writer bug upstream, not merely unlucky rows.

⚠️ Why this is load-bearing for THIS phase: SC#1 gates on "past the UNCHANGED 4h `claimed_at`
threshold". A NULL-claim row never reaches **any** `claimed_at` threshold, so DELETE→UPDATE alone
does not touch these 6. Without the addition below, Phase 144 seals green while the actual stuck
population remains stuck — a phase whose headline ("terminates VISIBLY") would be true only of the
subset it chose to look at.

### ⭐ Finding 2 — the "TEST/PROD split" is a REQUIREMENTS split, not a deployed one

Both projects' deployed cron bodies were read directly:

| project | schedule | body | md5 |
|---|---|---|---|
| PROD | `15 4 * * *` | `DELETE … status='running' AND claimed_at IS NOT NULL AND claimed_at < now() - interval '4 hours'` | `f600939b…` |
| TEST | `15 4 * * *` | **the same** | `a05bcb18…` |

The md5s differ **only** because TEST joins `status = 'running'` and its `AND` onto one line.
**Semantically identical: both DELETE, same guard, same 4h window, same cadence.**

⚠️ Precision matters here, and an earlier draft of this section got it wrong. The deployed behaviour
has never diverged — `project_worker04_purge_delete_vs_reset_prod_outage` says so itself
("auto-applies to BOTH test and prod", "the prod purge currently DELETEs"). The **split is in what
each environment NEEDS**, and it is real and unresolved:

- **TEST needs the row GONE.** Reset-to-`pending` gets re-claimed → `running` by the next fence-test
  run and the partition-dedupe collision returns — the very flake the migration was written to kill.
- **PROD needs the work RECOVERABLE.** A `running` row only ages past the window when the worker is
  down that long; DELETE there discards a genuine in-flight one-shot job that would not be re-enqueued.

⇒ **Terminal UPDATE resolves both, which is why SC#1 chose it** — and this is the substance of SC#3,
correctly read. The row leaves `running` (so TEST's re-claim flake cannot recur) *and* survives with a
terminal status and an audit trail (so PROD loses no evidence). Neither environment gets DELETE and
neither gets reset-to-`pending`.

⇒ The remaining WR-02 question is therefore **not** "DELETE or reset" but "does a terminal row need
re-enqueueing so PROD actually recovers the lost work?" — surface that in planning rather than
assuming the audit trail alone discharges PROD's need. ⚠️ Phase 143's sweep does **not** cover it: its
predicate requires ZERO `compute_jobs` rows, and a terminalized orphan leaves one behind forever.

### Finding 3 — SC#4's PROD number is ZERO, and structurally so

PROD carries **zero** `pending` rows of any age. That is stronger than a snapshot: **nothing sweeps
`pending`** (that absence is the whole of JOB-08), so any stale `pending` row ever created would still
be present. Zero therefore means zero have **ever** stranded on PROD.

TEST's 2819 is **not** the same finding: TEST has no worker, and cron jobid 9 fans out one job per
`api_key` daily with nothing to drain them. That is an environment artifact, not a product defect.

</measurements>

<decisions>
## Implementation Decisions

### The core change (WR-02)

- **DELETE → terminal UPDATE.** The founder's open WR-02 DELETE-vs-reset call resolves to a **terminal
  UPDATE**, per ROADMAP SC#1. The row must survive so a poller sees a real outcome and the audit trail
  holds until `retention_compute_jobs_failed` (jobid 8, 90 days) collects it. ⛔ Never `DELETE`.
- **Terminal status = `failed_final`, not `failed_retry`.** SC#1 says "a terminal `failed` status";
  the `compute_jobs` vocabulary distinguishes `failed_retry` (will be retried) from `failed_final`.
  An orphan must not be re-queued by the retry path, so `failed_final` is the correct value.
  ⚠️ VERIFY the exact CHECK vocabulary at HEAD before writing the migration — do not trust this line.
- **Write a user-facing reason.** The point of SC#1 is a poller seeing a *real outcome*; a terminal
  row with no explanation is only half the fix. Populate whatever `compute_jobs` field the wizard
  surfaces (there is a `user_message` column in the family — confirm at HEAD) with a cause naming
  orphan-reaping, not a bare status flip.
- **NEW migration layered on `20260720120000`.** The shipped migration is never edited (SC#3).
  `cron.unschedule`-then-`cron.schedule` is the repo's canonical re-apply pattern.

### Cadence and threshold

- **Threshold UNCHANGED at 4 hours.** The WORKER-04 2h→4h lesson is explicit: **the threshold, not
  the frequency, is what protects live jobs.** Do not shrink it while tightening cadence.
- **Cadence tightened from daily to hourly**, dropping detection latency from ~24h to ~1h. Pick a
  minute clear of every registered slot — ⚠️ `:35` is now taken by Phase 143's sweep (jobid 18), and
  142's reaper occupies the `*/15` grid (`:00/:15/:30/:45`). Verify live before choosing.
- **Cadence honesty**, in 142's and 143's register: the cadence is post-threshold *detection latency*.
  Worst case end-to-end is ≈ threshold + cadence. It does not bound user-visible wait; say so.

### The NULL-`claimed_at` arm (ADDED by measurement — founder call 2026-08-17)

- **INCLUDED.** A second arm terminalizes `running` rows with `claimed_at IS NULL`, keyed on
  **`created_at`** with its **own, longer** threshold — `created_at` is not a claim time, so the 4h
  figure does not transfer and must be **derived**, not copied. A bare number with no derivation is
  what Phase 106's janitor was reverted for.
- **Find the writer.** `status='running'` + `claimed_at IS NULL` violates an invariant. Trace what
  sets `running` without stamping `claimed_at` (start at the claim RPC and the `poll_positions`
  handler — all 6 rows are that kind). If the root cause is cheap, fix it; if it is a real
  investigation, record the finding precisely and file it rather than guessing. ⛔ Do **not** ship
  only the janitor arm and call the invariant closed — that is treating the symptom (Rule 6).
- **Consider an invariant gate** so a future NULL-claim `running` row is detected rather than
  silently accumulating for 14 days again.

### SC#4 — stale `pending`

- **WON'T-FIX, carrying the measurement.** SC#4 sanctions this explicitly ("zero on prod is a valid,
  budget-saving outcome"). PROD exposure is zero and structurally so (Finding 3). Record the numbers
  and the reasoning in the phase SUMMARY and in `REQUIREMENTS.md` under JOB-08 — a WON'T-FIX without
  its measurement attached is just a skip.
- ⛔ Two named traps stand regardless: never `DELETE` a `pending` row; never `cron.unschedule(9)`.
- TEST's 2819-row backlog is a **CI hygiene** problem (a known flake mechanism), not a product one.
  File it separately; do not solve CI's problem in production code.

### Claude's Discretion

- Migration filename/timestamp, cron job name, the NULL-claim threshold value and its derivation,
  the exact cadence minute, `LIMIT`/bounding shape, and test file names.
- Whether the writer-bug fix lands in this phase or is filed with evidence.

</decisions>

<code_context>
## Existing Code Insights

- `supabase/migrations/20260719120000_retention_orphaned_running_compute_jobs.sql` and
  `20260720120000_..._window_4h.sql` — the mechanism being replaced (2h→4h window change).
- `supabase/migrations/20260816140000_reconcile_dropped_enqueue_sweep.sql` (Phase 143) — the freshest
  in-repo template: header discipline, `cron.unschedule`-then-`schedule`, materialized-CTE bound,
  self-verifying STEP 2 whose failure messages name the CONSEQUENCE.
- ⭐ **Phase 143 PROVED by live tick that the pg_cron role (`postgres`, `rolbypassrls = true`) can
  write `public.compute_jobs` through `FORCE ROW LEVEL SECURITY`.** 144 inherits that; it does not
  need to re-litigate it. Evidence: `143-CENSUS.md` part B §(10)–(11).
- ⭐ **`cron.job_run_details.return_message` carries the COMMAND TAG, not `RAISE NOTICE` text**
  (measured 2026-08-17). Do not build an operator story on reading counts out of the run log.
- `supabase/tests/test_reconcile_dropped_enqueue_sweep.sql` — the SQL-gate template: ungated Part 1,
  per-part BEGIN/ROLLBACK, EXECUTE-the-deployed-body oracle, century-backdating instead of sleeping.
- Live cron slots (TEST, 2026-08-17): `:00 3`, `:05 3`, `:10 3`, `:15 4`, `:20 3`, `:30 3`, `:30 5`,
  `*/15`, and `:35` (Phase 143). Re-check before choosing a minute.

</code_context>

<specifics>
## Specific Ideas

- Every gate must be shown to FAIL when its target is neutered — neuter, run, OBSERVE the RED,
  restore. Phase 143 found two vacuities this way, one in a gate written ten minutes earlier.
- RLS/SQL gates MUST live in `supabase/tests/test_*.sql` to run in CI.
- ⛔ Merging `supabase/migrations/**` to `main` AUTO-APPLIES to PROD. Apply to TEST via the Supabase
  MCP (never `supabase db push`) and observe a real tick before merge. ⚠️ The MCP is **stripped from
  subagents** — any apply/live-tick task must run in the orchestrator session (Phase 143 Plan 04 hit
  this exactly).
- The 6 TEST NULL-claim rows are a **live fixture**: a correct second arm should terminalize them.
  That is a rare chance to verify against real stuck data rather than a seeded probe.

</specifics>

<deferred>
## Deferred Ideas

- TEST's 2819-row stale-`pending` backlog as a CI-hygiene fix (drain or a TEST-only cleanup). → TODOS.
- A stale-`pending` production sweep — WON'T-FIX today on zero measured PROD exposure; revisit only
  if a future census shows non-zero.
- Correcting `20260802120000` (142's reaper) header, which relies on the same falsified
  `return_message` premise. Already filed by Phase 143. → TODOS.

</deferred>
