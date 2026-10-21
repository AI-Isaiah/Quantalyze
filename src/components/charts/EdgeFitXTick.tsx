"use client";

import type { ComponentProps } from "react";
import { Text, useChartWidth } from "recharts";
import { fitTickLabel, type TickLabelAnchor } from "@/lib/chart-ticks";

type RechartsTextProps = ComponentProps<typeof Text>;

/**
 * Props Recharts' `CartesianAxis` hands a cloned tick element, plus the style
 * props spread on the element (`{...CHART_TICK_STYLE}`). Only the fields this
 * renderer reads are named; everything else is forwarded to `Text` untouched.
 */
export interface EdgeFitXTickProps extends Omit<RechartsTextProps, "children"> {
  /** The tick's own `{ value, coordinate, ... }` entry. */
  payload?: { value?: unknown };
  /** The tick's index on the axis, the second argument of `tickFormatter`. */
  index?: number;
  /** The axis' `tickFormatter`, forwarded by Recharts on every tick. */
  tickFormatter?: (value: never, index: number) => string;
}

/**
 * XAxis tick renderer that anchors an edge label inward (Phase 170.1.3
 * NARROWCHARTS, D-02 and D-03b).
 *
 * The rule is `fitTickLabel` (`src/lib/chart-ticks.ts`): a label whose
 * estimated box crosses the chart's right edge is drawn with
 * `text-anchor="end"`, one that crosses the left edge with `"start"`, and
 * every other label keeps the anchor Recharts chose. The tick position `x`
 * never moves and no label is hidden, truncated, rotated or shrunk.
 *
 * Why the chart width comes from `useChartWidth()` and not from the DOM: the
 * width is Recharts' own layout state (the width of its `recharts-surface`
 * svg), and the label width is arithmetic on the label text. A DOM
 * measurement (`getBBox`, `getBoundingClientRect`) would give the server and
 * the browser different markup, which is React #418.
 *
 * Outside a chart context `useChartWidth()` is `undefined`, and a tick whose
 * `x` is not a finite number cannot be placed; in both cases the caller's
 * anchor is kept, so the renderer can never throw or blank an axis.
 *
 * Every other prop (font family and size, fill, vertical anchor, class names)
 * is passed through to Recharts' own `Text`, the component its default tick
 * path renders, so the drawn tick differs from the default only in
 * `text-anchor`. The style spread on the element still overrides Recharts'
 * `fill: stroke`, exactly as the plain `tick={CHART_TICK_STYLE}` object does.
 * No `style` prop is added: `fontVariantNumeric` is dropped by Recharts' svg
 * filter today and stays dropped (D-04, no desktop glyph change).
 *
 * Exists for D-03b: the shared rolling charts draw their end-date label whole.
 */
export function EdgeFitXTick(props: EdgeFitXTickProps) {
  const { payload, index, tickFormatter, textAnchor, x, fontSize, ...rest } = props;
  const chartWidth = useChartWidth();

  const value = payload?.value;
  const label =
    typeof tickFormatter === "function"
      ? String(tickFormatter(value as never, index ?? 0))
      : String(value ?? "");

  const tickX = typeof x === "string" ? Number(x) : x;
  const size = typeof fontSize === "string" ? Number(fontSize) : fontSize;
  const callerAnchor: TickLabelAnchor =
    textAnchor === "start" || textAnchor === "end" ? textAnchor : "middle";

  let anchor = textAnchor;
  if (
    chartWidth !== undefined &&
    typeof tickX === "number" &&
    Number.isFinite(tickX) &&
    typeof size === "number" &&
    Number.isFinite(size)
  ) {
    anchor = fitTickLabel(tickX, label, size, 0, chartWidth, callerAnchor).textAnchor;
  }

  return (
    <Text {...rest} x={x} fontSize={fontSize} textAnchor={anchor}>
      {label}
    </Text>
  );
}
