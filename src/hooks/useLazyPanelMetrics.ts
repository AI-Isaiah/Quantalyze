"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type LazyStatus = "idle" | "loading" | "error" | "ready";
export type LazyPanelId = "panel4" | "panel5" | "panel6" | "panel7";

/**
 * Maps the IntersectionObserver-driven panel ids (panel4..panel7) to the
 * RPC panel ids accepted by `fetch_strategy_lazy_metrics` per migration 087.
 *
 * The value type is fixed to the four lazy-eligible kinds. Adding a new
 * LazyPanelId without extending this map produces a type error — that is
 * intentional. `"equity"` is intentionally NOT in this map: panel 2 is
 * eager-mounted and `HeadlineMetricsPanel` calls `fetchStrategyLazyMetrics`
 * directly with `"equity"` (see Plan 14b-06 Task 3 / Grok B-03).
 *
 * The `as const` annotation pins the literal value union without forcing a
 * static `import { LazyMetricsPanelId } from "@/lib/queries"` — that import
 * would transitively load `@/lib/supabase/admin` (server-only), breaking
 * any client-side test that renders <LazyPanelPlaceholder>. The runtime
 * import inside the IntersectionObserver callback uses `await import(...)`
 * so the server-only barrier is only crossed when an intersection actually
 * fires (which never happens under jsdom's no-op stub).
 */
const PANEL_TO_ID = {
  panel4: "returns_dist",
  panel5: "rolling",
  panel6: "trades",
  panel7: "exposure",
} as const satisfies Record<LazyPanelId, "returns_dist" | "rolling" | "trades" | "exposure">;

export interface UseLazyPanelMetricsOptions {
  /** rootMargin for the IntersectionObserver. Defaults to "200px" (pre-mount before user reaches panel). */
  rootMargin?: string;
  /**
   * Phase 14b: when `true`, fires `fetchStrategyLazyMetrics` on first
   * intersection and exposes the resolved payload via `data`. Phase 14a
   * left this `false` so the hook only managed the placeholder lifecycle.
   * When `true`, `strategyId` is REQUIRED — a runtime guard logs a
   * `console.error` and the hook stays in `idle` if it is omitted.
   */
  fetchOnIntersect?: boolean;
  /** Required when `fetchOnIntersect=true`. The strategy whose lazy series should be fetched. */
  strategyId?: string;
}

/**
 * Phase 14a / KPI-22 + Phase 14b / KPI-07 — IntersectionObserver scaffold for
 * panels 4–7.
 *
 * Lifecycle: `idle` (initial) → on first intersection emit `loading` (only
 * when `fetchOnIntersect=true`), call `fetchStrategyLazyMetrics(strategyId,
 * PANEL_TO_ID[panelId])`, then transition to `ready` (data populated) or
 * `error` (data stays null, console.error logged with structured metadata).
 * When `fetchOnIntersect=false` (Phase 14a placeholders) the hook skips the
 * fetch and emits `ready` immediately on first intersection — preserving
 * the 14a `<LazyPanelPlaceholder>` semantics verbatim.
 *
 * Observer cleanup runs on unmount via the existing useEffect cleanup
 * (Grok I-01 — prevents observer leak across rapid navigation).
 *
 * SSR-safe: short-circuits when `typeof IntersectionObserver === "undefined"`
 * (server, or tests without the stub at `src/test-setup.ts`).
 *
 * Pattern source: `AllocationDashboardV2.tsx:147-188` (canonical project IO pattern).
 */
export function useLazyPanelMetrics<T = unknown>(
  panelId: LazyPanelId,
  opts: UseLazyPanelMetricsOptions = {},
): { ref: (node: HTMLElement | null) => void; data: T | null; status: LazyStatus } {
  const [status, setStatus] = useState<LazyStatus>("idle");
  const [data, setData] = useState<T | null>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);

  // Pin opts in a ref so the ref-callback's identity stays stable across
  // re-renders (the observer must NOT disconnect/reconnect on every parent
  // render). Reads happen inside the IntersectionObserver callback at
  // intersection-time, so the latest opts values are always seen.
  const optsRef = useRef(opts);
  optsRef.current = opts;

  useEffect(() => {
    return () => {
      observerRef.current?.disconnect();
      observerRef.current = null;
    };
  }, []);

  // useCallback gives the ref a stable identity across renders — prevents
  // IntersectionObserver disconnect/reconnect on every parent re-render.
  // opts is intentionally excluded from deps: it is read via optsRef inside
  // the observer callback; if callers need a dynamic rootMargin, restart the
  // hook by mounting at a new key.
  const ref = useCallback((node: HTMLElement | null) => {
    if (!node) return;
    if (typeof IntersectionObserver === "undefined") {
      // SSR or test environment without polyfill — emit ready immediately.
      setStatus("ready");
      return;
    }
    observerRef.current?.disconnect();
    observerRef.current = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          observerRef.current?.unobserve(entry.target);

          const currentOpts = optsRef.current;
          if (!currentOpts.fetchOnIntersect) {
            // Phase 14a placeholder semantics — no fetch, just lifecycle.
            setStatus("ready");
            return;
          }
          if (!currentOpts.strategyId) {
            // Defensive guard — TypeScript users should never hit this; but
            // a runtime contract keeps the lifecycle predictable.
            console.error(
              "useLazyPanelMetrics: fetchOnIntersect=true requires strategyId",
              { panelId },
            );
            return; // stays in 'idle'
          }
          setStatus("loading");
          // Dynamic import of the CLIENT-SAFE mirror at
          // `src/lib/queries-client.ts`. The original
          // `fetchStrategyLazyMetrics` in `src/lib/queries.ts` cannot be
          // imported here (statically OR dynamically) because it transitively
          // pulls in `next/headers` + `import "server-only"` via
          // `@/lib/supabase/admin`, which Turbopack rejects when the module
          // is reachable from a Client Component graph (Plan 14b-01 Rule 3
          // deviation — see SUMMARY.md).
          const strategyId = currentOpts.strategyId;
          import("@/lib/queries-client")
            .then(({ fetchStrategyLazyMetricsClient }) =>
              fetchStrategyLazyMetricsClient(strategyId, PANEL_TO_ID[panelId]),
            )
            .then((payload) => {
              setData(payload as T);
              setStatus("ready");
            })
            .catch((err: unknown) => {
              const message = err instanceof Error ? err.message : String(err);
              console.error("useLazyPanelMetrics fetch failed", {
                panelId,
                strategyId,
                message,
              });
              setStatus("error");
            });
        }
      },
      { rootMargin: optsRef.current.rootMargin ?? "200px" },
    );
    observerRef.current.observe(node);
    // panelId is the only true dependency — opts read via optsRef.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panelId]);

  return { ref, data, status };
}
