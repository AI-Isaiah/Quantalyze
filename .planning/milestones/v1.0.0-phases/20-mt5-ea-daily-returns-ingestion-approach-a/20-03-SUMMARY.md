---
phase: 20-mt5-ea-daily-returns-ingestion-approach-a
plan: 03
subsystem: infra
tags: [ci, github-actions, security, mql5, mt5, static-analysis, grep]

# Dependency graph
requires:
  - phase: 20-mt5-ea-daily-returns-ingestion-approach-a (Plan 02)
    provides: tools/mt5/QuantalyzeDailyReturns.mq5 — the real read-only EA the CI step scans (and which proves the denylist does not false-positive)
provides:
  - "CI step 'MT5 EA read-only static check' in the frontend-policy job"
  - "A CI-enforced read-only invariant over tools/mt5/**/*.{mq5,mqh}: any trade-mutation token fails the build"
affects: [phase-20 future EA edits, any future MT5 tool work]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pure-grep security policy gate mirroring scripts/check-banned-packages.mjs (no new dependency)"
    - "set -e safe grep-as-gate: `|| true` on the capture + verdict from output emptiness, not grep's exit code"

key-files:
  created: []
  modified:
    - .github/workflows/ci.yml

key-decisions:
  - "Hosted the step in the existing frontend-policy job (alongside banned-packages) rather than a new job — surgical, no extra runner, same security-gate semantics"
  - "Derived the pass/fail verdict from the emptiness of captured grep output rather than grep's exit code, because grep exit 1 (no-match) would abort the step under the runner's set -e"
  - "Accepted comment-only / in-comment-evasion false positives as a documented residual limit (safe-side direction); the manual T14 demo-reconcile is the runtime backstop"

patterns-established:
  - "MT5 EA read-only denylist: low-level/decl surface + CTrade method-call surface, scanned recursively across .mq5 and .mqh"

requirements-completed: [T16]

# Metrics
duration: 12min
completed: 2026-06-14
---

# Phase 20 Plan 03: MT5 EA read-only CI static-check Summary

**A pure-grep CI gate (M4-hardened) that recursively scans `tools/mt5/**/*.{mq5,mqh}` and fails the build on any trade-mutation token — the low-level/declaration surface AND the CTrade method-call surface — making the recording EA's read-only guarantee a CI-enforced invariant.**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-06-14T17:51:00Z
- **Completed:** 2026-06-14T18:03:24Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments
- Added the "MT5 EA read-only static check" step to the `frontend-policy` job in `.github/workflows/ci.yml`, mirroring the banned-packages pure-grep pattern (zero new dependencies).
- The check recursively greps BOTH `*.mq5` AND included `*.mqh` headers (the M4 gap — included trade wrappers are no longer skipped) and fails on the low-level/decl surface (`OrderSend|OrderSendAsync|OrderModify|OrderDelete|CTrade|PositionClose|PositionModify|trade.`) AND the CTrade method-call surface (`.Buy(`/`.Sell(`/`.PositionOpen(`/`.PositionClose(`/… for an instance named anything).
- Proven in BOTH directions locally: PASS on the real read-only EA (no false positive), FAIL on a synthetic `OrderSendAsync(` `.mq5` AND a synthetic `exec.Buy(` `.mqh` (CTrade-method + .mqh-recursion gap).
- Validated the YAML is still well-formed (`yaml.safe_load`).

## Task Commits

Each task was committed atomically:

1. **Task 1: Add the hardened MT5 EA read-only static-check step to CI** - `7e62234d` (ci)

**Plan metadata:** (this SUMMARY + STATE/ROADMAP/REQUIREMENTS) committed in the final docs commit.

## Denylist regex used (exact)

Two `-e` alternations passed to `grep -rnE --include='*.mq5' --include='*.mqh' ... tools/mt5`:

```
DENY_LOWLEVEL='OrderSend|OrderSendAsync|OrderModify|OrderDelete|CTrade|PositionClose|PositionModify|trade\.'
DENY_METHODS='\.(Buy|Sell|BuyStop|SellStop|BuyLimit|SellLimit|PositionOpen|PositionClose|PositionClosePartial|PositionReverse|OrderOpen)[[:space:]]*\('
```

## Proof — both directions

**PASS (real EA, no match → exit 0):**
```
grep -rnE --include='*.mq5' --include='*.mqh' -e "$DENY_LOWLEVEL" -e "$DENY_METHODS" tools/mt5
>>> no match (real EA is clean) — step exit 0
```
The real `QuantalyzeDailyReturns.mq5` deliberately mentions NONE of the denied tokens verbatim (even its read-only comments spell out "synchronous and async order-send entry points" in prose), so there is no false positive on its legitimate read APIs (`AccountInfoDouble`, `HistorySelect`/`HistoryDeal*`, `FileWrite`/`FileMove`, `GlobalVariable*`, `EventSetTimer`/`OnTimer`, `Time*`).

**FAIL (a) — synthetic `tools/mt5/evil.mq5` containing `OrderSendAsync(`:**
```
tools/mt5/evil.mq5:1:void f(){ OrderSendAsync(r,res); }
::error::MT5 EA must be read-only (no order/trade mutation API)...  → step exit 1
```

**FAIL (b) — synthetic `tools/mt5/lib/wrapper.mqh` containing `exec.Buy(0.1);`:**
```
tools/mt5/lib/wrapper.mqh:2:void g(){ exec.Buy(0.1); }
::error::MT5 EA must be read-only (no order/trade mutation API)...  → step exit 1
```
This proves the M4 gap is closed: an included `.mqh` (in a subdir, found via `grep -r`) with a CTrade instance named anything (`exec`) calling `.Buy(` fails the build.

Both temp files were deleted immediately after the proof and were NOT committed (`tools/mt5` final tree = `README.md`, `QuantalyzeDailyReturns.mq5`).

**No-files edge case:** with no `.mq5`/`.mqh` present (or `tools/mt5` absent), the step passes (exit 0) — verified — because grep's no-match exit 1 is neutralized with `|| true` and the verdict comes from whether any line was captured.

**YAML well-formed:** `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml'))"` → `YAML OK`.

**Plan automated verify:** `T16_OK` printed (step named correctly, includes `OrderSendAsync`, `.(Buy|Sell`, `.mqh`; real EA produces no denylist match).

## Files Created/Modified
- `.github/workflows/ci.yml` - Added the "MT5 EA read-only static check" step (47 insertions) to the `frontend-policy` job, after the banned-packages step.

## Decisions Made
- Placed the step in the existing `frontend-policy` job (the home of the banned-packages security gate) rather than spinning up a new job — surgical, no extra runner, same semantics.
- Verdict is derived from captured-output emptiness, not grep's exit code, because grep exit 1 (no-match) would abort the step at the assignment under the runner's `set -e`. The `|| true` + emptiness check is the robust pattern (verified against `bash -eo pipefail`).
- Accepted the comment-only / in-comment-evasion false-positive as a documented residual limit (fail-safe direction); the manual T14 reconcile is the runtime backstop, per the threat register's T-20-08 `accept` disposition.

## Deviations from Plan

None - plan executed exactly as written. The plan's `<action>` left the exact grep mechanics to the executor ("invert the grep result explicitly rather than letting grep's own exit code fail the step"); the chosen `|| true` + output-emptiness verdict is the faithful, `set -e`-safe realization of that instruction, not a deviation.

## Issues Encountered
- Initial naive `MATCHES=$(grep ...); RC=$?` pattern aborted under `set -e` on a no-match (grep exit 1) before `RC` could be captured — confirmed by reproducing `bash -eo pipefail` (the GitHub Actions default). Resolved by appending `|| true` to the command substitution and deriving the verdict from `[ -n "$MATCHES" ]`. Re-tested all three cases (pass / no-files / fail) green.

## Threat Flags

None — this plan adds a pure grep CI step and introduces no new network endpoint, auth path, file access, or schema surface. It directly mitigates the threat register's T-20-07 (Tampering/Elevation: a future edit adds a trade-mutation API) and documents T-20-08 (obfuscation residual) as accepted.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- The EA read-only invariant is now CI-enforced for any future edit to `tools/mt5`.
- No blockers introduced.

## Self-Check: PASSED

- FOUND: `.planning/phases/20-mt5-ea-daily-returns-ingestion-approach-a/20-03-SUMMARY.md`
- FOUND: commit `7e62234d`

---
*Phase: 20-mt5-ea-daily-returns-ingestion-approach-a*
*Completed: 2026-06-14*
