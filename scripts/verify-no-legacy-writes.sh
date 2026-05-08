#!/usr/bin/env bash
# Phase 19 / BACKBONE-04 step (c) / H-8 — verify zero writes to
# `verification_requests` since the flag-flip timestamp recorded in
# .planning/phase-19/stability-log.md.
#
# Originally advisory (founder ran daily); H-8 promotes it to a CI gate
# (.github/workflows/phase-19-stability.yml runs hourly during the 168h
# stability window) and adds a Postgres trigger that logs to audit_log on
# any direct write to verification_requests post-PR-B. PR-D MUST NOT ship
# while this script reports a non-zero count.
#
# WR-01 fix (REVIEW.md 2026-05-08): the previous version of this script
# only PRINTED the audit-log query for an operator to run via Supabase
# MCP and exited 0 — the cron was structurally a no-op. This version
# actually executes the query against the Supabase REST API and exits
# non-zero when the count is non-zero (or when the call fails). The
# workflow at .github/workflows/phase-19-stability.yml passes
# SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in the environment.
#
# Usage:
#   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... bash scripts/verify-no-legacy-writes.sh
#
# Exits:
#   0 — flag_flipped_at recorded AND zero rows where
#       audit_log.entity_type='verification_requests_legacy_write' since
#       the flip timestamp.
#   1 — stability-log.md missing.
#   2 — flag_flipped_at not yet recorded.
#   3 — Supabase REST call failed (auth, network, schema, etc.).
#   4 — Non-zero legacy writes detected; PR-D MUST NOT ship.
#   5 — Required env vars missing AND the gate is meant to be active
#       (flag_flipped_at recorded). Prevents a silent CI-config drift
#       from passing the gate without actually running the query.
set -euo pipefail

STABILITY_LOG=".planning/phase-19/stability-log.md"
if [[ ! -f "$STABILITY_LOG" ]]; then
  echo "FAIL: $STABILITY_LOG missing." >&2
  exit 1
fi

FLIP_TS=$(grep -E '^- \*\*flag_flipped_at:\*\*' "$STABILITY_LOG" | head -1 | sed -E 's/^- \*\*flag_flipped_at:\*\* +//')
if [[ -z "$FLIP_TS" || "$FLIP_TS" == TODO* ]]; then
  echo "FAIL: flag_flipped_at not yet recorded in $STABILITY_LOG; cannot proceed." >&2
  exit 2
fi

echo "Verifying no writes to verification_requests since $FLIP_TS"

# WR-01: Active gate. Required env vars MUST be set so a CI config drift
# doesn't silently pass the gate without running the query.
if [[ -z "${SUPABASE_URL:-}" || -z "${SUPABASE_SERVICE_ROLE_KEY:-}" ]]; then
  echo "FAIL: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set." >&2
  echo "      flag_flipped_at is recorded, so the H-8 gate is meant to be" >&2
  echo "      active. Wire these via the GitHub Actions workflow secrets" >&2
  echo "      block (.github/workflows/phase-19-stability.yml)." >&2
  exit 5
fi

# H-8 Postgres trigger logs each direct write to audit_log with
# entity_type='verification_requests_legacy_write'. We hit the
# PostgREST endpoint with `Prefer: count=exact` + `head=true` and read
# the Content-Range header for the count. This avoids dragging the row
# bodies over the wire.
URL_ENC_TS=$(printf '%s' "$FLIP_TS" | python3 -c 'import sys,urllib.parse; print(urllib.parse.quote(sys.stdin.read().strip(), safe=""))')
ENDPOINT="${SUPABASE_URL%/}/rest/v1/audit_log?select=id&entity_type=eq.verification_requests_legacy_write&created_at=gt.${URL_ENC_TS}"

# Capture body + status; we only need headers for count, so HEAD it.
HTTP_RESPONSE=$(curl --silent --show-error --include --head \
  --max-time 30 \
  -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Prefer: count=exact" \
  "$ENDPOINT" || true)

if [[ -z "$HTTP_RESPONSE" ]]; then
  echo "FAIL: Supabase REST call returned no response." >&2
  exit 3
fi

HTTP_STATUS=$(printf '%s' "$HTTP_RESPONSE" | head -1 | awk '{print $2}')
if [[ "$HTTP_STATUS" != 2* ]]; then
  echo "FAIL: Supabase REST call returned HTTP ${HTTP_STATUS:-unknown}." >&2
  printf '%s\n' "$HTTP_RESPONSE" >&2
  exit 3
fi

# Content-Range header looks like: 'content-range: 0-9/42' (range/total)
# or 'content-range: */0' on empty result.
CONTENT_RANGE=$(printf '%s' "$HTTP_RESPONSE" | grep -i '^content-range:' | head -1 | sed -E 's/.*\/([0-9]+).*/\1/' | tr -d '\r\n')

if [[ -z "$CONTENT_RANGE" || ! "$CONTENT_RANGE" =~ ^[0-9]+$ ]]; then
  echo "FAIL: could not parse Content-Range from Supabase response." >&2
  printf '%s\n' "$HTTP_RESPONSE" >&2
  exit 3
fi

if (( CONTENT_RANGE > 0 )); then
  echo "FAIL: ${CONTENT_RANGE} legacy verification_requests writes detected since ${FLIP_TS}." >&2
  echo "      PR-D MUST NOT ship — investigate via correlation_id grep + Sentry." >&2
  exit 4
fi

echo "OK: stability-log.md present and flag_flipped_at recorded ($FLIP_TS)."
echo "OK: 0 legacy verification_requests writes since flip — H-8 gate clean."
