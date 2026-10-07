import { alignCoveredReturns, COMPARATOR_CALENDARS } from "@/lib/factsheet/align";
import type { DailyPoint } from "@/lib/portfolio-math-utils";
import type { BtcCloses } from "@/app/(dashboard)/allocations/lib/scenario-benchmark";

/**
 * Phase 164.6.6.2 (D-18, D-22, D-23): a BTC-denominated account's daily returns
 * as the USD daily returns of the same account, so they can be blended with USD
 * strategies. Founder, D-18: "BTC times BTC USD price = value, and then you
 * blend it."
 *
 * The arithmetic, per day `k` (k >= 1):
 *
 *   usd_k = (1 + r_k) * (1 + btc_k) - 1
 *
 * where `r_k` is the account's own (BTC) return and `btc_k` the BTC close move
 * over the SAME interval, from {@link alignCoveredReturns} with the BTC
 * calendar. It is the return of the USD value `NAV_btc * price`: with a BTC NAV
 * of 1.0 -> 1.1 and closes 60000 -> 66000, USD value is (1.1 x 66000) /
 * (1.0 x 60000) - 1 = 0.21. Blending the raw BTC return 0.10 instead would
 * silently drop the price leg of the account's USD exposure.
 *
 * Day 0 is dropped (RESEARCH Pitfall 9): the first day has no prior priced USD
 * value, so a USD return for it would be a price move the account was not yet
 * exposed to.
 *
 * Honesty (T-164.6.6.2-25): a day whose USD return cannot be formed from two
 * priced days is ABSENT from the output, never 0, carried forward or
 * interpolated. That covers a missing close, a dropped (corrupt) close, a day
 * after the last close, an interval the BTC calendar does not fully cover (the
 * interval is unpaired), and a non-finite input value. Absent is the form the
 * composer's and blends' missing-day handling already consumes.
 *
 * `unit == null` is a USD row: the SAME array reference is returned, untouched.
 * A native unit with no price source (`btc === null`) returns `[]`, since no
 * price is invented. The function treats any non-null unit as priced by BTC
 * closes because BTC is the only native unit this phase admits (D-06).
 *
 * Scope: this is the composer's and the blends' conversion only. The persisted
 * USD view of a native-unit strategy is Phase 164.6.6.2.1. The Python twin
 * (plan 164.6.6.2-13) reads the same oracle fixture,
 * `analytics-service/tests/fixtures/native_to_usd_oracle.json`.
 *
 * Isomorphic: no React, no I/O.
 */
export function convertNativeReturnsToUsd(
  series: readonly DailyPoint[],
  unit: string | null,
  btc: Pick<BtcCloses, "prices" | "dropped"> | null,
): DailyPoint[] {
  if (unit == null) return series as DailyPoint[];
  if (btc === null) return [];

  const dates = series.map((p) => p.date);
  const aligned = alignCoveredReturns(btc.prices, btc.dropped, dates, COMPARATOR_CALENDARS.btc);

  const out: DailyPoint[] = [];
  for (let k = 1; k < series.length; k += 1) {
    const b = aligned.returns[k];
    if (!aligned.paired[k] || b === null) continue;
    const r = series[k].value;
    if (!Number.isFinite(r)) continue;
    out.push({ date: series[k].date, value: (1 + r) * (1 + b) - 1 });
  }
  return out;
}
