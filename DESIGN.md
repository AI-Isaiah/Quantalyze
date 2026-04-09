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
- **Approach:** Restrained — 1 accent + neutrals. Color is rare and meaningful.
- **Accent:** #1B6B5A — muted institutional teal. Darker and more serious than the bright teal (#0D9488) that competitors use. Means "verified" and "action".
- **Accent hover:** #155A4B
- **Page background:** #F8F9FA — warm off-white
- **Surface:** #FFFFFF — cards, panels, modals
- **Sidebar:** #0F172A — dark navy (keep current)
- **Text primary:** #1A1A2E — dark navy, nearly black
- **Text secondary:** #4A5568 — for descriptions, secondary content
- **Text muted:** #718096 — for labels, captions, timestamps
- **Positive:** #16A34A — gains, verified status, success
- **Negative:** #DC2626 — losses, errors, warnings
- **Border:** #E2E8F0 — subtle dividers
- **Border focus:** #1B6B5A — accent color for focused inputs
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
- **Page transitions:** 250ms (tab switches, panel open/close)
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
