/**
 * Centralised palette resolver for the factsheet view. Combines light/dark
 * mode with optional colorblind override. Single source of truth so the next
 * palette change is one file, not five.
 *
 * Consumers:
 *   - FactsheetShell injects the entire result into the article container
 *     as CSS custom properties (--color-* tokens).
 *   - HeatmapPanels reads the resolved (base, accent, negative) trio for
 *     SVG fill mixing (which can't read CSS vars at compute time).
 *   - DistributionPanels / SignaturePanels read tones for inline rect/path
 *     fills where var() isn't supported by all serializers (export to PNG).
 */

export type PaletteMode = {
  darkMode: boolean;
  colorblind: boolean;
};

export type ResolvedPalette = {
  /** Surface base (white in light, slate in dark) — used as the heatmap "0 return" cell. */
  base: string;
  surface: string;
  surfaceSubtle: string;
  border: string;
  textPrimary: string;
  text2: string;
  textMuted: string;
  accent: string;
  accentHover: string;
  positive: string;
  negative: string;
  warning: string;
  page: string;
};

/* Default tokens — light mode without colorblind. Aligned with DESIGN.md. */
const LIGHT: ResolvedPalette = {
  base: "#FFFFFF",
  surface: "#FFFFFF",
  surfaceSubtle: "#FBFCFD",
  border: "#E2E8F0",
  textPrimary: "#1A1A2E",
  text2: "#4A5568",
  textMuted: "#64748B",
  accent: "#1B6B5A",
  accentHover: "#155A4B",
  positive: "#15803D",
  negative: "#DC2626",
  warning: "#B45309",
  page: "#F8F9FA",
};

/**
 * Institutional dark palette — Stripe Dashboard / Bloomberg Terminal cues.
 *
 * Page (#0B0F1A) → Surface (#141A26) → Surface-subtle (#191F2E) is a
 * 3-step elevation ladder. Each step is ~2.5% lightness brighter so cards
 * read as raised against the page without harsh contrast borders. None of
 * the surfaces touch pure black — pure black on OLED produces halation
 * around white text. Backgrounds keep a slight blue tint (matches the
 * existing institutional sidebar #0F172A in DESIGN.md).
 *
 * Text scale — all three tiers clear WCAG AAA (≥7:1) on every elevation:
 *   - textPrimary  #E6EAF2 → 14.5:1 vs surface (off-white, not pure white,
 *                            to soften OLED halation around glyph edges)
 *   - text2        #BAC2D8 →  9.8:1 vs surface (secondary body, column heads)
 *   - textMuted    #A0AAC2 →  7.5:1 vs surface (axis labels, micro-meta,
 *                            uppercase eyebrows — AAA even at 9-10px)
 *
 * Hierarchy is preserved: each tier is ~30% darker than the one above,
 * so the visual order primary > text-2 > muted reads at a glance.
 *
 * Pre-2026-05-20 the muted tier was #7783A0 (4.6:1, WCAG AA only). On
 * data-dense factsheets where every label is small-uppercase-tracked,
 * AA was too dim — users complained that KPI labels felt mushy. The new
 * 7.5:1 floor matches Stripe Dashboard's secondary-text contrast.
 *
 * Chart colors brightened so they actually pop:
 *   - Accent   #5EEAD4 (11.8:1): bright teal, distinguishable from blue surface
 *   - Positive #4ADE80 (10.0:1): vibrant lime — not muted #10B981 which fades
 *   - Negative #F87171 ( 6.3:1): clear red without strobing (red has lower
 *                                inherent luminance; AA-large is the practical
 *                                ceiling without going pink)
 *   - Warning  #FBBF24 (10.4:1): amber that doesn't compete with positive
 *
 * Perceived brightness across pos/neg is intentionally near-matched
 * (luminance ~58/57) so neither side dominates a multi-strategy plot.
 */
const DARK: ResolvedPalette = {
  base: "#141A26",
  surface: "#141A26",
  surfaceSubtle: "#191F2E",
  border: "#2A3144",
  textPrimary: "#E6EAF2",
  text2: "#BAC2D8",
  textMuted: "#A0AAC2",
  accent: "#5EEAD4",
  accentHover: "#99F6E4",
  positive: "#4ADE80",
  negative: "#F87171",
  warning: "#FBBF24",
  page: "#0B0F1A",
};

const COLORBLIND_LIGHT = {
  accent: "#002554",
  positive: "#002554",
  negative: "#990019",
};

const COLORBLIND_DARK = {
  accent: "#4A8FCC",
  positive: "#4A8FCC",
  negative: "#E26A77",
};

export function resolvePalette(mode: PaletteMode): ResolvedPalette {
  const base = mode.darkMode ? DARK : LIGHT;
  if (!mode.colorblind) return base;
  return {
    ...base,
    ...(mode.darkMode ? COLORBLIND_DARK : COLORBLIND_LIGHT),
  };
}

/**
 * Build the inline-style CSS custom properties for the article container.
 * `colorScheme` is set so the browser swaps native form-control colors.
 */
export function paletteToCssVars(p: ResolvedPalette, darkMode: boolean): React.CSSProperties {
  return {
    ["--color-page" as string]: p.page,
    ["--color-surface" as string]: p.surface,
    ["--color-surface-subtle" as string]: p.surfaceSubtle,
    ["--color-text-primary" as string]: p.textPrimary,
    ["--color-text-2" as string]: p.text2,
    ["--color-text-muted" as string]: p.textMuted,
    ["--color-border" as string]: p.border,
    ["--color-text" as string]: darkMode ? "#475569" : "#1A1A2E",
    ["--color-track" as string]: darkMode ? "#1E293B" : "#F1F5F9",
    ["--color-accent" as string]: p.accent,
    ["--color-accent-hover" as string]: p.accentHover,
    ["--color-positive" as string]: p.positive,
    ["--color-negative" as string]: p.negative,
    ["--color-warning" as string]: p.warning,
    colorScheme: darkMode ? "dark" : "light",
    color: p.textPrimary,
  };
}
