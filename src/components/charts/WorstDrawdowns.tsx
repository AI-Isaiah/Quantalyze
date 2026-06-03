"use client";

import { useMemo } from "react";
import { segmentDrawdowns, type DrawdownEpisode } from "@/lib/drawdown-math";
import {
  WORST_DRAWDOWNS_MIN_DAYS,
  insufficientHistoryMessage,
} from "@/lib/min-history";
import type { StrategyAnalytics, TimeSeriesPoint } from "@/lib/types";
import { formatPercent } from "@/lib/utils";

/**
 * Renders the top 5 worst historical drawdowns. Prefers server-computed
 * `metrics_json.drawdown_episodes` and falls back to a client-side
 * segmentation of `drawdown_series`.
 */

interface ServerEpisode {
  peak_date: string;
  trough_date: string;
  recovery_date: string | null;
  depth_pct: number;
  duration_days: number;
  is_current: boolean;
}

function isServerEpisode(value: unknown): value is ServerEpisode {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.peak_date === "string" &&
    typeof v.trough_date === "string" &&
    (v.recovery_date === null || typeof v.recovery_date === "string") &&
    typeof v.depth_pct === "number" &&
    typeof v.duration_days === "number" &&
    typeof v.is_current === "boolean"
  );
}

// Mirrors the `segmentDrawdowns` default so server-sourced and
// client-sourced lists apply the same floor.
const MIN_DEPTH_PCT = 0.005;

function normalize(analytics: StrategyAnalytics): DrawdownEpisode[] {
  const raw = (analytics.metrics_json ?? {}) as Record<string, unknown>;
  const serverRaw = raw.drawdown_episodes;
  if (Array.isArray(serverRaw) && serverRaw.length > 0) {
    // Shape validation FIRST so we can distinguish "all entries malformed"
    // (a silent-failure cluster bug worth logging) from "well-formed but
    // below the 0.5% floor" (intentional filtering, no log).
    const shapeValid = serverRaw.filter(isServerEpisode);
    if (shapeValid.length === 0) {
      // P65: surface the malformation instead of silently falling through.
      // eslint-disable-next-line no-console
      console.error(
        "[WorstDrawdowns] server drawdown_episodes malformed — every entry failed shape validation. Sample:",
        JSON.stringify(serverRaw[0]),
      );
    } else {
      const validated = shapeValid.filter(
        (e) => Math.abs(e.depth_pct) >= MIN_DEPTH_PCT,
      );
      if (validated.length > 0) {
        return validated.slice(0, 5).map((e) => ({
          peakDate: e.peak_date,
          troughDate: e.trough_date,
          recoveryDate: e.recovery_date,
          depthPct: e.depth_pct,
          durationDays: e.duration_days,
          isCurrent: e.is_current,
        }));
      }
      // All well-formed entries below the depth floor — fall through to
      // client-side segmentation (which applies the same floor) without
      // logging; this is intentional filtering, not malformation.
    }
  }

  const series = (analytics.drawdown_series ?? []) as TimeSeriesPoint[];
  return segmentDrawdowns(series, MIN_DEPTH_PCT).slice(0, 5);
}

function buildAriaLabel(episode: DrawdownEpisode, index: number): string {
  const depth = formatPercent(episode.depthPct);
  const base = `Drawdown ${index + 1}: ${depth} from ${episode.peakDate} to ${episode.troughDate}`;
  if (episode.isCurrent) {
    return `${base}, ongoing after ${episode.durationDays} days`;
  }
  return `${base}, recovered ${episode.recoveryDate ?? "—"} (${episode.durationDays} days)`;
}

const HEADER_CELL =
  "text-[10px] uppercase tracking-wider text-text-muted font-medium py-2 px-4 border-b border-border";
const CELL_BASE = "py-2 px-4 align-middle";
const CELL_DATE = `${CELL_BASE} text-xs text-text-secondary font-metric tabular-nums`;
// M-0404: keep font-metric so the "ongoing" cell aligns in the mono column
// with the sibling date cells (matches CELL_DATE's family).
const CELL_ONGOING = `${CELL_BASE} text-xs text-warning italic font-metric`;
const CELL_DEPTH = `${CELL_BASE} text-sm font-metric tabular-nums text-right text-negative`;
const CELL_DAYS = `${CELL_BASE} text-xs font-metric tabular-nums text-text-muted text-right`;

export function WorstDrawdowns({ analytics }: { analytics: StrategyAnalytics }) {
  const episodes = useMemo(() => normalize(analytics), [analytics]);

  // P69: top-5 drawdowns are statistically meaningless on thin history.
  // Use the length of `drawdown_series` as the inferable history measure
  // (one point per day in the analytics worker output). The gate runs
  // AFTER `normalize()` so malformed-server logging (P65) still fires.
  const historyDays = analytics.drawdown_series?.length ?? 0;
  if (historyDays < WORST_DRAWDOWNS_MIN_DAYS) {
    return (
      <div className="text-sm text-text-muted p-6 text-center">
        {insufficientHistoryMessage(
          "top-5 drawdowns",
          WORST_DRAWDOWNS_MIN_DAYS,
          historyDays,
        )}
      </div>
    );
  }

  if (episodes.length === 0) {
    return (
      <div className="text-sm text-text-muted p-6 text-center">
        No meaningful drawdowns — largest &lt; 0.5%.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr>
            <th className={`${HEADER_CELL} text-left`}>Peak</th>
            <th className={`${HEADER_CELL} text-left`}>Trough</th>
            <th className={`${HEADER_CELL} text-left`}>Recovery</th>
            <th className={`${HEADER_CELL} text-right`}>Depth</th>
            <th className={`${HEADER_CELL} text-right`}>Days</th>
          </tr>
        </thead>
        <tbody>
          {episodes.map((ep, i) => (
            <tr
              // M-0406: (peakDate, troughDate) uniquely identifies an episode,
              // so the index suffix only pinned keys to list position — drop it
              // for stable reconciliation. `i` is still used by the aria-label.
              key={`${ep.peakDate}-${ep.troughDate}`}
              aria-label={buildAriaLabel(ep, i)}
              className="border-b border-border hover:bg-page transition-colors duration-150"
            >
              <td className={CELL_DATE}>{ep.peakDate}</td>
              <td className={CELL_DATE}>{ep.troughDate}</td>
              <td className={ep.isCurrent ? CELL_ONGOING : CELL_DATE}>
                {ep.isCurrent ? "ongoing" : (ep.recoveryDate ?? "—")}
              </td>
              <td className={CELL_DEPTH}>{formatPercent(ep.depthPct)}</td>
              <td className={CELL_DAYS}>
                {ep.isCurrent ? `${ep.durationDays}\u2026` : ep.durationDays}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
