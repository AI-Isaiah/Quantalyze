#!/usr/bin/env bash
# scripts/mutex-dead-holder-verdict.sh
#
# The CONSEQUENCE half of the shared-test-db mutex's dead-holder detection
# ([164.9-MUTEX-HOLDER-DIED-UNSERIALIZED], Phase 164.9 plan 02, ROADMAP
# criterion 12).
#
# The "Release shared-test-db mutex (best effort)" step in ci.yml,
# supabase-migrate.yml and test-restore-from-baseline.yml already DETECTS a
# holder that died before that step ran — it prints a
# "::error::...died BEFORE this release step..." annotation. But that step is
# `if: always()` and its documented invariant is that it must NEVER redden a
# job whose real work passed, and a log annotation does not change exit
# status by design. So a run could conclude GREEN on DB assertions its own
# harness had just declared untrustworthy: the advisory lock was not actually
# held for however long the holder had already been dead, i.e. this run's DB
# work may have run UNSERIALIZED, concurrently with another run against the
# shared TEST project.
#
# This script is the missing consequence. It is invoked from a SEPARATE
# `if: always()` step placed directly after the release step, so the release
# step's never-redden invariant stays byte-identical.
#
# It owns exactly ONE literal — the marker path the release step's
# dead-holder branch writes and this script reads:
#   ${RUNNER_TEMP}/shared-test-db-mutex-dead-holder
#
# ⛔ This script reads a marker FILE ONLY. It never connects to a database,
# never touches a secret and never touches a repo variable — inert on a fork
# PR, where the acquire step self-skips and no marker is ever written.
#
# Usage:
#   bash scripts/mutex-dead-holder-verdict.sh             # read the marker; exit 0 or 1
#   bash scripts/mutex-dead-holder-verdict.sh --self-test  # prove both directions
set -euo pipefail

# The ONE literal this script owns. RUNNER_TEMP is set on every GitHub
# Actions runner; the TMPDIR fallback (then /tmp) is what makes --self-test,
# and a local invocation, meaningful without one.
MARKER_PATH="${RUNNER_TEMP:-${TMPDIR:-/tmp}}/shared-test-db-mutex-dead-holder"

# verdict <marker-path> — the one thing this script does. Prints one line,
# returns 1 if the marker exists (dead holder — untrustworthy run), 0 if it
# does not (holder was alive at release).
verdict() {
  local marker="$1"
  if [ -f "${marker}" ]; then
    echo "::error::this job's shared-test-db advisory-lock holder died BEFORE the release step ran (see the 'Release shared-test-db mutex (best effort)' step's own annotation, immediately above). This run's DB assertions were made while the advisory lock was NOT held — potentially concurrently with another run against the shared TEST project. Do not trust them; investigate. Marker: ${marker}. See docs/runbooks/shared-test-db-mutex.md."
    return 1
  fi
  echo "shared-test-db mutex holder was alive at release (no dead-holder marker at ${marker}) — this run's DB assertions were serialized as designed."
  return 0
}

# --self-test — proves BOTH directions against a scratch directory this run
# creates and removes, per this phase's own standard: a control that cannot
# fail is worse than no control. Prints a closing line whose check count is
# DERIVED from a counter, never restated, so a deleted check cannot pass
# silently.
SELF_TEST_SCRATCH=""
self_test() {
  local checks=0 out rc
  # SELF_TEST_SCRATCH is deliberately NOT `local`: the EXIT trap below runs
  # at process exit, after this function has already returned and its local
  # variables have gone out of scope — a `local scratch` referenced from that
  # trap would itself trip `set -u` as an unbound variable.
  SELF_TEST_SCRATCH=$(mktemp -d)
  trap 'rm -rf "${SELF_TEST_SCRATCH}"' EXIT

  # Direction 1: marker present -> exit 1, output names the condition.
  local present="${SELF_TEST_SCRATCH}/shared-test-db-mutex-dead-holder"
  : > "${present}"
  rc=0
  out=$(verdict "${present}" 2>&1) || rc=$?
  checks=$((checks + 1))
  if [ "${rc}" -ne 1 ]; then
    echo "SELF-TEST FAIL: marker present should exit 1, got ${rc}. Output: ${out}" >&2
    exit 1
  fi
  checks=$((checks + 1))
  case "${out}" in
    *"died BEFORE the release step"*) : ;;
    *)
      echo "SELF-TEST FAIL: marker-present output did not name the dead-holder condition: ${out}" >&2
      exit 1
      ;;
  esac

  # Direction 2: marker absent -> exit 0.
  local absent="${SELF_TEST_SCRATCH}/no-such-marker"
  rc=0
  out=$(verdict "${absent}" 2>&1) || rc=$?
  checks=$((checks + 1))
  if [ "${rc}" -ne 0 ]; then
    echo "SELF-TEST FAIL: marker absent should exit 0, got ${rc}. Output: ${out}" >&2
    exit 1
  fi

  echo "mutex-dead-holder-verdict self-test OK (${checks} checks)"
}

case "${1:-}" in
  --self-test) self_test ;;
  "") verdict "${MARKER_PATH}" ;;
  *)
    echo "ERROR: unknown argument: $1 (usage: --self-test, or no arguments)" >&2
    exit 2
    ;;
esac
