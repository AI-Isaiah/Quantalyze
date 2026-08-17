---
phase: 143-job-dropped-enqueue-reconciliation-sweep
reviewed: 2026-08-17T11:55:00Z
depth: deep
status: findings
files_reviewed: 5
files_reviewed_list:
  - supabase/migrations/20260816140000_reconcile_dropped_enqueue_sweep.sql
  - supabase/tests/test_reconcile_dropped_enqueue_sweep.sql
  - src/__tests__/reconcile-dropped-enqueue-sweep.test.ts
  - analytics-service/main_worker.py
  - analytics-service/tests/test_main_worker.py
findings:
  blocker: 0
  critical: 0
  warning: 3
  info: 1
  total: 4
---

# Phase 143: Code Review Report

**Reviewed:** 2026-08-17
**Depth:** deep (cross-file: SQL body ↔ claim RPC ↔ Python worker ↔ three gates)
**Files Reviewed:** 5
**Status:** findings (0 blocking)

## Summary

I attacked the five risk surfaces named in the brief and could not break any of them. The predicate
is correct, the cross-language marker contract is intact end-to-end (including through the claim
RPC's metadata rewrite, which I checked and which merges rather than replaces), the Sentry capture
cannot escape into the claimed batch, and the cron body is genuinely a fixed literal with no dynamic
SQL anywhere in the phase.

What I did find is one **sibling of the `f62c3866` vacuity** — a text anchor whose failure message
names the zero-jobs conjunct but which is satisfied by the `INSERT` target instead, in all three
gates plus the migration's own self-verify — and two robustness/noise defects in the worker-side
alert path. None is user-facing and none is a data-integrity risk, so under the project's stopping
rule **none of them blocks.**

### What I verified rather than assumed

**1. The predicate (five conjuncts).** Traced against live DDL, not against the header's prose.

- `s.status <> 'archived'` — `strategies.status` is `NOT NULL DEFAULT 'draft'` with a CHECK
  (`20260405061911_initial_schema.sql:63`), so there is no NULL arm that could silently drop or
  admit a row.
- `NOT EXISTS (compute_jobs)` is un-kind-scoped and un-status-scoped, as SC#1 requires; the
  mid-chain false positive (`derive_broker_dailies` writes dailies then enqueues its follow-on
  inside the still-running parent) is correctly excluded, and is behaviourally gated by Part 2 arm C1.
- `NOT EXISTS (strategy_analytics at four statuses)` — `computation_status` is
  `NOT NULL DEFAULT 'pending'` (`20260405061911:74`), so there is **no NULL hole** that would let a
  row slip past the safety conjunct. `strategy_analytics.strategy_id` is `UNIQUE` (`:72`), so
  "at most one row per strategy" holds and the `NOT EXISTS` cannot be defeated by a second row.
  Enumerating the excluded four (rather than `<> 'pending'`) does default a hypothetical sixth
  status to EXCLUDED — the safe direction, as claimed.
- `NOT EXISTS (strategy_keys)` errs toward not-healing, which is the correct direction for the
  money surface.
- The grace conjunct is the last one syntactically, but **conjunct order cannot change results
  here** — every conjunct is a total, side-effect-free predicate, none can error, so ordering is a
  cost property only. There is no reordering that changes the answer.
- The INSERT is schema-legal: `compute_jobs_target_xor` and the current
  `compute_jobs_kind_target_coherence` (`20260717233529:168`) both admit
  `(strategy_id NOT NULL, everything else NULL, kind='compute_analytics_from_csv')`; `status`,
  `priority`, `attempts`, `next_attempt_at`, `created_at` all carry defaults.
- `LIMIT` + `FOR UPDATE SKIP LOCKED`: the plan shape is `Limit → LockRows → Sort`, so skipped rows
  do **not** consume budget — the tick still takes up to 25 *unlocked* candidates. Forward progress
  is preserved.

**2. The marker contract.** The gap I actually went looking for was the claim RPC clobbering
`metadata`. It does not: `claim_compute_jobs_with_priority` (current definition,
`20260719073701_claim_kind_filter.sql`) writes
`metadata = COALESCE(metadata,'{}'::jsonb) || jsonb_build_object('unified_backbone_at_claim', …)` —
a merge, so `source` and `detected_at` survive to the row the worker reads. Grepped the whole repo:
`'reconcile-sweep'` is written in exactly one place and read in exactly one place. No third writer
of `compute_jobs.metadata.source` exists, so there is no false-positive collision.

**3. The Sentry capture path.** Cannot kill the batch: the whole block including the
`with sentry_sdk.new_scope()` context manager sits inside `try: … except Exception: pass`, and the
`__exit__` runs before the handler. `sentry-sdk` is pinned at `2.64.0` (`requirements.txt:222`), so
`new_scope()` (a 2.x API) exists — I checked, because a 1.x pin would have made this an
`AttributeError` swallowed into permanent silence. Production reachability is real:
`main.py:69` calls `init_sentry()` at import and `main.py:271` runs `main_worker.dispatch_loop` in
the app lifespan, so the capture executes inside an initialized client. `_redact_before_send` does
not drop message events.

**4. Test vacuity.** Spot-checked every assertion for "satisfied by something other than the
behaviour it names". The `f62c3866` fix is real — `assert '== "reconcile-sweep"' in worker_src`
pins the operator, and the Sentry tag no longer satisfies it. Its siblings on the SQL side are
clean (`'reconcile-sweep'`, `'detected_at'`, `'compute_analytics_from_csv'`, `'archived'`,
`interval '1 hour'` each occur exactly once in the body; `'complete'` cannot be satisfied by
`'complete_with_warnings'` because the quotes are part of the pattern). The one that is **not**
clean is WR-01 below. Ran both suites: `src/__tests__/reconcile-dropped-enqueue-sweep.test.ts`
11/11 pass, `test_main_worker.py -k "Sentry or ReconcileSweep or MarkerContract"` 5/5 pass.

**5. Injection / privilege.** Confirmed true, mechanically: the file contains exactly two `$cron$`
tags and two `$sweep$` tags, the body is passed as a literal to `cron.schedule` with no `format()`,
no `EXECUTE`, no `quote_*`, no `CREATE FUNCTION` and no `SECURITY DEFINER`. The only `EXECUTE` in
the whole phase is `EXECUTE v_command` in the gate file, whose operand is read from
`cron.job.command` — a catalog value written only by this migration, not caller input.

---

## Warnings

### WR-01: The zero-jobs conjunct's three text anchors are satisfied by the INSERT target, not the conjunct

**Files:**
- `supabase/migrations/20260816140000_reconcile_dropped_enqueue_sweep.sql:724-726` (STEP 2 self-verify)
- `supabase/tests/test_reconcile_dropped_enqueue_sweep.sql:217-219` (Part 1)
- `src/__tests__/reconcile-dropped-enqueue-sweep.test.ts:170-174`

**Issue:** All three assert `body contains "public.compute_jobs"` and all three carry a failure
message naming the zero-jobs conjunct ("Without the zero-jobs conjunct it would re-enqueue every
strategy with a healthy in-flight chain"). But `public.compute_jobs` occurs **twice** in the cron
body — once in the `NOT EXISTS` conjunct and once as the `INSERT INTO` target. Deleting the
conjunct outright leaves one occurrence, so all three anchors stay green. Measured:

```
conjunct removed: True
TS gate  toContain('public.compute_jobs') still passes: True
SQL Part1 ILIKE '%public.compute_jobs%' still passes: True
remaining occurrences: 1
```

This is structurally the same defect as `f62c3866` (the marker literal satisfied by a Sentry tag):
an assertion whose stated subject is covered by an unrelated adjacent token. It is the only such
sibling I found.

**Why it is not blocking:** the *behaviour* is genuinely gated. SQL gate Part 2 arms C1/C2/C3
execute the deployed body against a running `derive_broker_dailies` job, a `failed_final` job and a
`done` job, and 143-03 records arm C1 observed RED under the kind-scoping neuter (N2). The
consequence of WR-01 is a misleading gate, not an unguarded predicate.

**Fix:** scope each anchor to the conjunct rather than the table name. Cheapest correct form is an
occurrence count, matching the pattern already used two lines below for the grace anchor:

```sql
-- STEP 2 / Part 1
IF (length(upper(v_command)) - length(replace(upper(v_command), 'PUBLIC.COMPUTE_JOBS', '')))
     / length('PUBLIC.COMPUTE_JOBS') <> 2 THEN
  RAISE EXCEPTION 'JOB-04 verification failed: the deployed body references public.compute_jobs % times, expected 2 (the zero-jobs NOT EXISTS conjunct + the INSERT target). One means the conjunct is gone and the INSERT alone is satisfying this gate.', ...;
END IF;
```

```ts
// TS gate
const jobRefs = [...body.matchAll(/public\.compute_jobs/gi)].length;
expect(jobRefs, "…the conjunct is gone and the INSERT target alone satisfies a bare toContain").toBe(2);
```

### WR-02: The reconcile-sweep capture swallows every failure with zero logging

**File:** `analytics-service/main_worker.py:674-675`

**Issue:**
```python
except Exception:  # noqa: BLE001
    pass
```
The swallow is correct in intent (telemetry must not fail the work it observes — WR-02 is *not*
about removing it). The defect is that it is **completely silent**: no `logger.warning`, no counter,
nothing. If the emission itself ever breaks — an SDK API change removing `new_scope()`, a scope
misuse, a `metadata` shape the `.get()` chain trips on — the alert dies exactly as silently as the
`pg_net` bridge that this phase rejected *for being silently failable*, and no test can observe it
because every test injects `_FakeSentry` in place of the real module. This is the milestone's own
declared defect class reproduced one layer in.

Every other broad swallow in this file logs (`_safe_mark:423`, `_daily_enqueue_already_ran_today:925`,
all three loop wrappers). This one is the outlier.

**Fix:**
```python
except Exception as exc:  # noqa: BLE001
    logger.warning(
        "reconcile-sweep Sentry emission failed for job %s (%s); the heal still "
        "proceeds but SC#1's alert did NOT fire for this job.",
        job.get("id"), exc,
        extra={"event_type": "reconcile_sweep_alert_emit_failed"},
    )
```

### WR-03: The alert re-fires on every re-claim of the same healed job

**File:** `analytics-service/main_worker.py:662-673`

**Issue:** The marker lives in `compute_jobs.metadata` for the row's whole lifetime, and the claim
RPC merges rather than clears it (verified above). The emission is unconditional on claim, so one
healed strategy produces one Sentry event **per claim**, not per heal:

- `mark_compute_job_failed` with a transient/unknown `error_kind` → `failed_retry` → re-claimed →
  second event; `max_attempts` defaults to 3, so up to 3 events.
- The watchdog (`reset_stalled_compute_jobs`, 15-minute threshold for
  `compute_analytics_from_csv`) reclaims a stalled row → another event, unbounded by attempts.
- `DispatchOutcome.DEFERRED` → `defer_compute_job` → back to `pending` → another event.

Not a correctness bug and not user-facing, but it degrades the signal the phase exists to create:
an operator counting Sentry events cannot read them as "strategies healed", and a flapping job
becomes an alert storm on a warning-level channel. It also silently contradicts the SQL gate's own
framing, where one heal is asserted to be one marked row.

**Fix:** gate on first claim. `attempts` is incremented by the claim RPC before the row is returned,
so the first claim of a fresh row carries `attempts == 1`:

```python
if _meta.get("source") == "reconcile-sweep" and (job.get("attempts") or 1) <= 1:
```
Add the corresponding arm to `TestReconcileSweepAlert` (a job at `attempts: 3` must emit nothing) so
the dedupe is itself falsifiable — the existing fixtures omit `attempts` entirely.

---

## Info

### IN-01: SQL gate Parts 2–4 have never executed against the real TEST schema

**File:** `supabase/tests/test_reconcile_dropped_enqueue_sweep.sql:309-808`

**Issue:** `143-03-SUMMARY.md` coverage item D8 states this plainly, and `143-04` ran only Part 1's
assertion directly against TEST (the labelled plan deviation) — so Parts 2–4 will execute against
the real schema for the first time in the PR's `sql-tests` run. The neuter campaign ran against
Plan 02's throwaway harness, which has "no RLS, no real scheduler and minimal table shapes".

**Assessment — not a defect, recorded so nobody mistakes the green for coverage it does not have.**
I checked every seed shape against the live DDL and they are all valid: `csv_daily_returns`
(`20260522111839:36-43`, the four supplied columns are exactly the four NOT NULLs),
`strategy_keys` (`20260710120000:30-43`, all five NOT NULLs supplied and the SECURITY DEFINER
owner-coherence trigger satisfied by the shared `v_user`), `api_keys` (`20260405061911:19-32`, the
four NOT NULLs supplied, `'binance'` admitted by the CHECK), `strategy_analytics`
(`computed_at` defaults), `compute_jobs` (both the XOR and the coherence constraint admit the
seeded rows), and there is **no INSERT trigger on `strategies`** that would pre-create a
`strategy_analytics` row and break arm A. `test_retention_crons_safe.sql` iterates an explicit
`expected_jobs` array, so the new cron job does not trip it. The remaining risk is a first-run CI
red, not a production defect.

---

## Not findings (checked and cleared)

Recorded so a later reviewer does not re-open them:

- **Mass re-enqueue.** The terminal-analytics conjunct holds; `computation_status` is NOT NULL so
  there is no NULL bypass, and `strategy_id` is UNIQUE so there is no second-row bypass.
- **Composite corruption.** `strategy_keys` membership is the right discriminator and errs safe;
  `api_key_id IS NULL` correctly rejected.
- **Racing the live enqueue.** Grace anchor is `csv_daily_returns.created_at`, DB-stamped, not
  re-stamped by either upsert writer; `FOR UPDATE SKIP LOCKED` genuinely conflicts with the FK
  `KEY SHARE` lock an enqueue takes on the parent `strategies` row.
- **Marker drift.** Verified through the claim RPC's `||` merge — the one place drift could have
  been introduced by a third party.
- **Capture escaping the batch.** Cannot; the context manager exits before the handler.
- **`sentry_sdk.new_scope` availability.** Pinned 2.64.0, API present.
- **Dynamic SQL / injection / privilege escalation.** None; two `$cron$` tags, two `$sweep$` tags,
  no `format()`, no callable surface, no caller-suppliable interval.
- **BEGIN/COMMIT + session `SET lock_timeout`** and header length — excluded from scope by the
  pre-documented deviation and repo Rule 11.

---

_Reviewed: 2026-08-17_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
