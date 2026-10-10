/**
 * Phase 164.6.6.2.1 round 1, CR-02 — PAGE-LEVEL guard for the discovery detail
 * surface: the per-request trust tier is overlaid on the USD view's payload as
 * well as the native one.
 *
 * The shared builder passes `trustTier: null` into BOTH payloads of a native-unit
 * strategy. The page overlays the real tier after the build. Overlaying only the
 * outer payload left `usdView.payload.trustTier` null, so a viewer who toggled to
 * USD saw "Data source" lose its tier. The helper has its own unit test; this one
 * pins that the PAGE uses it (a page that goes back to a hand-rolled spread
 * reddens here).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: vi.fn() }));
vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("notFound");
  }),
  redirect: vi.fn(() => {
    throw new Error("redirect");
  }),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/queries", () => ({ getStrategyDetail: vi.fn() }));
vi.mock("@/lib/factsheet/fetch-and-build-payload", () => ({
  fetchAndBuildPayloadWithReason: vi.fn(),
}));

import StrategyDetailPage from "./page";
import { createClient } from "@/lib/supabase/server";
import { getStrategyDetail } from "@/lib/queries";
import { fetchAndBuildPayloadWithReason } from "@/lib/factsheet/fetch-and-build-payload";
import { DISCOVERY_CATEGORIES } from "@/lib/constants";
import type { FactsheetPayload } from "@/lib/factsheet/types";

const STRATEGY_ID = "55555555-5555-4555-8555-555555555555";
const SLUG = DISCOVERY_CATEGORIES[0]!.slug;

function builtNativePayload(): FactsheetPayload {
  const usd = { strategyId: STRATEGY_ID, trustTier: null, returnsUnit: "USD", convertedFrom: "BTC" };
  return {
    strategyId: STRATEGY_ID,
    strategyName: "BTC Account",
    trustTier: null,
    returnsUnit: "BTC",
    usdView: { payload: usd, convertedFrom: "BTC" },
  } as unknown as FactsheetPayload;
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

beforeEach(() => {
  vi.mocked(createClient).mockResolvedValue({
    auth: { getUser: () => Promise.resolve({ data: { user: { id: "viewer-1" } } }) },
  } as never);
  vi.mocked(fetchAndBuildPayloadWithReason).mockResolvedValue({
    payload: builtNativePayload(),
    reason: null,
  } as never);
});

async function renderWithTier(trust_tier: string | null) {
  vi.mocked(getStrategyDetail).mockResolvedValue({
    strategy: { id: STRATEGY_ID, name: "BTC Account", codename: null, trust_tier },
    analytics: null,
    disclosureTier: "exploratory",
  } as never);
  const jsx = await StrategyDetailPage({ params: Promise.resolve({ slug: SLUG, strategyId: STRATEGY_ID }) });
  const payload = findPayload(jsx);
  expect(payload, "the page did not hand FactsheetView a payload").not.toBeNull();
  return payload!;
}

describe("CR-02 — discovery overlays the trust tier on both unit payloads", () => {
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
