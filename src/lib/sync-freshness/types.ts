/**
 * B14 — api-key SYNC liveness signaling (audit-2026-05-07).
 *
 * The audit found a shape-consistent defect across the allocation dashboard: a
 * computed-analytics payload (Sharpe/MaxDD/AUM/equity curve) is rendered with
 * full-confidence chrome regardless of how old the exchange sync behind its
 * inputs is (NEW-C09-04/06/07/10/12, NEW-C37-01). The #348 site-fixes added a
 * `StalenessBanner` on `AllocationDashboardV2`, but the staleness DECISION lived
 * inline in `getMyAllocationDashboard` (queries.ts) — a hand-rolled
 * `last_sync_at < cutoff` fold. A new surface re-implementing that comparison
 * could pick a different cutoff and silently drift from the contract.
 *
 * `deriveSyncFreshness` is the ONE place that decision is now made; the
 * `quantalyze/no-raw-staleness-derivation` lint rule fails CI on a future raw
 * `last_sync_at`-vs-cutoff comparison. The widely consumed `{ allKeysStale,
 * lastSyncAt, hasSyncing }` payload contract is unchanged — the producer derives
 * those three fields straight off this `SyncFreshness` (behaviour-preserving;
 * the fields stay the read contract for KpiStrip / EmptyState / ScenarioComposer
 * / EquityChart).
 *
 * NOT the same axis as `src/lib/freshness.ts` (`computeFreshness`). That module
 * classifies a single `strategy_analytics.computed_at` timestamp into
 * fresh/warm/stale BADGES (12h/48h thresholds) for per-strategy chips
 * (FreshnessBadge / SyncBadge / match queue). THIS module folds MANY
 * `api_keys.last_sync_at` / `sync_status` rows into the per-ACCOUNT
 * dashboard staleness signal (24h cutoff). Different input, threshold, output,
 * and consumers — hence the separate `sync-freshness` module and the
 * `SyncFreshness` name (vs that module's `Freshness`). Also distinct from
 * `strategy_analytics.computation_status` (closed-sets.ts:94-123), the
 * "did the COMPUTATION succeed" axis.
 *
 * TWO INDEPENDENT AXES, deliberately NOT a single discriminated `state` enum.
 * `allStale` (every active key older than the cutoff) and `syncing` (a refresh
 * is in flight) are orthogonal: a stale key can be mid-sync. Consumers use them
 * independently — `KpiStrip` nulls KPI cells on `allStale` REGARDLESS of
 * syncing, while the banner gate is `allStale && !syncing`. Collapsing the two
 * into one precedence-ordered state (syncing-over-stale) would flip `allStale`
 * to false during a sync and silently un-null those KPI cells. Keep them split.
 */

/**
 * The minimal `api_keys` row shape the fold reads. Structural (not the full row
 * type) so producers can pass a projection without coupling this module to the
 * query layer.
 *
 * `last_sync_at` is expected to be a UTC ISO-8601 string (`…Z`, the column's
 * `to_char`/`toISOString` shape): the fold compares it LEXICOGRAPHICALLY
 * against the cutoff, which equals chronological order only for same-zone,
 * same-precision timestamps. A producer projecting an offset (`+00:00`) or
 * varying-precision value would mis-order — keep it `…Z`.
 */
export interface SyncSignalKey {
  readonly is_active: boolean;
  readonly last_sync_at: string | null;
  readonly sync_status: string | null;
}

/**
 * A sync older than this (or never recorded) counts toward `allStale`. 24h
 * matches the inline cutoff the #348 banner shipped with (queries.ts) —
 * centralised here so the banner, the fold, and any future consumer cannot
 * drift apart.
 */
export const SYNC_STALE_CUTOFF_MS = 24 * 60 * 60 * 1000;

/**
 * Sync-liveness of an account's dashboard data — two INDEPENDENT signals plus
 * the last successful sync. See the module header for why these are not
 * collapsed into one discriminated state.
 */
export interface SyncFreshness {
  /**
   * Every active key's last sync is older than the cutoff (or it never synced),
   * AND at least one active key exists. Independent of `syncing`: a key can be
   * both stale and mid-sync. Drives the stale KPI render + the warm-up gate.
   */
  readonly allStale: boolean;
  /** Any active key has `sync_status === 'syncing'` (a refresh is in flight). */
  readonly syncing: boolean;
  /** Most-recent successful sync across active keys (ISO), or null if never. */
  readonly lastSyncAt: string | null;
}

/**
 * The ONE place the sync-staleness decision is made. Folds active keys into a
 * `SyncFreshness` with EXACTLY the formulas the #348 banner used inline, so the
 * migration is behaviour-preserving: `allStale` is the all-keys-stale predicate
 * (guarded on `length > 0` so an empty fold is not a false stale cue), `syncing`
 * is the any-key-syncing predicate, `lastSyncAt` is the max successful sync. The
 * two predicates are computed independently.
 *
 * @param keys api_key rows (active + inactive); inactive keys are ignored
 * @param now  injectable clock for deterministic tests (defaults to Date.now)
 */
export function deriveSyncFreshness(
  keys: readonly SyncSignalKey[],
  now: number = Date.now(),
): SyncFreshness {
  const activeKeys = keys.filter((k) => k.is_active);
  const cutoff = new Date(now - SYNC_STALE_CUTOFF_MS).toISOString();

  const allStale =
    activeKeys.length > 0 &&
    activeKeys.every((k) => !k.last_sync_at || k.last_sync_at < cutoff);

  const lastSyncAt = activeKeys.reduce<string | null>((max, k) => {
    if (!k.last_sync_at) return max;
    return !max || k.last_sync_at > max ? k.last_sync_at : max;
  }, null);

  const syncing = activeKeys.some((k) => k.sync_status === "syncing");

  return { allStale, syncing, lastSyncAt };
}
