import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { withPublishedOnly } from "@/lib/visibility";
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
}

// M10 — Pin LIMIT 200. Verified strategy count is in the low tens today;
// the v0.16 strategy-onboarding push is expected to multiply this. The
// drawer contract is "browse first 200 alphabetical".
//
// M-0343 (F5b): the route fetches LIMIT+1 and returns a `has_more` flag so
// the client gets a contract-level signal once the catalog exceeds the cap,
// instead of silently rendering a truncated first page with no indication.
// The field is additive — existing `{ strategies }` consumers are unaffected
// — so a future cursor/offset rollout is not a breaking change.
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
    // RLS on `strategies` enforces SELECT for `status='published'` rows
    // for authenticated callers — same client choice as
    // getStrategiesByCategory in src/lib/queries.ts. The admin / service-
    // role client is intentionally NOT used here: a read-only catalog of
    // published strategies has no need to bypass RLS.
    // Audit C-0112 — co-fetch `disclosure_tier` so the response mapping
     // can suppress the real `name` for non-institutional rows. Ordering
     // still happens on `name` server-side (alphabetical browse is the
     // drawer contract); the leak prevention is in the projection step
     // below, not in the SELECT/ORDER list.
    const { data, error } = await withPublishedOnly(
      supabase
        .from("strategies")
        .select("id, name, codename, disclosure_tier, markets, strategy_types"),
    )
      .order("name", { ascending: true })
      // M-0343 (F5b): fetch one extra row to detect a truncated page without
      // a separate COUNT round-trip. The probe row is sliced off below.
      .limit(STRATEGY_BROWSE_LIMIT + 1);

    if (error) {
      // F5b (R8): do not forward the raw Postgres error.message (column
      // names / SQLSTATE / schema detail) to the allocator. Log + capture
      // server-side; return a static envelope — mirrors the F5a redaction
      // applied to the bridge / simulator routes.
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
    // M-0343 (F5b): we fetched LIMIT+1; `has_more` signals the catalog
    // exceeds the cap. Slice back to the cap so the returned array length
    // stays bounded at STRATEGY_BROWSE_LIMIT (the probe row is never emitted).
    const rows = data ?? [];
    const hasMore = rows.length > STRATEGY_BROWSE_LIMIT;
    const visibleRows = hasMore ? rows.slice(0, STRATEGY_BROWSE_LIMIT) : rows;

    const strategies: BrowseStrategyRow[] = visibleRows.map((row) => {
      const r = row as {
        id: string;
        name: string;
        codename: string | null;
        disclosure_tier: DisclosureTier | null;
        markets: unknown;
        strategy_types: unknown;
      };
      const tier: DisclosureTier = r.disclosure_tier ?? "exploratory";
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
      };
    });

    return NextResponse.json(
      { strategies, has_more: hasMore },
      { status: 200, headers: NO_STORE_HEADERS },
    );
  },
);
