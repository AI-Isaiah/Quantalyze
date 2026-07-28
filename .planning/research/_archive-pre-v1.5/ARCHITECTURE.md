# Architecture Research

**Domain:** Presentation-layer overhaul (design tokens + fluid type + IA restructure + RSC hygiene) of an existing Next.js 16 / React 19 / Tailwind v4 institutional-fintech app
**Researched:** 2026-06-28
**Confidence:** HIGH (grounded in the live codebase + Tailwind v4 / Next 16 docs verified this session; build-order sequencing is MEDIUM — a judgment call)

> **Scope note.** This is milestone v1.4 "Frontend Excellence" — an integration-WITH study, not a greenfield design. The data/compute layer is **FROZEN** (`scenario.ts` SCENARIO-05 zero-diff, `compute.ts` parity, no-invented-data, no-peer-rank-a-hypothetical). Desktop byte-identity is **LIFTED** (visual changes allowed); the v1.3 WCAG-AA floor must **not** regress. Everything below is about *where the new work plugs in* and *in what order*.

---

## Standard Architecture

### System Overview — where the new work lives

```
┌──────────────────────────────────────────────────────────────────────┐
│  TOKEN LAYER  (single source of truth)                                 │
│  DESIGN.md  ──▶  src/app/globals.css @theme { }   ──▶  Tailwind utils  │
│       │              + :root CSS vars                  (text-*, bg-*…)  │
│       └──▶  src/lib/design-tokens/*.ts  (TS mirror, drift-tested)       │
│            ▲ NEW: fluid --text-* clamp scale, --space-* clamp scale     │
└───────────────────────────────┬──────────────────────────────────────┘
                                 │ tokens consumed by ▼
┌──────────────────────────────────────────────────────────────────────┐
│  PRIMITIVE LAYER  src/components/ui/   (Button, Card, Input, Badge,    │
│  Modal, Skeleton…)  + NEW: Table, Tabs, Dialog, Select, Field          │
│       ▲ already adopted: Button 68×, Card 48×, Input 21×, Modal 14×    │
│       ▲ migration target: 186 raw <button>, 64 raw <table>, 48 <input> │
└───────────────────────────────┬──────────────────────────────────────┘
                                 │ composed by ▼
┌──────────────────────────────────────────────────────────────────────┐
│  RESPONSIVE PRIMITIVES (v1.3, FROZEN-as-built — build ON these)        │
│  useBreakpoint · ResponsiveTable · ResponsiveChartFrame ·             │
│  useTapPin · TouchTooltip                                              │
└───────────────────────────────┬──────────────────────────────────────┘
                                 │ assembled by ▼
┌──────────────────────────────────────────────────────────────────────┐
│  SHELL / IA LAYER                                                      │
│  src/proxy.ts (route gate, NEVER rename)  ·  route groups             │
│  (auth)/(dashboard)  ·  DashboardChrome  ·  Sidebar (single nav SoT)  │
│  ▲ NEW: breadcrumbs, role-scoped nav refinement, IA consolidation     │
└───────────────────────────────┬──────────────────────────────────────┘
                                 │ surfaces ▼
┌──────────────────────────────────────────────────────────────────────┐
│  SURFACES  (RSC server shells + client islands)                       │
│  Allocator (/allocations + composer) · Manager wizard · Discovery ·   │
│  Factsheet v2 (FROZEN render — FactsheetProvider/FactsheetBody) ·      │
│  /security · public/marketing · admin                                 │
│  ▲ FROZEN math island: src/lib/scenario.ts (client TS) + Web Worker   │
└──────────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Owns | Status in v1.4 |
|-----------|------|----------------|
| `DESIGN.md` | The aesthetic spec — type/color/space/motion in prose + the Decisions Log | **MODIFIED** (refreshed to evolved system; stays the SoT) |
| `src/app/globals.css` `@theme` block | Compiles design tokens → CSS vars → Tailwind utilities | **MODIFIED** (add `--text-*` fluid scale, `--space-*` fluid scale; keep existing `--color-*`/`--radius-*`) |
| `src/lib/design-tokens/*.ts` | TS mirror of tokens consumed in JS (trust-tier today); drift-asserted vs DESIGN.md | **MODIFIED/NEW** (extend if any new token needs JS consumption) |
| `src/components/ui/*` | Shared visual primitives (Button/Card/Input/Badge/Modal/Skeleton) | **MODIFIED + NEW** (refresh existing; add Table, Tabs, Dialog, Select, Field, Breadcrumb) |
| v1.3 responsive primitives | Breakpoint-gated layout/chart adaptivity | **FROZEN-as-built** (consume, do not rewrite) |
| `src/proxy.ts` | Auth/route gating, PUBLIC_ROUTES allowlist, share-link bypass | **MODIFIED (surgically) or UNTOUCHED** — every IA route move must keep its proxy entry correct |
| `DashboardChrome` + `Sidebar` | App shell + the single nav source of truth (`buildNavSections` / `buildPrimaryMobileNav`) | **MODIFIED** (IA: nav refinement, breadcrumbs, active states) |
| `FactsheetProvider` / `FactsheetBody` / `FactsheetView` | The frozen 7-panel factsheet + its `persist={false}` scenario reuse | **FROZEN render** (BODY-02 byte-identity guard; tokens may flow in but structure/classes are pinned) |
| `src/lib/scenario.ts` + Web Worker | Client-side scenario math | **FROZEN** (SCENARIO-05 zero-diff) |

---

## Recommended Project Structure

The repo already follows sound App-Router conventions. v1.4 is **additive + surgical**, not a restructure of the tree. Concrete homes:

```
src/
├── app/
│   ├── globals.css              # @theme tokens — ADD fluid --text-*/--space-* here
│   ├── layout.tsx               # root: next/font vars on <html>, viewport — UNTOUCHED
│   ├── (auth)/                  # route group — login/signup/onboarding
│   ├── (dashboard)/             # route group — authed shell via DashboardChrome
│   │   └── layout.tsx           # server auth lookup → DashboardChrome (role flags)
│   ├── (marketing)/  ◀── OPTIONAL NEW group: /security, /for-quants, /demo, /legal
│   │       (today these are loose top-level dirs with no shared shell)
│   ├── factsheet/[id]/v2/       # FROZEN factsheet (FactsheetBody/Provider/View)
│   ├── scenario-share/[token]/  # public deep-linked share — proxy-allowlisted
│   └── proxy.ts (at src/proxy.ts) # route gate — keep PUBLIC_ROUTES in sync w/ any move
├── components/
│   ├── ui/                      # PRIMITIVE LAYER — refresh + extend here
│   │   ├── Button.tsx Card.tsx Input.tsx Badge.tsx Modal.tsx Skeleton.tsx  (exist)
│   │   ├── Table.tsx Tabs.tsx Dialog.tsx Select.tsx Field.tsx  ◀── NEW primitives
│   │   └── Breadcrumb.tsx                                       ◀── NEW (IA)
│   ├── layout/                  # SHELL — Sidebar (nav SoT), DashboardChrome, Mobile*
│   └── charts/ ResponsiveTable ResponsiveChartFrame  # v1.3 primitives — consume
├── hooks/
│   └── useBreakpoint.ts useTapPin.ts                 # v1.3 — consume
└── lib/
    ├── design-tokens/           # TS token mirror (drift-tested vs DESIGN.md)
    └── utils.ts                 # cn() class-joiner (no clsx/tailwind-merge today)
```

### Structure Rationale

- **`(marketing)` route group is the one genuine IA structural option.** Today `/security`, `/for-quants`, `/demo`, `/legal` are loose top-level dirs with no shared layout, each re-implementing its own header/footer. A `(marketing)` group with a shared layout gives consistent public chrome **without changing any URL** (route groups are URL-invisible — confirmed in Next 16 docs: parens "should not be included in the route's URL path"). This preserves SEO and bookmarks for free. **Caveat (from docs):** if it introduces a *second root layout*, cross-group navigation triggers a full page reload — so do **not** make it a root layout; nest it under the existing single root `app/layout.tsx`.
- **Keep `src/proxy.ts` exactly where it is.** Next 16 renamed `middleware` → `proxy` (per `AGENTS.md` "not the Next.js you know" warning, and confirmed by the live `src/proxy.ts`). It is the route-gate SoT; treat its `PUBLIC_ROUTES` array as a **hard invariant to update in lockstep** with any route move.
- **Tokens stay in `globals.css` `@theme` + `src/lib/design-tokens/`.** Two homes, one source: CSS-consumed tokens compile from `@theme`; JS-consumed tokens mirror in `design-tokens/` and are drift-tested against DESIGN.md (`tests/a11y/trust-tier-tokens.test.ts` is the existing precedent). Do not invent a third token store.

---

## Architectural Patterns

### Pattern 1: Token layer — fluid `clamp()` scale in `@theme`, DESIGN.md as SoT

**What:** Add a fluid type scale and fluid space scale as named tokens in the `@theme` block. Tailwind v4 generates `text-*` utilities from the `--text-*` namespace and `p-*/m-*/gap-*` from `--spacing-*` (verified against current Tailwind docs). `clamp()` is valid inside a `@theme` token value and flows into the generated utility.

**When to use:** Everywhere the current DESIGN.md fixed-px scale (48/32/24/16/14/13/12/10-11) clips or fails to scale. Replace fixed sizes with fluid named tokens so a single token change propagates app-wide — no per-component rewrite.

**Trade-offs:** clamp tokens fix scaling and eliminate most truncation pressure, but the floor (min) must stay ≥ the WCAG 1.4.4 / 320px-legibility bar v1.3 enforces. Charts that read pixel sizes off CSS (the SVG charts) need the clamp floor verified against their `useTapPin`/legibility gates.

**Example:**
```css
/* globals.css — ADD to the existing @theme block (alongside --color-*/--radius-*) */
@theme {
  /* Fluid type — named to mirror DESIGN.md's semantic tiers, not raw px.
     Each clamp(min, preferred, max): min holds 320px legibility, max caps ultra-wide. */
  --text-hero:    clamp(2rem, 1.2rem + 4vw, 3rem);     /* 32→48px */
  --text-h2:      clamp(1.25rem, 1.1rem + 0.8vw, 1.5rem);
  --text-body:    clamp(0.875rem, 0.85rem + 0.15vw, 0.9375rem);
  --text-caption: clamp(0.75rem, 0.74rem + 0.05vw, 0.8125rem);
  /* Fluid section spacing (DESIGN.md "24-32px between sections") */
  --spacing-section: clamp(1.5rem, 1rem + 2vw, 2rem);
}
```
> **Critical gotcha already discovered in this codebase:** `@theme inline` *inlines literal values* into utility classes, so a runtime CSS-var override on an ancestor **cannot** flip a `bg-surface`/`text-text-primary` utility (this is exactly why the factsheet dark mode needs scoped `!important` overrides — see globals.css lines 481-580). Therefore: a token whose value is **static** can live in plain `@theme`; a token that must be **runtime-swappable** (e.g. accent-intensity, dark factsheet) needs the scoped-override pattern, not a bare token. The `--font-*` tokens already use `@theme inline` because they reference the `next/font` `var(--font-dm-sans)` variables (layout.tsx puts those on `<html>`).

### Pattern 2: The dark sidebar is a fixed surface, not a theme mode

**What:** The navy sidebar (`#0F172A`) is modeled today as dedicated `--color-sidebar-*` tokens (`-hover`, `-active`, `-text`, `-text-active`) consumed via `bg-sidebar`/`text-sidebar-text`. It is **not** a runtime dark-mode toggle — DESIGN.md explicitly says "Dark mode: Not planned. Institutional finance is light mode."

**When to use:** Any other persistently-dark surface (a future dark panel, a chart-on-dark) should follow the **same fixed-surface-token pattern** — a self-contained `--color-{surface}-*` family — NOT a `data-theme` mode. The only `data-theme="dark"` in the app is the opt-in factsheet dark export, which is correctly handled by scoped overrides (Pattern 1 gotcha).

**Trade-offs:** Fixed-surface tokens are simpler and avoid the `@theme inline` runtime-flip trap entirely. The cost is no global dark mode — which is a deliberate product decision, not a limitation.

### Pattern 3: Incremental primitive adoption (strangler, not big-bang)

**What:** The `ui/` primitive layer already exists and is well-adopted (Button 68 files, Card 48). The work is (a) refresh existing primitives to the evolved tokens, then (b) migrate raw elements (186 raw `<button>`, 64 `<table>`, 48 `<input>`) to primitives **surface by surface**, highest-traffic first. Add the missing primitives (Table, Tabs, Dialog, Select, Field) as the migration demands them.

**When to use:** Always — never rewrite all surfaces at once. Refresh the primitive's internal classes once → every existing consumer updates for free → then migrate raw elements per surface behind that surface's verification gate.

**Trade-offs:** Slower than a rewrite but safe: each surface stays shippable, and the existing per-surface axe/reflow gates catch regressions at the boundary you're touching. Big-bang would blow the SCENARIO-05/BODY-02 freezes and the WCAG floor simultaneously.

**Example (refresh once, propagate everywhere):**
```tsx
// Button.tsx — change variantStyles/sizeStyles to evolved tokens ONCE.
// All 68 importers inherit the new look. No per-call-site edit.
const sizeStyles = {
  sm: "px-3 py-1.5 text-caption",         // was text-xs → fluid token
  md: "min-h-[44px] px-4 py-2.5 text-body", // keeps the 44px touch-target floor
};
```
> **Tooling note:** `cn()` in `src/lib/utils.ts` is a hand-rolled class-joiner; there is **no `clsx`/`tailwind-merge`/`cva`** in deps. Adding `tailwind-merge` would make primitive variants conflict-safe (later class wins) and `cva` would formalize variant maps — both are reasonable v1.4 additions but are *optional* and should be a deliberate decision, not assumed.

### Pattern 4: RSC server-shell + client-island boundary (React 19 / Next 16)

**What:** Keep the established split: **page.tsx = async Server Component** that does the auth lookup + data fetch (the `(dashboard)/layout.tsx` pattern — `await supabase.auth.getUser()`, role flags), then hands serializable props to **`"use client"` islands** for anything interactive. The scenario engine, the FactsheetProvider, and all the toggle/pan/zoom state are correctly client islands today.

**When to use:** Default new shell/IA work (breadcrumbs derived from route, static nav, page headers) to **Server Components**. Only the interactive leaves (`usePathname`-driven active state, the composer, charts) need `"use client"`. Breadcrumbs that need the current path can be a small client component reading `usePathname` (like `Sidebar` already does) — or server-derived from `params`.

**Trade-offs:** The frozen client-TS scenario engine means the composer subtree stays a large client island — do not try to RSC-ify it. The factsheet's split-context architecture (PayloadContext static, XRangeContext high-churn) is already optimal; v1.4 must not collapse those contexts.

> **Hydration discipline (verified in layout.tsx):** the `useBreakpoint` SSR-safe two-pass pattern and the `viewport` typed export are load-bearing. Any new client component that branches on viewport/`localStorage` must use the same SSR-safe pattern (server renders the desktop/default branch, `useEffect` upgrades post-hydration) or it will hydration-mismatch — this is documented in DESIGN.md's `strategy.ui_v2` SSR-safety decision and the v1.3 MEMORY notes.

---

## Data Flow

### Token propagation (the one-source-of-truth path)

```
DESIGN.md (prose spec + Decisions Log)
    ↓  (authored by design-consultation; drift-tested)
globals.css @theme { --color-* --text-* --space-* --radius-* }
    ↓  (Tailwind v4 compiles → :root CSS vars + utilities)
text-body / bg-surface / p-section / rounded-lg  (utilities)
    ↓                                    ↘ (JS-consumed tokens only)
component className                        src/lib/design-tokens/*.ts (mirror)
    ↓                                            ↓
rendered surface                          drift test asserts hex ∈ DESIGN.md
```

### Request / render flow (unchanged by v1.4 — presentation only)

```
request → src/proxy.ts (session check + PUBLIC_ROUTES allowlist)
    ↓ (authed)
(dashboard)/layout.tsx [Server]  → getUser() + role flags + populatedSlugs
    ↓
DashboardChrome [Client]  → Sidebar (buildNavSections SoT) + MobileNav + skip-link
    ↓
page.tsx [Server]  → data fetch (Supabase, RLS-scoped)
    ↓
client islands  → scenario.ts (FROZEN) / FactsheetProvider / charts
```
**No data-flow change is in scope.** v1.4 touches only the className/structure of what renders, not how data arrives.

### Share-link / deep-link flow (a hard constraint, must survive IA changes)

```
/scenario-share/[token]  → proxy PUBLIC_ROUTES bypass (auth-bounce-exempt)
    ↓  → leak-scoped SECURITY DEFINER RPC (returns only the shared scenario)
    ↓  → renders the FROZEN factsheet, NO allocator-book leak
/factsheet/[id], /strategy/[id], /browse/[slug] → same public-but-authed-exempt class
```
Any IA route rename/move **must** keep these exact paths (or add a `permanentRedirect`/`next.config redirects` 308 from the old path) AND keep the matching `PUBLIC_ROUTES` + auth-bounce-exempt entries in `proxy.ts`. This is the single highest-risk integration point.

---

## Suggested Build Order (Phases 49+)

Dependency-ordered. Earlier phases are *enablers* — they make later phases cheap and safe. Verification is **woven in**, not bolted on at the end (the existing per-surface axe/reflow/zoom/lhci gates are the mechanism).

| Phase | Name | Why here (dependency) | New / Modified / Frozen |
|-------|------|------------------------|--------------------------|
| **49** | **Design-system refresh (DESIGN.md) + token foundation** | Nothing can conform to a system that isn't written. Refresh DESIGN.md (design-consultation), then land the fluid `--text-*`/`--space-*` `@theme` tokens + token drift tests. Pure foundation, low blast radius. | MOD: DESIGN.md, globals.css `@theme`, design-tokens/* · FROZEN: `@theme inline` font vars, `--color-*` (or evolve deliberately) |
| **50** | **Primitive refresh + missing primitives** | Depends on 49's tokens. Refresh Button/Card/Input/Badge/Modal/Skeleton to evolved tokens; add Table, Tabs, Dialog, Select, Field, Breadcrumb. One change here propagates to 68/48/21 existing consumers. | NEW: ui/Table,Tabs,Dialog,Select,Field,Breadcrumb · MOD: existing ui/* · (optional: add tailwind-merge/cva) |
| **51** | **Shell + IA restructure** | Depends on 50 (Breadcrumb primitive, refreshed nav styling). Optional `(marketing)` route group + shared public chrome; nav refinement in `buildNavSections`; breadcrumbs in DashboardChrome; consistent active/focus/back-paths. **Highest-risk phase** — touches proxy/RLS/share-link/SEO. Do redirects + PUBLIC_ROUTES sync here. | MOD: route groups, DashboardChrome, Sidebar, proxy.ts (surgical), next.config redirects · FROZEN: scenario-share/factsheet/strategy/browse public paths |
| **52** | **Per-surface application — allocator journey** | Depends on 50/51. Apply primitives + fluid type + no-clip to /allocations, composer, Discovery, Risk, Bridge. **Composer = frozen client island**; only its chrome/layout changes, the `scenario.ts` calls and FactsheetBody render stay byte-identical (BODY-02). Biggest, highest-traffic surface. | MOD: allocations widgets (53 tsx), discovery · FROZEN: scenario.ts, FactsheetBody render, computeScenario calls |
| **53** | **Per-surface application — manager wizard + /security + admin + public** | Depends on 50/51. Lower-traffic surfaces; wizard already de-blocked below 640px (v1.3 P46), so this is token/primitive conformance + no-clip. | MOD: wizard steps, /security, admin pages, marketing pages · FROZEN: wizard step machine logic |
| **54** | **Verification, v1.3 debt cleanup, conformance gate** | Last — everything must exist to gate it. App-wide axe/reflow/zoom/lhci rows; ratchet `lighthouse-mobile` off 0.60; re-enable authed/mobile axe rows (needs hermetic seeded DB); design-review; real-device sign-off; a no-clip CI guard (grep/visual for truncation regressions). | NEW: no-clip guard, raised gates · MOD: lighthouserc.json, axe-app-wide.spec.ts |

**Verification slotting:** each per-surface phase (52, 53) runs its surface's *existing* axe/reflow/zoom gate as its exit criterion — so verification is continuous, and Phase 54 is the *raise-the-bar + close-the-debt* pass, not the first time anything is checked. The frozen-engine guards (SCENARIO-05, BODY-02) must stay green in **every** phase from 49 on.

**Why tokens-first, not IA-first:** IA restructure (51) is the riskiest phase (proxy/RLS/share-links). Doing tokens (49) and primitives (50) first means when you touch routing you're moving *already-conformant* surfaces, so you can verify "did the route still gate/render correctly" without also debugging "does it look right" — separating the two failure classes.

---

## Anti-Patterns

### Anti-Pattern 1: Runtime CSS-var override expecting it to flip a `@theme inline` utility

**What people do:** Set `--color-surface: #...` on an ancestor and expect `bg-surface` children to change.
**Why it's wrong:** Tailwind v4 `@theme inline` inlines the *literal value* into the utility class — the variable indirection is gone. This bug already bit this codebase 4× (globals.css line 481 comment; the EquityChart/KpiStrip drift in the 2026-05-06 Decisions Log).
**Do this instead:** Static tokens → plain `@theme`. Runtime-swappable → scoped `!important` override rule (the factsheet `data-theme="dark"` pattern) OR a fixed-surface token family (the sidebar pattern). For any color CSS var consumed in a component, always use the `--color-*` prefix (2026-05-06 decision).

### Anti-Pattern 2: Renaming/moving a route without updating `proxy.ts` + redirects

**What people do:** Move a public surface (e.g. /security) into a route group folder and assume the URL is unchanged so nothing else needs touching — or rename a path and forget the share-link allowlist.
**Why it's wrong:** Route groups *are* URL-invisible (safe), but any **actual path change** breaks (a) `PUBLIC_ROUTES`/auth-bounce-exempt entries → authed users get 307'd or unauthed share-link recipients hit /login (the exact #512 canary bug from MEMORY), and (b) bookmarks/SEO.
**Do this instead:** Prefer URL-invisible route groups. If a URL must change, add a `permanentRedirect` (308) or `next.config redirects`, AND update `PUBLIC_ROUTES` + the auth-bounce-exempt list in the same commit. Treat the `/scenarios → /allocations?tab=scenario` retirement (Phase 32) as the reference pattern.

### Anti-Pattern 3: Touching the frozen factsheet/scenario render to "make it look better"

**What people do:** Re-class the FactsheetBody or tweak a `scenario.ts` output for visual polish.
**Why it's wrong:** SCENARIO-05 (zero-diff) and BODY-02 (byte-identity) are CI gates; the factsheet's `persist={false}` reuse means a change ripples into the composer. The scenario engine is the product's correctness core.
**Do this instead:** Tokens flow *into* the factsheet via the existing `--color-*` utilities (already light-mode-correct after GUARD-01); structural/visual evolution of the factsheet itself is **out of scope** unless a phase explicitly lifts BODY-02 for it (it does not). Style the *chrome around* the factsheet, not the factsheet body.

### Anti-Pattern 4: Big-bang primitive rewrite

**What people do:** Replace all 186 raw `<button>`/64 `<table>` in one PR.
**Why it's wrong:** Blows every freeze and the WCAG floor at once; un-reviewable; collides with parallel agents (a documented recurring hazard in MEMORY).
**Do this instead:** Refresh the primitive once (Pattern 3), migrate raw elements per surface behind that surface's existing gate.

---

## Integration Points

### NEW vs MODIFIED vs FROZEN (the explicit ledger the roadmapper needs)

**NEW:**
- Fluid `--text-*` + `--space-*` clamp scale in `@theme` (globals.css)
- `ui/Table`, `ui/Tabs`, `ui/Dialog`, `ui/Select`, `ui/Field`, `ui/Breadcrumb` primitives
- (Optional) `(marketing)` route group + shared public layout
- No-clip CI guard (anti-truncation regression test)
- Raised verification gates (lighthouse ratchet, re-enabled authed/mobile axe rows)
- (Optional, deliberate) `tailwind-merge` + `cva` in deps for variant safety

**MODIFIED:**
- `DESIGN.md` (evolved system + Decisions Log entries) — stays the SoT
- `globals.css` `@theme` color/radius tokens (if the palette evolves)
- `src/lib/design-tokens/*.ts` (extend if new JS-consumed tokens)
- Existing `ui/*` primitives (Button/Card/Input/Badge/Modal/Skeleton) — internal classes only
- `Sidebar` (`buildNavSections`/`buildPrimaryMobileNav`) + `DashboardChrome` (breadcrumbs, IA)
- `src/proxy.ts` (surgical — only if a route URL actually changes)
- `next.config.ts` (redirects, only if URLs change)
- `lighthouserc.json`, `e2e/axe-app-wide.spec.ts` (gate rows)
- Per-surface widgets/pages (allocations, discovery, wizard, /security, admin, marketing) — class/structure, not logic
- The 103 `truncate` + 7 `line-clamp` + 2 `text-ellipsis` sites (audit + remove where they cause clipping)

**FROZEN (do not touch the behavior/render):**
- `src/lib/scenario.ts` + its Web Worker (SCENARIO-05 zero-diff)
- `src/lib/compute.ts` parity
- `FactsheetBody` / `FactsheetView` render + `factsheet-context.tsx` split-context architecture (BODY-02)
- v1.3 responsive primitives: `useBreakpoint`, `ResponsiveTable`, `ResponsiveChartFrame`, `useTapPin`, `TouchTooltip` (build ON, don't rewrite)
- `@theme inline` `--font-*` vars (wired to `next/font` in layout.tsx)
- Public/share-link paths: `/scenario-share/[token]`, `/factsheet/[id]`, `/strategy/[id]`, `/browse/[slug]`, `/portfolio-pdf/[id]` + their proxy allowlist entries
- No-invented-data + no-peer-rank invariants (their one audited `scenarioPeer` carve-out aside)
- WCAG-AA floor (v1.3 — must not regress)

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| `@theme` tokens ↔ components | Tailwind-compiled utilities + `var(--color-*)` | One-source-of-truth; `@theme inline` literal-inline gotcha governs runtime-swap |
| DESIGN.md ↔ `design-tokens/*.ts` | Drift test asserts hex ∈ DESIGN.md | Existing precedent: `trust-tier-tokens.test.ts` — extend for new tokens |
| `(dashboard)/layout.tsx` [Server] → `DashboardChrome` [Client] | Serializable role-flag props (`isAdmin`/`isAllocator`/`isManager`) | Auth lookup stays server-side; chrome is client (usePathname) |
| `Sidebar` → `MobileNav` | Shared `buildPrimaryMobileNav` (single nav SoT) | Two navs never drift — keep this DRY in IA work |
| Shell ↔ scenario composer | Serializable props down; FROZEN client island | Do not RSC-ify the composer; do not collapse factsheet split-contexts |
| Cross-tree flagged-count | `useSyncExternalStore` bridge (AllocationContext) | Already solves the provider-above-page boundary; don't break it in shell changes |

### External Services

| Service | Integration Pattern | Notes (v1.4 relevance) |
|---------|---------------------|------------------------|
| Supabase (Postgres/Auth/RLS) | Server-component `getUser()` + RLS-scoped queries | Untouched by v1.4 — but IA route moves must not break RLS-gated path assumptions |
| Vercel (frontend) / Railway (Python) | CI-gated continuous deploy; Supabase migrations auto-apply | v1.4 is presentation-only → expect **no migration**; Railway untouched |
| `next/font` (Google: DM Sans / Instrument Serif / Geist Mono) | Vars on `<html>` via root layout → `@theme inline --font-*` | Font *choices* are a DESIGN.md decision; the wiring is frozen |

---

## Sources

- Live codebase (HIGH): `src/app/globals.css` (`@theme` block + dark-override comments), `src/proxy.ts` (route gate + PUBLIC_ROUTES), `src/components/layout/{Sidebar,DashboardChrome}.tsx` (nav SoT + shell), `src/components/ui/{Button,Card}.tsx` (primitive shape), `src/app/factsheet/[id]/v2/factsheet-context.tsx` (split-context), `src/app/(dashboard)/layout.tsx` (RSC auth pattern), adoption counts (Button 68 / Card 48 / raw `<button>` 186 / truncate 103)
- Tailwind CSS v4 docs (HIGH): `@theme` namespaces (`--color-*`/`--text-*`/`--spacing-*`/`--radius-*`/`--font-*`), `clamp()` in token values, `@theme` vs `@theme inline` resolution — https://tailwindcss.com/docs/theme
- Next.js 16 local docs (HIGH): route groups are URL-invisible + multi-root-layout full-reload caveat (`node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route-groups.md`); redirect APIs + status codes (`.../02-guides/redirecting.md`); `proxy` is the renamed middleware (`.../16-proxy.md`, live `src/proxy.ts`)
- PROJECT.md + DESIGN.md + MEMORY.md (HIGH): frozen invariants (SCENARIO-05/BODY-02/no-invented-data/no-peer-rank), v1.3 primitives, the `@theme inline` token-drift history, share-link canary bugs (#512/#513), `/scenarios` IA-retirement precedent

---
*Architecture research for: presentation-layer overhaul (v1.4 Frontend Excellence) of the Quantalyze Next.js 16 app*
*Researched: 2026-06-28*
