---
phase: 162-honest-what-the-user-sees-is-true
plan: 04
subsystem: allocations-composer
tags: [honest-05, stale-01, scenario-composer, returns-route, ui-spec-c4]
status: complete
requires:
  - "src/lib/closed-sets.ts :: isRankableAnalyticsRow (the STALE-01 predicate)"
  - "GET /api/strategies/[id]/returns (the drawer's existing lazy read)"
provides:
  - "ReturnsResponse.cagr / ReturnsResponse.sharpe — gated headline scalars"
  - "ScenarioComposer addedMetricsById — settled lazy metric pair per drawer-added leg"
  - "addedStrategyMetadataLookup.metricsSettled — the undefined-vs-settled-null discriminator"
  - "Revised C-4 absence copy: 'No computed metrics for this strategy — open the factsheet for detail.'"
affects:
  - "src/app/api/strategies/[id]/returns/route.ts"
  - "src/app/(dashboard)/allocations/components/ScenarioComposer.tsx"
tech-stack:
  added: []
  patterns:
    - "Co-serve scalars from the SAME analytics projection the series comes from — no second round-trip, no second RLS surface"
    - "One rankability boolean drives BOTH the series withholding and the scalar withholding"
    - "undefined = unanswered, present-with-nulls = settled absence (the note-flash guard)"
key-files:
  created:
    - "src/app/(dashboard)/allocations/components/ScenarioComposer.added-metrics.test.tsx"
  modified:
    - "src/app/api/strategies/[id]/returns/route.ts"
    - "src/app/api/strategies/[id]/returns/route.test.ts"
    - "src/app/(dashboard)/allocations/components/ScenarioComposer.tsx"
    - "src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx"
decisions:
  - "Replaced the route's isComputedAnalytics call with isRankableAnalyticsRow rather than adding a second call beside it — the plan's 'decided once, not a second ladder' read literally. Behaviour is byte-identical (isRankableAnalyticsRow delegates to isComputedAnalytics); the series gate and the scalar gate are now the same boolean."
  - "The metric pair now renders in ALL five C-4 states instead of being hidden when both are null. UI-SPEC C-4 specifies em-dash cells in every state; hiding them was defensible only while the both-null state was permanent."
  - "A fetch error writes settled nulls into addedMetricsById while leaving addedReturnsById undefined — two questions, two answers. WR-01's retryable-series contract is untouched."
  - "metricsSettled rides on addedStrategyMetadataLookup as a presentation-only field (the documented trust_tier/is_composite pattern), erased by the bare-Pick cast at every engine call site."
metrics:
  duration: "~25 min"
  completed: "2026-08-26"
actuals:
  tokens: 24000
  tasks: 2
  commits: 2
---

# Phase 162 Plan 04: HONEST-05 drawer-added metrics Summary

Drawer-added legs now render real CAGR/Sharpe from the same `/returns` row that
already served their series — gated by `isRankableAnalyticsRow` so a dead run's
leftovers cannot leak through the new door — and every absence state on the
detail panel now says exactly what is true.

## Task 1 — `/returns` co-serves gated `cagr` + `sharpe`

Commit `f9845a6d6`.

- `.select(…)` widened to `"daily_returns, returns_series, computation_status, data_quality_flags, cagr, sharpe"`.
  The Phase-147 block comment was EXTENDED (not duplicated) to name the scalar
  columns inside the same RLS sentence: `analytics_read` is table-level, there
  are no column grants, so naming more columns in a projection cannot widen who
  may read the row.
- `ReturnsResponse` gained `cagr: number | null` and `sharpe: number | null`.
- The F5b error redaction (log + Sentry + static envelope) is untouched — no
  new error copy was minted.

### How the gate was DEMONSTRATED to be in the call path

Not asserted — shown, three ways:

1. **Source, at the value site.** `route.ts:362` binds the ONE decision:
   ```ts
   const analyticsRankable = isRankableAnalyticsRow({ computation_status: status });
   ```
   `:365` uses it to withhold the series (`analyticsRankable ? resolveDailyReturnSeries(…) : []`);
   `:378` and `:382` use the SAME boolean to withhold the scalars. The previous
   `isComputedAnalytics(status)` binding was replaced rather than joined, so the
   two answers cannot drift — there is no second ladder to drift from. No inline
   status-literal comparison was introduced (SI-01 census green:
   `src/lib/complete-status-scan.test.ts`, 42 tests pass).
2. **Runtime, against a flattering corpse.** Test `R-B` seeds a row at
   `failed` / `failed_final` / `computing` / `pending` carrying
   `cagr: 0.9412, sharpe: 3.87` — best-in-class numbers a dead run left behind —
   and pins both to `null` on the 200 body, plus explicit `not.toBe(0)` so a
   `?? 0` "fix" cannot satisfy it. `R-A` is its non-vacuity control: the same
   shape at `complete` / `complete_with_warnings` flows `0.1842` / `1.63`.
3. **Mutation.** See the RED witness below — removing `analyticsRankable` from
   the two scalar expressions turns R-B red immediately.

`R-C` pins the widening as additive: every pre-existing field keeps its value
and `Object.keys(body)` is exactly the seven expected keys (a raw
`data_quality_flags` / `computation_status` passthrough would surface there).
`R-D` pins unset / non-finite / string columns to `null`, never `0`.

## Task 2 — `addedMetricsById` + the C-4 five-state contract

Commit `1ee32d559`.

- `addedMetricsById` declared beside `addedProvenanceById`, with its lifecycle
  copied exactly: settled inside the same `fetchAddedReturns` settle that writes
  provenance, purged in `handleRemoveAdded`, presentation-only.
- `addedStrategyMetadataLookup` gained the fallback chain
  `found?.strategy.strategy_analytics?.cagr ?? addedMetricsById[a.id]?.cagr ?? null`
  (book-wins precedence, matching the adjacent `asset_class` line) plus
  `metricsSettled: found != null || a.id in addedMetricsById`.
- The metric pair renders in every state; a null cell is `text-text-muted`, a
  real value `text-text-primary`. Formatting stays on `formatPercent` /
  `formatNumber` — no inline `toFixed` was added.
- **The note's copy was revised, not left standing beside the fix.** Old:
  "Metrics not available in the composer — open the factsheet for full detail."
  New: "No computed metrics for this strategy — open the factsheet for detail."
  The adjacent comment calling this the panel's "PERMANENT metrics statement",
  and the `addedMetricsByRef` doc-block asserting structural unreachability,
  were both rewritten to describe what is now true. A repo-wide grep for the
  retired string finds only NEGATIVE assertions (two `not.toContain` guards) —
  no render path remains.

### In-flight vs settled-null is USER-distinguishable

`metricsAbsentSettled = metricsAbsent && metrics.settled` gates the note.
Both states render two em-dashes (both are honestly "unknown"), but only the
settled one makes the claim. `C-A` is the discriminating fixture: it holds the
`/returns` promise open, asserts the fetch is genuinely outstanding, then
asserts the cells are `—` AND the note count is `0`. An implementation keyed on
the null values alone passes every other test in the file and fails C-A.

### The five C-4 states, plus two

| Test | State | Render pinned |
|------|-------|---------------|
| C-A | in flight (`undefined`) | `—` `—`, **no note**, no zeros |
| C-B | settled, present | `+18.4%` / `1.63` — a non-book leg renders like a book row |
| C-C | settled, BOTH null | `—` `—` + exactly one revised note; retired copy absent; factsheet link intact |
| C-D | settled, exactly one null | `—` beside `1.63`, no note (Phase-152 rule preserved) |
| C-E | fetch error | settled-absent: note is `text-text-muted`, no `danger`/`red`, no zeros |
| C-F | purge on remove | re-add starts clean — no stale settled entry, note does not precede the answer |
| C-G | non-finite guard | `NaN` / a string collapse to absence, never reach a formatter |

## RED witnesses — all observed first-hand

Every restore was a byte copy (`cp` from a scratchpad backup) verified by
`shasum`. `git checkout --` was never used.

| # | Neuter | Observed RED | Restore verified |
|---|--------|--------------|------------------|
| 1 | Dropped `analyticsRankable &&` from both scalar expressions in `route.ts` | `R-B` failed: `status failed leaked a dead cagr: expected 0.9412 to be null` | `d6fce833…` == pre-neuter |
| 2 | Dropped the `addedMetricsById` fallback chain from the lookup | `C-B`, `C-D`, `C-F` failed: `expected '—' to be '+18.4%'` | `525e5ab0…` == pre-neuter |
| 3 | `metricsAbsentSettled = metricsAbsent` (settled gate removed) | `C-A`, `C-F` failed: `expected 1 to be +0` (the note flashed during load) | `525e5ab0…` == pre-neuter |
| 4 | Reverted the note copy to the retired string | `C-C`, `C-E`, `C-F`, `C-G` failed | `525e5ab0…` == pre-neuter |

Neuter 2 is the plan's nominated witness for the fallback chain; it does not
redden C-C, because under this implementation C-C's discriminator is the
*settled* flag and the *copy*, not the chain. Neuters 3 and 4 were added to
witness C-C and C-A against the fixes they actually guard — a test that cannot
fail when its own fix is removed is worse than no test.

## Verification

| Gate | Result |
|------|--------|
| `route.test.ts` file-scoped | 33 passed |
| `ScenarioComposer.added-metrics.test.tsx` | 7 passed |
| `ScenarioComposer.test.tsx` + `.save.test.tsx` | 367 passed |
| `src/app/(dashboard)/allocations` | 124 files / 1889 tests passed |
| `src/app/api/strategies` | 14 files / 596 tests passed |
| `src/__tests__/contracts` (scans all of `src/`) | 5 files / 109 tests passed |
| `src/lib/complete-status-scan.test.ts` + `closed-sets.test.ts` | 42 passed |
| `npx tsc --noEmit` | clean |

The FULL vitest suite was not run here — that is the wave gate's job. Every
suite listed above was observed directly; none is a claim made from inference.

## Deviations from Plan

**1. [Rule 2 — required for correctness] The metric pair now renders in all five states**

- **Found during:** Task 2
- **Issue:** The plan's C-A/C-C behaviours require em-dash CELLS in the
  in-flight and settled-null states, but the component hid the CAGR/SHARPE
  eyebrows entirely whenever both values were null (`{!metricsAbsent && …}`).
  Leaving that would have made C-A unimplementable as specified, and would have
  reflowed the panel the moment a lazy answer arrived.
- **Fix:** The pair renders unconditionally; both formatters already return `—`
  for null.
- **Files modified:** `ScenarioComposer.tsx`; two existing assertions in
  `ScenarioComposer.test.tsx` (`SCEN-03 honesty (both metrics null)` and the
  WR-02 drawer-added test) were updated from "the blocks are absent" to "the
  blocks are em-dashes", with the reasoning recorded inline.
- **Commit:** `1ee32d559`

**2. [Rule 2 — required for correctness] Non-finite scalar guard on both sides**

- **Found during:** Tasks 1 and 2
- **Issue:** `typeof x === "number"` admits `NaN` and `Infinity`, which would
  reach a formatter as a "value".
- **Fix:** `Number.isFinite` on the route and in the composer's payload
  narrowing. Pinned by `R-D` and `C-G`.
- **Commit:** `f9845a6d6`, `1ee32d559`

**3. [Rule 3 — blocking] Existing pinned copy had to change**

- **Found during:** Task 2
- **Issue:** `ScenarioComposer.test.tsx`'s `ABSENT_NOTE` constant pinned the
  copy this phase retires; the WR-02 test also asserted a permanence that the
  widened route removes.
- **Fix:** Constant and both affected tests updated, with the reason recorded in
  the test file rather than silently swapped.
- **Commit:** `1ee32d559`

## Threat Flags

None. The widening touches no new trust boundary: `analytics_read` RLS is
table-level (published OR owner), there are no column grants, and both scalars
are already served publicly for published strategies by the v2 factsheet
(T-162-04-C, disposition `accept`). T-162-04-A is mitigated and pinned by R-B;
T-162-04-B (F5b redaction) is unchanged and still covered by its existing tests.

## Known Stubs

None. No placeholder values, no hardcoded empties, no unwired components. Every
absence in this plan is a real absence rendered as an em-dash, with the note
gated on a settled answer.

## Self-Check: PASSED

- `src/app/(dashboard)/allocations/components/ScenarioComposer.added-metrics.test.tsx` — FOUND
- `src/app/api/strategies/[id]/returns/route.ts` — FOUND
- `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx` — FOUND
- commit `f9845a6d6` — FOUND in `git log`
- commit `1ee32d559` — FOUND in `git log`
