import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Phase 196 plan 16 — `readPeerRanks` / `withPeerRanks`. WHY: the ranks are read per request
 * on the public lane, so the read must stay published-only (a draft's category is not public),
 * must fail soft (a blip drops the section, never the page) and must report the failure, or a
 * broken read looks like "no rank to show". `withPeerRanks` must reach the USD view's payload
 * too, or the ranks would vanish when the viewer toggles the unit.
 */

vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: vi.fn() }));
vi.mock("@/lib/queries", () => ({ getPercentiles: vi.fn() }));

import { readPeerRanks, withPeerRanks } from "./peer-ranks";
import { getPercentiles } from "@/lib/queries";
import { captureToSentry } from "@/lib/sentry-capture";
import type { FactsheetPayload } from "./types";

const ID = "51a10001-0000-4000-8000-0000000000f4";
const ENTRY = { cumulative_return: 90, cagr: 71, sharpe: 82, sortino: 77, calmar: 64, max_drawdown: 58, volatility: 49 };

/** A request client whose one query answers `result`; records the filters applied. */
function client(result: { data: unknown; error: unknown } | Error) {
  const eqs: [string, unknown][] = [];
  const chain = {
    select: () => chain,
    eq: (col: string, val: unknown) => {
      eqs.push([col, val]);
      return chain;
    },
    maybeSingle: () => (result instanceof Error ? Promise.reject(result) : Promise.resolve(result)),
  };
  return { supabase: { from: () => chain } as unknown as SupabaseClient, eqs };
}

beforeEach(() => {
  vi.mocked(getPercentiles).mockReset();
  vi.mocked(captureToSentry).mockReset();
});

describe("readPeerRanks", () => {
  it("returns the category slug and this strategy's entry, scoped by that slug, from a published-only read", async () => {
    vi.mocked(getPercentiles).mockResolvedValue({ [ID]: ENTRY, other: ENTRY } as never);
    const { supabase, eqs } = client({ data: { discovery_categories: { slug: "momentum" } }, error: null });
    await expect(readPeerRanks(supabase, ID)).resolves.toEqual({ categorySlug: "momentum", percentiles: ENTRY });
    expect(getPercentiles).toHaveBeenCalledWith("momentum");
    expect(eqs).toContainEqual(["id", ID]);
    expect(eqs, "the category read was not published-only").toContainEqual(["status", "published"]);
  });

  it("a strategy with no category ranks against every published strategy (undefined slug)", async () => {
    vi.mocked(getPercentiles).mockResolvedValue({ [ID]: ENTRY } as never);
    const { supabase } = client({ data: { discovery_categories: null }, error: null });
    await expect(readPeerRanks(supabase, ID)).resolves.toEqual({ categorySlug: null, percentiles: ENTRY });
    expect(getPercentiles).toHaveBeenCalledWith(undefined);
  });

  it("a category read error returns null and reports once, naming the step", async () => {
    const { supabase } = client({ data: null, error: { message: "boom", code: "XX000" } });
    await expect(readPeerRanks(supabase, ID)).resolves.toBeNull();
    expect(captureToSentry).toHaveBeenCalledTimes(1);
    expect(vi.mocked(captureToSentry).mock.calls[0][1]).toMatchObject({
      tags: { area: "factsheet-peer-ranks", step: "category_read" },
    });
    expect(getPercentiles, "the cohort read ran after a failed category read").not.toHaveBeenCalled();
  });

  it("a read that throws returns null and reports once (the page must still render)", async () => {
    const { supabase } = client(new Error("network"));
    await expect(readPeerRanks(supabase, ID)).resolves.toBeNull();
    expect(captureToSentry).toHaveBeenCalledTimes(1);
  });

  it("no published row returns null", async () => {
    const { supabase } = client({ data: null, error: null });
    await expect(readPeerRanks(supabase, ID)).resolves.toBeNull();
    expect(getPercentiles).not.toHaveBeenCalled();
    expect(captureToSentry).not.toHaveBeenCalled();
  });

  it("a cohort under five (getPercentiles null) and an id with no entry both return null, with no report from here", async () => {
    const { supabase } = client({ data: { discovery_categories: { slug: "momentum" } }, error: null });
    vi.mocked(getPercentiles).mockResolvedValue(null);
    await expect(readPeerRanks(supabase, ID)).resolves.toBeNull();
    vi.mocked(getPercentiles).mockResolvedValue({ other: ENTRY } as never);
    await expect(readPeerRanks(supabase, ID)).resolves.toBeNull();
    expect(captureToSentry).not.toHaveBeenCalled();
  });
});

describe("withPeerRanks", () => {
  const ranks = { categorySlug: "momentum", percentiles: ENTRY };

  it("overlays the ranks on the payload without mutating it, keeping the discriminant", () => {
    const native = { strategyId: ID, ingestSource: "api" } as unknown as FactsheetPayload;
    const out = withPeerRanks(native, ranks);
    expect(out.peerRanks).toBe(ranks);
    expect(out.ingestSource).toBe("api");
    expect(native).not.toHaveProperty("peerRanks");
  });

  it("reaches the USD view's payload too, so the unit toggle does not drop the ranks", () => {
    const inner = { strategyId: ID } as unknown as FactsheetPayload;
    const native = { strategyId: ID, usdView: { payload: inner } } as unknown as FactsheetPayload;
    const out = withPeerRanks(native, ranks);
    expect(out.usdView!.payload.peerRanks).toBe(ranks);
    expect(inner).not.toHaveProperty("peerRanks");
  });

  it("null overlays null (an explicit absence, not a missing key)", () => {
    const out = withPeerRanks({ strategyId: ID } as unknown as FactsheetPayload, null);
    expect(out.peerRanks).toBeNull();
  });
});
