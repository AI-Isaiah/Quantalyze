import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { withAuth } from "@/lib/api/withAuth";
import { NO_STORE_HEADERS } from "@/lib/api/headers";
import {
  findReplacementCandidates,
  AnalyticsUpstreamError,
  AnalyticsTimeoutError,
} from "@/lib/analytics-client";
import { CircuitOpenError } from "@/lib/seam-errors";
import { CIRCUIT_OPEN_COPY } from "@/lib/seam-copy";
import { BridgeRequestSchema } from "@/lib/api/bridgeSchema";
import { captureToSentry } from "@/lib/sentry-capture";
// 140.4-08 / SEAMRIM-06 — `captureToSentry` scrubs at its own chokepoint;
// `console.*` has none, so the log site below wraps the caught value here.
import { scrubSeamError } from "@/lib/seam-redaction";
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

export const POST = withAuth(async (req, user) => {
  const supabase = await createClient();

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON", code: "VALIDATION_FAILED" },
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
        // ── 140.3-G6 / SEAMUX-03 — a machine `code` on EVERY route-emitted arm ──
        // A consumer discriminates the fault on a stable token instead of
        // sniffing the prose (140.3-12's to reword). Both 400 input arms answer
        // VALIDATION_FAILED — a structural body rejection, the same token the
        // sibling scenario/optimize + simulator arms use. The `withAuth` 401 is
        // helper-owned and stays codeless (excluded, like keys/sync's).
        code: "VALIDATION_FAILED",
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
        { error: "Rate limiter unavailable", code: "SEAM_MISCONFIGURED" },
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
        // OUR limiter refused this request — RATE_LIMITED is the app-global
        // token for exactly that (as opposed to KEY_RATE_LIMIT, an EXCHANGE
        // throttle). The retryAfter body field is byte-kept beside it.
        code: "RATE_LIMITED",
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
      // Same spelling as G5's simulator 404 — one fact, one token across routes.
      { error: "Portfolio not found", code: "PORTFOLIO_NOT_FOUND" },
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
        { error: CIRCUIT_OPEN_COPY, code: "CIRCUIT_OPEN" },
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
        // Preserve the UPSTREAM's own machine code (AnalyticsUpstreamError.
        // seamCode); UNKNOWN only when the body carried none. Never a transport
        // token here — the upstream ANSWERED, so a "network error" would claim a
        // fault not observed. Mirrors scenario/optimize's forwarded-4xx arm.
        { error: err.message, code: err.seamCode ?? "UNKNOWN" },
        { status: err.status, headers: NO_STORE_HEADERS },
      );
    }
    // A timed-out Python round-trip is a gateway timeout, not a client error.
    if (err instanceof AnalyticsTimeoutError) {
      return NextResponse.json(
        { error: "Bridge scoring timed out. Please try again.", code: "UPSTREAM_TIMEOUT" },
        { status: 504, headers: NO_STORE_HEADERS },
      );
    }
    // H-1062: genuine 5xx / unexpected exceptions return a STATIC message.
    // Echoing err.message here leaked Python contract-drift strings (the
    // multi-line Zod issue list parseResponse() throws) and FastAPI 5xx
    // detail to authenticated allocators. Keep the detail server-side only.
    console.error("[bridge] Scoring failed:", scrubSeamError(err));
    captureToSentry(err, {
      tags: { route: "api/bridge", op: "findReplacementCandidates" },
    });
    // 161-08 / WIZERR-06 — THE CODE CROSSES; THE MESSAGE STILL DOES NOT.
    //
    // Read this together with the H-1062 note above, because the two say
    // different things about the same arm and confusing them re-opens the leak:
    //
    //   · `error` is STATIC and stays static. `err.message` carries the Python
    //     contract-drift string, FastAPI 5xx `detail` and this service's base
    //     URL. H-1062 is UNCHANGED — the restriction was NOT relaxed.
    //   · `code` is a machine token from the seam's own closed vocabulary,
    //     already forwarded on the 4xx arm twelve lines up. Collapsing it here
    //     meant the MORE severe half of the vocabulary was the half the client
    //     could not discriminate, which is the `?? "UNKNOWN"` half of the
    //     WIZFORM-02 class.
    //
    // ⛔ `typeof`, NOT `instanceof AnalyticsUpstreamError`: this arm is also
    // reached by transport failures and untyped throws, and route suites that
    // mock `@/lib/analytics-client` wholesale make the class `undefined`, where
    // `x instanceof undefined` throws a TypeError from inside this very catch
    // (the idiom `keyRouteFailureHeaders` records at length). A non-seam
    // throwable simply has no `seamCode` and still answers UNKNOWN.
    //
    // The empty string is excluded deliberately: `"" ?? "UNKNOWN"` is `""`, so
    // a bodyless code would cross as a blank token rather than as the honest
    // terminal.
    const rawSeamCode = (err as { seamCode?: unknown } | null | undefined)
      ?.seamCode;
    const seamCode =
      typeof rawSeamCode === "string" && rawSeamCode !== "" ? rawSeamCode : null;
    return NextResponse.json(
      // The terminal arm — "we do not know what this is" is now said ONLY when
      // it is true, i.e. when the seam named no code.
      {
        error: "Bridge scoring failed. Please try again.",
        code: seamCode ?? "UNKNOWN",
      },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
});
