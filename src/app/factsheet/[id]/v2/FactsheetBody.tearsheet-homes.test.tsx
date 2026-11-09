import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, waitFor, within } from "@testing-library/react";
import type { FactsheetPayload } from "@/lib/factsheet/types";
import { FactsheetView } from "./FactsheetView";
import { censusPayloadA, censusPayloadB } from "./test-fixtures/census-payloads";

/**
 * Phase 196 plan 16 (LEAN-02) — every item the HEAD tear sheet printed has a home on the
 * strategy's one page, and this file names each one.
 *
 * WHY this file exists: when the tear sheet became the factsheet's print view (D-03, plan 13),
 * the items it printed outside the opening view had to live somewhere on the factsheet, and no
 * founder decision removed any of them. Without a test that names each item, a later layout
 * change could drop one with no decision behind it and every other suite would stay green. One
 * `it` per item below, in the order of the verified home table in `196-13-SUMMARY.md`; each
 * asserts the item renders in its named home on a real FactsheetView (document layout), with the
 * label read from the code, not from the plan.
 *
 * Items the tear sheet keeps for itself (the manager identity panel, the contact box, the one
 * Risk Disclosure) and the "Institutional Tear Sheet" eyebrow (a label, not a figure; no home by
 * decision, recorded in 196-13) are not factsheet homes and are not in this file.
 *
 * The benchmark: the HEAD tear sheet printed "BTC" when none was declared, which states a value
 * nobody declared. Terms carries a declared value only; the last two arms pin that.
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

/** Fixture A (two years, comparator on) with every optional tear sheet item declared. */
function full(over: Partial<FactsheetPayload> = {}): FactsheetPayload {
  return {
    ...censusPayloadA(),
    benchmark: "SPX",
    startDate: "2024-06-01",
    leverageRange: "2x",
    aum: 4_200_000,
    maxCapacity: 9_000_000,
    peerRanks: { categorySlug: "momentum", percentiles: ENTRY },
    tradesFetchedAt: "2026-04-29T07:00:00Z",
    tradeFetchVenue: "okx",
    unrecoveredGaps: [{ from: "2026-01-05", to: "2026-01-07" }],
    reconstructedRanges: [{ from: "2025-07-01", to: "2025-08-01", source: "okx_bills_history_archive" }],
    ...over,
  } as FactsheetPayload;
}

function mountClosed(payload: FactsheetPayload = full()) {
  return render(<FactsheetView payload={payload} showAum />);
}

async function mountOpen(payload: FactsheetPayload = full()) {
  const view = mountClosed(payload);
  const details = view.container.querySelector<HTMLDetailsElement>("details#factsheet-advanced");
  expect(details, "details#factsheet-advanced did not render").not.toBeNull();
  fireEvent.click(details!.querySelector("summary")!);
  await waitFor(
    () => {
      if (!view.container.textContent?.includes("Monthly Returns")) throw new Error("heatmaps not mounted yet");
    },
    { timeout: 10_000 },
  );
  return { ...view, advanced: details!.querySelector<HTMLElement>("[data-advanced-contents]")! };
}

/** The KPI strip's label cells, in order. */
function stripLabels(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('[data-testid="factsheet-kpi-label"]')).map((l) => l.textContent ?? "");
}

/** The Main metrics table (the opening view's right column). */
function mainMetrics(container: HTMLElement): HTMLElement {
  const el = container.querySelector<HTMLElement>('[data-census-section="main-metrics"]');
  expect(el, "the Main metrics section did not render").not.toBeNull();
  return el!;
}

/** The value cell that follows a `dt` label inside `root`. */
function termValue(root: HTMLElement, label: string): string | null {
  const dt = Array.from(root.querySelectorAll("dt")).find((d) => d.textContent?.trim() === label);
  return dt?.nextElementSibling?.textContent ?? null;
}

function headerLines(container: HTMLElement): string[] {
  return Array.from(container.querySelector("header")?.querySelectorAll("p") ?? []).map((p) => p.textContent ?? "");
}

describe("hero grid: CAGR, Sharpe, Sortino, Max DD -> the KPI strip", () => {
  it("CAGR", () => {
    expect(stripLabels(mountClosed().container)).toContain("CAGR");
  });
  it("Sharpe", () => {
    expect(stripLabels(mountClosed().container)).toContain("Sharpe");
  });
  it("Sortino", () => {
    expect(stripLabels(mountClosed().container)).toContain("Sortino");
  });
  it("Max DD", () => {
    expect(stripLabels(mountClosed().container)).toContain("Max DD");
  });
});

describe("detail grid: Volatility, Calmar, Cumulative -> the KPI strip (Ann. Vol, Calmar, Cum. Return)", () => {
  it("Volatility is the strip's Ann. Vol", () => {
    expect(stripLabels(mountClosed().container)).toContain("Ann. Vol");
  });
  it("Calmar", () => {
    expect(stripLabels(mountClosed().container)).toContain("Calmar");
  });
  it("Cumulative is the strip's Cum. Return", () => {
    expect(stripLabels(mountClosed().container)).toContain("Cum. Return");
  });
});

describe("6 Month, VaR 95%, CVaR 95% and the VaR method line -> the Main metrics table", () => {
  it("6 Month", () => {
    const { container } = mountClosed();
    expect(within(mainMetrics(container)).getByText("6 Month")).toBeInTheDocument();
  });
  it("VaR 95%", () => {
    const { container } = mountClosed();
    expect(within(mainMetrics(container)).getByText("VaR 95%")).toBeInTheDocument();
  });
  it("CVaR 95%", () => {
    const { container } = mountClosed();
    expect(within(mainMetrics(container)).getByText("CVaR 95%")).toBeInTheDocument();
  });
  it("the VaR method line", () => {
    const { container } = mountClosed();
    expect(within(mainMetrics(container)).getByTestId("var-method-line").textContent?.length).toBeGreaterThan(0);
  });
});

describe("the rest of the opening view", () => {
  it("the figure-gate note under the hero grid -> the KPI strip's note (a record under a year)", () => {
    const { container } = mountClosed(censusPayloadB());
    expect(container.querySelector('[data-testid="strip-figure-gate-note"]')).not.toBeNull();
  });
  it("the equity curve -> the equity figure of the opening view", () => {
    const { container } = mountClosed();
    const equity = container.querySelector('[data-census-section="equity"]');
    expect(equity, "the equity figure did not render").not.toBeNull();
    expect(equity!.querySelectorAll("figure").length).toBeGreaterThanOrEqual(1);
  });
  it("Allocation Terms: AUM (gated) -> the masthead AUM chip", () => {
    const { container } = mountClosed();
    const header = container.querySelector("header")!;
    expect(header.textContent).toContain("AUM");
    expect(header.textContent).toContain("$4M");
  });
  it("Allocation Terms: Leverage -> the masthead chip line", () => {
    const { container } = mountClosed();
    expect(container.querySelector("header")!.textContent).toContain("leverage 2x");
  });
  it("the types and markets line -> the masthead chip line", () => {
    const { container } = mountClosed();
    const header = container.querySelector("header")!.textContent ?? "";
    expect(header).toContain("Quantitative");
    expect(header).toContain("crypto");
  });
  it("the returns-unit chip -> the masthead ReturnsUnitChip", () => {
    const { container } = mountClosed(full({ returnsUnit: "BTC" } as Partial<FactsheetPayload>));
    expect(container.querySelector('header [data-returns-unit="BTC"]')).not.toBeNull();
  });
  it("the freshness pill -> the masthead FreshnessChip", () => {
    const { container } = mountClosed();
    expect(container.querySelector("header")!.textContent).toMatch(/Computed|Track record/);
  });
  it("the trade-fetch line -> the masthead", () => {
    const { container } = mountClosed();
    expect(headerLines(container).some((t) => /trades? fetch|fetched/i.test(t))).toBe(true);
  });
  it("the gap lines -> the masthead", () => {
    const { container } = mountClosed();
    expect(headerLines(container).some((t) => /^No trade data /.test(t))).toBe(true);
  });
  it("the reconstructed ranges -> the masthead", () => {
    const { container } = mountClosed();
    expect(headerLines(container).some((t) => /rebuilt from OKX's quarterly account statement/.test(t))).toBe(true);
  });
  it("the Generated date -> the footer stamp", () => {
    const payload = full();
    const { container } = mountClosed(payload);
    const footer = container.querySelector("footer");
    expect(footer, "the footer did not render").not.toBeNull();
    expect(footer!.textContent).toContain(`QSF · ${payload.strategyId.slice(0, 8).toUpperCase()}`);
  });
});

describe("inside Advanced", () => {
  it("Best Day, Worst Day -> the Best / Worst Period panel, Day row, in the Detailed metrics rail", async () => {
    const { advanced } = await mountOpen();
    const panel = within(advanced).getByText("Best / Worst Period").closest("section") ?? advanced;
    expect(within(panel as HTMLElement).getByText("Day")).toBeInTheDocument();
  });
  it("Monthly Returns table -> the Heatmaps section", async () => {
    const { advanced } = await mountOpen();
    const heatmaps = advanced.querySelector("#factsheet-heatmaps");
    expect(heatmaps, "the Heatmaps section did not mount").not.toBeNull();
    expect(heatmaps!.textContent).toContain("Monthly Returns");
  });
  it("Peer-relative ranks (five badges) -> the end of the Detailed metrics rail", async () => {
    const { advanced } = await mountOpen();
    const section = within(advanced).getByText("Peer-relative ranks").closest("section") as HTMLElement;
    expect(within(section).getAllByTestId("percentile-rank-badge")).toHaveLength(5);
  });
  it("Allocation Terms: Benchmark (declared) -> a Benchmark row in Terms", async () => {
    const { advanced } = await mountOpen();
    expect(termValue(advanced, "Benchmark")).toBe("SPX");
  });
  it('"Live since" start date -> a Live since row in Terms', async () => {
    const { advanced } = await mountOpen();
    expect(termValue(advanced, "Live since")).toContain("2024-06-01");
  });
  it("the Generated date -> the Terms Factsheet computed row", async () => {
    const { advanced } = await mountOpen();
    expect(termValue(advanced, "Factsheet computed")).not.toBeNull();
  });
});

describe("the declared benchmark (no invented BTC default)", () => {
  it("a declared benchmark shows as a Benchmark row reading that value, inside Advanced", async () => {
    const { advanced, container } = await mountOpen(full({ benchmark: "ETH-USD" } as Partial<FactsheetPayload>));
    expect(termValue(advanced, "Benchmark")).toBe("ETH-USD");
    // Terms sits inside Advanced's contents, never in the opening view.
    const openingView = container.querySelector('[data-census-section="main-metrics"]')!;
    expect(termValue(openingView as HTMLElement, "Benchmark")).toBeNull();
  });
  it("an undeclared benchmark shows no Benchmark row and prints no BTC in Terms", async () => {
    const { advanced } = await mountOpen(full({ benchmark: null } as Partial<FactsheetPayload>));
    // Positive control: Terms rendered, so the absence below is not vacuous.
    expect(termValue(advanced, "Data source")).not.toBeNull();
    expect(termValue(advanced, "Benchmark")).toBeNull();
    const dts = Array.from(advanced.querySelectorAll("dt")).map((d) => d.textContent?.trim());
    expect(dts).not.toContain("Benchmark");
    const dataSource = Array.from(advanced.querySelectorAll("dt")).find((d) => d.textContent?.trim() === "Data source")!;
    const terms = dataSource.closest("section") as HTMLElement;
    expect(terms.textContent, "the Terms section was not found").toContain("Terms");
    expect(terms.textContent).not.toMatch(/BTC/);
  });
});
