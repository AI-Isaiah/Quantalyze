import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/database.types";

vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: vi.fn() }));

import { readOwnerTrustTier } from "./owner-trust-tier";
import { captureToSentry } from "@/lib/sentry-capture";

/**
 * Phase 237 / FACT-04 — the owner-lane tier read. Oracles are typed here as
 * literals, never imported from the module under test.
 */

const STRATEGY_ID = "55555555-5555-4555-8555-555555555555";

type Result = { data: { trust_tier: unknown } | null; error: { code?: string; message: string } | null };

/** Recording request-client double: every chained call is logged in order. */
function fakeClient(result: Result | Error) {
  const calls: Array<[string, ...unknown[]]> = [];
  const chain = {
    select: (cols: string) => {
      calls.push(["select", cols]);
      return chain;
    },
    eq: (col: string, val: string) => {
      calls.push(["eq", col, val]);
      return chain;
    },
    order: (col: string, opts: unknown) => {
      calls.push(["order", col, opts]);
      return chain;
    },
    limit: (n: number) => {
      calls.push(["limit", n]);
      return chain;
    },
    maybeSingle: () => {
      calls.push(["maybeSingle"]);
      return result instanceof Error ? Promise.reject(result) : Promise.resolve(result);
    },
  };
  const client = {
    from: (table: string) => {
      calls.push(["from", table]);
      return chain;
    },
  } as unknown as SupabaseClient<Database>;
  return { client, calls };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("readOwnerTrustTier", () => {
  it.each(["api_verified", "csv_uploaded", "self_reported"] as const)(
    "a %s row gives that tier",
    async (tier) => {
      const { client } = fakeClient({ data: { trust_tier: tier }, error: null });
      expect(await readOwnerTrustTier(client, STRATEGY_ID)).toBe(tier);
    },
  );

  it("no row gives null and reports nothing (an owner with no verification is not a failure)", async () => {
    const { client } = fakeClient({ data: null, error: null });
    expect(await readOwnerTrustTier(client, STRATEGY_ID)).toBeNull();
    expect(vi.mocked(captureToSentry)).not.toHaveBeenCalled();
  });

  it("projects exactly trust_tier and created_at, newest first, one row, filtered by strategy_id", async () => {
    const { client, calls } = fakeClient({ data: { trust_tier: "api_verified" }, error: null });
    await readOwnerTrustTier(client, STRATEGY_ID);
    expect(calls).toEqual([
      ["from", "strategy_verifications"],
      ["select", "trust_tier, created_at"],
      ["eq", "strategy_id", STRATEGY_ID],
      ["order", "created_at", { ascending: false }],
      ["limit", 1],
      ["maybeSingle"],
    ]);
  });

  it("an error result gives null, is logged, and reaches Sentry with a stage tag and no row content", async () => {
    const { client } = fakeClient({ data: null, error: { code: "42501", message: "permission denied" } });
    expect(await readOwnerTrustTier(client, STRATEGY_ID)).toBeNull();
    expect(console.error).toHaveBeenCalled();
    expect(vi.mocked(captureToSentry)).toHaveBeenCalledTimes(1);
    const [, ctx] = vi.mocked(captureToSentry).mock.calls[0];
    expect(ctx).toEqual({ tags: { route: "factsheet/v2/page", stage: "owner-trust-tier" } });
  });

  it("a thrown error gives null and never throws", async () => {
    const { client } = fakeClient(new Error("socket hang up"));
    await expect(readOwnerTrustTier(client, STRATEGY_ID)).resolves.toBeNull();
    expect(vi.mocked(captureToSentry)).toHaveBeenCalledTimes(1);
    const [, ctx] = vi.mocked(captureToSentry).mock.calls[0];
    expect(ctx).toEqual({ tags: { route: "factsheet/v2/page", stage: "owner-trust-tier" } });
  });

  it("an unknown string is null: only the three literals reach the overlay", async () => {
    const { client } = fakeClient({ data: { trust_tier: "gold_standard" }, error: null });
    expect(await readOwnerTrustTier(client, STRATEGY_ID)).toBeNull();
  });
});
