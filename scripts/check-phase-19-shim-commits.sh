#!/usr/bin/env bash
# Phase 19 / BACKBONE-04 / Pitfall 10 — VIEW-shim 4-PR commit-message guard.
# Rejects when fewer than 4 sequential commits with prefixes
# 'phase-19-shim-step-{a,b,c,d}:' exist on the current branch.
# (CONTEXT.md mandates 4 sequential PRs, NOT 4 squashed commits.)
#
# IN-01 fix (REVIEW.md 2026-05-08, deferred-items.md): the previous
# `git log | grep -q` pattern interacted with `set -euo pipefail` —
# `grep -q` exits 0 on first match and closes stdin, causing `git log`
# to die with SIGPIPE (status 141) which `pipefail` then propagated as
# the pipeline status. The `if !` flipped 141 → "matched" so the
# missing-commit branch logged a false failure even when the commit
# existed. Read the git log into a variable first, then grep without
# piping. This also fixes WR-04 which depends on the prefix-existence
# check actually being correct before the H-7 delta check runs.
set -euo pipefail

# Read the full subject log once into a variable — eliminates the
# pipe-to-grep SIGPIPE risk that produced false-negative matches under
# `set -euo pipefail`.
LOG_SUBJECTS=$(git log --format='%s' --no-merges)

# Look for the 4 prefixes anywhere in branch history.
expected=(a b c d)
for step in "${expected[@]}"; do
  if ! grep -qE "^phase-19-shim-step-$step:" <<<"$LOG_SUBJECTS"; then
    echo "FAIL: missing commit with prefix 'phase-19-shim-step-$step:'." >&2
    echo "      Each VIEW-shim step (a/b/c/d) must ship as its own PR per BACKBONE-04." >&2
    exit 1
  fi
done

# Order check: a must precede b must precede c must precede d in branch history.
LOG_SUBJECTS_REVERSE=$(git log --format='%s' --no-merges --reverse)
order=$(grep -E '^phase-19-shim-step-[abcd]:' <<<"$LOG_SUBJECTS_REVERSE" | sed 's/^phase-19-shim-step-\([abcd]\):.*$/\1/')
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
#
# WR-04 fix: when commit (b) or (d) cannot be located the previous
# implementation silently skipped the delta check (printed OK and exited
# 0). That is dangerous — the H-7 168h gate is the load-bearing
# stability invariant before PR-D ships. Now: if the prefix-existence
# loop above found both commits (a..d), they MUST resolve here too;
# any awk-empty result is a script bug or a malformed commit subject
# and we exit non-zero so the gate cannot pass silently.
LOG_FULL=$(git log --format='%H %ct %s' --no-merges)
commit_b=$(awk '/^[a-f0-9]+ [0-9]+ phase-19-shim-step-b:/ {print $1, $2; exit}' <<<"$LOG_FULL")
commit_d=$(awk '/^[a-f0-9]+ [0-9]+ phase-19-shim-step-d:/ {print $1, $2; exit}' <<<"$LOG_FULL")

if [[ -z "$commit_b" || -z "$commit_d" ]]; then
  echo "FAIL: H-7 168h delta check could not locate commit (b) or (d) timestamps." >&2
  echo "      commit_b=${commit_b:-<empty>}" >&2
  echo "      commit_d=${commit_d:-<empty>}" >&2
  echo "      The prefix-existence loop above found these commits; the awk lookup" >&2
  echo "      should not have failed. Investigate (malformed subject or script bug)." >&2
  exit 4
fi

ts_b=$(awk '{print $2}' <<<"$commit_b")
ts_d=$(awk '{print $2}' <<<"$commit_d")
delta=$(( ts_d - ts_b ))
required=604800  # 168h × 3600
if (( delta < required )); then
  echo "FAIL: H-7 — only ${delta}s between commit (b) and commit (d); need ≥${required}s (168h)." >&2
  echo "      The 7-day stability window must elapse between flag-flip and VIEW rename." >&2
  exit 3
fi

echo "OK: 4-PR VIEW-shim sequence preserved + 168h delta between commits (b) and (d) (H-7)."
