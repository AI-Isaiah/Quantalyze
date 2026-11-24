---
phase: 231-bybitreads-a-bybit-read-covers-every-coin-settle-type-window
plan: 02
subsystem: analytics-service Bybit reads (probe tooling and the one PROD run)
tags: [bybit, probe, research-first, vread-02, vread-03, vread-04, c27]

requires:
  - phase: 231
    provides: 231-CENSUS.md probe-evidence list, rulings OQ2/OQ3/OQ7
provides:
  - "analytics-service/scripts/bybitreads_probe.py (merged in PR #1314, squash 8d825f123): read-only, counts-only venue probe, sections A-D"
  - "231-PROBE-RESULT.md: the run's records and derived lines (RUN_OK)"
affects: [231-03, 231-04, 231-05, 231-06]

actuals:
  tasks: 3
  review_rounds: 2
plan_head_before: 9c0757937
plan_head_after: 0ce3a4292

key-files:
  created:
    - analytics-service/scripts/bybitreads_probe.py
    - analytics-service/tests/test_bybitreads_probe.py
    - .planning/phases/231-bybitreads-a-bybit-read-covers-every-coin-settle-type-window/231-PROBE-RESULT.md
    - .planning/phases/231-bybitreads-a-bybit-read-covers-every-coin-settle-type-window/231-REVIEW.md
  modified:
    - analytics-service/tests/_trade_pages.py

key-decisions:
  - "Round-1 and round-2 review MEDIUMs fixed: every not-measured outcome is failed, field-absent or exit 1"
  - "R2-SF-1 (fingerprint does not identify the commit) not fixed: squash merge plus the deployed-commit binding cover it"
  - "A Railway redeploy reuses the old snapshot's start command; a start-command wrapper needs a redeploy from source (pinned with --commit)"

requirements-completed: []  # evidence only: VREAD-02/03/04 close in plans 03, 04 and 05

status: complete
completed: 2026-11-23
---

# 231-02 summary: the Bybit read probe was built, reviewed, shipped and run once

## What was built
`scripts/bybitreads_probe.py` measures the venue directly. It has four sections:
- A: trade window and 365-day page sweep
- B: deposit verdict
- C: exposure per settle type
- D: funding walk timing

Output goes only through a closed vocabulary (`emit_record`). Every venue call goes through the read-only recording view, which has a ceiling per section. There are 118 tests, and the deploy fingerprint is `bybitreads 0 1 48 24 5 3`.

## Review
Both rounds ran gsd-code-reviewer in parallel with silent-failure-hunter.
- Round 1 found 9 MEDIUMs, and all were fixed. PROOF-01 is recorded for WR-01, WR-02, SF-M4 and WR-03.
- Round 2 found one MEDIUM, a repeated cursor in section C. It was fixed with PROOF-01.
- One MEDIUM, R2-SF-1, was recorded and not fixed, with the reason given.

The details are in 231-REVIEW.md. PR #1314 merged green: 28 of 28 checks, then main CI green on 3 runs.

## The run (2026-11-23, 19:20-19:50Z)
The run exited 1: section A of k6 failed because the sweep hit its deadline and the start-less count exceeded its cap. All other sections completed, and the worker was restored and verified. Findings for the next plans:
- **03, VREAD-02.** All three position categories read ok. The live key holds 45 open linear USDT positions, 0 USDC, 0 inverse, and no stable coins other than USDT. No refusal occurred, so the Pitfall 6 question does not arise.
- **04, VREAD-03.**
  - The legacy read is truncated: 100 rows against 24201 windowed, of which 17922 fall after the first week.
  - The page-cap input is a lower bound of 121 pages in one window, from 34 windows in 600 s. A 365-day walk of this key takes 15 to 20 minutes.
- **05, VREAD-04.** The verdict is undecided: 0 on-chain transfers, and the unified reader shows 4 in and 2 out. Nothing supports replacing the reader.
- **C27.** The funding walk completes in 379 s, using 1438 calls and returning 65522 rows, while funding_fees holds 0 rows. So sync_funding's daily timeout is a walk that runs longer than the handler's budget.

## Deviations
- Plan 02 went over its budget, which was accepted.
- The approval was relayed by the coordinator, because this agent has no AskUserQuestion.
- The first wrapper redeploy was a no-op (it reused the old snapshot). A second deploy from source applied the wrapper.
