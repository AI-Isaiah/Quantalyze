---
phase: 231-bybitreads-a-bybit-read-covers-every-coin-settle-type-window
plan: 06
review: W4
reviewed: 2026-11-24
depth: deep
diff: 340dcf45a..HEAD -- analytics-service
files_reviewed: 4
files_reviewed_list:
  - analytics-service/services/exchange.py
  - analytics-service/tests/test_exchange.py
  - analytics-service/tests/test_upnl_venues.py
  - analytics-service/tests/test_nav_marks_l4_read.py
findings:
  critical: 0
  high: 0
  medium: 0
  low: 2
  info: 3
  total: 5
fixed_medium: 5  # MD-01, SF-M1, SF-M2, SF-M3 (round 1), R2-M1 (round 2); open MEDIUM+ after round 3: 0
status: clean
---

# Phase 231 plan 06 (VREAD-01): code review W4

**Scope:** `fetch_bybit_stable_wallet_with_status` and the Bybit arms of `fetch_account_equity_usd`
and `fetch_account_equity_and_upnl_usd` in `analytics-service/services/exchange.py`, plus the four
test files. I traced every caller and downstream consumer: the derive in
`services/job_worker.py::run_derive_broker_dailies_job` (the combine capital base at :9192, the
realized terminal at :9327-9333, `key_inputs.anchor_usd` at :10063-10070, `build_mark_read` at
:9097-9105), `run_stitch_composite_job` (:12999, combine at :13077), `scripts/bybit_reconcile.py:651`,
`scripts/derivegaps_probe.py:842` / `_anchor_of` :1061, and `services/nav_marks.py::build_mark_read`
(the `wallet_basis_mismatch` tolerance at :363-386).

**Measured:** `python3 -m pytest tests/test_upnl_venues.py tests/test_exchange.py
tests/test_nav_marks_l4_read.py tests/test_nav_marks_bybit_uta.py
tests/test_derive_broker_dailies_dualmode.py -q` gives `473 passed`. Every census C01..C05 node id
exists and ran.

**What holds:**
- Stable membership goes through `is_stable_value(str(coin))` per coin at call time, the same
  predicate `_price_wallet_totals` uses at `services/equity_reconstruction.py:669`. The monkeypatch
  test proves it.
- A malformed or non-finite NON-stable coin is never parsed, so it cannot fail the read.
- A malformed or non-finite stable coin returns `(None, True)`.
- A `total` that is not a mapping, and a `balance` that is not a dict (`AttributeError`), both
  return `(None, True)`.
- The two entry points route Bybit to the one helper, so the 2-tuple and the 4-tuple cannot
  disagree.
- Binance and OKX are byte-unchanged, and `fetch_usdt_balance` / `fetch_usdt_balance_with_status`
  are untouched.
- The basis comparison in `build_mark_read` compares Bybit's `totalWalletBalance` (the mark's
  `marked_wallet`) against the new anchor. For a USDT-plus-USDC account the two now agree within
  the 1 USD / 0.5% tolerance.
- No consumer reads the anchor as a USDT-valued column. `api_keys.account_balance_usdt` is written
  only from `fetch_usdt_balance` and the MT5 native path. No owner-facing copy in `src/` explains
  `wallet_basis_mismatch` (0 hits).

One substantive defect follows.

## Medium

### MD-01: a negative stable balance is skipped, so a borrowed stable coin inflates the anchor, and the capital base, past the old null

**Severity:** MEDIUM (data integrity: the figure is the capital base of the stored returns and the
key's `key_inputs.anchor_usd`)

**File:** `analytics-service/services/exchange.py:3343` (`if q > 0:`), pinned by
`analytics-service/tests/test_exchange.py:5929` (arm `negative-stable-skipped`).

**Evidence (measured on this branch, not recalled):**
- A Bybit UTA payload with `USDT walletBalance "-50"` (`borrowAmount "50"`) and
  `USDC walletBalance "200"` was pushed through ccxt's real `bybit.parse_balance`
  (`tests/test_upnl_venues.py::real_bybit_parse_balance`). ccxt passes the negative straight into
  `total`: `{'USDT': -50.0, 'USDC': 200.0}`.
- `fetch_usdt_balance_with_status` on that balance returns `(None, False)`. This is the pre-change
  Bybit anchor.
- `fetch_bybit_stable_wallet_with_status` returns `(200.0, False)`. The account's stable wallet is
  150 net.

**Why it matters downstream:**
- Before the change, the derive got `equity=None`. `key_inputs` then recorded
  `anchor_null_reason="balance_error"` (`job_worker.py:10032`), and the combine ran without an
  anchor.
- It now gets 200.0. That figure is `account_balance=` for `combine_realized_and_funding`
  (`job_worker.py:9192`, and in the composite at :13077), so every stored daily return is scaled
  against a level that leaves out a 50 liability.
- It also clears the anchor ladder, because it is positive, finite and above dust, so it is
  persisted as `key_inputs.anchor_usd`.
- The mark refuses the same account as `borrow_present` (`equity_reconstruction.py:1139`). No
  stored mark therefore replaces the live figure, and nothing downstream corrects or names it.
- The overstatement equals the stable liability. On a USDC-collateral account trading USDT perps
  at a cumulative realized loss, which is the scenario this leg exists for, that liability is the
  whole loss.

**Reachability, from the repo:**
- The plan itself names the case. `231-06-PLAN.md:36` says "a negative stable balance (spot borrow)
  is skipped", and the test comment calls it a "spot borrow".
- `231-RESEARCH.md:270` names it too: "a stable coin with a negative walletBalance (spot borrow)
  must not reduce the anchor silently. (The mark already refuses `borrow_present`.)"
- `borrow_present` exists as a refusal token because Bybit reports a non-zero `borrowAmount`.

**Provenance:** skipping the negative is a plan "spec-less edge, explicit" truth (`231-06-PLAN.md:36`).
It is not a CONTEXT `[Anchor]` decision or a founder ruling. RESEARCH copied it from
`_price_wallet_totals` (`q <= 0: continue`) "to mirror the mark". Mirroring buys nothing on this
path, because the mark already refuses any borrow before it compares wallets. The anchor has no
such refusal, so the skip silently turns a borrowed account into an inflated anchor. That is
exactly the "silent" outcome RESEARCH:270 wanted to avoid, in the opposite direction.

**Minimal fix (pick one; either flips the `negative-stable-skipped` arm and amends plan truth line 36):**

(a) Recommended: net the signed stable balances. This is the arithmetic of Bybit's own
`totalWalletBalance`, which the mark compares against. On a USDT-only account it equals the old
helper: a net at or below 0 gives `(None, False)`.

```python
            if not math.isfinite(q):
                raise ValueError("stable quantity is not finite")
            stable_qtys.append(q)          # signed: a borrowed stable coin reduces the wallet
        stable_sum = math.fsum(stable_qtys)
```

The arm becomes `{"USDT": 1000.0, "USDC": -50.0}` giving `(950.0, False)`. Add an arm
`{"USDT": -50.0, "USDC": 200.0}` giving `(150.0, False)`.

(b) Conservative: any negative stable quantity means the anchor cannot be stated. Return
`(None, False)` (the old null path, the same outcome as the old helper on a negative USDT) and
log a class-only line. The arm becomes `(None, False)`.

Do not use `(None, True)` for either. A borrow is a sound read, not a failed one.

## Low

### LW-01: stale "the Bybit derive wallet is USDT-only" prose (grouped, rated per instance)

**Severity:** LOW overall. None reaches MEDIUM. Each behaviour these lines would mislead a reader
about is pinned by a test that goes RED on regression: the flipped pin, and
`test_a_stable_mixed_bybit_account_is_markable_while_binance_keeps_the_usdt_basis`. So the prose
cannot silently cause a wrong figure. It should be swept in the next touch of each file.

| file:line | text | rating |
|---|---|---|
| `analytics-service/tests/test_nav_marks_bybit_uta.py:186-188` | "The derive's own Bybit wallet figure is USDT-ONLY (``fetch_usdt_balance_with_status``)" and the param id `derive-usdt-only` (:181) | **Misleading.** It names the wrong function as the Bybit read and states a rule that is now false. The verdict stays correct only because the fixture's extra coin is BTC (`_item`, :75-86) and the figures are typed by hand. A maintainer who copies this fixture with USDC would expect a refusal that no longer happens. |
| `analytics-service/tests/test_nav_marks_l4_read.py:12-16` (module docstring) | "anchored on the USDT WALLET … book the difference (BTC, USDC, ...) … `nav_usd - open_pnl_usd == the derive's own USDT wallet`" | **Misleading.** The stated invariant and the USDC example are false for Bybit, and the new test in the same file (:927) contradicts them. |
| `analytics-service/tests/test_nav_marks_l4_read.py:908` | "The real derive-side wallet read is a USDT-only read over the same venue" | **Misleading.** It is false for Bybit, and the `bybit` parametrization of the test it sits in runs the new helper. |
| `analytics-service/tests/test_nav_marks_l4_read.py:869` | `_dry_run_one_key`: "the derive's own USDT wallet read" | Cosmetic. It is a helper description, and the variable name carries the same wording. |
| `analytics-service/tests/test_nav_marks_l4_read.py:226` | `_derive`: "patched to ``derive_usdt`` (its realized USDT wallet figure …)" | Cosmetic. It describes a patched stand-in, not the real read. |
| `analytics-service/tests/test_nav_marks_bybit_uta.py:247, :473-476` | "the derive's wallet is USDT-only (1000.0)" / "Production's wallet figure for this account is USDT-only (1000.0)" | Cosmetic. The attribution is stale, but the 1000.0 is still exactly what the new helper returns on a USDT-plus-BTC fixture. |
| `analytics-service/services/nav_marks.py:274-277` | `build_mark_read`: "``usdt_wallet_usd`` is the derive's OWN USDT wallet figure" | Cosmetic in effect, though it sits on the data-integrity gate. It is still true for Binance, the parameter name carries the same wording, and the D-04 reasoning (compare the mark's wallet against the derive's own wallet) holds for both venues. Suggested wording: "the derive's own wallet figure (Bybit: every stable coin, VREAD-01; Binance: USDT)". |
| `analytics-service/services/job_worker.py:9081` | "the derive's own USDT wallet figure (``equity`` …)" | Cosmetic, for the same reason as `nav_marks.py:275`. |
| `analytics-service/services/equity_reconstruction.py:625, :1075` | "the derive's own USDT figure / wallet" | Cosmetic, for the same reason. |
| `analytics-service/scripts/derivegaps_probe.py:1062` | `_anchor_of`: "the USDT wallet balance the equity read took" | Cosmetic. It is diagnostic tooling, and the ratio it feeds (`_stable_net` over the anchor) is now more consistent, not less. |

`services/exchange.py`'s own docstrings (:3445-3459, :3483-3490) were updated correctly. The
comments at `job_worker.py:8687-8693` and `:12993-12997` ("realized-basis walletBalance, structural
0.0") are still true.

**Minimal fix:** rewrite the three "Misleading" rows to say the Bybit derive wallet is the
stable-coin wallet sum (`fetch_bybit_stable_wallet_with_status`, VREAD-01) and Binance's is USDT.
Optionally rename the param id `derive-usdt-only` to `derive-stable-only`.

### LW-02: the malformed-stable log line carries the venue's raw quantity text

**Severity:** LOW. It is a pre-existing pattern, now widened from USDT to every stable coin.

**File:** `analytics-service/services/exchange.py:3348-3351`

**Evidence:** for `total={"USDT": 1000.0, "USDC": "1,250.75"}` the helper logs
`ERROR Malformed balance response shape: exc_class=ValueError scrubbed=could not convert string to float: '1,250.75'`.
`scrub_freeform_string` redacts secrets, not numbers, so a garbled amount reaches the log. That is
against the repo's rule at `equity_reconstruction.py:690-692` ("never a coin symbol or an amount in
a log line"). The arms test docstring promises a "class-only" log but asserts only that the class is
present and the signature absent.

**Reach:** low. ccxt's `parse_balance` emits floats or `None` in `total`, so a string arrives only
from a misbehaving venue or a mock. The untouched USDT helper (:3280-3283) has the same shape.

**Minimal fix:** log the class only (`exc_class=%s`, drop `scrubbed=`) on the parse-arm `except`.
The `fetch_balance` arm keeps its scrub, because that text is ccxt's request error, not an amount.

## Info

### IN-01: `OverflowError` is not in the parse-arm `except`

`analytics-service/services/exchange.py:3347` (the `except` tuple): `float()` of an int beyond about 1.8e308, or
`math.fsum` hitting an intermediate overflow, raises `OverflowError`. That is neither `TypeError`
nor `ValueError`, so it escapes the three-state contract. It is unreachable from ccxt floats, since
a finite float total cannot overflow fsum at realistic magnitudes. Add `OverflowError` to the tuple
if the arm is touched.

### IN-02: the anchor's stable set is wider than the flow valuer's

The anchor values `STABLECOINS | STABLECOIN_SPLIT_SUFFIXES` at 1.0.
`services/ccxt_flows.py:277` and `scripts/derivegaps_probe.py::_stable_net` use `STABLECOINS`
only, so a USDE, PYUSD or USDB flow is valued from the price index, or raises
`NavReconstructionError` (a degrade). This diff does not make it newly wrong: before, USDE was out
of the anchor and in the flows; now it is in both. It is recorded because the plan's "one shared
rule" claim covers the anchor and the mark, not the flows.

### IN-03: no derive-level assertion that the combine's capital base moved

`test_a_stable_mixed_bybit_account_is_markable_while_binance_keeps_the_usdt_basis`
(`tests/test_nav_marks_l4_read.py:927`) asserts the stored mark (1225.0). It does not assert
`combine_realized_and_funding(account_balance=)` = 1200.0 on the real wallet read. The flipped pin
proves it at the function. The existing derive-level capital assertion (`:774`) still runs on a
patched 1000.0. A one-line `_args(combine).kwargs["account_balance"] == 1200.0` in the new test
would pin the consumer, not only the producer.

---

_Reviewer: Claude (gsd-code-reviewer), depth deep. Read-only: no source file was modified and
nothing was committed._

## Silent-failure hunter (parallel pass, same diff)

Three MEDIUM, no CRITICAL or HIGH. All routed to the round-1 fixer (data integrity).

- **SF-M1 (MEDIUM).** `exchange.py` helper: a stable coin whose quantity is `None` is skipped silently. If every stable coin present is `None`, the read returns `(None, False)` ("drained") instead of `(None, True)`, and the derive falls back to heuristic capital with no `balance_error`. `_price_wallet_totals` skips `None` the same way, so the mark cross-check cannot catch it. Fix: when stable coins are present but none parses to a number, return `(None, True)`; log a WARNING naming each skipped coin.
- **SF-M2 (MEDIUM).** `balance.get("total", {})` turns an ABSENT `total` key into `{}` and reads `(None, False)`. A missing key is a schema change, not an empty wallet. Fix: no default, so `None` fails the existing Mapping check and returns `(None, True)`; an empty `{}` still reads `(None, False)`.
- **SF-M3 (MEDIUM, low end).** The malformed-quantity ERROR log does not name the coin. Fix: name the coin code (a public ticker) in the raised message, without the raw value (see LW-02).

Left alone, per the hunter: `except Exception` around `fetch_balance` (matches the sibling; cancellation still propagates); `OverflowError` (loud, below MEDIUM).

## Fix status (round 1)

Fixer: gsd-code-fixer, 2026-11-24. LW and IN items were not touched (not in scope). Every neuter ran
on a byte-backed copy of the final `services/exchange.py`, restored with `cp` and confirmed with `cmp`
(`restored <id> byte-equal`). The RED and GREEN lines below are the verbatim output of
`pytest tests/test_exchange.py -k "bybit_stable_wallet_arms or borrowed_stable"`. The MD-01 commit on
its own also reads `14 passed, 203 deselected in 22.72s`.

### MD-01: fixed (option a, signed sum), commit d802f9c0d

Applied: `stable_qtys.append(q)` is unconditional, so a negative stable balance is subtracted, and a
signed sum at or below 0 stays `(None, False)`. The helper docstring now says a borrow is subtracted.
The arm `negative-stable-skipped` is flipped and renamed `negative-stable-subtracted` (USDT 1000,
USDC -50 gives 950.0). New arm `net-negative-stable-sum-is-none` (USDT -50, USDC 20 gives
`(None, False)`). New test `test_bybit_borrowed_stable_coin_is_subtracted_through_the_real_parse`
builds USDT -50 with `borrowAmount` 50 and USDC 200 through ccxt's real `bybit.parse_balance` and
asserts `(150.0, False)`. Plan truth line 36 ("a negative stable balance is skipped") is superseded by
this finding; PLAN.md was not edited.

Neuter (restore `if q > 0:` before the append):
```
== RED md01
FAILED tests/test_exchange.py::test_bybit_stable_wallet_arms[negative-stable-subtracted]
FAILED tests/test_exchange.py::test_bybit_stable_wallet_arms[net-negative-stable-sum-is-none]
FAILED tests/test_exchange.py::test_bybit_borrowed_stable_coin_is_subtracted_through_the_real_parse
3 failed, 13 passed, 203 deselected in 30.50s
restored md01 byte-equal
```

### SF-M1: fixed, commit 9c77de381

Applied: a stable coin whose quantity is `None` is collected by code; a WARNING
`Stable coin quantity is None, skipped: coins=<codes>` names them (code only). If at least one was
skipped and no stable quantity parsed, the read returns `(None, True)`. A single `None` beside a
readable stable coin stays skipped (`none-quantity-skipped` stays `(1000.0, False)`, and now also
asserts the WARNING names `coins=USDC`). New arm `every-stable-none-is-unreadable`.

Neuter (drop the `if not stable_qtys: return None, True`):
```
== RED m1
FAILED tests/test_exchange.py::test_bybit_stable_wallet_arms[every-stable-none-is-unreadable]
1 failed, 15 passed, 203 deselected in 13.39s
restored m1 byte-equal
```

### SF-M2: fixed, commit 9c77de381

Applied: `balance.get("total")` with no default, so an absent key fails the Mapping check and returns
`(None, True)` with `exc_class=TypeError`. An empty `{}` still reads `(None, False)` (arm
`empty-total` unchanged). New arm `total-key-absent`.

Neuter (`balance.get("total", {})`):
```
== RED m2
FAILED tests/test_exchange.py::test_bybit_stable_wallet_arms[total-key-absent]
1 failed, 15 passed, 203 deselected in 11.83s
restored m2 byte-equal
```

### SF-M3: fixed, commit 9c77de381

Applied: `float(qty)` is wrapped, and both the non-numeric and the non-finite cases raise
`ValueError(f"stable quantity for {coin} is unreadable")` (`from None`, so the raw value is not
chained). The arms `malformed-stable` and `non-finite-stable` now assert that text in the log, and the
test asserts `garbled` never reaches the log beside the existing `deadbeef` assertion.

Neuter (plain `float(qty)` and the old non-finite message):
```
== RED m3
FAILED tests/test_exchange.py::test_bybit_stable_wallet_arms[malformed-stable]
FAILED tests/test_exchange.py::test_bybit_stable_wallet_arms[non-finite-stable]
2 failed, 14 passed, 203 deselected in 14.38s
restored m3 byte-equal
```

### GREEN after restoring the fix
```
== GREEN
16 passed, 203 deselected in 11.16s
```

### Verification
- `pytest tests/test_exchange.py tests/test_upnl_venues.py tests/test_upnl_venues_binance.py tests/test_nav_marks_l4_read.py tests/test_nav_marks_bybit_uta.py tests/test_derive_broker_dailies_dualmode.py`: `485 passed, 54 warnings in 42.06s` (473 before, plus 12 new test nodes).
- CI mypy (`--strict --follow-imports=silent`, the CI file list): `Success: no issues found in 143 source files`.

## Round 2 review

Reviewer: Claude (gsd-code-reviewer), depth deep, 2026-11-24. Read-only: no source file was modified
and nothing was committed. Fix diff `6e87b7af3..HEAD -- analytics-service` (commits `d802f9c0d`,
`9c77de381`), read against the whole-plan diff `340dcf45a..HEAD`. The frontmatter above still
carries the round-1 counts.

**Status:** issues_found. MD-01, SF-M2 and SF-M3 are closed. SF-M1 is only partly closed (R2-M1).

**Severity counts (this round):** critical 0, high 0, medium 1, low 0, info 2.

**Measured:**
- The fixer's six-file command (`tests/test_exchange.py tests/test_upnl_venues.py
  tests/test_upnl_venues_binance.py tests/test_nav_marks_l4_read.py tests/test_nav_marks_bybit_uta.py
  tests/test_derive_broker_dailies_dualmode.py`) gives `485 passed, 54 warnings in 41.24s`.
- Every helper outcome quoted below came from running three functions on the shape named:
  `fetch_bybit_stable_wallet_with_status` at HEAD; the same function as it stood at `6e87b7af3`
  (round 1, loaded from `git show`); and the untouched `fetch_usdt_balance_with_status`, the pre-plan
  Bybit anchor.
- Every ccxt claim came from ccxt 4.5.89's real `bybit.parse_balance`, run through
  `tests/test_upnl_venues.py::real_bybit_parse_balance` with `analytics-service/.venv/bin/python`.

### Round-1 findings: closure

| id | verdict | evidence |
|---|---|---|
| MD-01 | **Closed** | `stable_qtys.append(q)` is unconditional, so the sum is signed. A borrowed USDT (walletBalance -50, borrowAmount 50) beside 200 USDC goes through the real parse as `total={'USDT': -50.0, 'USDC': 200.0}` and reads `(150.0, False)`. A net sum at or below 0 reads `(None, False)`, the pre-plan outcome for a negative USDT. |
| SF-M1 | **Partly closed** (see R2-M1) | All-`None` reads `(None, True)`. A `None` beside another stable coin that parses still reads as a sound read. |
| SF-M2 | **Closed** | `balance.get("total")` takes no default. An absent key raises the Mapping `TypeError` and reads `(None, True)`. `{}` still reads `(None, False)`. |
| SF-M3 | **Closed** | Both the non-numeric and the non-finite case raise `stable quantity for <coin> is unreadable`, `from None`. The coin key is a currency code, and the raw value is never chained. |

### Medium

#### R2-M1: an unreadable (`None`) stable coin beside one that parses still reads as a sound read. SF-M1's outcome survives in two shapes.

**Severity:** MEDIUM, the same rating and the same reach as SF-M1 in round 1. It is data integrity:
the figure is the capital base of the stored returns and `key_inputs.anchor_usd`.

**File:** `analytics-service/services/exchange.py:3342-3344` (the `qty is None` branch) and `:3360-3365`
(`if not stable_qtys: return None, True`). The arm `none-quantity-skipped` pins it at
`analytics-service/tests/test_exchange.py:5931`.

**Evidence (measured):**
- `{"USDT": None, "USDC": 0.0}` reads `(None, False)`.
  - `stable_qtys` is `[0.0]`, so it is not empty, and the `None` guard does not fire.
  - This is the exact outcome SF-M1 was raised for: an unreadable wallet read as "drained", with no
    `balance_error`, so the derive falls back to heuristic capital.
  - A row whose `walletBalance` is `"0"` reaches `total` as `0.0` (measured through the real parse).
    So "`None` beside a zero" needs nothing that "every stable coin `None`" does not.
  - This shape equals the pre-plan outcome: the USDT helper reads a `None` USDT as `(None, False)` too.
- `{"USDT": None, "USDC": 5.0}` reads `(5.0, False)`.
  - The pre-plan USDT helper reads the same balance as `(None, False)`, so this shape is new against
    pre-plan.
  - Above the 100 USD dust floor (for example, USDC 500 beside a `None` USDT that holds the account's
    real balance), the partial sum becomes `account_balance=` for `combine_realized_and_funding`
    (`job_worker.py:9192`, composite `:13077`).
  - It is also persisted as `key_inputs.anchor_usd` with `anchor_null_reason=None`.
- Nothing downstream turns that into a flag.
  - The Bybit UTA mark skips `None` the same way (`equity_reconstruction.py:652`).
  - If Bybit's `totalWalletBalance` still counts the coin whose `walletBalance` came back empty
    (unmeasured), the mark is refused (`uta_wallet_mismatch` or `wallet_basis_mismatch`). If it does
    not, the mark agrees with the partial anchor.
  - Either way, a refused mark never gates the derive's own anchor. The only trace is the new WARNING
    log line.

**Attribution:** the fixer applied the round-1 hunter's SF-M1 fix as written ("when stable coins are
present but none parses to a number"). The gap is in that specification, not in its execution.

**Why it is the same class as the shapes this function already fails loud on:**
- ccxt 4.5.89 produces `None` in `total` only when a coin's `walletBalance` is empty, absent or JSON
  `null`. The mechanism:
  - the UNIFIED/CONTRACT/SPOT branch sets `total` from `walletBalance`;
  - it sets only one of `free` or `used` (`free` when `availableToWithdraw` is non-empty, else `used`);
  - so `safe_balance` has two unknowns and cannot back-fill `total`.
- A garbled `walletBalance` makes ccxt's `parse_balance` raise `ValueError`, which in production
  happens inside `fetch_balance`, so it already reads `(None, True)`. Tried: `"garbled"`,
  `"1,250.75"`, `"NaN"`, `"inf"`, `" "`.
- An overflowing `"1e400"` reaches `total` as `inf` and takes the non-finite arm, also `(None, True)`.
- SF-M2's own rationale ("a missing key is a schema change, not an empty wallet") is now applied to
  the `total` key but not to a coin's `walletBalance`.
- So `None` is the only malformed stable shape that is not already loud. This function still treats
  it as benign whenever another stable coin parses.

**Minimal fix:** treat any `None` stable quantity like a garbled one, returning `(None, True)` and
logging the coin codes only. Keep collecting the codes before deciding, so one line names every
unreadable coin.

```python
    if none_coins:
        logger.warning(
            "Stable coin quantity is None, unreadable: coins=%s", ",".join(none_coins),
        )
        return None, True
```

Flip `none-quantity-skipped` to `(None, True)`. Add a `none-beside-zero` arm, where
`{"USDT": None, "USDC": 0.0}` gives `(None, True)`. Both go RED under the current code.

### Info

#### R2-I1: the WARNING on a skipped `None` stable coin is not noisy in practice (question 3)

The derive's `fetch_balance()` on a unified account requests `accountType=UNIFIED` (ccxt
`bybit.fetch_balance`, through `is_unified_enabled`). The response lands in the coin-list branch of
`parse_balance` described in R2-M1. On every normal payload measured, `total` carries a float for
each coin and never `None`:
- the repo's recorded `BYBIT_UNIFIED_WALLET_BALANCE`: `{'USDT': 1000.0}`, helper `(1000.0, False)`,
  no log;
- `bybit_wallet_balance` envelopes with USDT, USDC and BTC rows, under `UNIFIED` and under `CONTRACT`;
- zero-balance rows (`0.0`);
- `availableToWithdraw` present, and `availableToWithdraw` `""`;
- a negative borrowed row;
- an empty `borrowAmount` and `accruedInterest`.

The repo's test and service trees hold no fixture with an empty or null `walletBalance` (grep, 0 hits).
I make no claim about what Bybit sends beyond the shapes measured. Whenever the WARNING does fire, the
read really is partial. That supports R2-M1's fix of failing the read instead of logging and
continuing.

#### R2-I2: borrowed stable coins. The signed sum is consistent with the decided scope, and an extreme residue is flagged (question 2)

This is rated INFO as a scope judgement, which the founder or the orchestrator can overrule.

Measured outcomes (all three columns run):

| shape (`total`) | pre-plan (USDT only) | round 1 (skip negative) | now (signed) |
|---|---|---|---|
| USDT 1000, USDC 200 | `(1000.0, False)` | `(1200.0, False)` | `(1200.0, False)` |
| USDT -50, USDC 20 | `(None, False)` | `(20.0, False)` | `(None, False)` |
| USDT 1000, USDC -50 | `(1000.0, False)` | `(1000.0, False)` | `(950.0, False)` |
| USDT 1000, USDC -990, BTC 1 | `(1000.0, False)` | `(1000.0, False)` | `(10.0, False)` |

The last row is the one that discriminates. Suppose a stable borrow funded a non-stable purchase
(spot margin). Netting then counts the liability while the asset stays out by scope, so the base can
fall towards dust. That is still the decided scope, not a new defect:
- CONTEXT `[Anchor]` (`231-CONTEXT.md:39` and `:92`) puts non-stable collateral out of the anchor and
  flags it to the founder.
- The signed sum makes a borrowed account read the same as its unborrowed twin. USDC 10000, USDT
  -5000 and BTC worth 5000 net to 5000, the same as USDC 5000 plus BTC 5000. The round-1 skip would
  have read 10000 for the first and 5000 for the second.
- In no version did the mark's `borrow_present` refusal gate the anchor, so it cannot cross-check it.
  An unborrowed account that holds BTC also has its mark refused (`uta_wallet_mismatch` or
  `wallet_basis_mismatch`) while its anchor is used.

An extreme residue is flagged. Measured with `combine_realized_and_funding` on 20 days of +20 USD
realized, with `balance_error=False`:
- A base of 10 gives meta `used_heuristic_capital=True`, and the anchor ladder stamps `dust`
  (`job_worker.py:10038`, `DUST_NAV_FLOOR` 100 USD).
- A base of 150 gives `dust_nav_guard=True` and `negative_nav_guard=True`, with 18 NaN days on the
  backward roll.
- A base of 5000 raises no flag.

So the moderate case, a base about half the true wallet, passes unflagged. The scope already accepts
that same distortion for any unborrowed non-stable holding. Record it beside the existing founder flag
for non-stable collateral; this review asks for no fix.

The other callers take the three-state result unchanged: `bybit_reconcile.py:651`,
`derivegaps_probe.py:842` and its `_anchor_of`, and the composite at `job_worker.py:12999`. An
all-`None` `(None, True)` refuses the mark as `balance_error`. That is the same token it got before,
through `usdt_wallet_usd is None`.

### Test intent (question 4)

- **The tests encode intent.** The MD-01 test builds the borrow through ccxt's real parse. It asserts
  both the parsed negative and `(150.0, False)`, so a regression to skipping goes RED for the stated
  reason.
- The fixer's neuter record shows each new arm going RED under its own neuter.
- `"garbled" not in caplog.text` pins SF-M3's promise that no raw value reaches the log, for every arm.
- `every-stable-none-is-unreadable` carries a BTC row, so a non-stable coin cannot count as readable.
- **Gap (part of R2-M1):** `none-quantity-skipped` pins accepting a partial `None` as intended
  behaviour, and no arm covers `None` beside a zero. Under R2-M1's fix, that arm flips and a
  `none-beside-zero` arm is added.
- **Below MEDIUM, not booked:** the arms test docstring still promises a "class-only" log, while the
  malformed arms now assert a message that names the coin.

_Round 2 reviewer: Claude (gsd-code-reviewer), depth deep._

## Round 2 silent-failure hunt

MD-01, SF-M2 and SF-M3 closed; SF-M1 partly closed. One MEDIUM, the same gap the code review names R2-M1: a `None` stable coin beside a readable zero or negative one (`{"USDT": None, "USDC": 0}`, `{"USDT": -50, "USDC": None}`) returns `(None, False)`. The orchestrator takes the code review's stricter fix (any `None` stable coin returns `(None, True)`), which closes both shapes. No new silent failure in the callers. INFO: `OverflowError` (unchanged IN-01).

Orchestrator ruling on R2-I2 (borrowed stable coins): the signed sum stays. A borrowed account reads like its unborrowed twin, and the non-stable asset a borrow bought is outside VREAD-01 by the CONTEXT `[Anchor]` decision; recorded as a known limit in the CHANGELOG with the non-stable collateral item.

## Fix status (round 2)

R2-M1 fixed in commit `46d84c415` (`fix(231): R2-M1 ...`). In `analytics-service/services/exchange.py::fetch_bybit_stable_wallet_with_status`, any stable coin whose quantity is `None` now logs a WARNING naming the coin codes (codes only) and returns `(None, True)` unconditionally; the `if not stable_qtys:` guard is gone and the docstring matches. A `None` non-stable coin (BTC) is still ignored.

In `tests/test_exchange.py::test_bybit_stable_wallet_arms`: `none-quantity-skipped` flipped to `(None, True)` and renamed `none-quantity-beside-readable-is-unreadable`; new arms `none-beside-zero` (`{"USDT": None, "USDC": 0}` gives `(None, True)`) and `none-non-stable-ignored` (`{"USDT": 1000.0, "BTC": None}` gives `(1000.0, False)`, no log); `every-stable-none-is-unreadable` kept.

Proof (neuter = old `if not stable_qtys:` guard restored in `exchange.py`, byte-backed copy, restored with `cp`, `cmp` clean):

- RED (neutered): `FAILED tests/test_exchange.py::test_bybit_stable_wallet_arms[none-quantity-beside-readable-is-unreadable]`, `FAILED tests/test_exchange.py::test_bybit_stable_wallet_arms[none-beside-zero]`, `2 failed, 15 passed, 204 deselected in 9.51s`
- GREEN (restored): `487 passed, 54 warnings in 38.21s` over tests/test_exchange.py, test_upnl_venues.py, test_upnl_venues_binance.py, test_nav_marks_l4_read.py, test_nav_marks_bybit_uta.py, test_derive_broker_dailies_dualmode.py
- mypy (CI invocation): `Success: no issues found in 143 source files`

## Round 3 review

Reviewer: Claude (gsd-code-reviewer), depth deep, 2026-11-24. Read-only: no source file was modified
and nothing was committed. Round-2 fix diff `8dfd17baa..HEAD -- analytics-service` (commit
`46d84c415`), read against the whole-plan diff `340dcf45a..HEAD -- analytics-service`. Scope: MEDIUM
and above only. Decided items not re-raised: the signed sum (R2-I2, ruled), non-stable collateral out
of scope, and the recorded LOW and INFO items.

**Status:** clean. R2-M1 is closed and no MEDIUM+ issue remains in the helper or its callers.

**Severity counts (this round):** critical 0, high 0, medium 0. LOW and INFO were not assessed this
round, by scope.

**Measured:**
- The six-file command (`tests/test_exchange.py tests/test_upnl_venues.py
  tests/test_upnl_venues_binance.py tests/test_nav_marks_l4_read.py tests/test_nav_marks_bybit_uta.py
  tests/test_derive_broker_dailies_dualmode.py`) gives `487 passed, 54 warnings in 37.25s`.
- `fetch_bybit_stable_wallet_with_status` at HEAD, run directly on shapes beyond the test arms:

| `total` | result | log |
|---|---|---|
| `{"USDT": -50.0, "USDC": None}` (the hunter's second R2 shape) | `(None, True)` | WARNING `coins=USDC` |
| `{"USDE": None, "USDT": 500.0}` (a split-suffix stable) | `(None, True)` | WARNING `coins=USDE` |
| `{"USDT": None, "USDC": "garbled"}` | `(None, True)` | ERROR, coin named, raw value absent |
| `{"BTC": None, "ETH": None}` | `(None, False)` | none |
| `{"USDT": None}` | `(None, True)` | WARNING `coins=USDT` |

### 1. R2-M1: closed

- The `if not stable_qtys:` guard is gone. Any stable coin whose quantity is `None` now returns
  `(None, True)` after the WARNING, whatever the other stable coins read (`services/exchange.py`,
  the `if none_coins:` block after the parse `try`). The `None` check sits after the
  `is_stable_value` filter, so a non-stable `None` never enters `none_coins` and is ignored.
- Both R2 shapes are covered by arms that go RED under the old guard (the fixer's neuter record):
  `none-quantity-beside-readable-is-unreadable` (`USDT 1000, USDC None`) and `none-beside-zero`
  (`USDT None, USDC 0`). `none-non-stable-ignored` (`USDT 1000, BTC None`) pins the other half, with
  no log line.
- A malformed stable coin beside a `None` one fails in the parse arm first, so it still returns
  `(None, True)`, and the log names the coin without the raw value.
- The docstring's three-state contract matches the code.

### 2. Callers, whole-plan diff: no MEDIUM+

The non-test callers were re-traced at HEAD. Each one takes the three-state result unchanged, and the
new `(None, True)` outcome travels the path a failed `fetch_balance` already took:
- **Derive** (`job_worker.py`, `fetch_account_equity_and_upnl_usd` under `asyncio.wait_for`): `balance_error`
  goes to `build_mark_read`, which returns the `balance_error` token, to
  `combine_realized_and_funding(balance_error=...)`, which uses heuristic capital, and to the
  anchor ladder, which stamps `anchor_null_reason="balance_error"`. Each of these is unchanged.
- **Composite** (`run_stitch_composite_job`): the guard is `balance_error or equity is None or
  abs(equity) <= DUST_NAV_FLOOR`, unchanged.
- **`nav_marks.build_mark_read`:** `balance_error` is judged before the wallet-basis comparison, and
  a `None` `usdt_wallet_usd` beside a marked wallet returns `balance_error`.
- **`scripts/bybit_reconcile.py`:** it calls the 2-tuple `fetch_account_equity_usd(ex, "bybit")` and passes
  both values to `combine_realized_and_funding`. That routes to the same helper as the derive, so the
  reconcile mirrors the derive.
- **`scripts/derivegaps_probe.py::_anchor_of`:** it returns `None` on `balance_error`, `None`,
  non-finite or `<= 0`.
- The 2-tuple and 4-tuple Bybit arms both call the one helper, so they cannot disagree. Binance and
  OKX are byte-unchanged.

**Reach of the stricter rule:** ccxt 4.5.89 `bybit.parse_balance` was re-read at HEAD. It writes
`None` into a coin's `total` only when that coin's `walletBalance` is empty or absent. Its
UNIFIED/CONTRACT/SPOT branch sets only one of `free` and `used`, so `safe_balance` cannot back-fill
`total`. R2-I1 already recorded that normal payloads never carry that shape. The stricter rule
therefore fails loud only on a real partial read and does not degrade healthy accounts.

_Round 3 reviewer: Claude (gsd-code-reviewer), depth deep._
