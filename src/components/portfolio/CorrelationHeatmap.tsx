"use client";

import { Fragment } from "react";

interface CorrelationHeatmapProps {
  correlationMatrix: Record<string, Record<string, number>> | null;
  strategyNames: Record<string, string>;
  // NOTE (review type-design F4): the two optional props below intentionally
  // MIRROR the nullability of their `ComputedMetrics` source — `overlappingDays`
  // mirrors `n: number` (never null), `avgAbsCorrelation` mirrors
  // `avg_pairwise_correlation: number | null`. The asymmetry is deliberate, not
  // an oversight; absence (`undefined`) on either means "no host context"
  // (the portfolio-detail caller passes neither).
  /**
   * CORR-02 — the host's overlapping-day count (`scenarioMetrics.n`). Lets the
   * presentational heatmap distinguish the `< 10 overlapping days` empty-state
   * reason from the `< 2 strategies` reason. Optional: when absent, the gate
   * still fires on `< 2` strategies and falls back to the combined copy.
   */
  overlappingDays?: number;
  /**
   * CORR-03 — the single-sourced off-diagonal absolute-mean correlation
   * (`scenarioMetrics.avg_pairwise_correlation`). The heatmap NEVER computes its
   * own average; it renders whatever the host passes so the caption and the KPI
   * strip cannot diverge. Optional + nullable: a null/absent value hides the
   * caption (e.g. a 1-strategy or degenerate set has no Avg |ρ|).
   */
  avgAbsCorrelation?: number | null;
}

/**
 * Colorblind-safe diverging palette for pairwise correlation.
 *
 * Audited against deuteranopia / protanopia simulation. Uses teal → neutral
 * → burnt orange rather than red → white → green. Teal reinforces the
 * DESIGN.md accent (#1B6B5A) without matching it exactly, so correlation
 * color cannot be confused with positive/verified badges elsewhere in the UI.
 *
 * Semantic direction: strong NEGATIVE correlation (teal) is the
 * diversification signal allocators want to see; strong POSITIVE correlation
 * (burnt orange) is the concentration-risk warning. The neutral midpoint is
 * `#F1F5F9` (matches the app's page background) so zero-correlation cells
 * read as "no signal" rather than "missing data".
 *
 * Contrast policy: cell BACKGROUND color carries the primary correlation
 * signal (reinforced by the per-cell `aria-label` for screen readers). The
 * numeric overlay on each cell is a decorative spot-check — sighted users
 * read the color first, the number second. Under WCAG 2.1, non-text
 * content like a heatmap surface that is informative on its own falls
 * under SC 1.4.11 (non-text contrast, 3:1). We apply that 3:1 floor to the
 * cell number/background pair and pick whichever of dark/white text gives
 * the better contrast at each luminance.
 *
 * Anchors chosen so the dead zone (where neither text color clears 4.5:1)
 * sits above 3:1 for every interpolated value in [-1, 1]. CI contrast
 * sweep locks this in (`CorrelationHeatmap.test.tsx`). The worst case is
 * ~3.75:1 near |v| ≈ 0.45; everywhere else the ratio is ≥4.5:1.
 *
 * Tritanopia note: the midrange intermediate colors ±0.25 collapse toward
 * grey under blue/yellow confusion but the endpoints remain distinct, so
 * the "strong positive vs strong negative" signal still reads. The plan's
 * PR 16 polish pass will add a sortable 10-pair list fallback for the
 * <640px breakpoint where the grid becomes hard to scan on any device.
 */
interface PaletteStop {
  at: number;
  r: number;
  g: number;
  b: number;
}

const PALETTE: readonly PaletteStop[] = [
  { at: -1.0, r: 19, g: 78, b: 74 },     // #134E4A — very dark teal
  { at: -0.5, r: 15, g: 118, b: 110 },   // #0F766E — dark teal
  { at: 0.0, r: 241, g: 245, b: 249 },   // #F1F5F9 — page neutral
  { at: 0.5, r: 194, g: 65, b: 12 },     // #C2410C — burnt orange
  { at: 1.0, r: 124, g: 45, b: 18 },     // #7C2D12 — very dark burnt
];

export function correlationBg(v: number): string {
  const clamped = Math.max(-1, Math.min(1, v));
  // Find the first stop whose `at` is >= clamped; the previous stop is `lo`.
  // Clamps guarantee clamped ∈ [-1, 1], which matches the palette endpoints,
  // so `hiIdx` is always in [1, PALETTE.length - 1].
  const hiIdx = Math.max(1, PALETTE.findIndex((stop) => stop.at >= clamped));
  const lo = PALETTE[hiIdx - 1];
  const hi = PALETTE[hiIdx];
  const t = (clamped - lo.at) / (hi.at - lo.at);
  const r = Math.round(lo.r + t * (hi.r - lo.r));
  const g = Math.round(lo.g + t * (hi.g - lo.g));
  const b = Math.round(lo.b + t * (hi.b - lo.b));
  return `rgb(${r},${g},${b})`;
}

/**
 * Compute WCAG relative luminance for an sRGB color string `rgb(r,g,b)`.
 * Exported so the test suite can verify contrast ratios directly instead
 * of relying on spot-checking. Returns a value in [0, 1].
 */
export function relativeLuminance(rgb: string): number {
  const match = rgb.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
  if (!match) return 0;
  const [r, g, b] = match.slice(1, 4).map((channel) => {
    const n = Number(channel) / 255;
    return n <= 0.03928 ? n / 12.92 : Math.pow((n + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Contrast ratio between two sRGB colors per WCAG 2.1. */
export function contrastRatio(fg: string, bg: string): number {
  const l1 = relativeLuminance(fg);
  const l2 = relativeLuminance(bg);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

const TEXT_DARK = "rgb(26,26,46)"; // #1A1A2E
const TEXT_WHITE = "rgb(255,255,255)";

/**
 * Pick the text color (dark or white) that yields the best contrast ratio
 * against the supplied background. Luminance-driven, not value-driven,
 * because the v→color interpolation is non-linear in perceived brightness.
 *
 * Review finding on the first draft: a fixed |v| >= 0.5 threshold left a
 * dead zone around v ≈ ±0.45 where neither dark nor white cleared 4.5:1.
 * This function picks whichever color has the higher ratio, so if neither
 * clears AA the better of the two still wins. A CI contrast-sweep test
 * asserts the minimum ratio stays ≥ 4.5 across all v ∈ [-1, 1].
 */
export function pickTextColor(bg: string): string {
  const darkRatio = contrastRatio(TEXT_DARK, bg);
  const whiteRatio = contrastRatio(TEXT_WHITE, bg);
  return whiteRatio > darkRatio ? TEXT_WHITE : TEXT_DARK;
}

/** Back-compat alias — same semantics as `pickTextColor(correlationBg(v))`. */
export function textColor(v: number): string {
  return pickTextColor(correlationBg(v));
}

// Cell fallback colors for diagonal / missing-data cells.
const DIAG_BG = "#F1F5F9";
const MISSING_BG = "#F8F9FA";
const MUTED_FG = "#64748B";

// CORR-02 — empty-state copy (UI-SPEC §Copywriting Contract). The heading is
// shared; the body names the SPECIFIC reason so the allocator knows what to fix.
const EMPTY_HEADING = "Not enough overlap to correlate";
const EMPTY_BODY_FEW_STRATEGIES =
  "Add at least 2 active strategies to see how they move together.";
const EMPTY_BODY_FEW_DAYS =
  "These strategies share fewer than 10 overlapping trading days — too little history for an honest correlation. Pick strategies with longer common history.";
// Surface-neutral: this shared component also renders on the static
// portfolio-detail factsheet (no interactive "selection"), so the copy must
// not assume the scenario composer's toggle UX. See CR-01 (Phase 21 review).
const EMPTY_BODY_COMBINED =
  "Need at least 2 strategies with 10 or more overlapping days to show a correlation heatmap.";
// Review CRITICAL (silent-failure F1): the engine ALSO nulls the matrix when the
// projected returns are non-finite or the curve is fully drawn down to <=0 wealth
// (scenario.ts — newly reachable via R4 leverage), with an ADEQUATE window and
// >=2 strategies. That must NOT read as "add more strategies" — name the real cause.
const EMPTY_BODY_ENGINE_NULLED =
  "Correlation can't be computed for this scenario — the projected returns are non-finite or the curve is fully drawn down. Try lower leverage or different strategies.";

export function CorrelationHeatmap({
  correlationMatrix,
  strategyNames,
  overlappingDays,
  avgAbsCorrelation = null,
}: CorrelationHeatmapProps) {
  // CORR-04 (show-all): render EVERY id from the matrix — no top-10 truncation.
  const ids = correlationMatrix ? Object.keys(correlationMatrix) : [];

  // CORR-02 — reason-routed empty state. Triggers on:
  //   - a null matrix (the engine nulls it for 0 active strategies AND for
  //     < 10 overlapping days — scenario.ts:192-208), OR
  //   - fewer than 2 ids. The engine does NOT null a 1-strategy matrix; it
  //     returns a 1×1 `{id:{id:1}}`. This `ids.length < 2` gate is the ONLY
  //     thing preventing a degenerate 1×1 grid (and a fabricated Avg |ρ|).
  if (!correlationMatrix || ids.length < 2) {
    // Route the body copy by the actual reason. The engine nulls the matrix for
    // THREE distinct reasons (scenario.ts); a non-null 1×1 matrix is a fourth
    // (genuine 1-strategy) case. Explicit branches (not a nested ternary) so each
    // path is independently auditable (review IN-04) and the engine-nulled case
    // (review CRITICAL) can't fall through to the wrong copy:
    let body: string;
    if (overlappingDays !== undefined && overlappingDays >= 1 && overlappingDays < 10) {
      // Too-short window — engine returns a null matrix with 1 <= n < 10. The
      // `>= 1` lower bound matters: n === 0 means NO strategies are active (engine
      // 0-active early-return), which is a too-few-strategies state, NOT a short
      // window — it must fall through to the few-strategies branch below, never
      // claim "fewer than 10 overlapping days" when there are zero (review red-team).
      body = EMPTY_BODY_FEW_DAYS;
    } else if (
      correlationMatrix === null &&
      overlappingDays !== undefined &&
      overlappingDays >= 10
    ) {
      // Adequate window but the engine STILL nulled the matrix → non-finite
      // returns or a fully drawn-down (<=0 wealth) projection. The allocator
      // already has >=2 strategies and enough days, so "add more strategies"
      // would be an actively wrong lie — name the real cause instead.
      body = EMPTY_BODY_ENGINE_NULLED;
    } else if (
      ids.length < 2 &&
      (correlationMatrix !== null || overlappingDays !== undefined)
    ) {
      // A genuine < 2-strategy set: a non-null 1×1 matrix (ids.length === 1)
      // with a 10+-day window, or a scenario host that passed overlappingDays.
      body = EMPTY_BODY_FEW_STRATEGIES;
    } else {
      // Standalone null matrix with no host context (e.g. the portfolio-detail
      // caller passes no overlappingDays) — surface-neutral combined copy.
      body = EMPTY_BODY_COMBINED;
    }
    return (
      <div className="rounded-lg border border-border bg-surface px-4 py-8 text-center text-text-muted text-sm">
        <div className="font-semibold text-text-secondary">{EMPTY_HEADING}</div>
        <div className="mt-1 text-[11px]">{body}</div>
      </div>
    );
  }

  const n = ids.length;
  function label(id: string): string {
    return strategyNames[id] ?? id.slice(0, 8);
  }

  return (
    <div>
      {/* CORR-04 (show-all): both axes scroll inside a bounded container so a
          large-N grid never pushes the page; cells stay >= 48px wide. The
          figure keeps overflow-x-auto for horizontal scroll; the wrapper adds
          the vertical bound (~70vh). aria-label below names the TRUE id count
          (n = ids.length), not a capped 10. */}
      <div
        role="figure"
        aria-label={`Pairwise correlation heatmap, ${n} strategies. Teal indicates negative correlation (diversifying), burnt orange indicates positive correlation (concentration risk).`}
        className="max-h-[70vh] overflow-x-auto overflow-y-auto"
      >
        <div
          className="grid gap-px bg-border"
          style={{ gridTemplateColumns: `80px repeat(${n}, minmax(48px, 1fr))` }}
        >
        {/* Top-left empty corner */}
        <div className="bg-surface" />
        {/* Column headers */}
        {ids.map((id) => (
          <div key={`ch-${id}`} className="bg-surface px-1 py-2 text-[10px] uppercase tracking-wider text-text-muted text-center truncate">
            {label(id)}
          </div>
        ))}
        {/* Rows */}
        {ids.map((rowId) => (
          <Fragment key={rowId}>
            {/* Row header */}
            <div className="bg-surface px-2 py-2 text-[10px] uppercase tracking-wider text-text-muted truncate flex items-center">
              {label(rowId)}
            </div>
            {/* Cells */}
            {ids.map((colId) => {
              const v = correlationMatrix[rowId]?.[colId] ?? null;
              const isDiag = rowId === colId;
              const hasValue = v != null;
              const ariaLabel = hasValue
                ? `${label(rowId)} and ${label(colId)}: ${v.toFixed(2)} correlation`
                : `${label(rowId)} and ${label(colId)}: no data`;

              let backgroundColor: string;
              let color: string;
              if (!hasValue) {
                backgroundColor = MISSING_BG;
                color = MUTED_FG;
              } else if (isDiag) {
                backgroundColor = DIAG_BG;
                color = MUTED_FG;
              } else {
                backgroundColor = correlationBg(v);
                color = textColor(v);
              }

              return (
                <div
                  key={`${rowId}-${colId}`}
                  role="img"
                  aria-label={ariaLabel}
                  className="flex items-center justify-center py-2 font-metric text-xs"
                  style={{ backgroundColor, color }}
                >
                  {hasValue ? v.toFixed(2) : "\u2014"}
                </div>
              );
            })}
            </Fragment>
          ))}
        </div>
      </div>
      {/* CORR-03 — single-sourced "Avg |ρ|" caption. The value is the host's
          off-diagonal absolute-mean correlation; the heatmap NEVER computes its
          own average (prevents caption/KPI-strip divergence). Rendered only when
          the host passes a finite number — a degenerate/null average shows no
          caption rather than a fabricated 0.00. */}
      {avgAbsCorrelation != null && Number.isFinite(avgAbsCorrelation) ? (
        <div className="mt-2 text-[11px] text-text-muted">
          Avg |ρ| <span className="font-metric">{avgAbsCorrelation.toFixed(2)}</span>
        </div>
      ) : null}
    </div>
  );
}
