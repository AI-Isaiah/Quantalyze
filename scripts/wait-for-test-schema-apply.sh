#!/usr/bin/env bash
# scripts/wait-for-test-schema-apply.sh
#
# THE ORDERING WAIT ([164.8-PUSH-RACE-VAC08], Phase 164.9 plan 06, ROADMAP
# criterion 3). Invoked bare from the three DB-touching READER jobs in
# .github/workflows/ci.yml (`sql-tests`, `python`, `e2e-seeded`), immediately
# BEFORE each job's `Acquire shared-test-db mutex` step.
# ⛔ CORRECTED 2026-09-25 (Phase 164.4.2.1): the sentence above is lineage. The
# invokers are now `python` and `e2e-seeded` (immediately before their acquire
# step) and `test-db-drift` (before VAC-08). `test-db-drift` has had no acquire
# step since Phase 164.4.2.1, so for it this wait is the ONLY ordering control
# against `apply-test`. `sql-tests` stopped invoking it in Phase 164.4.2.
# ⛔ CORRECTED 2026-09-25 (Phase 164.4.2.1 round-1 review, SFH-01 / WR-01):
# "the ONLY ordering control" holds on a merge push only, and the sentence
# above is kept as lineage. On a pull_request run this wait does not run (the
# step's `if:` is merge-push only), so `test-db-drift`'s VAC-08 has NO ordering
# against `apply-test` or a dispatched restore. See the note in `wait_for_apply`
# and section 0 of docs/runbooks/shared-test-db-mutex.md.
#
# ⭐ WHY A WAIT AND NOT A LOCK. A mutex guarantees that no two holders overlap;
# it never guarantees WHICH GOES FIRST. On a merge push, ci.yml's reader jobs
# and supabase-migrate.yml's `apply-test` contend for the SAME advisory key with
# nothing ordering them, so a reader could assert against the schema the apply
# was in the middle of replacing. Ordering needs its own primitive. This is it:
# a bounded cross-workflow wait that checks a FACT rather than hoping to lose a
# race.
#
# ⛔ IT RUNS BEFORE THE MUTUAL-EXCLUSION ACQUIRE, DELIBERATELY. A job that waited
# while holding that key would starve every other contender on a database shared
# with other people's CI — including the apply it is waiting for, which would
# deadlock the two until the acquire cap expired.
#
# ⛔ NO `needs:` EDGE WAS ADDED, AND NONE MAY BE. The three reader jobs' `if:`
# conditions diverge, and a skipped `needs:` job skips its dependents — ci.yml
# records that reasoning at length on `sql-tests`. The ordering is achieved by
# this wait, which is the whole reason the wait exists.
#
# ── THE TWO READS, IN THIS ORDER ───────────────────────────────────────────
#   1. The schema-apply-in-flight FLAG, via the READ-ONLY probe in
#      scripts/shared-test-db-keys.sh (sourced, never re-implemented). A held
#      flag means a schema apply is running RIGHT NOW. It is the only signal
#      that sees test-restore-from-baseline.yml, which produces no Actions run
#      on this commit.
#   2. The Actions API, for a run of supabase-migrate.yml on THIS exact head
#      commit, and its `apply-test` JOB's status.
#      ⚠️ THE JOB, NOT THE RUN. That workflow's PROD `apply` job sits behind the
#      Production environment's HUMAN reviewer gate, so the RUN stays
#      `in_progress` for as long as nobody clicks. Waiting on the run would wait
#      on a person.
#
# ── THE THREE OUTCOMES, EACH NAMED ─────────────────────────────────────────
#   apply-concluded  an apply run for this commit exists and its apply-test job
#                    has finished. Proceed. If it finished unsuccessfully, say
#                    so and proceed anyway — reddening here would duplicate a red
#                    check that already exists and misattribute it to this job.
#   no-apply-run     no apply run for this commit appeared within the grace
#                    window AND the in-flight flag is clear. Nothing to order
#                    against; this is the ordinary case for a commit that changed
#                    no migration. Proceed.
#   wait-exhausted   the budget ran out with the flag still held or the apply
#                    still unfinished. Names which, points at the runbook, and
#                    exits non-zero.
#
# ⛔ NO MESSAGE HERE INTERPOLATES RAW API OUTPUT, A DSN, A HOST OR A USERNAME.
# The outcome, the budget, the elapsed time and the counts — nothing else. This
# log is PUBLIC.
#
# Usage:
#   bash scripts/wait-for-test-schema-apply.sh
#   bash scripts/wait-for-test-schema-apply.sh --self-test
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/shared-test-db-keys.sh
. "${SCRIPT_DIR}/shared-test-db-keys.sh"

# ── BUDGETS ────────────────────────────────────────────────────────────────
# ⚠️ THE DEFAULTS ARE THE CONTRACT. The env overrides exist so `--self-test`
# can drive all three outcomes in seconds instead of minutes; they are the same
# injectable-seam idiom scripts/test-ledger-drift-check.sh uses for its own
# harness. ⛔ Do not set them in a workflow to make a slow run green.
#
# WAIT_BUDGET_SECONDS — MEASURED against this repo's own recorded numbers
# (2026-09-21, derivation rather than a guess): each reader job carries
# `timeout-minutes: 90`, and its mutex acquire cap is 3600s, sized by
# 158-REVIEW CR-04 against three simultaneous runs each holding the lock ~20m.
# This wait is spent BEFORE that cap, so the two add: 900 + 3600 = 4500s = 75m,
# which leaves 15m of the 90m TTL for the job's own work. A larger budget eats
# into work time on exactly the runs that are already congested. 900s also
# covers one queued ~20m hold's tail plus an apply, which is the congested case
# this wait is for.
WAIT_BUDGET_SECONDS="${WAIT_BUDGET_SECONDS:-900}"
# APPEAR_GRACE_SECONDS — how long "no apply run exists" must hold before it is
# believed. supabase-migrate.yml triggers only on a push touching
# `supabase/migrations/**`, so on most merges NO run will ever appear and the
# common case must not pay the full budget. This job cannot start before its own
# `needs:` have run, so a triggered run has already had minutes to register by
# the time this step executes; 90s is slack on top of that, not the measurement.
APPEAR_GRACE_SECONDS="${APPEAR_GRACE_SECONDS:-90}"
WAIT_POLL_SECONDS="${WAIT_POLL_SECONDS:-15}"

MIGRATE_WORKFLOW_FILE="supabase-migrate.yml"
APPLY_JOB_NAME="apply-test"
RUNBOOK="docs/runbooks/shared-test-db-mutex.md"

# ── READ 1: the in-flight FLAG ─────────────────────────────────────────────
# Prints exactly one of: held | clear | unknown.
# ⛔ psql's stderr is DISCARDED, not echoed: a connect/auth failure names the
# TEST pooler host, its IP and the DB user, and this log is public. An
# unreadable probe answers `unknown`, which the loop treats as "cannot rule an
# apply in" — never as "clear".
probe_inflight_flag() {
  if [ -n "${TEST_INFLIGHT_PROBE_CMD:-}" ]; then
    # ⛔ THE SEAM'S EXIT STATUS AND ITS EMPTY ANSWER BOTH LAND ON `unknown`,
    # DELIBERATELY. This used to be `$CMD; return 0`, which discarded both: a
    # seam that failed or printed nothing yielded an EMPTY answer, and an empty
    # answer matches no `case` arm in the wait loop, so the run degraded
    # silently into a full-budget `wait-exhausted` that blamed congestion. An
    # unmeasurable probe is `unknown` — the conservative token this function
    # already has a name for — never an empty string.
    local seam_rc=0 seam_out=""
    # shellcheck disable=SC2086
    seam_out="$($TEST_INFLIGHT_PROBE_CMD)" || seam_rc=$?
    if [ "${seam_rc}" -ne 0 ] || [ -z "${seam_out}" ]; then
      printf '%s' "unknown"
    else
      printf '%s' "${seam_out}"
    fi
    return 0
  fi
  local dsn="${TEST_SUPABASE_DB_URL:-}" answer=""
  if [ -z "${dsn}" ]; then
    printf '%s' "unknown"
    return 0
  fi
  dsn="$(session_mode_port "${dsn}")"
  answer="$(PGCONNECT_TIMEOUT=15 timeout 20 psql "${dsn}" -X -q -A -t \
      -c "SET statement_timeout = '10s';" \
      -c "$(shared_test_db_inflight_probe_sql)" \
      2>/dev/null | tr -d '\r' | tail -1)" || answer=""
  classify_inflight_answer "${answer}"
}

# The two pieces of probe_inflight_flag that can be MEASURED without a database,
# lifted out for exactly that reason. ⛔ THEY ARE NOT A CONVENIENCE WRAPPER: the
# self-test drives these bodies, so a typo in the port rewrite or in the answer
# classification now has somewhere to be caught. The psql invocation between them
# stays unmeasured here and is stated as such in the self-test's summary line.
#
# session_mode_port — the pooler's transaction-mode port rewritten to the
# session-mode one. Advisory locks are SESSION state; a transaction-mode pooler
# hands the probe a different backend each time and the answer means nothing.
session_mode_port() {
  case "$1" in
    *":6543/"*) printf '%s' "${1%%:6543/*}:5432/${1#*:6543/}" ;;
    *)          printf '%s' "$1" ;;
  esac
}

# classify_inflight_answer — a SQLSTATE-shaped answer (whitespace, CR, an empty
# string, an error line) mapped onto exactly one of held | clear | unknown.
# ⛔ ANYTHING NON-NUMERIC IS `unknown`, NEVER `clear`. A psql error line that
# classified as clear is a reader deciding a DROP SCHEMA is not running because
# it could not ask.
classify_inflight_answer() {
  local answer
  answer="$(printf '%s' "${1:-}" | tr -d '[:space:]')"
  case "${answer}" in
    ''|*[!0-9]*) printf '%s' "unknown" ;;
    0)           printf '%s' "clear" ;;
    *)           printf '%s' "held" ;;
  esac
}

# gh_api — the one place this script speaks to the Actions API, and a DATA seam
# rather than a BEHAVIOUR one. ⭐ THAT DISTINCTION IS THE POINT. With only
# `TEST_APPLY_STATE_CMD` (which replaces the whole function), the self-test
# certified an outcome DISPATCHER while every line that actually reads the API —
# the URL, the three jq filters, the per-run loop, the aggregation — went
# unexecuted. A renamed job, a changed API shape or a typo'd jq path would make
# this answer `unreadable` forever, burning the full budget in three jobs on
# every merge push and blaming congestion, with the self-test green throughout.
# Feeding fixture BYTES in here runs that code for real.
# ⛔ stderr stays discarded: a gh failure can name the repository and the token's
# owner, and this log is public. The exit status is preserved.
gh_api() {
  if [ -n "${TEST_GH_API_CMD:-}" ]; then
    # shellcheck disable=SC2086
    $TEST_GH_API_CMD "$1"
    return $?
  fi
  gh api "$1" 2>/dev/null
}

# ── READ 2: the Actions API ────────────────────────────────────────────────
# Prints exactly one of: concluded-ok | concluded-bad | running | absent | unreadable.
# ⛔ The API's bytes never reach a log line. Only the derived token does.
probe_apply_state() {
  if [ -n "${TEST_APPLY_STATE_CMD:-}" ]; then
    # ⛔ SAME BOUNDARY, SAME REASON as probe_inflight_flag's seam: a failing or
    # silent seam answers `unreadable`, the token this function already uses for
    # "could not measure", instead of an empty string that matches no arm.
    local seam_rc=0 seam_out=""
    # shellcheck disable=SC2086
    seam_out="$($TEST_APPLY_STATE_CMD)" || seam_rc=$?
    if [ "${seam_rc}" -ne 0 ] || [ -z "${seam_out}" ]; then
      printf '%s' "unreadable"
    else
      printf '%s' "${seam_out}"
    fi
    return 0
  fi
  local rc=0 runs_json ids id jobs_json st cc
  local seen_running=0 seen_ok=0 seen_bad=0
  runs_json="$(gh_api "repos/${GITHUB_REPOSITORY}/actions/workflows/${MIGRATE_WORKFLOW_FILE}/runs?head_sha=${GITHUB_SHA}&per_page=20")" || rc=$?
  if [ "${rc}" -ne 0 ]; then printf '%s' "unreadable"; return 0; fi
  ids="$(printf '%s' "${runs_json}" | jq -r '.workflow_runs[]?.id' 2>/dev/null)" || { printf '%s' "unreadable"; return 0; }
  if [ -z "${ids}" ]; then printf '%s' "absent"; return 0; fi
  for id in ${ids}; do
    rc=0
    jobs_json="$(gh_api "repos/${GITHUB_REPOSITORY}/actions/runs/${id}/jobs?per_page=100")" || rc=$?
    if [ "${rc}" -ne 0 ]; then printf '%s' "unreadable"; return 0; fi
    st="$(printf '%s' "${jobs_json}" | jq -r --arg n "${APPLY_JOB_NAME}" '[.jobs[]? | select(.name == $n)] | .[0].status // ""' 2>/dev/null)" || { printf '%s' "unreadable"; return 0; }
    cc="$(printf '%s' "${jobs_json}" | jq -r --arg n "${APPLY_JOB_NAME}" '[.jobs[]? | select(.name == $n)] | .[0].conclusion // ""' 2>/dev/null)" || { printf '%s' "unreadable"; return 0; }
    case "${st}" in
      completed)
        if [ "${cc}" = "success" ]; then seen_ok=1; else seen_bad=1; fi
        ;;
      "")
        # The run exists but carries no apply-test job yet — it is still being
        # set up. That is RUNNING, not ABSENT: treating it as absent is how a
        # reader walks straight into the apply it was built to wait for.
        seen_running=1
        ;;
      *) seen_running=1 ;;
    esac
  done
  if [ "${seen_running}" = "1" ]; then printf '%s' "running"; return 0; fi
  if [ "${seen_bad}" = "1" ]; then printf '%s' "concluded-bad"; return 0; fi
  if [ "${seen_ok}" = "1" ]; then printf '%s' "concluded-ok"; return 0; fi
  printf '%s' "running"
}

# ── THE WAIT ───────────────────────────────────────────────────────────────
wait_for_apply() {
  local waited=0 flag apply outcome="" polls=0
  echo "ordering wait: budget ${WAIT_BUDGET_SECONDS}s, appearance grace ${APPEAR_GRACE_SECONDS}s, poll ${WAIT_POLL_SECONDS}s."
  while [ -z "${outcome}" ]; do
    flag="$(probe_inflight_flag)"
    apply="$(probe_apply_state)"
    polls=$((polls + 1))
    case "${apply}" in
      # ⭐ THE FLAG GATES THIS ARM TOO, AND IT USED NOT TO. A concluded apply
      # answers "the run named in the Actions API has finished"; it says NOTHING
      # about test-restore-from-baseline.yml, which produces no Actions run on
      # this commit and is visible ONLY through the flag. The two are
      # CORRELATED: a migration landing on TEST is exactly when someone
      # re-baselines it. Reading `concluded-ok` while the flag is held and
      # proceeding is a reader walking into a `DROP SCHEMA public CASCADE`.
      # ⚠️ NOT A CLAIM THAT THIS WAS THE ONLY DEFENCE: the shared-test-db mutex
      # still prevents the two from actually overlapping. What this closes is the
      # ORDERING hole — proceeding to queue for a lock behind a restore that is
      # replacing the schema this job is about to assert against.
      # ⛔ CORRECTED 2026-09-25 (Phase 164.4.2.1): the mutex still keeps
      # `python` and `e2e-seeded` from overlapping a writer, but it no longer
      # covers `test-db-drift`, which holds no key. Its VAC-08 reads are
      # read-only, and an overlap makes them fail loudly, never pass falsely.
      # A restore's lock blocks them until COMMIT or their statement timeout.
      # A later commit's apply can only produce a loud false red.
      # ⛔ CORRECTED 2026-09-25 (Phase 164.4.2.1 round-1 review, SFH-01 /
      # WR-01): the note above is written from a merge push, and is kept as
      # lineage. On a pull_request run this wait does not run (the step's
      # `if:` is merge-push only), so VAC-08 has NO ordering against
      # `apply-test` or a dispatched restore. An overlap can red a PR (a
      # ledger lock wait past the retry budget, or a body-fetch race on the
      # restore's COMMIT) that the key used to prevent. It cannot turn a real
      # drift green: the restore is one transaction, and the frontier tip is
      # computed from the checkout's own migrations. Re-run the PR check after
      # the restore or apply. Do NOT widen the step's `if:` to PR events: this
      # wait keys on GITHUB_SHA's own supabase-migrate.yml run, which never
      # exists on a PR. On a merge push a seconds-wide window also remains
      # between this wait's exit and VAC-08's first read.
      # `unknown` is deliberately NOT treated as clear: an unreadable probe
      # cannot rule an apply IN, which is the same reading the exhaustion
      # message already states.
      concluded-ok|concluded-bad)
        if [ "${flag}" = "clear" ]; then outcome="apply-concluded"; fi
        ;;
      absent)
        if [ "${waited}" -ge "${APPEAR_GRACE_SECONDS}" ] && [ "${flag}" = "clear" ]; then
          outcome="no-apply-run"
        fi
        ;;
    esac
    if [ -z "${outcome}" ] && [ "${waited}" -ge "${WAIT_BUDGET_SECONDS}" ]; then
      outcome="wait-exhausted"
    fi
    if [ -z "${outcome}" ]; then
      sleep "${WAIT_POLL_SECONDS}"
      waited=$(( waited + WAIT_POLL_SECONDS ))
    fi
  done

  case "${outcome}" in
    apply-concluded)
      if [ "${apply}" = "concluded-bad" ]; then
        echo "wait-outcome: apply-concluded — the TEST schema apply for this commit FINISHED UNSUCCESSFULLY after ${waited}s (${polls} poll(s)). Proceeding anyway: that failure already has its own red check, and reddening here would duplicate it under the wrong job's name."
      else
        echo "wait-outcome: apply-concluded — the TEST schema apply for this commit finished after ${waited}s (${polls} poll(s)). This job's DB work is ordered behind it."
      fi
      ;;
    no-apply-run)
      echo "wait-outcome: no-apply-run — no ${MIGRATE_WORKFLOW_FILE} run exists for this commit after the ${APPEAR_GRACE_SECONDS}s appearance grace (${polls} poll(s), ${waited}s elapsed) and the in-flight flag is clear. Nothing to order against; this is the ordinary case for a commit that changed no migration."
      ;;
    wait-exhausted)
      echo "::error::wait-outcome: wait-exhausted — the ${WAIT_BUDGET_SECONDS}s ordering budget ran out after ${waited}s and ${polls} poll(s). Still true at exhaustion: in-flight flag '${flag}', apply state '${apply}'. A 'held' flag means a schema apply (the TEST apply, or a dispatched restore) was still running; a 'running' apply state means its apply-test job had not finished; an 'unknown'/'unreadable' read means this step could not MEASURE one of the two, and an unreadable input is not a clean one. Triage and manual unlock: ${RUNBOOK}. Raw API output, the DSN, the host and the DB user are all WITHHELD: this log is public."
      return 1
      ;;
  esac
  return 0
}

# ── --self-test ────────────────────────────────────────────────────────────
# ⛔ WITHOUT THIS THE THREE OUTCOMES ARE A CLAIM. Each arm drives the two reads
# through their injectable seams and asserts the outcome BY NAME and by exit
# code — a wait that always proceeds and a wait that always reds are both
# indistinguishable from a working one on a green run.
self_test() {
  local checks=0 out rc

  arm() {
    local label="$1" want_rc="$2" needle="$3" flag_answer="$4" apply_answer="$5"
    rc=0
    out="$(TEST_INFLIGHT_PROBE_CMD="printf %s ${flag_answer}" \
           TEST_APPLY_STATE_CMD="printf %s ${apply_answer}" \
           WAIT_BUDGET_SECONDS=0 APPEAR_GRACE_SECONDS=0 WAIT_POLL_SECONDS=1 \
           bash "${BASH_SOURCE[0]}" 2>&1)" || rc=$?
    checks=$((checks + 1))
    if [ "${rc}" -ne "${want_rc}" ]; then
      echo "SELF-TEST FAIL: ${label} exited ${rc}, expected ${want_rc}. Output: ${out}" >&2
      exit 1
    fi
    checks=$((checks + 1))
    case "${out}" in
      *"${needle}"*) : ;;
      *)
        echo "SELF-TEST FAIL: ${label} did not NAME its outcome '${needle}'. Output: ${out}" >&2
        exit 1
        ;;
    esac
  }

  arm "concluded (success)"  0 "wait-outcome: apply-concluded" clear concluded-ok
  arm "concluded (failure)"  0 "FINISHED UNSUCCESSFULLY"       clear concluded-bad
  arm "no apply run"         0 "wait-outcome: no-apply-run"    clear absent
  arm "exhausted, flag held" 1 "wait-outcome: wait-exhausted"  held  running
  arm "exhausted, unreadable API" 1 "wait-outcome: wait-exhausted" unknown unreadable

  # ⭐ THE CALIBRATION THE ARMS ABOVE CANNOT DO FOR THEMSELVES: an ABSENT apply
  # with a HELD flag must NOT read as `no-apply-run`. That is the restore case —
  # test-restore-from-baseline.yml produces no Actions run on this commit, so
  # the flag is the only thing standing between a reader and a DROP SCHEMA.
  arm "absent apply but flag HELD is NOT no-apply-run" 1 "wait-outcome: wait-exhausted" held absent

  # ⭐ THE SAME CALIBRATION AGAINST THE OTHER ARM, and it is the one the six
  # arms above could not make: a CONCLUDED apply with a HELD flag must NOT read
  # as `apply-concluded` either. The Actions API cannot see a dispatched
  # restore; only the flag can. Before this arm existed the flag was consulted
  # on the `absent` path alone, so a restore holding the flag while a migration
  # apply concluded on the same commit let the reader straight through.
  arm "concluded apply but flag HELD is NOT apply-concluded" 1 "wait-outcome: wait-exhausted" held concluded-ok
  arm "concluded apply with flag UNKNOWN is NOT apply-concluded" 1 "wait-outcome: wait-exhausted" unknown concluded-ok

  # ── THE SEAM BOUNDARY ITSELF ────────────────────────────────────────────
  # ⭐ A SEAM THAT FAILS OR SAYS NOTHING MUST NAME ITS OWN UNMEASURABILITY.
  # These arms pass the seam a raw command instead of a canned answer, so the
  # thing under test is the seam's error handling rather than the dispatcher.
  # Before the boundary was fixed, both of these produced an EMPTY answer that
  # matched no `case` arm, and the run degraded into an exhaustion whose message
  # blamed a schema apply — for a probe that had simply not run.
  seam_arm() {  # label want_rc needle flag_cmd apply_cmd
    local label="$1" want_rc="$2" needle="$3" flag_cmd="$4" apply_cmd="$5"
    rc=0
    out="$(TEST_INFLIGHT_PROBE_CMD="${flag_cmd}" \
           TEST_APPLY_STATE_CMD="${apply_cmd}" \
           WAIT_BUDGET_SECONDS=0 APPEAR_GRACE_SECONDS=0 WAIT_POLL_SECONDS=1 \
           bash "${BASH_SOURCE[0]}" 2>&1)" || rc=$?
    checks=$((checks + 1))
    if [ "${rc}" -ne "${want_rc}" ]; then
      echo "SELF-TEST FAIL: ${label} exited ${rc}, expected ${want_rc}. Output: ${out}" >&2
      exit 1
    fi
    checks=$((checks + 1))
    case "${out}" in
      *"${needle}"*) : ;;
      *)
        echo "SELF-TEST FAIL: ${label} did not NAME '${needle}'. A seam that failed or printed nothing degraded silently instead. Output: ${out}" >&2
        exit 1
        ;;
    esac
  }

  seam_arm "flag seam EXITS NON-ZERO answers unknown"  1 "in-flight flag 'unknown'"  "false" "printf %s absent"
  seam_arm "flag seam PRINTS NOTHING answers unknown"  1 "in-flight flag 'unknown'"  "true"  "printf %s absent"
  seam_arm "apply seam EXITS NON-ZERO answers unreadable" 1 "apply state 'unreadable'" "printf %s clear" "false"
  seam_arm "apply seam PRINTS NOTHING answers unreadable" 1 "apply state 'unreadable'" "printf %s clear" "true"

  # ══ THE READS THEMSELVES ═══════════════════════════════════════════════
  # ⛔ EVERY ARM ABOVE INJECTS BOTH SEAMS, SO NOT ONE OF THEM EXECUTES A LINE
  # OF probe_apply_state's OR probe_inflight_flag's BODY. They certify the
  # DISPATCHER — which outcome the wait loop reaches for a given pair of
  # answers — and that is a DIFFERENT CLAIM from "the reads work". The arms
  # below drive the real bodies through a DATA seam (fixture bytes in, a token
  # out) instead of a BEHAVIOUR seam (an answer in, the body skipped).
  #
  # ⛔ THE FIXTURES CARRY NO REAL RUN ID, ORG, REPOSITORY OR HOST. They are
  # synthetic placeholders; this file is in a PUBLIC repo.
  local ST_RUNS_JSON="" ST_JOBS_JSON="" ST_JOBS_JSON_2=""

  st_api_fixture() {
    case "$1" in
      *"/actions/workflows/"*"/runs?"*) printf '%s' "${ST_RUNS_JSON}" ;;
      # Keyed on the run id, so a two-run commit can answer DIFFERENTLY per run
      # — the whole point of the aggregation arm below.
      *"/actions/runs/22222222/jobs"*)  printf '%s' "${ST_JOBS_JSON_2:-${ST_JOBS_JSON}}" ;;
      *"/actions/runs/"*"/jobs"*)       printf '%s' "${ST_JOBS_JSON}" ;;
      # A URL neither branch recognises means the reader built something this
      # harness has never seen — a fixture MISS, not an API failure. Answering
      # `unreadable` for it would let a renamed endpoint pass as a measured read.
      *) echo "SELF-TEST FAIL: the reader requested an unrecognised URL shape; the fixture measures nothing for it." >&2; exit 1 ;;
    esac
  }
  st_api_fails() { return 1; }

  # Synthetic, and deliberately not this repository's own name or head.
  export GITHUB_REPOSITORY="synthetic-owner/synthetic-repo"
  export GITHUB_SHA="0000000000000000000000000000000000000000"

  read_arm() {  # label expected api-fn runs-json jobs-json [jobs-json-for-the-2nd-run]
    local label="$1" want="$2" api_fn="$3" got=""
    ST_RUNS_JSON="$4"; ST_JOBS_JSON="$5"; ST_JOBS_JSON_2="${6:-}"
    TEST_GH_API_CMD="${api_fn}"
    got="$(TEST_APPLY_STATE_CMD="" probe_apply_state)" || got="(the read EXITED non-zero)"
    TEST_GH_API_CMD=""
    checks=$((checks + 1))
    if [ "${got}" != "${want}" ]; then
      echo "SELF-TEST FAIL: read arm '${label}' answered '${got}', expected '${want}'. This arm runs the REAL probe_apply_state body over fixture bytes, so a miss means the URL, a jq filter or the aggregation is wrong — not that the dispatcher is." >&2
      exit 1
    fi
  }

  local RUN_ONE='{"workflow_runs":[{"id":11111111}]}'
  local RUN_TWO='{"workflow_runs":[{"id":11111111},{"id":22222222}]}'
  local NO_RUNS='{"workflow_runs":[]}'
  local JOB_OK='{"jobs":[{"name":"apply-test","status":"completed","conclusion":"success"}]}'
  local JOB_BAD='{"jobs":[{"name":"apply-test","status":"completed","conclusion":"failure"}]}'
  local JOB_RUNNING='{"jobs":[{"name":"apply-test","status":"in_progress","conclusion":null}]}'
  local JOB_OTHER='{"jobs":[{"name":"dispatch-ref-guard","status":"completed","conclusion":"success"}]}'
  local JOB_NONE='{"jobs":[]}'
  local MALFORMED='{"workflow_runs":[{"id":'

  read_arm "completed/success is concluded-ok"   concluded-ok  st_api_fixture "${RUN_ONE}" "${JOB_OK}"
  read_arm "completed/failure is concluded-bad"  concluded-bad st_api_fixture "${RUN_ONE}" "${JOB_BAD}"
  read_arm "in_progress is running"              running       st_api_fixture "${RUN_ONE}" "${JOB_RUNNING}"
  # ⭐ THE TWO SHAPES THAT LOOK LIKE NOTHING AND ARE NOT. A run whose job list
  # is empty, and a run carrying only OTHER jobs, both mean `apply-test` has not
  # registered yet. Reading either as `absent` is a reader walking into the
  # apply it exists to wait for — the comment in the body says so; these arms
  # make it true.
  read_arm "a run with an EMPTY job list is running, not absent" running st_api_fixture "${RUN_ONE}" "${JOB_NONE}"
  read_arm "a run with no apply-test job yet is running"         running st_api_fixture "${RUN_ONE}" "${JOB_OTHER}"
  read_arm "no runs at all is absent"             absent     st_api_fixture "${NO_RUNS}" "${JOB_OK}"
  read_arm "MALFORMED runs JSON is unreadable"    unreadable st_api_fixture "${MALFORMED}" "${JOB_OK}"
  read_arm "MALFORMED jobs JSON is unreadable"    unreadable st_api_fixture "${RUN_ONE}" "${MALFORMED}"
  read_arm "a failing API call is unreadable"     unreadable st_api_fails   "${RUN_ONE}" "${JOB_OK}"
  # Two runs on one commit: the UNFINISHED one decides. `running` outranks a
  # concluded sibling, or a re-run would let a reader past a live apply.
  read_arm "running outranks a concluded sibling" running st_api_fixture "${RUN_TWO}" "${JOB_OK}" "${JOB_RUNNING}"

  # ── READ 1's two measurable pieces ──────────────────────────────────────
  # ⚠️ WHAT THESE DO NOT COVER, stated rather than implied: the psql invocation
  # between them is unmeasured here. It is exercised end-to-end only on a real
  # TEST run. What IS measured is the classification of whatever it returns —
  # which is where "non-numeric reads as clear" would live.
  flag_arm() {  # label answer expected
    local label="$1" got
    got="$(classify_inflight_answer "$2")"
    checks=$((checks + 1))
    if [ "${got}" != "$3" ]; then
      echo "SELF-TEST FAIL: flag classification '${label}' answered '${got}', expected '$3'." >&2
      exit 1
    fi
  }
  flag_arm "zero is clear"                 "0"   clear
  flag_arm "one is held"                   "1"   held
  flag_arm "a larger count is held"        "7"   held
  flag_arm "whitespace around a count"     "  1  " held
  flag_arm "a trailing CR around a count"  "$(printf '0\r')" clear
  flag_arm "an EMPTY answer is unknown"    ""    unknown
  # ⛔ THE ONE THAT MATTERS: a psql error line must never classify as `clear`.
  flag_arm "a non-numeric answer is unknown" "ERROR" unknown
  flag_arm "a numeric-looking error is unknown" "FATAL: 28000" unknown

  # The port rewrite, driven over a synthetic token rather than a connection
  # string: ⛔ nothing DSN-shaped is written into this public file, and the
  # parameter expansion under test does not care what surrounds the port.
  port_arm() {  # label input expected
    local got
    got="$(session_mode_port "$2")"
    checks=$((checks + 1))
    if [ "${got}" != "$3" ]; then
      echo "SELF-TEST FAIL: port rewrite '${1}' produced '${got}', expected '$3'. An advisory-lock probe left on the transaction-mode port reads a different backend each poll and its answer means nothing." >&2
      exit 1
    fi
  }
  port_arm "transaction-mode port is rewritten" "left:6543/right" "left:5432/right"
  port_arm "a session-mode port is untouched"   "left:5432/right" "left:5432/right"
  port_arm "no port at all is untouched"        "left/right"      "left/right"

  # And the real probe's own no-credential path, which needs no database.
  checks=$((checks + 1))
  if [ "$(TEST_INFLIGHT_PROBE_CMD="" TEST_SUPABASE_DB_URL="" probe_inflight_flag)" != "unknown" ]; then
    echo "SELF-TEST FAIL: with no TEST credential the flag probe must answer 'unknown' — an absent credential is not a clear flag." >&2
    exit 1
  fi

  echo "wait-for-test-schema-apply self-test OK (${checks} checks) — the DISPATCHER (all three outcomes named; a held flag beats both an absent and a concluded run) AND the two READS (probe_apply_state over fixture API bytes; the flag classification and the port rewrite). ⚠️ NOT covered: the psql call itself, which only a real TEST run exercises."
}

case "${1:-}" in
  --self-test) self_test ;;
  "") wait_for_apply ;;
  *)
    echo "ERROR: unknown argument: $1 (usage: --self-test, or no arguments)" >&2
    exit 2
    ;;
esac
