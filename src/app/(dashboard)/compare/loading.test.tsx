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

  // ⭐ Re-cut 2026-08-09 (founder decision, Option B). This row used to assert
  // `toContain("max-w-[1920px]")` — a LITERAL, which broke the moment the
  // measure changed even though the property it cared about still held. The
  // invariant was never the number: it is that the skeleton occupies the SAME
  // envelope as the page it stands in for, so content does not jump when the
  // real page swaps in. `/compare` is a dense-table surface and is now fully
  // fluid, so the skeleton must impose no px ceiling either.
  it("imposes no px measure of its own — it must not be narrower than the page it stands in for", () => {
    const { container } = render(<CompareLoading />);
    const pxCaps = container.innerHTML.match(/max-w-\[\d+px\]/g) ?? [];
    expect(pxCaps).toEqual([]);
  });
});
