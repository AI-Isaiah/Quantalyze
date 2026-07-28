# Phase 49: Design-System Refresh + Fluid Token Foundation - Pattern Map

**Mapped:** 2026-06-29
**Files analyzed:** 11 (10 new/modified code+doc artifacts + 1 config wiring)
**Analogs found:** 10 / 11 (the truncation-audit doc + the `.planning/audits/` dir are net-new artifacts with no code analog)

> This phase is "do the existing thing one more time." Every new artifact maps 1:1 onto a concrete in-repo precedent that was read line-by-line. The risk is not a missing library — it is **deviating** from the four established patterns (`tokens as const` + DESIGN.md drift test, hand-rolled AA contrast test, grep guard, plugin backstop rule) or accidentally introducing a dependency / a repo-wide lint. There are **zero new dependencies** in this phase.

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/lib/design-tokens/typography.ts` (NEW) | model (token SoT) | transform (const data) | `src/lib/design-tokens/trust-tier.ts` | exact (sibling dir, same `as const satisfies Record<…>` shape) |
| `src/app/globals.css` — new plain `@theme {--text-*}` block (MODIFY) | config (CSS tokens) | transform (build-time) | the existing `@theme inline {…}` block in the SAME file (lines 3-128) | exact (same file, sibling at-rule) |
| `tests/a11y/type-token-drift.test.ts` (NEW) | test (drift gate) | file-I/O + transform | `tests/a11y/trust-tier-tokens.test.ts` | exact (DESIGN.md-parse + verbatim-assert, extended to 3-way) |
| `tests/visual/globals-clamp-guard.test.ts` (NEW) | test (grep guard) | file-I/O | `tests/visual/strategy-v2-type-scale.test.ts` (grep) + `tests/a11y/chart-contrast.test.ts` (globals.css regex pin) | exact (grep-over-source precedent) |
| `tests/a11y/palette-contrast.test.ts` (NEW) | test (AA gate) | transform (luminance math) | `tests/a11y/chart-contrast.test.ts` + `tests/a11y/wizard-contrast.test.ts` | exact (hand-rolled luminance + PAIRS table) |
| `tools/eslint-plugin-quantalyze/rules/no-raw-font-px.mjs` (NEW) | utility (lint rule) | event-driven (AST visitor) | `tools/eslint-plugin-quantalyze/rules/no-raw-staleness-derivation.mjs` (+ `no-raw-localstorage.mjs`) | exact (same `meta`/`fileHasMarker`/`messages`/visitor template) |
| `tools/eslint-plugin-quantalyze/rules/no-rem-less-clamp.mjs` (NEW) | utility (lint rule) | event-driven (AST visitor) | `no-raw-staleness-derivation.mjs` | exact (string/template-literal visitor, scoped per Pitfall 3) |
| `tools/eslint-plugin-quantalyze/tests/no-raw-font-px.test.ts` (NEW) | test (RuleTester) | event-driven | `tools/eslint-plugin-quantalyze/tests/no-raw-staleness-derivation.test.ts` | exact (RuleTester harness) |
| `tools/eslint-plugin-quantalyze/tests/no-rem-less-clamp.test.ts` (NEW) | test (RuleTester) | event-driven | `tools/eslint-plugin-quantalyze/tests/no-raw-staleness-derivation.test.ts` | exact |
| `tools/eslint-plugin-quantalyze/index.mjs` + `eslint.config.mjs` (MODIFY) | config (rule wiring + allow-list) | — | the existing register-block (`index.mjs`) + `eslint.config.mjs` `files:[…]` overrides | exact (same registration + glob-override idiom) |
| `DESIGN.md` — fluid-type-spine section + Decisions Log row (MODIFY) | config (SoT prose) | — | DESIGN.md `## Typography` (lines 17-31) + Decisions Log table (the 2026-05-06 `--color-*` row is the closest precedent) | exact (in-place edit + append-row convention) |
| `.planning/audits/truncation-audit.md` (NEW) | doc | — | — (net-new artifact; dir does not yet exist) | **no analog** |

---

## Pattern Assignments

### `src/lib/design-tokens/typography.ts` (model, transform)

**Analog:** `src/lib/design-tokens/trust-tier.ts`

**Header-comment + framework-neutral convention** (`trust-tier.ts` lines 1-17) — copy this doc-comment shape: it (a) states the SoT role, (b) declares framework-neutral / no-React so the file loads in the Vitest node context, (c) names the drift test that pins it. This is **load-bearing** — the drift test imports this module directly:
```ts
/**
 * Phase 49 / DS-02·DS-03 — Fluid type-scale design tokens.
 *
 * Single source-of-truth for the named fluid (clamp-based) type tiers.
 * Framework-neutral (no React import) so this file loads cleanly from
 * Vitest tests, server components, and any future Storybook.
 *
 * Consistency with DESIGN.md AND globals.css @theme is asserted by
 * `tests/a11y/type-token-drift.test.ts` — every `clamp(...)` below MUST
 * appear verbatim in the plain @theme block of globals.css and every
 * px endpoint in DESIGN.md §Typography, or that test fails on CI.
 */
```

**Core `as const satisfies Record<…>` shape** (`trust-tier.ts` lines 34-60) — mirror the interface + `as const satisfies Record<…>` exactly:
```ts
// Source: src/lib/design-tokens/trust-tier.ts (existing as-const + drift-tested pattern)
export interface TrustTierTokenSlot {
  readonly fill: string;
  readonly text: string;
  readonly border: string;
  readonly label: string;
}

export const TRUST_TIER_TOKENS = {
  api_verified: { fill: "#1B6B5A", text: "#FFFFFF", border: "#1B6B5A", label: "API verified" },
  // …
} as const satisfies Record<TrustTier, TrustTierTokenSlot>;
```

**New file's target shape** (per RESEARCH Pattern 2 + Code Examples) — a `TypeTier` interface with `{ minPx, maxPx, clamp }`, the named tiers from DESIGN.md §Typography (hero / page-title / h2 / h3 / body / small / caption / micro), the `as const satisfies Record<string, TypeTier>`, **plus** the optional pure `buildClamp({minPx,maxPx,minVw,maxVw})` helper (RESEARCH says: derive once, but check in the static strings — the emitted CSS/`clamp` field must be a literal string the drift test reads verbatim):
```ts
export interface TypeTier { readonly minPx: number; readonly maxPx: number; readonly clamp: string; }
export const TYPE_SCALE = {
  hero:         { minPx: 32, maxPx: 48, clamp: "clamp(2rem, 1.5rem + 2.5vw, 3rem)" },
  "page-title": { minPx: 24, maxPx: 32, clamp: "clamp(1.5rem, 1.2rem + 1.5vw, 2rem)" },
  // … h2, h3, body, small, caption, micro — each clamp string MUST match globals.css verbatim
} as const satisfies Record<string, TypeTier>;
```
> px endpoints come from DESIGN.md §Typography (lines 24-31): Hero 48/32 · H2 24 · H3 16 · Body 14 · Small 13 · Caption 12 · Micro 10-11. Hard invariants (Pattern 2): every `clamp` has a `rem` middle term; `maxPx ≤ 2.5 × minPx`.

---

### `src/app/globals.css` — new plain `@theme {--text-*}` block (config, transform)

**Analog:** the existing `@theme inline {…}` block in the SAME file (lines 3-128).

**Critical distinction (the whole point of the phase):** the existing block opens with `@theme inline` at **line 3**. The fluid tokens MUST go in a **sibling plain `@theme {…}` block** (no `inline`), NOT appended into the inline block. `@theme inline` bakes the literal into each utility and flattens the `var()` chain (defeats clamp re-evaluation on zoom → WCAG 1.4.4 fail). Plain `@theme` emits `text-hero { font-size: var(--text-hero) }` (a live var).

**Existing inline block to leave byte-stable** (`globals.css` lines 3-12, 42-64, 112) — do NOT move colors, do NOT touch `--space-grid-gap: 10px`:
```css
@theme inline {
  --color-page: #F8F9FA;
  --color-surface: #FFFFFF;
  --color-sidebar: #0F172A;
  /* … all colors stay here, unchanged … */
  --space-grid-gap: 10px;   /* designer-bundle port — byte-stable, do NOT touch */
}
```

**New sibling block to add** (RESEARCH Pattern 1 target shape):
```css
@theme {
  /* Phase 49 / DS-02 — fluid type spine. PLAIN @theme (no `inline`) so
     text-* utilities keep var(--text-*) and the clamp() re-evaluates on
     zoom (WCAG 1.4.4). Tier→px maps DESIGN.md §Typography 1:1. */
  --text-hero:       clamp(2rem,   1.5rem  + 2.5vw, 3rem);
  --text-page-title: clamp(1.5rem, 1.2rem  + 1.5vw, 2rem);
  --text-h2:         clamp(1.25rem,1.1rem  + 0.75vw, 1.5rem);
  /* … h3, body, small, caption, micro — strings MUST match TYPE_SCALE[tier].clamp verbatim */
}
```
> **Pitfall 2 (name collisions):** Tailwind v4 ships default `--text-sm/base/lg/xl/2xl`. Tier names hero/page-title/h2/h3/body/small/caption/micro are safe (don't collide with `sm/base/lg/xl/2xl`). Verify once at build time that emitted CSS shows `var(--text-hero)`, not a baked clamp literal (A3).

---

### `tests/a11y/type-token-drift.test.ts` (test, drift gate)

**Analog:** `tests/a11y/trust-tier-tokens.test.ts`

**Imports + readFileSync convention** (`trust-tier-tokens.test.ts` lines 1-27) — copy verbatim, swap the token import:
```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { TYPE_SCALE } from "@/lib/design-tokens/typography";   // was: TRUST_TIER_TOKENS

const designMd = readFileSync(resolve(__dirname, "../../DESIGN.md"), "utf8");
const css      = readFileSync(resolve(__dirname, "../../src/app/globals.css"), "utf8");
```

**Verbatim-includes assertion idiom** (`trust-tier-tokens.test.ts` lines 35-45) — the atomic drift check; extend it from 1 source to 3:
```ts
describe("DESIGN.md ↔ TRUST_TIER_TOKENS consistency (DESIGN-01)", () => {
  it.each(distinctHexes)("hex %s appears verbatim in DESIGN.md", (hex) => {
    expect(designMd.includes(hex)).toBe(true);
  });
});
```

**Scoped-section drift check** (`trust-tier-tokens.test.ts` lines 47-70) — this is the precedent for the **no-inline guard**. The existing test slices a named section out of DESIGN.md (`indexOf("## Trust-Tier Badges")` → next `\n## ` heading) and asserts what must/mustn't appear inside. Reuse this **brace-balancer** approach for `@theme inline {…}` vs plain `@theme {…}`:
```ts
const start = designMd.indexOf("## Trust-Tier Badges");
const after = designMd.slice(start + "## Trust-Tier Badges".length);
const nextHeading = after.search(/\n## [A-Z]/);
const section = nextHeading === -1 ? after : after.slice(0, nextHeading);
expect(section.includes("#D97706")).toBe(false);   // ← the drift-direction assert
```

**The four assertions the new test must make** (RESEARCH Pattern 4):
1. For each tier: `plainBlock.includes(\`--text-${tier}: ${TYPE_SCALE[tier].clamp}\`)` — CSS ↔ TS verbatim.
2. `inlineBlock.includes(\`--text-${tier}\`) === false` — **no regression into `@theme inline`** (the CONTEXT-called-out guard).
3. The plain block contains every tier (and ≥ 8 tiers exist).
4. Each tier's px endpoints appear in DESIGN.md (`designMd.includes(String(t.minPx))`), mirroring the existing `designMd.includes(hex)` idiom.
> Keep a small in-test `extractBlock(css, /@theme\s+inline\s*\{/)` vs `/@theme\s*\{(?!\s*inline)/` brace-balancer — no parser dep (matches the no-extra-deps ethos of every existing drift test).

---

### `tests/visual/globals-clamp-guard.test.ts` (test, grep guard)

**Analog:** `tests/visual/strategy-v2-type-scale.test.ts` (grep-over-source) + `tests/a11y/chart-contrast.test.ts` lines 110-121 (the `globals.css` regex-pin idiom).

**Grep-over-source structure** (`strategy-v2-type-scale.test.ts` lines 70-82) — the `it`-collects-violations-then-`expect([]).toEqual([])` shape:
```ts
describe("strategy-v2 type-scale lint (DESIGN-02)", () => {
  it("zero forbidden size classes", () => {
    const violations: { file: string; pattern: string }[] = [];
    for (const file of files) {
      const content = readFileSync(file, "utf-8");
      for (const re of FORBIDDEN_SIZES) if (re.test(content)) violations.push({ file, pattern: re.source });
    }
    expect(violations).toEqual([]);
  });
});
```

**globals.css regex-pin idiom** (`chart-contrast.test.ts` lines 110-121) — the precedent for asserting a literal in globals.css:
```ts
const css = readFileSync(resolve(process.cwd(), "src/app/globals.css"), "utf-8");
expect(css).toMatch(/--color-warning:\s*#B45309/);
```

**Target test** (RESEARCH Code Examples — `it.each` over every `--text-*: clamp(...)` match):
```ts
const css = readFileSync(resolve(process.cwd(), "src/app/globals.css"), "utf8");
const TEXT_TOKENS = [...css.matchAll(/--text-[\w-]+:\s*clamp\(([^;]+)\);/g)];

it("declares at least the 8 named tiers", () => {
  expect(TEXT_TOKENS.length).toBeGreaterThanOrEqual(8);
});
it.each(TEXT_TOKENS.map((m) => [m[0], m[1]]))("%s has a rem term (WCAG 1.4.4)", (_d, args) => {
  expect(/\brem\b/.test(args)).toBe(true);
});
it.each(TEXT_TOKENS.map((m) => [m[0], m[1]]))("%s max <= 2.5x min", (_d, args) => {
  const rems = [...args.matchAll(/([\d.]+)rem/g)].map((x) => parseFloat(x[1]));
  expect(Math.max(...rems)).toBeLessThanOrEqual(2.5 * Math.min(...rems));
});
```

---

### `tests/a11y/palette-contrast.test.ts` (test, AA gate)

**Analog:** `tests/a11y/chart-contrast.test.ts` + `tests/a11y/wizard-contrast.test.ts`

**Hand-rolled luminance trio — COPY VERBATIM** (`chart-contrast.test.ts` lines 20-39, identical copy in `wizard-contrast.test.ts` lines 26-49). Do NOT add `polished`/`wcag-contrast` — repo precedent forbids it:
```ts
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
  const lFg = relativeLuminance(fg), lBg = relativeLuminance(bg);
  return (Math.max(lFg, lBg) + 0.05) / (Math.min(lFg, lBg) + 0.05);
}
```

**PAIRS-table + `it.each` idiom** (`wizard-contrast.test.ts` lines 75-194) — the `readonly [label, fg, bg, ratio]` tuple table, resolved-bg constants, and the `it.each(PAIRS)` driver. Reuse this exact shape:
```ts
const PAGE_BG = "#F8F9FA"; // --color-page
const SURFACE = "#FFFFFF"; // --color-surface
const WARNING_BG_5 = "#FEF1E5"; // resolved bg-warning/5 over #FFFFFF

const PAIRS: ReadonlyArray<readonly [string, string, string, number]> = [
  ["accent #1B6B5A on white (broker-card border / focus / link)", "#1B6B5A", SURFACE, 4.5],
  ["stepper inactive-step #64748B on page bg", "#64748B", PAGE_BG, 4.5],
  // …
];

describe("wizard a11y contrast (DESIGN-05)", () => {
  it.each(PAIRS)("%s meets WCAG AA (>= %d:1)", (_label, fg, bg, ratio) => {
    expect(getContrastRatio(fg, bg)).toBeGreaterThanOrEqual(ratio);
  });
  // border-only ≥3:1 block (SC 1.4.11) — second it.each, same shape
});
```

**globals.css literal-pin idiom** (`chart-contrast.test.ts` lines 110-121) — fold in so an "AA-passing-but-wrong" swap still fails:
```ts
expect(css).toMatch(/--color-warning:\s*#B45309/);   // pin the literal the math passes for
```

**Exact pairs to assert** (RESEARCH Pattern 5 — sidebar pairs are the CONTEXT-called-out "dark sidebar over light surfaces" case; values verified from `globals.css` lines 7-11 + `Sidebar.tsx`):
- Sidebar (assert **composed** pairs only — see composition rule below):
  - `#94A3B8` (sidebar-text) on `#0F172A` (sidebar) → 6.96:1 PASS
  - `#94A3B8` on `#1E293B` (sidebar-hover) → 5.71:1 PASS
  - `#FFFFFF` (sidebar-text-active) on `#0F172A` → 17.85:1 PASS
  - `#FFFFFF` on `#334155` (sidebar-active) → 10.35:1 PASS
- **Composition rule (do NOT assert the cartesian non-composition):** `#94A3B8` on `#334155` = 4.04:1 (below AA) but NEVER renders — the active row always switches text to `#FFFFFF`. Asserting it manufactures a false failure. Add a guard comment so a future refactor that composes muted-on-active trips the test.
- Body text: `#1A1A2E` / `#4A5568` / `#64748B` each on `#F8F9FA` and `#FFFFFF` → ≥ 4.5.
- Accent + semantics: `#1B6B5A` on `#FFFFFF`/`#F8F9FA` and `#FFFFFF` on `#1B6B5A` → ≥ 4.5; `#15803D`, `#DC2626`, `#B45309` each on `#FFFFFF`/`#F8F9FA` → ≥ 4.5; `#B45309` on `#FEF1E5` → ≥ 4.5.
- Non-text ≥ 3:1: `#1B6B5A` (border-focus) on surface (focus indicator). `--color-border #E2E8F0` divider is exempt under 1.4.11.
> **Pitfall 4:** a real sub-AA finding → darken/lighten the token + log a DESIGN.md Decisions Log row (like the 2026-04-30 shifts). NEVER lower the `4.5` threshold.

---

### `tools/eslint-plugin-quantalyze/rules/no-raw-font-px.mjs` (utility, AST visitor)

**Analog:** `tools/eslint-plugin-quantalyze/rules/no-raw-staleness-derivation.mjs` (cleanest template) + `no-raw-localstorage.mjs`

**Rule skeleton — copy the `meta`/`fileHasMarker`/`messages`/`create` structure** (`no-raw-staleness-derivation.mjs` lines 32-76):
```js
import { fileHasMarker } from "./_shared.mjs";

const MESSAGE = "…";

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: "problem",
    docs: { description: "…", recommended: true },
    schema: [],
    messages: { raw: MESSAGE },
  },
  create(context) {
    const sourceCode = context.sourceCode ?? context.getSourceCode();
    if (fileHasMarker(sourceCode, ["B14 sanctioned-exception:"])) return {};   // ← swap marker → "DS-04 sanctioned-exception:"
    return {
      BinaryExpression(node) { /* … */ },   // ← swap visitor → Literal / TemplateElement
    };
  },
};
```

**String/template visitor + early-return** (RESEARCH Code Examples — the target rule fires on `text-[NNpx]` in class strings and `fontSize: 'NNpx'` in style objects, over `Literal`/`TemplateElement` content, with the `fileHasMarker(["DS-04 sanctioned-exception:"])` escape):
```js
const FONT_PX = /\btext-\[\d+px\]/;            // text-[14px]
const STYLE_FONT_PX = /fontSize\s*:\s*["']\d+px/;
// …
return {
  Literal(n) { if (typeof n.value === "string") check(n, n.value); },
  TemplateElement(n) { check(n, n.value.raw); },
};
```
> `_shared.mjs` already provides `fileHasMarker(sourceCode, markers)` (lines 22-26) — reuse it, do NOT build a new allow-list mechanism.

---

### `tools/eslint-plugin-quantalyze/rules/no-rem-less-clamp.mjs` (utility, AST visitor)

**Analog:** `no-raw-staleness-derivation.mjs`

Same skeleton as `no-raw-font-px.mjs`. **Pitfall 3 (critical scope):** fire ONLY on `clamp(` text inside **string/template-literal contexts** (className/style), where the args contain `vw` but no `rem`/`em`. Do NOT visit `CallExpression` — that would false-positive on the numeric `Math`-style `clamp(...)` helpers in `scenario-montecarlo.ts` / `peer-cohort.ts` (FROZEN-adjacent math, not CSS). The CSS-side `--text-*` in `globals.css` is covered by the Vitest grep, not this rule.

---

### `tools/eslint-plugin-quantalyze/tests/{no-raw-font-px,no-rem-less-clamp}.test.ts` (test, RuleTester)

**Analog:** `tools/eslint-plugin-quantalyze/tests/no-raw-staleness-derivation.test.ts`

**RuleTester harness — copy verbatim** (lines 1-14), swap the rule import + cases:
```ts
import { afterAll, describe, it } from "vitest";
import { RuleTester } from "eslint";
import rule from "../rules/no-raw-staleness-derivation.mjs";   // ← swap to ../rules/no-raw-font-px.mjs

RuleTester.afterAll = afterAll;
RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const ruleTester = new RuleTester({
  languageOptions: { ecmaVersion: 2024, sourceType: "module" },
});

ruleTester.run("no-raw-staleness-derivation", rule, {
  valid: [ /* … incl. a `// DS-04 sanctioned-exception:` case */ ],
  invalid: [ { code: "…", errors: [{ messageId: "raw" }] } ],
});
```
> Include the `valid` sanctioned-exception case (lines 28-31 of the analog show the `// B14 sanctioned-exception:` valid case) AND — for `no-rem-less-clamp` — a `valid` case proving a numeric `clamp(a, b, c)` CallExpression is NOT flagged (Pitfall 3 regression pin).

---

### `tools/eslint-plugin-quantalyze/index.mjs` + `eslint.config.mjs` (config, rule wiring + allow-list)

**Analog:** the existing register-block in `index.mjs` (lines 17-32) + the `eslint.config.mjs` rule/override blocks (lines 41-90).

**Register in `index.mjs`** (lines 17-31) — import + add to `rules`:
```js
import noRawStalenessDerivation from "./rules/no-raw-staleness-derivation.mjs";
// + import noRawFontPx from "./rules/no-raw-font-px.mjs";  + no-rem-less-clamp
const plugin = {
  meta: { name: "eslint-plugin-quantalyze", version: "0.1.0" },
  rules: {
    "no-raw-staleness-derivation": noRawStalenessDerivation,
    // + "no-raw-font-px": noRawFontPx, "no-rem-less-clamp": noRemLessClamp
  },
};
```

**Wire + allow-list in `eslint.config.mjs`** — two layers, both already idiomatic here:
1. **Activate** in the `files: ["src/**/*.{ts,tsx}"]` plugin block (lines 41-59).
2. **Directory/file-glob overrides** turning the rule `off` — exact precedent: `no-raw-localstorage` is `off` for `src/lib/storage/**` (lines 63-66) and all rules `off` for `*.{test,spec}.*` (lines 81-90). For DS-04, add `off` overrides for `src/components/charts/**` + the designer-bundle ports (CONTEXT allow-list).
```js
{ files: ["src/lib/storage/**"], rules: { "quantalyze/no-raw-localstorage": "off" } },
{ files: ["src/**/*.{test,spec}.{ts,tsx}"], rules: { /* all quantalyze rules off */ } },
```
> **Pitfall 5 / A4 (scope, NOT big-bang):** baseline is DIRTY — recon found **558 `text-[NNpx]` + 355 hex sites / 54 files**. Existing plugin rules are repo-wide `error` because their baseline was clean; these two are NOT. Start scoped: `error` on new token/primitive dirs, `warn` or narrow-glob elsewhere. A repo-wide `error` red-CIs everything and forces the deferred strangler migration into Phase 49. This is the **one item that may need a planner/user call** (A4).

---

### `DESIGN.md` — fluid-type-spine section + Decisions Log row (config, SoT prose)

**Analog:** DESIGN.md `## Typography` (lines 17-31) for the type-scale prose + the Decisions Log table (the **2026-05-06 `--color-*` token convention row** is the closest precedent for a token-mechanism decision).

**Existing scale to evolve in place** (DESIGN.md lines 24-31) — the named tiers + px the new fluid tokens must mirror 1:1:
```
- **Scale:**
  - Hero: 48px (landing), 32px (page titles)
  - H2: 24px      - H3: 16px (semibold)
  - Body: 14px    - Small: 13px
  - Caption: 12px - Micro: 10-11px (labels, badges, uppercase tracking)
```

**Decisions Log append convention** — append ONE pipe-delimited row `| YYYY-MM-DD | <decision title> | <rationale + file refs + AA notes> |`. The 2026-04-30 AA-shift rows (lines 42-45) and the 2026-05-06 `--color-*` row (line 243) are the rationale-density template. The new row records: fluid `--text-*` spine in a plain `@theme` block, the rem-term + ≤2.5× invariant, the TS mirror + drift test, the scoped lint, and that existing `text-sm`/`text-[14px]` usages are untouched (migrated per-surface in 52/53).
> DESIGN.md edits are pinned by the drift test (px endpoints must appear verbatim). Do NOT touch the color rows or `--space-grid-gap`.

---

### `.planning/audits/truncation-audit.md` (doc) — **NO CODE ANALOG**

Net-new artifact; the `.planning/audits/` directory **does not yet exist** (verified — must be created). Nearest structural cousin is the DESIGN.md Decisions Log table (a checked-in classification table), but there is no code analog. Planner uses RESEARCH Pattern 6 for structure.

**Content** (RESEARCH recon census): inventory every `truncate` (~34 files) / `line-clamp` (9) / `text-ellipsis` (2) / `overflow-hidden`+`whitespace-nowrap` (22 / 24) / manual-ellipsis idiom (2) site, each tagged **legitimate** (bounded label with a `title`/tooltip recovery, or intentional single-line affordance) vs **accidental-clip** (clips meaningful content, no recovery). Suggested table: `| file:line | pattern | element/context | classification | recovery affordance | note |`. It is an inventory informing phases 52/53 — NOT a hard gate in Phase 49 (TYPE-01).
> Generate the census with ripgrep over `src/`; an optional `vitest` count-census guard (assert the audit lists ≥ N sites) is deferred, not required.

---

## Shared Patterns

### Sanctioned-exception allow-list (lint rules)
**Source:** `tools/eslint-plugin-quantalyze/rules/_shared.mjs` lines 22-26 (`fileHasMarker`)
**Apply to:** both new ESLint rules (`no-raw-font-px`, `no-rem-less-clamp`)
```js
export function fileHasMarker(sourceCode, markers) {
  return sourceCode.getAllComments()
    .some((c) => markers.some((m) => c.value.includes(m)));
}
// usage: if (fileHasMarker(sc, ["DS-04 sanctioned-exception:"])) return {};
```
Greppable, auditable, agrees with the eslint.config glob layer. Do NOT hand-roll a new per-rule allowlist.

### Hand-rolled WCAG luminance helper
**Source:** `tests/a11y/chart-contrast.test.ts` lines 20-39 (verbatim copy in `wizard-contrast.test.ts` lines 26-49)
**Apply to:** `tests/a11y/palette-contrast.test.ts`
The repo's explicit "don't add a dep for one test" decision — copy `srgbToLinear`/`relativeLuminance`/`getContrastRatio`. Never add `polished`/`wcag-contrast`.

### DESIGN.md-parse + verbatim-includes drift gate
**Source:** `tests/a11y/trust-tier-tokens.test.ts` lines 24-45 + the scoped-section slice (lines 47-70)
**Apply to:** `tests/a11y/type-token-drift.test.ts`
`readFileSync(resolve(__dirname, "../../DESIGN.md"))` + `expect(designMd.includes(x)).toBe(true)`. The section-slice idiom (`indexOf("## Heading")` → next `\n## `) is the brace-balancer precedent for the `@theme inline` vs plain `@theme` no-inline guard.

### Grep-over-source violation-collector
**Source:** `tests/visual/strategy-v2-type-scale.test.ts` lines 70-82 + the `globals.css` regex pin in `chart-contrast.test.ts` lines 110-121
**Apply to:** `tests/visual/globals-clamp-guard.test.ts`
`for (file) { for (re) if (re.test(content)) violations.push(...) } expect(violations).toEqual([])` and `expect(css).toMatch(/.../)`.

### ESLint rule template + RuleTester harness
**Source:** `tools/eslint-plugin-quantalyze/rules/no-raw-staleness-derivation.mjs` + `tools/eslint-plugin-quantalyze/tests/no-raw-staleness-derivation.test.ts`
**Apply to:** both new rules + their tests
`meta {type, docs, schema:[], messages:{raw}}` + `create` with `fileHasMarker` early-return; RuleTester wired with `RuleTester.afterAll/describe/it = vitest …`, `languageOptions: { ecmaVersion: 2024, sourceType: "module" }`.

### eslint.config glob-override allow-list
**Source:** `eslint.config.mjs` lines 41-90 (register block + `files:[…] rules:{ "quantalyze/…": "off" }` overrides for `src/lib/storage/**` and `*.{test,spec}.*`)
**Apply to:** wiring the two new DS-04 rules + their chart/designer-bundle/test exemptions

### Decisions Log append + token-prose convention
**Source:** DESIGN.md Decisions Log (2026-05-06 `--color-*` row line 243; 2026-04-30 AA-shift rows lines 42-45)
**Apply to:** the DESIGN.md DS-01 edit
One dated pipe row with file refs + AA rationale; never delete historical rows.

---

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `.planning/audits/truncation-audit.md` | doc | — | Net-new classification artifact; the `.planning/audits/` dir does not yet exist. Nearest cousin is the DESIGN.md Decisions Log table (a checked-in classification table) but there is no code analog. Use RESEARCH Pattern 6 for structure. |

> Note: the `globals.css` plain `@theme` block, while listed as "exact" match, is a *new at-rule instance* — its analog is the sibling `@theme inline` block in the same file, but the **plain-vs-inline distinction is the deliberate divergence**, not a copy.

---

## Metadata

**Analog search scope:** `src/lib/design-tokens/`, `tests/a11y/`, `tests/visual/`, `tools/eslint-plugin-quantalyze/{rules,tests}/`, `src/app/globals.css`, `DESIGN.md`, `eslint.config.mjs`, `.planning/audits/` (absent).
**Files scanned (read line-by-line):** 11 — `trust-tier.ts`, `trust-tier-tokens.test.ts`, `chart-contrast.test.ts`, `wizard-contrast.test.ts`, `strategy-v2-type-scale.test.ts`, `index.mjs`, `_shared.mjs`, `no-raw-staleness-derivation.mjs` (+ its test), `no-raw-localstorage.mjs`, `eslint.config.mjs`, `globals.css` (head + factsheet-dark tail), `DESIGN.md` (typography + decisions log).
**Pattern extraction date:** 2026-06-29
**New dependencies introduced by this phase:** ZERO (all work extends in-repo tooling — tailwindcss 4.3.1, vitest, local eslint-plugin-quantalyze).
