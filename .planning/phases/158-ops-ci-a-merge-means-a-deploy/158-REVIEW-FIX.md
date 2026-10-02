---
phase: 158-ops-ci-a-merge-means-a-deploy
fixed_at: 2026-08-20T23:22:00Z
review_path: .planning/phases/158-ops-ci-a-merge-means-a-deploy/158-REVIEW.md
iteration: 3
covers_iterations: [1, 3]
findings_in_scope: 24
fixed: 24
skipped: 0
status: all_fixed
iteration_breakdown:
  - iteration: 1
    review: 158-REVIEW.iter3.md
    in_scope: 17
    fixed: 17
    skipped: 0
  - iteration: 3
    review: 158-REVIEW.md
    in_scope: 7
    fixed: 7
    skipped: 0
---

# Phase 158: Code Review Fix Report (cumulative — iterations 1 + 3)

**Fixed at:** 2026-08-20T23:22:00Z
**Source review (this round):** `.planning/phases/158-ops-ci-a-merge-means-a-deploy/158-REVIEW.md`
**Iteration:** 3 (final round of the `--fix` auto loop)
**Branch:** `feat/v1.20-phase-158`

This report is **cumulative**. Iteration 1 closed the original 17 findings;
iteration 3 closes the 7 residual findings the re-review raised against the
iteration-1 fix round's own new code paths. Both rounds are recorded below —
iteration 3 first, since it is the delta against the review you are holding.

**Summary (both rounds):**

| Round | In scope | Fixed | Skipped |
| --- | --- | --- | --- |
| Iteration 1 (17 findings: 4 critical + 13 warning) | 17 | 17 | 0 |
| Iteration 3 (7 findings: 1 blocker + 6 warning) | 7 | 7 | 0 |
| **Total** | **24** | **24** | **0** |

`fix_scope: critical_warning` in both rounds (no Info findings were in scope).

## Verification

**Where it ran:** the **main checkout**
(`<repo-root>`), not an isolated worktree.
`workflow.use_worktrees` is `true` in config, but the orchestrator explicitly
directed "main tree, no branch switching", and a hand-rolled GSD worktree has no
`node_modules` — `npx vitest` exits `MODULE_NOT_FOUND` and `npx tsc` resolves an
unrelated package there, so the required gates below **cannot** run in one. The
numbers are therefore reproducible from the tree you are looking at.

### Gates — iteration 3 (run at final HEAD `c5be8a08`)

| Gate | Command | Result |
| --- | --- | --- |
| Regression pins | `PATH=/opt/homebrew/opt/node@22/bin:$PATH npx vitest run src/__tests__/critical-regressions.test.ts --no-file-parallelism` | **1 file, 143 passed**, 658 ms |
| Typecheck | `npx tsc --noEmit -p tsconfig.json` | clean, exit 0 |
| Workflow lint | `actionlint` on the 4 touched workflows | clean except one **pre-existing** `SC2129`¹ |
| Secret scan | `gitleaks git . --log-opts=65e1cc52..HEAD --config .gitleaks.toml` | 7 commits scanned, **no leaks found** |
| Secret scan (allowlist-blind) | same range, **no `--config`** | 7 commits scanned, **no leaks found**² |

¹ `main-ci-cancelled-watcher.yml` `SC2129`. **Proved** pre-existing rather than
asserted: `actionlint` on `git show 65e1cc52:.github/workflows/main-ci-cancelled-watcher.yml`
reports the identical finding at line 107; it moved to 124 only because my
comment shifted it.
² Run without the repo config because this repo's gitleaks allowlist is
path-based; a config-blind pass is the only one that can see a leak the
allowlist would have suppressed. Both passes are clean.

### Phase invariants re-verified at final HEAD

| Invariant | Result |
| --- | --- |
| The three `ci.yml` acquire blocks are byte-identical | ✅ 3 blocks extracted by regex, **1 distinct** |
| Mutex key `61616158` parity | ✅ 6 sites (3 `pg_advisory_lock` + 3 `objid`), one distinct value |
| No `shared-test-db` concurrency group | ✅ 0 hits across the 11 `group:` declarations in `.github/workflows/` |
| No new `needs:` edges | ✅ 0 added in `65e1cc52..HEAD` |
| `cap < TTL < sleep` in workflows **and** runbook §2 | ✅ `3600 < 5400 (90 min) < 6000` in all three jobs; runbook §2 states the same three numbers |
| Watcher / probe can never red a main-HEAD check | ✅ **now closed** — WR-03 bounded the watcher job and made its ornamental checkout non-fatal; the same 360-min route was closed on `analytics-deploy-verify.yml` under WR-04 |
| CI Node 22 | ✅ 12 `node-version: 22` declarations, untouched |
| Repo PUBLIC — no new secrets | ✅ **CR-01 closed** — see the grep below |

**CR-01 gate at HEAD** (`git grep` for both pairs, tracked files, excluding `.planning/`):

```
src/__tests__/e2e-match-queue-no-vacuous-admin-gate.test.ts:67,71,72
```

That is the **only** tracked hit outside `.planning/`, and it is exactly the
anti-vacuity needle the reviewer explicitly sanctioned and asked not to change.
`TODOS.md` no longer matches.

### Neuter drills (every new check proved able to fail)

The repo rule is that a check which cannot go red is worse than no check. Each
new check added this round was drilled once — RED observed, then restored.

| Check | Drill | RED observed |
| --- | --- | --- |
| WR-01 census bound | stub `psql` that connects and never answers, running the literal committed lines under `bash` | bounded: returns at **20 s**, `census=[unavailable]`, step proceeds. Neutered (bound removed): runs to the stub's full duration — **unbounded** |
| WR-02 last-attempt guard | the acquire loop **extracted verbatim** from `ci.yml`, stub `psql` on the die-always path, cap scaled 3600→40 so the branch boundary is reachable in seconds | HEAD: no phantom "retrying", correct session-fault message at 30 s. Neutered: prints "retrying in 15s", `waited=45 ≥ cap 40`, takes the **cap branch** and misreports a session fault as **contention** — the exact defect WR-02 predicted |
| WR-03 `continue-on-error` on checkout | ran the C-0293 `persist-credentials` block-walk against the edited file, then removed the `with:` block | **1 failed \| 142 passed**, restored → 143 green. The guard still bites; `continue-on-error` did not make it vacuous |
| WR-05 allowlist cross-check | the **real** `liveAllowlistIds` (committed file, only its `main()` self-invocation suppressed) against a stub server truncating at 500 while `PAGE_SIZE` is 1000, true population 1200 | HEAD: **refuses**, exit 1. Neutered: returns 500 ids, exit 0 — **700 protected keys silently dropped** from the safety allowlist and made flip-eligible |

**Not executed at runtime** (no live TEST DB / no built server in this session):
the drain script against a real project, and the Playwright assertions from
iteration 1's WR-07 / WR-12. Each is noted under its finding with what *was*
measured instead. The mutex sizing remains arithmetic plus simulation — the
first true test is this phase's own CI run.

## Fixed Issues — iteration 3 (this round)

### CR-01 [blocker]: the credential-scrub commit re-published both pairs in `TODOS.md`

**Files modified:** `TODOS.md`
**Commit:** `790345b4`

Commit `65e1cc52` removed both pairs from the live surfaces and, **in the same
commit**, pasted both verbatim into the new TODOS entry documenting the scrub —
reversing that file's own recorded "deliberately not quoted here so this entry
does not re-publish them" convention and moving the literals onto the project's
root-level, world-readable front-door backlog.

Rewritten to name the two accounts by **role** and by the **files** they were
formerly hardcoded in, with zero literal emails or passwords:

- **Pair A** — the shared e2e login identity, formerly in
  `e2e/for-quants-onboarding.spec.ts`, `e2e/discovery-watchlist.spec.ts`,
  `e2e/match-queue.spec.ts`; values at commit `11041327`.
- **Pair B** — the `seed-full-app-demo` allocator identity, formerly in
  `scripts/seed-full-app-demo.ts` + the demo doc + CHANGELOG; values at `65e1cc52`.

Two things beyond the literal removal:

1. **A second literal was caught that the review's own grep line did not show.**
   The entry's "Still open beyond rotation" clause also named pair A's username
   in prose (`the matratzentester24 pair remains quoted in …`). Removing only
   the two lines the review cited would have left that one behind and failed the
   repo-wide gate. It now reads "pair A".
2. **The stale claim was corrected, not just the text.** The entry asserted the
   live-surface grep was clean except the test fixture — false at HEAD because
   of that same commit. It now states the one permitted hit with its line range
   and says explicitly why the anti-vacuity exception does not extend to a prose
   backlog entry (an absence assertion needs a needle; a ticket does not).

Rotation remains the only real remediation and stays open, unchanged.

### WR-01: the `pg_locks` census could hang for the rest of the 90-minute TTL

**Files modified:** `.github/workflows/ci.yml` (3 sites, byte-identical)
**Commit:** `f8299e83`

`PGCONNECT_TIMEOUT` bounds only the **connect**. Once connected the census had no
`statement_timeout` and no client-side wrapper, so against a sick TEST
Postgres/pooler — the single condition under which this timeout is most likely —
it blocked until `timeout-minutes: 90` killed the runner, giving the operator
*less* information than before the census existed and squatting a runner for
~30 extra minutes while holding no lock.

**Two** bounds, because they cover different faults: `SET statement_timeout = '10s'`
is server-side (slow or lock-blocked query); `timeout 20` is client-side (a
black-holed connection the server never hears about, where a server-side timeout
can never fire). `head -1` → `tail -1` so the result line is taken regardless of
any command-status line psql emits first.

**Deviation:** the review's patch put `SET` and the `SELECT` in one `-c`; I used
two `-c` flags. `SET` is session-level so it persists across them, and this
matches `start_holder`'s existing multi-`-c` style in the same file.

### WR-02: the acquire loop printed "retrying" and slept 15 s **after** the final attempt

**Files modified:** `.github/workflows/ci.yml` (3 sites, byte-identical)
**Commit:** `9e050f55`

Guarded with `if [ "${attempt}" -lt 3 ]`. The log no longer promises a fourth
attempt that never comes, and — the material half — the phantom 15 s is no longer
added to `waited`, the variable the cap-vs-session-fault branch is selected by.

The drill reproduced **both** predicted costs, including the one that is easy to
dismiss on paper: neutered, a pure session fault crosses the cap on backoff
bookkeeping alone and is reported as **lock contention**, sending triage to hunt
for a holder that does not exist.

### WR-03: the watcher had no `timeout-minutes`, retaining a route to the red main-HEAD check its header forbids

**Files modified:** `.github/workflows/main-ci-cancelled-watcher.yml`
**Commit:** `c91f787d`

The invariant is about the job **conclusion**, not just script exit codes. Two
non-script routes closed:

- `report-cancelled` inherited GitHub's **360-minute** default → `timeout-minutes: 10`,
  mirroring `mutex-probe.yml`, which bounds all three of its jobs for this reason.
- `actions/checkout` failing failed the job. That step exists *only* to satisfy
  the C-0293 grep invariant — its own comment says the job does not need the repo
  — so the highest-probability red route was bought for nothing. Now
  `continue-on-error: true`; nothing downstream reads the working tree.

The third route (the `github-script` action download itself failing) cannot be
closed without dropping the action; the timeout now caps its damage.

### WR-04: the 1800 s convergence window was not re-derived against CR-04's numbers

**Files modified:** `.github/workflows/analytics-deploy-verify.yml`, `docs/runbooks/shared-test-db-mutex.md`
**Commit:** `01a4afb9`

CR-04 moved the acquire cap 2700 → **3600 s** and the TTL 60 → **90 min**; the
window stayed at 1800 s. Since Railway waits on the whole check-suite, the
phase's own worst-case *legitimate* latency is ~2 min setup + 3600 s cap + ~12
min lock-held work ≈ 74 min, plus Railway's ~3 min build ≈ **77 min** — against a
30-minute tolerance. Window → **4800 s (80 min)**, with the derivation written
into the comment and marked re-derive-when-the-cap-changes.

**Deviation from the review's suggested 4500 s, and why:** 4500 s = 75 min is
*below* the ~77 min the runbook's own arithmetic yields, leaving a narrow
false-P1 band open. 4800 s covers it with headroom.

Two coherence fixes the number change forces:

- `verify` now declares `timeout-minutes: 90`. It **must** exceed the 80-min
  window or the job dies mid-poll and never reaches the issue-filing step —
  losing the loud signal exactly when it matters. Making it explicit also closes,
  on this file, the same 360-min route WR-03 closed on the watcher.
- Runbook §2 now records that a **fourth** number in another file depends on its
  three, with the derivation and a change-both warning. The one-sided edit this
  finding is about was possible precisely because that coupling was undocumented.

### WR-05: the safety allowlist had no exact-count cross-check, so it could still fail open

**Files modified:** `scripts/drain-test-compute-backlog.ts`
**Commit:** `789f5941`

`selectAllPages` ends on `rows.length < PAGE_SIZE` and `PAGE_SIZE` is 1000 —
exactly PostgREST's default `max-rows`, making the end-of-set signal
indistinguishable from the truncation cap. `flipEligibility` already
cross-checked against an exact `head: true` count; `liveAllowlistIds` did not,
and it is the *more* dangerous read: a truncated allowlist omits the
`api_key_id`s backing `is_example`/`published` demo strategies, which then become
eligible to be flipped `disconnected_at = now()`.

Both arms of the allowlist loop now take an exact count with the same filters and
`die()` on mismatch.

**Deviation:** the review offered "either the cross-check **or** lower `PAGE_SIZE`
to 500". I took the cross-check: a smaller page only makes truncation *less
likely*, while the count **detects** it — and this is a guard whose failure mode
is silent.

### WR-06: two adjacent comments in `mutex-probe.yml` gave opposite predictions

**Files modified:** `.github/workflows/mutex-probe.yml`, `docs/runbooks/shared-test-db-mutex.md`
**Commit:** `c5be8a08`

Line 30 said real CI can blow through the probe's `timeout-minutes`; line 47 said
the probe "simply queues behind it". The reassuring one is false: `contend`
carries `timeout-minutes: 15` and a CI run holds the lock ~20 min, so a probe
dispatched into a busy window is **expected** to red on its own timeout.

The cost note now separates the two claims that were conflated — the probe is
**safe** to dispatch any time (no tables, no row locks) but is **not certain to
pass** — and warns against the tempting wrong fix of raising `timeout-minutes`
past the hold. Runbook §5 gets the same warning **at the point of use**, since
the header comment is not what an operator running the drill actually reads.

Non-blocking under the repo's stopping rule; fixed in-pass since the file was
already open. Dropped the line citation rather than adding an integer that goes
stale on the next edit.

## Fixed Issues — iteration 1 (carried forward)

Full detail as recorded at the time. Verbatim from the iteration-1 report; a
snapshot also survives at `158-REVIEW-FIX.iter3.md`. The iteration-3 re-review
independently re-derived all 17 and found **16 correctly and completely closed**,
with CR-03's residue becoming this round's CR-01.

### CR-01: `mutex-probe.yml` can put a red check on `main` HEAD via `workflow_dispatch`

**Files modified:** `.github/workflows/mutex-probe.yml`
**Commit:** `4db37473`
Both real jobs now require `startsWith(github.ref, 'refs/heads/ci-probe/')`; a new
`dispatch-guard` job covers every other ref, prints the correct command and exits 0,
so the run concludes `success` rather than `skipped`. The ref gate is **ANDed into**
`assert-serialization`'s `always()` — a bare `always()` there is worse than no gate,
since with `contend` skipped it would download zero artifacts and take its exit-1
"found 0 windows" path on *every* main dispatch.

**Phase invariant preserved:** `workflow_dispatch` is retained (CR-02's drill uses it
with `--ref`); the probe cannot redden main HEAD.

### CR-02: the runbook's probe drill is deterministically impossible

**Files modified:** `docs/runbooks/shared-test-db-mutex.md`
**Commit:** `9e83cba1`
§5 replaced: one dispatch against `ci-probe/mutex-drill`, asserting the literal string
`success` on that single run. Documents that the three contenders are matrix legs of
one run and that `cancel-in-progress: true` means only the newest dispatch per ref
survives. Reads the window table from `assert-serialization` (database clock) instead
of re-deriving from job timings (runner-clock skew).

### CR-03: credential scrub was a point-fix; gitleaks is configured not to see most of it

**Files modified:** `scripts/seed-full-app-demo.ts`, `docs/demos/2026-04-09-full-app-walkthrough.md`,
`CHANGELOG.md`, `.gitleaks.toml`, `src/__tests__/e2e-match-queue-no-vacuous-admin-gate.test.ts`, `TODOS.md`
**Commit:** `65e1cc52`
**Status: fixed — text surfaces only. Rotation NOT done (see below).**

- Seeder credentials are env-derived (`DEMO_SEED_ALLOCATOR_EMAIL` /
  `DEMO_SEED_ALLOCATOR_PASSWORD`), resolved with the other interlocks in `main()` so a
  missing var fails **before** any network call. No default, by design. The completion
  summary no longer echoes the password. The script's function is preserved.
- Demo doc and CHANGELOG entry redacted, each noting the values persist in git history.
- `.gitleaks.toml`: `.planning/` was allowlisted **by path**, which exempts it from
  *every* rule. Now scoped to `generic-api-key` only (11 of the 12 measured hits).

**Falsifiability measured, not assumed.** A real RSA private key planted in a
`.planning/` file: **detected** under the new config; under the old config the file was
not even scanned (`~0 bytes`). That is the finding's claim reproduced and closed.

**Two traps hit and recorded in the config:** gitleaks ≥ 8.30 refuses `[allowlist]`
alongside `[[allowlists]]` (singular block converted to array form, behaviour
unchanged); and the jwt-fixture allowlist needs `condition = "AND"` — with the default
OR it suppressed the `jwt` rule *globally* and **broke the H-0017 meta-test**, which
plants that exact fixture at a non-allowlisted path and asserts the rule fires. Caught
by running that test; fixed; it now passes.

**Deliberate exception:** the literals in
`src/__tests__/e2e-match-queue-no-vacuous-admin-gate.test.ts` are **retained**. They are
the needle of an *absence* assertion — removing them makes every assertion in that file
pass unconditionally. That is the named anti-vacuity exception; documented in place.

**⛔ ROTATION IS A HUMAN ACTION AND WAS NOT PERFORMED.** Both pairs remain in git
history and must be treated as **published** until the accounts are disabled/rotated on
every project (TEST, preview, PROD). No agent can do this. Logged in `TODOS.md`; do not
read the commits above as remediation.

**Scope held per instruction:** `.planning/phases/**` historical artifacts were **not**
scrubbed beyond the live surface the finding named. The residual `matratzentester24`
occurrences in `.planning/milestones/v0.17.0.0-phases/13-*` and
`v0.16.0.0-phases/11-PATTERNS.md` are left to **v1.20's SEC-02 requirement**, which owns
the full sweep — recorded in `TODOS.md`.

### CR-04: cross-run queue depth can red a now-BLOCKING gate on `main`

**Files modified:** `.github/workflows/ci.yml`, `docs/runbooks/shared-test-db-mutex.md`
**Commit:** `c1da306d`
Sized from the hold times the review measured (~20 min of lock-time per run × 3
concurrent runs ⇒ ~8 holds ≈ 60 min ahead of the last waiter):

| | before | after |
| --- | --- | --- |
| acquire cap | 2700 s | **3600 s** |
| `timeout-minutes` | 60 | **90** |
| `pg_sleep` | 3300 s | 6000 s (WR-01) |

The phase's success criterion (three simultaneous runs serialize and **all succeed**)
now holds arithmetically: `cap < TTL < sleep` verified programmatically for all three jobs.
The timeout message no longer asserts "a holder is wedged" — it runs a `pg_locks` census
(granted/waiting **counts** only; no pids, host or DSN, stderr discarded) and **names queue
depth first**, then a wedged holder. Runbook §2 gains the three-number table and the
constraints linking them.

**Accepted trade, stated explicitly:** raising the TTL widens the worst-case *wedged* hold
to 90 min. Runbook §3 is the manual override.

**Not done — third bullet of the suggested fix.** Splitting `npm run build` out of
`e2e-seeded`'s hold (seed → release → build → re-acquire) would shorten the serialized
span by ~2 min, but the build **prerenders from the DB** (caveat documented in-file), so
releasing the lock across it lets a concurrent run mutate the data being prerendered.
That is a correctness risk traded for ~2 minutes, and the cap increase already satisfies
the success criterion. Recorded here rather than done silently.

### WR-01: the lock hold is SHORTER than the job TTL; the release step masks it

**Files modified:** `.github/workflows/ci.yml`, `docs/runbooks/shared-test-db-mutex.md`
**Commit:** `0f613a59`
`pg_sleep(3300)` → `pg_sleep(6000)` at all three sites, with the `sleep > TTL` invariant
carried as a ⛔ comment (nothing enforces it at runtime — hence the WR-02 pin). The
release step's else-branch now emits `::error::` naming that the post-death DB work ran
**unserialized**, instead of the reassuring "already gone" it printed on exactly that
failure path. Annotation only — the step is `if: always()` and must never redden a job
whose real work passed. Runbook §2 corrected (it had the model backwards).

### WR-02: the phase's two other load-bearing invariants are unpinned

**Files modified:** `src/__tests__/critical-regressions.test.ts`
**Commit:** `ce87391b`
Three pins added (140 → 143 tests): `timeout-minutes` on all three DB jobs; the
`pg_sleep > TTL` **relationship** (pinned as a relation, not either literal, because the
failure it guards is invisible downstream); and `sql-tests` in **both** the `frontend`
aggregator's `needs:` and its result loop.

**Every pin neuter-drilled once and observed RED, then restored** — `timeout-minutes`
90→60, `pg_sleep` 6000→3300, `- sql-tests` deleted from `needs:`, and the sql-tests row
deleted from the result loop. `git status` confirmed clean restore.

### WR-03: the watcher's own concurrency group has the eviction it exists to report

**Files modified:** `.github/workflows/main-ci-cancelled-watcher.yml`
**Commit:** `037e18a7`
Group keyed per observed run (`github.event.workflow_run.id || github.run_id`), so
watcher instances never contend. Issue dedup is a separate, already-correct mechanism and
a `createComment` race is benign, so dropping cross-run serialization costs nothing.

### WR-04: an upstream `python` failure is reported as "E2E_TEST_DB_CONFIGURED was LOST"

**Files modified:** `.github/workflows/ci.yml`
**Commit:** `db0458ec`
Skip and failure paths split into separate messages; the skip message names both causes in
check-order — `needs: python` first (cheapest to check, and the more common), the repo
variable second.

**Deviation from the suggested fix, deliberate.** The review proposed adding `python` to
the aggregator's `needs:` to read `needs.python.result`. The phase's binding invariant
forbids new `needs:` edges among the DB-touching jobs (their `if:` conditions diverge on
`workflow_dispatch`), so the wording fix closes the finding's actual complaint — a
diagnostic that asserts something false — without touching the job graph.

**Verified by simulating the loop** over all five cases (skipped-on-push, failure-on-push,
skipped-on-fork-PR, skipped-on-dispatch, success): exit codes unchanged, only the
diagnostic text differs.

### WR-05: drain MODE 2's safety allowlist and eligible population are unpaginated

**Files modified:** `scripts/drain-test-compute-backlog.ts`
**Commit:** `e37b0c7b`
Adds `selectAllPages()`, which pages to exhaustion and **refuses** (`die`) at `MAX_PAGES`
rather than acting on a knowingly partial set. Both call sites gain `.order("id")` (range
paging without a stable sort can repeat or skip rows). The BEFORE number is now an exact
`head: true` count taken the same way as AFTER, and a mismatch between the paged read and
that count **dies** rather than proposing a flip against an inconsistent population.

**Verified by extracting the committed function text** and running it against a stub:
totals 0 / 1 / 999 / 1000 / 1001 / 2500 / 3000 all return complete, unique sets (including
the exact-multiple off-by-one traps), `MAX_PAGES` overflow refuses, and a mid-stream error
dies instead of shorting the set.

### WR-06: two of the five newly wired specs land in a lane that cannot fail

**Files modified:** `.github/workflows/ci.yml`, `TODOS.md`
**Commit:** `54bc116c`
Both the ci.yml comment and TODOS now state it in the repo's required form: these two
specs **would surface** a regression in a run log; they **would not** have stopped it
merging or deploying — for two independent reasons (`continue-on-error: true`, *and* the
`e2e` job being in no aggregator's `needs:`, which I verified directly).

**Took the review's first option, not its second, deliberately.** Moving the specs into a
blocking lane is only sound with a **measured** run in the target env; 158-05 measured
them green under the *unseeded* placeholder env, which is not evidence about the seeded
job's env. Promoting an unverified spec into a required check is how a gate reddens on an
innocent PR. The exact route to close it is logged in `TODOS.md`.

### WR-07: `api-key-flow`'s first contract test cannot distinguish the CSRF arm

**Files modified:** `e2e/api-key-flow.spec.ts`, `e2e/sync-analytics-flow.spec.ts`
**Commit:** `2569d715`
Each first case now pins `expect(res.status()).not.toBe(403)` with a message naming the
wiring to check. A CSRF rejection is JSON, is not a 307, and has an `error` property — so
without this the cases passed just as happily when measuring the wrong arm.
**Not executed at runtime** (needs a built server + job env); `tsc` clean and
`playwright test --list` enumerates all 30 tests across both files.

### WR-08: log redaction misses the shapes psql actually emits

**Files modified:** `.github/workflows/ci.yml`, `.github/workflows/mutex-probe.yml`
**Commit:** `48723344`
Two `-e` clauses added at all four sites (`server at "<host>" (<ip>)` and
`for user "<user>"`).
**Measured against a stubbed psql emitting both real shapes:** host, IP and username
occurrences in the step output went **3 → 0**, and the old pattern was confirmed to redact
**neither** — so the leak was reproduced before it was closed.

### WR-09: the runbook asserts FIFO fairness the probe refuses to assert

**Files modified:** `docs/runbooks/shared-test-db-mutex.md`
**Commit:** `76049ae6`
§1 now separates what is measured (mutual exclusion, by the probe) from what is not
(arrival-order fairness); §§2-3 drop the "FIFO"/"waiting their turn" wording. The claim was
load-bearing, not cosmetic: §3 told the operator to leave `granted = false` waiters alone
as "queued jobs waiting their turn", which made CR-04's starvation invisible in triage.
§3 now tells the operator to **count** the waiters and names queue depth as a distinct
fault from a wedged holder.

### WR-10: `analytics-deploy-verify.yml` routes operators to a deleted mechanism

**Files modified:** `.github/workflows/analytics-deploy-verify.yml`, `docs/runbooks/railway-worker.md`
**Commit:** `0af36dbc`
Both live surfaces updated — `railway-worker.md` carried the identical stale sentence while
being cross-referenced *by* the new mutex runbook, so fixing only the file the finding named
would have left the class open. Each now names the real causes and keeps an explicit note
that the concurrency group was **deleted** and why, so an operator arriving from a stale
bookmark is told the text was wrong rather than left searching.

> Logged for completeness: the review marked this non-blocking per the repo's stopping
> rule. Fixed in-pass anyway, since it is a two-file doc change with real triage cost.

### WR-11: `my-strategies.spec.ts` leaks two auth users per run; prefix can race

**Files modified:** `e2e/my-strategies.spec.ts`, `TODOS.md`
**Commit:** `62104b44`
**Fixed:** `NAME_PREFIX` scoped per worker via `TEST_PARALLEL_INDEX`, closing the latent
teardown race while it is still cheap.
**Logged, not fixed — recorded decision:** the `auth.users` leak. It is the *established*
convention, not drift this phase invented (`composer-axe`, `composite-onboarding`,
`axe-app-wide` all do the same; `seed-test-project.ts` calls `auth.admin.createUser` in
**four** places and `deleteUser` in **none** — verified). Deleting users from this one spec
would fork the convention in one file rather than close the class; doing it properly means
adding teardown to the shared helper and auditing the FK cascade for every caller. Recorded
in the spec's `afterAll` docblock and in `TODOS.md`, with the note that the OPS-04 drain
script does **not** cover this door (it targets `compute_jobs` and `api_keys`, not
`auth.users`) and that the close must be measured by count.

### WR-12: `full-flow.spec.ts`'s replacement assertion is close to unfalsifiable

**Files modified:** `e2e/full-flow.spec.ts`
**Commit:** `9974b475`
Captures the browse row's link text before navigating (the locator goes stale on `goto`)
and asserts the factsheet `h1` contains it.

**Deviation from the suggested selector, forced by measurement.** The review proposed
`[data-strategy-id="${strategyId}"]`, but **no such attribute exists anywhere under
`src/app/factsheet/`** (verified) — that assertion would have failed against a correct
page. Used the review's own parenthetical alternative instead. The two values are directly
comparable: `StrategyTable` renders `{s.name}` as the anchor body and `FactsheetView`'s
masthead renders `payload.strategyName`.
Preserves the property that made the replacement correct: it asserts what **this test**
established, not what the shared, polluted TEST DB happens to contain.
**Not executed at runtime**; `tsc` and `eslint` clean, `--list` enumerates all 10 tests.

### WR-13: the mutex acquire is the only network step with no retry

**Files modified:** `.github/workflows/ci.yml`
**Commit:** `704f8e0a`
`start_holder()` factored out and wrapped in a 3-attempt loop with 5/10/15 s backoff. The
two failure modes are kept **distinct**: "session died" is retryable; "waited past the cap"
is not (that is contention — retrying would re-queue at the back). `waited` is **cumulative**
across attempts, so retries can never extend the total wait beyond the cap the TTL was
sized against. The pidfile is dropped before each retry so the release step cannot kill an
unrelated process that inherits the number.

**Verified by simulation against a stubbed psql across all four paths:**
acquire-first-try (exit 0, attempt 1/3), **die-twice-then-acquire (exit 0, attempt 3/3 —
this case exited 1 before the fix)**, die-always (exit 1, connect-fault message), and
never-granted (exit 1, timeout + census message).

## Skipped Issues

**None — all 24 in-scope findings across both rounds were fixed.**

Findings that are **partially** closed by design, with the remainder tracked
rather than dropped. Listed so the phase is not read as fully closed:

| Finding | Round | Closed in-pass | Tracked remainder |
| --- | --- | --- | --- |
| CR-03 → CR-01 | 1, 3 | text surfaces, gitleaks scoping, and (this round) the ticket that was itself re-publishing them | **account rotation — human action, no agent can do it**; `.planning/` sweep → v1.20 SEC-02 |
| WR-06 (iter 1) | 1 | accurate status in `ci.yml` + TODOS | promotion to a blocking lane, after a measured run |
| WR-11 (iter 1) | 1 | per-worker prefix | `auth.users` teardown in the shared helper |
| WR-03 (iter 3) | 3 | job timeout + non-fatal ornamental checkout | the `github-script` action **download** failing is still a red route; bounded, not eliminated |

## Notes for the reviewer

- **Three deviations from the review's suggested patches this round**, each
  argued at its finding: WR-01 (two `-c` flags rather than one multi-statement
  `-c`), WR-04 (**4800 s, not the suggested 4500 s** — 4500 sits below the
  runbook's own ~77 min worst case), WR-05 (cross-check rather than the offered
  `PAGE_SIZE` reduction, because detection beats making truncation less likely).
- **Scope taken slightly beyond the letter of two findings, deliberately.**
  WR-03's fix also made the ornamental checkout non-fatal (the review's Fix block
  asked for it; the orchestrator's direction named only `timeout-minutes`), and
  WR-04's fix also bounded `analytics-deploy-verify.yml`'s own job and amended
  runbook §2. Both are the repo's close-the-whole-class rule rather than
  point-fixes: the 360-minute-default route existed identically on both
  never-red-main-HEAD workflows, and the cross-file coupling WR-04 is about was
  invisible because it was undocumented.
- **A literal the review's grep line did not display was caught by re-running the
  gate.** CR-01's fix removed a third occurrence of pair A (in prose, in the same
  entry's "Still open" clause). Fixing only the two cited lines would have left
  the repo-wide gate red. Worth noting because the review's own summary of the
  grep was abridged.
- **`.planning/milestone.lock` is untracked and was left alone**, as were
  `STATE.md` and `ROADMAP.md`. Every file was staged individually — no `git add -A`.
- **This report is NOT committed**, per the orchestrator's instruction; the seven
  fix commits are.
- **Still not verified end-to-end:** the mutex sizing is arithmetic plus
  simulation, not a real three-concurrent-run CI observation. The first true test
  is this phase's own CI run — watch it rather than assuming.

---

_Fixed: 2026-08-20T23:22:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iterations covered: 1 + 3 (final round of the `--fix` auto loop)_
_Commits this round: `790345b4`, `f8299e83`, `9e050f55`, `c91f787d`, `01a4afb9`, `789f5941`, `c5be8a08`_
