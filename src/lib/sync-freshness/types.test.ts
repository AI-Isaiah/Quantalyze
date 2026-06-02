import { describe, it, expect } from "vitest";

import {
  deriveSyncFreshness,
  SYNC_STALE_CUTOFF_MS,
  type SyncSignalKey,
} from "./types";

// ---------------------------------------------------------------------------
// B14 (NEW-C09-04, audit-2026-05-07) — the sync-freshness fold is the ONE place
// the staleness decision is made. These tests pin the exact formulas the #348
// banner used inline so the migration is behaviour-preserving, and pin the
// INDEPENDENCE of allStale vs syncing (the load-bearing property: KpiStrip nulls
// KPI cells on allStale regardless of syncing).
// ---------------------------------------------------------------------------

const NOW = new Date("2026-06-02T12:00:00Z").getTime();
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();
const HOUR = 60 * 60 * 1000;

function key(over: Partial<SyncSignalKey>): SyncSignalKey {
  return { is_active: true, last_sync_at: iso(HOUR), sync_status: "complete", ...over };
}

describe("deriveSyncFreshness", () => {
  it("allStale=false when at least one active key synced within the cutoff", () => {
    const f = deriveSyncFreshness([key({ last_sync_at: iso(2 * HOUR) })], NOW);
    expect(f.allStale).toBe(false);
    expect(f.syncing).toBe(false);
  });

  it("allStale=true when every active key's last sync is older than the cutoff", () => {
    const f = deriveSyncFreshness([key({ last_sync_at: iso(3 * 24 * HOUR) })], NOW);
    expect(f.allStale).toBe(true);
    expect(f.lastSyncAt).toBe(iso(3 * 24 * HOUR));
  });

  it("never synced: allStale=true and lastSyncAt=null", () => {
    const f = deriveSyncFreshness([key({ last_sync_at: null })], NOW);
    expect(f.allStale).toBe(true);
    expect(f.lastSyncAt).toBeNull();
  });

  // The load-bearing regression guard: allStale and syncing are INDEPENDENT.
  // A stale key that is also mid-sync must report BOTH true — collapsing them
  // (syncing-over-stale precedence) would un-null KpiStrip's stale KPI cells
  // during a sync. The banner gate (allStale && !syncing) lives at the call
  // site and still suppresses correctly.
  it("a stale key that is ALSO syncing reports allStale=true AND syncing=true", () => {
    const f = deriveSyncFreshness(
      [key({ last_sync_at: iso(3 * 24 * HOUR), sync_status: "syncing" })],
      NOW,
    );
    expect(f.allStale).toBe(true);
    expect(f.syncing).toBe(true);
  });

  it("syncing=true when any active key is mid-sync", () => {
    const f = deriveSyncFreshness(
      [key({ last_sync_at: iso(HOUR) }), key({ sync_status: "syncing" })],
      NOW,
    );
    expect(f.syncing).toBe(true);
    expect(f.allStale).toBe(false); // one key is fresh
  });

  it("ignores inactive keys", () => {
    const f = deriveSyncFreshness(
      [
        key({ last_sync_at: iso(HOUR) }),
        key({ is_active: false, last_sync_at: iso(10 * 24 * HOUR), sync_status: "syncing" }),
      ],
      NOW,
    );
    expect(f.allStale).toBe(false);
    expect(f.syncing).toBe(false); // the syncing key is inactive
  });

  it("lastSyncAt is the max successful sync across active keys", () => {
    const f = deriveSyncFreshness(
      [key({ last_sync_at: iso(5 * HOUR) }), key({ last_sync_at: iso(2 * HOUR) })],
      NOW,
    );
    expect(f.lastSyncAt).toBe(iso(2 * HOUR));
  });

  it("cutoff boundary is strict (< cutoff): at-cutoff is fresh, past is stale", () => {
    expect(
      deriveSyncFreshness([key({ last_sync_at: iso(SYNC_STALE_CUTOFF_MS) })], NOW).allStale,
    ).toBe(false);
    expect(
      deriveSyncFreshness([key({ last_sync_at: iso(SYNC_STALE_CUTOFF_MS + 1000) })], NOW)
        .allStale,
    ).toBe(true);
  });

  it("no active keys: allStale=false (caller renders EmptyState, not a stale cue)", () => {
    const f = deriveSyncFreshness([key({ is_active: false })], NOW);
    expect(f.allStale).toBe(false);
    expect(f.syncing).toBe(false);
    expect(f.lastSyncAt).toBeNull();
  });
});
