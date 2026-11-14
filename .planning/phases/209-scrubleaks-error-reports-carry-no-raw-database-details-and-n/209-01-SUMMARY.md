---
phase: 209-scrubleaks-error-reports-carry-no-raw-database-details-and-n
plan: 01
subsystem: observability
tags: [sentry, redaction, postgrest, seam-redaction, capture-boundary]

requires: []
provides:
  - "scrubSeamErrorForCapture: capture-mode renderer for the Sentry path (name, code, message, errno, syscall only)"
  - "captureToSentry never forwards PostgREST details or hint, at the top level or anywhere in the cause chain"
  - "non-Error objects with no allowlisted field render as the fixed placeholder"
affects: [209-02, 209-03, 209-04, 209-05]

status: complete
commits: 2
plan_head_before: c81f68f79306b6892bfc29a6fc095ecbda93d792
plan_head_after: 8d51b83543135013e857d4cb89b6de25dfe4a35e

actuals:
  tokens: 3986
  tasks: 2
  commits: 2

tech-stack:
  added: []
  patterns:
    - "capture flag threaded through describeThrown recursion; log mode is the default and byte-identical"

key-files:
  created: []
  modified:
    - src/lib/seam-redaction.ts
    - src/lib/sentry-capture.ts
    - src/lib/sentry-capture.test.ts
    - src/lib/seam-redaction.test.ts

key-decisions:
  - "D-03 held: PLAIN_OBJECT_DIAGNOSTIC_KEYS and scrubSeamError are untouched; the seam log path still renders details and hint"
  - "D-05 / RESEARCH A2: the placeholder applies to every non-Error object with no allowlisted field, including arrays and objects with their own toString (URL, Date, class instance)"

patterns-established:
  - "Sentry-path renderer is a separate export, not a narrowing of the shared log renderer"

requirements-completed: [SC1, SC5]
---

# Phase 209 Plan 01: Capture-mode renderer for the Sentry path Summary

`captureToSentry` now renders every non-Error object, at the top level and anywhere in an Error's cause chain, through a new `scrubSeamErrorForCapture` that reads only `name`, `code`, `message`, `errno` and `syscall`, so a PostgREST error's `details` and `hint` (failing-row values) no longer reach Sentry; an object with none of those fields becomes a fixed placeholder.

## What was built

- `src/lib/seam-redaction.ts`: module-private `CAPTURE_OBJECT_DIAGNOSTIC_KEYS` (five keys, no `details`/`hint`) and `CAPTURE_OPAQUE_OBJECT`; `describeThrown` gained a 4th parameter `capture = false`, threaded into its recursive cause call; new total export `scrubSeamErrorForCapture`. Zero imports added; purity guards stay green.
- `src/lib/sentry-capture.ts`: the final non-Error return and the cause fold both call `scrubSeamErrorForCapture`; the log-mode import is gone (one import, from `./seam-redaction`); the module docblock records the Phase 209 behaviour.
- Tests: `[209 SC1] captureToSentry never forwards PostgREST details or hint` (9 cases, Phase 204 sentinels, positive controls on every case, `dispatchedText` oracle never JSON-serialises an Error) and `[209 SC1] scrubSeamErrorForCapture is the Sentry-path renderer` (4 cases: capture-vs-log contrast on the same objects, recursion-flag pin, totality). The export-set census moved 6 to 7 names on purpose.

## Task commits

| Task | Name | Commit |
|------|------|--------|
| 1 | Tracer: top-level non-Error branch in capture mode | `2c4f935e3` |
| 2 | Cause chain and opaque objects | `8d51b8354` |

Each task was written test-first and seen RED before the implementation (Task 1: 4 failing; Task 2: 7 failing), then GREEN.

## Neuter-to-RED proofs (SC5)

Every proof: byte backup to the scratchpad, neuter, run `npx vitest run src/lib/sentry-capture.test.ts src/lib/seam-redaction.test.ts`, restore with `cp`, `cmp` clean, rerun GREEN (58/58 at the end).

| # | Neuter | Failing cases (RED) | Held green |
|---|--------|---------------------|-----------|
| N1 | `sentry-capture.ts`: final non-Error return back to `scrubSeamError` | `[209 SC1]` "drops details and hint from a plain-object PostgREST error and keeps code and message"; "drops details even when the object carries no code (the gate is non-Error object, not code)"; "never reads the details field: a throwing getter on it still captures" (3 failed, 45 passed, at Task 1 state) | seam-redaction.test.ts |
| N2 | `sentry-capture.ts`: cause fold back to `scrubSeamError` | "scrubs a plain-object cause folded into an Error, rendered as code and message only"; "scrubs a plain-object cause two Errors deep"; "renders an opaque-object cause as the fixed placeholder inside the folded message" (3 failed) | all top-level cases |
| N3 | `seam-redaction.ts`: add `"details"`, `"hint"` to `CAPTURE_OBJECT_DIAGNOSTIC_KEYS` | direct renderer contrast; Error -> Error -> plain chain (seam-redaction.test.ts); gate, no-code, throwing-getter, folded cause, nested cause (sentry-capture.test.ts) (7 failed) | opaque-object cases |
| N4 | `seam-redaction.ts`: delete `if (capture) return CAPTURE_OPAQUE_OBJECT;` | direct opaque contrast (seam-redaction.test.ts); object, array, URL placeholder cases; opaque-cause case (5 failed) | all details/hint cases |
| N5 | `seam-redaction.ts`: drop `capture` from the recursive cause call | "keeps capture mode through an Error -> Error -> plain-object chain" (seam-redaction.test.ts); "scrubs a plain-object cause two Errors deep" (sentry-capture.test.ts) (2 failed) | single-level cause case |

## Verification

- `npx vitest run src/lib/sentry-capture.test.ts src/lib/seam-redaction.test.ts`: 58 passed.
- Regression route suites that run the real `captureToSentry` (second Task 2 verify command): 28 files, 930 tests passed (baseline 28 files, 930 tests).
- Plan quick-run set (VALIDATION.md): 21 files, 924 tests passed.
- `npm run typecheck` exit 0; `npm run lint` exit 0 (includes planning hygiene).
- `node scripts/verify-plan-anchors.mjs <plan>` exit 0 before any edit.
- All Task 1 and Task 2 acceptance greps returned the expected counts (CAPTURE key list has 0 `details`/`hint` entries; PLAIN list still has 2; `scrubSeamError(` count in `sentry-capture.ts` is 0; one import).

## Deviations from Plan

None - plan executed exactly as written. No existing test relied on the serialised fallback on the capture path, so no existing case changed.

## Known Stubs

None.

## Threat Flags

None. No new endpoint, auth path, file access or schema surface; T-209-01, T-209-02 and T-209-03 are mitigated and each has a RED-proven test (N1, N2/N5, N4).

## Self-Check: PASSED

- FOUND: src/lib/seam-redaction.ts, src/lib/sentry-capture.ts, src/lib/sentry-capture.test.ts, src/lib/seam-redaction.test.ts
- FOUND commits: 2c4f935e3, 8d51b8354
