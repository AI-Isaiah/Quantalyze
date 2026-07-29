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

  it("ME-01: NAMES a SeamConfigError as our own config fault in the operator log", async () => {
    // ⚠️ THE LOG HALF ONLY, AND THAT BOUNDARY IS DELIBERATE.
    //
    // A config fault took the UPSTREAM_NETWORK_ERROR 502 arm with
    // human_message "Could not reach the ingestion service", so a malformed
    // ANALYTICS_SERVICE_URL — our own deployment typo — read to ops as Railway
    // being down. `analytics-client`'s sibling fix rethrows the class
    // unwrapped; that is not available here, because this function is declared
    // never to throw at its five caller routes.
    //
    // Giving the fault its own `code` and `human_message` is authoring
    // user-facing copy, which is 140.3's fence. So this asserts the OPERATOR
    // half now and the envelope stays as-is, recorded as an obligation rather
    // than half-changed.
    const { SeamConfigError } = await import("@/lib/resilient-fetch");
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    coreSpy.mockRejectedValue(
      new SeamConfigError(
        "[resilient-fetch] ANALYTICS_SERVICE_URL is not a usable base URL",
      ),
    );

    const result = await postProcessKey({
      flow_type: "resync",
      source: "keys-sync",
      context: { key_id: "k1" },
      userId: "u1",
      correlationId: "c-config",
      routeTag: "keys/sync",
    });

    expect(result.ok).toBe(false);
    const logged = errorSpy.mock.calls.map((a) => String(a[0])).join("\n");
    expect(logged).toContain("CONFIG fault");
    expect(logged).toContain("NOT a reason to blame Railway");
    expect(logged).toContain("keys/sync");
    errorSpy.mockRestore();
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

/**
 * Phase 140.1 / PYAPI-02 — the `X-Tenant-Claim` mint.
 *
 * The Python limiter buckets `/process-key` on an HMAC-verified tenant claim
 * (`analytics-service/services/rate_limit.py:verify_tenant_claim`). Before this
 * phase one 100/hour bucket keyed on the SHARED internal token served the whole
 * platform, and Vercel caps the anonymous teaser at 600/hour per IP — so one
 * anonymous visitor drained every tenant's window in about ten minutes.
 *
 * Python shipped FIRST and tolerates a missing header by falling back to the
 * unverified bucket, which is what makes this TS half purely additive. Without
 * it every caller lands in that fallback and PYAPI-02 is not actually closed.
 *
 * ORACLE DISCIPLINE: the expected HMAC is computed here with `node:crypto`,
 * NEVER by importing the client's mint helper. An oracle that asks the code
 * under test what it expects cannot fail.
 */
describe("postProcessKey — X-Tenant-Claim (PYAPI-02)", () => {
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
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;
    return fetchMock;
  }

  function sentHeaders(
    fetchMock: ReturnType<typeof vi.fn>,
  ): Record<string, string> {
    return (fetchMock.mock.calls[0][1] as RequestInit).headers as Record<
      string,
      string
    >;
  }

  /** The independent oracle. Same algorithm, written out by hand. */
  async function hmacHex(secret: string, message: string): Promise<string> {
    const { createHmac } = await import("node:crypto");
    return createHmac("sha256", secret).update(message).digest("hex");
  }

  it("mints a claim whose HMAC verifies, over the userId it forwards", async () => {
    const fetchMock = mockFetchOk();

    await postProcessKey({
      flow_type: "onboard",
      source: "binance",
      context: {},
      userId: "user-42",
      correlationId: "c1",
    });

    const headers = sentHeaders(fetchMock);
    const claim = headers["X-Tenant-Claim"];
    expect(claim).toBeDefined();

    const parts = claim.split(".");
    expect(parts).toHaveLength(3);
    const [payload, exp, mac] = parts;

    // The payload is the SAME identifier already forwarded as X-User-Id — the
    // claim is the signed half of an identity the service already receives
    // unsigned (and, being unsigned, may never select a bucket).
    expect(payload).toBe("user-42");
    expect(headers["X-User-Id"]).toBe("user-42");

    expect(mac).toBe(await hmacHex("internal-test-token", `${payload}.${exp}`));

    // The secret is the HMAC key, never the payload and never the wire value.
    expect(claim).not.toContain("internal-test-token");
  });

  it("mints an exp in the future and inside a short TTL", async () => {
    const fetchMock = mockFetchOk();
    const before = Math.floor(Date.now() / 1000);

    await postProcessKey({
      flow_type: "resync",
      source: "binance",
      context: {},
      userId: "user-42",
      correlationId: "c1",
    });

    const exp = Number(sentHeaders(fetchMock)["X-Tenant-Claim"].split(".")[1]);
    expect(Number.isInteger(exp)).toBe(true);
    expect(exp).toBeGreaterThan(before);
    // A captured claim must not be a permanent tenant-bucket credential.
    expect(exp).toBeLessThanOrEqual(before + 300);
  });

  it("mints the literal payload 'public' on the anonymous teaser path", async () => {
    const fetchMock = mockFetchOk();

    // src/app/api/verify-strategy/route.ts:192 passes userId: "public".
    await postProcessKey({
      flow_type: "teaser",
      source: "binance",
      context: {},
      userId: "public",
      correlationId: "c1",
    });

    const claim = sentHeaders(fetchMock)["X-Tenant-Claim"];
    expect(claim.split(".")[0]).toBe("public");
  });

  it.each([
    ["teaser", "public"],
    ["onboard", "u1"],
    ["resync", "u2"],
    ["csv", "u3"],
  ] as const)(
    "attaches X-Tenant-Claim on the %s flow (one shared headers assembly)",
    async (flowType, userId) => {
      const fetchMock = mockFetchOk();

      await postProcessKey({
        flow_type: flowType,
        source: "binance",
        context: {},
        userId,
        correlationId: "c1",
      });

      const claim = sentHeaders(fetchMock)["X-Tenant-Claim"];
      expect(claim.split(".")[0]).toBe(userId);
    },
  );

  it("CROSS-LANGUAGE FIXTURE: the algorithm matches the string pytest pins", async () => {
    // This exact string is COPY-PASTED (never imported) into
    // analytics-service/tests/test_process_key.py::
    //   test_cross_language_claim_from_ts_client_buckets_to_tenant
    // where the Python key function must bucket it to
    // "process_key:t:cross-lang-user". exp is year-2050 so the pytest's expiry
    // check does not turn into a time bomb.
    const CROSS_LANGUAGE_CLAIM =
      "cross-lang-user.2524608300.1c6f1e147d8c58605c1196ac7e2a70220f21ff999208701224de6afbd03a296c";

    const [payload, exp, mac] = CROSS_LANGUAGE_CLAIM.split(".");
    expect(mac).toBe(await hmacHex("internal-test-token", `${payload}.${exp}`));
    expect(payload).toBe("cross-lang-user");
  });

  /**
   * Phase 140.2-09 / TS-04 — the mint moved to `@/lib/tenant-claim` and gained
   * fail-loud refusals, so a call that previously could not throw now can.
   *
   * TWO things are pinned here, and the SECOND is the one that matters. The
   * refusal must not be reported as a dead upstream: minted inline in the
   * headers object it would sit INSIDE the transport `try`, and the catch would
   * classify a configuration fault on our side as `UPSTREAM_NETWORK_ERROR` 502
   * — a silent degradation wearing a dying-Railway costume. It must also not
   * ESCAPE, because `postProcessKey` has never thrown at any of its five caller
   * routes and none of them has a catch for it.
   */
  it("REFUSES to call upstream (503, no fetch, not a 502) when the payload cannot be minted", async () => {
    const fetchMock = mockFetchOk();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await postProcessKey({
      flow_type: "onboard",
      source: "binance",
      context: {},
      // The empty-payload refusal. A claim over "" verifies perfectly and
      // buckets EVERY caller to `process_key:t:` — one shared window wearing
      // the costume of per-tenant isolation.
      userId: "",
      correlationId: "c1",
      routeTag: "test-route",
    });

    expect(result.ok).toBe(false);
    // No request may leave: an unmintable claim means we cannot honestly
    // identify the tenant, and spending upstream capacity anyway is the
    // platform-bucket regression this phase exists to close.
    expect(fetchMock).not.toHaveBeenCalled();
    if (result.ok) throw new Error("unreachable");
    expect(result.response.status).toBe(503);
    expect(result.response.status).not.toBe(502);
    expect(errorSpy).toHaveBeenCalled();
    // The log names the failure without echoing the secret.
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain(
      "internal-test-token",
    );
  });
});

/**
 * Phase 140.2 / SEAMCORE-02 — the body read is inside the window, and the
 * choke point STILL never throws.
 *
 * `postProcessKey` is declared `Promise<PostProcessKeyResult>` and has never
 * thrown. Its `try` used to wrap ONLY the `resilientFetch` call, with both body
 * reads sitting after the catch — so once the core started throwing a typed
 * error from `res.json()`, letting it propagate would have added an unhandled
 * throw path at all FIVE caller routes (strategies/csv-validate,
 * strategies/csv-finalize, strategies/finalize-wizard, keys/sync,
 * verify-strategy), none of which has a catch for it.
 *
 * These cases drive the REAL core (the file-level `coreSpy` delegates to the
 * actual implementation) with a transport that resolves its headers and then
 * rejects its body — the modal Railway degradation. The expected envelopes are
 * the two that ALREADY existed; this plan authors no new code and no new copy.
 */
describe("postProcessKey — a body-read failure never escapes the choke point", () => {
  const realFetch = global.fetch;

  beforeEach(() => {
    process.env.INTERNAL_API_TOKEN = "internal-test-token";
    process.env.ANALYTICS_SERVICE_URL = "http://analytics.test";
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    global.fetch = realFetch;
    vi.restoreAllMocks();
    // A leaked fetch stub is this repo's known CI-only (Node 22) failure cause.
    vi.unstubAllGlobals();
  });

  /** Headers resolve, body rejects. A real Response cannot express this. */
  function bodyRejectingFetch(rejection: unknown, status = 200) {
    const fetchMock = vi.fn(async () => ({
      ok: status < 400,
      status,
      statusText: "OK",
      headers: new Headers({ "content-type": "application/json" }),
      json: () => Promise.reject(rejection),
      text: () => Promise.reject(rejection),
    }));
    global.fetch = fetchMock as unknown as typeof fetch;
    return fetchMock;
  }

  async function call() {
    return postProcessKey({
      flow_type: "csv",
      source: "csv",
      context: {},
      userId: "u1",
      correlationId: "body-read-corr",
    });
  }

  it("a deadline mid-body maps onto the EXISTING UPSTREAM_TIMEOUT 504 envelope", async () => {
    bodyRejectingFetch(new DOMException("aborted", "TimeoutError"));

    const result = await call();

    expect(result.ok).toBe(false);
    const response = failureResponse(result);
    expect(response.status).toBe(504);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.code).toBe("UPSTREAM_TIMEOUT");
    expect(body.recoverable).toBe(true);
    expect(body.correlation_id).toBe("body-read-corr");
    // No new user-facing copy: byte-identical to the transport-timeout arm.
    expect(body.human_message).toBe(
      "The ingestion service did not respond in time. Please try again.",
    );
  });

  it("a non-deadline body failure maps onto the EXISTING UPSTREAM_NETWORK_ERROR 502 envelope", async () => {
    bodyRejectingFetch(new TypeError("terminated"));

    const result = await call();

    expect(result.ok).toBe(false);
    const response = failureResponse(result);
    expect(response.status).toBe(502);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.code).toBe("UPSTREAM_NETWORK_ERROR");
    expect(body.human_message).toBe("Could not reach the ingestion service.");
  });

  it("the non-2xx arm's body read is inside the window too", async () => {
    // The `!ok` read used to sit after the catch as well, and swallowed every
    // failure into `{}` — so an aborted body on a 500 produced a 500 envelope
    // with an empty body, reporting a dying Railway as a well-formed reply.
    bodyRejectingFetch(new DOMException("aborted", "TimeoutError"), 500);

    const response = failureResponse(await call());
    expect(response.status).toBe(504);
    expect(((await response.json()) as { code: string }).code).toBe(
      "UPSTREAM_TIMEOUT",
    );
  });

  it("STILL never throws — the declared contract of all five caller routes", async () => {
    for (const rejection of [
      new DOMException("aborted", "TimeoutError"),
      new TypeError("terminated"),
      new Error("something else entirely"),
    ]) {
      bodyRejectingFetch(rejection);
      // `.resolves` is the assertion: a throw here is the five-unhandled-paths
      // regression, and it would surface as a rejected promise, not a bad code.
      await expect(call()).resolves.toMatchObject({ ok: false });
    }
  });

  it("an unparseable body still resolves ok — a parse failure is not degradation", async () => {
    // Negative control. An upstream that answers 200 with an empty body is
    // REPLYING; the pre-existing `{}` fallback must survive the fix, or every
    // 204-shaped reply becomes a 502.
    const fetchMock = vi.fn(
      async () =>
        new Response("", {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await call();
    expect(result).toEqual({ ok: true, status: 200, body: {} });
  });
});

/**
 * Phase 140.2-11 / SEAMCORE-11 (A-27) — ONE defined outcome for an ambiguous
 * transport, and the SAME one `analytics-client.test.ts` pins.
 *
 * THE CRASH. `Response.json(body, { status: 204 | 205 | 304 })` throws
 * `TypeError: Response constructor: Invalid response status code` — verified by
 * execution on Node v25.8.1, and WHATWG-spec behaviour rather than a runtime
 * quirk, so CI's Node 22 agrees. This client's status pass-through
 * (`NextResponse.json(body, { status: res.status })`) sits OUTSIDE the transport
 * `try` — plan 140.2-05 kept it there deliberately so this plan could still
 * observe the fault — so a 304 pass-through threw straight out of
 * `postProcessKey`, a function declared `Promise<PostProcessKeyResult>` whose
 * five caller routes (keys/sync, verify-strategy, finalize-wizard, csv-validate,
 * csv-finalize) have no catch for it.
 *
 * THE DIVERGENCE. 204 and 205 are `ok`, so they took the SUCCESS arm and
 * returned `{ ok: true, status: 204, body: {} }` — a success envelope with an
 * empty body, i.e. this client reported "the service replied" for a reply that
 * contained nothing, while `analytics-client` threw on the very same response.
 * A `200 text/html` maintenance page did the same thing: `res.json()` rejected,
 * the `{}` fallback swallowed it, and a Railway edge page was reported upstream
 * as a well-formed success.
 *
 * THE OUTCOME IS A RETURNED ENVELOPE, NOT A THROW. Plan 140.2-05 widened this
 * function's `try` specifically to keep it non-throwing for those five routes;
 * closing A-27 with a throw would undo that in the same file.
 *
 * ORACLE DISCIPLINE: the operator message is typed out here in full, per case,
 * byte-identical to the literals in `analytics-client.test.ts`. That equality is
 * what "ONE defined outcome across both clients" actually means.
 */
describe("[SEAMCORE-11 / A-27] postProcessKey: ONE defined outcome for an ambiguous transport", () => {
  const realFetch = global.fetch;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    process.env.INTERNAL_API_TOKEN = "internal-test-token";
    process.env.ANALYTICS_SERVICE_URL = "http://analytics.test";
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    global.fetch = realFetch;
    vi.restoreAllMocks();
    // A leaked fetch stub is this repo's known CI-only (Node 22) failure cause.
    vi.unstubAllGlobals();
  });

  function respondWith(response: Response) {
    const fetchMock = vi.fn(async () => response);
    global.fetch = fetchMock as unknown as typeof fetch;
    return fetchMock;
  }

  async function call() {
    return postProcessKey({
      flow_type: "resync",
      source: "keys-sync",
      context: { key_id: "k1" },
      userId: "u1",
      correlationId: "ambiguous-corr",
      routeTag: "keys/sync",
    });
  }

  /** The envelope every case below must produce, asserted the same way. */
  async function expectDefinedOutcome(
    result: Awaited<ReturnType<typeof postProcessKey>>,
    expectedOperatorMessage: string,
  ) {
    expect(result.ok).toBe(false);
    const response = failureResponse(result);
    expect(response.status).toBe(502);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toEqual({
      ok: false,
      code: "UPSTREAM_NETWORK_ERROR",
      // No new user-facing copy: byte-identical to the arm that already exists
      // for "we never reached the ingestion service", because a maintenance
      // page IS not reaching it. 140.3 owns the client-facing surface.
      human_message: "Could not reach the ingestion service.",
      correlation_id: "ambiguous-corr",
      recoverable: true,
    });
    // The operator half. Equality against the hand-typed literal, which is the
    // SAME string analytics-client throws for the same response.
    expect(
      errorSpy.mock.calls.map((args: unknown[]) => String(args[0])),
      "The operator log for an ambiguous transport drifted, or is missing. " +
        "The user-facing envelope is deliberately generic, so this line is " +
        "the ONLY place the observed status and content-type are recorded — " +
        "and it must stay byte-identical to what analytics-client throws.",
    ).toContain(`[keys/sync] ${expectedOperatorMessage}`);
  }

  it("a 200 text/html maintenance page is NOT reported as a successful reply", async () => {
    respondWith(
      new Response("<html><body>Application failed to respond</body></html>", {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      }),
    );

    const result = await call();

    await expectDefinedOutcome(
      result,
      "Analytics seam returned an unusable response (HTTP 200, content-type text/html). The upstream did not answer with the JSON contract.",
    );
  });

  it("a 204 resolves to that same outcome, not a success envelope with an empty body", async () => {
    respondWith(new Response(null, { status: 204 }));

    const result = await call();

    await expectDefinedOutcome(
      result,
      "Analytics seam returned an unusable response (HTTP 204, content-type absent). The upstream did not answer with the JSON contract.",
    );
  });

  it("a 205 resolves to that same outcome", async () => {
    respondWith(new Response(null, { status: 205 }));

    const result = await call();

    await expectDefinedOutcome(
      result,
      "Analytics seam returned an unusable response (HTTP 205, content-type absent). The upstream did not answer with the JSON contract.",
    );
  });

  it("a 304 resolves to that same outcome instead of crashing the route", async () => {
    respondWith(new Response(null, { status: 304 }));

    const result = await call();

    await expectDefinedOutcome(
      result,
      "Analytics seam returned an unusable response (HTTP 304, content-type absent). The upstream did not answer with the JSON contract.",
    );
  });

  /**
   * ORACLE HARDENING, found by running mutation M49 (2026-07-27).
   *
   * Deleting the null-body-status clause left the 204 and 205 cases above
   * GREEN, because a null-body response carries no content-type and the
   * non-JSON-2xx clause caught them by accident. Two independent guards is
   * fine; an oracle that cannot tell WHICH one fired is not — a 204 that DOES
   * advertise `application/json` (a proxy or a hand-rolled handler will) slips
   * straight past the surviving clause and back into
   * `{ ok: true, status: 204, body: {} }`, the exact divergence this plan
   * closes.
   *
   * These cases pin the load-bearing claim of the implementation comment: the
   * three statuses are decided on the STATUS, not on the content-type.
   */
  it.each([204, 205, 304])(
    "a %i is decided on the STATUS even when it advertises application/json",
    async (status) => {
      respondWith(
        new Response(null, {
          status,
          headers: { "content-type": "application/json" },
        }),
      );

      await expectDefinedOutcome(
        await call(),
        `Analytics seam returned an unusable response (HTTP ${status}, content-type application/json). The upstream did not answer with the JSON contract.`,
      );
    },
  );

  it("NEVER passes a null-body status to a JSON response constructor", async () => {
    // The crash, reproduced here so the guard above is anchored to the real
    // platform behaviour rather than to a belief about it. This is precisely
    // what `NextResponse.json(body, { status: res.status })` did on a 304.
    for (const status of [204, 205, 304]) {
      expect(() => Response.json({ ok: false }, { status })).toThrow(TypeError);
    }

    // And the envelope this client actually returns is constructible and
    // readable — which is what "the route responds rather than crashing" means
    // at the five call sites that do `if (!result.ok) return result.response`.
    for (const status of [204, 205, 304]) {
      respondWith(new Response(null, { status }));
      const result = await call();
      expect(result.ok).toBe(false);
      const passedThrough = failureResponse(result);
      expect(passedThrough.status).toBe(502);
      await expect(passedThrough.json()).resolves.toMatchObject({
        code: "UPSTREAM_NETWORK_ERROR",
      });
    }
  });

  it("STILL never throws — the declared contract of all five caller routes", async () => {
    for (const response of [
      new Response(null, { status: 204 }),
      new Response(null, { status: 205 }),
      new Response(null, { status: 304 }),
      new Response("<html></html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
    ]) {
      respondWith(response);
      // `.resolves` IS the assertion: a throw here is the five-unhandled-paths
      // regression, and it surfaces as a rejected promise, not a bad code.
      await expect(call()).resolves.toMatchObject({ ok: false });
    }
  });

  it("NEGATIVE CONTROL: a JSON 2xx is byte-unchanged", async () => {
    respondWith(
      new Response(JSON.stringify({ ok: true, strategy_id: "s1" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(call()).resolves.toEqual({
      ok: true,
      status: 200,
      body: { ok: true, strategy_id: "s1" },
    });
  });

  it("NEGATIVE CONTROL: a JSON non-2xx still forwards its own status and body", async () => {
    // A 500 with a body has a status that is safe to pass through, so it is not
    // ambiguous and this plan must not touch it.
    respondWith(
      new Response(JSON.stringify({ error: "boom" }), {
        status: 500,
        headers: { "content-type": "application/json" },
      }),
    );

    const result = await call();
    const response = failureResponse(result);
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: "boom" });
  });
});

/**
 * Phase 140.3-15 / TS-38 + SEAMUX-04 — A CONFIG FAULT STOPS WEARING THE
 * UPSTREAM'S ENVELOPE.
 *
 * 140.2's review-fix pass gave `SeamConfigError` an operator-facing log that
 * NAMES it (pinned by the operator-log falsifier above, which these cases must
 * not disturb — and which is deliberately NOT named by its identifier here,
 * because an acceptance criterion greps this file's diff for that identifier
 * and prose about not touching a case would satisfy it. Seventh occurrence of
 * that trap in this phase). What it
 * could not do is change the ENVELOPE: giving the fault its own `code` and
 * `human_message` is authoring user-facing copy, which was 140.2's fence. So a
 * malformed `ANALYTICS_SERVICE_URL` — OUR deployment typo — still returned
 * `UPSTREAM_NETWORK_ERROR` 502 / "Could not reach the ingestion service", a
 * false claim about whose fault it is, and offered a retry that cannot ever
 * succeed because the condition is permanent until we redeploy.
 *
 * ORACLE INDEPENDENCE: the expected sentence is HAND-TYPED here. Reading
 * `SEAM_MISCONFIGURED_HUMAN_MESSAGE` out of the module under test would assert
 * only that a string equals itself.
 *
 * ⚠️ THE TWO SIBLING ARMS ARE THE ANTI-REGRESSION HALF AND THEY ARE
 * LOAD-BEARING. The new arm sits between the timeout arm and the transport arm,
 * and a `SeamConfigError` reaches the catch by the same route they do. An arm
 * that swallowed either would trade one false attribution for two.
 */
describe("[140.3-15 / TS-38] a config fault returns OUR envelope, not the upstream's", () => {
  const realFetch = global.fetch;

  beforeEach(() => {
    process.env.INTERNAL_API_TOKEN = "internal-test-token";
    process.env.ANALYTICS_SERVICE_URL = "http://analytics.test";
  });

  afterEach(() => {
    global.fetch = realFetch;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function callWithConfigFault() {
    const { SeamConfigError } = await import("@/lib/resilient-fetch");
    coreSpy.mockRejectedValue(
      new SeamConfigError(
        "[resilient-fetch] ANALYTICS_SERVICE_URL is not a usable base URL",
      ),
    );
    return postProcessKey({
      flow_type: "resync",
      source: "keys-sync",
      context: { key_id: "k1" },
      userId: "u1",
      correlationId: "c-ts38",
      routeTag: "keys/sync",
    });
  }

  it("returns SEAM_MISCONFIGURED — NOT the dead-upstream envelope", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const response = failureResponse(await callWithConfigFault());
    const body = (await response.json()) as Record<string, unknown>;

    expect(body.code).toBe("SEAM_MISCONFIGURED");
    // The specific lie being removed, asserted NEGATIVELY as well as
    // positively: a rename that left the old code in place would satisfy only
    // one of these.
    expect(body.code).not.toBe("UPSTREAM_NETWORK_ERROR");
    expect(body.human_message).not.toBe("Could not reach the ingestion service.");
  });

  it("names the fault as OURS, in the exact hand-typed sentence", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const response = failureResponse(await callWithConfigFault());
    const body = (await response.json()) as Record<string, unknown>;

    expect(body.human_message).toBe(
      "We could not send this request — our own configuration is wrong. Retrying will not clear it.",
    );
  });

  it("answers a status that attributes the fault to US, never 502", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const response = failureResponse(await callWithConfigFault());

    // 500 = the server that produced THIS response is at fault, which is the
    // literal truth here. 502 asserts the UPSTREAM is bad, which is the claim
    // this obligation exists to stop; 503/504 both signal transience on a
    // condition that is permanent until we redeploy.
    expect(response.status).toBe(500);
    expect(response.status).not.toBe(502);
    expect(response.status).not.toBe(503);
    expect(response.status).not.toBe(504);
    // A permanent condition must not advertise a wait either.
    expect(response.headers.get("Retry-After")).toBeNull();
  });

  it("is NOT recoverable — a retry control here can never succeed", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const response = failureResponse(await callWithConfigFault());
    const body = (await response.json()) as Record<string, unknown>;

    expect(body.recoverable).toBe(false);
    expect(body).toEqual({
      ok: false,
      code: "SEAM_MISCONFIGURED",
      human_message: expect.any(String),
      correlation_id: "c-ts38",
      recoverable: false,
    });
  });

  it("carries NO URL, NO hostname and NO bare status — the teaser renders it verbatim", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const response = failureResponse(await callWithConfigFault());
    const message = String(
      ((await response.json()) as Record<string, unknown>).human_message,
    );

    // Threat T-140.3-15-02 / T-140-08. The anonymous landing-page teaser renders
    // this string directly, so the same static-copy constraint that governs
    // CIRCUIT_OPEN_HUMAN_MESSAGE applies.
    expect(message).not.toMatch(/https?:/i);
    expect(message).not.toMatch(/railway|upstash|vercel|supabase|localhost|\.com|\.app|\.test/i);
    expect(message).not.toMatch(/\b\d{3}\b/);
    expect(message).not.toMatch(/ANALYTICS_SERVICE_URL|INTERNAL_API_TOKEN|env\b/i);
  });

  it("STILL does not throw — the never-throws contract five caller routes depend on", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    // `.resolves` IS the assertion. None of the five callers has a catch for
    // this function, so a throw here is five new unhandled paths.
    await expect(callWithConfigFault()).resolves.toMatchObject({ ok: false });
  });

  it("ANTI-REGRESSION: a genuine TRANSPORT failure still answers UPSTREAM_NETWORK_ERROR 502", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    coreSpy.mockRejectedValue(new TypeError("fetch failed"));

    const response = failureResponse(
      await postProcessKey({
        flow_type: "resync",
        source: "keys-sync",
        context: {},
        userId: "u1",
        correlationId: "c-net",
      }),
    );
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({
      code: "UPSTREAM_NETWORK_ERROR",
      human_message: "Could not reach the ingestion service.",
      recoverable: true,
    });
  });

  it("ANTI-REGRESSION: a genuine TIMEOUT still answers UPSTREAM_TIMEOUT 504", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const abort = new DOMException("aborted", "TimeoutError");
    coreSpy.mockRejectedValue(abort);

    const response = failureResponse(
      await postProcessKey({
        flow_type: "resync",
        source: "keys-sync",
        context: {},
        userId: "u1",
        correlationId: "c-to",
      }),
    );
    expect(response.status).toBe(504);
    await expect(response.json()).resolves.toMatchObject({
      code: "UPSTREAM_TIMEOUT",
      recoverable: true,
    });
  });
});

/**
 * Phase 140.5-03 / SEAMPROSE-02 — THE `Retry-After` RELAY, and why it is not a
 * status branch.
 *
 * ⭐ HARD PREREQUISITE FOR PHASE 141. 141's retry-with-backoff consumes
 * `Retry-After`. Before this block, the forwarded non-2xx arm of
 * `postProcessKey` reconstructed the response from the BODY and the STATUS
 * only, so every upstream header died at the choke point. `/process-key` is
 * rate-limited on the Python side (two stacked `@limiter.limit` decorators on
 * `process_key.py`'s handler; `main.py`'s `RateLimitExceeded` handler answers
 * 429 with `headers={"Retry-After": str(retry_after)}`), so a Python-side 429
 * reached the browser as a 429 CARRYING NO WAIT AT ALL.
 *
 * WHY THESE TESTS LIVE HERE AND NOT AT FIVE CALL SITES. Five callers pass
 * through this one arm — `csv-validate`, `csv-finalize`, `finalize-wizard`,
 * `keys/sync`, `verify-strategy` — and each does
 * `if (!result.ok) return result.response;`. One relay reaches all five
 * (coverage-law row 1). It reaches ZERO wizard SURFACES on its own: the client
 * threads must also read the header, which is the other half of this plan.
 *
 * ⚠️ THE HEADER IS RELAYED, NEVER PARSED. `parseRetryAfterSeconds` is the ONE
 * parser and it lives on the READ side. `main.py` also puts
 * `retry_after_seconds` in the BODY, which makes a second extraction path
 * available here — do not take it. Two extraction paths for one fact is the
 * substring-cascade shape this milestone exists to remove.
 */
describe("[140.5-03 / SEAMPROSE-02] postProcessKey relays Retry-After on a forwarded non-2xx", () => {
  const realFetch = global.fetch;

  beforeEach(() => {
    process.env.INTERNAL_API_TOKEN = "internal-test-token";
    process.env.ANALYTICS_SERVICE_URL = "http://analytics.test";
  });

  afterEach(() => {
    global.fetch = realFetch;
    vi.restoreAllMocks();
    // A leaked fetch stub is this repo's known CI-only (Node 22) failure cause.
    vi.unstubAllGlobals();
  });

  function respondWith(
    body: unknown,
    status: number,
    extraHeaders: Record<string, string> = {},
  ) {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify(body), {
          status,
          headers: { "content-type": "application/json", ...extraHeaders },
        }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;
    return fetchMock;
  }

  async function call() {
    return postProcessKey({
      flow_type: "resync",
      source: "keys-sync",
      context: { key_id: "k1" },
      userId: "u1",
      correlationId: "c-retry-after",
      routeTag: "keys/sync",
    });
  }

  it("a 429 with `Retry-After: 17` forwards the header STRING-IDENTICALLY", async () => {
    respondWith(
      { ok: false, code: "RATE_LIMITED", retry_after_seconds: 17 },
      429,
      { "Retry-After": "17" },
    );
    const response = failureResponse(await call());

    expect(response.status).toBe(429);
    // The literal is hand-typed, and it is a STRING: the relay must not coerce
    // to a number and re-serialise, because that is parsing wearing a disguise.
    expect(response.headers.get("Retry-After")).toBe("17");
  });

  it("relays an HTTP-date value BYTE-IDENTICALLY — no parsing server-side", async () => {
    // RFC 9110 §10.2.3 permits the HTTP-date form and a CDN or WAF upstream of
    // our route may legitimately emit it. A choke point that parsed would have
    // to decide what to do with an unparseable value; a relay does not, and
    // `parseRetryAfterSeconds` on the read side already resolves this form
    // against the response's own `Date` header.
    const httpDate = "Wed, 21 Oct 2026 07:28:00 GMT";
    respondWith({ ok: false, code: "RATE_LIMITED" }, 429, {
      "Retry-After": httpDate,
    });
    const response = failureResponse(await call());

    expect(response.headers.get("Retry-After")).toBe(httpDate);
  });

  it("an upstream WITHOUT the header produces a response WITHOUT it — absence is not zero", async () => {
    // TRAP-3. A relay that defaulted to `"0"` would hand every consumer a wait
    // nobody advertised, and `0` fed to a backoff is the NEW-C05-01
    // thundering-herd root cause the ONE parser exists to make unrepresentable.
    respondWith({ ok: false, code: "GATE_NOT_ENOUGH_DATA" }, 422);
    const response = failureResponse(await call());

    expect(response.status).toBe(422);
    expect(response.headers.get("Retry-After")).toBeNull();
  });

  it("POSITIVE CONTROL: the 403 write-capable-key verdict still forwards body and status VERBATIM", async () => {
    // The arm being edited is the one whose 45-line docblock forbids branching
    // on status. This case is the receipt that the relay did not become one:
    // the PYAPI-10b 403 envelope must pass through exactly as before, header
    // absent because the upstream sent none.
    const verdict = {
      ok: false,
      code: "KEY_HAS_TRADING_PERMS",
      human_message: "This key can trade.",
      correlation_id: "c-retry-after",
    };
    respondWith(verdict, 403);
    const response = failureResponse(await call());

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual(verdict);
    expect(response.headers.get("Retry-After")).toBeNull();
  });

  it("relays the header on a 503 too — the relay is not keyed to 429", async () => {
    // ⭐ THE POINT OF THE WHOLE ARM, asserted rather than narrated: no code path
    // here selects behaviour by status. A relay that only fired on 429 would be
    // the status branch the docblock forbids, and it would drop the wait our own
    // breaker's 503 envelope advertises (`resilient-fetch`'s BREAKER_COOLDOWN_S
    // is stamped as a `Retry-After` on that arm).
    respondWith({ ok: false, code: "CIRCUIT_OPEN" }, 503, {
      "Retry-After": "30",
    });
    const response = failureResponse(await call());

    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("30");
  });
});
