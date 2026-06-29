/**
 * STATE-05 + T-53-13 (Phase 53 Plan 04) — `/portfolios/error.tsx` contract.
 *
 * The portfolios route error boundary is a client component shown when the RSC
 * `getUserPortfolios()` fetch throws. It MUST surface the `digest` only — never
 * `error.message` (a thrown RSC message can leak server internals across the
 * client boundary; ASVS V7 / Information Disclosure). The "Try again" CTA wires
 * `unstable_retry` (Next 16.2.0 — not `reset`).
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

import PortfoliosError from "./error";

describe("/portfolios/error.tsx — STATE-05 boundary contract", () => {
  it("renders the heading + body + Try again CTA", () => {
    const err = Object.assign(new Error("boom"), { digest: "d-1" });
    render(<PortfoliosError error={err} unstable_retry={vi.fn()} />);

    expect(
      screen.getByRole("heading", { name: /something went wrong/i }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: /try again/i })).toBeTruthy();
  });

  it("Try again invokes unstable_retry() exactly once", () => {
    const retry = vi.fn();
    render(
      <PortfoliosError
        error={Object.assign(new Error("boom"), { digest: "d-2" })}
        unstable_retry={retry}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("renders the digest when present", () => {
    render(
      <PortfoliosError
        error={Object.assign(new Error("boom"), { digest: "digest-xyz" })}
        unstable_retry={vi.fn()}
      />,
    );
    expect(screen.getByText(/digest-xyz/)).toBeTruthy();
  });

  it("NEVER renders error.message (Information Disclosure / T-53-13)", () => {
    const secret = "DB password = hunter2 leaked";
    render(
      <PortfoliosError
        error={Object.assign(new Error(secret), { digest: "d-3" })}
        unstable_retry={vi.fn()}
      />,
    );
    expect(screen.queryByText(new RegExp(secret))).toBeNull();
  });

  it("logs to console.error with the portfolios surface tag on mount", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const err = Object.assign(new Error("boom"), { digest: "d-4" });
    render(<PortfoliosError error={err} unstable_retry={vi.fn()} />);
    expect(spy).toHaveBeenCalledWith("[portfolios-error]", err);
    spy.mockRestore();
  });
});
