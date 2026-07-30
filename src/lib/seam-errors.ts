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
    // Phase 140.2-11 / SEAMCORE-11 (A-15): fail loud on a value this class
    // cannot honestly publish. `AnalyticsUpstreamError`, sixty lines away in
    // `analytics-client.ts`, already `RangeError`s on a malformed HTTP status
    // for exactly this reason — the value is forwarded onto the wire. This one
    // is forwarded as a `Retry-After` HEADER by both seam clients
    // (`String(err.retryAfterS)`), to callers including the anonymous
    // verify-strategy teaser, and it accepted anything: `new
    // CircuitOpenError(NaN)` put the bytes `Retry-After: NaN` on the wire.
    //
    // The shape is the sibling's: `Number.isInteger` (which rejects NaN,
    // ±Infinity, a fractional value and every non-number without coercing)
    // plus a range check. `Retry-After` is RFC-7231 delta-seconds, so a
    // fractional value is as malformed as a NaN.
    //
    // NOT A CLAMP, DELIBERATELY. The value comes from a store read
    // (`isBreakerOpen` → `Math.ceil((lock.expiresAtMs - now) / 1000)`, an
    // encoded expiry since plan 140.2-07). Substituting 0 or the default
    // cooldown would publish a plausible header and leave the broken read
    // looking like a working one, with nothing downstream able to tell the
    // difference. Every production caller passes a strictly-positive integer.
    if (!Number.isInteger(retryAfterS) || retryAfterS < 0) {
      throw new RangeError(
        `CircuitOpenError: invalid retryAfterS ${String(retryAfterS)} (expected a non-negative integer number of seconds)`,
      );
    }
    this.retryAfterS = retryAfterS;
  }
}

/**
 * Phase 140.2 / SEAMCORE-02 — thrown by the shared resilience core when reading
 * the RESPONSE BODY fails.
 *
 * WHY A SECOND CLASS RATHER THAN RETHROWING THE ORIGINAL. `AbortSignal.timeout`
 * aborts the response STREAM, not just the header exchange, so the modal Railway
 * degradation — headers fast, body slow — resolves `fetch` and then rejects
 * later, inside the caller's `res.json()`. Before this class the rejection was a
 * raw `DOMException` escaping every client's `instanceof` ladder: the deadline
 * arm had already been passed, so a genuine timeout surfaced as an unclassified
 * crash and the breaker was never told. The core now reads the body inside its
 * own classification window and throws THIS, so a body-read failure is as typed
 * and as attributable as a transport failure.
 *
 * The message is STATIC for the same T-140-05 reason as `CircuitOpenError`: the
 * unauthenticated landing-page teaser reaches this seam, so no upstream URL, no
 * header name, no traceback and no request detail may appear in it. The
 * diagnosable half is the server log next to the budget key, plus `cause`, which
 * is the ORIGINAL rejection and is never rendered.
 */
export class SeamBodyReadError extends Error {
  /**
   * True when the failure was the wall-clock deadline firing mid-stream
   * (`AbortError` / `TimeoutError`), false for any other body-read failure.
   *
   * Callers map this onto the taxonomy they ALREADY have — the analytics client
   * onto `AnalyticsTimeoutError` vs "not reachable", the process-key client onto
   * its existing `UPSTREAM_TIMEOUT` 504 vs `UPSTREAM_NETWORK_ERROR` 502 — so no
   * new user-facing copy exists for this class anywhere.
   */
  readonly deadlineExceeded: boolean;

  constructor(deadlineExceeded: boolean, cause: unknown) {
    super("Analytics service response body could not be read", { cause });
    this.name = "SeamBodyReadError";
    this.deadlineExceeded = deadlineExceeded;
  }
}
