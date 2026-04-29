import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MetricCell } from "./MetricCell";

/**
 * Phase 14b-04 Task 1 — MetricCell primitive tests.
 *
 * Tests 1–5 cover label + value rendering, em-dash null path, negative
 * styling, and semantic <dl><dt><dd> wrapping (a11y semantic-HTML rule).
 */
describe("MetricCell — Phase 14b-04 Task 1", () => {
  it("Test 1: renders <dt> with 12px DM Sans regular text-text-muted label", () => {
    const { container } = render(
      <MetricCell label="Total trades" value="1,234" />,
    );
    const dt = container.querySelector("dt");
    expect(dt).not.toBeNull();
    expect(dt?.textContent).toBe("Total trades");
    const cls = dt?.getAttribute("class") ?? "";
    expect(cls).toContain("text-xs");
    expect(cls).toContain("font-normal");
    expect(cls).toContain("text-text-muted");
  });

  it("Test 2: renders <dd> with 18px Geist Mono semibold tabular-nums for non-null values", () => {
    const { container } = render(
      <MetricCell label="Win rate" value="64.2%" />,
    );
    const dd = container.querySelector("dd");
    expect(dd).not.toBeNull();
    expect(dd?.textContent).toBe("64.2%");
    const cls = dd?.getAttribute("class") ?? "";
    expect(cls).toContain("text-lg");
    expect(cls).toContain("font-semibold");
    expect(cls).toContain("tabular-nums");
    expect(cls).toContain("text-text-primary");
  });

  it("Test 3: when value is null, renders em-dash (U+2014)", () => {
    render(<MetricCell label="SQN" value={null} />);
    const emDash = screen.getByText("—");
    expect(emDash).not.toBeNull();
    expect(emDash.tagName.toLowerCase()).toBe("dd");
  });

  it("Test 4: when negative=true, <dd> uses text-negative instead of text-text-primary", () => {
    const { container } = render(
      <MetricCell label="Expectancy" value="-0.42" negative />,
    );
    const dd = container.querySelector("dd");
    const cls = dd?.getAttribute("class") ?? "";
    expect(cls).toContain("text-negative");
    expect(cls).not.toContain("text-text-primary");
  });

  it("Test 5: semantic HTML — <dl><dt><dd></dd></dt></dl> triple", () => {
    const { container } = render(
      <MetricCell label="Profit factor" value="1.42" />,
    );
    const dl = container.querySelector("dl");
    expect(dl).not.toBeNull();
    // dt + dd must both exist as direct children of the dl
    const dt = dl?.querySelector("dt");
    const dd = dl?.querySelector("dd");
    expect(dt).not.toBeNull();
    expect(dd).not.toBeNull();
    // Order: dt comes before dd
    const adj = container.querySelector("dl > dt + dd");
    expect(adj).not.toBeNull();
  });
});
