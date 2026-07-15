import type { z } from "zod";
import {
  ValidateKeyResponseSchema,
  EncryptKeyResponseSchema,
  FetchTradesResponseSchema,
  PortfolioAnalyticsResponseSchema,
  PortfolioOptimizerResponseSchema,
  VerifyStrategyResponseSchema,
  RecomputeMatchResponseSchema,
  BridgeResponseSchema,
  CsvValidateResponseSchema,
  type CsvValidateResponse,
  OptimizeWeightsResponseSchema,
  type OptimizeWeightsResponse,
} from "./analytics-schemas";
import { SimulatorResponseSchema } from "./api/simulatorSchema";

const ANALYTICS_URL = process.env.ANALYTICS_SERVICE_URL ?? "http://localhost:8002";
const SERVICE_KEY = process.env.ANALYTICS_SERVICE_KEY ?? "";

/** Client-side API contract version. Sent as X-Api-Version on every request. */
export const ANALYTICS_API_VERSION = "1";

const DEFAULT_TIMEOUT_MS = 30_000;

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
 * Core fetch wrapper for the Python analytics service.
 *
 * @param path    - URL path (e.g. "/api/compute-analytics")
 * @param body    - JSON body to POST
 * @param options - Optional overrides. `timeoutMs` defaults to 30s.
 *                  `method` defaults to "POST".
 */
async function analyticsRequest(
  path: string,
  body: Record<string, unknown> | null,
  options?: { timeoutMs?: number; method?: string; correlationId?: string },
) {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const method = options?.method ?? "POST";
  // Phase 16 / OBSERV-01: stamp X-Correlation-Id on every outbound fetch.
  // Wrappers (validateKey, fetchTrades, ...) intentionally do NOT thread
  // this option through in this plan — Plan 7 wires the SSE endpoint to pass
  // it explicitly. Until then, every request still carries a UUID v4 so the
  // FastAPI side has a stable join key.
  const correlationId = options?.correlationId ?? crypto.randomUUID();

  let res: Response;
  try {
    res = await fetch(`${ANALYTICS_URL}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        "X-Api-Version": ANALYTICS_API_VERSION,
        "X-Correlation-Id": correlationId,
        ...(SERVICE_KEY && { "X-Service-Key": SERVICE_KEY }),
      },
      ...(body !== null && { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "TimeoutError") {
      throw new AnalyticsTimeoutError(path, timeoutMs);
    }
    throw new Error("Analytics service is not reachable. Please ensure it is running.");
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
      const error = await res.json().catch(() => ({ detail: res.statusText }));
      throw new AnalyticsUpstreamError(
        error.detail ?? "Analytics service error",
        res.status,
      );
    }
    // Non-JSON error (FastAPI unhandled exception returns text/plain)
    const text = await res.text().catch(() => res.statusText);
    throw new AnalyticsUpstreamError(
      text || `Analytics service error (${res.status})`,
      res.status,
    );
  }

  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    throw new Error("Analytics service returned an unexpected response. Is it running on the correct port?");
  }

  return res.json();
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
    console.error(
      `[analytics-client] Contract validation failed for ${endpoint}:`,
      result.error.issues,
    );
    // Throw so callers get a clear error rather than silently wrong data.
    throw new Error(
      `Analytics response contract violation on ${endpoint}: ${result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
    );
  }
  return result.data;
}

export async function fetchTrades(strategyId: string) {
  const data = await analyticsRequest("/api/fetch-trades", { strategy_id: strategyId });
  return parseResponse(FetchTradesResponseSchema, data, "/api/fetch-trades");
}

export async function validateKey(exchange: string, apiKey: string, apiSecret: string, passphrase?: string) {
  const data = await analyticsRequest("/api/validate-key", {
    exchange,
    api_key: apiKey,
    api_secret: apiSecret,
    passphrase: passphrase ?? null,
  });
  return parseResponse(ValidateKeyResponseSchema, data, "/api/validate-key");
}

export async function encryptKey(exchange: string, apiKey: string, apiSecret: string, passphrase?: string) {
  const data = await analyticsRequest("/api/encrypt-key", {
    exchange,
    api_key: apiKey,
    api_secret: apiSecret,
    passphrase: passphrase ?? null,
  });
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
  const data = await analyticsRequest("/api/optimize-weights", { series, objective });
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
  const data = await analyticsRequest("/api/portfolio-analytics", {
    portfolio_id: portfolioId,
    user_id: actorId,
  });
  return parseResponse(PortfolioAnalyticsResponseSchema, data, "/api/portfolio-analytics");
}

export async function runPortfolioOptimizer(
  portfolioId: string,
  actorId: string,
  timeoutMs?: number,
) {
  const data = await analyticsRequest(
    "/api/portfolio-optimizer",
    { portfolio_id: portfolioId, user_id: actorId },
    timeoutMs ? { timeoutMs } : undefined,
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
    { timeoutMs: 15_000 },
  );
  return parseResponse(BridgeResponseSchema, data, "/api/portfolio-bridge");
}

/**
 * Sprint 6 Task 6.4 — portfolio impact simulator (ADD scenario).
 *
 * Calls the Python `/api/simulator` endpoint with a 15s timeout (matching
 * the Bridge and mirroring the 15s budget the Next.js route enforces).
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
    { timeoutMs: 15_000 },
  );
  return parseResponse(
    SimulatorResponseSchema,
    data,
    "/api/simulator",
  );
}

export async function verifyStrategy(data: {
  email: string;
  exchange: string;
  api_key: string;
  api_secret: string;
  passphrase?: string;
}) {
  const result = await analyticsRequest("/api/verify-strategy", data);
  return parseResponse(VerifyStrategyResponseSchema, result, "/api/verify-strategy");
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
  const data = await analyticsRequest("/api/match/recompute", {
    allocator_id: allocatorId,
    force,
    actor_id: actorId,
  });
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
    method: "GET",
  });
}

/**
 * Phase 15 / CSV-01..CSV-02: multipart proxy for the CSV row-schema validator.
 *
 * Cross-AI revision 2026-04-30: throws when ANALYTICS_SERVICE_URL is not
 * configured. The prior `?? "http://localhost:8002"` fallback was a foot-gun
 * — production deployments missing the env var would silently call localhost
 * and fail in confusing ways. Throwing here surfaces the misconfig at the
 * first request and lets the route layer translate to a CSV_UPSTREAM_FAIL
 * envelope.
 *
 * Multipart-specific: do NOT set Content-Type. The browser/Node `fetch` sets
 * the correct `multipart/form-data; boundary=...` when given a `FormData`
 * body. Adding our own Content-Type would strip the boundary and FastAPI
 * would 422 the request.
 */
export async function validateCsv(formData: FormData): Promise<CsvValidateResponse> {
  const url = process.env.ANALYTICS_SERVICE_URL;
  if (!url) {
    throw new Error("ANALYTICS_SERVICE_URL not configured");
  }
  const serviceKey = process.env.ANALYTICS_SERVICE_KEY ?? "";
  let res: Response;
  try {
    res = await fetch(`${url}/api/csv/validate`, {
      method: "POST",
      headers: {
        "X-Api-Version": ANALYTICS_API_VERSION,
        ...(serviceKey && { "X-Service-Key": serviceKey }),
        // No Content-Type — fetch sets the multipart boundary automatically.
      },
      body: formData,
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "TimeoutError") {
      throw new AnalyticsTimeoutError("/api/csv/validate", DEFAULT_TIMEOUT_MS);
    }
    throw new Error("Analytics service is not reachable. Please ensure it is running.");
  }

  if (!res.ok) {
    const contentType = res.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const error = await res.json().catch(() => ({ detail: res.statusText }));
      const detail = (error as { detail?: { code?: string; human_message?: string } | string })
        .detail;
      const message =
        typeof detail === "object" && detail !== null
          ? detail.human_message ?? "CSV validation failed"
          : typeof detail === "string"
            ? detail
            : (res.statusText || "CSV validation failed");
      throw new AnalyticsUpstreamError(message, res.status);
    }
    const text = await res.text().catch(() => res.statusText);
    throw new AnalyticsUpstreamError(
      text || `CSV validation failed (${res.status})`,
      res.status,
    );
  }

  const data = await res.json();
  return parseResponse(CsvValidateResponseSchema, data, "/api/csv/validate");
}

// @internal — exposed for Phase 16 / OBSERV-01 unit tests only. Public
// wrappers (validateKey, fetchTrades, ...) intentionally do NOT
// expose `correlationId` per plan Task 1 Step B (minimize blast radius;
// Plan 7 wires the SSE endpoint to pass it explicitly). Production code
// MUST NOT import this — use the public wrappers above instead.
export const __INTERNAL_analyticsRequest = analyticsRequest;
