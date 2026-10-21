"use client";

import type { ComponentProps } from "react";
import { Text, XAxis, useChartWidth, usePlotArea } from "recharts";
import { estLabelWidth, fitXTickValues } from "@/lib/chart-ticks";
import { CHART_BORDER, CHART_TICK_STYLE } from "./chart-tokens";

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
 * XAxis tick renderer that keeps an edge label inside its svg (Phase 170.1.3
 * NARROWCHARTS, D-02 and D-03b).
 *
 * The anchor stays the one Recharts chose (centred). The tick's `x` is clamped
 * so the label's estimated box (`estLabelWidth`, `src/lib/chart-ticks.ts`)
 * lies in `[0, chartWidth]`: a label that fits keeps its `x`, and one that
 * crosses an edge moves by its real overflow only. That is deliberate.
 * `RollingXAxis` below picks the tick list with a pitch that already counts
 * that overflow (`fitXTickValues`), so a centred label that moves a few px
 * still clears its neighbour, where flipping the anchor (a further half label
 * width) would not. No label is hidden, truncated, rotated or shrunk.
 *
 * Why the chart width comes from `useChartWidth()` and not from the DOM: the
 * width is Recharts' own layout state (the width of its `recharts-surface`
 * svg), and the label width is arithmetic on the label text. A DOM
 * measurement (`getBBox`, `getBoundingClientRect`) would give the server and
 * the browser different markup, which is React #418.
 *
 * Outside a chart context `useChartWidth()` is `undefined`, and a tick whose
 * `x` is not a finite number cannot be placed; in both cases `x` is kept, so
 * the renderer can never throw or blank an axis.
 *
 * Every other prop (font family and size, fill, vertical anchor, class names)
 * is passed through to Recharts' own `Text`, the component its default tick
 * path renders, so the drawn tick differs from the default only in `x`, and
 * only for a label that would cross an edge. The style spread on the element
 * still overrides Recharts' `fill: stroke`, exactly as the plain
 * `tick={CHART_TICK_STYLE}` object does.
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

  let drawX = x;
  if (
    chartWidth !== undefined &&
    typeof tickX === "number" &&
    Number.isFinite(tickX) &&
    typeof size === "number" &&
    Number.isFinite(size)
  ) {
    const half = estLabelWidth(label, size) / 2;
    drawX = Math.max(half, Math.min(tickX, chartWidth - half));
  }

  return (
    <Text {...rest} x={drawX} fontSize={fontSize} textAnchor={textAnchor}>
      {label}
    </Text>
  );
}

/**
 * The date x axis of the three rolling charts (D-03b). The tick list is chosen
 * in arithmetic by `fitXTickValues` and handed to Recharts as `ticks` with
 * `interval={0}`, so Recharts never measures a label in the DOM: the labels
 * drawn do not depend on the host's fonts, and the server and the browser agree.
 * A component of its own because the plot area and the chart width exist only
 * inside the chart. Before the plot area is known every date is passed through.
 */
export function RollingXAxis({ dates }: { dates: string[] }) {
  const chartWidth = useChartWidth();
  const plot = usePlotArea();
  const label = (d: string) => d.slice(5);
  const ticks =
    chartWidth !== undefined && plot !== undefined
      ? fitXTickValues(
          dates,
          estLabelWidth(label(dates[0]), CHART_TICK_STYLE.fontSize),
          plot.x,
          plot.x + plot.width,
          chartWidth,
        )
      : dates;
  return (
    <XAxis
      dataKey="date"
      tick={<EdgeFitXTick {...CHART_TICK_STYLE} />}
      tickLine={false}
      axisLine={{ stroke: CHART_BORDER }}
      tickFormatter={label}
      ticks={ticks}
      interval={0}
    />
  );
}
