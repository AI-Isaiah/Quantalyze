import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";

import AlphaBetaDecomposition, { computeBookAlphaBeta, type AlphaBetaWidgetData } from "./AlphaBetaDecomposition";
import { buildAllocatorPortfolioFactsheetPayload } from "@/lib/factsheet/allocator-portfolio-payload";
import { jointMetrics, MIN_PAIRED_OBSERVATIONS } from "@/lib/factsheet/joint";
import { FactsheetProvider } from "@/app/factsheet/[id]/v2/factsheet-context";
import { FactsheetBody } from "@/app/factsheet/[id]/v2/FactsheetView";
import { pctSigned } from "@/app/factsheet/[id]/v2/format";
import type { DailyReturn } from "@/lib/factsheet/types";

vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: vi.fn() }));
vi.mock("recharts", async () => {
  const actual = await vi.importActual<typeof import("recharts")>("recharts");
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
      <div style={{ width: 400, height: 300 }}>{children}</div>
    ),
  };
});

/**
 * Phase 169.4 plan 02 (SC2, D-69). The Allocations alpha/beta widget used to
 * measure the book against an equal-weight blend of legacy strategies, a
 * different quantity from the Overview's alpha vs BTC, so the same page showed
 * two alphas for one book. It now measures the book's own daily returns against
 * the dashboard's BTC closes, paired by 169.5's `alignCoveredReturns` and
 * computed by `jointMetrics` over the paired indices on the book's basis, which
 * is exactly how the Overview's BTC comparator block computes its alpha and
 * beta. These cases pin that the two agree, that an interval after a missing
 * BTC close is never paired (166.4 D-A), and that the widget shows no figure
 * when there is nothing honest to show.
 */

const DAY_MS = 86_400_000;
const isoDay = (startIso: string, i: number) =>
  new Date(Date.parse(`${startIso}T00:00:00Z`) + i * DAY_MS).toISOString().slice(0, 10);

// 60 book returns, 2026-08-01 .. 2026-09-29.
const BOOK: DailyReturn[] = Array.from({ length: 60 }, (_, i) => ({
  date: isoDay("2026-08-01", i),
  value: 0.004 * Math.sin(i * 0.7) + 0.0015 * Math.cos(i * 0.31) + 0.0004,
}));
// BTC closes from the day before the book's first date through its last date.
const CLOSES = Array.from({ length: 61 }, (_, i) => ({
  date: isoDay("2026-07-31", i),
  close: 60_000 * (1 + 0.03 * Math.sin(i * 0.45) + 0.0008 * i),
}));
const BTC = { prices: CLOSES, through: "2026-09-29", dropped: [] as string[] };

function readyData(btcBenchmarkPrices: unknown): AlphaBetaWidgetData {
  // Typed as the parsed contract; the wrong-shape case goes through the
  // boundary's parse, which is the point of that case.
  return {
    strategies: [],
    analytics: null,
    equityHistoryState: "ready",
    equityDailyReturns: BOOK,
    btcBenchmarkPrices,
  } as AlphaBetaWidgetData;
}

const base = { timeframe: "1YTD" as const, width: 6, height: 3 };

describe("AlphaBetaDecomposition — the book against BTC (169.4-02, D-69)", () => {
  it("parity: alpha and beta equal the Overview's BTC comparator block for the same book and closes", () => {
    const overview = buildAllocatorPortfolioFactsheetPayload([], {
      allocatorId: "a-1",
      dailyReturns: BOOK,
      btcBenchmarkPrices: BTC,
    });
    const joint = overview!.comparators.btc.joint!;
    expect(Number.isFinite(joint.alpha)).toBe(true);
    expect(Number.isFinite(joint.beta)).toBe(true);

    const widget = computeBookAlphaBeta(readyData(BTC));
    expect(widget.kind).toBe("ok");
    if (widget.kind !== "ok") return;
    expect(widget.alpha).toBe(joint.alpha);
    expect(widget.beta).toBe(joint.beta);

    // And the rendered callout is that alpha.
    render(<AlphaBetaDecomposition data={readyData(BTC)} {...base} />);
    const sign = joint.alpha >= 0 ? "+" : "";
    expect(screen.getByText(`${sign}${(joint.alpha * 100).toFixed(1)}%`)).toBeTruthy();
  });

  it("a missing BTC close: the day and the interval after it are unpaired, so alpha/beta run over the paired indices only", () => {
    const k = 20; // book index whose date has no stored BTC close
    const missing = BOOK[k].date;
    const gapped = { ...BTC, prices: CLOSES.filter((p) => p.date !== missing) };

    const widget = computeBookAlphaBeta(readyData(gapped));
    expect(widget.kind).toBe("ok");
    if (widget.kind !== "ok") return;

    // BTC returns per book date: close(d) / close(d - 1) - 1. Interval k has no
    // close at its end; interval k+1 has no close at its start (166.4 D-A needs
    // a close at both endpoints). Every other interval is paired.
    const closeOn = new Map(CLOSES.map((p) => [p.date, p.close]));
    const btcRet = (i: number) => closeOn.get(BOOK[i].date)! / closeOn.get(isoDay("2026-07-31", i))! - 1;
    const pairedIdx = BOOK.map((_, i) => i).filter((i) => i !== k && i !== k + 1);
    const expected = jointMetrics(
      pairedIdx.map((i) => BOOK[i].value),
      pairedIdx.map((i) => btcRet(i)),
      0,
      365,
    );
    expect(widget.pairedCount).toBe(58);
    expect(widget.alpha).toBeCloseTo(expected.alpha, 12);
    expect(widget.beta).toBeCloseTo(expected.beta, 12);
    // Literal pins of the same two figures (regenerate only on a deliberate
    // change of the fixture above).
    expect(widget.alpha).toBeCloseTo(0.08745351150053449, 10);
    expect(widget.beta).toBeCloseTo(0.07311557987410754, 10);

    // The date-intersection reading (pair every day that has a BTC return)
    // would also pair k+1 with the bridged two-day move; it is a different
    // number, so a regression to it cannot pass the assertions above.
    const bridged = closeOn.get(BOOK[k + 1].date)! / closeOn.get(BOOK[k - 1].date)! - 1;
    const intersectIdx = BOOK.map((_, i) => i).filter((i) => i !== k);
    const intersect = jointMetrics(
      intersectIdx.map((i) => BOOK[i].value),
      intersectIdx.map((i) => (i === k + 1 ? bridged : btcRet(i))),
      0,
      365,
    );
    expect(Math.abs(intersect.beta - expected.beta)).toBeGreaterThan(1e-6);
  });

  it.each([
    ["the unavailable marker", { unavailable: true }],
    ["null", null],
    ["the field absent (read as null)", undefined],
  ])("BTC %s on a ready book: says BTC prices are unavailable, no figure", (_label, btc) => {
    const data = readyData(btc) as Record<string, unknown>;
    if (btc === undefined) delete data.btcBenchmarkPrices;
    expect(computeBookAlphaBeta(data as AlphaBetaWidgetData).kind).toBe("btc_unavailable");
    render(<AlphaBetaDecomposition data={data} {...base} />);
    expect(screen.getByText(/BTC prices are unavailable/)).toBeTruthy();
    expect(screen.queryByText("annualized")).toBeNull();
    expect(screen.queryByTestId("alpha-value")).toBeNull();
  });

  it("history not ready: no figure, even with BTC closes present", () => {
    const data = { ...readyData(BTC), equityHistoryState: "rebuilding", equityDailyReturns: [] };
    expect(computeBookAlphaBeta(data).kind).toBe("not_ready");
    render(<AlphaBetaDecomposition data={data} {...base} />);
    expect(screen.getByText("Insufficient data for alpha/beta decomposition.")).toBeTruthy();
    expect(screen.queryByText("annualized")).toBeNull();
  });

  it("a btcBenchmarkPrices of the wrong shape (the equity chart's daily-point array) is rejected by the boundary, never read as closes", () => {
    const wrong = BOOK.map((r) => ({ date: r.date, value: 60_000 }));
    render(<AlphaBetaDecomposition data={readyData(wrong)} {...base} />);
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.queryByText("annualized")).toBeNull();
    expect(screen.queryByTestId("alpha-value")).toBeNull();
  });

  it("the widget schema stays loose: the rest of the spread dashboard payload passes through", () => {
    render(
      <AlphaBetaDecomposition
        data={{ ...readyData(BTC), holdingsSummary: [], someLaterField: { x: 1 } }}
        {...base}
      />,
    );
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText("annualized")).toBeTruthy();
  });
});

/**
 * 169.4 review SFH MEDIUM-4. The widget used to refuse a figure under 10
 * observations; the 169.4 rewrite dropped that, so a 3-day book read e.g.
 * "+812% annualized". D-69 makes this widget and the Overview show one number,
 * so both gate on ONE constant, `MIN_PAIRED_OBSERVATIONS` in `joint.ts`: the
 * widget in `computeBookAlphaBeta`, the Overview in `buildComparatorBlock`
 * (a null joint, the factsheet's existing absence: no α/IR cells, no §IV).
 * Below the floor neither shows a figure; at it both show the same one.
 */
describe("AlphaBetaDecomposition — the shared paired-observation floor (169.4 SFH MEDIUM-4, D-69)", () => {
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

  // A book of the first n returns, with the BTC closes it needs (one before
  // its first date through its last), so every interval is paired.
  function book(n: number): AlphaBetaWidgetData {
    return { ...readyData({ ...BTC, prices: CLOSES.slice(0, n + 1) }), equityDailyReturns: BOOK.slice(0, n) };
  }
  function overview(n: number) {
    return buildAllocatorPortfolioFactsheetPayload([], {
      allocatorId: "a-1",
      dailyReturns: BOOK.slice(0, n),
      btcBenchmarkPrices: { ...BTC, prices: CLOSES.slice(0, n + 1) },
    })!;
  }
  // The Overview as the dashboard mounts it (AllocationDashboardV2).
  function renderOverview(n: number) {
    const payload = overview(n);
    return render(
      <FactsheetProvider payload={payload} persist={false}>
        <FactsheetBody payload={payload} hideHeader hideAllocatorSection hideFooter />
      </FactsheetProvider>,
    );
  }

  it("the floor is 10 paired observations, the minimum the widget carried before 169.4", () => {
    expect(MIN_PAIRED_OBSERVATIONS).toBe(10);
  });

  it("a 3-day book: the widget shows \"—\" and names its paired count; the Overview shows no alpha either", () => {
    const widget = computeBookAlphaBeta(book(3));
    expect(widget).toEqual({ kind: "below_floor", pairedCount: 3, floor: 10 });

    const { unmount } = render(<AlphaBetaDecomposition data={book(3)} {...base} />);
    expect(screen.getByTestId("alpha-value").textContent).toBe("—");
    expect(
      screen.getByText("Alpha and beta need at least 10 days paired with BTC; this book has 3."),
    ).toBeTruthy();
    expect(screen.queryByText("annualized")).toBeNull();
    expect(screen.queryByText(/%$/)).toBeNull();
    unmount();

    expect(overview(3).comparators.btc.joint).toBeNull();
    renderOverview(3);
    expect(screen.queryByText("α vs BTC")).toBeNull();
    expect(screen.queryByText("Alpha (ann)")).toBeNull();
  });

  it("one below the floor (9 paired): still no figure on either surface", () => {
    expect(computeBookAlphaBeta(book(9)).kind).toBe("below_floor");
    expect(overview(9).comparators.btc.joint).toBeNull();
  });

  it.each([10, 30])("%i paired: the widget and the Overview show the same alpha", (n) => {
    const widget = computeBookAlphaBeta(book(n));
    expect(widget.kind).toBe("ok");
    if (widget.kind !== "ok") return;
    expect(widget.pairedCount).toBe(n);
    const joint = overview(n).comparators.btc.joint!;
    expect(widget.alpha).toBe(joint.alpha);
    expect(widget.beta).toBe(joint.beta);

    // One number: the widget's callout and the Overview's α cell render it.
    const sign = joint.alpha >= 0 ? "+" : "";
    const { unmount } = render(<AlphaBetaDecomposition data={book(n)} {...base} />);
    expect(screen.getByText(`${sign}${(joint.alpha * 100).toFixed(1)}%`)).toBeTruthy();
    expect(screen.getByText("annualized")).toBeTruthy();
    unmount();
    renderOverview(n);
    const cell = screen.getByText("α vs BTC").parentElement!;
    expect(within(cell).getByText(pctSigned(joint.alpha, 1))).toBeTruthy();
  });
});
