---
phase: 131-smoothed-mtm-options-daily-mtm
plan: 01a
subsystem: analytics-service (Deribit native daily P&L)
tags: [deribit, options, mtm, smoothed_mtm, pure-core, tdd, fail-loud]
requires: []
provides:
  - fetch_deribit_option_daily_marks (deribit_ingest.py) — dormant option daily-mark fetcher
  - replay_option_positions (deribit_txn.py) — pure signed-position replay
  - option_mtm_daily (deribit_txn.py) — pure per-(ccy,day) ΔMTM + terminal_book, D-07 hole guard
  - docs/evidence/drb-option-daily-marks-2026-07.json (M7 2026-07-22 live-probe augment)
affects: []  # nothing invokes the new code yet — 131-01b wires the branch
tech-stack:
  added: []  # no new packages (threat T-131-SC accept upheld)
  patterns:
    - "greenfield clone of fetch_deribit_perp_daily_index (verbatim instrument + expiry-capped newest_day)"
    - "dense-calendar carry-forward book; telescoping ΔMTM sums to terminal_book exactly"
    - "D-07 fail-loud: missing bar inside listed life -> LedgerValuationError (instrument+earliest day)"
key-files:
  created:
    - analytics-service/.planning-note-only  # (evidence file already existed; augmented)
  modified:
    - analytics-service/docs/evidence/drb-option-daily-marks-2026-07.json
    - analytics-service/services/deribit_ingest.py
    - analytics-service/services/deribit_txn.py
    - analytics-service/tests/test_deribit_ingest.py
    - analytics-service/tests/test_deribit_txn.py
decisions:
  - "Task 0 evidence file pre-existed (Phase 82/83, _generated 2026-07-08). Augmented additively with an M7_live_probe_2026_07_22 section encoding the 4-expired-BTC-option probe + Apr-2026 option->future->cash two-step, rather than rewriting the settled M1–M6 facts."
  - "Position-drift guard raises id/type-only (never instrument/row payload) — stricter than _coerce_float's value-echo — to honor the leak discipline (T-131-02)."
  - "Retention-straddle falls through the SAME hole guard (no head-trim/special-case); accepted D-07 consequence pinned in the test docstring."
metrics:
  duration: ~35m
  completed: 2026-07-22
---

# Phase 131 Plan 01a: Option daily-mark fetcher + pure replay/ΔMTM core Summary

Landed the evidence record, the dormant option daily-mark fetcher, and the pure
`replay_option_positions` + `option_mtm_daily` core of the `smoothed_mtm` third factsheet
basis — proven by failing-first tests including the D-07 hole guard and the retention-straddle
case — with NOTHING invoking smoothed yet (independently CI-green, all new code dormant).

## Tasks

| Task | Name | Type | RED | GREEN | Files |
| ---- | ---- | ---- | --- | ----- | ----- |
| 0 | Evidence record (2026-07-22 probe) | auto | n/a | ab4b8250 | drb-option-daily-marks-2026-07.json |
| 1 | fetch_deribit_option_daily_marks | tdd | 6508f747 | 36668295 | deribit_ingest.py, test_deribit_ingest.py |
| 2 | replay_option_positions + option_mtm_daily | tdd | bc4ab78e | 68a19422 | deribit_txn.py, test_deribit_txn.py |

### Task 0 — Evidence record
The evidence JSON already existed from Phase 82/83. Augmented additively with an
`M7_live_probe_2026_07_22` section: 4 expired BTC options (Dec-24…Sep-25 expiries), each
status=ok / 401 daily bars / 08:00-UTC stamp; reconfirmed rejected alternatives, signed-position
semantics, telescoping identity, 2.5yr retention; and encoded the Apr-2026
option→future→cash two-step delivery mechanic (final P&L unchanged). Valid JSON verified.

### Task 1 — fetch_deribit_option_daily_marks
~90-line greenfield clone of `fetch_deribit_perp_daily_index` (same public
`get_tradingview_chart_data` 1D endpoint, same transient-retry→`DeribitTransientReadError`,
same `{}`-on-structural-no-data, same tick→UTC-day `setdefault` dedupe). Differences:
instrument name taken VERBATIM (no suffix synthesis); explicit expiry-capped `newest_day` bounds
(never fetch past expiry, never `now()`). 7 new tests. `fetch_deribit_perp_daily_index`
untouched.

### Task 2 — replay_option_positions + option_mtm_daily (pure)
- `replay_option_positions(rows)`: signed post-trade `position` replay per option instrument,
  gated on the existing `classify_instrument` option arm (perp/future/spot ignored), rows sorted
  by `(timestamp, id)` (crawl order not trusted), end-of-day = last row of the day, nonzero
  delivery accepted as data. Absent/null/blank/non-numeric position → `LedgerValuationError`
  (id/type-only).
- `option_mtm_daily(positions, marks)`: `Book[c][d]=Σ_instr pos×mark` over a dense calendar grid,
  positions carry forward, marks NEVER filled; `ΔMTM[c][d]=Book[c][d]−Book[c][d−1]` telescopes
  EXACTLY to `terminal_book` (float-exact fixtures: flat terminal → 0 = cash total; open terminal
  → open MTM; shorts invert). Returns `(delta_mtm, terminal_book)`.
- D-07 hole guard: nonzero carried position + no bar → `LedgerValuationError` naming
  instrument + earliest missing day. Load-bearing (mutation test: dropping one bar reddens a
  green fixture). Retention-straddle fails loud via the SAME guard — accepted consequence pinned
  in the test docstring.
- Pandas/async-free — AST purity guard green. Added stdlib `date, timedelta` import for the
  dense grid.

## Deviations from Plan

### Auto-fixed / adjustments
**1. [Rule 3 - Adaptation] Task 0 evidence file pre-existed.** The plan lists the evidence file
under `files_modified` and Task 0 says "commit the probe facts". The file already existed from
Phase 82/83 (`_generated: 2026-07-08`) carrying the M1–M6 facts. Rather than rewrite settled
facts, augmented it additively with the `M7_live_probe_2026_07_22` section (the concrete
4-instrument probe + Apr-2026 delivery mechanic that were NOT yet encoded). No settled fact
altered. Commit ab4b8250.

**2. [Leak discipline hardening] Position-drift message.** Wrote a bespoke id/type-only guard
message instead of reusing `_coerce_float` (which echoes the offending value) — honors T-131-02
(never leak row payloads). Test asserts the instrument strike (`100000`) is absent from the
message.

## Deferred / Out-of-scope

**Pre-existing unrelated failures (NOT introduced here):** 3 tests in
`tests/test_equity_reconstruction.py` (`test_v0_15_4_2_anchor_offsets_reconstructed_series_to_exchange_balance`,
`test_e1_anchor_skipped_when_unknown_perp_symbols_present`, `test_e1_clean_account_still_anchors`)
fail on an OKX `FakeExchange` attribute drift (`'FakeExchange' object has no attribute
'private_get_account_balance'`). PROVEN pre-existing: they fail identically with this plan's
source changes stashed/reverted. They touch neither `deribit_txn` nor `deribit_ingest` and are
out of scope per the executor SCOPE BOUNDARY. Not fixed here.

## Verification (plan gates)

- `pytest tests/test_deribit_txn.py tests/test_deribit_ingest.py -q` → **315 passed**
  (txn 170→190, ingest 118→125). Every pre-existing test UNMODIFIED and green.
- `pytest tests/ -q` → 4132 passed, 96 skipped, **3 pre-existing OKX failures** (documented above,
  proven independent of this plan).
- `mypy --strict --follow-imports=silent services/ routers/ models/` → **Success, 0 issues (84 files)**.
- AST purity guard (`test_option_enters_via_cash_delta_not_perp`) → **green** — `deribit_txn.py`
  stays pandas/async-free.
- `git diff 27ec4eef HEAD -- services/`: **260 insertions, 1 deletion** (the deletion is the
  `datetime` import line, expanded to add `date, timedelta` — additive). Every production hunk is
  a NEW function or its docstring; no existing execution path altered; no enum/branch/adapter
  change (deferred to 131-01b). `fetch_deribit_perp_daily_index` byte-untouched.

## Self-Check: PASSED
- FOUND: analytics-service/docs/evidence/drb-option-daily-marks-2026-07.json (valid JSON, M7 present)
- FOUND: fetch_deribit_option_daily_marks in services/deribit_ingest.py
- FOUND: replay_option_positions + option_mtm_daily in services/deribit_txn.py
- FOUND commits: ab4b8250, 6508f747, 36668295, bc4ab78e, 68a19422
</content>
</invoke>
