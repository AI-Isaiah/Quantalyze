const ANALYTICS_URL = process.env.ANALYTICS_SERVICE_URL ?? "http://localhost:8000";
const SERVICE_KEY = process.env.ANALYTICS_SERVICE_KEY ?? "";

async function analyticsRequest(path: string, body: Record<string, unknown>) {
  const res = await fetch(`${ANALYTICS_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(SERVICE_KEY && { "X-Service-Key": SERVICE_KEY }),
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(error.detail ?? "Analytics service error");
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
