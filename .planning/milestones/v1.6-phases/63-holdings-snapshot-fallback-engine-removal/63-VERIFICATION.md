---
phase: 63-holdings-snapshot-fallback-engine-removal
verified: 2026-07-03T20:48:00Z
status: passed
score: 5/5 must-haves verified
overrides_applied: 0
---

# Phase 63: Holdings-Snapshot Fallback Engine Removal — Verification Report

**Phase Goal:** The scenario surfaces build their engine set purely in series space — the holdings-snapshot fallback engine and its alias machinery are gone; gate=false books fall back to blank mode honestly.
**Verified:** 2026-07-03T20:48:00Z
**Status:** passed
**Re-verification:** No — initial verification
**Diff bases:** phase base `4b852f13`; GUARD-03 also checked against `origin/main`. Branch `v1.6-membership-schema-v4`.

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Composer + compare engine sets exclusively per-key + added units; `buildStrategyForBuilderSet` + call sites GONE; compare legacy path GONE (ENGINE-01/02) | ✓ VERIFIED | Tree-wide grep: `buildStrategyForBuilderSet` appears ONLY in the ENGINE-05 guard's ban-token list. Composer: all 5 banned identifiers 0 hits; `buildAddedOnlySet` wired at ScenarioComposer.tsx:1805 (blank/gate=false branch). Compare: all 5 banned identifiers + `holdingReturnsByScopeRef` 0 hits; `buildAddedOnlySet` wired at scenario-compare.ts:201. Composer + compare + panel + share suites re-run: 214/214 green. |
| 2 | gate=false book → BLANK mode + calm DSRC-02 note; never broken/empty book UI; CR-01 semantics: forced-blank reopen of a matching book draft APPLIES the draft, single shared drift predicate (ENGINE-03) | ✓ VERIFIED | Code: `canEnterBook = hasLiveBook && payload.perKeyDailiesGateSatisfied` (:698), init `canEnterBook ? "book" : "blank"` (:700), `handleEntryModeSelect` refuses book at gate=false (:1145), `showDataSourcesFallback = hasLiveBook && !gate && eligible>0` (:1841-1844), locked copy "Per-source modeling needs per-key history." + testid intact (:3283-3286). CR-01 fix: ONE shared `isDraftDrifted(draftFp, gatedFp, liveFp)` (scenario-state.ts:229) consumed by BOTH the hook (useScenarioState.ts:228, :269 via `driftReferenceHoldings`, default = gated summary) and `openSavedScenario` (ScenarioComposer.tsx:1250); composer passes `rawHoldingsSummary` (:733). Tests: 4 ENGINE-03 render pins (:1667-1742), CR-01 case-(a) composer test (:1762 — applied draft, no false banner, Commit reflects applied book, MEMBER-04 intact), 4 hydrate pins (case a, case a cont./baseOf, case b, stale) — all re-run green. No silent blank-default PUT path remains. |
| 3 | Alias collapse (`scenario-dealias.ts`, `symbolByHoldingId`) retired ONLY after the 3-precondition gate, as a reviewed re-baseline act (ENGINE-04) | ✓ VERIFIED | `src/lib/scenario-dealias.ts` + `.test.ts` ABSENT. Zero non-test `scenario-dealias` references (grep exit 1). Re-baseline commit `833a1c64` message carries the full rationale + all three preconditions recorded green BEFORE the delete: (a) avg-ρ composer 162/162, (b) no-alias adapter 15/15 (BAO4), (c) both importer greps empty. gate=false SSR baseline is the honest `emptyLiveBaselineMetrics` (queries.ts:2123, ternary at :3063-3067 — AUM preserved, metrics null); `liveBaselineMetricsFromHoldings` absent from all production sources. |
| 4 | ENGINE-05 grep-guard fails on reintroduction; P61 suites survive verbatim or individually reviewed-repointed (GUARD-02) | ✓ VERIFIED | Guard `src/__tests__/phase-63-series-space-guards.test.ts` 33/33 green. **Non-vacuity independently proven by this verifier**: planted `collapseAliasedHoldingStrategies` into scenario-compare.ts → guard went red (1 failed); reverted → 33/33 green (working tree restored clean). Runtime layer covers all 3 surviving builders. P61 survivors present + green: composer P61-BUG-1 describe (:7087), compare P61-BUG-2 + surviving series-space F5 pin (scenario-compare.test.ts:649 — member_count 0, member_ids [], twr null at gate=true), T_CP8 (panel :340), share T_SH13/T_SH14 (route.test.ts:368/:383). Both do-not-touch overrides audited — see Judgment Calls + Override Audit below. |
| 5 | GUARD-01 prod residue deleted (0 gate=false holders, residue users KEPT); GUARD-03 frozen engine zero-diff | ✓ VERIFIED | GUARD-03 independently run: `git diff origin/main..HEAD -- src/lib/scenario.ts src/lib/scenario-window.ts` = 0 lines AND `git diff 4b852f13..HEAD` = 0 lines. GUARD-01: orchestrator-executed on prod khslejtfbuezsmvmtsdn, evidence recorded in 63-05-SUMMARY — authoritative gate=false-holders query returned EXACTLY 2 (both phase10-rpc residue), 3 allocator_holdings rows deleted, post-delete gate_false_holders = 0, both auth.users rows KEPT. (Verifier session has no Supabase access; accepted on the recorded four-step A1→A2→DELETE→VERIFY evidence chain per the verification grounding. Plan's "2 residue users" vs actual 8 residue *users* / 2 *holders* imprecision is documented and immaterial — the deletion was keyed to the 2 execution-time-confirmed holder UUIDs.) |

**Score:** 5/5 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `scenario-adapter.ts` → `buildAddedOnlySet` | ONE shared added-only construction | ✓ VERIFIED | Exported; equivalence + no-alias + id-format pins in adapter suite (15/15 re-run green) |
| `ScenarioComposer.tsx` | series-space-only engine selection + ENGINE-03 gating | ✓ VERIFIED | Wired + all banned identifiers absent; WR-01 fix: `applyWeightOverrides(weights, basisIds)` over the SELECTED engine ids (:3721-3724) |
| `scenario-compare.ts` | legacy holdings path deleted; shrunk inputs | ✓ VERIFIED | else-branch → `buildAddedOnlySet`; `ScenarioCompareInputs` holdings fields gone; WR-03 JSDoc corrected (em-dash gate-off) |
| `src/lib/queries.ts` | gate=false SSR → `emptyLiveBaselineMetrics` | ✓ VERIFIED | :2123 helper, :3063-3067 ternary; 3-token banned subset absent |
| `src/lib/scenario-dealias.ts` (+test) | DELETED | ✓ VERIFIED | Absent; reviewed re-baseline commit 833a1c64 |
| `src/__tests__/phase-63-series-space-guards.test.ts` | ENGINE-05 dual-layer guard | ✓ VERIFIED | 33/33; non-vacuity re-proven live by verifier |
| `scenario-state.ts` / `useScenarioState.ts` | CR-01 shared drift predicate | ✓ VERIFIED | `isDraftDrifted` single SoT; `driftReferenceHoldings` threaded |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| Composer blank/gate=false branch | `buildAddedOnlySet` | direct call :1805 | WIRED | real-path render tests green |
| Compare empty-membership branch | `buildAddedOnlySet` | direct call scenario-compare.ts:201 | WIRED | F5 series-space pin :649 green |
| entryMode init | `perKeyDailiesGateSatisfied` | `canEnterBook` :698-700 | WIRED | ENGINE-03 render pins green |
| `showDataSourcesFallback` | `hasLiveBook` (not entryMode) | :1841-1844 | WIRED | Pitfall-2 pair test green |
| Hook `storedMismatch` + `openSavedScenario.drifted` | `isDraftDrifted` | shared predicate, drift ref = `rawHoldingsSummary` | WIRED | CR-01 composer + 4 hydrate pins green |
| Optimizer apply-back | `scenario.applyWeightOverrides(weights, basisIds)` | engine-universe basis :3721-3724 | WIRED | WR-01 mixed-path regression pin (scenario-state suite) |
| SSR gate=false | `emptyLiveBaselineMetrics` | queries.ts ternary :3063-3067 | WIRED | queries.my-allocation emptyDefault pins in full suite |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| ENGINE-05 guard + hydrate + adapter | `npx vitest run` (3 files) | 58/58 passed | ✓ PASS |
| Guard non-vacuity (fails on reintroduction) | plant banned token → run guard → revert | red (1 failed) → restored → 33/33 green | ✓ PASS |
| GUARD-02 survivor suites | composer + compare + panel + share route | 214/214 passed | ✓ PASS |
| Full suite (independent re-run of the 7450/0 claim) | `npx vitest run --no-file-parallelism` | **7450 passed / 0 failed / 288 skipped** (624 files) | ✓ PASS |
| TypeScript | `npx tsc --noEmit` | exit 0 | ✓ PASS |
| GUARD-03 both bases | `git diff` origin/main + 4b852f13 | 0 lines each | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan | Status | Evidence |
|-------------|------------|--------|----------|
| ENGINE-01 | 63-02 | ✓ SATISFIED | Truth 1 (composer) |
| ENGINE-02 | 63-03 | ✓ SATISFIED | Truth 1 (compare) |
| ENGINE-03 | 63-02 (resequenced from 63-01) | ✓ SATISFIED | Truth 2 |
| ENGINE-04 | 63-04 | ✓ SATISFIED | Truth 3 |
| ENGINE-05 | 63-05 | ✓ SATISFIED | Truth 4 (non-vacuity re-proven) |
| GUARD-01 | 63-05 | ✓ SATISFIED | Truth 5 (documented prod evidence chain) |
| GUARD-02 | 63-02/03/05 | ✓ SATISFIED | Truth 4 |
| GUARD-03 | all plans | ✓ SATISFIED | Truth 5 (0 lines, both bases) |

No orphaned requirements — REQUIREMENTS.md maps exactly these 8 IDs to Phase 63; all claimed by plans.

### Anti-Patterns Found

| File | Pattern | Severity | Impact |
|------|---------|----------|--------|
| — | TBD/FIXME/XXX scan across all 11 phase-modified production files | none found | — |

Advisory doc-rot from the phase gate (scenario.test.ts / EquityChart comments citing the deleted `liveBaselineMetricsFromHoldings`) was FIXED post-review (commit 63ccbbf1) — grep confirms 0 remaining non-guard references.

### Judgment-Call Verdicts (orchestrator-level)

**(a) ENGINE-03 resequencing into 63-02 Task 0 — SOUND.** The blank-init flip and the ENGINE-01 deletion are genuinely inseparable for the composer suite: 9 GUARD-02 break-by-construction tests required the (gate=false AND book) state ENGINE-03 removes; landing ENGINE-03 alone would have forced `it.skip` on a shipped feature's suite or out-of-scope machinery work. The decision is documented in both plans (RESEQUENCED comments), the Wave-1 artifacts (RED commit 6a0960a1 + GREEN patch) were preserved and consumed, ENGINE-03's full spec was carried verbatim, no intermediate branch state ever shipped a gate=false book mode with no engine, and the final code satisfies every ENGINE-03 acceptance criterion (verified in code + tests above). Requirement accounting moved correctly (63-02 claims ENGINE-01 + ENGINE-03). No hazard found.

**(b) CR-01 case-(a) product choice (APPLY the matching book draft on forced-blank reopen) — SOUND.** The alternative (refuse/blank-default) is what produced the original data-loss hazard (silent blank-default PUT over a saved book draft). The chosen semantics close it: the draft is applied, `baseOf` honors the live book (no rebase-to-blank on next edit), the false drift banner is gone, the gate=false engine drops ineligible members honestly via the existing MEMBER-04 disclosure, and Commit reflects exactly the applied draft. All four behaviors are RED-first test-pinned (composer :1762 + 4 hydrate pins) and consistent with compare's membership-∩-eligible selector semantics. No concrete hazard found; Phase 65's authed canary covers the live reopen round-trip by design.

### Override Audit (the two do-not-touch deviations)

1. **F5 ":700 prod shape" retirement (Wave 3):** the retired test built an inline holdings `ScenarioCompareInputs` literal that no longer type-checks (fields structurally deleted); its masked-bug premise is impossible in series space. The surviving pin (scenario-compare.test.ts:649) is a genuine series-space F5 closure — non-empty per-key series + gate=true asserting `member_count 0` / `member_ids []` / `twr null`, falsifiable against a gate-only selector. Verified present + green. Sound.
2. **CR-01-strengthened reopen-edge test:** the original ENGINE-03 reopen-edge test masked the drift divergence ("does not throw" only); the strengthened version asserts draft application, banner state, and commit contents. Verified present + green. A strengthening, not a weakening. Sound.

### Human Verification Required

None. The only checkpoint (GUARD-01 prod deletion) was executed by the orchestrator with recorded row-level evidence; live authed-prod behavior of the purified surfaces is Phase 65's canary by design (GUARD-04) and is not manufactured into this phase's gate.

### Gaps Summary

No gaps. All 5 roadmap success criteria hold in the codebase, every SUMMARY claim spot-checked against source/tests/commits was accurate (including the full-suite 7450/0 and the ENGINE-05 falsification, both independently re-run/re-proven), all 9 review fixes (CR-01, WR-01/02/03, IN-01..05) verified landed, and the one declined finding (IN-06) is a documented pre-existing Phase-62 edge deferred to Phase 64 membership work.

---

_Verified: 2026-07-03T20:48:00Z_
_Verifier: Claude (gsd-verifier)_
