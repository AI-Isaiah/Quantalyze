import type { DailyPoint } from "@/lib/scenario";
import type { TimeframeKey } from "@/components/ui/TimeframeSelector";

/**
 * Normalize the analytics.daily_returns JSONB into a flat
 * { date, value }[] series. Handles three real-world shapes: already
 * an array, a flat {date: value} dict, and a nested {year: {MM-DD: value}}
 * dict. The nested case zero-pads MM-DD components so lexicographic
 * sorting aligns with every other strategy's dates.
 */
export function normalizeDailyReturns(raw: unknown): DailyPoint[] {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw
      .filter(
        (p): p is DailyPoint =>
          p !== null &&
          typeof p === "object" &&
          "date" in p &&
          "value" in p &&
          typeof (p as DailyPoint).date === "string" &&
          typeof (p as DailyPoint).value === "number",
      )
      .sort((a, b) => a.date.localeCompare(b.date));
  }
  const out: DailyPoint[] = [];
  const obj = raw as Record<string, unknown>;
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === "number") {
      out.push({ date: k, value: v });
    } else if (v && typeof v === "object") {
      for (const [kk, vv] of Object.entries(v as Record<string, unknown>)) {
        if (typeof vv === "number") {
          if (kk.length === 10) {
            out.push({ date: kk, value: vv });
          } else {
            const [mm = "", dd = ""] = kk.split("-");
            const paddedMm = mm.padStart(2, "0");
            const paddedDd = dd.padStart(2, "0");
            out.push({ date: `${k}-${paddedMm}-${paddedDd}`, value: vv });
          }
        }
      }
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
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
