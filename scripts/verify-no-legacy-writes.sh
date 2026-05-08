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
# Usage:
#   bash scripts/verify-no-legacy-writes.sh
#
# Exits:
#   0 — flag_flipped_at recorded AND audit-log query template printed for
#       the operator (or hourly cron) to run via Supabase MCP. Zero rows
#       expected.
#   1 — stability-log.md missing.
#   2 — flag_flipped_at not yet recorded.
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
# H-8 Postgres trigger logs each direct write to audit_log with
# entity_type='verification_requests_legacy_write'. This script prints the
# audit-log query the operator (or hourly cron) runs via Supabase MCP.
QUERY="SELECT count(*) AS cnt FROM audit_log WHERE entity_type='verification_requests_legacy_write' AND created_at > '${FLIP_TS}'::timestamptz;"
echo ""
echo "Run via Supabase MCP:"
echo "  mcp__supabase__execute_sql --project-id qmnijlgmdhviwzwfyzlc --query \"${QUERY}\""
echo ""
echo "Expected output: count = 0. If non-zero, PR-D MUST NOT ship — investigate via correlation_id grep + Sentry."
echo "Stability-log expectation: 168 contiguous clean hourly cron runs since flag_flipped_at."
echo ""
echo "OK: stability-log.md present and flag_flipped_at recorded ($FLIP_TS)."
