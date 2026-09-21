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
# that holder to reproduce a mid-job death. It then drives the SAME shell
# logic the release step runs (pidfile present, `kill` fails against the
# already-dead pid, marker written), invokes
# scripts/mutex-dead-holder-verdict.sh and asserts it exits non-zero and
# names the condition (the RED observation). It then removes the marker and
# asserts the verdict exits 0 (the GREEN observation), so this drill proves
# discrimination rather than a script that always fails.
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

fail() { echo "ERROR: $*" >&2; exit 1; }

# ⛔ REFUSE any argument before booting anything. This drill takes none — it
# only ever connects to its own disposable 127.0.0.1 cluster, never to a
# connection target a caller supplies. A DSN handed in as an argument is
# refused here rather than honoured.
if [ "$#" -gt 0 ]; then
  fail "this drill takes no arguments — it only ever connects to its own disposable 127.0.0.1 cluster, never to a connection target a caller supplies. Got $# argument(s)."
fi

[ -f "$VERDICT_SH" ] || fail "scripts/mutex-dead-holder-verdict.sh not found at $VERDICT_SH"

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

# This drill's own RUNNER_TEMP stand-in for its pid/marker files, mirroring
# ci.yml's acquire/release-step file-naming convention exactly so the shell
# logic driven below is the real thing, not a paraphrase of it.
RUNNER_TEMP="$WORKDIR"
export RUNNER_TEMP
PIDFILE="$RUNNER_TEMP/shared-test-db-mutex.pid"
LOG="$RUNNER_TEMP/shared-test-db-mutex.log"
MARKER="$RUNNER_TEMP/shared-test-db-mutex-dead-holder"

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

# ── Drive the SAME shell logic the release step runs: pidfile present,
# `kill` fails against the already-dead pid, marker written. ───────────────
holder="$(cat "$PIDFILE")"
if kill "${holder}" 2>/dev/null; then
  fail "the release-step logic's kill succeeded against a pid this drill already killed (pid reuse?) — it did not reproduce a dead holder. Re-run."
fi
: > "${MARKER}"
echo "=== DRILL: dead-holder marker written at ${MARKER} (mirrors the release step's dead-holder branch) ==="

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
grep -q 'died BEFORE the release step' "$WORKDIR/verdict-red.out" \
  || { cat "$WORKDIR/verdict-red.out" >&2; fail "RED OBSERVATION FAILED: the verdict exited ${rc_red} but did not name the dead-holder condition."; }
echo "=== RED OBSERVED: verdict exited ${rc_red} and named the dead-holder condition ==="

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
echo "=== GREEN OBSERVED: verdict exited 0 with the marker absent ==="

echo "=== VERDICT: mutex-dead-holder-lane PASSED — killed a real holder on a disposable cluster, observed RED then GREEN ==="
