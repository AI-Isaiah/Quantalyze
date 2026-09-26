/**
 * Phase 52-02 / STATE-01 — `/allocations/loading.tsx` route-skeleton contract.
 *
 * The route-level loading skeleton renders while the server component awaits
 * `getMyAllocationDashboard()`. It is an RSC (no `"use client"`) assembled from
 * the shared Skeleton primitives, with the KPI strip as the DOMINANT anchor and
 * an `sr-only role="status"` liveness hint. These tests pin that shape so a
 * regression (e.g. a dropped liveness region or a collapsed anchor) fails in CI
 * rather than only in production, and keep the new file inside the blocking
 * coverage gate.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import AllocationsLoading from "./loading";

describe("/allocations/loading.tsx — route skeleton (STATE-01)", () => {
  it("smoke-renders and exposes an sr-only role=status liveness region", () => {
    render(<AllocationsLoading />);
    const status = screen.getByRole("status");
    expect(status).toBeTruthy();
    expect(status.textContent).toMatch(/Loading allocations/i);
    // Liveness must be polite (non-interruptive) per the Copywriting Contract.
    expect(status.getAttribute("aria-live")).toBe("polite");
  });

  // Phase 167.1.2 / D-02 (review round 1 IN-04). While the equity history is
  // rebuilt the Overview (the default tab) renders no KPI strip and no curve,
  // only a short text panel. A skeleton that draws a 4-cell KPI grid and a
  // 320px chart block promises numbers that will not come, then shifts layout
  // when the paragraph swaps in. The 52-UI-SPEC KPI anchor (a 4-cell
  // `@lg:grid-cols-4` grid on a separate `@container` host) is SUSPENDED here,
  // not deleted from the spec: plan 11 of Phase 167.1.2 restores it, and this
  // test, when it defines "ready".
  it("while the history is rebuilt, draws the rebuilding panel's text shape and no KPI grid or chart block", () => {
    const { container } = render(<AllocationsLoading />);
    const kpiGrid = Array.from(
      container.querySelectorAll<HTMLElement>("div.grid"),
    ).find((el) => el.className.includes("@lg:grid-cols-4"));
    expect(kpiGrid, "no KPI-strip grid while the Overview has none").toBeUndefined();
    expect(container.innerHTML).not.toMatch(/h-\[320px\]/);
    const block = screen.getByTestId("allocations-loading-rebuilding-block");
    expect(block.querySelectorAll(".animate-pulse").length).toBeGreaterThanOrEqual(3);
  });

  // ⭐ Added 2026-08-10 (153.2 review WR-06). `loading.tsx`'s docblock claimed
  // the fluid envelope — "the page shell mirrors the real page's … no px cap" —
  // with NO assertion behind it, while its `/compare` sibling had carried the
  // matching row since the 2026-08-09 founder decision. A claim in a comment is
  // not a guard, and this file is where a reinstated cap on the allocations
  // skeleton would have shipped green.
  //
  // The invariant is NOT a number. It is that the skeleton occupies the SAME
  // envelope as the page it stands in for, so content does not jump when the
  // real page swaps in — which is why this rejects the arbitrary-value form
  // outright rather than pinning a successor literal.
  it("imposes no px measure of its own — it must not be narrower than the page it stands in for", () => {
    const { container } = render(<AllocationsLoading />);
    const pxCaps = container.innerHTML.match(/max-w-\[\d+px\]/g) ?? [];
    expect(pxCaps).toEqual([]);
  });

  it("assembles from the shared Skeleton primitive (animate-pulse), not hand-rolled bars", () => {
    const { container } = render(<AllocationsLoading />);
    // Skeleton renders `animate-pulse … bg-border/60`; assert several exist so
    // the skeleton is built from the primitive, per 52-UI-SPEC §Skeleton fidelity.
    const pulses = container.querySelectorAll(".animate-pulse");
    expect(pulses.length).toBeGreaterThan(4);
  });
});
