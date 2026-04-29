"use client";

import { useEffect, useRef, useState } from "react";
import { createChart, LineSeries, type IChartApi, type ISeriesApi, type SeriesType } from "lightweight-charts";
import {
  CHART_ACCENT,
  CHART_AXIS_TICK,
  CHART_BORDER,
  CHART_FONT_MONO,
  CHART_SURFACE,
  CHART_TEXT_MUTED,
  CHART_TRACK,
} from "./chart-tokens";

interface EquityCurveProps {
  data: { date: string; value: number }[];
  benchmarkSeries?: { date: string; value: number }[] | null;
  height?: number;
  /**
   * When `true`, EquityCurve does NOT render its own per-component BTC
   * checkbox header. The Single-Strategy v2 equity panel lifts the BTC
   * overlay control to the panel level so a single checkbox governs both
   * the Cumulative and Underwater sub-charts. Pass `benchmarkSeries={null}`
   * from the panel to suppress the overlay; the effect under the hood
   * will simply skip adding the benchmark series.
   *
   * Default: `false` — preserves the existing v1 behavior (internal
   * checkbox visible whenever a benchmark series is provided).
   */
  hideBenchmarkToggle?: boolean;
}

const PRICE_FORMATTER = (v: number) => `${((v - 1) * 100).toFixed(1)}%`;

export function EquityCurve({
  data,
  benchmarkSeries,
  height = 350,
  hideBenchmarkToggle = false,
}: EquityCurveProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const bmSeriesRef = useRef<ISeriesApi<SeriesType> | null>(null);
  const [showBenchmark, setShowBenchmark] = useState(true);

  // Create chart and strategy series (only when data/height change)
  useEffect(() => {
    if (!containerRef.current || data.length === 0) return;

    const chart = createChart(containerRef.current, {
      height,
      layout: {
        background: { color: CHART_SURFACE },
        textColor: CHART_AXIS_TICK,
        fontFamily: CHART_FONT_MONO,
        fontSize: 12,   // matches CHART_TICK_STYLE 12px caption tier
      },
      grid: {
        vertLines: { color: CHART_TRACK },
        horzLines: { color: CHART_TRACK },
      },
      rightPriceScale: { borderColor: CHART_BORDER },
      timeScale: { borderColor: CHART_BORDER },
      crosshair: {
        vertLine: { labelBackgroundColor: CHART_ACCENT },
        horzLine: { labelBackgroundColor: CHART_ACCENT },
      },
    });

    const series = chart.addSeries(LineSeries, {
      color: CHART_ACCENT,
      lineWidth: 2,
      title: "Strategy",
      priceFormat: { type: "custom", formatter: PRICE_FORMATTER },
    });

    series.setData(
      data.map((d) => ({ time: d.date, value: d.value }))
    );

    chart.timeScale().fitContent();
    chartRef.current = chart;

    const resizeObserver = new ResizeObserver(() => {
      if (containerRef.current) {
        chart.applyOptions({ width: containerRef.current.clientWidth });
      }
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      chart.remove();
      chartRef.current = null;
      bmSeriesRef.current = null;
    };
  }, [data, height]);

  // Toggle benchmark series on/off without recreating the chart
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    // Remove existing benchmark series
    if (bmSeriesRef.current) {
      chart.removeSeries(bmSeriesRef.current);
      bmSeriesRef.current = null;
    }

    // Add benchmark series if toggled on and data exists
    if (showBenchmark && benchmarkSeries && benchmarkSeries.length > 0) {
      const bmSeries = chart.addSeries(LineSeries, {
        color: CHART_TEXT_MUTED,
        lineWidth: 1,
        title: "BTC",
        priceFormat: { type: "custom", formatter: PRICE_FORMATTER },
      });
      bmSeries.setData(
        benchmarkSeries.map((d) => ({ time: d.date, value: d.value }))
      );
      bmSeriesRef.current = bmSeries;
    }
  }, [showBenchmark, benchmarkSeries]);

  const hasBenchmark = benchmarkSeries && benchmarkSeries.length > 0;

  return (
    <div>
      {hasBenchmark && !hideBenchmarkToggle && (
        <div className="flex items-center gap-2 px-4 pt-3 pb-1">
          <label className="flex items-center gap-1.5 text-xs text-text-muted cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showBenchmark}
              onChange={(e) => setShowBenchmark(e.target.checked)}
              className="accent-slate-400 w-3.5 h-3.5"
            />
            <span className="inline-block w-3 h-0.5 rounded-full" style={{ backgroundColor: CHART_TEXT_MUTED }} />
            BTC Benchmark
          </label>
        </div>
      )}
      <div ref={containerRef} className="w-full rounded-lg overflow-hidden" />
    </div>
  );
}
