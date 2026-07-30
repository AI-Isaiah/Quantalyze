import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CircuitOpenError } from "@/lib/seam-errors";
import type { NextResponse } from "next/server";

// process-key-client pulls in next/server (NextResponse) + correlation-id.
// Mock server-only so the module loads under vitest, and stub correlation-id
// (we pass an explicit correlationId, so the resolver is never exercised).
vi.mock("server-only", () => ({}));
vi.mock("@/lib/correlation-id", () => ({
  getCorrelationId: vi.fn(async () => "fallback-corr-id"),
}));

/**
 * Phase 140 / SEAM-01 — the transport is now `resilientFetch`. The spy WRAPS
 * the real core rather than replacing it, so the pre-existing header tests
 * below keep exercising the full path down to `global.fetch` unmodified while
 * the new tests can (a) read the budgetKey the client selected and (b) inject
 * a `CircuitOpenError` without needing a live Upstash store.
 */
const coreSpy = vi.hoisted(() => vi.fn());

vi.mock("@/lib/resilient-fetch", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/resilient-fetch")>();
  return { ...actual, resilientFetch: coreSpy };
});

beforeEach(async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/resilient-fetch")>(
      "@/lib/resilient-fetch",
    );
  coreSpy.mockReset();
  coreSpy.mockImplementation(
    actual.resilientFetch as unknown as (...args: unknown[]) => unknown,
  );
});

import { postProcessKey } from "./process-key-client";

/** Narrow the discriminated union to its failure arm for envelope assertions. */
function failureResponse(result: Awaited<ReturnType<typeof postProcessKey>>) {
  if (result.ok) throw new Error("expected the failure arm of the union");
  return result.response as NextResponse;
}

/**
 * Phase 19.1 (2026-05-27) — finalize_csv_strategy is a SECURITY DEFINER RPC
 * gated on auth.uid() = p_user_id. The unified router can only satisfy that if
 * the Next.js route forwards the end user's access token, which postProcessKey
 * must place in the X-User-Access-Token header. These tests pin that the header
 * is present exactly when (and only when) userAccessToken is supplied.
 */
describe("postProcessKey — X-User-Access-Token forwarding", () => {
  const realFetch = global.fetch;

  beforeEach(() => {
    process.env.INTERNAL_API_TOKEN = "internal-test-token";
    process.env.ANALYTICS_SERVICE_URL = "http://analytics.test";
  });

  afterEach(() => {
    global.fetch = realFetch;
    vi.restoreAllMocks();
  });

  function mockFetchOk() {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ ok: true, strategy_id: "s1" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;
    return fetchMock;
  }

  function headersOf(fetchMock: ReturnType<typeof vi.fn>): Record<string, string> {
    return (fetchMock.mock.calls[0][1] as RequestInit).headers as Record<
      string,
      string
    >;
  }

  it("forwards the user JWT as X-User-Access-Token when userAccessToken is set", async () => {
    const fetchMock = mockFetchOk();

    const result = await postProcessKey({
      flow_type: "csv",
      source: "csv",
      context: { step: "finalize" },
      userId: "u1",
      correlationId: "c1",
      userAccessToken: "jwt-abc",
    });

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledOnce();
    const headers = headersOf(fetchMock);
    expect(headers["X-User-Access-Token"]).toBe("jwt-abc");
    // The internal-token Bearer is unchanged (separate credential).
    expect(headers["Authorization"]).toBe("Bearer internal-test-token");
  });

  it("omits X-User-Access-Token when no userAccessToken (validate-only / teaser)", async () => {
    const fetchMock = mockFetchOk();

    await postProcessKey({
      flow_type: "csv",
      source: "csv",
      context: { step: "validate" },
      userId: "u1",
      correlationId: "c1",
    });

    const headers = headersOf(fetchMock);
    expect(headers["X-User-Access-Token"]).toBeUndefined();
    expect(headers["Authorization"]).toBe("Bearer internal-test-token");
  });
});

/**
 * Phase 140 / SEAM-04 (SC-5d) — the CIRCUIT_OPEN envelope.
 *
 * `postProcessKey` is Mechanism B: five route handlers (keys/sync,
 * verify-strategy, finalize-wizard, csv-validate, csv-finalize) short-circuit
 * on `result.response` without inspecting it. Shipping the 503 arm HERE is
 * what makes all five inherit breaker handling — the alternative is five
 * copy-pasted catch blocks, which is exactly the drift this client was
 * created to end.
 *
 * The envelope shape is LOCKED (ROADMAP decision 8):
 * `{ok, code, human_message, correlation_id, recoverable}` + `Retry-After`.
 * `human_message` is STATIC — it must never carry upstream detail, because a
 * breaker trip is an infrastructure fact and the user-facing copy is the only
 * thing an unauthenticated teaser caller sees.
 */
describe("postProcessKey — Phase 140 / SEAM-04 CIRCUIT_OPEN envelope", () => {
  beforeEach(() => {
    process.env.INTERNAL_API_TOKEN = "internal-test-token";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("SC-5d: returns 503 CIRCUIT_OPEN with all five envelope fields and Retry-After", async () => {
    coreSpy.mockRejectedValue(new CircuitOpenError(30));

    const result = await postProcessKey({
      flow_type: "resync",
      source: "keys-sync",
      context: { key_id: "k1" },
      userId: "u1",
      correlationId: "c1",
      routeTag: "keys/sync",
    });

    expect(result.ok).toBe(false);
    const response = failureResponse(result);
    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("30");

    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toEqual({
      ok: false,
      code: "CIRCUIT_OPEN",
      human_message: expect.any(String),
      correlation_id: "c1",
      recoverable: true,
    });
    // Static copy: no upstream URL, no error detail, no service internals.
    expect(String(body.human_message)).not.toMatch(
      /circuit|upstash|railway|http|localhost/i,
    );
  });

  it("advertises the breaker's own cooldown, not a hardcoded constant", async () => {
    coreSpy.mockRejectedValue(new CircuitOpenError(7));
    const result = await postProcessKey({
      flow_type: "teaser",
      source: "landing",
      context: {},
      userId: "public",
      correlationId: "c2",
    });
    expect(failureResponse(result).headers.get("Retry-After")).toBe("7");
  });

  it("does NOT flatten CIRCUIT_OPEN into the 504 UPSTREAM_TIMEOUT arm", async () => {
    coreSpy.mockRejectedValue(new CircuitOpenError(30));
    const result = await postProcessKey({
      flow_type: "csv",
      source: "csv",
      context: {},
      userId: "u1",
      correlationId: "c3",
    });
    const response = failureResponse(result);
    expect(response.status).not.toBe(504);
    expect(response.status).not.toBe(502);
    expect(((await response.json()) as { code: string }).code).toBe(
      "CIRCUIT_OPEN",
    );
  });
});

/**
 * Phase 140 / SEAM-02 — the enqueue/sync budget split.
 *
 * `analytics-service/routers/process_key.py:_is_long_fetch` splits the SAME
 * endpoint into two latency classes: {resync, onboard} merely enqueue onto the
 * worker dyno and return 202, while {teaser, csv} run the full 5-method
 * pipeline INLINE. The pre-140 client spent a blanket 60s on all four, so an
 * enqueue that had already failed held a Vercel concurrency slot for 45s more
 * than it needed to. These pin that the client picks the budget key matching
 * the server's own split.
 */
describe("postProcessKey — enqueue vs sync budget selection", () => {
  beforeEach(() => {
    process.env.INTERNAL_API_TOKEN = "internal-test-token";
    coreSpy.mockImplementation(
      async () =>
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    ["resync", "process-key-enqueue"],
    ["onboard", "process-key-enqueue"],
    ["teaser", "process-key-sync"],
    ["csv", "process-key-sync"],
  ] as const)(
    "flow_type %s selects the %s budget",
    async (flowType, expectedBudgetKey) => {
      await postProcessKey({
        flow_type: flowType,
        source: "test",
        context: {},
        userId: "u1",
        correlationId: "c1",
      });
      expect(coreSpy).toHaveBeenCalledTimes(1);
      expect(coreSpy.mock.calls[0][0]).toBe(expectedBudgetKey);
      expect(coreSpy.mock.calls[0][1]).toBe("/process-key");
    },
  );
});
