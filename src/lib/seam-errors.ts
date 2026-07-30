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
