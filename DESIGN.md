# Design System — Quantalyze

## Product Context
- **What this is:** Exchange-verified quant strategy marketplace
- **Who it's for:** Institutional/semi-institutional crypto allocators and quant fund managers
- **Space/industry:** Fintech, quantitative finance, crypto asset management
- **Project type:** Web app (dashboard + public discovery + factsheets)
- **Competitors:** quants.space (dark/crypto-native), TradeLink.pro (soft/SaaS), Darwinex (polished fintech)
- **Positioning:** Institutional credibility. Not crypto-dark, not SaaS-soft. Financial data platform that takes itself seriously.

## Aesthetic Direction
- **Direction:** Industrial/Utilitarian
- **Decoration level:** Minimal — typography and data do all the work. No gradients, no blobs, no decorative elements. Subtle borders and hairline dividers only.
- **Mood:** Opening a well-organized financial report. Trustworthy, precise, data-dense. The numbers speak for themselves.
- **Reference sites:** FactSet, Stripe Dashboard, Bloomberg Terminal web

## Generative Principle — every surface is a dated document
This is the root principle every other token derives from. The factsheet — the
strongest surface in the app — reads like a signed, dated report: a masthead
eyebrow, a two-weight rule frame, a provenance pill on the title, a freshness
stamp toned by age, a footer stamp carrying an ID + page number, print
hardening, and copy that states its own limits. Every screen should carry that
same posture.

**Five-second test:** *would this screen survive being printed and handed to an
LP?* If a surface would embarrass us on paper — decorative filler, a claim with
no date, a metric with no provenance, a cheerful empty state — it fails.

This principle is WHY the tokens are what they are: the mono eyebrows, the
near-black document frame, the em-dash null rule, the semantic-color gates, the
serif masthead all exist to make each surface legible as a dated, sourced,
signable document. New design decisions derive from this test first, then reach
for the token that serves it.

## Typography

**Three voices, fixed roles, never mixed.** Each typeface owns one job and does
not stray into another's:
1. **Instrument Serif** — display voice. Page titles, landing hero, strategy
   names / mastheads. Editorial gravitas; nobody in this space uses a serif —
   that's the point.
2. **DM Sans** — interactive voice. Form labels, menu items, buttons, body
   prose, nav. Anything the user reads to *act*.
3. **Geist Mono, uppercase, letter-tracked** — data-annotation voice. Data
   eyebrows and micro-labels above/beside numbers (`FactsheetView.tsx:575,878,1027`),
   plus all tabular figures. Anything that *labels or is* data.

The failure mode is putting DM Sans on a data eyebrow (reads like a form
control) or the mono on a form label (reads like a value). Keep the voices in
their lanes.

- **Display/Hero:** Instrument Serif — editorial gravitas without being stuffy. Used only for page titles, landing hero, strategy names in detail view. Nobody in this space uses a serif... that's the point.
- **Body:** DM Sans — clean geometric sans, slightly warmer than Inter. Replaces Inter everywhere. Excellent readability at all sizes.
- **Interactive labels:** DM Sans (medium weight) — form labels, menu items, buttons, nav, tabs. The voice for anything the user reads to act on. NOT the mono.
- **Data eyebrows & micro-labels:** Geist Mono, **uppercase**, letter-tracked (see tracking ladder below) — the small labels that sit above or beside data (KPI captions, section eyebrows, strip headers). This is the factsheet's signature annotation voice, not DM Sans.
- **Data/Tables:** Geist Mono (tabular-nums) — sharper than JetBrains Mono for financial data. Designed for UI, not coding. All numbers in the product use this.
- **Code:** Geist Mono
- **Loading:** Google Fonts CDN via next/font
- **Scale:**
  - Hero: 48px (landing), 32px (page titles)
  - H2: 24px
  - H3: 16px (semibold)
  - Body: 14px
  - Small: 13px
  - Caption: 12px
  - Micro: 10-11px (labels, badges, uppercase tracking)

### Tracking ladder (uppercase mono eyebrows)
Uppercase Geist Mono eyebrows carry deliberate letter-spacing — the tighter the
strip, the tighter the track. Three fixed steps:

| Token | Tracking | Use |
|-------|----------|-----|
| Eyebrow tight | `0.14em` | dense strips (multi-cell KPI rows where space is scarce) |
| Eyebrow std | `0.18em` | the default eyebrow / micro-label |
| Eyebrow masthead | `0.22em` | the document title's masthead eyebrow (widest, most formal) |

Wider tracking = more ceremony. Pick by the strip's density, not by taste.

### Real primitives (globals.css:323-330)
Two authored utility classes back the display + data voices; use them, don't
re-derive the font-family inline:
- **`.font-display`** — Instrument Serif; the display/masthead voice.
- **`.font-metric`** — Geist Mono with tabular-nums; the figures voice. All
  product numbers route through this so columns align.

### Fluid Type Spine (v1.4 Phase 49 / DS-02·DS-03)

The fixed px scale above is the canonical superset; it is now also expressed as
eight **named fluid `clamp()` tokens** so type scales smoothly across the full
resolution range (small screens → ultra-wide) instead of snapping at media-query
breakpoints. The named tiers map the px scale 1:1:

| Tier | Token | px endpoints (min→max) | clamp |
|------|-------|------------------------|-------|
| Hero | `--text-hero` | 32→48 | `clamp(2rem, 1.5rem + 2.5vw, 3rem)` |
| Page title | `--text-page-title` | 24→32 | `clamp(1.5rem, 1.2rem + 1.5vw, 2rem)` |
| H2 | `--text-h2` | 20→24 | `clamp(1.25rem, 1.1rem + 0.75vw, 1.5rem)` |
| H3 | `--text-h3` | 16→18 | `clamp(1rem, 0.95rem + 0.25vw, 1.125rem)` |
| Body | `--text-body` | 14→16 | `clamp(0.875rem, 0.85rem + 0.125vw, 1rem)` |
| Small | `--text-small` | 13→14 | `clamp(0.8125rem, 0.8rem + 0.0625vw, 0.875rem)` |
| Caption | `--text-caption` | 12→13 | `clamp(0.75rem, 0.73rem + 0.0625vw, 0.8125rem)` |
| Micro | `--text-micro` | 10→11 | `clamp(0.625rem, 0.61rem + 0.0625vw, 0.6875rem)` |

**Where they live:** the tokens sit in a **plain `@theme { … }` block** in
`src/app/globals.css` — deliberately NOT `@theme inline`. A plain `@theme` keeps
each `text-*` utility a live `var(--text-*)` reference so the browser
re-evaluates the `clamp()` on zoom; `@theme inline` would bake the clamp literal
into every utility and flatten the variable chain, defeating zoom-safety. (Colors
stay in `@theme inline` and are unaffected.)

**Two hard invariants** (mechanically enforced):
1. Every `clamp()` carries a **`rem` middle term** (`clamp(<rem>, <rem> + <vw>,
   <rem>)`) — a `vw`-only size never scales under zoom and fails WCAG 1.4.4 / W3C
   F94. The `rem` portion scales with the user's text-zoom; the `vw` only widens
   the band between the bounds.
2. **`max ≤ 2.5 × min`** — guarantees each tier can always reach 200% under zoom
   on modern browsers (WCAG 1.4.4). The widest tier (hero 32→48) is 1.5×, well
   inside the cap.

**Single source of truth:** the same eight tiers are mirrored as `TYPE_SCALE`
(`as const`) in `src/lib/design-tokens/typography.ts`, and the three-way drift
gate `tests/a11y/design-token-drift.test.ts` asserts DESIGN.md ↔ the plain
`@theme` block ↔ the TS mirror all agree verbatim (and that no `--text-*` ever
regresses into `@theme inline`). The clamp-shape invariants are pinned by
`tests/visual/fluid-type-tokens.test.ts`.

**Migration posture (additive, not big-bang):** this phase only *defines* the
spine. Existing `text-sm` / `text-[14px]` and other raw usages are **untouched**
here — surfaces are migrated onto the named tiers per-surface in phases 52/53, so
the fluid scale lands incrementally with no app-wide visual churn in Phase 49.

**Lint scope (DS-04, repo-wide `error` except documented frozen-chart islands):**
the `no-raw-font-px` design lint is `error` across all of `src/**` as of Phase 54
/ BP-03 (the final strangler flip; it was a non-blocking `warn` repo-wide through
phases 49–53, ratcheting to `error` per-surface one at a time). The remaining
migratable orphans were cleaned onto the `--text-fixed-*` / named `--text-*`
tiers in 54-01b/02a/02b, so the repo-wide flip passes with 0 errors. The only
exempt surfaces are the documented frozen-chart islands that can never migrate —
the frozen `EquityChart` and the three chart-internal factsheet SVGs
(`TimeSeriesChart`/`HistogramChart`/`MasterBrush`), plus `src/components/charts/**`
— which carry raw `text-[Npx]` and are turned `off` by glob in `eslint.config.mjs`
because any byte edit reds the frozen-spine guard. (The Phase-52/53 per-surface
`error` ratchet blocks are now redundant but kept as the historical record.) So
DS-04's raw-px rejection is an app-wide prohibition: no production source can
author a new raw px without failing CI, the frozen islands excepted.

## Numbers Contract
Promoted from `src/lib/factsheet/format.ts:1-80` — the factsheet's formatting
rules are the product-wide contract for how a figure renders. Numbers are the
product; they format one way, everywhere.

| Kind | Rule |
|------|------|
| Typeface | Geist Mono, `tabular-nums` (via `.font-metric`) so digits align in a column |
| Ratios (Sharpe, Calmar, Sortino) | 2 decimal places |
| Percentages | 1 decimal place, **signed** — a `+` prefix on gains, `−` on losses |
| Tail-risk (VaR, CVaR, max drawdown) | 2 decimal places |
| Integers (counts, observations) | thousands separators |
| **Null / non-finite** | **em-dash `—`. Never `0`, never blank, never a fabricated value.** A metric that cannot be computed says so with a dash. |

The `—` rule is load-bearing: a zeroed or blanked null reads as a real value and
misleads an LP. A dash is honest about absence. (See also the Color gates: a
`—` cell never carries a semantic color.)

**Rule: one formatter module per surface family.** Each surface family owns a
single formatter module (as the factsheet owns `format.ts`) — never inline
`toFixed`/`toLocaleString` at a call site. This keeps the contract enforceable
and drift-auditable.

## Color
- **Approach:** Restrained — 1 accent + 3 semantic (positive/negative/warning) + neutrals. Color is rare and meaningful; warning is reserved for transient recoverable states that the system will handle on its own.
- **Accent:** #1B6B5A — muted institutional teal. Darker and more serious than the bright teal (#0D9488) that competitors use. Means "verified" and "action".
- **Accent hover:** #155A4B
- **Page background:** #F8F9FA — warm off-white
- **Surface:** #FFFFFF — cards, panels, modals
- **Sidebar:** light rail — `bg-surface` (#FFFFFF) with a right hairline (`border-r border-border`, #E2E8F0). Section headings carry the factsheet mono-eyebrow voice (uppercase Geist Mono, tracked); active item uses accent text (`text-accent`). ACCOUNT is pinned to the bottom. **Was #0F172A navy (superseded 2026-07-16 — see Decisions Log).**
- **Text primary:** #1A1A2E — dark navy, nearly black
- **Text secondary:** #4A5568 — for descriptions, secondary content
- **Text muted:** #64748B — for labels, captions, timestamps. Was #718096 (3.8:1 on bg-page, 4.01:1 on bg-surface) — shifted 2026-04-30 to meet WCAG 2 AA (4.85:1 on white) for 12px small text. Same shade DESIGN.md already blessed for chart axis ticks (see 2026-04-29 entry below).
- **Positive:** #15803D — gains, verified status, success. Was #16A34A (3.12:1 on bg-page) — shifted 2026-04-30 to meet WCAG 2 AA (5.12:1 on white, 4.91:1 on bg-page) for 12px small text. Tailwind `green-700`.
- **Negative:** #DC2626 — losses, errors, permanent failures
- **Warning:** #B45309 — transient retry states, non-critical warnings. Was #D97706 (3.94:1 on bg-surface, 3.78:1 on bg-page, ~2.9:1 on bg-warning/5 fills) — shifted 2026-04-30 to meet WCAG 2 AA (5.05:1 on white) for 12px small text on the chip labels in TradeAndPositionPanel + the warning banners in VolumeExposureTab/PositionsTab. Tailwind `amber-700`. (Added 2026-04-11; AA shifted 2026-04-30.)
- **Warning bg / border:** #FEF3C7 / #FDE68A — light amber chip surface + border for warning-tier badges (e.g. HoldingsTable revoked-key indicator). Pairs with `--color-warning` on text. Added 2026-04-26 (Phase 09.1 UI-FLAG-01).
- **Bridge bg-50 / bg-100 / border:** #FFFAF3 / #FFF7ED / #FED7AA — cream/peach surface family for the Bridge identity (BridgeWidget, BridgeDrawer, BridgeHeroWidget). Exception to the white-card default; carries the designer-bundle cream visual signature. Added 2026-04-26 (Phase 09.1 UI-FLAG-01).
- **Border:** #E2E8F0 — subtle dividers
- **Border focus:** #1B6B5A — accent color for focused inputs
- **Surface subtle:** #FBFCFD — near-white tint for nested panels (expanded rows, secondary surfaces) where surface-on-surface needs separation without a border
- **Track:** #F1F5F9 — neutral progress-bar / slider rail background; lighter than --color-border so the filled portion stays visually dominant
- **Chart strategy:** #1B6B5A — equity curve color
- **Chart benchmark:** #94A3B8 — benchmark overlay (muted)
- **Dark mode:** Not planned. Institutional finance is light mode.

### Semantic-color gates (normative)
Tone is earned, not decorative. The rules:
- **Tone renders ONLY on finite values.** A metric with no computable value (`—`)
  is colorless. A `—` cell never carries a semantic color.
- **A zero is not "bad".** A zero drawdown, a flat return — these are neutral
  facts, not failures. No red on a zero.
- **Red** = permanent / negative only (a realized loss, a hard error, a
  permanent failure). Never for absence, never for a zero.
- **Amber** = system- or user-recoverable disclosure (a transient retry state, a
  coverage-window exclusion that a one-click action reverses). Recoverable, not
  broken.
- **Muted** = steady-state, honest-empty. The neutral default when there is
  nothing to flag.

The failure mode is coloring by shape (all negatives red, all nulls amber)
instead of by meaning. Gate on *what the value means*, not on its sign or its
absence.

## Spacing
- **Base unit:** 4px
- **Density:** Comfortable — tighter than typical SaaS, not as dense as Bloomberg
- **Scale:** 2px(0.5) 4px(1) 8px(2) 12px(3) 16px(4) 24px(6) 32px(8) 48px(12) 64px(16)
- **Card padding:** 16-20px (sm), 24px (md)
- **Section gaps:** 24-32px between content sections
- **Table row height:** ~44px (touch-target compliant)

### Spacing tokens (CSS custom properties)
- **`--space-grid-gap` (10px):** Designer-bundle-origin grid gap. Used by
  `WidgetGrid` (the allocator-dashboard 4-col grid) + the Bridge family
  (`BridgeWidget`, `BridgeDrawer`) and a handful of widget legend rows
  (`CustomRangePicker`, `EquityChart` card header, `MandateSnapshotWidget`,
  `AllocationByStyleWidget`). **NOT a member of the 4/8/12/16/24 ladder
  above** — it is the verbatim port from `Allocator Dashboard.html` /
  `designer-bundle/project/src/widget-grid.jsx`. Snapping to the nearest
  ladder value (12px) would shift the 4-col grid by 6px cumulative and
  risk regressing the responsive breakpoints at 980px / 640px (see
  `.planning/phases/09.1-allocator-dashboard-ui-refresh-implement-designer-provided-a/09.1-VERIFICATION.md`
  line 110). Formalized as a token 2026-04-27 to retire UI-FLAG-04 — the
  visual value stays at 10px, but the value now lives in exactly one place
  (`globals.css`).

## Layout
- **Approach:** Grid-disciplined — strict columns, predictable alignment
- **Grid:** 12 columns, responsive
- **Measure ladder (max content width):** three measures, picked by content
  type — **1100px prose** (reading copy, forms, admin text pages), **1440px
  document** (the default factsheet / single-strategy document width), **1920px
  dense tables** (ultra-wide allocator tables, compare grids — the Phase 52
  fluid-fill `max-w-[1920px]` decision). Wider content earns a wider measure;
  prose never exceeds 1100px regardless of viewport.
- **Sidebar width:** 260px (fixed, desktop only)
- **Border radius:** sm: 4px (badges, inputs), md: 6px (buttons, small cards), lg: 8px (cards, panels), xl: 12px (hero sections)

## Motion
- **Approach:** Minimal-functional — only transitions that aid comprehension
- **Easing:** enter(ease-out) exit(ease-in) move(ease-in-out)
- **Duration:** micro(50ms) short(150ms) medium(250ms) long(400ms)
- **Hover states:** 150ms ease-out (buttons, links, table rows)
- **Page transitions:** 250ms (tab switches, panel open/close). When using Tailwind utilities, use `duration-300` — `duration-250` is not a valid Tailwind v4 token and silently drops the animation. For raw CSS / inline-style animations, keep 250ms.
- **No decorative animation.** No bouncing, no spinning logos, no scroll-triggered effects.

## Component Patterns

**Cards vs Data panels — two different primitives, don't conflate them.** A card
is an interactive container; a data panel is a flat region of a document. They
look different on purpose:
- **Cards** (interactive containers — click, hover, navigate): White surface,
  1px border (#E2E8F0), rounded (8px radius), subtle shadow (0 1px 3px
  rgba(0,0,0,0.04)). The radius + shadow signal "this is a thing you act on."
- **Data panels** (a region of the document — KPI strips, factsheet panels):
  **square (no radius), flat (no shadow), 1px-bordered, hairline-divided.** They
  read as sections of a printed report, not as floating chips. This is the
  factsheet's deliberate treatment; do NOT apply the card radius/shadow to a
  data panel.

**Two-weight rule hierarchy.** Rules come in exactly two weights, and the weight
carries meaning:
- **Frame** — a near-black rule (`border-text`, ~#1A1A2E) frames the *document*
  as a whole. Heavy, deliberate, like the border of a printed report.
- **Interior hairline** — #E2E8F0 (`border-border`) hairlines structure the
  *interior*: divide rows, separate panels, split strip cells.

Heavy frame vs interior hairline: never use the near-black frame weight for an
interior divider, and never use a hairline where the document edge wants a frame.

- **Tables:** No outer border. Header row with bottom border. Rows separated by hairline borders. Hover state with subtle background.
- **Buttons:** Primary (accent bg, white text), Secondary (transparent, border), Ghost (transparent, no border)
- **Badges:** 4px radius, uppercase 10-11px, specific colors per category
- **Inputs:** 6px radius, 1px border, accent border on focus
- **Modals:** White surface, subtle shadow, slide-out panels from right edge

## Trust-Tier Badges
Three-variant pill component lives at `src/components/strategy/TrustTierLabel.tsx`.
Tokens live at `src/lib/design-tokens/trust-tier.ts` (single nested
`TRUST_TIER_TOKENS as const`). DESIGN.md ↔ token consistency asserted by
`tests/a11y/trust-tier-tokens.test.ts`.

| Variant | Fill | Text | Border | Label |
|---------|------|------|--------|-------|
| `api_verified` | #1B6B5A | #FFFFFF | #1B6B5A | API verified |
| `csv_uploaded` | #FFFFFF | #4A5568 | #4A5568 | CSV uploaded — verification pending |
| `self_reported` | #FFFFFF | #B45309 | #B45309 | Self-reported |

Visual: `inline-flex items-center rounded-sm border px-2 py-0.5 text-xs font-medium`.
4px radius (`rounded-sm` per badge ladder), 1px border, 12px DM Sans regular.
Inserted next to the strategy name on factsheet H1, marketplace tile, admin
CSV-status row. No icons; identity carried by border + text colour only.

## Error Envelope
Canonical error renderer lives at `src/components/error/ErrorEnvelope.tsx`.
Used by every error surface (wizard, CSV upload, factsheet load failure, admin
status page, future `error.tsx` route boundaries). Sources human copy from
`src/lib/wizardErrors.ts` via `buildEnvelope()` in `src/lib/envelope.ts`.

Visual contract:
- Shell: `role="alert"` + `rounded-md border border-negative/30 bg-negative/5 px-4 py-3`.
- Title: `text-base font-semibold text-text-primary` — 16px DM Sans semibold #1A1A2E (REQ DESIGN-02).
- Body: optional numbered `<ul>` of `debug_context` lines (12px DM Sans regular #4A5568).
- Retry CTA: `Button size="sm"`, BELOW the body and ABOVE the `<details>` accordion.
  Renders iff `envelope.recoverable && onRetry`.
- Diagnostics: always-collapsed `<details>` with `code` + `correlation_id` (Geist
  Mono 12px) + ghost-button "Copy diagnostics".
- Copy-diagnostics payload: newline-delimited text block prefixed `QUANTALYZE_DIAG`
  + code + correlation_id + ISO timestamp + user_agent + debug_context lines +
  trailer `--- pii-scrubbed ---`. Runs through `pii-scrub.ts` before clipboard write.

Authoring rule: every error path MUST call `buildEnvelope(code, correlation_id, ctx)`;
no inline-string error envelopes. Code-review block enforced by grep at PR-time.

## Broker Selector Grid
3-cols × 1-row card grid at the top of the API path on `/strategies/new/wizard`.
3 active cards (Binance, OKX, Bybit) per UC-B v1 source scope. Drops the literal
"2×3" interpretation from REQ DESIGN-03; v2 may revisit when MT5/IBKR ship.

Visual: `<button>` cards with white surface, 1px `#E2E8F0` border, 8px radius.
Active state: `border-accent bg-accent/5`. Hover (inactive): `hover:border-accent/50`.
Card copy: 14px DM Sans semibold (name) + 12px DM Sans regular (caption).

Per-source field schema lives in UI-SPEC.md §per-source-fields (DESIGN.md stays
narrow on tokens + visual contracts). OKX requires a passphrase field; Binance
and Bybit do not. IP-allowlist hint copy is per-source.

## CSV Escape-Hatch Card
Full-width card BELOW the broker selector grid. White surface, 1px `#E2E8F0`
border, 8px radius. Same visual weight as the broker cards — directs users
without an API key into the CSV branch (`?source=csv`).

Title (verbatim): "Don't have an API key? Upload CSV instead". Body:
"Upload daily returns, NAV, or trades. We validate every row before creating
your strategy. Max 10 MB." CTA: `Button variant="secondary"` "Upload CSV →"
(secondary variant intentionally avoids competing with the API path's
`bg-accent` primary CTA on the same screen).

3 accepted formats live as a segmented control on the CSV branch landing step:
`daily_returns` / `daily_nav` / `trades`. Format selector is part of Phase 15
CSV branch — see Phase 15 UI-SPEC §8.3.

## 9-State Matrix
Every API-key-flow surface declares behavior across 9 states: loading, empty,
error, partial, success, retry-in-flight, stale, optimistic, offline. Concrete
DOM/copy specs per cell live in UI-SPEC.md §9-state-matrix. Hard exit gate
before Phase 19: `gsd-sdk validate phase-17-exit` greps for `TBD | TODO | TKTK`
in the matrix; FAILS on any unresolved cell.

A11y minimums (DESIGN-05):
- Trust-tier pill text ≥ 4.5:1 against rendering context (page bg #F8F9FA or
  surface bg #FFFFFF). Asserted by `tests/a11y/wizard-contrast.test.ts`.
- ARIA live regions: `role="alert"` on blocking errors; `role="status"` +
  `aria-live="polite"` on non-blocking state changes.
- Keyboard navigation: stepper Tab/Shift+Tab in DOM order; Enter activates;
  `aria-current="step"` on active step.
- Focus management: on step transition, focus moves to the first interactive
  control of the new step.

axe-core CI scans `/strategies/new/wizard` (both `?source=` branches) and
`/admin/csv-status` with `wcag2a + wcag2aa + best-practice` rule sets. Zero
violations required for green CI.

Mobile fallback (DESIGN-04): **SUPERSEDED 2026-06-27 by v1.3 Phase 46** (see
Decisions Log). The 640px `DesktopGate.tsx` hard-block is removed — the wizard
now reflows CSS-first and is usable at all widths (single-column stepper below
640px; `WizardChrome` `grid-cols-1 sm:grid-cols-N`), so phone users complete
onboarding rather than hitting an email-capture gate. The original deferral (and
its PostHog `wizard_start device_type='mobile' > 0` trigger) is retained below
for history only; it no longer governs shipped behavior.

## Data density principle
Data density > card density. Prefer tables and shared-axis panels over stacks of
rounded cards. Reference: Bloomberg Terminal, FactSet.

Rule: if 3+ cards share a row, ask whether it should be one panel with 3 columns
instead. Cards are for interactive containers (Click, Hover) — not for visual
grouping of metrics.

## Meeting hero rule
Meeting-hero pages (`/demo`, public forwarded URLs, one-screen thesis pages) use
the 3-block editorial layout: **Verdict / Evidence / Action**, separated by
hairline dividers (`border-t border-border`, 1px `#E2E8F0`). No card borders
between blocks. This is the exception to the default Card primitive pattern.
Reference: FactSet quarterly factsheet pages.

## Voice / microcopy
The copy is part of the document. It reads like a careful analyst wrote it, not
a marketing team:
- **Declarative, sentence-case captions.** State the fact. No title-case
  headlines, no exclamation.
- **State limitations with the threshold attached.** Don't hide a gap — name it
  and give the number: *"Appears once the strategy has ~35 observations."* The
  reader learns exactly what unlocks it.
- **No adjectives where a number exists.** "Strong returns" is slop; "+12.4%" is
  the fact. Let the figure carry the weight.
- **Active voice.** "We validate every row" — not "every row is validated."

## AI-Slop Ban (enforceable)
These patterns are banned because they read as generic AI-generated design —
the opposite of a dated, signed document. **The ban is on the pattern, not the
instance:** review for the shape, not a single occurrence.

| Banned pattern | Why it's slop here | What we do instead |
|----------------|--------------------|--------------------|
| 3-column icon-in-circle feature grids | The universal "AI landing page" tell; says nothing, sourced from nothing | Data panels with real figures; one panel, columns of facts |
| Purple / indigo / any decorative gradient | Decoration with no meaning; not institutional | Flat surfaces + hairlines. **ALLOWLIST:** the one *functional* overflow-fade at `StrategyTable.tsx` (`bg-gradient-to-l from-surface to-transparent`) that signals horizontally-scrollable content |
| Centered-everything layouts | Reads as a brochure, not a report | Left-aligned, grid-disciplined; a report is left-anchored |
| Uniform bubbly radius on all elements | Toy-like; erases the card-vs-panel distinction | Two primitives: rounded cards, square data panels |
| Decorative blobs / patterns / glassmorphism | Pure ornament; fails the print test | Nothing. The numbers do the work |
| Emoji as decoration | Cheerful, unserious, unprintable | **Permit only semantic glyphs `⚠ — · ×`**, and only when colored by a semantic token AND adjacent to text |
| Colored-left-border cards | A dated Bootstrap tell | Semantic tone on text/fill per the color gates, not a stripe |
| Generic hero copy (Unlock / Empower / Supercharge / "seamlessly") | Marketing filler; adjectives where numbers belong | Declarative sentence-case copy that states the fact (see Voice) |
| system-ui / Inter / Roboto as a display font — or ANY new font | Breaks the three-voice system; the overused-font tell | The three voices only: Instrument Serif / DM Sans / Geist Mono |
| Cookie-cutter marketing rhythm (hero → 3 features → testimonial → CTA) | The template every AI emits | Document layout: masthead, panels, provenance, footer stamp |
| Icon-first cheerful empty states | Unserious; hides the real reason | State the limitation with its threshold (see Voice) |

**Greppable CI gates (ratchet like `no-raw-font-px`).** Three of these are
mechanically enforceable in the repo's existing token-drift test style and
should be ratcheted the same way — `warn` repo-wide, then `error` per-surface as
each surface is cleaned:
1. **Gradients outside the allowlist** — any `bg-gradient-*` / `linear-gradient`
   in `src/**` except the `StrategyTable.tsx` functional overflow-fade.
2. **Emoji codepoints in `src/**` JSX** — reject decorative emoji; the semantic
   glyphs `⚠ — · ×` are the only permitted codepoints.
3. **`rounded-full` sized 10–12 with an icon child** — the icon-in-circle
   feature-grid tell.

## Decisions Log
| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-04-06 | Initial design system created | Competitive research: quants.space (dark/crypto), TradeLink (soft/SaaS), GenieAI (sparse). Gap: institutional credibility. Chosen direction: Industrial/Utilitarian with serif display type for differentiation. |
| 2026-04-06 | Instrument Serif for display | Nobody in quant space uses serif display. Signals "institutional finance" over "crypto startup". Risk accepted: some may find it old-fashioned. |
| 2026-04-06 | Muted teal #1B6B5A over bright #0D9488 | Current accent screams tech startup. Darker muted teal whispers institutional. Less eye-catching on first visit, more trustworthy over time. |
| 2026-04-06 | DM Sans over Inter | Inter is the most overused font in tech. DM Sans is geometrically similar but warmer, with better personality at larger sizes. |
| 2026-04-06 | Geist Mono over JetBrains Mono | Geist Mono designed for UI, not code editors. Sharper at small sizes. Better tabular-nums. |
| 2026-04-09 | Data density > card density + Meeting hero rule | Portfolio demo hero (v0.2.0.0) inverted `/demo` from a 9-card mosaic to a 3-block editorial layout (Verdict / Evidence / Action) after cross-model design review. Codified both the general "data density" principle and the specific "meeting hero" exception so the page never drifts back into stacked cards. |
| 2026-04-11 | Added `warning` amber #D97706 as a 4th semantic color | Sprint 2 Task 2.9 compute queue admin UI needs a color for `failed_retry` state that is neither red (permanent failure) nor green (success). Palette relaxed from "1 accent + neutrals" to "1 accent + 3 semantic (positive/negative/warning) + neutrals". Warning is reserved for transient states that will recover on their own. Contrast quoted as ~4.6:1 on white (AA pass). [SUPERSEDED 2026-04-30 — actual measured contrast was 3.19:1, AA fail; corrected to amber-700 #B45309 (5.05:1).] |
| 2026-04-27 | Formalized `--space-grid-gap: 10px` as a documented spacing token | Phase 09.1 UI-FLAG-04: WidgetGrid + Bridge + 3 widget legend rows hardcoded `gap: 10` in 5 inline-style sites. 10px falls outside the 4/8/12/16/24 ladder. Snapping to 12px would shift the 4-col grid by 6px cumulative across cells and risk regressing the 980px / 640px responsive breakpoints baked into WidgetGrid's inline `<style>` block. Promoted the value to a documented designer-bundle-origin token rather than altering the visual. The pointer-resize math in WidgetGrid keeps a numeric literal with a sync comment (CSS computed-style reads have SSR/hydration edge cases). |
| 2026-04-29 | UC#7 — accept 7-panel single-strategy density-rule deviation | Quantstats parity requires 7 distinct analytical panels (Overview / Headline+Equity / Drawdown / Returns Distribution / Rolling / Trades / Exposure) on `/strategy/[id]/v2`. The "data density > card density" rule is preserved within each panel (multi-cell strips, shared-axis charts, no card-on-card nesting), but the 7-panel scrollable shell exceeds the "3+ cards in a row → make it one panel" guideline at the page level. Accepted as a deliberate institutional-factsheet density choice; reference: FactSet quarterly factsheet pages where 8+ panels per page is standard. Single-page scroll; no tabs; IntersectionObserver-deferred mount on panels 4–7 keeps TTI under budget. |
| 2026-04-29 | v2 single-strategy 4-size / 2-weight type contract | The v2 surface restricts itself to a tight 4-size / 2-weight subset of DESIGN.md's typography scale. Sizes: page H1 = 32px Instrument Serif; panel H2 = 16px DM Sans semibold; KPI metric values = 18px Geist Mono semibold tabular-nums; everything else (cell labels, sub-headings via `uppercase tracking-wider`, axis ticks via `CHART_TICK_STYLE`, table cells, tooltips, banner copy, disabled labels) = 12px caption tier. Weights: exactly 2 — 400 regular and 600 semibold. Sub-headings differentiate via `uppercase tracking-wider` transform, not a third weight. Chart axis ticks consolidated 11px → 12px (Geist Mono tabular-nums at `#64748B` on `#FFFFFF` = 4.85:1, well within WCAG AA). The wider DESIGN.md scale (10–11px micro, 13px small, 14px body, 24px H2, 500 medium weight) remains the project superset; this contract is v2-specific and grep-enforced via `tests/visual/strategy-v2-type-scale.test.ts`. |
| 2026-04-29 | strategy.ui_v2 default flipped OFF→ON (browser-side; SSR-safe two-pass mount per Grok B-05) | Phase 14b shipped Panel 4-7 lazy bodies (Returns Distribution / Rolling / Trades & positions / Exposure & benchmark greeks), DailyHeatmap SVG/Canvas dual renderer (Pitfall 4 mitigation), axe-core CI on `/strategy/[id]/v2` + `/discovery/[slug]` (zero violations on `wcag2a` + `wcag2aa` + `best-practice`), full keyboard navigation with skip-link mechanism (UI-SPEC §7.3 focus order), and Playwright chart-snapshot parity (±2% per panel; ±5% full-page) — gating checklist in UI-SPEC §11 fully green before this flip. The Pitfall 17 partial-data matrix (4 history bands × 7 panels) is institutionalized in `.github/PULL_REQUEST_TEMPLATE.md` to keep KPI-23b coverage from regressing on future PRs. The v1 → v2 cutover (removing `src/app/strategy/[id]/page.tsx`) remains a v0.17.1 follow-up; this flip only changes the flag's default value, not the v1 route's existence. URL override `?strategy_v2=off` and localStorage `strategy.ui_v2='false'` continue to force v1 for any user. **Grok B-05 SSR-safety**: the SSR branch of `isStrategyUiV2Enabled()` keeps returning `false` (mirrors `src/lib/widget-state-flag.ts` Phase 11 pattern). Consumers do a two-pass mount via `useEffect` so initial server render uses v1, post-hydration upgrades to v2 if the flag resolves true. This prevents hydration mismatches for legacy users with `localStorage="strategy.ui_v2"="false"`. |
| 2026-04-30 | Shifted `--color-warning` #D97706 → #B45309 (amber-700) | After PR #103 fixed `--color-text-muted` and `--color-positive` (both AA-failing), the next axe scan surfaced the warning token's contrast violations on the v2 strategy page (chip labels) and the v1 strategy tabs (warning banners). The 2026-04-11 entry recorded the contrast as ~4.6:1 from memory; an actual measure (WCAG sRGB-luminance formula) showed 3.19:1 on white and ~2.93:1 on `bg-warning/5` fills — both AA fails for 12px text. Amber-700 #B45309 lands at 5.05:1 on white and 4.56:1 on `bg-warning/5`, AA-pass for normal text and only mildly more saturated visually. Pinned by `tests/a11y/chart-contrast.test.ts`. |
| 2026-04-30 | Recharts 3.x `accessibilityLayer` opt-out across the codebase | Recharts 3.x defaults `accessibilityLayer={true}` which adds `tabIndex=0` + `role="application"` to chart root SVGs. With no accessible name, those SVGs land in keyboard tab order as empty-focus stops (broke `e2e/strategy-v2-keyboard.spec.ts` — Tab #13 hit DrawdownChart instead of Panel 5's "3M" button). Initial fix scoped only to `src/components/charts/`; widened 2026-04-30 to every recharts chart (allocator dashboard widgets, portfolio components, strategy compare overlay) since the same bug class would re-fail on adjacent routes. Chart data is also surfaced via KPI cells in panel grids, so the layer's keyboard-nav features aren't load-bearing. Pinned by `tests/visual/chart-accessibility-layer.test.ts` (whole-codebase grep). |
| 2026-05-01 | DESIGN-01 — Trust-tier badge variants + token file landed | Three pill variants (`api_verified` filled accent, `csv_uploaded` neutral grey outline, `self_reported` warning amber outline) shipped as `src/lib/design-tokens/trust-tier.ts` (`TRUST_TIER_TOKENS as const`). Self-reported hex aligned with canonical `--color-warning` (#B45309 — REQUIREMENTS.md DESIGN-01 row corrected from #D97706, which was retired 2026-04-30 for AA failure). Consistency Vitest test `tests/a11y/trust-tier-tokens.test.ts` reads DESIGN.md and asserts each hex appears verbatim. CI gate against drift. |
| 2026-05-01 | DESIGN-02 — Error envelope wireframe codified + canonical component | Live `WizardErrorEnvelope.tsx` shape adopted as the wireframe (Retry CTA below body, above `<details>`; always-collapsed). Component rebranded → `src/components/error/ErrorEnvelope.tsx` (file move + 1-line re-export shim at old wizard path; zero call-site churn). Title typography upgraded `text-sm text-negative` → `text-base font-semibold text-text-primary` per REQ. Copy-diagnostics payload changed JSON.stringify → newline-delimited prefixed text block (`QUANTALYZE_DIAG\n{code}\n{correlation_id}\n{ISO ts}\n{user_agent}\n{debug_context lines}\n--- pii-scrubbed ---`) with `pii-scrub.ts` pass before clipboard. Surface scope: ALL error renderers (wizard, CSV upload, factsheet, admin status, future `error.tsx`). |
| 2026-05-01 | DESIGN-03 — Broker selector grid + CSV escape-hatch card | 3-cols × 1-row grid with 3 active cards (OKX, Binance, Bybit) per UC-B; drops the literal "2×3" wording from REQ. Visual: white surface, 1px `#E2E8F0` border, 8px radius (matches `Card` primitive). Per-source field schema (passphrase required for OKX; IP-allowlist hint per source) lives in UI-SPEC.md §per-source-fields, NOT DESIGN.md (keeps DESIGN.md narrow on tokens). Full-width CSV escape-hatch card BELOW the grid with title "Don't have an API key? Upload CSV instead" — same border/radius/surface, secondary-variant CTA, no accent fill (avoids competing with `api_verified` accent identity). |
| 2026-05-01 | DESIGN-04 — Mobile-readable wizard fallback deferred | Phase 16 / OBSERV-11 PostHog `wizard_start` mobile-device count audit returned 0 (with credential-gap caveat — `posthog-js` short-circuits in production). REQ DESIGN-04 conditional on count > 0; gate honored. Ship 640px `DesktopGate.tsx` as-is for v1. Trigger condition for v2 build: PostHog `wizard_start` event with `device_type='mobile'` count > 0 over a rolling 7-day window in production. Audit cron logs weekly to `.planning/audits/wizard-mobile-count.md`. When trigger fires, future phase builds read-only review state (single column, 16px base, no chrome reflow). Full mobile-responsive polish on strategy pages remains v2 per PROJECT.md. |
| 2026-05-01 | DESIGN-05 — 9-state matrix + a11y minimums + wizardErrors.ts source-of-truth | 9 surfaces × 9 states (loading / empty / error / partial / success / retry-in-flight / stale / optimistic / offline) with concrete DOM/copy specs in UI-SPEC.md §9-state-matrix. Hard exit gate before Phase 19 — plan-checker rejects entry on any TBD cell. A11y: 4.5:1 contrast asserted by `tests/a11y/wizard-contrast.test.ts`; axe-core CI extended to `/strategies/new/wizard` + `/admin/csv-status`; ARIA live regions on state transitions; keyboard-nav stepper with `aria-current="step"`. `wizardErrors.ts` declared canonical source of `human_message` strings; envelope's `human_message` = wizardErrors `title`, `debug_context` = wizardErrors `fix[]`. Phase 17 absorbs the 19 CSV-branch literal strings Phase 15 left as `// TODO(phase-17): hoist into wizardErrors` (17 new error codes + 3 heading-constant exports + 1 rule-labels constant). |
| 2026-06-27 | DESIGN-04 superseded — DesktopGate retired, wizard reflows CSS-first (v1.3 Phase 46 / WIZARD-01) | The 2026-05-01 DESIGN-04 decision deferred mobile wizard support and shipped the 640px `DesktopGate.tsx` hard-block, gated on a PostHog `wizard_start device_type='mobile' > 0` trigger that the credential-gapped audit could never observe (posthog-js short-circuits in production). v1.3's mobile/adaptive milestone makes the whole app phone-usable, so the gate is now a funnel leak: a founder with a track-record CSV but no exchange key on a phone hit an email-capture wall instead of onboarding. Phase 46 deletes `DesktopGate.tsx` (+ its test), renders the `WizardClient` Suspense subtree directly, and reflows the stepper rail to single-column below 640px. The phone-usable wizard is proven by `e2e/reflow-sweep-authed.spec.ts` (`/strategies/new/wizard` @320px, no horizontal overflow). The DESIGN-04 trigger/audit machinery is obsolete (superseded, not pending). | 
| 2026-05-06 | Tailwind v4 `--color-*` token convention enforced + `--radius-{sm,md,lg,xl}` declared in `@theme inline` | v0.21.1.0 EquityChart polish surfaced silent token drift: bare `var(--positive)` / `var(--text-muted)` / `var(--chart-strategy)` etc. resolve to `currentColor` / black under Tailwind v4 because `@theme inline` only emits `--color-*`-prefixed tokens. Four widgets (`EquityChart`, `KpiStripWidget`, `MandateSnapshotWidget`, `AllocationByStyleWidget`) had been silently rendering with wrong colors. All call sites moved to `var(--color-*)`; the rule now: any color CSS variable consumed in a component MUST use the `--color-*` prefix. Same audit found three widgets referencing `var(--radius-lg)` / `var(--radius-md)` against undeclared tokens (silent 0px corners); `--radius-{sm,md,lg,xl}` now declared in `@theme inline` per the existing Border-radius ladder (sm 4 / md 6 / lg 8 / xl 12). |
| 2026-06-28 | Inline body-prose links carry a persistent underline (WCAG 1.4.1, v1.3 Phase 48 / A11Y-01) | The app-wide axe matrix (`e2e/axe-app-wide.spec.ts`) surfaced `link-in-text-block` (serious) on `/security`: six inline prose links inside paragraph copy (`text-accent underline-offset-4 hover:underline`) were distinguishable from surrounding text by COLOUR ALONE until hover — a WCAG 1.4.1 (Use of Color) failure, since the accent teal does not meet the 3:1 contrast-against-adjacent-text carve-out. The standard accessibility remedy is a persistent underline on inline prose links: those six links now use `text-accent underline underline-offset-4` (the `underline-offset-4` spacing is kept; only the hover-gating is dropped). SCOPE: this applies ONLY to links embedded in body prose. Nav links, button-styled links, card links, and heading/anchor links (which are distinguishable by position, shape, or a non-colour affordance) are unaffected and deliberately keep their existing hover/no-underline treatment. USER-APPROVED visual change (the only visual delta in Phase 48's a11y remediation). Enforced by the strict public axe rows in `axe-app-wide.spec.ts`. |
| 2026-06-29 | Fluid `--text-*` type spine in a plain `@theme` block (v1.4 Phase 49 / DS-01·DS-02·DS-03) | The fixed px type scale is now also expressed as eight named fluid `clamp()` tokens (`--text-{hero,page-title,h2,h3,body,small,caption,micro}` → 32-48 / 24-32 / 20-24 / 16-18 / 14-16 / 13-14 / 12-13 / 10-11) so type scales smoothly small→ultra-wide without media-query snapping. **Plain `@theme`, not `@theme inline`:** a plain block keeps each `text-*` utility a live `var(--text-*)` so the browser re-evaluates the `clamp()` on zoom; `@theme inline` would bake the clamp literal and flatten the var chain, defeating zoom-safety (verified against `@tailwindcss/postcss` 4.3.1: `text-hero` emits `font-size: var(--text-hero)`, while `@theme inline` colors stay baked literals). **Two hard invariants:** every `clamp()` carries a `rem` middle term (a `vw`-only size never scales under zoom — WCAG 1.4.4 / W3C F94) and `max ≤ 2.5 × min` (guarantees 200%-zoom reach; the widest tier hero 32→48 is 1.5×). **Single source of truth:** the eight tiers are mirrored as `TYPE_SCALE as const` in `src/lib/design-tokens/typography.ts`; the three-way drift gate `tests/a11y/design-token-drift.test.ts` asserts DESIGN.md ↔ plain `@theme` ↔ TS agree verbatim and that no `--text-*` regresses into `@theme inline`; the clamp-shape invariants are pinned by `tests/visual/fluid-type-tokens.test.ts`. **Evolve in place:** fonts (Instrument Serif / DM Sans / Geist Mono), the `#1B6B5A` accent, the fixed 4px space ladder and `--space-grid-gap: 10px` are byte-unchanged. **Additive migration:** Phase 49 only defines the spine — existing `text-sm` / `text-[14px]` usages are untouched and migrated onto the named tiers per-surface in phases 52/53, so there is no app-wide visual churn here. |
| 2026-06-29 | Per-surface application across the allocator journey (v1.4 Phase 52) | Phase 52 *applies* the Phase-49 fluid `--text-*` spine + Phase-50 primitives to the five core allocator surfaces (allocations dashboard, compare, discovery, single-strategy, factsheet chrome). The page shells **fluid-fill to `max-w-[1920px]`** on ultra-wide displays via the `DashboardChrome` `isWide` allow-list (`allocations`/`compare`/`discovery` only; every other route stays `max-w-7xl`). Dense tables/strips migrate from VIEWPORT breakpoints to CSS **`@container`** queries so a column reflows on its OWN width, not the window's — the first broad container-query rollout in the app, following the existing `CompareTable`/`AnalyticalPanels` idiom (the `@container` host MUST sit on a separate ancestor from the `@sm:`/`@lg:` grid-column variants; a same-element host never matches and freezes the grid). Raw `text-[Npx]` font sizes migrate onto the named `--text-*` tiers on the grep-verified-clean surfaces; table cells **wrap by default with `title=` recovery** where single-line alignment matters (always the real value, never a fabricated placeholder). The factsheet/strategy H1s land on the canonical 32px `--text-page-title` + Instrument Serif (the factsheet H1's prior `lg:text-[44px]` size and the strategy H1's prior `font-bold` sans were the deviations, now corrected). `scenario.ts`, `compute.ts`, the factsheet math, fonts, and the accent stay untouched; WCAG-AA holds. The `no-raw-font-px` lint ratchets to `error` on the migrated-clean surfaces (see the DS-04 lint-scope note above); allocations/** and factsheet/v2/** still carry orphan raw-px (tracked debt for phases 53/54). |
| 2026-06-30 | BP-03 px→token migration complete + `no-raw-font-px` repo-wide `error` (v1.4 Phase 54, milestone close) | Phase 54 pays off the Phase-52/53 orphan raw-px debt. The remaining 233 raw `text-[Npx]` sites across 60 files migrate **byte-identically** to fixed-value `--text-fixed-N` tokens (one alias per distinct size 9–36px, each exactly N/16rem so the render is unchanged), and `no-raw-font-px` flips from per-surface ratchet to repo-wide **`error`** (the final strangler flip; see the updated DS-04 lint-scope note above). The four frozen chart islands — `EquityChart` + the three chart-internal factsheet SVGs (`TimeSeriesChart`/`HistogramChart`/`MasterBrush`) — can never migrate (any byte edit reds the `FROZEN_ISLANDS` git-diff-zero guard), so they are exempted via a documented eslint `off`-glob mirroring `src/components/charts/**`; this is the CONTEXT-locked resolution of the BP-03-vs-FROZEN_ISLANDS collision, not an unmet gap. `RT-W2` caps the four prose/form admin pages (partner-import, users, users/[id], for-quants-leads) at the 1100px content measure while the ultra-wide allocator tables keep 1920px. `scenario.ts`/`compute.ts`/the chart islands stay untouched and the WCAG-AA floor holds; an app-wide design-review against the locked DESIGN.md passes. |
| 2026-07-02 | Three-state coverage-chip palette (v1.5 Phase 58, COVERAGE-02) | The scenario composer's per-row membership state maps to exactly three token treatments: **in-blend** = accent `#1B6B5A` (member, verified-in), **manually-excluded** = muted neutral (deliberate, sticky), **auto-excluded (outside window)** = warning amber (`#B45309` text / `#FEF3C7` bg / `#FDE68A` border — the HoldingsTable revoked-key chip pairing). Red/negative is explicitly forbidden for auto-excluded: coverage exclusion is recoverable, not a permanent failure. Chip anatomy follows the Badge ladder (4px radius, micro tier). Pinned by `CoverageStateChip.test.tsx` token assertions. |
| 2026-07-02 | Amber semantic extended: "recovers on its own" → "recoverable" (v1.5 Phase 58) | The 2026-04-11 rule reserved warning amber for "transient states that will recover on their own". The coverage-window auto-excluded state recovers only via a *user action* (narrowing the window / one-click Include), yet red would wrongly signal permanence and muted would hide the recoverability. The reservation is therefore widened to **transient/recoverable states** — whether the system or a disclosed one-click user action performs the recovery — keeping the tripartite semantics: green=success, red=permanent failure, amber=recoverable. |
| 2026-07-02 | CoverageTimeline mini-gantt bar treatment (v1.5 Phase 58 + ship review) | The coverage mini-gantt renders one solid bar per strategy on a `bg-track` rail: in-blend = solid accent, auto-excluded = `bg-warning-bg` fill with a **`border-warning` (#B45309) border** — the ship design-specialist measured the original `border-warning-border` pairing at ~1.02:1 against the track (invisible; the chip precedent carries its contrast in TEXT, which a bar fill lacks), so the bar's ≥3:1 non-text contrast (WCAG 1.4.11) is carried by the strong border. Bars are `role="img"` with an aria-label restating coverage dates + membership (aria-label on a role-less div is ignored by AT). The active window is a separate accent band overlay; the collapse gates visibility, not compute. |
| 2026-07-16 | Sidebar navy #0F172A → light rail | Founder disliked the flat navy rail; chose the light-surface direction, deliberately reopening the previously-locked "keep current" token. Nav now: light `bg-surface`, right hairline (`border-r border-border`), mono-eyebrow section headings (uppercase Geist Mono, tracked — the factsheet annotation voice), accent-text active state, ACCOUNT pinned to the bottom. The old `#0F172A` sidebar token is retired; the Color-section token is updated to match so DESIGN.md carries one direction, not both. |