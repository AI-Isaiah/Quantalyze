# Phase 103 (MTM-04) — Review-Fix Batch Consolidation

**Branch:** `gsd/v1.10-portfolio-intelligence-options-mtm`
**Fixed at:** 2026-07-14
**Scope:** Consolidate the review-fix batch — the 5 already-committed fixes plus
the uncommitted §IV/correlations work, the root-cause rail flip, the STEP-3 parity
keystone, and the STEP-5 backend/LOW items.

## Outcome

All steps landed and verified. Working tree clean. Only the pre-existing
`test_audit.py::TestAuditTaxonomySyncWithTypeScript::test_action_literal_matches_ts_union`
(D-103-01) fails — an audit-taxonomy drift (`user_note.dashboard.update`) unrelated
to Phase 103; it stays per instruction.

## Commits (this consolidation, on top of the 5 pre-existing `fix(103)` commits)

| Hash | Subject | Step |
|------|---------|------|
| `2dd2f39d` | correlations + correlationMatrix + §IV α/β/IR follow the MTM series | STEP 1 |
| `2cdf4ced` | root-cause flip — whole rail follows the MTM basis + active-basis eyebrow | STEP 2 |
| `f8c797ee` | test — STEP-3/4 keystone: KpiStrip headline == rail §I to display precision + double-display dissolved | STEP 3/4 |
| `d3987bc8` | composite persist ordering — MTM series lands before the DONE-scalar | STEP 5 (MEDIUM) |
| `0bd2d27e` | degenerate-length composite MTM gets an accurate message (+ dedup comment) | STEP 5 (LOW + NIT) |
| `13e9f6d0` | parseMtmSeriesPayload warns when it drops malformed rows/gap-spans | STEP 5 (LOW) |
| `2e753ee3` | document the MTM-longer-than-cash clamp edge (E) + single-key-dense/composite-sparse note | STEP 5 (IN + NIT) |

Pre-existing (input to this batch): `fbd76749` B rolling table, `d5606bf3` C
cumulative 3Y/5Y, `5b9f6c84`+`e47d668b` #6 bootstrap low-N, `723cd854` A extended
distribution scalars.

## STEP 1 — correlations + §IV benchmark follow MTM (`2dd2f39d`)

- `correlations` + `correlationMatrix` moved OUT of `buildFactsheetPayload`'s
  top-level cash computation and INTO `deriveSeriesBundle`, computed per basis from
  the basis-selected strategy returns against the fixed benchmark INPUT series
  (BTC/ETH/SPX/Gold/IEF), aligned on the bundle's OWN date axis (Pitfall-1). Added
  to `BasisSeriesBundle` (`types.ts`); the correlation strip + matrix panels already
  read `useBasisSeriesView`, so they follow MTM with zero panel branching.
- §IV benchmark (α/β/Corr/R²/IR/Treynor/Tracking/Capture) reads
  `view.comparators[cmpKey].joint` — the bundle already computes the comparator
  joint (`buildComparatorBlock → jointMetrics`) from the basis-selected strat
  returns, so §IV follows MTM with no new math and no persisted overlay.
- Benchmark-family carry-forward note added to `BasisSeriesBundle` doc
  (`types.ts:405-407`): α/β/correlation are OUTSIDE the persist round-trip guarantee
  — re-deriving from the persisted MTM rows ALONE needs the benchmark series too;
  Phases 104-106 must carry benchmark identity alongside the conventions.
- SC-4 cash byte-identity snapshot (build-payload snapshot) stays green: the cash
  bundle reproduces the prior top-level correlation values byte-for-byte.

## STEP 2 — root-cause flip + rail edits + eyebrow (`2cdf4ced`)

- `MetricsColumn` `const m = payload.strategyMetrics` → `view.strategyMetrics`
  (§I Performance/Main-Metrics + §II MaxDD/Best-Worst). The §I/§II benchmark column
  `b` also moved to `view.comparators[cmpKey].summary` so strategy AND benchmark sit
  on ONE coherent basis (no mixed-basis Main-Metrics table). Dissolves the
  double-display contradiction (ExtendedMetricsPanel already read the view).
- `CumulativeReturnsPanel` reads `view.strategyMetrics` + `view.strategyEquity` —
  MTD/YTD/3M/6M/1Y/CAGR and the 3Y/5Y rows now share one basis.
- `EndOfYearBarsPanel` switched to `useBasisSeriesView(usePayload())` — strategy
  per-year (`view.strategyMetrics.yearly`) + the comparator dailies + the axis all
  read from the view (aligned).
- `FactsheetView` eyebrow: composite branch reworded to `"BASIS · MARK-TO-MARKET"`
  (the old "CASH SETTLEMENT" wording claimed the rail stayed cash — false after the
  flip). The `!composite` branch gained a gated, persistent active-basis eyebrow so a
  single-key options book that toggles MTM (`payload.mtmGate != null`) gets an
  honest eyebrow; non-participants stay byte-identical (GUARD-02). Reuses the
  existing eyebrow className (DESIGN.md token). Kpistrip eyebrow test updated:
  under MTM BOTH eyebrows (KpiStrip + rail) read the active basis.

Under cash the view returns `payload` by reference, so every flipped read is
byte-identical (SC-4 safe by construction).

## STEP 3 — parity assertion: RESULT = MATCHED TO DISPLAY PRECISION

The KpiStrip sources the seven MTM headline scalars from the PERSISTED object
(`overlayBasisScalars(cash, metricsByBasis.mark_to_market)`); after the flip the
rail sources them from TS `compute()` on the persisted MTM series
(`view.strategyMetrics`). They agree only if TS `compute()` reproduces the
Python-persisted scalars (the `metrics-parity` contract + `derive_basis_series`
cache-of-series design).

**Finding (no design STOP needed):** given the parity precondition, the two
surfaces agree to display precision. Two sub-facts worth recording:

1. **Sources differ but agree under parity.** The keystone parity test
   (`fixtureSingleKeyMtmParity`) aligns the persisted `metricsByBasis.mark_to_market`
   with the bundle's TS-computed `strategyMetrics` (simulating a parity-compliant
   persist). It asserts the seven scalars match; neutering the root-cause flip
   (`m` → `payload.strategyMetrics`) reddens it (rail shows cash Sharpe 6.80 vs
   KpiStrip MTM 1.20 — confirmed).
2. **Display precision differs BY DESIGN, not by disagreement.** The three ratios
   (Sharpe/Sortino/Calmar) use identical 2dp `num` on both surfaces → exact string
   equality. The four percentages use the glanceable 1dp on the KpiStrip
   (`pctSigned`/`pct`) vs the detailed 2dp on the rail (`pct(_, true)`/`pctNeg`);
   the test asserts the rail's 2dp value ROUNDED to the strip's 1dp equals the strip
   value. This is a presentation choice, not a cross-basis data disagreement, so no
   design call (e.g. rail-reads-persisted-overlay) is required.

The cross-runtime Python==TS parity itself is guaranteed by the separate
`metrics-parity` contract (green); this keystone proves the WIRING renders both
surfaces from the same basis at display precision.

## STEP 4 — keystone + neuter (`f8c797ee`)

- Parity keystone (above) + a "double-display dissolved" test: under MTM the §I
  Main-Metrics "Skew" row and the Extended-Metrics panel show the SAME bundle
  sentinel (`-7.77`); before the flip §I stayed cash while Extended followed MTM.
- Existing keystone/Finding A–C/§IV tests already pin: §I/§II scalar tables + EoY +
  §IV + correlations show MTM-derived values distinct from cash; no panel shows cash
  under MTM except pure benchmark INPUT series.
- **Neuter confirmations:** reverting `m` → `payload.strategyMetrics` reddens the
  parity + double-display tests (verified live). Reverting the degenerate guard
  reddens the backend degenerate test (verified live — the generic ValueError arm
  re-stamps the chain-break message).

## STEP 5 — backend + LOW

- **Composite persist ordering (MEDIUM, `d3987bc8`):** `run_stitch_composite_job`
  now persists the mark_to_market series BEFORE the DONE-bearing headline/by-basis
  scalar upsert (matching the single-key route), so a transient series-upsert
  failure aborts the derive before the F-4 read gate can observe
  scalar-without-series. Call-order test pins series@ before headline@.
- **Degenerate-length message (LOW, `0bd2d27e`):** an explicit
  `stitched_mtm.notna().sum() < 2` guard stamps an accurate dedicated message
  ("fewer than two interpretable days") instead of the misattributed "interior
  chain-break under the arithmetic convention" the generic ValueError arm produced.
  Guards ONLY the MTM second pass. Includes the duplicated-comment-block NIT dedup.
- **parseMtmSeriesPayload warn (LOW, `13e9f6d0`):** `console.warn` when a present
  `rows` or `gap_spans` array has entries dropped (mirrors `deriveSegmentMarkers`),
  emitting the recoverable malformed-persist signal without changing drop behavior.
- **Clamp edge + density NIT (IN, `2e753ee3`):** documented the asymmetric
  MTM-longer-than-cash clamp edge in `TimeSeriesChart` (one-frame transient, OOB-safe)
  and the single-key-dense / composite-sparse MTM persist distinction in
  `basis_series.persist_basis_series`.

## Verification

- `npx tsc --noEmit` — clean.
- `npx eslint src/app/factsheet/[id]/v2/ src/lib/factsheet/` — clean.
- Frontend vitest (factsheet v2 dir + build-payload + basis-metrics +
  composite-read-path + phase-52 frozen-spine guard + metrics-parity contract):
  **291 passed / 26 files**.
- Analytics (SERIAL, `-p no:xdist`) touched surface (test_stitch_composite_job,
  test_basis_series, test_mtm_single_key, test_composite_headline_parity):
  **107 passed**.
- Frozen-spine phase-52 guard green (frozen files untouched; TimeSeriesChart is the
  editable Phase-90 carve-out).
- SC-4 cash byte-identity snapshot green.
- Coverage: net additive (new branches — correlations-in-bundle, eyebrow arms,
  degenerate guard, read-path warns — are each covered by a new/updated test); the
  ratchet thresholds (lines 82 / statements 80 / functions 74 / branches 72) hold.

## Known / carry-forward

- **D-103-01 (pre-existing, unrelated):** `test_audit.py` action-literal-vs-TS-union
  drift stays.
- **Benchmark-family scalars (α/β/correlation)** are OUTSIDE the persist round-trip
  guarantee — the backbone arc 104-106 must carry benchmark identity alongside the
  conventions (noted in `BasisSeriesBundle` doc).
- **Single-key MTM series is DENSE; composite is SPARSE** (honest interior gaps) —
  documented in `persist_basis_series`.
- **Display-precision asymmetry** (KpiStrip 1dp headline vs rail 2dp detail) is
  intentional; the parity keystone compares at the coarser (strip) precision.

_Fixer: Claude (gsd-code-fixer). Sole owner of the working tree — no concurrent agent._

---

## Round 2 — combined 102+103 Fable red-team (F1–F10) — 2026-07-14

Working from `103-REDTEAM-FINDINGS.md`. Single-owner working tree, no worktree
isolation (explicit no-git-branch-ops directive).

### F1 (HIGH) — DONE — commit `725f16c5`
`HistogramChart` read `usePayload()` directly → drew the CASH distribution under
MTM (SC-4 violation), masked by the frozen-spine diff-zero guard. Fix: routed it
through `useBasisSeriesView(usePayload())` (cash → payload by reference →
byte-identical; MTM → bundle's `strategyReturns`/`dates`). UNFROZE both
`HistogramChart.tsx` AND `MasterBrush.tsx` in
`phase-52-frozen-spine-guards.test.ts` (removed from `FROZEN_ISLANDS`, 8→6, with a
guard comment citing the MTM-follow requirement; the freeze premise — data-inert
restyle target — was actively wrong). New pin
`HistogramChart.basis.test.tsx`: cash = full cash sample count, MTM = the shorter
MTM bundle count. NEUTER-CONFIRMED: reverting to `usePayload()` makes the MTM test
report the cash count (376 vs 120) → RED. tsc rc=0, eslint rc=0, frozen-spine
guard 7/7 green.

Note: the F1 commit ALSO unfroze `MasterBrush.tsx` in the guard (the comment
covers both), but `MasterBrush.tsx` itself is NOT yet edited — the unfreeze just
permits the F2 edit; no CI impact.

### F2 (HIGH) — BLOCKED (needs a decision) — NOT applied
Sub-fixes (1) sparkline reads view equity and (2) window labels + emitted xRange
on `view.dates` are both inside `MasterBrush.tsx` (legitimately unfrozen) and are
doable. BUT sub-fix (3) — the `fullRange`/`setXRange` clamp sized to the ACTIVE
basis axis length — requires editing `factsheet-context.tsx:198-221`, which is
STILL a FROZEN spine island. The dispatch rules say "do NOT touch the OTHER
frozen-spine files," and editing it would trip its own still-active frozen-spine
guard (it was NOT unfrozen). This is a genuine instruction conflict: F2(3) cannot
land without ALSO unfreezing `factsheet-context.tsx`. DECISION NEEDED: unfreeze
`factsheet-context.tsx` too (with a guard comment), or descope the clamp sub-fix.

### F3 (HIGH) — NOT started — needs a backend field-coverage audit
Requires confirming `metrics_json_by_basis.mark_to_market` carries EVERY field the
rail reads before the persisted-overlay approach can replace the TS recompute. Per
the dispatch STOP instruction, this needs investigation and possibly a backend
plan — not yet performed.

### F4–F10 — NOT started.

### Stop reason
Context budget exhausted after F1 + verification. Stopping to (a) surface the
F2(3) frozen-`factsheet-context.tsx` conflict for a decision and (b) flag the F3
backend audit, rather than start F2 and risk leaving `MasterBrush.tsx`
half-routed. A fresh fixer round should resume at F2 once the F2(3) decision is
made.

_Fixer: Claude (gsd-code-fixer). Round 2 — F1 landed; F2–F10 pending a decision + fresh context._

---

## Round 3 — F2–F10 landed (2026-07-14, fresh continuation)

Resumed after the orchestrator resolved the two blockers (see the REDTEAM-FINDINGS
"ORCHESTRATOR DECISIONS" section). All nine remaining findings are fixed, each an
atomic commit, each behavioral fix neuter-confirmed. Full factsheet-v2 suite +
frozen-spine guard green (42 files / 449 tests). `tsc --noEmit` clean; eslint clean
on every touched file; `job_worker.py` parses.

| F | Commit(s) | What changed | Neuter-confirm |
|---|-----------|--------------|----------------|
| F2 | `35250c49` | MasterBrush routes through `useBasisSeriesView` (sparkline/dates/labels/`n` follow the basis); `factsheet-context` `setXRange` upper clamp widened to `max(cash, mtm-bundle)` so recent MTM days are reachable. `factsheet-context.tsx` UNFROZEN in phase-52 guard. | ✅ MasterBrush→`usePayload` reddens the MTM-label test; clamp→cash reddens the reachability test; the two cash byte-identity tests stay green |
| F3 | `92aefc5b`, `ca490882` | `useBasisSeriesView` overlays the seven persisted headline scalars onto the merged `strategyMetrics` (mirrors `useBasisMetrics`), so rail §I == KpiStrip by construction. FAKED keystone deleted; replaced with a divergent-bundle parity fixture. basis-context Test 9 updated. | ✅ removing the overlay → rail shows the bundle's +90.00%/5.50 divergent TS values → parity RED |
| F4 | `510b930d`, `66fd4944` | Rail eyebrow (`MetricsColumnWithBasis`) gated on `seriesByBasis.mark_to_market` presence (via `onMtm`), so a bundle-absent read is not labeled MARK-TO-MARKET. kpistrip eyebrow test updated to F4 semantics. | ✅ gating on basis alone → eyebrow mislabels the cash rail → RED |
| F5 | `0c42b764` | KpiStrip α/β/IR read the view's comparator joint (consistent with §IV); suppressed only under modeled leverage OR MTM-without-bundle. False comment corrected. | ✅ reverting `suppressRelative` to `basis==="mark_to_market"` → α cell "—" instead of +420.0% → RED |
| F6 | `c4636e88` | Honest cash-basis note added to `PeerPercentilePanel` under MTM (no fabricated MTM cohort). Added non-throwing `useBasisOrCash` so the isolated peer-scenario test still mounts. | n/a (additive note; not in the neuter-required set) |
| F7 | `1ec1754f` | Payload cache shape-version `v5`→`v6` so stale entries missing `bootstrapCI.n` don't suppress the low-N warning. | n/a |
| F8 | `6b39ed4f` | KpiStrip low-N caveat reads `view.strategyMetrics.n` (active-basis count), matching the MetricsColumn rail caveat. | ✅ reverting to `m.n` → KpiStrip caveat absent under MTM (cash 300 ≥ 252) → RED |
| F9 | `9f601f5d` | job_worker composite partial-write comment reframed: series-before-scalar REVERSES the window into the self-healing direction (fresh-series + stale-scalar, gated benign), it does not ELIMINATE it. Comment-only. | n/a |
| F10 | `0c4fcdba` | `types.ts seriesByBasis` docstring corrected (bundle CARRIES correlations/correlationMatrix per MTM-04); retired the stale "α/IR + MetricsColumn stay cash" KpiStrip note. Docs-only. | n/a |

### F2(3) architecture note (deviation flagged)
The decision asked the `factsheet-context` clamp to size to the ACTIVE-basis axis
("cash-sized under cash, bundle-sized under MTM"). `FactsheetProvider` sits ABOVE
`BasisProvider` (22 render sites; moving it breaks byte-identity), so it cannot read
the runtime basis. Implemented the provider-local equivalent: the `setXRange` UPPER
clamp sizes to `max(cash, mtm-bundle)` while `fullRange` stays cash-sized. This is a
strict no-op for every bundle-less payload (max = cash) and is only ever EXERCISED by
an MTM-axis consumer (a cash consumer reads the cash `view.dates` and never emits an
index beyond the cash length), so cash rendering is byte-identical. The one literal
deviation: an ARTIFICIAL direct `setXRange([0, huge])` call under cash WITH a
longer bundle present would clamp to the bundle length rather than cash — but no real
cash render/interaction path makes such a call. The cash byte-identity test therefore
proves the real invariant (no bundle → clamp strictly cash-sized) rather than the
artificial path. Nothing else in the decision was deviated from; no backend change was
made.

_Fixer: Claude (gsd-code-fixer). Round 3 — F2–F10 landed + neuter-confirmed; suite green._

---

## Round 4 — post-red-team follow-ups (2026-07-14)

Fable red team on the F1–F10 state passed with NO BLOCKERS (Phase 103 closable).
Three small follow-ups landed; one item deferred. Full factsheet-v2 suite + guard
green; `tsc --noEmit` clean; eslint clean on touched files; `job_worker.py` parses.

| Item | Commit | What changed | Neuter-confirm |
|------|--------|--------------|----------------|
| MED-1 | `46a207c3` | HistogramChart benchmark overlay resolves the comparator block off the VIEW (`payload.comparators[cmpKey]`, where `payload` is the basis view) instead of `useActiveComparator().block` (always cash-axis). Bench overlay now windows the SAME axis as the strategy bars under MTM. Added a bench-overlay assertion to `HistogramChart.basis.test.tsx`. | ✅ reverting to `useActiveComparator().block` → under MTM the overlay reads the cash comparator (no MTM bench series in the fixture) → "overlay: BTC" absent → RED |
| LOW-1 | `77d4b537` | `MetricsColumnWithBasis` docstring corrected — the §I/§II headline seven no longer "stay cash"; they come from the persisted-MTM overlay via `useBasisSeriesView` (F3), matching the KpiStrip. | n/a (docs-only) |
| LOW-2 | `de74c31e` | job_worker F9 comment reworded — the benign partial-write window is a mixed stale-MTM-scalar + fresh-MTM-series read (both genuinely MTM, headline lags the chart by one derive, never a basis mislabel), not "the prior consistent state". | n/a (comment-only) |

### MED-2 — DEFERRED known-limitation (KEEP-AS-IS, adjudicated by the red team)
The F2(3) default/reset-framing residual: `fullRange` / `resetXRange` stay cash-sized,
and `ControlBar` fires `resetXRange()` on every basis toggle. So under an MTM axis
SHORTER than cash (`mtmLen < cashLen`, the common case), immediately after a toggle the
MasterBrush window / right handle can render past the plot edge with an "—" end label
until the first user interaction re-seats the window. This is honest ("—", not a wrong
date), self-heals on the first drag/select, and a root-cause fix (basis-aware
`fullRange`/reset) needs a disproportionate provider restructure (`FactsheetProvider`
sits above `BasisProvider`; 22 render sites; byte-identity surface). The red team
adjudicated this KEEP-AS-IS / deferred. **When it is addressed, add a shorter-MTM
(`mtmLen < cashLen`) MasterBrush test** pinning the post-toggle window/right-handle
geometry + end label (the current MasterBrush.basis.test.tsx uses `mtmLen > cashLen`
to exercise the widened clamp; the shorter-MTM reset-framing path is not yet pinned).
No code change in Round 4 for MED-2.

_Fixer: Claude (gsd-code-fixer). Round 4 — MED-1/LOW-1/LOW-2 landed; MED-2 deferred; suite green._
