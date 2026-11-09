/** @vitest-environment jsdom */
/**
 * Phase 196 plan 16 (LEAN-02) — the tear sheet's peer-relative ranks moved onto the strategy's
 * one page, inside Advanced. WHY these arms matter: the ranks come from `getPercentiles`, which
 * uses the request client and answers per cohort, so a per-request read must never enter the
 * shared `unstable_cache` object (every later reader of the id would be served one request's
 * cohort, and a cohort change would need a cache bust). The owner lane and every mount other than
 * the published lane carry none, and the JSON-LD a crawler reads is built from the payload
 * without them.
 *
 * The builder is stubbed (it is not what this guard is about). `unstable_cache` is replaced by a
 * recorder that keeps every object its callback returns, so "never cached" is asserted on the
 * object that WOULD have been stored, not on a proxy. All ids and figures are synthetic.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, waitFor } from "@testing-library/react";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: vi.fn() }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("notFound() called");
  },
  useRouter: () => ({ refresh: vi.fn() }),
}));

/** Every object an `unstable_cache` callback returned: what the shared cache would have stored. */
const storedByCache: unknown[] = [];
vi.mock("next/cache", () => ({
  unstable_cache:
    (fn: (...args: unknown[]) => Promise<unknown>) =>
    async (...args: unknown[]) => {
      const out = await fn(...args);
      storedByCache.push(out);
      return out;
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
  getPercentiles: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ getUserRolesResult: vi.fn() }));
vi.mock("@/lib/factsheet/fetch-and-build-payload", async () => {
  const actual = await vi.importActual<typeof import("@/lib/factsheet/fetch-and-build-payload")>(
    "@/lib/factsheet/fetch-and-build-payload",
  );
  return { ...actual, fetchAndBuildPayloadWithReason: vi.fn() };
});

import FactsheetV2Page from "./page";
import { FactsheetView } from "./FactsheetView";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPercentiles, readPublicVerificationSignals } from "@/lib/queries";
import { getUserRolesResult } from "@/lib/auth";
import { fetchAndBuildPayloadWithReason } from "@/lib/factsheet/fetch-and-build-payload";
import type { FactsheetPayload } from "@/lib/factsheet/types";
import { censusPayloadA } from "./test-fixtures/census-payloads";

const STRATEGY_ID = "51a10001-0000-4000-8000-0000000000f4";
const MANAGER_ID = "aaaaaaaa-0000-4000-8000-000000000001";
const SLUG = "synthetic-momentum";
const ENTRY = { cumulative_return: 90, cagr: 71, sharpe: 82, sortino: 77, calmar: 64, max_drawdown: 58, volatility: 49 };

function builtPayload(): FactsheetPayload {
  return {
    strategyId: STRATEGY_ID,
    strategyName: "Synthetic Strategy",
    description: null,
    trustTier: null,
    ingestSource: "api",
    aum: null,
    maxCapacity: null,
    strategyMetrics: { cagr: 0.1 },
  } as unknown as FactsheetPayload;
}

/** The request client. `published` false: only the owner-inclusive probe finds the row (an unpublished own strategy). */
function mockRequestClient(user: { id: string } | null, published = true) {
  const row = {
    id: STRATEGY_ID,
    user_id: MANAGER_ID,
    name: "Synthetic Strategy",
    codename: null,
    disclosure_tier: "exploratory",
    status: published ? "published" : "draft",
    discovery_categories: { slug: SLUG },
    strategy_analytics: { computed_at: "2026-09-01T00:00:00.000Z" },
  };
  const chain = {
    select: () => chain,
    eq: () => chain,
    or: () => chain,
    maybeSingle: () => Promise.resolve({ data: row, error: null }),
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

async function request(user: { id: string } | null) {
  vi.mocked(createClient).mockResolvedValue(mockRequestClient(user) as never);
  const jsx = await FactsheetV2Page({ params: Promise.resolve({ id: STRATEGY_ID }) });
  let sent: FactsheetPayload | null = null;
  let ld = "";
  walk(jsx, (el) => {
    if (el.type === FactsheetView) sent = el.props?.payload as FactsheetPayload;
    if (el.type === "script" && el.props?.type === "application/ld+json") ld = String(el.props.children);
  });
  expect(sent, "the page did not render FactsheetView").not.toBeNull();
  return { sent: sent as unknown as FactsheetPayload, ld, jsx };
}

const cachedPayload = builtPayload();

beforeEach(() => {
  storedByCache.length = 0;
  vi.mocked(createAdminClient).mockReturnValue({} as unknown as SupabaseClient);
  vi.mocked(readPublicVerificationSignals).mockResolvedValue(new Map() as never);
  vi.mocked(getUserRolesResult).mockResolvedValue({ ok: true, roles: [] } as never);
  vi.mocked(getPercentiles).mockReset();
  vi.mocked(getPercentiles).mockResolvedValue({ [STRATEGY_ID]: ENTRY } as never);
  vi.mocked(fetchAndBuildPayloadWithReason).mockResolvedValue({
    payload: cachedPayload,
    reason: null,
  } as never);
});

describe("the factsheet's peer ranks are read per request on the published lane", () => {
  it("hands FactsheetView this strategy's entry and its category slug, scoped by that slug", async () => {
    const { sent } = await request(null);
    expect(sent.peerRanks).toEqual({ categorySlug: SLUG, percentiles: ENTRY });
    expect(getPercentiles).toHaveBeenCalledTimes(1);
    expect(getPercentiles).toHaveBeenCalledWith(SLUG);
  });

  it("never lets the read into the object the shared cache stores", async () => {
    const { sent } = await request(null);
    // The positive control: the page really did receive ranks, so the absence below is not vacuous.
    expect(sent.peerRanks).not.toBeNull();
    expect(storedByCache.length, "the cached builder never ran: the arm would pass vacuously").toBeGreaterThanOrEqual(1);
    for (const stored of storedByCache) {
      expect(stored, "peerRanks entered the shared cache").not.toHaveProperty("peerRanks");
      expect(JSON.stringify(stored)).not.toContain(String(ENTRY.sharpe));
    }
    expect(cachedPayload).not.toHaveProperty("peerRanks");
  });

  it("the JSON-LD is identical with and without ranks", async () => {
    const withRanks = await request(null);
    vi.mocked(getPercentiles).mockResolvedValue(null);
    const without = await request(null);
    expect(without.sent.peerRanks).toBeNull();
    expect(withRanks.ld.length).toBeGreaterThan(0);
    expect(withRanks.ld).toBe(without.ld);
    expect(withRanks.ld).not.toContain("peerRanks");
  });

  it("a cohort under five (getPercentiles null) leaves the section out and the page renders", async () => {
    vi.mocked(getPercentiles).mockResolvedValue(null);
    const { sent } = await request(null);
    expect(sent.peerRanks).toBeNull();
  });

  it("an id with no entry in the cohort carries no ranks", async () => {
    vi.mocked(getPercentiles).mockResolvedValue({ "another-id": ENTRY } as never);
    const { sent } = await request(null);
    expect(sent.peerRanks).toBeNull();
  });

  it("the owner lane (an unpublished own strategy) neither reads nor carries ranks", async () => {
    // The published probe misses (no session, then the owner-inclusive probe hits a draft).
    const published = mockRequestClient({ id: MANAGER_ID });
    let probes = 0;
    const client = {
      ...published,
      from: () => {
        const chain = {
          select: () => chain,
          eq: () => chain,
          or: () => chain,
          maybeSingle: () => {
            probes += 1;
            // First probe (published lane): no row. Every later read: the draft row.
            if (probes === 1) return Promise.resolve({ data: null, error: null });
            return Promise.resolve({
              data: {
                id: STRATEGY_ID,
                user_id: MANAGER_ID,
                name: "Synthetic Strategy",
                codename: null,
                disclosure_tier: "exploratory",
                status: "draft",
                strategy_analytics: { computed_at: "2026-09-01T00:00:00.000Z" },
              },
              error: null,
            });
          },
        };
        return chain;
      },
    };
    vi.mocked(createClient).mockResolvedValue(client as never);
    const jsx = await FactsheetV2Page({ params: Promise.resolve({ id: STRATEGY_ID }) });
    let sent: FactsheetPayload | null = null;
    let notice: unknown = null;
    walk(jsx, (el) => {
      if (el.type === FactsheetView) {
        sent = el.props?.payload as FactsheetPayload;
        notice = el.props?.viewerNotice;
      }
    });
    expect(notice, "the request did not take the owner lane: the arm would pass vacuously").toBe("owner_unpublished");
    expect(sent).not.toBeNull();
    expect(sent as unknown as FactsheetPayload).not.toHaveProperty("peerRanks");
    expect(getPercentiles).not.toHaveBeenCalled();
  });
});

describe("a published factsheet shows the ranks inside Advanced", () => {
  it("opening Advanced renders a Peer-relative ranks section with five badges inside the contents", async () => {
    const payload = {
      ...censusPayloadA(),
      peerRanks: { categorySlug: SLUG, percentiles: ENTRY },
    } as FactsheetPayload;
    const { container } = render(<FactsheetView payload={payload} />);
    const details = container.querySelector<HTMLDetailsElement>("details#factsheet-advanced");
    expect(details, "details#factsheet-advanced did not render").not.toBeNull();
    // Closed, the ranks are not part of the opening view (LEAN-05): Advanced mounts nothing yet,
    // and its contents line names no new section.
    expect(container.textContent).not.toContain("Peer-relative ranks");
    expect(details!.querySelector("summary")!.textContent).not.toContain("ranks");
    fireEvent.click(details!.querySelector("summary")!);
    await waitFor(() => expect(details!.querySelector("[data-advanced-contents]")).not.toBeNull());
    const contents = details!.querySelector("[data-advanced-contents]")!;
    expect(contents.textContent).toContain("Peer-relative ranks");
    expect(contents.querySelectorAll('[data-testid="percentile-rank-badge"]')).toHaveLength(5);
  });
});
