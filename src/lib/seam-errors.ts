/**
 * Phase 140 / SEAM-03 — dependency-free LEAF for the seam error taxonomy.
 *
 * This file deliberately contains ZERO import statements, ZERO environment
 * reads, and ZERO module-load side effects. That is a load-bearing property,
 * not a stylistic one. Two independent constraints force it:
 *
 * 1. BUNDLE BOUNDARY. `src/lib/wizardErrors.ts` has no server-only imports
 *    today and is value-imported by ten `"use client"` components
 *    (MetadataStep, CsvPreviewStep, MultiKeyConnectStep, SyncPreviewStep,
 *    CsvSubmitStep, ConnectKeyStep, SubmitStep, CsvUploadStep,
 *    CsvValidationEnvelope, StrategyGrid). The wizard classifier must be able
 *    to branch on `err instanceof CircuitOpenError`. Homing the class in
 *    `analytics-client.ts` or `resilient-fetch.ts` would pull `@upstash/redis`,
 *    `@upstash/ratelimit`, and the resilience core's non-tree-shakeable
 *    module-load side effects (a `Redis.fromEnv()` singleton plus its
 *    unconfigured notice) into the browser bundle. The inverse guard —
 *    `import "server-only"` at `src/lib/analytics.ts:1` — is the repo
 *    convention for modules that must NEVER reach the client; this leaf is the
 *    mirror image: a module that must be safe in EITHER bundle.
 *
 * 2. MOCK SURVIVAL. Sixteen route test files `vi.mock("@/lib/analytics-client")`
 *    or `vi.mock("@/lib/process-key-client")`, and seven of eight use a FULL
 *    factory with no `importActual`. An `instanceof` check against a class
 *    re-exported through a wholesale-mocked module evaluates against
 *    `undefined` and throws `TypeError: Right-hand side of 'instanceof' is not
 *    callable` from inside a catch block — converting a clean 503 into a
 *    crash. Nothing mocks this leaf, so `instanceof CircuitOpenError` holds
 *    under every existing mock shape.
 *
 * ALL production and test imports of `CircuitOpenError` must use
 * `@/lib/seam-errors`. `resilient-fetch.ts` re-exports it for ergonomics, but
 * that re-export is a convenience alias over this single definition — there is
 * exactly one class identity in the process.
 */

/**
 * Thrown by the shared resilience core when the `breaker:railway` circuit is
 * open, i.e. the Vercel→Railway seam short-circuits without issuing a request.
 *
 * The message is STATIC by design (threat T-140-05): it carries no upstream
 * URL, no header name, no Python traceback, and no request detail. Route
 * handlers map this to a 503 with their own client-contract copy; the only
 * dynamic value exposed is `retryAfterS`, which is the breaker cooldown TTL and
 * is the same class of information `rateLimitDenyJson` already publishes in its
 * `Retry-After` header.
 */
export class CircuitOpenError extends Error {
  /** Seconds until the breaker's open-lock TTL expires (the half-open moment). */
  readonly retryAfterS: number;

  constructor(retryAfterS: number) {
    super("Analytics service circuit is open");
    this.name = "CircuitOpenError";
    this.retryAfterS = retryAfterS;
  }
}

/**
 * Thrown when the analytics service does not respond within its `SEAM_BUDGETS`
 * deadline. A request WAS issued and the deadline fired.
 *
 * HOMED HERE, NOT IN `analytics-client` (Phase 140 review / WR-01). It lives in
 * the leaf for the same two reasons `CircuitOpenError` does — the wizard
 * classifier must be able to branch on it without dragging `@upstash/*` into
 * ten `"use client"` bundles, and `instanceof` must survive the sixteen route
 * test files that mock `@/lib/analytics-client` wholesale. `analytics-client`
 * re-exports it, so every existing importer is unchanged and there is still
 * exactly ONE class identity in the process.
 *
 * WHY THE CLASSIFIER NEEDS THE TYPE: the message reads "Analytics service timed
 * out after 15000ms on /api/validate-key". The wizard's substring cascade tests
 * `includes("timeout")` — with no space — so this message matched NOTHING and a
 * plain Railway slowdown fell through to `UNKNOWN`/500, the "our team has been
 * notified" dead end. Text is the wrong join key between two modules.
 */
export class AnalyticsTimeoutError extends Error {
  constructor(path: string, timeoutMs: number) {
    super(`Analytics service timed out after ${timeoutMs}ms on ${path}`);
    this.name = "AnalyticsTimeoutError";
  }
}

/**
 * Thrown when the connection to the analytics service never completed at all —
 * DNS failure, connection refused, TLS error, socket reset. Distinct from
 * `AnalyticsTimeoutError` (a request was issued and ran out of time) and from
 * `CircuitOpenError` (we deliberately declined to issue one).
 *
 * Phase 140 review / WR-01: this used to be a bare `new Error(...)` whose
 * message matched no branch of the wizard's substring cascade, so a plain
 * Railway outage — the ordinary case, since 5 failures in 30s is unreachable at
 * human retry cadence and the breaker therefore does NOT trip — rendered as
 * `UNKNOWN`/500 with no retry affordance. The message is preserved verbatim so
 * nothing that reads it changes; the TYPE is what the classifier now uses.
 */
export class AnalyticsUnreachableError extends Error {
  /**
   * D-1 — the ORIGINAL transport error, threaded through as `cause`.
   *
   * This class is minted in `analytics-client`'s catch arm from a `fetch`
   * rejection that carries the only diagnosis anyone will ever get:
   * `ECONNREFUSED` vs an expired TLS certificate vs a DNS `EAI_AGAIN` are four
   * completely different incidents with four different responders, and undici
   * distinguishes them ONLY on `.cause`. Minting a fresh Error and discarding
   * the original collapsed all of them into one static sentence, so the
   * server log said "not reachable" and nothing else.
   *
   * Optional so the zero-arg construction in existing tests still compiles.
   */
  constructor(cause?: unknown) {
    super("Analytics service is not reachable. Please ensure it is running.", {
      ...(cause !== undefined && { cause }),
    });
    this.name = "AnalyticsUnreachableError";
  }
}

/**
 * Thrown when the analytics service returns a non-2xx HTTP response.
 * Preserves the upstream status so route handlers can forward 4xx semantics
 * (e.g. 400 "already in portfolio", 404 "not found") instead of flattening
 * every upstream error to 500.
 */
export class AnalyticsUpstreamError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "AnalyticsUpstreamError";
    // H-1144: the documented contract is "preserve the UPSTREAM status so route
    // handlers can forward it as the HTTP response code". Guard the invariant at
    // construction so a malformed status (NaN, non-integer, or out of the
    // 100–599 HTTP range) fails loud here rather than surfacing downstream as an
    // invalid `NextResponse` status. All current callers pass `res.status`
    // (already a valid integer), so this never fires in practice — it's a
    // fail-loud fence against a future caller passing an unchecked number.
    if (!Number.isInteger(status) || status < 100 || status > 599) {
      throw new RangeError(
        `AnalyticsUpstreamError: invalid HTTP status ${status} (expected an integer 100–599)`,
      );
    }
    this.status = status;
  }
}

/**
 * Did this thrown value mean "WE could not reach OUR OWN analytics service"?
 *
 * Phase 140 review / F-7. Callers that catch around a seam call need to tell
 * OUR outage apart from a genuine upstream/exchange fault, because the two get
 * opposite user copy: `SERVICE_UNAVAILABLE_RETRY` ("this is on our side, not
 * your key") versus `KEY_NETWORK_TIMEOUT` ("we could not reach the exchange").
 * Blaming a manager's exchange for a Railway outage sends them to audit a key
 * that was never the problem.
 *
 * Recognises the three shapes a seam transport failure can arrive in:
 *
 *  - the TYPED errors `analytics-client` mints (`AnalyticsTimeoutError`,
 *    `AnalyticsUnreachableError`);
 *  - a RAW deadline rejection, for callers like `finalize-wizard`'s probe that
 *    use the core directly and therefore receive whatever `fetch` threw,
 *    unwrapped. Both `Error` and `DOMException` are accepted because jsdom's
 *    `DOMException` does not extend `Error` while Node's does — an
 *    `instanceof Error`-only guard looks right in production and silently
 *    misclassifies every timeout under vitest;
 *  - undici's network failure, which is ALWAYS `TypeError("fetch failed")`
 *    (verified on Node 22 and Node 25 for ECONNREFUSED, DNS and TLS). A
 *    `TypeError` with any other message is a request WE built wrong — a caller
 *    fault that says nothing about anyone's availability — and is deliberately
 *    excluded, matching the core's own D-9 classification.
 *
 * `CircuitOpenError` is NOT included: it means we declined to issue a request
 * at all, carries its own `retryAfterS`, and every call site branches on it
 * first to publish a `Retry-After`. Folding it in here would silently discard
 * that hint.
 */
export function isSeamTransportFailure(err: unknown): boolean {
  if (
    err instanceof AnalyticsTimeoutError ||
    err instanceof AnalyticsUnreachableError
  ) {
    return true;
  }
  if (err instanceof TypeError) return err.message === "fetch failed";
  if (err instanceof Error || err instanceof DOMException) {
    return err.name === "AbortError" || err.name === "TimeoutError";
  }
  return false;
}
