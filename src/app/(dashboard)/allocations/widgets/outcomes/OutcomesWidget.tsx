"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Line, LineChart, ResponsiveContainer } from "recharts";
import type { OutcomeRow } from "@/lib/queries";
import { withWidgetBoundary, type BaseWidgetProps } from "../lib/widget-boundary";
import {
  outcomesWidgetDataSchema,
  type OutcomesWidgetData,
} from "../lib/widget-data";
import { formatPercent } from "@/lib/utils";
import { computeOutcomeKPIs, type OutcomeKPIs } from "@/lib/outcomes-kpi";
import type { BridgeOutcome } from "@/lib/bridge-outcome-schema";
// Phase 08 Plan 04 Task 2 — "Your note" section inside ExpandedPanel
// (MANAGE-05 bridge_outcome scope).
import { BridgeOutcomeNoteSection } from "@/components/notes/BridgeOutcomeNoteSection";
import { WidgetState } from "../../components/WidgetState";
import { isWidgetStateV2Enabled } from "@/lib/widget-state-flag";

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
 * computeOutcomeKPIs and BridgeOutcomeNoteSection are preserved verbatim
 * (do not regress Phase 5/8).
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

function toneColor(
  tone: "positive" | "negative" | "neutral",
): string {
  if (tone === "positive") return "var(--color-positive)";
  if (tone === "negative") return "var(--color-negative)";
  return "var(--color-text-muted)";
}

function addDaysISO(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function formatDate(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  // M-0189: a malformed/empty date string yields an Invalid Date whose
  // toLocaleDateString prints "Invalid Date". The schema guarantees the field
  // is a string but not a valid date string — guard so a bad row reads "—"
  // rather than leaking "Invalid Date" into the timeline.
  if (Number.isNaN(d.getTime())) return "—";
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

/**
 * Phase 09.1 Plan 10 — designer header (outcomes.jsx:18-32).
 * h3 "Bridge outcomes" (serif) + "Feedback loop" badge + "View all" button.
 */
function WidgetHeader({ pendingCount }: { pendingCount: number }) {
  return (
    <div className="flex items-start justify-between border-b border-[var(--color-border)] px-4 py-2.5">
      <div>
        <h3 className="m-0 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-text-primary">
          Bridge outcomes
          <span
            className="inline-flex items-center rounded-sm px-1.5 py-0.5 text-fixed-9 font-mono font-medium uppercase tracking-wider"
            style={{
              backgroundColor: "color-mix(in srgb, var(--color-accent) 12%, transparent)",
              color: "var(--color-accent)",
            }}
          >
            Feedback loop
          </span>
        </h3>
        <div
          className="mt-0.5 text-fixed-12"
          style={{ color: "var(--color-text-muted)" }}
        >
          Realized delta from Bridge-driven reallocations
          {pendingCount > 0 ? ` — ${pendingCount} pending cycle` : ""}
        </div>
      </div>
      <a
        href="/holdings"
        className="inline-flex items-center rounded-md border px-3 py-1.5 text-xs font-medium transition-colors"
        style={{
          borderColor: "var(--color-border)",
          color: "var(--color-text-primary)",
          backgroundColor: "var(--color-surface)",
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
}: {
  kpis: OutcomeKPIs;
}) {
  return (
    <div className="grid grid-cols-3 border-b border-[var(--color-border)]">
      {/* NEW-C27-01: relabeled "(90d)" → "(latest)" to match mostMatureDelta
          semantics (prefers 180d > 90d > 30d). A row with only delta_30d is
          included; a row with delta_180d contributes that value, not 90d.
          NEW-C27-02: sub-label uses kpis.winRateDenominator — the count of
          mature allocated rows the rate is actually computed over — instead of
          counts.settled (rows with delta_90d != null, a different predicate). */}
      <KpiCell
        label="Hit rate (latest)"
        value={
          kpis.winRate === null
            ? "—"
            : `${Math.round(kpis.winRate * 100)}%`
        }
        sub={`${kpis.winRateDenominator} settled`}
      />
      {/* NEW-C27-01: same "(90d)" → "(latest)" fix on the avg-alpha cell.
          NEW-C27-03: unified pending definition — both cells now use
          kpis.pendingCount (allocated rows with percent>=1, all deltas null),
          the same population used by the hit-rate computation. Removes the
          contradictory "3 pending" vs "7 pending cycle" pair. */}
      <KpiCell
        label="Avg realized α (latest)"
        value={formatPercent(kpis.avgRealizedDelta, 1)}
        sub={`${kpis.pendingCount} pending`}
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
        sub={`${kpis.pendingCount} awaiting maturity`}
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
      ? "#15803D"
      : tone === "negative"
        ? "#DC2626"
        : "#1A1A2E";
  return (
    <div
      className="px-5 py-4"
      style={{
        borderLeft: divider ? "1px solid var(--color-border)" : "none",
      }}
    >
      <div
        className="text-fixed-11 font-semibold uppercase tracking-wider"
        style={{ color: "var(--color-text-muted)" }}
      >
        {label}
      </div>
      <div
        className="mt-1 font-mono text-fixed-22 font-medium tabular-nums"
        // Route the color through a CSS custom property so the literal hex
        // survives JSDOM style-attribute normalization in tests (which
        // otherwise rewrites `#15803D` -> `rgb(22, 163, 74)`). Tests at
        // outcomes.test.tsx:245/256 assert the hex literally, so valueColor
        // stays as a hex literal and the swap to var() tokens stops at the
        // surrounding chrome (border, label, sub).
        style={{
          ["--kpi-color" as string]: valueColor,
          color: "var(--kpi-color)",
        } as React.CSSProperties}
      >
        {value}
      </div>
      <div
        className="mt-0.5 text-fixed-11"
        style={{ color: "var(--color-text-muted)" }}
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
        accessibilityLayer={false}
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

  useEffect(() => {
    // 09.1-REVIEW WR-04: closure-captured per-effect cancelled flag.
    // A shared useRef would be reset to false by the new effect *before*
    // the previous effect's catch handler had a chance to read it,
    // letting a stale non-Abort failure paint error state onto the
    // wrong outcome. `cancelled` is per-effect-instance — the new
    // effect cannot mutate the previous closure's value.
    let cancelled = false;
    const controller = new AbortController();

    // pr189-followup M2 (code-reviewer MED/8) — reset error to null at
    // the start of each effect run so a previously-failed outcome.id
    // doesn't carry the stale alert into a subsequent successful fetch
    // (e.g. expanding outcome A fails, then expanding the same row
    // refreshes the outcome.id and the cache-hit branch succeeds).
    setError(null);

    if (curvesCache.current.has(outcome.id)) {
      setCurve(curvesCache.current.get(outcome.id)!);
      return () => {
        cancelled = true;
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
        // M-0196: the curve response is an untrusted network read (separate from
        // the widget's validated `data` prop). Guard that both series are arrays
        // before caching/rendering, so a malformed response surfaces as the
        // widget's error state instead of crashing the sparkline .filter/.map.
        if (!Array.isArray(data?.original) || !Array.isArray(data?.replacement)) {
          if (!cancelled) setError("Failed to load curves");
          return;
        }
        if (!cancelled) {
          curvesCache.current.set(outcome.id, data);
          setCurve(data);
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        // retro audit (red-team L5 c9): the cancelled-guard previously
        // only gated `setError`, NOT the console.error. A fetch that
        // raced an unmount (collapse outcome row mid-fetch) still
        // logged the outcome_id to console + Sentry every time the
        // server returned non-2xx, leaking outcome UUIDs after the
        // user moved on. Skip both side effects when the panel is
        // already torn down — the abort already cancelled the request,
        // there is nothing actionable left to surface.
        if (cancelled) return;
        if (typeof console !== "undefined") {
          console.error(
            "[OutcomesWidget] curves fetch failed",
            { outcome_id: outcome.id },
            err,
          );
        }
        setError("Failed to load curves");
      }
    }
    void fetchCurves();

    return () => {
      cancelled = true;
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
      className="border-b border-[var(--color-border)] px-5 py-4"
      style={{ backgroundColor: "var(--color-surface-subtle)" }}
    >
      <div
        className="mb-3 text-fixed-11 font-semibold uppercase tracking-wider"
        style={{ color: "var(--color-text-muted)" }}
      >
        Realized delta vs held baseline
      </div>
      {/* pr189-followup H2 (silent-failure-hunter HIGH/9) + M17 (red-team
          MED/8) — the pre-followup error rendered per-column (3x
          duplicated alert) AND was gated by `!isPending`. For
          freshly-allocated outcomes ALL THREE deltas are pending (null)
          so the per-column error never reached the DOM and the fetch
          failure stayed silent for the most-common population. Hoist
          the alert to panel level (one row above the 3-col grid), where
          it surfaces regardless of per-column pending state and avoids
          the 3x duplicate-alert visual + SR announcement. */}
      {error && (
        <div
          role="alert"
          data-testid="outcomes-curve-error"
          className="mb-2 text-fixed-11 italic"
          style={{ color: "var(--color-text-muted)" }}
        >
          Couldn&apos;t load curve
        </div>
      )}
      <div className="grid grid-cols-3 gap-3.5">
        {columns.map((col) => {
          const d = formatDelta(col.delta);
          const isPending = col.delta === null;
          const isLoading = !curve && !error;

          const barColor = isPending
            ? "var(--color-warning)"
            : col.delta != null && col.delta >= 0
              ? "var(--color-positive)"
              : "var(--color-negative)";

          return (
            <div
              key={col.short}
              className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3.5"
            >
              <div
                className="text-fixed-11 font-medium"
                style={{ color: "var(--color-text-muted)" }}
              >
                {col.label}
              </div>
              {isPending ? (
                <div
                  className="mt-2.5 flex items-center gap-2 text-fixed-13 italic"
                  style={{ color: "var(--color-text-muted)" }}
                >
                  <span
                    className="inline-block h-2 w-2 rounded-full"
                    style={{ backgroundColor: "var(--color-warning)" }}
                  />
                  Window open
                </div>
              ) : (
                <div
                  className="mt-1.5 font-mono text-fixed-24 font-medium tabular-nums"
                  style={{ color: toneColor(d.tone) }}
                >
                  {d.text}
                </div>
              )}
              {/* Per-column sparkline. Error visibility moved to the
                  panel-level alert above (H2 + M17), so this branch is
                  just the success/loading split. */}
              {isPending || isLoading || error ? null : (
                <div className="mt-2">
                  <Sparkline points={col.points} />
                </div>
              )}
              <div
                className="mt-2.5 h-1 overflow-hidden rounded"
                style={{ backgroundColor: "var(--color-track)" }}
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

      {/* "Your note" section below the 3-column delta grid. Uses the
          shared note primitives via BridgeOutcomeNoteSection.
          scope_kind=bridge_outcome; scope_ref=outcome.id (UUID). */}
      <hr className="my-3 border-[var(--color-border)]" />
      <p
        className="mb-2 text-xs font-semibold uppercase tracking-wider"
        style={{ color: "var(--color-text-muted)" }}
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
 */
function TimelineRow({
  outcome,
  colSpan,
  isExpanded,
  onToggle,
  curvesCache,
}: {
  outcome: OutcomeRow;
  colSpan: number;
  isExpanded: boolean;
  onToggle: (id: string) => void;
  curvesCache: React.MutableRefObject<Map<string, CurveData>>;
}) {
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
          className="text-fixed-12 italic"
          style={{ color: "var(--color-text-muted)" }}
        >
          pending
        </span>
      );
    }
    // Route the color through a CSS custom property so the literal hex
    // survives JSDOM style-attribute normalization in tests (which would
    // otherwise rewrite `#15803D` -> `rgb(22, 163, 74)`). The visual
    // result is identical in a real browser.
    const cellColor = v >= 0 ? "#15803D" : "#DC2626";
    return (
      <span
        className="font-mono text-fixed-13 font-medium tabular-nums"
        style={{
          ["--delta-color" as string]: cellColor,
          color: "var(--delta-color)",
        } as React.CSSProperties}
      >
        {formatPercent(v, 1)}
      </span>
    );
  }

  return (
    <Fragment>
      <tr
        className="cursor-pointer border-b border-[var(--color-border)] transition-colors hover:bg-[#FAFBFC]"
        style={{ background: isExpanded ? "#FAFBFC" : "transparent" }}
        onClick={() => onToggle(outcome.id)}
      >
        {/* From → To */}
        <td className="px-4 py-3">
          <div className="flex items-center gap-2.5">
            {originalStrategy ? (
              <a
                href={`/strategy/${originalStrategy.id}`}
                onClick={(e) => e.stopPropagation()}
                className="text-fixed-12 hover:underline"
                style={{ color: "var(--color-text-muted)" }}
              >
                {originalStrategy.name}
              </a>
            ) : (
              <span
                className="text-fixed-12"
                style={{ color: "var(--color-text-muted)" }}
              >
                {"—"}
              </span>
            )}
            <span
              aria-hidden="true"
              className="text-fixed-10"
              style={{ color: "var(--color-text-muted)" }}
            >
              {"›"}
            </span>
            {replacementStrategy ? (
              <a
                href={`/strategy/${replacementStrategy.id}`}
                onClick={(e) => e.stopPropagation()}
                className="text-fixed-13 font-medium hover:underline"
                style={{ color: "var(--color-text-primary)" }}
              >
                {replacementStrategy.name}
              </a>
            ) : (
              <span
                className="text-fixed-13 font-medium"
                style={{ color: "var(--color-text-primary)" }}
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
        <td className="px-4 py-3 text-right font-mono text-fixed-13 tabular-nums">
          {sizePercent != null ? (
            <span style={{ color: "var(--color-text-primary)" }}>
              {sizePercent.toFixed(1)}%
            </span>
          ) : (
            <span style={{ color: "var(--color-text-muted)" }}>{"—"}</span>
          )}
        </td>

        {/* Recorded */}
        <td
          className="px-4 py-3 text-fixed-12"
          style={{ color: "var(--color-text-secondary)" }}
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
            className="inline-flex h-6 w-6 items-center justify-center rounded text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-page)] focus-visible:outline-2 focus-visible:outline focus-visible:outline-[var(--color-accent)]"
          >
            <span
              aria-hidden="true"
              className="text-fixed-10"
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

// L-0008: the most-recent cap is set by the dashboard query (queries.ts —
// "capped at 200 most-recent"). Bind the truncation trigger (line ~986) and the
// footer copy to ONE constant so the number can't drift between the two sites.
const OUTCOMES_QUERY_CAP = 200;

// Voice-D5 — truncation footer rendered when received outcomes count === cap.
function TruncationFooter() {
  return (
    <div
      className="border-t border-[var(--color-border)] px-5 py-2"
      style={{ backgroundColor: "var(--color-page)" }}
    >
      <span className="text-xs font-medium" style={{ color: "var(--color-text-muted)" }}>
        {`Showing most recent ${OUTCOMES_QUERY_CAP} — reach out if you need historical export`}
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
      <div className="grid grid-cols-3 gap-2 border-b border-[var(--color-border)] px-5 py-4">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex flex-col gap-1.5">
            <div className="h-2.5 w-20 rounded bg-[var(--color-border)] animate-pulse" />
            <div className="h-5 w-16 rounded bg-[var(--color-border)] animate-pulse" />
            <div className="h-2 w-24 rounded bg-[var(--color-border)] animate-pulse" />
          </div>
        ))}
      </div>
      <div className="flex-1 overflow-auto">
        {[0, 1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="flex items-center gap-3 border-b border-[var(--color-border)] px-5"
            style={{ height: 44 }}
          >
            <div className="h-3 w-32 rounded bg-[var(--color-border)] animate-pulse" />
            <div className="h-3 w-32 rounded bg-[var(--color-border)] animate-pulse" />
            <div className="h-3 w-16 rounded bg-[var(--color-border)] animate-pulse" />
            <div className="h-3 w-24 rounded bg-[var(--color-border)] animate-pulse" />
            <div className="h-3 w-20 rounded bg-[var(--color-border)] animate-pulse" />
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------- top-level default export

/**
 * H-0160: the widget's four render states as an explicit discriminated union,
 * replacing the ad-hoc `hasError` / `outcomes === undefined` / `length === 0`
 * chain. `resolveOutcomesView` is the single place the state machine is decided,
 * and the `switch (view.kind)` in render has a `never`-typed default, so TS
 * proves exhaustiveness — a new state cannot be added without handling it.
 */
type OutcomesView =
  | { kind: "loading" }
  | { kind: "empty" }
  | { kind: "ok"; outcomes: OutcomeRow[] };

function resolveOutcomesView(data: OutcomesWidgetData): OutcomesView {
  // `outcomes` absent = not loaded yet (the schema marks it optional so a
  // still-loading payload validates and reaches here).
  if (data.outcomes === undefined) return { kind: "loading" };
  // `.loose()` validated the row fields the widget reads; the cast bridges that
  // narrower inferred element to the richer OutcomeRow that computeOutcomeKPIs /
  // TimelineRow consume (sound — the extra fields survive at runtime).
  const outcomes = data.outcomes as OutcomeRow[];
  if (outcomes.length === 0) return { kind: "empty" };
  return { kind: "ok", outcomes };
}

function OutcomesWidgetInner({
  data,
}: { data: OutcomesWidgetData } & BaseWidgetProps) {
  const view = resolveOutcomesView(data);
  // `outcomes` for the hooks below: the populated rows, or [] for the
  // loading/empty states (hooks must run unconditionally, before the
  // `switch` returns). computeOutcomeKPIs([]) is a no-op zero-KPI result.
  // Wrapped in useMemo so the array identity is stable across renders and
  // downstream useMemo deps don't change on every render.
  const outcomes = useMemo(
    () => (data.outcomes ? (data.outcomes as OutcomeRow[]) : []),
    [data.outcomes],
  );

  const curvesCache = useRef<Map<string, CurveData>>(new Map());
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // audit-2026-05-07 M-0188 c9 performance — the original inline
  // `onToggle={(id) => setExpandedId(expandedId === id ? null : id)}`
  // allocated a new function per render and closed over the current
  // `expandedId`. Toggling row #1 re-rendered all N-1 sibling rows and
  // re-ran their per-row memos. Hoist into a stable `useCallback` whose
  // body uses functional `setExpandedId(prev => …)` so the handler
  // identity is stable across renders without depending on `expandedId`.
  const handleRowToggle = useCallback((id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  }, []);

  const kpis = useMemo(
    () => computeOutcomeKPIs(outcomes ?? []),
    [outcomes],
  );

  // NEW-C27-02/C27-03: outcomeCounts removed — KpiStrip now derives all
  // sub-label counts from kpis (winRateDenominator / pendingCount) so there
  // is a single population definition for each KPI and its sub-label.

  // Phase 11 / UI-BLOCK-01 — wire WidgetState v2 behind the feature flag.
  // OutcomesWidget has 3 reachable branches (loading / empty / populated).
  // Per the UI-BLOCK-01 contract we wire as many of those as the primitive
  // can faithfully express:
  //   - success  → <WidgetState mode="success">{populated card}</WidgetState>
  //                Bare children, no chrome — visual passthrough.
  //   - loading  → SKIPPED. The existing 3-cell + 5-row LoadingState skeleton
  //                is materially more informative than the primitive's
  //                generic 2-line skeleton; replacing would degrade UX.
  //   - empty    → SKIPPED. The existing empty state mounts WidgetHeader
  //                ('Bridge outcomes' h3 + 'Feedback loop' badge) above
  //                the empty body; the primitive's centered Card cannot
  //                surface the header above it without manufacturing new
  //                wrapper structure. Preserved verbatim.
  // Documented in commit message; flag-gated so production renders are
  // unaffected when the flag is off.
  const v2 = isWidgetStateV2Enabled();

  // Loading
  if (view.kind === "loading") {
    return <LoadingState />;
  }

  // Empty
  if (view.kind === "empty") {
    return (
      <div className="flex h-full flex-col">
        <WidgetHeader pendingCount={0} />
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
          <span
            aria-hidden="true"
            className="text-2xl"
            style={{ color: "var(--color-text-muted)" }}
          >
            {"◈"}
          </span>
          <p
            className="text-sm font-medium"
            style={{ color: "var(--color-text-muted)" }}
          >
            Your Bridge outcomes will appear here after you act on one
          </p>
          <a
            href="/holdings"
            className="inline-block rounded-md px-4 py-2 text-sm font-medium"
            style={{ backgroundColor: "var(--color-accent)", color: "var(--color-surface)" }}
          >
            View Holdings
          </a>
        </div>
      </div>
    );
  }

  // Populated. H-0160 exhaustiveness: the three guards above leave only
  // kind === "ok"; this assertion makes any future OutcomesView variant a
  // COMPILE error here unless its render branch is added above.
  if (view.kind !== "ok") {
    const _exhaustive: never = view;
    return _exhaustive;
  }

  const populated = (
    <div className="flex h-full flex-col">
      <WidgetHeader pendingCount={kpis.pendingCount} />
      <KpiStrip kpis={kpis} />
      <div className="flex-1 overflow-auto">
        <table className="w-full border-collapse text-fixed-13">
          <thead>
            <tr>
              <th
                className="border-b border-[var(--color-border)] px-4 py-2.5 text-left text-fixed-11 font-semibold uppercase tracking-wider"
                style={{ color: "var(--color-text-muted)" }}
              >
                Reallocation
              </th>
              <th
                className="border-b border-[var(--color-border)] px-4 py-2.5 text-right text-fixed-11 font-semibold uppercase tracking-wider"
                style={{ color: "var(--color-text-muted)" }}
              >
                Size
              </th>
              <th
                className="border-b border-[var(--color-border)] px-4 py-2.5 text-left text-fixed-11 font-semibold uppercase tracking-wider"
                style={{ color: "var(--color-text-muted)" }}
              >
                Recorded
              </th>
              <th
                className="border-b border-[var(--color-border)] px-4 py-2.5 text-right text-fixed-11 font-semibold uppercase tracking-wider whitespace-nowrap"
                style={{ color: "var(--color-text-muted)" }}
              >
                {"Δ 30d"}
              </th>
              <th
                className="border-b border-[var(--color-border)] px-4 py-2.5 text-right text-fixed-11 font-semibold uppercase tracking-wider whitespace-nowrap"
                style={{ color: "var(--color-text-muted)" }}
              >
                {"Δ 90d"}
              </th>
              <th
                className="border-b border-[var(--color-border)] px-4 py-2.5 text-right text-fixed-11 font-semibold uppercase tracking-wider whitespace-nowrap"
                style={{ color: "var(--color-text-muted)" }}
              >
                {"Δ 180d"}
              </th>
              <th
                className="border-b border-[var(--color-border)] px-4 py-2.5 text-right text-fixed-11 font-semibold uppercase tracking-wider"
                style={{ color: "var(--color-text-muted)", width: 48 }}
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
                onToggle={handleRowToggle}
                curvesCache={curvesCache}
              />
            ))}
          </tbody>
        </table>
      </div>
      {outcomes.length === OUTCOMES_QUERY_CAP && <TruncationFooter />}
      {/* NEW-C27-04: disclose that the headline hit rate / alpha KPIs exclude
          sub-1% positions and rejected decisions. The table shows ALL rows
          (including those filtered by the D-08 rule), so without this note
          the headline numbers appear to contradict the visible evidence. */}
      <div
        className="border-t border-[var(--color-border)] px-5 py-2"
        style={{ backgroundColor: "var(--color-page)" }}
      >
        <span
          className="text-fixed-11"
          style={{ color: "var(--color-text-muted)" }}
        >
          Hit rate and avg α exclude positions under 1% and rejected decisions
        </span>
      </div>
    </div>
  );

  if (v2) {
    return <WidgetState mode="success">{populated}</WidgetState>;
  }
  return populated;
}

// B21: validate `data` (the MyAllocationDashboardPayload slice the widget reads)
// and contain any render throw before it reaches the Outcomes tab. Direct-mount:
// OutcomesTabPanel imports this module's default. onInvalid defaults to "error";
// `outcomes` is optional in the schema, so a still-loading payload passes and
// reaches the widget's own <LoadingState/> — the boundary fires only on genuine
// drift (a non-array outcomes, or a row with a bad kind/delta).
export default withWidgetBoundary(
  outcomesWidgetDataSchema,
  OutcomesWidgetInner,
  { area: "outcomes" },
);
