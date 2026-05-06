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

## Typography
- **Display/Hero:** Instrument Serif — editorial gravitas without being stuffy. Used only for page titles, landing hero, strategy names in detail view. Nobody in this space uses a serif... that's the point.
- **Body:** DM Sans — clean geometric sans, slightly warmer than Inter. Replaces Inter everywhere. Excellent readability at all sizes.
- **UI/Labels:** DM Sans (same as body, medium weight for labels)
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

## Color
- **Approach:** Restrained — 1 accent + 3 semantic (positive/negative/warning) + neutrals. Color is rare and meaningful; warning is reserved for transient recoverable states that the system will handle on its own.
- **Accent:** #1B6B5A — muted institutional teal. Darker and more serious than the bright teal (#0D9488) that competitors use. Means "verified" and "action".
- **Accent hover:** #155A4B
- **Page background:** #F8F9FA — warm off-white
- **Surface:** #FFFFFF — cards, panels, modals
- **Sidebar:** #0F172A — dark navy (keep current)
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
- **Max content width:** 1100px (main content area)
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
- **Cards:** White surface, 1px border (#E2E8F0), 8px radius, subtle shadow (0 1px 3px rgba(0,0,0,0.04))
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

Mobile fallback (DESIGN-04): deferred to v2. Trigger condition: PostHog
`wizard_start` event with `device_type='mobile'` count > 0 over a rolling
7-day window in production. Audit cron logs the count weekly to
`.planning/audits/wizard-mobile-count.md`. When trigger fires, build the
read-only review state spec (single column, 16px base, no chrome reflow,
copy-only — full mobile-responsive polish remains v2 scope per PROJECT.md).
v1 ships the 640px `DesktopGate.tsx` as-is per the Phase 16 OBSERV-11 audit
(mobile-start count = 0).

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

## Anti-Patterns (never use)
- Purple/violet gradients
- 3-column feature grids with icons in colored circles
- Centered everything with uniform spacing
- Decorative blobs, gradients, or background patterns
- Generic stock-photo hero sections
- Bubbly uniform border-radius on all elements
- Inter, Roboto, or any overused font as primary

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
| 2026-05-06 | Tailwind v4 `--color-*` token convention enforced + `--radius-{sm,md,lg,xl}` declared in `@theme inline` | v0.21.1.0 EquityChart polish surfaced silent token drift: bare `var(--positive)` / `var(--text-muted)` / `var(--chart-strategy)` etc. resolve to `currentColor` / black under Tailwind v4 because `@theme inline` only emits `--color-*`-prefixed tokens. Four widgets (`EquityChart`, `KpiStripWidget`, `MandateSnapshotWidget`, `AllocationByStyleWidget`) had been silently rendering with wrong colors. All call sites moved to `var(--color-*)`; the rule now: any color CSS variable consumed in a component MUST use the `--color-*` prefix. Same audit found three widgets referencing `var(--radius-lg)` / `var(--radius-md)` against undeclared tokens (silent 0px corners); `--radius-{sm,md,lg,xl}` now declared in `@theme inline` per the existing Border-radius ladder (sm 4 / md 6 / lg 8 / xl 12). |
