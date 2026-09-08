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
# the REAL `--run` dispatch against it. It never touches TEST or PROD.
#
# IT PROVES THE MECHANISM: eighteen counted arms — seven refusals that fire before
# any write, a preflight whose rollback is measured byte-for-byte, a restore that
# commits the full shape, three survivor classes that round-trip, a fourth class
# the derived census names and aborts on, a redaction check with a subject, a
# whitelist tripwire, a default ACL that round-trips, and a calibration arm proving
# the harness can say no. Every arm has a NAMED falsifier that was observed RED on
# a scratch copy; the record is `164.8-02-SUMMARY.md`.
#
# ⛔ IT DOES NOT PROVE THAT THE REAL DUMP APPLIES. The pg-lane has no `pg_net` and
# no `supabase_vault`, so `supabase/schema/baseline.sql` CANNOT replay on it; every
# arm above runs against a baseline-SHAPED FIXTURE. Whether the real dump applies
# to hosted TEST is a separate question, and the only honest way to answer it is
# `--mode preflight` against TEST itself, inside a transaction that rolls back
# (Plans 03/04). A green self-test is evidence about this script, never about TEST.
#
# The closing line, verbatim, MEASURED 2026-09-08 on macOS (11 s, exit 0) — the same
# date that sits beside EXPECTED_ARMS below:
#
#   restore-test-from-baseline: self-test OK (18/18 arms — seven refusals fire
#   before any write, preflight rolls back byte-for-byte, restore commits the full
#   shape, survivors round-trip search_path-independently, the derived census names
#   an unlisted dependent, redaction is checked with a subject, the census whitelist
#   refuses an unresolvable class, default ACLs round-trip, harness calibrated)
#
# (wrapped for this comment; the script emits it on ONE line, which is what CI greps)
#
# ── TWO DESIGN CHOICES THAT LOOK LIKE HYGIENE AND ARE NOT ───────────────────
# B1 — the census runs under `SET search_path = pg_catalog` because `pg_get_expr`
# and `pg_get_triggerdef` OMIT the qualifier of anything on the reader's path, so
# under the default path a survivor whose source spells `public.f()` unqualified
# renders without `public.`, is never censused, is CASCADE-dropped, and a pre/post
# key-set comparison agrees on a set that excludes it.
#
# B2 — the closure reads `pg_depend` and not the `drop cascades to` NOTICEs because
# that channel truncates at 100 dependents (MAX_REPORTED_DEPS) and the real `public`
# has 190+, so the survivors would be cut off the list — and a check that reads the
# CASCADE's output necessarily runs after the drop, too late to refuse.
#
# ── THIS LOG IS PUBLIC ──────────────────────────────────────────────────────
# The repo is public and Actions logs are world-readable. Everything this script
# prints is NAMES AND COUNTS: object names, schema names, row counts, sha256 values,
# epochs. NEVER a DSN, NEVER a password, NEVER a SQL body. The identity marker's
# TEXT is withheld even when it is the reason for a refusal. `--self-test` enforces
# this on itself: every arm's captured output is grepped for a DSN shape and for
# dollar-quoted SQL, and arm 14 proves that grep fires on a real leak.
#
# ── TWO THINGS THIS SCRIPT DELIBERATELY DOES NOT DO ─────────────────────────
# 1. IT DOES NOT BACK ANYTHING UP. The WORKFLOW takes the backup, BEFORE calling
#    this script (Plan 03). Doing it here would put the backup inside the thing
#    being tested, so a bug in this script could take the backup with it.
# 2. IT DOES NOT TAKE THE MUTEX. It ASSERTS the shared-TEST advisory mutex is held
#    by another session and refuses otherwise. A lock taken here would be released
#    the moment this process exited — i.e. before the founder had finished reading
#    the result — so the workflow's Acquire step holds it for the whole restore.
#
# ── ⛔ WHAT A RESTORE DESTROYS, AND WHAT IS NOT BACKED UP ────────────────────
# `--mode restore` DROPs the `public` schema. That destroys EVERY ROW IN EVERY
# `public` TABLE ON TEST — all of it, not a sample. The backup the workflow takes
# is the LEDGER and the SCHEMA (CONTEXT safety rule 3 names those two, in those
# words). It is NOT a data backup: the data is NOT reversible. Restoring the
# backup gives back the shape of the old TEST and its migration history, and
# gives back none of its contents.
#
# TEST is SHARED with other people's CI and we cannot see their runs. That is why
# `--mode restore` is founder-executed or founder-approved AT THE MOMENT OF
# EXECUTION, never an unattended job (CONTEXT safety rule 4).
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
               -- A DEFAULT ACL is not an object with a schema of its own either:
               -- \`ALTER DEFAULT PRIVILEGES ... IN SCHEMA public\` records a
               -- pg_default_acl row whose CARRIER is the namespace named in
               -- \`defaclnamespace\`. Same carrier pattern as pg_trigger.tgrelid,
               -- applied one class further again.
               --
               -- ⭐ MEASURED ON SHARED TEST 2026-09-08 (read-only, marker verified):
               -- pg_default_acl holds 6 rows whose defaclnamespace is public, and
               -- the reviewed dump re-creates them with 12 ALTER DEFAULT PRIVILEGES
               -- statements. Without this branch own_schema is NULL, the key falls
               -- through to pg_describe_object(), it matches no survivor, and the
               -- closure ABORTS naming a default ACL the dump WOULD have restored —
               -- a FALSE abort on the first real preflight.
               --
               -- ⛔ Resolved by CARRIER, never by excluding the class: an exclusion
               -- would also hide a default ACL in a NON-public schema, which is a
               -- genuine survivor. (Self-test arm 18.)
               WHEN p.classid = 'pg_default_acl'::regclass THEN (SELECT n.nspname FROM pg_default_acl da JOIN pg_namespace n ON n.oid = da.defaclnamespace WHERE da.oid = p.objid)
               -- A TOAST relation is not an object in its own right: it lives in
               -- pg_toast but its CARRIER is the table whose reltoastrelid it is,
               -- and it is dropped and re-created with that table. Resolving it to
               -- its own namespace would report every varlena-carrying public table
               -- as a lost non-public dependent — MEASURED 2026-09-08, the first
               -- run of this assertion named `toast table pg_toast.pg_toast_16428`
               -- and rolled the whole restore back. Same carrier pattern as
               -- pg_trigger.tgrelid above, applied one class further.
               WHEN p.classid = 'pg_class'::regclass THEN (SELECT CASE WHEN c.relkind = 't' THEN (SELECT n2.nspname FROM pg_class o JOIN pg_namespace n2 ON n2.oid = o.relnamespace WHERE o.reltoastrelid = c.oid) ELSE n.nspname END FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.oid = p.objid)
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
    # ⛔ [Rule 1] PREFER THE `ERROR:` LINE. psql prefixes NOTICEs with the same
    # `psql:<file>:<line>: ` as errors, so a `^(psql:|ERROR:)` first-match reports
    # `NOTICE: drop cascades to N other objects` as the abort point — MEASURED
    # 2026-09-08 on the arm-7 and arm-9 falsifier runs. On the real TEST, whose
    # public has 190+ direct dependents, that NOTICE is emitted by the DROP on
    # EVERY abort, so the founder would be pointed at a cascade notice instead of
    # the error that actually stopped the restore. The psql-prefixed fallback keeps
    # a failure with no ERROR line from reporting nothing at all.
    local first
    first=$(grep -a -m1 -E '(^|: )ERROR:' "$RESTORE_OUT_DIR/transaction.out" || true)
    [ -n "$first" ] || first=$(grep -a -m1 -E '^psql:' "$RESTORE_OUT_DIR/transaction.out" || true)
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

# ===========================================================================
# --self-test — the REAL `--run` dispatch, against a THROWAWAY cluster.
#
# ⛔ IT NEVER TOUCHES TEST OR PROD. It `initdb`s its own cluster, listens on
# 127.0.0.1 only, and the EXIT trap stops and removes it in every outcome —
# success, failure and interrupt (the scripts/pg-lane/run.sh D-04 shape, whose
# measured cost when it was absent was 27 orphaned clusters and a disk-exhaustion
# incident).
#
# ── THE ARMS ────────────────────────────────────────────────────────────────
# Every arm runs the REAL `--run` dispatch. Every arm asserts an EXIT CODE **and**
# a NAMED OUTPUT LINE: a refusal that fires for the wrong reason exits 1 too, so
# an exit-only arm cannot tell a working guard from a broken one.
#
#    1  RED  credential absent                    9  GREEN restore, commits
#    2  RED  identity marker NULL                10  RED  survivor un-re-creatable
#    3  RED  identity marker names PROD          11  RED  expected shape mismatch
#    4  RED  baseline sha != BASELINE.md         12  GREEN unqualified survivor (B1)
#    5  RED  baseline stale vs migrations        13  RED  derived-census orphan (B2)
#    6  RED  shared-TEST mutex not held          14  ---- redaction check BITES
#    7  RED  publication row w/o its table       15  RED  unknown argv
#    8  GREEN preflight, rolls back              16  ---- harness calibration
#                                                17  RED  unresolvable object class
#                                                18  GREEN default ACL round-trips
#
# ── REDACTION IS A CHECK WITH A SUBJECT (T-164.8-05) ────────────────────────
# Every arm's combined output is captured, and after EVERY arm the harness greps
# that capture for a DSN shape and for dollar-quoted SQL. A hit FAILS the arm.
# That predicate is worthless unless something proves it can see a real leak, so
# arm 14 runs a scratch copy of this script that deliberately echoes the DSN and
# PASSES only when the grep FIRES. (Plan 01 shipped the capture and the
# failure-print mask; the check itself and its subject are this plan's.)
#
# ── WHAT IT PROVES, AND WHAT IT DOES NOT ────────────────────────────────────
# It proves the MECHANISM on a baseline-SHAPED fixture. It CANNOT replay the real
# dump: the pg-lane has no `pg_net` and no `supabase_vault`. Whether the real dump
# applies to hosted TEST is measured by `--mode preflight` inside a rolled-back
# transaction, against TEST itself (Plans 03/04).
# ===========================================================================

# ⛔ THE RATCHET. Introduced ONCE, at its final value, so it is never patched across
# plans and can be read off one place. Raise it only together with the arm that adds
# one; lowering it to make a run green is deleting a proof. Eighteen arms, each with
# a NAMED falsifier observed RED on a scratch copy, recorded in 164.8-02-SUMMARY.md.
# MEASURED 2026-09-08 — `--self-test` prints 18/18 and exits 0 on a throwaway cluster.
EXPECTED_ARMS=18

SELFTEST_MUTEX_HOLDER_PID=""
SELFTEST_TMPD=""
SELFTEST_PGD=""
SELFTEST_CREATED=""

selftest_cleanup() {
  status=$?
  if [ -n "$SELFTEST_MUTEX_HOLDER_PID" ]; then
    kill "$SELFTEST_MUTEX_HOLDER_PID" 2>/dev/null || true
    wait "$SELFTEST_MUTEX_HOLDER_PID" 2>/dev/null || true
  fi
  if [ -n "$SELFTEST_CREATED" ] && [ -n "$SELFTEST_PGD" ] && [ -d "$SELFTEST_PGD/data" ]; then
    if ! "$PGBIN/pg_ctl" -D "$SELFTEST_PGD/data" stop -m immediate -w >/dev/null 2>&1; then
      echo "WARNING: pg_ctl stop FAILED for the self-test cluster at $SELFTEST_PGD/data; a postmaster may be ORPHANED." >&2
      if [ -f "$SELFTEST_PGD/data/postmaster.pid" ]; then
        _pm_pid=$(head -n 1 "$SELFTEST_PGD/data/postmaster.pid" 2>/dev/null || true)
        case "$_pm_pid" in ''|*[!0-9]*) : ;; *) kill -9 "$_pm_pid" 2>/dev/null || true ;; esac
      fi
    fi
  fi
  if [ -n "$SELFTEST_TMPD" ] && [ -d "$SELFTEST_TMPD" ]; then rm -rf "$SELFTEST_TMPD"; fi
  exit "$status"
}

self_test() {
  local inverted="${1:-}"

  command -v node >/dev/null 2>&1 || fail "node is not on PATH; the self-test needs it for port allocation and the shared normalizer."
  [ -d "$FIXTURES" ] || fail "fixtures not found at ${FIXTURES}."

  # The normalizer, resolved to an ABSOLUTE path: the arms run the script with a
  # temp CWD-independent environment, and the scratch COPIES this harness builds
  # (arms 11 and 14) sit outside the repo.
  local norm="$NORMALIZER"
  [ -f "$norm" ] || norm="$SCRIPT_DIR/sql-body-normalize.mjs"
  [ -f "$norm" ] || fail "the shared normalizer was not found (tried '${NORMALIZER}' and '${SCRIPT_DIR}/sql-body-normalize.mjs'). Set NORMALIZER."
  norm="$(cd "$(dirname "$norm")" && pwd)/$(basename "$norm")"

  # Server binaries: ASK THE LANE which ones it would boot, rather than keeping a
  # second, divergent opinion (scripts/pg-lane/run.sh --print-pgbin, added for
  # exactly this reason). PGBIN in the environment wins, as it does for the lane.
  if [ -z "${PGBIN:-}" ]; then
    local cand
    for cand in "$SCRIPT_DIR/pg-lane/run.sh" "scripts/pg-lane/run.sh"; do
      if [ -f "$cand" ]; then PGBIN=$(bash "$cand" --print-pgbin) || fail "scripts/pg-lane/run.sh --print-pgbin could not resolve PostgreSQL server binaries."; break; fi
    done
  fi
  [ -n "${PGBIN:-}" ] || fail "could not locate scripts/pg-lane/run.sh to resolve PGBIN. Set PGBIN=<dir> explicitly."
  [ -x "$PGBIN/pg_ctl" ] || fail "PGBIN=$PGBIN has no executable pg_ctl"
  [ -x "$PGBIN/postgres" ] || fail "PGBIN=$PGBIN has pg_ctl but no \`postgres\` server binary — that is a CLIENT-only keg, not a server"
  export PATH="$PGBIN:$PATH"

  SELFTEST_TMPD="$(mktemp -d)"
  SELFTEST_PGD="$SELFTEST_TMPD/pgd"
  # Registered BEFORE initdb and at the top of the function, so every `fail` below
  # routes through one teardown path. INT/TERM go through EXIT.
  trap selftest_cleanup EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM

  local port
  port=$(node -e 'const s=require("net").createServer();s.listen(0,"127.0.0.1",()=>{const p=s.address().port;s.close(()=>console.log(p));});') \
    || fail "could not allocate a free port."
  if ! node -e 'const s=require("net").createServer();s.once("error",()=>process.exit(1));s.listen(Number(process.argv[1]),"127.0.0.1",()=>s.close(()=>process.exit(0)));' "$port" 2>/dev/null; then
    fail "something is already listening on 127.0.0.1:${port}. This self-test would DROP SCHEMA public on it. Refusing."
  fi

  mkdir -p "$SELFTEST_PGD"
  SELFTEST_CREATED=1
  initdb -D "$SELFTEST_PGD/data" -U postgres --auth=trust -E UTF8 >/dev/null
  # -k '' => TCP only; a unix socket under a scratch path blows the 103-byte limit.
  if ! pg_ctl -D "$SELFTEST_PGD/data" \
       -o "-p $port -c listen_addresses=127.0.0.1 -k ''" \
       -l "$SELFTEST_PGD/pg.log" -w start >/dev/null; then
    fail "pg_ctl could not start the self-test cluster on 127.0.0.1:${port} (see ${SELFTEST_PGD}/pg.log)"
  fi
  local i
  for i in $(seq 1 60); do pg_isready -h 127.0.0.1 -p "$port" -q 2>/dev/null && break; sleep 0.25; done
  pg_isready -h 127.0.0.1 -p "$port" -q 2>/dev/null || fail "the self-test cluster on 127.0.0.1:${port} never became ready (see ${SELFTEST_PGD}/pg.log)"

  local lane_db="restore_lane"
  local admin_dsn="postgresql://postgres@127.0.0.1:${port}/postgres"
  local lane_dsn="postgresql://postgres@127.0.0.1:${port}/${lane_db}"

  psql "$admin_dsn" -X -q -v ON_ERROR_STOP=1 \
    -c "CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;" >/dev/null

  # A BASELINE.md-shaped doc carrying the FIXTURE's real sha, in the same table-row
  # shape check-baseline-staleness.mjs's RECORDED_SHA_RE reads.
  local fixture_sha
  fixture_sha=$(shasum -a 256 "$FIXTURES/baseline-fixture.sql" | awk '{print $1}')
  write_selftest_doc() {
    {
      echo "# Self-test BASELINE doc (generated)"
      echo
      echo "| | |"
      echo "|---|---|"
      echo "| sha256 | \`${2}\` |"
    } > "$1"
  }
  write_selftest_doc "$SELFTEST_TMPD/BASELINE.md" "$fixture_sha"

  # Arm 4's doc: the SAME sha with its FIFTH character changed and nothing else.
  # Changing exactly one character inside the first 8 is what lets arm 4's
  # falsifier (compare only the first 4) be a real weakening rather than a rewrite.
  local bad_c5="0"
  [ "${fixture_sha:4:1}" = "0" ] && bad_c5="1"
  local bad_sha="${fixture_sha:0:4}${bad_c5}${fixture_sha:5}"
  [ "${#bad_sha}" -eq 64 ] || fail "MEASURE_FAIL: the arm-4 mutated sha is ${#bad_sha} chars, not 64 — BASELINE.md's sha row would not parse and arm 4 would fire for the wrong reason."
  [ "$bad_sha" != "$fixture_sha" ] || fail "MEASURE_FAIL: the arm-4 mutated sha equals the real one; arm 4 would be measuring nothing."
  write_selftest_doc "$SELFTEST_TMPD/BASELINE-bad.md" "$bad_sha"

  # The freshness seam. The fixtures are not the repo's baseline, so `git log` says
  # nothing useful about them; the GREEN stub answers the question the real path
  # asks (is the dump at least as fresh as the migrations?) with yes, the STALE
  # stub with no. Arm 5 is the RED one.
  cat > "$SELFTEST_TMPD/freshness.sh" <<'FRESHSTUB'
#!/usr/bin/env bash
case "$1" in
  *baseline-fixture.sql) echo 2000000000 ;;
  *) echo 1000000000 ;;
esac
FRESHSTUB
  cat > "$SELFTEST_TMPD/freshness-stale.sh" <<'FRESHSTUB'
#!/usr/bin/env bash
case "$1" in
  *baseline-fixture.sql) echo 1000000000 ;;
  *) echo 2000000000 ;;
esac
FRESHSTUB
  chmod +x "$SELFTEST_TMPD/freshness.sh" "$SELFTEST_TMPD/freshness-stale.sh"

  # ── the two SCRATCH COPIES the arms need ──────────────────────────────────
  # Both live under the harness's mktemp dir, never in the checkout, and both
  # assert their anchor was found: an awk that matched nothing would produce a
  # faithful copy and an arm that silently tests the unmutated script.
  local leaky_script="$SELFTEST_TMPD/leaky-restore.sh"
  awk '{ print }
       !d && index($0, "psql is not on PATH.") > 0 { print "  echo \"$RESTORE_DB_URL\"  # arm 14: a DELIBERATE leak, scratch copy only"; d = 1 }
       END { if (!d) { print "ANCHOR-NOT-FOUND" > "/dev/stderr"; exit 1 } }' "$0" > "$leaky_script" \
    || fail "MEASURE_FAIL: could not build arm 14's leaking scratch copy — the credential-assert anchor moved."
  grep -aq 'echo "\$RESTORE_DB_URL"' "$leaky_script" \
    || fail "MEASURE_FAIL: arm 14's scratch copy does not carry the injected leak, so the arm would assert the grep fires on a script that never leaks."

  local shape_script="$SELFTEST_TMPD/shape-plus-one.sh"
  awk '!d && index($0, "note \"expected shape from the dump text:") > 0 { print "  EXP_TABLES=$((EXP_TABLES + 1))  # arm 11: the EXPECTED derivation, mutated on a scratch copy"; d = 1 }
       { print }
       END { if (!d) { print "ANCHOR-NOT-FOUND" > "/dev/stderr"; exit 1 } }' "$0" > "$shape_script" \
    || fail "MEASURE_FAIL: could not build arm 11's shape-mismatch scratch copy — the derive_expected_shape anchor moved."
  grep -aq 'EXP_TABLES=\$((EXP_TABLES + 1))' "$shape_script" \
    || fail "MEASURE_FAIL: arm 11's scratch copy does not carry the mutated derivation."

  lane_q() { psql "$lane_dsn" -X -q -A -t -v ON_ERROR_STOP=1 -c "$1" | tr -d '[:space:]'; }

  # EVERY arm starts from a freshly loaded fixture: the restore arms MUTATE. An
  # optional OVERLAY (`fixtures/arm-<name>.sql`) is loaded on top, which is how a
  # single fixture serves eighteen arms without any of them seeing another's shape.
  fresh_db() {
    local overlay="${1:-}"
    release_mutex
    psql "$admin_dsn" -X -q -v ON_ERROR_STOP=1 \
      -c "DROP DATABASE IF EXISTS ${lane_db} WITH (FORCE);" \
      -c "CREATE DATABASE ${lane_db};" >/dev/null
    psql "$lane_dsn" -X -q -v ON_ERROR_STOP=1 -f "$FIXTURES/old-test.sql" >/dev/null
    if [ -n "$overlay" ]; then
      [ -f "$FIXTURES/arm-${overlay}.sql" ] \
        || { echo "MEASURE_FAIL: overlay ${FIXTURES}/arm-${overlay}.sql not found; the arm would run against the bare fixture and could pass for the wrong reason."; return 1; }
      psql "$lane_dsn" -X -q -v ON_ERROR_STOP=1 -f "$FIXTURES/arm-${overlay}.sql" >/dev/null
    fi
  }

  # The shared-TEST mutex, held the way .github/workflows/ci.yml's Acquire step
  # holds it: a BACKGROUND psql that takes pg_advisory_lock and then sleeps. The
  # script under test asserts the lock is held by SOMEONE ELSE; a lock it took
  # itself would vanish the moment it exited.
  hold_mutex() {
    : > "$SELFTEST_TMPD/holder.log"
    nohup psql "$lane_dsn" -X -q -A -t -v ON_ERROR_STOP=1 \
      -c "SET statement_timeout = 0;" \
      -c "SELECT pg_advisory_lock(${MUTEX_KEY});" \
      -c "SELECT 'MUTEX-ACQUIRED';" \
      -c "SELECT pg_sleep(600);" >> "$SELFTEST_TMPD/holder.log" 2>&1 &
    SELFTEST_MUTEX_HOLDER_PID=$!
    local j
    for j in $(seq 1 80); do
      grep -aq 'MUTEX-ACQUIRED' "$SELFTEST_TMPD/holder.log" && return 0
      sleep 0.25
    done
    echo "MEASURE_FAIL: the background mutex holder never reported MUTEX-ACQUIRED." >&2
    return 1
  }

  release_mutex() {
    if [ -n "$SELFTEST_MUTEX_HOLDER_PID" ]; then
      kill "$SELFTEST_MUTEX_HOLDER_PID" 2>/dev/null || true
      wait "$SELFTEST_MUTEX_HOLDER_PID" 2>/dev/null || true
      SELFTEST_MUTEX_HOLDER_PID=""
    fi
  }

  setup_lane() { fresh_db "${1:-}" && hold_mutex; }

  # ── the arm environment ───────────────────────────────────────────────────
  # Every value is a PREFIX assignment, so nothing leaks between arms. The four
  # ARM_* seams below are what individual arms override with `local` (dynamic
  # scope), so the default leg stays one expression that every arm shares.
  local ARM_BASELINE_DOC="$SELFTEST_TMPD/BASELINE.md"
  local ARM_FRESHNESS="bash $SELFTEST_TMPD/freshness.sh"
  local ARM_REQUIRE_MUTEX=1

  run_leg() {
    local script="$1" mode="$2" tag="$3"
    RESTORE_DB_URL="$lane_dsn" \
    BASELINE_FILE="$FIXTURES/baseline-fixture.sql" \
    BASELINE_DOC="$ARM_BASELINE_DOC" \
    MIGRATIONS_DIR="$FIXTURES/migrations" \
    NORMALIZER="$norm" \
    FRESHNESS_TS_CMD="$ARM_FRESHNESS" \
    RESTORE_OUT_DIR="$SELFTEST_TMPD/out-${tag}" \
    RESTORE_REQUIRE_MUTEX="$ARM_REQUIRE_MUTEX" \
      bash "$script" --run --mode "$mode"
  }
  arm_env() { run_leg "$0" "$1" "${2:-$1}"; }

  local pass=0 total=0
  local -a results=()

  # Per-arm knobs, reset by run_arm after every arm so one arm's exception cannot
  # silently become the next arm's.
  local ARM_OUT_PREFIX="arm"
  local ARM_EXPECT_LEAK=0
  local ARM_FORCE_INVERT=0

  # ⛔ `want` IS THE ARM'S VERDICT, NOT THE SCRIPT'S EXIT CODE — uniformly 0. Every
  # arm function returns 0 when the script behaved as DECLARED, and asserts the
  # script's own exit code (1 for a refusal, 0 for a green path) BY NAME inside
  # itself with a MEASURE_FAIL message, alongside the output line and the database
  # state. An arm that only compared exit codes could not tell a refusal that fired
  # for the right reason from one that fired for the wrong one.
  #
  # ⚠️ `${3-…}` style traps do not apply here — run_arm takes a command, not
  # optional strings. Copied from scripts/test-ledger-drift-check.sh:604-619
  # including the --expect-inverted flip (which turns want 0 into 1 and 1 into 0,
  # so a harness that has stopped discriminating is itself detectable).
  run_arm() {
    local label="$1" want="$2"
    shift 2
    total=$((total + 1))
    local out="$SELFTEST_TMPD/${ARM_OUT_PREFIX}-${total}.out"
    local rc=0
    ( "$@" ) > "$out" 2>&1 || rc=$?

    local want_leak="$ARM_EXPECT_LEAK"
    if [ "$inverted" = "--expect-inverted" ] || [ "$ARM_FORCE_INVERT" = "1" ]; then
      want=$(( want == 0 ? 1 : 0 ))
    fi
    if [ "$inverted" = "--expect-inverted" ]; then
      want_leak=$(( want_leak == 0 ? 1 : 0 ))
    fi

    # ⛔ THE REDACTION CHECK (T-164.8-05). This log is public. The arms' output is
    # CAPTURED rather than discarded precisely so this can run: a DSN would be a
    # credential in a public Actions log, and a dollar-quote would be a SQL body.
    # It is a CHECK over every arm, and arm 14 is its SUBJECT — without that arm
    # this would be a predicate nobody has ever seen fire.
    local leaked=0
    if grep -aqE 'postgres(ql)?://' "$out" || grep -aqE '\$[A-Za-z_0-9]*\$' "$out"; then leaked=1; fi

    if [ "$ARM_EXPECT_LEAK" = "1" ]; then
      # The leaking copy's capture is DELETED here, pass or fail: it contains a
      # real DSN and nothing downstream may print it.
      rm -f "$out"
    fi

    if [ "$leaked" -ne "$want_leak" ]; then
      if [ "$want_leak" = "1" ]; then
        results+=("  FAIL ${label} — the redaction grep did NOT fire on a script that echoes the DSN. The check is BLIND, so every other arm's redaction result is worthless.")
      else
        results+=("  FAIL ${label} — REDACTION: a DSN shape or dollar-quoted SQL reached this arm's captured output. Output withheld.")
      fi
      ARM_OUT_PREFIX="arm"; ARM_EXPECT_LEAK=0; ARM_FORCE_INVERT=0
      return 0
    fi

    if [ "$rc" -eq "$want" ]; then
      results+=("  ok   ${label} (exit ${rc})")
      pass=$((pass + 1))
    else
      results+=("  FAIL ${label} (exit ${rc}, expected ${want})")
      if [ "$ARM_EXPECT_LEAK" != "1" ]; then
        results+=("       ---- captured output, last 80 lines, DSN- and body-masked ----")
        local line
        while IFS= read -r line; do results+=("       ${line}"); done \
          < <(sed -E -e 's#postgres(ql)?://[^[:space:]]*#<dsn-redacted>#g' -e 's#\$[A-Za-z_0-9]*\$#<sql-body-redacted>#g' "$out" | tail -80)
      fi
    fi
    ARM_OUT_PREFIX="arm"; ARM_EXPECT_LEAK=0; ARM_FORCE_INVERT=0
  }

  # ═══ ARM 1 — the credential ════════════════════════════════════════════════
  # The raw leg, kept separate from the assertion so arm 16 can reuse it as a
  # command that is KNOWN to exit 1.
  arm_1_leg() {
    env -u RESTORE_DB_URL \
      BASELINE_FILE="$FIXTURES/baseline-fixture.sql" \
      BASELINE_DOC="$SELFTEST_TMPD/BASELINE.md" \
      MIGRATIONS_DIR="$FIXTURES/migrations" \
      NORMALIZER="$norm" \
      FRESHNESS_TS_CMD="bash $SELFTEST_TMPD/freshness.sh" \
      RESTORE_OUT_DIR="$SELFTEST_TMPD/out-arm1" \
      bash "$0" --run --mode preflight
  }
  arm_credential_absent() {
    local out="$SELFTEST_TMPD/a1.out" rc=0
    arm_1_leg > "$out" 2>&1 || rc=$?
    cat "$out"
    [ "$rc" -eq 1 ] || { echo "MEASURE_FAIL: expected exit 1 for an absent credential, got ${rc}"; return 1; }
    grep -aq 'RESTORE_DB_URL is required and is not set' "$out" \
      || { echo "MEASURE_FAIL: the refusal does not name RESTORE_DB_URL — the script stopped for some OTHER reason"; return 1; }
    grep -aq 'HARD FAILURE, not a skip' "$out" \
      || { echo "MEASURE_FAIL: the refusal does not say it is a hard failure rather than a skip"; return 1; }
    return 0
  }

  # ═══ ARM 2 — the identity marker is NULL ═══════════════════════════════════
  arm_marker_null() {
    setup_lane || return 1
    psql "$lane_dsn" -X -q -v ON_ERROR_STOP=1 -c "COMMENT ON DATABASE ${lane_db} IS NULL;" >/dev/null
    local out="$SELFTEST_TMPD/a2.out" rc=0
    arm_env preflight a2 > "$out" 2>&1 || rc=$?
    cat "$out"
    [ "$rc" -eq 1 ] || { echo "MEASURE_FAIL: a NULL identity marker exited ${rc}, expected 1"; return 1; }
    grep -aq 'identity marker is NULL' "$out" \
      || { echo "MEASURE_FAIL: the refusal does not name the NULL marker"; return 1; }
    local n
    n=$(lane_q "SELECT count(*) FROM pg_tables WHERE schemaname='public' AND tablename='e2e_leftover';")
    [ "$n" = "1" ] || { echo "MEASURE_FAIL: the stray table is gone (count=${n}) — the marker refusal did NOT fire before the first write."; return 1; }
    return 0
  }

  # ═══ ARM 3 — the identity marker names PROD ════════════════════════════════
  # The marker is written so it matches RESTORE_EXPECT_MARKER_RE **and**
  # RESTORE_REFUSE_MARKER_RE. A marker that failed the EXPECT test first would
  # exercise the wrong branch, and the PROD refusal would never be measured.
  arm_marker_prod() {
    setup_lane || return 1
    psql "$lane_dsn" -X -q -v ON_ERROR_STOP=1 \
      -c "COMMENT ON DATABASE ${lane_db} IS 'quantalyze TEST-shaped fixture that names PROD';" >/dev/null
    local out="$SELFTEST_TMPD/a3.out" rc=0
    arm_env preflight a3 > "$out" 2>&1 || rc=$?
    cat "$out"
    [ "$rc" -eq 1 ] || { echo "MEASURE_FAIL: a marker naming PROD exited ${rc}, expected 1"; return 1; }
    grep -aq 'it names PRODUCTION' "$out" \
      || { echo "MEASURE_FAIL: the refusal is not the PRODUCTION one — some other guard fired first, so the PROD branch is unmeasured"; return 1; }
    local n
    n=$(lane_q "SELECT count(*) FROM pg_tables WHERE schemaname='public' AND tablename='e2e_leftover';")
    [ "$n" = "1" ] || { echo "MEASURE_FAIL: the stray table is gone (count=${n}) — the PROD refusal did NOT fire before the first write."; return 1; }
    return 0
  }

  # ═══ ARM 4 — the dump is not the reviewed one ══════════════════════════════
  arm_sha_mismatch() {
    setup_lane || return 1
    local ARM_BASELINE_DOC="$SELFTEST_TMPD/BASELINE-bad.md"
    local out="$SELFTEST_TMPD/a4.out" rc=0
    arm_env preflight a4 > "$out" 2>&1 || rc=$?
    cat "$out"
    [ "$rc" -eq 1 ] || { echo "MEASURE_FAIL: a sha mismatch exited ${rc}, expected 1"; return 1; }
    grep -aq "${fixture_sha:0:8}" "$out" \
      || { echo "MEASURE_FAIL: the refusal does not carry the ACTUAL sha's first 8 chars (${fixture_sha:0:8})"; return 1; }
    grep -aq "${bad_sha:0:8}" "$out" \
      || { echo "MEASURE_FAIL: the refusal does not carry the RECORDED sha's first 8 chars (${bad_sha:0:8}) — it names only one side, so a reader cannot see which moved"; return 1; }
    return 0
  }

  # ═══ ARM 5 — the dump is stale against the migrations dir ══════════════════
  arm_stale_baseline() {
    setup_lane || return 1
    local ARM_FRESHNESS="bash $SELFTEST_TMPD/freshness-stale.sh"
    local out="$SELFTEST_TMPD/a5.out" rc=0
    arm_env preflight a5 > "$out" 2>&1 || rc=$?
    cat "$out"
    [ "$rc" -eq 1 ] || { echo "MEASURE_FAIL: a stale baseline exited ${rc}, expected 1"; return 1; }
    grep -aq 'baseline dump is STALE' "$out" || { echo "MEASURE_FAIL: the refusal is not the staleness one"; return 1; }
    grep -aq 'epoch 1000000000' "$out" || { echo "MEASURE_FAIL: the refusal does not name the baseline epoch"; return 1; }
    grep -aq '2000000000' "$out" || { echo "MEASURE_FAIL: the refusal does not name the migrations epoch — a reader cannot see which side is behind"; return 1; }
    return 0
  }

  # ═══ ARM 6 — the shared-TEST advisory mutex is not held ════════════════════
  # `fresh_db` releases the holder and this arm deliberately does NOT re-take it.
  arm_mutex_absent() {
    fresh_db || return 1
    local out="$SELFTEST_TMPD/a6.out" rc=0
    arm_env preflight a6 > "$out" 2>&1 || rc=$?
    cat "$out"
    [ "$rc" -eq 1 ] || { echo "MEASURE_FAIL: an unheld mutex exited ${rc}, expected 1"; return 1; }
    grep -aq "mutex (${MUTEX_KEY}) is not held" "$out" \
      || { echo "MEASURE_FAIL: the refusal does not report the shared-TEST mutex ${MUTEX_KEY} as unheld"; return 1; }
    local n
    n=$(lane_q "SELECT count(*) FROM pg_tables WHERE schemaname='public' AND tablename='e2e_leftover';")
    [ "$n" = "1" ] || { echo "MEASURE_FAIL: the stray table is gone (count=${n}) — the mutex refusal did NOT fire before the first write."; return 1; }
    return 0
  }

  # ═══ ARM 7 — a publication row for a table the dump does not re-create ═════
  arm_stray_publication() {
    setup_lane stray-publication || return 1
    local out="$SELFTEST_TMPD/a7.out" rc=0
    arm_env preflight a7 > "$out" 2>&1 || rc=$?
    cat "$out"
    [ "$rc" -eq 1 ] || { echo "MEASURE_FAIL: a publication row for an un-re-created table exited ${rc}, expected 1"; return 1; }
    # ⛔ THE LINE, not merely the exit. Without the pre-write check the transaction
    # runs and aborts INSIDE at the re-ADD with psql's own `relation ... does not
    # exist` — still exit 1, but with no remedy and after the DROP.
    grep -aq 'pub:public.e2e_leftover' "$out" \
      || { echo "MEASURE_FAIL: the refusal does not name pub:public.e2e_leftover"; return 1; }
    grep -aq 'ALTER PUBLICATION <pub> DROP TABLE public.<table>' "$out" \
      || { echo "MEASURE_FAIL: the refusal does not carry the founder remedy sentence"; return 1; }
    # PRE-WRITE, positively: the run must never have reached the transaction. The
    # survivor KEY is printed by the pre-census either way, so a grep for the key
    # alone cannot tell a pre-write refusal from an abort inside the transaction.
    if grep -aq 'transaction (mode=' "$out"; then
      echo "MEASURE_FAIL: the run REACHED the transaction — the publication row was not refused BEFORE the write, it aborted the restore from inside."
      return 1
    fi
    local n
    n=$(lane_q "SELECT count(*) FROM pg_tables WHERE schemaname='public' AND tablename='e2e_leftover';")
    [ "$n" = "1" ] || { echo "MEASURE_FAIL: the stray table is gone (count=${n}) — the publication refusal did NOT fire before the transaction."; return 1; }
    n=$(lane_q "SELECT count(*) FROM supabase_migrations.schema_migrations;")
    [ "$n" = "4" ] || { echo "MEASURE_FAIL: the ledger holds ${n} row(s), expected the fixture's 4 — the transaction ran."; return 1; }
    return 0
  }

  # ═══ ARM 8 — GREEN preflight: the whole transaction runs and ROLLS BACK ════
  arm_g_preflight() {
    setup_lane || return 1
    local out="$SELFTEST_TMPD/g-preflight.out"
    local rc=0
    arm_env preflight > "$out" 2>&1 || rc=$?
    cat "$out"
    [ "$rc" -eq 0 ] || { echo "MEASURE_FAIL: --run --mode preflight exited ${rc}, expected 0"; return 1; }
    grep -aq 'mode=preflight' "$out" || { echo "MEASURE_FAIL: the output does not carry 'mode=preflight'"; return 1; }
    grep -aq 'post-census == pre-census' "$out" || { echo "MEASURE_FAIL: the preflight did not report 'post-census == pre-census'"; return 1; }
    local n
    n=$(lane_q "SELECT count(*) FROM pg_tables WHERE schemaname='public' AND tablename='e2e_leftover';")
    [ "$n" = "1" ] || { echo "MEASURE_FAIL: the stray table public.e2e_leftover is GONE after a preflight (count=${n}). The rollback did not roll back."; return 1; }
    n=$(lane_q "SELECT count(*) FROM supabase_migrations.schema_migrations;")
    [ "$n" = "4" ] || { echo "MEASURE_FAIL: the ledger holds ${n} row(s) after a preflight, expected the fixture's 4."; return 1; }
    return 0
  }

  # ═══ ARM 9 — GREEN restore: the whole transaction runs and COMMITS ═════════
  arm_g_restore() {
    setup_lane || return 1
    local out="$SELFTEST_TMPD/g-restore.out"
    local rc=0
    arm_env restore > "$out" 2>&1 || rc=$?
    cat "$out"
    [ "$rc" -eq 0 ] || { echo "MEASURE_FAIL: --run --mode restore exited ${rc}, expected 0"; return 1; }
    grep -aqxF 'restore: tables=2 policies=1 functions=2 ledger_rows=3 survivors=3/3 filtered=1 mode=restore' "$out" \
      || { echo "MEASURE_FAIL: the exact summary line is absent from the output"; return 1; }
    local n
    n=$(lane_q "SELECT count(*) FROM pg_tables WHERE schemaname='public' AND tablename='e2e_leftover';")
    [ "$n" = "0" ] || { echo "MEASURE_FAIL: the stray table public.e2e_leftover survived the restore (count=${n})."; return 1; }
    n=$(lane_q "SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace s ON s.oid=c.relnamespace WHERE NOT t.tgisinternal AND s.nspname='auth' AND c.relname='users' AND t.tgname='on_auth_user_created';")
    [ "$n" = "1" ] || { echo "MEASURE_FAIL: survivor class (a) LOST — auth.users:on_auth_user_created is absent after the restore (count=${n})."; return 1; }
    n=$(lane_q "SELECT count(*) FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='qualified_ref';")
    [ "$n" = "1" ] || { echo "MEASURE_FAIL: survivor class (b) LOST — storage.objects:qualified_ref is absent after the restore (count=${n})."; return 1; }
    n=$(lane_q "SELECT count(*) FROM pg_publication_tables WHERE schemaname='public' AND tablename='fx_keep';")
    [ "$n" = "1" ] || { echo "MEASURE_FAIL: survivor class (c) LOST — the realtime publication row for public.fx_keep is absent after the restore (count=${n})."; return 1; }
    n=$(lane_q "SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version !~ '^[0-9]{14}\$';")
    [ "$n" = "0" ] || { echo "MEASURE_FAIL: ${n} seeded ledger row(s) carry a version that is not the 14-digit filename prefix."; return 1; }
    n=$(lane_q "SELECT string_agg(version || '|' || name, ' ' ORDER BY version) FROM supabase_migrations.schema_migrations;")
    [ "$n" = "20260101000000|fixture_a20260102000000|fixture_b20260103000000|fixture_c" ] \
      || { echo "MEASURE_FAIL: the seeded ledger is '${n}', not the three fixture files with description-only names."; return 1; }
    n=$(lane_q "SELECT count(*) FROM supabase_migrations.schema_migrations WHERE statements[1] LIKE '%was NOT executed on TEST';")
    [ "$n" = "3" ] || { echo "MEASURE_FAIL: only ${n} of 3 seeded rows carry the provenance sentence; a seed that claims the SQL ran is a lie."; return 1; }
    return 0
  }

  # ═══ ARM 10 — a CENSUSED survivor that cannot be RE-CREATED ════════════════
  arm_unrecreatable_survivor() {
    setup_lane unrecreatable-trigger || return 1
    local out="$SELFTEST_TMPD/a10.out" rc=0
    arm_env restore a10 > "$out" 2>&1 || rc=$?
    cat "$out"
    [ "$rc" -eq 1 ] || { echo "MEASURE_FAIL: a survivor that cannot be re-created exited ${rc}, expected 1"; return 1; }
    grep -aq 'auth.users:on_auth_user_absent' "$out" \
      || { echo "MEASURE_FAIL: the run never names the survivor auth.users:on_auth_user_absent"; return 1; }
    grep -aq 'fx_absent' "$out" \
      || { echo "MEASURE_FAIL: the abort does not name the missing function public.fx_absent — the transaction stopped for some OTHER reason"; return 1; }
    local n
    n=$(lane_q "SELECT count(*) FROM pg_tables WHERE schemaname='public' AND tablename='e2e_leftover';")
    [ "$n" = "1" ] || { echo "MEASURE_FAIL: the stray table is gone (count=${n}) — the transaction COMMITTED a half-restored database instead of rolling back."; return 1; }
    return 0
  }

  # ═══ ARM 11 — the expected SHAPE disagrees with what the replay produced ═══
  # ⛔ THE MUTATION IS ON THE **EXPECTED** SIDE, on a scratch copy, and NOT on the
  # dump. The expected shape is DERIVED FROM THE DUMP TEXT while the database is
  # built BY REPLAYING THAT SAME DUMP, so an extra CREATE TABLE line in a dump copy
  # raises expected and actual EQUALLY and the assertion cannot fire — measured
  # self-contradictory at plan-check iteration 2 and recorded so it is not
  # reintroduced.
  arm_shape_mismatch() {
    setup_lane || return 1
    local out="$SELFTEST_TMPD/a11.out" rc=0
    run_leg "$shape_script" restore a11 > "$out" 2>&1 || rc=$?
    cat "$out"
    [ "$rc" -eq 1 ] || { echo "MEASURE_FAIL: an expected-shape mismatch exited ${rc}, expected 1"; return 1; }
    grep -aq 'table(s) after the replay, expected 3' "$out" \
      || { echo "MEASURE_FAIL: the abort does not report the TABLE count against the mutated expectation of 3"; return 1; }
    grep -aq 'public holds 2 table(s)' "$out" \
      || { echo "MEASURE_FAIL: the abort does not report the ACTUAL count of 2 — a reader cannot see which side moved"; return 1; }
    local n
    n=$(lane_q "SELECT count(*) FROM pg_tables WHERE schemaname='public' AND tablename='e2e_leftover';")
    [ "$n" = "1" ] || { echo "MEASURE_FAIL: the stray table is gone (count=${n}) — a wrong shape COMMITTED instead of rolling back."; return 1; }
    return 0
  }

  # ═══ ARM 12 (B1) — a survivor whose stored expression carries no `public.` ══
  arm_unqualified_survivor() {
    setup_lane unqualified-policy || return 1
    local out="$SELFTEST_TMPD/a12.out" rc=0
    arm_env restore a12 > "$out" 2>&1 || rc=$?
    cat "$out"
    [ "$rc" -eq 0 ] || { echo "MEASURE_FAIL: the unqualified-survivor restore exited ${rc}, expected 0 — the census lost it and the derived closure aborted"; return 1; }
    grep -aqxF 'restore: tables=2 policies=1 functions=2 ledger_rows=3 survivors=4/4 filtered=1 mode=restore' "$out" \
      || { echo "MEASURE_FAIL: the summary line does not report survivors=4/4 — the fourth survivor was never censused"; return 1; }
    local n
    n=$(lane_q "SELECT count(*) FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='unqualified_ref';")
    [ "$n" = "1" ] || { echo "MEASURE_FAIL: the unqualified policy is absent after the restore (count=${n}) — B1 exactly: rendered under the default search_path it never entered the census."; return 1; }
    return 0
  }

  # ═══ ARM 13 (B2) — a dependent of a class no hand-listed census knows ══════
  arm_derived_census_orphan() {
    setup_lane orphan-view || return 1
    local out="$SELFTEST_TMPD/a13.out" rc=0
    arm_env restore a13 > "$out" 2>&1 || rc=$?
    cat "$out"
    [ "$rc" -eq 1 ] || { echo "MEASURE_FAIL: an unlisted dependent exited ${rc}, expected 1 — this is the SILENT COMMIT of plan 01's NEUTER 2"; return 1; }
    grep -aq 'analytics.v_leftover' "$out" \
      || { echo "MEASURE_FAIL: the abort does not NAME the lost dependent"; return 1; }
    grep -aq 'NOT a censused survivor' "$out" \
      || { echo "MEASURE_FAIL: the abort is not the derived-census closure's"; return 1; }
    local n
    n=$(lane_q "SELECT count(*) FROM pg_views WHERE schemaname='analytics' AND viewname='v_leftover';")
    [ "$n" = "1" ] || { echo "MEASURE_FAIL: analytics.v_leftover is GONE (count=${n}) — it was CASCADE-dropped and the transaction committed anyway."; return 1; }
    n=$(lane_q "SELECT count(*) FROM pg_tables WHERE schemaname='public' AND tablename='e2e_leftover';")
    [ "$n" = "1" ] || { echo "MEASURE_FAIL: the stray table is gone (count=${n}) — the transaction did not roll back."; return 1; }
    return 0
  }

  # ═══ ARM 14 — the redaction check has a SUBJECT (W2) ═══════════════════════
  # A scratch copy that echoes the DSN straight after the credential assert. The
  # arm passes ONLY if run_arm's redaction grep FIRES on its captured output;
  # run_arm deletes that capture afterwards, pass or fail.
  arm_redaction_subject() {
    setup_lane || return 1
    run_leg "$leaky_script" preflight a14
  }

  # ═══ ARM 15 — unknown argv is a refusal, never a default ═══════════════════
  arm_unknown_argv() {
    local out="$SELFTEST_TMPD/a15.out" rc=0
    RESTORE_DB_URL="$lane_dsn" bash "$0" --run --frobnicate > "$out" 2>&1 || rc=$?
    cat "$out"
    [ "$rc" -eq 1 ] || { echo "MEASURE_FAIL: an unknown argument exited ${rc}, expected 1"; return 1; }
    grep -aq 'unknown argument' "$out" \
      || { echo "MEASURE_FAIL: the refusal does not say the argument is unknown — a typo'd flag was swallowed and some other branch reported"; return 1; }
    grep -aq -- '--frobnicate' "$out" \
      || { echo "MEASURE_FAIL: the refusal does not echo the offending argument"; return 1; }
    return 0
  }

  # ═══ ARM 16 — the harness itself can report a FAILURE ══════════════════════
  # ⛔ WITHOUT THIS ARM every `ok` above is a claim about a harness nobody has seen
  # say no. Both halves run `run_arm` in a SUBSHELL so their tallies cannot reach
  # the real ones, on arm 1's leg — a command KNOWN to exit 1 — declared want 0.
  arm_harness_calibration() {
    local flipped plain
    flipped=$( total=0; pass=0; results=(); ARM_OUT_PREFIX="calib-flip"; ARM_FORCE_INVERT=1
               run_arm "calib" 0 arm_1_leg; printf '%s\n' "${results[@]}" )
    plain=$(   total=0; pass=0; results=(); ARM_OUT_PREFIX="calib-plain"; ARM_FORCE_INVERT=0
               run_arm "calib" 0 arm_1_leg; printf '%s\n' "${results[@]}" )
    echo "calibration, flip ON  -> ${flipped}"
    echo "calibration, flip OFF -> $(printf '%s' "$plain" | head -1)"
    case "$flipped" in
      *"  ok   calib"*) ;;
      *) echo "MEASURE_FAIL: with the flip the harness did not report ok for a command that exits 1 against want 0 — --expect-inverted no longer inverts."; return 1 ;;
    esac
    case "$plain" in
      *"  FAIL calib"*) ;;
      *) echo "MEASURE_FAIL: WITHOUT the flip the harness did not report FAIL for a command that exits 1 against want 0. run_arm has stopped discriminating and every ok in this run is worthless."; return 1 ;;
    esac
    return 0
  }

  # ═══ ARM 17 — an object of a class the whitelist does NOT resolve ══════════
  # The tripwire that makes the refclassid whitelist CLOSED BY MEASUREMENT: the
  # classes it excludes are asserted empty on the LIVE database, inside the
  # transaction, BEFORE the DROP.
  arm_unresolvable_class() {
    setup_lane public-operator || return 1
    local out="$SELFTEST_TMPD/a17.out" rc=0
    arm_env restore a17 > "$out" 2>&1 || rc=$?
    cat "$out"
    [ "$rc" -eq 1 ] || { echo "MEASURE_FAIL: an unresolvable object class exited ${rc}, expected 1"; return 1; }
    grep -aq 'whitelist does not resolve' "$out" \
      || { echo "MEASURE_FAIL: the abort is not the whitelist-emptiness assertion's — some later guard fired, so the whitelist is still assumed rather than measured"; return 1; }
    grep -aq 'pg_operator' "$out" \
      || { echo "MEASURE_FAIL: the abort does not NAME the class pg_operator"; return 1; }
    grep -aq 'public holds 1 object(s) of class' "$out" \
      || { echo "MEASURE_FAIL: the abort does not report HOW MANY objects of the class were found"; return 1; }
    local n
    n=$(lane_q "SELECT count(*) FROM pg_operator WHERE oprnamespace='public'::regnamespace;")
    [ "$n" = "1" ] || { echo "MEASURE_FAIL: the operator is gone (count=${n}) — it was CASCADE-dropped and never re-created."; return 1; }
    n=$(lane_q "SELECT count(*) FROM pg_tables WHERE schemaname='public' AND tablename='e2e_leftover';")
    [ "$n" = "1" ] || { echo "MEASURE_FAIL: the stray table is gone (count=${n}) — the assertion did not fire before DROP SCHEMA public CASCADE."; return 1; }
    return 0
  }

  # ═══ ARM 18 — a default ACL on public ROUND-TRIPS instead of falsely aborting ═
  arm_default_acl() {
    setup_lane default-acl || return 1
    local n
    n=$(lane_q "SELECT count(*) FROM pg_default_acl WHERE defaclnamespace='public'::regnamespace;")
    [ "$n" = "1" ] || { echo "MEASURE_FAIL: the overlay did not create a default ACL on public (count=${n}); the arm would prove nothing."; return 1; }
    local out="$SELFTEST_TMPD/a18.out" rc=0
    arm_env restore a18 > "$out" 2>&1 || rc=$?
    cat "$out"
    [ "$rc" -eq 0 ] || { echo "MEASURE_FAIL: a default ACL on public exited ${rc}, expected 0. Without the pg_default_acl CARRIER branch the closure cannot resolve its owning schema and ABORTS naming an object the dump WOULD have restored — a FALSE abort that stops the first real preflight."; return 1; }
    grep -aqxF 'restore: tables=2 policies=1 functions=2 ledger_rows=3 survivors=3/3 filtered=1 mode=restore' "$out" \
      || { echo "MEASURE_FAIL: the exact summary line is absent — a default ACL must not change the survivor accounting"; return 1; }
    n=$(lane_q "SELECT count(*) FROM pg_default_acl WHERE defaclnamespace='public'::regnamespace;")
    [ "$n" = "1" ] || { echo "MEASURE_FAIL: the default ACL is absent after the restore (count=${n}) — the dump's ALTER DEFAULT PRIVILEGES line did not replay, so this arm's premise is broken."; return 1; }
    return 0
  }

  run_arm "1  RED   credential absent — a missing DSN is a hard failure, never a skip" 0 arm_credential_absent
  run_arm "2  RED   identity marker NULL — refused before any write" 0 arm_marker_null
  run_arm "3  RED   identity marker names PROD — refused, loudly" 0 arm_marker_prod
  run_arm "4  RED   baseline sha != BASELINE.md — the dump on disk is unattested" 0 arm_sha_mismatch
  run_arm "5  RED   baseline STALE against the migrations dir" 0 arm_stale_baseline
  run_arm "6  RED   shared-TEST advisory mutex not held" 0 arm_mutex_absent
  run_arm "7  RED   publication row for a table the dump does not re-create (W3)" 0 arm_stray_publication
  run_arm "8  GREEN preflight — the transaction runs and rolls back, the database is byte-identical" 0 arm_g_preflight
  run_arm "9  GREEN restore — the transaction runs and commits, all three survivor classes round-trip" 0 arm_g_restore
  run_arm "10 RED   a censused survivor cannot be re-created — abort INSIDE the transaction" 0 arm_unrecreatable_survivor
  run_arm "11 RED   expected shape mismatch (mutated EXPECTED derivation, scratch copy)" 0 arm_shape_mismatch
  run_arm "12 GREEN unqualified-reference survivor round-trips (B1)" 0 arm_unqualified_survivor
  run_arm "13 RED   derived pg_depend census names an unlisted dependent (B2)" 0 arm_derived_census_orphan
  ARM_EXPECT_LEAK=1
  run_arm "14 ----- the redaction check BITES on a deliberately leaking scratch copy (W2)" 0 arm_redaction_subject
  run_arm "15 RED   unknown argv is a refusal, never a default" 0 arm_unknown_argv
  run_arm "16 ----- harness calibration: run_arm can report FAIL, and the flip inverts" 0 arm_harness_calibration
  run_arm "17 RED   an object class the derived-census whitelist does not resolve" 0 arm_unresolvable_class
  run_arm "18 GREEN a default ACL on public round-trips instead of falsely aborting" 0 arm_default_acl

  release_mutex

  printf '%s\n' "${results[@]}"
  echo "${GATE}: self-test OK (${pass}/${EXPECTED_ARMS} arms — seven refusals fire before any write, preflight rolls back byte-for-byte, restore commits the full shape, survivors round-trip search_path-independently, the derived census names an unlisted dependent, redaction is checked with a subject, the census whitelist refuses an unresolvable class, default ACLs round-trip, harness calibrated)"
  if [ "$total" -ne "$EXPECTED_ARMS" ]; then
    echo "SELF-TEST FAIL: ${total} arms ran but EXPECTED_ARMS is ${EXPECTED_ARMS}. An arm that disappeared is a RED, not a smaller PASSED."
    return 1
  fi
  if [ "$pass" -ne "$total" ]; then
    echo "SELF-TEST FAIL: ${pass}/${total} arms behaved as declared."
    return 1
  fi
  return 0
}

main "$@"
