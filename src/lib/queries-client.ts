"use client";

import { createClient } from "@/lib/supabase/client";
import type { LazyMetricsPayload, LazyMetricsPanelId } from "./types";

// H-1254: `LazyMetricsPanelId` now lives in the client-safe `./types` (single
// source of truth shared with the server fetcher queries.ts), eliminating the
// hand-synced duplicate that previously lived here. Re-exported so existing
// importers of `@/lib/queries-client` keep compiling.
export type { LazyMetricsPanelId };

/**
 * Client-side mirror of `fetchStrategyLazyMetrics` (defined in
 * `src/lib/queries.ts`). Identical RPC contract; only the supabase factory
 * differs:
 *
 * - `src/lib/queries.ts` → `await createClient()` from `@/lib/supabase/server`
 *   (uses `next/headers` cookies — server-only via `import "server-only"`
 *   transitively through `@/lib/supabase/admin`).
 * - This file → `createClient()` from `@/lib/supabase/client` (browser
 *   `createBrowserClient`, anon-key authenticated, no server-only barrier).
 *
 * The split is required because the lazy panels are Client Components
 * (`"use client"`) that mount via `useLazyPanelMetrics` /
 * IntersectionObserver — the server-only `fetchStrategyLazyMetrics`
 * cannot be statically imported into a client module graph without
 * tripping Turbopack's `next/headers` / `server-only` chain.
 *
 * RLS gates the same way: the `fetch_strategy_lazy_metrics` SECURITY
 * DEFINER RPC enforces strategy visibility internally (migration 087);
 * the browser client passes the user's anon JWT and the RPC returns `{}`
 * for invisible strategies — same silent-fallback behaviour as the
 * server-side function.
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
    return {};
  }

  // audit-2026-05-07 silent-failure HIGH (red-team apply): the prior
  // bare `as LazyMetricsPayload` cast bypassed the server-side runtime
  // guards in `fetchStrategyLazyMetrics` (queries.ts:836-912). A
  // SECURITY DEFINER RPC drift that returned a SQL NULL, an array, or a
  // primitive would sail through the client mirror untouched and corrupt
  // every downstream destructuring consumer. Mirror the server guard:
  // reject anything that isn't a plain object; treat null/undefined as
  // legitimate empty.
  if (data === null || data === undefined) {
    return {};
  }
  if (typeof data !== "object" || Array.isArray(data)) {
    const shapeType = Array.isArray(data) ? "array" : typeof data;
    console.error("fetchStrategyLazyMetricsClient: unexpected RPC payload shape", {
      strategyId,
      panelId,
      type: shapeType,
    });
    return {};
  }
  // The RPC's `data` is typed `any` by supabase-js; after the guard
  // above we know it's a plain object. The server-side
  // `fetchStrategyLazyMetrics` performs the authoritative
  // key-name validation (whitelist of `StrategyAnalyticsSeriesKind`).
  // The client mirror does the SHAPE check; consumers still narrow
  // values via the per-key runtime predicates documented on
  // `LazyMetricsPayload`.
  return data as LazyMetricsPayload;
}
