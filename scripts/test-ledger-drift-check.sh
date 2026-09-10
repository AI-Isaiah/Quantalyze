#!/usr/bin/env bash
# VAC-08 — repo-vs-TEST migration-ledger and function-body drift gate
# (Phase 164.3; absorbs SKIP-01 and DRIFT-01).
#
# ── ⛔ READ THIS BEFORE CHANGING THE JOIN KEY ────────────────────────────────
# `supabase_migrations.schema_migrations` RE-STAMPS the `version` column at
# apply time and preserves the repo filename in `name`. MEASURED 2026-08-28:
# repo `20260827120000_strategy_shares_generation_model` is stored at version
# `20260828061901`. Joining repo filenames on `version` reported 12 of 12
# recent migrations MISSING when all 12 were present, several applied twice.
#
# That matters more than a bug report: SKIP-01's premise — "nothing applies
# migrations to TEST" — was FALSE, and a version-joining check would have
# reported drift that does not exist. It would have been a VACUOUS CONTROL
# shipped by the phase whose whole subject is vacuous controls. Join on
# `name`. Use `EXISTS`, so a twice-applied migration matches once and
# double-apply is tolerated by construction.
#
# ⛔ THE PARAGRAPH ABOVE IS TRUE OF THE 12 MIGRATIONS IT MEASURED AND FALSE OF
#    THE CORPUS. Measured 2026-08-29 on this gate's FIRST real run against TEST
#    (CI run 33274341298): 253 of 262 repo migrations reported ABSENT when
#    joined on `name`; only 9 matched. That cannot be real drift — `e2e-seeded`
#    passes against the same database in the same run, so the schema is there.
#    The 12-row sample was drawn from RECENT migrations and generalized to all
#    262, and nothing caught it across four review rounds because this gate had
#    never executed (WINDOWS.md 26 recorded exactly that). This is the defect
#    class the phase exists to remove, occurring inside the phase.
#
#    DO NOT pick a new join key by reasoning. The failure path now prints the
#    ledger's ACTUAL shape (`run_ledger_query shape`): row counts, how many
#    carry a NULL `name`, and sample (version, name) pairs. Fix the join from
#    that measurement. ⛔ Do NOT hand-apply migrations to TEST to make this
#    gate green — TEST is shared with other people's CI.
#
#
# ── THE JOIN, AS MEASURED (2026-08-29, CI run 33275241405) ──────────────────
# The ledger uses TWO conventions and a repo file matches under either:
#
#   old rows   version=20260405061911  name=initial_schema
#              -> version || '_' || name  ==  repo basename
#   recent     version=20260828061901  name=20260827120000_strategy_shares_...
#              -> name                   ==  repo basename   (version re-stamped)
#
# Measured shape: rows_total=239 name_null=2 name_set=237 against 262 repo
# files. Joining on `name` alone matched 9. Joining on `version` alone was
# already known to fail on the re-stamped rows. BOTH clauses are required;
# neither is redundant, and dropping either reproduces a known-false verdict.
#   bare-ts    version=20260826084633  name=20260826140000
#              -> name  ==  the repo basename's TIMESTAMP PREFIX
#   desc-only  version=20260826210044  name=destrict_enqueue_internal_10param
#              -> name  ==  the repo basename's DESCRIPTION (version re-stamped)
#
# ⛔ THE ENUMERATION IS CLOSED, AND THAT IS THE POINT. A repo basename is
#    `<timestamp>_<description>`. The ledger has, at different times, stored in
#    `name`: the whole thing, the description, the timestamp, or nothing (with
#    version carrying the timestamp). That is FOUR possibilities and there is no
#    fifth — every substring of the basename is now covered. Adding clauses
#    until the missing count reaches zero would be building a matcher that
#    matches anything, which is this phase's defect wearing the opposite mask.
#    Whatever remains missing after these four is REAL DRIFT.
#
# ⚠️ BOTH DIRECTIONS USE THE SAME PREDICATE. Before 2026-08-30 the advisory
#    `extra` direction still joined on `name` alone, so it reported "224 of 239
#    ledger rows have no repo file" while the `missing` direction, using all the
#    clauses, disagreed. Two readings of one relation that disagree BY
#    CONSTRUCTION is the exact shape this phase exists to remove; they are now
#    one predicate, and a change to one is a change to both.
#
# The third convention was found in the shape diagnostic on CI run 33276251646,
# AFTER the first two clauses cut the false-missing count from 253 to 56. Each
# clause was added because a measurement demanded it; none was reasoned into
# existence. Rows with no repo counterpart (hand-applied, e.g.
# name=destrict_enqueue_internal_10param) surface only in the ADVISORY `extra`
# direction, never here.
#
# ── THE TWO HALVES ──────────────────────────────────────────────────────────
# 1. LEDGER PRESENCE. Every `supabase/migrations/*.sql` basename must have a
#    `schema_migrations` row with that `name`. Any that does not → exit 1.
#    The REVERSE direction (ledger rows with no repo file) is printed as
#    ADVISORY ONLY and never fails: squashes and CLI-era rows make it noisy.
# 2. BODY PAIRING. Presence in the ledger is not evidence that the DEPLOYED
#    BODY matches — that is DRIFT-01, a different finding. For the named trio
#    (`_enqueue_compute_job_internal` incl. every overload, `sanitize_user`,
#    `mark_compute_job_done`) TEST's live `pg_get_functiondef` is compared
#    against the committed snapshot, comment-stripped and whitespace-normalized
#    by scripts/sql-body-normalize.mjs — the SAME implementation VAC-04 uses
#    (D-05: the comment trap is fixed once, not twice).
#
# ── NON-NEGOTIABLES ─────────────────────────────────────────────────────────
# • Read-only. Plain SELECTs. This gate never writes to TEST, which is a
#   SHARED database behind an advisory-lock mutex used by other people's CI.
# • Public-log redaction: function names, argument counts, sha256 hashes and
#   differing-line counts only. Never a DSN, host, username, or body text.
# • An absent `TEST_SUPABASE_DB_URL` is `exit 1` in the real path, mirroring
#   the job's own "Run SQL self-tests" step (ci.yml:1326-1331) rather than the
#   mutex step's `exit 0`. Fork PRs never reach this step: the `sql-tests` job
#   carries a same-repo `if:` (ci.yml:958), so this gate inherits that job's
#   ALREADY-DOCUMENTED skip surface and invents no new one.
#
# ── TESTABILITY SEAM (and its honest boundary) ───────────────────────────────
# Both database reads go through injectable commands so the DECISION LOGIC can
# be proven red and green with no database at all:
#   LEDGER_QUERY_CMD  invoked as `$LEDGER_QUERY_CMD missing` → one repo
#                     basename per line that has no ledger row; and as
#                     `$LEDGER_QUERY_CMD extra` → advisory ledger-only names.
#   BODY_FETCH_CMD    invoked as `$BODY_FETCH_CMD <fn-name>` → TEST's live
#                     definition text on stdout.
# ⚠️ What `--self-test` proves is the gate's verdict and exit code. It does NOT
# prove the SQL below — that rests on the object-level measurement above and on
# the first live CI run. Said plainly rather than implied, because a self-test
# that quietly tests a different code path than production is this phase's
# subject.
#
# ── USAGE (CI pastes this verbatim — mode identity) ─────────────────────────
#   bash scripts/test-ledger-drift-check.sh
#   bash scripts/test-ledger-drift-check.sh --self-test
set -euo pipefail

GATE="VAC-08 repo-vs-TEST ledger and body drift gate"

# ── ⛔ THE CEILING ON THE APPLY-ON-MERGE WINDOW (WR-02, Phase 164.8.2) ────────
# WHAT IT BOUNDS. Migrations reach shared TEST only on the MERGE push
# (supabase-migrate.yml, job `apply-test`), so a migration authored ABOVE the TEST
# ledger's frontier tip cannot be present yet and is EXEMPTED from NEW drift below.
# That exemption was UNBOUNDED: one failed `apply-test` exempts every later
# migration forever while this gate keeps printing `0 NEW drift`. A tolerance with
# no ceiling does not discriminate a timing artefact from a stalled pipeline — it
# is a control that passes while measuring nothing.
#
# WHY 3. One migration above the tip is the ordinary artefact of a PR that adds a
# migration (apply-on-merge, by construction). A handful is a stalled apply. Three
# is "a handful has not happened yet"; the founder's own framing (CONTEXT Area 1)
# was "N small, ~3".
#
# ⭐ IT IS A RATCHET. Lower it when reality allows. NEVER raise it to make a run
# pass — that is deleting the measurement. Raising it is a reviewed edit to this
# line, never a side effect of a green run. Conforms to `WAIVED_CEILING` in
# scripts/mutation-runner/run.mjs (which sits at 0 and has survived two founder
# decisions that each took the root-cause fix over an exception).
#
# HOW TO REGENERATE THE LIVE READING. Every `sql-tests` run prints
# `  ledger frontier: tip=<ts>; N above-tip migration(s) exempted.` Read the newest:
#   gh run list --workflow ci.yml --branch main --limit 3 --json databaseId
#   gh run view <id> --job <sql-tests job id> --log | grep -a 'ledger frontier:'
# (`gh run view --log` without `--job` truncates.)
#
# ⛔ WHAT THE SECOND LAYER CAN AND CANNOT DO, said plainly. CLAUDE.md's two-layer
# rule is satisfied for a REPO corpus by re-deriving it from disk (see
# src/__tests__/mutation-runner-floors.test.ts, `RATCHET STALE`). It CANNOT be
# satisfied that way here: the exempt count is a property of a LIVE, shared ledger,
# not of this repo, so a stale-HIGH ceiling is NOT re-derivable without a database.
# The second layer here is therefore (a) SC-9 registration in
# src/__tests__/gate-family-meta.test.ts's KNOWN_THRESHOLD_SITES, which makes any
# change to this value a reviewed diff, and (b) the single-live-line and
# positive-integer pins in src/__tests__/drift-check-scripts.test.ts. Lowering the
# ceiling when reality allows remains a HUMAN act, recorded by the dated line below.
#
# MEASURED 2026-09-09 — the live above-tip exempt count on `main` is 0, well under
# this ceiling: `ledger frontier: tip=20260908120000; 0 above-tip migration(s)
# exempted.`, read from CI run 34390777698 (head 1ca4d4da, `sql-tests` job
# 102600855496, success) at 19:01:34Z. The ceiling therefore reds nothing that is
# green today; it is pinned at 3 rather than at 0 so an ordinary apply-on-merge
# window does not red a PR that adds migrations.
FRONTIER_EXEMPT_CEILING=3

MIGRATIONS_DIR="${MIGRATIONS_DIR:-supabase/migrations}"
SNAPSHOT_DIR="${SNAPSHOT_DIR:-supabase/schema/functions}"
NORMALIZER="${NORMALIZER:-scripts/sql-body-normalize.mjs}"
# The DRIFT-named trio. Overloads are handled by the comparator, which pairs
# every live body against the committed set for that name.
BODY_CHECK_FUNCTIONS="${BODY_CHECK_FUNCTIONS:-_enqueue_compute_job_internal sanitize_user mark_compute_job_done}"

fail() {
  echo "::error::${GATE}: $*"
  exit 1
}

# ── The default database access commands (used when nothing is injected) ─────
default_ledger_query() {
  local direction="$1"
  local names_csv="$2"
  case "$direction" in
    missing)
      # Repo → ledger. EXISTS, joined on NAME. See the ⛔ block above.
      psql "$TEST_SUPABASE_DB_URL" -X -q -A -t -v ON_ERROR_STOP=1 \
        -c "SET statement_timeout = '30s';" \
        -c "SELECT r.fname
              FROM unnest(ARRAY[${names_csv}]::text[]) AS r(fname)
             WHERE NOT EXISTS (
                   SELECT 1 FROM supabase_migrations.schema_migrations m
                    WHERE m.name = r.fname
                       OR (m.version || '_' || m.name) = r.fname
                       OR m.name = split_part(r.fname, '_', 1)
                       OR m.name = substr(r.fname, strpos(r.fname, '_') + 1));" \
        | tr -d '\r' | sed '/^[[:space:]]*$/d'
      ;;
    extra)
      psql "$TEST_SUPABASE_DB_URL" -X -q -A -t -v ON_ERROR_STOP=1 \
        -c "SET statement_timeout = '30s';" \
        -c "SELECT m.name
              FROM supabase_migrations.schema_migrations m
             WHERE m.name IS NOT NULL
               AND NOT EXISTS (
                   SELECT 1 FROM unnest(ARRAY[${names_csv}]::text[]) AS r(fname)
                    WHERE m.name = r.fname
                       OR (m.version || '_' || m.name) = r.fname
                       OR m.name = split_part(r.fname, '_', 1)
                       OR m.name = substr(r.fname, strpos(r.fname, '_') + 1));" \
        | tr -d '\r' | sed '/^[[:space:]]*$/d'
      ;;
    ledger_rows)
      # Count-only. Feeds the ABSURDITY FLOOR below; never printed as a finding.
      psql "$TEST_SUPABASE_DB_URL" -X -q -A -t -v ON_ERROR_STOP=1 \
        -c "SET statement_timeout = '30s';" \
        -c "SELECT count(*) FROM supabase_migrations.schema_migrations;" \
        | tr -d '\r' | sed '/^[[:space:]]*$/d' | head -1
      ;;
    shape)
      # DIAGNOSTIC ONLY — never decides pass/fail. A gate that fails must print
      # enough for the next reader to diagnose it without a database of their
      # own; otherwise the failure is a claim about the ledger that cannot be
      # checked. Emits row counts and five sample (version, name) pairs.
      # Migration filenames are already public in this repo, so this discloses
      # nothing the tree does not.
      psql "$TEST_SUPABASE_DB_URL" -X -q -A -t -v ON_ERROR_STOP=1 \
        -c "SET statement_timeout = '30s';" \
        -c "SELECT 'rows_total=' || count(*)
              || ' name_null=' || count(*) FILTER (WHERE name IS NULL)
              || ' name_set='  || count(*) FILTER (WHERE name IS NOT NULL)
              FROM supabase_migrations.schema_migrations;" \
        -c "SELECT 'sample version=' || coalesce(version,'<null>')
              || ' name=' || coalesce(name,'<null>')
              FROM supabase_migrations.schema_migrations
             ORDER BY version DESC LIMIT 5;" \
        -c "SELECT 'oldest  version=' || coalesce(version,'<null>')
              || ' name=' || coalesce(name,'<null>')
              FROM supabase_migrations.schema_migrations
             ORDER BY version ASC LIMIT 3;" \
        | tr -d '\r' | sed '/^[[:space:]]*$/d'
      ;;
    *) fail "unknown ledger query direction '${direction}'" ;;
  esac
}

default_body_fetch() {
  # Every overload of the name, in a stable order. `pg_get_functiondef` needs
  # no table privileges. Output is redirected to a file and NEVER echoed.
  psql "$TEST_SUPABASE_DB_URL" -X -q -A -t -v ON_ERROR_STOP=1 \
    -c "SET statement_timeout = '30s';" \
    -c "SELECT pg_get_functiondef(p.oid)
          FROM pg_proc p
          JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public' AND p.proname = '$1'
         ORDER BY p.pronargs;"
}

run_ledger_query() {
  if [ -n "${LEDGER_QUERY_CMD:-}" ]; then
    # shellcheck disable=SC2086
    $LEDGER_QUERY_CMD "$1"
  else
    default_ledger_query "$1" "$2"
  fi
}

run_body_fetch() {
  if [ -n "${BODY_FETCH_CMD:-}" ]; then
    # shellcheck disable=SC2086
    $BODY_FETCH_CMD "$1"
  else
    default_body_fetch "$1"
  fi
}

# ── The gate proper ─────────────────────────────────────────────────────────
check() {
  command -v node >/dev/null 2>&1 || fail "node is not on PATH; the shared normalizer cannot run."
  [ -f "$NORMALIZER" ] || fail "normalizer not found at ${NORMALIZER}."
  [ -d "$SNAPSHOT_DIR" ] || fail "committed snapshot dir not found at ${SNAPSHOT_DIR}."
  [ -d "$MIGRATIONS_DIR" ] || fail "migrations dir not found at ${MIGRATIONS_DIR}."

  if [ -z "${LEDGER_QUERY_CMD:-}" ] || [ -z "${BODY_FETCH_CMD:-}" ]; then
    # Only the paths that will really talk to psql need the DSN.
    if [ -z "${TEST_SUPABASE_DB_URL:-}" ]; then
      echo "::error::${GATE}: TEST_SUPABASE_DB_URL is required and is not set."
      echo "::error::This mirrors the sql-tests job's own 'Run SQL self-tests' step: a work"
      echo "::error::step with no DSN exits 1 rather than passing silently. Fork PRs never"
      echo "::error::reach here — the job carries a same-repo if: — so an empty DSN in this"
      echo "::error::job means the secret is missing, not that the run is untrusted."
      exit 1
    fi
    command -v psql >/dev/null 2>&1 || fail "psql is not on PATH."
  fi

  local tmp
  tmp="$(mktemp -d)"
  # ⛔ IN-04: RETURN alone is not enough. It fires when the FUNCTION returns,
  # and every `fail` below `exit`s the shell instead — so each of this
  # function's ~8 failure paths left the mktemp directory behind. EXIT/INT/TERM
  # cover those. Both traps are kept: RETURN cleans up promptly when `check` is
  # called more than once in a process (the self-test's arms), EXIT catches the
  # paths that never return.
  # shellcheck disable=SC2064
  trap "rm -rf '$tmp'" RETURN
  # shellcheck disable=SC2064
  trap "rm -rf '$tmp'" EXIT
  # ⛔ SP-M02. This was one `trap … EXIT INT TERM`, and a bash signal handler
  # RESUMES the script when it returns — it does not exit. So Ctrl-C deleted
  # $tmp and execution CONTINUED against files that no longer exist, inside a
  # function whose entire subject is comparing file contents. Split, so INT and
  # TERM route THROUGH the EXIT trap and there is exactly one teardown path.
  # `scripts/pg-lane/run.sh` and `scripts/local-stack/run.sh` both already do
  # this; this file was the odd one out.
  trap 'exit 130' INT
  trap 'exit 143' TERM

  # ── HALF 1: LEDGER PRESENCE ───────────────────────────────────────────────
  local repo_names=()
  local f base
  for f in "$MIGRATIONS_DIR"/*.sql; do
    [ -e "$f" ] || continue
    base="$(basename "$f" .sql)"
    # Refuse anything that is not a plain migration name rather than
    # interpolating it into SQL. Fail loud; do not silently drop it.
    case "$base" in
      *[!A-Za-z0-9_.-]*) fail "migration filename '${base}' contains characters this gate refuses to interpolate into SQL." ;;
    esac
    repo_names+=("$base")
  done

  # F11's shape: an empty corpus is an ERROR, never a quiet pass. Zero
  # migrations means the glob drifted, not that the ledger is clean.
  if [ "${#repo_names[@]}" -eq 0 ]; then
    fail "no migration files found under ${MIGRATIONS_DIR}. The repo-side list is EMPTY, so this run compared NOTHING — that is not a pass."
  fi

  local names_csv=""
  local nm
  for nm in "${repo_names[@]}"; do
    names_csv="${names_csv}${names_csv:+,}'${nm}'"
  done

  echo "Repo migrations: ${#repo_names[@]}"

  local missing_file="${tmp}/missing.txt"
  run_ledger_query missing "$names_csv" > "$missing_file" \
    || fail "the ledger presence query failed (output withheld — it can carry connection detail)."

  # ⛔ SP-M01. This read
  #     missing_count="$(grep -ac … || true)"; missing_count="${missing_count:-0}"
  # and that turns "could not count" into "counted zero". `grep` exits 0 with a
  # count, 1 with no match, and >= 2 on an ERROR (unreadable file, I/O failure)
  # — and on >= 2 the substitution is EMPTY, `${:-0}` makes it `0`, and the
  # branch below prints "all N repo migrations found by name." A gate that
  # cannot read its own result must not report the result it wanted.
  local missing_count grep_rc
  set +e
  missing_count="$(grep -ac '[^[:space:]]' "$missing_file")"
  grep_rc=$?
  set -e
  [ "$grep_rc" -le 1 ] || fail "MEASURE_FAIL: could not count the missing-migration rows (grep exited ${grep_rc} on ${missing_file}). An uncountable result is not a count of zero."
  # Only exit 1 (no match) legitimately yields an empty count.
  missing_count="${missing_count:-0}"

  # ── ABSURDITY FLOOR ────────────────────────────────────────────────────────
  # Is this a DRIFT FINDING, or is the instrument broken? The gate held both
  # numbers on 2026-08-29 and never asked: it reported "253 of 262 migrations
  # are not present" against a database that `e2e-seeded` was passing against in
  # the same run. A populated ledger that matches almost nothing is a WRONG KEY,
  # not 253 un-applied migrations, and saying the second is worse than saying
  # nothing — it sends the reader to hand-apply migrations to a SHARED database.
  #
  # The rule: if the ledger is substantially populated (>= 50 rows) but fewer
  # than HALF the REPO's migrations matched it, the join is not measuring what
  # it claims. Compared against the REPO total, not the ledger total — a repo
  # with few migrations and a long ledger (squashes, hand-applied rows) is
  # normal and must not trip this. Separation is wide, not tuned: the real
  # defect scored matched=9 of 262 (fires); ordinary drift of 30 un-applied
  # migrations scores matched=232 of 262 (silent).
  #
  # ⛔ F7 (Phase 164.8.2) — THE SIXTH `|| true`, AND THE ONLY ONE THAT FAILED
  # TOWARD SILENCE. This read
  #     ledger_rows="$(run_ledger_query ledger_rows … 2>/dev/null || echo "")"
  #     case "$ledger_rows" in (*[!0-9]*|"") ledger_rows="" ;; esac
  #     if [ -n "$ledger_rows" ] && [ "$ledger_rows" -ge 50 ] && …
  # which is the SP-M01 shape the five bounded sites in this file already
  # condemn — an unreadable measurement collapsing to a value the control can
  # never fire on — except this one collapsed to EMPTY, and `[ -n … ]` then made
  # the ENTIRE ABSURDITY FLOOR silently INERT. The `2>/dev/null` removed the only
  # channel that would have said why. A pooler blip, a permission change or a
  # `run_ledger_query` regression therefore did not merely lose the row count: it
  # switched off the control that separates a WRONG JOIN KEY from real drift, and
  # the gate went on to report drift-shaped nonsense with full confidence — on a
  # SHARED database, in the words of the block above, "sending the reader to
  # hand-apply migrations".
  #
  # The five sites F5 bounded fail toward RED. This one failed toward "the
  # control did not act", which is strictly worse. An unreadable input is not a
  # clean one — the same sentence the sibling bounds carry.
  #
  # ⚠️ THE STDERR IS CAPTURED AND DELIBERATELY NOT ECHOED, and the boundary is
  # said out loud rather than implied: psql's connect/auth stderr names the host,
  # the port and the DB user, and this job's log is PUBLIC (see NON-NEGOTIABLES
  # at the top). So the diagnosis this failure hands the reader is the EXIT CODE
  # and whether the query said anything at all — which already separates "psql
  # spoke and refused" from "psql is not there" from "the query returned no row"
  # — and not the text. What it must never do again is discard the channel and
  # then decide.
  local ledger_rows matched ledger_rows_rc=0
  local ledger_rows_err="${tmp}/ledger_rows.err"
  set +e
  ledger_rows="$(run_ledger_query ledger_rows "$names_csv" 2>"$ledger_rows_err")"
  ledger_rows_rc=$?
  set -e
  if [ "$ledger_rows_rc" -ne 0 ]; then
    fail "MEASURE_FAIL: could not read the TEST ledger row count (the ledger_rows query exited ${ledger_rows_rc}; $(wc -l < "$ledger_rows_err" | tr -d '[:space:]') line(s) of stderr captured and WITHHELD — it can carry a DSN, host or username). The ABSURDITY FLOOR below is the control that tells a wrong join key from real drift, and it can only fire on a count that was READ; an unreadable one leaves it INERT while the gate reports drift with full confidence. An unreadable input is not a clean one."
  fi
  case "$ledger_rows" in
    "")
      fail "MEASURE_FAIL: the TEST ledger row-count query exited 0 and returned NO ROW ($(wc -l < "$ledger_rows_err" | tr -d '[:space:]') line(s) of stderr captured and WITHHELD — it can carry a DSN, host or username). A count query returns exactly one number, so an empty answer is a read that did not happen, not a ledger holding zero rows — and zero is one of the values the ABSURDITY FLOOR below can never fire on."
      ;;
    *[!0-9]*)
      fail "MEASURE_FAIL: the TEST ledger row-count query exited 0 and returned something that is not a number (${#ledger_rows} character(s), value WITHHELD — a failed psql can print connection detail on stdout). A count that cannot be compared is not a count of zero; the ABSURDITY FLOOR below would have gone INERT on it."
      ;;
  esac
  matched=$(( ${#repo_names[@]} - missing_count ))
  if [ "$ledger_rows" -ge 50 ] && [ $(( matched * 2 )) -lt "${#repo_names[@]}" ]; then
    echo "::error::${GATE}: MEASURE_FAIL — this is the GATE failing, not the database."
    echo "::error::The TEST ledger holds ${ledger_rows} rows, but only ${matched} of ${#repo_names[@]} repo"
    echo "::error::migrations matched it. A populated ledger that matches almost nothing means the"
    echo "::error::JOIN KEY is wrong; it does not mean $(( missing_count )) migrations were never applied."
    echo "::error::⛔ Do NOT hand-apply migrations to TEST on the strength of this run — TEST is"
    echo "::error::shared with other people's CI. Fix the join, using the shape diagnostic below."
    run_ledger_query shape "$names_csv" 2>/dev/null | sed 's/^/::error::  /' || true
    exit 1
  fi

  # ── RATCHET ────────────────────────────────────────────────────────────────
  # Split the measured-missing set against a DATED baseline of known-absent
  # migrations. New drift fails; the known gap is carried explicitly, with an
  # owner, instead of as a number nobody wrote down. Same shape as the coverage
  # floor (D-01/D-09): pinned at the measured value, fails on REGRESSION.
  local baseline="${LEDGER_BASELINE_FILE:-$(dirname "$0")/vac08-ledger-baseline.txt}"
  local new_file="${tmp}/missing.new.txt" stale_file="${tmp}/baseline.stale.txt"
  : > "$new_file"; : > "$stale_file"
  if [ -f "$baseline" ]; then
    # Baselined names, comments and blank lines stripped.
    local base_names="${tmp}/baseline.names.txt"
    sed 's/#.*//' "$baseline" | sed 's/[[:space:]]*$//' | sed '/^$/d' > "$base_names"
    # ⛔ F5 (Phase 164.8.2) — SP-M01's BOUND, ON THE FILTER SITES TOO. `|| true`
    # cannot tell grep's rc 1 (every line filtered away — legitimate, and the
    # ORDINARY clean case here) from rc >= 2 (could not read). An unreadable
    # `$missing_file` wrote an EMPTY `$new_file`, and an empty `$new_file` is
    # this gate's CLEAN verdict: `0 NEW drift`, exit 0, green board. `-le 1` and
    # NOT `-eq 0` is the whole point of the bound. Same shape and same sentence
    # as scripts/restore-test-from-baseline.sh's IN-06 wrap, so the twins fail
    # the same way.
    # NEW drift = measured missing, not baselined.
    set +e; grep -aFxv -f "$base_names" "$missing_file" > "$new_file"; grep_rc=$?; set -e
    [ "$grep_rc" -le 1 ] || fail "MEASURE_FAIL: could not filter the measured-missing rows against ${baseline} (grep exited ${grep_rc}). An unreadable input is not a run with no new drift."
    # STALE baseline = baselined, but NOT measured missing any more.
    set +e; grep -aFxv -f "$missing_file" "$base_names" > "$stale_file"; grep_rc=$?; set -e
    [ "$grep_rc" -le 1 ] || fail "MEASURE_FAIL: could not filter ${baseline} against the measured-missing rows (grep exited ${grep_rc}). An unreadable input is not a baseline with no stale entries."
  else
    cp "$missing_file" "$new_file"
    echo "::warning::${GATE}: no ledger baseline at ${baseline} — every measured absence is treated as new."
  fi

  # ── APPLY-ON-MERGE FRONTIER EXEMPTION (Phase 164.8 plan 05, 2026-09-09) ────
  # ⛔ READ THE ORDERING BEFORE TOUCHING THIS.
  #
  # PR #766 added an `apply-test` job to supabase-migrate.yml, so migrations now
  # reach shared TEST — but only ON THE MERGE PUSH. That makes two things true
  # BY CONSTRUCTION, and neither is a defect this gate is entitled to report:
  #   (a) On the PR itself the new migration FILE exists and nothing has applied
  #       it anywhere. Counting it as NEW drift reddens EVERY migration-adding
  #       PR with no remedy the rules permit — the baseline may only shrink, and
  #       hand-applying to shared TEST is forbidden two blocks up.
  #   (b) On the merge push this gate (`sql-tests`) and `apply-test` take the
  #       SAME advisory lock 61616158. Whichever wins decides whether the ledger
  #       is read before or after the apply, so without this the verdict is a
  #       coin flip on lock order.
  # The exemption makes the verdict ORDER-INDEPENDENT. It is not a tolerance —
  # it removes a quantity the gate was never measuring.
  #
  # THE FRONTIER, AND WHY IT IS DERIVED FROM THE REPO, NOT FROM `version`.
  # `schema_migrations.version` is RE-STAMPED at apply time (the ⛔ block at the
  # top of this file, measured 2026-08-28). So `max(version)` is an APPLY clock,
  # and comparing an AUTHORING timestamp against it compares two different
  # quantities. The tip used here is instead
  #     tip = the greatest AUTHORING timestamp among repo migrations MEASURED
  #           PRESENT in the ledger
  # i.e. the newest migration the ledger has actually got, expressed in repo
  # terms. It is computed from data this gate already holds: no new query, no
  # stub to keep in sync, and immune to re-stamping.
  #
  # ⛔ THE RATCHET IS NOT WEAKENED, AND THIS IS THE SENTENCE THAT SAYS WHY.
  # A migration that is missing while a STRICTLY NEWER one is present cannot be
  # explained by apply-on-merge: the pipeline that applied the newer one walked
  # straight past this one. That is the real defect class and it stays RED. Only
  # the strictly-above window — where nothing applied is newer, so no pipeline
  # has yet had the chance to apply it — is exempt.
  #
  # BOUNDARY, DECIDED: `> tip` exempts; `== tip` DOES NOT.
  # Equality is reachable only when two repo files share a timestamp and one of
  # them IS present. Its sibling applied in the same run and this one did not —
  # a defect, not a timing artefact. Stated explicitly because an off-by-one
  # here silently exempts a real failure, and pinned by the
  # `tip-equal-missing RED` self-test arm.
  #
  # ⚠️ WHAT THIS DOES NOT COVER, said plainly rather than implied. If TEST's
  # ledger falls behind, the tip falls with it and the exempt window widens by
  # the same amount. The ABSURDITY FLOOR above catches the GROSS form (a
  # populated ledger matching under half the repo is MEASURE_FAIL and exits
  # before this block runs). A narrow, quiet lag is NOT caught here. That cost
  # is the price of the exemption and is booked as [164.8-PUSH-RACE-VAC08].
  #
  # ⭐ CURRENCY 2026-09-09 (Phase 164.8.2, WR-02): the window's WIDTH is now
  # bounded — more than FRONTIER_EXEMPT_CEILING exempted migrations is an
  # `::error::` naming every one of them and a failing gate (see the check beside
  # `local bad=0` below). What stays open and booked at [164.8-PUSH-RACE-VAC08] is
  # the ORDERING coupling (ci.yml's `sql-tests` and supabase-migrate.yml's
  # `apply-test` contend for the same advisory key with nothing ordering them),
  # routed to Phase 164.9. A bounded width is not an ordered pipeline.
  #
  # ⚠️ PLACEMENT vs THE `sed 's/#.*//'` SEAM. That sed strips comments from the
  # BASELINE FILE only, a dozen lines up. This block adds no baseline syntax and
  # reads no baseline text, so nothing written here passes through it. Verified
  # by the `above-frontier-missing GREEN` arm, whose baseline file is empty.
  local frontier_tip="" ts
  for nm in "${repo_names[@]}"; do
    # Present == not on the measured-missing list.
    if grep -aqFx -e "$nm" "$missing_file"; then continue; fi
    ts="${nm%%_*}"
    case "$ts" in ""|*[!0-9]*) continue ;; esac
    [ "${#ts}" -le 18 ] || continue   # keep the arithmetic below inside int64
    if [ -z "$frontier_tip" ] || [ "$((10#$ts))" -gt "$((10#$frontier_tip))" ]; then
      frontier_tip="$ts"
    fi
  done

  local exempt_file="${tmp}/exempt.frontier.txt" kept_file="${tmp}/missing.new.kept.txt"
  : > "$exempt_file"; : > "$kept_file"
  local nline nts is_exempt
  while IFS= read -r nline; do
    [ -n "$nline" ] || continue
    nts="${nline%%_*}"
    is_exempt=0
    # No present migration at all => no frontier => exemption DISABLED, and
    # every measured absence stays a finding. An undefined tip must never read
    # as "everything is ahead of the tip".
    if [ -n "$frontier_tip" ]; then
      case "$nts" in
        ""|*[!0-9]*) ;;
        *) if [ "${#nts}" -le 18 ] && [ "$((10#$nts))" -gt "$((10#$frontier_tip))" ]; then is_exempt=1; fi ;;
      esac
    fi
    if [ "$is_exempt" = 1 ]; then
      printf '%s\n' "$nline" >> "$exempt_file"
    else
      printf '%s\n' "$nline" >> "$kept_file"
    fi
  done < "$new_file"
  mv "$kept_file" "$new_file"

  # A SILENT exemption is indistinguishable from a gate that stopped working.
  # The tip is printed on EVERY run — including runs that exempt nothing — so
  # the width of the window is readable without re-deriving it, and a tip that
  # has fallen behind is visible in the log rather than only in its effect.
  #
  # ⛔ F5 — AND THE COUNT IS BOUNDED. `|| true` here was worse than at the two
  # sites above, because `exempt_count` feeds the FRONTIER_EXEMPT_CEILING check
  # below: an uncountable exemption read as 0, which is simultaneously this
  # gate's clean verdict AND a number no ceiling can ever exceed. The control
  # would have reported nothing while measuring nothing.
  local exempt_count
  set +e; exempt_count="$(grep -ac '[^[:space:]]' "$exempt_file")"; grep_rc=$?; set -e
  [ "$grep_rc" -le 1 ] || fail "MEASURE_FAIL: could not count the frontier-exempted migrations (grep exited ${grep_rc} on ${exempt_file}). An uncountable exemption is not an exemption of zero, and zero is the one value FRONTIER_EXEMPT_CEILING can never fire on."
  exempt_count="${exempt_count:-0}"
  echo "  ledger frontier: tip=${frontier_tip:-<none - no repo migration is present, exemption DISABLED>}; ${exempt_count} above-tip migration(s) exempted."
  if [ "$exempt_count" -gt 0 ]; then
    echo "::notice::${GATE}: ${exempt_count} repo migration(s) EXEMPTED from NEW drift — authored ABOVE the TEST ledger's frontier (tip ${frontier_tip})."
    echo "  WHY: migrations reach shared TEST only on the MERGE push (supabase-migrate.yml, job 'apply-test'),"
    echo "  so a migration NEWER than every migration the ledger already holds cannot be present yet. Counting"
    echo "  it would measure the pipeline's timing, not a defect. A missing migration AT or BELOW the tip is"
    echo "  still NEW drift and still fails this gate."
    sed 's/^/  exempt (above tip): /' "$exempt_file"
  fi

  # ⛔ F5 — the two verdict counts, bounded on the same shape. `new_count` IS the
  # verdict: 0 prints `0 NEW drift` and exits 0. A gate that cannot read its own
  # result must not report the result it wanted.
  local new_count stale_count
  set +e; new_count="$(grep -ac '[^[:space:]]' "$new_file")"; grep_rc=$?; set -e
  [ "$grep_rc" -le 1 ] || fail "MEASURE_FAIL: could not count the NEW-drift rows (grep exited ${grep_rc} on ${new_file}). An uncountable result is not a count of zero, and zero here is this gate's clean verdict."
  new_count="${new_count:-0}"
  set +e; stale_count="$(grep -ac '[^[:space:]]' "$stale_file")"; grep_rc=$?; set -e
  [ "$grep_rc" -le 1 ] || fail "MEASURE_FAIL: could not count the stale-baseline rows (grep exited ${grep_rc} on ${stale_file}). An uncountable result is not a baseline with nothing stale in it."
  stale_count="${stale_count:-0}"

  local bad=0
  # ⛔ WR-02 — THE EXEMPT WINDOW HAS A WIDTH, AND THE WIDTH IS BOUNDED. Sets
  # `bad=1` rather than exiting, so the run still reports its other findings and
  # the file's single verdict (`if [ "$bad" = 1 ]`) decides the exit code — the
  # same shape as the `stale_count` and `new_count` blocks below it.
  if [ "$exempt_count" -gt "$FRONTIER_EXEMPT_CEILING" ]; then
    echo "::error::${GATE}: FRONTIER_EXEMPT_CEILING exceeded: ${exempt_count} migration(s) above the ledger frontier (tip ${frontier_tip}) > ceiling ${FRONTIER_EXEMPT_CEILING}. That is a stalled apply, not an apply-on-merge window — supabase-migrate.yml's apply-test has stopped applying to TEST. Fix the apply; do NOT raise the ceiling (a reviewed edit to FRONTIER_EXEMPT_CEILING in scripts/test-ledger-drift-check.sh, never a side effect of a green run)."
    # NAMED, not counted. A ceiling that reports only a number tells a reader that
    # something is wrong and nothing about what; the versions are the evidence.
    sed 's/^/::error::  exempt (above tip): /' "$exempt_file"
    bad=1
  fi
  if [ "$stale_count" -gt 0 ]; then
    # A baseline that may hold stale entries is a control that quietly stops
    # controlling. Shrinking it is progress and MUST be recorded.
    echo "::error::${GATE}: ${stale_count} baseline entr(y/ies) are no longer MEASURED absent."
    echo "::error::Either the migration reached TEST, or its file left the repo. Both mean the"
    echo "::error::same thing: the line is stale. The baseline may only shrink — delete these"
    echo "::error::lines from ${baseline}:"
    sed 's/^/::error::  /' "$stale_file"
    bad=1
  fi
  if [ "$new_count" -gt 0 ]; then
    echo "::error::${GATE}: ${new_count} repo migration(s) are not present in the TEST ledger and are NOT baselined:"
    sed 's/^/::error::  /' "$new_file"
    # WHAT THE LEDGER ACTUALLY LOOKS LIKE. Added 2026-08-29 after this gate's
    # FIRST real run against TEST reported 253 of 262 missing — a number that
    # cannot be true (e2e-seeded passes against the same database, so the
    # schema is there). The join key was chosen from a 12-row sample of RECENT
    # migrations and generalized to all 262; the sample was not the corpus.
    # A gate that fails must show its evidence, or its failure is just another
    # unchecked claim.
    echo "::error::--- TEST ledger shape (diagnostic, does not decide pass/fail) ---"
    if run_ledger_query shape "$names_csv" 2>/dev/null | sed 's/^/::error::  /'; then :; else
      echo "::error::  (shape probe failed — the ledger could not be described)"
    fi
    echo "::error::If name_null is large, the join key is wrong for older rows and the"
    echo "::error::fix belongs in the gate, NOT in a hand-apply to TEST. Do not apply"
    echo "::error::migrations to TEST to make this gate green — TEST is shared."
    bad=1
  elif [ "$stale_count" -eq 0 ]; then
    # ⛔ The two dispositions are NAMED SEPARATELY. This line used to read
    # "all N baselined", which became FALSE the moment the frontier exemption
    # landed: an above-tip absence is not in the baseline file and never
    # appears there. A clean summary that misattributes WHY an absence was
    # tolerated is a gate reporting a control that did not act.
    #
    # ⛔ IN-02 (Phase 164.8.2) — THE VERDICT HALF IS CONDITIONED ON `bad`. The
    # counts above are a MEASUREMENT and stay printed either way; the trailing
    # `0 NEW drift.` is a VERDICT, and it used to print unconditionally. On a
    # ceiling breach that put two contradictory sentences in one run, MEASURED
    # 2026-09-10:
    #   ::error::… FRONTIER_EXEMPT_CEILING exceeded: 4 … > ceiling 3.
    #     ledger presence: 4 absent — 0 baselined (…), 4 exempt …; 0 NEW drift.
    # The board was correctly red (the gate exits 1 and suppresses the
    # `ledger and body checks clean` notice), but the line a reader scans for the
    # verdict read clean beside the error that contradicts it. `new_count` is
    # genuinely 0 here, so the fix is not to hide the number — it is to stop the
    # summary claiming the run is clean when this run is not.
    local presence="  ledger presence: ${missing_count} absent — $(( missing_count - exempt_count )) baselined (see ${baseline}), ${exempt_count} exempt as above the ledger frontier; 0 NEW drift"
    if [ "$bad" = 0 ]; then
      echo "${presence}."
    else
      echo "${presence} — but this run is NOT clean: see the ::error:: above (the frontier-exemption ceiling was BREACHED). 0 NEW drift is not a passing verdict here."
    fi
  fi

  # Advisory only — squashes and CLI-era rows make this direction noisy.
  local extra_file="${tmp}/extra.txt"
  if run_ledger_query extra "$names_csv" > "$extra_file" 2>/dev/null; then
    # Same shape as SP-M01, one line down. This direction is ADVISORY by
    # design (squashes and CLI-era rows make it noisy), so an uncountable
    # result is surfaced as a warning rather than failing the gate — but it is
    # never allowed to read as "counted zero, nothing to report".
    local extra_count extra_rc
    set +e
    extra_count="$(grep -ac '[^[:space:]]' "$extra_file")"
    extra_rc=$?
    set -e
    if [ "$extra_rc" -gt 1 ]; then
      echo "::warning::${GATE}: could not count the advisory extra-ledger rows (grep exited ${extra_rc}). This direction is advisory, so the run continues — but it reported nothing because it could not read, not because there was nothing."
      extra_count=0
    fi
    if [ "${extra_count:-0}" -gt 0 ]; then
      echo "  advisory: ${extra_count} ledger row(s) have no repo file (squashes / CLI-era rows). Not a failure."
    fi
  fi

  # ── HALF 2: BODY PAIRING ──────────────────────────────────────────────────
  #
  # WR-02: half 1 refuses an empty corpus explicitly ("that is not a pass").
  # Half 2 had no equivalent, and it needs one for a reason half 1 does not:
  # BODY_CHECK_FUNCTIONS is an env-overridable, space-separated list, so a
  # WHITESPACE-ONLY value survives the `${…:-default}` above (`:-` only
  # substitutes for empty) and then `for fname in $BODY_CHECK_FUNCTIONS`
  # iterates ZERO times. MEASURED 2026-08-29 before this guard:
  #   BODY_CHECK_FUNCTIONS=" " bash scripts/test-ledger-drift-check.sh
  #   -> "0 body comparison(s)" … "ledger and body checks clean" … exit 0
  # DRIFT-01 — the finding this half exists for — was unchecked while the gate
  # read green. `tr -d` rather than `${var// /}` so the check is identical
  # under the bash a developer has locally (macOS 3.2) and the runner's bash 5.
  local body_check_names
  body_check_names="$(printf '%s' "$BODY_CHECK_FUNCTIONS" | tr -d '[:space:]')"
  if [ -z "$body_check_names" ]; then
    fail "BODY_CHECK_FUNCTIONS is empty or whitespace-only, so half 2 compared NOTHING. Presence in the ledger is not evidence the body matches (DRIFT-01) — that is not a pass."
  fi

  local fname live snapshot rows
  local compared=0
  local names_seen=0
  for fname in $BODY_CHECK_FUNCTIONS; do
    names_seen=$((names_seen + 1))
    # ⛔ SP-I06 — THE GUARD THIS FILE ALREADY APPLIES ON THE OTHER SIDE.
    # Migration filenames get an explicit charset allowlist before they are
    # interpolated into SQL (half 1, and it fails loud). `fname` had no
    # equivalent, and it is interpolated into `p.proname = '$1'` in
    # `default_body_fetch` AND used as a filesystem path component twice below.
    # BODY_CHECK_FUNCTIONS is env-overridable, so that is one environment
    # variable away from injecting SQL into a database OTHER PEOPLE'S CI
    # depends on — TEST is SHARED. Not exploitable today (the default is
    # hardcoded and the workflow does not override it), which is why this is
    # hardening; an asymmetric guard is still a guard that has to be argued
    # about instead of read.
    #
    # Same charset as prod-body-drift-check.sh's (SP-I07): Postgres' unquoted
    # identifier set, `$` included. Refuse rather than sanitise — a rewritten
    # name would compare the WRONG function and report a pass for it.
    case "$fname" in
      "" | *[!A-Za-z0-9_$]*)
        fail "BODY_CHECK_FUNCTIONS names '${fname}', which carries characters this gate refuses to interpolate into SQL or to use as a filename component. Rename the function, or widen this allowlist deliberately."
        ;;
    esac
    live="${tmp}/${fname}.live.sql"
    if ! run_body_fetch "$fname" > "$live" 2>"${tmp}/${fname}.err"; then
      echo "::error::${GATE}: could not read TEST's definition of '${fname}' (stderr withheld — public log)."
      bad=1
      continue
    fi
    if ! grep -aqE '[^[:space:]]' "$live"; then
      echo "::error::${GATE}: '${fname}' does not exist in TEST. The committed snapshot has a body for"
      echo "::error::it, so this is a real divergence, not a new function."
      bad=1
      continue
    fi
    snapshot="${SNAPSHOT_DIR}/${fname}.sql"
    if [ ! -f "$snapshot" ]; then
      echo "::error::${GATE}: no committed body at ${snapshot} for a function live in TEST (stale snapshot)."
      bad=1
      continue
    fi
    rows="${tmp}/${fname}.rows"
    node "$NORMALIZER" --diff-bodies "$snapshot" "$live" > "$rows" \
      || fail "the normalizer could not compare '${fname}'."

    local status name nargs snap_hash live_hash hunks
    while IFS=$'\t' read -r status name nargs snap_hash live_hash hunks; do
      [ -n "${status:-}" ] || continue
      case "$status" in
        MATCH)
          compared=$((compared + 1))
          echo "  ${name}/${nargs}: TEST body matches the committed body (${snap_hash})"
          ;;
        SNAPSHOT_ONLY)
          echo "  ${name}/${nargs}: committed overload with no TEST counterpart (advisory)."
          ;;
        DRIFT)
          compared=$((compared + 1))
          echo "::error::${GATE}: ${name}/${nargs} — TEST's deployed body does not match the committed body."
          echo "::error::  committed sha256 : ${snap_hash}"
          echo "::error::  TEST      sha256 : ${live_hash}"
          echo "::error::  differing lines  : ${hunks}"
          echo "::error::Presence in the ledger is not evidence the body matches (DRIFT-01)."
          bad=1
          ;;
        SNAPSHOT_MISSING)
          compared=$((compared + 1))
          echo "::error::${GATE}: TEST has ${name}/${nargs} but the committed snapshot has no body for it (stale snapshot)."
          bad=1
          ;;
        UNCOMPARABLE)
          compared=$((compared + 1))
          echo "::error::${GATE}: could not extract a comparable body for ${name}/${nargs}. Failing closed —"
          echo "::error::a pass reported for something that was not compared is the defect this gate exists for."
          bad=1
          ;;
        *)
          echo "::error::${GATE}: unrecognised comparator status '${status}' for ${name}. Failing closed."
          bad=1
          ;;
      esac
    done < "$rows"
  done

  echo ""
  echo "${GATE}: ${#repo_names[@]} migration(s) checked against the ledger, ${compared} body comparison(s) over ${names_seen} named function(s)."

  # The second half of WR-02. The guard above catches an empty LIST; this
  # catches a non-empty list that still produced no comparison — a fetcher
  # returning nothing for every name, or a comparator emitting no rows. Unlike
  # VAC-04, there is no legitimate zero here: every name in this list is a
  # function the committed snapshot already has a body for, so zero
  # comparisons always means the gate did not look.
  if [ "$compared" -eq 0 ]; then
    echo "::error::${GATE}: MEASURE_FAIL — ZERO body comparisons for [${BODY_CHECK_FUNCTIONS}]."
    echo "::error::Presence in the ledger is not evidence the body matches (DRIFT-01), so a run"
    echo "::error::that compared no bodies has nothing to report clean."
    bad=1
  fi

  if [ "$bad" = 1 ]; then
    return 1
  fi
  echo "::notice::${GATE}: ledger and body checks clean."
  return 0
}

# ── --self-test: prove BOTH red modes and the green path, with no database ──
self_test() {
  local inverted="${1:-}"
  local tmp
  tmp="$(mktemp -d)"
  # IN-04, as above: RETURN misses every `exit` path.
  # shellcheck disable=SC2064
  trap "rm -rf '$tmp'" RETURN
  # shellcheck disable=SC2064
  trap "rm -rf '$tmp'" EXIT
  # ⛔ SP-M02. This was one `trap … EXIT INT TERM`, and a bash signal handler
  # RESUMES the script when it returns — it does not exit. So Ctrl-C deleted
  # $tmp and execution CONTINUED against files that no longer exist, inside a
  # function whose entire subject is comparing file contents. Split, so INT and
  # TERM route THROUGH the EXIT trap and there is exactly one teardown path.
  # `scripts/pg-lane/run.sh` and `scripts/local-stack/run.sh` both already do
  # this; this file was the odd one out.
  trap 'exit 130' INT
  trap 'exit 143' TERM

  mkdir -p "$tmp/migrations" "$tmp/snapshot" "$tmp/live"
  # shellcheck disable=SC2016  # `$$` and `$function$` are SQL dollar-quote tags, deliberately literal.
  local body='CREATE OR REPLACE FUNCTION public.selftest_fn(p_id UUID) RETURNS UUID LANGUAGE plpgsql AS $$ BEGIN RETURN p_id; END $$;'
  # shellcheck disable=SC2016
  local drifted='CREATE OR REPLACE FUNCTION public.selftest_fn(p_id uuid) RETURNS uuid LANGUAGE plpgsql AS $function$ BEGIN RETURN gen_random_uuid(); END $function$'
  printf '%s\n' "$body" > "$tmp/migrations/20260829000000_selftest.sql"
  printf '%s\n' "$body" > "$tmp/snapshot/selftest_fn.sql"

  # Stub ledger: argv[1] is the direction; MISSING_NAMES seeds the red mode.
  #
  # ⛔ F7 (Phase 164.8.2) — `ledger_rows` ANSWERS, and answers with a SMALL
  # number. It printed nothing until this fix, and "nothing" is now a
  # MEASURE_FAIL in `check` by design: a count query that returns no row was
  # never a ledger holding zero rows. 12 rather than 0 or 239 is deliberate —
  # it is a READ count that sits UNDER the absurdity floor's `>= 50`
  # precondition, so every arm below still fails or passes for exactly the
  # reason its comment claims and the floor stays out of their way.
  cat > "$tmp/ledger.sh" <<'STUB'
#!/usr/bin/env bash
if [ "$1" = "missing" ]; then
  [ -n "${MISSING_NAMES:-}" ] && printf '%s\n' "$MISSING_NAMES"
elif [ "$1" = "ledger_rows" ]; then
  echo 12
fi
exit 0
STUB
  cat > "$tmp/body.sh" <<'STUB'
#!/usr/bin/env bash
f="${LIVE_DIR}/$1.sql"
[ -f "$f" ] && cat "$f"
exit 0
STUB
  chmod +x "$tmp/ledger.sh" "$tmp/body.sh"

  local rc pass=0 total=0
  local -a results=()

  # ⛔ THE ARMS RATCHET (WR-03, Phase 164.8.2). Without it the tally below read
  # `self-test OK (${pass}/${total} arms …)` — a denominator that MOVES WITH THE
  # CORPUS. Delete an arm and the run printed a smaller PASSED and exited 0, so a
  # cleanup could remove the frontier arms and the gate would report success for
  # having tested less. A vanished arm is a RED, not a smaller PASSED.
  #
  # ⭐ Raise it only TOGETHER with the arm that adds one; never lower it to make a
  # run green — that is deleting a proof.
  #
  # ⚠️ THIS CONSTANT IS A DELIBERATE COPY of `EXPECTED_ARMS` in
  # scripts/restore-test-from-baseline.sh (whose own `run_arm` comment records that
  # it was copied FROM this file — the twins stay twins by copy). Separate constants
  # per file is this repo's wiring convention, stated outright in Phase 164.8 Plan 05
  # Task 2: the self-tests are self-contained. Do NOT "fix" this into a shared module.
  #
  # ⚠️ `EXPECTED_ARMS` is OUTSIDE gate-family-meta.test.ts's threshold name class
  # (no FLOOR/MIN/CEILING/MAX/LIMIT), so SC-9 will never see it. The date below is
  # kept honest ONLY by src/__tests__/drift-check-scripts.test.ts, which pins this
  # line live-exactly-once and pins the `prints N/N` sentence against the value.
  #
  # Regenerate with `bash scripts/test-ledger-drift-check.sh --self-test`, and the
  # live arm count with
  # `grep -av '^\s*#' scripts/test-ledger-drift-check.sh | grep -ac '^  run_arm "'`.
  # `--self-test --expect-inverted` exits 1. No database: the harness is stub-driven.
  # MEASURED 2026-09-09 — `--self-test` prints 11/11 and exits 0.
  EXPECTED_ARMS=11

  run_arm() {
    local label="$1" want="$2"
    shift 2
    local arm_out=""
    total=$((total + 1))
    rc=0
    # ⛔ F6 (Phase 164.8.2) — CAPTURED, NOT DISCARDED, AND RE-EMITTED ON FAILURE
    # ONLY. This read `( "$@" ) >/dev/null 2>&1`, and the EXIT-CODE contract was
    # never the problem: `arm_frontier_ceiling_exceeded` is declared `want 1` and
    # `return 0`s on every MEASURE_FAIL, so the arm genuinely FAILs. What was
    # lost is the REASON. That arm has FOUR distinguishable causes — a wrong exit
    # code, a missing `FRONTIER_EXEMPT_CEILING exceeded` string, and a missing
    # `::error::  exempt (above tip): <name>` for any of four names — and the
    # operator got `FAIL frontier-ceiling-exceeded RED (exit 0, expected 1)` and
    # nothing else. The sentences were written to be read and could not be.
    #
    # ⛔ THE CONTRACT IS UNCHANGED, DELIBERATELY. `rc` still comes from the arm
    # and is still compared against `want`; nothing here can turn a FAIL into an
    # ok. Capturing is why `2>&1` replaces the discard — stderr carries the
    # gate's own `::error::` lines and an arm that failed on one of them should
    # say so. On the ok path the output is DROPPED, so a green run's log is
    # byte-identical to what it was before this change.
    arm_out="$( ( "$@" ) 2>&1 )" || rc=$?
    # ⚠️ The `ARM_FORCE_INVERT` clause is the sibling's one extra `||`
    # (scripts/restore-test-from-baseline.sh, `run_arm`). It exists for the
    # harness-calibration arm below, which must be able to turn the flip on for
    # ONE subshell without setting `--expect-inverted` for the whole run.
    if [ "$inverted" = "--expect-inverted" ] || [ "${ARM_FORCE_INVERT:-0}" = "1" ]; then
      want=$(( want == 0 ? 1 : 0 ))
    fi
    if [ "$rc" -eq "$want" ]; then
      results+=("  ok   ${label} (exit ${rc})")
      pass=$((pass + 1))
    else
      results+=("  FAIL ${label} (exit ${rc}, expected ${want})")
      # The arm's own diagnosis, indented under its verdict and marked so a
      # reader can tell the arm's output from the harness's. Withheld when the
      # arm printed nothing, so a silent failure does not grow a blank block.
      if [ -n "$arm_out" ]; then
        results+=("$(printf '%s\n' "$arm_out" | sed 's/^/       | /')")
      fi
    fi
  }

  # ── FRONTIER-EXEMPTION corpora (Phase 164.8 plan 05) ──────────────────────
  # Half 1 reads BASENAMES only, so these files' contents are irrelevant; the
  # body half is driven by the same snapshot/live pair as every other arm.
  #   mig_frontier  three timestamps, so "below the tip" and "above the tip" are
  #                 both reachable in the SAME corpus by moving only which name
  #                 the stub reports missing.
  #   mig_tipeq     two files sharing ONE timestamp, which is the only way to
  #                 land a missing migration EXACTLY on the tip.
  mkdir -p "$tmp/mig_frontier" "$tmp/mig_tipeq"
  : > "$tmp/mig_frontier/20260101000000_below.sql"
  : > "$tmp/mig_frontier/20260201000000_applied.sql"
  : > "$tmp/mig_frontier/20260301000000_above.sql"
  : > "$tmp/mig_tipeq/20260201000000_applied.sql"
  : > "$tmp/mig_tipeq/20260201000000_twin.sql"

  # ── FRONTIER-CEILING corpora (WR-02, Phase 164.8.2) ───────────────────────
  #   mig_ceil_over  one applied + FOUR above the tip  => exempt_count 4 > 3, RED
  #   mig_ceil_edge  one applied + THREE above the tip => exempt_count 3 == 3, GREEN
  #
  # ⚠️ TWO CORPORA ARE REQUIRED — ONE WOULD MEASURE THE WRONG THING. The tip is
  # the GREATEST PRESENT timestamp. Deriving the boundary case from the over-the-
  # ceiling corpus by making one of the four above-tip files "present" would MOVE
  # THE TIP UP, and the remaining three would then sit BELOW it: still red, but as
  # below-frontier drift, not as a boundary that stays green. An arm that reds for
  # the wrong reason is indistinguishable from one that works.
  mkdir -p "$tmp/mig_ceil_over" "$tmp/mig_ceil_edge"
  : > "$tmp/mig_ceil_over/20260201000000_applied.sql"
  : > "$tmp/mig_ceil_over/20260301000000_above1.sql"
  : > "$tmp/mig_ceil_over/20260401000000_above2.sql"
  : > "$tmp/mig_ceil_over/20260501000000_above3.sql"
  : > "$tmp/mig_ceil_over/20260601000000_above4.sql"
  : > "$tmp/mig_ceil_edge/20260201000000_applied.sql"
  : > "$tmp/mig_ceil_edge/20260301000000_above1.sql"
  : > "$tmp/mig_ceil_edge/20260401000000_above2.sql"
  : > "$tmp/mig_ceil_edge/20260501000000_above3.sql"
  # MISSING_NAMES is printed by the stub with `printf '%s\n'`, so REAL newlines
  # seed several missing names from one value.
  local ceil_over_names ceil_edge_names
  ceil_over_names=$'20260301000000_above1\n20260401000000_above2\n20260501000000_above3\n20260601000000_above4'
  ceil_edge_names=$'20260301000000_above1\n20260401000000_above2\n20260501000000_above3'

  # An EMPTY baseline for every arm. Without it the self-test inherits the
  # repo's real vac08-ledger-baseline.txt, whose 31 entries are all "stale"
  # against a one-migration fixture — the harness would be measuring production
  # data it never set up, and every arm would red for a reason unrelated to what
  # it is testing. The ratchet itself is proven in
  # src/__tests__/drift-check-scripts.test.ts, which sets the file explicitly.
  printf '# self-test: intentionally empty\n' > "$tmp/baseline.txt"

  arm_env() {
    # $4 is the migrations dir, defaulting to the one-file corpus every
    # pre-164.8 arm was written against. The frontier arms below need a corpus
    # with more than one migration in it — a single missing migration leaves NO
    # present migration, hence no frontier, hence no exemption.
    MIGRATIONS_DIR="${4:-$tmp/migrations}" \
    SNAPSHOT_DIR="$tmp/snapshot" \
    LEDGER_BASELINE_FILE="$tmp/baseline.txt" \
    LIVE_DIR="$1" \
    MISSING_NAMES="$2" \
    LEDGER_QUERY_CMD="bash $tmp/ledger.sh" \
    BODY_FETCH_CMD="bash $tmp/body.sh" \
    BODY_CHECK_FUNCTIONS="${3:-selftest_fn}" \
    NORMALIZER="$NORMALIZER" \
    bash "$0" --run-check
  }

  # RED 1 — a repo migration absent from the ledger.
  printf '%s\n' "$body" > "$tmp/live/selftest_fn.sql"
  run_arm "missing-ledger-row RED" 1 arm_env "$tmp/live" "20260829000000_selftest"

  # RED 2 — the live body differs from the committed body.
  printf '%s\n' "$drifted" > "$tmp/live/selftest_fn.sql"
  run_arm "body-mismatch RED" 1 arm_env "$tmp/live" ""

  # RED 3 (WR-02) — a whitespace-only function list. It survives the
  # `${…:-default}` above and then iterates zero times, so before the guard
  # this arm exited 0 with "ledger and body checks clean" having compared
  # nothing. Half 1 always refused its empty corpus; half 2 now does too.
  printf '%s\n' "$body" > "$tmp/live/selftest_fn.sql"
  run_arm "empty-body-check-list RED" 1 arm_env "$tmp/live" "" " "

  # RED 4 (WR-02) — a NON-empty list where every fetch comes back empty. The
  # list guard cannot see this one; the zero-comparison floor after the loop
  # can. `$tmp/nowhere` has no bodies in it.
  run_arm "zero-comparisons RED" 1 arm_env "$tmp/nowhere" ""

  # GREEN — everything present, bodies equal after normalization.
  printf '%s\n' "$body" > "$tmp/live/selftest_fn.sql"
  run_arm "green path" 0 arm_env "$tmp/live" ""

  # ── FRONTIER EXEMPTION (Phase 164.8 plan 05) — red, green, and the boundary ─
  # RED 5 — a missing migration BELOW the frontier still fails. This is the arm
  # that proves the exemption did not weaken the ratchet: 20260201000000_applied
  # and 20260301000000_above are present, so the tip is 20260301000000 and the
  # missing 20260101000000_below sits under it. A migration that should have
  # applied and did not is exactly the class the gate exists for.
  run_arm "below-frontier-missing RED" 1 arm_env "$tmp/live" "20260101000000_below" "selftest_fn" "$tmp/mig_frontier"

  # GREEN 2 — the SAME corpus, missing the NEWEST name instead. Nothing applied
  # is newer than it, so under apply-on-merge it cannot be present yet; it is
  # exempted by name and the gate passes.
  run_arm "above-frontier-missing GREEN" 0 arm_env "$tmp/live" "20260301000000_above" "selftest_fn" "$tmp/mig_frontier"

  # RED 6 — THE BOUNDARY. 20260201000000_twin shares its timestamp with the
  # present 20260201000000_applied, so it sits EXACTLY on the tip. `> tip`
  # exempts and `== tip` does not: its sibling applied in the same run and this
  # one did not, which is a defect rather than a timing artefact.
  run_arm "tip-equal-missing RED" 1 arm_env "$tmp/live" "20260201000000_twin" "selftest_fn" "$tmp/mig_tipeq"

  # ── FRONTIER CEILING (WR-02, Phase 164.8.2) — over, and the boundary ───────
  # RED 7 — four migrations above the tip is a stalled apply, not a window.
  #
  # ⛔ THIS ARM ASSERTS ON THE MESSAGE TEXT, NOT ON exit 1 ALONE. `run_arm`
  # compares exit CODES, and this gate has several ways to exit 1 — the absurdity
  # floor, below-frontier drift, a body mismatch. An `ok (exit 1)` earned by one of
  # those would be a green arm proving nothing about the ceiling, which is the exact
  # anti-vacuity trap this phase exists to close. It also requires EVERY exempted
  # version to be named, because a ceiling that reports only a count tells a reader
  # that something is wrong and nothing about what.
  #
  # (The absurdity floor cannot pre-empt it here: the stub answers `ledger_rows`
  # with 12, so the floor's >= 50-rows precondition is never met. That is read from
  # the stub rather than assumed — and the text assertion makes it moot anyway.)
  arm_frontier_ceiling_exceeded() {
    local out rc=0 nm
    out="$(arm_env "$tmp/live" "$ceil_over_names" "selftest_fn" "$tmp/mig_ceil_over" 2>&1)" || rc=$?
    if [ "$rc" -ne 1 ]; then
      echo "MEASURE_FAIL: the gate exited ${rc}, not 1, on a corpus with four migrations above the tip."
      return 0
    fi
    if ! printf '%s' "$out" | grep -aq 'FRONTIER_EXEMPT_CEILING exceeded'; then
      echo "MEASURE_FAIL: the gate exited 1 but never said FRONTIER_EXEMPT_CEILING exceeded — this arm was about to pass for the wrong reason."
      return 0
    fi
    # ⛔ THE NAMES ARE ASSERTED ON THE `::error::` LINES, not anywhere in the
    # output. The pre-existing `::notice::` block a few lines up ALSO prints
    # `  exempt (above tip): <name>` for every exempted migration, so a bare
    # `grep -F <name>` over the whole output would be satisfied by code this arm
    # is not testing — it would stay green with the ceiling's own `sed` deleted.
    for nm in 20260301000000_above1 20260401000000_above2 20260501000000_above3 20260601000000_above4; do
      if ! printf '%s' "$out" | grep -aqF -e "::error::  exempt (above tip): ${nm}"; then
        echo "MEASURE_FAIL: the ceiling ERROR did not NAME the exempted migration ${nm}."
        return 0
      fi
    done
    return 1
  }
  run_arm "frontier-ceiling-exceeded RED" 1 arm_frontier_ceiling_exceeded

  # GREEN 3 — THE BOUNDARY. Exactly the ceiling stays green, in the spirit of
  # `tip-equal-missing RED`: an off-by-one hides at the boundary and nowhere else.
  run_arm "frontier-ceiling-boundary GREEN" 0 arm_env "$tmp/live" "$ceil_edge_names" "selftest_fn" "$tmp/mig_ceil_edge"

  # ── HARNESS CALIBRATION (WR-03, Phase 164.8.2) — the LAST arm ──────────────
  # ⛔ WITHOUT THIS ARM every `ok` above is a claim about a harness nobody has
  # seen say no. Both halves run `run_arm` in a SUBSHELL so their tallies cannot
  # reach the real `total`/`pass`, against a leg KNOWN to exit 1, declared want 0.
  # With the flip ON that must read `ok`; with it OFF it must read `FAIL`.
  #
  # ⚠️ BELT-AND-BRACES, NOT LOAD-BEARING for WR-03. `--expect-inverted` is already
  # driven externally at the WHOLE-RUN level by
  # src/__tests__/drift-check-scripts.test.ts ("--self-test FAILS when the gate is
  # neutered"), which is what proves the arms are not decorative. This arm proves
  # the narrower thing that check cannot isolate: `run_arm`'s FAIL branch is
  # reachable. It is the shape CONTEXT Area 3 names, copied from
  # scripts/restore-test-from-baseline.sh's `arm_harness_calibration`.
  arm_calib_leg() {
    # The `missing-ledger-row RED` invocation — the gate's own red mode, so this
    # leg's exit 1 is a measured property of the gate and not an invented failure.
    arm_env "$tmp/live" "20260829000000_selftest"
  }
  arm_harness_calibration() {
    local flipped plain
    flipped=$( total=0; pass=0; results=(); ARM_FORCE_INVERT=1
               run_arm "calib" 0 arm_calib_leg; printf '%s\n' "${results[@]}" )
    plain=$(   total=0; pass=0; results=(); ARM_FORCE_INVERT=0
               run_arm "calib" 0 arm_calib_leg; printf '%s\n' "${results[@]}" )
    echo "calibration, flip ON  -> ${flipped}"
    echo "calibration, flip OFF -> $(printf '%s' "$plain" | head -1)"
    case "$flipped" in
      *"  ok   calib"*) ;;
      *) echo "MEASURE_FAIL: with the flip the harness did not report ok for a command that exits 1 against want 0 — the inversion no longer inverts."; return 1 ;;
    esac
    case "$plain" in
      *"  FAIL calib"*) ;;
      *) echo "MEASURE_FAIL: WITHOUT the flip the harness did not report FAIL for a command that exits 1 against want 0. run_arm has stopped discriminating and every ok in this run is worthless."; return 1 ;;
    esac
    return 0
  }
  run_arm "harness calibration: run_arm can report FAIL, and the flip inverts" 0 arm_harness_calibration

  printf '%s\n' "${results[@]}"
  # ⛔ THE COUNT CHECK COMES FIRST, and the success line comes LAST — the
  # sibling's ordering (scripts/restore-test-from-baseline.sh). A run that lost an
  # arm must not be able to print a success narrative at all, and a run that lost
  # an arm AND passed the rest must not read as PASSED.
  if [ "$total" -ne "$EXPECTED_ARMS" ]; then
    # ⛔ IN-01 (Phase 164.8.2) — THE MESSAGE NAMES THE DIRECTION IT MEASURED.
    # One sentence covered both, and it named the WRONG one half the time:
    # MEASURED 2026-09-10 with a `run_arm` line DUPLICATED, the gate printed
    # "12 arms ran but EXPECTED_ARMS is 11. An arm that disappeared is a RED" —
    # the count right, the reader sent looking for a deletion that never
    # happened. The two directions also have OPPOSITE remedies, which is why one
    # sentence could not carry both: a vanished arm is restored, an added arm is
    # ratcheted.
    if [ "$total" -lt "$EXPECTED_ARMS" ]; then
      echo "SELF-TEST FAIL: ${total} arms ran but EXPECTED_ARMS is ${EXPECTED_ARMS}. An arm DISAPPEARED — that is a RED, not a smaller PASSED. RESTORE the arm. Never lower EXPECTED_ARMS to make a run green; that is deleting a proof."
    else
      echo "SELF-TEST FAIL: ${total} arms ran but EXPECTED_ARMS is ${EXPECTED_ARMS}. An arm was ADDED without raising the ratchet. RAISE EXPECTED_ARMS in the SAME commit as the arm, and move the dated MEASURED line and the \`prints N/N\` sentence beside it."
    fi
    return 1
  fi
  if [ "$pass" -ne "$total" ]; then
    echo "SELF-TEST FAIL: ${pass}/${total} arms behaved as declared."
    return 1
  fi
  # ⛔ THE DENOMINATOR IS THE RATCHET, AND SAYS SO. Below both checks `pass`,
  # `total` and `EXPECTED_ARMS` are all equal by construction, so printing
  # `${total}` here would be indistinguishable from printing the constant — right
  # up until an arm vanished, which is the one moment the difference matters.
  # ⛔ THE SENTENCE'S COUNT IS MEASURED, NOT RESTATED. Regenerate the green arms
  # with `grep -av '^\s*#' scripts/test-ledger-drift-check.sh | grep -ac '^  run_arm "[^"]*\(GREEN\|green\)'`
  # (2026-09-09: THREE, after `frontier-ceiling-boundary GREEN` joined). It read
  # "both green paths" until this phase, which was true of two and became false at
  # three — a narrative that miscounts its own arms is the same defect class as a
  # stale ratchet.
  echo "${GATE}: self-test OK (${pass}/${EXPECTED_ARMS} arms — every red mode fires, all THREE green paths pass, and the harness is calibrated)."
  return 0
}

case "${1:-}" in
  --self-test) self_test "${2:-}" ;;
  --run-check) check ;;
  "") check ;;
  *) fail "unknown mode '${1}'. Usage: $0 [--self-test]" ;;
esac
