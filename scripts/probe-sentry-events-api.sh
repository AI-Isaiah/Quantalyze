#!/usr/bin/env bash
# Phase 19 / BACKBONE-05 / Assumption A1 — one-shot probe of Sentry events API.
#
# Verifies the response shape BEFORE deploying /api/cron/flag-monitor. Sentry's
# events API has rotated shape twice since GA (2023). The cron handler in
# src/app/api/cron/flag-monitor/route.ts parses both `data[0]["count()"]` and
# `data[0].count` for resilience, but a third shape (e.g. `data[0].errorCount`)
# would silently return 0 and the auto-rollback path would never trip even
# under a real production incident.
#
# Required env:
#   SENTRY_AUTH_TOKEN  org-scoped, scope `event:read`
#   SENTRY_ORG_SLUG    e.g. "quantalyze"
#
# Usage:
#   export SENTRY_AUTH_TOKEN=...
#   export SENTRY_ORG_SLUG=...
#   bash scripts/probe-sentry-events-api.sh
#
# Exit codes:
#   0  shape matches Assumption A1 (data[0].count or data[0]."count()")
#   1  required env var missing
#   2  response not JSON (or jq missing)
#   3  shape does NOT match Assumption A1 — adjust route.ts before deploy
#   4  HTTP non-2xx from Sentry (auth or scope problem)
set -euo pipefail

if [[ -z "${SENTRY_AUTH_TOKEN:-}" ]]; then
  echo "FAIL: SENTRY_AUTH_TOKEN not set." >&2
  exit 1
fi
if [[ -z "${SENTRY_ORG_SLUG:-}" ]]; then
  echo "FAIL: SENTRY_ORG_SLUG not set." >&2
  exit 1
fi
if ! command -v jq >/dev/null 2>&1; then
  echo "FAIL: jq is required (brew install jq)." >&2
  exit 2
fi

URL="https://sentry.io/api/0/organizations/${SENTRY_ORG_SLUG}/events/"
# Probe an intentionally generic query (no path filter) so the probe still
# returns a response shape even when /api/process-key has zero events.
QUERY='statsPeriod=15m&query=level%3Aerror+environment%3Aproduction&field=count%28%29'

echo "Probing: $URL?$QUERY"
HTTP_STATUS=$(curl -sS -o /tmp/sentry-probe-resp.json -w "%{http_code}" \
  -H "Authorization: Bearer $SENTRY_AUTH_TOKEN" \
  "$URL?$QUERY")

if [[ "$HTTP_STATUS" != "200" ]]; then
  echo "FAIL: Sentry returned HTTP $HTTP_STATUS" >&2
  cat /tmp/sentry-probe-resp.json >&2 || true
  exit 4
fi

echo "--- Raw response ---"
if ! jq . /tmp/sentry-probe-resp.json; then
  echo "FAIL: response not JSON" >&2
  cat /tmp/sentry-probe-resp.json >&2
  exit 2
fi

# Verify expected shape: data[0] exists with a `count()` or `count` field.
HAS_COUNT=$(jq -r '
  .data
  | if type == "array" and length > 0
    then (.[0] | (has("count()") or has("count")))
    else false
    end
' /tmp/sentry-probe-resp.json 2>/dev/null || echo "false")

if [[ "$HAS_COUNT" != "true" ]]; then
  echo "" >&2
  echo "WARN: response shape does not match Assumption A1." >&2
  echo "Neither data[0].\"count()\" nor data[0].count present." >&2
  echo "Adjust src/app/api/cron/flag-monitor/route.ts to match the actual shape" >&2
  echo "BEFORE deploying. Document the observed shape in" >&2
  echo ".planning/phases/19-unified-backbone-conditional-on-day-2-gate-commit/19-07-SUMMARY.md" >&2
  exit 3
fi

echo ""
echo "OK: Sentry events API responds with shape data[0].count (or data[0].\"count()\")."
echo "Cron handler can rely on this shape. (Assumption A1 verified.)"
