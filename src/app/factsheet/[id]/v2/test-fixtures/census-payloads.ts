/**
 * Phase 196 plan 01 (SC-5): three deterministic factsheet payloads, one per census
 * profile, so the census counting rules can be proven against the real FactsheetBody
 * markup and so plan 11's fixture census test reuses the same inputs.
 *
 *   A  API-verified, about two years of daily returns, BTC comparator active.
 *   B  API-verified, about 200 days: under a year, so the short-track note fires.
 *   C  CSV-uploaded, about 60 days: under the 90-day floor, headline figures withheld.
 *
 * Every series is seeded arithmetic (no Math.random) so a count taken today equals a
 * count taken next month. The dates sit inside the bundled BTC fixture window
 * (2023-04-26 to 2026-05-12) so the comparator has real closes under every day.
 */

import { buildFactsheetPayload } from "@/lib/factsheet/build-payload";
import type { DailyReturn, FactsheetPayload } from "@/lib/factsheet/types";

const DAY = 86_400_000;

/** `n` consecutive calendar days ending on `end` (ISO date), oldest first. */
function series(n: number, end: string, drift: number, amp: number): DailyReturn[] {
  const last = Date.parse(`${end}T00:00:00Z`);
  const out: DailyReturn[] = [];
  for (let i = 0; i < n; i++) {
    const t = last - (n - 1 - i) * DAY;
    out.push({
      date: new Date(t).toISOString().slice(0, 10),
      // Two incommensurate sines plus a drift: smooth, bounded, never flat, never NaN.
      value: drift + Math.sin(i * 0.31) * amp + Math.sin(i * 0.071 + 1) * amp * 0.6,
    });
  }
  return out;
}

function build(
  id: string,
  name: string,
  ingestSource: "api" | "csv",
  trustTier: "api_verified" | "csv_uploaded",
  returns: DailyReturn[],
  comparator: "btc" | "none",
): FactsheetPayload {
  const built = buildFactsheetPayload(
    {
      id,
      name,
      types: ["Quantitative"],
      markets: ["crypto"],
      subtypes: [],
      computedAt: "2026-05-12T00:00:00Z",
      trustTier,
      ingestSource,
      assetClass: "crypto",
    },
    returns,
  );
  return { ...built, activeComparator: comparator } as FactsheetPayload;
}

/** Profile A: API-verified, a record of a year or more, comparator available. */
export function censusPayloadA(): FactsheetPayload {
  return build("census-fixture-a", "Census Fixture A", "api", "api_verified", series(730, "2026-04-30", 0.0012, 0.006), "btc");
}

/** Profile B: a record between 90 days and one year (the short-track note fires). */
export function censusPayloadB(): FactsheetPayload {
  return build("census-fixture-b", "Census Fixture B", "api", "api_verified", series(200, "2026-04-30", 0.0011, 0.007), "btc");
}

/** Profile C: CSV-sourced and under 90 days (headline figures withheld). */
export function censusPayloadC(): FactsheetPayload {
  return build("census-fixture-c", "Census Fixture C", "csv", "csv_uploaded", series(60, "2026-04-30", 0.001, 0.008), "none");
}
