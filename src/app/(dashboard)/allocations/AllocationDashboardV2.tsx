"use client";

import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { MyAllocationDashboardPayload } from "@/lib/queries";
import { useDashboardConfigV2 } from "./hooks/useDashboardConfig";
import { WidgetGrid } from "./components/WidgetGrid";
import { WidgetPicker } from "./components/WidgetPicker";
import { WIDGET_COMPONENTS } from "./widgets";
import { EmptyState } from "./EmptyState";
import { AlertBanner } from "./components/AlertBanner";
import { trackUsageEventClient } from "@/lib/analytics/usage-events-client";

/**
 * Phase 09.1 Plan 05 / D-01 + D-03 + D-04 + D-08 — V2 Overview tab body.
 *
 * Replaces the Plan 01 shell. Mounts:
 *   - useDashboardConfigV2 (Plan 03 hook — registry-id-normalized tiles)
 *   - WidgetGrid (Plan 05 Task 1 — 4-col CSS grid + DnD + pointer resize)
 *   - WidgetPicker (Plan 05 Task 2 — popover over WIDGET_REGISTRY)
 *   - WIDGET_COMPONENTS (existing barrel — render dispatcher per tile.k)
 *
 * Preserved Phase 07 invariants:
 *   - EmptyState short-circuit when holdings are empty and not syncing
 *     (Phase 07 / D-08).
 *   - STRATEGY_COMPOSITE_WIDGETS f2 gate filters the 18 strategy-derived
 *     widgets when strategies.length === 0. Because Plan 05 Task 3 (this
 *     plan) normalizes at write time, config.tiles[*].k is a registry id
 *     and the gate compares tile keys directly against the Set — no
 *     render-time short-key coalescing is needed.
 *   - data-widget-id markers fire widget_viewed analytics via an
 *     IntersectionObserver scoped to the dashboard container (clones the
 *     legacy AllocationDashboard.tsx:343-387 pattern). Threshold is 0.5
 *     to match the legacy behaviour exactly.
 *   - AlertBanner mounted above the grid when portfolio is non-null.
 *
 * Plan 05 / D-04 wrapper: WidgetGrid's onMove receives the sentinel
 * strings `"prev"` / `"next"` from the keyboard-reorder + overflow-menu
 * paths. `onMoveWrapper` resolves these to the actual neighbor key
 * before delegating to `moveWidget(fromK, neighbor.k)`. Real DnD drops
 * pass through unchanged.
 */

// Phase 07 / VOICES-ACCEPTED f2 — copy verbatim from
// AllocationDashboard.tsx:204-223. After Plan 05 Task 3's write-time
// normalization, config.tiles[*].k IS the registry id, so the gate
// compares tile keys directly against this Set with no render-time
// short-key coalescing required.
const STRATEGY_COMPOSITE_WIDGETS = new Set<string>([
  "rolling-sharpe",
  "rolling-volatility",
  "cumulative-vs-benchmark",
  "tail-risk",
  "risk-decomposition",
  "correlation-matrix",
  "correlation-over-time",
  "alpha-beta-decomposition",
  "tracking-error",
  "regime-detector",
  "strategy-comparison",
  "monthly-returns",
  "annual-returns",
  "return-distribution",
  "win-rate-profit-factor",
  "best-worst-periods",
  "performance-by-period",
  "var-expected-shortfall",
]);

export function AllocationDashboardV2(props: MyAllocationDashboardPayload) {
  const { config, addWidget, removeWidget, resizeWidget, moveWidget } =
    useDashboardConfigV2();
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerTriggerRef = useRef<HTMLButtonElement>(null);
  const dashboardContainerRef = useRef<HTMLDivElement | null>(null);

  const {
    portfolio,
    strategies,
    holdingsSummary = [],
    hasSyncing = false,
  } = props;

  const holdingsEmpty = holdingsSummary.length === 0;

  // Phase 07 f2 gate — filter strategy-composite widgets when no strategies.
  // Hook ordering: this useMemo and the subsequent ones MUST stay above any
  // early return so React's hook-order invariant holds across renders.
  const visibleTiles = useMemo(() => {
    if (strategies.length > 0) return config.tiles;
    return config.tiles.filter((t) => !STRATEGY_COMPOSITE_WIDGETS.has(t.k));
  }, [config.tiles, strategies.length]);

  const activeKeys = useMemo(
    () => new Set(config.tiles.map((t) => t.k)),
    [config.tiles],
  );

  // Phase 07 IntersectionObserver — fire widget_viewed once per session per
  // widget when 50% crosses the viewport. MutationObserver picks up tiles
  // added later by the picker. Mirrors AllocationDashboard.tsx:343-387.
  const widgetViewsFiredRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const root = dashboardContainerRef.current;
    if (!root) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const target = entry.target as HTMLElement;
          const widgetId = target.dataset.widgetId;
          if (!widgetId) continue;
          if (widgetViewsFiredRef.current.has(widgetId)) continue;
          widgetViewsFiredRef.current.add(widgetId);
          trackUsageEventClient("widget_viewed", { widget_id: widgetId });
          observer.unobserve(target);
        }
      },
      { threshold: 0.5 },
    );

    const tiles = root.querySelectorAll<HTMLElement>("[data-widget-id]");
    tiles.forEach((t) => observer.observe(t));

    const mutation = new MutationObserver(() => {
      const next = root.querySelectorAll<HTMLElement>("[data-widget-id]");
      next.forEach((t) => {
        const id = t.dataset.widgetId;
        if (id && !widgetViewsFiredRef.current.has(id)) observer.observe(t);
      });
    });
    mutation.observe(root, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      mutation.disconnect();
    };
  }, []);

  // D-04 keyboard-reorder + overflow-menu sentinel resolver. WidgetChrome
  // calls onMove(k, "prev" | "next" | <real-k>); resolve "prev" / "next" to
  // the adjacent tile's k against config.tiles (NOT visibleTiles — moving
  // is meaningful even if the tile is currently hidden by the f2 gate, but
  // since hidden tiles aren't rendered in the grid the keyboard path is
  // only reachable for visible ones; using config.tiles keeps the
  // semantics consistent with moveWidget's tiles-array operator).
  const onMoveWrapper = useCallback(
    (fromK: string, toK: string) => {
      const idx = config.tiles.findIndex((t) => t.k === fromK);
      if (idx < 0) return;
      let targetIdx: number | null = null;
      if (toK === "prev") {
        targetIdx = idx > 0 ? idx - 1 : null;
      } else if (toK === "next") {
        targetIdx = idx < config.tiles.length - 1 ? idx + 1 : null;
      } else {
        // Real destination key — pass through.
        moveWidget(fromK, toK);
        return;
      }
      if (targetIdx == null) return;
      const neighbor = config.tiles[targetIdx];
      if (neighbor) moveWidget(fromK, neighbor.k);
    },
    [config.tiles, moveWidget],
  );

  // Render dispatcher per tile.k. config.tiles[*].k IS a registry id
  // post-write-time-normalization (D-19), so we index WIDGET_COMPONENTS
  // directly. Unknown ids surface a visible fallback rather than crashing
  // the grid.
  const renderWidget = useCallback(
    (k: string): React.ReactNode => {
      const Component = WIDGET_COMPONENTS[k];
      if (!Component) {
        return (
          <div
            className="rounded-md border border-border bg-surface p-3 text-xs text-text-muted"
            role="note"
          >
            Unknown widget: <code>{k}</code>
          </div>
        );
      }
      return (
        <Suspense
          fallback={
            <div className="h-full w-full animate-pulse rounded-md bg-page" />
          }
        >
          <Component
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            data={props as any}
            timeframe={config.timeframe ?? "YTD"}
            width={0}
            height={0}
          />
        </Suspense>
      );
    },
    [props, config.timeframe],
  );

  // Phase 07 D-08 short-circuit — must come AFTER all hook calls above so
  // hook-order invariant holds across the empty / non-empty render paths.
  if (holdingsEmpty && !hasSyncing) {
    return (
      <div data-ui-v2-shell="true">
        <EmptyState hasSyncing={false} />
      </div>
    );
  }

  return (
    <div data-ui-v2-shell="true" className="relative">
      {portfolio != null && <AlertBanner portfolioId={portfolio.id} />}
      <div
        ref={dashboardContainerRef}
        className="relative"
        style={{ marginTop: 8 }}
      >
        <div
          style={{
            position: "relative",
            display: "flex",
            justifyContent: "flex-end",
            marginBottom: 8,
          }}
        >
          <button
            ref={pickerTriggerRef}
            type="button"
            onClick={() => setPickerOpen((v) => !v)}
            className="inline-flex items-center gap-1 rounded-md border border-border bg-surface px-3 py-1 text-xs text-text-secondary hover:bg-page focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
            aria-haspopup="dialog"
            aria-expanded={pickerOpen}
          >
            + Add widget
          </button>
          <WidgetPicker
            isOpen={pickerOpen}
            onClose={() => setPickerOpen(false)}
            anchorRef={pickerTriggerRef}
            activeKeys={activeKeys}
            onPick={addWidget}
          />
        </div>
        <WidgetGrid
          tiles={visibleTiles}
          onResize={resizeWidget}
          onRemove={removeWidget}
          onMove={onMoveWrapper}
          renderWidget={renderWidget}
        />
      </div>
    </div>
  );
}
