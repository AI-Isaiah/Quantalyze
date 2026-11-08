/** @vitest-environment jsdom */
/**
 * 194 D-22 (FOUNDER-DECIDED 2026-11-08, security audit O-2) — PAGE-LEVEL guard: the public
 * factsheet shows AUM (the header chip and the JSON-LD `feesAndCommissionsSpecification`)
 * only to a signed-in allocator or the strategy's own manager, the same rule as the
 * tearsheet's AUM row (D-06). WHY it matters: the JSON-LD is read by crawlers anonymously and
 * the chip by any visitor, and the founder ruled AUM is for allocators and the manager only.
 *
 * The decision is per viewer, but `payload.aum` rides the id-keyed shared cache. So the page
 * must hand FactsheetView/JSON-LD a per-request `showAum` and must NOT strip or add AUM on the
 * cached object. The last case pins that: two viewers on the SAME cached payload object get
 * different answers, and the object still carries its `aum` afterwards.
 *
 * The builder is stubbed (it is not what this guard is about). All ids and figures are
 * synthetic.
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
vi.mock("@/lib/auth", () => ({ getUserRolesResult: vi.fn() }));
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
import { getUserRolesResult } from "@/lib/auth";
import { fetchAndBuildPayloadWithReason } from "@/lib/factsheet/fetch-and-build-payload";
import type { FactsheetPayload } from "@/lib/factsheet/types";

const STRATEGY_ID = "51a10001-0000-4000-8000-0000000000f4";
const MANAGER_ID = "aaaaaaaa-0000-4000-8000-000000000001";
const OTHER_ID = "bbbbbbbb-0000-4000-8000-000000000002";
const AUM = 4_200_000;

function builtPayload(): FactsheetPayload {
  return {
    strategyId: STRATEGY_ID,
    strategyName: "Synthetic Strategy",
    description: null,
    trustTier: null,
    ingestSource: "api",
    aum: AUM,
    maxCapacity: null,
    strategyMetrics: { cagr: 0.1 },
  } as unknown as FactsheetPayload;
}

function mockRequestClient(user: { id: string } | null) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: () =>
      Promise.resolve({
        data: {
          id: STRATEGY_ID,
          user_id: MANAGER_ID,
          name: "Synthetic Strategy",
          codename: null,
          disclosure_tier: "exploratory",
          strategy_analytics: { computed_at: "2026-09-01T00:00:00.000Z" },
        },
        error: null,
      }),
  };
  return { from: () => chain, auth: { getUser: () => Promise.resolve({ data: { user }, error: null }) } };
}

type El = { type?: unknown; props?: { children?: unknown; [k: string]: unknown } };

function walk(node: unknown, visit: (el: El) => void): void {
  if (node == null || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit);
    return;
  }
  const el = node as El;
  visit(el);
  walk(el.props?.children ?? null, visit);
}

/** One request by `user`; returns the element's `showAum` prop and the emitted JSON-LD. */
async function request(user: { id: string } | null) {
  vi.mocked(createClient).mockResolvedValue(mockRequestClient(user) as never);
  const jsx = await FactsheetV2Page({ params: Promise.resolve({ id: STRATEGY_ID }) });
  let showAum: unknown = "unset";
  let sentAum: unknown = "unset";
  let ld: Record<string, unknown> | null = null;
  walk(jsx, (el) => {
    if (el.props && "showAum" in el.props) {
      showAum = el.props.showAum;
      sentAum = (el.props.payload as { aum?: unknown } | undefined)?.aum;
    }
    if (el.type === "script" && el.props?.type === "application/ld+json") {
      ld = JSON.parse(String(el.props.children));
    }
  });
  expect(ld, "the page did not emit JSON-LD").not.toBeNull();
  return { showAum, sentAum, ld: ld as unknown as Record<string, unknown> };
}

const cachedPayload = builtPayload();

beforeEach(() => {
  vi.mocked(createAdminClient).mockReturnValue({} as unknown as SupabaseClient);
  vi.mocked(readPublicVerificationSignals).mockResolvedValue(new Map() as never);
  vi.mocked(getUserRolesResult).mockReset();
  vi.mocked(getUserRolesResult).mockResolvedValue({ ok: true, roles: [] } as never);
  vi.mocked(fetchAndBuildPayloadWithReason).mockResolvedValue({
    payload: cachedPayload,
    reason: null,
  } as never);
});

describe("D-22 — AUM on the public factsheet follows D-06", () => {
  it("an anonymous visitor (and a crawler) sees no AUM chip and no AUM in the JSON-LD", async () => {
    const { showAum, ld } = await request(null);
    expect(showAum).toBe(false);
    expect(ld.feesAndCommissionsSpecification).toBeUndefined();
    expect(JSON.stringify(ld)).not.toContain(String(AUM));
    expect(getUserRolesResult).not.toHaveBeenCalled();
  });

  it("a signed-in non-allocator sees none", async () => {
    vi.mocked(getUserRolesResult).mockResolvedValue({ ok: true, roles: ["quant_manager"] } as never);
    const { showAum, ld } = await request({ id: OTHER_ID });
    expect(showAum).toBe(false);
    expect(ld.feesAndCommissionsSpecification).toBeUndefined();
  });

  it("a signed-in allocator sees the chip and the JSON-LD AUM", async () => {
    vi.mocked(getUserRolesResult).mockResolvedValue({ ok: true, roles: ["allocator"] } as never);
    const { showAum, ld } = await request({ id: OTHER_ID });
    expect(showAum).toBe(true);
    expect(ld.feesAndCommissionsSpecification).toBe(`AUM ${AUM}`);
  });

  it("the strategy's own manager sees both, with no roles read", async () => {
    const { showAum, ld } = await request({ id: MANAGER_ID });
    expect(showAum).toBe(true);
    expect(ld.feesAndCommissionsSpecification).toBe(`AUM ${AUM}`);
    expect(getUserRolesResult).not.toHaveBeenCalled();
  });

  it("a failed roles read fails closed: no AUM (a blip must hide, never leak)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(getUserRolesResult).mockResolvedValue({ ok: false, error: new Error("blip") } as never);
    const failed = await request({ id: OTHER_ID });
    expect(failed.showAum).toBe(false);
    expect(failed.ld.feesAndCommissionsSpecification).toBeUndefined();

    vi.mocked(getUserRolesResult).mockRejectedValue(new Error("roles exploded"));
    const thrown = await request({ id: OTHER_ID });
    expect(thrown.showAum).toBe(false);
    expect(thrown.ld.feesAndCommissionsSpecification).toBeUndefined();
  });

  it("the decision is per request: one cached payload, two viewers, two answers, payload untouched", async () => {
    vi.mocked(getUserRolesResult).mockResolvedValue({ ok: true, roles: ["allocator"] } as never);
    const allocator = await request({ id: OTHER_ID });
    const anonymous = await request(null);
    expect(allocator.showAum).toBe(true);
    expect(anonymous.showAum).toBe(false);
    // D-22 (security review): the payload serialised to the client must not carry AUM either,
    // or a hidden chip still leaks the figure through the page data.
    expect(allocator.sentAum).toBe(AUM);
    expect(anonymous.sentAum).toBeNull();
    // Nothing stripped or added on the object the shared cache serves.
    expect(cachedPayload.aum).toBe(AUM);
  });
});
