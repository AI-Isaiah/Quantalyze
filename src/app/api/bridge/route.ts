import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { withAuth } from "@/lib/api/withAuth";
import { NO_STORE_HEADERS } from "@/lib/api/headers";
import { findReplacementCandidates } from "@/lib/analytics-client";
// C9 — ALL THREE seam error classes come from the never-mocked leaf, not one
// from the leaf and two from the wholesale-mocked module on the line above.
// The T-140-30 reasoning that put `CircuitOpenError` here applies verbatim to
// the other two: reaching a class through a module some test file replaces with
// a bare factory yields `undefined`, and `err instanceof undefined` throws a
// TypeError from inside a catch block. `analytics-client` re-exports them, so
// production behaviour is identical either way — but the re-export is also what
// let `bridge/route.test.ts` mock the module with a LOCALLY REDEFINED
// `AnalyticsUpstreamError` and still pass: route and test agreed only because
// BOTH resolved to the mock, so the test proved nothing about the shipping
// class. Importing from the leaf makes the identity the test exercises the
// identity that ships.
import {
  AnalyticsTimeoutError,
  AnalyticsUpstreamError,
  CircuitOpenError,
} from "@/lib/seam-errors";
import { BridgeRequestSchema } from "@/lib/api/bridgeSchema";
import { captureToSentry } from "@/lib/sentry-capture";
import {
  userActionLimiter,
  checkLimit,
  isRateLimitMisconfigured,
} from "@/lib/ratelimit";

// M-0888 (audit-2026-05-07 F5b): use the `withAuth` wrapper instead of
// hand-rolling assertSameOrigin + supabase.auth.getUser + assertProfileApproved.
// withAuth applies the same CSRF + auth + approval gate AND stamps the 401
// envelope with NO_STORE_HEADERS, and any future wrapper hardening (double-
// submit CSRF, body-size cap, Vary) reaches this route for free.
//
// Note: the sibling bridge/outcome + bridge/outcome/dismiss routes use the
// heavier `withAuthLimited` (which folds rate-limit + body-schema INTO the
// wrapper). Bridge deliberately stays on plain `withAuth` + an INLINE limiter:
// converging onto withAuthLimited's default `rateLimitDenyJson` would drop this
// route's bespoke 429/503 copy AND regress the NO_STORE_HEADERS added below
// (rateLimitDenyJson does not stamp it). The inline limiter already enforces the
// B15 validate-before-limit ordering, so the convergence value is marginal.
//
// M-0889 (audit-2026-05-07 round-2 Block D / P1947): every authenticated
// response — error AND success — must carry `Cache-Control: private, no-store`.
// The 200 body is user-specific BridgeCandidate[] (the allocator's
// underperformer scoring), exactly the cross-tenant-leak surface the policy
// targets. The 401 picks NO_STORE_HEADERS up from withAuth; every handler
// return below stamps it explicitly.
/**
 * Phase 140 / SEAM-02 — pinned for clarity; declared counterpart of this
 * route's `SEAM_ROUTE_BUDGETS` row in `src/lib/resilient-fetch.ts`.
 *
 * 300 is the project's VERIFIED effective Vercel default
 * (`defaultResourceConfig.functionDefaultTimeout: 300`, read from the live
 * project settings on 2026-07-25), so declaring it here cannot RAISE this
 * route's worst-case lambda hold (threat T-140-29). It exists so the SC-4b
 * headroom invariant has an in-repo source of truth instead of a
 * dashboard-changeable assumption: this route spends one `bridge` budget
 * (15s), i.e. 20× headroom.
 */
export const maxDuration = 300;

/**
 * Phase 140 / SEAM-04 — the static body the breaker arm emits.
 *
 * Deliberately byte-identical to `process-key-client`'s
 * `CIRCUIT_OPEN_HUMAN_MESSAGE` and to the admin/match routes' copy, so a
 * breaker trip reads the same to a user whichever seam they happen to hit. It
 * names no infrastructure (threat T-140-17): no circuit, no upstream host, no
 * cooldown vocabulary beyond the `Retry-After` header itself.
 */
const CIRCUIT_OPEN_COPY =
  "The analytics service is temporarily unavailable. Please try again in a moment.";

export const POST = withAuth(async (req, user) => {
  const supabase = await createClient();

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
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
      { status: 400, headers: NO_STORE_HEADERS },
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
          headers: { ...NO_STORE_HEADERS, "Retry-After": String(rl.retryAfter) },
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
        headers: { ...NO_STORE_HEADERS, "Retry-After": String(rl.retryAfter) },
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
    return NextResponse.json(
      { error: "Portfolio not found" },
      { status: 404, headers: NO_STORE_HEADERS },
    );
  }

  try {
    const result = await findReplacementCandidates(
      portfolio_id,
      underperformer_strategy_id,
      user.id,
    );
    return NextResponse.json(result, { headers: NO_STORE_HEADERS });
  } catch (err) {
    // Phase 140 / SEAM-04 — the breaker arm, FIRST among the typed arms.
    //
    // An open circuit means the request was never issued: the correct answer is
    // 503 + a cooldown, not the generic 500 this used to fall through to (which
    // invites an immediate retry against a service already known to be down).
    //
    // ⚠️ This lives INSIDE the handler, after the `withAuth` gate above, and
    // must stay there (threat T-140-20). Hoisting any breaker-aware branch above
    // the gate would turn "is Railway degraded right now?" into an
    // unauthenticated oracle.
    //
    // ⚠️ `CircuitOpenError` comes from the dependency-free leaf
    // `@/lib/seam-errors`, never through `@/lib/analytics-client`: this route's
    // test mocks that module wholesale, and a class read through a mocked module
    // is `undefined` — `err instanceof undefined` throws a TypeError from inside
    // this very catch block (threat T-140-30).
    if (err instanceof CircuitOpenError) {
      console.error(
        `[bridge] circuit open — short-circuited, retry in ${err.retryAfterS}s`,
      );
      return NextResponse.json(
        { error: CIRCUIT_OPEN_COPY },
        {
          status: 503,
          headers: {
            ...NO_STORE_HEADERS,
            // Same pairing as this route's own 429/503 limiter arms above.
            "Retry-After": String(err.retryAfterS),
          },
        },
      );
    }
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
      return NextResponse.json(
        { error: err.message },
        { status: err.status, headers: NO_STORE_HEADERS },
      );
    }
    // A timed-out Python round-trip is a gateway timeout, not a client error.
    if (err instanceof AnalyticsTimeoutError) {
      return NextResponse.json(
        { error: "Bridge scoring timed out. Please try again." },
        { status: 504, headers: NO_STORE_HEADERS },
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
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
});
