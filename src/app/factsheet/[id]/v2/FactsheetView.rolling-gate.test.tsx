/** @vitest-environment jsdom */
/**
 * Phase 194 plan 24 (D-11 as superseded by D-15, D-14 additive) - the factsheet's rolling
 * volatility, Sharpe and Sortino charts follow the rolling verdict plan 14 computes, and a
 * record of a year or more offers a 1y window BESIDE the row window.
 *
 * Why each case matters:
 *   - withheld (the TOTAL record fails the minimum, or no full window exists): the charts must
 *     not be drawn and the panel must say why with the shared copy; a rolling figure drawn off a
 *     record too short to annualize is the exact defect D-11 exists to remove;
 *   - short (a cleared record whose window is under a year, the 30-row window included): the
 *     charts DRAW, qualified by a note. Reading `short` as withheld would silently remove every
 *     rolling chart from most real strategies (D-15);
 *   - the additivity pin: the 1y window never becomes the default and never hides the row-window
 *     charts. A 400-day record opens on the `6mo` charts, and `1y` is a choice;
 *   - the basis switch: an MTM view shorter than a year carries `null` 1y keys through the real
 *     merge, so a `1y` choice made on the cash view must fall back to the row charts there.
 *
 * `TimeSeriesChart` is stubbed to print the config the page hands it (title, subtitle, warmup
 * and the two series field names), so the assertions read what `PerformanceCharts` decided and
 * not the SVG. The verdicts are asserted against the shared copy helpers and, once, a literal.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, within, type RenderResult } from "@testing-library/react";
import { buildFactsheetPayload, deriveSeriesBundle, fixtureBenchmarkPrices } from "@/lib/factsheet/build-payload";
import type { DailyReturn, FactsheetPayload } from "@/lib/factsheet/types";
import { widenedShortNote, widenedWithheldReason } from "@/lib/figure-gate";
import { FactsheetProvider } from "./factsheet-context";
import { FactsheetBody } from "./FactsheetView";
import type { ChartConfig } from "./chart-configs";

vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("./TimeSeriesChart", () => ({
  TimeSeriesChart: ({ config }: { config: ChartConfig }) => (
    <div
      data-testid={`chart-${config.key}`}
      data-title={config.title}
      data-subtitle={config.subtitle ?? ""}
      data-warmup={String(config.warmup ?? "")}
      data-strat={config.stratField ?? ""}
      data-cmp={config.comparatorField ?? ""}
    />
  ),
}));

const lsStore = new Map<string, string>();
beforeEach(() => {
  lsStore.clear();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => lsStore.get(k) ?? null,
    setItem: (k: string, v: string) => void lsStore.set(k, v),
    removeItem: (k: string) => void lsStore.delete(k),
    clear: () => lsStore.clear(),
    key: () => null,
    length: 0,
  });
});

const DAY = 86_400_000;
const START = Date.UTC(2024, 0, 1);
const ROLLING_KEYS = ["rollingVol", "rollingSharpe", "rollingSortino"] as const;
const PANEL_TITLE = "Rolling Metrics — Not enough data";

const STRATEGY = {
  id: "s-194-24-rolling-gate",
  name: "Rolling Gate Strategy",
  types: ["quant"],
  markets: ["crypto"],
  computedAt: "2026-10-01T00:00:00Z",
  trustTier: null,
  assetClass: "crypto",
  ingestSource: "csv" as const,
};

const value = (i: number) => 0.0011 + Math.sin(i * 0.37) * 0.011 + Math.cos(i * 0.11) * 0.005;
const rowsOf = (n: number, shift = 0): DailyReturn[] =>
  Array.from({ length: n }, (_, i) => ({
    date: new Date(START + (i + shift) * DAY).toISOString().slice(0, 10),
    value: value(i + shift),
  }));

function buildPayload(n: number): FactsheetPayload {
  const p = buildFactsheetPayload(STRATEGY, rowsOf(n), {});
  if (!p) throw new Error("fixture must build a payload");
  return p;
}

function renderBody(payload: FactsheetPayload): RenderResult {
  return render(
    <FactsheetProvider payload={payload} persist={false}>
      <FactsheetBody payload={payload} hideHeader hideFooter={false} />
    </FactsheetProvider>,
  );
}

// Container-scoped: the beta test holds two renders at once, and the rail prints the same
// withheld sentence as the panel, so the panel text is read from the panel's own section.
const chart = (r: RenderResult, key: string): HTMLElement | null => within(r.container).queryByTestId(`chart-${key}`);
const panelBody = (r: RenderResult): string | undefined =>
  r.queryByText(PANEL_TITLE)?.closest("section")?.querySelector("p")?.textContent ?? undefined;
function chartsOf(r: RenderResult): HTMLElement[] {
  return ROLLING_KEYS.map((k) => {
    const el = chart(r, k);
    if (!el) throw new Error(`rolling chart ${k} is not drawn`);
    return el;
  });
}

describe("withheld: the rolling charts are not drawn and the panel says why (D-11, D-15)", () => {
  it("cause gate, a 60-day crypto record: no rolling chart, the shared 'rolling' copy over the payload's record, no window control", () => {
    const payload = buildPayload(60);
    expect(payload.rollingWindow.annualization).toEqual({ state: "withheld", days: 60, cause: "gate" });
    const r = renderBody(payload);
    for (const k of ROLLING_KEYS) expect(chart(r, k)).toBeNull();
    expect(r.queryByText(PANEL_TITLE)).not.toBeNull();
    expect(panelBody(r)).toBe(widenedWithheldReason("rolling", payload.figureRecord!));
    expect(panelBody(r)).toBe("Rolling annualized figures appear once the record reaches 90 days. This record covers 60 days.");
    // The old sentence claimed a 35-observation rule that D-11 makes false.
    expect(r.queryByText(/too short to compute even a 30-day rolling volatility/)).toBeNull();
    expect(r.queryByTestId("rolling-window-choice")).toBeNull();
  });

  it("cause record, a cleared record with no full window: the 'rolling-record' copy over the same record", () => {
    const base = buildPayload(200);
    const payload: FactsheetPayload = {
      ...base,
      rollingWindow: {
        ...base.rollingWindow,
        enough: false,
        annualization: { state: "withheld", days: 199, cause: "record" },
      },
    };
    const r = renderBody(payload);
    for (const k of ROLLING_KEYS) expect(chart(r, k)).toBeNull();
    expect(panelBody(r)).toBe(widenedWithheldReason("rolling-record", payload.figureRecord!));
  });

  it("the rolling beta chart and its own panel are unchanged by the rolling verdict", () => {
    for (const n of [60, 200]) {
      const base = buildPayload(n);
      const gated = renderBody(base);
      const { annualization: _drop, ...bareWindow } = base.rollingWindow;
      void _drop;
      const bare = renderBody({ ...base, rollingWindow: bareWindow });
      expect(chart(gated, "rollingBeta") === null).toBe(chart(bare, "rollingBeta") === null);
      expect(within(gated.container).queryByText("Rolling β — Not enough data") === null).toBe(
        within(bare.container).queryByText("Rolling β — Not enough data") === null,
      );
      if (chart(gated, "rollingBeta")) {
        expect(chart(gated, "rollingBeta")!.dataset.title).toBe(chart(bare, "rollingBeta")!.dataset.title);
        expect(chart(gated, "rollingBeta")!.dataset.subtitle).toBe(chart(bare, "rollingBeta")!.dataset.subtitle);
      }
      gated.unmount();
      bare.unmount();
    }
  });
});

describe("short: the charts draw and each carries the note (D-15)", () => {
  it("the 30-row window on a cleared 100-day record (days 30): three charts, each subtitle ends with the note, no control", () => {
    const payload = buildPayload(100);
    expect(payload.rollingWindow.annualization).toEqual({ state: "short", days: 30, cause: null });
    expect(payload.rollingWindow1y).toBeNull();
    const r = renderBody(payload);
    const note = widenedShortNote("rolling", 30);
    expect(note).toBe("Rolling figures are annualized from a 30-day window, under one year.");
    for (const el of chartsOf(r)) {
      expect(el.dataset.subtitle!.endsWith(note)).toBe(true);
      expect(el.dataset.title).toContain("(30d)");
    }
    expect(r.queryByText(PANEL_TITLE)).toBeNull();
    expect(r.queryByTestId("rolling-window-choice")).toBeNull();
  });

  it("the 6mo window on a 200-day record (days 126): three charts with the 126-day note, no control (no 1y window)", () => {
    const payload = buildPayload(200);
    expect(payload.rollingWindow.annualization).toEqual({ state: "short", days: 126, cause: null });
    expect(payload.rollingWindow1y).toBeNull();
    const r = renderBody(payload);
    const note = widenedShortNote("rolling", 126);
    for (const el of chartsOf(r)) {
      expect(el.dataset.subtitle!.endsWith(note)).toBe(true);
      expect(el.dataset.title).toContain("(6mo)");
      expect(el.dataset.warmup).toBe(String(payload.rollingWindow.window));
    }
    expect(r.queryByTestId("rolling-window-choice")).toBeNull();
  });

  it("a payload with no verdict draws today's charts: no note, no control", () => {
    const base = buildPayload(200);
    const { annualization: _drop, ...bareWindow } = base.rollingWindow;
    void _drop;
    const r = renderBody({ ...base, rollingWindow: bareWindow });
    for (const el of chartsOf(r)) {
      expect(el.dataset.subtitle).toBe("");
      expect(el.dataset.title).toContain("(6mo)");
    }
    expect(r.queryByTestId("rolling-window-choice")).toBeNull();
  });
});

describe("D-14 additivity: the 1y window is a choice beside the row window, never the default", () => {
  it("a 400-day record opens on the 6mo charts with the 126-day note, offers exactly 6mo and 1y, and 1y redraws on the 365-day series", () => {
    const payload = buildPayload(400);
    expect(payload.rollingWindow).toMatchObject({ window: 126, label: "6mo" });
    expect(payload.rollingWindow.annualization).toEqual({ state: "short", days: 126, cause: null });
    expect(payload.rollingWindow1y).toMatchObject({ window: 365, label: "1y" });
    const r = renderBody(payload);

    const note = widenedShortNote("rolling", 126);
    const strat = { rollingVol: "strategyRollingVol", rollingSharpe: "strategyRollingSharpe", rollingSortino: "strategyRollingSortino" };
    for (const k of ROLLING_KEYS) {
      const el = chart(r, k)!;
      expect(el.dataset.title).toContain("(6mo)");
      expect(el.dataset.subtitle!.endsWith(note)).toBe(true);
      expect(el.dataset.strat).toBe(strat[k]);
      expect(el.dataset.cmp).toBe(k);
    }

    const control = r.getByTestId("rolling-window-choice");
    const buttons = within(control).getAllByRole("button");
    expect(buttons.map((b) => b.textContent)).toEqual(["6mo", "1y"]);
    expect(buttons[0].getAttribute("aria-pressed")).toBe("true");
    expect(buttons[1].getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(within(control).getByText("1y"));
    for (const k of ROLLING_KEYS) {
      const el = chart(r, k)!;
      expect(el.dataset.title).toContain("(1y)");
      expect(el.dataset.title).not.toContain("(6mo)");
      expect(el.dataset.subtitle).toBe("");
      expect(el.dataset.strat).toBe(`${strat[k]}1y`);
      expect(el.dataset.cmp).toBe(`${k}1y`);
      expect(el.dataset.warmup).toBe(String(payload.rollingWindow1y!.window));
    }
    // The control sits once, above the first rolling chart.
    expect(r.getAllByTestId("rolling-window-choice")).toHaveLength(1);

    fireEvent.click(within(r.getByTestId("rolling-window-choice")).getByText("6mo"));
    for (const k of ROLLING_KEYS) {
      const el = chart(r, k)!;
      expect(el.dataset.title).toContain("(6mo)");
      expect(el.dataset.subtitle!.endsWith(note)).toBe(true);
      expect(el.dataset.strat).toBe(strat[k]);
    }
  });

  it("the control mounts before the first rolling chart in document order", () => {
    const r = renderBody(buildPayload(400));
    const control = r.getByTestId("rolling-window-choice");
    const first = chart(r, "rollingVol")!;
    expect(control.compareDocumentPosition(first) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe("D-14 through the real basis merge: a view without a 1y window falls back to the row charts", () => {
  it("a 400-day cash payload over a 200-day MTM bundle: choose 1y on cash, MTM draws the row charts and no control, cash restores it", () => {
    const base = buildPayload(400);
    const mtmRows = rowsOf(200, 200);
    const mtmBundle = deriveSeriesBundle(mtmRows, {
      periodsPerYear: 365,
      isArithmetic: false,
      markets: [],
      strategyName: base.strategyName,
      benchmarkPrices: fixtureBenchmarkPrices([mtmRows]),
      figureRecord: base.figureRecord ?? null,
    });
    // The merge is the thing under test: the bundle must carry the four 1y keys as null, so the
    // cash payload's 1y window cannot leak onto a 200-day view.
    expect(mtmBundle.rollingWindow1y).toBeNull();
    const payload = {
      ...base,
      mtmGate: { available: true },
      metricsByBasis: { mark_to_market: {} },
      seriesByBasis: { mark_to_market: mtmBundle },
    } as unknown as FactsheetPayload;
    const r = renderBody(payload);
    const group = () => r.container.querySelector('[role="group"][aria-label="Metrics basis"]') as HTMLElement;
    expect(group(), "the basis toggle").not.toBeNull();

    // Cash: the control, and 1y chosen.
    fireEvent.click(within(r.getByTestId("rolling-window-choice")).getByText("1y"));
    expect(chart(r, "rollingVol")!.dataset.strat).toBe("strategyRollingVol1y");

    // MTM: the row charts from the MTM view, no control, no 1y field read.
    fireEvent.click(within(group()).getByText("Mark-to-market"));
    expect(r.queryByTestId("rolling-window-choice")).toBeNull();
    const note = widenedShortNote("rolling", 126);
    for (const k of ROLLING_KEYS) {
      const el = chart(r, k)!;
      expect(el.dataset.title).toContain("(6mo)");
      expect(el.dataset.strat).not.toMatch(/1y$/);
      expect(el.dataset.cmp).not.toMatch(/1y$/);
      expect(el.dataset.subtitle!.endsWith(note)).toBe(true);
    }

    // Cash again: the control renders again.
    fireEvent.click(within(group()).getByText("Cash settlement"));
    expect(r.queryByTestId("rolling-window-choice")).not.toBeNull();
  });
});
