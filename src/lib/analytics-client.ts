import type { z } from "zod";
import {
  ValidateKeyResponseSchema,
  EncryptKeyResponseSchema,
  FetchTradesResponseSchema,
  ComputeAnalyticsResponseSchema,
  PortfolioAnalyticsResponseSchema,
  PortfolioOptimizerResponseSchema,
  VerifyStrategyResponseSchema,
  RecomputeMatchResponseSchema,
  BridgeResponseSchema,
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
  options?: { timeoutMs?: number; method?: string },
) {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const method = options?.method ?? "POST";

  let res: Response;
  try {
    res = await fetch(`${ANALYTICS_URL}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        "X-Api-Version": ANALYTICS_API_VERSION,
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

export async function computeAnalytics(strategyId: string) {
  const data = await analyticsRequest("/api/compute-analytics", { strategy_id: strategyId });
  return parseResponse(ComputeAnalyticsResponseSchema, data, "/api/compute-analytics");
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

export async function computePortfolioAnalytics(portfolioId: string) {
  const data = await analyticsRequest("/api/portfolio-analytics", { portfolio_id: portfolioId });
  return parseResponse(PortfolioAnalyticsResponseSchema, data, "/api/portfolio-analytics");
}

export async function runPortfolioOptimizer(portfolioId: string, timeoutMs?: number) {
  const data = await analyticsRequest(
    "/api/portfolio-optimizer",
    { portfolio_id: portfolioId },
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

export async function recomputeMatch(allocatorId: string, force = false) {
  const data = await analyticsRequest("/api/match/recompute", {
    allocator_id: allocatorId,
    force,
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
