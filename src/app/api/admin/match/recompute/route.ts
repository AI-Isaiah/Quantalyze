import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isAdminUser } from "@/lib/admin";
import { assertSameOrigin } from "@/lib/csrf";
import { AnalyticsTimeoutError, recomputeMatch } from "@/lib/analytics-client";
import { CircuitOpenError } from "@/lib/seam-errors";
import { CIRCUIT_OPEN_COPY } from "@/lib/seam-copy";
import { adminActionLimiter, checkLimit } from "@/lib/ratelimit";
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
 * assumption: this route spends one `match-recompute` budget (30s), 10×
 * headroom.
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
 * The breaker body is NOT declared here. `CIRCUIT_OPEN_COPY` is imported from
 * `@/lib/seam-copy` — the ONE declaration all ten seam emitters read — so a
 * breaker trip reads identically to a user whichever seam mechanism they happen
 * to hit, and no single route can be reworded out of step with the other nine
 * (SEAMUX-01). It still matches `process-key-client`'s
 * `CIRCUIT_OPEN_HUMAN_MESSAGE` because both are now aliases of that one leaf.
 */
const TIMEOUT_COPY = "Match recompute timed out. Please try again.";
const GENERIC_COPY = "Match recompute failed. Please try again.";

export async function POST(req: NextRequest): Promise<NextResponse> {
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

  let body: { allocator_id?: string; force?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400, headers: NO_STORE_HEADERS });
  }

  if (!body.allocator_id || typeof body.allocator_id !== "string") {
    return NextResponse.json({ error: "allocator_id is required" }, { status: 400, headers: NO_STORE_HEADERS });
  }

  // B15b (audit-2026-05-07): rate-limit AFTER validating allocator_id so an
  // invalid body never consumes one of the admin's tokens.
  const rl = await checkLimit(adminActionLimiter, `match-recompute:${user!.id}`);
  if (!rl.success) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { ...NO_STORE_HEADERS, "Retry-After": String(rl.retryAfter) } },
    );
  }

  try {
    // C-PR5-01 (audit-2026-05-07): forward the authenticated admin's
    // user.id as actor_id so analytics-service can assert the actor is
    // entitled to recompute this allocator. Defense-in-depth against a
    // future Next.js route that drops the admin gate above.
    const result = await recomputeMatch(
      body.allocator_id,
      body.force ?? false,
      user.id,
    );
    return NextResponse.json(result, { headers: NO_STORE_HEADERS });
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
        `[api/admin/match/recompute] circuit open — short-circuited, retry in ${err.retryAfterS}s`,
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
      console.error("[api/admin/match/recompute] upstream timeout:", err);
      return NextResponse.json(
        { error: TIMEOUT_COPY },
        { status: 504, headers: NO_STORE_HEADERS },
      );
    }
    console.error("[api/admin/match/recompute] error:", err);
    return NextResponse.json(
      { error: GENERIC_COPY },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}
