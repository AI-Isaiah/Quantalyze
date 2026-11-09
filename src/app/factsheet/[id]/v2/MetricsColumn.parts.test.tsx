/** @vitest-environment jsdom */
/**
 * Phase 196 plan 09 (D-04, LEAN-05): the metrics rail comes in two halves, and this file pins
 * which metric lives in which.
 *
 * WHY it exists. The one-page layout opens on ONE Main metrics table and keeps everything else
 * in a "Detailed metrics" rail behind Advanced. The promise to a reader is that no metric is
 * printed twice and that a figure the Phase 194 gate withholds stays withheld wherever it
 * moves. Both promises are easy to break by editing one half and forgetting the other (a row
 * added back to Extended Metrics, a fee row restored in Terms), and neither shows up as a
 * crash. So the arms below fail on exactly those edits:
 *
 *   - the default (`part` absent or "all") is byte-identical, so the allocator mounts and every
 *     existing MetricsColumn test keep today's rail;
 *   - the Main metrics table has its three groups in the UI-SPEC order, and every row in it is
 *     the SAME cell the whole rail prints (value and benchmark), so a row moved is a row not
 *     re-derived (T-196-20), including on a short record, a withheld record and a selected range;
 *   - the detailed half is the whole rail minus exactly the moved panels, with the rows the
 *     other surfaces own removed, and the two halves together repeat no metric (the census
 *     rules of plan 01 run over the combined markup).
 */
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent, act, screen } from "@testing-library/react";
import { buildFactsheetPayload } from "@/lib/factsheet/build-payload";
import type { DailyReturn, FactsheetPayload } from "@/lib/factsheet/types";
import { VAR_METHOD_LINE } from "@/lib/figure-gate";
import type { FigureRecord } from "@/lib/figure-gate";
import { countFactsheetCensus } from "../../../../../scripts/factsheet-census/count";
import { FactsheetProvider, useXRange } from "./factsheet-context";
import { MetricsColumn, type MetricsPart } from "./MetricsColumn";
import { censusPayloadA, censusPayloadB, censusPayloadC } from "./test-fixtures/census-payloads";

vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: vi.fn() }));
vi.mock("@/hooks/useBreakpoint", () => ({ useBreakpoint: vi.fn(() => "desktop" as const) }));

// Each arm renders the whole rail several times over (the default path is compared cell by cell),
// which is slow when the machine is busy; the 5 s default timed out on a loaded runner.
vi.setConfig({ testTimeout: 60_000 });

type DQ = NonNullable<FactsheetPayload["dataQuality"]>;
const DAY = 86_400_000;

const STRATEGY = {
  id: "s-196-09-parts",
  name: "Parts Fixture",
  types: ["quant"],
  markets: ["crypto"],
  computedAt: "2026-09-30T00:00:00Z",
  trustTier: null,
  assetClass: "crypto",
  ingestSource: "api" as const,
};

function returnsOf(n: number): DailyReturn[] {
  const first = Date.parse("2022-01-01T00:00:00Z");
  return Array.from({ length: n }, (_, i) => ({
    date: new Date(first + i * DAY).toISOString().slice(0, 10),
    value: 0.0009 + Math.sin(i * 0.31) * 0.012 + Math.cos(i * 0.07) * 0.004,
  }));
}

function built(n: number, dataQuality?: DQ): FactsheetPayload {
  const p = buildFactsheetPayload(STRATEGY, returnsOf(n), { dataQuality });
  if (!p) throw new Error("fixture must build");
  return p;
}

/** The record the figure gate reads, set explicitly so the "short" note fires on a 200-day record. */
function withRecord(p: FactsheetPayload, spanDays: number): FactsheetPayload {
  const figureRecord: FigureRecord = { spanDays, observations: null, crypto: true };
  return { ...p, figureRecord };
}

const WITHHELD: DQ = {
  composite: false,
  twrChainBroken: true,
  headlineWithheld: true,
  headlineGuardReasons: ["negative_nav"],
};

function RangeHarness({ range }: { range: readonly [number, number] }) {
  const { setXRange } = useXRange();
  return (
    <button data-testid="zoom" onClick={() => setXRange(range)}>
      zoom
    </button>
  );
}

function mount(payload: FactsheetPayload, part?: MetricsPart, range?: readonly [number, number]) {
  return render(
    <FactsheetProvider payload={payload} persist={false}>
      {range && <RangeHarness range={range} />}
      <article id="factsheet-main">{part === undefined ? <MetricsColumn /> : <MetricsColumn part={part} />}</article>
    </FactsheetProvider>,
  );
}

function html(payload: FactsheetPayload, part?: MetricsPart): string {
  const r = mount(payload, part);
  const out = r.container.innerHTML;
  r.unmount();
  return out;
}

/** Every row of every metric table: label, strategy cell, benchmark cell. */
function rowsOf(root: ParentNode): Array<{ label: string; value: string; bench: string }> {
  return Array.from(root.querySelectorAll("table.text-fixed-12 > tbody > tr")).map((tr) => {
    const td = tr.querySelectorAll("td");
    return {
      label: td[0]?.textContent ?? "",
      value: td[1]?.textContent ?? "",
      bench: td[2]?.textContent ?? "",
    };
  });
}

/** h3 panel titles, in document order. */
function titlesOf(root: ParentNode): string[] {
  return Array.from(root.querySelectorAll("h3")).map((h) => h.textContent ?? "");
}

/** The panel (the nearest section) whose own h3 reads `title`. Fails loud. */
function panelOf(container: ParentNode, title: string): HTMLElement {
  const h = Array.from(container.querySelectorAll("h3")).find((el) => el.textContent === title);
  const section = h?.closest("section");
  if (!section) throw new Error(`no panel titled "${title}"`);
  return section as HTMLElement;
}

/** The labels under each group heading of the Main metrics panel. */
function groupsOf(container: HTMLElement): Array<{ group: string; labels: string[] }> {
  const panel = panelOf(container, "Main metrics");
  const out: Array<{ group: string; labels: string[] }> = [];
  for (const el of Array.from(panel.children)) {
    if (el.tagName === "H4") out.push({ group: el.textContent ?? "", labels: [] });
    else if (el.tagName === "TABLE" && out.length > 0) out[out.length - 1].labels.push(...rowsOf(el).map((r) => r.label));
  }
  return out;
}

const MONTH_ROW = /^(Month-to-date|Last month \(.+\)|Final month \(.+\))$/;
const PROFILES: Array<[string, () => FactsheetPayload]> = [
  ["A (two years, comparator)", censusPayloadA],
  ["B (under a year)", censusPayloadB],
  ["C (under 90 days)", censusPayloadC],
];

describe("part default: the whole rail is unchanged (OQ-4)", () => {
  it.each(PROFILES)("no part and part=\"all\" print the same markup: %s", (_name, make) => {
    const payload = make();
    expect(html(payload, "all")).toBe(html(payload));
  });
});

describe("part=\"main\": the one Main metrics table", () => {
  it("has the three groups in the UI-SPEC order, with every row in its group", () => {
    const { container } = mount(censusPayloadA(), "main");
    const groups = groupsOf(container);
    expect(groups.map((g) => g.group)).toEqual(["Record", "Returns", "Risk"]);
    expect(groups[0].labels).toEqual(["Start Date", "End Date", "Years Observed"]);
    // The month row's wording follows the clock (AD-10), so its slot is matched by pattern.
    expect(groups[1].labels[0]).toMatch(MONTH_ROW);
    expect(groups[1].labels.slice(1)).toEqual(["Year-to-date", "3 Month", "6 Month", "1 Year", "Win Rate (days)", "Profit Factor"]);
    expect(groups[2].labels).toEqual([
      "Longest DD (days)",
      "VaR 95%",
      "CVaR 95%",
      "Avg Win",
      "Avg Loss",
      "Skew",
      "Kurtosis (excess)",
    ]);
  });

  it("is one panel titled Main metrics under the range eyebrow, with the VaR method line once", () => {
    const { container } = mount(censusPayloadA(), "main");
    expect(titlesOf(container)).toEqual(["Main metrics"]);
    expect(container.querySelector('[data-testid="range-eyebrow-rail"]')).not.toBeNull();
    expect(container.querySelectorAll('[data-testid="var-method-line"]')).toHaveLength(1);
    expect(container.textContent).toContain(VAR_METHOD_LINE);
    // The comparator column header stays (the dated header of the existing panels).
    expect(container.textContent).toContain("vs ");
  });

  it("prints none of the figures the KPI strip owns", () => {
    const labels = rowsOf(mount(censusPayloadA(), "main").container).map((r) => r.label.toLowerCase());
    for (const owned of ["cumulative return", "since inception", "cagr", "ann. volatility", "sharpe", "sortino", "calmar", "max drawdown"]) {
      expect(labels.filter((l) => l.startsWith(owned))).toEqual([]);
    }
  });

  it("every row is the cell the whole rail prints, so a moved row is not a re-derived one (T-196-20)", () => {
    const withheldRecord = built(400, WITHHELD);
    const cases: Array<[string, FactsheetPayload]> = [
      ["A", censusPayloadA()],
      ["B short record", censusPayloadB()],
      ["C under 90 days", censusPayloadC()],
      ["withheld headline", withheldRecord],
    ];
    for (const [name, payload] of cases) {
      const whole = rowsOf(mount(payload, "all").container);
      for (const row of rowsOf(mount(payload, "main").container)) {
        // The rail labels the kurtosis row "Kurtosis" in Main Metrics and "Kurtosis (excess)" in Extended.
        const labels = row.label === "Kurtosis (excess)" ? ["Kurtosis", "Kurtosis (excess)"] : [row.label];
        const same = whole.some((w) => labels.includes(w.label) && w.value === row.value && w.bench === row.bench);
        expect(same, `${name}: "${row.label}" = "${row.value}" / "${row.bench}" is not a cell of the whole rail`).toBe(true);
      }
    }
  });

  it("a withheld headline reads withheld in the main table, with no figure invented", () => {
    const rows = rowsOf(mount(built(400, WITHHELD), "main").container);
    const find = (label: string) => rows.find((r) => r.label === label);
    // Whole-record figures dash on a withheld row (the rail's one gate); the record dates stay.
    for (const label of ["Win Rate (days)", "Profit Factor", "Longest DD (days)", "VaR 95%", "CVaR 95%", "Avg Win", "Avg Loss", "Skew", "Kurtosis (excess)"]) {
      expect(find(label)?.value, label).toBe("—");
    }
    expect(find("Start Date")?.value).not.toBe("—");
  });

  it("6 Month and 1 Year show only when the record covers them; 3 Year and 5 Year only when non-null", () => {
    const labelsOf = (p: FactsheetPayload) => rowsOf(mount(p, "main").container).map((r) => r.label);
    const b = labelsOf(censusPayloadB()); // 200 days
    expect(b).toContain("6 Month");
    expect(b).not.toContain("1 Year");
    const c = labelsOf(censusPayloadC()); // 60 days
    expect(c).not.toContain("6 Month");
    expect(c).not.toContain("1 Year");
    for (const l of [labelsOf(censusPayloadA()), b, c]) {
      expect(l).not.toContain("3 Year");
      expect(l).not.toContain("5 Year");
    }
    const long = labelsOf(built(1300)); // a bit over three and a half years
    expect(long).toContain("3 Year");
    expect(long).not.toContain("5 Year");
  });

  it("while a range is selected the trailing rows hide and the note says why", async () => {
    const r = mount(censusPayloadA(), "main", [100, 400]);
    expect(r.container.querySelector('[data-testid="window-trailing-note"]')).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByTestId("zoom"));
    });
    expect(r.container.querySelector('[data-testid="window-trailing-note"]')).not.toBeNull();
    const labels = rowsOf(r.container).map((x) => x.label);
    for (const gone of ["Year-to-date", "3 Month", "6 Month", "1 Year"]) expect(labels).not.toContain(gone);
    expect(labels.some((l) => MONTH_ROW.test(l))).toBe(false);
    // Win Rate and Profit Factor read the slice and stay.
    expect(labels).toEqual(expect.arrayContaining(["Win Rate (days)", "Profit Factor", "Start Date"]));
  });
});

describe("part=\"detailed\": everything else, minus every moved metric", () => {
  const MOVED_PANELS = ["Compound Performance", "Main Metrics", "Returns", "Cumulative Return Metrics", "Max Drawdown"];

  it("starts with Detailed metrics and is the whole rail minus exactly the moved panels", () => {
    for (const [name, make] of PROFILES) {
      const payload = make();
      const detailed = titlesOf(mount(payload, "detailed").container);
      expect(detailed[0], name).toBe("Detailed metrics");
      const whole = titlesOf(mount(payload, "all").container).filter((t) => !MOVED_PANELS.includes(t));
      expect(detailed.slice(1), name).toEqual(whole);
    }
  });

  it("renders no moved panel", () => {
    const titles = titlesOf(mount(censusPayloadA(), "detailed").container);
    for (const moved of MOVED_PANELS) expect(titles).not.toContain(moved);
  });

  it("Extended Metrics keeps the rows nothing else owns and drops the rest with the VaR line", () => {
    const { container } = mount(censusPayloadA(), "detailed");
    const labels = rowsOf(panelOf(container, "Extended Metrics")).map((r) => r.label);
    expect(labels).toEqual([
      "Omega (θ=0)",
      "Tail Ratio (P95/|P5|)",
      "Common-sense Ratio",
      "Recovery Factor",
      "Pain Index",
      "Ulcer Index",
      "Avg Win / Avg Loss",
    ]);
    expect(container.querySelector('[data-testid="var-method-line"]')).toBeNull();
  });

  it("Benchmark Joint Metrics drops Alpha and Information Ratio and keeps the rest", () => {
    const { container } = mount(censusPayloadA(), "detailed");
    const labels = rowsOf(container).map((r) => r.label);
    expect(labels).toEqual(expect.arrayContaining(["Beta", "Correlation", "R²", "Treynor", "Tracking Error", "Up Capture", "Down Capture"]));
    expect(labels).not.toContain("Alpha (ann)");
    expect(labels).not.toContain("Information Ratio");
    // The whole rail still has them (the allocator mounts).
    const whole = rowsOf(mount(censusPayloadA(), "all").container).map((r) => r.label);
    expect(whole).toEqual(expect.arrayContaining(["Alpha (ann)", "Information Ratio"]));
  });

  it("Bootstrap shows the 95% CI column only", () => {
    const { container } = mount(censusPayloadA(), "detailed");
    const boot = panelOf(container, "Bootstrap 95% Confidence");
    const heads = Array.from(boot.querySelectorAll("thead th")).map((t) => t.textContent);
    expect(heads).toEqual(["Metric", "95% CI"]);
    const firstRow = boot.querySelector("tbody tr") as HTMLElement;
    expect(firstRow.querySelectorAll("td")).toHaveLength(2);
    expect(firstRow.textContent).toMatch(/\[.+,.+\]/);
    // The whole rail still has the Point column.
    expect(html(censusPayloadA(), "all")).toContain(">Point<");
  });

  it("Terms drops the on-request rows, the Fees sub-heading and Observation start and end", () => {
    const { container } = mount(censusPayloadA(), "detailed");
    expect(container.textContent).not.toContain("on request");
    expect(container.textContent).not.toContain("Fees & Subscription");
    expect(container.textContent).not.toContain("Observation start");
    expect(container.textContent).not.toContain("Observation end");
    expect(container.textContent).toContain("Allocators should request the full fund offering memorandum directly from the manager before subscribing.");
    // The whole rail keeps all seven (the allocator mounts).
    const whole = mount(censusPayloadA(), "all").container.textContent ?? "";
    expect(whole.split("— on request")).toHaveLength(8);
  });
});

/** The two halves side by side in one article, as the layout mounts them, ready for the census. */
function combinedHost(payload: FactsheetPayload, drop?: string): HTMLElement {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const main = mount(payload, "main");
  const detailed = mount(payload, "detailed");
  const combined = document.createElement("article");
  combined.id = "factsheet-main";
  combined.innerHTML = main.container.innerHTML + detailed.container.innerHTML;
  main.unmount();
  detailed.unmount();
  if (drop) combined.querySelectorAll(drop).forEach((e) => e.remove());
  host.appendChild(combined);
  return host;
}

/** The 365-day rolling table's wrapper (RollingMetricsPanel): present only on a record of a year or more. */
const ROLLING_1Y = '[data-testid="rolling-metrics-1y"]';

describe("one metric, one home: main and detailed together", () => {
  it.each(PROFILES)("the census finds no repeated metric label: %s", (_name, make) => {
    // The 1y rolling table is set aside here and pinned on its own below.
    const host = combinedHost(make(), ROLLING_1Y);
    const counts = countFactsheetCensus(host);
    host.remove();
    expect(counts.repeatedMetrics).toEqual([]);
    // Positive control: the counter did read labels from both halves.
    expect(counts.metricLabels).toEqual(expect.arrayContaining(["start date", "win rate", "omega"]));
    expect(counts.onRequestRows).toBe(0);
  });

  it("a metric put back into the second half would be caught (the repeat arm can fail)", () => {
    const main = mount(censusPayloadA(), "main");
    const host = document.createElement("div");
    document.body.appendChild(host);
    const combined = document.createElement("article");
    combined.id = "factsheet-main";
    // "Skew" is a Main metrics row; a second one in a Kpm table is the repeat D-04 forbids.
    combined.innerHTML =
      main.container.innerHTML +
      '<table class="w-full text-fixed-12"><tbody><tr><td>Skew</td><td>0.1</td><td></td></tr></tbody></table>';
    main.unmount();
    host.appendChild(combined);
    const counts = countFactsheetCensus(host);
    host.remove();
    expect(counts.repeatedMetrics).toEqual(["skew"]);
  });

  /**
   * OPEN ITEM, recorded rather than hidden (196-09 SUMMARY). "Rolling Metrics (6mo)" and
   * "Rolling Metrics (1y)" both list Volatility, Sharpe and Sortino, and the census counts a row
   * label once per table, so a record of a year or more repeats those three labels. The plan keeps
   * Rolling Metrics in the detailed part (UI-SPEC), so this plan neither merges the tables nor
   * relabels rows; the census-after plan owns the call. When it is made, this arm goes red: update
   * it, do not loosen the arm above.
   */
  it("pinned open item: the 6mo and 1y rolling tables repeat their three row labels on a year-long record", () => {
    const host = combinedHost(censusPayloadA());
    const counts = countFactsheetCensus(host);
    host.remove();
    expect(counts.repeatedMetrics).toEqual(["sharpe", "sortino", "volatility"]);
    // A record under a year has no 1y table, so nothing repeats there.
    const hostB = combinedHost(censusPayloadB());
    const countsB = countFactsheetCensus(hostB);
    hostB.remove();
    expect(countsB.repeatedMetrics).toEqual([]);
  });
});

describe("notes: which small-sample and coverage notes each half carries (UI-SPEC One small-sample warning)", () => {
  const shortRecord = () => withRecord(censusPayloadB(), 200);

  it("control: the whole rail still carries the rail figure-gate note and the bootstrap sentence on a short record", () => {
    const whole = mount(shortRecord(), "all").container;
    expect(whole.querySelector('[data-testid="figure-gate-note"]')).not.toBeNull();
    expect(whole.textContent).toContain("Bootstrap resamples are drawn from");
  });

  it("the rail figure-gate note is in neither half: the strip's note is the page's one", () => {
    for (const part of ["main", "detailed"] as const) {
      expect(mount(shortRecord(), part).container.querySelector('[data-testid="figure-gate-note"]'), part).toBeNull();
    }
  });

  it("the bootstrap resample sentence is in neither half", () => {
    for (const part of ["main", "detailed"] as const) {
      expect(mount(shortRecord(), part).container.textContent, part).not.toContain("Bootstrap resamples are drawn from");
    }
  });

  it("the rolling table's short-window sentence is in neither half, and the whole rail still has it", () => {
    const SHORT = "Rolling figures are annualized from a";
    expect(mount(shortRecord(), "all").container.textContent).toContain(SHORT);
    for (const part of ["main", "detailed"] as const) {
      expect(mount(shortRecord(), part).container.textContent, part).not.toContain(SHORT);
    }
  });

  it("a rolling window withheld for a record under 90 days keeps its reason: it is a per-figure reason, not a warning", () => {
    const text = mount(censusPayloadC(), "detailed").container.textContent ?? "";
    expect(text).toContain("Rolling annualized figures appear once the record reaches 90 days");
  });

  it("the comparator-specific notes stay: bench-figure-gate-note in main, the overlap note in detailed", () => {
    // A 200-day record with a comparator: the comparator's own annualization note speaks for its column.
    expect(mount(censusPayloadB(), "main").container.querySelector('[data-testid="bench-figure-gate-note"]')).not.toBeNull();
    expect(mount(censusPayloadB(), "detailed").container.querySelector('[data-testid="joint-annualization-note"]')).not.toBeNull();
  });

  it("neither half carries a small-sample warning of the census family: the strip's note is the page's one", () => {
    for (const [name, make] of PROFILES) {
      const host = combinedHost(withRecord(make(), 200));
      const counts = countFactsheetCensus(host);
      host.remove();
      expect(counts.warningKinds, name).toEqual([]);
    }
  });

  it("the VaR method line appears once across the two halves", () => {
    const n =
      mount(censusPayloadA(), "main").container.querySelectorAll('[data-testid="var-method-line"]').length +
      mount(censusPayloadA(), "detailed").container.querySelectorAll('[data-testid="var-method-line"]').length;
    expect(n).toBe(1);
  });
});
