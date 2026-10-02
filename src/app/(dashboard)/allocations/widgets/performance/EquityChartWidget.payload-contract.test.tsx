import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

import EquityChartWidget from "./EquityChart";
import { TweaksProvider } from "../../context/TweaksContext";
import { equityChartWidgetDataSchema } from "../lib/widget-data";
import type { DailyPoint } from "@/lib/portfolio-math-utils";
import type { MyAllocationDashboardPayload } from "@/lib/queries";

// ---------------------------------------------------------------------------
// Phase 169.4 plan 02 — the key-collision pin (plan-check round 1, blocker 1).
//
// The /allocations Overview mounts EquityChartWidget with the WHOLE dashboard
// payload (`data={props}`), and the widget's boundary validates it against
// `equityChartWidgetDataSchema` with onInvalid "empty". That schema already
// types a `btcBenchmark` key as an array of daily points. The dashboard's new
// BTC field is a `{ prices, through, dropped }` object, so under that key it
// would fail the schema and every ready book's equity curve would render
// "Equity data warming up". The field is therefore named `btcBenchmarkPrices`.
//
// Why this matters: the failure is silent (a warm-up placeholder, no error),
// on the most-read chart of the page. The fixture is typed from the producer's
// payload type, so renaming the production field fails the type check too.
// The producer half (the payload `getMyAllocationDashboard` actually returns
// still parses) lives in `src/lib/queries.benchmark-feed.test.ts`.
// ---------------------------------------------------------------------------

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    prefetch: vi.fn(),
  }),
}));

function makeSeries(n: number): DailyPoint[] {
  const pts: DailyPoint[] = [];
  const d = new Date(Date.UTC(2026, 7, 1));
  let cumulative = 1.0;
  for (let i = 0; i < n; i++) {
    pts.push({ date: d.toISOString().slice(0, 10), value: cumulative });
    cumulative *= 1.002;
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return pts;
}

// TweaksProvider reads localStorage; jsdom's shim is partial (same idiom as
// EquityChartWidget.header.test.tsx).
const lsStore = new Map<string, string>();
const localStorageMock = {
  getItem: (k: string) => lsStore.get(k) ?? null,
  setItem: (k: string, v: string) => {
    lsStore.set(k, v);
  },
  removeItem: (k: string) => {
    lsStore.delete(k);
  },
  clear: () => {
    lsStore.clear();
  },
  key: () => null,
  length: 0,
};
const realLocalStorage = window.localStorage;

beforeEach(() => {
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    writable: true,
    value: localStorageMock,
  });
  lsStore.clear();
});

afterAll(() => {
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    writable: true,
    value: realLocalStorage,
  });
});

const POINTS = makeSeries(60);
const BTC_PRICES = {
  prices: POINTS.map((p, i) => ({ date: p.date, close: 60_000 + i * 100 })),
  through: POINTS[POINTS.length - 1].date,
  dropped: [] as string[],
};

// Explicitly SET, never omitted: the member is optional, and an absent field
// would let this pin pass without testing the collision at all.
const READY_SLICE: Pick<MyAllocationDashboardPayload, "equityDailyPoints" | "btcBenchmarkPrices"> = {
  equityDailyPoints: POINTS,
  btcBenchmarkPrices: BTC_PRICES,
};

function mount(data: unknown) {
  return render(
    <TweaksProvider>
      <EquityChartWidget
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        data={data as any}
        timeframe="1YTD"
        width={6}
        height={4}
      />
    </TweaksProvider>,
  );
}

describe("EquityChartWidget — the dashboard payload's BTC field does not collide with the chart's schema (169.4-02)", () => {
  it("renders the equity curve with btcBenchmarkPrices on the payload", () => {
    // The render assertion first, so a renamed key fails HERE, on the curve.
    mount(READY_SLICE);
    expect(screen.queryByText("Equity data warming up")).toBeNull();
    expect(screen.getByText("Equity curve")).toBeInTheDocument();
    expect(equityChartWidgetDataSchema.safeParse(READY_SLICE).success).toBe(true);
    expect(READY_SLICE.btcBenchmarkPrices).toMatchObject({ through: POINTS[59].date });
  });

  it("the same value under the key btcBenchmark blanks the curve (the case that proves this pin can fail)", () => {
    const collided = { equityDailyPoints: POINTS, btcBenchmark: BTC_PRICES };
    expect(equityChartWidgetDataSchema.safeParse(collided).success).toBe(false);
    mount(collided);
    expect(screen.getByText("Equity data warming up")).toBeInTheDocument();
  });
});
