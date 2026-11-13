---
phase: 194-figuretruth-a-figure-means-one-thing-everywhere-and-shows-on
plan: 12
subsystem: figure-gate
tags: [trust-05, d-11, d-14, d-15, figure-gate, rolling, delta]
requires: ["194-03", "194-13"]
provides:
  - shorterSpan, gateDelta, rollingWindowSpanDays, RollingWindowSpec, gateRollingWindow, RollingVerdict
  - WidenedKind, widenedWithheldReason, widenedShortNote
  - src/lib/figure-gate.d11.test.ts
affects: ["194-14", "194-15", "194-16", "194-17", "194-18", "194-21", "194-22", "194-24"]
tech-stack:
  added: []
  patterns: ["verdicts end in recordClears + gateAnnualized; no literal 60/90/365 outside plan 03 constants"]
key-files:
  created: [src/lib/figure-gate.d11.test.ts]
  modified: [src/lib/figure-gate.ts]
key-decisions:
  - "Withholding for every widened kind sits on the total record only (D-15); the window qualifies the note"
  - "gateRollingWindow follows the plan's literal order, so an undeterminable record with enough dates returns state null, cause null"
requirements-completed: [TRUST-05]
status: complete
commits: 2
plan_head_before: e795d76269efcaad31e3bac7a6d713878794336a
plan_head_after: 6c17f6ed2
actuals:
  tokens: 9000
  tasks: 2
  commits: 2
---

# Phase 194 Plan 12: D-11 shared verdicts and copy Summary

One shared set of D-11 helpers in `src/lib/figure-gate.ts`: delta, rolling-window and half-record verdicts all end in `recordClears` and `gateAnnualized`, plus the withheld and short-track copy for the widened kinds, pinned by `figure-gate.d11.test.ts` (51 tests).

## What was built

- `shorterSpan`, `gateDelta` (withheld if either record fails the total-record gate, null if either is undeterminable, else short/full from the compared window), `rollingWindowSpanDays` (shortest span over every full window), `RollingWindowSpec` (`rows` or D-14 `calendarDays`), `RollingVerdict`, `gateRollingWindow` (gate cause, then record cause, then `gateAnnualized`).
- `WidenedKind`, `widenedWithheldReason`, `widenedShortNote`, built from a private `recordBoundClause` that uses `MIN_ANNUALIZATION_DAYS`, `MIN_ANNUALIZATION_OBS` and plan 03's `count`/`plural`/`days` formatter. No number is restated.
- Test pins: boundary verdicts, D-15 short windows never withhold, D-14 calendar window is full, `rollingVol`/`rollingSharpe`/`rollingSortino` null at indices 0..124 and finite at 125, every sentence verbatim, day/days and thousands, banned strings, withheld sentences carry only the bound and the record's count, `ONE_YEAR_DAYS = 365` read once from `metrics.py` equals the TS constant.

## Assumptions recorded

A-194-D11-01 (row window span in calendar days first-to-last, so 126 daily rows span 125; all current row windows are short), A-194-D11-02 (new copy in the UI-SPEC idiom), A-194-D11-03 (Treynor gated with alpha, tracking error, information ratio), A-194-D11-04 (rolling beta not annualized, ungated), A-194-D15-01 (gate cause wins when the record fails the gate and has no window).

## Neuter -> RED -> restore (cp -p byte backups, restored after each)

1. `gateRollingWindow` ignoring `enough`: `FAIL ... `enough` false withholds even when the dates would hold a window` / `AssertionError: expected null to be 'record'` (1 failed | 26 passed). The plan's 100-day case still passed because 100 dates are fewer than 126 anyway; the added `enough`-only case is the one that bites.
2. Withholding a row window under 90 days (the superseded D-11 rule): `FAIL ... a 30-row window is short too` (`expected { state: 'withheld', days: 29 ...} to deeply equal { state: 'short' ...}`) and `FAIL ... a non-crypto 70-observation weekday record ... is short` (2 failed | 25 passed).
3. `gateDelta` withholding on the compared window instead of the records: `FAIL ... a short compared window never withholds (D-15)` / `AssertionError: expected 'withheld' to be 'short'` (1 failed | 26 passed).
4. Dropping the thousands separator in `widenedShortNote("delta")`: `FAIL ... agrees on one day, prints thousands ...` / `expected 'Changes in annualized figures are mea...' to contain 'measured over 1,234 days,'` (1 failed | 50 passed).
5. `overlap` sentence ignoring the record's asset class: `FAIL ... widenedWithheldReason ... > overlap` (1 failed | 50 passed).

## Deviations from Plan

None - plan executed as written. One note: the plan's "reuse plan 03's record-bound clause" had no shared function to reuse (plan 03 inlines the wording in `withheldReason`), so `recordBoundClause` is new and private; `withheldReason` was left untouched (surgical change).

## Verification

`npx vitest run src/lib/figure-gate.d11.test.ts src/lib/figure-gate.test.ts` 83 passed; `npm run typecheck` clean; `npx eslint` on both files clean; all five exports present; `ONE_YEAR_DAYS = 365` in `analytics-service/services/metrics.py`.

## Known Stubs

None.

## Threat Flags

None.

## Self-Check: PASSED

Files and commits (ceac4c795, 6c17f6ed2) verified present.
