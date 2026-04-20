import type { TimeframeKey } from "@/components/ui/TimeframeSelector";
import type { DailyPoint } from "@/lib/scenario";

export { normalizeDailyReturns } from "@/lib/portfolio-math-utils";

/**
 * Convert per-allocator equity snapshots into the DailyPoint[] shape
 * consumed by the chart widgets (EquityCurve / DrawdownChart) via the
 * Phase 07 parallel-prop path.
 *
 * Phase 07 / VOICES-ACCEPTED f7. Mid-series gaps are forward-filled with
 * the previous day's `value_usd` (naive but safe for Phase 07 MVP — the
 * 05:00 UTC daily-refresh cron makes multi-day gaps rare in practice).
 *
 * TODO(phase-07+): Revisit to emit explicit "no-data" markers for gaps
 * longer than a threshold so the chart can break the line instead of
 * silently forward-filling. Tracked under PURGE-02 follow-ups.
 *
 * Behaviour:
 *   - Happy path: each snapshot → one DailyPoint { date, value }.
 *   - Mid-series gap: forward-fill every missing day between two
 *     snapshots with the earlier snapshot's value_usd. The later
 *     snapshot's value lands on its own asof.
 *   - Warm-up: `snapshots.length < 30` → return whatever's available.
 *     The KPI warm-up gate in KpiStrip handles the "not enough data"
 *     render; the adapter does not pad.
 *   - Empty / single / unsorted inputs are handled defensively.
 */
export function equitySnapshotsToDailyPoints(
  snapshots: Array<{ asof: string; value_usd: number }>,
): DailyPoint[] {
  if (snapshots.length === 0) return [];
  // Defensive ascending sort — the server query already orders by asof
  // ascending, but keep this as a belt-and-suspenders guard against a
  // future caller that forgets the order clause.
  const sorted = [...snapshots].sort((a, b) => a.asof.localeCompare(b.asof));

  const points: DailyPoint[] = [];
  let prevValue: number | null = null;
  let prevDate: Date | null = null;

  const ONE_DAY_MS = 24 * 60 * 60 * 1000;
  for (const snap of sorted) {
    const curDate = new Date(snap.asof + "T00:00:00.000Z");
    if (prevDate !== null && prevValue !== null) {
      // Forward-fill every missing day strictly between prev and cur
      for (
        let fill = new Date(prevDate.getTime() + ONE_DAY_MS);
        fill.getTime() < curDate.getTime();
        fill = new Date(fill.getTime() + ONE_DAY_MS)
      ) {
        points.push({
          date: fill.toISOString().slice(0, 10),
          value: prevValue,
        });
      }
    }
    points.push({ date: snap.asof, value: snap.value_usd });
    prevDate = curDate;
    prevValue = snap.value_usd;
  }
  return points;
}

/**
 * Pick the display name for an investment row. The allocator-provided
 * alias takes priority; otherwise the strategy's codename (for
 * exploratory-tier) or canonical name.
 */
export function displayName(row: {
  alias: string | null;
  strategy: { name: string; codename: string | null; disclosure_tier: string };
}): string {
  if (row.alias && row.alias.trim()) return row.alias.trim();
  if (row.strategy.disclosure_tier === "exploratory" && row.strategy.codename) {
    return row.strategy.codename;
  }
  return row.strategy.name;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Compute the timeframe's start date (ISO YYYY-MM-DD) from the
 * reference "today" date. The reference is the most recent date in
 * the data -- not wall-clock today -- so the window lines up with
 * whatever the analytics pipeline last synced.
 */
export function getTimeframeStart(
  timeframe: TimeframeKey,
  lastDataDate: string | null,
  portfolioInceptionDate: string,
): string {
  if (timeframe === "ALL" || !lastDataDate) return portfolioInceptionDate;

  const [y, m, d] = lastDataDate.split("-").map((x) => parseInt(x, 10));
  const ref = new Date(Date.UTC(y, m - 1, d));

  switch (timeframe) {
    case "1DTD": {
      const start = new Date(ref);
      start.setUTCDate(start.getUTCDate() - 1);
      return isoDate(start);
    }
    case "1WTD": {
      // Monday of the week containing ref (UTC)
      const start = new Date(ref);
      const dow = start.getUTCDay(); // 0 = Sun
      const delta = dow === 0 ? 6 : dow - 1;
      start.setUTCDate(start.getUTCDate() - delta);
      return isoDate(start);
    }
    case "1MTD": {
      return isoDate(new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), 1)));
    }
    case "1QTD": {
      const qStartMonth = Math.floor(ref.getUTCMonth() / 3) * 3;
      return isoDate(new Date(Date.UTC(ref.getUTCFullYear(), qStartMonth, 1)));
    }
    case "1YTD": {
      return isoDate(new Date(Date.UTC(ref.getUTCFullYear(), 0, 1)));
    }
    case "3YTD": {
      const start = new Date(ref);
      start.setUTCFullYear(start.getUTCFullYear() - 3);
      return isoDate(start);
    }
    default:
      return portfolioInceptionDate;
  }
}
