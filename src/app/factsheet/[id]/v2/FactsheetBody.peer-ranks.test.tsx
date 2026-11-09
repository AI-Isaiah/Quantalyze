import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, waitFor, within } from "@testing-library/react";
import type { FactsheetPayload, PeerRanks } from "@/lib/factsheet/types";
import { figureRecord, shortTrackMarkerTitle } from "@/lib/figure-gate";
import { hasPeerRanks } from "@/components/strategy/PeerRanksSection";
import { countFactsheetCensus } from "../../../../../scripts/factsheet-census/count";
import { FactsheetView } from "./FactsheetView";
import { censusPayloadA } from "./test-fixtures/census-payloads";

/**
 * Phase 196 plan 16 (LEAN-02) — the factsheet's peer-relative ranks keep the tear sheet's gate.
 *
 * WHY this file exists: the same rank must read the same on the print view and on the
 * factsheet, and an annualised rank must never sit beside a figure the 194 gate withholds. The
 * ranks are ONE component (`PeerRanksSection`) with two mounts, so these four gate arms copy the
 * tear sheet's (`tearsheet/page.rank-gate.test.tsx`) spans and counts onto the factsheet's
 * Advanced mount: a mount that stopped passing the payload's `figureRecord` through, or a gate
 * edited on one side only, goes RED on one of the two files. The remaining arms pin the
 * structural promises: the section counts as rail content (an Advanced holding only the ranks
 * still renders), and a rank badge is not a metric the figure census counts twice.
 */

vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

const lsStore = new Map<string, string>();
const localStorageMock = {
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
};
beforeEach(() => {
  lsStore.clear();
  vi.clearAllMocks();
  vi.stubGlobal("localStorage", localStorageMock);
  Object.defineProperty(window, "localStorage", { value: localStorageMock, configurable: true });
  window.history.replaceState({}, "", "/");
});

// Several arms render the whole page with Advanced open; the default 5 s is too tight on a loaded
// machine. This file only.
vi.setConfig({ testTimeout: 60_000 });

const ENTRY = { cumulative_return: 90, cagr: 70, sharpe: 80, sortino: 75, calmar: 65, max_drawdown: 60, volatility: 55 };
const RANKS: PeerRanks = { categorySlug: "momentum", percentiles: ENTRY };

type Span = { start: string; end: string; observations: number } | null;

/** The census fixture A carrying ranks and a record built from the same inputs the tear sheet arms use. */
function withRanks(span: Span | undefined, ranks: PeerRanks | null = RANKS): FactsheetPayload {
  const base = censusPayloadA();
  const record =
    span === undefined
      ? base.figureRecord
      : span === null
        ? null
        : figureRecord({
            seriesStart: span.start,
            seriesEnd: span.end,
            observations: span.observations,
            periodsPerYear: 252,
          });
  return { ...base, figureRecord: record, peerRanks: ranks } as FactsheetPayload;
}

function advancedEl(container: HTMLElement): HTMLDetailsElement {
  const el = container.querySelector<HTMLDetailsElement>("details#factsheet-advanced");
  expect(el, "details#factsheet-advanced did not render").not.toBeNull();
  return el!;
}

/** Open Advanced and wait for its contents (the lazily mounted heatmaps are the last to arrive). */
async function openAdvanced(container: HTMLElement) {
  fireEvent.click(advancedEl(container).querySelector("summary")!);
  await waitFor(
    () => {
      if (!container.textContent?.includes("Monthly Returns")) throw new Error("heatmaps not mounted yet");
    },
    { timeout: 10_000 },
  );
}

async function mountOpen(payload: FactsheetPayload) {
  const view = render(<FactsheetView payload={payload} />);
  await openAdvanced(view.container);
  return view;
}

/** The "Peer-relative ranks" section inside Advanced's contents. */
function rankSection(container: HTMLElement): HTMLElement {
  const contents = advancedEl(container).querySelector("[data-advanced-contents]")!;
  const heading = within(contents as HTMLElement).getByText("Peer-relative ranks");
  return heading.closest("section") as HTMLElement;
}

function badges(container: HTMLElement): HTMLElement[] {
  return within(rankSection(container)).getAllByTestId("percentile-rank-badge");
}

function badge(container: HTMLElement, label: string): HTMLElement {
  const hit = badges(container).find((el) => el.firstElementChild?.textContent === label);
  if (!hit) throw new Error(`no ${label} badge`);
  return hit;
}

const labels = (container: HTMLElement): string[] =>
  badges(container).map((el) => el.firstElementChild?.textContent ?? "");

describe("the factsheet's ranks carry the tear sheet's short-track marker (D-15)", () => {
  it("a 200-day record: CAGR, Sharpe, Sortino and Volatility badges carry <1y; Max DD does not", async () => {
    // 2025-09-01 -> 2026-03-19 covers 200 days; 140 observations clears the 60 minimum.
    const { container } = await mountOpen(withRanks({ start: "2025-09-01", end: "2026-03-19", observations: 140 }));
    const reason = shortTrackMarkerTitle(200);
    for (const label of ["CAGR", "Sharpe", "Sortino", "Volatility"]) {
      const b = badge(container, label);
      expect(b, label).toHaveTextContent("<1y");
      expect(within(b).getByTitle(reason), label).toBeInTheDocument();
    }
    const dd = badge(container, "Max DD");
    expect(dd).not.toHaveTextContent("<1y");
    expect(dd.querySelector(".sr-only")).toBeNull();
  });

  it("a 400-day record: five badges, none carries the marker", async () => {
    // 2025-01-01 -> 2026-02-05 is 400 calendar days.
    const { container } = await mountOpen(withRanks({ start: "2025-01-01", end: "2026-02-05", observations: 280 }));
    const all = badges(container);
    expect(all).toHaveLength(5);
    for (const b of all) expect(b).not.toHaveTextContent("<1y");
  });
});

describe("a withheld or unreadable record ranks Max DD only (194 review WR-01, D-18)", () => {
  it("a 20-observation record (under D-15's minimum): only the Max DD rank renders, though all five were read", async () => {
    const { container } = await mountOpen(withRanks({ start: "2026-03-01", end: "2026-03-20", observations: 20 }));
    expect(labels(container)).toEqual(["Max DD"]);
  });

  it("a record that could not be read (figureRecord null): the annualised ranks do not render; Max DD keeps its rank", async () => {
    const { container } = await mountOpen(withRanks(null));
    expect(labels(container)).toEqual(["Max DD"]);
  });
});

describe("where the ranks sit, and what they add to the census", () => {
  it("is the last thing in the Detailed metrics rail, inside Advanced, and absent from the closed view", async () => {
    const payload = withRanks(undefined);
    const view = render(<FactsheetView payload={payload} />);
    expect(view.container.textContent, "ranks in the opening view").not.toContain("Peer-relative ranks");
    expect(advancedEl(view.container).querySelector("summary")!.textContent).not.toMatch(/rank/i);
    await openAdvanced(view.container);
    const section = rankSection(view.container);
    expect(advancedEl(view.container).contains(section)).toBe(true);
    // After the rail's own table: nothing from the rail follows the ranks inside their column.
    const rail = section.parentElement!;
    expect(rail.lastElementChild).toBe(section);
    expect(rail.firstElementChild, "the rail sits before the ranks").not.toBe(section);
    expect(badges(view.container)).toHaveLength(5);
  });

  it("adds no repeated metric: a rank badge is not a Row, strip cell or KPI tile", async () => {
    const without = await mountOpen(withRanks(undefined, null));
    const baseline = countFactsheetCensus(without.container);
    without.unmount();
    // Advanced's open state persists in localStorage; clear it so the second mount opens by click.
    lsStore.clear();
    const withIt = await mountOpen(withRanks(undefined));
    expect(badges(withIt.container), "the ranks did not render: the arm would pass vacuously").toHaveLength(5);
    const c = countFactsheetCensus(withIt.container);
    // The plan's target is [] with Advanced open. At this base the Rolling Metrics tables
    // repeat sharpe / sortino / volatility (196-09 open item 1, pinned in
    // FactsheetBody.census.test.tsx); that is not this plan's to close. What this plan owns is that
    // the ranks add nothing to it.
    expect(c.repeatedMetrics).toEqual(baseline.repeatedMetrics);
    expect(c.metricLabels).toEqual(baseline.metricLabels);
    expect(c.sections, "the ranks added a section to the census").toBe(baseline.sections);
    expect(c.smallSampleWarnings).toBe(baseline.smallSampleWarnings);
  });

  it("counts the ranks as rail content: a record with no observations still names Detailed metrics when ranks exist, and not otherwise", () => {
    const base = censusPayloadA();
    const empty = {
      ...base,
      dates: [],
      strategyReturns: [],
      monthlyReturns: [],
      dailyHeatmap: [],
      streaks: { ...base.streaks, totalWins: 0, totalLosses: 0 },
      stressWindows: { ...base.stressWindows, windows: [] },
      correlations: [],
      correlationMatrix: { ...base.correlationMatrix, labels: [] },
      strategyMetrics: { ...base.strategyMetrics, yearly: {} },
    } as FactsheetPayload;
    // The Returns Signatures section keeps the row on this fixture either way, so the contents
    // line is what tells the rail flag apart: with ranks it names the rail, without it does not.
    const ranksOnly = render(<FactsheetView payload={{ ...empty, peerRanks: RANKS } as FactsheetPayload} />);
    expect(advancedEl(ranksOnly.container).querySelector("summary")!.textContent).toContain("Detailed metrics");
    ranksOnly.unmount();
    const neither = render(<FactsheetView payload={{ ...empty, peerRanks: null } as FactsheetPayload} />);
    expect(advancedEl(neither.container).querySelector("summary")!.textContent).not.toContain("Detailed metrics");
  });

  it("hasPeerRanks is the component's own predicate: it flips exactly when no badge would draw", () => {
    const clears = figureRecord({ seriesStart: "2025-01-01", seriesEnd: "2026-02-05", observations: 280, periodsPerYear: 252 });
    const fails = figureRecord({ seriesStart: "2026-03-01", seriesEnd: "2026-03-20", observations: 20, periodsPerYear: 252 });
    expect(hasPeerRanks(ENTRY, clears)).toBe(true);
    // Withheld: Max DD still draws, so the section does.
    expect(hasPeerRanks(ENTRY, fails)).toBe(true);
    expect(hasPeerRanks(ENTRY, null)).toBe(true);
    // Nothing to draw: no entry, or an entry holding only withheld annualised values.
    expect(hasPeerRanks(null, clears)).toBe(false);
    const annualisedOnly = { cagr: 70, sharpe: 80, sortino: 75, volatility: 55 };
    expect(hasPeerRanks(annualisedOnly, fails)).toBe(false);
    expect(hasPeerRanks(annualisedOnly, clears)).toBe(true);
    expect(hasPeerRanks({ max_drawdown: NaN }, clears)).toBe(false);
  });
});
