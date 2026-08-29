#!/usr/bin/env bash
# Disposable-PostgreSQL lane — boot a throwaway cluster, apply SQL, run a gate,
# then destroy everything it created. Promoted (VAC-02 / D-03) from the mid-phase
# harness .planning/phases/164-.../pg-harness/run.sh, with its three MEASURED
# defects fixed.
#
# WHY THIS EXISTS. Phase 164's red-team synthesis (PROC-01) found a 456-line
# migration and a 536-line gate authored, committed, declared done and reviewed
# by three specialists with ZERO executions. This is the missing oracle. It is
# also the substrate the mutation runner, the CI job and Phase 164.4's backfill
# oracle all stand on, so its CLI contract is COSTLY to change.
#
# ============================================================================
# CLI CONTRACT — pasted VERBATIM into ci.yml. Local and CI must be byte-identical
# in mode; an A/B that changes invocation mode is not an A/B.
# ============================================================================
#
#   bash scripts/pg-lane/run.sh \
#        --workdir <scratch-dir> \
#        --apply <file.sql> [<file.sql> ...] \
#        [--post-apply <file.sql>] \
#        --gate <gate.sql>
#
#   bash scripts/pg-lane/run.sh                 # legacy demo: fixtures + the two
#                                               # Phase 164 migrations + the gate
#   bash scripts/pg-lane/run.sh --self-test     # prove the guard and the cleanup
#   bash scripts/pg-lane/run.sh --tracer-proof  # SHAPE 1c mutate->RED->pristine->GREEN
#
# Semantics: boot a throwaway cluster under <scratch-dir>/pgd, apply the --apply
# files in order, run the optional --post-apply file (the hook for the runner's
# live-DB GRANT-shape mutations, D-14 shape 2), then run --gate streaming psql
# output. Exit 0 iff the gate passed. The cluster is stopped and removed by the
# EXIT trap in EVERY outcome — success, failure and interrupt (D-04).
# Exit codes: 0 pass · 2 port collision (refused) · 130 SIGINT · 143 SIGTERM ·
#             anything else = the failing psql/step's own status.
#
# Env overrides: PGBIN (server binaries dir), PORT (fixed port), PGD is derived
# from --workdir and is NOT overridable — cleanup must own exactly what it made.
#
# ⛔ It never touches TEST or PROD. It initdb's a fresh cluster and listens on
# 127.0.0.1 only.
#
# ⚠️ WHAT IT DOES AND DOES NOT PROVE. fixtures/01-fixture-core.sql and
# fixtures/02-fixture-sanitize-tables.sql are STAND-INS: they carry only the
# columns the migrations' FKs, policies, RPCs and sanitize_user body actually
# name. The objects under test — strategy_shares, its trigger, its grants, its
# policies, both RPCs — are the REAL ones from the real migration files. So this
# proves the DDL applies, the self-verification blocks bite, and the gate's arms
# pass and can fail. It does NOT prove behaviour against the real schema's own
# RLS, constraints or triggers. That still belongs to the TEST hand-apply.
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# git first (worktree-correct), then a path fallback so a scratch COPY of this
# script — the anti-vacuity neuter harness — still runs outside a git repo.
if ! REPO=$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null); then
  REPO=$(cd "$SCRIPT_DIR/../.." && pwd)
fi
FIXTURES="$SCRIPT_DIR/fixtures"

fail() { echo "ERROR: $*" >&2; exit 1; }

# ---------------------------------------------------------------------------
# Portability fix 1 (D-07): PGBIN was hardcoded to the macOS homebrew keg, so
# the lane could not start on an ubuntu runner. Resolve instead.
# ---------------------------------------------------------------------------
resolve_pgbin() {
  local d
  if command -v pg_ctl >/dev/null 2>&1; then dirname "$(command -v pg_ctl)"; return 0; fi
  if command -v pg_config >/dev/null 2>&1; then pg_config --bindir; return 0; fi
  for d in /usr/lib/postgresql/*/bin /opt/homebrew/opt/postgresql@*/bin; do
    if [ -x "$d/pg_ctl" ]; then echo "$d"; return 0; fi
  done
  echo "ERROR: no PostgreSQL server binaries found (need initdb/pg_ctl)." >&2
  echo "Set PGBIN=<dir>, or install postgresql (ubuntu: /usr/lib/postgresql/*/bin)." >&2
  return 1
}

# ---------------------------------------------------------------------------
# Portability fix 2 (D-07): the fixed default PORT=55432 serialised concurrent
# agents — the collision guard correctly refused rather than destroying a
# neighbour's cluster, which made the lane unusable in parallel. Bind port 0 and
# let the OS pick. The pg_isready guard below still covers the TOCTOU window.
# ---------------------------------------------------------------------------
alloc_port() {
  if command -v node >/dev/null 2>&1; then
    node -e 'const s=require("net").createServer();s.listen(0,"127.0.0.1",()=>{const p=s.address().port;s.close(()=>console.log(p));});' && return 0
  fi
  # Fallback for hosts without node: probe random high ports.
  local p i
  for i in $(seq 1 50); do
    p=$((49152 + RANDOM % 15000))
    if ! pg_isready -h 127.0.0.1 -p "$p" -q 2>/dev/null; then echo "$p"; return 0; fi
  done
  echo "ERROR: could not allocate a free port." >&2
  return 1
}

# ---------------------------------------------------------------------------
# Defect fix 3 (D-04): the harness had NO pg_ctl stop, NO trap and NO rm — it
# never stopped what it started. Measured consequence 2026-08-28: 27 orphaned
# Postgres volumes (904 MB) and a container up 10 days, contributing to a
# disk-exhaustion incident. CREATED is set only AFTER this run makes its own
# data dir, so cleanup can never remove a cluster this run did not create.
# ---------------------------------------------------------------------------
PGD=""
CREATED=""
OWNED_WORKDIR=""
cleanup() {
  status=$?
  if [ -n "$CREATED" ] && [ -n "$PGD" ] && [ -d "$PGD/data" ]; then
    "$PGBIN/pg_ctl" -D "$PGD/data" stop -m immediate -w >/dev/null 2>&1 || true
    rm -rf "$PGD"
  fi
  if [ -n "$OWNED_WORKDIR" ] && [ -d "$OWNED_WORKDIR" ]; then
    rm -rf "$OWNED_WORKDIR"
  fi
  exit "$status"
}

# ⛔ IN-04: registered HERE, at the top level, not inside `run_lane`.
# It used to be registered just before `initdb`, which left two paths
# uncovered: `legacy_run` sets OWNED_WORKDIR from `mktemp -d` BEFORE calling
# `run_lane`, and `run_lane`'s own argument validation (`--gate` missing,
# apply file not found) calls `fail` — which `exit`s — before the trap
# existed. Both leaked the scratch directory. Small directories, but this is
# the script family whose entire stated purpose is that nothing it creates
# survives, and D-04's measured cost was 27 orphans and a disk-exhaustion
# incident.
#
# Registering at top level is safe because `cleanup` is guarded on CREATED and
# OWNED_WORKDIR, both initialised empty above: with nothing created it is a
# no-op. INT/TERM still route through EXIT so there is one teardown path.
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

psqlq() { psql -h 127.0.0.1 -p "$PORT" -U postgres -d postgres -v ON_ERROR_STOP=1 "$@"; }

# ---------------------------------------------------------------------------
# run_lane <workdir> <gate> [--post <file>] -- <apply files...>
# ---------------------------------------------------------------------------
run_lane() {
  local workdir="$1" gate="$2" post="$3"; shift 3
  local applies=()
  if [ "$#" -gt 0 ]; then applies=("$@"); fi
  local f i

  [ -n "$workdir" ] || fail "--workdir is required"
  [ -n "$gate" ] || fail "--gate is required"
  [ "${#applies[@]}" -gt 0 ] || fail "--apply needs at least one file"
  [ -f "$gate" ] || fail "gate file not found: $gate"
  for f in "${applies[@]}"; do [ -f "$f" ] || fail "apply file not found: $f"; done
  if [ -n "$post" ]; then [ -f "$post" ] || fail "post-apply file not found: $post"; fi

  if [ -z "${PGBIN:-}" ]; then PGBIN=$(resolve_pgbin) || exit 1; fi
  [ -x "$PGBIN/pg_ctl" ] || fail "PGBIN=$PGBIN has no executable pg_ctl"
  export PATH="$PGBIN:$PATH"
  if [ -z "${PORT:-}" ]; then PORT=$(alloc_port) || exit 1; fi

  mkdir -p "$workdir"
  workdir=$(cd "$workdir" && pwd)
  PGD="$workdir/pgd"

  # ⛔ NEVER REUSE A CLUSTER WE DID NOT CREATE. 01-fixture-core.sql opens with
  # DROP SCHEMA public CASCADE, so attaching to a port another agent is already
  # using DESTROYS their database underneath them. Measured 2026-08-28: a
  # reviewer lost an entire session this way and only noticed because
  # sanitize_user vanished from pg_proc after it had already called it. Fail
  # loud instead. (D-03: this guard must survive the promotion verbatim.)
  if pg_isready -h 127.0.0.1 -p "$PORT" -q 2>/dev/null; then
    echo "ERROR: something is already listening on 127.0.0.1:$PORT." >&2
    echo "This lane would DROP SCHEMA public CASCADE on it. Refusing." >&2
    echo "Pick a free port (or unset PORT to auto-allocate):" >&2
    echo "  PORT=\$((55000 + RANDOM % 900)) $0 ..." >&2
    exit 2
  fi

  # The trap is registered at TOP LEVEL (see above), which is strictly earlier
  # than this point — a cleanup line at the end is exactly the shape that
  # leaked 27 clusters, and a trap registered after argument validation leaked
  # the scratch dir on every early `fail` (IN-04).

  mkdir -p "$PGD"
  CREATED=1
  initdb -D "$PGD/data" -U postgres --auth=trust -E UTF8 >/dev/null
  # -k '' => TCP only. A unix socket under a scratch path blows the 103-byte limit.
  # -w waits for startup; the harness's `sleep 2` here was a measured race.
  pg_ctl -D "$PGD/data" -o "-p $PORT -c listen_addresses=127.0.0.1 -k ''" \
         -l "$PGD/pg.log" -w start >/dev/null
  for i in $(seq 1 60); do
    if pg_isready -h 127.0.0.1 -p "$PORT" -q 2>/dev/null; then break; fi
    sleep 0.25
  done
  pg_isready -h 127.0.0.1 -p "$PORT" -q 2>/dev/null \
    || fail "cluster on 127.0.0.1:$PORT never became ready (see $PGD/pg.log)"

  psqlq -q -c "CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;"

  for f in "${applies[@]}"; do psqlq -q -f "$f"; done
  if [ -n "$post" ]; then psqlq -q -f "$post"; fi
  psqlq -f "$gate"
}

# ---------------------------------------------------------------------------
# Legacy demo mode — the exact file order the harness hardcoded in its final lines.
# ---------------------------------------------------------------------------
legacy_run() {
  OWNED_WORKDIR=$(mktemp -d)
  run_lane "$OWNED_WORKDIR" \
    "$REPO/supabase/tests/test_strategy_shares_rls.sql" "" \
    "$FIXTURES/01-fixture-core.sql" \
    "$FIXTURES/02-fixture-sanitize-tables.sql" \
    "$REPO/supabase/migrations/20260827120000_strategy_shares_generation_model.sql" \
    "$REPO/supabase/migrations/20260827130000_sanitize_user_revoke_strategy_shares.sql"
}

# ===========================================================================
# --tracer-proof — the phase's thinnest end-to-end slice (D-02, D-14).
#
# Mutate a COPY of migration 20260827120000 (SHAPE 1c: the STEP 1 CREATE TABLE
# column `generation` BIGINT -> INTEGER), assert the gate goes RED with SHAPE 1c
# as the FIRST failure (first-failure identity, NOT red-anywhere), then assert
# the pristine copies go GREEN. The checkout is NEVER mutated.
# ===========================================================================
MIG_A="20260827120000_strategy_shares_generation_model.sql"
MIG_B="20260827130000_sanitize_user_revoke_strategy_shares.sql"
GATE_F="test_strategy_shares_rls.sql"

# ⚠️ MEASURED BYTE DEVIATION FROM THE PROSE ANNOTATION. The arm's RED-UNDER says
# "change `generation BIGINT` back to `generation INTEGER` in the STEP 1 CREATE
# TABLE". The literal single-space string `generation BIGINT` occurs exactly ONCE
# in that migration and it is NOT the CREATE TABLE column — it is line 828's
# `RETURNS TABLE (generation BIGINT, nonce UUID)`. Mutating that one instead
# trips the migration's OWN verification block (:1181) and ABORTS THE APPLY, so
# the gate would never run and no arm could be the first failure. The column
# declaration carries two spaces. This is exactly the prose-locator hazard
# RESEARCH §Q3 flagged; the structured annotation must carry the real bytes.
SHAPE_1C_FIND="  generation  BIGINT      NOT NULL DEFAULT 1 CHECK (generation >= 1),"
SHAPE_1C_REPL="  generation  INTEGER     NOT NULL DEFAULT 1 CHECK (generation >= 1),"

# apply_edit <file> — byte-exact find/replace, refusing any count other than 1.
# node:fs, never shell grep: grep is silently NUL-blind in this repo.
apply_edit() {
  MUT_FILE="$1" MUT_FIND="$2" MUT_REPL="$3" node -e '
    const fs = require("fs");
    const p = process.env.MUT_FILE, find = process.env.MUT_FIND, repl = process.env.MUT_REPL;
    const src = fs.readFileSync(p, "utf8");
    const n = src.split(find).length - 1;
    if (n !== 1) {
      console.error("MEASURE_FAIL: expected exactly 1 occurrence of the mutation target in " + p + ", found " + n);
      process.exit(1);
    }
    fs.writeFileSync(p, src.replace(find, repl));
  '
}

# first_failure_arm <output-file> — echoes the arm id named by the FIRST
# `TEST FAILED (` line, or MEASURE_FAIL if there is none. Never let an absent
# measurement read as a pass.
first_failure_arm() {
  OUT_FILE="$1" node -e '
    const fs = require("fs");
    const txt = fs.readFileSync(process.env.OUT_FILE, "utf8");
    const m = txt.match(/TEST FAILED \(([^)]*)\)/);
    console.log(m ? m[1] : "MEASURE_FAIL(no TEST FAILED line in output)");
  '
}

tracer_proof() {
  local scratch pristine mutated out rc arm t0 t1
  scratch=$(mktemp -d)
  # shellcheck disable=SC2064
  trap "rm -rf '$scratch'" EXIT

  pristine="$scratch/pristine"
  mutated="$scratch/mutated"
  mkdir -p "$pristine"
  cp "$FIXTURES/01-fixture-core.sql" "$FIXTURES/02-fixture-sanitize-tables.sql" "$pristine/"
  cp "$REPO/supabase/migrations/$MIG_A" "$REPO/supabase/migrations/$MIG_B" "$pristine/"
  cp "$REPO/supabase/tests/$GATE_F" "$pristine/"
  cp -R "$pristine" "$mutated"

  echo "=== TRACER: mutating a COPY (SHAPE 1c: generation BIGINT -> INTEGER) ==="
  apply_edit "$mutated/$MIG_A" "$SHAPE_1C_FIND" "$SHAPE_1C_REPL" \
    || fail "tracer: could not apply the SHAPE 1c mutation"

  echo "=== TRACER: run 1/2 — MUTATED copies, expecting RED with SHAPE 1c first ==="
  out="$scratch/mutated.out"
  t0=$(date +%s)
  set +e
  bash "$0" --workdir "$scratch/run-mutated" \
    --apply "$mutated/01-fixture-core.sql" "$mutated/02-fixture-sanitize-tables.sql" \
            "$mutated/$MIG_A" "$mutated/$MIG_B" \
    --gate "$mutated/$GATE_F" >"$out" 2>&1
  rc=$?
  set -e
  t1=$(date +%s)
  echo "    mutated run exit=$rc  elapsed=$((t1 - t0))s"
  [ "$rc" -ne 0 ] || { tail -20 "$out" >&2; fail "tracer: the MUTATED run exited 0 — the arm cannot fail"; }
  arm=$(first_failure_arm "$out")
  echo "    first failure: TEST FAILED ($arm)"
  grep -a -m1 "TEST FAILED (" "$out" | head -c 300; echo
  [ "$arm" = "SHAPE 1c" ] \
    || fail "tracer: first failure was '$arm', expected 'SHAPE 1c' (first-failure identity, not red-anywhere)"

  echo "=== TRACER: run 2/2 — PRISTINE copies, expecting GREEN ==="
  out="$scratch/pristine.out"
  t0=$(date +%s)
  set +e
  bash "$0" --workdir "$scratch/run-pristine" \
    --apply "$pristine/01-fixture-core.sql" "$pristine/02-fixture-sanitize-tables.sql" \
            "$pristine/$MIG_A" "$pristine/$MIG_B" \
    --gate "$pristine/$GATE_F" >"$out" 2>&1
  rc=$?
  set -e
  t1=$(date +%s)
  echo "    pristine run exit=$rc  elapsed=$((t1 - t0))s"
  [ "$rc" -eq 0 ] || { tail -30 "$out" >&2; fail "tracer: the PRISTINE run went RED — the gate does not pass unmutated"; }

  echo "=== TRACER PROOF PASSED: mutate -> RED(SHAPE 1c) -> pristine -> GREEN ==="
}

# ===========================================================================
# --self-test — prove the guard and the cleanup CAN fail (this phase's own
# standard: a control that cannot fail is worse than no control).
# ===========================================================================
st_fail() { echo "SELF-TEST FAIL: $*" >&2; exit 1; }

# no_orphan <port> <pgd> <label> — the assertion both kill checks share.
no_orphan() {
  local port="$1" pgd="$2" label="$3"
  if pg_isready -h 127.0.0.1 -p "$port" -q 2>/dev/null; then
    "$PGBIN/pg_ctl" -D "$pgd/data" stop -m immediate -w >/dev/null 2>&1 || true
    st_fail "$label: a postgres is STILL listening on 127.0.0.1:$port — orphaned cluster"
  fi
  if [ -d "$pgd" ]; then
    st_fail "$label: the run's data dir still exists ($pgd) — cleanup did not run"
  fi
}

# kill_check <signal> <label> — launch a lane run in its own process group,
# wait for the cluster to come up, signal it, then assert no orphan remains.
kill_check() {
  local sig="$1" label="$2" wd port i pid gate
  wd=$(mktemp -d)
  port=$(alloc_port)
  gate="$wd/slow-gate.sql"
  printf 'SELECT pg_sleep(4);\n' >"$gate"

  set -m
  PORT="$port" bash "$0" --workdir "$wd" \
    --apply "$FIXTURES/01-fixture-core.sql" --gate "$gate" >"$wd/out" 2>&1 &
  pid=$!
  set +m

  for i in $(seq 1 120); do
    if pg_isready -h 127.0.0.1 -p "$port" -q 2>/dev/null; then break; fi
    sleep 0.25
  done
  pg_isready -h 127.0.0.1 -p "$port" -q 2>/dev/null \
    || { kill -9 "$pid" 2>/dev/null || true; st_fail "$label: the lane never started a cluster to interrupt"; }

  kill -"$sig" "$pid" 2>/dev/null || true
  # Bash defers a trapped signal until the running foreground command returns,
  # so allow the in-flight psql to finish before judging. Bounded, never open.
  for i in $(seq 1 80); do
    if ! kill -0 "$pid" 2>/dev/null; then break; fi
    sleep 0.25
  done
  if kill -0 "$pid" 2>/dev/null; then
    kill -9 "$pid" 2>/dev/null || true
    st_fail "$label: the lane did not exit within 20s of SIG$sig"
  fi
  wait "$pid" 2>/dev/null || true

  no_orphan "$port" "$wd/pgd" "$label"
  rm -rf "$wd"
  echo "  ok  $label — no listener on :$port, data dir removed"
}

self_test() {
  local wd port rc gate
  if [ -z "${PGBIN:-}" ]; then PGBIN=$(resolve_pgbin) || exit 1; fi
  export PATH="$PGBIN:$PATH"

  echo "=== SELF-TEST 1/4: occupied-port refusal (the collision guard bites) ==="
  # The squatter is a REAL cluster held by a first lane run — the measured
  # scenario (two agents on one fixed port), not a stand-in TCP listener that
  # pg_isready would never recognise.
  local squat_wd squat_port squat_pid i
  squat_wd=$(mktemp -d)
  squat_port=$(alloc_port)
  printf 'SELECT pg_sleep(25);\n' >"$squat_wd/hold.sql"
  set -m
  PORT="$squat_port" bash "$0" --workdir "$squat_wd" \
    --apply "$FIXTURES/01-fixture-core.sql" --gate "$squat_wd/hold.sql" >"$squat_wd/out" 2>&1 &
  squat_pid=$!
  set +m
  for i in $(seq 1 120); do
    if pg_isready -h 127.0.0.1 -p "$squat_port" -q 2>/dev/null; then break; fi
    sleep 0.25
  done
  pg_isready -h 127.0.0.1 -p "$squat_port" -q 2>/dev/null \
    || { kill -9 "$squat_pid" 2>/dev/null || true; st_fail "could not stand up a cluster to collide with"; }

  wd=$(mktemp -d)
  set +e
  PORT="$squat_port" bash "$0" --workdir "$wd" \
    --apply "$FIXTURES/01-fixture-core.sql" --gate "$FIXTURES/01-fixture-core.sql" >"$wd/out" 2>&1
  rc=$?
  set -e
  [ "$rc" -eq 2 ] || { cat "$wd/out" >&2; kill -9 "$squat_pid" 2>/dev/null || true; st_fail "occupied-port run exited $rc, expected 2"; }
  grep -a -q "Refusing" "$wd/out" || { kill -9 "$squat_pid" 2>/dev/null || true; st_fail "occupied-port run did not print the refusal message"; }
  [ ! -d "$wd/pgd" ] || { kill -9 "$squat_pid" 2>/dev/null || true; st_fail "occupied-port run created a data dir before refusing"; }
  rm -rf "$wd"

  kill -TERM "$squat_pid" 2>/dev/null || true
  for i in $(seq 1 160); do
    if ! kill -0 "$squat_pid" 2>/dev/null; then break; fi
    sleep 0.25
  done
  wait "$squat_pid" 2>/dev/null || true
  no_orphan "$squat_port" "$squat_wd/pgd" "collision squatter teardown"
  rm -rf "$squat_wd"
  echo "  ok  refused an occupied port with exit 2 (against a real cluster)"

  echo "=== SELF-TEST 2/4: kill mid-run leaves NO orphan (D-04: on interrupt) ==="
  kill_check TERM "SIGTERM mid-run"
  kill_check INT  "SIGINT mid-run"

  echo "=== SELF-TEST 3/4: failure-path cleanup ==="
  wd=$(mktemp -d)
  gate="$wd/failing-gate.sql"
  printf "DO \$\$ BEGIN RAISE EXCEPTION 'TEST FAILED (SELF-TEST): deliberate'; END \$\$;\n" >"$gate"
  port=$(alloc_port)
  set +e
  PORT="$port" bash "$0" --workdir "$wd" \
    --apply "$FIXTURES/01-fixture-core.sql" --gate "$gate" >"$wd/out" 2>&1
  rc=$?
  set -e
  [ "$rc" -ne 0 ] || st_fail "the deliberately-failing gate exited 0"
  no_orphan "$port" "$wd/pgd" "failure-path"
  rm -rf "$wd"
  echo "  ok  failing gate exited $rc and cleaned up"

  echo "=== SELF-TEST 4/4: success-path cleanup ==="
  wd=$(mktemp -d)
  gate="$wd/passing-gate.sql"
  printf 'SELECT 1;\n' >"$gate"
  port=$(alloc_port)
  set +e
  PORT="$port" bash "$0" --workdir "$wd" \
    --apply "$FIXTURES/01-fixture-core.sql" --gate "$gate" >"$wd/out" 2>&1
  rc=$?
  set -e
  [ "$rc" -eq 0 ] || { cat "$wd/out" >&2; st_fail "the passing gate exited $rc"; }
  no_orphan "$port" "$wd/pgd" "success-path"
  rm -rf "$wd"
  echo "  ok  passing gate exited 0 and cleaned up"

  echo "=== SELF-TEST PASSED (4/4) ==="
}

# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------
main() {
  local workdir="" gate="" post="" applies=()

  if [ "$#" -eq 0 ]; then legacy_run; return; fi

  case "$1" in
    --self-test)    self_test; return ;;
    --tracer-proof) tracer_proof; return ;;
    -h|--help)      sed -n '2,45p' "$0"; return ;;
  esac

  while [ "$#" -gt 0 ]; do
    case "$1" in
      --workdir)    workdir="${2:-}"; shift 2 ;;
      --gate)       gate="${2:-}"; shift 2 ;;
      --post-apply) post="${2:-}"; shift 2 ;;
      --apply)
        shift
        while [ "$#" -gt 0 ] && [ "${1:0:2}" != "--" ]; do applies+=("$1"); shift; done
        ;;
      *) fail "unknown argument: $1 (see --help)" ;;
    esac
  done

  # ${arr[@]+…} so an empty --apply list is a fail-loud argument error, not an
  # "unbound variable" abort on bash < 4.4 (macOS /bin/bash is still 3.2).
  run_lane "$workdir" "$gate" "$post" ${applies[@]+"${applies[@]}"}
}

main "$@"
