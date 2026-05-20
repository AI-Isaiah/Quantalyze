import type { DailyHeatmapYear, MonthlyReturnsRow } from "./types";

/**
 * Aggregate daily returns into a year × month matrix of compounded returns,
 * plus a YTD compounded total per row. Used by the Monthly Returns heatmap.
 *
 * Returns one row per calendar year present in `dates`, ascending. Months
 * with zero observations are stored as `null` so the heatmap can render a
 * neutral cell instead of fabricating a 0% return.
 */
export function monthlyReturnsMatrix(rets: number[], dates: string[]): MonthlyReturnsRow[] {
  if (rets.length === 0 || dates.length !== rets.length) return [];

  // Accumulator: year → 12-slot product accumulator (null = no obs yet).
  const byYear = new Map<string, { byMonth: (number | null)[]; ytd: number | null }>();
  for (let i = 0; i < rets.length; i++) {
    const yr = dates[i].slice(0, 4);
    const mIdx = parseInt(dates[i].slice(5, 7), 10) - 1;
    const r = rets[i];
    if (!Number.isFinite(r)) continue;
    let row = byYear.get(yr);
    if (!row) {
      row = { byMonth: new Array(12).fill(null), ytd: null };
      byYear.set(yr, row);
    }
    const prev = row.byMonth[mIdx];
    row.byMonth[mIdx] = prev == null ? r : (1 + prev) * (1 + r) - 1;
    row.ytd = row.ytd == null ? r : (1 + row.ytd) * (1 + r) - 1;
  }

  return Array.from(byYear.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([year, row]) => ({
      year,
      byMonth: row.byMonth,
      ytd: row.ytd ?? 0,
    }));
}

/**
 * Per-year daily-return matrix laid out as a 7-row × 54-col GitHub-style grid.
 * `cells[w][d]` = return for the day in ISO week `w` (0-indexed from year-week-1)
 * on weekday `d` (0=Mon … 6=Sun). Non-observed days are null.
 *
 * 54 cols (not 53) because leap years whose Jan-1 falls on Sunday push Dec 31
 * into weekIdx=53 — a 53-col grid silently drops the last day of those years.
 *
 * Built for the Daily Returns heatmap. We pre-compute the grid server-side so
 * the client component is pure SVG drawing — no date math on render.
 */
export function dailyReturnsByYear(rets: number[], dates: string[]): DailyHeatmapYear[] {
  if (rets.length === 0 || dates.length !== rets.length) return [];

  const byYear = new Map<string, { cells: (number | null)[][]; firstWeekOffset: number }>();
  for (let i = 0; i < rets.length; i++) {
    const iso = dates[i];
    const r = rets[i];
    if (!Number.isFinite(r)) continue;
    const yr = iso.slice(0, 4);
    const d = new Date(`${iso}T00:00:00Z`);
    const doy = dayOfYear(d);
    const weekday = (d.getUTCDay() + 6) % 7; // Mon=0 … Sun=6

    let row = byYear.get(yr);
    if (!row) {
      const jan1 = new Date(Date.UTC(parseInt(yr, 10), 0, 1));
      const jan1Weekday = (jan1.getUTCDay() + 6) % 7;
      row = {
        cells: Array.from({ length: 54 }, () => new Array(7).fill(null)),
        firstWeekOffset: jan1Weekday,
      };
      byYear.set(yr, row);
    }
    const weekIdx = Math.floor((doy - 1 + row.firstWeekOffset) / 7);
    if (weekIdx >= 0 && weekIdx < row.cells.length) {
      row.cells[weekIdx][weekday] = r;
    }
  }

  return Array.from(byYear.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([year, row]) => ({ year, cells: row.cells, firstWeekOffset: row.firstWeekOffset }));
}

function dayOfYear(d: Date): number {
  const start = Date.UTC(d.getUTCFullYear(), 0, 0);
  return Math.floor((d.getTime() - start) / 86_400_000);
}
