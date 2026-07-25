import { NextResponse } from "next/server";
import { getCorrelationId } from "@/lib/correlation-id";
import {
  DEFAULT_RETRY_AFTER_S,
  resilientFetch,
  SEAM_BUDGETS,
  type SeamBudgetKey,
} from "@/lib/resilient-fetch";
import { CircuitOpenError } from "@/lib/seam-errors";

/**
 * Phase 19 / M-3 — shared client for the unified `/process-key` upstream.
 *
 * Every Phase-19 thin adapter (verify-strategy, keys/sync, keys/validate-and-encrypt,
 * strategies/finalize-wizard, strategies/csv-validate, strategies/csv-finalize)
 * spoke this protocol locally with copy-pasted blocks:
 *
 *   1. Read `INTERNAL_API_TOKEN` env. If missing → 503 "Service unavailable".
 *   2. Resolve a correlation id (Sentry trace or random UUID).
 *   3. POST `/process-key` on the analytics service with
 *      `{ flow_type, source, context }` and a Bearer/X-Correlation-Id pair.
 *   4. Return the upstream response as a NextResponse, preserving status.
 *
 * Centralizing it here gives one place to thread observability, retries,
 * timeouts, or the eventual unified-encrypt branch without touching each
 * route. Each thin adapter now needs ~3 lines.
 *
 * Phase 140 / SEAM-01 + SEAM-04: the transport moved to
 * `resilient-fetch.ts` — the base URL, the wall-clock budget and the
 * `breaker:railway` circuit are the core's, not this module's. In exchange,
 * this module gained the `CIRCUIT_OPEN` arm, which all five Mechanism-B
 * callers inherit for free through their existing `result.response`
 * passthrough.
 *
 * Returned shape
 * --------------
 *   { ok: true, status, body }   on a successful upstream call (2xx)
 *   { ok: false, response }      on token-missing 503, breaker-open 503,
 *                                timeout 504, network 502, or upstream non-2xx
 *
 * Callers that want a NextResponse directly can use `postProcessKey()` and
 * fall back to `result.response` when `ok === false`. Callers that need to
 * inspect/translate the body (e.g. API-9 / I-API1 response-shape mapping)
 * branch on `ok === true` and read `result.body`.
 */

export type FlowType = "teaser" | "onboard" | "resync" | "csv";

/**
 * Phase 140 / SEAM-02 — pick the wall-clock budget matching what the SERVER
 * actually does with this flow.
 *
 * `analytics-service/routers/process_key.py:_is_long_fetch` is the source of
 * this split: {resync, onboard} are merely ENQUEUED onto the worker dyno and
 * return 202 immediately, while {teaser, csv} run the full 5-method pipeline
 * INLINE. The pre-140 client spent a blanket 60s on all four, so a sick
 * Railway held a Vercel concurrency slot 45s longer than necessary on the two
 * enqueue paths. Keep this function in lockstep with `_is_long_fetch`.
 */
function budgetKeyFor(flowType: FlowType): SeamBudgetKey {
  return flowType === "teaser" || flowType === "csv"
    ? "process-key-sync"
    : "process-key-enqueue";
}

/**
 * User-facing copy for the SEAM-04 503. STATIC by design (threat T-140-08):
 * a breaker trip is an infrastructure fact, and the unauthenticated teaser
 * path renders this string directly. It carries no upstream URL, no status,
 * and no error detail — the diagnosable half goes to the server log with the
 * routeTag and correlation_id.
 */
const CIRCUIT_OPEN_HUMAN_MESSAGE =
  "The analytics service is temporarily unavailable. Please try again in a moment.";

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
  /**
   * Phase 19.1 (2026-05-27) — the END USER's Supabase access token (JWT),
   * forwarded as the `X-User-Access-Token` header so the unified router can
   * call SECURITY DEFINER RPCs that enforce `auth.uid() = p_user_id`
   * (finalize_csv_strategy). The analytics service's service-role client has
   * no `auth.uid()`; without this the RPC raises 42501 "called without an
   * auth session". Only the CSV finalize step needs it — omit for
   * validate-only / teaser / resync flows, which never hit a user-auth RPC.
   */
  userAccessToken?: string;
  /**
   * TRUE when this call originates from a PUBLIC, unauthenticated surface —
   * today exactly one caller: the landing-page teaser (`/api/verify-strategy`,
   * which has no `withAuth` and reads no session; only same-origin + a per-IP
   * limiter stand in front of it). DEFAULTS TO FALSE so every authenticated
   * call site is byte-unchanged.
   *
   * Two things change, and both are about not letting an anonymous caller
   * DRIVE or READ shared infrastructure state:
   *
   *  1. CR-04 — failures on this call do NOT increment the single global
   *     breaker counter (`recordFailures: false` on the core). An anonymous
   *     payload that trips an unhandled FastAPI exception is a 500 attributable
   *     to ONE caller; five of them would otherwise open `breaker:railway` and
   *     deny the whole seam to every tenant for the cooldown. The call is still
   *     BLOCKED by an already-open breaker — read, never write.
   *
   *  2. CR-05 — the breaker 503 advertises the STATIC `DEFAULT_RETRY_AFTER_S`
   *     instead of the live `redis.ttl`. The real TTL tells an anonymous poller
   *     exactly how many seconds of degradation remain, which is a free,
   *     timestamped readout of production health from a public surface (and,
   *     combined with (1) pre-fix, both the lever and the readout).
   */
  unauthenticated?: boolean;
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
        {
          error: "Service unavailable",
          // C3 — the FOURTH seam-unavailable 503 this module can mint, and the
          // only one that carried no `code`. A client classifying off the wire
          // code (rather than off the bare status, which is what this finding
          // exists to end) needs every arm to name itself. Same user meaning as
          // CIRCUIT_OPEN / UPSTREAM_TIMEOUT / UPSTREAM_NETWORK_ERROR: the
          // request never reached the service, nothing was stored.
          code: "UPSTREAM_NOT_CONFIGURED",
          human_message: CIRCUIT_OPEN_HUMAN_MESSAGE,
          recoverable: true,
        },
        { status: 503 },
      ),
    };
  }

  const correlationId = args.correlationId ?? (await getCorrelationId());

  // CT-7 (army2) — wall-clock budget for the upstream POST. Without a
  // client-side timeout the Vercel function hangs until maxDuration and
  // returns a generic 504 with no clean envelope. Phase 140 moved the budget
  // itself into SEAM_BUDGETS and split it by flow type (see budgetKeyFor);
  // the core applies it and owns the breaker.
  const budgetKey = budgetKeyFor(args.flow_type);
  const timeoutMs = SEAM_BUDGETS[budgetKey].timeoutMs;

  let res: Response;
  try {
    // Headers and body pass through the core byte-for-byte. A dropped
    // X-User-Id re-opens the CT-4 cross-tenant rate-limit-bucket defect.
    res = await resilientFetch(budgetKey, "/process-key", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${internalToken}`,
        "X-Correlation-Id": correlationId,
        // CT-4 (army2) — forward tenant id for cross-tenant rate-limit
        // isolation. See PostProcessKeyArgs.userId for the contract.
        "X-User-Id": args.userId,
        // Phase 19.1 — forward the end user's access token so the unified
        // router can call user-auth SECURITY DEFINER RPCs (finalize_csv_strategy)
        // as the user. Only present for the CSV finalize step.
        ...(args.userAccessToken
          ? { "X-User-Access-Token": args.userAccessToken }
          : {}),
      },
      body: JSON.stringify({
        flow_type: args.flow_type,
        source: args.source,
        context: args.context,
      }),
      cache: "no-store",
      // CR-04 — an anonymous caller may READ breaker state but must never
      // WRITE it. See PostProcessKeyArgs.unauthenticated.
      recordFailures: !args.unauthenticated,
    });
  } catch (err) {
    const tag = args.routeTag ?? "process-key-client";
    // ORDER IS LOAD-BEARING: CircuitOpenError FIRST. The generic arms below
    // would otherwise report a breaker trip as a network failure (502), and
    // the caller would never see the Retry-After hint that makes the trip
    // actionable.
    if (err instanceof CircuitOpenError) {
      console.error(
        `[${tag}] /process-key short-circuited — the analytics circuit is open`,
        { correlation_id: correlationId, retry_after_s: err.retryAfterS },
      );
      // CR-05 — the live TTL is a precise readout of how degraded production is
      // right now. Authenticated callers get it (it is genuinely actionable and
      // is the same class of hint `rateLimitDenyJson` already publishes); the
      // anonymous surface gets the STATIC cooldown constant instead. The server
      // log above keeps the real value either way.
      const advertisedRetryAfterS = args.unauthenticated
        ? DEFAULT_RETRY_AFTER_S
        : err.retryAfterS;
      return {
        ok: false,
        response: NextResponse.json(
          {
            ok: false,
            code: "CIRCUIT_OPEN",
            human_message: CIRCUIT_OPEN_HUMAN_MESSAGE,
            correlation_id: correlationId,
            recoverable: true,
          },
          {
            status: 503,
            headers: { "Retry-After": String(advertisedRetryAfterS) },
          },
        ),
      };
    }
    const isAbort =
      (err instanceof Error || err instanceof DOMException) &&
      (err.name === "AbortError" || err.name === "TimeoutError");
    if (isAbort) {
      console.error(
        // The budget is no longer universally 60s — report the one that fired.
        `[${tag}] /process-key upstream timed out after ${timeoutMs}ms (CT-7)`,
        { correlation_id: correlationId },
      );
      return {
        ok: false,
        response: NextResponse.json(
          {
            ok: false,
            code: "UPSTREAM_TIMEOUT",
            human_message:
              "The ingestion service did not respond in time. Please try again.",
            correlation_id: correlationId,
            recoverable: true,
          },
          { status: 504 },
        ),
      };
    }
    // Non-timeout network errors surface as 502 so the caller can
    // distinguish "we never reached upstream" from "upstream rejected us".
    const message = err instanceof Error ? err.message : "Network error";
    console.error(`[${tag}] /process-key upstream fetch threw:`, message);
    return {
      ok: false,
      response: NextResponse.json(
        {
          ok: false,
          code: "UPSTREAM_NETWORK_ERROR",
          human_message: "Could not reach the ingestion service.",
          correlation_id: correlationId,
          recoverable: true,
        },
        { status: 502 },
      ),
    };
  }

  const tag = args.routeTag ?? "process-key-client";

  if (!res.ok) {
    const err = await parseUpstreamJson(res, tag, correlationId);
    return {
      ok: false,
      response: NextResponse.json(err, { status: res.status }),
    };
  }

  const body = await parseUpstreamJson(res, tag, correlationId);
  return { ok: true, status: res.status, body };
}

/**
 * Read the upstream JSON body, degrading to `{}` — but never SILENTLY.
 *
 * Phase 140 review / D-5. Both call sites were `res.json().catch(() => ({}))`,
 * which discards the parse error entirely. The `ok` arm is the damaging one:
 * `/api/keys/sync` forwards this body, so an upstream that answered 200 with an
 * unparseable payload produced a clean `200 {}` to the client. The wizard then
 * read `kickoff.composite === undefined`, took the single-key branch, and
 * waited for a sync that was never described — a silent wrong answer rather
 * than a visible failure, with NOTHING anywhere to explain it.
 *
 * The fallback itself is kept: both callers already treat `{}` as "no usable
 * fields" and the status is preserved, so degrading is the right behaviour. It
 * is the SILENCE that was wrong.
 *
 * Never logs the body — the seam carries raw exchange credentials. Only the
 * status, the parse error's message, and the correlation id, which is what
 * joins this line to the Python side.
 */
async function parseUpstreamJson(
  res: Response,
  tag: string,
  correlationId: string,
): Promise<unknown> {
  try {
    return await res.json();
  } catch (parseErr) {
    console.error(
      `[${tag}] /process-key returned ${res.status} with an unparseable JSON body — degrading to {}`,
      {
        correlation_id: correlationId,
        content_type: res.headers.get("content-type"),
        parse_error:
          parseErr instanceof Error ? parseErr.message : String(parseErr),
      },
    );
    return {};
  }
}
