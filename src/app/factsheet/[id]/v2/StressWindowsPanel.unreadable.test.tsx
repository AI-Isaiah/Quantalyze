/** @vitest-environment jsdom */
/**
 * 194.2 R2: a series whose EARLIEST date is unreadable withholds its stress windows. The
 * empty-series answer would have counted every catalogued window as outside the observation
 * period and the panel would have said so, which is false: the dates could not be read, so
 * nothing could be placed inside or outside the record.
 */
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { buildFactsheetPayload, deriveSeriesBundle } from "@/lib/factsheet/build-payload";

import { FactsheetProvider } from "./factsheet-context";
import { advancedSectionContent } from "./FactsheetView";
import { StressWindowsPanel } from "./StressWindowsPanel";

/** The 300 readable days every case below builds on (2024-01-02 onward). */
function readableDays() {
  return Array.from({ length: 300 }, (_, i) => ({
    date: new Date(Date.UTC(2024, 0, i + 2)).toISOString().slice(0, 10),
    value: Math.sin(i / 9) * 0.006,
  }));
}

const STRATEGY = {
  id: "stress-unreadable",
  name: "Stress Unreadable",
  types: ["test"],
  markets: ["crypto"],
  computedAt: "2026-09-30T00:00:00Z",
  trustTier: null,
};

function payloadWithFirstDate(firstDate: string) {
  const payload = buildFactsheetPayload(STRATEGY, [{ date: firstDate, value: 0.001 }, ...readableDays()]);
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

/**
 * 205 D-02 (194.2-REVIEW-R3 WR-02): the withheld stress line is a claim about the RECORD ("the
 * record's dates could not be read"), so the record's one verdict decides it, wherever the bad date
 * sits and on a levered re-derive too. Before, only the bundle's own FIRST date was tested: an
 * interior bad date withheld the record's annualised figures yet still printed a stress table, and
 * the USD view (which never sees the native day 0) printed one under a withheld native view.
 */
describe("205 D-02: the stress block follows the record's verdict", () => {
  const INTERIOR_MSG = "Stress windows are not shown: the record's dates could not be read.";

  it("an interior unreadable date withholds the stress windows and the panel says so", () => {
    const rows = readableDays();
    // 2024-06-30 is element 180; 2024-06-31 sorts between it and 2024-07-01, so only the date is bad.
    expect(rows[180].date).toBe("2024-06-30");
    rows[180] = { date: "2024-06-31", value: rows[180].value };
    const payload = buildFactsheetPayload(STRATEGY, rows);
    if (!payload) throw new Error("buildFactsheetPayload returned null in test");
    expect(payload.figureRecord?.unreadable).toBe(true);
    expect(payload.stressWindows.unreadable).toBe(true);
    expect(payload.stressWindows.windows).toEqual([]);
    const { container } = render(
      <FactsheetProvider payload={payload}>
        <StressWindowsPanel />
      </FactsheetProvider>,
    );
    const text = container.textContent ?? "";
    expect(text).toContain(INTERIOR_MSG);
    expect(text).not.toContain("outside this strategy's observation period");
  });

  it("the leverage re-derive withholds on the record verdict and computes on a readable record (control)", () => {
    const rows = readableDays();
    const payload = buildFactsheetPayload(STRATEGY, rows);
    if (!payload?.figureRecord) throw new Error("readable fixture must build a record");
    const args = {
      periodsPerYear: payload.periodsPerYear!,
      isArithmetic: false,
      markets: payload.markets,
      strategyName: payload.strategyName,
      benchmarkPrices: payload.benchmarkPrices ?? { unavailable: true as const },
    };
    // The series' own dates are all readable: only the record's verdict can withhold here.
    const withheld = deriveSeriesBundle(rows, { ...args, figureRecord: { ...payload.figureRecord, unreadable: true } });
    expect(withheld.stressWindows.unreadable).toBe(true);
    expect(withheld.stressWindows.windows).toEqual([]);
    const control = deriveSeriesBundle(rows, { ...args, figureRecord: payload.figureRecord });
    expect(control.stressWindows.unreadable).toBeUndefined();
    expect(control.stressWindows.totalCatalogued).toBeGreaterThan(0);
  });

  it("a bad date on the MTM series withholds the stress block on the MTM and smoothed bundles too", () => {
    const rows = readableDays();
    const mtm = [...rows];
    mtm[100] = { date: `${mtm[100].date}x`, value: mtm[100].value };
    const payload = buildFactsheetPayload(STRATEGY, rows, {
      mtmSeries: { dailyReturns: mtm, gapSpans: [] },
      smoothedSeries: { dailyReturns: rows, gapSpans: [] },
    });
    if (!payload) throw new Error("buildFactsheetPayload returned null in test");
    expect(payload.figureRecord?.unreadable).toBe(true);
    // Each bundle's own first date is readable, so only the record verdict withholds these.
    for (const basis of ["mark_to_market", "smoothed_mtm"] as const) {
      const stress = payload.seriesByBasis![basis]!.stressWindows;
      expect(stress.unreadable).toBe(true);
      expect(stress.windows).toEqual([]);
    }
  });
});

/**
 * 205 D-03 (194.2-REVIEW-R3 WR-03): on the api arm, every PROD strategy, an unreadable record used
 * to throw `RangeError` out of `alignBlend`'s `isoDayBefore(dates[0])` and send `/factsheet/<id>` to
 * the route error page for every visitor. The record verdict now withholds the allocator blends
 * (`allocatorPortfolios: null`) instead; no date guard lives in `alignBlend`.
 *
 * The readable days start 2024-10-02 so that each listed date is the FIRST date by string order
 * (`""` < `"2023-13-01"` < `"2024-02-30"` < `"2024-1-5"` < `"2024-10-02"`); the `readableDays()` range
 * above would sort `"2024-1-5"` and `"2024-02-30"` into the interior. `"2024-02-30"` is accepted by
 * `Date.parse` (it rolls to 2024-03-01), so it is the date that never threw at the first position;
 * whether the others throw is observed, not assumed.
 */
describe("205 D-03: the api arm withholds the allocator blends on an unreadable record", () => {
  function apiDaysFrom2024_10_02() {
    return Array.from({ length: 300 }, (_, i) => ({
      date: new Date(Date.UTC(2024, 9, i + 2)).toISOString().slice(0, 10),
      value: Math.sin(i / 9) * 0.006,
    }));
  }

  function apiPayloadWithFirstDate(firstDate: string) {
    const payload = buildFactsheetPayload(
      { ...STRATEGY, ingestSource: "api" as const },
      [{ date: firstDate, value: 0.001 }, ...apiDaysFrom2024_10_02()],
    );
    if (!payload) throw new Error("buildFactsheetPayload returned null in test");
    return payload;
  }

  it.each(["", "2023-13-01", "2023-02-32", "2024-1-5", "2024-02-30"])(
    "an api build whose first date is %j returns a withheld payload with null blends",
    (bad) => {
      const payload = apiPayloadWithFirstDate(bad);
      expect(payload.dates[0]).toBe(bad);
      expect(payload.ingestSource).toBe("api");
      if (payload.ingestSource !== "api") throw new Error("expected the api arm");
      expect(payload.figureRecord?.unreadable).toBe(true);
      expect(payload.allocatorPortfolios).toBeNull();
      expect(payload.stressWindows.unreadable).toBe(true);
    },
  );

  it("a readable api record keeps its three blends (control)", () => {
    const payload = apiPayloadWithFirstDate("2024-10-01");
    expect(payload.dates[0]).toBe("2024-10-01");
    if (payload.ingestSource !== "api") throw new Error("expected the api arm");
    expect(payload.figureRecord?.unreadable).toBeFalsy();
    expect(payload.allocatorPortfolios).toHaveLength(3);
  });
});
