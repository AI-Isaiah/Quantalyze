# Phase 31: Graphs-Lead Layout & Collapsible Controls - Context

**Gathered:** 2026-06-23
**Status:** Ready for planning
**Mode:** Smart-discuss (autonomous — decisions made by Claude per the standing "no clients yet, decide autonomously" directive; this is a tightly-specified UI tweak on an existing surface with locked exit gates)

<domain>
## Phase Boundary

Make the strategy composition controls (the per-strategy toggle / weight / leverage list = `CompositionList`) collapsible/hideable on the unified `ScenarioComposer`, so the factsheet-grade graphs (equity, drawdown, correlation, returns-distribution, rolling Sharpe/vol/Sortino — landed Phase 30) lead the surface. Collapsing MUST preserve every in-progress weight and leverage edit (hide, never unmount — no state reset), and the projection/graphs behind the collapsed panel must keep reflecting those edits.

Scope is LAYOUT-01 + LAYOUT-02 only. No new data, no schema change, no engine change. Frozen `src/lib/scenario.ts` (SCENARIO-05) stays zero-diff.
</domain>

<decisions>
## Implementation Decisions

### Collapse affordance & placement
- The disclosure primitive is the **lifted `CollapsibleSection`** (native `<details>`/`<summary>`), moved from `src/app/factsheet/[id]/v2/CollapsibleSection.tsx` to `src/components/ui/CollapsibleSection.tsx`. (Locked by the ROADMAP exit gate.) Native `<details>` is keyboard-accessible by default and keeps children MOUNTED when closed (the browser hides them) — hide-don't-unmount holds by construction.
- The **`CompositionList` (toggle/weight/leverage) becomes the collapsible section.** The graph panels stay always-visible and lead the surface.
- The graphs already render *before* `CompositionList` in `ScenarioComposer` DOM order (Correlation → Histogram/Quantiles → Rolling, then `CompositionList`). "Graphs lead" is therefore achieved by making the controls collapsible — **no panel reorder** (surgical). Collapsing gives the graphs the full surface.
- Summary label: a neutral controls label (e.g. "Strategies & weights" / "Composition controls"); reuse the existing summary visual (uppercase `tracking-wider`, caret rotation, `Hide`/`Show` mono affordance) for consistency with the factsheet usage.
- **Default state: EXPANDED (open)** on first load — an allocator composing needs the controls visible; hiding to focus on graphs is opt-in. Persist the user's open/closed choice via `storageKey` so it survives reload.

### State preservation (Pitfall 5 — the core gate)
- **Hide-don't-unmount:** `CompositionList` stays MOUNTED when collapsed. NEVER `{open && <CompositionList ... />}`. Grep gate: no conditional mount of `CompositionList`.
- The edit state (`leverageByRef`, and the weight-input state) already lives in the **parent `ScenarioComposer`, above the collapsible boundary** (`leverageByRef` is a `useState` at the component top). It therefore survives collapse/expand inherently. **Do NOT move edit state down into `CompositionList`** — that would reintroduce the reset risk.
- The projection + graph panels read parent state (the canonical sum-to-1 draft map + `leverageByRef`), not the controls' mount, so they keep reflecting in-progress edits while the controls are collapsed.

### Persistence & namespace generalization (the lift)
- Lift to `src/components/ui/CollapsibleSection.tsx`. **Generalize the factsheet coupling:** rename the exported `FACTSHEET_OPEN_ALL_EVENT` to a neutral constant (e.g. `COLLAPSIBLE_OPEN_ALL_EVENT = "collapsible-section:open-all"`), and decouple analytics via an **optional injected callback** (e.g. `onToggle?(open: boolean): void`) instead of a hard `trackFactsheetEvent` import.
- **Repoint the factsheet** (`FactsheetView.tsx`) to the lifted primitive: update the import path, the open-all event dispatch (ControlBar "Reset view"), and pass its `trackFactsheetEvent(...)` via the new `onToggle` callback. Preserve factsheet behavior exactly. Keep the factsheet's raw `storageKey` strings byte-identical so existing stored open/closed states survive (the `rawStringCodec` back-compat contract in the current file).
- Composer uses a composer-scoped `storageKey` (e.g. `composer-collapse:controls`) so the allocator's collapse choice persists for the composer surface, independent of factsheet keys.

### Motion, a11y & DESIGN.md conformance
- Keyboard: native `<details>` summary toggles on Enter/Space; the existing `focus-visible:outline-accent` + `min-h-[44px]` touch target carry over. WCAG-AA is Phase 33's sweep, but the primitive is already accessible.
- Motion: minimal-functional per DESIGN.md — keep the existing caret-rotation only; no decorative open/close animation.
- Visual identity: reuse the existing summary styling (DESIGN.md typography: uppercase tracking-wider label, `text-muted` Hide/Show, hairline `border-b`), so the composer's collapse control reads consistently with the factsheet.
</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/app/factsheet/[id]/v2/CollapsibleSection.tsx` — the primitive to lift. `<details>`-based, persists open/closed via `useCrossTabStorage` + `rawStringCodec` (SSR-safe deferred hydration, cross-tab sync), exposes `FACTSHEET_OPEN_ALL_EVENT`. Children are always rendered (mounted) — closed only hides them visually.
- `src/components/ui/` — the target directory for the lifted primitive (siblings: `Card`, `Modal`, `Disclaimer`, etc.).
- `ScenarioComposer.tsx` — host. `leverageByRef` `useState` at the component top (~L501); graphs render ~L2065–2162; `CompositionList` rendered ~L2245; `CompositionList` defined ~L2394 (props include `leverageByRef`).

### Established Patterns
- Cross-tab persisted UI state goes through `@/lib/storage/cross-tab` (`useCrossTabStorage`) + `@/lib/storage/codecs` (`rawStringCodec`), with `sentryArea` for fail-loud read/write. Reuse, don't re-roll.
- Lift-and-repoint precedent: prior phases moved shared primitives and repointed the single consumer's import (surgical, no behavior change).

### Integration Points
- `FactsheetView.tsx` is the sole current consumer of `CollapsibleSection` + `FACTSHEET_OPEN_ALL_EVENT` — it must be repointed when the file moves.
- `ScenarioComposer.tsx` is the new consumer (wraps `CompositionList`).
</code_context>

<specifics>
## Specific Ideas

- Hide-don't-unmount and "edit state lives in the parent, above the collapsible boundary" are the two load-bearing facts. The regression test must be non-vacuous: type a NON-DEFAULT weight + set a leverage, collapse, expand, assert BOTH `weightInputs`/`leverageByRef` (or their actual variable names) survive AND the projection still reflects them. A test that collapses with default state is vacuous and fails the exit gate.
- The lift is the only non-trivial code motion; keep the factsheet byte-compatible (storageKey strings + analytics behavior) so no factsheet regression.
</specifics>

<deferred>
## Deferred Ideas

- Full mobile-responsive polish — v2 per DESIGN-04 / PROJECT.md.
- WCAG-AA automated sweep on the new layout — Phase 33 (JOURNEY-03), not here.
</deferred>
