---
phase: 131-smoothed-mtm-options-daily-mtm
verified: 2026-07-22T00:00:00Z
status: passed
score: 9/9 must-haves verified
overrides_applied: 0
deferred:
  - truth: "Live acceptance on a real Deribit options book (Phoenix key 95089958 re-onboard)"
    addressed_in: "post-131-03 live verification (per 131-01b success_criteria / 83-PLAN Task 10)"
    evidence: "131-01b-PLAN success_criteria: 'Live acceptance (Phoenix 95089958 re-onboard, Zav2) stays OUT of this plan — deferred to post-131-03 live verification (key currently deleted from test DB)'"
  - truth: "Worker persistence (both routes) + frontend SegmentedControl third option"
    addressed_in: "Phase 132 (SMTM-03) / Phase 133 (SMTM-04)"
    evidence: "REQUIREMENTS.md maps SMTM-03 → 132-01, SMTM-04 → 133-01; 131 scope is the pure core (SMTM-02 + SMTM-01 core portion)"
---

# Phase 131: Smoothed MTM (options daily mark-to-market) — pure core Verification Report

**Phase Goal:** A Deribit options book computed under `pnl_basis="smoothed_mtm"` yields a daily
series with NO session-lump spikes; the smoothed total equals the cash_settlement total on a
flat terminal book; perp-only/USD-native books stay byte-identical (SC-4) with ZERO
option-mark fetches; sparse marks inside a listed instrument's life FAIL LOUD (no
interpolation, no session-lump fallback); `deribit_txn.py` stays pandas/async-free.
**Verified:** 2026-07-22 (branch `feat/phase-83-smoothed-mtm`, HEAD 32c3a41c)
**Status:** passed
**Re-verification:** No — initial verification

## Verification runs (executed by verifier, not trusted from SUMMARY)

| Gate | Command | Result |
| ---- | ------- | ------ |
| Phase suites | `.venv/bin/python -m pytest tests/test_smoothed_mtm_core.py tests/test_deribit_txn.py tests/test_deribit_ingest.py -q` | **343 passed** in 1.84s |
| Full suite | `.venv/bin/python -m pytest tests/ -q` | **4168 passed, 96 skipped, 3 failed** — all 3 pre-existing OKX `FakeExchange` fixture drift in `tests/test_equity_reconstruction.py` (file last touched at 9b193786, long before this phase; failure path `exchange.py:2808` OKX private endpoint, untouched by phase diff) |
| mypy | `.venv/bin/python -m mypy --strict --follow-imports=silent services/ routers/ models/` | **Success: no issues found in 84 source files** |
| AST purity guard | `pytest tests/test_deribit_txn.py -k "cash_delta_not_perp" -q` | **1 passed** — AST walk forbids `services.exchange`/`ccxt`/`pandas`/`supabase` imports in deribit_txn.py |
| Async-free (direct) | `grep -c "async def" services/deribit_txn.py` → 0; imports = stdlib + `services.external_flows` only | **confirmed** |
| Commits | all 9 claimed commits (ab4b8250…32c3a41c) exist, RED precedes GREEN, all on current branch | **confirmed** |

## Goal Achievement — Observable Truths

| # | Truth | Status | Evidence |
| --- | ----- | ------ | -------- |
| 1 | Smoothed daily series has NO session-lump spikes | ✓ VERIFIED | `test_acceptance_B_no_session_lumps` (test_smoothed_mtm_core.py:744) — asserts EACH day against the hand-computed cash+mark-delta oracle (`{15: 0.25, 16: 0.25, 17: −0.5, 18: −0.125}`, abs=1e-12), ≥3 nonzero held days, AND the contrast pin that cash_settlement lumps on exactly {trade, delivery} days. Economic oracle, not self-referential. Ran green. |
| 2 | Smoothed total == cash total on a flat terminal book | ✓ VERIFIED | `test_acceptance_A_redistribution_preserves_total` (:726) — `total_s == total_c == -0.125` exact + `struct.pack("<d", …)` bit-equality, through the REAL `build_deribit_native_ledger` seam. Pure-layer sibling `test_option_mtm_telescopes_to_flat_terminal_zero` (test_deribit_txn.py:2975) pins ΔMTM sums to 0 exactly. Ran green. |
| 3 | Non-flat terminal telescopes to Σchange + Book(last settlement) | ✓ VERIFIED | `test_acceptance_C_non_flat_terminal_telescopes` (:769) — total == −0.10 + 0.12 (abs=1e-12) with book-channel guard green on `options_value − options_session_upl == terminal_book`; pure-layer `test_option_mtm_telescopes_to_open_terminal_book` (:2997). Ran green. |
| 4 | Perp-only / USD-native byte-identical under smoothed_mtm with ZERO option-mark fetches (SC-4) | ✓ VERIFIED | `test_perp_only_smoothed_zero_fetches_byte_identical` (:380 — `stub.chart_calls == []` + `check_exact=True`); NEW parametrized `test_usd_native_smoothed_bit_exact_to_cash` over the WHOLE `test_native_nav_sc4_identity` fixture matrix (stub has NO chart endpoint — an AttributeError would fire on any wrongful probe). Options fixtures under cash/mtm: `test_cash_settlement_options_zero_marks_fetches` (+ cash golden), `test_mark_to_market_options_zero_marks_fetches`. All ran green. |
| 5 | Existing bases byte-untouched (SC-4 diff discipline) | ✓ VERIFIED | `git diff 27ec4eef HEAD` audited: only removed production lines are import expansion (`datetime` → +`date, timedelta`), enum-set expansion, comment expansion, and the `native_daily`→`series_daily` identity alias (for non-smoothed `series_daily is native_daily`). The smoothed arm is doubly gated: `pnl_basis == PNL_BASIS_SMOOTHED_MTM AND deribit_raw_rows_have_option_activity` (deribit_ingest.py:2044). No pre-existing test body modified (test_native_nav_sc4_identity.py diff = defaulted helper kwarg + new test only). All 4168 pre-existing+new tests green. |
| 6 | Sparse marks inside a listed life FAIL LOUD (no interpolation, no session-lump fallback) | ✓ VERIFIED | `test_acceptance_D_sparse_mark_hole_fails_loud_naming_instrument_day` (:793 — LedgerValuationError at LEDGER BUILD naming instrument + earliest missing day); pure-layer `test_option_mtm_hole_inside_life_fails_loud` (:3075) + mutation-honesty `test_option_mtm_hole_guard_is_load_bearing_mutation` (:3101 — same fixture green dense, reddens with one bar dropped); `test_in_retention_empty_marks_fails_loud`; `test_retention_straddler_partial_marks_not_bucketed_fails_loud` (D-07 consequence pinned in docstring at test_deribit_txn.py:3129); pre-retention correctly bucketed to cash-basis + `pre_mark_retention_option_days` warning (`test_pre_retention_instrument_bucketed_stays_cash_basis`). All ran green. |
| 7 | `smoothed_mtm` in BOTH enums; `parse_returns_denominator_config` accepts it | ✓ VERIFIED | Code: deribit_txn.py:864-866 (`PNL_BASIS_SMOOTHED_MTM` in `_PNL_BASES`), allocated_capital.py:56-57 (`_VALID_PNL_BASES`), `DEFAULT_PNL_BASIS` unchanged. Tests: `test_smoothed_mtm_member_of_both_basis_enums` (:46) + `test_allocated_capital_config_accepts_smoothed_and_rejects_unknown` (:70 — accepts `smoothed_mtm`, rejects `realized_only` via `ReturnsDenominatorConfigError`). Ran green. |
| 8 | ΔMTM merge INVOKED at the adapter call site — wiring guard reddens when neutered | ✓ VERIFIED | `test_smoothed_merge_wiring_guard` (:314) monkeypatches `di.option_mtm_daily → ({}, {})` and asserts the series COLLAPSES to the cash-only shape (`{15: −0.05, 17: 0.03}`) — a DIFFERENT expectation from the merged test (`{15: 0.0, 16: 0.01, 17: −0.03}`, `test_smoothed_adapter_merges_delta_mtm`). If the call site did not route through the patched module reference, the guard would fail. Meaningful, not decorative. Ran green. |
| 9 | `deribit_txn.py` pandas/async-free | ✓ VERIFIED | AST purity guard green (forbids pandas import); direct grep: 0 `async def`, imports stdlib + `services.external_flows` only; ΔMTM merge lives in the async adapter (`deribit_ingest._build_smoothed_option_mtm`), preserving the split. |

**Score:** 9/9 truths verified

## Required Artifacts

| Artifact | Expected | Status | Details |
| -------- | -------- | ------ | ------- |
| `analytics-service/services/deribit_txn.py` | PNL_BASIS_SMOOTHED_MTM, use_smoothed branch, smoothed identity channels | ✓ VERIFIED | :864 enum, :2137 `use_smoothed`, :1704 smoothed-gated identity channels (`_assert_smoothed_book_channel`, `_assert_smoothed_summary_cross_check`); wired via txn tests + adapter |
| `analytics-service/services/deribit_ingest.py` | fetch_deribit_option_daily_marks, _build_smoothed_option_mtm, pre_mark_retention_option_days, native_options_session_upl | ✓ VERIFIED | :694 fetcher, :1928 `_build_smoothed_option_mtm`, :880 CompletenessReport field (defaulted), state field absent→0.0 pinned (`test_state_reads_options_session_upl_off_summaries`) |
| `analytics-service/services/allocated_capital.py` | smoothed_mtm in _VALID_PNL_BASES | ✓ VERIFIED | :56-57; validation sites :160/:232 consult the frozenset |
| `analytics-service/tests/test_smoothed_mtm_core.py` | Acceptance A–D, SC-4 pins, enum sync, wiring guard | ✓ VERIFIED | 812 lines, 30 tests, real-adapter seam, mutation-honesty siblings, leak-discipline assertions |
| `analytics-service/docs/evidence/drb-option-daily-marks-2026-07.json` | Encoded feasibility probe | ✓ VERIFIED | Valid JSON; M7_live_probe_2026_07_22 section added additively (+28 lines) |

## Key Link Verification

| From | To | Via | Status |
| ---- | --- | --- | ------ |
| allocated_capital.py | deribit_txn.py | both enums carry smoothed_mtm | ✓ WIRED (enum-sync pin) |
| build_deribit_native_ledger | option_mtm_daily | smoothed-gated ΔMTM merge into series_daily | ✓ WIRED (wiring guard reddens when neutered) |
| test_deribit_ingest.py | fetch_deribit_option_daily_marks | stubbed-exchange tests | ✓ WIRED (7 tests, in phase-suite run) |
| test_deribit_txn.py | replay_option_positions / option_mtm_daily | 14 failing-first pure-core tests incl. hole + straddle guards | ✓ WIRED |

## Requirements Coverage

| Requirement | Status | Evidence |
| ----------- | ------ | -------- |
| SMTM-01 (core portion: third basis additive, both enums, SC-4 byte-identity) | ✓ SATISFIED (core) | Truths 4, 5, 7 — frontend/worker portions correctly deferred to 132/133 per REQUIREMENTS.md mapping |
| SMTM-02 (pure smoothed core: fetcher, replay, ΔMTM, merge, total-preservation, fail-loud, purity) | ✓ SATISFIED | Truths 1, 2, 3, 6, 8, 9 |
| SMTM-03 / SMTM-04 | N/A this phase | Mapped to Phases 132/133 (deferred, see frontmatter) |

## Anti-Patterns Found

| File | Pattern | Severity | Impact |
| ---- | ------- | -------- | ------ |
| — | No TBD/FIXME/XXX/TODO/placeholder markers in any phase-modified file | — | none |
| tests/test_equity_reconstruction.py | 3 failing tests (OKX FakeExchange drift) | ℹ️ Info | Pre-existing on the base commit's code paths (file + OKX exchange path untouched by phase diff); documented in both SUMMARYs; not a phase gap but should be triaged separately |
| tests/test_deribit_txn.py:959 (purity guard) | Guard enforces pandas/ccxt/exchange/supabase import-freedom but NOT async-freedom | ℹ️ Info | Async-freedom is factually true today (0 `async def`, verified by grep) but only pandas-purity is regression-pinned. Cheap hardening opportunity, not a gap. |
| 131-01b plan Task 6 item (iv) | mtm-side options-fixture golden not asserted in the new file (`test_mark_to_market_options_zero_marks_fetches` pins zero fetches only) | ℹ️ Info | Byte-identity of the mtm path is still covered: all pre-existing mtm tests pass UNMODIFIED and the merge is basis-gated with a zero-fetch pin. Contract intact via the existing suites. |

## Human Verification Required

None. This phase is a pure analytics core with no UI/visual surface; every success criterion is
programmatically pinned and was re-executed by this verifier. The live-book acceptance
(Phoenix key re-onboard) is a plan-documented deferral to post-131-03, listed under `deferred`.

## Gaps Summary

No gaps. The phase goal is achieved in code, not just claimed: all four acceptance behaviors
(A total-preservation bit-exact, B no-lump with hand-derived economic oracle, C non-flat
telescoping, D sparse-mark fail-loud naming instrument+day) exist, assert real economics, and
ran green in this verification session. SC-4 is proven three ways (parametrized bit-exact
matrix, zero-fetch stubs with no chart endpoint, diff audit showing only gated/identity-alias
hunks). The wiring guard is genuinely load-bearing. mypy --strict and the AST purity guard are
green as run by the verifier.

---

_Verified: 2026-07-22_
_Verifier: Claude (gsd-verifier)_
