---
phase: 184-walletoffset-the-first-mark-offset-on-wallet-base-venues-is
plan: 05
subsystem: planning
tags: [readout, founder-decision, walletoffset, okx, bybit, binance, sfox]
requires:
  - phase: 184-07
    provides: the re-run's readout lines, caveats, summary record and sc1-met
provides:
  - the founder's readout decision (D-02) recorded in 184-CONTEXT and the ROADMAP Phase 184 entry, and the SC-3 proof from both code merges
affects: [184]
requirements-completed: [SC-2, SC-3]
completed: 2026-11-01
status: complete
---

# Phase 184 Plan 05: the WALLETOFFSET founder readout Summary

**The founder read the re-run's numbers and decided on the P&L part at a 0.1% of NAV threshold, venue-wide. No measured key reaches it (OKX at most 0.0000786, Bybit 0.000543), so OKX and Bybit keep the wallet base. Binance and sFOX have no marked keys and wait for their own measurement. No published number changed.**

readout-run-date: 2026-11-01

## The readout the founder saw

The numbers come from 184-07, the re-run after the G-01 fix. The first run, 184-04, refused every marked OKX key as `malformed` because of G-01; plan 184-06 fixed that. Of 17 keys, 6 are marked and all 6 were measured (`keys_unmeasurable` 0). The founder was told what the ratios mean: a positive pnl ratio means the wallet at the read held that share of NAV more than the realized chain at midnight. The first marked day's return therefore reads low by about that ratio, and every cumulative figure spanning that day carries the shift.

| label | venue | measured | trading | funding | pnl | flow | offset | over_wallet | partial | shares_account |
|---|---|---|---|---|---|---|---|---|---|---|
| k4 | okx | true | 0 | 0.0000784 | 0.0000784 | 0 | 0.0000784 | 0.0000812 | false | true |
| k8 | okx | true | 0 | 0.0000785 | 0.0000785 | 0 | 0.0000785 | 0.0000812 | false | true |
| k10 | okx | true | 0 | 0.0000784 | 0.0000784 | 0 | 0.0000784 | 0.0000812 | false | false |
| k15 | okx | true | 0 | 0.0000785 | 0.0000785 | 0 | 0.0000785 | 0.0000812 | false | true |
| k16 | bybit | true | 0.00096 | -0.000417 | 0.000543 | 0 | 0.000543 | 0.000548 | false | false |
| k17 | okx | true | 0 | 0.0000786 | 0.0000786 | 0 | 0.0000786 | 0.0000812 | false | false |

| venue | state | max_abs_pnl | max_abs_offset |
|---|---|---|---|
| okx | measured (5 of 5 marked) | 0.0000786 | 0.0000786 |
| bybit | measured (1 of 1 marked) | 0.000543 | 0.000543 |
| binance | no_keys | field-absent | field-absent |
| sfox | no_keys | field-absent | field-absent |

184-07's caveats name no label as partial, none with OKX spot, other-instrument or transfer bills in the window, and no Bybit Unified-edge row. k4, k8 and k15 share an account. Every marked key reads flow 0. sc1-met: yes (184-07).

The founder was shown the two readings the numbers rest on. The window runs from UTC midnight of the read day to the read itself (RESEARCH A2). "Fills and trade history" means the venue trade history the chain itself books: OKX bills, Bybit closed P&L, Binance income (RESEARCH A1). No objection was given.

reading-objection: none

## Recommendations and answers (verbatim)

q5-recommended: State the P&L part and the flow part separately and decide on the P&L part. Reason: the applier's rule 10 already moves a flow made before the read into the mark day (`placed_flow_instants`), so the flow part does not mis-state the base (RESEARCH "What the offset is" item 5).
q5-answer: Decide on the P&L part (Recommended)
q1-recommended: 0.1% of NAV (0.001) on |pnl ratio|. Reason: returns print at 0.01% steps (`formatPercent` default two decimals), so a 0.1% offset moves the first marked day's return, and every cumulative return spanning that day, by about ten printed steps.
q1-answer: 0.1% of NAV (Recommended)
q2-recommended: A venue moves when any of its measured keys is material. Reason: the writer-chain base is chosen per venue in code (`WRITER_BASIS_VENUES` is a set of venue names), so there is no per-key switch.
q2-answer: Venue moves if any key is material (Recommended)
q3-recommended: Decide on the measured keys and re-measure the others when their cause clears (every venue with marked keys has at least one measured key).
q3-answer: moot (every marked key was measured)
okx-recommended: Keep the wallet base. Reason: OKX max |pnl ratio| 0.0000786 is below the 0.001 threshold on every one of its 5 measured keys.
okx-answer: Keep the wallet base (Recommended)
bybit-recommended: Keep the wallet base. Reason: Bybit's one measured key, k16, reads |pnl ratio| 0.000543, below the 0.001 threshold.
bybit-answer: Keep the wallet base (Recommended)
q4-recommended: Wait for their own measurement once a key is marked. Reason: nothing was measured, CONTEXT "Never invent data", and sFOX's chain books no realized P&L, so an OKX or Bybit answer does not carry over (RESEARCH A7).
q4-answer: Wait for their own measurement (Recommended)
sfox-definition-answer: not asked (no marked sFOX key printed reader_not_built; sFOX has no keys)
ledger-offer-recommended: moot, so no recommendation was put to the founder. The readout is neither material (the largest measured |pnl ratio|, 0.000543, is below the 0.001 threshold) nor ambiguous (184-07's caveats name no label in the partial, OKX spot, OKX other-instrument, OKX transfer-bill or Bybit Unified-edge caveat, and no reading objection was recorded).
ledger-offer-answer: moot (no measured key at or above the Q1 threshold, and no chain-incompleteness caveat or reading objection)

venue-decision: okx=keep bybit=keep binance=wait sfox=wait
venue-decision-answer: OKX: "Keep the wallet base (Recommended)"; Bybit: "Keep the wallet base (Recommended)"; Q4 Binance and sFOX: "Wait for their own measurement (Recommended)"

Founder answers given 2026-11-01 through AskUserQuestion. The question texts were Q5 "Phase 184 readout (…) Q5: should the decision rest on the P&L part alone, with flows stated separately?", Q1 "Q1: from what size is an offset material? (It applies to the quantity you chose in Q5.)", Q2 "Q2: does a venue move when any of its keys is material, or per key?" and Q4 "Q4: Binance and sFOX have no marked keys, so nothing was measured. What happens to them?", plus one venue question each for OKX and Bybit. Q3 and the ledger offer were moot and were not asked. The sFOX definition did not apply.

follow-up-question: How should the wait be tracked?
follow-up-answer: "TODOS entry with a trigger (Recommended)": "A TODOS item: when a Binance or sFOX key first gets a mark, measure its offset with the existing probe. It doesn't hold the milestone open."
follow-up: TODOS [184-BINANCE-SFOX-OFFSET-WAIT] (founder 2026-11-01: "TODOS entry with a trigger (Recommended)")

No phase was booked. The founder chose a TODOS entry with a trigger for the Binance and sFOX wait (a key's first stored mark), so the wait does not hold the milestone open. The orchestrator amended the DECISION_OK check in 184-05-PLAN.md to accept that line; the change is marked there as a dated correction.

## SC-3: no published number changed

The phase's two code merges are 184-04-SUMMARY's `phase-merge-commit:` (`552cd7d3`, plans 184-01 to 184-03) and 184-07-SUMMARY's (`ce8685fa`, plan 184-06's G-01 fix). They differ. `git show --name-only --format=` on each lists only allowlisted paths:

sc3-merge-files: CHANGELOG.md, VERSION, analytics-service/scripts/walletoffset_probe.py, analytics-service/tests/_okx_bills.py, analytics-service/tests/test_walletoffset_probe.py, package.json
sc3-fix-merge-files: CHANGELOG.md, VERSION, analytics-service/scripts/walletoffset_probe.py, analytics-service/tests/test_walletoffset_probe.py, package.json
sc3: no published number changed

Neither merge touched a derive, applier, migration or UI path, and the decision moves no venue, so nothing is built from it. No PROD query was needed for this proof, and none was run.

sc2-met: yes

## Deviations

- Plan 184-05 names the orchestrator as operator. The questions were asked by the orchestrator. Its scribe agent wrote these records from the orchestrator's verbatim answers; no question was re-asked.
- Call structure: the orchestrator asked Q5, Q1 and Q2 and the venue questions with Q4. The answers are recorded as given; Q3 and the ledger offer were moot and not asked, as the plan says.
