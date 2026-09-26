# Runbook — The shared TEST-database CI mutex

Phase 158 (OPS-01). The CI jobs that touch the shared TEST Supabase project must
never run concurrently across runs. Phase 158 named three — `sql-tests`,
`python`, `e2e-seeded` — and **Phase 158's three became FIVE on 2026-09-09**:
`apply-test` and `restore` were added by Phase 164.8 TESTPREPROD and are
described in section 1. Every "three" below that was not updated is a Phase 158
sentence kept as lineage; the holder list, the TTL table and section 3 are
current. They used to be serialized by a GitHub Actions `concurrency` group
named `shared-test-db`; they are now serialized by a **Postgres session advisory
lock**. This page covers "what is holding the lock", "how do I break a stuck
hold", "what happens on forks", and the drill that proves serialization still
works.

📜 **LINEAGE, 2026-09-23:** the Phase 158 trio above (`sql-tests`, `python`,
`e2e-seeded`) is a dated framing, kept as it was. It was superseded by Phase
164.4.2, which took `sql-tests` off the key; the current holder set is in the
first section below.

⭐ **ADDENDUM 2026-09-21 (Phase 164.9) — THERE ARE NOW TWO KEYS, AND SECTIONS 1–6
DESCRIBE ONLY THE FIRST.** A second advisory key, the *schema-apply-in-flight
FLAG*, protects a different unit and **nothing blocks on it**; three reader jobs
now WAIT on a fact before taking the first key. Sections 1–6 are kept as lineage
and are still correct about the mutual-exclusion key. **Read [section 7](#7-two-keys-two-units--and-the-ordering-wait-added-2026-09-21-phase-1649)
before changing, counting or citing either key** — it also carries the corrected
file-level census, which is wider than section 1's three jobs.

> **⚠️ Every secret below is named, never valued.** This repository is PUBLIC.
> Reference the repo secret **`TEST_SUPABASE_DB_URL`** by name only — never a
> DSN, host, username, or password, in this file or in any CI log line.

Related: [`railway-worker.md`](./railway-worker.md) (stale/skipped analytics
deploy — the downstream damage this mutex prevents),
[`compute-queue.md`](./compute-queue.md), and the deploy invariants in
[`CONTRIBUTING.md`](../../CONTRIBUTING.md).

## 0. What changed on 2026-09-23 (Phase 164.4.2 SUBSETSPLIT) — read before section 1

⭐ **`sql-tests` NO LONGER HOLDS THE KEY.** Everything below that names it as a holder
is kept as dated lineage; the corrections sit beside each one.

⛔ **CORRECTED 2026-09-25 (Phase 164.4.2.1 DRIFTOFFMUTEX): `test-db-drift` NO LONGER
HOLDS THE KEY EITHER.** The bullets below that make it a holder are kept as dated
lineage. Current state:

- **The `ci.yml` holders are `python` and `e2e-seeded`.** With `apply-test` and
  `restore` that makes **FOUR holders** in total.
- **`test-db-drift` has no acquire, release or dead-holder-verdict step.** It still
  runs the schema-apply wait, keeps `needs: python`, `timeout-minutes: 90` and the
  secret, and is still in the `frontend` aggregator. For this job the wait is the only
  ordering control against `apply-test`. `src/__tests__/critical-regressions.test.ts`
  pins three things: the holder set as exactly `python` and `e2e-seeded`, that
  `test-db-drift` names no key, and that its wait runs before VAC-08.
- **The choice, and its reason.** Option A: drop the key from `test-db-drift`. What
  orders VAC-08 after `apply-test` is the wait, not the key. The wait checks a fact:
  the same-commit apply concluded, or none appeared, and the in-flight flag is clear.
  VAC-08 only reads, and no interleaving with a later writer can turn a real drift
  green. The worst case is a rare red that fails loudly. That red can already happen
  today, whichever job gets the lock first. The key bought it nothing and cost it the
  whole cross-run queue.
  Rejected: **B**, holding the key only around the reads, which does not shorten the
  queue ahead of the hold. **C**, taking the job off the aggregator or running it
  later, which breaks the aggregator contract or still blocks the aggregator. **C′**,
  dropping `needs: python`, which makes it queue behind `python` from the start and
  weakens the wait's appearance-grace assumption. **D**, a read-fence re-probe, which
  guards only against reds that already fail loudly.
  ⛔ **CORRECTED 2026-09-25 (Phase 164.4.2.1 round-1 review, SFH-01 / WR-01): "That red
  can already happen today … The key bought it nothing" is true for MERGE PUSHES ONLY,
  and is kept above as lineage.** On a `pull_request` run the wait does not run (its
  `if:` is merge-push only), so VAC-08 has **NO ordering against `apply-test` or a
  dispatched restore**. Before this phase the key was the only thing keeping a PR-run
  VAC-08 out of both, so on a PR the key did buy something, and three reds are new:
  a restore's `TRUNCATE` of the ledger holds the presence query past its retry budget
  (the "ledger presence query failed" MEASURE_FAIL); a body fetch races the restore's
  COMMIT or a later apply's function replace ("could not read TEST's definition"); and
  a multi-migration `apply-test` still in flight reads as a breach of
  `FRONTIER_EXEMPT_CEILING`. On a merge push there is also a seconds-wide window
  between the wait's exit and VAC-08's first read in which a later push's `apply-test`
  or a restore can start. None of this turns a real drift green: the restore is one
  transaction, and the frontier tip is computed from the checkout's own migrations.
  It was accepted on that basis: every added outcome is loud, restores are rare
  manual dispatches, and the key's cost was measured. **Triage:** a PR-run VAC-08 red
  while `supabase-migrate.yml` or `test-restore-from-baseline.yml` was running is
  this overlap. Re-run the PR check once both are idle. Do NOT widen the wait's `if:`
  to PR events: it keys on `GITHUB_SHA`'s own `supabase-migrate.yml` run, which never
  exists on a PR, so every PR run would sit out the appearance grace for nothing.
- **The numbers live in
  `.planning/phases/164.4.2.1-driftoffmutex/164.4.2.1-MEASUREMENT.md`**: the BEFORE,
  the prediction, the verdict rule and the AFTER protocol. The AFTER is filled in from
  merge-push runs after the merge. None of those numbers is restated here.

- **One holder removed.** `sql-tests` runs the `supabase/tests/test_*.sql` corpus on
  a local Supabase stack private to its own runner, booted by
  `scripts/local-stack/run.sh up`. It uses no secret, no repository variable and no
  advisory key, and it cannot reach shared TEST. If you are triaging the lock, you
  do not need to look at `sql-tests`.
- **VAC-08 moved, and its new job holds the key.** The repo-vs-TEST ledger and
  function-body drift check is about shared TEST by definition, so it could not move
  with the corpus. It now runs in a new `ci.yml` job, **`test-db-drift`**. That job
  took over the schema-apply wait, the mutex acquire / release / dead-holder-verdict
  steps, the fork-author and configured-variable gate, and a `needs: python` stagger.
- **The `ci.yml` holders are now `python`, `e2e-seeded` and `test-db-drift`.**
  Measured 2026-09-23 by occurrence of the key literal per job: `test-db-drift` 12,
  `python` 9, `e2e-seeded` 8, `sql-tests` 0. Each of the three has an acquire step and
  `timeout-minutes: 90`. `apply-test` and `restore` (section 1, below) are unchanged,
  so there are still five holders. The one that changed is `sql-tests`, replaced by
  `test-db-drift`. `src/__tests__/critical-regressions.test.ts` measures the `ci.yml`
  holder set from the file and compares it as an exact set, so a new holder cannot
  appear unlisted.
- **Contention is reduced, NOT eliminated.** Three `ci.yml` jobs and the two writers
  still share the key across every run and every workflow. The cross-run queue in
  section 2 still exists, with a shorter per-run lock-time.
- **The numbers live in the phase's `164.4.2-MEASUREMENT.md`**, under
  `.planning/phases/164.4.2-subsetsplit-sql-mutation-runs-only-the-changed-gate-files-on/`.
  That covers the BEFORE table, the prediction, the refutation condition decided in
  advance, and the AFTER table for all four jobs, which is filled in once merge-push
  runs exist at the new head. Read them there. None of them is restated here. When
  this section was written, the AFTER table had not been captured yet.

## 1. Mechanism

`sql-tests`, `python` and `e2e-seeded` each acquire **session advisory lock key
`61616158`** (issue #616 / phase 158) before their first DB-touching step, and
hold it for the rest of the job.
⛔ **CORRECTED 2026-09-23 (Phase 164.4.2):** the `ci.yml` jobs that acquire the key
are **`python`, `e2e-seeded` and `test-db-drift`**. `sql-tests` no longer does (see
section 0). The sentence above is kept as lineage.
⛔ **CORRECTED 2026-09-25 (Phase 164.4.2.1):** `test-db-drift` no longer acquires it
either. The `ci.yml` jobs that acquire the key are **`python` and `e2e-seeded`** (section
0). The 2026-09-23 note is kept as lineage. Waiters block inside `pg_advisory_lock`, so
contending runs queue instead of racing. Every mutex session opens with **both
session GUCs**: `SET statement_timeout = 0` — the TEST project's server-wide
`statement_timeout=120000` would otherwise kill a contended lock wait *and*
the idle hold at 120 s ([158-MUTEX-01], resolved — see §2) — and
`SET client_connection_check_interval = '30s'`, so a backend whose *client*
died mid-sleep or mid-lock-wait aborts within ~30 s instead of holding (or
queueing on) the lock as an immortal orphan ([158-MUTEX-02], resolved — see
§2).

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
- **How it is held:** a single background `psql` session sets both GUCs
  (`statement_timeout = 0`, `client_connection_check_interval = '30s'`), prints
  its backend pid (`HOLDER-BACKEND-PID`, consumed by the release step's
  server-side reap), then runs `SELECT pg_advisory_lock(61616158)` and idles
  for the duration of the job. Steps within a job share the runner, so the
  backgrounded session persists across steps. The lock is released when that
  session's *backend* ends: the release step kills the psql client **and**
  terminates the recorded server backend (guarded by an advisory-key check),
  and a backend that survives anyway (e.g. runner death) notices its dead
  client within ~30 s via `client_connection_check_interval`. Killing only the
  client does **not** end a backend mid-query ([158-MUTEX-02], §2).
- **How to spot it:** the holder session sets `PGAPPNAME=ci-shared-test-db-mutex`,
  so it is identifiable in `pg_stat_activity` (the probe workflow uses a
  different name, `ci-mutex-probe`).

⭐ **THERE ARE FIVE HOLDERS, NOT THREE — added 2026-09-09 by Phase 164.8 TESTPREPROD.**
⛔ **CORRECTED 2026-09-25 (Phase 164.4.2.1): there are now FOUR.** They are `python`,
`e2e-seeded`, `apply-test` and `restore`. `test-db-drift` left the key (section 0). The
heading and every "five" below are kept as lineage.
Two jobs outside `ci.yml` now take key `61616158`, and both write to shared TEST:

4. **`apply-test`** (`.github/workflows/supabase-migrate.yml`) — runs on every push to
   `main` that touches `supabase/migrations/**`, and on a `main`-only
   `workflow_dispatch`. It holds the lock across **marker check → dry-run plan →
   `supabase db push --include-all` → post-verify**, i.e. the whole apply, not per
   statement. `environment: Test`, no reviewers. Proven end-to-end by dispatch run
   `34367135073` at head `dbd1324690eb05f3d4a567e93eaca2323513ef3b`, which logged
   `Acquired the shared-test-db advisory lock (key 61616158) after 5s (attempt 1/3).`
5. **`restore`** (`.github/workflows/test-restore-from-baseline.yml`) — **dispatch-only**,
   founder-approved, destructive. It holds the lock across **backup → the whole
   drop/replay/ledger-seed transaction → post-verify**, deliberately spanning the act
   rather than its statements, so no other job can observe TEST mid-rebuild. First and so
   far only committed run: `34274355596` at head `88581b8b`.

⚠️ **BOTH ARE INDISTINGUISHABLE FROM `sql-tests` IN `pg_stat_activity`, and that is a
choice.** ⛔ **CORRECTED 2026-09-23 (Phase 164.4.2):** read "from `sql-tests`" as "from
the `ci.yml` holders (`python`, `e2e-seeded`, `test-db-drift`)". `sql-tests` no longer
opens a session on shared TEST at all, so in an incident census it never appears. The
five-holder argument below is unchanged. `test-db-drift`'s acquire step is the same
byte-identical copy, which `critical-regressions.test.ts` asserts.
⛔ **CORRECTED 2026-09-25 (Phase 164.4.2.1):** read the `ci.yml` holders as `python` and
`e2e-seeded` only. `test-db-drift` has no acquire step any more, so it never appears in a
census as a `ci-shared-test-db-mutex` session. The argument below holds unchanged for the
four remaining holders. The 2026-09-23 note is kept as lineage. Each sets the *same* `PGAPPNAME=ci-shared-test-db-mutex`, because each acquire
step is a byte-for-byte copy of `ci.yml`'s (the copy is deliberate and is pinned by
`src/__tests__/critical-regressions.test.ts`, which asserts the acquire steps are pairwise
identical). So in a census you can tell the five apart only by `query` and by timing, never
by `application_name`. **That is acceptable** rather than an oversight: the release step's
dead-holder witness and the `pg_locks`-guarded `pg_terminate_backend` are the same code in
every holder, so triage and cleanup do not depend on knowing WHICH job you are looking at.
Giving them distinct names would fork the byte-identical acquire step that the regression
test exists to keep identical — a worse trade than a census you have to read one column
further into.

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

- All three jobs carry a `timeout-minutes`. That is the TTL: it bounds the
  maximum possible hold. When GitHub kills a job at the timeout, the runner
  dies and the session's TCP path drops; the backend notices within ~30 s via
  `client_connection_check_interval` and aborts, releasing the lock. (A
  mid-statement backend does **not** notice a dead client on its own — before
  [158-MUTEX-02] this bullet silently depended on the server
  `statement_timeout` that [158-MUTEX-01] removed.)
- **The TTL only bounds the hold because the holder is built to outlive it.**
  The holder session is `psql … -c "SET statement_timeout = 0;" -c "SELECT
  pg_sleep(<n>)"`, and when that sleep returns, psql exits and Postgres
  releases the lock — *whether or not the job has finished*. So the invariant
  (158-REVIEW WR-01) has **three legs**, maintained by hand in `ci.yml` and
  checked by nothing at runtime: `pg_sleep > timeout-minutes`, the
  `timeout-minutes` TTL itself, **and** the session-level
  `SET statement_timeout = 0` (without it, TEST's server-wide 120 s statement
  kill ends the sleep — and any contended lock wait — long before either
  number matters; [158-MUTEX-01], next blockquote).
  A fourth, network-layer defense ([158-MUTEX-01] F2): the holder DSN carries
  libpq keepalives (`keepalives_idle=60`, `keepalives_interval=15`,
  `keepalives_count=4`), because both the lock wait and the idle hold carry
  zero application traffic — they keep runner-side NAT mappings fresh, and if
  the path dies anyway the client notices in ~2 min, so `psql` exits and the
  release step's dead-holder witness fires instead of the backend silently
  keeping the lock past the job.
  A fifth leg ([158-MUTEX-02]): `SET client_connection_check_interval = '30s'`
  in the same session. Zeroing `statement_timeout` removed the server's
  *accidental* ~120 s reaping of ORPHANED backends — a backend whose psql
  client died mid-`pg_sleep` (or mid-lock-wait) never reads its client socket
  and would otherwise keep the lock for the full 100-minute sleep. This GUC is
  the deliberate janitor: the backend polls its client socket during query
  execution *and* lock waits, and aborts within ~30 s of the client dying.
  Until this was fixed (158-REVIEW WR-01) the sleep was 55min against a 60min
  TTL — i.e. the hold could end up to 5 minutes BEFORE the job did, silently
  dropping mutual exclusion for a long job's final steps. If you change either
  number, change both. Current values are in the acquire step's own comment.

  > ✅ **Resolved — [158-MUTEX-01] (P0, found 2026-08-21, fixed 2026-08-21):**
  > this invariant used to be defeated on TEST by a server-side statement
  > kill. The TEST project sets server-wide `statement_timeout=120000`
  > ("configuration file" source in `pg_settings`; no role-level override),
  > which cancelled the holder's single-statement `SELECT pg_sleep(6000)` at
  > ~120 s — psql exited, the session dropped, and the lock released while the
  > job's DB work continued, so serialization covered only the first ~2
  > minutes of each job's DB span. The dead-holder `::error::` annotation
  > (next bullet) fired on every long job of the 2026-08-20/21 evidence runs
  > (e.g. run 32424762495). The same kill hit a contended `pg_advisory_lock`
  > wait at 120 s, and the acquire retry loop mislabelled that death as a
  > connect fault — capping real contention tolerance at ~3×120 s instead of
  > the 3600 s cap. Fixed by making `SET statement_timeout = 0` the session's
  > FIRST statement (session-level `SET` is permitted for any role and
  > overrides the configuration-file default), exempting both the lock wait
  > and the sleep. That is the invariant's third leg above, pinned in
  > `src/__tests__/critical-regressions.test.ts` (`SET` before
  > `pg_advisory_lock` in each of the three jobs, and the three acquire steps
  > asserted pairwise byte-identical).

  > ✅ **Resolved — [158-MUTEX-02] (P0, found 2026-08-21, fixed 2026-08-21):**
  > second-order consequence of the fix above, observed live on PR #701's CI
  > run 32457330139. The release step killed the holder's psql CLIENT and
  > printed the orderly release line — but killing a client does not kill a
  > backend mid-query: a backend executing `pg_sleep(6000)` never reads its
  > client socket, so the SERVER backend kept the lock. Before [158-MUTEX-01]
  > the server-wide `statement_timeout=120000` was the ACCIDENTAL janitor that
  > reaped such orphans at ~120 s; zeroing it made them immortal —
  > `sql-tests` and `e2e-seeded` starved on the lock and `e2e-seeded` failed
  > at its 3600 s acquire cap ("Lock census: 1 granted, 2 waiting"). (📜 A
  > 2026-08-21 incident record, kept as lineage. `sql-tests` left the key on
  > 2026-09-23 — section 0.) The same
  > mechanism leaves a waiter whose client died as a zombie queued on the lock
  > (a lock wait does not read the client socket either). Fixed two ways:
  > every mutex session now also sets
  > `client_connection_check_interval = '30s'` (verified `USERSET` on TEST
  > PG 17.6), so an orphaned backend aborts within ~30 s of its client dying —
  > during query execution AND lock waits — and the release step additionally
  > terminates the recorded holder backend server-side (`pg_terminate_backend`
  > guarded by a `pg_locks` check on key 61616158 + pid: a no-op if the
  > backend already exited or the pid was recycled). Both pinned in
  > `src/__tests__/critical-regressions.test.ts`.

- A holder that dies early is now reported: the release step emits a
  `::error::` annotation (never a non-zero exit) when the recorded pid is
  already gone, because that means DB work ran unserialized. It used to print a
  reassuring "already gone" line on exactly that path. With [158-MUTEX-01]
  fixed, this annotation has no known benign-looking cause left: it is
  unexpected and always worth investigating. The release step also reaps the
  holder's SERVER backend (recorded at acquire time as `HOLDER-BACKEND-PID`)
  via the `pg_locks`-guarded `pg_terminate_backend`, and logs whether the
  backend was still on the key — "STILL on key" means the client kill alone
  had not freed the lock, exactly the [158-MUTEX-02] orphan.

**The three numbers, and why they are what they are.** They are load-bearing on
each other; change one and you must re-derive the others.

| Number | Value | Constraint |
| --- | --- | --- |
| Acquire wait cap (`ci.yml` acquire loop) | `3600` s | ≥ worst-case legitimate queue: 3 concurrent runs × ~20 min of lock-time each, minus the waiter's own hold ≈ 60 min. Reachable only because the session zeroes `statement_timeout` first — before [158-MUTEX-01] the wait died at 120 s/attempt, so effective tolerance was ~3×120 s, not this cap |
| Job TTL (`timeout-minutes`) | `90` min | > setup + full acquire cap + the job's own work (~2 + 60 + ~12 ≈ 74 min) |
| Holder idle sleep (`pg_sleep`) | `6000` s (100 min) | **>** the job TTL, so the job always dies first (WR-01) — holds only with the session-level `SET statement_timeout = 0` ([158-MUTEX-01]); an ORPHANED backend mid-sleep is bounded by `client_connection_check_interval = '30s'`, not by any statement timeout ([158-MUTEX-02]) |
| Job TTL — `apply-test` (`supabase-migrate.yml:357`) | `90` min | Same derivation as the row above, copied rather than re-derived, so the acquire-cap arithmetic holds for this holder too (added 2026-09-09, Phase 164.8) |
| Job TTL — `restore` (`test-restore-from-baseline.yml:216`) | `90` min | Same derivation, same reason (added 2026-09-09, Phase 164.8) |

⛔ **"The three numbers" is FIVE TTLs against ONE acquire cap.** Raising the acquire
wait cap no longer moves three job timeouts — it moves **five**, in three files
(`ci.yml`, `supabase-migrate.yml`, `test-restore-from-baseline.yml`). Nothing at runtime
checks that they agree; the coupling is maintained by hand and by this table. Re-derive
all of them together or none of them.
⭐ **CHANGED 2026-09-19 — `analytics-deploy-verify.yml` LEFT THIS COUPLING and is no
longer a sixth number.** Its convergence window was deleted; see the block below.

Each CI run takes the lock three times — `python` (~7 min of pytest under the
lock), `e2e-seeded` (~8-9 min, spanning `npm run build` *and* the Playwright
batch), and `sql-tests` — so ~20 min of lock-time per run. The phase's success
criterion is that **three simultaneous runs serialize and all succeed**, which
is what the 3600 s cap is sized from.
📜 **LINEAGE — the Phase 158 lock-time arithmetic, superseded 2026-09-23 (Phase
164.4.2).** `sql-tests`' share of that ~20 min has left the key. `test-db-drift`
(VAC-08 only) took its place, with a different hold time. The cap and TTLs were
**not** re-derived, and that is deliberate: a shorter per-run hold only makes the
3600 s cap more conservative. The measured per-job holds are in
`164.4.2-MEASUREMENT.md` (section 0).
⛔ **CORRECTED 2026-09-25 (Phase 164.4.2.1):** `test-db-drift`'s share has left the key
too. Each run now takes the lock twice, in `python` and `e2e-seeded`. The cap and TTLs
were again not re-derived, for the same reason. The 2026-09-23 note is kept as lineage.

⭐ **THE FOURTH NUMBER WAS DELETED 2026-09-19. Do not re-derive it — do not
change anything in `analytics-deploy-verify.yml` when you move the acquire cap.**

📜 **What used to be here, and why it is gone.** That workflow carried a `4800` s
convergence window, derived from this table as the tolerance before it declares a
Railway deploy skipped and files a P1 `analytics-deploy-stale` issue: ~2 min setup
+ the 3600 s acquire cap + ~12 min of lock-held work ≈ 74 min, plus Railway's ~3 min
build ≈ 77 min. The derivation was sound and the instruction to keep it in step with
the cap was correct on its own terms.

⛔ **The derivation was answering the wrong question.** Railway waits on the whole
check-suite of a commit, and an INCOMPLETE suite withholds a deploy exactly like a red
one. So a probe that polls for up to 80 minutes IS a check suite held open on `main`
HEAD for up to 80 minutes — the probe became the deploy-hold it existed to detect.
MEASURED over the 15 runs to 2026-09-19: thirteen finished in under a minute, two ran
60m and 80m, and those two were the largest deploy-holds in the window.

⭐ **What replaces it, and why it does NOT depend on this table.** The probe now reads
ONCE and suppresses the alert only for a commit younger than **900 s**, measured from
the commit timestamp rather than by waiting. That number is sized from CI conclusion +
Railway build (≈ 8-11 min observed), NOT from the acquire cap — because the probe no
longer waits for anything, cross-run lock contention cannot make it alarm early. The
6-hourly schedule is the retry. **This is a deliberate DECOUPLING: a future change to
the acquire cap must not propagate there.**

A waiter that exhausts the cap fails its job. Because `sql-tests` is now
blocking the `frontend` aggregator, that means a red required check — and on a
push to `main`, a check-suite that is not green, so Railway skips the analytics
deploy.
⛔ **CORRECTED 2026-09-23 (Phase 164.4.2):** `sql-tests` no longer waits on the key,
so it cannot exhaust the cap. The waiters that can are `python`, `e2e-seeded` and
`test-db-drift`. `test-db-drift` is in the `frontend` aggregator's `needs:` and result
loop. Its row tolerates only a SKIP on a fork PR or a `workflow_dispatch`, so a
`failure` from an acquire timeout is a red required check on every event. The
consequence above therefore still holds; only the job name changed.
⛔ **CORRECTED 2026-09-25 (Phase 164.4.2.1):** `test-db-drift` no longer waits on the key
either. The waiters that can exhaust the cap are `python` and `e2e-seeded`. Both still
gate the check-suite, so the consequence still holds. `test-db-drift` can still go red
on its own schema-apply wait (`wait-outcome: wait-exhausted`, section 7.3). The
2026-09-23 note is kept as lineage. That is why the cap is sized for queue depth rather than left at a value
comparable to the work it has to absorb. The timeout message deliberately names
**both** queue depth and a wedged holder, and prints a `pg_locks` census
(granted/waiting counts) so triage starts from a measurement.
- The same release happens on any other job end: success, failure, or
  cancellation. **A cancelled job cannot leak the lock** — cancellation kills the
  runner, which drops the session.
- A waiter is granted the lock the instant it is released. *Which* waiter is not
  specified — see the ordering caveat in section 1.

The only case needing a human is a session that is alive but wedged (the runner
is gone, yet the backend lingers). `client_connection_check_interval` bounds
that linger at ~30 s in the normal case ([158-MUTEX-02]); a backend that
outlives its client by much more means the GUC did not stick to the session
(pooler interference, DSN-rewrite regression) — investigate that, and unlock
via section 3.

## 3. Manual unlock

⛔ **NEW SINCE 2026-09-09 — A WEDGED HOLDER NOW DELAYS A PRODUCTION DEPLOY.** Before
Phase 164.8, nothing about a PROD deploy depended on shared TEST; now
`supabase-migrate.yml`'s PROD `apply` job carries `needs.apply-test.result == 'success'`,
and `apply-test` cannot succeed while it is queued behind a wedged holder. So a stuck lock
on a database **this project does not own** sits between a merge and production. That
coupling was surfaced and ACCEPTED at decision time (Phase 164.8 `CONTEXT.md`, Area 1 Q2 ×
Area 4 Q3); the escape hatches — a bounded acquire that proceeds with a loud warning,
applying without the mutex, or gating PROD on apply FAILURE rather than apply
UNAVAILABILITY — are **founder decisions, not operator ones**. Do not improvise one at
3am.

➡️ **Therefore: when `apply-test-verdict` reports a TIMEOUT, run the census in this
section FIRST**, before touching the workflow or re-running the merge. It answers in one
query whether you are looking at a wedge (kill it, Steps 1-3) or at ordinary queue depth
(wait, and re-run once it drains) — and those two have opposite correct responses.

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
its acquire cap and redden its job. (A `granted = false` session that has been
sitting far longer than 120 s is normal, not stuck: every mutex session — the
three CI holders *and* the probe's contenders — sets both GUCs
(`statement_timeout = 0`, `client_connection_check_interval = '30s'`) before
contending, so the server never reaps a queued wait whose client is alive; a
waiter whose CLIENT died aborts within ~30 s — [158-MUTEX-01],
[158-MUTEX-02].) Postgres promises no arrival-order service
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

**One-shot census + full cleanup** (the exact SQL used live on 2026-08-21 to
clear the [158-MUTEX-02] orphan, run 32457330139). Census — every session on
the key, holder and waiters, with what each is doing:

```sql
SELECT l.granted, l.pid, a.state, a.query, a.backend_start
FROM pg_locks l
JOIN pg_stat_activity a ON a.pid = l.pid
WHERE l.locktype = 'advisory' AND l.objid = 61616158;
```

Cleanup — terminate EVERY session on the key, holder *and* waiters (each
affected CI job fails and is safe to rerun). Use when the queue itself is
poisoned by an orphan; for a routine unlock prefer Steps 1–3, which kill only
the holder:

```sql
SELECT pg_terminate_backend(l.pid)
FROM pg_locks l
WHERE l.locktype = 'advisory' AND l.objid = 61616158;
```

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
  ⛔ **CORRECTED 2026-09-23 (Phase 164.4.2):** it no longer has that clause, and it
  no longer needs one. `sql-tests` reads no secret and touches only its own
  runner's local stack. The fork-author clause moved with the secret to
  **`test-db-drift`**, whose job-level `if:` admits only a push or a same-repo PR,
  and requires the configured-TEST repository variable.
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

> ⚠️ **Run the drill when CI is QUIET.** The `contend` job carries
> `timeout-minutes: 15` and a single CI run holds this lock **~20 min**
> (§2 above), so a probe dispatched while real CI holds the mutex is *expected*
> to go red on its own job timeout: each contender sets both GUCs
> (`statement_timeout = 0`, `client_connection_check_interval = '30s'`)
> like every mutex session, so a contended leg blocks inside `pg_advisory_lock`
> until `timeout-minutes` kills the job — not until a 120 s statement kill —
> and the killed leg's backend leaves the wait queue within ~30 s instead of
> lingering as a zombie waiter ([158-MUTEX-02]).
> That is a scheduling artefact, **not** a broken mutex — check `gh run list --workflow=CI --branch main` first, and
> re-dispatch once the queue drains rather than escalating to §3's manual
> unlock. (158-REVIEW WR-06: the workflow header used to promise the probe
> "simply queues behind" real CI, which is what made this mis-triage likely.)

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

> ⚠️ **What the probe cannot see.** Its holds are ~45 s — far below the 120 s
> server `statement_timeout` — so the probe stayed green throughout the
> [158-MUTEX-01] incident, in which every *real* long-job holder died at
> ~120 s. A green drill proves contenders serialize; it does **not** prove a
> full-length hold survives. For that class, the witness is the release step's
> dead-holder `::error::` annotation on real CI jobs (§2).

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

## 7. TWO KEYS, TWO UNITS — and the ordering wait (added 2026-09-21, Phase 164.9)

⭐ **Everything above this section describes ONE key and is still correct about
it. It is kept as lineage.** What changed on 2026-09-21 is that a SECOND
advisory key now exists, protecting a DIFFERENT unit, and three jobs now WAIT
on a fact before they take the first key.

### 7.1 The two keys

| | key | unit it protects | who takes it | does anything BLOCK on it? |
|---|---|---|---|---|
| mutual-exclusion key | `61616158` | **the shared TEST database** | every DB-touching job | **YES** — contenders block inside `pg_advisory_lock` |
| schema-apply-in-flight **flag** | `SHARED_TEST_SCHEMA_APPLY_INFLIGHT_KEY` in `scripts/shared-test-db-keys.sh` | **"a schema apply against this project is in flight"** | the two schema WRITERS only | **NO — NOTHING BLOCKS ON IT** |

⛔ **The second one is a FLAG, not a lock, and the distinction is the whole
point.** It is HELD by the two schema writers for the duration of their apply
and READ — non-blockingly, out of `pg_locks` — by the readers. If you ever find
a job blocking on it, that is a defect: make the reader read, not wait.

⛔ **Cite the flag BY SYMBOL, never by value.** It is written once, in
`scripts/shared-test-db-keys.sh`, and `--self-test` there proves it is a single
live line and differs from `61616158`. The mutual-exclusion key deliberately
stays a literal at each of its existing call sites — it is a working mechanism
with its own probe drill (§5) and its own pinned occurrence counts, and
rewriting those call sites to gain a shared constant is risk taken for tidiness.

⛔ **Giving the writer its own lock INSTEAD would have been the wrong fix.** It
would make the writer stop excluding the readers, and Phase 164.8 Area 4
recorded a schema apply racing a running gate as the one collision that
CORRUPTS a reading rather than merely delaying it. Both writers still take
`61616158`, exactly as before.

### 7.2 Who takes the mutual-exclusion key — the corrected census

⚠️ **Section 1 names three jobs and the header corrects that to five. Both are
narrower than the truth at file level.** MEASURED 2026-09-21, by occurrence of
the literal:

| file | occurrences |
|---|---|
| `.github/workflows/ci.yml` | 27 |
| `.github/workflows/test-restore-from-baseline.yml` | 8 |
| `.github/workflows/supabase-migrate.yml` | 7 |
| `.github/workflows/mutex-probe.yml` | 4 |
| `.github/workflows/analytics-deploy-verify.yml` | 1 |

Plus four scripts that name it: `scripts/classify-changed-paths.mjs`,
`scripts/pg-lane/mutex-dead-holder-lane.sh`,
`scripts/restore-test-from-baseline.sh`, `scripts/test-ledger-drift-check.sh`.
⛔ Regenerate rather than trust this table — `grep -rlF 61616158
.github/workflows scripts` — and note that a reader planning a key change who
works from section 1's three-job picture will miss most of the call sites.
⛔ **CORRECTED 2026-09-23 (Phase 164.4.2): the table above is the 2026-09-21
reading, kept as lineage.** Re-measured with `grep -c 61616158` on 2026-09-23:
`ci.yml` **29** (`test-db-drift` 12, `python` 9, `e2e-seeded` 8, `sql-tests` 0),
`test-restore-from-baseline.yml` 8, `supabase-migrate.yml` 7, `mutex-probe.yml`
**5**, `analytics-deploy-verify.yml` 1. The rule above still applies: regenerate
this reading, don't trust it.
⛔ **CORRECTED 2026-09-25 (Phase 164.4.2.1): the 2026-09-23 reading above is kept as
lineage.** Re-measured with `grep -c 61616158` after `test-db-drift` left the key:
`ci.yml` **17** (`python` 9, `e2e-seeded` 8, `test-db-drift` 0, `sql-tests` 0),
`test-restore-from-baseline.yml` 8, `supabase-migrate.yml` 7, `mutex-probe.yml` 5,
`analytics-deploy-verify.yml` 1. The `ci.yml` jobs carrying
`Acquire shared-test-db mutex` are `python` and `e2e-seeded`. Regenerate it; don't
trust it.

### 7.3 The ordering wait, and its three outcomes

A mutex guarantees no two holders OVERLAP. It guarantees nothing about which
goes FIRST. On a merge push, `ci.yml`'s reader jobs and `supabase-migrate.yml`'s
`apply-test` contended for `61616158` with nothing ordering them — booked as
`[164.8-PUSH-RACE-VAC08]`. Ordering needed its own primitive, so `sql-tests`,
`python` and `e2e-seeded` each run
**`Wait for the TEST schema apply to conclude (merge pushes only)`**
IMMEDIATELY BEFORE their acquire step, invoking
`scripts/wait-for-test-schema-apply.sh`.
⛔ **CORRECTED 2026-09-23 (Phase 164.4.2):** the jobs that run that wait are now
**`python`, `e2e-seeded` and `test-db-drift`**. The wait moved out of `sql-tests`
together with its acquire step. `sql-tests` reads no shared schema, so it has nothing
to wait for.
⛔ **CORRECTED 2026-09-25 (Phase 164.4.2.1):** the three jobs above still run the wait,
but only `python` and `e2e-seeded` run it before an acquire step. `test-db-drift` has no
acquire step any more. For it the wait runs before VAC-08, and it is the ONLY ordering
control between VAC-08 and `apply-test`. `src/__tests__/critical-regressions.test.ts`
pins that order. The two "before their acquire step" sentences in this section are
kept as lineage and hold for `python` and `e2e-seeded`.
⛔ **CORRECTED 2026-09-25 (Phase 164.4.2.1 round-1 review, SFH-01):** "the ONLY
ordering control" holds on a merge push only. On a `pull_request` run the wait does
not run, so `test-db-drift` has NO ordering control against `apply-test` or a
restore at all (section 0 carries the consequence and the triage). The sentence
above is kept as lineage.

⛔ **It waits BEFORE taking the key, never while holding it.** A job that waited
while holding `61616158` would starve every other contender on a database other
people's CI writes to — including the apply it is waiting for.

⛔ **No `needs:` edge was added, and none may be.** The three jobs' `if:`
conditions diverge and a skipped `needs:` job skips its dependents; `ci.yml`
records that at length. The ordering IS the wait.

It makes two reads per poll — the in-flight FLAG (which is the ONLY signal that
sees `test-restore-from-baseline.yml`, since a dispatched restore produces no
Actions run on your commit), then the Actions API for the `apply-test` JOB on
this exact head commit. ⚠️ **The JOB, not the run:** that workflow's PROD `apply`
sits behind a HUMAN reviewer gate, so the RUN stays `in_progress` until somebody
clicks, and waiting on the run would wait on a person.

| outcome in the log | what happened | what YOU do |
|---|---|---|
| `wait-outcome: apply-concluded` | the apply for this commit finished. If it finished UNSUCCESSFULLY the line says so and the job proceeds anyway — that failure already carries its own red check, and reddening here would duplicate it under the wrong job's name. | nothing. If the line says unsuccessful, go read `supabase-migrate.yml`'s own red check; it is the authority. |
| `wait-outcome: no-apply-run` | no `supabase-migrate.yml` run appeared for this commit within the appearance grace AND the flag was clear. The ordinary case: the commit changed no migration, so that workflow never triggered. | nothing. |
| `::error::wait-outcome: wait-exhausted` | the budget ran out. The line names which condition was still true: a **held** flag (a TEST apply or a dispatched restore was still running) or a **running** apply state (its `apply-test` had not finished), or an **unknown**/**unreadable** read, which is a measurement failure and not a clean answer. | Find the other run. A held flag with no visible apply usually means a `test-restore-from-baseline.yml` dispatch is mid-restore — let it finish. A `running` apply usually means the apply is itself queued on `61616158`; triage with §§2–3 (count the waiters FIRST) and re-run once the queue drains. ⛔ Do not raise the budget to make it green. |

**Budgets** are constants at the top of `scripts/wait-for-test-schema-apply.sh`,
each with its derivation beside it. Read them BY SYMBOL. They are overridable by
environment variable so the script's `--self-test` can drive all three outcomes
in seconds; ⛔ setting them in a workflow to make a slow run green is the
widening this mechanism exists to avoid.

**Falsification.** `bash scripts/wait-for-test-schema-apply.sh --self-test`
drives every outcome through injectable seams and asserts each one BY NAME and
by exit code — including the calibration that an ABSENT apply with a HELD flag
must NOT read as `no-apply-run`, because that is the restore case and the flag
is the only thing standing between a reader and a `DROP SCHEMA`.
