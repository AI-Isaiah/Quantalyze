/**
 * Per-exchange rate-limit cooldown (seconds) — client-side mirror of
 * `EXCHANGE_COOLDOWNS` in `analytics-service/services/job_worker.py:66`.
 *
 * When the Python worker catches a `ccxt.RateLimitExceeded` (429), it
 * stamps `api_keys.last_429_at = now()` via `update_api_key_rate_limit`
 * (migration 032) and defers the job. The UI needs to know the same
 * cooldown window to render the `rate_limited` pill's "retry in Ns"
 * countdown.
 *
 * Keep this map in sync with the Python side. A mismatch would show the
 * user a countdown that doesn't match when the worker actually retries.
 *
 * Default: 120s for any exchange not explicitly listed — matches Python's
 * `EXCHANGE_COOLDOWNS.get(exchange, 120)` fallback.
 */
export const EXCHANGE_COOLDOWN_SECONDS: Record<string, number> = {
  binance: 120, // 2 minutes
  okx: 300, // 5 minutes
  bybit: 600, // 10 minutes
};

export const DEFAULT_EXCHANGE_COOLDOWN_SECONDS = 120;

/**
 * Compute retry-in-seconds for the `rate_limited` pill given the
 * server-stamped `last_429_at` and the exchange. Returns undefined when
 * the timestamp is missing so AllocatorSyncStatus can distinguish
 * "no data" (show "retry in 0s") from "we know exactly".
 */
export function computeRetryAtSeconds(
  exchange: string,
  last429At: string | null | undefined,
): number | undefined {
  if (!last429At) return undefined;
  const ts = new Date(last429At).getTime();
  if (Number.isNaN(ts)) return undefined;
  const cooldown =
    EXCHANGE_COOLDOWN_SECONDS[exchange] ?? DEFAULT_EXCHANGE_COOLDOWN_SECONDS;
  return Math.max(
    0,
    Math.floor((ts + cooldown * 1000 - Date.now()) / 1000),
  );
}
