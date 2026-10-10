import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, within, act } from "@testing-library/react";
import type { DailyPoint } from "@/lib/portfolio-math-utils";
import type { FactsheetPayload, FactsheetUsdView } from "@/lib/factsheet/types";
import { buildScenarioFactsheetPayload } from "@/app/(dashboard)/allocations/widgets/performance/scenario-factsheet-payload";
import { FactsheetView } from "./FactsheetView";

/**
 * Phase 164.6.6.2.1 plan 13 (D-01, D-06, D-18, D-19, D-21, D-22) — the factsheet's
 * BTC/USD unit toggle.
 *
 * The browser only SELECTS between two server-built payloads (T-33): nothing here
 * converts a number. The USD payload is a hand-built fixture whose headline
 * scalars are distinct hand values, so a test that reads the wrong payload fails
 * on the value, not on a coincidence.
 */

vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

// Plan 14: a probe on the frozen provider's own range API, so the x-range reset on
// a view switch is read from the real state rather than inferred from the chart.
// Every call goes through to the real `useXRange`; nothing is stubbed.
const xr = vi.hoisted(() => ({
  current: null as null | {
    xRange: readonly [number, number];
    setXRange: (next: readonly [number, number]) => void;
    resetXRange: () => void;
  },
}));
vi.mock("./factsheet-context", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./factsheet-context")>();
  return {
    ...actual,
    useXRange: () => {
      const v = actual.useXRange();
      xr.current = v;
      return v;
    },
  };
});

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
// Installed PER TEST: `vitest.config.ts` sets `unstubGlobals: true` (DEF-16-1).
beforeEach(() => {
  lsStore.clear();
  vi.clearAllMocks();
  vi.stubGlobal("localStorage", localStorageMock);
});
Object.defineProperty(window, "localStorage", {
  value: localStorageMock,
  configurable: true,
});

function makeReturnsSeries(n: number, startDay = 1, drift = 0.0015): DailyPoint[] {
  const pts: DailyPoint[] = [];
  const d = new Date(Date.UTC(2023, 0, startDay));
  for (let i = 0; i < n; i++) {
    pts.push({
      date: d.toISOString().slice(0, 10),
      value: drift + Math.sin(i * 0.27) * 0.005,
    });
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return pts;
}

// Native record: 300 days from 2023-01-01, last day 2023-10-27.
const NATIVE_END = "Oct 27, 2023";
const NATIVE_BASE: FactsheetPayload = buildScenarioFactsheetPayload({
  portfolioDaily: makeReturnsSeries(300),
  benchmark: null,
});
// USD record: one day shorter at BOTH ends, so the masthead dates cannot be
// confused between the two payloads (first 2023-01-02, last 2023-10-26).
const USD_BASE: FactsheetPayload = buildScenarioFactsheetPayload({
  portfolioDaily: makeReturnsSeries(298, 2),
  benchmark: null,
});

// Hand values, distinct per payload: +11.1% native, +43.2% in USD.
const NATIVE_CAGR = "+11.1%";
const USD_CAGR = "+43.2%";

function usdViewOf(over: Partial<FactsheetUsdView> = {}, payloadOver: Partial<FactsheetPayload> = {}): FactsheetUsdView {
  return {
    payload: {
      ...USD_BASE,
      returnsUnit: "USD",
      convertedFrom: "BTC",
      strategyMetrics: { ...USD_BASE.strategyMetrics, cagr: 0.432, cum_ret: 0.9 },
      ...payloadOver,
    } as FactsheetPayload,
    convertedFrom: "BTC",
    usdStart: "2023-01-02",
    usdEnd: "2023-10-26",
    leadingHole: false,
    unpricedDays: [],
    removedReturns: 0,
    ...over,
  };
}

/** A native BTC factsheet that carries a USD view. */
function nativeWithUsd(
  view: FactsheetUsdView = usdViewOf(),
  over: Partial<FactsheetPayload> = {},
): FactsheetPayload {
  return {
    ...NATIVE_BASE,
    returnsUnit: "BTC",
    strategyMetrics: { ...NATIVE_BASE.strategyMetrics, cagr: 0.111, cum_ret: 0.5 },
    usdView: view,
    ...over,
  } as FactsheetPayload;
}

function nativeWithoutUsd(reason: "price_read_failed" | "no_priced_day" | undefined, over: Partial<FactsheetPayload> = {}): FactsheetPayload {
  return {
    ...NATIVE_BASE,
    returnsUnit: "BTC",
    ...(reason ? { usdViewUnavailable: reason } : {}),
    ...over,
  } as FactsheetPayload;
}

/** A USD-family payload: no `returnsUnit` key, as the server emits it. */
function usdFamily(): FactsheetPayload {
  return { ...NATIVE_BASE } as FactsheetPayload;
}

function renderView(payload: FactsheetPayload) {
  return render(<FactsheetView payload={payload} />);
}

function kpiLabel(container: HTMLElement, text: string): HTMLElement | undefined {
  return Array.from(container.querySelectorAll<HTMLElement>('[data-testid="factsheet-kpi-label"]')).find(
    (el) => el.textContent === text,
  );
}
/** The value cell of the KPI label with this text. */
function kpiValue(container: HTMLElement, label: string): string | undefined {
  const l = kpiLabel(container, label);
  return (l?.parentElement?.querySelector('[data-testid="factsheet-kpi-value"]') as HTMLElement | null)?.textContent ?? undefined;
}
function toggle(container: HTMLElement): HTMLElement | null {
  return container.querySelector('[data-testid="factsheet-unit-toggle"]');
}
function unitButton(container: HTMLElement, name: "BTC" | "USD"): HTMLButtonElement {
  const t = toggle(container)!;
  return within(t).getByRole("button", { name }) as HTMLButtonElement;
}
function statusRegion(container: HTMLElement): HTMLElement {
  return toggle(container)!.querySelector('[role="status"]') as HTMLElement;
}

describe("D-01 — the Units toggle (tracer)", () => {
  it("is the ControlBar's first child, BTC first, BTC pressed on mount", () => {
    const { container } = renderView(nativeWithUsd());
    const t = toggle(container);
    expect(t, "the unit toggle did not render").not.toBeNull();
    const bar = t!.parentElement as HTMLElement;
    expect(bar.tagName).toBe("SECTION");
    expect(bar.className).toContain("factsheet-v2-no-print");
    expect(bar.firstElementChild).toBe(t);
    expect(t!.textContent).toContain("Units");
    const group = within(t!).getByRole("group", { name: "Units" });
    const labels = Array.from(group.querySelectorAll("button")).map((b) => b.textContent);
    expect(labels).toEqual(["BTC", "USD"]);
    expect(unitButton(container, "BTC").getAttribute("aria-pressed")).toBe("true");
    expect(unitButton(container, "USD").getAttribute("aria-pressed")).toBe("false");
    expect(kpiLabel(container, "CAGR in BTC")).toBeDefined();
    expect(kpiValue(container, "CAGR in BTC")).toBe(NATIVE_CAGR);
  });

  it("takes the segment label from returnsUnit, never a literal (ETH)", () => {
    const { container } = renderView(nativeWithUsd(usdViewOf(), { returnsUnit: "ETH" }));
    const group = within(toggle(container)!).getByRole("group", { name: "Units" });
    expect(Array.from(group.querySelectorAll("button")).map((b) => b.textContent)).toEqual(["ETH", "USD"]);
  });

  it("USD swaps the payload the strip reads, keeps focus on USD, announces the switch, persists nothing", () => {
    const { container } = renderView(nativeWithUsd());
    expect(statusRegion(container).textContent).toBe("");
    const usd = unitButton(container, "USD");
    usd.focus();
    fireEvent.click(usd);

    expect(kpiLabel(container, "CAGR in USD")).toBeDefined();
    expect(kpiLabel(container, "CAGR in BTC")).toBeUndefined();
    expect(kpiValue(container, "CAGR in USD")).toBe(USD_CAGR);
    // The ControlBar did not remount: the SAME button node still holds focus.
    expect(unitButton(container, "USD")).toBe(usd);
    expect(document.activeElement).toBe(usd);
    expect(usd.getAttribute("aria-pressed")).toBe("true");
    expect(statusRegion(container).textContent).toBe("Showing figures in USD.");

    fireEvent.click(unitButton(container, "BTC"));
    expect(statusRegion(container).textContent).toBe("Showing figures in BTC.");
    expect(kpiValue(container, "CAGR in BTC")).toBe(NATIVE_CAGR);
    // UI-SPEC rule 2: the view lives in component state only.
    expect(localStorageMock.setItem).not.toHaveBeenCalled();
    expect(window.location.search).toBe("");
    expect(document.cookie).toBe("");
  });

  it("a USD-family factsheet renders no toggle and no disclosure", () => {
    const { container } = renderView(usdFamily());
    expect(toggle(container)).toBeNull();
    expect(container.querySelector('[data-testid="factsheet-usd-disclosure"]')).toBeNull();
    expect(container.querySelector('[role="status"].sr-only')).toBeNull();
  });
});

// ─── Task 2 — masthead native, disclosure, unpriced note, disabled reasons ─────

const DISCLOSURE_TAIL = "Shown in USD, converted from BTC at the stored daily BTC close.";
const UNPRICED_TAIL = "left out, so every USD figure here is computed over priced days only.";

function disclosure(container: HTMLElement): HTMLElement | null {
  return container.querySelector('[data-testid="factsheet-usd-disclosure"]');
}
function unpricedNote(container: HTMLElement): HTMLElement | null {
  return container.querySelector('[data-testid="factsheet-usd-unpriced-note"]');
}
function switchToUsd(container: HTMLElement) {
  fireEvent.click(unitButton(container, "USD"));
}
function header(container: HTMLElement): HTMLElement {
  return container.querySelector("header") as HTMLElement;
}
/** The masthead's markup with the (USD-only) disclosure block removed. */
function mastheadWithoutDisclosure(container: HTMLElement): string {
  const clone = header(container).cloneNode(true) as HTMLElement;
  clone.querySelector('[data-testid="factsheet-usd-disclosure"]')?.remove();
  return clone.innerHTML;
}

const AUM = { aum: 2_000_000, maxCapacity: 10_000_000 };

describe("D-19 — the masthead stays native in both views", () => {
  function withAum() {
    // The USD payload carries the declared USD aum as well, so a chip reading the
    // wrong payload would print `$2M` rather than the honest dash.
    const view = usdViewOf({}, AUM);
    return nativeWithUsd(view, AUM);
  }

  it("the whole masthead is unchanged by a switch to USD (chip, dating, freshness, capacity)", () => {
    const { container } = renderView(withAum());
    const before = mastheadWithoutDisclosure(container);
    switchToUsd(container);
    expect(mastheadWithoutDisclosure(container)).toBe(before);
  });

  it("USD view: Returns in BTC chip, Track record through the NATIVE end, AUM dash", () => {
    const { container } = renderView(withAum());
    switchToUsd(container);
    const h = header(container);
    expect(h.querySelector('[data-returns-unit="BTC"]')?.textContent).toBe("Returns in BTC");
    expect(h.textContent).toContain(`Track record through ${NATIVE_END}`);
    // The USD record ends a day earlier; that date must not reach the recency line.
    expect(h.textContent).not.toContain("Track record through Oct 26, 2023");
    const aum = Array.from(h.querySelectorAll("p")).find((p) => (p.textContent ?? "").startsWith("AUM"))!.parentElement as HTMLElement;
    expect(aum.querySelectorAll("p")[1].textContent).toBe("—");
    expect(aum.textContent).not.toContain("$");
  });
});

describe("D-21 / D-22 — the USD disclosure block", () => {
  it("the native view renders no disclosure", () => {
    const { container } = renderView(nativeWithUsd());
    expect(disclosure(container)).toBeNull();
    expect(unpricedNote(container)).toBeNull();
  });

  it("USD view: Priced through {usdEnd}, as the LAST child of <header>", () => {
    const { container } = renderView(nativeWithUsd());
    switchToUsd(container);
    const d = disclosure(container)!;
    expect(d).not.toBeNull();
    expect(header(container).lastElementChild).toBe(d);
    expect(d.className).toContain("mt-4");
    expect(d.firstElementChild!.className).toContain("text-caption");
    expect(d.firstElementChild!.className).toContain("text-text-muted");
    expect(d.firstElementChild!.textContent).toBe(`${DISCLOSURE_TAIL} Priced through Oct 26, 2023.`);
    expect(unpricedNote(container)).toBeNull();
  });

  it("a leading hole reads Priced from {usdStart} through {usdEnd}", () => {
    const { container } = renderView(nativeWithUsd(usdViewOf({ leadingHole: true, usdStart: "2023-01-05" })));
    switchToUsd(container);
    expect(disclosure(container)!.firstElementChild!.textContent).toBe(
      "Shown in USD, converted from BTC at the stored daily BTC close. Priced from Jan 5, 2023 through Oct 26, 2023.",
    );
  });

  it("switching back to the native unit removes the disclosure", () => {
    const { container } = renderView(nativeWithUsd());
    switchToUsd(container);
    fireEvent.click(unitButton(container, "BTC"));
    expect(disclosure(container)).toBeNull();
  });

  it("no rendered text names a quote pair (D-21)", () => {
    const { container } = renderView(nativeWithUsd(usdViewOf({ unpricedDays: ["2026-10-03"], removedReturns: 2 })));
    expect(container.textContent).not.toMatch(/BTC\/USDT/);
    switchToUsd(container);
    expect(container.textContent).not.toMatch(/BTC\/USDT/);
  });
});

describe("D-06 — the unpriced-days note", () => {
  function noteFor(unpricedDays: string[], removedReturns: number): string {
    const { container } = renderView(nativeWithUsd(usdViewOf({ unpricedDays, removedReturns })));
    switchToUsd(container);
    const n = unpricedNote(container)!;
    expect(n, "no unpriced note rendered").not.toBeNull();
    expect(n.className).toContain("text-caption");
    expect(n.className).toContain("text-text-muted");
    // The note is the second line of the disclosure block.
    expect(disclosure(container)!.lastElementChild).toBe(n);
    return n.textContent ?? "";
  }

  it("worked example 1: a native day followed by a native day (m=1, k=2)", () => {
    expect(noteFor(["2026-10-03"], 2)).toBe(
      `No BTC close for 1 day: Oct 3, 2026. 2 daily USD returns that need that close are ${UNPRICED_TAIL}`,
    );
  });

  it("worked example 2: an unpriced day between two native days (m=1, k=1)", () => {
    expect(noteFor(["2026-10-04"], 1)).toBe(
      `No BTC close for 1 day: Oct 4, 2026. 1 daily USD return that needs that close is ${UNPRICED_TAIL}`,
    );
  });

  it("plural forms: m=2 days, k=3 returns", () => {
    expect(noteFor(["2026-10-03", "2026-10-05"], 3)).toBe(
      `No BTC close for 2 days: Oct 3, 2026; Oct 5, 2026. 3 daily USD returns that need those closes are ${UNPRICED_TAIL}`,
    );
  });

  it("m=2 days with k=1: those closes, singular return", () => {
    expect(noteFor(["2026-10-03", "2026-10-04"], 1)).toBe(
      `No BTC close for 2 days: Oct 3, 2026 – Oct 4, 2026. 1 daily USD return that needs those closes is ${UNPRICED_TAIL}`,
    );
  });

  it("lists every run and truncates none (print survives)", () => {
    const days = ["2026-01-02", "2026-02-02", "2026-03-02", "2026-04-02", "2026-05-02", "2026-06-02"];
    const text = noteFor(days, 6);
    expect(text).toContain("No BTC close for 6 days:");
    for (const d of ["Jan 2, 2026", "Feb 2, 2026", "Mar 2, 2026", "Apr 2, 2026", "May 2, 2026", "Jun 2, 2026"]) {
      expect(text).toContain(d);
    }
    expect(text).not.toContain("…");
  });
});

describe("D-22 — a native strategy without a USD view says why", () => {
  it("price_read_failed: USD is aria-disabled, with the amber visible line and the same title", () => {
    const { container } = renderView(nativeWithoutUsd("price_read_failed"));
    const usd = unitButton(container, "USD");
    const copy = "No USD view: the daily BTC closes could not be read. It is retried within the hour.";
    expect(usd.getAttribute("aria-disabled")).toBe("true");
    expect(usd.getAttribute("title")).toBe(copy);
    const line = within(toggle(container)!).getByText(copy);
    expect(line.tagName).toBe("P");
    expect(line.className).toContain("text-caption");
    expect(line.className).toContain("text-warning");
    // A click on a disabled segment does nothing: still native, nothing announced.
    fireEvent.click(usd);
    expect(unitButton(container, "BTC").getAttribute("aria-pressed")).toBe("true");
    expect(statusRegion(container).textContent).toBe("");
    expect(disclosure(container)).toBeNull();
  });

  it("no_priced_day: USD is aria-disabled, with the muted visible line", () => {
    const { container } = renderView(nativeWithoutUsd("no_priced_day"));
    const copy = "No USD view: no day in this record has a stored BTC close.";
    expect(unitButton(container, "USD").getAttribute("aria-disabled")).toBe("true");
    expect(unitButton(container, "USD").getAttribute("title")).toBe(copy);
    const line = within(toggle(container)!).getByText(copy);
    expect(line.className).toContain("text-text-muted");
    expect(line.className).not.toContain("text-warning");
  });

  it("USD is disabled and no reason line renders when the server gave none", () => {
    const { container } = renderView(nativeWithoutUsd(undefined));
    expect(unitButton(container, "USD").getAttribute("aria-disabled")).toBe("true");
    expect(toggle(container)!.querySelectorAll("p").length).toBe(0);
  });

  it("a native factsheet WITH a USD view renders no reason line", () => {
    const { container } = renderView(nativeWithUsd());
    expect(toggle(container)!.querySelectorAll("p").length).toBe(0);
    expect(unitButton(container, "USD").getAttribute("aria-disabled")).toBeNull();
  });
});

// ─── Plan 14 — leverage and basis in the USD view (D-16, UI-SPEC A) ────────────

const LEVERAGE_REASON = "Leverage is off in the USD view: it would also lever BTC.";
const BASIS_REASON = "Shown in BTC only. Switch Units to BTC to see this basis.";

// Short records: dialing leverage re-derives the whole bundle per consumer, so the
// fixtures that dial are kept small (the Phase 107 leverage suites do the same).
const SHORT_NATIVE: FactsheetPayload = buildScenarioFactsheetPayload({
  portfolioDaily: makeReturnsSeries(60),
  benchmark: null,
});
const SHORT_USD: FactsheetPayload = buildScenarioFactsheetPayload({
  portfolioDaily: makeReturnsSeries(58, 2),
  benchmark: null,
});
function shortWithUsd(over: Partial<FactsheetPayload> = {}): FactsheetPayload {
  return {
    ...SHORT_NATIVE,
    returnsUnit: "BTC",
    usdView: usdViewOf(
      {},
      { ...SHORT_USD, returnsUnit: "USD", convertedFrom: "BTC", strategyMetrics: { ...SHORT_USD.strategyMetrics, cagr: 0.432 } } as Partial<FactsheetPayload>,
    ),
    ...over,
  } as FactsheetPayload;
}

const levInput = (c: HTMLElement) => c.querySelector<HTMLInputElement>("#leverage-factsheet");
function setLeverage(c: HTMLElement, value: string) {
  fireEvent.change(levInput(c)!, { target: { value } });
}
function cagrText(c: HTMLElement): string | undefined {
  return kpiValue(c, "CAGR in BTC") ?? kpiValue(c, "CAGR in USD");
}
function resetButton(c: HTMLElement): HTMLElement | null {
  return Array.from(c.querySelectorAll<HTMLElement>("button")).find((b) => b.textContent === "Reset 1×") ?? null;
}
function basisGroup(c: HTMLElement): HTMLElement {
  return within(c).getByRole("group", { name: "Metrics basis" });
}
function basisButton(c: HTMLElement, name: string): HTMLButtonElement {
  return within(basisGroup(c)).getByRole("button", { name }) as HTMLButtonElement;
}

describe("D-16 — leverage in the USD view", () => {
  it("the input stays in the DOM, aria-disabled, readOnly, showing 1, still a tab stop; no Reset 1×; the reason is visible", () => {
    const { container } = renderView(shortWithUsd());
    setLeverage(container, "2");
    expect(resetButton(container), "native 2x should offer Reset 1×").not.toBeNull();
    switchToUsd(container);

    const input = levInput(container);
    expect(input, "the leverage input left the DOM in the USD view").not.toBeNull();
    expect(input!.getAttribute("aria-disabled")).toBe("true");
    expect(input!.readOnly).toBe(true);
    expect(input!.value).toBe("1");
    // A disabled field leaves the tab order; aria-disabled + readOnly keeps it.
    expect(input!.disabled).toBe(false);
    expect(input!.tabIndex).toBeGreaterThanOrEqual(0);
    expect(input!.className).toContain("opacity-60");
    expect(input!.className).toContain("cursor-not-allowed");
    expect(resetButton(container)).toBeNull();

    const reason = within(container).getByText(LEVERAGE_REASON);
    expect(reason.tagName).toBe("P");
    expect(reason.className).toContain("text-caption");
    expect(reason.className).toContain("text-text-muted");
  });

  it("the native view carries no aria-disabled, no readOnly and no reason line", () => {
    const { container } = renderView(shortWithUsd());
    const input = levInput(container)!;
    expect(input.getAttribute("aria-disabled")).toBeNull();
    expect(input.readOnly).toBe(false);
    expect(input.className).not.toContain("cursor-not-allowed");
    expect(container.textContent).not.toContain(LEVERAGE_REASON);
  });

  it("clears a leverage message on entering the USD view", () => {
    const { container } = renderView(shortWithUsd());
    setLeverage(container, "99");
    expect(container.textContent).toContain("Leverage clamped to 10×");
    switchToUsd(container);
    expect(container.textContent).not.toContain("Leverage clamped to 10×");
  });

  it("a change event on the read-only USD input does nothing, and the native multiplier survives it", () => {
    const { container } = renderView(shortWithUsd());
    setLeverage(container, "2");
    switchToUsd(container);
    setLeverage(container, "3");
    expect(levInput(container)!.value).toBe("1");
    fireEvent.click(unitButton(container, "BTC"));
    expect(levInput(container)!.value).toBe("2");
  });

  it("the USD figures are the 1x USD payload figures even with 2x dialed in BTC, and 2x returns on the way back", () => {
    const { container } = renderView(shortWithUsd());
    switchToUsd(container);
    const usdAtOne = cagrText(container);
    expect(usdAtOne).toBe(USD_CAGR);
    fireEvent.click(unitButton(container, "BTC"));
    const nativeAtOne = cagrText(container);

    setLeverage(container, "2");
    const nativeAtTwo = cagrText(container);
    expect(nativeAtTwo, "2x should move the native CAGR").not.toBe(nativeAtOne);

    switchToUsd(container);
    expect(cagrText(container)).toBe(usdAtOne);
    expect(kpiLabel(container, "CAGR in USD")).toBeDefined();

    fireEvent.click(unitButton(container, "BTC"));
    expect(levInput(container)!.value).toBe("2");
    expect(cagrText(container)).toBe(nativeAtTwo);
    expect(resetButton(container)).not.toBeNull();
  });

  it("a payload with no leverage control renders none in either view", () => {
    // Composite books are leverage-ineligible; the USD view must not invent a control.
    const { container } = renderView(shortWithUsd({ dataQuality: { composite: true } } as Partial<FactsheetPayload>));
    expect(levInput(container)).toBeNull();
    switchToUsd(container);
    expect(levInput(container)).toBeNull();
    expect(container.textContent).not.toContain(LEVERAGE_REASON);
  });
});

describe("UI-SPEC A (switch effect 5) — the basis control in the USD view", () => {
  // The USD payload is built without `metricsByBasis` and without a gate, so the
  // control has to be judged on the NATIVE payload or it would vanish on the switch.
  const withMtm = () =>
    shortWithUsd({
      mtmGate: { available: true },
      metricsByBasis: {
        cash_settlement: { cagr: 0.111 },
        mark_to_market: { cumulative_return: 0.5, volatility: 0.11, max_drawdown: -0.038, cagr: 0.26, sharpe: 1.2, sortino: 1.9, calmar: 2.7 },
      },
    } as unknown as Partial<FactsheetPayload>);

  it("the control survives the switch; Cash stays enabled and pressed; Mark-to-market is aria-disabled with the reason", () => {
    const { container } = renderView(withMtm());
    expect(basisButton(container, "Mark-to-market").getAttribute("aria-disabled")).toBeNull();
    switchToUsd(container);

    const cash = basisButton(container, "Cash settlement");
    expect(cash.getAttribute("aria-disabled")).toBeNull();
    expect(cash.getAttribute("aria-pressed")).toBe("true");
    const mtm = basisButton(container, "Mark-to-market");
    expect(mtm.getAttribute("aria-disabled")).toBe("true");
    expect(mtm.getAttribute("title")).toBe(BASIS_REASON);
    // No fact lives only in a tooltip.
    const line = within(basisGroup(container).parentElement as HTMLElement).getByText(BASIS_REASON);
    expect(line.tagName).toBe("P");
    expect(line.className).toContain("text-caption");
    expect(line.className).toContain("text-text-muted");
  });

  it("a click on a disabled basis segment changes nothing", () => {
    const { container } = renderView(withMtm());
    switchToUsd(container);
    fireEvent.click(basisButton(container, "Mark-to-market"));
    expect(basisButton(container, "Cash settlement").getAttribute("aria-pressed")).toBe("true");
  });

  it("switching to USD from Mark-to-market sets cash first", () => {
    const { container } = renderView(withMtm());
    fireEvent.click(basisButton(container, "Mark-to-market"));
    expect(basisButton(container, "Mark-to-market").getAttribute("aria-pressed")).toBe("true");
    switchToUsd(container);
    expect(basisButton(container, "Cash settlement").getAttribute("aria-pressed")).toBe("true");
    expect(basisButton(container, "Mark-to-market").getAttribute("aria-disabled")).toBe("true");
    expect(kpiLabel(container, "CAGR in USD")).toBeDefined();
  });

  it("back in the native unit the segment is enabled again and the reason is gone", () => {
    const { container } = renderView(withMtm());
    switchToUsd(container);
    fireEvent.click(unitButton(container, "BTC"));
    expect(basisButton(container, "Mark-to-market").getAttribute("aria-disabled")).toBeNull();
    expect(container.textContent).not.toContain(BASIS_REASON);
  });

  it("a payload with no basis control renders none in the USD view either", () => {
    const { container } = renderView(shortWithUsd());
    switchToUsd(container);
    expect(within(container).queryByRole("group", { name: "Metrics basis" })).toBeNull();
    expect(container.textContent).not.toContain(BASIS_REASON);
  });
});

describe("UI-SPEC A (switch effect 2) — a switch resets the visible x-range", () => {
  function zoomed(): readonly [number, number] {
    act(() => xr.current!.setXRange([10, 40]));
    return xr.current!.xRange;
  }

  it("native to USD returns the window to the USD record's full range", () => {
    const { container } = renderView(nativeWithUsd());
    expect(zoomed()).toEqual([10, 40]);
    switchToUsd(container);
    // The USD record is 298 days: indices 0..297.
    expect(xr.current!.xRange).toEqual([0, 297]);
  });

  it("USD to native returns the window to the native record's full range", () => {
    const { container } = renderView(nativeWithUsd());
    switchToUsd(container);
    expect(zoomed()).toEqual([10, 40]);
    fireEvent.click(unitButton(container, "BTC"));
    // The native record is 300 days: indices 0..299.
    expect(xr.current!.xRange).toEqual([0, 299]);
  });

  it("a mount, with no switch, leaves a zoomed window alone", () => {
    renderView(nativeWithUsd());
    expect(zoomed()).toEqual([10, 40]);
    act(() => xr.current!.setXRange([12, 44]));
    expect(xr.current!.xRange).toEqual([12, 44]);
  });
});
