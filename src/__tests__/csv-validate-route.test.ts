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
      // Phase 19.1: unified finalize forwards the user JWT from the session.
      getSession: async () => ({
        data: { session: { access_token: "test-user-jwt" } },
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

// Phase 19.1 — admin client + isUnifiedBackboneActive + process-key
// client mocks for the persist + enqueue + unified-path tests. Hoisted
// so vi.mock can pick them up; tests reset them in beforeEach.
const adminRpcMock = vi.hoisted(() => vi.fn());
// API W-2 (specialist review 2026-05-22): on enqueue failure the route
// writes a strategy_analytics placeholder via the admin client. Capture
// the call so the regression test can assert the failure-recovery
// shape without depending on console.warn ordering.
const adminUpsertMock = vi.hoisted(() => vi.fn());
const isUnifiedBackboneActiveMock = vi.hoisted(() =>
  vi.fn(async () => false),
);
const postProcessKeyMock = vi.hoisted(() => vi.fn());

// API M-2 (red-team 2026-05-22): the route now SELECTs current
// computation_status BEFORE upserting the failure placeholder, to
// avoid stomping a `complete` row the worker may have written
// concurrently. Capture the SELECT chain so tests can pin the
// guarded behaviour. Default behaviour returns `{ data: null }`
// (no existing row → upsert proceeds), matching the pre-M-2
// observable surface for existing tests.
type AdminSelectResult = {
  data: { computation_status?: string } | null;
  error: { code?: string; message?: string } | null;
};
const adminSelectMaybeSingleMock = vi.hoisted(
  () =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.fn(
      async (
        _table?: string,
        _col?: string,
        _val?: unknown,
      ): Promise<{
        data: { computation_status?: string } | null;
        error: { code?: string; message?: string } | null;
      }> => ({ data: null, error: null }),
    ),
);
// Re-export the type so existing vi.fn() inference doesn't break the
// adminSelectMaybeSingleMock.mockResolvedValue calls below.
void (null as AdminSelectResult | null);

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: (name: string, args: Record<string, unknown>) => adminRpcMock(name, args),
    from: (table: string) => ({
      upsert: (payload: Record<string, unknown>, opts?: Record<string, unknown>) => {
        // Returns a result-shaped Promise so the route's `await ... upsert(...)`
        // pattern lands a `{ error }` envelope. The mock's resolved value
        // can be overridden per test via adminUpsertMock.mockResolvedValueOnce.
        return Promise.resolve(adminUpsertMock(table, payload, opts));
      },
      select: (_cols: string) => ({
        eq: (col: string, val: unknown) => ({
          maybeSingle: () => adminSelectMaybeSingleMock(table, col, val),
        }),
      }),
    }),
  }),
}));

vi.mock("@/lib/feature-flags", () => ({
  isUnifiedBackboneActive: () => isUnifiedBackboneActiveMock(),
}));

vi.mock("@/lib/process-key-client", () => ({
  postProcessKey: (...args: unknown[]) => postProcessKeyMock(...args),
}));

// next/server's `after` keeps the after-callback running outside the
// request lifetime; tests don't need to wait on it. Stub to a no-op by
// default. Tests that need to assert side-effect fan-out
// (enqueue_compute_job) set STATE.runAfterCallback=true to invoke the
// callback through a stored Promise so flushAfter() can await it
// deterministically (Pattern 4 from finalize-wizard/route.test.ts:229).
const STATE = vi.hoisted(() => ({
  runAfterCallback: false,
  afterPromise: undefined as Promise<unknown> | undefined,
}));

vi.mock("next/server", async () => {
  const actual =
    await vi.importActual<typeof import("next/server")>("next/server");
  return {
    ...actual,
    after: (fn: () => unknown) => {
      if (STATE.runAfterCallback) {
        STATE.afterPromise = Promise.resolve()
          .then(fn)
          .catch(() => {});
      }
    },
  };
});

async function flushAfter(): Promise<void> {
  // The after-shim stores a Promise that resolves once the callback +
  // any nested awaits inside it (e.g. admin.rpc) settle. Awaiting it
  // here makes the assertion phase deterministic.
  if (STATE.afterPromise) {
    await STATE.afterPromise;
  }
}

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
      // WR-04 (19.1-REVIEW): daily_returns_series is now required for
      // fmt=daily_returns. A minimal 2-row series satisfies both the
      // route's WR-04 guard and the runner's >=2 row requirement
      // (compute_all_metrics is mocked at the runner level so the
      // values themselves don't matter here).
      daily_returns_series: [
        { date: "2024-01-01", daily_return: 0.001 },
        { date: "2024-01-02", daily_return: 0.002 },
      ],
    });
    const { POST } = await import("@/app/api/strategies/csv-finalize/route");
    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.strategy_id).toBe("11111111-1111-4111-8111-111111111111");
    expect(json.status).toBe("pending_review");

    // Cross-AI revision 2026-04-30: RPC was called with p_strategy_name (not p_placeholder_name).
    // WR-04 (19.1-REVIEW): a non-empty daily_returns_series now triggers
    // a second RPC call (persist_csv_daily_returns); find the
    // finalize_csv_strategy call explicitly rather than asserting the
    // total call count.
    const finalizeCall = rpcMock.mock.calls.find(
      ([n]) => n === "finalize_csv_strategy",
    );
    expect(finalizeCall).toBeDefined();
    const [name, args] = finalizeCall!;
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
        // WR-04 (19.1-REVIEW): daily_returns_series required for
        // fmt=daily_returns. Two minimal rows.
        daily_returns_series: [
          { date: "2024-01-01", daily_return: 0.001 },
          { date: "2024-01-02", daily_return: 0.002 },
        ],
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
        // WR-04 (19.1-REVIEW): daily_returns_series required for
        // fmt=daily_returns. Two minimal rows.
        daily_returns_series: [
          { date: "2024-01-01", daily_return: 0.001 },
          { date: "2024-01-02", daily_return: 0.002 },
        ],
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
        // WR-04 (19.1-REVIEW): daily_returns_series required for
        // fmt=daily_returns. Two minimal rows.
        daily_returns_series: [
          { date: "2024-01-01", daily_return: 0.001 },
          { date: "2024-01-02", daily_return: 0.002 },
        ],
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
});

// ---------------------------------------------------------------------
// /api/strategies/csv-finalize — Phase 19.1 daily_returns_series surface
// (parse + persist + unified mirror + after() enqueue).
//
// Behaviors pinned here:
//   1.  Array shape — non-array daily_returns_series → 400.
//   2.  Size cap — >5000 rows → 400 with the literal cap in the message.
//   3.  Date format — non-YYYY-MM-DD → 400 mentioning the offending row.
//   4.  Finite numeric daily_return — NaN / Infinity → 400.
//   5.  Duplicate-date guard (T-19.1-04, PR #274) — repeated date → 400
//       BEFORE the persist RPC has a chance to throw 23505.
//   6.  Legacy path persist — persist_csv_daily_returns RPC called with
//       the new strategy id + parsed rows.
//   7.  Persist failure → 500 CSV_PERSIST_FAIL with strategy id in
//       debug_context.
//   8.  Unified path explicit param — runtime + strict source-shape +
//       arity-lock checks make closure capture detectable as a
//       regression (T-19.1-10).
//   9.  after() enqueue when USE_COMPUTE_JOBS_QUEUE=true → admin.rpc
//       receives compute_analytics_from_csv + the correct metadata.
//   10. after() no-op when the flag is absent / "false" → no enqueue.
//   11. after() failure logs but does NOT propagate — response stays 200
//       and the warning surfaces in console.warn (T-19.1-11).
// ---------------------------------------------------------------------

describe("/api/strategies/csv-finalize — daily_returns_series (Phase 19.1)", () => {
  const VALID_SESSION = "00000000-0000-0000-0000-000000000001";
  const NEW_STRATEGY_ID = "55555555-5555-4555-8555-555555555555";

  beforeEach(() => {
    vi.clearAllMocks();
    checkLimitMock.mockResolvedValue({ success: true, retryAfter: 0 });
    isUnifiedBackboneActiveMock.mockResolvedValue(false);
    // Default behaviour: any rpcMock call resolves successfully.
    // Tests that need per-RPC behaviour override via mockImplementation.
    rpcMock.mockImplementation(async (name: string) => {
      if (name === "finalize_csv_strategy") {
        return { data: NEW_STRATEGY_ID, error: null };
      }
      if (name === "persist_csv_daily_returns") {
        return { data: 0, error: null };
      }
      return { data: null, error: null };
    });
    adminRpcMock.mockResolvedValue({ data: null, error: null });
    // Default placeholder upsert success — API W-2 happy path doesn't
    // invoke this, but a test that triggers the failure-placeholder
    // branch can override per-call via mockResolvedValueOnce.
    adminUpsertMock.mockReturnValue({ error: null });
    // API M-2 (red-team 2026-05-22): default the guard SELECT to "no
    // existing row" so the upsert proceeds. Tests that need to assert
    // the worker-already-complete guard override via mockResolvedValueOnce.
    adminSelectMaybeSingleMock.mockResolvedValue({ data: null, error: null });
    STATE.runAfterCallback = false;
    STATE.afterPromise = undefined;
  });

  // ---- 1. parse: array shape -------------------------------------------------

  it("Test 1: daily_returns_series non-array → 400 CSV_INVALID_FORMAT (must be an array)", async () => {
    const req = makeJsonRequest({
      wizard_session_id: VALID_SESSION,
      fmt: "daily_returns",
      strategy_name: "Array shape guard",
      daily_returns_series: "not-an-array",
    });
    const { POST } = await import("@/app/api/strategies/csv-finalize/route");
    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.code).toBe("CSV_INVALID_FORMAT");
    expect(json.human_message).toMatch(/must be an array/i);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  // ---- 2. parse: size cap ----------------------------------------------------

  it("Test 2: daily_returns_series with 5001 rows → 400 CSV_INVALID_FORMAT (cites 5000 cap)", async () => {
    const tooMany = Array.from({ length: 5001 }, (_, i) => {
      // YYYY-MM-DD-ish dates — they are unique but the size cap fires
      // BEFORE per-row validation, so the values don't need to be real.
      const day = String((i % 28) + 1).padStart(2, "0");
      const month = String(((Math.floor(i / 28)) % 12) + 1).padStart(2, "0");
      const year = 2020 + Math.floor(i / (28 * 12));
      return { date: `${year}-${month}-${day}`, daily_return: 0.001 };
    });
    const req = makeJsonRequest({
      wizard_session_id: VALID_SESSION,
      fmt: "daily_returns",
      strategy_name: "Size cap guard",
      daily_returns_series: tooMany,
    });
    const { POST } = await import("@/app/api/strategies/csv-finalize/route");
    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.code).toBe("CSV_INVALID_FORMAT");
    expect(json.human_message).toContain("5000");
    expect(rpcMock).not.toHaveBeenCalled();
  });

  // ---- 3. parse: date regex --------------------------------------------------

  it("Test 3: daily_returns_series with bad date format → 400 CSV_INVALID_FORMAT (row index + 'date')", async () => {
    const req = makeJsonRequest({
      wizard_session_id: VALID_SESSION,
      fmt: "daily_returns",
      strategy_name: "Date regex guard",
      daily_returns_series: [{ date: "2024-1-1", daily_return: 0.01 }],
    });
    const { POST } = await import("@/app/api/strategies/csv-finalize/route");
    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.code).toBe("CSV_INVALID_FORMAT");
    expect(json.human_message).toMatch(/\[0\]\.date/);
    expect(json.human_message).toMatch(/YYYY-MM-DD/);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  // ---- 4. parse: finite number ----------------------------------------------

  it("Test 4: daily_returns_series with NaN daily_return → 400 CSV_INVALID_FORMAT", async () => {
    // JSON.stringify(NaN) === "null", so we hand-craft the body string
    // to force a true NaN into the parsed object. We bypass
    // makeJsonRequest() because JSON.stringify would erase it.
    const rawBody = `{"wizard_session_id":"${VALID_SESSION}","fmt":"daily_returns","strategy_name":"Finite guard","daily_returns_series":[{"date":"2024-01-01","daily_return":null}]}`;
    const req = new NextRequest(
      "http://localhost:3000/api/strategies/csv-finalize",
      {
        method: "POST",
        body: rawBody,
        headers: {
          "Content-Type": "application/json",
          Origin: "http://localhost:3000",
        },
      },
    );
    const { POST } = await import("@/app/api/strategies/csv-finalize/route");
    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.code).toBe("CSV_INVALID_FORMAT");
    expect(json.human_message).toMatch(/finite number/i);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  // ---- 5. parse: duplicate date guard (T-19.1-04, PR #274) ------------------

  it("Test 5: duplicate date in daily_returns_series → 400 CSV_INVALID_FORMAT (T-19.1-04, PR #274)", async () => {
    const req = makeJsonRequest({
      wizard_session_id: VALID_SESSION,
      fmt: "daily_returns",
      strategy_name: "Duplicate date guard",
      daily_returns_series: [
        { date: "2024-01-01", daily_return: 0.01 },
        { date: "2024-01-02", daily_return: 0.02 },
        { date: "2024-01-01", daily_return: 0.03 }, // duplicate of row 0
      ],
    });
    const { POST } = await import("@/app/api/strategies/csv-finalize/route");
    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.code).toBe("CSV_INVALID_FORMAT");
    expect(json.human_message).toMatch(/duplicate date/i);
    expect(json.human_message).toMatch(/2024-01-01/);
    expect(json.debug_context).toMatchObject({ row: 2, date: "2024-01-01" });
    // Critically: the RPC was NEVER called — the route boundary closed
    // the 23505 → 500 leak that the UNIQUE constraint inside the RPC
    // would otherwise produce.
    expect(rpcMock).not.toHaveBeenCalled();
  });

  // ---- 5b. WR-04 (19.1-REVIEW): empty-series guard for return-bearing fmts --

  it("Test 5b: empty daily_returns_series with fmt=daily_returns → 400 CSV_INVALID_FORMAT, RPC never called (WR-04)", async () => {
    // Pre-fix: an empty array would parse to {ok: true, rows: []}, the
    // strategy row would be created via finalize_csv_strategy, then BOTH
    // persist_csv_daily_returns AND the after() enqueue would skip on
    // the `dailyReturnsSeries.length > 0` gate. The wizard's
    // SyncProgress poller would hang indefinitely because strategy_
    // analytics has no row at all — no 'computing', no 'complete', no
    // 'failed' to break out on.
    const req = makeJsonRequest({
      wizard_session_id: VALID_SESSION,
      fmt: "daily_returns",
      strategy_name: "Empty series guard (daily_returns)",
      daily_returns_series: [],
    });
    const { POST } = await import("@/app/api/strategies/csv-finalize/route");
    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.code).toBe("CSV_INVALID_FORMAT");
    expect(json.human_message).toMatch(/required/i);
    expect(json.debug_context).toMatchObject({ fmt: "daily_returns", row_count: 0 });
    // Critically: the strategy row was NEVER created. Pre-fix the
    // strategy would land in a half-baked pending_review state with
    // no analytics row.
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("Test 5c: empty daily_returns_series with fmt=daily_nav → 400 CSV_INVALID_FORMAT, RPC never called (WR-04)", async () => {
    const req = makeJsonRequest({
      wizard_session_id: VALID_SESSION,
      fmt: "daily_nav",
      strategy_name: "Empty series guard (daily_nav)",
      daily_returns_series: [],
    });
    const { POST } = await import("@/app/api/strategies/csv-finalize/route");
    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.code).toBe("CSV_INVALID_FORMAT");
    expect(json.debug_context).toMatchObject({ fmt: "daily_nav", row_count: 0 });
    expect(rpcMock).not.toHaveBeenCalled();
  });

  // ---- 6. persist call on legacy path ---------------------------------------

  it("Test 6: legacy path calls persist_csv_daily_returns with strategy id + rows", async () => {
    const series = [
      { date: "2024-01-01", daily_return: 0.01 },
      { date: "2024-01-02", daily_return: -0.005 },
    ];
    const req = makeJsonRequest({
      wizard_session_id: VALID_SESSION,
      fmt: "daily_returns",
      strategy_name: "Legacy persist",
      daily_returns_series: series,
    });
    const { POST } = await import("@/app/api/strategies/csv-finalize/route");
    const res = await POST(req);
    expect(res.status).toBe(200);
    const persistCall = rpcMock.mock.calls.find(
      ([name]) => name === "persist_csv_daily_returns",
    );
    expect(persistCall).toBeDefined();
    const [, args] = persistCall!;
    expect(args).toMatchObject({
      p_user_id: "00000000-0000-0000-0000-000000000abc",
      p_strategy_id: NEW_STRATEGY_ID,
      p_rows: series,
    });
  });

  // ---- 7. persist failure → 500 CSV_PERSIST_FAIL ---------------------------

  it("Test 7: persist RPC failure → 500 CSV_PERSIST_FAIL with strategy id in debug_context", async () => {
    rpcMock.mockImplementation(async (name: string) => {
      if (name === "finalize_csv_strategy") {
        return { data: NEW_STRATEGY_ID, error: null };
      }
      if (name === "persist_csv_daily_returns") {
        return { data: null, error: { code: "42501", message: "not accessible" } };
      }
      return { data: null, error: null };
    });
    const req = makeJsonRequest({
      wizard_session_id: VALID_SESSION,
      fmt: "daily_returns",
      strategy_name: "Persist failure",
      daily_returns_series: [{ date: "2024-01-01", daily_return: 0.01 }],
    });
    const { POST } = await import("@/app/api/strategies/csv-finalize/route");
    const res = await POST(req);
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.code).toBe("CSV_PERSIST_FAIL");
    expect(json.human_message).toMatch(/support@quantalyze\.com/i);
    expect(json.debug_context).toMatchObject({ strategy_id: NEW_STRATEGY_ID });
  });

  // ---- 8. unified-backbone path receives dailyReturnsSeries via explicit param

  it("Test 8a (runtime): unified path forwards dailyReturnsSeries via explicit args.dailyReturnsSeries", async () => {
    isUnifiedBackboneActiveMock.mockResolvedValue(true);
    const unifiedStrategyId = "66666666-6666-4666-8666-666666666666";
    postProcessKeyMock.mockResolvedValue({
      ok: true,
      body: { strategy_id: unifiedStrategyId, status: "pending_review" },
    });
    // Default rpcMock impl returns success for persist_csv_daily_returns.
    process.env.INTERNAL_API_TOKEN = "test-token";

    const series = [
      { date: "2024-02-01", daily_return: 0.005 },
      { date: "2024-02-02", daily_return: 0.006 },
    ];
    const req = makeJsonRequest({
      wizard_session_id: VALID_SESSION,
      fmt: "daily_returns",
      strategy_name: "Unified path mirror",
      daily_returns_series: series,
    });
    const { POST } = await import("@/app/api/strategies/csv-finalize/route");
    const res = await POST(req);
    expect(res.status).toBe(200);

    // The persist RPC fires on the unified path with the explicit series.
    const persistCall = rpcMock.mock.calls.find(
      ([name]) => name === "persist_csv_daily_returns",
    );
    expect(persistCall).toBeDefined();
    const [, args] = persistCall!;
    expect(args).toMatchObject({
      p_user_id: "00000000-0000-0000-0000-000000000abc",
      p_strategy_id: unifiedStrategyId,
      p_rows: series,
    });

    delete process.env.INTERNAL_API_TOKEN;
  });

  it("Test 8b (source-shape): unifiedCsvFinalizeHandler signature contains typed dailyReturnsSeries field", async () => {
    // T-19.1-10: explicit param, not closure capture. The handler
    // signature must spell out `dailyReturnsSeries: CsvDailyReturnRow[]`
    // (or a `readonly` variant) in the args object literal — a code-review
    // regression to closure capture would fail this check.
    const fs = await import("node:fs");
    const path = "src/app/api/strategies/csv-finalize/route.ts";
    const src = fs.readFileSync(path, "utf-8");
    // `/s` flag requires ES2018; the project targets ES2017. `[^]` is
    // a portable any-character class that works at any target. The
    // shape we want to pin: opener `unifiedCsvFinalizeHandler(args: {`,
    // any number of intervening fields, then a typed
    // `dailyReturnsSeries: CsvDailyReturnRow[]` field (optionally
    // `readonly`).
    const SIGNATURE_REGEX =
      /async function unifiedCsvFinalizeHandler\(args: \{[^}]*?dailyReturnsSeries:\s*(readonly\s+)?CsvDailyReturnRow\[\]/;
    // The body of the args object spans multiple lines — switch the
    // wildcard to one that consumes newlines without enabling /s.
    const sigText = src.match(
      /async function unifiedCsvFinalizeHandler\(args:[\s\S]*?\}\s*\)/,
    );
    expect(sigText).not.toBeNull();
    expect(sigText![0]).toMatch(SIGNATURE_REGEX);
  });

  it("Test 8c (arity lock): unifiedCsvFinalizeHandler must remain a single-args function", async () => {
    // Arity lock: the handler is an `async function args: {...}` so
    // its declared `.length` (non-defaulted positional params) is 1.
    // A silent param drop (e.g. someone re-factoring back to closure
    // capture by removing the args object entirely) would change this.
    // The function is module-private; we access it via the same source
    // read used above (no public export) by re-importing the module
    // and using a Function constructor / reflection path would require
    // exposing the function. Instead we pin the AST shape via the
    // single-object-arg pattern — the regex in Test 8b verifies the
    // `(args: {` opener, which structurally pins arity at 1.
    const fs = await import("node:fs");
    const path = "src/app/api/strategies/csv-finalize/route.ts";
    const src = fs.readFileSync(path, "utf-8");
    // Match the literal opener `unifiedCsvFinalizeHandler(args:` — any
    // shape that adds a second positional param ("args, dailyReturnsSeries")
    // would fail this regex AND the explicit-field check in 8b.
    expect(src).toMatch(/async function unifiedCsvFinalizeHandler\(args:\s*\{/);
    // And the only caller in the file passes a single object literal —
    // structurally pinning the call site so a future refactor cannot
    // smuggle in a second positional argument.
    expect(src).toMatch(/unifiedCsvFinalizeHandler\(\{/);
  });

  // ---- 9. after() enqueue when USE_COMPUTE_JOBS_QUEUE=true ------------------

  it("Test 9: after() enqueue fires compute_analytics_from_csv when USE_COMPUTE_JOBS_QUEUE=true", async () => {
    process.env.USE_COMPUTE_JOBS_QUEUE = "true";
    STATE.runAfterCallback = true;
    const req = makeJsonRequest({
      wizard_session_id: VALID_SESSION,
      fmt: "daily_returns",
      strategy_name: "Enqueue happy path",
      daily_returns_series: [{ date: "2024-03-01", daily_return: 0.001 }],
    });
    const { POST } = await import("@/app/api/strategies/csv-finalize/route");
    const res = await POST(req);
    expect(res.status).toBe(200);
    await flushAfter();
    const enqueueCall = adminRpcMock.mock.calls.find(
      ([name]) => name === "enqueue_compute_job",
    );
    expect(enqueueCall).toBeDefined();
    const [, args] = enqueueCall!;
    expect(args).toMatchObject({
      p_strategy_id: NEW_STRATEGY_ID,
      p_kind: "compute_analytics_from_csv",
      p_metadata: { source: "csv-finalize", fmt: "daily_returns" },
    });
    delete process.env.USE_COMPUTE_JOBS_QUEUE;
  });

  // ---- 10. after() no-op when flag absent / "false" -------------------------

  it("Test 10: after() does NOT enqueue when USE_COMPUTE_JOBS_QUEUE is absent", async () => {
    delete process.env.USE_COMPUTE_JOBS_QUEUE;
    STATE.runAfterCallback = true;
    const req = makeJsonRequest({
      wizard_session_id: VALID_SESSION,
      fmt: "daily_returns",
      strategy_name: "Enqueue flag off",
      daily_returns_series: [{ date: "2024-04-01", daily_return: 0.002 }],
    });
    const { POST } = await import("@/app/api/strategies/csv-finalize/route");
    const res = await POST(req);
    expect(res.status).toBe(200);
    await flushAfter();
    const enqueueCalls = adminRpcMock.mock.calls.filter(
      ([name]) => name === "enqueue_compute_job",
    );
    expect(enqueueCalls).toHaveLength(0);
  });

  it("Test 10b: after() does NOT enqueue when USE_COMPUTE_JOBS_QUEUE='false'", async () => {
    process.env.USE_COMPUTE_JOBS_QUEUE = "false";
    STATE.runAfterCallback = true;
    const req = makeJsonRequest({
      wizard_session_id: VALID_SESSION,
      fmt: "daily_returns",
      strategy_name: "Enqueue flag literal false",
      daily_returns_series: [{ date: "2024-05-01", daily_return: 0.003 }],
    });
    const { POST } = await import("@/app/api/strategies/csv-finalize/route");
    const res = await POST(req);
    expect(res.status).toBe(200);
    await flushAfter();
    const enqueueCalls = adminRpcMock.mock.calls.filter(
      ([name]) => name === "enqueue_compute_job",
    );
    expect(enqueueCalls).toHaveLength(0);
    delete process.env.USE_COMPUTE_JOBS_QUEUE;
  });

  // ---- 10c. Flag-off path writes strategy_analytics placeholder (API M-1) ----

  it("Test 10c: flag-off after() writes strategy_analytics placeholder to break wizard hang (API M-1)", async () => {
    // Phase 19.1 red-team (2026-05-22): pre-fix, when
    // USE_COMPUTE_JOBS_QUEUE != "true" the after() block early-
    // returned WITHOUT writing any placeholder, leaving the wizard's
    // SyncProgress poller to spin forever because no
    // strategy_analytics row existed. Fix writes a `failed`
    // placeholder so the poller breaks out with a meaningful failure.
    delete process.env.USE_COMPUTE_JOBS_QUEUE;
    STATE.runAfterCallback = true;
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const req = makeJsonRequest({
      wizard_session_id: VALID_SESSION,
      fmt: "daily_returns",
      strategy_name: "Flag-off placeholder",
      daily_returns_series: [{ date: "2024-10-01", daily_return: 0.001 }],
    });
    const { POST } = await import("@/app/api/strategies/csv-finalize/route");
    const res = await POST(req);
    expect(res.status).toBe(200);
    await flushAfter();

    // No enqueue should have fired (flag is off)
    const enqueueCalls = adminRpcMock.mock.calls.filter(
      ([name]) => name === "enqueue_compute_job",
    );
    expect(enqueueCalls).toHaveLength(0);

    // But the placeholder MUST have fired.
    expect(adminUpsertMock).toHaveBeenCalledTimes(1);
    const [table, payload, opts] = adminUpsertMock.mock.calls[0];
    expect(table).toBe("strategy_analytics");
    expect(payload).toMatchObject({
      strategy_id: NEW_STRATEGY_ID,
      computation_status: "failed",
      data_quality_flags: { csv_source: true },
    });
    expect(payload.computation_error).toMatch(
      /queue disabled.*support@quantalyze\.com/i,
    );
    expect(payload.computation_error).toContain(NEW_STRATEGY_ID);
    expect(opts).toMatchObject({ onConflict: "strategy_id" });

    warnSpy.mockRestore();
  });

  // ---- 11. after() failure logs but does NOT 500 (T-19.1-11) ----------------

  it("Test 11: after() throw logs non-blocking warning and keeps response 200 (T-19.1-11)", async () => {
    process.env.USE_COMPUTE_JOBS_QUEUE = "true";
    STATE.runAfterCallback = true;
    adminRpcMock.mockRejectedValue(new Error("transient queue outage"));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const req = makeJsonRequest({
      wizard_session_id: VALID_SESSION,
      fmt: "daily_returns",
      strategy_name: "Enqueue failure non-blocking",
      daily_returns_series: [{ date: "2024-06-01", daily_return: 0.004 }],
    });
    const { POST } = await import("@/app/api/strategies/csv-finalize/route");
    const res = await POST(req);
    // Response stays 200 — the after() block failure must not propagate.
    expect(res.status).toBe(200);
    await flushAfter();
    const warnedNonBlocking = warnSpy.mock.calls.some((call) =>
      call.some(
        (arg) => typeof arg === "string" && arg.includes("non-blocking"),
      ),
    );
    expect(warnedNonBlocking).toBe(true);
    warnSpy.mockRestore();
    delete process.env.USE_COMPUTE_JOBS_QUEUE;
  });

  // ---- 12. after() enqueue failure writes strategy_analytics placeholder (API W-2)

  it("Test 12: after() enqueue error writes strategy_analytics failed placeholder (API W-2)", async () => {
    // API W-2 (specialist review 2026-05-22): an enqueue error must
    // surface as a strategy_analytics row with computation_status='failed'
    // so the wizard's SyncProgress poller breaks out of its perpetual
    // polling state. Without this, a missing migration on a non-prod env
    // or a transient enqueue_compute_job 5xx leaves the user with 200
    // + persistent state but no compute job ever runs.
    process.env.USE_COMPUTE_JOBS_QUEUE = "true";
    STATE.runAfterCallback = true;
    adminRpcMock.mockResolvedValue({
      data: null,
      error: { code: "PGRST116", message: "migration not applied" },
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const req = makeJsonRequest({
      wizard_session_id: VALID_SESSION,
      fmt: "daily_returns",
      strategy_name: "Enqueue error placeholder",
      daily_returns_series: [{ date: "2024-07-01", daily_return: 0.003 }],
    });
    const { POST } = await import("@/app/api/strategies/csv-finalize/route");
    const res = await POST(req);
    expect(res.status).toBe(200);
    await flushAfter();

    // The placeholder upsert must fire on strategy_analytics with a
    // failed status, an error message that names the enqueue cause,
    // and the csv_source flag for the provenance pill.
    expect(adminUpsertMock).toHaveBeenCalledTimes(1);
    const [table, payload, opts] = adminUpsertMock.mock.calls[0];
    expect(table).toBe("strategy_analytics");
    expect(payload).toMatchObject({
      strategy_id: NEW_STRATEGY_ID,
      computation_status: "failed",
      data_quality_flags: { csv_source: true },
    });
    expect(payload.computation_error).toMatch(
      /compute job enqueue failed: migration not applied/,
    );
    // onConflict ensures we don't 23505 if a strategy_analytics row
    // already exists (computing/complete).
    expect(opts).toMatchObject({ onConflict: "strategy_id" });

    warnSpy.mockRestore();
    delete process.env.USE_COMPUTE_JOBS_QUEUE;
  });

  // ---- 12b. M-2 guard: worker-complete-already → placeholder SKIPPED -------

  it("Test 12b: placeholder upsert SKIPPED when worker already wrote computation_status='complete' (API M-2)", async () => {
    // Phase 19.1 red-team (2026-05-22): if `enqueue_compute_job`
    // returns an error AFTER the job was actually committed server-
    // side (transient 5xx after partial success), the worker may
    // race ahead and write computation_status='complete' before the
    // route's after() block tries to write `failed`. Pre-M-2 the
    // unconditional upsert with onConflict='strategy_id' would stomp
    // `complete` with `failed`. Guard: SELECT first; if `complete`,
    // log + skip.
    process.env.USE_COMPUTE_JOBS_QUEUE = "true";
    STATE.runAfterCallback = true;
    adminRpcMock.mockResolvedValue({
      data: null,
      error: { code: "PGRST500", message: "transient 5xx after commit" },
    });
    // Worker has already landed the terminal row.
    adminSelectMaybeSingleMock.mockResolvedValue({
      data: { computation_status: "complete" },
      error: null,
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const req = makeJsonRequest({
      wizard_session_id: VALID_SESSION,
      fmt: "daily_returns",
      strategy_name: "Race with worker",
      daily_returns_series: [{ date: "2024-08-15", daily_return: 0.005 }],
    });
    const { POST } = await import("@/app/api/strategies/csv-finalize/route");
    const res = await POST(req);
    expect(res.status).toBe(200);
    await flushAfter();

    // The SELECT pre-check must have fired.
    expect(adminSelectMaybeSingleMock).toHaveBeenCalled();
    // The upsert must NOT have fired — the guard preserved the
    // worker's `complete` status.
    expect(adminUpsertMock).not.toHaveBeenCalled();
    // The route must have logged the skip for forensic trail.
    const skipLogged = warnSpy.mock.calls.some((call) =>
      call.some(
        (arg) => typeof arg === "string" && arg.includes("SKIPPED") && arg.includes("complete"),
      ),
    );
    expect(skipLogged).toBe(true);

    warnSpy.mockRestore();
    delete process.env.USE_COMPUTE_JOBS_QUEUE;
  });

  it("Test 12c: placeholder upsert PROCEEDS when worker has written non-terminal status (API M-2)", async () => {
    // Conversely: if the worker has written something other than
    // `complete` (e.g. stuck-`computing`, or a stale `failed`), the
    // route's placeholder write should still proceed — there is no
    // good outcome to preserve.
    process.env.USE_COMPUTE_JOBS_QUEUE = "true";
    STATE.runAfterCallback = true;
    adminRpcMock.mockResolvedValue({
      data: null,
      error: { code: "PGRST500", message: "another transient 5xx" },
    });
    adminSelectMaybeSingleMock.mockResolvedValue({
      data: { computation_status: "computing" },
      error: null,
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const req = makeJsonRequest({
      wizard_session_id: VALID_SESSION,
      fmt: "daily_returns",
      strategy_name: "Stuck computing race",
      daily_returns_series: [{ date: "2024-08-16", daily_return: 0.005 }],
    });
    const { POST } = await import("@/app/api/strategies/csv-finalize/route");
    const res = await POST(req);
    expect(res.status).toBe(200);
    await flushAfter();

    expect(adminSelectMaybeSingleMock).toHaveBeenCalled();
    // Upsert PROCEEDED because pre-existing status was not 'complete'.
    expect(adminUpsertMock).toHaveBeenCalledTimes(1);
    const [, payload] = adminUpsertMock.mock.calls[0];
    expect(payload).toMatchObject({
      strategy_id: NEW_STRATEGY_ID,
      computation_status: "failed",
    });

    warnSpy.mockRestore();
    delete process.env.USE_COMPUTE_JOBS_QUEUE;
  });

  // ---- 13. unified backbone returns missing strategy_id → 502 (API H-1)

  it("Test 13: unified backbone 200 with missing strategy_id → 502 CSV_FINALIZE_FAIL (API H-1)", async () => {
    // Phase 19.1 red-team (2026-05-22): if the upstream `/process-key`
    // csv-finalize branch returns 200 with no strategy_id (Python
    // regression, API drift, shape change), the route MUST NOT emit
    // ok:true with a missing id — the wizard's SyncProgress poller
    // would hit `if (!data) return` early-out forever because no
    // strategy_analytics row exists for it to find.
    isUnifiedBackboneActiveMock.mockResolvedValue(true);
    postProcessKeyMock.mockResolvedValue({
      ok: true,
      status: 200,
      body: { status: "pending_review" }, // ← strategy_id missing
    });
    process.env.INTERNAL_API_TOKEN = "test-token";

    const req = makeJsonRequest({
      wizard_session_id: VALID_SESSION,
      fmt: "daily_returns",
      strategy_name: "Missing strategy_id in upstream",
      daily_returns_series: [{ date: "2024-08-01", daily_return: 0.001 }],
    });
    const { POST } = await import("@/app/api/strategies/csv-finalize/route");
    const res = await POST(req);
    expect(res.status).toBe(502);
    const json = await res.json();
    expect(json.ok).toBe(false);
    expect(json.code).toBe("CSV_FINALIZE_FAIL");
    expect(json.human_message).toMatch(/unexpected response/i);
    expect(json.debug_context).toMatchObject({
      missing_strategy_id: true,
    });
    expect(typeof json.correlation_id).toBe("string");
    expect(json.correlation_id.length).toBeGreaterThan(0);
    // Critically: NO persist call, NO enqueue, NO metadata update —
    // the half-baked upstream is treated as a hard failure.
    const persistCalls = rpcMock.mock.calls.filter(
      ([name]) => name === "persist_csv_daily_returns",
    );
    expect(persistCalls).toHaveLength(0);

    delete process.env.INTERNAL_API_TOKEN;
  });

  it("Test 13b: unified backbone 200 with non-UUID strategy_id → 502 CSV_FINALIZE_FAIL", async () => {
    // Defense in depth: empty string and obvious garbage must also be
    // rejected, not just `undefined`. A typo in the Python router that
    // returns `strategy_id: ""` or `strategy_id: "TBD"` would otherwise
    // slip through the old typeof-string-and-truthy check (the empty
    // string was already gated, but anything else passed).
    isUnifiedBackboneActiveMock.mockResolvedValue(true);
    postProcessKeyMock.mockResolvedValue({
      ok: true,
      status: 200,
      body: { strategy_id: "not-a-uuid", status: "pending_review" },
    });
    process.env.INTERNAL_API_TOKEN = "test-token";

    const req = makeJsonRequest({
      wizard_session_id: VALID_SESSION,
      fmt: "daily_returns",
      strategy_name: "Garbage strategy_id in upstream",
      daily_returns_series: [{ date: "2024-09-01", daily_return: 0.002 }],
    });
    const { POST } = await import("@/app/api/strategies/csv-finalize/route");
    const res = await POST(req);
    expect(res.status).toBe(502);
    const json = await res.json();
    expect(json.code).toBe("CSV_FINALIZE_FAIL");
    expect(json.debug_context).toMatchObject({ missing_strategy_id: true });

    delete process.env.INTERNAL_API_TOKEN;
  });
});
