import type { TimeframeKey } from "@/components/ui/TimeframeSelector";
import { displayStrategyName } from "@/lib/strategy-display";
import type { DisclosureTier } from "@/lib/types";

export { normalizeDailyReturns } from "@/lib/portfolio-math-utils";

/**
 * Pick the display name for an investment row.
 *
 * audit-2026-05-07 G8.A.10 (P43): the previous body inverted the
 * canonical disclosure-tier rule by using codename only on exploratory
 * tier. The canonical resolver `displayStrategyName` says "codename
 * wins at any tier" and falls back to a synthetic `Strategy #<id>`
 * for missing data — and once G8.A.2 (P35) redacts `name` to `null`
 * for non-institutional rows, the previous body would have returned
 * `null` (typed as string!) for those. Route through the canonical
 * resolver here; the allocator-provided alias remains a final
 * override on top.
 */
export function displayName(row: {
  alias: string | null;
  strategy: {
    id?: string | null;
    name?: string | null;
    codename: string | null;
    disclosure_tier: string;
  };
}): string {
  if (row.alias && row.alias.trim()) return row.alias.trim();
  return displayStrategyName({
    id: row.strategy.id ?? "",
    name: row.strategy.name ?? null,
    codename: row.strategy.codename,
    disclosure_tier: row.strategy.disclosure_tier as DisclosureTier,
  });
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
