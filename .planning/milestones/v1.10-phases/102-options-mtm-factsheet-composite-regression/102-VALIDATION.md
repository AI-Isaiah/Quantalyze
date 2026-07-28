# Phase 102 — Validation Architecture

**Source:** extracted from `102-RESEARCH.md` (Validation Architecture) + the two PLAN files' `<test>`/`<automated>` blocks. Nyquist dimension 8 artifact.
**Discipline:** every keystone test is authored RED-first inside its TDD task and must go RED when its guarded logic is neutered (test the wiring, not a helper). No watch-mode; every task carries an `<automated>` pytest/vitest verify.

## Phase-Requirements → Test map

| Req / risk | Test (id) | File | Falsifiability (neuter → RED) |
|---|---|---|---|
| **MTM-01** toggle enablement (F-4 gate) | F4-1 | `composite-read-path.test.ts` | Force `computation_status` check always-done → `mtmGate.available` true on a non-DONE row → RED. A failed/insufficient row must NOT expose MTM. |
| **MTM-01** gate reaches single-key surface | wiring behavior tests (6) | `composite-read-path.test.ts`, `FactsheetBody.basis.test.tsx` | Single-key options DONE row with `mark_to_market` present exposes the control; composite arm unchanged. |
| **SC-4** byte-identity (keystone) | SC4-1 | `composite-read-path.test.ts` | Thread the RAW `metrics_json_by_basis` column (stale `cash_settlement` key) instead of `{mark_to_market}` → cash overlay activates (`build-payload.ts:243`) → cash payload perturbed → RED. |
| **SC-4** overlay unit pin | overlay unit | `basis-metrics.test.ts` | `overlayBasisScalars(base, obj.cash_settlement)` for a `mark_to_market`-only object returns `base` (cash untouched). |
| **No-invented-data** leverage×MTM | LEV-MTM-1 | `FactsheetView`/leverage test | Remove the `basis === "mark_to_market"` short-circuit in `leverage-context.tsx:124` guard → leverage-scaled CASH numbers render labeled MTM (fabricated line) → RED. |
| **MTM-02** options-composite honest-disabled (Option A) | compose pin | `test_stitch_composite.py` | Options-member composite returns `(False, unsmoothed_options_book-rewrite)`; per-member gaps MARKED `per_key n_days:0`, never zero-filled → assert both; neuter the gate → RED. |
| **MTM-02** perp-only composite still toggles | verify-only pin | `test_stitch_composite.py` | Native perp composite toggles end-to-end (unchanged). |
| **mtm_anchor_race** label-only classification | anchor-race pin | `test_mtm_single_key.py` | `InceptionReconciliationError` on the MTM pass stamps `mtm_anchor_race` (not `mtm_summary_coverage_incomplete`); degrade semantics byte-identical (cash still ships DONE, no retry-to-failed) → revert the isinstance label → RED. |
| **Reason copy** honest strings + tone split | copy pins | `basis-context.test.tsx`, `FactsheetBody.basis.test.tsx` | Each reason renders its character-exact string; transient reasons (`mtm_second_pass_timeout`, `mtm_anchor_race`) amber, steady-state muted; zero stale smoothing refs in `src/`. |
| **MTM-03** static byte-identity regression | full cash-pin suite | analytics cash pins + frontend goldens | Every existing non-options / cash factsheet byte-identical; the whole cash-pin suite green with zero pin edits (except the 3 sanctioned copy pins). |

## Wave-0 gaps (load-bearing new tests)
- **F4-1** (computation_status-DONE gate) and the **options-composite honest-disabled + marked-coverage compose** test are the load-bearing new coverage; both authored RED-first inside their TDD tasks (no cross-plan Wave-0 dependency — 102-01 = `src/**`, 102-02 = `analytics-service/**`, fully parallel).

## Out of in-phase scope (ship-time gate — NOT validated here)
- **MTM-03 LIVE Zavara MTM corroboration** requires the post-deploy re-derive backfill (no `mark_to_market` data until then). Carried verbatim as a ship-time operational step in `102-02`'s SUMMARY; NO in-phase task claims live attestation.
