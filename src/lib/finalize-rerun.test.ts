import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { decideFinalizeRerun } from "./finalize-rerun";

// finalize-rerun reads the cash echo through composite-read-path, which imports
// `server-only` (a Next.js RSC build guard that throws outside a server build).
vi.mock("server-only", () => ({}));

/**
 * Truth table for the wizard-finalize re-run decision (phase 190, SC-2).
 *
 * ORACLE INDEPENDENCE: every status, kind and reason below is a hand-typed
 * literal. Nothing is imported from compute-state or closed-sets, so widening
 * either set cannot silently widen the policy this file pins.
 *
 * The invariant under test: a NEEDED run is never dropped. Each "queues" row
 * is a way finalize could otherwise leave a strategy that never computes.
 */

const NOW = Date.parse("2026-11-03T12:00:00Z");
const HOUR = 60 * 60 * 1000;

interface Fake {
  admin: SupabaseClient;
  /** Table names passed to from(), in order. */
  froms: string[];
  /** `.in(column, values)` calls on the compute_jobs read. */
  ins: Array<{ column: string; values: unknown }>;
}

function fakeAdmin(opts: {
  analytics?: { data: unknown; error: unknown } | "throw";
  jobs?: { data: unknown; error: unknown } | "throw";
  /** api_keys.created_at of the linked key (single-key input read). */
  apiKey?: { data: unknown; error: unknown } | "throw";
  /** strategy_keys.created_at rows (composite input read). */
  members?: { data: unknown; error: unknown } | "throw";
  /** The cash_settlement series row's `conventions` (the stored annualization). */
  conventions?: { data: unknown; error: unknown } | "throw";
  /** The latest done stitch_composite job (composite currency read). */
  stitchJob?: { data: unknown; error: unknown } | "throw";
}): Fake {
  const froms: string[] = [];
  const ins: Array<{ column: string; values: unknown }> = [];
  const admin = {
    from: (table: string) => {
      froms.push(table);
      if (table === "strategy_analytics") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => {
                if (opts.analytics === "throw") throw new Error("boom analytics");
                return opts.analytics ?? { data: null, error: null };
              },
            }),
          }),
        };
      }
      if (table === "api_keys") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => {
                if (opts.apiKey === "throw") throw new Error("boom api_keys");
                return opts.apiKey ?? { data: { created_at: KEY_AT }, error: null };
              },
            }),
          }),
        };
      }
      if (table === "strategy_analytics_series") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => {
                  if (opts.conventions === "throw") throw new Error("boom series");
                  return (
                    opts.conventions ?? {
                      data: { conventions: { periods_per_year: 252 } },
                      error: null,
                    }
                  );
                },
              }),
            }),
          }),
        };
      }
      if (table === "strategy_keys") {
        return {
          select: () => ({
            eq: async () => {
              if (opts.members === "throw") throw new Error("boom strategy_keys");
              return opts.members ?? { data: [{ created_at: KEY_AT }], error: null };
            },
          }),
        };
      }
      if (table === "compute_jobs") {
        const chain = {
          eq: () => chain,
          order: () => chain,
          limit: () => chain,
          maybeSingle: async () => {
            if (opts.stitchJob === "throw") throw new Error("boom stitch job");
            return opts.stitchJob ?? { data: { created_at: STITCH_AT }, error: null };
          },
          in: (column: string, values: unknown) => {
            ins.push({ column, values });
            return chain;
          },
          then: (onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) => {
            if (opts.jobs === "throw") {
              return Promise.reject(new Error("boom jobs")).then(onFulfilled, onRejected);
            }
            return Promise.resolve(opts.jobs ?? { data: [], error: null }).then(
              onFulfilled,
              onRejected,
            );
          },
        };
        return { select: () => ({ eq: () => chain }) };
      }
      throw new Error(`unexpected from(${table})`);
    },
  } as unknown as SupabaseClient;
  return { admin, froms, ins };
}

// Inputs created BEFORE the analytics were computed: the stored result saw them.
const KEY_AT = "2026-11-01T00:00:00Z";
// The stitch that produced COMPUTED_AT was ENQUEUED between the two: it read its
// members after KEY_AT and stamped its result at COMPUTED_AT.
const STITCH_AT = "2026-11-01T12:00:00Z";
const COMPUTED_AT = "2026-11-02T00:00:00Z";
const AFTER_COMPUTE = "2026-11-02T06:00:00Z";
const COMPLETE = { computation_status: "complete", computed_at: COMPUTED_AT };

const BASE = { assetClassChanged: false, assetClass: "traditional", composite: false, apiKeyId: "k1", nowMs: NOW };

function job(over: Record<string, unknown>) {
  return {
    kind: "sync_trades",
    status: "running",
    attempts: 1,
    max_attempts: 5,
    created_at: new Date(NOW - 1 * HOUR).toISOString(),
    ...over,
  };
}

describe("decideFinalizeRerun", () => {
  it("queues without reading anything when finalize changed asset_class (a hop on the old clock would publish the wrong annualization)", async () => {
    const f = fakeAdmin({ analytics: { data: COMPLETE, error: null } });
    const d = await decideFinalizeRerun(f.admin, "s1", { ...BASE, assetClassChanged: true });
    expect(d).toEqual({ enqueue: true, reason: "asset_class_changed" });
    expect(f.froms).toEqual([]);
  });

  it("skips when analytics are complete: the wizard's own sync already finished the chain", async () => {
    const f = fakeAdmin({ analytics: { data: COMPLETE, error: null } });
    const d = await decideFinalizeRerun(f.admin, "s1", BASE);
    expect(d).toEqual({ enqueue: false, reason: "already_current" });
    // A terminal success answers on the first read; the jobs table is never asked.
    // A current terminal success is answered by the analytics row and the
    // linked key; the jobs table is never asked.
    expect(f.froms).toEqual(["strategy_analytics", "api_keys", "strategy_analytics_series"]);
  });

  // The next rows are the reason the skip is not "any terminal success": the
  // stored result only covers inputs that existed when it was computed.
  it("queues when the linked key was created AFTER computed_at: the stored result never saw that key", async () => {
    const f = fakeAdmin({
      analytics: { data: COMPLETE, error: null },
      apiKey: { data: { created_at: AFTER_COMPUTE }, error: null },
    });
    const d = await decideFinalizeRerun(f.admin, "s1", BASE);
    expect(d).toEqual({ enqueue: true, reason: "inputs_changed" });
  });

  it("queues when computed_at is missing on a terminal success: currency cannot be proven", async () => {
    const f = fakeAdmin({
      analytics: { data: { computation_status: "complete", computed_at: null }, error: null },
    });
    const d = await decideFinalizeRerun(f.admin, "s1", BASE);
    expect(d).toEqual({ enqueue: true, reason: "inputs_changed" });
  });

  it("queues when the linked key row or its timestamp is missing", async () => {
    const noRow = fakeAdmin({
      analytics: { data: COMPLETE, error: null },
      apiKey: { data: null, error: null },
    });
    expect(await decideFinalizeRerun(noRow.admin, "s1", BASE)).toEqual({
      enqueue: true,
      reason: "inputs_changed",
    });
    const noKeyId = fakeAdmin({ analytics: { data: COMPLETE, error: null } });
    expect(
      await decideFinalizeRerun(noKeyId.admin, "s1", { ...BASE, apiKeyId: null }),
    ).toEqual({ enqueue: true, reason: "inputs_changed" });
  });

  it("queues and names api_keys when the key read errors or throws", async () => {
    const err = { message: "denied" };
    const errored = fakeAdmin({
      analytics: { data: COMPLETE, error: null },
      apiKey: { data: null, error: err },
    });
    expect(await decideFinalizeRerun(errored.admin, "s1", BASE)).toEqual({
      enqueue: true,
      reason: "read_failed",
      failedRead: "api_keys",
      error: err,
    });
    const thrown = fakeAdmin({ analytics: { data: COMPLETE, error: null }, apiKey: "throw" });
    expect(await decideFinalizeRerun(thrown.admin, "s1", BASE)).toMatchObject({
      enqueue: true,
      reason: "read_failed",
      failedRead: "api_keys",
    });
  });

  it("composite: skips when every member predates computed_at", async () => {
    const f = fakeAdmin({
      analytics: { data: COMPLETE, error: null },
      members: { data: [{ created_at: KEY_AT }, { created_at: KEY_AT }], error: null },
    });
    const d = await decideFinalizeRerun(f.admin, "s1", { ...BASE, composite: true, apiKeyId: null });
    expect(d).toEqual({ enqueue: false, reason: "already_current" });
    expect(f.froms).toEqual(["strategy_analytics", "strategy_keys", "compute_jobs", "strategy_analytics_series"]);
  });

  it("composite: queues when ANY member was added after computed_at (the set changed since the last stitch)", async () => {
    const f = fakeAdmin({
      analytics: { data: COMPLETE, error: null },
      members: { data: [{ created_at: KEY_AT }, { created_at: AFTER_COMPUTE }], error: null },
    });
    const d = await decideFinalizeRerun(f.admin, "s1", { ...BASE, composite: true, apiKeyId: null });
    expect(d).toEqual({ enqueue: true, reason: "inputs_changed" });
  });

  // Review round 1 (CR-02). `computed_at` is stamped when the stitch WRITES, but
  // the stitch read its members near its START. A member changed while it ran is
  // older than computed_at, yet the stored result never saw it.
  it("composite: queues when a member changed AFTER the producing stitch started but BEFORE computed_at", async () => {
    const MID_RUN = "2026-11-01T18:00:00Z"; // STITCH_AT < MID_RUN < COMPUTED_AT
    const f = fakeAdmin({
      analytics: { data: COMPLETE, error: null },
      members: { data: [{ created_at: KEY_AT }, { created_at: MID_RUN }], error: null },
    });
    const d = await decideFinalizeRerun(f.admin, "s1", { ...BASE, composite: true, apiKeyId: null });
    expect(d).toEqual({ enqueue: true, reason: "inputs_changed" });
  });

  // Review round 1 (WR-02). A request-local "asset_class changed" flag is lost on
  // a retry (the first request committed the write, then was rejected), so the
  // decision compares the strategy's current clock with the one stored with the
  // result. Hand-typed periods: 365 crypto, 252 traditional.
  it("queues when the stored result was annualized on another clock than the current asset class, with no request-local change flag", async () => {
    const f = fakeAdmin({
      analytics: { data: COMPLETE, error: null },
      conventions: { data: { conventions: { periods_per_year: 252 } }, error: null },
    });
    const d = await decideFinalizeRerun(f.admin, "s1", { ...BASE, assetClass: "crypto" });
    expect(d).toEqual({ enqueue: true, reason: "asset_class_changed" });
  });

  it("skips when the stored annualization matches the current asset class", async () => {
    const f = fakeAdmin({
      analytics: { data: COMPLETE, error: null },
      conventions: { data: { conventions: { periods_per_year: 365 } }, error: null },
    });
    const d = await decideFinalizeRerun(f.admin, "s1", { ...BASE, assetClass: "crypto" });
    expect(d).toEqual({ enqueue: false, reason: "already_current" });
  });

  it("queues when no annualization is stored with the result, or the read fails", async () => {
    const none = fakeAdmin({
      analytics: { data: COMPLETE, error: null },
      conventions: { data: null, error: null },
    });
    expect(await decideFinalizeRerun(none.admin, "s1", BASE)).toEqual({
      enqueue: true,
      reason: "inputs_changed",
    });
    const errored = fakeAdmin({
      analytics: { data: COMPLETE, error: null },
      conventions: { data: null, error: { message: "denied" } },
    });
    expect(await decideFinalizeRerun(errored.admin, "s1", BASE)).toMatchObject({
      enqueue: true,
      reason: "read_failed",
      failedRead: "strategy_analytics_series",
    });
    const thrown = fakeAdmin({
      analytics: { data: COMPLETE, error: null },
      conventions: "throw",
    });
    expect(await decideFinalizeRerun(thrown.admin, "s1", BASE)).toMatchObject({
      enqueue: true,
      reason: "read_failed",
      failedRead: "strategy_analytics_series",
    });
  });

  it("composite: queues when the producing stitch job is absent or unreadable", async () => {
    const opts = { ...BASE, composite: true, apiKeyId: null };
    const absent = fakeAdmin({
      analytics: { data: COMPLETE, error: null },
      stitchJob: { data: null, error: null },
    });
    expect(await decideFinalizeRerun(absent.admin, "s1", opts)).toEqual({
      enqueue: true,
      reason: "inputs_changed",
    });
    const err = { message: "denied" };
    const errored = fakeAdmin({
      analytics: { data: COMPLETE, error: null },
      stitchJob: { data: null, error: err },
    });
    expect(await decideFinalizeRerun(errored.admin, "s1", opts)).toMatchObject({
      enqueue: true,
      reason: "read_failed",
      failedRead: "compute_jobs",
    });
    const thrown = fakeAdmin({
      analytics: { data: COMPLETE, error: null },
      stitchJob: "throw",
    });
    expect(await decideFinalizeRerun(thrown.admin, "s1", opts)).toMatchObject({
      enqueue: true,
      reason: "read_failed",
      failedRead: "compute_jobs",
    });
  });

  it("composite: queues when the member list is empty or unreadable", async () => {
    const empty = fakeAdmin({
      analytics: { data: COMPLETE, error: null },
      members: { data: [], error: null },
    });
    const opts = { ...BASE, composite: true, apiKeyId: null };
    expect(await decideFinalizeRerun(empty.admin, "s1", opts)).toEqual({
      enqueue: true,
      reason: "inputs_changed",
    });
    const err = { message: "denied" };
    const errored = fakeAdmin({
      analytics: { data: COMPLETE, error: null },
      members: { data: null, error: err },
    });
    expect(await decideFinalizeRerun(errored.admin, "s1", opts)).toEqual({
      enqueue: true,
      reason: "read_failed",
      failedRead: "strategy_keys",
      error: err,
    });
    const thrown = fakeAdmin({ analytics: { data: COMPLETE, error: null }, members: "throw" });
    expect(await decideFinalizeRerun(thrown.admin, "s1", opts)).toMatchObject({
      failedRead: "strategy_keys",
    });
  });

  it("skips when analytics are complete_with_warnings: a warned success is still computed, an exact match on 'complete' would re-run it", async () => {
    const f = fakeAdmin({
      analytics: {
        data: { ...COMPLETE, computation_status: "complete_with_warnings" },
        error: null,
      },
    });
    const d = await decideFinalizeRerun(f.admin, "s1", BASE);
    expect(d).toEqual({ enqueue: false, reason: "already_current" });
  });

  it("queues when there is no analytics row and no job: the strategy was never computed", async () => {
    const f = fakeAdmin({ analytics: { data: null, error: null } });
    const d = await decideFinalizeRerun(f.admin, "s1", BASE);
    expect(d).toEqual({ enqueue: true, reason: "no_terminal_success" });
  });

  it.each(["pending", "computing", "failed"])(
    "queues when the row is %s and nothing is in flight: an unfinished or failed strategy needs its run",
    async (status) => {
      const f = fakeAdmin({ analytics: { data: { computation_status: status }, error: null } });
      const d = await decideFinalizeRerun(f.admin, "s1", BASE);
      expect(d).toEqual({ enqueue: true, reason: "no_terminal_success" });
    },
  );

  it("skips when a live running sync_trades job is in flight over a computing row: that run will land the factsheet", async () => {
    const f = fakeAdmin({
      analytics: { data: { computation_status: "computing" }, error: null },
      jobs: { data: [job({ status: "running" })], error: null },
    });
    const d = await decideFinalizeRerun(f.admin, "s1", BASE);
    expect(d).toEqual({ enqueue: false, reason: "chain_in_flight" });
  });

  it("queues when the only in-flight job has spent its attempts: a dead job is not evidence the run will finish", async () => {
    const f = fakeAdmin({
      analytics: { data: { computation_status: "pending" }, error: null },
      jobs: {
        data: [job({ status: "failed_retry", attempts: 5, max_attempts: 5 })],
        error: null,
      },
    });
    const d = await decideFinalizeRerun(f.admin, "s1", BASE);
    expect(d).toEqual({ enqueue: true, reason: "no_terminal_success" });
  });

  it("queues when the only in-flight job is 9 hours old: past the 8 h live window the worker has dropped it", async () => {
    const f = fakeAdmin({
      analytics: { data: { computation_status: "pending" }, error: null },
      jobs: {
        data: [job({ status: "pending", created_at: new Date(NOW - 9 * HOUR).toISOString() })],
        error: null,
      },
    });
    const d = await decideFinalizeRerun(f.admin, "s1", BASE);
    expect(d).toEqual({ enqueue: true, reason: "no_terminal_success" });
  });

  it("skips when one dead and one live job are in flight: a single live job is enough", async () => {
    const f = fakeAdmin({
      analytics: { data: null, error: null },
      jobs: {
        data: [
          job({ status: "failed_retry", attempts: 5, max_attempts: 5 }),
          job({ kind: "derive_broker_dailies", status: "pending" }),
        ],
        error: null,
      },
    });
    const d = await decideFinalizeRerun(f.admin, "s1", BASE);
    expect(d).toEqual({ enqueue: false, reason: "chain_in_flight" });
  });

  it("queues and names strategy_analytics when its read errors: a failed read is not 'already current'", async () => {
    const err = { message: "permission denied" };
    const f = fakeAdmin({ analytics: { data: null, error: err } });
    const d = await decideFinalizeRerun(f.admin, "s1", BASE);
    expect(d).toEqual({
      enqueue: true,
      reason: "read_failed",
      failedRead: "strategy_analytics",
      error: err,
    });
  });

  it("queues and names compute_jobs when its read errors", async () => {
    const err = { message: "timeout" };
    const f = fakeAdmin({
      analytics: { data: { computation_status: "pending" }, error: null },
      jobs: { data: null, error: err },
    });
    const d = await decideFinalizeRerun(f.admin, "s1", BASE);
    expect(d).toMatchObject({ enqueue: true, reason: "read_failed", failedRead: "compute_jobs", error: err });
  });

  it("queues and names compute_jobs when the jobs read answers null with no error: unknowable is not 'nothing in flight'", async () => {
    const f = fakeAdmin({
      analytics: { data: { computation_status: "pending" }, error: null },
      jobs: { data: null, error: null },
    });
    const d = await decideFinalizeRerun(f.admin, "s1", BASE);
    expect(d).toMatchObject({ enqueue: true, reason: "read_failed", failedRead: "compute_jobs" });
  });

  it("puts stitch_composite in the kind filter for a composite finalize", async () => {
    const f = fakeAdmin({ analytics: { data: null, error: null } });
    await decideFinalizeRerun(f.admin, "s1", { ...BASE, composite: true });
    const kinds = f.ins.find((i) => i.column === "kind")?.values as string[];
    expect(kinds).toContain("stitch_composite");
    expect(kinds).toContain("sync_trades");
  });

  it("leaves stitch_composite out of the kind filter for a single-key finalize", async () => {
    const f = fakeAdmin({ analytics: { data: null, error: null } });
    await decideFinalizeRerun(f.admin, "s1", BASE);
    const kinds = f.ins.find((i) => i.column === "kind")?.values as string[];
    expect(kinds).not.toContain("stitch_composite");
    expect(kinds).toContain("sync_trades");
  });

  it("filters the jobs read to the in-flight statuses only", async () => {
    const f = fakeAdmin({ analytics: { data: null, error: null } });
    await decideFinalizeRerun(f.admin, "s1", BASE);
    const statuses = f.ins.find((i) => i.column === "status")?.values as string[];
    expect([...statuses].sort()).toEqual(["done_pending_children", "failed_retry", "pending", "running"]);
  });

  it("queues and does not throw when the analytics read throws", async () => {
    const f = fakeAdmin({ analytics: "throw" });
    const d = await decideFinalizeRerun(f.admin, "s1", BASE);
    expect(d).toMatchObject({ enqueue: true, reason: "read_failed", failedRead: "strategy_analytics" });
  });

  it("queues and does not throw when the jobs read throws", async () => {
    const f = fakeAdmin({
      analytics: { data: { computation_status: "pending" }, error: null },
      jobs: "throw",
    });
    const d = await decideFinalizeRerun(f.admin, "s1", BASE);
    expect(d).toMatchObject({ enqueue: true, reason: "read_failed", failedRead: "compute_jobs" });
  });
});
