# Runbook — The shared TEST-database CI mutex

Phase 158 (OPS-01). The three CI jobs that touch the shared TEST Supabase
project — `sql-tests`, `python`, `e2e-seeded` — must never run concurrently
across runs. They used to be serialized by a GitHub Actions `concurrency` group
named `shared-test-db`; they are now serialized by a **Postgres session advisory
lock**. This page covers "what is holding the lock", "how do I break a stuck
hold", "what happens on forks", and the drill that proves serialization still
works.

> **⚠️ Every secret below is named, never valued.** This repository is PUBLIC.
> Reference the repo secret **`TEST_SUPABASE_DB_URL`** by name only — never a
> DSN, host, username, or password, in this file or in any CI log line.

Related: [`railway-worker.md`](./railway-worker.md) (stale/skipped analytics
deploy — the downstream damage this mutex prevents),
[`compute-queue.md`](./compute-queue.md), and the deploy invariants in
[`CONTRIBUTING.md`](../../CONTRIBUTING.md).

## 1. Mechanism

`sql-tests`, `python` and `e2e-seeded` each acquire **session advisory lock key
`61616158`** (issue #616 / phase 158) before their first DB-touching step, and
hold it for the rest of the job. Waiters block inside `pg_advisory_lock`, so
contending runs queue instead of racing.

> **What is proven, and what is not.** Mutual exclusion IS measured — the probe
> in section 5 puts three simultaneous contenders on the lock and asserts their
> hold windows are pairwise non-overlapping on the database clock. Arrival-order
> (FIFO) fairness is **not** asserted anywhere, and Postgres documents no
> ordering or anti-starvation guarantee for advisory locks; the probe explicitly
> logs its arrival-vs-acquisition ordering as *observational only*, because its
> own barrier collapses the arrival spread below timestamp resolution. Treat a
> long-queued waiter as possible, not impossible: it can sit until it hits the
> acquire cap in section 2 and fail its job.

- **Where the lock lives:** the TEST Supabase Postgres, reached over the
  **session-mode** DSN. CI derives it from the `TEST_SUPABASE_DB_URL` secret by
  replacing the transaction-pooler port `:6543/` with the session-mode port
  `:5432/` on the same Supavisor host. Session mode is required: a session
  advisory lock does **not** survive transaction-mode pooling, because the
  pooler hands the backend to another client between statements.
- **How it is held:** a single background `psql` session runs
  `SELECT pg_advisory_lock(61616158)` and then idles for the duration of the
  job. Steps within a job share the runner, so the backgrounded session persists
  across steps. The lock is released when that session's TCP connection drops —
  i.e. when the job ends, for any reason.
- **How to spot it:** the holder session sets `PGAPPNAME=ci-shared-test-db-mutex`,
  so it is identifiable in `pg_stat_activity` (the probe workflow uses a
  different name, `ci-mutex-probe`).

**Why the concurrency group had to go.** GitHub's concurrency layer holds
exactly ONE pending entry per group and **cancels** the pending entry when a
third request arrives. The evicted run concludes `cancelled`, which renders as a
**grey** check — not a red one — and Railway's "wait for CI" then treats that
commit's check-suite as not-green and **silently skips the analytics deploy**,
leaving prod on stale code. That is GitHub issue #616. Shrinking the group does
not help: the eviction is cross-run by construction. Neither does adding
`needs:` edges — the jobs' `if:` conditions diverge on `workflow_dispatch`,
which would silently disable `e2e-seeded` on every manual run.

## 2. TTL and steal semantics

There is **no lock-reaper cron, and none is needed.**

- All three jobs carry `timeout-minutes: 60`. That is the TTL: it bounds the
  maximum possible hold. When GitHub kills a job at the timeout, the runner dies,
  the background `psql` session's TCP connection drops, and Postgres releases the
  advisory lock automatically.
- The same release happens on any other job end: success, failure, or
  cancellation. **A cancelled job cannot leak the lock** — cancellation kills the
  runner, which drops the session.
- A waiter is granted the lock the instant it is released. *Which* waiter is not
  specified — see the ordering caveat in section 1.

The only case needing a human is a session that is alive but wedged (the runner
is gone, yet the backend lingers — e.g. a half-open TCP connection the server
has not reaped). That is what section 3 is for.

## 3. Manual unlock

**Step 1 — find the holder.** Against the TEST project:

```sql
SELECT pid, application_name, state, backend_start, query_start, state_change
FROM pg_stat_activity
WHERE application_name = 'ci-shared-test-db-mutex'
ORDER BY backend_start;
```

**Step 2 — cross-check that it really holds key `61616158`** before killing
anything. A session with the right `application_name` may be a *waiter*, not the
holder; `granted` is the column that distinguishes them:

```sql
SELECT l.pid, a.application_name, l.granted, a.state, a.backend_start
FROM pg_locks l
JOIN pg_stat_activity a USING (pid)
WHERE l.locktype = 'advisory'
  AND l.objid = 61616158
ORDER BY l.granted DESC, a.backend_start;
```

The row with `granted = true` is the holder. Rows with `granted = false` are
queued jobs — **leave those alone**; killing a waiter just fails that job
without freeing anything.

**But count the waiters before you conclude "nothing is wrong."** A holder that
is legitimately working plus a deep `granted = false` queue is the *other*
failure mode: no session is wedged, yet the waiter at the back can still exhaust
its acquire cap and redden its job. Postgres promises no arrival-order service
(section 1), so a waiter's position is not a countdown. If you see a healthy
holder and several waiters, the answer is capacity/queue depth — re-run the
failed job once the queue drains, and if it recurs, re-derive the cap and TTL in
section 2 against the current per-job hold times rather than hunting for a wedge
that does not exist.

**Step 3 — terminate the holder:**

```sql
SELECT pg_terminate_backend(<pid>);
```

A waiter proceeds immediately (which one is unspecified — section 1). The job
whose session you terminated will fail (its `psql` dies) — that is the intended
trade, and rerunning it is safe.

> `pg_terminate_backend` is the same primitive already used on TEST to clear a
> wedged PostgREST connection pool. Terminating a backend is a normal
> operational action on the TEST project; it is **never** to be run against
> PROD as part of this procedure.

**Do not** use `pg_advisory_unlock` / `pg_advisory_unlock_all` to fix this.
Advisory locks are session-scoped: you cannot unlock a lock another session
holds, and running those functions from your own psql session unlocks nothing
and silently returns `false`, which reads like a failed fix.

## 4. Fork-PR arm

On a pull request from a fork, GitHub withholds `TEST_SUPABASE_DB_URL`. The
acquire step detects the empty secret, logs that it is skipping, and **exits 0**
without invoking `psql` — a fork PR is never failed by the mutex.

This is safe rather than a hole, because the DB work itself already self-skips
on forks, independently of the mutex:

- `sql-tests` — its job-level `if:` excludes fork PRs outright.
- `python` — its live-DB tests demote to skipped via the `E2E_TEST_DB_CONFIGURED`
  env gate.
- `e2e-seeded` — its job-level `if:` excludes fork PRs outright.

So an unserialized fork run has nothing to serialize: it cannot reach the TEST
project at all. If you ever remove one of those `if:` gates, the fork arm of the
mutex stops being sufficient and this section is wrong — re-derive it first.

## 5. Probe drill (proving serialization still works)

`.github/workflows/mutex-probe.yml` acquires the same lock, holds it briefly,
and exits. **The drill is ONE run, not three.** The "three, not two" requirement
— eviction needed exactly three contenders, so a two-contender drill cannot
reproduce the bug this mutex fixes — is satisfied *inside* a single run by
`strategy.matrix.contender: [1, 2, 3]`, whose three legs start together at a
shared wall-clock barrier and are checked pairwise for non-overlap by the
`assert-serialization` job.

> ⚠️ Do **not** dispatch the probe three times to get three contenders. The
> workflow declares `concurrency: { group: mutex-probe-${{ github.ref }},
> cancel-in-progress: true }`, so three dispatches on the same ref land in one
> group and only the newest survives — run 2 cancels run 1, run 3 cancels run 2.
> Two of the three would conclude `cancelled`: the exact grey conclusion the
> assertion below says must never be tolerated.

Run it against a probe branch — **never a bare `gh workflow run`**, whose
default ref is the default branch (see the ⚠️ below):

```bash
git push origin HEAD:ci-probe/mutex-drill
# or, if the branch already exists:
gh workflow run mutex-probe.yml --ref ci-probe/mutex-drill

gh run list --workflow=mutex-probe.yml --branch ci-probe/mutex-drill --limit 1 \
  --json databaseId,conclusion
```

Assertions, against that **one** run:

1. It concludes **`success`**. Assert the literal string `success` — never
   "not failure". `cancelled` is not a failure, and a "not failure" assertion
   passes on exactly the grey conclusion this whole mechanism exists to prevent:

   ```bash
   gh run list --workflow=mutex-probe.yml --branch ci-probe/mutex-drill --limit 1 \
     --json conclusion --jq '.[0].conclusion == "success"'   # must print: true
   ```

2. All three `contend` matrix legs ran (a cancelled or skipped leg leaves fewer
   than three windows, and the assertion cannot then distinguish "did not
   serialize" from "did not run" — the job fails loudly in that case rather than
   green-washing).
3. The three lock windows do not overlap. `assert-serialization` already
   asserts this from **database**-clock timestamps and prints the window table
   in its log; read that table rather than re-deriving from job timings, which
   carry runner-clock skew.

To confirm the drill can actually fail (a check that cannot go red proves
nothing), point two contenders at **different** lock keys and watch the overlap
assertion go RED.

> ⚠️ **The probe must only ever run on a `ci-probe/**` ref.** Both real jobs are
> hard-gated on `startsWith(github.ref, 'refs/heads/ci-probe/')`; a dispatch on
> any other ref hits the `dispatch-guard` job, which prints the correct command
> and exits 0. That gate exists because `gh workflow run` and the Actions UI
> default `--ref` to the **default branch**, and this probe can fail by design —
> a red check on a main-HEAD SHA makes Railway's "wait for CI" skip the analytics
> deploy, i.e. you would cause the very outage you are drilling for. If you ever
> remove that gate, this section is wrong.

## 6. Watcher triage (`main-ci-cancelled` issues)

`.github/workflows/main-ci-cancelled-watcher.yml` watches CI's `workflow_run`
conclusions and files a **dedup'd issue labeled `main-ci-cancelled`** whenever a
main-branch push run concludes `cancelled`. One open issue exists at a time;
later detections comment on it. The watcher is deliberately **issue-only** — it
never auto-reruns, because a rerun re-enters the same contention window — and
every one of its code paths exits 0, because a red check on main HEAD would
itself make Railway skip the deploy.

When such an issue appears:

1. **Check whether prod actually missed the deploy.** Compare the analytics
   service's deployed commit to main HEAD:

   ```bash
   curl -s https://quantalyze-analytics-production.up.railway.app/health | jq -r .git_sha
   git rev-parse origin/main
   ```

   If they match, the deploy went through anyway — note it on the issue and
   close.

2. **If they differ, rerun the cancelled CI run** so the check-suite goes green
   and Railway deploys:

   ```bash
   gh run rerun <cancelled-run-id>
   ```

3. **If prod still has not converged** after the rerun is green, follow
   [`railway-worker.md`](./railway-worker.md) to redeploy the service directly.

4. **Close the issue** once `/health` reports main HEAD. Closing it re-arms
   deduplication: the next cancellation opens a fresh issue instead of
   commenting on a stale one.

To exercise the watcher without forcing a cancellation on main, dispatch it
against a historical cancelled run:

```bash
gh workflow run main-ci-cancelled-watcher.yml -f run_id=31273384829 -f attempt=1
```

⚠️ **Pin the attempt.** A run's top-level `conclusion` is that of its *latest*
attempt, so a run that was cancelled and later rerun green now reports
`success` and the watcher will (correctly) no-op on it. Run 31273384829 is
exactly that case: attempt 1 was `cancelled`, the run itself now reads
`success`. Attempt conclusions are immutable, which is what makes them a stable
test fixture. To test with a bare `run_id` instead, pick a run whose *current*
conclusion is cancelled:

```bash
gh run list --workflow=ci.yml --branch main --limit 100 \
  --json databaseId,conclusion,event \
  --jq '[.[] | select(.conclusion=="cancelled" and .event=="push")][0]'
```

A repeat cancellation on main with the mutex in place means something other than
concurrency-group eviction cancelled the run (a manual cancel, a force-push, or
a runner-level abort) — investigate the run itself before assuming the mutex
regressed.
