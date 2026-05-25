import { describe, it, expect } from "vitest";
import type { ComponentType } from "react";

import { WIDGET_COMPONENTS } from "./index";

// ---------------------------------------------------------------------------
// M-0171 — Lazy-import barrel contract.
//
// `WIDGET_COMPONENTS` maps every widgetId to a `React.lazy(() => import(...))`
// entry. Entries whose source module uses a NAMED export are wired with a
// `.then((m) => ({ default: m.SomeName }))` adapter. A copy-paste typo in
// that adapter (wrong named export, or a default that doesn't exist) ships at
// runtime as a Suspense throw caught by the WidgetErrorBoundary — with NO
// unit-test failure today.
//
// This test invokes each barrel entry's actual import loader (the function
// React.lazy stored) and asserts the resolved module exposes a renderable
// default export. Because it runs the barrel's OWN loader (including the
// named-export `.then` mapping), a broken mapping surfaces here loudly
// instead of silently degrading to the error boundary in production.
// ---------------------------------------------------------------------------

/**
 * React.lazy stores the original loader on `lazyComponent._payload._result`
 * (before the payload is initialized). We pull it out and call it to obtain
 * the import promise — this is exactly the loader the barrel defined, so the
 * `.then((m) => ({ default: m.Name }))` adapter (where present) runs too.
 */
function loaderOf(
  lazyComponent: unknown,
): () => Promise<{ default: ComponentType<unknown> }> {
  const payload = (
    lazyComponent as { _payload?: { _result?: unknown } } | null
  )?._payload;
  const result = payload?._result;
  if (typeof result !== "function") {
    throw new Error(
      "Could not extract the React.lazy loader — React internals shape " +
        "changed (expected lazy._payload._result to be the loader fn). " +
        "Update this contract test's loaderOf() accessor.",
    );
  }
  return result as () => Promise<{ default: ComponentType<unknown> }>;
}

describe("M-0171 — WIDGET_COMPONENTS lazy barrel resolves to real default exports", () => {
  const ids = Object.keys(WIDGET_COMPONENTS);

  it("registers a non-empty set of widget ids", () => {
    // Guards against an accidental barrel wipe that would make the per-id
    // loop below vacuously pass (zero iterations).
    expect(ids.length).toBeGreaterThan(0);
  });

  it.each(ids)(
    "barrel entry '%s' resolves to a renderable default export",
    async (id) => {
      const loader = loaderOf(WIDGET_COMPONENTS[id]);
      const mod = await loader();
      // The resolved module MUST expose a `default` that React can mount —
      // i.e. a function (function component, forwardRef object, or memo
      // object). A `.then((m) => ({ default: m.WrongName }))` typo yields
      // `default === undefined` and fails here.
      expect(mod).toBeTruthy();
      const def = (mod as { default?: unknown }).default;
      const renderable =
        typeof def === "function" ||
        (typeof def === "object" && def !== null && "$$typeof" in def);
      expect(renderable).toBe(true);
    },
  );
});
