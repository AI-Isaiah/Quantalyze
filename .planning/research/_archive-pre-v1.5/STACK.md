# Technology Stack — v1.4 Frontend Excellence

**Project:** Quantalyze (institutional quant-strategy marketplace; Next.js financial dashboard)
**Milestone:** v1.4 Frontend Excellence — presentation-layer overhaul of a shipped app
**Researched:** 2026-06-28
**Overall confidence:** HIGH (Tailwind v4 / fluid-type behavior verified against current docs; versions pinned via `npm view`; existing wiring read from source)

> **Framing.** This is a SUBSEQUENT-milestone STACK doc for an existing, shipped frontend — not a
> greenfield pick. The default answer to "what should we add?" is **almost nothing**: the platform
> already gives us fluid type, design tokens, container queries, and tasteful motion natively. The
> single highest-leverage finding is a Tailwind-v4 *wiring* change (`@theme` vs `@theme inline`),
> not a new package. Where a dependency is warranted, it is exactly one (Radix UI), scoped to the
> handful of hand-rolled widgets that have no native HTML equivalent — and even that is a *stance*,
> not a rewrite mandate.

---

## Existing stack (confirmed from source — DO NOT re-pick)

| Layer | What's installed | Confirmed how |
|-------|-----------------|---------------|
| Framework | `next@16.2.9`, `react@19.2.7`, `react-dom@19.2.7`, `typescript@6` | `node_modules/*/package.json` |
| CSS engine | `tailwindcss@4.3.1` + `@tailwindcss/postcss@4.3.1`, **no `tailwind.config.js`** (pure CSS-first v4) | `find` returned no config; `postcss.config.mjs` has only `@tailwindcss/postcss` |
| Tokens | `@theme inline { … }` in `src/app/globals.css` — `--color-*`, `--font-*`, `--spacing-*`, `--shadow-*`, `--radius-*` | read `globals.css` |
| Fonts | `next/font/google`: DM Sans (`--font-dm-sans`), Instrument Serif (`--font-instrument-serif`), Geist Mono (`--font-geist-mono`), wired into `@theme` via `--font-sans/serif/mono` | `src/app/layout.tsx` |
| Charts | `recharts@3.9.0` + ~16 hand-rolled SVG charts + `lightweight-charts@5.2.0` | package.json + memory |
| Primitives | **Hand-rolled** in `src/components/ui/` (Button, Card, Modal, Select, Input, Tooltip, Textarea, Badge, …). No Radix, no shadcn today. 266 component files. | `ls src/components/ui` |
| Lint | ESLint 9 flat config + **local `eslint-plugin-quantalyze`** (5 by-construction `no-raw-*` rules at `error`) | `eslint.config.mjs` + `tools/eslint-plugin-quantalyze/` |
| Design CI | Vitest grep tests (`tests/visual/strategy-v2-type-scale.test.ts`, `chart-accessibility-layer.test.ts`), a11y token tests (`tests/a11y/*-contrast.test.ts`, `trust-tier-tokens.test.ts`), `@axe-core/playwright` app-wide matrix, `@lhci/cli@0.15.1` mobile budget | `ls tests/` + memory |

**Two existing patterns the roadmapper must respect:**

1. **The `@theme inline` gotcha is already documented and load-bearing.** DESIGN.md decision-log
   (2026-05-06) + the dark-factsheet block in `globals.css` (lines ~481–580) prove the team
   already hit it: `@theme inline` **bakes the resolved value literally into each utility class**,
   so you cannot runtime-override a token by reassigning the CSS variable on an ancestor. The dark
   factsheet works around this with scoped `!important` utility overrides. **This single fact drives
   the fluid-typography recommendation below.**
2. **`clamp()` exists nowhere in CSS today** (the two `clamp(` grep hits are `Math`/numeric clamps in
   `.ts`). **`@container` exists nowhere today.** Both are net-new capabilities to introduce — and
   both are native, zero-dependency.

---

## Recommended stack changes

### Summary verdict table

| Area | Verdict | Net new dependency? |
|------|---------|--------------------|
| 1. Fluid typography (`clamp()` type scale) | **ADD — pure CSS, a wiring change** | **None** (CSS only; Utopia is a copy-paste generator) |
| 2. Design-token architecture (color/space/radius/shadow) | **EVOLVE in place** | None |
| 3. Component primitives (menus/tabs/tooltips/combobox/dialog) | **ADOPT Radix, scoped & incremental** | **`radix-ui@1.6.0`** (one unified pkg) — the only justified dep |
| 4. Container queries (`@container`) | **ADD — native v4 utilities** | None |
| 5. Motion / micro-interactions | **CSS transitions + native View Transitions API** | None (do NOT add a motion lib) |
| 6. Visual-regression + design-lint | **Playwright screenshots + extend the local ESLint plugin** | None for VR; **`stylelint@17` optional** |
| 7. What NOT to add | see the explicit kill-list | — |

---

## 1. Fluid typography — pure CSS, no dependency

**Recommendation: ADD a `clamp()`-based fluid type + space scale, expressed as Tailwind v4 `--text-*`
and `--spacing-*` tokens in a *non-inline* `@theme` block. No package required.**

**Why it's pure CSS (verified):** Tailwind v4's `--text-*` namespace accepts a `clamp()` expression
directly, and the generated `text-*` utility sets font-size from it; you pair line-height via the
`--text-{name}--line-height` companion var, plus optional `--…--letter-spacing` / `--…--font-weight`
(verified at tailwindcss.com/docs/font-size). Utopia (utopia.fyi) — the canonical fluid-scale
methodology — emits **pure CSS `clamp()` custom properties** with no JS/runtime dependency; it is a
copy-paste *generator*, not a library. So the whole feature is: pick min/max viewport + two type
scales, paste the resulting `clamp()` values into `@theme`. **Confidence: HIGH.**

**The critical wiring nuance (this is the real finding):**

- `@theme { --text-h2: clamp(1.25rem, 1rem + 1.2vw, 1.5rem); }` → Tailwind emits the value **as a
  CSS variable** AND the `text-h2` utility references that variable → **the `clamp()` resolves at
  render against the live viewport → text scales fluidly.** ✅ This is what we want.
- `@theme inline { --text-h2: clamp(…); }` → Tailwind **inlines the literal `clamp()` string into
  the utility class**. A bare `clamp(…)` literal still works (it's self-contained), **but** if your
  token is `clamp(…, var(--step), …)` referencing another fluid var, `inline` flattens the
  indirection and you lose the single-source-of-truth chain. The codebase's current `@theme inline`
  block is fine for the *static* color tokens it holds, but **the fluid type/space tokens should go
  in a plain `@theme` block** (you can have both blocks in the same file).

**Integration point:** Add a second, non-inline `@theme` block in `globals.css` (above or below the
existing `@theme inline`). Map the eight DESIGN.md fixed-px steps (48/32/24/16/14/13/12/10–11) onto
named fluid tokens, e.g.:

```css
@theme {
  /* Fluid type — Utopia-style clamp(min, preferred, max). Replaces the
     fixed-px scale in DESIGN.md §Typography. min≈320px viewport, max≈1440px. */
  --text-hero:    clamp(2rem,    1.4rem  + 3vw,   3rem);    /* 32 → 48 */
  --text-title:   clamp(1.5rem,  1.2rem  + 1.5vw, 2rem);    /* 24 → 32 */
  --text-h2:      clamp(1.25rem, 1.1rem  + 0.7vw, 1.5rem);  /* 20 → 24 */
  --text-h3:      clamp(1rem,    0.95rem + 0.25vw,1.125rem);/* 16 → 18 */
  --text-body:    clamp(0.875rem,0.85rem + 0.12vw,0.9375rem);
  /* … small / caption / micro … */
  --text-h2--line-height: 1.2;

  /* Fluid space — same clamp() approach for section gaps / card padding */
  --spacing-section: clamp(1.5rem, 1rem + 2.5vw, 2rem); /* 24 → 32 */
}
```

(Exact values are a design-consultation output, not a research output — DESIGN.md is being refreshed
this milestone. The point is the *mechanism*.)

**Why this beats the alternatives:**
- vs. a JS fluid-type lib (e.g. a `vw`-calc hook): pointless — CSS `clamp()` does it natively, no
  runtime, no hydration risk, no bundle cost, SSR-perfect.
- vs. Tailwind's per-breakpoint `text-sm md:text-base lg:text-lg`: that *steps* at breakpoints
  (the exact stair-stepping that causes clipping between breakpoints, which v1.4 set out to kill);
  `clamp()` is continuous → satisfies the "zero truncation, scales across all resolutions" requirement.
- vs. keeping fixed px: that *is* the v1.4 bug (text clips/ellipsizes at constrained widths).

**Caveat to flag for the phase:** WCAG 1.4.4 (Resize Text up to 200%) — a `vw`-only font-size can fail
zoom because viewport units don't grow under zoom. Utopia's `clamp(min, Xrem + Yvw, max)` form (note
the **`rem` term** in the preferred value) is the standard fix and keeps zoom honest. The existing
400%-zoom CI gate (v1.3) will catch regressions; ensure the fluid tokens use the `rem + vw` form,
not pure `vw`.

---

## 2. Design-token architecture — evolve in place, no new dep

**Recommendation: KEEP the CSS-first `@theme` token model. Evolve it; do not introduce a JS token
pipeline (Style Dictionary et al.).**

The current model is already best-practice for Tailwind v4: tokens are CSS variables in `@theme`,
single-sourced in `globals.css`, and DESIGN.md ↔ token drift is already grep-asserted by Vitest
(`trust-tier-tokens.test.ts` reads DESIGN.md and asserts each hex appears verbatim). That is exactly
the "single source of truth wired from DESIGN.md" the question asks for — it exists.

**Evolution work (not a stack change):**
- Split the `@theme` blocks by *resolution behavior*: **static tokens** (color, radius, shadow, font
  families) stay in `@theme inline`; **fluid tokens** (type, space) go in a plain `@theme` block (per
  §1). Document the split so nobody "tidies" them back together and silently flattens the fluid chain.
- Extend the existing DESIGN.md↔token grep test to cover the new fluid scale (so the refreshed
  DESIGN.md type table stays the source of truth, same pattern as trust-tier tokens).

**Do NOT add Style Dictionary / Tokens Studio / a JSON token build step.** Verdict: skip. It buys a
design-tool round-trip (Figma sync) the project doesn't need (DESIGN.md is the human SoT, already
grep-locked), and it adds a build stage + a second token format to keep in sync with `@theme`. Native
CSS variables already *are* the runtime token format Tailwind consumes. **Confidence: HIGH.**

---

## 3. Component primitives — adopt Radix, scoped and incremental

**Recommendation: ADOPT `radix-ui@1.6.0` (the unified package) for the *specific* interactive widgets
that have no accessible native HTML element — and ONLY those. This is a stance, not a rewrite mandate.
Keep everything that's already native.**

**The honest split (read from source):**

| Hand-rolled today | Built on | Keep or migrate? |
|-------------------|----------|------------------|
| `Modal.tsx` | native `<dialog>` + `showModal()` | **KEEP** — native dialog gives focus-trap, `::backdrop`, Esc, inert for free. It's correct. |
| `Select.tsx` | native `<select>` + `<label htmlFor>` + `useId` | **KEEP** — native select is the most accessible, mobile-best option. |
| `Input` / `Textarea` / `Button` / `Badge` / `Card` | native elements | **KEEP** |
| Tabs (`AdminTabs`, `ProfileTabs`, `WatchlistTabs`, allocator tabstrip) | hand-rolled `role=tablist` | **Candidate** — roving-tabindex / arrow-key semantics are the classic hand-rolled-tab bug surface (memory shows JOURNEY-03 axe caught real `role=tablist` violations on `/allocations`). |
| `Tooltip.tsx` + `TouchTooltip.tsx` | hand-rolled | **Candidate** — positioning + Esc + hover-intent + touch are hard to get fully right; but a tooltip is low-risk and v1.3's `TouchTooltip` already solved the touch path. Migrate only if it reduces code. |
| Any custom dropdown menu / popover / combobox | hand-rolled | **Strong candidate** — these are the WCAG-AA traps with NO native element (menu arrow-keys, type-ahead, focus return, `aria-activedescendant`). |

**Why Radix specifically (verified):**
- `radix-ui@1.6.0` is the **single tree-shakable package** that re-exports every primitive (no
  `node_modules` bloat / version-skew across `@radix-ui/react-*`). React 19 is in its declared peer
  range (`react: ^16.8 || ^17 || ^18 || ^19`), so it installs clean on `react@19.2.7` with no
  `--legacy-peer-deps`. Headless + unstyled → it composes with the existing Tailwind/`@theme` token
  classes and DESIGN.md visual contract; we style it, Radix owns only the a11y behavior.
- It is the foundation shadcn builds on — so if a future maintainer reaches for shadcn copy-in
  components, the Radix layer is already present and consistent.

**Why NOT shadcn-the-CLI as the primary mechanism:** shadcn is a **copy-in component generator**, not
a dependency; its components ship with default styling + `cn()`/`tailwind-merge`/`clsx` conventions
and a `components.json` that assume a shadcn-shaped project. Dropping shadcn components into a codebase
with 266 bespoke components and a strict DESIGN.md/token contract means importing *their* visual
opinions and then stripping them back to DESIGN.md — more churn than styling Radix directly. **Use
shadcn only as a reference to crib a specific Radix-composition pattern, copying the behavior, not the
styles.** (Adopting Radix does NOT obligate `tailwind-merge`/`clsx` — the repo already has its own
`cn` in `@/lib/utils`.)

**Why not Ariakit / React Aria as the pick:** both are excellent and React-19-ready (`@ariakit/react@0.4.30`),
but Radix is the ecosystem default, has the unified single-package install, and is what the team's
likely-reached-for shadcn assumes. Picking one headless lib and not blending is the right call (no
two-headless-lib codebase). **Confidence: HIGH** on Radix being the right choice; **MEDIUM** on exact
per-widget migration list (that's a phase-level audit, not research).

**Guardrails for the roadmapper:**
- **Incremental, behavior-equivalent migration** — replace one widget family at a time, each behind
  the existing app-wide axe gate and the WCAG-AA floor (must-not-regress per PROJECT.md). Native
  `<dialog>`/`<select>` migrations are NOT worth doing — leave them.
- **Charts are out of scope** — Recharts + the 16 SVG charts + their v1.3 `useTapPin`/`TouchTooltip`
  touch paths are frozen-math presentation and already a11y-gated; Radix is for *chrome* widgets,
  never charts.

---

## 4. Container queries — native Tailwind v4, no dependency

**Recommendation: ADOPT `@container` for component-level responsiveness. Zero dependency.**

Verified: in Tailwind v4 the `@tailwindcss/container-queries` plugin is **folded into core** — `@container`
on a parent + `@sm:`/`@md:`/`@max-md:`/`@min-[475px]:` variants on children, named containers
(`@container/main` → `@sm/main:`), and size-container (`cqb`) units are all built in. Nothing to install.
**Confidence: HIGH.**

**Why it's the right tool for v1.4 specifically:** v1.3 already solved *viewport*-level responsiveness
(`useBreakpoint`, `ResponsiveTable`, reflow gates). The remaining "layouts hold small → ultra-wide"
work is largely *component-context* responsiveness — a KPI strip, factsheet panel, or widget that
should reflow based on **its own column width**, not the window. That is exactly the container-query
use case, and it is what lets one component render correctly whether it's in a 4-col grid, a 2-col
grid, or a full-width drawer — without viewport-coupled `useBreakpoint` branches.

**Why it beats the existing `useBreakpoint`:** `useBreakpoint` is JS, window-coupled, and SSR-two-pass
(it returns a default on the server). `@container` is pure CSS, SSR-perfect, no hydration pass, and
reacts to the *actual* slot width. **Recommendation: prefer `@container` for new component-internal
layout; keep `useBreakpoint` only where genuinely window-global (e.g. show/hide the mobile bottom
nav).** This also *reduces* JS over time. **Confidence: HIGH.**

---

## 5. Motion / micro-interactions — native only, no library

**Recommendation: CSS transitions for state/hover (already the house style) + the native CSS View
Transitions API for the few cases that warrant a shared-element/route transition. Do NOT add a motion
library.**

DESIGN.md §Motion is deliberately minimal ("only transitions that aid comprehension … no decorative
animation … no bouncing, no scroll-triggered effects") with a fixed duration/easing ladder
(50/150/250/400ms). That intent is the constraint, and it maps perfectly to native CSS — the codebase
already does this (`transition-colors`, `mandate-saved-flash` keyframes, `prefers-reduced-motion`
handling in `globals.css`). Nothing to add for micro-interactions.

**For navigation/tab/panel transitions** (a genuine v1.4 polish surface), the native option is:
- **CSS View Transitions API** — `view-transition-name` + CSS keyframes, zero JS, composes with the
  App Router. Next.js 16 exposes `experimental.viewTransition` in `next.config` to trigger it on route
  navigation (verified — nextjs.org/docs/app/guides/view-transitions). This is the DESIGN.md-aligned
  choice: declarative, in-stylesheet, honors `prefers-reduced-motion` natively.
- **Do NOT reach for React's `<ViewTransition>` component** — verified **experimental / React-Canary
  only** as of React 19.2 (the app is on stable `react@19.2.7`). Use the *CSS* View Transitions API
  (and optionally Next's config flag) instead; revisit the React component when it stabilizes.

**Why NOT `motion`/Framer Motion (`motion@12.42.0`), GSAP, etc.:** a ~30–50KB+ animation runtime for
an explicitly anti-decoration design system is pure bloat. Every motion DESIGN.md sanctions is a CSS
transition or a short keyframe. Adding a motion lib would also invite the decorative animation
DESIGN.md bans. **Verdict: skip.** **Confidence: HIGH.**

---

## 6. Visual-regression + design-lint — extend what exists

**Recommendation (VR): use Playwright screenshot diffing — already installed (`@playwright/test@1.61.1`).
Do NOT add Chromatic/Storybook.**

The project has no Storybook and a strong CI-grep design-conformance culture. Playwright's built-in
`toHaveScreenshot()` gives deterministic, in-repo visual-regression diffing on the *real* routes
(reusing the existing app-wide route×viewport matrix that already drives axe), with no third-party
service, no Storybook maintenance, no per-snapshot SaaS cost. **Confidence: HIGH** that Playwright VR
is the right fit; **MEDIUM** on operational cost (screenshot tests are notoriously flaky across font
rendering / OS — mitigate by pinning the CI browser (already containerized) and masking dynamic regions
like timestamps/sparklines; v1.3 already used per-panel chart-snapshot parity with ±2–5% tolerance, so
the pattern and its tolerances are established here).

- Now that **desktop byte-identity is LIFTED** (v1.4), the old "byte-identical" pins (BODY-02 etc.)
  loosen into *tolerance-based* visual diffs — flag this to the roadmapper as a test-migration task,
  not a new tool.

**Recommendation (design-lint): EXTEND the local `eslint-plugin-quantalyze` with token-enforcement
rules. Optionally add `stylelint@17.14.0` for the raw-CSS surface.**

The repo already has the perfect machine for this: a local ESLint plugin with `no-raw-*` rules at
`error` that point offenders at the canonical helper. The natural v1.4 additions:
- a `no-raw-hex-color` / `no-raw-px-font-size` rule (catch hardcoded `#…` or `style={{fontSize}}` /
  arbitrary `text-[13px]` that bypass the `--color-*` / fluid `--text-*` tokens), mirroring the
  existing 2026-05-06 `var(--color-*)`-prefix discipline that's currently only enforced by review.
- This is *cheaper and more native* than a separate tool because the plugin, its `error`-level CI
  gate, the test-file exemptions, and the `sanctioned-exception:` escape-hatch convention all already
  exist — you're adding a rule, not a toolchain.

`stylelint` is **optional**: ESLint+JSX rules don't see inside `globals.css`'s raw CSS (the
hand-rolled `.mandate-slider`, `.prose-note`, dark-factsheet blocks). If raw-CSS token drift becomes a
real problem, `stylelint@17` with `declaration-property-value-disallowed-list` (ban literal hex outside
`@theme`) is the targeted fix. **Verdict: defer stylelint until raw-CSS drift is observed; lead with
the ESLint-plugin rule.** **Confidence: MEDIUM** (the ESLint-rule extension is clearly right; stylelint
is a judgment call on whether the raw-CSS surface justifies a second linter).

---

## 7. What NOT to add — explicit kill-list

| Candidate | Why people reach for it | Verdict & reason |
|-----------|------------------------|------------------|
| **Style Dictionary / Tokens Studio / JSON token build** | "design tokens need a pipeline" | **SKIP.** `@theme` CSS vars already are the runtime token SoT; DESIGN.md↔token drift is already grep-locked. Adds a build stage + a 2nd format. |
| **shadcn/ui as a dependency / wholesale install** | "the modern component kit" | **SKIP as a kit** (use as a *reference* only). It's copy-in components with their own styling opinions; conflicts with 266 bespoke components + strict DESIGN.md. Adopt the underlying Radix directly instead (§3). |
| **`motion`/Framer Motion, GSAP, react-spring, Lottie, AutoAnimate** | "smooth micro-interactions" | **SKIP.** DESIGN.md is explicitly anti-decoration; every sanctioned motion is a CSS transition/keyframe or the native View Transitions API. A motion runtime is pure bloat + invites banned decorative animation. |
| **React's experimental `<ViewTransition>` component** | "React-native page transitions" | **SKIP for now.** Canary/experimental only; app is on stable React 19.2. Use the *CSS* View Transitions API + Next `experimental.viewTransition` instead. |
| **`@tailwindcss/container-queries` plugin** | "container queries" | **SKIP — already in v4 core.** Installing it is redundant/conflicting. |
| **`@tailwindcss/typography` (`prose`)** | "rich text styling" | **SKIP.** Already deliberately avoided — `.legal-article` / `.prose-note` are hand-rolled in `globals.css` precisely to dodge this dep. Keep that. |
| **A CSS-in-JS runtime (styled-components / Emotion)** | "component-scoped styles" | **SKIP.** Tailwind v4 + `@theme` is the styling system; a runtime CSS-in-JS layer fights RSC/streaming and adds bundle weight. |
| **Dark mode infrastructure (next-themes, etc.)** | "every app needs dark mode" | **SKIP.** DESIGN.md: "Dark mode: Not planned. Institutional finance is light mode." (The one scoped dark-factsheet override stays as-is; do not generalize it.) |
| **A second headless lib alongside Radix (Ariakit + React Aria + Radix)** | "best primitive per widget" | **SKIP.** Pick Radix, don't blend headless libs (consistency > marginal per-widget gains; Rule 7). |
| **An icon library (lucide/heroicons) wholesale** | "we need icons" | **NEUTRAL — out of scope here.** Charts/SVGs are hand-rolled inline; icon strategy is a design-consultation call, not a stack-research mandate. Don't add one speculatively. |

**Frozen — never touched by the visual layer:** `src/lib/scenario.ts` (SCENARIO-05 zero-diff),
`compute.ts` parity, the Recharts/SVG chart *math*. v1.4 is presentation-only over a frozen engine,
and the v1.3 WCAG-AA floor must not regress.

---

## Installation (the entire net-new footprint)

```bash
# The ONLY production dependency this milestone warrants — and only if/when the
# primitive-migration phase (§3) actually lands a Radix-backed widget:
npm install radix-ui            # 1.6.0 — unified, tree-shakable, React 19 peer-clean

# Optional, defer until raw-CSS token drift is observed (§6):
# npm install -D stylelint       # 17.14.0
```

Everything else in this doc is **zero-install**: fluid type (`clamp()` in `@theme`), container queries
(`@container`, in v4 core), motion (CSS transitions + native View Transitions API), visual regression
(`@playwright/test`, already present), and design-lint (extend the existing local `eslint-plugin-quantalyze`).

---

## Alternatives considered

| Category | Recommended | Alternative | Why not the alternative |
|----------|-------------|-------------|------------------------|
| Fluid type | `clamp()` in `@theme` (pure CSS) | Per-breakpoint `text-sm md:text-base …` | Steps at breakpoints → the clipping/stair-stepping v1.4 set out to kill |
| Fluid type | `clamp()` in `@theme` (pure CSS) | JS `vw`-calc hook | Native CSS does it with zero runtime / no hydration risk |
| Tokens | CSS `@theme` vars (in place) | Style Dictionary / Tokens Studio | Adds a build stage + 2nd format; CSS vars already the runtime SoT; drift already grep-locked |
| Primitives | `radix-ui@1.6.0` (scoped) | shadcn/ui install | Copy-in styling opinions conflict with bespoke DESIGN.md; Radix is shadcn's own base — adopt it directly |
| Primitives | `radix-ui@1.6.0` | Ariakit / React Aria | All R19-ready; Radix is the ecosystem default + single-package install + shadcn-compatible |
| Container resp. | `@container` (v4 core) | `useBreakpoint` everywhere | JS, window-coupled, SSR-two-pass; container queries are CSS + react to actual slot width |
| Motion | CSS transitions + native View Transitions API | `motion`/Framer Motion | 30–50KB+ runtime for an anti-decoration design system = bloat + temptation |
| Visual regression | Playwright `toHaveScreenshot()` | Chromatic + Storybook | No Storybook today; SaaS cost + maintenance; Playwright reuses the real-route axe matrix |
| Design-lint | Extend `eslint-plugin-quantalyze` | Standalone stylelint-first | The local plugin + `error`-gate + exemption conventions already exist; add a rule, not a toolchain |

---

## Confidence assessment

| Area | Confidence | Basis |
|------|------------|-------|
| Fluid type is pure CSS via `@theme` `--text-*` clamp | HIGH | tailwindcss.com/docs/font-size + utopia.fyi verified; behavior matches v4 docs |
| `@theme` vs `@theme inline` resolution behavior | HIGH | tailwindcss.com/docs/theme verified + corroborated by the codebase's own 2026-05-06 decision-log + dark-factsheet workaround |
| `@container` is in v4 core (no plugin) | HIGH | tailwindcss.com/docs/responsive-design verified |
| `radix-ui@1.6.0` exists, unified, React-19 peer-clean | HIGH | `npm view radix-ui version` + `peerDependencies` |
| View Transitions: CSS native = stable; React `<ViewTransition>` = experimental | MEDIUM-HIGH | Next.js docs + React 19.2 release coverage (web sources agree; React component flagged Canary) |
| Per-widget Radix migration list | MEDIUM | Source-read of `src/components/ui` + memory of past axe findings; exact list is a phase audit |
| stylelint necessity | MEDIUM | Judgment call on whether the raw-CSS surface justifies a 2nd linter |

## Gaps to address (defer to phase-level work, not stack research)

- **Exact fluid scale numbers** (min/max viewport, two type ratios, per-step clamp values) — a
  design-consultation output once DESIGN.md is refreshed; this doc fixes the *mechanism*, not the values.
- **Which specific hand-rolled widgets migrate to Radix** — a per-widget a11y audit during the
  primitive-migration phase; native `<dialog>`/`<select>` explicitly stay.
- **Visual-regression snapshot tolerances + dynamic-region masking** — needs a CI-stability spike;
  reuse v1.3's ±2–5% chart-snapshot precedent.
- **Migration of byte-identity pins (BODY-02 etc.) to tolerance diffs** now that desktop byte-identity
  is lifted — a test-suite refactor task for the roadmap.

## Sources

- Tailwind CSS v4 theme variables — https://tailwindcss.com/docs/theme (HIGH)
- Tailwind CSS v4 font-size / `--text-*` + clamp + line-height — https://tailwindcss.com/docs/font-size (HIGH)
- Tailwind CSS v4 container queries in core — https://tailwindcss.com/docs/responsive-design (HIGH)
- Utopia fluid type/space methodology (pure CSS clamp) — https://utopia.fyi/blog/designing-with-fluid-type-scales/ (HIGH)
- Radix Primitives releases / React 19 — https://www.radix-ui.com/primitives/docs/overview/releases ; https://github.com/radix-ui/primitives/issues/2900 (MEDIUM-HIGH)
- shadcn/ui Tailwind v4 + React 19 + Radix base + copy-in model — https://ui.shadcn.com/docs/tailwind-v4 (HIGH)
- Next.js 16 View Transitions config — https://nextjs.org/docs/app/guides/view-transitions ; https://nextjs.org/docs/app/api-reference/config/next-config-js/viewTransition (MEDIUM-HIGH)
- Version pins — `npm view <pkg> version` on 2026-06-28: `radix-ui@1.6.0`, `tailwindcss@4.3.1`, `tailwind-merge@3.6.0`, `clsx@2.1.1`, `@ariakit/react@0.4.30`, `motion@12.42.0`, `stylelint@17.14.0` (HIGH)
- Existing wiring — `src/app/globals.css`, `src/app/layout.tsx`, `postcss.config.mjs`, `eslint.config.mjs`, `src/components/ui/{Modal,Select}.tsx`, `DESIGN.md`, `.planning/PROJECT.md` (HIGH)
</content>
</invoke>
