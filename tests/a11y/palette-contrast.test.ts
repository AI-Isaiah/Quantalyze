import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Phase 49 / DS-05 — WCAG-AA palette contrast (the evolved, unchanged-this-phase
 * palette).
 *
 * Asserts every COMPOSED foreground/background pair in the app shell meets WCAG
 * 2.0 AA (>= 4.5:1 for normal-weight text; >= 3:1 for the non-text focus
 * indicator, SC 1.4.11), with the CONTEXT-called-out "dark sidebar over light
 * surfaces" case (#0F172A shell + its muted/active text tokens) asserted
 * explicitly.
 *
 * Composition rule (resolves RESEARCH open-question A5, verified against
 * src/components/layout/Sidebar.tsx): the cartesian pair `--color-sidebar-text`
 * #94A3B8 on `--color-sidebar-active` #334155 computes to 4.04:1 (below AA) —
 * BUT it NEVER renders. The active nav row always switches its text to
 * `--color-sidebar-text-active` #FFFFFF (#FFFFFF on #334155 = 10.35:1). Muted
 * #94A3B8 only ever sits on `bg-sidebar` (#0F172A, 6.96:1) or `bg-sidebar-hover`
 * (#1E293B, 5.71:1). So there is NO live AA defect today. This test therefore
 * asserts only the four COMPOSED sidebar pairs and DELIBERATELY does NOT assert
 * the never-rendered #94A3B8-on-#334155 — asserting it would manufacture a false
 * failure. A guard `it` below pins that the non-composition stays sub-AA so a
 * future refactor that puts muted text on the active bg trips this suite.
 *
 * The luminance trio is a 12-line hand-roll copied VERBATIM from
 * tests/a11y/chart-contrast.test.ts (also duplicated in wizard-contrast.test.ts)
 * per the repo's "Don't Hand-Roll → except this one helper" decision — `polished`
 * / `wcag-contrast` would add a dependency for one test.
 */

function srgbToLinear(channel: number): number {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function relativeLuminance(hex: string): number {
  const cleaned = hex.replace("#", "");
  const r = parseInt(cleaned.slice(0, 2), 16);
  const g = parseInt(cleaned.slice(2, 4), 16);
  const b = parseInt(cleaned.slice(4, 6), 16);
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

function getContrastRatio(fg: string, bg: string): number {
  const lFg = relativeLuminance(fg);
  const lBg = relativeLuminance(bg);
  const lighter = Math.max(lFg, lBg);
  const darker = Math.min(lFg, lBg);
  return (lighter + 0.05) / (darker + 0.05);
}

// --- Resolved background context constants (one source-of-truth per surface) ---
const PAGE_BG = "#F8F9FA"; // --color-page
const SURFACE = "#FFFFFF"; // --color-surface
// Sidebar shell (dark) + its row backgrounds.
const SIDEBAR = "#0F172A"; // --color-sidebar
const SIDEBAR_HOVER = "#1E293B"; // --color-sidebar-hover
const SIDEBAR_ACTIVE = "#334155"; // --color-sidebar-active
// Sidebar text tokens.
const SIDEBAR_TEXT = "#94A3B8"; // --color-sidebar-text (muted)
const SIDEBAR_TEXT_ACTIVE = "#FFFFFF"; // --color-sidebar-text-active
// Body / accent / semantic tokens.
const ACCENT = "#1B6B5A"; // --color-accent (+ --color-border-focus)
// resolved bg-warning/5 over #FFFFFF (matches chart-contrast.test.ts / wizard).
const WARNING_BG_5 = "#FEF1E5";

// Composed (fg, bg, minRatio) pairs — every pair below is an actual rendered
// combination. Sidebar pairs labeled as the dark-sidebar-over-light-surfaces
// case the CONTEXT calls out.
const PAIRS: ReadonlyArray<readonly [string, string, string, number]> = [
  // --- Sidebar: dark shell over light surfaces (composed pairs only) ---
  ["sidebar muted text #94A3B8 on sidebar #0F172A (dark sidebar over light surfaces — composed)", SIDEBAR_TEXT, SIDEBAR, 4.5],
  ["sidebar muted text #94A3B8 on hover-row #1E293B (dark sidebar over light surfaces — composed)", SIDEBAR_TEXT, SIDEBAR_HOVER, 4.5],
  ["sidebar active text #FFFFFF on sidebar #0F172A (dark sidebar over light surfaces — composed)", SIDEBAR_TEXT_ACTIVE, SIDEBAR, 4.5],
  ["sidebar active text #FFFFFF on active-row #334155 (dark sidebar over light surfaces — composed)", SIDEBAR_TEXT_ACTIVE, SIDEBAR_ACTIVE, 4.5],

  // --- Body text on light surfaces (regression pins) ---
  ["text-primary #1A1A2E on page #F8F9FA", "#1A1A2E", PAGE_BG, 4.5],
  ["text-primary #1A1A2E on surface #FFFFFF", "#1A1A2E", SURFACE, 4.5],
  ["text-secondary #4A5568 on page #F8F9FA", "#4A5568", PAGE_BG, 4.5],
  ["text-secondary #4A5568 on surface #FFFFFF", "#4A5568", SURFACE, 4.5],
  ["text-muted #64748B on page #F8F9FA", "#64748B", PAGE_BG, 4.5],
  ["text-muted #64748B on surface #FFFFFF", "#64748B", SURFACE, 4.5],

  // --- Accent + reversed accent ---
  ["accent #1B6B5A on surface #FFFFFF", ACCENT, SURFACE, 4.5],
  ["accent #1B6B5A on page #F8F9FA", ACCENT, PAGE_BG, 4.5],
  ["white text on accent fill #1B6B5A", "#FFFFFF", ACCENT, 4.5],

  // --- Semantics on their backgrounds ---
  ["positive #15803D on surface #FFFFFF", "#15803D", SURFACE, 4.5],
  ["positive #15803D on page #F8F9FA", "#15803D", PAGE_BG, 4.5],
  ["negative #DC2626 on surface #FFFFFF", "#DC2626", SURFACE, 4.5],
  ["negative #DC2626 on page #F8F9FA", "#DC2626", PAGE_BG, 4.5],
  ["warning #B45309 on surface #FFFFFF", "#B45309", SURFACE, 4.5],
  ["warning #B45309 on page #F8F9FA", "#B45309", PAGE_BG, 4.5],
  ["warning #B45309 on bg-warning/5 #FEF1E5", "#B45309", WARNING_BG_5, 4.5],
];

// Non-text >= 3:1 (SC 1.4.11). The focus indicator must be perceivable; the
// hairline `--color-border` #E2E8F0 divider is exempt (purely decorative).
const NON_TEXT_PAIRS: ReadonlyArray<readonly [string, string, string, number]> = [
  ["border-focus #1B6B5A focus ring on surface #FFFFFF", ACCENT, SURFACE, 3],
];

describe("palette WCAG-AA contrast (DS-05)", () => {
  it.each(PAIRS)(
    "%s meets WCAG AA (>= %d:1)",
    (_label, fg, bg, ratio) => {
      expect(getContrastRatio(fg, bg)).toBeGreaterThanOrEqual(ratio);
    },
  );

  it.each(NON_TEXT_PAIRS)(
    "%s meets non-text contrast (>= %d:1, SC 1.4.11)",
    (_label, fg, bg, ratio) => {
      expect(getContrastRatio(fg, bg)).toBeGreaterThanOrEqual(ratio);
    },
  );

  // Guard: the ONLY sub-AA cartesian sidebar pair (#94A3B8 muted text on the
  // active-row bg #334155 = 4.04:1) is NEVER composed — Sidebar.tsx switches the
  // active row's text to #FFFFFF. We assert it stays sub-AA so that a future
  // refactor which DID compose muted-on-active (re-introducing the defect) would
  // flip this expectation and fail the suite, forcing a token shift rather than a
  // silent AA regression. This pair is intentionally absent from PAIRS above.
  it("documents that muted #94A3B8 on active-row #334155 is never composed (would be sub-AA)", () => {
    expect(getContrastRatio(SIDEBAR_TEXT, SIDEBAR_ACTIVE)).toBeLessThan(4.5);
  });

  // Literal pins: the contrast math above passes for ANY color that clears the
  // threshold, so an AA-passing-but-WRONG swap (e.g. accent → a different green
  // that still clears 4.5) would not fail the suite. Pin the exact tokens we
  // actually ship against globals.css so a wrong swap still breaks CI.
  it("globals.css pins the exact palette literals the math passes for", () => {
    const css = readFileSync(resolve(process.cwd(), "src/app/globals.css"), "utf-8");
    expect(css).toMatch(/--color-accent:\s*#1B6B5A/);
    expect(css).toMatch(/--color-sidebar:\s*#0F172A/);
    expect(css).toMatch(/--color-sidebar-text:\s*#94A3B8/);
    expect(css).toMatch(/--color-sidebar-active:\s*#334155/);
    expect(css).toMatch(/--color-warning:\s*#B45309/);
    expect(css).toMatch(/--color-positive:\s*#15803D/);
    expect(css).toMatch(/--color-negative:\s*#DC2626/);
  });
});
