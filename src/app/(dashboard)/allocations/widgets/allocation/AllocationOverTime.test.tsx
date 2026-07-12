import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import type { AllocationPoint, AsofGap } from "@/lib/portfolio-exposure";
import { AllocationOverTime, buildAllocationChartData } from "./AllocationOverTime";

// ---------------------------------------------------------------------------
// Recharts ResponsiveContainer needs a measured container; the stacked <Area>
// series supply the cartesian scale recharts needs to build the axis (and thus
// render the ReferenceArea gap-band shapes) under jsdom.
// ---------------------------------------------------------------------------
vi.mock("recharts", async () => {
  const actual = await vi.importActual<typeof import("recharts")>("recharts");
  const React = await vi.importActual<typeof import("react")>("react");
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactElement }) =>
      React.cloneElement(children as React.ReactElement<Record<string, unknown>>, {
        width: 400,
        height: 260,
      }),
  };
});

const utc = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
};

const HALF_DAY_MS = 43_200_000;

const venue = (v: string, valueUsd: number, weight: number) => ({ venue: v, valueUsd, weight });
const ap = (asof: string, venues: AllocationPoint["venues"]): AllocationPoint => ({ asof, venues });

// binance dominant (mean 0.65) vs okx (mean 0.35) across two days.
const ALLOC_POINTS: AllocationPoint[] = [
  ap("2026-03-01", [venue("binance", 600_000, 0.6), venue("okx", 400_000, 0.4)]),
  ap("2026-03-02", [venue("binance", 700_000, 0.7), venue("okx", 300_000, 0.3)]),
];

describe("buildAllocationChartData — pivot + venue order", () => {
  it("orders venues by mean weight desc (largest first = bottom of stack) and pivots rows", () => {
    const { venues, rows } = buildAllocationChartData(ALLOC_POINTS, []);
    expect(venues).toEqual(["binance", "okx"]);
    const day1 = rows.find((r) => r.asofMs === utc("2026-03-01"))!;
    expect(day1.binance).toBe(0.6);
    expect(day1.okx).toBe(0.4);
  });

  it("carries per-venue gross USD keyed by asofMs for the tooltip", () => {
    const { usdByAsofMs } = buildAllocationChartData(ALLOC_POINTS, []);
    expect(usdByAsofMs.get(utc("2026-03-01"))).toEqual({ binance: 600_000, okx: 400_000 });
  });
});

describe("buildAllocationChartData — absent venue is a TRUE 0", () => {
  it("stacks an absent venue at weight 0, never undefined/null", () => {
    const points = [
      ap("2026-03-01", [venue("binance", 1_000, 1.0)]),
      ap("2026-03-02", [venue("binance", 500, 0.5), venue("okx", 500, 0.5)]),
    ];
    const { rows } = buildAllocationChartData(points, []);
    const day1 = rows.find((r) => r.asofMs === utc("2026-03-01"))!;
    expect(day1.okx).toBe(0);
    expect(day1.okx).not.toBeUndefined();
    expect(day1.okx).not.toBeNull();
  });
});

describe("buildAllocationChartData — gap sentinel breaks the stack", () => {
  it("injects EXACTLY ONE all-null sentinel row per gap at mid-gap ms", () => {
    const points = [
      ap("2026-01-01", [venue("binance", 100, 1)]),
      ap("2026-01-10", [venue("binance", 100, 1)]),
    ];
    const gaps: AsofGap[] = [{ start: "2026-01-02", end: "2026-01-09", kind: "gap", days: 8 }];
    const { rows, venues } = buildAllocationChartData(points, gaps);
    const sentinels = rows.filter((r) => venues.every((v) => r[v] === null));
    expect(sentinels).toHaveLength(1);
    expect(sentinels[0].asofMs).toBe((utc("2026-01-02") + utc("2026-01-09")) / 2);
  });
});

describe("buildAllocationChartData + render — F-2 boundary gap", () => {
  const points = [
    ap("2026-01-04", [venue("binance", 100, 1)]),
    ap("2026-01-05", [venue("binance", 100, 1)]),
  ];
  const gaps: AsofGap[] = [{ start: "2026-01-01", end: "2026-01-03", kind: "gap", days: 3 }];

  it("extends the x-domain to the leading gap edge (< first point ms)", () => {
    const { domain } = buildAllocationChartData(points, gaps);
    expect(domain[0]).toBe(utc("2026-01-01") - HALF_DAY_MS);
    expect(domain[0]).toBeLessThan(utc("2026-01-04"));
  });

  it("renders a marked hatched band <title> BEFORE the first stacked point", () => {
    const { container } = render(<AllocationOverTime points={points} gaps={gaps} />);
    const titles = Array.from(container.querySelectorAll("title")).map((t) => t.textContent);
    expect(titles).toContain("No data 2026-01-01 → 2026-01-03 (3 days)");
  });
});

describe("AllocationOverTime — empty state", () => {
  it("renders the EXACT two-line honest-empty copy and no svg", () => {
    const { container } = render(<AllocationOverTime points={[]} gaps={[]} />);
    expect(screen.getByText("No allocation history yet.")).toBeTruthy();
    expect(
      screen.getByText("Per-venue weights build as daily position snapshots accrue."),
    ).toBeTruthy();
    expect(container.querySelector("svg")).toBeNull();
  });
});

describe("AllocationOverTime — single-venue book", () => {
  it("renders exactly one legend chip and a 100% band, no special casing", () => {
    const points = [
      ap("2026-01-01", [venue("binance", 100, 1)]),
      ap("2026-01-02", [venue("binance", 100, 1)]),
    ];
    const { venues, rows } = buildAllocationChartData(points, []);
    expect(venues).toEqual(["binance"]);
    expect(rows.find((r) => r.asofMs === utc("2026-01-01"))!.binance).toBe(1);
    render(<AllocationOverTime points={points} gaps={[]} />);
    // getByText throws on >1 match — proves exactly one legend chip.
    expect(screen.getByText("binance")).toBeTruthy();
  });
});

describe("AllocationOverTime — header + a11y", () => {
  it("carries the title, the last-point as-of stamp, and role=img aria-label", () => {
    render(<AllocationOverTime points={ALLOC_POINTS} gaps={[]} />);
    expect(
      screen.getByRole("img", { name: "Per-venue allocation weights over time" }),
    ).toBeTruthy();
    expect(screen.getByText("Allocation over time")).toBeTruthy();
    expect(screen.getByText("as of 2026-03-02")).toBeTruthy();
  });
});
