/**
 * STATE-05 / T-53-13 — `/portfolios/[id]/error.tsx` boundary contract.
 *
 * The portfolio-detail boundary handles user-scoped financial data; it MUST
 * surface the `digest` ONLY and NEVER the thrown `error.message` (RSC
 * Information Disclosure, ASVS V7) — the same contract its `/portfolios` and
 * `/admin` siblings pin. Added in /ship review: the nested portfolio boundaries
 * shipped without the info-leak guard test their list-route sibling carries.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
  }: {
    href: string;
    children: React.ReactNode;
  }) => <a href={href}>{children}</a>,
}));

import PortfolioDetailError from "./error";

afterEach(() => cleanup());

describe("/portfolios/[id]/error.tsx — digest-only boundary", () => {
  it("renders heading + body copy", () => {
    const err = Object.assign(new Error("boom"), { digest: "d-1" });
    render(<PortfolioDetailError error={err} unstable_retry={vi.fn()} />);
    expect(
      screen.getByRole("heading", { name: /something went wrong/i }),
    ).toBeTruthy();
    expect(
      screen.getByText(/this section encountered an error/i),
    ).toBeTruthy();
  });

  it("retry button invokes unstable_retry() exactly once", () => {
    const retry = vi.fn();
    render(
      <PortfolioDetailError error={new Error("boom")} unstable_retry={retry} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("renders the digest when present", () => {
    const err = Object.assign(new Error("boom"), { digest: "abc-123" });
    render(<PortfolioDetailError error={err} unstable_retry={vi.fn()} />);
    expect(screen.getByText(/error id: abc-123/i)).toBeTruthy();
  });

  it("omits the Error ID line when no digest exists", () => {
    render(
      <PortfolioDetailError error={new Error("boom")} unstable_retry={vi.fn()} />,
    );
    expect(screen.queryByText(/error id:/i)).toBeNull();
  });

  it("NEVER renders the thrown error.message (info-leak guard, T-53-13)", () => {
    const secret = "RLS denial for portfolio owner uid=hunter2 at db.internal";
    const err = Object.assign(new Error(secret), { digest: "d-leak" });
    const { container } = render(
      <PortfolioDetailError error={err} unstable_retry={vi.fn()} />,
    );
    expect(container.textContent).not.toContain(secret);
    expect(screen.queryByText(secret)).toBeNull();
  });

  it("logs to console.error with the [portfolio-detail-error] tag on mount", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const err = Object.assign(new Error("fetch failed"), { digest: "d-5" });
    render(<PortfolioDetailError error={err} unstable_retry={vi.fn()} />);
    expect(spy).toHaveBeenCalledWith("[portfolio-detail-error]", err);
    spy.mockRestore();
  });
});
