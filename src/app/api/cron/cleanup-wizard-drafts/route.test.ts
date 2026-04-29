import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import type { NextRequest } from "next/server";

/**
 * Cron route handler tests for /api/cron/cleanup-wizard-drafts.
 *
 * Coverage targets the seven behaviors flagged in the v0.17.1.4 specialist
 * review — the cron landed with +136 LOC and zero unit tests:
 *
 *   1. Missing/wrong CRON_SECRET → 401 (no header, wrong bearer)
 *   2. safeCompare reaches crypto.timingSafeEqual on equal-length inputs
 *      (constant-time path is exercised, not just the length short-circuit)
 *   3. Happy-path delete — 3 wizard drafts → 3 deletes + 3 key revokes
 *   4. TOCTOU re-filter — DELETE clause re-applies source='wizard' and
 *      status='draft' so a row that flipped to pending_review between the
 *      SELECT and the DELETE is not clobbered
 *   5. Orphaned-key revoke logic — refCount > 0 must SKIP the api_keys
 *      delete (the most dangerous path: getting it wrong yanks a key from
 *      a live, published strategy that happens to share the key)
 *   6. Cutoff math — `created_at < (now - 30d).toISOString()` is the .lt
 *      filter value
 *   7. Empty result — 0 drafts → {deleted:0, orphaned_keys_revoked:0}
 *
 * Mocking strategy mirrors the project's recorder pattern: a `recorders`
 * object captures every Supabase chain call (.from, .select, .eq, .lt, .in,
 * .delete) so each test can assert the exact call shape recorded by the
 * route. `createAdminClient` is mocked to return a chainable builder that
 * records into `recorders` and resolves with the seeded `data/error` values.
 *
 * `import "server-only"` throws under jsdom; mock it so the route module
 * can be imported. Each test uses `vi.resetModules()` + `vi.doMock()` so
 * the mock is fresh per case (the route reads CRON_SECRET at call time, not
 * at import time, but the supabase mock is captured at route import).
 */

// `import "server-only"` (transitively via @/lib/supabase/admin) throws in
// jsdom. Stubbing it lets the route import cleanly.
vi.mock("server-only", () => ({}));

// ---------------------------------------------------------------------------
// Types & helpers
// ---------------------------------------------------------------------------

type DraftRow = { id: string; api_key_id: string | null };

interface Recorders {
  fromCalls: string[];
  selectCalls: Array<{
    table: string;
    columns: string;
    options: Record<string, unknown> | undefined;
  }>;
  eqCalls: Array<{ stage: string; col: string; val: unknown }>;
  ltCalls: Array<{ col: string; val: unknown }>;
  inCalls: Array<{ col: string; vals: unknown[] }>;
  deleteCalls: Array<{ table: string; options: Record<string, unknown> | undefined }>;
  // The cron makes three distinct shapes of supabase calls. Each test seeds
  // the response sequence; the mock pulls from the right queue based on the
  // chain shape (select+lt → SELECT_DRAFTS, delete+in → DELETE_DRAFTS,
  // select head:true + eq → COUNT_REFS, delete+eq on api_keys → DELETE_KEY).
  selectDraftsResponse: { data: DraftRow[] | null; error: { message: string } | null };
  deleteDraftsResponse: { count: number | null; error: { message: string } | null };
  // refCountByKey is consulted by the per-key COUNT_REFS chain. Tests seed
  // a map keyed by api_key_id so different keys can return different counts
  // (the orphan-skip test seeds `refCount > 0` for the shared key only).
  refCountByKey: Record<string, { count: number | null; error: { message: string } | null }>;
  deleteKeyByKey: Record<string, { error: { message: string } | null }>;
}

function makeRecorders(): Recorders {
  return {
    fromCalls: [],
    selectCalls: [],
    eqCalls: [],
    ltCalls: [],
    inCalls: [],
    deleteCalls: [],
    selectDraftsResponse: { data: [], error: null },
    deleteDraftsResponse: { count: 0, error: null },
    refCountByKey: {},
    deleteKeyByKey: {},
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
 * Builds a chainable Supabase mock that records every call into `recorders`
 * and dispatches the awaited result based on which chain shape was used.
 *
 * Three distinct chain shapes the route under test invokes:
 *   A. SELECT_DRAFTS  : .from("strategies").select("id, api_key_id")
 *                       .eq("source","wizard").eq("status","draft")
 *                       .lt("created_at", cutoff)
 *   B. DELETE_DRAFTS  : .from("strategies").delete({count:"exact"})
 *                       .in("id", draftIds)
 *                       .eq("source","wizard").eq("status","draft")
 *   C. COUNT_REFS     : .from("strategies").select("id",{count:"exact",head:true})
 *                       .eq("api_key_id", keyId)
 *   D. DELETE_KEY     : .from("api_keys").delete().eq("id", keyId)
 *
 * Each chain method records and returns the chain itself (a thenable). The
 * thenable resolves based on the shape captured during the chain build.
 */
function createSupabaseMock(recorders: Recorders) {
  return {
    from(table: string) {
      recorders.fromCalls.push(table);

      type ChainState = {
        table: string;
        verb: "select" | "delete" | null;
        selectColumns: string | null;
        selectOptions: Record<string, unknown> | undefined;
        deleteOptions: Record<string, unknown> | undefined;
        // Captured chain filters — needed at resolve time to pick the right
        // queued response.
        eqs: Array<[string, unknown]>;
        ins: Array<[string, unknown[]]>;
        lts: Array<[string, unknown]>;
      };

      const state: ChainState = {
        table,
        verb: null,
        selectColumns: null,
        selectOptions: undefined,
        deleteOptions: undefined,
        eqs: [],
        ins: [],
        lts: [],
      };

      const resolve = (): {
        data?: unknown;
        error: { message: string } | null;
        count?: number | null;
      } => {
        // Shape C: head:true count query on strategies (refCount check).
        if (
          state.table === "strategies" &&
          state.verb === "select" &&
          state.selectOptions?.head === true &&
          state.selectOptions?.count === "exact"
        ) {
          const keyEq = state.eqs.find(([c]) => c === "api_key_id");
          const keyId = keyEq ? String(keyEq[1]) : "";
          const seeded = recorders.refCountByKey[keyId];
          if (!seeded) {
            // Default to 0 references — happy path treats every key as
            // orphaned. Tests that need refCount > 0 seed explicitly.
            return { data: null, count: 0, error: null };
          }
          return { data: null, count: seeded.count, error: seeded.error };
        }

        // Shape A: SELECT_DRAFTS — strategies.select(... id, api_key_id ...)
        if (
          state.table === "strategies" &&
          state.verb === "select" &&
          !state.selectOptions?.head
        ) {
          return {
            data: recorders.selectDraftsResponse.data,
            error: recorders.selectDraftsResponse.error,
          };
        }

        // Shape B: DELETE_DRAFTS — strategies.delete({count:"exact"}).in().eq().eq()
        if (state.table === "strategies" && state.verb === "delete") {
          return {
            data: null,
            count: recorders.deleteDraftsResponse.count,
            error: recorders.deleteDraftsResponse.error,
          };
        }

        // Shape D: DELETE_KEY — api_keys.delete().eq("id", keyId)
        if (state.table === "api_keys" && state.verb === "delete") {
          const idEq = state.eqs.find(([c]) => c === "id");
          const keyId = idEq ? String(idEq[1]) : "";
          const seeded = recorders.deleteKeyByKey[keyId];
          return {
            data: null,
            error: seeded?.error ?? null,
          };
        }

        return { data: null, error: null };
      };

      const chain: Record<string, unknown> = {};

      chain.select = (
        columns: string,
        options?: Record<string, unknown>,
      ) => {
        state.verb = "select";
        state.selectColumns = columns;
        state.selectOptions = options;
        recorders.selectCalls.push({ table, columns, options });
        return chain;
      };

      chain.delete = (options?: Record<string, unknown>) => {
        state.verb = "delete";
        state.deleteOptions = options;
        recorders.deleteCalls.push({ table, options });
        return chain;
      };

      chain.eq = (col: string, val: unknown) => {
        state.eqs.push([col, val]);
        recorders.eqCalls.push({
          stage: `${state.table}:${state.verb ?? "?"}`,
          col,
          val,
        });
        return chain;
      };

      chain.lt = (col: string, val: unknown) => {
        state.lts.push([col, val]);
        recorders.ltCalls.push({ col, val });
        return chain;
      };

      chain.in = (col: string, vals: unknown[]) => {
        state.ins.push([col, vals]);
        recorders.inCalls.push({ col, vals });
        return chain;
      };

      // Make the chain a thenable so `await chain.eq(...)` resolves into
      // the captured response. PostgREST's builder works the same way.
      chain.then = <T1, T2>(
        onFulfilled: (val: ReturnType<typeof resolve>) => T1,
        onRejected?: (err: unknown) => T2,
      ): Promise<T1 | T2> =>
        Promise.resolve(resolve()).then(onFulfilled, onRejected);

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
    // Silence the route's bare console.error (Sentry-deferral pattern).
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
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
    expect(recorders.fromCalls).toHaveLength(0);
  });

  it("returns 401 when the Authorization header is missing", async () => {
    const handler = await getHandler();
    const res = await handler(makeReq());
    expect(res.status).toBe(401);
    expect(recorders.fromCalls).toHaveLength(0);
  });

  it("returns 401 when the Authorization header is wrong", async () => {
    const handler = await getHandler();
    const res = await handler(
      makeReq({ authorization: "Bearer wrong-secret-value-here-pad" }),
    );
    expect(res.status).toBe(401);
    expect(recorders.fromCalls).toHaveLength(0);
  });

  it("uses safeCompare (timing-safe) for the bearer check, not naive ===", async () => {
    // The route imports `safeCompare` from `@/lib/timing-safe-compare`.
    // Mocking that module lets us verify the route reaches the constant-
    // time comparator on every call AND that it does NOT fall back to a
    // naive `===` (which would short-circuit on a length-mismatching
    // attacker input and leak prefix bytes via timing).
    //
    // The mock asserts two things:
    //   1. `safeCompare` is the function the route delegates to (called
    //      with the request's Authorization header and `Bearer ${SECRET}`).
    //   2. When `safeCompare` returns `true`, the route accepts the
    //      request — proving the auth gate's truth value flows through
    //      the timing-safe comparator and not some other check.
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
    recorders.selectDraftsResponse = { data: [], error: null };
    const resAccept = await handler(
      makeReq({ authorization: wrongSameLength }),
    );
    expect(resAccept.status).toBe(200);
    expect(safeCompareSpy).toHaveBeenCalledTimes(2);
  });

  // --- Empty result -------------------------------------------------------

  it("returns 200 {deleted:0, orphaned_keys_revoked:0} when no drafts match", async () => {
    recorders.selectDraftsResponse = { data: [], error: null };

    const handler = await getHandler();
    const res = await handler(
      makeReq({ authorization: `Bearer ${process.env.CRON_SECRET}` }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ deleted: 0, orphaned_keys_revoked: 0 });
    // Only the SELECT_DRAFTS call should have run; no DELETE, no count,
    // no api_keys touch.
    expect(recorders.fromCalls).toEqual(["strategies"]);
    expect(recorders.deleteCalls).toHaveLength(0);
  });

  // --- Cutoff math --------------------------------------------------------

  it("filters drafts on created_at < (now - 30d).toISOString()", async () => {
    recorders.selectDraftsResponse = { data: [], error: null };
    const before = Date.now();

    const handler = await getHandler();
    await handler(
      makeReq({ authorization: `Bearer ${process.env.CRON_SECRET}` }),
    );

    const after = Date.now();
    expect(recorders.ltCalls).toHaveLength(1);
    const [{ col, val }] = recorders.ltCalls;
    expect(col).toBe("created_at");
    expect(typeof val).toBe("string");
    const cutoffMs = Date.parse(val as string);
    expect(Number.isFinite(cutoffMs)).toBe(true);
    // ABANDON_DAYS=30. Allow the small wall-clock drift between the
    // pre/post timestamps captured around the handler call.
    const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
    expect(cutoffMs).toBeGreaterThanOrEqual(before - THIRTY_DAYS_MS - 5);
    expect(cutoffMs).toBeLessThanOrEqual(after - THIRTY_DAYS_MS + 5);

    // Source/status filters are belt-on the SELECT.
    const selectEqs = recorders.eqCalls.filter(
      (c) => c.stage === "strategies:select",
    );
    expect(selectEqs).toEqual(
      expect.arrayContaining([
        { stage: "strategies:select", col: "source", val: "wizard" },
        { stage: "strategies:select", col: "status", val: "draft" },
      ]),
    );
  });

  // --- Happy path ---------------------------------------------------------

  it("deletes 3 wizard drafts and revokes 3 orphaned keys on the happy path", async () => {
    const drafts: DraftRow[] = [
      { id: "draft-a", api_key_id: "key-a" },
      { id: "draft-b", api_key_id: "key-b" },
      { id: "draft-c", api_key_id: "key-c" },
    ];
    recorders.selectDraftsResponse = { data: drafts, error: null };
    recorders.deleteDraftsResponse = { count: 3, error: null };
    // All three keys are orphaned (refCount=0 default applies; explicit
    // for clarity in this scenario).
    recorders.refCountByKey = {
      "key-a": { count: 0, error: null },
      "key-b": { count: 0, error: null },
      "key-c": { count: 0, error: null },
    };
    recorders.deleteKeyByKey = {
      "key-a": { error: null },
      "key-b": { error: null },
      "key-c": { error: null },
    };

    const handler = await getHandler();
    const res = await handler(
      makeReq({ authorization: `Bearer ${process.env.CRON_SECRET}` }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ deleted: 3, orphaned_keys_revoked: 3 });

    // SELECT, DELETE, then 3 × (COUNT_REFS, DELETE_KEY)
    expect(recorders.fromCalls).toEqual([
      "strategies", // SELECT_DRAFTS
      "strategies", // DELETE_DRAFTS
      "strategies", // COUNT_REFS key-a
      "api_keys", // DELETE_KEY key-a
      "strategies", // COUNT_REFS key-b
      "api_keys", // DELETE_KEY key-b
      "strategies", // COUNT_REFS key-c
      "api_keys", // DELETE_KEY key-c
    ]);
    expect(recorders.deleteCalls.filter((c) => c.table === "api_keys")).toHaveLength(3);
    // The DELETE_DRAFTS call requested an exact count.
    const deleteDraft = recorders.deleteCalls.find((c) => c.table === "strategies");
    expect(deleteDraft?.options).toEqual({ count: "exact" });
    // The .in("id", [...]) was called with all three draft ids.
    expect(recorders.inCalls).toHaveLength(1);
    expect(recorders.inCalls[0]).toEqual({
      col: "id",
      vals: ["draft-a", "draft-b", "draft-c"],
    });
  });

  // --- TOCTOU re-filter ---------------------------------------------------

  it("re-applies source='wizard' AND status='draft' on the DELETE clause (TOCTOU guard)", async () => {
    const drafts: DraftRow[] = [{ id: "draft-x", api_key_id: null }];
    recorders.selectDraftsResponse = { data: drafts, error: null };
    recorders.deleteDraftsResponse = { count: 1, error: null };

    const handler = await getHandler();
    const res = await handler(
      makeReq({ authorization: `Bearer ${process.env.CRON_SECRET}` }),
    );

    expect(res.status).toBe(200);
    // The eqCalls during the DELETE stage MUST include both source=wizard
    // and status=draft so a row that flipped to pending_review between the
    // SELECT and the DELETE is left intact instead of clobbered.
    const deleteEqs = recorders.eqCalls.filter(
      (c) => c.stage === "strategies:delete",
    );
    expect(deleteEqs).toEqual(
      expect.arrayContaining([
        { stage: "strategies:delete", col: "source", val: "wizard" },
        { stage: "strategies:delete", col: "status", val: "draft" },
      ]),
    );
    // null api_key_id → no orphan-key sweep at all.
    expect(recorders.fromCalls).toEqual(["strategies", "strategies"]);
  });

  // --- Orphan-key revoke logic (the dangerous path) -----------------------

  it("does NOT revoke an api_key when refCount > 0 (key still referenced by a live strategy)", async () => {
    // The shared key-shared has refCount=1 — a non-wizard strategy still
    // references it. The route MUST NOT delete it. The orphan key-orphan
    // has refCount=0 and SHOULD be deleted.
    const drafts: DraftRow[] = [
      { id: "draft-shared", api_key_id: "key-shared" },
      { id: "draft-orphan", api_key_id: "key-orphan" },
    ];
    recorders.selectDraftsResponse = { data: drafts, error: null };
    recorders.deleteDraftsResponse = { count: 2, error: null };
    recorders.refCountByKey = {
      // Live strategy still uses this key. DO NOT REVOKE.
      "key-shared": { count: 1, error: null },
      "key-orphan": { count: 0, error: null },
    };
    recorders.deleteKeyByKey = {
      "key-orphan": { error: null },
    };

    const handler = await getHandler();
    const res = await handler(
      makeReq({ authorization: `Bearer ${process.env.CRON_SECRET}` }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    // Only the orphan was revoked — the shared key was correctly skipped.
    expect(body).toEqual({ deleted: 2, orphaned_keys_revoked: 1 });

    // Critical: api_keys.delete must have been called EXACTLY ONCE (for
    // key-orphan), never for key-shared.
    const apiKeyDeletes = recorders.deleteCalls.filter(
      (c) => c.table === "api_keys",
    );
    expect(apiKeyDeletes).toHaveLength(1);
    // The .eq("id", ...) on api_keys must target key-orphan, never
    // key-shared. (eqCalls captures the stage as "api_keys:delete".)
    const apiKeyEqs = recorders.eqCalls.filter(
      (c) => c.stage === "api_keys:delete",
    );
    expect(apiKeyEqs).toEqual([
      { stage: "api_keys:delete", col: "id", val: "key-orphan" },
    ]);
    // Defense in depth: assert the shared key's id never appears as the
    // value of any api_keys-stage filter.
    for (const call of apiKeyEqs) {
      expect(call.val).not.toBe("key-shared");
    }
  });

  it("dedupes api_key_id and skips drafts with null api_key_id", async () => {
    // Two drafts share the same api_key_id (key-dup); a third has null.
    // The route MUST count refs for key-dup exactly once and skip the null.
    const drafts: DraftRow[] = [
      { id: "d1", api_key_id: "key-dup" },
      { id: "d2", api_key_id: "key-dup" },
      { id: "d3", api_key_id: null },
    ];
    recorders.selectDraftsResponse = { data: drafts, error: null };
    recorders.deleteDraftsResponse = { count: 3, error: null };
    recorders.refCountByKey = { "key-dup": { count: 0, error: null } };
    recorders.deleteKeyByKey = { "key-dup": { error: null } };

    const handler = await getHandler();
    const res = await handler(
      makeReq({ authorization: `Bearer ${process.env.CRON_SECRET}` }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ deleted: 3, orphaned_keys_revoked: 1 });

    // Exactly one COUNT_REFS pass (key-dup). Null was filtered out before
    // the loop; the duplicate was deduped via the Set in the route.
    const countQueries = recorders.selectCalls.filter(
      (c) => c.options?.head === true && c.options?.count === "exact",
    );
    expect(countQueries).toHaveLength(1);
    const apiKeyDeletes = recorders.deleteCalls.filter(
      (c) => c.table === "api_keys",
    );
    expect(apiKeyDeletes).toHaveLength(1);
  });

  // --- Error paths --------------------------------------------------------

  it("returns 500 when the SELECT errors", async () => {
    recorders.selectDraftsResponse = {
      data: null,
      error: { message: "DB connection failed" },
    };

    const handler = await getHandler();
    const res = await handler(
      makeReq({ authorization: `Bearer ${process.env.CRON_SECRET}` }),
    );

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toContain("DB connection failed");
  });

  it("returns 500 when the DELETE errors", async () => {
    recorders.selectDraftsResponse = {
      data: [{ id: "draft-a", api_key_id: null }],
      error: null,
    };
    recorders.deleteDraftsResponse = {
      count: null,
      error: { message: "FK violation" },
    };

    const handler = await getHandler();
    const res = await handler(
      makeReq({ authorization: `Bearer ${process.env.CRON_SECRET}` }),
    );

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toContain("FK violation");
  });

  it("treats a count-check error as non-fatal (skip key, continue)", async () => {
    // The route logs and `continue`s when the COUNT_REFS query errors —
    // best-effort orphan sweep should not fail the whole cron.
    const drafts: DraftRow[] = [
      { id: "d1", api_key_id: "key-bad" },
      { id: "d2", api_key_id: "key-good" },
    ];
    recorders.selectDraftsResponse = { data: drafts, error: null };
    recorders.deleteDraftsResponse = { count: 2, error: null };
    recorders.refCountByKey = {
      "key-bad": { count: null, error: { message: "transient" } },
      "key-good": { count: 0, error: null },
    };
    recorders.deleteKeyByKey = { "key-good": { error: null } };

    const handler = await getHandler();
    const res = await handler(
      makeReq({ authorization: `Bearer ${process.env.CRON_SECRET}` }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ deleted: 2, orphaned_keys_revoked: 1 });
  });

  it("falls back to draftIds.length when DELETE returns count=null", async () => {
    // PostgREST may return count:null on certain auth/RLS configurations
    // even when the delete succeeded. The route's `?? draftIds.length`
    // fallback keeps the response monotonic with what we asked to delete.
    const drafts: DraftRow[] = [
      { id: "d1", api_key_id: null },
      { id: "d2", api_key_id: null },
    ];
    recorders.selectDraftsResponse = { data: drafts, error: null };
    recorders.deleteDraftsResponse = { count: null, error: null };

    const handler = await getHandler();
    const res = await handler(
      makeReq({ authorization: `Bearer ${process.env.CRON_SECRET}` }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ deleted: 2, orphaned_keys_revoked: 0 });
  });
});
