---
status: diagnosed
trigger: "167.1.2.2-05 PROD re-rehearsal 2026-10-08: one derive_allocator_equity compose failed_final with 'non-positive reconstructed equity on 755 of 1200 day(s) — a flow dominates prior capital (refusing to fabricate a floor)'. Allocator: 2 Deribit + 2 MT5 keys, every key derive done. Plan 02 (pre PR #984) refused the same book with 'self-check diverged at day-index 1024 of 1199'."
created: 2026-10-09
updated: 2026-10-09
mode: find_root_cause_only (no code changed, no PROD write)
---

## Current Focus

bug_class: Bohrbug (deterministic; reproduced exactly from the stored PROD rows, 1/1 runs, same text and same 755 of 1200)
hypothesis: CONFIRMED (mechanism) / INFERRED (the exact venue field). The Deribit writer's realized-basis NAV for account B carries a constant phantom BTC balance (a native-unit offset in its BTC bucket). It is invisible while the account holds capital and becomes the whole level every time the account is drained to zero. The compose replays the writer's own levels exactly, sees them negative in the drained intervals, and refuses.
next_action: caller decides. Fix direction below; it touches the Deribit cash-basis wedge (Phase 131 recorded it as a known residual and left it frozen for SC-4) and, separately, how the compose treats a legitimately empty interval.

reasoning_checkpoint:
  hypothesis: "The 755 non-positive days are the writer's own realized-basis NAV, not a compose arithmetic error. The writer's BTC bucket is offset by a constant native amount (negative) that the cash-basis terminal wedge introduces. Leading cause: the wedge subtracts options_session_upl twice (once inside the combined session uPnL, once inside options_value), the 'Residual #2' Phase 131 review recorded and left frozen. Section 5 lets it through because the residual is below 1e-4 of the BTC bucket's lifetime throughput."
  confirming_evidence:
    - "Local replay of the stored inputs through the deployed replay_key_equity reproduces the PROD text exactly (755 of 1200); the other 3 counted keys replay OK"
    - "At all 7 drained event days, across 4 separate empty intervals from 2024-01 to 2026-06 and BTC index levels that differ by 2.5x, level / BTC delivery index is the same constant (spread under 1% on 6 points; the 7th, a large-withdrawal day, about 2%). A flow, timing or unit error cannot be proportional to the BTC index at every drain; a carried native BTC balance is."
    - "The writer's OWN stored dropped-day P&L on drained days equals (that constant) x (BTC index move since the previous event day): 4 of 4 checkable days agree within 0.3%-8% of each other's size, including a day 22 months after the account went empty. The writer books P&L on an empty account."
    - "The writer's stored historical returns changed on 372 of 1187 common days between the 2026-10-07 and 2026-10-08 derives with identical flows, and one day flipped between return row and dropped day. A missing ledger row would be stable run to run; an offset that depends on live state at derive time is not. A single BTC-offset change explains most of the difference (max |r| residual 0.10 -> 0.005; not exact, the writer's marks are own-row end-of-day indices, not the delivery prices used here)."
    - "Scratch RED test: the H1 open-book fixture with options_session_upl=0.2 added builds a cash-basis wedge of 1.2 where the Phase 131 identity (equity = cash + futures session uPnL + options_value) requires 1.0; on that small fixture section 5 also breaches (ratio 1.11e3). On PROD, section 5's is_dust rule (|resid| <= 1e-4 x lifetime throughput) absorbs it."
  falsification_test: "Read the account summary at the next derive of account B: if options_session_upl(BTC) is 0 (no open option book) while the drained-interval levels still show the same constant BTC offset, the wedge is NOT the source and the offset comes from elsewhere in the BTC bucket (a missing or misclassified ledger row after the last drain). Either way the compose-side verdict below stands."
  fix_rationale: "The compose is reproducing the writer exactly; a fix there alone would publish a curve built on a phantom balance. The source is the writer's per-currency terminal."
  blind_spots: "The live options_session_upl at 2026-10-08 ~20:31Z cannot be re-read; the link from the offset to that field is inferred from its shape (constant in BTC, varies by derive, matches a recorded known residual), not observed. The pre-2024 inception residual (below) is not explained by this offset."
  candidate_causes:
    - "code (writer): cash-basis terminal wedge over-subtracts options_session_upl (Phase 131 Residual #2) — LEADING"
    - "code (writer gate): section 5 is_dust = 1e-4 x lifetime throughput is far above float rounding, so a material per-currency offset reads 'reconciled' — CONFIRMED contributor (it is why native_inception reads 'reconciled' on this key)"
    - "code (compose): the strict level > 0 rule refuses a legitimately empty interval whose true level is 0 to within mark/float noise — CONTRIBUTOR (see AND-gate)"
    - "data: flow sign/units/dates, native-unit or non-USD MT5 legs, cross-key double counting — ELIMINATED"
  and_gate: "yes. (a) the phantom BTC offset drives the drained levels clearly negative; (b) the account really was emptied to zero three times, so even exact inputs give drained levels of 0 +/- a few units of noise, and `not (e > 0)` refuses 0 too. (a) alone on an account that never drains is invisible; (b) alone is a coin flip on noise. This refusal needs (a); (b) decides whether the book survives once (a) is fixed."

## Symptoms

expected: the Deribit + MT5 allocator composes a version-2 book (trustworthy, or honestly degraded)
actual: compose failed_final (permanent, 1 attempt); no book; the allocator shows rebuilding
errors: "derive_allocator_equity: compose refused a structural input — allocator equity replay: non-positive reconstructed equity on 755 of 1200 day(s) — a flow dominates prior capital (refusing to fabricate a floor)"
reproduction: 167.1.2.2-05 re-rehearsal on PROD, 2026-10-08 ~20:31Z-20:51Z, on deployed 2a107759d
started: first seen on 2a107759d (the D-12..D-16 code); the plan 02 run refused the same book earlier in the pipeline (self-check)

## Eliminated

- hypothesis: compose arithmetic defect (wrong roll, wrong flow sign/day, dropped-day P&L misapplied)
  evidence: the replay is the exact inverse of the writer's identity NAV_t = NAV_{t-1}(1+r_t) + F_t (+ stored P on dropped days), and the drained levels it produces equal a constant BTC amount x the BTC index, which is a property of the writer's per-currency roll, not of the USD replay. The writer's own stored P&L shows the same phantom.
  timestamp: 2026-10-09
- hypothesis: native-unit leg mixed with USD (BTC account, non-USD MT5)
  evidence: both MT5 keys and the other Deribit account replay OK on the same code (opening_flows_reconciled, no blocking reason); the failing key is a USD-family + coin Deribit account whose flows are USD-valued
  timestamp: 2026-10-09
- hypothesis: flows double-counted across keys of one account
  evidence: the failing account has one counted key; its two duplicate keys are disconnected and have neither returns nor key_inputs rows; replaying the single key alone reproduces the exact PROD message
  timestamp: 2026-10-09
- hypothesis: coin flow valued at a different price than the NAV mark (event-time index vs day mark), or day-boundary timing (FLOWTIMING class)
  evidence: after 2026-06-15 almost every flow is a USD-family amount (1-2 decimals), and the drained levels in four separate intervals are proportional to the BTC index at each event day. A valuation/timing error is a one-off per flow and would not scale with the index at every later drain.
  timestamp: 2026-10-09

## Evidence

- timestamp: 2026-10-09
  checked: PROD compute_jobs (marker named PRODUCTION; read only)
  found: exactly one derive_allocator_equity failed_final since the rehearsal start, 1 attempt, the reported text
  implication: one allocator, one refusal
- timestamp: 2026-10-09
  checked: that allocator's api_keys (non-secret columns), allocator_equity_derived key_inputs rows, csv_daily_returns (PROD, read only; scratch outside the repo)
  found: counted keys = 2 Deribit (accounts A and B) + 2 MT5; 5 more Deribit keys are disconnected duplicates or a departed key. Account B's key: 1188 return days 2023-06-28..2026-10-08, 86 flow days, 12 dropped days, realized terminal on 2026-10-08, native_inception 'reconciled'
  implication: account B is the D-12 key from the first debug
- timestamp: 2026-10-09
  checked: local replay_key_equity per counted key with the stored inputs (history_reaches_inception, dropped_day_pnl, realized_terminal), at origin/main 2a107759d
  found: account B raises the exact PROD text, 755 of 1200. Account A, both MT5 keys: OK, no blocking reason
  implication: the refusal is per-key and fully reproducible from stored data
- timestamp: 2026-10-09
  checked: where the level goes non-positive
  found: the non-positive days are exactly 2024-01-20..2026-06-14 minus the funded window 2025-12-15..2026-04-15 (877 - 122 = 755). Three drains: a withdrawal of about 101% of the prior level (2024-01-20), a withdrawal of about 102% (2026-04-16), and the zero-activity stretches after them. After each drain the replayed level sits at -0.3% to -0.8% of the terminal level, then a re-deposit (2025-12-15, 2026-06-15) restores a positive level. Every event day in a drained stretch is a dropped day in the writer's own returns (its guards refused the near-zero denominator); the quiet days between are r = 0 rows (gap fill).
  implication: the account was empty, not under water; the question is why "empty" replays as slightly negative
- timestamp: 2026-10-09
  checked: replayed drained levels against the public Deribit BTC and ETH delivery prices (public endpoint, no key)
  found: level / BTC index is the same constant at all 7 drained event days in four intervals over 2.7 years (spread under 1% on 6 points; about 2% on the large-withdrawal day). An ETH term fits to about zero. The sign is negative.
  implication: the writer's BTC bucket carries a constant native offset through the whole history. Rolled back unchanged in native units, its USD value tracks the BTC price
- timestamp: 2026-10-09
  checked: the writer's own stored dropped-day P&L on drained days against (offset) x (BTC index change since the previous event day)
  found: agreement on every drained day without a real flow: the largest (22 months after the account emptied) agrees to 0.3%, the others to 1-8% of their size (the residual is the delivery-price vs own-index mark difference). The one day with a real flow differs by that flow
  implication: the writer itself books P&L on an empty account from a phantom balance; the compose is faithfully replaying it
- timestamp: 2026-10-09
  checked: the 2026-10-07 derive's rows for the same key (kept from the first debug, outside the repo) against the 2026-10-08 rows
  found: flows identical except one new day; 372 of 1187 common return days differ, some with sign flips; one day was a return row on 10-07 and a dropped day on 10-08. Fitting one BTC-offset change explains most of the difference. The 10-07 inputs replayed with positive drained levels
  implication: the offset depends on live state at derive time. The same book composes or refuses depending on whether that state is positive or negative on the morning of the derive
- timestamp: 2026-10-09
  checked: analytics-service/services/deribit_ingest.py build_deribit_native_ledger (cash-basis wedge), _combined_session_upl, and Phase 131's review (.planning/milestones/v1.14-phases/131-smoothed-mtm-options-daily-mtm/131-REVIEW.md, 'Residual #2')
  found: under cash_settlement the terminal wedge is native_upnl (futures session uPnL + options_session_upl) + native_options_value. The equity identity Phase 131 pinned is equity = cash + futures_session_upl + options_value (options_value already contains the session's option move). So the realized terminal is cash - options_session_upl per currency. Phase 131 recorded this as 'cash-basis H1 wedge over-covers by options_session_upl on an open book: pre-existing, SC-4-frozen, correctly left untouched'. The file also carries the contrary H1 comment (equity == native_pnl + flow + session uPnL + options_value), so the two identities in one file disagree
  implication: a known, unfixed per-currency terminal offset of exactly the observed shape. It exists only when an option book is open at derive time, with a sign that follows the session
- timestamp: 2026-10-09
  checked: native_nav._assert_inception_reconciled
  found: a residual with |resid_c| <= 1e-4 x (sum |pnl_c| + sum |flow_qty_c|) counts as ZERO ('accumulated float rounding'). 1e-4 is about 1e11 x float epsilon. For an account that cycled several times its peak through 3 years, the BTC bucket's allowance covers the observed offset. The strict balance-identity guard is exempted for a currency with an open option book
  implication: both gates that could have caught the offset are off for this account; native_inception reads 'reconciled'
- timestamp: 2026-10-09
  checked: scratch RED test (not committed) in the scratchpad: the H1 open-book fixture plus options_session_upl = 0.2, equity unchanged
  found: FAILS today: ledger.terminal_upnl_native['BTC'] == 1.2, identity requires 1.0. Without that assertion, section 5 breaches on the small fixture (ratio 1.11e3)
  implication: the over-subtraction is reproducible in a unit test; small fixtures expose it, large-throughput PROD accounts do not
- timestamp: 2026-10-09
  checked: inception residual after the offset is accounted for
  found: the replay's implied start capital before the first deposit is +1.3% of the first-return-day level; the BTC offset explains a NEGATIVE contribution there, so a separate positive pre-2024 residual exists (not proportional to any index in the drained intervals, so not another constant per-currency offset)
  implication: even with the offset fixed and the positivity question settled, this key would block as inception_unreconciled (D-13/D-14). Open, separate, not this refusal's cause

## Resolution

root_cause: "AND-gate, two causes. (1) DATA DEFECT UPSTREAM (the trigger): the Deribit writer's realized-basis NAV for account B carries a constant phantom BTC balance in its BTC bucket (negative on 2026-10-08), which becomes the whole level whenever the account is emptied. Shape and run-to-run behaviour match the cash-basis terminal wedge over-subtracting options_session_upl (Phase 131 Residual #2, recorded and left frozen); section 5's is_dust allowance of 1e-4 x lifetime throughput let it pass as 'reconciled'. (2) COMPOSE RULE: `not (e > 0)` refuses a legitimately empty interval, whose true level is 0 to within noise, so even exact inputs leave this book one noise sign away from refusal. The compose arithmetic itself is correct: it reproduces the writer's levels exactly."
verdict: "Refusal is CORRECT about its inputs (the levels it was given really are negative, and publishing them would fabricate) and WRONG about the account (it was empty, never under water). The inputs are wrong, not the reconstruction. Not flow sign, units, native-unit mixing, double counting or day-boundary timing."
relation_to_flowtiming: "Separate root cause. FLOWTIMING (164.6.6.2.3) changes how a return is measured around flows (base = capital at position open, intraday timestamps, replace flow_dominated_guard). It does not touch the terminal wedge or section 5, so the phantom BTC balance and the negative drained levels survive it unchanged. Interaction to plan for: if FLOWTIMING's returns stop satisfying the day-level identity NAV_t = NAV_{t-1}(1+r_t) + F_t, the compose replay will stop reproducing the writer on every flow day; FLOWTIMING must keep persisting what the compose rolls with (the D-15 dropped-day P&L pattern, extended to any day whose return is not the day-level identity)."
fix_direction:
  - "Writer (root): under cash_settlement, wedge = futures session uPnL + options_value (do not add options_session_upl a second time). Confirm the identity first with one account-summary read on account B at its next derive (record whether options_session_upl(BTC) is nonzero and whether the drained-interval offset disappears). This moves cash-basis returns for every Deribit account with an open option book at derive time, which is why Phase 131 froze it; it is a correctness change, so it needs its own phase/decision and an SC-4 re-baseline."
  - "Writer gate: section 5's is_dust = 1e-4 x lifetime throughput should not wave through a material per-currency residual; bound it by an absolute/NAV-relative cap as well (decision: it is a calibration constant with a recorded 'loosening requires evidence' note)."
  - "Compose: decide how an emptied interval composes. Options: treat a level within a band of zero (the writer's own dust semantics, or a D-14-style fraction of the key's scale) as zero capital that contributes 0 to the book, refusing only below the band; or degrade the key with a named blocking reason instead of failing the whole allocator permanently. Founder decision (D-14 set the band philosophy)."
test_that_fails_today: "analytics-service/tests/test_deribit_ingest.py, next to test_h1_cash_settlement_open_book_reconciles_at_inception: same fixture, summary {'currency':'BTC','equity':3.0,'session_upl':0.5,'options_session_upl':0.2,'options_value':0.5}; assert ledger.terminal_upnl_native['BTC'] == approx(1.0) and combine_native_ledger closes section 5. Ran in scratch at 2a107759d: RED (wedge 1.2; section 5 breach ratio 1.11e3). Compose-side companion (after the decision): replay_key_equity on a synthetic key that withdraws 100% of its level, sits empty, and re-deposits, with a level of exactly 0 (and -noise) in the empty stretch — today raises 'non-positive reconstructed equity'."
oracle_type: derived (the Phase 131 pinned equity identity, and the writer's own stored P&L as an independent check of the phantom)
files_involved:
  - analytics-service/services/deribit_ingest.py: cash-basis terminal wedge (native_upnl + native_options_value) in build_deribit_native_ledger
  - analytics-service/services/native_nav.py: _assert_inception_reconciled is_dust allowance (INCEPTION_NATIVE_DUST_REL x throughput)
  - analytics-service/services/allocator_equity_derive.py: replay_key_equity positivity refusal (`not (e > 0.0)`)
specialist_hint: python
