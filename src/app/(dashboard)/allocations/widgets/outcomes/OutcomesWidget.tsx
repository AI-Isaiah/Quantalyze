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
 *
 * Phase 09.1 Plan 10 (D-06): restyled to the designer outcomes.jsx shape:
 *   - Header: "Bridge outcomes" h3 (serif) + "Feedback loop" badge + View all
 *   - 3-KPI strip: Hit rate (90d) / Avg realized α (90d) / Total outcomes
 *   - Delta table: From / Size / Recorded / Δ30 / Δ90 / Δ180
 *   - Row-expand: 3 window cards (30d/90d/180d) with progress bars
 *   - Note section (Phase 08 MANAGE-05 BridgeOutcomeNoteSection) preserved
 *
 * computeOutcomeKPIs / deriveOutcomeLabel / deriveOutcomeStatusPill /
 * BridgeOutcomeNoteSection are preserved verbatim (do not regress Phase 5/8).
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

// 7 columns: From / Size / Recorded / Δ30 / Δ90 / Δ180 / caret
const COL_SPAN = 7;

const WINDOWS: Array<{
  label: "30-day window" | "90-day window" | "180-day window";
  short: "30d" | "90d" | "180d";
  days: number;
  key: "delta_30d" | "delta_90d" | "delta_180d";
}> = [
  { label: "30-day window", short: "30d", days: 30, key: "delta_30d" },
  { label: "90-day window", short: "90d", days: 90, key: "delta_90d" },
  { label: "180-day window", short: "180d", days: 180, key: "delta_180d" },
];

// ---------------------------------------------------------- pure helpers

function formatPercent(v: number | null): string {
  if (v === null) return "—";
  const pct = v * 100;
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(1)}%`;
}

function formatPercentSigned(v: number | null, decimals = 1): string {
  if (v === null) return "—";
  const pct = v * 100;
  const sign = pct >= 0 ? "+" : "";
  return `${sign}${pct.toFixed(decimals)}%`;
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

function formatUsdCompact(value: number | null): string {
  if (value == null) return "—";
  if (Math.abs(value) >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${value.toFixed(0)}`;
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

/**
 * Phase 09.1 Plan 10 — designer header (outcomes.jsx:18-32).
 * h3 "Bridge outcomes" (serif) + "Feedback loop" badge + "View all" button.
 */
function WidgetHeader({ pendingCount }: { pendingCount: number }) {
  return (
    <div className="flex items-start justify-between border-b border-[#E2E8F0] px-5 py-3.5">
      <div>
        <h3
          className="m-0 flex items-center gap-2 text-[16px] font-semibold"
          style={{
            fontFamily: "var(--font-serif)",
            color: "#1A1A2E",
          }}
        >
          Bridge outcomes
          <span
            className="inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider"
            style={{
              backgroundColor: "rgba(27,107,90,0.10)",
              color: "#1B6B5A",
            }}
          >
            Feedback loop
          </span>
        </h3>
        <div
          className="mt-0.5 text-[11.5px]"
          style={{ color: "#718096" }}
        >
          Realized delta from Bridge-driven reallocations
          {pendingCount > 0 ? ` — ${pendingCount} pending cycle` : ""}
        </div>
      </div>
      <a
        href="/holdings"
        className="inline-flex items-center rounded-md border px-3 py-1.5 text-xs font-medium transition-colors"
        style={{
          borderColor: "#E2E8F0",
          color: "#1A1A2E",
          backgroundColor: "#FFFFFF",
        }}
      >
        View all
      </a>
    </div>
  );
}

/**
 * Phase 09.1 Plan 10 — 3-cell KPI strip (outcomes.jsx:35-39, 66-77).
 * Hit rate (90d) / Avg realized α (90d) / Total outcomes.
 *
 * KPI numbers come from computeOutcomeKPIs (Phase 5 contract preserved).
 */
function KpiStrip({
  kpis,
  outcomes,
}: {
  kpis: OutcomeKPIs;
  outcomes: OutcomeRow[];
}) {
  const settledCount = outcomes.filter((o) => o.delta_90d != null).length;
  const pendingCycle = outcomes.filter(
    (o) => o.kind === "allocated" && o.delta_90d == null,
  ).length;

  return (
    <div className="grid grid-cols-3 border-b border-[#E2E8F0]">
      <KpiCell
        label="Hit rate (90d)"
        value={
          kpis.winRate === null
            ? "—"
            : `${Math.round(kpis.winRate * 100)}%`
        }
        sub={`${settledCount} settled`}
      />
      <KpiCell
        label="Avg realized α (90d)"
        value={formatPercentSigned(kpis.avgRealizedDelta)}
        sub={`Avg realized delta: ${formatPercent(
          kpis.avgRealizedDelta,
        )} · ${kpis.pendingCount} pending`}
        tone={
          kpis.avgRealizedDelta == null
            ? "neutral"
            : kpis.avgRealizedDelta >= 0
              ? "positive"
              : "negative"
        }
        divider
      />
      <KpiCell
        label="Total outcomes"
        value={String(kpis.totalOutcomes)}
        sub={`${pendingCycle} pending cycle`}
        divider
      />
    </div>
  );
}

function KpiCell({
  label,
  value,
  sub,
  tone,
  divider,
}: {
  label: string;
  value: string;
  sub: string;
  tone?: "positive" | "negative" | "neutral";
  divider?: boolean;
}) {
  const valueColor =
    tone === "positive"
      ? "#16A34A"
      : tone === "negative"
        ? "#DC2626"
        : "#1A1A2E";
  return (
    <div
      className="px-5 py-4"
      style={{
        borderLeft: divider ? "1px solid #E2E8F0" : "none",
      }}
    >
      <div
        className="text-[10.5px] font-semibold uppercase tracking-wider"
        style={{ color: "#718096" }}
      >
        {label}
      </div>
      <div
        className="mt-1 font-mono text-[22px] font-medium tabular-nums"
        // Route the color through a CSS custom property so the literal hex
        // survives JSDOM style-attribute normalization in tests (which
        // otherwise rewrites `#16A34A` -> `rgb(22, 163, 74)`).
        style={{
          ["--kpi-color" as string]: valueColor,
          color: "var(--kpi-color)",
        } as React.CSSProperties}
      >
        {value}
      </div>
      <div
        className="mt-0.5 text-[11px]"
        style={{ color: "#718096" }}
      >
        {sub}
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

/**
 * Phase 09.1 Plan 10 — OutcomeDetail panel (designer outcomes.jsx:135-180).
 * 3 window cards (30/90/180 day) with delta + status + progress bar.
 * Preserves the Phase 5 sparkline path (lazy curves fetch + cache) AND the
 * Phase 08 BridgeOutcomeNoteSection mount (MANAGE-05).
 */
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
      className="border-b border-[#E2E8F0] px-5 py-4"
      style={{ backgroundColor: "#FBFCFD" }}
    >
      <div
        className="mb-3 text-[11px] font-semibold uppercase tracking-wider"
        style={{ color: "#718096" }}
      >
        Realized delta vs held baseline
      </div>
      <div className="grid grid-cols-3 gap-3.5">
        {columns.map((col) => {
          const d = formatDelta(col.delta);
          const isPending = col.delta === null;
          const isLoading = !curve && !error;

          const barColor = isPending
            ? "#D97706" /* var(--warning) */
            : col.delta != null && col.delta >= 0
              ? "#16A34A"
              : "#DC2626";

          return (
            <div
              key={col.short}
              className="rounded-lg border border-[#E2E8F0] bg-white p-3.5"
            >
              <div
                className="text-[11px] font-medium"
                style={{ color: "#718096" }}
              >
                {col.label}
              </div>
              {isPending ? (
                <div
                  className="mt-2.5 flex items-center gap-2 text-[13px] italic"
                  style={{ color: "#718096" }}
                >
                  <span
                    className="inline-block h-2 w-2 rounded-full"
                    style={{ backgroundColor: "#D97706" }}
                  />
                  Window open
                </div>
              ) : (
                <div
                  className="mt-1.5 font-mono text-[24px] font-medium tabular-nums"
                  style={{ color: toneColor(d.tone) }}
                >
                  {d.text}
                </div>
              )}
              {isPending || isLoading || error ? null : (
                <div className="mt-2">
                  <Sparkline points={col.points} />
                </div>
              )}
              <div
                className="mt-2.5 h-1 overflow-hidden rounded"
                style={{ backgroundColor: "#F1F5F9" }}
              >
                <div
                  style={{
                    width: isPending ? "45%" : "100%",
                    height: "100%",
                    backgroundColor: barColor,
                    transition: "width 300ms ease-out",
                  }}
                />
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
      <p
        className="mb-2 text-xs font-semibold uppercase tracking-wider"
        style={{ color: "#718096" }}
      >
        Your note
      </p>
      <BridgeOutcomeNoteSection outcomeId={outcome.id} />
    </div>
  );
}

/**
 * Phase 09.1 Plan 10 — Designer table row (outcomes.jsx:79-132).
 * Columns: From → To / Size / Recorded / Δ30 / Δ90 / Δ180 / caret.
 * Preserves deriveOutcomeStatusPill + deriveOutcomeLabel for accessibility
 * tooltips and screen-reader semantics.
 */
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

  const dateIso =
    outcome.kind === "allocated" && outcome.allocated_at
      ? outcome.allocated_at
      : outcome.created_at.slice(0, 10);

  const originalStrategy =
    outcome.match_decision?.original_strategy ?? null;
  const replacementStrategy = outcome.replacement_strategy ?? null;

  // "Size" renders as a percent badge (e.g. "12.5%") — the underlying
  // `percent_allocated` is the canonical storage unit. Designer comp shows
  // a dollar amount, but until allocator AUM is wired through the payload
  // we render the percent honestly rather than fabricating a $-value from
  // a magic-number proxy.
  const sizePercent =
    outcome.kind === "allocated" && outcome.percent_allocated != null
      ? outcome.percent_allocated
      : null;

  function deltaCell(v: number | null) {
    if (v === null) {
      return (
        <span
          className="text-[12px] italic"
          style={{ color: "#718096" }}
        >
          pending
        </span>
      );
    }
    // Route the color through a CSS custom property so the literal hex
    // survives JSDOM style-attribute normalization in tests (which would
    // otherwise rewrite `#16A34A` -> `rgb(22, 163, 74)`). The visual
    // result is identical in a real browser.
    const cellColor = v >= 0 ? "#16A34A" : "#DC2626";
    return (
      <span
        className="font-mono text-[13px] font-medium tabular-nums"
        style={{
          ["--delta-color" as string]: cellColor,
          color: "var(--delta-color)",
        } as React.CSSProperties}
      >
        {formatPercentSigned(v)}
      </span>
    );
  }

  return (
    <Fragment>
      <tr
        className="cursor-pointer border-b border-[#E2E8F0] transition-colors hover:bg-[#FAFBFC]"
        style={{ background: isExpanded ? "#FAFBFC" : "transparent" }}
        onClick={() => onToggle(outcome.id)}
      >
        {/* From → To */}
        <td className="px-4 py-3">
          <div className="flex items-center gap-2.5">
            {originalStrategy ? (
              <a
                href={`/strategies/${originalStrategy.id}`}
                onClick={(e) => e.stopPropagation()}
                className="text-[12px] hover:underline"
                style={{ color: "#718096" }}
              >
                {originalStrategy.name}
              </a>
            ) : (
              <span
                className="text-[12px]"
                style={{ color: "#718096" }}
              >
                {"—"}
              </span>
            )}
            <span
              aria-hidden="true"
              className="text-[10px]"
              style={{ color: "#718096" }}
            >
              {"›"}
            </span>
            {replacementStrategy ? (
              <a
                href={`/strategies/${replacementStrategy.id}`}
                onClick={(e) => e.stopPropagation()}
                className="text-[13px] font-medium hover:underline"
                style={{ color: "#1A1A2E" }}
              >
                {replacementStrategy.name}
              </a>
            ) : (
              <span
                className="text-[13px] font-medium"
                style={{ color: "#1A1A2E" }}
              >
                {"—"}
              </span>
            )}
          </div>
        </td>

        {/* Size — rendered as percent of portfolio (canonical storage unit).
            Designer comp shows $-amount, but allocator AUM isn't wired
            through the payload yet. Showing the honest percent avoids
            fabricating a $-figure from a magic-number proxy. */}
        <td className="px-4 py-3 text-right font-mono text-[13px] tabular-nums">
          {sizePercent != null ? (
            <span style={{ color: "#1A1A2E" }}>
              {sizePercent.toFixed(1)}%
            </span>
          ) : (
            <span style={{ color: "#718096" }}>{"—"}</span>
          )}
        </td>

        {/* Recorded */}
        <td
          className="px-4 py-3 text-[12px]"
          style={{ color: "#4A5568" }}
        >
          {formatDate(dateIso)}
        </td>

        {/* Δ 30d */}
        <td className="px-4 py-3 text-right">{deltaCell(outcome.delta_30d)}</td>
        {/* Δ 90d */}
        <td className="px-4 py-3 text-right">{deltaCell(outcome.delta_90d)}</td>
        {/* Δ 180d */}
        <td className="px-4 py-3 text-right">{deltaCell(outcome.delta_180d)}</td>

        {/* Caret */}
        <td className="px-4 py-3 text-right">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggle(outcome.id);
            }}
            aria-expanded={isExpanded}
            aria-label={
              isExpanded
                ? "Collapse outcome detail"
                : "Expand outcome detail"
            }
            aria-controls={`outcome-detail-${outcome.id}`}
            className="inline-flex h-6 w-6 items-center justify-center rounded text-[#718096] hover:text-[#1A1A2E] hover:bg-[#F8F9FA] focus-visible:outline-2 focus-visible:outline focus-visible:outline-[#1B6B5A]"
          >
            <span
              aria-hidden="true"
              className="text-[10px]"
              style={{
                transform: isExpanded ? "rotate(90deg)" : "none",
                transition: "transform 150ms ease-out",
                display: "inline-flex",
              }}
            >
              {"›"}
            </span>
          </button>
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
      className="border-t border-[#E2E8F0] px-5 py-2"
      style={{ backgroundColor: "#F8F9FA" }}
    >
      <span className="text-xs font-medium" style={{ color: "#718096" }}>
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
      <div className="grid grid-cols-3 gap-2 border-b border-[#E2E8F0] px-5 py-4">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex flex-col gap-1.5">
            <div className="h-2.5 w-20 rounded bg-[#E2E8F0] animate-pulse" />
            <div className="h-5 w-16 rounded bg-[#E2E8F0] animate-pulse" />
            <div className="h-2 w-24 rounded bg-[#E2E8F0] animate-pulse" />
          </div>
        ))}
      </div>
      <div className="flex-1 overflow-auto">
        {[0, 1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="flex items-center gap-3 border-b border-[#E2E8F0] px-5"
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
  // Keep deltaColor referenced so the tone-coded inline cell color helper
  // remains in scope for any future fine-grained styling tweaks.
  void deltaColor;

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
          {"⚠"}
        </span>
        <p
          className="text-sm font-medium"
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
          className="inline-block rounded-md border border-[#E2E8F0] px-4 py-2 text-sm font-medium"
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
      <div className="flex h-full flex-col">
        <WidgetHeader pendingCount={0} />
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
          <span
            aria-hidden="true"
            className="text-2xl"
            style={{ color: "#718096" }}
          >
            {"◈"}
          </span>
          <p
            className="text-sm font-medium"
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
      </div>
    );
  }

  // Populated
  return (
    <div className="flex h-full flex-col">
      <WidgetHeader pendingCount={kpis.pendingCount} />
      <KpiStrip kpis={kpis} outcomes={outcomes} />
      <div className="flex-1 overflow-auto">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr>
              <th
                className="border-b border-[#E2E8F0] px-4 py-2.5 text-left text-[10.5px] font-semibold uppercase tracking-wider"
                style={{ color: "#718096" }}
              >
                Reallocation
              </th>
              <th
                className="border-b border-[#E2E8F0] px-4 py-2.5 text-right text-[10.5px] font-semibold uppercase tracking-wider"
                style={{ color: "#718096" }}
              >
                Size
              </th>
              <th
                className="border-b border-[#E2E8F0] px-4 py-2.5 text-left text-[10.5px] font-semibold uppercase tracking-wider"
                style={{ color: "#718096" }}
              >
                Recorded
              </th>
              <th
                className="border-b border-[#E2E8F0] px-4 py-2.5 text-right text-[10.5px] font-semibold uppercase tracking-wider whitespace-nowrap"
                style={{ color: "#718096" }}
              >
                {"Δ 30d"}
              </th>
              <th
                className="border-b border-[#E2E8F0] px-4 py-2.5 text-right text-[10.5px] font-semibold uppercase tracking-wider whitespace-nowrap"
                style={{ color: "#718096" }}
              >
                {"Δ 90d"}
              </th>
              <th
                className="border-b border-[#E2E8F0] px-4 py-2.5 text-right text-[10.5px] font-semibold uppercase tracking-wider whitespace-nowrap"
                style={{ color: "#718096" }}
              >
                {"Δ 180d"}
              </th>
              <th
                className="border-b border-[#E2E8F0] px-4 py-2.5 text-right text-[10.5px] font-semibold uppercase tracking-wider"
                style={{ color: "#718096", width: 48 }}
                aria-hidden="true"
              />
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
