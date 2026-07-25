import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CircuitOpenError } from "@/lib/seam-errors";
import { DEFAULT_RETRY_AFTER_S } from "@/lib/resilient-fetch";
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

  /**
   * Phase 140 round-3 / C3 — the FOURTH seam-unavailable 503 this module can
   * mint, and the only one that used to carry no `code`.
   *
   * A codeless 503 forces every client to classify off the bare HTTP status,
   * which is precisely the rule this finding exists to end: `/api/keys/sync`
   * ALSO answers 503 for two Supabase failures, so a status-shaped classifier
   * described a database incident as our circuit breaker pausing traffic.
   */
  it("C3: a missing INTERNAL_API_TOKEN answers 503 with a NAMED code", async () => {
    delete process.env.INTERNAL_API_TOKEN;
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

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
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.code).toBe("UPSTREAM_NOT_CONFIGURED");
    // Recoverable, and carrying the same static outage copy as the other three
    // arms — the user meaning is identical (the request never left).
    expect(body.recoverable).toBe(true);
    expect(typeof body.human_message).toBe("string");
    // The transport must never have been attempted.
    expect(coreSpy).not.toHaveBeenCalled();
    errSpy.mockRestore();
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

  it("an AUTHENTICATED caller gets the breaker's own cooldown, not a hardcoded constant", async () => {
    coreSpy.mockRejectedValue(new CircuitOpenError(7));
    const result = await postProcessKey({
      flow_type: "resync",
      source: "keys-sync",
      context: {},
      userId: "u1",
      correlationId: "c2",
    });
    expect(failureResponse(result).headers.get("Retry-After")).toBe("7");
  });

  /**
   * CR-04 / CR-05 — the anonymous surface.
   *
   * `verify-strategy` is the landing-page teaser: no `withAuth`, no session
   * read, and it crosses the SAME seam under the SAME single breaker key as
   * every authenticated tenant. `unauthenticated: true` is what stops an
   * anonymous payload from driving that shared breaker, and what stops the 503
   * from publishing the exact remaining cooldown to the open internet.
   */
  it("PUBLIC caller: Retry-After is the STATIC constant, never the live breaker TTL", async () => {
    // 7 is deliberately far from DEFAULT_RETRY_AFTER_S so "the TTL leaked"
    // cannot be mistaken for "the constant happened to match".
    coreSpy.mockRejectedValue(new CircuitOpenError(7));
    const result = await postProcessKey({
      flow_type: "teaser",
      source: "landing",
      context: {},
      userId: "public",
      correlationId: "c-public",
      unauthenticated: true,
    });
    const response = failureResponse(result);
    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe(
      String(DEFAULT_RETRY_AFTER_S),
    );
    expect(response.headers.get("Retry-After")).not.toBe("7");
  });

  it("PUBLIC caller: the seam call opts OUT of writing the shared breaker counter", async () => {
    // The wiring, not just the flag: the value must reach the CORE. A client
    // that accepted `unauthenticated` and then forgot to thread it would leave
    // the whole DoS open while looking fixed at the call site.
    coreSpy.mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await postProcessKey({
      flow_type: "teaser",
      source: "landing",
      context: {},
      userId: "public",
      correlationId: "c-public-2",
      unauthenticated: true,
    });

    const init = coreSpy.mock.calls[0][2] as { recordFailures?: boolean };
    expect(init.recordFailures).toBe(false);
  });

  it("AUTHENTICATED caller: the seam call still records failures (default unchanged)", async () => {
    coreSpy.mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await postProcessKey({
      flow_type: "resync",
      source: "keys-sync",
      context: {},
      userId: "u1",
      correlationId: "c-authed",
    });

    const init = coreSpy.mock.calls[0][2] as { recordFailures?: boolean };
    expect(init.recordFailures).toBe(true);
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
 * Phase 140 review / D-5 — degrade, but never SILENTLY.
 *
 * Both body reads were `res.json().catch(() => ({}))`, which discards the parse
 * error entirely. The `ok` arm is the damaging one: `/api/keys/sync` forwards
 * this body, so an upstream answering 200 with an unparseable payload produced
 * a clean `200 {}` to the client. The wizard then read
 * `kickoff.composite === undefined`, took the single-key branch, and waited for
 * a sync nothing had described — a silent WRONG ANSWER rather than a visible
 * failure, with nothing anywhere to explain it.
 *
 * The `{}` fallback is deliberately kept (both callers already treat it as "no
 * usable fields" and the status is preserved). It is the silence that was wrong.
 */
describe("postProcessKey — D-5 unparseable upstream bodies are logged", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    process.env.INTERNAL_API_TOKEN = "internal-test-token";
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it.each([
    { label: "2xx (the silent-wrong-answer path)", status: 200, ok: true },
    { label: "non-2xx", status: 500, ok: false },
  ])(
    "logs when a $label body cannot be parsed, and still degrades to {}",
    async ({ status, ok }) => {
      coreSpy.mockImplementation(
        async () =>
          // Truncated mid-flight behind a JSON content-type: a real proxy
          // failure shape, not a synthetic one.
          new Response('{"composite": tr', {
            status,
            headers: { "content-type": "application/json" },
          }),
      );

      const result = await postProcessKey({
        flow_type: "resync",
        source: "test",
        context: {},
        userId: "u1",
        correlationId: "corr-d5",
      });

      // Behaviour preserved: still degrades, still preserves the status.
      expect(result.ok).toBe(ok);

      const logged = errorSpy.mock.calls
        .map((c: unknown[]) => c.map((a) => JSON.stringify(a)).join(" "))
        .join("\n");
      expect(logged).toContain("unparseable JSON body");
      // The correlation id is what joins this line to the Python side.
      expect(logged).toContain("corr-d5");
      // The body is NEVER logged — the seam carries raw exchange credentials.
      expect(logged).not.toContain("composite");
    },
  );

  it("stays silent when the body parses cleanly", async () => {
    // A log per successful call would drown the one that matters.
    coreSpy.mockImplementation(
      async () =>
        new Response(JSON.stringify({ composite: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );

    await postProcessKey({
      flow_type: "resync",
      source: "test",
      context: {},
      userId: "u1",
      correlationId: "corr-ok",
    });

    expect(
      errorSpy.mock.calls.filter((c: unknown[]) =>
        String(c[0]).includes("unparseable JSON body"),
      ),
    ).toHaveLength(0);
  });
});

/**
 * Batch-D / D2a — the log site with NO redaction at all.
 *
 * `console.error(..., err.message)` on a request whose headers carry
 * `Authorization: Bearer ${INTERNAL_API_TOKEN}` and `X-User-Access-Token` — the
 * END USER's live Supabase session JWT, which is the headline example in C4's
 * own commit message. The core redacted its copy of the same error; this frame
 * printed it raw one line later into the same sink.
 */
describe("[D2a] postProcessKey transport log scrubs the request's own secrets", () => {
  const realFetch = global.fetch;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    process.env.INTERNAL_API_TOKEN = "internal-live-token-abcdefghij";
    process.env.ANALYTICS_SERVICE_URL = "http://analytics.test";
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    global.fetch = realFetch;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("never publishes INTERNAL_API_TOKEN or the user's access token", async () => {
    const USER_JWT = "eyJhbGciOi.supabase-live-session.signature";
    // undici echoing the outgoing headers back in the MESSAGE — the exact
    // H-0328 shape, and the one the bare `err.message` log published whole.
    // The syscall detail hangs off `.cause`, as it really does.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(
        new TypeError(
          `fetch failed [authorization=Bearer internal-live-token-abcdefghij] ` +
            `[x-user-access-token=${USER_JWT}]`,
          { cause: new Error("connect ECONNREFUSED 10.0.0.1:8002") },
        ),
      ),
    );

    const result = await postProcessKey({
      flow_type: "csv_finalize",
      source: "csv",
      context: {},
      userId: "u1",
      userAccessToken: USER_JWT,
      correlationId: "corr-secret",
    });
    expect(result.ok).toBe(false);

    const logged = errorSpy.mock.calls.flat().map(String).join("\n");
    expect(logged).not.toContain("internal-live-token-abcdefghij");
    expect(logged).not.toContain(USER_JWT);
    // POSITIVE CONTROL: the diagnosis survives — and `describeTransportError`
    // recovers the `.cause` syscall code the bare `err.message` threw away, so
    // this cannot pass merely because the log line was deleted.
    expect(logged).toContain("<redacted>");
    expect(logged).toContain("fetch failed");
    expect(logged).toContain("ECONNREFUSED");
  });
});
