---
phase: 162-honest-what-the-user-sees-is-true
plan: 03
subsystem: portfolio-dashboard + discovery-tables
tags: [HONEST-04, HONEST-03, STALE-01, equity-curves, sync-badge, rsc-payload]
status: complete
requires:
  - "src/lib/closed-sets.ts :: isRankableAnalyticsRow (STALE-01 gate)"
  - "src/lib/factsheet/resolve-series.ts :: resolveDailyReturnSeries"
  - "src/lib/portfolio-math-utils.ts :: normalizeDailyReturns"
provides:
  - "buildEquityCurveSeries — real, gated per-constituent wealth curves"
  - "stripConstituentSeries — raw series kept off the RSC boundary"
  - "EquityCurveCoverage — the C-3 disclosure caption"
  - "mayClaimSyncRecency — the is_example SyncBadge class guard (both render paths)"
affects:
  - "/portfolios/[id] dashboard equity-curve panel"
  - "StrategyTable + StrategyGrid sync badges (example rows only)"
tech-stack:
  added: []
  patterns:
    - "STALE-01 gate applied at the value site (isRankableAnalyticsRow ? build : null)"
    - "_rs/_dr destructure strip before the RSC boundary (queries.ts:2265-2278 idiom)"
    - "cumprod fold for CSV daily_returns (scenario-blend-adapter.ts:136-140)"
key-files:
  created:
    - "src/app/(dashboard)/portfolios/[id]/equity-curve-series.test.tsx"
  modified:
    - "src/app/(dashboard)/portfolios/[id]/page.tsx"
    - "src/components/strategy/StrategyTable.tsx"
    - "src/components/strategy/StrategyGrid.tsx"
    - "src/components/strategy/StrategyTable.stale-analytics.test.tsx"
decisions:
  - "The RSC-boundary strip lives in page.tsx, NOT in getPortfolioStrategies — the page needs the series server-side to build the curves, so the query is unchanged and only the forwarded props narrow."
  - "mayClaimSyncRecency is a NEW decided predicate rather than a widening of hasComputedAnalytics — that value also gates the rank cell and the owner pending chip, and an example row with real computed analytics still earns both."
  - "StrategyGrid received the is_example guard only. Its badge remains ungated on computation_status (a pre-existing, consumer-less STALE-01 gap logged as a deferred item, not silently widened here)."
metrics:
  duration: "~35 min"
  completed: 2026-08-26
actuals:
  tokens: 7128
  tasks: 3
  commits: 3
---

# Phase 162 Plan 03: Honest equity curves + example-row badge guard — Summary

Per-strategy equity curves now render real `{date,value}` wealth points gated by
`isRankableAnalyticsRow`, a dead run draws no line and says so in one colorless
caption, and `is_example` rows can no longer claim a sync recency on either
render path.

## What was built

**Task 1 — gate-first curve building** (`f3bb9851`)

`buildEquityCurveSeries` (`src/app/(dashboard)/portfolios/[id]/page.tsx:259-275`)
replaces the hard-coded `equityCurve: null`. Per constituent it calls
`extractAnalytics`, then decides at the value site:

```ts
equityCurve: a && isRankableAnalyticsRow(a) ? buildWealthPoints(a) : null,
```

**The gate is in the call path, shown not asserted** — `page.tsx:268`, imported
at `:23`. `buildWealthPoints` (`:230-247`) normalizes a persisted
`returns_series` directly (it is already the cumprod wealth curve, base 1 — what
`PortfolioEquityCurve`'s `RETURN_FORMATTER` expects) and folds CSV rows through
`resolveDailyReturnSeries` + the cumprod precedent. Status gating goes through
the predicate; **no inline status-literal comparison was added** — the SI-01
census (`complete-status-scan.test.ts`) still counts 3 for this file and passes.

The false comment (*"Returns_series is not selected in the existing query…"*) and
the hard-coded null are both **gone** — `grep -c "Returns_series is not selected"`
returns 0. UI-SPEC C-3's stale-artefact clause is satisfied: the comment did not
outlive the thing it described.

`stripConstituentSeries` (`:284-311`) removes `returns_series`/`daily_returns`
from the analytics embed forwarded to `StrategyBreakdownTable` (a `"use client"`
component, so every field it receives is serialized into the flight payload).
The curves are built from the un-stripped server-side rows first, so the strip
cannot retroactively blank the chart — pinned by an assertion in Test 4.

**Task 2 — the C-3 coverage caption** (`c4f026e9`)

`EquityCurveCoverage` (`:322-337`) renders exactly one line below the chart:

> Equity curves shown for 2 of 3 strategies — 1 without computed analytics are omitted.

`text-caption text-text-muted`, DM Sans, plain text in document flow. `n === m`
renders nothing; `n === 0` still discloses. `n` and `m` are counted off the SAME
array the curve builder produced — no second, drift-prone count — and an EMPTY
curve array counts as omitted so the caption agrees with what the chart actually
drew (the component skips both null and empty).

**Task 3 — the `is_example` SyncBadge class guard** (`831da5fc`)

`StrategyTable.tsx:969-983` adds one decided predicate,
`mayClaimSyncRecency = hasComputedAnalytics && !s.is_example`, consumed at the
badge render (`:1170`). `StrategyGrid.tsx:117` gets the matching `!s.is_example`
guard. Both render paths are covered (UI-SPEC C-6's "cover both" option), so the
class cannot re-open through whichever path a future page mounts. No founder
surface depending on example sync dates was found, so C-6's
recommended-required default applied without a conflict to surface.

## How the gate was demonstrated to be in the call path

1. **Cited, not claimed:** `isRankableAnalyticsRow(` appears at
   `page.tsx:268`, inside the curve builder's value expression.
2. **Proven by a corpse fixture:** Test 2 hands the builder a `failed` row
   carrying a full 3-point `returns_series`, `sharpe: 4.2` and `cagr: 3.4` — a
   row every `IS NOT NULL` predicate admits — and asserts `equityCurve` is
   `null`. The test additionally pins the premise (`returns_series` has 3
   points, `sharpe > 0`) so it cannot pass vacuously if a future fixture edit
   strips the corpse.
3. **Proven falsifiable:** neutering the gate to the null check the docblock
   forbids (`a.returns_series != null`) turned the spec RED with
   `AssertionError: expected [ …(3) ] to be null` — the dead run's curve drawn,
   exactly the #712 class.

## RED witnesses (all first-hand, all restored byte-identically)

| Neuter | Observed | Restore |
|---|---|---|
| `isRankableAnalyticsRow(a)` → `a.returns_series != null` | 3 failed / 4 passed — Tests 2, 2b, 3 RED | `page.tsx` shasum `f0d1943c` before and after |
| `if (shown === total)` → `if (shown >= 0)` (caption always suppressed) | 5 failed / 8 passed — Tests 5, 6b, 6c, 7, 7b RED | `page.tsx` shasum `f0d1943c` before and after |
| `mayClaimSyncRecency` → `hasComputedAnalytics`; grid guard → `true` | 2 failed / 14 passed — Tests 8, 10 RED | `StrategyTable.tsx` `c68cb9c8`, `StrategyGrid.tsx` `3251348d` |
| badge made unconditional (`true \|\| hasComputedAnalytics`) | 3 failed / 13 passed — Test 8b additionally RED | same shasums |

The fourth neuter exists because Test 8b (status-blindness on a FAILED example
row) survives the third: a failed row has no badge anyway. Rather than leave a
test whose ability to fail was unproven, the badge was made unconditional to
observe 8b go red. Restores used byte copies from the scratchpad — **no
`git checkout --`** was run at any point.

## Verification

- `src/app/(dashboard)/portfolios/[id]/equity-curve-series.test.tsx` — 13 passed
- `src/components/strategy/StrategyTable.stale-analytics.test.tsx` — 16 passed
- `StrategyGrid.test.tsx` + `StrategyTable.test.tsx` + `StrategyTable.pending-chip.test.tsx` — 57 passed
- `src/lib/complete-status-scan.test.ts` (SI-01 census) — 2 passed
- **Full suite: 801 files passed, 19 skipped; 12485 tests passed, 281 skipped.**
  Contract tests in `src/__tests__/contracts/` scan all of `src/`, so this was
  run whole — not file-scoped.
- `npx tsc --noEmit` — clean
- `npx eslint` on all five touched files — clean
- `grep -c "Returns_series is not selected" page.tsx` → `0`

The 281 skips are pre-existing (unchanged by this plan); none were introduced
here.

## DESIGN.md conformance

- Caption is **colorless** — `text-text-muted` only; Test 7 bans `text-negative`,
  `text-accent`, `text-amber`, `text-red`, `text-positive`, `bg-negative`.
- `text-caption` tier per UI-SPEC Typography; `mt-3` is an existing spacing step.
- No new spacing, type, or color values. `PortfolioEquityCurve` and `SyncBadge`
  are byte-untouched.
- Voice: the limitation is stated with the number attached.
- Missing renders as **absent** — no line, no flat 1.0, no zeros, no stale
  neighbour. Nothing was synthesized to fill a panel.

## Deviations from Plan

**1. [Plan-conditional resolved] The RSC strip lives in the page, not `queries.ts`**
- **Found during:** Task 1
- **Issue:** The plan left this conditional ("If the strip belongs in
  `getPortfolioStrategies`…"). It does not: the page needs `returns_series`
  server-side to build the curves, and the plan itself states the SELECT must
  not narrow.
- **Resolution:** `getPortfolioStrategies` is unchanged (`queries.ts` not
  modified, so the phase-147 select-width grep-gates are untouched). The strip
  is applied in `DashboardContent` to the rows forwarded to the client
  `StrategyBreakdownTable`, using the file's own `_rs`/`_dr` destructure idiom.
- **Commit:** `f3bb9851`

**2. [Ordering] The caption component landed in the Task-1 commit**
- The `EquityCurveCoverage` component and its wiring were written alongside
  Task 1's edit to the same file; Task 2's commit carries its spec and the RED
  witness. The RED witness for the caption was still performed against the
  landed code (neutering `shown === total`), so the falsifiability evidence is
  unaffected — only the commit boundary moved.
- **Commit:** `c4f026e9`

**3. [Test-fidelity] Tests 8/8b drive the real "Hide examples" control**
- **Found during:** Task 3
- **Issue:** `DEFAULTS.hide_examples` is `true`, so `StrategyTable`'s hydration
  effect filters example rows out entirely. The first draft of Tests 8/8b
  rendered zero rows and threw `no rendered row for …` — it would have been a
  guard proven on rows nobody can see.
- **Fix:** the tests click the real `Hide examples` checkbox (asserting it was
  checked first), then assert on the now-visible row.
- **Commit:** `831da5fc`

No architectural changes were needed; no Rule 4 escalation. No packages
installed.

## Known Stubs

None. No panel was left stubbed, and no value was synthesized.

## Deferred Items

**`StrategyGrid`'s SyncBadge is still ungated on `computation_status`.** Only
the `is_example` guard was added there, per this plan's scope. The component has
no page consumer at HEAD, so nothing renders a failed row's sync date today —
but the component is capable of it, which is the STALE-01 class one layer over.
Out of scope for this plan (pre-existing, not caused by these changes); logged
rather than silently widened.

## Threat Flags

None. `T-162-03-A` (dead-run series on the new read path) is mitigated by the
gate + corpse fixture; `T-162-03-B` (false freshness on example rows) by the
two-path guard, RED-witnessed; `T-162-03-C` is reduced from "accepted" to
actually-stripped. No new endpoint, auth path, file access, or schema surface
was introduced.

## Self-Check: PASSED

- `src/app/(dashboard)/portfolios/[id]/equity-curve-series.test.tsx` — FOUND
- `src/app/(dashboard)/portfolios/[id]/page.tsx` — FOUND
- `src/components/strategy/StrategyTable.tsx` — FOUND
- `src/components/strategy/StrategyGrid.tsx` — FOUND
- `src/components/strategy/StrategyTable.stale-analytics.test.tsx` — FOUND
- commit `f3bb9851` — FOUND
- commit `c4f026e9` — FOUND
- commit `831da5fc` — FOUND


> ⚠️ **Superseded copy, 2026-08-26.** This document quotes the equity-curve caption as
> "…without computed analytics". That wording named a cause the code never tested: a row can
> also be omitted when `isRankableAnalyticsRow` is TRUE but `buildWealthPoints` returns null
> (unusable series) — and such a row's CAGR/Sharpe render in the breakdown table on the same
> page, contradicting the sentence. Live copy is now "…without a usable return series".
> Found by a silent-failure audit (A-1); the text below is left as the historical record.
