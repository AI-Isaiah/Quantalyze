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
#   REFDATA_ALLOWLIST         default scripts/restore-test-refdata-allowlist.txt —
#                             the migration-seeded statements the restore replays
#                             (Phase 164.8.1). An EMPTY allowlist is refused.
#   REFDATA_EXTRACTOR         default scripts/extract-reference-inserts.mjs; run
#                             TWICE — once to refuse before any write, once inside
#                             `build_transaction` to emit refdata.sql
#   REFDATA_KIND_REGISTRY     default public.compute_job_kinds
#   REFDATA_KIND_REGISTRY_COL default name (measured; NOT `kind`)
#   REFDATA_KIND_CHECK        default compute_jobs_kind_check
#                             ⛔ THOSE LAST THREE REACH SQL TWICE EACH — as bare
#                             identifiers AND inside string literals — in the
#                             in-transaction partial-replay gate. That is why each
#                             is CHARSET-REFUSED before any interpolation and
#                             `sql_lit`-quoted at every literal site (W1, T-164.8-04),
#                             and why they are seams at all: an invariant no arm
#                             exercises is decorative, so the self-test points them
#                             at `fx_keep_kind_check` over `public.fx_keep`.`label`.
#   PGBIN                     (self-test only) server binaries for the throwaway lane
#
# ⚠️ psql's STDERR IS printed for the transaction — and it does NOT only name SQL
# objects. A connect or auth failure names the HOST, its IP and the DB user; the
# calling workflow says so in its own comment
# (.github/workflows/test-restore-from-baseline.yml:659). What keeps that out of a
# world-readable log is the workflow's REDACTION step, not any property of psql.
# Two consequences, both deliberate: the DSN itself is never echoed by this script,
# and the identity-marker read sends its stderr to a FILE rather than into the
# value it judges or into the log (refusal 5).
#
# ── WHAT --self-test PROVES, AND WHAT IT DOES NOT ───────────────────────────
# It boots a THROWAWAY PostgreSQL cluster the `scripts/pg-lane/run.sh` way and runs
# the REAL `--run` dispatch against it. It never touches TEST or PROD.
#
# IT PROVES THE MECHANISM. The arm COUNT is the constant `EXPECTED_ARMS` below and
# nowhere else — no numeral in this header restates it, because a numeral in prose
# drifts the moment an arm is added and there is nothing to catch it. To read the
# live tally, run the command:
#
#   bash scripts/restore-test-from-baseline.sh --self-test
#
# and read its own closing line. WHAT the arms prove: every refusal that fires
# before a write, and every BRANCH of every one of them; a preflight whose rollback
# is measured byte-for-byte; a restore that commits the full shape; three survivor
# classes that round-trip, INCLUDING a trigger's enabled-state; a fourth class the
# derived census names and aborts on, with a full census AND with an empty one; a
# redaction check with a subject; a whitelist tripwire; a default ACL that
# round-trips; and a calibration arm proving the harness can say no. The full table,
# with the arms that carry more than one leg, is beside `EXPECTED_ARMS` below.
# Every arm has a NAMED falsifier that was observed RED and then restored from a
# byte backup; the record is `164.8-02-SUMMARY.md` and this phase's review-fix
# report.
#
# ⛔ IT DOES NOT PROVE THAT THE REAL DUMP APPLIES. The pg-lane has no `pg_net` and
# no `supabase_vault`, so `supabase/schema/baseline.sql` CANNOT replay on it; every
# arm above runs against a baseline-SHAPED FIXTURE. Whether the real dump applies
# to hosted TEST is a separate question, and the only honest way to answer it is
# `--mode preflight` against TEST itself, inside a transaction that rolls back
# (Plans 03/04). A green self-test is evidence about this script, never about TEST.
#
# ⛔ THE CLOSING LINE IS NOT RESTATED HERE. It used to be pasted in verbatim, which
# made this header a SECOND copy of a string only one place emits — the drift class
# that left a seven-rule linter documented as "four static rules" for three rules'
# worth of releases. The line is emitted by the `echo` at the end of `self_test`,
# it prints ONLY after both failure checks have passed, and the way to read it is
# to run the command:
#
#   bash scripts/restore-test-from-baseline.sh --self-test
#
# ⚠️ NOTHING GREPS IT. The workflow step (test-restore-from-baseline.yml:412) runs
# the command and judges its EXIT CODE; the only repo-wide match for the line's
# text is a SOURCE-text assertion in `src/__tests__/restore-test-from-baseline.test.ts`.
# Do not add a grep gate on it either — a grep on a success sentence is a gate that
# passes whenever the sentence is printed, which is the failure mode A4 removed.
#
# ── TWO DESIGN CHOICES THAT LOOK LIKE HYGIENE AND ARE NOT ───────────────────
# B1 — the census runs under `SET search_path = pg_catalog` because Postgres does
# not store the SOURCE TEXT of an expression. It stores a PARSE TREE in which the
# function is already resolved to an oid, and `pg_get_expr` / `pg_get_triggerdef`
# RE-RENDER that tree against the READER's search_path, omitting the qualifier of
# anything the reader can reach unqualified. So under psql's default
# `"$user", public` a QUALIFIED source and an UNQUALIFIED source deparse
# IDENTICALLY — both without `public.` — and a census that substring-matches
# `public.` sees NEITHER. How the source spelled it is irrelevant. With only
# pg_catalog on the path every public reference renders qualified, so the match
# finds it; without the SET it is never censused, is CASCADE-dropped, and a
# pre/post key-set comparison agrees on a set that excludes it.
#
# B2 — the closure reads `pg_depend` and not the `drop cascades to` NOTICEs because
# that channel truncates at 100 dependents (MAX_REPORTED_DEPS) and the real `public`
# has 190+, so the survivors would be cut off the list — and a check that reads the
# CASCADE's output necessarily runs after the drop, too late to refuse.
#
# ── THIS LOG IS PUBLIC ──────────────────────────────────────────────────────
# The repo is public and Actions logs are world-readable.
#
# WHAT IS ENFORCED: no DSN and no password, ever. The identity marker's TEXT is
# withheld even when it is the reason for a refusal, and psql's stderr from the
# marker read goes to a file rather than to the log. `--self-test` enforces the DSN
# rule on itself — every arm's captured output is grepped for a DSN shape and for
# dollar-quoted SQL, and arm 14 proves that grep fires on a real leak.
#
# ⛔ WHAT IS **NOT** TRUE, AND USED TO BE CLAIMED HERE: that this script prints
# "NAMES AND COUNTS … NEVER a SQL body". It prints SQL bodies. The survivors census
# emits column 4 of every survivor row as full DDL — `pg_get_triggerdef(...)` and a
# reconstructed `CREATE POLICY … USING (<qual>) WITH CHECK (<qual>)` — and
# `run_restore` cats the WHOLE pre-census, that column included, to stdout. A policy
# USING expression IS a SQL body, and on the real TEST those expressions name
# tables, columns and role predicates. The honest statement is the narrow one above
# plus the workflow's redaction step; do not restore the broad claim, and do not
# rely on it. Narrowing these cats is BOOKED as threat T-164.8-21 in plan 05 —
# print survivor KEYS here and leave the DDL in `survivors.sql` inside the
# artifact. It is NOT closed by the workflow's redaction step, which covers the
# artifact's channel files before upload and never touches this stdout.
# ⭐ 2026-09-09 (Phase 164.8.2, WR-05): T-164.8-21 IS NOW HALF CLOSED, and only half.
# The ARTIFACT half is done, by the workflow's `Stage the public artifact (enumerated
# allowlist; default-out)` step: `pre-census.txt`, `post-census.txt` and both
# `*-rollback-view.txt` files no longer ship, while `survivors.sql` does — the intent
# quoted above, implemented. The STDOUT half is UNCHANGED and still booked: this script
# still cats the WHOLE pre-census, DDL column included, to the public Actions log, and
# no staging step can reach that.
#
# ⭐ 2026-09-10 (Phase 164.8.2 review-fix): AND THE FOUR STAGED `.sql` FILES ARE NOW
# SCANNED — by `refuse_credential_in_published_sql`, between `build_transaction`
# and `run_transaction`, so a hit refuses with the database untouched. The FILE SET
# is unchanged and is not up for re-narrowing: admitting `census.sql`,
# `survivors.sql`, `restore.sql` and `refdata.sql` is a founder decision and is
# already narrower than what it replaced. What was missing was that NOTHING asserted
# they were credential-free — the workflow's redaction step runs before this script
# writes them, and `--self-test`'s redaction grep reads an arm's captured OUTPUT, not
# these files. The scan covers the SAME SIX CLASSES the artifact's own README names
# (DSN, supabase host, project ref, the `connect` meta-command, ALTER DATABASE, JWT),
# so the code and that README's claim agree. Deliberate SQL BODIES in `survivors.sql`
# remain in scope of T-164.8-21 above — the dollar-quote half of the ARM redaction
# check is the one predicate not applied here, because these files are SQL.
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
# ⛔ A SECOND, QUIETER LOSS: `supabase_migrations.schema_migrations.statements`.
# The ledger re-seed below TRUNCATEs the table and writes ONE prose provenance
# sentence into `statements` for every row. That column held the SQL each
# migration was actually applied to TEST with — the repo's documented way of
# settling repo-vs-remote body drift "by reading, not by dating", and the only
# record of any row hand-applied to TEST outside a committed migration. After a
# restore it is gone for good: nothing repopulates it, and VAC-08 does not read
# it, so nothing turns red to tell you. The workflow's backup artifact keeps
# `ledger.csv` byte-exact, so the ONLY surviving copy is that artifact — which
# expires after 90 days. The backup README.txt's "WHAT CANNOT BE REVERSED" block
# names this loss too, beside the data one, so the artifact carries the warning.
#
# TEST is SHARED with other people's CI and we cannot see their runs. That is why
# `--mode restore` is founder-executed or founder-approved AT THE MOMENT OF
# EXECUTION, never an unattended job (CONTEXT safety rule 4).
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
GATE="restore-test-from-baseline"
FIXTURES="$SCRIPT_DIR/restore-test-from-baseline-fixtures"

# The shared-TEST advisory mutex key.
#
# ⭐ WHO ACTUALLY TAKES IT — MEASURED 2026-09-08, not remembered. Regenerate with:
#
#   grep -c 'pg_advisory_lock(61616158)' .github/workflows/*.yml
#
# FOUR workflows CALL it (re-measured 2026-09-09; it was three until the TEST-first
# apply landed): `ci.yml` (3 call sites), `mutex-probe.yml` (3),
# `test-restore-from-baseline.yml` (1 — the Acquire step this script runs inside)
# and `supabase-migrate.yml` (1).
#
# ⛔ THE NEW TAKER IS THE MOST CONSEQUENTIAL ONE. `supabase-migrate.yml`'s
# `apply-test` job holds this key while it runs `supabase db push` AGAINST SHARED
# TEST — a migration APPLY, not a read. This paragraph is the reader's answer to
# "who else can be writing to TEST while this restore holds the lock", so it is
# safety-relevant and dated on purpose: re-run the grep above rather than trusting
# the sentence (review finding WR-08).
# ⚠️ `analytics-deploy-verify.yml` matches the INTEGER twice and calls it ZERO
# times (a comment at :93 and an issue-body string at :178), and
# `main-ci-cancelled-watcher.yml` does not contain the integer at all. This comment
# named both of them as takers until the grep above was run.
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

# ── REFERENCE DATA (Phase 164.8.1) ─────────────────────────────────────────
# ⛔ WHY THE RESTORE REPLAYS ROWS AT ALL. LEDGER PRESENCE IS NOT EFFECT PRESENCE.
# `supabase/schema/baseline.sql` is SCHEMA-ONLY (562 GRANT/REVOKE, zero
# INSERT/COPY), and the seed below writes one ledger row per repo migration file.
# So without this replay every migration reads as applied while every row those
# migrations INSERTed is gone — `compute_job_kinds` empty behind a ledger swearing
# its seed migration ran. `scripts/restore-test-refdata-allowlist.txt` names the
# statements that have to come back; `scripts/extract-reference-inserts.mjs` turns
# that list into SQL and REFUSES anything it cannot prove safe.
REFDATA_ALLOWLIST="${REFDATA_ALLOWLIST:-scripts/restore-test-refdata-allowlist.txt}"
REFDATA_EXTRACTOR="${REFDATA_EXTRACTOR:-scripts/extract-reference-inserts.mjs}"

# ⛔ W1 — THESE THREE ARE SEAMS BECAUSE AN INVARIANT NO ARM EXERCISES IS
# DECORATIVE. The gate's second leg refuses a PARTIAL replay: a kind-admission
# CHECK that admits a value its registry table does not carry. On the real
# database that pair is `compute_jobs_kind_check` (a flat `kind = ANY (ARRAY[…])`
# list) over `public.compute_job_kinds`, whose registry column is `name` and NOT
# `kind` (supabase/migrations/20260411144407_compute_jobs_queue.sql:86-88 —
# measured, not remembered; a leg written against `kind` would error rather than
# refuse).
#
# ⚠️ THE CHECK'S AUTHORITY IS THE SHIPPED CONSTRAINT, NOT A MIGRATION PICKED AT
# RANDOM. Five migrations re-declare `compute_jobs_kind_check` with
# `ALTER TABLE compute_jobs ADD CONSTRAINT …`, and this repo's re-base rule says
# the LATEST declaration wins. MEASURED 2026-09-09: latest is
# supabase/migrations/20260717233529_allocator_equity_derived_surface.sql:140 and
# the shipped shape is supabase/schema/baseline.sql:1334, carrying SIXTEEN kinds
# (… 'stitch_composite', 'derive_allocator_equity'). This comment cited
# 20260710130000_stitch_composite_kind.sql:53 until 2026-09-09; that declaration
# was SUPERSEDED and carries FIFTEEN — one short — so a reader checking the leg
# against it would have measured the wrong list.
# Neither object exists on the throwaway lane, so pointed at its defaults the leg
# would be a permanent no-op there and could never be observed firing. The
# self-test points them at `fx_keep_kind_check` over `public.fx_keep`.`label`,
# which baseline-fixture.sql carries for exactly this reason, and arm 23 leg (c)
# makes the leg RAISE.
REFDATA_KIND_REGISTRY="${REFDATA_KIND_REGISTRY:-public.compute_job_kinds}"
REFDATA_KIND_REGISTRY_COL="${REFDATA_KIND_REGISTRY_COL:-name}"
REFDATA_KIND_CHECK="${REFDATA_KIND_CHECK:-compute_jobs_kind_check}"

OWNED_OUT_DIR=""
cleanup_out_dir() {
  status=$?
  if [ -n "$OWNED_OUT_DIR" ] && [ -d "$OWNED_OUT_DIR" ]; then rm -rf "$OWNED_OUT_DIR"; fi
  exit "$status"
}

# psql against the target. -X so no ~/.psqlrc, -A -t so the output is a stable
# byte stream, ON_ERROR_STOP so a failed statement is exit 3 and not a silent skip.
# (scripts/test-ledger-drift-check.sh:140-141 is the same shape — MEASURED
# 2026-09-08: :140 is the `psql … -X -q -A -t -v ON_ERROR_STOP=1` line the flags
# live on. The old cite of :141-146 started one line LATER and so excluded the very
# flags this comment is about, pointing a reader at the SQL instead.)
psqlt() { psql "$RESTORE_DB_URL" -X -q -A -t -v ON_ERROR_STOP=1 "$@"; }

# ---------------------------------------------------------------------------
# The census SQL. ONE file, run twice (pre and post), so pre/post comparison is a
# comparison of the same program's output and cannot drift.
#
# ⛔ B1 — `SET search_path = pg_catalog` IS LOAD-BEARING, not hygiene, and the
# reason is NOT how any particular policy's source is spelled.
#
# Postgres does not keep the source text of a policy expression. It keeps a PARSE
# TREE with the function already resolved to an oid, and `pg_get_expr` /
# `pg_get_triggerdef` re-render that tree against the READER's search_path,
# dropping the qualifier of anything the reader can reach unqualified. Under
# psql's default `"$user", public` a policy authored `public.f(...)` and one
# authored `f(...)` therefore deparse to the SAME string — `f(...)` — and a census
# that substring-matches `public.` in `pg_policies.qual` sees NEITHER of them.
#
# ⭐ MEASURED, not reasoned: plan 01's NEUTER 1 removed this SET and BOTH storage
# policies vanished from the census — the QUALIFIED twin included
# (src/__tests__/restore-test-from-baseline.test.ts:217-218). `DROP SCHEMA public
# CASCADE` then removes them and a pre/post key-set comparison agrees on a set
# that EXCLUDES them.
#
# With only pg_catalog on the path every public reference renders SCHEMA-QUALIFIED,
# so the match finds it AND the DDL we capture stays replayable after the dump's own
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
--
-- ⛔ A10 — THE KEY CARRIES `tgenabled`, AND THE DDL RESTORES IT.
--     `pg_get_triggerdef()` NEVER emits the enabled state: a DISABLED / ENABLE
--     REPLICA / ENABLE ALWAYS trigger replays as ENABLED-ON-ORIGIN, which is a
--     trigger that fires when it was configured not to. This repo already treats
--     `tgenabled` as load-bearing — `supabase/tests/test_api_keys_insert_not_
--     client_writable.sql:240` pins that a DISABLED trigger "scrubs nothing"
--     while satisfying every presence test. So the state is appended as the
--     matching `ALTER TABLE … TRIGGER` statement, AND folded into the survivor
--     KEY, so the post-replay comparison below is (name, state) and not name
--     alone. An unhandled `tgenabled` value falls through the ELSE with no ALTER
--     — and is caught anyway, because its key would then differ pre vs post.
SELECT 'survivor' || chr(9) || 'trigger' || chr(9)
       || n.nspname || '.' || c.relname || ':' || t.tgname || ':' || t.tgenabled::text || chr(9)
       || pg_get_triggerdef(t.oid) || ';'
       || CASE t.tgenabled
            WHEN 'O' THEN ''
            WHEN 'D' THEN format(' ALTER TABLE %I.%I DISABLE TRIGGER %I;', n.nspname, c.relname, t.tgname)
            WHEN 'R' THEN format(' ALTER TABLE %I.%I ENABLE REPLICA TRIGGER %I;', n.nspname, c.relname, t.tgname)
            WHEN 'A' THEN format(' ALTER TABLE %I.%I ENABLE ALWAYS TRIGGER %I;', n.nspname, c.relname, t.tgname)
            ELSE ''
          END
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
--
-- ⛔ A11 — `NOT p.puballtables` IS LOAD-BEARING. `pg_publication_tables` EXPANDS a
--     `FOR ALL TABLES` publication: it reports every matching table even though
--     `pg_publication_rel` holds no row for any of them. Censused, such a
--     publication yields one survivor key PER PUBLIC TABLE; refusal 7 then passes
--     for the tables the dump re-creates and REFUSES for the ones it does not, and
--     the survivor replay would run `ALTER PUBLICATION … ADD TABLE` against a
--     publication that already covers everything — which errors
--     `publication "…" is defined as FOR ALL TABLES` and aborts EVERY restore with
--     a diagnosis naming the wrong cause. A FOR ALL TABLES publication needs no
--     re-ADD: it re-acquires the new tables the moment the dump creates them.
--     Self-test arm 8 carries such a publication for exactly this reason.
SELECT 'survivor' || chr(9) || 'publication' || chr(9)
       || 'pub:public.' || pt.tablename || chr(9)
       || format('ALTER PUBLICATION %I ADD TABLE public.%I;', pt.pubname, pt.tablename)
  FROM pg_publication_tables pt
  JOIN pg_publication p ON p.pubname = pt.pubname
 WHERE pt.schemaname = 'public'
   AND NOT p.puballtables
 ORDER BY 1;
CENSUS_SQL

  # ── reference-data rows (Phase 164.8.1) ──────────────────────────────────
  # ⛔ WHY THE READING LIVES HERE AND NOT IN A POST-RESTORE `echo`. Nothing after
  # the extension/ownership guards in `run_restore` runs on TEST today — the mode
  # returns or fails before it — and the `restore:` summary line is pinned
  # byte-for-byte by self-test arms 9, 12 and 18, so it must not grow a field.
  # The census is the ONE artifact both modes emit, both times, so this is where a
  # reading that must exist in BOTH modes belongs.
  #
  # ⛔ IT DOES NOT EXTEND THE PREFLIGHT'S "nothing changed" CLAIM TO THE ROW
  # COUNTS, and this comment claimed it did until 2026-09-09 (review finding
  # CR-01). `--mode preflight` compares the census through `census_rollback_view`,
  # which normalises these counts away precisely because they are mutable on
  # shared TEST; read that function for why a count cannot evidence a rollback.
  # What the counts are for is the RESTORE mode's reading and the audit trail.
  #
  # APPENDED with printf rather than interpolated into the heredoc above: that
  # heredoc is QUOTED, and unquoting it to reach one variable would put every `$`
  # and backtick in ~90 lines of catalogue SQL at the mercy of the shell
  # (.planning/phases/164.8-testpreprod-test-becomes-a-real-pre-prod/deferred-items.md:99).
  #
  # `to_regclass` + `query_to_xml` for the same reason `ledger_rows` uses it: a
  # table the dump has not created yet must read `absent`, not raise a parse error
  # that looks like a broken instrument. Every name here survived the charset
  # refusal in `refuse_bad_refdata_allowlist` before reaching `sql_lit`.
  local rt
  for rt in ${REFDATA_TABLES[@]+"${REFDATA_TABLES[@]}"}; do
    printf "SELECT 'refdata:%s=' || CASE\n         WHEN to_regclass('%s') IS NULL THEN 'absent'\n         ELSE (xpath('/row/c/text()',\n                query_to_xml('SELECT count(*)::text AS c FROM %s', false, true, '')))[1]::text\n       END;\n" \
      "$(sql_lit "$rt")" "$(sql_lit "$rt")" "$(sql_lit "$rt")" >> "$1"
  done
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

# 8 — the reference-data allowlist (Phase 164.8.1). Filesystem-only, like refusal
# 4, so it fires before the first connection and long before the first write.
#
# It runs the extractor to a mktemp file IT OWNS, because `RESTORE_OUT_DIR` does
# not exist yet at this point in `run_restore`; only the exit code and the parsed
# `-- refdata-expect:` trailers survive. The emitted SQL is thrown away and
# re-generated inside `build_transaction`, which is where it is actually used.
#
# ⛔ THE TABLE NAMES REACH SQL TWICE — the census's `to_regclass` rows and the
# in-transaction gate's VALUES list — so they are charset-refused HERE, before any
# interpolation, and `sql_lit`-quoted at each site. Belt AND braces (T-164.8-04),
# the same pairing refusal 4 uses for migration basenames.
#
# ⚠️ AND SO DO THE THREE KIND-REGISTRY SEAMS. `REFDATA_KIND_REGISTRY`,
# `REFDATA_KIND_REGISTRY_COL` and `REFDATA_KIND_CHECK` reach the in-transaction
# gate too — twice as bare identifiers and twice inside SQL string literals — and
# until 2026-09-09 they carried NEITHER half of that discipline while the
# paragraph above declared it. Exploiting that needs control of this script's
# environment, so it was never an open hole; it was the stated discipline applied
# to one variable and silently skipped for three, which is how a reader learns the
# wrong rule. They are charset-refused here and `sql_lit`-quoted at every
# string-literal site below.
#
# ⛔ AND THE EXPECTED COUNT IS KEPT, NOT DISCARDED. The extractor's trailer is
# `<schema.table>=<statement count>`; this parser took the table half and threw
# the count away, leaving the in-transaction gate testing `n = 0` alone. A replay
# that lost ONE of `public.system_flags`'s two statements — or one of the two
# `20260420213754` compute_job_kinds statements — leaves the table NON-EMPTY and
# passed that gate, which is precisely the partial-replay shape the gate exists to
# catch. Both halves are parsed now, and a count that is absent or non-numeric is
# refused the same way a bad table name is.
#
# ⚠️ `rc=0; node … || rc=$?` and NOT `set +e`: the `--run` region's softening-token
# exact-set pin (src/__tests__/restore-test-from-baseline.test.ts) counts both
# `set +e` and `|| true` at a MEASURED number, and every reading below is captured
# and then CHECKED, which is the opposite of softening. The `awk` counters exit 0
# by construction, so neither token is needed to read them.
REFDATA_TABLES=()
REFDATA_EXPECT=()
REFDATA_ENTRY_N=0
# ⛔ REFUSAL 9 — no backtick may appear inside an UNQUOTED `<<TXN_*` heredoc.
# Those heredocs interpolate shell variables by design, so bash also performs
# COMMAND SUBSTITUTION inside them — including inside SQL `--` comments, where a
# reader's eye reads documentation and bash reads a command. A multi-line span
# additionally swallows the next line's `--`, turning prose into SQL in a script
# whose job is to DROP SCHEMA public CASCADE. Found in five places on 2026-09-09,
# two of them older than the finding, which is why this is a gate and not a note.
#
# Filesystem-only and pre-write, like refusals 1-8. Takes the file to scan so the
# self-test can point it at a fixture instead of at this script.
refuse_backticks_in_txn_heredocs() {
  local src="${1:-$0}" hits
  # ⛔ MATCH EVERY UNQUOTED HEREDOC, not just the `TXN_*` ones. The first cut of
  # this guard keyed on /<<TXN_[A-Z_]+$/ and the phase verification walked past it
  # FOUR ways on scratch fixtures: `<<-TXN_A`, `<<TXN_A ` (one trailing space),
  # `<<TXN_Gate2` (a lowercase letter in the delimiter) and any delimiter that is
  # simply not spelled TXN_. Nothing in this script triggered any of them, which is
  # exactly why a guard named for a general property must MEASURE that property —
  # a name that overclaims is how the next reader concludes they are covered.
  #
  # A QUOTED delimiter (<<'EOF' or <<"EOF") disables substitution entirely, so
  # those bodies are safe by construction and are skipped, not scanned.
  #
  # ⛔ WIDENED 2026-09-09 (code review WR-01), and the widening was PROVEN needed,
  # not argued: the previous pattern anchored the delimiter with `[ \t]*$`, so an
  # opener whose delimiter is FOLLOWED by a redirect or a pipe on the same line was
  # not recognised as an opener AT ALL and its body was never scanned. A fixture
  # whose SQL comment carried a live backticked echo came out of bash with the echo
  # already executed: the substitution really runs there. Trailing content is now
  # allowed, but ONLY when it begins with a shell operator, which preserves the
  # original anchor's purpose — the self-test's own fixture-writing printf has a
  # backslash-n and a quote after the token, not an operator, so it still does not
  # read as an opener.
  #
  # ⚠️ Do NOT write an example opener literally in this comment. The first draft of
  # this paragraph spelled two of them out and the widened matcher promptly read
  # ITS OWN COMMENT as an opener, scanned to EOF and refused the whole script. The
  # trap this guard exists for is shell-looking text inside prose; the guard's own
  # documentation is not exempt from it.
  #
  # ⛔ SECOND SHAPE, same review: an INDENTED terminator closes the scan but does
  # NOT close a real heredoc unless the opener was `<<-`. Stripping indentation
  # unconditionally therefore ended the scan early and let every backtick after
  # that point through. The dash is now tracked, and only `<<-` accepts an
  # indented terminator — the same rule bash itself applies.
  hits=$(awk '
    !inside {
      if (match($0, /<<-?[ \t]*("[A-Za-z_][A-Za-z0-9_]*"|'"'"'[A-Za-z_][A-Za-z0-9_]*'"'"'|[A-Za-z_][A-Za-z0-9_]*)[ \t]*([<>|&].*)?$/)) {
        tok = substr($0, RSTART, RLENGTH)
        dash = (tok ~ /^<<-/)
        sub(/^<<-?[ \t]*/, "", tok)
        sub(/[ \t]*([<>|&].*)?$/, "", tok)
        # Quoted delimiter => no expansion inside the body => nothing to refuse.
        if (tok ~ /^["'"'"']/) next
        term = tok; inside = 1; next
      }
      next
    }
    { line = $0; if (dash) sub(/^[ \t]+/, "", line) }
    inside && line == term { inside = 0; next }
    inside {
      # A BACKSLASH-ESCAPED backtick is LITERAL in an unquoted heredoc — no
      # substitution — and the oldest comments in these heredocs are written that
      # way on purpose. Strip those first; a backtick still standing is live.
      line = $0
      k = index(line, "\\`")
      while (k > 0) { line = substr(line, 1, k - 1) substr(line, k + 2); k = index(line, "\\`") }
      if (index(line, "`") > 0) printf "%d: %s\n", NR, $0
    }
  ' "$src")
  if [ -n "$hits" ]; then
    printf '%s\n' "$hits" >&2
    fail "restore aborted: a backtick appears inside an UNQUOTED heredoc in ${src} (lines above). These heredocs are unquoted so they can interpolate the gate's VALUES list, which means bash COMMAND-SUBSTITUTES every backticked span in them — SQL comments included — while assembling a destructive restore, and a multi-line span swallows the following line's comment prefix. Write plain prose inside them, or backslash-escape the backtick (\\\` is literal here); do NOT quote the heredoc, that would break the interpolation the gate needs."
  fi
}

refuse_bad_refdata_allowlist() {
  [ -f "$REFDATA_ALLOWLIST" ] || fail "reference-data allowlist not found at ${REFDATA_ALLOWLIST}."
  [ -f "$REFDATA_EXTRACTOR" ] || fail "reference-data extractor not found at ${REFDATA_EXTRACTOR}."
  command -v node >/dev/null 2>&1 || fail "node is not on PATH; the reference-data extractor cannot run, and a restore that skips the replay is the defect this gate exists to remove."

  # THE THREE KIND-REGISTRY SEAMS, refused with the SAME charset the table names
  # get — filesystem-only like the rest of this refusal, so they fire before the
  # first connection. A relation name may carry a schema dot; a column name may
  # not, so it gets the narrower class.
  case "$REFDATA_KIND_REGISTRY" in
    ''|*[!a-z0-9_.]*) fail "REFDATA_KIND_REGISTRY is '${REFDATA_KIND_REGISTRY}' — this script refuses to interpolate that into SQL. It reaches the in-transaction gate both as a bare identifier and inside a string literal." ;;
  esac
  case "$REFDATA_KIND_REGISTRY_COL" in
    ''|*[!a-z0-9_]*) fail "REFDATA_KIND_REGISTRY_COL is '${REFDATA_KIND_REGISTRY_COL}' — this script refuses to interpolate that into SQL. A column name carries no schema dot." ;;
  esac
  case "$REFDATA_KIND_CHECK" in
    ''|*[!a-z0-9_.]*) fail "REFDATA_KIND_CHECK is '${REFDATA_KIND_CHECK}' — this script refuses to interpolate that into SQL." ;;
  esac

  # EMPTY IS AN ERROR, and it is checked HERE rather than left to the extractor:
  # the extractor's own empty-allowlist refusal is a second reading of the same
  # fact, and a guard whose only arm reaches the OTHER layer is unmeasured.
  REFDATA_ENTRY_N=$(awk '!/^[[:space:]]*(#|$)/ { c++ } END { print c+0 }' "$REFDATA_ALLOWLIST")
  if [ "$REFDATA_ENTRY_N" -eq 0 ]; then
    fail "the reference-data allowlist ${REFDATA_ALLOWLIST} carries ZERO entries. An empty allowlist replays NOTHING, so this restore would commit a database whose ledger swears every seed migration applied while every table those migrations seeded is EMPTY — that is the Phase 164.8 defect, not a clean run."
  fi

  local tmp rc=0
  tmp="$(mktemp)"
  node "$REFDATA_EXTRACTOR" --allowlist "$REFDATA_ALLOWLIST" --migrations "$MIGRATIONS_DIR" \
    > "$tmp" 2> "${tmp}.err" || rc=$?
  if [ "$rc" -ne 0 ]; then
    cat "${tmp}.err" >&2
    rm -f "$tmp" "${tmp}.err"
    fail "reference-data extraction refused (exit ${rc}); nothing was replayed and no transaction was assembled."
  fi

  REFDATA_TABLES=()
  REFDATA_EXPECT=()
  local line trailer tbl expect
  while IFS= read -r line; do
    trailer="${line#-- refdata-expect: }"
    tbl="${trailer%%=*}"
    case "$trailer" in
      *=*) expect="${trailer##*=}" ;;
      *)   expect="" ;;
    esac
    case "$tbl" in
      ''|*[!a-z0-9_.]*) rm -f "$tmp" "${tmp}.err"; fail "the reference-data extractor named table '${tbl}' — this script refuses to interpolate that into SQL." ;;
    esac
    case "$expect" in
      ''|*[!0-9]*) rm -f "$tmp" "${tmp}.err"; fail "the reference-data extractor emitted the trailer '${line}', whose count half is '${expect}'. This script needs BOTH halves — '<schema.table>=<statement count>' — because the in-transaction gate compares the table's row count against that number; without it the gate degrades to a bare emptiness test that a partial replay passes." ;;
    esac
    REFDATA_TABLES+=("$tbl")
    REFDATA_EXPECT+=("$expect")
  done < <(awk '/^-- refdata-expect: /' "$tmp")
  rm -f "$tmp" "${tmp}.err"

  # A SECOND, INDEPENDENT EMPTINESS READING, of the extractor's OUTPUT rather than
  # the allowlist's bytes. A stubbed or half-working extractor that exits 0 and
  # emits no trailer would leave the in-transaction gate with an empty VALUES list
  # — a gate that passes vacuously — and the restore would commit unguarded. Arm
  # 24 leg (c) drives exactly that through the REFDATA_EXTRACTOR seam.
  if [ "${#REFDATA_TABLES[@]}" -eq 0 ]; then
    fail "the reference-data extractor exited 0 but emitted NO \`-- refdata-expect:\` trailer for ${REFDATA_ALLOWLIST}. With no table list the in-transaction gate has nothing to count and would pass vacuously; refusing rather than restoring unguarded."
  fi
  note "refdata: ${#REFDATA_TABLES[@]} table(s) from ${REFDATA_ENTRY_N} allowlist line(s) under ${REFDATA_ALLOWLIST}, each with a pinned statement count"
}

# 5 — WHICH DATABASE AM I ON. The first statement this script sends. CLAUDE.md
# § "Which database am I on? (ask FIRST, every time)": `current_database()` is
# `postgres` on BOTH projects and proves nothing; each project carries a hand-set
# COMMENT ON DATABASE naming itself.
#
# ⛔ The marker TEXT is never printed. This log is public.
refuse_wrong_database() {
  local marker rc=0
  # ⛔ A9 — STDERR GOES TO A FILE, NOT INTO `marker`. With `2>&1` any psql or libpq
  # diagnostic emitted on a SUCCESSFUL connect (a NOTICE, a server/client version
  # mismatch warning, a GSSAPI or SSL note) becomes part of the value the three
  # identity refusals judge — and a non-empty stderr line DEFEATS the NULL check
  # below, which is precisely the branch CLAUDE.md calls "the marker was lost".
  # The calling workflow already does it this way
  # (.github/workflows/test-restore-from-baseline.yml:655-657, stderr to its own
  # file); this is that shape. The stderr text is NOT printed: it can name the
  # host, its IP and the DB user, and this log is public.
  marker=$(psqlt -c "SELECT shobj_description(oid, 'pg_database') AS which_database
  FROM pg_database WHERE datname = current_database();" 2>"$RESTORE_OUT_DIR/marker.err") || rc=$?
  if [ "$rc" -ne 0 ]; then
    fail "the database identity marker could not be read (psql exited ${rc}; its stderr is at ${RESTORE_OUT_DIR}/marker.err and is NOT printed — it can name the host and the DB user). Refusing to write to a database this script cannot identify."
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
  local mode="${1:-}"
  if [ "$RESTORE_REQUIRE_MUTEX" != "1" ]; then
    # ⛔ A5 — THE BYPASS IS REFUSED OUTRIGHT FOR THE DESTRUCTIVE MODE. This seam
    # disables the ONE thing keeping other people's CI out of shared TEST during
    # `DROP SCHEMA public CASCADE`. `--mode preflight` and `--self-test` write
    # NOTHING (the terminator is ROLLBACK, and the self-test runs against a
    # throwaway cluster), so the seam is useful there and harmless. `--mode
    # restore` COMMITS, so there the bypass is not a seam, it is the removal of
    # the guard — and it is a refusal, not a note.
    if [ "$mode" = "restore" ]; then
      fail "RESTORE_REQUIRE_MUTEX=${RESTORE_REQUIRE_MUTEX} would bypass the shared-TEST mutex check, and this is --mode restore, which COMMITS. The mutex is the only thing keeping other people's CI out during DROP SCHEMA public CASCADE. The bypass is accepted for --mode preflight and --self-test, which write nothing; it is refused here."
    fi
    # Loud, on stderr, and it names the mode it is being tolerated for. (It is NOT
    # spelled `::warning::`: `src/__tests__/restore-test-from-baseline.test.ts`
    # pins the --run region to carry no `::warning` token, since in this repo that
    # token has meant "a gate that reported instead of failing". See the report.)
    echo "${GATE}: ⚠️ MUTEX CHECK DISABLED by RESTORE_REQUIRE_MUTEX=${RESTORE_REQUIRE_MUTEX} — tolerated ONLY because mode=${mode:-<unset>} writes nothing. Nothing is keeping other CI off this database." >&2
    return 0
  fi
  local held rc=0
  # ⛔ A6 — `objid` ALONE IS NOT THE LOCK. pg_locks rows for advisory locks carry
  # the key split across `classid`/`objid` and tagged by `objsubid`: the ONE-key
  # form `pg_advisory_lock(bigint)` — the form every caller in this repo uses
  # (measured: .github/workflows/ci.yml:2610,3701,4432, mutex-probe.yml:206,
  # test-restore-from-baseline.yml:517 are all `pg_advisory_lock(61616158)`) —
  # sets classid=0, objid=<key>, objsubid=1. Without `classid = 0` and
  # `objsubid = 1` a TWO-key lock `pg_advisory_lock(0, 61616158)` satisfies this
  # probe; without the `database` term the SAME key held in ANY OTHER database of
  # the cluster does. Both would report "the mutex is held" while nothing at all
  # is keeping other CI off THIS database. Self-test arm 6 carries a leg for each.
  held=$(psqlt -c "SELECT count(*) FROM pg_locks
     WHERE locktype = 'advisory'
       AND classid = 0
       AND objid = ${MUTEX_KEY}
       AND objsubid = 1
       AND database = (SELECT oid FROM pg_database WHERE datname = current_database())
       AND granted;" 2>&1) || rc=$?
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

# ⛔ CR-01 — THE ROLLBACK PROOF READS A NARROWER CENSUS THAN THE REPORT DOES.
# `--mode preflight` proves the transaction rolled back by comparing the pre- and
# post-census BYTE-FOR-BYTE. Phase 164.8.1 added `refdata:<table>=<count>` lines to
# that census, and a ROW COUNT is not admissible evidence of a rollback:
#
#   * `auth.users` lives OUTSIDE `public`, so `DROP SCHEMA public CASCADE` never
#     locks it and a concurrent writer can change it mid-transaction;
#   * `public.feature_flags` and `public.system_flags` are described by this
#     phase's own allowlist as RUNTIME-MUTABLE, and shared TEST runs other
#     people's CI (CLAUDE.md) — their counts move under us by design.
#
# A byte-compare over those lines makes a PERFECTLY rolled-back preflight able to
# abort with `Treat this database as modified.` — on the one instrument the
# destructive restore is gated on. So the compared VIEW normalises every refdata
# count to `present`, which keeps the part of the reading that IS structural (the
# table existing at all — `absent` is what `DROP SCHEMA` produces, and a rollback
# must restore it) and drops the part that is not. The full census, counts and
# all, is still printed and still written to disk; only the equality test reads
# the view. Arm 25 falsifies the normalisation in both directions.
census_rollback_view() {
  sed -E 's/^(refdata:[^=]+=)[0-9]+$/\1present/' "$1"
}

# Every line of a census class, sorted — the shape used to compare a LIST pre/post
# rather than a count. awk, not grep: awk exits 0 on zero matches, so an empty
# class is an empty string and never an rc that has to be softened away.
census_class_lines() { awk -v k="$2" 'index($0, k "=") == 1' "$1" | LC_ALL=C sort; }

# ⛔ A7 — `grep -c … || true` SWALLOWED EXIT 2. grep exits 1 for "no matches" (a
# READING) and 2 for "the file could not be read" (a BROKEN INSTRUMENT), and
# `|| true` made both of them the empty string. The post-restore comparison
# `[ "$post_survivors" = "$pre_survivors" ]` then compared "" to "" and PASSED
# VACUOUSLY — a survivor accounting that cannot fail. rc is captured and checked
# the way derive_expected_shape already does it.
census_survivor_count() {
  local n rc
  set +e; n=$(grep -ac '^survivor	' "$1"); rc=$?; set -e
  [ "$rc" -le 1 ] || fail "MEASURE_FAIL: could not count survivor rows in ${1} (grep exited ${rc}). An unreadable census is not a census of nothing."
  printf '%s' "${n:-0}"
}

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
  # ⛔ A8 — THE PIPELINE IS SPLIT SO THE NORMALIZER'S OWN rc IS SEEN. Written as
  # one pipe ending in `|| true`, a CRASHED normalizer produced EXP_FUNCTIONS=0
  # and the run then aborted with "expected 0 distinct function name(s)" — which
  # reads as "the dump does not apply" when the truth is "the normalizer did not
  # run". Fail-safe in direction, misdiagnosing in message. The `-ge 1` floor is
  # the one EXP_TABLES already had: a baseline that defines no function is not
  # this repo's baseline.
  local fnames frc
  set +e; fnames=$(node "$NORMALIZER" --function-names "$BASELINE_FILE"); frc=$?; set -e
  [ "$frc" -eq 0 ] || fail "MEASURE_FAIL: the shared normalizer (${NORMALIZER}) exited ${frc} reading ${BASELINE_FILE}. A crashed normalizer is not a dump with zero functions."
  set +e; EXP_FUNCTIONS=$(printf '%s\n' "$fnames" | grep -ac '[^[:space:]]'); rc=$?; set -e
  [ "$rc" -le 1 ] || fail "MEASURE_FAIL: could not count the normalizer's function names (grep exited ${rc})."
  EXP_TABLES=${EXP_TABLES:-0}; EXP_POLICIES=${EXP_POLICIES:-0}; EXP_FUNCTIONS=${EXP_FUNCTIONS:-0}
  [ "$EXP_TABLES" -ge 1 ] || fail "${BASELINE_FILE} carries ZERO CREATE TABLE lines. A dump that creates nothing is not a baseline."
  [ "$EXP_FUNCTIONS" -ge 1 ] || fail "the shared normalizer read ZERO function names out of ${BASELINE_FILE}. A baseline that defines no function is not this repo's baseline; treat this as a broken reading, not an empty dump."
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
  # ⛔ A1 — AN EMPTY CENSUS RENDERS AN EMPTY ARRAY, NEVER `ARRAY[NULL]`. With
  # `NULL::text` here the closure below compiled to `v_keys := ARRAY[NULL::text]`,
  # `r.key = ANY (ARRAY[NULL])` is SQL NULL rather than false, plpgsql treats
  # `IF NULL` as FALSE, and the B2 closure NEVER RAISED — so with zero censused
  # survivors EVERY cross-schema dependent was CASCADE-dropped into a COMMITTED
  # restore. Self-test arm 19 is the permanent observation. The `coalesce(...)`
  # in the closure's own test is the second, independent remedy: either one alone
  # closes this, and both are kept because the failure mode is silent and total.
  # (`x = ANY (ARRAY[]::text[])` is FALSE, not NULL — measured on pg16.)

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
               -- run of this assertion named \`toast table pg_toast.pg_toast_16428\`
               -- and rolled the whole restore back. Same carrier pattern as
               -- pg_trigger.tgrelid above, applied one class further.
               WHEN p.classid = 'pg_class'::regclass THEN (SELECT CASE WHEN c.relkind = 't' THEN (SELECT n2.nspname FROM pg_class o JOIN pg_namespace n2 ON n2.oid = o.relnamespace WHERE o.reltoastrelid = c.oid) ELSE n.nspname END FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.oid = p.objid)
               WHEN p.classid = 'pg_proc'::regclass THEN (SELECT n.nspname FROM pg_proc pr JOIN pg_namespace n ON n.oid = pr.pronamespace WHERE pr.oid = p.objid)
               WHEN p.classid = 'pg_type'::regclass THEN (SELECT n.nspname FROM pg_type ty JOIN pg_namespace n ON n.oid = ty.typnamespace WHERE ty.oid = p.objid)
               ELSE NULL
             END AS own_schema,
             CASE
               -- A10: the key carries tgenabled, exactly as the census emits it.
               WHEN p.classid = 'pg_trigger'::regclass THEN (SELECT n.nspname || '.' || c.relname || ':' || t.tgname || ':' || t.tgenabled::text FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE t.oid = p.objid)
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
    -- ⛔ A1, remedy 2 of 2. \`coalesce(..., false)\` and NOT a bare \`NOT (… = ANY …)\`:
    -- a NULL element anywhere in v_keys makes the comparison SQL NULL, plpgsql
    -- treats \`IF NULL\` as false, and this closure silently stops refusing. The
    -- post-replay survivor loop below already guards the same way; this one did
    -- not, and it is the one that runs BEFORE the DROP.
    IF NOT coalesce(r.key = ANY (v_keys), false) THEN
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
  #
  # ⛔ IN-06 — THE READ IS BOUNDED, NOT TRUSTED. Unwrapped, a grep that could not
  # READ the dump (exit 2) died right here under `set -e` with no `::error::` at
  # all: the operator saw a transaction that stopped mid-assembly and not one
  # sentence saying why. `-le 1` and NOT `-eq 0` is the whole point of the bound —
  # `grep -v` exits 1 when EVERY line matched the filter, i.e. an empty output,
  # which is a legitimate reading; exit >= 2 is a broken instrument. This is the
  # same shape as the `grep -ac` count above, and the two now fail the same way.
  set +e; grep -av "$FILTER_PATTERN" "$BASELINE_FILE" >> "$out"; rc=$?; set -e
  [ "$rc" -le 1 ] || fail "MEASURE_FAIL: could not read ${BASELINE_FILE} while filtering (grep exited ${rc}). An unreadable dump is not an empty one."

  # The dump ends with `set_config('search_path', '', false)` still in force. The
  # survivor DDL below is fully qualified and does not need a path — the ledger DDL
  # and the assertions do.
  cat >> "$out" <<'TXN_MID'
SET LOCAL search_path = pg_catalog;
TXN_MID
  cat "$RESTORE_OUT_DIR/survivors.sql" >> "$out"

  # ── reference data: the replay (Phase 164.8.1, decision L-01) ────────────
  # Position is the whole design. AFTER the dump (the tables must exist) and the
  # survivors, BEFORE the ledger seed (the ledger must not claim a migration
  # applied until this transaction's rows are in), and INSIDE the transaction, so
  # a failure here rolls the restore back rather than leaving TEST half-seeded.
  #
  # The extractor runs a SECOND time here rather than reusing the temp file
  # `refuse_bad_refdata_allowlist` made: that one is deleted with its mktemp, and
  # a `refdata.sql` that lives beside `restore.sql` is what arm 23 mutates and
  # what a human reads after a failed run.
  local refdata_rc=0 refdata_n
  node "$REFDATA_EXTRACTOR" --allowlist "$REFDATA_ALLOWLIST" --migrations "$MIGRATIONS_DIR" \
    > "$RESTORE_OUT_DIR/refdata.sql" 2> "$RESTORE_OUT_DIR/refdata.err" || refdata_rc=$?
  if [ "$refdata_rc" -ne 0 ]; then
    cat "$RESTORE_OUT_DIR/refdata.err" >&2
    fail "reference-data extraction refused (exit ${refdata_rc}); nothing was replayed and no transaction was assembled."
  fi
  refdata_n=$(awk '/^-- refdata: /{ c++ } END { print c+0 }' "$RESTORE_OUT_DIR/refdata.sql")

  # ⛔ PITFALL 1 — THE SEARCH_PATH BRACKET IS LOAD-BEARING, NOT HYGIENE. At this
  # point in the stream the session's path is `pg_catalog` (the TXN_MID line
  # above, itself recovering from the dump's own `set_config('search_path','',
  # false)`). The replayed statements are the migrations' ORIGINAL bytes and the
  # migrations were written for a `public`-first path, so most of them name their
  # target UNQUALIFIED — under `pg_catalog` alone every one of them would abort
  # with "relation does not exist" and the whole restore would roll back.
  # `pg_catalog` is restored immediately after, BEFORE the ledger DDL, because
  # everything below is written expecting it.
  #
  # ⛔ PITFALL 2 — THE REPLAY RELIES ON THE CONNECTING ROLE BYPASSING RLS, AND
  # THAT RELIANCE IS ASSERTED RATHER THAN ASSUMED. `public.compute_job_kinds` is
  # FORCE ROW LEVEL SECURITY (supabase/schema/baseline.sql:9578) and its ONLY
  # policy is `compute_job_kinds_read … FOR SELECT USING (true)`
  # (baseline.sql:13012) — MEASURED 2026-09-09. There is no INSERT policy, and
  # FORCE removes the owner exemption, so every replayed INSERT into that table
  # lands ONLY because the role bypasses RLS. Undeclared, that is a fact the
  # self-test cannot falsify: the lane's `postgres` is initdb's SUPERUSER. So the
  # transaction states it as a precondition and RAISEs with a named diagnosis
  # instead of surfacing a bare 42501 on the first run against real TEST, and the
  # fixture dump now carries FORCE ROW LEVEL SECURITY on `public.fx_keep` so the
  # green arms EXERCISE the bypass rather than assuming it.
  cat >> "$out" <<'TXN_REFDATA_HEAD'
DO $rlsguard$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles
     WHERE rolname = current_user AND (rolbypassrls OR rolsuper)
  ) THEN
    RAISE EXCEPTION 'restore aborted: % neither bypasses RLS nor is a superuser. The reference-data replay INSERTs into tables that are FORCE ROW LEVEL SECURITY with read-only policies (public.compute_job_kinds is the shipped case), so every one of those INSERTs would fail 42501 with no policy to point at. Connect as a role with BYPASSRLS rather than weakening the policies (Phase 164.8.1)', current_user;
  END IF;
END
$rlsguard$;
SET LOCAL search_path = public, pg_catalog;
TXN_REFDATA_HEAD
  cat "$RESTORE_OUT_DIR/refdata.sql" >> "$out"
  cat >> "$out" <<'TXN_REFDATA_TAIL'
SET LOCAL search_path = pg_catalog;
TXN_REFDATA_TAIL

  # ── reference data: the gate ─────────────────────────────────────────────
  # The TXN_WHITELIST shape (loop over a VALUES list, RAISE on the first row that
  # matches) with the predicate INVERTED: there it aborts on a class that is
  # non-empty, here on a reference table that is EMPTY.
  #
  # ⛔ PLAIN `count(*)`, NO `to_regclass` GUARD. Inside this transaction the dump
  # has just created these tables; a guard would turn "the table is missing" —
  # the loudest possible symptom — into a silent pass, which is precisely the
  # softening this phase exists to remove.
  #
  # ⛔ THE PINNED COUNT IS CARRIED INTO THE GATE, NOT JUST INTO THE EXTRACTOR.
  # `count(*) >= <statements>` is a SOUND FLOOR, not a guess: the DROP immediately
  # above emptied every one of these tables, and each replayed statement is an
  # allowlisted INSERT that puts AT LEAST one row into the table its trailer names
  # — so a table carrying fewer rows than its statement count has lost at least one
  # statement. Until 2026-09-09 this gate tested `n = 0` alone, and a replay that
  # dropped a statement from a multi-statement table left it non-empty and PASSED
  # — the exact partial-replay shape the gate is for. EMPTY and SHORT RAISE
  # separately because they are different diagnoses: nothing replayed at all versus
  # some of it did.
  #
  # ⛔ THE FLOOR IS LOOSE BY CONSTRUCTION, AND HOW LOOSE IS A PROPERTY OF THE
  # CORPUS, NOT OF THIS CODE. It compares ROWS against STATEMENTS, so a table whose
  # rows exceed its statements absorbs that many lost rows before the floor bites,
  # and a statement inserting zero NEW rows is invisible to it in both directions.
  # Both shapes are live in the real allowlist. MEASURED 2026-09-09:
  # public.compute_job_kinds is pinned at 15 statements and yields 16 distinct
  # kind names, so ROWS EXCEED STATEMENTS there and the floor absorbs one lost
  # row before it bites. One of those statements (20260510175507) is a deliberate
  # ON CONFLICT DO NOTHING duplicate of a row an earlier migration already
  # inserts, so it contributes no new row at all and is invisible to the floor in
  # both directions.
  #
  # ⛔ THIS PARAGRAPH HAS NOW BEEN WRONG TWICE. It carried a false worked example
  # until the phase review (WR-02), and the fix for that inverted BOTH figures --
  # it said 16 statements yielding 15 rows -- until the phase verification caught
  # it the same day. The authority is scripts/restore-test-refdata-allowlist.txt
  # and the --audit that re-measures it, never this sentence.
  #
  # The compute_job_kinds figures above are here as the ONE worked example that
  # shows BOTH shapes at once, and they are re-derivable in two commands. That is
  # the whole licence: do not add a second table's derivation
  # here — the pinned counts live in the allowlist and are re-measured by
  # `--audit` on every run. The floor's job is to catch a replay that lost a WHOLE
  # statement's worth of rows, not to be an exact row oracle. The row-level gap it
  # cannot see is what the kind-admission invariant below is for; neither
  # substitutes for the other.
  local refdata_values="" rtq i=0
  for rtq in ${REFDATA_TABLES[@]+"${REFDATA_TABLES[@]}"}; do
    refdata_values="${refdata_values}${refdata_values:+,
      }('$(sql_lit "$rtq")', (SELECT count(*) FROM ${rtq}), ${REFDATA_EXPECT[$i]})"
    i=$((i + 1))
  done
  # ⛔ THIS HEREDOC IS UNQUOTED — it has to be, it interpolates ${refdata_values}.
  # So a BACKTICK anywhere inside it, including inside an SQL `--` comment, is
  # COMMAND SUBSTITUTION: bash runs the quoted prose while assembling a DESTRUCTIVE
  # restore, the substitution's (empty) output replaces it, and a multi-line span
  # swallows the following line's `--` prefix, turning comment text into SQL. Found
  # by the phase verification on 2026-09-09 in five places, two of them older than
  # the finding. `refuse_backticks_in_txn_heredocs` below fails the run rather than
  # trusting a reader to remember; write plain prose in here, never markup.
  cat >> "$out" <<TXN_REFDATA_GATE
DO \$restore\$
DECLARE
  v_empty   text;
  v_short   text;
  v_missing text[];
BEGIN
  -- ⛔ COLLECT FIRST, RAISE ONCE. A RAISE inside the loop aborts on the FIRST
  -- offending table, so the likeliest real failure — the whole replay lost, which
  -- is arm 23 leg (a)'s shape — used to tell the operator about ONE table out of
  -- eight and gave them no way to tell "one table regressed" from "nothing
  -- replayed at all". The census carries the full picture, but on a
  -- --mode restore abort the post-census never runs, so this message is all
  -- there is
  -- (review finding WR-09). EMPTY and SHORT stay SEPARATE aggregates because they
  -- remain different diagnoses.
  SELECT string_agg(t.tbl, ', ' ORDER BY t.tbl) FILTER (WHERE t.n = 0),
         string_agg(format('%s (%s row(s) for %s statement(s))', t.tbl, t.n, t.expected), ', ' ORDER BY t.tbl)
           FILTER (WHERE t.n > 0 AND t.n < t.expected)
    INTO v_empty, v_short
    FROM (VALUES
      ${refdata_values}
    ) AS t(tbl, n, expected);

  IF v_empty IS NOT NULL THEN
    RAISE EXCEPTION 'restore aborted: reference table(s) % are EMPTY after the replay — the ledger would say their seed migrations applied while their rows are gone; fix the allowlist line or the extractor, never hand-seed shared TEST (Phase 164.8.1). Short-but-not-empty in the same run: %', v_empty, coalesce(v_short, 'none');
  END IF;
  IF v_short IS NOT NULL THEN
    RAISE EXCEPTION 'restore aborted: reference table(s) are SHORT after the replay — %, and each allowlisted statement inserts at least one row into a table the DROP had just emptied, so at least one statement did not land. A PARTIAL replay commits a ledger that swears its seed migration applied; fix the allowlist line or the extractor, never hand-seed shared TEST (Phase 164.8.1)', v_short;
  END IF;

  -- The SECOND partial-replay leg, and it is INDEPENDENT of the count floor
  -- above: the floor sees a table that lost a whole statement, this sees a
  -- registry that lost individual ROWS its own admission CHECK still admits.
  -- Neither substitutes for the other — a statement whose row count survives
  -- (ON CONFLICT DO NOTHING against a stale row) is invisible to the floor, and
  -- a table with no admission CHECK is invisible to this. Both must stand.
  --
  -- ⛔ ABSENCE IS LOUD, NOT INERT. This used to be wrapped in
  -- IF to_regclass(...) IS NOT NULL AND EXISTS (... pg_constraint ...) THEN, so
  -- a rename, a typo in the seam, or a dropped constraint turned the leg into a
  -- permanent no-op and the restore COMMITTED — on real TEST this is the only
  -- detector of a partial replay that leaves its tables non-empty, and it would
  -- have gone quiet with nothing in the log. The configured pair is REQUIRED to
  -- exist: both objects are on real TEST, and on the self-test lane the seam
  -- points at public.fx_keep / fx_keep_kind_check, which baseline-fixture.sql
  -- creates for exactly this reason. Each RAISE names WHICH of the two is gone.
  IF to_regclass('$(sql_lit "$REFDATA_KIND_REGISTRY")') IS NULL THEN
    RAISE EXCEPTION 'restore aborted: the configured kind registry $(sql_lit "$REFDATA_KIND_REGISTRY") (REFDATA_KIND_REGISTRY) does not exist after the replay. This is the only leg that can see a partial replay whose tables are non-empty; skipping it would commit an unguarded restore (Phase 164.8.1)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = '$(sql_lit "$REFDATA_KIND_CHECK")') THEN
    RAISE EXCEPTION 'restore aborted: the configured kind-admission CHECK $(sql_lit "$REFDATA_KIND_CHECK") (REFDATA_KIND_CHECK) does not exist after the replay. This is the only leg that can see a partial replay whose tables are non-empty; skipping it would commit an unguarded restore (Phase 164.8.1)';
  END IF;
  SELECT array_agg(DISTINCT m.caps[1] ORDER BY m.caps[1]) INTO v_missing
    FROM pg_constraint c
    CROSS JOIN LATERAL regexp_matches(pg_get_constraintdef(c.oid), '''([a-z_]+)''', 'g') AS m(caps)
   WHERE c.conname = '$(sql_lit "$REFDATA_KIND_CHECK")'
     AND NOT EXISTS (
           SELECT 1 FROM ${REFDATA_KIND_REGISTRY} k
            WHERE k.${REFDATA_KIND_REGISTRY_COL}::text = m.caps[1]
         );
  IF v_missing IS NOT NULL AND array_length(v_missing, 1) > 0 THEN
    RAISE EXCEPTION 'restore aborted: $(sql_lit "$REFDATA_KIND_CHECK") admits kind(s) % that $(sql_lit "$REFDATA_KIND_REGISTRY") does not carry — a partial replay', array_to_string(v_missing, ', ');
  END IF;
END
\$restore\$;
TXN_REFDATA_GATE

  note "refdata: ${refdata_n} statement(s) replayed into ${#REFDATA_TABLES[@]} table(s), gated inside the transaction against each table's pinned statement count (count(*) >= expected, not merely non-empty) and against ${REFDATA_KIND_CHECK} over ${REFDATA_KIND_REGISTRY}"

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

  -- A10/A11: this UNION must render the SAME key grammar the census does, or the
  -- two sides are two different measurements wearing one name. tgenabled is part
  -- of the trigger key (a trigger that came back ENABLED when it was DISABLED is
  -- a trigger that fires when it was configured not to), and a FOR ALL TABLES
  -- publication is excluded on BOTH sides.
  SELECT array_agg(kk ORDER BY kk) INTO v_post_keys FROM (
    SELECT n.nspname || '.' || c.relname || ':' || t.tgname || ':' || t.tgenabled::text AS kk
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
      JOIN pg_publication p2 ON p2.pubname = pt.pubname
     WHERE pt.schemaname = 'public'
       AND NOT p2.puballtables
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

# ---------------------------------------------------------------------------
# ⛔ THE FOUR SCRIPT-WRITTEN .sql FILES ARE PUBLISHED, AND UNTIL NOW NOTHING
# ASSERTED THEY CARRY NO CREDENTIAL.
#
# `census.sql`, `survivors.sql`, `restore.sql` and `refdata.sql` are written by
# THIS script into RESTORE_OUT_DIR, and the calling workflow's staging step admits
# all four into the world-readable backup artifact. That set is a FOUNDER DECISION
# and is deliberately not re-narrowed here: they are the reversal recipe
# (T-164.8-21), and the artifact is where they belong.
#
# What was missing is a MEASUREMENT. The workflow's redaction step runs BEFORE
# this script writes these files — its own comment says they are "scanned by
# NOTHING and redacted by NOTHING" — and `--self-test`'s redaction grep reads an
# arm's CAPTURED OUTPUT, never these files. So the one class that must never be
# published anywhere was asserted about the LOG and about nothing else, and a DSN
# reaching one of these files would have shipped for 90 days on a public repo with
# every gate green.
#
# ⛔ IT SCANS THE SIX CLASSES THE ARTIFACT'S OWN README NAMES, and that agreement
# is the point. `.github/workflows/test-restore-from-baseline.yml` defines the
# redaction class as DSN, supabase host, project ref, the `connect` meta-command,
# ALTER DATABASE and JWT — the pattern `supabase/schema/baseline.sql` is committed
# under (scripts/local-stack/REPLAY-SPIKE.md), and the `schema_re` its backup step
# runs over `schema-before.sql`. This scan used to be `postgres(ql)?://` ALONE while
# the header above claimed the gap was closed for "the one class that must never be
# published anywhere", and it dropped `supabase host`, `project ref`, `connect` and
# `JWT` with NO STATED REASON. `survivors.sql` carries `pg_get_triggerdef(...)` and
# reconstructed `CREATE POLICY ... USING (<qual>)` read off LIVE shared TEST, so a
# host or a project ref reaching one of those bodies shipped with this check green.
#
# ⛔ MEASURED 2026-09-10, so the widening cannot make a legitimate run red: all six
# classes are ZERO across every input these four files are assembled from —
# `supabase/schema/baseline.sql` (0/0/0/0/0/0), the extractor's `refdata.sql` over
# the real allowlist (0/0/0/0/0/0), and this script's own heredocs (0 for all but the
# scan patterns below). `ALTER DATABASE` IS included here although the workflow scopes
# it out of the LEDGER scan: that exemption exists because migration SOURCE carries it
# in comments, and migration source never reaches these four files — only a
# migration's `version` and `name` do.
#
# ⛔ THE ONE PREDICATE DELIBERATELY NOT APPLIED is the arm redaction check's SECOND
# half — a dollar-quote, i.e. a SQL body. These files ARE SQL and are full of
# dollar-quoted bodies by construction, so that half would refuse every legitimate
# run.
#
# ⛔ THE MATCH IS NEVER PRINTED. A hit IS the credential; the refusal names the
# FILE and stops. Same discipline as the identity marker, whose text is withheld
# even when it is the reason for the refusal.
#
# ⭐ IT IS NOW NAMED `refuse_*`, AND THAT WAS EARNED RATHER THAN RENAMED INTO. It
# shipped as `assert_public_sql_dsn_free` on 2026-09-10, and its own comment said
# why: the `refuse_*() {` count is DERIVED — by `--self-test`'s closing line and by
# `restore-test-from-baseline.test.ts` — into the claim that every refusal fires
# before a write AND is armed by a named-message arm, and this check had NO cluster
# arm, so joining the family would have made a true sentence false. Honest, and the
# result was a new hard-fail path on the destructive script with zero lane coverage:
# a name chosen to stay out of a count it would have falsified. The fix was to arm
# it — arm 27, three legs on the throwaway lane — and only then to rename. The
# sentence is true again, and now it covers this function too.
#
# Called AFTER `build_transaction` and BEFORE `run_transaction`, so a hit refuses
# with the database still untouched.
# ---------------------------------------------------------------------------
refuse_credential_in_published_sql() {
  local f c cname cre rc hits="" scanned=0 seen=""
  local -a staged=(census.sql survivors.sql restore.sql refdata.sql)
  # ⛔ `<name>|<ERE>`, one entry per class the artifact README names. The NAME is
  # printed on a hit and the MATCH never is: a class name is not a credential, and a
  # refusal that cannot say WHICH shape it found sends the operator through four
  # files by hand.
  local -a classes=(
    'DSN|postgres(ql)?://'
    'supabase host|@[a-z0-9.-]+\.supabase\.(co|com)'
    'project ref|[a-z]{20}\.supabase'
    'connect meta-command|\\connect'
    'JWT|eyJ[A-Za-z0-9_-]{10,}'
    'ALTER DATABASE|ALTER DATABASE'
  )
  for f in "${staged[@]}"; do
    [ -f "$RESTORE_OUT_DIR/$f" ] || continue
    scanned=$((scanned + 1))
    seen="${seen}${seen:+, }${f}"
    for c in "${classes[@]}"; do
      cname="${c%%|*}"; cre="${c#*|}"
      rc=0
      grep -acE "$cre" "$RESTORE_OUT_DIR/$f" >/dev/null || rc=$?
      [ "$rc" -le 1 ] || fail "MEASURE_FAIL: could not scan ${f} for a ${cname} shape (grep exited ${rc}). An unreadable file is not a clean one, and this file is published."
      if [ "$rc" -eq 0 ]; then hits="${hits}${hits:+, }${f} (${cname})"; fi
    done
  done
  if [ -n "$hits" ]; then
    fail "a credential shape appears in ${hits}, which the calling workflow stages into a WORLD-READABLE artifact for 90 days. The match is NOT printed — it would be the credential. Refusing before the transaction runs; the database is untouched."
  fi
  # ⛔ THE POSITIVE FLOOR. Everything above is a NEGATIVE check, and a negative
  # check over an EMPTY list passes. `|| continue` is silent, so a run that found
  # NONE of the four emitted the identical clean sentence as a run that read and
  # cleared all four — the `-eq 0`-on-an-empty-count shape, in the one function whose
  # whole purpose is to stand between a credential and a world-readable artifact.
  # A relocated writer or a RESTORE_OUT_DIR that differs between `build_transaction`
  # and this scan is enough. So the tally is MEASURED and compared with the list's
  # own length, and a short count REFUSES rather than noting.
  [ "$scanned" -eq "${#staged[@]}" ] || fail "MEASURE_FAIL: scanned ${scanned} of ${#staged[@]} published .sql file(s) under ${RESTORE_OUT_DIR} (found: ${seen:-none}). The workflow stages all ${#staged[@]} into a WORLD-READABLE artifact, so a file this scan could not find is a file that ships UNSCANNED. Refusing before the transaction runs; the database is untouched."
  note "public .sql files carry no credential shape in any of the ${#classes[@]} classes the artifact README names (scanned ${scanned} of ${#staged[@]}: ${seen})"
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
  # AFTER the corpus refusal: this one runs the extractor against MIGRATIONS_DIR,
  # so the dir must already be proven present, non-empty and safely named. It must
  # also precede `write_census_sql`, which reads the table list it parses.
  refuse_bad_refdata_allowlist
  refuse_backticks_in_txn_heredocs

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
  refuse_without_mutex "$mode"

  note "── pre-census (read-only) ──────────────────────────────────────────"
  run_census "$RESTORE_OUT_DIR/pre-census.txt"
  cat "$RESTORE_OUT_DIR/pre-census.txt"
  split_survivors
  local pre_survivors
  pre_survivors=$(census_survivor_count "$RESTORE_OUT_DIR/pre-census.txt")
  # A7's second half: the value is COMPARED to the post-census one later, and ""
  # equals "" — so it is proven to be a number here, before anything relies on it.
  case "$pre_survivors" in ''|*[!0-9]*) fail "MEASURE_FAIL: the survivor count read '${pre_survivors}', not a number. An unreadable census is not a census of zero survivors." ;; esac
  note "survivors censused: ${pre_survivors}"

  refuse_publication_row_without_table

  derive_expected_shape
  build_transaction "$mode"
  # Every file the workflow publishes now exists. Scan them BEFORE the psql
  # session runs, so a credential in a to-be-published file stops the restore
  # rather than being discovered in the artifact afterwards.
  refuse_credential_in_published_sql

  note "── transaction (mode=${mode}) ──────────────────────────────────────"
  run_transaction

  note "── post-census (read-only) ─────────────────────────────────────────"
  run_census "$RESTORE_OUT_DIR/post-census.txt"
  cat "$RESTORE_OUT_DIR/post-census.txt"

  if [ "$mode" = "preflight" ]; then
    # The rollback is MEASURED, not assumed. A preflight that changed anything is a
    # defect, and it is the one thing a preflight is for.
    census_rollback_view "$RESTORE_OUT_DIR/pre-census.txt"  > "$RESTORE_OUT_DIR/pre-census.rollback-view.txt"
    census_rollback_view "$RESTORE_OUT_DIR/post-census.txt" > "$RESTORE_OUT_DIR/post-census.rollback-view.txt"
    if ! cmp -s "$RESTORE_OUT_DIR/pre-census.rollback-view.txt" "$RESTORE_OUT_DIR/post-census.rollback-view.txt"; then
      diff "$RESTORE_OUT_DIR/pre-census.rollback-view.txt" "$RESTORE_OUT_DIR/post-census.rollback-view.txt" >&2 || true
      fail "post-census != pre-census. The transaction was supposed to ROLL BACK and the database is NOT byte-for-byte unchanged. Treat this database as modified."
    fi
    echo "preflight: post-census == pre-census (byte-for-byte over the rollback view; reference-data row COUNTS are normalised to \`present\` because they are mutable on shared TEST and cannot evidence a rollback — see census_rollback_view) — the transaction ran to its ROLLBACK terminator and the database is unchanged; mode=preflight"
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

  # ⛔ A12 — THE DESTRUCTIVE MODE MUST NOT BE THE WEAKER READER. `--mode preflight`
  # compares the whole census BYTE-FOR-BYTE, so it covers these three classes
  # incidentally; `--mode restore` used to check only tables/policies/functions/
  # ledger_rows/survivors and therefore checked NEITHER the extension count nor
  # the two ownership lists — the very readings the header calls the reason "the
  # DROP can be expected to succeed". An extension that lived IN public and is not
  # re-created by the dump, or a public object the dump brings back under a
  # different owner, would have committed silently.
  local pre_ext post_ext class
  pre_ext=$(census_val "$RESTORE_OUT_DIR/pre-census.txt" extensions)
  post_ext=$(census_val "$RESTORE_OUT_DIR/post-census.txt" extensions)
  [ "$post_ext" = "$pre_ext" ] || fail "post-census extensions=${post_ext}, pre-census had ${pre_ext}. An extension that lived in public was CASCADE-dropped and the dump did not put it back."
  for class in nonpostgres_rel nonpostgres_fn; do
    [ "$(census_class_lines "$RESTORE_OUT_DIR/post-census.txt" "$class")" \
      = "$(census_class_lines "$RESTORE_OUT_DIR/pre-census.txt" "$class")" ] \
      || fail "the ${class} ownership list changed across the restore. Pre and post disagree about which public objects \`postgres\` does not own — the reading the founder is shown before deciding the DROP can succeed. Compare ${RESTORE_OUT_DIR}/pre-census.txt with ${RESTORE_OUT_DIR}/post-census.txt."
  done

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
#                                                19  RED  ZERO censused survivors (A1)
#                                                20  RED  marker names neither (A2)
#                                                21  RED  migration corpus (A3)
#                                                22  GREEN reference data replayed
#                                                23  RED  the refdata gate BITES
#                                                24  RED  refdata allowlist refused
#                                                25  GREEN rollback view normalises
#
# Several arms carry more than one LEG, because one guard can be false in more than
# one way and an arm that measures the easy way is not measuring the guard:
#   arm 6  — (a) no lock, (b) the key held in ANOTHER database of the cluster,
#            (c) the same integer taken by the TWO-key advisory-lock form,
#            (d) the RESTORE_REQUIRE_MUTEX bypass against `--mode restore`.
#   arm 8  — additionally carries a `FOR ALL TABLES` publication, which
#            pg_publication_tables EXPANDS; it must NOT be censused as survivors.
#   arm 9  — additionally puts survivor class (a) into ENABLE REPLICA, which
#            pg_get_triggerdef() does not emit, and asserts the state round-trips.
#   arm 21 — (a) a filename the interpolation gate refuses, (b) an EMPTY corpus,
#            (c) an ABSENT migrations dir.
#   arm 23 — three SCRATCH COPIES, one per link of the reference-data chain:
#            (a) the replay concatenation deleted -> the emptiness leg names the
#            table; (b) the `SET LOCAL search_path = public, pg_catalog` bracket
#            deleted -> the migrations' unqualified targets stop resolving
#            (RESEARCH Pitfall 1); (c) one registry row DELETEd inside the
#            transaction after the replay -> the table is NOT empty, the count
#            floor still holds, and only the kind-admission invariant can see it;
#            (d) TWO rows DELETEd -> the table is still NOT empty but now carries
#            fewer rows than its pinned statement count, so the `t.n < t.expected`
#            floor is what fires and names it. (c) and (d) are DIFFERENT gates on
#            the same table and the fixture's 2-statements-over-3-rows shape is
#            what keeps both reachable — see 20260103000000_fixture_c.sql. Every
#            leg also asserts
#            `e2e_leftover` is STILL THERE: a refusal that does not roll back has
#            left shared TEST half-restored.
#   arm 24 — (a) a pinned count that stopped matching, (b) an EMPTY allowlist,
#            (c) an extractor that exits 0 emitting nothing. Each also asserts the
#            pre-census banner never printed, so "before any write" is measured;
#            arm 8 pins that same literal POSITIVELY, because a check that only
#            ever asserts a string's ABSENCE goes green when the string is merely
#            reworded.
#   arm 25 — (a) a mutable reference count moved -> the rollback view must NOT
#            see it; (b) a reference table went ABSENT -> it MUST; (c) a
#            structural line moved -> it MUST; (d) the normalisation actually
#            rewrote something, so (a) cannot pass vacuously. No lane: the
#            function under test is pure text.
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

# ⛔ THE RATCHET. Read off ONE place; raise it only together with the arm that adds
# one, and never lower it to make a run green — that is deleting a proof. Every arm
# has a NAMED falsifier that was OBSERVED RED and then restored from a byte backup;
# the record is 164.8-02-SUMMARY.md for arms 1-18 and this phase's review-fix report
# for arms 19-21 (the empty survivor census, the foreign identity marker, and the
# three unarmed exits of the migration-corpus refusal).
#
# Arms 22-26 are Phase 164.8.1's (22-24 at first write; 25 and 26 were added by
# the phase's own review and verification). Their falsifiers were observed RED on SCRATCH
# COPIES under the harness's mktemp dir — never a byte backup and never
# `git checkout --`, which restores to HEAD and silently destroys uncommitted work
# (L-04) — and each observation, with its scratch path and verbatim output, is
# recorded in 164.8.1-02-SUMMARY.md.
# MEASURED 2026-09-09 — `--self-test` prints 26/26 and exits 0 on a throwaway cluster.
EXPECTED_ARMS=26

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
  # optional OVERLAY (`fixtures/arm-<name>.sql`) is loaded on top, which is how ONE
  # fixture serves every arm — see `EXPECTED_ARMS` for how many that is — without
  # any of them seeing another's shape. (No numeral here: a count spelled in prose
  # beside a constant that moves is a count that will disagree with it.)
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
  #
  # ⚠️ TWO SEAMS, BOTH FOR ARM 6's A6 LEGS: which DATABASE the lock is taken in,
  # and which advisory-lock FORM takes it. The default is the real path — the
  # one-key form, in the database under test.
  hold_mutex() {
    local dsn="${1:-$lane_dsn}" lock_sql="${2:-SELECT pg_advisory_lock(${MUTEX_KEY});}"
    : > "$SELFTEST_TMPD/holder.log"
    nohup psql "$dsn" -X -q -A -t -v ON_ERROR_STOP=1 \
      -c "SET statement_timeout = 0;" \
      -c "$lock_sql" \
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
  # Every value is a PREFIX assignment, so nothing leaks between arms. The ARM_*
  # seams below are what individual arms override with `local` (dynamic scope), so
  # the default leg stays one expression that every arm shares. (No numeral here:
  # a count spelled in prose beside a list that grows is a count that will
  # disagree with it — `grep -c 'local ARM_' ` is the reading.)
  local ARM_BASELINE_DOC="$SELFTEST_TMPD/BASELINE.md"
  local ARM_FRESHNESS="bash $SELFTEST_TMPD/freshness.sh"
  local ARM_REQUIRE_MUTEX=1
  local ARM_MIGRATIONS_DIR="$FIXTURES/migrations"
  # ⛔ THE REFDATA SEAMS ARE NOT OPTIONAL POLISH (PATTERNS §2). Left at their repo
  # defaults, EVERY arm would inherit the real allowlist — which names
  # `public.compute_job_kinds`, `public.discovery_categories` and six more tables
  # the baseline FIXTURE dump never creates — and the in-transaction gate would
  # abort all of them on a table the fixture was never supposed to have.
  local ARM_REFDATA_ALLOWLIST="$FIXTURES/refdata-allowlist.txt"
  local ARM_REFDATA_EXTRACTOR="$SCRIPT_DIR/extract-reference-inserts.mjs"
  # The W1 pair, pointed at the fixture analog: `fx_keep_kind_check` (declared in
  # baseline-fixture.sql) over `public.fx_keep`.`label`, whose admitted labels are
  # exactly the rows the fixture's one allowlisted INSERT replays.
  local ARM_KIND_REGISTRY="public.fx_keep"
  local ARM_KIND_REGISTRY_COL="label"
  local ARM_KIND_CHECK="fx_keep_kind_check"

  run_leg() {
    local script="$1" mode="$2" tag="$3"
    RESTORE_DB_URL="$lane_dsn" \
    BASELINE_FILE="$FIXTURES/baseline-fixture.sql" \
    BASELINE_DOC="$ARM_BASELINE_DOC" \
    MIGRATIONS_DIR="$ARM_MIGRATIONS_DIR" \
    NORMALIZER="$norm" \
    FRESHNESS_TS_CMD="$ARM_FRESHNESS" \
    RESTORE_OUT_DIR="$SELFTEST_TMPD/out-${tag}" \
    RESTORE_REQUIRE_MUTEX="$ARM_REQUIRE_MUTEX" \
    REFDATA_ALLOWLIST="$ARM_REFDATA_ALLOWLIST" \
    REFDATA_EXTRACTOR="$ARM_REFDATA_EXTRACTOR" \
    REFDATA_KIND_REGISTRY="$ARM_KIND_REGISTRY" \
    REFDATA_KIND_REGISTRY_COL="$ARM_KIND_REGISTRY_COL" \
    REFDATA_KIND_CHECK="$ARM_KIND_CHECK" \
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
      REFDATA_ALLOWLIST="$FIXTURES/refdata-allowlist.txt" \
      REFDATA_EXTRACTOR="$SCRIPT_DIR/extract-reference-inserts.mjs" \
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
  #
  # FOUR LEGS, because "the mutex is held" has three ways of being false and the
  # bypass seam is a fourth:
  #   (a) no lock at all;
  #   (b) A6 — the key held in ANOTHER DATABASE of the same cluster. Advisory
  #       locks are per-database; a probe that does not filter `database` reads a
  #       lock that is keeping nothing off THIS database;
  #   (c) A6 — the same integer taken by the TWO-key form `pg_advisory_lock(0,
  #       KEY)`, which lands as classid=0/objid=KEY/objsubid=2 and satisfies an
  #       objid-only probe;
  #   (d) A5 — the RESTORE_REQUIRE_MUTEX bypass, refused for --mode restore.
  arm_mutex_absent() {
    local out rc n

    # (a) nothing holds it.
    fresh_db || return 1
    out="$SELFTEST_TMPD/a6.out"; rc=0
    arm_env preflight a6 > "$out" 2>&1 || rc=$?
    cat "$out"
    [ "$rc" -eq 1 ] || { echo "MEASURE_FAIL (a): an unheld mutex exited ${rc}, expected 1"; return 1; }
    grep -aq "mutex (${MUTEX_KEY}) is not held" "$out" \
      || { echo "MEASURE_FAIL (a): the refusal does not report the shared-TEST mutex ${MUTEX_KEY} as unheld"; return 1; }
    n=$(lane_q "SELECT count(*) FROM pg_tables WHERE schemaname='public' AND tablename='e2e_leftover';")
    [ "$n" = "1" ] || { echo "MEASURE_FAIL (a): the stray table is gone (count=${n}) — the mutex refusal did NOT fire before the first write."; return 1; }

    # (b) the key is held, in the WRONG DATABASE.
    hold_mutex "$admin_dsn" || return 1
    out="$SELFTEST_TMPD/a6b.out"; rc=0
    arm_env preflight a6b > "$out" 2>&1 || rc=$?
    cat "$out"
    release_mutex
    [ "$rc" -eq 1 ] || { echo "MEASURE_FAIL (b): the mutex held in ANOTHER database of the cluster exited ${rc}, expected 1. The pg_locks probe is not filtering on \`database\`, so a lock keeping nothing off this database reads as held."; return 1; }
    grep -aq "mutex (${MUTEX_KEY}) is not held" "$out" \
      || { echo "MEASURE_FAIL (b): the refusal is not the unheld-mutex one"; return 1; }

    # (c) the same integer, taken by the TWO-key form.
    hold_mutex "$lane_dsn" "SELECT pg_advisory_lock(0, ${MUTEX_KEY});" || return 1
    out="$SELFTEST_TMPD/a6c.out"; rc=0
    arm_env preflight a6c > "$out" 2>&1 || rc=$?
    cat "$out"
    release_mutex
    [ "$rc" -eq 1 ] || { echo "MEASURE_FAIL (c): a TWO-key advisory lock carrying ${MUTEX_KEY} exited ${rc}, expected 1. The probe is not filtering on classid/objsubid, so a different lock that happens to share the integer reads as held."; return 1; }
    grep -aq "mutex (${MUTEX_KEY}) is not held" "$out" \
      || { echo "MEASURE_FAIL (c): the refusal is not the unheld-mutex one"; return 1; }

    # (d) A5 — the bypass seam, against the mode that COMMITS. The mutex IS held
    #     here, so the only thing this leg can be measuring is the bypass refusal.
    hold_mutex || return 1
    local ARM_REQUIRE_MUTEX=0
    out="$SELFTEST_TMPD/a6d.out"; rc=0
    arm_env restore a6d > "$out" 2>&1 || rc=$?
    cat "$out"
    [ "$rc" -eq 1 ] || { echo "MEASURE_FAIL (d): RESTORE_REQUIRE_MUTEX=0 with --mode restore exited ${rc}, expected 1. The bypass removed the only guard keeping other CI out of a shared database during DROP SCHEMA public CASCADE."; return 1; }
    grep -aq 'would bypass the shared-TEST mutex check, and this is --mode restore' "$out" \
      || { echo "MEASURE_FAIL (d): the refusal is not the bypass one — some other guard fired, so the bypass branch is unmeasured"; return 1; }
    n=$(lane_q "SELECT count(*) FROM pg_tables WHERE schemaname='public' AND tablename='e2e_leftover';")
    [ "$n" = "1" ] || { echo "MEASURE_FAIL (d): the stray table is gone (count=${n}) — the bypass refusal did NOT fire before the first write."; return 1; }
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
    # ⛔ A11's SUBJECT. A second publication, `FOR ALL TABLES`, alongside the
    # fixture's row-based `supabase_realtime`. `pg_publication_tables` EXPANDS it
    # over every public table — including `e2e_leftover`, which the dump does NOT
    # re-create — while `pg_publication_rel` holds no row for any of them. Without
    # the `NOT p.puballtables` filter the census emits those expanded rows as
    # survivors and refusal 7 kills this GREEN arm naming `pub:public.e2e_leftover`
    # — the wrong cause, for a publication that needs no re-ADD at all.
    psql "$lane_dsn" -X -q -v ON_ERROR_STOP=1 \
      -c "CREATE PUBLICATION fixture_all_tables FOR ALL TABLES;" >/dev/null
    local out="$SELFTEST_TMPD/g-preflight.out"
    local rc=0
    arm_env preflight > "$out" 2>&1 || rc=$?
    cat "$out"
    [ "$rc" -eq 0 ] || { echo "MEASURE_FAIL: --run --mode preflight exited ${rc}, expected 0"; return 1; }
    grep -aq 'mode=preflight' "$out" || { echo "MEASURE_FAIL: the output does not carry 'mode=preflight'"; return 1; }
    grep -aq 'post-census == pre-census' "$out" || { echo "MEASURE_FAIL: the preflight did not report 'post-census == pre-census'"; return 1; }
    # ⛔ THE POSITIVE HALF OF ARM 24's `no_write_check` (2026-09-09 review fix).
    # Arm 24 asserts the literal `pre-census (read-only)` is ABSENT; a pure
    # negative assertion goes green when the banner is merely REWORDED, so it
    # could pass for the wrong reason forever. Nothing else pinned that string.
    # This is the leg where the banner MUST print — a preflight that reaches the
    # database — so the pair together proves the string exists and is absent only
    # when it should be. ⚠️ Reword the banner and this arm goes RED first, which
    # is the point.
    grep -aq 'pre-census (read-only)' "$out" \
      || { echo "MEASURE_FAIL: a preflight that ran to completion did not print the 'pre-census (read-only)' banner. Arm 24's no-write assertion greps for that exact literal, so if it no longer prints, arm 24 is passing vacuously."; return 1; }
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
    # ⛔ A10's SUBJECT. Survivor class (a) is put into a NON-DEFAULT enabled state
    # before the restore. `pg_get_triggerdef()` never emits that state, so without
    # the census's `ALTER TABLE … TRIGGER` companion the trigger comes back
    # ENABLED-ON-ORIGIN — firing when it was configured not to — and a key-only
    # comparison cannot see it. It is `ENABLE REPLICA` rather than `DISABLE` so
    # the state is one a real deployment uses deliberately, and so the arm cannot
    # be satisfied by a trigger that simply failed to be created.
    psql "$lane_dsn" -X -q -v ON_ERROR_STOP=1 \
      -c "ALTER TABLE auth.users ENABLE REPLICA TRIGGER on_auth_user_created;" >/dev/null
    local n0
    n0=$(lane_q "SELECT tgenabled FROM pg_trigger WHERE tgname='on_auth_user_created' AND NOT tgisinternal;")
    [ "$n0" = "R" ] || { echo "MEASURE_FAIL: the premise is broken — on_auth_user_created is in state '${n0}', not 'R', so the round-trip below would prove nothing."; return 1; }
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
    n=$(lane_q "SELECT tgenabled FROM pg_trigger WHERE tgname='on_auth_user_created' AND NOT tgisinternal;")
    [ "$n" = "R" ] || { echo "MEASURE_FAIL (A10): survivor class (a) came back in state '${n}', not the 'R' (ENABLE REPLICA) it was censused in. pg_get_triggerdef() does not emit tgenabled, so the trigger was silently re-created ENABLED-ON-ORIGIN — it now fires where it was configured not to, and a key-only comparison agrees the survivor round-tripped."; return 1; }
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

  # ═══ ARM 19 (A1) — ZERO censused survivors: the closure still refuses ══════
  # ⛔ THE ARM THIS SCRIPT MOST NEEDED AND DID NOT HAVE. Eighteen arms all ran with
  # a NON-EMPTY survivor census, so the `ARRAY[NULL::text]` rendering of the empty
  # case was never executed by any of them — and in that case the B2 closure did
  # not refuse ANYTHING. A guard that is off exactly when the census is empty is a
  # guard that is off exactly when there is least to lose track of.
  arm_empty_survivor_census() {
    setup_lane no-survivors || return 1
    local n
    # The premise, measured: if this overlay leaves ANY survivor behind, the arm is
    # exercising the ordinary non-empty path and proves nothing about A1.
    n=$(lane_q "SELECT (SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace s ON s.oid=c.relnamespace JOIN pg_proc p ON p.oid=t.tgfoid JOIN pg_namespace pn ON pn.oid=p.pronamespace WHERE NOT t.tgisinternal AND s.nspname<>'public' AND pn.nspname='public')
                 + (SELECT count(*) FROM pg_policies WHERE schemaname<>'public' AND (coalesce(qual,'') LIKE '%public.%' OR coalesce(with_check,'') LIKE '%public.%'))
                 + (SELECT count(*) FROM pg_publication_tables WHERE schemaname='public');")
    [ "$n" = "0" ] || { echo "MEASURE_FAIL: the overlay left ${n} survivor(s) behind, so this arm runs the NON-empty path and measures nothing about the empty one."; return 1; }
    local out="$SELFTEST_TMPD/a19.out" rc=0
    arm_env restore a19 > "$out" 2>&1 || rc=$?
    cat "$out"
    [ "$rc" -eq 1 ] || { echo "MEASURE_FAIL: with ZERO censused survivors the restore exited ${rc}, expected 1. This is A1: the closure rendered ARRAY[NULL::text], every \`r.key = ANY (v_keys)\` was SQL NULL, plpgsql read \`IF NULL\` as false, and every cross-schema dependent was CASCADE-dropped into a COMMITTED restore."; return 1; }
    grep -aq 'survivors censused: 0' "$out" \
      || { echo "MEASURE_FAIL: the run does not report a survivor census of 0 — the empty branch was not the one exercised"; return 1; }
    grep -aq 'analytics.v_leftover' "$out" \
      || { echo "MEASURE_FAIL: the abort does not NAME the lost dependent"; return 1; }
    grep -aq 'NOT a censused survivor' "$out" \
      || { echo "MEASURE_FAIL: the abort is not the derived-census closure's — it stopped for some OTHER reason, so the empty-array case is still unmeasured"; return 1; }
    n=$(lane_q "SELECT count(*) FROM pg_views WHERE schemaname='analytics' AND viewname='v_leftover';")
    [ "$n" = "1" ] || { echo "MEASURE_FAIL: analytics.v_leftover is GONE (count=${n}) — it was CASCADE-dropped and the transaction committed anyway."; return 1; }
    n=$(lane_q "SELECT count(*) FROM pg_tables WHERE schemaname='public' AND tablename='e2e_leftover';")
    [ "$n" = "1" ] || { echo "MEASURE_FAIL: the stray table is gone (count=${n}) — the transaction did not roll back."; return 1; }
    return 0
  }

  # ═══ ARM 20 (A2) — the marker names NEITHER TEST NOR PROD ══════════════════
  # ⛔ THE THIRD BRANCH OF THE IDENTITY REFUSAL, PREVIOUSLY UNARMED. Arm 2 covers
  # a NULL marker and arm 3 a marker matching BOTH regexes; the EXPECT branch —
  # a marker that is present, readable, and simply does not name TEST — had no
  # arm at all, so deleting it left the self-test green. That is the branch a
  # THIRD project's database would land in.
  #
  # `quantalyze staging fixture` matches neither RESTORE_EXPECT_MARKER_RE (whole
  # word `test`; `staging` contains none) nor RESTORE_REFUSE_MARKER_RE (`prod`).
  arm_marker_foreign() {
    setup_lane || return 1
    psql "$lane_dsn" -X -q -v ON_ERROR_STOP=1 \
      -c "COMMENT ON DATABASE ${lane_db} IS 'quantalyze staging fixture';" >/dev/null
    local out="$SELFTEST_TMPD/a20.out" rc=0
    arm_env preflight a20 > "$out" 2>&1 || rc=$?
    cat "$out"
    [ "$rc" -eq 1 ] || { echo "MEASURE_FAIL: a marker naming neither TEST nor PROD exited ${rc}, expected 1"; return 1; }
    grep -aq 'does not name TEST' "$out" \
      || { echo "MEASURE_FAIL: the refusal is not the EXPECT one — the NULL or the PROD branch fired instead, so the 'present but foreign' branch is still unmeasured"; return 1; }
    # ⛔ The marker TEXT must NOT be echoed: this log is public and the marker can
    # name a project. The refusal says so; this asserts it kept its word.
    if grep -aq 'staging fixture' "$out"; then
      echo "MEASURE_FAIL: the run PRINTED the identity marker's text. This log is public and the marker names a project."
      return 1
    fi
    local n
    n=$(lane_q "SELECT count(*) FROM pg_tables WHERE schemaname='public' AND tablename='e2e_leftover';")
    [ "$n" = "1" ] || { echo "MEASURE_FAIL: the stray table is gone (count=${n}) — the marker refusal did NOT fire before the first write."; return 1; }
    return 0
  }

  # ═══ ARM 21 (A3) — the migration corpus: three refusals, none of them armed ═
  # Refusal 4 has three exits and none had an arm. The charset one is the ONLY
  # interpolation gate in this script — every basename below it is pasted into an
  # INSERT — so an unarmed charset guard is an unarmed injection boundary.
  #
  # Pure filesystem: all three fire before the first connection, so no lane is
  # needed and the legs are cheap.
  arm_bad_migration_corpus() {
    local out rc
    local scratch="$SELFTEST_TMPD/mig-arm21"
    rm -rf "$scratch"

    # (a) the charset refusal. `;` is the character that would end the INSERT and
    #     start a statement of the filename's choosing.
    mkdir -p "$scratch/bad"
    : > "$scratch/bad/20260101000000_bad;name.sql"
    local ARM_MIGRATIONS_DIR="$scratch/bad"
    out="$SELFTEST_TMPD/a21a.out"; rc=0
    arm_env preflight a21a > "$out" 2>&1 || rc=$?
    cat "$out"
    [ "$rc" -eq 1 ] || { echo "MEASURE_FAIL (a): a migration filename carrying ';' exited ${rc}, expected 1. That basename is interpolated into an INSERT."; return 1; }
    grep -aq 'refuses to interpolate into SQL' "$out" \
      || { echo "MEASURE_FAIL (a): the refusal is not the charset one — some other guard fired, so the only interpolation gate in this script is unmeasured"; return 1; }
    grep -aq '20260101000000_bad;name' "$out" \
      || { echo "MEASURE_FAIL (a): the refusal does not echo the offending basename, so a reader cannot see which file to fix"; return 1; }

    # (b) the EMPTY corpus. Zero migrations means the glob drifted, not that the
    #     ledger is clean — a seed of nothing is not a restore.
    mkdir -p "$scratch/empty"
    ARM_MIGRATIONS_DIR="$scratch/empty"
    out="$SELFTEST_TMPD/a21b.out"; rc=0
    arm_env preflight a21b > "$out" 2>&1 || rc=$?
    cat "$out"
    [ "$rc" -eq 1 ] || { echo "MEASURE_FAIL (b): an EMPTY migrations dir exited ${rc}, expected 1. An empty repo-side list would seed an empty ledger and report success."; return 1; }
    grep -aq 'The repo-side list is EMPTY' "$out" \
      || { echo "MEASURE_FAIL (b): the refusal is not the empty-corpus one"; return 1; }

    # (c) the dir is ABSENT altogether — a moved directory must not read as a
    #     clean one.
    ARM_MIGRATIONS_DIR="$scratch/does-not-exist"
    out="$SELFTEST_TMPD/a21c.out"; rc=0
    arm_env preflight a21c > "$out" 2>&1 || rc=$?
    cat "$out"
    [ "$rc" -eq 1 ] || { echo "MEASURE_FAIL (c): an ABSENT migrations dir exited ${rc}, expected 1"; return 1; }
    grep -aq 'migrations dir not found' "$out" \
      || { echo "MEASURE_FAIL (c): the refusal does not say the migrations dir is missing"; return 1; }
    return 0
  }

  # ═══ ARM 22 — GREEN: reference data is replayed, gated and CENSUSED ════════
  # The end-to-end shape of Phase 164.8.1: the fixture's one allowlisted INSERT
  # lands, the gate finds the table non-empty, the transaction COMMITS, and the
  # reading survives in the census rather than on the `restore:` summary line.
  #
  # ⛔ THE CENSUS FILES, NOT THE INTERLEAVED LOG. `pre-census.txt` and
  # `post-census.txt` are two runs of ONE program, so `=0` then `=2` is a
  # before/after of the same measurement. Grepping the combined stdout would let a
  # `=2` from either side satisfy both halves.
  arm_g_refdata_replay() {
    setup_lane || return 1
    local n0
    n0=$(lane_q "SELECT count(*) FROM public.fx_keep;")
    [ "$n0" = "0" ] || { echo "MEASURE_FAIL: the premise is broken — public.fx_keep already holds ${n0} row(s) before the restore, so a post-restore count of 2 would not evidence the replay."; return 1; }
    local out="$SELFTEST_TMPD/a22.out" rc=0
    arm_env restore a22 > "$out" 2>&1 || rc=$?
    cat "$out"
    [ "$rc" -eq 0 ] || { echo "MEASURE_FAIL: the reference-data restore exited ${rc}, expected 0"; return 1; }
    grep -aqxF 'refdata:public.fx_keep=0' "$SELFTEST_TMPD/out-a22/pre-census.txt" \
      || { echo "MEASURE_FAIL: the PRE-census does not read refdata:public.fx_keep=0. Either the census row is missing or the table was already seeded, and the post-census reading below would evidence nothing."; return 1; }
    grep -aqxF 'refdata:public.fx_keep=3' "$SELFTEST_TMPD/out-a22/post-census.txt" \
      || { echo "MEASURE_FAIL: the POST-census does not read refdata:public.fx_keep=3 — the replay did not land, or its reading never reached the census."; return 1; }
    local n
    n=$(lane_q "SELECT count(*) FROM public.fx_keep;")
    [ "$n" = "3" ] || { echo "MEASURE_FAIL: public.fx_keep holds ${n} row(s) after the restore, expected the 3 the two allowlisted INSERTs replay. A census row is a reading; this is the database."; return 1; }
    n=$(lane_q "SELECT string_agg(label, ',' ORDER BY label) FROM public.fx_keep;")
    [ "$n" = "ref_a,ref_b,ref_c" ] || { echo "MEASURE_FAIL: public.fx_keep carries '${n}', not the three labels the migration's ORIGINAL bytes insert — the replay is not byte-faithful."; return 1; }
    n=$(lane_q "SELECT count(*) FROM pg_tables WHERE schemaname='public' AND tablename='e2e_leftover';")
    [ "$n" = "0" ] || { echo "MEASURE_FAIL: the stray table survived (count=${n}) — this arm did not run a real restore."; return 1; }
    # The summary line must be BYTE-IDENTICAL to arm 9's: counts belong in the
    # census, and a `refdata=` field here would break three arms' exact pins.
    grep -aqxF 'restore: tables=2 policies=1 functions=2 ledger_rows=3 survivors=3/3 filtered=1 mode=restore' "$out" \
      || { echo "MEASURE_FAIL: the exact summary line changed — the reference-data replay must not add a field to it"; return 1; }
    return 0
  }

  # ═══ ARM 23 — RED: the gate BITES, on scratch copies, and rolls back ═══════
  # ⛔ THE PHASE'S FALSIFIER. Three legs, each mutating a DIFFERENT link of the
  # chain on its own copy of this script under the harness's mktemp dir — never
  # the checkout, never a byte backup, never `git checkout --` (L-04).
  #
  # ⛔ THE MUTATION IS ON THE **OBSERVED** SIDE, never the expected one. The
  # allowlist still names public.fx_keep and the gate still counts it; only the
  # replay, its search_path bracket or the completeness of the rows is broken. A
  # mutation of the allowlist would move both sides at once and the gate could not
  # fire — the same self-contradiction arm 11 records for the shape derivation.
  arm_refdata_gate_bites() {
    local out rc n copy

    # (a) THE REPLAY IS GONE. The one line that concatenates the extractor's SQL
    #     into the transaction is deleted; everything else, gate included, stands.
    copy="$SELFTEST_TMPD/refdata-no-replay.sh"
    awk '!d && index($0, "cat \"$RESTORE_OUT_DIR/refdata.sql\" >> \"$out\"") > 0 { d = 1; next }
         { print }
         END { if (!d) { print "ANCHOR-NOT-FOUND" > "/dev/stderr"; exit 1 } }' "$0" > "$copy" \
      || { echo "MEASURE_FAIL (a): could not build the no-replay scratch copy — the replay anchor moved."; return 1; }
    if grep -aq 'cat "\$RESTORE_OUT_DIR/refdata.sql" >> "\$out"' "$copy"; then
      echo "MEASURE_FAIL (a): the scratch copy STILL carries the replay line, so this leg would test the unmutated script."
      return 1
    fi
    setup_lane || return 1
    out="$SELFTEST_TMPD/a23a.out"; rc=0
    run_leg "$copy" restore a23a > "$out" 2>&1 || rc=$?
    cat "$out"
    [ "$rc" -eq 1 ] || { echo "MEASURE_FAIL (a): a restore whose reference replay was deleted exited ${rc}, expected 1. This is the Phase 164.8 defect committing: a ledger that swears every seed migration applied over tables with no rows."; return 1; }
    grep -aq 'reference table(s) public.fx_keep are EMPTY after the replay' "$out" \
      || { echo "MEASURE_FAIL (a): the abort is not the reference-data gate's, and does not NAME the empty table — some other guard fired, so the gate is still unmeasured"; return 1; }
    n=$(lane_q "SELECT count(*) FROM pg_tables WHERE schemaname='public' AND tablename='e2e_leftover';")
    [ "$n" = "1" ] || { echo "MEASURE_FAIL (a): the stray table is gone (count=${n}) — the gate REFUSED but the transaction did not ROLL BACK, so TEST was left half-restored."; return 1; }

    # (b) THE SEARCH_PATH BRACKET IS GONE (RESEARCH Pitfall 1). The replayed
    #     statements are the migrations' original bytes and name their target
    #     UNQUALIFIED; with the path left at `pg_catalog` every one of them fails
    #     to resolve. Without this leg the bracket is an assertion nobody has seen
    #     matter — it would look like hygiene and be deleted by the next reader.
    copy="$SELFTEST_TMPD/refdata-no-searchpath.sh"
    awk '!d && $0 == "SET LOCAL search_path = public, pg_catalog;" { d = 1; next }
         { print }
         END { if (!d) { print "ANCHOR-NOT-FOUND" > "/dev/stderr"; exit 1 } }' "$0" > "$copy" \
      || { echo "MEASURE_FAIL (b): could not build the no-search_path scratch copy — the bracket anchor moved."; return 1; }
    if grep -aqxF 'SET LOCAL search_path = public, pg_catalog;' "$copy"; then
      echo "MEASURE_FAIL (b): the scratch copy STILL carries the search_path bracket."
      return 1
    fi
    setup_lane || return 1
    out="$SELFTEST_TMPD/a23b.out"; rc=0
    run_leg "$copy" restore a23b > "$out" 2>&1 || rc=$?
    cat "$out"
    [ "$rc" -eq 1 ] || { echo "MEASURE_FAIL (b): a restore whose replay ran under \`pg_catalog\` alone exited ${rc}, expected 1"; return 1; }
    grep -aq 'relation "fx_keep" does not exist' "$out" \
      || { echo "MEASURE_FAIL (b): the abort does not report an unresolvable unqualified target, so the bracket's absence is not what stopped this run and Pitfall 1 is still unmeasured"; return 1; }
    n=$(lane_q "SELECT count(*) FROM pg_tables WHERE schemaname='public' AND tablename='e2e_leftover';")
    [ "$n" = "1" ] || { echo "MEASURE_FAIL (b): the stray table is gone (count=${n}) — the failed replay did not roll back."; return 1; }

    # (c) A PARTIAL REPLAY — the W1 leg. One registry row is deleted INSIDE the
    #     transaction, immediately after the replay, so the table is NOT empty and
    #     leg (a)'s loop cannot see it. Only the kind-admission invariant can:
    #     `fx_keep_kind_check` still admits `ref_b` and `public.fx_keep` no longer
    #     carries it. Without this leg that invariant would be decorative — on the
    #     lane its two objects would not exist, `v_missing` would be NULL forever,
    #     and it would pass vacuously for the life of the script.
    copy="$SELFTEST_TMPD/refdata-partial.sh"
    awk '{ print }
         !d && index($0, "cat \"$RESTORE_OUT_DIR/refdata.sql\" >> \"$out\"") > 0 {
           print "  echo \"DELETE FROM public.fx_keep WHERE label = \047ref_b\047;\" >> \"$out\"  # arm 23(c): a PARTIAL replay, scratch copy only"
           d = 1
         }
         END { if (!d) { print "ANCHOR-NOT-FOUND" > "/dev/stderr"; exit 1 } }' "$0" > "$copy" \
      || { echo "MEASURE_FAIL (c): could not build the partial-replay scratch copy — the replay anchor moved."; return 1; }
    grep -aq 'DELETE FROM public.fx_keep WHERE label' "$copy" \
      || { echo "MEASURE_FAIL (c): the scratch copy does not carry the injected DELETE, so this leg would test an intact replay."; return 1; }
    setup_lane || return 1
    out="$SELFTEST_TMPD/a23c.out"; rc=0
    run_leg "$copy" restore a23c > "$out" 2>&1 || rc=$?
    cat "$out"
    [ "$rc" -eq 1 ] || { echo "MEASURE_FAIL (c): a PARTIAL replay exited ${rc}, expected 1. The registry lost a row its admission CHECK still admits and the restore COMMITTED anyway — the invariant is decorative."; return 1; }
    grep -aq 'fx_keep_kind_check admits kind(s) ref_b that public.fx_keep does not carry' "$out" \
      || { echo "MEASURE_FAIL (c): the abort is not the partial-replay invariant's, or does not NAME the missing kind — an invariant that fires without saying what is missing cannot be acted on"; return 1; }
    n=$(lane_q "SELECT count(*) FROM pg_tables WHERE schemaname='public' AND tablename='e2e_leftover';")
    [ "$n" = "1" ] || { echo "MEASURE_FAIL (c): the stray table is gone (count=${n}) — the invariant refused but the transaction did not roll back."; return 1; }

    # (d) A WHOLE STATEMENT'S WORTH OF ROWS IS GONE — the SHORT branch's ONLY
    #     falsifier. Leg (c) above deletes ONE row and leaves 2 rows against 2
    #     pinned statements, so the count floor still holds and the registry
    #     invariant is what fires. This leg deletes TWO, taking the table to 1 row
    #     against 2 statements: the floor BITES, and it bites FIRST, before the
    #     invariant leg (c) measures.
    #
    # ⛔ WHY THIS ARM EXISTS AT ALL (review finding WR-01). The `t.n < t.expected`
    #     half of the gate — this phase's headline fix, the one that catches a
    #     partial replay leaving its tables NON-EMPTY — shipped on 2026-09-09 with
    #     no permanent arm anywhere in this suite and no source-text pin. It had
    #     been driven RED once, by hand, on a scratch copy that was then thrown
    #     away. Reverting the comparison to `t.n = 0` turned NOTHING red. That is
    #     the defect class this whole phase exists to remove, reproduced inside the
    #     phase's own new code. Delete this leg and the SHORT branch goes
    #     unfalsifiable again.
    copy="$SELFTEST_TMPD/refdata-short.sh"
    awk '{ print }
         !d && index($0, "cat \"$RESTORE_OUT_DIR/refdata.sql\" >> \"$out\"") > 0 {
           print "  echo \"DELETE FROM public.fx_keep WHERE label IN (\047ref_b\047, \047ref_c\047);\" >> \"$out\"  # arm 23(d): a SHORT replay, scratch copy only"
           d = 1
         }
         END { if (!d) { print "ANCHOR-NOT-FOUND" > "/dev/stderr"; exit 1 } }' "$0" > "$copy" \
      || { echo "MEASURE_FAIL (d): could not build the short-replay scratch copy — the replay anchor moved."; return 1; }
    grep -aq "DELETE FROM public.fx_keep WHERE label IN" "$copy" \
      || { echo "MEASURE_FAIL (d): the scratch copy does not carry the injected two-row DELETE, so this leg would test an intact replay."; return 1; }
    setup_lane || return 1
    out="$SELFTEST_TMPD/a23d.out"; rc=0
    run_leg "$copy" restore a23d > "$out" 2>&1 || rc=$?
    cat "$out"
    [ "$rc" -eq 1 ] || { echo "MEASURE_FAIL (d): a SHORT replay exited ${rc}, expected 1. The table lost a whole statement's worth of rows and stayed NON-EMPTY, and the restore COMMITTED — the \`t.n < t.expected\` half of the gate is not biting, which is exactly the state that made this arm necessary."; return 1; }
    grep -aq 'reference table(s) are SHORT after the replay' "$out" \
      || { echo "MEASURE_FAIL (d): the abort is not the SHORT branch's, or does not NAME the short table. If it reads EMPTY instead, the fixture lost too many rows and this leg is measuring the n=0 branch leg (a) already covers."; return 1; }
    grep -aq 'public.fx_keep (1 row(s) for 2 statement(s))' "$out" \
      || { echo "MEASURE_FAIL (d): the SHORT abort does not report the measured rows against the pinned statements, so the diagnosis it exists to give is missing."; return 1; }
    n=$(lane_q "SELECT count(*) FROM pg_tables WHERE schemaname='public' AND tablename='e2e_leftover';")
    [ "$n" = "1" ] || { echo "MEASURE_FAIL (d): the stray table is gone (count=${n}) — the floor refused but the transaction did not roll back."; return 1; }
    return 0
  }

  # ═══ ARM 24 — RED: a bad reference-data allowlist, refused BEFORE any write ═
  # ⛔ THIS COMMENT'S NUMBERS ARE MEASURED, AND SO IS THE GAP THEY ADMIT. It said
  # "refusal 8 has three reason branches and this arm drives each by name" until
  # 2026-09-09; refusal 8 had SEVEN then, and has ELEVEN now that the review added
  # the kind-registry seam refusals and the trailer's count half. Regenerate with
  #
  #   awk '/^refuse_bad_refdata_allowlist\(\)/,/^}/' scripts/restore-test-from-baseline.sh | grep -c 'fail "'
  #
  # (2026-09-09: ELEVEN). This is the same over-claim class the W2 block at the
  # foot of this file exists to correct, so it is corrected the same way rather
  # than extended.
  #
  # THIS ARM DRIVES THREE OF THE ELEVEN, each by its named message: (a) the
  # extractor's own refusal being surfaced, (b) an allowlist with zero entries,
  # (c) an extractor that exits 0 emitting no trailer.
  #
  # EIGHT HAVE NO ARM, and saying so is the point: allowlist file not found;
  # extractor file not found; node not on PATH; the extractor naming a table
  # outside `[a-z0-9_.]`; a trailer whose count half is absent or non-numeric;
  # and the three seam refusals on REFDATA_KIND_REGISTRY,
  # REFDATA_KIND_REGISTRY_COL and REFDATA_KIND_CHECK. What IS claimed for refusal
  # 8, and what the self-test line at the foot of this file claims, is that it has
  # at least one arm asserting a NAMED message — not that every branch is armed.
  #
  # All three driven branches are pure filesystem, so they fire before the first
  # connection: the arm asserts the pre-census banner NEVER PRINTED, which is what
  # makes "before any write" a measurement rather than a claim about ordering in
  # the source. ⚠️ That is a NEGATIVE assertion and cannot stand alone — arm 8
  # pins the same literal POSITIVELY on a preflight that must print it, so a
  # reworded banner goes RED there instead of silently greening this arm.
  arm_bad_refdata_allowlist() {
    local out rc
    local scratch="$SELFTEST_TMPD/refdata-arm24"
    rm -rf "$scratch"
    mkdir -p "$scratch"

    # `if`, not `grep … && { … }`: under `set -e` a failing grep at the head of an
    # AND-list is the list's status, and the whole function would die on the
    # PASSING case.
    no_write_check() {
      if grep -aq 'pre-census (read-only)' "$1"; then
        echo "MEASURE_FAIL ($2): the pre-census RAN. The refusal did not fire before the first read of the database, let alone before the first write."
        return 1
      fi
      return 0
    }

    # (a) A PINNED COUNT THAT NO LONGER MATCHES. The extractor refuses; this
    #     script must surface that refusal rather than restore without the rows.
    printf '20260103000000_fixture_c.sql\tpublic.fx_keep\t3\t# arm 24(a): pins 3 where 2 is measured\n' \
      > "$scratch/count-drift.txt"
    local ARM_REFDATA_ALLOWLIST="$scratch/count-drift.txt"
    out="$SELFTEST_TMPD/a24a.out"; rc=0
    arm_env preflight a24a > "$out" 2>&1 || rc=$?
    cat "$out"
    [ "$rc" -eq 1 ] || { echo "MEASURE_FAIL (a): an allowlist whose pinned count is wrong exited ${rc}, expected 1"; return 1; }
    grep -aq 'reference-data extraction refused' "$out" \
      || { echo "MEASURE_FAIL (a): this script did not report the extraction as REFUSED — a non-zero extractor was swallowed"; return 1; }
    grep -aq 'pins 3 top-level statement(s) but 2 were measured' "$out" \
      || { echo "MEASURE_FAIL (a): the extractor's own stderr was not echoed, so a reader sees that something was refused but not WHICH number moved"; return 1; }
    if [ -e "$SELFTEST_TMPD/out-a24a/refdata.sql" ]; then
      echo "MEASURE_FAIL (a): refdata.sql exists under the out dir — the extraction ran to a file despite being refused."
      return 1
    fi
    no_write_check "$out" a || return 1

    # (b) AN EMPTY ALLOWLIST. Zero entries replays nothing, and a restore that
    #     replays nothing is the Phase 164.8 defect wearing a green tick. Checked
    #     by THIS script rather than delegated: the extractor's own empty-allowlist
    #     refusal is a second reading of the same fact, and a branch whose only arm
    #     reaches the other layer is unmeasured.
    : > "$scratch/empty.txt"
    ARM_REFDATA_ALLOWLIST="$scratch/empty.txt"
    out="$SELFTEST_TMPD/a24b.out"; rc=0
    arm_env preflight a24b > "$out" 2>&1 || rc=$?
    cat "$out"
    [ "$rc" -eq 1 ] || { echo "MEASURE_FAIL (b): an EMPTY reference-data allowlist exited ${rc}, expected 1"; return 1; }
    grep -aq 'carries ZERO entries' "$out" \
      || { echo "MEASURE_FAIL (b): the refusal is not this script's empty-allowlist one"; return 1; }
    grep -aq 'that is the Phase 164.8 defect, not a clean run' "$out" \
      || { echo "MEASURE_FAIL (b): the refusal does not say what emptiness would silently produce"; return 1; }
    no_write_check "$out" b || return 1

    # (c) AN EXTRACTOR THAT EXITS 0 AND EMITS NOTHING. Not a hypothetical: a copy
    #     of the real extractor under a symlinked temp dir did exactly this until
    #     2026-09-09, because its main guard compared path SPELLINGS. Left
    #     unrefused, the gate's VALUES list would be EMPTY and the gate would pass
    #     vacuously on every future restore — green, having done nothing.
    printf '#!/usr/bin/env node\nprocess.exit(0);\n' > "$scratch/silent-extractor.mjs"
    ARM_REFDATA_ALLOWLIST="$FIXTURES/refdata-allowlist.txt"
    local ARM_REFDATA_EXTRACTOR="$scratch/silent-extractor.mjs"
    out="$SELFTEST_TMPD/a24c.out"; rc=0
    arm_env preflight a24c > "$out" 2>&1 || rc=$?
    cat "$out"
    [ "$rc" -eq 1 ] || { echo "MEASURE_FAIL (c): an extractor that exits 0 emitting nothing was ACCEPTED (exit ${rc}), so the in-transaction gate would have been built over an empty table list and passed vacuously"; return 1; }
    grep -aq 'emitted NO `-- refdata-expect:` trailer' "$out" \
      || { echo "MEASURE_FAIL (c): the refusal is not the zero-trailer one"; return 1; }
    grep -aq 'would pass vacuously' "$out" \
      || { echo "MEASURE_FAIL (c): the refusal does not say WHY an empty table list is unacceptable"; return 1; }
    no_write_check "$out" c || return 1
    return 0
  }

  # ═══ ARM 26 — backticks in an unquoted TXN heredoc ════════════════════════
  # Two legs, and the SECOND is the one that matters: a refusal that fires on a
  # fixture proves the detector works, not that the file it guards is clean.
  arm_backtick_in_txn_heredoc() {
    local d="$SELFTEST_TMPD/a26"; mkdir -p "$d" out=""

    # (a) THE DETECTOR FIRES. A fixture carrying the exact shape found on
    #     2026-09-09: a backtick inside an SQL comment inside an unquoted heredoc.
    {
      printf 'cat >> "$out" <<TXN_FIXTURE\n'
      printf -- '  -- a comment mentioning `RAISE` inside the body\n'
      printf 'TXN_FIXTURE\n'
    } > "$d/dirty.sh"
    out="$SELFTEST_TMPD/a26a.out"
    ( refuse_backticks_in_txn_heredocs "$d/dirty.sh" ) > "$out" 2>&1 && {
      echo "MEASURE_FAIL (a): a backtick inside an unquoted <<TXN_* heredoc was ACCEPTED. bash would command-substitute that span while assembling a destructive restore."; cat "$out"; return 1; }
    grep -aq 'a backtick appears inside an UNQUOTED heredoc' "$out" \
      || { echo "MEASURE_FAIL (a): something refused, but not this guard — so the guard is still unmeasured."; cat "$out"; return 1; }
    grep -aq 'RAISE' "$out" \
      || { echo "MEASURE_FAIL (a): the refusal does not print the offending LINE, so a reader is told a backtick exists somewhere and not where."; return 1; }

    # (b) IT DOES NOT FIRE ON PROSE OUTSIDE A HEREDOC, or every shell comment in
    #     this file would be an error and the guard would be reverted on sight.
    {
      printf '# a shell comment mentioning `RAISE`, outside any heredoc\n'
      printf 'cat >> "$out" <<TXN_FIXTURE\n'
      printf -- '  -- plain prose, no markup\n'
      printf -- '  -- an ESCAPED \\`backtick\\` is literal in an unquoted heredoc and must be ACCEPTED\n'
      printf 'TXN_FIXTURE\n'
      printf '# another backticked `comment` after it closed\n'
    } > "$d/clean.sh"
    out="$SELFTEST_TMPD/a26b.out"
    ( refuse_backticks_in_txn_heredocs "$d/clean.sh" ) > "$out" 2>&1 \
      || { echo "MEASURE_FAIL (b): the guard refused a file whose backticks are all OUTSIDE the heredoc. It would make every shell comment in this script an error."; cat "$out"; return 1; }

    # (d) ⛔ THE FOUR EVASIONS. The first cut of this guard keyed on
    #     /<<TXN_[A-Z_]+$/ and the phase verification got a live backtick past it
    #     four ways. Each is its own fixture here, because a guard named for a
    #     general property while testing a narrow one is how the next reader
    #     concludes they are covered. NONE of these shapes occurs in this script
    #     today — which is precisely why nothing but this leg would notice.
    local ev evname
    for ev in 'X<<-TXN_A' 'X<<TXN_A ' 'X<<TXN_Gate2' 'X<<PLAIN_EOF'; do
      evname=$(printf '%s' "$ev" | sed 's/^X//')
      {
        printf 'cat >> "$out" <%s\n' "${evname#<}"
        printf -- '  -- prose carrying a live `RAISE` backtick\n'
        printf '%s\n' "$(printf '%s' "$evname" | sed -E 's/^<<-?[ \t]*//; s/[ \t]*$//')"
      } > "$d/evade.sh"
      out="$SELFTEST_TMPD/a26d.out"
      ( refuse_backticks_in_txn_heredocs "$d/evade.sh" ) > "$out" 2>&1 && {
        echo "MEASURE_FAIL (d): the delimiter spelling '${evname}' walked a LIVE backtick past the guard. bash substitutes it all the same — the delimiter's spelling is not what makes a heredoc unquoted."; cat "$d/evade.sh"; return 1; }
    done

    # (e) A QUOTED delimiter disables substitution entirely, so its body is safe
    #     by construction and must NOT be refused — otherwise the guard's fix is
    #     'quote the heredoc', which would break the interpolation the gate needs.
    {
      printf 'cat >> "$out" <<%sQUOTED%s\n' "'" "'"
      printf -- '  -- a `backtick` here is literal because the delimiter is quoted\n'
      printf 'QUOTED\n'
    } > "$d/quoted.sh"
    out="$SELFTEST_TMPD/a26e.out"
    ( refuse_backticks_in_txn_heredocs "$d/quoted.sh" ) > "$out" 2>&1 \
      || { echo "MEASURE_FAIL (e): the guard refused a QUOTED heredoc, whose body bash never expands. It would push readers toward quoting the gate's heredoc, which cannot be quoted."; cat "$out"; return 1; }

    # (f) ⛔ THE THREE SHAPES CODE REVIEW WR-01 PROVED LIVE ON 2026-09-09, after
    #     leg (d) had already closed four others. The matcher anchored the
    #     delimiter to end-of-line, so an opener whose delimiter is followed by a
    #     redirect or a pipe was not seen as an opener and its body went unscanned;
    #     and an indented terminator ended the scan even for a plain (non-dash)
    #     opener, which bash does not treat as a terminator at all. Measured, not
    #     argued: a fixture of the pipe shape carrying a live backticked echo came
    #     out of bash with the echo already executed.
    #     ⚠️ The fixtures are BUILT here rather than written literally, because a
    #     literal example opener in this file would itself read as one — that
    #     happened while fixing WR-01 and the widened matcher refused the whole
    #     script.
    local tail3 body3
    for tail3 in ' >/dev/null' ' | cat' 'INDENT'; do
      {
        if [ "$tail3" = 'INDENT' ]; then
          printf 'cat >> "$out" <%s%s\n' '<' 'TXN_WR01'
          printf -- '  -- prose carrying a live `RAISE` backtick\n'
          printf '    TXN_WR01\n'
          printf -- '  -- a SECOND live `RAISE` after the indented line\n'
          printf 'TXN_WR01\n'
        else
          printf 'cat >> "$out" <%s%s%s\n' '<' 'TXN_WR01' "$tail3"
          printf -- '  -- prose carrying a live `RAISE` backtick\n'
          printf 'TXN_WR01\n'
        fi
      } > "$d/wr01.sh"
      out="$SELFTEST_TMPD/a26f.out"
      ( refuse_backticks_in_txn_heredocs "$d/wr01.sh" ) > "$out" 2>&1 && {
        echo "MEASURE_FAIL (f): the opener trailer '${tail3}' walked a LIVE backtick past the guard. bash command-substitutes it while this script assembles a destructive restore; WR-01 proved the substitution executes."; cat "$d/wr01.sh"; return 1; }
    done

    # (g) THE CONTROL FOR (f). Widening the matcher must not make a printf that
    #     WRITES an opener read as one — that is what the end-of-line anchor was
    #     protecting, and this arm's own fixtures are written by exactly such a
    #     printf. Without this leg the fix for (f) could be "match everything",
    #     which would refuse this file forever.
    {
      printf "printf 'cat >> \"\$out\" <%s%s\\\\n'\n" '<' 'TXN_FIXTURE'
      printf -- '# a backtick `here` is outside any heredoc\n'
    } > "$d/printf.sh"
    out="$SELFTEST_TMPD/a26g.out"
    ( refuse_backticks_in_txn_heredocs "$d/printf.sh" ) > "$out" 2>&1 \
      || { echo "MEASURE_FAIL (g): a printf that WRITES an opener was read AS one, so the widened matcher now refuses files that contain no heredoc at all — including this script's own self-test fixtures."; cat "$out"; return 1; }

    # (c) ⛔ THE POINT OF THE ARM — THIS SCRIPT ITSELF. Legs (a) and (b) only
    #     prove the detector discriminates; they say nothing about the file the
    #     restore actually assembles its transaction from.
    out="$SELFTEST_TMPD/a26c.out"
    ( refuse_backticks_in_txn_heredocs "$0" ) > "$out" 2>&1 \
      || { echo "MEASURE_FAIL (c): THIS script carries a backtick inside an unquoted <<TXN_* heredoc."; cat "$out"; return 1; }
    return 0
  }

  # ═══ ARM 25 — the rollback VIEW normalises counts and nothing else ═════════
  # ⛔ THE FALSIFIER FOR CR-01'S FIX. `census_rollback_view` decides what the
  # preflight's "the database is unchanged" claim is allowed to notice. Get it too
  # WIDE and a mutable row count can abort a correctly rolled-back preflight (the
  # defect it was written for); get it too NARROW — say `s/^refdata:.*/x/` — and
  # the view stops noticing a reference table that VANISHED, which a rollback is
  # supposed to restore and which is the failure this instrument exists to catch.
  # Both directions are driven here, on fixtures, with no lane: the function is
  # pure text and deserves a pure-text arm.
  arm_census_rollback_view() {
    local d="$SELFTEST_TMPD/a25"; mkdir -p "$d"

    printf 'tables=2\npolicies=1\nrefdata:public.fx_keep=3\nrefdata:auth.users=7\nledger_rows=3\n' > "$d/pre.txt"

    # (a) A MUTABLE COUNT MOVED — the shared-TEST reality. The view must NOT see
    #     it, or a preflight that rolled back perfectly aborts.
    printf 'tables=2\npolicies=1\nrefdata:public.fx_keep=3\nrefdata:auth.users=9\nledger_rows=3\n' > "$d/post-count.txt"
    census_rollback_view "$d/pre.txt"        > "$d/v-pre.txt"
    census_rollback_view "$d/post-count.txt" > "$d/v-count.txt"
    cmp -s "$d/v-pre.txt" "$d/v-count.txt" \
      || { echo "MEASURE_FAIL (a): the rollback view still DIFFERS when only a reference row count moved. auth.users is outside \`public\` and feature/system flags are runtime-mutable on shared TEST, so this makes a correctly rolled-back preflight abort with 'Treat this database as modified.' — CR-01, unfixed."; diff "$d/v-pre.txt" "$d/v-count.txt"; return 1; }

    # (b) A REFERENCE TABLE VANISHED. `absent` is exactly what DROP SCHEMA leaves
    #     behind, and a rollback must undo it. The view MUST still see this.
    printf 'tables=2\npolicies=1\nrefdata:public.fx_keep=absent\nrefdata:auth.users=7\nledger_rows=3\n' > "$d/post-absent.txt"
    census_rollback_view "$d/post-absent.txt" > "$d/v-absent.txt"
    if cmp -s "$d/v-pre.txt" "$d/v-absent.txt"; then
      echo "MEASURE_FAIL (b): the rollback view does NOT differ when a reference table went ABSENT. The normalisation is too wide — it has stopped noticing the very thing DROP SCHEMA does, and the preflight would call a half-dropped database unchanged."
      return 1
    fi

    # (c) A STRUCTURAL COUNT MOVED. Nothing outside the refdata lines may be
    #     normalised, or the view stops proving the rollback at all.
    printf 'tables=3\npolicies=1\nrefdata:public.fx_keep=3\nrefdata:auth.users=7\nledger_rows=3\n' > "$d/post-tables.txt"
    census_rollback_view "$d/post-tables.txt" > "$d/v-tables.txt"
    if cmp -s "$d/v-pre.txt" "$d/v-tables.txt"; then
      echo "MEASURE_FAIL (c): the rollback view does NOT differ when \`tables=\` moved. The normalisation is eating structural census lines and the preflight proves nothing."
      return 1
    fi

    # (d) THE NORMALISATION IS VISIBLE, not a no-op that (a) would pass vacuously.
    grep -aqxF 'refdata:public.fx_keep=present' "$d/v-pre.txt" \
      || { echo "MEASURE_FAIL (d): the view did not rewrite a refdata count to \`present\`. If it rewrote nothing, leg (a) passed because the two files were already equal — it measured nothing."; return 1; }
    grep -aqxF 'refdata:public.fx_keep=absent' "$d/v-absent.txt" \
      || { echo "MEASURE_FAIL (d): the view rewrote \`absent\`, which is not a count. Leg (b) would then be passing for the wrong reason."; return 1; }
    grep -aqxF 'tables=2' "$d/v-pre.txt" \
      || { echo "MEASURE_FAIL (d): the view altered a structural line."; return 1; }
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
  run_arm "19 RED   ZERO censused survivors — the closure still refuses (A1)" 0 arm_empty_survivor_census
  run_arm "20 RED   identity marker names neither TEST nor PROD (A2)" 0 arm_marker_foreign
  run_arm "21 RED   migration corpus: bad charset, empty, absent (A3)" 0 arm_bad_migration_corpus
  run_arm "22 GREEN reference data replayed, gated and censused — the transaction commits" 0 arm_g_refdata_replay
  run_arm "23 RED   the reference-data gate BITES: no replay, no search_path, partial replay" 0 arm_refdata_gate_bites
  run_arm "24 RED   reference-data allowlist: count drift, empty, silent extractor" 0 arm_bad_refdata_allowlist
  run_arm "25 GREEN the preflight rollback view normalises mutable reference counts and NOTHING else (CR-01)" 0 arm_census_rollback_view
  run_arm "26 RED   a backtick inside ANY unquoted heredoc is refused — SEVEN evasions closed — and THIS script is clean" 0 arm_backtick_in_txn_heredoc

  release_mutex

  printf '%s\n' "${results[@]}"
  # ⛔ A4 — THE SUCCESS LINE PRINTS ONLY AFTER BOTH FAILURE CHECKS HAVE PASSED.
  # It used to print ABOVE them, so a 15-of-18 run emitted a full success
  # narrative — "seven refusals fire before any write, preflight rolls back
  # byte-for-byte …", the line's wording AT THAT TIME; it says eight now — and
  # only then the FAIL line. Both sibling gates order it
  # this way (scripts/test-ledger-drift-check.sh:667-671,
  # scripts/prod-body-drift-check.sh:560-564). Below both checks, `pass`, `total`
  # and EXPECTED_ARMS are all equal by construction, so the denominator is the
  # ratchet and says so.
  if [ "$total" -ne "$EXPECTED_ARMS" ]; then
    # ⛔ IN-01 (Phase 164.8.2) — THE MESSAGE NAMES THE DIRECTION IT MEASURED.
    # One sentence covered both directions and named the WRONG one half the time:
    # with a `run_arm` line DUPLICATED it printed "27 arms ran but EXPECTED_ARMS is
    # 26. An arm that disappeared is a RED" — the count right, the reader sent
    # hunting a deletion that never happened. The two directions have OPPOSITE
    # remedies, which is why one sentence could not carry both: a vanished arm is
    # RESTORED, an added arm is RATCHETED. The fix landed in
    # `scripts/test-ledger-drift-check.sh` first; it belongs here more, because this
    # is the script whose `--run` path is `DROP SCHEMA public CASCADE`.
    if [ "$total" -lt "$EXPECTED_ARMS" ]; then
      echo "SELF-TEST FAIL: ${total} arms ran but EXPECTED_ARMS is ${EXPECTED_ARMS}. An arm DISAPPEARED — that is a RED, not a smaller PASSED. RESTORE the arm. Never lower EXPECTED_ARMS to make a run green; that is deleting a proof of a guard on a destructive script."
    else
      echo "SELF-TEST FAIL: ${total} arms ran but EXPECTED_ARMS is ${EXPECTED_ARMS}. An arm was ADDED without raising the ratchet. RAISE EXPECTED_ARMS in the SAME commit as the arm, and move the dated MEASURED line and the \`prints N/N\` sentence beside it."
    fi
    return 1
  fi
  if [ "$pass" -ne "$total" ]; then
    echo "SELF-TEST FAIL: ${pass}/${total} arms behaved as declared."
    return 1
  fi
  # ⛔ W2 — THIS SENTENCE'S NUMBER IS MEASURED, AND SO IS ITS CLAIM. Regenerate the
  # count with `grep -c '^refuse_[a-z_]*() {' scripts/restore-test-from-baseline.sh`
  # (2026-09-09: NINE, after `refuse_backticks_in_txn_heredocs` joined the block). It
  # read "seven" until Phase 164.8, and was one short AGAIN until 164.8.2: the ninth
  # refusal arrived with arm 26 in PR #767 (06db9958), the emitted line below moved
  # with it and this comment did not. So the number is now DERIVED rather than
  # remembered — `restore-test-from-baseline.test.ts` reads the live
  # `^refuse_[a-z_]*() {` count, maps it to the same English word table, and asserts
  # THIS line and the emitted one both carry it. A drift in either is red.
  #
  # ⚠️ AND IT USED TO OVERCLAIM. The words were "every BRANCH of every one of them
  # is armed", which is false and was false before this phase: `refuse_wrong_baseline_sha`
  # alone has four `fail` exits and only the sha-mismatch one has an arm; the
  # "baseline dump not found", "provenance doc not found" and "no parseable sha256
  # row" branches have none. What IS true, and what is claimed here, is that every
  # refusal has at least one arm asserting its NAMED message — arms 1-7, 20, 21, 24
  # and 26. Arm 26 was MISSING from this list for the same reason the count was one
  # short: `refuse_backticks_in_txn_heredocs` arrived with its arm and the sentence
  # did not move. A narrative that miscounts or overstates its own guards is the same
  # defect class as a stale floor, so it is corrected rather than extended.
  echo "${GATE}: self-test OK (${pass}/${EXPECTED_ARMS} arms — NINE refusals fire before any write and each is armed by a named-message arm, preflight rolls back byte-for-byte, restore commits the full shape, survivors round-trip search_path-independently and carry their trigger enabled-state, the derived census refuses an unlisted dependent with a full census AND with an empty one, redaction is checked with a subject, the census whitelist refuses an unresolvable class, default ACLs round-trip, allowlisted reference data is replayed and gated INSIDE the transaction, the gate bites on a scratch copy and rolls back — EMPTY, SHORT and row-level partial each by name, a bad allowlist is refused before any write, the preflight's rollback view normalises mutable reference counts and nothing else, harness calibrated)"
  return 0
}

main "$@"
