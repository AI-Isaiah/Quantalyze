---
phase: 231-bybitreads-a-bybit-read-covers-every-coin-settle-type-window
verified: 2026-11-24T00:00:00Z
status: passed
score: 5/5 success criteria verified (SC-4 settled by the founder 2026-11-25; the three human items resolved below)
verified_at_sha: 29e5448e951f8938e8d43f2c4acf09351f639672
drift_subjects:
  - analytics-service/services/exchange.py
  - analytics-service/services/positions.py
  - analytics-service/services/price_rule.py
  - analytics-service/services/equity_reconstruction.py
  - analytics-service/scripts/bybitreads_probe.py
  - analytics-service/tests/test_upnl_venues.py
  - analytics-service/tests/test_exchange.py
  - analytics-service/tests/test_nav_marks_l4_read.py
  - analytics-service/tests/test_nav_marks_bybit_uta.py
  - analytics-service/tests/test_positions.py
  - analytics-service/tests/test_bybitreads_census_pins.py
  - analytics-service/tests/test_derive_broker_dailies_dualmode.py
  - analytics-service/tests/test_bybitreads_probe.py
  - .planning/phases/231-bybitreads-a-bybit-read-covers-every-coin-settle-type-window/231-CENSUS.md
behavior_unverified: 0
overrides_applied: 0
gaps: []
human_verification_resolved: "2026-11-25: all three items below are resolved (founder answers relayed by the coordinator, and a read-only PROD check after deploy). See the Human Verification Resolution section."
human_verification:
  - test: "VREAD-05: confirm or correct the recorded allow-list date (2026-10-24)"
    expected: "The founder states the real date, or confirms 2026-10-24 as an acceptable upper bound. Then 231-05-SUMMARY.md and the ROADMAP line carry the founder's date."
    why_human: "The founder gave only the choice (\"Allow-listed worker IP\"), not a date. 2026-10-24 was inferred by an agent from the derive record. SC-4 says 'recorded with its date', and an agent cannot supply the founder's date."
  - test: "Prohibition (plan 06, judgment tier, unresolved in the plan): the VREAD-01 change moves neither api_keys.account_balance_usdt nor strategy initial capital, and adds no non-stable coin to the Bybit anchor"
    expected: "Reviewer confirms the verdict below. Verifier's non-authoritative judgment: HOLDS. fetch_usdt_balance and fetch_usdt_balance_with_status are not in the diff, and the pin test shows a USDT+USDC balance still reads the USDT figure. A non-stable coin is never parsed."
    why_human: "unverified-prohibition, human review recommended. A judgment-tier prohibition is flagged for a human by repo rule and is never a silent pass."
  - test: "After the PR ships and the next derive for the one live Bybit key runs, confirm key_inputs.anchor_usd is written and the derive did not report a balance error"
    expected: "A stored anchor equal to the sum of the key's stable-coin wallet balances, and daily marks written rather than refused as wallet_basis_mismatch."
    why_human: "Round-2 fix R2-M1 makes any None stable quantity an unreadable read. ccxt 4.5.89 turns a coin with a blank or absent walletBalance into total[coin]=None (reproduced by the verifier), so the fixture shapes are green. Whether the live account's real reply ever carries such a coin is unmeasured. If it does, the anchor fails closed (unreadable) instead of being understated. Needs a PROD read after deploy."
---

> **verified_at_sha rebound 2026-11-25 (records PR).** The verdict was issued on phase-branch commit `036937ef7`, which is not reachable from `main` after the squash merge. It is rebound to the merge commit `29e5448e9` (#1333) so that `scripts/verification-drift-report.mjs` can diff from a reachable commit. None of the files listed in `drift_subjects` differs between the two commits (`git diff --name-only 036937ef7 29e5448e9 -- <drift_subjects>` is empty), so the rebind changes nothing about what was verified.

# Phase 231: BYBITREADS Verification Report

**Phase Goal:** Every Bybit read covers every coin, settle type, window and deposit exactly once, or refuses by name, and the owner's static egress IP is allow-listed by the founder (VREAD-05).
**Verified:** 2026-11-24 at HEAD 036937ef7 (branch gsd/phase-231-bybitreads)
**Status:** human_needed
**Re-verification:** No, initial verification

## Goal Achievement

### Observable Truths (ROADMAP success criteria)

| # | Truth | Status | Evidence |
|---|---|---|---|
| 1 | Census of every Bybit read path by coin, settle type, window and flow source is recorded, and every row is fixed or decided with a test built from a real payload shape | VERIFIED | `231-CENSUS.md` has 28 rows (C01 to C25, C27 to C29; C26 is explicitly "not a Bybit row"). Every row ends in a disposition. All 37 distinct pin node ids (backticked and `NEW(plan 0N)`) resolve and pass (39 passed incl. parametrization). Probe-evidence rows (C14, C18, C19, C23, C27) carry counts from `231-PROBE-RESULT.md`. |
| 2 | Derive anchor and current-equity read sum the same stable coins through one shared constant; holdings poll returns USDC-settled and inverse positions with uPnL (VREAD-01, VREAD-02) | VERIFIED | VREAD-01: `fetch_bybit_stable_wallet_with_status` (exchange.py) calls `price_rule.is_stable_value(str(coin))` per coin at call time, the predicate `_price_wallet_totals` uses at equity_reconstruction.py:669. `fetch_account_equity_usd` and `fetch_account_equity_and_upnl_usd` both route `venue == "bybit"` to it. The flipped pin (old name kept only in the docstring, not deleted) shows 1200.0 = 1000 + 200, wedge 0.0, reconstruct 1450.5. `test_shared_stable_set_drives_the_anchor_and_the_mark` monkeypatches `price_rule._STABLE_VALUE` and moves both. VREAD-02: `_BYBIT_POSITION_READS` = linear USDT, linear USDC, inverse. Inverse is converted to USD at the row mark, a failed category read propagates, and a full page routes to the cursor read. |
| 3 | A strategy trade sync starting more than seven days back returns every execution in its window, or refuses by name; an on-chain deposit is counted exactly once, replace or union decided on probe evidence or recorded undecided (VREAD-03, VREAD-04) | VERIFIED at the reader, with warnings | VREAD-03: `_fetch_raw_trades_bybit` walks 7-day windows via `walk_paginated` with both `startTime` and `endTime`, and pages each window by cursor. It raises `BybitTradeWindowIncomplete` for `page_cap`, `cursor_stuck`, `malformed_reply`, `unreadable_fill` and `start_too_old`. Execution dedupe by execId. VREAD-04: probe verdict `undecided` (0 on-chain rows), so `replace` stays. The SC allows "recorded as undecided". `test_unified_rows_replace_the_on_chain_reads_and_count_once` pins exactly-once. See Warnings W1 to W3. |
| 4 | Founder has allow-listed the owner's static egress IP, recorded with its date, and the key's daily derive no longer errors for that reason (VREAD-05) | UNCERTAIN | Founder answer "Allow-listed worker IP" is recorded (231-05-SUMMARY, ROADMAP). Recorded derive reading: 31 of 31 done since 2026-10-24, 0 IP errors. The verifier did not re-read PROD, so this figure is the SUMMARY's. The date is an agent-inferred upper bound, not the founder's. Human item 1. |
| 5 | PROOF-01: each gate goes RED on pre-fix code or a neutered copy with its named arm first, restored from byte backup and GREEN, recorded verbatim; mocks mirror real payload shapes | VERIFIED | SUMMARYs 03, 04, 05 and 06 each carry neuter, RED, `cp` restore, `cmp`, GREEN records. The verifier re-ran three independent neuters from a byte backup (restored, `cmp` clean, `git status` clean): (a) anchor membership `is_stable_value` to `== "USDT"` gave 10 failures, naming the flipped pin and the shared-constant test first. (b) dropping `endTime` from the window request and (c) dropping the inverse position read gave 16 failures across `TestBybitExecutionWindowWalk` and `TestBybitPositionCategories`. Plan 06 balances go through ccxt 4.5.89's real `parse_balance`, not hand-built `total` dicts. |

**Score:** 4/5 verified; SC-4 uncertain. No FAILED truth, so no gaps.

### Plan 06 must-have truths (VREAD-01)

| Truth | Status | Evidence |
|---|---|---|
| Both entry points route Bybit to the one helper | VERIFIED | Diff `340dcf45a..HEAD`: both `if venue == "bybit"` arms call the helper. `test_bybit_two_tuple_and_four_tuple_anchor_agree` passes. Binance and OKX are untouched. |
| `fetch_usdt_balance` stays USDT-only on a mixed balance (OQ1 Option A) | VERIFIED | Neither function appears in the diff. `test_fetch_usdt_balance_stays_usdt_on_a_mixed_stable_bybit_balance` passes. |
| Non-stable collateral stays out and a garbled BTC quantity cannot fail the read | VERIFIED | `is_stable_value` filters before any parse. `test_non_stable_collateral_stays_out_of_the_bybit_anchor` passes. |
| Order independence | VERIFIED | `math.fsum`. The coin-order test passes, and the SUMMARY records a neuter that made it fail. |
| Negative stable balance "skipped, never subtracted" (plan line 36) | SUPERSEDED, judged acceptable | Round-1 MD-01 changed it to a signed sum, so a spot borrow lowers the anchor, matching Bybit's `totalWalletBalance` and the mark. Skipping let a borrowed stable coin inflate the anchor past the old null. Code and tests agree (`negative-stable-subtracted` arm, `test_bybit_borrowed_stable_coin_is_subtracted_through_the_real_parse`). The plan frontmatter and the 06 SUMMARY "What changed" text still say "skipped". |
| Empty and unreadable edges, with a scrubbed, class-only log | VERIFIED | The 12-arm `test_bybit_stable_wallet_arms` passes. A signed sum of 0 or below, an empty `total` and no stable coin all return `(None, False)`. Failed fetch, malformed, non-finite and any None stable quantity return `(None, True)`. |

### Known deviations, judged

1. **Gate regex did not print GATE_229_OK (no `chore(release):` prefix on Phase 229's subject).** Accepted. Substance holds. Phase 229 landed as `v0.133.69.0 — Phase 229 MT5DERIVE2 ... (#1328)` (2761b04be), and `git merge-base --is-ancestor 2761b04be HEAD` succeeds (verified). The plan's regex assumption was wrong, not the gate.
2. **Negative stable balance: signed sum, not skipped.** Accepted. See the table above. The review trail (REVIEW-W4 MD-01, fixed in d802f9c0d) justifies it.
3. **R2-M1: any None stable quantity is an unreadable read.** Accepted as fail-closed, with a residual live-shape risk, human item 3.
4. **VREAD-05 date is an inferred upper bound (2026-10-24).** Not accepted as a final record. It becomes human item 1, and SC-4 stays UNCERTAIN rather than FAILED because the founder's choice and the derive evidence are both on record.
5. **VREAD-04 recorded as undecided.** Accepted. The SC explicitly allows it, 0 on-chain rows cannot separate replace from union, and the code is untouched. It is pinned and was neutered RED in plan 05.

### Behavioral spot-checks (verifier-run, Python 3.x, ccxt 4.5.89 from `analytics-service/.venv`)

| Check | Result |
|---|---|
| `test_upnl_venues.py`, `test_exchange.py`, `test_nav_marks_l4_read.py`, `test_nav_marks_bybit_uta.py` | 371 passed |
| `test_positions.py`, `test_bybitreads_census_pins.py`, `test_bybitreads_probe.py`, `test_derive_broker_dailies_dualmode.py`, `test_bybit_unified_flows.py` | 409 passed |
| All 37 census pin node ids | 39 passed |
| CI mypy strict command | `Success: no issues found in 143 source files` |
| Neuters (3, independent) | Each RED, restored, `cmp` clean |
| ccxt 4.5.89 `parse_balance` with a blank or absent `walletBalance` | `total[coin] = None` (basis of human item 3) |

The full 15875-test suite was not re-run. The SUMMARY's claim of 15875 passed is unverified here, and every file the phase touched was run.

### Anti-patterns

No TBD, FIXME or XXX markers were introduced in the phase's source diff. No stubs: the helper and the readers are substantive, wired through the derive, composite and positions callers, and exercised end to end through the tests.

## Warnings (recorded, not gaps)

- **W1. A refusal does not hold the strategy-sync cursor (census C15a, review SF-6 / R2-3).** In `run_sync_trades_job`, when `fetch_raw_trades` raises, `raw_fills` is empty, so `advance_fetched_cursor` is True. The refused span is skipped on the next run, and the drained `sync_truncated_*` flags are discarded. The reader refuses by name; the caller does not turn that into a retry. It is routed to Phase 232 (VREAD-08) and 222 under ruling OQ5, with raw trade ingestion off by default (`USE_RAW_TRADE_INGESTION=false`) until then. SC-3's wording is met by the reader. Anyone enabling raw trade ingestion before the 232 fix gets a silent skip.
- **W2. First no-start strategy sync may exceed the 900 s `sync_trades` budget (`oq2-timing`).** The probe's sweep read 34 of 53 windows in 600 s on the one busy key. The walk completes or refuses, but a handler timeout is neither. Routed, not fixed.
- **W3. Onboarding and resync (`long_fetch`, `BybitAdapter.fetch_raw`) keep a 7-day reach (census C29).** This was a decision after review CR-01 (the 365-day default reached the 60 s anonymous teaser). VREAD-03 is not met on that path, which only reads a start-less window. Pinned and recorded.
- **W4. Routed, unmeasured:** C27 (first funding walk takes 379 s against a 180 s budget, so `funding_fees` is empty) and C28 (option positions are not read). Owners are "named by the orchestrator in the phase report"; that report is not written yet, so the ship PR must name them.
- **W5. Stale prose, not behavior:** `test_nav_marks_bybit_uta.py:186-188` still says the Bybit derive wallet is USDT-only (REVIEW-W4 LW-01). The plan 06 frontmatter and SUMMARY text say negatives are skipped.
- **W6. Bookkeeping at ship:** ROADMAP shows plan 06 `[ ]` and `5/6 plans executed`. REQUIREMENTS shows VREAD-01 `Pending`. The `167.2.1.1-DERIVE-USDT-ONLY-ANCHOR` TODOS entry, and the CHANGELOG entry, belong to the ship PR (repo rules).

## Requirements Coverage

| Requirement | Status | Evidence |
|---|---|---|
| VREAD-01 | SATISFIED | SC-2 above. Plan 06 and its three review rounds, W4 clean (0 open MEDIUM+). |
| VREAD-02 | SATISFIED | SC-2 above. Shipped in #1321. |
| VREAD-03 | SATISFIED at the reader | SC-3 above, with W1 to W3. |
| VREAD-04 | SATISFIED as "recorded undecided" | SC-3 above and C23. |
| VREAD-05 | Recorded, date inferred | SC-4 above, human item 1. |
| PROOF-01 | SATISFIED for this phase | SC-5 above. |

No orphaned requirement: VREAD-01 to VREAD-05 all appear in plans.

## Human Verification Required

See the `human_verification` list in the frontmatter (three items):

1. VREAD-05: founder confirms or corrects the allow-list date.
2. Plan 06 judgment-tier prohibition: flagged, verifier judgment is that it holds.
3. Post-deploy: confirm the live Bybit key's derive stores `key_inputs.anchor_usd` and does not hit the R2-M1 unreadable branch.

## Gaps Summary

No gaps: no truth failed, and no artifact is missing, a stub or unwired. The status is `human_needed` because of the three items above, the first being the one that bears on a success criterion (SC-4).

---

_Verified: 2026-11-24_
_Verifier: Claude (gsd-verifier)_

## Human Verification Resolution (2026-11-25)

The three `human_needed` items are settled, so the status moves from `human_needed` to `passed`:

1. **VREAD-05 date (SC-4).** Founder answer, relayed by the coordinator on 2026-11-25: use 2026-10-24, recorded as a PROD-measured upper bound (the derive failed with an IP error on 2026-10-07 and 2026-10-08, and every derive since 2026-10-24 is done). SC-4 is VERIFIED.
2. **Plan 06 prohibition (judgment tier).** Accepted as satisfied by the coordinator on 2026-11-25: `fetch_usdt_balance` and `fetch_usdt_balance_with_status` are byte-identical to the plan's base, the OQ1 pin passes, and a non-stable coin is never parsed. The security audit reached the same reading (T-231-14).
3. **Live anchor after deploy.** v0.133.73.0 (#1333, merge 29e5448e9) deployed on Railway with status SUCCESS on 2026-11-24 at about 21:28Z. A read-only PROD read over the Supabase MCP on 2026-11-25 (marker query first, answered PRODUCTION; counts only):
   - Bybit `derive_broker_dailies` jobs created after the deploy: 1, status `done`.
   - Bybit `key_inputs` rows written after the deploy: 1. It stores a positive `anchor_usd`, with no `anchor_null_reason` and no `nav_mark_refusal`.
   - Across all 3 Bybit `key_inputs` rows on active keys, the anchor is stored in all 3, and none carries an `anchor_null_reason` or a `nav_mark_refusal`.
   So the live key did not take the R2-M1 unreadable branch, and its anchor is written.
