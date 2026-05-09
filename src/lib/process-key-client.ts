import { NextResponse } from "next/server";
import { getCorrelationId } from "@/lib/correlation-id";

/**
 * Phase 19 / M-3 — shared client for the unified `/process-key` upstream.
 *
 * Every Phase-19 thin adapter (verify-strategy, keys/sync, keys/validate-and-encrypt,
 * strategies/finalize-wizard, strategies/csv-validate, strategies/csv-finalize)
 * spoke this protocol locally with copy-pasted blocks:
 *
 *   1. Read `INTERNAL_API_TOKEN` env. If missing → 503 "Service unavailable".
 *   2. Resolve a correlation id (Sentry trace or random UUID).
 *   3. POST `${ANALYTICS_SERVICE_URL}/process-key` with
 *      `{ flow_type, source, context }` and a Bearer/X-Correlation-Id pair.
 *   4. Return the upstream response as a NextResponse, preserving status.
 *
 * Centralizing it here gives one place to thread observability, retries,
 * timeouts, or the eventual unified-encrypt branch without touching each
 * route. Each thin adapter now needs ~3 lines.
 *
 * Returned shape
 * --------------
 *   { ok: true, status, body }   on a successful upstream call (2xx)
 *   { ok: false, response }      on token-missing 503 or upstream non-2xx
 *
 * Callers that want a NextResponse directly can use `postProcessKey()` and
 * fall back to `result.response` when `ok === false`. Callers that need to
 * inspect/translate the body (e.g. API-9 / I-API1 response-shape mapping)
 * branch on `ok === true` and read `result.body`.
 */

const ANALYTICS_URL =
  process.env.ANALYTICS_SERVICE_URL ?? "http://localhost:8002";

export type FlowType = "teaser" | "onboard" | "resync" | "csv";

export interface PostProcessKeyArgs {
  flow_type: FlowType;
  source: string;
  context: Record<string, unknown>;
  /** Optional override; if omitted the helper resolves via `getCorrelationId()`. */
  correlationId?: string;
  /** Optional caller tag used in the 503 log line so failures are grep-able. */
  routeTag?: string;
  /**
   * CT-4 (army2) — required tenant identifier forwarded as `X-User-Id`
   * on the upstream POST. The Python rate limiter
   * (analytics-service/routers/process_key.py:_process_key_rate_limit_key)
   * keys on `(token_hash, X-User-Id)` so each user gets an isolated
   * 100/hour window. Pre-fix the header was never sent, so every request
   * bucketed to the same `process_key:<token_hash>:anon` key — one
   * tenant's burst could starve every other tenant.
   *
   * For unauthenticated public flows (the landing-page teaser) callers
   * MUST pass the literal string `'public'` so the limiter buckets all
   * anonymous traffic to a shared `process_key:<token_hash>:public`
   * window, isolated from any authenticated tenant.
   */
  userId: string;
}

export type PostProcessKeyResult =
  | { ok: true; status: number; body: unknown }
  | { ok: false; response: NextResponse };

/**
 * Single-source the `INTERNAL_API_TOKEN` 503 branch + the upstream POST.
 *
 * Returns a discriminated union so callers can either short-circuit with
 * `result.response` on failure, or branch on `result.body` on success
 * (needed for API-9 / I-API1 response-shape translation).
 */
export async function postProcessKey(
  args: PostProcessKeyArgs,
): Promise<PostProcessKeyResult> {
  const internalToken = process.env.INTERNAL_API_TOKEN;
  if (!internalToken) {
    const tag = args.routeTag ?? "process-key-client";
    console.error(`[${tag}] INTERNAL_API_TOKEN not configured`);
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Service unavailable" },
        { status: 503 },
      ),
    };
  }

  const correlationId = args.correlationId ?? (await getCorrelationId());
  const res = await fetch(`${ANALYTICS_URL}/process-key`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${internalToken}`,
      "X-Correlation-Id": correlationId,
      // CT-4 (army2) — forward tenant id for cross-tenant rate-limit
      // isolation. See PostProcessKeyArgs.userId for the contract.
      "X-User-Id": args.userId,
    },
    body: JSON.stringify({
      flow_type: args.flow_type,
      source: args.source,
      context: args.context,
    }),
    cache: "no-store",
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    return {
      ok: false,
      response: NextResponse.json(err, { status: res.status }),
    };
  }

  const body = await res.json().catch(() => ({}));
  return { ok: true, status: res.status, body };
}
