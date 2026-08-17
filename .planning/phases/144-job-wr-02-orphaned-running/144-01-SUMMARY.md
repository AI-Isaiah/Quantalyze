---
phase: 144-job-wr-02-orphaned-running
plan: 01
subsystem: infra
tags: [supabase, migration, pg_cron, plpgsql, job-queue, retention, sql-gate, neuter-red]
status: complete

# Dependency graph
requires:
  - phase: 143-job-dropped-enqueue-reconciliation-sweep
    provides: "the migration header register, the fail-loud pg_cron guard, the word-bounded LIMIT form, the ungated-Part-1 gate contract, the throwaway-harness pattern, and the MEASURED fact that the pg_cron role writes compute_jobs through FORCE RLS"
  - phase: 142-strategy-analytics-stuck-computing-reaper
    provides: "the bounded terminal-UPDATE body shape (MATERIALIZED batch + ORDER BY + LIMIT + FOR UPDATE SKIP LOCKED + compare-and-set fence), and the exclusion set that makes failed_final the only correct terminal value"
provides:
  - "supabase/migrations/20260817120000_retention_orphaned_running_terminalize.sql — the phase's ONLY production artifact: retention_compute_jobs_orphaned_running re-registered at '50 * * * *' with a two-arm bounded terminal UPDATE replacing the shipped removal body"
  - "supabase/tests/test_retention_orphaned_running.sql — rewritten in 143's register: ungated structural Part 1, behavioural Part 2 (6 directional arms + count conservation), executed 101-row bound Part 3"
  - ".planning/phases/144-job-wr-02-orphaned-running/144-throwaway-harness.sql — stub schema + fake pg_cron, reusable by Plans 02/03"
  - "The occurrence-count vocabulary Plan 02's TS gate must mirror: public.compute_jobs=4, status = 'running'=4, failed_final=2, next_attempt_at=2, orphaned_running_reaped=2, interval '4 hours'=1, interval '48 hours'=1, ORDER BY=2, AS MATERIALIZED=2, word-bounded LIMIT 100=2"
affects: [144-02 TS migration-content gate + TODOS filings, 144-03 TEST apply and the live tick that observes the bound against ~396 real rows, any future edit to the orphaned-running janitor]

actuals:
  tokens: 32395     # chars/4 over the realized diff (added lines, d2c30eca..HEAD)
  tasks: 3
  commits: 2

tech-stack:
  added: []          # ZERO packages installed this phase
  patterns:
    - "Two-arm cron body: occurrence counts are recalibrated deliberately from 143's one-arm numbers, and every count states which occurrence is which in its own failure message"
    - "Word-bounded bound gate in TWO halves: the `!~ 'LIMIT[[:space:]]+100([^0-9]|$)'` pattern test AND a regexp_matches COUNT of 2 — the pattern alone is satisfied by one arm, so widening only one arm slips past it (MEASURED, probe P8)"
    - "Whole-row byte-identity comparison (md5/row-snapshot) as the tracer's 'untouched' oracle, strictly stronger than a status read"
    - "Ordering of a whole-block invariant is load-bearing: an invariant placed after per-item reads is unreachable and therefore vacuous (MEASURED, and fixed in 734944f1)"

key-files:
  created:
    - supabase/migrations/20260817120000_retention_orphaned_running_terminalize.sql
    - .planning/phases/144-job-wr-02-orphaned-running/144-throwaway-harness.sql
  modified:
    - supabase/tests/test_retention_orphaned_running.sql

key-decisions:
  - "The bound is LIMIT 100 PER ARM, and the justification is per-tick statement cost, NOT population size. The 'strictly dominates the measured 402' framing was deleted from the header as snapshot-fitted. 100 sits DELIBERATELY BELOW the measured 396 arm-A rows on TEST so that Plan 03's live ticks can OBSERVE bounded-and-progressing against real stuck data — an observation a bound at or above the population would make impossible."
  - "Arm B's threshold is 48h, derived (24h enqueue cadence + 2.5h max batch wall-clock = 26.5h ceiling, rounded up to the next whole cadence multiple), with 4h/16h/1h each named as a foreign number and why it does not transfer."
  - "The 142 NULL-stamp rule ('a NULL stamp is a WRITER bug; SKIP it') is REVERSED for this table and the divergence is argued in the header, never blended: compute_jobs.created_at is NOT NULL DEFAULT now() and gives arm B a real anchor 142's row lacks, and 142's rule is precisely what kept the 6 measured TEST rows immortal for 14 days."
  - "next_attempt_at = now() is in BOTH SET lists (B3). Without it, retention_compute_jobs_failed's COALESCE(next_attempt_at, created_at) 90-day key collects an old orphan on the very next 03:30 tick and the audit trail lasts eleven hours instead of ninety days."
  - "No re-enqueue arm, and no call to the enqueue RPC: the orphan at `running` is the thing SUPPRESSING its own replacement (the in-flight index and the enqueue probe both exclude failed_final), so terminalizing IS the recovery for every cron-fanned kind."
  - "ADDITION beyond the plan's enumerated STEP 2 list: an ORDER BY occurrence count (= 2). Losing the deterministic ordering leaves the batch bounded but not progressing, which no other assertion catches; 143 pins its own anchor for the same reason."
  - "The jobname is unchanged (retention_compute_jobs_orphaned_running) so the deployed jobid and this SQL gate stay continuous."
---

# Phase 144 Plan 01: Terminalize orphaned-running compute_jobs Summary

The WR-02 janitor stops removing orphaned `running` rows and starts terminalizing them to
`failed_final` with `next_attempt_at = now()`, `error_kind = 'permanent'` and a fixed audit
literal — two bounded arms at `'50 * * * *'`, proven end-to-end on a throwaway PostgreSQL 16.13
cluster, landed in ONE commit with the rewritten CI gate it would otherwise have reddened.

## What was built

| Artifact | What it is |
|---|---|
| `supabase/migrations/20260817120000_retention_orphaned_running_terminalize.sql` | 814 lines. Header in 143's register; STEP 1 re-registers the EXISTING jobname at `'50 * * * *'` with an inline dollar-quoted two-arm body; STEP 2 self-verifies the DEPLOYED body read back from `cron.job`. No DDL, no function, no policy, no grant, no re-enqueue. |
| `supabase/tests/test_retention_orphaned_running.sql` | REWRITTEN top to bottom (802 changed lines). Part 1 structural + ungated; Part 2 six directional arms + count conservation; Part 3 the executed 101-row bound. |
| `.planning/phases/144-job-wr-02-orphaned-running/144-throwaway-harness.sql` | 338 lines. Stub `cron` schema + minimal real-constraint replicas of `auth.users` / `profiles` / `api_keys` / `compute_jobs`, every CHECK and index cited to its source migration:line. |

**The deployed body** (read back from `cron.job.command`, verbatim shape):

```sql
DO $sweep$
BEGIN
  WITH batch AS MATERIALIZED (
    SELECT id FROM public.compute_jobs
     WHERE status = 'running' AND claimed_at IS NOT NULL
       AND claimed_at < now() - interval '4 hours'
     ORDER BY claimed_at ASC LIMIT 100 FOR UPDATE SKIP LOCKED)
  UPDATE public.compute_jobs cj
     SET status = 'failed_final', next_attempt_at = now(),
         error_kind = 'permanent', last_error = 'orphaned_running_reaped: ...4h claim window'
    FROM batch b WHERE cj.id = b.id AND cj.status = 'running';
  -- arm B: identical shape, claimed_at IS NULL / created_at < now() - interval '48 hours'
END $sweep$;
```

## Tracer observations (Task 1, throwaway PostgreSQL 16.13, `/opt/homebrew/opt/postgresql@16/bin`)

| # | Observation | Result |
|---|---|---|
| T0 | Migration applied BEFORE faking `pg_cron` | **RED as designed** — `ERROR: 0A000: JOB-05/WR-02: pg_cron extension is NOT installed…`, psql exit **3**. SQLSTATE `0A000` = `feature_not_supported`. Never a silent skip. |
| T1 | Migration applied WITH the fake extension | STEP 1 + STEP 2 pass, `COMMIT`. Self-verify NOTICE enumerates all 15 checks. |
| T2 | (a) arm-A 5h orphan, `next_attempt_at` century-backdated | `status=failed_final error_kind=permanent last_error=orphaned_running_reaped: no worker completed this job within the 4h claim window`, `next_attempt_at advanced=t`, `claimed_at preserved=t`, `claimed_by preserved=worker-1`, `attempts=1` |
| T3 | (e) arm-B 5-day NULL-claim (non-NULL `claim_token`, census shape) | `status=failed_final error_kind=permanent last_error=orphaned_running_reaped: running with no claim stamp (invariant violation) older than 48h`, `next_attempt_at advanced=t`, `claimed_at still NULL=t`, `claim_token preserved=t` |
| T4 | (b) 3h batch-tail, (c) fresh running, (d) aged done, (f) 12h NULL-claim | **all four BYTE-IDENTICAL** to their pre-EXECUTE snapshot (whole-row `IS DISTINCT FROM` against a temp-table snapshot) |
| T5 | Count conservation over the 6 seeded ids | `6 of 6 seeded rows survive the tick (ZERO removed)`; post-tick census `still running=3, failed_final=2, done=1` |
| T6 | BOUND tick 1 — 101 century-backdated arm-A rows on 101 distinct api_keys | `exactly the 100 OLDEST of 101 seeded arm-A rows moved to failed_final; the youngest (101st) is still running` |
| T7 | BOUND tick 2 | `the survivor moved; all 101 seeds now failed_final (bounded AND progressing)` |
| T8 | BOUND count conservation | `101 of 101 seeded rows survive two ticks (ZERO removed)` |
| T9 | Negative-token scan on the deployed body | removal keyword **0**, `failed_retry` **0**, `enqueue_compute_job` **0**, `claimed_by` **0**, `interval '2 hours'` **0** |

## ⚠️ A VACUITY WAS FOUND, AND IT WAS THE PHASE'S HEADLINE INVARIANT

Neuter 1 did not merely pass — it **falsified an assertion I had written twenty minutes earlier**.

The count-conservation assertion (the one that makes D-01 "never remove a row" *behaviourally*
checkable rather than a grep for a keyword) originally sat at the END of Part 2, after every
per-arm read. Deploying the superseded removal body produced:

```
TEST FAILED (2/arm A/JOB-05/WR-02/SC#1): my orphaned running row is GONE after one tick (count=0) …
```

— the arm-A read fired first, so the conservation count was never reached. **Any** body that
removes a seeded row trips a per-arm read before it reaches a count taken at the bottom, so the
invariant was guarded by an assertion no neuter could reach. Fixed in its own commit
(`734944f1`): conservation now runs FIRST, immediately after the `EXECUTE`, and the arm-A presence
check it subsumed was removed. Re-observed under the same neuter:

```
TEST FAILED (2/conservation/JOB-05/WR-02/SC#1): 5 of my 6 seeded rows survive the tick, expected all 6.
The janitor REMOVED rows. …
```

## The neuter-RED matrix (Task 3) — all 8 observed, verbatim

Every neuter deploys a VARIANT body through the harness's `cron.schedule` upsert (no repo file is
ever edited), runs the migration's STEP 2 standalone **and** the CI gate, records the actual output,
restores the real body and re-runs to GREEN. Final state after the matrix: **GREEN (exit 0)**.

| # | Neuter | Gate part | Observed RED (verbatim head) |
|---|---|---|---|
| 1 | The OLD `20260720120000` removal body is deployed | Part 1 **and** Part 2 **and** Part 3 | `TEST FAILED (1/JOB-05/D-08): the deployed body names public.compute_jobs 1 times, expected 4 (arm A batch + arm A UPDATE target + arm B batch + arm B UPDATE target). Two usually means a WHOLE ARM IS GONE…` · `TEST FAILED (2/conservation/JOB-05/WR-02/SC#1): 5 of my 6 seeded rows survive the tick, expected all 6. The janitor REMOVED rows…` · `TEST FAILED (3/JOB-05/D-19): after ONE tick only 0 of MY 100 oldest seeded orphans were terminalized, expected all 100…` |
| 2 | `next_attempt_at = now()` dropped from BOTH SET lists | Part 1 (text) **and** Part 2 (behaviour) | `TEST FAILED (1/JOB-05/B3): the deployed body writes next_attempt_at 0 times, expected 2 (one per SET list). retention_compute_jobs_failed deletes on COALESCE(next_attempt_at, created_at) older than 90 days…` · `TEST FAILED (2/arm A/JOB-05/B3): the terminalized row next_attempt_at is still at its century-backdated seed value (1926-08-17 16:54:03.897473+02), so the janitor did not advance it…` |
| 3 | `LIMIT 100` → `LIMIT 1000` (both arms) | Part 1 (word-bounded) **and** Part 3 (executed) | `TEST FAILED (1/JOB-05/D-19): the deployed body carries no word-bounded LIMIT 100…` · `TEST FAILED (3/JOB-05/D-19): my YOUNGEST seeded orphan — the 101st, sitting outside a 100-row budget — was terminalized on tick 1. The per-tick LIMIT is gone…` **Control measured in the same breath: the substring form `command ILIKE '%LIMIT 100%'` was STILL TRUE against `LIMIT 1000` — the naive gate would have stayed green.** |
| 4 | Arm B removed entirely | Part 1 (count 4→2) **and** Part 2 (arm E) | `TEST FAILED (1/JOB-05/D-08): the deployed body names public.compute_jobs 2 times, expected 4…` · `TEST FAILED (2/arm E/JOB-05/D-08): a running row with claimed_at NULL, created a century ago, is at status running after one tick, expected failed_final. Arm B is gone or broken. That row shape is IMMORTAL without it…` |
| 5 | Window narrowed `interval '4 hours'` → `interval '2 hours'` | Part 1 **and** Part 2 (the RT-01 arm) | `TEST FAILED (1/JOB-05/RT-01): the deployed body carries the 4-hour claim window 0 times, expected exactly 1 (arm A)…` · `TEST FAILED (2/arm B/JOB-05/RT-01/SC#2): a running row claimed only 3 hours ago is at status failed_final after one tick, expected still running. The window has been narrowed below the RT-01 basis…` |
| 6 | Terminal status → the claimable `failed_retry` | Part 1 (count) **and** Part 2 (arm A) **and** Part 3 | `TEST FAILED (1/JOB-05): the deployed body writes 'failed_final' 0 times, expected 2 (one per arm)…` · `TEST FAILED (2/arm A/JOB-05/SC#1): an orphan claimed past the 4-hour window sits at status failed_retry after one tick, expected failed_final…` · `TEST FAILED (3/JOB-05/D-19): after ONE tick only 0 of MY 100 oldest seeded orphans were terminalized…` |
| 7 | Schedule `'50 * * * *'` → `'25 * * * *'` | Part 1 (string equality) | `TEST FAILED (1/JOB-05): the deployed cadence is 25 * * * * and not the expected 50 * * * *. Minute 50 is what keeps this janitor off 142 reaper quarter-hour grid, off 143 sweep at :35…` |
| 8 | Gate run against a database with `pg_cron` present but the migration **NOT** applied | Part 1 (structurally, ungated) | `TEST FAILED (1/JOB-05): pg_cron IS installed but the retention_compute_jobs_orphaned_running job is NOT registered. Until it is, an orphaned running compute_jobs row is never terminalized…` (Parts 2 and 3 also RED with "a missing janitor is a red gate, never a skip"; psql exit non-zero.) This is the proof the file is genuinely ungated — the superseded version would have printed a NOTICE and returned green. |

### Supplementary neuters run beyond the required eight

Because the required matrix leaves several assertions unexercised, each remaining one was probed
individually. All reddened; the gate was restored GREEN after each.

| Probe | Target assertion | Observed |
|---|---|---|
| 6c | `failed_retry` **negative anchor** in isolation (all counts kept intact; `failed_retry` added only to arm A's fence) | `the deployed body references failed_retry. That value is CLAIMABLE…` — needed because in neuter 6 the `failed_final` count fires first, leaving the negative anchor unreached |
| S1 | arm-A age conjunct deleted entirely | reds at arm B (the 3h batch tail) |
| S3 | arm-B window `48 hours` → `1 hour` | `TEST FAILED (2/arm F/JOB-05/D-08): a NULL-claim running row only 12 hours old is at status failed_final…` |
| S4 | `error_kind = 'permanent'` dropped | Part 1 presence + `TEST FAILED (2/arm A/JOB-05): the terminalized row error_kind is <NULL> and not permanent…` |
| S5 | body ALSO clears `claimed_at` | `TEST FAILED (2/arm A/JOB-05): the terminalized row claimed_at was CLEARED…` |
| S6' | arm-A `last_error` dropped (syntactically valid variant) | Part 1 reason count + `TEST FAILED (2/arm A/JOB-05): the terminalized row carries no last_error…` |
| S7 | BOTH arm-A's batch predicate AND its fence lose the status scope | Part 1 running count 2 + `TEST FAILED (2/arm D/JOB-05): an aged DONE row is at status failed_final after one tick…` |
| P1 | `ORDER BY` count | `the deployed body orders its bounded batches 0 times, expected 2…` |
| P2 | `FOR UPDATE SKIP LOCKED` presence | `the deployed body dropped FOR UPDATE SKIP LOCKED…` |
| P3 | `claimed_by` negative anchor | `the deployed body references claimed_by. That column must be PRESERVED, not written…` |
| P4 | enqueue-RPC negative anchor | `the deployed body calls the enqueue RPC…` |
| P5 | the `IN (SELECT … LIMIT)` regex — **the exact gate Phase 143 found could never fire in its `[^)]*` form** | `TEST FAILED (1/JOB-05/D-19): the deployed body binds a bounded batch through an IN (SELECT ... LIMIT ...) subquery…` — the `[^;]*` window CAN fire |
| P6 | `'permanent'` presence in isolation | `the deployed body does not classify the failure as permanent…` |
| P7 | `interval '2 hours'` negative in isolation (4-hour literal kept) | `the deployed body carries the OLD 2-hour window that migration 20260720120000 corrected away…` |
| P8 | **only arm B** widened to `LIMIT 1000` | `carries 1 word-bounded LIMIT 100 clauses, expected exactly 2…` — and the pattern-only test was measured STILL GREEN, which is why the COUNT half exists |
| P9 | `claimed_at IS NULL` presence (arm B flipped to `IS NOT NULL`, keeping the table count at 4) | Part 1 `the deployed body has no claimed_at IS NULL arm…` + Part 2 arm E |
| S2 | arm-A batch status predicate removed but the FENCE kept | **stayed GREEN — correctly.** The compare-and-set fence alone still protects the aged done row, so the body is still safe. Recorded because it is a case where green is the right answer, and it is what motivated S7. |

### Assertions that could NOT be reddened — stated, not hidden

Two assertions survive every neuter, and both are now annotated in the file itself so no future
reader counts them as independent evidence:

1. **Part 2 arm C** (a row claimed *this instant* is untouched) is **DOMINATED by arm B**. For any
   monotone age threshold a body that takes a 0-second-old claim also takes the 3-hour-old one, so
   arm B fires first; and an age-INVERTED body fails arm A before reaching arm C. Kept as an
   explicit boundary marker.
2. **Part 2's whole-block count** (`exactly 2 of the 6 move`) is a **catch-all for a future arm
   added without its own assertion** — every present seed already has a named check that fires
   first. Same register and same caveat as 143's whole-block count.

Two Part-1 assertions are also structurally unexercisable through the harness: `v_count <> 1`
(two jobs with one jobname — the stub's `UNIQUE (jobname)` makes it unreachable, exactly as
pg_cron's own upsert-by-name does) and `v_command IS NULL` (the column is `NOT NULL`). Both are
inherited from 143's register and are catalog-integrity backstops, not behavioural claims.

## Deviations from Plan

### Additions (documented, not silent)

**1. [Addition] An `ORDER BY` occurrence count (= 2) in STEP 2 and Part 1.**
Not in the plan's enumerated count list. Added because losing the deterministic ordering leaves
each batch bounded but not *progressing* — the oldest orphans can be skipped indefinitely while the
batch stays full — and nothing else in either gate catches it. 143 pins its own anchor positively
for the identical reason. Observed RED (probe P1).

**2. [Addition] A `regexp_matches` COUNT of word-bounded `LIMIT 100` (= 2) alongside the mandated
`!~ 'LIMIT[[:space:]]+100([^0-9]|$)'` pattern test.**
The mandated form is present verbatim, with the required `|$` arm. The count was added because the
pattern test alone is satisfied by ONE match, so widening a single arm would slip past it — measured
directly in probe P8 (`pattern-only gate -> STILL GREEN`).

**3. [Rule 1 - Vacuous assertion] Count conservation reordered; the arm-A presence check removed.**
Full detail above. Landed as its own commit `734944f1`, whose message names the vacuity it closes,
per the plan's instruction.

### Simplifications (documented in the harness header)

**4. [Scope] All harness and gate seeds are api_key-scoped `derive_broker_dailies`, including the
arm-B seeds.** The 6 real arm-B rows on TEST are strategy-scoped `poll_positions`. Arm B is
kind-agnostic and target-agnostic by design (RESEARCH §4, Open Question 3), so seeding it on the
same FK chain exercises the same predicate with one fewer stub table. The harness header states this
explicitly and states the condition under which it stops being sound (if either arm is ever
kind-scoped or target-scoped, the harness must grow a `strategies` stub).

No other deviations. No architectural decisions were required, so no Rule 4 checkpoint was raised.

## Blockers closed

| ID | Closed how | Evidence |
|---|---|---|
| **B1** | The migration, the rewritten gate and the harness are in ONE commit | `git show --stat 009710d7` lists all three files |
| **B2** | The `(split_part(schedule,' ',2))::INT` hour-band cast is GONE; the schedule is compared by string equality to `'50 * * * *'` | `grep -c '::INT'` and `grep -c 'split_part'` on the gate both return **0**; neuter 7 reds the string comparison |
| **B3** | `next_attempt_at = now()` is in both SET lists, pinned by a textual count (=2) and a behavioural assertion against a century-backdated seed | neuter 2 reds both halves |

## Success criteria

- **SC#1** — mechanism exists and is proven offline: a >4h claimed orphan becomes `failed_final`,
  the row SURVIVES, `next_attempt_at` is advanced. ✅ T2, T5.
- **SC#2** — the 3h batch tail is untouched at the unchanged 4h threshold; the cadence literal is
  hourly. ✅ T4, neuter 5, the deployed schedule `50 * * * *`.
- **SC#3** — ONE new migration layered on `20260720120000`; the shipped files untouched.
  ✅ `git diff --stat d2c30eca..HEAD -- <20260720120000> <20260719120000>` is **empty**.

## What this plan did NOT do (deliberately)

- **Nothing was applied to any Supabase project.** No MCP call, no `supabase db push`. Plan 03 owns
  the TEST apply and the live tick, in the orchestrator session (the Supabase MCP is stripped from
  subagents).
- **The cron role's RLS posture was not proven here** and cannot be: the harness has no RLS. Phase
  143 discharged it by live tick and 144 inherits that inference; Plan 03 re-observes it for this job.
- **The chain-mid residual** (a terminalized orphan permanently excludes its strategy from 143's
  zero-jobs sweep) is NAMED in the migration header and belongs to Plan 02's TODOS filing.
- **The `test_compute_jobs_fencing.py` fixture-hygiene fix** (the traced source of the NULL-claim
  rows) is filed, not shipped — Plan 02.
- **`.planning/STATE.md`, `ROADMAP.md` and `REQUIREMENTS.md` were NOT touched.** STATE.md's
  `current_phase` still reads 153.7 and its `stopped_at` still reads Phase 143, i.e. those ledgers
  are being driven by the orchestrator session for this phase. Advancing a plan counter from here
  would have written against the wrong phase.

## Self-Check: PASSED

- `supabase/migrations/20260817120000_retention_orphaned_running_terminalize.sql` — FOUND
- `supabase/tests/test_retention_orphaned_running.sql` — FOUND
- `.planning/phases/144-job-wr-02-orphaned-running/144-throwaway-harness.sql` — FOUND
- commit `009710d7` — FOUND (all three files, one commit)
- commit `734944f1` — FOUND (the vacuity fix)
