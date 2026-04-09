import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { GET, POST } from "./route";
import type { NextRequest } from "next/server";

/**
 * Cron route handler tests. Exercises the auth-bypass guard (missing
 * secret, wrong header, valid header), the ANALYTICS_SERVICE_URL missing
 * path, and the happy-path response shape. Both GET and POST delegate to
 * the same handler so the test is parameterized across verbs.
 *
 * Added for PR 8 review finding: the original PR shipped without a test
 * file for the cron route even though the plan's coverage target stated
 * "24 tests across the 3 modules."
 */

function makeReq(headers: Record<string, string> = {}): NextRequest {
  return {
    headers: {
      get: (key: string) => headers[key.toLowerCase()] ?? null,
    },
  } as unknown as NextRequest;
}

describe.each([
  ["GET", GET],
  ["POST", POST],
] as const)("%s /api/cron/warm-analytics", (_verb, handler) => {
  const originalSecret = process.env.CRON_SECRET;
  const originalUrl = process.env.ANALYTICS_SERVICE_URL;

  beforeEach(() => {
    process.env.CRON_SECRET = "cron-secret-at-least-16-chars";
    process.env.ANALYTICS_SERVICE_URL = "https://analytics.example.com";
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalSecret) process.env.CRON_SECRET = originalSecret;
    else delete process.env.CRON_SECRET;
    if (originalUrl) process.env.ANALYTICS_SERVICE_URL = originalUrl;
    else delete process.env.ANALYTICS_SERVICE_URL;
  });

  it("returns 401 when CRON_SECRET is unset", async () => {
    delete process.env.CRON_SECRET;
    const res = await handler(makeReq({ authorization: "Bearer anything" }));
    expect(res.status).toBe(401);
  });

  it("returns 401 when the Authorization header is missing", async () => {
    const res = await handler(makeReq());
    expect(res.status).toBe(401);
  });

  it("returns 401 when the Authorization header is wrong", async () => {
    const res = await handler(
      makeReq({ authorization: "Bearer wrong-secret-value-here-pad" }),
    );
    expect(res.status).toBe(401);
  });

  it("returns 500 when ANALYTICS_SERVICE_URL is unset (so Vercel Cron alerts fire)", async () => {
    delete process.env.ANALYTICS_SERVICE_URL;
    const res = await handler(
      makeReq({
        authorization: `Bearer ${process.env.CRON_SECRET}`,
      }),
    );
    // Regression fix: a misconfig that returned HTTP 200 with `{ok: false}`
    // would produce a green cron history while the warmer was completely
    // broken. Returning 500 makes the Vercel dashboard light up red.
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.reason).toContain("ANALYTICS_SERVICE_URL");
  });

  it("issues a GET to the analytics /health endpoint on happy path", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 200 }));
    const res = await handler(
      makeReq({
        authorization: `Bearer ${process.env.CRON_SECRET}`,
      }),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://analytics.example.com/health");
    expect(init?.method).toBe("GET");
    expect(init?.cache).toBe("no-store");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.status).toBe(200);
    expect(typeof body.elapsed_ms).toBe("number");
  });

  it("returns 504 when the health fetch throws (timeout / network)", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network down"));
    const res = await handler(
      makeReq({
        authorization: `Bearer ${process.env.CRON_SECRET}`,
      }),
    );
    // Regression fix: propagate the failure as a 5xx so Vercel Cron's
    // failure alerts fire. Previously always 200 regardless of upstream.
    expect(res.status).toBe(504);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.reason).toContain("network down");
  });

  it("returns 502 when the upstream /health responds with 500", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 500 }),
    );
    const res = await handler(
      makeReq({
        authorization: `Bearer ${process.env.CRON_SECRET}`,
      }),
    );
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.status).toBe(500);
  });
});
