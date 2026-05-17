#!/usr/bin/env bash
# Self-test driver for the migration-policy algorithm
# (retro-PR193 M-4: exercise reject + malformed branches in CI).
#
# This script extracts the SOURCE-OF-TRUTH algorithm fragment from
# `.github/workflows/migration-policy.yml` (the "Enforce backdated-
# migration policy" step's run block) and drives it against synthetic
# inputs WITHOUT calling `supabase link` / `supabase db query`.
#
# Inputs (env vars):
#   REMOTE_TIP        — 14-digit timestamp simulating the remote tip
#                       (skips the supabase CLI query that the real
#                       workflow does)
#   ADDED_FILES       — newline-separated list of NEWLY ADDED migration
#                       file paths (simulating the `git diff` result)
#   ALLOWLIST_FILE    — path to a file with the same format as
#                       `.github/migrate-backdated-allowlist.txt`
#
# Exit code:
#   0 — all migrations are forward-only or allowlisted (PASS)
#   1 — at least one violation (reject path or malformed path)
#
# The block below MUST stay byte-equivalent (modulo the supabase link/
# query lines which are skipped here) to the algorithm in
# .github/workflows/migration-policy.yml. The
# `critical-regressions.test.ts` source-text guard pins that contract.

set -euo pipefail

if [ -z "${REMOTE_TIP:-}" ]; then
  echo "::error::REMOTE_TIP env var is required (14-digit timestamp)"
  exit 1
fi
if [ -z "${ADDED_FILES:-}" ]; then
  echo "No newly-added migration files in this PR. Migration policy OK."
  exit 0
fi
if [ -z "${ALLOWLIST_FILE:-}" ]; then
  echo "::error::ALLOWLIST_FILE env var is required (path)"
  exit 1
fi

echo "Newly-added migration files in this PR:"
echo "$ADDED_FILES" | sed 's/^/  - /'
echo "Remote tip (synthetic): $REMOTE_TIP"

ALLOWLIST=$(grep -Ev '^\s*(#|$)' "$ALLOWLIST_FILE" 2>/dev/null || true)

VIOLATIONS=""
MALFORMED=""
while IFS= read -r f; do
  [ -z "$f" ] && continue
  base=$(basename "$f")
  ts="${base%%_*}"
  if [[ ${#ts} -ne 14 ]] || ! [[ "$ts" =~ ^[0-9]{14}$ ]]; then
    MALFORMED="${MALFORMED}"$'\n'"  - $base (basename prefix is not a 14-digit timestamp)"
    continue
  fi
  if [[ "$ts" < "$REMOTE_TIP" ]]; then
    if ! echo "$ALLOWLIST" | grep -qFx "$ts"; then
      VIOLATIONS="${VIOLATIONS}"$'\n'"  - $base (timestamp $ts < remote tip $REMOTE_TIP)"
    else
      echo "Allowlisted backdated addition: $base"
    fi
  fi
done <<< "$ADDED_FILES"

FAIL=0

if [[ -n "$MALFORMED" ]]; then
  echo "::error::Newly-added migration files with malformed names:${MALFORMED}"
  echo "::error::Migration file basenames must start with a 14-digit timestamp (YYYYMMDDHHMMSS)."
  FAIL=1
fi

if [[ -n "$VIOLATIONS" ]]; then
  echo "::error::Backdated migration additions detected without allowlist entry:${VIOLATIONS}"
  echo "::error::A backdated migration is a newly-added file whose timestamp is older than the most-recently-applied remote migration. These are blocked because they enable silent-history-rewrite attacks: --include-all would gap-fill the older timestamp slot at apply time."
  echo "::error::If this is a legitimate history-only restoration (e.g. SQL already executed against the remote via a different path; body is idempotent), add the 14-digit timestamp to ${ALLOWLIST_FILE} with a comment citing the PR + reason."
  FAIL=1
fi

if [[ $FAIL -ne 0 ]]; then
  exit 1
fi

echo "Migration policy OK — all newly-added migrations are forward-only or allowlisted."
