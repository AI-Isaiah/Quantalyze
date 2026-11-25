#!/usr/bin/env bash
# Phase 241 plan 03 - LANE ONLY rehearsal driver for the Pair B delete chain.
#
#   241-PAIRB-rehearse.sh up              boot the local-stack lane, assert it is loopback, set a lane marker
#   241-PAIRB-rehearse.sh down            stop the lane
#   241-PAIRB-rehearse.sh --arm <name>    run one arm against the running lane
#   241-PAIRB-rehearse.sh --all           run every arm, one PASS or FAIL line each
#
# Arms: census-shape chain-admin chain-sql plain-delete-rollback catalog-lane
#       abort-wrong-count abort-cross-owner abort-no-match abort-marker
#
# Every arm creates fresh synthetic users, so arms are independent. Output carries counts and
# check names only: no login, id, key or marker value is ever printed. Shell tracing is never switched on.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(git rev-parse --show-toplevel)"
LANE_RUN="${ROOT}/scripts/local-stack/run.sh"
LANE_ENV="${ROOT}/scripts/local-stack/.stack-env"
LANE_MARKER='lane-marker-241-pairb-rehearsal'

TMP=""
cleanup() { [ -n "$TMP" ] && rm -rf "$TMP"; return 0; }
trap cleanup EXIT

cmd_up() {
  local attempt
  for attempt in 1 2 3; do
    if "$LANE_RUN" up; then break; fi
    if [ "$attempt" = 3 ]; then echo "FAIL up: lane did not boot" >&2; exit 1; fi
    echo "lane boot failed (attempt $attempt); waiting before retry (registry throttle)" >&2
    sleep 120
  done
  "$LANE_RUN" --assert-local-handoff
  load_lane
  [ "$(q -Atc 'select current_database()')" = "postgres" ] || { echo "FAIL up: unexpected lane database name" >&2; exit 1; }
  q -c "COMMENT ON DATABASE postgres IS '${LANE_MARKER}'" >/dev/null
  echo "lane up; marker set"
}

cmd_down() { "$LANE_RUN" down; }

# --- lane access -------------------------------------------------------------
load_lane() {
  "$LANE_RUN" --assert-local-handoff >/dev/null
  set -a
  # shellcheck disable=SC1090
  . "$LANE_ENV"
  set +a
  : "${DB_URL:?}" "${API_URL:?}" "${ANON_KEY:?}" "${SERVICE_ROLE_KEY:?}"
}
q() { psql "$DB_URL" -X -q -v ON_ERROR_STOP=1 "$@"; }

# --- fixture -----------------------------------------------------------------
new_fixture() {
  [ -n "$TMP" ] || TMP="$(mktemp -d)"
  local out="$TMP/users.$RANDOM.json"
  node "$HERE/241-PAIRB-lane-users.mjs" create B X M --out "$out" >/dev/null
  B_ID="$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).B.id)' "$out")"
  X_ID="$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).X.id)' "$out")"
  M_ID="$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).M.id)' "$out")"
  B_DIGEST="$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).B.loginSha256)' "$out")"
  rm -f "$out"
  q -o /dev/null -v b_id="$B_ID" -v x_id="$X_ID" -v m_id="$M_ID" -f "$HERE/241-PAIRB-fixture.sql"
  B_KEYS="$(q -Atc "select '{'||coalesce(string_agg(id::text, ','),'')||'}' from public.api_keys where user_id='${B_ID}'")"
  B_PORTS="$(q -Atc "select '{'||coalesce(string_agg(id::text, ','),'')||'}' from public.portfolios where user_id='${B_ID}'")"
  XM_KEYS="$(q -Atc "select '{'||coalesce(string_agg(id::text, ','),'')||'}' from public.api_keys where user_id in ('${X_ID}','${M_ID}')")"
  XM_PORTS="$(q -Atc "select '{'||coalesce(string_agg(id::text, ','),'')||'}' from public.portfolios where user_id in ('${X_ID}','${M_ID}')")"
}

# --- per-table counts and snapshots -------------------------------------------
# One line per table: "<table>|<predicate>". @O@ is a uuid[] of owners, @K@ keys, @P@ portfolios.
SPECS='public.allocator_holdings|allocator_id = ANY(@O@)
public.bridge_outcomes|allocator_id = ANY(@O@)
public.match_decisions|allocator_id = ANY(@O@) OR decided_by = ANY(@O@)
public.match_candidates|allocator_id = ANY(@O@)
public.match_batches|allocator_id = ANY(@O@)
public.allocator_preferences|user_id = ANY(@O@)
public.api_keys|user_id = ANY(@O@)
public.csv_daily_returns|allocator_id = ANY(@O@) OR api_key_id = ANY(@K@)
public.compute_jobs|allocator_id = ANY(@O@) OR api_key_id = ANY(@K@) OR portfolio_id = ANY(@P@)
public.api_key_nav_marks|allocator_id = ANY(@O@) OR api_key_id = ANY(@K@)
public.allocator_equity_derived|allocator_id = ANY(@O@)
public.portfolios|user_id = ANY(@O@)
public.portfolio_analytics|portfolio_id = ANY(@P@)
public.user_app_roles|user_id = ANY(@O@)
public.investor_attestations|user_id = ANY(@O@)
public.profiles|id = ANY(@O@)
public.strategies|user_id = ANY(@O@)
public.audit_log|user_id = ANY(@O@)
auth.users|id = ANY(@O@)
auth.sessions|user_id = ANY(@O@)
auth.identities|user_id = ANY(@O@)'

# spec_query <owners uuid[] text> <keys uuid[] text> <ports uuid[] text> <count|md5>
spec_query() {
  local owners="$1" keys="$2" ports="$3" mode="$4" line tbl pred first=1 sel
  local o_sql="'${owners}'::uuid[]" k_sql="'${keys}'::uuid[]" p_sql="'${ports}'::uuid[]"
  while IFS= read -r line; do
    tbl="${line%%|*}"; pred="${line#*|}"
    pred="${pred//@O@/${o_sql}}"
    pred="${pred//@K@/${k_sql}}"
    pred="${pred//@P@/${p_sql}}"
    if [ "$mode" = md5 ]; then
      sel="select '${tbl}' as t, count(*) as n, coalesce(md5(string_agg(r::text, E'\\n' order by r::text)), '') as h from ${tbl} r where ${pred}"
    else
      sel="select '${tbl}' as t, count(*) as n, '' as h from ${tbl} r where ${pred}"
    fi
    if [ "$first" = 1 ]; then first=0; else printf ' union all '; fi
    printf '%s' "$sel"
  done <<<"$SPECS"
  printf ' order by 1;\n'
}

b_counts() { q -At -c "$(spec_query "{${B_ID}}" "$B_KEYS" "$B_PORTS" count)"; }
bystander_snapshot() { q -At -c "$(spec_query "{${X_ID},${M_ID}}" "$XM_KEYS" "$XM_PORTS" md5)"; }
# global_counts: whole-table counts for every spec table (no predicate), for channel deltas.
global_counts() {
  local line tbl first=1 sql=""
  while IFS= read -r line; do
    tbl="${line%%|*}"
    if [ "$first" = 1 ]; then first=0; else sql="${sql} union all "; fi
    sql="${sql}select '${tbl}' as t, count(*) as n from ${tbl}"
  done <<<"$SPECS"
  q -At -c "${sql} order by 1"
}

# --- token filling -----------------------------------------------------------
# fill_file <template> <out>: tokens come from the FILL_* environment variables, never from sed.
fill_file() {
  node -e '
    const fs = require("fs");
    let s = fs.readFileSync(process.argv[1], "utf8");
    for (const [k, v] of Object.entries(process.env)) {
      if (!k.startsWith("FILL_")) continue;
      s = s.split("{{" + k.slice(5) + "}}").join(v);
    }
    const left = s.match(/\{\{[A-Z_0-9]+\}\}/g);
    if (left) { console.error("unfilled tokens: " + left.length); process.exit(1); }
    fs.writeFileSync(process.argv[2], s, { mode: 0o600 });
  ' "$1" "$2"
}

# run_census <digest>: prints "name|value" lines. Read-only.
run_census() {
  FILL_PAIR_B_LOGIN_SHA256="$1" fill_file "$HERE/241-PAIRB-census.sql" "$TMP/census.filled.sql"
  q -x -A -t -f "$TMP/census.filled.sql" | grep -a '|'
}

# exists_count <digest>: the SC-1 existence query.
exists_count() {
  FILL_LOGIN_SHA256="$1" fill_file "$HERE/241-PAIRB-exists.sql" "$TMP/exists.filled.sql"
  q -At -f "$TMP/exists.filled.sql"
}

# cget <census text> <column>
cget() { printf '%s\n' "$1" | awk -F'|' -v k="$2" '$1 == k {print $2}'; }

# fill_from_census: fills every chain token from the census output, exactly as plan 04 will.
fill_from_census() {
  local census; census="$(run_census "$B_DIGEST")"
  [ "$(cget "$census" pair_b_ids)" = 1 ] || { echo "FAIL ${ARM}: census resolved $(cget "$census" pair_b_ids) logins, expected 1" >&2; return 1; }
  local nonzero; nonzero="$(printf '%s\n' "$census" | awk -F'|' '$1 ~ /^zero_/ && $2 != 0 {print $1}')"
  [ -z "$nonzero" ] || { echo "FAIL ${ARM}: census zero columns not zero: $(echo "$nonzero" | tr '\n' ' ')" >&2; return 1; }
  export FILL_EXPECTED_MARKER="$LANE_MARKER" FILL_PAIR_B_LOGIN_SHA256="$B_DIGEST"
  local col name
  for col in $(printf '%s\n' "$census" | awk -F'|' '$1 ~ /^expect_/ {print $1}'); do
    name="$(printf '%s' "$col" | tr 'a-z' 'A-Z')"
    export "FILL_${name}=$(cget "$census" "$col")"
  done
  CENSUS="$census"
}

# fill_chain <out>: fills the chain template from the FILL_* variables.
fill_chain() { fill_file "$HERE/241-PAIRB-chain.sql" "$1"; }

admin_delete() {
  SUPABASE_URL="$API_URL" SUPABASE_SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY" \
    node "$HERE/241-PAIRB-admin-delete.mjs" --target lane --login-sha256 "$B_DIGEST"
}

assert_b_zero() {
  local nonzero
  nonzero="$(b_counts | awk -F'|' '$2 != 0 {print $1}')"
  [ -z "$nonzero" ] || { echo "FAIL ${ARM}: rows remain for the fixture allocator in: $(echo "$nonzero" | tr '\n' ' ')" >&2; return 1; }
}

# audit rows survive with a NULL subject: <total> rows tagged for B, all with user_id NULL
audit_tagged() {
  q -Atc "select count(*) || '|' || count(*) filter (where user_id is null) from public.audit_log where metadata->>'fx' = '${B_ID}'"
}

# --- arms --------------------------------------------------------------------
# Tables whose fixture rows must exist for B before the chain, so a PASS cannot be vacuous.
NONEMPTY="public.allocator_holdings public.bridge_outcomes public.match_decisions public.match_candidates public.match_batches public.allocator_preferences public.api_keys public.csv_daily_returns public.compute_jobs public.api_key_nav_marks public.allocator_equity_derived public.portfolios public.portfolio_analytics public.user_app_roles public.investor_attestations public.profiles public.audit_log auth.users auth.sessions auth.identities"

assert_b_shape_nonzero() {
  local counts t n; counts="$(b_counts)"
  for t in $NONEMPTY; do
    n="$(printf '%s\n' "$counts" | awk -F'|' -v k="$t" '$1 == k {print $2}')"
    [ -n "$n" ] && [ "$n" -gt 0 ] || { echo "FAIL ${ARM}: fixture holds no rows for the allocator in ${t}" >&2; return 1; }
  done
}

# after the chain and an auth delete: B gone everywhere, B's audit rows kept with a NULL subject
assert_b_gone() {
  local before_audit="$1" snap_before="$2" after_audit
  assert_b_zero
  [ "$(exists_count "$B_DIGEST")" = 0 ] || { echo "FAIL ${ARM}: the existence query still finds the login" >&2; return 1; }
  after_audit="$(audit_tagged)"
  [ "${after_audit%%|*}" = "${before_audit%%|*}" ] && [ "${after_audit##*|}" = "${before_audit%%|*}" ] \
    || { echo "FAIL ${ARM}: audit rows did not survive with a NULL subject (before ${before_audit} after ${after_audit})" >&2; return 1; }
  [ "$snap_before" = "$(bystander_snapshot)" ] || { echo "FAIL ${ARM}: bystander snapshot changed" >&2; return 1; }
}

arm_census-shape() {
  new_fixture
  assert_b_shape_nonzero
  local census; census="$(run_census "$B_DIGEST")"
  local bc; bc="$(b_counts)"
  local pair; pair="$(cget "$census" pair_b_ids)"
  [ "$pair" = 1 ] || { echo "FAIL census-shape: pair_b_ids=${pair}" >&2; return 1; }
  local nonzero; nonzero="$(printf '%s\n' "$census" | awk -F'|' '$1 ~ /^zero_/ && $2 != 0 {print $1}')"
  [ -z "$nonzero" ] || { echo "FAIL census-shape: zero columns not zero: $nonzero" >&2; return 1; }
  [ "$(exists_count "$B_DIGEST")" = 1 ] || { echo "FAIL census-shape: existence query did not find the fixture login" >&2; return 1; }
  [ "$(exists_count "$(printf 'absent-%s' "$RANDOM$RANDOM" | shasum -a 256 | cut -d' ' -f1)")" = 0 ] \
    || { echo "FAIL census-shape: existence query found a login that does not exist" >&2; return 1; }
  # what the fixture inserted for B (a constant per class) and what an independent count says
  local pair_cols="expect_holdings:3 expect_bridge_outcomes:2 expect_match_decisions:2 expect_match_candidates:1 expect_match_batches:1 expect_allocator_preferences:1 expect_api_keys:2 expect_sibling_keys:1 info_audit_rows_b:5 info_auth_sessions:1 info_auth_identities:1 info_profiles:1 info_user_app_roles:1 info_investor_attestations:1 info_portfolios:2 info_portfolio_analytics:2 info_csv_daily_returns:3 info_api_key_nav_marks:1 info_allocator_equity_derived:2 info_compute_jobs:3 info_strategies:0 info_contact_requests:0 info_user_app_roles_granted_by_b:1"
  local pc col want got
  for pc in $pair_cols; do
    col="${pc%%:*}"; want="${pc##*:}"; got="$(cget "$census" "$col")"
    [ "$got" = "$want" ] || { echo "FAIL census-shape: ${col} is ${got}, the fixture inserted ${want}" >&2; return 1; }
  done
  # census versus the independent per-table count
  local map="expect_holdings:public.allocator_holdings expect_bridge_outcomes:public.bridge_outcomes expect_match_decisions:public.match_decisions expect_match_candidates:public.match_candidates expect_match_batches:public.match_batches expect_allocator_preferences:public.allocator_preferences expect_api_keys:public.api_keys info_csv_daily_returns:public.csv_daily_returns info_compute_jobs:public.compute_jobs info_api_key_nav_marks:public.api_key_nav_marks info_allocator_equity_derived:public.allocator_equity_derived info_portfolios:public.portfolios info_portfolio_analytics:public.portfolio_analytics info_user_app_roles:public.user_app_roles info_investor_attestations:public.investor_attestations info_profiles:public.profiles info_audit_rows_b:public.audit_log info_auth_sessions:auth.sessions info_auth_identities:auth.identities"
  local m tbl
  for m in $map; do
    col="${m%%:*}"; tbl="${m##*:}"
    got="$(cget "$census" "$col")"; want="$(printf '%s\n' "$bc" | awk -F'|' -v k="$tbl" '$1 == k {print $2}')"
    [ "$got" = "$want" ] || { echo "FAIL census-shape: ${col} is ${got}, the independent count of ${tbl} is ${want}" >&2; return 1; }
  done
  echo "PASS census-shape"
}

arm_chain-admin() {
  new_fixture
  assert_b_shape_nonzero
  local before_audit; before_audit="$(audit_tagged)"
  local snap_before; snap_before="$(bystander_snapshot)"
  fill_from_census
  local filled="$TMP/chain.filled.sql"
  fill_chain "$filled"
  q -f "$filled" >/dev/null || { echo "FAIL chain-admin: chain did not commit" >&2; return 1; }
  admin_delete || { echo "FAIL chain-admin: admin-api delete" >&2; return 1; }
  assert_b_gone "$before_audit" "$snap_before"
  echo "PASS chain-admin"
}

# one full pass of a channel; prints the post-state signature (zero set, audit, global deltas)
channel_signature() {
  local channel="$1" before_audit snap_before g_before g_after
  new_fixture
  assert_b_shape_nonzero
  before_audit="$(audit_tagged)"
  snap_before="$(bystander_snapshot)"
  fill_from_census
  fill_chain "$TMP/chain.filled.sql"
  g_before="$(global_counts)"
  q -f "$TMP/chain.filled.sql" >/dev/null || { echo "FAIL ${ARM}: chain did not commit (${channel})" >&2; return 1; }
  if [ "$channel" = admin ]; then
    admin_delete >/dev/null || { echo "FAIL ${ARM}: admin-api delete" >&2; return 1; }
  else
    q -c "DELETE FROM auth.users WHERE id = '${B_ID}'" >/dev/null || { echo "FAIL ${ARM}: raw delete of the auth user" >&2; return 1; }
  fi
  assert_b_gone "$before_audit" "$snap_before"
  g_after="$(global_counts)"
  { b_counts; audit_tagged; paste -d'|' <(printf '%s\n' "$g_before") <(printf '%s\n' "$g_after"); } | awk -F'|' 'NF == 2 || NF == 3 {print} NF == 4 {print $1 "|" ($4 - $2)}'
}

arm_chain-sql() {
  local sig_admin sig_sql
  sig_sql="$(channel_signature sql)"
  sig_admin="$(channel_signature admin)"
  if [ "$sig_sql" = "$sig_admin" ]; then
    echo "channels-equivalent yes"
    echo "PASS chain-sql"
  else
    echo "channels-equivalent no" >&2
    diff <(printf '%s\n' "$sig_admin") <(printf '%s\n' "$sig_sql") >&2 || true
    echo "FAIL chain-sql: the two channels left different results" >&2
    return 1
  fi
}

arm_plain-delete-rollback() {
  new_fixture
  assert_b_shape_nonzero
  local before after out rc outcome
  before="$(b_counts)"
  rc=0
  out="$(printf 'BEGIN;\nDELETE FROM auth.users WHERE id = %s;\nROLLBACK;\n' "'${B_ID}'" \
    | psql "$DB_URL" -X -q -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -v SHOWCONTEXT=never -f - 2>&1 >/dev/null)" || rc=$?
  if [ "$rc" = 0 ]; then
    outcome="the plain one-statement delete SUCCEEDED on the lane (rolled back)"
  else
    # first ERROR line only: SQLSTATE, then the constraint and table names; never DETAIL
    outcome="the plain one-statement delete FAILED on the lane: $(printf '%s\n' "$out" | { grep -a -m1 'ERROR:' || true; } | sed -E 's/^.*ERROR: +//')"
  fi
  after="$(b_counts)"
  [ "$before" = "$after" ] || { echo "FAIL plain-delete-rollback: counts changed after the rolled-back delete" >&2; return 1; }
  [ "$(exists_count "$B_DIGEST")" = 1 ] || { echo "FAIL plain-delete-rollback: the login is gone after ROLLBACK" >&2; return 1; }
  echo "plain-delete-rollback outcome: ${outcome}"
  echo "(lane evidence of order sensitivity only; no claim about PROD)"
  echo "PASS plain-delete-rollback"
}

arm_catalog-lane() {
  [ -n "$TMP" ] || TMP="$(mktemp -d)"
  { sed '$ s/;[[:space:]]*$//' "$HERE/241-PAIRB-catalog.sql"; printf '\n\\gset cat_\n'; } > "$TMP/catalog.psql"
  {
    cat "$TMP/catalog.psql"
    printf '\\t on\n\\a\n'
    printf "SELECT :'cat_strict_rows' || '|' || :'cat_strict_md5' || '|' || :'cat_auth_rows' || '|' || :'cat_auth_md5';\n"
    printf "\\\\o %s/strict_lines.txt\n" "$TMP"
    printf "SELECT :'cat_strict_lines';\n"
    printf "\\\\o %s/auth_lines.txt\n" "$TMP"
    printf "SELECT :'cat_auth_lines';\n"
    printf "\\\\o\n"
  } | psql "$DB_URL" -X -q -v ON_ERROR_STOP=1 > "$TMP/counts.txt"
  local counts; counts="$(cat "$TMP/counts.txt")"
  local strict_rows strict_md5 auth_rows auth_md5
  IFS='|' read -r strict_rows strict_md5 auth_rows auth_md5 <<<"$counts"
  [ "${strict_rows:-0}" -gt 0 ] || { echo "FAIL catalog-lane: the walk returned no strict lines" >&2; return 1; }
  grep -aqxF 'fk|public.allocator_holdings|allocator_holdings_api_key_id_fkey|public.api_keys|r|false' "$TMP/strict_lines.txt" \
    || { echo "FAIL catalog-lane: the holdings RESTRICT edge is missing from the walk" >&2; return 1; }
  grep -aqxF 'fk|public.match_decisions|match_decisions_decided_by_fkey|public.profiles|a|false' "$TMP/strict_lines.txt" \
    || { echo "FAIL catalog-lane: the decided_by NO ACTION edge is missing from the walk" >&2; return 1; }
  echo "strict_rows=${strict_rows}"
  echo "strict_md5=${strict_md5}"
  echo "auth_rows=${auth_rows}"
  echo "auth_md5=${auth_md5}"
  echo "--- strict_lines"
  grep -a . "$TMP/strict_lines.txt"
  echo "--- auth_lines"
  grep -a . "$TMP/auth_lines.txt"
  echo "PASS catalog-lane"
}

# --- abort arms ---------------------------------------------------------------
# run_abort <arm> <named check> <mutation function>: fresh fixture, tokens filled from the
# census, then ONE mutation that must trip exactly that check. The chain must exit non-zero
# with the check name in its error, and every table total must be identical before and after.
run_abort() {
  local arm="$1" want="$2" mutate="$3" filled="" g_before g_after b_before b_after err rc=0
  new_fixture
  assert_b_shape_nonzero
  fill_from_census
  "$mutate"
  fill_chain "$TMP/chain.filled.sql"
  g_before="$(global_counts)"; b_before="$(b_counts)"
  q -f "$TMP/chain.filled.sql" >/dev/null 2>"$TMP/chain.err" || rc=$?
  err="$(cat "$TMP/chain.err")"
  [ "$rc" != 0 ] || { echo "FAIL ${arm}: the chain COMMITTED instead of aborting on ${want}" >&2; return 1; }
  printf '%s\n' "$err" | grep -aq "ERROR: *${want}" \
    || { echo "FAIL ${arm}: the chain aborted, but not on the named check ${want} (saw: $(printf '%s\n' "$err" | grep -a -m1 'ERROR:' | sed -E 's/^.*ERROR: +//' | cut -c1-120))" >&2; return 1; }
  g_after="$(global_counts)"; b_after="$(b_counts)"
  [ "$g_before" = "$g_after" ] && [ "$b_before" = "$b_after" ] \
    || { echo "FAIL ${arm}: table counts changed although the chain aborted" >&2; return 1; }
  echo "PASS ${arm}"
}

mutate_wrong_count() { export FILL_EXPECT_HOLDINGS="$(( FILL_EXPECT_HOLDINGS + 1 ))"; }
# the edge used: an X decision whose decided_by names B (match_decisions.decided_by, NO ACTION).
# The insert trigger accepts it, so no fallback to allocator_preferences.edited_by_user_id was needed.
mutate_cross_owner() {
  q -c "UPDATE public.match_decisions SET decided_by = '${B_ID}' WHERE allocator_id = '${X_ID}' AND kind = 'voluntary_add'" >/dev/null
}
mutate_no_match() { export FILL_PAIR_B_LOGIN_SHA256="$(printf 'absent-%s' "$RANDOM$RANDOM" | shasum -a 256 | cut -d' ' -f1)"; }
mutate_marker() { export FILL_EXPECTED_MARKER="a different marker"; }

arm_abort-wrong-count() { run_abort abort-wrong-count 'count-mismatch:allocator_holdings' mutate_wrong_count; }
arm_abort-cross-owner() { run_abort abort-cross-owner 'cross-owner:match_decisions.decided_by' mutate_cross_owner; }
arm_abort-no-match() { run_abort abort-no-match 'pair-b-ids: expected 1 got 0' mutate_no_match; }
arm_abort-marker() { run_abort abort-marker 'marker-mismatch' mutate_marker; }

ARMS="census-shape chain-admin chain-sql plain-delete-rollback catalog-lane abort-wrong-count abort-cross-owner abort-no-match abort-marker"

# --- dispatch ----------------------------------------------------------------
run_arm() {
  ARM="$1"
  declare -F "arm_${ARM}" >/dev/null || { echo "unknown arm: ${ARM}" >&2; exit 2; }
  load_lane
  trap 'rc=$?; cleanup; [ $rc -eq 0 ] || echo "FAIL ${ARM}: exit ${rc}"' EXIT
  "arm_${ARM}"
}

case "${1:-}" in
  up)    cmd_up ;;
  down)  cmd_down ;;
  --arm) run_arm "${2:?arm name}" ;;
  --all)
    pass=0; failn=0
    for a in $ARMS; do
      out="$(bash "${BASH_SOURCE[0]}" --arm "$a" 2>&1)" && rc=0 || rc=$?
      printf '%s\n' "$out"
      if [ "$rc" = 0 ] && printf '%s\n' "$out" | grep -q "^PASS ${a}\$"; then pass=$((pass+1)); else failn=$((failn+1)); fi
    done
    echo "SUMMARY pass=${pass} fail=${failn}"
    [ "$failn" = 0 ]
    ;;
  *) echo "usage: $0 up|down|--arm <name>|--all" >&2; exit 2 ;;
esac
