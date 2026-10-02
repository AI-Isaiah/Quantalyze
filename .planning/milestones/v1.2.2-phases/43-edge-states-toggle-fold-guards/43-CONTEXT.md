# Phase 43: Edge states, toggle fold & guards - Context

**Gathered:** 2026-06-26
**Status:** Ready for planning
**Mode:** Decisions taken autonomously (no-clients directive) — the GUARD-01..04
requirements + the accumulated Phase-40/41/42 UI-review carry-forwards are
concrete; no open grey areas warranting a discuss pause.

<domain>
## Phase Boundary

The milestone-closing phase: fold the compose toggles into the factsheet-shaped
layout (compose + read on one surface), land the accumulated UI-review polish,
and install the four PERMANENT guards (byte-identity, WCAG-AA axe, coverage,
no-state-bleed). `scenario.ts` stays FROZEN (zero-diff; the v1.2 frozen-spine
guards must stay green). Requirements GUARD-01..04.

</domain>

<decisions>
## Implementation Decisions

### GUARD-01 — fold compose toggles + UI-review polish
- Fold the existing compose toggles into the factsheet-shaped composer surface so
  composing + reading happen on one surface: the Phase-37 per-data-source
  include/exclude toggle, the scenario include/exclude, and the v1.2 Browse-catalog
  add-strategy entry. They currently live in the composer chrome; present them in a
  factsheet-shaped "compose controls" region adjacent to / within the mounted body
  flow (DESIGN.md editorial styling), NOT a visual redesign of the toggles
  themselves — reuse the existing controls, reposition for one-surface compose+read.
- **Land the accumulated UI-review carry-forwards (all in STATE.md):**
  - P40: footer "Page 1 / 1" print-stamp renders on screen in the composer mount —
    `scenarioMode`-gate the page-stamp `<p>` in `FactsheetFooter` (keep the
    disclaimer; suppress the stamp when `scenarioMode`). Compound vertical padding
    at the mount seam (article `py-6/10/12` + composer `mt-6`) — a negative-margin
    compensator or fold into the layout.
  - P41: the Diversification too-similar badge uses hardcoded `bg-[#FEF3C7]
    border-[#FDE68A]` (ScenarioComposer.tsx:~2443) → `bg-warning-bg
    border-warning-border` tokens. The "risk-reducing" PCR tag uses
    `bg-positive/10 text-positive` (P&L green) → `bg-accent/10 text-accent`.
  - P42: ConstituentMandatePanel leverage chip renders "1×" unconditionally
    (MandatePanels.tsx:~191) → guard `c.leverage > 1`.
  - Token formalization: `border-text` / `text-text-2` lack `@theme inline`
    light-mode tokens (render via dark-mode overrides) — formalize a
    `--color-text` / `--color-text-2` entry OR repoint the factsheet-shell dividers
    to the standard `border-border` (the P40 NIT). h3 type contract (text-[13px]
    vs the v2 text-[12px] tracking-[0.18em]) — normalize the new factsheet-shaped
    sections to the v2 contract (do NOT churn pre-existing factsheet files beyond
    the additive sections).
- Honest empty states for ALL degenerate blends (0/1 constituent, n<10, n<252,
  no own-book, no mandate) — verify the full degenerate matrix renders honestly on
  the one composed surface (most already shipped per-phase; this is the closing
  cross-check).

### GUARD-02 — permanent byte-identity gate
- A PERMANENT regression test pins the real `/factsheet/[id]/v2` route (page.tsx →
  `<FactsheetView payload/>`, default `scenarioMode=false`) byte-identical: render
  FactsheetBody with default props ≡ `scenarioMode={false}` (structural/innerHTML
  equality on a populated payload), AND assert the Overview `EquityChartWidget`
  path is untouched. This is the milestone-closing permanent gate (the per-phase
  byte-identity tests were per-phase; this one stays).

### GUARD-03 — WCAG-AA axe + coverage
- EXTEND the existing `e2e/composer-axe.spec.ts` (already CI-wired from v1.2
  Phase-33) to cover the new factsheet body + the Diversification / Peer / Mandate
  / OwnBookDelta sections for WCAG-AA (axe serious+critical = 0). Since this EXTENDS
  the existing spec (not a new seed-gated spec), the FLOW-01 trap (add to
  HAS_SEED_ENV + ci.yml) does NOT apply — but VERIFY the spec is still in the CI
  playwright list. The coverage ratchet (lines 82 / fns 74 / branches 72) stays
  green.

### GUARD-04 — no persist/storageKey cross-tab bleed
- A test verifying the mounted body under `<FactsheetProvider persist={false}>` +
  the new composer sections write NOTHING to localStorage / the URL (the Phase-38
  RT2 class). The Diversification section omits `storageKey` (P41); confirm no new
  section reintroduces a persisted key on the composer surface.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `e2e/composer-axe.spec.ts` — the existing composer-axe WCAG e2e to EXTEND.
- `FactsheetProvider persist={false}` (factsheet-context.tsx) — the RT2 gate.
- The compose toggles: the Phase-37 data-source toggle + scenario include/exclude
  in `ScenarioComposer.tsx`; the Browse-catalog add entry.
- `FactsheetFooter` (FactsheetView.tsx) — the page-stamp to scenarioMode-gate.
- DESIGN.md token ladder (`--color-warning-bg/border`, `--color-accent`).

### Established Patterns
- Per-phase byte-identity tests already exist (P40); GUARD-02 is the permanent one.
- ⚠️ scenario.ts FROZEN — do NOT modify it; the frozen-spine guards (phase-29..32)
  assert zero-diff.
- ⚠️ FLOW-01 (memory): a NEW seed-gated e2e must be added to BOTH HAS_SEED_ENV +
  ci.yml's playwright list — but GUARD-03 EXTENDS an existing spec, so verify-only.

### Integration Points
- The toggle-fold touches `ScenarioComposer.tsx` (static-guard: no `FactsheetBody`
  literal there — keep the body mount in `ScenarioFactsheetChart.tsx`).
- The footer scenarioMode-gate touches `FactsheetView.tsx` (additive prop thread,
  default false → byte-identical, which GUARD-02 then pins).

</code_context>

<specifics>
## Specific Ideas

- This phase CLOSES milestone v1.2.2. After it: gsd audit-milestone →
  complete-milestone (git tag v1.2.2) → cleanup.
- The polish carry-forwards are the visual debt accumulated across 40/41/42 — fold
  them here so the milestone ships clean.

</specifics>

<deferred>
## Deferred Ideas

- v2 items (CORR-V2, EXPORT-V2, STYLE-V2) stay deferred.
- The authed live canaries (peer panel on a real ≥20 cohort; per-source toggle on
  real per-key data) — deferred-by-construction post-deploy authed UATs.

</deferred>
