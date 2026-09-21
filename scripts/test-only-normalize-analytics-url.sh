#!/usr/bin/env bash
# test-only-normalize-analytics-url — point shared TEST's analytics destination
# row at the loopback discard sink the allow-list constraint ALREADY permits.
#
# Phase 164.9 TESTISOLATION / plan 10, closing [164.8.1-TEST-ANALYTICS-URL-PROD].
# Runbook: docs/runbooks/test-analytics-url.md
#
# ── WHAT THE HAZARD IS ─────────────────────────────────────────────────────
# `public.system_settings`'s `analytics_service_url` row is the destination
# `public.match_engine_cron_tick()` POSTs a Vault-held service key to. It is
# SEEDED with the production analytics host. On shared TEST that means a
# scheduled tick can reach the production compute service — with a real key in
# an outbound header — and nothing downstream reports that it did.
#
# ── WHY THIS IS A SCRIPT AND ⛔ MUST NEVER BECOME A MIGRATION ───────────────
# Every merge touching `supabase/migrations/**` AUTO-APPLIES to PRODUCTION. A
# migration that rewrites this row would therefore rewrite PRODUCTION's own
# destination row, pointing the live match engine at a closed local port. The
# change wanted here is TEST-shaped and TEST-only, so it lives outside the
# migration ledger by construction, not by preference.
#
# ── WHY THE LOOPBACK SINK AND NOT A TEST-SCOPED SERVICE ────────────────────
# The sink is `http://127.0.0.1:9` — loopback, the IANA DISCARD port — and the
# allow-list CHECK constraint on that row ALREADY permits it (see migration
# 20260907120000's ⚠️ THE ONE NON-RAILWAY VALUE note). So this needs no new
# infrastructure and no constraint change: it changes WHICH ALLOWED VALUE the
# row holds, nothing else. An outbound attempt lands on a closed local port and
# is refused harmlessly. ⛔ The allow-list is NEVER weakened to accommodate a
# value; that is the control this whole line of work exists to keep.
#
# ── ⛔ TWO TRAPS, STATED HERE AND AGAIN IN THE RUNBOOK ─────────────────────
#  1. THE TICK IS ASYNCHRONOUS. `net.http_post` is fire-and-forget, so a
#     `succeeded` scheduled-job row says NOTHING about the HTTP outcome — seven
#     days of authentication failures once hid behind one. Nothing this script
#     prints is a claim about what any request did.
#  2. THE DATABASE MARKER CONFIRMS WHICH **DATABASE** YOU ARE ON. It never
#     confirms which **SERVICE** a tick calls. Do not let one stand in for the
#     other.
#
# ── ⛔ NO VALUE IS EVER PRINTED ────────────────────────────────────────────
# This log is public and the value in question is a host. Every verdict names a
# SHAPE — a length, a scheme, a classification. A proof that the hazard is gone
# must not publish the hazard.
#
# ── USAGE ──────────────────────────────────────────────────────────────────
#   NORMALIZE_DB_URL=… bash scripts/test-only-normalize-analytics-url.sh --run
#       DRY RUN — the DEFAULT. Reads, reports, writes nothing.
#   NORMALIZE_DB_URL=… bash scripts/test-only-normalize-analytics-url.sh --run --commit
#       COMMITTING — the one mode that writes. Explicit by design.
#   bash scripts/test-only-normalize-analytics-url.sh --self-test
#       Boots a throwaway cluster and proves every refusal FIRES.
#   bash scripts/test-only-normalize-analytics-url.sh --help
#
# ── ENV ────────────────────────────────────────────────────────────────────
#   NORMALIZE_DB_URL             required for --run. NEVER printed.
#   NORMALIZE_SINK               default: http://127.0.0.1:9
#   NORMALIZE_EXPECT_MARKER_RE   default: `test` as a whole word, case-insensitive
#   NORMALIZE_REFUSE_MARKER_RE   default: `prod`, case-insensitive
#   PGBIN                        (self-test only) server binaries for the lane
#
# ⛔ IT NEVER TOUCHES PRODUCTION. The marker refusal is the first thing it does
# and it fails CLOSED: an absent marker is a STOP, not a proceed.
set -uo pipefail

GATE="test-only-normalize-analytics-url"
SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

fail() { echo "${GATE}: REFUSED — $*" >&2; exit 1; }
note() { echo "${GATE}: $*"; }

# The shared-TEST advisory mutex. TEST is shared with other people's CI and we
# cannot see their runs, so a write here is never private. Same integer every
# other writer against this database uses.
MUTEX_KEY=61616158

NORMALIZE_SINK="${NORMALIZE_SINK:-http://127.0.0.1:9}"
NORMALIZE_EXPECT_MARKER_RE="${NORMALIZE_EXPECT_MARKER_RE:-(^|[^[:alnum:]_])test([^[:alnum:]_]|$)}"
NORMALIZE_REFUSE_MARKER_RE="${NORMALIZE_REFUSE_MARKER_RE:-prod}"

MODE="dry-run"
ACTION=""

usage() { sed -n '2,62p' "${BASH_SOURCE[0]}"; }

while [ $# -gt 0 ]; do
  case "$1" in
    --run)       ACTION="run" ;;
    --commit)    MODE="commit" ;;
    --self-test) ACTION="self-test" ;;
    --help|-h)   usage; exit 0 ;;
    *)           echo "${GATE}: unknown argument '$1'" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

# ═══════════════════════════════════════════════════════════════════════════
# THE ONE STATEMENT BLOCK. Guards and write live in ONE psql session, in ONE
# transaction, in THIS order — marker, mutex, no-op, write — so that nothing can
# change between a guard passing and the write happening.
#
# ⚠️ `pg_try_advisory_xact_lock`, not the session form: the transaction's end
# releases it, so a crashed or killed run cannot leave shared TEST's mutex held
# by a dead holder. ⛔ `try`, not the blocking form: a wait would queue behind
# another CI job and then write into whatever state that job left.
#
# ⚠️ The predicates arrive as transaction-local settings rather than as text
# spliced into the body. psql does NOT interpolate its variables inside a
# dollar-quoted block, and splicing them in from the shell would make an
# env-supplied regex able to close the quote. `set_config` is quoted by psql's
# own `:'var'` form, which is the whole point of using it.
# ═══════════════════════════════════════════════════════════════════════════
build_sql() {
  local write="$1"   # "1" to write, "0" for a dry run
  cat <<'SQLHEAD'
BEGIN;
SQLHEAD
  cat <<SQLVARS
SELECT set_config('tonau.sink',     :'sink',      true);
SELECT set_config('tonau.expect',   :'expect_re', true);
SELECT set_config('tonau.refuse',   :'refuse_re', true);
SELECT set_config('tonau.write',    '${write}',   true);
SELECT set_config('tonau.mutexkey', '${MUTEX_KEY}', true);
SQLVARS
  cat <<'SQLBODY'
DO $tonau$
DECLARE
  v_marker TEXT;
  v_val    TEXT;
  v_n      INTEGER;
  c_sink   CONSTANT TEXT := current_setting('tonau.sink');
  c_expect CONSTANT TEXT := current_setting('tonau.expect');
  c_refuse CONSTANT TEXT := current_setting('tonau.refuse');
  c_write  CONSTANT BOOLEAN := current_setting('tonau.write') = '1';
  c_key    CONSTANT BIGINT := current_setting('tonau.mutexkey')::BIGINT;
BEGIN
  -- ─── GUARD 1 — WHICH DATABASE AM I ON. The FIRST statement. ─────────────
  -- current_database() is `postgres` on BOTH hosted projects and proves
  -- NOTHING. Each project carries a hand-set COMMENT ON DATABASE naming
  -- itself, and that description is the only in-session discriminator.
  SELECT shobj_description(d.oid, 'pg_database')
    INTO v_marker
    FROM pg_database d
   WHERE d.datname = current_database();

  IF v_marker IS NULL OR btrim(v_marker) = '' THEN
    RAISE EXCEPTION 'REFUSED: the database identity marker is ABSENT. An unmarked database is not a TEST database, it is an UNKNOWN one — and on a hosted project a missing marker means the marker was LOST, not that this is TEST. Re-set the COMMENT ON DATABASE marker before writing. The marker text is withheld: this log is public.';
  END IF;
  IF v_marker ~* c_refuse THEN
    RAISE EXCEPTION 'REFUSED: the database identity marker names PRODUCTION. Refusing, loudly. Production''s own destination row is the live match engine''s destination and must never be pointed at a closed local port. The marker text is withheld: this log is public.';
  END IF;
  IF v_marker !~* c_expect THEN
    RAISE EXCEPTION 'REFUSED: the database identity marker does not name TEST. This operation is TEST-only and it will not guess. The marker text is withheld: this log is public.';
  END IF;

  -- ─── GUARD 2 — the shared-TEST advisory mutex. ──────────────────────────
  IF NOT pg_try_advisory_xact_lock(c_key) THEN
    RAISE EXCEPTION 'REFUSED: the shared-TEST advisory mutex (%) is held by another session. TEST is shared with other people''s CI, a write here is not private, and writing under somebody else''s migration apply or restore corrupts a reading rather than merely delaying it. Wait for the holder and re-run.', c_key;
  END IF;

  -- ─── GUARD 3 — is there anything to do at all. ──────────────────────────
  SELECT s.value INTO v_val
    FROM public.system_settings s
   WHERE s.key = 'analytics_service_url';

  IF v_val IS NULL THEN
    RAISE EXCEPTION 'REFUSED: there is no analytics_service_url row on this database, so there is nothing to repoint. That row is supposed to exist — the migration seeds it and the reference-data replay restores it — so its absence is a finding in its own right and not a licence to INSERT one here. Find out why it is gone.';
  END IF;

  IF v_val = c_sink THEN
    RAISE EXCEPTION 'REFUSED: the analytics_service_url row ALREADY holds the loopback discard sink. There is nothing to do, and a no-op write is still a write against a database other people''s CI is using. ⭐ THIS REFUSAL IS THE POST-CONDITION: seeing it on a follow-up dry run is how the remediation is confirmed, read from the LIVE row rather than from the committing run''s own report of success.';
  END IF;

  -- ─── THE VERDICT, BY SHAPE. ⛔ Never the value. ─────────────────────────
  RAISE NOTICE 'VERDICT: the analytics_service_url row holds a value of length % character(s) whose scheme is %, and it is NOT the loopback discard sink. That value is the destination a tick on this database POSTs the Vault-held service key to.',
    length(v_val), split_part(v_val, ':', 1);

  IF NOT c_write THEN
    RAISE NOTICE 'DRY RUN: nothing was written. This run would have set that ONE row to the loopback discard sink — a value the allow-list constraint already permits — and would have changed nothing else. Re-run with --commit to do it.';
    RETURN;
  END IF;

  -- ─── THE WRITE. One row, one column, nothing else. ──────────────────────
  -- ⛔ The allow-list CHECK constraint is NOT touched. If this UPDATE is
  -- refused by it, that is the constraint reporting a real change to what it
  -- permits, and the answer is to read the constraint, never to drop it.
  UPDATE public.system_settings
     SET value = c_sink
   WHERE key = 'analytics_service_url';
  GET DIAGNOSTICS v_n = ROW_COUNT;

  IF v_n <> 1 THEN
    RAISE EXCEPTION 'REFUSED: the update touched % row(s), expected exactly 1. Rolling back rather than leaving an unknown number of settings rows rewritten.', v_n;
  END IF;

  RAISE NOTICE 'COMMITTED: the analytics_service_url row now holds the loopback discard sink. ⛔ THIS IS A CLAIM ABOUT THE ROW AND NOTHING ELSE. It is NOT a claim about what any tick did or will do over HTTP: net.http_post is fire-and-forget, so a green scheduled-job row is evidence of nothing, and the database marker confirms which DATABASE you are on and never which SERVICE a tick calls. Confirm by re-running in DRY RUN mode: it must now REFUSE on an already-correct value.';
END
$tonau$;
COMMIT;
SQLBODY
}

do_run() {
  command -v psql >/dev/null 2>&1 \
    || fail "psql is not on PATH. This is a HARD FAILURE, not a skip: a remediation that cannot connect has not confirmed anything."
  [ -n "${NORMALIZE_DB_URL:-}" ] \
    || fail "NORMALIZE_DB_URL is required and is not set. This is a HARD FAILURE, not a skip. ⛔ Do NOT reach for a Supabase CLI link instead — this checkout's link points at PRODUCTION."

  local write=0
  # ⚠️ `tmpd` is DELIBERATELY NOT `local`. The EXIT trap below fires AFTER this
  # function has returned, so a local is out of scope by then and `set -u` aborts
  # the trap itself — which does not merely print a confusing message, it SKIPS
  # THE CLEANUP and leaves the temp dir on disk. That dir holds the psql stderr
  # file this script refuses to print precisely because it can name the host and
  # the DB user, so the failure path would leak exactly what the success path
  # protects. MEASURED 2026-09-21 on a connection failure: `tmpd: unbound
  # variable`, dir survived. The `${tmpd:-}` guard is a second belt, not the fix.
  tmpd="$(mktemp -d)"
  trap 'rm -rf "${tmpd:-}"' EXIT
  [ "$MODE" = "commit" ] && write=1

  build_sql "$write" > "$tmpd/op.sql"

  note "mode: ${MODE}$([ "$MODE" = dry-run ] && echo ' (default — writes NOTHING)')"

  local rc=0
  psql "$NORMALIZE_DB_URL" -X -q -v ON_ERROR_STOP=1 \
       -v "sink=${NORMALIZE_SINK}" \
       -v "expect_re=${NORMALIZE_EXPECT_MARKER_RE}" \
       -v "refuse_re=${NORMALIZE_REFUSE_MARKER_RE}" \
       -f "$tmpd/op.sql" > "$tmpd/out" 2> "$tmpd/err" || rc=$?

  # ⛔ The captured streams are NEVER echoed wholesale: a libpq connection
  # diagnostic names the host, its IP and the DB user, and this log is public.
  # Only the lines this script authored are printed, by their own prefixes.
  grep -aoE '(REFUSED|VERDICT|DRY RUN|COMMITTED): .*' "$tmpd/out" "$tmpd/err" \
    | sed -E 's#^[^:]*:(REFUSED|VERDICT|DRY RUN|COMMITTED)#\1#' \
    | sed "s#^#${GATE}: #"

  if [ "$rc" -ne 0 ]; then
    if grep -aq 'REFUSED:' "$tmpd/err" "$tmpd/out"; then
      echo "${GATE}: exiting 1 on a refusal above. Nothing was written." >&2
      return 1
    fi
    echo "${GATE}: psql exited ${rc} and printed no refusal of this script's own. Its stderr is at a temp path and is NOT printed — it can name the host and the DB user. Nothing was written." >&2
    return 1
  fi
  return 0
}

# ═══════════════════════════════════════════════════════════════════════════
# SELF-TEST — a throwaway cluster, every refusal OBSERVED FIRING.
#
# ⛔ It never connects to a hosted project. It initdb's its own cluster on a
# free loopback port; a run that cannot boot one REFUSES rather than falling
# through to whatever NORMALIZE_DB_URL happens to hold.
# ═══════════════════════════════════════════════════════════════════════════
ST_PGD=""; ST_TMPD=""; ST_CREATED=""; ST_HOLDER_PID=""

st_cleanup() {
  local status=$?
  if [ -n "$ST_HOLDER_PID" ]; then kill "$ST_HOLDER_PID" 2>/dev/null || true; wait "$ST_HOLDER_PID" 2>/dev/null || true; fi
  if [ -n "$ST_CREATED" ] && [ -n "$ST_PGD" ] && [ -d "$ST_PGD/data" ]; then
    "$PGBIN/pg_ctl" -D "$ST_PGD/data" stop -m immediate -w >/dev/null 2>&1 \
      || echo "WARNING: pg_ctl stop FAILED for the self-test cluster at $ST_PGD/data; a postmaster may be ORPHANED." >&2
  fi
  [ -n "$ST_TMPD" ] && [ -d "$ST_TMPD" ] && rm -rf "$ST_TMPD"
  exit "$status"
}

self_test() {
  command -v node >/dev/null 2>&1 || fail "node is not on PATH; the self-test needs it to allocate a free port."
  command -v psql >/dev/null 2>&1 || fail "psql is not on PATH."

  # Ask the lane which server binaries it would boot rather than keeping a
  # second, divergent opinion. PGBIN in the environment wins, as it does there.
  if [ -z "${PGBIN:-}" ]; then
    [ -f "$SCRIPT_DIR/pg-lane/run.sh" ] \
      || fail "could not locate scripts/pg-lane/run.sh to resolve PGBIN. Set PGBIN=<dir> explicitly."
    PGBIN=$(bash "$SCRIPT_DIR/pg-lane/run.sh" --print-pgbin) \
      || fail "scripts/pg-lane/run.sh --print-pgbin could not resolve PostgreSQL server binaries."
  fi
  [ -x "$PGBIN/pg_ctl" ]   || fail "PGBIN=$PGBIN has no executable pg_ctl"
  [ -x "$PGBIN/postgres" ] || fail "PGBIN=$PGBIN has pg_ctl but no \`postgres\` server binary — that is a CLIENT-only keg, not a server"
  export PATH="$PGBIN:$PATH"

  ST_TMPD="$(mktemp -d)"; ST_PGD="$ST_TMPD/pgd"
  trap st_cleanup EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM

  local port
  port=$(node -e 'const s=require("net").createServer();s.listen(0,"127.0.0.1",()=>{const p=s.address().port;s.close(()=>console.log(p));});') \
    || fail "could not allocate a free port."

  mkdir -p "$ST_PGD"; ST_CREATED=1
  initdb -D "$ST_PGD/data" -U postgres --auth=trust -E UTF8 >/dev/null \
    || fail "initdb could not create the self-test cluster."
  pg_ctl -D "$ST_PGD/data" -o "-p $port -c listen_addresses=127.0.0.1 -k ''" \
         -l "$ST_PGD/pg.log" -w start >/dev/null \
    || fail "pg_ctl could not start the self-test cluster on 127.0.0.1:${port} (see ${ST_PGD}/pg.log)"
  local i
  for i in $(seq 1 60); do pg_isready -h 127.0.0.1 -p "$port" -q 2>/dev/null && break; sleep 0.25; done
  pg_isready -h 127.0.0.1 -p "$port" -q 2>/dev/null \
    || fail "the self-test cluster never became ready (see ${ST_PGD}/pg.log)"

  # ⚠️ A CONNECTION-STRING-SHAPED LITERAL IN A TRACKED FILE, AND IT IS SAFE BY
  # CONSTRUCTION — recorded because the rule it brushes against is otherwise
  # absolute. It names 127.0.0.1 and a port this run just allocated, on a cluster
  # this run just created with trust auth, and it carries no password and no
  # host that exists after the process exits. scripts/restore-test-from-baseline
  # .sh's own self-test uses the identical shape for the identical reason.
  # ⛔ It is NOT spelled in pieces to dodge a grep: a scan you route around is a
  # scan you have disabled, and the honest answer to a rule is a reason, not a
  # workaround.
  local dsn="postgresql://postgres@127.0.0.1:${port}/postgres"
  st_q() { psql "$dsn" -X -q -A -t -v ON_ERROR_STOP=1 -c "$1" | tr -d '[:space:]'; }
  st_x() { psql "$dsn" -X -q -v ON_ERROR_STOP=1 -c "$1" >/dev/null; }

  # The fixture: the destination row under its real allow-list constraint, and a
  # stand-in seed value that is NOT the sink. ⛔ Deliberately a SYNTHETIC host
  # under the allow-listed suffix and never this project's real one — a
  # self-test that had to name the production host would publish it on every
  # run, which is the disclosure this whole operation is trying to avoid.
  st_x "CREATE TABLE public.system_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);"
  st_x "ALTER TABLE public.system_settings ADD CONSTRAINT system_settings_analytics_service_url_allowed CHECK (key <> 'analytics_service_url' OR value ~ '^(https://[a-z0-9][a-z0-9.-]*\.up\.railway\.app|http://127\.0\.0\.1:9)\$');"

  local seed='https://selftest-stand-in.up.railway.app'
  st_seed() {
    st_x "DELETE FROM public.system_settings WHERE key = 'analytics_service_url';"
    st_x "INSERT INTO public.system_settings (key, value) VALUES ('analytics_service_url', '${seed}');"
  }

  local checks=0 fails=0
  local results=()

  st_case() {  # name want_rc needle env-prefixed command…
    local name="$1" want_rc="$2" needle="$3"; shift 3
    local out="$ST_TMPD/${name}.out" rc=0
    "$@" > "$out" 2>&1 || rc=$?
    checks=$((checks + 1))
    if [ "$rc" != "$want_rc" ]; then
      results+=("  FAIL ${name}: exit ${rc}, expected ${want_rc}"); fails=$((fails + 1)); return 1
    fi
    if ! grep -aq "$needle" "$out"; then
      results+=("  FAIL ${name}: exit ${rc} as expected, but the output does not carry '${needle}' — it stopped for some OTHER reason, so this refusal is UNMEASURED"); fails=$((fails + 1)); return 1
    fi
    results+=("  ok   ${name} (exit ${rc}, '${needle}')")
    return 0
  }

  st_row_is() {  # name expected-value
    local name="$1" want="$2" got
    got=$(st_q "SELECT value FROM public.system_settings WHERE key = 'analytics_service_url';")
    checks=$((checks + 1))
    if [ "$got" != "$want" ]; then
      results+=("  FAIL ${name}: the row does not read as this arm requires (shape: length ${#got}, expected length ${#want}). ⛔ The values are compared but never printed — the same discipline the script itself keeps."); fails=$((fails + 1)); return 1
    fi
    results+=("  ok   ${name} (the row reads as this arm requires)")
    return 0
  }

  run_it() { env NORMALIZE_DB_URL="$dsn" bash "${BASH_SOURCE[0]}" "$@"; }

  # ── 1. the credential is absent ─────────────────────────────────────────
  st_case credential-absent 1 'NORMALIZE_DB_URL is required' \
    env -u NORMALIZE_DB_URL bash "${BASH_SOURCE[0]}" --run

  # ── 2. the marker is ABSENT ─────────────────────────────────────────────
  st_seed
  st_x "COMMENT ON DATABASE postgres IS NULL;"
  st_case marker-absent 1 'identity marker is ABSENT' run_it --run --commit
  st_row_is marker-absent-wrote-nothing "$seed"

  # ── 3. the marker names PRODUCTION ──────────────────────────────────────
  # Written so it matches the EXPECT predicate TOO. A marker that failed EXPECT
  # first would exercise the wrong branch and the PROD refusal would go
  # unmeasured — the same calibration the restore script's arm 3 records.
  st_x "COMMENT ON DATABASE postgres IS 'quantalyze TEST-shaped fixture that names PROD';"
  st_case marker-prod 1 'names PRODUCTION' run_it --run --commit
  st_row_is marker-prod-wrote-nothing "$seed"

  # ── 4. a marker naming neither ──────────────────────────────────────────
  st_x "COMMENT ON DATABASE postgres IS 'a hand-set marker naming neither';"
  st_case marker-neither 1 'does not name TEST' run_it --run --commit
  st_row_is marker-neither-wrote-nothing "$seed"

  # From here on the marker names TEST.
  st_x "COMMENT ON DATABASE postgres IS 'quantalyze shared TEST database';"

  # ── 5. the mutex is held by ANOTHER session ─────────────────────────────
  : > "$ST_TMPD/holder.log"
  nohup psql "$dsn" -X -q -A -t -v ON_ERROR_STOP=1 \
        -c "SET statement_timeout = 0;" \
        -c "SELECT pg_advisory_lock(${MUTEX_KEY});" \
        -c "SELECT 'MUTEX-ACQUIRED';" \
        -c "SELECT pg_sleep(600);" >> "$ST_TMPD/holder.log" 2>&1 &
  ST_HOLDER_PID=$!
  for i in $(seq 1 80); do grep -aq 'MUTEX-ACQUIRED' "$ST_TMPD/holder.log" && break; sleep 0.25; done
  grep -aq 'MUTEX-ACQUIRED' "$ST_TMPD/holder.log" \
    || { results+=("  FAIL mutex-held: the holder never acquired the lock, so this arm would measure nothing"); fails=$((fails + 1)); }
  st_case mutex-held 1 'advisory mutex' run_it --run --commit
  st_row_is mutex-held-wrote-nothing "$seed"
  # ⛔ MEASURED TWICE, and the SECOND measurement is the interesting one.
  # `kill` + `wait` reaps the CLIENT and leaves the BACKEND alive: the server
  # does not notice a departed client until it next tries to write, and this one
  # is parked inside `pg_sleep`. So the advisory lock was still held twenty
  # seconds later, every arm below refused on the mutex, and each of their
  # assertions then failed for a reason that had nothing to do with what it was
  # asking. KILLING A PSQL CLIENT IS NOT KILLING ITS BACKEND — terminate the
  # backend by the lock it holds, then WAIT for the lock to actually go.
  kill "$ST_HOLDER_PID" 2>/dev/null || true; wait "$ST_HOLDER_PID" 2>/dev/null || true; ST_HOLDER_PID=""
  st_x "SELECT pg_terminate_backend(l.pid) FROM pg_locks l WHERE l.locktype='advisory' AND l.classid=0 AND l.objid=${MUTEX_KEY} AND l.objsubid=1 AND l.granted AND l.pid <> pg_backend_pid();"
  for i in $(seq 1 80); do
    [ "$(st_q "SELECT count(*) FROM pg_locks WHERE locktype='advisory' AND classid=0 AND objid=${MUTEX_KEY} AND objsubid=1 AND granted;")" = "0" ] && break
    sleep 0.25
  done
  checks=$((checks + 1))
  if [ "$(st_q "SELECT count(*) FROM pg_locks WHERE locktype='advisory' AND classid=0 AND objid=${MUTEX_KEY} AND objsubid=1 AND granted;")" != "0" ]; then
    results+=("  FAIL mutex-released: the holder's backend still holds ${MUTEX_KEY}; every arm below would refuse on the mutex and measure nothing")
    fails=$((fails + 1))
  else
    results+=("  ok   mutex-released (the holder's BACKEND is gone, not just its client)")
  fi

  # ── 6. DRY RUN is the default and it writes NOTHING ──────────────────────
  st_case dry-run-default 0 'DRY RUN: nothing was written' run_it --run
  st_row_is dry-run-wrote-nothing "$seed"

  # ── 7. the dry run reports a SHAPE and NEVER the value ───────────────────
  checks=$((checks + 1))
  if grep -aq 'selftest-stand-in' "$ST_TMPD/dry-run-default.out"; then
    results+=("  FAIL dry-run-withholds-value: the dry run ECHOED the destination value. This log is public and the value is a host."); fails=$((fails + 1))
  elif ! grep -aq 'length [0-9]* character(s) whose scheme is' "$ST_TMPD/dry-run-default.out"; then
    results+=("  FAIL dry-run-withholds-value: the dry run printed no SHAPE, so 'it withheld the value' is satisfied by a run that reported nothing at all"); fails=$((fails + 1))
  else
    results+=("  ok   dry-run-withholds-value (a shape, never the value)")
  fi

  # ── 8. there is no row at all ───────────────────────────────────────────
  st_x "DELETE FROM public.system_settings WHERE key = 'analytics_service_url';"
  st_case no-row 1 'there is no analytics_service_url row' run_it --run --commit
  st_seed

  # ── 9. the committing run WRITES, exactly one row ───────────────────────
  st_case commit-writes 0 'COMMITTED:' run_it --run --commit
  st_row_is commit-landed-the-sink "$NORMALIZE_SINK"

  # ── 10. and the follow-up DRY RUN now REFUSES on an already-correct value.
  # ⭐ THAT REFUSAL IS THE POST-CONDITION — read from the live row, not from the
  # committing run's own report of success.
  st_case already-correct 1 'ALREADY holds the loopback discard sink' run_it --run
  st_row_is already-correct-wrote-nothing "$NORMALIZE_SINK"

  # ── 11. nothing this script printed carries a DSN ────────────────────────
  # ⛔ THE CORPUS IS ASSERTED TO EXIST BEFORE IT IS SCANNED, AND THAT IS THE
  # WHOLE CHECK. It used to read `grep -arhoE … "$ST_TMPD"/*.out 2>/dev/null`:
  # if the glob matched NO file — an arm renamed its output, an `st_case`
  # returned early before any `.out` existed, `$ST_TMPD` not what this line
  # assumed — bash passed the LITERAL pattern, grep's "No such file" went to
  # /dev/null, the pipeline came back empty and the check reported `ok` while
  # `checks` still incremented. A clean count having read nothing. This is the
  # same class that already bit THIS FILE once (the EXIT-trap leak, whose
  # failure path published what its success path protected) — this time in the
  # DETECTION half, which is worse: a detector that cannot fire is indistinguishable
  # from an absence of the thing it detects.
  # ⚠️ `holder.log` IS IN SCOPE NOW. It carries the mutex holder's own psql
  # stderr and was never inspected; the cluster's `pg.log` lives under
  # "$ST_PGD" and is deliberately still out of scope — it is the SERVER's log,
  # not this script's captured output.
  shopt -s nullglob
  local scan=( "$ST_TMPD"/*.out "$ST_TMPD"/*.log )
  shopt -u nullglob
  checks=$((checks + 1))
  if [ "${#scan[@]}" -eq 0 ]; then
    results+=("  FAIL output-carries-no-dsn: NOTHING to scan — this check would report clean having read no file"); fails=$((fails + 1))
  elif grep -arhoE 'postgres(ql)?://[^[:space:]]+' "${scan[@]}" | grep -aq .; then
    # ⛔ A VERDICT, NEVER A SPECIMEN. What matched is not printed and not
    # counted: a proof-of-absence that quotes what it found publishes it.
    results+=("  FAIL output-carries-no-dsn: a connection string appears in this script's captured output"); fails=$((fails + 1))
  else
    results+=("  ok   output-carries-no-dsn (${#scan[@]} captured file(s) read)")
  fi

  printf '%s\n' "${results[@]}"
  if [ "$fails" -ne 0 ]; then
    echo "${GATE}: self-test FAILED (${fails} of ${checks} checks)" >&2
    return 1
  fi
  echo "${GATE}: self-test OK (${checks} checks)"
  return 0
}

case "$ACTION" in
  run)       do_run ;;
  self-test) self_test ;;
  "")        echo "${GATE}: nothing to do — pass --run (dry run), --run --commit, --self-test or --help." >&2; usage >&2; exit 2 ;;
esac
