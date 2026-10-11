import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render } from "@testing-library/react";
import type { DailyPoint } from "@/lib/portfolio-math-utils";
import type { FactsheetPayload } from "@/lib/factsheet/types";
import { buildScenarioFactsheetPayload } from "@/app/(dashboard)/allocations/widgets/performance/scenario-factsheet-payload";
import { FactsheetProvider } from "./factsheet-context";
import { FactsheetBody } from "./FactsheetView";

/**
 * Phase 167.1.2.2.2 (TRADESYNC, plan 10) - the factsheet trade-fetch line
 * (D-06, D-07, D-10, UI-SPEC "Factsheet trade-fetch line", amended by F2).
 *
 * WHY these assertions matter:
 *
 *   1. THE LINE IS A PUBLIC HONESTY CLAIM. `Synced` and `Computed` both advance
 *      for an account that has not traded or fetched; the only fact that says
 *      "the exchange was last read at X" is `trades_fetched_at`. D-06 shows it
 *      to EVERYONE (an anonymous viewer of a published strategy included), and
 *      D-10 makes a disconnected published key read stale instead of silent.
 *      So no case here renders an owner-only branch: the harness is the same
 *      anonymous `FactsheetBody` render the recency-line suite uses.
 *
 *   2. EVERY COPY STRING AND DATE IS A TYPED LITERAL. The expected sentence is
 *      written out below and never produced by the component's formatter, so a
 *      copy rewrite or a date-format drift fails this file (a self-referential
 *      oracle could not).
 *
 *   3. THE VERDICT COMES FROM `resolveTradeFetch` ALONE. The day count is
 *      display. The 48 h boundary pair below separates the two: at 48 h + 1 min
 *      the display count still reads "2 days" while the verdict is already
 *      stale, so a component that re-derived staleness from the day count
 *      (`n > 2`) would render the muted current line and fail.
 *
 *   4. F2: a key-backed strategy with no stamp says `No trade fetch recorded
 *      yet`, never `Trades not yet fetched` (which asserts a fact the schema
 *      cannot establish for a strategy that has historical trades). Absence of
 *      a claim (not-applicable) is ZERO nodes, not a hidden node.
 *
 * Harness mirrors FactsheetView.recency-line.test.tsx: sentry + next/navigation
 * mocked, a per-test localStorage stub (`unstubGlobals: true` makes a
 * module-scope stub vanish), the real FactsheetProvider + FactsheetBody. `now`
 * is pinned by faking Date only, so the component's
 * `useState(() => Date.now())` initialiser reads the pinned instant.
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

const NOW = "2026-10-09T12:00:00Z";

beforeEach(() => {
  vi.stubGlobal("localStorage", localStorageMock);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(NOW));
});
afterEach(() => {
  vi.useRealTimers();
});
Object.defineProperty(window, "localStorage", {
  value: localStorageMock,
  configurable: true,
});

// ---------------------------------------------------------------------------
// Fixtures (all typed literals)
// ---------------------------------------------------------------------------

const SERIES_END = "2026-10-08";
const NEVER_COPY = "No trade fetch recorded yet";
const FUTURE_COPY = "Trade fetch time is in the future — check data";

function makeReturnsSeriesEndingOn(n: number, endIso: string, drift = 0.0015): DailyPoint[] {
  const end = new Date(`${endIso}T00:00:00Z`);
  const pts: DailyPoint[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(end);
    d.setUTCDate(d.getUTCDate() - i);
    pts.push({
      date: d.toISOString().slice(0, 10),
      value: drift + Math.sin((n - 1 - i) * 0.27) * 0.005,
    });
  }
  return pts;
}

const basePayload: FactsheetPayload = {
  ...buildScenarioFactsheetPayload({
    portfolioDaily: makeReturnsSeriesEndingOn(300, SERIES_END),
    benchmark: null,
  }),
  computedAt: "2026-10-09T03:00:00Z",
};

function withFacts(
  tradesFetchedAt: string | null,
  tradeFetchVenue: string | null,
): FactsheetPayload {
  return { ...basePayload, tradesFetchedAt, tradeFetchVenue, unrecoveredGaps: [] };
}

function renderFactsheet(payload: FactsheetPayload) {
  return render(
    <FactsheetProvider payload={payload} persist={false}>
      <FactsheetBody payload={payload} hideAllocatorSection hideFooter />
    </FactsheetProvider>,
  );
}

/** Any header paragraph whose copy is about the trade fetch (present or absent). */
function tradeFetchLine(container: HTMLElement): HTMLElement | null {
  const header = container.querySelector("header");
  if (!header) return null;
  return (
    (Array.from(header.querySelectorAll("p")).find((p) => {
      const t = p.textContent ?? "";
      return /trades? fetch|fetched/i.test(t);
    }) as HTMLElement | undefined) ?? null
  );
}

function recencyLine(container: HTMLElement): HTMLElement | null {
  const header = container.querySelector("header");
  return (
    (Array.from(header?.querySelectorAll("p") ?? []).find((p) =>
      (p.textContent ?? "").startsWith("Track record through "),
    ) as HTMLElement | undefined) ?? null
  );
}

describe("FactsheetView - TradeFetchLine (D-06, D-10, F2)", () => {
  it("current, fetched 5 h before now: less than a day, muted, for an anonymous viewer", () => {
    const { container } = renderFactsheet(withFacts("2026-10-09T07:00:00Z", "okx"));
    const line = tradeFetchLine(container);
    expect(line, "trade-fetch line did not render").not.toBeNull();
    expect(line!.textContent).toBe("Last trades fetched less than a day ago · Oct 9, 2026");
    expect(line!.className).toContain("text-text-muted");
    expect(line!.className).toContain("text-caption");
    expect(line!.className).toContain("mt-1");
    expect(line!.className).not.toContain("text-negative");
  });

  it("stale, fetched 9 days before now: the Stale sentence in the negative tone", () => {
    const { container } = renderFactsheet(withFacts("2026-09-30T12:00:00Z", "okx"));
    const line = tradeFetchLine(container);
    expect(line).not.toBeNull();
    expect(line!.textContent).toBe("Stale: last trades fetched 9 days ago · Sep 30, 2026");
    expect(line!.className).toContain("text-negative");
    expect(line!.className).not.toContain("text-text-muted");
  });

  it("D-10: a published disconnected key (venue okx, seeded stamp) reads stale, not silent", () => {
    const { container } = renderFactsheet(withFacts("2026-09-20T03:15:00Z", "okx"));
    const line = tradeFetchLine(container);
    expect(line!.textContent).toBe("Stale: last trades fetched 19 days ago · Sep 20, 2026");
    expect(line!.className).toContain("text-negative");
  });

  it("fetched exactly 1 day before now: singular `1 day`", () => {
    const { container } = renderFactsheet(withFacts("2026-10-08T12:00:00Z", "bybit"));
    expect(tradeFetchLine(container)!.textContent).toBe(
      "Last trades fetched 1 day ago · Oct 8, 2026",
    );
  });

  it("48 h exactly is still current and reads 2 days", () => {
    const { container } = renderFactsheet(withFacts("2026-10-07T12:00:00Z", "okx"));
    const line = tradeFetchLine(container);
    expect(line!.textContent).toBe("Last trades fetched 2 days ago · Oct 7, 2026");
    expect(line!.className).toContain("text-text-muted");
  });

  it("48 h + 1 min is stale while the day count still reads 2: the verdict is not re-derived from the count", () => {
    const { container } = renderFactsheet(withFacts("2026-10-07T11:59:00Z", "okx"));
    const line = tradeFetchLine(container);
    expect(line!.textContent).toBe("Stale: last trades fetched 2 days ago · Oct 7, 2026");
    expect(line!.className).toContain("text-negative");
  });

  it("F2: a key-backed strategy with no stamp says `No trade fetch recorded yet`", () => {
    const { container } = renderFactsheet(withFacts(null, "okx"));
    const line = tradeFetchLine(container);
    expect(line, "never-fetched line did not render").not.toBeNull();
    expect(line!.textContent).toBe(NEVER_COPY);
    expect(line!.className).toContain("text-text-muted");
    expect(line!.className).toContain("mt-1");
    // The rejected phrasing appears nowhere in the document.
    expect(container.textContent).not.toContain("Trades not yet fetched");
    expect(container.textContent).not.toContain("not yet fetched");
  });

  it.each([["deribit"], ["mt5"], ["csv"]])(
    "a venue the cron never fetches (%s) with no stamp renders zero trade-fetch nodes",
    (venue) => {
      const { container } = renderFactsheet(withFacts(null, venue));
      expect(tradeFetchLine(container)).toBeNull();
      expect(container.textContent).not.toMatch(/trades? fetch/i);
    },
  );

  it("null stamp with null venue (a CSV, composite or blend payload) renders zero trade-fetch nodes", () => {
    const { container } = renderFactsheet(withFacts(null, null));
    expect(tradeFetchLine(container)).toBeNull();
    expect(container.textContent).not.toMatch(/trades? fetch/i);
    expect(container.textContent).not.toContain(NEVER_COPY);
  });

  it("a stamp in the future (beyond skew tolerance) says so, with no age and no date", () => {
    const { container } = renderFactsheet(withFacts("2026-10-12T12:00:00Z", "okx"));
    const line = tradeFetchLine(container);
    expect(line!.textContent).toBe(FUTURE_COPY);
    expect(line!.className).toContain("text-text-muted");
  });

  it("an unparseable stamp makes no claim: zero nodes", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { container } = renderFactsheet(withFacts("not-an-instant", "okx"));
    expect(tradeFetchLine(container)).toBeNull();
  });

  it("placement: the next sibling after the series line, not inside the chip", () => {
    const { container } = renderFactsheet(withFacts("2026-10-09T07:00:00Z", "okx"));
    const series = recencyLine(container);
    const line = tradeFetchLine(container);
    expect(series, "series line did not render").not.toBeNull();
    expect(line).not.toBeNull();
    expect(series!.nextElementSibling).toBe(line);
    expect(line!.parentElement).toBe(series!.parentElement);
  });

  it("not hidden in print: neither the line nor an ancestor carries the no-print class", () => {
    const { container } = renderFactsheet(withFacts("2026-09-30T12:00:00Z", "okx"));
    const line = tradeFetchLine(container)!;
    expect(line.closest(".factsheet-v2-no-print")).toBeNull();
    expect(line.className).not.toContain("no-print");
    expect(line.className).not.toMatch(/\bhidden\b|print:hidden/);
  });

  it("static content: no live region, no role, no status dot", () => {
    const { container } = renderFactsheet(withFacts("2026-09-30T12:00:00Z", "okx"));
    const line = tradeFetchLine(container)!;
    expect(line.getAttribute("role")).toBeNull();
    expect(line.getAttribute("aria-live")).toBeNull();
    expect(line.querySelector("span[aria-hidden]")).toBeNull();
  });
});
