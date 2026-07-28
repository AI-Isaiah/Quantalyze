---
phase: 102-options-mtm-factsheet-composite-regression
plan: 01
subsystem: frontend (factsheet RSC read-path + client basis/leverage context + reason copy)
tags: [mtm, factsheet, basis-toggle, options, sc-4, f-4, reason-copy, no-invented-data]
requires:
  - src/lib/factsheet/basis-metrics.overlayBasisScalars (strict, absent-safe)
  - src/lib/factsheet/basis-metrics.hasBasisHeadline (the one displayability predicate)
  - src/lib/factsheet/build-payload (forwards opts.metricsByBasis / opts.mtmGate verbatim; SC-4 cash overlay :243)
  - src/lib/factsheet/composite-read-path.singleKeyDataQuality (the "one path" single-key owner)
  - Phase 101 persisted strategy_analytics.metrics_json_by_basis.mark_to_market + data_quality_flags.mtm_gated_reason
provides:
  - "singleKeyBasisOpts — the ONE shared single-key MTM read helper (F-4 computation_status gate + SC-4-safe threading of only the mark_to_market key)"
  - "both factsheet surfaces (/factsheet/[id]/v2 + discovery detail) thread the single-key MTM read through that one owner"
  - "widened toggle render gate: composite → (composite || payload.mtmGate present)"
  - "leverage/MTM no-fabrication guard: useLeveragedMetrics short-circuits under mark_to_market; leverage input hidden while MTM is displayed"
  - "honest human copy for all six MTM reasons + a basis-agnostic default + mtmReasonTone (DESIGN.md amber-vs-muted tone split)"
affects:
  - "Phase 102-02 (analytics): owns the mtm_anchor_race reason constant + options-composite compose test; this plan pins the mtm_anchor_race string literal as the cross-language contract"
  - "Ship-time OQ-3: live single-key options MTM rendering will light up only after the post-deploy re-derive backfill populates metrics_json_by_basis.mark_to_market"
tech-stack:
  added: []   # zero new packages (RESEARCH: zero-install phase, no Package Legitimacy Audit)
  patterns:
    - "single-key MTM read is a colocated counterpart of the composite mtmGate assembly (readCompositeFactsheet :167-170) — one owner, both surfaces, cannot diverge"
    - "F-4 is STRUCTURAL: a non-DONE row's payload carries NO metricsByBasis at all (not merely available:false)"
    - "SC-4 by construction: only the mark_to_market key is threaded, never the raw metrics_json_by_basis column — a stale cash_settlement key can never activate the build-payload:243 cash overlay"
    - "no-invented-data extended to leverage×MTM: the cash-series leverage recompute is short-circuited under an MTM label"
key-files:
  created: []
  modified:
    - src/lib/factsheet/composite-read-path.ts
    - src/lib/factsheet/composite-read-path.test.ts
    - src/lib/factsheet/types.ts
    - src/lib/factsheet/basis-metrics.test.ts
    - src/app/factsheet/[id]/v2/page.tsx
    - src/app/(dashboard)/discovery/[slug]/[strategyId]/page.tsx
    - src/app/factsheet/[id]/v2/FactsheetView.tsx
    - src/app/factsheet/[id]/v2/leverage-context.tsx
    - src/app/factsheet/[id]/v2/basis-context.tsx
    - src/app/factsheet/[id]/v2/basis-context.test.tsx
    - src/app/factsheet/[id]/v2/FactsheetBody.basis.test.tsx
decisions:
  - "singleKeyBasisOpts threads ONLY { mark_to_market: mtm } and ONLY when available; never the raw jsonb column (SC-4 keystone made structural)"
  - "F-4 DONE literals are exactly 'complete' and 'complete_with_warnings' — spot-verified against analytics_runner.py:1938-1940 (stored-trades) and :2392 (CSV-broker); no third terminal-success literal exists"
  - "types.ts metricsByBasis.cash_settlement widened to optional (single-key options omits it); both consumers already optional-chain"
  - "leverage models the CASH return path, so useLeveragedMetrics short-circuits under mark_to_market and the leverage input hides while MTM is shown — both guards, hook is the invariant, UI prevents a dead input"
  - "reason copy default made basis-agnostic ('for this strategy'); amber tone reserved for transient reasons (mtm_second_pass_timeout, mtm_anchor_race) only"
  - "mtm_anchor_race string literal pinned here as the cross-language contract; its Python owner ships in plan 102-02"
metrics:
  duration: ~1 session (2026-07-12)
  tasks_completed: 3
  commits: 6
  files_changed: 11
  completed: 2026-07-12
---

# Phase 102 Plan 01: Single-key options MTM factsheet read + honest reason copy Summary

Wired the factsheet `cash_settlement ↔ mark_to_market` SegmentedControl for a single-key options
strategy by READING Phase-101's persisted `metrics_json_by_basis.mark_to_market` through one shared
F-4-gated helper (`singleKeyBasisOpts`) on both surfaces, closed a leverage×MTM fabrication hazard,
and shipped honest DESIGN.md-toned copy for all six MTM disabled reasons — no new valuation math.

## What shipped (by task)

**Task 1 — `singleKeyBasisOpts` (helper + types).** New exported helper: the single-key counterpart
of the composite `mtmGate` assembly, colocated with `singleKeyDataQuality` so both factsheet surfaces
consume one owner. Two load-bearing invariants, both falsifiable:
- **F-4 (structural):** `available` gated on `computation_status ∈ {complete, complete_with_warnings}`
  AND `hasBasisHeadline(mark_to_market)`. `metricsByBasis` is threaded ONLY when `available`, so a
  failed/computing row's payload carries **no MTM object at all** (not merely `available:false`).
- **SC-4 (keystone):** threads ONLY `{ mark_to_market }`, never the raw `metrics_json_by_basis`
  column — a lingering `cash_settlement` key (composite→single stale window) can never reach the
  `build-payload.ts:243` cash overlay. `types.ts` `metricsByBasis.cash_settlement` widened to optional.

**Task 2 — wire both surfaces + widen gate + leverage guard.** `page.tsx` adds `computation_status`
to the `strategy_analytics` select (it was NEVER selected on the factsheet path before — F-4 was
un-evaluable) and threads `singleKeyBasisOpts` on the single-key arm; the discovery detail page
mirrors it (its `strategy_analytics (*)` select already carries the column). Render gate widened
`composite` → `(composite || payload.mtmGate != null)`. **Fabrication hazard found + closed:**
`useLeveragedMetrics` discards the basis-overlaid metrics at L≠1 and recomputes from
`payload.strategyReturns` — the CASH series — so under an MTM label it would render a leverage-scaled
cash line labeled mark-to-market (a fabricated line). Added `basis === "mark_to_market"` to the
identity short-circuit (returns the persisted overlay, `modeled:false`) and hid the leverage input
while MTM is displayed. `basis` added to the `useMemo` deps (exhaustive-deps clean).

**Task 3 — honest reason copy + DESIGN.md tone split.** Rewrote `mtmDisabledReasonCopy` and added
`mtmReasonTone`. The tone is applied to the inline disabled-reason paragraph in `FactsheetView`.

## Exact copy strings shipped (character-exact pins)

| reason | copy | tone |
|---|---|---|
| `unsmoothed_options_book` | `Mark-to-market unavailable: composites that include an options book report cash settlement only.` | steady (muted) |
| `mtm_basis_unavailable_for_venue` | `Mark-to-market unavailable for this venue.` (UNCHANGED) | steady (muted) |
| `mtm_summary_coverage_incomplete` | `Mark-to-market unavailable: settlement history does not fully cover this book, so a mark-to-market series cannot be reconstructed.` | steady (muted) |
| `mtm_series_uncomputable` | `Mark-to-market unavailable: the reconstructed mark-to-market series could not produce valid metrics.` | steady (muted) |
| `mtm_second_pass_timeout` | `Mark-to-market temporarily unavailable: reconstruction exceeded its time budget and will be retried on the next data refresh.` | **transient (amber #B45309)** |
| `mtm_anchor_race` | `Mark-to-market temporarily unavailable: the account changed during reconstruction; it will be recomputed on the next data refresh.` | **transient (amber #B45309)** |
| default | `Mark-to-market unavailable for this strategy.` (was "for this composite") | steady (muted) |

`text-text-muted` (#64748B, WCAG-AA 4.85:1 on white) for steady; amber `var(--color-warning, #B45309)`
for transient only. Zero stale smoothing references remain in `src/`.

## Falsifiability (neuter checks actually performed)

- **F4-1** — forced the DONE gate to `true`: RED (`expected true to be false` — a failed-status row
  exposed a live MTM object). Reverted.
- **SC4-1** — threaded the raw `metrics_json_by_basis` column instead of `{ mark_to_market }`: RED
  (a `cash_settlement` key survived into the payload). Reverted.
- **LEV-MTM-1** — removed the `basis === "mark_to_market"` short-circuit: RED (Cum. Return rendered
  `+146.6%` leverage-scaled cash instead of the persisted `+50.0%` MTM scalar). Reverted.

## Deviations from Plan

**1. [Rule 3 — blocking test-pin the plan's grep missed] Updated a second default-copy pin in `FactsheetBody.basis.test.tsx`.**
- **Found during:** Task 3.
- **Issue:** The plan states "grep-confirmed there is NO analogous default-copy pin in
  `FactsheetBody.basis.test.tsx`." That is inaccurate — the `fixtureCompositeNoReason` case
  (previously `:191-193`) pins the default copy `"Mark-to-market unavailable for this composite."`.
  The mandated default rewrite to `"...for this strategy."` made that assertion RED.
- **Fix:** Updated that one assertion to the new basis-agnostic default — the same sanctioned CLASS
  as the `basis-context.test.tsx:141-144` default-copy edit the plan explicitly authorized. No design
  choice was invented; the new default string is the plan's own authored copy. Documented here and
  flagged for the red team. No cash golden / byte-identity assertion was touched.

Otherwise the plan executed as written. Two other repo references to `unsmoothed_options_book`
(`SyncPreviewStep.composite.render.test.tsx`, `build-payload.arithmetic.test.tsx`) render/use the
RAW reason literal, not `mtmDisabledReasonCopy`, so they are correctly out of scope and untouched
(both suites verified green — 29 + relevant tests pass).

## Known Stubs

None. No hardcoded empty/placeholder values were introduced. `singleKeyBasisOpts` returns `{}` for
every non-options single-key strategy by design (byte-identical no-toggle), which is the honest-empty
contract, not a stub.

## Threat Flags

None. The only new server surface is `computation_status` added to the factsheet select — public-safe
on a published row (already exposed via the PDF route), no per-user-filtered column enters the shared
cache, cache key unchanged. Matches the plan's threat register (T-102-01..04 mitigations implemented
and falsifiably tested; T-102-SC zero-install accepted).

## Verification

- `npx vitest run` over the plan's five verify suites + leverage-context + build-payload.arithmetic:
  **89 passed**. Broad factsheet sweep (`src/lib/factsheet` + `src/app/factsheet`): **395 passed, 39
  files**. `SyncPreviewStep.composite.render`: **29 passed**.
- `npx tsc --noEmit`: clean.
- `npm run lint`: **0 errors**, 1 pre-existing warning in `EquityChart.tsx` (out of scope — not a
  file this plan touched; SCOPE BOUNDARY).
- `git diff --stat`: touches ONLY the 11 files in the plan's `files_modified` — no cash golden, no
  frozen chart island, no `factsheet-context.tsx`, no `analytics-service/**`, no `.planning/**`.
- Full-suite coverage ratchet (Stmts 80 / Branch 72 / Funcs 74 / Lines 82) is the per-wave-merge / CI
  gate, not run here; all new code (`singleKeyBasisOpts`, `mtmReasonTone`) ships with direct tests.

## Ship-time / Phase-102 hand-offs

- **LIVE MTM rendering awaits ship-time OQ-3** (deferred, NOT attested here): no
  `metrics_json_by_basis.mark_to_market` exists for any live single-key options strategy until the
  post-deploy Railway re-derive backfill runs. No task or test in this plan asserts live DB state.
  The static byte-identity + F-4 + SC-4 + leverage/MTM regression is the in-phase MTM-03 half.
- **Plan 102-02 (analytics)** owns the `mtm_anchor_race` reason constant and the options-composite
  compose test; this plan pins the `mtm_anchor_race` string literal as the cross-language contract.
- **Red-team note (observed, not fixed — plan-scoped out):** under `basis=mark_to_market` with a
  residual leverage≠1 (reachable only by dialing leverage on cash then switching to MTM), the
  right-rail `MetricsColumnWithBasis` still shows its "BASE · 1× TRACK" eyebrow because
  `useModeledLeverage` is basis-agnostic. This is honest (the rail is always base-track cash — no MTM
  fabrication) but cosmetically inconsistent with the KpiStrip, which correctly shows no MODELED
  label under MTM. The plan scoped the guard to `useLeveragedMetrics` + the ControlBar input only; a
  future polish could also basis-gate `useModeledLeverage`. Flagged for the red team.

## Self-Check: PASSED

- SUMMARY.md present at `.planning/phases/102-options-mtm-factsheet-composite-regression/102-01-SUMMARY.md`.
- All six task commits verified present: `6515bfb2`, `bc886526`, `807df62f`, `ba3a53a3`, `a259196e`, `845b97a2`.
- All 11 modified files verified in `git diff --stat`; no unexpected files touched.
