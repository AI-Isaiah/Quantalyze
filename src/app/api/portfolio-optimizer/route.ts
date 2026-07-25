import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { assertSameOrigin } from "@/lib/csrf";
import { assertProfileApproved } from "@/lib/api/approval-gate";
import { assertPortfolioOwnership } from "@/lib/queries";
import { runPortfolioOptimizer } from "@/lib/analytics-client";
// C9/E5 — BOTH seam error classes come from the never-mocked leaf, not one from
// the leaf and one from the wholesale-mocked module above. The T-140-30
// reasoning that put `CircuitOpenError` here applies verbatim to
// `AnalyticsTimeoutError`: reaching a class through a module a test file
// replaces with a bare factory yields `undefined`, and `err instanceof
// undefined` throws a TypeError from inside a catch block. `analytics-client`
// re-exports it, so production behaviour is identical either way — but the
// re-export is also what let `route.test.ts` mock the module with a hand-rolled
// `FakeAnalyticsTimeoutError` and still pass: route and test agreed only because
// BOTH resolved to the shim, so the 504 case proved nothing about the shipping
// class.
import { AnalyticsTimeoutError, CircuitOpenError } from "@/lib/seam-errors";
import { userActionLimiter, checkLimit } from "@/lib/ratelimit";
import { NO_STORE_HEADERS } from "@/lib/api/headers";

/**
 * Phase 140 / SEAM-02 — pinned for clarity; declared counterpart of this
 * route's `SEAM_ROUTE_BUDGETS` row in `src/lib/resilient-fetch.ts`.
 *
 * 300 is the project's VERIFIED effective Vercel default
 * (`defaultResourceConfig.functionDefaultTimeout: 300`, read from the live
 * project settings on 2026-07-25), so declaring it here cannot RAISE this
 * route's worst-case lambda hold (threat T-140-29). It exists so the SC-4b
 * headroom invariant has an in-repo source of truth instead of a
 * dashboard-changeable assumption: this route spends one `portfolio-optimizer`
 * budget (15s), i.e. 20× headroom.
 *
 * NOTE the division of labour: `maxDuration` is the FUNCTION's ceiling, the
 * budget table owns the SEAM's deadline. This route used to declare the latter
 * itself, in a route-local 15s timeout constant removed in this phase — which
 * is precisely the scattered-budget ownership SEAM-02 exists to end. The
 * deadline now comes from `SEAM_BUDGETS["portfolio-optimizer"]` via the
 * wrapper's budgetKey, so there is exactly one place to change it.
 *
 * (The old constant's NAME is deliberately not written out here: the same grep
 * that proves it is gone would otherwise match this comment — the trap 140-04
 * hit, where a guard was defeated by prose quoting the token it forbids.)
 */
export const maxDuration = 300;

/**
 * Phase 140 / SEAM-04 — the static body the breaker arm emits. Byte-identical
 * to `process-key-client`'s `CIRCUIT_OPEN_HUMAN_MESSAGE` and to the sibling
 * seam routes, so a breaker trip reads the same to a user whichever seam they
 * hit, and it names no infrastructure (M-0333 / threat T-140-17).
 */
const CIRCUIT_OPEN_COPY =
  "The analytics service is temporarily unavailable. Please try again in a moment.";

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
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  const portfolioId = body.portfolio_id;
  if (!portfolioId) {
    return NextResponse.json(
      { error: "portfolio_id is required" },
      { status: 400, headers: NO_STORE_HEADERS },
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
      {
        status: 429,
        headers: { ...NO_STORE_HEADERS, "Retry-After": String(rl.retryAfter) },
      },
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
    return NextResponse.json(
      { error: "Forbidden" },
      { status: 403, headers: NO_STORE_HEADERS },
    );
  }

  try {
    // M-0332: `data` is now z.infer<typeof PortfolioOptimizerResponseSchema>
    // — `suggestions` is explicitly modelled, no cast needed.
    // C-PR5-01 remainder (audit-2026-05-07): forward the authenticated
    // `user.id` to the analytics service so the Python handler can apply
    // the second ownership gate `portfolios.user_id = req.user_id` (the
    // first gate is `assertPortfolioOwnership` above, which is the TS-side
    // RLS-bypassing check). Both gates close C-PR5-01 in defence-in-depth.
    // Phase 140 / SEAM-02: no timeout argument — the deadline is owned by
    // SEAM_BUDGETS["portfolio-optimizer"] and reached through the wrapper's
    // budgetKey. Passing one here would re-create the route-local budget this
    // phase removed, and a route-local value silently WINS over the table.
    const data = await runPortfolioOptimizer(portfolioId, user.id);

    return NextResponse.json(
      {
        status: "complete",
        suggestions: data.suggestions ?? [],
      },
      { headers: NO_STORE_HEADERS },
    );
  } catch (err) {
    // Phase 140 / SEAM-04 — the breaker arm, FIRST among the typed arms.
    //
    // Distinct from the generic 503 below in two ways that matter to a client:
    // it carries a Retry-After cooldown (the request was never issued, so the
    // breaker knows exactly when to come back) and its own static copy.
    //
    // The refund is red-team R-0002 consistency, not a new policy: this route
    // already refunds on both upstream-failure arms because the failure is
    // upstream of the caller. A breaker trip is the purest case of that — the
    // request never left Vercel — so charging for it would burn a legitimate
    // user's whole 5/min budget during a Railway outage.
    //
    // ⚠️ Placement: INSIDE the handler, after the 401 + approval + ownership
    // gates (threat T-140-20) — a breaker-aware branch above them would turn
    // "is Railway degraded right now?" into an unauthenticated oracle.
    //
    // ⚠️ `CircuitOpenError` comes from the dependency-free leaf
    // `@/lib/seam-errors`, never through `@/lib/analytics-client`: this route's
    // test mocks that module wholesale, and a class read through a mocked
    // module is `undefined` — `err instanceof undefined` throws a TypeError
    // from inside this very catch block (threat T-140-30).
    if (err instanceof CircuitOpenError) {
      console.error(
        `[api/portfolio-optimizer] circuit open — short-circuited, retry in ${err.retryAfterS}s`,
      );
      await refundRateLimitToken("circuit_open");
      return NextResponse.json(
        { status: "failed", suggestions: null, error: CIRCUIT_OPEN_COPY },
        {
          status: 503,
          headers: {
            ...NO_STORE_HEADERS,
            // Same pairing as this route's own 429 arm above.
            "Retry-After": String(err.retryAfterS),
          },
        },
      );
    }
    if (err instanceof AnalyticsTimeoutError) {
      // Audit-2026-05-07 red-team R-0002: refund the 5/min token on
      // analytics-side timeout (the failure is upstream of the caller).
      await refundRateLimitToken("analytics_timeout");
      return NextResponse.json(
        { status: "failed", suggestions: null, error: "Optimizer timed out" },
        { status: 504, headers: NO_STORE_HEADERS },
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
      { status: 503, headers: NO_STORE_HEADERS },
    );
  }
}
