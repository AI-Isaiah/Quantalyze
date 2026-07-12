import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import type { NextRequest } from "next/server";

/**
 * Cron route handler tests for /api/cron/cleanup-wizard-drafts.
 *
 * Rewritten in 96-03 for the single-RPC contract. The route no longer does a
 * SELECT-then-DELETE two-step plus a per-key `delete_api_key_if_unreferenced`
 * orphan-sweep loop — the DB now owns atomicity: the route makes exactly ONE
 * `rpc("cleanup_abandoned_wizard_drafts")` call (SECURITY DEFINER, shipped in
 * 96-02) and shapes the monitor-stable response.
 *
 * Coverage (5 behaviors):
 *   1. Auth — missing/wrong CRON_SECRET → 401; unset env → 401.
 *   2. Auth — safeCompare (timing-safe) is the comparator, reached on an
 *      equal-length wrong bearer; a `true` return alone accepts the request.
 *   3. Happy path — valid bearer → `rpc` called EXACTLY ONCE with
 *      "cleanup_abandoned_wizard_drafts" and no args; the RETURNS TABLE row
 *      `[{deleted_drafts, swept_keys}]` maps to
 *      `{deleted, orphaned_keys_revoked, key_sweep_errors: 0}`.
 *   4. Zero-work run — `[{deleted_drafts:0, swept_keys:0}]` → the same uniform
 *      shape so a monitor reads `key_sweep_errors` identically across clean runs.
 *   5. RPC error — a PostgREST error → 500 with a GENERIC body (the raw SQL
 *      detail must NOT reach the wire — least-disclosure) while console.error
 *      still carries the detail for ops. Plus a purity assertion: the route
 *      touches NO table (`from` is never called) and issues NO
 *      `delete_api_key_if_unreferenced` RPC — the loop is gone.
 *
 * `import "server-only"` (transitively via @/lib/supabase/admin) throws under
 * jsdom; stubbing it lets the route module import cleanly. Each test uses
 * `vi.resetModules()` + `vi.doMock()` so the mocked admin client is fresh per
 * case (the route reads CRON_SECRET at call time, but the supabase mock is
 * captured at route import).
 */

// `import "server-only"` throws in jsdom. Stubbing it lets the route import.
vi.mock("server-only", () => ({}));

// ---------------------------------------------------------------------------
// Types & helpers
// ---------------------------------------------------------------------------

type RpcResult = { data: unknown; error: { message: string } | null };

interface Recorders {
  // Every rpc(fn, args) the route invokes. The single-RPC contract means this
  // must contain exactly one { fn: "cleanup_abandoned_wizard_drafts" } entry
  // and NOTHING for the obsolete "delete_api_key_if_unreferenced" loop.
  rpcCalls: Array<{ fn: string; args: unknown }>;
  // Every .from(table). The single-RPC route must never build a table chain —
  // this stays empty. (The obsolete route hit "strategies" twice.)
  fromCalls: string[];
  // The seeded result the mocked rpc() resolves with.
  rpcResult: RpcResult;
}

function makeRecorders(): Recorders {
  return {
    rpcCalls: [],
    fromCalls: [],
    rpcResult: { data: [{ deleted_drafts: 0, swept_keys: 0 }], error: null },
  };
}

function makeReq(headers: Record<string, string> = {}): NextRequest {
  return {
    headers: {
      get: (key: string) => headers[key.toLowerCase()] ?? null,
    },
  } as unknown as NextRequest;
}

/**
 * Minimal admin-client stub for the single-RPC route:
 *   - `rpc(fn, args)` records the call and resolves the seeded result.
 *   - `from(table)` records the table then returns an inert thenable chain.
 *     The single-RPC route never calls it (asserted via `fromCalls`); the
 *     chain exists only so an accidental/obsolete table path resolves to an
 *     empty result instead of throwing, keeping the purity assertion the
 *     signal rather than an unhandled TypeError.
 */
function createSupabaseMock(recorders: Recorders) {
  return {
    rpc(fn: string, args?: unknown) {
      recorders.rpcCalls.push({ fn, args });
      return Promise.resolve(recorders.rpcResult);
    },
    from(table: string) {
      recorders.fromCalls.push(table);
      const chain: Record<string, unknown> = {};
      for (const m of ["select", "delete", "eq", "lt", "is", "in"]) {
        chain[m] = () => chain;
      }
      chain.then = (
        onFulfilled: (v: {
          data: never[];
          error: null;
          count: number;
        }) => unknown,
      ) => Promise.resolve({ data: [], error: null, count: 0 }).then(onFulfilled);
      return chain;
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe.each([
  ["GET"],
  ["POST"],
] as const)("%s /api/cron/cleanup-wizard-drafts", (verb) => {
  const originalSecret = process.env.CRON_SECRET;
  let recorders: Recorders;

  beforeEach(() => {
    process.env.CRON_SECRET = "cron-secret-at-least-16-chars";
    recorders = makeRecorders();
    vi.resetModules();
    // Silence the route's bare console.error (Sentry-deferral pattern) plus the
    // success-path console.info/console.warn observability logs (96-FIX-1).
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    // doUnmock is needed because vi.doMock registrations are NOT cleared by
    // vi.resetModules. Tests that mock these modules (e.g., the safeCompare
    // test) would otherwise leak their mocks into later tests in the same
    // suite, all of which would 401 on the auth gate.
    vi.doUnmock("@/lib/supabase/admin");
    vi.doUnmock("@/lib/timing-safe-compare");
    vi.resetModules();
    if (originalSecret) process.env.CRON_SECRET = originalSecret;
    else delete process.env.CRON_SECRET;
  });

  async function getHandler(): Promise<
    (req: NextRequest) => Promise<Response>
  > {
    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => createSupabaseMock(recorders),
    }));
    const mod = await import("./route");
    return verb === "GET" ? mod.GET : mod.POST;
  }

  // --- Auth guard ---------------------------------------------------------

  it("returns 401 when CRON_SECRET is unset", async () => {
    delete process.env.CRON_SECRET;
    const handler = await getHandler();
    const res = await handler(makeReq({ authorization: "Bearer anything" }));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Unauthorized");
    // Auth guard short-circuits BEFORE any supabase call.
    expect(recorders.rpcCalls).toHaveLength(0);
    expect(recorders.fromCalls).toHaveLength(0);
  });

  it("returns 401 when the Authorization header is missing", async () => {
    const handler = await getHandler();
    const res = await handler(makeReq());
    expect(res.status).toBe(401);
    expect(recorders.rpcCalls).toHaveLength(0);
  });

  it("returns 401 when the Authorization header is wrong", async () => {
    const handler = await getHandler();
    const res = await handler(
      makeReq({ authorization: "Bearer wrong-secret-value-here-pad" }),
    );
    expect(res.status).toBe(401);
    expect(recorders.rpcCalls).toHaveLength(0);
  });

  it("uses safeCompare (timing-safe) for the bearer check, not naive ===", async () => {
    // The route imports `safeCompare` from `@/lib/timing-safe-compare`.
    // Mocking that module lets us verify the route reaches the constant-
    // time comparator on every call AND that it does NOT fall back to a
    // naive `===` (which would short-circuit on a length-mismatching
    // attacker input and leak prefix bytes via timing).
    const safeCompareSpy = vi.fn<(a: string, b: string) => boolean>(() => false);
    vi.doMock("@/lib/timing-safe-compare", () => ({
      safeCompare: safeCompareSpy,
    }));
    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => createSupabaseMock(recorders),
    }));
    const mod = await import("./route");
    const handler = verb === "GET" ? mod.GET : mod.POST;

    // Same length as `Bearer ${SECRET}` — defeats the (acceptable)
    // length-mismatch fast path inside `safeCompare` and forces the
    // route to delegate even on a wrong-but-isolength bearer.
    const expected = `Bearer ${process.env.CRON_SECRET!}`;
    const wrongSameLength = "X".repeat(expected.length);
    expect(wrongSameLength.length).toBe(expected.length);

    const resReject = await handler(
      makeReq({ authorization: wrongSameLength }),
    );
    expect(resReject.status).toBe(401);
    expect(safeCompareSpy).toHaveBeenCalledTimes(1);
    expect(safeCompareSpy).toHaveBeenCalledWith(wrongSameLength, expected);

    // Now flip the comparator to true and confirm the route accepts on
    // that signal alone (proves the gate is wired through `safeCompare`,
    // not a separate naive comparator that could short-circuit on length).
    safeCompareSpy.mockReturnValueOnce(true);
    recorders.rpcResult = {
      data: [{ deleted_drafts: 0, swept_keys: 0 }],
      error: null,
    };
    const resAccept = await handler(
      makeReq({ authorization: wrongSameLength }),
    );
    expect(resAccept.status).toBe(200);
    expect(safeCompareSpy).toHaveBeenCalledTimes(2);
  });

  // --- Happy path ---------------------------------------------------------

  it("calls the cleanup RPC exactly once and maps its row to the monitor shape", async () => {
    // RETURNS TABLE(deleted_drafts int, swept_keys int) → supabase-js returns
    // `data` as an array of one row. The route maps deleted_drafts→deleted and
    // swept_keys→orphaned_keys_revoked, and pins key_sweep_errors:0.
    recorders.rpcResult = {
      data: [{ deleted_drafts: 3, swept_keys: 2 }],
      error: null,
    };

    const handler = await getHandler();
    const res = await handler(
      makeReq({ authorization: `Bearer ${process.env.CRON_SECRET}` }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      deleted: 3,
      orphaned_keys_revoked: 2,
      key_sweep_errors: 0,
    });

    // Exactly ONE rpc call, to the atomic cleanup function, with no args.
    expect(recorders.rpcCalls).toHaveLength(1);
    expect(recorders.rpcCalls[0].fn).toBe("cleanup_abandoned_wizard_drafts");
    // No args object (or an empty one) — the window/predicate live in SQL.
    expect(recorders.rpcCalls[0].args ?? {}).toEqual({});
    // Purity: the atomic RPC owns the whole job — no table chains at all.
    expect(recorders.fromCalls).toHaveLength(0);
  });

  // --- Zero-work run ------------------------------------------------------

  it("returns the uniform monitor shape on a zero-work run", async () => {
    recorders.rpcResult = {
      data: [{ deleted_drafts: 0, swept_keys: 0 }],
      error: null,
    };

    const handler = await getHandler();
    const res = await handler(
      makeReq({ authorization: `Bearer ${process.env.CRON_SECRET}` }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    // Same keys as a work-present run so a monitor reads key_sweep_errors
    // uniformly across every clean run.
    expect(body).toEqual({
      deleted: 0,
      orphaned_keys_revoked: 0,
      key_sweep_errors: 0,
    });
    expect(recorders.rpcCalls).toHaveLength(1);
    expect(recorders.rpcCalls[0].fn).toBe("cleanup_abandoned_wizard_drafts");
  });

  // --- Observability: destructive-cron logging (96-FIX-1) -----------------

  it("logs the deleted/orphaned counts on a successful run (a destructive cron's magnitude must be observable)", async () => {
    // Vercel Cron only alerts on non-2xx, so a large SUCCESSFUL deletion is
    // invisible unless the route logs its magnitude. RED without the console.info.
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    recorders.rpcResult = {
      data: [{ deleted_drafts: 7, swept_keys: 4 }],
      error: null,
    };

    const handler = await getHandler();
    const res = await handler(
      makeReq({ authorization: `Bearer ${process.env.CRON_SECRET}` }),
    );

    expect(res.status).toBe(200);
    const loggedCounts = infoSpy.mock.calls.some((call) =>
      call.some(
        (arg) =>
          typeof arg === "string" &&
          arg.includes("deleted=7") &&
          arg.includes("orphaned_keys_revoked=4"),
      ),
    );
    expect(loggedCounts).toBe(true);
  });

  it("emits a distinct WARN when the deletion count exceeds the sanity threshold (runaway first-run is loud)", async () => {
    // 501 > CLEANUP_SANITY_WARN_THRESHOLD (500). Behavior is UNCHANGED (still 200
    // with the counts) — this is observability only, not a hard cap (a hard cap
    // mid-sweep would break the RPC's single-transaction atomicity).
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    recorders.rpcResult = {
      data: [{ deleted_drafts: 501, swept_keys: 12 }],
      error: null,
    };

    const handler = await getHandler();
    const res = await handler(
      makeReq({ authorization: `Bearer ${process.env.CRON_SECRET}` }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      deleted: 501,
      orphaned_keys_revoked: 12,
      key_sweep_errors: 0,
    });
    const warnedLarge = warnSpy.mock.calls.some((call) =>
      call.some(
        (arg) =>
          typeof arg === "string" && arg.includes("501") && /large/i.test(arg),
      ),
    );
    expect(warnedLarge).toBe(true);
  });

  it("does NOT warn when the deletion count is at or below the sanity threshold", async () => {
    // 500 is NOT > 500 — pins the threshold boundary so a future off-by-one that
    // widened the warn band (e.g. `>=`) would redden here.
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    recorders.rpcResult = {
      data: [{ deleted_drafts: 500, swept_keys: 0 }],
      error: null,
    };

    const handler = await getHandler();
    const res = await handler(
      makeReq({ authorization: `Bearer ${process.env.CRON_SECRET}` }),
    );

    expect(res.status).toBe(200);
    const warnedLarge = warnSpy.mock.calls.some((call) =>
      call.some((arg) => typeof arg === "string" && /large/i.test(arg)),
    );
    expect(warnedLarge).toBe(false);
  });

  // --- RPC error + purity -------------------------------------------------

  it("returns 500 with a GENERIC body (no raw PostgREST detail) when the RPC errors, and stays single-RPC", async () => {
    // Because the cleanup is ONE transaction, any failure fails the whole call
    // → a plain 500 (Vercel Cron alerts on non-2xx, preserving H-1251's intent
    // without the old per-key sweep machinery). The body must NOT echo the raw
    // PostgREST message — it can carry SQL state / table / constraint names;
    // the detail belongs in the log only (T-96-10 least-disclosure).
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    recorders.rpcResult = {
      data: null,
      error: {
        message:
          "update or delete on table \"api_keys\" violates foreign key constraint 23503 details relation allocator_holdings",
      },
    };

    const handler = await getHandler();
    const res = await handler(
      makeReq({ authorization: `Bearer ${process.env.CRON_SECRET}` }),
    );

    expect(res.status).toBe(500);
    const body = await res.json();
    // Generic envelope only — no SQL detail on the wire.
    expect(body.error).toBeTruthy();
    expect(JSON.stringify(body)).not.toContain("23503");
    expect(JSON.stringify(body)).not.toContain("allocator_holdings");
    expect(JSON.stringify(body)).not.toContain("foreign key constraint");

    // …but the detail MUST still be logged for ops visibility.
    const loggedRaw = errorSpy.mock.calls.some((call) =>
      call.some(
        (arg) =>
          (typeof arg === "object" &&
            arg !== null &&
            JSON.stringify(arg).includes("allocator_holdings")) ||
          (typeof arg === "string" && arg.includes("allocator_holdings")),
      ),
    );
    expect(loggedRaw).toBe(true);

    // Purity: exactly one RPC — the atomic cleanup — and NEVER the obsolete
    // per-key orphan-sweep RPC or any table chain.
    expect(recorders.rpcCalls).toHaveLength(1);
    expect(recorders.rpcCalls[0].fn).toBe("cleanup_abandoned_wizard_drafts");
    expect(
      recorders.rpcCalls.some(
        (c) => c.fn === "delete_api_key_if_unreferenced",
      ),
    ).toBe(false);
    expect(recorders.fromCalls).toHaveLength(0);
  });
});
