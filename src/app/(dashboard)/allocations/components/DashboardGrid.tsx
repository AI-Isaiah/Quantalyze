"use client";

import { Suspense, type ReactNode } from "react";
import {
  default as GridLayout,
  useContainerWidth,
  type Layout,
  type LayoutItem,
} from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";

import type { DashboardConfig } from "../lib/types";
import { WIDGET_REGISTRY } from "../lib/widget-registry";
import { TileWrapper } from "./TileWrapper";

// ---------------------------------------------------------------------------
// WidgetSkeleton — pulsing placeholder while a widget loads
// ---------------------------------------------------------------------------

function WidgetSkeleton() {
  return (
    <div
      className="h-full w-full animate-pulse rounded-md"
      style={{ backgroundColor: "#F1F5F9" }}
    />
  );
}

// ---------------------------------------------------------------------------
// DashboardGrid — react-grid-layout v2 host
// ---------------------------------------------------------------------------

interface DashboardGridProps {
  config: DashboardConfig;
  onLayoutChange: (layout: Layout) => void;
  onClose: (tileId: string) => void;
  renderWidget: (widgetId: string) => ReactNode;
}

export function DashboardGrid({
  config,
  onLayoutChange,
  onClose,
  renderWidget,
}: DashboardGridProps) {
  const { width, containerRef, mounted } = useContainerWidth({
    initialWidth: 1200,
  });

  const layout: Layout = config.tiles.map((tile): LayoutItem => ({
    i: tile.i,
    x: tile.x,
    y: tile.y,
    w: tile.w,
    h: tile.h,
    minW: 3,
    minH: 2,
  }));

  return (
    <div ref={containerRef}>
      {mounted && (
        <GridLayout
          width={width}
          layout={layout}
          gridConfig={{
            cols: 12,
            rowHeight: 60,
            margin: [8, 8] as const,
          }}
          dragConfig={{
            enabled: true,
            handle: ".drag-handle",
          }}
          resizeConfig={{
            enabled: true,
            handles: ["se", "s", "e"] as const,
          }}
          onLayoutChange={onLayoutChange}
          compactor={undefined}
          autoSize={true}
        >
          {config.tiles.map((tile) => {
            const meta = WIDGET_REGISTRY[tile.widgetId];
            const title = meta?.name ?? tile.widgetId;

            return (
              <div key={tile.i}>
                <TileWrapper title={title} tileId={tile.i} onClose={onClose}>
                  <Suspense fallback={<WidgetSkeleton />}>
                    {renderWidget(tile.widgetId)}
                  </Suspense>
                </TileWrapper>
              </div>
            );
          })}
        </GridLayout>
      )}
    </div>
  );
}
