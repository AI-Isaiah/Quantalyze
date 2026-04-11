"use client";

import { Component, type ReactNode } from "react";

// ---------------------------------------------------------------------------
// Error boundary for individual widget tiles
// ---------------------------------------------------------------------------

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

class WidgetErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          className="flex h-full w-full items-center justify-center rounded-md p-4 text-center text-sm"
          style={{ backgroundColor: "rgba(220, 38, 38, 0.06)", color: "#DC2626" }}
        >
          Widget error — try removing and re-adding.
        </div>
      );
    }
    return this.props.children;
  }
}

// ---------------------------------------------------------------------------
// TileWrapper — card chrome around each draggable grid tile
// ---------------------------------------------------------------------------

interface TileWrapperProps {
  title: string;
  tileId: string;
  onClose: (id: string) => void;
  children: ReactNode;
}

const SIZES = [
  { label: "1/4", cols: 3 },
  { label: "1/3", cols: 4 },
  { label: "1/2", cols: 6 },
  { label: "Full", cols: 12 },
] as const;

export function TileWrapper({ title, tileId, onClose, children }: TileWrapperProps) {
  return (
    <div
      className="flex h-full flex-col overflow-hidden rounded-lg bg-white"
      style={{
        border: "1px solid #E2E8F0",
        borderRadius: 8,
      }}
    >
      {/* Header */}
      <div className="flex items-center gap-1.5 border-b border-[#E2E8F0] px-3 py-1.5">
        {/* Drag handle */}
        <span
          className="drag-handle cursor-grab select-none text-[#718096] active:cursor-grabbing"
          aria-label="Drag to reorder"
          style={{ fontSize: 14, lineHeight: 1 }}
        >
          &#x2807;
        </span>

        {/* Title — h2 for screen-reader heading navigation. The page has
            one h1 ("My Allocation") so tile headers are h2. Visual styling
            stays 13px semibold regardless of tag. */}
        <h2
          className="flex-1 truncate font-sans text-[13px] font-semibold m-0"
          style={{ color: "#1A1A2E" }}
        >
          {title}
        </h2>

        {/* Resize indicators (visual-only) */}
        <div className="hidden items-center gap-0.5 sm:flex">
          {SIZES.map((s) => (
            <span
              key={s.label}
              className="rounded px-1.5 py-0.5 text-[10px] text-[#718096] hover:bg-[#F8F9FA]"
              title={`Resize to ${s.label} width (${s.cols} columns)`}
            >
              {s.label}
            </span>
          ))}
        </div>

        {/* Close button */}
        <button
          type="button"
          onClick={() => onClose(tileId)}
          aria-label={`Remove ${title} widget`}
          className="ml-1 rounded p-0.5 text-[#718096] transition-colors hover:bg-[#F8F9FA] hover:text-[#DC2626] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#1B6B5A]"
        >
          <span aria-hidden="true" style={{ fontSize: 14, lineHeight: 1 }}>
            &times;
          </span>
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-auto p-3">
        <WidgetErrorBoundary>{children}</WidgetErrorBoundary>
      </div>
    </div>
  );
}
