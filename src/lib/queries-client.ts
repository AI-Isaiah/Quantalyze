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
 * for invisible strategies (and for a visible strategy with no stored rows) —
 * that `{}` is a VALID payload and resolves normally.
 *
 * FAILURE CONTRACT (Phase 170.5 SFH-01): a fetch that FAILED must not be
 * indistinguishable from "nothing stored". The RPC's own contract is a JSONB
 * object on every path (`jsonb_build_object()` for invisible / empty, COALESCEd
 * so it is never SQL NULL), so an RPC error, a null/undefined payload, or a
 * non-object payload is a failure and THROWS. `useLazyPanelMetrics` maps the
 * rejection to status "error", which the panels render as the retry banner
 * instead of a false "no series is stored" say-why sentence. The server mirror
 * `fetchStrategyLazyMetrics` keeps its `{}` fallback (its callers have no
 * retry surface).
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
    throw new Error(
      `fetch_strategy_lazy_metrics RPC failed (${panelId}): ${error.message}`,
    );
  }

  // audit-2026-05-07 silent-failure HIGH (red-team apply): the prior
  // bare `as LazyMetricsPayload` cast bypassed the server-side runtime
  // guards in `fetchStrategyLazyMetrics` (queries.ts:836-912). A
  // SECURITY DEFINER RPC drift that returned a SQL NULL, an array, or a
  // primitive would sail through the client mirror untouched and corrupt
  // every downstream destructuring consumer. Mirror the server guard:
  // reject anything that isn't a plain object. null/undefined is NOT a
  // legitimate empty here: the RPC COALESCEs to an empty object, so a null
  // means the contract drifted (or the call was short-circuited) and the
  // caller must see a failure, not an empty-but-valid payload.
  if (data === null || data === undefined) {
    console.error("fetchStrategyLazyMetricsClient: RPC returned no payload", {
      strategyId,
      panelId,
    });
    throw new Error(
      `fetch_strategy_lazy_metrics returned no payload (${panelId})`,
    );
  }
  if (typeof data !== "object" || Array.isArray(data)) {
    const shapeType = Array.isArray(data) ? "array" : typeof data;
    console.error("fetchStrategyLazyMetricsClient: unexpected RPC payload shape", {
      strategyId,
      panelId,
      type: shapeType,
    });
    throw new Error(
      `fetch_strategy_lazy_metrics returned an unexpected payload shape (${panelId}): ${shapeType}`,
    );
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
