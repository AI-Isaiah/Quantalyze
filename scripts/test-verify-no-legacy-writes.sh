#!/usr/bin/env bash
# Self-test for scripts/verify-no-legacy-writes.sh — exercises every exit-code
# branch offline using the script's test seams (PHASE19_STABILITY_LOG +
# PHASE19_FAKE_RPC_RESPONSE). No network, no prod. Mirrors the
# scripts/test-migration-policy-algorithm.sh self-test pattern.
#
# Run: bash scripts/test-verify-no-legacy-writes.sh   (exit 0 = all pass)
set -uo pipefail

SCRIPT="$(cd "$(dirname "$0")/.." && pwd)/scripts/verify-no-legacy-writes.sh"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
PASS=0; FAIL=0

# write_log <flag_flipped_at value>  → returns path to a stability-log stub
write_log() {
  local f="$TMP/log-$RANDOM.md"
  printf -- '- **flag_flipped_at:** %s\n' "$1" > "$f"
  printf '%s' "$f"
}

# expect <name> <expected_exit> -- env... -- (runs SCRIPT, asserts exit code)
expect() {
  local name="$1" want="$2"; shift 2
  [ "$1" = "--" ] && shift
  local out rc
  out=$(env "$@" bash "$SCRIPT" 2>&1); rc=$?
  if [ "$rc" = "$want" ]; then
    PASS=$((PASS+1)); echo "  ok   $name (exit $rc)"
  else
    FAIL=$((FAIL+1)); echo "  FAIL $name: expected exit $want, got $rc"
    echo "       output: $(printf '%s' "$out" | head -1)"
  fi
}

URL="PROD_SUPABASE_URL=https://example.supabase.co"
KEY="PROD_SUPABASE_ANON_KEY=anon-test-key"
TODO_LOG=$(write_log "TODO (record from commit (b) timestamp; e.g. 2026-05-15T14:00:00Z)")
GOOD_LOG=$(write_log "2026-05-25T14:00:00Z")
BAD_LOG=$(write_log "2026-05-25T14:00:00Z (commit b)")

echo "verify-no-legacy-writes.sh self-test:"

# Exit 1 — stability-log missing
expect "missing log" 1 -- PHASE19_STABILITY_LOG="$TMP/nope.md" $URL $KEY

# Exit 1 — malformed flag_flipped_at (trailing parenthetical)
expect "malformed flip ts" 1 -- PHASE19_STABILITY_LOG="$BAD_LOG" $URL $KEY \
  PHASE19_FAKE_RPC_RESPONSE='{"flag_value":"on","vr_is_view":false,"legacy_write_count":0}'

# Exit 2 — not configured (flip TODO, no env)
expect "not configured" 2 -- PHASE19_STABILITY_LOG="$TODO_LOG"

# Exit 5 — gate active (flip recorded) but env missing
expect "active + no env" 5 -- PHASE19_STABILITY_LOG="$GOOD_LOG"

# Exit 2 — not started (flip TODO, flag off)
expect "not started" 2 -- PHASE19_STABILITY_LOG="$TODO_LOG" $URL $KEY \
  PHASE19_FAKE_RPC_RESPONSE='{"flag_value":"off","vr_is_view":false,"legacy_write_count":0}'

# Exit 6 — flag ON but flip TODO (inconsistent)
expect "flag on + flip TODO" 6 -- PHASE19_STABILITY_LOG="$TODO_LOG" $URL $KEY \
  PHASE19_FAKE_RPC_RESPONSE='{"flag_value":"on","vr_is_view":false,"legacy_write_count":0}'

# Exit 6 — view-shim applied but flip TODO (out-of-order PR-D)
expect "view + flip TODO" 6 -- PHASE19_STABILITY_LOG="$TODO_LOG" $URL $KEY \
  PHASE19_FAKE_RPC_RESPONSE='{"flag_value":"off","vr_is_view":true,"legacy_write_count":0}'

# Exit 7 — flip recorded but flag OFF (rolled back mid-window)
expect "rolled back mid-soak" 7 -- PHASE19_STABILITY_LOG="$GOOD_LOG" $URL $KEY \
  PHASE19_FAKE_RPC_RESPONSE='{"flag_value":"off","vr_is_view":false,"legacy_write_count":0}'

# Exit 4 — legacy writes detected
expect "legacy writes found" 4 -- PHASE19_STABILITY_LOG="$GOOD_LOG" $URL $KEY \
  PHASE19_FAKE_RPC_RESPONSE='{"flag_value":"on","vr_is_view":false,"legacy_write_count":3}'

# Exit 0 — clean soak
expect "clean soak" 0 -- PHASE19_STABILITY_LOG="$GOOD_LOG" $URL $KEY \
  PHASE19_FAKE_RPC_RESPONSE='{"flag_value":"on","vr_is_view":false,"legacy_write_count":0}'

# Exit 0 — gate retired (view applied + soak recorded)
expect "gate retired" 0 -- PHASE19_STABILITY_LOG="$GOOD_LOG" $URL $KEY \
  PHASE19_FAKE_RPC_RESPONSE='{"flag_value":"on","vr_is_view":true,"legacy_write_count":0}'

# Exit 2 — RPC not deployed (PGRST202)
expect "rpc not deployed" 2 -- PHASE19_STABILITY_LOG="$GOOD_LOG" $URL $KEY \
  PHASE19_FAKE_RPC_RESPONSE='{"code":"PGRST202","message":"Could not find the function"}'

# Exit 3 — unparseable response
expect "parse error" 3 -- PHASE19_STABILITY_LOG="$GOOD_LOG" $URL $KEY \
  PHASE19_FAKE_RPC_RESPONSE='not json at all'

echo ""
echo "RESULT: $PASS passed, $FAIL failed"
[ "$FAIL" = "0" ] || exit 1
