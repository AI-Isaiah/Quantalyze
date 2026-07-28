# Phase 49: Design-System Refresh + Fluid Token Foundation - Context

**Gathered:** 2026-06-28
**Status:** Ready for planning

<domain>
## Phase Boundary

Establish the locked token spine for v1.4. Deliver: (1) a refreshed DESIGN.md
that reads as a state-of-the-art system, (2) a fluid (clamp-based) type scale +
fixed space ladder expressed in a **plain** Tailwind v4 `@theme` block, (3) a
single-source-of-truth wiring DESIGN.md ↔ `@theme` ↔ a TS token mirror with a
drift test, (4) CI design-lint guards rejecting raw hex / raw px font-size /
`clamp()` missing its `rem` term, (5) a verified-AA palette, and (6) a
truncation-classification audit every later surface can rely on.

This is the spine. It deliberately does NOT touch per-surface application (that
is phases 50-53). FROZEN: `scenario.ts` (SCENARIO-05), `compute.ts` parity,
FactsheetBody (BODY-02), no-invented-data, no-peer-rank, and the v1.3 WCAG-AA
floor. Light mode only (no dark mode).
</domain>

<decisions>
## Implementation Decisions

### Aesthetic Refresh (user-accepted)
- **Evolve in place** — keep the Industrial/Utilitarian identity; the refresh
  formalizes fluid tokens, tightens the type scale + motion, and closes any AA
  gaps. Existing surfaces inherit the look for free (no per-surface visual
  rework in this phase). Lowest regression risk.
- **Keep all identity anchors** — Instrument Serif (display) + DM Sans (body/UI)
  + Geist Mono (data, tabular-nums) + muted teal accent `#1B6B5A`. All already
  AA-tuned and deliberately differentiated; do not swap fonts or shift the
  accent.

### Fluid Token Scale (user-accepted + discretion on mechanics)
- **Type fluid, space fixed** — only `--text-*` become `clamp()`-based. Keep the
  existing fixed 4px space ladder (and the `--space-grid-gap: 10px`
  designer-bundle token) so the 50+ existing layouts do not re-flow. Fluid
  section-rhythm space tokens may be added *additively* for new work, but
  existing fixed space tokens stay byte-stable.
- **Plain `@theme`, not `@theme inline`** — the fluid `--text-*` tokens MUST live
  in a plain `@theme` block. `globals.css` currently opens with `@theme inline`
  (line 3), which bakes literals and flattens the variable chain (W3C F94 /
  WCAG 1.4.4 would break). Colors may remain in `@theme inline`; the clamp type
  tokens get a sibling plain `@theme` block.
- **Every `clamp()` carries a `rem` middle term** — `clamp(<rem-min>,
  <rem>+<vw>, <rem-max>)`. The middle term must include a `rem` component so a
  user zoom to 400% scales text (WCAG 1.4.4). This is the single most important
  invariant of the fluid scale and what the lint guard enforces.
- **Named tier tokens** — mirror the existing DESIGN.md scale as named fluid
  tokens (hero / page-title / h2 / h3 / body / small / caption / micro) rather
  than an open-ended ramp, so existing consumers map 1:1. Tabular-num alignment
  preservation is a *consumer* concern flagged for phases 52/54; this phase only
  guarantees the tokens exist and are zoom-safe.

### Token SoT Wiring & Drift (discretion — grounded in existing patterns)
- **TS mirror** extends the existing `src/lib/design-tokens/` directory (sibling
  to `trust-tier.ts`), e.g. `src/lib/design-tokens/typography.ts` exporting the
  fluid tier tokens `as const`.
- **Drift test** follows the existing `tests/a11y/trust-tier-tokens.test.ts`
  pattern: parse DESIGN.md, parse the `@theme` block in `globals.css`, parse the
  TS mirror, and assert all three agree verbatim. Extend (not replace) the drift
  coverage so a divergence in any of the three fails CI.

### CI Design-Lint (user-accepted scope + discretion on impl)
- **Scoped + documented allow-list** — ban raw hex, raw px font-size, and
  `rem`-less `clamp()` in component source, with an allow-list for the chart +
  designer-bundle exceptions DESIGN.md already blesses (e.g. Recharts axis
  colors, `Allocator Dashboard.html` ports, the `--space-grid-gap` literal).
  Does NOT force a big-bang migration of all existing raw hex/px in Phase 49.
- **Implementation** extends the existing local plugin
  `tools/eslint-plugin-quantalyze` with new rules (consistent with how design
  invariants are already enforced) rather than adding stylelint (TOOL-F2
  deferred). Prefer an ESLint rule + a grep/Vitest assertion combo matching how
  existing token guards work.

### Truncation Audit — TYPE-01 (discretion)
- **Output**: a checked-in classification doc (e.g.
  `.planning/audits/truncation-audit.md`) inventorying every `truncate` /
  `line-clamp` / `text-ellipsis` / `overflow-hidden`+`whitespace-nowrap` site,
  each tagged **legitimate** (bounded label with a `title`/tooltip recovery, or
  intentional single-line affordance) vs **accidental-clip** (clips meaningful
  content with no recovery).
- **Role**: informs phases 52/53 (so fluid type never just relocates a clip); it
  is NOT a hard gate inside Phase 49.

### Claude's Discretion
- Exact clamp min/max viewport anchors, token file naming, lint rule message
  text, and audit doc structure are at Claude's discretion within the above
  constraints. Use ROADMAP success criteria + codebase conventions.
</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/app/globals.css` (581 lines) — current `@theme inline` block holds all
  `--color-*` tokens + `--radius-*` ladder; the new plain `@theme` fluid type
  block lands here as a sibling.
- `src/lib/design-tokens/trust-tier.ts` — the established "tokens `as const` +
  DESIGN.md drift test" pattern to extend for the type mirror.
- `tests/a11y/trust-tier-tokens.test.ts`, `tests/a11y/chart-contrast.test.ts`,
  `tests/a11y/wizard-contrast.test.ts` — existing DESIGN.md-parsing + WCAG-AA
  contrast assertion tests; the AA-everywhere check (DS-05) and drift test
  extend these.
- `tests/visual/strategy-v2-type-scale.test.ts` — existing grep-enforced type
  scale guard; precedent for a no-clip / token-conformance grep test.
- `tools/eslint-plugin-quantalyze` — the local ESLint plugin the design-lint
  rules extend.

### Established Patterns
- Tailwind v4 `--color-*`-prefixed token convention (2026-05-06 decision): every
  color CSS var consumed in a component MUST use `--color-*`; bare names resolve
  to `currentColor`/black. The fluid type tokens follow the same `--text-*`
  naming discipline.
- DESIGN.md is the documented single source of truth; token consistency is
  asserted by a Vitest test that reads DESIGN.md and greps for the verbatim
  value. Decisions Log table at the bottom of DESIGN.md records every token
  change with rationale + date.
- WCAG-AA shifts are already documented per-token in DESIGN.md (e.g.
  text-muted, positive, warning all shifted 2026-04-30 to clear AA).

### Integration Points
- DESIGN.md (refresh + Decisions Log entry for the fluid spine).
- `src/app/globals.css` (`@theme` plain block + keep `@theme inline` for colors).
- `src/lib/design-tokens/` (new TS type mirror).
- `tools/eslint-plugin-quantalyze` + `eslint.config.mjs` (new lint rules).
- `tests/a11y/` + `tests/visual/` (drift + AA + zoom-safe assertions).
- `.planning/audits/truncation-audit.md` (new TYPE-01 artifact).
</code_context>

<specifics>
## Specific Ideas

- The `@theme inline` vs plain `@theme` distinction is the load-bearing subtlety:
  inline flattens the var chain and bakes literals, defeating fluid scaling and
  the 400%-zoom WCAG 1.4.4 guarantee. The drift test should also fail if the
  fluid type tokens drift back into an `@theme inline` block.
- Reference aesthetic (unchanged): FactSet, Stripe Dashboard, Bloomberg Terminal
  web — institutional credibility, not crypto-dark, not SaaS-soft.
</specifics>

<deferred>
## Deferred Ideas

- Per-surface fluid-type realization (TYPE-02/03/04) — phase 52.
- Primitive refresh on the new tokens (UI-01) — phase 50.
- Full whole-codebase raw-hex/px migration — deferred behind the scoped lint
  allow-list; happens per-surface in phases 52/53 (strangler), not big-bang.
- stylelint token enforcement (TOOL-F2) and component catalog/Storybook
  (TOOL-F1) — deferred to a later milestone per REQUIREMENTS.md.
- Dark mode — out of scope (institutional light mode only).
</deferred>
