import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { STALL_THRESHOLD_MS } from "@/lib/sync-progress";

/**
 * Phase 95 / Plan 95-03 — GET /api/strategies/[id]/sync-progress
 *
 * PROG-02 (secretless surface) + PROG-03 (stall flag). The route reads the
 * owner-scoped SECURITY DEFINER RPC `get_user_compute_jobs`, filters to the
 * latest `stitch_composite` job, and PROJECTS Option A:
 * `{ jobStatus, stalled, memberProgress: [{seq, exchange, label, status}] }`.
 * The raw `compute_jobs.metadata` blob (source / correlation_id / any ciphertext)
 * never reaches the browser.
 *
 * Mocking strategy (cribbed from keys/sync/route.test.ts):
 *   - vi.mock @/lib/supabase/server → user-scoped client incl. .rpc; the .from()
 *     seam RECORDS every table it touches so the RT-1 structural pin can assert
 *     the route NEVER queries strategy_analytics.
 *   - vi.mock @/lib/ratelimit → limiter seam.
 *   - REAL withAuth (this route does NOT mock it) drives the 401 branch off the
 *     hoisted authState; the global src/test-setup.ts approval-gate mock lets it
 *     run end-to-end.
 *   - Date.now() is pinned (spy) so the staleness math is deterministic; every
 *     heartbeat is an ISO string a fixed delta before the pinned now.
 */

vi.mock("server-only", () => ({}));

const {
  authState,
  ownershipResult,
  ownershipQuery,
  rpcResult,
  fromCalls,
  rpcCalls,
  checkLimitMock,
  rateLimitResult,
} = vi.hoisted(() => ({
  authState: {
    user: { id: "00000000-0000-0000-0000-aaaaaaaaaaaa" } as { id: string } | null,
  },
  ownershipResult: {
    data: null as Record<string, string | null> | null,
  },
  ownershipQuery: {
    table: null as string | null,
    selectCols: null as string | null,
    filters: [] as Array<[string, unknown]>,
  },
  rpcResult: {
    data: null as unknown,
    error: null as { message: string } | null,
  },
  // Every table the user-scoped client touches, in order. The RT-1 structural
  // pin asserts "strategy_analytics" is NEVER among them.
  fromCalls: [] as string[],
  rpcCalls: [] as Array<[string, Record<string, unknown>]>,
  checkLimitMock: vi.fn(),
  rateLimitResult: { success: true as boolean, retryAfter: 0 },
}));

const TEST_USER_ID = "00000000-0000-0000-0000-aaaaaaaaaaaa";
const TEST_STRATEGY_ID = "11111111-1111-1111-1111-111111111111";

// Fixed "now" so heartbeat staleness is deterministic.
const NOW_ISO = "2026-07-12T12:00:00.000Z";
const NOW_MS = Date.parse(NOW_ISO);
/** ISO string `ms` milliseconds before the pinned now. */
const ago = (ms: number) => new Date(NOW_MS - ms).toISOString();

// ── Module mocks ────────────────────────────────────────────────────

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: authState.user }, error: null }),
    },
    from: (table: string) => {
      fromCalls.push(table);
      ownershipQuery.table = table;
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
    rpc: (name: string, args: Record<string, unknown>) => {
      rpcCalls.push([name, args]);
      return Promise.resolve(rpcResult);
    },
  }),
}));

vi.mock("@/lib/ratelimit", () => ({
  syncProgressLimiter: null,
  checkLimit: (...args: unknown[]) => {
    checkLimitMock(...args);
    return Promise.resolve(rateLimitResult);
  },
}));

// ── Helpers ─────────────────────────────────────────────────────────

function makeReq() {
  return new NextRequest(
    "http://localhost:3000/api/strategies/x/sync-progress",
    { method: "GET" },
  );
}
function makeCtx(id: string) {
  return { params: Promise.resolve({ id }) };
}
async function call(id: string) {
  const { GET } = await import("./route");
  return GET(makeReq(), makeCtx(id));
}

/** A `stitch_composite` job row as `get_user_compute_jobs` returns it. */
function stitchRow(
  over: Partial<{
    status: string;
    claimed_at: string | null;
    created_at: string;
    metadata: Record<string, unknown> | null;
  }> = {},
) {
  return {
    id: "22222222-2222-2222-2222-222222222222",
    strategy_id: TEST_STRATEGY_ID,
    kind: "stitch_composite",
    status: over.status ?? "running",
    claimed_at: over.claimed_at ?? ago(30_000),
    created_at: over.created_at ?? "2026-07-12T11:50:00.000Z",
    updated_at: NOW_ISO,
    metadata:
      over.metadata === undefined
        ? { member_progress: [], member_progress_at: ago(30_000) }
        : over.metadata,
  };
}

/**
 * A NON-stitch job row (`process_key_long`, `sync_trades`, …) as
 * `get_user_compute_jobs` returns it. The single-key wizard's jobs are all of
 * these kinds — which is exactly why the route, filtering to `stitch_composite`,
 * answered IDLE for every single-key strategy that ever had a job in flight.
 */
function otherKindRow(
  kind: string,
  over: Partial<{
    status: string;
    claimed_at: string | null;
    created_at: string;
    metadata: Record<string, unknown> | null;
  }> = {},
) {
  return {
    id: "33333333-3333-3333-3333-333333333333",
    strategy_id: TEST_STRATEGY_ID,
    kind,
    status: over.status ?? "running",
    claimed_at: over.claimed_at ?? ago(30_000),
    created_at: over.created_at ?? "2026-07-12T11:50:00.000Z",
    updated_at: NOW_ISO,
    metadata: over.metadata === undefined ? {} : over.metadata,
  };
}

// ── Tests ───────────────────────────────────────────────────────────

describe("GET /api/strategies/[id]/sync-progress", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(Date, "now").mockReturnValue(NOW_MS);
    authState.user = { id: TEST_USER_ID };
    ownershipResult.data = { id: TEST_STRATEGY_ID, user_id: TEST_USER_ID };
    ownershipQuery.table = null;
    ownershipQuery.selectCols = null;
    ownershipQuery.filters = [];
    rpcResult.data = [];
    rpcResult.error = null;
    fromCalls.length = 0;
    rpcCalls.length = 0;
    rateLimitResult.success = true;
    rateLimitResult.retryAfter = 0;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── Auth boundary (real withAuth) ─────────────────────────────────
  it("returns 401 when the session is missing (real withAuth boundary)", async () => {
    authState.user = null;
    const res = await call(TEST_STRATEGY_ID);
    expect(res.status).toBe(401);
    // Nothing past the gate ran.
    expect(checkLimitMock).not.toHaveBeenCalled();
    expect(fromCalls).toHaveLength(0);
    expect(rpcCalls).toHaveLength(0);
  });

  // ── B15 ordering: malformed id → 400 before limiter/DB ────────────
  it("returns 400 on a malformed id BEFORE any limiter or DB touch", async () => {
    const res = await call("not-a-uuid");
    expect(res.status).toBe(400);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(checkLimitMock).not.toHaveBeenCalled();
    expect(fromCalls).toHaveLength(0);
    expect(rpcCalls).toHaveLength(0);
  });

  // ── Uniform 404 (no existence oracle) ─────────────────────────────
  it("returns a uniform 404 for a valid-but-unowned id (no existence oracle)", async () => {
    ownershipResult.data = null; // ownership select misses
    const res = await call(TEST_STRATEGY_ID);
    expect(res.status).toBe(404);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    // Must not reach the RPC (no foreign-job read on an unowned id).
    expect(rpcCalls).toHaveLength(0);
    // Owner scope: strategies filtered by BOTH id AND user_id.
    expect(ownershipQuery.table).toBe("strategies");
    expect(ownershipQuery.filters).toContainEqual(["id", TEST_STRATEGY_ID]);
    expect(ownershipQuery.filters).toContainEqual(["user_id", TEST_USER_ID]);
  });

  // ── 200 owner + running job → EXACT Option A projection (no-blob pin) ──
  it("projects EXACTLY {jobStatus, stalled, memberProgress} and leaks no metadata/ciphertext", async () => {
    rpcResult.data = [
      stitchRow({
        status: "running",
        metadata: {
          // Forbidden blob fields — belt-and-suspenders: even if a rogue
          // writer stows ciphertext in metadata, a field-by-field projection
          // must drop ALL of it.
          source: "keys/sync",
          correlation_id: "cid-abcdef",
          api_key_encrypted: "SECRETVALUE",
          api_secret_encrypted: "SECRETVALUE",
          passphrase_encrypted: "SECRETVALUE",
          dek_encrypted: "SECRETVALUE",
          nonce: "SECRETVALUE",
          member_progress_at: ago(30_000),
          member_progress: [
            { seq: 1, exchange: "deribit", label: "Deribit main", status: "successful" },
            { seq: 2, exchange: "bybit", label: null, status: "in_process" },
          ],
        },
      }),
    ];

    const res = await call(TEST_STRATEGY_ID);
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    const body = await res.json();

    // Exact top-level whitelist — nothing else.
    expect(Object.keys(body).sort()).toEqual([
      "jobStatus",
      "memberProgress",
      "stalled",
    ]);
    expect(body).toEqual({
      jobStatus: "running",
      stalled: false, // fresh 30s heartbeat
      memberProgress: [
        { seq: 1, exchange: "deribit", label: "Deribit main", status: "successful" },
        { seq: 2, exchange: "bybit", label: null, status: "in_process" },
      ],
    });

    // No-blob pin: the serialized body must contain NONE of these substrings.
    const serialized = JSON.stringify(body);
    for (const forbidden of [
      "correlation_id",
      "source",
      "metadata",
      "member_progress_at",
      "claimed_at",
      "SECRETVALUE",
      // INFO-1 (plan-checker): assert ALL FIVE ciphertext column names absent.
      "api_key_encrypted",
      "api_secret_encrypted",
      "passphrase_encrypted",
      "dek_encrypted",
      "nonce",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  // ── Per-entry projection: exact keys + out-of-enum coercion ────────
  it("projects each member entry field-by-field, coercing an out-of-enum status to 'waiting'", async () => {
    rpcResult.data = [
      stitchRow({
        status: "running",
        metadata: {
          member_progress_at: ago(30_000),
          member_progress: [
            // out-of-enum status + missing exchange/label + string seq — the
            // projection must coerce, never spread.
            { seq: "3", status: "exploded", extra: "junk" },
          ],
        },
      }),
    ];
    const res = await call(TEST_STRATEGY_ID);
    const body = await res.json();
    expect(body.memberProgress).toHaveLength(1);
    const entry = body.memberProgress[0];
    expect(Object.keys(entry).sort()).toEqual([
      "exchange",
      "label",
      "seq",
      "status",
    ]);
    expect(entry).toEqual({
      seq: 3,
      exchange: null,
      label: null,
      status: "waiting", // coerced from "exploded"
    });
    // The rogue `extra` field never survives.
    expect(JSON.stringify(body)).not.toContain("junk");
  });

  // ── Security L1: non-string exchange/label project to null ────────
  it("projects a non-string exchange/label to null (uniform defensive projection)", async () => {
    rpcResult.data = [
      stitchRow({
        status: "running",
        metadata: {
          member_progress_at: ago(30_000),
          member_progress: [
            // A rogue non-string exchange (object) and label (number) must NOT
            // pass through verbatim — they harden to null like seq/status.
            { seq: 1, exchange: { nested: "obj" }, label: 42, status: "in_process" },
          ],
        },
      }),
    ];
    const res = await call(TEST_STRATEGY_ID);
    const body = await res.json();
    expect(body.memberProgress).toEqual([
      { seq: 1, exchange: null, label: null, status: "in_process" },
    ]);
    // The rogue nested object never survives the projection.
    expect(JSON.stringify(body)).not.toContain("nested");
  });

  // ── PROG-03 stall: TRUE past the 12-min threshold ─────────────────
  it("flags stalled:true when a running job's heartbeat is older than the threshold", async () => {
    rpcResult.data = [
      stitchRow({
        status: "running",
        metadata: {
          member_progress_at: ago(13 * 60_000), // 13 min > 12 min
          member_progress: [],
        },
      }),
    ];
    const res = await call(TEST_STRATEGY_ID);
    const body = await res.json();
    expect(body.stalled).toBe(true);
    expect(body.jobStatus).toBe("running");
  });

  // ── PROG-03 stall: 11-min is NOT stalled (the 12-vs-10 decision pin) ──
  it("does NOT flag an 11-min-stale heartbeat (12-min threshold, not 10)", async () => {
    // Guard the threshold constant itself so this pin can't drift silently.
    expect(STALL_THRESHOLD_MS).toBe(720_000);
    rpcResult.data = [
      stitchRow({
        status: "running",
        metadata: {
          member_progress_at: ago(11 * 60_000), // 11 min < 12 min
          member_progress: [],
        },
      }),
    ];
    const res = await call(TEST_STRATEGY_ID);
    const body = await res.json();
    // Would be TRUE under the plan's original 10-min threshold; the 95-02
    // WARNING-2 resolution widened it to 12 min for a slow-but-healthy member.
    expect(body.stalled).toBe(false);
  });

  // ── PROG-03 stall: fresh heartbeat → false ────────────────────────
  it("flags stalled:false when the heartbeat is fresh", async () => {
    rpcResult.data = [
      stitchRow({
        status: "running",
        metadata: {
          member_progress_at: ago(30_000),
          member_progress: [],
        },
      }),
    ];
    const res = await call(TEST_STRATEGY_ID);
    const body = await res.json();
    expect(body.stalled).toBe(false);
  });

  // ── PROG-03 stall: fallback chain member_progress_at ?? claimed_at ──
  it("falls back to claimed_at when there is no heartbeat yet (fresh claim → false)", async () => {
    rpcResult.data = [
      stitchRow({
        status: "running",
        claimed_at: ago(30_000),
        metadata: { member_progress: [] }, // no member_progress_at
      }),
    ];
    const res = await call(TEST_STRATEGY_ID);
    const body = await res.json();
    expect(body.stalled).toBe(false);
    expect(body.memberProgress).toEqual([]);
  });

  it("falls back to claimed_at when there is no heartbeat yet (stale claim → true)", async () => {
    rpcResult.data = [
      stitchRow({
        status: "running",
        claimed_at: ago(13 * 60_000),
        metadata: { member_progress: [] }, // no member_progress_at
      }),
    ];
    const res = await call(TEST_STRATEGY_ID);
    const body = await res.json();
    expect(body.stalled).toBe(true);
  });

  // ── RT-1 STRUCTURAL PIN: never reads strategy_analytics ───────────
  it("RT-1 — NEVER queries strategy_analytics (stall keys off the JOB, not analytics)", async () => {
    rpcResult.data = [stitchRow({ status: "running" })];
    const res = await call(TEST_STRATEGY_ID);
    expect(res.status).toBe(200);
    // The stall detector reads ONLY the job heartbeat; a pending-after-complete
    // strategy_analytics row (RT-1 re-stitch) must be UNSEEABLE here.
    expect(fromCalls).not.toContain("strategy_analytics");
    expect(fromCalls).toContain("strategies");
  });

  // ── Non-running statuses ──────────────────────────────────────────
  it("returns jobStatus:'done', stalled:false for a completed job", async () => {
    rpcResult.data = [
      stitchRow({
        status: "done",
        metadata: {
          member_progress_at: ago(13 * 60_000), // stale, but done ≠ stalled
          member_progress: [
            { seq: 1, exchange: "okx", label: "OKX", status: "successful" },
          ],
        },
      }),
    ];
    const res = await call(TEST_STRATEGY_ID);
    const body = await res.json();
    expect(body.jobStatus).toBe("done");
    expect(body.stalled).toBe(false);
  });

  it("returns stalled:false for a failed_retry job (queue retrying = progress)", async () => {
    rpcResult.data = [
      stitchRow({
        status: "failed_retry",
        metadata: {
          member_progress_at: ago(13 * 60_000), // stale, but retrying ≠ stalled
          member_progress: [],
        },
      }),
    ];
    const res = await call(TEST_STRATEGY_ID);
    const body = await res.json();
    expect(body.jobStatus).toBe("failed_retry");
    expect(body.stalled).toBe(false);
  });

  it("returns {jobStatus:null, stalled:false, memberProgress:[]} 200 when NO job of any kind exists", async () => {
    // ⚠️ 154-04 CHANGED THIS CASE'S PREMISE, not its expectation. It used to
    // drive a RUNNING `sync_trades` row and assert IDLE — pinning the very
    // hiding STALE-01a turned on: a job was in flight and the route said
    // nothing was. IDLE now means what it says, so the premise is the empty
    // job list. The old premise's new answer is asserted by
    // WIDEN-SINGLE-KEY-RUNNING below.
    rpcResult.data = [];
    const res = await call(TEST_STRATEGY_ID);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      jobStatus: null,
      stalled: false,
      memberProgress: [],
    });
  });

  // ── Latest stitch_composite by created_at, ignoring other kinds ───
  it("picks the LATEST stitch_composite by created_at and ignores other kinds", async () => {
    rpcResult.data = [
      // sync_trades with the newest created_at overall — must be ignored.
      {
        id: "aaaa1111-0000-0000-0000-000000000000",
        strategy_id: TEST_STRATEGY_ID,
        kind: "sync_trades",
        status: "done",
        claimed_at: ago(10_000),
        created_at: "2026-07-12T11:59:00.000Z",
        updated_at: NOW_ISO,
        metadata: {},
      },
      // Older stitch_composite (done).
      stitchRow({
        status: "done",
        created_at: "2026-07-12T11:40:00.000Z",
        metadata: { member_progress: [], member_progress_at: ago(30_000) },
      }),
      // Newest stitch_composite (running) — this is the one to project.
      {
        ...stitchRow({
          status: "running",
          created_at: "2026-07-12T11:55:00.000Z",
          metadata: {
            member_progress_at: ago(30_000),
            member_progress: [
              { seq: 1, exchange: "deribit", label: "D", status: "in_process" },
            ],
          },
        }),
        id: "bbbb2222-0000-0000-0000-000000000000",
      },
    ];
    const res = await call(TEST_STRATEGY_ID);
    const body = await res.json();
    expect(body.jobStatus).toBe("running");
    expect(body.memberProgress).toEqual([
      { seq: 1, exchange: "deribit", label: "D", status: "in_process" },
    ]);
  });

  // ── Rate limit ────────────────────────────────────────────────────
  it("returns 429 with Retry-After when the limiter denies", async () => {
    rateLimitResult.success = false;
    rateLimitResult.retryAfter = 7;
    const res = await call(TEST_STRATEGY_ID);
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("7");
    // Keyed per (user, strategy).
    expect(checkLimitMock).toHaveBeenCalledWith(
      null,
      `sync-progress:${TEST_USER_ID}:${TEST_STRATEGY_ID}`,
    );
    // Nothing past the limiter ran.
    expect(fromCalls).toHaveLength(0);
    expect(rpcCalls).toHaveLength(0);
  });

  // ── RPC failure degrades to an empty 200 (never hard-fails the poll) ──
  // SF-3: the degrade branch carries `degraded:true` so the client can tell
  // "couldn't read" apart from a real idle.
  it("degrades to a degraded:true 200 (never a hard fail) when the RPC errors", async () => {
    rpcResult.data = null;
    rpcResult.error = { message: "boom" };
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await call(TEST_STRATEGY_ID);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      jobStatus: null,
      stalled: false,
      memberProgress: [],
      degraded: true,
    });
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 154-04 — BYTE-IDENTITY PINS, WRITTEN AND OBSERVED GREEN *BEFORE* THE
  // KIND-FILTER WIDENING.
  //
  // Plan 154-04 widens this route so a SINGLE-KEY strategy can finally see that
  // it has a job in flight (today every single-key caller gets IDLE, which is
  // why the wizard had no way to tell "still working" from "nothing running").
  // The widening is only safe if composite behaviour does not move, and the way
  // to know that is to measure composite behaviour first, on the UNMODIFIED
  // route, and to spell the answer out as bytes rather than as a shape.
  //
  // These two cases were added in their own commit and observed green against
  // the route as it stood. If the widening moves a composite response by so much
  // as a key order, they redden.
  // ═══════════════════════════════════════════════════════════════════════
  it("PIN-COMPOSITE-BYTES: the composite response is byte-identical (pinned pre-widening)", async () => {
    rpcResult.data = [
      stitchRow({
        status: "running",
        metadata: {
          member_progress_at: ago(30_000),
          member_progress: [
            { seq: 1, exchange: "deribit", label: "D", status: "in_process" },
          ],
        },
      }),
    ];
    const res = await call(TEST_STRATEGY_ID);
    const body = await res.json();
    // Hand-typed serialization: pins the VALUES *and* the key order, which a
    // `toEqual` would not. `{jobStatus, stalled, memberProgress}` is the
    // construction order at route.ts:233 and `{seq, exchange, label, status}` the
    // projection order at :206-217.
    expect(JSON.stringify(body)).toBe(
      '{"jobStatus":"running","stalled":false,"memberProgress":' +
        '[{"seq":1,"exchange":"deribit","label":"D","status":"in_process"}]}',
    );
  });

  it("PIN-COMPOSITE-WINS: a NEWER non-stitch job does not displace the stitch projection (pinned pre-widening)", async () => {
    // ⭐ The case the widening could plausibly break: a composite strategy whose
    // most recent job of ANY kind is not the stitch. The stitch is what carries
    // member progress and the only heartbeat anyone writes, so it must stay the
    // source of this response no matter what else ran afterwards.
    rpcResult.data = [
      otherKindRow("sync_trades", {
        status: "done",
        created_at: "2026-07-12T11:59:00.000Z", // newest overall
      }),
      stitchRow({
        status: "running",
        created_at: "2026-07-12T11:55:00.000Z",
        metadata: {
          member_progress_at: ago(30_000),
          member_progress: [
            { seq: 1, exchange: "deribit", label: "D", status: "in_process" },
          ],
        },
      }),
    ];
    const res = await call(TEST_STRATEGY_ID);
    expect(JSON.stringify(await res.json())).toBe(
      '{"jobStatus":"running","stalled":false,"memberProgress":' +
        '[{"seq":1,"exchange":"deribit","label":"D","status":"in_process"}]}',
    );
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 154-04 — THE WIDENED ARM. These replace PIN-SINGLE-KEY-BEFORE, which
  // measured the same input answering IDLE against the pre-widening route
  // (commit "test(154-04): pin sync-progress composite bytes …").
  // ═══════════════════════════════════════════════════════════════════════
  it("WIDEN-SINGLE-KEY-RUNNING: a single-key RUNNING job is now visible as jobStatus", async () => {
    // The exact input PIN-SINGLE-KEY-BEFORE drove to `jobStatus: null`.
    rpcResult.data = [otherKindRow("process_key_long", { status: "running" })];
    const res = await call(TEST_STRATEGY_ID);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      jobStatus: "running",
      stalled: false, // never stalled for a non-stitch kind — see below
      memberProgress: [], // no worker writes member_progress for this kind
    });
  });

  it("WIDEN-SINGLE-KEY-DONE: a finished single-key job reports 'done'", async () => {
    rpcResult.data = [
      otherKindRow("compute_analytics_from_csv", { status: "done" }),
    ];
    const body = await (await call(TEST_STRATEGY_ID)).json();
    expect(body.jobStatus).toBe("done");
    expect(body.stalled).toBe(false);
  });

  it("WIDEN-SINGLE-KEY-LATEST: the newest single-key job wins, whatever its kind", async () => {
    // A real single-key chain: process_key_long → derive_broker_dailies →
    // compute_analytics_from_csv. The caller wants where the chain IS, so the
    // newest row answers even though the earlier ones are terminal.
    rpcResult.data = [
      otherKindRow("process_key_long", {
        status: "done",
        created_at: "2026-07-12T11:37:43.000Z",
      }),
      otherKindRow("derive_broker_dailies", {
        status: "done",
        created_at: "2026-07-12T11:38:05.000Z",
      }),
      otherKindRow("compute_analytics_from_csv", {
        status: "running",
        created_at: "2026-07-12T11:39:02.000Z",
      }),
    ];
    const body = await (await call(TEST_STRATEGY_ID)).json();
    expect(body.jobStatus).toBe("running");
  });

  it("WIDEN-NO-FALSE-STALL: an ANCIENT claimed_at on a single-key job is NOT stalled", async () => {
    // ⭐ THE HAZARD THE WIDENING MUST NOT INTRODUCE. `claimed_at` is stamped
    // once at claim time and never refreshed; only the stitch worker writes a
    // real heartbeat. A naive widening would read this 13-minute-old claim as
    // evidence of a stall and invite the user to abort a healthy long crawl —
    // manufacturing exactly the kind of false claim about the world that this
    // phase exists to delete. `stalled` is stitch-derived, so: false.
    rpcResult.data = [
      otherKindRow("process_key_long", {
        status: "running",
        claimed_at: ago(13 * 60_000), // past STALL_THRESHOLD_MS
      }),
    ];
    const body = await (await call(TEST_STRATEGY_ID)).json();
    expect(body.jobStatus).toBe("running");
    expect(body.stalled).toBe(false);
  });

  it("WIDEN-REDACTION: the widened arm leaks no metadata, ciphertext or last_error", async () => {
    // T-95-07 extends to the new arm: it is a projection, not a passthrough.
    // Even a rogue writer's blob on a NON-stitch row must not cross the wire.
    rpcResult.data = [
      {
        ...otherKindRow("process_key_long", {
          status: "running",
          metadata: {
            source: "keys/sync",
            correlation_id: "cid-abcdef",
            api_key_encrypted: "SECRETVALUE",
            api_secret_encrypted: "SECRETVALUE",
            passphrase_encrypted: "SECRETVALUE",
            dek_encrypted: "SECRETVALUE",
            nonce: "SECRETVALUE",
            // A rogue member_progress on a kind that has no members must NOT
            // be projected either — the entries are stitch-gated.
            member_progress: [
              { seq: 1, exchange: "mt5", label: "L", status: "in_process" },
            ],
            member_progress_at: ago(30_000),
          },
        }),
        last_error: "SECRETVALUE: raw worker traceback",
      },
    ];
    const res = await call(TEST_STRATEGY_ID);
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual([
      "jobStatus",
      "memberProgress",
      "stalled",
    ]);
    expect(body.memberProgress).toEqual([]);
    const serialized = JSON.stringify(body);
    for (const forbidden of [
      "metadata",
      "correlation_id",
      "source",
      "member_progress_at",
      "claimed_at",
      "last_error",
      "SECRETVALUE",
      "api_key_encrypted",
      "api_secret_encrypted",
      "passphrase_encrypted",
      "dek_encrypted",
      "nonce",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("WIDEN-RT-1: the widened arm still never queries strategy_analytics", async () => {
    // The RT-1 invariant is what makes the amber state trustworthy; a new arm
    // is a new chance to break it. Structural, like the original pin.
    rpcResult.data = [otherKindRow("process_key_long", { status: "running" })];
    const res = await call(TEST_STRATEGY_ID);
    expect(res.status).toBe(200);
    expect(fromCalls).not.toContain("strategy_analytics");
    expect(fromCalls).toContain("strategies");
  });

  // ── SF-3: a REAL read is NOT degraded (distinct from the couldn't-read blip) ──
  it("a real read (running job) is degraded:false/absent, unlike the RPC-degrade branch", async () => {
    rpcResult.data = [
      stitchRow({
        status: "running",
        metadata: {
          member_progress_at: ago(30_000),
          member_progress: [
            { seq: 1, exchange: "deribit", label: "D", status: "in_process" },
          ],
        },
      }),
    ];
    const res = await call(TEST_STRATEGY_ID);
    const body = await res.json();
    // The `degraded` key is ABSENT on a real read (the client treats
    // absent === not degraded); it is present ONLY on the rpcError branch.
    expect("degraded" in body).toBe(false);
  });
});
