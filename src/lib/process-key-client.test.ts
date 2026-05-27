import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// process-key-client pulls in next/server (NextResponse) + correlation-id.
// Mock server-only so the module loads under vitest, and stub correlation-id
// (we pass an explicit correlationId, so the resolver is never exercised).
vi.mock("server-only", () => ({}));
vi.mock("@/lib/correlation-id", () => ({
  getCorrelationId: vi.fn(async () => "fallback-corr-id"),
}));

import { postProcessKey } from "./process-key-client";

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
