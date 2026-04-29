"use client";

import { useEffect, useRef, useState } from "react";

export type LazyStatus = "idle" | "loading" | "error" | "ready";
export type LazyPanelId = "panel4" | "panel5" | "panel6" | "panel7";

export interface UseLazyPanelMetricsOptions {
  /** rootMargin for the IntersectionObserver. Defaults to "200px" (pre-mount before user reaches panel). */
  rootMargin?: string;
  /**
   * Phase 14b will set this to `true` to fire `fetchStrategyLazyMetrics`.
   * Phase 14a leaves this `false` — the hook only manages the
   * intersection lifecycle (placeholder-only).
   */
  fetchOnIntersect?: boolean;
}

/**
 * Phase 14a / KPI-22 — IntersectionObserver scaffold for panels 4–7.
 *
 * In 14a, this hook ONLY tracks intersection lifecycle and emits
 * `status='ready'` on first intersection. It does NOT invoke
 * `fetchStrategyLazyMetrics` — that consumer wiring lands in Phase 14b
 * with `fetchOnIntersect: true`.
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
  // panelId is reserved for the Phase 14b fetch dispatch (per-panel mapping
  // to fetchStrategyLazyMetrics' panel_id). It is intentionally unused in 14a;
  // keeping it in the signature pins the public contract so 14b is a single-
  // file change. Reference once to satisfy noUnusedParameters under strict tsc.
  void panelId;

  const [status, setStatus] = useState<LazyStatus>("idle");
  const [data] = useState<T | null>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);

  useEffect(() => {
    return () => {
      observerRef.current?.disconnect();
      observerRef.current = null;
    };
  }, []);

  const ref = (node: HTMLElement | null) => {
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
          // Phase 14a: placeholder-only, no fetch.
          setStatus("ready");
          observerRef.current?.unobserve(entry.target);
          // Phase 14b wires fetch here:
          //   if (opts.fetchOnIntersect) {
          //     setStatus("loading");
          //     fetchStrategyLazyMetrics(strategyId, mapPanelToPanelId(panelId))
          //       .then(...).catch(() => setStatus("error"));
          //   }
        }
      },
      { rootMargin: opts.rootMargin ?? "200px" },
    );
    observerRef.current.observe(node);
  };

  return { ref, data, status };
}
