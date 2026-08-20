---
phase: 158-ops-ci-a-merge-means-a-deploy
reviewed: 2026-08-20T21:10:00Z
depth: standard
files_reviewed: 19
files_reviewed_list:
  - .github/workflows/ci.yml
  - .github/workflows/main-ci-cancelled-watcher.yml
  - .github/workflows/mutex-probe.yml
  - analytics-service/tests/test_compute_jobs_fencing.py
  - docs/runbooks/README.md
  - docs/runbooks/shared-test-db-mutex.md
  - e2e/api-key-flow.spec.ts
  - e2e/csv-upload-flow.spec.ts
  - e2e/discovery-watchlist.spec.ts
  - e2e/for-quants-onboarding.spec.ts
  - e2e/full-flow.spec.ts
  - e2e/mandate-form.spec.ts
  - e2e/match-queue.spec.ts
  - e2e/my-strategies.spec.ts
  - e2e/sync-analytics-flow.spec.ts
  - e2e/wizard-hydration-probe.spec.ts
  - scripts/drain-test-compute-backlog.ts
  - src/__tests__/critical-regressions.test.ts
  - TODOS.md
findings:
  critical: 4
  warning: 13
  info: 0
  total: 17
status: issues_found
---

# Phase 158: Code Review Report

**Reviewed:** 2026-08-20T21:10:00Z
**Depth:** standard
**Files Reviewed:** 19
**Status:** issues_found

## Summary

The phase replaces the evictable `shared-test-db` GitHub concurrency group with a
Postgres session advisory lock, adds a falsifiability probe and a cancelled-main
watcher, promotes `sql-tests` into the `frontend` aggregator, and repairs/wires
five orphaned e2e specs. The mechanism analysis in the comments is unusually
strong, the `claimed_at` fix is correctly scoped (I verified no other live-DB
`running`-flip site exists — the remaining `"status": "running"` hits are offline
stub rows), the drain script's five interlocks are genuinely ordered before the
supabase-js import, and the re-baselined C-0293 pin executes and passes locally
(2 passed).

The defects cluster in three places:

1. **The probe and its runbook can themselves cause #616.** `mutex-probe.yml`
   accepts an unrestricted `workflow_dispatch`, whose default ref is `main`; the
   probe is designed to be able to fail; the runbook's documented drill dispatches
   it three times with no `--ref`. That is the exact red-check-on-main-HEAD trap
   the workflow's own header forbids for `push`. Worse, the drill as written
   cannot pass at all — the probe's own `cancel-in-progress: true` concurrency
   group makes back-to-back dispatches cancel each other.
2. **The mutex trades eviction for a hard-failing wait cap on a now-blocking
   gate.** The 2700 s acquire cap is comparable to the per-run serialized hold
   (~20 min across `python` + `e2e-seeded` + `sql-tests`), so ordinary CI queue
   depth would surface as a red `sql-tests` → red `frontend` → red main
   check-suite → skipped Railway deploy. Separately, the psql holder's
   `pg_sleep(3300)` is *shorter* than the 60-minute job TTL, so a long job can
   silently lose mutual exclusion for its last ~5 minutes and the release step
   prints a reassuring message when it does.
3. **The credential scrub is a point-fix over one surface.** The same literals
   remain plaintext at HEAD in tracked, world-readable files, and `.gitleaks.toml`
   path-allowlists the directory that holds most of them.

Two of the phase's own new load-bearing invariants (`timeout-minutes: 60`, and
`sql-tests` membership in the aggregator's `needs:`) are left unpinned, so they
can be removed without any gate noticing — the silent-green class this phase
exists to close.

## Critical Issues

### CR-01: `mutex-probe.yml` can put a red check on `main` HEAD via `workflow_dispatch`

**File:** `.github/workflows/mutex-probe.yml:18-22,40-44,61,151-154,182-187`
**Issue:** The header states the doctrine correctly — "⛔ NEVER add `main` … to the
push trigger. This probe CAN fail by design… A red check on a main-HEAD SHA makes
Railway treat that commit's check-suite as red and SKIP the deploy, recreating the
exact #616 failure this phase removes." The `push:` trigger honours that
(`ci-probe/**` only). The `workflow_dispatch:` trigger does not: it is
unrestricted, and `gh workflow run <file>` (and the Actions UI) default `--ref` to
the **default branch, `main`**. A dispatched run attaches its check runs to main
HEAD. The probe has at least three reachable non-zero exits — `contend` exits 1 on
a psql/connect failure (`:151-154`) or a missing ACQUIRED/RELEASED marker
(`:158-161`), `contend` fails on its 15-minute `timeout-minutes` if real CI is
holding the lock longer than that, and `assert-serialization` exits 1 on
`<3` windows or on overlap. Any of those on a main dispatch reproduces #616's
damage by a new route. The `⚠️` in the runbook only warns about a "deliberately-
failing probe variant", not about the ordinary probe's own failure paths.
**Fix:** gate the jobs off main, so a dispatch on the default branch cannot
produce a judgeable red check:

```yaml
jobs:
  contend:
    # The probe CAN fail by design; a red check on a main-HEAD SHA makes
    # Railway skip the analytics deploy (issue #616). Dispatch on a
    # `ci-probe/**` ref only.
    if: github.ref != format('refs/heads/{0}', github.event.repository.default_branch)
```

…and add the same `if:` to `assert-serialization` (keeping its `always()`), plus a
loud first step on main that `echo "::notice::dispatch this on a ci-probe/** ref"`
and exits 0. Update the runbook commands to `gh workflow run mutex-probe.yml --ref ci-probe/<name>`.

---

### CR-02: the runbook's probe drill is deterministically impossible — the probe's own concurrency group cancels 2 of the 3 runs

**File:** `docs/runbooks/shared-test-db-mutex.md:137-155`; `.github/workflows/mutex-probe.yml:51-53`
**Issue:** The runbook prescribes:

```bash
gh workflow run mutex-probe.yml   # ×3, same ref
```

and then asserts: "1. All three conclude **`success`**. Assert the literal string
`success` — never 'not failure'." But `mutex-probe.yml` declares:

```yaml
concurrency:
  group: mutex-probe-${{ github.ref }}
  cancel-in-progress: true
```

Three dispatches on the same ref land in the same group, so run 2 cancels run 1
and run 3 cancels run 2. The documented assertion can never hold: two of the three
conclude `cancelled` — the precise grey conclusion the runbook's own sentence says
must not be tolerated. Combined with CR-01 this also means the drill, as written,
manufactures cancelled *and* possibly red checks on main HEAD.

The drill is also redundant: the probe already provides three simultaneous
contenders **inside one run** (`strategy.matrix.contender: [1,2,3]` + the
`assert-serialization` non-overlap check at `:264-278`). The "three, not two"
reasoning applies to matrix members, not to separate runs.

**Fix:** replace §5's procedure with a single dispatch against a probe branch, and
assert on that one run:

```bash
git push origin HEAD:ci-probe/mutex-drill      # or: gh workflow run mutex-probe.yml --ref ci-probe/mutex-drill
gh run list --workflow=mutex-probe.yml --branch ci-probe/mutex-drill --limit 1 \
  --json databaseId,conclusion --jq '.[0] | select(.conclusion=="success") // error("not success")'
```

State explicitly that the three contenders are the matrix legs of one run, and
that `cancel-in-progress: true` means only the newest dispatch per ref survives.

---

### CR-03: the credential scrub closed one surface; the identical literals are still plaintext at HEAD in a PUBLIC repo, and gitleaks is configured not to see most of them

**File:** `e2e/for-quants-onboarding.spec.ts:31-41`, `e2e/wizard-hydration-probe.spec.ts:26-35`, `TODOS.md` (Phase-158 OPS-03 block)
**Issue:** The phase removed `matratzentester24@gmail.com / Test12` from four spec
files and states in TODOS "Deliberately not quoted here so this entry does not
re-publish them." Measured at HEAD, the same pair is still quoted verbatim in
**tracked** files:

```
.planning/milestones/v0.17.0.0-phases/13-discovery-v2-polish/13-01-PLAN.md:230,278
.planning/milestones/v0.17.0.0-phases/13-discovery-v2-polish/13-02-PLAN.md:758
.planning/milestones/v0.17.0.0-phases/13-discovery-v2-polish/13-04-PLAN.md:237-238
.planning/milestones/v0.17.0.0-phases/13-discovery-v2-polish/13-REVIEWS/grok-payload.md:465,513,1843,2185-2186
```

and the second scrubbed pair, `demo-allocator@quantalyze.test / DemoAlpha2026!`, is
still plaintext in:

```
scripts/seed-full-app-demo.ts:64-65
docs/demos/2026-04-09-full-app-walkthrough.md:19-20
CHANGELOG.md:11369
```

Two compounding factors: (a) `.gitleaks.toml`'s allowlist is **path-based over
`.planning/`**, so the secret-scan gate is structurally incapable of flagging the
largest cluster; (b) every one of these values is in git history regardless, so
text removal is not remediation — **rotation/disable of the accounts** is. The
phase artifacts record no rotation. Per the repo's own fix-campaign rule (close the
whole class across the surface, not point-fixes), this is not closed.

**Fix:**
1. Disable or rotate `matratzentester24@gmail.com` and `demo-allocator@quantalyze.test`
   on every project they exist in (TEST and any preview/PROD), and record the
   rotation — that is the only step that actually remediates a public leak.
2. Replace the `scripts/seed-full-app-demo.ts:64-65` literals with env reads
   (`DEMO_SEED_ALLOCATOR_EMAIL` / `_PASSWORD`, fail-loud when unset), and redact
   `docs/demos/2026-04-09-full-app-walkthrough.md:19-20`.
3. Run a **no-allowlist** gitleaks pass (`gitleaks detect --no-banner` with the
   `.planning/` path allowlist removed) and triage the `.planning/` hits, or scope
   the allowlist to entropy rules only rather than to the whole path.

---

### CR-04: cross-run queue depth on the new mutex can red a now-BLOCKING gate on `main`, skipping the very deploy this phase protects

**File:** `.github/workflows/ci.yml:1111,1427,1918` (wait cap) and `:780-791,843-863` (sql-tests made blocking)
**Issue:** The acquire loop hard-fails after 2700 s:

```bash
while [ "${waited}" -lt 2700 ]; do … done
echo "::error::timed out after ${waited}s waiting for the shared-test-db advisory lock (key 61616158) — a holder is wedged."
exit 1
```

That cap is not comfortably larger than the serialized work it must absorb. Each
CI run now takes the lock **three times**: `python` (~7 m of pytest under the
lock), `e2e-seeded` (lock held across `npm run build` *plus* a 25-file Playwright
batch — the phase added 3 more specs; the job's own historical wall-clock is
~8-9 m), and `sql-tests`. Call it ~20 min of lock-time per run. Two concurrent
runs put the last waiter at ~40 min; three exceed 45 min and the waiter exits 1.
The repo's own history records multi-run TEST-DB contention as a normal condition,
not an exotic one.

The consequences are worse than before this phase, because `sql-tests` is now in
the `frontend` aggregator's `needs:` and its strict arm (`:860-863`) treats any
non-`skipped` failure as a gate failure:

- On a **PR**: a red required check on an innocent PR, with a diagnostic that
  asserts something false ("a holder is wedged") when the real cause is queue
  depth.
- On a **push to `main`**: `sql-tests` red → `frontend` red → main HEAD
  check-suite not green → Railway's wait-for-CI skips the analytics deploy. That
  is #616's damage arriving through a different door, in the phase whose title is
  "a merge means a deploy".

The old concurrency group traded this for eviction; the new design trades it for a
hard fail. Neither is bounded by the design as written.

**Fix (pick one, and pin it):**
- Raise the wait cap to just under the job TTL and let the job timeout be the only
  failure mode: `while [ "${waited}" -lt 3300 ]` with `timeout-minutes: 60` — plus
  fix WR-01 so the holder's own `pg_sleep` outlives the job.
- Or make the timeout diagnostic honest and non-fatal-on-queue-depth by
  distinguishing "no holder / lock free but we still could not connect" from
  "another session holds it", e.g. query `pg_locks` for `granted = true` on
  `objid = 61616158` before declaring a wedge, and re-arm the wait once if a
  legitimate holder is present.
- Either way: shorten `e2e-seeded`'s hold. The lock currently spans `npm run
  build` (`:1968-1986`) and the full 25-spec Playwright batch; only the seed step
  and the specs need it. Splitting the build out (accepting the prerender caveat
  documented at `:1878-1883` by seeding, releasing, building, re-acquiring) would
  cut ~2 minutes off every run's serialized span.

## Warnings

### WR-01: the lock hold (`pg_sleep(3300)`) is SHORTER than the job TTL — a long job silently loses mutual exclusion, and the release step reports it as normal

**File:** `.github/workflows/ci.yml:1106,1422,1913` and `:925,1286,1783`; `docs/runbooks/shared-test-db-mutex.md:56-59`
**Issue:** The holder session runs `pg_advisory_lock(…)` → marker → `pg_sleep(3300)`
(55 min) and then **exits**, releasing the lock. The job's TTL is
`timeout-minutes: 60`. So for any job that acquires early and runs long, there is
a window of up to ~5 minutes in which the job is still doing DB work with the
mutex released and another run free to enter. Nothing detects this: no step
re-checks that the holder PID is alive after the acquire step, and the release step
actively masks it —

```bash
else
  echo "Mutex holder pid ${holder} was already gone — the session drop released the lock."
fi
```

— which prints a benign message on exactly the failure path. The runbook then
documents the model backwards: "All three jobs carry `timeout-minutes: 60`. That is
the TTL: it bounds the maximum possible hold." The maximum hold is 55 min, i.e.
the hold can end *before* the job does. `e2e-seeded` (build + 25 spec files at
`--timeout 60000`) is the realistic candidate.
**Fix:** make the hold outlive the job and add a liveness check:

```bash
-c "SELECT pg_sleep(4200);"      # > timeout-minutes: 60, so the job always dies first
```

and in the release step, treat a dead holder as an error annotation rather than an
"already gone" reassurance:

```bash
if kill "${holder}" 2>/dev/null; then
  echo "Released the shared-test-db mutex (terminated psql pid ${holder})."
else
  echo "::error::mutex holder pid ${holder} died BEFORE this release step — the DB work after its death ran UNSERIALIZED. Investigate before trusting this run's DB assertions."
fi
```

Then correct runbook §2 to state the real bound.

---

### WR-02: the phase's two other load-bearing invariants (`timeout-minutes`, `sql-tests` in the aggregator) are unpinned

**File:** `src/__tests__/critical-regressions.test.ts:1166-1207`; `.github/workflows/ci.yml:925,1286,1783,798-807`
**Issue:** The re-baselined pin asserts (a) all three DB jobs carry the acquire
step, (b) they agree on one key, (c) the group never returns. It does **not**
assert:

- `timeout-minutes: 60` on any of the three jobs. That value is the *entire* steal
  path — the runbook states "There is **no lock-reaper cron, and none is needed**"
  precisely because of it. Delete it and the job inherits GitHub's 360-minute
  default, so a wedged holder blocks every DB-touching CI job for six hours with
  no gate noticing.
- `sql-tests` being present in the `frontend` aggregator's `needs:` **and** in the
  result loop. That is the whole of OPS-02 ("present-and-failing with NOTHING
  gating on it"); removing either half silently restores the ungated state.

Both are exactly the silent-green class this phase exists to kill, and both are
one-line YAML edits away.
**Fix:** extend the existing describe:

```ts
it("all three DB-touching jobs carry the mutex TTL (timeout-minutes)", () => {
  const src = readText(".github/workflows/ci.yml");
  for (const job of DB_JOBS) {
    expectMatch(
      jobSlice(src, job),
      /^\s{4}timeout-minutes:\s*60$/m,
      `ci.yml ${job} lost timeout-minutes — it is the ONLY TTL on the advisory lock (no reaper cron exists), so a wedged holder would block every DB job for GitHub's 360m default`,
    );
  }
});

it("sql-tests gates the frontend aggregator in BOTH needs: and the result loop", () => {
  const src = readText(".github/workflows/ci.yml");
  const agg = jobSlice(src, "frontend");
  expectMatch(agg, /needs:[\s\S]*?- sql-tests/, "frontend aggregator dropped sql-tests from needs: — OPS-02 regressed to present-but-ungating");
  expectMatch(agg, /"sql-tests=\$\{\{ needs\.sql-tests\.result \}\}"/, "frontend aggregator dropped the sql-tests row from its result loop — needs: alone leaves it advisory");
});
```

---

### WR-03: the cancelled-main watcher's own concurrency group has the one-pending-slot eviction it exists to report

**File:** `.github/workflows/main-ci-cancelled-watcher.yml:61-63`
**Issue:**

```yaml
concurrency:
  group: main-ci-cancelled-watcher
  cancel-in-progress: false
```

This is the same GitHub layer whose semantics the file's own header quotes:
"GitHub Actions holds exactly ONE pending entry per concurrency group and CANCELS
it when a third request arrives." If three main-branch CI runs conclude
`cancelled` in quick succession — the burst condition the watcher exists to
detect — the middle watcher run is evicted and its detection is lost. Because
every watcher path exits 0 by design, the loss is completely silent. The
group is also **not ref-scoped**, so it is repo-global rather than per-SHA.
**Fix:** make the group per-observed-run so watcher instances never contend:

```yaml
concurrency:
  group: main-ci-cancelled-watcher-${{ github.event.workflow_run.id || github.run_id }}
  cancel-in-progress: false
```

The issue-dedup logic at `:188-234` already handles concurrent filing correctly
(list-then-comment-or-create), and a `createComment` race is benign.

---

### WR-04: an upstream `python` failure is reported by the aggregator as "E2E_TEST_DB_CONFIGURED was LOST"

**File:** `.github/workflows/ci.yml:843-863` (with `:1001-1002`)
**Issue:** `sql-tests` carries `needs: [python]`, and `python` is **not** in the
`frontend` aggregator's `needs:`. A skipped `needs:` job skips its dependents, so
a `python` failure produces `sql-tests=skipped`. The aggregator's sql-tests arm
then takes the strict branch (not a fork PR, not a dispatch) and emits:

```
::error::sql-tests result=skipped … On push/same-repo-PR a skip means E2E_TEST_DB_CONFIGURED was LOST
```

The gate correctly reddens, but the diagnostic names a cause that is false, and it
sends the operator to check a repository variable when the real signal is a red
`python` check on the same run. Given this repo's doctrine of fail-loud-and-accurate
diagnostics, a confidently wrong error message is a real cost.
**Fix:** distinguish the two skips by also reading `python`'s result:

```yaml
needs:
  - …
  - python
```
```bash
elif [ "$name" = "sql-tests" ]; then
  py='${{ needs.python.result }}'
  if [ "$result" = "skipped" ] && [ "$py" != "success" ]; then
    echo "::error::sql-tests skipped because its \`needs: python\` dependency result=$py. Fix python first; E2E_TEST_DB_CONFIGURED is NOT implicated."
    fail=1
  elif …
```

---

### WR-05: drain MODE 2's safety allowlist and its eligible population are unpaginated — the guard fails open

**File:** `scripts/drain-test-compute-backlog.ts:369-386,403-410,425-427,454-461`
**Issue:** Both MODE 2 reads are plain `.select()` with no `.range()`/`.limit()`
loop, while MODE 1 in the same file deliberately pages at `PAGE_SIZE = 1000`
(`:278-308`) — so the author already knew about the row cap. PostgREST applies a
server-side max-rows (1000 on Supabase by default) and **truncates silently**:

- `liveAllowlistIds()` builds the *safety* allowlist (`is_example` + `published`
  strategies' `api_key_id`s). If it truncates, keys that back durable demo
  strategies are absent from `allowlist` and are eligible to be flipped
  `disconnected_at = now()` at `:445-449`. A protective guard that silently fails
  **open** is worse than no guard, and the TEST project is exactly the polluted,
  high-row-count environment where truncation bites.
- `flipEligibility()`'s `eligible` array is likewise capped, so `proposed` is
  computed over a partial population and the closing line compares a truncated
  `eligible.length` against an *exact* `count`:
  `eligible BEFORE: 1000 → AFTER: 1400` is a printable outcome. OPS-04's entire
  close criterion is measured before/after counts, so this makes the evidence
  unreliable.

**Fix:** page both, or count-then-assert:

```ts
async function selectAllPages<T>(build: () => any): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < MAX_PAGES * PAGE_SIZE; from += PAGE_SIZE) {
    const { data, error } = await build().range(from, from + PAGE_SIZE - 1);
    if (error) die(error.message);
    const page = (data ?? []) as T[];
    out.push(...page);
    if (page.length < PAGE_SIZE) return out;
  }
  die("selectAllPages hit MAX_PAGES — refusing to act on a truncated set.");
}
```

and use an exact `head: true` count for the BEFORE number so BEFORE/AFTER are
measured the same way.

---

### WR-06: two of the five newly wired specs land in a lane that cannot fail

**File:** `.github/workflows/ci.yml:1601-1602,1650,798-807`
**Issue:** `api-key-flow.spec.ts` and `sync-analytics-flow.spec.ts` were wired into
the **unseeded `e2e` job**, whose test step carries `continue-on-error: true`
(`:1602`, kept deliberately for the placeholder-Supabase flake), and whose job is
**not** in the `frontend` aggregator's `needs:` list. So a regression these specs
detect produces a step annotation and nothing else — the job's conclusion stays
`success` and no merge gate moves. Phrased in the repo's required form: after this
change these two specs *would surface* a regression in a run log; they *would not*
have stopped it merging or deploying. The phase's framing ("orphaned specs… now
wired into CI batches") reads stronger than what the wiring buys. `full-flow`,
`csv-upload-flow` and `my-strategies` went to `e2e-seeded`, which *is* blocking —
that half is genuine.
**Fix:** either state the advisory status explicitly in the ci.yml comment at
`:1620-1630` and in TODOS, or move the two contract describes into a step without
`continue-on-error` (they are pure `request.post` contract assertions against
localhost — they do not touch the `placeholder.supabase.co` DNS path that motivated
the tolerance):

```yaml
- name: Run always-deterministic API contract specs (no continue-on-error)
  run: npx playwright test e2e/api-key-flow.spec.ts e2e/sync-analytics-flow.spec.ts
```

---

### WR-07: `api-key-flow`'s first contract test cannot distinguish the CSRF arm from the auth arm it exists to pin

**File:** `e2e/api-key-flow.spec.ts:44-56` (and the sibling at `e2e/sync-analytics-flow.spec.ts:47-54`)
**Issue:** The whole point of the `Origin` header addition is to probe *past* CSRF
to the auth contract. But this test asserts only:

```ts
expect(contentType).toContain("application/json");
expect(res.status()).not.toBe(307);
expect(body).toHaveProperty("error");
```

A CSRF rejection (`{ error: "Origin not allowed" }`, HTTP 403, JSON, not 307)
satisfies all three. If `NEXT_PUBLIC_ALLOWED_ORIGINS` is ever dropped from the job
env, or `PLAYWRIGHT_BASE_URL` drifts from the served origin, this test keeps
passing while measuring the wrong arm — the exact failure mode its own docblock
says it was repaired for. (The sibling tests at `:58-72` and `:74-84` *do* pin
`401` / `[400,401]`, so the batch as a whole is not vacuous — but this case
individually is.)
**Fix:** pin the negative explicitly:

```ts
expect(res.status(), "403 here means the Origin/allowlist wiring broke, not the auth contract").not.toBe(403);
```

---

### WR-08: the mutex log redaction only masks `scheme://user:pass@`; psql's own error text leaks the pooler host and DB username into a PUBLIC log

**File:** `.github/workflows/ci.yml:1118,1434,1925`; `.github/workflows/mutex-probe.yml:150`; `docs/runbooks/shared-test-db-mutex.md:11-13`
**Issue:** The redaction is:

```bash
sed -E 's#(postgres(ql)?://)[^@]*@#\1***@#g' "${log}" >&2
```

psql does not echo the DSN on failure; it emits its own shapes, none of which match
that pattern:

```
psql: error: connection to server at "aws-0-eu-central-1.pooler.supabase.com" (52.x.x.x), port 5432 failed: …
psql: error: … FATAL:  password authentication failed for user "postgres.qmnijlgmdhviwzwfyzlc"
```

So the acquire-failure path publishes the TEST project's pooler host, its IP, and
the DB username/project-ref to a public Actions log — while the runbook states
"never a DSN, host, username, or password, in this file or in **any CI log line**."
(Blast radius is reduced because the project ref is already committed publicly at
`ci.yml:1131` and `scripts/drain-test-compute-backlog.ts:94`, but the invariant as
written is not met.)
**Fix:** redact the actual shapes, or drop the raw text entirely:

```bash
sed -E -e 's#(postgres(ql)?://)[^@]*@#\1***@#g' \
       -e 's#(server at )"[^"]*"( \([^)]*\))?#\1"***"#g' \
       -e 's#(for user )"[^"]*"#\1"***"#g' "${log}" >&2 || true
```

Add the same to `mutex-probe.yml:150`.

---

### WR-09: the runbook asserts FIFO fairness as fact while the probe it cites explicitly refuses to assert it

**File:** `docs/runbooks/shared-test-db-mutex.md:24-25,63`; `.github/workflows/mutex-probe.yml:13,252-261`
**Issue:** The runbook states "Waiters block inside `pg_advisory_lock` in **arrival
order**, so contending runs queue instead of racing" and "The next **FIFO** waiter
is granted the lock the instant it is released." The probe that is supposed to be
the evidence for this says the opposite about what it proves:

```python
# FIFO observation (RESEARCH assumption A1) — LOGGED, never asserted.
print("FIFO note: observational only — the barrier collapses arrival spread below "
      "the resolution of these timestamps, so this is not an ordering assertion.")
```

Postgres documents no arrival-order or starvation guarantee for advisory locks.
Under this repo's "never claim what you did not measure" rule, the runbook
overclaims, and the claim is load-bearing: §3 tells the operator to leave
`granted = false` waiters alone because they are "queued jobs waiting their turn",
which is what makes CR-04's starvation scenario invisible in triage.
**Fix:** downgrade both sentences to what was measured — "Waiters block inside
`pg_advisory_lock` (mutual exclusion is proven by the probe; arrival-order fairness
is **not** asserted — Postgres gives no FIFO guarantee, and a long-queued waiter can
hit its 2700 s acquire cap)."

---

### WR-10: `analytics-deploy-verify.yml` still routes operators to a mechanism this phase deleted

**File:** `.github/workflows/analytics-deploy-verify.yml:149` (and `:83`)
**Issue:** The stale-deploy issue body still says: "Most likely the Railway deploy
was SKIPPED because the main CI check-suite was red/cancelled (a cancelled `python`
job under the `shared-test-db` concurrency group is a known cause)." That
concurrency group no longer exists anywhere in the repo (verified: zero
`group: shared-test-db` hits at HEAD). An operator following this text will look
for a group that isn't there and miss the new causes — mutex wait-cap timeout
(CR-04), or the `main-ci-cancelled` watcher issue. This is the counterpart file to
the runbook this phase added and should have been updated with it.
**Fix:** reword to point at `docs/runbooks/shared-test-db-mutex.md` §6, and mention
the advisory-lock timeout as the current cause of a red `python`/`sql-tests`.
(Non-blocking per the repo's stopping rule — log to TODOS if not fixed in-pass.)

---

### WR-11: `my-strategies.spec.ts` leaks two auth users per CI run; its prefix cleanup can also race a sibling worker

**File:** `e2e/my-strategies.spec.ts:47-49,73-77,89-90`
**Issue:** The spec mints two users via `seedTestAllocator({ role: "both" })` on
every run, and `afterAll` cleans **strategies by name prefix only**
(`cleanupStrategiesByNamePrefix(NAME_PREFIX)`). The two `auth.users` rows (and
whatever the helper attaches to them) are never removed, so this adds 2 permanent
artifacts per CI run to the shared TEST project — in the same phase whose OPS-04
half exists because TEST artifacts accumulate without bound. It does follow the
established convention (`composer-axe`, `composite-onboarding`, `axe-app-wide` all
leak the same way), so this is drift the phase inherited rather than invented — but
authoring a *new* leaker while shipping a drain script is worth a conscious
decision, not a default.

Second, smaller point: `NAME_PREFIX` is a fixed literal, not per-worker. Under
`fullyParallel`, one worker's `afterAll` deletes by prefix while another worker may
still be asserting on rows under the same prefix. Only the single test in this file
creates rows today, so it is latent rather than live.
**Fix:** either register the seeded user ids for teardown (`afterAll` →
`admin.auth.admin.deleteUser(id)` for `ownerA.userId` / `ownB.userId`), or record
the decision in TODOS alongside the OPS-04 entries so the accumulation is tracked
rather than silent. For the prefix, scope it per-run:
`const NAME_PREFIX = \`e2e-mystrat-${process.env.TEST_PARALLEL_INDEX ?? 0}-\`;`

---

### WR-12: `full-flow.spec.ts`'s replacement assertion is close to unfalsifiable

**File:** `e2e/full-flow.spec.ts:73-75`
**Issue:** The old `text=Verified by Quantalyze` assertion was correctly identified
as a global-DB-state bet and replaced with:

```ts
await expect(page.locator("text=Institutional Factsheet").first()).toBeVisible();
await expect(page.locator("h1").first()).not.toBeEmpty();
```

The masthead check is fine. `not.toBeEmpty()` on `h1` is not: it passes for any
non-empty text node, including a skeleton placeholder, a `—` dash, or a generic
page title. It cannot fail for any realistic regression of "the factsheet resolved
the strategy I clicked". Since the test *does* know which strategy it navigated to
(`strategyId` at the call site), it can assert something falsifiable.
**Fix:** assert the identity the test itself established:

```ts
// The h1 must name a strategy, not a skeleton/placeholder — falsifiable
// against the id THIS test navigated to.
await expect(page.locator("h1").first()).not.toHaveText(/^\s*(—|-|Loading|Untitled)?\s*$/);
await expect(page.locator(`[data-strategy-id="${strategyId}"]`).first()).toBeAttached();
```

(or capture the strategy name from the browse row before navigating and assert the
`h1` contains it).

---

### WR-13: the mutex acquire is the only network step in `ci.yml` with no retry, and it now hard-fails a blocking gate

**File:** `.github/workflows/ci.yml:1102-1120,1418-1436,1909-1927`
**Issue:** Every other network operation in this workflow retries 3-4× with backoff
by explicit "flakiness audit" decision — `npm ci` (`:78-87`), `pip install`
(`:1327-1335`), the lychee download (`:1260-1271`), the SRH readiness poll
(`:465-483`). The mutex acquire does not: a single transient connect failure inside
`PGCONNECT_TIMEOUT=15` kills the backgrounded psql, the loop sees
`! kill -0 "${holder}"`, and the step exits 1. In `sql-tests` that is now a red
required check; on `main` that is a skipped Railway deploy. This is inconsistent
with the file's own documented convention for exactly this class of failure.
**Fix:** retry the acquire like its neighbours:

```bash
for attempt in 1 2 3; do
  start_holder            # the nohup psql block, factored into a function
  wait_for_marker && exit 0
  echo "mutex acquire attempt ${attempt} lost its session (transient?); retrying in $((attempt*5))s"
  sleep $((attempt*5))
done
echo "::error::could not establish the mutex session after 3 attempts."
exit 1
```

(and distinguish "session died" — retryable — from "waited past the cap" —
not retryable, see CR-04).

---

_Reviewed: 2026-08-20T21:10:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
