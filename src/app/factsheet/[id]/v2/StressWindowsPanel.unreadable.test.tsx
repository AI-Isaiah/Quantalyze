/** @vitest-environment jsdom */
/**
 * 194.2 R2: a series whose EARLIEST date is unreadable withholds its stress windows. The
 * empty-series answer would have counted every catalogued window as outside the observation
 * period and the panel would have said so, which is false: the dates could not be read, so
 * nothing could be placed inside or outside the record.
 */
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { buildFactsheetPayload } from "@/lib/factsheet/build-payload";

import { FactsheetProvider } from "./factsheet-context";
import { advancedSectionContent } from "./FactsheetView";
import { StressWindowsPanel } from "./StressWindowsPanel";

function payloadWithFirstDate(firstDate: string) {
  const days = Array.from({ length: 300 }, (_, i) => ({
    date: new Date(Date.UTC(2024, 0, i + 2)).toISOString().slice(0, 10),
    value: Math.sin(i / 9) * 0.006,
  }));
  const payload = buildFactsheetPayload(
    {
      id: "stress-unreadable",
      name: "Stress Unreadable",
      types: ["test"],
      markets: ["crypto"],
      computedAt: "2026-09-30T00:00:00Z",
      trustTier: null,
    },
    [{ date: firstDate, value: 0.001 }, ...days],
  );
  if (!payload) throw new Error("buildFactsheetPayload returned null in test");
  return payload;
}

describe("StressWindowsPanel: 194.2 R2 an unreadable earliest date", () => {
  it.each(["2023-13-01", "2023-02-32", ""])(
    "shows the withheld line for a first date of %j, never the outside-the-period sentence",
    (firstDate) => {
      const payload = payloadWithFirstDate(firstDate);
      expect(payload.stressWindows.unreadable).toBe(true);
      const { container } = render(
        <FactsheetProvider payload={payload}>
          <StressWindowsPanel />
        </FactsheetProvider>,
      );
      const text = container.textContent ?? "";
      expect(text).toContain("Stress windows are not shown: the record's dates could not be read.");
      expect(text).not.toContain("outside this strategy's observation period");
      expect(text).not.toContain("catalogued");
    },
  );

  it("keeps the section present in the document layout, so the withheld line is visible there", () => {
    const payload = payloadWithFirstDate("2023-13-01");
    expect(advancedSectionContent(payload, false)["factsheet-stress"]).toBe(true);
  });

  it("a readable series is unchanged: no unreadable flag, windows evaluated", () => {
    const payload = payloadWithFirstDate("2024-01-01");
    expect(payload.stressWindows.unreadable).toBeUndefined();
    expect(payload.stressWindows.totalCatalogued).toBeGreaterThan(0);
  });
});
