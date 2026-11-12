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
    // Auto-excluded bar is the amber DESIGN.md warning token (never red). The
    // border uses the SOLID `warning` amber (≥3:1 against the bg-track rail) —
    // the pale warning-border token is near-invisible on the rail (~1:1).
    expect(autoExcluded.className).toContain("bg-warning-bg");
    expect(autoExcluded.className).toContain("border-warning ");
    expect(autoExcluded.className).not.toContain("border-warning-border");
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
    // role="img" makes each bar a REAL accessibility node — a role-less div's
    // aria-label is ignored by screen readers (the label would be decorative).
    expect(inBlend).toHaveAttribute("role", "img");
    expect(autoExcluded).toHaveAttribute("role", "img");
    const inLabel = inBlend.getAttribute("aria-label") ?? "";
    const outLabel = autoExcluded.getAttribute("aria-label") ?? "";
    // Coverage dates present in both.
    // F-11 / D-11 / UI-SPEC Interaction contract 5 / R3-01 item 4 / plan
    // 201-38: the bar's spoken name prints its days through `formatDay`, never
    // the raw ISO. Phase 201.1 D-02: the union endpoint labels print through
    // `formatDay` too. Dates keep U+00A0 inside (plan 201.1-01), written as
    // escapes here; the range's own separator spaces stay U+0020.
    expect(inLabel).toContain("covers Jan\u00a01,\u00a02022 – Dec\u00a031,\u00a02024");
    expect(outLabel).toContain("covers Jan\u00a01,\u00a02022 – Aug\u00a015,\u00a02023");
    expect(inLabel).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(outLabel).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    // Membership stated as a word — never color-only.
    expect(inLabel.toLowerCase()).toContain("in blend");
    expect(outLabel.toLowerCase()).toContain("auto-excluded");
  });

  it("renders the union endpoints through formatDay, start left and end right, with no raw ISO", () => {
    const { container } = render(
      <CoverageTimeline
        rows={ROWS}
        unionWindow={{ start: "2025-09-17", end: "2026-11-10" }}
        activeWindow={ACTIVE}
      />,
    );
    // Literal expected strings with U+00A0 escapes, never built with the helper.
    // The default text normalizer folds U+00A0 to a plain space, so match exact.
    const exact = { normalizer: (t: string) => t };
    const start = screen.getByText("Sep\u00a017,\u00a02025", exact);
    const end = screen.getByText("Nov\u00a010,\u00a02026", exact);
    expect(start).toBeInTheDocument();
    expect(end).toBeInTheDocument();
    // DOM order is the reading order: start first, end second.
    expect(
      start.compareDocumentPosition(end) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // The rendered timeline holds no YYYY-MM-DD text anywhere.
    expect(container.textContent ?? "").not.toMatch(/\d{4}-\d{2}-\d{2}/);
    // The 320px wrap rule: the endpoint row wraps and the end label stays
    // right-aligned on its own line (the geometry is measured in a real
    // browser by plan 201.1-15).
    const row = start.parentElement as HTMLElement;
    expect(row.className).toContain("flex-wrap");
    expect(end.className).toContain("ml-auto");
    // Plan 201.1-15 (measured at 320px): the row must be allowed to shrink to the track
    // (`min-w-0`; its min-content is a whole label, wider than the 70px track) and pack toward the
    // end (`justify-end`, start `mr-auto`), so a label wider than the track spills left over the
    // empty spacer instead of right out of the section.
    expect(row.className).toContain("min-w-0");
    expect(row.className).toContain("justify-end");
    expect(start.className).toContain("mr-auto");
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

  it("CF-05: surfaces a friendly data-source label (not a raw id) in the row text, title, AND aria-label", () => {
    // Per-key (book-member) gantt rows arrive with their `name` already
    // resolved to the friendly exchange/account label upstream (the composer's
    // dataSourceLabel idiom — CF-05). This pins CoverageTimeline's render
    // CONTRACT: it surfaces whatever `name` it is handed in ALL THREE
    // user-facing places (the truncated row text, its `title` tooltip, and the
    // bar aria-label) and never re-derives or mangles it — so a friendly label
    // reaches the user everywhere and a raw UUID never would.
    const FRIENDLY = "Bybit — Main";
    const RAW_ID = "11111111-2222-3333-4444-555555555555";
    const { container } = render(
      <CoverageTimeline
        rows={[
          {
            id: RAW_ID,
            name: FRIENDLY,
            span: { first: "2022-01-01", last: "2024-12-31" },
            inBlend: true,
          },
        ]}
        unionWindow={UNION}
        activeWindow={ACTIVE}
      />,
    );
    expandPanel(container);
    // Visible row text + its `title` tooltip both show the friendly label.
    const nameCell = screen.getByTitle(FRIENDLY);
    expect(nameCell).toHaveTextContent(FRIENDLY);
    // The bar's aria-label restates the friendly label as TEXT (WCAG).
    const bar = container.querySelector(
      `[data-testid='coverage-bar-${RAW_ID}']`,
    ) as HTMLElement;
    expect(bar.getAttribute("aria-label") ?? "").toContain(FRIENDLY);
    // The raw id never leaks into any user-facing text/attr (the `data-testid`
    // is exempt — it is not surfaced to the user).
    expect(nameCell.textContent ?? "").not.toContain(RAW_ID);
    expect(bar.getAttribute("aria-label") ?? "").not.toContain(RAW_ID);
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
