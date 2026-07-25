/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

/**
 * Phase 140 review / G6 — csv-validate's breaker envelope pass-through.
 *
 * This route reaches the seam through `postProcessKey` and forwards
 * `result.response` verbatim (`if (!result.ok) return result.response`), so it
 * inherits the SEAM-04 503 for free. "For free" is exactly the problem: the
 * route had NO test file at all, so a refactor that stopped forwarding the
 * response — or, worse, that let the breaker throw into the catch arm below it
 * and be relabelled `CSV_UPSTREAM_FAIL`/502 — would silently replace an
 * actionable "retry in 30s" with a dead end, and nothing would go red.
 *
 * That relabelling risk is real and specific here: this handler wraps the
 * postProcessKey call in a try/catch that maps ANY throw to a 502
 * CSV_UPSTREAM_FAIL. The breaker 503 survives only because postProcessKey
 * RETURNS it rather than throwing. The second test pins that distinction.
 *
 * SCOPE: the envelope's CONSTRUCTION is proven against the real client in
 * process-key-client.test.ts and verify-strategy/route.test.ts. What is pinned
 * here is that this route hands it to the caller UNCHANGED.
 */

vi.mock("server-only", () => ({}));

const USER = { id: "11111111-1111-4111-8111-111111111111" };

vi.mock("@/lib/api/withAuth", () => ({
  withAuth:
    (handler: (req: NextRequest, user: typeof USER) => Promise<Response>) =>
    (req: NextRequest) =>
      handler(req, USER),
}));

const checkLimitMock = vi.hoisted(() =>
  vi.fn(async () => ({ success: true, retryAfter: 0 })),
);
vi.mock("@/lib/ratelimit", () => ({
  csvValidateLimiter: {},
  checkLimit: checkLimitMock,
}));

const postProcessKeyMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/process-key-client", () => ({
  postProcessKey: postProcessKeyMock,
}));

const SESSION_ID = "22222222-2222-4222-8222-222222222222";

/**
 * A minimal, VALID multipart request — every shape gate must pass so the
 * request actually reaches the seam call under test.
 *
 * ⚠️ THIS FILE RUNS UNDER THE NODE ENVIRONMENT (see the directive at the top).
 * The repo default is jsdom, where `req.formData()` on ANY multipart body
 * containing a file part throws an undici assertion — both a hand-rolled
 * boundary and a real `FormData` instance fail identically. Under jsdom this
 * route rejects every request with "Invalid multipart body" before reaching
 * the seam, so all three tests below would pass or fail for reasons that have
 * nothing to do with the breaker. `email.test.ts` and `profile-validation.test.ts`
 * are the in-repo precedent for the directive.
 */
function makeRequest(): NextRequest {
  const form = new FormData();
  form.set(
    "file",
    new File(["date,daily_return\n2026-01-01,0.01\n"], "track.csv", {
      type: "text/csv",
    }),
  );
  form.set("fmt", "daily_returns");
  form.set("wizard_session_id", SESSION_ID);
  return new NextRequest("http://localhost:3000/api/strategies/csv-validate", {
    method: "POST",
    body: form,
  });
}

describe("POST /api/strategies/csv-validate — G6 breaker envelope pass-through", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    checkLimitMock.mockResolvedValue({ success: true, retryAfter: 0 });
    process.env.INTERNAL_API_TOKEN = "test-internal-token";
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("forwards the 503 CIRCUIT_OPEN envelope verbatim", async () => {
    postProcessKeyMock.mockResolvedValue({
      ok: false,
      response: NextResponse.json(
        {
          ok: false,
          code: "CIRCUIT_OPEN",
          human_message:
            "The analytics service is temporarily unavailable. Please try again in a moment.",
          correlation_id: "corr-g6",
          recoverable: true,
        },
        { status: 503, headers: { "Retry-After": "23" } },
      ),
    });

    const { POST } = await import("./route");
    const res = await POST(makeRequest());

    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.code).toBe("CIRCUIT_OPEN");
    expect(body.recoverable).toBe(true);
    // NOT relabelled to the route's own CSV_UPSTREAM_FAIL/502.
    expect(body.code).not.toBe("CSV_UPSTREAM_FAIL");
    // The hint is what makes the failure actionable; dropping it on the way
    // through would be invisible without this assertion.
    expect(res.headers.get("Retry-After")).toBe("23");
  });

  it("POSITIVE CONTROL: a genuine THROW still becomes CSV_UPSTREAM_FAIL/502", async () => {
    // The handler maps any throw to a 502 CSV_UPSTREAM_FAIL. That arm must keep
    // working — and it is precisely why the breaker envelope has to arrive as a
    // RETURNED value: if postProcessKey ever threw the CircuitOpenError instead,
    // the actionable 503 would be silently relabelled by this very catch.
    vi.spyOn(console, "error").mockImplementation(() => {});
    postProcessKeyMock.mockRejectedValue(new Error("upstream exploded"));

    const { POST } = await import("./route");
    const res = await POST(makeRequest());

    expect(res.status).toBe(502);
    expect((await res.json()).code).toBe("CSV_UPSTREAM_FAIL");
  });

  it("passes a successful body straight through", async () => {
    postProcessKeyMock.mockResolvedValue({
      ok: true,
      status: 200,
      body: { ok: true, preview: { rows: 1 } },
    });

    const { POST } = await import("./route");
    const res = await POST(makeRequest());

    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });
});
