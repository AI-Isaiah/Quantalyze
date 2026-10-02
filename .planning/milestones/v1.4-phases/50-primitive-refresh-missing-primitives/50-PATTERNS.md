# Phase 50: Primitive Refresh + Missing Primitives - Pattern Map

**Mapped:** 2026-06-29
**Files analyzed:** 23 (8 refresh + 3 new primitives + 1 new-primitive-set tests + 3 tab consumers + 1 dense reshape + 1 pilot + config + globals.css + ported/new tests)
**Analogs found:** 22 / 23 (the only greenfield surface — `@container`/sticky-table-header CSS — has no in-repo analog and is flagged below)

> **Read-only pattern map.** This phase is CSS-only refresh + 3 new primitives + 1
> dense reshape + 1 pilot migration. Almost every file's best analog is *its own
> current source* (the refresh is in-place, public props frozen) or a sibling
> primitive. The genuinely-new construction (Tabs/Table/Field) copies a small,
> concrete set of in-repo conventions documented below. **Net-new CSS** —
> `@container` priority-collapse and `position: sticky` table header/first-column —
> has **zero in-repo precedent** (verified) and must come from RESEARCH.md patterns
> 3 & 4, not a codebase analog.

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/components/ui/Button.tsx` | component (primitive) | render | self (in-place refresh) | exact (self) |
| `src/components/ui/Card.tsx` | component (primitive) | render | self (no token change; radius deferred) | exact (self) |
| `src/components/ui/Input.tsx` | component (primitive) | render | self + `Textarea`/`Select` (3 share label/error/forwardRef shape) | exact (self) |
| `src/components/ui/Textarea.tsx` | component (primitive) | render | self + `Input.tsx` (mirror) | exact (self) |
| `src/components/ui/Select.tsx` | component (primitive) | render | self + `Input.tsx` (mirror, stays native) | exact (self) |
| `src/components/ui/Badge.tsx` | component (primitive) | render | self (color maps frozen) | exact (self) |
| `src/components/ui/Modal.tsx` | component (primitive) | render-response | self (native `<dialog>`, stays native) | exact (self) |
| `src/components/ui/Skeleton.tsx` | component (primitive) | render | self (verify `bg-border/60`; reduced-motion inherited) | exact (self) |
| `src/components/ui/Tabs.tsx` | component (primitive, NEW) | event-driven (state) | 3 hand-rolled tabs (contract) + Radix anatomy (RESEARCH P2) | role-match (Radix is net-new) |
| `src/components/ui/Tabs.test.tsx` | test (NEW) | — | `WatchlistTabs.test.tsx` (role/aria/keyboard) + `CardShell.test.tsx` (RTL render) | exact |
| `src/components/ui/Table.tsx` | component (primitive, NEW) | render | `ResponsiveTable.tsx` (landmark) + `admin/usage/page.tsx` (`<th scope>` markup) | role-match |
| `src/components/ui/Table.test.tsx` | test (NEW) | — | `CardShell.test.tsx` (region/role RTL) | exact |
| `src/components/ui/Field.tsx` | component (primitive, NEW) | render | `Input.tsx` (forwardRef+useId) + `CsvUploadStep.tsx` L358-397 (hand-wired label/aria-invalid/error) | exact |
| `src/components/ui/Field.test.tsx` | test (NEW) | — | `CardShell.test.tsx` + RTL `getByLabelText` | exact |
| `src/components/ui/Button.test.tsx` | test (NEW) | — | `CardShell.test.tsx` (className/variant assertions) | exact |
| `src/components/ui/Modal.test.tsx` | test (NEW) | — | `AdminTabs.test.tsx` L33-46 (`HTMLDialogElement` showModal stub) + `CardShell.test.tsx` | exact |
| `src/components/admin/AdminTabs.tsx` | component (consolidate) | event-driven (local useState) | self → `Tabs.tsx` (underline variant) | exact (self) |
| `src/components/auth/ProfileTabs.tsx` | component (consolidate) | event-driven (`?tab=` URL) | self → `Tabs.tsx` (underline, controlled) | exact (self) |
| `src/components/strategy/WatchlistTabs.tsx` | component (consolidate) | event-driven (scope props) | self → `Tabs.tsx` (segmented; **preserve idBase/panelId**) | exact (self) |
| `src/components/auth/ProfileTabs.test.tsx` | test (port) | — | self (edit `getByRole("button")` → `getByRole("tab")`) | exact (self) |
| `src/components/strategy/WatchlistTabs.test.tsx` | test (port) | — | self (preserve id/aria-controls/roving-tabindex assertions) | exact (self) |
| `src/components/strategy/StrategyTable.tsx` | component (dense reshape) | render + sort/density state | self + `ResponsiveTable.tsx` + RESEARCH P3/P4 (sticky/@container — greenfield CSS) | partial (CSS greenfield) |
| `src/app/(dashboard)/admin/usage/page.tsx` | route (RSC, pilot) | request-response (RSC) | self (raw `<table>`/`<th>`) → `Table`/`Field`/`Button` primitives | exact (self) |
| `next.config.ts` | config | — | self (add `experimental.viewTransition`; CSP already covers inline vars) | exact (self) |
| `src/app/globals.css` | config (CSS) | — | self L146-157 (reduced-motion) + L171-205 (density tokens) | exact (self) |

---

## Shared Patterns

### `cn()` class-join helper (every primitive)
**Source:** `src/lib/utils.ts:72` — `export function cn(...classes: (string | false | undefined | null)[]): string`
**Apply to:** All primitives (Button/Card/Input/Textarea/Select/Badge use it today; Tabs/Table/Field must use it). The pattern is `cn("<base>", variantStyles[v], sizeStyles[s], className)` — base classes first, prop-driven maps next, consumer `className` last (so consumers can override).

### Token discipline (every refreshed + new primitive)
**Source:** `src/app/globals.css:136-143` — the Phase-49 fluid `--text-*` clamps **exist and are live**:
```css
--text-h3: clamp(1rem, 0.95rem + 0.25vw, 1.125rem);
--text-body: clamp(0.875rem, 0.85rem + 0.125vw, 1rem);
--text-small: clamp(0.8125rem, 0.8rem + 0.0625vw, 0.875rem);
--text-caption: clamp(0.75rem, 0.73rem + 0.0625vw, 0.8125rem);
--text-micro: clamp(0.625rem, 0.61rem + 0.0625vw, 0.6875rem);
```
**Apply to:** All UI-01 refreshes. Use the tier utilities (`text-body`, `text-h3`, `text-caption`, `text-small`, `text-micro`) — NEVER bare `text-sm`/`text-xs`/`text-lg`/`text-base`. Colors stay `--color-*`-prefixed (`text-text-primary`, `bg-surface`, `border-border`, `text-negative`). A bare name resolves to currentColor under Tailwind v4 (per CONTEXT.md Established Patterns).

### forwardRef + useId for labelled controls (Input/Textarea/Select → Field)
**Source:** `src/components/ui/Input.tsx:10-13` and `:1` import:
```tsx
import { type InputHTMLAttributes, forwardRef, useId } from "react";
export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, className, wrapperClassName, id, ...props }, ref) => {
    const generatedId = useId();
    const inputId = id ?? generatedId;
```
**Apply to:** Field primitive (same `id ?? useId()` fallback), and verify each refreshed control keeps `forwardRef` + `displayName`. The 3 controls share `flex flex-col gap-1.5` wrapper + `{label && <label htmlFor>}` + `{error && <p>}` — Field consolidates exactly this.

### Reduced-motion is inherited, never duplicated (Skeleton + all motion)
**Source:** `src/app/globals.css:152-157`:
```css
@media (prefers-reduced-motion: reduce) {
  .animate-pulse { animation: none; opacity: 1; }
}
```
Two more `@media (prefers-reduced-motion: reduce)` blocks exist at L353 and L370.
**Apply to:** Skeleton inherits this for free (do NOT add a block). The STATE-04 View-Transition reduced-motion fallback EXTENDS these blocks (add `::view-transition-old(*)/::view-transition-new(*) { animation-duration: 0s !important }` per RESEARCH Pattern 5), never bypasses them.

### Density tokens already exist — reuse, don't redefine (StrategyTable density control)
**Source:** `src/app/globals.css:171-183`:
```css
:root { --row-h: 44px; --density-pad: 16px; }
body[data-density="tight"] { --row-h: 36px; --density-pad: 12px; font-size: 13px; }
body[data-density="loose"] { --row-h: 52px; --density-pad: 20px; }
```
**Apply to:** StrategyTable density control. **OPEN DECISION (RESEARCH Q2):** the existing rule is scoped to `body[data-density]` (global, drives the allocator dashboard via `[data-allocator-dashboard]` at L191-205). The discovery table is public — recommend a **table-scoped** `data-density` attribute on the StrategyTable root + a scoped rule reading the same `--row-h`/`--density-pad`, so flipping discovery density does NOT change allocator-dashboard density. Note: the global `font-size: 13px` on `tight` is what 52/53 must not inherit into the public table.

---

## Pattern Assignments

### `src/components/ui/Button.tsx` (primitive refresh — UI-01)

**Analog:** self. Public API (`variant`/`size` + native attrs) is FROZEN — class swap only.

**Current source** (`Button.tsx:15-19`, `:35`):
```tsx
const sizeStyles: Record<Size, string> = {
  sm: "px-3 py-1.5 text-xs",
  md: "min-h-[44px] px-4 py-2.5 text-sm",
  lg: "min-h-[44px] px-6 py-3 text-base",
};
// base className (line 35):
"inline-flex items-center justify-center rounded-lg font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-accent/50 disabled:opacity-50 disabled:pointer-events-none"
```
**Refresh (token map + focus-visible — NO prop change):**
- `sm`: `text-xs` → `text-caption`
- `md`: `text-sm` → `text-body`
- `lg`: `text-base` → `text-body`
- base: `focus:outline-none focus:ring-2 focus:ring-accent/50` → `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50`
- KEEP `rounded-lg`, `min-h-[44px]`, `variantStyles` map, `transition-colors`.

**Pitfall (RESEARCH #4):** `focus:` → `focus-visible:` is Button + Modal-close ONLY. Do NOT migrate Input/Select/Textarea focus rings (those legitimately fire on click). axe can't catch a missing keyboard ring — needs a manual keyboard-tab sweep.

---

### `src/components/ui/Input.tsx` / `Textarea.tsx` / `Select.tsx` (primitive refresh — UI-01)

**Analog:** self + each other (`Textarea.tsx` and `Select.tsx` are near-identical to `Input.tsx`). Public APIs FROZEN.

**Current source** (`Input.tsx:19`, `:27`, `:30`):
```tsx
// label:
className="text-sm font-medium text-text-primary"
// control:
"min-h-[44px] rounded-lg border border-border bg-surface px-3 py-2.5 text-sm text-text-primary placeholder:text-text-muted transition-colors focus:border-border-focus focus:outline-none focus:ring-2 focus:ring-accent/20 disabled:bg-page disabled:text-text-muted"
// error:
{error && <p className="text-xs text-negative">{error}</p>}
```
**Refresh (token map only — keep `focus:` here):**
- `<label>`: `text-sm font-medium` → `text-small font-medium`
- control text: `text-sm` → `text-body`
- error `<p>`: `text-xs` → `text-caption`
- **KEEP** the `focus:border-border-focus focus:ring-2 focus:ring-accent/20` soft border-glow (UI-SPEC Input contract — fields show focus on click). Select stays native `<select>`; Textarea mirrors Input. Apply the same map to all three.

---

### `src/components/ui/Badge.tsx` / `Modal.tsx` / `Card.tsx` / `Skeleton.tsx` (primitive refresh — UI-01)

**Analog:** self for all four. Color maps and public props FROZEN.

- **Badge** (`Badge.tsx:53`): `"inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium"` → `text-xs` becomes `text-caption`; the uppercase micro variant (where a consumer renders it) uses `text-micro uppercase tracking-wider`. The `colorMap`/`statusMap`/`statusLabelMap` are verbatim-frozen.
- **Modal** (`Modal.tsx:30`, `:31-44`): title `<h2 className="text-lg font-semibold text-text-primary">` → `text-h3 font-semibold`. Close `<button>` (L31-35) currently `"text-text-muted hover:text-text-primary transition-colors"` → ADD `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50` (no ring today). Stays native `<dialog>` + `showModal()` — do NOT swap to Radix Dialog (UI-04). `aria-label="Close"` preserved.
- **Card** (`Card.tsx:22`): `"bg-surface rounded-xl border border-border shadow-card"` — **NO change this phase.** `rounded-xl` (12px) vs DESIGN.md 8px is DEFERRED to 52/53 (changing it is a visible restyle — RESEARCH anti-pattern + A3).
- **Skeleton** (`Skeleton.tsx:11`): `"animate-pulse rounded-md bg-border/60"` + `aria-hidden`. Confirm `bg-border/60` maps to `--color-border`; reduced-motion inherited (do NOT duplicate the L152 block).

---

### `src/components/ui/Tabs.tsx` (NEW — Radix-backed — UI-02 / UI-04)

**Analogs:** (1) the 3 hand-rolled tabs for the **contract they must preserve**; (2) RESEARCH.md Pattern 2 for the Radix wrapper shape; (3) `WatchlistTabs.tsx:1` for the `"use client"` boundary.

**MUST be `"use client"`** (Pitfall 7) — Radix uses context+hooks. All 3 current consumers already start with `"use client"` so no consumer regresses.

**Underline-variant active treatment to preserve** — from `AdminTabs.tsx:128-133`:
```tsx
className={cn(
  "px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px",
  tab === t ? "border-accent text-accent"
            : "border-transparent text-text-muted hover:text-text-primary"
)}
// + count pill (AdminTabs.tsx:137): "ml-2 bg-accent text-white text-[10px] rounded-full px-1.5 py-0.5"
```
ProfileTabs differs in active treatment (`ProfileTabs.tsx:93-97`): `border-accent text-text-primary` (active) / `hover:text-text-secondary` (inactive), padding `px-4 py-2.5`. **Expose a `className`/variant hook so each consumer's exact active class + padding ports byte-faithfully** (UI-SPEC consumer mapping table).

**Segmented-variant active treatment to preserve** — from `WatchlistTabs.tsx:61-65`:
```tsx
"px-3 h-9 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
scope === "all" ? "bg-accent/10 text-accent" : "bg-surface text-text-secondary hover:bg-page"
// container (WatchlistTabs.tsx:49): "inline-flex border border-border rounded overflow-hidden"
```

**Radix wrapper (RESEARCH Pattern 2 — data-state styling hook, NOT aria-selected):**
```tsx
"use client";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { cn } from "@/lib/utils";
export const Tabs = TabsPrimitive.Root;     // value/defaultValue/onValueChange/activationMode passthrough
export const TabsList = TabsPrimitive.List;
// Trigger: "data-[state=active]:text-accent data-[state=active]:border-accent" + focus-visible ring + "data-[disabled]:opacity-50 data-[disabled]:pointer-events-none"
export const TabsContent = TabsPrimitive.Content;
```
- **Type refresh:** trigger text `text-sm` → `text-small font-medium`; count pill `text-[10px]` → `text-micro`.
- **`activationMode="automatic"`** (default) — matches all 3 consumers; `WatchlistTabs.test.tsx:117-137` explicitly asserts automatic activation (arrow also activates scope).

---

### `src/components/ui/Table.tsx` (NEW — UI-02 / STATE-03 foundation)

**Analogs:** (1) `ResponsiveTable.tsx` for the landmark contract it must NOT regress; (2) `admin/usage/page.tsx` for the canonical `<th scope>` markup.

**Landmark contract to preserve** — `ResponsiveTable.tsx:30-44`:
```tsx
const accessibleName = hint ?? (label ? `${label}: ${DEFAULT_HINT}` : DEFAULT_HINT);
return (
  <div className="overflow-x-auto" role="region" aria-label={accessibleName} tabIndex={0}>
    {children}
  </div>
);
```
The Table base BUILDS ON ResponsiveTable (does not replace it). **A page with >1 table (the /allocations holdings tab co-renders Strategies + Holdings + Open positions) MUST keep distinct `aria-label`s** so axe `landmark-unique` + the SR landmark rotor stay clean (ResponsiveTable.tsx:24-29 comment). Do not regress.

**Semantic `<th scope>` markup** — `admin/usage/page.tsx:97-118` (the existing semantic table):
```tsx
<thead>
  <tr className="border-b border-border text-left">
    <th className="py-2 pr-4 font-medium text-text-muted text-xs uppercase tracking-wider">Day</th>
    <th className="... text-right">session_start</th>
    ...
```
Table base adds `scope="col"` on header cells (and `scope="row"` for the sticky first column — STATE-03), a `<caption>` (visually-hidden ok) or `aria-label` naming the table. Header bottom-border + hairline rows + `hover:bg-page/50` (DESIGN.md table pattern). Type `text-xs` → `text-caption`; numeric cells KEEP `font-metric tabular-nums`.

---

### `src/components/ui/Field.tsx` (NEW — UI-02)

**Analogs:** (1) `Input.tsx` for `forwardRef`+`useId`+`flex flex-col gap-1.5` wrapper; (2) `CsvUploadStep.tsx:358-397` for the exact hand-wired label↔control↔error pattern Field consolidates.

**Hand-wired pattern Field replaces** — `CsvUploadStep.tsx:361-394`:
```tsx
<label htmlFor="strategy-name" className="text-xs font-medium text-text-primary">Strategy name</label>
<input
  id="strategy-name"
  aria-invalid={nameError !== null}
  className="... focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/20"
/>
{nameError ? (
  <p className="mt-1 text-xs text-negative" data-testid="csv-strategy-name-error">{nameError}</p>
) : (
  <p className="mt-1 text-xs text-text-muted">{CSV_UPLOAD_STEP_HEADINGS.nameHelper}</p>
)}
```
Note this analog hand-wires `aria-invalid` but **does NOT wire `aria-describedby`** to the error/hint — that gap is exactly what Field fixes.

**Field a11y wiring (RESEARCH Pattern 6 + UI-SPEC Field contract):**
```tsx
const id = providedId ?? useId();
const hintId = hint ? `${id}-hint` : undefined;
const errorId = error ? `${id}-error` : undefined;
const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;
// control gets: id, aria-invalid={!!error || undefined}, aria-describedby={describedBy}
```
- Visual: label `text-small font-medium text-text-primary`; hint `text-caption text-text-muted`; error `text-caption text-negative`; wrapper `flex flex-col gap-1.5`.
- Field WRAPS a control (children/passed control) — it does NOT duplicate Input/Select/Textarea inline label/error (those keep inline markup for back-compat).

---

### `src/components/admin/AdminTabs.tsx` (consolidate → Tabs underline — UI-03 dedup)

**Analog:** self → `Tabs.tsx` (underline variant). The hand-rolled tab strip is `AdminTabs.tsx:123-143`. Port to `Tabs`/`TabsList`/`TabsTrigger` keeping local `useState<Tab>` via Radix `value`/`onValueChange`. Active treatment `border-accent text-accent` + count pill preserved. The five tab BODIES (IntroRequestsTab/StrategyReviewTab/etc.) become `TabsContent` panels (or stay conditionally rendered if simpler — verify against ported `AdminTabs.test.tsx`). `AdminTabs.test.tsx:33-46` already stubs `HTMLDialogElement.showModal`/`close` — reuse that stub in any new Modal test.

---

### `src/components/auth/ProfileTabs.tsx` (consolidate → Tabs underline, URL-controlled — UI-03 dedup)

**Analog:** self → `Tabs.tsx`. **PRESERVE the IN-06 derive-each-render `?tab=` pattern** — `ProfileTabs.tsx:69` (`parseTabParam(searchParams.get("tab"), ...)`) and the `setActiveTab` router.replace at L74-81. Map to Radix `value={activeTab}` + `onValueChange={setActiveTab}` (controlled). Do NOT reintroduce a `useState` snapshot (the IN-06 fix; `ProfileTabs.test.tsx:140-169` pins back/forward parity).

**Test port (Pitfall 2 — MANDATORY):** `ProfileTabs.test.tsx` queries triggers via `getByRole("button", { name: "Security" })` (L70, L76, L104, L128). Radix `Tabs.Trigger` renders `role="tab"`. Edit those to `getByRole("tab", ...)`. L104 `getAllByRole("button").map(...)` (tab-order assertion) → `getAllByRole("tab")`. This is a mechanical test edit, NOT a behavior regression — flag it so the executor doesn't misread the failure.

---

### `src/components/strategy/WatchlistTabs.tsx` (consolidate → Tabs segmented — UI-03 dedup, HIGHEST RISK)

**Analog:** self → `Tabs.tsx` (segmented variant). **This is the single biggest risk in the phase (RESEARCH Pitfall 1).**

**The id contract that MUST survive** — `WatchlistTabs.tsx:53-57` builds `id={`${idBase}-tab-all`}` + `aria-controls={panelId}`; the panel lives OUTSIDE this component in `StrategyTable.tsx:384-394`:
```tsx
<div id={panelId} role="tabpanel"
  aria-labelledby={scope === "watchlist" ? `${tabIdBase}-tab-watchlist` : `${tabIdBase}-tab-all`}>
```
Radix auto-generates its OWN ids for trigger↔content and wires `aria-controls`/`aria-labelledby` between `Tabs.Trigger` and a descendant `Tabs.Content`. The StrategyTable panel is NOT a `Tabs.Content` (deliberately decoupled, rendered in a sibling). **Recommended option (a) (RESEARCH Q1):** keep the segmented styled wrapper but preserve the imperative `idBase`/`panelId` id contract (expose explicit trigger ids via passthrough/`asChild`) so the external panel's `aria-labelledby` still resolves. Option (b) (lift panel into `Tabs.Content`) is a larger refactor — fallback only.

**Acceptance gate (port, keep ALL):** `WatchlistTabs.test.tsx` pins — `idBase`-derived ids (L195-201: `allTab.id === "abc123-tab-all"`), `aria-controls === panelId` (L203-209), roving tabindex 0/-1 (L101-115), automatic activation on Arrow/Home/End (L117-193), `data-testid="watchlist-count-badge"` (L58-62). The ported test must still pass all of these. `StrategyTable.test.tsx` tabpanel assertions are the second half of the gate.

---

### `src/components/strategy/StrategyTable.tsx` (dense reshape — STATE-03, the 52/53 template)

**Analogs:** self + `ResponsiveTable.tsx` (wrap) + **RESEARCH Patterns 3 & 4 for the net-new CSS** (no in-repo analog — see "No Analog Found").

**Current table** — `StrategyTable.tsx:398-523` (the `viewMode === "table"` branch): `<div className="overflow-x-auto rounded-xl border border-border bg-surface">` → `<table className="w-full text-sm">` with `COLUMNS` (L35-44) + 3 trailing cols (Return spark / Underwater / Actions). Cells use `px-4 py-3 ... font-metric` (numeric).

**Four required behaviors:**
1. **Sticky header + first column** (RESEARCH P3 — GREENFIELD): `<thead> th` → `sticky top-0 z-20 bg-surface`; first col (Strategy name + leading star col when `showStarColumn`, L337/L403-410) → `sticky left-0 z-10 bg-surface border-r border-border`; corner header → `z-30`. Backgrounds MUST be opaque. **Pitfall 5:** the existing row hover `hover:bg-page/50` (L432) must NOT apply to the sticky first column (keep it solid `bg-surface`).
2. **Priority collapse** (RESEARCH P4 — GREENFIELD `@container`): priority order Strategy > Return% > CAGR > Sharpe > Max DD (always visible); Volatility/6 Month/AUM/sparklines collapse first. Collapsed values relocate into a reachable `<details>` with the SAME real value — **never fabricated 0/—/demo** (no-invented-data; the existing honest-null render at L479-490 via `formatPercent`/`formatCurrency` is the source of truth). Actions column stays reachable at every width.
3. **Scroll cue:** right-edge gradient + "Scroll for more columns →" in `text-caption text-text-muted`, shown only when `scrollWidth > clientWidth` (client measurement — already `"use client"`), `aria-hidden` (pairs with, never replaces, the ResponsiveTable `aria-label`).
4. **Density control:** segmented "Comfortable"/"Compact" → `--row-h`/`--density-pad` via a **table-scoped** `data-density` (NOT global `body` — RESEARCH Q2). Accessible name "Table density".

**Refresh map:** table cells `text-sm` → `text-body`; numeric cells KEEP `font-metric tabular-nums` (load-bearing for column alignment under fluid type).
**Preserve:** sort-on-header-click (L208-216, L412-421), pagination (L535-557), `role="tabpanel"` wiring with WatchlistTabs (L384-394), sparkline cells, `EmptyWatchlist` gate (L340/L396).
**axe gate:** `e2e/discovery-axe.spec.ts` must stay green (zero violations).

---

### `src/app/(dashboard)/admin/usage/page.tsx` (strangler pilot — UI-03)

**Analog:** self (raw `<table>`/`<th>`/`NoticeBox`) → `Table`/`Field`/`Button` primitives. This is the RESEARCH-recommended pilot (A2 — non-engine, admin-gated, 3 tables + the heatmap, axe-covered by the `admin-csv-status-axe.spec.ts`-class spec). It is an **RSC** (`export const dynamic = "force-dynamic"`, L26) with the `isAdminUser` gate at L42 — **PRESERVE the gate byte-faithfully** (V4 access-control, do not alter the redirect).

**Migration:** the 3 raw `<table>` blocks (L96-143, L159-187, L202-243) → `Table` base parts (gains `<th scope="col">` + named table); `NoticeBox` (L28-34) can stay or become a primitive. **Note:** this page currently has NO `<input>`/`<button>` — it is table-only. CONTEXT.md requires the pilot to exercise **button + table + input together**. If `/admin/usage` is kept, the planner must either (i) confirm a button/input is genuinely present/addable on this surface, or (ii) pick a different non-engine surface that has all three. **Flag for planning:** the recommended pilot satisfies "table" cleanly but NOT "button + input" — reconcile against the CONTEXT.md "button+table+input together" constraint (A2 says final pilot pick is Claude's discretion).

**Test analog:** `e2e/admin-csv-status-axe.spec.ts` (skip-when-no-seed-env + URL-pin false-green guard + `buildAxe(page).analyze()` → `violations.toEqual([])`). A `/admin/usage` axe spec mirrors this 1:1 (swap the route + heading assertion).

---

### `next.config.ts` (config — STATE-04)

**Analog:** self. Add `experimental: { viewTransition: true }` (no `experimental` block exists today). The CSP `style-src 'self' 'unsafe-inline'` (L55) ALREADY covers inline `style={{ height: "var(--row-h)" }}` density vars — **no CSP change needed** (RESEARCH Security V5). Use React's `<ViewTransition>` from `react` (NOT raw `document.startViewTransition`) — Pitfall 3.

### `src/app/globals.css` (config — STATE-04 + STATE-03)

**Analog:** self. EXTEND (do not bypass) the existing reduced-motion blocks (L152, L353, L370) with the `::view-transition-old/new` instant-swap rule. Reuse `--row-h`/`--density-pad` (L171-183) for the StrategyTable density control via a scoped rule.

---

## New-Primitive Test Patterns (Wave 0 — BP-03 ratchet)

**Analog for all new `.test.tsx`:** `CardShell.test.tsx` (RTL `render` + `screen.getByRole`/`getByText`, jsdom). Specific borrows:

| New test | Borrow from | Concrete pattern |
|----------|-------------|------------------|
| `Tabs.test.tsx` | `WatchlistTabs.test.tsx` | `getByRole("tab")`, `aria-selected`, `tabIndex` 0/-1, `fireEvent.keyDown(el, { key: "ArrowRight" })` + `document.activeElement` assertions, automatic activation |
| `Table.test.tsx` | `CardShell.test.tsx` + `admin/usage` | `getByRole("columnheader")` scope assert, `getByRole("region", { name })` for the landmark, sticky-class presence |
| `Field.test.tsx` | RESEARCH Pattern 6 | `getByLabelText`, assert `aria-describedby` contains BOTH hint+error ids, `aria-invalid="true"` when error set |
| `Button.test.tsx` | `CardShell.test.tsx` | render each variant×size; `expect(btn.className).toMatch(/text-body/)` + `/focus-visible:ring/`; assert NO bare `focus:ring` |
| `Modal.test.tsx` | `AdminTabs.test.tsx:33-46` | `HTMLDialogElement.prototype.showModal/close` stub (jsdom lacks them); assert title `text-h3`, close `focus-visible:ring` |

**Coverage warning (Pitfall 6):** the 6 core primitives have NO existing tests today (`src/components/ui/*.test.tsx` = CardShell/CollapsibleSection/Disclaimer/ScopedBanner/Tooltip/VerifiedBadge only — verified). The CSS-only refresh adds no branches, but the NEW primitives add substantial lines/branches/functions and MUST ship `.test.tsx` in the same PR. Gate: `npm run test:coverage` (full non-sharded) ≥ 82/80/74/72 (functions 74 / branches 72 are tightest).

---

## No Analog Found

| File / concern | Role | Data Flow | Reason |
|----------------|------|-----------|--------|
| StrategyTable `@container` priority-collapse CSS | component (CSS) | render | **Zero `@container` usage in the repo** (verified `grep -rln '@container' src` → none). Use RESEARCH Pattern 4 (Tailwind v4 core `@container` + `@max-*:hidden`). |
| StrategyTable `position: sticky` table header / first column | component (CSS) | render | **No sticky table-header precedent** (the repo's `sticky` usages are layout headers/footers in `*/layout.tsx`, `MobileTopBar`, `ScenarioFooter` — none is a `sticky top-0`/`left-0` data-table). Use RESEARCH Pattern 3 (z-index stack 20/10/30 + opaque bg). |
| `@radix-ui/react-tabs` import | dependency | — | First runtime UI-widget dep; no existing Radix import to copy. Install gated behind `checkpoint:human-verify` (slopcheck unavailable — RESEARCH Package Legitimacy Audit). |
| React `<ViewTransition>` | component | render | No existing View-Transition usage. Pattern is RESEARCH Pattern 5 + `node_modules/next/dist/docs/01-app/02-guides/view-transitions.md`, NOT a codebase analog. |

---

## Metadata

**Analog search scope:** `src/components/ui/`, `src/components/admin/`, `src/components/auth/`, `src/components/strategy/`, `src/components/exchanges/`, `src/app/(dashboard)/admin/usage/`, `src/app/(dashboard)/strategies/new/wizard/steps/`, `src/app/globals.css`, `next.config.ts`, `e2e/*-axe.spec.ts`
**Files scanned (read in full or targeted):** Button, Card, Input, Textarea, Select, Badge, Modal, Skeleton, ResponsiveTable, AdminTabs (+ test), ProfileTabs (+ test), WatchlistTabs (+ test), StrategyTable, admin/usage/page, CsvUploadStep (Field block), CardShell.test, discovery-axe.spec, admin-csv-status-axe.spec, globals.css (density + reduced-motion + fluid-token blocks), next.config.ts, utils.ts (cn)
**Greenfield CSS flagged:** `@container` (0 in-repo), sticky data-table header/first-col (0 in-repo)
**Pattern extraction date:** 2026-06-29
