"use client";

import { createClient } from "@/lib/supabase/client";
import type { LazyMetricsPayload } from "./types";

/**
 * Mirror of `LazyMetricsPanelId` from `src/lib/queries.ts:441`. Redeclared
 * here as a type-only constant union so this client module never traces
 * into queries.ts (which is server-only via the `next/headers` chain).
 * Contract source: migration 087 SQL CASE in `fetch_strategy_lazy_metrics`.
 */
export type LazyMetricsPanelId =
  | "overview"
  | "equity"
  | "drawdown"
  | "returns_dist"
  | "rolling"
  | "trades"
  | "exposure";

/**
 * Phase 14b — Client-side mirror of `fetchStrategyLazyMetrics` (defined in
 * `src/lib/queries.ts`). Identical RPC contract; only the supabase factory
 * differs:
 *
 * - `src/lib/queries.ts` → `await createClient()` from `@/lib/supabase/server`
 *   (uses `next/headers` cookies — server-only via `import "server-only"`
 *   transitively through `@/lib/supabase/admin`).
 * - This file → `createClient()` from `@/lib/supabase/client` (browser
 *   `createBrowserClient`, anon-key authenticated, no server-only barrier).
 *
 * The split is required because Phase 14b lazy panels are Client Components
 * (`"use client"`) that mount via `useLazyPanelMetrics` / IntersectionObserver
 * — the original `fetchStrategyLazyMetrics` cannot be statically imported
 * into a client module graph without tripping Turbopack's `next/headers` /
 * `server-only` chain (Plan 14b-01 Rule 3 deviation).
 *
 * RLS gates the same way: the `fetch_strategy_lazy_metrics` SECURITY DEFINER
 * RPC enforces strategy visibility internally (migration 087); the browser
 * client passes the user's anon JWT and the RPC returns `{}` for invisible
 * strategies — same T-12-08-01 silent-fallback behaviour as the server-side
 * function.
 */
export async function fetchStrategyLazyMetricsClient(
  strategyId: string,
  panelId: LazyMetricsPanelId,
): Promise<LazyMetricsPayload> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("fetch_strategy_lazy_metrics", {
    p_strategy_id: strategyId,
    p_panel_id: panelId,
  });

  if (error) {
    console.error("fetchStrategyLazyMetricsClient RPC error:", {
      strategyId,
      panelId,
      code: error.code,
      message: error.message,
    });
    return {} as LazyMetricsPayload;
  }

  return (data ?? {}) as LazyMetricsPayload;
}
