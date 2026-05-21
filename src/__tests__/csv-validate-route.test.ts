/**
 * Unit tests — POST /api/strategies/csv-validate (multipart proxy)
 * AND POST /api/strategies/csv-finalize (strategy_name validation).
 *
 * Phase 15 / CSV-01..CSV-02 — Plan 15-06 Task 2A + 2C.
 *
 * Both routes are mocked end-to-end:
 *   - withAuth → passes through with a fake user
 *   - ratelimit → checkLimit() returns success unless overridden per test
 *   - csv-validate proxy: validateCsv() (analytics-client) is mocked
 *   - csv-finalize proxy: supabase rpc() is mocked
 *
 * Cross-AI revision 2026-04-30: the validateCsv-throws path asserts that
 * the original throw message ("ANALYTICS_SERVICE_URL not configured")
 * surfaces verbatim in the human_message field. The csv-finalize route
 * tests cover strategy_name validation BEFORE the RPC is called.
 *
 * **Vitest environment override** — these tests must run under the `node`
 * environment, NOT jsdom. jsdom's Request.formData() does not parse
 * NextRequest multipart bodies correctly (every File-bearing request
 * round-trips as "Invalid multipart body"). Switching to node restores
 * undici's native FormData parser, which matches what runs in
 * production (Vercel Functions / Next.js server).
 */

// @vitest-environment node

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

// ---------------------------------------------------------------------
// Module mocks — withAuth + ratelimit + analytics-client + supabase server
// ---------------------------------------------------------------------

vi.mock("@/lib/api/withAuth", () => ({
  withAuth: <H extends (req: unknown, user: unknown) => unknown>(handler: H) =>
    async (req: unknown) => {
      const fakeUser = { id: "00000000-0000-0000-0000-000000000abc" };
      return handler(req, fakeUser);
    },
}));

const checkLimitMock = vi.hoisted(() =>
  vi.fn(async () => ({ success: true, retryAfter: 0 })),
);

vi.mock("@/lib/ratelimit", () => ({
  userActionLimiter: {},
  csvValidateLimiter: {},
  checkLimit: checkLimitMock,
}));

const validateCsvMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/analytics-client", () => ({
  validateCsv: validateCsvMock,
}));

const rpcMock = vi.hoisted(() => vi.fn());

// QA report 2026-05-21 ISSUE-010: csv-finalize now also runs an UPDATE
// on `strategies` to persist classification metadata after the RPC
// returns. The hoisted mock captures the table name, update payload,
// and the chained .eq() filters so tests can assert on them.
const updateMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({
        data: {
          user: { id: "00000000-0000-0000-0000-000000000abc" },
        },
      }),
    },
    rpc: (name: string, args: Record<string, unknown>) => rpcMock(name, args),
    from: (table: string) => ({
      update: (payload: Record<string, unknown>) => {
        const eqChain = {
          eq: (col1: string, val1: unknown) => ({
            eq: (col2: string, val2: unknown) => {
              updateMock(table, payload, { [col1]: val1, [col2]: val2 });
              return Promise.resolve({ error: null });
            },
          }),
        };
        return eqChain;
      },
    }),
  }),
}));

// withAuth's CSRF check (assertSameOrigin) — bypass.
vi.mock("@/lib/csrf", () => ({
  assertSameOrigin: () => null,
}));

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------

import { NextRequest } from "next/server";

function makeMultipartRequest(
  file: File | null,
  fmt: string | null,
  sessionId: string | null = "00000000-0000-0000-0000-000000000001",
): NextRequest {
  const form = new FormData();
  if (file) form.append("file", file);
  if (fmt) form.append("fmt", fmt);
  if (sessionId !== null) form.append("wizard_session_id", sessionId);
  return new NextRequest("http://localhost:3000/api/strategies/csv-validate", {
    method: "POST",
    body: form,
    headers: { Origin: "http://localhost:3000" },
  });
}

function makeJsonRequest(
  body: Record<string, unknown> | null,
): NextRequest {
  return new NextRequest(
    "http://localhost:3000/api/strategies/csv-finalize",
    {
      method: "POST",
      body: body === null ? "" : JSON.stringify(body),
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:3000",
      },
    },
  );
}

// ---------------------------------------------------------------------
// /api/strategies/csv-validate — 7 tests
// ---------------------------------------------------------------------

describe("/api/strategies/csv-validate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    checkLimitMock.mockResolvedValue({ success: true, retryAfter: 0 });
  });

  it("happy path: validateCsv returns ok=true → 200 envelope verbatim", async () => {
    validateCsvMock.mockResolvedValue({
      ok: true,
      preview: {
        row_count: 5,
        date_range: ["2026-01-01", "2026-01-05"],
        columns_detected: ["date", "daily_return"],
        first_rows: [],
        last_rows: [],
      },
      errors: [],
      correlation_id: null,
    });
    const file = new File(
      ["date,daily_return\n2026-01-01,0.01"],
      "x.csv",
      { type: "text/csv" },
    );
    const req = makeMultipartRequest(file, "daily_returns");
    const { POST } = await import("@/app/api/strategies/csv-validate/route");
    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.preview.row_count).toBe(5);
    expect(json.correlation_id).toBeNull();
  });

  it("soft-fail: validateCsv returns ok=false → 200 with errors populated", async () => {
    validateCsvMock.mockResolvedValue({
      ok: false,
      preview: null,
      errors: [
        { rule: "monotonic_dates", row: 2, message: "..." },
      ],
      correlation_id: null,
    });
    const file = new File(["bad"], "x.csv", { type: "text/csv" });
    const req = makeMultipartRequest(file, "daily_returns");
    const { POST } = await import("@/app/api/strategies/csv-validate/route");
    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(false);
    expect(json.errors).toHaveLength(1);
    expect(json.errors[0].rule).toBe("monotonic_dates");
    expect(json.correlation_id).toBeNull();
  });

  it("file > 10 MB → 400 CSV_FILE_TOO_LARGE without calling validateCsv", async () => {
    const big = new File([new Uint8Array(11 * 1024 * 1024)], "x.csv", {
      type: "text/csv",
    });
    const req = makeMultipartRequest(big, "daily_returns");
    const { POST } = await import("@/app/api/strategies/csv-validate/route");
    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.code).toBe("CSV_FILE_TOO_LARGE");
    expect(json.correlation_id).toBeNull();
    expect(validateCsvMock).not.toHaveBeenCalled();
  });

  it("missing file → 400 CSV_INVALID_FORMAT", async () => {
    const req = makeMultipartRequest(null, "daily_returns");
    const { POST } = await import("@/app/api/strategies/csv-validate/route");
    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.code).toBe("CSV_INVALID_FORMAT");
    expect(json.correlation_id).toBeNull();
    expect(validateCsvMock).not.toHaveBeenCalled();
  });

  it("bad fmt → 400 CSV_INVALID_FORMAT", async () => {
    const file = new File(["x"], "x.csv", { type: "text/csv" });
    const req = makeMultipartRequest(file, "invalid_fmt");
    const { POST } = await import("@/app/api/strategies/csv-validate/route");
    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.code).toBe("CSV_INVALID_FORMAT");
    expect(json.correlation_id).toBeNull();
    expect(validateCsvMock).not.toHaveBeenCalled();
  });

  it("validateCsv throws → 502 CSV_UPSTREAM_FAIL with original message in human_message", async () => {
    validateCsvMock.mockRejectedValue(
      new Error("ANALYTICS_SERVICE_URL not configured"),
    );
    const file = new File(["x"], "x.csv", { type: "text/csv" });
    const req = makeMultipartRequest(file, "daily_returns");
    const { POST } = await import("@/app/api/strategies/csv-validate/route");
    const res = await POST(req);
    expect(res.status).toBe(502);
    const json = await res.json();
    expect(json.code).toBe("CSV_UPSTREAM_FAIL");
    // Cross-AI revision 2026-04-30: throw message surfaces verbatim.
    expect(json.human_message).toContain("ANALYTICS_SERVICE_URL not configured");
    expect(json.correlation_id).toBeNull();
  });

  // Phase 15 / WR-03: defense-in-depth UUID gate. The Python router
  // declares wizard_session_id: str = Form(...) with no shape check;
  // a missing/malformed value would surface as a FastAPI 422 wrapped
  // as a CSV_UPSTREAM_FAIL 502. The route now rejects at the edge.
  it("missing wizard_session_id → 400 CSV_INVALID_FORMAT without calling validateCsv", async () => {
    const file = new File(["x"], "x.csv", { type: "text/csv" });
    const req = makeMultipartRequest(file, "daily_returns", null);
    const { POST } = await import("@/app/api/strategies/csv-validate/route");
    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.code).toBe("CSV_INVALID_FORMAT");
    expect(json.human_message).toContain("wizard_session_id");
    expect(json.correlation_id).toBeNull();
    expect(validateCsvMock).not.toHaveBeenCalled();
  });

  it("malformed wizard_session_id → 400 CSV_INVALID_FORMAT without calling validateCsv", async () => {
    const file = new File(["x"], "x.csv", { type: "text/csv" });
    const req = makeMultipartRequest(file, "daily_returns", "not-a-uuid");
    const { POST } = await import("@/app/api/strategies/csv-validate/route");
    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.code).toBe("CSV_INVALID_FORMAT");
    expect(json.human_message).toContain("wizard_session_id");
    expect(json.correlation_id).toBeNull();
    expect(validateCsvMock).not.toHaveBeenCalled();
  });

  it("rate limit exceeded → 429 with Retry-After header and CSV_RATE_LIMIT envelope", async () => {
    checkLimitMock.mockResolvedValueOnce({ success: false, retryAfter: 30 });
    const file = new File(["x"], "x.csv", { type: "text/csv" });
    const req = makeMultipartRequest(file, "daily_returns");
    const { POST } = await import("@/app/api/strategies/csv-validate/route");
    const res = await POST(req);
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("30");
    const json = await res.json();
    expect(json.code).toBe("CSV_RATE_LIMIT");
    expect(json.correlation_id).toBeNull();
  });
});

// ---------------------------------------------------------------------
// /api/strategies/csv-finalize — strategy_name validation (4 tests)
// Cross-AI revision 2026-04-30: defense-in-depth check at the route
// layer rejects bad strategy_name BEFORE calling the SECURITY DEFINER
// RPC. RPC also validates server-side; this gives a clearer envelope.
// ---------------------------------------------------------------------

describe("/api/strategies/csv-finalize — strategy_name validation", () => {
  const VALID_SESSION = "00000000-0000-0000-0000-000000000001";

  beforeEach(() => {
    vi.clearAllMocks();
    checkLimitMock.mockResolvedValue({ success: true, retryAfter: 0 });
  });

  it("missing strategy_name → 400 CSV_INVALID_FORMAT", async () => {
    const req = makeJsonRequest({
      wizard_session_id: VALID_SESSION,
      fmt: "daily_returns",
    });
    const { POST } = await import("@/app/api/strategies/csv-finalize/route");
    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.code).toBe("CSV_INVALID_FORMAT");
    expect(json.human_message).toContain("strategy_name is required");
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("empty strategy_name → 400 CSV_INVALID_FORMAT", async () => {
    const req = makeJsonRequest({
      wizard_session_id: VALID_SESSION,
      fmt: "daily_returns",
      strategy_name: "   ", // whitespace-only trims to ""
    });
    const { POST } = await import("@/app/api/strategies/csv-finalize/route");
    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.code).toBe("CSV_INVALID_FORMAT");
    expect(json.human_message).toContain("cannot be empty");
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("oversize strategy_name (>80 chars) → 400 CSV_INVALID_FORMAT", async () => {
    const req = makeJsonRequest({
      wizard_session_id: VALID_SESSION,
      fmt: "daily_returns",
      strategy_name: "X".repeat(81),
    });
    const { POST } = await import("@/app/api/strategies/csv-finalize/route");
    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.code).toBe("CSV_INVALID_FORMAT");
    // The route's message reads "strategy_name must be 80 characters or fewer."
    expect(json.human_message).toMatch(/80/);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("valid strategy_name + valid fmt + valid uuid → calls RPC with p_strategy_name", async () => {
    rpcMock.mockResolvedValue({
      data: "11111111-1111-4111-8111-111111111111",
      error: null,
    });
    const req = makeJsonRequest({
      wizard_session_id: VALID_SESSION,
      fmt: "daily_returns",
      strategy_name: "Aurora Capital — BTC vol carry",
    });
    const { POST } = await import("@/app/api/strategies/csv-finalize/route");
    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.strategy_id).toBe("11111111-1111-4111-8111-111111111111");
    expect(json.status).toBe("pending_review");

    // Cross-AI revision 2026-04-30: RPC was called with p_strategy_name (not p_placeholder_name).
    expect(rpcMock).toHaveBeenCalledTimes(1);
    const [name, args] = rpcMock.mock.calls[0];
    expect(name).toBe("finalize_csv_strategy");
    expect(args).toMatchObject({
      p_user_id: "00000000-0000-0000-0000-000000000abc",
      p_wizard_session_id: VALID_SESSION,
      p_fmt: "daily_returns",
      p_strategy_name: "Aurora Capital — BTC vol carry",
    });
    // Make sure the trimmed name is forwarded verbatim (no leading/trailing whitespace).
    expect((args as Record<string, unknown>).p_strategy_name).not.toMatch(/^\s|\s$/);
  });

  // QA report 2026-05-21 ISSUE-010: classification metadata is now
  // persisted via a follow-up UPDATE after the RPC returns. The wizard
  // sends `metadata: {description, category_id, strategy_types, ...}`
  // in the request body; the route projects only known fields onto the
  // UPDATE payload and gates by user_id (defense-in-depth on top of RLS).
  describe("ISSUE-010 — csv_metadata UPDATE after RPC returns", () => {
    it("metadata in body → UPDATE strategies with the projected payload", async () => {
      rpcMock.mockResolvedValue({
        data: "22222222-2222-4222-8222-222222222222",
        error: null,
      });
      const req = makeJsonRequest({
        wizard_session_id: VALID_SESSION,
        fmt: "daily_returns",
        strategy_name: "MM Daily 0.5R",
        metadata: {
          description: "Daily PnL series exported from internal book.",
          category_id: "ccccccc1-1111-4111-8111-111111111111",
          strategy_types: ["Market Neutral"],
          subtypes: ["Stat Arb"],
          markets: ["Futures"],
          supported_exchanges: ["Bybit"],
          leverage_range: "1x-3x",
          aum: "1500000",
          max_capacity: "10000000",
        },
      });
      const { POST } = await import("@/app/api/strategies/csv-finalize/route");
      const res = await POST(req);
      expect(res.status).toBe(200);
      expect(updateMock).toHaveBeenCalledTimes(1);
      const [table, payload, filters] = updateMock.mock.calls[0];
      expect(table).toBe("strategies");
      expect(payload).toMatchObject({
        description: "Daily PnL series exported from internal book.",
        category_id: "ccccccc1-1111-4111-8111-111111111111",
        strategy_types: ["Market Neutral"],
        subtypes: ["Stat Arb"],
        markets: ["Futures"],
        supported_exchanges: ["Bybit"],
        leverage_range: "1x-3x",
        aum: 1500000,
        max_capacity: 10000000,
      });
      // Ownership gate: must filter by both id AND user_id so a
      // misrouted call cannot mutate the wrong row.
      expect(filters).toMatchObject({
        id: "22222222-2222-4222-8222-222222222222",
        user_id: "00000000-0000-0000-0000-000000000abc",
      });
    });

    it("no metadata in body → RPC runs, no UPDATE (back-compat)", async () => {
      rpcMock.mockResolvedValue({
        data: "33333333-3333-4333-8333-333333333333",
        error: null,
      });
      const req = makeJsonRequest({
        wizard_session_id: VALID_SESSION,
        fmt: "daily_returns",
        strategy_name: "Legacy CSV upload",
        // No `metadata` field — pre-ISSUE-010 callers must still work.
      });
      const { POST } = await import("@/app/api/strategies/csv-finalize/route");
      const res = await POST(req);
      expect(res.status).toBe(200);
      expect(updateMock).not.toHaveBeenCalled();
    });

    it("metadata projection drops unknown fields (defense-in-depth)", async () => {
      // A misbehaving client sending unexpected fields must not have
      // them forwarded to the UPDATE — we only project known column
      // names so a future PUT-shaped client can't write arbitrary
      // columns through this route.
      rpcMock.mockResolvedValue({
        data: "44444444-4444-4444-8444-444444444444",
        error: null,
      });
      const req = makeJsonRequest({
        wizard_session_id: VALID_SESSION,
        fmt: "daily_returns",
        strategy_name: "Strict projection",
        metadata: {
          description: "ok",
          // Hostile / unknown fields — must NOT reach the UPDATE.
          status: "published",
          source: "api",
          user_id: "other-user-id",
          is_example: true,
        },
      });
      const { POST } = await import("@/app/api/strategies/csv-finalize/route");
      const res = await POST(req);
      expect(res.status).toBe(200);
      const [, payload] = updateMock.mock.calls[0];
      expect(payload).toEqual({ description: "ok" });
      expect(payload).not.toHaveProperty("status");
      expect(payload).not.toHaveProperty("source");
      expect(payload).not.toHaveProperty("user_id");
      expect(payload).not.toHaveProperty("is_example");
    });
  });

  describe("ISSUE Task 8 — daily_returns_series body validation", () => {
    it("accepts a valid series and forwards strategy_id", async () => {
      rpcMock.mockResolvedValue({
        data: "55555555-5555-4555-8555-555555555555",
        error: null,
      });
      const req = makeJsonRequest({
        wizard_session_id: VALID_SESSION,
        fmt: "daily_returns",
        strategy_name: "with series",
        daily_returns_series: [
          { date: "2024-01-01", daily_return: 0.005 },
          { date: "2024-01-02", daily_return: -0.003 },
        ],
      });
      const { POST } = await import("@/app/api/strategies/csv-finalize/route");
      const res = await POST(req);
      expect(res.status).toBe(200);
    });

    it("rejects a series with > 5000 rows as CSV_INVALID_FORMAT", async () => {
      const bigSeries = Array.from({ length: 5001 }, (_, i) => ({
        date: `2024-01-${(i % 28) + 1}`,
        daily_return: 0.001,
      }));
      const req = makeJsonRequest({
        wizard_session_id: VALID_SESSION,
        fmt: "daily_returns",
        strategy_name: "too big",
        daily_returns_series: bigSeries,
      });
      const { POST } = await import("@/app/api/strategies/csv-finalize/route");
      const res = await POST(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.code).toBe("CSV_INVALID_FORMAT");
      expect(json.human_message).toMatch(/5000/);
      expect(rpcMock).not.toHaveBeenCalled();
    });

    it("rejects a row with non-finite daily_return", async () => {
      const req = makeJsonRequest({
        wizard_session_id: VALID_SESSION,
        fmt: "daily_returns",
        strategy_name: "bad row",
        daily_returns_series: [
          { date: "2024-01-01", daily_return: 0.005 },
          { date: "2024-01-02", daily_return: "not-a-number" as unknown as number },
        ],
      });
      const { POST } = await import("@/app/api/strategies/csv-finalize/route");
      const res = await POST(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.code).toBe("CSV_INVALID_FORMAT");
    });

    it("calls persist_csv_daily_returns with the user_id, strategy_id, and series", async () => {
      rpcMock.mockImplementation((name: string) => {
        if (name === "finalize_csv_strategy") {
          return Promise.resolve({
            data: "66666666-6666-4666-8666-666666666666",
            error: null,
          });
        }
        if (name === "persist_csv_daily_returns") {
          return Promise.resolve({ data: 2, error: null });
        }
        return Promise.resolve({ data: null, error: null });
      });
      const req = makeJsonRequest({
        wizard_session_id: VALID_SESSION,
        fmt: "daily_returns",
        strategy_name: "persisting",
        daily_returns_series: [
          { date: "2024-01-01", daily_return: 0.005 },
          { date: "2024-01-02", daily_return: -0.003 },
        ],
      });
      const { POST } = await import("@/app/api/strategies/csv-finalize/route");
      const res = await POST(req);
      expect(res.status).toBe(200);
      const persistCalls = rpcMock.mock.calls.filter((c) => c[0] === "persist_csv_daily_returns");
      expect(persistCalls).toHaveLength(1);
      expect(persistCalls[0][1]).toMatchObject({
        p_user_id: "00000000-0000-0000-0000-000000000abc",
        p_strategy_id: "66666666-6666-4666-8666-666666666666",
        p_rows: [
          { date: "2024-01-01", daily_return: 0.005 },
          { date: "2024-01-02", daily_return: -0.003 },
        ],
      });
    });

    it("returns 500 CSV_PERSIST_FAIL when persist_csv_daily_returns errors", async () => {
      rpcMock.mockImplementation((name: string) => {
        if (name === "finalize_csv_strategy") {
          return Promise.resolve({
            data: "77777777-7777-4777-8777-777777777777",
            error: null,
          });
        }
        if (name === "persist_csv_daily_returns") {
          return Promise.resolve({
            data: null,
            error: { code: "42501", message: "owner mismatch" },
          });
        }
        return Promise.resolve({ data: null, error: null });
      });
      const req = makeJsonRequest({
        wizard_session_id: VALID_SESSION,
        fmt: "daily_returns",
        strategy_name: "persist fails",
        daily_returns_series: [
          { date: "2024-01-01", daily_return: 0.005 },
          { date: "2024-01-02", daily_return: -0.003 },
        ],
      });
      const { POST } = await import("@/app/api/strategies/csv-finalize/route");
      const res = await POST(req);
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.code).toBe("CSV_PERSIST_FAIL");
    });
  });
});
