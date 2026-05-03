/** @vitest-environment jsdom */
/**
 * Phase 16 / OBSERV-04 — global root error boundary Sentry capture.
 *
 * Mirrors error.test.tsx for the GlobalError component. GlobalError renders
 * its own <html>+<body> because the root layout is replaced when this runs;
 * we don't inspect the rendered DOM, only the captureException side-effect.
 */
import { render, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import GlobalError from "./global-error";

const captureExceptionMock = vi.fn();

vi.mock("@sentry/nextjs", () => ({
  captureException: (...args: unknown[]) => captureExceptionMock(...args),
}));

function clearHead() {
  while (document.head.firstChild) document.head.removeChild(document.head.firstChild);
}

describe("[OBSERV-04] src/app/global-error.tsx Sentry capture with correlation_id tag", () => {
  beforeEach(() => {
    captureExceptionMock.mockClear();
    clearHead();
    // Suppress React warning about <html> inside <body> from GlobalError —
    // we don't inspect DOM, only the captureException call shape.
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("captures with correlation_id tag from meta element", async () => {
    const meta = document.createElement("meta");
    meta.setAttribute("name", "x-correlation-id");
    meta.setAttribute("content", "cid-global");
    document.head.appendChild(meta);
    const err = Object.assign(new globalThis.Error("boom"), { digest: "g-1" });
    await act(async () => {
      render(<GlobalError error={err} unstable_retry={vi.fn()} />);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(captureExceptionMock).toHaveBeenCalledWith(
      expect.objectContaining({ message: "boom" }),
      { tags: { digest: "g-1", correlation_id: "cid-global" } },
    );
  });

  it("captures with correlation_id null when meta absent", async () => {
    const err = Object.assign(new globalThis.Error("boom"), { digest: "g-2" });
    await act(async () => {
      render(<GlobalError error={err} unstable_retry={vi.fn()} />);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(captureExceptionMock).toHaveBeenCalledWith(
      expect.anything(),
      { tags: { digest: "g-2", correlation_id: null } },
    );
  });
});
