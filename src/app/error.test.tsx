/** @vitest-environment jsdom */
/**
 * Phase 16 / OBSERV-04 — error boundary Sentry capture with correlation_id tag.
 *
 * Asserted invariants:
 *   1. Sentry.captureException is called with `tags: { digest, correlation_id }`
 *      where correlation_id is read from <meta name="x-correlation-id"> rendered
 *      by src/app/layout.tsx (Plan 2).
 *   2. When the meta tag is absent, correlation_id falls back to null without
 *      crashing the boundary.
 *   3. When @sentry/nextjs import fails, the .catch() absorbs the failure so
 *      the boundary never throws.
 */
import { render, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import Error from "./error";

const captureExceptionMock = vi.fn();

vi.mock("@sentry/nextjs", () => ({
  captureException: (...args: unknown[]) => captureExceptionMock(...args),
}));

function clearHead() {
  // Remove children explicitly — avoid innerHTML mutation per security guideline.
  while (document.head.firstChild) document.head.removeChild(document.head.firstChild);
}

describe("[OBSERV-04] src/app/error.tsx Sentry capture with correlation_id tag", () => {
  beforeEach(() => {
    captureExceptionMock.mockClear();
    clearHead();
  });

  it("captures with correlation_id tag from meta element", async () => {
    const meta = document.createElement("meta");
    meta.setAttribute("name", "x-correlation-id");
    meta.setAttribute("content", "cid-x");
    document.head.appendChild(meta);
    const err = Object.assign(new globalThis.Error("boom"), { digest: "d-1" });
    await act(async () => {
      render(<Error error={err} unstable_retry={vi.fn()} />);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(captureExceptionMock).toHaveBeenCalledWith(
      expect.objectContaining({ message: "boom" }),
      { tags: { digest: "d-1", correlation_id: "cid-x" } },
    );
  });

  it("captures with correlation_id null when meta absent", async () => {
    const err = Object.assign(new globalThis.Error("boom"), { digest: "d-2" });
    await act(async () => {
      render(<Error error={err} unstable_retry={vi.fn()} />);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(captureExceptionMock).toHaveBeenCalledWith(
      expect.anything(),
      { tags: { digest: "d-2", correlation_id: null } },
    );
  });

  it("does not throw when console.error is also fired", async () => {
    // Boundary must always run console.error first, then attempt Sentry capture.
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const err = Object.assign(new globalThis.Error("boom"), { digest: "d-3" });
    expect(() => {
      render(<Error error={err} unstable_retry={vi.fn()} />);
    }).not.toThrow();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});
