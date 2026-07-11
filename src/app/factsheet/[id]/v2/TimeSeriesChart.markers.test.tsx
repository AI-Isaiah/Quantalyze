import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import type { DailyPoint } from "@/lib/portfolio-math-utils";
import type { FactsheetPayload } from "@/lib/factsheet/types";
import { buildScenarioFactsheetPayload } from "@/app/(dashboard)/allocations/widgets/performance/scenario-factsheet-payload";
import { CHART_CONFIGS, type ChartConfig } from "./chart-configs";
import { FactsheetProvider } from "./factsheet-context";
import { TimeSeriesChart } from "./TimeSeriesChart";

/**
 * Phase 90 Wave-0 (90-02 Task 1) — TDD RED scaffold for the FS-01 per-key
 * boundary markers + FS-02 gap markers rendered INSIDE the real
 * `TimeSeriesChart` SVG (UI-SPEC §2/§3), PLUS the D7 replacement-behavior pin
 * that the phase-52-frozen-spine-guards carve-out names.
 *
 * Two kinds of assertion live here on purpose:
 *   - RED (assertions 1–4): pin the marker geometry/copy/containment that lands
 *     in 90-04. They FAIL today because the overlay `<g>` does not exist yet —
 *     that is the point (do NOT green them here).
 *   - GREEN-by-construction (assertions 5–6): the D7 replacement pin — the
 *     additive `segmentMarkers` flag with NO boundary/gap payload fields renders
 *     ZERO markers, and the fields present with the flag OFF also render zero.
 *     These pass today AND after 90-04, proving single-key / flag-off parity
 *     (the whole reason TimeSeriesChart is safe to carve out of FROZEN_ISLANDS).
 *
 * DOM-level only: it imports NO not-yet-existing module (no basis-context /
 * basis-metrics). The not-yet-existing payload fields + the `segmentMarkers`
 * config flag are supplied via casts (per 90-02 <interfaces>), so `tsc --noEmit`
 * stays clean while the real type fields land in 90-03/90-04.
 *
 * localStorage + sentry are stubbed because FactsheetProvider's persistence
 * primitive touches them on mount (even at persist={false}). Stub block mirrors
 * FactsheetBody.scenario-mode.test.tsx verbatim.
 */

vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: vi.fn() }));

const lsStore = new Map<string, string>();
const localStorageMock = {
  getItem: vi.fn((k: string) => lsStore.get(k) ?? null),
  setItem: vi.fn((k: string, v: string) => {
    lsStore.set(k, v);
  }),
  removeItem: vi.fn((k: string) => {
    lsStore.delete(k);
  }),
  clear: vi.fn(() => lsStore.clear()),
  key: vi.fn(() => null),
  length: 0,
};
vi.stubGlobal("localStorage", localStorageMock);
Object.defineProperty(window, "localStorage", {
  value: localStorageMock,
  configurable: true,
});

// A SPARSE 12-date composite fixture with ONE gap. The gap days are simply
// ABSENT from the date axis (FS-02 / CONTEXT D4) — NEVER 0.0-filled to widen a
// span. Indices 0–5 sit in early January, then a 34-day hole, then indices
// 6–11 in mid-February. dates[5] is a PRESENT date and is the boundary seam.
const SPARSE_DATES = [
  "2023-01-02", // 0
  "2023-01-03", // 1
  "2023-01-04", // 2
  "2023-01-05", // 3
  "2023-01-06", // 4
  "2023-01-09", // 5  ← boundary seam (Key 2 track begins)
  "2023-02-13", // 6  ← first present date after the gap
  "2023-02-14", // 7
  "2023-02-15", // 8
  "2023-02-16", // 9
  "2023-02-17", // 10
  "2023-02-20", // 11
];
// Deterministic finite, non-zero daily returns (no synthetic 0.0 anywhere).
const SPARSE_RETURNS = [
  0.011, -0.004, 0.008, -0.006, 0.013, -0.009, 0.007, 0.01, -0.005, 0.012,
  -0.003, 0.006,
];

const BOUNDARY = { date: SPARSE_DATES[5], seq: 2, label: "Key 2" };
const GAP = { start: "2023-01-10", end: "2023-02-12", kind: "gap" as const, days: 34 };

function sparsePoints(): DailyPoint[] {
  return SPARSE_DATES.map((date, i) => ({ date, value: SPARSE_RETURNS[i] }));
}

/** Composite fixture carrying the FS-01/FS-02 marker fields (cast until 90-03). */
function compositePayload(): FactsheetPayload {
  const base = buildScenarioFactsheetPayload({ portfolioDaily: sparsePoints() });
  return {
    ...base,
    segmentBoundaries: [BOUNDARY],
    missingSegments: [GAP],
    dataQuality: { composite: true },
  } as unknown as FactsheetPayload;
}

/** Same sparse series, but WITHOUT the marker fields (single-key analog). */
function payloadNoMarkerFields(): FactsheetPayload {
  return buildScenarioFactsheetPayload({
    portfolioDaily: sparsePoints(),
  }) as unknown as FactsheetPayload;
}

const cumulativeCfg = CHART_CONFIGS.find((c) => c.key === "cumulative")!;
// The real cumulative config + the additive opt-in flag (lands on ChartConfig in
// 90-04). Cast per 90-02 <interfaces>.
const markersConfig = { ...cumulativeCfg, segmentMarkers: true } as ChartConfig;
// Fields present but the flag OFF → the overlay must stay off. Explicitly
// disable the flag: 90-04 Task 1 lands `segmentMarkers: true` on the REAL
// cumulative config (load-bearing — the feature is dead in prod without it), so
// the raw `cumulativeCfg` is now flag-ON. Force it off here to keep this pin's
// stated intent ("segmentMarkers OFF → zero markers") honest.
const noMarkersConfig = { ...cumulativeCfg, segmentMarkers: false } as ChartConfig;

function renderChart(payload: FactsheetPayload, config: ChartConfig) {
  return render(
    <FactsheetProvider payload={payload} persist={false}>
      <TimeSeriesChart config={config} />
    </FactsheetProvider>,
  );
}

/** All the "is this a marker" DOM predicates in one place. */
const DASHED_BOUNDARY = 'line[stroke-dasharray="4 3"]';
function mutedStroke(el: Element): boolean {
  return (el.getAttribute("stroke") ?? "").includes("--color-text-muted");
}
function isHatch(p: Element): boolean {
  return (p.getAttribute("patternTransform") ?? "").includes("rotate(45)");
}

describe("TimeSeriesChart — Phase 90 FS-01/FS-02 markers (RED until 90-04)", () => {
  it("FS-01 (RED): one muted dashed boundary line + mono seq label + exact AT <title>", () => {
    const { container } = renderChart(compositePayload(), markersConfig);

    const boundaryLines = Array.from(
      container.querySelectorAll(DASHED_BOUNDARY),
    ).filter(mutedStroke);
    expect(
      boundaryLines.length,
      "exactly one dashed muted boundary line",
    ).toBe(1);

    const seqLabel = Array.from(container.querySelectorAll("text")).find(
      (t) =>
        t.textContent === "2" &&
        (t.getAttribute("font-family") ?? "").includes("--font-mono"),
    );
    expect(seqLabel, "mono seq label '2' at the seam").toBeDefined();

    const title = Array.from(container.querySelectorAll("title")).find(
      (t) => t.textContent === `Key 2 track begins ${BOUNDARY.date}`,
    );
    expect(title, "boundary <title> AT copy").toBeDefined();
  });

  it("FS-01 (RED): boundary carries a data-idx equal to the resolved date index (jsdom-pixel-independent)", () => {
    const { container } = renderChart(compositePayload(), markersConfig);
    const idxNode = container.querySelector("[data-idx]");
    expect(idxNode, "boundary group must expose a data-idx").not.toBeNull();
    // Deterministic index-space check — does NOT depend on jsdom pixel widths.
    const resolved = String(compositePayload().dates.indexOf(BOUNDARY.date));
    expect(resolved).toBe("5");
    expect(idxNode!.getAttribute("data-idx")).toBe(resolved);
  });

  it("FS-02 (RED): hatched gap pattern + NEUTRAL '34d — no data' label + exact AT <title>", () => {
    const { container } = renderChart(compositePayload(), markersConfig);

    const hatch = Array.from(container.querySelectorAll("pattern")).find(isHatch);
    expect(hatch, "45° hatch pattern for the gap seam").toBeDefined();

    const gapLabel = Array.from(container.querySelectorAll("text")).find(
      (t) => t.textContent === "34d — no data",
    );
    expect(gapLabel, "neutral gap label").toBeDefined();
    // Copy is honest, not alarm — never "missing"/"error"/"0.0".
    expect(gapLabel?.textContent ?? "").not.toMatch(/missing|error|0\.0/);

    const title = Array.from(container.querySelectorAll("title")).find(
      (t) =>
        t.textContent ===
        `No data ${GAP.start} → ${GAP.end} (${GAP.days} days)`,
    );
    expect(title, "gap <title> AT copy").toBeDefined();
  });

  it("FS-01/FS-02 (RED): every marker node lives inside the chart <svg> and a pointer-events-none <g> (export-safe, D4)", () => {
    const { container } = renderChart(compositePayload(), markersConfig);
    const svg = container.querySelector('svg[role="img"]');
    expect(svg, "the chart svg root").not.toBeNull();

    // A marker-bearing overlay group: pointer-events none AND containing a
    // boundary dashed line or the gap label. (The existing baseline/gridline
    // pointer-events-none groups contain neither, so they don't false-match.)
    const markerGroup = Array.from(svg!.querySelectorAll("g")).find(
      (g) =>
        g.getAttribute("pointer-events") === "none" &&
        (g.querySelector(DASHED_BOUNDARY) !== null ||
          (g.textContent ?? "").includes("no data")),
    );
    expect(
      markerGroup,
      "a <g pointer-events='none'> holding the markers must exist inside the svg",
    ).toBeDefined();
  });
});

describe("TimeSeriesChart — Phase 90 L-1: boundary on a guard/absent day", () => {
  // "2023-01-08" is NOT in SPARSE_DATES (present days jump 01-06 → 01-09). A
  // member whose first_day landed on a guard/NaN day is absent from the axis, so
  // indexOfDate misses; the fix falls back to the first PRESENT day at/after it.
  const GUARD_BOUNDARY = { date: "2023-01-08", seq: 2, label: "Key 2" };

  function guardBoundaryPayload(): FactsheetPayload {
    const base = buildScenarioFactsheetPayload({ portfolioDaily: sparsePoints() });
    return {
      ...base,
      segmentBoundaries: [GUARD_BOUNDARY],
      missingSegments: [],
      dataQuality: { composite: true },
    } as unknown as FactsheetPayload;
  }

  it("renders the seam at the first PRESENT day after an absent boundary date (not silently dropped)", () => {
    const { container } = renderChart(guardBoundaryPayload(), markersConfig);
    const boundaryLines = Array.from(
      container.querySelectorAll(DASHED_BOUNDARY),
    ).filter(mutedStroke);
    // Pre-fix: indexOfDate("2023-01-08") === -1 → the seam vanished (0 lines).
    expect(
      boundaryLines.length,
      "the seam must render at the first present day after the absent boundary date",
    ).toBe(1);
    // "2023-01-08" resolves to index 5 ("2023-01-09"), the first present day after it.
    const idxNode = container.querySelector("[data-idx]");
    expect(idxNode?.getAttribute("data-idx")).toBe("5");
  });
});

describe("TimeSeriesChart — Phase 90 D7 replacement pin (GREEN today AND after)", () => {
  it("GREEN: segmentMarkers=true but NO boundary/gap fields → zero markers", () => {
    const { container } = renderChart(payloadNoMarkerFields(), markersConfig);
    expect(
      Array.from(container.querySelectorAll(DASHED_BOUNDARY)).filter(mutedStroke)
        .length,
    ).toBe(0);
    expect(
      Array.from(container.querySelectorAll("pattern")).filter(isHatch).length,
    ).toBe(0);
    expect(
      Array.from(container.querySelectorAll("text")).filter((t) =>
        /no data/.test(t.textContent ?? ""),
      ).length,
    ).toBe(0);
  });

  it("GREEN: boundary/gap fields present but segmentMarkers OFF → zero markers", () => {
    const { container } = renderChart(compositePayload(), noMarkersConfig);
    expect(
      Array.from(container.querySelectorAll(DASHED_BOUNDARY)).filter(mutedStroke)
        .length,
    ).toBe(0);
    expect(
      Array.from(container.querySelectorAll("pattern")).filter(isHatch).length,
    ).toBe(0);
    expect(
      Array.from(container.querySelectorAll("text")).filter((t) =>
        /no data/.test(t.textContent ?? ""),
      ).length,
    ).toBe(0);
  });
});
