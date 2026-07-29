/**
 * CONTRIB-02 (Phase 110) — csv-finalize contribution branch.
 *
 * The allocator contribution overlay POSTs `entry_context: "contribution"` to
 * this route. The contribution must finalize to an owner-only status='private'
 * (never 'pending_review'), and — because the unified Python backbone calls
 * finalize_csv_strategy WITHOUT p_terminal_status (defaulting to
 * 'pending_review') and hardcodes its response status — the contribution path
 * calls finalize_csv_strategy DIRECTLY on the user-scoped client with
 * p_terminal_status='private' (W1 note, 110-01), then runs the SAME
 * post-finalize fan-out (persist daily returns + analytics enqueue).
 *
 * The manager flow (entry_context absent / 'manager') must stay byte-identical:
 * it delegates to the unified backbone (postProcessKey), NOT a direct RPC.
 */

// @vitest-environment node

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

// ── withAuth passthrough ──────────────────────────────────────────────────
const TEST_USER_ID = "00000000-0000-0000-0000-000000000abc";
vi.mock("@/lib/api/withAuth", () => ({
  withAuth:
    <H extends (req: unknown, user: unknown) => unknown>(handler: H) =>
    async (req: unknown) =>
      handler(req, { id: TEST_USER_ID }),
}));

const checkLimitMock = vi.hoisted(() =>
  // 140.4-13 / SEAMRIM-05 — `reason` is the THIRD outcome: absent is a genuine
  // throttle (429), "ratelimit_misconfigured" is OUR store being unreachable
  // and must answer 503.
  vi.fn(
    async (): Promise<{
      success: boolean;
      retryAfter: number;
      reason?: "ratelimit_misconfigured";
    }> => ({ success: true, retryAfter: 0 }),
  ),
);
// ⚠️ EXTENDED, NOT REPLACED (140.4-13 / SEAMRIM-05). The pure helpers come from
// `importActual` so this mock cannot drift from the real 503-vs-429 decision —
// a hand-written double that always answered 429 would make this file green on
// the exact bug the plan closes.
vi.mock("@/lib/ratelimit", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/ratelimit")>();
  return {
    csvValidateLimiter: {},
    checkLimit: checkLimitMock,
    rateLimitDenyJson: actual.rateLimitDenyJson,
    isRateLimitMisconfigured: actual.isRateLimitMisconfigured,
  };
});

// rpc mock records (name, args); default returns a valid strategy_id so both
// the finalize_csv_strategy and persist_csv_daily_returns calls succeed.
const NEW_STRATEGY_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const rpcMock = vi.hoisted(() =>
  vi.fn(
    async (
      _name?: string,
      _args?: Record<string, unknown>,
    ): Promise<{
      data: string | null;
      error: { code?: string; message?: string } | null;
    }> => ({ data: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", error: null }),
  ),
);
const updateMock = vi.hoisted(() => vi.fn(async () => ({ error: null })));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getSession: async () => ({
        data: { session: { access_token: "test-user-jwt" } },
      }),
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rpc: (name: string, args: Record<string, unknown>) => (rpcMock as any)(name, args),
    from: (_table: string) => ({
      update: (_payload: Record<string, unknown>) => ({
        eq: (_c1: string, _v1: unknown) => ({
          eq: (_c2: string, _v2: unknown) => updateMock(),
        }),
      }),
      // CR-01: the route now probes `csv_daily_returns` for rows OUTSIDE the
      // incoming payload's date range before persisting (the cross-submission
      // merge fence). This double reports "nothing already stored", which is
      // the first-submit state every case in this file models.
      select: (_cols: string) => ({
        eq: (_col: string, _val: string) => ({
          or: (_filter: string) => ({
            limit: async (_n: number) => ({ data: [], error: null }),
          }),
        }),
      }),
    }),
  }),
}));

const adminFromMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: vi.fn(async () => ({ error: null })),
    from: (table: string) => adminFromMock(table),
  }),
}));

// 140.3-02 / TS-13 — the upstream body carries `ok: true`, because the real
// Python builder does (`process_key.py`, the csv-finalize return:
// `{ok, strategy_id, status, correlation_id, step}`). This double previously
// omitted it, which made it a fake that disagreed with the contract it stands
// in for; the route now reads the discriminator, so the fixture is corrected
// rather than the guard weakened.
// The `body` is typed as an open record rather than left to inference: the
// upstream envelope is a WIRE shape with many optional keys, and inferring it
// from this one default would make every other fixture in the file a type error
// for carrying a key the default happens not to use.
const postProcessKeyMock = vi.hoisted(() =>
  vi.fn(
    async (): Promise<{
      ok: boolean;
      status: number;
      body: Record<string, unknown>;
    }> => ({
      ok: true,
      status: 200,
      body: {
        ok: true,
        strategy_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        status: "pending_review",
      },
    }),
  ),
);
vi.mock("@/lib/process-key-client", () => ({
  postProcessKey: postProcessKeyMock,
}));

process.env.INTERNAL_API_TOKEN = "test-internal-token";

vi.mock("@/lib/sentry-capture", () => ({
  captureToSentry: vi.fn(),
}));

// Capture after() scheduling so we can assert the analytics enqueue is queued.
const afterMock = vi.hoisted(() => vi.fn());
vi.mock("next/server", async () => {
  const actual = await vi.importActual<typeof import("next/server")>("next/server");
  return { ...actual, after: afterMock };
});

import { NextRequest } from "next/server";
import { POST } from "@/app/api/strategies/csv-finalize/route";
import { captureToSentry } from "@/lib/sentry-capture";

const VALID_SESSION = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const VALID_SERIES = [{ date: "2024-01-01", daily_return: 0.01 }];

function makeRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://localhost:3000/api/strategies/csv-finalize", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json", Origin: "http://localhost:3000" },
  });
}

function validBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    wizard_session_id: VALID_SESSION,
    fmt: "daily_returns",
    strategy_name: "Test Strategy",
    daily_returns_series: VALID_SERIES,
    ...overrides,
  };
}

function rpcCall(name: string) {
  return rpcMock.mock.calls.find((c) => c[0] === name) as
    | [string, Record<string, unknown>]
    | undefined;
}

describe("POST /api/strategies/csv-finalize — CONTRIB-02 private-by-default contribution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    checkLimitMock.mockResolvedValue({ success: true, retryAfter: 0 });
    rpcMock.mockResolvedValue({ data: NEW_STRATEGY_ID, error: null });
    updateMock.mockResolvedValue({ error: null });
    // 140.3-02 / TS-13 — `ok: true` added to match the real Python builder; see
    // the note on postProcessKeyMock's hoisted default.
    postProcessKeyMock.mockResolvedValue({
      ok: true,
      status: 200,
      body: { ok: true, strategy_id: NEW_STRATEGY_ID, status: "pending_review" },
    });
  });

  /**
   * 140.4-13 / SEAMRIM-05 — the limiter deny arm, all three outcomes.
   *
   * This is the CSV submit step. A 429 here reads as "you are submitting too
   * fast"; during an Upstash outage it was emitted on the FIRST submit, and the
   * user's next move — retry — could not succeed either.
   */
  describe("[140.4-13 / SEAMRIM-05] the limiter deny arm", () => {
    it("ratelimit_misconfigured → 503 in the SAME v0 envelope, code SEAM_MISCONFIGURED", async () => {
      checkLimitMock.mockResolvedValue({
        success: false,
        retryAfter: 60,
        reason: "ratelimit_misconfigured",
      });

      const res = await POST(makeRequest(validBody()));

      expect(res.status).toBe(503);
      const body = await res.json();
      expect(body.ok).toBe(false);
      expect(body.code).toBe("SEAM_MISCONFIGURED");
      expect(body.code).not.toBe("CSV_RATE_LIMIT");
      expect(body.human_message).toContain("fault on our side");
      // The correlation_id is the REAL per-request one, not the `null` the
      // csv-validate envelope carries — that difference is pre-existing and
      // must survive the adoption.
      expect(typeof body.correlation_id).toBe("string");
      expect(res.headers.get("Retry-After")).toBe("60");
      expect(res.headers.get("Cache-Control")).toBe("private, no-store");
      expect(postProcessKeyMock).not.toHaveBeenCalled();
      expect(rpcCall("finalize_csv_strategy")).toBeUndefined();
    });

    it("a genuine throttle → 429 with the BYTE-IDENTICAL v0 envelope", async () => {
      checkLimitMock.mockResolvedValue({ success: false, retryAfter: 25 });

      const res = await POST(makeRequest(validBody()));

      expect(res.status).toBe(429);
      const body = await res.json();
      // Hand-typed from the pre-adoption source — all five fields, same order.
      expect(body.ok).toBe(false);
      expect(body.code).toBe("CSV_RATE_LIMIT");
      expect(body.human_message).toBe(
        "Too many requests. Wait a minute and try again.",
      );
      expect(body.debug_context).toEqual({});
      expect(typeof body.correlation_id).toBe("string");
      expect(res.headers.get("Retry-After")).toBe("25");
      expect(res.headers.get("Cache-Control")).toBe("private, no-store");
      expect(postProcessKeyMock).not.toHaveBeenCalled();
    });

    it("success → the deny arm does not fire", async () => {
      checkLimitMock.mockResolvedValue({ success: true, retryAfter: 0 });

      const res = await POST(makeRequest(validBody()));

      expect(res.status).not.toBe(429);
      expect(res.status).not.toBe(503);
      expect(postProcessKeyMock).toHaveBeenCalledTimes(1);
    });
  });

  it("default body (no entry_context) → unified backbone (postProcessKey), no direct finalize_csv_strategy RPC", async () => {
    const res = await POST(makeRequest(validBody()));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    // Manager flow rides the unified path.
    expect(postProcessKeyMock).toHaveBeenCalledTimes(1);
    // No DIRECT finalize_csv_strategy call — the Python backbone owns it.
    expect(rpcCall("finalize_csv_strategy")).toBeUndefined();
  });

  it("entry_context='contribution' → calls finalize_csv_strategy directly with p_terminal_status='private' and returns status='private'", async () => {
    const res = await POST(
      makeRequest(validBody({ entry_context: "contribution" })),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.status).toBe("private");
    expect(body.strategy_id).toBe(NEW_STRATEGY_ID);

    // The contribution MUST NOT ride the unified backbone (it can't write private).
    expect(postProcessKeyMock).not.toHaveBeenCalled();
    // It calls finalize_csv_strategy DIRECTLY with the private terminal status.
    const finalize = rpcCall("finalize_csv_strategy");
    expect(finalize).toBeDefined();
    expect(finalize![1].p_terminal_status).toBe("private");
    expect(finalize![1].p_user_id).toBe(TEST_USER_ID);
    expect(finalize![1].p_wizard_session_id).toBe(VALID_SESSION);
  });

  it("contribution KEEPS the daily-series persist + analytics enqueue (dailies are canonical → the allocator needs KPIs)", async () => {
    const res = await POST(
      makeRequest(validBody({ entry_context: "contribution" })),
    );
    expect(res.status).toBe(200);
    // persist_csv_daily_returns fired (series persisted).
    expect(rpcCall("persist_csv_daily_returns")).toBeDefined();
    // The compute_analytics enqueue is scheduled via after().
    expect(afterMock).toHaveBeenCalledTimes(1);
  });

  it("contribution finalize RPC error → 422 CSV_FINALIZE_FAIL, no orphaned success", async () => {
    // finalize_csv_strategy raises (e.g. the RPC guard) — return a clean 422.
    rpcMock.mockResolvedValueOnce({
      data: null,
      error: { code: "22023", message: "boom" },
    });
    const consoleErr = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await POST(
      makeRequest(validBody({ entry_context: "contribution" })),
    );
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.code).toBe("CSV_FINALIZE_FAIL");
    // F-OBS — the finalize RPC failure is captured to Sentry (not console.error
    // only), so a systematic contribution-finalize outage is alertable. Mirrors
    // this file's own L811 metadata-update convention.
    expect(vi.mocked(captureToSentry)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(captureToSentry)).toHaveBeenCalledWith(
      expect.objectContaining({ code: "22023" }),
      expect.objectContaining({
        tags: expect.objectContaining({
          surface: "csv-finalize",
          step: "finalize-rpc",
          flow: "contribution",
        }),
      }),
    );
    consoleErr.mockRestore();
  });

  it("F-OBS — contribution finalize returns a NON-UUID (contract violation) → 422 + Sentry capture", async () => {
    // The RPC returns 200 + a non-uuid strategy id — a return-shape contract
    // violation. The handler must still fail closed (422, no orphaned success)
    // AND alert: a silently drifted SQL return shape is worth a Sentry signal.
    rpcMock.mockResolvedValueOnce({ data: "not-a-uuid", error: null });
    const consoleErr = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await POST(
      makeRequest(validBody({ entry_context: "contribution" })),
    );
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.code).toBe("CSV_FINALIZE_FAIL");
    // No orphaned downstream write on the contract-violation path.
    expect(rpcCall("persist_csv_daily_returns")).toBeUndefined();
    // Captured with a synthesized Error (no rpc error object) + the
    // contract_violation flag so the alert distinguishes this from a RAISE.
    expect(vi.mocked(captureToSentry)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(captureToSentry)).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        tags: expect.objectContaining({ step: "finalize-rpc", flow: "contribution" }),
        extra: expect.objectContaining({ contract_violation: true }),
      }),
    );
    consoleErr.mockRestore();
  });

  it("invalid entry_context → 400 CSV_INVALID_FORMAT before any finalize RPC or backbone dispatch", async () => {
    const res = await POST(
      makeRequest(validBody({ entry_context: "garbage" })),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.code).toBe("CSV_INVALID_FORMAT");
    expect(String(body.human_message)).toContain("entry_context");
    expect(rpcCall("finalize_csv_strategy")).toBeUndefined();
    expect(postProcessKeyMock).not.toHaveBeenCalled();
  });
});

/**
 * Phase 140.3-02 / TS-13 + TS-14 — the unified CSV finalize decides success from
 * the envelope's `ok`, and KEEPS the `isUuid` shape guard beside it.
 *
 * The two guards answer different questions and neither subsumes the other:
 *   · `ok` is the SEMANTIC verdict the service states about its own work.
 *   · `isUuid(strategy_id)` is DEFENCE IN DEPTH against drift — a 2xx whose body
 *     lost or mistyped the id. TS-13 says to keep it, and it is kept: emitting
 *     `ok: true` for a body with no usable strategy_id leaves the wizard's
 *     SyncProgress poller hitting `if (!data) return` forever, because no
 *     strategy_analytics row exists for it to find (API H-1).
 *
 * ⚠️ NOT TOUCHED BY THIS PLAN: this route's `debug_context` echo of the whole
 * upstream body and its `console.error` of the same. That is TS-24, owned jointly
 * with Phase 145, which owns this file's transaction shape. Two phases editing one
 * file in one pass is TRAP-8.
 *
 * ORACLE INDEPENDENCE: fixture keys hand-typed from the Python builder's key set
 * (`{ok, strategy_id, status, correlation_id, step}`); expected values are literals.
 */
describe("[140.3-02 / TS-13] POST /api/strategies/csv-finalize — decides from `ok`, and isUuid survives", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    checkLimitMock.mockResolvedValue({ success: true, retryAfter: 0 });
    rpcMock.mockResolvedValue({ data: NEW_STRATEGY_ID, error: null });
    updateMock.mockResolvedValue({ error: null });
  });

  it("a 200 carrying `ok: false` is NEVER re-stamped `ok: true`, even with a well-formed strategy_id", async () => {
    postProcessKeyMock.mockResolvedValue({
      ok: true,
      status: 200,
      body: {
        ok: false,
        code: "CSV_FINALIZE_FAILED",
        human_message: "finalize_csv_strategy RPC failed.",
        correlation_id: "11111111-2222-3333-4444-555555555555",
        // A VALID uuid — so the isUuid guard alone cannot catch this.
        strategy_id: NEW_STRATEGY_ID,
      },
    });

    const res = await POST(makeRequest(validBody()));
    const body = await res.json();

    expect(
      body.ok,
      "The route strips the upstream `ok` and stamps its own `ok: true` on the " +
        "success path. Deciding that path by `isUuid(strategy_id)` alone turns " +
        "an upstream FAILURE that happens to carry an id into a reported " +
        "success — TS-13.",
    ).toBe(false);
    expect(res.status).toBe(502);
    expect(body.code).toBe("CSV_FINALIZE_FAIL");
  });

  it("PIN — isUuid still refuses a 2xx whose strategy_id is not a UUID (defence in depth, kept)", async () => {
    postProcessKeyMock.mockResolvedValue({
      ok: true,
      status: 200,
      body: {
        ok: true,
        strategy_id: "not-a-uuid",
        status: "pending_review",
        correlation_id: "11111111-2222-3333-4444-555555555555",
        step: "finalize",
      },
    });

    const res = await POST(makeRequest(validBody()));
    const body = await res.json();

    expect(res.status).toBe(502);
    expect(body.ok).toBe(false);
    expect(body.code).toBe("CSV_FINALIZE_FAIL");
  });

  it("the real finalize success (`ok: true` + a UUID) still returns 200 with the route's own ok:true", async () => {
    postProcessKeyMock.mockResolvedValue({
      ok: true,
      status: 200,
      body: {
        ok: true,
        strategy_id: NEW_STRATEGY_ID,
        status: "pending_review",
        correlation_id: "11111111-2222-3333-4444-555555555555",
        step: "finalize",
      },
    });

    const res = await POST(makeRequest(validBody()));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.strategy_id).toBe(NEW_STRATEGY_ID);
    expect(body.status).toBe("pending_review");
  });
});
