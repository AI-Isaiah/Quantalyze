#!/usr/bin/env bash
# Phase 16 / OBSERV-07 + Plan 16-07 Task 5 — live smoke against the analytics-service
# debug-key-flow internal endpoints.
#
# Bypasses the Vercel admin gate by hitting Railway directly with INTERNAL_API_TOKEN.
# Validates that:
#   1. INTERNAL_API_TOKEN parity holds between caller and FastAPI (no 401).
#   2. DEBUG_KEY_FLOW_<BROKER>_{KEY,SECRET,PASSPHRASE} env-blobs are staged on Railway
#      (no 503 "env-blobs not configured").
#   3. The 3 step bodies (validate / encrypt / fetch-trades) return status="ok" for
#      each broker — proving real broker SDK calls work end-to-end.
#
# When any step body is still a placeholder (Phase 16 surfaced #13 + #14), this script
# exits non-zero and the JSON error envelope identifies the missing wiring.
#
# Usage:
#   INTERNAL_API_TOKEN=… bash scripts/smoke-debug-key-flow.sh
#   INTERNAL_API_TOKEN=… ANALYTICS_BASE=https://… BROKERS="okx bybit" bash …
#
# Defaults:
#   ANALYTICS_BASE=https://quantalyze-analytics-production.up.railway.app
#   BROKERS="okx binance bybit"  (override e.g. to skip Binance pre-account)
#
# Exit codes:
#   0 — all (broker × step) calls returned status="ok"
#   1 — at least one step returned status="error"
#   2 — pre-flight failure (missing INTERNAL_API_TOKEN or curl/jq)

set -euo pipefail

PREFIX="[smoke-debug-key-flow]"
log() { echo "$PREFIX $*" >&2; }

ANALYTICS_BASE="${ANALYTICS_BASE:-https://quantalyze-analytics-production.up.railway.app}"
# Binance is intentionally NOT in the default — founder has no Binance account
# and the testnet endpoint (testnet.binance.vision) has been intermittently 502.
# Override with `BROKERS="okx binance bybit"` once Binance is in scope again.
BROKERS="${BROKERS:-okx bybit}"
STEPS="validate encrypt fetch-trades"

if [ -z "${INTERNAL_API_TOKEN:-}" ]; then
  log "INTERNAL_API_TOKEN env var required (must match Railway value)"
  log "  source it from Railway: railway variables --service quantalyze-analytics --kv | grep INTERNAL_API_TOKEN"
  exit 2
fi

command -v curl >/dev/null || { log "curl not found"; exit 2; }
command -v jq >/dev/null   || { log "jq not found (brew install jq)"; exit 2; }

failures=0
total=0

for broker in $BROKERS; do
  log "──────── broker=$broker ────────"
  for step in $STEPS; do
    total=$((total + 1))
    response=$(
      curl -sS \
        -X POST "$ANALYTICS_BASE/internal/debug-key-flow/$step" \
        -H "Content-Type: application/json" \
        -H "x-internal-token: $INTERNAL_API_TOKEN" \
        -d "{\"broker\":\"$broker\"}" \
        -w "\n--HTTP %{http_code}--" \
        --max-time 60
    )
    http_code=$(echo "$response" | tail -1 | sed 's/--HTTP //; s/--//')
    body=$(echo "$response" | sed '$d')

    status=$(echo "$body" | jq -r '.status // "unknown"' 2>/dev/null || echo "parse-error")
    duration=$(echo "$body" | jq -r '.duration_ms // 0' 2>/dev/null || echo "?")

    if [ "$http_code" = "200" ] && [ "$status" = "ok" ]; then
      log "  ✓ $step (HTTP $http_code, status=ok, ${duration}ms)"
      detail=$(echo "$body" | jq -c '.detail // {}' 2>/dev/null || echo "{}")
      log "      detail: $detail"
    else
      failures=$((failures + 1))
      log "  ✗ $step (HTTP $http_code, status=$status, ${duration}ms)"
      err_code=$(echo "$body" | jq -r '.error.code // "no-code"' 2>/dev/null || echo "?")
      err_msg=$(echo "$body" | jq -r '.error.human_message // "no-message"' 2>/dev/null || echo "?")
      log "      error.code: $err_code"
      log "      error.message: $err_msg"
    fi
  done
done

log "──────── summary: $((total - failures))/$total OK ────────"
[ "$failures" -eq 0 ] || exit 1
