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
  local ledger_rows matched
  ledger_rows="$(run_ledger_query ledger_rows "$names_csv" 2>/dev/null || echo "")"
  case "$ledger_rows" in (*[!0-9]*|"") ledger_rows="" ;; esac
  matched=$(( ${#repo_names[@]} - missing_count ))
  if [ -n "$ledger_rows" ] && [ "$ledger_rows" -ge 50 ] && [ $(( matched * 2 )) -lt "${#repo_names[@]}" ]; then
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
    # NEW drift = measured missing, not baselined.
    grep -aFxv -f "$base_names" "$missing_file" > "$new_file" || true
    # STALE baseline = baselined, but NOT measured missing any more.
    grep -aFxv -f "$missing_file" "$base_names" > "$stale_file" || true
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
  local exempt_count
  exempt_count="$(grep -ac '[^[:space:]]' "$exempt_file" || true)"; exempt_count="${exempt_count:-0}"
  echo "  ledger frontier: tip=${frontier_tip:-<none - no repo migration is present, exemption DISABLED>}; ${exempt_count} above-tip migration(s) exempted."
  if [ "$exempt_count" -gt 0 ]; then
    echo "::notice::${GATE}: ${exempt_count} repo migration(s) EXEMPTED from NEW drift — authored ABOVE the TEST ledger's frontier (tip ${frontier_tip})."
    echo "  WHY: migrations reach shared TEST only on the MERGE push (supabase-migrate.yml, job 'apply-test'),"
    echo "  so a migration NEWER than every migration the ledger already holds cannot be present yet. Counting"
    echo "  it would measure the pipeline's timing, not a defect. A missing migration AT or BELOW the tip is"
    echo "  still NEW drift and still fails this gate."
    sed 's/^/  exempt (above tip): /' "$exempt_file"
  fi

  local new_count stale_count
  new_count="$(grep -ac '[^[:space:]]' "$new_file" || true)"; new_count="${new_count:-0}"
  stale_count="$(grep -ac '[^[:space:]]' "$stale_file" || true)"; stale_count="${stale_count:-0}"

  local bad=0
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
    echo "  ledger presence: ${missing_count} absent — $(( missing_count - exempt_count )) baselined (see ${baseline}), ${exempt_count} exempt as above the ledger frontier; 0 NEW drift."
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
  # MEASURED 2026-09-09 — `--self-test` prints 9/9 and exits 0.
  EXPECTED_ARMS=9

  run_arm() {
    local label="$1" want="$2"
    shift 2
    total=$((total + 1))
    rc=0
    ( "$@" ) >/dev/null 2>&1 || rc=$?
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
    echo "SELF-TEST FAIL: ${total} arms ran but EXPECTED_ARMS is ${EXPECTED_ARMS}. An arm that disappeared is a RED, not a smaller PASSED."
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
  echo "${GATE}: self-test OK (${pass}/${EXPECTED_ARMS} arms — every red mode fires, both green paths pass, and the harness is calibrated)."
  return 0
}

case "${1:-}" in
  --self-test) self_test "${2:-}" ;;
  --run-check) check ;;
  "") check ;;
  *) fail "unknown mode '${1}'. Usage: $0 [--self-test]" ;;
esac
