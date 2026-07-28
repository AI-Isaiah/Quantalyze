# Phase 50: Primitive Refresh + Missing Primitives - Research

**Researched:** 2026-06-29
**Domain:** React 19 / Next 16 App Router component-primitive library — token refresh, Radix Tabs, a11y-correct Table/Field, dense-table reshape, View Transitions
**Confidence:** HIGH (verified against the actual codebase, the local Next-16 docs, npm registry, and Radix/Tailwind official docs)

## Summary

Phase 50 is a **toolkit phase on an already-laid token spine** (Phase 49). The bulk of the work is mechanically low-risk and CSS-only: re-point the 6 core primitives' internal Tailwind classes from `text-sm/text-xs/text-lg/text-base` to the Phase-49 fluid `--text-*` tier utilities, keeping every public prop API byte-identical so all consumers (the 68 Button importers, etc.) inherit the refresh with zero call-site edits [VERIFIED: read all 6 primitive sources]. The genuinely-new work is three primitives — **Tabs** (the only Radix-backed one, `@radix-ui/react-tabs@1.1.15`, the first runtime UI-widget dep), a semantic **Table** base, and a **Field** wrapper — plus the **StrategyTable dense reshape** and a small set of **View Transitions**.

The highest-value dedup is folding the 3 hand-rolled Tabs (`AdminTabs`/`ProfileTabs`/`WatchlistTabs`) onto the one Radix-backed primitive. This is also the **single biggest risk** in the phase, because the existing tests assert against the *current* DOM contract: `ProfileTabs.test.tsx` queries triggers via `getByRole("button", …)` (Radix triggers are `role="tab"`, not `button`), and `WatchlistTabs.test.tsx` pins `idBase`/`panelId`-derived element ids and `aria-controls` strings that the `StrategyTable` `role="tabpanel"` wiring depends on — Radix auto-generates its own ids. Porting these 1:1 without regressing the coverage ratchet (82/80/74/72, a blocking CI gate) and without breaking the `StrategyTable` ↔ WatchlistTabs panel wiring is the work that needs the most planning care.

**Primary recommendation:** Sequence the phase as (Wave 0) install + slop-gate Radix, write the new-primitive test contracts; (Wave 1) the CSS-only core refresh (independent, parallelizable) + build Tabs/Table/Field with their tests; (Wave 2) consolidate the 3 Tabs consumers 1:1 (tests ported in same PR), reshape StrategyTable, wire View Transitions, and migrate the one pilot surface (**`/admin/usage`** recommended — non-engine, admin-gated, table+button+input, axe-covered by `e2e/admin-csv-status-axe.spec.ts`-class specs). Use React's `<ViewTransition>` (Next 16, `experimental.viewTransition: true`) NOT the raw `startViewTransition` the UI-SPEC mentioned — see landmine #3.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **Adopt Radix for Tabs only** — `@radix-ui/react-tabs` v1.1.x backs the canonical Tabs primitive (no native HTML tab widget exists; UI-04). First runtime UI-widget dep; NOT on the banned-packages list. Scoped to no-native-equivalent widgets only.
- **Native retained everywhere it already fits** — `Modal` IS the Dialog primitive (native `<dialog>` + `showModal()`; do NOT swap to Radix Dialog); `Select` stays native `<select>`; disclosure stays native `<details>/<summary>` (`CollapsibleSection`). Radix is NOT pulled in for these.
- **Dense-table demonstrator = Discovery / `StrategyTable`** — the one table reshaped best-in-class this phase: sticky header + sticky first column, priority-collapse of low-priority columns to a reachable detail, a visible scroll cue, a working density control — on top of the existing `ResponsiveTable` wrapper. Phases 52/53 replicate the pattern.
- **Consolidate sprawl + 1 pilot** — add the canonical primitives AND fold the 3 hand-rolled Tabs (`AdminTabs`/`ProfileTabs`/`WatchlistTabs`) onto the one Tabs primitive (each ported in the same PR, tests ported — BP-03 held). Migrate ONE pilot surface off raw `<button>`/`<table>`/`<input>`. NOT a big-bang rewrite.

### Claude's Discretion
- **Token refresh is additive/CSS-only** — primitives migrate internal classes to the new `--text-*` utilities (+ existing `--color-*` / fixed space ladder); public prop API of each primitive unchanged so consumers inherit for free. No FactsheetBody / chart byte-identity surface touched.
- **Field primitive** wraps `<label>` + control + error + hint with the a11y wiring (`htmlFor`/`id`, `aria-describedby` for hint+error, `aria-invalid` on error) — the pattern the wizard/connect forms already hand-wire, consolidated.
- **Motion is minimal + reduced-motion-safe** — extend the existing `@media (prefers-reduced-motion: reduce)` blocks in `globals.css`; View Transitions opt-in on a small purposeful set (e.g. tab-panel / density toggle), never decorative; no `framer-motion`/`motion`/`@headlessui`.
- **Pilot surface** chosen at planning time as a low-risk surface that exercises button+table+input together (NOT engine-adjacent) so the strangler proof is clean.
- Exact primitive file layout, Tabs API shape, density-control mechanism, and View-Transition targets are at Claude's discretion within the above + ROADMAP success criteria.

### Deferred Ideas (OUT OF SCOPE)
- Broad per-surface raw-element → primitive migration (UI-03 at scale) — phases 52/53 strangler.
- Per-surface fluid-type realization (TYPE-02/03/04) — phase 52.
- Reshaping the remaining dense tables (allocations holdings, admin, compare) — 52/53, replicating the StrategyTable pattern proved here.
- Radix beyond Tabs — only if a concrete widget needs it; not speculative.
- Dark mode — out of scope (institutional light mode only).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| **UI-01** | Core primitives (Button, Card, Input, Badge, Modal, Skeleton) refreshed on new tokens; all existing consumers inherit | Exact per-primitive class→tier migration map (UI-SPEC §Typography + sources read). All CSS-only, public props frozen. `focus:`→`focus-visible:` ring migration on Button + Modal close. |
| **UI-02** | Missing primitives (Table, Tabs, Dialog, Select, Field, Breadcrumb) added & a11y-correct | Tabs=Radix (new); Table=semantic `<table>` wrapper (new); Field=label/aria wrapper (new). Dialog=existing Modal (keep), Select=existing (keep), Breadcrumb=existing (keep API). Verified each exists/absent. |
| **UI-03** | Raw-element sprawl migrated per-surface via strangler — no big-bang | ONE pilot surface. `/admin/usage` recommended (non-engine, table+button, admin-gated, axe-covered). Behavior-identical, tests ported. |
| **UI-04** | Radix only for no-native-equivalent widgets; native `<dialog>`/`<select>` retained | Radix Tabs only (verified v1.1.15, React-19 peer, no postinstall, 52M weekly downloads). Modal/Select stay native — confirmed in source. |
| **STATE-03** | Dense table reshape: sticky header + first column, priority collapse, scroll cue, density control | StrategyTable reshape contract pinned. `position:sticky` z-index stacking, opaque backgrounds, `@container` priority-collapse, `--row-h`/`--density-pad` tokens already in globals.css, honest no-invented-data degradation. |
| **STATE-04** | Restrained motion via native CSS transitions + View Transitions API only; reduced-motion honored | React `<ViewTransition>` (Next 16 `experimental.viewTransition`), tab-panel crossfade + density toggle only. `prefers-reduced-motion` extends existing 4 globals.css blocks. NO motion library. |
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Core primitive token refresh | Browser / Client (CSS) | — | Pure Tailwind class swap resolved at build; primitives are presentational. No server involvement. |
| Tabs primitive (Radix) | Browser / Client | — | Stateful widget — MUST be a `"use client"` boundary (Radix uses React context + hooks). |
| Table base primitive | Browser / Client OR Server | — | Semantic markup is tier-agnostic; can render in an RSC (`/admin/usage` is a server component) since it has no client state of its own. |
| Field primitive | Browser / Client OR Server | — | `useId()` runs in both; renders fine in RSC or client. Tier follows the consuming form. |
| StrategyTable dense reshape | Browser / Client | — | Already `"use client"` (sort/density/scroll state). Sticky/scroll-cue need DOM measurement (`scrollWidth>clientWidth`) → client only. |
| View Transitions | Browser / Client | — | `<ViewTransition>` + `startTransition`/`key` are client-runtime; degrade to instant swap without browser support or under reduced-motion. |
| Pilot surface migration | Server (RSC page) renders Client primitives | — | `/admin/usage` is `export const dynamic = "force-dynamic"` RSC; primitives it adopts are RSC-safe (Table/Field) or already-client (Button). |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@radix-ui/react-tabs` | **1.1.15** | WAI-ARIA Tabs primitive (roving tabindex, arrow/Home/End, `aria-selected`/`aria-controls` auto-wiring) | Industry-standard headless a11y primitive; the de-facto accessible Tabs implementation. The repo's locked choice (UI-04). [VERIFIED: npm registry — but see Package Legitimacy Audit; tagged from official Radix docs] |

### Supporting (ALREADY PRESENT — no install)
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `react` / `react-dom` | 19.2.7 | `<ViewTransition>` component, `useId`, `startTransition`, `forwardRef` | View Transitions, Field id generation, Tabs wrapper |
| `next` | 16.2.x | App Router, `experimental.viewTransition` flag | Enables React `<ViewTransition>` |
| `tailwindcss` / `@tailwindcss/postcss` | ^4 | `@theme` fluid `--text-*` spine (Phase 49), `@container` (built into v4 core — NO plugin) | Token refresh, priority-collapse container queries [CITED: tailwindcss.com/docs/responsive-design] |
| `vitest` / `@testing-library/react` | 4.x / 16.3.x | Unit tests (jsdom), coverage ratchet | Every primitive rewrite ports/keeps tests in same PR |
| `@axe-core/playwright` (e2e) | (installed) | WCAG-AA gate per-surface | The real a11y gate — `e2e/discovery-axe.spec.ts` etc. |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `@radix-ui/react-tabs` | Hand-rolled tabs (status quo) | Status quo is exactly the sprawl being consolidated; 3 inconsistent impls, each re-implementing roving tabindex. Radix is the locked decision. |
| React `<ViewTransition>` | Raw `document.startViewTransition()` | The UI-SPEC mentions `startViewTransition`, but in Next 16 App Router the idiomatic path is React's `<ViewTransition>` gated by `experimental.viewTransition: true` — it integrates with React's render lifecycle and degrades gracefully. Raw API works but you must manually coordinate with React's async rendering. **Use React's component.** (See landmine #3.) |
| `@tailwindcss/container-queries` plugin | — | NOT needed — container queries are core in Tailwind v4. [CITED: tailwindcss.com] |

**Installation:**
```bash
npm install @radix-ui/react-tabs@1.1.15
```
Then add to `next.config.ts`:
```ts
const nextConfig: NextConfig = { experimental: { viewTransition: true }, /* …existing… */ };
```

**Version verification (done this session):**
- `@radix-ui/react-tabs` latest = **1.1.15**, published 2026-06-15, `time.created` 2020-12-15, peerDeps include `react: ^19.0`, **no postinstall script**, ~52M weekly downloads, repo `github.com/radix-ui/primitives`. [VERIFIED: `npm view` + `api.npmjs.org/downloads`]

## Package Legitimacy Audit

> slopcheck was **not installable** in this session (`pip install slopcheck` unavailable). Per protocol, the lone external package is therefore tagged `[ASSUMED]` and the planner MUST gate its install behind a `checkpoint:human-verify` task. Manual registry verification was performed and is strongly corroborating.

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| `@radix-ui/react-tabs` | npm | first publish 2020-12-15 (~5.5 yrs); latest 1.1.15 @ 2026-06-15 | ~52.1M/wk | github.com/radix-ui/primitives | unavailable | **Approved with checkpoint** — manual signals all green (mature, massive adoption, official Radix monorepo, no postinstall, React-19 peer). Tag `[ASSUMED]` until human-verify. |

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none — but per protocol the planner inserts ONE `checkpoint:human-verify` before the `npm install` task because slopcheck could not run. The manual evidence (52M weekly downloads, 5.5-yr age, official `radix-ui/primitives` repo, no postinstall) makes this a formality, not a real risk.

**Postinstall check:** `npm view @radix-ui/react-tabs scripts.postinstall` → empty (no postinstall script). [VERIFIED]

## Architecture Patterns

### System Architecture Diagram

```
                        ┌─────────────────────────────────────────────────┐
                        │  Phase 49 token spine (FROZEN input)              │
                        │  globals.css @theme { --text-* fluid clamps }    │
                        │  + --color-* (@theme inline) + --row-h/--density │
                        └───────────────┬─────────────────────────────────┘
                                        │ consumed by (CSS class swap, no prop change)
                ┌───────────────────────┼───────────────────────────────────┐
                ▼                       ▼                                     ▼
   ┌────────────────────┐   ┌────────────────────────┐         ┌────────────────────────┐
   │ CORE REFRESH (UI-01)│   │ NEW PRIMITIVES (UI-02) │         │  MOTION (STATE-04)      │
   │ Button Card Input   │   │ Tabs  ── "use client" ─┼──uses──▶│ <ViewTransition> key=   │
   │ Badge Modal Skeleton│   │  └ @radix-ui/react-tabs│         │  (tab-panel crossfade)  │
   │ Select(native keep) │   │ Table (semantic <table>)│        │ density toggle (CSS)    │
   │  text-sm → text-body│   │ Field (label+aria wiring)│       │ reduced-motion fallback │
   │  focus:→focus-visible│  └───────────┬────────────┘         └────────────────────────┘
   └─────────┬──────────┘                │ ports 1:1 (tests ported, BP-03)
             │ inherited by              ▼
             │ 68 Button importers   ┌──────────────────────────────────────┐
             │ + all consumers       │ CONSOLIDATE (3 → 1)                   │
             │                       │ AdminTabs   (underline, useState)     │
             │                       │ ProfileTabs (underline, ?tab= URL)    │
             │                       │ WatchlistTabs(segmented, scope props) │
             │                       │   ⚠ preserves idBase/panelId →        │
             │                       │     StrategyTable role=tabpanel wiring│
             │                       └──────────────────────────────────────┘
             ▼
   ┌──────────────────────────────────────────────────────────────────────┐
   │ STRATEGYTABLE DENSE RESHAPE (STATE-03) — the 52/53 template            │
   │  builds ON ResponsiveTable (keep unique aria-label landmark)          │
   │  sticky <thead> z2 + sticky 1st col z1 (corner z3), opaque bg         │
   │  @container priority-collapse → reachable <details> (honest values)   │
   │  scroll cue (scrollWidth>clientWidth, aria-hidden)                    │
   │  density control → --row-h/--density-pad (existing tokens)           │
   └──────────────────────────────────────────────────────────────────────┘
             ▼
   ┌──────────────────────────────────────────────────────────────────────┐
   │ STRANGLER PILOT (UI-03) — ONE surface, recommend /admin/usage         │
   │  raw <button>/<table>/<input> → Button/Table/Field, behavior-identical│
   └──────────────────────────────────────────────────────────────────────┘
```

### Recommended Project Structure
```
src/components/ui/
├── Button.tsx        # REFRESH (class swap + focus-visible)
├── Card.tsx          # REFRESH (no token change needed; radius flagged for 52/53)
├── Input.tsx         # REFRESH (class swap)
├── Textarea.tsx      # REFRESH (mirror Input)
├── Select.tsx        # REFRESH (class swap; stays native)
├── Badge.tsx         # REFRESH (text-xs → text-caption)
├── Modal.tsx         # REFRESH (title tier + close focus-visible; stays native <dialog>)
├── Skeleton.tsx      # REFRESH (verify bg-border/60 token; reduced-motion already inherited)
├── Tabs.tsx          # NEW — "use client", thin styled wrapper over @radix-ui/react-tabs
├── Tabs.test.tsx     # NEW
├── Table.tsx         # NEW — semantic <table>/<thead>/<th scope> parts
├── Table.test.tsx    # NEW
├── Field.tsx         # NEW — label+control+hint+error aria wiring
├── Field.test.tsx    # NEW
└── (Button/Input/Badge/Modal/Skeleton/Select).test.tsx  # NEW — none exist today (see Pitfall 6)
```

### Pattern 1: CSS-only token refresh (UI-01) — public prop API frozen
**What:** Swap a primitive's internal Tailwind type classes for the fluid tier utilities; touch nothing in the props interface.
**When to use:** All 6 core primitives + Select/Textarea.
**Example (Button):**
```tsx
// BEFORE (src/components/ui/Button.tsx — read this session):
const sizeStyles = {
  sm: "px-3 py-1.5 text-xs",
  md: "min-h-[44px] px-4 py-2.5 text-sm",
  lg: "min-h-[44px] px-6 py-3 text-base",
};
// base: "...transition-colors focus:outline-none focus:ring-2 focus:ring-accent/50 disabled:opacity-50..."

// AFTER (token refresh + focus-visible migration — NO prop change):
const sizeStyles = {
  sm: "px-3 py-1.5 text-caption",
  md: "min-h-[44px] px-4 py-2.5 text-body",
  lg: "min-h-[44px] px-6 py-3 text-body",
};
// base: "...transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 disabled:opacity-50..."
```

### Pattern 2: Radix Tabs styled wrapper (UI-02/UI-04)
**What:** A `"use client"` module that re-exports Radix `Root/List/Trigger/Content` with DESIGN.md classes pre-applied via `data-state` selectors; exposes `variant: "underline" | "segmented"` so all 3 consumers map 1:1.
**When to use:** The one canonical Tabs primitive.
**Example:**
```tsx
// Source: radix-ui.com/primitives/docs/components/tabs (anatomy + data-state)
"use client";  // REQUIRED — Radix Tabs uses React context + hooks (landmine #1)
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { cn } from "@/lib/utils";

export const Tabs = TabsPrimitive.Root;          // passes value/defaultValue/onValueChange/activationMode through
export const TabsList = TabsPrimitive.List;
export function TabsTrigger({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      // data-[state=active] is Radix's styling hook (not aria-selected, which it manages for a11y)
      className={cn(
        "text-small font-medium px-4 py-2 border-b-2 border-transparent text-text-muted transition-colors",
        "hover:text-text-primary",
        "data-[state=active]:text-accent data-[state=active]:border-accent",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
        "data-[disabled]:opacity-50 data-[disabled]:pointer-events-none",
        className,
      )}
      {...props}
    />
  );
}
export const TabsContent = TabsPrimitive.Content;
```
- **Controlled passthrough:** `value` + `onValueChange` lets `ProfileTabs` keep its derive-each-render `?tab=` pattern (the IN-06 fix — preserve it). `AdminTabs` keeps local `useState` via `value`/`onValueChange`. `defaultValue` for uncontrolled.
- **`activationMode="automatic"`** (default) matches all 3 consumers (arrow also activates). [VERIFIED: WatchlistTabs.test.tsx asserts automatic activation explicitly.]

### Pattern 3: Sticky header + first column (STATE-03)
**What:** CSS `position: sticky` on `<thead> th` and the first-column cells, with a strict z-index stack and OPAQUE backgrounds.
**Example:**
```tsx
// thead cells: stay on top during vertical scroll
<th scope="col" className="sticky top-0 z-20 bg-surface ...">…</th>
// first-column cells: stay on left during horizontal scroll
<td className="sticky left-0 z-10 bg-surface border-r border-border ...">…</td>
// the CORNER (first th of first col) must out-rank both — z-30
<th scope="col" className="sticky top-0 left-0 z-30 bg-surface ...">…</th>
```
Backgrounds MUST be opaque (`bg-surface`, never transparent) or horizontally-scrolled cells bleed through the sticky column. The `bg-page/50` row hover must NOT be applied to the sticky first column (it would expose the row colour gap on scroll) — keep the sticky col's bg solid `bg-surface`.

### Pattern 4: Priority collapse via container queries (STATE-03)
**What:** Wrap the table region in `@container`; hide low-priority columns below a container width and relocate their REAL values into a per-row `<details>` disclosure.
```tsx
<div className="@container overflow-x-auto"> {/* the containment context */}
  <table>
    {/* always visible: Strategy > Return% > CAGR > Sharpe > Max DD */}
    <td className="@max-3xl:hidden">{volatilityCell}</td> {/* collapses first */}
    {/* collapsed values relocate (same real value, never fabricated) into row <details> */}
  </table>
</div>
```
**Honest degradation (no-invented-data, STATE-02):** the collapsed `<details>` shows the SAME real cell value relocated. If a value is genuinely null it renders the existing honest-null treatment, NEVER `0`/`—`/demo numbers.

### Pattern 5: View Transition crossfade for tab-panel + density (STATE-04)
**What:** React `<ViewTransition>` (Next 16) crossfades the tab panel on `value` change and the table on density change.
```tsx
// Source: node_modules/next/dist/docs/01-app/02-guides/view-transitions.md (Step 4 crossfade)
import { ViewTransition, startTransition } from "react";
// <ViewTransition> animates only inside a Transition/Suspense/useDeferredValue — NOT a plain setState.
function onDensityChange(next: Density) {
  startTransition(() => setDensity(next));  // wrap the state update so the VT activates
}
// panel crossfade keyed on active tab:
<ViewTransition key={activeTab} name="tab-panel" share="auto" enter="auto" default="none">
  {panelContent}
</ViewTransition>
```
Reduced-motion: the global `@media (prefers-reduced-motion: reduce) { ::view-transition-old(*),::view-transition-new(*) { animation-duration:0s !important } }` block (from the Next docs) makes every VT an instant swap.

### Pattern 6: Field a11y wiring (UI-02)
```tsx
// label↔control via htmlFor/id; aria-describedby joins hint+error ids; aria-invalid on error
const generatedId = useId();
const id = providedId ?? generatedId;
const hintId = hint ? `${id}-hint` : undefined;
const errorId = error ? `${id}-error` : undefined;
const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;
// pass id, aria-invalid={!!error || undefined}, aria-describedby={describedBy} to the control (clone or render-prop)
```

### Anti-Patterns to Avoid
- **Changing a primitive's public prop API during the refresh** — breaks the "consumers inherit for free" contract. The refresh is CSS-only. (Card radius `rounded-xl` vs DESIGN.md 8px is explicitly **deferred to 52/53** — do NOT change it here; it's a visible restyle.)
- **Swapping native `<dialog>` Modal or native `<select>` for Radix** — explicit UI-04 violation. They stay native.
- **Transparent backgrounds on sticky cells** — content bleed-through on scroll.
- **Triggering View Transitions with a bare `setState`** — `<ViewTransition>` only activates inside a transition; a plain setState does nothing. Wrap in `startTransition` or key on a route/Suspense.
- **Letting Radix auto-generate the WatchlistTabs panel ids** — `StrategyTable` reads `panelId`/`idBase` to wire its `role="tabpanel"` + `aria-labelledby`. The segmented port must keep those ids stable (pass them through, or keep the imperative id contract). See Pitfall 1.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Tab roving-tabindex / arrow-key / Home-End / aria-selected wiring | Custom keydown handlers (the current 3 impls) | `@radix-ui/react-tabs` | This is precisely the inconsistent sprawl being deleted; Radix is the audited WAI-ARIA implementation. |
| Tab-panel / density crossfade | A motion library, manual mount/unmount animation | React `<ViewTransition>` (native) | Library banned (`framer-motion`/`motion`/`@headlessui`); the browser View Transitions API is the locked mechanism. |
| Priority-collapse breakpoints | JS `window.innerWidth` listeners | Tailwind v4 `@container` (core) | Container queries respond to the table's own width (correct tool per TYPE-04), need no JS, and are SSR-safe. |
| Density row-height tokens | New CSS vars | Existing `--row-h` / `--density-pad` / `data-density` in globals.css | Already defined (44/36/52px) and read by KpiStrip/HoldingsTable — reuse, don't duplicate. |
| Reduced-motion skeleton freeze | New `@media` block | The existing `.animate-pulse` block (globals.css:152) | Skeleton inherits it; duplicating is a divergence risk. |
| Horizontal-scroll affordance region/aria-label | New wrapper | Existing `ResponsiveTable` | Keep its unique-`aria-label` landmark contract intact (the /allocations multi-table page depends on it). |

**Key insight:** Almost nothing genuinely new needs building. Tabs is a thin Radix wrapper; density/motion/scroll infrastructure already exists in globals.css and `ResponsiveTable`. The risk is in *consolidation fidelity*, not net-new construction.

## Common Pitfalls

### Pitfall 1: WatchlistTabs ↔ StrategyTable panel-id wiring breaks on Radix port
**What goes wrong:** `WatchlistTabs` receives `idBase` + `panelId` props and builds `id={`${idBase}-tab-all`}` + `aria-controls={panelId}`; `StrategyTable` renders the panel as `<div id={panelId} role="tabpanel" aria-labelledby={`${tabIdBase}-tab-${scope}`}>`. Radix Tabs **auto-generates its own ids** for triggers/content and wires `aria-controls`/`aria-labelledby` internally between `Tabs.Trigger`↔`Tabs.Content`. If WatchlistTabs is naively swapped to Radix, the StrategyTable panel (which is NOT a `Tabs.Content` — it lives in a sibling component) loses its `aria-labelledby` target and `aria-controls` linkage.
**Why it happens:** The WatchlistTabs panel is rendered OUTSIDE the tablist component, in `StrategyTable`, deliberately decoupled. Radix expects `Tabs.Content` to be a descendant of `Tabs.Root`.
**How to avoid:** Two viable options — (a) keep WatchlistTabs's **segmented** variant as the styled wrapper but preserve the imperative `idBase`/`panelId` id contract (a `Tabs` variant that accepts explicit `id`s via `asChild` or passthrough, so the external panel's `aria-labelledby` still resolves); or (b) lift the panel into a `Tabs.Content` inside the tablist's `Tabs.Root` (larger refactor, touches StrategyTable's `role="tabpanel"` block). **Recommend (a)** — lower blast radius, preserves `StrategyTable.test.tsx` panel-wiring assertions. Either way: the ported `WatchlistTabs.test.tsx` lines asserting `allTab.id === "abc123-tab-all"` and `aria-controls === panelId` MUST still pass.
**Warning signs:** axe `aria-valid-attr-value`/`aria-required-children` on /discovery; `StrategyTable.test.tsx` tabpanel assertions fail.

### Pitfall 2: Ported tests query `getByRole("button")` — Radix triggers are `role="tab"`
**What goes wrong:** `ProfileTabs.test.tsx` selects tab triggers via `screen.getByRole("button", { name: "Security" })`. Radix `Tabs.Trigger` renders `role="tab"`, so these queries throw "no button with that name".
**Why it happens:** The hand-rolled ProfileTabs uses bare `<button>` (implicit role button). Radix is semantically correct (`role="tab"`).
**How to avoid:** When porting, update the test queries `getByRole("button"…)` → `getByRole("tab"…)`. AdminTabs.test uses `getByText("Strategy Review")` clicks (those survive). This is a mechanical but mandatory test-port edit — flag it so the executor doesn't mistake the failure for a behavior regression.
**Warning signs:** Ported ProfileTabs tests fail with TestingLibraryElementError on role lookup.

### Pitfall 3: View Transitions — wrong API + SSR/flag/browser caveats
**What goes wrong:** (a) Using raw `document.startViewTransition()` as the UI-SPEC text suggested, instead of React's `<ViewTransition>`; (b) forgetting `experimental.viewTransition: true` in `next.config.ts` (the flag that exposes React's component in App Router); (c) expecting a plain `setState` to trigger the animation (it does not — `<ViewTransition>` activates only inside a Transition/Suspense/useDeferredValue).
**Why it happens:** Training-era guidance pushes the raw browser API; Next 16's integration is newer.
**How to avoid:** Enable the flag, import `{ ViewTransition }` from `react`, key the panel on the active tab, wrap density `setState` in `startTransition`. `<ViewTransition>` degrades to an instant swap where the browser lacks View Transitions support and under reduced-motion — no special handling needed beyond the global reduced-motion CSS. [CITED: node_modules/next/dist/docs/01-app/02-guides/view-transitions.md — Step 4 crossfade + reduced-motion block]
**Warning signs:** No animation at all (flag missing / bare setState); console "ViewTransition is not exported" (flag missing).

### Pitfall 4: `focus:` → `focus-visible:` regression on keyboard-only states
**What goes wrong:** Migrating Button/Modal-close from `focus:ring` to `focus-visible:ring` removes the ring on *mouse* click (intended) but, if a consumer relied on the mouse-click ring as a visual "pressed" cue, that cue disappears. More importantly, any element that should still show a ring on programmatic focus (e.g. focus moved by JS) must keep it — `focus-visible` heuristics fire on keyboard/programmatic focus, so this is generally safe, but verify the AA focus-indicator (≥3:1, WCAG 2.4.7/1.4.11) is still present for keyboard users.
**Why it happens:** `:focus` fires on any focus (incl. mouse); `:focus-visible` only when the UA heuristic says focus should be "visible" (keyboard).
**How to avoid:** Apply `focus-visible:` consistently; KEEP the Input/Select/Textarea soft `focus:ring-accent/20` border-glow as-is (the UI-SPEC keeps `focus:` there — fields legitimately show focus on click). Only Button + Modal-close migrate to `focus-visible:`. Verify with the axe + a keyboard-tab manual pass.
**Warning signs:** axe is happy (it can't catch this) — needs the manual keyboard sweep + visual check.

### Pitfall 5: Sticky first column + row-hover background interaction
**What goes wrong:** Row hover `hover:bg-page/50` applied to the whole `<tr>` including the sticky first column makes the first column's background semi-transparent on hover → scrolled cells bleed through during horizontal scroll.
**Why it happens:** Sticky cells must paint over scrolled-under content; a translucent hover defeats that.
**How to avoid:** Either keep the sticky first column at solid `bg-surface` (override the row hover on that cell) or use an opaque hover token. The corner header cell needs the highest z (z-30) AND solid bg.
**Warning signs:** Ghosting/double-text in the first column while scrolling right.

### Pitfall 6: NO existing tests for the 6 core primitives — coverage ratchet exposure
**What goes wrong:** `src/components/ui/` has tests for CardShell/CollapsibleSection/Tooltip/VerifiedBadge/Disclaimer/ScopedBanner — but **none** for Button, Card, Input, Badge, Modal, Skeleton, Select. [VERIFIED: `ls src/components/ui/*.test.tsx`]. The refresh edits these files; if it adds branches/lines without tests, the 82/80/74/72 ratchet (a blocking CI gate) can dip.
**Why it happens:** The primitives were written pre-ratchet; coverage rode on consumer tests.
**How to avoid:** The refresh is CSS-only (no new branches), so coverage is unlikely to drop FROM the refresh itself — but the NEW primitives (Tabs/Table/Field) add substantial new lines/branches/functions and MUST ship with their own `.test.tsx` in the same PR (BP-03). Strongly consider adding minimal Button/Modal `.test.tsx` to lock the `focus-visible` + variant contract, since those are the two with behavior-adjacent edits. Run `npm run test:coverage` locally before the PR — the gate is the full non-sharded suite with `--coverage`.
**Warning signs:** `frontend-coverage` CI job fails on functions/branches (the two tightest metrics: actual 77.4/75.5 vs gate 74/72).

### Pitfall 7: Radix Tabs forces a `"use client"` boundary
**What goes wrong:** The Tabs wrapper module is imported into a server component without `"use client"` → "you're importing a component that needs useState/useContext … mark it with use client".
**Why it happens:** Radix Tabs uses React context + hooks internally.
**How to avoid:** Put `"use client"` at the top of `src/components/ui/Tabs.tsx`. All 3 current consumers are ALREADY `"use client"`, so no consumer regresses. [VERIFIED: all 3 tab sources start with `"use client"`.]
**Warning signs:** Next build error on the first RSC that imports Tabs.

## Runtime State Inventory

> This is a code/CSS-only phase (component refactor + new components). No stored data, live-service config, OS-registered state, secrets, or build artifacts carry phase-specific state. The consolidation is a rename/dedup of in-repo components only.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | **None** — no database/datastore stores a primitive name, tab key, or component id. The `?tab=` values (`personal`/`mandate`/…) are URL query params, not stored keys; ProfileTabs already coerces unknown values to `personal`. | none |
| Live service config | **None** — no external service (n8n, Datadog, Tailscale, Cloudflare) references a component name. | none |
| OS-registered state | **None** — no Task Scheduler / pm2 / systemd registration embeds a primitive name. | none |
| Secrets/env vars | **None** — no secret/env var name references a primitive. `next.config.ts` gains `experimental.viewTransition` (a build flag, not a secret). | none |
| Build artifacts | **`@radix-ui/react-tabs` is a new dependency** → `package.json` + `package-lock.json` change; `node_modules` gains the package on `npm install`. No stale egg-info/binary class of artifact. | `npm install` (gated behind checkpoint:human-verify per Package Legitimacy Audit) |

**The canonical question — after every file is updated, what runtime systems still cache the old strings?** Answer: none. The `?tab=` URL contract is preserved verbatim (ProfileTabs keeps `?tab=security` etc.), share/deep links don't change, and no persisted state keys are touched. Shared links remain valid.

## Code Examples

### Migration map (exact — what each raw class becomes) [CITED: 50-UI-SPEC.md §Typography + VERIFIED against sources]
| Primitive | Current raw class (in source) | Refreshed tier utility |
|-----------|-------------------------------|------------------------|
| Button md/lg | `text-sm` / `text-base` | `text-body` |
| Button sm | `text-xs` | `text-caption` |
| Input/Select/Textarea control | `text-sm` | `text-body` |
| Input/Select/Textarea `<label>` | `text-sm font-medium` | `text-small font-medium` |
| Input/Select/Textarea error | `text-xs` | `text-caption` |
| Badge | `text-xs` | `text-caption` (+ `text-micro uppercase tracking-wider` micro variant) |
| Modal title | `text-lg font-semibold` | `text-h3 font-semibold` |
| StrategyTable cells | `text-sm` | `text-body`; numeric cells KEEP `font-metric` + `tabular-nums` |

### Density control wiring (reuse existing tokens)
```tsx
// existing in globals.css (read this session): :root{--row-h:44px;--density-pad:16px} body[data-density="tight"]{--row-h:36px;--density-pad:12px}
// the control sets data-density on a scoped root (or body) and the table rows read the vars:
<tr style={{ height: "var(--row-h)" }} className="[&>td]:py-[var(--density-pad)] ...">
// segmented control: "Comfortable" (default) / "Compact" (tight), active option = accent text, accessible name "Table density"
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Per-component hand-rolled tab keydown handlers | Radix headless Tabs primitive | this phase | One audited a11y impl, 3 → 1 |
| `document.startViewTransition()` raw API | React `<ViewTransition>` component (Next 16 `experimental.viewTransition`) | Next 16 / React 19.2 | Declarative, lifecycle-integrated, graceful degradation; activates on Transitions not bare setState |
| `@tailwindcss/container-queries` plugin | `@container` built into Tailwind v4 core | Tailwind v4 | No plugin install; `@container` + `@max-md:` variants native [CITED: tailwindcss.com] |
| `:focus` ring (fires on mouse too) | `:focus-visible` ring (keyboard/programmatic only) | — | Cleaner mouse UX; verify AA keyboard indicator stays |

**Deprecated/outdated:**
- Training-era "use `startViewTransition` directly in React" — superseded by `<ViewTransition>` in Next 16 App Router. Use the component.
- "container queries need a plugin" — false in Tailwind v4.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `@radix-ui/react-tabs@1.1.15` is legitimate (slopcheck unavailable; manual signals all green) | Package Legitimacy Audit | LOW — 52M weekly downloads + 5.5-yr age + official repo + no postinstall. Planner gates install behind checkpoint:human-verify regardless. |
| A2 | Recommended pilot surface = `/admin/usage` | Strangler Pilot | LOW — final pilot pick is explicitly Claude's discretion at planning time; this is a recommendation, not a lock. Any non-engine surface with button+table+input qualifies. |
| A3 | Card radius stays `rounded-xl` (no change) this phase | Card primitive | NONE — explicitly deferred to 52/53 by the UI-SPEC; changing it would be the risk. |
| A4 | The View-Transition crossfade can key on the Radix `value` without restructuring panels | Pattern 5 | MEDIUM — needs a small spike during planning; falls back cleanly to instant swap if the keyed crossfade is awkward. Density-toggle VT is independently optional. |

## Open Questions

1. **WatchlistTabs segmented port — keep imperative ids vs lift panel into `Tabs.Content`?**
   - What we know: StrategyTable depends on `idBase`/`panelId` for its external `role="tabpanel"`; Radix auto-ids its own Content.
   - What's unclear: whether the styled segmented `Tabs` variant can expose explicit trigger ids cleanly enough to preserve the external panel's `aria-labelledby`.
   - Recommendation: Plan option (a) (preserve imperative id contract via the segmented variant); treat the panel-lift as a fallback only if (a) proves awkward. Pin `StrategyTable.test.tsx` tabpanel + `WatchlistTabs.test.tsx` id/aria-controls assertions as the acceptance gate.

2. **Does the StrategyTable reshape need its own density root, or reuse `body[data-density]`?**
   - What we know: `body[data-density]` is global and already drives the allocator dashboard; the StrategyTable is on a public surface where a global density flip might be surprising.
   - Recommendation: Scope the density to a `data-density` attribute on the StrategyTable's own root (read the same `--row-h`/`--density-pad` tokens via a scoped rule) so the discovery density control doesn't change allocator-dashboard density. Confirm at planning.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `@radix-ui/react-tabs` | Tabs primitive (UI-02/04) | ✗ (to install) | target 1.1.15 | none — locked dep; install gated by checkpoint |
| React `<ViewTransition>` | Motion (STATE-04) | ✓ (react 19.2.7) | 19.2.7 | instant swap (built-in degradation) |
| Tailwind v4 `@container` | Priority collapse (STATE-03) | ✓ (core) | ^4 | media queries (worse fit) |
| `next.config` `experimental.viewTransition` | Enables `<ViewTransition>` | ✗ (to enable) | — | none — one-line flag |
| vitest / RTL / jsdom | Unit tests + ratchet | ✓ | 4.x / 16.3.x | — |
| `@axe-core/playwright` e2e specs | WCAG-AA gate | ✓ | installed (e2e/*-axe.spec.ts) | — |

**Missing dependencies with no fallback:** `@radix-ui/react-tabs` (install step required; gated by checkpoint:human-verify). `experimental.viewTransition` flag (one-line config edit).
**Missing dependencies with fallback:** none.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.x (jsdom env) + @testing-library/react 16.3.x; Playwright + @axe-core/playwright for e2e a11y |
| Config file | `vitest.config.ts` (maxWorkers = cpus-1 for CI-flake mitigation; setupFiles `src/test-setup.ts`) |
| Quick run command | `npx vitest run src/components/ui/ src/components/admin/AdminTabs.test.tsx src/components/auth/ProfileTabs.test.tsx src/components/strategy/WatchlistTabs.test.tsx src/components/strategy/StrategyTable.test.tsx` |
| Full suite command | `npm run test:coverage` (full non-sharded with --coverage — the gate CI enforces) |
| e2e a11y command | `npx playwright test e2e/discovery-axe.spec.ts` (+ axe-app-wide for the consolidated tabs surfaces) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command / Assertion | File Exists? |
|--------|----------|-----------|-------------------------------|-------------|
| UI-01 | Button md = `text-body`, sm = `text-caption`; ring is `focus-visible:` not `focus:` | unit (grep/className) | `expect(btn.className).toMatch(/text-body/)` + `/focus-visible:ring/`; assert NO bare `focus:ring` | ❌ Wave 0 (Button.test.tsx new) |
| UI-01 | Public prop API unchanged (variant/size still accepted, no new required prop) | unit | render each variant×size, assert renders | ❌ Wave 0 |
| UI-01 | Modal title = `text-h3`, close button has `focus-visible:ring` | unit | query `h2`, assert class; query close, assert focus-visible ring | ❌ Wave 0 (Modal.test.tsx new) |
| UI-02 | Tabs: trigger `role="tab"`, panel `role="tabpanel"`, only active `aria-selected=true`, arrow/Home/End move focus | unit (RTL) + axe-e2e | RTL role/aria assertions; `npx playwright test e2e/axe-app-wide.spec.ts` zero violations | ❌ Wave 0 (Tabs.test.tsx new) |
| UI-02 | Table: `<th scope="col">`, sticky `scope="row"` first col, named (caption/aria-label), preserves ResponsiveTable unique landmark | unit + axe-e2e | RTL `getByRole("columnheader")` scope assert; axe `landmark-unique` green on /discovery | ❌ Wave 0 (Table.test.tsx new) |
| UI-02 | Field: label↔control `htmlFor`/`id`, `aria-describedby` joins hint+error, `aria-invalid` on error | unit | RTL: `getByLabelText`, assert `aria-describedby` contains both ids, `aria-invalid="true"` when error | ❌ Wave 0 (Field.test.tsx new) |
| UI-04 | Modal still native `<dialog>`; Select still native `<select>`; no Radix Dialog/Select import | visual-grep | assert no `@radix-ui/react-dialog`/`-select` in package.json or imports; `Modal` renders `dialog` element | partial (add grep guard) |
| UI-03 | Pilot surface (`/admin/usage`): raw `<button>/<table>/<input>` replaced by primitives, behavior-identical | unit + axe-e2e | port existing page test (if any) / add render test; `npx playwright test e2e/admin-csv-status-axe.spec.ts`-class on the migrated surface | ❌ Wave 0 (verify/port) |
| STATE-03 | Sticky header/first-col present; priority columns collapse; collapsed values are REAL (no fabricated 0/—); density control toggles `--row-h` | unit + axe-e2e | RTL: assert sticky classes; assert collapsed `<details>` renders the same value as the visible cell (no `0`/`—` injected); `e2e/discovery-axe.spec.ts` zero violations | ✅ StrategyTable.test.tsx (extend) |
| STATE-03 | WatchlistTabs panel wiring intact post-port (idBase/panelId/aria-controls) | unit | ported WatchlistTabs.test.tsx + StrategyTable.test.tsx tabpanel assertions pass | ✅ (port + keep) |
| STATE-04 | Reduced-motion disables VT animation; VT degrades to instant swap without support | unit + manual | unit: assert `startTransition`-wrapped density change; **manual**: macOS reduce-motion + a non-VT browser → instant swap | partial (manual) |
| BP-03 | Coverage ratchet 82/80/74/72 held; new primitives ship with tests in same PR | gate | `npm run test:coverage` → all 4 metrics ≥ gate | n/a (CI gate) |

### Sampling Rate
- **Per task commit:** the quick run command above (the touched primitive + tab specs).
- **Per wave merge:** `npm run test:coverage` (full + coverage) + the relevant `e2e/*-axe.spec.ts`.
- **Phase gate:** full suite green + `e2e/discovery-axe.spec.ts` + `e2e/axe-app-wide.spec.ts` zero violations before `/gsd:verify-work`. Plus manual: keyboard-tab focus-visible sweep on Button/Tabs; macOS reduce-motion VT check; real 400%-zoom on the reshaped table (Compact must not clip — fluid type + density independent).

### Wave 0 Gaps
- [ ] `src/components/ui/Tabs.test.tsx` — covers UI-02 (role/aria/keyboard) — NEW
- [ ] `src/components/ui/Table.test.tsx` — covers UI-02 (scope/caption/landmark) — NEW
- [ ] `src/components/ui/Field.test.tsx` — covers UI-02 (htmlFor/aria-describedby/aria-invalid) — NEW
- [ ] `src/components/ui/Button.test.tsx` — covers UI-01 (token classes + focus-visible) — NEW (none today)
- [ ] `src/components/ui/Modal.test.tsx` — covers UI-01 (title tier + close focus-visible) — NEW (none today)
- [ ] Port `ProfileTabs.test.tsx` `getByRole("button")` → `getByRole("tab")` (Pitfall 2) — EDIT existing
- [ ] Port `WatchlistTabs.test.tsx` to the segmented `Tabs` variant, preserving id/aria-controls assertions (Pitfall 1) — EDIT existing
- [ ] Extend `StrategyTable.test.tsx` with sticky/collapse-honest-value/density assertions — EDIT existing
- [ ] Framework install: none — vitest + playwright + axe already configured.

## Security Domain

> `security_enforcement` is not disabled in config — included. This is a presentation-layer phase with no auth/session/crypto/data-flow changes; the only input surface is form fields (Field primitive) and the pilot surface migration.

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | Untouched — pilot `/admin/usage` keeps its existing `isAdminUser` redirect gate (verified in source); migration is presentational only. |
| V3 Session Management | no | No session/cookie changes. `?tab=` is a UI query param, already coerced/validated by ProfileTabs `parseTabParam`. |
| V4 Access Control | no (preserve) | Do NOT alter the `/admin/usage` admin gate or ProfileTabs allocator-only tab gating during migration — both are existing access controls the refactor must keep byte-faithful. |
| V5 Input Validation | yes (low) | Field primitive renders `aria-invalid`/error but does not VALIDATE — validation stays in the consuming form. No new input parsing introduced. CSP `style-src 'unsafe-inline'` already present (Tailwind/inline styles for `--row-h`). |
| V6 Cryptography | no | None. |

### Known Threat Patterns for React/Next presentation layer
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Radix as a new dependency (supply-chain) | Tampering | Package Legitimacy Audit + checkpoint:human-verify install; no postinstall; pin exact version 1.1.15. |
| `dangerouslySetInnerHTML` via View Transitions / table cells | Tampering | None used — all cell values are React-escaped; collapsed `<details>` relocates the same escaped values. Do not introduce `innerHTML`. |
| Access-control regression during pilot migration | Elevation of Privilege | Keep the `/admin/usage` `isAdminUser` redirect and ProfileTabs `allocatorOnly` gating unchanged; behavior-identical migration (UI-03). |
| CSP breakage from inline density vars | DoS (self) | `style-src 'unsafe-inline'` already in `next.config.ts` headers — inline `style={{height:"var(--row-h)"}}` is covered. No CSP change needed. |

## Sources

### Primary (HIGH confidence)
- `node_modules/next/dist/docs/01-app/02-guides/view-transitions.md` — React `<ViewTransition>`, `experimental.viewTransition` flag, Step-4 crossfade, reduced-motion CSS block. [the local authoritative Next-16 reference per AGENTS.md]
- `node_modules/next/dist/docs/01-app/02-guides/upgrading/version-16.md` — confirms `<ViewTransition>` as a Next-16/React-19 feature.
- Codebase sources read this session: Button/Card/Input/Badge/Modal/Select/Skeleton.tsx, ResponsiveTable.tsx, AdminTabs/ProfileTabs/WatchlistTabs.tsx (+ tests), StrategyTable.tsx, globals.css (density + reduced-motion + fluid `--text-*`), vitest.config.ts, next.config.ts.
- `npm view @radix-ui/react-tabs` (version 1.1.15, peerDeps, time, scripts.postinstall) + `api.npmjs.org/downloads` (52M/wk). [VERIFIED]
- radix-ui.com/primitives/docs/components/tabs — anatomy, Root props (value/defaultValue/onValueChange/activationMode/orientation), `data-state`/`data-disabled` styling hooks, keyboard interactions. [CITED]
- tailwindcss.com/docs/responsive-design — `@container` is core in Tailwind v4 (no plugin). [CITED]

### Secondary (MEDIUM confidence)
- 50-UI-SPEC.md + 50-CONTEXT.md (the approved design contract + locked decisions — authoritative for THIS phase's intent, treated as locked inputs).

### Tertiary (LOW confidence)
- slopcheck verdict: UNAVAILABLE this session — Radix tagged `[ASSUMED]`, gated by checkpoint (the only LOW item; manual signals strongly corroborate legitimacy).

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — Radix version/peer/legitimacy verified via npm; Tailwind `@container` and View Transitions verified via official + local docs.
- Architecture: HIGH — all relevant sources read directly; tier ownership unambiguous (presentation layer).
- Pitfalls: HIGH — derived from reading the actual test files and primitive sources (ProfileTabs `getByRole("button")`, WatchlistTabs id-contract, no core-primitive tests, sticky z-index) — these are concrete, not hypothetical.
- Motion API: HIGH — local Next-16 docs are explicit on `<ViewTransition>` + flag + reduced-motion.

**Research date:** 2026-06-29
**Valid until:** 2026-07-29 (stable; Radix/Next/Tailwind are slow-moving for these APIs). Re-verify Radix version if planning slips past a month (it ships frequently).
