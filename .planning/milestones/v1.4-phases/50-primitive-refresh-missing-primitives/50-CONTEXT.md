# Phase 50: Primitive Refresh + Missing Primitives - Context

**Gathered:** 2026-06-29
**Status:** Ready for planning

<domain>
## Phase Boundary

Build the evolved primitive library **in code** on the Phase-49 token spine.
Deliver: (1) core primitives (Button/Card/Input/Badge/Modal/Skeleton) refreshed
to consume the new fluid `--text-*` tokens so every existing consumer inherits
the look with **no per-call-site edits**; (2) the genuinely-missing primitives
added and a11y-correct — a canonical **Tabs** (Radix-backed), a **Table** base
(sticky/density-capable), and a **Field** wrapper (label+control+error+hint with
`aria-describedby`/`aria-invalid` wiring); (3) the existing **Tabs sprawl**
(`AdminTabs` / `ProfileTabs` / `WatchlistTabs`) consolidated onto the one Tabs
primitive; (4) **one** dense table — Discovery/`StrategyTable` — reshaped
best-in-class (sticky header + first column, priority collapse to reachable
detail, visible scroll cue, working density control); (5) restrained
micro-interactions via **native CSS transitions + the View Transitions API
only** (no motion library), honoring `prefers-reduced-motion`; (6) **one** pilot
surface migrated off raw `<button>`/`<table>`/`<input>` to prove the strangler.

This is the toolkit phase. It deliberately does NOT do the broad per-surface
migration (that is the strangler in phases 52/53) — only the obvious dedup (Tabs)
+ one pilot. FROZEN: `scenario.ts` (SCENARIO-05), `compute.ts` parity,
FactsheetBody (BODY-02), no-invented-data, no-peer-rank, the v1.3 WCAG-AA floor,
`next/font` wiring, fonts (Instrument Serif / DM Sans / Geist Mono), accent
`#1B6B5A`. Light mode only.
</domain>

<decisions>
## Implementation Decisions

### Widget a11y strategy (user-accepted)
- **Adopt Radix for Tabs** — Tabs has no native HTML equivalent, so the canonical
  Tabs primitive is backed by `@radix-ui/react-tabs` (industry-standard roving
  tabindex / arrow-key / focus a11y). `@radix-ui/*` is NOT on the banned-packages
  list. This is the FIRST runtime UI-widget dependency in an otherwise 100%-native
  app — scoped to no-native-equivalent widgets only (UI-04).
- **Native retained everywhere it already fits** — `Modal` already uses native
  `<dialog>` + `showModal()` (it IS the Dialog primitive — keep it, do not swap to
  Radix Dialog); `Select` already uses native `<select>`; disclosure stays native
  `<details>/<summary>` (`CollapsibleSection`). Radix is NOT pulled in for these.

### Dense-table demonstrator — STATE-03 (user-accepted)
- **Discovery / `StrategyTable`** is the one table reshaped best-in-class this
  phase. Public surface (lowest blast radius, canary-verifiable without an authed
  session), genuinely dense (many per-strategy metric columns). The reshape adds
  sticky header + sticky first column, priority-collapse of low-priority columns
  to a reachable detail affordance, a visible scroll cue, and a working density
  control — on top of the existing `ResponsiveTable` scroll-affordance wrapper
  (whose own comment defers column reshape to "phase 46 / TABLE-01"). The
  later surface phases (52/53) replicate this pattern.

### Consolidation scope (user-accepted)
- **Consolidate sprawl + 1 pilot** — add the canonical primitives AND fold the
  obvious dedup now: the 3 hand-rolled Tabs implementations (`AdminTabs`,
  `ProfileTabs`, `WatchlistTabs`) collapse onto the one Tabs primitive (each
  ported in the same PR, tests ported — BP-03 ratchet held). Migrate **one** pilot
  surface off raw `<button>`/`<table>`/`<input>` to demonstrate the strangler is
  incremental. Broad per-surface table/element migration stays deferred to 52/53.
  NOT a big-bang rewrite (the milestone rules that out).

### Claude's Discretion (grounded in codebase conventions)
- **Token refresh is additive/CSS-only** — primitives migrate their internal
  classes to the new `--text-*` utilities (+ existing `--color-*` / fixed space
  ladder); the public prop API of each primitive is unchanged so consumers inherit
  the refresh for free. No FactsheetBody / chart byte-identity surface is touched.
- **Field primitive** wraps `<label>` + control + error + hint with the a11y
  wiring (`htmlFor`/`id`, `aria-describedby` for hint+error, `aria-invalid` on
  error) — the pattern the wizard/connect forms already hand-wire, consolidated.
- **Motion is minimal + reduced-motion-safe** — extend the existing
  `@media (prefers-reduced-motion: reduce)` blocks in `globals.css`; View
  Transitions are opt-in on a small, purposeful set (e.g. tab-panel / density
  toggle), never decorative; no `framer-motion`/`motion`/`@headlessui`.
- **Pilot surface** chosen at planning time as a low-risk surface that exercises
  button+table+input together (NOT an engine-adjacent surface) so the strangler
  proof is clean.
- Exact primitive file layout, Tabs API shape, density-control mechanism, and
  View-Transition targets are at Claude's discretion within the above + ROADMAP
  success criteria.
</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/components/ui/` — current primitives: `Button` `Card` `CardShell` `Input`
  `Textarea` `Badge` `Modal` (native `<dialog>`) `Select` (native `<select>`)
  `Skeleton` `Tooltip` `EmptyStateCard` `TimeframeSelector` `VerifiedBadge` … The
  refresh re-points these at the new `--text-*` tokens.
- `src/components/ResponsiveTable.tsx` — the focusable horizontal-scroll wrapper
  with the accessible scroll-affordance name; the dense reshape builds on it
  (sticky/collapse/density are new; do not regress the unique-`aria-label`
  landmark contract for the multi-table /allocations holdings tab).
- Tabs sprawl to consolidate: `src/components/admin/AdminTabs.tsx`,
  `src/components/auth/ProfileTabs.tsx`, `src/components/strategy/WatchlistTabs.tsx`
  (+ their `.test.tsx`).
- `src/components/strategy/StrategyTable.tsx` (+ `StrategyTable.test.tsx`) — the
  STATE-03 reshape target; `src/components/layout/Breadcrumb.tsx` already exists
  (NAV uses it in 51 — leave its API stable).
- `src/lib/design-tokens/typography.ts` (Phase 49) — the fluid tier tokens the
  refresh consumes.
- `tests/e2e/discovery-axe.spec.ts` — the a11y gate for the StrategyTable reshape;
  `axe-app-wide.spec.ts`, `composer-axe.spec.ts` cover the rest.

### Established Patterns
- `--color-*` / `--text-*`-prefixed Tailwind v4 token discipline (a bare name
  resolves to `currentColor`/black). Primitives MUST use the prefixed utilities.
- `prefers-reduced-motion: reduce` already handled in 3 `globals.css` blocks —
  motion work extends these, never bypasses them.
- Per-component `.test.tsx` colocated; the coverage ratchet (82/80/74/72) is a
  blocking CI gate — every primitive rewrite ports/keeps its tests in the same PR.
- Axe WCAG-AA is enforced via Playwright per-surface specs (the real a11y gate).

### Integration Points
- `package.json` — add `@radix-ui/react-tabs` (first UI-widget dep).
- `src/components/ui/` — refreshed + new primitives (Tabs, Table base, Field).
- The 3 Tabs consumers + the pilot surface — migrated.
- `src/components/strategy/StrategyTable.tsx` — dense reshape.
- `src/app/globals.css` — View-Transition + transition tokens (reduced-motion-safe).
- `tests/` + `tests/e2e/*-axe.spec.ts` — primitive + reshape + a11y coverage.
</code_context>

<specifics>
## Specific Ideas

- "Missing primitives" is partly a consolidation problem, not a greenfield one:
  Dialog=existing Modal (native), Select=existing native, Breadcrumb=existing.
  The genuinely-new primitives are **Tabs** (Radix), a **Table** base, and
  **Field**. Avoid building speculative primitives with no consumer.
- The Tabs consolidation is the highest-value dedup (3 impls → 1) and the cleanest
  strangler demonstration; make Tabs a11y-correct via Radix and prove the 3
  consumers render identically (tests ported).
- Density control + priority-collapse should degrade honestly under
  no-invented-data: collapsed columns move to a reachable detail, never get
  fabricated or zero-filled.
</specifics>

<deferred>
## Deferred Ideas

- Broad per-surface raw-element → primitive migration (UI-03 at scale) — phases
  52/53 strangler.
- Per-surface fluid-type realization (TYPE-02/03/04) — phase 52.
- Reshaping the remaining dense tables (allocations holdings, admin, compare) —
  52/53, replicating the StrategyTable pattern proved here.
- Radix beyond Tabs (e.g. a future combobox/popover with no native equivalent) —
  only if a concrete widget needs it; not speculative.
- Dark mode — out of scope (institutional light mode only).
</deferred>
