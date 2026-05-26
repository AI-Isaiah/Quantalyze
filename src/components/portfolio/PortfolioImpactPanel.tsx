"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  SimulatorCandidate,
  SimulatorDeltas,
  TimeSeriesPoint,
} from "@/lib/types";
import { DELTA_UNITS } from "@/lib/api/simulatorSchema";
import type { SimulatorResponseOk } from "@/lib/api/simulatorSchema";

interface PortfolioImpactPanelProps {
  portfolioId: string;
  candidateStrategyId: string;
  candidateName: string;
  onClose: () => void;
}

type FetchState =
  | { kind: "loading" }
  | { kind: "error"; message: string; retryAfter?: number }
  | { kind: "success"; data: SimulatorCandidate };

export function PortfolioImpactPanel({
  portfolioId,
  candidateStrategyId,
  candidateName,
  onClose,
}: PortfolioImpactPanelProps) {
  const [state, setState] = useState<FetchState>({ kind: "loading" });
  const abortRef = useRef<AbortController | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = "portfolio-impact-panel-title";
  const descriptionId = "portfolio-impact-panel-description";

  const fetchImpact = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setState({ kind: "loading" });
    try {
      const res = await fetch("/api/simulator", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          portfolio_id: portfolioId,
          candidate_strategy_id: candidateStrategyId,
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const body = await res
          .json()
          .catch(() => ({ error: "Simulation failed" }));
        if (res.status === 429) {
          const headerRetry = Number(res.headers.get("Retry-After"));
          const retryAfter =
            typeof body.retryAfter === "number"
              ? body.retryAfter
              : Number.isFinite(headerRetry) && headerRetry > 0
                ? headerRetry
                : undefined;
          if (!controller.signal.aborted) {
            setState({
              kind: "error",
              message: body.error ?? "Too many simulations. Try again later.",
              retryAfter,
            });
          }
          return;
        }
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }

      const data = (await res.json()) as SimulatorCandidate;
      if (!controller.signal.aborted) {
        setState({ kind: "success", data });
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      if (!controller.signal.aborted) {
        setState({
          kind: "error",
          message:
            err instanceof Error ? err.message : "Failed to simulate impact",
        });
      }
    }
  }, [portfolioId, candidateStrategyId]);

  useEffect(() => {
    fetchImpact();
    return () => abortRef.current?.abort();
  }, [fetchImpact]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) onClose();
    },
    [onClose],
  );

  const announcement =
    state.kind === "success" && state.data.status === "ok"
      ? buildDeltaAnnouncement(state.data.deltas)
      : "";

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end"
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/20" aria-hidden="true" />

      {/* Panel */}
      <div
        ref={panelRef}
        tabIndex={-1}
        className="relative z-10 flex h-full w-full max-w-md flex-col bg-surface shadow-elevated focus:outline-none"
        style={{ animation: "slideInRight 250ms ease-out" }}
      >
        {/* Header */}
        <header className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <h2
              id={titleId}
              className="truncate text-base font-semibold text-text-primary"
            >
              Simulate impact: {candidateName}
            </h2>
            <p
              id={descriptionId}
              className="mt-1 text-xs leading-relaxed text-text-muted"
            >
              Preview how adding this strategy would shift your portfolio&rsquo;s
              Sharpe, drawdown, correlation and concentration.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close panel"
            className="shrink-0 rounded-md p-1 text-text-muted transition-colors hover:text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M4 4l8 8M12 4l-8 8"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </header>

        {/* Live region for delta announcements — screen-reader only. */}
        <div role="status" aria-live="polite" className="sr-only">
          {announcement}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {state.kind === "loading" && <LoadingSkeleton />}
          {state.kind === "error" && (
            <ErrorState
              message={state.message}
              onRetry={fetchImpact}
              retryAfter={state.retryAfter}
            />
          )}
          {state.kind === "success" && state.data.status !== "ok" && (
            <NonOkState data={state.data} />
          )}
          {state.kind === "success" && state.data.status === "ok" && (
            <SuccessBody data={state.data} />
          )}
        </div>
      </div>

      <style>{`
        @keyframes slideInRight {
          from { transform: translateX(100%); }
          to { transform: translateX(0); }
        }
      `}</style>
    </div>
  );
}

// ---------------------------------------------------------------------------
// States
// ---------------------------------------------------------------------------

function LoadingSkeleton() {
  return (
    <div className="space-y-4" aria-label="Loading portfolio impact">
      <div className="grid grid-cols-2 gap-2">
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="rounded-lg border border-border bg-surface px-3 py-3"
          >
            <div className="mb-2 h-3 w-16 animate-pulse rounded bg-border" />
            <div className="h-5 w-20 animate-pulse rounded bg-border" />
          </div>
        ))}
      </div>
      <div className="h-40 w-full animate-pulse rounded-lg border border-border bg-page" />
    </div>
  );
}

function ErrorState({
  message,
  onRetry,
  retryAfter,
}: {
  message: string;
  onRetry: () => void;
  retryAfter?: number;
}) {
  // When the server tells us to wait (429 Retry-After), disable retry for
  // that duration. A re-click would just re-hit the limiter and fail again.
  const isRateLimited =
    typeof retryAfter === "number" && Number.isFinite(retryAfter) && retryAfter > 0;
  return (
    <div
      className="rounded-lg border border-negative/20 bg-negative/5 px-4 py-3"
      role="alert"
    >
      <p className="text-sm text-negative">{message}</p>
      {isRateLimited && (
        <p className="mt-1 text-xs text-negative/80">
          Try again in {formatRetryAfter(retryAfter)}.
        </p>
      )}
      <button
        type="button"
        onClick={onRetry}
        disabled={isRateLimited}
        className="mt-2 rounded-md border border-negative/30 bg-surface px-3 py-1 text-xs font-medium text-negative transition-colors hover:bg-negative/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-negative disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-surface"
      >
        Retry
      </button>
    </div>
  );
}

function formatRetryAfter(seconds: number): string {
  if (seconds < 60) return `${Math.max(1, Math.ceil(seconds))}s`;
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.ceil(minutes / 60);
  return `${hours}h`;
}

function NonOkState({ data }: { data: SimulatorCandidate }) {
  const copy =
    data.status === "insufficient_data"
      ? "Not enough overlapping history to simulate this candidate. Requires at least 30 trading days of overlap with your portfolio."
      : data.status === "already_in_portfolio"
        ? "This strategy is already in your portfolio, so the ADD scenario doesn't apply."
        : "Your portfolio has no strategies yet. Add at least one strategy before simulating impact.";
  return (
    <div className="rounded-lg border border-border bg-page px-4 py-3">
      <p className="text-sm text-text-secondary">{copy}</p>
    </div>
  );
}

function SuccessBody({ data }: { data: SimulatorResponseOk }) {
  // NEW-C11-05: defense-in-depth — if the schema's ok-branch refine is ever
  // bypassed (e.g. producer drift before the next schema gate upgrade), guard
  // against rendering ±0 chips as a confident projection for a degenerate row.
  const allDeltasNull =
    data.deltas.sharpe_delta === null &&
    data.deltas.dd_delta === null &&
    data.deltas.corr_delta === null &&
    data.deltas.concentration_delta === null;
  if (data.overlap_days < 30 || allDeltasNull) {
    return (
      <div className="rounded-lg border border-border bg-page px-4 py-3">
        <p className="text-sm text-text-secondary">
          Not enough overlapping history to compute reliable projections.
          Requires at least 30 trading days of overlap with your portfolio.
        </p>
      </div>
    );
  }
  return (
    <div className="space-y-5">
      {data.partial_history && (
        <PartialHistoryBanner overlapDays={data.overlap_days} />
      )}
      <DeltaHero deltas={data.deltas} />
      <EquityOverlay
        current={data.equity_curve_current}
        proposed={data.equity_curve_proposed}
      />
    </div>
  );
}

// NEW-C11-04: PartialHistoryBanner previously said "only {overlapDays} overlapping
// trading days" which implied both sides are measured over those days. In reality,
// `current_*` metrics use the full portfolio window while `proposed_*` use the
// overlap window — the wording implied a symmetric short window that doesn't exist.
// Clarify that the overlap applies to the candidate side only until window alignment
// is implemented (NEW-C11-03, Python-side fix).
function PartialHistoryBanner({ overlapDays }: { overlapDays: number }) {
  return (
    <div
      className="rounded-md border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-warning"
      role="note"
    >
      <strong className="font-medium">Partial history:</strong>{" "}
      the candidate has only {overlapDays} overlapping trading days with your
      portfolio. Current metrics use your full history; proposed metrics use
      the shorter overlap window. Deltas mix two different periods — treat them
      as directional signals, not precise measurements.
    </div>
  );
}

// ---------------------------------------------------------------------------
// DeltaHero
// ---------------------------------------------------------------------------

type DeltaChip = {
  key: string;
  label: string;
  // NEW-C11-01: null = not computable (operand metric was None upstream).
  value: number | null;
  format: "ratio" | "percent";
  hint: string;
};

// NEW-C11-06: read units from DELTA_UNITS (single source of truth in simulatorSchema.ts)
// so this table and buildDeltaAnnouncement can't drift independently.
function deltaChips(deltas: SimulatorDeltas): DeltaChip[] {
  return [
    {
      key: "sharpe",
      label: "Sharpe",
      value: deltas.sharpe_delta,
      format: DELTA_UNITS.sharpe_delta,
      hint: "Change in portfolio Sharpe ratio.",
    },
    {
      key: "maxdd",
      label: "MaxDD",
      value: deltas.dd_delta,
      format: DELTA_UNITS.dd_delta,
      hint: "Positive = shallower maximum drawdown.",
    },
    {
      key: "correlation",
      label: "Correlation",
      value: deltas.corr_delta,
      format: DELTA_UNITS.corr_delta,
      hint: "Positive = lower average pairwise correlation.",
    },
    {
      key: "concentration",
      label: "Concentration",
      value: deltas.concentration_delta,
      format: DELTA_UNITS.concentration_delta,
      hint: "Positive = less concentrated (lower HHI).",
    },
  ];
}

function DeltaHero({ deltas }: { deltas: SimulatorDeltas }) {
  const chips = deltaChips(deltas);
  return (
    <section aria-label="Portfolio impact deltas">
      <h3 className="mb-2 text-[11px] font-medium uppercase tracking-wider text-text-muted">
        Projected impact
      </h3>
      <div className="grid grid-cols-2 gap-2">
        {chips.map((chip) => (
          <DeltaChipCard key={chip.key} chip={chip} />
        ))}
      </div>
    </section>
  );
}

function DeltaChipCard({ chip }: { chip: DeltaChip }) {
  // NEW-C11-01: null = not computable — 4th state distinct from neutral/improving/regressing.
  // NEW-C11-02: corr_delta=null when current portfolio has <2 strategies (no baseline pair).
  const notComputable = chip.value === null;
  const improving = !notComputable && chip.value > 0;
  const neutral = !notComputable && chip.value === 0;
  const color = notComputable
    ? "text-text-muted"
    : neutral
      ? "text-text-secondary"
      : improving
        ? "text-positive"
        : "text-negative";
  const accent = notComputable
    ? "border-border"
    : neutral
      ? "border-border"
      : improving
        ? "border-positive/30"
        : "border-negative/30";
  // DESIGN.md muted teal accent bar for improving chips.
  const teal = "#1B6B5A";
  return (
    <div
      className={`rounded-lg border ${accent} bg-surface px-3 py-3`}
      title={notComputable ? `${chip.hint} (not computable — operand metric unavailable)` : chip.hint}
    >
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-medium uppercase tracking-wider text-text-muted">
          {chip.label}
        </p>
        {improving && (
          <span
            aria-hidden="true"
            className="inline-block h-1.5 w-1.5 rounded-full"
            style={{ backgroundColor: teal }}
          />
        )}
      </div>
      <p className={`mt-1 font-metric text-sm tabular-nums ${color}`}>
        {formatDelta(chip.value, chip.format)}
      </p>
    </div>
  );
}

// NEW-C11-01: null renders as "—" (em dash) — visually distinct from ±0.000
// so the allocator cannot mistake "not computable" for "no impact."
function formatDelta(value: number | null, format: "ratio" | "percent"): string {
  if (value === null) return "—";
  const sign = value > 0 ? "+" : value < 0 ? "" : "±";
  if (format === "percent") {
    return `${sign}${(value * 100).toFixed(2)}%`;
  }
  return `${sign}${value.toFixed(3)}`;
}

// ---------------------------------------------------------------------------
// Equity overlay
// ---------------------------------------------------------------------------

function EquityOverlay({
  current,
  proposed,
}: {
  current: TimeSeriesPoint[];
  proposed: TimeSeriesPoint[];
}) {
  // Merged x-axis of all unique dates across both series keeps the overlay
  // aligned when the proposed curve starts later (candidate has shorter history).
  // NEW-C11-08: building the Map with new Map(arr.map(...)) silently drops
  // duplicate dates (last-write-wins). Warn in development when a collision is
  // detected so an accidental date-normalization change surfaces immediately
  // rather than producing an invisible gap in the line.
  const merged = useMemo(() => {
    function buildDateMap(points: TimeSeriesPoint[], label: string) {
      const map = new Map<string, number>();
      for (const p of points) {
        if (map.has(p.date) && process.env.NODE_ENV !== "production") {
          console.warn(
            `[EquityOverlay] duplicate date "${p.date}" in ${label} series — last-write-wins`,
          );
        }
        map.set(p.date, p.value);
      }
      return map;
    }
    const mapCurrent = buildDateMap(current, "current");
    const mapProposed = buildDateMap(proposed, "proposed");
    const dates = Array.from(
      new Set([...mapCurrent.keys(), ...mapProposed.keys()]),
    ).sort();
    return dates.map((d) => ({
      date: d,
      current: mapCurrent.get(d) ?? null,
      proposed: mapProposed.get(d) ?? null,
    }));
  }, [current, proposed]);

  if (merged.length === 0) {
    return (
      <section aria-label="Equity curve overlay">
        <h3 className="mb-2 text-[11px] font-medium uppercase tracking-wider text-text-muted">
          Equity overlay
        </h3>
        <div className="rounded-lg border border-border bg-page px-3 py-6 text-center text-xs text-text-muted">
          No equity history available.
        </div>
      </section>
    );
  }

  return (
    <section aria-label="Equity curve overlay">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-[11px] font-medium uppercase tracking-wider text-text-muted">
          Equity overlay
        </h3>
        <div className="flex items-center gap-3 text-[11px] text-text-muted">
          <span className="inline-flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="inline-block h-0.5 w-4 rounded-full"
              style={{ backgroundColor: "#94A3B8" }}
            />
            Current
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="inline-block h-0.5 w-4 rounded-full"
              style={{ backgroundColor: "#1B6B5A" }}
            />
            Proposed
          </span>
        </div>
      </div>
      <EquityOverlayChart merged={merged} />
    </section>
  );
}

interface MergedPoint {
  date: string;
  current: number | null;
  proposed: number | null;
}

function EquityOverlayChart({ merged }: { merged: MergedPoint[] }) {
  const width = 360;
  const height = 140;
  const padding = { top: 8, right: 8, bottom: 18, left: 8 };

  const values = merged.flatMap((p) =>
    [p.current, p.proposed].filter((v): v is number => v !== null),
  );
  if (values.length === 0) return null;

  const minY = Math.min(...values);
  const maxY = Math.max(...values);
  const spanY = maxY - minY || 1;
  const innerW = width - padding.left - padding.right;
  const innerH = height - padding.top - padding.bottom;

  const xAt = (i: number) =>
    padding.left + (i / Math.max(1, merged.length - 1)) * innerW;
  const yAt = (v: number) =>
    padding.top + (1 - (v - minY) / spanY) * innerH;

  const currentPath = buildPath(
    merged.map((p, i) => (p.current !== null ? [xAt(i), yAt(p.current)] : null)),
  );
  const proposedPath = buildPath(
    merged.map((p, i) => (p.proposed !== null ? [xAt(i), yAt(p.proposed)] : null)),
  );

  return (
    <div className="rounded-lg border border-border bg-surface p-2">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height={height}
        role="img"
        aria-label="Portfolio equity curve: current vs proposed"
      >
        {/* Midline for reference */}
        <line
          x1={padding.left}
          y1={height - padding.bottom}
          x2={width - padding.right}
          y2={height - padding.bottom}
          stroke="#E2E8F0"
          strokeWidth={1}
        />
        {currentPath && (
          <path
            d={currentPath}
            fill="none"
            stroke="#94A3B8"
            strokeWidth={1.5}
            strokeLinejoin="round"
          />
        )}
        {proposedPath && (
          <path
            d={proposedPath}
            fill="none"
            stroke="#1B6B5A"
            strokeWidth={1.75}
            strokeLinejoin="round"
          />
        )}
      </svg>
    </div>
  );
}

function buildPath(points: ([number, number] | null)[]): string | null {
  let d = "";
  let started = false;
  for (const p of points) {
    if (!p) {
      // Null points create a gap: next valid point starts a new M segment.
      started = false;
      continue;
    }
    const [x, y] = p;
    if (!started) {
      d += `M${x.toFixed(2)},${y.toFixed(2)}`;
      started = true;
    } else {
      d += ` L${x.toFixed(2)},${y.toFixed(2)}`;
    }
  }
  return d.length > 0 ? d : null;
}

// ---------------------------------------------------------------------------
// ARIA announcement
// ---------------------------------------------------------------------------

// NEW-C11-06: read units from DELTA_UNITS — same map as deltaChips() so the two
// can't drift independently.
function buildDeltaAnnouncement(deltas: SimulatorDeltas): string {
  const parts = [
    formatAnnouncementChip("Sharpe", deltas.sharpe_delta, DELTA_UNITS.sharpe_delta),
    formatAnnouncementChip("Max drawdown", deltas.dd_delta, DELTA_UNITS.dd_delta),
    formatAnnouncementChip("Correlation", deltas.corr_delta, DELTA_UNITS.corr_delta),
    formatAnnouncementChip("Concentration", deltas.concentration_delta, DELTA_UNITS.concentration_delta),
  ];
  return `Simulation complete. ${parts.join(". ")}.`;
}

function formatAnnouncementChip(
  label: string,
  value: number | null,
  format: "ratio" | "percent",
): string {
  // NEW-C11-01: null delta = not computable, emit a distinct phrase.
  if (value === null) return `${label} not computable`;
  const direction =
    value > 0 ? "improved" : value < 0 ? "regressed" : "unchanged";
  if (value === 0) return `${label} unchanged`;
  // NEW-C11-07: use Math.abs() so the word ("improved"/"regressed") carries
  // the sign once — "regressed by 0.50%" is unambiguous; "regressed by -0.50%"
  // is a double-negative that screen-reader users hear as an improvement.
  const magnitude = Math.abs(value);
  const delta =
    format === "percent"
      ? `${(magnitude * 100).toFixed(2)}%`
      : `${magnitude.toFixed(3)}`;
  return `${label} ${direction} by ${delta}`;
}
