"use client";

import { forwardRef, type CSSProperties, type ReactNode, type SVGProps } from "react";

/**
 * Phase 44 / A11Y-02 — the reusable responsive SVG container recipe.
 *
 * Extracted VERBATIM from `TimeSeriesChart` (factsheet/[id]/v2/TimeSeriesChart.tsx)
 * so phases 47/48 can wrap 16+ bespoke SVG charts off ONE responsive recipe
 * instead of re-deriving the viewBox / preserveAspectRatio / aspect-ratio math
 * per chart.
 *
 * The responsive core that MUST stay byte-identical to TimeSeriesChart's `<svg>`:
 *  - `viewBox="0 0 {width} {height}"`
 *  - `preserveAspectRatio="xMidYMid meet"` — `meet` preserves the chart's natural
 *    aspect (text + axis spacing stays proportional); paired with the CSS
 *    `aspect-ratio` below the container height tracks width with no letterbox.
 *  - className prefixed with the load-bearing responsive classes `block w-full`,
 *    caller classes appended verbatim.
 *  - `style` carrying `aspectRatio: "{width} / {height}"`, `maxHeight: {height}`,
 *    `width: "100%"`, `height: "auto"` (caller style spread last so callers can
 *    add keys without losing the responsive ones unless they explicitly override).
 *
 * Everything else (ref, the 7 pointer/key handlers, role, aria-*, tabIndex,
 * focusable, the chart-specific className tail, children) passes straight
 * through via `...rest`, so the frame is a drop-in replacement that produces the
 * identical SVG DOM.
 */
export interface ResponsiveChartFrameProps
  extends Omit<SVGProps<SVGSVGElement>, "viewBox" | "preserveAspectRatio" | "width" | "height"> {
  /** viewBox width (e.g. TimeSeriesChart's VB_W = 880). */
  width: number;
  /** viewBox height (e.g. TimeSeriesChart's config.height ?? 280). */
  height: number;
  /** Chart-specific classes appended after the responsive `block w-full` core. */
  className?: string;
  /** Extra inline style merged AFTER the responsive style keys. */
  style?: CSSProperties;
  children?: ReactNode;
}

export const ResponsiveChartFrame = forwardRef<SVGSVGElement, ResponsiveChartFrameProps>(
  ({ width, height, className, style, children, ...rest }, ref) => {
    return (
      <svg
        ref={ref}
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="xMidYMid meet"
        className={`block w-full ${className ?? ""}`.trim()}
        style={{ aspectRatio: `${width} / ${height}`, maxHeight: height, width: "100%", height: "auto", ...style }}
        {...rest}
      >
        {children}
      </svg>
    );
  },
);

ResponsiveChartFrame.displayName = "ResponsiveChartFrame";
