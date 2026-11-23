---
phase: 207-retryprop-every-error-page-s-try-again-button-works
reviewed: 2026-11-14T01:20:00Z
depth: standard
files_reviewed: 18
files_reviewed_list:
  - src/__tests__/error-boundaries-retry.test.tsx
  - src/app/(auth)/error.test.tsx
  - src/app/(auth)/error.tsx
  - src/app/(dashboard)/admin/error.test.tsx
  - src/app/(dashboard)/admin/error.tsx
  - src/app/(dashboard)/allocations/error.test.tsx
  - src/app/(dashboard)/allocations/error.tsx
  - src/app/(dashboard)/compare/error.test.tsx
  - src/app/(dashboard)/compare/error.tsx
  - src/app/(dashboard)/error.tsx
  - src/app/(dashboard)/strategies/error.test.tsx
  - src/app/(dashboard)/strategies/error.tsx
  - src/app/(dashboard)/strategies/new/wizard/error.test.tsx
  - src/app/(dashboard)/strategies/new/wizard/error.tsx
  - src/app/error.test.tsx
  - src/app/error.tsx
  - src/app/global-error.test.tsx
  - src/app/global-error.tsx
findings:
  critical: 0
  warning: 0
  info: 3
  total: 3
  necessity: 0
status: issues_found
---

# Phase 207: Code Review Report

**Reviewed:** 2026-11-14T01:20:00Z
**Depth:** standard
**Files Reviewed:** 18
**Status:** issues_found (Info only; nothing at MEDIUM or above)

## Summary

Scope: `git diff 7a229d27f..HEAD -- src` (commits `0dfbc40f1`, `c7f434ea3`, `4e49a09b8`). Nine
boundaries rename the old unstable-prefixed prop to `retry` at the destructure, the props type and
the Try again `onClick`. Eight colocated tests now pass `retry`. One new cross-boundary test mounts
every boundary inside Next's real `ErrorBoundary`.

What I checked against the installed `next@16.4.2`, not against the CONTEXT's account of it:

- `node_modules/next/dist/client/components/error-boundary.js`: `ErrorBoundaryHandler.render`
  passes exactly `{ error, reset, retry }`. `retry` is `startTransition(() => { this.context?.refresh(); this.reset(); })`.
  `grep -rn unstable_retry node_modules/next/dist/` hits only the docs version table (`error.md:332`).
  The production fix is correct.
- `global-error.tsx` reaches the same props on every path. In production it goes through
  `app-router.js:422` `RootErrorBoundary` -> `errors/root-error-boundary.js` -> `ErrorBoundary`,
  and that boundary sits inside `AppRouterContext.Provider` (`app-router.js:450`), so `refresh` is
  live. In development `next-devtools/userspace/app/app-dev-overlay-error-boundary.js:22-30`
  (`ErroredHtml`) also passes `reset` and `retry`. The CONTEXT says "the same `ErrorBoundary`".
  The production path goes through one wrapper first, but the props are the same.
- `grep -rn unstable_retry src e2e tests scripts docs`: no hits. SC-1 holds repo-wide, not only
  under `src/app`.
- Every boundary keeps its copy, links, log tag, digest-only render and Sentry capture. The only
  changes are the prop identifier and the five header docblocks D-04/D-10 name (D-03 holds).
- Re-ran the ten boundary test files (the nine in scope plus `factsheet/[id]/boundaries.test.tsx`):
  `Test Files 10 passed (10)`, `Tests 58 passed (58)`. Ran `npx tsc --noEmit -p .`: no
  diagnostics on any boundary or test file.
- The new test can fail. A boundary still reading the old prop calls `undefined()` in its click
  handler, so the `refresh` spy stays at 0. A boundary with no Try again button fails
  `getByRole`. The `reset()` self-check arm shows the harness does not pass a wrong wiring.
  The SUMMARY records the D-08 neuter (CompareError, byte backup, 2 failed, then restored
  identical).

No BLOCKER, no security issue, no user-facing or data-integrity defect. The three findings below
are LOW/INFO. Each one either limits how much the new gate can prove or is an inconsistency
outside the diff.

Severity mapping used: CRITICAL/HIGH -> `critical`, MEDIUM -> `warning`, LOW/INFO -> `info`.

Necessity rubric (`necessity-review.md`) read. Nothing in scope qualifies.

## Narrative Findings (AI reviewer)

## Info

### IN-01: [LOW] The per-boundary arm proves `router.refresh` fired, not that the boundary was reset, so a refresh-only handler passes

**File:** `src/__tests__/error-boundaries-retry.test.tsx:86-95`
**User-facing:** no (test-gate strength). **Data integrity:** no.
**Issue:** The arm asserts only `refresh` toHaveBeenCalledTimes(1). Next's `retry` does two
things: `refresh()` and `reset()`. A future boundary that wires Try again to
`useRouter().refresh()` passes this arm. `useRouter` reads the same `AppRouterContext`
(`node_modules/next/dist/client/components/navigation.js:146`), so the spy fires. That handler never clears the boundary's error state, though, so in production the
error UI stays on screen after the refetch, and the user sees the same dead button this phase set
out to remove. The header comment claims the file proves Try again calls the `retry` Next
passes. As written it proves "something called `router.refresh`". `Thrower` throws on every
render, so the test cannot see whether the boundary recovered.
**Fix:** Let the child stop throwing only after the fallback is on screen, then assert the
fallback is gone and the child rendered, alongside the `refresh` assertion. Do not use a
throw-once-on-first-render child: React retries a concurrent render once, synchronously, after an
error, so such a child would recover before the boundary ever showed. Untested sketch, not run
against this repo:
```tsx
const gate = { throwing: true };
beforeEach(() => {
  gate.throwing = true; // per arm, or every arm after the first never throws
});
function Child() {
  if (gate.throwing) throw Object.assign(new Error("boom"), { digest: "d-1" });
  return <p>recovered</p>;
}
// in the arm (mount <Child /> under ErrorBoundary as today):
const button = screen.getByRole("button", { name: /try again/i }); // fallback is up
gate.throwing = false;
fireEvent.click(button);
expect(refresh).toHaveBeenCalledTimes(1);
expect(await screen.findByText("recovered")).toBeTruthy(); // reset() ran too
```
**Phase-goal verdict: NOT a phase-goal gap.** SC-2 asks for a test that renders every boundary
through the props Next's own `error-boundary.js` passes and goes RED when one boundary is
reverted. Both hold. D-05 locks the assertion as "the router `refresh` spy was called", which is
exactly what shipped, and all ten boundaries call `retry()` today. This finding is about how well
the test holds up against a future, different regression, not about whether this phase did its
job. It needs no fixer round.

Keep the `reset()` self-check, and add a refresh-only self-check that must fail the recovery
assertion. With both, the arm tells apart `retry`, a `reset`-only handler and a `refresh`-only
handler.

### IN-02: [LOW] Boundary discovery and the static arm skip boundary files that Next would still load

**File:** `src/__tests__/error-boundaries-retry.test.tsx:54-57`, `:105-110`
**User-facing:** no (gate coverage). **Data integrity:** no.
**Issue:** Discovery accepts only `n === "error.tsx" || n === "global-error.tsx"`. The SC-1
static arm scans only `/\.(ts|tsx)$/`. `next.config.ts` sets no `pageExtensions`, so Next's
defaults (`tsx`, `ts`, `jsx`, `js`) apply, and `tsconfig.json:5` has `"allowJs": true`. Next would
route a boundary authored as `error.ts`, `error.jsx`, `error.js` or `global-error.jsx`, but that
file is missing from the it.each list and from the `BOUNDARY_COUNT` pin. A `.js`/`.jsx` file
reading the old prop would also pass the static arm. D-06's stated goal, "a new boundary is
covered automatically", then fails without notice. The case is unlikely today because
`find src/app -name '*.js' -o -name '*.jsx'` returns nothing, which is why this is LOW.
**Fix:** Match Next's own set:
```ts
const BOUNDARY_RE = /^(global-)?error\.(tsx|ts|jsx|js)$/;
const boundaries = walk(APP_DIR, (n) => BOUNDARY_RE.test(n)).sort();
// static arm:
walk(APP_DIR, (n) => /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(n))
```

### IN-03: [INFO] `factsheet/[id]/error.tsx` declares a `reset` prop it never reads, unlike the nine boundaries; the SUMMARY's "0 files carry a `reset: () => void;` member" is true only for the nine

**File:** `src/app/factsheet/[id]/error.tsx:21-25` (outside the diff; included here because D-06 brings it into the new test's scope)
**User-facing:** no. **Data integrity:** no.
**Issue:** After this phase, nine boundaries type their props as `{ error; retry }`. The factsheet
boundary still types `{ error; retry; reset }` and destructures only `error, retry`. That is
harmless at runtime, because Next passes `reset` anyway. It does leave ten boundaries with two
props shapes. It also means the SUMMARY evidence line "0 files carry a `reset: () => void;`
member" holds only for the nine edited files: `grep -rln "reset: () => void;" src/app` returns
`src/app/factsheet/[id]/error.tsx`. Its colocated `boundaries.test.tsx:41-47` passes `reset` so
it can assert that `reset` is never called, which is why the member exists.
**Fix:** No code change is needed for this phase. If the shapes should match, drop the member
and let the D-05 cross-boundary self-check carry the "never `reset`" proof, as D-09 already does
for the other eight. Otherwise, scope the SUMMARY sentence to "the nine edited boundaries".

---

_Reviewed: 2026-11-14T01:20:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
