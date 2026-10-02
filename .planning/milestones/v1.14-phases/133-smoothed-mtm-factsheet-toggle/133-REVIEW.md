---
phase: 133-smoothed-mtm-factsheet-toggle
reviewed: 2026-07-22T18:55:00Z
rereviewed: 2026-07-22T19:25:00Z
depth: deep
files_reviewed: 16
files_reviewed_list:
  - src/lib/types.ts
  - src/lib/factsheet/types.ts
  - src/lib/factsheet/build-payload.ts
  - src/lib/factsheet/composite-read-path.ts
  - src/lib/metrics-parity-helper.ts
  - src/app/factsheet/[id]/v2/page.tsx
  - src/app/factsheet/[id]/v2/basis-context.tsx
  - src/app/factsheet/[id]/v2/factsheet-context.tsx
  - src/app/factsheet/[id]/v2/FactsheetView.tsx
  - src/app/factsheet/[id]/v2/BatchDPanels.tsx
  - src/lib/factsheet/composite-read-path.test.ts
  - src/lib/factsheet/build-payload.arithmetic.test.tsx
  - src/app/factsheet/[id]/v2/basis-context.test.tsx
  - src/app/factsheet/[id]/v2/basis-context.leverage.test.tsx
  - src/app/factsheet/[id]/v2/FactsheetBody.basis.test.tsx
  - src/app/factsheet/[id]/v2/MasterBrush.basis.test.tsx
findings:
  critical: 0
  warning: 2
  info: 3
findings_resolved: 5
findings_open: 0
status: resolved
verdict: PASS
---

# Phase 133: Code Review Report — smoothed_mtm factsheet toggle

> **ROUND 2 (fix verification, 2026-07-22T19:25Z) — VERDICT: PASS.**
> All 5 round-1 findings (WR-01, WR-02, IN-01, IN-02, IN-03) GENUINELY RESOLVED
> across `acb49ef7..0e4a4d52`. 0 not-resolved, 0 regressed, 0 new findings.
> Reviewer-run gates: 770 tests green across factsheet + lib/factsheet + discovery
> + wizard surfaces; `tsc --noEmit` exit 0; eslint exit 0 on all changed source;
> 0 removed test-assertion lines (no pre-existing test weakened). The WR-02
> page-level wiring guard was empirically neuter-proofed by the reviewer (reverting
> the discovery page to the old inline call reddens its guard). Full per-finding
> re-review below; the fixer's own change report is `133-REVIEW-FIX.md`.
> **Phase 133 code-complete → milestone v1.14.**
>
> Round-1 verdict was PASS-with-fixes (0 critical / 2 warning / 3 info); the
> original round-1 report is preserved verbatim below the round-2 section.

---

## Round 2 — per-finding re-review

### WR-01 (HIGH) → RESOLVED
The single-key basis story is hoisted into ONE shared owner `readSingleKeyBasisOpts`
(`composite-read-path.ts:476-517`): should-read predicates → gated `mtm_daily_returns` /
`smoothed_mtm_daily_returns` reads → `singleKeyBasisOpts` threading. BOTH surfaces call
it — `factsheet/[id]/v2/page.tsx:143` (`() => supabase`) and
`discovery/[slug]/[strategyId]/page.tsx:130` (`createAdminClient` thunk). The discovery
page's inline 4-arg copy (the exact defect) is deleted, so the divergence is closed BY
CONSTRUCTION — a page can no longer thread scalars without the series. Lazy admin
preserved: `getAdmin` is a memoized thunk (`admin ??= getAdmin()`), never invoked on the
hot non-options path (pinned by the "getAdmin NEVER called" assembly test and the
page-level "no roundtrips" test). cash/MTM byte-identity intact (the factsheet page's
admin was already eager pre-hoist; non-options rows still return `{}`).

### WR-02 (MEDIUM) → RESOLVED
Two NEW page-level guards (`page.smoothed-wiring.test.tsx` on both surfaces) invoke the
real RSC, DFS the element tree to the `FactsheetView` payload prop, and assert
`seriesByBasis.smoothed_mtm` + `.mark_to_market` bundles reach it — exercising the
call-site wiring, not the helper in isolation. **Reviewer neuter-proof (executed, not
trusted):** reverting the discovery page's single-key arm to `singleKeyBasisOpts(...)`
inline made `page.smoothed-wiring.test.tsx` fail at the `seriesByBasis.smoothed_mtm …
toBeDefined()` assertion (1 failed); file restored, tree clean. The gap that let WR-01
ship is genuinely closed.

### IN-01 (LOW) → RESOLVED (override sound)
Source `parseSmoothedSeriesPayload` unchanged — tolerates absent `basis`, rejects
present-but-wrong; a pin was added. The fixer overrode my round-1 "strict-reject absent"
suggestion, and the override is correct: the parser is only reached for rows already
keyed `kind = smoothed_mtm_daily_returns`, so an absent-basis row IS smoothed and renders
correctly; the actual T-131-08 threat (a mark_to_market payload mislabeled under the
smoothed kind) is STILL rejected; and it mirrors `parseMtmSeriesPayload` so an omitted
optional field never false-rejects. LOW-severity judgment call, defensibly decided.

### IN-02 (LOW) → RESOLVED
The inline smoothed disabled-reason paragraph (`FactsheetView.tsx:1349`) now renders only
when it adds information: `!smoothedAvailable && (mtmAvailable || mtmGate?.reason ===
"unsmoothed_options_book")`. Non-options both-disabled composites drop the redundant second
line; options books keep the honest pending copy. No honest-disabled signal lost — the
segment stays `aria-disabled` with the mapped `title` tooltip (pinned by the IN-02 test).
Options-book copy byte-untouched.

### IN-03 (LOW) → RESOLVED
`SyncPreviewStep` gains `CompositePreviewData.smoothedMtmAvailable`, computed strictly from
persisted server truth via `hasBasisHeadline(metrics_json_by_basis.smoothed_mtm)` (malformed
jsonb → `false`). The MTM caveat appends the smoothed-available note ONLY when that flag
holds — pinned both ways (headline-present → addendum; no-headline → none). No invented
availability.

### Round-2 gates (reviewer-run)
- vitest `"src/app/factsheet/[id]/v2" src/lib/factsheet "src/app/(dashboard)/discovery" "src/app/(dashboard)/strategies/new/wizard"` → **770 passed / 69 files**.
- `tsc --noEmit` → exit 0. eslint on 5 changed source files → exit 0.
- `git diff acb49ef7..0e4a4d52 -- '*.test.*'` removed-assertion count → **0** (no pre-existing test weakened/deleted).
- New findings: **none.**

---

# Round 1 (original) — PASS-with-fixes

**Reviewed:** 2026-07-22 (diff `a1d03d59..acb49ef7`, commits 6c04f609 / 44b01f9f / acb49ef7)
**Depth:** deep (every hunk read; call chains traced across both render surfaces; contract cross-checked against the Phase-132 Python writer)
**Round-1 verdict:** **PASS-with-fixes** — no CRITICAL, one HIGH (a second production render surface was missed), one MEDIUM (the wiring-guard doesn't actually guard the wiring, which is how the HIGH slipped). All five now resolved — see Round 2 above.

## Summary

Verification performed (not trusted from the SUMMARY):

- **Gates re-run by reviewer:** `npx vitest run "src/app/factsheet/[id]/v2" src/lib/factsheet --no-file-parallelism` → **526 passed / 47 files**; `npx tsc --noEmit` → clean (exit 0). Working tree confirmed at `acb49ef7`, no dirty `src/`.
- **cash/MTM byte-identity — VERIFIED hunk-by-hunk.** Every predicate transformation was checked on the old basis domain {cash_settlement, mark_to_market}: caption ternary restructure (FactsheetView:525), suppressRelative OR-term (:830), composite eyebrow three-way (:870), `useBasisSeriesView` layer-1 predicate (`basis !== "mark_to_market" || !bundle` → `basis === "cash_settlement" || !bundle` — identical for both old members since a cash basis never selects a bundle), the :339 re-pin guard (`!== "mark_to_market"` → `=== "cash_settlement"` — identical on the old domain), `leverageEligibleFor` additive `!(…)` clause, the brush-clamp additive `?? 0` max() term, BatchDPanels OR-term, and the `singleKeyBasisOpts` return-shape refactor (old `available && mtm ? { mark_to_market: mtm } : undefined` ≡ new object-build when no smoothed key exists). Zero behavior change on cash/MTM found. Pre-existing tests unmodified.
- **Contract match — VERIFIED against Python.** Kind literal `smoothed_mtm_daily_returns` = `KIND_SMOOTHED_MTM` (`basis_series.py:118`), payload `basis: "smoothed_mtm"` written at `basis_series.py:352` via `_KIND_BY_BASIS` (:124), rows `{date, return}` from `result.series_rows`, optional `nan_dates` (:360-361), `metrics_json_by_basis["smoothed_mtm"]` written at `job_worker.py:4185/:5702`. The TS reader queries the constant, the parser tolerates `nan_dates` (extra keys ignored) and rejects a wrong-basis literal. `parseMtmSeriesPayload` performs no basis check, so the delegation cannot false-reject a valid smoothed payload. No silently-blank-toggle mismatch.
- **Honest-disabled posture — VERIFIED.** `SegmentedControl` disabled options `preventDefault` and never call `onChange` (SegmentedControl.tsx:44-51), so `basis === "smoothed_mtm"` is unreachable while the gate is closed. Every reachable smoothed state with an absent bundle degrades honestly: blank rail eyebrow (`onMtm` gated on the ACTIVE basis's own bundle, :343-344), the "applies to summary metrics only" caption, `suppressRelative` hides α/IR, leverage ineligible, KPIs strict-overlay `?? {}` → "—" never cash. I could not construct a state where smoothed numbers render under a cash label or cash numbers under a smoothed label — with one surface-level caveat (WR-01 below): on the discovery route the degraded state is *permanent by construction*, not a degrade.
- **{smoothed_mtm}-only edge — VERIFIED.** `singleKeyBasisOpts` three-term early return; past it `mtmGate` is always constructed, so the FactsheetView `:1300` predicate (`composite || payload.mtmGate != null`) renders the toggle. Pinned at the read path (composite-read-path.test.ts MEDIUM-2 guard, which does redden if the early return is restored to two terms) AND at the render (`FactsheetBody.basis.test.tsx` "{smoothed_mtm}-only single-key renders the toggle").
- **Brush clamp (plan-check HIGH-2) — VERIFIED.** The third `max()` term makes the upper clamp `max(cash, mtm ?? 0, smoothed ?? 0) − 1`; the MasterBrush.basis test drives the window end to index 149 past cash length 100 with NO mtm bundle and asserts the last smoothed date label — reverting the term makes it clip to `S099` (RED-provable). The `.dates`-vs-`.dates.length` dep deviation is behavior-neutral: the payload is an immutable RSC-serialized object, so the array reference only changes when the payload changes; a broader dep can only *re-create* the callback, never leave it stale.
- **Leverage — VERIFIED.** Smoothed rides `leverageEligibleFor` (bundle AND scalars both required), the re-pin runs only past `leverageApplies` (so `persisted` is present by construction, with a defensive `!persisted` fallback anyway), the levered-view cache is keyed `${basis}:${L}` so smoothed and MTM entries can't collide, and the L=0 honest-zeros carve-out is shared. The Phase-107 L=1↔L≠1 jump is pinned closed for smoothed by `basis-context.leverage.test.tsx`.
- **metrics-parity-helper exclusion — VERIFIED correct, not a silent drop.** `smoothed_mtm_daily_returns` is read directly via `readSmoothedSeries` (service-role, deny-all RLS), never via the `fetch_strategy_lazy_metrics` RPC panel whose 12-kind invariant `SIBLING_KINDS` pins — the exact precedent of the already-excluded `mtm_daily_returns`. Excluding it from the exhaustiveness check is the correct arm.

## Warnings (round 1 — both RESOLVED in round 2)

### WR-01 (HIGH → RESOLVED): The discovery render surface never threads the single-key smoothed series — smoothed charts silently impossible on one of the two production surfaces

**File:** `src/app/(dashboard)/discovery/[slug]/[strategyId]/page.tsx:128-143`
**Issue:** `FactsheetView` renders at exactly two sites: `/factsheet/[id]/v2/page.tsx:474` and this discovery page (`:208`). The discovery page's single-key arm calls `singleKeyBasisOpts(dqf, metricsJsonByBasis, computationStatus, mtmSeries)` **without the new 5th `smoothedSeries` argument** and never calls `shouldReadSingleKeySmoothedSeries`/`readSmoothedSeries` — while its own comment block (:116-127, MTM-01/MTM-04) states the whole point of routing through the shared owner is "so the two surfaces cannot diverge." Phase 133 broke that parity for the smoothed bundle: `singleKeyBasisOpts` still constructs an *available* `smoothedGate` from the scalar (the optional parameter defaults to `undefined`, so this compiles clean), meaning the segment renders **enabled** here.
**Failing UI scenario:** a single-key Deribit options book with a persisted smoothed basis (the phase's flagship case — e.g. Phoenix after re-onboard). On `/discovery/{slug}/{id}`: MTM segment disabled (`unsmoothed_options_book`), "Smoothed mark-to-market" **enabled**; the user selects it → KPI strip overlays the real smoothed scalars, but every chart stays the **cash** series with the "Smoothed mark-to-market applies to summary metrics only" caption, α/IR suppressed, leverage ineligible — permanently, by construction, not as a degrade. The same strategy at `/factsheet/{id}/v2` shows the smoothed no-spike charts. No dishonest label is shown (the caption is truthful), which is why this is not CRITICAL — but the phase's flagship deliverable ("options book renders the smoothed series") silently fails on a first-class surface, and the two surfaces now show different charts for the same strategy + basis.
**Resolution (round 2):** hoisted into shared `readSingleKeyBasisOpts`; both pages call it; divergence closed by construction; page-level wiring guard added and neuter-proofed. See Round 2.

### WR-02 (MEDIUM → RESOLVED): The "wiring-guard" guards the helper contract, not the call-site wiring — which is exactly how WR-01 shipped

**File:** `src/lib/factsheet/composite-read-path.test.ts` (the "MEDIUM-2 WIRING-GUARD" case) vs `src/app/factsheet/[id]/v2/page.tsx:151-160`
**Issue:** the plan demanded "test the wiring, not just the helper: assert the predicate gates the read AND the read's result reaches the opts (the call-site contract)." The shipped guard calls `singleKeyBasisOpts` *directly* and asserts its output carries the supplied series — it proves the helper, not that any page invokes it with the 5th argument. Delete the `smoothedSeries` read + 5th arg from `page.tsx` and the entire 526-test surface stays green (empirically proven: the discovery page shipped with exactly that neutering and nothing reddened). The `smoothedSeries?` optional-parameter design makes call-site neutering invisible to the type checker too.
**Failing scenario:** any future refactor of either page's `fetchAndBuildPayload` can drop the smoothed threading; every gate stays green; the toggle stays enabled with permanently-cash charts (the WR-01 state) on the refactored surface.
**Resolution (round 2):** two page-level RSC wiring guards added; reviewer-neuter-proofed on the discovery surface. See Round 2.

## Info (round 1 — all RESOLVED in round 2)

### IN-01 (LOW → RESOLVED): `parseSmoothedSeriesPayload` tolerates an ABSENT `basis` key

**File:** `src/lib/factsheet/composite-read-path.ts:127-137`
**Issue:** the guard rejects only a *present-but-wrong* basis literal; a smoothed-kind row whose payload lacks `basis` entirely parses and renders under the smoothed label. The Python writer unconditionally emits `"basis": basis` (`basis_series.py:352`), so an absent key is malformed by definition. Risk is low (deny-all RLS, single service-role writer), hence LOW not MEDIUM.
**Resolution (round 2):** behavior kept (tolerate absent / reject wrong, mirroring `parseMtmSeriesPayload`) with a documenting pin — override sound: the row is already keyed by the smoothed kind, and the security-relevant wrong-basis mislabel (T-131-08) is still rejected. See Round 2.

### IN-02 (LOW → RESOLVED): Non-options composites now permanently stack TWO disabled-reason paragraphs, and the smoothed copy implies a computation that will never happen

**File:** `src/app/factsheet/[id]/v2/FactsheetView.tsx:1326-1343`; copy in `basis-context.tsx smoothedDisabledReasonCopy`
**Issue:** `readCompositeFactsheet` now always constructs `smoothedGate` (reason `"smoothed_basis_unavailable"`), so every existing perp/ccxt composite in production renders BOTH the MTM venue-reason paragraph AND "Smoothed mark-to-market unavailable: this basis has not been computed for this strategy." — permanently. For a non-options book "has not been computed" reads as *pending*; the honest truth is *not applicable*.
**Resolution (round 2):** inline paragraph now renders only when it adds information; honest-disabled preserved via the segment tooltip. See Round 2.

### IN-03 (LOW → RESOLVED): Wizard SyncPreview caveat unaware of the smoothed basis

**File:** `src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.tsx:1265,1476`
**Issue:** the wizard preview still said "Mark-to-market view unavailable — unsmoothed_options_book" with no mention that the smoothed basis now opens what MTM keeps closed.
**Resolution (round 2):** server-truth `smoothedMtmAvailable` (`hasBasisHeadline`) gates a caveat addendum; no invented availability. See Round 2.

### Note (no finding): `extractBasisObject` refactor

`singleKeyBasisOpts`'s MTM extraction (:415-427) was rewritten into a shared `extractBasisObject` helper rather than adding a pure sibling arm. I verified guard-by-guard equivalence (same non-null/non-array checks, same cast) and the pre-existing tests pass unmodified, so no behavioral finding.

---

_Round 1 reviewed: 2026-07-22 · Round 2 re-review: 2026-07-22_
_Reviewer: Claude (gsd-code-reviewer) · Depth: deep_
