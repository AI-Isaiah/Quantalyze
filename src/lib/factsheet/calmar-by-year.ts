import { cumEq, drawdowns } from "./compute";

export type CalmarYearRow = {
  year: string;
  ret: number;     // year-of-year compounded return
  max_dd: number;  // worst drawdown within the year (≤ 0)
  calmar: number;  // ret / |max_dd|
  days: number;    // observed trading days within the year
};

/**
 * Per-calendar-year stability table. Ports `_calmar_by_year()` from the
 * mockup. For each year, walks just the days inside that year, compounds
 * to a year-return, builds an intra-year equity curve, and reports the
 * worst drawdown observed within the year. Calmar = year_return / |dd|.
 */
export function calmarByYear(rets: number[], dates: string[]): CalmarYearRow[] {
  const byYear = new Map<string, { rets: number[] }>();
  for (let i = 0; i < rets.length; i++) {
    const yr = dates[i].slice(0, 4);
    const entry = byYear.get(yr) ?? { rets: [] };
    entry.rets.push(rets[i]);
    byYear.set(yr, entry);
  }
  const out: CalmarYearRow[] = [];
  Array.from(byYear.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .forEach(([year, { rets: yrRets }]) => {
      const eq = cumEq(yrRets);
      const dd = drawdowns(eq);
      const yearRet = eq[eq.length - 1] - 1;
      const maxDd = Math.min(...dd);
      const calmar = maxDd !== 0 ? yearRet / Math.abs(maxDd) : 0;
      out.push({ year, ret: yearRet, max_dd: maxDd, calmar, days: yrRets.length });
    });
  return out;
}
