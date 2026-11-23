# Phase 207: RETRYPROP - Pattern Map

**Mapped:** 2026-11-14
**Files analyzed:** 17 modified (9 boundaries, 8 colocated tests) + 1 new test = 18
**Analogs found:** 18 / 18 (the new test's Next-`ErrorBoundary` harness has no in-repo precedent; conventions come from analogs, harness from RESEARCH)

All analog paths below were checked tracked (`git ls-files`). Anchors are by symbol, not line, because the repo's `plan-anchor-verify` gate re-resolves `file:line` anchors and every edit here shifts lines.

## File Classification

| New/Modified File (under `src/app` unless noted) | Role | Data Flow | Closest Analog | Match |
|---|---|---|---|---|
| `error.tsx` | component (error boundary) | request-response | `factsheet/[id]/error.tsx` | exact (target shape) |
| `global-error.tsx` | component (error boundary, raw `<button>`, own `<html>`) | request-response | `factsheet/[id]/error.tsx` (raw `<button onClick={() => retry()}>`) | exact |
| `(auth)/error.tsx` | component | request-response | `factsheet/[id]/error.tsx` | exact |
| `(dashboard)/error.tsx` | component | request-response | `factsheet/[id]/error.tsx` | exact |
| `(dashboard)/admin/error.tsx` | component (+ header comment) | request-response | `factsheet/[id]/error.tsx` header comment | exact |
| `(dashboard)/allocations/error.tsx` | component (+ header comment) | request-response | same | exact |
| `(dashboard)/compare/error.tsx` | component (+ header comment) | request-response | same | exact |
| `(dashboard)/strategies/error.tsx` | component (+ header comment) | request-response | same | exact |
| `(dashboard)/strategies/new/wizard/error.tsx` | component (+ header comment) | request-response | same | exact |
| `error.test.tsx`, `global-error.test.tsx`, `(auth)/error.test.tsx` (rename only, no click arm today) | test | render | `factsheet/[id]/boundaries.test.tsx` | exact |
| `(dashboard)/admin/error.test.tsx`, `allocations/error.test.tsx`, `compare/error.test.tsx`, `strategies/error.test.tsx`, `strategies/new/wizard/error.test.tsx` (rename + reword titles/headers; have a click arm) | test | render + click | `factsheet/[id]/boundaries.test.tsx` (retry arm) | exact |
| `src/__tests__/error-boundaries-retry.test.tsx` (NEW) | test (cross-boundary, fs census + real Next `ErrorBoundary`) | event-driven (click to router.refresh spy) | `src/__tests__/role-home-call-sites.test.ts` (fs walk, count pin, vacuity fence) + `src/app/factsheet/[id]/boundaries.test.tsx` (jsdom header, mocks) | role-match; harness body is spike-proven in RESEARCH.md "Pattern 1" |

(`factsheet/[id]/error.tsx` is already correct and is the pattern source, not an edit target. Fs walk finds 10 boundaries in total.)

## Pattern Assignments

### The nine boundaries (component, request-response)

**Analog (target shape):** `src/app/factsheet/[id]/error.tsx`, the default-export function `FactsheetError`.

**Props type + handler to copy** (the only change in each boundary is this token; D-02 says declare `retry` only, in place of `unstable_retry`, no `reset`, no shared type):
```tsx
export default function FactsheetError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
  reset: () => void;   // factsheet only; do NOT add to the nine (D-02)
}) {
  ...
  onClick={() => retry()}
```
For the nine, the edit is: destructure `unstable_retry` becomes `retry`; type member `unstable_retry: () => void;` becomes `retry: () => void;`; handler `onClick={() => unstable_retry()}` becomes `onClick={() => retry()}`. Per file, three occurrences (destructure, type, handler), found by `grep -n unstable_retry <file>`.

**Raw-button variant** (`global-error.tsx`, symbol `GlobalError`): handler is on a plain `<button onClick={() => unstable_retry()} style={{...}}>`; same rename, leave the inline style object and `<html>`/`<body>` untouched (D-03).

**Header comments (D-04, D-10).** These prose lines carry the old contract and must be reworded or the static arm stays RED. Reword the prop name only; the analog wording to imitate is the `FactsheetError` doc block ("Try again calls `retry()`, which re-runs the server render. `reset()` would only clear the boundary's state ..."). Exact spots (found by `grep -n unstable_retry`):
- `(dashboard)/admin/error.tsx` docblock: "`unstable_retry` — Next 16.2.0, NOT `reset` — digest-ONLY" becomes "`retry` — NOT `reset` — digest-ONLY".
- `(dashboard)/strategies/error.tsx` and `(dashboard)/strategies/new/wizard/error.tsx` docblocks: identical sentence, same reword.
- `(dashboard)/allocations/error.tsx` docblock: "`unstable_retry` (Next 16.2.0 — NOT the legacy `reset`)" becomes "`retry` (NOT `reset`)".
- `(dashboard)/compare/error.tsx` docblock: "`unstable_retry` (Next 16.2.0), digest-ONLY ..." becomes "`retry`, digest-ONLY ...".
Suggested wording must not re-introduce the literal; the "Next 16.2.0" version claim attached to the old name is wrong for `retry` (stable in 16.3.0), so drop it rather than carry it over. Touch no other comment (D-03).

**Everything else byte-identical:** copy, `Link`/`Button` usage, `console.error` tags, Sentry capture, digest-only rendering.

---

### The eight colocated tests (test, render)

**Analog:** `src/app/factsheet/[id]/boundaries.test.tsx`, the first `it` ("Try again re-runs the server render through retry(), and never through reset()"). Only the "never reset" half is dropped in the colocated tests (D-09 amended: `reset` is not in the D-02 prop type, so passing it is an excess-property type error; "never reset" is proven once, in the new cross-boundary test).

**Rename shape, applied to every `render(...)` site** (about 4 in root `error.test.tsx`, 2 in `global-error.test.tsx`, 3 in `(auth)/error.test.tsx`, 6 to 7 in each of the other five):
```tsx
// before
render(<AdminError error={err} unstable_retry={vi.fn()} />);
// after
render(<AdminError error={err} retry={vi.fn()} />);
```

**Click arm to adapt** (five files that already have one: admin, allocations, compare, strategies, wizard). Excerpt from `(dashboard)/compare/error.test.tsx` "Test 2", to keep and rename:
```tsx
it("Test 2: the 'Try again' button invokes retry()", () => {
  const retry = vi.fn();
  const err = Object.assign(new Error("boom"), { digest: "d-2" });
  render(<CompareError error={err} retry={retry} />);

  fireEvent.click(screen.getByRole("button", { name: /Try again/ }));
  expect(retry).toHaveBeenCalledTimes(1);
});
```
(`strategies` and `wizard` use `await userEvent.click(...)`; `admin` uses `fireEvent.click`. Keep each file's existing interaction style.)

**Strings that must also change, or the static arm (D-07) stays RED** (D-10): test titles and docblock prose:
- `admin/error.test.tsx`: docblock item "2. "Try again" invokes unstable_retry() exactly once" and title `"retry button invokes unstable_retry() exactly once"`.
- `strategies/error.test.tsx`, `strategies/new/wizard/error.test.tsx`: title `"Try again button invokes unstable_retry() once"`.
- `allocations/error.test.tsx`: docblock ("mirrors the dashboard `error.tsx`: `unstable_retry` (not the legacy `reset`) ...") and title `"Test 2: the retry button invokes unstable_retry()"`.
- `compare/error.test.tsx`: docblock ("the retry button invokes `unstable_retry`") and title `"Test 2: the 'Try again' button invokes unstable_retry()"`.

**Three files with no click arm** (`error.test.tsx`, `global-error.test.tsx`, `(auth)/error.test.tsx`): rename the prop only. A new click arm is optional (RESEARCH Open Question 1; the cross-boundary test already covers all ten). `(dashboard)/error.tsx` has no colocated test at all and is covered only by the new test; do not add one in this phase.

**Final gate for this group:** `grep -rn unstable_retry src/app` must print nothing.

---

### `src/__tests__/error-boundaries-retry.test.tsx` (NEW; test, event-driven)

**Primary body:** RESEARCH.md "Pattern 1: Mount Next's real ErrorBoundary (spike-proven)" is the file to ship verbatim; it was run RED (10 failed on base), GREEN (13 passed after rename), RED per reverted boundary, and RED for `reset`. D-05 primary path (real `ErrorBoundary`) shipped; the fallback is not needed, and the plan should say so. Real-codebase analogs below supply only the conventions around it.

**Analog 1: `src/__tests__/role-home-call-sites.test.ts`**, the fs-scanning census convention (imports, `ROOT`/`SRC` anchoring, count pin with a vacuity fence):
```ts
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { describe, expect, it } from "vitest";
...
const ROOT = join(__dirname, "..", "..");
const SRC = join(ROOT, "src");
```
The new test uses `const APP_DIR = join(__dirname, "..", "app")` and its own small recursive `walk`, as in the spike. Keep the explanatory docblock convention: say WHY the test exists (the colocated tests hand the component the wrong prop, which is how the bug survived) and note the pinned count is a vacuity fence.

**Analog 2: `src/app/factsheet/[id]/boundaries.test.tsx`**, header and mocks:
```tsx
/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const captureToSentry = vi.hoisted(() => vi.fn());
vi.mock("@/lib/sentry-capture", () => ({ captureToSentry }));

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});
```
In the new test, mock both `@sentry/nextjs` (root and global boundaries lazy-import it; `global-error.test.tsx` already mocks it the same way with `captureException`) and `@/lib/sentry-capture` (factsheet boundary). Suppress `console.error` in `beforeEach` (React logs the thrown child and the `<html>`-in-`<div>` warning for `global-error.tsx`; `global-error.test.tsx` already tolerates this).

**Load-bearing shape of the harness (copy from RESEARCH Pattern 1, do not reinvent):**
```tsx
import { ErrorBoundary, type ErrorComponent } from "next/dist/client/components/error-boundary";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";

function mountThroughNext(Comp: ErrorComponent) {
  const refresh = vi.fn();
  render(
    <AppRouterContext.Provider value={{ refresh } as never}>
      <ErrorBoundary errorComponent={Comp}><Thrower /></ErrorBoundary>
    </AppRouterContext.Provider>,
  );
  return refresh;
}
```
- `(await import(/* @vite-ignore */ file)).default as ErrorComponent` (cast required: `ErrorInfo.error` is `unknown`).
- `it.each` titled by `relative(APP_DIR, file)` so a RED run names the reverted boundary (D-08).
- Four arms: count pin (10), one `it.each` over discovered boundaries asserting `refresh` called once synchronously after `fireEvent.click`, a harness self-check (a button wired to `reset()` must NOT reach `refresh`), and the static arm.
- The static arm builds the forbidden token with `["unstable", "retry"].join("_")` so the test file never contains the literal itself.
- Must NOT go in `vitest.node-env.ts`; it needs jsdom. `src/**/*.test.{ts,tsx}` collects it with no registration. Quick run: `npx vitest run src/__tests__/error-boundaries-retry.test.tsx --project jsdom`.

**D-08 RED proof (executor procedure):** `cp -p` a boundary to the scratchpad as a byte backup, `sed` its three `retry` tokens back to the old name, run the quick command and see that boundary named plus the static arm RED, then `cp -p` the backup back and re-run GREEN. Never `git checkout`/`restore`/`stash`.

## Shared Patterns

### Digest-only error disclosure (ASVS V7)
**Source:** `src/app/(dashboard)/admin/error.tsx` (`AdminError`) and its test arm "NEVER renders the thrown error.message".
**Apply to:** all boundary edits. Do not change; the prop rename must leave `error.digest` rendering and the `console.error("[admin-error]", error)` tag byte-identical (D-03). The colocated tests already pin this; leave those arms untouched.

### Colocated boundary test shape
**Source:** `src/app/(dashboard)/admin/error.test.tsx`: `vi.mock("next/link", ...)`, `render`/`screen`/`fireEvent`/`cleanup` from `@testing-library/react`, `afterEach(() => cleanup())`, `Object.assign(new Error("boom"), { digest: "d-1" })` as the thrown fixture.
**Apply to:** the eight updated tests; change props only.

### Cite by symbol
**Apply to:** the PLAN.md. Anchor each task by symbol ("the `unstable_retry` destructure in `AdminError`", "the `it("retry button invokes ...")` arm"), never `file:line`.

## No Analog Found

None. The one nonstandard element, mounting Next's real `ErrorBoundary`, has no prior use in the repo (grep shows no other import of `next/dist/client/components/error-boundary`), so for that part the planner should use RESEARCH.md "Pattern 1" as the source, with the repo analogs above for conventions only.

## Metadata

**Analog search scope:** `src/app/**/error*.tsx`, `src/app/**/*.test.tsx` boundary tests, `src/__tests__/` fs-scanning census tests.
**Files read:** `factsheet/[id]/error.tsx`, `factsheet/[id]/boundaries.test.tsx`, `(dashboard)/admin/error.tsx`, `(dashboard)/admin/error.test.tsx`, `global-error.tsx`, `global-error.test.tsx`, `src/__tests__/role-home-call-sites.test.ts` (header); targeted excerpts from compare, strategies, allocations tests and headers. Every `unstable_retry` occurrence under `src/app` was enumerated with grep (9 boundaries, 8 tests).
**Pattern extraction date:** 2026-11-14
