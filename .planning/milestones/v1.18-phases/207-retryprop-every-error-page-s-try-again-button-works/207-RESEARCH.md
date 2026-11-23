# Phase 207: RETRYPROP - Research

**Researched:** 2026-11-14
**Domain:** Next 16.4.2 error-boundary props, vitest/jsdom testing of Next's real `ErrorBoundary`
**Confidence:** HIGH (the one open technical question, CONTEXT D-05, was settled by running spike tests, not by reading)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- D-01: Try again calls `retry()`, never `reset()` and never `unstable_retry`. Rationale: the Next docs say `retry` re-fetches and re-renders the segment, and `reset` only clears boundary state, which re-renders the same failed server result. It also matches Phase 196's factsheet boundary.
- D-02: Each boundary's props type declares `retry: () => void` in place of `unstable_retry`. No shared type or helper is introduced (simplicity: ten one-line changes, no new abstraction).
- D-03: Nothing else in the boundaries changes: copy, links, logging, Sentry capture, digest-only rendering all stay byte-identical apart from the prop name.
- D-04: Comments that assert the old contract (the admin and wizard headers say "`unstable_retry` — Next 16.2.0, NOT `reset`") are corrected in the same edit, because they would otherwise tell the next reader to reintroduce the bug. No other comment is touched.
- D-05: One new cross-boundary test file renders every boundary through Next's REAL `ErrorBoundary` from `next/dist/client/components/error-boundary` (a child that throws, an `AppRouterContext` whose `refresh` is a spy), clicks Try again, and asserts the router `refresh` spy was called. That is the strongest available proof that the button calls the `retry` Next passes, since the props come from Next's own code rather than from the test. If mounting the real `ErrorBoundary` proves unworkable in jsdom, the fallback is to render each boundary with exactly `{ error, reset, retry }` (and no other prop) and assert `retry` fires and `reset` does not; the plan must say which one shipped and why.
- D-06: The boundary list is discovered from the filesystem (every `error.tsx` and `global-error.tsx` under `src/app`), and the test also pins the discovered count, so a new boundary is covered automatically and a removed one is noticed. `factsheet/[id]/error.tsx` is included.
- D-07: A static arm asserts no file under `src/app` contains the string `unstable_retry` (SC-1), test files included once they are updated.
- D-08: Must be able to fail: revert one boundary to `unstable_retry` from a byte backup, see the new test go RED naming that boundary, restore from the byte backup (never git checkout/restore/stash).
- D-09: The eight colocated `error.test.tsx` files are updated to pass `retry` and `reset` (the props Next passes) and to assert Try again calls `retry` and not `reset`. They stay in place; their other assertions (digest-only, escape links, logging tags) are untouched.
- Pre-planning hooks not run (recorded deviation): `ai-integration-phase` and `ui-phase` were not run (keyword false positive on "page"; no AI system, no visual change).

### Claude's Discretion
- Exact file name and location of the cross-boundary test (expected under `src/app/` or `src/__tests__/`), and how `global-error.tsx`'s `<html>`/`<body>` is mounted under jsdom.

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

No requirement IDs were provided (ROADMAP: "Requirements: TBD"). The two ROADMAP success criteria stand in for them.

| ID | Description | Research Support |
|----|-------------|------------------|
| SC-1 | No error boundary under `src/app` reads `unstable_retry` | Nine files + eight tests + two comments to edit (inventory below); static arm in the new test |
| SC-2 | A test renders every boundary through the props Next's own `error-boundary.js` passes and proves Try again calls `retry`; RED when one boundary is reverted | Spike-proven harness (D-05 primary path works; fallback not needed); RED and GREEN both demonstrated |
</phase_requirements>

## Summary

The bug is confirmed by execution, not just by reading. Next 16.4.2's `ErrorBoundaryHandler.render()` renders the error component with exactly `{ error, reset, retry }`, and `retry` is `startTransition(() => { this.context?.refresh(); this.reset(); })` `[VERIFIED: node_modules/next/dist/client/components/error-boundary.js:43-48 and :110-115]`. Mounting the real `ErrorBoundary` in vitest/jsdom and clicking Try again on each of the nine `unstable_retry` boundaries throws `TypeError: unstable_retry is not a function`, so a test using that harness is RED today for all nine. Replacing `unstable_retry` with `retry` makes all of them GREEN. Replacing it with `reset` leaves the refresh spy at 0 calls (RED), so the harness distinguishes `retry` from `reset`.

D-05's primary path is fully workable. No `PathnameContext`, no `handleISRError` stubbing, no `isBot` stubbing, no `act`/`waitFor` and no special `global-error.tsx` mount were needed. The fallback in D-05 is NOT needed; the plan should record "real `ErrorBoundary` shipped".

The edit set is ten one-token changes plus eight colocated tests plus two comment fixes, and one new test file. There is no new package, no migration and no UI change.

**Primary recommendation:** Ship `src/__tests__/error-boundaries-retry.test.tsx` exactly in the shape of the spike below (fs-discovered boundaries, real `ErrorBoundary` + `AppRouterContext` with a `refresh` spy, count pin, harness self-check arm, static `unstable_retry` arm), then do the ten mechanical prop renames.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Catching a render throw and showing fallback UI | Browser / Client (React error boundary, `"use client"`) | Frontend Server (Next passes `digest` for server throws) | `ErrorBoundaryHandler` is a client class component |
| Re-fetching a failed server render | Frontend Server (SSR) via `router.refresh()` | Browser (initiates it) | `retry` calls `AppRouterContext.refresh()`; `reset` alone re-renders the same failed RSC payload |
| Proving the wiring | Test (vitest/jsdom) | — | Needs no server; the router seam is the `refresh` spy |

## Standard Stack

### Core
No new libraries. Everything needed is already installed.

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| next | 16.4.2 `[VERIFIED: node_modules/next/package.json "version": "16.4.2"]` | Supplies the real `ErrorBoundary` and `AppRouterContext` the test mounts | The props under test come from its own code |
| vitest | 5.0.5 (run output: `RUN  v5.0.5`) | Test runner; `package.json` range `^5.0.3` | Repo standard |
| @testing-library/react | `^16.3.3` (package.json) | `render`, `screen`, `fireEvent` | Repo standard; `fireEvent` is wrapped in `act` |
| react / react-dom | 19.3.1 (package.json) | — | Repo standard |
| jsdom | `^30.1.3` (package.json) | DOM env | Repo default env |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Real `ErrorBoundary` + `AppRouterContext` spy (D-05 primary) | Render each boundary with hand-built `{ error, reset, retry }` (D-05 fallback) | Fallback proves only "calls the prop named `retry`", not that Next passes that name. Not needed, since the primary works. |

**Installation:** none.

## Package Legitimacy Audit

No external packages are installed by this phase. Audit not applicable (no `npm install`, no `package.json` change).

## Architecture Patterns

### System Architecture Diagram

```
 test (vitest, jsdom)
   |
   | fs walk of src/app -> list of error.tsx / global-error.tsx  (D-06, count pinned = 10)
   v
 for each boundary file: dynamic import -> default export (the boundary component)
   |
   v
 <AppRouterContext.Provider value={{ refresh: spy }}>
   <ErrorBoundary errorComponent={Boundary}>        <-- Next's REAL class (error-boundary.js)
     <Thrower />  --throws--> getDerivedStateFromError
   </ErrorBoundary>                                    |
 </AppRouterContext.Provider>                          v
                              render() -> <Boundary error reset retry />   (props from Next, not the test)
                                                       |
   fireEvent.click("Try again") ----------------------+
        |
        v
   Boundary onClick -> retry()  --> startTransition(() => { context.refresh(); reset(); })
        |                                  |
        |                                  v
        |                        refresh spy called  <== assertion (toHaveBeenCalledTimes(1))
        v
   if Boundary still reads unstable_retry: TypeError "unstable_retry is not a function"  => RED
   if Boundary calls reset(): spy stays at 0                                            => RED
```

### Recommended Project Structure
```
src/__tests__/
└── error-boundaries-retry.test.tsx   # NEW, the cross-boundary proof (D-05..D-07)
src/app/**/error.tsx, global-error.tsx  # 9 prop renames (factsheet/[id]/error.tsx already uses retry)
src/app/**/error.test.tsx, global-error.test.tsx  # 8 colocated tests updated (D-09)
```
Location choice (Claude's discretion): `src/__tests__/` is recommended. It is already where the repo's fs-reading census/grep tests live (e.g. `critical-regressions.test.ts`, `figure-gate-census.test.ts`). It keeps a test file out of the route tree, and `APP_DIR = join(__dirname, "..", "app")` works from there. `src/app/` would also work (colocated tests already live there).

### Pattern 1: Mount Next's real ErrorBoundary (spike-proven)
**What:** a throwing child, `AppRouterContext.Provider` with `{ refresh: spy }`, real `ErrorBoundary`.
**When to use:** the single cross-boundary proof.
**Example (this exact file was run; see Validation Architecture for results):**
```tsx
/** @vitest-environment jsdom */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  ErrorBoundary,
  type ErrorComponent,
} from "next/dist/client/components/error-boundary";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";

// error.tsx / global-error.tsx lazy-import @sentry/nextjs; factsheet imports captureToSentry.
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));
vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: vi.fn() }));

const APP_DIR = join(__dirname, "..", "app");
const BOUNDARY_COUNT = 10;
// Built by join so this file does not itself contain the literal (D-07 scans src/app only, but
// keep the string out of src/__tests__ greps too).
const OLD = ["unstable", "retry"].join("_");

function walk(dir: string, accept: (name: string) => boolean, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, accept, out);
    else if (accept(name)) out.push(p);
  }
  return out;
}
const boundaries = walk(APP_DIR, (n) => n === "error.tsx" || n === "global-error.tsx").sort();

function Thrower(): never {
  throw Object.assign(new Error("boom"), { digest: "d-1" });
}

function mountThroughNext(Comp: ErrorComponent) {
  const refresh = vi.fn();
  render(
    <AppRouterContext.Provider value={{ refresh } as never}>
      <ErrorBoundary errorComponent={Comp}>
        <Thrower />
      </ErrorBoundary>
    </AppRouterContext.Provider>,
  );
  return refresh;
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("every error boundary's Try again works", () => {
  it("discovers every boundary under src/app", () => {
    expect(boundaries.map((f) => relative(APP_DIR, f))).toHaveLength(BOUNDARY_COUNT);
  });
  it.each(boundaries.map((f) => [relative(APP_DIR, f), f] as const))("%s", async (_n, file) => {
    const Comp = (await import(/* @vite-ignore */ file)).default as ErrorComponent;
    const refresh = mountThroughNext(Comp);
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(refresh).toHaveBeenCalledTimes(1);
  });
  it("harness self-check: a button wired to reset() does NOT reach router.refresh", () => {
    const refresh = mountThroughNext((({ reset }: { reset: () => void }) => (
      <button onClick={() => reset()}>Try again</button>
    )) as unknown as ErrorComponent);
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(refresh).not.toHaveBeenCalled();
  });
  it(`no file under src/app reads ${OLD}`, () => {
    const hits = walk(APP_DIR, (n) => /\.(ts|tsx)$/.test(n)).filter((f) =>
      readFileSync(f, "utf8").includes(OLD),
    );
    expect(hits.map((f) => relative(APP_DIR, f))).toEqual([]);
  });
});
```
Notes the planner needs:
- `ErrorInfo.error` is typed `unknown` and `ErrorComponent = React.ComponentType<ErrorInfo>` `[VERIFIED: node_modules/next/dist/client/components/error-boundary.d.ts:2-7 "error: unknown; reset: () => void; retry: () => void;" / "export type ErrorComponent = React.ComponentType<ErrorInfo>;"]`. The boundaries type `error: Error & { digest?: string }`, so a cast (`as ErrorComponent`) is required. With that cast, `npx tsc --noEmit -p .` reported nothing for the file and `npx eslint` on it was clean `[VERIFIED: ran both this session]`.
- The `it.each` name is the boundary's relative path, so a RED run names the reverted boundary (observed: `× (dashboard)/admin/error.tsx`).
- Use the `{ refresh } as never` cast: `AppRouterInstance` has many members and only `refresh` is read by `retry`.

### Anti-Patterns to Avoid
- **Asserting the prop by name on a hand-built props bag only:** passes while the real bug exists (this is why the eight colocated tests missed it).
- **Writing the literal `unstable_retry` in the new test:** it would trip its own static arm if the test ever lived under `src/app`. Use the join trick shown, or exclude the file.
- **`reset`-based Try again for server-throw boundaries:** re-renders the same failed result (docs, D-01).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Props Next passes to an error component | A fake `{ error, reset, retry }` literal in the test | Next's real `ErrorBoundary` | The fake is exactly what hid this bug for the colocated tests |
| Finding all boundaries | A hard-coded file list | fs walk of `src/app` + pinned count | A new boundary is covered automatically; a removed one fails the count |
| A shared `ErrorProps` type or retry helper | New abstraction | Ten inline `retry: () => void` props (D-02) | Locked by D-02 |

**Key insight:** the only trustworthy source of the props contract is Next's own `error-boundary.js`; mount it.

## Common Pitfalls

### Pitfall 1: Typing the colocated tests after D-02
**What goes wrong:** D-09 wants colocated tests to pass `retry` AND `reset` and assert `reset` is not called. D-02 types the boundary props as `{ error; retry }` only, so `<Boundary error={e} retry={r} reset={x} />` is an excess-property type error (the factsheet boundary avoids this by declaring `reset: () => void` too `[VERIFIED: src/app/factsheet/[id]/error.tsx props block]`).
**How to avoid (pick one in the plan):** (a) build a props object and spread it (`const props = { error, retry, reset }; <Boundary {...props} />`; spread attributes skip excess-property checks `[ASSUMED]`, run `tsc` to confirm), keeping D-02 literal; or (b) follow the factsheet precedent and add `reset: () => void` to each props type, which deviates from D-02's "in place of" and should be surfaced to the user, not done silently. Recommendation: (a).
**Warning signs:** `tsc` error "Property 'reset' does not exist on type ..." in a colocated test.

### Pitfall 2: Uncaught exceptions, not just assertion failures, mark the run red
**What goes wrong:** with the old code, the click throws inside a React event handler; vitest prints `Uncaught Exception ... TypeError: unstable_retry is not a function` in addition to the assertion failure. That is expected evidence of RED, not a harness fault.
**How to avoid:** none needed; do not wrap the click in try/catch.

### Pitfall 3: The self-referential static arm
**What goes wrong:** D-07 scans `src/app` including test files. The eight colocated tests currently contain `unstable_retry` across 17 files (9 boundaries + 8 tests, listed below); the static arm is RED until every one is updated, including prose in test titles and doc comments (e.g. `admin/error.test.tsx:11`, `allocations/error.test.tsx:6`, `compare/error.test.tsx:7`).
**How to avoid:** `grep -rn unstable_retry src/app` must be empty before the arm goes green. Test titles such as "Try again button invokes unstable_retry() once" must be reworded.

### Pitfall 4: Planning anchors
**What goes wrong:** `plan-anchor-verify` re-resolves every `file:line` anchor a pending PLAN.md asserts (CLAUDE.md). The line numbers in this file's boundary list are from base `7a229d27f` and move after the edit.
**How to avoid:** cite plan anchors by symbol (e.g. "the `unstable_retry` destructure in `AdminError`"), not by line.

### Pitfall 5: Doc / mapper files still describe the old contract
`.planning/codebase/CONVENTIONS.md:190` and `.planning/codebase/ARCHITECTURE.md:249` say `unstable_retry`. They are not under `src/app`, so SC-1 does not require touching them. Out of D-04's scope ("No other comment is touched"); mention to the user as optional doc staleness, do not edit in this phase unless asked.

## Code Examples

### The Next contract (source of truth)
```js
// node_modules/next/dist/client/components/error-boundary.js:43-48 and :110-115 (read this session)
this.retry = ()=>{
    (0, _react.startTransition)(()=>{
        this.context?.refresh();
        this.reset();
    });
};
...
(0, _jsxruntime.jsx)(this.props.errorComponent, {
    error: thrownValue,
    reset: this.reset,
    retry: this.retry
})
```

### Boundary edit (all nine, same shape)
```tsx
export default function CompareError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  ...
  <Button onClick={() => retry()}>Try again</Button>
```
`global-error.tsx` is the only one using a raw `<button onClick={() => unstable_retry()}>`; same rename.

## Inventory of edits (measured at base 7a229d27f, worktree `quantalyze-207`)

**Boundaries that read `unstable_retry` (9)** `[VERIFIED: grep -rIl unstable_retry src/app]`:
`src/app/error.tsx`, `src/app/global-error.tsx`, `src/app/(auth)/error.tsx`, `src/app/(dashboard)/error.tsx`, `src/app/(dashboard)/admin/error.tsx`, `src/app/(dashboard)/allocations/error.tsx`, `src/app/(dashboard)/compare/error.tsx`, `src/app/(dashboard)/strategies/error.tsx`, `src/app/(dashboard)/strategies/new/wizard/error.tsx`.
Already correct (1): `src/app/factsheet/[id]/error.tsx` (destructures `retry`, declares `reset`).
Total boundaries discovered by fs walk: 10 (the spike printed 11 tests = 1 count test + 10 boundaries, 9 failed + 2 passed where the 2 were the count test and factsheet).

**Comments asserting the old contract (D-04 scope)**, i.e. prose containing `unstable_retry` inside the boundary files: `(dashboard)/admin/error.tsx:11`, `(dashboard)/strategies/error.tsx:13`, `(dashboard)/strategies/new/wizard/error.tsx:13`, `(dashboard)/allocations/error.tsx:15` (says "`unstable_retry` (Next 16.2.0 — NOT the legacy `reset`)"), `(dashboard)/compare/error.tsx:12` (says "`unstable_retry` (Next 16.2.0)"). The CONTEXT names only admin and wizard; the strategies, allocations and compare comments carry the same claim and must be fixed too or SC-1's static arm stays RED. Note that `(dashboard)/strategies/error.tsx`, admin, wizard and allocations headers also say "NOT `reset`", which is now correct in meaning; only the prop name needs to change.

**Colocated tests that mention `unstable_retry` (8 files)**: `src/app/error.test.tsx` (4 render sites, no Try again click test), `src/app/global-error.test.tsx` (2 render sites, no click test; mounts `<GlobalError>` inside `act` with `@sentry/nextjs` mocked), `(auth)/error.test.tsx` (3 sites, no click test), `(dashboard)/strategies/error.test.tsx` (title "Try again button invokes unstable_retry() once"), `(dashboard)/strategies/new/wizard/error.test.tsx` (same title), `(dashboard)/admin/error.test.tsx` (header line 11 and a click test), `(dashboard)/allocations/error.test.tsx` (header, Test 2), `(dashboard)/compare/error.test.tsx` (header, Test 2). `(dashboard)/error.tsx` has NO colocated test, so it is covered only by the new cross-boundary test.
D-09 says each should "assert Try again calls `retry` and not `reset`". Only five of the eight (admin, allocations, compare, strategies, wizard) currently have a click arm to adapt. For root `error.test.tsx`, `global-error.test.tsx` and `(auth)/error.test.tsx` the click arm would be a NEW arm; the cross-boundary test already covers them, so the minimal reading is "rename the prop in those three, add a click arm only if the plan wants D-09 literally". Flag to planner.

**Other references** `[VERIFIED: grep -rIl unstable_retry . excluding node_modules/.next/.git]`: `CHANGELOG.md`, `TODOS.md` (entry `196-ERROR-BOUNDARY-UNSTABLE-RETRY-01` at line 1267, to be closed/removed by the repo's ship process), `.planning/**` history, `.planning/codebase/CONVENTIONS.md`, `.planning/codebase/ARCHITECTURE.md`. No lint rule, no `src/__tests__` census, no script and no `tools/eslint-plugin-quantalyze` rule references `unstable_retry` (the grep over `src scripts tests tools` outside the boundary files returned only `src/app/layout.tsx` and `src/__tests__/figure-parity-pages.test.tsx`, both prose mentions of "error boundary" / `global-error`, not the prop).
`src/__tests__/role-home-call-sites.test.ts` lists seven of these `error.tsx` paths (lines ~125-156) for its ROLE_HOME-route call-site allowlist; it does not read the retry prop, and the edit does not change any route constant, so it is expected unaffected. Run it as part of the full suite to confirm (`npx vitest run src/__tests__/role-home-call-sites.test.ts`); I did not run it.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `reset()` | `retry()` (re-fetch + re-render) | `unstable_retry` added v16.2.0, `retry` stable v16.3.0 `[VERIFIED: node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/error.md:331-332]` | Server-component throws can recover |

**Deprecated/outdated:** `unstable_retry` — in 16.4.2 the installed `error-boundary.js` never passes it, confirmed at runtime by the spike (`TypeError: unstable_retry is not a function`).

## Runtime State Inventory

Not a rename/migration phase in the data sense (a prop-name correction in source). Categories answered explicitly:

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — no datastore keys the prop name | none |
| Live service config | None | none |
| OS-registered state | None | none |
| Secrets/env vars | None | none |
| Build artifacts | `.next/` may hold stale compiled boundaries | none (rebuilt by the normal build; not committed) |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | JSX spread attributes skip TypeScript's excess-property check, so colocated tests can pass `reset` without adding it to the boundary prop types | Pitfall 1 | Planner picks (a), `tsc` fails; fall back to (b) and tell the user it deviates from D-02. Cheap to check with one `tsc` run. |

All other claims in this document were verified by running code or reading the cited file this session.

## Open Questions

1. **D-09 literal reading for the three tests with no click arm (root `error.test.tsx`, `global-error.test.tsx`, `(auth)/error.test.tsx`)**
   - What we know: only five colocated tests have a Try again click arm; the cross-boundary test covers all ten.
   - What's unclear: whether D-09 means "add a click arm to all eight".
   - Recommendation: rename the prop in these three and rely on the cross-boundary test. Adding a click arm to `global-error.test.tsx` and root `error.test.tsx` is cheap (`fireEvent.click(screen.getByRole("button", { name: /try again/i }))`) if the plan wants D-09 literal.
2. **Typing of `reset` in colocated tests** — see Pitfall 1 (spread vs adding `reset` to prop types).

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| node + npm, installed `node_modules` | all test runs | yes | (installed in worktree) | — |
| vitest | tests | yes | 5.0.5 | — |
| `next/dist/client/components/error-boundary` and `.../shared/lib/app-router-context.shared-runtime` | harness | yes | next 16.4.2 | — |

No missing dependencies. No network, database or CI-secret dependency.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 5.0.5 + @testing-library/react 16 + jsdom 30 |
| Config file | `vitest.config.ts` (two projects: `jsdom` default, `node` opt-in list) |
| Quick run command | `npx vitest run src/__tests__/error-boundaries-retry.test.tsx --project jsdom` |
| Colocated run | `npx vitest run src/app --project jsdom` |
| Full suite command | `npm test` (shards in CI via `frontend-test`; coverage merged by `frontend-coverage`) |

Collection facts: `INCLUDE` contains `"src/**/*.test.{ts,tsx}"`, and the jsdom project's include is that list minus `NODE_ENV_TEST_FILES` and `LOCAL_STACK_LANE_FILES` `[VERIFIED: vitest.config.ts:14-16 and the projects block]`. A new `src/__tests__/*.test.tsx` jsdom file is collected with no registration (the spike ran under `--project jsdom`). Do NOT add it to `vitest.node-env.ts` (it needs a DOM). Coverage is v8 and only counts loaded source files; thresholds in `vitest.config.ts` are `lines: 82, functions: 74, branches: 72, statements: 80`. The new test only increases coverage of the boundary files, so no ratchet change is needed `[VERIFIED: vitest.config.ts coverage block]`.

### Phase Requirements -> Test Map
| Req | Behavior | Test Type | Automated Command | File Exists? |
|-----|----------|-----------|-------------------|-------------|
| SC-2 | Each of the 10 boundaries, mounted in Next's real `ErrorBoundary`, calls `router.refresh` when Try again is clicked | integration (jsdom) | `npx vitest run src/__tests__/error-boundaries-retry.test.tsx --project jsdom` | Wave 0 (new) |
| SC-2 | Harness can tell `reset` from `retry` | same file, self-check arm | same | Wave 0 (new) |
| SC-2 | Boundary count pinned at 10 (new/removed boundary noticed) | same file | same | Wave 0 (new) |
| SC-1 | No `unstable_retry` under `src/app` | same file, static arm | same | Wave 0 (new) |
| D-09 | Colocated tests pass `retry`+`reset` and assert `retry` called, `reset` not | unit | `npx vitest run src/app --project jsdom` | exists, to update |

### Measured results (this session, throwaway files all deleted; `git status --short` clean except RESEARCH.md afterwards)
| Scenario | Result |
|----------|--------|
| Proposed test, unmodified base (9 boundaries on `unstable_retry`) | RED: 10 failed, 3 passed. Nine `× <path>` boundary arms with `AssertionError: expected "vi.fn()" to be called 1 times, but got 0 times` plus nine `Uncaught Exception: TypeError: unstable_retry is not a function`, and the static arm failing with the list of the 17 files containing the string (`expected [ '(auth)/error.test.tsx', …(16) ] to deeply equal []`). Count arm, factsheet arm and self-check arm passed. |
| Same test in a scratch copy with `unstable_retry` renamed to `retry` everywhere in `src/app` | GREEN: `Tests  13 passed (13)` |
| Scratch copy, one boundary (`(dashboard)/admin/error.tsx`) put back to `unstable_retry` | RED: exactly `× (dashboard)/admin/error.tsx` (`TypeError: unstable_retry is not a function`) and `× no file under src/app reads unstable_retry` (`[ '(dashboard)/admin/error.tsx' ]`); 11 other tests passed. This is the D-08 demonstration, and it names the reverted boundary. |
| Scratch copies of each of the nine boundaries with `unstable_retry` replaced by `reset` | RED, 9 of 9: `expected "vi.fn()" to be called 1 times, but got 0 times` (so `reset` alone does not satisfy the assertion) |
| Same copies with `retry` | 9 of 9 passed, with a SYNCHRONOUS `expect(refresh).toHaveBeenCalledTimes(1)` straight after `fireEvent.click` (no `waitFor`, no explicit `act`) |

The scratch copy for GREEN used `rsync` of `src/` plus config into the scratchpad with a `node_modules` symlink, so no worktree source file was edited.

### How the executor does D-08 for real
Back up one boundary byte-for-byte (`cp -p "src/app/(dashboard)/compare/error.tsx" <scratchpad>/compare-error.bak`), `sed` the three `retry` tokens back to `unstable_retry`, run the quick command, see `× (dashboard)/compare/error.tsx` and the static arm RED, then `cp -p` the backup over it and re-run GREEN. Never `git checkout`/`restore`/`stash` (project rule).

### Sampling Rate
- **Per task commit:** the quick run command (about 1 s once transformed; first run took ~11 s while the spike warmed up) plus `npx vitest run src/app --project jsdom` after touching boundaries/tests.
- **Per wave merge:** `npx tsc --noEmit -p .` (about 30 s here) and `npx eslint` on touched files (clean on the new test), then the colocated run.
- **Phase gate:** full suite green before `/gsd-verify-work`.

### Wave 0 Gaps
- [ ] `src/__tests__/error-boundaries-retry.test.tsx` — covers SC-1 and SC-2 (code above, verified).
- No framework install, no config change, no fixture needed.

## Security Domain

`security_enforcement` not disabled in the inputs given; applicable scope is tiny.

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | — |
| V3 Session Management | no | — |
| V4 Access Control | no | — |
| V5 Input Validation | no | — |
| V6 Cryptography | no | — |
| V7 Error Handling and Logging | yes (unchanged) | Digest-only on screen, never `error.message`; D-03 keeps it byte-identical. The new test does not weaken it. `compare/error.tsx` header cites T-52-09 / V7 for this. |

### Known Threat Patterns
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Server error message disclosed to the client | Information Disclosure | Show `error.digest` only (existing); do not touch while renaming the prop |

## Sources

### Primary (HIGH confidence)
- `node_modules/next/dist/client/components/error-boundary.js` (read in full): props passed, `retry` body, `isBotUserAgent`, `useUntrackedPathname`.
- `.../next/dist/client/components/error-boundary.d.ts`: `ErrorInfo`, `ErrorComponent` types.
- `.../next/dist/client/components/navigation-untracked.js`: `useUntrackedPathname` is `useContext(PathnameContext)` (returns `null` with no provider, which is fine; only `hasFallbackRouteParams()` on the server side branches, and under jsdom `window` exists so it returns false).
- `.../next/dist/docs/01-app/03-api-reference/03-file-conventions/error.md` lines 117-200, 331-332 (retry vs reset guidance, version table).
- Spike runs listed in Validation Architecture (executed this session).
- `vitest.config.ts` (read in full).

### Secondary / Tertiary
None used.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new packages; versions read from installed files.
- Architecture (harness): HIGH — RED and GREEN both demonstrated by execution.
- Pitfalls: HIGH for inventory and typing of `ErrorInfo`; MEDIUM for the spread-attribute typing claim (A1).

**Specific answers to the D-05 questions:** (1) `useUntrackedPathname` needs no provider (null pathname works). (2) `handleISRError` and `isBot` do not trip under jsdom (the click was reached on all ten boundaries; jsdom's userAgent is not a bot). (3) `retry`'s `startTransition` runs synchronously inside `fireEvent` (which RTL wraps in `act`), so a synchronous assertion passed without `waitFor` (use `waitFor` only if a future boundary awaits something). (4) `global-error.tsx`: mount it like every other boundary inside the default RTL container with `console.error` suppressed (React warns about `<html>` nested in `<div>`, which existing `global-error.test.tsx` already tolerates); no special container was needed and the button was found via `getByRole("button", { name: /try again/i })`.

**Research date:** 2026-11-14
**Valid until:** until the Next version changes (re-read `error-boundary.js` on any `next` upgrade; the new test will itself go RED if Next stops passing `retry`).
