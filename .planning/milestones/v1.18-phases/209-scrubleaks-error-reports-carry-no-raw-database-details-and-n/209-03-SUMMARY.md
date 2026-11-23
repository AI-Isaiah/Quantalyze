---
phase: 209-scrubleaks-error-reports-carry-no-raw-database-details-and-n
plan: 03
subsystem: observability
tags: [og-image, sentry, throttle, uuid-guard, public-route]

requires: []
provides:
  - "GET /api/og/factsheet/[id] treats a malformed id as a not-found: generic card, 200, long cache, no read, no log, no capture"
  - "a malformed hit can no longer spend the og-factsheet:read Sentry slot"
  - "P3's status assertion is real: the next/og mock carries a status"
affects: [209-04, 209-05]

status: complete
commits: 3
plan_head_before: afa67561d7bfd8382d9529b431c6d2c16c3bd7c0
plan_head_after: 16cc0f608b5c4dc20b1db15cf374a0cfb2657af1

actuals:
  tokens: 4200
  tasks: 2
  commits: 3

tech-stack:
  added: []
  patterns:
    - "isUuid(id) guard before a uuid-column read on a public route (same as the tearsheet route)"

key-files:
  created: []
  modified:
    - src/app/api/og/factsheet/[id]/route.tsx
    - src/app/api/og/factsheet/[id]/route.public-access.test.tsx

key-decisions:
  - "D-10: the guard wraps the existing read block and changes nothing inside it; no early return, the tail stays the one card renderer"
  - "D-11: P6 proves the slot is unspent by observing a real read error still captured once after a malformed hit, never by calling shouldCaptureNow from the test"
  - "D-12: the ImageResponse mock sets status from options.status when numeric, else 200"

patterns-established:
  - "a throttle-slot test asserts the later real failure is captured, not the throttle key"

requirements-completed: [SC3, SC5]
---

# Phase 209 Plan 03: OG malformed-id guard Summary

A malformed id on the public OG factsheet route no longer reaches the database or Sentry. `isUuid(id)` now guards the published-only read, so `not-a-uuid` gets the generic card as a 200 under the long cache, with no read, no failure log and no `shouldCaptureNow` call. It therefore cannot use up the one-per-minute `og-factsheet:read` capture slot that a real timeout or column drift needs. Closes `170.3-OG-MALFORMED-ID` and `170.3-OG-P3-STATUS-VACUOUS`.

## What was built

- `src/app/api/og/factsheet/[id]/route.tsx`: `import { isUuid } from "@/lib/utils";` and `if (isUuid(id)) { ... }` around the existing `try/catch` read (re-indented, nothing inside changed), with a Phase 209 comment naming D-10, the TODOS id and the tearsheet precedent. `FAILURE_CACHE_CONTROL`, the single `visible: true`, the single `displayStrategyName(` and the `ImageResponse` options are untouched.
- `route.public-access.test.tsx`: `ImageResponse` mock gains `status` (D-12); P3 rewritten (200, long cache, `STATE.observed.tables` equals `[]`, no `afterSpy`, no `captureToSentry`, no `console.error`); P5's `malformed` row removed; coverage-matrix docblock updated for P3, P5, P6, P7; `STATE.readError` knob (declared, reset in `beforeEach`, returned by `maybeSingle` after the 22P02 branch); P6 (malformed hit then a valid-uuid 57014 read error captures once, with the right tags and `strategy_id`, and the failure cache) and P7 (a valid-uuid read error sends no-store, one capture, `console.error` called).

## Task commits

| Task | Name | Commit |
|------|------|--------|
| 1 (RED) | failing P3, mock status, P5 row removed | `f2fd42e76` |
| 1 (GREEN) | `isUuid` guard in the route | `ada811089` |
| 2 | P6 and P7, `STATE.readError` | `16cc0f608` |

## TDD evidence

- Task 1 RED (`f2fd42e76`): P3 failed with `expected 'no-store' to be 'public, max-age=3600, ...'`, the malformed read was taking the failure path; the other 6 cases in the file stayed green.
- Task 1 GREEN (`ada811089`): `npx vitest run src/app/api/og` gave 6 files, 68 tests passed.
- Task 2: P6 and P7 pass on first write because Task 1's guard and the pre-existing `res.error` branch already implement the behaviour (breadth pinning). Their RED evidence is N3 and N4 below.

## Neuter-to-RED proofs (SC5)

Each: byte backup of `route.tsx` to the scratchpad (`cp`), neuter, run `npx vitest run` on `route.public-access.test.tsx`, restore with `cp`, `cmp` clean, rerun GREEN (`src/app/api/og`: 6 files, 68 tests after Task 1; 70 after Task 2).

| # | Neuter | Failing cases (RED) | Detail |
|---|--------|---------------------|--------|
| N1 | `if (isUuid(id)) {` replaced by `if (true) {` | P3 (1 failed, 6 passed) | first failing assertion `expected 'no-store' to be 'public, max-age=3600, ...'` (the malformed read took the failure path) |
| N2 | `status: 404` added to the route's `ImageResponse` options | P3 (1 failed, 6 passed) | `AssertionError: expected 404 to be 200`, so the status line is no longer vacuous (`170.3-OG-P3-STATUS-VACUOUS`) |
| N3 | guard neutered as in N1, run after Task 2 | P3 and P6 (2 failed, 7 passed) | P6: `expected "vi.fn()" to not be called at all, but actually been called 1 times`, the one capture carries `"code": "22P02"` and `"strategy_id": "not-a-uuid"`: the malformed hit spent the slot |
| N4 | `reportOgFailure("read", id, res.error);` commented out | P6 and P7 (2 failed, 7 passed) | both: `expected "vi.fn()" to be called 1 times, but got 0 times` |

## Verification

- `node scripts/verify-plan-anchors.mjs <plan>` exit 0 before any edit (8 claims).
- `npx vitest run src/app/api/og` exit 0 (70 tests); the four source-text suites (`strategy-display`, `phase-147-series-resolution-guards`, `figure-gate-census`, `display-sign-single-source`): 63 passed.
- Plan quick-run set (VALIDATION.md): 21 files, 941 tests passed.
- `npm run typecheck` exit 0. `npm run lint` exit 0 (0 errors; 4 pre-existing unused-variable warnings, none in this plan's files).
- Acceptance greps: `if (isUuid(id)) {` = 1; the `isUuid` import line = 1; `const FAILURE_CACHE_CONTROL = "no-store";` = 1; `visible: true` = 1; `displayStrategyName(` = 1; `res.status ?? 200` = 0; the malformed P5 row = 0; `readError` = 7 (at least 4); `it("P[67] ` = 2.

## Deviations from Plan

None - plan executed exactly as written. Two small notes: Task 1 was split into a RED test commit and a GREEN route commit (TDD), and under N1 and N3 vitest reports the first failing assertion (cache, and the not-called capture for P6) rather than all of the tables, cache and capture assertions the plan lists; the table and capture assertions sit behind it in the same case.

## Limits recorded, not resolved

- `170.3-OG-NOTFOUND-CACHE` stays out of scope: a genuine not-found, and now a malformed id, both keep the long cache by design (D-10).
- A uuid-shaped but unknown id still reads the database on every hit; only the malformed shape is short-circuited.

## Known Stubs

None.

## Threat Flags

None. No new endpoint, auth path, file access or schema surface. T-209-08 (N3) and T-209-09 (N1) are mitigated and each has a RED-proven test.

## Self-Check: PASSED

- FOUND: `src/app/api/og/factsheet/[id]/route.tsx`, `src/app/api/og/factsheet/[id]/route.public-access.test.tsx`
- FOUND commits (ancestors of HEAD): `f2fd42e76`, `ada811089`, `16cc0f608`
