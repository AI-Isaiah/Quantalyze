import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { assertSameOrigin } from "@/lib/csrf";
import {
  simulateAddCandidate,
  AnalyticsUpstreamError,
  AnalyticsTimeoutError,
} from "@/lib/analytics-client";
import { captureToSentry } from "@/lib/sentry-capture";
import {
  simulatorLimiter,
  checkLimit,
  isRateLimitMisconfigured,
} from "@/lib/ratelimit";
import { SimulatorRequestSchema } from "@/lib/api/simulatorSchema";
import { NO_STORE_HEADERS } from "@/lib/api/headers";

/**
 * Sprint 6 Task 6.4 — POST /api/simulator
 *
 * Mirrors the `/api/bridge` route shape: CSRF-guarded POST, user ownership
 * check, 15s analytics-service timeout (enforced inside
 * `simulateAddCandidate`), 20/hour user-scoped rate limit.
 *
 * The analytics-service endpoint does compute-heavy portfolio math on
 * every call, so rate limiting here is a protection against both
 * accidental loops (React re-render leaks) and adversarial scraping.
 */
export async function POST(req: NextRequest) {
  const csrfError = assertSameOrigin(req);
  if (csrfError) return csrfError;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: NO_STORE_HEADERS },
    );
  }

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  const parsed = SimulatorRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error:
          "portfolio_id and candidate_strategy_id are required and must be valid UUIDs",
      },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  // B15: rate-limit AFTER input validation so a malformed/invalid request
  // (400) does not burn one of the caller's own rate-limit tokens. The
  // limiter still runs before any side-effecting work below.
  const rl = await checkLimit(simulatorLimiter, `simulator:${user.id}`);
  if (!rl.success) {
    // G15-046: limiter-misconfigured fail-CLOSED returns 503 so the
    // outage surfaces to canary/health checks instead of looking like
    // user-side throttling.
    if (isRateLimitMisconfigured(rl)) {
      return NextResponse.json(
        { error: "Rate limiter unavailable" },
        {
          status: 503,
          headers: { ...NO_STORE_HEADERS, "Retry-After": String(rl.retryAfter) },
        },
      );
    }
    // Expose retryAfter both as the conventional Retry-After HTTP header
    // and in the JSON body so the client can disable the retry button for
    // that duration instead of hammering the limiter in a loop.
    return NextResponse.json(
      {
        error:
          "Too many simulations. The portfolio impact simulator is capped at 20 runs per hour.",
        retryAfter: rl.retryAfter,
      },
      {
        status: 429,
        headers: { ...NO_STORE_HEADERS, "Retry-After": String(rl.retryAfter) },
      },
    );
  }

  const { portfolio_id, candidate_strategy_id } = parsed.data;

  // Verify the user owns this portfolio. The Python service also checks
  // this defense-in-depth — RLS is bypassed service-side — but a clean
  // 404 at this layer prevents leaking timing information about whether
  // a portfolio id exists.
  const { data: portfolio } = await supabase
    .from("portfolios")
    .select("id")
    .eq("id", portfolio_id)
    .eq("user_id", user.id)
    .single();

  if (!portfolio) {
    return NextResponse.json(
      { error: "Portfolio not found" },
      { status: 404, headers: NO_STORE_HEADERS },
    );
  }

  try {
    const result = await simulateAddCandidate(
      portfolio_id,
      candidate_strategy_id,
      user.id,
    );
    return NextResponse.json(result, { headers: NO_STORE_HEADERS });
  } catch (err) {
    // Forward 4xx semantics from the Python service (e.g. 400 "already in
    // portfolio", 404 "portfolio not found") instead of flattening every
    // upstream error to 500. AnalyticsUpstreamError.message carries the Python
    // `detail` (operator-curated copy) — safe to forward on the 4xx path.
    if (err instanceof AnalyticsUpstreamError && err.status >= 400 && err.status < 500) {
      return NextResponse.json(
        { error: err.message },
        { status: err.status, headers: NO_STORE_HEADERS },
      );
    }
    // M-0959/M-0963/L-0055: a timed-out Python round-trip is a gateway timeout.
    if (err instanceof AnalyticsTimeoutError) {
      return NextResponse.json(
        { error: "The simulator is taking longer than expected. Please try again." },
        { status: 504, headers: NO_STORE_HEADERS },
      );
    }
    // M-0959/M-0963/L-0055: genuine 5xx / unexpected exceptions return a STATIC
    // message. Echoing err.message here leaked the parseResponse() contract-
    // violation string (Python schema field names) and FastAPI 5xx detail to
    // authenticated allocators — the byte-identical defect F5 closed in the
    // sister /api/bridge route. Keep the detail server-side only.
    console.error("[simulator] Simulation failed:", err);
    captureToSentry(err, {
      tags: { route: "api/simulator", op: "simulateAddCandidate" },
    });
    return NextResponse.json(
      { error: "Portfolio impact simulation failed." },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}
