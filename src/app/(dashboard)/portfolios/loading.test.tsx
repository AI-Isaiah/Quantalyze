/**
 * STATE-05 (Phase 53 Plan 04) — `/portfolios/loading.tsx` contract.
 *
 * The portfolios list route gained a Suspense fallback (the page body fetches
 * `getUserPortfolios()` after the auth gate, so this skeleton renders during
 * that gap). The skeleton must carry the `role="status"` liveness hint so a
 * screen reader announces the loading state, and must render a card-grid of
 * placeholders matching the live `/portfolios` card grid.
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import PortfoliosLoading from "./loading";

describe("/portfolios/loading.tsx — STATE-05 skeleton contract", () => {
  it("exposes a role=status liveness hint", () => {
    render(<PortfoliosLoading />);
    const status = screen.getByRole("status");
    expect(status).toBeTruthy();
    expect(status.textContent).toMatch(/loading portfolios/i);
  });

  it("renders a grid of skeleton card placeholders (the dominant anchor)", () => {
    const { container } = render(<PortfoliosLoading />);
    // SkeletonCard wraps each placeholder in a Card; the grid is the anchor.
    const pulses = container.querySelectorAll(".animate-pulse");
    expect(pulses.length).toBeGreaterThanOrEqual(3);
  });
});
