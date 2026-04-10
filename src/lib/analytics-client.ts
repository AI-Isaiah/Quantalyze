const ANALYTICS_URL = process.env.ANALYTICS_SERVICE_URL ?? "http://localhost:8002";
const SERVICE_KEY = process.env.ANALYTICS_SERVICE_KEY ?? "";

const ANALYTICS_TIMEOUT_MS = 30_000;

async function analyticsRequest(path: string, body: Record<string, unknown>) {
  let res: Response;
  try {
    res = await fetch(`${ANALYTICS_URL}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(SERVICE_KEY && { "X-Service-Key": SERVICE_KEY }),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(ANALYTICS_TIMEOUT_MS),
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "TimeoutError") {
      throw new Error(`Analytics service timed out after ${ANALYTICS_TIMEOUT_MS}ms on ${path}`);
    }
    throw new Error("Analytics service is not reachable. Please ensure it is running.");
  }

  if (!res.ok) {
    const contentType = res.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const error = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(error.detail ?? "Analytics service error");
    }
    // Non-JSON error (FastAPI unhandled exception returns text/plain)
    const text = await res.text().catch(() => res.statusText);
    throw new Error(text || `Analytics service error (${res.status})`);
  }

  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    throw new Error("Analytics service returned an unexpected response. Is it running on the correct port?");
  }

  return res.json();
}

export async function computeAnalytics(strategyId: string) {
  return analyticsRequest("/api/compute-analytics", { strategy_id: strategyId });
}

export async function fetchTrades(strategyId: string) {
  return analyticsRequest("/api/fetch-trades", { strategy_id: strategyId });
}

export async function validateKey(exchange: string, apiKey: string, apiSecret: string, passphrase?: string) {
  return analyticsRequest("/api/validate-key", {
    exchange,
    api_key: apiKey,
    api_secret: apiSecret,
    passphrase: passphrase ?? null,
  });
}

export async function encryptKey(exchange: string, apiKey: string, apiSecret: string, passphrase?: string) {
  return analyticsRequest("/api/encrypt-key", {
    exchange,
    api_key: apiKey,
    api_secret: apiSecret,
    passphrase: passphrase ?? null,
  });
}

export async function computePortfolioAnalytics(portfolioId: string) {
  return analyticsRequest("/api/portfolio-analytics", { portfolio_id: portfolioId });
}

export async function runPortfolioOptimizer(portfolioId: string) {
  return analyticsRequest("/api/portfolio-optimizer", { portfolio_id: portfolioId });
}

export async function verifyStrategy(data: {
  email: string;
  exchange: string;
  api_key: string;
  api_secret: string;
  passphrase?: string;
}) {
  return analyticsRequest("/api/verify-strategy", data);
}

export async function recomputeMatch(allocatorId: string, force = false) {
  return analyticsRequest("/api/match/recompute", {
    allocator_id: allocatorId,
    force,
  });
}
