# Phase 207: RETRYPROP — every error page's Try again button works - Context

**Gathered:** 2026-11-14
**Status:** Ready for planning
**Mode:** Smart discuss, run by a phase agent that cannot ask the founder. Every grey area below had a
(Recommended) answer that needs no founder judgement, so each recommendation was taken and is recorded
here as the decision. None of them changes scope beyond the ROADMAP goal.

<domain>
## Phase Boundary

From ROADMAP `### Phase 207`: every error boundary's Try again button calls the `retry` prop that
Next 16.4.2 actually passes (`{ error, reset, retry }`), not `unstable_retry`, which is undefined at
runtime. Closes TODOS `196-ERROR-BOUNDARY-UNSTABLE-RETRY-01`.

Success criteria (ROADMAP, verbatim):
1. No error boundary under `src/app` reads `unstable_retry`.
2. A test renders every boundary through the props Next's own `error-boundary.js` passes and proves
   Try again calls `retry`; it goes RED when one boundary is reverted.

Measured at base `7a229d27f` (installed `next@16.4.2`):
- `node_modules/next/dist/client/components/error-boundary.js` renders `this.props.errorComponent`
  with exactly `{ error, reset, retry }`. `retry` runs `startTransition(() => { router.refresh(); reset(); })`.
- `grep -rn unstable_retry node_modules/next/dist/client node_modules/next/dist/server` finds nothing.
  The docs' version table: `unstable_retry` added v16.2.0, `retry` stable v16.3.0.
- `global-error.tsx` is also rendered through the same `ErrorBoundary`
  (`app-router.js`, `errorComponent: globalError[0]`), so it gets the same props.
- Ten boundary files under `src/app`. Nine read `unstable_retry`: `error.tsx`, `global-error.tsx`,
  `(auth)/error.tsx`, `(dashboard)/error.tsx`, `(dashboard)/admin/error.tsx`,
  `(dashboard)/allocations/error.tsx`, `(dashboard)/compare/error.tsx`,
  `(dashboard)/strategies/error.tsx`, `(dashboard)/strategies/new/wizard/error.tsx`.
  `factsheet/[id]/error.tsx` (Phase 196) already uses `retry`.
- Eight colocated `error.test.tsx` files pass `unstable_retry={...}` and assert it is called, so they
  prove the bug is absent only because they hand the component the wrong prop.

</domain>

<decisions>
## Implementation Decisions

### Which prop Try again calls
- **D-01:** Try again calls `retry()`, never `reset()` and never `unstable_retry`. Rationale: the Next
  docs say `retry` re-fetches and re-renders the segment, and `reset` only clears boundary state, which
  re-renders the same failed server result. It also matches Phase 196's factsheet boundary.
- **D-02:** Each boundary's props type declares `retry: () => void` in place of `unstable_retry`. No shared
  type or helper is introduced (simplicity: ten one-line changes, no new abstraction).
- **D-03:** Nothing else in the boundaries changes: copy, links, logging, Sentry capture, digest-only
  rendering all stay byte-identical apart from the prop name.
- **D-04:** Comments that assert the old contract (the admin and wizard headers say "`unstable_retry` —
  Next 16.2.0, NOT `reset`") are corrected in the same edit, because they would otherwise tell the next
  reader to reintroduce the bug. No other comment is touched.

### The proving test
- **D-05:** One new cross-boundary test file renders every boundary through Next's REAL
  `ErrorBoundary` from `next/dist/client/components/error-boundary` (a child that throws, an
  `AppRouterContext` whose `refresh` is a spy), clicks Try again, and asserts the router `refresh` spy
  was called. That is the strongest available proof that the button calls the `retry` Next passes,
  since the props come from Next's own code rather than from the test. If mounting the real
  `ErrorBoundary` proves unworkable in jsdom, the fallback is to render each boundary with exactly
  `{ error, reset, retry }` (and no other prop) and assert `retry` fires and `reset` does not; the
  plan must say which one shipped and why.
- **D-06:** The boundary list is discovered from the filesystem (every `error.tsx` and `global-error.tsx`
  under `src/app`), and the test also pins the discovered count, so a new boundary is covered
  automatically and a removed one is noticed. `factsheet/[id]/error.tsx` is included.
- **D-07:** A static arm asserts no file under `src/app` contains the string `unstable_retry` (SC-1),
  test files included once they are updated.
- **D-08:** Must be able to fail: revert one boundary to `unstable_retry` from a byte backup, see the new
  test go RED naming that boundary, restore from the byte backup (never git checkout/restore/stash).

### Existing per-boundary tests
- **D-09:** The eight colocated `error.test.tsx` files are updated to pass `retry` in place of
  `unstable_retry` and assert Try again calls `retry` where they already have a click arm. They pass
  only the props the D-02 type declares (no `reset`, which would be an excess-property type error).
  "Try again never calls `reset`" is proven once, in the D-05 cross-boundary test, whose props come
  from Next itself. Their other assertions (digest-only, escape links, logging tags) are untouched.
  (Amended 2026-11-14 after research found the D-02/D-09 typing conflict; agent decision, no founder
  judgement involved.)
- **D-10:** D-04 covers every boundary header that names `unstable_retry`. Research counted five (admin,
  strategies, wizard, allocations, compare), and the colocated test titles that contain the string are
  reworded too, since D-07's static arm scans all of `src/app`.

### Pre-planning hooks not run (recorded deviation)
- `/gsd-autonomous` step 3a.5 resolved two `plan:pre` step hooks: `ai-integration-phase` and `ui-phase`.
  Neither was run. `check ui-plan-gate 207` returned `frontend: true` from `matchedToken: "page"`, the
  word "page" in the phase title ("every error page's Try again button works"). That is a keyword false
  positive. The phase builds no AI system, so an AI-SPEC has nothing to specify. The phase also changes
  no visual element (D-03: copy, layout and styling stay byte-identical apart from a prop name), so a
  UI-SPEC has nothing to contract. Both workflows open with interactive questions that a phase agent
  cannot put to the founder.

### Claude's Discretion
- Exact file name and location of the cross-boundary test (expected under `src/app/` or
  `src/__tests__/`), and how `global-error.tsx`'s `<html>`/`<body>` is mounted under jsdom.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/app/factsheet/[id]/boundaries.test.tsx` — Phase 196's retry-not-reset test pattern.
- `src/app/(dashboard)/admin/error.test.tsx` — shape shared by the colocated boundary tests
  (`vi.mock("next/link")`, `@testing-library/react`, `fireEvent`).

### Established Patterns
- Boundaries are client components, digest-only on screen, log with a per-surface tag, some capture to
  Sentry via a lazy import.
- Vitest runs jsdom by default (`vitest.config.ts`); coverage is a blocking ratchet.

### Integration Points
- Next's `ErrorBoundary` (`next/dist/client/components/error-boundary.js`) reads
  `AppRouterContext` (`next/dist/shared/lib/app-router-context.shared-runtime`) for `refresh`, and
  `useUntrackedPathname` for the pathname.

</code_context>

<specifics>
## Specific Ideas

- The test must use the props Next's own `error-boundary.js` passes (ROADMAP SC-2), not props the test
  invents; that is why D-05 prefers mounting the real `ErrorBoundary`.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>
