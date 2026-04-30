/**
 * Shared chart tokens mirroring DESIGN.md. Recharts' `stroke` / `fill`
 * props don't resolve CSS vars, so we export literal hex values. When the
 * design system accent or neutrals change, update both `src/app/globals.css`
 * and this file — one synchronization point instead of N chart files.
 */

export const CHART_ACCENT = "#1B6B5A";
export const CHART_TEXT_SECONDARY = "#4A5568";
export const CHART_TEXT_MUTED = "#94A3B8";
export const CHART_BORDER = "#E2E8F0";
// Chart canvas background — mirrors --color-surface in globals.css.
export const CHART_SURFACE = "#FFFFFF";
// Gridline / track color — mirrors --color-track in globals.css. Used for
// lightweight-charts grid lines (vertLines / horzLines) and any other
// hairline neutral rail where it must read as separation, not a border.
export const CHART_TRACK = "#F1F5F9";
// Slightly darker slate than CHART_TEXT_MUTED, used specifically for Recharts axis ticks.
export const CHART_AXIS_TICK = "#64748B";
export const CHART_FONT_MONO = "var(--font-mono), monospace";
export const CHART_REFERENCE_DASH = "3 3";

/** Diverging positive/negative color tokens — mirror --color-positive / --color-negative in globals.css. */
export const CHART_POSITIVE = "#15803D"; // = --color-positive (PR #103 shifted to AA-pass green-700)
export const CHART_NEGATIVE = "#DC2626"; // = --color-negative
export const CHART_NEUTRAL = "#FFFFFF"; // neutral / zero cell

/**
 * Diverging heatmap ramp — anchored at 0, 4 steps each side. Mirrors the
 * MonthlyHeatmap.tsx baked-tint pairs: each (bg, text) clears WCAG AA 4.5:1
 * vs the white surface beneath. Tints are baked into the hex (no container
 * opacity) because container `opacity` alpha-blends BOTH the foreground
 * text and the background, collapsing contrast to ~1:1 for the lighter
 * steps — a regression caught by axe with 138 violations on the 365d
 * fixture (PR #108 review).
 *
 * Steps map to value buckets:
 *   POSITIVE_700/800 → ≥ 0.05 / ≥ 0.10  (saturated greens, white text)
 *   POSITIVE_100/300 → > 0.00 / > 0.02  (light greens, dark-green text)
 *   NEGATIVE_100/300 → > -0.02 / > -0.05 (light reds, dark-red text)
 *   NEGATIVE_700/800 → > -0.10 / ≤ -0.10 (saturated reds, white text)
 */
export const CHART_POSITIVE_100 = "#DCFCE7";
export const CHART_POSITIVE_300 = "#86EFAC";
export const CHART_POSITIVE_700 = "#15803D";
export const CHART_POSITIVE_800 = "#166534";
export const CHART_NEGATIVE_100 = "#FEE2E2";
export const CHART_NEGATIVE_300 = "#FCA5A5";
export const CHART_NEGATIVE_700 = "#B91C1C";
export const CHART_NEGATIVE_800 = "#991B1B";
export const CHART_TEXT_ON_LIGHT_POSITIVE = "#0F3D2D";
export const CHART_TEXT_ON_LIGHT_NEGATIVE = "#7F1D1D";

/** Shared Recharts Tooltip contentStyle — identical across all chart widgets. */
export const CHART_TOOLTIP_STYLE = {
  fontSize: 12,
  fontFamily: CHART_FONT_MONO,
  borderColor: CHART_BORDER,
  borderRadius: 6,
} as const;

/**
 * Recharts <text> SVG elements don't inherit font-variant-numeric from a
 * parent CSS class. Spread this object directly on <XAxis tick={...}> /
 * <YAxis tick={...}> so chart axis ticks render in tabular-nums.
 *
 * fontSize: 12 matches the v2 caption tier (DESIGN.md 12px caption) —
 * well within WCAG AA at #64748B on #FFFFFF (4.85:1).
 */
export const CHART_TICK_STYLE = {
  fontFamily: CHART_FONT_MONO,
  fontSize: 12,
  fontVariantNumeric: "tabular-nums",
  fill: CHART_AXIS_TICK,
} as const;
