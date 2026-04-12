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
// Slightly darker slate than CHART_TEXT_MUTED, used specifically for Recharts axis ticks.
export const CHART_AXIS_TICK = "#64748B";
export const CHART_FONT_MONO = "var(--font-mono), monospace";
export const CHART_REFERENCE_DASH = "3 3";

/** Shared Recharts Tooltip contentStyle — identical across all Sprint 3 widgets. */
export const CHART_TOOLTIP_STYLE = {
  fontSize: 12,
  fontFamily: CHART_FONT_MONO,
  borderColor: CHART_BORDER,
  borderRadius: 6,
} as const;
