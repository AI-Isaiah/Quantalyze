import type { TimeSeriesPoint } from "./types";

/**
 * One drawdown episode: peak → trough → recovery (or ongoing).
 *
 * `depthPct` is the value at the trough, which is ≤ 0 in the drawdown series
 * convention (value = 0 means at a new high, value < 0 means below prior peak).
 * `durationDays` is peak-to-recovery inclusive; for ongoing drawdowns it is
 * peak-to-last-point. `isCurrent` is true when the input series ends while
 * still in this drawdown (recoveryDate is null in that case).
 */
export interface DrawdownEpisode {
  peakDate: string;
  troughDate: string;
  recoveryDate: string | null;
  depthPct: number;
  durationDays: number;
  isCurrent: boolean;
}

const MS_PER_DAY = 86_400_000;

/**
 * Segment a drawdown time series into discrete episodes, sorted by depth desc.
 *
 * Tiny drawdowns (|depth| < minDepth) are filtered so the list stays actionable
 * for allocators. Default threshold is 0.5%.
 */
export function segmentDrawdowns(
  series: TimeSeriesPoint[],
  minDepth = 0.005,
): DrawdownEpisode[] {
  if (series.length < 2) return [];

  const episodes: DrawdownEpisode[] = [];

  let inEpisode = false;
  let peakIdx = -1;
  let troughIdx = -1;
  let troughValue = 0;

  for (let i = 0; i < series.length; i++) {
    const point = series[i];
    const value = point.value;

    if (!inEpisode) {
      if (value < 0) {
        // Enter a new episode. The peak is the prior index (last point where
        // value was >= 0). If the series starts already below 0, there is no
        // prior index — treat index 0 as the peak.
        inEpisode = true;
        peakIdx = i > 0 ? i - 1 : 0;
        troughIdx = i;
        troughValue = value;
      }
    } else {
      if (value < troughValue) {
        troughValue = value;
        troughIdx = i;
      }
      if (value >= 0) {
        // Recovery: close the episode at the current index.
        episodes.push(
          makeEpisode(series, peakIdx, troughIdx, i, false),
        );
        inEpisode = false;
        peakIdx = -1;
        troughIdx = -1;
        troughValue = 0;
      }
    }
  }

  // End-of-series while still in a drawdown → ongoing episode.
  if (inEpisode) {
    episodes.push(
      makeEpisode(series, peakIdx, troughIdx, series.length - 1, true),
    );
  }

  return episodes
    .filter((e) => Math.abs(e.depthPct) >= minDepth)
    .sort((a, b) => Math.abs(b.depthPct) - Math.abs(a.depthPct));
}

function makeEpisode(
  series: TimeSeriesPoint[],
  peakIdx: number,
  troughIdx: number,
  endIdx: number,
  isCurrent: boolean,
): DrawdownEpisode {
  const peakDate = series[peakIdx].date;
  const troughDate = series[troughIdx].date;
  const endDate = series[endIdx].date;
  const peakMs = parseUtcDate(peakDate);
  const endMs = parseUtcDate(endDate);
  const durationDays = Math.round((endMs - peakMs) / MS_PER_DAY);
  return {
    peakDate,
    troughDate,
    recoveryDate: isCurrent ? null : endDate,
    depthPct: series[troughIdx].value,
    durationDays,
    isCurrent,
  };
}

/**
 * Parse a YYYY-MM-DD date string as UTC midnight. Per ECMAScript spec,
 * `Date.parse("2024-01-01")` already returns UTC, but we go explicit so
 * that a malformed input like `"2024-01-01T00:00:00"` (no zone suffix)
 * cannot drift into local-time parsing and produce timezone-dependent
 * durationDays under DST boundaries.
 */
function parseUtcDate(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map((s) => parseInt(s, 10));
  return Date.UTC(y, m - 1, d);
}
