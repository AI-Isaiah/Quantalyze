import { createHash } from "node:crypto";

/**
 * Phase 167.1.2.2.2 (TRADESYNC, plan 10): a short, stable key member for
 * `strategy_analytics.series_provenance`. The jsonb comes back from PostgREST
 * with a deterministic key order, so its serialisation is stable for equal
 * values. Hashed so a long gap list never inflates the cache key; 16 hex chars
 * of sha256 is ample for "did this value change", and a collision can only delay
 * a refresh to the 3600 s revalidate, never serve another strategy's page (the
 * id is its own key member). Absent provenance is the literal "none".
 *
 * WHY THIS LIVES HERE AND NOT IN THE FACTSHEET PAGE. The hash chain ends in a
 * method named like a table write, and the sole-writer guard for the strategies
 * publish transition (see strategies-published-sole-writer-guard.test.ts) scans
 * raw file TEXT, comments included, for a strategies-table read, a write-shaped
 * call and a publish literal together. The page holds the first and third in
 * prose and queries, so adding the hash chain there made it look like a second
 * publish writer. The guard cannot tell a hash from a table write, and widening a
 * publish-path guard to forgive that would weaken it for every future file.
 * Keeping the helper in a module that never touches the strategies table removes
 * the false positive at its source. (Do not spell those literals out in this
 * comment: the scan is not comment-aware, so quoting them here would trip it.)
 *
 * Server-only by virtue of `node:crypto`; the page that calls it runs on Node.
 */
export function provenanceFingerprint(seriesProvenance: unknown): string {
  if (seriesProvenance == null) return "none";
  return createHash("sha256")
    .update(JSON.stringify(seriesProvenance) ?? "")
    .digest("hex")
    .slice(0, 16);
}
