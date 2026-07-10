/**
 * Phase 29 / Plan 29-01 / UNIFY-04 — GET /api/strategies/[id]/returns
 *
 * The scoped lazy-returns route. Supplies ONE published strategy's
 * `daily_returns` series under the RLS-scoped server client. This is the
 * data-supply backbone that lets a catalog-added strategy actually move the
 * composer's projection.
 *
 * Why this exists (29-RESEARCH reason #2):
 *   `MyAllocationDashboardPayload.strategies` is BOOK-ONLY (the allocator's
 *   `portfolio_strategies` join). A strategy added from the Browse drawer — be
 *   it a verified or an example-universe row — is not already in the book, so
 *   `addedStrategyReturnsLookup` has no series for it and it contributes `[]`
 *   (warm-up-gated out). A single scoped lazy fetch closes that gap for BOTH
 *   catalog halves (the H-0133 / example-add data gap).
 *
 * Why lazy + scoped, not SSR-lifted (29-RESEARCH "SSR-LIFT vs LAZY-FETCH"):
 *   The example universe is ~588 KB raw / ~87 KB gzip across 15 rows; SSR-
 *   lifting that onto every composer load for data most allocators never touch
 *   contradicts the drawer's own lazy-on-open contract. Lazy costs ~7 KB gzip
 *   for the ONE strategy actually added. One id per call — NEVER an unbounded
 *   pull (the exit-gate scope guard).
 *
 * Why the RLS-scoped client, never the service-role / admin bypass (LOCKED
 * exit gate, T-29-01/04):
 *   The `analytics_read` RLS policy already permits any caller to read
 *   `strategy_analytics` for a `status='published'` strategy (verified live:
 *   anon read 200). So `createClient()` reads the series without bypassing RLS.
 *   The legacy /scenarios Strategy-Sandbox page (retired in Phase 32) read this
 *   series via an RLS-bypassing service-role client — the anti-pattern this
 *   route explicitly refuses to carry over. The service-role helper is
 *   intentionally NOT imported here (grep-asserted by the route test + the plan
 *   acceptance criteria).
 *
 * AGENTS.md / Next.js 16 async dynamic params: the `[id]` route param is a
 * Promise on the route context — `ctx.params` MUST be awaited (verified
 * against node_modules/next/dist/docs/.../route.md:80-103). The
 * `withAllocatorAuth` wrapper does NOT forward the route context (it calls the
 * handler with `(req, user)` only — withAllocatorAuth.ts:54-61), so this
 * handler awaits `ctx.params` itself, validates the uuid, then delegates to a
 * `withAllocatorAuth`-wrapped inner handler invoked with `req` while closing
 * over the validated id. Mirrors saved/[id]/route.ts:142-147 (B15 ordering:
 * validate the structurally-bad input FIRST so a 400 never burns a token).
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { withPublishedOnly } from "@/lib/visibility";
import { withAllocatorAuth, type AllocatorUser } from "@/lib/api/withAllocatorAuth";
import { NO_STORE_HEADERS } from "@/lib/api/headers";
import { captureToSentry } from "@/lib/sentry-capture";
import {
  userActionLimiter,
  checkLimit,
  isRateLimitMisconfigured,
} from "@/lib/ratelimit";
import { isUuid } from "@/lib/utils";
import { normalizeDailyReturns, type DailyPoint } from "@/lib/portfolio-math-utils";

// AGENTS.md: default to the Node.js runtime explicitly. The route touches the
// supabase server client; Edge runtime would skip the Node-only paths the
// cookie store relies on.
export const runtime = "nodejs";

type RouteCtx = { params: Promise<{ id: string }> };

/**
 * Wire contract for GET /api/strategies/[id]/returns. Exporting + annotating
 * the response means `daily_returns` cannot be renamed or dropped without a
 * compile error, and the composer's lazy-returns consumer can import this
 * rather than re-declaring the shape inline.
 */
export interface ReturnsResponse {
  daily_returns: DailyPoint[];
  /**
   * #597 part 2 (BLEND-01) — the strategy's asset class ('crypto' |
   * 'traditional', null when unset). Carried so a drawer-added, NON-book
   * strategy (whose asset_class is absent from the book-only SSR payload) can
   * still feed the composer's blend basis (`blendPeriodsPerYear`, √365 if any
   * leg is crypto else √252). This is PUBLIC classification data — it is already
   * rendered on public factsheets since #597 — and it is sourced from the SAME
   * published-only probe below, so widening the response leaks nothing the 404
   * existence-oracle didn't already gate (T-84-05a: accept).
   */
  asset_class: string | null;
}

export async function GET(
  req: NextRequest,
  ctx: RouteCtx,
): Promise<NextResponse> {
  const { id } = await ctx.params;
  // uuid validated FIRST (400 on malformed — maps a would-be 22P02 to a clean
  // non-retryable 400, no schema leak; runs BEFORE auth/rate-limit so
  // structurally-bad input never burns a token — saved/[id] B15 ordering).
  if (!isUuid(id)) {
    return NextResponse.json(
      { error: "Invalid strategy id" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  return withAllocatorAuth(
    async (_req: NextRequest, user: AllocatorUser): Promise<NextResponse> => {
      // Per-user rate-limit, keyed on the authenticated user (NOT the id, so a
      // caller cannot dodge the limit by enumerating ids). B15: runs after the
      // uuid validation above. 503 on a misconfigured limiter so canary/health
      // checks see the outage rather than a throttle.
      const rl = await checkLimit(userActionLimiter, `returns:${user.id}`);
      if (!rl.success) {
        if (isRateLimitMisconfigured(rl)) {
          return NextResponse.json(
            { error: "Rate limiter unavailable" },
            {
              status: 503,
              headers: {
                ...NO_STORE_HEADERS,
                "Retry-After": String(rl.retryAfter),
              },
            },
          );
        }
        return NextResponse.json(
          { error: "Too many requests" },
          {
            status: 429,
            headers: {
              ...NO_STORE_HEADERS,
              "Retry-After": String(rl.retryAfter),
            },
          },
        );
      }

      const supabase = await createClient();
      // Published-existence probe (defense-in-depth over RLS): a row that is
      // unpublished, non-existent, or cross-tenant (not readable under RLS)
      // resolves to null → 404. We do NOT reveal whether the id exists for
      // another tenant (T-29-01 / existence-oracle mitigation — 404, not 403).
      // `status='published'` (via withPublishedOnly + the analytics_read RLS
      // policy) covers BOTH verified AND example published rows — `is_example`
      // is a flag, not a separate gate.
      // #597 part 2 (BLEND-01) — widen the probe to also read `asset_class`. It
      // is public classification data (rendered on public factsheets since #597)
      // and stays behind the SAME published-only gate, so this reveals nothing
      // the existing existence-oracle didn't already gate (404 on unpublished /
      // cross-tenant is unchanged — T-84-05a).
      const { data: strat } = await withPublishedOnly(
        supabase.from("strategies").select("id, asset_class").eq("id", id),
      ).maybeSingle();
      if (!strat) {
        return NextResponse.json(
          { error: "Not found" },
          { status: 404, headers: NO_STORE_HEADERS },
        );
      }

      const { data, error } = await supabase
        .from("strategy_analytics")
        .select("daily_returns")
        .eq("strategy_id", id)
        .maybeSingle();

      if (error) {
        // Do not forward the raw Postgres error.message (column names /
        // SQLSTATE / schema detail) to the allocator. Log + capture
        // server-side; return a static envelope — mirrors the browse-route
        // F5b redaction (T-29-02).
        console.error("[api/strategies/returns] select error:", error);
        captureToSentry(error, { tags: { route: "api/strategies/returns" } });
        return NextResponse.json(
          { error: "Failed to load returns" },
          { status: 500, headers: NO_STORE_HEADERS },
        );
      }

      // Normalize the raw JSONB through the canonical parser, NOT a bare
      // Array.isArray cast. `strategy_analytics.daily_returns` is TYPED as a
      // year-keyed nested record (types.ts:304) and the Python analytics writer
      // can store it that way; reading the column RAW from the DB here (no
      // queries.ts flattening, unlike the book path) means the nested shape
      // reaches us directly. A bare `Array.isArray(raw) ? raw : []` would
      // silently drop a real nested-shape series to [] — the exact WR-05
      // silent-data-loss the book path's normalizeBookReturns already guards.
      // normalizeDailyReturns handles array + flat-dict + nested-record,
      // validates every point, and date-sorts. A genuinely absent/NULL/unusable
      // value still collapses to [] (honest empty, 29-RESEARCH Pitfall 4 — the
      // added strategy is then warm-up-gated out until a real series exists,
      // which is correct), NEVER a fabricated series.
      const raw = (data as { daily_returns: unknown } | null)?.daily_returns;
      const daily_returns: DailyPoint[] = normalizeDailyReturns(raw);

      // BLEND-01 — forward the published strategy's asset_class (null when
      // unset). `strat` is the widened probe row; a stale build that predates the
      // widening simply omits it → null (the composer tolerates absence).
      const asset_class =
        (strat as { asset_class?: string | null }).asset_class ?? null;
      const body: ReturnsResponse = { daily_returns, asset_class };
      return NextResponse.json(body, { status: 200, headers: NO_STORE_HEADERS });
    },
  )(req);
}
