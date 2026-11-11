"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Skeleton, SkeletonText } from "@/components/ui/Skeleton";
import { Term } from "@/components/ui/Term";
import { Tooltip } from "@/components/ui/Tooltip";
import { termDefinition, type TermKey } from "@/lib/glossary";
import { LiveRegion } from "@/components/ui/LiveRegion";
import { cn, formatNumber, formatPercent } from "@/lib/utils";
import { RouteResponseError } from "@/lib/route-response-error";
import { signTone } from "@/lib/factsheet/display-sign";
import { buildFactsheetHref } from "@/lib/factsheet/origin";
import {
  SHORT_TRACK_MARKER,
  gatedValue,
  shortTrackMarkerTitle,
  widenedWithheldReason,
  type FigureState,
} from "@/lib/figure-gate";
import { captureToSentry } from "@/lib/sentry-capture";
import { parseLiftState, parseWireFigureRecord } from "@/lib/portfolio-analytics-adapter";

/**
 * The one sentence shown when the failure did NOT come from a route response —
 * a rejected fetch, an unreadable body, anything whose own message is internal
 * noise. DESIGN.md §Voice: declarative, sentence-case, active voice, no
 * adjectives. "Retry" names the control that is rendered beside it.
 */
const OPTIMIZER_UNAVAILABLE_COPY =
  "We could not complete the optimizer run. Retry in a moment.";

/**
 * 194 R2-M1: the reason line for a withheld lift whose failing record could not be read, so a
 * bare dash never stands without a reason. Same voice as `widenedWithheldReason`.
 */
const WITHHELD_GENERIC_REASON = "Withheld: the record is too short to annualize.";

export type OptimizerSuggestion = {
  strategy_id: string;
  strategy_name: string;
  corr_with_portfolio: number | null;
  sharpe_lift: number | null;
  /**
   * 194 D-11 / D-15: the producer's lift verdict, as stored. All three are optional: a
   * suggestion stored before the producer recorded them has none, and reads as unknown (the
   * cell as before, no marker). `sharpe_lift_state` is closed-set checked and the record is
   * shape checked when read (`parseLiftState`, `parseWireFigureRecord`); nothing is re-derived.
   */
  sharpe_lift_span_days?: number | null;
  sharpe_lift_state?: FigureState | null;
  /** 194 R3 SFH-M1: the stored out-of-set state the adapter coerced to "withheld" (see types.ts). */
  sharpe_lift_state_raw?: string;
  sharpe_lift_failing_record?: { span_days: number | null; observations: number | null; crypto: boolean } | null;
  dd_improvement: number | null;
  score: number | null;
};

type ComputationStatus = "pending" | "computing" | "complete" | "failed" | null;

export interface PortfolioOptimizerProps {
  portfolioId: string;
  initialSuggestions: OptimizerSuggestion[] | null;
  computedAt: string | null;
  computationStatus: ComputationStatus;
}

const STALE_DAYS = 7;
const MS_PER_DAY = 1000 * 60 * 60 * 24;

function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.floor((Date.now() - t) / MS_PER_DAY);
}

// 170.6 D-03: green only when the figure PRINTS above zero, read at the precision and scale
// its unit prints at (a percent is x100). A lift that prints "0.00" is not green.
function liftClass(value: number | null, unit: MetricUnit): string {
  if (value == null) return "text-text-muted";
  const tone = unit === "percent" ? signTone(value, 2, 100) : signTone(value, 2);
  return tone === "positive" ? "text-positive" : "text-text-secondary";
}

/**
 * Per-metric unit (red-team F-2 honesty fix). The optimizer output mixes true
 * fractions with unitless quantities; rendering them all as `formatPercent`
 * (×100 + "%") turned a 0.45 CORRELATION into "+45.00%" and a 0.15 unitless
 * SHARPE delta into "+15.00%" — both misread as allocation/weight %s on the demo
 * page. Correlation is a −1..1 coefficient and Sharpe-lift is a unitless delta,
 * so both render as plain decimals; only `dd_improvement` (a reduction in the
 * portfolio's max drawdown, itself a fraction of NAV) is a genuine percentage.
 * This is a correctness fix on BOTH surfaces this component mounts on
 * (/allocations via OptimizerPanel AND /portfolios/[id]).
 */
type MetricUnit = "percent" | "decimal" | "signedDecimal";

function formatMetric(value: number | null, unit: MetricUnit): string {
  if (unit === "percent") return formatPercent(value);
  if (value == null || !Number.isFinite(value)) return "—";
  const decimal = formatNumber(value, 2); // negatives keep their natural "-".
  // 170.6 D-02: the "+" goes only on a figure that prints above zero; a rounded zero prints
  // unsigned. (formatNumber's own signed zero is plan 02's, via utils delegation.)
  return unit === "signedDecimal" && signTone(value, 2) === "positive" ? `+${decimal}` : decimal;
}

// Phase 100 / PI-05 (UI-SPEC W3) and Phase 201 U-02 / U-17: the narrative tooltip on each
// metric label is the registry definition for `term` (the same text OptimizerPanel's
// glossary shows), opened through the app's one `Term` affordance. Also mounts on
// /portfolios/[id]:353. Ordering and every other DOM node are unchanged.
//
// `note` is a per-row sentence appended to the definition (194 D-15: why a lift is withheld,
// or what the `<1y` marker means). `Term` shows the registry text alone, so a row with a note
// opens the same bubble with the note appended, on a trigger carrying the same `data-term`
// and the same classes (`PortfolioOptimizer.test.tsx` pins the two classNames equal).
const TERM_TRIGGER_CLASSES =
  "cursor-help underline decoration-dotted decoration-1 decoration-text-muted underline-offset-2 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 print:no-underline";

function MetricLabel({
  term,
  label,
  note,
}: {
  term: TermKey;
  label: string;
  note?: string;
}) {
  if (!note) return <Term k={term}>{label}</Term>;
  return (
    <Tooltip content={`${termDefinition(term)} ${note}`} className="inline">
      {({ "aria-describedby": describedBy }) => (
        <span
          tabIndex={0}
          data-term={term}
          aria-describedby={describedBy}
          className={TERM_TRIGGER_CLASSES}
        >
          {label}
        </span>
      )}
    </Tooltip>
  );
}

function MetricCell({
  label,
  term,
  value,
  unit,
  note,
  marker,
}: {
  label: string;
  term: TermKey;
  value: number | null;
  unit: MetricUnit;
  note?: string;
  /** 194 D-15: the `<1y` marker, rendered after the value. */
  marker?: { title: string };
}) {
  return (
    <div className="text-right">
      <p className="text-micro uppercase tracking-wider text-text-muted font-medium">
        <MetricLabel term={term} label={label} note={note} />
      </p>
      <p
        className={cn(
          "mt-0.5 text-small font-metric tabular-nums",
          liftClass(value, unit),
        )}
      >
        {formatMetric(value, unit)}
        {marker && (
          <span
            title={marker.title}
            className="ml-1 inline-block min-w-[3ch] text-right align-baseline text-micro font-mono tabular-nums text-text-muted"
          >
            {SHORT_TRACK_MARKER}
            <span className="sr-only"> {marker.title}</span>
          </span>
        )}
      </p>
    </div>
  );
}

function SuggestionRow({
  suggestion,
}: {
  suggestion: OptimizerSuggestion;
}) {
  // 194 D-11 / D-15: the producer's verdict on the two records the lift compares. Read, never
  // re-derived. An ABSENT state (null or undefined) is the pre-194 shape and shows the value (D-17).
  // A PRESENT state outside the closed set is not unknown: it is withheld and reported (194 R2-M2).
  // The adapter coerces an out-of-set state to "withheld" and keeps the stored value in
  // `sharpe_lift_state_raw` (R3 SFH-M1), so a coerced state still reports its real cause.
  const rawLiftState = suggestion.sharpe_lift_state_raw ?? suggestion.sharpe_lift_state;
  const parsedLiftState = parseLiftState(suggestion.sharpe_lift_state);
  const stateUnrecognised =
    suggestion.sharpe_lift_state_raw != null ||
    (suggestion.sharpe_lift_state != null && parsedLiftState === null);
  const liftState: FigureState = stateUnrecognised ? "withheld" : (parsedLiftState ?? "null");
  const failingRecord = parseWireFigureRecord(suggestion.sharpe_lift_failing_record);
  const recordUnreadable = liftState === "withheld" && failingRecord === null;
  // 194 R2-M1 / R2-M2: report the malformed stored value once per value, not once per render.
  useEffect(() => {
    if (!stateUnrecognised && !recordUnreadable) return;
    captureToSentry(
      new Error(
        stateUnrecognised
          ? "the optimizer suggestion carried an unrecognised sharpe_lift_state"
          : "the optimizer suggestion's withheld lift carried an unreadable failing record",
      ),
      {
        level: "warning",
        tags: {
          component: "PortfolioOptimizer",
          stage: stateUnrecognised ? "lift-state-unrecognised" : "lift-record-unreadable",
        },
        extra: { state: String(rawLiftState) },
      },
    );
  }, [stateUnrecognised, recordUnreadable, rawLiftState]);
  const liftSpan =
    typeof suggestion.sharpe_lift_span_days === "number" &&
    Number.isFinite(suggestion.sharpe_lift_span_days)
      ? suggestion.sharpe_lift_span_days
      : null;
  const withheldReason =
    liftState === "withheld"
      ? failingRecord !== null
        ? widenedWithheldReason("delta", failingRecord)
        : WITHHELD_GENERIC_REASON
      : null;
  const shortTitle = liftState === "short" && liftSpan !== null ? shortTrackMarkerTitle(liftSpan) : null;
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 flex-1">
        <p className="text-small font-semibold text-text-primary break-words min-w-0">
          {suggestion.strategy_name}
        </p>
        {/* Raw strategy_id is a legitimate single-line clip (not meaningful
            prose to recover) — audit :81 classified legitimate, left as-is. */}
        <p className="mt-0.5 font-mono text-micro text-text-muted truncate">
          {suggestion.strategy_id}
        </p>
      </div>
      <div className="flex items-center gap-4 sm:gap-6">
        <MetricCell
          label="Sharpe lift"
          term="sharpe_lift"
          value={gatedValue(suggestion.sharpe_lift, liftState)}
          unit="signedDecimal"
          note={withheldReason ?? shortTitle ?? undefined}
          marker={shortTitle ? { title: shortTitle } : undefined}
        />
        <MetricCell
          label="Corr w/ allocation"
          term="corr_with_allocation"
          value={suggestion.corr_with_portfolio}
          unit="decimal"
        />
        <MetricCell
          label="DD improve"
          term="dd_improve"
          value={suggestion.dd_improvement}
          unit="percent"
        />
      </div>
      <div className="flex items-center gap-2">
        <Link
          href={buildFactsheetHref(suggestion.strategy_id, { key: "allocations" })}
          className="text-caption font-medium text-accent hover:text-accent-hover underline-offset-2 hover:underline"
        >
          View strategy
        </Link>
      </div>
    </div>
  );
}

function OptimizerShimmer() {
  return (
    <div className="space-y-3">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="rounded-lg border border-border bg-surface p-4"
        >
          <Skeleton className="h-4 w-1/3 mb-3" />
          <SkeletonText lines={2} />
        </div>
      ))}
    </div>
  );
}

export default function PortfolioOptimizer({
  portfolioId,
  initialSuggestions,
  computedAt,
  computationStatus,
}: PortfolioOptimizerProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<OptimizerSuggestion[] | null>(
    initialSuggestions,
  );
  const [lastComputedAt, setLastComputedAt] = useState<string | null>(
    computedAt,
  );

  async function runOptimizer() {
    setLoading(true);
    setError(null);
    // 140.3-07 / SEAMUX-09 / B-26 — invalidate BEFORE the refetch, not in the
    // catch. This is the locked house pattern, copied rather than re-invented
    // from `WeightOptimizerSection.tsx`'s `requestWeights` (`setResult(null)`)
    // and used identically at `admin/partner-import/page.tsx`. Without it a
    // failed re-run left the PREVIOUS ranked allocation mounted with live
    // action links under one small red line, which an allocator
    // reads as a current answer. Doing it here rather than in the catch also
    // covers the path where `router.refresh()` throws AFTER a successful
    // `setSuggestions` — the only way `error` could otherwise coexist with a
    // rendered ranking.
    setSuggestions(null);
    try {
      const res = await fetch("/api/portfolio-optimizer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ portfolio_id: portfolioId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.status === "failed") {
        // The route's `error` field is reviewed, scrubbed copy — on a breaker
        // trip it IS the single-source sentence from `src/lib/seam-copy.ts`,
        // and the route deliberately never puts `err.message` in it (M-0333).
        // Marking it as route-authored is what lets the catch below refuse to
        // render everything else without also deleting the breaker surface.
        throw new RouteResponseError(
          typeof data?.error === "string"
            ? data.error
            : `Optimizer failed (${res.status})`,
        );
      }
      setSuggestions(Array.isArray(data.suggestions) ? data.suggestions : []);
      setLastComputedAt(new Date().toISOString());
      router.refresh();
    } catch (e) {
      // 140.3-07 / B-27 — the caught value goes to the console and never to the
      // user. A `TypeError` from a rejected fetch, or an undici transport
      // string, can carry an internal URL or header name; only a message this
      // component built from a route RESPONSE is safe to render.
      console.error("[PortfolioOptimizer] run failed:", e);
      setError(e instanceof RouteResponseError ? e.message : OPTIMIZER_UNAVAILABLE_COPY);
    } finally {
      setLoading(false);
    }
  }

  const heading = (
    <div className="mb-4">
      <h2 className="text-body font-semibold text-text-primary">
        Diversification Optimizer
      </h2>
      <p className="mt-0.5 text-caption text-text-muted">
        Identify uncorrelated strategies that improve your risk-adjusted return.
      </p>
    </div>
  );

  // 2. Computing
  if (loading || computationStatus === "computing") {
    return (
      <Card>
        {heading}
        <OptimizerShimmer />
      </Card>
    );
  }

  // 5. Failed — reachable from BOTH entry points.
  //
  // `computationStatus` is a SERVER-RENDERED prop. A client-side re-run failure
  // never updates it, so the original `computationStatus === "failed" &&
  // !suggestions` guard was unreachable after a re-run failure: with the
  // ranking now correctly discarded the user would have landed on the "never
  // run" empty state, which says "Run the optimizer to see strategies…" — a
  // false statement about what just happened.
  //
  // The `error` disjunct adds the client path; the original conjunct is left
  // byte-intact so the server path keeps working (TRAP-9). Placing this ABOVE
  // every other branch is also what guarantees no ranking can render while an
  // error is set, whatever order the states below are later rearranged in.
  if (error || (computationStatus === "failed" && !suggestions)) {
    return (
      <Card>
        {heading}
        {/* The announcement is the ONLY channel here: this branch returns a
            DIFFERENT tree, so the "Re-run" button the user just activated has
            unmounted and focus has fallen to <body>. Carries the card's own
            sentence — no new copy, no visual delta (DESIGN-05). */}
        <LiveRegion
          message={error ?? "We couldn't compute suggestions for this allocation."}
          assertive
        />
        <div className="rounded-lg border border-negative/30 bg-negative/5 px-4 py-3">
          <p className="text-small font-medium text-negative">
            Optimizer failed
          </p>
          <p className="mt-0.5 text-caption text-text-secondary">
            {error ?? "We couldn't compute suggestions for this allocation."}
          </p>
        </div>
        <div className="mt-4">
          <Button onClick={runOptimizer} disabled={loading}>
            Retry
          </Button>
        </div>
      </Card>
    );
  }

  // 1. Empty (never run)
  if (suggestions === null) {
    return (
      <Card>
        {heading}
        <p className="text-small text-text-secondary">
          Run the optimizer to see strategies that could improve your
          allocation&apos;s risk-adjusted return.
        </p>
        {/* No inline `{error && …}` here: the failed branch above now returns
            on ANY error, so this state is only ever reached with `error` null.
            A second error surface that cannot render is how a reviewer loses
            track of which sites were closed. The failed card carries the same
            message plus a Retry control, so no affordance is lost. */}
        <div className="mt-4">
          <Button onClick={runOptimizer} disabled={loading}>
            {loading ? "Running..." : "Run Optimizer"}
          </Button>
        </div>
      </Card>
    );
  }

  // 3. Empty after compute
  if (suggestions.length === 0) {
    return (
      <Card>
        {heading}
        <p className="text-small text-text-secondary">
          No candidates match your current mandate. Try relaxing filters.
        </p>
        {/* Same reasoning as the empty state above — unreachable with `error`
            set, so the inline duplicate is gone rather than left as a second
            error surface that never renders. */}
        <div className="mt-4">
          <Button onClick={runOptimizer} disabled={loading}>
            {loading ? "Running..." : "Re-run Optimizer"}
          </Button>
        </div>
      </Card>
    );
  }

  // 4. + 6. Success (with optional stale banner)
  const days = daysSince(lastComputedAt);
  const isStale = days != null && days > STALE_DAYS;
  const top = suggestions.slice(0, 5);

  return (
    <Card>
      {heading}

      {isStale && (
        <div className="mb-4 flex flex-col gap-2 rounded-lg border border-border bg-page px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-caption text-text-secondary">
            Suggestions computed {days} days ago. Re-run to refresh.
          </p>
          <Button
            variant="secondary"
            size="sm"
            onClick={runOptimizer}
            disabled={loading}
          >
            {loading ? "Running..." : "Re-run"}
          </Button>
        </div>
      )}

      {/* This is the branch the stale ranking used to fall through to. It is
          now unreachable with `error` set — which is the whole point of
          SEAMUX-09, so the red line that used to sit under the live
          suggestion action links is gone with it. */}
      <div className="space-y-3">
        {top.map((s) => (
          <SuggestionRow key={s.strategy_id} suggestion={s} />
        ))}
      </div>
    </Card>
  );
}
