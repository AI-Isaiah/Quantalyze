# Phase 49: Design-System Refresh + Fluid Token Foundation - Research

**Researched:** 2026-06-28
**Domain:** Tailwind v4 design tokens · fluid (clamp) typography · WCAG 1.4.4 zoom-safety · CI design-lint · token drift testing
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **Evolve in place** — keep the Industrial/Utilitarian identity. The refresh formalizes fluid tokens, tightens the type scale + motion, closes any AA gaps. No per-surface visual rework in this phase.
- **Keep all identity anchors** — Instrument Serif (display) + DM Sans (body/UI) + Geist Mono (data, tabular-nums) + muted teal accent `#1B6B5A`. Do NOT swap fonts or shift the accent.
- **Type fluid, space fixed** — only `--text-*` become `clamp()`-based. Keep the existing fixed 4px space ladder and the `--space-grid-gap: 10px` designer-bundle token byte-stable. Fluid section-rhythm space tokens may be added *additively* for new work only.
- **Plain `@theme`, not `@theme inline`** — the fluid `--text-*` tokens MUST live in a plain `@theme` block. Colors may remain in `@theme inline`; the clamp type tokens get a sibling plain `@theme` block.
- **Every `clamp()` carries a `rem` middle term** — `clamp(<rem-min>, <rem>+<vw>, <rem-max>)`. The middle term must include a `rem` component so a user zoom to 400% scales text (WCAG 1.4.4). This is the single most important invariant of the fluid scale and what the lint guard enforces.
- **Named tier tokens** — mirror the existing DESIGN.md scale as named fluid tokens (hero / page-title / h2 / h3 / body / small / caption / micro), not an open-ended ramp.
- **TS mirror** extends `src/lib/design-tokens/` (e.g. `typography.ts`) exporting fluid tier tokens `as const`.
- **Drift test** follows the `tests/a11y/trust-tier-tokens.test.ts` pattern: parse DESIGN.md, parse the `@theme` block, parse the TS mirror, assert all three agree verbatim. Must ALSO fail if fluid type tokens drift back into `@theme inline`.
- **Scoped + documented allow-list** design-lint — ban raw hex, raw px font-size, and `rem`-less `clamp()` in component source, with an allow-list for chart + designer-bundle exceptions. NOT a big-bang migration.
- **Implementation** extends the existing local plugin `tools/eslint-plugin-quantalyze` with new rules (NOT stylelint — TOOL-F2 deferred). Prefer an ESLint rule + grep/Vitest assertion combo matching existing token guards.
- **Truncation audit** output: a checked-in classification doc (e.g. `.planning/audits/truncation-audit.md`) inventorying every truncate/line-clamp/text-ellipsis/overflow-hidden+whitespace-nowrap site, each tagged **legitimate** vs **accidental-clip**. NOT a hard gate inside Phase 49.

### Claude's Discretion
- Exact clamp min/max viewport anchors, token file naming, lint rule message text, and audit doc structure are at Claude's discretion within the above constraints. Use ROADMAP success criteria + codebase conventions.

### Deferred Ideas (OUT OF SCOPE)
- Per-surface fluid-type realization (TYPE-02/03/04) — Phase 52.
- Primitive refresh on the new tokens (UI-01) — Phase 50.
- Full whole-codebase raw-hex/px migration — deferred behind the scoped lint allow-list; per-surface in phases 52/53 (strangler), not big-bang.
- stylelint token enforcement (TOOL-F2) and component catalog/Storybook (TOOL-F1) — later milestone.
- Dark mode — out of scope (institutional light mode only).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| DS-01 | DESIGN.md refreshed to a state-of-the-art aesthetic, remains single source of truth | Decisions-Log append convention (DESIGN.md §Decisions Log); evolve-in-place keeps all tokens, adds a fluid-type spine section + a new Decisions Log row. See "DESIGN.md refresh" below. |
| DS-02 | Fluid type scale (clamp-based) in a plain Tailwind v4 `@theme` block, zoom-safe (rem term, passes WCAG 1.4.4 / F94) | `@theme` vs `@theme inline` semantics (Pattern 1); zoom-safe clamp formula + the ≤2.5× rule (Pattern 2); Tailwind `--text-*` namespace generates `text-*` utilities. |
| DS-03 | Tokens are a single source of truth wired DESIGN.md ↔ `@theme` ↔ TS mirror, drift test extended | Three-way drift test extending `trust-tier-tokens.test.ts` (Pattern 4); TS mirror `as const` extending `trust-tier.ts`. |
| DS-04 | CI design-lint rejects raw hex, raw px font-sizes, `clamp()` without a rem term | Scoped ESLint rules + grep/Vitest combo (Pattern 3 + Don't Hand-Roll); allow-list via `_shared.mjs` `fileHasMarker` + `eslint.config.mjs` file globs. 558 `text-[NNpx]` + 355 hex sites confirm scoped-not-bigbang. |
| DS-05 | Evolved palette passes WCAG-AA everywhere incl. dark sidebar over light surfaces | Programmatic contrast test extending `chart-contrast.test.ts` (Pattern 5); explicit fg/bg pair enumeration incl. sidebar pairs. |
| TYPE-01 | Truncation audit classifies every truncate/line-clamp/ellipsis site as legitimate vs accidental-clip | Grep strategy + classification criteria + audit doc structure (Pattern 6). Recon: ~34 files with `truncate`, 9 `line-clamp`, 2 `text-ellipsis`, 22 `overflow-hidden`, 24 `whitespace-nowrap`, 2 manual-ellipsis idiom files. |
</phase_requirements>

## Summary

This is a presentation-layer **foundation** phase: it establishes the locked token spine that phases 50-53 build on, and deliberately changes no per-surface rendering. All six requirements are mechanism/guard work that maps cleanly onto patterns this codebase already uses — `tokens as const` + a DESIGN.md-parsing Vitest drift test (`trust-tier.ts` / `trust-tier-tokens.test.ts`), a hand-rolled WCAG-AA contrast test (`chart-contrast.test.ts` / `wizard-contrast.test.ts`), grep-enforced type-scale guards (`strategy-v2-type-scale.test.ts`), and the local `eslint-plugin-quantalyze` "edit-time backstop" rule pattern with a greppable `sanctioned-exception:` allow-list.

The load-bearing technical subtlety — confirmed against Tailwind's own docs — is the `@theme` vs `@theme inline` distinction. `@theme inline` makes utilities use the **value** of a theme variable instead of a `var()` reference, baking the literal into the generated utility and flattening the variable chain. For a fluid `clamp()` token that must remain a live CSS variable so it can be overridden/inherited and so the browser re-evaluates it on zoom, that flattening would defeat the purpose. The fluid `--text-*` tokens therefore must go in a **plain** `@theme` block (which emits `text-foo { font-size: var(--text-foo) }`), while the existing color tokens can stay in `@theme inline`. The two blocks coexist in one `globals.css` — they are independent at-rule instances.

The second load-bearing constraint is WCAG 1.4.4 zoom-safety. A `vw`-only font size never scales under zoom (the viewport doesn't change when you zoom), failing F94. The fix, confirmed across authoritative accessibility sources, is two-fold: (a) the `clamp()` preferred term must include a `rem` component (`clamp(<rem>, <rem> + <vw>, <rem>)`) so zoom still scales the text, and (b) the **max must be ≤ 2.5× the min** — this guarantees the text can always reach 200% under zoom on modern browsers. Both are mechanically lintable and are what DS-04's "clamp missing a rem term" rule plus a Vitest ratio assertion enforce.

**Primary recommendation:** Build the spine as four cooperating artifacts mirroring existing conventions: (1) a plain `@theme` block of named `--text-*` clamp tokens in `globals.css` (colors stay in `@theme inline`); (2) `src/lib/design-tokens/typography.ts` exporting `TYPE_SCALE as const` with `{ min, vw, max, clamp }` per tier; (3) an extended three-way Vitest drift test that parses DESIGN.md + the `@theme` block + the TS mirror and also fails if any `--text-*` appears inside `@theme inline`; (4) two new `eslint-plugin-quantalyze` rules (`no-raw-font-px`, `no-rem-less-clamp`) plus a CSS-side Vitest grep for `globals.css`, all scoped with the established `sanctioned-exception:` escape and `eslint.config.mjs` file-glob allow-lists. Add a `chart-contrast`-style AA test enumerating the sidebar/accent/semantic pairs, and a checked-in `truncation-audit.md`.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Fluid `--text-*` token definitions | CDN/Static (CSS build → `globals.css` @theme) | — | Tokens are compiled CSS variables emitted at `:root`; no runtime/server logic. Tailwind v4 processes `@theme` at build. |
| TS token mirror (`typography.ts`) | Browser/Client + Build (shared module) | — | Framework-neutral `as const` export; consumed by components AND by Vitest drift tests at build/CI time. Must have zero React import (loads in node test context), per `trust-tier.ts` precedent. |
| Drift test (DESIGN.md ↔ @theme ↔ TS) | Build/CI (Vitest) | — | Pure filesystem parsing + assertion; runs in CI, never ships. |
| Design-lint rules | Build/CI (ESLint + Vitest grep) | — | Edit-time + CI backstop; no runtime footprint. |
| AA contrast verification | Build/CI (Vitest) | — | Hand-rolled luminance math over static hex; CI gate. |
| Truncation audit | Documentation (`.planning/audits/`) | Build/CI (optional grep guard, deferred) | Inventory artifact informing phases 52/53; not a hard gate in 49. |

**Why this matters:** Every Phase-49 capability lives at the **build/CI or static-CSS tier** — none is a runtime feature. This is the correct shape for a "token spine" phase and means there is no RSC/client-boundary, data-fetch, or API surface to get wrong. The one cross-tier consumer is the TS mirror, which must stay framework-neutral so it loads in the node/Vitest context (matching `trust-tier.ts`).

## Standard Stack

This phase **adds no new runtime dependencies.** Every capability is built on tooling already in the repo. The "stack" is therefore the existing tooling, used in the established way.

### Core
| Tool | Version | Purpose | Why Standard |
|------|---------|---------|--------------|
| tailwindcss | 4.3.1 `[VERIFIED: node_modules/tailwindcss/package.json]` | `@theme` / `@theme inline` token compilation; `--text-*` → `text-*` utility generation | Already the project's CSS engine; v4 `@theme` is the canonical token mechanism. |
| vitest | (repo-pinned) | Drift tests, AA-contrast tests, CSS grep guards | The established pattern for every existing design-token/a11y guard (`trust-tier-tokens`, `chart-contrast`, `wizard-contrast`, `strategy-v2-type-scale`). |
| eslint + eslint-plugin-quantalyze | local `0.1.0` `[VERIFIED: tools/eslint-plugin-quantalyze/package.json]` | New edit-time design-lint rules (`no-raw-font-px`, `no-rem-less-clamp`) | CONTEXT-locked: extend the local plugin, not stylelint. `RuleTester` test harness already wired (`tools/eslint-plugin-quantalyze/tests/`). |

### Supporting
| Tool | Version | Purpose | When to Use |
|------|---------|---------|-------------|
| Node `fs`/`path` | built-in | DESIGN.md / globals.css / TS-mirror parsing in the drift test | Every existing drift test uses `readFileSync` + `resolve` — no parser dependency. |
| Hand-rolled sRGB luminance helper | ~12 lines, copied | WCAG-AA contrast ratio in the AA test | The repo's deliberate "Don't Hand-Roll → except this one tiny helper" decision (see `chart-contrast.test.ts` header comment). Copy it; do NOT add `polished`/`wcag-contrast`. |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| ESLint custom rule for CSS clamp | stylelint + `stylelint-declaration-strict-value` | **Rejected — CONTEXT-locked.** TOOL-F2 (stylelint) is explicitly deferred. ESLint rules cover TS/TSX; a Vitest grep covers `globals.css`. |
| `@theme inline` for type tokens | plain `@theme` | **Rejected — CONTEXT-locked + technically correct.** `inline` bakes the literal and flattens the var chain, defeating fluid scaling/override. Plain `@theme` keeps a live `var()`. |
| A clamp-generator library at runtime | precomputed static clamp strings | Tokens are static CSS — compute the clamp strings once (build-time or by hand), check them in. No runtime generator needed. A small TS helper that *derives* the clamp string from `{min, vw, max}` is fine for the mirror + a generator script, but the emitted CSS is static. |
| `polished` / `wcag-contrast` npm | the 12-line hand-rolled luminance helper | Repo precedent explicitly rejects adding a dep for one test. Reuse the existing helper verbatim. |

**Installation:** None. No `npm install` for this phase. (Confirm by grepping that no new import of an external package is introduced.)

## Package Legitimacy Audit

> Not applicable — this phase installs **zero** external packages. All work extends in-repo tooling (tailwindcss 4.3.1 already installed and used; the local `eslint-plugin-quantalyze`; vitest). No registry fetch, no slopcheck surface.

If the plan later proposes any new dependency (it should not), gate it behind a `checkpoint:human-verify` and run the Package Legitimacy Gate then.

## Architecture Patterns

### System Architecture Diagram

```
                         ┌──────────────────────────────────────────┐
                         │            DESIGN.md (SoT prose)           │
                         │  §Typography scale (hero 48 … micro 10-11) │
                         │  + NEW §Fluid Type Spine + Decisions row   │
                         └───────────────┬──────────────────────────┘
                                         │ (parsed verbatim)
              ┌──────────────────────────┼──────────────────────────┐
              │                          │                          │
              ▼                          ▼                          ▼
  ┌───────────────────────┐  ┌────────────────────────┐  ┌────────────────────────┐
  │ globals.css            │  │ src/lib/design-tokens/ │  │ tests/a11y/            │
  │  @theme inline {colors}│  │   typography.ts        │  │  type-token-drift.test │
  │  @theme {  ← PLAIN     │  │   TYPE_SCALE as const  │  │  (parses all 3 →       │
  │    --text-hero: clamp()│◄─┤   {min,vw,max,clamp}   │◄─┤   assert agreement +   │
  │    --text-body: clamp()│  │                        │  │   no --text-* in       │
  │    …                   │  │                        │  │   @theme inline)       │
  │  }                     │  └───────────┬────────────┘  └────────────────────────┘
  └──────────┬────────────┘              │
             │ Tailwind build            │ imported by
             ▼                           ▼
  ┌───────────────────────┐  ┌────────────────────────┐
  │ text-hero { font-size:│  │ components (later       │
  │   var(--text-hero) }   │  │ phases consume tokens)  │
  │  ← live var, zoom-safe │  └────────────────────────┘
  └───────────────────────┘

   ── CI GUARDS (build/CI tier, ship nothing) ───────────────────────────────
   ESLint  quantalyze/no-raw-font-px      → bans text-[NNpx] / fontSize:'NNpx' (scoped + allow-list)
   ESLint  quantalyze/no-rem-less-clamp   → bans clamp(...) with no rem in TS/TSX
   Vitest  globals-clamp-guard.test       → every --text-* clamp in globals.css has a rem term + max ≤ 2.5×min
   Vitest  palette-contrast.test          → sidebar/accent/semantic fg-bg pairs ≥ AA
   Doc     .planning/audits/truncation-audit.md  (informs phases 52/53)
```

### Recommended Project Structure
```
src/
├── app/globals.css                       # @theme inline {colors} + NEW plain @theme {--text-*}
├── lib/design-tokens/
│   ├── trust-tier.ts                      # existing — pattern to mirror
│   └── typography.ts                      # NEW — TYPE_SCALE as const
tests/
├── a11y/
│   ├── trust-tier-tokens.test.ts          # existing — drift pattern to extend
│   ├── chart-contrast.test.ts             # existing — AA pattern to extend
│   ├── wizard-contrast.test.ts            # existing — AA pair-table pattern
│   ├── type-token-drift.test.ts           # NEW — three-way drift + no-inline guard
│   └── palette-contrast.test.ts           # NEW — sidebar/accent/semantic AA pairs (DS-05)
├── visual/
│   ├── strategy-v2-type-scale.test.ts     # existing — grep guard precedent
│   └── globals-clamp-guard.test.ts        # NEW — globals.css clamp rem-term + 2.5× ratio
tools/eslint-plugin-quantalyze/
├── index.mjs                              # register 2 new rules here
├── rules/
│   ├── no-raw-font-px.mjs                 # NEW
│   └── no-rem-less-clamp.mjs              # NEW
└── tests/
    ├── no-raw-font-px.test.ts             # NEW (RuleTester)
    └── no-rem-less-clamp.test.ts          # NEW (RuleTester)
eslint.config.mjs                          # wire 2 new rules + file-glob allow-lists
.planning/audits/
└── truncation-audit.md                    # NEW (TYPE-01)
```

### Pattern 1: `@theme` vs `@theme inline` — the load-bearing distinction
**What:** In Tailwind v4, `@theme` and `@theme inline` differ in how the generated utility references the token.
- **Plain `@theme`** emits a `:root` CSS variable AND makes the utility reference it live: `text-hero { font-size: var(--text-hero) }`. The browser re-resolves `var(--text-hero)` at render time, so a `clamp()` inside it is honored on zoom/inheritance.
- **`@theme inline`** makes the utility use the **value** of the token, baking the literal into the utility and flattening any `var()` chain: `font-sans { font-family: <literal list> }`. `[CITED: tailwindcss.com/docs/theme — "Using the inline option, the utility class will use the theme variable value instead of referencing the actual theme variable"]`

**When to use plain `@theme` here:** Always, for the fluid `--text-*` tokens. They must stay a live `var()` so the `clamp()` re-evaluates and so consumers/overrides inherit correctly. Baking a clamp literal into every `text-*` utility would also bloat output and break override patterns.

**When `@theme inline` is correct (why colors keep it):** `@theme inline` exists to fix the case where a token *references another token* and would otherwise resolve in the wrong cascade scope. `[CITED: tailwindcss.com/docs/theme]` The existing color block uses `@theme inline` and that is fine to leave — colors are flat literals or `--color-* → var(--font-*)`-style indirections the project already relies on. **Do not move colors.** Only ADD a sibling plain `@theme` block for type.

**Coexistence:** The two at-rules are independent instances in the same stylesheet; Tailwind merges all `@theme` blocks into the theme. `[VERIFIED: node_modules/tailwindcss/package.json confirms v4.3.1; behavior cross-checked against official docs]` Confirm at implementation time by building and inspecting the emitted CSS for `text-hero { font-size: var(--text-hero) }` (live var) vs a baked literal.

**Example (target shape):**
```css
/* Source: tailwindcss.com/docs/theme — plain @theme emits a live var reference */
@theme inline {
  /* existing colors stay here, unchanged */
  --color-page: #F8F9FA;
  /* … */
}

@theme {
  /* NEW: fluid type spine — plain @theme so text-* utilities keep var(--text-*) */
  --text-hero:       clamp(2rem,    1.5rem  + 2.5vw, 3rem);      /* 32→48px */
  --text-page-title: clamp(1.5rem,  1.2rem  + 1.5vw, 2rem);     /* 24→32px (page titles) */
  --text-h2:         clamp(1.25rem, 1.1rem  + 0.75vw, 1.5rem);  /* 20→24px */
  --text-h3:         clamp(1rem,    0.95rem + 0.25vw, 1.125rem);/* 16→18px */
  --text-body:       clamp(0.875rem,0.85rem + 0.125vw, 1rem);   /* 14→16px */
  --text-small:      clamp(0.8125rem, …, 0.875rem);             /* 13→14px */
  --text-caption:    clamp(0.75rem, …, 0.8125rem);              /* 12→13px */
  --text-micro:      clamp(0.625rem, …, 0.6875rem);             /* 10→11px */
}
```
> The exact anchors above are **illustrative** (Claude's-discretion). The hard rules they MUST satisfy are in Pattern 2. Tier→px mapping comes from DESIGN.md §Typography (hero 48/page-title 32/h2 24/h3 16/body 14/small 13/caption 12/micro 10-11). Note Tailwind's `--text-*` namespace is what generates `text-<name>` utilities, so naming a token `--text-hero` yields a `text-hero` class. `[CITED: tailwindcss.com/docs/font-size — theme namespace]`

### Pattern 2: Zoom-safe `clamp()` construction (WCAG 1.4.4 / F94)
**What:** A fluid font-size that still scales when the user zooms.
**When to use:** Every `--text-*` token.

Two rules, both mechanically enforceable:

1. **The preferred (middle) term MUST include a `rem` component.** A `vw`-only size never changes under zoom because the viewport doesn't change when you zoom — it fails F94/1.4.4. `[CITED: w3.org/WAI/WCAG21/Techniques/failures/F94 — "viewport units … cannot be resized by zooming or adjusting text-size"]` Adding a `rem` term means the rem portion scales with zoom while `vw` provides viewport fluidity: `clamp(<rem-min>, <rem> + <vw>, <rem-max>)`. `[CITED: smashingmagazine.com/2023/11/addressing-accessibility-concerns-fluid-type — "rem values do scale with zoom … combine both"; adrianroselli.com — calc(1rem + Nvw)]`

2. **The max MUST be ≤ 2.5× the min.** "If the maximum font size is less than or equal to 2.5 times the minimum font size, then the text will always pass WCAG SC 1.4.4, at least on all modern browsers." `[CITED: smashingmagazine.com/2023/11/addressing-accessibility-concerns-fluid-type]` Express min/max in `rem` (CONTEXT decision: rem-based bounds) so the bounds themselves scale with zoom; the `vw` only widens the band in between.

**Reusable derivation:** From DESIGN.md's px scale, pick a min-viewport anchor (e.g. 320px) and a max-viewport anchor (e.g. 1280-1440px). For a tier going `minPx → maxPx` across `minVw → maxVw`:
```
slopeVw = (maxPx - minPx) / (maxVw - minVw) * 100      // vw coefficient
interceptRem = (minPx - slopeVw/100 * minVw) / 16      // rem intercept
clamp( minPx/16 rem, interceptRem rem + slopeVw vw, maxPx/16 rem )
```
Provide this as a tiny pure helper in `typography.ts` (`buildClamp({minPx,maxPx,minVw,maxVw})`) so the TS mirror and a generator script share one definition — but **check in the resulting static strings** (the emitted CSS is static).

**Suggested anchors (discretion):** min-viewport 320px, max-viewport 1280px. Validate each tier's `maxPx ≤ 2.5 × minPx` at the chosen scale (most tiers go e.g. 14→16, 12→13 — well within 2.5×; the only one to watch is hero 32→48 = 1.5×, fine).

### Pattern 3: Scoped design-lint (DS-04)
**What:** Two ESLint rules in `eslint-plugin-quantalyze` + one Vitest CSS grep, mirroring the existing "edit-time backstop" rules.
**When to use:** TS/TSX → ESLint; `globals.css` → Vitest grep (ESLint doesn't parse CSS, and stylelint is deferred).

Three offense classes, three detectors:
- **(a) raw hex** in TSX `className`/`style` → ESLint rule scanning string literals + `Literal`/`TemplateLiteral` nodes for `/#[0-9a-fA-F]{3,8}\b/`. **Scope is critical:** recon found **355 hex occurrences across 54 files**. A repo-wide `error` would red-CI the whole codebase. Apply via `eslint.config.mjs` to a NARROW glob (e.g. only NEW token/primitive dirs, or start as `"warn"`), with the `sanctioned-exception:` escape for blessed sites.
- **(b) raw px font-size** → ESLint rule for `text-[NNpx]` in class strings and `fontSize: 'NNpx'` in style objects. Recon found **558 `text-[NNpx]` occurrences** — again, scope narrowly; do NOT blanket-error. The CONTEXT allow-list (chart/designer-bundle) is expressed as `eslint.config.mjs` file-glob overrides turning the rule `off` for `src/components/charts/**` and the designer-bundle ports, exactly as the existing plugin exempts `src/lib/storage/**` etc.
- **(c) `clamp()` missing a rem term** → ESLint rule firing on a `clamp(` whose argument text contains `vw` but no `rem`/`em`. NOTE the `.ts` `clamp()` matches found in recon (`peer-cohort.ts`, `scenario-montecarlo.ts`) are **numeric `Math`-style helpers, not CSS** — the rule must only fire inside string/template contexts (className/style), not on call expressions to a local `clamp()` function. The CSS side (`--text-*` in `globals.css`) is covered by the Vitest grep, not ESLint.

**Lowest-complexity reliable approach (recommended):**
- For (a) and (b): a single ESLint rule each over `Literal`/`TemplateElement` string content — simple, AST-scoped, fast, with the existing `fileHasMarker(sourceCode, ["DS-04 sanctioned-exception:"])` early-return for per-file allow-listing (`_shared.mjs` already provides this).
- For (c) clamp-rem in CSS: a **Vitest grep** over `globals.css` (matches the `strategy-v2-type-scale.test.ts` precedent and the `chart-contrast.test.ts` `--color-warning literal` precedent) — assert every `--text-*: clamp(...)` line contains `rem` and that `max ≤ 2.5×min`. This is more reliable than trying to lint CSS through ESLint.

**Allow-list expression (two layers, matching existing plugin):**
1. **Directory/file globs** in `eslint.config.mjs` (turn rule `off` for `src/components/charts/**`, designer-bundle ports, `*.test.*`) — exactly how `no-raw-localstorage` is `off` for `src/lib/storage/**` and all tests.
2. **Per-site greppable comment** `// DS-04 sanctioned-exception: <reason>` via `fileHasMarker` — for one-off blessed literals (e.g. the `--space-grid-gap` 10px port, Recharts axis colors). Auditable, reviewable, consistent with `B14 sanctioned-exception:`.

**Existing rules to follow (read before writing):** `no-raw-staleness-derivation.mjs` (cleanest template: `meta`, `fileHasMarker` early-return, `messages.raw`, AST visitor), `no-raw-localstorage.mjs`, and their `RuleTester` tests in `tools/eslint-plugin-quantalyze/tests/`. Register new rules in `index.mjs` and wire in `eslint.config.mjs`.

### Pattern 4: Three-way token drift test (DS-03)
**What:** Extend `tests/a11y/trust-tier-tokens.test.ts`'s "parse DESIGN.md + assert verbatim" approach to a 3-source agreement check across DESIGN.md ↔ `globals.css` `@theme` ↔ `src/lib/design-tokens/typography.ts`.
**When to use:** As the atomic CI gate against type-token drift.

Mechanics:
1. `readFileSync` DESIGN.md, `globals.css`, and import `TYPE_SCALE` from `typography.ts` (the test runs in the node/Vitest context — `typography.ts` must be framework-neutral, no React import, per `trust-tier.ts`).
2. For each tier, parse the `--text-<tier>: clamp(...)` line out of `globals.css` (regex against the plain `@theme` block) and assert it equals `TYPE_SCALE[tier].clamp` verbatim.
3. Assert each tier's px endpoints (or the human-readable px in DESIGN.md §Typography) appear verbatim in DESIGN.md — mirroring `trust-tier-tokens.test.ts`'s `designMd.includes(hex)` assertions.
4. **The no-inline guard:** parse `globals.css`, locate the `@theme inline { … }` block boundaries, and assert NO `--text-` appears inside it (and conversely that the plain `@theme { … }` block contains every tier). This is the explicit "fail if fluid type tokens regress into `@theme inline`" check the CONTEXT calls out. Parse block boundaries by matching `@theme inline` … balanced braces vs `@theme` (without `inline`) … braces.

```ts
// shape sketch — extends tests/a11y/trust-tier-tokens.test.ts conventions
const css = readFileSync(resolve(__dirname, "../../src/app/globals.css"), "utf8");
const inlineBlock = extractBlock(css, /@theme\s+inline\s*\{/);
const plainBlock  = extractBlock(css, /@theme\s*\{(?!\s*inline)/); // the no-"inline" instance
for (const [tier, t] of Object.entries(TYPE_SCALE)) {
  expect(plainBlock).toContain(`--text-${tier}: ${t.clamp}`);   // CSS ↔ TS verbatim
  expect(inlineBlock).not.toContain(`--text-${tier}`);          // no regression to inline
  expect(designMd).toContain(`${t.minPx}`);                     // DESIGN.md ↔ TS (per §Typography)
}
```
> `extractBlock` is a small brace-balancer; keep it in-test (no parser dep), matching the no-extra-deps ethos of the existing tests.

### Pattern 5: Palette AA-everywhere (DS-05)
**What:** Extend the `chart-contrast.test.ts` / `wizard-contrast.test.ts` hand-rolled luminance pattern to assert every foreground/background pair in the evolved palette meets WCAG-AA, **explicitly including the dark sidebar over light surfaces**.
**When to use:** As the CI palette gate.

Copy the `srgbToLinear` / `relativeLuminance` / `getContrastRatio` trio verbatim (already duplicated across `chart-contrast.test.ts` and `wizard-contrast.test.ts` — consistent precedent), then assert a pair table.

**Exact pairs to assert (enumerated from globals.css + DESIGN.md):**

*Sidebar (the CONTEXT-called-out case — dark `#0F172A` shell + its text tokens). Computed values below; assert pairs AS COMPOSED in `Sidebar.tsx`, NOT every cartesian combination — see the composition rule):*
- `--color-sidebar-text` `#94A3B8` on `--color-sidebar` `#0F172A` — **6.96:1 PASS** (default nav-row text; the "dark sidebar over light surfaces" inverse).
- `--color-sidebar-text` `#94A3B8` on `--color-sidebar-hover` `#1E293B` — **5.71:1 PASS** (hover-row text — `Sidebar.tsx` line 318 uses `hover:bg-sidebar-hover hover:text-sidebar-text-active`, so muted text on hover is actually transient; the 5.71 figure is the conservative still-muted case).
- `--color-sidebar-text-active` `#FFFFFF` on `--color-sidebar` `#0F172A` — **17.85:1 PASS**.
- `--color-sidebar-text-active` `#FFFFFF` on `--color-sidebar-active` `#334155` — **10.35:1 PASS** (the live active-row composition: `Sidebar.tsx` line 317 `bg-sidebar-active text-sidebar-text-active`).

> **Composition rule (resolves open question A5 — verified against `src/components/layout/Sidebar.tsx`):** the cartesian pair `--color-sidebar-text` `#94A3B8` on `--color-sidebar-active` `#334155` computes to **4.04:1 (below AA)** — BUT this pair NEVER renders: the active row always switches text to `--color-sidebar-text-active` (#FFFFFF). Muted `#94A3B8` only ever sits on `bg-sidebar` (#0F172A) or `bg-sidebar-hover` (#1E293B), both ≥ 5.7:1. So there is **no live AA defect today**. The DS-05 test MUST assert only the *composed* pairs (the four above), not the 4.04 non-composition — otherwise it manufactures a false failure. Document this composition explicitly in the test so a future refactor that puts muted text on the active bg trips it.
- Non-text ≥ 3:1: the sidebar's active-row indicator/border against `bg-sidebar`, if one is added in the refresh.

*Body text on light surfaces (regression pins):*
- `--color-text-primary` `#1A1A2E` on `--color-page` `#F8F9FA` and on `--color-surface` `#FFFFFF` — ≥ 4.5.
- `--color-text-secondary` `#4A5568` on page + surface — ≥ 4.5.
- `--color-text-muted` `#64748B` on page + surface — ≥ 4.5 (already AA-tuned 2026-04-30).

*Accent + semantics on their backgrounds:*
- `--color-accent` `#1B6B5A` on `#FFFFFF` and on `#F8F9FA` — ≥ 4.5.
- `#FFFFFF` on `--color-accent` `#1B6B5A` (filled accent button text) — ≥ 4.5.
- `--color-positive` `#15803D`, `--color-negative` `#DC2626`, `--color-warning` `#B45309` each on `#FFFFFF` and `#F8F9FA` — ≥ 4.5 (positive/muted/warning already pinned in `chart-contrast.test.ts`; fold negative + the page-bg variants in).
- `--color-warning` `#B45309` on resolved `bg-warning/5` `#FEF1E5` — ≥ 4.5 (already in `chart-contrast.test.ts`).
- Border/non-text (≥ 3:1, SC 1.4.11): `--color-border` `#E2E8F0` on `#FFFFFF` is a hairline divider — note divider contrast is exempt under 1.4.11 (purely decorative dividers), but `--color-border-focus` `#1B6B5A` as a focus indicator on surface must be ≥ 3:1.

> Pin the literal hexes against `globals.css` (the `chart-contrast.test.ts` "literal in globals.css matches the pinned hex" idiom) so an AA-passing-but-wrong color swap still fails.

### Anti-Patterns to Avoid
- **Putting `--text-*` in `@theme inline`** — bakes the clamp literal, flattens the var chain, breaks fluid scaling/override. The whole point of the phase.
- **`vw`-only or `rem`-less clamp** — fails WCAG 1.4.4/F94. Always `clamp(rem, rem+vw, rem)`.
- **max > 2.5× min** — can prevent reaching 200% zoom; a 1.4.4 fail even with a rem term.
- **Repo-wide `error` on the hex/px lint** — 355 hex + 558 `text-[NNpx]` sites exist; a blanket error red-CIs everything and forces the deferred big-bang migration. Scope it (CONTEXT-locked).
- **Adding `polished`/`wcag-contrast`/stylelint** — repo precedent + CONTEXT both reject. Reuse the 12-line helper; defer stylelint (TOOL-F2).
- **Moving/editing color tokens or `--space-grid-gap`** — colors stay in `@theme inline`; the 10px grid gap stays byte-stable (shifting it regresses the 980/640px breakpoints — see DESIGN.md Decisions Log 2026-04-27).
- **Touching `scenario.ts` / `compute.ts` / FactsheetBody** — FROZEN. This is presentation-only.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Sanctioned-exception allow-list in lint rules | A new bespoke per-rule allowlist | `fileHasMarker(sourceCode, ["DS-04 sanctioned-exception:"])` from `tools/eslint-plugin-quantalyze/rules/_shared.mjs` | Already exists; keeps lint + grep tests agreeing on exceptions; greppable/auditable. |
| ESLint rule scaffolding | A from-scratch rule module | Copy `no-raw-staleness-derivation.mjs` structure (meta/messages/`create`/`fileHasMarker`) + its `RuleTester` test | Established, reviewed template; the test harness (`RuleTester.afterAll = afterAll` etc.) is already wired. |
| WCAG contrast math | A new luminance lib or hand-math | The `srgbToLinear`/`relativeLuminance`/`getContrastRatio` helper already duplicated in `chart-contrast.test.ts` + `wizard-contrast.test.ts` | Repo's explicit "don't add a dep for one test" decision. |
| DESIGN.md ↔ token drift detection | A new doc framework | Extend `trust-tier-tokens.test.ts` (`readFileSync` + `includes`) | Atomic, no-dep, proven CI gate. |
| Clamp-string generation per tier | A runtime fluid-type lib | One pure `buildClamp({minPx,maxPx,minVw,maxVw})` in `typography.ts`, check in static strings | Tokens are static CSS; a 6-line helper shared by mirror + generator script is enough. |

**Key insight:** This phase is almost entirely "do the existing thing one more time." The risk is not missing a library — it's deviating from the four established patterns (tokens-as-const + drift test, hand-rolled AA test, grep guard, plugin backstop rule) and accidentally introducing a dependency or a repo-wide lint that the strangler strategy explicitly forbids.

## Common Pitfalls

### Pitfall 1: `@theme inline` silently flattening the type tokens
**What goes wrong:** The fluid `--text-*` tokens are added inside the existing `@theme inline { … }` block (it's the first block in the file, easy to append to). Utilities then bake the clamp literal and zoom-safety/override is silently lost.
**Why it happens:** `globals.css` opens with `@theme inline` at line 3; appending there is the path of least resistance.
**How to avoid:** Add a NEW sibling plain `@theme { … }` block. The drift test's no-inline guard (Pattern 4 step 4) fails CI if any `--text-` lands in the inline block.
**Warning signs:** Emitted CSS shows `text-hero { font-size: clamp(2rem, …) }` (baked) instead of `text-hero { font-size: var(--text-hero) }` (live var). Inspect the build output once.

### Pitfall 2: The Tailwind built-in `text-*` namespace collision
**What goes wrong:** Tailwind v4 ships default `--text-*` font-size tokens (`text-sm`, `text-base`, `text-lg`, …). Naming a custom tier `--text-base` would override/shadow the built-in; naming tiers `hero`/`page-title`/`h2`/etc. is safe but `--text-small`/`--text-caption` are new names (fine). The 558 existing `text-[NNpx]` and many `text-sm`/`text-xs` usages still resolve to built-ins.
**Why it happens:** The `--text-*` namespace is shared between custom tokens and Tailwind defaults.
**How to avoid:** Use distinct tier names (hero/page-title/h2/h3/body/small/caption/micro) that don't collide with `sm/base/lg/xl/2xl`. Document in DESIGN.md that `text-body`≈14-16, mapping is additive, and existing `text-sm`/`text-[14px]` usages are untouched in this phase (migrated per-surface in 52/53). `[CITED: tailwindcss.com/docs/font-size]`
**Warning signs:** A tier name equal to a Tailwind default size keyword.

### Pitfall 3: The clamp lint firing on numeric `Math.clamp` helpers
**What goes wrong:** `no-rem-less-clamp` flags `clamp(round(n^(1/3)), 2, n)` in `scenario-montecarlo.ts` / `peer-cohort.ts` (pure number math, not CSS) → false positive on FROZEN-adjacent files.
**Why it happens:** A naive text grep for `clamp(` without `rem` matches numeric clamps.
**How to avoid:** Scope the rule to string/template literal contexts (className/style) only, not `CallExpression` to a local `clamp` identifier. The CSS clamp is covered by the Vitest grep over `globals.css`, not ESLint.
**Warning signs:** Lint errors in `src/lib/factsheet/` or `allocations/lib/` math files.

### Pitfall 4: Surfacing a real AA failure and "fixing" it by lowering a gate
**What goes wrong:** The DS-05 palette test finds a borderline pair (e.g. sidebar hover-row text) below 4.5:1; the temptation is to relax the threshold.
**Why it happens:** AA-everywhere is genuinely hard on a dark sidebar with muted text.
**How to avoid:** The v1.3 WCAG-AA floor is LOCKED and "the design conforms to the gate, not the reverse" (REQUIREMENTS Out-of-Scope). A real finding → darken/lighten the token (and log it in DESIGN.md Decisions Log, like the 2026-04-30 shifts), never lower the threshold.
**Warning signs:** A PR diff that changes `4.5` to a smaller number in a contrast test.

### Pitfall 5: Lint scope too broad → red CI / forced big-bang
**What goes wrong:** Setting `no-raw-font-px`/`no-raw-hex` to repo-wide `error` immediately fails on 558+355 existing sites, forcing the deferred whole-codebase migration into Phase 49.
**Why it happens:** The existing plugin rules ARE repo-wide `error` (clean baseline) — copying that posture without checking the baseline.
**How to avoid:** These two rules have a DIRTY baseline. Start scoped (narrow globs and/or `"warn"`) per CONTEXT; the strangler migration in 52/53 ratchets to `error` per-surface. Document the scope decision in the rule header + DESIGN.md.
**Warning signs:** `npm run lint` reports hundreds of new violations.

## Runtime State Inventory

> N/A for the most part — this is a greenfield token-spine + guard phase, not a rename/refactor/migration. There is no stored data, live-service config, OS-registered state, or secret tied to these tokens.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — tokens are static CSS/TS, no DB rows reference token names. | None. |
| Live service config | None — no external service stores `--text-*` names. | None. |
| OS-registered state | None. | None. |
| Secrets/env vars | None. | None. |
| Build artifacts | Tailwind regenerates CSS on build; no stale artifact carries old `--text-*` (none exist yet). The `node_modules/.cache/.eslintcache` is auto-managed by `npm run lint`. | None — normal build picks up the new `@theme` block. |

**Nothing found in any category — verified:** tokens are new (greenfield), and no rename of an existing token is in scope (colors/space stay byte-stable).

## Code Examples

### New ESLint rule skeleton (mirror `no-raw-staleness-derivation.mjs`)
```js
// Source: tools/eslint-plugin-quantalyze/rules/no-raw-staleness-derivation.mjs (existing template)
import { fileHasMarker } from "./_shared.mjs";

const FONT_PX = /\btext-\[\d+px\]/;            // text-[14px]
const STYLE_FONT_PX = /fontSize\s*:\s*["']\d+px/;
const MESSAGE =
  "Raw px font-size. Use a fluid --text-* token (text-hero/page-title/h2/…) " +
  "so type stays zoom-safe (DS-04). Chart/designer-bundle ports are exempted " +
  "via eslint.config.mjs globs; one-off exceptions: add a " +
  "`DS-04 sanctioned-exception:` comment.";

export default {
  meta: { type: "problem", docs: { description: "Ban raw px font-size (DS-04)." }, schema: [], messages: { raw: MESSAGE } },
  create(context) {
    const sc = context.sourceCode ?? context.getSourceCode();
    if (fileHasMarker(sc, ["DS-04 sanctioned-exception:"])) return {};
    function check(node, text) {
      if (FONT_PX.test(text) || STYLE_FONT_PX.test(text)) context.report({ node, messageId: "raw" });
    }
    return {
      Literal(n) { if (typeof n.value === "string") check(n, n.value); },
      TemplateElement(n) { check(n, n.value.raw); },
    };
  },
};
```

### Vitest globals.css clamp guard (mirror `strategy-v2-type-scale.test.ts` + `chart-contrast.test.ts`)
```ts
// Source: tests/visual/strategy-v2-type-scale.test.ts + tests/a11y/chart-contrast.test.ts (existing patterns)
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const css = readFileSync(resolve(process.cwd(), "src/app/globals.css"), "utf8");
const TEXT_TOKENS = [...css.matchAll(/--text-[\w-]+:\s*clamp\(([^;]+)\);/g)];

describe("fluid type clamp guard (DS-02/DS-04)", () => {
  it("declares at least the 8 named tiers", () => {
    expect(TEXT_TOKENS.length).toBeGreaterThanOrEqual(8);
  });
  it.each(TEXT_TOKENS.map((m) => [m[0], m[1]]))(
    "%s has a rem term (zoom-safe, WCAG 1.4.4)",
    (_decl, args) => { expect(/\brem\b/.test(args)).toBe(true); },
  );
  it.each(TEXT_TOKENS.map((m) => [m[0], m[1]]))(
    "%s max <= 2.5x min (guarantees 200% zoom)",
    (_decl, args) => {
      const rems = [...args.matchAll(/([\d.]+)rem/g)].map((x) => parseFloat(x[1]));
      const min = Math.min(...rems), max = Math.max(...rems);
      expect(max).toBeLessThanOrEqual(2.5 * min);
    },
  );
});
```

### TS mirror shape (mirror `trust-tier.ts`)
```ts
// Source: src/lib/design-tokens/trust-tier.ts (existing as-const + drift-tested pattern)
export interface TypeTier { readonly minPx: number; readonly maxPx: number; readonly clamp: string; }
export const TYPE_SCALE = {
  hero:       { minPx: 32, maxPx: 48, clamp: "clamp(2rem, 1.5rem + 2.5vw, 3rem)" },
  "page-title": { minPx: 24, maxPx: 32, clamp: "clamp(1.5rem, 1.2rem + 1.5vw, 2rem)" },
  // … h2, h3, body, small, caption, micro
} as const satisfies Record<string, TypeTier>;
```
> The `clamp` strings here MUST match `globals.css` verbatim (drift test enforces).

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Tailwind v3 `tailwind.config.js` theme | Tailwind v4 CSS-first `@theme` / `@theme inline` in `globals.css` | Tailwind v4 (project already on 4.3.1) | Tokens live in CSS; the `inline` modifier is the new var-vs-value control point. |
| Media-query type breakpoints | `clamp(rem, rem+vw, rem)` fluid type | Mainstream ~2021+; accessibility caveats matured 2023 (Smashing) | Fluid type is standard, but only zoom-safe with a rem term + ≤2.5× cap. |
| `polished`/utility libs for contrast | Hand-rolled 12-line sRGB luminance in-test | Repo decision (Phase 14a) | Zero deps; copy the helper. |
| Raw hex/px scattered | Token-enforced via lint backstop + drift test | This phase (DS-04) | Edit-time + CI guards; scoped/strangler, not big-bang. |

**Deprecated/outdated:**
- Tailwind v3 JS config: not used here; do not reintroduce.
- `vw`-only font sizing: a WCAG 1.4.4 failure (F94); never use without a rem term.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The factsheet `.factsheet-v2-shell[data-theme="dark"]` block at the bottom of globals.css is a SCOPED component override, not app-wide dark mode; app shell stays light-only. | DS-05 scope | Low — verified by reading the selectors (all `.factsheet-v2-shell`-scoped); if a future surface opted into it, those pairs would also need AA pins. |
| A2 | Illustrative clamp anchors (320→1280px viewport, the specific rem coefficients) are placeholders; the planner/implementer derives final values from DESIGN.md px + the ≤2.5× rule. | Pattern 2 | Low — anchors are Claude's-discretion per CONTEXT; only the rem-term + 2.5× invariants are hard. |
| A3 | Tailwind v4.3.1 merges multiple `@theme`/`@theme inline` blocks into one theme (coexistence). | Pattern 1 | Low — confirmed against official docs; MUST be re-verified by inspecting emitted CSS at implementation (one build). |
| A4 | The two new hex/px lint rules should start scoped/`warn`, not repo-wide `error`, because the baseline is dirty (355 hex + 558 text-[NNpx]). | Pattern 3 / Pitfall 5 | Low-Med — CONTEXT mandates "not big-bang"; if the planner wants `error` it must narrow the glob to clean dirs only. |
| A5 | RESOLVED (was an assumption, now computed + composition-verified): all *composed* sidebar pairs pass AA (6.96 / 5.71 / 17.85 / 10.35). The only sub-AA cartesian pair (#94A3B8 on active #334155 = 4.04) is never composed in `Sidebar.tsx`. | DS-05 | Low — verified against the live component; no token shift needed. Risk only if a future refactor composes muted text on the active bg (the test should guard this). |

**Confirmation needed before locking:** Only A4 (lint severity/scope) may need a user/planner call. A5 is now RESOLVED (computed + verified against `Sidebar.tsx`: no live AA defect).

## Open Questions

1. **Final clamp anchors per tier**
   - What we know: tier→px from DESIGN.md; rem-term + ≤2.5× rules are hard.
   - What's unclear: exact min/max viewport and per-tier vw coefficients (discretion).
   - Recommendation: derive with `buildClamp`, validate every tier `max ≤ 2.5×min`, check the emitted strings into both `globals.css` and the TS mirror.

2. **Lint severity/scope (A4)**
   - What we know: baseline is dirty; CONTEXT says scoped/not-big-bang.
   - What's unclear: `warn` everywhere vs `error` on a narrow clean glob.
   - Recommendation: `error` on new token/primitive dirs + `warn` (or off) elsewhere; ratchet per-surface in 52/53.

3. **Sidebar AA — RESOLVED**
   - What we know: all composed pairs pass (computed: 6.96 / 5.71 / 17.85 / 10.35); the one sub-AA cartesian pair (#94A3B8 on #334155 = 4.04) is never composed in `Sidebar.tsx` (active row switches to white text).
   - What's unclear: nothing for today's palette — a clean DS-05 pass on the existing sidebar.
   - Recommendation: assert only the composed pairs; add a guard comment noting the 4.04 non-composition so a future refactor that composes it trips the test. No token shift required.

## Environment Availability

> Skipped — this phase is code/config/test only (CSS tokens, TS mirror, ESLint rules, Vitest tests, a markdown audit). No external tools, services, runtimes, or CLIs beyond the already-present `tailwindcss`, `vitest`, and `eslint`, all verified installed. No fallbacks needed.

## Validation Architecture

> `workflow.nyquist_validation: true` confirmed in `.planning/config.json`. Section included.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest (`vitest run`) + ESLint `RuleTester` (run under Vitest) |
| Config file | `vitest.config.ts` |
| Quick run command | `npx vitest run tests/a11y/type-token-drift.test.ts tests/visual/globals-clamp-guard.test.ts` |
| Full suite command | `npm run test` (`vitest run`) + `npm run lint` (eslint over `src/`) |
| Coverage gate | `npm run test:coverage` — ratchet 82/80/74/72 (CLAUDE.md); hold it (BP-03 is continuous). |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| DS-01 | DESIGN.md refreshed; type tiers documented + Decisions Log row | drift (parse-verbatim) | `npx vitest run tests/a11y/type-token-drift.test.ts` | ❌ Wave 0 |
| DS-02 | Fluid `--text-*` in plain `@theme`, rem-term, ≤2.5× | grep guard | `npx vitest run tests/visual/globals-clamp-guard.test.ts` | ❌ Wave 0 |
| DS-03 | DESIGN.md ↔ @theme ↔ TS mirror agree; no `--text-*` in `@theme inline` | drift (3-way) | `npx vitest run tests/a11y/type-token-drift.test.ts` | ❌ Wave 0 |
| DS-04 | Ban raw hex / raw px font-size / rem-less clamp; allow-list works | ESLint RuleTester + CSS grep | `npx vitest run tools/eslint-plugin-quantalyze/tests/ tests/visual/globals-clamp-guard.test.ts` + `npm run lint` | ❌ Wave 0 |
| DS-05 | Sidebar/accent/semantic pairs ≥ AA (incl. dark sidebar) | contrast (hand-rolled) | `npx vitest run tests/a11y/palette-contrast.test.ts` | ❌ Wave 0 |
| TYPE-01 | Truncation audit doc exists + classifies every site | doc + optional grep census | manual review of `.planning/audits/truncation-audit.md` (+ optional `vitest` census count) | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** the specific new test for the task (e.g. `npx vitest run tests/visual/globals-clamp-guard.test.ts`).
- **Per wave merge:** `npm run test` + `npm run lint` (full Vitest + the new ESLint rules over `src/`).
- **Phase gate:** full suite green + coverage ratchet held + `npm run lint` clean before `/gsd:verify-work`.

### Wave 0 Gaps
- [ ] `src/lib/design-tokens/typography.ts` — TS mirror (`TYPE_SCALE as const`) — covers DS-02/DS-03.
- [ ] plain `@theme { --text-* }` block in `src/app/globals.css` — covers DS-02.
- [ ] `tests/a11y/type-token-drift.test.ts` — 3-way drift + no-inline guard — covers DS-01/DS-03.
- [ ] `tests/visual/globals-clamp-guard.test.ts` — rem-term + ≤2.5× — covers DS-02/DS-04.
- [ ] `tests/a11y/palette-contrast.test.ts` — sidebar/accent/semantic AA pairs — covers DS-05.
- [ ] `tools/eslint-plugin-quantalyze/rules/no-raw-font-px.mjs` + `no-rem-less-clamp.mjs` (+ optional `no-raw-hex.mjs`) + their `RuleTester` tests; register in `index.mjs`; wire + allow-list in `eslint.config.mjs` — covers DS-04.
- [ ] `.planning/audits/truncation-audit.md` (+ the `.planning/audits/` dir, which does not yet exist) — covers TYPE-01.
- [ ] DESIGN.md edits: new fluid-type-spine section + Decisions Log row — covers DS-01.

*Framework install: none needed (vitest + eslint + RuleTester already present).*

## Security Domain

> `security_enforcement` not set to `false`; this is a presentation/build-tooling phase with **no** auth, session, input-handling, crypto, network, or data-access surface. ASVS categories below are evaluated and found non-applicable.

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | — (no auth touched) |
| V3 Session Management | no | — |
| V4 Access Control | no | — |
| V5 Input Validation | no | Tokens are static literals; the only "input" is DESIGN.md/CSS the test parses — no user input. |
| V6 Cryptography | no | — |

### Known Threat Patterns for this stack
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Malicious lint-rule / build-time code execution from a new dep | Tampering / EoP | None introduced — phase adds **zero** dependencies (Package Legitimacy Audit: N/A). Reuses in-repo tooling only. |
| CSS injection via token value | Tampering | N/A — token values are author-controlled static literals in `globals.css`, not user data. |

**Net:** No new attack surface. The strongest security-relevant statement is the no-new-dependency posture (eliminates supply-chain risk entirely for this phase) — consistent with the project's Banned-Packages discipline in CLAUDE.md.

## Project Constraints (from CLAUDE.md / AGENTS.md)

- **Coverage ratchet (blocking CI gate):** lines 82 / statements 80 / functions 74 / branches 72 via `vitest.config.ts` thresholds; `frontend-coverage` job gates branch protection. Any new test file must not drop coverage; port tests in the same PR (BP-03).
- **DESIGN.md is the single source of truth** — read it before any visual/UI decision; in QA mode flag code that doesn't match it. This phase EDITS DESIGN.md (DS-01) — the Decisions Log append convention must be followed (date + decision + rationale row).
- **AGENTS.md / Next 16:** this is a modified Next 16 — read `node_modules/next/dist/docs/` before writing Next.js code. (This phase writes essentially no Next.js runtime code — CSS tokens, TS const, tests, lint — so the Next docs mandate is low-impact here, but honor it for any incidental component touch.)
- **Surgical changes / match conventions** (CLAUDE.md Rules 3, 11): mirror the existing token/test/lint patterns exactly; do not "improve" adjacent color tokens or the `--space-grid-gap` literal.
- **Fail loud** (Rule 12): the new tests must fail CI on real drift/AA regressions; never lower a gate to fit a design (REQUIREMENTS Out-of-Scope).
- **No banned packages / no new deps** — phase adds none; preserves the supply-chain posture.
- **Commit/ship workflow:** use `/ship` to commit, `/qa` after (user memory); never manual git commit. (Orchestrator-level, not researcher.)

## Sources

### Primary (HIGH confidence)
- `node_modules/tailwindcss/package.json` — confirmed tailwindcss **4.3.1** installed.
- `tailwindcss.com/docs/theme` — `@theme` vs `@theme inline` semantics (value-vs-var, flattening, the var-resolution-scope rationale for `inline`).
- `tailwindcss.com/docs/font-size` — the `--text-*` theme namespace generates `text-*` utilities.
- `w3.org/WAI/WCAG21/Techniques/failures/F94` — viewport-unit font sizes cannot be resized by zoom (1.4.4 failure).
- In-repo files read directly: `src/app/globals.css`, `src/lib/design-tokens/trust-tier.ts`, `tests/a11y/trust-tier-tokens.test.ts`, `tests/a11y/chart-contrast.test.ts`, `tests/a11y/wizard-contrast.test.ts`, `tests/visual/strategy-v2-type-scale.test.ts`, `tools/eslint-plugin-quantalyze/{index.mjs,rules/*,tests/*}`, `eslint.config.mjs`, DESIGN.md, REQUIREMENTS.md, STATE.md, 49-CONTEXT.md.
- Recon counts (ripgrep over `src/`): 355 hex occurrences / 54 files; 558 `text-[NNpx]`; truncation census (34 `truncate` files, 9 `line-clamp`, 2 `text-ellipsis`, 22 `overflow-hidden`, 24 `whitespace-nowrap`, 2 manual-ellipsis idiom).

### Secondary (MEDIUM confidence)
- `smashingmagazine.com/2023/11/addressing-accessibility-concerns-fluid-type` — the rem-term requirement AND the "max ≤ 2.5× min guarantees 1.4.4" rule (cross-verifies F94). HIGH-MEDIUM (authoritative author, corroborated by Roselli + W3C).
- `adrianroselli.com/2019/12/responsive-type-and-zoom` — viewport-unit zoom failure; `calc(1rem + Nvw)` mitigation; test-at-200%-zoom guidance.

### Tertiary (LOW confidence)
- WebSearch aggregate (testparty.ai, wcag.dock.codes, css-tricks clamp article) — used only to corroborate the 200%-resize requirement and the rem-vs-vw zoom behavior; all material claims independently confirmed by the primary/secondary sources above.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new deps; all tooling read directly from the repo at pinned versions.
- Architecture (`@theme`/`@theme inline`, clamp zoom-safety): HIGH — confirmed against Tailwind docs + W3C F94 + two authoritative a11y sources; one item (multi-`@theme` coexistence emitted-CSS) flagged to re-verify by inspecting the build (A3).
- Patterns/pitfalls: HIGH — every pattern mirrors a concrete in-repo precedent that was read line-by-line.
- AA pairs (DS-05): HIGH on method/enumeration; one open item (A5) is a real measurement the test will resolve.

**Research date:** 2026-06-28
**Valid until:** ~2026-07-28 (stable: Tailwind v4 token semantics + WCAG 1.4.4 are stable; the only volatility is the repo's own evolving raw-hex/px baseline, which only affects lint-scope sizing, not the approach).
