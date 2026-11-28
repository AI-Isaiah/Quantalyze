---
phase: 259-okxarchivefills-okx-fills-older-than-fills-history-s-3-month
plan: 01
subsystem: analytics-service / exchange ingest
tags: [okx, fills, normaliser, golden, extraction, pytest, mypy]

requires:
  - phase: 255-nullanchor
    provides: the live OKX fills-history pager `_fetch_raw_trades_okx_inst_type` and its cursor contract
provides:
  - "`_normalize_okx_fill(fill, inst_type, exchange)`: the single per-fill OKX normaliser (live pager calls it; plan 04's archive mapper will)"
  - "tests/test_okx_normalize_fill_golden.py: 12-arm literal golden of the live normaliser, recorded before the extraction, plus direct-helper arms"
affects: [259-04 archive mapper, 259-08 PROOF-01 neuters]

status: complete
commits: 2
plan_head_before: 69646de134c48eb9ec05abd2bd7fd54dcf0da7d3
plan_head_after: 11b9cdf4f3fcdc3009e218b749d70477a7ba5ef1

actuals:
  tokens: 7100        # chars/4 over the realized diff (28418 chars, + and - lines)
  tasks: 2
  commits: 2

tech-stack:
  added: []
  patterns:
    - "golden-before-extraction: record the loop's output as literals, commit it green on unmodified code, then move the code"

key-files:
  created:
    - analytics-service/tests/test_okx_normalize_fill_golden.py
  modified:
    - analytics-service/services/exchange.py

key-decisions:
  - "The pager keeps the drop-and-continue with an `if normalized is not None: fills.append(...)` form instead of `if normalized is None: continue`, so git diff against the phase base shows exactly two hunks (a retained `continue` line otherwise split the loop-body hunk in two by coincidental line matching). Behaviour is identical."
  - "The now-unused `_is_linear_type` local in the pager was left in place: neither mypy strict nor any repo linter flags it, and the plan prefers fewer moved lines."

requirements-completed: [SC-1, SC-6]

coverage:
  - id: D1
    description: "Golden of the live OKX fills normaliser, 12 literal arms, committed green on unmodified exchange.py before any edit to it"
    requirement: "SC-6"
    verification:
      - kind: unit
        ref: "analytics-service/tests/test_okx_normalize_fill_golden.py::TestLiveOkxFillsGolden"
        status: pass
  - id: D2
    description: "`_normalize_okx_fill` extracted; live loop calls it; direct-helper arms replay the same table"
    requirement: "SC-1"
    verification:
      - kind: unit
        ref: "analytics-service/tests/test_okx_normalize_fill_golden.py::TestNormalizeOkxFillDirect"
        status: pass
---

# Phase 259 Plan 01: OKX fills normaliser extraction Summary

The per-fill body of the live OKX `fills-history` loop is now one pure helper, `_normalize_okx_fill`, pinned by a literal golden that was committed green on unmodified code before the move.

## What was done

**Task 1 (tracer), commit `27d2fdefd81a805852f0363714129d435fd4307e` (`GOLDEN_SHA`).** Added `analytics-service/tests/test_okx_normalize_fill_golden.py`: a plain fake exchange (not AsyncMock; `markets = {}`), an autouse fixture pinning `_STORE_FULL_RAW_DATA` False, the module-level `GOLDEN_CASES` table (12 arm ids: `eth_linear_net`, `btc_linear_long`, `sol_ctval_one`, `inverse_btc_usd`, `unknown_ctval_pepe`, `maker_short`, `missing_fee`, `invalid_posside`, `spot_passthrough`, `bad_ts`, `nan_px`, `zero_sz`) and `TestLiveOkxFillsGolden` (9 emitting arms compared whole with `==`, 3 drop arms with a bad fill between two good ones). Every input carries `fillTime` one ms before `ts`. Passed 12/12 on unmodified exchange.py (precondition `git diff --quiet <merge-base> -- exchange.py` exit 0; `git show --name-only` of this commit lists only the golden file).

**Task 2, commit `11b9cdf4f3fcdc3009e218b749d70477a7ba5ef1`.** Moved the `for fill in data:` body verbatim into `_normalize_okx_fill` above `_fetch_raw_trades_okx_inst_type` (each `continue` became `return None`, the final `fills.append(dict(_make_fill_dict(...)))` became `return dict(_make_fill_dict(...))`, `_is_linear_type` computed inside the helper, all comments and log texts kept, `fill.setdefault("_ingest_ctval", ...)` still before `raw_data = dict(fill)`, `ts` still the timestamp source). The pager calls the helper. Added `TestNormalizeOkxFillDirect` (12 table arms, the in-place `_ingest_ctval` mutation pin, and an `exchange=None` arm).

## Verification (measured)

- `pytest tests/test_okx_normalize_fill_golden.py`: 26 passed (12 golden, 12 direct, 2 extra pins).
- `pytest tests/test_exchange.py tests/test_nullanchor_bound.py tests/test_okxtrades_walk.py` (whole files, unedited): 331 passed.
- The plan's `-k "okx or Okx or OKX or Golden or Normalize"` selection across all four files: 118 passed.
- `make typecheck` (mypy strict): Success, no issues in 146 source files.
- `node scripts/verify-plan-anchors.mjs` on the plan: OK, 9 claims, no stale.
- `git diff -U0 <merge-base> -- analytics-service/services/exchange.py | grep -c '^@@'` = 2; no added or removed import line; no deletions in either commit.
- Golden diff since `GOLDEN_SHA`: the only removed line is the import line (now also imports `_normalize_okx_fill`); no line inside `GOLDEN_CASES` or `TestLiveOkxFillsGolden` was removed or changed.
- Local sanity neuter (byte backup in scratch, restored and proven with `cmp`): dropping the ctVal multiply turned 18 of 26 RED; reading `fillTime` instead of `ts` turned 22 of 26 RED. PROOF-01 in plan 08 does the formal version.

## Findings worth carrying into plan 04

- **Trailing zeros are stored.** Linear quantity is `Decimal(fillSz) * Decimal(str(ctVal))` with a float ctVal, so a ctVal of `1.0` stores `fillSz "2"` as quantity `"2.0"` and cost `"300.500"` (SOL, and the unknown-prefix fallback `PEPE` stores `"1000.0"`). Inverse and SPOT keep `fillSz` as typed. An archive fill reaching the stored row through this helper gets the same strings; a test that compares against a hand-written archive quantity must expect the same trailing zero (compare numerically if a Decimal comparison is intended).
- **The helper mutates its input** (`_ingest_ctval`), so the archive mapper must pass a fresh dict per call if it reuses a parsed row.
- The pager still reads the `fill.get("ts")` field only; `fillTime` is never used. The archive mapper must supply `ts` in milliseconds as a digit string.

## Deviations from Plan

None to behaviour. Two small form choices, recorded under key-decisions: the `is not None` append form (to keep exchange.py at exactly two hunks), and leaving the unused `_is_linear_type` local in the pager.

## Known Stubs

None.

## Threat Flags

None. No new network endpoint, auth path or schema change; the helper is the existing loop body moved.

## Self-Check: PASSED

- FOUND: analytics-service/tests/test_okx_normalize_fill_golden.py
- FOUND: `def _normalize_okx_fill(` in analytics-service/services/exchange.py (count 1), call site `_normalize_okx_fill(fill, inst_type, exchange)` (count 1)
- FOUND commits 27d2fdefd81a805852f0363714129d435fd4307e and 11b9cdf4f3fcdc3009e218b749d70477a7ba5ef1 (golden precedes the extraction in `git log`)
