import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { render, screen, fireEvent } from "@testing-library/react";
import { CoverageTimeline } from "./CoverageTimeline";
import type { CoverageWindow } from "@/lib/scenario-window";

/**
 * Phase 58 / 58-03 Task 1 — CoverageTimeline (COVERAGE-01).
 *
 * The collapsed-by-default mini-gantt renders one horizontal bar per selected
 * strategy against the UNION date axis, with the active window drawn as a shaded
 * band overlay. Bar encoding: in-blend → accent (in-window) + track (out); an
 * auto-excluded strategy's whole bar → amber (agreeing with its row chip). Every
 * bar carries an aria-label restating coverage + membership as TEXT (color never
 * the sole signal — WCAG-AA). The date→x scale uses utcEpoch(parseIsoDay(...)) —
 * never `new Date(iso)` (timezone footgun H-1224).
 *
 * Branch coverage:
 *   - one bar per row (mixed in-blend + auto-excluded book)
 *   - in-blend bar carries an accent class; auto-excluded bar carries bg-warning-bg
 *   - each bar's aria-label contains the coverage dates + a membership word
 *   - the panel is COLLAPSED by default (the CollapsibleSection <details> is closed)
 *   - the source contains no `new Date(` (timezone rule, static guard)
 */

const UNION: CoverageWindow = { start: "2022-01-01", end: "2024-12-31" };
const ACTIVE: CoverageWindow = { start: "2023-01-01", end: "2024-06-30" };

const ROWS = [
  {
    id: "a",
    name: "Alpha Long-Vol",
    span: { first: "2022-01-01", last: "2024-12-31" },
    inBlend: true,
  },
  {
    id: "b",
    name: "Beta Ended",
    span: { first: "2022-01-01", last: "2023-08-15" },
    inBlend: false,
  },
];

function expandPanel(container: HTMLElement) {
  // The whole gantt lives inside a collapsed <details>; open it so the bars
  // render into the accessible tree for the encoding/aria assertions.
  const details = container.querySelector("details") as HTMLDetailsElement;
  details.open = true;
  fireEvent(details, new Event("toggle"));
  return details;
}

describe("CoverageTimeline (COVERAGE-01)", () => {
  it("is COLLAPSED by default (the CollapsibleSection <details> is closed)", () => {
    const { container } = render(
      <CoverageTimeline
        rows={ROWS}
        unionWindow={UNION}
        activeWindow={ACTIVE}
      />,
    );
    const details = container.querySelector("details") as HTMLDetailsElement;
    expect(details).not.toBeNull();
    expect(details.open).toBe(false);
    // The "Coverage timeline" toggle label is the collapsed affordance.
    expect(screen.getByText("Coverage timeline")).toBeInTheDocument();
  });

  it("renders one bar per selected strategy row", () => {
    const { container } = render(
      <CoverageTimeline
        rows={ROWS}
        unionWindow={UNION}
        activeWindow={ACTIVE}
      />,
    );
    expandPanel(container);
    const bars = container.querySelectorAll("[data-testid^='coverage-bar-']");
    expect(bars).toHaveLength(ROWS.length);
  });

  it("encodes in-blend as accent and auto-excluded as amber (color agrees with the row chip)", () => {
    const { container } = render(
      <CoverageTimeline
        rows={ROWS}
        unionWindow={UNION}
        activeWindow={ACTIVE}
      />,
    );
    expandPanel(container);
    const inBlend = container.querySelector(
      "[data-testid='coverage-bar-a']",
    ) as HTMLElement;
    const autoExcluded = container.querySelector(
      "[data-testid='coverage-bar-b']",
    ) as HTMLElement;
    // In-blend bar carries an accent fill.
    expect(inBlend.className).toContain("bg-accent");
    // Auto-excluded bar is the amber DESIGN.md warning token (never red).
    expect(autoExcluded.className).toContain("bg-warning-bg");
    expect(autoExcluded.className).not.toContain("bg-negative");
  });

  it("gives every bar an aria-label restating coverage dates + membership as text", () => {
    const { container } = render(
      <CoverageTimeline
        rows={ROWS}
        unionWindow={UNION}
        activeWindow={ACTIVE}
      />,
    );
    expandPanel(container);
    const inBlend = container.querySelector(
      "[data-testid='coverage-bar-a']",
    ) as HTMLElement;
    const autoExcluded = container.querySelector(
      "[data-testid='coverage-bar-b']",
    ) as HTMLElement;
    const inLabel = inBlend.getAttribute("aria-label") ?? "";
    const outLabel = autoExcluded.getAttribute("aria-label") ?? "";
    // Coverage dates present in both.
    expect(inLabel).toContain("2022-01-01");
    expect(inLabel).toContain("2024-12-31");
    expect(outLabel).toContain("2022-01-01");
    expect(outLabel).toContain("2023-08-15");
    // Membership stated as a word — never color-only.
    expect(inLabel.toLowerCase()).toContain("in blend");
    expect(outLabel.toLowerCase()).toContain("auto-excluded");
  });

  it("renders the union start + end endpoint date labels (no interior ticks)", () => {
    render(
      <CoverageTimeline
        rows={ROWS}
        unionWindow={UNION}
        activeWindow={ACTIVE}
      />,
    );
    // Endpoint labels for the union axis extents.
    expect(screen.getByText("2022-01-01")).toBeInTheDocument();
    expect(screen.getByText("2024-12-31")).toBeInTheDocument();
  });

  it("renders nothing when there are no rows to plot", () => {
    const { container } = render(
      <CoverageTimeline rows={[]} unionWindow={null} activeWindow={null} />,
    );
    expect(container.querySelector("details")).toBeNull();
  });

  it("guards a single-day union against divide-by-zero (does not throw / NaN)", () => {
    const single: CoverageWindow = { start: "2023-05-01", end: "2023-05-01" };
    const { container } = render(
      <CoverageTimeline
        rows={[
          {
            id: "x",
            name: "One Day",
            span: { first: "2023-05-01", last: "2023-05-01" },
            inBlend: true,
          },
        ]}
        unionWindow={single}
        activeWindow={single}
      />,
    );
    expandPanel(container);
    const bar = container.querySelector(
      "[data-testid='coverage-bar-x']",
    ) as HTMLElement;
    // The fill must have a real (non-NaN) width in its inline style.
    expect(bar.getAttribute("style") ?? "").not.toContain("NaN");
  });

  it("STATIC GUARD: the source uses no `new Date(` (timezone rule — utcEpoch only)", () => {
    const src = readFileSync(
      path.resolve(
        process.cwd(),
        "src/app/(dashboard)/allocations/components/CoverageTimeline.tsx",
      ),
      "utf8",
    );
    expect(src).not.toContain("new Date(");
    expect(src).toContain("utcEpoch");
    expect(src).not.toContain("recharts");
    expect(src).not.toContain("duration-250");
  });
});
