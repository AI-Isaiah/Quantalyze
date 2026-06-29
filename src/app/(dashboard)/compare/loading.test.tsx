/**
 * Phase 52 / Plan 52-03 / Task 2 — compare route loading.tsx contract.
 *
 * The route-level loading skeleton renders while the compare server component
 * awaits auth + the published-strategy / holding fetches. These tests pin the
 * STATE-01 contract: it smoke-renders (RSC, no client-only deps) and exposes
 * the sr-only `role="status"` liveness hint for assistive tech.
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import CompareLoading from "./loading";

describe("compare/loading.tsx — STATE-01 route skeleton", () => {
  it("smoke-renders without throwing", () => {
    const { container } = render(<CompareLoading />);
    expect(container.firstChild).not.toBeNull();
  });

  it("exposes the sr-only role=status liveness hint", () => {
    render(<CompareLoading />);
    const status = screen.getByRole("status");
    expect(status).toBeDefined();
    expect(status.textContent).toMatch(/Loading comparison/i);
    expect(status.getAttribute("aria-live")).toBe("polite");
    expect(status.className).toContain("sr-only");
  });

  it("fluid-fills toward the same ~1920px page measure", () => {
    const { container } = render(<CompareLoading />);
    expect(container.innerHTML).toContain("max-w-[1920px]");
  });
});
