/**
 * Phase 169.4 ALLOCTRUTH / plan 169.4-04 (D-66, D-67): test helper for the
 * Scenario suites that used to hand BTC to the composer, the share page and
 * the two sections as daily RETURNS. They now hand closes, the body of
 * `/api/benchmark/btc/prices`.
 *
 * `btcClosesFromReturns` turns a dated returns series into closes: a base close
 * of 100 dated the calendar day before the first return, then each close is the
 * previous one compounded by that date's return. `pricesToDailyReturns` of the
 * result gives back exactly the input returns, so over a DENSE (7-day) series
 * `pairScenarioWithBtc` pairs every portfolio date the old date-intersection
 * join paired, and day one as well (the base close supplies day one's return).
 * Over a sparse calendar (weekdays only) the Friday-to-Monday interval has no
 * Saturday or Sunday close, so the one pairing leaves each Monday unpaired: an
 * expected-count move a migrated test must state, not hide.
 *
 * Not a test file (the include glob is `*.test.{ts,tsx}`), so it is not
 * collected and needs no `vitest.node-env.ts` entry.
 */
import type { BtcCloses } from "./scenario-benchmark";

type DatedReturn = { date: string; value: number };

function shiftDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Closes whose daily returns are `returns`, as the closes route serves them.
 *
 * - `dropped` is passed through as the route's list of corrupt close dates (the
 *   caller also removes those dates from the closes if it wants no close there).
 * - `flatFillGaps` adds a close equal to the previous one on every calendar day
 *   the returns skip. BTC then "did not move" on those days, so the compounded
 *   move over a portfolio interval that spans them equals that interval's one
 *   given return, and the one pairing pairs exactly the dates the old
 *   date-intersection join paired, with the same values. It is for fixtures on
 *   a non-contiguous synthetic calendar whose point is not the calendar (a
 *   covariance built by construction, a two-N decoupling); without it every
 *   interval that spans a skipped day is unpaired.
 */
export function btcClosesFromReturns(
  returns: readonly DatedReturn[],
  opts: { dropped?: readonly string[]; flatFillGaps?: boolean } = {},
): BtcCloses {
  const dropped = [...(opts.dropped ?? [])];
  if (returns.length === 0) return { prices: [], dropped, through: null };
  let close = 100;
  const prices = [{ date: shiftDays(returns[0].date, -1), close }];
  for (const r of returns) {
    if (opts.flatFillGaps) {
      for (let d = shiftDays(prices[prices.length - 1].date, 1); d < r.date; d = shiftDays(d, 1)) {
        prices.push({ date: d, close });
      }
    }
    close *= 1 + r.value;
    prices.push({ date: r.date, close });
  }
  return { prices, dropped, through: prices[prices.length - 1].date };
}
