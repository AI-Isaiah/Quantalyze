/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, act, screen } from "@testing-library/react";
import { buildFactsheetPayload } from "@/lib/factsheet/build-payload";
import type { BenchmarkPricesOpt } from "@/lib/factsheet/build-payload";
import type { DailyPrice, DailyReturn, FactsheetPayload } from "@/lib/factsheet/types";
import { withheldReason } from "@/lib/figure-gate";
import type { FigureRecord } from "@/lib/figure-gate";
import { FactsheetProvider, useComparator, useXRange } from "./factsheet-context";
import { MetricsColumn } from "./MetricsColumn";

/**
 * Phase 194.2 plan 06 (D-05, 194-ZOOM-BENCHMARK-COVERAGE) - the zoomed benchmark covered-span note.
 *
 * WHY. On a selected range the rail's vs-benchmark figures are computed on the OVERLAP of the
 * window and the benchmark's data. A BTC series that starts months into the window made those
 * figures read as full-window with nothing saying otherwise. The rail now prints one muted
 * sentence naming the span the benchmark was compared over, and never withholds a figure for it.
 * Every expected sentence below is typed by hand (UI-SPEC S2), never built with the helper under
 * test, and every date literal is the hand-computed `isoToMonthDay` of the dates named in the
 * fixture comment, so a change to the helper, the formatter or the side rules fails here.
 */

vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: vi.fn() }));

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
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-30T12:00:00Z"));
});
afterEach(() => {
  vi.useRealTimers();
});

type ComparatorKey = FactsheetPayload["activeComparator"];

const DAY = 86_400_000;
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

const START = "2024-01-01";
const N = 731; // 2024-01-01 .. 2025-12-31 (index 0 .. 730)
// Hand-computed dates of this fixture (START + index): 500 = 2025-05-15, 531 = 2025-06-15,
// 650 = 2025-10-12, 699 = 2025-11-30, 700 = 2025-12-01.

const STRATEGY = {
  id: "s-194-2-06-rail",
  name: "Bench Coverage Rail Strategy",
  types: ["quant"],
  markets: ["crypto"],
  computedAt: "2026-09-30T00:00:00Z",
  trustTier: null,
  assetClass: "crypto",
  ingestSource: "api" as const,
};

const CLEARS: FigureRecord = { spanDays: 730, observations: null, crypto: true };
const WITHHELD: FigureRecord = { spanDays: 60, observations: null, crypto: true };

/**
 * A 731-day record whose BTC closes run from strategy index `closesFrom` to `closesTo` inclusive
 * (a close the day before the first covered return is the base close, so the first COVERED day is
 * `closesFrom + 1`). `figureRecord` is set explicitly.
 */
function build(closesFrom: number, closesTo: number, record: FigureRecord | null = CLEARS): FactsheetPayload {
  const rows: DailyReturn[] = Array.from({ length: N }, (_, i) => ({
    date: addDays(START, i),
    value: 0.0009 + Math.sin(i * 0.31) * 0.012 + Math.cos(i * 0.07) * 0.004,
  }));
  const btc: DailyPrice[] = Array.from({ length: closesTo - closesFrom + 1 }, (_, k) => ({
    date: addDays(START, closesFrom + k),
    close: 40000 * (1 + 0.15 * Math.sin(k * 0.05)) + ((k * 37) % 11) * 120,
  }));
  const opt: BenchmarkPricesOpt = { prices: btc, through: btc[btc.length - 1].date, dropped: [] };
  const payload = buildFactsheetPayload(STRATEGY, rows, { benchmarkPrices: opt });
  if (!payload) throw new Error("fixture must build a payload");
  return { ...payload, figureRecord: record };
}

function Harness({ range, comparator }: { range: readonly [number, number]; comparator?: ComparatorKey }) {
  const { setXRange } = useXRange();
  const { setComparator } = useComparator();
  return (
    <>
      <button data-testid="zoom" onClick={() => setXRange(range)}>
        zoom
      </button>
      {comparator && (
        <button data-testid="cmp" onClick={() => setComparator(comparator)}>
          cmp
        </button>
      )}
    </>
  );
}

function mount(
  payload: FactsheetPayload,
  opts: { range?: readonly [number, number]; comparator?: ComparatorKey; part?: "all" | "main" | "detailed" } = {},
) {
  return render(
    <FactsheetProvider payload={payload} persist={false}>
      <Harness range={opts.range ?? [0, 1]} comparator={opts.comparator} />
      <MetricsColumn part={opts.part} />
    </FactsheetProvider>,
  );
}

async function click(testId: string) {
  await act(async () => {
    fireEvent.click(screen.getByTestId(testId));
  });
}

const notes = () => [...document.querySelectorAll('[data-testid="bench-figure-gate-note"]')].map((n) => n.textContent ?? "");

function panel(title: string): HTMLElement {
  const h = [...document.querySelectorAll("h3")].find((el) => el.textContent?.toLowerCase() === title.toLowerCase());
  const p = h?.closest("section") as HTMLElement | null;
  if (!p) throw new Error(`no panel titled "${title}"`);
  return p;
}

/** The benchmark column's text of the Main Metrics row labelled `label`. */
function benchCell(label: string, title = "Main Metrics"): string {
  const tr = [...panel(title).querySelectorAll("tr")].find((r) => r.querySelector("td")?.textContent === label);
  if (!tr) throw new Error(`no row "${label}" in "${title}"`);
  return tr.querySelectorAll("td")[2]?.textContent ?? "";
}

const STARTS_AFTER = "BTC compared over Jun 15, 2025 – Dec 1, 2025 (its data starts after this range).";

describe("D-05 zoomed benchmark covered-span note", () => {
  it("populated: BTC starting after the window start prints the starts-after sentence and the vs-benchmark figures still show", async () => {
    // Closes from index 530: the first covered day is 531 (2025-06-15); the window is [500, 700].
    mount(build(530, 730), { range: [500, 700] });
    await click("zoom");
    expect(notes()).toEqual([STARTS_AFTER]);
    // The note qualifies; it never dashes. The benchmark's annualised cells keep their values.
    expect(benchCell("Sharpe")).not.toBe("—");
    expect(benchCell("Cumulative Return")).not.toBe("—");
  });

  it("a stale cached payload whose stored blocks lack coveredFrom / coveredThrough still names the span on a zoom (the browser re-derive rebuilds the block)", async () => {
    const fresh = build(530, 730);
    const stripBlock = (b: FactsheetPayload["comparators"]["btc"]) => {
      const { coveredFrom: _from, coveredThrough: _through, ...rest } = b;
      void _from;
      void _through;
      return rest;
    };
    const stale: FactsheetPayload = {
      ...fresh,
      comparators: { btc: stripBlock(fresh.comparators.btc), spx: stripBlock(fresh.comparators.spx), none: stripBlock(fresh.comparators.none) },
    };
    expect(stale.comparators.btc.coveredFrom).toBeUndefined();
    mount(stale, { range: [500, 700] });
    await click("zoom");
    expect(notes()).toEqual([STARTS_AFTER]);
  });

  it("both render sites (the opening view's main table and the whole rail) print the identical sentence", async () => {
    mount(build(530, 730), { range: [500, 700], part: "main" });
    await click("zoom");
    expect(notes()).toEqual([STARTS_AFTER]);
  });

  it("populated: the benchmark ending before the window end prints the ends-before sentence", async () => {
    // Closes 0..650: the first covered day is the window's own first (index 100, 2024-04-10), the
    // last is 650 (2025-10-12); the window [100, 700] runs 50 days past it.
    mount(build(0, 650), { range: [100, 700] });
    await click("zoom");
    expect(notes()).toEqual(["BTC compared over Apr 10, 2024 \u2013 Oct 12, 2025 (its data ends before this range)."]);
  });

  it("populated: both sides short prints the 'starts after and ends before' sentence", async () => {
    mount(build(530, 650), { range: [500, 700] });
    await click("zoom");
    expect(notes()).toEqual([
      "BTC compared over Jun 15, 2025 \u2013 Oct 12, 2025 (its data starts after and ends before this range).",
    ]);
  });

  it("zero-one-many: exactly one covered day reads 'compared on {date} only'", async () => {
    // Closes on 699 and 700 only: index 700 (2025-12-01) is the one covered day.
    mount(build(699, 700), { range: [500, 700] });
    await click("zoom");
    expect(notes()).toEqual(["BTC compared on Dec 1, 2025 only (its data starts after this range)."]);
  });

  it("empty: no benchmark day inside the window prints no D-05 note, and nothing prints a dash for a date", async () => {
    // Closes 0..100 only; the window [300, 500] holds none of them.
    mount(build(0, 100), { range: [300, 500] });
    await click("zoom");
    expect(notes()).toEqual([]);
    expect(document.body.textContent).not.toMatch(/compared (over|on) \u2014/);
  });

  it("empty: a weekday benchmark (SPX) against a window that opens on a Saturday and has full coverage prints no D-05 note", async () => {
    // Window [152, 300] opens Sat 2024-06-01 and ends Sun 2024-10-27. SPX's first close in it is
    // Monday 2024-06-03 and its last is Friday 2024-10-25: nothing on its own calendar is missing.
    // A raw-date compare of 2024-06-03 against 2024-06-01 would print a false "starts after".
    mount(build(0, 730), { range: [152, 300], comparator: "spx" });
    await click("cmp");
    await click("zoom");
    expect(notes()).toEqual([]);
    expect(benchCell("Sharpe")).not.toBe("\u2014");
  });

  it("populated: full history never prints the D-05 note, and the existing short-span note is unchanged", () => {
    // Closes on the last 20 days only; no range selected.
    mount(build(710, 730));
    expect(notes()).toEqual([
      "BTC: CAGR, volatility, Sharpe, Sortino and Calmar are annualized from 20 days of record, under one year.",
    ]);
  });

  it("error: an unreadable benchmark covered span prints only the existing unreadable sentence, never the D-05 sentence", async () => {
    // The window's last strategy date (index 700) is not a real calendar day, and the benchmark has a
    // close dated the same string, so that day is COVERED and the covered span cannot be measured.
    const BAD = "2025-12-32";
    const rows: DailyReturn[] = Array.from({ length: 701 }, (_, i) => ({
      date: i === 700 ? BAD : addDays(START, i),
      value: 0.0009 + Math.sin(i * 0.31) * 0.012 + Math.cos(i * 0.07) * 0.004,
    }));
    const btc: DailyPrice[] = [
      ...Array.from({ length: 171 }, (_, k) => ({ date: addDays(START, 530 + k), close: 40000 + k * 10 })),
      { date: BAD, close: 42000 },
    ];
    const opt: BenchmarkPricesOpt = { prices: btc, through: BAD, dropped: [] };
    const built = buildFactsheetPayload(STRATEGY, rows, { benchmarkPrices: opt });
    if (!built) throw new Error("fixture must build a payload");
    mount({ ...built, figureRecord: CLEARS }, { range: [500, 700] });
    await click("zoom");
    const got = notes();
    expect(got).toHaveLength(1);
    expect(got[0]).toBe(`BTC: ${withheldReason("record", { ...CLEARS, unreadable: true })}`);
    expect(got[0]).not.toContain("compared");
  });

  it("populated: a withheld strategy record on a zoomed range prints no benchmark note of any kind", async () => {
    mount(build(530, 730, WITHHELD), { range: [500, 700] });
    await click("zoom");
    expect(notes()).toEqual([]);
    // The strategy's own reason is the one statement.
    expect(document.querySelector('[data-testid="figure-gate-note"]')?.textContent).toBe(withheldReason("record", WITHHELD));
  });

  it("backstop: the note is a plain wrapping paragraph, never truncated or no-wrap (long benchmark names wrap in the rail)", async () => {
    mount(build(530, 730), { range: [500, 700] });
    await click("zoom");
    const p = document.querySelector('[data-testid="bench-figure-gate-note"]') as HTMLElement;
    expect(p.tagName).toBe("P");
    expect(p.className).toBe("mb-2 text-fixed-10 italic text-text-muted");
    expect(p.className).not.toMatch(/truncate|nowrap|overflow-hidden|text-ellipsis/);
  });
});
