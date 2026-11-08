import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";

// queries.ts is server-only; the test reads its `emptyLiveBaselineMetrics` builder
// only, so the guard is replaced with an empty module.
vi.mock("server-only", () => ({}));

import { GlancePanel } from "./GlancePanel";
import { KpiStrip } from "./KpiStrip";
import { liveBookFigures } from "../lib/book-figures";
import { emptyLiveBaselineMetrics } from "@/lib/queries";
import type { ComputedMetrics } from "@/lib/scenario";
import type { MyAllocationDashboardPayload } from "@/lib/queries";

// ---------------------------------------------------------------------------
// Phase 198 plan 01 (D-06, SC-2): one payload, two surfaces. The glance's
// YTD TWR, Sharpe and Max DD 12m cells must print the same strings, in the
// same tone, as Scenario's live-book KpiStrip. The strip is rendered as
// ScenarioComposer renders it when no scenario is active, with the module's
// gated Sharpe in `metrics` (the composer's `liveMetricsForStrip`; the
// composer's own prop is pinned in ScenarioComposer.test.tsx).
// Book equity and Positions are pinned against the Holdings header in 198-11.
// ---------------------------------------------------------------------------

type Baseline = MyAllocationDashboardPayload["liveBaselineMetrics"];

function equity(days: number): Baseline["equity"] {
  const start = Date.parse("2026-01-01T00:00:00Z");
  return Array.from({ length: days }, (_, i) => ({
    date: new Date(start + i * 86_400_000).toISOString().slice(0, 10),
    value: 1 + i * 0.001,
  }));
}

const baseline = (days: number, over: Partial<Baseline> = {}): Baseline => ({
  aum: 1,
  ytdTwr: 0.0421,
  sharpe: 1.37,
  maxDd: -0.068,
  avgRho: 0.2,
  equity: equity(days),
  drawdown: [],
  ...over,
});

interface Case {
  name: string;
  baseline: Baseline;
  allKeysStale: boolean;
  rebuilding: boolean;
}

const CASES: Case[] = [
  { name: "a full 400-day record", baseline: baseline(400), allKeysStale: false, rebuilding: false },
  { name: "a 60-day record (Sharpe withheld)", baseline: baseline(60), allKeysStale: false, rebuilding: false },
  { name: "a 200-day record (Sharpe under a year)", baseline: baseline(200), allKeysStale: false, rebuilding: false },
  { name: "a rebuilding history with a populated baseline", baseline: baseline(400), allKeysStale: false, rebuilding: true },
  { name: "every key stale", baseline: baseline(400), allKeysStale: true, rebuilding: false },
  { name: "the empty baseline", baseline: emptyLiveBaselineMetrics([]), allKeysStale: false, rebuilding: false },
  { name: "an impossible positive drawdown", baseline: baseline(400, { maxDd: 0.04 }), allKeysStale: false, rebuilding: false },
];

/** What a person reads: the sr-only reasons and the `<1y` marker are not part of the figure. */
function printed(el: Element): string {
  const clone = el.cloneNode(true) as Element;
  clone.querySelectorAll(".sr-only, span.ml-1").forEach((n) => n.remove());
  return (clone.textContent ?? "").trim();
}

const tone = (el: Element) =>
  el.className.includes("text-positive")
    ? "positive"
    : el.className.includes("text-negative")
      ? "negative"
      : "none";

function stripValue(strip: HTMLElement, label: string): Element {
  const value = within(strip).getByText(label).nextElementSibling;
  if (!value) throw new Error(`no value node under ${label}`);
  return value;
}

describe("GlancePanel and Scenario's live strip print one set of strings (198 SC-2)", () => {
  afterEach(() => cleanup());

  it.each(CASES)("$name", (c) => {
    const figures = liveBookFigures(c.baseline);
    const metrics = {
      n: c.baseline.equity.length,
      twr: c.baseline.ytdTwr,
      cagr: null,
      volatility: null,
      sharpe: figures.sharpe,
      sortino: null,
      max_drawdown: c.baseline.maxDd,
      max_dd_days: null,
      correlation_matrix: null,
      avg_pairwise_correlation: c.baseline.avgRho,
      equity_curve: [],
      effective_start: null,
      effective_end: null,
    } as ComputedMetrics;

    const { container: stripHost } = render(
      <KpiStrip
        mode="scenario"
        variant="panel"
        scenarioMetrics={null}
        liveMetrics={null}
        metrics={metrics}
        analytics={{}}
        snapshotCount={c.rebuilding ? null : 60}
        allKeysStale={c.allKeysStale}
      />,
    );
    const strip = stripHost as HTMLElement;
    const stripCells = {
      ytd: stripValue(strip, "YTD TWR"),
      sharpe: stripValue(strip, "Sharpe"),
      maxdd: stripValue(strip, "Max DD 12m"),
    };
    const stripPrinted = {
      ytd: printed(stripCells.ytd),
      sharpe: printed(stripCells.sharpe),
      maxdd: printed(stripCells.maxdd),
    };
    const stripTone = {
      ytd: tone(stripCells.ytd),
      sharpe: tone(stripCells.sharpe),
      maxdd: tone(stripCells.maxdd),
    };
    cleanup();

    render(
      <GlancePanel
        liveBaselineMetrics={c.baseline}
        holdingsSummary={[]}
        allKeysStale={c.allKeysStale}
        noteBelow={c.rebuilding}
      />,
    );
    for (const [key, id] of [
      ["ytd", "glance-ytd"],
      ["sharpe", "glance-sharpe"],
      ["maxdd", "glance-maxdd"],
    ] as const) {
      const cell = screen.getByTestId(id);
      expect(printed(cell), `${key} string`).toBe(stripPrinted[key]);
      expect(tone(cell), `${key} tone`).toBe(stripTone[key]);
    }
  });

  it("the cases are not vacuous: the 60-day Sharpe really is withheld and the full one is not", () => {
    expect(liveBookFigures(baseline(60)).sharpe).toBeNull();
    expect(liveBookFigures(baseline(400)).sharpe).toBe(1.37);
  });
});
