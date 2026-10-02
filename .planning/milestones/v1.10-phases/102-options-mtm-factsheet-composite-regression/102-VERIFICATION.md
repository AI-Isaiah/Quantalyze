---
phase: 102-options-mtm-factsheet-composite-regression
verified: 2026-07-12T00:00:00Z
status: passed
score: 8/8 must-haves verified
overrides_applied: 0
re_verification:
  previous_status: none
  note: initial verification
---

# Phase 102: Options MTM Factsheet + Composite + Regression — Verification Report

**Phase Goal:** A single-key options factsheet honestly toggles cash↔MTM from the Phase-101-persisted `metrics_json_by_basis.mark_to_market`, F-4-gated on `computation_status` (only a DONE row renders MTM); options composites stay honest (Option A — gated OFF, marked coverage); every existing cash surface byte-identical (SC-4); NO new valuation math; the live Zavara MTM corroboration is a post-deploy ship-time gate (NOT claimed in-phase).

**Verified:** 2026-07-12
**Status:** passed — GOAL MET
**Re-verification:** No — initial verification
**Method:** goal-backward against `git diff db18dcc5..HEAD` and current source; no reliance on SUMMARY claims.

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | MTM-01 toggle enablement wired on BOTH surfaces | ✓ VERIFIED | `singleKeyBasisOpts` threaded on the single-key arm of `page.tsx:129` and discovery `page.tsx:121`; `page.tsx:44` adds `computation_status` to the `strategy_analytics(...)` select; discovery uses `getStrategyDetail`→`strategy_analytics (*)` (`queries.ts:416`), builds payload (`:144/165`) and renders `<FactsheetView payload={factsheetPayload}/>` (`:194`); render gate widened `composite` → `(composite \|\| payload.mtmGate != null)` at `FactsheetView.tsx:1184`. |
| 2 | F-4 gate: MTM available only on a DONE row + displayable headline | ✓ VERIFIED | `composite-read-path.ts:254-263`: `done = status==="complete"\|\|status==="complete_with_warnings"`; `available = done && hasBasisHeadline(mtm)`; `metricsByBasis` threaded ONLY when `available` (structural). Literals match `analytics_runner.py:1938-1939` (stored-trades) and `:2392` (CSV-broker) — the only two terminal-success writes; `failed`/`computing` never render. |
| 3 | SC-4: cash surfaces byte-identical | ✓ VERIFIED | Helper threads ONLY `{ mark_to_market: mtm }` — never the raw column (`composite-read-path.ts:259-262`); `build-payload.ts:243` overlay reads ONLY `metricsByBasis?.cash_settlement` and no-ops when absent. Nine analytics cash-pin files: `git diff --stat db18dcc5..HEAD` EMPTY (byte-identical). No `build-payload.ts`/golden/chart-island files in the frontend diff. |
| 4 | No-invented-data (leverage×MTM) | ✓ VERIFIED | `leverage-context.tsx:132-139`: short-circuit adds `basis === "mark_to_market"` → returns persisted overlay `modeled:false` (`basis` added to deps `:149`). `FactsheetView.tsx:1195` `leverageEligible` requires `basis === "cash_settlement"` (input hidden under MTM). |
| 5 | MTM-02 Option A — composite MTM READ-ONLY, honest-disabled | ✓ VERIFIED | `stitch_composite.py` sole production change is `+MTM_REASON_ANCHOR_RACE = "mtm_anchor_race"`; `mark_to_market_available` and the composite valuation pass UNCHANGED (no new valuation math). COMPOSE-1 pins `(False, "unsmoothed_options_book")`; job pin asserts `"mark_to_market" not in by_basis`; coverage marked, never zero-filled; perp-only still `(True, None)`. |
| 6 | mtm_anchor_race — label-only, degrade intact | ✓ VERIFIED | `job_worker.py:2413-2417`: only `mtm_gated_reason` assignment changed to `MTM_REASON_ANCHOR_RACE if isinstance(_mtm_exc, InceptionReconciliationError) else MTM_REASON_SUMMARY_COVERAGE`; `mtm_returns=None` + catch tuple + degrade path untouched. `InceptionReconciliationError` imported from `services.native_nav` (`:2067`). RACE-1 asserts cash ships DONE + `metrics_json_by_basis is None`. |
| 7 | Ship-time honesty — no in-phase live Zavara attestation | ✓ VERIFIED | Both SUMMARYs record OQ-3 as a post-deploy operational gate; no in-phase test asserts live DB state (analytics tests use mocked RPC captures). Backfill (`enqueue_compute_job … derive_broker_dailies`) is the only step that populates live `metrics_json_by_basis.mark_to_market`. |
| 8 | Three Wave-0 tests exist and are falsifiable | ✓ VERIFIED | F4-1 asserts `available=false`+`metricsByBasis undefined` for `["failed","computing",undefined,null,...]`; SC4-1 asserts `cash_settlement` never survives; LEV-MTM-1 asserts persisted `+50.0%` MTM scalar + NO MODELED eyebrow with documented neuter. Real behavioral assertions, not tautologies. |

**Score:** 8/8 truths verified

### Cross-language literal contract

`mtm_anchor_race` pinned identically: TS `basis-context.tsx` `case "mtm_anchor_race"` ↔ Python `stitch_composite.py` `MTM_REASON_ANCHOR_RACE = "mtm_anchor_race"`; `unsmoothed_options_book` tied via value-imported `MTM_REASON_OPTIONS` in COMPOSE-1.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `composite-read-path.ts` | `singleKeyBasisOpts` F-4+SC-4 helper | ✓ VERIFIED | Exported, imports `hasBasisHeadline`, structural threading |
| `FactsheetView.tsx` | widened gate + tone split + leverage guard | ✓ VERIFIED | `:1184` gate, `:1195` leverageEligible, `:1200-1211` amber/muted tone |
| `page.tsx` (factsheet) | select+thread | ✓ VERIFIED | `computation_status` added to select; helper threaded |
| discovery `page.tsx` | mirror wiring | ✓ VERIFIED | Helper threaded; `(*)` select carries status; renders FactsheetView |
| `leverage-context.tsx` | MTM short-circuit | ✓ VERIFIED | `basis === "mark_to_market"` branch |
| `basis-context.tsx` | 6 reasons + tone | ✓ VERIFIED | All six + basis-agnostic default + `mtmReasonTone` |
| `stitch_composite.py` | anchor-race constant, RO otherwise | ✓ VERIFIED | Only constant added |
| `job_worker.py` | label-only classification | ✓ VERIFIED | isinstance branch inside existing catch |

### Key Link Verification

| From | To | Via | Status |
|------|----|----|--------|
| factsheet page | build-payload | `singleKeyBasisOpts(dqf, metrics_json_by_basis, computation_status)` | ✓ WIRED |
| discovery page | FactsheetView | `buildFactsheetPayload(...buildOpts)` → `<FactsheetView/>` | ✓ WIRED |
| helper | F-4 status | `analytics_runner.py` complete/complete_with_warnings | ✓ WIRED (literals exact) |
| job_worker | native_nav | `from services.native_nav import InceptionReconciliationError` | ✓ WIRED |

### Anti-Patterns Found

None. No debt markers (TBD/FIXME/XXX) introduced in phase files. `singleKeyBasisOpts` returning `{}` for non-options single-key strategies is the honest-empty byte-identical contract, not a stub. `metrics_json_by_basis is None` in RACE-1 is a correctness assertion, not a hardcoded-empty stub.

### Post-Deploy Gate (NOT an in-phase gap)

The live Zavara MTM corroboration (OQ-3) is, by the phase goal's own definition, a post-deploy ship-time gate and is correctly excluded from in-phase attestation. The in-phase toggle behavior is programmatically covered by the SK-TOGGLE-1 vitest (toggle renders + relabels KPI scalars from the persisted MTM object). No in-phase gap; the milestone ship flow must run OQ-3 after green main CI + Railway deploy verification.

### Gaps Summary

None. All eight must-haves verified against code. SC-4 byte-identity holds by construction (only `mark_to_market` threaded; cash overlay reads only `cash_settlement`) AND empirically (nine cash-pin files byte-identical). F-4 gate literals match the runner's exact terminal-success writes. Option A composite path is provably read-only (sole stitch_composite production delta is a string constant).

---

_Verified: 2026-07-12_
_Verifier: Claude (gsd-verifier)_
