import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { withPublishedOrOwner } from "@/lib/visibility";
import { withAllocatorAuth, type AllocatorUser } from "@/lib/api/withAllocatorAuth";
import { NO_STORE_HEADERS } from "@/lib/api/headers";
import { captureToSentry } from "@/lib/sentry-capture";
import { userActionLimiter, checkLimit } from "@/lib/ratelimit";
import { displayStrategyName } from "@/lib/strategy-display";
import type { DisclosureTier } from "@/lib/types";

/**
 * Phase 10 / Plan 10-03 — GET /api/strategies/browse
 *
 * Returns the verified-strategies catalog used by Plan 05's
 * StrategyBrowseDrawer. Authenticated allocators only; per-user
 * rate-limited to prevent enumeration abuse (T-10-04).
 *
 * Why this lives here and not on the dashboard payload:
 *   The drawer is opened on demand (most allocators never open it on
 *   most loads). Pinning ~tens of strategy rows on every dashboard SSR
 *   is unnecessary bandwidth + latency. RESEARCH Pattern 6 captures
 *   the lazy-on-drawer-open contract explicitly.
 *
 * Why no mandate-fit chip is computed here:
 *   `mandate_fit_score` does not exist on the strategies table
 *   (RESEARCH Pitfall 7). The chip is derived CLIENT-SIDE in Plan 05
 *   from these strategy fields + the allocator's mandate preferences
 *   (already on MyAllocationDashboardPayload).
 *
 * M10 — LIMIT 200 cap is documented inline.
 */

// AGENTS.md: default to the Node.js runtime explicitly. The route
// touches the supabase server client; Edge runtime would skip the
// Node-only paths the cookie store relies on.
export const runtime = "nodejs";

export interface BrowseStrategyRow {
  id: string;
  /**
   * Audit C-0112 — display label only. For `disclosure_tier='institutional'`
   * rows this is the real strategy name; for exploratory rows it is the
   * codename (when present) or a synthetic `Strategy #<id-prefix>` label
   * derived by `displayStrategyName`. The raw `strategies.name` column is
   * NEVER emitted on exploratory rows because pairing it with the codename
   * defeats the pseudonymity contract (the drawer search would otherwise
   * cross-correlate a known real name back to its codename).
   */
  name: string;
  codename: string | null;
  markets: string[];
  strategy_types: string[];
  /**
   * Phase 29 / UNIFY-03 — provenance tag for the unified Browse drawer. `true`
   * marks an example-universe row (`is_example=true AND status='published'`)
   * so the drawer can render the neutral-outline "Example" pill. This is a
   * co-fetched flag, NOT a published-bypass: example rows are just published
   * rows that ALSO carry the flag — they still flow through `withPublishedOrOwner`
   * (RLS + defence-in-depth) and `displayStrategyName` (pseudonymity) like any
   * verified row. Verified rows carry `false`.
   */
  is_example: boolean;
}

/**
 * Wire contract for GET /api/strategies/browse (F5b review #1/#6/#8). Exporting
 * + annotating the response payload means `has_more` / `limit` cannot be
 * renamed or dropped without a compile error, and a consumer that wants to
 * honor truncation can import this rather than re-declaring the shape inline.
 *
 * `limit` is the hard alphabetical cap (NOT a `page_size` — there is no
 * offset/cursor; `has_more: true` signals "refine your filter", not "load the
 * next page"). This intentionally differs from portfolio-alerts' cursored
 * `{ page_size, offset, has_more }` paginator. The drawer does not yet surface
 * `has_more` (the catalog is well under the cap today); wiring a truncation
 * notice is a deferred UX follow-up, not a wire change.
 */
export interface BrowseResponse {
  strategies: BrowseStrategyRow[];
  has_more: boolean;
  limit: number;
}

// M10 — Pin LIMIT 200. Verified strategy count is in the low tens today;
// the v0.16 strategy-onboarding push is expected to multiply this. The
// drawer contract is "browse first 200 alphabetical" with no pagination
// in v0.15. Documented cap; raise (and add pagination) when v0.16 lands.
const STRATEGY_BROWSE_LIMIT = 200;

export const GET = withAllocatorAuth(
  async (req: NextRequest, user: AllocatorUser): Promise<NextResponse> => {
    void req;
    const rl = await checkLimit(
      userActionLimiter,
      `strategies_browse:${user.id}`,
    );
    if (!rl.success) {
      return NextResponse.json(
        { error: "Too many requests" },
        {
          status: 429,
          headers: { ...NO_STORE_HEADERS, "Retry-After": String(rl.retryAfter) },
        },
      );
    }

    const supabase = await createClient();
    // CONTRIB-03 — owner-inclusive Browse discovery. Two-layer contract:
    //   1. Query-builder isolation: withPublishedOrOwner appends the
    //      `status.eq.published,user_id.eq.<sessionId>` predicate, mirroring
    //      the `strategies_read` RLS shape EXACTLY (published OR the caller's
    //      OWN rows) so an owner sees their own not-yet-published strategies
    //      while everyone else sees only published ones.
    //   2. RLS backstop: the `strategies_read` policy
    //      (`status='published' OR user_id=auth.uid()`) still gates the read,
    //      so even if the predicate were dropped no cross-tenant row leaks.
    // The owner id is `user.id` from withAllocatorAuth — session-only, NEVER a
    // request param (T-110-05/07). The admin / service-role client is
    // intentionally NOT used here (Pitfall 4): service_role has BYPASSRLS, so a
    // swap to the admin client would turn RLS OFF and the owner-OR would leak
    // every user's private rows. What keeps the owner-OR OFF a service-role
    // client is the `createClient()` above (a user-scoped client) — enforced by
    // code review, NOT by the no-owner-or-on-admin-client lint (that rule only
    // bans a RAW owner-OR outside withPublishedOrOwner and cannot see an admin
    // client handed INTO the helper, whose `.or()` is marker-exempt). RLS is the
    // backstop for a DIFFERENT failure — the predicate being dropped on this
    // user-scoped client. Keep this call on the user-scoped client.
    // Audit C-0112 — co-fetch `disclosure_tier` so the response mapping
     // can suppress the real `name` for non-institutional rows. Ordering
     // still happens on `name` server-side (alphabetical browse is the
     // drawer contract); the leak prevention is in the projection step
     // below, not in the SELECT/ORDER list.
    const { data, error } = await withPublishedOrOwner(
      supabase
        .from("strategies")
        .select(
          // Phase 29 / UNIFY-03 — co-fetch `is_example` so the response can
          // TAG example-universe rows in the unified Browse drawer. This is
          // NOT an extra `is_example.eq.true` OR leg that would bypass the
          // owner-inclusive predicate: example rows are published rows that
          // ALSO carry the flag, so `withPublishedOrOwner` + RLS still gate
          // the SET, and the flag is only read to drive the "Example" pill.
          "id, name, codename, disclosure_tier, markets, strategy_types, is_example",
        ),
      user.id,
    )
      .order("name", { ascending: true })
      // M-0343 (audit-2026-05-07 F5b): fetch one row past the cap so the
      // response can honestly signal truncation. Without a has_more flag a
      // client silently sees only the first STRATEGY_BROWSE_LIMIT rows once
      // the verified catalog grows past it, with no contract-level signal.
      .limit(STRATEGY_BROWSE_LIMIT + 1);

    if (error) {
      // F5b (R8): do not forward the raw Postgres error.message (column names /
      // SQLSTATE / schema detail) to the allocator. Log + capture server-side;
      // return a static envelope — mirrors the F5a redaction in bridge/simulator.
      console.error("[api/strategies/browse] select error:", error);
      captureToSentry(error, { tags: { route: "api/strategies/browse" } });
      return NextResponse.json(
        { error: "Failed to load strategies" },
        { status: 500, headers: NO_STORE_HEADERS },
      );
    }

    // W2 — defensive null mapping. PostgreSQL text[] columns can be NULL
    // even with a NOT NULL DEFAULT '{}' contract on older rows; clamp
    // them to [] so downstream consumers (the drawer's filter pills, the
    // mandate-fit chip computation) can iterate without a null check.
    //
    // Audit C-0112 — `name` is run through `displayStrategyName` so the
    // raw strategies.name column is suppressed on any row whose
    // `disclosure_tier !== 'institutional'`. This mirrors the rule
    // applied by /api/demo/match and the Match Queue: codename wins;
    // institutional rows may surface the real name; exploratory rows
    // missing a codename collapse to a synthetic `Strategy #<id>`.
    // Without this guard, the drawer's case-insensitive search keyed on
    // `name || codename` lets an attacker who knows a real strategy
    // name look it up and read its codename — defeating the
    // pseudonymity contract for the entire verified catalog.
    // M-0343: the +1 probe row tells us the catalog exceeds the cap. Drop it
    // from the payload and surface `has_more` so a consumer CAN warn instead of
    // silently truncating (the drawer does not yet — deferred UX follow-up,
    // see BrowseResponse). `limit` is echoed so the contract is self-describing
    // and a future cursor/total field is an additive (non-breaking) change.
    const rows = data ?? [];
    const hasMore = rows.length > STRATEGY_BROWSE_LIMIT;
    const pageRows = hasMore ? rows.slice(0, STRATEGY_BROWSE_LIMIT) : rows;

    const strategies: BrowseStrategyRow[] = pageRows.map((row) => {
      const r = row as {
        id: string;
        name: string;
        codename: string | null;
        disclosure_tier: DisclosureTier | null;
        markets: unknown;
        strategy_types: unknown;
        is_example: unknown;
      };
      const tier: DisclosureTier = r.disclosure_tier ?? "exploratory";
      // Phase 29 / UNIFY-03 — `displayStrategyName` runs on example rows too:
      // the provenance tag must NOT reintroduce a raw-name leak. An example
      // row whose tier is exploratory still surfaces its codename / synthetic
      // label, never `strategies.name` (T12-class pseudonymity contract).
      const safeLabel = displayStrategyName({
        id: r.id,
        name: r.name,
        codename: r.codename,
        disclosure_tier: tier,
      });
      return {
        id: r.id,
        name: safeLabel,
        codename: r.codename ?? null,
        markets: Array.isArray(r.markets) ? (r.markets as string[]) : [],
        strategy_types: Array.isArray(r.strategy_types)
          ? (r.strategy_types as string[])
          : [],
        // H-0300 fence: explicit named key (NOT a `...row` spread). Coerce to a
        // strict boolean so a NULL/undefined source column never widens the
        // wire shape beyond `boolean`.
        is_example: r.is_example === true,
      };
    });

    const body: BrowseResponse = {
      strategies,
      has_more: hasMore,
      limit: STRATEGY_BROWSE_LIMIT,
    };
    return NextResponse.json(body, { status: 200, headers: NO_STORE_HEADERS });
  },
);
