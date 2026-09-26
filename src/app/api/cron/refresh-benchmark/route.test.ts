import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import type { NextRequest } from "next/server";

/**
 * Phase 169.2 / plan 02 (SC3, D-08, D-20) — the daily BTC benchmark refresh
 * cron route.
 *
 * WHY EACH CASE MATTERS. Vercel Cron alarms ONLY on a non-2xx, so every path
 * that did not refresh the benchmark must answer non-2xx or the cron history
 * stays green while the factsheet's BTC line quietly goes stale (the defect
 * this phase exists to close). And the route is reachable by anyone on the
 * internet, so it must refuse without the CRON_SECRET Bearer and must never
 * reach the analytics service on a refusal.
 *
 * The four route cases mock `refreshBenchmark` only. The last case drives the
 * REAL `refreshBenchmark` through the REAL `resilientFetch` (wrapped in a
 * call-through spy so the budget key it received is observable) with only the
 * global `fetch` transport mocked, so the genuine `SEAM_BUDGETS` row is in
 * play — the same partial-mock idea `resilient-fetch.wiring.test.ts` uses.
 */

const env = vi.hoisted(() => {
  // `analytics-client.ts` reads ANALYTICS_SERVICE_KEY at MODULE scope, so it
  // must be set before any import of that module runs.
  process.env.ANALYTICS_SERVICE_KEY = "benchmark-refresh-service-key";
  process.env.INTERNAL_API_TOKEN = "benchmark-refresh-internal-token";
  process.env.ANALYTICS_SERVICE_URL = "https://analytics.example.com";
  return { secret: "cron-secret-at-least-16-chars" };
});

const refreshMock = vi.hoisted(() => vi.fn());
const coreSpy = vi.hoisted(() => ({ fn: null as null | ReturnType<typeof vi.fn> }));

vi.mock("server-only", () => ({}));

vi.mock("@/lib/analytics-client", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/analytics-client")>()),
  refreshBenchmark: refreshMock,
}));

// Everything real; `resilientFetch` is wrapped, never replaced, so the real
// core (budget table, breaker, deadline) still runs underneath the spy.
vi.mock("@/lib/resilient-fetch", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/resilient-fetch")>();
  const spy = vi.fn(actual.resilientFetch);
  coreSpy.fn = spy;
  return { ...actual, resilientFetch: spy };
});

// The REAL limiter module: `rateLimitDenyJson` under test is the production
// builder, and `checkLimit` is spied on it (the posture file's idiom).
import * as ratelimit from "@/lib/ratelimit";
import { GET, POST } from "./route";

function makeReq(headers: Record<string, string> = {}): NextRequest {
  return {
    headers: {
      get: (key: string) => headers[key.toLowerCase()] ?? null,
    },
  } as unknown as NextRequest;
}

const authed = () => makeReq({ authorization: `Bearer ${env.secret}` });

describe.each([
  ["GET", GET],
  ["POST", POST],
] as const)("%s /api/cron/refresh-benchmark", (_verb, handler) => {
  const originalSecret = process.env.CRON_SECRET;

  beforeEach(() => {
    process.env.CRON_SECRET = env.secret;
    refreshMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalSecret) process.env.CRON_SECRET = originalSecret;
    else delete process.env.CRON_SECRET;
  });

  it("refuses 401 without an Authorization header and never calls the service or the limiter", async () => {
    const limit = vi.spyOn(ratelimit, "checkLimit");
    const res = await handler(makeReq());
    expect(res.status).toBe(401);
    expect(refreshMock).not.toHaveBeenCalled();
    expect(limit).not.toHaveBeenCalled();
  });

  it("refuses 401 on a wrong Bearer and never consults the limiter", async () => {
    const limit = vi.spyOn(ratelimit, "checkLimit");
    const res = await handler(
      makeReq({ authorization: "Bearer wrong-secret-value-here-pad" }),
    );
    expect(res.status).toBe(401);
    expect(refreshMock).not.toHaveBeenCalled();
    expect(limit).not.toHaveBeenCalled();
  });

  it("refuses 401 when CRON_SECRET is unset, so the route is never open", async () => {
    delete process.env.CRON_SECRET;
    // "Bearer undefined" is exactly what an unset secret would compare against.
    const res = await handler(makeReq({ authorization: "Bearer undefined" }));
    expect(res.status).toBe(401);
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("answers 429 through rateLimitDenyJson when the limiter denies, and never calls the service", async () => {
    vi.spyOn(ratelimit, "checkLimit").mockResolvedValue({
      success: false,
      retryAfter: 42,
    });
    const res = await handler(authed());
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("42");
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("answers 503 (never 429, never 200) when the limiter is misconfigured, and never calls the service", async () => {
    vi.spyOn(ratelimit, "checkLimit").mockResolvedValue({
      success: false,
      retryAfter: 60,
      reason: "ratelimit_misconfigured",
    });
    const res = await handler(authed());
    expect(res.status).toBe(503);
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("consumes adminActionLimiter under the one fixed cron identifier", async () => {
    const limit = vi
      .spyOn(ratelimit, "checkLimit")
      .mockResolvedValue({ success: true });
    refreshMock.mockResolvedValue({
      symbol: "BTC",
      through: "2026-09-25",
      stale: false,
    });
    await handler(authed());
    expect(limit).toHaveBeenCalledTimes(1);
    expect(limit).toHaveBeenCalledWith(
      ratelimit.adminActionLimiter,
      "benchmark-refresh:cron",
    );
  });

  it("answers 200 with the refreshed through-date when the service refreshed BTC", async () => {
    vi.spyOn(ratelimit, "checkLimit").mockResolvedValue({ success: true });
    refreshMock.mockResolvedValue({
      symbol: "BTC",
      through: "2026-09-25",
      stale: false,
    });
    const res = await handler(authed());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, through: "2026-09-25" });
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it("answers 502 (never 200) when the service failed, and logs the error through the seam scrubber", async () => {
    vi.spyOn(ratelimit, "checkLimit").mockResolvedValue({ success: true });
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    // The seam scrubber replaces the exact VALUE of every seam secret env var.
    // An error that echoes the service key is the probe: it must reach the log
    // redacted, which only happens if the route passes it through the scrubber.
    const serviceKey = process.env.ANALYTICS_SERVICE_KEY as string;
    refreshMock.mockRejectedValue(
      new Error(`Analytics service error 500: key=${serviceKey}`),
    );
    const res = await handler(authed());
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ ok: false });
    expect(errorLog).toHaveBeenCalled();
    const logged = errorLog.mock.calls.flat().map(String).join(" ");
    expect(logged).toContain("refresh-benchmark");
    expect(logged).not.toContain(serviceKey);
    expect(logged).toContain("<redacted>");
  });
});

describe("refreshBenchmark — through the REAL seam core, transport mocked", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("issues exactly one core call on the benchmark-refresh budget to /api/benchmark-refresh", async () => {
    const transport = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          symbol: "BTC",
          through: "2026-09-25",
          stale: false,
          points: 400,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    coreSpy.fn?.mockClear();
    const actual = await vi.importActual<
      typeof import("@/lib/analytics-client")
    >("@/lib/analytics-client");

    const result = await actual.refreshBenchmark();

    expect(result).toEqual({ symbol: "BTC", through: "2026-09-25", stale: false });
    expect(coreSpy.fn).not.toBeNull();
    expect(coreSpy.fn).toHaveBeenCalledTimes(1);
    const [budgetKey, path] = coreSpy.fn!.mock.calls[0] as [string, string];
    expect(budgetKey).toBe("benchmark-refresh");
    expect(path).toBe("/api/benchmark-refresh");
    // One transport call: the key does not retry (a failed daily refresh pages,
    // and tomorrow's run is the retry).
    expect(transport).toHaveBeenCalledTimes(1);
    expect(String(transport.mock.calls[0][0])).toMatch(/\/api\/benchmark-refresh$/);
  });
});
