/** @vitest-environment jsdom */
/**
 * 167.2.1-REVIEW WR-02 — the public factsheet cache answers for the analytics
 * run it was built from, so /strategies' "right now" share notes are true.
 *
 * THE DEFECT. `/strategies` decides a published row's note with a FRESH probe
 * (the builder's own resolve stage): no note when the factsheet builds, a
 * PUBLIC-UNBUILDABLE line when it does not. The recipient of that link reads
 * `buildFactsheetPayloadCached`, whose effective key was the strategy id ONLY
 * (`["factsheet-v2-payload-vN", id]`; the `::computedAt` suffix the page
 * passed in was split off and discarded, DEF-148-A). `unstable_cache` also
 * stores a `null`. So for up to the 3600 s TTL:
 *   - a placeholder `null` cached before a compute finished kept being served
 *     after it finished, while the list showed no note ("the link shows your
 *     factsheet"), and
 *   - a payload cached before a recompute that left the series unbuildable kept
 *     being served, while the list said the link shows "not available".
 * Nothing revalidated the entry on a compute: the only `revalidateTag` for it
 * is the admin review route's, and the writer of `strategy_analytics` is the
 * Python worker, which cannot reach Next's cache.
 *
 * THE FIX, and why it is the root one: `computed_at` is a real `keyParts`
 * member, the fix shape DEF-148-A recorded. The analytics finalizer stamps
 * `computed_at = now()` on every successful run, so every compute that can
 * change what the builder answers moves the key and forces a fresh build.
 * The key stays viewer-independent: `computed_at` is a property of the row.
 *
 * THE DOUBLE. `unstable_cache` is replaced by a store keyed the way Next keys
 * it (`keyParts` plus the call's args; the callback's source text is constant
 * here, so it is omitted), which stores a `null` exactly as Next does. The
 * builder, the visibility predicate and the payload are REAL. An identity stub
 * (`(fn) => fn`) would make every case below vacuous: nothing would be cached.
 *
 * All ids, names and figures are synthetic.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: vi.fn() }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("notFound() called");
  },
}));

const cacheStore = vi.hoisted(() => new Map<string, unknown>());
const cacheKeys = vi.hoisted(() => [] as unknown[][]);
vi.mock("next/cache", () => ({
  unstable_cache:
    (fn: (...args: unknown[]) => Promise<unknown>, keyParts: unknown[]) =>
    async (...args: unknown[]) => {
      cacheKeys.push(keyParts);
      const key = JSON.stringify([keyParts, args]);
      if (cacheStore.has(key)) return cacheStore.get(key);
      // A throw propagates before the store, as Next's miss path does
      // (`unstable_cache` awaits the callback before `cacheNewResult`).
      const value = await fn(...args);
      cacheStore.set(key, value); // a null is stored too, as Next stores it
      return value;
    },
}));
vi.mock("@/lib/visibility", () => ({
  withPublishedOnly: (qb: unknown) => qb,
  withPublishedOrOwner: (qb: unknown) => qb,
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/queries", () => ({
  readPublicVerificationSignals: vi.fn(),
}));

import FactsheetV2Page, { generateMetadata } from "./page";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { readPublicVerificationSignals } from "@/lib/queries";
import { captureToSentry } from "@/lib/sentry-capture";
import type { FactsheetPayload } from "@/lib/factsheet/types";

const STRATEGY_ID = "51a10001-0000-4000-8000-0000000000d2";

/** A real, buildable 10-point cash series. */
const CASH_DAILY = Array.from({ length: 10 }, (_, i) => ({
  date: `2025-08-${String(i + 1).padStart(2, "0")}`,
  value: ((i % 5) - 2) / 100,
}));

function adminRow(analytics: { computed_at: string; computation_status: string; daily_returns: unknown }) {
  return {
    id: STRATEGY_ID,
    name: "Synthetic Published",
    codename: null,
    disclosure_tier: "exploratory",
    status: "published",
    markets: ["BTC"],
    strategy_types: ["momentum"],
    description: null,
    subtypes: [],
    supported_exchanges: ["binance"],
    leverage_range: null,
    aum: null,
    max_capacity: null,
    avg_daily_turnover: null,
    start_date: null,
    benchmark: null,
    asset_class: "crypto",
    returns_denominator_config: null,
    strategy_analytics: {
      returns_series: null,
      data_quality_flags: {},
      metrics_json_by_basis: null,
      ...analytics,
    },
  };
}

let adminReads = 0;

function mockAdmin(strategy: unknown, error: unknown = null): SupabaseClient {
  const from = (table: string) => {
    const chain = {
      select: () => chain,
      eq: () => chain,
      maybeSingle: () => {
        // Phase 169.1 (D-83 (a)): a single-key BUILD also reads the cash_settlement
        // conventions echo from strategy_analytics_series. One build is one
        // strategies read, so only that read is counted; the echo has no row here.
        if (table !== "strategies") return Promise.resolve({ data: null, error: null });
        adminReads += 1;
        return Promise.resolve(error ? { data: null, error } : { data: strategy, error: null });
      },
    };
    return chain;
  };
  return { from } as unknown as SupabaseClient;
}

/**
 * The outer signature probe (the published lane hits), carrying computed_at and,
 * since 166.3.1 D-05, computation_status (a null status is a row with no status).
 */
function mockRequestClient(
  computedAt: string,
  computationStatus: string | null,
  tradeFacts: { trades_fetched_at?: string | null; series_provenance?: unknown } = {},
) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: () =>
      Promise.resolve({
        data: {
          id: STRATEGY_ID,
          name: "Synthetic Published",
          codename: null,
          disclosure_tier: "exploratory",
          strategy_analytics: { computed_at: computedAt, computation_status: computationStatus, ...tradeFacts },
        },
        error: null,
      }),
  };
  return { from: () => chain };
}

function findPayload(node: unknown): FactsheetPayload | null {
  if (node == null || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = findPayload(child);
      if (hit) return hit;
    }
    return null;
  }
  const el = node as { props?: { payload?: unknown; children?: unknown } };
  if (el.props?.payload != null) return el.props.payload as FactsheetPayload;
  return findPayload(el.props?.children ?? null);
}

/**
 * One public request: the row as the signature probe and the builder see it now.
 * `probeStatus` overrides what the signature probe reports (default: the row's
 * status), so a row with no status can be keyed without changing what the builder reads.
 */
async function request(
  analytics: { computed_at: string; computation_status: string; daily_returns: unknown },
  adminError: unknown = null,
  tradeFacts: { trades_fetched_at?: string | null; series_provenance?: unknown } = {},
  probeStatus: string | null = analytics.computation_status,
) {
  vi.mocked(createClient).mockResolvedValue(
    mockRequestClient(analytics.computed_at, probeStatus, tradeFacts) as never,
  );
  vi.mocked(createAdminClient).mockReturnValue(mockAdmin(adminRow(analytics), adminError));
  return FactsheetV2Page({ params: Promise.resolve({ id: STRATEGY_ID }) });
}

const T0 = "2026-09-01T00:00:00.000Z";
const T1 = "2026-09-02T00:00:00.000Z";

beforeEach(() => {
  cacheStore.clear();
  cacheKeys.length = 0;
  adminReads = 0;
  vi.mocked(readPublicVerificationSignals).mockResolvedValue(
    new Map([[STRATEGY_ID, { trust_tier: "api_verified", status: "verified" }]]) as never,
  );
});

describe("WR-02 — the public factsheet cache is keyed by the analytics run it was built from", () => {
  it("CACHED-NULL-THEN-COMPUTED: a placeholder cached while computing is not served once the compute finishes", async () => {
    // Request 1: the row is still computing, so the builder withholds and the
    // cache stores the null.
    const pending = await request({ computed_at: T0, computation_status: "computing", daily_returns: CASH_DAILY });
    expect(findPayload(pending)).toBeNull();

    // Request 2: the compute finished (the finalizer stamped a new
    // computed_at). /strategies' probe now says "buildable" and shows no note,
    // so the link must show the factsheet, not the cached placeholder.
    const done = await request({ computed_at: T1, computation_status: "complete", daily_returns: CASH_DAILY });
    expect(findPayload(done), "the cached placeholder outlived the compute").not.toBeNull();
  });

  it("CACHED-PAYLOAD-THEN-UNBUILDABLE: a payload cached before a recompute that left the series unbuildable is not served", async () => {
    const built = await request({ computed_at: T0, computation_status: "complete", daily_returns: CASH_DAILY });
    expect(findPayload(built)).not.toBeNull();

    // The recompute stored ONE dated return. /strategies now says the link
    // shows "not available"; the link must agree.
    const recomputed = await request({
      computed_at: T1,
      computation_status: "complete",
      daily_returns: CASH_DAILY.slice(0, 1),
    });
    expect(findPayload(recomputed), "the cached payload outlived the recompute").toBeNull();
  });

  it("SAME-RUN-STILL-CACHED (control): two requests for the same analytics run build once", async () => {
    // The fix keys the cache by run; it must not stop caching.
    const first = await request({ computed_at: T0, computation_status: "complete", daily_returns: CASH_DAILY });
    const second = await request({ computed_at: T0, computation_status: "complete", daily_returns: CASH_DAILY });
    expect(findPayload(first)).not.toBeNull();
    expect(findPayload(second)).not.toBeNull();
    expect(adminReads, "the second request was served from the cache").toBe(1);
  });

  it("READ-ERROR-NOT-CACHED (167.2.1-REVIEW-R2 WR-02): a transient admin read error renders the placeholder and is not stored for the run", async () => {
    // THE DEFECT. The callback returned the builder's `null` for a
    // `read_error`, and unstable_cache stored it under this `computed_at`, so
    // one PostgREST blip served the placeholder for the TTL while
    // /strategies' fresh probe said the link works.
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const run = { computed_at: T0, computation_status: "complete", daily_returns: CASH_DAILY };
      vi.mocked(captureToSentry).mockClear();

      // Request 1: the admin read fails. The page must not 500: it renders the
      // public placeholder sentence, uncached.
      const failed = await request(run, { message: "synthetic outage", code: "57014" });
      expect(findPayload(failed)).toBeNull();
      const { container } = render(failed as ReactElement);
      expect(container.querySelector("article p:last-child")?.textContent).toBe(
        "The detailed factsheet for this strategy is not available yet.",
      );
      // Captured once, by the resolve stage that saw it; the page adds none.
      expect(vi.mocked(captureToSentry)).toHaveBeenCalledTimes(1);
      expect(vi.mocked(captureToSentry).mock.calls[0][1]).toMatchObject({
        tags: { stage: "factsheet-resolve", reason: "read_error", code: "57014" },
      });

      // Request 2: same run, the read recovers. It must BUILD, not replay the
      // outage from the cache.
      const recovered = await request(run);
      expect(findPayload(recovered), "the read error was cached for the run").not.toBeNull();
      expect(adminReads, "both requests reached the builder").toBe(2);
    } finally {
      errSpy.mockRestore();
      warnSpy.mockRestore();
    }
  });

  it("KEY SHAPE: the key is the shape version, the id, computed_at, the two trade-fact members and computation_status, and nothing viewer-dependent", async () => {
    await request({ computed_at: T0, computation_status: "complete", daily_returns: CASH_DAILY });
    // No stamp and no provenance on the row: both members read the literal "none".
    // 166.3.1 D-05: the row's status is the last member.
    expect(cacheKeys).toEqual([["factsheet-v2-payload-v19", STRATEGY_ID, T0, "none", "none", "complete"]]);
  });
});

describe("167.1.2.2.2 plan 10 - a tick or a provenance write that leaves computed_at alone still refreshes the page", () => {
  const RUN = { computed_at: T0, computation_status: "complete", daily_returns: CASH_DAILY };
  const FETCH_1 = "2026-10-09T03:15:00+00:00";
  const FETCH_2 = "2026-10-10T03:15:00+00:00";
  const GAPS_A = { unrecovered_gaps: [{ from: "2026-05-07", to: "2026-07-08" }] };
  const GAPS_B = { unrecovered_gaps: [{ from: "2026-05-07", to: "2026-07-09" }] };

  it("TICK-MOVES-KEY: a new trades_fetched_at under the same computed_at rebuilds", async () => {
    // The daily tick stamps trades_fetched_at and may not move computed_at; a
    // cached page would keep saying "Last trades fetched 3 days ago" for the TTL.
    await request(RUN, null, { trades_fetched_at: FETCH_1 });
    await request(RUN, null, { trades_fetched_at: FETCH_2 });
    expect(adminReads, "the second request was served from the cache").toBe(2);
  });

  it("PROVENANCE-MOVES-KEY: a runbook gap write under the same computed_at rebuilds", async () => {
    await request(RUN, null, { trades_fetched_at: FETCH_1, series_provenance: GAPS_A });
    await request(RUN, null, { trades_fetched_at: FETCH_1, series_provenance: GAPS_B });
    expect(adminReads, "the second request was served from the cache").toBe(2);
  });

  it("SAME-FACTS-STILL-CACHED (control): unchanged stamp and provenance build once", async () => {
    await request(RUN, null, { trades_fetched_at: FETCH_1, series_provenance: GAPS_A });
    await request(RUN, null, { trades_fetched_at: FETCH_1, series_provenance: GAPS_A });
    expect(adminReads).toBe(1);
  });

  it("the key carries the raw stamp and a short fingerprint, never the provenance JSON itself", async () => {
    await request(RUN, null, { trades_fetched_at: FETCH_1, series_provenance: GAPS_A });
    expect(cacheKeys).toHaveLength(1);
    const [version, id, computed, stamp, fingerprint, status] = cacheKeys[0] as string[];
    expect([version, id, computed, stamp, status]).toEqual([
      "factsheet-v2-payload-v19",
      STRATEGY_ID,
      T0,
      FETCH_1,
      "complete",
    ]);
    expect(fingerprint).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe("166.3.1 D-05 - the key's last member is the row's computation_status", () => {
  it("KEY SHAPE edge: a row whose analytics embed carries no status keys on the sentinel \"none\", never on undefined", async () => {
    // JSON drops `undefined` from an array's key and `join` renders it as an
    // empty string, so an absent status must be a fixed string or two different
    // absent states would share a key with the empty slot.
    await request(
      { computed_at: T0, computation_status: "complete", daily_returns: CASH_DAILY },
      null,
      {},
      null,
    );
    expect(cacheKeys).toEqual([["factsheet-v2-payload-v19", STRATEGY_ID, T0, "none", "none", "none"]]);
  });
});

/**
 * 166.3.1 D-05 (founder, 2026-10-07, "Add status to cache key") - STATUS-MOVES-KEY.
 *
 * WHY THIS MATTERS (Rule 9). The D-05 trigger on strategy_analytics holds
 * `computed_at` on entry into `computing` and on a write to `failed`, so a
 * timestamp no longer moves on those transitions: it moves only on a
 * successful compute. Before, the job-start and failure stamps were what moved
 * this key when a complete row went `computing` or `failed`. STALE-01 withholds
 * the payload for both statuses, but the withholding lives INSIDE the cached
 * builder: a request that hits an entry built under the old status never runs
 * it. So with a key of (id, computed_at) alone, a complete payload cached at T0
 * is served for the whole 3600 s TTL to readers of a row that is `computing` or
 * `failed` at the same T0, which is the exact state STALE-01 exists to hide.
 * Only a status keyPart makes a withheld state get its own, freshly built,
 * entry. These cases fail on the (id, computed_at) key and pass on the
 * status-carrying one.
 */
describe("166.3.1 D-05 - STATUS-MOVES-KEY: a status change under a held computed_at moves the key", () => {
  for (const heldStatus of ["computing", "failed"] as const) {
    it(`STATUS-MOVES-KEY (${heldStatus}): a payload cached as complete is not served once the same computed_at reads ${heldStatus}`, async () => {
      const built = await request({ computed_at: T0, computation_status: "complete", daily_returns: CASH_DAILY });
      expect(findPayload(built)).not.toBeNull();

      // Same T0: the trigger held it. Only the status moved.
      const held = await request({ computed_at: T0, computation_status: heldStatus, daily_returns: CASH_DAILY });
      expect(findPayload(held), `a complete payload was served for a ${heldStatus} row`).toBeNull();
      expect(adminReads, "the status change reached the builder").toBe(2);
    });
  }
});

describe("164.6.6.2-07 - the share card link carries the strategy's unit as a cache key", () => {
  /** The metadata probe: the published strategy row with its analytics embed. */
  function mockMetadataClient(analytics: unknown) {
    const chain = {
      select: () => chain,
      eq: () => chain,
      maybeSingle: () =>
        Promise.resolve({
          data: {
            id: STRATEGY_ID,
            name: "Synthetic Published",
            codename: null,
            description: null,
            disclosure_tier: "exploratory",
            strategy_analytics: analytics,
          },
          error: null,
        }),
    };
    return { from: () => chain };
  }

  async function ogUrl(analytics: unknown) {
    vi.mocked(createClient).mockResolvedValue(mockMetadataClient(analytics) as never);
    const meta = await generateMetadata({ params: Promise.resolve({ id: STRATEGY_ID }) });
    const images = meta.openGraph?.images as Array<{ url: string }>;
    const twitter = meta.twitter?.images as string[];
    // Both unfurl surfaces must name the same URL.
    expect(twitter[0]).toBe(images[0].url);
    return images[0].url;
  }

  it("a BTC strategy's card URL ends ?u=BTC (object embed and array embed)", async () => {
    expect(await ogUrl({ data_quality_flags: { native_unit: "BTC" } })).toBe(
      `/api/og/factsheet/${STRATEGY_ID}?u=BTC`,
    );
    expect(await ogUrl([{ data_quality_flags: { native_unit: "BTC" } }])).toBe(
      `/api/og/factsheet/${STRATEGY_ID}?u=BTC`,
    );
  });

  it("a USD strategy's card URL is exactly what it was before this phase", async () => {
    expect(await ogUrl({ data_quality_flags: {} })).toBe(`/api/og/factsheet/${STRATEGY_ID}`);
    expect(await ogUrl(null)).toBe(`/api/og/factsheet/${STRATEGY_ID}`);
  });

  it("a malformed unit never reaches the URL", async () => {
    expect(await ogUrl({ data_quality_flags: { native_unit: "b!tc&x=1" } })).toBe(
      `/api/og/factsheet/${STRATEGY_ID}`,
    );
  });
});
