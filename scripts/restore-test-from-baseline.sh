#!/usr/bin/env bash
# Restore the SHARED TEST database's `public` schema from the reviewed PRODUCTION
# dump, and seed its migration ledger to match PROD's — so that `supabase db push`
# can run natively against TEST afterwards.
#
# WHY THIS EXISTS (Phase 164.8, CONTEXT.md § SUPERSEDING DECISION 2026-09-08).
# TEST's ledger holds 243 rows, ~40 of which were written with the APPLY timestamp
# instead of the FILENAME timestamp. `supabase db push` compares `version` ONLY, so
# those 40 are `ErrMissingLocal` hard errors raised BEFORE `--include-all` is
# consulted — the forward-only plan was not implementable by the CLI at all. The
# founder's decision is to REPLACE the schema and the ledger rather than repair
# them, from `supabase/schema/baseline.sql` at the sha `BASELINE.md` records.
#
# ⛔ THIS SCRIPT IS DESTRUCTIVE. It runs `DROP SCHEMA public CASCADE` against the
# database `RESTORE_DB_URL` names. TEST is SHARED with other people's CI. Every
# guard below exists because a wrong answer here is unrecoverable, and the guards
# are ORDERED: every refusal fires BEFORE the first write.
#
# ⛔ IT IS NOT A STANDALONE COMMAND. `--run` refuses unless the shared-TEST
# advisory mutex (61616158) is already held by another session — it runs INSIDE
# the workflow's Acquire step, never alone.
#
# ============================================================================
# CLI CONTRACT — pasted VERBATIM into CI. Local and CI must be byte-identical in
# mode; an A/B that changes invocation mode is not an A/B (the sql-gate-lint idiom).
# ============================================================================
#
#   bash scripts/restore-test-from-baseline.sh --self-test
#   bash scripts/restore-test-from-baseline.sh --run --mode preflight
#   bash scripts/restore-test-from-baseline.sh --run --mode restore
#
#   bash scripts/restore-test-from-baseline.sh --help   # print this header block
#
# `--mode preflight` executes the ENTIRE transaction and then ROLLBACKs, and then
# proves the rollback by re-running the census and comparing it byte-for-byte with
# the census taken before the transaction. `--mode restore` executes the same
# stream and COMMITs. The two paths differ in exactly one token — the terminator —
# so a preflight that passes is evidence about the restore that follows it.
#
# ⛔ The transaction is assembled by this script and fed to ONE psql session as one
# file beginning with `BEGIN;`. psql's own whole-file transaction flag is NEVER
# used: it appends an unconditional COMMIT, which would make `--mode preflight`
# write. The MODE picks the terminator; nothing else may.
#
# ── ENV SEAMS (defaults are the real path) ──────────────────────────────────
#   RESTORE_DB_URL            SESSION-mode DSN of the database to restore. Absent
#                             => `::error::` naming it and exit 1. NEVER a skip,
#                             and NEVER echoed (public Actions log).
#   BASELINE_FILE             default supabase/schema/baseline.sql
#   BASELINE_DOC              default supabase/schema/BASELINE.md
#   MIGRATIONS_DIR            default supabase/migrations
#   NORMALIZER                default scripts/sql-body-normalize.mjs (the ONE shared
#                             normalizer; test-ledger-drift-check.sh:123 spells the
#                             same seam with the same default)
#   FRESHNESS_TS_CMD          default `git log -1 --format=%ct --`; invoked as
#                             `$FRESHNESS_TS_CMD <path>` and must print an epoch
#   RESTORE_EXPECT_MARKER_RE  default: `test` as a whole word, case-insensitive
#   RESTORE_REFUSE_MARKER_RE  default: `prod`, case-insensitive
#   RESTORE_OUT_DIR           where the census / survivors / transaction files are
#                             written; default a mktemp dir removed on exit. Plan 03
#                             points this at the workflow's backup artifact so the
#                             pre-drop census survives an aborted transaction.
#   RESTORE_REQUIRE_MUTEX     default 1
#   PGBIN                     (self-test only) server binaries for the throwaway lane
#
# psql's STDERR IS printed: it names SQL objects, not credentials. The DSN is not.
#
# ── WHAT --self-test PROVES, AND WHAT IT DOES NOT ───────────────────────────
# It boots a THROWAWAY PostgreSQL cluster the `scripts/pg-lane/run.sh` way and runs
# the REAL `--run` dispatch against it. It never touches TEST or PROD. The pg-lane
# has no `pg_net` and no `supabase_vault`, so the REAL dump cannot replay on it —
# the self-test uses a baseline-SHAPED fixture. Whether the real dump applies to
# hosted TEST is what `--mode preflight` measures, transactionally, against TEST
# itself before anyone decides.
#
# ⚠️ THIS IS THE SKELETON (Phase 164.8 plan 01): the two GREEN paths only. Plan 02
# adds the RED arms, pins EXPECTED_ARMS at its final value and adds the vitest pin.
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
GATE="restore-test-from-baseline"
FIXTURES="$SCRIPT_DIR/restore-test-from-baseline-fixtures"

# The shared-TEST advisory mutex key. Same integer ci.yml, analytics-deploy-verify.yml,
# main-ci-cancelled-watcher.yml and mutex-probe.yml take.
MUTEX_KEY=61616158

fail() {
  echo "::error::${GATE}: $*" >&2
  exit 1
}
note() { echo "${GATE}: $*"; }

BASELINE_FILE="${BASELINE_FILE:-supabase/schema/baseline.sql}"
BASELINE_DOC="${BASELINE_DOC:-supabase/schema/BASELINE.md}"
MIGRATIONS_DIR="${MIGRATIONS_DIR:-supabase/migrations}"
NORMALIZER="${NORMALIZER:-scripts/sql-body-normalize.mjs}"
FRESHNESS_TS_CMD="${FRESHNESS_TS_CMD:-git log -1 --format=%ct --}"
# Whole-word `test`, case-insensitive. A marker reading "quantalyze-testing-sandbox"
# is NOT a whole-word match and is refused: the marker is the only thing standing
# between this script and production (CLAUDE.md § Which database am I on?).
RESTORE_EXPECT_MARKER_RE="${RESTORE_EXPECT_MARKER_RE:-(^|[^[:alnum:]_])test([^[:alnum:]_]|$)}"
RESTORE_REFUSE_MARKER_RE="${RESTORE_REFUSE_MARKER_RE:-prod}"
RESTORE_REQUIRE_MUTEX="${RESTORE_REQUIRE_MUTEX:-1}"

OWNED_OUT_DIR=""
cleanup_out_dir() {
  status=$?
  if [ -n "$OWNED_OUT_DIR" ] && [ -d "$OWNED_OUT_DIR" ]; then rm -rf "$OWNED_OUT_DIR"; fi
  exit "$status"
}

# psql against the target. -X so no ~/.psqlrc, -A -t so the output is a stable
# byte stream, ON_ERROR_STOP so a failed statement is exit 3 and not a silent skip.
# (scripts/test-ledger-drift-check.sh:141-146 is the same shape.)
psqlt() { psql "$RESTORE_DB_URL" -X -q -A -t -v ON_ERROR_STOP=1 "$@"; }

# ---------------------------------------------------------------------------
# The census SQL. ONE file, run twice (pre and post), so pre/post comparison is a
# comparison of the same program's output and cannot drift.
#
# ⛔ B1 — `SET search_path = pg_catalog` IS LOAD-BEARING, not hygiene. `pg_get_expr`
# and `pg_get_triggerdef` OMIT the schema qualifier of anything on the session
# search_path. Under psql's default `"$user", public`, a policy whose source text
# reads `current_user_has_app_role(...)` unqualified renders as
# `current_user_has_app_role(...)` — so a census that substring-matches `public.`
# in `pg_policies.qual` never sees it, `DROP SCHEMA public CASCADE` removes it, and
# a pre/post key-set comparison agrees on a set that EXCLUDES it. With only
# pg_catalog on the path every public reference renders SCHEMA-QUALIFIED, so the
# match finds it AND the DDL we capture stays replayable after the dump's own
# `set_config('search_path', '', false)`.
# ---------------------------------------------------------------------------
write_census_sql() {
  cat > "$1" <<'CENSUS_SQL'
SET search_path = pg_catalog;

SELECT 'tables=' || count(*)::text FROM pg_tables WHERE schemaname = 'public';

SELECT 'functions=' || count(DISTINCT p.proname)::text
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public';

SELECT 'policies=' || count(*)::text FROM pg_policies WHERE schemaname = 'public';

SELECT 'extensions=' || count(*)::text FROM pg_extension;

-- The ledger may legitimately not exist yet on a database that has never been
-- pushed to. `to_regclass` + `query_to_xml` is how a read stays a read: CASE
-- short-circuits at runtime, so the inner query is never planned when the
-- relation is absent. A hard parse error here would look like a broken instrument.
SELECT 'ledger_rows=' || CASE
         WHEN to_regclass('supabase_migrations.schema_migrations') IS NULL THEN 'absent'
         ELSE (xpath('/row/c/text()',
                query_to_xml('SELECT count(*)::text AS c FROM supabase_migrations.schema_migrations',
                             false, true, '')))[1]::text
       END;

SELECT 'ledger_bad_version=' || CASE
         WHEN to_regclass('supabase_migrations.schema_migrations') IS NULL THEN 'absent'
         ELSE (xpath('/row/c/text()',
                query_to_xml('SELECT count(*)::text AS c FROM supabase_migrations.schema_migrations WHERE version !~ ''^[0-9]{14}$''',
                             false, true, '')))[1]::text
       END;

-- Objects in `public` that `postgres` does NOT own. On hosted Supabase `postgres`
-- cannot drop what it does not own, so the founder must SEE this list before
-- deciding — an empty list here is why the DROP can be expected to succeed.
SELECT 'nonpostgres_rel=' || n.nspname || '.' || c.relname || ' owner=' || pg_get_userbyid(c.relowner)
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public'
   AND c.relkind IN ('r','p','v','m','S','f')
   AND pg_get_userbyid(c.relowner) <> 'postgres'
 ORDER BY 1;

SELECT 'nonpostgres_fn=' || n.nspname || '.' || p.proname || ' owner=' || pg_get_userbyid(p.proowner)
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND pg_get_userbyid(p.proowner) <> 'postgres'
 ORDER BY 1;

-- ── SURVIVORS ───────────────────────────────────────────────────────────────
-- Objects OUTSIDE `public` that depend on something INSIDE it. `DROP SCHEMA public
-- CASCADE` removes them and the dump — which is `--schema public` — does NOT put
-- them back. Emitted as `survivor<TAB>class<TAB>key<TAB>DDL`.
--
-- (a) triggers on non-public tables whose function lives in public. Joined
--     tgfoid -> pronamespace, NOT text-matched: the real one
--     (supabase/migrations/20260405061912_rls_policies.sql:81-83,
--     `CREATE TRIGGER on_auth_user_created ON auth.users ... handle_new_user()`)
--     spells its function UNQUALIFIED in source, which is exactly what a text
--     match misses.
SELECT 'survivor' || chr(9) || 'trigger' || chr(9)
       || n.nspname || '.' || c.relname || ':' || t.tgname || chr(9)
       || pg_get_triggerdef(t.oid) || ';'
  FROM pg_trigger t
  JOIN pg_class c ON c.oid = t.tgrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_proc p ON p.oid = t.tgfoid
  JOIN pg_namespace pn ON pn.oid = p.pronamespace
 WHERE NOT t.tgisinternal
   AND n.nspname <> 'public'
   AND pn.nspname = 'public'
 ORDER BY 1;

-- (b) policies on non-public tables referencing public. Safe as a text match ONLY
--     because of the `SET search_path = pg_catalog` above. Real instance:
--     supabase/migrations/20260417110538_sanitize_user.sql:232-236,
--     `CREATE POLICY gdpr_exports_admin_read ON storage.objects`.
SELECT 'survivor' || chr(9) || 'policy' || chr(9)
       || pol.schemaname || '.' || pol.tablename || ':' || pol.policyname || chr(9)
       || format('CREATE POLICY %I ON %I.%I AS %s FOR %s TO %s%s%s;',
                 pol.policyname, pol.schemaname, pol.tablename,
                 CASE WHEN pol.permissive = 'PERMISSIVE' THEN 'PERMISSIVE' ELSE 'RESTRICTIVE' END,
                 pol.cmd,
                 (SELECT string_agg(quote_ident(r::text), ', ' ORDER BY r::text)
                    FROM unnest(pol.roles) AS r),
                 CASE WHEN pol.qual IS NOT NULL THEN ' USING (' || pol.qual || ')' ELSE '' END,
                 CASE WHEN pol.with_check IS NOT NULL THEN ' WITH CHECK (' || pol.with_check || ')' ELSE '' END)
  FROM pg_policies pol
 WHERE pol.schemaname <> 'public'
   AND (coalesce(pol.qual, '') LIKE '%public.%' OR coalesce(pol.with_check, '') LIKE '%public.%')
 ORDER BY 1;

-- (c) realtime publication membership of public tables. The publication itself is
--     schema-less and survives the DROP; its MEMBERSHIP rows do not.
SELECT 'survivor' || chr(9) || 'publication' || chr(9)
       || 'pub:public.' || pt.tablename || chr(9)
       || format('ALTER PUBLICATION %I ADD TABLE public.%I;', pt.pubname, pt.tablename)
  FROM pg_publication_tables pt
 WHERE pt.schemaname = 'public'
 ORDER BY 1;
CENSUS_SQL
}

# `'` -> `''`. Every identifier that reaches SQL through this function has already
# survived the charset refusal below; this is belt AND braces (T-164.8-04).
sql_lit() { printf "%s" "$1" | sed "s/'/''/g"; }

# ---------------------------------------------------------------------------
# REFUSALS. Ordered. Every one of them fires BEFORE the first write, each with its
# own `::error::` line and exit 1. Plan 02 turns each into a permanent RED arm.
# ---------------------------------------------------------------------------

# 1 — the credential. An absent DSN is exit 1, never a skip. This is the NEWER of
# the repo's two credential-assert shapes (.github/workflows/migration-drift-check.yml
# lines 102-121, "HARD FAILURE, not a skip"), not the older tolerant one.
refuse_absent_credential() {
  if [ -z "${RESTORE_DB_URL:-}" ]; then
    echo "::error::${GATE}: RESTORE_DB_URL is required and is not set."
    echo "::error::This is a HARD FAILURE, not a skip. This script rebuilds a database's"
    echo "::error::public schema; reporting success while unable to reach it would be"
    echo "::error::green-having-done-nothing."
    exit 1
  fi
  command -v psql >/dev/null 2>&1 || fail "psql is not on PATH."
}

# 2 — the dump is the REVIEWED one. `BASELINE.md`'s sha row is read with the SAME
# regex scripts/check-baseline-staleness.mjs uses (its exported RECORDED_SHA_RE,
# `/\|\s*sha256\s*\|\s*`[0-9a-f]{64}`\s*\|/`) and, like it, the FIRST match wins.
# A second opinion here would be a second drift.
refuse_wrong_baseline_sha() {
  [ -f "$BASELINE_FILE" ] || fail "baseline dump not found at ${BASELINE_FILE}."
  [ -f "$BASELINE_DOC" ]  || fail "baseline provenance doc not found at ${BASELINE_DOC}."
  local actual recorded
  actual=$(shasum -a 256 "$BASELINE_FILE" | awk '{print $1}')
  recorded=$(sed -nE 's/.*\|[[:space:]]*sha256[[:space:]]*\|[[:space:]]*`([0-9a-f]{64})`[[:space:]]*\|.*/\1/p' "$BASELINE_DOC" | head -1)
  if [ -z "$recorded" ]; then
    fail "${BASELINE_DOC} carries no parseable sha256 row, so there is nothing to compare ${BASELINE_FILE} against. Refusing to restore from an unattested dump."
  fi
  if [ "$actual" != "$recorded" ]; then
    fail "${BASELINE_FILE} hashes to ${actual} but ${BASELINE_DOC} records ${recorded}. The dump on disk is not the reviewed, secret-scanned one. Refusing."
  fi
  note "baseline sha256 OK — ${BASELINE_FILE} matches the row in ${BASELINE_DOC}"
  BASELINE_SHA="$actual"
}

# 3 — freshness. A migration committed AFTER the last baseline regeneration means
# the dump no longer describes PROD, so restoring TEST from it would seed a ledger
# claiming migrations the schema does not carry.
refuse_stale_baseline() {
  local b_ts m_ts
  b_ts=$($FRESHNESS_TS_CMD "$BASELINE_FILE" 2>/dev/null | head -1 | tr -d '[:space:]')
  m_ts=$($FRESHNESS_TS_CMD "$MIGRATIONS_DIR" 2>/dev/null | head -1 | tr -d '[:space:]')
  case "$b_ts" in ''|*[!0-9]*) fail "FRESHNESS_TS_CMD printed no epoch for ${BASELINE_FILE} (got '${b_ts}'). An unreadable timestamp is not a fresh one." ;; esac
  case "$m_ts" in ''|*[!0-9]*) fail "FRESHNESS_TS_CMD printed no epoch for ${MIGRATIONS_DIR} (got '${m_ts}'). An unreadable timestamp is not a fresh one." ;; esac
  if [ "$b_ts" -lt "$m_ts" ]; then
    fail "the baseline dump is STALE: ${BASELINE_FILE} last changed at epoch ${b_ts}, ${MIGRATIONS_DIR} at ${m_ts}. A migration landed after the last dump regeneration, so this dump does not describe PROD. Regenerate the baseline first."
  fi
  note "baseline freshness OK — baseline epoch ${b_ts} >= migrations epoch ${m_ts}"
}

# 4 — the migration corpus. Non-recursive, charset-refused before any basename is
# interpolated into SQL (the VAC-08 idiom, test-ledger-drift-check.sh:281-284), and
# an EMPTY corpus is an ERROR: zero migrations means the glob drifted, not that the
# ledger is clean.
MIGRATION_BASENAMES=()
refuse_bad_migration_corpus() {
  [ -d "$MIGRATIONS_DIR" ] || fail "migrations dir not found at ${MIGRATIONS_DIR}."
  local f base
  MIGRATION_BASENAMES=()
  for f in "$MIGRATIONS_DIR"/*.sql; do
    [ -e "$f" ] || continue
    base="$(basename "$f" .sql)"
    case "$base" in
      *[!A-Za-z0-9_.-]*) fail "migration filename '${base}' contains characters this script refuses to interpolate into SQL." ;;
    esac
    MIGRATION_BASENAMES+=("$base")
  done
  if [ "${#MIGRATION_BASENAMES[@]}" -eq 0 ]; then
    fail "no migration files found under ${MIGRATIONS_DIR}. The repo-side list is EMPTY, so the ledger seed would be empty — that is not a restore."
  fi
  note "migrations: ${#MIGRATION_BASENAMES[@]} file(s) under ${MIGRATIONS_DIR}"
}

# 5 — WHICH DATABASE AM I ON. The first statement this script sends. CLAUDE.md
# § "Which database am I on? (ask FIRST, every time)": `current_database()` is
# `postgres` on BOTH projects and proves nothing; each project carries a hand-set
# COMMENT ON DATABASE naming itself.
#
# ⛔ The marker TEXT is never printed. This log is public.
refuse_wrong_database() {
  local marker rc=0
  marker=$(psqlt -c "SELECT shobj_description(oid, 'pg_database') AS which_database
  FROM pg_database WHERE datname = current_database();" 2>&1) || rc=$?
  if [ "$rc" -ne 0 ]; then
    fail "the database identity marker could not be read (psql exited ${rc}). Refusing to write to a database this script cannot identify."
  fi
  marker=$(printf '%s' "$marker" | tr -d '\r')
  if [ -z "$marker" ]; then
    fail "the database identity marker is NULL. Re-set the COMMENT ON DATABASE marker before writing — CLAUDE.md § Which database am I on? A NULL marker means the marker was lost, not that this is TEST."
  fi
  if ! printf '%s' "$marker" | grep -Eiq "$RESTORE_EXPECT_MARKER_RE"; then
    fail "the database identity marker does not name TEST (it must match RESTORE_EXPECT_MARKER_RE, case-insensitively). Refusing. The marker text is withheld: this log is public."
  fi
  if printf '%s' "$marker" | grep -Eiq "$RESTORE_REFUSE_MARKER_RE"; then
    fail "the database identity marker matches RESTORE_REFUSE_MARKER_RE — it names PRODUCTION. Refusing, loudly. The marker text is withheld: this log is public."
  fi
  note "which_database: OK — marker names TEST and not PROD"
}

# 6 — the shared-TEST advisory mutex. TEST is shared with other people's CI and we
# cannot see their runs; an apply racing a running `sql-tests` corrupts a reading
# rather than merely delaying it (CONTEXT Area 4). The lock is taken by the
# WORKFLOW's Acquire step in a separate session and held for the whole restore, so
# this script asserts it is held rather than taking it itself — a lock taken here
# would be released the moment this process exits.
refuse_without_mutex() {
  if [ "$RESTORE_REQUIRE_MUTEX" != "1" ]; then
    note "mutex check DISABLED by RESTORE_REQUIRE_MUTEX=${RESTORE_REQUIRE_MUTEX}"
    return 0
  fi
  local held rc=0
  held=$(psqlt -c "SELECT count(*) FROM pg_locks WHERE locktype = 'advisory' AND objid = ${MUTEX_KEY} AND granted;" 2>&1) || rc=$?
  [ "$rc" -eq 0 ] || fail "could not read pg_locks to confirm the shared-TEST mutex (psql exited ${rc})."
  held=$(printf '%s' "$held" | tr -d '[:space:]')
  case "$held" in ''|*[!0-9]*) fail "MEASURE_FAIL: the mutex probe returned '${held}', not a count. An unreadable lock state is not a held lock." ;; esac
  if [ "$held" -lt 1 ]; then
    fail "the shared-TEST mutex (${MUTEX_KEY}) is not held — this script runs INSIDE the workflow's Acquire step, never alone. Refusing to DROP SCHEMA on a shared database with nothing keeping other CI out."
  fi
  note "shared-TEST mutex ${MUTEX_KEY}: held (${held} session(s))"
}

# 7 — every publication row must name a table the dump RE-CREATES. Its re-ADD after
# the replay would otherwise fail on a relation that no longer exists and abort the
# restore every time (W3). Removing such a row is a FOUNDER act recorded in the
# RESTORE log — `ALTER PUBLICATION <pub> DROP TABLE public.<t>` — never done here.
#
# awk with index(), not grep: the table name comes from the database and has not
# been charset-refused, so it must never be read as a regular expression.
refuse_publication_row_without_table() {
  local key t bad=""
  while IFS= read -r key; do
    [ -n "$key" ] || continue
    case "$key" in pub:public.*) t="${key#pub:public.}" ;; *) continue ;; esac
    if ! awk -v t="$t" 'index($0, "CREATE TABLE") == 1 && index($0, "\"public\".\"" t "\"") > 0 { found = 1; exit } END { exit !found }' "$BASELINE_FILE"; then
      bad="${bad}${bad:+ }${key}"
    fi
  done < "$RESTORE_OUT_DIR/survivors.keys"
  if [ -n "$bad" ]; then
    fail "the realtime publication carries row(s) for table(s) the baseline dump does not re-create: ${bad}. Re-adding them after the replay would fail on a relation that no longer exists and abort every restore. Remove the row by founder decision first (ALTER PUBLICATION <pub> DROP TABLE public.<table>) and record it in the RESTORE log; this script will not do it."
  fi
}

# ---------------------------------------------------------------------------
# CENSUS
# ---------------------------------------------------------------------------
census_val() { awk -F= -v k="$2" '$1 == k { print $2; exit }' "$1"; }
census_survivor_count() { grep -ac '^survivor	' "$1" || true; }

run_census() {
  local out="$1" rc=0
  psqlt -f "$RESTORE_OUT_DIR/census.sql" > "$out" 2>"$RESTORE_OUT_DIR/census.err" || rc=$?
  if [ "$rc" -ne 0 ]; then
    cat "$RESTORE_OUT_DIR/census.err" >&2
    fail "the census query failed (psql exited ${rc}). A census that cannot be read is not a census of nothing."
  fi
}

# Splits the census into the two artefacts the transaction consumes.
# ⛔ T-164.8-03: both are written BEFORE the transaction opens, so Plan 03's backup
# artifact captures the ONLY record of the survivors even when the transaction aborts.
split_survivors() {
  awk -F'\t' '$1 == "survivor" { print $3 }' "$RESTORE_OUT_DIR/pre-census.txt" > "$RESTORE_OUT_DIR/survivors.keys"
  {
    echo "-- Survivors: objects OUTSIDE public that depend on something INSIDE it."
    echo "-- Captured from the live catalogue under search_path = pg_catalog (B1), so every"
    echo "-- public reference below is SCHEMA-QUALIFIED and replays after the dump's own"
    echo "-- set_config('search_path', '', false)."
    awk -F'\t' '$1 == "survivor" { print $4 }' "$RESTORE_OUT_DIR/pre-census.txt"
  } > "$RESTORE_OUT_DIR/survivors.sql"
}

# ---------------------------------------------------------------------------
# EXPECTED SHAPE — derived from the DUMP TEXT, never from the database. An
# expectation read off the thing under test cannot fail.
# ---------------------------------------------------------------------------
EXP_TABLES=0; EXP_POLICIES=0; EXP_FUNCTIONS=0
derive_expected_shape() {
  local rc
  set +e; EXP_TABLES=$(grep -ac '^CREATE TABLE' "$BASELINE_FILE"); rc=$?; set -e
  [ "$rc" -le 1 ] || fail "MEASURE_FAIL: could not count CREATE TABLE lines in ${BASELINE_FILE} (grep exited ${rc})."
  set +e; EXP_POLICIES=$(grep -ac '^CREATE POLICY' "$BASELINE_FILE"); rc=$?; set -e
  [ "$rc" -le 1 ] || fail "MEASURE_FAIL: could not count CREATE POLICY lines in ${BASELINE_FILE} (grep exited ${rc})."
  command -v node >/dev/null 2>&1 || fail "node is not on PATH; the shared normalizer cannot run."
  [ -f "$NORMALIZER" ] || fail "normalizer not found at ${NORMALIZER}."
  EXP_FUNCTIONS=$(node "$NORMALIZER" --function-names "$BASELINE_FILE" | grep -ac '[^[:space:]]' || true)
  EXP_TABLES=${EXP_TABLES:-0}; EXP_POLICIES=${EXP_POLICIES:-0}; EXP_FUNCTIONS=${EXP_FUNCTIONS:-0}
  [ "$EXP_TABLES" -ge 1 ] || fail "${BASELINE_FILE} carries ZERO CREATE TABLE lines. A dump that creates nothing is not a baseline."
  note "expected shape from the dump text: tables=${EXP_TABLES} policies=${EXP_POLICIES} functions=${EXP_FUNCTIONS}"
}

# The ONE line class filtered out of the dump. On hosted Supabase the realtime
# publication is owned by `supabase_admin` and `postgres` may not reassign it; on a
# throwaway lane the statement would SUCCEED, which is why the filter is asserted
# by COUNT rather than by its effect.
FILTER_PATTERN='^ALTER PUBLICATION "supabase_realtime" OWNER TO'
FILTERED_N=0

# ---------------------------------------------------------------------------
# THE TRANSACTION
# ---------------------------------------------------------------------------
build_transaction() {
  local mode="$1" out="$RESTORE_OUT_DIR/restore.sql"
  local keys_csv="" k rc
  while IFS= read -r k; do
    [ -n "$k" ] || continue
    keys_csv="${keys_csv}${keys_csv:+, }'$(sql_lit "$k")'"
  done < "$RESTORE_OUT_DIR/survivors.keys"
  [ -n "$keys_csv" ] || keys_csv="NULL::text"

  set +e; FILTERED_N=$(grep -ac "$FILTER_PATTERN" "$BASELINE_FILE"); rc=$?; set -e
  [ "$rc" -le 1 ] || fail "MEASURE_FAIL: could not count the filtered line class in ${BASELINE_FILE} (grep exited ${rc})."
  FILTERED_N=${FILTERED_N:-0}

  local seed_date provenance
  seed_date=$(date -u +%Y-%m-%d)
  provenance="SEEDED ${seed_date} by scripts/restore-test-from-baseline.sh from ${BASELINE_FILE} sha256 ${BASELINE_SHA}: schema restored from the PROD dump; this file's SQL was NOT executed on TEST"

  : > "$out"

  cat >> "$out" <<'TXN_HEAD'
BEGIN;
-- Fail loud rather than queue behind a foreign lock: TEST is shared, and a restore
-- that waits forever is indistinguishable from one that hung.
SET LOCAL lock_timeout = '30s';
SET LOCAL statement_timeout = 0;
-- B1 again. The in-transaction census MUST render identically to the pre-census,
-- or the key sets are two different measurements wearing one name.
SET LOCAL search_path = pg_catalog;
TXN_HEAD

  # ── whitelist-emptiness assertion ────────────────────────────────────────
  # The derived census below resolves a WHITELIST of refclassid values. A whitelist
  # is only closed if what it EXCLUDES is measured empty rather than assumed empty.
  # The dump's 190 objects are all table/function/view/type/sequence, but this runs
  # against TEST, which can hold objects the dump does not — so it is asserted on the
  # LIVE database, inside the transaction, and not derived from the dump text.
  cat >> "$out" <<TXN_WHITELIST
DO \$restore\$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('pg_operator',    (SELECT count(*) FROM pg_operator     WHERE oprnamespace  = 'public'::regnamespace)),
      ('pg_opclass',     (SELECT count(*) FROM pg_opclass      WHERE opcnamespace  = 'public'::regnamespace)),
      ('pg_opfamily',    (SELECT count(*) FROM pg_opfamily     WHERE opfnamespace  = 'public'::regnamespace)),
      ('pg_collation',   (SELECT count(*) FROM pg_collation    WHERE collnamespace = 'public'::regnamespace)),
      ('pg_conversion',  (SELECT count(*) FROM pg_conversion   WHERE connamespace  = 'public'::regnamespace)),
      ('pg_ts_config',   (SELECT count(*) FROM pg_ts_config    WHERE cfgnamespace  = 'public'::regnamespace)),
      ('pg_ts_dict',     (SELECT count(*) FROM pg_ts_dict      WHERE dictnamespace = 'public'::regnamespace)),
      ('pg_ts_parser',   (SELECT count(*) FROM pg_ts_parser    WHERE prsnamespace  = 'public'::regnamespace)),
      ('pg_ts_template', (SELECT count(*) FROM pg_ts_template  WHERE tmplnamespace = 'public'::regnamespace))
    ) AS t(cls, n)
    WHERE t.n > 0
    ORDER BY 1
  LOOP
    RAISE EXCEPTION 'restore aborted: public holds % object(s) of class % which the derived-census whitelist does not resolve; extend the refclassid set (a new class = a new self-test arm) before restoring', r.n, r.cls;
  END LOOP;
END
\$restore\$;
TXN_WHITELIST

  # ── the derived-census closure assertion (B2) ────────────────────────────
  # WHY pg_depend and NOT the `drop cascades to` NOTICEs the CASCADE itself emits:
  # that channel TRUNCATES. The server reports at most 100 dependents to the client
  # and then appends "and N other objects (see server log for list)"
  # (MAX_REPORTED_DEPS in the server's dependency.c). The real `public` has 190+
  # direct dependents, so on TEST the list would be cut long before the survivors
  # appeared in it. pg_depend has the same property — measured, not enumerated —
  # with no truncation, and it is asserted BEFORE the DROP rather than during it.
  #
  # Three hand-listed classes cannot fail if a FOURTH exists (a non-public view over
  # a public table; a CHECK/DEFAULT on a non-public table calling a public function;
  # a non-public FK to a public table; a cross-schema type or domain). Anything the
  # key grammar does not name keeps its pg_describe_object() text, which by
  # construction never matches a survivor key — so an unlisted class ABORTS.
  cat >> "$out" <<TXN_CLOSURE
DO \$restore\$
DECLARE
  v_keys text[] := ARRAY[${keys_csv}]::text[];
  r record;
BEGIN
  FOR r IN
    WITH refpub AS (
      SELECT d.classid, d.objid, d.objsubid
        FROM pg_depend d
       WHERE d.classid <> 0
         AND (
              (d.refclassid = 'pg_class'::regclass
               AND EXISTS (SELECT 1 FROM pg_class rc JOIN pg_namespace rn ON rn.oid = rc.relnamespace
                            WHERE rc.oid = d.refobjid AND rn.nspname = 'public'))
           OR (d.refclassid = 'pg_proc'::regclass
               AND EXISTS (SELECT 1 FROM pg_proc rp JOIN pg_namespace rn ON rn.oid = rp.pronamespace
                            WHERE rp.oid = d.refobjid AND rn.nspname = 'public'))
           OR (d.refclassid = 'pg_type'::regclass
               AND EXISTS (SELECT 1 FROM pg_type rt JOIN pg_namespace rn ON rn.oid = rt.typnamespace
                            WHERE rt.oid = d.refobjid AND rn.nspname = 'public'))
           OR (d.refclassid = 'pg_namespace'::regclass AND d.refobjid = 'public'::regnamespace)
         )
    ),
    owned AS (
      SELECT p.classid, p.objid, p.objsubid,
             CASE
               WHEN p.classid = 'pg_trigger'::regclass THEN (SELECT n.nspname FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE t.oid = p.objid)
               WHEN p.classid = 'pg_policy'::regclass THEN (SELECT n.nspname FROM pg_policy pl JOIN pg_class c ON c.oid = pl.polrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE pl.oid = p.objid)
               WHEN p.classid = 'pg_rewrite'::regclass THEN (SELECT n.nspname FROM pg_rewrite w JOIN pg_class c ON c.oid = w.ev_class JOIN pg_namespace n ON n.oid = c.relnamespace WHERE w.oid = p.objid)
               WHEN p.classid = 'pg_constraint'::regclass THEN (SELECT n.nspname FROM pg_constraint k JOIN pg_class c ON c.oid = k.conrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE k.oid = p.objid)
               WHEN p.classid = 'pg_attrdef'::regclass THEN (SELECT n.nspname FROM pg_attrdef a JOIN pg_class c ON c.oid = a.adrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE a.oid = p.objid)
               WHEN p.classid = 'pg_publication_rel'::regclass THEN NULL
               WHEN p.classid = 'pg_class'::regclass THEN (SELECT n.nspname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.oid = p.objid)
               WHEN p.classid = 'pg_proc'::regclass THEN (SELECT n.nspname FROM pg_proc pr JOIN pg_namespace n ON n.oid = pr.pronamespace WHERE pr.oid = p.objid)
               WHEN p.classid = 'pg_type'::regclass THEN (SELECT n.nspname FROM pg_type ty JOIN pg_namespace n ON n.oid = ty.typnamespace WHERE ty.oid = p.objid)
               ELSE NULL
             END AS own_schema,
             CASE
               WHEN p.classid = 'pg_trigger'::regclass THEN (SELECT n.nspname || '.' || c.relname || ':' || t.tgname FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE t.oid = p.objid)
               WHEN p.classid = 'pg_policy'::regclass THEN (SELECT n.nspname || '.' || c.relname || ':' || pl.polname FROM pg_policy pl JOIN pg_class c ON c.oid = pl.polrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE pl.oid = p.objid)
               WHEN p.classid = 'pg_publication_rel'::regclass THEN (SELECT 'pub:public.' || c.relname FROM pg_publication_rel pr JOIN pg_class c ON c.oid = pr.prrelid WHERE pr.oid = p.objid)
               ELSE pg_describe_object(p.classid, p.objid, p.objsubid)
             END AS key
        FROM refpub p
    )
    -- DISTINCT: a policy referencing two public functions yields two pg_depend rows
    -- and must be reported, and forgiven, exactly once.
    SELECT DISTINCT o.key
      FROM owned o
     WHERE o.own_schema IS DISTINCT FROM 'public'
       AND o.own_schema IS DISTINCT FROM 'supabase_migrations'
       AND o.key IS NOT NULL
     ORDER BY 1
  LOOP
    IF NOT (r.key = ANY (v_keys)) THEN
      RAISE EXCEPTION 'restore aborted: % depends on public and is NOT a censused survivor — it would be CASCADE-dropped and never re-created; extend the survivors census (a new class = a new self-test arm) or remove the object by founder decision', r.key;
    END IF;
  END LOOP;
END
\$restore\$;
TXN_CLOSURE

  cat >> "$out" <<'TXN_DROP'
DROP SCHEMA public CASCADE;
CREATE SCHEMA public;
TXN_DROP

  # The dump, with exactly ONE line class removed. `grep -a` because a byte the
  # locale calls binary must not silently turn this filter into a no-op.
  grep -av "$FILTER_PATTERN" "$BASELINE_FILE" >> "$out"

  # The dump ends with `set_config('search_path', '', false)` still in force. The
  # survivor DDL below is fully qualified and does not need a path — the ledger DDL
  # and the assertions do.
  cat >> "$out" <<'TXN_MID'
SET LOCAL search_path = pg_catalog;
TXN_MID
  cat "$RESTORE_OUT_DIR/survivors.sql" >> "$out"

  # ── the ledger ───────────────────────────────────────────────────────────
  # The DDL is the CLI's OWN (supabase/cli v2.98.2, its migration-history package).
  # A ledger this script invented would be a ledger `supabase db push` does not read.
  cat >> "$out" <<'TXN_LEDGER_DDL'
CREATE SCHEMA IF NOT EXISTS supabase_migrations;
CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (version text NOT NULL PRIMARY KEY, statements text[], name text);
TRUNCATE supabase_migrations.schema_migrations;
TXN_LEDGER_DDL

  local base version name
  for base in "${MIGRATION_BASENAMES[@]}"; do
    version="${base%%_*}"
    name="${base#*_}"
    printf "INSERT INTO supabase_migrations.schema_migrations(version, name, statements) VALUES ('%s', '%s', ARRAY['%s']);\n" \
      "$(sql_lit "$version")" "$(sql_lit "$name")" "$(sql_lit "$provenance")" >> "$out"
  done

  # ── in-transaction shape assertions ──────────────────────────────────────
  # Every number here comes from the DUMP TEXT or from the FILE LIST, never from the
  # database being measured. They run before the terminator, so a wrong shape rolls
  # the whole thing back rather than leaving a half-restored TEST behind.
  cat >> "$out" <<TXN_ASSERT
DO \$restore\$
DECLARE
  v_keys      text[] := ARRAY[${keys_csv}]::text[];
  v_post_keys text[];
  v_n         bigint;
  k           text;
BEGIN
  SELECT count(*) INTO v_n FROM pg_tables WHERE schemaname = 'public';
  IF v_n <> ${EXP_TABLES} THEN
    RAISE EXCEPTION 'restore aborted: public holds % table(s) after the replay, expected % (CREATE TABLE lines in the baseline dump)', v_n, ${EXP_TABLES};
  END IF;

  SELECT count(*) INTO v_n FROM pg_policies WHERE schemaname = 'public';
  IF v_n <> ${EXP_POLICIES} THEN
    RAISE EXCEPTION 'restore aborted: public holds % policy(ies) after the replay, expected % (CREATE POLICY lines in the baseline dump)', v_n, ${EXP_POLICIES};
  END IF;

  SELECT count(DISTINCT p.proname) INTO v_n
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public';
  IF v_n <> ${EXP_FUNCTIONS} THEN
    RAISE EXCEPTION 'restore aborted: public holds % distinct function name(s) after the replay, expected % (the shared normalizer''s reading of the baseline dump)', v_n, ${EXP_FUNCTIONS};
  END IF;

  SELECT count(*) INTO v_n FROM supabase_migrations.schema_migrations;
  IF v_n <> ${#MIGRATION_BASENAMES[@]} THEN
    RAISE EXCEPTION 'restore aborted: the ledger holds % row(s), expected % (one per repo migration file)', v_n, ${#MIGRATION_BASENAMES[@]};
  END IF;

  SELECT count(*) INTO v_n FROM supabase_migrations.schema_migrations WHERE version !~ '^[0-9]{14}\$';
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'restore aborted: % ledger row(s) carry a version that is not the 14-digit filename prefix. That is the exact shape (an APPLY timestamp in the version column) this restore exists to remove', v_n;
  END IF;

  SELECT array_agg(kk ORDER BY kk) INTO v_post_keys FROM (
    SELECT n.nspname || '.' || c.relname || ':' || t.tgname AS kk
      FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_proc p ON p.oid = t.tgfoid
      JOIN pg_namespace pn ON pn.oid = p.pronamespace
     WHERE NOT t.tgisinternal AND n.nspname <> 'public' AND pn.nspname = 'public'
    UNION ALL
    SELECT pol.schemaname || '.' || pol.tablename || ':' || pol.policyname
      FROM pg_policies pol
     WHERE pol.schemaname <> 'public'
       AND (coalesce(pol.qual, '') LIKE '%public.%' OR coalesce(pol.with_check, '') LIKE '%public.%')
    UNION ALL
    SELECT 'pub:public.' || pt.tablename
      FROM pg_publication_tables pt
     WHERE pt.schemaname = 'public'
  ) s;

  IF v_keys IS NOT NULL THEN
    FOREACH k IN ARRAY v_keys LOOP
      IF k IS NOT NULL AND NOT (k = ANY (coalesce(v_post_keys, ARRAY[]::text[]))) THEN
        RAISE EXCEPTION 'restore aborted: survivor % was censused before the DROP but is NOT present after the replay — it would have been lost', k;
      END IF;
    END LOOP;
  END IF;
END
\$restore\$;
NOTIFY pgrst, 'reload schema';
TXN_ASSERT

  # ⛔ THE ONLY DIFFERENCE BETWEEN THE TWO MODES. Everything above is byte-identical,
  # which is what makes a green preflight evidence about the restore that follows.
  if [ "$mode" = "restore" ]; then
    echo "COMMIT;" >> "$out"
  else
    echo "ROLLBACK;" >> "$out"
  fi

  note "transaction assembled at ${out} (filtered: ${FILTERED_N} line(s) matching ${FILTER_PATTERN})"
}

run_transaction() {
  local rc=0
  psql "$RESTORE_DB_URL" -X -q -v ON_ERROR_STOP=1 -f "$RESTORE_OUT_DIR/restore.sql" \
    > "$RESTORE_OUT_DIR/transaction.out" 2>&1 || rc=$?
  cat "$RESTORE_OUT_DIR/transaction.out"
  if [ "$rc" -ne 0 ]; then
    local first
    first=$(grep -a -m1 -E '^(psql:|ERROR:)' "$RESTORE_OUT_DIR/transaction.out" || true)
    echo "::error::${GATE}: restore aborted at ${first:-<psql exited ${rc} with no ERROR line>}; the transaction was rolled back, the database is unchanged." >&2
    exit 1
  fi
}

# ---------------------------------------------------------------------------
# --run
# ---------------------------------------------------------------------------
run_restore() {
  local mode="$1"
  case "$mode" in
    preflight|restore) ;;
    *) fail "unknown --mode '${mode}'. Use 'preflight' or 'restore'." ;;
  esac

  refuse_absent_credential
  refuse_wrong_baseline_sha
  refuse_stale_baseline
  refuse_bad_migration_corpus

  if [ -z "${RESTORE_OUT_DIR:-}" ]; then
    RESTORE_OUT_DIR="$(mktemp -d)"
    OWNED_OUT_DIR="$RESTORE_OUT_DIR"
    trap cleanup_out_dir EXIT
    trap 'exit 130' INT
    trap 'exit 143' TERM
  fi
  mkdir -p "$RESTORE_OUT_DIR"
  write_census_sql "$RESTORE_OUT_DIR/census.sql"

  refuse_wrong_database
  refuse_without_mutex

  note "── pre-census (read-only) ──────────────────────────────────────────"
  run_census "$RESTORE_OUT_DIR/pre-census.txt"
  cat "$RESTORE_OUT_DIR/pre-census.txt"
  split_survivors
  local pre_survivors
  pre_survivors=$(census_survivor_count "$RESTORE_OUT_DIR/pre-census.txt")
  note "survivors censused: ${pre_survivors}"

  refuse_publication_row_without_table

  derive_expected_shape
  build_transaction "$mode"

  note "── transaction (mode=${mode}) ──────────────────────────────────────"
  run_transaction

  note "── post-census (read-only) ─────────────────────────────────────────"
  run_census "$RESTORE_OUT_DIR/post-census.txt"
  cat "$RESTORE_OUT_DIR/post-census.txt"

  if [ "$mode" = "preflight" ]; then
    # The rollback is MEASURED, not assumed. A preflight that changed anything is a
    # defect, and it is the one thing a preflight is for.
    if ! cmp -s "$RESTORE_OUT_DIR/pre-census.txt" "$RESTORE_OUT_DIR/post-census.txt"; then
      diff "$RESTORE_OUT_DIR/pre-census.txt" "$RESTORE_OUT_DIR/post-census.txt" >&2 || true
      fail "post-census != pre-census. The transaction was supposed to ROLL BACK and the database is NOT byte-for-byte unchanged. Treat this database as modified."
    fi
    echo "preflight: post-census == pre-census (byte-for-byte) — the transaction ran to its ROLLBACK terminator and the database is unchanged; mode=preflight"
    return 0
  fi

  local n_tables n_policies n_functions n_ledger post_survivors
  n_tables=$(census_val "$RESTORE_OUT_DIR/post-census.txt" tables)
  n_policies=$(census_val "$RESTORE_OUT_DIR/post-census.txt" policies)
  n_functions=$(census_val "$RESTORE_OUT_DIR/post-census.txt" functions)
  n_ledger=$(census_val "$RESTORE_OUT_DIR/post-census.txt" ledger_rows)
  post_survivors=$(census_survivor_count "$RESTORE_OUT_DIR/post-census.txt")

  [ "$n_tables"    = "$EXP_TABLES" ]    || fail "post-census tables=${n_tables}, expected ${EXP_TABLES}."
  [ "$n_policies"  = "$EXP_POLICIES" ]  || fail "post-census policies=${n_policies}, expected ${EXP_POLICIES}."
  [ "$n_functions" = "$EXP_FUNCTIONS" ] || fail "post-census functions=${n_functions}, expected ${EXP_FUNCTIONS}."
  [ "$n_ledger"    = "${#MIGRATION_BASENAMES[@]}" ] || fail "post-census ledger_rows=${n_ledger}, expected ${#MIGRATION_BASENAMES[@]}."
  [ "$post_survivors" = "$pre_survivors" ] || fail "post-census survivors=${post_survivors}, pre-census had ${pre_survivors}."

  echo "restore: tables=${n_tables} policies=${n_policies} functions=${n_functions} ledger_rows=${n_ledger} survivors=${post_survivors}/${pre_survivors} filtered=${FILTERED_N} mode=restore"
}

# ---------------------------------------------------------------------------
# DISPATCH. Unknown argv is a refusal, never a default (the VAC-08 idiom,
# test-ledger-drift-check.sh:675-680): a typo'd mode must not silently become the
# destructive one.
# ---------------------------------------------------------------------------
# `--help` prints the header block from this file itself, so the contract a reader
# is shown and the contract this file carries cannot drift (scripts/pg-lane/run.sh:846).
print_header() { awk 'NR > 1 { if (!/^#/) exit; print }' "$0"; }

main() {
  case "${1:-}" in
    -h|--help) print_header ;;
    --self-test) shift; self_test "$@" ;;
    --run)
      shift
      local mode=""
      while [ "$#" -gt 0 ]; do
        case "$1" in
          --mode) shift; mode="${1:-}" ;;
          --mode=*) mode="${1#--mode=}" ;;
          *) fail "unknown argument to --run: '${1}' (see --help)" ;;
        esac
        shift || true
      done
      [ -n "$mode" ] || fail "--run requires --mode preflight or --mode restore. There is no default: the destructive mode is never reached by omission."
      run_restore "$mode"
      ;;
    "") fail "no mode given. Usage: $0 --self-test | --run --mode preflight|restore | --help" ;;
    *) fail "unknown mode '${1}'. Usage: $0 --self-test | --run --mode preflight|restore | --help" ;;
  esac
}

main "$@"
