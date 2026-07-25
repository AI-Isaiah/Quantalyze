import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isAdminUser } from "@/lib/admin";
import { AnalyticsTimeoutError, evalMatch } from "@/lib/analytics-client";
import { AnalyticsUpstreamError, CircuitOpenError } from "@/lib/seam-errors";
import { assertSameOrigin } from "@/lib/csrf";
import { NO_STORE_HEADERS } from "@/lib/api/headers";

/**
 * Phase 140 / SEAM-02 — pinned for clarity; asserted against
 * SEAM_ROUTE_BUDGETS by seam-budgets.invariant.test.
 *
 * 300 is the project's VERIFIED effective Vercel default
 * (`defaultResourceConfig.functionDefaultTimeout: 300`, read from the live
 * project settings on 2026-07-25), so declaring it here cannot raise this
 * route's worst-case lambda hold. It exists so the SC-4b headroom invariant
 * has an in-repo source of truth instead of a dashboard-changeable
 * assumption: this route spends one `match-eval` budget (30s), 10× headroom.
 */
export const maxDuration = 300;

/**
 * The three STATIC bodies this handler may emit on failure.
 *
 * STATIC is the point (threat T-140-11). Until Phase 140 the generic arm
 * echoed `err.message`, which on this seam carries Python contract-drift
 * strings (the multi-line Zod issue list `parseResponse()` throws), FastAPI
 * 5xx `detail`, and the analytics service's base URL. Same defect and same
 * fix as bridge H-1062 (`src/app/api/bridge/route.ts:142-145`) and
 * portfolio-optimizer M-0333 (`src/app/api/portfolio-optimizer/route.ts:144-147`);
 * these two admin/match routes were simply never included in those passes.
 * The diagnosable half stays in `console.error`, server-side only.
 *
 * `CIRCUIT_OPEN_COPY` deliberately matches `process-key-client`'s
 * `CIRCUIT_OPEN_HUMAN_MESSAGE` so a breaker trip reads identically to a user
 * whichever seam mechanism they happen to hit.
 */
const CIRCUIT_OPEN_COPY =
  "The analytics service is temporarily unavailable. Please try again in a moment.";
const TIMEOUT_COPY = "Match evaluation timed out. Please try again.";
const GENERIC_COPY = "Match evaluation failed. Please try again.";

// Audit-2026-05-07 C-0041: same-origin guard runs before auth so a
// cross-origin probe with a replayed session cookie hits the CSRF wall
// before any DB/RPC work. Sibling /api/admin/match/{decisions,kill-switch,
// send-intro,recompute} POST/DELETE handlers follow the same pattern.
export async function GET(req: NextRequest): Promise<NextResponse> {
  const csrfError = assertSameOrigin(req);
  if (csrfError) return csrfError;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  // P444 (audit-2026-05-07) — RFC 7235: 401 unauthenticated, 403 forbidden.
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE_HEADERS });
  }
  if (!(await isAdminUser(supabase, user))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403, headers: NO_STORE_HEADERS });
  }

  const url = new URL(req.url);
  const lookback = url.searchParams.get("lookback_days") || "28";
  const partnerTag = url.searchParams.get("partner_tag") ?? undefined;

  try {
    const data = await evalMatch({
      lookback_days: lookback,
      partner_tag: partnerTag,
    });
    return NextResponse.json(data, { headers: NO_STORE_HEADERS });
  } catch (err) {
    // Phase 140 / SEAM-04 — typed arms BEFORE the generic one.
    //
    // ⚠️ These live INSIDE the handler, after the admin gate above, and must
    // stay there (threat T-140-12). Hoisting any breaker-aware branch above
    // the gate would turn "is Railway degraded right now?" into an
    // unauthenticated oracle. Pinned by the unauthenticated+open-breaker case
    // in route.test.ts and route.seam.test.ts.
    //
    // `CircuitOpenError` is imported from the dependency-free leaf
    // `@/lib/seam-errors`, never through `@/lib/analytics-client`: this
    // route's tests mock that module, and a class picked up through a mocked
    // module is `undefined` — `err instanceof undefined` throws `TypeError`
    // from inside this very catch block (threat T-140-30).
    if (err instanceof CircuitOpenError) {
      console.error(
        `[api/admin/match/eval] circuit open — short-circuited, retry in ${err.retryAfterS}s`,
      );
      return NextResponse.json(
        { error: CIRCUIT_OPEN_COPY },
        {
          status: 503,
          headers: {
            ...NO_STORE_HEADERS,
            // Same pairing as rateLimitDenyJson (`src/lib/ratelimit.ts:263-288`).
            "Retry-After": String(err.retryAfterS),
          },
        },
      );
    }
    // A timed-out Python round-trip is a gateway timeout, not a server fault.
    if (err instanceof AnalyticsTimeoutError) {
      console.error("[api/admin/match/eval] upstream timeout:", err);
      return NextResponse.json(
        { error: TIMEOUT_COPY },
        { status: 504, headers: NO_STORE_HEADERS },
      );
    }
    // Phase 140 review / D-12 — FORWARD 4xx, KEEP 5xx GENERIC.
    //
    // Flattening every AnalyticsUpstreamError to 500 left an admin unable to
    // tell "I passed a bad parameter" from "Railway is broken" — the two have
    // completely different responses (fix the request vs page the on-call) and
    // the route erased the distinction the error class exists to preserve
    // ("Preserves the upstream status so route handlers can forward 4xx
    // semantics").
    //
    // 4xx is a CLIENT fault whose detail is a validation message the admin
    // needs, and this route is already behind isAdminUser. 5xx stays generic on
    // purpose: that detail can carry a Python traceback, and the leak closure
    // must stay shut.
    if (err instanceof AnalyticsUpstreamError && err.status < 500) {
      console.error(
        `[api/admin/match/eval] upstream rejected the request (${err.status}):`,
        err.message,
      );
      return NextResponse.json(
        { error: err.message },
        { status: err.status, headers: NO_STORE_HEADERS },
      );
    }
    console.error("[api/admin/match/eval] upstream error:", err);
    return NextResponse.json(
      { error: GENERIC_COPY },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}
