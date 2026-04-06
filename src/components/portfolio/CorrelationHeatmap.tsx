"use client";

import { Fragment, useMemo } from "react";

interface CorrelationHeatmapProps {
  correlationMatrix: Record<string, Record<string, number>> | null;
  strategyNames: Record<string, string>;
}

/** Blue-orange interpolation: -1 deep blue, 0 white, +1 deep orange */
function correlationBg(v: number): string {
  const stops = [
    { at: -1.0, r: 30, g: 64, b: 175 },
    { at: -0.5, r: 147, g: 197, b: 253 },
    { at: 0.0, r: 255, g: 255, b: 255 },
    { at: 0.5, r: 253, g: 186, b: 116 },
    { at: 1.0, r: 234, g: 88, b: 12 },
  ];
  const clamped = Math.max(-1, Math.min(1, v));
  let lo = stops[0], hi = stops[stops.length - 1];
  for (let i = 0; i < stops.length - 1; i++) {
    if (clamped >= stops[i].at && clamped <= stops[i + 1].at) {
      lo = stops[i];
      hi = stops[i + 1];
      break;
    }
  }
  const t = hi.at === lo.at ? 0 : (clamped - lo.at) / (hi.at - lo.at);
  const r = Math.round(lo.r + t * (hi.r - lo.r));
  const g = Math.round(lo.g + t * (hi.g - lo.g));
  const b = Math.round(lo.b + t * (hi.b - lo.b));
  return `rgb(${r},${g},${b})`;
}

function textColor(v: number): string {
  return Math.abs(v) > 0.7 ? "#FFFFFF" : "#1A1A2E";
}

export function CorrelationHeatmap({ correlationMatrix, strategyNames }: CorrelationHeatmapProps) {
  const ids = useMemo(() => {
    if (!correlationMatrix) return [];
    const all = Object.keys(correlationMatrix);
    if (all.length <= 10) return all;
    // Top-10 most-correlated pairs: pick the 10 IDs with highest avg |corr|
    const avgCorr = all.map((id) => {
      const row = correlationMatrix[id];
      const others = all.filter((o) => o !== id);
      const avg = others.reduce((s, o) => s + Math.abs(row[o] ?? 0), 0) / (others.length || 1);
      return { id, avg };
    });
    avgCorr.sort((a, b) => b.avg - a.avg);
    return avgCorr.slice(0, 10).map((x) => x.id);
  }, [correlationMatrix]);

  if (!correlationMatrix || ids.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-surface px-4 py-8 text-center text-text-muted text-sm">
        No correlation data available.
      </div>
    );
  }

  const n = ids.length;
  const label = (id: string) => strategyNames[id] ?? id.slice(0, 8);

  return (
    <div className="overflow-x-auto">
      <div
        className="grid gap-px bg-border"
        style={{ gridTemplateColumns: `80px repeat(${n}, minmax(48px, 1fr))` }}
      >
        {/* Top-left empty corner */}
        <div className="bg-surface" />
        {/* Column headers */}
        {ids.map((id) => (
          <div key={`ch-${id}`} className="bg-surface px-1 py-2 text-[10px] uppercase tracking-wider text-text-muted text-center truncate">
            {label(id)}
          </div>
        ))}
        {/* Rows */}
        {ids.map((rowId) => (
          <Fragment key={rowId}>
            {/* Row header */}
            <div className="bg-surface px-2 py-2 text-[10px] uppercase tracking-wider text-text-muted truncate flex items-center">
              {label(rowId)}
            </div>
            {/* Cells */}
            {ids.map((colId) => {
              const v = correlationMatrix[rowId]?.[colId] ?? null;
              const isDiag = rowId === colId;
              return (
                <div
                  key={`${rowId}-${colId}`}
                  className="flex items-center justify-center py-2 font-metric text-xs"
                  style={{
                    backgroundColor: v != null ? (isDiag ? "#F1F5F9" : correlationBg(v)) : "#F8F9FA",
                    color: v != null && !isDiag ? textColor(v) : "#718096",
                  }}
                >
                  {v != null ? v.toFixed(2) : "\u2014"}
                </div>
              );
            })}
          </Fragment>
        ))}
      </div>
    </div>
  );
}
