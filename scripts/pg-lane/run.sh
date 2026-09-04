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
# ⚙️ pg_cron IS PRELOADED ON EVERY LANE (phase 164.4.1). The single `pg_ctl -o`
# start below carries `shared_preload_libraries=pg_cron` alongside
# `cron.database_name=postgres` and `cron.max_running_jobs=0`, because five SQL
# gate files probe `pg_extension` for pg_cron and three of them read
# `cron.job.command` as an ORACLE. MEASURED 2026-09-04: +0.009 s/lane, ranges
# overlapping (RESEARCH § Q4) — the preload is free. The lane does NOT run
# `CREATE EXTENSION`: a gate declares that need itself by listing
# supabase/migrations/20260513094906_enable_pg_cron.sql in its RED-UNDER-SETUP.
# ⛔ When the pg_cron binary is ABSENT this lane FAILS with a named diagnosis
# carrying both install routes. It never degrades silently — a lane that
# quietly ran without the extension would report those five gates' withheld
# Parts as passing — and it never installs anything itself: provisioning is the
# host's job (ubuntu apt in ci.yml, scripts/pg-lane/install-pg-cron-macos.sh).
#
# ⚠️ WHAT IT DOES AND DOES NOT PROVE. EVERY file under fixtures/ is a STAND-IN —
# the DIRECTORY, not a fixed list, so a fixture added later is covered on the day
# it lands. Stand-ins carry only the columns the migrations' FKs, policies, RPCs
# and function bodies actually name. The objects under test — strategy_shares,
# its trigger, its grants, its policies, both RPCs — are the REAL ones from the
# real migrations. So this proves the DDL applies, the self-verification blocks
# bite, and the gate's arms pass and can fail. It does NOT prove behaviour
# against the real schema's own RLS/constraints/triggers — the TEST hand-apply.
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
# let the OS pick. The collision guard below still covers the TOCTOU window —
# since IN-07 it is a bind test rather than `pg_isready`, so it answers for ANY
# listener, not only a postgres already accepting connections.
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
    # ⛔ A stop that FAILS is not `|| true`. It used to be: the status was
    # discarded and the data dir removed regardless, so a postmaster that
    # refused to stop kept running against a directory that no longer existed
    # — the D-04 orphan this trap exists to prevent — with NOTHING printed.
    # Now the failure is loud, the pid file (if any) is SIGKILLed before the
    # rm, and the lane's own exit status is preserved either way.
    if ! "$PGBIN/pg_ctl" -D "$PGD/data" stop -m immediate -w >/dev/null 2>&1; then
      echo "WARNING: pg_ctl stop FAILED for the lane cluster on 127.0.0.1:${PORT:-unknown} at $PGD/data." >&2
      if [ -f "$PGD/data/postmaster.pid" ]; then
        _pm_pid=$(head -n 1 "$PGD/data/postmaster.pid" 2>/dev/null || true)
        case "$_pm_pid" in
          ''|*[!0-9]*)
            echo "WARNING: $PGD/data/postmaster.pid holds no numeric pid ('${_pm_pid}'); a postmaster may be ORPHANED on port ${PORT:-unknown} (D-04). Check \`ps\` before trusting this box." >&2 ;;
          *)
            if kill -9 "$_pm_pid" 2>/dev/null; then
              echo "WARNING: sent SIGKILL to postmaster pid ${_pm_pid} (from postmaster.pid) before removing $PGD." >&2
            else
              echo "WARNING: could not SIGKILL pid ${_pm_pid} from postmaster.pid (already gone, or not ours); removing $PGD anyway." >&2
            fi ;;
        esac
      else
        echo "WARNING: no postmaster.pid under $PGD/data, so there is no pid to SIGKILL; removing $PGD. If a postmaster is still bound to port ${PORT:-unknown}, it is ORPHANED (D-04)." >&2
      fi
    fi
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

# `VERBOSITY=verbose` is set on EVERY leg, not only the gate leg (164.3.1-05,
# RESEARCH Open Question 2 — a discretion call, recorded here rather than
# implied). Verbose adds the inline SQLSTATE token (`P0001:` after `ERROR:`)
# and a `LOCATION:` line after every ERROR *and* NOTICE. The runner's
# source-location attribution needs both: `P0001` asserts the error really is
# a `RAISE EXCEPTION`, and `LOCATION:` is the end-of-block sentinel that bounds
# the CONTEXT chain it must count frames in.
#
# UNIFORM rather than gate-leg-only because uniformity means the runner has ONE
# output grammar to parse instead of two — a second shape is a second parser,
# and a second parser is where a silent divergence lives. The cost is bounded:
# apply/post-apply legs run `-q`, so the extra noise is a `LOCATION:` line per
# message they were already printing, and those legs emit nothing on success.
psqlq() { psql -h 127.0.0.1 -p "$PORT" -U postgres -d postgres -v ON_ERROR_STOP=1 -v VERBOSITY=verbose "$@"; }

# ---------------------------------------------------------------------------
# pg_cron presence (phase 164.4.1). `shared_preload_libraries=pg_cron` names a
# library the postmaster loads AT START; when that library is not on the box the
# start FAILS, and the failure surfaces as this script's opaque "cluster never
# became ready" with the real cause buried in pg.log. RESEARCH Pitfall 6: the
# lane must fail LOUD with a NAMED diagnosis.
#
# ⛔ The lane never installs anything. Making the binary present is the HOST's
# job (RESEARCH Architectural Responsibility Map): apt in the ci.yml
# provisioning step, scripts/pg-lane/install-pg-cron-macos.sh on this box. A
# lane that repaired its own host would make "the extension is present"
# untestable — it could never be observed absent.
#
# TWO layers, because neither covers the other's host:
#   1. pre-start, needs `pg_config` — reads pkglibdir/sharedir and refuses
#      BEFORE initdb, so no cluster is built for a start that cannot succeed.
#      An ubuntu runner that resolved pg_ctl off PATH may have no pg_config.
#   2. post-start, needs nothing — greps the postmaster's own pg.log line.
# ONE message for both, so a reader never has to decide which wording is
# authoritative.
# ---------------------------------------------------------------------------
pg_cron_missing_msg() {
  printf '%s\n' \
    "pg_cron is NOT available to the PostgreSQL server binaries this lane booted." \
    "  missing:         $1" \
    "  server binaries: ${PGBIN:-<unresolved>}" \
    "This lane preloads pg_cron on its single pg_ctl start (phase 164.4.1): five SQL" \
    "gate files probe pg_extension for pg_cron and three read cron.job.command as an" \
    "oracle, so a lane without it cannot falsify them. Install it on the HOST — this" \
    "script never installs anything itself:" \
    "  ubuntu: sudo apt-get install -y postgresql-\$(pg_config --version | awk '{print \$2}' | cut -d. -f1)-cron   # 16 on ubuntu-latest" \
    "  macOS:  bash scripts/pg-lane/install-pg-cron-macos.sh"
}

# Layer 2's reader. Called on a failed start AND before the readiness-loop's own
# refusal, because pg_ctl -w can report either shape depending on how far the
# postmaster got before it gave up on the preload.
pg_cron_diagnose_log() {
  if [ -n "$PGD" ] && [ -f "$PGD/pg.log" ] \
     && grep -a -q 'could not access file "pg_cron"' "$PGD/pg.log"; then
    fail "$(pg_cron_missing_msg "the postmaster REFUSED TO START — $PGD/pg.log says: could not access file \"pg_cron\"")"
  fi
}

# ---------------------------------------------------------------------------
# run_lane <workdir> <gate> [--post <file>] -- <apply files...>
# ---------------------------------------------------------------------------
run_lane() {
  local workdir="$1" gate="$2" post="$3"; shift 3
  local applies=()
  if [ "$#" -gt 0 ]; then applies=("$@"); fi
  local f i port_occupied

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
  #
  # ⛔ IN-07: the guard used to be `pg_isready` alone, which exits 0 only for a
  # server ACCEPTING connections. A postgres that is starting up, in recovery,
  # or refusing connections exits non-zero and the guard passed — while the
  # message printed claimed the broader property "something is already
  # listening". The blast radius was bounded (`pg_ctl -w start` then fails to
  # bind and `set -e` aborts before any `psqlq`), but a refusal message that
  # claims a broader check than it performs is this phase's own subject.
  #
  # A bind test answers the question the message asks — and detects a
  # NON-postgres listener too, which `pg_isready` never could. It uses the same
  # `node -e` primitive `alloc_port` already relies on. When node is absent the
  # guard falls back to `pg_isready` AND says out loud what it could not check,
  # rather than printing the broad claim regardless.
  port_occupied=""
  if command -v node >/dev/null 2>&1; then
    if ! node -e 'const s=require("net").createServer();s.once("error",()=>process.exit(1));s.listen(Number(process.argv[1]),"127.0.0.1",()=>s.close(()=>process.exit(0)));' "$PORT" 2>/dev/null; then
      port_occupied="something is already listening on 127.0.0.1:$PORT (measured by trying to bind it)"
    fi
  else
    if pg_isready -h 127.0.0.1 -p "$PORT" -q 2>/dev/null; then
      port_occupied="a PostgreSQL server on 127.0.0.1:$PORT is accepting connections"
    else
      echo "NOTE: node is unavailable, so this collision guard could only ask pg_isready." >&2
      echo "      That answers ONLY for a server accepting connections — a postgres still" >&2
      echo "      starting up or in recovery, or any non-postgres listener, is NOT covered." >&2
    fi
  fi
  if [ -n "$port_occupied" ]; then
    echo "ERROR: ${port_occupied}." >&2
    echo "This lane would DROP SCHEMA public CASCADE on it. Refusing." >&2
    echo "Pick a free port (or unset PORT to auto-allocate):" >&2
    echo "  PORT=\$((55000 + RANDOM % 900)) $0 ..." >&2
    exit 2
  fi

  # The trap is registered at TOP LEVEL (see above), which is strictly earlier
  # than this point — a cleanup line at the end is exactly the shape that
  # leaked 27 clusters, and a trap registered after argument validation leaked
  # the scratch dir on every early `fail` (IN-04).

  # pg_cron layer 1 — pre-start, and BEFORE initdb so a host that cannot start
  # this lane never gets a data dir built for it. Runs only where pg_config can
  # name the two directories; layer 2 covers the hosts where it cannot.
  if [ -x "$PGBIN/pg_config" ]; then
    local pkglibdir sharedir cron_lib
    pkglibdir=$("$PGBIN/pg_config" --pkglibdir)
    sharedir=$("$PGBIN/pg_config" --sharedir)
    cron_lib=""
    if [ -f "$pkglibdir/pg_cron.so" ]; then cron_lib="$pkglibdir/pg_cron.so"; fi
    if [ -z "$cron_lib" ] && [ -f "$pkglibdir/pg_cron.dylib" ]; then cron_lib="$pkglibdir/pg_cron.dylib"; fi
    if [ -z "$cron_lib" ]; then
      fail "$(pg_cron_missing_msg "$pkglibdir/pg_cron.so (and pg_cron.dylib) — neither exists")"
    fi
    # ⛔ The library alone is not enough: PostgreSQL 16 has no
    # extension_control_path (that is PG18), so `CREATE EXTENSION pg_cron` can
    # only find the control file in the server's OWN sharedir. A lane with the
    # .so and no .control preloads fine and then fails every gate at CREATE
    # EXTENSION — the silent-degrade shape this check exists to refuse.
    if [ ! -f "$sharedir/extension/pg_cron.control" ]; then
      fail "$(pg_cron_missing_msg "$sharedir/extension/pg_cron.control (the library at $cron_lib IS present)")"
    fi
  fi

  mkdir -p "$PGD"
  CREATED=1
  initdb -D "$PGD/data" -U postgres --auth=trust -E UTF8 >/dev/null
  # -k '' => TCP only. A unix socket under a scratch path blows the 103-byte limit.
  # -w waits for startup; the harness's `sleep 2` here was a measured race.
  # -c shared_preload_libraries=pg_cron => pg_cron refuses to load outside
  #    shared_preload_libraries, and this is the ONLY start this lane ever
  #    makes, so `-o` needs no restart and no postgresql.conf edit. MEASURED
  #    2026-09-04: +0.009 s/lane, ranges overlapping (RESEARCH § Q4).
  # -c cron.database_name=postgres => the lane's database IS postgres, which is
  #    also pg_cron's default; stated rather than defaulted, per D-06's refusal
  #    of silent defaults (a default that changes upstream would move the
  #    worker's target with nothing here to notice).
  # -c cron.max_running_jobs=0 => the GUC's minimum is 0 in pg_cron 1.6.7, and
  #    at 0 the launcher never starts a job. Without it a lane whose apply list
  #    schedules a `*/15 * * * *` reaper and happens to straddle :00/:15/:30/:45
  #    would run that job body concurrently with the gate. The gates read
  #    cron.job ROWS; no gate needs a tick (RESEARCH § Q3), so this deletes a
  #    per-lane nondeterminism for free.
  if ! pg_ctl -D "$PGD/data" \
       -o "-p $PORT -c listen_addresses=127.0.0.1 -k '' -c shared_preload_libraries=pg_cron -c cron.database_name=postgres -c cron.max_running_jobs=0" \
       -l "$PGD/pg.log" -w start >/dev/null; then
    pg_cron_diagnose_log
    fail "pg_ctl could not start the lane cluster on 127.0.0.1:$PORT (see $PGD/pg.log)"
  fi
  for i in $(seq 1 60); do
    if pg_isready -h 127.0.0.1 -p "$PORT" -q 2>/dev/null; then break; fi
    sleep 0.25
  done
  if ! pg_isready -h 127.0.0.1 -p "$PORT" -q 2>/dev/null; then
    pg_cron_diagnose_log
    fail "cluster on 127.0.0.1:$PORT never became ready (see $PGD/pg.log)"
  fi

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

  # ⛔ SP-H01. Arm 2 says "Not a pass" when its prerequisite is missing and then
  # NOTHING ACTS ON IT: the arm was silently dropped from the count and the run
  # still printed a PASSED caption naming the FULL arm count and exited 0. (That
  # caption is quoted by shape rather than by digits on purpose: the denominator
  # is a hand-maintained literal — TODOS [PGLANE-SELFTEST-COUNT-UNPINNED] — and a
  # dated history line that restates it goes stale on the next arm.) The dropped arm is
  # precisely the one proving the collision guard is as WIDE as its message
  # (IN-07) — so a `node`-less machine reported the broad property proven while
  # only the narrow one had been checked. That is the SKIP-01 shape this branch
  # exists to delete, committed inside the branch's own lane.
  #
  # Every skip is now tallied and REPORTED, and an incomplete self-test exits 1.
  local st_skipped=0
  local st_skips=""

  echo "=== SELF-TEST 1/6: occupied-port refusal (the collision guard bites) ==="
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

  echo "=== SELF-TEST 2/6: refusal against a NON-postgres listener (IN-07) ==="
  # IN-07: the same refusal against a NON-postgres listener. The old
  # `pg_isready` guard could not see this at all — it exits non-zero for
  # anything that is not a PostgreSQL server accepting connections — while the
  # message it printed claimed the broad property "something is already
  # listening". This arm is what makes the message and the check the same
  # claim. Skipped (loudly) when node is absent, because the fallback guard
  # genuinely cannot cover it and says so at runtime.
  if command -v node >/dev/null 2>&1; then
    local tcp_port tcp_pid tcp_wd tcp_rc
    tcp_port=$(alloc_port)
    node -e 'const s=require("net").createServer();s.listen(Number(process.argv[1]),"127.0.0.1",()=>{setTimeout(()=>process.exit(0),30000)});' "$tcp_port" &
    tcp_pid=$!
    # ⛔ R2-I04: the readiness loop breaks when the bind FAILS, i.e. when the
    # listener is up. If the background node listener never comes up, the loop
    # simply exhausts its 40 iterations and falls through — the lane then runs
    # UNREFUSED (correctly, there is nothing to collide with) and the arm below
    # reports "the guard is narrower than its message", blaming the guard for a
    # FIXTURE that did not start. So the precondition is asserted explicitly,
    # with its own message, before the guard is judged.
    local listener_up=0
    for i in $(seq 1 40); do
      if ! node -e 'const s=require("net").createServer();s.once("error",()=>process.exit(1));s.listen(Number(process.argv[1]),"127.0.0.1",()=>s.close(()=>process.exit(0)));' "$tcp_port" 2>/dev/null; then listener_up=1; break; fi
      sleep 0.25
    done
    if [ "$listener_up" -ne 1 ]; then
      kill -9 "$tcp_pid" 2>/dev/null || true
      wait "$tcp_pid" 2>/dev/null || true
      st_fail "could not stand up a plain TCP listener on 127.0.0.1:${tcp_port} to collide with. That is a FIXTURE failure, not a guard failure — this arm has proven nothing about the guard and must not report that it has."
    fi
    tcp_wd=$(mktemp -d)
    set +e
    PORT="$tcp_port" bash "$0" --workdir "$tcp_wd" \
      --apply "$FIXTURES/01-fixture-core.sql" --gate "$FIXTURES/01-fixture-core.sql" >"$tcp_wd/out" 2>&1
    tcp_rc=$?
    set -e
    kill -9 "$tcp_pid" 2>/dev/null || true
    wait "$tcp_pid" 2>/dev/null || true
    [ "$tcp_rc" -eq 2 ] || { cat "$tcp_wd/out" >&2; rm -rf "$tcp_wd"; st_fail "non-postgres listener run exited $tcp_rc, expected 2 — the guard is narrower than its message"; }
    grep -a -q "Refusing" "$tcp_wd/out" || { rm -rf "$tcp_wd"; st_fail "non-postgres listener run did not print the refusal message"; }
    [ ! -d "$tcp_wd/pgd" ] || { rm -rf "$tcp_wd"; st_fail "non-postgres listener run created a data dir before refusing"; }
    rm -rf "$tcp_wd"
    echo "  ok  refused a NON-postgres listener with exit 2 (pg_isready alone could not see it)"
  else
    echo "  SKIP non-postgres-listener arm: node is unavailable, so the guard falls back to pg_isready and CANNOT cover this case. Not a pass." >&2
    st_skipped=$((st_skipped + 1))
    st_skips="${st_skips}${st_skips:+, }arm 2 (non-postgres listener): node absent"
  fi

  echo "=== SELF-TEST 3/6: kill mid-run leaves NO orphan (D-04: on interrupt) ==="
  kill_check TERM "SIGTERM mid-run"
  kill_check INT  "SIGINT mid-run"

  echo "=== SELF-TEST 4/6: failure-path cleanup ==="
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

  echo "=== SELF-TEST 5/6: success-path cleanup ==="
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

  echo "=== SELF-TEST 6/6: the preload took effect — CREATE EXTENSION pg_cron succeeds, cron.schedule writes a cron.job row, and the SAME gate is RED when it asks for an extension that is not there ==="
  # ⛔ TWO HALVES, and the second is what makes the first mean anything. A gate
  # that only asserts pg_cron IS present passes on every lane where it is — it
  # cannot tell "the preload took effect" apart from "this gate cannot fail".
  # The control below is the SAME gate bytes with ONE identifier changed, so its
  # RED is a RED from this arm's own machinery, not from a different program.
  #
  # ⚠️ The control asserts the FAILURE TEXT, not merely a non-zero exit. A lane
  # that died of anything else — a port collision, a broken apply — also exits
  # non-zero, and accepting that would let this arm report the assertion bit
  # when the lane merely broke.
  local cron_mig gate2 port2 rc2 ver
  cron_mig="$REPO/supabase/migrations/20260513094906_enable_pg_cron.sql"
  # A missing migration is a FIXTURE failure, and this arm must not report a
  # guard failure for it (the R2-I04 lesson from arm 2 above).
  [ -f "$cron_mig" ] || st_fail "the pg_cron enabling migration is not at $cron_mig, so no lane could CREATE the extension. That is a FIXTURE failure: this arm has proven NOTHING about the preload and must not report that it has."
  wd=$(mktemp -d)
  gate="$wd/pgcron-gate.sql"
  # A heredoc rather than the one-line printf arms 4 and 5 use: this gate is multi-line,
  # DO block, and the quoted delimiter keeps every $ and % verbatim.
  cat >"$gate" <<'SQL'
DO $$
DECLARE v_id bigint; v_cmd text; v_ver text;
BEGIN
  SELECT extversion INTO v_ver FROM pg_extension WHERE extname = 'pg_cron';
  IF v_ver IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED (SELF-TEST 6): pg_extension has no pg_cron row after the apply list ran 20260513094906_enable_pg_cron.sql. Either the postmaster did not preload pg_cron, or CREATE EXTENSION could not find its control file.';
  END IF;
  SELECT cron.schedule('selftest-6', '35 * * * *', 'SELECT 1') INTO v_id;
  SELECT command INTO v_cmd FROM cron.job WHERE jobname = 'selftest-6';
  IF v_cmd IS DISTINCT FROM 'SELECT 1' THEN
    RAISE EXCEPTION 'TEST FAILED (SELF-TEST 6): cron.job holds command % for jobname selftest-6, expected SELECT 1. Three gate files read cron.job.command as an ORACLE, so a cron.schedule that does not persist the body verbatim would make those arms assert against a value nothing wrote.', COALESCE(v_cmd, '<no row at all>');
  END IF;
  RAISE NOTICE 'SELF-TEST 6 OK: pg_cron % loaded, cron.job row written (jobid %)', v_ver, v_id;
END $$;
SQL
  port=$(alloc_port)
  set +e
  PORT="$port" bash "$0" --workdir "$wd" \
    --apply "$FIXTURES/01-fixture-core.sql" "$cron_mig" --gate "$gate" >"$wd/out" 2>&1
  rc=$?
  set -e
  [ "$rc" -eq 0 ] || { cat "$wd/out" >&2; st_fail "the pg_cron gate exited $rc — the preload did not take effect, or CREATE EXTENSION / cron.schedule failed"; }
  grep -a -q 'SELF-TEST 6 OK' "$wd/out" || { cat "$wd/out" >&2; st_fail "the pg_cron gate exited 0 but printed no 'SELF-TEST 6 OK' line — an exit status without the marker is not a measurement"; }
  no_orphan "$port" "$wd/pgd" "pg_cron preload"
  ver=$(sed -n 's/.*SELF-TEST 6 OK: pg_cron \([^ ]*\) loaded.*/\1/p' "$wd/out" | head -1)
  echo "  ok  pg_cron ${ver:-<version unread>} loaded on a real lane; CREATE EXTENSION succeeded and cron.job holds the scheduled row"

  gate2="$wd/pgcron-gate-control.sql"
  sed "s/extname = 'pg_cron'/extname = 'pg_cron_not_installed_here'/" "$gate" >"$gate2"
  grep -a -q "pg_cron_not_installed_here" "$gate2" \
    || st_fail "the CONTROL gate was not produced (the sed target moved). That is a FIXTURE failure — the shown-to-fail half has not run, so the half above is unproven."
  port2=$(alloc_port)
  set +e
  PORT="$port2" bash "$0" --workdir "$wd/control" \
    --apply "$FIXTURES/01-fixture-core.sql" "$cron_mig" --gate "$gate2" >"$wd/out2" 2>&1
  rc2=$?
  set -e
  [ "$rc2" -ne 0 ] || { cat "$wd/out2" >&2; st_fail "the CONTROL gate — the same bytes asking for an extension that is NOT installed — exited 0. This arm cannot fail, which makes the success half above worth nothing"; }
  grep -a -q 'TEST FAILED (SELF-TEST 6)' "$wd/out2" \
    || { cat "$wd/out2" >&2; st_fail "the CONTROL gate exited $rc2 but printed no 'TEST FAILED (SELF-TEST 6)' line. A non-zero exit carrying a raw driver error proves the LANE broke, not that this arm's assertion bit."; }
  no_orphan "$port2" "$wd/control/pgd" "pg_cron preload control"
  rm -rf "$wd"
  echo "  ok  the same gate went RED naming SELF-TEST 6 against an absent extension — the half above is shown to be able to fail"

  # ⛔ SP-H01: the denominator must be a COUNT, not a caption. An arm that did not run is
  # subtracted, named, and turned into exit 1 — "could not check" and "checked,
  # no problem" do not share an exit code here.
  if [ "$st_skipped" -ne 0 ]; then
    echo "=== SELF-TEST INCOMPLETE ($((6 - st_skipped))/6 run, ${st_skipped} skipped: ${st_skips}) ===" >&2
    echo "A self-test that could not run an arm has not proven that arm. Install the" >&2
    echo "missing prerequisite and re-run; this is a hard failure, not a pass." >&2
    exit 1
  fi
  echo "=== SELF-TEST PASSED (6/6) ==="
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
    # 2,59 rather than the former 2,45: the header gained the phase-164.4.1
    # pg_cron paragraph (14 lines), and this range is a byte offset into this
    # file, not a semantic one. Re-point it whenever the header grows or --help
    # silently stops printing the paragraphs below the cut.
    -h|--help)      sed -n '2,59p' "$0"; return ;;
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
