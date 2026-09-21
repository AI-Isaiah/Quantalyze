#!/usr/bin/env bash
# scripts/wait-for-test-schema-apply.sh
#
# THE ORDERING WAIT ([164.8-PUSH-RACE-VAC08], Phase 164.9 plan 06, ROADMAP
# criterion 3). Invoked bare from the three DB-touching READER jobs in
# .github/workflows/ci.yml (`sql-tests`, `python`, `e2e-seeded`), immediately
# BEFORE each job's `Acquire shared-test-db mutex` step.
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
    # shellcheck disable=SC2086
    $TEST_INFLIGHT_PROBE_CMD
    return 0
  fi
  local dsn="${TEST_SUPABASE_DB_URL:-}" answer=""
  if [ -z "${dsn}" ]; then
    printf '%s' "unknown"
    return 0
  fi
  case "${dsn}" in
    *":6543/"*) dsn="${dsn%%:6543/*}:5432/${dsn#*:6543/}" ;;
  esac
  answer="$(PGCONNECT_TIMEOUT=15 timeout 20 psql "${dsn}" -X -q -A -t \
      -c "SET statement_timeout = '10s';" \
      -c "$(shared_test_db_inflight_probe_sql)" \
      2>/dev/null | tr -d '\r' | tail -1)" || answer=""
  answer="$(printf '%s' "${answer}" | tr -d '[:space:]')"
  case "${answer}" in
    ''|*[!0-9]*) printf '%s' "unknown" ;;
    0)           printf '%s' "clear" ;;
    *)           printf '%s' "held" ;;
  esac
}

# ── READ 2: the Actions API ────────────────────────────────────────────────
# Prints exactly one of: concluded-ok | concluded-bad | running | absent | unreadable.
# ⛔ The API's bytes never reach a log line. Only the derived token does.
probe_apply_state() {
  if [ -n "${TEST_APPLY_STATE_CMD:-}" ]; then
    # shellcheck disable=SC2086
    $TEST_APPLY_STATE_CMD
    return 0
  fi
  local rc=0 runs_json ids id jobs_json st cc
  local seen_running=0 seen_ok=0 seen_bad=0
  runs_json="$(gh api "repos/${GITHUB_REPOSITORY}/actions/workflows/${MIGRATE_WORKFLOW_FILE}/runs?head_sha=${GITHUB_SHA}&per_page=20" 2>/dev/null)" || rc=$?
  if [ "${rc}" -ne 0 ]; then printf '%s' "unreadable"; return 0; fi
  ids="$(printf '%s' "${runs_json}" | jq -r '.workflow_runs[]?.id' 2>/dev/null)" || { printf '%s' "unreadable"; return 0; }
  if [ -z "${ids}" ]; then printf '%s' "absent"; return 0; fi
  for id in ${ids}; do
    rc=0
    jobs_json="$(gh api "repos/${GITHUB_REPOSITORY}/actions/runs/${id}/jobs?per_page=100" 2>/dev/null)" || rc=$?
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

  echo "wait-for-test-schema-apply self-test OK (${checks} checks) — all three outcomes named, and a held flag beats an absent run."
}

case "${1:-}" in
  --self-test) self_test ;;
  "") wait_for_apply ;;
  *)
    echo "ERROR: unknown argument: $1 (usage: --self-test, or no arguments)" >&2
    exit 2
    ;;
esac
