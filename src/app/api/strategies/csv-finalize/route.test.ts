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
  vi.fn(async () => ({ success: true, retryAfter: 0 })),
);
vi.mock("@/lib/ratelimit", () => ({
  csvValidateLimiter: {},
  checkLimit: checkLimitMock,
}));

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

const postProcessKeyMock = vi.hoisted(() =>
  vi.fn(async () => ({
    ok: true,
    status: 200,
    body: {
      strategy_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      status: "pending_review",
    },
  })),
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
    postProcessKeyMock.mockResolvedValue({
      ok: true,
      status: 200,
      body: { strategy_id: NEW_STRATEGY_ID, status: "pending_review" },
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
