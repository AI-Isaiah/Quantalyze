/**
 * Centralised palette resolver for the factsheet view. Light palette with an
 * optional colorblind override (dark mode was removed, Phase 195 D-06; DESIGN.md
 * "Dark mode: Not planned"). Single source of truth so the next palette change
 * is one file, not five.
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
  colorblind: boolean;
};

export type ResolvedPalette = {
  /** Surface base (white) — used as the heatmap "0 return" cell. */
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

/* Default tokens — without colorblind. Aligned with DESIGN.md. */
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

const COLORBLIND_LIGHT = {
  accent: "#002554",
  positive: "#002554",
  negative: "#990019",
};

export function resolvePalette(mode: PaletteMode): ResolvedPalette {
  if (!mode.colorblind) return LIGHT;
  return { ...LIGHT, ...COLORBLIND_LIGHT };
}

/**
 * Build the inline-style CSS custom properties for the article container.
 * `colorScheme` is pinned to light so the browser keeps native form-control colors light.
 */
export function paletteToCssVars(p: ResolvedPalette): React.CSSProperties {
  return {
    ["--color-page" as string]: p.page,
    ["--color-surface" as string]: p.surface,
    ["--color-surface-subtle" as string]: p.surfaceSubtle,
    ["--color-text-primary" as string]: p.textPrimary,
    ["--color-text-2" as string]: p.text2,
    ["--color-text-muted" as string]: p.textMuted,
    ["--color-border" as string]: p.border,
    ["--color-text" as string]: "#1A1A2E",
    ["--color-track" as string]: "#F1F5F9",
    ["--color-accent" as string]: p.accent,
    ["--color-accent-hover" as string]: p.accentHover,
    ["--color-positive" as string]: p.positive,
    ["--color-negative" as string]: p.negative,
    ["--color-warning" as string]: p.warning,
    colorScheme: "light",
    color: p.textPrimary,
  };
}
