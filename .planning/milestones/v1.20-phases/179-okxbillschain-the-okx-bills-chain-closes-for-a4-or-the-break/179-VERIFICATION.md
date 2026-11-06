---
status: passed
verified_at_sha: fb75fef806aa27ee470d449c7b6a72c14fa86cb6
drift_subjects:
  - analytics-service/services/okx_opening_balance.py
  - analytics-service/services/okx_bills_chain.py
  - analytics-service/tests/test_okx_opening_tolerance.py
  - analytics-service/tests/test_okx_opening_balance.py
  - analytics-service/tests/test_okx_close_precision.py
  - analytics-service/tests/test_okx_anchor_rule.py
---

# Phase 179 OKXBILLSCHAIN Verification Report

**Phase Goal:** Find why the OKX bills-archive running balance does not close for a4 (`chain_break` over 1489 bills), fix the reading or name the break, then re-decide the 0.05 opening tolerance on a complete walk, before any OKX history rebuild.
**Verified:** 2026-10-28 (worktree branch feat/179-okxbillschain, HEAD as in frontmatter)
**Status:** passed (updated 2026-10-29: SC-3's re-read on the deployed 0.02, plan 179-07, is recorded; see "Post-deploy update" below). The text below is the 2026-10-28 reading and is kept as lineage.
**Re-verification:** Yes, after plans 179-05 (operator SC-3 re-read, recorded) and 179-06 (`OPENING_TOLERANCE_REL` 0.05 to 0.02, founder decision D-08). Plan 179-07 was not executed and was not run by this verification.

## Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| SC-1 | A read-only measurement names which arm of `chain_break` fires for a4, and which currency and bill kind | VERIFIED (carried, regression-checked) | Unchanged since the prior report: 179-03-SUMMARY records the deployed `chain-reading:` (close arm, stable worst currency, no interior break over 1489 links, residual bucket below 1e-12). The measurement code is present; the import check at HEAD prints 59 chain record keys; the chain and record tests pass (461 passed across the phase files, below). |
| SC-2 | Cause fixed in the oracle with a test RED on the old reading; a4 never anchors on an unproven opening (D-07) | VERIFIED (carried, regression-checked) | Import check at HEAD: `close_agrees` present, `bal_places` absent, `CLOSE_RESIDUAL_REL_BOUND` is 1E-12. 179-06 touched none of `equity_reconstruction.py`, `scripts/`, `supabase/` or `src/` (empty diff against the pre-06 base), so the forced path still refuses `anchor_skipped_implausible` on anything but `agreed`. The close-precision tests (28 cases) pass. The mutation proof recorded in the prior report (0.05 absolute allowance in `close_agrees`: 8 RED) is not re-run: 179-06 did not edit `close_agrees` or the chain code, and the file's tests are green at HEAD. |
| SC-3 | After deploy the probe re-reads a4: `opening_check` is `measured` with a residual or the refusal is named, and the 0.05 tolerance is kept or re-set by the founder on that reading | VERIFIED for the decision and the code; the re-read on the re-set value is PENDING (human) | The re-read happened on the deployed close fix (179-05-SUMMARY): `opening_check=measured`, `opening_unavailable_reason=none`, `opening_residual_over_anchor=-0.0136`, `bills_read=1490`, a4 anchored. The founder re-set the tolerance (D-08, "Tighten to 2%", against the recommendation to keep 5%), recorded in 179-CONTEXT D-08 and ROADMAP Phase 179. The re-set is in code at HEAD (below) and not deployed. 179-07 (re-read on the deployed 0.02) has a PLAN and no SUMMARY, as required; it is the human item below. |

**Score:** 3/3 truths verified in the repository (SC-3's decision and code half); 0 gaps; 0 behavior-unverified truths; 1 outstanding operator item (plan 179-07).

### SC-3 and D-08 in code (checked at HEAD, not from the SUMMARY)

- **The constant.** `OPENING_TOLERANCE_REL: Final[float] = 0.02` in `analytics-service/services/okx_opening_balance.py`. The comment block above it carries the D-08 basis: founder 2026-10-28 "Tighten to 2%", taken against the 172-05 step 9b recommendation to keep 5%, a4's reading (`opening_residual_over_anchor=-0.0136`, `bills_read=1490`), "a founder choice, not a measured calibration", one account, TODOS `172-OKX-OPENING-TOLERANCE-ONE-ACCOUNT`, and "A change is a founder decision recorded first".
- **Nothing else moved in the source.** The diff of the source file over plan 06 is the comment block and the one constant line. `OPENING_TOLERANCE_USD` (1.0), `CLOSE_RESIDUAL_REL_BOUND` (1e-12), `OPENING_UNAVAILABLE_REASONS` and the body of `opening_agrees` are byte-unchanged. `opening_agrees` reads the module global at call time, and it is the only production reader of the constant (grep of `OPENING_TOLERANCE_REL` across `analytics-service/`: the source file, plus tests only). Its one caller is the forced OKX path, which refuses anything but `agreed` (fail closed); a tighter tolerance can only turn an agreement into a refusal.
- **No stale 5% claim in code.** No analytics source, probe or chain-record file names a 5% opening tolerance (the other 5% hits are unrelated: perp contract-value divergence, unrealized-materiality ratio, and similar).
- **Pins updated.** `test_the_tolerance_is_the_measured_value` (`tests/test_okx_opening_balance.py`) asserts `== 0.02`; `test_the_close_bound_and_the_reason_set_are_the_decided_values` (`tests/test_okx_close_precision.py`) asserts `== 0.02`.
- **Anti-patterns.** No TBD, FIXME or XXX in the four subject files. No stub: the new test file drives the real forced job.

### Tests RED at 0.05, GREEN at 0.02, a4's shape still agrees (re-proven by me)

No source was edited. A pytest plugin in the scratchpad overrode the module attribute at configure time (`opening_agrees` reads the global at call time, so the override is a faithful mutation). Files run together: `test_okx_opening_tolerance.py`, `test_okx_opening_balance.py`, `test_okx_close_precision.py`, `test_okx_anchor_rule.py` (111 tests).

| Value | Result | Red set |
|-------|--------|---------|
| 0.02 (as shipped, no override) | 111 passed | none |
| 0.05 (the old value) | 10 failed, 101 passed | both forced-job refusals at 3% above and 3% below the implied opening (job ended DONE where FAILED is required); all six `opening_agrees` band cases (2.1%, 3%, 4.9%, each side); both value pins |
| 0.025 | 4 failed | the two 2.1% band cases and both pins |
| 0.01 | 6 failed | a4's unit case and a4's forced-job case (a4 would be refused), two pre-existing agreed-ratio tests in `test_okx_anchor_rule.py`, both pins |
| 0.0135 (just below a4's 0.0136) | 6 failed | the same set as 0.01 |

So the tests bite in both directions: a looser value re-opens the 2 to 5 percent band, and a value below a4's measured residual would refuse a4. a4's shape (implied 0.923, bills 0.937, residual -0.0136) agrees at 0.02 through `opening_agrees` and anchors through the forced path (`test_a4s_measured_residual_agrees_at_the_decided_tolerance`, `test_a_forced_okx_rebuild_with_a4s_residual_anchors`, both pass). Expected values in the new file are literals from fixture constants, not recomputed by the module under test, and the refusal tests assert the `disagreed` token so another refusal cannot satisfy them.

## Required Artifacts

| Artifact | Status | Details |
|----------|--------|---------|
| `analytics-service/services/okx_opening_balance.py` | VERIFIED | 0.02 with D-08 comment; close rule, floor, reasons untouched |
| `analytics-service/tests/test_okx_opening_tolerance.py` | VERIFIED | 10 cases, able to fail (table above) |
| `analytics-service/tests/test_okx_opening_balance.py`, `tests/test_okx_close_precision.py` | VERIFIED | value pins assert 0.02 and cite D-08 |
| `analytics-service/services/okx_bills_chain.py` | VERIFIED (carried) | calls `obal.close_agrees`; unchanged by 06 |

## Behavioral Spot-Checks and Gates

| Check | Command (from analytics-service/) | Result | Status |
|-------|-----------------------------------|--------|--------|
| Import check | `python3 -c 'import scripts.allocator_history_probe, services.okx_opening_balance as o, scripts.okx_chain_record as c; print(len(c.CHAIN_KEYS), o.OPENING_TOLERANCE_REL, o.CLOSE_RESIDUAL_REL_BOUND, hasattr(o,"close_agrees"), hasattr(o,"bal_places"))'` | `59 0.02 1E-12 True False` (the probe's own line therefore ends ` 0.02 1E-12 True False`, as 179-07 requires) | PASS |
| Phase test files | `python3 -m pytest -q -p no:cacheprovider` on `test_okx_close_precision`, `test_okx_opening_balance`, `test_okx_bills_chain`, `test_okx_chain_record`, `test_allocator_history_probe`, `test_okx_opening_tolerance`, `test_okx_anchor_rule` | 461 passed, 1 warning | PASS |
| CI mypy line | `mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py` | Success: no issues found in 130 source files | PASS |
| Tolerance mutation (plugin) | table above | RED at 0.05, 0.025, 0.01, 0.0135; GREEN at 0.02 | PASS |

The full analytics suite was not run (CI owns it with its coverage floor).

## Probe Execution

No probe script is declared for this phase. The deployed measurement runs were operator steps (179-03, 179-05). The re-read on the deployed 0.02 (179-07) was not run, by instruction, and is the human item below.

## Requirements Coverage

ROADMAP lists `Requirements: TBD`; the plans claim SC-2 and SC-3. SC-2 satisfied; SC-3 satisfied in decision and code, deployed re-read pending.

## Anti-Patterns

None found in the changed source and test files. The silent-failure hunt and code review of plan 06 (179-06-SFH.md, 179-06-REVIEW.md) are both clean at MEDIUM and above, and my own checks agree with their claims on the readers of the constant and on test bite.

## Human Verification Required

### 1. SC-3 re-read of a4 on the DEPLOYED 0.02 (plan 179-07, outstanding operator item)

**Test:** After plan 179-06's code is merged and deployed, with the founder's approval for a Railway run, run the read-only probe once on the backfill worker (plan 179-07 Task 1). The import check computed from the deployed commit must print a line ending ` 0.02 1E-12 True False`, and the worker's own line must equal it byte for byte; anything else is a STOP. Then record the reading and update the TODOS ledger (Tasks 2 and 3).
**Expected:** a4 reads `opening_check=measured` with an absolute `opening_residual_over_anchor` of at most 0.02 and anchors; nothing is enqueued or written. Any other outcome goes back to the founder as a decision (a code change would be a replan, D-03).
**Why human:** needs merge, deploy, a PROD read through the worker and a founder approval. The repository cannot show that the deployed value is 0.02 or that a4's residual still sits inside it on the next run.

## Notes for the orchestrator (bookkeeping, not gaps)

- The ROADMAP Phase 179 plan list still shows 179-06 unticked and the header at "5/7 plans executed"; plan 06 has its SUMMARY and its review and silent-failure hunt are clean. The orchestrator owns that tick.
- `TODOS.md` and the 179-04 review text still say 0.05 for the tolerance. Plan 179-07 Task 3 is booked to update the ledger; it is record staleness only.
- `172-OKX-OPENING-TOLERANCE-ONE-ACCOUNT` stays open by design: a4 is one data point and the 0.02 is a founder choice, not a calibration. A legitimate account between 2 and 5 percent off now refuses (fail closed, audited).
- At verification time the working tree held one uncommitted change outside this report: `179-SECURITY.md` (a security audit update for plan 06, status secured). It is not part of this verdict.

## Gaps Summary

No gaps. The tolerance is 0.02 with its D-08 basis in code, the value pins and the new band tests are in place and shown to fail at 0.05 and below a4's residual, a4's measured shape still agrees and anchors, the forced path is untouched and still fails closed, and the CI mypy line is clean. The phase is not complete until plan 179-07 re-reads a4 on the deployed value, so the verdict is human_needed.

## Post-deploy update (2026-10-29, plan 179-07)

Updated by hand, not by a verifier re-run. Every success criterion is now met by a recorded reading:

- **SC-1**: unchanged (179-03-SUMMARY).
- **SC-2**: unchanged; the deployed import check still shows `close_agrees` present and `bal_places` absent (179-07-SUMMARY, `import-check:`).
- **SC-3**: the outstanding item above is resolved. The deployed commit carries 0.02 (`import-check-expected:` equals `import-check:`, both `0 59 6 16 0.02 1E-12 True False`), and the read-only probe re-read a4 on it: `sc3-deployed: a4 anchored (opening_check=measured residual=-0.0138)`, inside 0.02, `member_refusal` none, `rebuilds-enqueued: 0`, `worker-restored: yes`. The decision half rests on 179-05 and the founder's D-08 answer; the deployed half on 179-07.

The TODOS ledger now carries the 0.02 deployed reading under both entries Phase 179 measured (`172-OKX-OPENING-TOLERANCE-ONE-ACCOUNT` stays open, one account; `167.2.1.1.2.1-OKX-ANCHOR-IMPLAUSIBLE` stays closed). No gaps.

---

_Verified: 2026-10-28_
_Verifier: Claude (gsd-verifier)_
