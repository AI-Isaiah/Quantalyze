# Phase 19 — Deferred Items

## P5 / P1 cross-plan finding — `scripts/check-phase-19-shim-commits.sh` SIGPIPE bug

**Origin:** Phase 19 P1 (Wave 1) — `scripts/check-phase-19-shim-commits.sh`.

**Found during:** P5 PR-A landing — script reports "missing commit with
prefix 'phase-19-shim-step-a:'" even when the commit exists.

**Root cause:** `set -euo pipefail` interacts with `git log | grep -q` —
when `grep -q` finds the first match it exits 0 and closes stdin,
causing `git log` to die with SIGPIPE (status 141). `pipefail`
propagates 141 as the pipeline status; the `!` in `if !` flips it to
"matched"; the script then logs the failure path.

**Fix outline:** read the git log into a variable first, then grep
without piping (or use `awk` directly inside `git log --grep`).

**Why deferred:** the script is a P1 ship from a different plan; CI
does not currently invoke it (verified `grep -rn` against
`.github/workflows/`). The H-7 168h check inside the same script
shares the same pipefail risk but is also not gating on this plan's
PR-A. Plan-checker P1's exit-gate stage will run the script via `bash`
once all 4 PRs land — fixing the SIGPIPE bug before then is required
but belongs in a P1 follow-up, not P5.

**Scope:** out of scope for this plan per executor scope rule "only
auto-fix issues DIRECTLY caused by the current task's changes."
