---
phase: 159-rank-public-ranking-integrity
plan: 04
subsystem: analytics
tags: [annualization, sharpe, volatility, blend, asset-class, money-math, closed-sets, vitest]

# Dependency graph
requires:
  - phase: 084-blend-annualization
    provides: "blendPeriodsPerYear + the four production call sites that thread the blend basis into computeScenario"
  - phase: 136-closed-sets-registry
    provides: "closed_sets.py CRYPTO_VENUES — the Python half of the unknown-asset_class class, already closed"
provides:
  - "blendPeriodsPerYear treats a nullish-asset_class leg as crypto for RISK annualization (√365), closing the TS half of the projection-gap Sharpe-inflation class"
  - "Empty-legs behavior preserved at 252 with an explicit length guard and a docblock that states empty vs all-unknown as two different answers"
  - "A wiring pin at the scenario-compare production call site whose oracle is the √(365/252) clock ratio, not the helper's own formula"
  - "Four-site audit confirming every call site rides the one helper, carries no local 365/252 ternary, and feeds RISK only"
affects: [159-05 quantstats sign-flip, 160 venue provenance, any future blend KPI surface]

actuals:
  tokens: 7904          # chars/4 over the realized diff (31,616 chars)
  tasks: 2
  commits: 4

tech-stack:
  added: []
  patterns:
    - "Unknown-input-fails-conservative for money math: a nullish field that the DB declares NOT NULL is a caller projection gap, and the safe resolution is the one that cannot flatter the number"
    - "Clock-ratio invariant oracle: drive the SAME production path twice (gap leg vs stated-traditional leg) and assert the output ratio equals √(365/252)"

key-files:
  created: []
  modified:
    - src/lib/closed-sets.ts
    - src/lib/closed-sets.test.ts
    - src/app/(dashboard)/allocations/lib/scenario-compare.ts
    - src/app/(dashboard)/allocations/lib/scenario-compare.test.ts
    - src/app/scenario-share/[token]/share-resolve.ts
    - src/app/scenario-share/[token]/share-resolve.test.ts
    - src/app/(dashboard)/allocations/components/ScenarioComposer.tsx
    - src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx

key-decisions:
  - "Nullish only, not unrecognized strings: RANK-06 widens the crypto arm to null/undefined/absent, while a non-null unrecognized value ('CRYPTO') still reads traditional √252 — a caller that DID supply a class is not a projection gap"
  - "Empty legs array keeps 252 via an explicit length guard placed BEFORE the some() — with no legs there is no dropped class, so there is no gap to fail safe about"
  - "annualizationPeriods (the single-strategy sibling) is deliberately NOT changed — its unknown cannot arise from a blend-leg projection gap"
  - "The 252 byte-identity pins were MOVED to explicitly-traditional legs rather than deleted, so the traditional clock keeps a live regression pin on every affected surface"

patterns-established:
  - "Economic-invariant oracle for a clock change: assert the ratio between two runs of the same production path over the same series (√(365/252)), never the implementation's returned constant"
  - "Scope fence assertions travel with the fix: every RANK-06 pin also asserts twr/cagr/max_drawdown are byte-identical across clocks, so a future widening into RETURN space goes RED"

requirements-completed: [RANK-06]

coverage:
  - id: D1
    description: "blendPeriodsPerYear resolves an unknown (absent/null/undefined) asset_class leg to the crypto RISK clock (365), while an empty legs array still returns 252"
    requirement: "RANK-06"
    verification:
      - kind: unit
        ref: "src/lib/closed-sets.test.ts#blendPeriodsPerYear: √365 if ANY leg is crypto OR unknown-class, else √252 (#597 blend rule as revised by RANK-06)"
        status: pass
    human_judgment: false
  - id: D2
    description: "The unknown-leg clock change is pinned by an economic invariant — annualized vol on the 365 clock is √(365/252)× the 252-clock vol on the same series"
    requirement: "RANK-06"
    verification:
      - kind: unit
        ref: "src/lib/closed-sets.test.ts#blendPeriodsPerYear economics (RANK-06): an unknown-class blend annualizes vol at √(365/252) ≈ 1.204× the traditional blend on the SAME series"
        status: pass
    human_judgment: false
  - id: D3
    description: "The fix is proven at a production call site: computeMetricsForDraft with a leg whose metadata OMITS asset_class produces 365-basis RISK output, and RETURN space is unmoved"
    requirement: "RANK-06"
    verification:
      - kind: integration
        ref: "src/app/(dashboard)/allocations/lib/scenario-compare.test.ts#RANK-06 wiring: an added-only draft whose sole leg OMITS asset_class annualizes RISK on the 365 clock — vol/sharpe/sortino are exactly √(365/252) / (365/252)× the explicitly-traditional run of the SAME series"
        status: pass
      - kind: integration
        ref: "src/app/(dashboard)/allocations/lib/scenario-compare.test.ts#RANK-06 wiring control: a null asset_class behaves identically to an ABSENT one at the call site (both are the same projection gap)"
        status: pass
    human_judgment: false
  - id: D4
    description: "All four production call sites still derive the basis from the one helper, carry no local 365/252 ternary, and feed RISK only (#597 scope intact)"
    requirement: "RANK-06"
    verification:
      - kind: other
        ref: "grep -rl 'blendPeriodsPerYear' over the four call-site files returns 4; grep for '? 365'/'365 : 252' at those sites returns 0"
        status: pass
      - kind: unit
        ref: "src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx#RANK-06: an all-unknown-asset_class added-only blend derives periodsPerYear=365 (a lazily-unresolved class is a projection gap, not a tradfi leg)"
        status: pass
      - kind: unit
        ref: "src/app/scenario-share/[token]/share-resolve.test.ts#RANK-06: no lookup and an EMPTY lookup are byte-identical, and both are the √365 projection-gap case"
        status: pass
    human_judgment: false
  - id: D5
    description: "Published Sharpe/vol on already-live shared scenarios and saved compare drafts will VISIBLY change for any blend whose legs arrive without a class — the honest direction, but a user-visible number movement"
    verification: []
    human_judgment: true
    rationale: "No test can decide whether the visible movement on existing shared/saved scenarios is acceptable to surface without a note; that is a product/UAT call for the phase's verification pass."

duration: 24 min
completed: 2026-08-21
status: complete
---

# Phase 159 Plan 04: RANK-06 blend RISK clock — unknown asset_class fails toward crypto

**A blend leg whose `asset_class` never made it through a caller's projection now annualizes RISK on the √365 crypto clock instead of √252, closing a ~17% volatility understatement (≈ ×1.20 Sharpe inflation) that all four blend surfaces inherited from one helper.**

## Performance

- **Duration:** 24 min
- **Started:** 2026-08-21T12:44:00Z
- **Completed:** 2026-08-21T13:08:00Z
- **Tasks:** 2 of 2
- **Files modified:** 8

## Accomplishments

- **The one decision point moved.** `blendPeriodsPerYear` now flips to 365 when a leg's `asset_class` is `null`/`undefined`/absent, not only when it equals `"crypto"`. Because `strategies.asset_class` is `NOT NULL DEFAULT 'traditional'` in the DB, a nullish leg reaching this helper is never a strategy that IS traditional — it is a lossy caller projection, and resolving it to 252 always failed in the flattering direction.
- **Empty stays 252, all-unknown becomes 365 — stated explicitly.** The old docblock sentence ("An empty or all-unknown blend keeps the 252 pre-#597 default byte-identical") was half false after this change; it is replaced by a block that names both cases and their different reasons, plus the #597 RISK-only scope law.
- **The economics are pinned by invariants, not by the implementation.** Two oracles: the √(365/252) clock ratio applied to a fixture series at the helper level, and the same ratio measured across two runs of the real `computeMetricsForDraft` path (gap leg vs stated-traditional leg) at the call-site level. Neither re-evaluates `blendPeriodsPerYear`'s own formula.
- **The scope fence is asserted, not just documented.** Every RANK-06 pin also asserts `twr`, `cagr`, and `max_drawdown` are byte-identical across the two clocks, so a future change that leaks the frequency clock into RETURN space goes RED.
- **Four-site audit completed** (table below): all four sites ride the single helper, none carries a local 365/252 ternary, and every consumer of the basis is RISK.

## Task Commits

1. **Task 1 (tracer, TDD): unknown-leg-as-crypto at the helper**
   - RED — `399d9998` (test)
   - GREEN — `a391332b` (fix)
2. **Task 2 (TDD): wiring pin at a production call site + four-site audit** — `13585f54` (test)
3. **Deviation: sibling call-site pins updated to the new economics** — `b59fa91f` (test)

_No `refactor` commit — the GREEN implementation is a two-line predicate and needed no cleanup._

## Files Created/Modified

- `src/lib/closed-sets.ts` — `blendPeriodsPerYear`: nullish-leg predicate + explicit empty-legs guard; docblock rewritten (empty vs all-unknown, RANK-06 rationale, RISK-only scope, deliberate asymmetry with `annualizationPeriods`).
- `src/lib/closed-sets.test.ts` — the #597 blend pin updated to the revised economics; new economic-invariant pin on the √(365/252) ratio.
- `src/app/(dashboard)/allocations/lib/scenario-compare.test.ts` — two RANK-06 wiring pins; the 252 byte-identity pin moved from all-null legs to explicitly-traditional legs.
- `src/app/(dashboard)/allocations/lib/scenario-compare.ts` — call-site comment corrected (comment only, no logic).
- `src/app/scenario-share/[token]/share-resolve.test.ts` — two contradicting pins updated, one vacuity hole closed (see deviation 1).
- `src/app/scenario-share/[token]/share-resolve.ts` — call-site comment corrected (comment only, no logic).
- `src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx` — contradicting pin updated + strengthened.
- `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx` — call-site comment corrected (comment only, no logic).

## Observed REDs (anti-vacuity evidence)

Every pin in this plan was watched fail for the right reason.

| Pin | Mechanism | Observed failure |
|-----|-----------|------------------|
| Helper Test 1 (`[{}]` → 365) | Pre-fix RED, before the helper edit | `expected 252 to be 365` at `closed-sets.test.ts:213` |
| Helper economic invariant | Pre-fix RED, before the helper edit | `expected 1 to be close to 1.2035001862952488` at `closed-sets.test.ts:264` |
| Helper Tests 1 + invariant | Neuter drill — predicate reverted to `asset_class === "crypto"` only | Both RED again with identical messages; restored, re-verified GREEN |
| Wiring pin + wiring control | Neuter drill — `const basis = 252` hardcoded at `scenario-compare.ts:349` | Both RANK-06 wiring tests RED (5 failed / 28 passed); restored, re-verified GREEN |

The wiring neuter also took down the three pre-existing BLEND-01 pins, confirming the drill really severed the call site from the helper rather than perturbing the fixture.

## Four-site audit (RANK-06 acceptance)

`grep -rl 'blendPeriodsPerYear'` over the four call-site files returns **4/4**. `grep` for `? 365` / `365 : 252` / `? 252` at those sites returns **0** — no site carries a local ternary.

| # | Call site | Leg source & projection | Can `asset_class` be absent today? | What the basis feeds |
|---|-----------|------------------------|-----------------------------------|----------------------|
| 1 | `src/app/(dashboard)/allocations/lib/scenario-compare.ts:349` (`computeMetricsForDraft`) | `adapterOutput.strategies` filtered by `selected`. Added legs read `addedStrategyMetadataLookup[id].asset_class`, which `ScenarioComparePanel.tsx:202` writes as `?? null`. Per-key units are tagged `"crypto"` by the 84-01 adapter. | **YES** — the panel's `?? null` is the documented gap for an SSR payload missing the column. This is the site the wiring pin drives. | `computeScenario(..., basis)` 4th arg → `volatility`, `sharpe`, `sortino` only. |
| 2 | `src/lib/queries.ts:3013` (live-baseline `computeScenario`) | Per-key units constructed inline at `:2985` with a literal `asset_class: "crypto"` (every per-key unit is a connected exchange = crypto venue, BLEND-02). | **No** — the field is written unconditionally at construction; there is no projection to drop it. Behavior here is unchanged by RANK-06. | `computeScenario(..., blendPeriodsPerYear(strategies))` → RISK only. Site comment re-read and still true (it claims all legs are crypto and that a future pure-tradfi key would return 252 — both hold). **Not edited** (file is owned by plan 159-03 this wave). |
| 3 | `src/app/scenario-share/[token]/share-resolve.ts:363` | `strategies.filter(selected)`, each built at `:237` as `asset_class: assetClassById?.[id] ?? null` from a published-rows-only strategies read. | **YES, routinely** — the whole no-lookup path (and any leg missing from `assetClassById`) arrives null. | `computeScenario(..., basis)` → RISK only; `basis` is echoed as `ResolvedOk.periodsPerYear` (`:385`) and threaded to `ScenarioBenchmarkSection`, whose consumers (tracking error, alpha/beta) are also RISK. |
| 4 | `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx:3222` | `engineSet.strategies` filtered by `engineState.selected`; added legs' class comes from the lazy `/returns` probe (`.select("id, asset_class")`), null when the probe returns no row. | **YES** — an unresolved probe leaves the class null (this is exactly the case the composer pin now covers). | `blendBasis` → `computeScenario`, `deriveBlendPanels` (rolling vol/sharpe/sortino), `sampleBasisRatios` (sharpe/sortino/maxDD), factsheet `periodsPerYear`, benchmark `periodsPerYear`. All RISK. The peer-rank path is explicitly fenced off the display basis. |

**RISK-only confirmation (the STOP condition did not trigger).** Traced to the arithmetic, not just the comments:
- `src/lib/scenario.ts:523-537` — `years = calendarYears(first, last)`, so `cagr` is `periodsPerYear`-invariant; `periodsPerYear` appears only in `volatility`, `sharpe`, `sortino`.
- `src/lib/factsheet/compute.ts:36-49` — `years = days / 365.25`; `cagr` and therefore `calmar` are basis-invariant.
- `src/lib/sample-basis-ratios.ts:81-82` — vol/sharpe/sortino only.
No call site routes the basis into a RETURN/CAGR computation, so there is no #597 violation to surface.

## Decisions Made

1. **Nullish widens; string matching does not.** `{ asset_class: "CRYPTO" }` still reads traditional 252. A caller that supplied *a* class is not a projection gap, and widening the match would quietly re-open the case/alias drift the closed-set exists to prevent.
2. **Empty-legs guard placed before `some()`** rather than relying on `[].some()` returning false — the guard is now load-bearing documentation of a decision, not an accident of JS semantics.
3. **`annualizationPeriods` left alone.** Its unknown→252 default is keyed off a single strategy's own stored class, where the projection-gap argument does not apply. The asymmetry is called out in the docblock so a future reader does not "harmonize" the two.
4. **252 pins relocated, not deleted.** Each surface that lost its all-null 252 pin gained an explicitly-traditional one, so the traditional clock remains regression-pinned everywhere it was before.
5. **`queries.ts` left untouched** despite being an audited call site — its prose is still accurate and the file belongs to the concurrent plan 159-03. No merge risk taken for a no-op edit.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Three sibling test pins asserted the superseded unknown-leg economics**
- **Found during:** Task 2
- **Issue:** The helper change is a deliberate economics change, so pins written against the old rule went RED: `share-resolve.test.ts` ×2 (`bare.periodsPerYear` expected 252) and `ScenarioComposer.test.tsx` ×1 (all-unknown blend expected 252). Leaving them would have meant either a red suite or a suite that contradicts the requirement it is supposed to protect.
- **Fix:** Updated each to the new economics and added the missing counterpart: `share-resolve.test.ts` now carries an explicitly-traditional 252 control on the same row (that arm previously did not exist there), and the composer pin now positively asserts every selected leg's class is nullish so it cannot pass for the wrong reason.
- **Files modified:** `src/app/scenario-share/[token]/share-resolve.test.ts`, `src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx`
- **Verification:** `npx vitest run` — share-resolve 31/31, ScenarioComposer 334/334.
- **Committed in:** `b59fa91f`

**2. [Rule 1 - Bug] A share-page pin became vacuous under the new rule**
- **Found during:** Task 2
- **Issue:** `"an added-only draft's asset_class comes from the lookup…"` proved the any-crypto rule by tagging `STRAT_A` crypto and leaving `STRAT_B` **absent** from the lookup. Post-fix, an absent leg alone derives 365 — so the test would have passed with or without the crypto tag: a test that can no longer fail for its stated reason.
- **Fix:** `STRAT_B` is now explicitly `"traditional"`, restoring the "one crypto leg among traditional legs flips the blend" claim, with the reason recorded in the test body.
- **Files modified:** `src/app/scenario-share/[token]/share-resolve.test.ts`
- **Verification:** Included in the 31/31 share-resolve run.
- **Committed in:** `b59fa91f`

**3. [Rule 2 - Missing critical] Three call-site comments falsified by the fix**
- **Found during:** Task 2 (audit read)
- **Issue:** `scenario-compare.ts:347`, `share-resolve.ts:362`, and `ScenarioComposer.tsx:3202` each asserted in prose that an all-unknown blend derives 252. After the fix these are lies sitting at the exact decision points a future reader consults — the house rule is that comment findings get fixed in the same pass.
- **Fix:** Each corrected to describe the projection-gap semantics and to name where its own nulls come from (the panel's `?? null`, the published-rows lookup, the lazy `/returns` probe). Comment text only — zero logic change in all three files.
- **Files modified:** `src/app/(dashboard)/allocations/lib/scenario-compare.ts`, `src/app/scenario-share/[token]/share-resolve.ts`, `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx`
- **Verification:** `npm run lint` clean; `npx tsc --noEmit` clean; suites green.
- **Committed in:** `13585f54` (scenario-compare), `b59fa91f` (share-resolve, composer)

---

**Total deviations:** 3 auto-fixed (2 × Rule 1, 1 × Rule 2)
**Impact on plan:** All three follow directly from the requirement's deliberate economics change — updating pins that contradict the requirement and prose that now misstates behavior. No scope creep: no production logic outside `blendPeriodsPerYear` changed, and the plan's `files_modified` list grew only by the four sibling call-site/test files the change necessarily touched.

## Issues Encountered

**Blast radius measured before acting, not assumed.** Rather than guess which pins the economics change would break, the suite was run with `-t "blend"` across the repo first: exactly 4 tests in 3 files failed, all of them deliberate old-economics pins. The `scenario-compare` failure was itself confirmation of the fix — `volatility` moved `0.15596 → 0.1877`, a ratio of 1.20351 against the √(365/252) = 1.20350 invariant.

**Worktree had no `node_modules`** (known GSD limitation). Resolved by symlinking the main checkout's `node_modules` read-only; no `npm install` was run.

## Verification Results

| Gate | Command | Result |
|------|---------|--------|
| Task 1 | `npx vitest run src/lib/closed-sets.test.ts --no-file-parallelism` | 40/40 pass |
| Task 1 prohibition | `git diff --stat <base> HEAD -- analytics-service/` | empty — zero Python files touched |
| Task 2 | `npx vitest run scenario-compare.test.ts closed-sets.test.ts --no-file-parallelism` | 73/73 pass |
| Task 2 four-site grep | `grep -rl 'blendPeriodsPerYear' <4 files> \| wc -l` | 4 |
| Venue-literal prohibition | added lines in the plan diff matching `deribit\|binance\|okx\|bybit\|sfox` | 0 |
| Blend-adjacent suites | share-resolve (31), ScenarioComposer (334), ScenarioComparePanel + AllocationsTabs (42), benchmark/factsheet/adapter/scenario/queries-my-allocation/phase-63/phase-84/bridge-seam (254) | all pass |
| Lint | `npm run lint` | 0 errors (2 pre-existing warnings in untouched files) |
| Types | `npx tsc --noEmit` | clean |
| CI parity | node@22 run of the three money-math suites | 104/104 pass |

## Known Stubs

None. No placeholder values, no skipped tests, no unrun `<verify>` commands.

## Threat Flags

None. This plan adds no network endpoint, auth path, file-access pattern, or schema change. T-159-11 is mitigated (unknown→crypto at the one helper, wiring-pinned), T-159-12 is mitigated (RISK-only scope asserted in every pin and traced to the arithmetic at three consumers), T-159-13 is mitigated (zero venue literals added; `analytics-service/` untouched).

## Note for the orchestrator (ledger)

No `WINDOWS.md` entry is required — this plan closed with zero stubs, zero skipped tests, and all `<verify>` gates run. The three deviations are documented above and are all closed, not deferred.

## Next Phase Readiness

RANK-06 is complete: ROADMAP 159 SC-4's second arm holds. `blendPeriodsPerYear` is the single decision point, all four production call sites inherit the fix, RETURN clocks are unmoved and asserted so, and no second venue/asset-class literal entered the TS side.

**One thing the phase's verification pass should look at:** this change moves user-visible Sharpe/vol numbers on any already-shared or already-saved scenario whose legs reach the blend without a class — downward on Sharpe, upward on vol. That is the honest direction and the point of the requirement, but it is a visible movement on live surfaces (coverage entry D5), so it belongs in phase UAT alongside the RANK-01 census's expected visible changes rather than shipping silently.

---
*Phase: 159-rank-public-ranking-integrity*
*Completed: 2026-08-21*
