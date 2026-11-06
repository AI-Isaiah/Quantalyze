# Phase 179 OKXBILLSCHAIN - Context

**Gathered:** 2026-10-28
**Status:** Ready for planning

<domain>
## Phase Boundary

Find which link of the OKX bills-archive running balance breaks for a4 (`chain_break` over 1489 bills on the 2026-10-28 deployed probe), then either fix the oracle's reading with a test that goes RED on the old reading, or record the break as a real gap in OKX's archive behind a named refusal. a4 never anchors on an unproven opening. After deploy the probe re-reads a4 and the founder keeps or re-sets the 0.05 opening tolerance on that reading. No OKX history rebuild happens in this phase.

</domain>

<decisions>
## Implementation Decisions

### Carried (not re-asked)
- Phase 172 D-01: the bills oracle is a check-only second opinion; anything but "agreed" refuses `anchor_skipped_implausible` and writes nothing (fail closed). Venue exceptions propagate (PD-I: no automatic re-crawl).
- Phase 172 plan 05, founder 2026-10-28: "Record, route a follow-up (Recommended)" (SC-3 mismatch). This phase is that follow-up.
- Phase 172 plan 05, founder 2026-10-28: "Keep 0.05, re-decide later (Recommended)". `OPENING_TOLERANCE_REL` stays 0.05 until an opening is measurable; SC-3 of this phase re-decides it.
- `OPENING_UNAVAILABLE_REASONS` is a closed set: "a new way to fail is a decision, not an f-string" (module docstring). Adding a token is a founder decision.
- TRADEPAGES D-05: stored histories stay as recorded. Phase 173 owns any OKX rebuild.
- Probe records carry counts, booleans, tokens and 3-significant-figure ratios only: no amount, no uuid, no bill id, no run of ten or more digits.

### Phase decisions
- **D-01 — Measure before fixing** (orchestrator brief 2026-10-28, from the founder's routing): "Measure before fixing; the phase's first plan should be the measurement." The measurement is a read-only PROD probe on the backfill worker (the 172 plan 05 delivery pattern). It is an operator step owned by the orchestrator, and each Railway probe run needs the founder's approval. Plan it as a checkpoint task.
- **D-02 — Candidate causes are measured, not assumed** (orchestrator brief 2026-10-28): the measurement must be able to tell apart, in one run where possible:
  - which arm fires: an interior link (`bal != prev_bal + balChg`) or the close (newest `bal != cashBal`);
  - on which currency and which bill kind (`type`, `subType`, `instType` tokens);
  - bills-archive not covering the newest days (compare against `/account/bills`, last 7 days);
  - bill types missing from the archive;
  - ordering or ties (billId order against ts order; several bills on one ts);
  - precision or rounding (the size of the link residual as a bucket token, never an amount);
  - a currency whose bills are partly outside the window.
- **D-03 — Fix choice waits for the reading:** which fix lands (a reading change in the oracle, or a new named refusal) is chosen from the measurement at a founder decision checkpoint after plan 01, not in this context. If the reading disproves a later plan, replan rather than patch.

### Coordination with Phase 173
Phase 173 REBUILDGATES changes `allocator_history_probe.py` in parallel (the OKX ordering read also runs on a refused member). This phase keeps its probe changes minimal and additive (new record keys only), expecting a merge later.

### Claude's Discretion
- Where the break diagnostic is computed: the oracle can return a structured break descriptor (arm, currency, bill-kind tokens, counts, residual-size bucket) that the probe prints. This keeps the forced path's behaviour unchanged (still fail closed) while making the token explain itself.
- The exact record keys and bucket edges, within the counts-and-tokens rule.
- Whether the extra `/account/bills` (7-day) read lives in the oracle or only in the probe. It must stay GET-only and go through `_okx_bills_fetch_with_backoff`.
- The currency printed for the worst break uses the closed vocabulary already inside the redaction contract (`STABLECOINS` plus `BTC`, `ETH`, `OKB`, anything else `other`) together with a stable flag. Printing a free ticker (regex-validated) would widen the contract and is a founder call, so it is not done unless the founder asks (179-RESEARCH Open Question 1).
- The extra-request budget of the one measurement run: a hard call ceiling (about 120) with `*_complete` booleans when it is hit (179-RESEARCH Open Question 2).

- **D-04 — Currency vocabulary for the measurement run** (founder, AskUserQuestion 2026-10-28): "Fixed class (Recommended)". The worst-break currency prints as the closed class (STABLECOINS, BTC, ETH, OKB, else `other`); no ticker is printed, so no code change before the run.
- **D-05 — Probe sharing:** 173's post-deploy probe already ran on 2026-10-28 (173 plan 03), so 179's measurement run is its own run; it still needs the founder's approval when due.

- **D-06 — Fix choice: compare at OKX precision, a deviation from 179-03's precedence** (founder, AskUserQuestion 2026-10-28): "Compare at OKX precision (Recommended)". a4's reading: chain_arm close, `chain_close_residual_bucket=lt_1e-12`, `chain_close_cash_moved=0`, `chain_close_matches_after=0`, `chain_close_bill_after_utime=0`, `chain_interior_breaks=0` over `chain_interior_links=1489`, worst currency stable. Plan 179-03 Task 2's literal precedence yields `second-run` (row 8 dust-tolerance requires a non-stable worst currency), so this departs from it: the close check passes when the two balances agree to the bill's own decimal places (or within a 1e-12 relative bound), anything larger still refuses `chain_break`, with a test RED on today's exact equality. Reason for departing: the endpoints print the same balance at different decimal places, not missing money, so a second run would read the same. No new reason token; `OPENING_TOLERANCE_REL` stays 0.05 until SC-3. Recorded also in ROADMAP Phase 179.

- **D-07 — Close check: the trillionth bound only; supersedes the decimal-places half of D-06** (founder, AskUserQuestion 2026-10-28, on review finding SFH-179-04-01): "Trillionth bound only (Recommended)" — option text shown: "Delete the decimal-places rule; the close check passes only when the two balances agree within 1e-12 of the larger one. a4 still passes; nothing can forgive an 8% gap. Smallest change (a deletion), done in one fixer round with a test that fails on the 0.5 vs 0.54 case." The close arm now passes only when the newest bill's `bal` equals today's `cashBal` or differs by at most 1e-12 of the larger of the two; anything larger refuses `chain_break`. The rest of D-06 stands: the interior arm stays exact, no new reason token, `OPENING_TOLERANCE_REL` stays 0.05 until SC-3. Recorded also in ROADMAP Phase 179.

- **D-08 — Opening tolerance re-set to 0.02 on a4's SC-3 reading** (founder, AskUserQuestion 2026-10-28, plan 179-05 Task 2): "Tighten to 2%" — option text shown: "a4 still passes at 1.36%, but other accounts get less room; one data point behind the number. Routes back to a small replan." The recommendation, by the 172-05 step 9b rule, was "Keep 5% (Recommended)" (`opening_check=measured`, residual -0.0136, absolute value under 0.025); the founder chose against it. `OPENING_TOLERANCE_REL` becomes 0.02 through a plan added by `/gsd-plan-phase 179` with a test (D-03: replan, never patch); it stays 0.05 in code until that plan ships. a4's residual (0.0136) stays inside 0.02. Still one account: `172-OKX-OPENING-TOLERANCE-ONE-ACCOUNT` stays open. Recorded also in ROADMAP Phase 179.

### Founder decisions pending (not answered here)
- After plan 01's reading: which fix, or which named refusal token.
- After deploy (SC-3): keep or re-set `OPENING_TOLERANCE_REL` on a4's reading. Answered 2026-10-28: D-08 (re-set to 0.02).

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `analytics-service/services/okx_opening_balance.py`: `walk_okx_bills_archive` (pages backward by `billId` with `after`, stops on a bill older than the opening instant), `per_ccy_opening` (orders by `billId`, raises `chain_break` on either arm with exact Decimal equality), `OkxOpeningReading` (counters only today), `_parse_bill` (keeps `type`, `instType`; drops `subType`).
- `analytics-service/services/okx_archive_classify.py`: the quarter-file chain verifier counts breaks per currency (`breaks`, `first_break_day`, `seam_breaks`) rather than stopping at the first; same `billId` ordering (`_bill_order_key`). The chain held exactly over 1605 pairs on a real account's quarter FILES (167.1.2.2.2.1), never measured on the JSON endpoint (172 RESEARCH A1).
- `analytics-service/services/exchange.py` `_okx_bills_fetch_with_backoff`: the 429 backoff every bills page goes through.

### Established Patterns
- Probe: `analytics-service/scripts/allocator_history_probe.py` `_measure_anchor` calls `obal.read_okx_opening` and prints `opening_check`, `opening_unavailable_reason`, `bills_read`, `bal_over_cashbal` (newest USDT bill's `bal` over USDT `cashBal`, which read 1 for a4). Record keys are a pinned tuple with per-key validators.
- Tests: `analytics-service/tests/test_okx_opening_balance.py` (oracle fakes with explicit dict pages), `tests/test_allocator_history_probe.py` (record keys, emit validation).

### Integration Points
- `services/equity_reconstruction.py` forced OKX path (`obal.read_okx_opening` behind the 5x arm): any oracle change reaches the forced rebuild's decision.

</code_context>

<specifics>
## Specific Ideas

- a4 readings 2026-10-28: `bills_read=1489`, `bal_over_cashbal=1`, `implied_opening_over_anchor=0.929`, `anchor_over_replay=14.1`, `upl_over_anchor=0.0107`, `non_stable_share=4.72e-9`, `trades_read=1282`, `opening_day_is_window_start=false`. `bal_over_cashbal=1` is a 3-significant-figure ratio (within about 0.05%, not proven equal), so it does not clear USDT's close arm; `non_stable_share=4.72e-9` shows non-stable dust is held. The token does not say which arm or currency fires (179-RESEARCH).
- TODOS `167.2.1.1.2.1-OKX-ANCHOR-IMPLAUSIBLE`, `172-OKX-OPENING-TOLERANCE-ONE-ACCOUNT`.

</specifics>

<deferred>
## Deferred Ideas

- Any OKX history rebuild (Phase 173 and later).
- A second OKX account for the tolerance basis (none is connected).

</deferred>
