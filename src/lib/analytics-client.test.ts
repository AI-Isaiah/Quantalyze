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
import { readFileSync } from "node:fs";
import { join } from "node:path";
// 140.3-05 / TS-35 — the REAL classifier, imported directly. Nothing between it
// and the real thrown error: that gap is where "the helper works but nothing
// calls it" hides.
import { classifyKeyValidationError } from "./wizardErrors";

vi.mock("server-only", () => ({}));

const headersGetMock = vi.fn<(name: string) => string | null>(() => null);
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => ({ get: headersGetMock })),
}));

const UUID_V4_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Phase 140.2-09 / TS-04 — every call through the REAL client now needs a
 * server-derived tenant identity AND an `INTERNAL_API_TOKEN`, because
 * `analyticsRequest` mints an `X-Tenant-Claim` and REFUSES rather than silently
 * emitting no header (which would leave the route on a platform-wide bucket).
 * These two constants keep that plumbing out of the assertions in suites whose
 * subject is something else entirely.
 */
const TENANT = { userId: "user-under-test" } as const;
const INTERNAL_TOKEN_FOR_TESTS = "internal-token-under-test";

describe("Phase 16 / OBSERV-01 correlation_id propagation", () => {
  beforeEach(() => {
    headersGetMock.mockReset();
    headersGetMock.mockImplementation(() => null);
    vi.resetModules();
    // 140.2-09 / TS-04: the mint reads INTERNAL_API_TOKEN at CALL time and
    // REFUSES on absence, so every call through the real client needs one.
    process.env.INTERNAL_API_TOKEN = INTERNAL_TOKEN_FOR_TESTS;
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
          // Phase 140 / SEAM-01: `budgetKey` is REQUIRED — it names the call
          // site's row in SEAM_BUDGETS, which now owns every deadline.
          options: {
            budgetKey: string;
            // 140.2-09 / TS-04: REQUIRED — every call site must name the
            // server-derived tenant the X-Tenant-Claim is minted over.
            tenantId: string;
            timeoutMs?: number;
            method?: string;
            correlationId?: string;
          },
        ) => Promise<unknown>;
      };
      const internal = mod as unknown as Internal;
      return internal.__INTERNAL_analyticsRequest("/test", { ping: 1 }, {
        budgetKey: "validate-key",
        tenantId: TENANT.userId,
        ...options,
      });
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
    // 140.2-09 / TS-04: the mint reads INTERNAL_API_TOKEN at CALL time and
    // REFUSES on absence, so every call through the real client needs one.
    process.env.INTERNAL_API_TOKEN = INTERNAL_TOKEN_FOR_TESTS;
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
        options: { budgetKey: string; tenantId: string },
      ) => Promise<unknown>;
    };
    return (mod as unknown as Internal).__INTERNAL_analyticsRequest(
      "/test",
      { ping: 1 },
      { budgetKey: "validate-key", tenantId: TENANT.userId },
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

/**
 * Phase 140.2 / SEAMCORE-02 — a body-read failure never escapes this module
 * untyped.
 *
 * The pre-fix shape: `AbortSignal.timeout` aborts the response STREAM, so for
 * the modal Railway degradation (headers fast, body slow) `fetch` RESOLVES and
 * the rejection happens later, inside `res.json()` — AFTER the transport catch
 * at the top of `analyticsRequest` has already been passed. The raw
 * `DOMException` therefore escaped to nine wrapper consumers, none of which has
 * an arm for it, and the breaker was never told.
 *
 * These cases pin the mapping onto the taxonomy that ALREADY existed. No new
 * error type reaches a wrapper; 140.3 owns the client-facing surface.
 */
describe("[SEAMCORE-02] analytics-client maps a body-read failure onto its own taxonomy", () => {
  beforeEach(() => {
    vi.resetModules();
    // 140.2-09 / TS-04: the mint reads INTERNAL_API_TOKEN at CALL time and
    // REFUSES on absence, so every call through the real client needs one.
    process.env.INTERNAL_API_TOKEN = INTERNAL_TOKEN_FOR_TESTS;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  /**
   * Headers resolve; the body then rejects. A bare object, because a real
   * `Response` cannot be constructed with a body that rejects.
   */
  function bodyRejectingFetch(rejection: unknown, status = 200) {
    return vi.fn().mockResolvedValue({
      ok: status < 400,
      status,
      statusText: "OK",
      headers: new Headers({ "content-type": "application/json" }),
      json: () => Promise.reject(rejection),
      text: () => Promise.reject(rejection),
    });
  }

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
        options: { budgetKey: string; tenantId: string },
      ) => Promise<unknown>;
    };
    return (mod as unknown as Internal).__INTERNAL_analyticsRequest(
      "/test",
      { ping: 1 },
      { budgetKey: "validate-key", tenantId: TENANT.userId },
    );
  }

  it("SUCCESS arm: a deadline mid-body throws AnalyticsTimeoutError, not a raw DOMException", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const mod = await import("./analytics-client");
    const caught = await callInternal(
      bodyRejectingFetch(new DOMException("aborted", "TimeoutError")),
    ).then(
      () => null,
      (e: unknown) => e,
    );

    expect(caught).toBeInstanceOf(mod.AnalyticsTimeoutError);
    expect(caught).not.toBeInstanceOf(DOMException);
    // The class the core throws must NOT be what a wrapper consumer sees.
    expect((caught as Error).name).toBe("AnalyticsTimeoutError");
  });

  it("SUCCESS arm: a non-deadline body failure maps onto the existing not-reachable Error", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const mod = await import("./analytics-client");
    const caught = await callInternal(
      bodyRejectingFetch(new TypeError("terminated")),
    ).then(
      () => null,
      (e: unknown) => e,
    );

    expect(caught).toBeInstanceOf(Error);
    expect(caught).not.toBeInstanceOf(mod.AnalyticsTimeoutError);
    expect(caught).not.toBeInstanceOf(mod.AnalyticsUpstreamError);
    expect((caught as Error).message).toMatch(/not reachable/i);
  });

  it("NON-OK arm: an abort is NOT converted into a fabricated { detail: statusText } body", async () => {
    // The swallow this replaces reported a dying Railway as a well-formed
    // upstream error carrying the status line's own text — indistinguishable,
    // downstream, from the service answering properly.
    vi.spyOn(console, "error").mockImplementation(() => {});
    const mod = await import("./analytics-client");
    const caught = await callInternal(
      bodyRejectingFetch(new DOMException("aborted", "TimeoutError"), 503),
    ).then(
      () => null,
      (e: unknown) => e,
    );

    expect(caught).toBeInstanceOf(mod.AnalyticsTimeoutError);
    expect(caught).not.toBeInstanceOf(mod.AnalyticsUpstreamError);
  });

  it("NON-OK arm: a genuinely unparseable body KEEPS the fallback", async () => {
    // The negative control for the case above. Distinguishing the two is the
    // whole point: an empty or non-JSON body on a 503 is Railway REPLYING.
    const mod = await import("./analytics-client");
    const caught = await callInternal(
      vi.fn().mockResolvedValue(
        new Response("", {
          status: 503,
          statusText: "Service Unavailable",
          headers: { "content-type": "application/json" },
        }),
      ),
    ).then(
      () => null,
      (e: unknown) => e,
    );

    expect(caught).toBeInstanceOf(mod.AnalyticsUpstreamError);
    expect((caught as InstanceType<typeof mod.AnalyticsUpstreamError>).status).toBe(
      503,
    );
    expect((caught as Error).message).toBe("Service Unavailable");
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
  beforeEach(() => {
    // 140.2-09 / TS-04: the mint reads INTERNAL_API_TOKEN at CALL time and
    // REFUSES on absence, so every call through the real client needs one.
    process.env.INTERNAL_API_TOKEN = INTERNAL_TOKEN_FOR_TESTS;
  });
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
    await mod.validateKey("deribit", "  GeSKFf5E ", "secret-value\n", undefined, TENANT);
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
    await mod.encryptKey("deribit", " GeSKFf5E\t", " secret-value ", undefined, TENANT);
    const body = sentBody(fetchMock);
    expect(body.api_key).toBe("GeSKFf5E");
    expect(body.api_secret).toBe("secret-value");
  });

  it("does NOT trim the OKX passphrase (user-chosen, whitespace may be significant)", async () => {
    const fetchMock = await okFetch({ valid: true, read_only: true });
    const mod = await import("./analytics-client");
    await mod.validateKey("okx", " k ", " s ", " pass phrase ", TENANT);
    const body = sentBody(fetchMock);
    expect(body.api_key).toBe("k");
    expect(body.passphrase).toBe(" pass phrase ");
  });
});

/**
 * Phase 140 / SEAM-01 — analyticsRequest now delegates to the ONE resilience
 * core (`resilient-fetch.ts`). Three properties of the retrofit are pinned
 * here because each one is a silent-regression risk rather than a loud one:
 *
 *  1. BROADENED ABORT CHECK. The pre-140 catch tested `err instanceof
 *     DOMException && name === "TimeoutError"` only. A plain `Error` named
 *     "AbortError" — the shape a client-side abort and several Node/undici
 *     paths produce — fell through to the generic "not reachable" arm and was
 *     reported to the user as a dead service rather than a slow one. The
 *     pre-existing DOMException test at :385 pins the OLD half; this pins the
 *     NEW half. Both must hold.
 *  2. CIRCUIT-OPEN PASSTHROUGH. `CircuitOpenError` must reach the route
 *     handler UNWRAPPED. If the generic arm swallowed it, every breaker trip
 *     would surface as "Analytics service is not reachable" and the whole
 *     SEAM-04 envelope (503 + Retry-After) would be unreachable. Asserted by
 *     object IDENTITY (`toBe`), which is stronger than `instanceof` and immune
 *     to the post-`vi.resetModules()` class-duplication artifact documented in
 *     `resilient-fetch.test.ts`'s header.
 *  3. BUDGET RESOLUTION. With no explicit `timeoutMs`, the deadline reported in
 *     the `AnalyticsTimeoutError` message must come from `SEAM_BUDGETS[budgetKey]`
 *     — proof the call site's budget key is actually consulted rather than a
 *     resurrected local default.
 */
describe("Phase 140 / SEAM-01 — analyticsRequest delegates to the resilience core", () => {
  type Internal = {
    __INTERNAL_analyticsRequest: (
      path: string,
      body: Record<string, unknown> | null,
      options: {
        budgetKey: string;
        // 140.2-09 / TS-04: REQUIRED — see analytics-client's options doc.
        tenantId: string;
        timeoutMs?: number;
        method?: string;
        correlationId?: string;
      },
    ) => Promise<unknown>;
  };

  beforeEach(() => {
    vi.resetModules();
    // 140.2-09 / TS-04: the mint reads INTERNAL_API_TOKEN at CALL time and
    // REFUSES on absence, so every call through the real client needs one. Set
    // per-describe rather than globally, so the absence case stays observable.
    process.env.INTERNAL_API_TOKEN = INTERNAL_TOKEN_FOR_TESTS;
  });

  afterEach(() => {
    vi.doUnmock("./resilient-fetch");
    vi.restoreAllMocks();
    // CI runs Node 22 while local runs Node 25; a leaked fetch stub is this
    // repo's known CI-only failure mode.
    vi.unstubAllGlobals();
  });

  it("maps a plain Error named AbortError to AnalyticsTimeoutError (broadened check)", async () => {
    const abortErr = Object.assign(new Error("The operation was aborted."), {
      name: "AbortError",
    });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(abortErr));
    const mod = await import("./analytics-client");
    let caught: unknown;
    try {
      await (mod as unknown as Internal).__INTERNAL_analyticsRequest(
        "/test",
        { ping: 1 },
        { budgetKey: "bridge", tenantId: TENANT.userId },
      );
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(mod.AnalyticsTimeoutError);
    expect((caught as Error).message).not.toMatch(/not reachable/i);
  });

  it("reports the SEAM_BUDGETS deadline for the call site's budgetKey", async () => {
    const abortErr = Object.assign(new Error("aborted"), {
      name: "TimeoutError",
    });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(abortErr));
    const mod = await import("./analytics-client");
    const core = await import("./resilient-fetch");
    let caught: unknown;
    try {
      await (mod as unknown as Internal).__INTERNAL_analyticsRequest(
        "/test",
        { ping: 1 },
        { budgetKey: "bridge", tenantId: TENANT.userId },
      );
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(mod.AnalyticsTimeoutError);
    expect((caught as Error).message).toContain(
      String(core.SEAM_BUDGETS["bridge"].timeoutMs),
    );
  });

  it("lets CircuitOpenError from the core propagate UNWRAPPED", async () => {
    const { CircuitOpenError } = await import("./seam-errors");
    const tripped = new CircuitOpenError(30);
    // Deterministic failure if the module mock ever stops intercepting: no
    // real socket is opened, so this test can never depend on whatever is (or
    // isn't) listening on the default analytics port.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("fetch must not be reached")),
    );
    vi.doMock("./resilient-fetch", async () => {
      const actual =
        await vi.importActual<typeof import("./resilient-fetch")>(
          "./resilient-fetch",
        );
      return { ...actual, resilientFetch: vi.fn().mockRejectedValue(tripped) };
    });
    const mod = await import("./analytics-client");
    let caught: unknown;
    try {
      await (mod as unknown as Internal).__INTERNAL_analyticsRequest(
        "/test",
        { ping: 1 },
        { budgetKey: "validate-key", tenantId: TENANT.userId },
      );
    } catch (e) {
      caught = e;
    }
    // Identity, not instanceof: the error must arrive UNTOUCHED, and identity
    // cannot be satisfied by a re-wrapped look-alike.
    expect(caught).toBe(tripped);
  });

  it("ME-01: lets SeamConfigError propagate UNWRAPPED, and names it a CONFIG fault", async () => {
    // ⚠️ A NAMED CLASS WITH NO CONSUMER IS A COMMENT, NOT A MECHANISM.
    //
    // `SeamConfigError` exists "to separate" a fault on OUR side from a dead
    // upstream, and the BREAKER half of that separation works — the fault is
    // raised above the classification window and records nothing. But the
    // separation stopped at the core's boundary: no client and no route
    // branched on it, so it took arm 3 here and became
    // `NOT_REACHABLE_MESSAGE`. A malformed ANALYTICS_SERVICE_URL — our own
    // deployment typo — reached the user as "the analytics service is not
    // reachable" and pointed ops at Railway.
    //
    // `tenant-claim.ts` uses precisely this argument to justify a named class
    // ("a configuration fault on OUR side reported as a dead upstream is the
    // exact silent degradation these guards exist to prevent"), and
    // `TenantClaimError` IS handled at both call sites. This closes the same
    // gap for its sibling.
    const { SeamConfigError } = await import("./resilient-fetch");
    const configFault = new SeamConfigError(
      "[resilient-fetch] ANALYTICS_SERVICE_URL is not a usable base URL",
    );
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("fetch must not be reached")),
    );
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.doMock("./resilient-fetch", async () => {
      const actual =
        await vi.importActual<typeof import("./resilient-fetch")>(
          "./resilient-fetch",
        );
      return {
        ...actual,
        resilientFetch: vi.fn().mockRejectedValue(configFault),
      };
    });
    const mod = await import("./analytics-client");
    let caught: unknown;
    try {
      await (mod as unknown as Internal).__INTERNAL_analyticsRequest(
        "/test",
        { ping: 1 },
        { budgetKey: "validate-key", tenantId: TENANT.userId },
      );
    } catch (e) {
      caught = e;
    }
    // Identity, not instanceof: a re-wrapped look-alike is exactly the defect.
    expect(caught).toBe(configFault);
    expect((caught as Error).message).not.toMatch(/not reachable/i);
    const logged = errorSpy.mock.calls.map((a) => String(a[0])).join("\n");
    expect(logged).toContain("CONFIG fault");
    expect(logged).toContain("not an upstream failure");
    errorSpy.mockRestore();
  });

  it("still maps a generic network throw to the 'not reachable' Error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("network down")),
    );
    const mod = await import("./analytics-client");
    let caught: unknown;
    try {
      await (mod as unknown as Internal).__INTERNAL_analyticsRequest(
        "/test",
        { ping: 1 },
        { budgetKey: "validate-key", tenantId: TENANT.userId },
      );
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(caught).not.toBeInstanceOf(mod.AnalyticsTimeoutError);
    expect((caught as Error).message).toMatch(/not reachable/i);
  });
});

/**
 * Phase 140.2-09 / TS-04 / ROADMAP SC7 — `analytics-client` mints
 * `X-Tenant-Claim`.
 *
 * WHAT ACTUALLY CHANGES IN PRODUCTION. `tenant_or_platform_key` in
 * `analytics-service/services/rate_limit.py` returns `<scope>:t:<payload>` the
 * instant an HMAC-verified claim appears and `platform:<path>` when it does not.
 * Until this landed, every route this client reaches sat in a platform-wide
 * bucket — the sharpest being `/api/optimize-weights` at 20/minute FOR THE WHOLE
 * PLATFORM, so two allocators running Scenario Composer could 429 each other.
 *
 * ⚠️ SIX of the nine rekeyed Python routes are reachable from this client, not
 * nine (five live + one dead wrapper); `/api/fetch-trades`, `/api/csv/validate`
 * and `/api/verify-strategy` are unreachable from here by construction. All NINE
 * wrappers mint regardless — three of them reach routes with no limiter or an
 * IP-keyed one, where the claim is inert, harmless and forward-compatible.
 * Minting from eight of nine is the instance-not-class defect this programme
 * exists to close.
 *
 * ORACLE DISCIPLINE. `expect(headers["X-Tenant-Claim"]).toBeDefined()` is
 * self-referential-adjacent and would ship green against a mint that returns a
 * constant, or one keyed on the wrong secret. Every MAC below is recomputed HERE
 * with `node:crypto`.
 */
describe("[140.2-09 / TS-04 / SC7] analytics-client mints X-Tenant-Claim", () => {
  const SERVICE_KEY = "svc-key-under-test";
  const INTERNAL_TOKEN = "internal-token-under-test";
  const ORIGINAL_ENV = { ...process.env };

  /** The independent oracle — same algorithm, written out by hand. */
  async function hmacHex(secret: string, message: string): Promise<string> {
    const { createHmac } = await import("node:crypto");
    return createHmac("sha256", secret).update(message).digest("hex");
  }

  beforeEach(() => {
    // ⚠️ ORDERING. `SERVICE_KEY` is captured at MODULE SCOPE in
    // `analytics-client.ts`, so the env must be set BEFORE the dynamic import
    // below or `X-Service-Key` silently vanishes and the "still emitted"
    // assertion becomes a tautology. `INTERNAL_API_TOKEN` is deliberately NOT
    // captured at module scope — it is read at CALL time, precisely so this
    // hazard cannot repeat for the secret that selects the rate-limit bucket.
    vi.resetModules();
    process.env.ANALYTICS_SERVICE_KEY = SERVICE_KEY;
    process.env.INTERNAL_API_TOKEN = INTERNAL_TOKEN;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  /**
   * Drive one wrapper and hand back the headers the transport received.
   *
   * The wrapper's RESPONSE handling is out of scope: one stub body satisfies no
   * Zod response schema, so most wrappers reject in `parseResponse` — strictly
   * AFTER the header assembly this block pins. Absorbing that rejection is not a
   * silent skip; the caller asserts on headers that only exist if `fetch` was
   * actually reached.
   */
  async function sentHeaders(
    invoke: (m: typeof import("./analytics-client")) => Promise<unknown>,
  ): Promise<Record<string, string>> {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const mod = await import("./analytics-client");
    await invoke(mod).then(
      () => undefined,
      () => undefined,
    );
    expect(
      fetchMock,
      "the wrapper never reached the transport — it threw before the fetch",
    ).toHaveBeenCalledTimes(1);
    return (fetchMock.mock.calls[0][1] as RequestInit).headers as Record<
      string,
      string
    >;
  }

  type AnalyticsClient = typeof import("./analytics-client");

  /**
   * The roster. HAND-TYPED, not derived from the module's exports — a roster
   * built by reflecting over `Object.keys(mod)` grows silently and can never
   * notice a wrapper that was added without an identity.
   *
   * `reaches` records what the claim actually BUYS on each route, so a later
   * reader does not "optimise away" the three inert ones.
   */
  const MINT_ROSTER: ReadonlyArray<{
    wrapper: string;
    payload: string;
    reaches: string;
    invoke: (m: AnalyticsClient) => Promise<unknown>;
  }> = [
    {
      wrapper: "validateKey",
      payload: "user-alpha",
      reaches: "L-1 /api/validate-key — LIVE, flips (key-connect spends two tokens per attempt)",
      invoke: (m) =>
        m.validateKey("deribit", "k", "s", undefined, { userId: "user-alpha" }),
    },
    {
      wrapper: "encryptKey",
      payload: "user-alpha",
      reaches: "L-2 /api/encrypt-key — LIVE, flips (the second of the two)",
      invoke: (m) =>
        m.encryptKey("deribit", "k", "s", undefined, { userId: "user-alpha" }),
    },
    {
      wrapper: "optimizeScenarioWeights",
      payload: "user-beta",
      reaches: "L-4 /api/optimize-weights — LIVE, flips; the SHARPEST at 20/minute",
      invoke: (m) =>
        m.optimizeScenarioWeights({}, "min_vol", { userId: "user-beta" }),
    },
    {
      wrapper: "computePortfolioAnalytics",
      payload: "actor-1",
      reaches: "L-6 /api/portfolio-analytics — reachable but ZERO production callers; flips a dead path",
      invoke: (m) => m.computePortfolioAnalytics("portfolio-1", "actor-1"),
    },
    {
      wrapper: "runPortfolioOptimizer",
      payload: "actor-1",
      reaches: "L-7 /api/portfolio-optimizer — LIVE, flips",
      invoke: (m) => m.runPortfolioOptimizer("portfolio-1", "actor-1"),
    },
    {
      wrapper: "findReplacementCandidates",
      payload: "user-1",
      reaches: "L-8 /api/portfolio-bridge — LIVE, flips",
      invoke: (m) =>
        m.findReplacementCandidates("portfolio-1", "strategy-1", "user-1"),
    },
    {
      wrapper: "simulateAddCandidate",
      payload: "user-1",
      reaches: "/api/simulator — the TENTH, still IP-keyed (TS-30, quarantined). INERT but harmless",
      invoke: (m) =>
        m.simulateAddCandidate("portfolio-1", "candidate-1", "user-1"),
    },
    {
      wrapper: "recomputeMatch",
      payload: "actor-1",
      reaches: "/api/match/recompute — NO Python limiter at all (TS-21, owned by 146). INERT but harmless",
      invoke: (m) => m.recomputeMatch("allocator-1", false, "actor-1"),
    },
    {
      wrapper: "evalMatch",
      payload: "admin-1",
      reaches: "/api/match/eval — NO Python limiter at all (TS-21). INERT but harmless",
      invoke: (m) =>
        m.evalMatch({ lookback_days: "30" }, { userId: "admin-1" }),
    },
  ];

  it("the roster covers every wrapper, so a new one cannot be added without an identity", () => {
    // 9 is hand-typed. If a tenth wrapper appears, this reddens and the author
    // has to decide what its tenant payload is rather than defaulting to none.
    expect(MINT_ROSTER).toHaveLength(9);
  });

  it.each(MINT_ROSTER)(
    "$wrapper mints a claim over $payload — $reaches",
    async ({ payload, invoke }) => {
      const headers = await sentHeaders(invoke);
      const claim = headers["X-Tenant-Claim"];
      expect(claim).toBeDefined();

      // rsplit-compatible: the Python verifier splits on the LAST two dots.
      const parts = claim.split(".");
      expect(parts).toHaveLength(3);
      const [sentPayload, exp, mac] = parts;

      expect(sentPayload).toBe(payload);
      // The MAC, recomputed here. This is what makes the assertion mean
      // "the Python verifier will accept this" rather than "a string is set".
      expect(mac).toBe(await hmacHex(INTERNAL_TOKEN, `${sentPayload}.${exp}`));
      // The secret keys the MAC; it never rides the wire.
      expect(claim).not.toContain(INTERNAL_TOKEN);
      // 512 is `_CLAIM_MAX_CHARS` — a longer claim is dropped WHOLESALE and the
      // caller falls back to the platform bucket with no signal.
      expect(claim.length).toBeLessThanOrEqual(512);
    },
  );

  it("the MAC key is INTERNAL_API_TOKEN, NOT ANALYTICS_SERVICE_KEY", async () => {
    // The mistake the obligation ledger's one-line description invites. Both
    // secrets are in scope in this module and both produce a syntactically
    // perfect claim; only the MAC tells them apart, and the wrong one fails
    // `compare_digest` SILENTLY — every route stays on `platform:<path>`.
    const headers = await sentHeaders((m) =>
      m.runPortfolioOptimizer("portfolio-1", "actor-1"),
    );
    const [payload, exp, mac] = headers["X-Tenant-Claim"].split(".");

    expect(mac).toBe(await hmacHex(INTERNAL_TOKEN, `${payload}.${exp}`));
    expect(mac).not.toBe(await hmacHex(SERVICE_KEY, `${payload}.${exp}`));
  });

  it("every pre-existing header still rides — a dropped X-Service-Key is a total outage", async () => {
    const headers = await sentHeaders((m) =>
      m.runPortfolioOptimizer("portfolio-1", "actor-1"),
    );

    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers["X-Api-Version"]).toBe("1");
    expect(headers["X-Correlation-Id"]).toBeDefined();
    expect(headers["X-Service-Key"]).toBe(SERVICE_KEY);
  });

  it("does NOT add X-User-Id — unsigned client input must never select a bucket", async () => {
    // `verify_tenant_claim` exists precisely because `X-User-Id` is forgeable.
    // Adding it here would invite a future reader to bucket on it.
    const headers = await sentHeaders((m) =>
      m.runPortfolioOptimizer("portfolio-1", "actor-1"),
    );
    expect(headers["X-User-Id"]).toBeUndefined();
  });

  it("FAILS LOUD when INTERNAL_API_TOKEN is absent — never a silent platform bucket", async () => {
    // RESEARCH assumption A3: it could NOT be confirmed that
    // INTERNAL_API_TOKEN is present in the Vercel production env. An empty
    // secret still produces a syntactically valid claim that fails
    // `compare_digest`, so silence here means SC7 no-ops in production while
    // every test stays green. The failure must be visible.
    delete process.env.INTERNAL_API_TOKEN;

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const mod = await import("./analytics-client");

    let caught: unknown;
    try {
      await mod.runPortfolioOptimizer("portfolio-1", "actor-1");
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).name).toBe("TenantClaimError");
    expect((caught as Error).message).toContain("INTERNAL_API_TOKEN");
    // No request may leave. Spending upstream capacity on a call we cannot
    // honestly attribute is the platform-bucket regression itself.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not misreport a mint refusal as a dead upstream", async () => {
    // The mint sits OUTSIDE the transport `try`. Inline in the headers object it
    // would land in the classification window and surface as "Analytics service
    // is not reachable" / AnalyticsTimeoutError — a configuration fault wearing
    // a dying-Railway costume, which is exactly the silent degradation the
    // fail-loud guard exists to prevent.
    delete process.env.INTERNAL_API_TOKEN;
    vi.stubGlobal("fetch", vi.fn());
    const mod = await import("./analytics-client");

    let caught: unknown;
    try {
      await mod.runPortfolioOptimizer("portfolio-1", "actor-1");
    } catch (e) {
      caught = e;
    }
    expect(caught).not.toBeInstanceOf(mod.AnalyticsTimeoutError);
    expect((caught as Error).message).not.toMatch(/not reachable/i);
  });

  it("REFUSES an empty tenant payload rather than bucketing every caller together", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const mod = await import("./analytics-client");

    let caught: unknown;
    try {
      await mod.validateKey("deribit", "k", "s", undefined, { userId: "" });
    } catch (e) {
      caught = e;
    }
    expect((caught as Error).name).toBe("TenantClaimError");
  });

  /**
   * ROADMAP SC7's own test clause: *"a test must prove a request from tenant A
   * cannot consume tenant B's allowance"*.
   *
   * ⚠️ THIS IS NOT `expect(header).toBeDefined()`. That assertion is green
   * against a mint that returns a constant, against a mint keyed on the wrong
   * secret, and against a mint over an empty payload — the last of which is
   * 140.1's mutation #3 shape, which shipped GREEN against an identity
   * assertion. What follows drives the SAME wrapper twice with two different
   * server-derived identities and then reproduces the BUCKET DECISION the Python
   * limiter makes, with the verifier's semantics written out by hand here.
   */
  describe("SC7 — tenant A cannot consume tenant B's allowance", () => {
    /**
     * A hand-written mirror of `analytics-service/services/rate_limit.py`:
     * `verify_tenant_claim` + `tenant_or_platform_key`, transcribed from the
     * Python source, NOT imported from anywhere on the TS side.
     *
     * That transcription is the whole point. Asserting "two claim strings
     * differ" would pass for two claims that BOTH fail `compare_digest` and
     * therefore BOTH land in the same `platform:<path>` bucket — which is
     * exactly the regression being tested for. The only honest oracle is the
     * decision the other side actually makes.
     */
    async function pythonBucketKey(
      claim: string | undefined,
      scope: string,
      routePath: string,
      secret: string | undefined,
    ): Promise<string> {
      const { createHmac, timingSafeEqual } = await import("node:crypto");
      const platform = `platform:${routePath}`;
      // `if not raw or len(raw) > _CLAIM_MAX_CHARS: return None`
      if (!claim || claim.length > 512) return platform;
      if (!secret) return platform;
      // `payload, exp_raw, provided_mac = raw.rsplit(".", 2)`
      const idx2 = claim.lastIndexOf(".");
      const idx1 = claim.lastIndexOf(".", idx2 - 1);
      if (idx1 <= 0 || idx2 <= idx1) return platform;
      const payload = claim.slice(0, idx1);
      const expRaw = claim.slice(idx1 + 1, idx2);
      const providedMac = claim.slice(idx2 + 1);
      // `if not payload: return None`
      if (!payload) return platform;
      // `if int(exp_raw) < int(time.time()): return None`
      if (Number(expRaw) < Math.floor(Date.now() / 1000)) return platform;
      const expected = createHmac("sha256", secret)
        .update(`${payload}.${expRaw}`)
        .digest("hex");
      // `hmac.compare_digest(provided_mac, expected_mac)`
      if (
        providedMac.length !== expected.length ||
        !timingSafeEqual(Buffer.from(providedMac), Buffer.from(expected))
      ) {
        return platform;
      }
      // `if payload == ANON_PAYLOAD: return f"{scope}:anon"`
      if (payload === "public") return `${scope}:anon`;
      return `${scope}:t:${payload}`;
    }

    it("two different tenants land in two DIFFERENT per-tenant buckets on /api/optimize-weights", async () => {
      // The sharpest of the five live flips: 20/minute, a PLATFORM ceiling
      // before this landed, so two allocators running Scenario Composer
      // concurrently could 429 each other.
      const headersA = await sentHeaders((m) =>
        m.optimizeScenarioWeights({}, "min_vol", { userId: "tenant-a" }),
      );
      const headersB = await sentHeaders((m) =>
        m.optimizeScenarioWeights({}, "min_vol", { userId: "tenant-b" }),
      );

      const claimA = headersA["X-Tenant-Claim"];
      const claimB = headersB["X-Tenant-Claim"];
      expect(claimA).not.toBe(claimB);

      const bucketA = await pythonBucketKey(
        claimA,
        "optimize_weights",
        "/api/optimize-weights",
        INTERNAL_TOKEN,
      );
      const bucketB = await pythonBucketKey(
        claimB,
        "optimize_weights",
        "/api/optimize-weights",
        INTERNAL_TOKEN,
      );

      // Hand-typed expectations, not derived from the claims.
      expect(bucketA).toBe("optimize_weights:t:tenant-a");
      expect(bucketB).toBe("optimize_weights:t:tenant-b");
      expect(bucketA).not.toBe(bucketB);
      // The regression this replaces: BOTH used to be this single string, and
      // still would be if the MAC failed for any reason.
      expect(bucketA).not.toBe("platform:/api/optimize-weights");
      expect(bucketB).not.toBe("platform:/api/optimize-weights");
    });

    it("tenant A's claim does NOT verify as tenant B — the payload is bound by the MAC", async () => {
      const headersA = await sentHeaders((m) =>
        m.optimizeScenarioWeights({}, "min_vol", { userId: "tenant-a" }),
      );
      const [, exp, macA] = headersA["X-Tenant-Claim"].split(".");

      // Splice tenant-b's payload onto tenant-a's MAC — the forgery a caller
      // holding a captured claim would attempt in order to spend B's window.
      const forged = `tenant-b.${exp}.${macA}`;
      const bucket = await pythonBucketKey(
        forged,
        "optimize_weights",
        "/api/optimize-weights",
        INTERNAL_TOKEN,
      );

      // It falls back to the platform bucket. It does NOT become
      // `optimize_weights:t:tenant-b`, which is what "A consuming B's
      // allowance" would actually look like.
      expect(bucket).toBe("platform:/api/optimize-weights");
      expect(bucket).not.toBe("optimize_weights:t:tenant-b");
    });

    it("each of the five LIVE routes buckets per tenant, not one of them", async () => {
      // Hand-typed roster of the five LIVE flips and their Python scopes, read
      // off the `partial(tenant_or_platform_key, scope=…)` decorators. The dead
      // sixth (portfolio-analytics) is covered by the mint roster above.
      const LIVE: ReadonlyArray<{
        scope: string;
        path: string;
        invoke: (
          m: AnalyticsClient,
          userId: string,
        ) => Promise<unknown>;
      }> = [
        {
          scope: "validate_key",
          path: "/api/validate-key",
          invoke: (m, userId) =>
            m.validateKey("deribit", "k", "s", undefined, { userId }),
        },
        {
          scope: "encrypt_key",
          path: "/api/encrypt-key",
          invoke: (m, userId) =>
            m.encryptKey("deribit", "k", "s", undefined, { userId }),
        },
        {
          scope: "optimize_weights",
          path: "/api/optimize-weights",
          invoke: (m, userId) =>
            m.optimizeScenarioWeights({}, "min_vol", { userId }),
        },
        {
          scope: "portfolio_optimizer",
          path: "/api/portfolio-optimizer",
          invoke: (m, userId) => m.runPortfolioOptimizer("portfolio-1", userId),
        },
        {
          scope: "portfolio_bridge",
          path: "/api/portfolio-bridge",
          invoke: (m, userId) =>
            m.findReplacementCandidates("portfolio-1", "strategy-1", userId),
        },
      ];
      expect(LIVE).toHaveLength(5);

      for (const { scope, path, invoke } of LIVE) {
        const a = await sentHeaders((m) => invoke(m, "tenant-a"));
        const b = await sentHeaders((m) => invoke(m, "tenant-b"));
        expect(
          await pythonBucketKey(a["X-Tenant-Claim"], scope, path, INTERNAL_TOKEN),
          `${path} did not bucket tenant-a per tenant`,
        ).toBe(`${scope}:t:tenant-a`);
        expect(
          await pythonBucketKey(b["X-Tenant-Claim"], scope, path, INTERNAL_TOKEN),
          `${path} did not bucket tenant-b per tenant`,
        ).toBe(`${scope}:t:tenant-b`);
      }
    });

    it("a claim minted with the WRONG secret degrades to the platform bucket (why M44 must redden)", async () => {
      const headers = await sentHeaders((m) =>
        m.optimizeScenarioWeights({}, "min_vol", { userId: "tenant-a" }),
      );
      // The verifier holds INTERNAL_API_TOKEN. Verifying against the OTHER
      // secret in scope in this module is what swapping the MAC key would do in
      // production — and note the failure is SILENT on the Python side: no
      // error, no warning, just a platform-wide bucket.
      expect(
        await pythonBucketKey(
          headers["X-Tenant-Claim"],
          "optimize_weights",
          "/api/optimize-weights",
          SERVICE_KEY,
        ),
      ).toBe("platform:/api/optimize-weights");
    });

    it("an EXPIRED claim degrades to the platform bucket rather than granting a permanent window", async () => {
      // The TTL is what stops a claim captured from a log or a proxy being a
      // permanent key to that tenant's allowance.
      const stale = "tenant-a.1000000000.".concat("0".repeat(64));
      expect(
        await pythonBucketKey(
          stale,
          "optimize_weights",
          "/api/optimize-weights",
          INTERNAL_TOKEN,
        ),
      ).toBe("platform:/api/optimize-weights");
    });
  });

  /**
   * The committed cross-language case table, read at the WIRE level.
   *
   * `tenant-claim.test.ts` binds the mint to these bytes; this binds the
   * CLIENT to them, so a claim that stopped riding the header, or started
   * riding it in a different shape, reddens against the same file a future
   * pytest reader will consume.
   */
  describe("SC7 — the wire header matches the committed parity fixture", () => {
    it.each(
      (
        JSON.parse(
          readFileSync(
            join(process.cwd(), "tests/fixtures/tenant-claim-parity.json"),
            "utf8",
          ),
        ) as {
          cases: Array<{ name: string; payload: string; secret: string; exp: number }>;
        }
      ).cases,
    )(
      "fixture case $name rides X-Tenant-Claim byte-for-byte",
      async ({ payload, secret, exp }) => {
        process.env.INTERNAL_API_TOKEN = secret;
        vi.useFakeTimers();
        // now = exp - TTL(300, hand-typed), so the mint lands on the fixture exp.
        vi.setSystemTime(new Date((exp - 300) * 1000));
        try {
          const headers = await sentHeaders((m) =>
            m.optimizeScenarioWeights({}, "min_vol", { userId: payload }),
          );
          const [sentPayload, sentExp, mac] =
            headers["X-Tenant-Claim"].split(".");
          expect(sentPayload).toBe(payload);
          expect(Number(sentExp)).toBe(exp);
          expect(mac).toBe(await hmacHex(secret, `${payload}.${exp}`));
        } finally {
          vi.useRealTimers();
        }
      },
    );
  });
});

/**
 * Phase 140.2-11 / SEAMCORE-11 (A-27) — ONE defined outcome for an ambiguous
 * transport, and the SAME one `process-key-client.test.ts` pins.
 *
 * THE DEFECT THIS CLOSES, in two halves.
 *
 *   1. NON-JSON 2xx. A Railway edge or maintenance page served as
 *      `200 text/html` produced the string "Analytics service returned an
 *      unexpected response. Is it running on the correct port?" — a local-dev
 *      message, sent to an operator during a production incident, telling them
 *      to go and check a port on their laptop.
 *
 *   2. NULL-BODY STATUSES. 204, 205 and 304 carry no body at all. Verified by
 *      execution on Node v25.8.1: `Response.json(body, { status: 204|205|304 })`
 *      throws `TypeError: Response constructor: Invalid response status code`.
 *      That is WHATWG-spec behaviour, not a runtime quirk, so CI's Node 22
 *      agrees. Before this plan the three statuses got THREE different answers
 *      inside this one file — 204 and 205 are `ok` and fell through to the
 *      local-dev message, while 304 is not `ok` and became an
 *      `AnalyticsUpstreamError` carrying status 304, which every route that
 *      forwards an upstream status verbatim would then have handed to its own
 *      `NextResponse.json(...)` and crashed on.
 *
 * ORACLE DISCIPLINE. The expected message is typed out HERE, in full, per case.
 * A `not.toContain("port")` assertion would redden under mutation M50 too, and
 * would still let a third, different message ship green — which is the whole
 * failure mode "one defined outcome" names. Equality is the point.
 */
describe("[SEAMCORE-11 / A-27] analytics-client: ONE defined outcome for an ambiguous transport", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.INTERNAL_API_TOKEN = INTERNAL_TOKEN_FOR_TESTS;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function callInternal(fetchMock: ReturnType<typeof vi.fn>) {
    vi.spyOn(globalThis, "fetch").mockImplementation(
      fetchMock as unknown as typeof globalThis.fetch,
    );
    const mod = await import("./analytics-client");
    type Internal = {
      __INTERNAL_analyticsRequest: (
        path: string,
        body: Record<string, unknown> | null,
        options: { budgetKey: string; tenantId: string },
      ) => Promise<unknown>;
    };
    return {
      mod,
      call: () =>
        (mod as unknown as Internal).__INTERNAL_analyticsRequest(
          "/test",
          { ping: 1 },
          { budgetKey: "validate-key", tenantId: TENANT.userId },
        ),
    };
  }

  async function caughtFrom(fetchMock: ReturnType<typeof vi.fn>) {
    const { mod, call } = await callInternal(fetchMock);
    let caught: unknown;
    try {
      await call();
    } catch (e) {
      caught = e;
    }
    return { mod, caught };
  }

  it("a 200 text/html maintenance page names the SEAM, not a local dev port", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("<html><body>Application failed to respond</body></html>", {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      }),
    );

    const { mod, caught } = await caughtFrom(fetchMock);

    expect(caught).toBeInstanceOf(mod.AnalyticsUpstreamError);
    expect(
      (caught as Error).message,
      "The non-JSON-2xx message drifted. It is the one an operator reads " +
        "during a Railway edge incident, and its predecessor sent them to " +
        "check a port on their laptop. It must also stay byte-identical to " +
        "the one process-key-client logs, or 'one defined outcome' is two.",
    ).toBe(
      "Analytics seam returned an unusable response (HTTP 200, content-type text/html). The upstream did not answer with the JSON contract.",
    );
    // The routable status is 502, NOT the observed 200: `.status` is
    // contractually the code route handlers forward, and forwarding 200 would
    // ship an error payload under a success code.
    expect(
      (caught as InstanceType<typeof mod.AnalyticsUpstreamError>).status,
    ).toBe(502);
  });

  it("a 204 resolves to that same outcome (it is `ok`, and it has no body)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 204 }));

    const { mod, caught } = await caughtFrom(fetchMock);

    expect(caught).toBeInstanceOf(mod.AnalyticsUpstreamError);
    expect((caught as Error).message).toBe(
      "Analytics seam returned an unusable response (HTTP 204, content-type absent). The upstream did not answer with the JSON contract.",
    );
    expect(
      (caught as InstanceType<typeof mod.AnalyticsUpstreamError>).status,
    ).toBe(502);
  });

  it("a 205 resolves to that same outcome", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 205 }));

    const { mod, caught } = await caughtFrom(fetchMock);

    expect(caught).toBeInstanceOf(mod.AnalyticsUpstreamError);
    expect((caught as Error).message).toBe(
      "Analytics seam returned an unusable response (HTTP 205, content-type absent). The upstream did not answer with the JSON contract.",
    );
    expect(
      (caught as InstanceType<typeof mod.AnalyticsUpstreamError>).status,
    ).toBe(502);
  });

  it("a 304 resolves to that same outcome, and never carries 304 as a forwardable status", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 304 }));

    const { mod, caught } = await caughtFrom(fetchMock);

    expect(caught).toBeInstanceOf(mod.AnalyticsUpstreamError);
    expect((caught as Error).message).toBe(
      "Analytics seam returned an unusable response (HTTP 304, content-type absent). The upstream did not answer with the JSON contract.",
    );
    // THE crash prevention. 304 is not `ok`, so before this plan it became an
    // AnalyticsUpstreamError carrying status 304 — and every route that
    // forwards `err.status` into its own JSON response constructor throws on
    // it, verified on Node this session.
    const status = (caught as InstanceType<typeof mod.AnalyticsUpstreamError>)
      .status;
    expect(status).toBe(502);
    expect(() => Response.json({ error: "x" }, { status })).not.toThrow();
  });

  /**
   * ORACLE HARDENING, found by running mutation M49 against the sibling client
   * (2026-07-27).
   *
   * Deleting the null-body-status clause left the 204/205 cases green there,
   * because a null-body response carries no content-type and the non-JSON-2xx
   * clause caught them by accident. The same redundancy exists here. A null-body
   * status that DOES advertise `application/json` — a proxy or a hand-rolled
   * handler will — has only the status clause standing between it and the old
   * behaviour: for a 204 an unclassified `SyntaxError` out of the success arm,
   * for a 304 an `AnalyticsUpstreamError` carrying 304 as a FORWARDABLE status,
   * i.e. the route crash moved one hop downstream.
   *
   * These pin the load-bearing claim of the implementation comment: the three
   * statuses are decided on the STATUS, not on the content-type.
   */
  it.each([204, 205, 304])(
    "a %i is decided on the STATUS even when it advertises application/json",
    async (status) => {
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(null, {
          status,
          headers: { "content-type": "application/json" },
        }),
      );

      const { mod, caught } = await caughtFrom(fetchMock);

      expect(caught).toBeInstanceOf(mod.AnalyticsUpstreamError);
      expect((caught as Error).message).toBe(
        `Analytics seam returned an unusable response (HTTP ${status}, content-type application/json). The upstream did not answer with the JSON contract.`,
      );
      expect(
        (caught as InstanceType<typeof mod.AnalyticsUpstreamError>).status,
      ).toBe(502);
    },
  );

  it("NEGATIVE CONTROL: a JSON 2xx is byte-unchanged", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ valid: true, detail: "fine" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const { call } = await callInternal(fetchMock);
    await expect(call()).resolves.toEqual({ valid: true, detail: "fine" });
  });

  it("NEGATIVE CONTROL: a non-JSON NON-2xx still forwards its own status and body", async () => {
    // The `!ok` text/plain fork is untouched by this plan: a 500 has a body and
    // a status that is safe to forward, so it is not ambiguous.
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("Internal Server Error trace...", {
        status: 500,
        headers: { "content-type": "text/plain" },
      }),
    );
    const { mod, caught } = await caughtFrom(fetchMock);
    expect(caught).toBeInstanceOf(mod.AnalyticsUpstreamError);
    expect((caught as Error).message).toBe("Internal Server Error trace...");
    expect(
      (caught as InstanceType<typeof mod.AnalyticsUpstreamError>).status,
    ).toBe(500);
  });

  /**
   * The anti-drift guard for "ONE defined outcome ... identical across both
   * clients".
   *
   * The two clients cannot import the builder from each other: sixteen route
   * test files replace one or the other wholesale with a full factory, so a
   * cross-client import evaluates to `undefined` under those mocks (the same
   * argument that homes `CircuitOpenError` in the dependency-free leaf). And it
   * cannot live in that leaf either — the leaf's exported surface is pinned to
   * a two-member hand-typed set in `seam-errors.purity.test.ts`, and this plan
   * adds no member to it. So the builder is duplicated, and the duplication is
   * guarded HERE rather than trusted.
   *
   * GREP-GATE HYGIENE: comments are stripped BEFORE matching. Both files
   * necessarily discuss this message in prose, and prose satisfying the guard
   * is a failure mode this phase has now hit seven times, once inside a
   * self-check.
   */
  it("the message builder is byte-identical in BOTH clients (drift guard)", () => {
    function stripComments(src: string): string {
      return src
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .split("\n")
        .filter((line) => !line.trim().startsWith("//"))
        .join("\n");
    }

    // Hand-typed here, never read back out of either module it guards.
    const EXPECTED_RETURN_LINE =
      "return `Analytics seam returned an unusable response (HTTP ${status}, content-type ${mediaType}). The upstream did not answer with the JSON contract.`;";

    for (const file of [
      "src/lib/analytics-client.ts",
      "src/lib/process-key-client.ts",
    ]) {
      const code = stripComments(
        readFileSync(join(process.cwd(), file), "utf8"),
      );
      expect(
        code.split("\n").some((line) => line.trim() === EXPECTED_RETURN_LINE),
        `${file} no longer builds the SEAMCORE-11 outcome message from the ` +
          `agreed template. The two clients duplicate this builder because ` +
          `neither may import from the other (wholesale route mocks) and the ` +
          `error leaf's export set is pinned — so the duplication is guarded ` +
          `here. If the message must change, it changes in BOTH files and in ` +
          `the hand-typed expectations in BOTH client test files, in one commit.`,
      ).toBe(true);
    }
  });
});

/**
 * [140.3-01 / TS-05 + TS-08] Class-5 member 1 of 3 — `analytics-client.ts`.
 *
 * ONE LINE, TWO WIRE CONTRACTS. `STATUS_CONTRACT.md` §2 and §2.1:
 *
 *   · a deliberate 4xx/5xx from `service_error()` nests the whole envelope at
 *     `body.detail` — `{code, dependency, retryable, detail}` — so the
 *     pre-plan `error.detail ?? "…"` read handed an OBJECT to `new
 *     AnalyticsUpstreamError(message, status)`, which coerced it to the string
 *     `"[object Object]"`. That is obligation O-5, recorded as a known and
 *     deliberate consequence of the Python change;
 *   · the two APP-GLOBAL handlers (`RequestValidationError` 422 and
 *     `RateLimitExceeded` 429) emit a SCALAR top-level `detail` and put the
 *     machine code at `body.code`. That path was already CORRECT, and TS-07 is
 *     an explicitly NEGATIVE obligation: it must not be "fixed".
 *
 * ⚠️ TS-08 exists because a verify that exercises ONE of those paths certifies
 * the wrong half. Both are driven here, per site, with HAND-TYPED bodies — no
 * shape is imported from the module under test.
 */
describe("[140.3-01 / TS-05] analytics-client reads the seam error body through the ONE discriminator", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.INTERNAL_API_TOKEN = INTERNAL_TOKEN_FOR_TESTS;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function caughtFrom(fetchMock: ReturnType<typeof vi.fn>) {
    vi.spyOn(globalThis, "fetch").mockImplementation(
      fetchMock as unknown as typeof globalThis.fetch,
    );
    const mod = await import("./analytics-client");
    type Internal = {
      __INTERNAL_analyticsRequest: (
        path: string,
        body: Record<string, unknown> | null,
        options: { budgetKey: string; tenantId: string },
      ) => Promise<unknown>;
    };
    let caught: unknown;
    try {
      await (mod as unknown as Internal).__INTERNAL_analyticsRequest(
        "/test",
        { ping: 1 },
        { budgetKey: "validate-key", tenantId: TENANT.userId },
      );
    } catch (e) {
      caught = e;
    }
    return { mod, caught };
  }

  it("CONTRACT A — a `service_error` 500 (OBJECT detail): the human string is `body.detail.detail`, never '[object Object]'", async () => {
    // Hand-typed §2 envelope. NOT imported from the module under test, and not
    // built by a helper that shares a shape with it.
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          detail: {
            code: "SEAM_DEGRADED",
            dependency: "supabase",
            retryable: true,
            detail: "The analytics store is not responding. Try again shortly.",
          },
        }),
        { status: 500, headers: { "content-type": "application/json" } },
      ),
    );

    const { mod, caught } = await caughtFrom(fetchMock);

    expect(caught).toBeInstanceOf(mod.AnalyticsUpstreamError);
    const err = caught as InstanceType<typeof mod.AnalyticsUpstreamError>;
    expect(err.status).toBe(500);
    expect(
      err.message,
      "The nested `service_error` envelope must be read through " +
        "`seamHumanMessage`. A bare `error.detail ??` read coerces the object " +
        "to '[object Object]', which then misses every branch of the wizard's " +
        "substring cascade and lands the user on UNKNOWN/500 — obligation O-5.",
    ).toBe("The analytics store is not responding. Try again shortly.");
    expect(err.message).not.toContain("[object Object]");
    // The MACHINE code must survive too — it is the discriminator the copy
    // plan and TS-35 key on, and reading only the human half would close TS-05
    // while leaving the code unreachable at the chokepoint.
    expect(err.seamCode).toBe("SEAM_DEGRADED");
  });

  it("CONTRACT B — an app-global 429 (SCALAR detail): the human string is BYTE-IDENTICAL to its pre-plan value (TS-07 is negative)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: false,
          code: "RATE_LIMITED",
          human_message: "Too many requests.",
          detail: "Too many requests. Try again in 60 seconds.",
          correlation_id: "cid-429-analytics-client",
          recoverable: true,
          retry_after_seconds: 60,
        }),
        { status: 429, headers: { "content-type": "application/json" } },
      ),
    );

    const { mod, caught } = await caughtFrom(fetchMock);

    expect(caught).toBeInstanceOf(mod.AnalyticsUpstreamError);
    const err = caught as InstanceType<typeof mod.AnalyticsUpstreamError>;
    expect(err.status).toBe(429);
    expect(
      err.message,
      "The flat app-global shape needed NO TypeScript change (TS-07 is an " +
        "explicitly NEGATIVE obligation). This literal is the pre-plan value; " +
        "if it moved, the 429 path was 'fixed' and the negative obligation was " +
        "violated.",
    ).toBe("Too many requests. Try again in 60 seconds.");
    // Flat shape: the code is at the TOP level, not under `detail`.
    expect(err.seamCode).toBe("RATE_LIMITED");
  });

  it("a body with no `detail` at all still falls back to the pre-plan static copy", async () => {
    // The fallback is load-bearing: `seamHumanMessage` returns null for a body
    // carrying no readable human string, and the `??` must still answer the
    // same sentence it always did rather than `null`.
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ unexpected: "shape" }), {
        status: 500,
        headers: { "content-type": "application/json" },
      }),
    );

    const { mod, caught } = await caughtFrom(fetchMock);

    expect(caught).toBeInstanceOf(mod.AnalyticsUpstreamError);
    expect((caught as Error).message).toBe("Analytics service error");
    expect(
      (caught as InstanceType<typeof mod.AnalyticsUpstreamError>).seamCode,
    ).toBeNull();
  });

  // ============================================================
  // [140.3-05 / TS-35] The WIRING, not the helper.
  //
  // `classifyKeyValidationError`'s new branch reads a `seamCode` property off
  // the caught value. A unit test that hands it a hand-built object proves the
  // branch works; it does NOT prove the seam client actually PUTS that property
  // on what it throws, which is the half that has silently broken before in
  // this programme. These two cases drive the REAL client over the REAL
  // venue-transient wire shape and hand the REAL throwable to the REAL
  // classifier — no mocked module between them.
  //
  // The bodies are byte-identical to
  // `analytics-service/tests/fixtures/validate_key_venue_transient_contract.json`,
  // typed here as literals. `status` is NOT asserted as a literal: plan
  // 140.3-06 remaps 400 -> 424 in the next wave and these cases must survive it.
  // ============================================================

  it("[140.3-05 / TS-35] a venue-transient body's flat `code` reaches the thrown error, and the classifier reads it", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          detail:
            "Exchange blocked the validation request at the edge (DDoS / WAF protection). Check region / IP allowlist.",
          code: "DDOS_PROTECTION",
          recoverable: true,
        }),
        { status: 400, headers: { "content-type": "application/json" } },
      ),
    );

    const { mod, caught } = await caughtFrom(fetchMock);

    expect(caught).toBeInstanceOf(mod.AnalyticsUpstreamError);
    const err = caught as InstanceType<typeof mod.AnalyticsUpstreamError>;
    expect(err.seamCode).toBe("DDOS_PROTECTION");
    // The property must be an OWN data property, readable with `typeof` and
    // never `instanceof`: sixteen route test files mock this module wholesale,
    // so the class identity is unavailable inside the catch arms that consume
    // this value.
    expect(Object.hasOwn(err, "seamCode")).toBe(true);
    // …and the real classifier, driven by the real throwable, no longer blames
    // the user's key for a block at the venue's edge.
    expect(classifyKeyValidationError(err).code).toBe("KEY_VENUE_TRANSIENT");
  });

  it("[140.3-05 / TS-35] the headline venue outage survives the whole client→classifier path", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          detail: "Exchange is currently unavailable. Try again in a few minutes.",
          code: "EXCHANGE_UNAVAILABLE",
          recoverable: true,
        }),
        { status: 400, headers: { "content-type": "application/json" } },
      ),
    );

    const { caught } = await caughtFrom(fetchMock);

    expect((caught as { seamCode?: unknown }).seamCode).toBe(
      "EXCHANGE_UNAVAILABLE",
    );
    expect(
      classifyKeyValidationError(caught).code,
      "A Binance maintenance window during key-connect rendered as UNKNOWN/500 " +
        "'something went wrong, our team has been notified' with no retry " +
        "affordance. The machine code has been on the wire since 140.1.2; " +
        "nothing read it.",
    ).toBe("KEY_EXCHANGE_UNAVAILABLE");
  });
});
