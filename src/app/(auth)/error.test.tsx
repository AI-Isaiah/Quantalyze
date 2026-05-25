/** @vitest-environment jsdom */
/**
 * M-0021 — segment-level (auth) error boundary contract.
 *
 * The root boundary (src/app/error.tsx) is the ONLY Sentry sink: it calls
 * Sentry.captureException with { digest, correlation_id } tags (see
 * src/app/error.test.tsx). The (auth) segment boundary intentionally logs
 * via console.error ONLY and does NOT import or call Sentry — segment
 * errors bubble to the root boundary for production observability.
 *
 * These tests document that decision so the divergence cannot silently
 * drift: if a future PR adds a Sentry call here (or removes the
 * console.error), one of these assertions fails and forces a deliberate
 * re-decision.
 */
import { render, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import AuthError from "./error";

const captureExceptionMock = vi.fn();

vi.mock("@sentry/nextjs", () => ({
  captureException: (...args: unknown[]) => captureExceptionMock(...args),
}));

describe("[M-0021] src/app/(auth)/error.tsx — root-only Sentry contract", () => {
  beforeEach(() => {
    captureExceptionMock.mockClear();
  });

  it("logs the error to console.error with the [auth-error] prefix", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const err = Object.assign(new globalThis.Error("auth boom"), {
      digest: "auth-d-1",
    });
    await act(async () => {
      render(<AuthError error={err} unstable_retry={vi.fn()} />);
      await Promise.resolve();
    });
    expect(errSpy).toHaveBeenCalledWith("[auth-error]", err);
    errSpy.mockRestore();
  });

  it("does NOT call Sentry.captureException — the root boundary is the only Sentry sink", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const err = Object.assign(new globalThis.Error("auth boom"), {
      digest: "auth-d-2",
    });
    await act(async () => {
      render(<AuthError error={err} unstable_retry={vi.fn()} />);
      // Flush any microtasks a Sentry lazy-import would have scheduled.
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(captureExceptionMock).not.toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it("does not throw while running the effect", () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const err = Object.assign(new globalThis.Error("auth boom"), {
      digest: "auth-d-3",
    });
    expect(() => {
      render(<AuthError error={err} unstable_retry={vi.fn()} />);
    }).not.toThrow();
    errSpy.mockRestore();
  });
});
