"use client";

interface ReturnQuantilesProps {
  data: Record<string, number[]>;
}

export function ReturnQuantiles({ data }: ReturnQuantilesProps) {
  const periods = Object.keys(data);
  if (periods.length === 0) return null;

  const allValues = Object.values(data).flat();
  const min = Math.min(...allValues);
  const max = Math.max(...allValues);
  const range = max - min || 1;

  const width = 600;
  const height = 200;
  const padding = { top: 20, right: 40, bottom: 30, left: 60 };
  const plotW = width - padding.left - padding.right;
  const plotH = height - padding.top - padding.bottom;

  function yScale(v: number) {
    return padding.top + plotH - ((v - min) / range) * plotH;
  }

  const boxWidth = Math.min(60, plotW / periods.length / 2);

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full">
      {/* Y axis grid lines */}
      {[0, 0.25, 0.5, 0.75, 1].map((frac) => {
        const val = min + frac * range;
        const y = yScale(val);
        return (
          <g key={frac}>
            <line x1={padding.left} x2={width - padding.right} y1={y} y2={y} stroke="#F1F5F9" />
            <text x={padding.left - 8} y={y + 4} textAnchor="end" fontSize={10} fill="#64748B" fontFamily="'JetBrains Mono', monospace">
              {(val * 100).toFixed(1)}%
            </text>
          </g>
        );
      })}

      {periods.map((period, i) => {
        const [q0, q25, q50, q75, q100] = data[period];
        const cx = padding.left + ((i + 0.5) / periods.length) * plotW;
        const halfBox = boxWidth / 2;

        return (
          <g key={period}>
            {/* Whisker */}
            <line x1={cx} x2={cx} y1={yScale(q0)} y2={yScale(q100)} stroke="#94A3B8" strokeWidth={1} />
            <line x1={cx - halfBox / 2} x2={cx + halfBox / 2} y1={yScale(q0)} y2={yScale(q0)} stroke="#94A3B8" strokeWidth={1} />
            <line x1={cx - halfBox / 2} x2={cx + halfBox / 2} y1={yScale(q100)} y2={yScale(q100)} stroke="#94A3B8" strokeWidth={1} />
            {/* Box */}
            <rect
              x={cx - halfBox}
              y={yScale(q75)}
              width={boxWidth}
              height={yScale(q25) - yScale(q75)}
              fill="#0D9488"
              opacity={0.15}
              stroke="#0D9488"
              strokeWidth={1}
              rx={2}
            />
            {/* Median */}
            <line x1={cx - halfBox} x2={cx + halfBox} y1={yScale(q50)} y2={yScale(q50)} stroke="#0D9488" strokeWidth={2} />
            {/* Label */}
            <text x={cx} y={height - 8} textAnchor="middle" fontSize={11} fill="#64748B">
              {period}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
