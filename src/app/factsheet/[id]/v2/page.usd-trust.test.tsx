/** @vitest-environment jsdom */
/**
 * Phase 164.6.6.2.1 round 1, CR-02 — PAGE-LEVEL guard for the public factsheet
 * lane: the per-request trust tier is overlaid on the USD view's payload as well
 * as the native one.
 *
 * The cached builder passes `trustTier: null` into BOTH payloads of a native-unit
 * strategy, and the page overlays the real tier after the cache. Overlaying only
 * the outer payload left `usdView.payload.trustTier` null, so a viewer who toggled
 * to USD saw "Data source" lose its tier. The helper has its own unit test; this
 * one pins that the PAGE uses it. The builder is stubbed to return a payload that
 * carries a USD view (building a real one needs a stored BTC close history, which
 * is not what this guard is about); the unstable_cache double is a plain store so
 * the cached wrapper still runs.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: vi.fn() }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("notFound() called");
  },
}));
vi.mock("next/cache", () => ({
  unstable_cache: (fn: (...args: unknown[]) => Promise<unknown>) => fn,
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
vi.mock("@/lib/factsheet/fetch-and-build-payload", async () => {
  const actual = await vi.importActual<typeof import("@/lib/factsheet/fetch-and-build-payload")>(
    "@/lib/factsheet/fetch-and-build-payload",
  );
  return { ...actual, fetchAndBuildPayloadWithReason: vi.fn() };
});

import FactsheetV2Page from "./page";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { readPublicVerificationSignals } from "@/lib/queries";
import { fetchAndBuildPayloadWithReason } from "@/lib/factsheet/fetch-and-build-payload";
import type { FactsheetPayload } from "@/lib/factsheet/types";

const STRATEGY_ID = "51a10001-0000-4000-8000-0000000000e3";

function builtNativePayload(): FactsheetPayload {
  const usd = { strategyId: STRATEGY_ID, trustTier: null, returnsUnit: "USD", convertedFrom: "BTC" };
  return {
    strategyId: STRATEGY_ID,
    strategyName: "Synthetic BTC Account",
    trustTier: null,
    returnsUnit: "BTC",
    ingestSource: "api",
    strategyMetrics: { cagr: 0.1 },
    usdView: { payload: usd, convertedFrom: "BTC" },
  } as unknown as FactsheetPayload;
}

function mockRequestClient() {
  const chain = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: () =>
      Promise.resolve({
        data: {
          id: STRATEGY_ID,
          name: "Synthetic BTC Account",
          codename: null,
          disclosure_tier: "exploratory",
          strategy_analytics: { computed_at: "2026-09-01T00:00:00.000Z" },
        },
        error: null,
      }),
  };
  return { from: () => chain, auth: { getUser: () => Promise.resolve({ data: { user: null } }) } };
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

async function renderWithTier(trust_tier: string | null) {
  vi.mocked(readPublicVerificationSignals).mockResolvedValue(
    new Map(trust_tier ? [[STRATEGY_ID, { trust_tier, status: "verified" }]] : []) as never,
  );
  const jsx = await FactsheetV2Page({ params: Promise.resolve({ id: STRATEGY_ID }) });
  const payload = findPayload(jsx);
  expect(payload, "the page did not hand FactsheetView a payload").not.toBeNull();
  return payload!;
}

beforeEach(() => {
  vi.mocked(createClient).mockResolvedValue(mockRequestClient() as never);
  vi.mocked(createAdminClient).mockReturnValue({} as unknown as SupabaseClient);
  vi.mocked(fetchAndBuildPayloadWithReason).mockResolvedValue({
    payload: builtNativePayload(),
    reason: null,
  } as never);
});

describe("CR-02 — the public factsheet lane overlays the trust tier on both unit payloads", () => {
  it("api_verified reaches the native payload AND usdView.payload", async () => {
    const payload = await renderWithTier("api_verified");
    expect(payload.trustTier).toBe("api_verified");
    expect(payload.usdView!.payload.trustTier).toBe("api_verified");
  });

  it("no published signal leaves both null (the view never invents a tier)", async () => {
    const payload = await renderWithTier(null);
    expect(payload.trustTier).toBeNull();
    expect(payload.usdView!.payload.trustTier).toBeNull();
  });
});
