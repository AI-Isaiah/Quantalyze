"use client";

import { useRef, useState } from "react";
import type { TileConfig } from "../lib/types";
import { WidgetChrome } from "./WidgetChrome";

/**
 * Phase 09.1 Plan 05 — WidgetGrid (replaces DashboardGrid for the V2 path)
 *
 * 4-col CSS-grid host with HTML5 drag-and-drop reorder + pointer-based
 * resize that snaps to 1/2/3/4 columns (D-01 full contract). Replaces the
 * legacy `react-grid-layout`-based DashboardGrid for the `allocations.ui_v2`
 * flag-on path.
 *
 * Source reference: designer-bundle/project/src/widget-grid.jsx (lines 7-163,
 * especially 100-135 for the pointer-resize handle structure).
 *
 * Per Shared P2 (PATTERNS §"Shared Patterns"): each cell carries its
 * `data-widget-id={k}` marker so the IntersectionObserver inside
 * AllocationDashboardV2 fires `widget_viewed` analytics when the cell
 * scrolls into view — the marker contract is preserved verbatim.
 *
 * Responsive (matches designer @media breakpoints):
 *   - max-width 980px → 2-col grid
 *   - max-width 640px → 1-col grid
 */

type Props = {
  tiles: TileConfig[];
  onResize: (k: string, w: 1 | 2 | 3 | 4) => void;
  onRemove: (k: string) => void;
  /**
   * Reorder callback. The toK string is normally another tile's `k`, but
   * accepts the sentinels `"prev"` and `"next"` from WidgetChrome's
   * keyboard-reorder + overflow-menu paths. The parent
   * (AllocationDashboardV2) wraps onMove with a resolver that maps the
   * sentinels to actual neighbor keys.
   */
  onMove: (fromK: string, toK: string) => void;
  renderWidget: (k: string) => React.ReactNode;
};

export function WidgetGrid({ tiles, onResize, onRemove, onMove, renderWidget }: Props) {
  const [draggingK, setDraggingK] = useState<string | null>(null);
  const [dragOverK, setDragOverK] = useState<string | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  return (
    <div
      ref={gridRef}
      className="widget-grid"
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
        gap: 10,
        marginTop: 10,
      }}
    >
      {tiles.map(({ k, w }) => (
        <WidgetCell
          key={k}
          k={k}
          w={w}
          draggingK={draggingK}
          dragOverK={dragOverK}
          setDraggingK={setDraggingK}
          setDragOverK={setDragOverK}
          onResize={onResize}
          onRemove={onRemove}
          onMove={onMove}
          renderWidget={renderWidget}
          gridRef={gridRef}
        />
      ))}
      {/*
        Inline <style> (not styled-jsx — repo idiom is plain inline + CSS
        variables; styled-jsx is not configured). The selectors here are
        scoped via the `.widget-grid` ancestor to avoid leaking globally.
      */}
      <style>{`
        .widget-grid .widget-cell:hover .widget-chrome,
        .widget-grid .widget-cell:focus-within .widget-chrome,
        .widget-grid .widget-cell:hover .widget-resize-handle,
        .widget-grid .widget-cell:focus-within .widget-resize-handle {
          opacity: 1 !important;
        }
        @media (max-width: 980px) {
          .widget-grid { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; }
          .widget-grid .widget-cell { grid-column: span 2 !important; }
          .widget-grid .widget-resize-handle { display: none !important; }
        }
        @media (max-width: 640px) {
          .widget-grid { grid-template-columns: 1fr !important; }
          .widget-grid .widget-cell { grid-column: span 1 !important; }
        }
      `}</style>
    </div>
  );
}

type CellProps = {
  k: string;
  w: 1 | 2 | 3 | 4;
  draggingK: string | null;
  dragOverK: string | null;
  setDraggingK: (v: string | null) => void;
  setDragOverK: (v: string | null) => void;
  onResize: (k: string, w: 1 | 2 | 3 | 4) => void;
  onRemove: (k: string) => void;
  onMove: (fromK: string, toK: string) => void;
  renderWidget: (k: string) => React.ReactNode;
  gridRef: React.RefObject<HTMLDivElement | null>;
};

function WidgetCell({
  k,
  w,
  draggingK,
  dragOverK,
  setDraggingK,
  setDragOverK,
  onResize,
  onRemove,
  onMove,
  renderWidget,
  gridRef,
}: CellProps) {
  // D-01 pointer-resize. Port of designer-bundle/project/src/widget-grid.jsx:
  // 100-135. Captures the pointer on a 6px right-edge rail, computes target
  // span from horizontal delta relative to one column-width-plus-gap, snaps
  // to nearest [1..4] on pointerup, and calls onResize(k, nextW).
  function handleResizePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    e.stopPropagation();
    e.preventDefault();
    const startX = e.clientX;
    const startW = w;
    const handleEl = e.currentTarget as HTMLDivElement;
    const gridEl = gridRef.current;
    const gridWidth = gridEl?.getBoundingClientRect().width ?? 0;
    const gap = 10;
    // Column width in pixels: (gridWidth - 3*gap) / 4
    const colWidth = gridWidth > 0 ? (gridWidth - 3 * gap) / 4 : 240;
    handleEl.setPointerCapture(e.pointerId);

    function move(evt: PointerEvent) {
      const delta = evt.clientX - startX;
      const deltaCols = delta / (colWidth + gap);
      const target = Math.max(
        1,
        Math.min(4, Math.round(startW + deltaCols)),
      ) as 1 | 2 | 3 | 4;
      handleEl.dataset.pendingW = String(target);
    }
    function up() {
      const pending = Number(handleEl.dataset.pendingW ?? startW) as 1 | 2 | 3 | 4;
      const finalW = (pending >= 1 && pending <= 4 ? pending : startW) as 1 | 2 | 3 | 4;
      if (finalW !== startW) onResize(k, finalW);
      delete handleEl.dataset.pendingW;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    }
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  return (
    <div
      data-widget-id={k}
      draggable
      onDragStart={() => setDraggingK(k)}
      onDragEnd={() => {
        setDraggingK(null);
        setDragOverK(null);
      }}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOverK(k);
      }}
      onDrop={(e) => {
        e.preventDefault();
        if (draggingK && draggingK !== k) onMove(draggingK, k);
        setDraggingK(null);
        setDragOverK(null);
      }}
      className="widget-cell"
      style={{
        gridColumn: `span ${w}`,
        minHeight: 140,
        minWidth: 0,
        position: "relative",
        transition: "box-shadow 120ms ease, opacity 120ms ease",
        boxShadow:
          dragOverK === k && draggingK !== k
            ? "0 0 8px rgba(27,107,90,0.4)"
            : undefined,
        opacity: draggingK === k ? 0.55 : 1,
      }}
    >
      <WidgetChrome
        k={k}
        w={w}
        onResize={onResize}
        onRemove={onRemove}
        onMove={onMove}
      />
      {/* D-01 pointer-resize handle (right edge, full height, col-resize cursor). */}
      <div
        className="widget-resize-handle"
        onPointerDown={handleResizePointerDown}
        aria-hidden="true"
        style={{
          position: "absolute",
          top: 0,
          right: 0,
          width: 6,
          height: "100%",
          cursor: "col-resize",
          opacity: 0,
          transition: "opacity 150ms",
          zIndex: 4,
        }}
      />
      {renderWidget(k)}
    </div>
  );
}
