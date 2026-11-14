---
phase: 155-parityharness-an-agent-built-harness-can-prove-our-mt5-numbe
plan: 11
subsystem: testing
tags: [mt5, parity, dress-rehearsal, red-proof, findings, surface-matrix]

requires:
  - phase: 155-parityharness plan 07
    provides: "the verdict and red-proof CLI (mt5_parity_run), final_green, the DRESS REHEARSAL header"
  - phase: 155-parityharness plan 08
    provides: "the records CLI (findings, scan)"
  - phase: 155-parityharness plan 09
    provides: "the real-mode surface matrix test"
  - phase: 155-parityharness plan 10
    provides: "the sealed real capture and 155-CENSUS.md"
provides:
  - "155-DRESS-REHEARSAL.md: per-account verdicts for MM2, MM3 and FX-AI_V against the synthetic oracle bound as SYN-A"
  - "155-RED-PROOF.md: the RED proofs (synthetic pair GREEN to RED to GREEN; byte-identical restores on each real account's rehearsal inputs)"
  - "155-FINDINGS.md: 18 named findings, 10 observations and the proposed flag classes, for 155.2's MT5-10 loop"
affects: [155.2]

actuals:
  tokens: 6200
  tasks: 2
  commits: 2
plan_head_before: 04c772898cc1c28b5c0e0a22ce57b62c962366a6
plan_head_after: 71adc20b1fd9f3046540465d7903987a2a15b5db

tech-stack:
  added: []
  patterns:
    - "Tracked records are concatenations of CLI/renderer output with a hand-written header only; a scan hit is fixed in the renderer, never in the record"

key-files:
  created:
    - .planning/phases/155-parityharness-an-agent-built-harness-can-prove-our-mt5-numbe/155-DRESS-REHEARSAL.md
    - .planning/phases/155-parityharness-an-agent-built-harness-can-prove-our-mt5-numbe/155-RED-PROOF.md
    - .planning/phases/155-parityharness-an-agent-built-harness-can-prove-our-mt5-numbe/155-FINDINGS.md
  modified: []

key-decisions:
  - "Added a supplementary picker-window run beside the plan's explicit windows, because the plan's windows are all refused on the real capture and would leave the rehearsal-input RED proofs without any measurable leg"

requirements-completed: [PARITY-02, PARITY-03]

coverage:
  - id: D1
    description: "The synthetic pair shows each of the three broken inputs flipping GREEN to RED with its named bucket and leg and back to GREEN with sha256 equality, and each real account's rehearsal inputs restore to a byte-identical verdict"
    requirement: "PARITY-02"
    verification:
      - kind: command
        ref: "python3 -m scripts.mt5_parity_run red-proof --capture-bundle ... --mutation all (exit 0, 3 proofs, meets expectation yes x3); 21 of 21 rows 'restored verdict byte-identical: yes'"
        status: pass
    human_judgment: false
  - id: D2
    description: "A DRESS REHEARSAL verdict per present account against the one MT5_PARITY_TOLERANCE, from the real sealed capture and the synthetic oracle bound as SYN-A, so it cannot read as a parity pass"
    requirement: "PARITY-03"
    verification:
      - kind: command
        ref: "python3 -m scripts.mt5_parity_run verdict (x6, exit 0, final_green=no); grep -c 'DRESS REHEARSAL' 155-DRESS-REHEARSAL.md (8)"
        status: pass
    human_judgment: false
  - id: D3
    description: "The real-mode surface matrix ran on the sealed capture and every MT5-09 data-layer discrepancy and MT5-15 flag is a named finding for 155.2"
    requirement: "PARITY-03"
    verification:
      - kind: unit
        ref: "MT5_PARITY_CAPTURE_DIR=... npx vitest run src/__tests__/mt5-parity-surfaces.test.ts (8 passed); python3 -m scripts.mt5_parity_records findings (exit 0)"
        status: pass
    human_judgment: true
    rationale: "Whether each finding's root-cause lead is right, and which flags are accepted, is the founder's call in 155.2"
  - id: D4
    description: "All four records pass the record-profile tracked-text scan"
    requirement: "PARITY-03"
    verification:
      - kind: command
        ref: "python3 -m scripts.mt5_parity_records scan --profile record 155-CENSUS.md 155-DRESS-REHEARSAL.md 155-RED-PROOF.md 155-FINDINGS.md (exit 0)"
        status: pass
    human_judgment: false

duration: 12min
completed: 2026-11-13
status: complete
---

# Phase 155 Plan 11: Dress rehearsal, RED proofs and findings Summary

**The harness ran end to end on the sealed real capture: all three RED mutations flip the synthetic pair GREEN to RED to GREEN with sha256 equality, each of MM2, MM3 and FX-AI_V got a DRESS REHEARSAL verdict, and the real-mode surface matrix produced 18 named findings for 155.2. Nothing was fixed.**

## Task record

| Task | Name | Commit |
| ---- | ---- | ------ |
| 1 | Dress rehearsal per real account and the RED-proof record | `1610f343d` |
| 2 | Real-mode surface matrix, the findings ledger and the final scan | `71adc20b1` |

- Run id `run-2026-11-13-2123`, capture day 2026-11-13, labels present: MM2, MM3, FX-AI_V (all three). Base clock rule `us`.
- No PROD access, no gateway call, no derive or sync, no analytics recompute. Every input was the sealed local capture and the committed synthetic fixtures. The capture path is not written into any tracked file.

## Task 1: dress rehearsal and RED proofs

- **Synthetic pair:** `red-proof --mutation all` exit 0, 3 proofs, each `meets expectation: yes`, baseline GREEN, mutated RED, restored GREEN, `restored sha256 equal: yes`, restored verdict byte-identical.
  - `reclassify_balance` -> bucket `flow_placement`, legs `cum_return` and `day_placement` moved.
  - `clock_shift_1h` -> bucket `clock_mismatch`, leg `day_placement` moved.
  - `drop_oldest_deal` -> bucket `unexplained`, leg `inception_identity` moved (gap 0 to 5, back to 0).
- **Dress rehearsal, plan windows (Gate A 2026-10-05 to 2026-10-30, Gate B 2026-11-06 to 2026-11-13):** all six verdicts (three accounts, two gates) are recorded `window_refused:` verdicts: Gate A is `gate_a_reaches_first_mark` (the real accounts' first mark is 2026-10-26), Gate B is `window_not_closed` (it ends on the run day). Every run exits 0, `final_green=no`, and each section opens with the DRESS REHEARSAL line.
- **Rehearsal-input RED proofs, plan windows:** because every window is refused, all nine proofs record `named_leg_absent:window_refused:gate_a_reaches_first_mark`, `meets expectation: no`, and a byte-identical restore. This is the true reading and is recorded as such.
- **Supplementary, picker windows (no `--gate-*` flags):** the picker proposes windows from the real deals, so the evaluation legs actually run.
  - Gate A reads `not_measurable:unit_mismatch` on all legs but `inception_identity` (the real accounts carry a native unit marker, and the synthetic oracle is not that unit). Gate B breaches `start_level`, `end_level` and `cum_return` with large gaps, as expected against a synthetic oracle in a different magnitude.
  - `drop_oldest_deal` moves `inception_identity` on all three real accounts (named leg moved: yes, restored verdict byte-identical). `reclassify_balance` and `clock_shift_1h` read `named_leg_unchanged`, because their legs are `not_measurable` against this oracle. By plan 07's Pitfall 2 note, the clock shift also moves `day_placement` only when a deal sits within an hour of a UTC midnight in the window, so this is not a harness fault.
  - All nine restores byte-identical.
- All rehearsal-input rows: 21 of 21 `restored verdict byte-identical: yes` across both records (3 synthetic, 9 plan-window, 9 picker-window).

## Task 2: surface matrix and findings

- Real-mode vitest `src/__tests__/mt5-parity-surfaces.test.ts`: 8 passed, 0 skipped, wrote `derived/surface-matrix.json` in the capture directory (not in the repo; `git status` shows nothing for it).
- `records findings` exit 0. **Counts:**

| Kind | Count |
| ---- | ----- |
| flag | 3 |
| surface | 12 |
| cross_store | 3 |
| **Total findings** | **18** (F-155-01 to F-155-18) |

- **Flags proposed `explained_acceptable`: 9** of 12 flag keys across the three accounts (`cumulative_method`, `marks_covered_from`, `marks_since`, each on MM2, MM3 and FX-AI_V). The other 3 (`csv_source` on each account) are `unknown`, outside the closed flag table, and are findings F-155-04 to F-155-06. Flag classes are a proposal for 155.2 sign-off, never a final acceptance.
- **Observations: 10.** Nine are `not_rendered_while_unpublished` (share card, factsheet PDF and discovery card on each of the three accounts). The tenth is MM2's `allocations_strategies_panel`, `not_applicable:not_own_capital`.
- **Every finding goes to 155.2's MT5-10 loop. Nothing was fixed here.**

### Root-cause leads (for 155.2; these are leads, not conclusions, and are not in the tracked findings text)

- **F-155-01 to F-155-03 (cross_store, series vs per-key return rows):** 134/171 days (FX-AI_V) and 113/237 days (MM2, MM3) differ. The compared day count (237) exceeds MM2/MM3's 235 observations and 171 exceeds FX-AI_V's 170, so the two stores do not hold the same day set. Lead: the strategy series carries an extra day or differently placed days (weekend or flow-day placement) against the per-key rows. Start from the first differing day, 2026-03-21 and 2026-05-26 (each account's inception).
- **F-155-04 to F-155-06 (csv_source flag unknown):** the flag is stored on all three accounts but absent from the closed flag table. Lead: it is a provenance tag set at ingest; 155.2 classifies it, probably `explained_acceptable`.
- **F-155-08, 10, 11, 12, 14, 17 (last_return_date):** the live surfaces end 2026-11-12, the factsheet cell ends 2026-11-10 (MM2, MM3) or 2026-11-11 (FX-AI_V). These match the census computed_at readings (MM2 and MM3 2026-11-11, FX-AI_V 2026-11-12), so the lead is factsheet analytics staleness (strategy_analytics computed_at), not a computation error.
- **F-155-07, 09 (FX-AI_V cumulative_return, 1.73x tolerance), F-155-13, 16 (MM3 cumulative_return, 1.27x), F-155-15, 18 (MM3 max_drawdown, 1.15x):** all within a small multiple of the tolerance. Lead: the same staleness gap (the factsheet cell ends one to two days earlier than the live baseline), so the day count differs. 155.2 should recompare on equal end dates before treating any of these as a computation defect. MM2's cumulative return and drawdown do not breach.

## Deviations from Plan

**1. [Rule 2 - Missing critical functionality] Supplementary picker-window run**
- **Found during:** Task 1, step 3
- **Issue:** the plan's explicit windows are all refused on the real capture, so the rehearsal-input RED proofs had no measurable leg and the must-have "the named leg's movement ... on each real account's rehearsal inputs" could not be shown. An exploratory run with no `--gate-*` flags evaluated and showed real movement.
- **Fix:** ran the same CLI commands with no `--gate-*` flags for each account (verdict and red-proof), and recorded them as clearly labelled supplementary sections (Part 2 of the rehearsal record, Part 3 of the RED-proof record) beside the plan-compliant sections. No figure was hand-edited.
- **Files modified:** 155-DRESS-REHEARSAL.md, 155-RED-PROOF.md (new files, both tracked)
- **Commit:** `1610f343d`

**Total deviations:** 1 auto-added (Rule 2). **Impact:** records are a superset of the plan's; the plan-compliant sections are present and unchanged.

## Verification

- `scan --profile record` over CENSUS, DRESS-REHEARSAL, RED-PROOF and FINDINGS: exit 0. `grep -c "DRESS REHEARSAL"` is 8; `grep -cE "flow_placement|clock_mismatch|inception_identity"` on the RED-proof record is 40; findings has 3 `## ` sections.
- **Gate shown able to fail:** the scan gate was proven able to fail in plans 01, 07 and 08 and no gate code changed here. Re-shown on a byte copy in scratch: appended a home path to a copy of 155-FINDINGS.md, scan exit 1 (`home_path`); the tracked record is untouched (sha256 `c119397a...` before and after) and scans exit 0. No analytics code changed, so mypy was not re-run.
- Acceptance: the synthetic red-proof exited 0 with three GREEN to RED to GREEN rows; every present account has a verdict section opening with the DRESS REHEARSAL line; every rehearsal-input row shows a byte-identical restore and each row whose named leg did not move carries its reason; all four records pass the scan.

## Notes for later plans

- **README open item:** `docs/runbooks/mt5-parity/README.md` still names `mt5_parity_records` but not `mt5_parity_run`. It is not in this plan's `files_modified`, so it is recorded here and left for a follow-up.
- Gate A is `not_measurable:unit_mismatch` on any account that carries a native unit marker, so the real Gate A oracle in 155.2 must supply a matching unit.
- The real windows must start after each account's first mark (2026-10-26 for all three) and end before the run day.

## Known Stubs

None.

## Threat Flags

None. No new endpoint, auth path or schema; records contain labels, buckets, ordinals, dates, day counts and 3 s.f. ratios only (T-155-32 scan clean; T-155-33 DRESS REHEARSAL header and `final_green=no` present).

## Self-Check: PASSED

- FOUND: 155-DRESS-REHEARSAL.md, 155-RED-PROOF.md, 155-FINDINGS.md
- FOUND: commits `1610f343d` and `71adc20b1` on `feat/155-parityharness`

## Correction 2026-11-14 (code review round 3)

The counts above are the plan-11 run. Review round 3 found that the findings rule treated a `short` figure gate like `withheld` and skipped CAGR and Sharpe comparisons on accounts under a year of record. `src/lib/figure-gate.ts` says the short window never withholds a figure, so the rule now exempts only `withheld` (commit 58f3d6d21). Re-run on the same sealed real capture, `155-FINDINGS.md` now carries 29 findings (F-155-01 to F-155-29): the 18 above, renumbered, plus 11 Sharpe/CAGR surface disagreements that the skip had hidden. The observations are unchanged. The "F-155-NN" ids cited in the paragraphs above refer to the old numbering.
