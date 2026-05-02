/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("server-only", () => ({}));

const mockAssertSameOrigin = vi.fn<(req: unknown) => Response | null>(
  () => null,
);
vi.mock("@/lib/csrf", () => ({
  assertSameOrigin: (req: unknown) => mockAssertSameOrigin(req),
}));

const mockGetUser = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: mockGetUser } }),
}));

const mockIsAdminUser = vi.fn();
vi.mock("@/lib/admin", () => ({
  isAdminUser: (...args: unknown[]) => mockIsAdminUser(...args),
}));

const mockLogAuditEvent = vi.fn();
vi.mock("@/lib/audit", () => ({
  logAuditEvent: (...args: unknown[]) => mockLogAuditEvent(...args),
}));

const mockGetCorrelationId = vi.fn(async () => "cid-test");
vi.mock("@/lib/correlation-id", () => ({
  getCorrelationId: () => mockGetCorrelationId(),
  CORRELATION_HEADER: "x-correlation-id",
}));

interface RateLimitResultMock {
  allowed: boolean;
  remaining: number;
  retry_after_seconds?: number;
}
const mockCheckRate = vi.fn<(uid: string) => RateLimitResultMock>(() => ({
  allowed: true,
  remaining: 4,
}));
vi.mock("./rate-limit", () => ({
  checkDebugKeyFlowRateLimit: (uid: string) => mockCheckRate(uid),
}));

const FETCH = vi.fn();
const realFetch = global.fetch;

function makeReq(body: unknown): Request {
  return new Request("http://localhost/api/debug-key-flow", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "http://localhost",
    },
    body: JSON.stringify(body),
  });
}

describe("[OBSERV-07] /api/debug-key-flow SSE", () => {
  let POST: typeof import("./route").POST;

  beforeEach(async () => {
    vi.stubEnv("INTERNAL_API_TOKEN", "internal-token");
    vi.stubEnv("ANALYTICS_SERVICE_URL", "http://analytics");
    mockAssertSameOrigin.mockReturnValue(null);
    mockGetUser.mockResolvedValue({ data: { user: { id: "admin-1" } } });
    mockIsAdminUser.mockResolvedValue(true);
    mockLogAuditEvent.mockReset();
    mockCheckRate.mockReturnValue({ allowed: true, remaining: 4 });
    FETCH.mockReset();
    global.fetch = FETCH as never;
    ({ POST } = await import("./route"));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    global.fetch = realFetch;
  });

  it("rejects cross-origin with 403", async () => {
    mockAssertSameOrigin.mockReturnValue(new Response(null, { status: 403 }));
    const res = await POST(makeReq({ broker: "okx" }) as never);
    expect(res.status).toBe(403);
  });

  it("rejects non-admin with 403 (NOT 404)", async () => {
    mockIsAdminUser.mockResolvedValue(false);
    const res = await POST(makeReq({ broker: "okx" }) as never);
    expect(res.status).toBe(403);
  });

  it("rejects invalid body with 400", async () => {
    const res = await POST(makeReq({ broker: "fake" }) as never);
    expect(res.status).toBe(400);
  });

  it("rejects when rate limit exceeded with 429", async () => {
    mockCheckRate.mockReturnValue({
      allowed: false,
      remaining: 0,
      retry_after_seconds: 60,
    });
    const res = await POST(makeReq({ broker: "okx" }) as never);
    expect(res.status).toBe(429);
  });

  it("valid admin call returns 200 + text/event-stream + X-Accel-Buffering=no", async () => {
    FETCH.mockResolvedValue(
      new Response(
        JSON.stringify({ step: "validate_key", status: "ok", duration_ms: 5 }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );
    const res = await POST(makeReq({ broker: "okx" }) as never);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    expect(res.headers.get("x-accel-buffering")).toBe("no");
  });

  it("audit row inserted BEFORE first stream event (Pattern E)", async () => {
    let auditCalledAt = -1;
    let firstEnqueueAt = -1;
    let counter = 0;
    mockLogAuditEvent.mockImplementation(() => {
      if (auditCalledAt === -1) auditCalledAt = ++counter;
    });
    FETCH.mockImplementation(async () => {
      if (firstEnqueueAt === -1) firstEnqueueAt = ++counter;
      return new Response(
        JSON.stringify({ step: "validate_key", status: "ok", duration_ms: 1 }),
        { status: 200 },
      );
    });
    const res = await POST(makeReq({ broker: "okx" }) as never);
    // drain the stream so fetch fires
    if (res.body) {
      const reader = res.body.getReader();
      while (true) {
        const { done } = await reader.read();
        if (done) break;
      }
    }
    expect(auditCalledAt).toBeGreaterThan(0);
    expect(auditCalledAt).toBeLessThan(firstEnqueueAt);
  });

  it("SSE body contains at least one frame with step + correlation_id", async () => {
    FETCH.mockResolvedValue(
      new Response(
        JSON.stringify({ step: "validate_key", status: "ok", duration_ms: 5 }),
        { status: 200 },
      ),
    );
    const res = await POST(makeReq({ broker: "okx" }) as never);
    const text = await new Response(res.body).text();
    expect(text).toContain("data: {");
    expect(text).toContain('"correlation_id":"cid-test"');
  });

  it("terminal frame has step='done' and envelope", async () => {
    FETCH.mockResolvedValue(
      new Response(
        JSON.stringify({ step: "validate_key", status: "ok", duration_ms: 5 }),
        { status: 200 },
      ),
    );
    const res = await POST(makeReq({ broker: "okx" }) as never);
    const text = await new Response(res.body).text();
    expect(text).toMatch(/"step":"done".*"envelope":\{/);
  });

  // Regression: WR-02 — malformed JSON body from a 200-status upstream must
  // surface as UPSTREAM_INVALID_JSON, NOT silently green-light the step.
  it("[WR-02] malformed upstream JSON surfaces UPSTREAM_INVALID_JSON, not silent ok", async () => {
    FETCH.mockResolvedValue(
      new Response("not-json-at-all", {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const res = await POST(makeReq({ broker: "okx" }) as never);
    const text = await new Response(res.body).text();
    expect(text).toContain('"code":"UPSTREAM_INVALID_JSON"');
    // Must mark the final envelope as not-ok
    expect(text).toMatch(/"step":"done"[^]*"envelope":\{[^}]*"ok":false[^}]*"code":"UPSTREAM_INVALID_JSON"/);
    // Must NOT report status:ok for a step that returned malformed JSON
    expect(text).not.toMatch(/"step":"validate","status":"ok"/);
  });

  // Regression: WR-03 — entity_id MUST be a UUID (migration 049 enforces uuid
  // type). Inbound X-Correlation-Id is attacker-controllable and may be any
  // string; we must mint a synthetic UUID for entity_id and stash the inbound
  // cid in metadata.
  it("[WR-03] non-UUID correlation_id still produces an audit row with synthetic UUID entity_id", async () => {
    mockGetCorrelationId.mockResolvedValueOnce("not-a-uuid; DROP TABLE users;--");
    FETCH.mockResolvedValue(
      new Response(
        JSON.stringify({ step: "validate_key", status: "ok", duration_ms: 1 }),
        { status: 200 },
      ),
    );
    await POST(makeReq({ broker: "okx" }) as never);
    expect(mockLogAuditEvent).toHaveBeenCalledTimes(1);
    const auditCall = mockLogAuditEvent.mock.calls[0][1];
    // entity_id must look like a UUID v4 (8-4-4-4-12 hex)
    expect(auditCall.entity_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    // entity_id must NOT be the attacker-supplied value
    expect(auditCall.entity_id).not.toBe("not-a-uuid; DROP TABLE users;--");
    // inbound cid must be preserved in metadata for forensic linkage
    expect(auditCall.metadata).toMatchObject({
      correlation_id: "not-a-uuid; DROP TABLE users;--",
      broker: "okx",
      admin_user_id: "admin-1",
    });
  });

  it("heartbeat interval is set up (clears in finally)", async () => {
    const setSpy = vi.spyOn(globalThis, "setInterval");
    const clearSpy = vi.spyOn(globalThis, "clearInterval");
    FETCH.mockResolvedValue(
      new Response(
        JSON.stringify({ step: "validate_key", status: "ok", duration_ms: 5 }),
        { status: 200 },
      ),
    );
    const res = await POST(makeReq({ broker: "okx" }) as never);
    if (res.body) {
      const reader = res.body.getReader();
      while (true) {
        const { done } = await reader.read();
        if (done) break;
      }
    }
    expect(setSpy).toHaveBeenCalled();
    const call = setSpy.mock.calls.find((c) => c[1] === 15_000);
    expect(call).toBeDefined();
    expect(clearSpy).toHaveBeenCalled();
    setSpy.mockRestore();
    clearSpy.mockRestore();
  });
});
