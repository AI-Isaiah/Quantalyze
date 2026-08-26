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
import { bridgeComputeLimiter, checkLimit, rateLimitDenyJson } from "@/lib/ratelimit";
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
// scrubbing chokepoint; `console.*` has none, so every log site in this file
// that touches a caught value wraps it here. `secrets` stays empty for the
// reason stated above — this route holds no per-request credential.
// (There was a second such site — the rate-limit refund's failure log. WR-03
// removed the refund; see the block above the ownership check.)
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
    // ── 140.3-G6 / SEAMUX-03 — a machine `code` on EVERY route-emitted arm ──
    // A consumer discriminates the fault on a stable token instead of sniffing
    // the prose. The CSRF 403 (assertSameOrigin) and the approval-gate 403
    // (assertProfileApproved) are HELPER-emitted across the whole API surface
    // and stay codeless — excluded exactly as keys/sync's withAuth 401 was.
    return NextResponse.json(
      { error: "Unauthorized", code: "UNAUTHENTICATED" },
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
      { error: "Invalid JSON body", code: "VALIDATION_FAILED" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  const portfolioId = body.portfolio_id;
  if (!portfolioId) {
    return NextResponse.json(
      // The named-id-param fact (keys/sync MISSING_STRATEGY_ID precedent) — NOT
      // VALIDATION_FAILED, which this set reserves for structural body rejection.
      { error: "portfolio_id is required", code: "MISSING_PORTFOLIO_ID" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  // B15 limiter-ordering: consume the rate-limit token AFTER input
  // validation (body parse 400 + portfolio_id presence 400) so a malformed
  // request is rejected without burning one of the caller's own tokens.
  // Authorization (assertPortfolioOwnership 403 below) and the analytics
  // round-trip stay after the limiter.
  // Audit-2026-05-07 C-0107 (api-contract c8): apply a per-caller limiter
  // per ADR-0004. The optimizer fires a 15s Python round-trip on every
  // call; pre-fix any auth user could hammer it.
  //
  // Phase 163 SEC-04: that limiter is now `bridgeComputeLimiter` (10/3600s),
  // not the shared `userActionLimiter` (5/60s = 300/hour). The old bucket
  // advertised 30x the budget the Python side will actually serve — slowapi
  // "10/hour" per tenant, measured effective at 1 replica — so its denial
  // could only ever emit Retry-After <= 60 for a wait the backend may set at
  // up to 3600s. See the limiter's docblock in `src/lib/ratelimit.ts` for the
  // measurement this size is derived from.
  const rateLimitKey = `optimizer:${user.id}`;
  const rl = await checkLimit(bridgeComputeLimiter, rateLimitKey);
  if (!rl.success) {
    // 140.4-13 / SEAMRIM-05 — deny through the chokepoint so a limiter
    // misconfiguration answers 503. 140.3-G6 / SEAMUX-03 — the builder's default
    // bodies are CODELESS, so pass the keys/sync-shape overrides: the default
    // SENTENCES are byte-kept, the machine `code` added beside each. RATE_LIMITED
    // (not KEY_RATE_LIMIT: OUR limiter, not an exchange throttle); the
    // misconfigured branch answers SEAM_MISCONFIGURED. NO_STORE_HEADERS kept.
    return rateLimitDenyJson(rl, {
      headers: NO_STORE_HEADERS,
      throttledBody: { error: "Too many requests", code: "RATE_LIMITED" },
      misconfiguredBody: {
        error: "Rate limiter unavailable",
        code: "SEAM_MISCONFIGURED",
      },
    });
  }

  // ── WR-03 (163 review) — THERE IS NO TOKEN REFUND HERE, AND THAT IS THE FIX ─
  //
  // ⚠️ WHAT USED TO STAND HERE: a "symmetric token refund" on all three
  // upstream-failure arms (breaker trip, 504 timeout, generic 503), landed as
  // audit-2026-05-07 red-team R-0002 and mirroring the GDPR export route. It
  // was implemented as `bridgeComputeLimiter.resetUsedTokens(rateLimitKey)`.
  //
  // MEASURED, because the whole decision turns on it: `@upstash/ratelimit`
  // v2.0.8 exposes exactly four operations on a limiter — `limit`,
  // `blockUntilReady`, `getRemaining` and `resetUsedTokens` — and
  // `resetUsedTokens` DELETES every store key matching `<prefix>:<identifier>*`
  // (dist/index.js:881-884, calling the algorithm's `resetTokens`). There is no
  // decrement. "Give this caller back the ONE token their failed request spent"
  // is not an operation this library can perform.
  //
  // Zeroing the window was survivable while this route spent `userActionLimiter`
  // (5/60s): a window that self-heals in a minute is close enough to a one-token
  // refund, which is also why the export route's 1/day bucket is unaffected —
  // there, a reset IS one token. Phase 163 SEC-04 resized THIS bucket to
  // 10/3600s, and the same call then returned up to TEN tokens and up to an
  // HOUR of budget. The consequence is why the refund is removed rather than
  // kept: an authenticated caller looping into upstream 504s consumed one token,
  // fired the ~15s Python round-trip, timed out, and RESET THEIR OWN WINDOW — so
  // the front door never denied, and the loop sustained unbounded 15s
  // round-trips against a single already-unhealthy replica. That is verbatim
  // clause (c) of `bridgeComputeLimiter`'s own docblock, the DoS the limiter
  // exists to prevent, re-opened by its own escape hatch. A refund that removes
  // the cap is strictly worse than no refund.
  //
  // THE BREAKER ARM IS THE STRONGEST CASE FOR KEEPING ONE — that request never
  // left Vercel, so nothing upstream was consumed and charging for it is
  // unfair. It goes too, for the same mechanical reason: the only refund
  // available is a whole-window reset, so a caller looping against an open
  // breaker would hold a permanently full bucket. A limiter that any caller can
  // zero on demand is not a limiter.
  //
  // WHY NOT A BOUNDED REFUND (at most one reset per window per caller, which the
  // review offers as the cheapest correct change): it needs a second distributed
  // bucket and a second store round-trip on the error path, it STILL over-refunds
  // tenfold per event, and it adds a second `checkLimit` site to a route that
  // `src/lib/seam-ratelimit-posture.invariant.test.ts` pins to exactly one
  // limiter. Against the actual cost of not refunding, that is not a trade worth
  // making.
  //
  // WHAT NOT REFUNDING COSTS, stated rather than waved at: a failed attempt now
  // spends 1 of the caller's 10 hourly tokens. R-0002 was decided against 5/60s,
  // where a lost token was 20% of a self-healing minute; that premise changed
  // under it in this same phase. A user who clicks once during an analytics
  // outage keeps 9 of 10 tokens — and while the service is degraded a retained
  // token buys them nothing anyway, because no attempt can succeed. Losing the
  // whole hour takes ten deliberate attempts, which is the cap working, not a
  // lockout.
  //
  // ⛔ DO NOT re-add `resetUsedTokens` on this route. See the matching ⛔ note
  //    on `bridgeComputeLimiter` in `src/lib/ratelimit.ts`.

  // Audit-2026-05-07 C-0108 (red-team c5): assertPortfolioOwnership is
  // verified to perform an explicit `.eq('id', portfolioId).eq('user_id',
  // user.id)` query (`assertPortfolioOwnership` in src/lib/queries.ts) — NOT RLS-visibility-only —
  // so it correctly rejects an admin user trying to optimise a non-owned
  // portfolio. The IDOR concern is mitigated; rate-limit above closes the
  // CSRF-amplification-via-CSRF chain.
  if (!(await assertPortfolioOwnership(portfolioId, user.id))) {
    return NextResponse.json(
      { error: "Forbidden", code: "FORBIDDEN" },
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
    // ⚠️ WR-03: this arm USED TO REFUND the rate-limit token, on the argument
    // that a breaker trip is the purest upstream failure — the request never
    // left Vercel. That argument is still right; the refund is gone anyway
    // because the only refund the store offers is a whole-window reset. See
    // the WR-03 block above the ownership check for the measurement.
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
      return NextResponse.json(
        // 140.3-G6 / SEAMUX-03 — `code` added BESIDE the B-26 money-bearing
        // shape. Every existing key and value is byte-unchanged: PortfolioOptimizer
        // discards stale suggestions off `{ status, suggestions, error }`, and
        // changing it re-opens the stale-money-data defect this phase fixed.
        { status: "failed", suggestions: null, error: CIRCUIT_OPEN_COPY, code: "CIRCUIT_OPEN" },
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
      // ⚠️ WR-03: the token stays SPENT. This is the arm the removed refund
      // actually broke — each attempt here fires the full ~15s Python
      // round-trip before timing out, so a caller who could reset their own
      // window on every 504 was the DoS clause (c) names.
      return NextResponse.json(
        // B-26 shape byte-preserved, `code` added beside it.
        { status: "failed", suggestions: null, error: "Optimizer timed out", code: "UPSTREAM_TIMEOUT" },
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
    // ⚠️ WR-03: the token stays SPENT here too — same reasoning as the timeout
    // arm above.
    return NextResponse.json(
      {
        status: "failed",
        suggestions: null,
        error: "Analytics service unreachable",
        // Here "unreachable" IS the transport fact (ECONNREFUSED / ENOTFOUND /
        // TLS), so UPSTREAM_NETWORK_ERROR is honest — the request never got an
        // answer. B-26 shape byte-preserved, `code` added beside it.
        code: "UPSTREAM_NETWORK_ERROR",
      },
      { status: 503, headers: NO_STORE_HEADERS },
    );
  }
}
