import { compute, cumEq, drawdowns } from "./compute";
import { dispersion, pearson } from "@/lib/return-stats";
import { annualizationPeriods } from "@/lib/closed-sets";
import { alignCoveredReturns, CALENDAR_7D, COMPARATOR_CALENDARS } from "./align";
import type { WeekdayCalendar } from "./align";
import type { DailyPrice } from "./types";

/**
 * Demo allocator portfolios composed from REAL benchmark return series.
 * The portfolio weights are illustrative; the underlying assets are not.
 * Production will replace this picker with file-upload + saved-portfolio
 * chooser wired to the allocator's actual book.
 */

const VOL_TARGET = 0.18;
const DD_THRESHOLD = -0.05;
const TAIL_WINDOW = 21;

export type AllocatorPortfolio = {
  key: string;
  name: string;
  composition: string;
  metrics: AllocatorMetrics;
};

/**
 * Every measured figure is null when the blend has fewer than 2 usable days
 * (Phase 169.4 D-70(4)); the panel renders it as the em-dash, never a number.
 * `vol_target`, `dd_threshold` and `window` are the model's constants, not
 * measurements, so they stay numbers. `corr` is NaN (null after a JSON
 * round-trip) when the correlation is undefined on a measurable blend (D7).
 */
export type AllocatorMetrics = {
  ann_vol: number | null;
  cum_ret: number | null;
  max_dd: number | null;
  corr: number | null;
  sleeve_pct: number | null;
  blend_vol: number | null;
  vol_target: number;
  tail_count: number | null;
  /**
   * Review SFH HIGH-2 / WR-02: how many 21-date windows were examined (every
   * value priced); tail_count is out of these, and a caption claims nothing about
   * a window outside them.
   */
  tail_windows: number | null;
  /** Null when no window reached the threshold: an empty set has no mean. */
  tail_mm_mean: number | null;
  tail_mm_median: number | null;
  tail_mm_pos: number | null;
  dd_threshold: number;
  window: number;
};

/**
 * Phase 169.4 D-70(3): each comparator leg's asset class, the input of the
 * blend's annualization basis. `COMPARATOR_CALENDARS` maps a key to a calendar
 * only, so the asset class is stated here, once. Any non-"crypto" value reads
 * 252 through `annualizationPeriods`.
 */
export const LEG_ASSET_CLASS = {
  btc: "crypto",
  eth: "crypto",
  spx: "traditional",
  gld: "traditional",
  ief: "traditional",
} as const satisfies Record<keyof typeof COMPARATOR_CALENDARS, string>;

/** One comparator leg of an allocator portfolio blend (D-70(2)). */
export type BlendLeg = {
  weight: number;
  prices: readonly DailyPrice[];
  /** Ascending dropped (corrupt) close dates; a fixture has none. */
  dropped: readonly string[];
  calendar: WeekdayCalendar;
  assetClass: string;
};

/** A comparator leg keyed by its comparator: calendar and asset class from the two maps. */
export function comparatorLeg(
  key: keyof typeof COMPARATOR_CALENDARS,
  weight: number,
  prices: readonly DailyPrice[],
  dropped: readonly string[],
): BlendLeg {
  return { weight, prices, dropped, calendar: COMPARATOR_CALENDARS[key], assetClass: LEG_ASSET_CLASS[key] };
}

/** A blend aligned on its legs' common calendar by {@link alignBlend}. */
export type AlignedBlend = {
  /** The blend dates: the strategy dates on a weekday every leg's calendar carries AND every leg has a close dated (SFH HIGH-1). */
  dates: string[];
  /** Per blend date: the weighted blend, null when any leg is null there (a dropped close inside the interval). */
  returns: Array<number | null>;
  /** Per blend date: true when every comparator leg is paired there. */
  paired: boolean[];
  /** Per blend date: the book's compounded move over the same interval. */
  book: Array<number | null>;
  /** The smaller of the comparator legs' `annualizationPeriods` (D-70(3)). */
  periodsPerYear: number;
  /** The earliest of the legs' last closes on or before the last calendar-shared strategy date; null when a leg has none. */
  through: string | null;
};

const DAY_MS = 86_400_000;

function weekdayOf(iso: string): number {
  return new Date(Date.parse(`${iso}T00:00:00Z`)).getUTCDay();
}

function isoDayBefore(iso: string): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) - DAY_MS).toISOString().slice(0, 10);
}

/**
 * Phase 169.4 D-70(2)-(3), applying 169.5 D-65: an allocator portfolio blend on
 * its legs' COMMON calendar. The blend dates are the strategy `dates` whose
 * weekday every leg's calendar carries and on which every leg has a close (review
 * SFH HIGH-1: a market holiday is not a blend date, so the next common date's
 * interval carries every leg's move across it). Every leg is aligned on them through the
 * ONE alignment, `alignCoveredReturns` (no second pairing rule here), so a
 * Monday reads a weekday leg's Friday-to-Monday move and a 7-day leg's move over
 * the same interval. The book is aligned the same way from its own level series:
 * level 1 dated the day before its first date, then the compounded level at each
 * date (the definition of a return series, not an invented close), on the 7-day
 * calendar with no dropped closes; only that call's series is read.
 *
 * A blend date is null when any leg is null there (a dropped close inside its
 * interval), and paired only when every comparator leg is paired: the date after a
 * holiday is unpaired for a weekday leg (one bridged point where its calendar
 * expects two), so the correlation and the sleeve scan skip it while the own-series
 * figures keep it. Dates past a leg's last close are not blend dates at all. The basis is the smallest `annualizationPeriods` over the comparator
 * legs (D-70(3)): 60/40 252, crypto_book 365, and multi_asset 252 by the founder's
 * 2026-09-30 ruling ("Allow 252 here"), a narrow exception to #597 BLEND-02 for
 * this panel only, whose points are weekdays once weekend gaps are no longer
 * 0-filled. `blendPeriodsPerYear` (BLEND-02's any-crypto-leg rule) is NOT used.
 */
export function alignBlend(
  dates: readonly string[],
  stratRet: readonly number[],
  legs: readonly BlendLeg[],
): AlignedBlend {
  if (legs.length === 0) throw new Error("alignBlend(): a blend needs at least one leg");
  if (stratRet.length !== dates.length) throw new Error("alignBlend(): dates and stratRet must be the same length");
  const periodsPerYear = Math.min(...legs.map(l => annualizationPeriods(l.assetClass)));

  // Review SFH HIGH-1: a blend date is a date EVERY leg priced, not merely a
  // weekday every leg's calendar carries. A US-market holiday is a weekday with
  // no SPX / GLD / IEF close; kept as a blend date it was null, and BTC's move
  // into it (its Friday-to-Monday return, dated the holiday) was discarded with
  // it, while Tuesday read BTC over Monday-to-Tuesday only. With the holiday
  // absent, Tuesday's interval runs from the previous common date, so every leg,
  // BTC included, carries its full close-to-close move across it. A dropped
  // (corrupt) close is never a close, so its date is not a blend date either.
  const closeSets = legs.map(l => {
    const dropped = new Set(l.dropped);
    return new Set(l.prices.map(p => p.date).filter(d => !dropped.has(d)));
  });
  const calendarDates = dates.filter(d => {
    const wd = weekdayOf(d);
    return legs.every(l => l.calendar[wd]);
  });
  const blendDates = calendarDates.filter(d => closeSets.every(c => c.has(d)));

  const aligned = legs.map(l => alignCoveredReturns(l.prices, l.dropped, blendDates, l.calendar));

  const level: DailyPrice[] = [];
  if (dates.length > 0) {
    level.push({ date: isoDayBefore(dates[0]), close: 1 });
    let c = 1;
    for (let i = 0; i < dates.length; i++) {
      c *= 1 + stratRet[i];
      level.push({ date: dates[i], close: c });
    }
  }
  const book = alignCoveredReturns(level, [], blendDates, CALENDAR_7D).returns;

  const returns = blend(
    legs.map(l => l.weight),
    aligned.map(a => a.returns),
  );
  const paired = blendDates.map((_, i) => aligned.every(a => a.paired[i]));

  // `through` is each leg's last close on or before the last date its calendar
  // shares with the blend, the minimum over the legs; null when a leg has none.
  // It is read from the calendar dates, not the blend dates: a strategy dated
  // wholly after a fixture's last close has no blend date, and its caption must
  // still date the prices (D-70(4)) rather than call them unavailable.
  let through: string | null = null;
  const lastCalendarDate = calendarDates[calendarDates.length - 1];
  if (lastCalendarDate !== undefined) {
    for (const l of legs) {
      let legThrough: string | null = null;
      for (const p of l.prices) {
        if (p.date <= lastCalendarDate && (legThrough === null || p.date > legThrough)) legThrough = p.date;
      }
      if (legThrough === null) {
        through = null;
        break;
      }
      if (through === null || legThrough < through) through = legThrough;
    }
  }

  return { dates: blendDates, returns, paired, book, periodsPerYear, through };
}

/**
 * Weighted blend of daily-return series of equal length. A blend day is null
 * when any leg is null there (D-70(2)): a missing leg day is never read as 0%.
 */
export function blend(
  weights: number[],
  series: ReadonlyArray<ReadonlyArray<number | null>>,
): Array<number | null> {
  if (weights.length !== series.length || series.length === 0) {
    throw new Error("blend(): weight/series length mismatch");
  }
  const n = series[0].length;
  const out: Array<number | null> = new Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    let missing = false;
    for (let j = 0; j < weights.length; j++) {
      const v = series[j][i];
      if (v === null) {
        missing = true;
        break;
      }
      s += weights[j] * v;
    }
    out[i] = missing ? null : s;
  }
  return out;
}

/** Every measured figure null: a blend with fewer than 2 usable days (D-70(4)). */
function unmeasuredMetrics(): AllocatorMetrics {
  return {
    ann_vol: null,
    cum_ret: null,
    max_dd: null,
    corr: null,
    sleeve_pct: null,
    blend_vol: null,
    vol_target: VOL_TARGET,
    tail_count: null,
    tail_windows: null,
    tail_mm_mean: null,
    tail_mm_median: null,
    tail_mm_pos: null,
    dd_threshold: DD_THRESHOLD,
    window: TAIL_WINDOW,
  };
}

/**
 * @param rets The portfolio blend, one value per blend date; null where a leg is null.
 * @param mmRets The book on the same dates; null where it has no move.
 * @param periodsPerYear Annualization basis for the frequency-annualized vols
 *   (ann_vol and the sleeve grid-scan's two vols, so blend_vol). Defaults to 252.
 *   The caller passes the blend's own basis, `alignBlend`'s `periodsPerYear`
 *   (D-70(3)). cum_ret / max_dd / corr / tail_* are basis-FREE.
 * @param paired Per date, true when the interval is paired (every comparator leg
 *   paired); defaults to every date paired.
 *
 * Index sets (Phase 169.4 D-70(2)): the own-series figures (ann_vol, cum_ret,
 * max_dd) use the dates where both legs are non-null; the correlation AND the
 * sleeve scan use the paired ones among those (both vols in the scan from that
 * one set, so the scan never mixes windows); a 21-day tail window is dropped
 * when it contains a null. Fewer than 2 usable dates: every figure is null.
 */
export function buildAllocatorMetrics(
  rets: ReadonlyArray<number | null>,
  mmRets: ReadonlyArray<number | null>,
  periodsPerYear = 252,
  paired?: readonly boolean[],
): AllocatorMetrics {
  const n = rets.length;
  // Every figure below is over ONE window, so the legs must be the same length
  // (SFH-M4 / IN-04), as jointMetrics requires. Before, vol used n, the
  // strategy vol a slice and the correlation min(n, m): three windows, silently.
  if (mmRets.length !== n) {
    throw new Error("buildAllocatorMetrics(): rets and mmRets must be the same length");
  }
  if (paired !== undefined && paired.length !== n) {
    throw new Error("buildAllocatorMetrics(): paired must be the same length as rets");
  }
  const own: number[] = [];
  const pr: number[] = [];
  const pm: number[] = [];
  for (let i = 0; i < n; i++) {
    const r = rets[i];
    const m = mmRets[i];
    if (r === null || m === null) continue;
    own.push(r);
    if (paired === undefined || paired[i]) {
      pr.push(r);
      pm.push(m);
    }
  }
  if (own.length < 2) return unmeasuredMetrics();

  const eq = cumEq(own);
  const dd = drawdowns(eq);
  // Vols and correlation are computed by `@/lib/return-stats` (Phase 166.2
  // D-17), population sd. A leg whose only dispersion is float residue has an sd
  // of exactly 0, as an all-zero leg does (D-07), and no correlation: NaN,
  // rendered "—" (founder decision D7, 2026-09-26), never "+0.00".
  const annVol = dispersion(own, 0).sd * Math.sqrt(periodsPerYear);
  const cumRet = eq[eq.length - 1] - 1;
  const maxDd = Math.min(...dd);
  const corr = pearson(pr, pm) ?? NaN;

  // Sleeve sizing: 1% grid scan to find allocation that hits the vol target,
  // over the paired dates only (D-70(2)); fewer than 2 paired dates: no scan.
  let sleevePct: number | null = null;
  let blendVol: number | null = null;
  if (pr.length >= 2) {
    const pVol = dispersion(pr, 0).sd * Math.sqrt(periodsPerYear);
    const mmAnnVol = dispersion(pm, 0).sd * Math.sqrt(periodsPerYear);
    // The blend's cross term is 2(1-w)w * corr * pVol * mmAnnVol. When corr is
    // undefined one leg has no dispersion (its annualised vol is exactly 0), or a
    // leg is non-finite, so the term is 0 by construction; it is dropped rather
    // than multiplied by NaN, and the scan stays exact.
    const crossCorr = Number.isFinite(corr) ? corr : 0;
    let bestW = 0;
    let bestDiff = Math.abs(pVol - VOL_TARGET);
    let bestVol = pVol;
    for (let wInt = 0; wInt <= 100; wInt++) {
      const w = wInt / 100;
      const blendVar =
        (1 - w) ** 2 * pVol ** 2 + w ** 2 * mmAnnVol ** 2 + 2 * (1 - w) * w * crossCorr * pVol * mmAnnVol;
      const v = Math.sqrt(Math.max(0, blendVar));
      if (Math.abs(v - VOL_TARGET) < bestDiff) {
        bestDiff = Math.abs(v - VOL_TARGET);
        bestW = w;
        bestVol = v;
      }
    }
    sleevePct = bestW;
    blendVol = bestVol;
  }

  // Tail co-movement: rolling 21d windows where the portfolio drew ≥ 5%. A
  // window containing a null on either leg is dropped (D-70(2)) and not counted
  // as examined (review SFH HIGH-2): `tail_windows` is the examined count.
  const tailMm: number[] = [];
  let tailWindows = 0;
  for (let i = TAIL_WINDOW; i < n; i++) {
    let pRet = 1;
    let mmRet = 1;
    let hasNull = false;
    for (let k = i - TAIL_WINDOW + 1; k <= i; k++) {
      const r = rets[k];
      const m = mmRets[k];
      if (r === null || m === null) {
        hasNull = true;
        break;
      }
      pRet *= 1 + r;
      mmRet *= 1 + m;
    }
    if (hasNull) continue;
    tailWindows++;
    if (pRet - 1 <= DD_THRESHOLD) tailMm.push(mmRet - 1);
  }
  // Review WR-02: no stress window means no mean, median or positive share; each
  // is null (the em-dash), never a fabricated 0.
  let tailMean: number | null = null;
  let tailPos: number | null = null;
  let tailMedian: number | null = null;
  if (tailMm.length > 0) {
    tailMean = tailMm.reduce((a, x) => a + x, 0) / tailMm.length;
    const sorted = [...tailMm].sort((a, b) => a - b);
    tailMedian =
      sorted.length % 2 === 1 ? sorted[Math.floor(sorted.length / 2)] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
    tailPos = tailMm.filter(x => x > 0).length / tailMm.length;
  }

  // discard unused compute import warning (kept import for symmetry with mockup helpers)
  void compute;

  return {
    ann_vol: annVol,
    cum_ret: cumRet,
    max_dd: maxDd,
    corr,
    sleeve_pct: sleevePct,
    blend_vol: blendVol,
    vol_target: VOL_TARGET,
    // Review round 2 WR-01: a count over zero examined windows is an absence
    // like the mean, never a measured "0". A 0 with windows examined is real.
    tail_count: tailWindows > 0 ? tailMm.length : null,
    tail_windows: tailWindows,
    tail_mm_mean: tailMean,
    tail_mm_median: tailMedian,
    tail_mm_pos: tailPos,
    dd_threshold: DD_THRESHOLD,
    window: TAIL_WINDOW,
  };
}
