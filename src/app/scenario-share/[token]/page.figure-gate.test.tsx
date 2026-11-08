/**
 * 194.1 plan 02 (census B4) — the public shared-scenario page gates its KPI strip on the
 * blend's total record (194 D-04 as superseded by D-15), with the verdict and the sentence
 * the owner sees in the composer.
 *
 * Every caption below is typed by hand. A test that built its expectation from
 * `withheldReason` / `shortTrackNote` would pass when the page called the wrong one, or
 * when the sentence drifted. The numbers (60, 90, 365) are in the fixtures, never read
 * back from `figure-gate.ts`, so a moved threshold fails here.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";

import {
  SCENARIO_SCHEMA_VERSION,
  type ScenarioDraft,
} from "@/app/(dashboard)/allocations/lib/scenario-state";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("__NOT_FOUND__");
  },
}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": "203.0.113.7" }),
}));
vi.mock("@/lib/ratelimit", () => ({
  publicIpLimiter: {},
  checkLimit: async () => ({ success: true }),
  getClientIp: () => "203.0.113.7",
}));

const rpcMock = vi.hoisted(() => vi.fn());
const strategiesReadMock = vi.hoisted(() =>
  vi.fn(async () => ({
    data: [] as Array<{ id: string; asset_class: string | null }>,
    error: null,
  })),
);
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: (fn: string, args: unknown) => rpcMock(fn, args),
    from: (table: string) => {
      if (table === "strategies") {
        return {
          select: () => ({
            in: () => ({ eq: () => strategiesReadMock() }),
          }),
        };
      }
      if (table === "strategy_analytics") {
        return {
          select: () => ({ in: async () => ({ data: [], error: null }) }),
        };
      }
      throw new Error(`page read an arbitrary table: ${table}`);
    },
  }),
}));
vi.mock("@/lib/factsheet/benchmark-source", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/factsheet/benchmark-source")>()),
  readBtcCloses: async () => null,
}));
vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: vi.fn() }));
vi.mock("@/lib/queries", () => ({
  shouldCaptureDerivedRowRejection: () => true,
}));
vi.mock("@/app/(dashboard)/allocations/widgets/performance/EquityChart", () => ({
  EquityChart: () => <div data-testid="equity-chart" />,
  toWealth: (points: Array<{ date: string; value: number }>) => points,
}));
vi.mock("@/components/portfolio/CorrelationHeatmap", () => ({
  CorrelationHeatmap: () => <div data-testid="correlation-heatmap" />,
}));
// Echo the two props the page must keep passing unchanged: the basis and the daily series.
vi.mock("@/app/(dashboard)/allocations/components/ScenarioBenchmarkSection", () => ({
  ScenarioBenchmarkSection: ({
    portfolioDaily,
    periodsPerYear,
  }: {
    portfolioDaily: unknown[];
    periodsPerYear?: number;
  }) => (
    <div data-testid="benchmark-section">
      basis:{String(periodsPerYear)} daily:{portfolioDaily.length}
    </div>
  ),
}));

const STRAT_A = "11111111-1111-4111-8111-111111111111";
const DAY_MS = 86_400_000;

function isoDay(start: string, offset: number): string {
  return new Date(Date.parse(`${start}T00:00:00Z`) + offset * DAY_MS).toISOString().slice(0, 10);
}

/** One return per listed day offset from `start`, varied so the blend has real dispersion. */
function seriesAt(start: string, offsets: number[], valueAt?: (i: number) => number) {
  return offsets.map((o, i) => ({
    date: isoDay(start, o),
    value: valueAt ? valueAt(i) : 0.001 + 0.0015 * Math.sin(i / 3),
  }));
}

/** A return on every day: `count` consecutive days, so the record covers exactly `count` days. */
function daily(start: string, count: number, valueAt?: (i: number) => number) {
  return seriesAt(start, Array.from({ length: count }, (_, i) => i), valueAt);
}

function row(series: Array<{ date: string; value: number }>) {
  const draft: ScenarioDraft = {
    schema_version: SCENARIO_SCHEMA_VERSION,
    init_holdings_fingerprint: "BTC:binance:spot",
    toggleByScopeRef: { [STRAT_A]: true },
    addedStrategies: [
      { id: STRAT_A as never, name: "Momentum Alpha", markets: ["BTC"], strategy_types: ["trend"] },
    ],
    weightOverrides: { [STRAT_A]: 1 },
    memberKeyIds: [],
    lastEditedAt: "2026-06-22T00:00:00.000Z",
  };
  return {
    name: "My Q3 Blend",
    draft,
    schema_version: 2,
    series: [{ strategy_id: STRAT_A, daily_returns: series }],
  };
}

async function renderPage(series: Array<{ date: string; value: number }>): Promise<string> {
  rpcMock.mockResolvedValueOnce({ data: [row(series)], error: null });
  const { default: ScenarioSharePage } = await import("./page");
  const element = (await ScenarioSharePage({
    params: Promise.resolve({ token: "raw-token-abc" }),
  })) as ReactElement;
  return renderToStaticMarkup(element);
}

/** A KPI cell's printed value, by its label. */
function cell(html: string, label: string): string {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = new RegExp(`${escaped}</div><div class="[^"]*">([^<]*)</div>`).exec(html);
  if (!m) throw new Error(`no KPI cell for ${label}`);
  return m[1]!;
}

/** The caption's text with the markup's HTML escapes undone, or null when absent. */
function caption(html: string): string | null {
  const m = /data-testid="scenario-share-figure-gate-note"[^>]*>([^<]*)</.exec(html);
  if (!m) return null;
  return m[1]!.replace(/&#x27;/g, "'").replace(/&amp;/g, "&");
}

const ANNUALIZED = ["CAGR", "Volatility", "Sharpe", "Sortino"] as const;
const UNGATED = ["Total return", "Max drawdown", "Avg |ρ|"] as const;

beforeEach(() => {
  rpcMock.mockReset();
  strategiesReadMock.mockReset();
  // Default: no asset_class row, so the blend resolves to the conservative crypto basis (365).
  strategiesReadMock.mockResolvedValue({ data: [], error: null });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      json: async () => ({ prices: [], dropped: [], through: null }) as unknown,
    })),
  );
});

describe("shared scenario KPI strip, crypto blend (194.1 B4, D-15)", () => {
  it("60 days of overlapping record: the four annualised cells print a dash and the caption says why", async () => {
    const html = await renderPage(daily("2025-01-01", 60));
    for (const label of ANNUALIZED) expect(cell(html, label)).toBe("—");
    expect(caption(html)).toBe(
      "Annualized figures appear once the blend's overlapping record reaches 90 days. It covers 60 days.",
    );
    expect(html).toContain("basis:365");
  });

  it("89 days is withheld, 90 days clears: the figures print as computed and the short-track note replaces the reason", async () => {
    const at89 = await renderPage(daily("2025-01-01", 89));
    for (const label of ANNUALIZED) expect(cell(at89, label)).toBe("—");
    expect(caption(at89)).toBe(
      "Annualized figures appear once the blend's overlapping record reaches 90 days. It covers 89 days.",
    );

    const at90 = await renderPage(daily("2025-01-01", 90));
    for (const label of ANNUALIZED) expect(cell(at90, label)).not.toBe("—");
    expect(caption(at90)).toBe(
      "CAGR, volatility, Sharpe, Sortino and Calmar are annualized from 90 days of overlapping record, under one year.",
    );
  });

  it("400 days: no caption element and the four figures print", async () => {
    const html = await renderPage(daily("2024-01-01", 400));
    expect(html).not.toContain("scenario-share-figure-gate-note");
    for (const label of ANNUALIZED) expect(cell(html, label)).not.toBe("—");
  });

  it("Total return, Max drawdown and Avg |rho| print the same text whether the annualised cells are withheld or shown", async () => {
    // The SAME 60 days twice. As a crypto blend (basis 365) the record is 60 days, under 90, so
    // the annualised cells are withheld. As a traditional blend (basis 252) it is 60 observations,
    // which clears. The basis moves only the risk figures, never return, drawdown or correlation,
    // so a gate that touched an ungated cell would make these two renders differ.
    const series = daily("2025-01-01", 60);
    const withheld = await renderPage(series);
    strategiesReadMock.mockResolvedValueOnce({
      data: [{ id: STRAT_A, asset_class: "traditional" }],
      error: null,
    });
    const shown = await renderPage(series);

    for (const label of ANNUALIZED) {
      expect(cell(withheld, label)).toBe("—");
      expect(cell(shown, label)).not.toBe("—");
    }
    for (const label of UNGATED) expect(cell(withheld, label)).toBe(cell(shown, label));
    expect(cell(withheld, "Total return")).not.toBe("—");
    expect(cell(withheld, "Max drawdown")).not.toBe("—");
  });
});

describe("shared scenario KPI strip, non-crypto blend and edge cases (194.1 B4)", () => {
  beforeEach(() => {
    strategiesReadMock.mockResolvedValue({
      data: [{ id: STRAT_A, asset_class: "traditional" }],
      error: null,
    });
  });

  // 84 calendar days with a gap: the first day, then every day from offset `gapEnd` on.
  // 59 observations = 1 + (84 - 26); 60 observations = 1 + (84 - 25).
  const gapped = (gapEnd: number) =>
    seriesAt("2025-01-01", [0, ...Array.from({ length: 84 - gapEnd }, (_, i) => gapEnd + i)]);

  it("59 observations over 84 days is withheld by the observation bound and says so in trading days", async () => {
    const html = await renderPage(gapped(26));
    for (const label of ANNUALIZED) expect(cell(html, label)).toBe("—");
    expect(caption(html)).toBe(
      "Annualized figures appear once the blend's overlapping record reaches 60 trading days. It has 59 trading days.",
    );
    expect(html).toContain("basis:252");
  });

  it("60 observations over the same 84 days clears: the figures print and the note counts the span in days", async () => {
    const html = await renderPage(gapped(25));
    for (const label of ANNUALIZED) expect(cell(html, label)).not.toBe("—");
    expect(caption(html)).toBe(
      "CAGR, volatility, Sharpe, Sortino and Calmar are annualized from 84 days of overlapping record, under one year.",
    );
  });

  it("an empty blend prints no caption and every cell stays a dash, as before the gate", async () => {
    const html = await renderPage([]);
    expect(html).not.toContain("scenario-share-figure-gate-note");
    for (const label of [...ANNUALIZED, ...UNGATED]) expect(cell(html, label)).toBe("—");
  });

  it("a very large stored cumulative return prints as any finite value does, with no extra text (D-05)", async () => {
    // One day compounds to +12345678901.23, the rest are flat. The size of a figure is never tested.
    const html = await renderPage(daily("2024-01-01", 400, (i) => (i === 10 ? 12345678901.23 : 0)));
    expect(cell(html, "Total return")).toBe("+1234567890123.00%");
    expect(html).not.toContain("scenario-share-figure-gate-note");
  });

  it("the vs-BTC section still receives the resolved basis and the whole daily series", async () => {
    const html = await renderPage(gapped(26));
    expect(html).toContain("basis:252 daily:59");
  });
});
