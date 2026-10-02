---
phase: 139-mt5golive-gateway-soak-flip
reviewed: 2026-07-24T00:30:33Z
depth: standard
files_reviewed: 2
files_reviewed_list:
  - analytics-service/scripts/mt5_soak.py
  - analytics-service/tests/test_mt5_soak.py
findings:
  critical: 1
  warning: 1
  info: 1
  total: 3
status: fixed
resolved_at: 2026-07-24
resolution:
  CR-01: fixed (34acaf73) — exit-0 gate now requires read_only_proof verdict == "GO"
  WR-01: fixed (34acaf73) — fidelity reconstructed-vs-balance; uPnL wedge gated separately at UNREALIZED_MATERIALITY_RATIO
  IN-01: fixed (133e3e6f) — "login" added to sanitize _MASK_KEYS + regression tests
---

# Phase 139: Code Review Report

**Reviewed:** 2026-07-24T00:30:33Z
**Depth:** standard
**Files Reviewed:** 2
**Status:** issues_found

## Summary

Reviewed the Phase-139 soak/parity runner (`mt5_soak.py`) and its offline test. The
runner is trust-critical: its exit code is the founder's go/no-go gate before the
`MT5_ENABLED` flip. I traced the composed dependencies (`combine_mt5_deal_ledger`,
`reconstruct_nav_and_twr`, `run_spike`, and the `sanitize_evidence`/`assert_sanitized`
primitives) to verify verdict correctness rather than accept the docstring claims.

Confirmed-correct (not defects):
- The forward-roll `initial = balance − Σtrading_pnl − Σflows` is the exact NAV_0 of
  the flow-in-numerator recursion `NAV_t = NAV_{t-1} + pnl_t + F_t`, so the
  reconstruction reproduces **balance** exactly and is genuinely balance-anchored, not
  the vacuous equity-anchored identity. The `combine` core terminates its return series
  at `anchor_nav − open_unrealized_usd == balance` (nav_twr.py:836), confirming this.
- External-flow days are unioned into the return index by `_union_flow_days`
  (nav_twr.py:828) with `r_t = 0`, so the runner's NaN-drop filter does not silently
  drop a flow — the `initial` subtraction and the forward-roll re-add stay balanced.
- The empty/error/unclassifiable paths behave as claimed: `parity_ok=None` on both
  `honest_empty` and `error`, `Mt5DealClassificationError` propagates, and `main()`
  exits non-zero on each. Login literal does **not** leak into the written record
  (verified by generating a record and grepping).

Two real verdict-correctness defects remain, one of them a false-GREEN on the go-live
gate. Both were verified by executing the runner, not by inspection alone.

## Critical Issues

### CR-01: Exit-0 go-live gate accepts an INCONCLUSIVE spike verdict — false-green on the unconfirmed read-only premise

**STATUS: FIXED (commit 34acaf73).** `main()` now reads
`report["read_only_proof"]["verdict"]` and exits 0 only when it is `"GO"` (in
addition to `parity_ok is True` and `spike_verdict != "NO-GO"`). Before/after
evidence: a trade-ENABLED account (`trade_allowed=True`) with clean parity had
`read_only_proof.verdict == "INCONCLUSIVE"`, `overall.verdict == "INCONCLUSIVE"`
(≠ NO-GO), `parity_ok == True` → BEFORE exit0=True (green-lit), AFTER exit0=False.
Regression: `test_trade_enabled_account_exits_nonzero` (reds against the
`!= "NO-GO"` gate).

**File:** `analytics-service/scripts/mt5_soak.py:402`
**Issue:**
The PASS gate is `if parity.get("parity_ok") is True and spike_verdict != "NO-GO": return 0`.
`run_spike` produces exactly three verdicts — `GO`, `NO-GO`, `INCONCLUSIVE`
(`mt5_spike.py:348-362`). The read-only-proof leg returns **`INCONCLUSIVE`, not
`NO-GO`, whenever `trade_allowed` is not `False`** — including the case where the
account came back **trade-enabled** (`mt5_spike.py:245`:
`leg["verdict"] = "GO" if trade_allowed is False else "INCONCLUSIVE"`).

Because the gate only excludes `NO-GO`, an account whose read-only investor-login
premise was never positively confirmed still exits 0. The entire security premise of
this integration is a read-only investor login; the gate that is supposed to enforce it
green-lights the exact case it exists to catch.

Verified empirically — a fake account with `trade_allowed=True` and clean parity:
```
CASE A (trade_allowed=True, parity clean) exit code = 0
verdict in record: INCONCLUSIVE
```
The founder's `echo "exit=$?"` gate would read this as "go."

**Fix:** Require a positive spike verdict, not merely "not NO-GO." Prefer gating on the
security-critical leg so a benign `[ASSUMED]` server-time-offset INCONCLUSIVE does not
block:
```python
parity = report.get("parity", {})
spike_verdict = report.get("verdict")
read_only = report.get("read_only_proof", {}).get("verdict")
# Exit 0 ONLY on a genuine PASS: parity within tolerance, no NO-GO leg, AND the
# read-only premise POSITIVELY proven (trade_allowed is False), never merely
# "not disproven".
if (
    parity.get("parity_ok") is True
    and spike_verdict != "NO-GO"
    and read_only == "GO"
):
    return 0
return 1
```
Add a regression test: `trade_allowed=True` + clean parity must exit non-zero.

## Warnings

### WR-01: Parity PASS silently requires a near-flat account; a correctly-reconstructed account holding open positions yields a false FAIL

**STATUS: FIXED (commit 34acaf73).** `reconcile_parity` now computes fidelity as
`recon_ok = |reconstructed − balance| <= max($1, 1e-6·|balance|)` and gates the
uPnL wedge `equity − balance` separately at `UNREALIZED_MATERIALITY_RATIO` (5%,
`|wedge|/equity` on a non-dust anchor — the exact nav_twr.py:868 rule);
`parity_ok = recon_ok AND wedge-within-materiality`. Both `recon_residual` and
`upnl_wedge` are reported distinctly. Before/after evidence:
- small $2 wedge (legitimate open position, perfect fidelity): BEFORE
  parity_ok=False (false-FAIL vs equity), AFTER parity_ok=True.
- material wedge (equity 110_000 / balance 100_000, 9.09%): recon_ok=True
  (fidelity holds), AFTER parity_ok=False (never green) — reported as a wedge, not
  a fidelity breach.
Regressions: `test_small_wedge_within_materiality_passes` (+ exits_zero),
`test_material_wedge_reconstructs_but_is_not_green` (+ exits_nonzero),
`test_fidelity_gate_has_teeth_vs_balance`.

**File:** `analytics-service/scripts/mt5_soak.py:263-267`
**Issue:**
The reconstruction terminates at **balance** (correct, per CR-01 analysis), so when the
reconstruction is right the residual is `reconstructed − equity == balance − equity ==
−(uPnL wedge)`. The tolerance is only `max($1, 1e-6·|equity|)`. Therefore
`parity_ok` is `True` **iff `|equity − balance| ≤ ~$1`**, i.e. iff the account is
carrying essentially no floating uPnL at snapshot time.

Consequences on a live managed forex/CFD account (the soak target):
1. **False FAIL / blocks a correct flip.** Any open position with >$1 floating PnL at
   the daily snapshot reddens `parity_ok`. The usage note tells the founder to run
   "one run per day, EVERY run within tolerance" over 5–10 days with no instruction to
   flatten positions — an active account will essentially never pass. This is exactly
   review scenario (b): blocking a correct track record.
2. **The verdict conflates two independent quantities.** On any non-flat snapshot the
   residual mixes the *legitimate* uPnL wedge with any *actual* reconstruction error,
   so a PASS cannot certify reconstruction correctness there, and a real reconstruction
   bug could be masked by an offsetting wedge (or vice versa). The check only cleanly
   tests reconstruction when the account is flat.

The test suite only exercises `equity == balance` (wedge 0, Test 1) and a $2 wedge that
is asserted to FAIL (Test 2) — so the suite actually *encodes* "any wedge > tol ⇒ FAIL"
as intended behavior, which is precisely the false-red hazard.

Note: this is not a criticism of the balance-anchored `initial` (that is correct). The
issue is the comparison target + single tight tolerance.

**Fix:** Separate the two verdicts. Compare the reconstructed terminal against
**balance** for the reconstruction-correctness gate (this is what the realized ledger
can actually reproduce), and report/gate the uPnL wedge under its own explicit,
looser threshold so open-position exposure is surfaced without being mistaken for a
reconstruction breach:
```python
recon_residual = reconstructed - balance          # reconstruction fidelity
wedge = equity - balance                           # legitimate open-position exposure
recon_ok = abs(recon_residual) <= _parity_tolerance(balance)
# gate/flag the wedge separately (e.g. materiality ratio like nav_twr's 5%), do not
# fold it into the pass/fail of the reconstruction check.
```
At minimum, document that the soak must be run against a flat account and have `main()`
degrade a wedge-driven breach to INCONCLUSIVE rather than a hard reconstruction FAIL.

## Info

### IN-01: Secret-hygiene test omits the login from its absence assertions

**STATUS: FIXED (commit 133e3e6f).** `"login"` added to `_MASK_KEYS` in
`deribit_ground_truth.py`; `assert _LOGIN not in text` added to
`test_written_record_is_sanitized`; new `test_sanitize_masks_login_key` proves a
record embedding a `login` key is masked. (Note: `_MASK_KEYS` masks string values;
MT5 `account_info().login` is an int — the affirmative protection here covers a
string login, matching how the other account-id mask keys behave.)

**File:** `analytics-service/tests/test_mt5_soak.py:293-294`
**Issue:** The module contract states "no login/password/server in output"
(`mt5_soak.py:57` and the docstring), but Test 6 asserts only `_INVESTOR_PW not in text`
and `_SERVER not in text` — it never asserts `_LOGIN not in text`. The login does not
leak today (verified: no leg embeds the raw login; the error path redacts it via
`_redact_secret_values(..., str(login), ...)`), but the missing oracle means a future
regression that stores `account_info()` (which carries `login`) verbatim into the report
would pass this test. Note that `sanitize_evidence`'s `_MASK_KEYS`
(`deribit_ground_truth.py:342`) does **not** include `login`, so such a regression would
not be caught by sanitization either.
**Fix:** Add `assert _LOGIN not in text` to `test_written_record_is_sanitized`, and add
a fixture where `account_info()`/an error string embeds the bare login to prove it is
scrubbed.

---

_Reviewed: 2026-07-24T00:30:33Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
