import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  countCompositeMembers,
  resolveStrategyShape,
  type CompositeMemberCount,
} from "./strategy-shape";

/**
 * Phase 167.2 / KCS-21, KCS-23 — the one strategy-shape predicate.
 *
 * WHY IT MATTERS: the shape picks the owner's remedy and whether the key card
 * offers a control that rewrites `strategies.api_key_id`. A possible composite
 * resolved as "single" would be offered that control and silently become a
 * single-key strategy, so an unknowable member count must resolve to
 * "unknown" (T-167.2-01-06). Expected shapes are typed as literals here.
 */

const SID = "00000000-0000-4000-8000-000000000001";
const KEY_ID = "00000000-0000-4000-8000-000000000002";

const count = (n: number): CompositeMemberCount => ({ ok: true, count: n });
const unknownCount: CompositeMemberCount = { ok: false, message: "boom" };

describe("resolveStrategyShape", () => {
  it("source csv -> csv, whatever the count", () => {
    expect(resolveStrategyShape({ source: "csv", apiKeyId: null, memberCount: count(0) })).toBe("csv");
    expect(resolveStrategyShape({ source: "csv", apiKeyId: KEY_ID, memberCount: count(3) })).toBe("csv");
    expect(resolveStrategyShape({ source: "csv", apiKeyId: null, memberCount: unknownCount })).toBe("csv");
  });

  it("an unknowable member count -> unknown, never single (even with a linked key)", () => {
    expect(resolveStrategyShape({ source: "api", apiKeyId: KEY_ID, memberCount: unknownCount })).toBe("unknown");
    expect(resolveStrategyShape({ source: null, apiKeyId: null, memberCount: unknownCount })).toBe("unknown");
  });

  it("a member count above zero -> composite", () => {
    expect(resolveStrategyShape({ source: "api", apiKeyId: null, memberCount: count(3) })).toBe("composite");
    expect(resolveStrategyShape({ source: "api", apiKeyId: KEY_ID, memberCount: count(1) })).toBe("composite");
  });

  it("count 0 with a linked key -> single", () => {
    expect(resolveStrategyShape({ source: "api", apiKeyId: KEY_ID, memberCount: count(0) })).toBe("single");
  });

  it("count 0 without a linked key -> unlinked", () => {
    expect(resolveStrategyShape({ source: "api", apiKeyId: null, memberCount: count(0) })).toBe("unlinked");
    expect(resolveStrategyShape({ source: undefined, apiKeyId: undefined, memberCount: count(0) })).toBe("unlinked");
  });
});

/** A client double recording the table, the select options and the filter. */
function clientDouble(result: unknown, opts: { throwOn?: "from" | "eq" } = {}) {
  const calls = {
    table: null as string | null,
    selectCols: null as string | null,
    selectOpts: null as unknown,
    eq: [] as Array<[string, unknown]>,
  };
  const builder = {
    select(cols: string, o: unknown) {
      calls.selectCols = cols;
      calls.selectOpts = o;
      return builder;
    },
    eq(col: string, val: unknown) {
      if (opts.throwOn === "eq") throw new Error("builder exploded");
      calls.eq.push([col, val]);
      return Promise.resolve(result);
    },
  };
  const client = {
    from(table: string) {
      if (opts.throwOn === "from") throw new Error("client exploded");
      calls.table = table;
      return builder;
    },
  };
  return { client: client as unknown as SupabaseClient, calls };
}

describe("countCompositeMembers", () => {
  it("{ count: 2, error: null } -> ok with count 2, via a strategy_keys head count on the strategy", async () => {
    const { client, calls } = clientDouble({ count: 2, error: null, data: null });
    await expect(countCompositeMembers(client, SID)).resolves.toEqual({ ok: true, count: 2 });
    expect(calls.table).toBe("strategy_keys");
    expect(calls.selectOpts).toEqual({ count: "exact", head: true });
    expect(calls.eq).toEqual([["strategy_id", SID]]);
  });

  it("{ count: 0 } is a real zero, ok", async () => {
    const { client } = clientDouble({ count: 0, error: null });
    await expect(countCompositeMembers(client, SID)).resolves.toEqual({ ok: true, count: 0 });
  });

  it("a null count with no error is NOT a zero -> ok false", async () => {
    const { client } = clientDouble({ count: null, error: null });
    const r = await countCompositeMembers(client, SID);
    expect(r.ok).toBe(false);
  });

  it("an error -> ok false carrying the message", async () => {
    const { client } = clientDouble({ count: null, error: { message: "permission denied" } });
    const r = await countCompositeMembers(client, SID);
    expect(r).toEqual({ ok: false, message: "strategy_keys count failed: permission denied" });
  });

  it("a throwing builder or client -> ok false, never a throw", async () => {
    for (const throwOn of ["from", "eq"] as const) {
      const { client } = clientDouble({ count: 1, error: null }, { throwOn });
      const r = await countCompositeMembers(client, SID);
      expect(r.ok).toBe(false);
    }
  });

  it("end to end: a null count resolves to unknown, never single", async () => {
    const { client } = clientDouble({ count: null, error: null });
    const memberCount = await countCompositeMembers(client, SID);
    expect(resolveStrategyShape({ source: "api", apiKeyId: KEY_ID, memberCount })).toBe("unknown");
  });
});
