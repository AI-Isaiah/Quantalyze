/** @vitest-environment jsdom */
/**
 * Regression: F1 (QA 2026-06-30) — the factsheet "Stress Windows" panel rendered
 * a raw <table> with no horizontal-scroll wrapper, so its intrinsic column width
 * (~496px) pushed the whole page ~97px wider than a 320px viewport (WCAG 1.4.10
 * Reflow — horizontal page scroll on mobile). The other factsheet/holdings tables
 * were wrapped in ResponsiveTable during v1.3 P46; this stress-events table was
 * missed. The fix wraps it in ResponsiveTable (overflow-x-auto + role=region).
 *
 * This test pins the fix: the table must stay inside a horizontally-scrollable
 * landmark region. Remove the ResponsiveTable wrapper and `closest('[role=region]')`
 * is null → this fails. Found by /qa on 2026-06-30.
 * Report: .gstack/qa-reports/qa-report-quantalyze-xyz-2026-06-30.md
 */
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { buildFactsheetPayload } from "@/lib/factsheet/build-payload";
import type { FactsheetPayload, StressWindowPayload } from "@/lib/factsheet/types";

import { FactsheetProvider } from "./factsheet-context";
import { StressWindowsPanel } from "./StressWindowsPanel";

// One real-shaped stress window so the panel renders the TABLE branch (not the
// honest empty state). Values are illustrative; the panel only formats them.
const STRESS: StressWindowPayload = {
  windows: [
    {
      name: "Aug 2024 unwind",
      note: "JPY carry-trade unwind",
      start: "2024-08-01T00:00:00Z",
      end: "2024-08-09T00:00:00Z",
      days: 7,
      expectedCalendarDays: 9,
      coverage: "full",
      stratReturn: -0.031,
      benchReturn: -0.085,
      stratMaxDD: -0.042,
      benchMaxDD: -0.11,
    },
  ],
  benchName: "BTC",
  totalCatalogued: 5,
  droppedOutOfRange: 4,
  droppedPartial: 0,
};

function payloadWithStress(): FactsheetPayload {
  const dailyReturns = Array.from({ length: 300 }).map((_, i) => ({
    date: `2024-${String((i % 12) + 1).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")}`,
    value: Math.sin(i / 9) * 0.006,
  }));
  const payload = buildFactsheetPayload(
    {
      id: "stress-test",
      name: "Stress Test",
      types: ["test"],
      markets: ["crypto"],
      computedAt: "2026-06-27T00:00:00Z",
      trustTier: null,
      ingestSource: "api",
    },
    dailyReturns,
  );
  if (!payload) throw new Error("buildFactsheetPayload returned null in test");
  // Override with a guaranteed non-empty window set so the table branch renders
  // regardless of whether the synthetic dates overlap the catalogue.
  return { ...payload, stressWindows: STRESS };
}

describe("StressWindowsPanel — 320px reflow regression (F1)", () => {
  it("wraps the stress table in a horizontally-scrollable landmark region", () => {
    const { container } = render(
      <FactsheetProvider payload={payloadWithStress()}>
        <StressWindowsPanel />
      </FactsheetProvider>,
    );

    const table = container.querySelector("table");
    expect(table).not.toBeNull();

    // The fix: the table must live inside a ResponsiveTable scroll region, or its
    // intrinsic width reflows the page past a 320px viewport.
    const region = table!.closest('[role="region"]');
    expect(region).not.toBeNull();
    expect(region!.className).toContain("overflow-x-auto");

    // Distinct accessible name keeps axe landmark-unique on the multi-panel
    // factsheet (ResponsiveTable's documented contract).
    expect(region!.getAttribute("aria-label")).toMatch(/stress windows/i);
  });
});
