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
| 2026-04-11 | Added `warning` amber #D97706 as a 4th semantic color | Sprint 2 Task 2.9 compute queue admin UI needs a color for `failed_retry` state that is neither red (permanent failure) nor green (success). Palette relaxed from "1 accent + neutrals" to "1 accent + 3 semantic (positive/negative/warning) + neutrals". Warning is reserved for transient states that will recover on their own. Contrast verified ~4.6:1 on white (AA pass). [SUPERSEDED 2026-04-30 — actual measured contrast was 3.94:1, AA fail; corrected to amber-700 #B45309 (5.05:1).] |
| 2026-04-30 | Shifted `--color-warning` #D97706 → #B45309 (amber-700) | After PR #103 fixed `--color-text-muted` and `--color-positive` (both AA-failing), the next axe scan surfaced the warning token's contrast violations on the v2 strategy page (chip labels) and the v1 strategy tabs (warning banners). The 2026-04-11 entry recorded the contrast as ~4.6:1 from memory; an actual measure showed 3.94:1 on white and ~2.9:1 on `bg-warning/5` fills — both AA fails for 12px text. Amber-700 #B45309 lands at 5.05:1 on white and 4.56:1 on `bg-warning/5`, AA-pass for normal text and only mildly more saturated visually. |
| 2026-04-27 | Formalized `--space-grid-gap: 10px` as a documented spacing token | Phase 09.1 UI-FLAG-04: WidgetGrid + Bridge + 3 widget legend rows hardcoded `gap: 10` in 5 inline-style sites. 10px falls outside the 4/8/12/16/24 ladder. Snapping to 12px would shift the 4-col grid by 6px cumulative across cells and risk regressing the 980px / 640px responsive breakpoints baked into WidgetGrid's inline `<style>` block. Promoted the value to a documented designer-bundle-origin token rather than altering the visual. The pointer-resize math in WidgetGrid keeps a numeric literal with a sync comment (CSS computed-style reads have SSR/hydration edge cases). |
| 2026-04-29 | UC#7 — accept 7-panel single-strategy density-rule deviation | Quantstats parity requires 7 distinct analytical panels (Overview / Headline+Equity / Drawdown / Returns Distribution / Rolling / Trades / Exposure) on `/strategy/[id]/v2`. The "data density > card density" rule is preserved within each panel (multi-cell strips, shared-axis charts, no card-on-card nesting), but the 7-panel scrollable shell exceeds the "3+ cards in a row → make it one panel" guideline at the page level. Accepted as a deliberate institutional-factsheet density choice; reference: FactSet quarterly factsheet pages where 8+ panels per page is standard. Single-page scroll; no tabs; IntersectionObserver-deferred mount on panels 4–7 keeps TTI under budget. |
| 2026-04-29 | v2 single-strategy 4-size / 2-weight type contract | The v2 surface restricts itself to a tight 4-size / 2-weight subset of DESIGN.md's typography scale. Sizes: page H1 = 32px Instrument Serif; panel H2 = 16px DM Sans semibold; KPI metric values = 18px Geist Mono semibold tabular-nums; everything else (cell labels, sub-headings via `uppercase tracking-wider`, axis ticks via `CHART_TICK_STYLE`, table cells, tooltips, banner copy, disabled labels) = 12px caption tier. Weights: exactly 2 — 400 regular and 600 semibold. Sub-headings differentiate via `uppercase tracking-wider` transform, not a third weight. Chart axis ticks consolidated 11px → 12px (Geist Mono tabular-nums at `#64748B` on `#FFFFFF` = 4.85:1, well within WCAG AA). The wider DESIGN.md scale (10–11px micro, 13px small, 14px body, 24px H2, 500 medium weight) remains the project superset; this contract is v2-specific and grep-enforced via `tests/visual/strategy-v2-type-scale.test.ts`. |
| 2026-04-29 | strategy.ui_v2 default flipped OFF→ON (browser-side; SSR-safe two-pass mount per Grok B-05) | Phase 14b shipped Panel 4-7 lazy bodies (Returns Distribution / Rolling / Trades & positions / Exposure & benchmark greeks), DailyHeatmap SVG/Canvas dual renderer (Pitfall 4 mitigation), axe-core CI on `/strategy/[id]/v2` + `/discovery/[slug]` (zero violations on `wcag2a` + `wcag2aa` + `best-practice`), full keyboard navigation with skip-link mechanism (UI-SPEC §7.3 focus order), and Playwright chart-snapshot parity (±2% per panel; ±5% full-page) — gating checklist in UI-SPEC §11 fully green before this flip. The Pitfall 17 partial-data matrix (4 history bands × 7 panels) is institutionalized in `.github/PULL_REQUEST_TEMPLATE.md` to keep KPI-23b coverage from regressing on future PRs. The v1 → v2 cutover (removing `src/app/strategy/[id]/page.tsx`) remains a v0.17.1 follow-up; this flip only changes the flag's default value, not the v1 route's existence. URL override `?strategy_v2=off` and localStorage `strategy.ui_v2='false'` continue to force v1 for any user. **Grok B-05 SSR-safety**: the SSR branch of `isStrategyUiV2Enabled()` keeps returning `false` (mirrors `src/lib/widget-state-flag.ts` Phase 11 pattern). Consumers do a two-pass mount via `useEffect` so initial server render uses v1, post-hydration upgrades to v2 if the flag resolves true. This prevents hydration mismatches for legacy users with `localStorage="strategy.ui_v2"="false"`. |
