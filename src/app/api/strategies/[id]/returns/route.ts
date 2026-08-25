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
import type { DailyPoint } from "@/lib/portfolio-math-utils";
import { resolveDailyReturnSeries } from "@/lib/factsheet/resolve-series";
import {
  deriveEmptySeriesState,
  isRankableAnalyticsRow,
  type SeriesState,
} from "@/lib/closed-sets";
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
  /**
   * Phase 147 / SCEN-01 (UI-SPEC §3) — what an EMPTY `daily_returns` MEANS.
   * `daily_returns.length === 0` cannot distinguish "the analytics job is still
   * running" from "this strategy genuinely has no series", so deriving the
   * distinction client-side from array length would guarantee one of the two
   * readings is a lie. The server owns it: a resolved non-empty series is
   * `available`; an empty one is discriminated by `deriveEmptySeriesState`
   * against `strategy_analytics.computation_status` — age-bounded at 16h when
   * there is no analytics row at all, so a never-enqueued strategy cannot spin
   * "Syncing" forever. Additive: the happy-path shape is otherwise
   * byte-identical, so a composer build that ignores this field is unaffected.
   *
   * Disclosure (T-147-04): emitted only AFTER the withPublishedOrOwner probe
   * has already 404'd a non-existent / unpublished / cross-tenant id, so it
   * reveals nothing the existing 404 existence-oracle did not already gate —
   * the same argument as asset_class and trust_tier above.
   */
  series_state: SeriesState;
  /**
   * Phase 162 / HONEST-05 — the strategy's headline CAGR, co-served from the
   * SAME analytics row the series comes from, so a drawer-added leg renders the
   * metric pair a BOOK row already shows (the book path gets it from the
   * allocator join; a non-book leg had no source at all and rendered a
   * permanent em-dash).
   *
   * `null` unless `isRankableAnalyticsRow` holds for this row — the SAME
   * predicate that withholds the series. STALE-01 closed nine surfaces that
   * served a dead run's scalars as if they were current; widening this route
   * without carrying the gate through would re-open that class through a fresh
   * door. Also `null` on a stale build predating the widened select, and on a
   * row whose column is genuinely unset. NEVER 0 — a missing metric is an
   * em-dash at every consumer, never a number.
   */
  cagr: number | null;
  /**
   * Phase 162 / HONEST-05 — the strategy's headline Sharpe ratio. Same source,
   * same `isRankableAnalyticsRow` gate, same never-zero rule as `cagr` above.
   */
  sharpe: number | null;
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
      // Phase 147 / SCEN-01 — widen it again for `returns_series` and
      // `computation_status`. The analytics-service writes the cumprod EQUITY
      // curve to `returns_series` and leaves `daily_returns` NULL (that column
      // is only populated by CSV ingest), so reading `daily_returns` alone
      // returned [] for EVERY service-computed strategy — the drawer-added
      // strategy then contributed nothing and was warm-up-gated out of the
      // blend. This is the SAME select width the already-correct factsheet v2
      // read uses (factsheet/[id]/v2/page.tsx:45).
      // Phase 162 / HONEST-05 — widen it once more for `cagr` and `sharpe`, the
      // headline scalars a drawer-added leg had no source for. Disclosure is
      // unchanged for ALL of these columns by the same sentence: `analytics_read`
      // RLS is table-level (published OR owner) — there are no column grants, so
      // naming more columns in the projection cannot widen who may read the row —
      // and `returns_series`, `cagr` and `sharpe` are all already served publicly
      // for published strategies by that same factsheet (T-147-03 / T-162-04-C).
      // Neither raw series column is forwarded; only the RESOLVED series, the
      // derived state, and the GATED scalars ship.
      const { data, error } = await supabase
        .from("strategy_analytics")
        .select(
          "daily_returns, returns_series, computation_status, data_quality_flags, cagr, sharpe",
        )
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

      // Resolve the series through the ONE shared mechanism (SC2), NOT a bare
      // read of a single column and NOT a bare Array.isArray cast.
      // `resolveDailyReturnSeries` closes two independent silent-data-loss
      // holes at once:
      //   (a) `strategy_analytics.daily_returns` is TYPED as a year-keyed
      //       nested record (types.ts:304) and the Python analytics writer can
      //       store it that way; this route reads the column RAW from the DB
      //       (no queries.ts flattening, unlike the book path), so the nested
      //       shape reaches us directly. `normalizeDailyReturns` — which the
      //       resolver runs first — handles array + flat-dict + nested-record,
      //       validates every point and date-sorts (the WR-05 guard).
      //   (b) service-computed strategies leave `daily_returns` NULL entirely;
      //       their real track lives in `returns_series` as a cumprod WEALTH
      //       curve. The resolver derives the daily-return series from it by
      //       successive ratios, which is why the emitted array is N−1 points
      //       long — day one is consumed by the differencing. Forwarding the
      //       wealth index raw would read as a +100% day one and inflate every
      //       downstream metric, so it is never passed through as-is.
      // A genuinely absent/NULL/unusable value in BOTH columns still collapses
      // to [] (honest empty, 29-RESEARCH Pitfall 4 — the added strategy is then
      // warm-up-gated out until a real series exists, which is correct), NEVER
      // a fabricated series. `DailyReturn` is structurally `DailyPoint`.
      const analyticsRow = data as {
        daily_returns?: unknown;
        returns_series?: unknown;
        computation_status?: unknown;
        cagr?: unknown;
        sharpe?: unknown;
      } | null;
      const status =
        typeof analyticsRow?.computation_status === "string"
          ? analyticsRow.computation_status
          : null;
      // STALE-01 — `computation_status` was already read on this route, but it
      // only ever LABELLED a series that was already empty. A row at `failed`
      // still holds the previous run's `daily_returns` / `returns_series`, so
      // the resolver returned a full track, `daily_returns.length === 0` was
      // false, and the route answered `series_state: "available"` — a positive
      // claim that this series is the strategy's current one — while the status
      // column sitting in the same row said the run did not finish. The
      // discriminator ran on every case except the one that needed it.
      //
      // Withholding the SERIES (not just re-labelling it) is what makes the
      // answer honest, because the consumer is an arithmetic one: the
      // ScenarioComposer BLENDS this array into a portfolio projection. A
      // "computing"/"empty" label beside a usable array would be ignored by the
      // maths and the dead track would still move the blend.
      //
      // Emptying it routes the row into `deriveEmptySeriesState` — the SAME
      // shared ladder, no second status table (UI-SPEC §3 / SC2) — which the
      // composer already renders as its "syncing" or "no-series" chip and
      // warm-up-gates out of the blend. Existing vocabulary, existing chips: a
      // `failed` row resolves to "empty" (deliberately NOT a red error state),
      // a live job to "computing".
      //
      // Phase 162 / HONEST-05 — ONE decision, reused. The widened scalars
      // (`cagr` / `sharpe`) below are withheld by THIS boolean, not by a second
      // status ladder of their own: a row whose run did not finish is one row,
      // and everything it carries is equally dead. Deciding it twice is how the
      // two answers would eventually drift apart.
      const analyticsRankable = isRankableAnalyticsRow({
        computation_status: status,
      });
      const daily_returns: DailyPoint[] = analyticsRankable
        ? resolveDailyReturnSeries(
            analyticsRow?.daily_returns,
            analyticsRow?.returns_series,
          )
        : [];

      // HONEST-05 — the co-served scalars, gated at the SAME decision point.
      // `Number.isFinite` rather than `typeof === "number"` so a NaN/Infinity
      // that reached the column cannot render as a metric; and `?? null` never
      // collapses to 0 (a missing metric is an em-dash downstream, never a
      // number — the hard project rule).
      const cagr =
        analyticsRankable && Number.isFinite(analyticsRow?.cagr)
          ? (analyticsRow?.cagr as number)
          : null;
      const sharpe =
        analyticsRankable && Number.isFinite(analyticsRow?.sharpe)
          ? (analyticsRow?.sharpe as number)
          : null;

      // SCEN-01 / UI-SPEC §3 — say what an EMPTY series MEANS, server-side. A
      // non-empty resolved series is self-evidently `available`; only the empty
      // case needs the discriminator, and it is the SHARED one (never a second
      // inlined status ladder).
      let series_state: SeriesState = "available";
      if (daily_returns.length === 0) {
        // The strategy's age is needed ONLY to bound the missing-analytics-row
        // arm (P5: no trigger creates that row on INSERT and no cron backstops
        // a MISSING one, so an un-enqueued strategy would otherwise spin
        // "Syncing" forever). It comes from a SEPARATE lazy read rather than a
        // widened existence probe because that probe's `.select("id,
        // asset_class")` is pinned byte-for-byte by
        // phase-84-asset-class-flow.test.ts:42. Lazy = zero cost on the happy
        // path: this fires only when the series is empty AND no analytics row
        // exists at all. Fail-soft by design — a read error or an absent row
        // yields a null age, and deriveEmptySeriesState then answers "empty"
        // (honest absence), never an unbounded spinner.
        let strategyCreatedAt: string | null = null;
        if (analyticsRow === null) {
          const { data: ageRow, error: ageError } = await supabase
            .from("strategies")
            .select("created_at")
            .eq("id", id)
            .maybeSingle();
          if (ageError) {
            // error-absent ≠ legit-absent (Rule 12): log the breadcrumb so a
            // schema/RLS fault is debuggable, then degrade to honest absence.
            console.error("[api/strategies/returns] age read error:", ageError);
          }
          const createdAt = (ageRow as { created_at?: unknown } | null)
            ?.created_at;
          strategyCreatedAt = typeof createdAt === "string" ? createdAt : null;
        }
        series_state = deriveEmptySeriesState(status, strategyCreatedAt);
      }

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
        series_state,
        cagr,
        sharpe,
      };
      return NextResponse.json(body, { status: 200, headers: NO_STORE_HEADERS });
    },
  )(req);
}
