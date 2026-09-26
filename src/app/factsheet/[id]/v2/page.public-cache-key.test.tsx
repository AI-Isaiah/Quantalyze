/** @vitest-environment jsdom */
/**
 * 167.2.1-REVIEW WR-02 — the public factsheet cache answers for the analytics
 * run it was built from, so /strategies' "right now" share notes are true.
 *
 * THE DEFECT. `/strategies` decides a published row's note with a FRESH probe
 * (the builder's own resolve stage): no note when the factsheet builds, a
 * PUBLIC-UNBUILDABLE line when it does not. The recipient of that link reads
 * `buildFactsheetPayloadCached`, whose effective key was the strategy id ONLY
 * (`["factsheet-v2-payload-v6", id]`; the `::computedAt` suffix the page
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

import FactsheetV2Page from "./page";
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
  const from = () => {
    const chain = {
      select: () => chain,
      eq: () => chain,
      maybeSingle: () => {
        adminReads += 1;
        return Promise.resolve(error ? { data: null, error } : { data: strategy, error: null });
      },
    };
    return chain;
  };
  return { from } as unknown as SupabaseClient;
}

/** The outer signature probe (the published lane hits), carrying computed_at. */
function mockRequestClient(computedAt: string) {
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
          strategy_analytics: { computed_at: computedAt },
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

/** One public request: the row as the signature probe and the builder see it now. */
async function request(
  analytics: { computed_at: string; computation_status: string; daily_returns: unknown },
  adminError: unknown = null,
) {
  vi.mocked(createClient).mockResolvedValue(mockRequestClient(analytics.computed_at) as never);
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

  it("KEY SHAPE: the key is the shape version, the id and computed_at, and nothing viewer-dependent", async () => {
    await request({ computed_at: T0, computation_status: "complete", daily_returns: CASH_DAILY });
    expect(cacheKeys).toEqual([["factsheet-v2-payload-v7", STRATEGY_ID, T0]]);
  });
});
