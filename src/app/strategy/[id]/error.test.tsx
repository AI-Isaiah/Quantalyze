/**
 * Phase 52 / Plan 52-05 / Task 2 — strategy/[id] route-level error.tsx contract.
 *
 * The route's error boundary is a client component that renders when ANY server
 * component in the /strategy/[id] subtree throws (e.g. getPublicStrategyDetail
 * failure, RLS denial, malformed id). This is the subtree-wide sibling boundary
 * — distinct from the `v2/error.tsx` child (covered by its own SR-3 spec).
 *
 * Tests cover (STATE-01 / T-52-15):
 *  1. Renders the heading + body copy + both CTAs
 *  2. Try-again button invokes unstable_retry() (recovery affordance)
 *  3. console.error fires with the thrown error on mount (diagnostics)
 *  4. digest-ONLY: the digest hash is shown, the raw error.message is NOT
 *     leaked to the client (Information Disclosure mitigation)
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

import StrategyError from "./error";

describe("strategy/[id]/error.tsx — STATE-01 route boundary contract", () => {
  it("Test 1: renders heading + body copy + both CTAs", () => {
    const err = Object.assign(new Error("boom"), { digest: "d-1" });
    render(<StrategyError error={err} unstable_retry={vi.fn()} />);

    expect(
      screen.getByRole("heading", { name: /something went wrong/i }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: /Try again/ })).toBeTruthy();
    expect(screen.getByText(/Go to Discovery/)).toBeTruthy();
  });

  it("Test 2: Try-again button invokes unstable_retry()", () => {
    const retry = vi.fn();
    const err = Object.assign(new Error("boom"), { digest: "d-2" });
    render(<StrategyError error={err} unstable_retry={retry} />);

    fireEvent.click(screen.getByRole("button", { name: /Try again/ }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("Test 3: console.error fires with the thrown error on mount", () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const err = Object.assign(new Error("paint failed"), { digest: "d-3" });
    render(<StrategyError error={err} unstable_retry={vi.fn()} />);

    expect(errSpy).toHaveBeenCalledWith("[strategy-error]", err);
    errSpy.mockRestore();
  });

  it("Test 4: digest is shown but the raw error.message is never leaked", () => {
    const secret = "sensitive-server-side-stack-detail";
    const err = Object.assign(new Error(secret), { digest: "d-4-hash" });
    const { container } = render(
      <StrategyError error={err} unstable_retry={vi.fn()} />,
    );

    // The digest hash is surfaced for log correlation…
    expect(screen.getByText(/Error ID: d-4-hash/)).toBeTruthy();
    // …but the raw message (which could leak server internals) is NOT rendered.
    expect(container.textContent).not.toContain(secret);
  });
});
