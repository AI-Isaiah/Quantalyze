import { Fragment } from "react";
import { CHART_AXIS_TICK } from "./chart-tokens";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

interface MonthlyHeatmapProps {
  data: Record<string, Record<string, number>>;
}

interface CellStyle {
  backgroundColor: string;
  opacity: number;
  color: string;
}

/**
 * MonthlyHeatmap diverging color cells.
 *
 * Uses explicit hex colors instead of Tailwind palette indices. Positive
 * scale anchored at #16A34A (DESIGN.md positive token); negative scale
 * anchored at #DC2626 (DESIGN.md negative token). Opacity steps replace
 * the Tailwind 50/200/400/600 numeric scale.
 */
function cellStyle(value: number): CellStyle {
  if (value > 0.10) return { backgroundColor: "#16A34A", opacity: 1.0, color: "#FFFFFF" };
  if (value > 0.05) return { backgroundColor: "#16A34A", opacity: 0.7, color: "#FFFFFF" };
  if (value > 0.02) return { backgroundColor: "#16A34A", opacity: 0.4, color: "#0F3D2D" };
  if (value > 0) return { backgroundColor: "#16A34A", opacity: 0.15, color: "#0F3D2D" };
  if (value === 0) return { backgroundColor: "#FFFFFF", opacity: 1.0, color: CHART_AXIS_TICK };
  if (value > -0.02) return { backgroundColor: "#DC2626", opacity: 0.15, color: "#7F1D1D" };
  if (value > -0.05) return { backgroundColor: "#DC2626", opacity: 0.4, color: "#7F1D1D" };
  if (value > -0.10) return { backgroundColor: "#DC2626", opacity: 0.7, color: "#FFFFFF" };
  return { backgroundColor: "#DC2626", opacity: 1.0, color: "#FFFFFF" };
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
                    opacity: s.opacity,
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
