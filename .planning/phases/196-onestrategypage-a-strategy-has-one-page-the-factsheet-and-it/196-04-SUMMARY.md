---
phase: 196-onestrategypage-a-strategy-has-one-page-the-factsheet-and-it
plan: 04
subsystem: ui
tags: [react, request-intro, copy, concurrency, vitest]
requires: []
provides:
  - "RequestIntroButton in UI-SPEC sentence-case copy with an aria-busy checking state and a double-click-safe send path"
affects: [196-05]
tech-stack:
  added: []
  patterns: ["useRef in-flight guard for click bursts; server 409 as cross-tab backstop"]
key-files:
  created:
    - src/components/strategy/RequestIntroButton.test.tsx
  modified:
    - src/components/strategy/RequestIntroButton.tsx
key-decisions:
  - "Double-click arm dispatches both clicks inside one act() so the ref, not the disabled attribute, is what is under test"
requirements-completed: [ROUTE-04]
status: complete
commits: 2
plan_head_before: 49566dbc00a314300b862d8b1d4b44120c4ed3d7
plan_head_after: 782c32fa88c0320133b588a2d07d75b6ed15fe34
actuals:
  tasks: 2
  commits: 2
---

# Phase 196 Plan 04: Request intro copy and double-send guard Summary

The Request intro flow now reads in UI-SPEC sentence case, announces its checking state as `aria-busy`, and cannot send two introduction requests from a click burst.

## Tasks

| Task | Name | Commit |
|------|------|--------|
| 1 | Tracer: checking state to sent state, new copy, under test | 5fe4f08ac |
| 2 | One request per click burst, and the failure copy | 782c32fa8 |

## What changed

- Trigger always reads "Request intro" (was "..." while checking), disabled and `aria-busy` during the existing-request check.
- Modal title "Request an introduction"; buttons "Send request", "Close without sending" (was "Cancel"), "Sending…" (U+2026).
- `inFlight` ref: `handleSubmit` returns early if set, sets it before the fetch, clears it in `finally`. A failed send releases it, so retry works.
- Both fallback errors are now "Your request was not sent. Check your connection and try again."; a server-supplied `error` string still wins. A 409 still maps to the sent (pending) state.
- Mandate fields, status badge, status messages and the `contact_requests` check are untouched.

## Verification

- `npx vitest run src/components/strategy/RequestIntroButton.test.tsx`: 11 tests passed (plan floor 8).
- `npx tsc --noEmit`: exit 0, no error lines.
- `npm run lint`: exit 0 (0 errors; 2 pre-existing unused-var warnings in `MetricsColumn.tsx` and `composite-read-path.ts`, files this plan does not touch).
- Acceptance greps on the component: `"..."` 0, `Request Intro` 0, `Send Request` 0, `Cancel` 0, `Failed to send request` 0, `aria-busy` 1, `useRef` 2.

## RED evidence (T-196-08 double-click arm)

Backup `cp -p` of the component to the scratchpad; neuter = delete `if (inFlight.current) return;`.

1. First attempt: the arm used two separate `fireEvent.click` calls and stayed GREEN under the neuter (11 passed). Cause: `fireEvent` flushes the re-render between clicks, so the button was already disabled and the second click never reached the handler. The arm did not test the ref.
2. Arm rewritten: both clicks dispatched inside one `act()` (state batched, button not yet disabled).
3. Neutered run: RED, `RequestIntroButton — one request per click burst > two synchronous clicks on Send request call fetch exactly once`, `AssertionError: expected "vi.fn()" to be called 1 times, but got 2 times`; 1 failed, 10 passed.
4. Restored with `cp -p` from the backup, `cmp` exit 0 (`CMP_OK`), run GREEN: 11 passed.

## Deviations from Plan

None in the design. One test-authoring correction (the non-biting first double-click arm above), fixed before commit; the committed arm bites.

## Not measured

- No browser or server run: tests need none (component under jsdom with mocked Supabase client and fetch). `/api/intro`'s 409 branch was read, not exercised.
- The unique-violation backstop (T-196-08's server half) was not tested here; it is unchanged server code (`23505` to 409).

## Known Stubs

None.

## Self-Check: PASSED

Both commits exist (`5fe4f08ac`, `782c32fa8`), both files present.
