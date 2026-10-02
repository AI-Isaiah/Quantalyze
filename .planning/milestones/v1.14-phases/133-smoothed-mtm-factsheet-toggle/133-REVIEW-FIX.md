---
phase: 133-smoothed-mtm-factsheet-toggle
fixed_at: 2026-07-22T21:13:00Z
review_path: .planning/phases/133-smoothed-mtm-factsheet-toggle/133-REVIEW.md
iteration: 1
findings_in_scope: 5
fixed: 5
skipped: 0
status: all_fixed
---

# Phase 133: Code Review Fix Report

**Fixed at:** 2026-07-22T21:13:00Z
**Source review:** 133-REVIEW.md (verdict PASS-with-fixes: 0 critical / 2 warning / 3 info)
**Iteration:** 1

**Summary:**
- Findings in scope: 5 (WR-01, WR-02, IN-01, IN-02, IN-03 — orchestrator directed ALL closed)
- Fixed: 5
- Skipped: 0

All fixes were applied TEST-FIRST (RED proven before GREEN) in an isolated git
worktree on temp branch `gsd-reviewfix/133-87299`, fast-forwarded back onto
`feat/phase-83-smoothed-mtm`.

## Fixed Issues

### WR-01 (HIGH): Discovery surface never threaded the single-key smoothed series

**Files modified:** `src/lib/factsheet/composite-read-path.ts`, `src/lib/factsheet/composite-read-path.test.ts`, `src/app/factsheet/[id]/v2/page.tsx`, `src/app/(dashboard)/discovery/[slug]/[strategyId]/page.tsx`, `src/app/(dashboard)/discovery/[slug]/[strategyId]/page.smoothed-wiring.test.tsx` (new)
**Commit:** `f4b1ef81`
**Applied fix:** Root-cause hoist (the review's preferred option, per orchestrator directive), not the mechanical clone. New shared server helper `readSingleKeyBasisOpts(getAdmin, strategyId, dqf, metricsJsonByBasis, computationStatus)` in `composite-read-path.ts` owns the WHOLE single-key basis assembly: cheap should-read predicates → gated `mtm_daily_returns`/`smoothed_mtm_daily_returns` roundtrips → `singleKeyBasisOpts` gate/scalar/series threading. BOTH pages now spread `...(await readSingleKeyBasisOpts(...))` — the surfaces are identical by construction; a fourth basis lands on both automatically.
- `getAdmin` is a **memoized thunk** so the discovery page's lazy `createAdminClient()` posture is preserved byte-identically: the hot non-options path never constructs the service-role handle (pinned by unit test), and at most ONE handle is created per call.
- Factsheet route passes `() => supabase` (its existing admin handle) — read path unchanged.
- RED proof: the new discovery page-level test failed on pre-fix code at exactly `seriesByBasis.smoothed_mtm undefined` (MTM bundle present, smoothed absent — the precise WR-01 state).
- 4 new assembly unit tests: both-series threading + single-handle memoization; hot path never calls `getAdmin`; not-DONE never calls `getAdmin` (F-4 structural); mtm-only fires only the mtm roundtrip.

### WR-02 (MEDIUM): Wiring guard tested the helper, not the call sites

**Files modified:** `src/app/factsheet/[id]/v2/page.smoothed-wiring.test.tsx` (new; sibling of the discovery guard committed under WR-01)
**Commit:** `e9c7112c`
**Applied fix:** PAGE-LEVEL wiring guards for BOTH FactsheetView surfaces. Each test invokes the actual RSC default export (`unstable_cache` stubbed to identity, `withPublishedOnly` passthrough, supabase clients + queries mocked at the module seam) with a single-key options row whose smoothed+MTM bases are persisted, traverses the returned element tree to the `FactsheetView` element, and asserts its **payload carries `seriesByBasis.smoothed_mtm` AND `.mark_to_market`** — the exact artifacts a neutered call site loses. Plus a hot-path test per page (no by-basis keys → zero series roundtrips, cash-only payload).
- **Neuter-proofs executed and reverted** (both surfaces): transiently stripping `smoothedSeries` from each page's `readSingleKeyBasisOpts` spread reddened that page's guard on the `smoothed series bundle must reach FactsheetView` assertion (`/factsheet/[id]/v2` proven 1-failed; discovery proven 1-failed), then restored via `git checkout --`. A page bypassing the shared assembly (or re-inlining a stale copy) is now a single red test.

### IN-01 (LOW): `parseSmoothedSeriesPayload` absent-`basis` tolerance

**Files modified:** `src/lib/factsheet/composite-read-path.test.ts`
**Commit:** `420dbc2e`
**Applied fix:** **No source change — behavior confirmed correct per the orchestrator's directive, and pinned.** Current code (`composite-read-path.ts:130`) already rejects only a *present-but-wrong* basis literal and tolerates an absent key (mirroring `parseMtmSeriesPayload`, which performs no basis check). Wrong-basis rejection was already pinned (test :959); the absent-basis tolerance was **unpinned** — added the pin test (an otherwise-valid payload with `basis` omitted parses with full rows + gapSpans).
- **Directive conflict surfaced (Rule 7):** 133-REVIEW.md's suggested fix was the OPPOSITE (strict-reject absent basis). The orchestrator's fix instruction explicitly chose tolerance ("don't false-reject a valid smoothed payload that omits an optional field, but still reject a wrong-basis payload"). Orchestrator directive wins; the pin test's comment documents the decision so a future strict-reject flip reddens deliberately, not accidentally.

### IN-02 (LOW): Permanently-stacked disabled-reason paragraphs on non-options composites

**Files modified:** `src/app/factsheet/[id]/v2/FactsheetView.tsx`, `src/app/factsheet/[id]/v2/FactsheetBody.basis.test.tsx`
**Commit:** `d6e2bdf1`
**Applied fix:** The smoothed inline disabled-reason paragraph now renders only when it adds information beyond the MTM paragraph: `!smoothedAvailable && (mtmAvailable || payload.mtmGate?.reason === "unsmoothed_options_book")`.
- Non-options composite with BOTH bases disabled (the production perp/ccxt shape) → ONE inline paragraph (the specific MTM reason); the smoothed segment keeps its honest `aria-disabled` + `title` reason tooltip (honest-disabled preserved; DESIGN.md density restraint — muted caption pattern unchanged, no new tones).
- Options composite with both disabled → BOTH paragraphs kept ("has not been computed" is honest pending information where the smoothed basis is the remedy). The mandated honest options-book MTM copy is byte-untouched.
- Smoothed-only-disabled (MTM available) → unchanged (pre-existing test :1002 pins it, untouched).
- RED proof: the new non-options stacking test failed on pre-fix code (both paragraphs rendered); 2 new tests pin the consolidated behavior + tooltip preservation.

### IN-03 (LOW): Wizard SyncPreview caveat unaware of the smoothed basis

**Files modified:** `src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.tsx`, `src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.composite.render.test.tsx`
**Commit:** `0e4a4d52`
**Applied fix:** Mirrors the MTM caveat's server-truth posture. `CompositePreviewData` gains `smoothedMtmAvailable: boolean`, derived from the already-selected `metrics_json_by_basis.smoothed_mtm` via the SAME `hasBasisHeadline` gate the factsheet surfaces trust (strict jsonb coercion — malformed column → `false`, never invented availability). When the MTM caveat renders AND the smoothed headline is persisted, the copy appends: *"A Smoothed mark-to-market view is available on the published factsheet."* (DESIGN.md voice: factual, no contractions.)
- Existing MTM caveat copy byte-identical (existing test :823 regex passes unmodified).
- RED proof: addendum test failed pre-fix; a second test pins the no-invented-availability arm (no smoothed headline → no addendum).
- Sole `CompositePreviewData` constructor site verified before adding the required field.

## Verification

| Gate | Before (baseline) | After |
|------|-------------------|-------|
| `npx vitest run "src/app/factsheet/[id]/v2" src/lib/factsheet --no-file-parallelism` | 526 passed / 47 files | **535 passed / 48 files** (+9 new, 0 pre-existing modified or removed) |
| Discovery page tests (`src/app/(dashboard)/discovery`) | n/a (no tests existed) | **2 passed / 1 new file** |
| Wizard steps suite (`.../wizard/steps`) | 176 | **178 passed** (+2 IN-03) |
| Combined four-surface run | — | **715 passed / 0 failed** |
| `npx tsc --noEmit` | clean | **clean (exit 0)** |
| `npm run lint` | clean (1 pre-existing EquityChart.tsx warning) | **0 errors; same single pre-existing warning** (out of scope) |

Non-negotiables held:
- **cash/MTM byte-identity:** the only source hunks are (a) the WR-01 assembly hoist — provably equivalent for non-smoothed rows (same predicates, same reads, same handle; the thunk memoization only *reduces* `createAdminClient()` calls, never changes reads) and pinned by the hot-path tests on both pages; (b) the IN-02 render gate — additive `&&` narrowing on the smoothed-only paragraph, cash/MTM paragraphs byte-untouched; (c) IN-03 — wizard-only, additive field + conditional copy suffix. All pre-existing basis/kpistrip/MasterBrush/wizard tests pass UNMODIFIED.
- **Honest-disabled preserved:** segments keep `aria-disabled` + mapped `title` reason everywhere (pinned).
- **Contract match unchanged:** no reader/parser source change (IN-01 is a test-only pin).
- **No coverage deleted:** the WR-01 refactor removed zero tests; the old helper-level tests remain valid (the helper still exists and is now also exercised through the assembly + both page guards).

## Commits

| Finding | Commit | Message |
|---------|--------|---------|
| WR-01 | `f4b1ef81` | fix(133): WR-01 hoist single-key basis assembly into shared readSingleKeyBasisOpts; discovery page threads smoothed series |
| WR-02 | `e9c7112c` | fix(133): WR-02 page-level wiring guards for both FactsheetView surfaces (smoothed/mtm series threading) |
| IN-01 | `420dbc2e` | fix(133): IN-01 pin absent-basis tolerance in parseSmoothedSeriesPayload (mirror parseMtmSeriesPayload; wrong-basis rejection unchanged) |
| IN-02 | `d6e2bdf1` | fix(133): IN-02 suppress redundant stacked smoothed disabled-reason on non-options books (options-book pending copy kept) |
| IN-03 | `0e4a4d52` | fix(133): IN-03 wizard SyncPreview MTM caveat notes the persisted smoothed basis (server-truth hasBasisHeadline gate) |

---

_Fixed: 2026-07-22_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
