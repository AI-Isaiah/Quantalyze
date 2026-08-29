#!/usr/bin/env bash
#
# VAC-07 local-stack lane — Supabase CLI stack lifecycle for app-level e2e specs.
#
# WHY THIS EXISTS (D-15, phase 164.3)
# -----------------------------------
# There are TWO disposable lanes in this phase, and conflating them breaks both:
#
#   1. the throwaway `initdb` cluster  -> SQL gates (VAC-01/02/06). Bare Postgres.
#   2. THIS lane, the Supabase CLI stack -> app-level spec (VAC-07).
#
# Lane 2 cannot be lane 1. `csv-finalize` and `withAuth` reach the database through
# supabase-js, i.e. PostgREST + GoTrue over HTTP, and the seed helper calls the GoTrue
# admin API. A bare Postgres cluster serves none of those, so it structurally cannot
# host this spec. Measured on the running stack 2026-08-29: PostgREST 200,
# GoTrue /health 200 (v2.188.1).
#
# SCHEMA SOURCE: baseline, NOT migration replay
# ---------------------------------------------
# The spike (scripts/local-stack/REPLAY-SPIKE.md) MEASURED the chain: 262 migrations,
# 69 fail, 193 apply. `supabase db reset` dies at 20260416125432 (CREATE INDEX
# CONCURRENTLY inside the CLI's libpq pipeline, SQLSTATE 25001), and removing the
# pipeline does not save it — >=6 independent root causes remain under psql, including
# 20260823120000_revoke_api_keys_insert.sql which REFUSES BY DESIGN to run against a
# database it cannot identify.
#
# So this lane loads a prebuilt baseline. It does NOT replay migrations, and it does
# NOT fall back to "apply the 193 that work" — a partially-applied schema that mostly
# works is precisely the vacuity this phase exists to eliminate. Missing baseline is a
# LOUD FAILURE, never a silent degrade.
#
# INVOCATIONS (CI pastes these verbatim — Pitfall 2: a wrapped run is a different run)
# -----------------------------------------------------------------------------------
#   scripts/local-stack/run.sh up            # start + load baseline + write env handoff
#   scripts/local-stack/run.sh up --no-schema # start + env handoff, NO schema (lifecycle only)
#   scripts/local-stack/run.sh down          # supabase stop --no-backup
#   scripts/local-stack/run.sh --self-test   # up --no-schema -> probe -> down -> assert 0 containers
#
# Diagnostic / assertion seams (no daemon, no stack, no side effects):
#   scripts/local-stack/run.sh --assert-teardown       # run ONLY the teardown assertion
#   scripts/local-stack/run.sh --print-baseline-path   # print the RESOLVED BASELINE_FILE
#
# ⚠️ R2-I03: these were dispatched but absent from this block, which is the
# block `usage()` prints — so `run.sh` with no argument documented neither.
#
# After `up`, Playwright consumes scripts/local-stack/.stack-env (gitignored).
#
# ⛔ LOCAL ONLY. This script never accepts a remote target. It asserts the API URL the
# stack reports is 127.0.0.1/localhost and refuses otherwise (T-164.3-11). Supabase TEST
# is shared with other people's CI; PROD is PROD.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LANE_DIR="${REPO_ROOT}/scripts/local-stack"
ENV_FILE="${LANE_DIR}/.stack-env"
BASELINE_FILE="${LANE_DIR}/baseline.sql"
CONFIG_TOML="${REPO_ROOT}/supabase/config.toml"

# Lane-owned Supabase workdir, generated per run and gitignored.
#
# WHY a derived workdir instead of `supabase start` at the repo root:
# `supabase start` applies supabase/migrations/ unconditionally — it has no
# skip flag (`supabase start --help`, CLI 2.84.2: only -x/--exclude and
# --ignore-health-check). Measured: starting at the repo root dies at
# 20260416125432 exactly as `db reset` does. This lane loads a baseline, so it
# must start WITHOUT applying the chain.
#
# The tracked supabase/config.toml is NEVER edited to achieve that. Editing it
# would be a live hazard: `[db.migrations] enabled = false` also makes
# `supabase db push` skip migrations, and that file governs PRODUCTION deploys
# (.github/workflows/supabase-migrate.yml). Instead the config is DERIVED each
# run into a throwaway workdir with migrations disabled and no migrations
# directory, so the lane cannot drift from the real config and cannot corrupt it.
STACK_DIR="${LANE_DIR}/.stack"
STACK_CONFIG="${STACK_DIR}/supabase/config.toml"

cd "$REPO_ROOT"

PROJECT_ID="$(sed -n 's/^project_id = "\(.*\)"/\1/p' "$CONFIG_TOML" | head -1)"
if [ -z "$PROJECT_ID" ]; then
  echo "FATAL: could not read project_id from ${CONFIG_TOML}" >&2
  exit 1
fi

log() { printf '[local-stack] %s\n' "$*"; }

# `supabase` always invoked against the derived lane workdir — never the repo root,
# never a remote. Written once here so every call site is identical (Pitfall 2).
sb() { supabase --workdir "$STACK_DIR" "$@"; }

# Derive the lane config from the tracked one, flipping [db.migrations].enabled
# to false. Section-aware: `enabled` appears in ~20 blocks, so a blind
# s/enabled = true/false/ would disable auth, storage and the API too.
generate_stack_config() {
  mkdir -p "${STACK_DIR}/supabase"
  awk '
    /^\[/            { in_mig = ($0 == "[db.migrations]") }
    in_mig && /^enabled[[:space:]]*=/ { print "enabled = false"; next }
    { print }
  ' "$CONFIG_TOML" >"$STACK_CONFIG"

  # Prove the derivation did what it claims, rather than assuming sed/awk worked.
  if ! awk '/^\[/ { in_mig = ($0 == "[db.migrations]") }
            in_mig && /^enabled[[:space:]]*=[[:space:]]*false/ { found = 1 }
            END { exit(found ? 0 : 1) }' "$STACK_CONFIG"; then
    echo "FATAL: derived config did not disable [db.migrations]. Refusing to start," >&2
    echo "       because the chain does not replay and a partial apply is worse than none." >&2
    exit 1
  fi
  # The lane workdir must have NO migrations dir — belt and braces.
  rm -rf "${STACK_DIR}/supabase/migrations"
  log "derived lane config: ${STACK_CONFIG} ([db.migrations] disabled)"
}

# --- teardown -----------------------------------------------------------------
# Registered BEFORE `supabase start` so a failed or interrupted start still stops the
# stack (D-04's lesson, applied to Docker; Pitfall 5: orphaned stacks exhaust the disk).
#
# On SUCCESS of `up` the stack must stay running — that is the whole point of `up` — so
# teardown fires only on a non-zero exit, unless a caller sets LANE_FORCE_TEARDOWN=1.
# Exit status is preserved either way.
LANE_FORCE_TEARDOWN="${LANE_FORCE_TEARDOWN:-0}"
TEARDOWN_ARMED=0

teardown() {
  local rc=$?
  if [ "$TEARDOWN_ARMED" = "1" ] && { [ "$rc" -ne 0 ] || [ "$LANE_FORCE_TEARDOWN" = "1" ]; }; then
    log "tearing down (exit=${rc})"
    sb stop --no-backup >/dev/null 2>&1 || true
    # Drop the env handoff too. An interrupt AFTER the handoff was written (e.g.
    # during baseline load) would otherwise leave a file advertising a stack that
    # no longer exists, and the next Playwright run would trust it.
    rm -f "$ENV_FILE"
  fi
  exit "$rc"
}

arm_teardown() {
  TEARDOWN_ARMED=1
  trap teardown EXIT
  # INT/TERM route THROUGH the EXIT trap by exiting, so there is one teardown path.
  trap 'exit 130' INT
  trap 'exit 143' TERM
}

# --- local-target assertion ---------------------------------------------------
assert_local() {
  local api_url="$1"
  case "$api_url" in
    http://127.0.0.1:*|http://localhost:*) ;;
    *)
      echo "FATAL: stack reported a non-local API URL. Refusing to continue." >&2
      echo "       This lane is local-only; TEST is shared and PROD is PROD." >&2
      exit 1
      ;;
  esac
}

# --- env handoff --------------------------------------------------------------
write_env_handoff() {
  local tmp
  # `mktemp` creates the file at 0600 itself, and the key material is written
  # into that already-restricted file — so it is never world-readable, not
  # even briefly.
  #
  # IN-03: a `umask 077` used to sit here with a comment claiming it was what
  # created the file restrictively. It was not: `mktemp` had already created
  # the file on the line above, and `umask` affects neither an existing file's
  # mode nor the `>` redirect below. The real protection is `mktemp` plus the
  # `chmod 600` after the `mv`. The stray umask then persisted for the rest of
  # the process. A comment crediting the wrong mechanism is how a protection
  # gets removed later by someone who reads it and moves the wrong line.
  tmp="$(mktemp)"
  sb status -o env >"$tmp"

  local api_url
  api_url="$(sed -n 's/^API_URL="\{0,1\}\([^"]*\)"\{0,1\}$/\1/p' "$tmp" | head -1)"
  if [ -z "$api_url" ]; then
    rm -f "$tmp"
    echo "FATAL: could not read API_URL from 'supabase status -o env'" >&2
    exit 1
  fi
  assert_local "$api_url"

  mv "$tmp" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  log "env handoff written: ${ENV_FILE} (gitignored, mode 600)"
}

# --- schema -------------------------------------------------------------------
load_baseline() {
  if [ ! -s "$BASELINE_FILE" ]; then
    cat >&2 <<EOF
FATAL: no schema baseline at ${BASELINE_FILE}

This lane loads a baseline because the migration chain does NOT replay:
262 migrations, 69 fail. See scripts/local-stack/REPLAY-SPIKE.md for the
measurement and the exact 'supabase db dump' command a human must run.

Refusing to continue. This lane does not replay the 193 migrations that
happen to work — a partially-applied schema is a silently-wrong baseline.
EOF
    exit 1
  fi

  local db_url
  db_url="$(sed -n 's/^DB_URL="\{0,1\}\([^"]*\)"\{0,1\}$/\1/p' "$ENV_FILE" | head -1)"
  case "$db_url" in
    *@127.0.0.1:*|*@localhost:*) ;;
    *) echo "FATAL: refusing to load baseline into a non-local database." >&2; exit 1 ;;
  esac

  local psql
  psql="$(resolve_psql)"
  if [ -z "$psql" ]; then
    echo "FATAL: psql not found on PATH or at the homebrew postgresql@16 keg" >&2
    exit 1
  fi

  log "loading baseline into local database"
  "$psql" "$db_url" -v ON_ERROR_STOP=1 -q -f "$BASELINE_FILE"
  log "baseline loaded"
}

# Prints the psql path, or nothing. Never exits — it runs in a command
# substitution, where `exit` would only kill the subshell and be swallowed.
resolve_psql() {
  if command -v psql >/dev/null 2>&1; then
    command -v psql
  elif [ -x /opt/homebrew/opt/postgresql@16/bin/psql ]; then
    echo /opt/homebrew/opt/postgresql@16/bin/psql
  fi
}

# --- commands -----------------------------------------------------------------
cmd_up() {
  local with_schema=1
  if [ "${1:-}" = "--no-schema" ]; then
    with_schema=0
  fi

  generate_stack_config
  arm_teardown
  log "starting supabase local stack (project_id=${PROJECT_ID})"
  sb start
  write_env_handoff

  if [ "$with_schema" = "1" ]; then
    load_baseline
  else
    log "NOTE: --no-schema — the app schema was NOT loaded."
    log "NOTE: this stack can serve protocol probes but CANNOT run app specs."
  fi
  log "up complete"
}

cmd_down() {
  log "stopping supabase local stack"
  # `down` must work even when invoked standalone (no preceding `up` in this
  # process), so the workdir has to exist before the CLI is asked to use it.
  [ -f "$STACK_CONFIG" ] || generate_stack_config
  sb stop --no-backup
  rm -f "$ENV_FILE"
  log "down complete"
}

# `docker` is reached through a seam so the teardown assertion below can be
# driven red without a Docker daemon (see --assert-teardown).
DOCKER_BIN="${DOCKER_BIN:-docker}"

running_project_containers() {
  "$DOCKER_BIN" ps --filter "name=_${PROJECT_ID}\$" --format '{{.Names}}'
}

# ── The teardown assertion, on its own so it can be exercised in isolation ───
#
# ⛔ WR-05. This was written as
#
#     leftover="$(running_project_containers || true)"
#     if [ -z "$leftover" ]; then count=0; else count=…; fi
#
# and the `|| true` collapsed EVERY `docker ps` failure — daemon stopped,
# socket permission denied, docker not on PATH — into an empty string, which
# became count=0, which printed "surviving <id> containers -> 0" and reached
# SELF-TEST PASSED. "Could not count" and "counted zero" shared a code path
# inside the one assertion whose entire purpose is proving the D-04 orphan
# class is closed. Exact input: stop the Docker daemon after `cmd_down` returns
# and before this ran.
#
# Unmeasured is not zero.
assert_no_surviving_containers() {
  local leftover count rc=0
  leftover="$(running_project_containers)" || rc=$?
  if [ "$rc" -ne 0 ]; then
    echo "SELF-TEST FAILED: MEASURE_FAIL — '${DOCKER_BIN} ps' exited ${rc}, so the teardown assertion could not be evaluated." >&2
    echo "                  This is the one control that proves nothing survives; it does not get to pass by not looking." >&2
    return 1
  fi
  if [ -z "$leftover" ]; then
    count=0
  else
    count="$(printf '%s\n' "$leftover" | grep -c .)"
  fi
  log "SELF-TEST: surviving ${PROJECT_ID} containers -> ${count} (measured; docker ps exited 0)"
  if [ "$count" != "0" ]; then
    echo "SELF-TEST FAILED: ${count} container(s) survived teardown:" >&2
    printf '%s\n' "$leftover" >&2
    return 1
  fi
  return 0
}

cmd_self_test() {
  log "SELF-TEST: lifecycle + teardown"
  log "SELF-TEST: scope is start/probe/stop. Schema load is NOT covered here —"
  log "SELF-TEST: it is blocked on the baseline (see REPLAY-SPIKE.md). A green"
  log "SELF-TEST: self-test does NOT mean the lane can run app specs yet."

  # Force teardown even on success: the self-test must leave nothing behind.
  LANE_FORCE_TEARDOWN=1
  cmd_up --no-schema

  # shellcheck disable=SC1090
  local api_url anon_key
  api_url="$(sed -n 's/^API_URL="\{0,1\}\([^"]*\)"\{0,1\}$/\1/p' "$ENV_FILE" | head -1)"
  anon_key="$(sed -n 's/^ANON_KEY="\{0,1\}\([^"]*\)"\{0,1\}$/\1/p' "$ENV_FILE" | head -1)"
  assert_local "$api_url"

  local rest auth
  rest="$(curl -s -o /dev/null -w '%{http_code}' \
    -H "apikey: ${anon_key}" -H "Authorization: Bearer ${anon_key}" \
    "${api_url}/rest/v1/")"
  log "SELF-TEST: PostgREST /rest/v1/ -> ${rest}"
  if [ "$rest" != "200" ]; then
    echo "SELF-TEST FAILED: PostgREST did not answer 200 (got '${rest}')" >&2
    exit 1
  fi

  auth="$(curl -s -o /dev/null -w '%{http_code}' "${api_url}/auth/v1/health")"
  log "SELF-TEST: GoTrue /auth/v1/health -> ${auth}"
  if [ "$auth" != "200" ]; then
    echo "SELF-TEST FAILED: GoTrue health did not answer 200 (got '${auth}')" >&2
    exit 1
  fi

  # Disarm the failure-teardown and tear down explicitly, so the assertion below
  # measures the result of `down` rather than the result of the trap.
  LANE_FORCE_TEARDOWN=0
  TEARDOWN_ARMED=0
  cmd_down

  # The assertion that must be ABLE to fail: nothing of this project may survive.
  assert_no_surviving_containers || exit 1

  if [ -e "$ENV_FILE" ]; then
    echo "SELF-TEST FAILED: env handoff survived teardown: ${ENV_FILE}" >&2
    exit 1
  fi

  log "SELF-TEST PASSED (lifecycle + teardown; schema load not covered)"
}

usage() {
  # ⚠️ R2-I03: the range must stop at the last COMMENT line of the header. It
  # read '3,45p', and line 45 became `set -euo pipefail` when the INVOCATIONS
  # block grew — so the help text ended with a shell option. Derived rather
  # than hardcoded, so it cannot go stale again: print until the first line
  # that is not a comment and not blank.
  awk 'NR < 3 { next } /^[^#]/ && NF { exit } { print }' "${BASH_SOURCE[0]}"
}

case "${1:-}" in
  up)          shift; cmd_up "${1:-}" ;;
  down)        cmd_down ;;
  --self-test) cmd_self_test ;;
  # Runs ONLY the teardown assertion, against whatever `DOCKER_BIN` names.
  # Exists so the assertion's own red arms can be proven without a Docker
  # daemon and without starting a stack — a control nobody can drive red is
  # the thing this lane exists inside a phase about.
  --assert-teardown) assert_no_surviving_containers ;;
  # Prints the RESOLVED BASELINE_FILE and exits. Exists so a test can ASK the
  # lane which schema source it reads instead of pattern-matching the
  # assignment line — R2-W06: `BASELINE_FILE="${REPO_ROOT}/supabase/schema/${NAME}"`
  # and any other perfectly ordinary spelling reads as "unwired" to a
  # substring match, which would let a test enforce a now-false claim while
  # staying green.
  --print-baseline-path) printf '%s\n' "$BASELINE_FILE" ;;
  *)           usage; exit 2 ;;
esac
