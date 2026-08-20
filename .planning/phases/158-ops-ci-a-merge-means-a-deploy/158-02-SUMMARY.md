---
phase: 158-ops-ci-a-merge-means-a-deploy
plan: 02
subsystem: infra
tags: [github-actions, workflow_run, github-script, postgres-advisory-lock, runbook, railway, ci]

requires:
  - phase: 158-01
    provides: "The FIFO advisory-lock mutex (key 61616158, PGAPPNAME ci-shared-test-db-mutex) and mutex-probe.yml that this plan's runbook documents. NOT present at this plan's base commit — plans 01 and 02 are the two halves of OPS-01 and land together."
provides:
  - ".github/workflows/main-ci-cancelled-watcher.yml — turns a cancelled main-branch CI conclusion into a dedup'd `main-ci-cancelled` GitHub issue (OPS-01 detection half)"
  - "The `main-ci-cancelled` repo label (created via gh, idempotent)"
  - "docs/runbooks/shared-test-db-mutex.md — the mutex's manual-unlock procedure, an adoption requirement of plan 01"
  - "docs/runbooks/README.md index entry under Incident response"
  - "An `attempt`-pinned dispatch test path, so the issue-filing logic is exercisable against an immutable historical conclusion"
affects: [158-01, 158-06, railway-deploy-verification, ci-hardening]

actuals:
  tokens: 5900   # chars/4 over the realized diff (23.6 KB across 3 files)
  tasks: 2
  commits: 4

tech-stack:
  added: []
  patterns:
    - "workflow_run watcher (first in-repo use of `on: workflow_run`)"
    - "Dedup'd-issue github-script block (third in-repo use, after analytics-deploy-verify.yml / nightly.yml / cassette-refresh.yml)"
    - "Attempt-pinned run fixtures for testing conclusion-predicates"

key-files:
  created:
    - .github/workflows/main-ci-cancelled-watcher.yml
    - docs/runbooks/shared-test-db-mutex.md
  modified:
    - docs/runbooks/README.md

key-decisions:
  - "ISSUE-ONLY watcher, no auto-rerun: a rerun re-enters the same contention window that produced the cancellation, and the requirement's 'issue or rerun' wording permits issue-only. Consequence: the token stays at contents:read + issues:write with no Actions-API write scope uplifted."
  - "Every code path exits 0, including GitHub API failures (downgraded to ::warning:: via try/catch). A workflow_run-triggered run attaches its check to main HEAD, so a red watcher would make Railway skip the deploy — recreating #616 while reporting it. This is STRONGER than the plan's text, which allowed API errors to surface as step failures on the belief that the watcher's run is not a main-CI check gate."
  - "Added an optional `attempt` input after measuring that the plan's designated fixture run (31273384829) now reports conclusion=success — see Deviations."
  - "Runbook indexed under 'Incident response', not 'Subsystems': its entry conditions (a main-ci-cancelled issue, a stuck lock) are incidents."

patterns-established:
  - "Attempt-pinned fixtures: a run's top-level conclusion is its LATEST attempt's and therefore mutable; attempt conclusions are immutable and are the stable thing to test against."
  - "Predicate extraction testing: the verification script loads the github-script body OUT of the workflow YAML rather than re-typing it, so workflow drift breaks the check."

requirements-completed: [OPS-01]

coverage:
  - id: D1
    description: "The watcher's detection predicate (conclusion=cancelled AND head_branch=main AND event=push) fires on a real cancelled run and stays silent on a non-cancelled one"
    requirement: OPS-01
    verification:
      - kind: integration
        ref: "scratchpad/p158-02-predicate-check.js — dispatch-arm script extracted from the workflow, executed against real gh-api payloads for runs 31273384829 (attempt 1 = cancelled, latest = success) and 32365082960 (cancelled)"
        status: pass
      - kind: other
        ref: "Neuter drill: replacing `run.conclusion === \"cancelled\"` with `false` flips case 1 to detected=false — the check goes RED, proving it can fail"
        status: pass
    human_judgment: false
  - id: D2
    description: "The watcher can never red-check main HEAD (exit-0-on-detection doctrine)"
    requirement: OPS-01
    verification:
      - kind: other
        ref: "grep -nE 'exit [1-9]|setFailed|throw |process\\.exit|core\\.error' .github/workflows/main-ci-cancelled-watcher.yml — zero matches; detection ends at `exit 0`, both github-script steps wrap all API calls in try/catch → core.warning"
        status: pass
      - kind: unit
        ref: "src/__tests__/critical-regressions.test.ts#[CRITICAL-C0293] — 5 dynamic guards now cover the new workflow (SHA-pin, top-level permissions w/ contents:read, persist-credentials:false, no YAML anchors, single permissions block)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Minimal token scope: contents:read + issues:write, no Actions-API write scope (the issue-only decision holds)"
    requirement: OPS-01
    verification:
      - kind: other
        ref: "Task-1 gate: grep -q 'issues: write' && ! grep -q 'actions: write'; js-yaml parse reports permissions {contents:read, issues:write}"
        status: pass
    human_judgment: false
  - id: D4
    description: "End-to-end: a dispatch creates the dedup'd main-ci-cancelled issue on the first run and COMMENTS on it on the second"
    requirement: OPS-01
    verification: []
    human_judgment: true
    rationale: "Untestable before merge by GitHub's design — workflow_dispatch and workflow_run only activate for a workflow file present on the DEFAULT branch. The predicate and dedup logic are unit-exercised (D1), but the live issues.create → issues.createComment transition needs the post-merge dispatch recorded below."
  - id: D5
    description: "docs/runbooks/shared-test-db-mutex.md documents holder discovery, pg_terminate_backend manual unlock, TTL/steal semantics, the fork no-op arm, the probe drill, and watcher triage — secret NAMES only"
    requirement: OPS-01
    verification:
      - kind: other
        ref: "Task-2 gate: greps for pg_terminate_backend / 61616158 / ci-shared-test-db-mutex / index entry, plus a negative grep for credentialed DSN patterns; all relative links resolve on disk (lychee --offline glob docs/runbooks/**/*.md)"
        status: pass
    human_judgment: true
    rationale: "The gates prove the required strings and the absence of credentials, not that the unlock procedure WORKS. The holder-discovery SQL and pg_terminate_backend sequence were never run against a genuinely stuck lock — and cannot be until plan 158-01's mutex exists. An operator should walk the procedure once during the post-merge probe drill."

duration: 17min
completed: 2026-08-20
status: complete
---

# Phase 158 Plan 02: Cancelled-CI Watcher + Mutex Runbook Summary

**A `workflow_run` watcher that converts a grey `cancelled` main-CI conclusion into a loud dedup'd GitHub issue without ever red-checking main HEAD, plus the manual-unlock runbook the advisory-lock mutex needs to be adoptable.**

## Performance

- **Duration:** ~17 min
- **Started:** 2026-08-20T15:56:00Z
- **Completed:** 2026-08-20T16:13:00Z
- **Tasks:** 2
- **Files modified:** 3 (2 created, 1 modified) — 430 insertions, 0 deletions

## Accomplishments

- **The silence mechanism of #616 is gone.** A cancelled main-branch push run now files (or comments on) an issue labeled `main-ci-cancelled`, explaining that Railway's wait-for-CI likely skipped the analytics deploy and pointing at the triage runbook.
- **The watcher cannot become the bug it reports.** Zero non-zero-exit constructs exist in the file; API failures degrade to `::warning::`. This matters because a `workflow_run`-triggered run attaches its check to main HEAD — the exact surface Railway reads.
- **The dispatch test arm actually works.** Measuring the plan's designated fixture revealed it no longer satisfies the predicate; an `attempt` input makes the test path fire against an immutable historical conclusion (see Deviations).
- **The mutex ships with its unlock procedure**, including the `pg_locks.granted` cross-check that stops an operator from terminating a *waiter* instead of the holder.

## Task Commits

1. **Task 1: Create the cancelled-conclusion watcher workflow** — `b34d75c4` (feat)
2. **Task 1 follow-up: absolute runbook URL in the issue body** — `c7dd360d` (fix)
3. **Task 2: Write the shared-test-db mutex runbook and index it** — `c2d09668` (docs)
4. **Task 1/2 follow-up: attempt-pinned dispatch fixture** — `72edd6a8` (fix)

## Files Created/Modified

- `.github/workflows/main-ci-cancelled-watcher.yml` — the watcher: `workflow_run` on CI (types completed, branches main) + `workflow_dispatch` with `run_id` / optional `attempt`; one job `report-cancelled`; dedup'd-issue github-script step.
- `docs/runbooks/shared-test-db-mutex.md` — six sections: mechanism, TTL/steal, manual unlock, fork arm, probe drill, watcher triage.
- `docs/runbooks/README.md` — one index line under **Incident response**.

**Repo-level side effect (not a file):** label `main-ci-cancelled` created via
`gh label create main-ci-cancelled --color B60205 --description "Main CI run concluded cancelled; analytics deploy may have been skipped"`.
The command is idempotent (`|| true`) and produced no output; existence confirmed by `gh label list | grep -qx 'main-ci-cancelled'`, which is part of the Task-1 gate.

## Decisions Made

- **Issue-only, no auto-rerun** (planner's recorded discretion, upheld). An automatic rerun re-enters the contention window that caused the cancellation. Concretely this keeps the token at `contents: read` + `issues: write`; no Actions-API write scope is uplifted anywhere in the file, and the Task-1 gate asserts its absence negatively.
- **API failures are warnings, not step failures.** The plan's action text permitted GitHub API errors to surface as step failures, reasoning that "the WATCHER's own run is not a main-CI check gate". That parenthetical is not true for `workflow_run`: such a run reports its check against the head SHA of the run it observed, i.e. main HEAD. Both `must_haves` truth #2 ("every code path exits 0") and the phase's binding constraint say the stronger thing, so the stronger reading was implemented.
- **Runbook filed under Incident response** alongside `railway-worker.md`, because its entry conditions are incidents, not subsystem reference.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] The plan's designated test fixture no longer satisfies the predicate**

- **Found during:** Post-task verification of Task 1.
- **Issue:** The plan (and `must_haves` truth #4, and the backstop verification) specify testing via `gh workflow run ... -f run_id=31273384829`, on the basis that this run was cancelled. **Measured at HEAD:** `gh api repos/:owner/:repo/actions/runs/31273384829` returns `conclusion: "success"`. Attempt 1 *was* `cancelled`, but the run was rerun green, and a run's top-level `conclusion` is that of its **latest** attempt. `getWorkflowRun` therefore returns `success`, the predicate correctly evaluates false, and the plan's backstop — "the first run creates the issue" — could never have passed as specified. The dispatch arm would have silently no-op'd, which reads exactly like a working watcher with nothing to report.
- **Fix:** Added an optional `attempt` input. When set, the dispatch arm reads that attempt via `github.rest.actions.getWorkflowRunAttempt` instead of the run. Attempt conclusions are immutable, so `run_id=31273384829 -f attempt=1` is a stable fixture. A bare `run_id` still works for runs whose *current* conclusion is cancelled (e.g. 32365082960), and the runbook documents how to find one.
- **Files modified:** `.github/workflows/main-ci-cancelled-watcher.yml`, `docs/runbooks/shared-test-db-mutex.md`
- **Verification:** Both polarities against real API payloads — attempt 1 → `detected=true`; latest attempt → `detected=false`; bare cancelled run → `detected=true`; bad input and API failure → `detected=false` with a warning and no throw. Neutering the predicate flips case 1 to false, proving the check can go red.
- **Committed in:** `72edd6a8`

**2. [Rule 1 - Bug] A literal `${{ }}` inside a `run:` comment would have broken the workflow**

- **Found during:** Task 1 acceptance check for injection hygiene.
- **Issue:** A comment *inside* the shell body read ``never `${{ }}` inside this body``. Actions interpolates `run:` bodies before the shell sees them, and `${{ }}` with an empty expression is a syntax error — the workflow would have failed to start. The irony is that the comment documenting the injection rule was itself the injection.
- **Fix:** Reworded to prose without the literal token.
- **Verification:** Structural check confirms zero GitHub expressions in any `run:`/`script:` body; all run context arrives via `env:`.
- **Committed in:** `b34d75c4` (folded into the task commit)

**3. [Rule 1 - Bug] Relative markdown link in a GitHub issue body**

- **Found during:** Task 2 (reviewing the issue body against the runbook path).
- **Issue:** The triage pointer used `../blob/main/docs/runbooks/shared-test-db-mutex.md`. Relative links in an **issue body** resolve against the issue URL, not the repo root — the operator following it would have hit a 404.
- **Fix:** Build an absolute URL from the already-injected `REPO_NAME` env value.
- **Committed in:** `c7dd360d`

**4. [Rule 2 - Missing Critical] `pg_locks.granted` cross-check in the manual-unlock procedure**

- **Found during:** Task 2.
- **Issue:** The plan's step 3 finds the holder by `application_name`. But every *waiter* also carries `PGAPPNAME=ci-shared-test-db-mutex` — waiters are blocked inside `pg_advisory_lock` with the same name. An operator following the procedure literally could terminate a queued job, which fails that job and frees nothing, then repeat.
- **Fix:** The runbook's step 2 joins `pg_locks` on `objid = 61616158` and instructs the operator to terminate only the row with `granted = true`, explicitly warning off the `granted = false` rows. Also added a note that `pg_advisory_unlock` cannot release another session's lock and returns `false` silently — a plausible-looking non-fix.
- **Committed in:** `c2d09668`

---

**Total deviations:** 4 auto-fixed (3 bugs, 1 missing-critical). No Rule 4 architectural changes; no scope creep beyond the three planned files.
**Impact on plan:** Deviation 1 is the significant one — without it the plan's own backstop verification was unpassable. Deviations 2 and 3 were latent breakages in files that had already passed their written gates.

## Prohibition Checks

Both plan prohibitions were flagged `unverified` and are now verified:

| Prohibition | Verification run | Result |
|---|---|---|
| The watcher must never conclude failure on the main-HEAD check for a detection | `grep -nE 'exit [1-9]\|setFailed\|throw \|process\.exit\|core\.error'` over the file; read-back of all 5 steps | **Holds.** Zero matches. Step 2 ends `exit 0`; steps 3 and 4 wrap every API call in try/catch → `core.warning`; step 5 is an `echo`. |
| This phase creates no `supabase/migrations/**` file | `git diff --stat 35c74149..HEAD` | **Holds.** Exactly 3 files, 430 insertions, **0 deletions**, none under `supabase/`. |

## Issues Encountered

- **The watcher is inert until merge.** `workflow_run` fires only for a workflow file present on the **default branch**, and `workflow_dispatch` likewise only lists workflows on the default branch. Nothing about the live GitHub-side behavior can be verified pre-merge; that is why D4 is `human_judgment: true` and why the predicate was tested by extracting the script and feeding it real API payloads instead.
- **The runbook documents a mechanism that does not exist at this plan's base.** `pg_advisory_lock(61616158)`, `PGAPPNAME=ci-shared-test-db-mutex` and `mutex-probe.yml` are all plan 158-01 deliverables; at commit `35c74149` `ci.yml` still carries three `group: shared-test-db` blocks. Details were taken from 158-01-PLAN.md so the two halves agree. **If 158-01 does not land in the same PR, this runbook describes a mutex that is not there** — the two plans must merge together.
- Note for whoever lands 158-01: `src/__tests__/critical-regressions.test.ts:1154` asserts *"ci.yml sql-tests job joins the shared-test-db concurrency group"*. Removing the group will red that guard; it needs re-baselining as part of plan 01, not left to CI to discover.

## Known Stubs

None. No placeholder values, TODOs, or unwired components were introduced.

## Post-Merge Verification (for the verifier — the backstop truth)

Once this phase's PR is on `main`:

```bash
# 1. First dispatch — CREATES the dedup'd issue.
gh workflow run main-ci-cancelled-watcher.yml -f run_id=31273384829 -f attempt=1

# 2. Second identical dispatch — COMMENTS on the same issue, no duplicate.
gh workflow run main-ci-cancelled-watcher.yml -f run_id=31273384829 -f attempt=1

# 3. Confirm exactly one open issue with one added comment.
gh issue list --label main-ci-cancelled --state open

# 4. Confirm BOTH watcher runs concluded `success` (assert the literal string —
#    a grey `cancelled` is not a failure, and "not failure" would pass on it).
gh run list --workflow=main-ci-cancelled-watcher.yml --limit 2 \
  --json databaseId,conclusion,url
```

Record both watcher-run URLs, then **close the issue** — closing re-arms deduplication.

⚠️ Do **not** omit `-f attempt=1`: run 31273384829's current conclusion is `success`, so a bare `run_id` produces a clean no-op that is indistinguishable from a broken watcher.

## User Setup Required

None. The one repo-level side effect (the `main-ci-cancelled` label) was applied during execution.

## Next Phase Readiness

- **Ready:** OPS-01's detection half is complete and its runbook is in place.
- **Blocker (sequencing, not defect):** OPS-01 is only closed when plan 158-01's mutex lands with it. Issue #616 should be closed on the MECHANISM — both the eviction (mutex) and the silence (this watcher) — never on "prod has converged".
- **Carry-forward:** the `critical-regressions.test.ts:1154` shared-test-db assertion noted above.

---
*Phase: 158-ops-ci-a-merge-means-a-deploy*
*Completed: 2026-08-20*
