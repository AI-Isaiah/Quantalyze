"use client";

import { useEffect, useRef, useState } from "react";
import { createChart, LineSeries, type IChartApi } from "lightweight-charts";
import { STRATEGY_PALETTE } from "@/lib/utils";

interface PortfolioEquityCurveProps {
  portfolioEquityCurve: { date: string; value: number }[] | null;
  strategies: {
    id: string;
    name: string;
    equityCurve: { date: string; value: number }[] | null;
  }[];
  /**
   * Optional "+ favorites" overlay curve — the composite of the real
   * portfolio combined with toggled-on watchlist strategies, backfilled
   * from portfolio inception. Added in PR 3 of the My Allocation
   * restructure; wired by PR 4's FavoritesPanel. When null or omitted,
   * the chart renders only the portfolio composite + per-strategy series
   * and the component behaves exactly as before (this is the regression-
   * safety default).
   */
  overlayCurve?: { date: string; value: number }[] | null;
  /**
   * Legend label for the overlay curve. Defaults to "+ Favorites".
   */
  overlayLabel?: string;
}

const PNL_FORMATTER = (v: number) => `$${v.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
const RETURN_FORMATTER = (v: number) => `${((v - 1) * 100).toFixed(1)}%`;

export function PortfolioEquityCurve({
  portfolioEquityCurve,
  strategies,
  overlayCurve = null,
  overlayLabel = "+ Favorites",
}: PortfolioEquityCurveProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const [mode, setMode] = useState<"return" | "pnl">("return");

  useEffect(() => {
    if (!containerRef.current) return;

    const hasData =
      (portfolioEquityCurve && portfolioEquityCurve.length > 0) ||
      strategies.some((s) => s.equityCurve && s.equityCurve.length > 0) ||
      (overlayCurve && overlayCurve.length > 0);
    if (!hasData) return;

    const formatter = mode === "pnl" ? PNL_FORMATTER : RETURN_FORMATTER;

    const chart = createChart(containerRef.current, {
      height: 350,
      layout: {
        background: { color: "#FFFFFF" },
        textColor: "#718096",
        fontFamily: "'Geist Mono', monospace",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: "#F1F5F9" },
        horzLines: { color: "#F1F5F9" },
      },
      rightPriceScale: { borderColor: "#E2E8F0" },
      timeScale: { borderColor: "#E2E8F0" },
      crosshair: {
        vertLine: { labelBackgroundColor: "#1B6B5A" },
        horzLine: { labelBackgroundColor: "#1B6B5A" },
      },
    });

    // Strategy lines (thinner, from palette — skip index 0 reserved for portfolio)
    strategies.forEach((strategy, i) => {
      if (!strategy.equityCurve || strategy.equityCurve.length === 0) return;
      const color = STRATEGY_PALETTE[(i + 1) % STRATEGY_PALETTE.length];
      const series = chart.addSeries(LineSeries, {
        color,
        lineWidth: 1,
        title: strategy.name,
        priceFormat: { type: "custom", formatter },
      });
      series.setData(strategy.equityCurve.map((d) => ({ time: d.date, value: d.value })));
    });

    // Portfolio composite line (thick, always on top of strategies)
    if (portfolioEquityCurve && portfolioEquityCurve.length > 0) {
      const portfolioSeries = chart.addSeries(LineSeries, {
        color: "#1B6B5A",
        lineWidth: 3,
        title: "Portfolio",
        priceFormat: { type: "custom", formatter },
      });
      portfolioSeries.setData(portfolioEquityCurve.map((d) => ({ time: d.date, value: d.value })));
    }

    // "+ Favorites" overlay (dashed, 2px, accent color) — sits ON TOP of
    // the portfolio composite when the Favorites panel has any toggles
    // on. Renders nothing when overlayCurve is null/empty (default).
    if (overlayCurve && overlayCurve.length > 0) {
      const overlaySeries = chart.addSeries(LineSeries, {
        color: "#1B6B5A",
        lineWidth: 2,
        lineStyle: 2, // LightweightCharts LineStyle.Dashed
        title: overlayLabel,
        priceFormat: { type: "custom", formatter },
      });
      overlaySeries.setData(
        overlayCurve.map((d) => ({ time: d.date, value: d.value })),
      );
    }

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
  }, [portfolioEquityCurve, strategies, mode, overlayCurve, overlayLabel]);

  return (
    <div>
      <div className="flex items-center justify-between px-4 pt-3 pb-1">
        {/* Legend */}
        <div className="flex flex-wrap items-center gap-3">
          {portfolioEquityCurve && portfolioEquityCurve.length > 0 && (
            <span className="flex items-center gap-1.5 text-xs text-text-muted">
              <span className="inline-block w-3 h-0.5 rounded-full bg-[#1B6B5A]" style={{ height: 3 }} />
              Portfolio
            </span>
          )}
          {strategies.map((s, i) =>
            s.equityCurve && s.equityCurve.length > 0 ? (
              <span key={s.id} className="flex items-center gap-1.5 text-xs text-text-muted">
                <span
                  className="inline-block w-3 rounded-full"
                  style={{ height: 2, backgroundColor: STRATEGY_PALETTE[(i + 1) % STRATEGY_PALETTE.length] }}
                />
                {s.name}
              </span>
            ) : null
          )}
          {overlayCurve && overlayCurve.length > 0 && (
            <span className="flex items-center gap-1.5 text-xs text-text-muted">
              <span
                className="inline-block w-3 rounded-full border-t-[2px] border-dashed border-[#1B6B5A] bg-transparent"
                style={{ height: 2 }}
              />
              {overlayLabel}
            </span>
          )}
        </div>
        {/* PnL / Return toggle */}
        <div className="flex items-center gap-1 text-xs">
          <button
            onClick={() => setMode("return")}
            className={`px-2 py-0.5 rounded transition-colors ${mode === "return" ? "bg-accent text-white" : "text-text-muted hover:text-text-primary"}`}
          >
            Return %
          </button>
          <button
            onClick={() => setMode("pnl")}
            className={`px-2 py-0.5 rounded transition-colors ${mode === "pnl" ? "bg-accent text-white" : "text-text-muted hover:text-text-primary"}`}
          >
            PnL $
          </button>
        </div>
      </div>
      <div ref={containerRef} className="w-full rounded-lg overflow-hidden" />
    </div>
  );
}
