/** @vitest-environment jsdom */
/**
 * Phase 196 plan 01 (SC-5): the census counting rules, proven two ways.
 *
 *   1. Synthetic DOM, red and green: each rule fires on a hand-built article and
 *      stays quiet on its look-alike.
 *   2. The REAL FactsheetBody markup: positive controls (a non-zero chart, section
 *      and metric-label count, "sharpe" repeated) so a selector that matches nothing
 *      reports RED here instead of a flattering zero in 196-CENSUS.md. A census whose
 *      selectors silently match nothing would read as "no repeats, no warnings", which
 *      is exactly the answer SC-5 hopes for and the one it must not get for free.
 */
import { describe, it, expect, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { FactsheetProvider } from "@/app/factsheet/[id]/v2/factsheet-context";
import { FactsheetBody } from "@/app/factsheet/[id]/v2/FactsheetView";
import {
  censusPayloadA,
  censusPayloadB,
  censusPayloadC,
} from "@/app/factsheet/[id]/v2/test-fixtures/census-payloads";
import type { FactsheetPayload } from "@/lib/factsheet/types";
import { CENSUS_ALIASES, CENSUS_ALIAS_PREFIXES, countFactsheetCensus } from "./count";

vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

/** Mount `inner` inside an article#factsheet-main, optionally with markup outside it. */
function mount(inner: string, outside = ""): HTMLElement {
  const host = document.createElement("div");
  host.innerHTML = `${outside}<article id="factsheet-main">${inner}</article>`;
  return host;
}

/** A Kpm-style metric table: one row per label (the markup `Row` renders). */
function table(...labels: string[]): string {
  const rows = labels.map((l) => `<tr><td class="text-text-2">${l}</td><td>1.00</td><td></td></tr>`).join("");
  return `<table class="w-full text-fixed-12"><tbody>${rows}</tbody></table>`;
}

describe("countFactsheetCensus: synthetic rules", () => {
  it("an empty article, or no article at all, is all zeros", () => {
    const zero = {
      sections: 0,
      charts: 0,
      masterBrush: 0,
      metricLabels: [],
      repeatedMetrics: [],
      smallSampleWarnings: 0,
      warningKinds: [],
      visibleChartHints: 0,
      onRequestRows: 0,
    };
    expect(countFactsheetCensus(mount(""))).toEqual(zero);
    expect(countFactsheetCensus(document.createElement("div"))).toEqual(zero);
  });

  it("the same label twice is one repeated metric", () => {
    const c = countFactsheetCensus(mount(table("Sharpe", "Sharpe")));
    expect(c.repeatedMetrics).toEqual(["sharpe"]);
    // Green twin: two different labels repeat nothing.
    expect(countFactsheetCensus(mount(table("Sharpe", "Sortino"))).repeatedMetrics).toEqual([]);
  });

  it("a trailing qualifier does not make a different metric: Kurtosis and Kurtosis (excess)", () => {
    expect(countFactsheetCensus(mount(table("Kurtosis", "Kurtosis (excess)"))).repeatedMetrics).toEqual(["kurtosis"]);
    expect(countFactsheetCensus(mount(table("Win Rate (days)", "Win Rate"))).repeatedMetrics).toEqual(["win rate"]);
  });

  it("Since Inception and Cum. Return are one metric", () => {
    expect(countFactsheetCensus(mount(table("Since Inception", "Cum. Return"))).repeatedMetrics).toEqual([
      "cumulative return",
    ]);
  });

  it("a returns-unit suffix on a strip label is stripped: Cum. Return (BTC)", () => {
    const strip = `<section><p data-testid="factsheet-kpi-label">Cum. Return (BTC)</p></section>`;
    expect(countFactsheetCensus(mount(strip + table("Since Inception"))).repeatedMetrics).toEqual([
      "cumulative return",
    ]);
  });

  it("alpha and information ratio in the strip and the rail are the same metrics", () => {
    const strip = `<section><p data-testid="factsheet-kpi-label">α vs BTC</p><p data-testid="factsheet-kpi-label">IR vs BTC</p></section>`;
    const c = countFactsheetCensus(mount(strip + table("Alpha (ann)", "Information Ratio")));
    expect(c.repeatedMetrics).toEqual(["alpha", "information ratio"]);
  });

  it("a Term (dt) label counts: Observation start repeats Start Date", () => {
    const dl = `<dl><dt>Observation start</dt><dd>Jan 1, 2025</dd></dl>`;
    expect(countFactsheetCensus(mount(table("Start Date") + dl)).repeatedMetrics).toEqual(["start date"]);
  });

  // The exported alias tables are the record in 196-CENSUS.md; the function carries its own copy
  // (it must be self-contained for page.evaluate). Driving every entry through the function is
  // what stops the two copies drifting apart.
  it("every exported alias entry behaves as the function applies it", () => {
    for (const [from, to] of Object.entries(CENSUS_ALIASES)) {
      const c = countFactsheetCensus(mount(table(from, to)));
      expect(c.repeatedMetrics, `${from} -> ${to}`).toEqual([to]);
    }
    for (const [prefix, to] of Object.entries(CENSUS_ALIAS_PREFIXES)) {
      const c = countFactsheetCensus(mount(table(`${prefix}ETH`, to)));
      expect(c.repeatedMetrics, `${prefix}<name> -> ${to}`).toEqual([to]);
    }
  });

  it("content outside article#factsheet-main is ignored", () => {
    const outside = table("Sharpe", "Sharpe") + `<dl><dt>x</dt><dd>— on request</dd></dl><p>Ctrl/Cmd + wheel to zoom</p>`;
    const c = countFactsheetCensus(mount("", outside));
    expect(c.metricLabels).toEqual([]);
    expect(c.onRequestRows).toBe(0);
    expect(c.visibleChartHints).toBe(0);
  });

  it("a visible chart hint counts; an sr-only hint, and one under a closed details, do not", () => {
    const visibleHint = `<p>Ctrl/Cmd + wheel to zoom · double-click to reset</p>`;
    expect(countFactsheetCensus(mount(visibleHint)).visibleChartHints).toBe(1);
    const srOnly = `<span class="sr-only">Hold Control or Command and turn the mouse wheel to zoom toward the cursor.</span>`;
    expect(countFactsheetCensus(mount(srOnly)).visibleChartHints).toBe(0);
    const closed = `<details id="factsheet-x"><summary>X</summary>${visibleHint}</details>`;
    expect(countFactsheetCensus(mount(closed)).visibleChartHints).toBe(0);
    const open = `<details id="factsheet-x" open><summary>X</summary>${visibleHint}</details>`;
    expect(countFactsheetCensus(mount(open)).visibleChartHints).toBe(1);
  });

  it("the stable-id hint counts once even when its text also matches the phrases", () => {
    const hint = `<p id="factsheet-chart-hint">Ctrl/Cmd + wheel zooms · drag pans · double-click resets.</p>`;
    expect(countFactsheetCensus(mount(hint)).visibleChartHints).toBe(1);
    const nested = `<p id="factsheet-chart-hint"><span>Ctrl/Cmd + wheel zooms</span> · drag pans</p>`;
    expect(countFactsheetCensus(mount(nested)).visibleChartHints).toBe(1);
  });

  it("sections: collapsibles, editorial sections, the strip and census hooks; closed contents are not counted", () => {
    const html = `
      <details id="factsheet-perf" open><summary>Performance</summary>
        <section data-census-section><h3>Hooked</h3></section>
      </details>
      <details id="factsheet-advanced"><summary>Advanced</summary>
        <details id="factsheet-dist" open><summary>Distribution</summary></details>
      </details>
      <section><header><div><h2>Risk</h2></div></header></section>
      <section><p data-testid="factsheet-kpi-label">Sharpe</p></section>
      <section><h3>Plain panel, not a top-level block</h3></section>`;
    // perf + hook + advanced + editorial + strip = 5; the inner dist is under the closed Advanced.
    expect(countFactsheetCensus(mount(html)).sections).toBe(5);
  });

  it("charts: a figure with an inner role=img is one chart; a bare role=img is one; the brush is a control", () => {
    const html = `
      <section aria-label="Master timeline brush"><svg role="img" aria-label="Master brush — full timeline equity overview"></svg></section>
      <figure><svg role="img" aria-label="Cumulative Returns"></svg></figure>
      <svg role="img" aria-label="Sharpe bootstrap distribution"></svg>`;
    const c = countFactsheetCensus(mount(html));
    expect(c.charts).toBe(2);
    expect(c.masterBrush).toBe(1);
  });

  it("small-sample warnings: every member of the family counts once", () => {
    const html = `
      <p data-testid="strip-figure-gate-note">CAGR, volatility ... under one year.</p>
      <p data-testid="figure-gate-note">CAGR ... under one year.</p>
      <p data-testid="bench-figure-gate-note">comparator note, not in the family</p>
      <p>Bootstrap resamples are drawn from 200 observations.</p>
      <p>strategy equity · Rolling figures are annualized from a 126-day window, under one year.</p>
      <section><h3>Rolling β — Not enough data</h3><p>too short</p></section>
      <section><h3>Volatility Matched — Not available</h3><p>no scale</p></section>
      <section><h3>Rolling Metrics (6mo)</h3><p>a normal panel</p></section>`;
    const c = countFactsheetCensus(mount(html));
    expect(c.smallSampleWarnings).toBe(6);
    expect(c.warningKinds).toEqual([
      "bootstrap-line x1",
      "figure-gate-note x1",
      "not-enough-data-card x2",
      "rolling-subtitle x1",
      "strip-figure-gate-note x1",
    ]);
  });

  it('"— on request" counts only an exact value cell', () => {
    const html = `<dl><dt>Management fee</dt><dd>— on request</dd><dt>Lockup</dt><dd>— on request</dd><dt>Fee note</dt><dd>fees are on request</dd></dl>`;
    expect(countFactsheetCensus(mount(html)).onRequestRows).toBe(2);
  });

  it("data-census-skip removes an element from every count", () => {
    const html = `<div data-census-skip>${table("Sharpe", "Sharpe")}<p>Ctrl/Cmd + wheel to zoom</p></div>`;
    const c = countFactsheetCensus(mount(html));
    expect(c.metricLabels).toEqual([]);
    expect(c.visibleChartHints).toBe(0);
  });
});

/** Render the real FactsheetBody and wait for its dynamically imported panels (the heatmaps). */
async function renderBody(payload: FactsheetPayload) {
  const view = render(
    <FactsheetProvider payload={payload} persist={false}>
      <FactsheetBody payload={payload} hideFooter />
    </FactsheetProvider>,
  );
  await waitFor(
    () => {
      if (!view.container.textContent?.includes("Monthly Returns")) throw new Error("heatmaps not mounted yet");
    },
    { timeout: 10_000 },
  );
  return view;
}

describe("countFactsheetCensus: the real FactsheetBody markup (positive controls)", () => {
  it("profile A: the selectors find real charts, sections and labels, and the layout's repeats", async () => {
    const { container } = await renderBody(censusPayloadA());
    const c = countFactsheetCensus(container);
    // Floors, not exact numbers: Phase 196 reshapes this layout, and this test must keep proving
    // the SELECTORS match real markup on whichever layout is current. A selector that matches
    // nothing turns each of these RED.
    expect(c.charts, "charts: figure / role=img selectors matched nothing").toBeGreaterThanOrEqual(8);
    expect(c.sections, "sections: details / section / strip selectors matched nothing").toBeGreaterThanOrEqual(6);
    expect(c.masterBrush, "the brush control selector matched nothing").toBe(1);
    expect(c.metricLabels, "label selectors matched nothing").toEqual(
      expect.arrayContaining(["sharpe", "max drawdown", "start date"]),
    );
    expect(c.repeatedMetrics, "the strip and the rail both print Sharpe").toContain("sharpe");
    expect(c.onRequestRows, "TermsPanel prints seven '— on request' rows").toBe(7);
    expect(c.visibleChartHints, "the histogram prints its visible hint").toBeGreaterThanOrEqual(1);
  });

  it("profile B: a record under a year raises the small-sample family", async () => {
    const { container } = await renderBody(censusPayloadB());
    const c = countFactsheetCensus(container);
    expect(c.smallSampleWarnings, "warning selectors matched nothing on a short record").toBeGreaterThanOrEqual(2);
    expect(container.querySelector('[data-testid="strip-figure-gate-note"]')).not.toBeNull();
  });

  it("profile C: a record under 90 days withholds figures and still counts its panels", async () => {
    const { container } = await renderBody(censusPayloadC());
    const c = countFactsheetCensus(container);
    expect(c.sections).toBeGreaterThanOrEqual(6);
    expect(c.charts).toBeGreaterThanOrEqual(8);
    expect(c.metricLabels).toContain("max drawdown");
  });
});
