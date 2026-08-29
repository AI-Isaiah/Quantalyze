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
                    WHERE m.name = r.fname);" \
        | tr -d '\r' | sed '/^[[:space:]]*$/d'
      ;;
    extra)
      psql "$TEST_SUPABASE_DB_URL" -X -q -A -t -v ON_ERROR_STOP=1 \
        -c "SET statement_timeout = '30s';" \
        -c "SELECT m.name
              FROM supabase_migrations.schema_migrations m
             WHERE m.name IS NOT NULL
               AND NOT (m.name = ANY (ARRAY[${names_csv}]::text[]));" \
        | tr -d '\r' | sed '/^[[:space:]]*$/d'
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

  local bad=0
  if [ "$missing_count" -gt 0 ]; then
    echo "::error::${GATE}: ${missing_count} repo migration(s) are not present in the TEST ledger (joined on schema_migrations.name):"
    sed 's/^/::error::  /' "$missing_file"
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
  else
    echo "  ledger presence: all ${#repo_names[@]} repo migrations found by name."
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
  cat > "$tmp/ledger.sh" <<'STUB'
#!/usr/bin/env bash
if [ "$1" = "missing" ]; then
  [ -n "${MISSING_NAMES:-}" ] && printf '%s\n' "$MISSING_NAMES"
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

  run_arm() {
    local label="$1" want="$2"
    shift 2
    total=$((total + 1))
    rc=0
    ( "$@" ) >/dev/null 2>&1 || rc=$?
    if [ "$inverted" = "--expect-inverted" ]; then
      want=$(( want == 0 ? 1 : 0 ))
    fi
    if [ "$rc" -eq "$want" ]; then
      results+=("  ok   ${label} (exit ${rc})")
      pass=$((pass + 1))
    else
      results+=("  FAIL ${label} (exit ${rc}, expected ${want})")
    fi
  }

  arm_env() {
    MIGRATIONS_DIR="$tmp/migrations" \
    SNAPSHOT_DIR="$tmp/snapshot" \
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

  printf '%s\n' "${results[@]}"
  if [ "$pass" -ne "$total" ]; then
    echo "SELF-TEST FAIL: ${pass}/${total} arms behaved as declared."
    return 1
  fi
  echo "${GATE}: self-test OK (${pass}/${total} arms — all four red modes fire and the green path passes)."
  return 0
}

case "${1:-}" in
  --self-test) self_test "${2:-}" ;;
  --run-check) check ;;
  "") check ;;
  *) fail "unknown mode '${1}'. Usage: $0 [--self-test]" ;;
esac
