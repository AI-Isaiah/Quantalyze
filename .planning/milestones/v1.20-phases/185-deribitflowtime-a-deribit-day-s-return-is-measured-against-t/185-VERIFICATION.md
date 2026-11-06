---
status: passed
verified_at_sha: dfedac44d4a0b9937d32ad5a97e53f94840dbf38
drift_subjects:
  - analytics-service/services/job_worker.py
  - analytics-service/services/deribit_ingest.py
  - src/lib/queries.ts
  - src/lib/options-cash-basis-flag.ts
  - src/lib/factsheet/allocator-portfolio-payload.ts
  - src/app/factsheet/[id]/v2/FactsheetView.tsx
  - src/app/(dashboard)/allocations/AllocationDashboardV2.tsx
---

# Phase 185: DERIBITFLOWTIME Verification Report

**Phase Goal (ROADMAP, as corrected by D-04):** A Deribit allocator book values open options at market, so an option premium or payout no longer prints as a day of several hundred percent against the cash wallet. The mark-to-market and smoothed bases that strategies use also run in allocator (key) mode. Until that ships, the affected books say so on screen.
**Verified:** 2026-11-03
**Status:** passed
**Score:** 5/5 success criteria verified (criterion 4 and the option-day half of criteria 2 and 5 stand on founder-accepted, dated deviations: D-14, D-10, D-07)
**Re-verification:** No, initial verification

How this was judged. The code was read from `origin/main` (merge 099a9f166, PR #1187), not from this planning branch, which diverges from it. The shipped tests were run in a throwaway detached worktree at `origin/main`, which has been removed. PROD was read with the marker query alone first (it named PRODUCTION). Only aggregate counts were read; nothing was written.

## Observable Truths

| # | Truth (ROADMAP SC) | Status | Evidence |
|---|---|---|---|
| 1 | SC-1: the re-crawl settled mechanism A against B before any code change | VERIFIED | 185-01-SUMMARY records `gate: B`. The ROADMAP carries it as met (2026-11-01), and the replan (D-04) followed it. |
| 2 | SC-2: in key mode a Deribit key with option activity is computed on an options-at-market basis; the join with the first marked day counts no day twice | VERIFIED (key C on cash by D-10) | `job_worker.py` (origin/main): `_KEY_MODE_OPTIONS_BASES = (smoothed,)` at line 1127. The key-mode step at lines 5533-5690 runs only when `has_option_activity is True`. It builds the ledger from the cash crawl's retained rows (one crawl), then rebinds `native_ledger`, `returns` and `meta` before `_day_pnl_usd`, `_realized_terminal` and `_composed_flows_usd` are read, so every writer quantity reads one ledger. The CR-01 fix is present: `deribit_ingest.py:2893-2908` gives the smoothed and MTM terminal wedge the futures session RPL leg. Strategy mode keeps its `not is_key_mode` gates (lines 5764 and 5935), per D-12. PROD: keys A and B read `options_basis=smoothed_mtm`; key C read `cash` (its option replay raises `LedgerValuationError`, the failure D-10 named and accepted). |
| 3 | SC-3: until it ships, affected books carry a named caveat on screen | VERIFIED | Writer: `options_cash_basis`, `options_activity` and `options_basis` are written to `key_inputs` (`job_worker.py:8844-8855`). The caveat rule at lines 5686-5689 is `has_option_activity is True and (no basis applied or bucketed days)`. Reader: `queries.ts` (lines 4114-4164) fails toward showing (a failed read returns true when a Deribit key is drawn, and an unclassified drawn Deribit key raises it; D-13). The literal pin covers both keys. `FactsheetView.tsx:2073-2085` shows the D-09 sentence in the existing amber paragraph, with the existing warning glyph prefix, as the third arm. `AllocationDashboardV2.tsx` passes the flag through `allocator-portfolio-payload.ts`. PROD (my read): after 2026-11-02 there are 3 Deribit `key_inputs` rows carrying `options_cash_basis=true` (all `options_activity=true`, no basis) and 5 carrying `options_activity=true, options_basis=smoothed_mtm` with the cash flag absent. Under the CORRECTED 2026-11-03 (D-09) step-0 rule in 185-10-PLAN.md this is a pass. The plan's Task 2 automated check, as written, still demands `present` for every option-activity key; I judged against the corrected rule, as instructed. The founder's screen reading (`sc3-screen: shown`) is the orchestrator's record. I did not re-read the browser. |
| 4 | SC-4: PROD shows no book day above 50% attributable to cash-basis options; cumulatives reported; key C 2026-10-28 explained | VERIFIED (accepted with named days, D-14) | Independently re-read on PROD: the founder's book curve (payload computed 2026-11-03, 899 days) has 2 days above 50% and a cumulative of x3835.94, matching 185-10-SUMMARY. The days are key A 2025-07-13 and 2025-08-05, named. The previous curve had 6 such days, with a +529% day. The cumulative was reported and did not come down (x3516 to x3836). The key C 2026-10-28 reading is explained (mechanism 7, no defect) and routed to Phase 188 TINYBASE (booked in the ROADMAP). By the rule as written the criterion reads FAIL, because two class-B days remain. The founder accepted them on 2026-11-03 (D-14), as D-10 pre-named them. The ROADMAP carries the dated `CORRECTED 2026-11-03 (D-14)` note against criterion 4. I treat it as PASSED (override) on that evidence. |
| 5 | SC-5: tests go RED on today's cash basis in key mode; an uncomputable day is never invented | VERIFIED (D-07 departure recorded) | 136 Python tests pass across `test_deribit_key_mode_options_basis.py`, `test_options_cash_basis_caveat.py`, `test_deribit_options_basis_ledger.py`, `test_mtm_single_key.py`, `test_derive_determinism.py` and `test_smoothed_mtm_core.py`. 242 vitest cases pass across the literal pin, the dashboard caveat test, `queries.my-allocation` and the allocator payload. Neuter drill (mine): emptying `_KEY_MODE_OPTIONS_BASES` turned the key-mode module from green to 15 failed of 19, including the tracer, the real-assembler section-5 test and the bucketed-day tests. The test goes RED on the cash basis. An option day older than the option-price window keeps its cash-basis return, stamped and caveated, with nothing interpolated (D-07, `CORRECTED 2026-11-01 (D-07)` in the ROADMAP). |

**Behavior-dependent truths (fallback, cancellation, ordering).** The bound, floor, timeout arm, transient-retry boundary, local fallback and seam invariants each have a named test, and the review's neuter runs showed each can fail. I did not count any of them on presence alone. Behavior-unverified count: 0.

## Required Artifacts and Wiring

| Artifact | Status | Details |
|---|---|---|
| Key-mode options step, `job_worker.py` | VERIFIED | Substantive, wired into `run_derive_broker_dailies_job`. Bounded by `wait_for` at 0.7 of the remaining budget after the post-crawl reserve (WR-01). A floor refusal and a local timeout arm run ahead of the structural arm. A transient is not caught, so the dispatcher retries. |
| Options-basis assembler and wedge, `deribit_ingest.py` | VERIFIED | The CR-01 wedge fix is present. Real-assembler tests drive section 5 with nonzero futures RPL. |
| Caveat writer to reader, `key_inputs` to `queries.ts` to payload to `FactsheetView.tsx` | WIRED | The literal pin test pins the writer and reader keys. The sentence is the D-09 text. |
| Data-flow (level 4) | FLOWING | The PROD `key_inputs` rows and the book `equity_curve` row are written by the shipped worker after the cron run. Keys A and B rows are on the smoothed basis, and the curve was recomputed after the key rows. |

## Requirements Coverage

The ROADMAP lists `Requirements: TBD`; phase-local criteria SC-1 to SC-5 are the contract and are covered above. No orphaned requirement IDs.

## Anti-Patterns

No `TBD`, `FIXME` or `XXX` marker was added in the PR diff's code (`analytics-service` and `src`). No stub or placeholder in the shipped paths.

## Review Findings

185-REVIEW.md rounds 1 to 3: CR-01, WR-01, WR-02, WR-03 and WR-04 are fixed in the shipped code (confirmed by reading origin/main for CR-01, WR-01, WR-02 and the D-13 stamp). Round 3 ended clean at MEDIUM and above.

## Gaps

None blocking. Records and follow-ups for the closer, all outside the code:

1. **WARNING (records):** D-14 and the ROADMAP note send the unexplained book cumulative to TODOS entry `185-BOOK-CUMULATIVE-UNEXPLAINED`. That id is not in `TODOS.md` on `origin/main` or on the main checkout (0 hits on each), so the carry-forward is untracked until it is written. This does not affect goal achievement, since the founder chose a TODOS entry over a phase. The entry should be written before `phase complete`.
2. **WARNING (records):** the ROADMAP Phase 185 plan list still shows plans 02 to 06 and 10 unchecked, and the header says `10 plans` with no complete count, although all ten SUMMARYs exist. `phase complete` bookkeeping should tick them. Diff the ROADMAP after the handler runs, per the repo rule.
3. **INFO:** 185-10-SUMMARY has `status: checkpoint` in its frontmatter, though the checkpoint was answered (D-14). Update it to complete when closing.
4. **INFO (accepted by decision, D-13):** between the web deploy and each key's first post-deploy derive, every Deribit book showed the amber note, perp-only books included. The deploy-window screen was not read. The frozen-key census is empty.
5. **INFO (not this phase):** the founder's book cumulative (x3836) is not a cash-basis artefact. The ROADMAP records it as unexplained and routed to TODOS. Key C's tiny-base days belong to Phase 188.

## Human Verification

None outstanding. The founder's on-screen reading and the D-14 answer are already recorded.

---

_Verified: 2026-11-03_
_Verifier: Claude (gsd-verifier)_
