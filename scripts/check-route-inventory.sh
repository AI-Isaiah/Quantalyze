#!/usr/bin/env bash
# Phase 19 / BACKBONE-10 / Theme 6 — route-inventory completeness CI guard.
# Rejects when a Next.js non-GET route handler exists that touches one of the 6
# sentinel tables but is NOT listed in .planning/phase-19/route-inventory.md.
# Also enforces method-label parity (C-6): inventory's Method column for each row
# must agree with the actual `export (const|async function) METHOD` exports in
# the corresponding route file.
set -euo pipefail

INVENTORY=".planning/phase-19/route-inventory.md"
SENTINEL_TABLES='(api_keys|strategies|strategy_analytics|verification_requests|strategy_verifications|compute_jobs)'

if [[ ! -f "$INVENTORY" ]]; then
  echo "FAIL: $INVENTORY missing — Phase 19 entry gate not satisfied." >&2
  exit 1
fi

# Find every non-GET route handler touching the 6 sentinel tables.
routes=$(grep -RElZ 'export (async function|const) (POST|PUT|PATCH|DELETE)' src/app/api 2>/dev/null \
  | xargs -0 grep -lE "$SENTINEL_TABLES" 2>/dev/null \
  | sort -u || true)

missing=()
for route in $routes; do
  rel="${route#./}"
  if ! grep -Fq "$rel" "$INVENTORY"; then
    missing+=("$rel")
  fi
done

if [[ ${#missing[@]} -gt 0 ]]; then
  echo "FAIL: routes touching sentinel tables not in $INVENTORY:" >&2
  printf '  - %s\n' "${missing[@]}" >&2
  exit 2
fi

# Every non-GET row in the inventory must carry flow_type= or out-of-scope rationale.
violations=$(grep -E '\| (POST|PUT|PATCH|DELETE) \|' "$INVENTORY" \
  | grep -vE '(flow_type=(teaser|onboard|internal_report|csv|resync))|out of scope, rationale: .{10,}' || true)

if [[ -n "$violations" ]]; then
  echo "FAIL: inventory rows missing flow_type or out-of-scope rationale:" >&2
  echo "$violations" >&2
  exit 3
fi

# C-6 method-label parity check: parse inventory rows and verify the Method
# column matches the actual route file's exported handler names.
parity_violations=()
while IFS= read -r line; do
  # Match table rows like:  | `path/to/route.ts` | METHOD | ... |
  if [[ "$line" =~ ^\|[[:space:]]*\`([^[:space:]\`]+)\`[[:space:]]*\|[[:space:]]*([A-Z/]+)[[:space:]]*\| ]]; then
    rel="${BASH_REMATCH[1]}"
    label="${BASH_REMATCH[2]}"
    # If the file does not exist locally, skip silently (e.g., docs-only rows).
    [[ -f "$rel" ]] || continue
    # Each method label may be a slash-separated list (e.g., POST/PUT or PATCH/DELETE).
    IFS='/' read -ra methods <<< "$label"
    for method in "${methods[@]}"; do
      # Skip GET — the inventory may legitimately list a GET-only sibling for documentation.
      # Still verify exports include the listed method.
      if ! grep -qE "^export (async function|const) ${method}\b" "$rel"; then
        parity_violations+=("$rel: inventory says $method but route file does NOT export $method")
      fi
    done
  fi
done < "$INVENTORY"

if [[ ${#parity_violations[@]} -gt 0 ]]; then
  echo "FAIL: C-6 method-label parity check failed:" >&2
  printf '  - %s\n' "${parity_violations[@]}" >&2
  exit 4
fi

echo "OK: route inventory complete + every non-GET row mapped + method-label parity verified (C-6)."
