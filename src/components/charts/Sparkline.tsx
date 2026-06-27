interface SparklineProps {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
  fill?: boolean;
  className?: string;
  /**
   * audit-2026-05-07 testing finding M-discovery-sparkline:231 —
   * E2E specs need a stable hook to disambiguate the returns
   * sparkline from sibling icon SVGs that may be added to the
   * StrategyTable row in the future. Optional so existing call
   * sites that don't need it stay untouched.
   */
  "data-testid"?: string;
}

// Phase 47: legibility/portrait N/A — 120×32 decorative inline sparkline, no
// text/axis/labels and no hover (RESEARCH Open Question 2, resolved NO-OP). It
// carries zero axis text to downscale below the 320px legibility floor and no
// desktop value-reveal to add a tap-pin for, so it is intentionally left
// functionally unchanged: no ResponsiveChartFrame, no useBreakpoint, no
// isMobile conditional (→ no new branch → no test needed). It already renders
// at intrinsic CSS px (no viewBox-downscale trap) in the discovery-list rows.
export function Sparkline({
  data,
  width = 120,
  height = 32,
  color = "var(--color-chart-strategy)",
  fill = false,
  className = "",
  "data-testid": dataTestId,
}: SparklineProps) {
  if (!data || data.length < 2) return null;

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const padding = 1;

  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * (width - padding * 2) + padding;
    const y = height - padding - ((v - min) / range) * (height - padding * 2);
    return `${x},${y}`;
  });

  const pathD = `M${points.join("L")}`;
  const lastPoint = points[points.length - 1].split(",");

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      data-testid={dataTestId}
    >
      {fill && (
        <path
          d={`${pathD}L${width - padding},${height - padding}L${padding},${height - padding}Z`}
          fill={color}
          opacity={0.1}
        />
      )}
      <path
        d={pathD}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle
        cx={lastPoint[0]}
        cy={lastPoint[1]}
        r={2}
        fill={color}
      />
    </svg>
  );
}
