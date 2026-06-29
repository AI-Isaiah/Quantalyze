/**
 * Phase 52 / Plan 52-05 / Task 1 — strategy/[id] route loading.tsx contract.
 *
 * The route-level loading skeleton renders while the server component awaits
 * `getPublicStrategyDetail(id)` + the viewer-scoped private-note fetch. These
 * tests pin the STATE-01 contract: it smoke-renders (RSC, no client-only
 * deps), exposes the sr-only `role="status"` liveness hint, and — because
 * single-strategy is a PROSE page — keeps the narrow readable `max-w-3xl`
 * measure (it does NOT fluid-fill to 1920).
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import StrategyLoading from "./loading";

describe("strategy/[id]/loading.tsx — STATE-01 route skeleton", () => {
  it("smoke-renders without throwing", () => {
    const { container } = render(<StrategyLoading />);
    expect(container.firstChild).not.toBeNull();
  });

  it("exposes the sr-only role=status liveness hint", () => {
    render(<StrategyLoading />);
    const status = screen.getByRole("status");
    expect(status).toBeDefined();
    expect(status.textContent).toMatch(/Loading strategy/i);
    expect(status.getAttribute("aria-live")).toBe("polite");
    expect(status.className).toContain("sr-only");
  });

  it("keeps the narrow max-w-3xl prose measure (does NOT fluid-fill to 1920)", () => {
    const { container } = render(<StrategyLoading />);
    expect(container.innerHTML).toContain("max-w-3xl");
    expect(container.innerHTML).not.toContain("max-w-[1920px]");
  });
});
