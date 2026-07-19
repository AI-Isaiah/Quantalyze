import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { SUPPORTED_EXCHANGES } from "@/lib/closed-sets";

/**
 * Tests for POST /api/keys/sync.
 *
 * Stage B (106-07) retired the legacy compute-jobs-queue / after()
 * fire-and-forget handler and the unified-backbone flag branch (the
 * kill-switch reader was deleted in 106-10): the
 * unified backbone (postProcessKey, flow_type=resync) is now the unconditional
 * single-key dispatch, and the composite-first `stitch_composite` kickoff is
 * hoisted ahead of it. These tests exercise that unified dispatch plus the
 * composite-first branch and its fail-closed guards.
 *
 * Mocking strategy:
 *   - vi.mock @/lib/supabase/server      → user-scoped client (ownership check
 *                                           + unified exchange resolver)
 *   - vi.mock @/lib/supabase/admin       → service-role client (RPC + upsert +
 *                                           strategy_keys probe + api_keys read)
 *   - vi.mock @/lib/ratelimit            → rate limiter
 *   - vi.mock @/lib/process-key-client   → unified backbone delegate
 */

const VALID_ORIGIN = { origin: "http://localhost:3000" };

// vi.hoisted runs before module-level `const`, so all hoisted
// state must be self-contained — no cross-references to top-level consts.
const {
  TEST_USER,
  mockRpc,
  mockUpsert,
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
  // 106-07: the unified delegate (now the unconditional single-key dispatch).
  mockPostProcessKey,
  // UAT/F-1: spy on the composite kickoff's asset_class='crypto' force-derive
  // (strategies update BEFORE the stitch enqueue) so a regression that drops it
  // — re-opening the √252-vs-√365 preview fail-loud — reddens.
  mockStrategiesUpdate,
} = vi.hoisted(() => ({
  TEST_USER: { id: "00000000-0000-0000-0000-aaaaaaaaaaaa" },
  mockRpc: vi.fn(),
  mockUpsert: vi.fn(),
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
  mockPostProcessKey: vi.fn(),
  mockStrategiesUpdate: vi.fn(),
  ownershipQuery: {
    table: null as string | null,
    selectCols: null as string | null,
    // Filters captured as [column, value] pairs from each .eq() link.
    filters: [] as Array<[string, unknown]>,
    // Only the ownership check (select includes user_id) is captured; the
    // unified exchange resolver's second select("api_key_id") must not clobber
    // the recorded ownership contract.
    capturing: false as boolean,
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
    // H-0275: the mock introspects the table name + select columns + every
    // .eq() filter for the OWNERSHIP query (the one that selects user_id).
    // Tests assert the route hit `from("strategies").select("id, user_id,
    // api_key_id")` filtered by BOTH `id` and `user_id`. The unified exchange
    // resolver's later select("api_key_id") on the same table is NOT captured.
    from: (table: string) => {
      ownershipQuery.table = table;
      const builder = {
        select: (cols: string) => {
          if (cols.includes("user_id")) {
            ownershipQuery.selectCols = cols;
            ownershipQuery.capturing = true;
          } else {
            ownershipQuery.capturing = false;
          }
          return builder;
        },
        eq: (col: string, val: unknown) => {
          if (ownershipQuery.capturing) ownershipQuery.filters.push([col, val]);
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
    // 89-02 / 106-07: the admin `from` branches by table. `strategy_keys` serves
    // the composite membership head-count probe; `strategy_analytics` serves the
    // fail-closed stamp seam; `strategies` the composite asset_class derive;
    // `api_keys` the unified exchange resolver.
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
      if (table === "api_keys") {
        // 106-07: the unified single-key resolver reads api_keys.exchange to
        // resolve `source` instead of hardcoding 'okx'.
        return {
          select: (_cols: string) => ({
            eq: (_col: string, _val: unknown) => ({
              single: () =>
                Promise.resolve({ data: { exchange: "okx" }, error: null }),
            }),
          }),
        };
      }
      return { upsert: mockUpsert };
    },
  }),
}));

vi.mock("@/lib/sentry-capture", () => ({
  captureToSentry: vi.fn(),
}));

// 106-07: the unified single-key delegate — now the unconditional dispatch.
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

vi.mock("@/lib/csrf", () => ({
  assertSameOrigin: () => null,
}));

// `@/lib/audit` pulls in `server-only` which throws under vitest+jsdom.
// The route emits `sync.start` on the composite queue branch; stub the
// emission out but keep the spy so the shape can be asserted.
vi.mock("server-only", () => ({}));
vi.mock("@/lib/audit", () => ({
  // B4b: both sync.start emits ride the service path (log_audit_event_service —
  // JWT-immune) with the explicit acting-user id. Event object is the THIRD arg
  // (admin, actingUserId, event).
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
  beforeEach(() => {
    vi.clearAllMocks();
    rateLimitResult.success = true;
    rateLimitResult.retryAfter = 0;
    ownershipResult.data = { id: TEST_STRATEGY_ID, user_id: TEST_USER.id };
    ownershipQuery.table = null;
    ownershipQuery.selectCols = null;
    ownershipQuery.filters = [];
    ownershipQuery.capturing = false;
    authState.user = { id: TEST_USER.id };
    // 89-02: reset composite probe to its neutral default so single-key/CSV
    // pins run byte-identically (no probe fires unless a fixture sets
    // api_key_id: null).
    strategyKeysProbe.count = 0;
    strategyKeysProbe.error = null;
    // R2-1: default to NO prior derive so the existing stamp pins still stamp.
    analyticsExisting.data = null;
    analyticsExisting.error = null;
    // 106-07: the unified delegate resolves a normal 202 resync by default.
    mockPostProcessKey.mockResolvedValue({ ok: true, body: { queued: true } });

    // Default mock implementations
    mockRpc.mockResolvedValue({ data: TEST_JOB_ID, error: null });
    mockUpsert.mockReturnValue({ error: null });
  });

  // ── Unified single-key dispatch happy path ──────────────────────
  it("routes a single-key strategy through the unified backbone and returns 202", async () => {
    const { POST } = await import("./route");
    const res = await POST(makeReq({ strategy_id: TEST_STRATEGY_ID }));

    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body).toMatchObject({
      ok: true,
      accepted: true,
      strategy_id: TEST_STRATEGY_ID,
      status: "syncing",
      composite: false,
    });

    // Unified backbone is the unconditional single-key dispatch.
    expect(mockPostProcessKey).toHaveBeenCalledWith(
      expect.objectContaining({
        flow_type: "resync",
        context: expect.objectContaining({ strategy_id: TEST_STRATEGY_ID }),
      }),
    );
    // No direct queue enqueue on the single-key path.
    expect(mockRpc).not.toHaveBeenCalled();
  });

  // ── Ownership mismatch / not-found → 404 (P458) ────────────────
  // P458 (audit-2026-05-07): uniform 404 for BOTH "no such strategy" AND
  // "exists but unowned" so an attacker cannot infer existence from the
  // status/message asymmetry.
  it("P458 — returns 404 with uniform message when ownership check returns no row", async () => {
    ownershipResult.data = null;

    const { POST } = await import("./route");
    const res = await POST(makeReq({ strategy_id: TEST_STRATEGY_ID }));

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("Strategy not found");
    // The message must NOT leak the unowned-vs-not-found distinction.
    expect(body.error).not.toMatch(/owned/i);

    // No dispatch should have been reached.
    expect(mockRpc).not.toHaveBeenCalled();
    expect(mockPostProcessKey).not.toHaveBeenCalled();
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

  // ── Rate limit exceeded → 429 ───────────────────────────────────
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
    expect(mockPostProcessKey).not.toHaveBeenCalled();
  });

  // ── Missing strategy_id → 400 ───────────────────────────────────
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

  // ── C-0101: no sync.start audit on the 429 branch ──────────────────
  it("[C-0101] does NOT emit sync.start on the 429 rate-limit branch", async () => {
    rateLimitResult.success = false;
    rateLimitResult.retryAfter = 7;

    const { POST } = await import("./route");
    const res = await POST(makeReq({ strategy_id: TEST_STRATEGY_ID }));
    expect(res.status).toBe(429);

    // Nothing audit-worthy happened — the request never reached a sync branch.
    expect(mockLogAuditEvent).not.toHaveBeenCalled();
  });

  // ── H-0306: unmocked withAuth auth boundary → 401 ──────────────────
  // This route wraps the handler in the REAL withAuth (it does NOT mock it),
  // so a missing session must short-circuit at 401 BEFORE any rate-limit,
  // ownership, RPC, or dispatch work runs.
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
    expect(mockPostProcessKey).not.toHaveBeenCalled();
    expect(mockUpsert).not.toHaveBeenCalled();
    expect(mockLogAuditEvent).not.toHaveBeenCalled();
  });

  // ── H-0275: ownership query targets the right table + filters ──────
  // The ownership check must hit strategies filtered by BOTH id AND user_id.
  // Dropping user_id would let any authenticated user sync any strategy.
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
    // ownership fence.
    expect(ownershipQuery.filters).toContainEqual(["id", TEST_STRATEGY_ID]);
    expect(ownershipQuery.filters).toContainEqual(["user_id", TEST_USER.id]);
  });

  // ── 89-02: composite-first kickoff branch ──────────────────────────────
  // The preview step (wizard index 2) POSTs /api/keys/sync BEFORE finalize.
  // For a member-bearing composite (strategies.api_key_id === null AND a
  // strategy_keys count > 0) the route must enqueue the SAME production
  // `stitch_composite` job finalize enqueues — never sync_trades, never the
  // unified single-key resync — and it must do so BEFORE the unified dispatch
  // (the unified single-key arm cannot honestly derive a NULL-api_key
  // composite). This mirrors the Phase-88 finalize-wizard hoist.
  describe("composite-first kickoff (stitch_composite)", () => {
    // Pin 1 — happy path: api_key_id null + count 2 → stitch_composite.
    it("enqueues stitch_composite (not sync_trades) for a member-bearing composite", async () => {
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
      // NEVER the single-key kind for a composite.
      expect(mockRpc).not.toHaveBeenCalledWith(
        "enqueue_compute_job",
        expect.objectContaining({ p_kind: "sync_trades" }),
      );
      // A composite must NEVER be routed through the unified single-key resync.
      expect(mockPostProcessKey).not.toHaveBeenCalled();

      // UAT/F-1: force-derive asset_class='crypto' BEFORE the stitch dispatch.
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

    // Pin 2 — HOIST ORDERING (T-89-05): the composite branch is hoisted AHEAD of
    // the unified single-key dispatch, so a member-bearing composite enqueues
    // stitch_composite and the unified delegate is never invoked. Falsifiable:
    // moving the branch below the unified dispatch reddens this.
    it("wins BEFORE the unified single-key dispatch — enqueues stitch_composite, never postProcessKey", async () => {
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

    // Pin 3 — FAIL CLOSED on unknowable membership (W-4 / T-88-10 posture):
    // a count error MUST stamp a terminal 'failed' with membership_unknown:true
    // (NOT composite:true — membership unproven) and 503, never fall open to a
    // single-key dispatch of a possible composite.
    it("fails CLOSED (membership_unknown + 503) when the strategy_keys count errors", async () => {
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

    // Pin 3 (sibling) — a null count with NO error is ALSO unknowable (PostgREST
    // can return count===null without erroring); `(count ?? 0) > 0` would fall
    // OPEN. Pin the fail-closed stamp on this branch too.
    it("fails CLOSED when the strategy_keys count is null without an error", async () => {
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

    // Pin 4a — NEUTRALITY: a single-key strategy (api_key_id SET) issues NO
    // strategy_keys probe and routes to the unified backbone (postProcessKey).
    it("neutrality — single-key (api_key_id set) issues NO strategy_keys probe and routes to the unified handler", async () => {
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
      // Single-key resync now routes unconditionally through the unified backbone.
      expect(mockPostProcessKey).toHaveBeenCalledWith(
        expect.objectContaining({
          flow_type: "resync",
          context: expect.objectContaining({ strategy_id: TEST_STRATEGY_ID }),
        }),
      );
      // Never the composite stitch for a single-key strategy.
      expect(mockRpc).not.toHaveBeenCalledWith(
        "enqueue_compute_job",
        expect.objectContaining({ p_kind: "stitch_composite" }),
      );
    });

    // Pin 4b — NEUTRALITY: a zero-member CSV strategy (api_key_id null, count 0)
    // falls THROUGH to the unified backbone unchanged — the sole added cost is
    // one head-count read.
    it("neutrality — zero-member CSV (api_key_id null, count 0) falls through to the unified handler after one probe", async () => {
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
      // Falls through to the unified backbone, NOT stitch_composite.
      expect(mockPostProcessKey).toHaveBeenCalled();
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
    // stitch_composite enqueue. invocationCallOrder pins the sequence.
    it("derives asset_class='crypto' BEFORE enqueuing stitch_composite", async () => {
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
    // The membership-unknown fail-loud stamp upserts a terminal 'failed' row.
    // The upsert result was previously discarded, so a failed "fail-loud" stamp
    // was silently swallowed. Capturing { error } and logging it is the fix.
    it("[Finding-M] logs a failed membership_unknown stamp on the fail-closed path", async () => {
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
    it("[R2-1] preserves an existing 'complete' row when the membership probe errors (no clobber)", async () => {
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
    // sfox added v1.12 (SFOX-08): a crypto prime broker → isCryptoExchange
    // (SUPPORTED_EXCHANGES membership) classifies it √365, so the composite
    // asset_class='crypto' hardcode stays valid. Conscious review DONE.
    expect([...SUPPORTED_EXCHANGES].sort()).toEqual([
      "binance",
      "bybit",
      "deribit",
      "okx",
      "sfox",
    ]);
  });
});
