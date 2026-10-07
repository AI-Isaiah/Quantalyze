import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { FreshnessBadge } from "./FreshnessBadge";

/**
 * Phase 164.6.6.3.1 / D-07 — the recommendations batch chip states WHICH batch
 * it is, not only how fresh. The date is an opt-in `showDate` on the pill arm,
 * so every other caller (portfolio, tearsheet) renders exactly what it did.
 *
 * The date text is typed by hand ("Sep 25", "·"), never produced by calling the
 * formatter in the test: a test that computed its own expectation with the code
 * under test could not fail when that code was wrong.
 */

const PARSEABLE = "2026-09-25T00:00:00.000Z";

describe("FreshnessBadge — the batch date (D-07)", () => {
  it("the default render carries no date (independent oracle)", () => {
    const { container } = render(
      <FreshnessBadge computedAt={PARSEABLE} label="Batch" variant="pill" />,
    );
    expect(container.querySelector(".font-metric")).toBeNull();
    const text = container.textContent ?? "";
    expect(text).not.toContain("·");
    expect(text).not.toContain("Sep 25");
  });

  it("showDate={false} equals the default render", () => {
    const base = render(
      <FreshnessBadge computedAt={PARSEABLE} label="Batch" variant="pill" />,
    );
    const baseHtml = base.container.innerHTML;
    base.unmount();
    const off = render(
      <FreshnessBadge
        computedAt={PARSEABLE}
        label="Batch"
        variant="pill"
        showDate={false}
      />,
    );
    expect(off.container.innerHTML).toBe(baseHtml);
  });

  it("showDate renders the separator and the date in the data voice", () => {
    const { container } = render(
      <FreshnessBadge
        computedAt={PARSEABLE}
        label="Batch"
        variant="pill"
        showDate
      />,
    );
    const sep = container.querySelector('span[aria-hidden="true"]');
    expect(sep?.textContent).toBe("·");
    const date = container.querySelector(".font-metric");
    expect(date?.textContent).toBe("Sep 25");
    expect(container.textContent).toContain("Batch:");
  });

  it("an unparseable timestamp shows no date, never Invalid Date", () => {
    const { container } = render(
      <FreshnessBadge computedAt="not-a-date" label="Batch" showDate />,
    );
    expect(container.querySelector(".font-metric")).toBeNull();
    expect(container.textContent).not.toContain("Invalid Date");
    expect(container.textContent).not.toContain("·");
  });

  it("null shows no date", () => {
    const { container } = render(
      <FreshnessBadge computedAt={null} label="Batch" showDate />,
    );
    expect(container.querySelector(".font-metric")).toBeNull();
    expect(container.textContent).not.toContain("Invalid Date");
  });

  it("a Date and an epoch number are dated too", () => {
    const asDate = render(
      <FreshnessBadge computedAt={new Date(PARSEABLE)} showDate />,
    );
    expect(asDate.container.querySelector(".font-metric")?.textContent).toBe(
      "Sep 25",
    );
    asDate.unmount();
    const asNumber = render(
      <FreshnessBadge computedAt={Date.parse(PARSEABLE)} showDate />,
    );
    expect(asNumber.container.querySelector(".font-metric")?.textContent).toBe(
      "Sep 25",
    );
  });

  it("the dot variant ignores showDate", () => {
    const { container } = render(
      <FreshnessBadge computedAt={PARSEABLE} variant="dot" showDate />,
    );
    expect(container.querySelector(".font-metric")).toBeNull();
    expect(container.textContent).not.toContain("Sep 25");
  });
});
