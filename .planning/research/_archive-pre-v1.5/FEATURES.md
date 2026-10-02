# Feature Research

**Domain:** Institutional financial-data dashboard — presentation-layer overhaul (milestone v1.4 "Frontend Excellence")
**Researched:** 2026-06-28
**Confidence:** HIGH on patterns (grounded in the live codebase + FactSet/Stripe/Bloomberg-class practice); MEDIUM on specific competitor implementation details (WebSearch-verified, not first-party).

> Scope note for the requirements step + roadmapper: this is a **quality** milestone, not a feature-build. Every "feature" below is a *bar the existing surface must clear*, not a net-new capability. The allocator composer, factsheets, Bridge, Discovery, manager wizard, /security, and admin already exist (v1.0–v1.3). v1.3 already shipped the responsive/mobile floor (`useBreakpoint`, `ResponsiveTable`, `ResponsiveChartFrame`, `useTapPin`, `TouchTooltip`, mobile nav, app-wide axe WCAG-AA, 320px-reflow + 400%-zoom + 44px-target + lighthouse-mobile gates). v1.4 makes it *best-in-class*.
>
> **Locked invariants that gate every item:** no-invented-data (degenerate inputs render honest empty states, never fabricated zeros/false precision); WCAG-AA floor from v1.3 must not regress; `scenario.ts` / `compute.ts` math frozen; no-peer-rank-a-hypothetical (one audited `scenarioPeer` aggregate carve-out aside). Desktop byte-identity is **LIFTED** for v1.4 (the visual layer is free to change).

---

## Current-state baseline (from codebase survey)

What already exists, so the roadmapper can scope *upgrade* vs *build*:

| Surface | Exists today | Gap for "best-in-class" |
|---------|--------------|-------------------------|
| **Type system** | Fixed-px scale in DESIGN.md (48/32/24/16/14/13/12/10–11). `--font-*` tokens in `globals.css`. `.font-metric` (Geist Mono tabular-nums). **Zero `clamp()` anywhere.** | No fluid type. KPI numbers, page titles, strategy names are all fixed-size → either clip on small or look undersized on ultra-wide. |
| **Truncation** | **35 files use `truncate`; 6× `line-clamp-2`, 2× `text-ellipsis`, 1× `line-clamp-3`.** | Un-audited. Each is either *legitimate* (a tooltip-backed long label) or an *accidental data-clip bug*. Needs a clip audit. |
| **Nav / IA** | `Sidebar.tsx` (role-aware sections via `buildNavSections`), `MobileNav`, `MobileSidebarDrawer`, `MobileTopBar`. `Breadcrumb.tsx` exists but is **manual-items only** (not route-derived; very few callers). **No command palette / ⌘K anywhere.** | Sidebar is solid; breadcrumb is under-used; no global search/command palette; `/allocations?tab=…` deep-links exist but back-path/active-state consistency is uneven. |
| **Tables** | `ResponsiveTable` adds **scroll affordance only** — its own comment says "Column reshape is phase 46 / TABLE-01" and it explicitly does NOT reshape columns. 10 table components. | No sticky header, no sticky first column, no column-priority collapse, no row-density control surfaced per-table (there's a global `data-density` body knob). |
| **State coverage** | `ErrorEnvelope` (canonical), `Skeleton`/`SkeletonText`/`SkeletonCard`, `EmptyStateCard`, route-level `loading.tsx`/`error.tsx` on *some* routes, the **9-state matrix** (loading/empty/error/partial/success/retry/stale/optimistic/offline) is already a documented gate for the wizard surfaces. `MetricCell` already renders `—` (em-dash) for null. | The 9-state matrix is wizard-scoped; not every surface has full coverage. Skeletons are generic, not layout-matched. |
| **Motion** | DESIGN.md Motion section: minimal-functional, 50/150/250/400ms, `prefers-reduced-motion` already respected for `animate-pulse` + slider + mandate-flash. | Mostly disciplined already. Risk is *adding* decoration during the "evolved aesthetic" pass — the anti-feature watch is the main job here. |
| **Wizard** | `WizardChrome` (hairline progress rail, `aria-current="step"`, draft-saved stamp, delete-draft), CSS-first reflow (DesktopGate retired v1.3), `WizardErrorEnvelope`, focus-moves-to-first-control rule, axe-gated. | Strong foundation. Gaps: no per-step validation summary pattern, no review-before-submit step polish, error recovery copy lives in `wizardErrors.ts` (good) but the stepper visual could be more legible at the 4-size/2-weight contract. |

---

## Feature Landscape

### 1. Fluid responsive typography & layout that NEVER clips

#### Table Stakes
| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **Fluid type scale via `clamp()` on `rem`** for the headline tiers (hero/page-title/H2) | A fixed 48px hero is oversized at 320px and undersized at 2560px; institutional dashboards scale display type smoothly. Currently zero `clamp()` in the codebase. | MEDIUM | Use `rem` not `px` so user zoom still works (WCAG 1.4.4 — already a v1.3 gate). Pin min/max so type never shrinks below legible or grows to break layout. **DO NOT** fluid-scale the data/mono tier — KPI numbers and table cells should stay on the discrete `MetricCell` ladder for cross-row alignment. |
| **Big-KPI numbers never clip or shrink-to-fit silently** | A truncated Sharpe or a `$1,234,567` that becomes `$1,23…` is a credibility-killer on a finance product. | MEDIUM | KPI containers must be sized to the *widest plausible value* (e.g. negative, 2-decimal, with a `%`/`×`/`$`). `min-w` + `tabular-nums` (already used) keeps columns from jumping. Allow the *card* to grow, never the number to ellipsize. |
| **Long strategy names wrap or scale, never accidentally `truncate`** | Strategy names are user-supplied and arbitrarily long; clipping one in a list is a data-integrity smell. | MEDIUM | Audit all 35 `truncate` sites. Legitimate truncation = a *non-identifying* secondary label with a tooltip/title fallback AND the full value reachable elsewhere (detail view). Illegitimate = any *primary identifier* (strategy name in a row), any *number*, any *status*. |
| **Layouts hold 320px → ultra-wide with a max-content cap** | DESIGN.md already caps main content at 1100px; ultra-wide must not stretch tables into unreadable line lengths. | LOW | The 1100px cap already exists. Verify it holds and that nothing below it has a hard min-width that forces page overflow (the v1.3 320px-reflow gate covers the small end). |
| **Chart axis/tick labels degrade gracefully** | Dense axis labels overlap or clip at narrow widths. | MEDIUM | v1.3 already did "320px legibility" on the 16 SVG + 18 Recharts charts. v1.4 verifies labels rotate/thin/abbreviate-with-tooltip rather than overlap or get cut by the viewBox. Math stays frozen (presentation only). |

#### Differentiators
| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Container-query-aware components** (not just viewport breakpoints) | A KPI strip behaves the same whether it's in a wide Overview or a narrow composer side-rail — the component reads its *own* width. | MEDIUM-HIGH | CSS container queries are well-supported now. Lets one `KpiStrip` adapt without per-call-site breakpoints. Pairs with the existing `useBreakpoint` (keep `useBreakpoint` for JS-branch needs; container queries for pure-CSS layout). |
| **A single typographic scale token set** (the "evolved design system") consumed everywhere | One source of truth kills the per-surface drift the codebase already shows (the v2 factsheet has its own 4-size/2-weight contract; legal pages hand-roll; notes hand-roll). | MEDIUM | This is the "Evolved design system" requirement. Define fluid + discrete tiers as tokens; grep-enforce conformance (the codebase already does this style of test, e.g. `strategy-v2-type-scale.test.ts`). |

#### Anti-Features
| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| **Fluid-scaling the numeric/mono tier** | "Make everything responsive." | Breaks tabular-nums cross-row alignment; numbers at varying sizes read as inconsistent precision on a data product. | Keep data/mono on the discrete ladder; only display/prose tiers go fluid. |
| **`shrink-to-fit` / JS auto-resize on KPI text (e.g. fit-text libraries)** | "So the number always fits." | Produces inconsistent font sizes across cards, hurts scan-ability, adds a JS dependency, and *hides* the real problem (the container is too small). | Size the container to the widest value; wrap labels, never the number. |
| **Marquee / auto-scroll for long names** | "Bloomberg has a ticker." | A scrolling strategy name is decoration, not data; fails reduce-motion; reads as a crypto-startup gimmick (DESIGN.md anti-pattern). | Wrap to 2 lines with `line-clamp-2` + `title`, full name in detail view. |

---

### 2. Information architecture & navigation (multi-role: allocator / manager / admin)

#### Table Stakes
| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **Role-scoped nav that never shows a role its destinations don't have** | An allocator seeing manager-only items is confusing and a (minor) info-disclosure smell. | LOW | Already done well: `buildNavSections` + `buildPrimaryMobileNav` share role OR-logic (allocator/manager/admin/both). v1.4 verifies + visually polishes, doesn't rebuild. |
| **Consistent active / current-location state** in every nav surface | "Where am I" is the #1 dashboard orientation need. | LOW | `NavItemLink` does `pathname === href || startsWith(href+'/')` — but tab deep-links (`/allocations?tab=risk`) don't get active state from pathname alone. Needs `searchParams`-aware active state so the active *tab* lights its nav entry. |
| **Breadcrumbs on every drill-down route** (factsheet, strategy detail, admin sub-pages, portfolio/[id]) | "How do I get back" — drill-down routes (`/discovery/[slug]/[strategyId]`, `/admin/users/[id]`, `/portfolios/[id]/manage`) are deep; users need a trail. | MEDIUM | `Breadcrumb` exists but is manual-items and under-used. Either wire it into each deep route, or auto-derive from the route segment + a label map. FactSet/Bloomberg both show persistent path context. |
| **Consistent back-path / deep-link behavior** | A shared/bookmarked `/allocations?tab=scenario` link must land on that tab; browser back must be predictable. | MEDIUM | Tab state already lives in `?tab=` (good — bookmarkable). Verify back-button restores tab + scroll; verify the Bridge → composer continuity (v1.2 already wired) survives. |
| **A single discoverable entry point per workflow** | v1.2 already collapsed 3 fractured allocator surfaces into one composer; nav has ONE allocator entry. | LOW | This is *done* and pinned by the phase-32 frozen-spine guard — v1.4 must not regress it (no re-adding a Sandbox/Portfolios duplicate entry). |

#### Differentiators
| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Command palette (⌘K / Ctrl-K)** spanning strategies, allocations, discovery categories, admin actions, and nav | This is the single biggest IA upgrade for a data-dense multi-role tool. Stripe, Linear, and every serious enterprise dashboard ship one. Lets a power-allocator jump to a strategy by name without clicking through Discovery. **Does not exist today.** | MEDIUM-HIGH | Scope: navigation + search first (jump-to-route, jump-to-strategy-by-name), actions later. Role-scoped results (mirror `buildNavSections` gating). Honor no-invented-data: search results are real strategies only, empty query = empty, no fake suggestions. Keyboard-first + screen-reader labeled (don't regress axe). |
| **Global search** (the palette's search half) across strategy names, allocations, categories | Stripe's dashboard search spans customers/invoices/payouts — the equivalent here is strategies/allocations/categories. | MEDIUM | Can be the same surface as the command palette. Server-backed, RLS-scoped (must not leak cross-tenant — privacy invariant). |
| **Progressive disclosure as an IA principle** (high-level → drill-down on demand) | Reduces cognitive load on the data-dense composer/factsheet; matches FactSet's panel model. | LOW-MEDIUM | Already partly present (collapsible composition controls, IntersectionObserver-deferred factsheet panels). Codify as a system principle so the evolved aesthetic doesn't flatten everything into one wall. |

#### Anti-Features
| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| **Mega-menu / multi-level flyout nav** | "We have lots of routes." | Over-engineered for ~3 role workspaces; flyouts are hover-dependent (bad on touch, bad a11y) and read as marketing-site chrome, not a terminal. | Keep the flat role-sectioned sidebar; use the command palette for deep reach. |
| **Customizable / drag-to-reorder nav** | "Let users personalize." | Personalization state to persist + RLS surface + per-role complexity, for a pre-revenue product with a stable nav. Speculative (Rule 2). | Fixed, well-ordered role nav. Revisit only if a user asks twice. |
| **Breadcrumbs that duplicate the H1** on top-level routes | "Consistency." | A breadcrumb reading `Home / Allocations` above an `Allocations` H1 is noise. | Breadcrumbs only on drill-down routes (≥2 levels deep), not top-level workspace pages. |

---

### 3. Data-table UX for dense financial tables

#### Table Stakes
| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **Sticky header row on scroll** | Keeping column titles visible is the #1 dense-table need; standard on every financial table. | LOW-MEDIUM | `position: sticky; top: 0` on `<thead>`. Currently `ResponsiveTable` only wraps in `overflow-x-auto` — no sticky anything. |
| **Sticky first column (identifier) on horizontal scroll** | When you scroll a wide returns table right, you must keep the strategy/row name anchored. | MEDIUM | `position: sticky; left: 0` on the first cell. The leftmost identifier column is the horizontal-scroll equivalent of the sticky header. |
| **`tabular-nums` + right-aligned numerics** | Numbers must align on the decimal for scan-ability; this is non-negotiable on a finance product. | LOW | Geist Mono `tabular-nums` already mandated by DESIGN.md and used in `MetricCell`/`.font-metric`. Verify every numeric table cell uses it and right-aligns; labels left-align. |
| **Sort affordances with clear current-sort indicator** | Allocators sort by Sharpe, drawdown, AUM. | LOW-MEDIUM | Header is a button, `aria-sort` set, arrow indicator. Verify keyboard-operable (don't regress axe). |
| **Column-priority responsive collapse (not silent drop)** | v1.3 mandated "no dropped columns at 320px" — but the *quality* bar is graceful priority, not just horizontal scroll. | MEDIUM | `ResponsiveTable` today is scroll-only and its comment defers reshape. Best-in-class: a priority order so low-priority columns collapse into an expandable row detail on narrow widths, while horizontal scroll remains the fallback. **Must not drop data silently** (no-invented-data spirit: hidden ≠ deleted; it stays reachable). |
| **Horizontal scroll done right** (visible affordance, keyboard, not the only mechanism) | A wide table that scrolls with no cue is undiscoverable. | LOW | `ResponsiveTable` already announces the scroll affordance via `aria-label` + `tabIndex`. Add a *visual* edge-fade/shadow cue so sighted users see there's more. |

#### Differentiators
| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Per-table row-density control** (comfortable / compact) | Bloomberg/FactSet users want max rows on screen; the global `data-density` body knob exists but isn't surfaced per data table. | LOW-MEDIUM | The `--row-h` / `--density-pad` tokens + `body[data-density]` machinery already exist (currently driven by the allocator "Tweaks" panel). Extend to dense tables; keep it a *control*, not a default change. |
| **In-cell visual encoding** (sparklines, mini bars, color-coded deltas) | A returns column with a tiny sparkline or a red/green delta is far more scannable. Discovery already has sparklines. | MEDIUM | Use the existing sparkline; color-code via the semantic positive/negative tokens (already AA-shifted). Keep it restrained — no progress-bar confetti. |
| **Column show/hide control** | Power users curate which metrics they see in a wide factsheet-grade table. | MEDIUM | Optional; pairs with the priority-collapse. Persist is *not* required (ephemeral is fine, matches the scenario-ephemeral pattern). |

#### Anti-Features
| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| **Card-per-row "stacked" mobile tables** for the *financial* tables | "Mobile-friendly tables." | Destroys cross-row comparison — the entire point of a returns/metrics table is comparing rows. v1.3 *deliberately* chose all-columns-via-scroll over stacking for this reason. | Horizontal scroll + sticky identifier + priority-collapse-to-detail. Stacking is OK only for *non-comparative* lists (e.g. an activity feed), never the metrics grids. |
| **Client-side pagination of small tables** | "Tables have pagination." | Holdings/allocations tables are small (handful of rows); pagination hides data and adds clicks. Virtualization is for *thousands* of rows, which this product doesn't have. | Show all rows; sticky header handles length. Virtualize only if a real >500-row table appears. |
| **Auto-fit columns that squeeze numbers** | "Fit everything without scroll." | Squeezing forces number truncation — the cardinal clip sin. | Let the table be wider than the viewport and scroll; never squeeze a numeric column below its widest value. |

---

### 4. Loading / empty / error / skeleton states (every surface)

#### Table Stakes
| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **Layout-matched skeletons** (not a generic gray box) | A skeleton that mirrors the real layout prevents content-shift and reads as "loading this specific thing." | MEDIUM | `Skeleton`/`SkeletonCard` exist but are generic. Best-in-class: per-surface skeletons for the composer, factsheet panels, tables, KPI strip. Reuse the primitive; compose layout-specific shapes. |
| **Honest empty states — never fabricated zeros** (LOCKED invariant) | Degenerate inputs (0/1 active strategy, <10 overlapping days, non-finite returns) must read as honest, never as `0.00` precision. | MEDIUM | This is the hard invariant. `MetricCell` already renders `—` for null (good). `SampleFloorEmptyState`, allocations `EmptyState`, `EmptyWatchlist` exist. v1.4 verifies *every* surface distinguishes "no data yet" / "not enough data to compute" / "genuinely zero" with distinct, honest copy — and never shows a computed-looking number where the input was degenerate. |
| **Error states via the canonical `ErrorEnvelope`** | One error renderer (role=alert, retry-if-recoverable, copy-diagnostics) — DESIGN.md mandates it; no inline error strings. | LOW | Already canonical + grep-enforced. v1.4 verifies every error path (route `error.tsx`, data-load failures, mutation failures) routes through it. Some routes have `error.tsx`, not all. |
| **Route-level `loading.tsx` / `error.tsx` on every authed route** | Next.js App Router gives free Suspense/error boundaries; missing ones cause blank flashes / unhandled errors. | LOW-MEDIUM | Survey shows `loading.tsx`/`error.tsx` exist on *some* routes (discovery, strategies, factsheet/v2) but not uniformly. Fill the gaps. |
| **The 9-state matrix coverage extended past the wizard** | DESIGN.md already defines 9 states (loading/empty/error/partial/success/retry/stale/optimistic/offline) as a hard gate — but only for the API-key/wizard surfaces. | MEDIUM | Generalize the matrix discipline to the allocator composer, factsheets, and tables. Not every cell applies to every surface, but each surface should *declare* which states it handles. |

#### Differentiators
| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **"Stale data" honesty stamp** (already partly present) | A finance product showing a number must say *as of when*. Sync-freshness already exists (`deriveSyncFreshness`, `syncStampLabel`). | LOW | Surface the as-of/last-sync stamp consistently across KPI/table/chart surfaces, not just where it exists today. Reinforces the no-invented-data ethos. |
| **Distinct degenerate-vs-empty-vs-zero copy** | "Not enough overlapping history to compute correlation" reads as honest expertise; "0.00" reads as a lie. | MEDIUM | This is where the no-invented-data invariant becomes a *differentiator*, not just a constraint — institutional users trust a product that refuses to fake precision. Pair each metric with a method/overlap-N/horizon disclosure (the scenario surfaces already do this). |

#### Anti-Features
| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| **Spinners for content loads** | "Show it's loading." | A spinner gives no shape, causes layout shift on resolve, and reads as less polished than a skeleton. | Layout-matched skeletons for content; spinners only for *button-press in-flight* (small, inline). |
| **Friendly illustration / mascot empty states** | "Make empty states delightful." | A cartoon on a $-managing institutional tool cheapens it (DESIGN.md: no decorative elements, no stock illustration). | One headline + one sub-line + one CTA (the allocations `EmptyState` already nails this — locked copy, no illustration). Use it as the template. |
| **Fabricated placeholder data / "demo numbers" in empty states** | "Looks more alive." | Direct violation of no-invented-data; on a finance product it's a trust catastrophe. | Honest empty state + a CTA to connect real data. |
| **Optimistic UI that shows a computed metric before it's real** | "Feels instant." | Optimism is fine for *toggles* (the scenario engine renorms instantly on real client math), but never for a server-computed metric you don't have yet — that's invented data. | Optimistic only where the client already holds the real inputs (the frozen client engine); skeleton otherwise. |

---

### 5. Micro-interactions & motion (serious financial product)

#### Table Stakes
| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **`prefers-reduced-motion` respected everywhere** | WCAG + DESIGN.md mandate. Already done for `animate-pulse`, slider, mandate-flash. | LOW | v1.4 verifies any *new* motion in the evolved aesthetic also gates on it. Non-negotiable. |
| **Functional transitions only** (hover 150ms, tab/panel 250–300ms) | DESIGN.md's minimal-functional motion: transitions that aid comprehension (state change, panel open). | LOW | Already specified. Note the documented Tailwind v4 gotcha: use `duration-300` (not `duration-250`, which silently drops). Keep it consistent. |
| **State-change feedback** (saved stamps, toggle response, focus rings) | Subtle confirmation that an action registered reduces error rates (~15% in fintech A/B per UX research). | LOW | Wizard "Progress saved" toast, mandate-saved-flash, DESIGN.md focus rings (v1.2) already exist. Keep them; ensure the evolved aesthetic doesn't strip them. |

#### Differentiators
| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Coordinated, restrained chart/panel transitions** | A composer where the equity curve eases when you toggle a holding (instead of hard-cutting) communicates causality — "this change moved that line." | MEDIUM | Must stay frozen-math-safe (presentation only) and reduce-motion-gated. This is the *one* place motion earns its keep on this product: making the cause→effect of a what-if legible. |
| **Skeleton-to-content crossfade** | A gentle fade from skeleton to real content reads more polished than a pop. | LOW | Sub-200ms, reduce-motion-gated. |

#### Anti-Features
| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| **Scroll-triggered reveal animations** | "Modern landing pages do it." | DESIGN.md explicitly bans scroll-triggered effects; on a data tool they delay information and read as marketing fluff. | Content is present immediately; no scroll-reveal. |
| **Bouncing / spring / overshoot easing** | "Playful." | DESIGN.md bans bouncing; spring physics on a Bloomberg-class tool reads as a consumer app. | Ease-out enter / ease-in exit, no overshoot. |
| **Animated number count-ups** ("$0 → $1,234,567" rolling) | "Impressive KPI reveal." | On a finance product, a number *animating through wrong values* is literally showing invented intermediate data; also slows scanning. | Render the final number directly; skeleton while loading. |
| **Decorative loops** (spinning logo, pulsing accents, gradient shimmer beyond the skeleton glare) | "Feels alive." | DESIGN.md anti-patterns (no decorative animation, no gradients/blobs). | Static, calm chrome. The data is the show. |

---

### 6. Forms / wizard UX (manager onboarding)

#### Table Stakes
| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **Clear stepper with current/done/upcoming states + `aria-current="step"`** | Multi-step orientation. | LOW | `WizardChrome` already does this (4-step API / 4-step CSV branches, hairline rail, `aria-current`). v1.4 polishes legibility, doesn't rebuild. |
| **Persistent draft + "saved" stamp** | A manager onboarding a track record shouldn't lose work. | LOW | Already shipped (draft-saved stamp, delete-draft, cleanup cron). |
| **Inline, field-level validation with recovery copy** | "Submit and discover 5 errors" is hostile; institutional users expect precise field errors. | MEDIUM | `wizardErrors.ts` is the canonical copy source (good). Verify errors surface *at the field* and a step can't advance with a known-invalid field, with `ErrorEnvelope` for blocking failures. |
| **Focus moves to first control on step transition** | Keyboard/SR users must land in the new step. | LOW | Already a DESIGN.md a11y rule (DESIGN-05). Verify it holds across the evolved layout. |
| **CSS-first reflow (phone-usable)** | A founder with a CSV on a phone must complete onboarding (the DesktopGate funnel leak was fixed in v1.3). | LOW | Done (v1.3 Phase 46). Don't regress. |

#### Differentiators
| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Live preview / verify step** (the existing sync-preview / CSV-preview) | "We validate every row before computing your factsheet" — showing the parsed data before commit builds trust. | MEDIUM | Already exists (`sync_preview`, `csv_preview` steps). Polish the preview presentation to factsheet-grade (it's the manager's first taste of the product quality). |
| **Per-source adaptive fields with inline guidance** | OKX needs a passphrase, Binance/Bybit don't; IP-allowlist hints per source. | MEDIUM | Already specced (DESIGN.md broker selector grid + per-source schema in UI-SPEC). Verify the guidance copy (`WizardIpAllowlistHint`) is legible + the underline-always-on a11y fix from v1.3 holds. |
| **Review-before-submit summary** | Let the manager see everything they entered before the irreversible create. | LOW-MEDIUM | The Submit step can be a read-only summary with edit-jump-back links. Reduces support load. |

#### Anti-Features
| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| **Single mega-form (all fields on one page)** | "Fewer clicks." | For a multi-source onboarding with validation + a compute step, one giant form is overwhelming and can't show the verify-preview gate. | Keep the stepped wizard; it's the right pattern here. |
| **Progress gamification** (confetti, "80% done!" celebration) | "Boost completion." | Cheapens an institutional tool; DESIGN.md bans decorative animation. | Honest "Step 3 of 4" + a saved stamp. |
| **Forcing account creation before showing value** | "Capture the lead." | The retired DesktopGate was exactly this funnel leak — v1.3 fixed it. Don't reintroduce a gate. | Let them onboard; capture happens naturally at submit. |
| **Auto-advancing steps on field blur** | "Smooth." | Steals control; an accidental valid value jumps the user forward, disorienting. | Explicit Next; validate on blur but advance on click. |

---

## Feature Dependencies

```
[Evolved design system / type tokens]
    └──requires──> defining fluid (display) + discrete (data) tiers as one token set
    └──enables───> [Fluid no-clip typography]  (every surface reads the tokens)
    └──enables───> [App-wide conformance]      (grep-enforced like strategy-v2-type-scale.test.ts)

[Fluid no-clip typography]
    └──requires──> [Truncation audit] (classify all 35 truncate / line-clamp sites: legit vs bug)
    └──depends-on─> v1.3 zoom/reflow gates (must not regress; rem-based clamp keeps zoom working)

[Command palette / global search]
    └──requires──> role-scoped result gating (reuse buildNavSections OR-logic)
    └──requires──> RLS-scoped strategy/allocation search (privacy invariant — no cross-tenant leak)
    └──enhances──> [IA / navigation] (the "deep reach" mechanism that lets nav stay flat)

[Data-table reshape: sticky header + sticky first col + priority-collapse]
    └──builds-on─> ResponsiveTable (today scroll-only; its own TODO defers reshape to "TABLE-01")
    └──depends-on─> v1.3 all-columns-no-drop guard (priority-collapse must keep data reachable)
    └──uses──────> existing --row-h / --density-pad tokens for the density control

[Layout-matched skeletons + full 9-state coverage]
    └──builds-on─> Skeleton primitive + ErrorEnvelope + EmptyStateCard (compose, don't rebuild)
    └──gated-by──> no-invented-data invariant (degenerate ≠ zero; honest copy per state)

[Restrained motion polish]
    └──gated-by──> prefers-reduced-motion (already wired for animate-pulse/slider/flash)
    └──gated-by──> frozen-math invariant (chart transitions are presentation-only)

[Wizard polish]
    └──builds-on─> WizardChrome + wizardErrors.ts + CSS-first reflow (all exist)

CONFLICTS:
[Fluid-scaling the mono/data tier]  ✗ conflicts with  [tabular-nums cross-row alignment]
[Card-stacked mobile tables]        ✗ conflicts with  [cross-row metric comparison] (v1.3 chose scroll)
[Animated number count-ups]         ✗ conflicts with  [no-invented-data] (shows wrong intermediate values)
```

### Dependency Notes
- **Evolved design system is the spine.** It must land *first* (a `design-consultation` pass refreshing DESIGN.md), because fluid type, conformance, and the table/state work all consume its tokens. Sequencing it late means re-touching every surface twice.
- **Truncation audit gates fluid type.** You can't safely make type fluid until you've classified which existing `truncate` sites are legitimate (keep) vs accidental clips (fix) — otherwise fluid type just relocates the clip bug.
- **Command palette is the largest net-new build** and the one true "feature" in a quality milestone — scope it carefully (nav+search first, actions later) and respect RLS + role gating + no-invented-data (real results only).
- **Table reshape depends on, and must not regress, the v1.3 no-dropped-columns guard** — priority-collapse hides into reachable detail, never deletes.

---

## MVP Definition (for a quality milestone, "MVP" = the conformance floor every surface must clear)

### Land first (the spine + the non-negotiables)
- [ ] **Evolved design system** — DESIGN.md refreshed (type scale incl. fluid+discrete tiers, color, spacing, motion) as the single token source. *Everything downstream depends on it.*
- [ ] **Truncation audit + fix** — classify all 35 `truncate` / 9 line-clamp sites; fix every accidental data-clip; keep legitimate ones (tooltip-backed, full value reachable).
- [ ] **Fluid no-clip typography** — `clamp()` on rem for display/prose tiers; KPI numbers + tables stay discrete + sized-to-widest-value; verified 320px→ultra-wide with no clip.
- [ ] **Honest state coverage** — every surface: layout-matched skeleton, distinct degenerate/empty/zero copy (no-invented-data), `ErrorEnvelope` on every error path, `loading.tsx`/`error.tsx` gap-fill.

### Add after the spine
- [ ] **Data-table reshape** — sticky header + sticky identifier column + visual scroll cue + column-priority collapse-to-detail; per-table density control via existing tokens.
- [ ] **IA polish** — searchParams-aware active states; breadcrumbs wired on all drill-down routes; back-path/deep-link verification.
- [ ] **Wizard polish** — field-level validation surfacing, review-before-submit summary, preview-step presentation upgrade.

### Differentiator (scope deliberately — biggest net-new)
- [ ] **Command palette + global search** — ⌘K, role-scoped, RLS-scoped, real-results-only. The single highest-leverage IA upgrade; scope nav+search first.

### Verification & debt cleanup (milestone exit gate)
- [ ] App-wide axe WCAG-AA + 320px reflow + 400% zoom + lighthouse-mobile gates green; design-review pass.
- [ ] Folds v1.3 deferred debt: ratchet lighthouse budget up from 0.60; re-enable authed/mobile axe rows; real-device sign-off.

### Future Consideration (v2+ — keep out of scope)
- [ ] Customizable/persisted nav + table layouts — speculative for pre-revenue; revisit on repeated user ask.
- [ ] Command-palette *actions* (run optimizer, create scenario from palette) — after nav+search proves the surface.
- [ ] Dark mode app-wide — DESIGN.md says "not planned; institutional finance is light mode" (the factsheet-v2 dark/colorblind palette is a scoped print/factsheet exception, not an app-wide direction).

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Evolved design system (token spine) | HIGH | MEDIUM | P1 |
| Truncation audit + fix | HIGH | MEDIUM | P1 |
| Fluid no-clip typography | HIGH | MEDIUM | P1 |
| Honest state coverage (skeleton/empty/error, no-invented-data) | HIGH | MEDIUM | P1 |
| Data-table reshape (sticky/priority/density) | HIGH | MEDIUM-HIGH | P1 |
| IA polish (active state / breadcrumbs / deep-link) | MEDIUM | MEDIUM | P2 |
| Wizard polish (validation / review / preview) | MEDIUM | MEDIUM | P2 |
| Command palette + global search | HIGH | MEDIUM-HIGH | P2 |
| Restrained motion polish | MEDIUM | LOW | P2 |
| Container queries (component-level responsiveness) | MEDIUM | MEDIUM-HIGH | P3 |
| Per-table column show/hide | LOW-MEDIUM | MEDIUM | P3 |

---

## Competitor Feature Analysis

| Feature | FactSet / Bloomberg (institutional terminal) | Stripe Dashboard (best-in-class SaaS) | Our Approach |
|---------|----------------------------------------------|---------------------------------------|--------------|
| Type / density | Extremely dense, fixed mono numerics, multi-panel factsheets | Comfortable density, fluid display type, mono numerics | Fluid display + discrete mono (DESIGN.md "comfortable, tighter than SaaS, less than Bloomberg") |
| Navigation | Function-code/command-driven (terminal); deep nested menus | Grouped dropdown nav + dashboard search + ⌘K | Flat role-sectioned sidebar + command palette for deep reach (best of both) |
| Tables | Sticky everything, in-cell encoding, max density | Sticky header, sort, in-cell badges | Sticky header + sticky identifier + priority-collapse + sparklines |
| Empty/honest states | Refuses to compute on insufficient data (shows blanks/N/A) | Polished empty states with CTAs | Honest degenerate copy (em-dash for null, method/overlap-N disclosure) — *our differentiator* |
| Motion | Essentially none (terminal) | Restrained, functional | Minimal-functional; one earned use: composer cause→effect chart easing |
| Onboarding | Account-managed / heavy | Stepped, validated, preview-before-commit | Stepped wizard + verify-preview + per-source fields (already built; polish) |

---

## Anti-Feature Summary (flag to roadmapper for explicit Out of Scope)

The following should land in the milestone's **Out of Scope** so the "evolved aesthetic" pass doesn't drift into them — all cheapen an Industrial/Utilitarian, no-invented-data financial product:

1. Fluid-scaling the numeric/mono tier; JS shrink-to-fit on KPI text; marquee/auto-scroll long names.
2. Mega-menu/flyout nav; customizable/drag-reorder nav; breadcrumbs on top-level routes.
3. Card-stacked mobile financial tables; pagination of small tables; auto-fit that squeezes numbers.
4. Spinners for content; illustration/mascot empty states; **fabricated placeholder/demo numbers in empty states**; optimistic UI showing un-computed metrics.
5. Scroll-triggered reveals; bounce/spring easing; **animated number count-ups**; decorative loops/shimmer/gradients.
6. Single mega-form; progress gamification/confetti; re-introducing an onboarding gate (DesktopGate-class funnel leak); auto-advancing steps.

Items in **bold** are also direct **no-invented-data invariant** violations, not just aesthetic ones.

---

## Sources

- Live codebase survey (HIGH confidence — first-party): `src/components/layout/Sidebar.tsx`, `Breadcrumb.tsx`, `src/components/ResponsiveTable.tsx`, `src/app/globals.css`, `WizardChrome.tsx`, `EmptyState.tsx`, `MetricCell.tsx`, `Skeleton.tsx`; `.planning/PROJECT.md`; `DESIGN.md`. Truncation count: `grep` across `src/**/*.tsx` (35 files use `truncate`; 6× `line-clamp-2`, 2× `text-ellipsis`, 1× `line-clamp-3`; **zero `clamp()`**; **no command palette**).
- [Modern Fluid Typography Using CSS Clamp — Smashing Magazine](https://www.smashingmagazine.com/2022/01/modern-fluid-typography-css-clamp/) (MEDIUM — rem-not-px, zoom-safety caveat)
- [line-clamp CSS property — MDN](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/line-clamp) (HIGH — truncation mechanics)
- [Improving responsive data table UX with CSS — LogRocket](https://blog.logrocket.com/improving-responsive-data-table-ux-css/) (MEDIUM — sticky header/first-col, priority collapse)
- [Data Table Design UX Patterns & Best Practices — Pencil & Paper](https://www.pencilandpaper.io/articles/ux-pattern-analysis-enterprise-data-tables) (MEDIUM — enterprise table patterns, density, freezing)
- [Design patterns for Stripe Apps — Stripe Documentation](https://docs.stripe.com/stripe-apps/patterns) (MEDIUM — dashboard nav/search IA)
- [SaaS Dashboard UX Patterns Guide — GitNexa](https://www.gitnexa.com/blogs/saas-dashboard-ux-patterns) (LOW-MEDIUM — role-based dashboards, progressive disclosure)
- [The Role of Animation and Motion in UX — Nielsen Norman Group](https://www.nngroup.com/articles/animation-purpose-ux/) (MEDIUM — restraint, motion-as-feedback)
- [Motion — Carbon Design System](https://carbondesignsystem.com/elements/motion/overview/) (MEDIUM — durations, reduce-motion as mandatory)

---
*Feature research for: institutional financial-data dashboard UI/UX overhaul (v1.4 Frontend Excellence)*
*Researched: 2026-06-28*
