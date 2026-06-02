import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { assertSameOrigin } from "@/lib/csrf";
import { assertProfileApproved } from "@/lib/api/approval-gate";
import {
  findReplacementCandidates,
  AnalyticsUpstreamError,
  AnalyticsTimeoutError,
} from "@/lib/analytics-client";
import { BridgeRequestSchema } from "@/lib/api/bridgeSchema";
import { captureToSentry } from "@/lib/sentry-capture";
import {
  userActionLimiter,
  checkLimit,
  isRateLimitMisconfigured,
} from "@/lib/ratelimit";

export async function POST(req: NextRequest) {
  const csrfError = assertSameOrigin(req);
  if (csrfError) return csrfError;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // Approval gate (PR #266 follow-up): bridge fires a Python round-trip
  // to find replacement candidates; expensive enough to deny to
  // pending-approval users.
  const denied = await assertProfileApproved(supabase, user.id);
  if (denied) return denied;

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // M-0884: UUID-validate the body (mirrors /api/simulator) so a non-UUID id
  // is rejected at the boundary as 400 instead of silently missing on the FK.
  const parsed = BridgeRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error:
          "portfolio_id and underperformer_strategy_id are required and must be valid UUIDs",
      },
      { status: 400 },
    );
  }
  const { portfolio_id, underperformer_strategy_id } = parsed.data;

  // B15 limiter-ordering: consume the rate-limit token only AFTER input
  // validation so a malformed/invalid request rejected with 400 above does
  // not burn one of the caller's own tokens.
  const rl = await checkLimit(userActionLimiter, `bridge:${user.id}`);
  if (!rl.success) {
    // G15-046: surface limiter misconfiguration as 503 so canary alerts
    // catch the outage instead of treating users as throttled.
    if (isRateLimitMisconfigured(rl)) {
      return NextResponse.json(
        { error: "Rate limiter unavailable" },
        {
          status: 503,
          headers: { "Retry-After": String(rl.retryAfter) },
        },
      );
    }
    // G13-038: include the conventional Retry-After header on the 429
    // envelope so clients (and Vercel's analytics) get a structured
    // back-off hint. Mirror the sibling /api/simulator + /api/portfolio-
    // optimizer shape.
    return NextResponse.json(
      {
        error: "Too many requests. Bridge scoring is compute-intensive.",
        retryAfter: rl.retryAfter,
      },
      {
        status: 429,
        headers: { "Retry-After": String(rl.retryAfter) },
      },
    );
  }

  // Verify the user owns this portfolio
  const { data: portfolio } = await supabase
    .from("portfolios")
    .select("id")
    .eq("id", portfolio_id)
    .eq("user_id", user.id)
    .single();

  if (!portfolio) {
    return NextResponse.json({ error: "Portfolio not found" }, { status: 404 });
  }

  try {
    const result = await findReplacementCandidates(
      portfolio_id,
      underperformer_strategy_id,
      user.id,
    );
    return NextResponse.json(result);
  } catch (err) {
    // H-1061 / H-1063: forward upstream 4xx semantics (400 "no returns data",
    // 404 "portfolio not found", 422) instead of flattening every failure to
    // 500. Mirrors the sister /api/simulator route's 4xx-forwarding contract.
    // AnalyticsUpstreamError.message carries the Python `detail` field, which
    // is operator-curated, user-facing copy — safe to forward on the 4xx path.
    if (
      err instanceof AnalyticsUpstreamError &&
      err.status >= 400 &&
      err.status < 500
    ) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    // A timed-out Python round-trip is a gateway timeout, not a client error.
    if (err instanceof AnalyticsTimeoutError) {
      return NextResponse.json(
        { error: "Bridge scoring timed out. Please try again." },
        { status: 504 },
      );
    }
    // H-1062: genuine 5xx / unexpected exceptions return a STATIC message.
    // Echoing err.message here leaked Python contract-drift strings (the
    // multi-line Zod issue list parseResponse() throws) and FastAPI 5xx
    // detail to authenticated allocators. Keep the detail server-side only.
    console.error("[bridge] Scoring failed:", err);
    captureToSentry(err, {
      tags: { route: "api/bridge", op: "findReplacementCandidates" },
    });
    return NextResponse.json(
      { error: "Bridge scoring failed. Please try again." },
      { status: 500 },
    );
  }
}
