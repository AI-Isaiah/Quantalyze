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
# SCHEMA SOURCE: baseline + the TAIL the dump does not carry, NEVER a replay from empty
# ------------------------------------------------------------------------------------
# The spike (scripts/local-stack/REPLAY-SPIKE.md) MEASURED the chain: 262 migrations,
# 69 fail, 193 apply. `supabase db reset` dies at 20260416125432 (CREATE INDEX
# CONCURRENTLY inside the CLI's libpq pipeline, SQLSTATE 25001), and removing the
# pipeline does not save it — >=6 independent root causes remain under psql, including
# 20260823120000_revoke_api_keys_insert.sql which REFUSES BY DESIGN to run against a
# database it cannot identify.
#
# So this lane loads a prebuilt baseline. It does NOT replay the chain from EMPTY, and
# it does NOT fall back to "apply the 193 that work" — a partially-applied schema that
# mostly works is precisely the vacuity this phase exists to eliminate. Missing
# baseline is a LOUD FAILURE, never a silent degrade.
#
# ⭐ DECISION F (Phase 164.4.2, founder 2026-09-23): on top of the dump, the lane
# REPLAYS — in filename order, each file AS AUTHORED — exactly the
# supabase/migrations/*.sql files the dump does not carry. WHICH files those are is
# read from supabase/schema/baseline-carried-migrations.txt, a committed marker bound
# to the dump's sha256, never inferred from commit dates. A migration newer than the
# dump is therefore the NORMAL case: it is replayed, NAMED on every boot (the zero
# case included), and ledgered in supabase_migrations.schema_migrations only after it
# applied. An undeterminable set, or a replayed migration that errors, is FATAL.
#
# ⭐ DECISION G (Phase 164.4.2, founder 2026-09-23): the dump is of `public` only, so
# it carries neither the `auth.users` trigger that creates a profile per new user nor
# any `cron.job` row — 8 corpus files failed on their absence. After the dump and its
# reference data, and BEFORE the D-F replay, the lane applies those objects EXTRACTED
# from the carried migrations (scripts/local-stack/nonpublic-objects.mjs), then a
# gate proves the lane holds exactly the declared set. Drift FAILS THE BOOT; it is
# never a warning. The dump was NOT widened and sql-tests did NOT move back to shared
# TEST — both were rejected (see the module's header).
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
#   scripts/local-stack/run.sh --print-workdir         # print the RESOLVED STACK_DIR
#   scripts/local-stack/run.sh --check-currency        # run the baseline CURRENCY gate
#                                                      # exactly as `up` does (--replay-set:
#                                                      # names the migrations it would replay);
#                                                      # exit = its verdict
#
# Environment seams (defaults = the repo paths; each resolved value is logged):
#   LANE_MIGRATIONS_DIR     the migrations directory the gate classifies and the replay applies
#   LANE_CARRIED_MARKER     the carried-migrations marker (baseline-carried-migrations.txt)
#   LANE_REFDATA_ALLOWLIST  the reference-data allowlist the gate filters for the extractor
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
BASELINE_FILE="${REPO_ROOT}/supabase/schema/baseline.sql"
# Three DECISION F seams (Phase 164.4.2 plan 06). The defaults are the repo paths;
# the overrides exist so the replay can be driven end to end — synthetic
# migrations newer than the dump — without touching supabase/migrations/.
# ONE directory serves the gate, the reference-data filter, the extractor and
# the replay, so none of them can classify one directory and apply another.
MIGRATIONS_DIR="${LANE_MIGRATIONS_DIR:-${REPO_ROOT}/supabase/migrations}"
CARRIED_MARKER="${LANE_CARRIED_MARKER:-${REPO_ROOT}/supabase/schema/baseline-carried-migrations.txt}"
REFDATA_ALLOWLIST="${LANE_REFDATA_ALLOWLIST:-${REPO_ROOT}/scripts/restore-test-refdata-allowlist.txt}"
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
# The currency gate's handover files (replay set, carried set, filtered
# reference-data allowlist). Inside the gitignored lane workdir, and emptied
# before every gate run, so a gate that refuses leaves NO file for a later
# step to trust.
REPLAY_HANDOFF_DIR="${STACK_DIR}/replay"
REPLAY_SET_FILE="${REPLAY_HANDOFF_DIR}/replay-set.txt"
CARRIED_SET_FILE="${REPLAY_HANDOFF_DIR}/carried-set.txt"
REFDATA_ALLOWLIST_FILTERED="${REPLAY_HANDOFF_DIR}/refdata-allowlist.filtered.txt"

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

# ── Baseline CURRENCY (Phase 164.4.2 plan 03) ─────────────────────────────────
#
# ⛔ WHY. The baseline is a DUMP, and a migration can land after it was taken.
# Loading a dump that is older than supabase/migrations/ boots a schema missing
# real migrations — and every spec on this lane then goes green against a
# catalogue that is not PROD's, with nothing in the green saying so. MEASURED
# at 164.4.2 CONTEXT Area A: two migrations sat after the dump while this lane
# and the live-DB lane were both green.
#
# `scripts/check-baseline-staleness.mjs` does NOT answer this — despite its
# name it checks INTEGRITY (sha256 vs BASELINE.md). CURRENCY has exactly one
# implementation, `scripts/check-baseline-currency.mjs`, shared with the
# restore script's `refuse_stale_baseline()`. This lane calls it rather than
# carrying a second copy of the comparison.
#
# ⭐ DECISION F (plan 06) — "refuse" became "bound and name". Plan 03 ran the
# gate's DEFAULT mode here, which REFUSES a dump older than the newest
# migration: correct as a detector, but it reddened every lane job on the next
# migration merge until the founder re-dumped PRODUCTION, and it left a PR
# unable to exercise its own migration on the lane at all. The lane now runs the
# gate's `--replay-set` mode, which reads the committed carried-migrations
# marker (bound to the dump's sha256), NAMES the migrations the dump does not
# carry, and hands them — plus the carried set and a reference-data allowlist
# with the replayed files' lines removed — to the steps below through files it
# writes ONLY when the set was determined. The DEFAULT mode is untouched: it is
# still the restore path's `refuse_stale_baseline()`.
#
# Every path is passed EXPLICITLY, so the lane and the gate cannot disagree
# about which marker, dump or directory was read. The marker comparison reads
# files on disk, so the shallow-clone vacuity the epoch comparison had (two
# identical commit times comparing equal) does not exist for this mode.
check_baseline_currency() {
  log "currency gate inputs: migrations=${MIGRATIONS_DIR} marker=${CARRIED_MARKER} refdata-allowlist=${REFDATA_ALLOWLIST}"
  rm -rf "$REPLAY_HANDOFF_DIR"
  mkdir -p "$REPLAY_HANDOFF_DIR"
  CARRIED_MARKER="$CARRIED_MARKER" \
  BASELINE_FILE="$BASELINE_FILE" \
  MIGRATIONS_DIR="$MIGRATIONS_DIR" \
  REPLAY_SET_FILE="$REPLAY_SET_FILE" \
  CARRIED_SET_FILE="$CARRIED_SET_FILE" \
  REFDATA_ALLOWLIST_IN="$REFDATA_ALLOWLIST" \
  REFDATA_ALLOWLIST_OUT="$REFDATA_ALLOWLIST_FILTERED" \
    node "${REPO_ROOT}/scripts/check-baseline-currency.mjs" --replay-set
}

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

  # ⛔ CURRENCY, before the first connection and before psql reads a byte of
  # the dump. Since DECISION F this determines the REPLAY SET rather than
  # refusing a newer migration — but an UNDETERMINABLE set is still a REFUSAL,
  # never a warning: a lane that cannot say what it is about to replay and
  # loads anyway is a gate that measures nothing.
  if ! check_baseline_currency; then
    echo "FATAL: refusing to load ${BASELINE_FILE} into the local database: the baseline currency gate above could not determine the replay set." >&2
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

  # ⛔ PROD's starting state for `public`, BEFORE psql reads a byte of the dump.
  # Without it every object the dump creates inherits the image's default ACLs
  # (ALL to anon/authenticated/service_role) and the lane's catalogue is WIDER than
  # PROD's (see reset_public_default_acls).
  reset_public_default_acls "$psql" "$db_url"

  # Name the file on the SUCCESS path too, not just in the FATAL above. Phase
  # 164.5 criterion 1 is "the lane boots from the COMMITTED baseline, proven by
  # running it" — and a log line reading only "baseline loaded" cannot tell a
  # reader WHICH baseline. An unnamed source is not evidence of a source.
  log "loading baseline into local database from ${BASELINE_FILE}"
  "$psql" "$db_url" -v ON_ERROR_STOP=1 -q -f "$BASELINE_FILE"
  log "baseline loaded from ${BASELINE_FILE}"

  # The reset's proof, for every object: the ACLs now equal what the dump declares.
  check_acl_fidelity "$psql" "$db_url"

  # Reference rows come from CARRIED migrations only (the gate removed the
  # replayed files' allowlist lines), and they predate every migration newer
  # than the dump — PRODUCTION's own chronological order — so they load first.
  load_reference_data "$psql" "$db_url"

  # ⭐ DECISION G — the non-public objects (auth.users trigger, cron.job rows),
  # extracted from the CARRIED migrations, and the gate that proves them.
  # AFTER reference data: the allowlist replays the teaser sentinel auth.users row
  # and then its sentinel profile (ON CONFLICT DO NOTHING). With the trigger already
  # in place, handle_new_user() would create that profile first, with different
  # values, and the allowlisted row would silently no-op. This order reproduces the
  # TEST restore's state, which is what the corpus was green against.
  # The GATE BEFORE the replay, for check_acl_fidelity's reason: a replayed
  # migration may legitimately change these objects, so the dump plus the carried
  # fold is the fixed point the gate can be exact about.
  load_nonpublic_objects "$psql" "$db_url"
  check_nonpublic_fidelity "$psql" "$db_url"

  replay_migrations "$psql" "$db_url"
}

# ── Default-ACL reset and ACL fidelity (Phase 164.4.2, plan 08 checkpoint RED) ─
#
# ⛔ WHY. MEASURED in CI run 35886515179: on this lane an authenticated NON-ADMIN
# could TRUNCATE public.system_settings, which PROD does not grant. The Supabase
# image creates `public` with default ACLs granting ALL on TABLES, SEQUENCES and
# FUNCTIONS to anon, authenticated and service_role (for the grantor roles postgres
# and supabase_admin). The dump sets its OWN default privileges LAST, after every
# CREATE, and its GRANT lines only ADD, so every object it created kept the image's
# ALL. PROD and the TEST restore path (`DROP SCHEMA public CASCADE`, which drops
# those rows) get exactly the dump's GRANTs. Every privilege and RLS gate that ran
# on this lane was measuring a wider catalogue than PROD's.
#
# WHY A RESET AND NOT DROP SCHEMA. The image's `public` is EMPTY apart from these
# rows (measured: 0 relations, 0 functions, 0 types), so removing them yields the
# restore path's starting state. Dropping and recreating the schema would ALSO
# change its owner (pg_database_owner) and its ACL (PUBLIC USAGE), which the dump
# does not recreate and PROD still has. The reset changes only what is wrong.
#
# The roles, object types and grantees are READ from pg_default_acl, not listed.
# It must run as the stack's superuser, because postgres may only alter its own
# defaults and supabase_admin also holds rows on `public`. That URL is the lane's
# own loopback DSN with the role swapped; a DSN that does not name `postgres` is
# refused rather than guessed at. A surviving row is FATAL.
reset_public_default_acls() {
  local psql="$1" db_url="$2" admin_url left
  admin_url="${db_url/#postgresql:\/\/postgres:/postgresql://supabase_admin:}"
  if [ "$admin_url" = "$db_url" ]; then
    echo "FATAL: the lane DSN does not start with postgresql://postgres:, so the superuser DSN the default-ACL reset needs cannot be derived. Refusing to load the dump over the image's default ACLs." >&2
    exit 1
  fi
  if ! "$psql" -X "$admin_url" -v ON_ERROR_STOP=1 -q -f "${LANE_DIR}/reset-public-default-acl.sql" </dev/null; then
    echo "FATAL: the default-ACL reset on schema public failed. Loading the dump now would give every object the image's ALL grants." >&2
    exit 1
  fi
  # Re-read by an INDEPENDENT connection (the loading role), not the reset's own claim.
  if ! left="$("$psql" -X "$db_url" -v ON_ERROR_STOP=1 -q -At -c "SELECT count(*) FROM pg_default_acl WHERE defaclnamespace = 'public'::regnamespace;" </dev/null)"; then
    echo "FATAL: could not count the default ACLs left on schema public after the reset. Unmeasured is not zero." >&2
    exit 1
  fi
  if [ "$left" != "0" ]; then
    echo "FATAL: ${left} default-ACL row(s) on schema public survived the reset." >&2
    exit 1
  fi
  log "default ACLs on schema public reset: 0 remain before the dump loads"
}

# Every public table, view, sequence and function's ACL, and the schema's default
# ACLs, compared with what the dump declares (scripts/local-stack/acl-fidelity.mjs).
# Runs right after the dump and BEFORE reference data and the replay: a replayed
# migration may legitimately GRANT or REVOKE, exactly as it would on PROD, so the
# dump alone is the fixed point this gate can be exact about. DRIFT is FATAL.
check_acl_fidelity() {
  local psql="$1" db_url="$2" rows
  rows="${REPLAY_HANDOFF_DIR}/acl-catalogue.txt"
  if ! "$psql" -X "$db_url" -v ON_ERROR_STOP=1 -q -At -F '|' -f "${LANE_DIR}/acl-fidelity-catalogue.sql" >"$rows" </dev/null; then
    echo "FATAL: could not read the lane's ACL catalogue for the fidelity gate." >&2
    exit 1
  fi
  if ! node "${LANE_DIR}/acl-fidelity.mjs" --dump "$BASELINE_FILE" --catalogue "$rows"; then
    echo "FATAL: the lane's public ACLs are not the ones ${BASELINE_FILE} declares (acl-fidelity above). Privilege and RLS gates on this lane would measure a catalogue that is not PROD's." >&2
    exit 1
  fi
}

# ── Non-public objects (DECISION G, plan 11) ─────────────────────────────────
#
# ⛔ WHY. The dump is of `public` only. MEASURED on the lane after plan 08's ACL fix:
# 0 non-internal triggers on auth.users and 0 rows in cron.job, and 8 of 76 corpus
# files failing on exactly those absences. scripts/local-stack/nonpublic-objects.mjs
# folds them out of the CARRIED migrations (the gate's $CARRIED_SET_FILE, read from
# the SAME $MIGRATIONS_DIR the replay applies from), so a replayed migration's own
# trigger or cron call runs once, natively, in replay_migrations — never twice.
#
# The auth.users trigger is created through the stack SUPERUSER DSN, derived exactly
# as reset_public_default_acls derives it (the lane's loopback DSN with the role
# swapped; a DSN not starting with the postgres role is refused). auth.users belongs
# to the auth service role, and a trigger has no owner, so the object is identical
# whoever creates it.
load_nonpublic_objects() {
  local psql="$1" db_url="$2" admin_url census n_trig
  admin_url="${db_url/#postgresql:\/\/postgres:/postgresql://supabase_admin:}"
  if [ "$admin_url" = "$db_url" ]; then
    echo "FATAL: the lane DSN does not start with postgresql://postgres:, so the superuser DSN the auth.users trigger needs cannot be derived. Refusing to boot a lane without it." >&2
    exit 1
  fi
  if ! census="$(node "${LANE_DIR}/nonpublic-objects.mjs" --emit --migrations "$MIGRATIONS_DIR" --carried "$CARRIED_SET_FILE" --out-dir "$REPLAY_HANDOFF_DIR")"; then
    printf '%s\n' "$census"
    echo "FATAL: scripts/local-stack/nonpublic-objects.mjs could not extract the non-public objects from the carried migrations (above). The lane would lack objects PROD carries." >&2
    exit 1
  fi
  printf '%s\n' "$census"
  n_trig="$(printf '%s\n' "$census" | sed -n 's/^nonpublic-extract: .*auth-triggers=\([0-9][0-9]*\).*$/\1/p')"
  if [ -z "$n_trig" ]; then
    echo "FATAL: the extractor's census line carries no auth-triggers count; refusing to apply what it cannot count." >&2
    exit 1
  fi
  if ! "$psql" -X "$admin_url" -v ON_ERROR_STOP=1 -q -1 -f "${REPLAY_HANDOFF_DIR}/nonpublic-auth-triggers.sql" </dev/null; then
    echo "FATAL: applying the extracted auth.users trigger(s) through the superuser DSN failed." >&2
    exit 1
  fi
  log "nonpublic-load: ${n_trig} auth.users trigger(s) applied via the superuser role supabase_admin"
}

# The gate: the lane's auth.users triggers compared with the set the carried
# migrations declare (re-derived by the module, never read back from the SQL it
# emitted). Read through the SUPERUSER DSN, which the catalogue's meta row must
# confirm. DRIFT or an unreadable catalogue is FATAL.
check_nonpublic_fidelity() {
  local psql="$1" db_url="$2" admin_url rows
  admin_url="${db_url/#postgresql:\/\/postgres:/postgresql://supabase_admin:}"
  if [ "$admin_url" = "$db_url" ]; then
    echo "FATAL: the lane DSN does not start with postgresql://postgres:, so the superuser DSN the non-public fidelity gate reads through cannot be derived." >&2
    exit 1
  fi
  rows="${REPLAY_HANDOFF_DIR}/nonpublic-catalogue.txt"
  if ! "$psql" -X "$admin_url" -v ON_ERROR_STOP=1 -q -At -F '|' -f "${LANE_DIR}/nonpublic-catalogue.sql" >"$rows" </dev/null; then
    echo "FATAL: could not read the lane's non-public catalogue for the fidelity gate." >&2
    exit 1
  fi
  if ! node "${LANE_DIR}/nonpublic-objects.mjs" --check --migrations "$MIGRATIONS_DIR" --carried "$CARRIED_SET_FILE" --catalogue "$rows"; then
    echo "FATAL: the lane's non-public objects are not the set the carried migrations declare (nonpublic-fidelity above). Corpus files that read them would measure a lane that is not PROD's." >&2
    exit 1
  fi
}

# ── Replay of the migrations the dump does not carry (DECISION F, plan 06) ────
#
# HOW A REPLAYED FILE IS APPLIED — and why there is NO wrapper. Each file runs AS
# AUTHORED, one psql call per file in psql's default autocommit mode, so the
# file's OWN transaction control governs it. MEASURED at planning time: 182
# committed migrations carry a top-level BEGIN;/COMMIT; pair and 4 carry a
# top-level CREATE INDEX CONCURRENTLY, which cannot run inside a transaction
# block. A lane-added whole-file transaction would (a) be ended early by the
# file's own COMMIT;, so it never made the ledger row atomic with the file, and
# (b) turn every CONCURRENTLY migration into a FATAL boot. ⛔ Do not re-add one
# "for safety" — the tracer's CONCURRENTLY arm was observed RED with it.
#
# WHAT IS CLAIMED INSTEAD: a file's ledger row is written by a SEPARATE psql
# call only AFTER that file's psql exited 0, so the ledger never names an
# unapplied migration. NO migration+ledger atomicity is claimed. A failure in
# either call is FATAL, and the EXIT trap tears the ephemeral stack down, so a
# partially applied file is never tested against.
#
# THE LEDGER. `supabase_migrations.schema_migrations` in the Supabase CLI's own
# shape (the same DDL scripts/restore-test-from-baseline.sh uses). CARRIED
# migrations get a row too, whose `statements` says the dump carried them and the
# lane did NOT execute them — two corpus files read this table as an applied-ness
# oracle and RAISE when it is absent. MEASURED before this step existed
# (2026-09-23): the lane had no such table at all. Plain INSERTs, never ON
# CONFLICT: a pre-existing row is a defect to see, not one to skip.
replay_migrations() {
  local psql="$1" db_url="$2" sha16 base version name sql n=0 total
  if [ ! -f "$REPLAY_SET_FILE" ] || [ ! -f "$CARRIED_SET_FILE" ]; then
    echo "FATAL: the currency gate handed over no replay/carried set (${REPLAY_HANDOFF_DIR}); refusing to guess." >&2
    exit 1
  fi
  sha16="$(node -e 'process.stdout.write(require("crypto").createHash("sha256").update(require("fs").readFileSync(process.argv[1])).digest("hex").slice(0,16))' "$BASELINE_FILE")"

  sql="${REPLAY_HANDOFF_DIR}/ledger-carried.sql"
  {
    echo "CREATE SCHEMA IF NOT EXISTS supabase_migrations;"
    echo "CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (version text NOT NULL PRIMARY KEY, statements text[], name text);"
  } >"$sql"
  while IFS= read -r base <&3; do
    if ! [[ "$base" =~ ^[0-9]+_[a-z0-9_]+\.sql$ ]]; then
      echo "FATAL: carried set holds a line that is not a strict migration basename: '${base}'" >&2
      exit 1
    fi
    version="${base%%_*}"
    name="${base#*_}"
    name="${name%.sql}"
    printf "INSERT INTO supabase_migrations.schema_migrations (version, name, statements) VALUES ('%s', '%s', ARRAY['carried by the committed dump supabase/schema/baseline.sql sha256 %s; NOT executed on the local-stack lane']);\n" \
      "$version" "$name" "$sha16" >>"$sql"
  done 3<"$CARRIED_SET_FILE"
  if ! "$psql" -X "$db_url" -v ON_ERROR_STOP=1 -q -f "$sql" </dev/null; then
    echo "FATAL: could not write the carried migrations' ledger rows into supabase_migrations.schema_migrations." >&2
    exit 1
  fi
  log "ledger: $(grep -c . "$CARRIED_SET_FILE" || true) carried migration row(s) written (dump sha256 ${sha16}…)"

  total="$(grep -c . "$REPLAY_SET_FILE" || true)"
  while IFS= read -r base <&3; do
    if ! [[ "$base" =~ ^[0-9]+_[a-z0-9_]+\.sql$ ]]; then
      echo "FATAL: replay set holds a line that is not a strict migration basename: '${base}'" >&2
      exit 1
    fi
    version="${base%%_*}"
    name="${base#*_}"
    name="${name%.sql}"
    # (1) the file, as authored — no wrapper (see above).
    if ! "$psql" -X "$db_url" -v ON_ERROR_STOP=1 -q -f "${MIGRATIONS_DIR}/${base}" </dev/null; then
      echo "FATAL: replayed migration ${base} failed" >&2
      exit 1
    fi
    # (2) ONLY after (1) exited 0: its ledger row, in a separate call.
    if ! "$psql" -X "$db_url" -v ON_ERROR_STOP=1 -q -c \
      "INSERT INTO supabase_migrations.schema_migrations (version, name, statements) VALUES ('${version}', '${name}', ARRAY['replayed on the local-stack lane from supabase/migrations/${base}']);" </dev/null; then
      echo "FATAL: replayed migration ${base} failed (it applied, but its ledger row could not be written)" >&2
      exit 1
    fi
    log "replayed ${base} (ledger row written)"
    n=$((n + 1))
  done 3<"$REPLAY_SET_FILE"
  if [ "$n" != "$total" ]; then
    echo "FATAL: replayed ${n} migration(s) but the handed-over set names ${total}." >&2
    exit 1
  fi
  log "replay complete: ${n} migration(s) applied on top of the dump"
}

# ── Reference-data replay (Phase 164.9 plan 08) ───────────────────────────────
#
# WHY THIS EXISTS, and it was MEASURED rather than anticipated. The baseline is
# SCHEMA-ONLY — zero data statements, by design — so every table comes back
# EMPTY, INCLUDING the small reference tables that other tables carry FOREIGN
# KEYS to. `compute_jobs.kind` REFERENCES `compute_job_kinds(name)`, and with
# that table empty EVERY insert of a compute job fails 23503. Measured on the
# first real run of the live-DB lane: 29 of 50 failures were that one constraint.
#
# ⛔ THIS IS NOT A TEST FIXTURE AND MUST NOT BECOME ONE. The rows come from
# `scripts/extract-reference-inserts.mjs`, which slices the ORIGINAL BYTES of
# allowlisted migration statements — the same generator, the same
# `scripts/restore-test-refdata-allowlist.txt`, and the same audited mechanism
# the shared-project restore uses. Hand-written seed rows here would be a second,
# unaudited source of truth for what the reference tables contain, and it would
# drift from the migrations silently.
#
# ⛔ AND A GENERATOR FAILURE IS FATAL, never a warning. A lane that booted with
# an empty reference table would not skip — it would fail 29 specs with a foreign
# key error that says nothing about the real cause, which is how a whole class of
# specs gets written off as "flaky".
#
# ⭐ DECISION F (plan 06): the extractor reads the gate-written FILTERED allowlist
# — the lines naming REPLAYED migrations removed — and the SAME migrations
# directory the gate classified and the replay applies from. A replayed
# migration's own statements then run exactly once, natively, in the replay,
# after the tables they need exist; extracting them here as well would run a
# plain VALUES insert twice (or before its table exists). Without `--migrations`
# the extractor would resolve entries against its repo default and refuse every
# entry naming a file only an overridden lane directory holds.
load_reference_data() {
  local psql="$1" db_url="$2" tmp
  tmp="$(mktemp)"
  if ! node "${REPO_ROOT}/scripts/extract-reference-inserts.mjs" --allowlist "$REFDATA_ALLOWLIST_FILTERED" --migrations "$MIGRATIONS_DIR" >"$tmp"; then
    rm -f "$tmp"
    echo "FATAL: scripts/extract-reference-inserts.mjs failed. The lane's reference" >&2
    echo "       tables would be EMPTY and every FK into them would raise 23503." >&2
    exit 1
  fi
  if [ ! -s "$tmp" ]; then
    rm -f "$tmp"
    echo "FATAL: the reference-data generator emitted NOTHING. 'measured zero' and" >&2
    echo "       'could not measure' are different answers; refusing to continue." >&2
    exit 1
  fi
  "$psql" "$db_url" -v ON_ERROR_STOP=1 -q -f "$tmp"
  rm -f "$tmp"
  log "reference data replayed from the allowlisted migration statements"
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
  # ⛔ REJECT an unrecognised argument rather than treating it as "load the schema".
  # `up --no-shema` (typo) used to load the baseline silently — a safe DIRECTION, but
  # the same class of lie the other gates this phase added refuse: a typo'd flag that
  # quietly ran a different gate than the caller asked for.
  # [IN-A] ⛔ ROOT CAUSE, not the symptom. The dispatcher used to call
  # `cmd_up "${1:-}"`, which DROPPED $2 and beyond before this function could see
  # them — so `up --no-schema --wat` ran the --no-schema path and silently ignored
  # `--wat`. MEASURED 2026-09-08: a guard placed inside cmd_up could never fire,
  # because `$#` was always 1; the stack booted for real. The dispatcher now
  # forwards "$@" and the arity check lives here, ahead of everything that boots.
  if [ "$#" -gt 1 ]; then
    echo "FATAL: 'up' takes at most one argument; got $#: $*" >&2
    exit 1
  fi
  case "${1:-}" in
    "") ;;
    --no-schema) with_schema=0 ;;
    *)
      echo "FATAL: unknown argument to 'up': '$1'. Only --no-schema is accepted." >&2
      exit 1
      ;;
  esac


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
  # ⚠️ The reason clause here used to read "it is blocked on the baseline (see
  # REPLAY-SPIKE.md)". Phase 164.5 wired the lane to the committed baseline, so
  # that sentence became FALSE while still printing on every run. The SCOPE
  # statement is unchanged and still true — this path runs `up --no-schema`, so
  # it never exercises load_baseline() — but the reason is now "out of scope",
  # not "blocked".
  log "SELF-TEST: scope is start/probe/stop. Schema load is NOT covered here —"
  log "SELF-TEST: this path runs 'up --no-schema', so load_baseline() never runs."
  log "SELF-TEST: a green self-test does NOT mean the lane can run app specs;"
  log "SELF-TEST: only 'run.sh up' (WITH schema) proves that."

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
  up)          shift; cmd_up "$@" ;;
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
  # Prints the RESOLVED lane WORKDIR and exits. Same argument as
  # `--print-baseline-path` above, applied to the other half of the lane's
  # safety story: `sb()` passes this directory to `supabase --workdir`, and the
  # whole reason it is DERIVED (see STACK_DIR's comment) is that starting at the
  # repo root would apply supabase/migrations/ unconditionally against a
  # directory that ALSO governs production deploys.
  #
  # ⭐ Phase 164.9 plan 08 — `vitest.livedb.config.ts` ASKS the lane where it
  # would start, and REFUSES to boot when the answer is this repository's own
  # `supabase/` directory. Asking beats pattern-matching the assignment line:
  # any ordinary re-spelling of STACK_DIR reads as "unwired" to a substring
  # match, which would let the check stay green while measuring nothing.
  --print-workdir) printf '%s\n' "$STACK_DIR" ;;
  # Runs the SAME `check_baseline_currency` call `load_baseline()` makes, and
  # exits with its status. Same argument as the two print seams above: a test
  # (or a CI step) can ASK the lane whether it would refuse, instead of
  # pattern-matching a line that any ordinary re-spelling would read as
  # "unwired". No daemon, no stack — it reads the marker, the dump's sha256 and
  # the migrations directory, and names the replay set (DECISION F).
  --check-currency) check_baseline_currency ;;
  *)           usage; exit 2 ;;
esac
