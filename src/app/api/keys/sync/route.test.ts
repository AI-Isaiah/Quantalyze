import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { SUPPORTED_EXCHANGES, CRYPTO_EXCHANGES } from "@/lib/closed-sets";

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
  rateLimitByBucket,
  ownershipResult,
  // H-0275: capture what the user-scoped ownership query actually touched
  // so the mock can FAIL when a regression points it at the wrong table or
  // drops a filter — the "mock so deep it can't fail" trap (Rule 9).
  ownershipQuery,
  // H-0306: the auth boundary. Flipped to null in the unauthed test so the
  // REAL withAuth (this route does NOT mock it) hits its 401 branch.
  authState,
  // 140.3-02 / TS-15: drives the session read that produces X-User-Access-Token.
  sessionState,
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
  // 140.3-10 / SEAMUX-03: the two throttle arms are TWO DISTINCT SITES. The
  // shared `rateLimitResult` above can only ever exercise the FIRST one (the
  // per-user ceiling short-circuits before the per-strategy bucket is read),
  // so a per-bucket override is what lets each site be driven — and reddened —
  // on its own.
  // 140.4-13 / SEAMRIM-05 — `reason` is the THIRD outcome: absent is a genuine
  // throttle (429), "ratelimit_misconfigured" is OUR store being unreachable
  // and must answer 503.
  rateLimitByBucket: {} as Record<
    string,
    {
      success: boolean;
      retryAfter: number;
      reason?: "ratelimit_misconfigured";
    }
  >,
  ownershipResult: {
    // 89-02: api_key_id joins the ownership row — null identifies a POSSIBLE
    // composite (members live in strategy_keys); a UUID is definitively
    // single-key. Undefined (the default fixtures) leaves the branch dormant.
    data: null as Record<string, string | null> | null,
    // 140.3-10 / TRAP-3: the ownership read is `.maybeSingle()` and its `error`
    // is now READ. A transport fault must become a 500 about us, never
    // "Strategy not found".
    error: null as { message: string; code?: string } | null,
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
  // 140.3-02 / TS-15: the session whose access_token is forwarded as
  // `X-User-Access-Token`. Nulled by the negative case, which asserts that an
  // absent session forwards NOTHING rather than a fabricated value.
  sessionState: {
    session: { access_token: "test-user-jwt" } as { access_token: string } | null,
  },
  checkLimitMock: vi.fn(),
}));

const TEST_STRATEGY_ID = "11111111-1111-1111-1111-111111111111";
const TEST_JOB_ID = "22222222-2222-2222-2222-222222222222";

// ── Module mocks ────────────────────────────────────────────────────

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: authState.user }, error: null }),
      // 140.3-02 / TS-15: the route reads the session to forward
      // `X-User-Access-Token`. `sessionState` is hoisted so a test can drive the
      // no-session case, which must forward NOTHING rather than fabricate a
      // value.
      getSession: async () => ({
        data: { session: sessionState.session },
        error: null,
      }),
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
        // 140.3-10 / TRAP-3: the OWNERSHIP read moved to `.maybeSingle()` and
        // now reads `error`. The unified exchange resolver's later
        // `select("api_key_id")` on the same table still uses `.single()`, so
        // both terminals live on this one builder.
        maybeSingle: async () => ownershipResult,
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

// ⚠️ EXTENDED, NOT REPLACED (140.4-13 / SEAMRIM-05). See the note in
// `src/__tests__/csv-validate-route.test.ts`: the pure helpers come from
// `importActual` so this mock cannot drift from the real 503-vs-429 decision.
// The per-bucket override below is what makes the TWO arms independently
// drivable, which 140.4-13's ledger row M105 depends on.
vi.mock("@/lib/ratelimit", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/ratelimit")>();
  return {
    userActionLimiter: null,
    keysSyncUserLimiter: null,
    checkLimit: (...args: unknown[]) => {
      checkLimitMock(...args);
      // 140.3-10: a per-bucket override wins over the shared default, so a test
      // can let the per-user ceiling PASS and deny only the per-strategy bucket
      // — the only way to reach the second throttle site at all. With no
      // override registered the behaviour is byte-identical to before.
      const bucket = typeof args[1] === "string" ? args[1] : "";
      const override = rateLimitByBucket[bucket];
      return Promise.resolve(override ?? rateLimitResult);
    },
    rateLimitDenyJson: actual.rateLimitDenyJson,
    isRateLimitMisconfigured: actual.isRateLimitMisconfigured,
  };
});

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
    for (const k of Object.keys(rateLimitByBucket)) delete rateLimitByBucket[k];
    ownershipResult.data = { id: TEST_STRATEGY_ID, user_id: TEST_USER.id };
    ownershipResult.error = null;
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
      // SEAMRIM-06 — the value now goes through `scrubSeamError`, so it arrives
      // as a STRING rather than the raw PostgREST object. The assertion is
      // strengthened rather than relaxed: it still pins that the stamp failure
      // is logged, and it additionally pins that the diagnosis SURVIVED the
      // scrub. Answering a scrub finding by DROPPING the value is the A-10
      // defect, and this line is what would catch it.
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          "failed to stamp terminal 'failed' (membership_unknown)",
        ),
        expect.stringContaining("stamp write denied"),
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
// asset_class='crypto' for a COMPOSITE (api_key_id NULL, ≥1 member), ahead of the
// worker's real venue-blend annualization. That is correct ONLY while every
// composite member venue is crypto (√365).
//
// MT5RECON-02 (Phase 136 — CONSCIOUS REVIEW DONE): mt5 (traditional forex/CFD
// √252) joined SUPPORTED_EXCHANGES in Phase 135. The SINGLE-KEY asset_class stamp
// is now VENUE-AWARE in BOTH key routes (create-with-key + finalize-wizard,
// `isCryptoExchange(exchange) ? 'crypto' : 'traditional'`), so a single-key mt5
// strategy is correctly √252. The COMPOSITE 'crypto' hardcode (this route + the
// finalize sibling) is DELIBERATELY RETAINED: an mt5 composite member fails LOUD
// at the worker's stitch unknown-venue gate (job_worker.py) — honest, and out of
// Phase-136 scope — so a composite can never silently ship an mt5 member
// mis-annualized on √365. The worker's √365-vs-asset_class cross-check reads the
// Python CRYPTO_VENUES registry (which also excludes mt5), so the two sides agree
// by construction. This test still reddens on the NEXT venue addition, forcing the
// same conscious review.
describe("[UAT] composite asset_class hardcode tripwire", () => {
  it("SUPPORTED_EXCHANGES pins the 6-venue key-save set; mt5 is the sole non-crypto venue (MT5RECON-02)", () => {
    // Sorted exact pin: adding ANY venue reddens this and forces a conscious
    // review of the keys/sync + finalize-wizard asset_class derive. sfox (v1.12,
    // SFOX-08) is a crypto prime broker → in CRYPTO_EXCHANGES → the composite
    // hardcode stays valid. mt5 (Phase 135) is traditional → EXCLUDED from
    // CRYPTO_EXCHANGES → single-key derive is venue-aware, composite fails loud at
    // the worker. Both reviews DONE.
    expect([...SUPPORTED_EXCHANGES].sort()).toEqual([
      "binance",
      "bybit",
      "deribit",
      "mt5",
      "okx",
      "sfox",
    ]);
    // The crypto subset that drives the √365 clock (#597) — mt5 is deliberately
    // absent, which is exactly what keeps a single-key mt5 strategy on √252.
    expect([...CRYPTO_EXCHANGES].sort()).toEqual([
      "binance",
      "bybit",
      "deribit",
      "okx",
      "sfox",
    ]);
    expect((CRYPTO_EXCHANGES as readonly string[]).includes("mt5")).toBe(false);
  });
});

/**
 * Phase 140.3-02 / TS-02 — the duplicate branch must key on the CODE ALONE.
 *
 * ⚠️ WHAT WAS WRONG, and why it was wrong in BOTH directions.
 *
 * The branch read `upstream.queued === false && upstream.code === "WIZARD_DUPLICATE"`.
 * `queued` and `code` are ORTHOGONAL facts on this reply — `queued` is a JOB fact
 * ("a compute job is now enqueued or running"), `code`/`idempotent` are a
 * SUBMISSION fact ("this submission was a duplicate"). Neither implies the other,
 * and `process_key.py:_resume_duplicate_job` exists precisely to produce the state
 * where BOTH are true: the RESUMED WEDGE — a duplicate submission whose wedged job
 * we re-enqueued. `_wizard_duplicate_reply` is ONE shared builder for both duplicate
 * emitters and it takes `queued` as a PARAMETER, so `queued: true` beside
 * `code: "WIZARD_DUPLICATE"` is the normal reply, not a backbone bug.
 *
 * So the `queued === false &&` conjunct SKIPPED the duplicate branch on exactly the
 * case that most needs it, and the user got a plain 202 "syncing" with no duplicate
 * code for a submission that was recognised as a duplicate. TS-01 established the
 * same fact on the finalize side, where `SubmitStep.tsx:156` already branches on
 * `data.code === "WIZARD_DUPLICATE"` alone — this route is the straggler.
 *
 * ORACLE INDEPENDENCE: every fixture key and every expected value below is a
 * hand-typed literal. Nothing is imported from the route or from the client.
 */
describe("[140.3-02 / TS-02] POST /api/keys/sync — the duplicate branch keys on the CODE, never on `queued`", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rateLimitResult.success = true;
    rateLimitResult.retryAfter = 0;
    // api_key_id SET → definitively single-key, so the composite hoist is skipped
    // and the request reaches the unified /process-key dispatch under test.
    ownershipResult.data = {
      id: TEST_STRATEGY_ID,
      user_id: TEST_USER.id,
      api_key_id: "33333333-3333-3333-3333-333333333333",
    };
    ownershipQuery.table = null;
    ownershipQuery.selectCols = null;
    ownershipQuery.filters = [];
    ownershipQuery.capturing = false;
    authState.user = { id: TEST_USER.id };
    strategyKeysProbe.count = 0;
    strategyKeysProbe.error = null;
    analyticsExisting.data = null;
    analyticsExisting.error = null;
    mockRpc.mockResolvedValue({ data: TEST_JOB_ID, error: null });
    mockUpsert.mockReturnValue({ error: null });
  });

  it("THE RESUMED WEDGE — `queued: true` WITH `code: WIZARD_DUPLICATE` takes the duplicate branch", async () => {
    // The exact reply `_resume_duplicate_job` produces, hand-typed from the
    // Python builder's own key set (process_key.py:_wizard_duplicate_reply).
    mockPostProcessKey.mockResolvedValue({
      ok: true,
      status: 200,
      body: {
        ok: true,
        code: "WIZARD_DUPLICATE",
        idempotent: true,
        verification_id: "55555555-5555-5555-5555-555555555555",
        status: "validated",
        trust_tier: "api_verified",
        correlation_id: "11111111-2222-3333-4444-555555555555",
        queued: true,
        job_state: "enqueued",
      },
    });

    const { POST } = await import("./route");
    const res = await POST(makeReq({ strategy_id: TEST_STRATEGY_ID }));
    const body = await res.json();

    // The duplicate branch answers 200 (idempotency is a feature, not a failure)
    // and NAMES the condition, so the wizard's WIZARD_DUPLICATE copy can render.
    expect(
      body.code,
      "A resumed-wedge reply carries `queued: true` AND `code: WIZARD_DUPLICATE`. " +
        "A branch conjoined on `queued === false` silently SKIPS the duplicate " +
        "case it exists for, and the user is told a duplicate submission is a " +
        "fresh sync — TS-02.",
    ).toBe("WIZARD_DUPLICATE");
    expect(res.status).toBe(200);
    expect(body.idempotent).toBe(true);
    expect(body.verification_id).toBe("55555555-5555-5555-5555-555555555555");
    // The upstream's preserved row status, not a fabricated "syncing".
    expect(body.status).toBe("validated");
    // THE JOB FACT IS FORWARDED HONESTLY. The branch used to hardcode
    // `queued: false`, which on a resumed wedge is a false statement about a job
    // that IS enqueued — re-pointing the branch without this would have moved
    // the lie rather than removed it.
    expect(
      body.queued,
      "A resumed wedge HAS an enqueued job. Reporting `queued: false` beside " +
        "`idempotent: true` states the opposite of what the backbone just did.",
    ).toBe(true);
    // Unified is a single-key resync path — never a composite.
    expect(body.composite).toBe(false);
    expect(body.ok).toBe(true);
    expect(body.accepted).toBe(true);
  });

  it("the no-job duplicate — `queued: false` WITH the code — still takes the duplicate branch", async () => {
    // The other shape the SAME builder emits: a duplicate for which no background
    // job applies. This case was already green; it is kept so the re-point is
    // proven to have WIDENED the branch rather than moved it.
    mockPostProcessKey.mockResolvedValue({
      ok: true,
      status: 200,
      body: {
        ok: true,
        code: "WIZARD_DUPLICATE",
        idempotent: true,
        verification_id: "66666666-6666-6666-6666-666666666666",
        status: "published",
        correlation_id: "11111111-2222-3333-4444-555555555555",
        queued: false,
        job_state: null,
      },
    });

    const { POST } = await import("./route");
    const res = await POST(makeReq({ strategy_id: TEST_STRATEGY_ID }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.code).toBe("WIZARD_DUPLICATE");
    expect(body.idempotent).toBe(true);
    expect(body.queued).toBe(false);
    expect(body.status).toBe("published");
  });

  it("NEGATIVE — an ordinary fresh enqueue (`queued: true`, NO code) is still a plain 202 with no duplicate vocabulary", async () => {
    // The guard against over-widening: dropping the `queued` conjunct must not
    // make every enqueue look like a duplicate.
    mockPostProcessKey.mockResolvedValue({
      ok: true,
      status: 202,
      body: {
        ok: true,
        queued: true,
        verification_id: "77777777-7777-7777-7777-777777777777",
        correlation_id: "11111111-2222-3333-4444-555555555555",
      },
    });

    const { POST } = await import("./route");
    const res = await POST(makeReq({ strategy_id: TEST_STRATEGY_ID }));
    const body = await res.json();

    expect(res.status).toBe(202);
    expect(body.code).toBeUndefined();
    expect(body.idempotent).toBeUndefined();
    expect(body.status).toBe("syncing");
    expect(body.queued).toBe(true);
  });
});

/**
 * Phase 140.3-02 / TS-15 — the resync flow forwards the end user's Supabase
 * access token to the choke point.
 *
 * WHY IT MATTERS: only the CSV finalize flow forwarded it before, so a
 * user-scoped (RLS-enforcing) Supabase client was unavailable on onboard/resync.
 * That is exactly why PYAPI-01's second defence layer had to be an explicit
 * Python `strategies` id+user_id filter rather than letting RLS do it. With the
 * token forwarded, that filter becomes belt-and-braces rather than the only belt.
 *
 * The header itself is emitted by the client, conditionally, from this VALUE —
 * these cases pin the value reaching the choke point, which is the whole of this
 * route's half of the contract. The redaction proof lives in
 * `route.seam.test.ts`, where the REAL client and the REAL transport run.
 */
describe("[140.3-02 / TS-15] POST /api/keys/sync — forwards X-User-Access-Token, and fabricates nothing without a session", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rateLimitResult.success = true;
    rateLimitResult.retryAfter = 0;
    ownershipResult.data = {
      id: TEST_STRATEGY_ID,
      user_id: TEST_USER.id,
      api_key_id: "33333333-3333-3333-3333-333333333333",
    };
    ownershipQuery.table = null;
    ownershipQuery.selectCols = null;
    ownershipQuery.filters = [];
    ownershipQuery.capturing = false;
    authState.user = { id: TEST_USER.id };
    sessionState.session = { access_token: "test-user-jwt" };
    strategyKeysProbe.count = 0;
    strategyKeysProbe.error = null;
    analyticsExisting.data = null;
    analyticsExisting.error = null;
    mockRpc.mockResolvedValue({ data: TEST_JOB_ID, error: null });
    mockUpsert.mockReturnValue({ error: null });
    mockPostProcessKey.mockResolvedValue({
      ok: true,
      status: 202,
      body: { ok: true, queued: true },
    });
  });

  it("threads the session access token into the choke point", async () => {
    const { POST } = await import("./route");
    const res = await POST(makeReq({ strategy_id: TEST_STRATEGY_ID }));

    expect(res.status).toBe(202);
    expect(
      mockPostProcessKey.mock.calls[0]?.[0]?.userAccessToken,
      "Without the token the analytics service cannot build a user-scoped, " +
        "RLS-enforcing client, and PYAPI-01's explicit Python ownership filter " +
        "is the ONLY belt rather than the second one — TS-15.",
    ).toBe("test-user-jwt");
    // The pre-existing tenant identity must survive alongside it: dropping
    // X-User-Id re-opens the CT-4 cross-tenant rate-limit-bucket defect.
    expect(mockPostProcessKey).toHaveBeenCalledWith(
      expect.objectContaining({ flow_type: "resync", userId: TEST_USER.id }),
    );
  });

  it("NEGATIVE — no readable session forwards NOTHING, and the resync still runs", async () => {
    sessionState.session = null;

    const { POST } = await import("./route");
    const res = await POST(makeReq({ strategy_id: TEST_STRATEGY_ID }));

    // Fabricating a value would be an elevation-of-privilege bug, not a shim.
    expect(mockPostProcessKey.mock.calls[0]?.[0]?.userAccessToken).toBeUndefined();
    // And the forwarding is an ENHANCEMENT, not a gate: the caller is already
    // authenticated and ownership is already proven, so an unreadable session
    // must not fail a resync on the money-onboarding chokepoint. (csv-finalize
    // fails CLOSED instead, because its SECURITY DEFINER RPC cannot run without
    // auth.uid() — the two directions are deliberate and different.)
    expect(res.status).toBe(202);
  });
});

describe("[140.3-10] POST /api/keys/sync — a code on every arm, and the TRAP-3 split", () => {
  // Own fixture rather than inheriting a sibling suite's: the arms under test
  // are reached BEFORE the ownership row matters, and a shared fixture that
  // pre-sets a limiter override or an api_key_id would silently change which
  // arm a case lands on.
  beforeEach(() => {
    vi.clearAllMocks();
    rateLimitResult.success = true;
    rateLimitResult.retryAfter = 0;
    for (const k of Object.keys(rateLimitByBucket)) delete rateLimitByBucket[k];
    ownershipResult.data = { id: TEST_STRATEGY_ID, user_id: TEST_USER.id };
    ownershipResult.error = null;
    authState.user = { id: TEST_USER.id };
    sessionState.session = { access_token: "test-user-jwt" };
    strategyKeysProbe.count = 0;
    strategyKeysProbe.error = null;
    analyticsExisting.data = null;
    analyticsExisting.error = null;
    mockPostProcessKey.mockResolvedValue({ ok: true, body: { queued: true } });
    mockRpc.mockResolvedValue({ data: TEST_JOB_ID, error: null });
    mockUpsert.mockReturnValue({ error: null });
  });

  // ══════════════════════════════════════════════════════════════════
  // Phase 140.3-10 / SEAMUX-03 + TRAP-3 + TRAP-4 — the C-8 unit.
  //
  // ⚠️ EACH ARM GETS ITS OWN CASE, WRITTEN OUT. Not a loop, not a
  // table-driven `it.each`. A parameterised verify that exercises one arm
  // certifies the others without ever touching them — which is exactly how
  // "5 of 7 routes" and "3 of 5 log sites" happened in this programme. The
  // two `"Too many requests"` arms in particular are TWO DISTINCT SITES
  // emitting the same sentence, and a single grep-shaped assertion cannot
  // tell them apart.
  // ══════════════════════════════════════════════════════════════════
  describe("[140.3-10 / SEAMUX-03] a machine code on every arm", () => {
    it("ARM 1 — the MISSING strategy_id 400 carries code MISSING_STRATEGY_ID", async () => {
      const { POST } = await import("./route");
      const res = await POST(makeReq({}));

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(
        body.code,
        "A consumer must be able to tell a missing id from a malformed one " +
          "without matching on the prose, which 140.3-12 is about to reword.",
      ).toBe("MISSING_STRATEGY_ID");
      expect(body.error).toBe("Missing strategy_id");
    });

    it("ARM 2 — the INVALID strategy_id 400 carries code INVALID_STRATEGY_ID", async () => {
      const { POST } = await import("./route");
      const res = await POST(makeReq({ strategy_id: "not-a-uuid" }));

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(
        body.code,
        "A malformed id is a DIFFERENT fact from an absent one — the caller " +
          "sent something, it just was not a uuid. Collapsing the two onto " +
          "one token leaves the consumer sniffing prose again.",
      ).toBe("INVALID_STRATEGY_ID");
      expect(body.error).toBe("Invalid strategy_id");
    });

    it("ARM 3 — the PER-USER ceiling 429 carries code RATE_LIMITED and its own wait", async () => {
      // Deny the aggregate ceiling ONLY. The per-strategy bucket is left
      // passing, so this case can only be satisfied by the first site.
      rateLimitByBucket[`keys-sync-user:${TEST_USER.id}`] = {
        success: false,
        retryAfter: 42,
      };

      const { POST } = await import("./route");
      const res = await POST(makeReq({ strategy_id: TEST_STRATEGY_ID }));

      expect(res.status).toBe(429);
      expect(res.headers.get("Retry-After")).toBe("42");
      const body = await res.json();
      expect(body.code).toBe("RATE_LIMITED");
      // The per-strategy bucket was never consulted — the ceiling short-
      // circuits first, which is what makes this site independently reachable.
      expect(checkLimitMock).toHaveBeenCalledTimes(1);
    });

    it("ARM 4 — the PER-(user, strategy) bucket 429 carries code RATE_LIMITED and its own wait", async () => {
      // Let the ceiling PASS and deny only the per-strategy bucket. This is
      // the arm the shared `rateLimitResult` can never reach, and the one a
      // "fix the 429 arm" reading leaves codeless.
      rateLimitByBucket[`keys-sync-user:${TEST_USER.id}`] = {
        success: true,
        retryAfter: 0,
      };
      rateLimitByBucket[`keys-sync:${TEST_USER.id}:${TEST_STRATEGY_ID}`] = {
        success: false,
        retryAfter: 9,
      };

      const { POST } = await import("./route");
      const res = await POST(makeReq({ strategy_id: TEST_STRATEGY_ID }));

      expect(res.status).toBe(429);
      // A DIFFERENT wait from ARM 3, so this assertion cannot be satisfied by
      // the first site accidentally answering.
      expect(res.headers.get("Retry-After")).toBe("9");
      const body = await res.json();
      expect(
        body.code,
        "Two distinct sites emit this sentence. Both must carry the code — " +
          "a grep of the string finds two hits but reads as one arm.",
      ).toBe("RATE_LIMITED");
      expect(checkLimitMock).toHaveBeenCalledTimes(2);
      // Nothing downstream ran.
      expect(mockPostProcessKey).not.toHaveBeenCalled();
    });

    it("ARM 5 — the absent-draft 404 carries code GATE_DRAFT_GONE", async () => {
      ownershipResult.data = null;
      ownershipResult.error = null;

      const { POST } = await import("./route");
      const res = await POST(makeReq({ strategy_id: TEST_STRATEGY_ID }));

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(
        body.code,
        "The SAME token finalize-wizard already emits for the same fact. One " +
          "fact, one token, across both routes.",
      ).toBe("GATE_DRAFT_GONE");
      expect(body.error).toBe("Strategy not found");
    });
  });

  /**
   * ══════════════════════════════════════════════════════════════════
   * 140.4-13 / SEAMRIM-05 — a limiter MISCONFIGURATION is not a throttle.
   *
   * ⚠️ THE PER-ARM SPLIT IS THE POINT, AND IT IS WHY THIS PLAN'S LEDGER ROW
   * MUTATES ARM 4 SPECIFICALLY. `keys/sync` has TWO `checkLimit` sites. A guard
   * — or a reviewer — asking "does this FILE route its deny through
   * `rateLimitDenyJson`?" stays satisfied with the second arm reverted to an
   * inlined 429, because the first arm still does. Only a case that drives that
   * specific bucket sees it. Each arm below is denied ALONE, with a DIFFERENT
   * `Retry-After`, so neither case can be satisfied by the other site answering.
   *
   * The AUTHENTICATED auth shape of the three this plan pins behaviourally.
   * ══════════════════════════════════════════════════════════════════
   */
  describe("[140.4-13 / SEAMRIM-05] the limiter's misconfiguration answers 503, per ARM", () => {
    it("ARM 3 (per-user ceiling) — ratelimit_misconfigured → 503, not 429", async () => {
      rateLimitByBucket[`keys-sync-user:${TEST_USER.id}`] = {
        success: false,
        retryAfter: 60,
        reason: "ratelimit_misconfigured",
      };

      const { POST } = await import("./route");
      const res = await POST(makeReq({ strategy_id: TEST_STRATEGY_ID }));

      expect(
        res.status,
        "Our Upstash store being unreachable is OUR outage. A 429 here tells " +
          "the allocator they are syncing too fast, which is false, and hides " +
          "the outage from the canary that watches 5xx.",
      ).toBe(503);
      expect(res.headers.get("Cache-Control")).toBe("private, no-store");
      expect(res.headers.get("Retry-After")).toBe("60");
      const body = await res.json();
      expect(body.code).toBe("SEAM_MISCONFIGURED");
      // The per-strategy bucket was never consulted — this is ARM 3 answering.
      expect(checkLimitMock).toHaveBeenCalledTimes(1);
      expect(mockPostProcessKey).not.toHaveBeenCalled();
    });

    it("ARM 4 (per-(user, strategy) bucket) — ratelimit_misconfigured → 503, not 429", async () => {
      // Ceiling PASSES; only the second bucket is misconfigured. This case is
      // reachable ONLY through the second call site.
      rateLimitByBucket[`keys-sync-user:${TEST_USER.id}`] = {
        success: true,
        retryAfter: 0,
      };
      rateLimitByBucket[`keys-sync:${TEST_USER.id}:${TEST_STRATEGY_ID}`] = {
        success: false,
        retryAfter: 60,
        reason: "ratelimit_misconfigured",
      };

      const { POST } = await import("./route");
      const res = await POST(makeReq({ strategy_id: TEST_STRATEGY_ID }));

      expect(
        res.status,
        "The SECOND arm. Reverting only this call site to an inlined 429 " +
          "leaves every file-level 'does it mention rateLimitDenyJson' check " +
          "green — that is exactly the mutation row M105 runs.",
      ).toBe(503);
      expect(res.headers.get("Cache-Control")).toBe("private, no-store");
      const body = await res.json();
      expect(body.code).toBe("SEAM_MISCONFIGURED");
      expect(checkLimitMock).toHaveBeenCalledTimes(2);
      expect(mockPostProcessKey).not.toHaveBeenCalled();
    });

    it("ARM 4 — a GENUINE throttle still answers 429 with its own byte-identical body", async () => {
      rateLimitByBucket[`keys-sync-user:${TEST_USER.id}`] = {
        success: true,
        retryAfter: 0,
      };
      rateLimitByBucket[`keys-sync:${TEST_USER.id}:${TEST_STRATEGY_ID}`] = {
        success: false,
        retryAfter: 9,
      };

      const { POST } = await import("./route");
      const res = await POST(makeReq({ strategy_id: TEST_STRATEGY_ID }));

      expect(res.status).toBe(429);
      expect(res.headers.get("Retry-After")).toBe("9");
      expect(res.headers.get("Cache-Control")).toBe("private, no-store");
      // Hand-typed from the pre-adoption source — `{error, code}` in THAT key
      // order — not read back off the builder.
      //
      // ⚠️ 140.4-16 / WR-03 — ASSERTED BYTE-WISE, BECAUSE `toEqual` DOES NOT
      // HOLD THE PROPERTY THIS COMMENT NAMES. `res.json()` parses to an object
      // and `toEqual` is a structural deep-equality: key order is not compared.
      // Measured — swapping the two keys at `keys/sync/route.ts:138` left this
      // case and its three siblings GREEN. Four receipts across four files were
      // asserting a property no assertion held, in the one phase that exists
      // because unfalsifiable receipts shipped. `res.text()` is the shape that
      // reddens. The structural claim is kept beside it, because a byte
      // comparison alone reports "strings differ" rather than which field moved.
      expect(await res.clone().text()).toBe(
        '{"error":"Too many requests","code":"RATE_LIMITED"}',
      );
      expect(await res.json()).toEqual({
        error: "Too many requests",
        code: "RATE_LIMITED",
      });
    });

    it("both buckets allowing → neither deny arm fires and the sync runs", async () => {
      rateLimitByBucket[`keys-sync-user:${TEST_USER.id}`] = {
        success: true,
        retryAfter: 0,
      };
      rateLimitByBucket[`keys-sync:${TEST_USER.id}:${TEST_STRATEGY_ID}`] = {
        success: true,
        retryAfter: 0,
      };

      const { POST } = await import("./route");
      const res = await POST(makeReq({ strategy_id: TEST_STRATEGY_ID }));

      expect(res.status).not.toBe(429);
      expect(res.status).not.toBe(503);
      expect(checkLimitMock).toHaveBeenCalledTimes(2);
      expect(mockPostProcessKey).toHaveBeenCalled();
    });
  });

  describe("[140.3-10 / TRAP-3] a Supabase transport fault is a 500 about US", () => {
    it("a query error becomes 500 DRAFT_LOOKUP_FAILED — never 'Strategy not found'", async () => {
      // The blip. `.single()` answered `data: null` here too, and the old code
      // discarded `error` — so this rendered "your draft is gone" over an
      // INTACT draft, during OUR outage, with start_fresh as the way forward.
      ownershipResult.data = null;
      ownershipResult.error = {
        message: "TypeError: fetch failed — ECONNRESET reaching db.supabase.co",
      };

      const { POST } = await import("./route");
      const res = await POST(makeReq({ strategy_id: TEST_STRATEGY_ID }));

      expect(
        res.status,
        "A transport failure is a statement about US. Answering 404 makes it " +
          "a statement about the user's data, and that statement is false.",
      ).toBe(500);
      const body = await res.json();
      expect(body.code).toBe("DRAFT_LOOKUP_FAILED");
      expect(body.error).toBe("Could not load draft");
      // The lie is named explicitly so a regression cannot pass by returning
      // some other 4xx that still claims the draft is gone.
      expect(body.error).not.toMatch(/not found/i);
      expect(body.code).not.toBe("GATE_DRAFT_GONE");
      // Nothing downstream ran.
      expect(mockPostProcessKey).not.toHaveBeenCalled();
      expect(mockRpc).not.toHaveBeenCalled();
    });

    it("the transport fault is LOGGED through scrubSeamError, not raw", async () => {
      // The scrubber's own contract is proven in seam-redaction's suite; what
      // this pins is that THIS log site routes through it. A hand-rolled scrub
      // (or none) is the class SEAMCORE-06 closed everywhere else.
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      // A value the LEAF actually knows to be a credential: postgrest embeds
      // the apikey it was handed in the error it throws, and that apikey is
      // the service role key.
      const SERVICE_KEY = "service-role-key-0123456789abcdef";
      const priorServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
      process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_KEY;
      ownershipResult.data = null;
      ownershipResult.error = {
        message: `connect ECONNREFUSED — apikey=${SERVICE_KEY}`,
      };

      try {
        const { POST } = await import("./route");
        await POST(makeReq({ strategy_id: TEST_STRATEGY_ID }));

        const logged = errSpy.mock.calls
          .map((c) => c.map((a) => String(a)).join(" "))
          .join("\n");
        expect(logged).toContain("[keys/sync] strategy lookup failed");
        expect(
          logged,
          "undici and postgrest both embed credentials in the message they " +
            "throw; a raw console.error is how one reaches a log sink.",
        ).not.toContain(SERVICE_KEY);
        // ...and the DIAGNOSIS survives. A scrub that also ate the syscall
        // token would pass the assertion above while leaving the operator with
        // an unusable line — that is the A-10 defect the preserve list exists
        // for, and it has to be asserted here or the pin is half a pin.
        expect(logged).toContain("ECONNREFUSED");
      } finally {
        if (priorServiceKey === undefined) {
          delete process.env.SUPABASE_SERVICE_ROLE_KEY;
        } else {
          process.env.SUPABASE_SERVICE_ROLE_KEY = priorServiceKey;
        }
        errSpy.mockRestore();
      }
    });
  });

  describe("[140.3-10 / P458] the split must NOT make not-found distinguishable from not-owned", () => {
    it("ANTI-REGRESSION — both produce a byte-identical response", async () => {
      const { POST } = await import("./route");

      // (a) No such strategy: the row simply is not there.
      ownershipResult.data = null;
      ownershipResult.error = null;
      const notFound = await POST(
        makeReq({ strategy_id: "33333333-3333-3333-3333-333333333333" }),
      );
      const notFoundBody = await notFound.text();

      // (b) Exists, but owned by someone else. The route's ownership select is
      // `.eq("user_id", user.id)`, so an unowned row is filtered out at the
      // database and arrives here as the same empty result — which is the
      // whole point of P458 and must stay true after the transport split.
      ownershipResult.data = null;
      ownershipResult.error = null;
      const notOwned = await POST(
        makeReq({ strategy_id: TEST_STRATEGY_ID }),
      );
      const notOwnedBody = await notOwned.text();

      expect(notOwned.status).toBe(notFound.status);
      expect(
        notOwnedBody,
        "Any asymmetry between these two lets an attacker enumerate which " +
          "strategy ids exist by probing them (P458, audit-2026-05-07).",
      ).toBe(notFoundBody);
      // Header sets must match too — a Retry-After or a cache directive on one
      // and not the other is an oracle just as usable as a body difference.
      expect([...notOwned.headers.keys()].sort()).toEqual(
        [...notFound.headers.keys()].sort(),
      );
    });
  });

  describe("[140.3-10 / SEAMUX-03] the two 503 arms are distinct facts", () => {
    it("an unknowable composite membership carries COMPOSITE_MEMBERSHIP_UNKNOWN", async () => {
      ownershipResult.data = {
        id: TEST_STRATEGY_ID,
        user_id: TEST_USER.id,
        api_key_id: null,
      };
      strategyKeysProbe.count = null;
      strategyKeysProbe.error = { message: "strategy_keys unavailable" };

      const { POST } = await import("./route");
      const res = await POST(makeReq({ strategy_id: TEST_STRATEGY_ID }));

      expect(res.status).toBe(503);
      const body = await res.json();
      expect(
        body.code,
        "finalize-wizard already emits this code from its mirror of the same " +
          "probe; this route was the straggler emitting it codeless.",
      ).toBe("COMPOSITE_MEMBERSHIP_UNKNOWN");
    });

    it("a failed stitch enqueue carries SYNC_KICKOFF_FAILED — a DIFFERENT code", async () => {
      ownershipResult.data = {
        id: TEST_STRATEGY_ID,
        user_id: TEST_USER.id,
        api_key_id: null,
      };
      strategyKeysProbe.count = 2;
      strategyKeysProbe.error = null;
      mockRpc.mockResolvedValue({ data: null, error: { message: "rpc down" } });

      const { POST } = await import("./route");
      const res = await POST(makeReq({ strategy_id: TEST_STRATEGY_ID }));

      expect(res.status).toBe(503);
      const body = await res.json();
      expect(
        body.code,
        "Membership was KNOWN here; the enqueue is what failed. Same sentence " +
          "and same status as the arm above, different cause, different token.",
      ).toBe("SYNC_KICKOFF_FAILED");
      expect(body.code).not.toBe("COMPOSITE_MEMBERSHIP_UNKNOWN");
    });
  });
});

/**
 * [140.5-06 / WP-14] 424 — TESTED WHERE IT CAN ACTUALLY ARRIVE.
 *
 * ⚠️ THE MEASUREMENT THAT MOTIVATES THIS. A producer/consumer audit of 424
 * across the service found it raised in exactly three places —
 * `routers/exchange.py` (`validate_key` and its two private helpers),
 * `routers/portfolio.py`'s verify-strategy arm, and `routers/process_key.py` —
 * and in NONE of `routers/match.py`, `routers/simulator.py` or
 * `routers/optimizer.py` (re-measured at this plan's base: `grep -c 424` → 0, 0,
 * 0 respectively, against 14 / 1 / 4 for the three real producers).
 *
 * Yet four match/optimize suites plus MatchEvalDashboard drive a 424 their
 * upstream cannot emit, while the five routes whose upstream CAN emit one —
 * this route, verify-strategy, validate-and-encrypt, create-with-key and
 * composite/add-key — measured ZERO mentions of it. Coverage pointed away from
 * where the status lives.
 *
 * `/api/keys/sync` reaches `/process-key`, so a 424 is on ITS wire. The body
 * below is `process_key.py`'s real one: that raise site returns
 * `_envelope_error(...)`, whose key set is `{ok, code, human_message,
 * debug_context, correlation_id, recoverable}` — FLAT, and NOT the nested
 * `service_error` envelope. `recoverable: true` is STATED at that site rather
 * than derived, because everything reaching the arm is retryable by
 * construction: that is what selected the arm.
 *
 * ⚠️ Note for whoever adds the sibling cases: the OTHER 424 producer emits a
 * DIFFERENT shape. `/api/validate-key` raises `VenueTransientHTTPException`,
 * which `main.py`'s dedicated handler serialises FLAT as `{detail: <scalar
 * str>, code, recoverable}` — a deliberate, documented departure from the
 * nested rule, recorded in the class docstring so nobody "unifies" it onto
 * `service_error`. So the three validate-key consumers need that shape, not
 * this one, and a fixture copied from here to there would be wrong.
 */
describe("[140.5-06 / WP-14] POST /api/keys/sync — an upstream 424 is forwarded as 424", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rateLimitResult.success = true;
    rateLimitResult.retryAfter = 0;
    for (const k of Object.keys(rateLimitByBucket)) delete rateLimitByBucket[k];
    ownershipResult.data = { id: TEST_STRATEGY_ID, user_id: TEST_USER.id };
    ownershipResult.error = null;
    authState.user = { id: TEST_USER.id };
    sessionState.session = { access_token: "test-user-jwt" };
    strategyKeysProbe.count = 0;
    strategyKeysProbe.error = null;
    analyticsExisting.data = null;
    analyticsExisting.error = null;
    mockRpc.mockResolvedValue({ data: TEST_JOB_ID, error: null });
    mockUpsert.mockReturnValue({ error: null });
  });

  it("forwards the upstream 424 STATUS and its machine code — the venue's fault stays the venue's fault", async () => {
    mockPostProcessKey.mockResolvedValue({
      ok: false,
      response: NextResponse.json(
        {
          ok: false,
          code: "EXCHANGE_UNAVAILABLE",
          human_message:
            "Your exchange did not answer. This is a problem at the venue — try again shortly.",
          debug_context: {
            verification_id: "77777777-7777-4777-8777-777777777777",
          },
          correlation_id: "11111111-2222-3333-4444-555555555555",
          recoverable: true,
        },
        { status: 424 },
      ),
    });

    const { POST } = await import("./route");
    const res = await POST(makeReq({ strategy_id: TEST_STRATEGY_ID }));
    const body = await res.json();

    expect(
      res.status,
      "424 is CALLER'S EXCHANGE. Collapsing it to a 5xx would claim OUR service " +
        "failed, which is false and — because a 4xx is breaker-inert while a 5xx " +
        "is not — would also let a venue outage trip our own circuit.",
    ).toBe(424);
    expect(
      body.code,
      "The machine code must survive the hop: it is what the wizard branches on " +
        "to tell a venue fault from one of ours.",
    ).toBe("EXCHANGE_UNAVAILABLE");
    expect(
      body.recoverable,
      "A venue may come back, so this arm is retryable. `recoverable: false` " +
        "here is the dead-end render B-01/B-22 describe.",
    ).toBe(true);
    expect(body.human_message).toContain("venue");
  });
});
