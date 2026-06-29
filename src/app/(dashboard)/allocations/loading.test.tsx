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

  it("emphasizes the KPI strip as the dominant anchor — a 4-cell grid stepped by @container width, host on a SEPARATE ancestor", () => {
    const { container } = render(<AllocationsLoading />);
    // The anchor grid mirrors the live KpiStrip shape: a 4-cell grid whose
    // column count steps by CONTAINER width (`@lg:grid-cols-4`).
    const grid = Array.from(
      container.querySelectorAll<HTMLElement>("div.grid"),
    ).find((el) => el.className.includes("@lg:grid-cols-4"));
    expect(grid, "the KPI-anchor grid must exist").toBeDefined();
    expect(grid!.children.length).toBe(4);
    // The grid must NOT be its own @container: an element never queries its own
    // container size (CSS containment spec), so a same-element host+variant is
    // inert and the skeleton would freeze single-column. The host must be a
    // SEPARATE ancestor that wraps the grid.
    expect(grid!.className).not.toContain("@container");
    const host = grid!.closest(".\\@container");
    expect(host, "the @container host must wrap the grid").not.toBeNull();
    expect(host).not.toBe(grid);
  });

  it("assembles from the shared Skeleton primitive (animate-pulse), not hand-rolled bars", () => {
    const { container } = render(<AllocationsLoading />);
    // Skeleton renders `animate-pulse … bg-border/60`; assert several exist so
    // the skeleton is built from the primitive, per 52-UI-SPEC §Skeleton fidelity.
    const pulses = container.querySelectorAll(".animate-pulse");
    expect(pulses.length).toBeGreaterThan(4);
  });
});
