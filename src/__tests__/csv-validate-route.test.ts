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
  checkLimit: checkLimitMock,
}));

const validateCsvMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/analytics-client", () => ({
  validateCsv: validateCsvMock,
}));

const rpcMock = vi.hoisted(() => vi.fn());

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
): NextRequest {
  const form = new FormData();
  if (file) form.append("file", file);
  if (fmt) form.append("fmt", fmt);
  form.append("wizard_session_id", "00000000-0000-0000-0000-000000000001");
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
});
