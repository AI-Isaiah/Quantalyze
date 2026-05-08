#!/usr/bin/env bash
# Phase 19 / BACKBONE-04 / Pitfall 10 — VIEW-shim 4-PR commit-message guard.
# Rejects when fewer than 4 sequential commits with prefixes
# 'phase-19-shim-step-{a,b,c,d}:' exist on the current branch.
# (CONTEXT.md mandates 4 sequential PRs, NOT 4 squashed commits.)
set -euo pipefail

# Look for the 4 prefixes anywhere in branch history.
expected=(a b c d)
for step in "${expected[@]}"; do
  if ! git log --format='%s' --no-merges | grep -qE "^phase-19-shim-step-$step:"; then
    echo "FAIL: missing commit with prefix 'phase-19-shim-step-$step:'." >&2
    echo "      Each VIEW-shim step (a/b/c/d) must ship as its own PR per BACKBONE-04." >&2
    exit 1
  fi
done

# Order check: a must precede b must precede c must precede d in branch history.
order=$(git log --format='%s' --no-merges --reverse | grep -E '^phase-19-shim-step-[abcd]:' | sed 's/^phase-19-shim-step-\([abcd]\):.*$/\1/')
expected_order="a
b
c
d"
if [[ "$order" != "$expected_order" ]]; then
  echo "FAIL: shim commits out of order. Expected a→b→c→d; got:" >&2
  echo "$order" >&2
  exit 2
fi

# H-7: ≥168h delta between commit (b) and commit (d) timestamps.
commit_b=$(git log --format='%H %ct %s' --no-merges | awk '/^[a-f0-9]+ [0-9]+ phase-19-shim-step-b:/ {print $1, $2; exit}')
commit_d=$(git log --format='%H %ct %s' --no-merges | awk '/^[a-f0-9]+ [0-9]+ phase-19-shim-step-d:/ {print $1, $2; exit}')

if [[ -n "$commit_b" && -n "$commit_d" ]]; then
  ts_b=$(echo "$commit_b" | awk '{print $2}')
  ts_d=$(echo "$commit_d" | awk '{print $2}')
  delta=$(( ts_d - ts_b ))
  required=604800  # 168h × 3600
  if (( delta < required )); then
    echo "FAIL: H-7 — only ${delta}s between commit (b) and commit (d); need ≥${required}s (168h)." >&2
    echo "      The 7-day stability window must elapse between flag-flip and VIEW rename." >&2
    exit 3
  fi
fi

echo "OK: 4-PR VIEW-shim sequence preserved + 168h delta between commits (b) and (d) (H-7)."
