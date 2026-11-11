import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StaleSeriesChip } from "./StaleSeriesChip";

/**
 * Phase 201 plan 17 (U-14, D-11): the staleness chip names the newest return day as a full
 * day ("Data from Oct 9, 2026"), the same form every other date in the product uses, not
 * the machine form "2026-10-09". The expected text is typed by hand so the test cannot pass
 * by calling the formatter it is checking.
 */
describe("StaleSeriesChip", () => {
  it("a stale verdict reads 'Data from Oct 9, 2026'", () => {
    render(
      <StaleSeriesChip
        verdict="stale"
        seriesEnd="2026-10-09"
        ageDays={30}
        thresholdDays={14}
      />,
    );
    expect(screen.getByText("Data from Oct 9, 2026")).toBeTruthy();
    expect(document.body.textContent).not.toContain("2026-10-09");
  });

  it("an unreadable day says so instead of printing a date", () => {
    render(
      <StaleSeriesChip
        verdict="unknown"
        seriesEnd={null}
        ageDays={null}
        thresholdDays={14}
      />,
    );
    expect(screen.getByText("Data date unknown")).toBeTruthy();
  });

  it("a current verdict renders nothing", () => {
    const { container } = render(
      <StaleSeriesChip
        verdict="current"
        seriesEnd="2026-10-09"
        ageDays={1}
        thresholdDays={14}
      />,
    );
    expect(container.textContent).toBe("");
  });
});
