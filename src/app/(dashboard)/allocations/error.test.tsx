/**
 * Phase 52-02 / STATE-02 / ASVS V7 — `/allocations/error.tsx` boundary contract.
 *
 * The route's error boundary is a client component that renders when the
 * allocations server component throws (auth failure, payload-query error, a
 * nested tab crash). It mirrors the dashboard `error.tsx`: `unstable_retry`
 * (not the legacy `reset`), a digest-only render (NEVER `error.message` — the
 * RSC-message strip that prevents server-detail leaks), and the 52-UI-SPEC
 * error copy. These tests pin those invariants and keep the new file inside the
 * blocking coverage gate.
 *
 * Modeled on `src/app/strategy/[id]/v2/error.test.tsx`.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    className,
  }: {
    href: string;
    children: React.ReactNode;
    className?: string;
  }) => (
    <a href={href} className={className} data-testid="next-link">
      {children}
    </a>
  ),
}));

import AllocationsError from "./error";

describe("/allocations/error.tsx — route boundary contract (STATE-02 / ASVS V7)", () => {
  it("Test 1: renders the 'Something went wrong' heading + recovery copy + retry CTA", () => {
    const err = Object.assign(new Error("boom"), { digest: "d-1" });
    render(<AllocationsError error={err} unstable_retry={vi.fn()} />);

    expect(
      screen.getByRole("heading", { name: /something went wrong/i }),
    ).toBeTruthy();
    expect(
      screen.getByText(/This section encountered an error/i),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /try again/i }),
    ).toBeTruthy();
  });

  it("Test 2: the retry button invokes unstable_retry()", () => {
    const retry = vi.fn();
    const err = Object.assign(new Error("boom"), { digest: "d-2" });
    render(<AllocationsError error={err} unstable_retry={retry} />);

    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("Test 3: renders the digest as 'Error ID' but NEVER the error.message (ASVS V7 / T-52-05)", () => {
    const err = Object.assign(new Error("SENSITIVE_SERVER_DETAIL_xyz"), {
      digest: "abc123digest",
    });
    render(<AllocationsError error={err} unstable_retry={vi.fn()} />);

    // The digest (server-log correlation id) IS shown…
    expect(screen.getByText(/Error ID: abc123digest/)).toBeTruthy();
    // …but the raw error message must NEVER reach the client boundary.
    expect(screen.queryByText(/SENSITIVE_SERVER_DETAIL_xyz/)).toBeNull();
  });

  it("Test 4: omits the Error ID line when no digest is present", () => {
    const err = new Error("boom"); // no digest
    render(<AllocationsError error={err} unstable_retry={vi.fn()} />);
    expect(screen.queryByText(/Error ID:/)).toBeNull();
  });

  it("Test 5: console.error fires with a tagged label + the thrown error on mount", () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const err = Object.assign(new Error("paint failed"), { digest: "d-5" });
    render(<AllocationsError error={err} unstable_retry={vi.fn()} />);

    expect(errSpy).toHaveBeenCalledWith("[allocations-error]", err);
    errSpy.mockRestore();
  });
});
