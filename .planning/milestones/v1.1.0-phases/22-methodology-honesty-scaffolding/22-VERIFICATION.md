---
phase: 22-methodology-honesty-scaffolding
verified: 2026-06-21T18:56:00Z
status: passed
score: 9/9
overrides_applied: 0
---

# Phase 22: Methodology Honesty Scaffolding — Verification Report

**Phase Goal:** Every projected statistic discloses how it was computed, and a single shared sample-floor gate exists for the distributional/tail features to reuse.
**Verified:** 2026-06-21T18:56:00Z
**Status:** passed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `ScenarioComposer.tsx` renders caveat as "Historical realized · {N} overlapping days · not a forecast" with live `scenarioMetrics.n` | VERIFIED | `ScenarioComposer.tsx:1063-1064` — exact text confirmed, `scenarioMetrics.n` inline |
| 2 | `ScenarioBuilder.tsx` renders the identical methodology line with live `metrics.n` | VERIFIED | `ScenarioBuilder.tsx:300-301` — identical form, `metrics.n` inline |
| 3 | Both caveats retain `data-testid="scenario-coverage-caveat"` and `mt-2 text-[11px] text-text-muted` | VERIFIED | `ScenarioComposer.tsx:1060-1061`, `ScenarioBuilder.tsx:297-298` — testid and token present on both |
| 4 | Both caveats retain the conditional "Shortest history: {name}." clause (present when non-null, omitted otherwise) | VERIFIED | Composer: `coverageShortestName !== null` guard at `:1065`; Sandbox: `shortestName ?` guard at `:301` |
| 5 | N is read live from the frozen engine (never hardcoded) | VERIFIED | Both read from `scenarioMetrics.n` / `metrics.n`; `src/lib/scenario.ts` and `scenario-dealias.ts` are untouched (grep confirms no diff) |
| 6 | `src/lib/sample-floor.ts` exports `SAMPLE_FLOOR_OVERLAPPING_DAYS = 60` as a single named constant, defined in exactly one file | VERIFIED | `sample-floor.ts:37`; grep of all `src/` non-test files outside `sample-floor.ts` returns zero matches for the constant |
| 7 | `evaluateSampleFloor(n, floor?)` gate: null/NaN/Infinity/negative all produce `"no-usable-n"` (never pass); `n < floor` produces `"below-floor"`; `n === floor` passes; per-call override honored | VERIFIED | `sample-floor.ts:62-73` — guard-first branch order confirmed; 19 test cases all green (`vitest run` 25/25 passed) |
| 8 | `SampleFloorEmptyState` renders the honest shell naming N + floor, returns `null` on an `ok` verdict (WR-02 fix), and carries no `role="alert"` / warning/red color | VERIFIED | `SampleFloorEmptyState.tsx:57` — `if (reason === "ok") return null`; render tests 6/6 green including the WR-02 regression |
| 9 | A `CONTRACT_GUARDS` entry pins `src/lib/sample-floor.test.ts` and the guard-existence test is green; `EXPECTED_RULES` untouched | VERIFIED | `contracts-registry.test.ts:84` — entry confirmed; `vitest run` 33/33 passed; plugin-wiring test green |

**Score:** 9/9 truths verified

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx` | Composer methodology line (HONEST-01) — in-place copy upgrade | VERIFIED | Contains "Historical realized" at :1063; testid + token preserved |
| `src/components/scenarios/ScenarioBuilder.tsx` | Sandbox methodology line (HONEST-01) — identical in-place copy upgrade | VERIFIED | Contains "Historical realized" at :300; testid + token preserved |
| `src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx` | Composer caveat assertions extended for methodology line (Phase-21 assertions retained) | VERIFIED | Asserts `toContain("Historical realized")`, `toContain("not a forecast")`, full middot form, and `Shortest history: ${REF_BTC}.`; 61/61 tests pass |
| `src/components/scenarios/ScenarioBuilder.honesty.test.tsx` | Sandbox caveat assertions; anchored `^Projected` regex updated | VERIFIED | Anchored regex updated to `/^Historical realized · \d+ overlapping days · not a forecast/` at :118; `toContain("Shortest history: Short Leg.")`; 61/61 tests pass |
| `src/lib/sample-floor.ts` | HONEST-02 single-source primitive: floor const + gate + copy builders | VERIFIED | 118 lines; exports `SAMPLE_FLOOR_OVERLAPPING_DAYS=60`, `evaluateSampleFloor`, `SampleFloorVerdict`, `SAMPLE_FLOOR_HEADING`, `belowFloorBody`, `noUsableSampleBody`, `fewStrategiesBody` |
| `src/lib/sample-floor.test.ts` | Value pin `toBe(60)` + exhaustive gate-branch coverage | VERIFIED | 19 tests across value-pin, ok/below-floor/no-usable-n branches, per-call override, and copy-naming assertions; all 19 green |
| `src/components/scenarios/SampleFloorEmptyState.tsx` | Below-floor honest empty state (verbatim CorrelationHeatmap shell), reason-routed body naming N + floor | VERIFIED | 74 lines; imports from `@/lib/sample-floor`; `return null` on `ok` (WR-02); no `role="alert"`; correct shell tokens |
| `src/components/scenarios/SampleFloorEmptyState.test.tsx` | Render test: body names N + floor; NOT `role="alert"` / not red | VERIFIED | 6 tests including WR-02 regression (`ok` verdict renders empty container); all 6 green |
| `src/__tests__/contracts/contracts-registry.test.ts` | `CONTRACT_GUARDS` entry for `sample-floor.test.ts` | VERIFIED | Entry at :84 with `batch: "Phase22"` and invariant text; guard-existence test green; `EXPECTED_RULES` untouched |
| `src/__tests__/contracts/REGISTRY.md` | Human-readable registry row for sample-floor | VERIFIED | Row at :54 matching the `CONTRACT_GUARDS` entry |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `ScenarioComposer.tsx` | `src/lib/scenario.ts ComputedMetrics.n` | `scenarioMetrics.n` rendered inline in caveat `<p>` | WIRED | `:1063` — `{scenarioMetrics.n}` inline in the methodology string; engine not modified |
| `ScenarioBuilder.tsx` | `src/lib/scenario.ts ComputedMetrics.n` | `metrics.n` rendered inline in caveat `<p>` | WIRED | `:300` — `{metrics.n}` inline in the methodology string; engine not modified |
| `SampleFloorEmptyState.tsx` | `src/lib/sample-floor.ts` | `import { SAMPLE_FLOOR_HEADING, belowFloorBody, noUsableSampleBody, fewStrategiesBody, type SampleFloorVerdict } from "@/lib/sample-floor"` | WIRED | `:1-9` — all copy builders + heading + type imported; none re-authored in the component |
| `contracts-registry.test.ts` | `src/lib/sample-floor.test.ts` | `CONTRACT_GUARDS` array entry (existence check) | WIRED | `:84` — `{ path: "src/lib/sample-floor.test.ts", batch: "Phase22", ... }`; guard-existence test confirmed green |

---

### Data-Flow Trace (Level 4)

Data-flow Level 4 is not applicable to HONEST-01 (copy-only text upgrade — `scenarioMetrics.n` / `metrics.n` data flow is unchanged from Phase 21 and was verified in that phase). For HONEST-02 the new files are not yet wired into the live composer/sandbox projection by design (deferred to Phases 26/27 per plan scope); the correct absence of live wiring was confirmed by the code review (IN-03) and is not a gap.

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| HONEST-01 test suite green (61 tests) | `vitest run ScenarioComposer.test.tsx ScenarioBuilder.honesty.test.tsx` | 61 passed / 0 failed | PASS |
| HONEST-02 gate + render tests green (25 tests) | `vitest run sample-floor.test.ts SampleFloorEmptyState.test.tsx` | 25 passed / 0 failed | PASS |
| CONTRACT_GUARDS registration test green (33 tests) | `vitest run contracts-registry.test.ts` | 33 passed / 0 failed | PASS |
| `SAMPLE_FLOOR_OVERLAPPING_DAYS` declared in exactly one non-test file | `grep -rn SAMPLE_FLOOR_OVERLAPPING_DAYS src/ \| grep -v \.test\. \| grep -v sample-floor\.ts` | zero matches | PASS |
| No `TBD` / `FIXME` / `XXX` in modified files | grep across all 4 modified files | zero matches | PASS |

---

### Probe Execution

No conventional `scripts/*/tests/probe-*.sh` probes declared or discovered for this phase.

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| HONEST-01 | 22-01-PLAN.md | Every projected stat surfaces its method + overlapping-N + horizon | SATISFIED | "Historical realized · {N} overlapping days · not a forecast" live on both `ScenarioComposer.tsx:1063` and `ScenarioBuilder.tsx:300`; 61 tests green |
| HONEST-02 | 22-02-PLAN.md | A shared minimum-sample gate (tunable floor, conservative default for distributional/tail outputs) renders an honest empty state below the floor — reused by Stress and Monte-Carlo | SATISFIED | `sample-floor.ts` exports `SAMPLE_FLOOR_OVERLAPPING_DAYS=60` + `evaluateSampleFloor`; `SampleFloorEmptyState` renders the honest absent state; 25 tests green; CONTRACT_GUARDS registered |

Both HONEST-01 and HONEST-02 are marked `[x]` complete in `REQUIREMENTS.md` at lines 30-31 and 103-104.

---

### Anti-Patterns Found

No blockers or warnings. No `TBD`, `FIXME`, or `XXX` markers found in any modified file. No stub patterns observed. No placeholder returns or hardcoded empty data in the shipped path.

The `SAMPLE_FLOOR_OVERLAPPING_DAYS` pin test (noted as WR-01 in the code review) carries an honest scope comment that it pins the floor VALUE and gate branches but does not yet detect a consumer hardcoding `60` — this limitation is explicitly documented in the test comment at `sample-floor.test.ts:13-21` and deferred to Phases 26/27 in `deferred-items.md` (DI-22-02). The comment overclaim was the WR-01 finding; it was fixed in commit `17508509`.

---

### Human Verification Required

None. All must-haves are mechanically verifiable and confirmed green. The phase delivers copy upgrades and a pure-lib primitive with exhaustive test coverage. No UI visual fidelity, external service integration, or real-time behavior is in scope for this phase.

---

### Gaps Summary

No gaps. All 9 observable truths verified, all 10 artifacts substantive and wired, all 4 key links confirmed, both requirements satisfied, 119 tests green across the touched suite, no debt markers.

---

_Verified: 2026-06-21T18:56:00Z_
_Verifier: Claude (gsd-verifier)_
