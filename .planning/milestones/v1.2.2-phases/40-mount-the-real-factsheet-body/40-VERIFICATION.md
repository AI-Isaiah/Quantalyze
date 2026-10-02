---
phase: 40-mount-the-real-factsheet-body
verified: 2026-06-26T11:10:00Z
status: passed
score: 4/4 must-haves verified
overrides_applied: 0
human_verification:
  - test: "Visual parity of the mounted factsheet body in the live Scenario composer tab"
    expected: "The full KPI strip, metrics rail, chart panels (equity, drawdown, heatmaps, streaks, stress windows), and footer render with correct styling and interactive controls (brush, period tabs, Display menu) on an actual blend"
    why_human: "Requires an authed live /allocations session in a real browser; jsdom covers structural mounting and behavior but cannot verify visual rendering, palette application, or interactive feel. Deferred non-blocking — the composer-axe e2e (Phase 43 gate) covers WCAG/a11y; this is purely visual-feel confirmation."
---

# Phase 40: Mount the real factsheet body — Verification Report

**Phase Goal:** The Scenario tab renders the REAL `FactsheetBody` under the existing `persist={false}` provider, fed the complete payload, with an additive `scenarioMode` prop — and the real `/factsheet/[id]` route + Overview stay byte-identical.
**Verified:** 2026-06-26T11:10:00Z
**Status:** passed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | The composer renders the real `FactsheetBody` (not a reimplementation) — KPI strip + metrics rail + panel sections — from the blend payload | ✓ VERIFIED | `ScenarioFactsheetChart.tsx:6,187` imports and mounts `FactsheetBody` directly; all 9 degenerate/scenario-mode tests pass |
| 2 | `scenarioMode` defaults false; with it off, factsheet route + Discovery detail + Overview widget are byte-identical | ✓ VERIFIED | `FactsheetView.tsx:152,169` — `scenarioMode?: boolean` default false; zero `scenarioMode` occurrences in `page.tsx`, `discovery/.../page.tsx`, `AllocationDashboardV2.tsx`; BODY-02 innerHTML equality test green |
| 3 | Every panel (incl. lazy-mounted dynamic heatmaps) renders without crashing across healthy / single-strategy / sub-N-overlap / non-finite blends | ✓ VERIFIED | `FactsheetBody.degenerate.test.tsx` — 4 async cases each `await waitFor` until `#factsheet-heatmaps` has zero `.animate-pulse` skeletons (WR-01 fix, commit `38e36ae2`), then asserts no NaN/Infinity; 6/6 green |
| 4 | api-only synthetic panels (allocator portfolios, event signatures) are absent on the blend (`ingestSource` stays `"csv"`) | ✓ VERIFIED | `scenario-factsheet-payload.ts:436` hardcodes `ingestSource: "csv"`; `FactsheetView.tsx:249,283` gate signatures/allocator on `=== "api"`; BODY-04 render-absence tests assert `getElementById("factsheet-allocator")` null, `getElementById("factsheet-signatures")` null, no `/Peer Percentile/i` — all green |

**Score:** 4/4 truths verified

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/app/factsheet/[id]/v2/FactsheetView.tsx` | `scenarioMode?: boolean` on `FactsheetBodyOptions`, threaded to `ControlBar` + `MetricsColumn` | ✓ VERIFIED | Lines 152, 169, 199, 277 — prop added, destructured with default `false`, passed to both children |
| `src/app/factsheet/[id]/v2/MetricsColumn.tsx` | `scenarioMode?: boolean` accepted as inert Phase-42 seam | ✓ VERIFIED | Line 19 — `{ scenarioMode = false }: { scenarioMode?: boolean }` + `void scenarioMode;` no-op at line 24 |
| `src/app/factsheet/[id]/v2/FactsheetBody.scenario-mode.test.tsx` | BODY-02 prop equivalence + Share/Compare suppression test (3 cases) | ✓ VERIFIED | File exists; 3/3 tests green |
| `src/app/(dashboard)/allocations/widgets/performance/ScenarioFactsheetChart.tsx` | Mounts real `FactsheetBody` with `scenarioMode hideHeader hideAllocatorSection hideFooter={false} topSlot={<PeriodControl/>}` inside single `persist={false}` provider | ✓ VERIFIED | Lines 177–207 — exact mount shape confirmed |
| `src/app/factsheet/[id]/v2/FactsheetBody.degenerate.test.tsx` | BODY-03 degenerate render matrix (4 blends × async heatmap flush) + BODY-04 render-absence (2 blends) | ✓ VERIFIED | File exists with WR-01 fix applied; 6/6 tests green |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `FactsheetBody` | `ControlBar` | `scenarioMode={scenarioMode}` prop | ✓ WIRED | `FactsheetView.tsx:199` — `<ControlBar scenarioMode={scenarioMode} />` |
| `FactsheetBody` | `MetricsColumn` | `scenarioMode={scenarioMode}` prop | ✓ WIRED | `FactsheetView.tsx:277` — `<MetricsColumn scenarioMode={scenarioMode} />` |
| `ControlBar` | Share/Compare suppression | `!scenarioMode &&` guards | ✓ WIRED | `FactsheetView.tsx:860,861` — both buttons gated |
| `ScenarioFactsheetChart` | `FactsheetBody` | import + JSX mount | ✓ WIRED | Lines 6 + 187; `ScenarioComposer.tsx` contains `FactsheetBody` zero times (static guard green — 99/99 ScenarioComposer tests pass) |
| `FactsheetProvider persist={false}` | cross-tab bleed isolation | single provider wrapping entire mount | ✓ WIRED | `ScenarioFactsheetChart.tsx:177` — one provider, `PeriodControl` in `topSlot` is a descendant so `useXRange` resolves |
| `ingestSource: "csv"` | api-panel suppression | compile-time type + runtime guards in `FactsheetView.tsx:249,283` | ✓ WIRED | `scenario-factsheet-payload.ts:436` hardcodes `"csv"`; guards in FactsheetView confirmed |

---

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `ScenarioFactsheetChart` | `synthPayload` | `buildScenarioFactsheetPayload({ portfolioDaily, benchmark })` memoized | Yes — `compute()` family produces complete `FactsheetCsvPayload` from `portfolioDaily` | ✓ FLOWING |
| `FactsheetBody` | `payload` | passed directly from `synthPayload` | Yes — same object, no intermediate transformation | ✓ FLOWING |

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| BODY-02 prop equivalence + suppression | `npx vitest run "FactsheetBody.scenario-mode" --no-file-parallelism` | 3/3 passed | ✓ PASS |
| BODY-03/04 degenerate matrix + api-panel absence | `npx vitest run "FactsheetBody.degenerate" --no-file-parallelism` | 6/6 passed | ✓ PASS |
| Static guard — ScenarioComposer.tsx FactsheetBody count = 0 | `grep -v '^\s*//' ScenarioComposer.tsx \| grep -c FactsheetBody` | `0` | ✓ PASS |
| ScenarioComposer tests (incl. static guard at line 3377) | `npx vitest run ScenarioComposer --no-file-parallelism` | 99/99 passed | ✓ PASS |

---

### Probe Execution

Step 7c: SKIPPED — no `scripts/*/tests/probe-*.sh` declared or conventionally present for this phase. Phase is a client-render-only change; no runnable CLI or API probe applies.

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| BODY-01 | 40-02-PLAN.md | Real `FactsheetBody` mount under `persist={false}` provider | ✓ SATISFIED | `ScenarioFactsheetChart.tsx:6,187`; 9 tests green |
| BODY-02 | 40-01-PLAN.md | Additive `scenarioMode?: boolean` default false; byte-identical call sites | ✓ SATISFIED | `FactsheetView.tsx:152,169`; BODY-02 test innerHTML equality green; 0 occurrences in 3 call sites |
| BODY-03 | 40-02-PLAN.md | Every panel renders without crashing across degenerate blends; dynamic heatmaps included | ✓ SATISFIED | `FactsheetBody.degenerate.test.tsx` — WR-01 async fix applied; 4 blend cases await real heatmap DOM |
| BODY-04 | 40-02-PLAN.md | api-only panels absent on csv blend | ✓ SATISFIED | `scenario-factsheet-payload.ts:436`; BODY-04 render-absence assertions green |

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `MetricsColumn.tsx:24` | 24 | `void scenarioMode;` | ℹ Info | Intentional inert seam (documented), not a stub — Phase-42 PEER-01 consumer. Lint-safe per RESEARCH Pitfall 4. |
| `ScenarioFactsheetChart.tsx` | 67-91 | `@deprecated` props (`equityDailyPoints`, `scenarioSeries`) accepted but not used | ℹ Info | Intentional call-site symmetry (documented in JSDoc). Not a stub — the mount no longer needs them (WR-01 single-axis). |

No `TBD`, `FIXME`, or `XXX` markers found in any Phase-40-modified file. No `return null` stub patterns in production paths. No hardcoded empty arrays at render sites.

---

### Human Verification Required

#### 1. Live authed composer visual-feel canary

**Test:** In a real Chromium session signed in to /allocations, compose a blend with 2+ strategies, click the Scenario tab, and confirm the full FactsheetBody renders (KPI strip, equity/drawdown charts with MasterBrush, heatmaps, streaks, stress windows, footer, MetricsColumn performance/risk/style sections, ControlBar with Display + Reset view but WITHOUT "Copy share link" / "Compare strategies").

**Expected:** Visually matches the `/factsheet/[id]/v2` real factsheet style; interactive controls respond (brush, period tabs, Display menu); no console errors; no "Loading…" spinners stuck; PeriodControl (3M/6M/12M/ALL) drives the shared brush window.

**Why human:** Requires an authed live browser session (authed pages don't hydrate in headless per project MEMORY). The jsdom unit suite covers structural mounting, absence/presence of DOM nodes, byte-identity, and no-crash guarantees — but visual rendering, palette tokens, and interactive feel cannot be verified programmatically. This is a non-blocking deferred canary; the composer-axe e2e (Phase 43 gate) will cover WCAG-AA accessibility in CI.

---

### Gaps Summary

No gaps found. All four ROADMAP success criteria are VERIFIED against the actual shipped code with test evidence.

**WR-01 (review finding) resolved:** The degenerate test's false-confidence gap (dynamic heatmaps silently skipped by synchronous innerHTML read) was caught in code review (`40-REVIEW.md`) and fixed in commit `38e36ae2` before this verification. The fixed test uses `await waitFor(() => expect(heatmaps!.querySelectorAll(".animate-pulse").length).toBe(0))` to prove both `MonthlyReturnsHeatmap` and `DailyReturnsHeatmap` actually ran (not just their skeleton). All 6 degenerate/BODY-04 tests pass.

---

## Verdict

Phase 40 achieved its goal. The Scenario composer now renders the **real** `FactsheetBody` — not a reimplementation — under the single existing `persist={false}` provider, fed the synthesized blend payload from `buildScenarioFactsheetPayload`. The additive `scenarioMode?: boolean` prop (default false) is wired through `FactsheetBody → ControlBar` (suppressing Share-link + Compare-strategies) and `MetricsColumn` (inert Phase-42 seam), with byte-identity of the three existing call sites (`page.tsx`, Discovery, Overview) verified both by code inspection (zero `scenarioMode` occurrences) and by the BODY-02 `innerHTML` equality test. The static-guard landmine (`ScenarioComposer.tsx` FactsheetBody count = 0) holds. Every degenerate blend case — including the WR-01-fixed async heatmap flush — passes without NaN/Infinity contamination, and api-gated panels are confirmed absent by construction on the csv blend. The sole deferred item is the authed live-browser visual-feel canary, which is non-blocking and earmarked for the Phase 43 composer-axe e2e gate.

---

_Verified: 2026-06-26T11:10:00Z_
_Verifier: Claude (gsd-verifier)_
