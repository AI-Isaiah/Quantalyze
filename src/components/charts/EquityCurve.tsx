"use client";

import { useEffect, useRef } from "react";
import { createChart, LineSeries, type IChartApi } from "lightweight-charts";

interface EquityCurveProps {
  data: { date: string; value: number }[];
  height?: number;
}

export function EquityCurve({ data, height = 350 }: EquityCurveProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

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
      priceFormat: { type: "custom", formatter: (v: number) => `${((v - 1) * 100).toFixed(1)}%` },
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
    };
  }, [data, height]);

  return <div ref={containerRef} className="w-full rounded-lg overflow-hidden" />;
}
