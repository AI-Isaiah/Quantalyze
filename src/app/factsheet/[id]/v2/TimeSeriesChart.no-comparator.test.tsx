/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import type { DailyReturn } from "@/lib/factsheet/types";
import { buildFactsheetPayload } from "@/lib/factsheet/build-payload";
import { CHART_CONFIGS } from "./chart-configs";
import { FactsheetProvider } from "./factsheet-context";
import { TimeSeriesChart } from "./TimeSeriesChart";

/**
 * Phase 170.1 plan 03 (D-11, UI-SPEC V-3): a chart with no comparator selected prints
 * an EMPTY subtitle and an aria-label with no "vs" clause. The founder saw "vs None"
 * under every benchmark chart on /allocations?tab=scenario (PROD, 2026-09-27) because
 * `subtitleFor` read the picker's stub name. "No comparator" is decided by the SAME
 * test the aria-label already used (`!!cmp.cumulative`, the series), never by matching
 * the string "None": the last case below sets a real name on a block with no series.
 *
 * The harness is the one `TimeSeriesChart.coverage-gap.test.tsx` uses: a real payload
 * from `buildFactsheetPayload`, rendered inside `FactsheetProvider` with persistence off.
 */

vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: vi.fn() }));

const lsStore = new Map<string, string>();
beforeEach(() => {
  lsStore.clear();
  vi.stubGlobal("localStorage", {
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
  });
});

const DAY = 86_400_000;
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
const ROWS: DailyReturn[] = Array.from({ length: 40 }, (_, i) => ({
  date: iso(Date.UTC(2025, 0, 1) + i * DAY),
  value: 0.01 * Math.sin(i * 1.1) + 0.004 * Math.cos(i * 0.37),
}));
const META = { id: "nc", name: "No Comparator Fixture", types: [], markets: [], computedAt: "x", trustTier: null, assetClass: "crypto" } as const;

function payloadFor() {
  const payload = buildFactsheetPayload({ ...META, types: [], markets: [] }, ROWS);
  if (!payload) throw new Error("fixture payload must build");
  return payload;
}

type Payload = ReturnType<typeof payloadFor>;

function renderChart(key: string, payload: Payload) {
  const cfg = CHART_CONFIGS.find((c) => c.key === key);
  if (!cfg) throw new Error(`no chart config ${key}`);
  const { container } = render(
    <FactsheetProvider payload={payload} persist={false}>
      <TimeSeriesChart config={cfg} />
    </FactsheetProvider>,
  );
  const subtitle = container.querySelector("header p");
  const frame = container.querySelector('[role="img"]');
  if (!subtitle || !frame) throw new Error("chart header subtitle and role=img frame must render");
  return { cfg, container, subtitle, frame };
}

/** The picker on "None": the payload the scenario tab and a unit-pinned strategy produce. */
const noComparator = (): Payload => ({ ...payloadFor(), activeComparator: "none" });

describe("170.1-03 D-11: no comparator selected prints no 'vs None'", () => {
  it("cumulative (comparatorField, static subtitle absent): empty subtitle <p> stays, aria-label has no vs clause", () => {
    const { cfg, container, subtitle, frame } = renderChart("cumulative", noComparator());
    expect(cfg.subtitle, "this case needs a chart WITHOUT a static subtitle").toBeUndefined();
    expect(subtitle.textContent).toBe("");
    expect(container.textContent).not.toMatch(/vs None/);
    expect(frame.getAttribute("aria-label")).toBe(`${cfg.title}: ${noComparator().strategyName}`);
    expect(frame.getAttribute("aria-label")).not.toContain(" vs ");
  });

  it("every comparator-bearing chart without a static subtitle is empty and vs-free", () => {
    const keys = CHART_CONFIGS.filter((c) => c.comparatorField && c.subtitle === undefined).map((c) => c.key);
    expect(keys.length, "the loop must cover at least cumulative").toBeGreaterThan(0);
    for (const key of keys) {
      const { subtitle, frame, container } = renderChart(key, noComparator());
      expect(subtitle.textContent, `${key} subtitle`).toBe("");
      expect(container.textContent, `${key} text`).not.toMatch(/vs None|None comparator/);
      expect(frame.getAttribute("aria-label"), `${key} aria-label`).not.toMatch(/ vs | divided by /);
      container.remove();
    }
  });

  it("a comparatorAsPrimary chart with no comparator: aria-label '{title}: {strategy}', never 'None comparator'", () => {
    const primary = CHART_CONFIGS.find((c) => c.comparatorAsPrimary && !c.stratField);
    expect(primary, "a comparatorAsPrimary chart with no strategy field must exist").toBeDefined();
    const { cfg, container, subtitle, frame } = renderChart(primary!.key, noComparator());
    expect(frame.getAttribute("aria-label")).toBe(`${cfg.title}: ${noComparator().strategyName}`);
    expect(subtitle.textContent).not.toMatch(/None/);
    expect(container.textContent).not.toMatch(/None comparator/);
  });

  it("positive control: with a comparator series the subtitle still reads 'vs {name}'", () => {
    const payload = payloadFor();
    expect(payload.activeComparator).toBe("btc");
    const { subtitle, frame } = renderChart("cumulative", payload);
    expect(subtitle.textContent).toBe(`vs ${payload.comparators.btc.name}`);
    expect(frame.getAttribute("aria-label")).toBe(
      `Cumulative Returns: ${payload.strategyName} vs ${payload.comparators.btc.name}`,
    );
  });

  it("hasCmp edge: a NAMED comparator whose cumulative series is null prints an empty subtitle (the gate is the series, not the name)", () => {
    const base = payloadFor();
    const named: Payload = {
      ...base,
      comparators: { ...base.comparators, btc: { ...base.comparators.btc, name: "BTC-USD", cumulative: null } },
    };
    expect(named.comparators.btc.name).not.toBe("None");
    const { subtitle, frame, container } = renderChart("cumulative", named);
    expect(subtitle.textContent).toBe("");
    expect(container.textContent).not.toMatch(/vs BTC-USD/);
    expect(frame.getAttribute("aria-label")).toBe(`Cumulative Returns: ${base.strategyName}`);
  });
});
