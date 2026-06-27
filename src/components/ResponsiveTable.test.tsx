/** @vitest-environment jsdom */
/**
 * Phase 44 / A11Y-02 — ResponsiveTable overflow wrapper + sr-only scroll hint.
 *
 * ResponsiveTable wraps arbitrary children in an `overflow-x-auto`,
 * focusable `role="region"` container and emits an `sr-only` scroll hint so
 * screen-reader users know the table scrolls horizontally. It adds ONLY the
 * scroll affordance — it does NOT restyle the wrapped table (column reshape
 * is phase 46 / TABLE-01).
 *
 * Test plan (covers both `hint ?? default` branches so the ratchet holds):
 *  1. Default hint — no `hint` prop → the static default sr-only string is
 *     rendered and used as the aria-label; the container carries
 *     `overflow-x-auto`, `role="region"`, and is focusable.
 *  2. Provided hint — a custom `hint` prop overrides both the sr-only text and
 *     the aria-label; assert the sr-only text DIFFERS from the default branch
 *     (proves both branches execute).
 *  3. Children render inside the overflow container.
 */
import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { ResponsiveTable } from "./ResponsiveTable";

describe("[A11Y-02] ResponsiveTable — overflow wrapper + sr-only scroll hint", () => {
  it("renders the default scroll hint and a focusable overflow region", () => {
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

    // Default hint drives both the sr-only text and the aria-label.
    const defaultLabel = region.getAttribute("aria-label");
    expect(defaultLabel).toBeTruthy();
    const srOnly = region.querySelector("span.sr-only");
    expect(srOnly).not.toBeNull();
    expect(srOnly?.textContent).toBe(defaultLabel);
    // The default wording must mention scrolling horizontally so SR users
    // understand the affordance.
    expect(srOnly?.textContent?.toLowerCase()).toContain("scroll");
  });

  it("uses a provided hint for both the sr-only text and the aria-label", () => {
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
    const srOnly = region.querySelector("span.sr-only");
    expect(srOnly?.textContent).toBe(customHint);
    // Proves the provided-hint branch diverges from the default branch.
    expect(srOnly?.textContent).not.toBe(
      "Table scrolls horizontally. Swipe or use arrow keys to see more columns.",
    );
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
});
