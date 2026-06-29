import { afterEach, describe, expect, it, vi } from "vitest";
import { withViewTransition } from "./view-transition";

/**
 * The helper wraps the NATIVE `document.startViewTransition` API (the phase
 * decision — no React `<ViewTransition>`, no `experimental.viewTransition`
 * flag). It must degrade to an instant `update()` when the API is unsupported
 * or the user prefers reduced motion. jsdom implements neither
 * `document.startViewTransition` nor `window.matchMedia`, so each branch is
 * driven by stubbing exactly those two globals.
 */

type MatchMediaStub = (query: string) => Pick<MediaQueryList, "matches">;

function stubMatchMedia(prefersReducedMotion: boolean) {
  const stub: MatchMediaStub = () => ({ matches: prefersReducedMotion });
  vi.stubGlobal("matchMedia", stub);
  // jsdom's `window` and the global object are the same target under the
  // jsdom environment, so `window.matchMedia` resolves to the stub too.
}

describe("withViewTransition", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    // `startViewTransition` is patched directly onto the live document.
    delete (document as Partial<Document>).startViewTransition;
  });

  it("runs the update via startViewTransition when supported and motion is allowed", () => {
    const update = vi.fn();
    const startViewTransition = vi.fn((cb: () => void) => {
      cb();
      return {} as ViewTransition;
    });
    (document as Document).startViewTransition = startViewTransition as Document["startViewTransition"];
    stubMatchMedia(false);

    withViewTransition(update);

    expect(startViewTransition).toHaveBeenCalledTimes(1);
    expect(startViewTransition).toHaveBeenCalledWith(update);
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("falls back to an instant update under prefers-reduced-motion", () => {
    const update = vi.fn();
    const startViewTransition = vi.fn();
    (document as Document).startViewTransition = startViewTransition as Document["startViewTransition"];
    stubMatchMedia(true);

    withViewTransition(update);

    expect(startViewTransition).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("falls back to an instant update when startViewTransition is unsupported", () => {
    const update = vi.fn();
    // No `document.startViewTransition` assigned — the unsupported path.
    stubMatchMedia(false);

    expect(() => withViewTransition(update)).not.toThrow();
    expect(update).toHaveBeenCalledTimes(1);
  });
});
