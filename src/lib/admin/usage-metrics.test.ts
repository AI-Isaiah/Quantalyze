import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// `import "server-only"` throws in jsdom — stub it so the module under
// test can be imported in the test environment.
vi.mock("server-only", () => ({}));

/**
 * Unit tests for `src/lib/admin/usage-metrics.ts` — the PostHog HogQL
 * helpers that back `/admin/usage`. These tests pin the resilience
 * contract documented in the module header:
 *
 *   - Missing `POSTHOG_API_KEY` short-circuits to `{ rows: [], error: ... }`
 *     with a single warning. No fetch is issued.
 *   - 5xx triggers exactly one retry with the cached response returned on
 *     a successful retry.
 *   - Two consecutive 5xx returns are surfaced as `{ error: "PostHog
 *     unavailable" }` with no cached fallback, OR the cached
 *     last-known-good payload when one exists.
 *   - Successful queries write through to the in-memory cache so a later
 *     PostHog incident can still serve last-known-good.
 */

const fetchSpy = vi.fn<typeof fetch>();

// Build a Response-like object the helpers can `.ok`/`.status`/`.json()` on.
function makeResponse(
  status: number,
  body: unknown,
): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

// Convenience: shape that matches PostHog's HogQL response.
function hogqlResults(rows: unknown[][]): { results: unknown[][] } {
  return { results: rows };
}

describe("src/lib/admin/usage-metrics.ts — PostHog HogQL helpers", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  const originalEnv = { ...process.env };

  beforeEach(async () => {
    fetchSpy.mockReset();
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    // Replace global fetch so we never hit the network. Cast through
    // unknown to avoid the strict signature mismatch jsdom enforces.
    vi.spyOn(globalThis, "fetch").mockImplementation(
      fetchSpy as unknown as typeof fetch,
    );
    // The module captures POSTHOG_* env vars at top-level, so they must
    // be set BEFORE the dynamic import in each test. Setting defaults
    // here covers the common case; the missing-key test deletes the
    // value before its own import.
    process.env.POSTHOG_API_KEY = "phx_test";
    process.env.POSTHOG_PROJECT_ID = "12345";
    process.env.POSTHOG_HOST = "https://example.posthog.com";
    // Force a module re-evaluation so each test gets a fresh cache and
    // a fresh read of the env-captured constants.
    vi.resetModules();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    warnSpy.mockRestore();
    vi.restoreAllMocks();
  });

  it("returns parsed shape on a successful 200", async () => {
    fetchSpy.mockResolvedValueOnce(
      makeResponse(
        200,
        hogqlResults([
          ["2026-04-15", "session_start", 7],
          ["2026-04-15", "widget_viewed", 12],
          ["2026-04-14", "session_start", 4],
        ]),
      ),
    );

    const { dailyFunnel } = await import("./usage-metrics");
    const result = await dailyFunnel(7);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(result.error).toBeUndefined();
    // Two unique days come back, sorted descending by day.
    expect(result.rows.map((r) => r.day)).toEqual([
      "2026-04-15",
      "2026-04-14",
    ]);
    const apr15 = result.rows.find((r) => r.day === "2026-04-15");
    expect(apr15).toMatchObject({
      session_start: 7,
      widget_viewed: 12,
      intro_submitted: 0,
      bridge_click: 0,
      alert_acknowledged: 0,
    });
  });

  it("retries once on 5xx and returns the second-attempt payload on success", async () => {
    fetchSpy
      .mockResolvedValueOnce(makeResponse(503, { error: "boom" }))
      .mockResolvedValueOnce(
        makeResponse(
          200,
          hogqlResults([["2026-04-15", "session_start", 3]]),
        ),
      );

    const { dailyFunnel } = await import("./usage-metrics");
    const result = await dailyFunnel(7);

    // Two attempts: the 5xx + the successful retry.
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(result.error).toBeUndefined();
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      day: "2026-04-15",
      session_start: 3,
    });
  });

  it("falls back to the cached last-known-good when both 5xx attempts fail", async () => {
    // Prime the cache with one successful call.
    fetchSpy.mockResolvedValueOnce(
      makeResponse(
        200,
        hogqlResults([["2026-04-10", "session_start", 99]]),
      ),
    );
    const { dailyFunnel } = await import("./usage-metrics");
    const primed = await dailyFunnel(7);
    expect(primed.error).toBeUndefined();
    expect(primed.rows[0]?.session_start).toBe(99);

    // Now both subsequent attempts 5xx — should return the cached payload.
    fetchSpy
      .mockResolvedValueOnce(makeResponse(503, {}))
      .mockResolvedValueOnce(makeResponse(503, {}));

    const second = await dailyFunnel(7);
    // Three total attempts: priming + 5xx + 5xx-retry.
    expect(fetchSpy).toHaveBeenCalledTimes(3);
    // Cached payload was returned (no error field, identical row).
    expect(second.error).toBeUndefined();
    expect(second.rows[0]?.session_start).toBe(99);
  });

  it("returns { error: PostHog unavailable } when both 5xx attempts fail and no cache exists", async () => {
    fetchSpy
      .mockResolvedValueOnce(makeResponse(503, {}))
      .mockResolvedValueOnce(makeResponse(503, {}));

    const { dailyFunnel } = await import("./usage-metrics");
    const result = await dailyFunnel(7);

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(result.rows).toEqual([]);
    expect(result.error).toBe("PostHog unavailable");
    expect(warnSpy).toHaveBeenCalled();
  });

  it("returns empty rows + warning when POSTHOG_API_KEY is missing — no fetch issued", async () => {
    delete process.env.POSTHOG_API_KEY;

    const { dailyFunnel } = await import("./usage-metrics");
    const result = await dailyFunnel(7);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.rows).toEqual([]);
    expect(result.error).toBe("PostHog API key not configured");
    expect(warnSpy).toHaveBeenCalled();
  });
});
