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

  it("emphasizes the KPI strip as the dominant anchor — a full-width 4-cell grid", () => {
    const { container } = render(<AllocationsLoading />);
    // The anchor is the @container 4-cell grid (the first/largest region),
    // mirroring the live KpiStrip shape; locate it and assert 4 cells.
    const anchor = container.querySelector("div.\\@container.grid");
    expect(anchor).not.toBeNull();
    // Tailwind v4 container 4-col target so the anchor reads as the KPI strip.
    expect(anchor!.className).toContain("@lg:grid-cols-4");
    expect(anchor!.children.length).toBe(4);
  });

  it("assembles from the shared Skeleton primitive (animate-pulse), not hand-rolled bars", () => {
    const { container } = render(<AllocationsLoading />);
    // Skeleton renders `animate-pulse … bg-border/60`; assert several exist so
    // the skeleton is built from the primitive, per 52-UI-SPEC §Skeleton fidelity.
    const pulses = container.querySelectorAll(".animate-pulse");
    expect(pulses.length).toBeGreaterThan(4);
  });
});
