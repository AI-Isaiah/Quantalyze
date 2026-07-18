/** @vitest-environment jsdom */
/**
 * Phase 44 / A11Y-02 — ResponsiveTable overflow wrapper + scroll hint.
 *
 * ResponsiveTable wraps arbitrary children in an `overflow-x-auto`, focusable
 * `role="region"` container whose ACCESSIBLE NAME (aria-label) announces the
 * horizontal-scroll affordance to screen-reader users. It adds ONLY the scroll
 * affordance — it does NOT restyle the wrapped table (column reshape is phase
 * 46 / TABLE-01).
 *
 * Test plan (covers all three accessible-name branches — `hint` override /
 * `label` prefix / bare default — so the ratchet holds):
 *  1. Default hint — no `hint`/`label` props → the static default string is the
 *     region's aria-label; the container carries `overflow-x-auto`,
 *     `role="region"`, is focusable, and emits NO redundant `sr-only` node (the
 *     double-announce a11y regression guard).
 *  2. Provided hint — a custom `hint` prop overrides the aria-label; assert it
 *     DIFFERS from the default branch (proves that branch executes).
 *  3. Provided label — `label` prefixes the default hint, yielding a UNIQUE
 *     accessible name per table (the landmark-unique guard: two ResponsiveTables
 *     on one page must not share a region name).
 *  4. Children render inside the overflow container.
 */
import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { ResponsiveTable } from "./ResponsiveTable";

const DEFAULT_HINT =
  "Table scrolls horizontally. Swipe or use arrow keys to see more columns.";

describe("[A11Y-02] ResponsiveTable — overflow wrapper + scroll hint", () => {
  it("renders the default scroll hint as the region's accessible name (no sr-only duplicate)", () => {
    render(
      <ResponsiveTable>
        <table>
          <tbody>
            <tr>
              <td>cell</td>
            </tr>
          </tbody>
        </table>
      </ResponsiveTable>,
    );

    const region = screen.getByRole("region");
    expect(region).toHaveClass("overflow-x-auto");
    expect(region).toHaveAttribute("tabindex", "0");

    // The default hint is the region's accessible name.
    const defaultLabel = region.getAttribute("aria-label");
    expect(defaultLabel).toBe(DEFAULT_HINT);
    // The wording must mention scrolling so SR users understand the affordance.
    expect(defaultLabel?.toLowerCase()).toContain("scroll");
    // Double-announce regression guard: the hint lives ONLY in the aria-label,
    // never also as an sr-only child (that would read the hint twice — once as
    // the region name, once as in-region content).
    expect(region.querySelector(".sr-only")).toBeNull();
  });

  it("uses a provided hint as the region's accessible name", () => {
    const customHint = "Holdings table scrolls sideways to reveal more metrics.";
    render(
      <ResponsiveTable hint={customHint}>
        <table>
          <tbody>
            <tr>
              <td>cell</td>
            </tr>
          </tbody>
        </table>
      </ResponsiveTable>,
    );

    const region = screen.getByRole("region", { name: customHint });
    expect(region).toHaveClass("overflow-x-auto");
    expect(region.querySelector(".sr-only")).toBeNull();
    // Proves the provided-hint branch diverges from the default branch.
    expect(region.getAttribute("aria-label")).not.toBe(DEFAULT_HINT);
  });

  it("prefixes a provided label onto the default hint and yields a UNIQUE accessible name", () => {
    // Two tables on one page MUST have distinct region names (axe landmark-unique
    // + SR rotor). Render both and assert their aria-labels differ and each
    // carries its own label prefix + the scroll affordance.
    render(
      <>
        <ResponsiveTable label="Holdings">
          <table>
            <tbody><tr><td>h</td></tr></tbody>
          </table>
        </ResponsiveTable>
        <ResponsiveTable label="Open positions">
          <table>
            <tbody><tr><td>p</td></tr></tbody>
          </table>
        </ResponsiveTable>
      </>,
    );

    const holdings = screen.getByRole("region", { name: `Holdings: ${DEFAULT_HINT}` });
    const positions = screen.getByRole("region", { name: `Open positions: ${DEFAULT_HINT}` });
    // Distinct names — the regression guard for duplicate landmarks.
    expect(holdings.getAttribute("aria-label")).not.toBe(
      positions.getAttribute("aria-label"),
    );
    // The label branch still carries the scroll affordance (not a bare label).
    expect(holdings.getAttribute("aria-label")).toContain("scroll");
    // Neither falls back to the bare default.
    expect(holdings.getAttribute("aria-label")).not.toBe(DEFAULT_HINT);
  });

  it("renders children inside the overflow container", () => {
    render(
      <ResponsiveTable>
        <div data-testid="wrapped-child">wrapped table body</div>
      </ResponsiveTable>,
    );
    const region = screen.getByRole("region");
    expect(within(region).getByTestId("wrapped-child")).toBeInTheDocument();
  });

  // Phase 117 / UIFIX-02 — clip-proof focus indicator (WCAG 2.4.7).
  //
  // WHY: this shared `role="region" tabIndex={0}` scroll box is focusable and
  // lives inside panels that are themselves `overflow-hidden`. Relying on the
  // browser DEFAULT outline (or any positive-offset outline) means the focus
  // ring paints OUTSIDE the box and the ancestor overflow CLIPS it — the ring
  // vanishes at exactly the tables that scroll (MetricsColumn worst-drawdowns,
  // StressWindowsPanel, every other consumer). The INSET box-shadow ring paints
  // INSIDE the box → always within the viewport → never clipped. This is the
  // CENTRAL fix that covers all ResponsiveTable consumers at once.
  it("[UIFIX-02] the scroll region carries a clip-proof inset focus ring (not a clipped outline)", () => {
    render(
      <ResponsiveTable>
        <table>
          <tbody>
            <tr>
              <td>cell</td>
            </tr>
          </tbody>
        </table>
      </ResponsiveTable>,
    );
    const region = screen.getByRole("region");
    // Inset ring draws inside the element bounds → immune to ancestor clipping.
    expect(region).toHaveClass("focus-visible:ring-2");
    expect(region).toHaveClass("focus-visible:ring-inset");
    expect(region).toHaveClass("focus-visible:ring-accent");
    // A 20%-opacity accent ring fails the WCAG 1.4.11 ≥3:1 non-text-contrast
    // floor the UI-SPEC binds this fix to — full-opacity accent only.
    expect(region.className).not.toContain("ring-accent/20");
  });
});
