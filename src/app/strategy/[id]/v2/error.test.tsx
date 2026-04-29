/**
 * SR-3 (v0.17.1.4) — `/strategy/[id]/v2/error.tsx` component contract.
 *
 * The route's error boundary is a client component that renders when the
 * server component throws (e.g. analytics-blob fetch failure, RLS denial,
 * malformed strategyId). Without explicit coverage, regressions to the
 * Reload-strategy / v1-fallback affordances would only surface in
 * production, where the boundary itself is the only error UI.
 *
 * Tests cover:
 *  1. Renders the heading + body copy (visible CTA labels)
 *  2. Reload button calls unstable_retry()
 *  3. v1-fallback Link strips the trailing "/v2" from pathname
 *  4. usePathname() returning null falls back to "/"
 *  5. console.error is invoked with the thrown error on mount
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

let pathnameValue: string | null = "/strategy/abc-123/v2";

vi.mock("next/navigation", () => ({
  usePathname: () => pathnameValue,
}));

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

import StrategyV2Error from "./error";

describe("/strategy/[id]/v2/error.tsx — SR-3 boundary contract", () => {
  beforeEach(() => {
    pathnameValue = "/strategy/abc-123/v2";
  });

  it("Test 1: renders heading + body copy + both CTAs", () => {
    const err = Object.assign(new Error("boom"), { digest: "d-1" });
    render(<StrategyV2Error error={err} unstable_retry={vi.fn()} />);

    expect(
      screen.getByRole("heading", { name: /couldn't load this strategy/i }),
    ).toBeTruthy();
    // Body copy mentions "Reload strategy" too, so use role-scoped queries
    // for the actionable controls.
    expect(
      screen.getByRole("button", { name: /Reload strategy/ }),
    ).toBeTruthy();
    expect(screen.getByText(/Open v1 factsheet/)).toBeTruthy();
  });

  it("Test 2: Reload button invokes unstable_retry()", () => {
    const retry = vi.fn();
    const err = Object.assign(new Error("boom"), { digest: "d-2" });
    render(<StrategyV2Error error={err} unstable_retry={retry} />);

    fireEvent.click(screen.getByRole("button", { name: /Reload strategy/ }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("Test 3: v1-fallback Link strips the trailing /v2 from pathname", () => {
    pathnameValue = "/strategy/strat_xyz/v2";
    const err = new Error("boom");
    render(<StrategyV2Error error={err} unstable_retry={vi.fn()} />);

    const link = screen.getByTestId("next-link");
    expect(link.getAttribute("href")).toBe("/strategy/strat_xyz");
  });

  it("Test 4: pathname=null falls back to '/' for the v1 link", () => {
    pathnameValue = null;
    const err = new Error("boom");
    render(<StrategyV2Error error={err} unstable_retry={vi.fn()} />);

    const link = screen.getByTestId("next-link");
    expect(link.getAttribute("href")).toBe("/");
  });

  it("Test 5: console.error fires with the thrown error on mount", () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const err = Object.assign(new Error("paint failed"), { digest: "d-5" });
    render(<StrategyV2Error error={err} unstable_retry={vi.fn()} />);

    expect(errSpy).toHaveBeenCalledWith(err);
    errSpy.mockRestore();
  });
});
