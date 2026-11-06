---
phase: 179-okxbillschain-the-okx-bills-chain-closes-for-a4-or-the-break
asvs_level: 1
block_on: high
audited_plans: [179-04, 179-06]
verified_at_sha: 0edb6cb71a58071b90517ceeb10fc42bc9a265df
threats_total: 11
threats_closed: 11
threats_open: 0
status: secured
---

# Phase 179 Security Audit (plans 179-04, 179-06)

Scope: `git diff 571847fa1..HEAD -- analytics-service/` (3 files: `services/okx_opening_balance.py`,
`services/okx_bills_chain.py`, `tests/test_okx_close_precision.py`). Read-only audit; no PROD, TEST or Railway access.
Verification run: pytest over the new file plus the six existing OKX oracle, chain, record, anchor and probe
test files, 471 passed (caches disabled).

## Verdict: SECURED (threats_open 0), with one routed residual risk (SFH-179-04-01)

## Plan 179-04 threat verification

| Threat ID | Category | Severity | Disposition | Status | Evidence |
|-----------|----------|----------|-------------|--------|----------|
| T-179-17 | Tampering (data integrity), close arm | high | mitigate | CLOSED (residual below) | `close_agrees` (`okx_opening_balance.py`): residual 0 passes; precision arm only when `places >= 1` and residual <= `Decimal(5).scaleb(-(places + 1))` (half a unit, inclusive); relative arm by multiplication against `CLOSE_RESIDUAL_REL_BOUND = Decimal("1e-12")` times the larger magnitude. Interior arm still the exact `if bal != prev_bal + bal_chg:` (line 359). Opening still the oldest bill's `bal - balChg`; `cash` is not read outside the predicate. Edge pins in `test_the_close_rule_at_its_edges`, `_INTERIOR_WORLDS`, `test_the_close_bound_and_the_reason_set_are_the_decided_values`. |
| T-179-18 | Tampering, precision inferred from a venue string | medium | mitigate | CLOSED | `bal_places` counts `max(0, -exponent)` of the `_decimal`-parsed `bal` (malformed values raise `malformed_bills` before counting; a non-int exponent also raises), takes the maximum over the currency's walked bills, never reads cashBal's places, and the `places >= 1` guard denies integer prints any allowance. Pinned by `test_decimal_places_are_counted_from_the_printed_bal` and the `trailing-zeros-count`, `cash-places-never-govern`, `integer-print-no-allowance`, `positive-exponent-no-allowance`, `stripped-print-chain-governs` worlds. |
| T-179-19 | Repudiation, diagnostic arm misattributed | medium | mitigate | CLOSED | `okx_bills_chain.py`: `analyse_chain` uses `not obal.close_agrees(prev_bal, cash, places)` with `places = obal.bal_places(ordered)` over the same `ordered` group; `close_race` uses `obal.close_agrees(... report.close_places[ccy])` (2 call sites); the exact close comparisons are gone (grep: 0 hits for either old form); interior residual arithmetic untouched. `cash_moved` stays exact. Agreement tests `test_the_diagnostic_classifies_the_close_exactly_as_the_oracle`, `..._reads_interior_not_both`, `..._counts_in_matches_after`. |
| T-179-20 | Elevation of privilege, forced OKX anchor | high | mitigate | CLOSED | `services/equity_reconstruction.py` is not in the diff; the forced path still refuses `anchor_skipped_implausible` on anything but `"agreed"` (the `elif _implausible_anchor and (await _okx_forced_opening_check(...))[0] != "agreed"` branch). `test_a_close_beyond_okx_precision_still_refuses_chain_break_on_the_forced_path` asserts `anchor_opening_check == "chain_break"` and the refusal string. `_GAP_CASES` and `_UNPROVABLE_CASES` files are byte-unchanged and green. Reason set is the same six tokens; `OPENING_TOLERANCE_REL` was 0.05 at the 179-04 audit; superseded by D-08 (0.02, see plan 179-06). |
| T-179-21 | Denial of service, Decimal on extreme exponents | low | accept | CLOSED (accepted) | Accepted in the plan's own register: `scaleb` and comparisons are constant-time; page ceiling bounds the bills read. SFH confirms no new crash path (a venue `Overflow` pre-exists in `per_ccy_opening`). |
| T-179-SC | Tampering, package installs | low | accept | CLOSED (accepted) | No dependency file in the diff; no package installed. |

Mutation evidence: the SUMMARY's M1 to M13 lines were not re-run by this audit (read-only); the tests exist and pass,
and the neutering claims are the executor's, taken as unverified by me beyond the green run above.

## Residual risk, routed to the founder (not counted in threats_open)

SFH-179-04-01 (MEDIUM, data-integrity, not user-facing), re-measured here: the precision arm is loose when a
currency's bills print few places. With bills printing one place, `close_agrees(100.5, 100.54, 1)` is True (allowance
0.05 absolute, 10% on a 0.5 balance, `close_agrees(0.5, 0.54, 1)` True). A missing amount of up to half a last-place
unit can therefore pass the close as agreed. The declared T-179-17 mitigation is exactly this bound and it is present,
so the threat is closed as written. The bound is the founder's D-06 wording ("the bill's own decimal places"); narrowing
it (a places floor or a relative cap on the precision arm) is a new number and a founder decision per D-06 and the
`CLOSE_RESIDUAL_REL_BOUND` comment. Mitigating facts: the opening's value never includes the allowance (the exposure is a
weaker proof that no newer bill was missed, not a wrong opening), and a4 passes on the 1e-12 arm regardless. Orchestrator
disposition (179-04-SFH.md): routed to the founder, recommended option keep D-06 as written. No test world covers a
whole chain printing one place with a residual inside half a unit; if the founder narrows the arm, add `("100.5", "0")`
against cash `100.54`.

Minor gaps recorded, not blocking: all `_CLOSE_WORLDS` are single-currency USDT, so cross-currency isolation of
`places` rests on the per-currency grouping rather than a test.

## Regression check on plans 179-01 to 179-03

| Register | Result |
|----------|--------|
| 179-01 (T-179-01 to T-179-06) | Not regressed. `scripts/okx_chain_record.py`, `scripts/allocator_history_probe.py` and their tests are byte-unchanged since the plan base. `close_places` is a new `ChainReport` field only; it appears nowhere in the record script, so no new emitted key. The only non-test change to the GET-only modules adds no write, POST, table or logging line (added-line scan empty). |
| 179-02 (T-179-07 to T-179-11) | Not regressed. No change to budgets, ceilings, token mapping or the repeat-walk path; `repeat_chain_verdict` follows `per_ccy_opening` unchanged. |
| 179-03 (T-179-12 to T-179-16) | Not regressed. Operator-run plan; the fix chosen matches the decision it recorded (no new reason token, tolerance unchanged). No tracked-text leak in the 179-04 files audited (no home path, uuid or ten-digit run). |

## Plan 179-05 operator threats (stated, not yet executable)

Not verified as implemented (179-05 has not run). Verified as stated in `179-05-PLAN.md` `<threat_model>`:
T-179-22 (worker restored before analysis, `worker-restored: yes` gated), T-179-23 (information disclosure: only
rebuilt `{"` records, uuid and ten-digit-run gates, scratch deleted, no home path), T-179-25 (read-only: no enqueue, no
SQL, no PROD write, `rebuilds-enqueued: 0` gated), T-179-24 (deploy-mismatch byte-equal import check with the D-06
constants), T-179-26 (anchor requires `opening_check=measured`), T-179-27 (tolerance decision follows the recorded rule,
founder decides). Re-audit when 179-05 executes: confirm the redaction gates fired on the actual SUMMARY and TODOS lines.

## Plan 179-06 threat verification (D-08, OPENING_TOLERANCE_REL 0.02)

Scope: `git diff 9139887cc..f126657f8 -- analytics-service/` (4 files: `services/okx_opening_balance.py`,
`tests/test_okx_close_precision.py`, `tests/test_okx_opening_balance.py`, new `tests/test_okx_opening_tolerance.py`).
Read-only audit; no PROD, TEST or Railway access. Verification run: the four related OKX test files, 111 passed (cache
disabled). Independent scratchpad mutation of the module attribute: 0.05 gives 10 RED, 0.01 gives 4 RED, 0.02 gives 83 passed.

| Threat ID | Category | Severity | Disposition | Status | Evidence |
|-----------|----------|----------|-------------|--------|----------|
| T-179-28 | Tampering (data integrity), tolerance drift | high | mitigate | CLOSED | `okx_opening_balance.py:127` is `0.02`, comment cites D-08. Pins `test_okx_opening_balance.py:622` and `test_okx_close_precision.py:188` assert `== 0.02`. Auditor mutation at 0.05: 10 RED (both forced-job 3% refusals, six band cases, both pins); at 0.02: 83 passed. |
| T-179-29 | Elevation of privilege (data integrity), forced anchor on an unsupported opening | high | mitigate | CLOSED | `equity_reconstruction.py` not in the diff; forced path still refuses `anchor_skipped_implausible` on anything but `agreed`; `opening_agrees` body unchanged, only the constant line changed outside comments. 3%-above and 3%-below forced-job tests assert `disagreed` and residual -0.03/+0.03 through `_refusal_audit`. |
| T-179-30 | Denial of service (data integrity), a4 refused by an over-tight value | medium | mitigate | CLOSED | `test_a4s_measured_residual_agrees_at_the_decided_tolerance` and `test_a_forced_okx_rebuild_with_a4s_residual_anchors` pass at 0.02; mutation at 0.01 turns both RED. Deployed re-read of a4 belongs to plan 179-07 (pending). |
| T-179-31 | Tampering, stale reader of the old value | medium | mitigate | CLOSED | Only production reader is `opening_agrees` (module global, read at call time), only caller `equity_reconstruction.py:4077`; no imported copy; no test asserts the old value; 111 passed over the four related files. |
| T-179-SC | Tampering, package installs | low | accept | CLOSED (accepted) | No dependency file in the diff. |

Residual, not counted in threats_open: only one OKX account is measured, so an account whose opening is 2% to 5% off now
refuses permanently (fail closed, audited with residual). Founder's recorded D-08 choice, tracked as
`172-OKX-OPENING-TOLERANCE-ONE-ACCOUNT`.

## Plan 179-07 operator threats (stated, not yet executable)

Not verified as implemented (179-07 has not run): T-179-32 (high, backfill worker command restored before analysis),
T-179-33 (medium, redaction gates on SUMMARY and TODOS), T-179-34 (medium, deployed import line must end
` 0.02 1E-12 True False`), T-179-35 (medium, no enqueue, SQL or PROD write; `rebuilds-enqueued: 0`), T-179-36 (high,
anchored a4 stands only with `opening_check=measured` and a small absolute residual). Re-audit when 179-07 executes.
Plan 179-05 has since run (see 179-05-SUMMARY.md: SC3_RUN_OK, TOLERANCE_OK, TODOS_OK); its operator threats were gated
by those verify blocks.

## Unregistered flags

179-06: none. 179-04: None. 179-04-SUMMARY.md `## Threat Flags` reads "None" and its 13 mutation lines (M1 to M13) are present; SFH-179-04-01 is the only new
item and it maps to T-179-17.

**threats_open:** 0
