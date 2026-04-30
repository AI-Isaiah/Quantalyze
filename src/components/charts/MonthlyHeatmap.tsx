import { Fragment } from "react";
import { CHART_AXIS_TICK } from "./chart-tokens";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

interface MonthlyHeatmapProps {
  data: Record<string, Record<string, number>>;
}

interface CellStyle {
  backgroundColor: string;
  color: string;
}

/**
 * MonthlyHeatmap diverging color cells.
 *
 * Uses explicit hex colors instead of Tailwind palette indices. Positive
 * scale anchored at the green-100/300/700/800 ramp; negative scale at
 * red-100/300/700/800. Tints are baked into the hex (no container opacity)
 * because container `opacity` alpha-blends BOTH the foreground text and
 * the background, collapsing contrast to ~1:1 for the lighter steps —
 * caught by axe with 138 color-contrast violations on the 365d fixture
 * (PR #108 review). Each (bg, text) pair below clears WCAG AA 4.5:1 small
 * text vs the white surface beneath; verified during PR #108 fix.
 */
function cellStyle(value: number): CellStyle {
  if (value > 0.10) return { backgroundColor: "#166534", color: "#FFFFFF" };
  if (value > 0.05) return { backgroundColor: "#15803D", color: "#FFFFFF" };
  if (value > 0.02) return { backgroundColor: "#86EFAC", color: "#0F3D2D" };
  if (value > 0) return { backgroundColor: "#DCFCE7", color: "#0F3D2D" };
  if (value === 0) return { backgroundColor: "#FFFFFF", color: CHART_AXIS_TICK };
  if (value > -0.02) return { backgroundColor: "#FEE2E2", color: "#7F1D1D" };
  if (value > -0.05) return { backgroundColor: "#FCA5A5", color: "#7F1D1D" };
  if (value > -0.10) return { backgroundColor: "#B91C1C", color: "#FFFFFF" };
  return { backgroundColor: "#991B1B", color: "#FFFFFF" };
}

export function MonthlyHeatmap({ data }: MonthlyHeatmapProps) {
  const years = Object.keys(data).sort();

  return (
    <div className="overflow-x-auto">
      <div
        className="grid gap-px bg-border"
        style={{ gridTemplateColumns: `80px repeat(12, minmax(48px, 1fr))` }}
      >
        <div className="bg-surface px-2 py-2 text-xs font-normal text-text-muted" />
        {MONTHS.map((m) => (
          <div
            key={m}
            className="bg-surface px-2 py-2 text-center text-xs font-normal text-text-muted"
          >
            {m}
          </div>
        ))}

        {years.map((year) => (
          <Fragment key={year}>
            <div className="bg-surface px-2 py-2 text-xs font-normal text-text-primary">
              {year}
            </div>
            {MONTHS.map((m) => {
              const val = data[year]?.[m];
              if (val == null) {
                return (
                  <div
                    key={`${year}-${m}`}
                    className="bg-surface px-1 py-2 text-center text-xs font-normal text-text-muted"
                    title="N/A"
                  >
                    {""}
                  </div>
                );
              }
              const s = cellStyle(val);
              return (
                <div
                  key={`${year}-${m}`}
                  className="px-1 py-2 text-center text-xs font-normal tabular-nums"
                  style={{
                    backgroundColor: s.backgroundColor,
                    color: s.color,
                  }}
                  title={`${(val * 100).toFixed(1)}%`}
                >
                  {`${(val * 100).toFixed(1)}%`}
                </div>
              );
            })}
          </Fragment>
        ))}
      </div>
    </div>
  );
}
