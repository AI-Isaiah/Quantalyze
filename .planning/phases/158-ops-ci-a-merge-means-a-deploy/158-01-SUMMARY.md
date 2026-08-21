---
phase: 158-ops-ci-a-merge-means-a-deploy
plan: 01
subsystem: infra
tags: [github-actions, ci, postgres, advisory-lock, supavisor, mutex, concurrency]

# Dependency graph
requires:
  - phase: 142.1
    provides: "the shared-test-db concurrency group on sql-tests (D-05) — the layer this plan removes"
  - phase: 146.2
    provides: "the v1.19 CI baseline this plan edits (ci.yml at HEAD 35c7414)"
provides:
  - "A Postgres session advisory-lock mutex (key 61616158) serializing the three DB-touching CI jobs, replacing GitHub's evicting concurrency group"
  - ".github/workflows/mutex-probe.yml — the falsifiable 3-contender serialization proof, kept in-tree as the runbook drill"
  - "sql-tests wired into the frontend aggregator in BOTH places, with fork-PR + workflow_dispatch skip tolerance"
affects: [158-02 runbook and cancelled-watcher, 158-03 drain script, 158-06 batch lists, any future ci.yml job touching the TEST project]

# Actuals (#2632) — chars/4 over the realized diff (47,886 chars).
# For reference, chars/4 over the full content of both changed files is ~36,846.
actuals:
  tokens: 11972
  tasks: 3
  commits: 3

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "External FIFO mutex via pg_advisory_lock held by a background psql session across CI steps"
    - "Session-mode DSN derivation (pooler :6543 -> :5432) by shell parameter expansion, value never echoed"
    - "Simultaneity barrier + barrier-equality assertion so a serialization proof cannot pass by non-contention"

key-files:
  created:
    - .github/workflows/mutex-probe.yml
  modified:
    - .github/workflows/ci.yml

key-decisions:
  - "Advisory-lock backend CONFIRMED GO: session mode is reachable from GitHub runners on port 5432 of the same Supavisor pooler host; the ben-z/gh-action-mutex [SUS] fallback was not needed and was not adopted"
  - "Lock key 61616158 (issue #616 / phase 158) is shared by all three jobs — a per-job key would be the same mistake as a per-job concurrency group"
  - "TTL = job-level timeout-minutes: 60; the steal path is session drop on job kill, plus a best-effort if: always() release step. No reaper cron"
  - "The probe keeps a simultaneity barrier and REFUSES to pass when contenders did not align on it — a non-overlap result from non-simultaneous contenders proves nothing"
  - "e2e-seeded acquires the lock immediately before the seed step even though the Next build follows it (~1-2m of extra hold): reordering the build ahead of the seed would prerender public routes against an unseeded DB"

patterns-established:
  - "Mutex acquire/release step pair: byte-identical run body in all three DB-touching jobs, fork no-op arm first, DSN never echoed, psql stderr redacted through sed before it reaches a public log"
  - "Aggregator skip-tolerance arm keyed on the job's own if: divergence (fork PR OR workflow_dispatch for sql-tests, fork PR only for e2e-seeded)"

requirements-completed: [OPS-01, OPS-02]

coverage:
  - id: D1
    description: "Three simultaneous contenders serialize on the shared-test-db advisory lock, and the assertion that proves it can fail"
    requirement: "OPS-01"
    verification:
      - kind: e2e
        ref: "https://github.com/AI-Isaiah/Quantalyze/actions/runs/32390070135 (same-key GREEN — windows [081,126] [126,171] [171,216], zero overlap, one shared barrier)"
        status: pass
      - kind: e2e
        ref: "https://github.com/AI-Isaiah/Quantalyze/actions/runs/32389730596 (distinct-key NEUTER — assert-serialization concluded failure with 44-45s overlaps)"
        status: pass
      - kind: other
        ref: "local both-polarity dry run of the assertion script: serialized=0, overlapping=1, missing-window=1, barrier-skew=1"
        status: pass
    human_judgment: false
  - id: D2
    description: "ci.yml's sql-tests / python / e2e-seeded jobs serialize through the advisory-lock mutex with a 60-minute TTL and a fork no-op arm; the evicting concurrency group is gone"
    requirement: "OPS-01"
    verification:
      - kind: other
        ref: "acceptance gate script: 0 non-comment shared-test-db group mappings, 3x pg_advisory_lock(61616158), 3x PGAPPNAME=ci-shared-test-db-mutex, 3x timeout-minutes: 60, acquire immediately precedes each job's first DB-mutating step, three run bodies byte-identical, needs: lists unchanged"
        status: pass
      - kind: other
        ref: "actionlint .github/workflows/ci.yml .github/workflows/mutex-probe.yml (rc=0, shellcheck-backed); bash -n over every run block"
        status: pass
    human_judgment: true
    rationale: "The mechanism is proven from real runners by the probe, but the ADOPTED steps inside ci.yml have not yet executed in a real CI run — the phase PR's first run (and the post-merge 3x dispatch in the plan's phase-gate) is what proves the acquire step works in situ, including the fork arm and the release step."
  - id: D3
    description: "A failing sql-tests reddens the frontend aggregator on trusted events, while fork PRs and workflow_dispatch (where it skips by design) stay green"
    requirement: "OPS-02"
    verification:
      - kind: other
        ref: "both-polarity harness against the REAL aggregator loop body: 4 green cases (push all-success, fork-PR skip, dispatch skip) and 5 red cases (sql-tests failure on push, skip on push, skip on same-repo PR, failure on dispatch, plus the untouched e2e-seeded and strict-default arms)"
        status: pass
      - kind: other
        ref: "actionlint needs-reference check — a typo'd needs.sql-tests-typo.result is rejected, proving sql-tests is genuinely in the frontend job's needs object"
        status: pass
    human_judgment: true
    rationale: "Plan phase-gate requires the both-polarity proof on a LIVE CI run (plant a failing supabase/tests assertion on the phase PR, observe frontend RED with sql-tests=failure; then a workflow_dispatch run green with sql-tests=skipped). The local harness exercises the real loop body but not GitHub's own expression substitution."

# Metrics
duration: 40 min
completed: 2026-08-20
status: complete
---

# Phase 158 Plan 01: Shared-test-db mutex + sql-tests gating Summary

**GitHub's evicting `shared-test-db` concurrency group is gone, replaced by a Postgres session advisory lock (key 61616158) proven to serialize three simultaneous CI contenders on real runners, and `sql-tests` now blocks the `frontend` aggregator instead of failing with nothing gating on it.**

## Performance

- **Duration:** ~40 min
- **Started:** 2026-08-20T15:48Z (approx — first read of the plan)
- **Completed:** 2026-08-20T16:28Z
- **Tasks:** 3
- **Files modified:** 2 (1 created, 1 modified)

## Accomplishments

- **RESEARCH assumption A2 settled GO.** The `TEST_SUPABASE_DB_URL` secret points at the Supavisor pooler on `:6543` (transaction mode). Rewriting the port to `:5432` yields a working session-mode connection from GitHub runners on which `pg_advisory_lock` genuinely serializes. The `ben-z/gh-action-mutex` [SUS] fallback branch was **not** taken and no third-party action was added.
- **The eviction layer is removed, not shrunk.** All three `concurrency: group: shared-test-db` blocks are deleted; zero non-comment group mappings remain. Each of `sql-tests`, `python`, `e2e-seeded` now acquires the same advisory lock before its first DB-mutating step, carries `timeout-minutes: 60` as the TTL/steal bound, and releases best-effort on `if: always()`.
- **The proof is falsifiable and stays in-tree.** `mutex-probe.yml` was observed RED under a distinct-key neuter (44–45 s overlaps) before the same-key version was observed GREEN with three abutting, non-overlapping 45 s windows.
- **OPS-02 closed structurally.** `sql-tests` is in the aggregator's `needs:` **and** its result loop, with a tolerance arm that accepts `skipped` only on a fork PR or a `workflow_dispatch`.

## Task Commits

1. **Task 1 (tracer): mutex probe workflow, proven RED→GREEN** — `879d5a18` (feat)
2. **Task 2: adopt the mutex in ci.yml, remove the three concurrency blocks** — `24ebffed` (fix)
3. **Task 3: gate sql-tests through the frontend aggregator** — `873401f0` (fix)

_The Task 1 commit was first pushed as a NEUTERED distinct-key variant to observe RED, then amended to the same-key version, so the branch carries only the correct probe._

## Probe evidence (both polarities)

| Polarity | Run | Conclusion | Observation |
|---|---|---|---|
| RED (neuter: `pg_advisory_lock(61616158 + contender)`) | [32389730596](https://github.com/AI-Isaiah/Quantalyze/actions/runs/32389730596) | `failure` | `contender 1 still held the lock at …886 when contender 3 acquired it at …841 (overlap 45s)`; second pair overlapped 44 s |
| GREEN (same key `61616158`) | [32390070135](https://github.com/AI-Isaiah/Quantalyze/actions/runs/32390070135) | `success` (all 4 jobs) | barrier `1787242080` shared by all three; windows `[…081,…126] […126,…171] […171,…216]`, 45 s each, zero overlap; matrix jobs finished 2m39s / 3m23s / 4m6s — the 45 s stagger |

The throwaway ref was deleted (`git ls-remote origin 'refs/heads/ci-probe/*'` returns empty). Both runs are attached to `ci-probe/158-mutex` SHAs, never to main.

**FIFO (RESEARCH A1) — honestly unproven.** Acquisition order was `[3, 2, 1]` against an arrival order that is unresolvable (all three arrivals share one barrier second). The probe therefore **logs** the ordering and explicitly disclaims it as an assertion. Mutual exclusion is proven; arrival-order fairness is not, and nothing in this design depends on it.

## Acquire-step placement anchors

| Job | Acquire sits immediately before | Release |
|---|---|---|
| `sql-tests` | `Run SQL self-tests against test Supabase project` (after the psql install + Finding-6 preflight) | last step of the job |
| `python` | the `pytest --cov=services …` run (after `mypy --strict`) | last step of the job |
| `e2e-seeded` | `Seed demo data into test Supabase` | last step of the job |

Verified structurally (step index +1 must be the named step), not by eyeballing.

## The aggregator arm

```bash
elif [ "$name" = "sql-tests" ]; then
  is_fork_pr='${{ github.event_name == 'pull_request' && … != github.repository }}'
  is_dispatch='${{ github.event_name == 'workflow_dispatch' }}'
  if [ "$result" = "success" ]; then :
  elif [ "$result" = "skipped" ] && { [ "$is_fork_pr" = "true" ] || [ "$is_dispatch" = "true" ]; }; then
    echo "sql-tests skipped (…); tolerated for this row only."
  else
    echo "::error::sql-tests result=$result (fork_pr=…, dispatch=…). …"; fail=1
  fi
```

The divergence from the `e2e-seeded` arm is the `is_dispatch` clause: `sql-tests`' `if:` requires `push` or a same-repo PR, so it skips on manual dispatch (the golden-bake route) where `e2e-seeded` runs.

## PR text for closing #616

> **Closes #616.**
>
> Closed on the MECHANISM, not on prod having converged. Two mechanisms produced that incident and both are gone. (1) The **eviction layer**: `sql-tests`, `python` and `e2e-seeded` shared a GitHub `concurrency` group, which holds exactly ONE pending entry — so when a third contender arrived it cancelled the queued run, which concluded `cancelled` (a GREY check, not a red one) and made Railway's wait-for-CI treat the merge SHA's check-suite as failed and silently skip the analytics deploy. That group is **removed**, not shrunk (shrinking cannot help: the eviction is cross-run, so fewer members only changes which run dies). The three jobs now serialize on an external FIFO mutex — a Postgres session advisory lock, key `61616158`, held by a background session-mode `psql` connection for each job's DB-touching span, with `timeout-minutes: 60` as the TTL and session-drop-on-teardown as the steal path. Contenders **block** instead of being evicted. Proven before adoption by `.github/workflows/mutex-probe.yml`: three simultaneous contenders held pairwise non-overlapping windows (run 32390070135), and the same assertion was observed RED under a distinct-key neuter (run 32389730596). (2) The **silence layer**: a `cancelled` conclusion on a main-branch CI run now raises a dedup'd issue (see the `main-ci-cancelled` watcher in this phase).

## Decisions Made

- **Session-mode over the fallback action.** The probe settled A2 positively, so `ben-z/gh-action-mutex` (alpha, no TTL, [SUS]) was never adopted — no blocking-human checkpoint was needed. Zero packages installed this phase.
- **One key for all three jobs.** A per-job key is the exact analogue of the per-job group name rejected in `142-REVIEW.md:286-291`; the ⛔ comment now says so in lock-key terms.
- **Barrier-equality is a hard assertion, non-overlap is the test.** Without it, three contenders that happened to start 2 minutes apart would produce a non-overlapping GREEN that proves nothing — a vacuous pass. The probe fails loudly and asks to be re-dispatched instead.
- **DB clock, not runner clocks.** Window timestamps come from `clock_timestamp()` in the one session, so windows are comparable with no cross-runner skew.
- **`RELEASED` marker is taken before the session ends**, so each recorded window is a strict subset of the true hold — the non-overlap assertion is conservative (it can under-report overlap by milliseconds, never over-report).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Added a simultaneity barrier + barrier-equality assertion to the probe**
- **Found during:** Task 1 (tracer)
- **Issue:** The plan's probe design started contending as soon as each matrix job's `apt-get install` finished. Install time varies by tens of seconds, so the three contenders could arrive far enough apart that a 45 s hold never overlaps — under which the NEUTERED (distinct-key) variant would also pass, and the GREEN run would prove nothing about simultaneity. A serialization proof that can pass without contention is vacuous.
- **Fix:** Each contender sleeps to a shared 120 s wall-clock boundary (skipping to the next boundary when < 20 s away, so a contender finishing just before it cannot straddle), records that barrier value, and `assert-serialization` **fails** unless all three barrier values are identical.
- **Files modified:** `.github/workflows/mutex-probe.yml`
- **Verification:** RED run's contenders all aligned on one barrier and still overlapped 44–45 s (so the barrier does not mask overlap); GREEN run shows barrier `1787242080` for all three; local dry run confirms a rewritten barrier value exits 1.
- **Committed in:** `879d5a18`

**2. [Rule 2 - Missing Critical] Contenders record an `inconclusive` window instead of exiting green-and-silent when the secret is empty**
- **Found during:** Task 1
- **Issue:** The plan said the contender should "exit 0 with an error annotation" on an empty secret. Taken literally, the run then has fewer than three windows and `assert-serialization` reddens with a misleading "a contender failed to acquire the lock" — or, had I made the assert tolerant, a secretless run would report a green serialization proof it never performed.
- **Fix:** The contender writes `status=inconclusive` and the assert job reports `::warning:: … Nothing was proven — this is not a pass` and exits 0 only when **all three** are inconclusive; a mixed set fails.
- **Files modified:** `.github/workflows/mutex-probe.yml`
- **Verification:** local dry run — all-inconclusive exits 0 with the warning, mixed status exits 1.
- **Committed in:** `879d5a18`

**3. [Rule 1 - Bug] psql stderr is redacted before it reaches the log**
- **Found during:** Task 1
- **Issue:** The derived session-mode DSN is a *different string* from the registered secret, so GitHub's log masking does not cover it. Any code path that echoed psql's connection diagnostics could put pooler host/user (and, with a malformed secret, more) into a PUBLIC repository's logs.
- **Fix:** All psql stderr is captured to a file and printed through `sed -E 's#(postgres(ql)?://)[^@]*@#\1***@#g'`; the DSN itself is never echoed in either the probe or the three ci.yml acquire steps.
- **Files modified:** `.github/workflows/mutex-probe.yml`, `.github/workflows/ci.yml`
- **Verification:** grep of the GREEN run's contender log finds no DSN value (only the workflow's own echoed source text); a planted literal DSN is caught by the gate script's leak check, proving that check is not vacuous.
- **Committed in:** `879d5a18`, `24ebffed`

**4. [Rule 1 - Bug] Corrected a stale in-file comment claiming the concurrency group still prevents contention**
- **Found during:** Task 2
- **Issue:** The `python` job's pytest comment asserted "The cross-run `concurrency: shared-test-db` group above still prevents two runs from contending" — false once the group was deleted.
- **Fix:** Rewritten to name the mutex step.
- **Files modified:** `.github/workflows/ci.yml`
- **Committed in:** `24ebffed`

**5. [Rule 1 - Bug] Aggregator error message could misdescribe the dispatch-failure case**
- **Found during:** Task 3
- **Issue:** The first draft of the `sql-tests` arm printed "on a TRUSTED event (push/same-repo PR)" even when the event was `workflow_dispatch` and the result was `failure` — a true failure reported with a false reason.
- **Fix:** The message now prints the actual `fork_pr` / `dispatch` values and states the tolerance rule.
- **Files modified:** `.github/workflows/ci.yml`
- **Verification:** the both-polarity harness case `dispatch-sqltests-failure` (rc=1) shows the corrected text.
- **Committed in:** `873401f0`

### Plan-instruction conflicts resolved

**6. [Rule 1 - Plan assumption false at HEAD] `e2e-seeded` acquire placement**
- **Issue:** The plan directed the acquire step to sit "AFTER the Next build step and BEFORE the seed step", stating "the Next build happens BEFORE the lock". At HEAD the order is the reverse: `Seed demo data into test Supabase` (was `:1598`) runs **before** `Build Next.js with real test-Supabase env` (was `:1630`). Both criteria cannot hold without reordering steps.
- **Resolution:** The binding requirement — acquire before the first **DB-mutating** step — is satisfied: the acquire sits immediately before the seed. The build was deliberately **not** moved ahead of the seed to shorten the hold, because `npm run build` prerenders public routes against the real test-Supabase env, so building before the demo rows exist would bake an empty prerender into the bundle the seeded specs then assert against. Cost: the lock is held across the build (~1–2 min). Recorded in an in-file comment so the next reader does not "optimize" it back.

**7. [Tooling substitution] `js-yaml` in a worktree**
- **Issue:** GSD worktree agents get no `node_modules`, so the plan's `node -e "require('js-yaml')"` verify cannot resolve the module.
- **Resolution:** Run with `NODE_PATH` pointed at the main checkout's `node_modules` (js-yaml parse of `ci.yml` succeeds), and additionally validated with PyYAML, `bash -n` over every `run:` block, and `actionlint` (shellcheck-backed, rc=0). No production file was changed for tooling reasons.

---

**Total deviations:** 5 auto-fixed (3 missing-critical/anti-vacuity, 2 bugs) + 2 plan-instruction conflicts resolved and documented.
**Impact on plan:** No scope creep. Deviations 1–3 exist because the plan's probe, as literally specified, could have produced a vacuous or leaky proof; 4–5 are accuracy fixes in text that ships. Deviation 6 is the only place the plan's letter was not followed, and it follows the plan's intent (lock before DB mutation) over an anchor that was wrong at HEAD.

## Issues Encountered

- **Sandbox refuses compound shell commands in this worktree.** Multi-step verification had to be moved into standalone scripts under the scratchpad (plan-unique `p158-01-*` filenames, per the shared-scratchpad collision hazard). No impact on output.
- **The plan's own `grep -c 'sql-tests=${{ … }}'` verify is quote-sensitive.** My first paraphrase of it returned 0 on a file that does contain the row; the plan's verbatim form (with `\$`) returns 1, and `grep -F` confirms the row at `ci.yml:822`. Worth knowing before someone "fixes" a passing gate.

## Prohibition compliance

| Prohibition | Status | Evidence |
|---|---|---|
| Group REMOVED, never shrunk | held | 3 identical `concurrency` blocks deleted (9 removed lines); 0 non-comment `group: shared-test-db` mappings remain; no commit re-adds one |
| No new `needs:` edges among sql-tests / python / e2e-seeded | held | `python` has no `needs:`; `e2e-seeded` needs exactly `[frontend-typecheck]`; `sql-tests` needs exactly `[python]` — asserted programmatically. The `frontend` aggregator entry is the sanctioned exception (`if: always()`) |
| No `supabase/migrations/**` file | held | diff touches exactly 2 paths, both under `.github/workflows/` |
| Public repo: no secrets, no internal usernames | held | secret referenced by NAME only; DSN never echoed; stderr redacted; leak grep proven non-vacuous |

## User Setup Required

None — no new secret, variable, or external service. `TEST_SUPABASE_DB_URL` already exists and is now additionally consumed by the `python` and `e2e-seeded` jobs (name-only reference; GitHub withholds it on fork PRs, where the acquire step no-ops).

## Next Phase Readiness

**Ready for plan 02** (runbook + cancelled-watcher). Two hooks are already in place for it:

- Every mutex failure/timeout message points at `docs/runbooks/shared-test-db-mutex.md` — that file does **not exist yet** and plan 02 must create it (the manual unlock is `pg_terminate_backend` on the `ci-shared-test-db-mutex` / `ci-mutex-probe` `application_name` in `pg_stat_activity`).
- `mutex-probe.yml` is dispatchable on main once merged, and is the drill the runbook should reference.

**Deferred to the phase gate (verifier/orchestrator, live CI) — deliberately not run here:**

1. Both-polarity aggregator proof on a real run: plant a failing `supabase/tests/test_*.sql` assertion on the phase PR → `frontend` must conclude FAILURE with `sql-tests=failure` in the loop output; revert → green.
2. Post-merge `gh workflow run mutex-probe.yml` ×3 back-to-back, asserting the string `success` on all three and non-overlapping locked windows via `gh api …/actions/runs/<id>/jobs`. **Three** runs, not two.
3. Post-merge `gh workflow run ci.yml` → `frontend` green with `sql-tests=skipped` tolerated.

**Watch on the first PR run:** the acquire step's live behaviour in ci.yml (background psql surviving across steps, the fork arm, the release step) has been proven by analogy to the probe and by static checks, but not yet observed in situ. If the background session does not survive a step boundary on this runner image, the acquire step will log `the mutex psql session exited before acquiring the lock` and fail loudly rather than silently running unserialized.

## Self-Check: PASSED

- `.github/workflows/mutex-probe.yml` exists on disk (13,459 bytes); `.github/workflows/ci.yml` modified (+442/−57 across the plan).
- All three task commits exist and are reachable: `879d5a18`, `24ebffed`, `873401f0`.
- Acceptance gate re-run after the final edit: **ALL CHECKS PASSED** (25 assertions); `actionlint` rc=0; `bash -n` over every `run:` block OK; aggregator harness 9/9 with 5 red cases.
- Probe conclusions re-read from GitHub after cleanup: latest `success` (32390070135), prior `failure` (32389730596); `git ls-remote origin 'refs/heads/ci-probe/*'` empty.
- Working tree clean; no `STATE.md` / `ROADMAP.md` write from this worktree (orchestrator owns those).

---
*Phase: 158-ops-ci-a-merge-means-a-deploy*
*Completed: 2026-08-20*
