/**
 * CONTRIB-02 (Phase 110) — csv-finalize contribution branch.
 *
 * The allocator contribution overlay POSTs `entry_context: "contribution"` to
 * this route. The contribution must finalize to an owner-only status='private'
 * (never 'pending_review').
 *
 * ⚠️ RE-POINTED BY PHASE 145 (D-06 option i-b): BOTH flows now call the
 * folded `finalize_csv_strategy_with_returns` RPC directly on the SSR
 * user-scoped client — the contribution with p_terminal_status='private'
 * (the D-08 wire half this file is the gate for), the manager flow with
 * 'pending_review'. Neither flow dispatches to /process-key any more (the
 * Python csv-finalize branch was deleted; Phase 106 Stage B's ruling was
 * consciously reversed — 145-DECISION.md). The dailies ride the fold's
 * p_rows argument in the SAME transaction as the strategy row.
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
      expect(rpcCall("finalize_csv_strategy_with_returns")).toBeUndefined();
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
      // Phase 145: the side-effecting work the limiter fences is the fold.
      expect(rpcCall("finalize_csv_strategy_with_returns")).toBeDefined();
    });
  });

  it("default body (no entry_context) → the fold DIRECTLY with p_terminal_status='pending_review', no /process-key dispatch", async () => {
    const res = await POST(makeRequest(validBody()));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.strategy_id).toBe(NEW_STRATEGY_ID);
    expect(body.status).toBe("pending_review");
    // Phase 145 (D-06 i-b): the manager flow no longer rides the unified
    // backbone — a postProcessKey dispatch here would be the second-writer
    // regression the decision file names.
    expect(postProcessKeyMock).not.toHaveBeenCalled();
    const finalize = rpcCall("finalize_csv_strategy_with_returns");
    expect(finalize).toBeDefined();
    expect(finalize![1].p_terminal_status).toBe("pending_review");
    // The dailies ride the SAME call (one transaction — D-07).
    expect(finalize![1].p_rows).toEqual(VALID_SERIES);
  });

  it("entry_context='contribution' → calls the fold directly with p_terminal_status='private' and returns status='private'", async () => {
    const res = await POST(
      makeRequest(validBody({ entry_context: "contribution" })),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.status).toBe("private");
    expect(body.strategy_id).toBe(NEW_STRATEGY_ID);

    // The contribution never rides /process-key.
    expect(postProcessKeyMock).not.toHaveBeenCalled();
    // SC#3 wire half (D-08): 'private' passes VERBATIM to the fold.
    const finalize = rpcCall("finalize_csv_strategy_with_returns");
    expect(finalize).toBeDefined();
    expect(finalize![1].p_terminal_status).toBe("private");
    expect(finalize![1].p_user_id).toBe(TEST_USER_ID);
    expect(finalize![1].p_wizard_session_id).toBe(VALID_SESSION);
  });

  it("contribution KEEPS the daily-series + analytics enqueue (dailies are canonical → the allocator needs KPIs)", async () => {
    const res = await POST(
      makeRequest(validBody({ entry_context: "contribution" })),
    );
    expect(res.status).toBe(200);
    // The series persists INSIDE the fold call (p_rows — Phase 145 D-07).
    const finalize = rpcCall("finalize_csv_strategy_with_returns");
    expect(finalize).toBeDefined();
    expect(finalize![1].p_rows).toEqual(VALID_SERIES);
    // The compute_analytics enqueue is scheduled via after().
    expect(afterMock).toHaveBeenCalledTimes(1);
  });

  it("contribution fold RPC error → 500 CSV_FINALIZE_FAIL (nothing saved — the fold rolled back), no orphaned success", async () => {
    // The fold raises (e.g. its 22023 guard) — the shared fold-failure arm
    // answers the single 5xx (Phase 145: the pre-fold 422 arm collapsed into
    // it; both handlers share ONE failure shape now).
    rpcMock.mockResolvedValueOnce({
      data: null,
      error: { code: "22023", message: "boom" },
    });
    const consoleErr = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await POST(
      makeRequest(validBody({ entry_context: "contribution" })),
    );
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.code).toBe("CSV_FINALIZE_FAIL");
    // D-11: the copy states the TRUE transaction outcome — nothing survived.
    expect(String(body.human_message)).toContain("Nothing was saved");
    // D-12: the fold failure is captured with the folded step tag.
    expect(vi.mocked(captureToSentry)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(captureToSentry)).toHaveBeenCalledWith(
      expect.objectContaining({ code: "22023" }),
      expect.objectContaining({
        tags: expect.objectContaining({
          surface: "csv-finalize",
          step: "finalize-fold-fail",
        }),
      }),
    );
    consoleErr.mockRestore();
  });

  it("F-OBS — fold returns a NON-UUID (contract violation) → 500 + Sentry capture, no downstream write", async () => {
    // The RPC returns 200 + a non-uuid strategy id — a return-shape contract
    // violation. The handler must still fail closed AND alert: a silently
    // drifted SQL return shape is worth a Sentry signal.
    rpcMock.mockResolvedValueOnce({ data: "not-a-uuid", error: null });
    const consoleErr = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await POST(
      makeRequest(validBody({ entry_context: "contribution" })),
    );
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.code).toBe("CSV_FINALIZE_FAIL");
    // No orphaned downstream write on the contract-violation path: the
    // metadata UPDATE runs only after a successful outcome (Pitfall 6).
    expect(updateMock).not.toHaveBeenCalled();
    expect(afterMock).not.toHaveBeenCalled();
    // Captured with a synthesized Error (no rpc error object).
    expect(vi.mocked(captureToSentry)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(captureToSentry)).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        tags: expect.objectContaining({ step: "finalize-fold-fail" }),
        extra: expect.objectContaining({ rpc_error_code: null }),
      }),
    );
    consoleErr.mockRestore();
  });

  it("invalid entry_context → 400 CSV_INVALID_FORMAT before any finalize RPC", async () => {
    const res = await POST(
      makeRequest(validBody({ entry_context: "garbage" })),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.code).toBe("CSV_INVALID_FORMAT");
    expect(String(body.human_message)).toContain("entry_context");
    expect(rpcCall("finalize_csv_strategy_with_returns")).toBeUndefined();
    expect(postProcessKeyMock).not.toHaveBeenCalled();
  });
});

/**
 * Phase 140.3-02 / TS-13 + TS-14, re-pointed by Phase 145 — the finalize
 * handler validates the PAYLOAD of the fold call, never just error-null.
 *
 * The pre-145 version of this describe drove the upstream /process-key
 * envelope's `ok` discriminator; that seam dissolved with the fold (the route
 * calls the RPC directly), and TS-13's surviving discipline is the success
 * check `(error || !isUuid(id))` on the RPC result:
 *   · an RPC-level error must never be re-stamped as success, even when a
 *     well-formed id rides beside it;
 *   · `isUuid` is DEFENCE IN DEPTH against drift — a 2xx whose data lost or
 *     mistyped the id. Emitting `ok: true` for a body with no usable
 *     strategy_id leaves the wizard's SyncProgress poller hitting
 *     `if (!data) return` forever (API H-1).
 */
describe("[140.3-02 / TS-13, re-pointed by 145] POST /api/strategies/csv-finalize — fold success check validates the payload", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    checkLimitMock.mockResolvedValue({ success: true, retryAfter: 0 });
    rpcMock.mockResolvedValue({ data: NEW_STRATEGY_ID, error: null });
    updateMock.mockResolvedValue({ error: null });
  });

  it("an RPC error is NEVER re-stamped `ok: true`, even with a well-formed strategy_id beside it", async () => {
    rpcMock.mockResolvedValueOnce({
      // A VALID uuid — so the isUuid guard alone cannot catch this.
      data: NEW_STRATEGY_ID,
      error: { code: "XX000", message: "fold failed after returning" },
    });
    const consoleErr = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await POST(makeRequest(validBody()));
    const body = await res.json();

    expect(
      body.ok,
      "Deciding the success path by `isUuid(strategy_id)` alone turns an RPC " +
        "FAILURE that happens to carry an id into a reported success — TS-13.",
    ).toBe(false);
    expect(res.status).toBe(500);
    expect(body.code).toBe("CSV_FINALIZE_FAIL");
    consoleErr.mockRestore();
  });

  it("PIN — isUuid still refuses a 2xx whose strategy_id is not a UUID (defence in depth, kept)", async () => {
    rpcMock.mockResolvedValueOnce({ data: "not-a-uuid", error: null });
    const consoleErr = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await POST(makeRequest(validBody()));
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.ok).toBe(false);
    expect(body.code).toBe("CSV_FINALIZE_FAIL");
    consoleErr.mockRestore();
  });

  it("the real finalize success (no error + a UUID) still returns 200 with the route's own ok:true", async () => {
    rpcMock.mockResolvedValueOnce({ data: NEW_STRATEGY_ID, error: null });

    const res = await POST(makeRequest(validBody()));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.strategy_id).toBe(NEW_STRATEGY_ID);
    expect(body.status).toBe("pending_review");
  });
});
