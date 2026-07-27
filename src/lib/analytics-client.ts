import type { z } from "zod";
import {
  ValidateKeyResponseSchema,
  EncryptKeyResponseSchema,
  PortfolioAnalyticsResponseSchema,
  PortfolioOptimizerResponseSchema,
  RecomputeMatchResponseSchema,
  BridgeResponseSchema,
  OptimizeWeightsResponseSchema,
  type OptimizeWeightsResponse,
} from "./analytics-schemas";
import { SimulatorResponseSchema } from "./api/simulatorSchema";
import {
  resilientFetch,
  SEAM_BUDGETS,
  type SeamBudgetKey,
  type SeamResponse,
} from "./resilient-fetch";
import { CircuitOpenError, SeamBodyReadError } from "./seam-errors";
import { scrubSeamString } from "./seam-redaction";

const SERVICE_KEY = process.env.ANALYTICS_SERVICE_KEY ?? "";

/** Client-side API contract version. Sent as X-Api-Version on every request. */
export const ANALYTICS_API_VERSION = "1";

/**
 * Phase 140 / SEAM-01 — back-compat convenience re-export ONLY.
 *
 * ⚠️ The canonical import path for `CircuitOpenError` is `@/lib/seam-errors`,
 * the dependency-free leaf. Nothing may rely on picking the class up through
 * THIS module: sixteen route test files `vi.mock("@/lib/analytics-client")`,
 * and seven of the eight seam-mocking files use a FULL factory with no
 * `importActual`. Through those mocks this re-export is `undefined`, and
 * `err instanceof undefined` throws `TypeError` from inside a catch block —
 * turning a clean 503 into a crash. Production code, route handlers, wizard
 * error classification and tests all import from the leaf.
 */
export { CircuitOpenError };

/** Thrown when the analytics service does not respond within the timeout. */
export class AnalyticsTimeoutError extends Error {
  constructor(path: string, timeoutMs: number) {
    super(`Analytics service timed out after ${timeoutMs}ms on ${path}`);
    this.name = "AnalyticsTimeoutError";
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
 * The "connection never completed" copy, extracted so the transport arm and the
 * body-read arm below cannot drift apart. Byte-identical to what this module
 * has always thrown — plan 140.2-05 authors NO new user-facing copy; 140.3 owns
 * the client-facing surface.
 */
const NOT_REACHABLE_MESSAGE =
  "Analytics service is not reachable. Please ensure it is running.";

/**
 * Map a `SeamBodyReadError` onto the taxonomy this module ALREADY has.
 *
 * The core records the breaker failure and throws this class from inside its
 * classification window; the nine wrapper consumers must keep seeing only
 * `AnalyticsTimeoutError`, `AnalyticsUpstreamError`, `CircuitOpenError` and the
 * generic not-reachable `Error` — a new type escaping here would reach every
 * caller with no arm for it. `deadlineExceeded` is the only discriminator, and
 * it means exactly what the transport arm's own name test means, because the
 * core derives both from one definition.
 *
 * Anything that is NOT a body-read failure is rethrown untouched: this helper
 * classifies, it does not swallow.
 */
function mapBodyReadFailure(err: unknown, path: string, timeoutMs: number): never {
  if (err instanceof SeamBodyReadError) {
    if (err.deadlineExceeded) {
      throw new AnalyticsTimeoutError(path, timeoutMs);
    }
    throw new Error(NOT_REACHABLE_MESSAGE);
  }
  throw err;
}

/**
 * Core fetch wrapper for the Python analytics service.
 *
 * Phase 140 / SEAM-01: the transport itself now lives in `resilient-fetch.ts`
 * — the ONE place that owns the base URL, the wall-clock budget, and the
 * `breaker:railway` circuit. This function keeps everything that is genuinely
 * analytics-client policy: header construction, the API-version drift warning,
 * and the `!ok` → `AnalyticsUpstreamError` translation the core deliberately
 * does not perform (only the caller knows whether a 404 is an error).
 *
 * @param path    - URL path (e.g. "/api/compute-analytics")
 * @param body    - JSON body to POST
 * @param options - `budgetKey` is REQUIRED: it names this call site's row in
 *                  `SEAM_BUDGETS`, which is the single owner of its deadline.
 *                  `timeoutMs` overrides the table for one call — TESTS ONLY
 *                  since 140-05 removed the last production override (the
 *                  optimizer route's legacy constant). `method` defaults to
 *                  "POST".
 */
async function analyticsRequest(
  path: string,
  body: Record<string, unknown> | null,
  options: {
    budgetKey: SeamBudgetKey;
    timeoutMs?: number;
    method?: string;
    correlationId?: string;
  },
) {
  // Resolved locally as well as inside the core, because AnalyticsTimeoutError's
  // message quotes the deadline that actually fired.
  const timeoutMs = options.timeoutMs ?? SEAM_BUDGETS[options.budgetKey].timeoutMs;
  const method = options.method ?? "POST";
  // Phase 16 / OBSERV-01: stamp X-Correlation-Id on every outbound fetch.
  // Wrappers (validateKey, encryptKey, ...) intentionally do NOT thread
  // this option through in this plan — Plan 7 wires the SSE endpoint to pass
  // it explicitly. Until then, every request still carries a UUID v4 so the
  // FastAPI side has a stable join key.
  const correlationId = options.correlationId ?? crypto.randomUUID();

  // SEAMCORE-02: the core returns a `SeamResponse`, whose `json()` / `text()`
  // run inside its classification window. The surface is the closed set this
  // function already used (`ok`, `status`, `statusText`, `headers.get`, `json`,
  // `text`); nothing here reaches for a `Response`-only member.
  let res: SeamResponse;
  try {
    // Headers are built HERE and passed through the core byte-for-byte. A
    // dropped X-Service-Key silently unauthenticates every analytics call.
    res = await resilientFetch(options.budgetKey, path, {
      method,
      headers: {
        "Content-Type": "application/json",
        "X-Api-Version": ANALYTICS_API_VERSION,
        "X-Correlation-Id": correlationId,
        ...(SERVICE_KEY && { "X-Service-Key": SERVICE_KEY }),
      },
      ...(body !== null && { body: JSON.stringify(body) }),
      ...(options.timeoutMs !== undefined && {
        timeoutMsOverride: options.timeoutMs,
      }),
    });
  } catch (err) {
    // ORDER IS LOAD-BEARING.
    //
    // 1. CircuitOpenError rethrown UNWRAPPED and FIRST. Route handlers branch
    //    on it to emit the SEAM-04 503 + Retry-After envelope; if the generic
    //    arm below swallowed it, every breaker trip would surface to the user
    //    as "the analytics service is not reachable" and the entire circuit
    //    feature would be invisible.
    if (err instanceof CircuitOpenError) {
      throw err;
    }
    // 2. Deadline exceeded. STRICTLY BROADER than the pre-140 check
    //    (`err instanceof DOMException && name === "TimeoutError"`): a plain
    //    Error named "AbortError" is the shape a client-side abort produces,
    //    and it used to be misreported as a dead service rather than a slow
    //    one.
    //
    //    ⚠️ The shape guard must accept BOTH `Error` and `DOMException`, not
    //    `Error` alone. Node's DOMException extends Error (production), but
    //    jsdom's does NOT — and the core's timeout signal rejects with a
    //    DOMException. An `instanceof Error`-only guard therefore looks
    //    correct in production while silently reclassifying every timeout as
    //    "not reachable" in the vitest environment. Pinned by the
    //    "timeout (DOMException) throws AnalyticsTimeoutError" regression
    //    test in analytics-client.test.ts.
    if (
      (err instanceof Error || err instanceof DOMException) &&
      (err.name === "AbortError" || err.name === "TimeoutError")
    ) {
      throw new AnalyticsTimeoutError(path, timeoutMs);
    }
    // 3. Everything else: the connection never completed.
    throw new Error(NOT_REACHABLE_MESSAGE);
  }

  // Warn on API version mismatch (don't fail — just surface contract drift).
  const serverVersion = res.headers.get("X-Api-Version");
  if (serverVersion && serverVersion !== ANALYTICS_API_VERSION) {
    console.warn(
      `[analytics-client] API version mismatch: client=${ANALYTICS_API_VERSION}, server=${serverVersion}`,
    );
  }

  if (!res.ok) {
    const contentType = res.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      // TWO CASES, conflated before SEAMCORE-02. A body that is genuinely
      // absent or unparseable KEEPS the fallback — a 500 whose body is not the
      // JSON its content-type promised is real, and `{ detail: statusText }` is
      // the right answer for it. An ABORT is not: the core has already recorded
      // that failure against the breaker, so converting it into a fabricated
      // body would report a dying Railway as a well-formed upstream error.
      const error = await res.json().catch((err: unknown) => {
        if (err instanceof SeamBodyReadError) {
          mapBodyReadFailure(err, path, timeoutMs);
        }
        return { detail: res.statusText };
      });
      throw new AnalyticsUpstreamError(
        error.detail ?? "Analytics service error",
        res.status,
      );
    }
    // Non-JSON error (FastAPI unhandled exception returns text/plain).
    // Same distinction as above: an unreadable text/plain body falls back to
    // the status text, an abort does not.
    const text = await res.text().catch((err: unknown) => {
      if (err instanceof SeamBodyReadError) {
        mapBodyReadFailure(err, path, timeoutMs);
      }
      return res.statusText;
    });
    throw new AnalyticsUpstreamError(
      text || `Analytics service error (${res.status})`,
      res.status,
    );
  }

  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    throw new Error("Analytics service returned an unexpected response. Is it running on the correct port?");
  }

  // THE SUCCESS ARM HAD NO CATCH AT ALL. This is SC1's downstream half: the
  // deadline can fire while the body streams, long after the transport `try`
  // above has closed, so the raw rejection escaped `analyticsRequest` past
  // every `instanceof` arm at the top of this function and surfaced to nine
  // wrappers as an unclassified crash.
  try {
    return await res.json();
  } catch (err) {
    mapBodyReadFailure(err, path, timeoutMs);
  }
}

/**
 * Parse an analytics response against a Zod schema. Logs a warning on
 * validation failure and returns the raw data so existing call sites
 * don't break on unexpected extra fields. The warning gives operators
 * a loud signal that contract drift has occurred.
 */
function parseResponse<T>(
  schema: z.ZodType<T>,
  data: unknown,
  endpoint: string,
): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    // SEAMCORE-06 — a zod issue array is error-DERIVED and can echo
    // request-derived values back into the line (a `received` field on a
    // credential-shaped input, an unexpected key carrying a token). Rendered to
    // a string first so the scrub can see it: passing the array straight to
    // `console.error` hands the runtime an object the leaf never inspected.
    console.error(
      `[analytics-client] Contract validation failed for ${endpoint}:`,
      scrubSeamString(JSON.stringify(result.error.issues)),
    );
    // Throw so callers get a clear error rather than silently wrong data.
    throw new Error(
      `Analytics response contract violation on ${endpoint}: ${result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
    );
  }
  return result.data;
}

// DOGFOOD (2026-07-18): exchange API keys/secrets are whitespace-free tokens
// (Deribit ClientId/ClientSecret, Binance 64-hex, …). A stray leading/trailing
// space or newline from a copy-paste makes the exchange reject an otherwise
// CORRECT key with an auth error (observed: Deribit 13004 invalid_credentials
// on a live production key), which reads to the user as "my correct key is
// broken". Trim here — the single chokepoint every key-entry route funnels
// through (create-with-key, composite/add-key, keys/validate-and-encrypt) — so
// validate and encrypt normalise IDENTICALLY: the ciphertext we store is the
// exact trimmed credential we validated, so later syncs authenticate too.
// Passphrase is NOT trimmed: an OKX passphrase is user-CHOSEN and whitespace
// there could be significant.
function trimCredential(value: string): string {
  return value.trim();
}

export async function validateKey(exchange: string, apiKey: string, apiSecret: string, passphrase?: string) {
  const data = await analyticsRequest(
    "/api/validate-key",
    {
      exchange,
      api_key: trimCredential(apiKey),
      api_secret: trimCredential(apiSecret),
      passphrase: passphrase ?? null,
    },
    { budgetKey: "validate-key" },
  );
  return parseResponse(ValidateKeyResponseSchema, data, "/api/validate-key");
}

export async function encryptKey(exchange: string, apiKey: string, apiSecret: string, passphrase?: string) {
  const data = await analyticsRequest(
    "/api/encrypt-key",
    {
      exchange,
      api_key: trimCredential(apiKey),
      api_secret: trimCredential(apiSecret),
      passphrase: passphrase ?? null,
    },
    { budgetKey: "encrypt-key" },
  );
  return parseResponse(EncryptKeyResponseSchema, data, "/api/encrypt-key");
}

/**
 * Phase 28 (OPT-01/02) — request suggested long-only scenario weights from the
 * Python optimizer. `series` is the draft-scoped strategies' daily-return series
 * (id -> [{date, value}]); the Next route (allocator-authed) forwards ONLY the
 * caller's own series. Returns `weights: null` on a degenerate / under-sampled
 * input (the UI renders the honest empty state) — never a fabricated vector.
 * The weights are fit IN-SAMPLE (`in_sample: true`); the UI discloses that.
 */
export async function optimizeScenarioWeights(
  series: Record<string, Array<{ date: string; value: number }>>,
  objective: "min_vol" | "max_sharpe",
): Promise<OptimizeWeightsResponse> {
  const data = await analyticsRequest(
    "/api/optimize-weights",
    { series, objective },
    { budgetKey: "optimize-weights" },
  );
  return parseResponse(OptimizeWeightsResponseSchema, data, "/api/optimize-weights");
}

/**
 * C-PR5-01 remainder (audit-2026-05-07, follow-up to PR #347).
 *
 * `actorId` (the authenticated user's id) is now REQUIRED on both analytics
 * compute calls. It maps to the Python service's `req.user_id` parameter
 * which the handler uses as the second ownership gate
 * (`portfolios.user_id = req.user_id`) — the only defense against an
 * X-Service-Key holder forging a request for another tenant's portfolio.
 * The relaxed Optional[str] back-compat path in
 * `analytics-service/models/schemas.py` was the C-PR5-01 attack surface
 * identified by the PR-5 security review; tightening this signature on
 * the TS side ensures the route can't drift back to the broken state.
 *
 * Symmetric to `recomputeMatch(allocatorId, force, actorId)` which closed
 * the same shape on the match endpoint via PR #347.
 */
export async function computePortfolioAnalytics(
  portfolioId: string,
  actorId: string,
) {
  const data = await analyticsRequest(
    "/api/portfolio-analytics",
    {
      portfolio_id: portfolioId,
      user_id: actorId,
    },
    { budgetKey: "portfolio-analytics" },
  );
  return parseResponse(PortfolioAnalyticsResponseSchema, data, "/api/portfolio-analytics");
}

export async function runPortfolioOptimizer(portfolioId: string, actorId: string) {
  const data = await analyticsRequest(
    "/api/portfolio-optimizer",
    { portfolio_id: portfolioId, user_id: actorId },
    // Phase 140 / SEAM-02: no timeout override. This wrapper carried an
    // optional `timeoutMs` third parameter purely so the route could keep
    // passing its legacy `OPTIMIZER_TIMEOUT_MS = 15_000`; 140-05 deleted that
    // route-local constant (the only caller), so the parameter went with it.
    // The deadline now has exactly ONE owner: the row below.
    { budgetKey: "portfolio-optimizer" },
  );
  return parseResponse(PortfolioOptimizerResponseSchema, data, "/api/portfolio-optimizer");
}

export async function findReplacementCandidates(
  portfolioId: string,
  underperformerStrategyId: string,
  userId: string,
) {
  const data = await analyticsRequest(
    "/api/portfolio-bridge",
    {
      portfolio_id: portfolioId,
      underperformer_strategy_id: underperformerStrategyId,
      user_id: userId,
    },
    { budgetKey: "bridge" },
  );
  return parseResponse(BridgeResponseSchema, data, "/api/portfolio-bridge");
}

/**
 * Sprint 6 Task 6.4 — portfolio impact simulator (ADD scenario).
 *
 * Calls the Python `/api/simulator` endpoint under the `simulator` budget
 * (SEAM_BUDGETS owns the value; it was a 15s literal here before Phase 140).
 * Response is validated against SimulatorResponseSchema — parse failures
 * throw so contract drift is loud.
 */
export async function simulateAddCandidate(
  portfolioId: string,
  candidateStrategyId: string,
  userId: string,
) {
  const data = await analyticsRequest(
    "/api/simulator",
    {
      portfolio_id: portfolioId,
      candidate_strategy_id: candidateStrategyId,
      user_id: userId,
    },
    { budgetKey: "simulator" },
  );
  return parseResponse(
    SimulatorResponseSchema,
    data,
    "/api/simulator",
  );
}

export async function recomputeMatch(
  allocatorId: string,
  force: boolean,
  actorId: string,
) {
  // C-PR5-01 (audit-2026-05-07): `actorId` is the authenticated user's
  // id (`supabase.auth.getUser().user.id`). Forwarding it lets
  // analytics-service assert the actor is allowed to recompute this
  // allocator (either actor == allocator or actor is an admin profile)
  // — defense-in-depth against any future Next.js route that drops the
  // admin gate before calling this client. Required at the TS-side
  // signature so every call site MUST compile with the binding
  // threaded through; a refactor that drops it fails the build before
  // it can ship.
  //
  // The Python schema accepts `actor_id` as optional for backward
  // compat with non-Next.js callers (cron handlers, debug scripts)
  // during the production rollout. Once every call site is TS-side
  // (post-this-PR rollout), the Python field can be promoted to
  // required in a follow-up PR.
  const data = await analyticsRequest(
    "/api/match/recompute",
    {
      allocator_id: allocatorId,
      force,
      actor_id: actorId,
    },
    { budgetKey: "match-recompute" },
  );
  return parseResponse(RecomputeMatchResponseSchema, data, "/api/match/recompute");
}

export async function evalMatch(params: {
  lookback_days: string;
  partner_tag?: string;
}) {
  const qs = new URLSearchParams({ lookback_days: params.lookback_days });
  if (params.partner_tag) qs.set("partner_tag", params.partner_tag);
  // evalMatch has no fixed schema — it returns variable evaluation data.
  // Validation can be added when the eval response shape stabilizes.
  return analyticsRequest(`/api/match/eval?${qs.toString()}`, null, {
    budgetKey: "match-eval",
    method: "GET",
  });
}

// @internal — exposed for Phase 16 / OBSERV-01 unit tests only. Public
// wrappers (validateKey, encryptKey, ...) intentionally do NOT
// expose `correlationId` per plan Task 1 Step B (minimize blast radius;
// Plan 7 wires the SSE endpoint to pass it explicitly). Production code
// MUST NOT import this — use the public wrappers above instead.
export const __INTERNAL_analyticsRequest = analyticsRequest;
