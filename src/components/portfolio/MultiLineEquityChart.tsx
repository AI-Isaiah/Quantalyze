"use client";

import type { DailyPoint } from "@/lib/scenario";

export interface StrategySeries {
  id: string;
  name: string;
  color: string;
  points: DailyPoint[];
}

export function MultiLineEquityChart({
  composite,
  strategies,
  emptyMessage,
}: {
  composite: DailyPoint[];
  strategies: StrategySeries[];
  emptyMessage: string;
}) {
  const hasAnything =
    composite.length >= 2 || strategies.some((s) => s.points.length >= 2);
  if (!hasAnything) {
    return (
      <div className="flex h-64 items-center justify-center rounded-lg border border-border bg-bg-secondary text-sm text-text-muted">
        {emptyMessage}
      </div>
    );
  }

  const width = 800;
  const height = 280;
  const padding = { top: 8, right: 8, bottom: 24, left: 40 };
  const innerW = width - padding.left - padding.right;
  const innerH = height - padding.top - padding.bottom;

  // Build the union date axis from the composite (it's the densest).
  // Fallback to the longest strategy if no composite.
  const axis =
    composite.length > 0
      ? composite.map((p) => p.date)
      : [...strategies].sort((a, b) => b.points.length - a.points.length)[0]
          ?.points.map((p) => p.date) ?? [];
  if (axis.length < 2) {
    return (
      <div className="flex h-64 items-center justify-center rounded-lg border border-border bg-bg-secondary text-sm text-text-muted">
        {emptyMessage}
      </div>
    );
  }

  const axisIndex = new Map(axis.map((d, i) => [d, i]));

  // Gather every value to compute the Y range across composite + strategies
  const allValues: number[] = [];
  for (const p of composite) allValues.push(p.value);
  for (const s of strategies) for (const p of s.points) allValues.push(p.value);
  const minV = Math.min(0, ...allValues);
  const maxV = Math.max(0, ...allValues);
  const range = maxV - minV || 1;

  const xFor = (i: number) =>
    padding.left + (i / (axis.length - 1)) * innerW;
  const yFor = (v: number) =>
    padding.top + innerH - ((v - minV) / range) * innerH;

  const pointsToPath = (pts: DailyPoint[]): string => {
    if (pts.length === 0) return "";
    const segs: string[] = [];
    let started = false;
    for (const p of pts) {
      const i = axisIndex.get(p.date);
      if (i === undefined) continue;
      segs.push(`${started ? "L" : "M"} ${xFor(i).toFixed(2)} ${yFor(p.value).toFixed(2)}`);
      started = true;
    }
    return segs.join(" ");
  };

  const compositePath = pointsToPath(composite);
  const compositeArea =
    composite.length > 0
      ? compositePath +
        ` L ${xFor(axis.length - 1).toFixed(2)} ${yFor(0).toFixed(2)}` +
        ` L ${xFor(0).toFixed(2)} ${yFor(0).toFixed(2)} Z`
      : "";

  const yTicks = Array.from(
    new Set([minV, 0, maxV].map((v) => Math.round(v * 1000) / 1000)),
  );

  return (
    <div className="w-full h-full">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full h-full"
        aria-label="Allocation equity curve, portfolio composite plus per-strategy lines"
        role="img"
      >
        <defs>
          <linearGradient id="my-allocation-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#1B6B5A" stopOpacity="0.22" />
            <stop offset="100%" stopColor="#1B6B5A" stopOpacity="0.02" />
          </linearGradient>
        </defs>

        {yTicks.map((v) => (
          <g key={v}>
            <line
              x1={padding.left}
              x2={width - padding.right}
              y1={yFor(v)}
              y2={yFor(v)}
              stroke="#E2E8F0"
              strokeDasharray="3 3"
            />
            <text
              x={padding.left - 6}
              y={yFor(v) + 4}
              fontSize="10"
              textAnchor="end"
              fill="#64748B"
            >
              {(v * 100).toFixed(0)}%
            </text>
          </g>
        ))}

        {/* Per-strategy lines first so the composite sits on top */}
        {strategies.map((s) => {
          const d = pointsToPath(s.points);
          if (!d) return null;
          return (
            <path
              key={s.id}
              d={d}
              stroke={s.color}
              strokeWidth="1.5"
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity="0.85"
            />
          );
        })}

        {/* Composite area + line */}
        {compositeArea ? (
          <path d={compositeArea} fill="url(#my-allocation-grad)" stroke="none" />
        ) : null}
        {compositePath ? (
          <path
            d={compositePath}
            stroke="#1B6B5A"
            strokeWidth="2.5"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ) : null}

        <text x={padding.left} y={height - 8} fontSize="10" fill="#64748B">
          {axis[0]}
        </text>
        <text
          x={width - padding.right}
          y={height - 8}
          fontSize="10"
          textAnchor="end"
          fill="#64748B"
        >
          {axis[axis.length - 1]}
        </text>
      </svg>
    </div>
  );
}

export function StrategyLegend({
  items,
  hiddenIds,
  onToggle,
}: {
  items: { id: string; name: string; color: string }[];
  hiddenIds: Set<string>;
  onToggle: (id: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <div className="inline-flex items-center gap-1.5 rounded-md bg-bg-secondary px-2 py-1">
        <span
          className="inline-block h-0.5 w-3 rounded"
          style={{ background: "#1B6B5A" }}
          aria-hidden="true"
        />
        <span className="text-[11px] font-medium text-text-primary">
          Portfolio
        </span>
      </div>
      {items.map((it) => {
        const hidden = hiddenIds.has(it.id);
        return (
          <button
            key={it.id}
            type="button"
            onClick={() => onToggle(it.id)}
            aria-pressed={!hidden}
            className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 border transition-colors ${
              hidden
                ? "border-border bg-surface text-text-muted"
                : "border-transparent bg-bg-secondary text-text-primary hover:bg-border"
            }`}
            title={hidden ? `Show ${it.name}` : `Hide ${it.name}`}
          >
            <span
              className="inline-block h-0.5 w-3 rounded"
              style={{ background: hidden ? "#CBD5E1" : it.color }}
              aria-hidden="true"
            />
            <span className="text-[11px] font-medium">{it.name}</span>
          </button>
        );
      })}
    </div>
  );
}
