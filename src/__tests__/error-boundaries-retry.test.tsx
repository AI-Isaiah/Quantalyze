/** @vitest-environment jsdom */
/**
 * Phase 207 RETRYPROP (D-05 to D-07) — every error boundary's Try again works.
 *
 * Why this file exists: the colocated boundary tests hand each component its
 * props directly, so a boundary can destructure a prop Next never passes and
 * still go green. That is how nine boundaries shipped a Try again button that
 * threw "is not a function" in production. This file mounts every boundary
 * inside Next's REAL `ErrorBoundary`, so the props come from Next's own code,
 * not from the test, and asserts the router `refresh` spy fires when Try again
 * is clicked (Next's `retry` calls `router.refresh()` then clears boundary
 * state; `reset` alone only clears state).
 *
 * The boundary list is discovered from the filesystem and its count is pinned
 * (BOUNDARY_COUNT): a new boundary is covered automatically, a removed one
 * fails the count (a vacuity fence). D-05's primary path shipped: the real
 * `ErrorBoundary`; the hand-built-props fallback was not needed.
 *
 * The harness imports two Next-internal module paths. A Next upgrade that
 * moves them fails this file loudly at import. Re-read
 * `next/dist/client/components/error-boundary.js` on any `next` upgrade.
 */
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
// Built by join so this file does not itself contain the removed prop's literal name.
const OLD = ["unstable", "retry"].join("_");

function walk(
  dir: string,
  accept: (name: string) => boolean,
  out: string[] = [],
): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, accept, out);
    else if (accept(name)) out.push(p);
  }
  return out;
}
const boundaries = walk(
  APP_DIR,
  (n) => n === "error.tsx" || n === "global-error.tsx",
).sort();

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
    expect(boundaries.map((f) => relative(APP_DIR, f))).toHaveLength(
      BOUNDARY_COUNT,
    );
  });

  it.each(boundaries.map((f) => [relative(APP_DIR, f), f] as const))(
    "%s",
    async (_name, file) => {
      const Comp = (await import(/* @vite-ignore */ file))
        .default as ErrorComponent;
      const refresh = mountThroughNext(Comp);
      fireEvent.click(screen.getByRole("button", { name: /try again/i }));
      expect(refresh).toHaveBeenCalledTimes(1);
    },
  );

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
