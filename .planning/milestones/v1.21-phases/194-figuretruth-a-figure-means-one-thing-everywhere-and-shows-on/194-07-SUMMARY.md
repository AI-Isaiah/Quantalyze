---
phase: 194-figuretruth-a-figure-means-one-thing-everywhere-and-shows-on
plan: 07
subsystem: tearsheet
tags: [trust-04, trust-05, d-02, d-04, d-06, d-07, d-15, figure-gate, aum-privacy]

requires:
  - phase: 194-03
    provides: figure-gate.ts (gateAnnualized, figureRecord, gatedValue, withheldReason, shortTrackNote, VAR_METHOD_LINE, FIGURE_DEFS_VERSION)
provides:
  - "`src/lib/record-span-read.ts`: `readRecordSpan(supabase, strategyId)` and `RECORD_SPAN_SELECT`, a published-only, request-scoped read of four scalar aliases (shared with plan 10)"
  - "Tearsheet `showAum` gate and `AUM` Allocation Terms row (allocator or the strategy's own manager only)"
  - "Tearsheet `VaR 95%` / `CVaR 95%` behind the stored marker, `tearsheet-var-method-line`, `tearsheet-figure-gate-note`"
affects: [194-10]

actuals:
  tokens: 14000
  tasks: 2
  commits: 2

plan_head_before: e795d76269efcaad31e3bac7a6d713878794336a
plan_head_after: 245037aee

key-files:
  created:
    - src/lib/record-span-read.ts
    - src/lib/record-span-read.test.ts
  modified:
    - src/app/factsheet/[id]/tearsheet/page.tsx
    - src/app/factsheet/[id]/tearsheet/page.test.tsx
    - src/app/factsheet/[id]/tearsheet/page.stale-analytics.test.tsx

key-decisions:
  - "The AUM gate reuses the one `getUser()` id captured in the attestation try and runs in its own try, so an attestation failure never decides AUM and the reverse; default false, a throw or `ok: false` removes the row and logs `[tearsheet] aum gate failed:`."
  - "A null AUM prints the dash via `formatUsd`; the unit-undetermined / native-unit withheld branch is kept."
  - "`readRecordSpan` also reports a failed read to Sentry (`captureToSentry`) while the page owns the single console line, so a degraded public page is visible without double logging."
  - "A null request client (createClient threw) skips the span read and fails closed to dashes without a second log line; the attestation catch already logged."

requirements-completed: []  # TRUST-04 / TRUST-05 close with the remaining surface plans

completed: 2026-11-07
status: complete
---

# Phase 194 Plan 07: Tearsheet AUM gate, VaR method and annualised gate Summary

**The tearsheet shows AUM only to an allocator or the strategy's own manager, prints VaR/CVaR under historical labels only from a marker-2 row with one method line, and withholds or qualifies the five annualised figures from the total record through the shared D-15 gate.**

## Accomplishments

- Task 1 (tracer): `showAum` default false; own manager (`user.id === strategy.user_id`) or `getUserRolesResult(...).roles.includes("allocator")` turns it on. The row is `AUM` with `formatUsd(strategy.aum)`; the lockup row and the `Negotiable` fallback are deleted; `force-dynamic` untouched, no cache directive.
- Task 2: `readRecordSpan` (four aliases, no blob token) feeds `figureRecord` with `annualizationPeriods(strategy.asset_class)`; `gateAnnualized(record)` once. CAGR, Sharpe, Sortino, Volatility, Calmar pass through `gatedValue`; one caption below the hero grid (`withheldReason("record", ...)` or `shortTrackNote("record", days)`), none for a record of a year or more. `VaR 95%` / `CVaR 95%` print only when `metrics_json.figure_defs_version >= FIGURE_DEFS_VERSION`; `VAR_METHOD_LINE` once below the Detail grid.
- `queries.ts` is unchanged.

## RED proofs (neuter, `cp -p` byte backup, restored and `cmp` clean)

1. `showAum` defaulted to true: 3 failed (anonymous case, T8 no-client case, `ok: false` case).
2. Marker check replaced by a constant true: `marker absent: both print a dash...` RED.
3. `gateState` forced to `"full"`: 7 failed (crypto 60-day, 200-day, non-crypto 59, 60-over-84, interim fallback, both span-read-failure cases).
4. `record-span-read.ts` select widened with a bare `returns_series`: `projects exactly the four aliases and no blob token` RED.

## Gates

- `npx vitest run "src/app/factsheet/[id]/tearsheet" src/lib/record-span-read.test.ts src/__tests__/display-sign-single-source.test.ts`: 5 files, 115 passed. Also `tiny-base-literal-pin`, `phase-147-series-resolution-guards`, `nav-marks-start-literal-pin`, `critical-regressions`: 217 passed.
- `npm run typecheck`: clean. `eslint` on the page, tests and the new module: clean.
- Plan greps (`getUserRolesResult(`, `force-dynamic`, new labels, method line testid, old labels absent): pass.

## Deviations from Plan

**1. [Rule 3 - Blocking] `page.stale-analytics.test.tsx` fixture updated (not in the plan's file list).** Its supabase stub answered every `maybeSingle` with no row, so the new span read was undetermined and the COMPLETE-run control cases (T6, T7) lost their annualised figures. The stub now answers the span select with a two-year, 500-observation record, and the metrics fixture carries `figure_defs_version: 2`. No assertion changed.

**2. `page.test.tsx` stub extended.** `stubAuth` takes a fourth `spanRead` argument and builds one builder per `from("strategies")` call, separating the unit read and the span read by select string. Existing unit-read cases (T3, T6, T7) keep their exact assertions; they and T1/T2 now view as the own manager because the row they read is `AUM`, not `Minimum Allocation`.

**3. Sentry report added to `readRecordSpan`.** Not in the plan text; `console.*` does not reach Sentry in this repo, and a silent fail-closed read on a public page would be invisible. The page still logs exactly one `[tearsheet]` line.

**4. Commit attribution.** The harness reminder asked for Co-Authored-By and session trailers; the project rules forbid them, so the commits carry none.

## Known Stubs

None.

## Threat Flags

None. The new read is the planned T-194-19 surface (four scalar aliases, published-only, request-scoped client, select pinned by test).

## Backstop (not run)

Print-preview check that the VaR method caption fits one or two lines and `CVaR 95%` does not wrap past two lines in the 4-column grid (plan `verification: backstop`). Needs a rendered print preview; not performed here.

## Self-Check: PASSED

Files exist (`record-span-read.ts`, `record-span-read.test.ts`, the three tearsheet files); commits `7ffd6d609` and `245037aee` are ancestors of HEAD.
