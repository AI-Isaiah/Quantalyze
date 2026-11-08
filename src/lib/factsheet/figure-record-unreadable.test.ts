import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: vi.fn() }));

import { captureToSentry } from "@/lib/sentry-capture";
import { gateAnnualized, gateDelta, coveredDays } from "@/lib/figure-gate";
import { buildFactsheetPayload } from "./build-payload";

/**
 * Phase 194 review R5 WR-03 (D-17) and SFH-M3.
 *
 * WR-03: the total record used to be judged on the series' two END dates only. A present but
 * malformed INTERIOR date made any zoom window that starts on it span NaN, which the gate reads
 * as unknown, so the strategy's annualised figures showed with no note while the comparator on
 * the same slice said the dates could not be read. The record is now judged over every date, so
 * every surface that reads `payload.figureRecord` withholds together.
 *
 * SFH-M3: nothing told anyone an unreadable record was withholding its figures. The builder
 * reports it once per build, with the strategy id and the offending date.
 */

const DAY = 86_400_000;
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const series = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    date: addDays("2024-01-01", i),
    value: Math.sin(i / 5) * 0.003 + 0.0001,
  }));
const strategy = (id = "strat-under-test") => ({
  id,
  name: "Test Strategy",
  types: ["quant"],
  markets: ["crypto"],
  computedAt: "2025-05-01T00:00:00Z",
  trustTier: null as null,
});

beforeEach(() => {
  vi.mocked(captureToSentry).mockClear();
});

describe("buildFactsheetPayload: the total record is judged on every series date (R5 WR-03)", () => {
  it("control: a readable 400-day crypto series has a readable record and reports nothing", () => {
    const p = buildFactsheetPayload(strategy(), series(400))!;
    expect(p.figureRecord).not.toBeNull();
    expect(p.figureRecord!.unreadable).toBeUndefined();
    expect(gateAnnualized(p.figureRecord!)).toBe("full");
    expect(vi.mocked(captureToSentry)).not.toHaveBeenCalled();
  });

  it("a malformed INTERIOR date makes the record unreadable although both ends are fine", () => {
    const rows = series(400);
    rows[200] = { date: `${rows[200].date}x`, value: rows[200].value };
    const p = buildFactsheetPayload(strategy(), rows)!;
    const rec = p.figureRecord!;
    // Both ends are readable dates and the record is long enough, so only the interior check
    // can withhold it.
    expect(Number.isFinite(coveredDays(rows[0].date, rows[399].date))).toBe(true);
    expect(rec.unreadable).toBe(true);
    // A zoom window starting on the bad date has an unknown (NaN) span: still withheld, not shown.
    expect(gateAnnualized(rec, NaN)).toBe("withheld");
    expect(gateAnnualized(rec)).toBe("withheld");
    expect(gateDelta(rec, rec, NaN)).toBe("withheld");
  });
});

describe("buildFactsheetPayload: an unreadable record is reported once per build (R5 SFH-M3)", () => {
  it("reports once, from the builder, with the strategy id and the offending date in extra", () => {
    const rows = series(400);
    rows[200] = { date: `${rows[200].date}x`, value: rows[200].value };
    buildFactsheetPayload(strategy("strat-42"), rows, { reportUnreadable: true });
    const calls = vi.mocked(captureToSentry).mock.calls;
    expect(calls).toHaveLength(1);
    const [err, ctx] = calls[0];
    expect(err).toBeInstanceOf(Error);
    expect(ctx.tags).toMatchObject({ op: "buildFactsheetPayload", reason: "figure-record-unreadable" });
    expect(ctx.extra).toMatchObject({
      strategyId: "strat-42",
      firstBadDate: rows[200].date,
      seriesStart: rows[0].date,
      seriesEnd: rows[399].date,
    });
  });

  // R6 WR-01: the browser re-derives this payload in a useMemo on every mount; only the server
  // builder reports, so a client build of the same unreadable series stays silent.
  it("a build without reportUnreadable (a client re-derive) withholds but does not report", () => {
    const rows = series(400);
    rows[200] = { date: `${rows[200].date}x`, value: rows[200].value };
    const p = buildFactsheetPayload(strategy("strat-43"), rows)!;
    expect(p.figureRecord!.unreadable).toBe(true);
    expect(vi.mocked(captureToSentry)).not.toHaveBeenCalled();
  });

  it("a malformed headline start (chain-broken suffix) is unreadable and reported too", () => {
    const rows = series(400);
    const p = buildFactsheetPayload(strategy("strat-9"), rows, {
      dataQuality: { twrChainBroken: true, headlineCoversFrom: "not-a-date" },
      reportUnreadable: true,
    } as never)!;
    expect(p.figureRecord!.unreadable).toBe(true);
    expect(gateAnnualized(p.figureRecord!)).toBe("withheld");
    expect(vi.mocked(captureToSentry).mock.calls).toHaveLength(1);
    expect(vi.mocked(captureToSentry).mock.calls[0][1].extra).toMatchObject({
      strategyId: "strat-9",
      headlineSince: "not-a-date",
    });
  });
});
