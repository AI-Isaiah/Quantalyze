# Phase 43: Edge states, toggle fold & guards - Research

**Researched:** 2026-06-26
**Domain:** React/Next.js factsheet-shaped layout fold + permanent regression guards (byte-identity, WCAG-AA axe, no-state-bleed); milestone-closing phase
**Confidence:** HIGH (all claims grounded in direct file:line reads of the live codebase on branch `feat/v1.2.1-phase36-repoint`)

## Summary

Phase 43 is a **fold + guards** phase, not a feature build. The factsheet body already mounts (`ScenarioFactsheetChart.tsx` → real `FactsheetBody`, Phase 40); the Diversification/Peer/Mandate/OwnBookDelta sections already render (Phases 41/42). GUARD-01 repositions the three EXISTING compose toggles so compose+read sit on one surface, and lands the accumulated P40/P41/P42 UI-review polish (all advisory, 0 blockers). GUARD-02/03/04 install the three PERMANENT regression gates.

The decisive constraint is that **nothing here may break byte-identity** of the real `/factsheet/[id]/v2` route or the Overview `EquityChartWidget`. Every GUARD-01 polish fix is either additive (a new `scenarioMode`-gated branch defaulting false) or a pure token-class swap inside the already-additive scenario sections. The static source guard (`ScenarioComposer.tsx` must contain the literal `FactsheetBody` zero times — the mount lives EXCLUSIVELY in `ScenarioFactsheetChart.tsx`) and the FROZEN `scenario.ts` engine bound the solution space.

**Primary recommendation:** GUARD-01 = reposition (not redesign) the Data-sources toggle + Strategies/Browse controls into factsheet-shaped `CollapsibleSection` containers adjacent to the body mount, apply the 5 polish one-liners verbatim, and pin all four behaviors with the test matrix in `## Validation Architecture`. Promote the existing per-phase `FactsheetBody.scenario-mode.test.tsx` into the permanent GUARD-02 gate (add the Overview-untouched assertion). Extend `composer-axe.spec.ts` in place (already CI-wired — verify-only, no FLOW-01 re-add). GUARD-04 = a vitest test asserting no `localStorage.setItem`/`history.replaceState` under `persist={false}`.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Compose-toggle fold (GUARD-01) | Browser / Client (`ScenarioComposer.tsx` "use client") | — | Pure JSX repositioning of existing client controls; no server/data change |
| Polish carry-forwards | Browser / Client (factsheet-v2 `FactsheetView.tsx` + `MandatePanels.tsx`, composer `ScenarioComposer.tsx`) | — | Token-class + conditional-render edits; CSS resolved client-side via `@theme inline` |
| Byte-identity gate (GUARD-02) | Test (vitest jsdom) | — | Structural innerHTML equality assertion; no runtime tier |
| WCAG-AA axe (GUARD-03) | Test (Playwright e2e, real Chromium) | — | Needs a real rendered DOM + seeded session; axe-core scan |
| No-state-bleed (GUARD-04) | Test (vitest jsdom) + Browser persist gate (`factsheet-context.tsx`) | — | Spy on `localStorage.setItem`/`history.replaceState` under the existing `persist` gate |

## Standard Stack

This phase installs **NO new packages**. Every tool is already in the repo.

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@playwright/test` | repo-pinned | GUARD-03 axe e2e (`composer-axe.spec.ts`) | Already the e2e harness; spec already CI-wired |
| `axe-core` (via `./e2e/helpers/axe` `buildAxe`) | repo-pinned | WCAG-AA scan, `withTags(["wcag2a","wcag2aa","best-practice"])` | The single existing axe harness — reuse verbatim, no `jest-axe` |
| `vitest` + `@testing-library/react` | repo-pinned | GUARD-02 innerHTML equality, GUARD-04 spy tests | The unit/component harness; coverage ratchet runs through it |
| `@vitest/coverage-v8` | repo-pinned | coverage ratchet (lines 82 / fns 74 / branches 72) | CLAUDE.md gate; CI `frontend-coverage` job |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `CollapsibleSection` (`@/components/ui/CollapsibleSection`) | local | factsheet-shaped collapsible container for the folded toggles | GUARD-01 container — already used for Diversification + Strategies/weights |

**Installation:** none. **Package Legitimacy Audit:** N/A — zero external packages installed this phase.

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| GUARD-01 | Fold the 3 compose toggles (Phase-37 per-source, v1.2 Browse-catalog add, scenario include/exclude) into the factsheet-shaped layout + land P40/41/42 polish + close the degenerate-matrix cross-check | §must-answer 1, 2, 6 — exact line refs + one-line fixes below |
| GUARD-02 | Permanent byte-identity gate: real route + Overview never regress at `scenarioMode={false}` | §must-answer 3 — promote `FactsheetBody.scenario-mode.test.tsx` |
| GUARD-03 | Extend composer WCAG-AA axe over the new body; coverage ratchet stays green | §must-answer 4 — extend `composer-axe.spec.ts` (already CI-wired) |
| GUARD-04 | Mounting the body re-introduces no persist/storageKey cross-tab bleed (Phase-38 RT2 class) | §must-answer 5 — `persist={false}` no-write spy test |

---

## Architecture Patterns

### System Architecture: the one composed surface (DOM order, live line refs)

`ScenarioComposer.tsx` top-level render (composed branch, after `isEmptyState` early-return ~:1583) flows top-to-bottom:

```
PROJECTED honesty pill          ScenarioComposer.tsx:2097   (IMPACT-01, unconditional)
  ↓
coverage caveat (n / shortest)  :2281
  ↓
[TOGGLE 1] Data sources         :2339  showDataSources && <div role="group" aria-label="Data sources">
   data-source switches (per api_key)   :2365  role="switch"
  ↓
data-sources fallback / all-excluded empty  :2395 / :2423
  ↓
========  BODY MOUNT  ========  :2464  <ScenarioFactsheetChart …>   (mount lives in ScenarioFactsheetChart.tsx,
   (real FactsheetBody under ONE          which imports FactsheetBody from FactsheetView.tsx:11 — the ONLY
    <FactsheetProvider persist={false}>)   file that may contain the FactsheetBody literal — static guard)
  ↓
Diversification CollapsibleSection :2601  (CORR-01..06; storageKey OMITTED on purpose :2595)
   too-similar badge  :2620   |   PCR risk-reducing tag  :2742
  ↓
Phase-30 cards: blend-returns-distribution :2785, blend-rolling :2835  (STILL PRESENT — NOT replaced)
  ↓
[TOGGLE 3] Strategies & weights  :2962  <CollapsibleSection storageKey="composer-collapse:controls">
   <CompositionList onToggle={scenario.toggleHolding}>  → the scenario include/exclude switches (:3238 role="switch")
  ↓
"Add more strategies" card       :2988  → [TOGGLE 2] Browse → <StrategyBrowseDrawer> :3025
```

**The three compose toggles (GUARD-01 fold targets):**
1. **Phase-37 per-data-source include/exclude** — `ScenarioComposer.tsx:2339–2393` (`showDataSources` block, `role="group"` / per-key `role="switch"` at :2365). Lives ABOVE the body mount.
2. **v1.2 Browse-catalog add** — the "Browse strategies" CTA + `StrategyBrowseDrawer` at :2068/:2075 (empty-state) and :2996/:3025 (composed). Lives BELOW the body mount.
3. **Scenario composition include/exclude** — the `CompositionList` toggles (`onToggle={scenario.toggleHolding}`, switches at :3238) inside the "Strategies & weights" `CollapsibleSection` at :2962. Lives BELOW the body mount.

### Pattern 1: Factsheet-shaped fold via `CollapsibleSection` (NOT a FactsheetBody literal in the composer)
**What:** Wrap each repositioned toggle group in the same `CollapsibleSection` the Diversification (:2601) and Strategies-&-weights (:2962) sections already use, so they read as factsheet editorial sections, NOT composer chrome.
**When to use:** GUARD-01 fold — reuse the existing controls verbatim; only the container + DOM position change.
**Recommendation:** Keep the **body mount in `ScenarioFactsheetChart.tsx`** (the static guard: `ScenarioComposer.tsx` must contain `FactsheetBody` zero times — see `ScenarioFactsheetChart.tsx:51–53`). Fold the toggles by repositioning them into factsheet-shaped `CollapsibleSection` wrappers in `ScenarioComposer.tsx` adjacent to the `<ScenarioFactsheetChart/>` mount — do NOT push the toggles down into `ScenarioFactsheetChart.tsx` (that file is the body-mount island; threading composer-state toggles into it would couple the chart to the whole composer reducer). A new "Compose controls" `CollapsibleSection` containing the Data-sources group is the right container; the Strategies-&-weights + Browse already are factsheet-shaped — the fold is mostly about co-locating Data-sources with them so all three sit as sibling editorial sections around the body.

### Anti-Patterns to Avoid
- **Putting a `FactsheetBody` literal in `ScenarioComposer.tsx`** — trips the static source guard (`ScenarioFactsheetChart.tsx:51–53`). The mount stays in `ScenarioFactsheetChart.tsx`.
- **Editing `scenario.ts`** — FROZEN (frozen-spine guards phase 29..32 assert zero-diff). The toggles re-blend through the frozen `computeScenario` via the EXISTING `projectionState.selected` / `includeByApiKeyId` channels (Phase-37 wiring); no engine edit.
- **Threading a `scenarioMode` default of `true` anywhere** — every additive prop defaults `false` so the real route stays byte-identical (GUARD-02 pins this).
- **Adding a persisted `storageKey` on the body mount** — Diversification deliberately OMITS `storageKey` (:2595). Any new section must do the same (GUARD-04).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| WCAG-AA scan harness | a new `jest-axe` / second axe config | `buildAxe(page)` from `./e2e/helpers/axe` | Already `withTags(["wcag2a","wcag2aa","best-practice"])`; spec already CI-wired |
| Byte-identity proof | a new snapshot file | promote `FactsheetBody.scenario-mode.test.tsx` (innerHTML equality already written) | The per-phase test already proves default ≡ `scenarioMode={false}`; promote + add Overview assertion |
| persist suppression | a new no-store flag | the existing `persist={false}` gate (`factsheet-context.tsx:177,282`) | The Phase-38 RT2 fix already gates BOTH the write effect and the hydration READ |
| Collapsible section | a bespoke `<details>` | `CollapsibleSection` (`@/components/ui/CollapsibleSection`) | The exact container the factsheet-shaped sections already use |
| Warning/accent tokens | new CSS vars | `--color-warning-bg`/`--color-warning-border`/`--color-accent` (globals.css:56,57,20) | Already declared in `@theme inline` AND have dark-mode overrides (globals.css:453,468) |

**Key insight:** Every primitive this phase needs already exists. GUARD-01..04 are reposition + class-swap + test work, not net-new mechanism.

---

## must_answer (the load-bearing answers)

### 1. GUARD-01 toggle fold — where the toggles live + minimal repositioning

| Toggle | Live location | Relative to body mount (`:2464`) |
|--------|---------------|----------------------------------|
| Phase-37 data-source include/exclude | `ScenarioComposer.tsx:2339–2393` (`showDataSources` `role="group"`; switches :2365) | ABOVE |
| v1.2 Browse-catalog add | `:2068/:2075` (empty-state) + `:2988–:3025` ("Add more strategies" card → `StrategyBrowseDrawer`) | BELOW |
| Scenario composition include/exclude | `CompositionList` switches (:3238) inside "Strategies & weights" `CollapsibleSection` `:2962` (`onToggle={scenario.toggleHolding}`) | BELOW |

**Minimal repositioning (no visual redesign, no FactsheetBody literal in the composer):**
- Wrap the Data-sources `role="group"` block (:2339–2393) in a factsheet-shaped `CollapsibleSection` (title e.g. "Compose controls" / "Data sources") so it sits as a sibling editorial section with Diversification + Strategies-&-weights. **Container choice: a new `CollapsibleSection` is correct** — it matches the Diversification (:2601) / Strategies-&-weights (:2962) precedent and reads as one surface. Do NOT inline it into `ScenarioFactsheetChart.tsx` (that island must stay the pure body mount; coupling composer toggle state into it breaks the static-guard separation and the persist={false} scope boundary).
- The Strategies-&-weights `CollapsibleSection` (:2962) and the Browse card (:2988) are ALREADY factsheet-shaped — the fold is co-locating Data-sources with them around the body so compose+read read as one surface. Keep the existing controls verbatim (reuse, reposition; the DECISIONS section forbids a toggle redesign).
- ⚠️ Static guard holds: `grep -c "FactsheetBody" ScenarioComposer.tsx == 0` must stay true (the mount is `ScenarioFactsheetChart.tsx` only).

### 2. The polish carry-forwards — exact sites + concrete one-line fixes

| # | Carry | File:line | Concrete fix | Byte-identity impact |
|---|-------|-----------|--------------|----------------------|
| P40-W1 | Footer "Page 1 / 1" page-stamp renders on screen in composer | `FactsheetView.tsx:981–983` (the stamp `<p>`), inside `FactsheetFooter` (`:968`) | Thread `scenarioMode` into `FactsheetFooter` (currently `function FactsheetFooter({ payload })` — call site is `FactsheetBody:291` which HAS `scenarioMode`). Add `scenarioMode?: boolean` param; wrap the `Page 1 / 1` `<p>` in `{!scenarioMode && (…)}`. Keep the disclaimer `<p>` (:972) unconditional. | **Additive, default false → byte-identical.** GUARD-02 pins it. |
| P40-W2 | Compound vertical padding at mount seam | `FactsheetBody` article `py-6 sm:py-10 lg:py-12` (`FactsheetView.tsx:192`) + composer mount `mt-6` (`ScenarioComposer.tsx:2459`) | Compensate at the COMPOSER side only (never churn the factsheet article class — that would break byte-identity). Reduce/negate the composer wrapper margin (`-mt-` compensator on the `<div className="relative mt-6">` at :2459) so the seam reads single-padded. | Composer-side only → factsheet untouched. |
| P40-NIT | `border-t border-text` footer divider → near-black in light mode | `FactsheetView.tsx:971` (footer) + `:420` (header `border-b border-text`) | Either formalize `--color-text` `@theme` token OR repoint to `border-border`. ⚠️ This is a PRE-EXISTING factsheet class — repointing it changes the REAL route's rendered HTML and would BREAK byte-identity. **Recommend: do NOT repoint the live factsheet divider; instead formalize `--color-text`/`--color-text-2` `@theme inline` tokens (light-mode entries) so the existing class resolves correctly in BOTH modes without changing the class string.** (See P42-token row.) |
| P41-M | Diversification too-similar badge hardcoded hex | `ScenarioComposer.tsx:2620` (`bg-[#FEF3C7] border-[#FDE68A]`) | → `bg-warning-bg border-warning-border` (tokens exist: globals.css:56,57 + dark override :453). Inside the additive scenario section → no byte-identity impact. |
| P41-L | "risk-reducing" PCR tag uses P&L green | `ScenarioComposer.tsx:2744` (`bg-positive/10 … text-positive`) | → `bg-accent/10 text-accent` (token globals.css:20 + dark override :468). Additive section → no impact. |
| P42-W | Leverage chip renders "1×" unconditionally | `MandatePanels.tsx:191–192` (`<Chip>{formatLeverage(c.leverage)}×</Chip>`) | Guard: `{c.leverage > 1 && (<div className="flex flex-wrap gap-1"><Chip>{formatLeverage(c.leverage)}×</Chip></div>)}`. `MandatePanels` renders only in `scenarioMode` (Phase-42 per-constituent chips) → additive surface; verify it's not on the real route (it is the scenario blend's mandate panel). |
| P42-token | `border-text`/`text-text-2` lack `@theme inline` light-mode tokens (render via dark-mode overrides) | globals.css `@theme inline` (`:3`) — `--color-text` / `--color-text-2` ABSENT (only `--color-text-primary/secondary/muted` exist :13,14,18) | Add `--color-text` / `--color-text-2` light-mode entries to `@theme inline` so `border-text`/`text-text-2` (used at FactsheetView.tsx:420,447,826 etc.) resolve in light mode WITHOUT changing any class string → preserves byte-identity (same classes, now correctly-resolving CSS). |
| P42-W3 / h3 type contract | new sections' h3 at `text-[13px] tracking-wider` vs v2 contract `text-[12px] tracking-[0.18em]` | v2 contract reference: `FactsheetView.tsx:385` (`text-[12px] … tracking-[0.18em]`). Normalize the NEW factsheet-shaped composer sections (Diversification heading etc. in `ScenarioComposer.tsx`) to `text-[12px] tracking-[0.18em]` | Composer-side new sections only — do NOT churn pre-existing factsheet h3s. |

**Footer scenarioMode-gate is additive (confirmed):** `FactsheetFooter` is reached only via `FactsheetBody:291` `{!hideFooter && <FactsheetFooter payload={payload} />}`. Threading `scenarioMode` (default false) and gating only the `Page 1 / 1` `<p>` means every existing call site (page.tsx, Discovery, Overview EquityChartWidget — none pass `scenarioMode`) renders identical HTML. GUARD-02 pins exactly this.

### 3. GUARD-02 permanent byte-identity — exact test + location

**An existing per-phase test already does the core proof:** `src/app/factsheet/[id]/v2/FactsheetBody.scenario-mode.test.tsx` renders `FactsheetBody` with DEFAULT props and asserts **innerHTML equality** to `scenarioMode={false}` on a ~300-point populated payload (its header comment, lines 8–22, states exactly this). It also stubs `localStorage`/`sentry` (the `FactsheetProvider` persist primitive touches them on mount even at `persist={false}`).

**GUARD-02 = promote this into the permanent milestone-closing gate** by ADDING (not replacing) two assertions so it also covers the P40/P41/P42 polish surface:
1. **Default ≡ `scenarioMode={false}` innerHTML equality** on a populated payload — already present; keep. After the footer gate lands, this also proves the `Page 1 / 1` stamp is present at default/false (the gate only hides it at `scenarioMode={true}`).
2. **Overview `EquityChartWidget` path untouched** — assert the Overview widget renders the LEGACY `EquityChart` (not the factsheet body). This is best done as a structural assertion in the Overview/AllocationDashboardV2 test surface that the Overview EquityChartWidget does not import/mount `FactsheetBody` (it stays on the legacy render per STATE.md 38-03). A lightweight permanent assertion: `grep`/import-shape test that the Overview widget module does not reference `FactsheetBody`, OR a render test asserting the Overview equity widget renders its legacy `data-testid` and NOT the factsheet article id `#factsheet-main`.

**Location:** keep it at `src/app/factsheet/[id]/v2/FactsheetBody.scenario-mode.test.tsx` and rename/retag its describe block to mark it the PERMANENT GUARD-02 gate (so a future reader knows it is not a disposable per-phase test). The per-phase byte-identity tests from P40 ARE this file — **promote it, do not create a parallel test.** Add a one-line header note: "PERMANENT (GUARD-02) — pins the real /factsheet/[id]/v2 route byte-identical at scenarioMode default; do not delete at milestone close."

### 4. GUARD-03 axe e2e — structure + what to add

**Structure of `e2e/composer-axe.spec.ts` (full read, 148 lines):**
- Seed gating: `const HAS_SEED_ENV = !!process.env.TEST_SUPABASE_URL && !!process.env.TEST_SUPABASE_SERVICE_ROLE_KEY` (:42). `test.skip(!HAS_SEED_ENV, …)` (:61) — authored-but-skipped pattern (matches discovery-axe / strategy-v2-axe).
- Harness: `buildAxe(page)` from `./helpers/axe`, `withTags(["wcag2a","wcag2aa","best-practice"])` (verbatim, no new dep).
- Flow: `seedStrategyWithHistory({days:400})` → `seedTestAllocator()` → `loginViaForm` → goto `/allocations?tab=scenario` → **Scan 1** blank-slate (gated on `h2 "Start a portfolio"` visible) → drive into composed mode (Browse → add first → close drawer) → **Scan 2** composed (gated on `h2 "Portfolio"` + BOTH `[data-panel="blend-returns-distribution"]` and `[data-panel="blend-rolling"]` visible) → `expect(violations).toEqual([])`.
- The two `data-panel` anchors STILL EXIST in `ScenarioComposer.tsx` (:2785, :2835 — Phase-30 cards were NOT removed; the factsheet body was ADDED at :2464 alongside them). So the existing visible-anchor gates still hold.

**What to ADD for GUARD-03 (cover the new factsheet body + new sections):**
- In Scan 2 (composed surface), before `analyze()`, add visible-anchor gates for the new surface so axe can't false-green on a body that failed to mount:
  - the factsheet body article: `[id="factsheet-main"]` (FactsheetView.tsx:188) — proves the real `FactsheetBody` mounted.
  - the Diversification section heading (`CollapsibleSection` title "Diversification", :2603).
  - the Mandate / Peer / OwnBookDelta sections (per-constituent chips; gate on a stable testid or section heading) — only assert visibility of whichever render for a single-strategy seeded blend; for sections that honestly empty out at n=1, gate on their honest-empty copy instead (the spec already uses this "either real OR honest-empty banner is a real surface" idiom, :124–130).
- The existing single `analyze()` over the whole composed `<main>` already covers any newly-mounted DOM — the additive work is the **visible-anchor gates** (defense against false-green if the body fails to mount), NOT a second axe call.

**CI wiring (VERIFY-ONLY — confirmed):** `e2e/composer-axe.spec.ts` IS in `.github/workflows/ci.yml` at line **1261** (in the seeded-playwright `npx playwright test` list, :1252–1261). **FLOW-01 does NOT apply** (GUARD-03 extends an existing, already-listed, already-HAS_SEED_ENV-gated spec — no new spec, no new HAS_SEED_ENV const, no ci.yml add). Confirmed: do NOT re-add.

### 5. GUARD-04 cross-tab bleed — exact test + persist gate

**Persist gate location:** `src/app/factsheet/[id]/v2/factsheet-context.tsx`:
- `persist = true` default (`:177`), prop declared `:195`.
- Write half: the debounced effect's early-return is gated by `|| !persist` (per STATE.md 38-02) → no `history.replaceState` URL `?range=` rewrite, no `factsheet-v2:` localStorage blob.
- Read half (RT2 fix, :273–282): `if (!persist) return;` — under `persist={false}` it does NOT hydrate from the shared URL/localStorage (this is the Phase-38 RT2 fix preventing Overview factsheet `?range/?cmp/?dark` bleeding cross-tab via the shared `/allocations` URL).
- The composer mount passes `persist={false}` (`ScenarioFactsheetChart.tsx`, the `<FactsheetProvider persist={false}>`).

**Exact GUARD-04 test (vitest jsdom):**
- Mount `<FactsheetProvider persist={false}><FactsheetBody payload scenarioMode … /></FactsheetProvider>` plus the new composer sections (or mount via `ScenarioFactsheetChart` + the folded sections).
- Spy: `vi.spyOn(window.localStorage, "setItem")` and `vi.spyOn(window.history, "replaceState")`.
- Simulate an interaction that WOULD persist on the real route (e.g. a PeriodControl/brush range change that drives `setXRange`), then `expect(setItem).not.toHaveBeenCalledWith(/^factsheet-v2/, …)` and `expect(replaceState).not.toHaveBeenCalledWith(…, …, /\?(range|cmp|dark)/)`.
- Assert NO `?range/?cmp/?dark` URL mutation and NO `factsheet-v2:` localStorage write (the Phase-38 RT2 class).
- ⚠️ Note the existing `scenario-mode` test already stubs localStorage because the persist primitive registers on mount even at `persist={false}` — reuse that stub block (it explicitly notes "even at persist={false}, the hook still registers"). The GUARD-04 assertion is specifically that no WRITE with the factsheet keyspace fires.

**One real GUARD-04 risk to flag:** `ScenarioComposer.tsx:2966` declares `storageKey="composer-collapse:controls"` on the Strategies-&-weights `CollapsibleSection`. This is a DELIBERATE, composer-namespaced UI-pref key (distinct from the factsheet `factsheet-v2:` / `factsheet-collapse:` namespace, per the :2959 comment) — it persists the collapse choice, NOT factsheet view-state, and does NOT bleed cross-tab onto the dashboard URL. **GUARD-04's scope is the factsheet body's persist path (the RT2 class), not composer-owned collapse prefs.** The plan must confirm the fold does NOT add a NEW `factsheet-*`-namespaced or URL-writing key on the composed surface; the `composer-collapse:controls` key is in-scope-acceptable (it's the established composer pattern, Diversification deliberately omits its own storageKey at :2595). Document this distinction so the guard test doesn't over-reach and flag the legitimate composer-collapse key.

### 6. Degenerate matrix — already honest? gaps to close

**Already handled per-phase (HIGH confidence, from `FactsheetBody.degenerate.test.tsx` header + REQUIREMENTS):**
- `FactsheetBody.degenerate.test.tsx` exercises: safe-empty (`portfolioDaily=[]` → arrays [], scalars 0/null), single/sub-N (10 ≤ n < 252 → low-N caveats fire), non-finite (NaN → adapter degenerate gate collapses to safe-empty BEFORE `compute()`). Panels hit `rows.length===0`/`years.length===0` early-return → honest null.
- PAYLOAD-05 (Phase 39): degenerate blends collapse to honest empty/safe values, never NaN/Inf.
- PAYLOAD-04 (Phase 39): `strategyMetrics.n` = TRUE overlapping count → `n<252` caveats fire honestly.
- CORR-03 (Phase 41): per-cell overlap floor → "—"; 0/1-constituent blend → honest empty ("add a second strategy to see diversification").
- PEER-02/03 (Phase 42): `n<252` suppresses peer; live cohort below min-N (~20–30) → honest empty.
- PEER-04 (Phase 42): no constituent metadata → honest empty (`MandatePanels.tsx:201` "No mandate metadata available for this blend's constituents").
- PEER-05: own-book delta — shown alongside; degrades when no live book.

**GUARD-01's edge-state cross-check must close (the closing cross-check, not a re-build):**
1. **No-own-book + present-scenario on the ONE composed surface** — verify the full surface (body + Data-sources fold + Diversification + Peer + Mandate + OwnBookDelta) ALL render their honest empty/safe states SIMULTANEOUSLY on a degenerate blend, not just each panel in isolation (the per-phase tests prove each panel; the cross-check proves the assembled surface). This is the one genuine GUARD-01 gap — an integration render across the degenerate matrix on the folded surface.
2. **Mandate "1×" noise** (P42-W) — currently `MandatePanels.tsx:191` emits a `1×` chip unconditionally; that's a degenerate-honesty gap (leverage-alone isn't metadata). Fix in §2.
3. Confirm the folded Data-sources section honestly disappears (`showDataSources` false) in blank/degenerate mode and the all-excluded empty (:2423) still routes correctly after the fold.

---

## Common Pitfalls

### Pitfall 1: Breaking byte-identity by editing a pre-existing factsheet class
**What goes wrong:** "fixing" the `border-text` footer divider by repointing the class on the REAL `FactsheetView.tsx` changes the live route's rendered HTML → GUARD-02 (and BODY-02 from P40) fails.
**How to avoid:** Fix via `@theme inline` token addition (same class string, correct resolution) — never change a class on a non-additive factsheet element. Composer-side sections may use any class.

### Pitfall 2: The static source guard
**What goes wrong:** Folding the toggles tempts moving the body mount or adding a `FactsheetBody` import into `ScenarioComposer.tsx` → trips `grep -c "FactsheetBody" ScenarioComposer.tsx == 0`.
**How to avoid:** Body mount stays in `ScenarioFactsheetChart.tsx` (the only file with the literal). Fold toggles AROUND `<ScenarioFactsheetChart/>`, not inside it.

### Pitfall 3: FROZEN scenario.ts
**What goes wrong:** A toggle re-blend looks like it needs an engine change.
**How to avoid:** The toggles already re-blend through the frozen `computeScenario` via `projectionState.selected` / `includeByApiKeyId` (Phase-37). The fold is JSX-only; `scenario.ts` is untouched.

### Pitfall 4: FLOW-01 e2e-CI false-confidence
**What goes wrong:** Assuming a new seed-gated e2e must be added to HAS_SEED_ENV + ci.yml.
**How to avoid:** GUARD-03 EXTENDS `composer-axe.spec.ts` which is ALREADY in ci.yml:1261 and already HAS_SEED_ENV-gated. Verify (done), do not re-add. FLOW-01 applies only to NET-NEW seed-gated specs.

### Pitfall 5: GUARD-04 over-reach flagging the legitimate composer-collapse key
**What goes wrong:** A blanket "no localStorage.setItem" assertion fails on the legitimate `composer-collapse:controls` UI-pref key (:2966).
**How to avoid:** Scope the GUARD-04 assertion to the factsheet keyspace (`factsheet-v2:` / `factsheet-collapse:`) + URL `?range/?cmp/?dark` — the RT2 class — not all writes.

## Runtime State Inventory

> This is a code/config + test phase. The only "stored state" surface is browser localStorage / URL query — both are CODE-LEVEL gates, no data migration.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — no DB/datastore touched. The blend never persists (ephemeral). | None — verified: phase is JSX + tests; no migration files. |
| Live service config | None. | None. |
| OS-registered state | None. | None. |
| Secrets/env vars | GUARD-03 reads `TEST_SUPABASE_URL` / `TEST_SUPABASE_SERVICE_ROLE_KEY` (already wired in CI for the existing spec) — no new vars. | None — existing CI env. |
| Build artifacts | None — no package install, no codegen. | None. |
| Browser-persisted state (the relevant axis) | Factsheet view-state (`factsheet-v2:` localStorage + `?range/?cmp/?dark` URL) — already gated by `persist={false}` (factsheet-context.tsx:282). Composer collapse pref `composer-collapse:controls` (:2966) — deliberate, in-scope-acceptable. | GUARD-04 test asserts NO factsheet-keyspace write under `persist={false}`; confirm fold adds no new persisted factsheet/URL key. |

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `vitest` + `@vitest/coverage-v8` | GUARD-02/04 + ratchet | ✓ | repo-pinned | — |
| `@playwright/test` + chromium | GUARD-03 axe e2e | ✓ (CI installs `--with-deps chromium`, ci.yml:1033) | repo-pinned | spec `test.skip`s when seed env absent (no false-green) |
| `axe-core` via `./e2e/helpers/axe` | GUARD-03 | ✓ | repo-pinned | — |
| Seed env (`TEST_SUPABASE_URL`/`_SERVICE_ROLE_KEY`) | GUARD-03 live scan | ✓ in CI | — | local: spec skips (authored-but-skipped) |

**Missing dependencies:** none. No external deps; no install step.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Unit/component | `vitest` + `@testing-library/react` (jsdom) |
| e2e | `@playwright/test` (real chromium) |
| Coverage | `@vitest/coverage-v8`, ratchet lines 82 / fns 74 / branches 72 (CLAUDE.md; CI `frontend-coverage` job) |
| Quick run | `npx vitest run src/app/factsheet/[id]/v2/FactsheetBody.scenario-mode.test.tsx` |
| Full suite | `npm run test:coverage` (then `npx playwright test e2e/composer-axe.spec.ts` with seed env) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| GUARD-01 | Folded toggles render on one surface; degenerate matrix renders honestly across the assembled surface; polish classes applied | component (render + class/text assertions) + static grep | `npx vitest run src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx` | ✅ extend existing |
| GUARD-01 (static guard) | `ScenarioComposer.tsx` contains `FactsheetBody` zero times | static source scan | `grep -c "FactsheetBody" "src/app/(dashboard)/allocations/components/ScenarioComposer.tsx"` → expect 0 | ✅ (assert in a test) |
| GUARD-02 | Default ≡ `scenarioMode={false}` innerHTML equality on populated payload; Overview EquityChartWidget untouched | component (innerHTML equality) | `npx vitest run src/app/factsheet/[id]/v2/FactsheetBody.scenario-mode.test.tsx` | ✅ PROMOTE existing |
| GUARD-03 | Zero axe WCAG-AA serious+critical on blank-slate + composed surface incl. new body/Diversification/Peer/Mandate sections | e2e (Playwright + axe-core) | `npx playwright test e2e/composer-axe.spec.ts` (seed env set) | ✅ EXTEND existing (already ci.yml:1261) |
| GUARD-03 (ratchet) | Coverage stays ≥ lines 82 / fns 74 / branches 72 | coverage gate | `npm run test:coverage` | ✅ CI gate |
| GUARD-04 | No `factsheet-v2:` localStorage write / no `?range/?cmp/?dark` URL mutation under `persist={false}` | component (spy on setItem / replaceState) | `npx vitest run src/app/factsheet/[id]/v2/FactsheetBody.scenario-mode.test.tsx` (or new GUARD-04 test) | ⚠️ Wave 0 — new spy test (reuse the scenario-mode localStorage stub block) |

### Sampling Rate
- **Per task commit:** the touched file's vitest (`npx vitest run <file>`).
- **Per wave merge:** `npm run test:coverage` (ratchet) + `npx playwright test e2e/composer-axe.spec.ts` if seed env.
- **Phase gate:** full suite green + axe zero serious/critical before `/gsd:verify-work`.

### Wave 0 Gaps
- [ ] GUARD-04 spy test — assert no factsheet-keyspace localStorage write / no `?range/?cmp/?dark` URL mutation under `persist={false}` (reuse the `FactsheetBody.scenario-mode.test.tsx` localStorage stub block).
- [ ] GUARD-02 Overview-untouched assertion — add to `FactsheetBody.scenario-mode.test.tsx` (or the Overview test surface): Overview EquityChartWidget renders legacy `EquityChart`, NOT `#factsheet-main`.
- [ ] GUARD-01 static-guard assertion — a test (or CI grep step) asserting `grep -c "FactsheetBody" ScenarioComposer.tsx == 0`.
- [ ] GUARD-01 degenerate-matrix cross-check — integration render across the assembled folded surface (no-own-book / 0-1 constituent / n<10 / n<252 / no-mandate) asserting honest empty states co-exist.
- [ ] GUARD-03 extension — add visible-anchor gates for `#factsheet-main` + Diversification/Peer/Mandate sections in `composer-axe.spec.ts` Scan 2 before `analyze()`.

## Security Domain

> `security_enforcement` defaults enabled. This phase is client-side JSX + tests with NO new data path, NO new endpoint, NO auth/session change.

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | No auth change; GUARD-03 reuses the existing seed/login flow |
| V3 Session Management | no | — |
| V4 Access Control | no | The blend is ephemeral, allocator-scoped; no new read/write |
| V5 Input Validation | no | No new user input surface (toggles reuse existing validated channels) |
| V6 Cryptography | no | — |

### Known Threat Patterns
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Cross-tab view-state bleed (the Phase-38 RT2 class) | Information Disclosure | `persist={false}` gate (factsheet-context.tsx:282) + GUARD-04 test — the one security-adjacent concern, and it is the explicit GUARD-04 mitigation |
| Synthetic-panel leak (demo allocator portfolios / event signatures) | Information Disclosure | `ingestSource` stays `"csv"` (never flipped to `"api"`) — BODY-04/PEER-01 invariant; unchanged this phase |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Repointing `border-text`/`text-text-2` on the LIVE factsheet would break byte-identity; therefore prefer adding `@theme` tokens over repointing the class | §2 P40-NIT / P42-token | If the planner instead repoints classes on a real-route element, GUARD-02/BODY-02 fails. (Mitigated: the recommendation is token-add, which is byte-safe.) |
| A2 | The exact composer mount margin line for the P40-W2 seam fix is `ScenarioComposer.tsx:2459` (`<div className="relative mt-6">`) — line numbers shift with edits | §2 P40-W2 | Wrong line → planner must re-grep `relative mt-6` near the `<ScenarioFactsheetChart` call. Low risk (grep-locatable). |

**Note:** All other claims are VERIFIED via direct file:line reads this session. No external packages, no registry claims — Package Legitimacy Audit is N/A.

## Open Questions

1. **Mandate/Peer/OwnBookDelta visibility on a single-strategy seeded blend (GUARD-03 anchor choice)**
   - What we know: a single seeded strategy may render honest-empty Diversification/Mandate (n<2 / no metadata).
   - What's unclear: which of the new sections render real vs honest-empty in the CI seed env.
   - Recommendation: gate GUARD-03 anchors on "section present (real OR honest-empty banner)" — the spec already uses this idiom (:124–130); do not require non-degenerate bodies.

2. **GUARD-02 Overview-untouched assertion shape (grep-style import test vs render test)**
   - What we know: Overview EquityChartWidget stays on legacy `EquityChart` (STATE.md 38-03); Overview tests MOCK FactsheetBody.
   - Recommendation: a structural assertion that the Overview widget module does not reference `FactsheetBody` (import-shape) is the lowest-coupling permanent guard; a render-test alternative asserts the Overview equity widget renders its legacy testid and NOT `#factsheet-main`.

## Sources

### Primary (HIGH confidence — direct file reads this session)
- `.planning/phases/43-edge-states-toggle-fold-guards/43-CONTEXT.md` — locked decisions + carry-forward list
- `.planning/REQUIREMENTS.md` — GUARD-01..04 + out-of-scope invariants
- `.planning/STATE.md` — P40/41/42 UI-review carry-forward sections (W1/W2/M/L/W line refs) + Phase 37/38 decision log
- `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx` — toggle sites (2339/2962/2988), badge hex (2620), risk-reducing tag (2744), body mount (2464), storageKey (2966), Phase-30 cards (2785/2835)
- `src/app/(dashboard)/allocations/widgets/performance/ScenarioFactsheetChart.tsx` — the body-mount island + static-guard note (51–53), FactsheetBody import (11)
- `src/app/factsheet/[id]/v2/FactsheetView.tsx` — FactsheetBody (163) + options (135–152), FactsheetFooter (968) + page-stamp (981), article padding (192), border-text (420/971), h3 contract (385)
- `src/app/factsheet/[id]/v2/MandatePanels.tsx` — leverage chip (191), honest-empty (201)
- `src/app/factsheet/[id]/v2/factsheet-context.tsx` — persist gate (177/195/282)
- `src/app/factsheet/[id]/v2/FactsheetBody.scenario-mode.test.tsx` — existing per-phase byte-identity proof (innerHTML equality) → GUARD-02 promotion target
- `src/app/factsheet/[id]/v2/FactsheetBody.degenerate.test.tsx` — degenerate matrix coverage header
- `e2e/composer-axe.spec.ts` — full structure (HAS_SEED_ENV:42, skip:61, buildAxe, two scans, data-panel anchors)
- `.github/workflows/ci.yml` — composer-axe.spec.ts in seeded playwright list (line 1261); chromium install (1033)
- `src/app/globals.css` — `@theme inline` (3); `--color-accent` (20), `--color-warning-bg` (56), `--color-warning-border` (57); dark overrides (453/468); ABSENCE of `--color-text`/`--color-text-2`
- `DESIGN.md` — warning-token AA history (236), `--color-*` prefix convention (243)
- `CLAUDE.md` — coverage ratchet (lines 82 / fns 74 / branches 72), blocking CI gate

## Metadata

**Confidence breakdown:**
- Toggle fold mechanics (GUARD-01): HIGH — exact line refs read; render order mapped end-to-end.
- Polish carry-forwards: HIGH — every site read at file:line; fixes are one-liners with verified tokens.
- GUARD-02/03/04 test design: HIGH — existing tests + persist gate + ci.yml line all read directly.
- Degenerate-matrix completeness: MEDIUM-HIGH — per-phase coverage confirmed via test headers; the one genuine gap (assembled-surface cross-check) is identified.

**Research date:** 2026-06-26
**Valid until:** ~2026-07-26 (stable; line numbers shift with edits — re-grep anchors if the composer is touched before planning).

## RESEARCH COMPLETE

Phase 43 is a fold-and-guards closing phase with zero new packages and zero engine change: the factsheet body already mounts in `ScenarioFactsheetChart.tsx` (the ONLY file allowed the `FactsheetBody` literal — static guard) and the Diversification/Peer/Mandate sections already render, so GUARD-01 reduces to repositioning the three existing compose toggles (Phase-37 Data-sources at ScenarioComposer.tsx:2339, Browse at :2988/:3025, scenario include/exclude via CompositionList at :2962) into factsheet-shaped `CollapsibleSection` siblings around the body mount (:2464) plus seven verbatim polish one-liners — the footer `Page 1 / 1` stamp scenarioMode-gated additively in `FactsheetFooter` (FactsheetView.tsx:981, default false → byte-identical), the badge hex→`bg-warning-bg border-warning-border` (:2620), the risk-reducing tag→`bg-accent/10 text-accent` (:2744), the `1×` leverage guard (`MandatePanels.tsx:191`), and `--color-text`/`--color-text-2` `@theme` token formalization (rather than repointing live factsheet classes, which would break byte-identity). GUARD-02 promotes the existing `FactsheetBody.scenario-mode.test.tsx` innerHTML-equality proof into the permanent gate (adding an Overview-untouched assertion); GUARD-03 extends the already-CI-wired `composer-axe.spec.ts` (verified at ci.yml:1261 — FLOW-01 does NOT apply) with new visible-anchor gates for `#factsheet-main` and the new sections; GUARD-04 is a `persist={false}` spy test asserting no `factsheet-v2:` localStorage write or `?range/?cmp/?dark` URL mutation, scoped to avoid the legitimate `composer-collapse:controls` key. The only genuine new edge-state work is an assembled-surface degenerate cross-check; everything else is reposition, class-swap, or test-promotion against verified file:line anchors.
