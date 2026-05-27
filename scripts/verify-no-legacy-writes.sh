#!/usr/bin/env bash
# Phase 19 — PRODUCTION soak gate (rewritten 2026-05-25, robust detector).
#
# Measures PRODUCTION (project khslejtfbuezsmvmtsdn) by calling the read-only
# `phase19_soak_status(p_since)` RPC with the prod ANON key. The RPC counts
# rows the `verification_requests_post_phase19_audit` trigger writes to
# audit_log on EVERY direct write (INSERT/UPDATE/DELETE) to the legacy
# verification_requests table — so it catches UPDATEs and DELETEs, not just
# INSERTs. See supabase/migrations/20260525113000_phase19_soak_status_rpc.sql.
# The RPC returns ONLY scalars, so the workflow needs no service_role key.
#
# Exit codes:
#   0 — clean (flag ON + flag_flipped_at recorded + 0 legacy writes), OR the
#       view-shim is applied AND the soak was recorded (gate retired).
#   1 — stability-log.md missing, OR flag_flipped_at present but malformed.
#   2 — not started / not configured (nothing measured; workflow warns, green).
#   3 — RPC HTTP error or unparseable response.
#   4 — legacy verification_requests writes detected since flip. PR-D BLOCKED.
#   5 — gate is active (flag_flipped_at recorded) but required env vars missing.
#   6 — INCONSISTENT: prod state advanced (kill-switch ON, or view-shim applied)
#       but flag_flipped_at is still TODO. Record the flip timestamp.
#   7 — INVALID SOAK: flag_flipped_at recorded but prod kill-switch is OFF
#       (auto-rollback fired mid-window). The soak must restart.
#   8 — SOAK INCOMPLETE: elapsed >=168h but phase19_soak_daily has <7 rows.
#       The Vercel cron /api/cron/phase19-error-rollup is not running (or
#       failing). Daily evidence is missing; PR-D BLOCKED until backfilled.
#   9 — ERROR-RATE BREACH: a phase19_soak_daily row has error_rate >= 0.005
#       (0.5%) or breach_count > 0. PR-D BLOCKED — error rate exceeds the
#       go/no-go threshold on at least one day.
#
# Test seams (default to real behavior — zero prod impact when unset):
#   PHASE19_STABILITY_LOG     override the stability-log path
#   PHASE19_FAKE_RPC_RESPONSE if set, used as the RPC response (skips curl)
set -euo pipefail

STABILITY_LOG="${PHASE19_STABILITY_LOG:-.planning/phase-19/stability-log.md}"
if [[ ! -f "$STABILITY_LOG" ]]; then
  echo "FAIL: $STABILITY_LOG missing." >&2
  exit 1
fi

FLIP_TS=$(grep -E '^- \*\*flag_flipped_at:\*\*' "$STABILITY_LOG" | head -1 | sed -E 's/^- \*\*flag_flipped_at:\*\* +//')
FLIP_RECORDED=true
SINCE="$FLIP_TS"
if [[ -z "$FLIP_TS" || "$FLIP_TS" == TODO* ]]; then
  FLIP_RECORDED=false
  SINCE="1970-01-01T00:00:00Z"   # placeholder; count ignored pre-flip
else
  # Parse hardening: the stability-log placeholder primes operators to append a
  # parenthetical note ("... (commit b)"). The sed above captures the whole
  # tail, which would then be embedded into the RPC's timestamptz arg and fail
  # at the DB — a permanently red gate. Require a BARE ISO-8601 UTC timestamp.
  if [[ ! "$FLIP_TS" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?(Z|[+-][0-9]{2}:?[0-9]{2})$ ]]; then
    echo "FAIL: flag_flipped_at='$FLIP_TS' is not a bare ISO-8601 timestamp." >&2
    echo "      Record ONLY the timestamp (e.g. 2026-05-25T14:00:00Z) in" >&2
    echo "      $STABILITY_LOG — no trailing notes or parentheticals." >&2
    exit 1
  fi
fi

# Env presence: fail loud only when the gate is active. Pre-flip, a missing
# secret is reported as "not started" (exit 2) so the cron isn't red during setup.
if [[ -z "${PROD_SUPABASE_URL:-}" || -z "${PROD_SUPABASE_ANON_KEY:-}" ]]; then
  if [[ "$FLIP_RECORDED" == true ]]; then
    echo "FAIL: PROD_SUPABASE_URL and PROD_SUPABASE_ANON_KEY must be set — gate active (flag_flipped_at=$FLIP_TS)." >&2
    exit 5
  fi
  echo "NOT CONFIGURED: PROD_SUPABASE_* secrets unset and soak not started — nothing measured."
  exit 2
fi

# --- Call the read-only prod probe (test seam: PHASE19_FAKE_RPC_RESPONSE) ---
HTTP_CODE=200
if [[ -n "${PHASE19_FAKE_RPC_RESPONSE:-}" ]]; then
  RESP="$PHASE19_FAKE_RPC_RESPONSE"
else
  _BODY=$(mktemp)
  HTTP_CODE=$(curl -sS -o "$_BODY" -w '%{http_code}' --max-time 30 \
    -X POST "${PROD_SUPABASE_URL%/}/rest/v1/rpc/phase19_soak_status" \
    -H "apikey: ${PROD_SUPABASE_ANON_KEY}" \
    -H "Authorization: Bearer ${PROD_SUPABASE_ANON_KEY}" \
    -H "Content-Type: application/json" \
    -d "{\"p_since\": \"${SINCE}\"}" 2>/dev/null || echo "000")
  RESP=$(cat "$_BODY" 2>/dev/null || true)
  rm -f "$_BODY"
fi

if [[ -z "$RESP" ]]; then
  echo "FAIL: empty response from phase19_soak_status RPC (HTTP ${HTTP_CODE})." >&2
  exit 3
fi

# Graceful window: the probe RPC may not be deployed to prod yet (PostgREST
# returns PGRST202 "Could not find the function", HTTP 404). Treat as
# not-configured rather than a hard failure. Checked before the HTTP-status
# branch because PGRST202 arrives with a 404.
if printf '%s' "$RESP" | grep -q "PGRST202\|Could not find the function"; then
  echo "NOT CONFIGURED: phase19_soak_status RPC not deployed to prod yet — nothing measured."
  exit 2
fi

# Distinguish a transport/auth failure (non-2xx) from a 2xx-but-unexpected
# body. An expired anon key (401) should not look like 'RPC unparseable'.
if [[ "$HTTP_CODE" != 2* ]]; then
  echo "FAIL: phase19_soak_status RPC returned HTTP ${HTTP_CODE}." >&2
  printf '      body: %s\n' "$(printf '%s' "$RESP" | head -c 300)" >&2
  exit 3
fi

PARSED=$(printf '%s' "$RESP" | python3 -c '
import sys, json
try:
    d = json.loads(sys.stdin.read())
except Exception:
    print("PARSE_ERR"); sys.exit(0)
if isinstance(d, list):
    d = d[0] if d else {}
if not isinstance(d, dict) or "flag_value" not in d:
    print("PARSE_ERR"); sys.exit(0)
# Extra fields are additive (migration 20260527152800). Missing fields
# default to 0 so a pre-migration prod still parses; the post-168h
# daily-row gate then fails loud with a clearer message than a parse error.
print("%s\t%s\t%s\t%s\t%s\t%s" % (
    d.get("flag_value","ERR"),
    str(d.get("vr_is_view","ERR")).lower(),
    d.get("legacy_write_count","ERR"),
    d.get("daily_rows", 0),
    d.get("max_error_rate", 0),
    d.get("breach_count", 0),
))
')

if [[ "$PARSED" == "PARSE_ERR" ]]; then
  echo "FAIL: could not parse phase19_soak_status response (HTTP ${HTTP_CODE}):" >&2
  printf '%s\n' "$RESP" >&2
  exit 3
fi

FLAG=$(printf '%s' "$PARSED" | cut -f1)
IS_VIEW=$(printf '%s' "$PARSED" | cut -f2)
COUNT=$(printf '%s' "$PARSED" | cut -f3)
DAILY_ROWS=$(printf '%s' "$PARSED" | cut -f4)
MAX_ERROR_RATE=$(printf '%s' "$PARSED" | cut -f5)
BREACH_COUNT=$(printf '%s' "$PARSED" | cut -f6)

# --- Decision logic ---------------------------------------------------------
# View-shim applied. Retiring the gate is only legitimate if the soak actually
# ran (flag_flipped_at recorded). If the shim landed while flag_flipped_at is
# still TODO, the soak never happened and PR-D was applied out of order — fail
# loud rather than return a meaningless green. (Red-team 2026-05-25.)
if [[ "$IS_VIEW" == "true" ]]; then
  if [[ "$FLIP_RECORDED" == true ]]; then
    echo "OK: verification_requests is a VIEW and the soak was recorded ($FLIP_TS) — gate retired."
    exit 0
  fi
  echo "FAIL: view-shim applied (verification_requests is a VIEW) but flag_flipped_at is still TODO." >&2
  echo "      PR-D was applied without a recorded soak — investigate the out-of-order apply." >&2
  exit 6
fi

if [[ "$FLIP_RECORDED" == false ]]; then
  if [[ "$FLAG" == "on" ]]; then
    echo "FAIL: prod kill-switch is ON but flag_flipped_at is still TODO in $STABILITY_LOG." >&2
    echo "      Record the real ISO-8601 flip timestamp to start the 168h soak clock." >&2
    exit 6
  fi
  echo "NOT STARTED: kill-switch is '${FLAG}'; flag_flipped_at unrecorded — soak has not begun (nothing measured)."
  exit 2
fi

# flag_flipped_at recorded → the gate is live.
if [[ "$FLAG" != "on" ]]; then
  echo "FAIL: flag_flipped_at recorded (${FLIP_TS}) but prod kill-switch is '${FLAG}' (expected 'on')." >&2
  echo "      Unified backbone was rolled back mid-window — soak is INVALID; restart it." >&2
  exit 7
fi

if [[ ! "$COUNT" =~ ^[0-9]+$ ]]; then
  echo "FAIL: legacy_write_count not numeric ('${COUNT}'); response:" >&2
  printf '%s\n' "$RESP" >&2
  exit 3
fi

if (( COUNT > 0 )); then
  echo "FAIL: ${COUNT} writes to legacy verification_requests since ${FLIP_TS}." >&2
  echo "      PR-D MUST NOT ship — find the writer (audit_log entity_type=verification_requests_legacy_write) and remove it." >&2
  exit 4
fi

# --- Daily-rollup gate (extension 2026-05-27) -------------------------------
# Only enforced once the soak has run for >=168h. Pre-168h, missing daily
# rows are expected (the cron hasn't had time to fill them); legacy-write
# absence is the only criterion. Post-168h, PR-D ship requires (a) >=7
# daily rows recorded and (b) every row's error_rate < 0.005 AND
# breach_count = 0.
FLIP_EPOCH=$(date -u -d "$FLIP_TS" +%s 2>/dev/null || date -j -u -f "%Y-%m-%dT%H:%M:%SZ" "$FLIP_TS" +%s 2>/dev/null || echo "0")
NOW_EPOCH=$(date -u +%s)
ELAPSED_S=$(( NOW_EPOCH - FLIP_EPOCH ))
ELAPSED_H=$(( ELAPSED_S / 3600 ))

if (( ELAPSED_H >= 168 )); then
  if [[ ! "$DAILY_ROWS" =~ ^[0-9]+$ ]] || (( DAILY_ROWS < 7 )); then
    echo "FAIL: soak elapsed ${ELAPSED_H}h (>=168h) but phase19_soak_daily has only ${DAILY_ROWS} row(s) — expected >=7." >&2
    echo "      Backfill missing days via: curl -H \"Authorization: Bearer \$CRON_SECRET\" \"\$PROD_URL/api/cron/phase19-error-rollup?date=YYYY-MM-DD\"" >&2
    exit 8
  fi

  if [[ ! "$BREACH_COUNT" =~ ^[0-9]+$ ]] || (( BREACH_COUNT > 0 )); then
    echo "FAIL: ${BREACH_COUNT} day(s) in phase19_soak_daily have error_rate >= 0.005 (0.5%); max_error_rate=${MAX_ERROR_RATE}." >&2
    echo "      PR-D MUST NOT ship — error envelope rate breached the go/no-go threshold." >&2
    exit 9
  fi

  echo "OK: soak ${ELAPSED_H}h elapsed; legacy writes=0; ${DAILY_ROWS}/7 daily rows recorded; max_error_rate=${MAX_ERROR_RATE} (<0.005). All gates green."
  exit 0
fi

echo "OK: kill-switch ON since ${FLIP_TS} (${ELAPSED_H}h elapsed, <168h); 0 writes to legacy verification_requests; ${DAILY_ROWS} daily row(s) so far — soak in-progress."
exit 0
