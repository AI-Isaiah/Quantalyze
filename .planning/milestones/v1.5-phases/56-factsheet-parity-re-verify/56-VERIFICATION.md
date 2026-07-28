---
phase: 56-factsheet-parity-re-verify
verified: 2026-07-01T15:35:00Z
status: passed
score: 5/5 must-haves verified
overrides_applied: 0
---

# Phase 56: Factsheet Parity Re-Verify — Verification Report

**Phase Goal:** Confirm the real factsheet on the blend stays parity-by-construction after the engine change — it consumes `computeScenario`'s emitted member-windowed series and never re-derives the blend.
**Verified:** 2026-07-01T15:35:00Z
**Status:** PASSED
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | The factsheet payload builder consumes the engine's emitted series and re-derives nothing — asserted, not assumed. | VERIFIED | `scenario-factsheet-parity-guard.test.ts`: 11/11 structural assertions green; comment-stripped code-line scan finds none of the 7 banned blend/divisor tokens; engine imports absent from code lines; real code at `scenario-factsheet-payload.ts:332` confirmed by `builderSrc.toContain("...strategyMetrics } = compute(rets, datesR)")`. |
| 2 | For a scenario run WITH an explicit coverage window, the factsheet renders the SAME member-windowed series the engine emits. | VERIFIED | Test A in the Phase 56 describe block: `payload.dates === winDates` and `payload.strategyReturns === winRets`; windowed series length 30 asserted STRICTLY LESS THAN union length 90 (non-vacuity, proven with a real `computeScenario` call). |
| 3 | The factsheet body (metrics + equity + drawdowns) equals compute()/cumEq()/drawdowns() applied to the identical windowed series, to fp precision. | VERIFIED | Test B: field-by-field `toBeCloseTo(_, 6)` loop over all 30+ numeric ComputeResult scalars; equity/drawdown at `toBeCloseTo(_, 12)`; `strategyMetrics.n === 30` and `ann_vol > 0` non-vacuity pins confirm the loop ran over a live non-zeroed result. |
| 4 | The existing v1.2.2 (Phase 39) union-path parity specs stay green. | VERIFIED | Full test file run: 23/23 tests passed; pre-existing Phase 39 describe blocks are byte-untouched (confirmed by `git show --stat 62ea4552` showing only `+213 lines` added to the file, 0 deleted). |
| 5 | no-invented-data holds on the coverage-window path (a zero-member window collapses to a safe-empty payload, never throws). | VERIFIED | Test C: `window = { start: "2024-06-01", end: "2024-06-30" }` (after A/B's last date) → `mEmpty.member_count === 0`, `mEmpty.portfolio_daily_returns === []`, payload `dates: []` / `strategyEquity: []` without throwing; also asserts `member_count 2` (A+B) when C is excluded by a window past its end. |

**Score:** 5/5 truths verified

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/app/(dashboard)/allocations/widgets/performance/scenario-factsheet-parity-guard.test.ts` | Structural single-source-of-truth guard: readFileSync + not.toContain of 7 banned tokens + import check + mount wiring pins | VERIFIED | 153-line file created in commit `5674fda7`; contains `buildScenarioFactsheetPayload`, `defaultWindowFor` NOT referenced (correct — it's a structural guard, not runtime); all 11 cases run green. |
| `src/app/(dashboard)/allocations/widgets/performance/scenario-factsheet-payload.test.ts` | Extended with coverage-window parity describe block containing `defaultWindowFor` | VERIFIED | `defaultWindowFor` present at line 11 (import) and line 465 (usage); Phase 56 describe block at line 467; 23/23 tests green. |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `scenario-factsheet-payload.test.ts` (coverage-window case) | `computeScenario + buildScenarioFactsheetPayload` | `computeScenario(strats, { selected, weights, startDates, window: CW_WINDOW }, CW_CACHE)` feeds emitted `portfolio_daily_returns` to `buildScenarioFactsheetPayload` | WIRED | Real engine call at line 469; engine output at line 481 `winSeries = mWin.portfolio_daily_returns ?? []`; payload built at line 484. |
| `scenario-factsheet-parity-guard.test.ts` | `scenario-factsheet-payload.ts` source | `readFileSync` via `fileURLToPath(import.meta.url)` path resolution | WIRED | `HERE = dirname(fileURLToPath(import.meta.url))` at line 32; `PAYLOAD_BUILDER_PATH = resolve(HERE, "scenario-factsheet-payload.ts")` at line 34; no hardcoded absolute paths. |

---

### Data-Flow Trace (Level 4)

Not applicable — this is a test-only assertion phase. No production rendering component added. The production data flow (`computeScenario` → `ScenarioFactsheetChart` → `buildScenarioFactsheetPayload`) is the subject of the structural guard and the runtime spec, not itself a new wiring introduced by this phase.

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Structural guard green (11 cases) | `npx vitest run "scenario-factsheet-parity-guard.test.ts"` | 11 passed, 0 failed | PASS |
| Runtime parity + Phase 39 regression green (23 cases) | `npx vitest run "scenario-factsheet-payload.test.ts"` | 23 passed, 0 failed | PASS |
| TypeScript clean | `npx tsc --noEmit` | exit 0, no output | PASS |
| Only 2 test files changed | `git show --stat 5674fda7 62ea4552` | commit 1: `+153` in guard file only; commit 2: `+213` in payload test only | PASS |

---

### Probe Execution

No `scripts/*/tests/probe-*.sh` probes declared or applicable for this test-only assertion phase.

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| PARITY-01 | 56-01-PLAN.md | Factsheet payload stays parity-by-construction on the v1.5 coverage-window path | SATISFIED | Two-layer guard (structural + runtime) both green; truths 1–5 all VERIFIED above. |

---

### Anti-Patterns Found

No anti-patterns found in the two test files. Scanned for TBD/FIXME/XXX markers (none), placeholder/coming-soon prose (none), empty implementations (none). The zero-member safe-empty path (`dates: []`, `strategyEquity: []`) in Test C is an intentional honest empty-state, not a stub — it asserts NO data is fabricated, which is the no-invented-data invariant.

---

### Surgical Constraint (Zero Production-Code Change)

Both commits (`5674fda7`, `62ea4552`) touch only the two test files:

- `5674fda7`: `scenario-factsheet-parity-guard.test.ts` +153 lines (created)
- `62ea4552`: `scenario-factsheet-payload.test.ts` +213 lines (extended)

No engine, payload builder, or UI file changed. LOCKED invariants (no-invented-data, 252-annualization, cumulative-RETURN-vs-wealth, WCAG-AA) are unregressed by construction.

---

### Human Verification Required

None. This is a test-only assertion phase with no UI changes. All behaviors are programmatically verifiable and verified above.

---

### Adversarial Review: False-Green Assessment of the Parity Guard

**Verdict: the guard is genuinely non-vacuous and falsifiable.**

**Structural guard (Task 1) — not.toContain analysis:**

The seven banned tokens (`coverageSpanOf`, `covers(`, `member_count`, `member_ids`, `activeWeightSum`, `normWeight`, `computeScenario`) were verified to be absent from the builder's code lines AND from its comment lines. This means the guard does not rely on the comment-strip to avoid false negatives — the builder genuinely contains none of these tokens anywhere. The comment-strip is a correctness defense against future comment drift, not a mechanism covering a current weakness.

The positive assertion `builderSrc.toContain("compute(rets, datesR)")` targets a single code line (`scenario-factsheet-payload.ts:332`). The string appears only once in the file and only on that code line — not in a comment — so the assertion is anchored to real behavior.

The import-absence assertions (`not.toContain 'from "@/lib/scenario"'` and `from "@/lib/scenario-window"`) on `builderCode` are the canonical signature of a re-derived blend. These are correct: the builder imports exclusively from `@/lib/factsheet/*` and `@/lib/portfolio-math-utils`.

The falsifiability claim (mutation check) is plausible and consistent with what we can verify: the banned set covers exactly the exports of `@/lib/scenario-window` that the test also imports from the test side, so injecting `import { covers } from "@/lib/scenario-window"` into the builder would trip both the `covers(` token check AND the `from "@/lib/scenario-window"` import check simultaneously.

**Runtime parity (Task 2) — vacuity checks:**

Test A's non-vacuity is real: the assertion `winSeries.length < unionLen` is falsifiable (union=90 is pinned, windowed=30 is pinned), and `computeScenario` is called twice with genuinely different `state` objects. A stale-union render would produce `payload.dates` with 90 entries, failing `expect(p.dates).toEqual(winDates)` where `winDates` has 30 entries.

Test B's field-by-field loop iterates `Object.keys(ref)` where `ref = compute(winRets, winDates)` — this produces ~30 numeric fields from `ComputeResult` (n, cum_ret, cagr, ann_vol, sharpe, sortino, calmar, max_dd, longest_dd, skew, kurt, mtd, ytd, p3m, p6m, p1y, best_day, worst_day, best_week, worst_week, best_month, worst_month, best_quarter, worst_quarter, best_year, worst_year, win_rate, avg_win, avg_loss, profit_factor, var95, cvar95, pain_index, ulcer_index, plus the nullable fields excluded by `typeof refVal === "number"`). The `n===30` and `ann_vol>0` non-vacuity pins confirm the loop ran on a live result. The critical design choice — asserting `payload.strategyMetrics` vs `compute(rets, dates)` rather than vs `m.volatility/m.sharpe` — is correct per the parity contract clarification: it avoids the sample/population stdev divergence while still being mutation-sensitive (a factsheet that hand-rolled its own metrics would diverge from `compute()`).

Test C's divisor honesty check uses two distinct engine runs: `member_count === 2` (A+B, past C's end) and `member_count === 3` (A+B+C, intersection includes C). Both are real engine outputs asserted directly, not derived from the test's own math.

**One minor observation (WARNING, not BLOCKER):** The guard's mount-wiring check for `ScenarioFactsheetChart` asserts `expect(chartSrc).toContain("portfolioDaily")` — this is a weaker assertion (the string appears in comments and JSDoc as well as code). However, it is paired with `expect(chartSrc).toContain("buildScenarioFactsheetPayload(")` and the ScenarioComposer regex pin `portfolioDaily={scenarioMetrics.portfolio_daily_returns` which is strong. The chart-side assertion is an existence check, not a wiring check — but the wiring is already covered by the runtime spec (Test A: the payload actually receives the engine's windowed series). The gap is that a future edit could change how `portfolioDaily` is passed to `buildScenarioFactsheetPayload` in the chart without the guard firing. This is LOW severity because the runtime test would catch it via series-identity failure.

**Overall false-green judgment:** The parity guard is not a false-green. The not.toContain set is the load-bearing half and is confirmed real (tokens genuinely absent from code). The runtime assertions are non-vacuous, mutation-sensitive, and anchored to actual engine invocations. The series-identity parity contract (payload body === `compute()` on the engine-emitted series) is correctly distinguished from field-equality with `ComputedMetrics` (which would be wrong). The phase goal is achieved.

---

## Gaps Summary

None. All 5 must-haves verified. Status: PASSED.

---

_Verified: 2026-07-01T15:35:00Z_
_Verifier: Claude (gsd-verifier)_
