// ============================================================================
// B8 — Composite-key helpers
//
// A composite identity (holding scope, date series) must be derived ONE way so
// a partial key can't silently collapse distinct rows. These helpers are the
// single source for those key shapes; inline `${a}:${b}:${c}` templates and
// per-component date-Map closures should consume them instead of re-deriving.
//
// Pure functions, no imports — safe in server, client, and test contexts.
// ============================================================================

/**
 * Canonical holding scope key: `holding:{venue}:{symbol}:{holding_type}`.
 *
 * Keying a holding on `symbol` alone silently collapses multi-venue (Binance
 * BTC + OKX BTC) and spot+derivative (BTC-spot + BTC-perp) holdings to a single
 * row (NEW-C03-02). This triple is the scope_ref keyspace used across the
 * allocations pipeline; `buildHoldingRef` delegates here so there is one impl.
 *
 * Loose structural input: callers' `holding_type` is often a plain `string`
 * (DB text) rather than the narrowed `"spot" | "derivative"`.
 */
export function holdingScopeKey(h: {
  venue: string;
  symbol: string;
  holding_type: string;
}): string {
  return `holding:${h.venue}:${h.symbol}:${h.holding_type}`;
}

/**
 * Build a `Map<date, value>` from a date-keyed series, surfacing duplicate
 * dates instead of silently dropping them (NEW-C11-08).
 *
 * - `"warn"` (default): one `console.warn` per duplicate date, last-write-wins.
 * - `"throw"`: throw on the first duplicate — use where a duplicate date is a
 *   contract violation the caller wants to fail loud on.
 *
 * `label` is only used to make the warning/throw message locatable.
 */
export function dateMapStrict<V>(
  points: ReadonlyArray<{ date: string; value: V }>,
  onCollision: "warn" | "throw" = "warn",
  label = "series",
): Map<string, V> {
  const map = new Map<string, V>();
  for (const p of points) {
    if (map.has(p.date)) {
      const msg = `[dateMapStrict] duplicate date "${p.date}" in ${label} series`;
      if (onCollision === "throw") throw new Error(msg);
      console.warn(`${msg} — last-write-wins`);
    }
    map.set(p.date, p.value);
  }
  return map;
}
