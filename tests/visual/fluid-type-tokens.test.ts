import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Phase 49 / DS-02 — fluid type clamp guard.
 *
 * Greps every `--text-*: clamp(...)` declaration out of `src/app/globals.css`
 * and pins two hard invariants on each (49-RESEARCH Pattern 2):
 *   (1) the clamp args carry a `rem` term — WCAG 1.4.4 / W3C F94 zoom-safety
 *       (a px-only clamp does not re-scale on text zoom);
 *   (2) max rem <= 2.5 * min rem — guarantees the tier still grows enough to
 *       reach 200% at the zoom ceiling.
 *
 * Mirrors the grep-over-source precedent in
 * `tests/visual/strategy-v2-type-scale.test.ts` and the globals.css regex-pin
 * idiom in `tests/a11y/chart-contrast.test.ts` — no extra deps, hand-rolled.
 *
 * Wave-0 (49-01) state: this test is intentionally RED. No `--text-*` clamp
 * tokens exist in globals.css yet, so the "at least the 8 named tiers"
 * assertion fails. It goes GREEN when 49-02 (Wave 1) adds the plain
 * `@theme {--text-*}` block.
 */

const css = readFileSync(
  resolve(process.cwd(), "src/app/globals.css"),
  "utf8",
);

const TEXT_TOKENS = [
  ...css.matchAll(/--text-[\w-]+:\s*clamp\(([^;]+)\);/g),
];

/**
 * Split a clamp argument list into its top-level comma-separated terms,
 * respecting nested parens (e.g. `calc(...)`, `min(...)`, `max(...)`). Ported
 * verbatim from `tools/eslint-plugin-quantalyze/rules/no-rem-less-clamp.mjs`
 * so the Vitest grep guard and the edit-time ESLint rule share ONE definition
 * of "rem-safe" — a naive `.split(',')` would mis-split a `min()`/`max()` term
 * that legitimately contains its own top-level commas.
 *
 * @param {string} argText  the text BETWEEN the outermost clamp parens
 * @returns {string[]}
 */
function splitTopLevelArgs(argText: string): string[] {
  const args: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of argText) {
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      args.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  args.push(current);
  return args;
}

// A CSS length carrying rem/em (the zoom-safe anchor); `\d` guards against a
// stray "rem" in prose. Mirrors REM_EM in no-rem-less-clamp.mjs.
const REM_EM = /[\d.]+\s*r?em\b/;

describe("fluid type clamp guard (DS-02)", () => {
  it("declares at least the 8 named tiers", () => {
    expect(TEXT_TOKENS.length).toBeGreaterThanOrEqual(8);
  });

  it.each(TEXT_TOKENS.map((m) => [m[0], m[1]] as const))(
    "%s preferred (middle) term has a rem term (zoom-safe, WCAG 1.4.4)",
    (_decl, args) => {
      // The MIDDLE (preferred) term is the load-bearing one. A clamp like
      // `clamp(2rem, 3vw, 4rem)` carries `rem` in its bounds yet a `vw`-only
      // preferred term — that NEVER re-scales under text zoom (the viewport
      // doesn't change when you zoom), so it fails WCAG 1.4.4 / W3C F94 while
      // a blunt "rem appears anywhere in the string" check waves it through.
      // Split on TOP-LEVEL commas (respecting nested min()/max()/calc()) and
      // assert args[1] — the preferred term — carries a rem/em length.
      const terms = splitTopLevelArgs(args);
      expect(terms.length).toBe(3);
      expect(REM_EM.test(terms[1])).toBe(true);
    },
  );

  it.each(TEXT_TOKENS.map((m) => [m[0], m[1]] as const))(
    "%s max <= 2.5x min (guarantees 200% zoom)",
    (_decl, args) => {
      const rems = [...args.matchAll(/([\d.]+)rem/g)].map((x) =>
        parseFloat(x[1]),
      );
      expect(rems.length).toBeGreaterThan(0);
      expect(Math.max(...rems)).toBeLessThanOrEqual(2.5 * Math.min(...rems));
    },
  );
});
