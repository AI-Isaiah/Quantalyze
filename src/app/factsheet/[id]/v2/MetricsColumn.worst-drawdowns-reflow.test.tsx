/** @vitest-environment jsdom */
/**
 * Regression: F1 follow-up (QA 2026-06-30) — the factsheet "Worst 10 Drawdowns"
 * table rendered as a raw <table> (10.5px / 0.65625rem font, 8 columns) with no
 * horizontal-scroll wrapper. It was the SECOND of two factsheet tables that
 * pushed the whole page ~97px past a 320px viewport (WCAG 1.4.10 Reflow); the
 * Stress Windows table was wrapped in the prior fix (v0.35.0.13), but the live
 * 320px canary still reflowed because this table was missed. This wraps it in
 * ResponsiveTable too. Pins the table inside a horizontally-scrollable region —
 * remove the wrapper and closest('[role=region]') is null, so this fails.
 * Found by /qa (authed prod canary) on 2026-06-30.
 * Report: .gstack/qa-reports/qa-report-quantalyze-xyz-2026-06-30.md
 */
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { buildFactsheetPayload } from "@/lib/factsheet/build-payload";
import type { FactsheetPayload } from "@/lib/factsheet/types";

import { FactsheetProvider } from "./factsheet-context";
import { MetricsColumn, isoToMonthDay } from "./MetricsColumn";

function payloadWithWorst10(): FactsheetPayload {
  const dailyReturns = Array.from({ length: 300 }).map((_, i) => ({
    date: `2024-${String((i % 12) + 1).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")}`,
    value: Math.sin(i / 9) * 0.01,
  }));
  const payload = buildFactsheetPayload(
    {
      id: "wd-test",
      name: "WD Test",
      types: ["test"],
      markets: ["crypto"],
      computedAt: "2026-06-27T00:00:00Z",
      trustTier: null,
      ingestSource: "api",
    },
    dailyReturns,
  );
  if (!payload) throw new Error("buildFactsheetPayload returned null in test");
  // Guarantee the "Worst 10 Drawdowns" panel renders its table branch
  // (indices reference payload.dates, populated by the 300 synthetic returns).
  return {
    ...payload,
    strategyWorst10: [
      { start: 5, trough: 20, recover: 40, depth: -0.31 },
      { start: 60, trough: 80, recover: 120, depth: -0.22 },
    ],
  };
}

describe("MetricsColumn — Worst Drawdowns 320px reflow regression (F1 follow-up)", () => {
  it("wraps the Worst Drawdowns table in a horizontally-scrollable landmark region", () => {
    const { container } = render(
      <FactsheetProvider payload={payloadWithWorst10()}>
        <MetricsColumn />
      </FactsheetProvider>,
    );

    // The Worst Drawdowns table is the one using the 10.5px (0.65625rem) font.
    const table = [...container.querySelectorAll("table")].find(t =>
      /0\.65625rem/.test(t.className),
    );
    expect(table).toBeTruthy();

    const region = table!.closest('[role="region"]');
    expect(region).not.toBeNull();
    expect(region!.className).toContain("overflow-x-auto");
    expect(region!.getAttribute("aria-label")).toMatch(/worst.*drawdowns/i);
  });

  // Phase 201 (D-11): the three date cells print through the one date helper ("Oct 9, 2026",
  // which has spaces) and must not wrap, or a date breaks across two lines in a 320px column.
  it("prints the start, trough and recovery dates as 'Mon D, YYYY' in nowrap cells", () => {
    const payload = payloadWithWorst10();
    const { container } = render(
      <FactsheetProvider payload={payload}>
        <MetricsColumn />
      </FactsheetProvider>,
    );
    const table = [...container.querySelectorAll("table")].find(t => /0\.65625rem/.test(t.className))!;
    const first = table.querySelector("tbody tr")!;
    const cells = [...first.querySelectorAll("td")].slice(1, 4);
    expect(cells.map(td => td.textContent)).toEqual(
      [5, 20, 40].map(i => isoToMonthDay(payload.dates[i])),
    );
    for (const td of cells) {
      expect(td.textContent).toMatch(/^[A-Z][a-z]{2} \d{1,2}, \d{4}$/);
      expect(td.className, "a date cell must not wrap").toContain("whitespace-nowrap");
    }
  });

  it("isoToMonthDay keeps its export and prints the one format, with the dash for a missing date", () => {
    expect(isoToMonthDay("2026-10-09")).toBe("Oct 9, 2026");
    expect(isoToMonthDay("2026-01-01")).toBe("Jan 1, 2026");
    expect(isoToMonthDay("")).toBe("—");
    expect(isoToMonthDay("not a date")).toBe("—");
  });
});
