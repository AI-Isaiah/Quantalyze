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

// Venue weights live under the "v:"-namespaced row key (F-3) so the unbounded
// venue space can never clobber the `asofMs` meta key.
const vk = (v: string) => `v:${v}`;

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
    expect(day1[vk("binance")]).toBe(0.6);
    expect(day1[vk("okx")]).toBe(0.4);
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
    expect(day1[vk("okx")]).toBe(0);
    expect(day1[vk("okx")]).not.toBeUndefined();
    expect(day1[vk("okx")]).not.toBeNull();
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
    const sentinels = rows.filter((r) => venues.every((v) => r[vk(v)] === null));
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
    expect(rows.find((r) => r.asofMs === utc("2026-01-01"))![vk("binance")]).toBe(1);
    render(<AllocationOverTime points={points} gaps={[]} />);
    // getByText throws on >1 match — proves exactly one legend chip.
    expect(screen.getByText("binance")).toBeTruthy();
  });
});

// F-1 guard: recharts (Dots.shouldRenderDots) draws no stacked BAND across <2
// points, but DOES render an isolated single point as a dot even with dot={false}.
// This locks that a one-asof (day-one / demo-hero) book is never a blank plot.
describe("AllocationOverTime — F-1 single-asof book is not blank", () => {
  it("renders a visible area dot for a one-point series (recharts strokes no band across <2 points)", () => {
    const points = [ap("2026-01-01", [venue("binance", 100, 1)])];
    const { container } = render(<AllocationOverTime points={points} gaps={[]} />);
    // not the honest-empty card
    expect(screen.queryByText("No allocation history yet.")).toBeNull();
    // a real dot mark exists so the lone datapoint is visible, not an empty plot
    expect(container.querySelectorAll("circle.recharts-area-dot").length).toBeGreaterThan(0);
  });

  it("keeps dots OFF for a multi-point series (the band alone carries it)", () => {
    const { container } = render(<AllocationOverTime points={ALLOC_POINTS} gaps={[]} />);
    expect(container.querySelectorAll("circle.recharts-area-dot").length).toBe(0);
  });
});

describe("AllocationOverTime — F-2 all-zero-gross window (points empty, gaps present)", () => {
  const gaps: AsofGap[] = [{ start: "2026-01-01", end: "2026-01-05", kind: "gap", days: 5 }];

  it("does NOT claim 'no history yet' when coverage gaps exist — snapshots DO exist", () => {
    render(<AllocationOverTime points={[]} gaps={gaps} />);
    expect(screen.queryByText("No allocation history yet.")).toBeNull();
    expect(screen.getByText("No non-zero-gross days in this window.")).toBeTruthy();
    expect(
      screen.getByText(
        "Positions carried ~0 notional across the covered days, so per-venue weights can't be formed.",
      ),
    ).toBeTruthy();
  });

  it("still shows the no-history card for the TRULY empty case (no points AND no gaps)", () => {
    render(<AllocationOverTime points={[]} gaps={[]} />);
    expect(screen.getByText("No allocation history yet.")).toBeTruthy();
    expect(screen.queryByText("No non-zero-gross days in this window.")).toBeNull();
  });
});

describe("AllocationOverTime — F-3 venue named 'asofMs' cannot clobber the x-coord", () => {
  it("preserves the numeric x-coord when a venue is literally named 'asofMs'", () => {
    const points = [
      ap("2026-01-01", [venue("asofMs", 100, 0.5), venue("binance", 100, 0.5)]),
      ap("2026-01-02", [venue("asofMs", 100, 0.5), venue("binance", 100, 0.5)]),
    ];
    const { rows } = buildAllocationChartData(points, []);
    const day1 = rows.find((r) => r.asofMs === utc("2026-01-01"));
    expect(day1).toBeDefined();
    expect(day1!.asofMs).toBe(utc("2026-01-01"));
    // the "asofMs" venue's weight lands under its namespaced key, not the x-coord
    expect(day1![vk("asofMs")]).toBe(0.5);
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
