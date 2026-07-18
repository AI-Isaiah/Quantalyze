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

/**
 * G15-003 — AnalyticsUpstreamError forwarding contract.
 *
 * Pins the four invariants route handlers rely on when forwarding upstream
 * errors instead of flattening every failure to 500:
 *   - 4xx body is forwarded as 4xx (NOT 500)
 *   - 5xx body is forwarded as 5xx (with the original status)
 *   - JSON-body vs text-body fork (analyticsRequest reads .json() then
 *     falls back to .text() when content-type is not application/json)
 *   - statusCode (.status) and message (.body equivalent) round-trip
 *   - Non-Error-shape throw inside fetch (network failure) bubbles up as
 *     the wrapper's generic "not reachable" Error, NOT AnalyticsUpstreamError
 */
describe("AnalyticsUpstreamError", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function callInternal(
    fetchMock: ReturnType<typeof vi.fn>,
  ): Promise<unknown> {
    vi.spyOn(globalThis, "fetch").mockImplementation(
      fetchMock as unknown as typeof globalThis.fetch,
    );
    const mod = await import("./analytics-client");
    type Internal = {
      __INTERNAL_analyticsRequest: (
        path: string,
        body: Record<string, unknown> | null,
      ) => Promise<unknown>;
    };
    return (mod as unknown as Internal).__INTERNAL_analyticsRequest(
      "/test",
      { ping: 1 },
    );
  }

  it("constructor preserves message and status round-trip", async () => {
    const mod = await import("./analytics-client");
    const err = new mod.AnalyticsUpstreamError("boom", 418);
    expect(err.message).toBe("boom");
    expect(err.status).toBe(418);
    expect(err.name).toBe("AnalyticsUpstreamError");
    expect(err).toBeInstanceOf(Error);
  });

  it("H-1144: constructor fails loud on an out-of-range / non-integer HTTP status", async () => {
    const mod = await import("./analytics-client");
    // Valid HTTP statuses incl. the 100/599 boundaries construct fine.
    expect(new mod.AnalyticsUpstreamError("ok", 100).status).toBe(100);
    expect(new mod.AnalyticsUpstreamError("ok", 599).status).toBe(599);
    // Invalid statuses throw at construction — the documented contract is that
    // `status` is forwarded as the HTTP response code, so a NaN / non-integer /
    // out-of-range value must never silently become an invalid response status.
    for (const bad of [0, 99, 600, 404.5, NaN]) {
      expect(() => new mod.AnalyticsUpstreamError("x", bad)).toThrow(
        /invalid HTTP status/i,
      );
    }
  });

  it("forwards 4xx JSON body as AnalyticsUpstreamError(status=400)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ detail: "already in portfolio" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      }),
    );
    const mod = await import("./analytics-client");
    let caught: unknown;
    try {
      await callInternal(fetchMock);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(mod.AnalyticsUpstreamError);
    const err = caught as InstanceType<typeof mod.AnalyticsUpstreamError>;
    expect(err.status).toBe(400);
    expect(err.message).toBe("already in portfolio");
  });

  it("forwards 404 JSON body as AnalyticsUpstreamError(status=404)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ detail: "portfolio not found" }), {
        status: 404,
        headers: { "content-type": "application/json" },
      }),
    );
    const mod = await import("./analytics-client");
    let caught: unknown;
    try {
      await callInternal(fetchMock);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(mod.AnalyticsUpstreamError);
    const err = caught as InstanceType<typeof mod.AnalyticsUpstreamError>;
    expect(err.status).toBe(404);
    expect(err.message).toBe("portfolio not found");
  });

  it("forwards 5xx JSON body as AnalyticsUpstreamError(status=502)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ detail: "upstream blew up" }), {
        status: 502,
        headers: { "content-type": "application/json" },
      }),
    );
    const mod = await import("./analytics-client");
    let caught: unknown;
    try {
      await callInternal(fetchMock);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(mod.AnalyticsUpstreamError);
    const err = caught as InstanceType<typeof mod.AnalyticsUpstreamError>;
    expect(err.status).toBe(502);
    expect(err.message).toBe("upstream blew up");
  });

  it("falls back to .text() when error body is non-JSON (text body fork)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("Internal Server Error trace...", {
        status: 500,
        headers: { "content-type": "text/plain" },
      }),
    );
    const mod = await import("./analytics-client");
    let caught: unknown;
    try {
      await callInternal(fetchMock);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(mod.AnalyticsUpstreamError);
    const err = caught as InstanceType<typeof mod.AnalyticsUpstreamError>;
    expect(err.status).toBe(500);
    expect(err.message).toBe("Internal Server Error trace...");
  });

  it("uses res.statusText when JSON body has no detail field", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      // Response with no body but a JSON content-type → .json() resolves
      // to {detail: statusText} via the safety catch in analytics-client.
      new Response("", {
        status: 503,
        statusText: "Service Unavailable",
        headers: { "content-type": "application/json" },
      }),
    );
    const mod = await import("./analytics-client");
    let caught: unknown;
    try {
      await callInternal(fetchMock);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(mod.AnalyticsUpstreamError);
    const err = caught as InstanceType<typeof mod.AnalyticsUpstreamError>;
    expect(err.status).toBe(503);
    expect(err.message).toBe("Service Unavailable");
  });

  it("network failure bubbles up as generic Error, NOT AnalyticsUpstreamError", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValue(new TypeError("network down"));
    const mod = await import("./analytics-client");
    let caught: unknown;
    try {
      await callInternal(fetchMock);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(caught).not.toBeInstanceOf(mod.AnalyticsUpstreamError);
    expect((caught as Error).message).toMatch(/not reachable/i);
  });

  it("timeout (AbortSignal.timeout DOMException) throws AnalyticsTimeoutError, not AnalyticsUpstreamError", async () => {
    // DOMException with name='TimeoutError' is the AbortSignal.timeout shape.
    const timeoutErr = new DOMException("aborted", "TimeoutError");
    const fetchMock = vi.fn().mockRejectedValue(timeoutErr);
    const mod = await import("./analytics-client");
    let caught: unknown;
    try {
      await callInternal(fetchMock);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(mod.AnalyticsTimeoutError);
    expect(caught).not.toBeInstanceOf(mod.AnalyticsUpstreamError);
  });
});

// DOGFOOD (2026-07-18) — credential whitespace normalization. Reproduced live:
// a CORRECT Deribit production key with a trailing space+newline on the secret
// makes the exchange return 13004 invalid_credentials → the user reads "my
// correct key is broken". validateKey/encryptKey now .trim() api_key/api_secret
// (the single chokepoint every key-entry route funnels through). These pin that
// the trimmed value is what actually hits the wire, so validate and encrypt
// normalise identically (stored ciphertext == validated credential).
describe("DOGFOOD credential trim — validateKey/encryptKey strip pasted whitespace", () => {
  afterEach(() => vi.restoreAllMocks());

  async function okFetch(json: Record<string, unknown>) {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(json), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.spyOn(globalThis, "fetch").mockImplementation(
      fetchMock as unknown as typeof globalThis.fetch,
    );
    return fetchMock;
  }

  function sentBody(fetchMock: ReturnType<typeof vi.fn>) {
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    return JSON.parse(init.body as string) as Record<string, unknown>;
  }

  it("validateKey trims a trailing space+newline off key and secret before the wire", async () => {
    const fetchMock = await okFetch({ valid: true, read_only: true });
    const mod = await import("./analytics-client");
    await mod.validateKey("deribit", "  GeSKFf5E ", "secret-value\n");
    const body = sentBody(fetchMock);
    expect(body.api_key).toBe("GeSKFf5E");
    expect(body.api_secret).toBe("secret-value");
  });

  it("encryptKey trims IDENTICALLY, so stored ciphertext == validated credential", async () => {
    const fetchMock = await okFetch({
      api_key_encrypted: "ct",
      api_secret_encrypted: null,
      passphrase_encrypted: null,
      dek_encrypted: "dek",
      nonce: null,
      kek_version: 1,
    });
    const mod = await import("./analytics-client");
    await mod.encryptKey("deribit", " GeSKFf5E\t", " secret-value ");
    const body = sentBody(fetchMock);
    expect(body.api_key).toBe("GeSKFf5E");
    expect(body.api_secret).toBe("secret-value");
  });

  it("does NOT trim the OKX passphrase (user-chosen, whitespace may be significant)", async () => {
    const fetchMock = await okFetch({ valid: true, read_only: true });
    const mod = await import("./analytics-client");
    await mod.validateKey("okx", " k ", " s ", " pass phrase ");
    const body = sentBody(fetchMock);
    expect(body.api_key).toBe("k");
    expect(body.passphrase).toBe(" pass phrase ");
  });
});
