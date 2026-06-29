/**
 * STATE-05 — `/portfolios/[id]/documents/loading.tsx` skeleton contract.
 *
 * Asserts the `role="status"` liveness node + the skeleton anchor (no fabricated
 * data). Added in /ship review alongside the nested portfolio boundaries.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import PortfolioDocumentsLoading from "./loading";

describe("/portfolios/[id]/documents/loading.tsx — skeleton", () => {
  it("renders the sr-only role=status liveness node with the surface copy", () => {
    render(<PortfolioDocumentsLoading />);
    const status = screen.getByRole("status");
    expect(status).toBeTruthy();
    expect(status.textContent).toMatch(/loading documents/i);
    expect(status.getAttribute("aria-live")).toBe("polite");
    expect(status.className).toContain("sr-only");
  });

  it("renders skeleton placeholders only (layout anchor, no real data)", () => {
    const { container } = render(<PortfolioDocumentsLoading />);
    expect(
      container.querySelectorAll(".animate-pulse").length,
    ).toBeGreaterThan(0);
  });
});
