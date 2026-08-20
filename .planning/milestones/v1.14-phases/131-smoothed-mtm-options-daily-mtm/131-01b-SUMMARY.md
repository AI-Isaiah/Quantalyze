---
phase: 131-smoothed-mtm-options-daily-mtm
plan: 01b
subsystem: analytics-service (Deribit native daily P&L — the smoothed_mtm third basis)
tags: [deribit, options, mtm, smoothed_mtm, tdd, fail-loud, sc-4, money-path]
requires:
  - fetch_deribit_option_daily_marks (131-01a)
  - replay_option_positions + option_mtm_daily (131-01a)
provides:
  - PNL_BASIS_SMOOTHED_MTM in BOTH basis enums (deribit_txn._PNL_BASES + allocated_capital._VALID_PNL_BASES)
  - use_smoothed branch in txn_rows_to_native_daily (option full change, summary inert)
  - smoothed-gated ΔMTM merge in build_deribit_native_ledger (_build_smoothed_option_mtm)
  - CompletenessReport.pre_mark_retention_option_days (pre-retention cash-basis bucket)
  - smoothed-only book channel + Q3-3 summary cross-check in assert_balance_identity
  - DeribitNativeAccountState.native_options_session_upl (settled-book anchor leg)
affects:
  - deribit_ingest.build_deribit_native_ledger (smoothed arm only — cash/mtm byte-untouched)
  - deribit_txn.assert_balance_identity (smoothed arm only)
tech-stack:
  added: []  # no new packages (threat T-131-SC accept upheld)
  patterns:
    - "third factsheet basis as an ADDITIVE branch gated on pnl_basis==smoothed_mtm OR option classification (never a rewrite)"
    - "cash channel is the PRE-merge native_daily (strict Σ==Σchange); ΔMTM merged into a SEPARATE series_daily; book channel reconciles the terminal book against the venue anchor"
    - "pre-retention partition keys on WHOLLY-empty marks AND expiry-past-horizon; straddlers (partial marks) fall through the 01a hole guard (fail loud)"
key-files:
  created:
    - analytics-service/tests/test_smoothed_mtm_core.py
  modified:
    - analytics-service/services/deribit_txn.py
    - analytics-service/services/allocated_capital.py
    - analytics-service/services/deribit_ingest.py
    - analytics-service/tests/test_native_nav_sc4_identity.py
decisions:
  - "native_options_session_upl added to DeribitNativeAccountState with a field(default_factory=dict) DEFAULT (not positional like native_options_value) — 4 pre-existing tests construct the frozen dataclass with 7 positional args; a defaulted trailing field keeps them valid and pins absent→0.0 (SC-4)."
  - "The Q3-3 summary cross-check was IMPLEMENTED (not deferred): Σ(rpl+upl) over each coverage window == Σ(option change+commission) inside + ΔBook, smoothed-only, inert without summary rows, with a material tolerance max($1-equiv, 1e-4·max(throughput,|lhs|,|rhs|)). Pinned by a consistent-inputs green + a gross-perturbation breach (mutation-honesty)."
  - "The native_pnl series is built from a NEW series_daily dict (cash native_daily merged with ΔMTM under smoothed); under every other basis series_daily IS native_daily (alias) → byte-identical (SC-4). The strict cash-channel identity still reconciles the PRE-merge native_daily."
metrics:
  duration: ~2h
  completed: 2026-07-22
  tasks: 4
  new_tests: 36
---

# Phase 131 Plan 01b: smoothed_mtm third factsheet basis — enum + branch + adapter merge + identity channels Summary

Wired 131-01a's dormant pure core (`replay_option_positions` / `option_mtm_daily` /
`fetch_deribit_option_daily_marks`) into a live, additive `smoothed_mtm` third
`pnl_basis`: both basis enums carry it, `txn_rows_to_native_daily` books options on full
cash `change` with an inert summary channel, `build_deribit_native_ledger` merges a
per-(day,ccy) ΔMTM book (smoothed-gated), and `assert_balance_identity` gains a strict
cash channel + a book-channel anchor cross-check + the Q3-3 summary cross-check — all
proven failing-first, with `cash_settlement` and `mark_to_market` byte-identical (SC-4).

## Tasks

| Task | Name | Commit | Key files |
| ---- | ---- | ------ | --------- |
| 3 | smoothed_mtm in BOTH enums + use_smoothed branch | 4781a995 | deribit_txn.py, allocated_capital.py, test_smoothed_mtm_core.py |
| 4 | adapter ΔMTM merge + pre-retention bucket | 8717c16f | deribit_ingest.py, test_smoothed_mtm_core.py |
| 5 | smoothed-only identity channels + native_options_session_upl | 4dd1b4d3 | deribit_txn.py, deribit_ingest.py, test_smoothed_mtm_core.py |
| 6 | SC-4 byte-identity pins + acceptance A–D + full gates | 32c3a41c | test_smoothed_mtm_core.py, test_native_nav_sc4_identity.py |

### Task 3 — enums + use_smoothed branch
`PNL_BASIS_SMOOTHED_MTM = "smoothed_mtm"` added to `deribit_txn._PNL_BASES` and
`allocated_capital._VALID_PNL_BASES` (config/compute agreement, enum-sync pin);
`DEFAULT_PNL_BASIS` unchanged. In `txn_rows_to_native_daily`, `use_smoothed` gates an
inert summary arm (contributes nothing, still fails loud on a nonzero summary `change`).
Option trade/delivery rows book their FULL cash `change` automatically — `coverage_windows`
is empty for every non-mtm basis, so the coverage-gated `−commission` arm is never entered.
The smoothed cash channel is byte-identical to `cash_settlement` (the ΔMTM redistribution
lives in the adapter, preserving AST purity and the marks-free signature).

### Task 4 — adapter ΔMTM merge + pre-retention bucket
`_build_smoothed_option_mtm` replays the option book, fetches ONE expiry-capped marks
request per held instrument (`_option_expiry_iso` parses the dated segment, never guessed),
partitions off pre-retention instruments (wholly-empty marks AND expiry older than the
`_OPTION_MARK_RETENTION_DAYS = 913` horizon → `CompletenessReport.pre_mark_retention_option_days`,
days stay cash-basis), and feeds the rest to `option_mtm_daily` (which fails loud on any
hole — in-retention empties and retention STRADDLERS with partial marks are never bucketed).
ΔMTM merges into a separate `series_daily` dict (the cash `native_daily` stays the balance-
identity reference). Doubly gated: `basis==smoothed_mtm` AND option classification → zero
fetches + byte-identical output under cash/mtm/perp-only. A wiring-guard (neuter
`option_mtm_daily` → empties) proves the merge is actually invoked.

### Task 5 — smoothed-only identity channels + native_options_session_upl
`assert_balance_identity` gains four defaulted kwargs (`terminal_book`,
`native_options_value`, `native_options_session_upl`, `option_delta_mtm`). Under smoothed
only: (1) the existing strict cash channel runs over ALL currencies (no open-option
exemption — every option row books full change); (2) `_assert_smoothed_book_channel`
reconciles the replayed settled book against the venue anchor's settled book
(`options_value − options_session_upl`), the independent T-131-04 replay-drift backstop;
(3) `_assert_smoothed_summary_cross_check` polices the summary stream (Q3-3). All inert /
`None` for the other bases (SC-4). `DeribitNativeAccountState.native_options_session_upl`
reads `options_session_upl` off the same summaries response (absent → 0.0, defaulted field).

### Task 6 — acceptance A–D + SC-4 keystone
Acceptance A (flat terminal → smoothed total == cash total, float-exact via exact-binary
marks + `struct.pack` bit-check), B (no session lumps — P&L spread across ≥3 held days,
each ≈ its mark delta; cash lumps on 2 days), C (open book telescopes to Σchange + Book),
D (in-retention mark hole fails loud naming instrument + earliest missing day). SC-4
keystone: the all-USD-family `test_native_nav_sc4_identity` matrix under `smoothed_mtm` is
bit-exact to `cash_settlement` with zero option-mark fetches (the stub has no chart
endpoint — an AttributeError would fire if the basis wrongly probed).

## Deviations from Plan

### Adjustments (all within the plan's additive mandate — no gate loosened)

**1. [Design choice] `native_options_session_upl` is a DEFAULTED field, not positional.**
The plan mirrors `native_options_value` (added positionally). But 4 pre-existing tests
(`test_broker_dailies`, `test_mtm_single_key`, `test_job_worker_deribit`,
`test_deribit_ingest`) construct the frozen `DeribitNativeAccountState` with 7 positional
args. A trailing `field(default_factory=dict)` keeps every existing constructor valid
(honoring "no pre-existing test modified") AND pins the plan's required absent→0.0. Both
real read sites pass the populated map; the two failed-read sites keep the default.

**2. [SC-4-safe refactor] native_pnl series built from `series_daily`, not `native_daily`.**
Under smoothed the ΔMTM is merged into a NEW `series_daily` dict feeding the series (and
thus the dense-mark span); the strict cash-channel identity still reconciles the PRE-merge
`native_daily`. For every non-smoothed basis `series_daily is native_daily` (alias) → the
`native_pnl` comprehension is byte-identical. Proven by the unchanged SC-4 matrix + the new
smoothed-vs-cash bit-exact test.

**3. [Helper param, not a test] `_real_adapter_ledger` gained a defaulted `pnl_basis`.**
`test_native_nav_sc4_identity._real_adapter_ledger` (a shared HELPER, not a test function)
gained `pnl_basis: str = "cash_settlement"`. The default preserves every existing caller
byte-for-byte; no test body was modified or deleted.

None of the 83-PLAN Task-4/6 DELETIONS were performed: the Phase-82 fee-only reclass,
`_summary_contribution`, the CR-01 `open_option_ccys` exemption, and every existing test
remain intact. Every production hunk is inside a `use_smoothed`/smoothed-gated arm, a new
function, or the two enum lines.

## Deferred / Out-of-scope
- Worker (both routes) + frontend SegmentedControl third option → 131-02 / 131-03.
- Live acceptance (Phoenix key `95089958` re-onboard) → post-131-03 (key deleted from test DB).
- Persistent per-instrument mark cache → named follow-up knob (per-job memoization suffices now).

## Pre-existing unrelated failures (NOT introduced here)
3 tests in `tests/test_equity_reconstruction.py` fail on an OKX `FakeExchange` attribute
drift (`private_get_account_balance`) — identical before/after this plan, out of scope.

## Verification (plan gates)
- `pytest tests/ -q` → **4168 passed, 96 skipped**, 3 pre-existing OKX failures (baseline was
  4132 passed → +36 new tests; zero NEW failures).
- `mypy --strict --follow-imports=silent services/ routers/ models/` → **Success, 0 issues (84 files)**.
- AST purity guard (`test_option_enters_via_cash_delta_not_perp`) → **green** —
  `deribit_txn.py` stays pandas/async-free (the ΔMTM merge lives in the async adapter).
- `git diff` audit: production deletions are additive-context only (enum expansion, `timedelta`
  import, comment expansion, and the `native_daily`→`series_daily` alias which is byte-identical
  for non-smoothed). No cash/mtm execution path altered; no pre-existing test modified/deleted.
- Byte-identity proof: `test_usd_native_smoothed_bit_exact_to_cash` (whole SC-4 matrix,
  `check_exact=True`) + `test_acceptance_A_redistribution_preserves_total` (`struct.pack`
  bit-equal smoothed vs cash total) both green.

## Self-Check: PASSED
- FOUND: PNL_BASIS_SMOOTHED_MTM in services/deribit_txn.py
- FOUND: smoothed_mtm in services/allocated_capital.py (_VALID_PNL_BASES)
- FOUND: pre_mark_retention_option_days + _build_smoothed_option_mtm in services/deribit_ingest.py
- FOUND: _assert_smoothed_book_channel + _assert_smoothed_summary_cross_check in services/deribit_txn.py
- FOUND: analytics-service/tests/test_smoothed_mtm_core.py (24 tests)
- FOUND commits: 4781a995, 8717c16f, 4dd1b4d3, 32c3a41c
</content>
