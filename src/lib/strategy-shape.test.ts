import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  compositeHistoryOf,
  countCompositeMembers,
  resolveStrategyShape,
  type CompositeMemberCount,
} from "./strategy-shape";
import { readOwnerCompositeHistory } from "./compute-jobs-read";

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

  it("167.2-REVIEW-SFH M-7: count 0 without a linked key but a stitch in its job history (or an unreadable history) -> unknown, never unlinked", () => {
    // RLS on SELECT filters rows, it does not error, so a regressed
    // `strategy_keys_owner` policy reads a composite as zero members. A
    // composite normally has no api_key_id, and its stitch_composite rows are
    // read through the SECURITY DEFINER job RPC, which that policy cannot hide.
    expect(
      resolveStrategyShape({ source: "api", apiKeyId: null, memberCount: count(0), compositeHistory: "seen" }),
    ).toBe("unknown");
    expect(
      resolveStrategyShape({ source: "api", apiKeyId: null, memberCount: count(0), compositeHistory: "unreadable" }),
    ).toBe("unknown");
    expect(
      resolveStrategyShape({ source: "api", apiKeyId: null, memberCount: count(0), compositeHistory: "none" }),
    ).toBe("unlinked");
    // A linked key is single whatever the history: a strategy converted from a
    // composite before KCS-23 keeps old stitch rows (IN-03) and must keep its
    // Resync.
    expect(
      resolveStrategyShape({ source: "api", apiKeyId: KEY_ID, memberCount: count(0), compositeHistory: "seen" }),
    ).toBe("single");
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

/**
 * 167.2-REVIEW-R2 CR-01 (round 2): the history fold had no unit case at all,
 * and its non-exhaustive arm locked an ordinary unlinked strategy out of Add
 * Key. One case per answer, then the read that feeds it.
 */
describe("compositeHistoryOf", () => {
  it("seen: a stitch_composite row is in the read", () => {
    expect(
      compositeHistoryOf({ ok: true, rows: [{ kind: "stitch_composite" }], readExhaustive: false }),
    ).toBe("seen");
  });
  it("none: an exhaustive read with no stitch", () => {
    expect(compositeHistoryOf({ ok: true, rows: [{ kind: "sync_trades" }], readExhaustive: true })).toBe("none");
  });
  it("unreadable: a failed read, a thrown read (null), or a non-exhaustive read with no stitch", () => {
    expect(compositeHistoryOf({ ok: false })).toBe("unreadable");
    expect(compositeHistoryOf(null)).toBe("unreadable");
    expect(compositeHistoryOf({ ok: true, rows: [{ kind: "sync_trades" }], readExhaustive: false })).toBe(
      "unreadable",
    );
  });
});

describe("readOwnerCompositeHistory (R2 CR-01: its own widening rule)", () => {
  const rows = (n: number, kind: string) => Array.from({ length: n }, () => ({ kind, status: "done" }));
  function rpcClient(answer: (limit: number) => { data: unknown; error: unknown }) {
    const limits: number[] = [];
    const client = {
      rpc: (_name: string, args: { p_limit: number }) => {
        limits.push(args.p_limit);
        return Promise.resolve(answer(args.p_limit));
      },
    } as unknown as SupabaseClient;
    return { client, limits };
  }

  it("100 rows with a chain row and no stitch: re-asks at 1000 and answers none when that read is exhaustive", async () => {
    const { client, limits } = rpcClient((limit) => ({
      data: [...rows(1, "sync_trades"), ...rows(limit === 1000 ? 149 : 99, "reconcile_strategy")],
      error: null,
    }));
    await expect(readOwnerCompositeHistory(client, SID)).resolves.toEqual({ history: "none", message: null });
    expect(limits).toEqual([100, 1000]);
  });

  it("a stitch in the first window answers seen without a re-ask", async () => {
    const { client, limits } = rpcClient(() => ({
      data: [...rows(1, "stitch_composite"), ...rows(99, "reconcile_strategy")],
      error: null,
    }));
    const out = await readOwnerCompositeHistory(client, SID);
    expect(out.history).toBe("seen");
    expect(limits).toEqual([100]);
  });

  it("still full at the cap with no stitch: unreadable, with a message", async () => {
    const { client } = rpcClient((limit) => ({
      data: [...rows(1, "sync_trades"), ...rows(limit - 1, "reconcile_strategy")],
      error: null,
    }));
    const out = await readOwnerCompositeHistory(client, SID);
    expect(out.history).toBe("unreadable");
    expect(out.message).toMatch(/full at the RPC cap/);
  });

  it("a failed re-ask, a failed first read and a throw are unreadable; it never throws", async () => {
    const failedWide = rpcClient((limit) =>
      limit === 1000
        ? { data: null, error: { message: "synthetic" } }
        : { data: [...rows(1, "sync_trades"), ...rows(99, "reconcile_strategy")], error: null },
    );
    expect((await readOwnerCompositeHistory(failedWide.client, SID)).history).toBe("unreadable");
    const failedFirst = rpcClient(() => ({ data: null, error: { message: "synthetic" } }));
    expect((await readOwnerCompositeHistory(failedFirst.client, SID)).history).toBe("unreadable");
    const throwing = {
      rpc: () => {
        throw new Error("synthetic throw");
      },
    } as unknown as SupabaseClient;
    const out = await readOwnerCompositeHistory(throwing, SID);
    expect(out.history).toBe("unreadable");
    expect(out.message).toMatch(/threw/);
  });

  it("a first read passed in is reused, not repeated", async () => {
    const { client, limits } = rpcClient(() => ({ data: [], error: null }));
    const out = await readOwnerCompositeHistory(client, SID, {
      ok: true,
      rows: [{ kind: "sync_trades" }],
      readExhaustive: true,
      windowFull: false,
    });
    expect(out).toEqual({ history: "none", message: null });
    expect(limits).toEqual([]);
  });
});
