/**
 * Phase 167.1.2 plan 15 (item 8, D-16): which `allocator_holdings` rows are a
 * key's CURRENT holdings.
 *
 * The rule, in the same words as plan 10's Python helper
 * (`_fetch_latest_holdings_per_eligible_key`): that key's rows at its own
 * latest asof; ordering is not trusted for correctness.
 *
 * Why per key and not allocator-wide: `getLatestExposureSnapshot` takes the
 * allocator's single latest `asof`, which drops every position of a key that
 * did not poll on that day, so a quiet key would read as flat. Each key keeps
 * its own latest poll instead.
 *
 * Why the key set is not narrowed: every key the allocator owns counts,
 * departed ones included. Phase 167.1 routes a holding whose key is not
 * trusted, or is outside the eligible set, into a DISCLOSED part
 * (`untrusted`, `unknownStatus`, `excludedUntrusted`, `excludedUnknownStatus`
 * in `live-holdings-summary.ts`); dropping those keys here would move their
 * dollars out of the disclosures silently. Plan 10 counts eligible keys only
 * because it computes an equity total (D-07); the two share the grain rule,
 * not the key set.
 *
 * Before D-16 the Open Positions collapse kept the newest row per
 * venue:symbol:type across EVERY date, so a position a key closed before its
 * latest poll survived from its last row.
 */

/**
 * Keep, for each `api_key_id`, only the rows whose `asof` equals that key's
 * maximum `asof`. One scan finds each key's maximum, a second keeps the rows
 * at it. Input order is preserved and never relied on: the maximum is
 * computed by comparison, so ascending, descending and shuffled input give
 * the same rows. Rows sharing a key's latest `asof` are all kept.
 */
export function latestHoldingsPerKey<
  T extends { api_key_id: string; asof: string },
>(rows: readonly T[]): T[] {
  const latestByKey = new Map<string, string>();
  for (const r of rows) {
    const current = latestByKey.get(r.api_key_id);
    if (current === undefined || r.asof > current) {
      latestByKey.set(r.api_key_id, r.asof);
    }
  }
  return rows.filter((r) => r.asof === latestByKey.get(r.api_key_id));
}
