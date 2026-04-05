"use client";

import { useEffect, useRef, useState } from "react";
import { createChart, LineSeries, type IChartApi, type ISeriesApi, type SeriesType } from "lightweight-charts";

interface EquityCurveProps {
  data: { date: string; value: number }[];
  benchmarkSeries?: { date: string; value: number }[] | null;
  height?: number;
}

const PRICE_FORMATTER = (v: number) => `${((v - 1) * 100).toFixed(1)}%`;

export function EquityCurve({ data, benchmarkSeries, height = 350 }: EquityCurveProps) {
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
        background: { color: "#FFFFFF" },
        textColor: "#64748B",
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: "#F1F5F9" },
        horzLines: { color: "#F1F5F9" },
      },
      rightPriceScale: { borderColor: "#E2E8F0" },
      timeScale: { borderColor: "#E2E8F0" },
      crosshair: {
        vertLine: { labelBackgroundColor: "#0D9488" },
        horzLine: { labelBackgroundColor: "#0D9488" },
      },
    });

    const series = chart.addSeries(LineSeries, {
      color: "#0D9488",
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
        color: "#94A3B8",
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
      {hasBenchmark && (
        <div className="flex items-center gap-2 px-4 pt-3 pb-1">
          <label className="flex items-center gap-1.5 text-xs text-text-muted cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showBenchmark}
              onChange={(e) => setShowBenchmark(e.target.checked)}
              className="accent-slate-400 w-3.5 h-3.5"
            />
            <span className="inline-block w-3 h-0.5 rounded-full bg-[#94A3B8]" />
            BTC Benchmark
          </label>
        </div>
      )}
      <div ref={containerRef} className="w-full rounded-lg overflow-hidden" />
    </div>
  );
}
