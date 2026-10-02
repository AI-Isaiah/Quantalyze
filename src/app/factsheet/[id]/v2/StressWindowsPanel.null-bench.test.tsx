/** @vitest-environment jsdom */
/**
 * Phase 169.5 CR-01 (SC3): a stress window whose comparator leg has an uncovered
 * day carries null bench fields. The panel must render them as "—" in the muted
 * color. Before the fix the panel coloured the return with `benchReturn >= 0`, and
 * `null >= 0` is true in JS, so an uncovered BTC leg would read as a green figure
 * beside a comparator picker saying "BTC prices unavailable".
 */
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { buildFactsheetPayload } from "@/lib/factsheet/build-payload";
import type { FactsheetPayload, StressWindowPayload } from "@/lib/factsheet/types";

import { FactsheetProvider } from "./factsheet-context";
import { StressWindowsPanel } from "./StressWindowsPanel";

const STRESS: StressWindowPayload = {
  windows: [
    {
      name: "Aug 2024 unwind",
      note: "JPY carry-trade unwind",
      start: "2024-08-02",
      end: "2024-08-09",
      days: 8,
      expectedCalendarDays: 8,
      coverage: "full",
      stratReturn: -0.031,
      benchReturn: null,
      stratMaxDD: -0.042,
      benchMaxDD: null,
    },
  ],
  benchName: "BTC",
  totalCatalogued: 5,
  droppedOutOfRange: 4,
  droppedPartial: 0,
};

function payloadWithStress(): FactsheetPayload {
  const dailyReturns = Array.from({ length: 300 }, (_, i) => ({
    date: new Date(Date.UTC(2024, 0, i + 1)).toISOString().slice(0, 10),
    value: Math.sin(i / 9) * 0.006,
  }));
  const payload = buildFactsheetPayload(
    {
      id: "stress-null-bench",
      name: "Stress Null Bench",
      types: ["test"],
      markets: ["crypto"],
      computedAt: "2026-09-30T00:00:00Z",
      trustTier: null,
    },
    dailyReturns,
  );
  if (!payload) throw new Error("buildFactsheetPayload returned null in test");
  return { ...payload, stressWindows: STRESS };
}

describe("StressWindowsPanel — CR-01 null bench fields", () => {
  it("renders an uncovered comparator leg as a muted em-dash, never a coloured figure", () => {
    const { container } = render(
      <FactsheetProvider payload={payloadWithStress()}>
        <StressWindowsPanel />
      </FactsheetProvider>,
    );
    const row = container.querySelector("tbody tr");
    expect(row).not.toBeNull();
    const cells = Array.from(row!.querySelectorAll("td"));
    const [benchRet, benchDD] = cells.slice(-2);
    expect(benchRet.textContent).toBe("—");
    expect(benchDD.textContent).toBe("—");
    expect(benchRet.getAttribute("style")).toContain("var(--color-text-muted)");
    expect(benchDD.getAttribute("style")).toContain("var(--color-text-muted)");
    // The strategy side is real data and still renders.
    expect(cells[3].textContent).toBe("-3.1%");
  });
});
