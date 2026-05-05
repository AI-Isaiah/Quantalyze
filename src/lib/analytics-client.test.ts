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

    // Phase-16 IN-02 regression: an upstream proxy that strips the value
    // (or a client that sends `X-Correlation-Id:` with an empty string)
    // must NOT bypass the joinability invariant. The pre-fix `??` operator
    // only fired on null/undefined, so an empty string passed through and
    // re-broadcast to FastAPI as the empty header.
    it("mints a fresh UUID when the inbound header is the empty string (IN-02)", async () => {
      headersGetMock.mockImplementation((name: string) =>
        name === "x-correlation-id" ? "" : null,
      );
      const mod = await import("./correlation-id");
      const cid = await mod.getCorrelationId();
      expect(cid).not.toBe("");
      expect(cid).toMatch(UUID_V4_RE);
    });

    // Adversarial follow-up: whitespace-only and garbage-shaped inbound
    // values must also re-mint. Without the shape allowlist, a hostile
    // proxy could send `X-Correlation-Id: \r\nX-Forwarded-For: evil` and
    // get the literal value re-broadcast into structlog records (header
    // injection / log injection).
    const HOSTILE_INPUTS = [
      "   ",
      "\t",
      "\r\nX-Forwarded-For: evil",
      "abc def",                       // space — legal in HTTP headers but rejected here
      "<script>alert(1)</script>",
      "a".repeat(129),                  // length cap
      "no-control\x00chars",            // NUL embedded
    ];
    for (const hostile of HOSTILE_INPUTS) {
      it(`rejects hostile inbound value (length=${hostile.length}, sample=${JSON.stringify(hostile.slice(0, 20))}) and mints UUID`, async () => {
        headersGetMock.mockImplementation((name: string) =>
          name === "x-correlation-id" ? hostile : null,
        );
        const mod = await import("./correlation-id");
        const cid = await mod.getCorrelationId();
        expect(cid).toMatch(UUID_V4_RE);
        expect(cid).not.toBe(hostile);
      });
    }

    // Positive: a well-formed broker-prefixed correlation_id must pass through.
    it("accepts a broker-prefixed UUID like `okx:<uuid>` verbatim", async () => {
      const valid = "okx:9b3a47de-8c12-4d75-a2e6-ff0e10b2c1d3";
      headersGetMock.mockImplementation((name: string) =>
        name === "x-correlation-id" ? valid : null,
      );
      const mod = await import("./correlation-id");
      const cid = await mod.getCorrelationId();
      expect(cid).toBe(valid);
    });

    // Positive: leading/trailing whitespace is trimmed but the value is preserved.
    it("trims surrounding whitespace from a valid inbound value", async () => {
      const inner = "9b3a47de-8c12-4d75-a2e6-ff0e10b2c1d3";
      headersGetMock.mockImplementation((name: string) =>
        name === "x-correlation-id" ? `  ${inner}  ` : null,
      );
      const mod = await import("./correlation-id");
      const cid = await mod.getCorrelationId();
      expect(cid).toBe(inner);
    });
  });
});
