---
phase: 209-scrubleaks-error-reports-carry-no-raw-database-details-and-n
plan: 02
subsystem: observability
tags: [sentry, beforeSend, share-token, redaction, frozen-objects]

requires: []
provides:
  - "scrubSentryEvent never throws: every read guarded, every write verified by read-back, string written only when scrubSharePath changed it"
  - "a token that cannot be removed in place is withheld by replacing its holder with an empty value of the same shape at the nearest writable parent"
  - "unwritable event root yields a minimal replacement event (fixed marker message, allow-listed scalars, type kept for transactions), never null and never the unscrubbed original"
affects: [209-03, 209-04, 209-05]

status: complete
commits: 3
plan_head_before: 32cbeae516de4b7965b438b71cf8a14e1dee6def
plan_head_after: f9ea6b708cb44ea37c2d4b21e4e12b4039689bf5

actuals:
  tokens: 6700
  tasks: 2
  commits: 3

tech-stack:
  added: []
  patterns:
    - "total helpers (guardedRead, scrubSlot, withholdSlot, cleanOrWithhold, cleanList) with escalation to the nearest writable parent"

key-files:
  created: []
  modified:
    - src/instrumentation.ts
    - src/instrumentation.test.ts

key-decisions:
  - "D-06: scrubSlot writes only when scrubSharePath changed the string, so a frozen token-free object is left untouched and the event returns as the same object"
  - "D-07: every completed write is read back; a swallowing setter counts as dirty"
  - "D-08: both hooks get a replacement event, never null; Open Question 3's fallback (null for transactions only) was NOT taken"
  - "D-09: request.url, transaction, crumb message, span and trace description all go through scrubSlot; breadcrumbs and spans through cleanList (Array.isArray first)"

patterns-established:
  - "withholding is shape-preserving ({} or []) at the nearest writable parent, escalating to a root replacement event"

requirements-completed: [SC2, SC5]
---

# Phase 209 Plan 02: Guarded scrubSentryEvent Summary

`scrubSentryEvent` in `src/instrumentation.ts` was rewritten so no event shape makes the registered `beforeSend` / `beforeSendTransaction` throw (the SDK drops the event when they do), a share token is never delivered, and the report is never lost: unwritable token-holding values are withheld at the nearest writable parent, and an unwritable root yields a minimal marker event instead of `null`.

## What was built

- `src/instrumentation.ts`: module-private total helpers `guardedRead`, `scrubSlot`, `withholdSlot`, `cleanOrWithhold`, `cleanList`, `buildWithheldEvent`; `scrubRecordStrings` rewritten (name kept) to return a boolean "clean" and never throw; `SENTRY_WITHHELD_EVENT_MESSAGE` constant; `scrubSentryEvent<T>` body rewritten over the seven channels (request.url, transaction, breadcrumbs, spans, contexts.trace, extra, tags) with every step run even after one fails. Signature and `register()` wiring unchanged. The `ScrubbableEvent` type was deleted (nothing references it); its WHY STRUCTURAL paragraph moved, corrected, onto `scrubSentryEvent`, and the overstated contract sentence ("never to a throw inside beforeSend") now states what is delivered. The measured-leak comments (`http.target`, the production `tags` finding) moved beside the new calls.
- `src/instrumentation.test.ts`: nested `describe("[209 SC2] the scrub never throws and never loses the report")` inside `[164 SHARE-01]`, 16 cases, all through the REGISTERED hooks, each with the anti-vacuity floor (fixture contains `TOKEN`) before the absence assertion. Cases: frozen holder in `contexts.trace.data` / `extra` / `tags`; getter-only; throwing getter; swallowing setter; non-array `breadcrumbs`/`spans` (4); frozen crumb beside writable crumb; frozen request; deep-frozen root for `beforeSend`; deep-frozen transaction root for `beforeSendTransaction` (type kept); frozen token-free object and frozen token-free whole event (both same object, byte-identical JSON). The root marker is hand-typed in the tests, never imported.

## Task commits

| Task | Name | Commit |
|------|------|--------|
| 1 (RED) | failing SC2 gate for frozen token-holding sub-objects | `0fe2caf04` |
| 1 (GREEN) | guarded scrubSentryEvent, withholding and replacement event | `87f7506b6` |
| 2 | every channel and the unwritable root pinned | `f9ea6b708` |

## TDD evidence

- Task 1 RED (`0fe2caf04`): `npx vitest run src/instrumentation.test.ts` gave 6 failed, 19 passed. All six failures are on the planned assertion (`expected [Function] to not throw an error`, with the TypeError text for the frozen and getter-only cases and `hostile getter` for the throwing getter). Semantic assessment: the target tests executed and failed on the behaviour under change (the scrub throws), not on a syntax, import or fixture fault; the 19 existing cases stayed green. `workflow.tdd_mode` is false in this repo, so the `tdd-red-evidence` classifier was not run.
- Task 1 GREEN (`87f7506b6`): 25 passed.
- Task 2: its cases passed on first write because Task 1's implementation already covers every channel by design (the plan's Task 2 is breadth pinning, not new behaviour). The RED evidence for Task 2 is therefore the neuter-to-RED proofs N4 to N7 below, not a separate failing-test commit.

## Neuter-to-RED proofs (SC5)

Every proof: byte backup of `src/instrumentation.ts` to the scratchpad, neuter, run `npx vitest run src/instrumentation.test.ts`, restore with `cp`, `cmp` byte-identical, rerun GREEN (25/25 after Task 1, 35/35 after Task 2).

| # | Neuter | Failing cases (RED) | Held green |
|---|--------|---------------------|-----------|
| N1 | `scrubSlot`: delete the unchanged-string early return (`if (next === read.value) return true;`) | "a frozen object with NO token is left untouched and the event passes through as the same object (D-06)" (1 failed, 24 passed) | all token cases |
| N2 | `scrubSlot`: the write's `catch` returns `true` instead of `false` | frozen holder in `contexts.trace.data`, in `extra`, in `tags`; "a getter-only property carrying the token is withheld, not thrown on" (4 failed, 21 passed) | no-token, throwing-getter |
| N3 | `guardedRead`: remove its try/catch | "a throwing enumerable getter cannot throw out of the scrub or lose the rest of the event" (1 failed, 24 passed). See Deviations 1: the failure is `expected undefined to be 'GET /factsheet-share/[token]'`, not a throw | other 24 |
| N4 | `scrubSlot`: replace the read-back comparison with `return true` | "a setter that swallows the write cannot pass for a scrubbed slot (read-back, D-07)" (1 failed, 34 passed) | all others |
| N5 | `cleanList`: drop the `Array.isArray` guard by iterating `list` with a plain for-of first | "a non-array breadcrumbs value ({...}) neither throws nor lets the token through"; "a non-array spans value ({...}) ..." (2 failed, 33 passed). The primitive cases (`breadcrumbs: 5`, `spans: "x"`) stay green, as the plan predicted: `cleanOrWithhold` returns early for a non-object | primitive-list cases |
| N6 | root branch returns `null` instead of `buildWithheldEvent(event)` | "an unwritable event root is replaced by a minimal event, never null, for beforeSend"; "an unwritable transaction root is replaced by a minimal event that stays a transaction" (2 failed, 33 passed) | all in-place cases |
| N7 | `buildWithheldEvent`: stop copying `type` | "an unwritable transaction root is replaced by a minimal event that stays a transaction" (1 failed, 34 passed) | the `beforeSend` root case (`type` undefined by construction) |

## Verification

- `npx vitest run src/instrumentation.test.ts src/lib/scrub-share-path.test.ts`: 56 passed after Task 1; `src/instrumentation.test.ts` alone 35 passed at the end. The three named existing cases ("the REGISTERED beforeSend scrubs every URL-shaped field of the event", "the REGISTERED beforeSendTransaction scrubs too", "an event with no share path passes through byte-identical") stayed green, unedited.
- Plan quick-run set (VALIDATION.md): 21 files, 940 tests passed.
- `npm run typecheck` exit 0. `npm run lint` exit 0 (0 errors; 4 pre-existing unused-variable warnings in `MetricsColumn.tsx`, `composite-read-path.ts` and `queries.stale-analytics-detail.test.ts`, none in this plan's files).
- `node scripts/verify-plan-anchors.mjs <plan>` exit 0 before any edit.
- Acceptance greps: `never to a throw inside` = 0; the `SENTRY_WITHHELD_EVENT_MESSAGE` constant line = 1; the seven `^function` declarations = 7; `beforeSend: scrubSentryEvent,` = 1 and `beforeSendTransaction: scrubSentryEvent,` = 1; `209 SC2` in the test file >= 1; marker literal in the test file >= 1; `beforeSendTransaction!` in the test file = 2.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical functionality] Outer try/catch safety net in `scrubSentryEvent`**
- **Found during:** Task 1 design (the plan's success criterion is that no event shape can make the scrub throw)
- **Issue:** `Array.isArray` on a revoked Proxy throws, and the guarded helpers cannot see that; one such shape would drop the report, which is exactly SC2.
- **Fix:** the step loop is wrapped in a try whose catch returns `buildWithheldEvent(event)`, so even an unforeseen throw still delivers an event that carries no original content.
- **Consequence for N3:** with the net in place, removing `guardedRead`'s try/catch no longer makes the registered hook throw; the throw is converted into a replacement event, and the case fails on its "rest of the event is delivered" assertion (`out.transaction` is undefined). The plan expected "fails by throwing"; the case still goes RED, for the stronger reason that the report was degraded.
- **Files modified:** `src/instrumentation.ts`
- **Commit:** `87f7506b6`

Otherwise the plan was executed as written. The N5 neuter used a small for-of wrapper in front of the existing `Array.isArray` branch (so the array path stays intact) instead of deleting the branch outright; the effect on non-array objects is the same.

## Assumptions and limits recorded, not resolved

- RESEARCH A3 (Relay/ingest accepts `{}` and `[]` as placeholders for a withheld crumb, span, request or data value) and A4 (ingest accepts the minimal replacement event, including the transaction shape) remain UNVERIFIED against a live DSN. No DSN was touched. Open Question 3's fallback (`null` for transactions only) was not taken; D-08 is followed for both hooks.
- A primitive (for example a string) sitting directly inside a `breadcrumbs` or `spans` array is not scrubbed. The pre-existing code did not scrub it either, and no Sentry schema puts one there; recorded so the next reader does not assume it is covered.
- A getter that returns a different object on each read could in principle show the walk a clean value and the serializer a dirty one. The read-back covers string slots only; this is a hostile-object shape no SDK produces and is out of scope for SHARE-QA-07.
- The depth cap of 8 is kept from the original; a token nested deeper than that is not walked.

## Known Stubs

None.

## Threat Flags

None. No new endpoint, auth path, file access or schema surface. T-209-04 (N2, N4), T-209-05 (N3, N5), T-209-06 (N6) and T-209-07 (N7) are mitigated and each has a RED-proven test.

## Self-Check: PASSED

- FOUND: `src/instrumentation.ts`, `src/instrumentation.test.ts`
- FOUND commits (ancestors of HEAD): `0fe2caf04`, `87f7506b6`, `f9ea6b708`
