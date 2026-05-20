import type { DailyPrice } from "./types";

/**
 * Forward-fill benchmark prices onto a strategy's observation dates, then
 * return aligned daily returns. Ports `align_returns()` from
 * `/tmp/gen_factsheet_v3.py`.
 *
 * The strategy's date list is authoritative — benchmark trading-day gaps are
 * filled by carrying the last seen close forward. The first returned value
 * is always 0 (no prior price to diff against).
 */
export function alignReturns(prices: DailyPrice[], dates: string[]): number[] {
  const byDate = new Map<string, number>();
  for (const p of prices) byDate.set(p.date, p.close);

  const aligned: Array<number | null> = [];
  let lastP: number | null = null;
  for (const d of dates) {
    const p = byDate.get(d);
    if (p !== undefined) lastP = p;
    aligned.push(lastP);
  }

  const rets: number[] = [0];
  for (let i = 1; i < aligned.length; i++) {
    const a = aligned[i];
    const b = aligned[i - 1];
    if (a != null && b != null && b !== 0) rets.push(a / b - 1);
    else rets.push(0);
  }
  return rets;
}
