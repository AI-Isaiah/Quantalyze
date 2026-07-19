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
import { withPublishedOrOwner } from "@/lib/visibility";
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
import { readPublicVerificationSignals } from "@/lib/queries";

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
  /**
   * Phase 111 / CONSTIT-02 (BLEND-01 widening pattern) — the drawer-added
   * strategy's provenance trust tier, picked from the most-recent
   * `strategy_verifications` row on the SAME published-gated probe (D-04:
   * trust_tier lives ONLY on strategy_verifications). `null` when the strategy
   * has no verification rows OR on a stale build predating this field (the
   * composer tolerates absence → null provenance, never a throw). PUBLIC
   * metadata already rendered on factsheets / watchlist — no new disclosure
   * surface beyond what the 404 existence-oracle already gates (T-111-03).
   */
  trust_tier: string | null;
  /**
   * Phase 111 / CONSTIT-02 — server-coerced composite discriminator, strict
   * `data_quality_flags.composite === true` (T-111-04). Drives the `composite`
   * provenance badge for drawer-added constituents. The RAW data_quality_flags
   * blob is NEVER forwarded — only this boolean projection (T-111-03).
   */
  is_composite: boolean;
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
      // Owner-inclusive existence probe (defense-in-depth over RLS): a row that
      // is non-existent, or cross-tenant (another owner's unpublished row, not
      // readable under RLS) resolves to null → 404. We do NOT reveal whether the
      // id exists for another tenant (T-29-01 / existence-oracle mitigation —
      // 404, not 403).
      // CONTRIB-03 loop closure — the probe mirrors the Browse route EXACTLY:
      // `withPublishedOrOwner(..., user.id)` appends
      // `status.eq.published,user_id.eq.<sessionId>` (mirroring the
      // `strategies_read` RLS shape). Browse became owner-inclusive so an
      // allocator's OWN not-yet-published contribution appears in the drawer;
      // this probe MUST admit that same owner-own private row or adding it
      // silently 404s and warm-up-gates out of the blend (the exact contribute→
      // compose case v1.11 is built for). `published` still covers BOTH verified
      // AND example published rows for every OTHER caller — `is_example` is a
      // flag, not a separate gate. Cross-tenant isolation is preserved: another
      // owner's private row matches neither leg → null → 404 (no existence
      // leak). The `analytics_read` RLS policy is ALSO owner-inclusive
      // (`published OR user_id=auth.uid()`, rls_policies.sql:36-42), so the
      // series read below serves the owner's own private analytics too.
      // `user.id` is session-only (withAllocatorAuth), NEVER a request param.
      // #597 part 2 (BLEND-01) — widen the probe to also read `asset_class`. It
      // is public classification data (rendered on public factsheets since #597)
      // and stays behind the SAME published-only gate, so this reveals nothing
      // the existing existence-oracle didn't already gate (404 on unpublished /
      // cross-tenant is unchanged — T-84-05a).
      // Phase 126-04 (FACTSHEET-01 hardening) — the trust_tier signal is NO
      // LONGER read via an RLS-scoped `strategy_verifications` embed on this
      // probe. That embed rides the owner-only RLS on strategy_verifications, so
      // it returned ZERO rows for a NON-owner allocator adding another manager's
      // published strategy to the drawer — the api_verified badge silently
      // vanished (same class as the public-factsheet gap fixed in 126-01). The
      // signal now comes from `readPublicVerificationSignals` (the DB
      // `get_published_trust_signals` SECURITY DEFINER primitive, migration 135),
      // read below. The probe stays scoped to `id, asset_class` (existence +
      // public classification); it no longer over-fetches the verification table.
      const { data: strat, error: probeError } = await withPublishedOrOwner(
        supabase
          .from("strategies")
          .select("id, asset_class")
          .eq("id", id),
        user.id,
      ).maybeSingle();
      if (probeError) {
        // error-absent ≠ legit-absent: a PostgREST error (e.g. asset_class column
        // schema drift) returns {data:null,error} and would 404 a REAL published
        // strategy with no signal. The 404 stays (never an oracle), but log the
        // breadcrumb server-side so a schema fault is debuggable (Rule 12).
        console.error("[api/strategies/returns] probe error:", probeError);
        captureToSentry(probeError, {
          tags: { route: "api/strategies/returns", stage: "probe" },
        });
      }
      if (!strat) {
        return NextResponse.json(
          { error: "Not found" },
          { status: 404, headers: NO_STORE_HEADERS },
        );
      }

      // Phase 111 / CONSTIT-02 — widen the series read to also fetch
      // data_quality_flags so is_composite can be derived server-side. Only the
      // strict `composite === true` boolean is forwarded; the raw blob (venue
      // detail) never leaves the server (T-111-03).
      const { data, error } = await supabase
        .from("strategy_analytics")
        .select("daily_returns, data_quality_flags")
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

      // Phase 126-04 — the PUBLIC trust_tier signal via the correct-by-
      // construction DB primitive (get_published_trust_signals, migration 135):
      // published-gated + column-scoped (trust_tier+status only) + readable by a
      // NON-owner. A drawer-added strategy with no verification row, or an
      // unpublished one, → null (never a throw; fail-soft empty map).
      const signals = await readPublicVerificationSignals([id]);
      const trust_tier: string | null = signals.get(id)?.trust_tier ?? null;

      // CONSTIT-02 — strict `=== true` composite coercion (T-111-04). The raw
      // data_quality_flags blob is read here but only the boolean is emitted.
      const dqf = (data as { data_quality_flags?: unknown } | null)?.data_quality_flags as
        | { composite?: unknown }
        | null
        | undefined;
      const is_composite = dqf?.composite === true;

      const body: ReturnsResponse = {
        daily_returns,
        asset_class,
        trust_tier,
        is_composite,
      };
      return NextResponse.json(body, { status: 200, headers: NO_STORE_HEADERS });
    },
  )(req);
}
