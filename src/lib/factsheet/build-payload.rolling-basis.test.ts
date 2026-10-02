import { describe, it, expect } from "vitest";
import { buildFactsheetPayload } from "./build-payload";
import type { BuildFactsheetOpts } from "./build-payload";
import { compute } from "./compute";
import { rollingSharpe, rollingSortino, rollingVol } from "./rolling";
import type { DailyReturn, FactsheetPayload } from "./types";

/**
 * Phase 169.1 plan 06 (D-33, D-39, D-36) — the rolling statistics run over the
 * days the engine runs them over.
 *
 * `compute_all_metrics` computes its rolling Sharpe on
 * `_rolling_basis = stat_returns if day_basis == "active" else returns`, and its
 * rolling volatility and rolling Sortino on `returns`. For a composite, `returns`
 * is `gap_fill_daily_returns` of the stitched series: every calendar day, an
 * absent day 0.0. Until this plan the browser ran all three over every present
 * day, so:
 *   - under the active basis the rolling Sharpe was diluted by the zero days the
 *     headline Sharpe excludes, and the two disagreed at a full-length window;
 *   - on a gapped calendar composite all three ran over the present days, not the
 *     zero-filled series (D-33's reported residual, closed by D-39).
 *
 * Every expected value is computed here from the rolling functions and from
 * `compute()` with NO conventions over a series built in this file, never from
 * `metricsBasisSeries`, the helper under test.
 */

const DAY = 86_400_000;
const addDays = (d: string, n: number) =>
  new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const START = "2024-01-01";

const STRATEGY = {
  id: "s-169-1-06-rolling",
  name: "Rolling Basis Fixture",
  types: ["quant"],
  markets: ["crypto"],
  computedAt: "2026-10-01T00:00:00Z",
  trustTier: null,
  assetClass: "crypto",
  ingestSource: "csv" as const,
};

const value = (i: number) => 0.0011 + Math.sin(i * 0.37) * 0.011 + Math.cos(i * 0.11) * 0.005;

function build(rows: DailyReturn[], opts: Partial<BuildFactsheetOpts> = {}): FactsheetPayload {
  const p = buildFactsheetPayload(STRATEGY, rows, opts as BuildFactsheetOpts);
  if (!p) throw new Error("fixture must build a payload");
  return p;
}

/** `n` consecutive calendar days; `zeroAt` days carry a 0 return. */
function dailyRows(n: number, zeroAt: (i: number) => boolean = () => false): DailyReturn[] {
  return Array.from({ length: n }, (_, i) => ({ date: addDays(START, i), value: zeroAt(i) ? 0 : value(i) }));
}

/** 200 present days; one calendar day is ABSENT before each of the observations 30, 38, ..., 182. */
const GAP_BEFORE = new Set(Array.from({ length: 20 }, (_, k) => 30 + 8 * k));
function gappedRows(): DailyReturn[] {
  const out: DailyReturn[] = [];
  let offset = 0;
  for (let i = 0; i < 200; i++) {
    if (GAP_BEFORE.has(i)) offset += 1;
    out.push({ date: addDays(START, i + offset), value: value(i) });
  }
  return out;
}

/** The zero-filled calendar twin and each present day's offset in it, built independently of compute.ts. */
function zeroFill(p: FactsheetPayload): { rets: number[]; dates: string[]; offsetOf: number[] } {
  const byDate = new Map(p.dates.map((d, i) => [d, p.strategyReturns[i]]));
  const rets: number[] = [];
  const dates: string[] = [];
  for (let d = p.dates[0]; d <= p.dates[p.dates.length - 1]; d = addDays(d, 1)) {
    dates.push(d);
    rets.push(byDate.get(d) ?? 0);
  }
  const offsetOf = p.dates.map((d) => dates.indexOf(d));
  return { rets, dates, offsetOf };
}

const relClose = (a: number, b: number, tol = 1e-12) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));

describe("the rolling Sharpe runs on the headline's day basis (D-33)", () => {
  // 200 days; the 74 odd days 1..147 are zero, so exactly 126 are non-zero and the last is non-zero.
  const ZERO = (i: number) => i % 2 === 1 && i <= 147;

  it("active basis: at the last date it equals the headline Sharpe (a 126-day window over the 126 active days); a zero day is null", () => {
    const p = build(dailyRows(200, ZERO), { dayBasis: "active" } as Partial<BuildFactsheetOpts>);
    expect(p.strategyReturns.filter((r) => r !== 0).length).toBe(126);
    expect(p.rollingWindow.window).toBe(126);
    expect(p.strategyRollingSharpe.length).toBe(p.dates.length);

    const last = p.strategyRollingSharpe[p.dates.length - 1];
    expect(typeof last).toBe("number");
    expect(Number.isFinite(p.strategyMetrics.sharpe)).toBe(true);
    expect(relClose(last as number, p.strategyMetrics.sharpe), `${last} vs ${p.strategyMetrics.sharpe}`).toBe(true);
    p.strategyReturns.forEach((r, i) => {
      if (r === 0) expect(p.strategyRollingSharpe[i], `day ${i}`).toBeNull();
    });
  });

  it("calendar composite with interior gaps: at the last date it is compute()'s Sharpe of the last `window` days of the zero-filled series; warm-up counts calendar days", () => {
    const p = build(gappedRows(), { dataQuality: { composite: true } } as Partial<BuildFactsheetOpts>);
    const w = p.rollingWindow.window;
    expect(w).toBe(126);
    const z = zeroFill(p);
    expect(z.rets.length).toBe(220);
    expect(p.strategyRollingSharpe.length).toBe(p.dates.length);

    const want = compute(z.rets.slice(-w), z.dates.slice(-w), 0, p.periodsPerYear!).sharpe;
    const last = p.strategyRollingSharpe[p.dates.length - 1] as number;
    expect(relClose(last, want), `${last} vs ${want}`).toBe(true);

    // The last present day whose calendar offset is inside the warm-up (< w - 1) is null.
    const inWarmup = z.offsetOf.map((o, i) => (o < w - 1 ? i : -1)).filter((i) => i >= 0);
    expect(inWarmup.length).toBeGreaterThan(0);
    for (const i of inWarmup) expect(p.strategyRollingSharpe[i], `day ${i}`).toBeNull();
  });
});

describe("a gapped calendar composite's rolling volatility and Sortino run over the zero-filled series (D-39)", () => {
  it("at the last date each equals the rolling function over the zero-filled series, and differs from its value over the present days", () => {
    const p = build(gappedRows(), { dataQuality: { composite: true } } as Partial<BuildFactsheetOpts>);
    const w = p.rollingWindow.window;
    const ppy = p.periodsPerYear!;
    const z = zeroFill(p);
    const lastOff = z.rets.length - 1;
    const lastIdx = p.dates.length - 1;

    for (const [name, fn, got] of [
      ["rollingVol", rollingVol, p.strategyRollingVol],
      ["rollingSortino", rollingSortino, p.strategyRollingSortino],
    ] as const) {
      expect(got.length, name).toBe(p.dates.length);
      const engine = fn(z.rets, w, ppy)[lastOff] as number;
      const presentDays = fn(p.strategyReturns, w, ppy)[lastIdx] as number;
      expect(Number.isFinite(engine) && Number.isFinite(presentDays), name).toBe(true);
      expect(relClose(engine, presentDays, 1e-6), `${name}: the fixture must tell the two apart`).toBe(false);
      expect(relClose(got[lastIdx] as number, engine), `${name}: ${got[lastIdx]} vs ${engine}`).toBe(true);

      for (let i = 0; i < p.dates.length; i++) {
        if (z.offsetOf[i] < w - 1) expect(got[i], `${name} day ${i}`).toBeNull();
      }
    }
  });
});

describe("an ACTIVE-day-basis gapped composite's rolling volatility and Sortino still run over the zero-filled series (169.1 review MD-02)", () => {
  // The engine rolls vol and Sortino on `returns`, which for a composite is the
  // gap-filled calendar series under EVERY day basis; the day basis moves only
  // `_rolling_basis`, the rolling Sharpe. Before MD-02 the active arm rolled vol
  // and Sortino over the present days, so this composite's rolling charts and
  // the Rolling Metrics table disagreed with the engine at full history.
  it("at the last date each equals the rolling function over the zero-filled twin and differs from its present-days value; the rolling Sharpe stays on the active days", () => {
    const p = build(gappedRows(), { dataQuality: { composite: true }, dayBasis: "active" } as Partial<BuildFactsheetOpts>);
    expect(p.dayBasis).toBe("active");
    const w = p.rollingWindow.window;
    const ppy = p.periodsPerYear!;
    const z = zeroFill(p);
    const lastOff = z.rets.length - 1;
    const lastIdx = p.dates.length - 1;

    for (const [name, fn, got] of [
      ["rollingVol", rollingVol, p.strategyRollingVol],
      ["rollingSortino", rollingSortino, p.strategyRollingSortino],
    ] as const) {
      expect(got.length, name).toBe(p.dates.length);
      const engine = fn(z.rets, w, ppy)[lastOff] as number;
      const presentDays = fn(p.strategyReturns, w, ppy)[lastIdx] as number;
      expect(Number.isFinite(engine) && Number.isFinite(presentDays), name).toBe(true);
      expect(relClose(engine, presentDays, 1e-6), `${name}: the fixture must tell the two apart`).toBe(false);
      expect(relClose(got[lastIdx] as number, engine), `${name}: ${got[lastIdx]} vs ${engine}`).toBe(true);
    }

    // The day basis still moves the rolling Sharpe: the active days (here every
    // present day is non-zero), never the zero-filled series.
    const active = p.strategyReturns.filter((r) => r !== 0);
    expect(active.length).toBe(p.strategyReturns.length);
    const wantSharpe = rollingSharpe(active, w, ppy)[active.length - 1] as number;
    expect(relClose(p.strategyRollingSharpe[lastIdx] as number, wantSharpe)).toBe(true);
  });
});

describe("where the engine's `returns` is every given day, the rolling statistics are unchanged (D-36, D-39)", () => {
  const same = (p: FactsheetPayload, which: ("vol" | "sharpe" | "sortino")[]) => {
    const w = p.rollingWindow.window;
    const ppy = p.periodsPerYear!;
    const r = p.strategyReturns;
    if (which.includes("vol")) expect(p.strategyRollingVol).toEqual(rollingVol(r, w, ppy));
    if (which.includes("sharpe")) expect(p.strategyRollingSharpe).toEqual(rollingSharpe(r, w, ppy));
    if (which.includes("sortino")) expect(p.strategyRollingSortino).toEqual(rollingSortino(r, w, ppy));
  };

  it("active basis: the rolling volatility and Sortino are those of ALL the payload's returns (the engine feeds them `returns`, not `stat_returns`)", () => {
    const p = build(dailyRows(200, (i) => i % 2 === 1 && i <= 147), { dayBasis: "active" } as Partial<BuildFactsheetOpts>);
    same(p, ["vol", "sortino"]);
  });

  it("no conventions: all three are byte-identical to the rolling functions over the payload's returns", () => {
    same(build(dailyRows(200, (i) => i % 5 === 0)), ["vol", "sharpe", "sortino"]);
  });

  it("a single-key payload with interior gaps (no dataQuality.composite): all three over the present days (the single-key engine does not zero-fill)", () => {
    same(build(gappedRows()), ["vol", "sharpe", "sortino"]);
  });
});

describe("a basis series shorter than the picked window (recorded behaviour, D-33)", () => {
  it("an active payload with 140 days of which 20 are non-zero: the rolling Sharpe is all null and rollingWindow is unchanged", () => {
    const p = build(dailyRows(140, (i) => i % 7 !== 6), { dayBasis: "active" } as Partial<BuildFactsheetOpts>);
    expect(p.strategyReturns.filter((r) => r !== 0).length).toBe(20);
    expect(p.rollingWindow).toEqual({ window: 126, label: "6mo", enough: true });
    expect(p.strategyRollingSharpe.length).toBe(140);
    expect(p.strategyRollingSharpe.every((v) => v === null)).toBe(true);
  });
});
