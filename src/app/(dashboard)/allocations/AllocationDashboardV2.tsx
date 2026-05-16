"use client";

import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import type { MyAllocationDashboardPayload } from "@/lib/queries";
import {
  useDashboardConfigV2,
  consumeDashboardRecoveryFlag,
} from "./hooks/useDashboardConfig";
import { WidgetGrid } from "./components/WidgetGrid";
import { WidgetPicker } from "./components/WidgetPicker";
import { WIDGET_COMPONENTS } from "./widgets";
import { EmptyState } from "./EmptyState";
import { AlertBanner } from "./components/AlertBanner";
import { useTweaks } from "./context/TweaksContext";
import { InsightStrip } from "@/components/portfolio/InsightStrip";
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
 *     IntersectionObserver scoped to the dashboard container. Threshold
 *     is 0.5.
 *   - AlertBanner mounted above the grid when portfolio is non-null.
 *
 * Plan 05 / D-04 wrapper: WidgetGrid's onMove receives the sentinel
 * strings `"prev"` / `"next"` from the keyboard-reorder + overflow-menu
 * paths. `onMoveWrapper` resolves these to the actual neighbor key
 * before delegating to `moveWidget(fromK, neighbor.k)`. Real DnD drops
 * pass through unchanged.
 */

// Phase 07 / VOICES-ACCEPTED f2 — strategy-composite widget gate. After
// Plan 05 Task 3's write-time normalization, config.tiles[*].k IS the
// registry id, so the gate compares tile keys directly against this Set
// with no render-time short-key coalescing required.
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

  // retro audit (silent-failure-hunter L7 c9 / red-team L3 c9) —
  // useDashboardConfigV2's `loadV2Config` writes a sessionStorage
  // breadcrumb when a parse_failed / version_reset / legacy_in_v2_blob
  // recovery happened, but PR #183 shipped the breadcrumb infrastructure
  // without a consumer. Drain the flag once per mount and surface a
  // non-blocking dismissible banner so the user sees that their saved
  // layout was reset; without this consumer the C-0332..0335 fix was
  // logic-only and never reached the user-facing surface.
  const [recoveryReason, setRecoveryReason] = useState<
    "parse_failed" | "version_reset" | "legacy_in_v2_blob" | null
  >(null);
  useEffect(() => {
    const reason = consumeDashboardRecoveryFlag();
    // Mount-only drain of an external one-shot sessionStorage flag —
    // the synchronous setState is the intended behaviour.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (reason) setRecoveryReason(reason);
  }, []);
  const dismissRecoveryBanner = useCallback(() => setRecoveryReason(null), []);

  // PR3 — listen for the AllocationsTabs "Widget" chip's custom event so
  // clicking it opens the picker without prop-drilling state up two levels.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onOpen = () => setPickerOpen(true);
    window.addEventListener("allocations:open-widget-picker", onOpen);
    return () =>
      window.removeEventListener("allocations:open-widget-picker", onOpen);
  }, []);

  const {
    portfolio,
    strategies,
    holdingsSummary = [],
    hasSyncing = false,
    analytics,
    flaggedHoldings = [],
  } = props;

  const holdingsEmpty = holdingsSummary.length === 0;

  // PR3 (HANDOFF G5) — read showOutcomes from TweaksContext so the user
  // can hide the outcomes timeline tile via the panel without removing it
  // from their persisted layout. The provider is mounted in
  // AllocationsTabs; rendering this component outside that provider falls
  // back to defaults (showOutcomes = true) per useTweaks() contract.
  const { state: tweaks } = useTweaks();

  // PR3 (HANDOFF G9) — count strategy-composite tiles being filtered out
  // when strategies.length === 0 so the dashboard can surface a friendly
  // "Connect a strategy to unlock N widgets" callout instead of leaving
  // the user with an unexpectedly sparse grid. Only trips when the user
  // has added picker tiles that depend on strategies.
  const filteredStrategyTileCount = useMemo(() => {
    if (strategies.length > 0) return 0;
    return config.tiles.filter((t) => STRATEGY_COMPOSITE_WIDGETS.has(t.k))
      .length;
  }, [config.tiles, strategies.length]);

  // Phase 07 f2 gate — filter strategy-composite widgets when no strategies.
  // Hook ordering: this useMemo and the subsequent ones MUST stay above any
  // early return so React's hook-order invariant holds across renders.
  const visibleTiles = useMemo(() => {
    let tiles = config.tiles;
    if (strategies.length === 0) {
      tiles = tiles.filter((t) => !STRATEGY_COMPOSITE_WIDGETS.has(t.k));
    }
    if (!tweaks.showOutcomes) {
      // Outcomes-timeline tile registry id can come from either the short
      // key "outcomes" (truth default) or the full id "outcomes-timeline"
      // (post-normalization layouts). Filter both.
      tiles = tiles.filter(
        (t) => t.k !== "outcomes" && t.k !== "outcomes-timeline",
      );
    }
    return tiles;
  }, [config.tiles, strategies.length, tweaks.showOutcomes]);

  const activeKeys = useMemo(
    () => new Set(config.tiles.map((t) => t.k)),
    [config.tiles],
  );

  // Phase 07 IntersectionObserver — fire widget_viewed once per session per
  // widget when 50% crosses the viewport. MutationObserver picks up tiles
  // added later by the picker.
  //
  // audit-2026-05-07 H-1197 c9 — the previous `[]`-deps effect ran once on
  // mount, but the early-return at the bottom of the render body short-
  // circuits BEFORE `dashboardContainerRef` mounts when the dashboard
  // first paints as the empty-state path. If the allocator then connects
  // a key and the dashboard transitions empty → populated, the dashboard
  // container mounts but the observer effect never re-runs. Zero
  // widget_viewed events fire for the entire session. Including the gate
  // signals (`holdingsEmpty`, `hasSyncing`) in the deps so the effect
  // re-runs when the ref div mounts.
  const widgetViewsFiredRef = useRef<Set<string>>(new Set());
  // audit-2026-05-07 H-1199 c9 — record unknown widget ids so registry
  // refactors that strand persisted layouts (e.g. equity-curve → equity-chart
  // rename, the bridge-outcome-banner gap flagged in red-team #2) surface in
  // dev tools / Sentry instead of disappearing into a friendly text note.
  // Tracked via useRef so we only log a given id once per dashboard mount.
  //
  // retro audit (red-team L10 c7): cleared per-portfolio via the effect
  // below so observability resets on data-identity changes (admin
  // role-switch, in-tab navigation).
  const unknownLoggedRef = useRef<Set<string>>(new Set());

  // retro audit (red-team L8 c8 + L10 c7): the widget_viewed dedup ref
  // and the unknown-widget log ref both live at component-instance scope
  // and were never reset:
  //   - tweaks.showOutcomes toggle hides-then-shows the outcomes tile;
  //     stale dedup suppresses widget_viewed on the re-mounted tile.
  //   - portfolio?.id switch inside a single mounted instance (admin
  //     role-switch, in-tab nav) carries the previous allocator's
  //     warn-dedup into the new allocator's view, so different
  //     allocators stranded on the same id only log for the first.
  //
  // Use a ref-tracked previous-value pattern so the first render does
  // NOT trigger a reset (refs initialise unset; the FIRST observation
  // of each dep is the baseline, not a transition). Resets only fire
  // on real subsequent changes.
  const lastShowOutcomesRef = useRef<boolean | null>(null);
  useEffect(() => {
    if (lastShowOutcomesRef.current === null) {
      lastShowOutcomesRef.current = tweaks.showOutcomes;
      return;
    }
    if (lastShowOutcomesRef.current !== tweaks.showOutcomes) {
      lastShowOutcomesRef.current = tweaks.showOutcomes;
      widgetViewsFiredRef.current = new Set();
    }
  }, [tweaks.showOutcomes]);

  const lastPortfolioIdRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const currentId = portfolio?.id ?? null;
    if (lastPortfolioIdRef.current === undefined) {
      lastPortfolioIdRef.current = currentId;
      return;
    }
    if (lastPortfolioIdRef.current !== currentId) {
      lastPortfolioIdRef.current = currentId;
      widgetViewsFiredRef.current = new Set();
      unknownLoggedRef.current = new Set();
    }
  }, [portfolio?.id]);

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
  }, [holdingsEmpty, hasSyncing]);

  // D-04 keyboard-reorder + overflow-menu sentinel resolver. WidgetChrome
  // calls onMove(k, "prev" | "next" | "first" | "last" | <real-k>); resolve
  // sentinels to the adjacent tile's k against config.tiles (NOT
  // visibleTiles — moving is meaningful even if the tile is currently hidden
  // by the f2 gate, but since hidden tiles aren't rendered in the grid the
  // keyboard path is only reachable for visible ones; using config.tiles
  // keeps the semantics consistent with moveWidget's tiles-array operator).
  // Phase A4 added "first" / "last" so Home / End in kbdMode jumps to either
  // end of the grid in one keypress instead of N arrow presses.
  const onMoveWrapper = useCallback(
    (fromK: string, toK: string) => {
      const idx = config.tiles.findIndex((t) => t.k === fromK);
      if (idx < 0) return;
      let targetIdx: number | null = null;
      if (toK === "prev") {
        targetIdx = idx > 0 ? idx - 1 : null;
      } else if (toK === "next") {
        targetIdx = idx < config.tiles.length - 1 ? idx + 1 : null;
      } else if (toK === "first") {
        targetIdx = idx > 0 ? 0 : null;
      } else if (toK === "last") {
        targetIdx =
          idx < config.tiles.length - 1 ? config.tiles.length - 1 : null;
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
        if (
          typeof console !== "undefined" &&
          !unknownLoggedRef.current.has(k)
        ) {
          unknownLoggedRef.current.add(k);
          console.warn(
            "[AllocationDashboardV2] unknown widget id in persisted layout — rendering Unknown placeholder",
            { widget_id: k },
          );
        }
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

  // pr189-followup H1 (silent-failure-hunter HIGH/9) — render the recovery
  // banner ABOVE both render paths so empty-holdings allocators see the
  // same "saved layout was reset" signal as populated ones. The flag is
  // consumed on mount (drained from sessionStorage), so without this the
  // empty-holdings short-circuit silently swallowed the breadcrumb for
  // exactly the population most likely to hit it (new allocators with no
  // holdings still picking up a stale-version persisted layout).
  const recoveryBanner = recoveryReason != null && (
    <div
      role="status"
      data-testid="dashboard-recovery-banner"
      data-recovery-reason={recoveryReason}
      className="mt-3 flex items-start justify-between gap-3 rounded-lg border border-warning/40 bg-warning/10 px-4 py-2 text-sm text-text-primary"
    >
      <div className="flex items-start gap-2">
        <span aria-hidden className="font-semibold">Heads up:</span>
        <span>
          {recoveryReason === "parse_failed"
            ? "We couldn't read your saved dashboard layout and reset it to defaults."
            : recoveryReason === "version_reset"
              ? "Your saved dashboard layout was from an older version and has been reset to the latest defaults."
              : "Your saved dashboard layout used a legacy format and has been migrated to the new defaults."}
        </span>
      </div>
      <button
        type="button"
        onClick={dismissRecoveryBanner}
        aria-label="Dismiss layout reset notice"
        className="shrink-0 rounded-md px-2 py-0.5 text-xs font-medium text-text-muted transition-colors hover:bg-warning/20 hover:text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
      >
        Dismiss
      </button>
    </div>
  );

  // Phase 07 D-08 short-circuit — must come AFTER all hook calls above so
  // hook-order invariant holds across the empty / non-empty render paths.
  if (holdingsEmpty && !hasSyncing) {
    return (
      <div data-ui-v2-shell="true">
        {recoveryBanner}
        <EmptyState hasSyncing={false} />
      </div>
    );
  }

  return (
    <div data-ui-v2-shell="true" className="relative">
      {portfolio != null && <AlertBanner portfolioId={portfolio.id} />}
      {/* Phase 09.1 PR1 (dashboard parity, HANDOFF.md G3) — "What we
          noticed" insight strip mounted above the grid (sibling to
          WidgetGrid). Reuses the existing src/components/portfolio
          InsightStrip with its 7-rule client-side computeAllInsights
          output. PR1 deliberately skips the server-side `insights[]`
          payload field that HANDOFF.md proposed — the existing rules
          fire from `analytics` + (optional) `flaggedCount`, so no
          payload widening is needed for first-cut value. */}
      <InsightStrip
        analytics={analytics}
        portfolioId={portfolio?.id ?? null}
        flaggedCount={flaggedHoldings.length}
        className="mt-3 px-1"
      />
      {recoveryBanner}
      <div
        ref={dashboardContainerRef}
        className="relative"
        style={{ marginTop: 8 }}
      >
        {/* PR3 (dashboard parity) — the in-dashboard "+ Add widget" button
            is gone; the tab-row Widget chip in AllocationsTabs is the new
            entry point. The picker still mounts here, but the trigger is
            an invisible 0-size anchor so the existing positioning math
            in WidgetPicker (anchorRef-relative) keeps working. The chip
            opens the picker via a CustomEvent listened to in the
            useEffect above. */}
        <button
          ref={pickerTriggerRef}
          type="button"
          aria-hidden
          tabIndex={-1}
          onClick={() => setPickerOpen((v) => !v)}
          style={{
            position: "absolute",
            top: 0,
            right: 0,
            width: 0,
            height: 0,
            padding: 0,
            margin: 0,
            border: 0,
            background: "transparent",
            pointerEvents: "none",
          }}
        />
        <WidgetPicker
          isOpen={pickerOpen}
          onClose={() => setPickerOpen(false)}
          anchorRef={pickerTriggerRef}
          activeKeys={activeKeys}
          onPick={addWidget}
        />
        {filteredStrategyTileCount > 0 ? (
          // PR3 (HANDOFF G9) — friendlier empty-grid fallback. When a user
          // has added strategy-composite tiles via the picker but has no
          // strategies connected, the f2 gate filters them out and the
          // grid feels broken. This callout names what's missing and
          // points at /discovery, where strategies live.
          <div
            role="note"
            data-testid="empty-grid-callout"
            className="mb-3 flex items-center justify-between gap-3 rounded-lg border border-dashed border-border bg-surface-subtle px-4 py-3 text-sm"
          >
            <div className="flex items-start gap-3">
              <span
                aria-hidden
                className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent"
              >
                <svg
                  width="11"
                  height="11"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.75"
                  strokeLinecap="round"
                >
                  <circle cx="7" cy="7" r="4" />
                  <path d="M13 13l-2.5-2.5" />
                </svg>
              </span>
              <div>
                <div className="font-medium text-text-primary">
                  Connect a strategy to unlock {filteredStrategyTileCount}{" "}
                  {filteredStrategyTileCount === 1 ? "widget" : "widgets"}
                </div>
                <div className="text-xs text-text-muted">
                  Risk &amp; performance tiles need at least one strategy in
                  your portfolio before they can render.
                </div>
              </div>
            </div>
            <Link
              href="/discovery"
              className="inline-flex shrink-0 items-center gap-1 rounded-md border border-accent/40 bg-surface px-3 py-1.5 text-xs font-medium text-accent transition-colors hover:bg-accent/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
            >
              Browse strategies →
            </Link>
          </div>
        ) : null}
        <WidgetGrid
          tiles={visibleTiles}
          onResize={resizeWidget}
          onRemove={removeWidget}
          onMove={onMoveWrapper}
          renderWidget={renderWidget}
        />
      </div>
      {/* PR3 (HANDOFF G5) — Tweaks panel + toggle now mount at the
          AllocationsTabs root (a level above this component) so they
          stay visible across all tabs. Removed from this component to
          avoid double-mounting the panel/toggle on Overview. */}
    </div>
  );
}
