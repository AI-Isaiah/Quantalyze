/**
 * STATE-05 — `/portfolios/[id]/loading.tsx` skeleton contract.
 *
 * The coverage ratchet is a blocking CI gate; every new route file carries a
 * render test. The skeleton has no props/logic, so asserting the `role="status"`
 * liveness node + the skeleton anchor (no fabricated data) is sufficient. Added
 * in /ship review alongside the nested portfolio boundaries.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import PortfolioDetailLoading from "./loading";

describe("/portfolios/[id]/loading.tsx — skeleton", () => {
  it("renders the sr-only role=status liveness node with the surface copy", () => {
    render(<PortfolioDetailLoading />);
    const status = screen.getByRole("status");
    expect(status).toBeTruthy();
    expect(status.textContent).toMatch(/loading portfolio/i);
    expect(status.getAttribute("aria-live")).toBe("polite");
    expect(status.className).toContain("sr-only");
  });

  it("renders skeleton placeholders only (layout anchor, no real data)", () => {
    const { container } = render(<PortfolioDetailLoading />);
    expect(
      container.querySelectorAll(".animate-pulse").length,
    ).toBeGreaterThan(0);
  });
});
