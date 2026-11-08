/**
 * 194 D-22 — the discovery detail mounts the same FactsheetView, so its AUM chip follows the
 * same rule as the public factsheet and the tearsheet (D-06): a signed-in allocator or the
 * strategy's own manager sees it, anyone else does not, and a failed roles read shows none.
 * The decision reaches the view as the per-request `showAum` render prop.
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
vi.mock("@/lib/auth", () => ({ getUserRolesResult: vi.fn() }));
vi.mock("@/lib/factsheet/fetch-and-build-payload", () => ({
  fetchAndBuildPayloadWithReason: vi.fn(),
}));

import StrategyDetailPage from "./page";
import { createClient } from "@/lib/supabase/server";
import { getStrategyDetail } from "@/lib/queries";
import { getUserRolesResult } from "@/lib/auth";
import { fetchAndBuildPayloadWithReason } from "@/lib/factsheet/fetch-and-build-payload";
import { DISCOVERY_CATEGORIES } from "@/lib/constants";

const STRATEGY_ID = "55555555-5555-4555-8555-555555555556";
const MANAGER_ID = "aaaaaaaa-0000-4000-8000-000000000011";
const VIEWER_ID = "bbbbbbbb-0000-4000-8000-000000000012";
const SLUG = DISCOVERY_CATEGORIES[0]!.slug;

function findShowAum(node: unknown): unknown {
  if (node == null || typeof node !== "object") return "unset";
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = findShowAum(child);
      if (hit !== "unset") return hit;
    }
    return "unset";
  }
  const el = node as { props?: { payload?: unknown; showAum?: unknown; children?: unknown } };
  if (el.props && "showAum" in el.props && el.props.payload != null) return el.props.showAum;
  return findShowAum(el.props?.children ?? null);
}

async function renderAs(userId: string) {
  vi.mocked(createClient).mockResolvedValue({
    auth: { getUser: () => Promise.resolve({ data: { user: { id: userId } } }) },
  } as never);
  const jsx = await StrategyDetailPage({ params: Promise.resolve({ slug: SLUG, strategyId: STRATEGY_ID }) });
  return findShowAum(jsx);
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(getUserRolesResult).mockReset();
  vi.mocked(getUserRolesResult).mockResolvedValue({ ok: true, roles: [] } as never);
  vi.mocked(getStrategyDetail).mockResolvedValue({
    strategy: { id: STRATEGY_ID, user_id: MANAGER_ID, name: "Synthetic", codename: null, trust_tier: null },
    analytics: null,
    disclosureTier: "exploratory",
  } as never);
  vi.mocked(fetchAndBuildPayloadWithReason).mockResolvedValue({
    payload: { strategyId: STRATEGY_ID, strategyName: "Synthetic", trustTier: null, aum: 1_000_000 },
    reason: null,
  } as never);
});

describe("D-22 — discovery detail AUM chip follows D-06", () => {
  it("a signed-in non-allocator gets showAum=false", async () => {
    vi.mocked(getUserRolesResult).mockResolvedValue({ ok: true, roles: ["quant_manager"] } as never);
    expect(await renderAs(VIEWER_ID)).toBe(false);
  });

  it("a signed-in allocator gets showAum=true", async () => {
    vi.mocked(getUserRolesResult).mockResolvedValue({ ok: true, roles: ["allocator"] } as never);
    expect(await renderAs(VIEWER_ID)).toBe(true);
  });

  it("the strategy's own manager gets showAum=true", async () => {
    expect(await renderAs(MANAGER_ID)).toBe(true);
  });

  it("a failed roles read fails closed", async () => {
    vi.mocked(getUserRolesResult).mockResolvedValue({ ok: false, error: new Error("blip") } as never);
    expect(await renderAs(VIEWER_ID)).toBe(false);
  });
});
