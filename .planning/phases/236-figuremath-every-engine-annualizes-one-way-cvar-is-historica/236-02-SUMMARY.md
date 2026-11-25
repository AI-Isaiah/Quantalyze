---
phase: 236-figuremath-every-engine-annualizes-one-way-cvar-is-historica
plan: 02
subsystem: figure-conventions
tags: [annualization, calendar-clock, cagr, census, moved-pins]
requires: [236-01]
provides:
  - "wholeCalendarDays(firstMs, lastMs) in src/lib/figure-conventions.ts (floor, 0 for a non-positive or non-finite span)"
  - "calendarYears = wholeCalendarDays / CALENDAR_DAYS_PER_YEAR (365): Scenario and the OG card CAGR ride it"
  - "TS frequency clock on named constants (closed-sets, book-figures) and Scenario's sd on SD_DDOF"
  - "TS census: closed-sets.ts, scenario.ts and book-figures.ts out of NOT_YET_MIGRATED"
affects: [236-03, 236-05, 236-09, 236-10]
tech-stack:
  added: []
  patterns: ["independent Date.parse / Math.floor / 365 oracle in each moved test, no production import"]
key-files:
  modified:
    - src/lib/figure-conventions.ts
    - src/lib/closed-sets.ts
    - src/lib/scenario.ts
    - src/lib/factsheet/og-metrics.ts
    - src/app/(dashboard)/allocations/lib/book-figures.ts
    - src/lib/closed-sets.test.ts
    - src/lib/scenario.test.ts
    - src/lib/scenario-blend07.test.ts
    - src/lib/factsheet/og-metrics.test.ts
    - src/lib/factsheet/return-stats.sites.test.ts
    - src/__tests__/annualization-census.test.ts
    - analytics-service/tests/test_constit_blend_parity.py
    - analytics-service/tests/fixtures/constit_parity_golden.json
decisions:
  - "closed-sets.ts moved its frequency-clock constants in Task 1, not Task 2: the census calls a listed engine with no token 'stale', so the file had to leave NOT_YET_MIGRATED in the same commit that removed its only token"
  - "scenario-factsheet-payload.ts and its test are untouched: they route through compute(), whose year expression moves in plan 236-10, so rewording their comments now would state something false"
metrics:
  duration: "about 50m"
  completed: 2026-11-25
status: complete
actuals:
  tokens: 7000
  tasks: 2
  commits: 2
plan_head_before: 1ee47ccc15d2f968bb3d34bbad06bb4717842e52
plan_head_after: 95c04fcf1005404327c8edc59d00e4e832b12a54
---

# Phase 236 Plan 02: calendar clock on whole days over 365 Summary

`calendarYears` is now whole days from the first to the last observed date (floor, as Python's `Timedelta.days`) over `CALENDAR_DAYS_PER_YEAR = 365`; Scenario's CAGR and the OG card's CAGR ride it, the frequency clock and Scenario's ddof read the named constants, and every moved pin has an independent oracle.

## Commits

| Task | Commit | What |
|---|---|---|
| 1 (tracer) | fcc3efe2f | `wholeCalendarDays`, `calendarYears` rewrite, closed-sets frequency clock on constants, moved pins and the Python mirror and golden, new residue and emptied-stretch cases |
| 2 | 95c04fcf1 | scenario.ts `SD_DDOF`, book-figures `PERIODS_PER_YEAR_CRYPTO`, census shrink, tsc fix in the census test |

RED at HEAD (before any engine edit), Task 1: 9 failing tests across `closed-sets.test.ts` (3), `scenario.test.ts` (2: gap-axis, emptied-stretch), `scenario-blend07.test.ts` (1), `og-metrics.test.ts` (2), `return-stats.sites.test.ts` (1), plus `test_A_kpis_match_engine` in pytest (cagr off the 0.95092 golden). All GREEN after the engine move. Task 2 RED: census `per-file token counts`, negative arm and positive arm failed for scenario.ts and book-figures.ts before the edits; GREEN after.

## Moved pins: old -> new -> why

Every new expected comes from an inline oracle that imports no production helper (`Date.parse` / `Math.floor(ms / 86_400_000)` / 365 in TS; `pd.Timestamp(...).days` / 365 and `datetime.date` arithmetic in Python). None was read off the engine.

| Pin | Old | New | Why (independent derivation) |
|---|---|---|---|
| `scenario.test.ts` `CAL_MS_PER_YEAR` / `calendarYearsIndep` | `(lastMs - firstMs) / (365.25 * 86_400_000)` | `Math.floor((last - first) / 86_400_000) / 365` | the Q1 rule written out from `Date.parse`; renamed `CAL_DAYS_PER_YEAR` |
| `scenario-blend07.test.ts` `NUMPY.cagr` | 0.41303027742895404 | 0.4126959321950805 | same twr 1.1567855193398886; span 2023-10-11 to 2025-12-31 = 812 whole days (Python `date` subtraction); `(1+twr)^(365/812) - 1`. The old value reproduces as `^(365.25/812)`, which checks the method |
| `constit_parity_golden.json` `kpis.cagr` | 0.95092 | 0.95003 | twr recomputed from the golden's own full-resolution `portfolio_daily_returns` (cumprod = 0.24325884321637825); span 2024-01-01 to 2024-04-29 = 119 whole days; `(1+twr)^(365/119) - 1 = 0.9500320554` rounds to 0.95003. The old value reproduces as `^(365.25/119)` = 0.95092. Hand-edited, `_readme` notes it; the capture script was not run |
| `test_constit_blend_parity.py` `_CALENDAR_DAYS_PER_YEAR` and `_calendar_years` | 365.25, fractional ms | 365, `Timedelta.days` whole days, 0 when not positive | Python mirror of scenario.ts |
| `og-metrics.test.ts` 300-day case | `365.25 / 299` | `365 / 299` | 300 consecutive dates span 299 whole days |
| `og-metrics.test.ts` 29-row case | `365.25 / 28` | `365 / 28` | 29 consecutive dates span 28 whole days |
| `return-stats.sites.test.ts` noisy-A `years` | `(t1 - t0) / (365.25 * 86_400_000)` | `Math.floor((t1 - t0) / 86_400_000) / 365` | the card's year expression written out inline |
| `closed-sets.test.ts` `calendarYears` | exact 365.25 days = 1; half = 0.5; gate bounds 346 and 348 days | 365 days = 1 exactly; 2024-01-01 to 2025-01-01 = 366/365; 73 days = 73/365; gate bounds 346 (< 0.95) and 347 (>= 0.95) | the 0.95 gate sits at 0.95 * 365 = 346.75 days, so the first clearing day is 347, not 348 |

New cases (not moved pins): 12-hour residue (10.5 days is 10/365; a day minus 1 ms is 0), `wholeCalendarDays` direct, emptied stretch in closed-sets (2024-01-02 to 2024-03-04 = 62/365) and in Scenario (20 weekdays, a ~10-week hole, 20 weekdays; expected from `1.001^40` and the independent span, and asserted not equal to the hole-dropped CAGR).

Not moved, and why: `scenario-factsheet-payload.test.ts`, `MetricsColumn.record-length.test.tsx`, `compute.metrics.test.ts`, `fetch-and-build-payload.test.ts` and `allocator-portfolio-payload.test.ts` read `compute()` or `record-length.ts`, whose `days / 365.25` moves in plan 236-10. Their 365.25 comments stay accurate until then.

## PROOF-01 (byte backups in the scratchpad, restored with cp, verified with cmp)

(a) Neuter in `src/lib/closed-sets.ts`, replacing the body of `calendarYears`:
`return wholeCalendarDays(firstDateMs, lastDateMs) / CALENDAR_DAYS_PER_YEAR;` -> `const ms = lastDateMs - firstDateMs; if (!Number.isFinite(ms) || ms <= 0) return 0; return ms / (365.25 * 86_400_000);`
- `npx vitest run src/lib/closed-sets.test.ts src/lib/scenario.test.ts` RED: `× calendarYears: whole days of the first-to-last span over 365 (the CAGR clock, F-5 / Q1)` / `AssertionError: expected 0.999315537303217 to be 1 // Object.is equality`; also `× [gap-axis] calendar-span CAGR diverges from the retired count-based CAGR` / `expected 0.1329 to be close to 0.13280574289009128`; also the emptied-stretch and residue cases; `Tests  5 failed | 101 passed (106)`.
- `cp` restore, `cmp OK (a)`.

(b) Neuter in `src/lib/figure-conventions.ts`: `return Math.floor(ms / 86_400_000);` -> `return ms / 86_400_000;`
- `npx vitest run src/lib/closed-sets.test.ts src/lib/scenario.test.ts src/lib/factsheet/og-metrics.test.ts` RED, one test only: `× calendarYears floors a span with a 12-hour residue to whole days (Python Timedelta.days)` / `AssertionError: expected 0.028767123287671233 to be 0.0273972602739726 // Object.is equality` / `Tests  1 failed | 142 passed (143)`.
- `cp` restore, `cmp OK (b)`.

(c) Neuter in `src/lib/closed-sets.ts`: `wholeCalendarDays(firstDateMs, lastDateMs) / CALENDAR_DAYS_PER_YEAR;` -> `wholeCalendarDays(firstDateMs, lastDateMs) / 366;`
- `npx vitest run src/lib/closed-sets.test.ts` RED, the 365-day case first: `× calendarYears: whole days of the first-to-last span over 365 (the CAGR clock, F-5 / Q1)` / `AssertionError: expected 0.9972677595628415 to be 1 // Object.is equality`; also residue and emptied-stretch; `Tests  3 failed | 46 passed (49)`.
- `cp` restore, `cmp OK (c)`.

(T2) Neuter in `src/lib/scenario.ts`: `sed -i '' 's/returnStatsSharpe(portDaily, { periodsPerYear, ddof: SD_DDOF })/returnStatsSharpe(portDaily, { periodsPerYear, ddof: 1 })/'`
- `npx vitest run src/__tests__/annualization-census.test.ts` RED, naming scenario.ts: `+   "src/lib/scenario.ts: literal ddof1 x1",` and `+   "src/lib/scenario.ts: token ddof1 recorded 0, measured 1",` / `× negative arm: a migrated engine has no 365.25, ddof-0 or bare ddof-1 literal` / `Tests  2 failed | 7 passed (9)`.
- `cp` restore, `cmp OK (T2)`, GREEN: `Tests  9 passed (9)`.

GREEN after (a), (b), (c) restores: `closed-sets.test.ts` 49 passed; full verify below.

## Verification

- `npx vitest run src/lib "src/app/(dashboard)/allocations" "src/app/factsheet/[id]/v2" src/__tests__/annualization-census.test.ts src/__tests__/phase-29-frozen-spine-guards.test.ts`: 620 of 625 files pass, 13438 tests pass, 8 fail. Two are `compute.conventions.test.ts` fixtures B and C (pre-existing last-digit `skew` float difference, in `deferred-items.md` from plan 01, `compute.ts` untouched). The other six (`return-stats.single-source.test.ts` x3, `FactsheetBody.advanced`, `FactsheetBody.basis`, `FactsheetView.window-kpis`) are 5000 ms timeouts under load and pass in isolation (123 tests passed in the four-file re-run).
- Task 2 scope run (`src/lib`, `allocations`, census): 3 files, 6 tests fail: the same two `compute.conventions` fixtures plus `return-stats.single-source` x3 and `RiskTabPanel.book-series` load timeouts; the last two files re-run in isolation: 37 passed.
- `npx tsc --noEmit -p tsconfig.json`: no output, clean.
- `pytest tests/test_constit_blend_parity.py tests/test_annualization_census.py tests/test_figure_conventions.py` from `analytics-service/`: 25 passed (parity file alone 5 passed).
- CI mypy strict (same command as ci.yml): `Success: no issues found in 144 source files`. No `services/` file changed; only a test and a fixture.
- Acceptance greps: `grep -a -c "365.25"` is 0 in closed-sets.ts, og-metrics.ts and test_constit_blend_parity.py; `grep -a -c SD_DDOF src/lib/scenario.ts` is 3.

## Deviations from Plan

**1. [Rule 3 - census coupling] closed-sets frequency-clock constants moved in Task 1.** The census treats a NOT_YET_MIGRATED engine with zero tokens as stale, so closed-sets.ts (whose only token, `365.25`, Task 1 removes) had to leave the list in the same commit, and leaving it requires its must_use list (`PERIODS_PER_YEAR_*`) be referenced. Task 2 therefore covers scenario.ts and book-figures.ts only.

**2. [Rule 1 - acceptance grep] Three comment lines in closed-sets.ts reworded.** The plan's `grep -a -c "365.25"` is a regex whose `.` matches `/`, so the pre-existing comments `365/252` counted as hits (3). Reworded to "365-to-252 ratio", "365-or-252 ternary", "365 crypto or 252 traditional". No behaviour change.

**3. [Rule 3 - blocking] `tsc --noEmit` failed on a plan 01 file.** `annualization-census.test.ts` used the `s` regex flag (`TS1501`, target ES2017). The pattern has no `.`, so the flag did nothing; removed in the Task 2 commit.

**4. [Rule 2 - extra pin] `constit_parity_golden.json` moved.** Not in the plan's file list; `test_A_kpis_match_engine` compared the Python mirror against the golden's frozen 365.25-day cagr, so it reds with the mirror. Re-derived by hand (table above); the golden's other figures are untouched.

**5. [Premise false at HEAD] `scenario-factsheet-payload.ts` and its test.** The plan says their math routes through `calendarYears`; it routes through `compute()`. Left untouched (see decisions).

## Notes for later plans

- The OG card's `?v=` cache-version constant (`og-metrics.ts`, "Bump it whenever the card's figure rules change") was NOT bumped. The card's computed CAGR moved (the 365-day year and the flooring; the 300-day test case went from 0.200398 to 0.200548); whether the phase bumps it once, at the end, is for the plan that owns the OG route.
- A span under one whole day now reads 0 years (so `cagr` null / NaN), where Python clamps to `max(days, 1)`. The plan's behaviour (0 for a non-positive span, floor) was followed; the two differ only for a same-day-to-next-day-less-than-24h span, which ISO day strings cannot produce.
- Published Scenario and OG CAGR and Calmar values shift on this merge (CONTEXT Q1 rated it costly); the fleet re-derive story belongs to the version-bump plans.

## Known Stubs

None.

## Threat Flags

None. T-236-04 (a pin re-pinned from engine output) is mitigated by the table above and PROOF-01 (a); T-236-05 by the floor helper plus PROOF-01 (b) and (c).

## Self-Check: PASSED

Files modified exist; commits fcc3efe2f and 95c04fcf1 are ancestors of HEAD; `commits: 2` is measured from the plan ledger (`1ee47ccc1..95c04fcf1`).
