/**
 * Phase 52 / Plan 52-03 / Task 2 — compare route error.tsx contract.
 *
 * The route's error boundary is a client component that renders when the
 * compare server component throws. These tests pin the STATE-01 / T-52-09
 * contract: it renders the heading + recovery copy, the retry button invokes
 * `unstable_retry`, the digest (not the message) is the only error detail
 * surfaced, and the thrown error is logged on mount.
 *
 * Modeled on src/app/strategy/[id]/v2/error.test.tsx (route-file render test).
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
  }: {
    href: string;
    children: React.ReactNode;
  }) => (
    <a href={href} data-testid="next-link">
      {children}
    </a>
  ),
}));

import CompareError from "./error";

describe("compare/error.tsx — STATE-01 boundary contract", () => {
  it("Test 1: renders the 'Something went wrong' heading + recovery body copy", () => {
    const err = Object.assign(new Error("boom"), { digest: "d-1" });
    render(<CompareError error={err} unstable_retry={vi.fn()} />);

    expect(
      screen.getByRole("heading", { name: /Something went wrong/i }),
    ).toBeTruthy();
    expect(
      screen.getByText(/This section encountered an error/i),
    ).toBeTruthy();
  });

  it("Test 2: the 'Try again' button invokes unstable_retry()", () => {
    const retry = vi.fn();
    const err = Object.assign(new Error("boom"), { digest: "d-2" });
    render(<CompareError error={err} unstable_retry={retry} />);

    fireEvent.click(screen.getByRole("button", { name: /Try again/ }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("Test 3: shows the digest only — never the raw error.message (T-52-09)", () => {
    const err = Object.assign(new Error("SENSITIVE-server-stack-detail"), {
      digest: "d-3",
    });
    render(<CompareError error={err} unstable_retry={vi.fn()} />);

    // The digest is surfaced as the only diagnostic …
    expect(screen.getByText(/Error ID: d-3/)).toBeTruthy();
    // … and the raw server-side message is NOT leaked to the client.
    expect(
      screen.queryByText(/SENSITIVE-server-stack-detail/),
    ).toBeNull();
  });

  it("Test 4: no digest → no Error ID line (digest-only, gracefully absent)", () => {
    const err = new Error("boom"); // no digest
    render(<CompareError error={err} unstable_retry={vi.fn()} />);
    expect(screen.queryByText(/Error ID:/)).toBeNull();
  });

  it("Test 5: console.error fires with the [compare-error] tag + the thrown error on mount", () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const err = Object.assign(new Error("paint failed"), { digest: "d-5" });
    render(<CompareError error={err} unstable_retry={vi.fn()} />);

    expect(errSpy).toHaveBeenCalledWith("[compare-error]", err);
    errSpy.mockRestore();
  });
});
