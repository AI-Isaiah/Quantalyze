---
phase: 128-deribitfix-deribit-correction-classification-evidence-based
plan: 01
subsystem: analytics
tags: [deribit, transaction-log, native-ledger, classification, money-math, python]

# Dependency graph
requires:
  - phase: v1.10-backbone-unification
    provides: deribit_txn.py allow-list classifier + assert_balance_identity reconcile guard
provides:
  - "deribit `correction` txn-log type classified PER ROW on info.reason (funding→cash-bearing, else fail-loud)"
  - "A funding-correction-bearing deribit account ingests without raising LedgerValuationError"
  - "A capital/unrecognized/missing-reason correction FAILS LOUD — never miscounted as trading performance"
  - "Revert-proof regression guards (USD + native hand-derived money oracle, capital-reason + unrecognized-reason fail-loud, unknown-type still-fails-loud)"
affects: [deribit-native-ledger, go-live-gates, key3-dogfood]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Per-row evidence-faithful classification: a `correction` is gated on info.reason via a broad trading keyword allow-list, NOT blanket type membership"
    - "Hand-derived money oracle: expected realized is a by-hand sum of ledger rows, never the impl's own txn_change_to_usd asserted back"
    - "Single classification gate honored by BOTH USD and native paths (+ index planner, reconcile reference, ingest count) so they never diverge"

key-files:
  created: []
  modified:
    - analytics-service/services/deribit_txn.py
    - analytics-service/services/deribit_ingest.py
    - analytics-service/tests/test_deribit_txn.py

key-decisions:
  - "EVIDENCE-FAITHFUL PER ROW (founder): classify each `correction` on its info.reason, not by blanket type→CASH_BEARING — a blanket rule assumes every correction is trading performance, a guess that would silently corrupt returns if a future CAPITAL correction (deposit/withdrawal/transfer fix) were summed as PnL"
  - "A trading/PnL reason → CASH_BEARING (summed like settlement/funding); the observed key3 row matches on 'funding'. Broad substring allow-list so wording variation doesn't brittle-break; NOT a full reason taxonomy (KISS)"
  - "Capital-flavored / unrecognized / missing reason carrying real cash → FAIL LOUD naming the reason; a zero-change correction is harmlessly ignored (no cash at risk)"
  - "`correction` is NOT a static CASH_BEARING_TYPES member (a bare set can't see info.reason); the SAME per-row gate is wired at the USD aggregator, native aggregator, index planner, reconcile reference, and ingest return-row count so the paths never diverge"

patterns-established:
  - "RED-proof stated exactly: (a) neutering correction_is_trading→False reddens the funding cash-bearing tests; (b) neutering→True (blanket) reddens the capital/unrecognized fail-loud tests"

requirements-completed: [DERIBITFIX-01, DERIBITFIX-02]

# Metrics
duration: 45min
completed: 2026-07-19
---

# Phase 128: DERIBITFIX — deribit `correction` classification (evidence-based) Summary

**Gated the deribit `correction` txn-log type PER ROW on its `info.reason` — a funding-calculation correction (the actual key3 evidence) is realized cash summed like settlement/funding, while any capital-flavored / unrecognized / missing-reason correction fails loud — unblocking ingest without ever risking a capital adjustment being miscounted as trading performance.**

## Performance

- **Duration:** ~45 min (incl. founder-directed refinement from the blanket approach)
- **Tasks:** 2 (classification gate + regression guards)
- **Files modified:** 3

## Design (founder decision — evidence-faithful per row)

A blanket `type → CASH_BEARING` rule assumes EVERY correction is trading performance — a guess for correction kinds we have not observed. Our evidence is specifically a FUNDING correction. A hypothetical future CAPITAL correction (a deposit/withdrawal/transfer fix) summed into realized PnL would silently corrupt returns. So:

- `correction` is **removed from the blanket `CASH_BEARING_TYPES` frozenset** (a bare set-membership cannot see `info.reason`).
- `correction_is_trading(row)` matches the lowered `info.reason` with **capital-denylist precedence** (WR-01): a CAPITAL keyword (`deposit, withdrawal, transfer, wallet, capital`) matched FIRST → NOT trading (fail loud), even if the reason also contains a trading substring. Only if no capital keyword matches does the BROAD trading/PnL allow-list (`funding, settlement, session, pnl, p&l, delivery, trade, fee, interest, liquidation, premium, expiry`) apply — the observed key3 row matches on **funding**. All matching is **word-boundary** anchored (`\b`); the `mark` token was dropped (collides with market/benchmark). Deliberately not a full taxonomy (KISS).
- A trading-reason correction is summed into realized PnL exactly like settlement/funding, on BOTH the USD (`txn_rows_to_daily_records`) and native (`txn_rows_to_native_daily`) paths via `_row_is_cash_bearing` / `_row_is_native_cash_bearing`. The **same gate** is honored by the index planner (`inverse_days_needing_index`), the reconcile guard (`assert_balance_identity` reference set), and the ingest return-row count — so the two paths never diverge.
- Any other correction carrying real cash → `assert_correction_classifiable` **FAILS LOUD naming the reason** ("correction with unrecognized or possibly-capital reason ... do NOT silently count a capital adjustment as trading performance"). A zero-change correction is harmlessly ignored (module's zero-change convention).
- Disjointness asserts intact (correction is not a set member); native-sibling derivation unchanged.

## Evidence (recorded at the code)

Read-only Railway recrawl 2026-07-19, DERIBIT_CLIENT_ID_3 — the single live key3 `correction` row (the one the dogfood `LedgerValuationError` fired on):
`type=correction, change=-3.2469e-4 BTC, currency=BTC, instrument_name=null, id=952844476, 2026-07-15, side="-", info.reason="2026-07-15 BTC-PERPETUAL funding calculation correction"`.
The `info.reason` proves it adjusts BTC-PERPETUAL FUNDING; perp funding is already cash-bearing via `settlement` ("session PnL + perpetual funding"), so a funding-calc correction is an adjustment to realized trading cash.

## Money Oracle (hand-derived, per founder rule — NOT the impl's own formula)

Small ledger: a funding `settlement` (+0.01 BTC @ index 50000) + the key3 FUNDING `correction` (-3.2469e-4 BTC), same UTC day.

- **USD path:** `+0.01*50000 = +500.0` funding, `-3.2469e-4*50000 = -16.2345` correction (valued at the same-day settlement fallback index — the correction row carries no own index_price), **day realized = 500.0 - 16.2345 = 483.7655 USD** (hand-summed literal in the test).
- **Native path:** raw BTC sum `0.01 + (-3.2469e-4) = 0.00967531 BTC`; `assert_balance_identity` then closes (the trading correction sits on both sides of Σ), proving the whole native valuation — the layer the dogfood error raised on — ingests cleanly.

## WR-01 fix (code review — capital-denylist precedence + word boundary)

Review found a real money-safety gap: the original substring allow-list had no capital-denylist precedence, so a CAPITAL correction whose reason merely CONTAINS a trading substring was silently summed into realized PnL — the exact capital-as-performance corruption this phase prevents. Concrete failures: `"transfer to funding account correction"` (matched `funding`), `"withdrawal fee correction"` (matched `fee`), `"market data correction"` (matched the loose `mark` token). Fixed (commit `d410d3b7`): capital denylist checked FIRST with precedence, word-boundary (`\b`) matching on both lists, and the `mark` token dropped. New IN-01 regression `test_correction_reason_gate_denylist_precedence_and_word_boundary` + trading-substring-colliding reasons added to the parametrized capital test so it can't pass trivially.

## RED-proof (verified by executing each neuter)

- Neuter `correction_is_trading → False` (nothing recognized as trading): the two funding cash-bearing tests **fail** — the funding correction now raises `LedgerValuationError`.
- Neuter `correction_is_trading → True` (simulating the prior blanket classification): the capital-reason and unrecognized/missing-reason tests **fail** — proving they catch the exact silent-sum the founder guarded against.
- Neuter to **substring / no-denylist / `mark` re-added** (the pre-WR-01 behavior): all **6** WR-01 collision cases **fail** — proving the denylist precedence + word boundary are load-bearing.
- Source restored after each; full suite green.

**Exact reverts that redden each test:** remove a keyword (or the whole reason branch) so a funding correction is non-trading → the cash-bearing tests raise; make the gate blanket (always trading) → the capital/unrecognized fail-loud tests stop raising; drop the capital-denylist precedence / `\b` anchors / re-add `mark` → the WR-01 collision cases silently sum.

## Task Commits

1. **DERIBITFIX-01 + 02: gate correction on info.reason** — `001b00de` (fix). Source (deribit_txn.py + deribit_ingest.py) + tests landed together to keep the suite green. Amends/supersedes the earlier blanket-classification commit `8c884cc6`.
2. **WR-01: capital-denylist precedence + word-boundary in the reason gate** — `d410d3b7` (fix). Code-review money-safety fix on top of (1).

## Files Modified
- `analytics-service/services/deribit_txn.py` - Removed `correction` from `CASH_BEARING_TYPES`; added `_CORRECTION_CAPITAL_REASON_KEYWORDS` (denylist), `_CORRECTION_TRADING_REASON_KEYWORDS` (allow-list, `mark` dropped), `_reason_matches_any` (word-boundary), `correction_is_trading` (capital-denylist precedence), `assert_correction_classifiable`, `_row_is_cash_bearing`, `_row_is_native_cash_bearing` with the key3 evidence + determination documented at the code; wired the per-row gate into `txn_rows_to_daily_records`, `txn_rows_to_native_daily`, `inverse_days_needing_index`, and `assert_balance_identity`; updated the stale module doc blocks.
- `analytics-service/services/deribit_ingest.py` - Return-row count (`total_return_rows`, C2 activity floor) now counts trading-reason corrections via `correction_is_trading` so the DQ heuristic stays consistent with the valuation paths.
- `analytics-service/tests/test_deribit_txn.py` - Reverted the set-pin (correction not a static member); updated `test_ambiguous_types_fail_loud` note and the native unknown-type exemplar (`quorble`); added funding-correction hand-derived USD + native money oracles, `test_correction_capital_reason_fails_loud` (parametrized ×4), `test_correction_unrecognized_or_missing_reason_fails_loud`, and `test_correction_did_not_broaden_allow_list_unknown_type_still_fails_loud`.

## Verification
- `analytics-service/.venv/bin/python -m pytest tests/test_deribit_txn.py tests/test_native_nav_sc4_identity.py` → **180 passed** (post-WR-01).
- Broader deribit regression (`test_deribit_ingest.py`, `test_deribit_acceptance.py`, `test_deribit_ground_truth.py`, `test_job_worker_deribit.py`) → green (**365 passed** combined with the two above; pre-existing okx/numpy warnings only, unrelated).
- `mypy --strict --follow-imports=silent services/deribit_txn.py services/deribit_ingest.py` → clean (matches the CI analytics gate; there is no ruff step for analytics in CI).

## Deviations from Plan
Beyond the two tasks: updated the existing set-pin / ambiguous / native-unknown-type tests + two stale module doc comments that pinned the pre-128 blanket-unclassified state, and extended the `deribit_ingest.py` return-row count to honor the new gate (consistency, Rule 1/3). Documented here rather than as separate tasks.

## Known Stubs
None.

## Threat Flags
None — internal analytics classification change (deribit native-ledger valuation); no new network endpoints, auth paths, file access, or trust-boundary schema surface. Note: this fix is a NET TIGHTENING of a fail-loud money guard (a capital-flavored correction now fails loud instead of being silently summed).

## Self-Check: PASSED
- `128-SUMMARY.md` exists at the phase dir.
- Commits `001b00de` (per-row gate) + `d410d3b7` (WR-01) present in git history.
- `test_deribit_txn.py` + `test_native_nav_sc4_identity.py` → 180 passed; broader deribit regression → 365 passed; `mypy --strict` clean.
