/**
 * Phase 16 / OBSERV-01 — analytics-client correlation_id header injection.
 *
 * Asserted invariants:
 *   1. analyticsRequest stamps `X-Correlation-Id` (PascalCase wire form,
 *      mirroring `X-Api-Version` / `X-Service-Key` precedent at lines 70-71)
 *      on every outbound fetch.
 *   2. When `options.correlationId` is provided, it is forwarded verbatim.
 *   3. When `options.correlationId` is omitted, a fresh UUID v4 is generated
 *      via `crypto.randomUUID()` so the chain is still joinable.
 *   4. `getCorrelationId()` reads `headers().get("x-correlation-id")` first
 *      and falls back to `crypto.randomUUID()` if absent. The constant
 *      `CORRELATION_HEADER` is the lowercase form (HTTP normalization)
 *      used with `headers.get()`.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("server-only", () => ({}));

const headersGetMock = vi.fn<(name: string) => string | null>(() => null);
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => ({ get: headersGetMock })),
}));

const UUID_V4_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe("Phase 16 / OBSERV-01 correlation_id propagation", () => {
  beforeEach(() => {
    headersGetMock.mockReset();
    headersGetMock.mockImplementation(() => null);
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("analyticsRequest X-Correlation-Id header", () => {
    async function loadAndCallWith(
      fetchMock: ReturnType<typeof vi.fn>,
      options?: { correlationId?: string },
    ) {
      // Cast through `unknown` so the loose `vi.fn()` return type can be
      // routed through `globalThis.fetch`'s strict signature without
      // re-typing every test's mock builder.
      vi.spyOn(globalThis, "fetch").mockImplementation(
        fetchMock as unknown as typeof globalThis.fetch,
      );
      const mod = await import("./analytics-client");
      // analyticsRequest is module-private. The test exercises it through
      // a public wrapper (validateKey) which threads its options through.
      // To honor the "wrappers don't expose correlationId" design constraint
      // (see plan Task 1 Step D), we expose the internal helper via a single
      // re-export marked `__INTERNAL_analyticsRequest` for test only.
      type Internal = {
        __INTERNAL_analyticsRequest: (
          path: string,
          body: Record<string, unknown> | null,
          options?: {
            timeoutMs?: number;
            method?: string;
            correlationId?: string;
          },
        ) => Promise<unknown>;
      };
      const internal = mod as unknown as Internal;
      return internal.__INTERNAL_analyticsRequest(
        "/test",
        { ping: 1 },
        options,
      );
    }

    it("forwards an explicit correlationId verbatim on the wire (Test 1)", async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        );
      await loadAndCallWith(fetchMock, { correlationId: "abc-123" });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const init = fetchMock.mock.calls[0][1] as RequestInit;
      const sent = init.headers as Record<string, string>;
      expect(sent["X-Correlation-Id"]).toBe("abc-123");
    });

    it("generates a fresh UUID v4 when correlationId is omitted (Test 2)", async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        );
      await loadAndCallWith(fetchMock);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const init = fetchMock.mock.calls[0][1] as RequestInit;
      const sent = init.headers as Record<string, string>;
      const cid = sent["X-Correlation-Id"];
      expect(cid).toBeDefined();
      expect(cid).toMatch(UUID_V4_RE);
    });
  });

  describe("getCorrelationId server helper", () => {
    it("returns the inbound header when present (Test 3 — present path)", async () => {
      headersGetMock.mockImplementation((name: string) =>
        name === "x-correlation-id" ? "header-cid-99" : null,
      );
      const mod = await import("./correlation-id");
      // Must be async — exercises Next.js 16 async headers() per AGENTS.md.
      expect(typeof mod.getCorrelationId).toBe("function");
      // AsyncFunction.constructor.name is "AsyncFunction".
      expect(mod.getCorrelationId.constructor.name).toBe("AsyncFunction");
      const cid = await mod.getCorrelationId();
      expect(cid).toBe("header-cid-99");
    });

    it("falls back to crypto.randomUUID() when header absent (Test 3 — fallback path)", async () => {
      headersGetMock.mockImplementation(() => null);
      const mod = await import("./correlation-id");
      const cid = await mod.getCorrelationId();
      expect(cid).toMatch(UUID_V4_RE);
    });

    it('exports CORRELATION_HEADER as "x-correlation-id" (Test 4)', async () => {
      const mod = await import("./correlation-id");
      expect(mod.CORRELATION_HEADER).toBe("x-correlation-id");
    });
  });
});
