/**
 * Phase 170.6.1.1 (ANONKEYID) review round 1 - WR-01 / SFH-1 / SFH-2.
 *
 * WHY THIS FILE EXISTS. PR-B revokes the anon column grant on `strategies`. From
 * then on a PostgREST 42501 on any of the three anonymous readers is an
 * EXPECTED class of failure (a column added to the projection without a grant, a
 * wildcard regression). Before this fix each reader collapsed that error into a
 * value the page renders as a normal state:
 *
 *   getStrategiesByCategory -> [] (an empty category, no Sentry)
 *   getPublicStrategyDetail -> null (a 404 and a "not found" unfurl, no log)
 *   getFactsheetDetail      -> null (a 404 tearsheet, no log)
 *
 * so the outage was invisible and indistinguishable from "no such strategy".
 * The contract pinned here: a genuine "no row" (PGRST116) stays a quiet null,
 * and EVERY other error is captured to Sentry and THROWN so the route's error
 * boundary engages instead of a fake empty page.
 *
 * The error shape is a real PostgREST permission failure (code 42501), typed in
 * by hand, never derived from the code under test.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const seeded = vi.hoisted(() => ({
  error: null as { code: string; message: string } | null,
  sentry: [] as Array<{ err: unknown; opts: unknown }>,
  queries: 0,
}));

vi.mock("@/lib/sentry-capture", () => ({
  captureToSentry: (err: unknown, opts: unknown) => {
    seeded.sentry.push({ err, opts });
  },
}));

const buildChain = () => {
  seeded.queries += 1;
  const chain: Record<string, unknown> = {};
  chain.select = () => chain;
  chain.eq = () => chain;
  chain.order = () => chain;
  chain.limit = () => chain;
  // `.single()` readers (detail + tearsheet)
  chain.single = () => Promise.resolve({ data: null, error: seeded.error });
  chain.maybeSingle = () => Promise.resolve({ data: null, error: null });
  // LIST reader awaits the builder itself
  chain.then = (onFulfilled: (v: { data: unknown; error: unknown }) => unknown) =>
    Promise.resolve({ data: null, error: seeded.error }).then(onFulfilled);
  return chain;
};

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => buildChain(),
    rpc: async () => ({ data: [], error: null }),
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => buildChain(),
    rpc: async () => ({ data: [], error: null }),
  }),
}));

import { getStrategiesByCategory, getPublicStrategyDetail, getFactsheetDetail } from "./queries";

const PERMISSION_DENIED = { code: "42501", message: "permission denied for table strategies" };
// What PostgREST answers when a non-UUID string is compared to a uuid column.
const INVALID_UUID = {
  code: "22P02",
  message: 'invalid input syntax for type uuid: "not-a-uuid"',
};
const STRATEGY_ID = "3f2a9c1e-7b4d-4e8a-9c21-5d6e7f8a9b0c";
const NO_ROW = {
  code: "PGRST116",
  message: "JSON object requested, multiple (or no) rows returned",
};

beforeEach(() => {
  seeded.error = null;
  seeded.sentry = [];
  seeded.queries = 0;
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("getStrategiesByCategory - a read error is not an empty category", () => {
  it("throws on a 42501 and reports it to Sentry with the op and the code", async () => {
    seeded.error = PERMISSION_DENIED;
    await expect(getStrategiesByCategory("crypto-sma")).rejects.toThrow(
      /getStrategiesByCategory.*crypto-sma.*failed/,
    );
    expect(seeded.sentry).toHaveLength(1);
    expect(seeded.sentry[0].opts).toEqual({
      tags: { op: "getStrategiesByCategory", code: "42501" },
      level: "error",
    });
  });

  it("still returns [] and stays quiet for a genuinely empty category", async () => {
    seeded.error = null;
    // data: null with no error is the mock's "no rows" answer
    await expect(getStrategiesByCategory("crypto-sma")).resolves.toEqual([]);
    expect(seeded.sentry).toHaveLength(0);
  });
});

describe("getPublicStrategyDetail - a read error is not a 404", () => {
  it("resolves a non-UUID id to null with no query and no Sentry event (a truncated share link is a 404, not an outage)", async () => {
    // Were it queried, the database would answer 22P02, which is not PGRST116.
    seeded.error = INVALID_UUID;
    await expect(getPublicStrategyDetail("not-a-uuid")).resolves.toBeNull();
    expect(seeded.queries).toBe(0);
    expect(seeded.sentry).toHaveLength(0);
  });

  it("throws on a 42501 and reports it to Sentry", async () => {
    seeded.error = PERMISSION_DENIED;
    await expect(getPublicStrategyDetail(STRATEGY_ID)).rejects.toThrow(
      /getPublicStrategyDetail.*3f2a9c1e-7b4d-4e8a-9c21-5d6e7f8a9b0c.*failed/,
    );
    expect(seeded.sentry).toHaveLength(1);
    expect(seeded.sentry[0].opts).toEqual({
      tags: { op: "getPublicStrategyDetail", code: "42501" },
      level: "error",
    });
  });

  it("returns null and stays quiet for PGRST116 (no such published strategy)", async () => {
    seeded.error = NO_ROW;
    await expect(getPublicStrategyDetail(STRATEGY_ID)).resolves.toBeNull();
    expect(seeded.sentry).toHaveLength(0);
  });
});

describe("getFactsheetDetail - a read error is not a 404", () => {
  it("resolves a non-UUID id to null with no query and no Sentry event (a truncated share link is a 404, not an outage)", async () => {
    // Were it queried, the database would answer 22P02, which is not PGRST116.
    seeded.error = INVALID_UUID;
    await expect(getFactsheetDetail("not-a-uuid")).resolves.toBeNull();
    expect(seeded.queries).toBe(0);
    expect(seeded.sentry).toHaveLength(0);
  });

  it("throws on a 42501 and reports it to Sentry", async () => {
    seeded.error = PERMISSION_DENIED;
    await expect(getFactsheetDetail(STRATEGY_ID)).rejects.toThrow(
      /getFactsheetDetail.*3f2a9c1e-7b4d-4e8a-9c21-5d6e7f8a9b0c.*failed/,
    );
    expect(seeded.sentry).toHaveLength(1);
    expect(seeded.sentry[0].opts).toEqual({
      tags: { op: "getFactsheetDetail", code: "42501" },
      level: "error",
    });
  });

  it("returns null and stays quiet for PGRST116 (no such published strategy)", async () => {
    seeded.error = NO_ROW;
    await expect(getFactsheetDetail(STRATEGY_ID)).resolves.toBeNull();
    expect(seeded.sentry).toHaveLength(0);
  });
});
