"use client";

import { formatCurrency } from "@/lib/utils";

export function AllocationPie({
  slices,
  hiddenIds,
  onToggle,
}: {
  slices: {
    id: string;
    name: string;
    color: string;
    amount: number;
  }[];
  hiddenIds: Set<string>;
  onToggle: (id: string) => void;
}) {
  const visible = slices.filter((s) => !hiddenIds.has(s.id));
  const total = visible.reduce((sum, s) => sum + s.amount, 0);
  if (total <= 0) {
    return (
      <div className="flex h-48 items-center justify-center rounded-lg border border-border bg-bg-secondary text-sm text-text-muted">
        Allocation data unavailable.
      </div>
    );
  }

  const cx = 90;
  const cy = 90;
  const r = 80;

  // Build SVG arc paths. Pre-compute start angles as a cumulative sum so
  // the render-time closure never mutates state.
  const startAngles: number[] = [];
  {
    let running = -Math.PI / 2; // start at 12 o'clock
    for (const s of visible) {
      startAngles.push(running);
      running += (s.amount / total) * Math.PI * 2;
    }
  }
  const paths = visible.map((s, i) => {
    const angle = startAngles[i];
    const sweep = (s.amount / total) * Math.PI * 2;
    const x1 = cx + Math.cos(angle) * r;
    const y1 = cy + Math.sin(angle) * r;
    const x2 = cx + Math.cos(angle + sweep) * r;
    const y2 = cy + Math.sin(angle + sweep) * r;
    const largeArc = sweep > Math.PI ? 1 : 0;
    // Full-circle edge case: draw a tiny gap so the path still renders
    const d =
      sweep >= Math.PI * 2 - 1e-6
        ? `M ${cx} ${cy - r} A ${r} ${r} 0 1 1 ${cx - 0.01} ${cy - r} Z`
        : `M ${cx} ${cy} L ${x1.toFixed(3)} ${y1.toFixed(3)} A ${r} ${r} 0 ${largeArc} 1 ${x2.toFixed(3)} ${y2.toFixed(3)} Z`;
    return {
      id: s.id,
      name: s.name,
      color: s.color,
      d,
      pct: s.amount / total,
    };
  });

  return (
    <div className="flex flex-col items-start gap-3 md:flex-row md:items-center md:gap-6">
      <svg
        viewBox="0 0 180 180"
        className="w-44 h-44 shrink-0"
        aria-label="Allocation share per strategy"
        role="img"
      >
        {paths.map((p) => (
          <path
            key={p.id}
            d={p.d}
            fill={p.color}
            stroke="#F8FAFC"
            strokeWidth="1.5"
          />
        ))}
      </svg>
      <ul className="min-w-0 flex-1 space-y-1.5">
        {slices.map((s) => {
          const hidden = hiddenIds.has(s.id);
          const pct = hidden ? 0 : s.amount / total;
          return (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => onToggle(s.id)}
                aria-pressed={!hidden}
                className={`flex w-full items-center gap-2 rounded-md px-2 py-1 text-left transition-colors ${
                  hidden
                    ? "text-text-muted hover:bg-bg-secondary"
                    : "text-text-primary hover:bg-bg-secondary"
                }`}
              >
                <span
                  className="inline-block h-3 w-3 rounded-sm shrink-0"
                  style={{
                    background: hidden ? "#E2E8F0" : s.color,
                  }}
                  aria-hidden="true"
                />
                <span className="flex-1 truncate text-[12px] font-medium">
                  {s.name}
                </span>
                <span className="shrink-0 text-[11px] font-metric tabular-nums text-text-muted">
                  {hidden ? "---" : `${(pct * 100).toFixed(1)}%`}
                </span>
                <span className="shrink-0 w-16 text-right text-[11px] font-metric tabular-nums">
                  {formatCurrency(s.amount)}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
