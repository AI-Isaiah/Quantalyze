import { Fragment } from "react";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

interface MonthlyHeatmapProps {
  data: Record<string, Record<string, number>>;
}

function cellColor(value: number): string {
  if (value > 0.1) return "bg-emerald-600 text-white";
  if (value > 0.05) return "bg-emerald-400 text-white";
  if (value > 0.02) return "bg-emerald-200 text-emerald-900";
  if (value > 0) return "bg-emerald-50 text-emerald-800";
  if (value === 0) return "bg-white text-text-muted";
  if (value > -0.02) return "bg-red-50 text-red-800";
  if (value > -0.05) return "bg-red-200 text-red-900";
  if (value > -0.1) return "bg-red-400 text-white";
  return "bg-red-600 text-white";
}

export function MonthlyHeatmap({ data }: MonthlyHeatmapProps) {
  const years = Object.keys(data).sort();

  return (
    <div className="overflow-x-auto">
      <div className="grid gap-px bg-border" style={{ gridTemplateColumns: `80px repeat(12, minmax(48px, 1fr))` }}>
        <div className="bg-surface px-2 py-2 text-xs font-medium text-text-muted" />
        {MONTHS.map((m) => (
          <div key={m} className="bg-surface px-2 py-2 text-center text-xs font-medium text-text-muted">
            {m}
          </div>
        ))}

        {years.map((year) => (
          <Fragment key={year}>
            <div className="bg-surface px-2 py-2 text-xs font-medium text-text-primary">
              {year}
            </div>
            {MONTHS.map((m) => {
              const val = data[year]?.[m];
              return (
                <div
                  key={`${year}-${m}`}
                  className={`px-1 py-2 text-center text-xs font-metric ${val != null ? cellColor(val) : "bg-surface text-text-muted"}`}
                  title={val != null ? `${(val * 100).toFixed(1)}%` : "N/A"}
                >
                  {val != null ? `${(val * 100).toFixed(1)}%` : ""}
                </div>
              );
            })}
          </Fragment>
        ))}
      </div>
    </div>
  );
}
