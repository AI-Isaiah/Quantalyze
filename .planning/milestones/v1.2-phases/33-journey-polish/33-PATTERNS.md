# Phase 33: Journey Polish - Pattern Map

**Mapped:** 2026-06-23
**Files analyzed:** 5 work items across 3 deliverables (JOURNEY-01/02/03)
**Analogs found:** 5 / 5 (this is a polish/verification phase — every "new" file mirrors a shipped analog verbatim; near-zero net-new code)

> **Governing constraint: anti-sprawl.** This is a POLISH / VERIFICATION phase over EXISTING surfaces, not a redesign or capability phase. Every assignment below is "verify + pin", "extend verbatim", or "smallest residual-gap fix with existing primitives". NO new component family, NO new dependency, NO schema change, NO new a11y harness. Frozen `src/lib/scenario.ts` stays zero-diff (SCENARIO-05 CI guard).

---

## File Classification

| Work item / file | Role | Data Flow | Closest Analog | Match Quality |
|------------------|------|-----------|----------------|---------------|
| **JOURNEY-01** — Bridge→composer seam regression test (NEW or extend `scenario-state.test.ts` / `useScenarioState.test.tsx` / `BridgeDrawer.test.tsx`) | test (unit) | event-driven (callback → pure mutator → draft) | `scenario-state.test.ts:241-278` `addStrategyBridge` block + `useScenarioState.test.tsx:217-236` (`T_USE6`) + `BridgeDrawer.test.tsx:486-606` (`Add to scenario` CTA cases) | exact (the seam is already test-covered at every layer — see gap analysis below) |
| **JOURNEY-01** — reachability verification (composer-owned `BridgeDrawer` is the only one wired) | component (verify, no edit expected) | request-response (UI affordance) | `ScenarioComposer.tsx:2329-2348` (the ONLY `onAddToScenario`-bearing drawer) vs `BridgeWidget.tsx:278/317/377` (3 drawers WITHOUT it) | exact |
| **JOURNEY-01** — Bridge-add `role="status"` confirmation feedback (NEW, only if no live toast) | component (minimal) | event-driven (transient live region) | `discovery/[slug]/page.tsx:53-62` (`role="status" aria-live="polite"` non-blocking notice) + `ScenarioComposer.tsx:2226` existing in-composer `role="status"` | exact |
| **JOURNEY-02** — 4-surface DESIGN.md consistency sweep | component (verify, fix genuine drift only) | request-response (static UI) | `EmptyState.tsx:43-58`, `OnboardingBanner.tsx:39-79`, `ScenarioComposer.tsx:1583-1632` (blank-slate), `discovery/[slug]/page.tsx:41-78` | exact (all 4 already compliant per inventory; composer blank-slate is the only likely touch) |
| **JOURNEY-03** — composer axe e2e spec (NEW: `e2e/<composer>-axe.spec.ts`) | test (e2e/a11y) | request-response → render scan | `e2e/discovery-axe.spec.ts:1-81` (authed-seed + form-login) + `e2e/strategy-v2-axe.spec.ts:39-71` (scroll-each-card-ready before scan) | exact |

---

## Pattern Assignments

### JOURNEY-01 — Bridge → composer continuity (VERIFY the seam; pin with a NON-VACUOUS test; wire at root ONLY if proven dead)

**Role:** test (unit) + component verification · **Data Flow:** event-driven (drawer callback → pure mutator → in-memory draft → projection recompute)

#### The seam (3 layers, all confirmed live)

1. **Drawer affordance** — `BridgeDrawer.tsx:253-283` `handleAddToScenario` (CLIENT-ONLY, no POST; fail-loud `role="alert"` on a synchronous throw, only `onClose()` on success):
```typescript
function handleAddToScenario() {
  if (state.stage !== "confirm" || !selected || !onAddToScenario) return;
  if (!selected.top_candidate_strategy_id) return;
  try {
    onAddToScenario(buildHoldingRef(selected), {
      id: selected.top_candidate_strategy_id,
      name: selected.top_candidate_name,
      markets: [selected.venue],
      strategy_types: [],
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to add to scenario";
    setState((prev) => prev.stage === "confirm" ? { ...prev, error: message } : prev);
    return;
  }
  onClose();
}
```
The "Add to scenario" CTA renders in the confirm stage ONLY when `onAddToScenario` is provided (`BridgeDrawerProps.onAddToScenario` is optional — `BridgeDrawer.tsx:79-96`). CTA copy is **"Add to scenario"** (LOCKED — the code path is named `scenario`; do NOT rename).

2. **Composer handler registration** — `ScenarioComposer.tsx:2329-2348` (the reachability hinge — the ONLY drawer passing `onAddToScenario`):
```typescript
<BridgeDrawer
  isOpen={bridgeOpen}
  onClose={() => setBridgeOpen(false)}
  flaggedHoldings={flaggedHoldings}
  matchDecisionsByHoldingRef={matchDecisionsByHoldingRef}
  onAddToScenario={(holdingScopeRef, candidate) => {
    const id = candidate.id as AddedStrategy["id"];
    scenario.addStrategyBridge(holdingScopeRef, {
      id, name: candidate.name, markets: candidate.markets,
      strategy_types: candidate.strategy_types,
    });
    // UNIFY-04 — lazy-fetch the candidate's returns so the projection MOVES on add.
    if (!strategyById.has(id) && addedReturnsById[id] === undefined) {
      fetchAddedReturns(id);
    }
  }}
/>
```

3. **Pure mutator** — `scenario-state.ts:364-390` `addStrategyBridge` (candidate takes the swapped holding's weight, holding stays enabled, full set renormalizes to 1.0; M9 dedupe → same reference on repeat add):
```typescript
export function addStrategyBridge(draft, holdingScopeRef, strategy) {
  if (draft.addedStrategies.some((s) => s.id === strategy.id)) return draft; // M9 dedupe no-op
  const heldWeight = draft.weightOverrides[holdingScopeRef] ?? 0;
  const preWeights = { ...draft.weightOverrides, [strategy.id]: heldWeight };
  const nextToggle = { ...draft.toggleByScopeRef, [strategy.id]: true };
  const nextEnabled = Object.keys(nextToggle).filter((k) => nextToggle[k] === true);
  const nextWeights = renormalizeWeights(preWeights, nextEnabled);
  return { ...draft, addedStrategies: [...draft.addedStrategies, strategy],
    toggleByScopeRef: nextToggle, weightOverrides: clampAllWeights(nextWeights),
    lastEditedAt: new Date().toISOString() };
}
```

#### Reachability finding (the FLOW-01 / shipped-but-dead check)

- The composer-owned drawer at `ScenarioComposer.tsx:2329` is opened by **`setBridgeOpen(true)`** — the user-reachable trigger is the **"Open Bridge"** button at `ScenarioComposer.tsx:2195-2201` (rendered inside the "Bridge flagged N holdings" panel at `2185-2194`, alongside `ScenarioFlaggedHoldingsList` at `2203`). This panel renders on the live composition body (NOT the empty-state branch), so the seeding drawer **IS reachable** on `/allocations?tab=scenario` when the allocator has flagged holdings.
- **Contrast (the dead path):** `BridgeWidget.tsx` mounts 3 `BridgeDrawer` instances at lines **278 / 317 / 377** — `grep -n "onAddToScenario" BridgeWidget.tsx` returns **0 hits**. Those drawers can `Send intro` but **cannot seed the draft**. This is the structural confirmation of the hinge: only the composer's own drawer carries the callback.
- **Planner contract:** the e2e reachability step must drive the *composer's* "Open Bridge" → confirm → "Add to scenario", NOT a BridgeWidget drawer. If verification shows `flaggedHoldings` never populates on the live tab (so "Open Bridge" never renders), THAT is the dead-seam case → fix the data wiring at root (Rule 6), not a bandaid.

#### Existing test coverage (gap analysis — the proof is "extend to non-vacuous", not "build from scratch")

| Layer | Existing test | Non-vacuous? |
|-------|---------------|--------------|
| Pure mutator | `scenario-state.test.ts:242-254` (`T1.5`) — asserts the exact renormalized weights (`0.6/1.6`, `0.4/1.6`, `0.6/1.6`) + `sumEnabled ≈ 1.0` | **YES** — fails if the weight transform regresses |
| Hook | `useScenarioState.test.tsx:217-236` (`T_USE6`) — `addStrategyBridge` → `draft.addedStrategies` contains the id + localStorage persists | partially — asserts membership, NOT the projection delta |
| Drawer CTA | `BridgeDrawer.test.tsx:486-606` (`T_AS1`–`T_AS6`) — CTA gating, fires once with `(holdingScopeRef, candidate)`, `onClose` once, `sendBridgeIntro` NOT called, Send-intro regression-guard | **YES on the callback contract** — but stops at the callback boundary |

**The gap the JOURNEY-01 proof must close (per CONTEXT.md "fails if the seam is neutered"):** no existing test drives the *integrated* path **CTA click → mutator → projection moves**. The smallest non-vacuous additions:
- **Unit/integration:** extend `useScenarioState.test.tsx` (or a thin ScenarioComposer integration test) to assert that after `addStrategyBridge`, the candidate appears in `draft.addedStrategies` **AND a projection-bearing value changes** (weight present in `draft.weightOverrides` for the candidate id + holding diluted). Mirror the exact-weight assertion style of `scenario-state.test.ts:250-253`.
- **e2e reachability:** a Playwright step (folded into the JOURNEY-03 spec or a sibling) that clicks the live `Open Bridge` (`ScenarioComposer.tsx:2197`) → confirm → "Add to scenario" and asserts the candidate row appears in the composition list. A test that only asserts the callback *type* exists is **vacuous** and fails the gate.

#### Confirmation feedback (NEW, minimal — only if no live toast exists)

**Analog:** `discovery/[slug]/page.tsx:53-62` — the canonical non-blocking transient notice:
```tsx
<div role="status" aria-live="polite"
  className="mb-6 rounded-lg border border-border bg-card px-4 py-3 text-sm text-text-secondary">
  Watchlist temporarily unavailable — your starred strategies may not appear. Refresh to retry.
</div>
```
Copy = **"Added to your portfolio."** · muted/neutral · `role="status" aria-live="polite"` · NOT `role="alert"`, NOT accent-fill, NOT a modal (UI-SPEC §Copywriting). The visible draft change is the load-bearing proof; the toast is reinforcement. There is already an in-composer `role="status"` precedent at `ScenarioComposer.tsx:2226` (Pitfall-4 partial-data banner) to mirror the live-region idiom.

---

### JOURNEY-02 — Entry-point + empty-state DESIGN.md consistency (verify; fix genuine drift only over EXACTLY 4 surfaces)

**Role:** component (verify, surgical fix) · **Data Flow:** request-response (static render)

Target primitives (DESIGN.md): `Card` (8px radius / white `#FFFFFF` / 1px `#E2E8F0`), KpiStrip (Geist Mono tabular-nums), chart-token stack, Instrument-Serif headings / DM-Sans body / Geist-Mono numerics, accent reserved for action/verified only.

| # | Surface | Anchor | Pattern excerpt / verdict |
|---|---------|--------|---------------------------|
| 1 | Allocations empty state | `EmptyState.tsx:43-58` | **Compliant — verify, do not change.** `Card className="text-center py-12"` + `font-serif text-2xl text-text-primary` heading + `text-sm text-text-secondary` sub-line + single `bg-accent ... hover:bg-accent-hover` CTA "Connect Exchange →" → `/profile?tab=exchanges`. Minimalism gate (one headline / one sub-line / one button) intact. Copy LOCKED. |
| 2 | Onboarding banner | `OnboardingBanner.tsx:39-79` | **Compliant — verify, do not change.** `<WarningBanner className="border-l-4 border-warning bg-warning/5">`, `<h2 className="text-lg font-semibold text-text-primary">` (deliberate level per the inline 1.3.1 note at `:43-51`), accent CTA, dismiss `aria-label="Dismiss for this session"`. Do NOT promote to accent or to a `Card`. |
| 3 | Composer blank-slate front door | `ScenarioComposer.tsx:1583-1632` | **The only likely touch — but already built in Phase 29.** Card shell `rounded-lg border border-border bg-surface p-12 text-center` + serif `text-2xl` "Start a portfolio" + dual CTA (`bg-accent` "Connect Exchange →" / `border border-border` "Browse strategies") + `StrategyBrowseDrawer`. Verify it renders + reachable; close any RESIDUAL drift with existing primitives only (e.g. add a `focus-visible:ring-accent/50` to the two CTAs if missing — note the empty-state CTAs at `:1604/1611` use `hover:` only, while `OnboardingBanner.tsx:65` already carries the focus ring; this is the one plausible surgical fix). NO new component family. Copy LOCKED. |
| 4 | Discovery slug page | `discovery/[slug]/page.tsx:41-78` | **Compliant — verify, do not change.** `Breadcrumb` / `PageHeader` / `InfoBanner` / `StrategyTable`; watchlist-failure `role="status"` notice (`:53-62`). |

**Rule-3 surgical guard:** do NOT "improve" the 3 compliant surfaces. Keep all LOCKED copy byte-identical (`"Connect Exchange →"`, `"Start a portfolio"`, the PROJECTED pill, methodology caveats).

---

### JOURNEY-03 — WCAG-AA accessibility (a VERIFICATION spec via the EXISTING harness — extend, do not duplicate)

**Role:** test (e2e/a11y) · **Data Flow:** request-response → full-page axe scan · **New file:** `e2e/<composer>-axe.spec.ts` (name at Claude's discretion; e.g. `composer-axe.spec.ts`)

**Harness (reuse verbatim, zero new dependency):** `e2e/helpers/axe.ts:15-21` `buildAxe(page)` is already configured `withTags(["wcag2a","wcag2aa","best-practice"])`. Do NOT add jest-axe or a second harness.

**Authed-seed + form-login pattern** — copy from `discovery-axe.spec.ts:30-66` verbatim:
```typescript
import { test, expect } from "@playwright/test";
import { buildAxe } from "./helpers/axe";
import { seedTestAllocator } from "./helpers/seed-test-project";

const HAS_SEED_ENV =
  !!process.env.TEST_SUPABASE_URL && !!process.env.TEST_SUPABASE_SERVICE_ROLE_KEY;

async function loginViaForm(page, email, password) {
  await page.goto("/login");
  await page.fill('input[name="email"], input[placeholder*="email" i]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button:has-text("Sign in")');
  await page.waitForURL(/\/(discovery|strategies|allocations|dashboard)/, { timeout: 10000 });
}
// test.skip(!HAS_SEED_ENV, ...) — false-green guard (Grok W-02); mirror the skip string idiom
```
`seedTestAllocator()` (`seed-test-project.ts:75-166`) stamps a **verified `allocator` profile** (`allocator_status/manager_status: "verified"`, clears the `/pending-approval` gate) AND an `investor_attestations` row — exactly the session the composer route needs. Returns `{ userId, email, password }`.

**Scroll-each-card-ready-before-scan pattern** — adapt from `strategy-v2-axe.spec.ts:50-69` (the composer's Phase-30 graph cards must be mounted before the scan, or axe false-greens on an empty `<main>`):
```typescript
// navigate to the unified composer
await page.goto("/allocations?tab=scenario");
await page.waitForLoadState("networkidle");
// W-02 sanity gate: a heading must be visible (NOT a 404/empty <main>)
await expect(page.locator("h2", { hasText: "Portfolio" }).first()).toBeVisible({ timeout: 5_000 });
// ensure the Phase-30 graph cards rendered before scanning
await page.locator('[data-panel="blend-returns-distribution"]').scrollIntoViewIfNeeded();
await expect(page.locator('[data-panel="blend-returns-distribution"]')).toBeVisible({ timeout: 10_000 });
await page.locator('[data-panel="blend-rolling"]').scrollIntoViewIfNeeded();
await expect(page.locator('[data-panel="blend-rolling"]')).toBeVisible({ timeout: 10_000 });
const results = await buildAxe(page).analyze();
expect(results.violations).toEqual([]);
```

**Surface under test:** `/allocations?tab=scenario` INCLUDING the Phase-30 cards. **Extend, do not duplicate** — the standalone charts already have coverage in `strategy-v2-axe.spec.ts`. The composer cards carry stable selectors:
- Returns-distribution `Card` — `ScenarioComposer.tsx:2076`: `data-panel="blend-returns-distribution" aria-label="Returns distribution"`
- Rolling-metrics `Card` — `ScenarioComposer.tsx:2126`: `data-panel="blend-rolling" aria-label="Rolling metrics"`
- Sub-charts use `<h3>` under section `<h2>` (`:2097/2103/2150/2165/2171` — heading order intact for 1.3.1)
- Entry-mode `role="radiogroup" aria-label="Composition entry mode"` (`:1665-1666`)

**Gate:** `expect(results.violations).toEqual([])` (AA, zero-violations — matches both existing specs). Any real violation is fixed at ROOT (semantic HTML / labels / contrast), **NEVER** `.disableRules` / `.exclude`.

---

## Shared Patterns

### Authed e2e (seed → form-login → navigate → sanity-gate → scan)
**Source:** `e2e/discovery-axe.spec.ts:30-79` + `e2e/helpers/seed-test-project.ts:75-166`
**Apply to:** JOURNEY-03 composer-axe spec; the JOURNEY-01 e2e reachability step (same login + seed).
Pattern: `seedTestAllocator()` → `loginViaForm()` → `page.goto(route)` → wait for a visible heading (W-02 false-green guard) → `buildAxe(page).analyze()` → `expect(results.violations).toEqual([])`. `test.skip(!HAS_SEED_ENV, ...)` keeps the spec authored-but-not-CI-blocking until seed env vars are wired.

### Non-blocking live-region (transient confirmation / soft-failure)
**Source:** `discovery/[slug]/page.tsx:53-62`, `ScenarioComposer.tsx:2226`
**Apply to:** JOURNEY-01 Bridge-add confirmation ("Added to your portfolio.").
`role="status" aria-live="polite"` + muted/neutral classes (`text-text-secondary` / `text-text-muted`, border-`border`). Reserve `role="alert"` + `--color-negative` for the rare hard-failure path only (`BridgeDrawer.tsx:277-279` already does this synchronously).

### Pure-mutator unit test with exact-value assertions (non-vacuous)
**Source:** `scenario-state.test.ts:242-254`
**Apply to:** JOURNEY-01 proof. Assert the renormalized weights to `toBeCloseTo(..., 9)` and `sumEnabled ≈ 1.0`, not just membership — this is what makes the test fail when the seam/transform is neutered.

### DESIGN.md Card primitive shell
**Source:** `EmptyState.tsx:44` (`<Card>`), `ScenarioComposer.tsx:1589` (`rounded-lg border border-border bg-surface p-12`)
**Apply to:** any JOURNEY-02 residual-gap fix. Reuse `Card` / the existing accent-CTA recipe (`bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover`). Add `focus-visible:ring-2 focus-visible:ring-accent/50` per `OnboardingBanner.tsx:65` if a focus ring is the genuine gap. NO new component family.

---

## No Analog Found

None. Every Phase-33 work item maps to a shipped analog. This is the expected outcome for a polish/verification phase — the risk is sprawl, not unknowns.

---

## Metadata

**Analog search scope:** `src/app/(dashboard)/allocations/` (composer, BridgeDrawer, scenario-state, EmptyState, OnboardingBanner), `src/app/(dashboard)/discovery/[slug]/`, `e2e/` (axe specs + helpers), `tests/`, `src/components/charts/`.
**Files scanned:** ~14 (5 anchor source files + 3 test files + 2 e2e specs + 1 helper + 1 seed helper + DESIGN.md + 2 context docs).
**Pattern extraction date:** 2026-06-23
**Frozen-spine guard:** `src/lib/scenario.ts` / `scenario.test.ts` MUST stay zero-diff (SCENARIO-05). The mutator edited above is `scenario-state.ts` (the draft module, NOT the frozen engine) — and JOURNEY-01 only ADDS a test, it does not edit `addStrategyBridge`. IMPACT-02 PROJECTED-pill + RLS / share-RPC guards unchanged.
