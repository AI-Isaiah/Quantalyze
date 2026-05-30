import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { assertSameOrigin } from "@/lib/csrf";
import { assertProfileApproved } from "@/lib/api/approval-gate";
import { assertPortfolioOwnership } from "@/lib/queries";
import {
  runPortfolioOptimizer,
  AnalyticsTimeoutError,
} from "@/lib/analytics-client";
import { userActionLimiter, checkLimit } from "@/lib/ratelimit";

/** Optimizer can take 3-8s on large portfolios; 15s is generous. */
const OPTIMIZER_TIMEOUT_MS = 15_000;

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

  // Approval gate (PR #266 follow-up): block pending-approval users from
  // running the 15s Python optimizer. The dashboard UI redirects them to
  // /pending-approval, but a non-browser caller with a valid session
  // cookie bypassed the page-only gate before this check landed.
  const denied = await assertProfileApproved(supabase, user.id);
  if (denied) return denied;

  let body: { portfolio_id?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const portfolioId = body.portfolio_id;
  if (!portfolioId) {
    return NextResponse.json(
      { error: "portfolio_id is required" },
      { status: 400 },
    );
  }

  // B15 limiter-ordering: consume the rate-limit token AFTER input
  // validation (body parse 400 + portfolio_id presence 400) so a malformed
  // request is rejected without burning one of the caller's own tokens.
  // Authorization (assertPortfolioOwnership 403 below) and the analytics
  // round-trip stay after the limiter.
  // Audit-2026-05-07 C-0107 (api-contract c8): apply userActionLimiter
  // per ADR-0004. The optimizer fires a 15s Python round-trip on every
  // call; pre-fix any auth user could hammer it. The 5/min/user cap is
  // tight enough to neutralise a logged-in attacker without disturbing
  // legitimate exploratory iteration.
  const rateLimitKey = `optimizer:${user.id}`;
  const rl = await checkLimit(userActionLimiter, rateLimitKey);
  if (!rl.success) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }

  // Audit-2026-05-07 red-team R-0002 (HIGH c7): symmetric token refund on
  // analytics-side 5xx (timeout 504 / unreachable 503). The /api/account/
  // export route already refunds on upload_failed / sign_failed / manifest_
  // drift (red-team R8) — applying the same pattern here closes the
  // asymmetry. Without it, a transient analytics outage burns a legitimate
  // user's 5/min budget on a deterministic failure (the worker is shared;
  // if it's down for one user it's down for all). Best-effort refund —
  // mirror the export refund's swallow-and-log idiom so a refund failure
  // never shadows the original 5xx the caller is being told about.
  const refundRateLimitToken = async (reason: string): Promise<void> => {
    if (!userActionLimiter) return;
    try {
      await userActionLimiter.resetUsedTokens(rateLimitKey);
    } catch (err) {
      console.error(
        `[api/portfolio-optimizer] rate-limit refund failed (${reason}):`,
        err instanceof Error ? err.message : err,
      );
    }
  };

  // Audit-2026-05-07 C-0108 (red-team c5): assertPortfolioOwnership is
  // verified to perform an explicit `.eq('id', portfolioId).eq('user_id',
  // user.id)` query (src/lib/queries.ts:974) — NOT RLS-visibility-only —
  // so it correctly rejects an admin user trying to optimise a non-owned
  // portfolio. The IDOR concern is mitigated; rate-limit above closes the
  // CSRF-amplification-via-CSRF chain.
  if (!(await assertPortfolioOwnership(portfolioId, user.id))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    // M-0332: `data` is now z.infer<typeof PortfolioOptimizerResponseSchema>
    // — `suggestions` is explicitly modelled, no cast needed.
    // C-PR5-01 remainder (audit-2026-05-07): forward the authenticated
    // `user.id` to the analytics service so the Python handler can apply
    // the second ownership gate `portfolios.user_id = req.user_id` (the
    // first gate is `assertPortfolioOwnership` above, which is the TS-side
    // RLS-bypassing check). Both gates close C-PR5-01 in defence-in-depth.
    const data = await runPortfolioOptimizer(
      portfolioId,
      user.id,
      OPTIMIZER_TIMEOUT_MS,
    );

    return NextResponse.json({
      status: "complete",
      suggestions: data.suggestions ?? [],
    });
  } catch (err) {
    if (err instanceof AnalyticsTimeoutError) {
      // Audit-2026-05-07 red-team R-0002: refund the 5/min token on
      // analytics-side timeout (the failure is upstream of the caller).
      await refundRateLimitToken("analytics_timeout");
      return NextResponse.json(
        { status: "failed", suggestions: null, error: "Optimizer timed out" },
        { status: 504 },
      );
    }
    // Audit-2026-05-07 M-0333 (api-contract c8): do NOT surface
    // err.message in the response body. The analytics-client wrapper can
    // bubble internal URLs (http://localhost:8002/...), Python tracebacks,
    // service-key header names, etc. Restore the hard-coded opaque
    // envelope; log the underlying error to console.error for ops.
    console.error("[api/portfolio-optimizer] analytics call failed:", err);
    // Audit-2026-05-07 red-team R-0002: refund on the generic 503 path
    // too (analytics service unreachable is also upstream-of-caller).
    await refundRateLimitToken("analytics_unreachable");
    return NextResponse.json(
      {
        status: "failed",
        suggestions: null,
        error: "Analytics service unreachable",
      },
      { status: 503 },
    );
  }
}
