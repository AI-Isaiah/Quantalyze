---
phase: 236-figuremath-every-engine-annualizes-one-way-cvar-is-historica
plan: 11
subsystem: factsheet-ui
tags: [cagr, span, factsheet, fig-04]
requires: [236-03, 236-05, 236-10]
provides:
  - "formatCagrSpan(start, end): 'CAGR over 14 Mar 2024 to 02 Nov 2025 (598 days)', null when absent or not a span"
  - "payload.cagrStart / cagrEnd from the strategy_analytics select (arrow-path aliases of metrics_json)"
  - "one muted line under the CAGR row: stored span at full history, the window's own dates on a range"
  - "cagr_start / cagr_end on the simple (capital-reset) convention: first and last observed dates of the series the mean is taken over"
affects: [236-08, 236-09]
key-files:
  created:
    - src/app/factsheet/[id]/v2/MetricsColumn.cagr-span.test.tsx
  modified:
    - analytics-service/services/metrics.py
    - analytics-service/tests/test_metrics.py
    - src/lib/factsheet/record-length.ts
    - src/lib/factsheet/record-length.test.ts
    - src/lib/factsheet/fetch-and-build-payload.ts
    - src/lib/factsheet/fetch-and-build-payload.test.ts
    - src/lib/factsheet/types.ts
    - src/app/factsheet/[id]/v2/MetricsColumn.tsx
decisions:
  - "The stored span is carried only when the stored cash headline was admitted (the storedFigureDefs condition): otherwise the CAGR shown is compute()'s and no stored span describes it"
  - "Full history on a non-cash basis (mark-to-market, smoothed) states no span: the stored keys describe the cash headline, and a cash span under another basis's figure would be false"
  - "A same-day or reversed span formats to null (no line), not '(0 days)'"
metrics:
  completed: 2026-11-25
status: complete
actuals:
  tokens: 28000
  tasks: 3
  commits: 2
plan_head_before: 81ffd24da30a6cdfd0da08a6bd5400d8d0cee990
plan_head_after: 7d30453593c287fc4ab76c0012f2d5504c77a75f
---

# Phase 236 Plan 11: the factsheet states the span its CAGR covers Summary

A full-history factsheet with the stored keys prints one muted line under the CAGR row naming the first and last day and the whole first-to-last days its CAGR annualizes on. A narrowed range prints the window's own dates. A row stored before the keys existed prints nothing.

## Commits

| Work | Commit | What |
|---|---|---|
| Python, CONTEXT "Simple convention" bullet (raised by plan 03, deviation 3) | db82f455e | `cagr_start` / `cagr_end` on the simple convention are the first and last observed dates of `_cagr_basis` (the nonzero-day series on the active basis); replaces plan 03's None-on-simple pin; golden untouched (no golden uses the simple convention; `regen_golden.py` not run) |
| Tasks 1 and 2 (UI) | 7d3045359 | `formatCagrSpan`, select + payload carry + `FactsheetPayload.cagrStart/cagrEnd`, the span row in Main Metrics, all tests |

RED at HEAD, Python: `FAILED tests/test_metrics.py::test_cagr_span_keys_are_the_observed_span_on_the_simple_convention` and `FAILED tests/test_metrics.py::test_cagr_span_on_the_simple_convention_follows_the_active_day_basis`. GREEN after (`5 passed` with `-k cagr_span`).

RED at HEAD, TS (before any source edit): 14 failed / 140 passed across `record-length.test.ts` (5, formatter absent), `fetch-and-build-payload.test.ts` (4) and `MetricsColumn.cagr-span.test.tsx` (5). GREEN after: those three files 154 passed.

## Verification

- `npx vitest run src/lib/factsheet "src/app/factsheet/[id]/v2"`: 198 files, 3571 tests passed (Node 22.22.1).
- `npx tsc --noEmit -p tsconfig.json`: no output.
- `python3 -m mypy --strict --config-file=pyproject.toml services/metrics.py`: `Success: no issues found in 1 source file`.
- Python: 17 other failures in `test_metrics.py` / parity / golden / minigolden are identical with and without this plan's `metrics.py` edit (measured by running the same four files against `git show HEAD:...metrics.py`: same 17 plus the 2 new RED). They are an environment effect: local quantstats is 0.0.81, `requirements.txt` pins 0.0.86. Not touched, not re-pinned.

## PROOF-01 (verbatim)

Neuter (a): `src/lib/factsheet/fetch-and-build-payload.ts`, byte backup taken, the select of `cagr_start:metrics_json->cagr_start, cagr_end:metrics_json->cagr_end` removed.
```
      Tests  1 failed | 136 passed (137)
 FAIL  |jsdom| src/lib/factsheet/fetch-and-build-payload.test.ts > 236 plan 11 - the stored CAGR span through fetchAndBuildPayload > the strategies select carries both span keys as arrow paths and still no bare metrics_json
AssertionError: expected 'id, name, codename, disclosure_tier, …' to contain 'cagr_start:metrics_json->cagr_start'
RESTORED cmp ok
 Test Files  1 passed (1)
      Tests  137 passed (137)
```
Note: the fake client returns the seeded row whatever the select says, so the arm that goes RED is the select-token arm, not "the payload carries them verbatim". The select itself is what the production path needs, and that arm names it.

Neuter (b): `src/app/factsheet/[id]/v2/MetricsColumn.tsx`, byte backup taken, the span `<tr>` render removed.
```
      Tests  5 failed | 1 passed (6)
 FAIL  ... > an emptied stretch stays inside the span (Q1) > a range across the hole counts it: first to last observed day of the window
 FAIL  ... > an emptied stretch stays inside the span (Q1) > full history: the stored first-to-last span covers the 40 empty days
 FAIL  ... > the CAGR span line (FIG-04, Q1) > a narrowed range states its window even when the row has no stored keys
 FAIL  ... > the CAGR span line (FIG-04, Q1) > a narrowed range states the window's own first and last dates, not the stored span
 FAIL  ... > the CAGR span line (FIG-04, Q1) > full history with the stored keys states the stored span under the CAGR row
AssertionError: expected null to be 'CAGR over 20 Feb 2024 to 28 Aug 2024 …'
RESTORED cmp ok
 Test Files  1 passed (1)
      Tests  6 passed (6)
```
Both restores were `cp` from the byte backup followed by `cmp` (no output on mismatch, "RESTORED cmp ok" printed on match).

## Deviations from Plan

**1. [Premise gap, instructed] Python simple-convention span.** The plan's file list has no `metrics.py`; the orchestrator's brief (CONTEXT "Simple (capital-reset, arithmetic) convention" bullet) asked for it here. Done in db82f455e with tests. The "no CAGR, simple" arm (all-zero active basis) cannot be tested: the engine raises `DataValidationError: Input data cannot be empty` from quantstats before reaching it (pre-existing). The code guards on `cagr is not None` regardless.

**2. [Files outside the list] `src/lib/factsheet/types.ts`.** The plan said "two optional string fields where `figureDefsVersion` is typed", but that type (`StoredFigureDefs`) is a build option, not the payload the UI reads. The fields went on `FactsheetPayload` (`cagrStart`, `cagrEnd`, optional, nullable).

**3. [Condensed] Tasks 1 and 2 share one commit.** Task 2's narrowed-range and emptied-stretch arms live in the same test file and the same JSX as Task 1's line; they were written and RED-checked together. PROOF-01 arms for both are recorded above.

**4. [Scope decision, recorded] Non-cash basis at full history states no span.** The stored keys describe the cash headline. Under mark-to-market or smoothed, a cash span printed under that basis's CAGR would be false and its true span is not stored, so the line is omitted (the plan's "stored keys absent, nothing" rule, extended). Founder can reverse by using `m.start` / `m.end` there.

**5. [Known limit] USD view, the Scenario composer and composite payloads built without the stored keys state no span at full history** (the USD view recomputes its CAGR from the converted series, so the native stored span does not describe it). They do state the window on a narrowed range. Not booked as TODOS.

## Known Stubs

None.

## Threat Flags

None. T-236-16 (invented span text) mitigated: absent or malformed keys give null, tested at the formatter, the fetch and the render. The two new select aliases are scalar arrow paths, and the existing test that forbids a bare `metrics_json` in the select still passes.

## Self-Check: PASSED

- `src/app/factsheet/[id]/v2/MetricsColumn.cagr-span.test.tsx`: FOUND
- `src/lib/factsheet/record-length.ts` (`export function formatCagrSpan`): FOUND
- `grep -a -c "cagr_start" src/lib/factsheet/fetch-and-build-payload.ts`: 2 (expected >= 1)
- `grep -a -c "formatCagrSpan" "src/app/factsheet/[id]/v2/MetricsColumn.tsx"`: 3 (expected >= 1)
- commits db82f455e and 7d3045359 are ancestors of HEAD
