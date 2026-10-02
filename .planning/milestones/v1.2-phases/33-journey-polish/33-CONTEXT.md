# Phase 33: Journey Polish - Context

**Gathered:** 2026-06-23
**Status:** Ready for planning
**Mode:** Smart discuss (autonomous) — grey-area answers auto-resolved per the
standing "no clients yet → decide autonomously, never stop to ask" directive.
Recommended resolutions documented below; bounded by the ROADMAP exit gate
"the risk here is sprawl, not unknowns."

<domain>
## Phase Boundary

Polish the path to the now-settled unified composer (the `ScenarioComposer` on
`/allocations?tab=scenario`). THREE bounded deliverables, no new surfaces:

1. **Bridge → composer continuity (JOURNEY-01)** — an allocator carries a Bridge
   recommendation into the composer as part of a portfolio. A seam already
   exists (`BridgeDrawer.onAddToScenario` → `scenario.addStrategyBridge` →
   `ScenarioComposer`); this phase VERIFIES that seam is live end-to-end and
   pins it with a regression test, fixing the wiring at root ONLY if
   verification proves it dead.
2. **Entry-point + empty-state DESIGN.md consistency (JOURNEY-02)** — the
   inventoried path to the composer is visually consistent with DESIGN.md (one
   chart stack, one metric strip, canonical Card/type/tokens). Flag-and-fix
   genuine drift only.
3. **WCAG-AA accessibility (JOURNEY-03)** — an axe-core e2e spec proves the
   unified composer + the Phase-30 graphs pass WCAG-AA.

**Hard constraints (carry-through from 29–32):** ZERO new dependency
(`@axe-core/playwright` already installed), ZERO schema change, ZERO new data
model. Frozen `src/lib/scenario.ts` stays zero-diff (CI guard). The
honesty/IMPACT-02 + RLS guards from 29–32 must not regress. DESIGN.md governs
every visual decision (read before any UI). Scope is bounded by the 4-surface
inventory below — do NOT introduce new surfaces.

</domain>

<decisions>
## Implementation Decisions

### Grey Area 1: Bridge → Composer Continuity (JOURNEY-01)
- **Wire/verify the EXISTING seam, do not build a new one.** The path is
  `BridgeDrawer.onAddToScenario(holdingScopeRef, candidate)` →
  `scenario.addStrategyBridge` (scenario-state.ts:364-390) → `ScenarioComposer`
  (integration at ScenarioComposer.tsx:2334-2347). No new state machine,
  callback type, or persistence.
- **VERIFY IT IS LIVE before declaring done (FLOW-01 lesson).** A structurally-
  wired seam can be dead: `BridgeWidget` mounts its own `BridgeDrawer`
  instances WITHOUT `onAddToScenario` (BridgeWidget.tsx:278-283/317-322/377-382),
  so only the composer-owned drawer can seed the draft. The phase must prove the
  user-reachable path actually delivers the candidate into the draft + updates
  the projection; if the live tab can't reach the seeding drawer, fix the wiring
  at root (not a bandaid).
- **Per-candidate add via the drawer confirm — no batch-add.** Batch seeding is
  sprawl; out of scope.
- **No new persistence.** The added candidate lands in the in-memory draft and
  saves via the existing `scenarios` save path. No migration, no schema change.
- **Proof:** a non-vacuous regression test that fails if the seam is neutered
  (candidate must appear in the draft + the projection must reflect it), plus
  end-to-end reachability coverage.

### Grey Area 2: Entry Points + Empty States (JOURNEY-02)
- **Scope = EXACTLY these 4 inventoried surfaces, no new ones:**
  1. Allocations empty state — `allocations/EmptyState.tsx:34-59` (DESIGN.md-compliant)
  2. Onboarding banner — `allocations/components/OnboardingBanner.tsx:28-80` (compliant)
  3. Composer blank-slate — `ScenarioComposer.tsx` mode switch (the one real gap:
     no rich "add your first strategy" front door)
  4. Discovery — `discovery/[slug]/page.tsx:41-77` (uses Breadcrumb/PageHeader/InfoBanner/StrategyTable)
- **Consistency target = DESIGN.md primitives:** Card (8px radius, white,
  1px #E2E8F0), KpiStrip metric strip, chart-token chart stack, Fraunces serif
  headings / DM Sans body / Geist Mono numerics, accent tokens. Read DESIGN.md
  before touching any of these.
- **Composer blank-slate is the only likely change** — add a DESIGN.md-consistent
  blank-slate front door (a clear "add your first strategy" CTA into the Browse
  drawer) ONLY if missing, reusing existing primitives (Card + existing CTA
  styles), not a new component family.
- **Keep locked copy byte-identical** where DESIGN.md / existing tests pin it
  (e.g. "Connect Exchange →"). Fix only genuine inconsistency.

### Grey Area 3: WCAG-AA Accessibility (JOURNEY-03)
- **Tool:** `@axe-core/playwright` via the existing `e2e/helpers/axe.ts`
  `buildAxe(page)` (already configured for `wcag2a + wcag2aa + best-practice`).
  No new dependency, no jest-axe.
- **Surfaces:** `/allocations?tab=scenario` (the unified composer) INCLUDING the
  Phase-30 Returns-distribution + Rolling-metrics cards. The standalone charts
  already have coverage via `e2e/strategy-v2-axe.spec.ts` — extend, don't dup.
- **Auth pattern:** seed test allocator + form login per
  `e2e/discovery-axe.spec.ts:30-66`, then navigate to the scenario tab.
- **Gate level = AA:** `expect(results.violations).toEqual([])`, matching the
  existing discovery / strategy-v2 axe specs. Any real violation is fixed at
  root (semantic HTML / labels), NEVER by suppressing a rule.

### Claude's Discretion
- Exact file/test naming, the blank-slate component shape (reuse vs minimal new),
  and whether JOURNEY-01's proof is a unit regression test, an e2e step, or both
  — all at Claude's discretion, guided by codebase conventions and the
  smallest-diff-that-proves-it principle.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- **Bridge seam:** `BridgeDrawer.tsx:72-96` (`onAddToScenario` callback +
  `BridgeAddToScenarioCandidate`), `scenario-state.ts:364-390`
  (`addStrategyBridge` pure mutator — holding keeps weight, candidate takes it,
  others renormalize to 1.0), `ScenarioComposer.tsx:2334-2347` (handler reg).
- **Empty/onboarding surfaces:** `allocations/EmptyState.tsx`,
  `allocations/components/OnboardingBanner.tsx` (WarningBanner shell),
  `discovery/[slug]/page.tsx` (Breadcrumb/PageHeader/InfoBanner/StrategyTable).
- **A11y harness:** `playwright.config.ts` (testDir `./e2e`, auto webServer),
  `e2e/helpers/axe.ts` (`buildAxe`), `e2e/discovery-axe.spec.ts` (authed-seed +
  form-login + `analyze()` pattern), `e2e/strategy-v2-axe.spec.ts` (charts).
- **Phase-30 graphs on the blend:** `ReturnHistogram`, `RollingMetrics`,
  `RollingVolatilityChart`, `RollingSortinoChart` from `@/components/charts`,
  mounted in `ScenarioComposer.tsx:1704+/1765+`.

### Established Patterns
- Authed e2e: `seedTestAllocator()` → form login → wait for nav → navigate to
  gated route → `buildAxe(page).analyze()` → assert zero violations.
- Charts read chart-token colors; metrics via KpiStrip (tabular-nums Geist Mono);
  Card containers are the canonical visual shell.

### Integration Points
- The composer-owned `BridgeDrawer` (ScenarioComposer.tsx:2330) is the ONLY
  drawer that passes `onAddToScenario` — the JOURNEY-01 reachability hinge.
- New axe spec mounts against `/allocations?tab=scenario`.

</code_context>

<specifics>
## Specific Ideas

- **FLOW-01 lesson (load-bearing):** a structurally-wired seam can be shipped-
  but-dead. JOURNEY-01 must be verified LIVE on the user-reachable path, not
  assumed from the presence of the callback type. Prove it with a test that
  fails when the seam is neutered.
- DESIGN.md is the visual contract — read it before any JOURNEY-02 change.
- Frozen `scenario.ts` zero-diff (SCENARIO-05 CI guard) and the IMPACT-02 /
  honesty / RLS guards from 29–32 must not regress in the polish sweep.
- Reuse the existing axe pattern (`e2e/helpers/axe.ts` + `discovery-axe.spec.ts`)
  verbatim — do not introduce a second a11y harness.

</specifics>

<deferred>
## Deferred Ideas

Already logged as v2 in STATE.md decisions — out of scope for Phase 33:
- EXPORT-01 (blend factsheet PDF/CSV)
- EXPO-01 (exposure panel — honesty-gated)
- LEVER-01 (persist per-strategy leverage)
- BRIDGE-02 (advanced Bridge auto-seed beyond the existing per-candidate add)
- Any NEW entry-point surface beyond the inventoried 4 (sprawl guard).

</deferred>
