"use client";

import { useMemo } from "react";
import { ResponsiveTable } from "@/components/ResponsiveTable";
import { normalizeDailyReturns, type DailyPoint } from "@/lib/portfolio-math-utils";
import { mean } from "@/lib/portfolio-math-utils";
import { withWidgetBoundary, type BaseWidgetProps } from "../lib/widget-boundary";
import { riskWidgetDataSchema, type RiskWidgetData } from "../lib/widget-data";

// ---------------------------------------------------------------------------
// Correlation Matrix Widget
//
// Reads data.analytics?.correlation_matrix if available, otherwise computes
// pairwise Pearson correlations from strategy daily returns. Rendered as an
// HTML table with teal (positive) / red (negative) / white (neutral) cells
// and a color legend gradient bar below.
// ---------------------------------------------------------------------------

/** Pearson correlation between two equal-length numeric arrays. */
function pearson(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 2) return 0;
  const ma = mean(a.slice(0, n));
  const mb = mean(b.slice(0, n));
  let cov = 0;
  let varA = 0;
  let varB = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - ma;
    const db = b[i] - mb;
    cov += da * db;
    varA += da * da;
    varB += db * db;
  }
  const denom = Math.sqrt(varA * varB);
  return denom > 0 ? cov / denom : 0;
}

/** Map correlation value [-1, 1] to a CSS color. */
function correlationColor(v: number): string {
  const clamped = Math.max(-1, Math.min(1, v));
  if (clamped >= 0) {
    // white → teal
    const t = clamped;
    const r = Math.round(255 - (255 - 27) * t);
    const g = Math.round(255 - (255 - 107) * t);
    const b = Math.round(255 - (255 - 90) * t);
    return `rgb(${r},${g},${b})`;
  } else {
    // white → red
    const t = -clamped;
    const r = Math.round(255 - (255 - 220) * t);
    const g = Math.round(255 - (255 - 38) * t);
    const b = Math.round(255 - (255 - 38) * t);
    return `rgb(${r},${g},${b})`;
  }
}

/** Pick text color for contrast on the cell background. */
function textColorForCorr(v: number): string {
  return Math.abs(v) > 0.5 ? "#FFFFFF" : "#1A1A2E";
}

interface StrategyReturns {
  name: string;
  // M-0215: keep dates so pairwise correlation aligns same-day returns.
  // normalizeDailyReturns returns date-sorted points, so `dates` is sorted.
  dates: string[];
  dateMap: Map<string, number>;
}

/**
 * M-0215: extract the two return arrays for a strategy pair restricted to the
 * dates BOTH strategies report, in a single shared order — so `pearson`
 * correlates same-calendar-day returns instead of pairing by raw array index
 * (which mis-correlates whenever two strategies have different start dates or
 * gaps). Mirrors RiskDecomposition.buildCovMatrix's common-date alignment.
 */
function alignedPair(
  a: StrategyReturns,
  b: StrategyReturns,
): [number[], number[]] {
  const av: number[] = [];
  const bv: number[] = [];
  for (const d of a.dates) {
    const bVal = b.dateMap.get(d);
    if (bVal !== undefined) {
      av.push(a.dateMap.get(d)!);
      bv.push(bVal);
    }
  }
  return [av, bv];
}

function CorrelationMatrixInner({ data }: { data: RiskWidgetData } & BaseWidgetProps) {
  const { names, matrix } = useMemo(() => {
    // Try pre-computed correlation matrix
    const precomputed = data.analytics?.correlation_matrix;
    if (precomputed && typeof precomputed === "object") {
      const keys = Object.keys(precomputed);
      if (keys.length > 0) {
        const m: number[][] = keys.map((row) =>
          keys.map((col) => {
            const v = (precomputed as Record<string, Record<string, number>>)[row]?.[col];
            return typeof v === "number" ? v : 0;
          }),
        );
        // Build name map from strategies
        const nameMap: Record<string, string> = {};
        if (data?.strategies && Array.isArray(data.strategies)) {
          for (const s of data.strategies) {
            const id = s?.strategy_id ?? s?.strategy?.id;
            const name =
              s?.alias ?? s?.strategy?.codename ?? s?.strategy?.name ?? id;
            if (id && name) nameMap[id] = name;
          }
        }
        const n = keys.map((k) => (nameMap[k] ?? k).slice(0, 10));
        return { names: n, matrix: m };
      }
    }

    // Compute from daily returns
    const strategies: StrategyReturns[] = [];
    if (data?.strategies && Array.isArray(data.strategies)) {
      for (const s of data.strategies) {
        const dr = normalizeDailyReturns(
          s?.strategy?.strategy_analytics?.daily_returns,
        );
        if (dr.length > 0) {
          const name = (
            s?.alias ??
            s?.strategy?.codename ??
            s?.strategy?.name ??
            "?"
          ).slice(0, 10);
          const dates: string[] = [];
          const dateMap = new Map<string, number>();
          for (const d of dr as DailyPoint[]) {
            dates.push(d.date);
            dateMap.set(d.date, d.value);
          }
          strategies.push({ name, dates, dateMap });
        }
      }
    }

    if (strategies.length === 0) return { names: [], matrix: [] };

    const n = strategies.length;
    const m: number[][] = Array.from({ length: n }, (_, i) =>
      Array.from({ length: n }, (_, j) => {
        if (i === j) return 1;
        const [av, bv] = alignedPair(strategies[i], strategies[j]);
        return pearson(av, bv);
      }),
    );
    return { names: strategies.map((s) => s.name), matrix: m };
  }, [data]);

  if (names.length === 0) {
    return (
      <div
        className="flex h-full items-center justify-center text-sm"
        style={{ color: "#64748B" }}
      >
        No correlation data available
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3" data-testid="correlation-matrix">
      <ResponsiveTable>
        <table className="w-full border-collapse text-center" style={{ fontSize: 11 }}>
          <thead>
            <tr>
              <th className="p-1" />
              {names.map((n) => (
                <th
                  key={n}
                  className="truncate p-1 font-sans font-medium"
                  style={{ color: "#4A5568", maxWidth: 80 }}
                  title={n}
                >
                  {n}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {matrix.map((row, i) => (
              <tr key={names[i]}>
                <td
                  className="truncate p-1 text-right font-sans font-medium"
                  style={{ color: "#4A5568", maxWidth: 80 }}
                  title={names[i]}
                >
                  {names[i]}
                </td>
                {row.map((val, j) => (
                  <td
                    key={`${i}-${j}`}
                    className="p-1 font-metric tabular-nums"
                    data-testid="corr-cell"
                    style={{
                      backgroundColor: correlationColor(val),
                      color: textColorForCorr(val),
                      minWidth: 40,
                      borderRadius: 2,
                    }}
                    aria-label={`${names[i]} and ${names[j]}: ${val.toFixed(2)} correlation`}
                  >
                    {val.toFixed(2)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </ResponsiveTable>

      {/* Color legend */}
      <div className="flex items-center gap-2 px-1">
        <span className="font-metric text-[10px]" style={{ color: "#64748B" }}>
          -1.0
        </span>
        <div
          className="h-3 flex-1 rounded"
          style={{
            background: "linear-gradient(to right, rgb(220,38,38), rgb(255,255,255) 50%, rgb(27,107,90))",
          }}
        />
        <span className="font-metric text-[10px]" style={{ color: "#64748B" }}>
          +1.0
        </span>
      </div>
    </div>
  );
}

// B21: validate `data` against the shared risk-widget contract + contain throws.
export const CorrelationMatrix = withWidgetBoundary(
  riskWidgetDataSchema,
  CorrelationMatrixInner,
  { area: "correlation-matrix" },
);
