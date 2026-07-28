import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { assertSameOrigin } from "@/lib/csrf";
import { assertProfileApproved } from "@/lib/api/approval-gate";
import { assertPortfolioOwnership } from "@/lib/queries";
import {
  runPortfolioOptimizer,
  AnalyticsTimeoutError,
} from "@/lib/analytics-client";
import { CircuitOpenError } from "@/lib/seam-errors";
import { CIRCUIT_OPEN_COPY } from "@/lib/seam-copy";
import { userActionLimiter, checkLimit } from "@/lib/ratelimit";
import { NO_STORE_HEADERS } from "@/lib/api/headers";
// 140.3-13b / SEAMUX-08 — the ONE lazy-Sentry helper, applied under the SINGLE
// capture policy written out IN FULL in `src/app/api/admin/match/eval/route.ts`
// by `140.3-13a`. Cited, never restated. The caught value is passed UNMODIFIED:
// `captureToSentry` scrubs at the chokepoint (SEAMCORE-06), and pre-scrubbing
// here would hand Sentry a string, destroying grouping and the stack.
//
// PER-REQUEST SECRETS AT THIS ROUTE: none. The body carries one opaque
// `portfolio_id` row id; no credential, no user JWT, no exchange material
// crosses this handler. Stated rather than assumed (M78b).
import { captureToSentry } from "@/lib/sentry-capture";
// 140.4-08 / SEAMRIM-06 — the CONSOLE half of the same rule. Sentry has a
// scrubbing chokepoint; `console.*` has none, so both log sites in this file
// wrap the caught value here. `secrets` stays empty for the reason stated
// above — this route holds no per-request credential.
import { scrubSeamError } from "@/lib/seam-redaction";

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
      // 140.4-08 / SEAMRIM-06 — the WHOLE ternary is replaced by one leaf call,
      // not one of its arms. `err.message` is exactly where undici puts the
      // outgoing headers, and `String(err)` on the other arm renders
      // `name: message`, so scrubbing one arm leaves the same bytes reachable
      // through the other. `scrubSeamError` is total and renders both shapes,
      // so the ternary was buying nothing the leaf does not already do.
      console.error(
        `[api/portfolio-optimizer] rate-limit refund failed (${reason}):`,
        scrubSeamError(err),
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
    // 140.3-13b / SEAMUX-08 — THE TERMINAL ARM, and the only capture in this
    // route. The two arms above (breaker short-circuit, upstream timeout) are
    // conditions we already classified and already answer with their own
    // status; this arm is by construction the one that means "we do not know
    // what this is". This route has NO typed upstream-error branch at all, so
    // an analytics 5xx also lands here and IS captured — the
    // "service-permanent outcome" half of the policy, reached without needing a
    // range split.
    //
    // `extra` carries the opaque row id only. The body has no other field, and
    // the raw `err` — which can bubble an internal URL or a Python traceback
    // (M-0333) — reaches Sentry only through the scrubbing chokepoint.
    captureToSentry(err, {
      tags: { surface: "portfolio-optimizer", step: "analytics-unreachable" },
      extra: { portfolio_id: portfolioId },
    });
    console.error(
      "[api/portfolio-optimizer] analytics call failed:",
      scrubSeamError(err),
    );
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
