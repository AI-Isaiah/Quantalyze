import { Fragment } from "react";
import {
  CHART_AXIS_TICK,
  CHART_NEGATIVE_100,
  CHART_NEGATIVE_300,
  CHART_NEGATIVE_700,
  CHART_NEGATIVE_800,
  CHART_NEUTRAL,
  CHART_POSITIVE_100,
  CHART_POSITIVE_300,
  CHART_POSITIVE_700,
  CHART_POSITIVE_800,
  CHART_TEXT_ON_LIGHT_NEGATIVE,
  CHART_TEXT_ON_LIGHT_POSITIVE,
} from "./chart-tokens";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

interface MonthlyHeatmapProps {
  data: Record<string, Record<string, number>>;
}

interface CellStyle {
  backgroundColor: string;
  color: string;
}

/**
 * MonthlyHeatmap diverging color cells. Tints are baked into the hex (no
 * container opacity) because container `opacity` alpha-blends BOTH the
 * foreground text and the background, collapsing contrast to ~1:1 for the
 * lighter steps — caught by axe with 138 color-contrast violations on the
 * 365d fixture (PR #108 review). Each (bg, text) pair below clears WCAG
 * AA 4.5:1 small text vs the white surface beneath. Colors come from
 * chart-tokens.ts so DailyHeatmap and any future heatmap consume the
 * same scale.
 */
const STYLE_BUCKETS = {
  posSaturated: { backgroundColor: CHART_POSITIVE_800, color: "#FFFFFF" },
  posStrong: { backgroundColor: CHART_POSITIVE_700, color: "#FFFFFF" },
  posMid: { backgroundColor: CHART_POSITIVE_300, color: CHART_TEXT_ON_LIGHT_POSITIVE },
  posLight: { backgroundColor: CHART_POSITIVE_100, color: CHART_TEXT_ON_LIGHT_POSITIVE },
  zero: { backgroundColor: CHART_NEUTRAL, color: CHART_AXIS_TICK },
  negLight: { backgroundColor: CHART_NEGATIVE_100, color: CHART_TEXT_ON_LIGHT_NEGATIVE },
  negMid: { backgroundColor: CHART_NEGATIVE_300, color: CHART_TEXT_ON_LIGHT_NEGATIVE },
  negStrong: { backgroundColor: CHART_NEGATIVE_700, color: "#FFFFFF" },
  negSaturated: { backgroundColor: CHART_NEGATIVE_800, color: "#FFFFFF" },
} as const;

function cellStyle(value: number): CellStyle {
  if (value > 0.10) return STYLE_BUCKETS.posSaturated;
  if (value > 0.05) return STYLE_BUCKETS.posStrong;
  if (value > 0.02) return STYLE_BUCKETS.posMid;
  if (value > 0) return STYLE_BUCKETS.posLight;
  if (value === 0) return STYLE_BUCKETS.zero;
  if (value > -0.02) return STYLE_BUCKETS.negLight;
  if (value > -0.05) return STYLE_BUCKETS.negMid;
  if (value > -0.10) return STYLE_BUCKETS.negStrong;
  return STYLE_BUCKETS.negSaturated;
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
