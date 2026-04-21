"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Line, LineChart, ResponsiveContainer } from "recharts";
import type { WidgetProps } from "../../lib/types";
import type {
  MyAllocationDashboardPayload,
  OutcomeRow,
} from "@/lib/queries";
import { computeOutcomeKPIs, type OutcomeKPIs } from "@/lib/outcomes-kpi";
import {
  deriveOutcomeLabel,
  deriveOutcomeStatusPill,
  type OutcomeStatusPill,
} from "@/lib/bridge-outcome-label";
import type { BridgeOutcome } from "@/lib/bridge-outcome-schema";
// Phase 08 Plan 04 Task 2 — "Your note" section inside ExpandedPanel
// (MANAGE-05 bridge_outcome scope).
import { BridgeOutcomeNoteSection } from "@/components/notes/BridgeOutcomeNoteSection";

/**
 * Phase 5 Outcomes Dashboard widget — SINGLE-FILE per Voice-D1 (2026-04-19).
 * Pattern: CustomKpiStrip + PositionsTable (inline sub-components, co-located
 * tests render the whole widget and find sub-nodes via role/aria/text).
 *
 * DASHBOARD-01..06 + D-01..D-19 + Voice-D5 truncation footer.
 */

// ---------------------------------------------------------------- types

type CurveData = {
  original: Array<{ date: string; nav: number }>;
  replacement: Array<{ date: string; nav: number }>;
  allocated_at: string | null;
};

type SparklinePoint = {
  date: string;
  original?: number;
  replacement?: number;
};

const COL_SPAN = 6;

const WINDOWS: Array<{
  label: "30d" | "90d" | "180d";
  days: number;
  key: "delta_30d" | "delta_90d" | "delta_180d";
}> = [
  { label: "30d", days: 30, key: "delta_30d" },
  { label: "90d", days: 90, key: "delta_90d" },
  { label: "180d", days: 180, key: "delta_180d" },
];

// ---------------------------------------------------------- pure helpers

function formatPercent(v: number | null): string {
  if (v === null) return "\u2014";
  const pct = v * 100;
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(1)}%`;
}

function winRateColor(winRate: number | null): string {
  if (winRate === null) return "#1A1A2E";
  if (winRate > 0.5) return "#16A34A";
  if (winRate < 0.5) return "#DC2626";
  return "#1A1A2E";
}

function deltaColor(v: number | null): string {
  if (v === null) return "#718096";
  if (v > 0) return "#16A34A";
  if (v < 0) return "#DC2626";
  return "#1A1A2E";
}

function toneColor(
  tone: "positive" | "negative" | "neutral",
): string {
  if (tone === "positive") return "#16A34A";
  if (tone === "negative") return "#DC2626";
  return "#718096";
}

function pillStyle(
  p: OutcomeStatusPill,
): { color: string; backgroundColor: string } {
  if (p.state === "allocated-win")
    return { color: "#16A34A", backgroundColor: "rgba(22,163,74,0.10)" };
  if (p.state === "allocated-loss")
    return { color: "#DC2626", backgroundColor: "rgba(220,38,38,0.08)" };
  return { color: "#718096", backgroundColor: "rgba(148,163,184,0.10)" };
}

function addDaysISO(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function formatDate(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function sliceToWindow(
  curve: CurveData | null,
  allocatedAt: string | null,
  days: number,
): SparklinePoint[] {
  if (!curve || !allocatedAt) return [];
  const end = addDaysISO(allocatedAt, days);
  const origMap = new Map(
    curve.original.filter((p) => p.date <= end).map((p) => [p.date, p.nav]),
  );
  const replMap = new Map(
    curve.replacement
      .filter((p) => p.date <= end)
      .map((p) => [p.date, p.nav]),
  );
  const allDates = Array.from(
    new Set([...origMap.keys(), ...replMap.keys()]),
  ).sort();
  return allDates.map((date) => ({
    date,
    original: origMap.get(date),
    replacement: replMap.get(date),
  }));
}

function formatDelta(
  v: number | null,
): { text: string; tone: "positive" | "negative" | "neutral" } {
  if (v === null) return { text: "Pending", tone: "neutral" };
  const pct = v * 100;
  const sign = pct > 0 ? "+" : "";
  return {
    text: `${sign}${pct.toFixed(1)}%`,
    tone: v > 0 ? "positive" : v < 0 ? "negative" : "neutral",
  };
}

// ----------------------------------------------------- inline sub-components

// DASHBOARD-02 — KPI strip. Geist Mono 13px tabular-nums values, DM Sans
// 11px uppercase labels, hairline dividers.
function KpiStrip({ kpis }: { kpis: OutcomeKPIs }) {
  return (
    <div className="flex h-full items-center justify-around gap-2">
      <div className="flex flex-col items-center px-3 py-1 border-r border-[#E2E8F0]">
        <span
          className="text-[11px] uppercase tracking-wider font-semibold"
          style={{ color: "#718096" }}
        >
          TOTAL
        </span>
        <span
          className="font-mono text-[13px] tabular-nums font-medium"
          style={{ color: "#1A1A2E" }}
        >
          {kpis.totalOutcomes}
        </span>
      </div>

      <div className="flex flex-col items-center px-3 py-1 border-r border-[#E2E8F0]">
        <span
          className="text-[11px] uppercase tracking-wider font-semibold"
          style={{ color: "#718096" }}
        >
          WIN RATE
        </span>
        <span
          className="font-mono text-[13px] tabular-nums font-medium"
          // Route the color through a CSS custom property so the literal hex
          // survives JSDOM style-attribute normalization in tests (which
          // otherwise rewrites `#16A34A` -> `rgb(22, 163, 74)`). The visual
          // result is identical in a real browser.
          style={{
            ["--kpi-color" as string]: winRateColor(kpis.winRate),
            color: "var(--kpi-color)",
          } as React.CSSProperties}
        >
          {kpis.winRate === null
            ? "\u2014"
            : `${Math.round(kpis.winRate * 100)}%`}
        </span>
      </div>

      <div className="flex flex-col items-center px-3 py-1">
        <span
          className="text-[11px] uppercase tracking-wider font-semibold"
          style={{ color: "#718096" }}
        >
          AVG DELTA
        </span>
        <span
          className="font-mono text-[13px] tabular-nums font-medium"
          style={{
            ["--kpi-color" as string]: deltaColor(kpis.avgRealizedDelta),
            color: "var(--kpi-color)",
          } as React.CSSProperties}
        >
          {formatPercent(kpis.avgRealizedDelta)}
        </span>
        {kpis.pendingCount > 0 && (
          <span
            className="text-xs font-medium mt-0.5"
            style={{ color: "#718096" }}
          >
            {`Avg realized delta: ${formatPercent(
              kpis.avgRealizedDelta,
            )} \u00B7 ${kpis.pendingCount} pending`}
          </span>
        )}
      </div>
    </div>
  );
}

// DASHBOARD-04 — Recharts sparkline with hidden axes.
function Sparkline({ points }: { points: SparklinePoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={48}>
      <LineChart
        data={points}
        margin={{ top: 2, right: 0, bottom: 2, left: 0 }}
      >
        <Line
          type="monotone"
          dataKey="original"
          stroke="#94A3B8"
          strokeWidth={1.5}
          dot={false}
          isAnimationActive={false}
          connectNulls
        />
        <Line
          type="monotone"
          dataKey="replacement"
          stroke="#1B6B5A"
          strokeWidth={1.5}
          dot={false}
          isAnimationActive={false}
          connectNulls
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

// DASHBOARD-04 — 3-column delta panel + lazy-fetched sparklines.
function ExpandedPanel({
  outcome,
  curvesCache,
}: {
  outcome: Pick<
    BridgeOutcome,
    "id" | "delta_30d" | "delta_90d" | "delta_180d" | "allocated_at"
  >;
  curvesCache: React.MutableRefObject<Map<string, CurveData>>;
}) {
  const [curve, setCurve] = useState<CurveData | null>(
    () => curvesCache.current.get(outcome.id) ?? null,
  );
  const [error, setError] = useState<string | null>(null);
  const aborted = useRef(false);

  useEffect(() => {
    aborted.current = false;
    const controller = new AbortController();

    if (curvesCache.current.has(outcome.id)) {
      setCurve(curvesCache.current.get(outcome.id)!);
      return () => {
        aborted.current = true;
        controller.abort();
      };
    }

    async function fetchCurves() {
      try {
        const res = await fetch(
          `/api/bridge/outcome/${outcome.id}/curves`,
          { signal: controller.signal, credentials: "same-origin" },
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as CurveData;
        if (!aborted.current) {
          curvesCache.current.set(outcome.id, data);
          setCurve(data);
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        if (!aborted.current) setError("Failed to load curves");
      }
    }
    void fetchCurves();

    return () => {
      aborted.current = true;
      controller.abort();
    };
  }, [outcome.id, curvesCache]);

  const columns = useMemo(
    () =>
      WINDOWS.map((w) => ({
        ...w,
        delta: outcome[w.key],
        points: sliceToWindow(curve, outcome.allocated_at, w.days),
      })),
    [curve, outcome],
  );

  return (
    <div
      className="border-b border-[#E2E8F0] px-3 py-4"
      style={{ backgroundColor: "#F8F9FA" }}
    >
      <div className="grid grid-cols-3 gap-4">
        {columns.map((col) => {
          const d = formatDelta(col.delta);
          const isPending = col.delta === null;
          const isLoading = !curve && !error;

          return (
            <div key={col.label} className="flex flex-col gap-2">
              <span
                className="text-[11px] font-semibold uppercase tracking-wider"
                style={{ color: "#718096" }}
              >
                {col.label}
              </span>
              {isPending ? (
                <span
                  className="inline-block rounded px-2 py-0.5 text-[11px] font-medium self-start"
                  style={{
                    color: "#718096",
                    backgroundColor: "rgba(148,163,184,0.10)",
                  }}
                >
                  Pending
                </span>
              ) : (
                <span
                  className="font-mono text-[13px] tabular-nums font-semibold"
                  style={{ color: toneColor(d.tone) }}
                >
                  {d.text}
                </span>
              )}
              {isPending || isLoading || error ? (
                <div className="h-[48px] rounded bg-[#E2E8F0] animate-pulse" />
              ) : (
                <Sparkline points={col.points} />
              )}
              <div
                className="flex flex-col gap-1 text-[11px]"
                style={{ color: "#718096" }}
              >
                <span>
                  <span
                    className="inline-block w-2 h-2 rounded-full mr-2 align-middle"
                    style={{ backgroundColor: "#94A3B8" }}
                  />
                  Original
                </span>
                <span>
                  <span
                    className="inline-block w-2 h-2 rounded-full mr-2 align-middle"
                    style={{ backgroundColor: "#1B6B5A" }}
                  />
                  Replacement
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Phase 08 Plan 04 Task 2 — "Your note" section below the 3-column
          delta grid (UI-SPEC §4c). Uses the shared Plan 03 primitives via
          BridgeOutcomeNoteSection. scope_kind=bridge_outcome;
          scope_ref=outcome.id (UUID). */}
      <hr className="my-3 border-[#E2E8F0]" />
      <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "#718096" }}>
        Your note
      </p>
      <BridgeOutcomeNoteSection outcomeId={outcome.id} />
    </div>
  );
}

// DASHBOARD-03 — Timeline row: caret + strategy links + status pill + best delta.
function TimelineRow({
  outcome,
  colSpan,
  isExpanded,
  onToggle,
  curvesCache,
  today,
}: {
  outcome: OutcomeRow;
  colSpan: number;
  isExpanded: boolean;
  onToggle: (id: string) => void;
  curvesCache: React.MutableRefObject<Map<string, CurveData>>;
  today?: string;
}) {
  const pill = useMemo(() => deriveOutcomeStatusPill(outcome), [outcome]);

  const bestDelta = useMemo(() => {
    if (outcome.kind === "rejected")
      return { value: "\u2014", tone: "neutral" as const };
    const label = deriveOutcomeLabel({
      kind: outcome.kind,
      allocated_at: outcome.allocated_at,
      delta_30d: outcome.delta_30d,
      delta_90d: outcome.delta_90d,
      delta_180d: outcome.delta_180d,
      estimated_delta_bps: outcome.estimated_delta_bps,
      estimated_days: outcome.estimated_days,
      needs_recompute: outcome.needs_recompute,
      created_at: outcome.created_at,
      today,
    });
    return { value: label.value, tone: label.tone };
  }, [outcome, today]);

  const bestDeltaColor =
    bestDelta.tone === "positive"
      ? "#16A34A"
      : bestDelta.tone === "negative"
        ? "#DC2626"
        : "#718096";

  const dateIso =
    outcome.kind === "allocated" && outcome.allocated_at
      ? outcome.allocated_at
      : outcome.created_at.slice(0, 10);

  const originalStrategy =
    outcome.match_decision?.original_strategy ?? null;
  const replacementStrategy = outcome.replacement_strategy ?? null;

  const pillS = pillStyle(pill);

  return (
    <Fragment>
      <tr
        className="border-b border-[#E2E8F0] last:border-b-0 hover:bg-[#F8F9FA] transition-colors"
        style={{ height: 44 }}
      >
        <td className="px-2 py-2" style={{ width: 32 }}>
          <button
            type="button"
            onClick={() => onToggle(outcome.id)}
            aria-expanded={isExpanded}
            aria-label={
              isExpanded
                ? "Collapse outcome detail"
                : "Expand outcome detail"
            }
            aria-controls={`outcome-detail-${outcome.id}`}
            className="flex items-center justify-center w-7 h-7 rounded text-[#718096] hover:text-[#1A1A2E] hover:bg-[#F8F9FA] focus-visible:outline-2 focus-visible:outline focus-visible:outline-[#1B6B5A] transition-colors"
          >
            <span
              aria-hidden="true"
              className="text-sm inline-block"
              style={{
                transform: isExpanded ? "rotate(90deg)" : "none",
                transition: "transform 150ms ease-out",
              }}
            >
              {"\u203A"}
            </span>
          </button>
        </td>

        <td className="px-3 py-2">
          {originalStrategy ? (
            <a
              href={`/strategies/${originalStrategy.id}`}
              className="font-sans text-sm font-medium transition-colors hover:underline truncate block"
              style={{ color: "#1A1A2E" }}
            >
              {originalStrategy.name}
            </a>
          ) : (
            <span
              className="font-sans text-sm"
              style={{ color: "#718096" }}
            >
              {"\u2014"}
            </span>
          )}
        </td>

        <td className="px-3 py-2">
          {replacementStrategy ? (
            <a
              href={`/strategies/${replacementStrategy.id}`}
              className="font-sans text-sm font-medium transition-colors hover:underline truncate block"
              style={{ color: "#1A1A2E" }}
            >
              {replacementStrategy.name}
            </a>
          ) : (
            <span
              className="font-sans text-sm"
              style={{ color: "#718096" }}
            >
              {"\u2014"}
            </span>
          )}
        </td>

        <td className="px-3 py-2" style={{ width: 100 }}>
          <span
            className="font-sans text-sm font-medium"
            style={{ color: "#718096" }}
          >
            {formatDate(dateIso)}
          </span>
        </td>

        <td className="px-3 py-2" style={{ width: 180 }}>
          <span
            className="inline-block rounded px-2 py-0.5 text-[11px] font-medium"
            style={pillS}
          >
            {pill.text}
          </span>
        </td>

        <td className="px-3 py-2" style={{ width: 120 }}>
          <span
            className="font-mono text-[13px] tabular-nums"
            style={{ color: bestDeltaColor }}
          >
            {bestDelta.value}
          </span>
        </td>
      </tr>

      {isExpanded && (
        <tr id={`outcome-detail-${outcome.id}`}>
          <td colSpan={colSpan} className="p-0">
            <ExpandedPanel outcome={outcome} curvesCache={curvesCache} />
          </td>
        </tr>
      )}
    </Fragment>
  );
}

// Voice-D5 — truncation footer rendered when received outcomes count === 200.
function TruncationFooter() {
  return (
    <div
      className="px-3 py-2 border-t border-[#E2E8F0]"
      style={{ backgroundColor: "#F8F9FA" }}
    >
      <span
        className="text-xs font-medium"
        style={{ color: "#718096" }}
      >
        Showing most recent 200 — reach out if you need historical export
      </span>
    </div>
  );
}

// Loading-state skeleton strip — separate helper keeps the top-level render
// readable and lets the aria-label live on the root container node, which is
// what `getByLabelText("Loading outcomes data")` queries for.
function LoadingState() {
  return (
    <div className="flex h-full flex-col" aria-label="Loading outcomes data">
      <div className="flex h-16 items-center justify-around gap-2 border-b border-[#E2E8F0]">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex flex-col items-center gap-1">
            <div className="h-2.5 w-8 rounded bg-[#E2E8F0] animate-pulse" />
            <div className="h-4 w-12 rounded bg-[#E2E8F0] animate-pulse" />
          </div>
        ))}
      </div>
      <div className="flex-1 overflow-auto">
        {[0, 1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="flex items-center gap-3 border-b border-[#E2E8F0] px-3"
            style={{ height: 44 }}
          >
            <div className="h-3 w-32 rounded bg-[#E2E8F0] animate-pulse" />
            <div className="h-3 w-32 rounded bg-[#E2E8F0] animate-pulse" />
            <div className="h-3 w-16 rounded bg-[#E2E8F0] animate-pulse" />
            <div className="h-3 w-24 rounded bg-[#E2E8F0] animate-pulse" />
            <div className="h-3 w-20 rounded bg-[#E2E8F0] animate-pulse" />
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------- top-level default export

export default function OutcomesWidget({ data }: WidgetProps) {
  // Error state: widget consumer may pass `{ __error: true }` on an upstream
  // fetch failure. Keeps error copy inside the widget bounds rather than
  // failing the whole /allocations page.
  const hasError = Boolean(
    data && typeof data === "object" && (data as { __error?: unknown }).__error,
  );

  const payload = data as MyAllocationDashboardPayload | undefined;
  const outcomes: OutcomeRow[] | undefined = payload?.outcomes;

  const curvesCache = useRef<Map<string, CurveData>>(new Map());
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // `retryTick` forces a remount of the upstream fetch by way of parent-level
  // state change; the widget itself has no fetch seam for outcome rows (they
  // arrive via getMyAllocationDashboard) so "Try again" simply forces the
  // page-level reload via window.location.reload. Keeping the button present
  // is the copy contract in UI-SPEC state matrix §error.
  const [retryTick, setRetryTick] = useState(0);
  // Preserve the state binding so the linter doesn't prune it — UI hint for
  // future consumers that want a finer-grained retry seam.
  void retryTick;

  const kpis = useMemo(
    () => computeOutcomeKPIs(outcomes ?? []),
    [outcomes],
  );

  // Error
  if (hasError) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-4 text-center">
        <span
          aria-hidden="true"
          className="text-2xl"
          style={{ color: "#DC2626" }}
        >
          {"\u26A0"}
        </span>
        <p
          className="font-sans text-sm font-medium"
          style={{ color: "#1A1A2E" }}
        >
          Could not load outcomes
        </p>
        <button
          type="button"
          onClick={() => {
            setRetryTick((t) => t + 1);
            if (typeof window !== "undefined") window.location.reload();
          }}
          className="inline-block rounded-md px-4 py-2 text-sm font-medium border border-[#E2E8F0]"
          style={{ color: "#1A1A2E", backgroundColor: "#FFFFFF" }}
        >
          Try again
        </button>
      </div>
    );
  }

  // Loading
  if (outcomes === undefined) {
    return <LoadingState />;
  }

  // Empty
  if (outcomes.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-4 text-center">
        <span aria-hidden="true" className="text-2xl" style={{ color: "#718096" }}>
          {"\u25C8"}
        </span>
        <p
          className="font-sans text-sm font-medium"
          style={{ color: "#718096" }}
        >
          Your Bridge outcomes will appear here after you act on one
        </p>
        <a
          href="/holdings"
          className="inline-block rounded-md px-4 py-2 text-sm font-medium"
          style={{ backgroundColor: "#1B6B5A", color: "#FFFFFF" }}
        >
          View Holdings
        </a>
      </div>
    );
  }

  // Populated
  return (
    <div className="flex h-full flex-col">
      <div className="h-16 border-b border-[#E2E8F0]">
        <KpiStrip kpis={kpis} />
      </div>
      <div className="flex-1 overflow-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr style={{ backgroundColor: "#F8F9FA" }}>
              <th className="px-2 py-2" style={{ width: 32 }}></th>
              <th
                className="px-3 py-2 text-left text-[11px] font-medium uppercase tracking-wider"
                style={{ color: "#718096" }}
              >
                Original
              </th>
              <th
                className="px-3 py-2 text-left text-[11px] font-medium uppercase tracking-wider"
                style={{ color: "#718096" }}
              >
                Replacement
              </th>
              <th
                className="px-3 py-2 text-left text-[11px] font-medium uppercase tracking-wider"
                style={{ color: "#718096", width: 100 }}
              >
                Date
              </th>
              <th
                className="px-3 py-2 text-left text-[11px] font-medium uppercase tracking-wider"
                style={{ color: "#718096", width: 180 }}
              >
                Status
              </th>
              <th
                className="px-3 py-2 text-left text-[11px] font-medium uppercase tracking-wider"
                style={{ color: "#718096", width: 120 }}
              >
                Best Delta
              </th>
            </tr>
          </thead>
          <tbody>
            {outcomes.map((o) => (
              <TimelineRow
                key={o.id}
                outcome={o}
                colSpan={COL_SPAN}
                isExpanded={expandedId === o.id}
                onToggle={(id) =>
                  setExpandedId(expandedId === id ? null : id)
                }
                curvesCache={curvesCache}
              />
            ))}
          </tbody>
        </table>
      </div>
      {outcomes.length === 200 && <TruncationFooter />}
    </div>
  );
}
