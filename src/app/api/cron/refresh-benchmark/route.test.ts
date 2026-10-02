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
// Review fix HR-02: every failure arm captures to Sentry as well as logging.
// Mocked (the real helper swallows everything by design, so a route that
// stopped capturing would be indistinguishable from one that still does), but
// only this one export: `resilient-fetch` and `ratelimit` also import
// `shouldCaptureNow` from the module, so the rest stays real. Same idiom as
// `flag-monitor/route.test.ts`.
type CaptureOptions = {
  tags: Record<string, string>;
  level?: string;
};
const captureSpy = vi.hoisted(() =>
  vi.fn(async (_err: unknown, _options: CaptureOptions) => undefined),
);
const coreSpy = vi.hoisted(() => ({ fn: null as null | ReturnType<typeof vi.fn> }));

vi.mock("server-only", () => ({}));

vi.mock("@/lib/sentry-capture", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/sentry-capture")>()),
  captureToSentry: (err: unknown, options: CaptureOptions) =>
    captureSpy(err, options),
}));

/**
 * The route refuses a `through` older than yesterday (UTC), so every case runs
 * on a PINNED clock: 00:10 UTC on 2026-09-26, the cron's schedule, which makes
 * yesterday 2026-09-25. Only `Date` is faked, so the mocked transport promises
 * still resolve.
 */
const NOW = "2026-09-26T00:10:00Z";
const YESTERDAY = "2026-09-25";
const DAY_BEFORE_YESTERDAY = "2026-09-24";

/** The captures THIS route made (the seam core may capture on its own). */
const routeCaptures = () =>
  captureSpy.mock.calls.filter(
    ([, options]) => options?.tags?.route === "cron.refresh-benchmark",
  );

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
    captureSpy.mockClear();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(NOW));
  });

  afterEach(() => {
    vi.useRealTimers();
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
    expect(captureSpy).not.toHaveBeenCalled();
  });

  it("refuses 401 on a wrong Bearer and never consults the limiter", async () => {
    const limit = vi.spyOn(ratelimit, "checkLimit");
    const res = await handler(
      makeReq({ authorization: "Bearer wrong-secret-value-here-pad" }),
    );
    expect(res.status).toBe(401);
    expect(refreshMock).not.toHaveBeenCalled();
    expect(limit).not.toHaveBeenCalled();
    expect(captureSpy).not.toHaveBeenCalled();
  });

  it("refuses 401 when CRON_SECRET is unset, so the route is never open", async () => {
    delete process.env.CRON_SECRET;
    // "Bearer undefined" is exactly what an unset secret would compare against.
    const res = await handler(makeReq({ authorization: "Bearer undefined" }));
    expect(res.status).toBe(401);
    expect(refreshMock).not.toHaveBeenCalled();
    expect(captureSpy).not.toHaveBeenCalled();
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
    expect(routeCaptures()).toHaveLength(0);
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
    // The day's refresh was skipped; a non-2xx alone reaches nothing remote
    // (169.2 round-2 SFH LW-R2-02), so exactly one limiter capture.
    const captures = routeCaptures();
    expect(captures).toHaveLength(1);
    expect(captures[0][1]).toEqual({
      tags: { route: "cron.refresh-benchmark", stage: "limiter" },
      level: "error",
    });
  });

  it("consumes adminActionLimiter under the one fixed cron identifier", async () => {
    const limit = vi
      .spyOn(ratelimit, "checkLimit")
      .mockResolvedValue({ success: true });
    refreshMock.mockResolvedValue({
      symbol: "BTC",
      through: YESTERDAY,
      stale: false,
      points: 1000,
    });
    await handler(authed());
    expect(limit).toHaveBeenCalledTimes(1);
    expect(limit).toHaveBeenCalledWith(
      ratelimit.adminActionLimiter,
      "benchmark-refresh:cron",
    );
  });

  it("answers 200 with the through-date and point count when the service refreshed BTC through YESTERDAY (the boundary)", async () => {
    vi.spyOn(ratelimit, "checkLimit").mockResolvedValue({ success: true });
    const infoLog = vi.spyOn(console, "info").mockImplementation(() => {});
    refreshMock.mockResolvedValue({
      symbol: "BTC",
      through: YESTERDAY,
      stale: false,
      points: 1000,
    });
    const res = await handler(authed());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      through: YESTERDAY,
      points: 1000,
    });
    expect(refreshMock).toHaveBeenCalledTimes(1);
    expect(routeCaptures()).toHaveLength(0);
    // MD-06: the point count reaches the cron's log line, so a series far
    // shorter than the fetcher's window is visible without a DB query.
    const logged = infoLog.mock.calls.flat().map(String).join(" ");
    expect(logged).toContain(`through ${YESTERDAY}`);
    expect(logged).toContain("1000 points");
  });

  it("answers 502 (never 200) when the service answers 200 but its through-date is older than yesterday UTC, and pages it to Sentry", async () => {
    // WR-01 / HR-01, TS half: `stale: false` from the service means only that
    // the fetcher did not fall back to its cache. A lagging upstream still
    // yields a 200 whose newest day is two days old, and before this check the
    // cron reported it as a successful refresh.
    vi.spyOn(ratelimit, "checkLimit").mockResolvedValue({ success: true });
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    refreshMock.mockResolvedValue({
      symbol: "BTC",
      through: DAY_BEFORE_YESTERDAY,
      stale: false,
      points: 1000,
    });
    const res = await handler(authed());
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ ok: false });
    const logged = errorLog.mock.calls.flat().map(String).join(" ");
    expect(logged).toContain(DAY_BEFORE_YESTERDAY);
    expect(logged).toContain(YESTERDAY);
    expect(routeCaptures()).toHaveLength(1);
    expect(String(routeCaptures()[0][0])).toContain(
      DAY_BEFORE_YESTERDAY,
    );
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

  it("captures the failure to Sentry exactly once, with the caught error and the route tag (HR-02)", async () => {
    // WHY: none of the TS-side failure arms (a deadline, an unreachable
    // service, an open breaker, a contract violation) ever reaches the Python
    // service, so its Sentry never sees them. Before this capture the only
    // trace of a missed day was one function-log line.
    vi.spyOn(ratelimit, "checkLimit").mockResolvedValue({ success: true });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const failure = new Error("Analytics service error 500");
    refreshMock.mockRejectedValue(failure);
    const res = await handler(authed());
    expect(res.status).toBe(502);
    expect(routeCaptures()).toHaveLength(1);
    const [captured, options] = routeCaptures()[0];
    // The ORIGINAL error: `captureToSentry` scrubs it itself.
    expect(captured).toBe(failure);
    expect(options.tags).toEqual({
      route: "cron.refresh-benchmark",
      stage: "refresh",
    });
    expect(options.level).toBe("error");
  });
});

describe("refreshBenchmark — through the REAL seam core, transport mocked", () => {
  const originalSecret = process.env.CRON_SECRET;

  beforeEach(() => {
    captureSpy.mockClear();
    refreshMock.mockReset();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(NOW));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    if (originalSecret) process.env.CRON_SECRET = originalSecret;
    else delete process.env.CRON_SECRET;
  });

  const answer200 = (body: Record<string, unknown>) =>
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

  const actualClient = () =>
    vi.importActual<typeof import("@/lib/analytics-client")>(
      "@/lib/analytics-client",
    );

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

    expect(result).toEqual({
      symbol: "BTC",
      through: "2026-09-25",
      stale: false,
      points: 400,
    });
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

  // MD-01: `BenchmarkRefreshResponseSchema` is the only thing standing between
  // a service 200 that did NOT refresh and a green cron. Each body below is a
  // 200 the parse must refuse; with the guard loosened (`stale: z.boolean()`,
  // the regex dropped, `symbol: z.string()`, `points` optional) the matching
  // case goes green on a refresh that did not happen.
  it.each([
    ["stale: true", { symbol: "BTC", through: YESTERDAY, stale: true, points: 1000 }],
    ["a malformed through", { symbol: "BTC", through: "25/09/2026", stale: false, points: 1000 }],
    ["a symbol other than BTC", { symbol: "ETH", through: YESTERDAY, stale: false, points: 1000 }],
    ["no points count", { symbol: "BTC", through: YESTERDAY, stale: false }],
    ["zero points", { symbol: "BTC", through: YESTERDAY, stale: false, points: 0 }],
  ])("refuses a 200 carrying %s (the contract parse bites)", async (_label, body) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    answer200(body);
    const actual = await actualClient();
    await expect(actual.refreshBenchmark()).rejects.toThrow();
  });

  it("answers 502 from the ROUTE, and captures, when the service's 200 carries stale: true", async () => {
    // The same guard end to end: the route's mocked `refreshBenchmark` is
    // pointed at the REAL one, so the only thing between the service's 200 and
    // the cron's answer is the real seam core and the real schema.
    process.env.CRON_SECRET = env.secret;
    vi.spyOn(ratelimit, "checkLimit").mockResolvedValue({ success: true });
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const actual = await actualClient();
    refreshMock.mockImplementation(actual.refreshBenchmark);
    answer200({ symbol: "BTC", through: YESTERDAY, stale: true, points: 1000 });
    const res = await GET(authed());
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ ok: false });
    expect(routeCaptures()).toHaveLength(1);
  });
});
