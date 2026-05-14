import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { withAllocatorAuth, type AllocatorUser } from "@/lib/api/withAllocatorAuth";
import { userActionLimiter, checkLimit } from "@/lib/ratelimit";

// audit-2026-05-07 round-2 Block D / P1947 — the catalog this route returns
// is allocator-scoped (it is fetched by allocators only and consumed by the
// per-allocator drawer). `private, no-store` keeps a stale or cross-tenant
// view from being served by any intermediary cache.
const NO_STORE_HEADERS = { "Cache-Control": "private, no-store" } as const;

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
  name: string;
  codename: string | null;
  markets: string[];
  strategy_types: string[];
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
    // RLS on `strategies` enforces SELECT for `status='published'` rows
    // for authenticated callers — same client choice as
    // getStrategiesByCategory in src/lib/queries.ts. The admin / service-
    // role client is intentionally NOT used here: a read-only catalog of
    // published strategies has no need to bypass RLS.
    const { data, error } = await supabase
      .from("strategies")
      .select("id, name, codename, markets, strategy_types")
      .eq("status", "published")
      .order("name", { ascending: true })
      .limit(STRATEGY_BROWSE_LIMIT);

    if (error) {
      console.error("[api/strategies/browse] select error:", error);
      return NextResponse.json(
        { error: error.message },
        { status: 500, headers: NO_STORE_HEADERS },
      );
    }

    // W2 — defensive null mapping. PostgreSQL text[] columns can be NULL
    // even with a NOT NULL DEFAULT '{}' contract on older rows; clamp
    // them to [] so downstream consumers (the drawer's filter pills, the
    // mandate-fit chip computation) can iterate without a null check.
    const strategies: BrowseStrategyRow[] = (data ?? []).map((row) => {
      const r = row as {
        id: string;
        name: string;
        codename: string | null;
        markets: unknown;
        strategy_types: unknown;
      };
      return {
        id: r.id,
        name: r.name,
        codename: r.codename ?? null,
        markets: Array.isArray(r.markets) ? (r.markets as string[]) : [],
        strategy_types: Array.isArray(r.strategy_types)
          ? (r.strategy_types as string[])
          : [],
      };
    });

    return NextResponse.json(
      { strategies },
      { status: 200, headers: NO_STORE_HEADERS },
    );
  },
);
