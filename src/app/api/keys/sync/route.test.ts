import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { SUPPORTED_EXCHANGES } from "@/lib/closed-sets";

/**
 * Tests for POST /api/keys/sync — the feature-flagged sync route rewrite
 * (Sprint 3 Commit 4). Exercises both the new compute_jobs queue path
 * (USE_COMPUTE_JOBS_QUEUE=true) and the legacy after() fire-and-forget path.
 *
 * Mocking strategy:
 *   - vi.mock @/lib/supabase/server  → user-scoped client (ownership check)
 *   - vi.mock @/lib/supabase/admin   → service-role client (RPC + upsert)
 *   - vi.mock @/lib/ratelimit        → rate limiter
 *   - vi.mock @/lib/analytics-client → fetchTrades / computeAnalytics
 *   - vi.mock next/server            → after() capture
 */

const VALID_ORIGIN = { origin: "http://localhost:3000" };

// vi.hoisted runs before module-level `const`, so all hoisted
// state must be self-contained — no cross-references to top-level consts.
const {
  TEST_USER,
  mockRpc,
  mockUpsert,
  mockAfter,
  mockFetchTrades,
  mockComputeAnalytics,
  mockLogAuditEvent,
  rateLimitResult,
  ownershipResult,
  // H-0275: capture what the user-scoped ownership query actually touched
  // so the mock can FAIL when a regression points it at the wrong table or
  // drops a filter — the "mock so deep it can't fail" trap (Rule 9).
  ownershipQuery,
  // H-0306: the auth boundary. Flipped to null in the unauthed test so the
  // REAL withAuth (this route does NOT mock it) hits its 401 branch.
  authState,
  // F6 (M-0327/H-0279): capture the limiter bucket key so a regression that
  // drops the per-strategy namespacing fails loudly.
  checkLimitMock,
  // 89-02: composite-first kickoff. The strategy_keys membership head-count
  // probe (hoisted so each test drives count/error) plus a spy on the select
  // call so the neutrality pins can assert the probe is (not) issued.
  strategyKeysProbe,
  // R2-1: existing strategy_analytics row the fail-closed stamp guard reads.
  analyticsExisting,
  mockStrategyKeysSelect,
  // 89-02: the unified-backbone flag (default OFF) + a spy on the unified
  // delegate so the hoist-ordering pin can prove the composite branch wins
  // even when the flag is TRUE (the prod process_key_unified_backbone='on'
  // routing lesson).
  unifiedActive,
  mockPostProcessKey,
  // UAT/F-1: spy on the composite kickoff's asset_class='crypto' force-derive
  // (strategies update BEFORE the stitch enqueue) so a regression that drops it
  // — re-opening the √252-vs-√365 preview fail-loud — reddens.
  mockStrategiesUpdate,
} = vi.hoisted(() => ({
  TEST_USER: { id: "00000000-0000-0000-0000-aaaaaaaaaaaa" },
  mockRpc: vi.fn(),
  mockUpsert: vi.fn(),
  mockAfter: vi.fn(),
  mockFetchTrades: vi.fn(),
  mockComputeAnalytics: vi.fn(),
  // C-0101: hoisted spy so we can assert action + metadata.path on each branch.
  mockLogAuditEvent: vi.fn(),
  rateLimitResult: { success: true as boolean, retryAfter: 0 },
  ownershipResult: {
    // 89-02: api_key_id joins the ownership row — null identifies a POSSIBLE
    // composite (members live in strategy_keys); a UUID is definitively
    // single-key. Undefined (the default fixtures) leaves the branch dormant.
    data: null as Record<string, string | null> | null,
  },
  strategyKeysProbe: {
    count: 0 as number | null,
    error: null as { message: string } | null,
  },
  // R2-1: the existing strategy_analytics row the guard reads before stamping a
  // terminal 'failed'. Default (no prior derive) → the stamp proceeds; set
  // `data.computation_status = 'complete'` to simulate a PUBLISHED composite the
  // fail-closed stamp must NOT clobber.
  analyticsExisting: {
    data: null as { computation_status?: string } | null,
    error: null as { message: string } | null,
  },
  mockStrategyKeysSelect: vi.fn(),
  unifiedActive: { value: false as boolean },
  mockPostProcessKey: vi.fn(),
  mockStrategiesUpdate: vi.fn(),
  ownershipQuery: {
    table: null as string | null,
    selectCols: null as string | null,
    // Filters captured as [column, value] pairs from each .eq() link.
    filters: [] as Array<[string, unknown]>,
  },
  authState: { user: { id: "00000000-0000-0000-0000-aaaaaaaaaaaa" } as { id: string } | null },
  checkLimitMock: vi.fn(),
}));

const TEST_STRATEGY_ID = "11111111-1111-1111-1111-111111111111";
const TEST_JOB_ID = "22222222-2222-2222-2222-222222222222";

// ── Module mocks ────────────────────────────────────────────────────

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: authState.user }, error: null }),
    },
    // H-0275: the mock now introspects the table name + select columns +
    // every .eq() filter, recording them on `ownershipQuery`. Tests assert
    // the route hit `from("strategies").select("id, user_id")` filtered by
    // BOTH `id` and `user_id` — so a regression that swaps the table to
    // `api_keys`, drops the `user_id` filter, or selects the wrong columns
    // is observable instead of silently passing.
    from: (table: string) => {
      ownershipQuery.table = table;
      // A chainable builder where each link records its observable side
      // effect and returns `this`. `single()` is the terminal that resolves
      // the configured ownership result.
      const builder = {
        select: (cols: string) => {
          ownershipQuery.selectCols = cols;
          return builder;
        },
        eq: (col: string, val: unknown) => {
          ownershipQuery.filters.push([col, val]);
          return builder;
        },
        single: async () => ownershipResult,
      };
      return builder;
    },
  }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: mockRpc,
    // 89-02: the admin `from` now branches by table. `strategy_keys` serves
    // the composite membership head-count probe (a thenable resolving to the
    // hoisted `{ count, error }`); everything else keeps the upsert seam the
    // legacy + composite-failed-stamp paths use.
    from: (table: string) => {
      if (table === "strategy_keys") {
        return {
          select: (cols: string, opts?: unknown) => {
            mockStrategyKeysSelect(cols, opts);
            return {
              eq: (_col: string, _val: unknown) =>
                Promise.resolve({
                  count: strategyKeysProbe.count,
                  error: strategyKeysProbe.error,
                }),
            };
          },
        };
      }
      if (table === "strategy_analytics") {
        // R2-1: the guard reads the existing row (select→eq→maybeSingle) before
        // the fail-closed stamp; the stamp itself is the upsert seam.
        return {
          upsert: mockUpsert,
          select: (_cols: string) => ({
            eq: (_col: string, _val: unknown) => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: analyticsExisting.data,
                  error: analyticsExisting.error,
                }),
            }),
          }),
        };
      }
      if (table === "strategies") {
        // UAT/F-1: the composite kickoff force-derives asset_class='crypto' before
        // enqueuing stitch_composite (update→eq). Spy the patch so a regression
        // that drops the derive — re-opening the preview √252-vs-√365 fail-loud —
        // is observable.
        return {
          update: (patch: Record<string, unknown>) => {
            mockStrategiesUpdate(patch);
            // Chainable + awaitable: the derive filters by BOTH .eq("id") and
            // .eq("user_id") (belt-and-braces owner scope), so `eq` returns the
            // same thenable to support `.eq().eq()` then `await`.
            const chain: {
              eq: (col: string, val: unknown) => typeof chain;
              then: (resolve: (v: { error: null }) => unknown) => unknown;
            } = {
              eq: (_col: string, _val: unknown) => chain,
              then: (resolve) => resolve({ error: null }),
            };
            return chain;
          },
        };
      }
      return { upsert: mockUpsert };
    },
  }),
}));

// 89-02: unified-backbone flag seam. Default OFF (existing tests exercise the
// legacy handler); the hoist-ordering pin flips it TRUE to prove the composite
// branch still wins ahead of it.
vi.mock("@/lib/sentry-capture", () => ({
  captureToSentry: vi.fn(),
}));

vi.mock("@/lib/feature-flags", () => ({
  isUnifiedBackboneActive: async () => unifiedActive.value,
}));

// 89-02: the unified single-key delegate. Spied so the hoist-ordering pin can
// assert a composite is NEVER routed through it, even with the flag TRUE.
vi.mock("@/lib/process-key-client", () => ({
  postProcessKey: mockPostProcessKey,
}));

vi.mock("@/lib/ratelimit", () => ({
  userActionLimiter: null,
  keysSyncUserLimiter: null,
  checkLimit: (...args: unknown[]) => {
    checkLimitMock(...args);
    return Promise.resolve(rateLimitResult);
  },
}));

vi.mock("@/lib/analytics-client", () => ({
  fetchTrades: mockFetchTrades,
  computeAnalytics: mockComputeAnalytics,
}));

vi.mock("@/lib/csrf", () => ({
  assertSameOrigin: () => null,
}));

// `@/lib/audit` pulls in `server-only` which throws under vitest+jsdom.
// The route emits `sync.start` on both branches (legacy + queue); the
// coverage regression test asserts the imports, but this unit test
// only cares about the compute-path logic — stub the emission out.
vi.mock("server-only", () => ({}));
vi.mock("@/lib/audit", () => ({
  // B4b: both sync.start emits now ride the service path
  // (log_audit_event_service — JWT-immune) with the explicit acting-user id.
  // Point the same spy at logAuditEventAsUser; the event object is now the
  // THIRD arg (admin, actingUserId, event).
  logAuditEvent: mockLogAuditEvent,
  logAuditEventAsUser: mockLogAuditEvent,
}));

// Stub the correlation-id helper so we can assert it propagates into
// `enqueue_compute_job`'s p_metadata payload. The real helper reads
// next/headers which is awkward to drive from vitest.
const TEST_CORRELATION_ID = "11111111-2222-3333-4444-555555555555";
vi.mock("@/lib/correlation-id", () => ({
  getCorrelationId: vi.fn().mockResolvedValue(TEST_CORRELATION_ID),
  CORRELATION_HEADER: "x-correlation-id",
}));

// Mock next/server — preserve NextRequest/NextResponse, capture after()
vi.mock("next/server", async () => {
  const actual = await vi.importActual<typeof import("next/server")>("next/server");
  return {
    ...actual,
    after: mockAfter,
  };
});

// ── Helpers ─────────────────────────────────────────────────────────

function makeReq(body: Record<string, unknown> = {}) {
  return new NextRequest("http://localhost:3000/api/keys/sync", {
    method: "POST",
    headers: { "content-type": "application/json", ...VALID_ORIGIN },
    body: JSON.stringify(body),
  });
}

// ── Tests ───────────────────────────────────────────────────────────

describe("POST /api/keys/sync", () => {
  const originalEnv = process.env.USE_COMPUTE_JOBS_QUEUE;

  beforeEach(() => {
    vi.clearAllMocks();
    rateLimitResult.success = true;
    rateLimitResult.retryAfter = 0;
    ownershipResult.data = { id: TEST_STRATEGY_ID, user_id: TEST_USER.id };
    ownershipQuery.table = null;
    ownershipQuery.selectCols = null;
    ownershipQuery.filters = [];
    authState.user = { id: TEST_USER.id };
    // 89-02: reset composite probe + unified flag to their neutral defaults so
    // the existing single-key/legacy pins run byte-identically (no probe fires
    // unless a fixture explicitly sets api_key_id: null).
    strategyKeysProbe.count = 0;
    strategyKeysProbe.error = null;
    // R2-1: default to NO prior derive so the existing stamp pins still stamp.
    analyticsExisting.data = null;
    analyticsExisting.error = null;
    unifiedActive.value = false;
    mockPostProcessKey.mockResolvedValue({ ok: true, body: { queued: true } });
    delete process.env.USE_COMPUTE_JOBS_QUEUE;

    // Default mock implementations
    mockRpc.mockResolvedValue({ data: TEST_JOB_ID, error: null });
    mockUpsert.mockReturnValue({ error: null });
    mockFetchTrades.mockResolvedValue({ trades_fetched: 42 });
    mockComputeAnalytics.mockResolvedValue({ status: "complete" });
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.USE_COMPUTE_JOBS_QUEUE = originalEnv;
    } else {
      delete process.env.USE_COMPUTE_JOBS_QUEUE;
    }
  });

  // ── 1. Queue path happy path ────────────────────────────────────
  it("enqueues via RPC and returns 202 when USE_COMPUTE_JOBS_QUEUE=true", async () => {
    process.env.USE_COMPUTE_JOBS_QUEUE = "true";

    const { POST } = await import("./route");
    const res = await POST(makeReq({ strategy_id: TEST_STRATEGY_ID }));

    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body).toEqual({
      ok: true,
      accepted: true,
      strategy_id: TEST_STRATEGY_ID,
      status: "syncing",
      // 89-02 / Finding-H: single-key queue path threads composite:false so the
      // preview step's discriminator stays byte-neutral for non-composites.
      composite: false,
    });

    // RPC was called with correct args, including the correlation_id
    // forensic thread (Phase 18 Day-2 Bug #1 fix).
    expect(mockRpc).toHaveBeenCalledWith("enqueue_compute_job", {
      p_strategy_id: TEST_STRATEGY_ID,
      p_kind: "sync_trades",
      p_metadata: { correlation_id: TEST_CORRELATION_ID },
    });

    // after() should NOT have been called on the queue path
    expect(mockAfter).not.toHaveBeenCalled();

    // No direct computation_status upsert on the queue path
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  // ── 2. Legacy path happy path ───────────────────────────────────
  it("falls through to after() when queue flag is OFF", async () => {
    // Flag not set — default OFF
    const { POST } = await import("./route");
    const res = await POST(makeReq({ strategy_id: TEST_STRATEGY_ID }));

    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body).toEqual({
      ok: true,
      accepted: true,
      strategy_id: TEST_STRATEGY_ID,
      status: "syncing",
      // 89-02 / Finding-H: single-key legacy path is composite:false too.
      composite: false,
    });

    // after() was called with a function
    expect(mockAfter).toHaveBeenCalledTimes(1);
    expect(typeof mockAfter.mock.calls[0][0]).toBe("function");

    // The upsert was called to set computation_status='computing'
    expect(mockUpsert).toHaveBeenCalledTimes(1);

    // RPC should NOT have been called
    expect(mockRpc).not.toHaveBeenCalled();
  });

  // ── 3. Ownership mismatch / not-found → 404 (P458) ─────────────
  // P458 (audit-2026-05-07): pre-fix this returned 403 for BOTH "no
  // such strategy" AND "exists but unowned" — but with the same
  // message — so an attacker could probe strategy_id existence via the
  // status code's mere presence vs. a `404 Not Found` fall-through from
  // a different route. The hardened contract is a uniform 404 with a
  // non-discriminating message; the response shape must be identical
  // in both branches so an attacker cannot infer existence.
  it("P458 — returns 404 with uniform message when ownership check returns no row", async () => {
    ownershipResult.data = null;

    const { POST } = await import("./route");
    const res = await POST(makeReq({ strategy_id: TEST_STRATEGY_ID }));

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("Strategy not found");
    // The message must NOT leak the unowned-vs-not-found distinction.
    expect(body.error).not.toMatch(/owned/i);

    // Neither path should have been reached.
    expect(mockRpc).not.toHaveBeenCalled();
    expect(mockAfter).not.toHaveBeenCalled();
  });

  // ── 4. Idempotency: enqueue twice returns 202 both times ───────
  it("returns 202 on repeated calls (idempotent RPC)", async () => {
    process.env.USE_COMPUTE_JOBS_QUEUE = "true";
    // Both calls return the same job id (idempotent behavior)
    mockRpc.mockResolvedValue({ data: TEST_JOB_ID, error: null });

    const { POST } = await import("./route");

    const res1 = await POST(makeReq({ strategy_id: TEST_STRATEGY_ID }));
    expect(res1.status).toBe(202);

    const res2 = await POST(makeReq({ strategy_id: TEST_STRATEGY_ID }));
    expect(res2.status).toBe(202);

    expect(mockRpc).toHaveBeenCalledTimes(2);
    // Both return the same response shape
    const body1 = await res1.json();
    const body2 = await res2.json();
    expect(body1).toEqual(body2);
  });

  // ── F6 (M-0327/H-0279): two-tier limiter (per-user ceiling + per-strategy) ──
  it("checks BOTH a per-user aggregate ceiling AND a per-(user, strategy) bucket", async () => {
    const { POST } = await import("./route");
    await POST(makeReq({ strategy_id: TEST_STRATEGY_ID }));

    // (1) Per-user ceiling caps total volume so distinct-UUID probing can't
    //     bypass the limit (red-team).
    expect(checkLimitMock).toHaveBeenCalledWith(
      null, // keysSyncUserLimiter (mocked to null in this suite)
      `keys-sync-user:${TEST_USER.id}`,
    );
    // (2) Per-strategy bucket gives each strategy its own throughput so concurrent
    //     resyncs don't starve each other and a foreign id only burns its own bucket.
    expect(checkLimitMock).toHaveBeenCalledWith(
      null, // userActionLimiter (mocked to null in this suite)
      `keys-sync:${TEST_USER.id}:${TEST_STRATEGY_ID}`,
    );
  });

  // ── 5. Rate limit exceeded → 429 ───────────────────────────────
  it("returns 429 with Retry-After when rate-limited", async () => {
    rateLimitResult.success = false;
    rateLimitResult.retryAfter = 42;

    const { POST } = await import("./route");
    const res = await POST(makeReq({ strategy_id: TEST_STRATEGY_ID }));

    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("42");
    const body = await res.json();
    expect(body.error).toContain("Too many requests");

    // Nothing else should run
    expect(mockRpc).not.toHaveBeenCalled();
    expect(mockAfter).not.toHaveBeenCalled();
  });

  // ── 6. RPC error → 503 ─────────────────────────────────────────
  it("returns 503 when enqueue_compute_job RPC fails", async () => {
    process.env.USE_COMPUTE_JOBS_QUEUE = "true";
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: "connection refused", code: "PGRST301" },
    });

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { POST } = await import("./route");
    const res = await POST(makeReq({ strategy_id: TEST_STRATEGY_ID }));

    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toContain("Could not start sync");

    // Error was logged
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("enqueue_compute_job RPC failed"),
      expect.anything(),
    );
    consoleSpy.mockRestore();
  });

  // ── 7. Missing strategy_id → 400 ───────────────────────────────
  it("returns 400 when strategy_id is missing", async () => {
    const { POST } = await import("./route");
    const res = await POST(makeReq({}));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("Missing strategy_id");
  });

  // ── F6: malformed (non-UUID) strategy_id → 400 before the limiter ──
  it("returns 400 when strategy_id is not a UUID (bounds the limiter keyspace)", async () => {
    const { POST } = await import("./route");
    const res = await POST(makeReq({ strategy_id: "../../etc/passwd" }));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("Invalid strategy_id");
    // A garbage id must NOT consume a limiter token (it never reaches the gate).
    expect(checkLimitMock).not.toHaveBeenCalled();
  });

  // ── 8. Phase 18 Day-2 Bug #1 — correlation_id propagation ───────
  // SC-1 fifth layer: compute_jobs.metadata->>'correlation_id' must be
  // queryable end-to-end. The 062 + 032 RPC signature accepts
  // p_metadata JSONB; this route was passing only {p_strategy_id, p_kind}
  // before the fix, leaving the forensic chain incomplete. Without the
  // import + getCorrelationId() call + p_metadata key in the rpc args,
  // this test fails because mockRpc receives no `p_metadata` field.
  it("threads getCorrelationId() into enqueue_compute_job p_metadata.correlation_id (Phase 18 Bug #1)", async () => {
    process.env.USE_COMPUTE_JOBS_QUEUE = "true";

    const { POST } = await import("./route");
    const res = await POST(makeReq({ strategy_id: TEST_STRATEGY_ID }));

    expect(res.status).toBe(202);
    expect(mockRpc).toHaveBeenCalledTimes(1);
    const [rpcName, rpcArgs] = mockRpc.mock.calls[0] as [string, Record<string, unknown>];
    expect(rpcName).toBe("enqueue_compute_job");
    expect(rpcArgs.p_metadata).toEqual({ correlation_id: TEST_CORRELATION_ID });
  });

  // ── C-0101: sync.start audit emission shape ────────────────────────
  // The route emits `sync.start` on BOTH branches (queue + legacy) with
  // a metadata.path discriminator. A regression that hits the wrong
  // branch silently corrupts the forensic signal — operators querying
  // audit_log for "queue stalls vs legacy after() failures" would see
  // the wrong attribution. These two tests pin the exact emission shape
  // per branch (action, entity_type, entity_id, metadata.path).
  it("[C-0101 queue branch] emits sync.start with metadata.path='queue' when USE_COMPUTE_JOBS_QUEUE=true", async () => {
    process.env.USE_COMPUTE_JOBS_QUEUE = "true";

    const { POST } = await import("./route");
    const res = await POST(makeReq({ strategy_id: TEST_STRATEGY_ID }));
    expect(res.status).toBe(202);

    expect(mockLogAuditEvent).toHaveBeenCalledTimes(1);
    // B4b: logAuditEventAsUser(admin, actingUserId, event) — event is arg[2].
    const [, actingUserId, event] = mockLogAuditEvent.mock.calls[0] as [
      unknown,
      string,
      {
        action: string;
        entity_type: string;
        entity_id: string;
        metadata: Record<string, unknown>;
      },
    ];
    expect(actingUserId).toBe(TEST_USER.id);
    expect(event.action).toBe("sync.start");
    expect(event.entity_type).toBe("sync");
    expect(event.entity_id).toBe(TEST_STRATEGY_ID);
    expect(event.metadata).toEqual({ path: "queue" });
  });

  it("[C-0101 legacy branch] emits sync.start with metadata.path='legacy' when queue flag is OFF", async () => {
    // Flag not set — default OFF.
    const { POST } = await import("./route");
    const res = await POST(makeReq({ strategy_id: TEST_STRATEGY_ID }));
    expect(res.status).toBe(202);

    expect(mockLogAuditEvent).toHaveBeenCalledTimes(1);
    // B4b: logAuditEventAsUser(admin, actingUserId, event) — event is arg[2].
    const [, actingUserId, event] = mockLogAuditEvent.mock.calls[0] as [
      unknown,
      string,
      {
        action: string;
        entity_type: string;
        entity_id: string;
        metadata: Record<string, unknown>;
      },
    ];
    expect(actingUserId).toBe(TEST_USER.id);
    expect(event.action).toBe("sync.start");
    expect(event.entity_type).toBe("sync");
    expect(event.entity_id).toBe(TEST_STRATEGY_ID);
    expect(event.metadata).toEqual({ path: "legacy" });
  });

  it("[C-0101] does NOT emit sync.start on the 429 rate-limit branch", async () => {
    rateLimitResult.success = false;
    rateLimitResult.retryAfter = 7;

    const { POST } = await import("./route");
    const res = await POST(makeReq({ strategy_id: TEST_STRATEGY_ID }));
    expect(res.status).toBe(429);

    // Nothing audit-worthy happened — the request never reached either
    // sync branch.
    expect(mockLogAuditEvent).not.toHaveBeenCalled();
  });

  // ── H-0306: unmocked withAuth auth boundary → 401 ──────────────────
  // This route wraps the handler in the REAL withAuth (it does NOT mock
  // it), so a missing session must short-circuit at 401 BEFORE any
  // rate-limit, ownership, RPC, or after() work runs. Rule 9: the auth
  // boundary is the single most important invariant on a mutation route;
  // pin that the unauthed branch actually executes.
  it("H-0306 — returns 401 when the session is missing (real withAuth boundary)", async () => {
    authState.user = null;

    const { POST } = await import("./route");
    const res = await POST(makeReq({ strategy_id: TEST_STRATEGY_ID }));

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Unauthorized");

    // Nothing past the auth gate should have run.
    expect(ownershipQuery.table).toBeNull();
    expect(mockRpc).not.toHaveBeenCalled();
    expect(mockAfter).not.toHaveBeenCalled();
    expect(mockUpsert).not.toHaveBeenCalled();
    expect(mockLogAuditEvent).not.toHaveBeenCalled();
  });

  // ── H-0275: ownership query targets the right table + filters ──────
  // The mock used to return the same select.eq.eq.single chain for ANY
  // table/filter combination, so a regression that pointed the ownership
  // check at `api_keys`, dropped the `user_id` filter, or selected the
  // wrong columns would still pass (Rule 9 — "mock so deep it can't
  // fail"). The mock now records the table/cols/filters; this test pins
  // the contract: from("strategies").select("id, user_id") filtered by
  // BOTH `id`=strategy_id AND `user_id`=user.id.
  it("H-0275 — ownership check queries strategies by id AND user_id", async () => {
    const { POST } = await import("./route");
    const res = await POST(makeReq({ strategy_id: TEST_STRATEGY_ID }));
    expect(res.status).toBe(202);

    // The check must hit the strategies table — NOT api_keys or any other.
    expect(ownershipQuery.table).toBe("strategies");
    // It must select the ownership columns the route relies on. 89-02 extends
    // the select with api_key_id so the composite-first branch can gate on
    // api_key_id === null with ZERO extra queries for single-key strategies.
    expect(ownershipQuery.selectCols).toBe("id, user_id, api_key_id");
    // Both filters must be present: id scopes the row, user_id is the
    // ownership fence. Dropping user_id would let any authenticated user
    // sync any strategy.
    expect(ownershipQuery.filters).toContainEqual(["id", TEST_STRATEGY_ID]);
    expect(ownershipQuery.filters).toContainEqual(["user_id", TEST_USER.id]);
  });

  // ── H-0277: legacy after() failure → compensating 'failed' upsert ──
  // The after() background block has the critical compensating-write path:
  // if fetchTrades / computeAnalytics throws, it MUST upsert
  // {computation_status:'failed', computation_error:<msg>} so SyncPreviewStep
  // stops polling and renders GATE_ANALYTICS_FAILED. A regression that
  // dropped this upsert (or wrote the wrong status) would leave the client
  // polling forever on "still computing". This test drives the catch branch
  // by rejecting computeAnalytics, invokes the captured after() callback,
  // and asserts the failure upsert payload.
  it("H-0277 — after() catch-branch upserts computation_status='failed' with the error message", async () => {
    // Flag OFF — exercise the legacy after() path.
    const FAILURE_MESSAGE = "Railway compute timed out after 300s";
    mockComputeAnalytics.mockRejectedValueOnce(new Error(FAILURE_MESSAGE));
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { POST } = await import("./route");
    const res = await POST(makeReq({ strategy_id: TEST_STRATEGY_ID }));
    expect(res.status).toBe(202);

    // The route registered exactly one after() callback (the bg sync).
    expect(mockAfter).toHaveBeenCalledTimes(1);
    const afterCb = mockAfter.mock.calls[0][0] as () => Promise<void>;

    // First upsert was the entry 'computing' status (legacy path).
    expect(mockUpsert).toHaveBeenCalledTimes(1);

    // Drive the background block. computeAnalytics rejects → catch branch
    // fires the compensating failure upsert.
    await afterCb();

    // The catch branch must have issued a SECOND upsert with the failed
    // status + the propagated error message.
    expect(mockUpsert).toHaveBeenCalledTimes(2);
    const failurePayload = mockUpsert.mock.calls[1][0] as Record<string, unknown>;
    expect(failurePayload).toMatchObject({
      strategy_id: TEST_STRATEGY_ID,
      computation_status: "failed",
      computation_error: FAILURE_MESSAGE,
    });
    // SI-02 (LOW-MEDIUM, v1.9): the legacy after() 'failed' write must also
    // CLEAR the runner-owned computation_warned marker, mirroring the Python
    // fix. Otherwise a prior-warned strategy can be resurrected to
    // complete_with_warnings by the status bridge OVER a genuine failure.
    // Neuter: drop `computation_warned: false` from the source write → reddens.
    expect(failurePayload.computation_warned).toBe(false);

    consoleSpy.mockRestore();
  });

  // ── H-0277 (sibling): a successful after() run does NOT write 'failed' ──
  // Belt-and-braces so the failure assertion above can't pass vacuously:
  // when computeAnalytics resolves, the catch branch must NOT run, so the
  // only upsert is the entry 'computing' write.
  it("H-0277 — after() success path issues no compensating 'failed' upsert", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockFetchTrades.mockResolvedValueOnce({ trades_fetched: 7 });
    mockComputeAnalytics.mockResolvedValueOnce({ status: "complete" });

    const { POST } = await import("./route");
    const res = await POST(makeReq({ strategy_id: TEST_STRATEGY_ID }));
    expect(res.status).toBe(202);

    const afterCb = mockAfter.mock.calls[0][0] as () => Promise<void>;
    await afterCb();

    // Only the entry 'computing' upsert — no 'failed' write.
    expect(mockUpsert).toHaveBeenCalledTimes(1);
    const onlyPayload = mockUpsert.mock.calls[0][0] as Record<string, unknown>;
    expect(onlyPayload.computation_status).toBe("computing");
    consoleSpy.mockRestore();
  });

  // ── 89-02: composite-first kickoff branch ──────────────────────────────
  // The preview step (wizard index 2) POSTs /api/keys/sync BEFORE finalize.
  // For a member-bearing composite (strategies.api_key_id === null AND a
  // strategy_keys count > 0) the route must enqueue the SAME production
  // `stitch_composite` job finalize enqueues — never sync_trades, never the
  // unified single-key resync — and it must do so BEFORE isUnifiedBackboneActive()
  // (prod runs unified='on', whose single-key arm cannot honestly derive a
  // NULL-api_key composite). This mirrors the Phase-88 finalize-wizard hoist.
  describe("composite-first kickoff (stitch_composite)", () => {
    // Pin 1 — happy path: api_key_id null + count 2 + queue ON → stitch_composite.
    it("enqueues stitch_composite (not sync_trades) for a member-bearing composite", async () => {
      process.env.USE_COMPUTE_JOBS_QUEUE = "true";
      ownershipResult.data = {
        id: TEST_STRATEGY_ID,
        user_id: TEST_USER.id,
        api_key_id: null,
      };
      strategyKeysProbe.count = 2;

      const { POST } = await import("./route");
      const res = await POST(makeReq({ strategy_id: TEST_STRATEGY_ID }));

      expect(res.status).toBe(202);
      const body = await res.json();
      expect(body).toEqual({
        ok: true,
        accepted: true,
        strategy_id: TEST_STRATEGY_ID,
        status: "syncing",
        // 89-02 / Finding-H: the AUTHORITATIVE discriminator the preview step
        // threads into isComposite — server truth, not a fragile client probe.
        composite: true,
      });

      // The SAME stitch_composite job finalize dispatches, with the source tag
      // + the correlation_id forensic thread (mirroring the sync_trades arm).
      expect(mockRpc).toHaveBeenCalledWith("enqueue_compute_job", {
        p_strategy_id: TEST_STRATEGY_ID,
        p_kind: "stitch_composite",
        p_metadata: {
          source: "keys/sync",
          correlation_id: TEST_CORRELATION_ID,
        },
      });
      // NEVER the single-key legacy kind for a composite.
      expect(mockRpc).not.toHaveBeenCalledWith(
        "enqueue_compute_job",
        expect.objectContaining({ p_kind: "sync_trades" }),
      );

      // UAT/F-1: force-derive asset_class='crypto' BEFORE the stitch dispatch.
      // A composite annualizes on the venue blend (√365); asset_class carries the
      // NOT NULL DEFAULT 'traditional' (√252) until finalize, and the stitch runs
      // HERE at preview — so without this the worker's guard trips
      // (`asset_class 252 != venue-blend 365`) and the preview fails-loud.
      expect(mockStrategiesUpdate).toHaveBeenCalledWith({ asset_class: "crypto" });

      // T-89-06: the sync.start audit rides the composite queue branch with a
      // kind discriminator so operators can attribute composite kickoffs.
      expect(mockLogAuditEvent).toHaveBeenCalledTimes(1);
      const [, actingUserId, event] = mockLogAuditEvent.mock.calls[0] as [
        unknown,
        string,
        { action: string; entity_type: string; entity_id: string; metadata: Record<string, unknown> },
      ];
      expect(actingUserId).toBe(TEST_USER.id);
      expect(event.action).toBe("sync.start");
      expect(event.entity_type).toBe("sync");
      expect(event.entity_id).toBe(TEST_STRATEGY_ID);
      expect(event.metadata).toEqual({ path: "queue", kind: "stitch_composite" });
    });

    // Pin 2 — HOIST ORDERING (T-89-05): even with the unified flag TRUE (prod
    // reality), a composite STILL enqueues stitch_composite and the unified
    // delegate is never invoked. Falsifiable: moving the branch below the flag
    // check reddens this — the composite would route through postProcessKey.
    it("wins BEFORE isUnifiedBackboneActive() — enqueues stitch_composite with the unified flag ON", async () => {
      process.env.USE_COMPUTE_JOBS_QUEUE = "true";
      unifiedActive.value = true; // prod process_key_unified_backbone='on'
      ownershipResult.data = {
        id: TEST_STRATEGY_ID,
        user_id: TEST_USER.id,
        api_key_id: null,
      };
      strategyKeysProbe.count = 3;

      const { POST } = await import("./route");
      const res = await POST(makeReq({ strategy_id: TEST_STRATEGY_ID }));

      expect(res.status).toBe(202);
      expect(mockRpc).toHaveBeenCalledWith(
        "enqueue_compute_job",
        expect.objectContaining({ p_kind: "stitch_composite" }),
      );
      // The unified single-key resync must NEVER see a composite.
      expect(mockPostProcessKey).not.toHaveBeenCalled();
    });

    // Pin 3 — queue flag OFF + composite → fail LOUD (there is no worker to
    // derive stitch_composite without the queue): terminal 'failed' stamp +
    // 503, zero enqueue.
    it("fails loud (terminal 'failed' + 503) when a composite hits a queue-flag-OFF route", async () => {
      // USE_COMPUTE_JOBS_QUEUE unset (default OFF).
      ownershipResult.data = {
        id: TEST_STRATEGY_ID,
        user_id: TEST_USER.id,
        api_key_id: null,
      };
      strategyKeysProbe.count = 2;
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const { POST } = await import("./route");
      const res = await POST(makeReq({ strategy_id: TEST_STRATEGY_ID }));

      expect(res.status).toBe(503);
      const body = await res.json();
      expect(body.error).toBeTruthy();

      // A terminal 'failed' row is stamped — never orphan a composite that
      // never derives — with the composite DQ flag (membership WAS established
      // here, count 2, so `composite: true` is honest).
      expect(mockUpsert).toHaveBeenCalledTimes(1);
      const stamp = mockUpsert.mock.calls[0][0] as Record<string, unknown>;
      expect(stamp).toMatchObject({
        strategy_id: TEST_STRATEGY_ID,
        computation_status: "failed",
        computation_warned: false,
        data_quality_flags: { csv_source: true, composite: true },
      });
      expect(String(stamp.computation_error)).toContain("USE_COMPUTE_JOBS_QUEUE");

      // No enqueue, no unified delegate.
      expect(mockRpc).not.toHaveBeenCalled();
      expect(mockPostProcessKey).not.toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    // Pin 4 — FAIL CLOSED on unknowable membership (W-4 / T-88-10 posture):
    // a count error OR a null count MUST stamp a terminal 'failed' with
    // membership_unknown:true (NOT composite:true — membership unproven) and
    // 503, never fall open to a single-key sync_trades dispatch of a possible
    // composite.
    it("fails CLOSED (membership_unknown + 503) when the strategy_keys count errors", async () => {
      process.env.USE_COMPUTE_JOBS_QUEUE = "true";
      ownershipResult.data = {
        id: TEST_STRATEGY_ID,
        user_id: TEST_USER.id,
        api_key_id: null,
      };
      strategyKeysProbe.count = null;
      strategyKeysProbe.error = { message: "connection reset" };
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const { POST } = await import("./route");
      const res = await POST(makeReq({ strategy_id: TEST_STRATEGY_ID }));

      expect(res.status).toBe(503);
      expect(mockUpsert).toHaveBeenCalledTimes(1);
      const stamp = mockUpsert.mock.calls[0][0] as Record<string, unknown>;
      expect(stamp).toMatchObject({
        strategy_id: TEST_STRATEGY_ID,
        computation_status: "failed",
        computation_warned: false,
        data_quality_flags: { csv_source: true, membership_unknown: true },
      });
      // Membership was NOT established — must NOT claim composite.
      expect(
        (stamp.data_quality_flags as Record<string, unknown>).composite,
      ).toBeUndefined();

      // Never fall open: no sync_trades enqueue, no unified delegate.
      expect(mockRpc).not.toHaveBeenCalledWith(
        "enqueue_compute_job",
        expect.objectContaining({ p_kind: "sync_trades" }),
      );
      expect(mockPostProcessKey).not.toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    // Pin 4 (sibling) — a null count with NO error is ALSO unknowable (PostgREST
    // can return count===null without erroring); `(count ?? 0) > 0` would fall
    // OPEN. Pin the fail-closed stamp on this branch too.
    it("fails CLOSED when the strategy_keys count is null without an error", async () => {
      process.env.USE_COMPUTE_JOBS_QUEUE = "true";
      ownershipResult.data = {
        id: TEST_STRATEGY_ID,
        user_id: TEST_USER.id,
        api_key_id: null,
      };
      strategyKeysProbe.count = null;
      strategyKeysProbe.error = null;
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const { POST } = await import("./route");
      const res = await POST(makeReq({ strategy_id: TEST_STRATEGY_ID }));

      expect(res.status).toBe(503);
      const stamp = mockUpsert.mock.calls[0][0] as Record<string, unknown>;
      expect(stamp).toMatchObject({
        computation_status: "failed",
        data_quality_flags: { csv_source: true, membership_unknown: true },
      });
      expect(mockRpc).not.toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    // Pin 5a — NEUTRALITY: a single-key strategy (api_key_id SET) issues NO
    // strategy_keys probe and keeps the existing sync_trades queue behavior.
    it("neutrality — single-key (api_key_id set) issues NO strategy_keys probe and enqueues sync_trades", async () => {
      process.env.USE_COMPUTE_JOBS_QUEUE = "true";
      ownershipResult.data = {
        id: TEST_STRATEGY_ID,
        user_id: TEST_USER.id,
        api_key_id: "33333333-3333-3333-3333-333333333333",
      };

      const { POST } = await import("./route");
      const res = await POST(makeReq({ strategy_id: TEST_STRATEGY_ID }));

      expect(res.status).toBe(202);
      // The composite probe is gated on api_key_id === null — a UUID must skip it.
      expect(mockStrategyKeysSelect).not.toHaveBeenCalled();
      // Existing single-key queue behavior unchanged.
      expect(mockRpc).toHaveBeenCalledWith("enqueue_compute_job", {
        p_strategy_id: TEST_STRATEGY_ID,
        p_kind: "sync_trades",
        p_metadata: { correlation_id: TEST_CORRELATION_ID },
      });
    });

    // Pin 5b — NEUTRALITY: a zero-member CSV strategy (api_key_id null, count 0)
    // falls THROUGH to the existing paths unchanged — the sole added cost is one
    // head-count read.
    it("neutrality — zero-member CSV (api_key_id null, count 0) falls through to sync_trades after one probe", async () => {
      process.env.USE_COMPUTE_JOBS_QUEUE = "true";
      ownershipResult.data = {
        id: TEST_STRATEGY_ID,
        user_id: TEST_USER.id,
        api_key_id: null,
      };
      strategyKeysProbe.count = 0;

      const { POST } = await import("./route");
      const res = await POST(makeReq({ strategy_id: TEST_STRATEGY_ID }));

      expect(res.status).toBe(202);
      // Exactly one head-count read, then fall through.
      expect(mockStrategyKeysSelect).toHaveBeenCalledTimes(1);
      // Falls through to the existing legacy queue path (sync_trades), NOT
      // stitch_composite.
      expect(mockRpc).toHaveBeenCalledWith("enqueue_compute_job", {
        p_strategy_id: TEST_STRATEGY_ID,
        p_kind: "sync_trades",
        p_metadata: { correlation_id: TEST_CORRELATION_ID },
      });
      expect(mockRpc).not.toHaveBeenCalledWith(
        "enqueue_compute_job",
        expect.objectContaining({ p_kind: "stitch_composite" }),
      );
      // UAT/F-1 neutrality: the asset_class='crypto' derive is scoped to the
      // composite dispatch branch — a zero-member CSV must NOT have its
      // asset_class rewritten (its picker choice / traditional default stands).
      expect(mockStrategiesUpdate).not.toHaveBeenCalled();
    });

    // UAT/F-1 — ORDERING: the asset_class='crypto' derive must land BEFORE the
    // stitch_composite enqueue. Falsifiable: if the enqueue moved above the
    // derive, the worker could claim the job and read the stale 'traditional'
    // asset_class before the update committed → the √252-vs-√365 fail-loud races
    // back. invocationCallOrder pins the sequence.
    it("derives asset_class='crypto' BEFORE enqueuing stitch_composite", async () => {
      process.env.USE_COMPUTE_JOBS_QUEUE = "true";
      ownershipResult.data = {
        id: TEST_STRATEGY_ID,
        user_id: TEST_USER.id,
        api_key_id: null,
      };
      strategyKeysProbe.count = 2;

      const { POST } = await import("./route");
      const res = await POST(makeReq({ strategy_id: TEST_STRATEGY_ID }));

      expect(res.status).toBe(202);
      expect(mockStrategiesUpdate).toHaveBeenCalledWith({ asset_class: "crypto" });
      expect(mockRpc).toHaveBeenCalledWith(
        "enqueue_compute_job",
        expect.objectContaining({ p_kind: "stitch_composite" }),
      );
      const deriveOrder = mockStrategiesUpdate.mock.invocationCallOrder[0];
      const enqueueOrder = mockRpc.mock.invocationCallOrder[0];
      expect(deriveOrder).toBeLessThan(enqueueOrder);
    });

    // ── Finding-M (MEDIUM): terminal-stamp write errors must be LOGGED ──────
    // Both fail-loud stamps (queue-off composite + membership-unknown) upsert a
    // terminal 'failed' row. The upsert result was previously discarded, so a
    // failed "fail-loud" stamp was silently swallowed. Capturing { error } and
    // logging it is the fix; these pins neuter by asserting the log fires.

    // Finding-M (a) — queue-off composite stamp failure is logged, not swallowed.
    it("[Finding-M] logs a failed terminal 'failed' stamp on the queue-off composite path", async () => {
      // USE_COMPUTE_JOBS_QUEUE unset (default OFF) → composite fails loud.
      ownershipResult.data = {
        id: TEST_STRATEGY_ID,
        user_id: TEST_USER.id,
        api_key_id: null,
      };
      strategyKeysProbe.count = 2;
      mockUpsert.mockReturnValue({ error: { message: "stamp write denied" } });
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const { POST } = await import("./route");
      const res = await POST(makeReq({ strategy_id: TEST_STRATEGY_ID }));

      expect(res.status).toBe(503);
      // The swallowed-error bug: without capturing the upsert result the failure
      // is silently discarded. Assert it is logged with the stamp-failure marker.
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          "failed to stamp terminal 'failed' (queue-off composite)",
        ),
        expect.objectContaining({ message: "stamp write denied" }),
      );
      consoleSpy.mockRestore();
    });

    // Finding-M (b) — membership-unknown stamp failure is logged, not swallowed.
    it("[Finding-M] logs a failed membership_unknown stamp on the fail-closed path", async () => {
      process.env.USE_COMPUTE_JOBS_QUEUE = "true";
      ownershipResult.data = {
        id: TEST_STRATEGY_ID,
        user_id: TEST_USER.id,
        api_key_id: null,
      };
      strategyKeysProbe.count = null;
      strategyKeysProbe.error = { message: "connection reset" };
      mockUpsert.mockReturnValue({ error: { message: "stamp write denied" } });
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const { POST } = await import("./route");
      const res = await POST(makeReq({ strategy_id: TEST_STRATEGY_ID }));

      expect(res.status).toBe(503);
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          "failed to stamp terminal 'failed' (membership_unknown)",
        ),
        expect.objectContaining({ message: "stamp write denied" }),
      );
      consoleSpy.mockRestore();
    });

    // ── R2-1 (MEDIUM): fail-closed stamp must NOT clobber a mature/published row ─
    // keys/sync runs REPEATEDLY on mature rows (ApiKeyManager resync, wizard
    // revisit). A raw upsert of computation_status:'failed' replaces
    // data_quality_flags WHOLESALE, so ONE transient strategy_keys 5xx would
    // flip a PUBLISHED complete composite to 'failed' and drop
    // per_key/gap_spans/... The stamp is now guarded on an existing complete row.

    // R2-1 (a) — membership-unknown path: existing 'complete' + count error →
    // row preserved (no clobber), 503 returned.
    it("[R2-1] preserves an existing 'complete' row when the membership probe errors (no clobber)", async () => {
      process.env.USE_COMPUTE_JOBS_QUEUE = "true";
      ownershipResult.data = {
        id: TEST_STRATEGY_ID,
        user_id: TEST_USER.id,
        api_key_id: null,
      };
      strategyKeysProbe.count = null;
      strategyKeysProbe.error = { message: "connection reset" };
      // A PUBLISHED, COMPLETE composite already exists.
      analyticsExisting.data = { computation_status: "complete" };
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const { POST } = await import("./route");
      const res = await POST(makeReq({ strategy_id: TEST_STRATEGY_ID }));

      // Still fails the request closed (503) — but the destructive stamp is
      // SKIPPED, so the live completed derive (and its data_quality_flags) survive.
      expect(res.status).toBe(503);
      expect(mockUpsert).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("preserving existing completed derive"),
      );
      // Never falls open to a single-key dispatch either.
      expect(mockRpc).not.toHaveBeenCalledWith(
        "enqueue_compute_job",
        expect.objectContaining({ p_kind: "sync_trades" }),
      );
      warnSpy.mockRestore();
      errSpy.mockRestore();
    });

    // R2-1 (b) — queue-off composite path: existing 'complete' → row preserved.
    it("[R2-1] preserves an existing 'complete' row on the queue-off composite path (no clobber)", async () => {
      // USE_COMPUTE_JOBS_QUEUE unset (default OFF) → composite fails loud.
      ownershipResult.data = {
        id: TEST_STRATEGY_ID,
        user_id: TEST_USER.id,
        api_key_id: null,
      };
      strategyKeysProbe.count = 2;
      analyticsExisting.data = { computation_status: "complete" };
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const { POST } = await import("./route");
      const res = await POST(makeReq({ strategy_id: TEST_STRATEGY_ID }));

      expect(res.status).toBe(503);
      expect(mockUpsert).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("preserving existing completed derive"),
      );
      warnSpy.mockRestore();
    });

    // R2-1 (c) — a genuine first-derive (NO existing row) still stamps 'failed'
    // loud, so the guard doesn't swallow the fail-loud signal for real failures.
    it("[R2-1] still stamps 'failed' loud on a genuine first-derive (no existing complete row)", async () => {
      ownershipResult.data = {
        id: TEST_STRATEGY_ID,
        user_id: TEST_USER.id,
        api_key_id: null,
      };
      strategyKeysProbe.count = 2;
      analyticsExisting.data = null; // no prior derive
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const { POST } = await import("./route");
      const res = await POST(makeReq({ strategy_id: TEST_STRATEGY_ID }));

      expect(res.status).toBe(503);
      expect(mockUpsert).toHaveBeenCalledTimes(1);
      const stamp = mockUpsert.mock.calls[0][0] as Record<string, unknown>;
      expect(stamp).toMatchObject({
        strategy_id: TEST_STRATEGY_ID,
        computation_status: "failed",
        data_quality_flags: { csv_source: true, composite: true },
      });
      consoleSpy.mockRestore();
    });
  });
});

// ── UAT tripwire: the composite asset_class='crypto' hardcode ────────────────
// Both the preview kickoff (this route) and finalize-wizard HARDCODE
// asset_class='crypto' for a composite, ahead of the worker's real venue-blend
// annualization. That is correct ONLY while every SUPPORTED_EXCHANGES venue is
// crypto (√365). Non-crypto venues are on the roadmap (e.g. MetaTrader5, a
// traditional √252 venue). When one is added, an all-MT5 composite would blend
// to √252 while these hardcodes assert √365 — the worker guard would fail-loud
// (safe, but it BLOCKS the composite), and a mixed composite could mis-label.
// This test reddens the instant the supported set changes, forcing whoever adds
// the venue to replace the hardcodes with a per-member-venue derive
// (isCryptoExchange over the members, mirroring "365 if ANY leg crypto else 252").
describe("[UAT] composite asset_class hardcode tripwire", () => {
  it("every SUPPORTED_EXCHANGES venue is crypto — else the 'crypto' hardcode must be revisited", () => {
    // Sorted exact pin: adding ANY venue (crypto or not) reddens this and forces
    // a conscious review of the keys/sync + finalize-wizard asset_class derive.
    expect([...SUPPORTED_EXCHANGES].sort()).toEqual([
      "binance",
      "bybit",
      "deribit",
      "okx",
    ]);
  });
});
