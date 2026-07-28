---
phase: 43-edge-states-toggle-fold-guards
verified: 2026-06-26T00:00:00Z
status: human_needed
score: 4/4 must-haves verified
overrides_applied: 0
human_verification:
  - test: "Navigate to /allocations?tab=scenario with an authed account that has >=2 connected API keys with per-key history. Verify the Data-sources CollapsibleSection appears as a sibling section above the factsheet body, compose + read on one surface."
    expected: "Data-sources toggle reads as a factsheet-shaped editorial section (CollapsibleSection titled 'Data sources') alongside Diversification and Strategies & weights. Per-key role=switch rows are interactable. The factsheet body renders below."
    why_human: "The DOM repositioning of the Data-sources fold is proven by static grep and unit tests, but the actual visual layout (section order, spacing, seam padding) requires authed Chromium with a live multi-key seed. The WR-02 axe fix also removed the brittle copy-pinned anchor, so CI axe only runs with the seeded HAS_SEED_ENV — not in the general test run."
  - test: "On the scenario tab with a real composed blend (>=2 strategies added), scroll to the FactsheetFooter and confirm: (a) 'Page 1 / 1' is NOT visible on the composer surface; (b) the disclaimer text ('Past performance is not indicative of future results') IS visible."
    expected: "The page-stamp is absent in scenarioMode; the disclaimer renders unconditionally."
    why_human: "The scenarioMode gate is unit-tested in FactsheetBody.scenario-mode.test.tsx, but a live compositor render with a real user session confirms the scenarioMode prop is actually threaded through ScenarioFactsheetChart → FactsheetBody → FactsheetFooter in the production render path."
---

# Phase 43: Edge States / Toggle Fold / Guards Verification Report

**Phase Goal:** Compose toggles fold into the factsheet-shaped layout; honest empty states for all degenerate blends; permanent byte-identity + a11y + coverage + no-state-bleed guards close the milestone (v1.2.2).
**Verified:** 2026-06-26
**Status:** human_needed (all automated guards VERIFIED; 2 live-render checks need authed Chromium)
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | GUARD-01: Data-sources toggle is a factsheet-shaped CollapsibleSection sibling; compose + read on one surface | VERIFIED | `ScenarioComposer.tsx:2349-2404` — `showDataSources && <Card><CollapsibleSection title="Data sources" defaultOpen>` with no storageKey; role=group rows preserved verbatim |
| 2 | GUARD-01: FactsheetFooter `scenarioMode` gates only the Page-stamp; disclaimer unconditional | VERIFIED | `FactsheetView.tsx:968-995` — `scenarioMode?: boolean` default false; `{!scenarioMode && (<p>Page 1 / 1</p>)}`; disclaimer `<p>` unconditional; call site `:291` threads `scenarioMode={scenarioMode}` |
| 3 | GUARD-01: Leverage chip guard is `c.leverage !== 1` (suppress exactly 1×, render <1× and >1×) | VERIFIED | `MandatePanels.tsx:195` — `{c.leverage !== 1 && (<Chip>...)}`. WR-01 fix (commit 27bc0960) corrected from `> 1` to `!== 1`; MandatePanels.scenario.test.tsx:135 adds a 0.5× regression guard proving <1× chips render |
| 4 | GUARD-01: `--color-text` / `--color-text-2` @theme tokens formalized in globals.css (no live class repoint) | VERIFIED | `globals.css:39-40` — `--color-text: #CBD5E1;` and `--color-text-2: #4A5568;` added to `@theme inline` block; `FactsheetView.tsx` still uses `border-text`/`text-text-2` class strings verbatim (not repointed) |
| 5 | GUARD-02: `FactsheetBody.scenario-mode.test.tsx` contains "PERMANENT", asserts default ≡ scenarioMode={false} via innerHTML equality, and asserts the Overview widget does not mount FactsheetBody / #factsheet-main | VERIFIED | File present; `:111` `expect(def.container.innerHTML).toBe(explicitFalse.container.innerHTML)`; describe block `:104` "PERMANENT byte-identity gate (GUARD-02)"; `:130-133` readFileSync Overview widget, `expect(overviewWidgetSrc).not.toContain("FactsheetBody")` |
| 6 | GUARD-04: `FactsheetBody.guard04-no-bleed.test.tsx` mounts under `persist={false}`, spies setItem + replaceState, asserts zero writes to factsheet keyspace/URL, does NOT false-flag `composer-collapse:controls` | VERIFIED | File present; `:111` `<FactsheetProvider persist={false}>`; `:93` `FACTSHEET_KEY_RE = /^factsheet-v2|^factsheet-collapse/`; `:176-177` keyspace-scoped predicate; `:224` explicit `isFactsheetKeyWrite(["composer-collapse:controls", ...]) === false` |
| 7 | GUARD-03: `composer-axe.spec.ts` has visible-anchor gates for `#factsheet-main` + `#factsheet-diversification` before analyze(); spec still wired in ci.yml; coverage ratchet holds | VERIFIED | `e2e/composer-axe.spec.ts:171-183` — gates on `[id="factsheet-main"]` + `#factsheet-diversification` before `:196` `buildAxe(page).analyze()`; `ci.yml:1261` lists the spec; `vitest.config.ts:74-77` ratchet lines/82 fns/74 branches/72 stmts/80 |
| 8 | Hard invariant: `ScenarioComposer.tsx` contains ZERO `FactsheetBody` literals | VERIFIED | `grep -c "FactsheetBody" ScenarioComposer.tsx` → 0; automated permanent test at `ScenarioComposer.test.tsx:4847-4859` also readFileSync-asserts this |
| 9 | Hard invariant: `src/lib/scenario.ts` is FROZEN — zero diff across all 9 phase commits (3cb0bf01..27bc0960) | VERIFIED | `git diff 3cb0bf01^..27bc0960 -- src/lib/scenario.ts` → 0 lines |

**Score:** 4/4 GUARD must-haves verified (9/9 observable truths)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx` | Data-sources toggle in CollapsibleSection; badge/PCR token swaps; no FactsheetBody literal | VERIFIED | CollapsibleSection at :2349 wraps existing role=switch rows; `bg-warning-bg border-warning-border` at :2638; `bg-accent/10 text-accent` at :2761; FactsheetBody count = 0 |
| `src/app/factsheet/[id]/v2/FactsheetView.tsx` | FactsheetFooter takes additive `scenarioMode` (default false); page-stamp gated | VERIFIED | `:968` `scenarioMode = false`; `:993` `{!scenarioMode && (<p>Page 1 / 1</p>)}`; call site `:291` threads it |
| `src/app/factsheet/[id]/v2/MandatePanels.tsx` | Leverage chip guarded — suppress exactly 1×, render <1× and >1× | VERIFIED | `:195` `c.leverage !== 1` (WR-01 corrected from `> 1`; regression guard in MandatePanels.scenario.test.tsx:135 proves 0.5× chip renders) |
| `src/app/globals.css` | `--color-text` / `--color-text-2` @theme light-mode tokens added | VERIFIED | `:39-40` both tokens present; no live factsheet class strings repointed |
| `src/app/factsheet/[id]/v2/FactsheetBody.scenario-mode.test.tsx` | PERMANENT GUARD-02: innerHTML equality + Overview-untouched assertion | VERIFIED | "PERMANENT" in describe+header; innerHTML equality at :111; Overview readFileSync scan at :130-133 |
| `src/app/factsheet/[id]/v2/FactsheetBody.guard04-no-bleed.test.tsx` | PERMANENT GUARD-04: persist={false} spy test scoped to factsheet keyspace | VERIFIED | `persist={false}` mount; keyspace predicate regex; `composer-collapse:controls` not false-flagged (explicit predicate doc at :224) |
| `e2e/composer-axe.spec.ts` | Scan 2 extended with `#factsheet-main` + `#factsheet-diversification` anchors before analyze() | VERIFIED | `:171-183` anchor gates; `:196` single analyze(); CI wiring at ci.yml:1261 intact |
| `src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx` | Static-guard test (FactsheetBody count == 0) + assembled degenerate-matrix cross-check | VERIFIED | :4847 static guard readFileSync; :4862 0-constituent assembled render; :4938 no-own-book + single-constituent assembled render |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| ScenarioComposer.tsx Data-sources CollapsibleSection | Existing showDataSources role=group controls | Repositioned wrapper; handlers unchanged | WIRED | CollapsibleSection at :2349 wraps the existing role=group :2357; no storageKey |
| FactsheetBody call site (:291) | FactsheetFooter scenarioMode param | `scenarioMode={scenarioMode}` threaded from FactsheetBody scope | WIRED | `:291` `<FactsheetFooter payload={payload} scenarioMode={scenarioMode} />` |
| FactsheetBody.scenario-mode.test.tsx | Real /factsheet route byte-identity | innerHTML equality on default vs explicit false | WIRED | `:111` equality assertion; both renderBody paths confirmed |
| FactsheetBody.guard04-no-bleed.test.tsx | factsheet-context persist={false} gate | Spy on setItem + replaceState, drive Dark-mode toggle + Reset-view | WIRED | `:138-185` Dark-mode test; `:188-216` Reset-view test; keyspace predicate at :93-94 |
| composer-axe.spec.ts Scan 2 | Folded factsheet surface (#factsheet-main + #factsheet-diversification) | Visible-anchor gates before analyze() | WIRED | `:171-183` anchor waits; `:196` `buildAxe(page).analyze()` |

### Data-Flow Trace (Level 4)

Not applicable — this phase produces guards (tests + CSS tokens + JSX repositioning), not new data-fetching paths. The existing `computeScenario` engine path is FROZEN and untouched (git diff = 0).

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| ScenarioComposer.tsx contains 0 FactsheetBody literals | `grep -c "FactsheetBody" ScenarioComposer.tsx` | 0 | PASS |
| scenario.ts frozen — zero diff across all 9 phase commits | `git diff 3cb0bf01^..27bc0960 -- src/lib/scenario.ts \| wc -l` | 0 | PASS |
| No hardcoded hex colors in ScenarioComposer (FEF3C7 / FDE68A removed) | `grep -c "FEF3C7\|FDE68A" ScenarioComposer.tsx` | 0 | PASS |
| bg-warning-bg token swap landed | `grep -c "bg-warning-bg border-warning-border" ScenarioComposer.tsx` | 1 | PASS |
| bg-accent/10 PCR token swap landed | `grep -c "bg-accent/10 text-accent" ScenarioComposer.tsx` | 1+ | PASS |
| --color-text / --color-text-2 in globals.css | `grep -E -- "--color-text:|--color-text-2:" globals.css` | 2 matches | PASS |
| FactsheetFooter scenarioMode default false | `grep "scenarioMode = false" FactsheetView.tsx` | present at :970 | PASS |
| Leverage guard is !== 1 (not > 1) | `grep "c\.leverage !== 1" MandatePanels.tsx` | :195 | PASS |
| composer-axe.spec.ts CI wired | `grep -n "composer-axe.spec.ts" ci.yml` | :1261 | PASS |
| Coverage ratchet lines/fns/branches/stmts in vitest.config.ts | `grep -A6 "thresholds:" vitest.config.ts` | 82/74/72/80 | PASS |
| Data-sources CollapsibleSection has no storageKey | Source read of :2349-2402 block | no storageKey attr | PASS |
| PERMANENT keyword in scenario-mode test + guard04 test | `grep -c "PERMANENT" *.test.tsx` | 2 each | PASS |

### Probe Execution

No probes declared for this phase. Phase is a pure vitest + e2e spec phase; orchestrator confirms full vitest suite 6768 passed / 0 failed.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| GUARD-01 | 43-01, 43-03 | Compose toggles folded into factsheet-shaped layout; honest empty states; static guard permanent | SATISFIED | CollapsibleSection fold at ScenarioComposer.tsx:2349; static guard at ScenarioComposer.test.tsx:4847; degenerate matrix at :4862 |
| GUARD-02 | 43-02 | Permanent byte-identity gate — default ≡ scenarioMode={false} + Overview untouched | SATISFIED | FactsheetBody.scenario-mode.test.tsx with PERMANENT header, innerHTML equality, Overview readFileSync |
| GUARD-03 | 43-03 | axe e2e extended over new body+sections; coverage ratchet green; CI wired | SATISFIED | composer-axe.spec.ts:171-183 anchors; ci.yml:1261; vitest.config.ts ratchet |
| GUARD-04 | 43-02 | No cross-tab bleed under persist={false}; factsheet keyspace scoped; composer-collapse not flagged | SATISFIED | FactsheetBody.guard04-no-bleed.test.tsx with keyspace predicate + explicit non-flagging of composer-collapse:controls |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| None found | — | — | — | — |

All modified files scanned. No TBD/FIXME/XXX markers. No hardcoded hex colors remaining in ScenarioComposer (FEF3C7/FDE68A removed). No stub return null / return [] patterns. No disconnected props.

### Human Verification Required

#### 1. Live folded-surface visual layout (authed, multi-key seed)

**Test:** Navigate to `/allocations?tab=scenario` with an authed account that has >=2 connected API keys with per-key history (so `showDataSources` is true). Verify the Data-sources CollapsibleSection renders as a visible sibling section above the factsheet body — alongside Diversification and Strategies & weights — on one surface.
**Expected:** The "Data sources" CollapsibleSection is visually present, open by default, with per-key role=switch rows interactable. The section appears above the factsheet body mount. The seam between the composer sections and the FactsheetBody article reads as single-padded (not doubled).
**Why human:** The DOM repositioning is statically verified and unit-tested, but the actual visual layout, section ordering, and seam compensation require an authed Chromium render with a live multi-key seed. The CI axe run is HAS_SEED_ENV-gated.

#### 2. Live FactsheetFooter scenarioMode gate (authed composer with composed blend)

**Test:** On the scenario tab, add >=1 strategy to reach the composed state. Scroll to the bottom of the factsheet body in the composer. Confirm (a) "Page 1 / 1" is NOT visible and (b) the disclaimer ("Past performance is not indicative of future results") IS visible.
**Expected:** The page-stamp is absent on the composer surface; the disclaimer renders unconditionally. Cross-check that the real `/factsheet/[id]/v2` route still shows the stamp.
**Why human:** The gate is unit-tested in `FactsheetBody.scenario-mode.test.tsx`, but live confirmation that `scenarioMode={true}` is actually threaded through the full `ScenarioFactsheetChart → FactsheetBody → FactsheetFooter` render chain in production (not just in unit test mocks) requires a real authenticated session.

---

### Gaps Summary

No gaps found. All 4 GUARD must-haves are verified by codebase evidence:

- **GUARD-01**: Data-sources toggle folded into `CollapsibleSection` at `ScenarioComposer.tsx:2349`; no storageKey; badge/PCR tokens swapped; leverage guard corrected to `!== 1` (WR-01); `--color-text`/`--color-text-2` formalized; static guard + degenerate-matrix cross-check permanent in `ScenarioComposer.test.tsx:4847`.
- **GUARD-02**: `FactsheetBody.scenario-mode.test.tsx` promoted to PERMANENT gate; innerHTML equality + Overview-untouched assertion present; "PERMANENT" keyword in describe header.
- **GUARD-03**: `e2e/composer-axe.spec.ts` Scan 2 has `#factsheet-main` + `#factsheet-diversification` visible-anchor gates; `ci.yml:1261` confirms CI wiring intact; coverage ratchet `lines:82/fns:74/branches:72/stmts:80` in `vitest.config.ts`.
- **GUARD-04**: `FactsheetBody.guard04-no-bleed.test.tsx` — PERMANENT header, `persist={false}` mount, keyspace-scoped predicates (`/^factsheet-v2|^factsheet-collapse/`; `?range|?cmp|?dark`), `composer-collapse:controls` explicitly documented as out-of-scope.

Hard invariants:
- `scenario.ts` zero-diff across all 9 phase commits (3cb0bf01..27bc0960) — FROZEN.
- `ScenarioComposer.tsx` FactsheetBody literal count = 0 — static guard holds.

The 2 human-verification items are live-render checks (authed Chromium with seeded multi-key account) that cannot be verified by grep/unit tests. They do not indicate a code defect; they confirm the production render path threads the already-verified unit-tested props correctly.

---

_Verified: 2026-06-26_
_Verifier: Claude (gsd-verifier)_
