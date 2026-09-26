---
phase: 168-drboptions-a-deribit-options-account-can-be-ingested-end-to
verified: 2026-09-26T16:30:00Z
status: human_needed
score: 12/13 must-haves verified
verified_at_sha: 4d21597a3f9de645eb15ed5769e0841b326b5152
drift_subjects:
  - analytics-service/services/deribit_txn.py
  - analytics-service/services/deribit_ingest.py
  - analytics-service/services/job_worker.py
  - analytics-service/services/stitch_composite.py
  - analytics-service/scripts/deribit_acceptance.py
  - analytics-service/docs/deribit-ingestion-design.md
  - analytics-service/docs/evidence/drb-assignment-census-2026-09.json
  - analytics-service/tests/test_deribit_assignment.py
  - analytics-service/tests/test_deribit_unclassified_evidence.py
  - analytics-service/tests/test_deribit_txn.py
  - analytics-service/tests/test_deribit_acceptance.py
  - analytics-service/tests/test_mtm_single_key.py
  - analytics-service/tests/test_smoothed_mtm_core.py
  - src/app/factsheet/[id]/v2/basis-context.tsx
  - src/app/factsheet/[id]/v2/basis-context.test.tsx
behavior_unverified: 0
overrides_applied: 0
known_limits:
  - id: WR-01 (168-REVIEW-R2.md)
    severity: warning
    summary: "A malformed expiry timestamp fails the job. An option expiry row whose timestamp cannot be parsed makes replay_option_positions raise a bare ValueError, not LedgerValuationError. It escapes the smoothed pass's structural catch, is retried as transient, and ends failed_final, so the healthy cash headline does not ship. Reproduced by the verifier at this sha with a synthetic timestamp=None expiry row: ValueError. Reachable only when SMOOTHED_MTM_ENABLED is on and the venue sends an undatable expiry row."
  - id: LR-01 (168-REVIEW-R2.md)
    severity: low
    summary: "A whitespace-padded assignment instrument name passes the guard as an option but is unknown elsewhere, so the twins can still disagree."
  - id: LR-02 / SFH-R2-02
    severity: low
    summary: "The smoothed replay keys the option book on the raw instrument_name, so a case or padding variant splits one position, and a variant-named expiry closes a phantom instrument."
  - id: LR-03 / SFH-R2-03
    severity: low
    summary: "A non-numeric option commission is still stamped with the summary-coverage reason; only an absent one gets mtm_option_row_field_missing."
  - id: SFH-R2-01
    severity: low
    summary: "A case-variant or padded exercise type skips the D-09 refusal, and a case-variant expiry does not close."
  - id: SFH-R2-04
    severity: low
    summary: "The mixed stamped/unstamped rule (keep the stricter batch-wide check) has no pinning test."
  - id: IN-01..IN-08 (168-REVIEW-R2.md) and the INFO items of 168-REVIEW-SFH-R2.md
    severity: info
    summary: "Recorded, not fixed. IN-01: the WR-02 scope stamp cannot run in production today (one scope per crawl). IN-05: the new factsheet copy says 'fee or position', but only a missing fee can stamp that reason. IN-08: a docstring still says the replay has no production caller."
human_verification:
  - test: "Plan 168-03, founder post-deploy retry. Step 1: confirm the analytics service is deployed at the merge commit of this phase (deploy check). Step 2: retry the Deribit options strategy whose stitch job failed on 2026-09-23 on the assignment refusal. Step 3: report counts only: terminal status, return-point count, and the class of any refusal by type (unknown-type exercise/expiry, D-02 contested, windowed-crawl, non-option, missing field, or a D-09 expiry-shape/exercise refusal). No job id, account, strategy name, instrument or change value."
    expected: "The job completes, no assignment refusal appears, and the return-point count is nonzero. Any other refusal class goes to its own phase via /gsd-phase --insert, not a fix here."
    why_human: "Agents may not read Deribit, PROD or the production log. Only a production retry proves an account ingests end to end. Note: the smoothed pass runs only when SMOOTHED_MTM_ENABLED is on, and its production value was not measured, so the retry may not exercise the D-09 expiry close."
  - test: "Confirm the judgment-tier prohibitions from plans 01 to 03 (the verifier's reading below is a non-authoritative LLM-judge verdict)."
    expected: "No classification by change magnitude; no position/commission default for assignment; no supabase/ path in the diff; assignment not in _NATIVE_OPTIONS_SUMMARY_TYPES; exercise/expiry not cash-bearing; _SHAPE_FIELDS gains no identifier; no agent ran the plan 03 retry."
    why_human: "Judgment-tier prohibitions need explicit human resolution in interactive verification."
---

# Phase 168: DRBOPTIONS Verification Report

**Phase Goal:** A Deribit options account can be ingested end to end. `assignment` is classified against the captured row census, so the realized-cash series is neither silently dropped nor double-counted.
**Verified:** 2026-09-26
**Status:** human_needed
**Re-verification:** No, initial verification

The ROADMAP entry for Phase 168 has a goal but no numbered success criteria. The must-haves are the
roadmap goal plus the plan 01, 02 and 03 frontmatter truths and the D-09 scope amendment. They are
grouped below by concern.

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | D-01: in the census shape, `assignment` is cash-bearing on both twins, is summed once, and the balance identity closes, end to end through `build_deribit_native_ledger` | VERIFIED | `CASH_BEARING_TYPES` holds `assignment`, and its comment cites the evidence file and marks the relabel reading as an assumption. `test_census_shape_ingests_end_to_end_through_the_native_ledger`, `test_census_shape_is_summed_once_on_both_twins_and_the_identity_closes` and `test_a_lone_census_shape_assignment_is_summed_on_both_twins` pass |
| 2 | D-02: a same-instrument delivery, settlement or second assignment contests; an unnamed or non-option instrument refuses; both twins raise `LedgerValuationError` with a unique module-constant phrase | VERIFIED | `assert_assignment_uncontested` is called in both twins. `_ASSIGNMENT_CONTESTED_PHRASE`, `_ASSIGNMENT_UNNAMED_PHRASE` and `_ASSIGNMENT_NON_OPTION_PHRASE` are imported by the tests. Round-1 fixes widened the contested phrase to include a second assignment (SFH-02) and added the non-option refusal (WR-01/SFH-01). The tests import the constant, so the change is safe |
| 3 | D-02: the verdict and sums do not depend on row order; zero-change assignments are still guarded (no magnitude rule) | VERIFIED | `test_order_independent_refusal`, `test_order_independent_sums` and `test_zero_change_assignment_is_still_guarded` pass |
| 4 | D-02 amended: a windowed crawl holding an assignment refuses before the index fetch and before the USD twin | VERIFIED | `_crawl_deribit_ledger` in `deribit_ingest.py` raises "assignment classification requires a full-history crawl" right after pagination and before `if ccy_upper in indexable:`. `test_windowed_refuses_an_assignment` and `test_windowed_refuses_before_the_usd_twin` pass |
| 5 | D-03: the evidence file holds counts only | VERIFIED | The file parses: census delivery 0, settlement 0, trade 1, n 1, put, close buy, and `change_nonzero` as a boolean. It has no change value, instrument, job, account or strategy. Pinned by the evidence test |
| 6 | D-04/D-07 structural: `_OPTION_EXPIRY_TYPES` and `_OPTION_BOOK_EVENT_TYPES` exist, with import-time assert ⊆ `CASH_BEARING_TYPES`. `assignment` is not in `_NATIVE_OPTIONS_SUMMARY_TYPES`. `exercise`/`expiry` are not cash-bearing | VERIFIED | Symbols read at `deribit_txn.py`. `_NATIVE_OPTIONS_SUMMARY_TYPES` = {options_settlement_summary} |
| 7 | D-07 per-site pins (sites 1–6), the mark_to_market end-to-end run with `combine_native_ledger`, and the smoothed_mtm assigned-short run ending with a flat book | VERIFIED | The per-site tests pass in the full suite (e.g. `test_site4_replay_zeroes_the_assigned_short`, `test_smoothed_e2e_short_put_assigned_ingests_flat`). The SUMMARYs record one-site-revert RED runs |
| 8 | D-04 seventh literal: `check_perp_only_eligibility` reads `_OPTION_BOOK_EVENT_TYPES` | VERIFIED | `scripts/deribit_acceptance.py` imports and uses the symbol. `test_deribit_acceptance.py` passes |
| 9 | `_SIBLING_TYPES` adds `assignment`; `_SHAPE_FIELDS` adds only `commission`/`position` | VERIFIED | Both tuples read. No identifier field was added |
| 10 | Prose sweep, including a dated CORRECTED note above `_SHAPE_FIELDS` | VERIFIED | The CORRECTED 2026-09-26 note is present. `deribit-ingestion-design.md` names assignment 16 times |
| 11 | D-09 (founder D6): the smoothed replay closes an option at a zero-cash `expiry`, and refuses an expiry with cash or a nonzero position, and any option `exercise`. Neither type becomes cash-bearing | VERIFIED | `_OPTION_BOOK_CLOSE_TYPES`, `_expiry_close`, the exercise refusal and the import assert (close set ∩ cash set = ∅) are all present. The 5 `test_d09_*` tests pass. **Verifier neuter:** emptying `_OPTION_BOOK_CLOSE_TYPES` on a byte backup made `test_d09_replay_closes_an_otm_short_at_its_expiry_row` and `test_d09_smoothed_e2e_otm_expiry_then_later_activity_ingests` go RED (2 failed). The file was restored and `cmp`-verified, and the tree was clean after |
| 12 | SFH-04 under D6: a missing option commission or position degrades MTM under its own reason, and the factsheet shows its own copy | VERIFIED | The `OptionRowFieldMissingError` → `MTM_REASON_OPTION_ROW_FIELD` branch is in `run_derive_broker_dailies_job`. The `mtm_option_row_field_missing` case is in `mtmDisabledReasonCopy`, with steady tone. vitest passes 17/17 |
| 13 | D-06/D-08, production: a Deribit options account is observed to ingest end to end (the TODOS close condition) | ? HUMAN (insufficient_spec, backstop) | This is plan 03, founder-owned and post-deploy. No agent may observe it, and no result is fabricated here |

**Score:** 12/13 truths verified (0 present-but-behavior-unverified; 1 routed to the founder)

Backstop truths accepted as limits (not scored):
- A crawl racing an expiry can see the assignment before a sibling that is written later. The next recompute refuses loudly.
- The native-twin false positive across subaccounts is mitigated by the WR-02 scope stamp. That stamp is inert in production today (IN-01).

### Required Artifacts

| Artifact | Status | Details |
|----------|--------|---------|
| `analytics-service/docs/evidence/drb-assignment-census-2026-09.json` | VERIFIED | Contains `same_instrument_sibling_census`; loaded by the tests |
| `analytics-service/services/deribit_txn.py` | VERIFIED | `def assert_assignment_uncontested` is called at both twin gate positions |
| `analytics-service/services/deribit_ingest.py` | VERIFIED | Windowed-crawl backstop and `ROW_SCOPE_KEY` stamp |
| `analytics-service/tests/test_deribit_assignment.py` | VERIFIED | 40 tests; the full file is green |
| `analytics-service/docs/deribit-ingestion-design.md` | VERIFIED | Names assignment and its census licence |

### Key Link Verification

| From | To | Via | Status |
|------|----|-----|--------|
| deribit_txn.py | both twins | `assert_assignment_uncontested(row, rows)` | WIRED (2 call sites) |
| deribit_ingest.py | USD twin | backstop before `txn_rows_to_daily_records` | WIRED |
| test_deribit_assignment.py | evidence json | path to docs/evidence | WIRED |
| deribit_acceptance.py | `_OPTION_BOOK_EVENT_TYPES` | membership test | WIRED |
| job_worker smoothed/MTM pass | stitch_composite reason vocab | `MTM_REASON_OPTION_ROW_FIELD` | WIRED |
| reason string | factsheet | `mtmDisabledReasonCopy` case | WIRED |

### Gates re-run by the verifier at 4d21597a3

| Gate | Result |
|------|--------|
| Full analytics-service pytest (from `analytics-service/`, TEST env vars unset) | 6427 passed, 90 skipped, 0 failed, exit 0 |
| `mypy --strict services/ routers/ models/` | Success: no issues found in 96 source files |
| vitest `src/app/factsheet/[id]/v2/basis-context.test.tsx` | 1 file, 17 passed |
| D-09 neuter → RED → restore | 2 failed under the neuter; restored, `cmp` equal, clean tree |
| WR-01 reproduction (synthetic expiry row, `timestamp=None`) | `replay_option_positions` raises bare `ValueError`, not `LedgerValuationError`. The known limit is confirmed |

### Requirements Coverage

| Requirement | Plans | Status | Evidence |
|-------------|-------|--------|----------|
| DERIBIT-ASSIGNMENT-UNCLASSIFIED | 168-01, 168-02, 168-03 | Code SATISFIED; close condition NEEDS HUMAN | Truths 1–12 hold in code. The TODOS close condition (observed in production) is plan 03 |

### Prohibitions (judgment tier, non-authoritative LLM-judge reading, flagged for human review)

| Prohibition | Reading |
|-------------|---------|
| No classification by change magnitude; evidence carries a boolean only | Holds. The evidence has `change_nonzero: true` and no value |
| No position/commission default for assignment | Holds. No added `.get("position", …)` or `.get("commission", …)` in the service diff |
| No `supabase/` path in the phase diff | Holds. 0 paths against the merge base |
| `assignment` not in `_NATIVE_OPTIONS_SUMMARY_TYPES`; exercise/expiry not classified as cash | Holds |
| `_SHAPE_FIELDS` gains no identifier | Holds. Only commission and position were added |
| No agent performs the plan 03 retry | Holds so far. Plan 03 has no SUMMARY; this verifier touched no PROD, Deribit or Railway |

### Anti-Patterns Found

No unreferenced TBD, FIXME or XXX marker was added in the service diff. The round-2 findings are the
known limits in frontmatter. By founder rule, they stay recorded and unfixed, because no fix round
runs without a HIGH or CRITICAL finding (round 2 had 0 critical, 0 high, 1 warning, and 3 + 4 low).

### Known Limits (round 2, recorded, not fixed)

- **WR-01: a malformed expiry timestamp fails the job.** An undatable `expiry` row raises a bare
  `ValueError` from `replay_option_positions`. It escapes the smoothed pass's structural
  `except (LedgerValuationError, …)` arm and is retried as transient until `failed_final`, which
  loses the cash headline. The verifier reproduced it. Reachable only with `SMOOTHED_MTM_ENABLED`
  on and a malformed venue timestamp.
- **Normalisation class:** LR-01, LR-02/SFH-R2-02 and SFH-R2-01. The round-1 `_instrument_key`
  normalisation was not carried into the replay or the type match, so padded or case-variant names
  and types are mishandled.
- **Reason stamp:** LR-03/SFH-R2-03. A non-numeric commission is still stamped with the coverage
  reason.
- **Test gap:** SFH-R2-04. The mixed stamped/unstamped rule is unpinned.
- **Info:** IN-01..IN-08, including a scope stamp that is inert in production, copy that says
  "fee or position", and stale comments and docstrings.

### Human Verification Required

1. **Plan 03 founder post-deploy retry.**
   - **Steps:** (1) Deploy check: confirm the analytics service runs at the phase's merge commit.
     (2) Retry the options strategy that failed on 2026-09-23. (3) Report counts only: terminal
     status, return-point count, and any refusal class by type.
   - **Expected:** No assignment refusal and a nonzero return-point count. Any other class is
     routed to its own phase.
   - **Caveat:** the smoothed pass is behind `SMOOTHED_MTM_ENABLED`, whose production value is
     unmeasured, so the retry may not exercise D-09 at all.
2. **Judgment-tier prohibitions.** Confirm the table above.

### Gaps Summary

There are no code gaps. Every code-level must-have from plans 01 and 02 and from the D-09 amendment
exists, is wired and passes its tests. The verifier's own gate runs are green, and the D-09 close
went RED under a neuter. The phase goal ("a Deribit options account can be ingested end to end") is
only closed by the founder's production retry (plan 03), so the status is human_needed.

---

_Verified: 2026-09-26T16:30:00Z_
_Verifier: Claude (gsd-verifier)_
