#!/usr/bin/env bash
# scripts/pg-lane/mutex-dead-holder-lane.sh
#
# Falsification drill for [164.9-MUTEX-HOLDER-DIED-UNSERIALIZED]
# (Phase 164.9 plan 02, ROADMAP criterion 12).
#
# Boots a throwaway PostgreSQL cluster on 127.0.0.1, starts a background psql
# session that takes the SAME session advisory lock key (61616158) the
# shared-test-db mutex uses and sleeps — the same shape the acquire step in
# .github/workflows/ci.yml starts, on this disposable cluster instead of
# shared TEST — records its client pid to a pidfile the same way, then KILLS
# that holder to reproduce a mid-job death. It then runs the release step's
# OWN shell body — EXTRACTED VERBATIM FROM .github/workflows/ci.yml at run
# time, never restated here — invokes scripts/mutex-dead-holder-verdict.sh
# and asserts it exits non-zero and names the condition (the RED
# observation). It then removes the marker and asserts the verdict exits 0
# (the GREEN observation), so this drill proves discrimination rather than a
# script that always fails.
#
# ⛔ "THE SAME LOGIC, NOT A PARAPHRASE" IS LOAD-BEARING AND IS NOW EARNED.
# An earlier version of this file made that claim while writing the
# dead-holder marker ITSELF, from a hand-copied literal, and never opening
# ci.yml at all. Deleting the marker-writing line from the release step
# would have left this drill — and every other gate — green while the
# verdict went permanently green too: the exact silent-green this phase
# exists to remove, sitting inside its own fix. Nothing about the release
# step's file names, its marker path or its dead-holder branch is spelled
# out below; every one of them is derived from ci.yml, and a ci.yml that
# stops writing a marker makes this drill FAIL LOUD instead of passing.
#
# ⛔ It NEVER touches a hosted project. It takes no arguments — any argument
# is refused before anything boots, because this drill only ever connects to
# the disposable cluster it creates on 127.0.0.1 and never to a connection
# target a caller supplies. It asks scripts/pg-lane/run.sh --print-pgbin for
# server binaries rather than holding a second opinion, and it destroys its
# cluster and scratch directory from an EXIT trap in every outcome.
#
# Usage: bash scripts/pg-lane/mutex-dead-holder-lane.sh
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO=$(cd "$SCRIPT_DIR/../.." && pwd)
VERDICT_SH="$REPO/scripts/mutex-dead-holder-verdict.sh"
CI_YML="$REPO/.github/workflows/ci.yml"

fail() { echo "ERROR: $*" >&2; exit 1; }

# ⛔ REFUSE any argument before booting anything. This drill takes none — it
# only ever connects to its own disposable 127.0.0.1 cluster, never to a
# connection target a caller supplies. A DSN handed in as an argument is
# refused here rather than honoured.
if [ "$#" -gt 0 ]; then
  fail "this drill takes no arguments — it only ever connects to its own disposable 127.0.0.1 cluster, never to a connection target a caller supplies. Got $# argument(s)."
fi

[ -f "$VERDICT_SH" ] || fail "scripts/mutex-dead-holder-verdict.sh not found at $VERDICT_SH"
[ -f "$CI_YML" ] || fail ".github/workflows/ci.yml not found at $CI_YML — this drill runs the release step's own body and has nothing to run without it."

PGBIN=$("$SCRIPT_DIR/run.sh" --print-pgbin) \
  || fail "scripts/pg-lane/run.sh --print-pgbin refused — no PostgreSQL server binaries available. This drill cannot run and reports nothing rather than a green it did not measure."
export PATH="$PGBIN:$PATH"

WORKDIR=$(mktemp -d)
PGD="$WORKDIR/pgd"
CREATED=""
HOLDER_PID=""
cleanup() {
  local status=$?
  if [ -n "${HOLDER_PID}" ] && kill -0 "${HOLDER_PID}" 2>/dev/null; then
    kill -9 "${HOLDER_PID}" 2>/dev/null || true
  fi
  if [ -n "${CREATED}" ] && [ -d "${PGD}/data" ]; then
    "$PGBIN/pg_ctl" -D "${PGD}/data" stop -m immediate -w >/dev/null 2>&1 || true
  fi
  rm -rf "${WORKDIR}"
  exit "${status}"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

alloc_port() {
  if command -v node >/dev/null 2>&1; then
    node -e 'const s=require("net").createServer();s.listen(0,"127.0.0.1",()=>{const p=s.address().port;s.close(()=>console.log(p));});'
  else
    echo $((49152 + RANDOM % 15000))
  fi
}
PORT=$(alloc_port)

mkdir -p "$PGD"
CREATED=1
initdb -D "$PGD/data" -U postgres --auth=trust -E UTF8 >/dev/null
pg_ctl -D "$PGD/data" \
  -o "-p $PORT -c listen_addresses=127.0.0.1 -k ''" \
  -l "$PGD/pg.log" -w start >/dev/null \
  || fail "pg_ctl could not start the drill cluster on 127.0.0.1:$PORT (see $PGD/pg.log)"
for i in $(seq 1 60); do
  if pg_isready -h 127.0.0.1 -p "$PORT" -q 2>/dev/null; then break; fi
  sleep 0.25
done
pg_isready -h 127.0.0.1 -p "$PORT" -q 2>/dev/null \
  || fail "cluster on 127.0.0.1:$PORT never became ready (see $PGD/pg.log)"

psqlq() { psql -h 127.0.0.1 -p "$PORT" -U postgres -d postgres -X -q -A -t -v ON_ERROR_STOP=1 "$@"; }

# This drill's own RUNNER_TEMP stand-in. Everything the release step reads or
# writes underneath it is DERIVED FROM ci.yml below — this line only decides
# WHERE the runner's scratch directory is, which is the one thing a runner
# supplies and a workflow file never states.
RUNNER_TEMP="$WORKDIR"
export RUNNER_TEMP

# ── Extract the release step's own `run:` body from ci.yml, verbatim. ─────
# The body is the block under `run: |` inside the first
# `Release shared-test-db mutex (best effort)` step, de-indented by the ten
# spaces GitHub itself strips. It is EXECUTED below, not re-implemented.
RELEASE_STEP_NAME="Release shared-test-db mutex (best effort)"
RELEASE_BODY=$(awk -v want="      - name: ${RELEASE_STEP_NAME}" '
  $0 == want { instep = 1; next }
  instep && $0 == "        run: |" { inbody = 1; next }
  inbody {
    if ($0 !~ /^          / && $0 !~ /^[[:space:]]*$/) { exit }
    sub(/^          /, ""); print
  }
' "$CI_YML")
[ -n "${RELEASE_BODY}" ] \
  || fail "could not extract the \"${RELEASE_STEP_NAME}\" step's run: body from ${CI_YML}. This drill EXECUTES that body rather than restating it, so it has nothing to drive and refuses rather than reporting a green it did not measure."

# ── Derive the two paths the body itself names, from the body itself. ─────
# ⛔ Neither is written out here. A ci.yml that stops writing a dead-holder
# marker makes the second derivation find nothing and this drill fail LOUD —
# which is the whole point of reading the line instead of copying it.
derive_one() {
  # derive_one <label> <grep -E pattern> — exactly one matching line, or fail.
  local label="$1" pattern="$2" lines n
  lines=$(printf '%s\n' "${RELEASE_BODY}" | grep -aE "${pattern}" || true)
  n=$(printf '%s' "${lines}" | grep -ac '' || true)
  case "${n}" in
    1) printf '%s\n' "${lines}" ;;
    *)
      fail "expected EXACTLY ONE ${label} line in the \"${RELEASE_STEP_NAME}\" step's body in ${CI_YML}, found ${n}. Matching pattern: ${pattern}. ${label} is what this drill drives; zero of them means the release step no longer does the thing the verdict step turns into a job verdict, and this drill must not pass."
      ;;
  esac
}

PIDFILE_LINE=$(derive_one "pidfile assignment" '^[[:space:]]*pidfile="\$\{RUNNER_TEMP\}/[^"]+"[[:space:]]*$')
eval "${PIDFILE_LINE}"
PIDFILE="${pidfile}"

MARKER_LINE=$(derive_one "dead-holder marker write" '^[[:space:]]*: > "\$\{RUNNER_TEMP\}/[^"]+"[[:space:]]*$')
eval "MARKER=$(printf '%s' "${MARKER_LINE}" | sed -E 's/^[[:space:]]*: > //')"

LOG="$RUNNER_TEMP/mutex-dead-holder-lane-holder.log"
echo "=== DRILL: derived from ${CI_YML##*/} — pidfile ${PIDFILE##*/}, dead-holder marker ${MARKER##*/} ==="

# ── Start the holder: a background psql session taking the SAME session
# advisory lock key (61616158) the shared-test-db mutex uses, then sleeping.
: > "$LOG"
psqlq -c "SELECT pg_advisory_lock(61616158);" -c "SELECT 'MUTEX-ACQUIRED';" -c "SELECT pg_sleep(60);" \
  >> "$LOG" 2>&1 &
HOLDER_PID=$!
echo "${HOLDER_PID}" > "$PIDFILE"

for i in $(seq 1 100); do
  if grep -q 'MUTEX-ACQUIRED' "$LOG" 2>/dev/null; then break; fi
  kill -0 "${HOLDER_PID}" 2>/dev/null || fail "the holder session died before acquiring the lock — see $LOG"
  sleep 0.1
done
grep -q 'MUTEX-ACQUIRED' "$LOG" 2>/dev/null \
  || fail "the holder never acquired the lock within the drill's wait budget — see $LOG"
echo "=== DRILL: holder pid ${HOLDER_PID} holds advisory lock 61616158 on the disposable cluster ==="

# ── Kill the holder to reproduce a mid-job death, BEFORE any release step
# would ever run. ────────────────────────────────────────────────────────
kill -9 "${HOLDER_PID}" 2>/dev/null || true
for i in $(seq 1 40); do
  kill -0 "${HOLDER_PID}" 2>/dev/null || break
  sleep 0.1
done
if kill -0 "${HOLDER_PID}" 2>/dev/null; then
  fail "could not kill the holder pid ${HOLDER_PID} — the drill cannot reproduce a dead holder"
fi
echo "=== DRILL: holder pid ${HOLDER_PID} killed — reproducing 'died BEFORE this release step' ==="

# ── RUN THE RELEASE STEP'S OWN BODY. Not a mirror of it — the bytes
# extracted from ci.yml above, executed in a subshell under the same shell
# options GitHub Actions uses for a `run:` block (`-e -o pipefail`, and NOT
# `-u`). The subshell is what makes the body's own `exit 0` early return
# land where it would on a runner instead of ending this drill. The secret
# is unset so the server-side reap branch can never reach a network: with no
# backend pidfile written, that branch is unreachable anyway and the body
# takes its "No server backend pid recorded" path. ───────────────────────
set +e
( set +u; set -e -o pipefail; unset TEST_SUPABASE_DB_URL; eval "${RELEASE_BODY}" ) \
  > "$WORKDIR/release-body.out" 2>&1
rc_release=$?
set -e
sed 's/^/    | /' "$WORKDIR/release-body.out"
[ "$rc_release" -eq 0 ] \
  || fail "the release step's own body exited ${rc_release} on this drill's fixture. Its documented invariant is that it NEVER reddens a job, so a non-zero exit here is a regression in ci.yml, not in this drill."
grep -aq 'died BEFORE this release step' "$WORKDIR/release-body.out" \
  || fail "the release step's own body did not print its dead-holder annotation against an already-dead holder. Either its \`kill\` succeeded (pid reuse — re-run) or the dead-holder branch is gone from ci.yml."
[ -f "${MARKER}" ] \
  || fail "the release step's own body ran its dead-holder branch but no marker exists at ${MARKER}. The verdict step reads a marker file and nothing else, so a release step that stops writing one turns the verdict permanently green — this is exactly the condition this drill exists to catch."
echo "=== DRILL: the release step's own body wrote the dead-holder marker at ${MARKER} ==="

# ── Observation 1 (RED): the verdict script must exit non-zero and name the
# condition. ─────────────────────────────────────────────────────────────
set +e
bash "$VERDICT_SH" > "$WORKDIR/verdict-red.out" 2>&1
rc_red=$?
set -e
if [ "$rc_red" -eq 0 ]; then
  cat "$WORKDIR/verdict-red.out" >&2
  fail "RED OBSERVATION FAILED: the verdict script exited 0 with the dead-holder marker present."
fi
grep -aq 'died BEFORE the release step' "$WORKDIR/verdict-red.out" \
  || { cat "$WORKDIR/verdict-red.out" >&2; fail "RED OBSERVATION FAILED: the verdict exited ${rc_red} but did not name the dead-holder condition."; }
# ⛔ AND THE TWO SIDES MUST AGREE ON THE PATH. The release step writes a
# marker; the verdict script computes its own MARKER_PATH from RUNNER_TEMP.
# Nothing else in the repo makes those two literals equal, so a rename on
# either side would leave both files individually sensible and the verdict
# permanently green. The verdict names the path it read; assert it is the
# path ci.yml's own body just wrote.
grep -aqF "Marker: ${MARKER}" "$WORKDIR/verdict-red.out" \
  || { cat "$WORKDIR/verdict-red.out" >&2; fail "PATH MISMATCH: the release step's body (from ci.yml) wrote its marker at ${MARKER}, but scripts/mutex-dead-holder-verdict.sh reports reading a different path. The two literals have diverged, which silently disarms the verdict."; }
echo "=== RED OBSERVED: verdict exited ${rc_red}, named the dead-holder condition, and read the SAME marker path ci.yml wrote ==="

# ── Observation 2 (GREEN): remove the marker, the verdict must exit 0. ────
rm -f "${MARKER}"
set +e
bash "$VERDICT_SH" > "$WORKDIR/verdict-green.out" 2>&1
rc_green=$?
set -e
if [ "$rc_green" -ne 0 ]; then
  cat "$WORKDIR/verdict-green.out" >&2
  fail "GREEN OBSERVATION FAILED: the verdict script exited ${rc_green} with no marker present."
fi
# ⛔ AND THE GREEN MUST NOT OVERCLAIM. This script reads a marker FILE; an
# absent marker is the absence of a death REPORT, not an observation that
# the advisory lock was held. The verdict used to print "were serialized as
# designed" here — an unmeasured positive. Assert it reports absence as
# absence instead.
grep -aq 'ABSENCE, NOT A MEASUREMENT' "$WORKDIR/verdict-green.out" \
  || { cat "$WORKDIR/verdict-green.out" >&2; fail "GREEN OBSERVATION FAILED: with no marker the verdict exited 0 but did not say that an absent marker is an ABSENCE rather than a measurement. An unmeasured thing is not a green thing."; }
if grep -aq 'serialized as designed' "$WORKDIR/verdict-green.out"; then
  cat "$WORKDIR/verdict-green.out" >&2
  fail "GREEN OBSERVATION FAILED: the verdict claims this run's DB assertions 'were serialized as designed' on the strength of an ABSENT marker. It observed no such thing."
fi
echo "=== GREEN OBSERVED: verdict exited 0 with the marker absent, and reported that absence AS an absence ==="

echo "=== VERDICT: mutex-dead-holder-lane PASSED — killed a real holder on a disposable cluster, observed RED then GREEN ==="
