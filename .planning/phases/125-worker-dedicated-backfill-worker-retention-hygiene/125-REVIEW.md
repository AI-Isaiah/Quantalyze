---
phase: 125-worker-dedicated-backfill-worker-retention-hygiene
reviewed: 2026-07-19T00:00:00Z
depth: standard
files_reviewed: 4
files_reviewed_list:
  - supabase/migrations/20260719120000_retention_orphaned_running_compute_jobs.sql
  - supabase/tests/test_retention_orphaned_running.sql
  - analytics-service/tests/test_worker_isolation_e2e.py
  - docs/runbooks/flipretry-derived-equity-go-live.md
findings:
  critical: 0
  warning: 2
  info: 2
  total: 4
status: findings
---

# Phase 125: Code Review Report

**Reviewed:** 2026-07-19
**Depth:** standard
**Files Reviewed:** 4
**Status:** issues_found

## Summary

The highest-risk artifact — the retention purge migration — is largely sound. The
DELETE body is tightly scoped (`status = 'running' AND claimed_at IS NOT NULL AND
claimed_at < now() - interval '2 hours'`), schema-qualified to `public.compute_jobs`,
fail-loud on missing pg_cron (`RAISE EXCEPTION ... feature_not_supported`), idempotent
(unschedule-then-schedule), and self-verifying (a drifted body fails the migration).
It smuggles NO `derive-allocator-key-dailies` reschedule (WORKER-03 stays a live op),
disables no triggers, sets no `session_replication_role`, and its timestamp
(`20260719120000`) sorts last after `20260719073701`. Verified.

The two test files are genuine, not self-referential:
- **SQL guard** EXECUTEs the *deployed* `cron.job.command` as its oracle (not a re-typed
  predicate), presence-gates on both pg_cron and the registered job so it NOTICE-skips
  (never reds) before the migration is applied, and behaviorally proves the >2h-running
  row dies while the fresh-running and aged-done rows survive.
- **Python e2e** drives the REAL production seam: `services.job_worker` imports
  `build_deribit_native_ledger` / `fetch_deribit_native_account_state` *function-locally*
  (job_worker.py:2278), so the module-attribute monkeypatch genuinely intercepts them; the
  `transient` classification is produced by production code (the `except asyncio.TimeoutError`
  arm at job_worker.py:2623-2650), and the test only asserts the returned `DispatchResult`
  (P115 anti-pattern avoided). The healthz proof binds the real TCP server over a real socket.

Two substantiated defects follow. Both are WARNINGs — one is a false safety-net claim that
undermines the migration's own documented DoS mitigation; the other is a prod behavioral
edge case where the DELETE (vs reset-to-pending) permanently drops a genuine in-flight job.

## Warnings

### WR-01: Documented `retention_delete_guard` 100k backstop is NOT attached to `compute_jobs` — the migration's stated DoS mitigation does not exist

**File:** `supabase/migrations/20260719120000_retention_orphaned_running_compute_jobs.sql:29-34,84`
(also `supabase/tests/test_retention_orphaned_running.sql:28-29`)

**Issue:** The migration's "Safety backstop" section states: *"The `retention_delete_guard`
trigger (mig 121) caps every retention cron body at a 100k-row per-statement DELETE ceiling.
This cron INHERITS that backstop."* The plan's threat register lists this same 100k cap as the
sole mitigation for T-125-03 ("unbounded DELETE volume in one statement"). This is false. The
`retention_delete_guard()` trigger (defined in `20260515113853_retention_crons_safe.sql`) is
attached via `CREATE TRIGGER` to **only** `audit_log` (line 106-109) and `audit_log_cold`
(line 112-115). Grep across all migrations confirms **no** delete-volume trigger of any name is
attached to `compute_jobs`. The new cron therefore inherits nothing — the advertised backstop is
absent for this table. (The sibling `retention_compute_jobs_failed` in `20260515210200` makes the
same incorrect claim, so this is a pre-existing wrong assumption propagated forward; it does not
make it true here.) The "mig 121" citation is also unlocatable — retention_delete_guard lives in a
timestamped migration, not a numeric one, so a maintainer cannot even find the referenced object.

**Concrete failure scenario:** A future maintainer, trusting the header, loosens the predicate or a
data condition produces >100k orphaned `running` rows. The DELETE runs unbounded (no 100k abort)
under an exclusive lock — exactly the failure mode T-125-03 claims is mitigated. The defense-in-depth
net the migration says it relies on will not fire.

**Fix:** Either (a) actually attach the guard so the claim becomes true —
```sql
CREATE TRIGGER compute_jobs_retention_guard
  AFTER DELETE ON public.compute_jobs
  REFERENCING OLD TABLE AS deleted
  FOR EACH STATEMENT EXECUTE FUNCTION public.retention_delete_guard();
```
— or (b) correct the header/threat-model to state plainly that no volume backstop protects
compute_jobs and that safety rests entirely on the tightly-scoped predicate. Also replace the
"mig 121" citation with the real filename (`20260515113853_retention_crons_safe.sql`).

### WR-02: On PROD, the purge DELETEs (never resets) an orphaned `running` row, permanently dropping a genuine in-flight job during a >2h worker outage that spans 04:15 UTC

**File:** `supabase/migrations/20260719120000_retention_orphaned_running_compute_jobs.sql:88-94`

**Issue:** The DELETE-not-reset rationale (header lines 16-18) is correct *for the workerless TEST
project* — a row reset to `pending` is re-claimed and the collision returns. But the identical body
auto-applies to PROD, where a `running` row only reaches the 2h age when the worker (and therefore
its in-process watchdog, `watchdog_loop`) is **down** — that is precisely the case the watchdog
exists to recover via `running -> pending` re-claim on restart. The purge runs on a fixed 04:15 UTC
schedule independent of the worker, so it can delete the row *before* the worker returns, removing the
recovery path that reset-to-pending would preserve.

**Concrete failure scenario:** Prod worker crashes at 02:00 UTC with an onboarding
`derive_broker_dailies` job (from a fresh key-connect) claimed at 02:00. At 04:15 the purge deletes
it (age 2h15m). The worker restarts at 05:00; the watchdog has nothing to reset; the job is gone.
Onboarding derive silently never completes and is **not** re-enqueued (the daily
`derive-allocator-key-dailies` cron is unscheduled on prod, and onboarding jobs are one-shot from
key-connect, not cron-driven). The user's factsheet derivation stalls with no error and no retry.

**Fix:** This is a deliberate documented tradeoff, so it warrants a founder decision rather than an
automatic code change. Options: (a) on prod, prefer `UPDATE ... SET status='pending', claimed_at=NULL`
for `running` rows so the existing recovery semantics are preserved, keeping DELETE only for the
`derive_*` kinds / TEST accumulation the flake is actually about; or (b) narrow the purge to the
specific orphan-producing kinds (`derive_broker_dailies`, `derive_allocator_equity`) and/or widen the
window well beyond any plausible planned-outage-plus-restart, and explicitly confirm in the header that
irrecoverable deletion of a genuine in-flight onboarding job across a multi-hour outage is acceptable.

## Info

### IN-01: No-op byte substitution masks intended whitespace normalization in the healthz assertion

**File:** `analytics-service/tests/test_worker_isolation_e2e.py:165`

**Issue:** `assert b'"last_tick_at": null' not in mid_dispatch_resp.replace(b" ", b" ")` — the
`.replace(b" ", b" ")` replaces a space with the same space, i.e. it is an identity no-op. The
intent was evidently to make the "not stale/null" check whitespace-insensitive. As written it does
nothing; the assertion only holds because `json.dumps` happens to emit exactly `": "` separators. If
the healthz JSON formatting ever changes (e.g. compact separators), the check silently stops matching
what it claims to guard.

**Fix:** Either drop the dead `.replace(...)` (the preceding line already asserts the positive
`b'"last_tick_at":'` case), or make it real: `.replace(b" ", b"")` and compare against
`b'"last_tick_at":null'`.

### IN-02: Runbook's one-time TEST cleanup command uses a looser predicate than the safe cron — unsafe if copy-pasted to a live-worker project

**File:** `docs/runbooks/flipretry-derived-equity-go-live.md:126`

**Issue:** The documented one-time cleanup is
`DELETE FROM compute_jobs WHERE status='running' AND created_at < now() - interval '1 hour'`. This keys
on `created_at` and a 1-hour window, whereas the recurring cron correctly keys on `claimed_at` and 2
hours. `created_at < 1h` would delete a `running` row that was *created* long ago but *claimed
seconds ago* — i.e. a genuinely in-flight job on any project that has a live worker. It is harmless on
the workerless TEST project (the stated target, and noted as a verified no-op), but the runbook presents
it as a runnable SQL block with no "TEST-only, do not run against prod" guardrail next to the command
itself.

**Fix:** Annotate the command inline as TEST-project-only, or align its predicate with the cron's
(`claimed_at < now() - interval '2 hours'`) so an accidental prod paste cannot delete a live job.

---

_Reviewed: 2026-07-19_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
