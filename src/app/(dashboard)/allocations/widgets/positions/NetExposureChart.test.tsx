import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import type { AsofGap, NetExposurePoint } from "@/lib/portfolio-exposure";
import { NetExposureChart, buildNetChartData } from "./NetExposureChart";

// ---------------------------------------------------------------------------
// Recharts ResponsiveContainer needs a measured container; a cartesian series
// is also required for recharts to build the axis scale (and render
// ReferenceArea shapes) under jsdom — the chart itself supplies Area+Line.
// ---------------------------------------------------------------------------
vi.mock("recharts", async () => {
  const actual = await vi.importActual<typeof import("recharts")>("recharts");
  const React = await vi.importActual<typeof import("react")>("react");
  return {
    ...actual,
    // Give the chart concrete dimensions so recharts builds the axis scale (and
    // thus renders ReferenceArea gap-band shapes) under jsdom.
    ResponsiveContainer: ({ children }: { children: React.ReactElement }) =>
      React.cloneElement(children as React.ReactElement<Record<string, unknown>>, {
        width: 400,
        height: 240,
      }),
  };
});

const utc = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
};

const pt = (asof: string, netUsd: number, grossUsd: number): NetExposurePoint => ({
  asof,
  netUsd,
  grossUsd,
});

// A hedged book across an interior gap: long+short before, gap, resume after.
const HEDGED_POINTS: NetExposurePoint[] = [
  pt("2026-01-01", 200, 400),
  pt("2026-01-02", 180, 360),
  pt("2026-01-03", 200, 400),
  pt("2026-01-10", 150, 300),
  pt("2026-01-11", 160, 320),
  pt("2026-01-12", 150, 300),
];
const HEDGED_GAP: AsofGap[] = [{ start: "2026-01-04", end: "2026-01-09", kind: "gap", days: 6 }];

describe("buildNetChartData — null sentinel + sorted rows", () => {
  it("injects EXACTLY ONE all-null sentinel row per gap at mid-gap ms", () => {
    const { rows } = buildNetChartData(HEDGED_POINTS, HEDGED_GAP);
    const sentinels = rows.filter((r) => r.netUsd === null && r.grossUsd === null);
    expect(sentinels).toHaveLength(1);
    expect(sentinels[0].asofMs).toBe((utc("2026-01-04") + utc("2026-01-09")) / 2);
  });

  it("keeps observed rows with real values and sorts by asofMs ascending", () => {
    const { rows } = buildNetChartData(HEDGED_POINTS, HEDGED_GAP);
    const observed = rows.filter((r) => r.netUsd !== null);
    expect(observed).toHaveLength(6);
    const ms = rows.map((r) => r.asofMs);
    expect(ms).toEqual([...ms].sort((a, b) => a - b));
    // the sentinel sits BETWEEN the pre-gap and post-gap points
    const sentinelIdx = rows.findIndex((r) => r.netUsd === null);
    expect(rows[sentinelIdx - 1].asofMs).toBe(utc("2026-01-03"));
    expect(rows[sentinelIdx + 1].asofMs).toBe(utc("2026-01-10"));
  });
});

describe("honest zero ≠ gap", () => {
  it("renders a {net:0,gross:0} point as a REAL 0 row, never a null sentinel", () => {
    const points = [pt("2026-02-01", 100, 100), pt("2026-02-02", 0, 0), pt("2026-02-03", 50, 50)];
    const { rows } = buildNetChartData(points, []);
    const zeroRow = rows.find((r) => r.asofMs === utc("2026-02-02"));
    expect(zeroRow).toBeDefined();
    expect(zeroRow!.netUsd).toBe(0);
    expect(zeroRow!.grossUsd).toBe(0);
    // no sentinel exists at all (no gaps)
    expect(rows.some((r) => r.netUsd === null)).toBe(false);
  });

  it("no gap band covers an observed zero-gross day's asofMs", () => {
    const points = [pt("2026-02-01", 100, 100), pt("2026-02-02", 0, 0), pt("2026-02-03", 50, 50)];
    const { bands } = buildNetChartData(points, []);
    expect(bands).toHaveLength(0);
  });
});

describe("NetExposureChart — gap band rendered", () => {
  it("draws the factsheet <title> and the ≥5d label for a 6-day gap", () => {
    const { container } = render(<NetExposureChart points={HEDGED_POINTS} gaps={HEDGED_GAP} />);
    const titles = Array.from(container.querySelectorAll("title")).map((t) => t.textContent);
    expect(titles).toContain("No data 2026-01-04 → 2026-01-09 (6 days)");
    expect(container.textContent).toContain("6d — no data");
  });
});

describe("NetExposureChart — empty state", () => {
  it("renders the EXACT two-line honest-empty copy and no svg", () => {
    const { container } = render(<NetExposureChart points={[]} gaps={[]} />);
    expect(screen.getByText("No exposure history yet.")).toBeTruthy();
    expect(
      screen.getByText("The series builds as daily position snapshots accrue."),
    ).toBeTruthy();
    expect(container.querySelector("svg")).toBeNull();
  });
});

// F-1 guard: recharts (Dots.shouldRenderDots) strokes no PATH across <2 points,
// but DOES render an isolated single point as a dot even with dot={false}. These
// lock that behavior so a one-asof (day-one / demo-hero) book is never a blank
// plot — a recharts regression that dropped single-point dots would turn RED here.
describe("NetExposureChart — F-1 single-asof book is not blank", () => {
  it("renders a visible line dot for a one-point series (recharts strokes no path across <2 points)", () => {
    const { container } = render(<NetExposureChart points={[pt("2026-01-01", 200, 400)]} gaps={[]} />);
    // not the honest-empty card (that requires length 0)
    expect(screen.queryByText("No exposure history yet.")).toBeNull();
    // a real dot mark exists so the lone datapoint is visible, not an empty plot
    expect(container.querySelectorAll("circle.recharts-line-dot").length).toBeGreaterThan(0);
  });

  it("keeps dots OFF for a multi-point series (the stroked line carries it)", () => {
    const { container } = render(<NetExposureChart points={HEDGED_POINTS} gaps={HEDGED_GAP} />);
    expect(container.querySelectorAll("circle.recharts-line-dot").length).toBe(0);
  });
});

describe("NetExposureChart — a11y + header + legend", () => {
  it("carries role=img with the USD aria-label, the title, an as-of stamp, and Net/Gross chips", () => {
    render(<NetExposureChart points={HEDGED_POINTS} gaps={HEDGED_GAP} />);
    const img = screen.getByRole("img", {
      name: "Net and gross exposure over time in US dollars",
    });
    expect(img).toBeTruthy();
    expect(screen.getByText("Net exposure over time")).toBeTruthy();
    expect(screen.getByText("as of 2026-01-12")).toBeTruthy();
    expect(screen.getByText("Net")).toBeTruthy();
    expect(screen.getByText("Gross")).toBeTruthy();
  });
});
