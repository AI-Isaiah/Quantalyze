---
phase: 186-derivegaps-the-per-key-derive-refuses-a-truncated-or-failed
reviewed: 2026-11-03T00:00:00Z
depth: deep
scope: "git diff 57d07c949..HEAD -- analytics-service/ (branch feat/186-derivegaps, tooling PR: plans 186-02 and 186-03)"
files_reviewed: 4
files_reviewed_list:
  - analytics-service/scripts/derivegaps_probe.py
  - analytics-service/services/bybit_unified_flows.py
  - analytics-service/tests/test_derivegaps_probe.py
  - analytics-service/tests/test_bybit_unified_flows.py
findings:
  critical: 0
  warning: 2
  info: 0
  total: 2
severity_filter: "MEDIUM and above only (caller instruction); LOW/INFO items were not recorded"
status: issues_found
---

# Phase 186: Code Review Report (tooling PR: SC-1 probe and pairing rule)

**Reviewed:** 2026-11-03
**Depth:** deep (call chains traced into `services/exchange.py` `fetch_daily_pnl` / `_okx_bills_fetch_with_backoff`, `services/funding_fetch.py`, `services/ccxt_flow_fetch.py`, `services/ccxt_flows.py`, `scripts/bybit_funding_record.py`, `scripts/bybit_upnl_probe.py`, `scripts/walletoffset_probe.py`, `services/job_worker.py` `_make_exchange_client` and the derive's `_flow_since_ms`)
**Files Reviewed:** 4
**Status:** issues_found (2 MEDIUM, 0 HIGH, 0 CRITICAL)

## Summary

The three safety properties the caller named hold on this diff:

- **No venue write.** `ReadOnlyRecordingExchange.__getattr__` resolves only the five plain
  attributes, two pure ccxt parsers, the closed `_READ_METHODS` and names that start with a GET
  prefix. Every method the traced fetchers reach (`private_get_account_bills[_archive]`,
  `private_get_account_balance`, `private_get_v5_position_closed_pnl`,
  `private_get_v5_account_transaction_log`, `private_get_v5_user_query_api`,
  `privateGetV5Asset{Deposit,Withdraw}QueryRecord`, `fapiPrivate_get_income`, `fetch_balance`,
  `fetch_my_trades`, `fetch_deposits`/`fetch_withdrawals`, `load_markets`) is a read. A name the
  fetchers might reach that is not listed (for example `fetch_positions`) fails closed as
  `AttributeError`. It never falls through to the inner client.
- **No PROD write.** The only database handle is `ReadOnlySupabase` (select only).
  `fetch_funding_okx` and `fetch_funding_bybit` return rows and are never followed by
  `upsert_funding_rows`. `decrypt_credentials` has no write side effect.
- **No secret output.** `emit_record` is the only stdout path. It is closed-vocabulary validated
  and re-checked with `assert_sanitized`. `main()` turns logging off before the run, which also
  silences the unscrubbed `logger.error(... %s, exc)` in `fetch_funding_okx`, and prints only the
  exception TYPE. Sentry is not initialised in this process.

`pair_onchain_with_unified` matches greedily, each on-chain row taking the earliest eligible
Unified row. All windows have the same length, so this is an optimal one-to-one matching within
a currency and amount class. 142 tests pass and mypy `--strict` is clean on both changed source
files (run at review time).

Both findings below are measurement and decision-input integrity issues. Neither is user-facing
today: the probe writes nothing, and the pairing function has no production caller.

## Warnings

### WR-01 (MEDIUM): a spent call budget or a timeout after the realized read throws away that key's whole measurement, including the truncated-key sizing D-06 needs

**File:** `analytics-service/scripts/derivegaps_probe.py:1447-1461` (`_measure_key`), with
`:115` (`KEY_CALL_CEILING`), `:808-833` / `:836-851` (continuation), `:934-935`, `:1043-1044`,
`:1056-1057`, `:1063-1064`, `:1249-1257` (the re-raises), `:1479` (`KEY_TOTAL_TIMEOUT_S`) and
`:1521-1522` (`run` maps any raise to an unmeasured record)

**Issue:** The continuation is written to tolerate a spent budget. `_continue_okx_walk` and
`_continue_bybit_walk` catch `CallCeilingReached` and return False, which the docstrings at
`:811-812` and `:881-882` describe as "the pages read so far are a lower bound". `view.ceiling_reached`
stays True, though, and `_measure_key` then runs `measure_bybit_limit`, `measure_bybit_flows` and
`measure_funding_pairs` on the same view. Each of these re-raises `CallCeilingReached`. The
exception reaches `run()`, which replaces the whole record with
`unmeasurable_reason: call_ceiling`, `measured: false` and every reading `field-absent`. The
`realized_state: truncated`, the page counts and the lower-bound `pages_needed_*` are never
printed.

The same discard happens when `KEY_TOTAL_TIMEOUT_S` fires in a later section. It also happens
on any non-ceiling venue exception during the continuation: `_continue_bybit_walk` has no
backoff, and `_continue_okx_walk` retries 429s only. Both are inconsistent with the Gap 2 and
Gap 4 sections, which turn their own failures into closed states and keep the key.

The budget was sized for Gap 1 alone ("the ceiling sits above both so a heavy key is measured,
not refused", `:113-114`). Plan 186-03 then added the Unified read (at least 106 GETs over the
365-day Bybit floor), the on-chain reads, the closed-pnl limit probe and the funding read (up
to `MAX_PAGES` per endpoint, so up to 1,000 OKX GETs) to the same 3,000-call budget.

**Failure scenario (reproduced at review time):** an OKX key with 15,050 SWAP bills, a view
ceiling of 110 and the real `_measure_key`. The realized read takes 101 pages and the equity
read 1. The continuation reaches the ceiling and returns False, as designed. `fetch_funding_okx`
then raises `CallCeilingReached`, and the key comes out as `('call_ceiling', 'none')` with
nothing measured. At the shipped ceiling, a Bybit HFT key truncated in many weeks gets the same
result: 53 windows, plus 49 extra pages per capped window, plus up to 400 continuation pages per
capped window, plus roughly 250 to 400 GETs of flows and funding. That is exactly the key whose
`pages_needed_bybit_window` sizes `BYBIT_PNL_PAGE_CAP` in plan 186-05.

The failure is loud: exit 1, and plan 186-04's `g1-unmeasured` and `q-unmeasured` route it to
the founder. But D-09 approved exactly two worker runs (plans 04 and 14). Recovering means a code
fix, a new tooling PR and deploy, and a third run that has not been approved.

**User-facing / data-integrity:** not user-facing. Data-integrity of a decision input: D-06 cap
sizing loses its heaviest data point.

**Fix:** emit what was measured. A budget spent after the realized read should end a section,
not discard the key. For example, in `_measure_key`, run each post-realized section with its own
guard, and stop issuing calls once the ceiling is reached:

```python
values = await measure_realized(view, venue, run_day)   # a ceiling here stays a refusal
values.update(await measure_past_cap(...) if values["realized_state"] == "truncated" else _past_cap_absent())
for section in sections_after_realized:                  # limit, flows, funding
    if view.ceiling_reached:
        break                                            # leave its keys field-absent
    try:
        values.update(await section())
    except CallCeilingReached:
        break
```

Record the stop as a closed token. One option is a new `UNMEASURABLE_REASONS`-style
`sections_skipped: budget`, which also moves `deploy_fingerprint`. Separately, either give the
post-realized sections their own budget or raise `KEY_CALL_CEILING` by the measured cost of
flows and funding. A test should drive `_measure_key` (not `measure_past_cap` alone, which is
all `test_a_spent_call_budget_in_the_continuation_is_a_lower_bound_not_a_refusal` covers) to a
ceiling inside the continuation and assert that `realized_state == "truncated"` and
`past_cap_reached_end is False` are printed.

### WR-02 (MEDIUM): the pairing rule leaves the same money unpaired in common cases, and the plan routes that toward a pair-aware union that would double count it

**File:** `analytics-service/services/bybit_unified_flows.py:246-258` (`_pair_view`) and
`:280-296` (`_pair_side`); consumed at `analytics-service/scripts/derivegaps_probe.py:1084-1097`

**Issue:** "Same money" is defined as one on-chain row against one Unified row with an equal
absolute `amount` (`math.isclose`, 1e-9 tolerance). Two common real patterns fall outside that
rule:

1. **Withdrawal fees.** The repo's own flow model (`services/ccxt_flows.py`
   `ccxt_rows_to_dated_flows`, MEDIUM-1) says a withdrawal debits `amount + fee`. A user who
   moves exactly what the withdrawal needs from UNIFIED therefore makes a TRANSFER_OUT of
   `amount + fee`, while the on-chain row's `amount` excludes the fee. `_pair_view` reads only
   `amount` and ignores the row's `fee`, so every such withdrawal is unpaired.
2. **Split or merged moves.** A 1,000 USDT deposit moved into Unified as 500 + 500, or two
   deposits moved as one transfer, never pairs.

**Failure scenario:** a UTA Bybit key with one 1,000 USDT on-chain withdrawal (fee 1) funded by
a 1,001 USDT TRANSFER_OUT. The probe prints `paired_withdrawals: 0` and
`unpaired_onchain_withdrawals: 1`, and `unpaired_onchain_net_over_anchor` carries the full 1,000.
Plan 186-04 Task 2 then prints `g2-flow-verdict: ask`. Its option text recommends "Pair-aware
union" whenever `max_unpaired_net_over_anchor` is at least 0.01, and that union counts this
withdrawal twice: once as the Unified TRANSFER_OUT and once as the on-chain withdrawal. That is
the double count this module's own docstring (Phase 180 D-01, "INSTEAD of ... never beside them")
exists to prevent.

The same problem sits in the contract the docstring offers plan 186-10. `matched_onchain_ids`
merges the deposit and withdrawal id spaces into one set (`:330`), so a Bybit deposit `id` equal
to a withdrawal `withdrawId` hides an unpaired row. A paired row with no id is counted as paired
but is absent from the set (`:276-277`), so a derive that drops paired rows by id would keep it.

**User-facing / data-integrity:** not user-facing today, because the function has no production
caller. Latent data-integrity: it biases the D-02 replace-or-union decision toward unpaired
rows, and a pair-aware union built on this rule double counts flows in the Bybit curve.

**Fix:** keep the probe counts honest and make the derive contract safe before plan 186-10 uses
it.

- Pair withdrawals on `amount` OR `amount + fee.cost` when the fee is in the same currency.
- Have the probe also print the count of unpaired on-chain rows that have a same-currency
  Unified row inside the window but a different amount (`unpaired_near_miss`), so the founder
  can see that an "ask" was caused by the rule.
- Return per-side id sets (`matched_deposit_ids`, `matched_withdrawal_ids`) and count, not drop,
  id-less pairs under a separate field, so a pair-aware derive can refuse rather than double
  count.
- Plan 186-04's "Pair-aware union (Recommended otherwise)" text should not be offered while the
  rule cannot see fee-netted or split moves.

```python
def _pair_amounts(row: Mapping[str, Any]) -> tuple[float, ...]:
    amount = abs(float(row["amount"]))
    fee = row.get("fee")
    cost = fee.get("cost") if isinstance(fee, Mapping) else None
    if isinstance(cost, (int, float)) and not isinstance(cost, bool) and math.isfinite(cost) \
            and (fee.get("currency") or "").upper() == str(row["currency"]).upper():
        return (amount, amount + abs(float(cost)))
    return (amount,)
```

---

_Reviewed: 2026-11-03_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_

---

## Round 2: re-review of the round-1 fixes (commits `3b84a9448..20db4381c`)

**Reviewed:** 2026-11-03
**Depth:** deep. Diff `8cb3ca89b..20db4381c` read in full. Call chains traced into
`scripts/bybit_upnl_probe.py` `classify_failure`, `scripts/bybit_funding_record.py` `read_key_info`,
`services/ccxt_flow_fetch.py` `fetch_ccxt_transfers`, ccxt's Bybit `parse_transaction` and error map,
and plan 186-04 Task 2, which consumes the records.
**Files reviewed:** `analytics-service/scripts/derivegaps_probe.py`,
`analytics-service/services/bybit_unified_flows.py`, and both test files (for coverage only).
**Severity filter:** MEDIUM and above (caller instruction).
**Round 2 tally:** 1 HIGH (CR-01), 3 MEDIUM (WR-03, WR-04, WR-05). The frontmatter above still holds
the round-1 counts and was not edited.

At review time, 159 tests passed and `mypy --strict` was clean on both source files. The findings
below were reproduced with a script that runs the real code. The script lives outside the repo and
was not committed.

### Verification of the round-1 findings

| Finding | Verdict | Evidence |
|---|---|---|
| WR-01 / M4: a spent budget or late timeout discarded the key | **Partly fixed, and the fix opens a new silent path (CR-01)** | A truncated key now keeps its `realized_state`, page counts and lower-bound `pages_needed_*` (reproduced with the round-1 scenario: OKX, 15,050 bills, ceiling 110). But the round-1 fix text said "Record the stop as a closed token", and no token was added. `KEY_CALL_CEILING` was not resized either. Both gaps are in CR-01. |
| WR-02 / M3: pairing missed amount+fee and unreadable rows, merged id spaces | **Fixed in the probe, with one regression (WR-03).** One contract item still open. | `_same_currency_fee` reads ccxt's `fee` (`{'cost': withdrawFee, 'currency': code}` from Bybit `parse_transaction`), so the fee path is live on real rows. The id sets are split per side. `unreadable_rows` and `near_miss_rows` are counted, and a split 500+500 move now shows as a near miss. Still open: id-less paired rows are not counted separately. This cannot happen on Bybit today, because ccxt always fills `id`/`withdrawId`. The plan 186-04 option text still recommends "Pair-aware union" (a plan file, outside this diff). |
| H1: funding truncated or fetch_error read as 0 pairs | **Fixed** | `<v>_funding_pairs` and `<v>_funding_malformed` are `field-absent` unless every measured key's funding state is `complete` (`:1496`). The per-state counts are printed. |
| H2: no summary count for Bybit on-chain `failed`, Unified `venue_error` or an unreadable anchor | **Fixed for those states. A dropped flows section bypasses all three (CR-01).** | `bybit_onchain_failed`, `bybit_unified_venue_error` and `bybit_anchor_unreadable` are present and validated. |
| M1: at-cap counts taken from partial walks | **Fixed** | `measure_realized` sets both at-cap counts to `field-absent` when the state is not `complete`/`truncated` (`:785-789`). No summary arithmetic reads them. |
| M2: the limit probe conflated 429 or transient errors with the venue rejecting 200 | **Partly fixed (WR-04)** | 429, network errors and timeouts are now classified and read as not informative. Bybit's own "try again later" code still reads as a rejection. |

**Properties the caller asked about:**

- **Can a key now hang past its bound? No.** The realized read keeps its own bound
  (`KEY_READ_TIMEOUT_S` 1200 s) and so does the equity read (120 s). Each later section runs under
  `asyncio.wait_for(section(), deadline - now)`, and the deadline is anchored at the key's start
  (`:1542`). No code in the section paths swallows `CancelledError`: `read_key_info` and the
  sections catch `Exception` only. `aclose_exchange` was unbounded before the fix as well. One side
  effect: `unmeasurable_reason: timeout` can no longer occur. That is harmless, and it stays in the
  vocabulary and the fingerprint.
- **Is a programming error now hidden? No.** `_later_section` catches only `CallCeilingReached`,
  `TimeoutError` and `ccxt.BaseError` (`:1532`). A `KeyError`, `TypeError` or the wrapper's
  fail-closed `AttributeError` still reaches `run()` and becomes `failure`/`other` with exit 1. The
  broad `except Exception` handlers inside the flows and funding sections predate this diff.
- **Can the amount+fee rule double-match one Unified row? No.** `used[slot]` is set before `break`
  (`bybit_unified_flows.py:333`), and fees apply to withdrawals only. It can, however, take the
  wrong row (WR-03).
- **Read-only and no secrets: hold.** No new venue method is called. `bybit_limit*_error_class`
  comes from the closed `FAILURE_CLASSES` through `classify_failure`, which never reads the
  message. Every new key is closed-vocabulary validated, and `_later_section` prints nothing. The
  round-2 test asserts that a venue message never reaches a record.

### CR-01 (HIGH): a later section dropped by `_later_section` leaves no trace. The key reads as measured, the run exits 0, and the gate inputs plan 186-04 computes come out silently wrong

**File:** `analytics-service/scripts/derivegaps_probe.py:1518-1533` (`_later_section` returns `{}`),
`:1536-1555` (`_measure_key`), `:1470-1486` (Bybit flow summary), `:1414-1419` and `:1504-1514`
(`<v>_max_nonrealized_s`), `:1621` (`run` exits 0 when `keys_unmeasurable == 0`)

**Issue:** When a section hits the call budget, the key deadline or a ccxt error, `_later_section`
returns `{}`. Every key that section owns then keeps the `_key_record` default of `field-absent`.
No closed token says the section was skipped or why. Before this fix, the same events made the key
`measured: false` with reason `call_ceiling`, `timeout` or `failure`, exit 1, and a count on plan
186-04's `g1-unmeasured:` and `q-unmeasured`. The loud path is gone, and nothing replaces it.
Reproduced on the round-1 scenario (OKX, ceiling 110): `keys_unmeasurable: 0` (exit 0), and
`okx_funding_complete` / `_truncated` / `_fetch_error` are all `0` for 1 measured key, with no field
saying why.

Plan 186-04 computes its gate lines from these records, so four inputs come out wrong:

1. **Gap 2 verdict, which can be wrong outright.** A Bybit key whose flows section was dropped adds
   0 to `bybit_onchain_rows`, `bybit_paired_rows` and `bybit_unpaired_onchain_rows`. It also adds 0
   to `bybit_onchain_failed`, `bybit_unified_venue_error`, `bybit_unified_reader_errors` and
   `bybit_anchor_unreadable`, the H2 counters. Its only trace is `bybit_uta_unknown`, which also
   counts a key whose `query-api` answer was malformed. Reproduced: a dropped-flows key gives every
   one of those sums `0`. If that key held the only on-chain rows, plan 186-04 Task 2 step 6 prints
   `g2-flow-verdict: replace (no on-chain rows on PROD)`, a D-02 decision made on data never read.
2. **The D-06 budget split, which is underestimated.** `flows_elapsed_s`, `unified_elapsed_s` and
   `funding_elapsed_s` are set only inside their sections. A section that ran until the deadline
   (the slowest case, which is the one that matters) records no time. `<v>_max_nonrealized_s`
   (`NR`) then leaves it out, and plan 186-04's `budget_s = floor(900 - 90 - NR)` comes out too
   generous.
3. **The truncated-key sizing, which is lost.** `measure_bybit_limit` runs after `measure_past_cap`.
   The keys whose continuation spends the budget are the busiest Bybit accounts, and those are the
   only accounts whose 7-day window can return more than 100 rows. For them the limit probe is
   always skipped. Plan 186-04's `g1-bybit-limit` is `keep-200` only if some record shows
   `bybit_limit200_rows > 100`, and otherwise `set-100`. If the venue honours 200, `set-100` doubles
   the page count against caps sized as `1.5 * P_bybit` from pages read at limit 200, so the heaviest
   keys come out truncated again.
4. **The D-06 "no silent drop-out of sizing" premise, which is broken.** If `ccxt` raises during the
   continuation, the key keeps `past_cap_reached_end: field-absent`. That key is excluded twice:
   plan 186-04 step 2 counts `still_short_expected` from records whose `past_cap_reached_end` "is
   false", and `g1-unmeasured` counts only `measured: false` or a realized `timeout`/`fetch_error`.
   The new summary rule in `keys_still_short_after_ceiling` does count the key, but the plan does
   not read that summary key.

Round 1 also asked for the post-realized sections to get their own budget, or for
`KEY_CALL_CEILING` to be raised by the measured cost of flows and funding. Neither was done, so
items 1 and 3 are expected on exactly the heavy keys WR-01 was about.

**Fix:** record every skip as a closed token, and give the starved sections calls of their own.

```python
SECTION_SKIP_REASONS: Final = ("none", "call_ceiling", "deadline", "venue_error")
# KEY_RECORD_KEYS gains one per later section, for example:
#   past_cap_skip, bybit_limit_skip, bybit_flows_skip, funding_skip
# (the deploy fingerprint moves with them, as it must)

async def _later_section(view, deadline, name, section):
    if view.ceiling_reached:
        return {f"{name}_skip": "call_ceiling"}
    remaining = deadline - _monotonic()
    if remaining <= 0:
        return {f"{name}_skip": "deadline"}
    started = _monotonic()
    try:
        return {**await asyncio.wait_for(section(), remaining), f"{name}_skip": "none"}
    except CallCeilingReached:
        return {f"{name}_skip": "call_ceiling"}
    except TimeoutError:
        return {f"{name}_skip": "deadline", **_elapsed_key_for(name, _monotonic() - started)}
    except ccxt.BaseError:
        return {f"{name}_skip": "venue_error"}
```

Then:

- Add summary counts `<section>_skipped_<reason>`, and make `run()` exit non-zero when any is
  non-zero, so plan 186-04's `g1-unmeasured`/`q-unmeasured` path sees it. Alternatively, extend
  `g1-unmeasured` to read the new tokens.
- Run `measure_bybit_limit` (2 calls) before `measure_past_cap`, or reserve its calls.
- Reserve a separate budget for flows and funding, so the realized continuation cannot starve them.
- Add a test that drives `_measure_key` to a skipped flows section and asserts a non-zero skip count
  and a non-zero exit from `run()`.

### WR-03 (MEDIUM): amount+fee pairing takes the earliest row that matches either amount, so a fee-match can take a row another withdrawal needed as an exact match, and the greedy match is no longer optimal

**File:** `analytics-service/services/bybit_unified_flows.py:318-338` (`_pair_side`)

**Issue:** Round 1 accepted greedy matching as optimal because each on-chain row had one amount
class. Each withdrawal now accepts two amounts, `amount` and `amount + fee`, and the loop takes the
earliest unused Unified row that matches either one. It does not prefer an exact match. Reproduced:

- On-chain withdrawal A: 100 USDT, fee 1, at t+10h. Withdrawal B: 101 USDT, fee 1, at t+11h.
- Unified TRANSFER_OUT rows: U1 101 at t+1h, U2 100 at t+2h.
- A takes U1 through its fee match, and B finds no row of 101 or 102.
- Result: `paired=1 unpaired=1 near_miss=1`. The one-to-one matching A→U2, B→U1 pairs both.

In the probe, this biases the counts toward "ask". In the pair-aware derive that plan 186-10 would
build on this function, B stays unpaired, so its money is counted on-chain while U1 and U2 are both
counted as Unified flows. That is the double count the module docstring exists to prevent. The
trigger is narrow: two withdrawals within 30 days whose amounts differ by exactly one fee.

**Fix:** match exact amounts first, in a separate pass over all rows, and only then match leftover
withdrawals on `amount + fee`. Inside one pass, preferring the exact match is not enough, because
the conflicting withdrawal comes later. Add the reproduction above as a test, asserting
`paired_withdrawals == 2`.

### WR-04 (MEDIUM): `bybit_limit_probe_informative` reads Bybit's "System error, try again later" as the venue rejecting limit=200, and does not check that the 100 read worked

**File:** `analytics-service/scripts/derivegaps_probe.py:942` (`_LIMIT_REJECTED_CLASSES`), `:976-979`

**Issue:** `ExchangeError` counts as "the venue rejected the request". In the pinned ccxt, Bybit
retCode `10016` ("System error. Please try again later.") maps to `ExchangeError`. So does every
retCode ccxt does not map. A transient venue fault on the 200 read therefore prints
`bybit_limit_probe_informative: true` with class `ExchangeError`. That is the exact conflation M2
was raised against. The flag also ignores the 100 read. If both reads fail with the same class
(an outage, or an endpoint the key cannot use), the record says the probe is informative about
limit=200, although nothing distinguishes 200 from 100. Plan 186-04's `g1-bybit-limit` rule does not
read this flag today, so the harm is limited to a reader of the records. That reader is who the flag
was added for.

**Fix:** treat `BadRequest` as the only rejection class (Bybit's parameter error, retCode 10001,
maps to it), and require the 100 read to have succeeded:

```python
values["bybit_limit_probe_informative"] = (
    isinstance(rows_200, int) and rows_200 > 100
) or (
    values["bybit_limit200_error_class"] == "BadRequest"
    and values["bybit_limit100_error_class"] == "none"
)
```

### WR-05 (MEDIUM): a funding, flows or limit section that was skipped is counted in no state, so the per-state summary counts no longer add up to the measured keys

**File:** `analytics-service/scripts/derivegaps_probe.py:1491-1492` (`<v>_funding_<state>`),
`:1479-1485`

**Issue:** H1's fix prints one count per funding state (`complete`, `truncated`, `fetch_error`). A
measured OKX or Bybit key whose funding section was skipped has `funding_state: field-absent`, and
no count holds it. `okx_funding_complete + _truncated + _fetch_error` is then less than the number
of measured OKX keys, and no line says why. The two Bybit flow state counts behave the same way.
This is the counting side of CR-01. It is listed separately because it is also the cheapest
detection: a consumer that checks that the counts sum to the measured keys would have caught CR-01.

**Fix:** with CR-01's skip tokens in place, add `<v>_funding_not_read` (and the same for each flow
state). Then assert in `summarize`, or in a test over `summarize`, that the state counts add up to
the measured keys of the venue.

---

_Round 2 reviewed: 2026-11-03_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_

---

## Round 3 (final): re-review of the round-2 fixes (commits `8ef1cb828`, `1b0713332`)

**Reviewed:** 2026-11-03
**Depth:** deep. Both commits read in full. Call chains re-traced into `services/ccxt_flow_fetch.py`
`fetch_ccxt_transfers`, `services/bybit_unified_flows.py` `fetch_bybit_unified_flows`,
`services/funding_fetch.py` `fetch_funding_okx` / `fetch_funding_bybit` and
`services/exchange.py` `_okx_bills_fetch_with_backoff`, to check exception and cancellation
handling. Plan 186-04 was read for the note at the end.
**Files reviewed:** `analytics-service/scripts/derivegaps_probe.py`,
`analytics-service/services/bybit_unified_flows.py`, and both test files (for coverage only).
**Severity filter:** MEDIUM and above (caller instruction).
**Round 3 tally:** 1 HIGH (CR-02), 1 MEDIUM (WR-06). The frontmatter above still holds the round-1
counts and was not edited.

At review time, 170 tests passed and `mypy --strict` was clean on both source files. Both findings
were reproduced by running the real code from a script outside the repo. The script was not
committed.

### Verification of the round-2 findings

| Finding | Verdict | Evidence |
|---|---|---|
| CR-01: a dropped later section left no trace and exited 0 | **Fixed** | `_later_section` (`:1593-1615`) returns `<name>_skip` on every path: `call_ceiling`, `timeout` (the key deadline), or the closed class from `failure_token` (`:1380-1389`). `summarize` counts `<venue>_sections_skipped` (`:1516-1518`), and `run()` exits 1 when any count is non-zero (`:1720-1721`). Flows and funding keep what they read before a stop, because the caller passes the dict in (`:1642-1653`). The four CR-01 consequences: (1) a skipped flows section now exits 1; (2) the elapsed time is set in `finally`, so a section cut by the deadline records its time (`:1122-1123`, `:1140-1141`, `:1343-1344`); (3) the limit probe runs before the continuation (`:1631-1632`); (4) a `past_cap` venue error exits 1. |
| WR-03: a fee match could take an exact match another withdrawal needed | **Fixed for the reported case, but the mirror case remains (WR-06)** | The two-pass loop (`bybit_unified_flows.py:318-349`) pairs the round-2 reproduction 2 of 2. With exact matches first, an exact match can now take a row that another withdrawal could pair only through its fee. |
| WR-04: `informative` counted `ExchangeError` and ignored the 100 read | **Fixed** | `:999-1004` counts only `BadRequest` on the 200 read when the 100 read returned `none`. A parametrised test covers the four cases. |
| WR-05: the per-state counts did not add up to the measured keys | **Fixed** | `bybit_onchain_{complete,failed,not_read}`, `bybit_unified_{complete,venue_error,not_read}` plus `bybit_unified_reader_errors`, and `<v>_funding_{complete,truncated,fetch_error,not_read}` each partition the measured keys of their venue, because every state token, `field-absent` included, has its own counter. A test covers this. |
| F3: funding sums with an unmeasured key or no key | **Fixed for funding only** | `funding_complete` (`:1562-1571`) requires at least one measured key, every measured key `complete`, and no unmeasured eligible key. The Gap 2 flow sums got no matching rule (CR-02). |

**Properties the caller asked about:**

- **Can the probe exceed its total call ceiling? No.** `_counted` refuses before the inner call
  once `calls >= self.ceiling` (`:231-233`), and it reads `self.ceiling` at call time.
  `_read_one_key` builds the view at `KEY_CALL_CEILING + FLOWS_FUNDING_CALL_BUDGET` = 4000
  (`:1671`). `_measure_key` lowers it to 3000 for the realized read, the limit probe and the
  continuation, then raises it back to 4000 and clears `ceiling_reached` (`:1627-1640`). The
  sections run one after another, so no call is in flight across the switch. Every
  continuation call after the 3000 refusal is refused again before the venue sees it: both
  `_continue_*` loops return False on the first refusal. One key's hard bound is therefore 4000
  calls, 33% more than before. The module docstring (`:48`) and the `KEY_CALL_CEILING` comment
  (`:113`) still describe 3000 as the key's budget. That is LOW and was not recorded.
- **Can the probe call the venue after the deadline? No.** The deadline is anchored at the key's
  start (`:1626`). Each later section checks `remaining <= 0` before running and otherwise runs
  under `asyncio.wait_for(section(), remaining)`. The realized read (at most 1200 s plus 120 s)
  ends before 3600 s. None of the traced fetchers catches `CancelledError` or `BaseException`.
  Their handlers catch `Exception` or ccxt classes, and `_okx_bills_fetch_with_backoff` retries
  429s only. After a timeout the only remaining action is `aclose_exchange`, which makes no
  venue call. The runtime is Python 3.12, where `asyncio.wait_for` raises the built-in
  `TimeoutError` that `_later_section` catches.
- **Is the 1000-call reserve enough? Not shown, but it fails loud.** "About 200 pages each" is an
  estimate, not a measurement. A Bybit key needs at least about 240 calls for the reserved
  sections: `fetch_funding_bybit` walks 53 weekly windows across 2 categories, the Unified reader
  does the same across 2 log types, the on-chain reads make about 26 calls, and `read_key_info`
  makes 1. A busy derivatives account (50 rows per page) can need more than 1000 calls for
  funding alone. The reserve is only the floor, though: the sections get every call the first
  phase left unused. If the budget runs out, the result is `funding_skip: call_ceiling` and
  exit 1, which is loud. This is not recorded as a finding.
- **Read-only and no secrets: hold.** Round 2 added no new venue method. The limit probe still
  calls only `private_get_v5_position_closed_pnl`, and the flows and funding reads are unchanged.
  Every `<name>_skip` value comes from the closed `SECTION_SKIP_REASONS`, which is built from
  `FAILURE_CLASSES` through `classify_failure`. That function never reads the message, and the
  validator enforces the vocabulary (`:495-498`). The limit probe's two requests now enter
  `collect_walks` before `measure_past_cap` reads it. They form one 2-page walk, keyed by a
  `startTime` that no derive window shares, so they cannot change a capped walk's
  `pages_needed_bybit_window` (a capped walk has at least 50 pages) or `_oldest_ms`.

### CR-02 (HIGH): a Bybit flow read that failed inside a section that ran adds 0 to the Gap 2 sums, the run exits 0, and plan 186-04's flow verdict comes out as "replace" on data that was never read

**File:** `analytics-service/scripts/derivegaps_probe.py:1523-1530` (the Gap 2 sums), set by
`:1119-1121` (`onchain_read_state: failed`) and `:1138-1139` (`unified_read_state: venue_error`);
exit at `:1720-1721`. Compare the funding rule at `:1558-1571`.

**Issue:** `measure_bybit_flows` turns a failed on-chain read or a failed Unified read into a
state and returns normally. The section therefore reads `bybit_flows_skip: none`, and
`<venue>_sections_skipped` stays 0. If every key was measured, the run exits 0. `summarize` still
prints `bybit_onchain_rows`, `bybit_paired_rows`, `bybit_unpaired_onchain_rows` and
`bybit_unified_rows` as plain sums. A key whose read failed adds 0 to each of them. The F3 fix
made the funding sums `field-absent` in exactly this situation, and its own comment states why:
"a truncated, failed or unread funding adds nothing to a sum, so the sum would read as a smaller
count". The same reasoning applies to the flow sums, and the rule was not applied to them.

**Reproduced** by running the real `summarize` on validated key records, with every section
`none`:

- *Case 1.* Key k1's on-chain read failed. Key k2 read 0 on-chain rows. Result:
  `bybit_onchain_rows: 0`, `bybit_onchain_failed: 1`, exit 0. Plan 186-04 Task 2 step 6 prints
  `g2-flow-verdict: replace (no on-chain rows on PROD)`.
- *Case 2.* Key k1 read 5 on-chain rows, but its Unified read was a `venue_error`, so its
  pairing never ran. Key k2 paired all 3 of its rows. Result: `bybit_onchain_rows: 8`,
  `bybit_paired_rows: 3`, `bybit_unpaired_onchain_rows: 0`, exit 0. Step 6 prints
  `g2-flow-verdict: replace (every on-chain row paired)`. Five on-chain rows were never tested
  against the Unified log.

Both triggers are realistic for a read-only Bybit key. A key without the asset or wallet read
scope fails `fetch_deposits` / `fetch_withdrawals` with `PermissionDenied`, and every non-ceiling
exception becomes `failed` or `venue_error`. The summary does carry `bybit_onchain_failed` and
`bybit_unified_venue_error`. Neither the exit code nor the plan's verdict rule reads them, so the
consequence is the one CR-01 item 1 described: a D-02 replace-or-union decision taken on flows
that were never read, with a green run.

**User-facing / data-integrity:** not user-facing. Data-integrity of the D-02 decision input,
which decides which flows the Bybit curve counts.

**Fix:** apply F3's rule to the flow sums. Print them only when every measured Bybit key read
both sides in full and no eligible Bybit key went unmeasured. Otherwise print `field-absent`, so
plan 186-04's numeric regexes fail loud rather than decide:

```python
bybit_eligible_unmeasured = any(
    r["venue"] == "bybit" and not r["measured"] and r["unmeasurable_reason"] != "key_not_eligible"
    for r in records
)
flows_complete = (
    bool(bybit)
    and not bybit_eligible_unmeasured
    and all(r["onchain_read_state"] == "complete" and r["unified_read_state"] == "complete" for r in bybit)
)
for name, fields in (
    ("bybit_onchain_rows", ("onchain_deposits", "onchain_withdrawals")),
    ("bybit_unified_rows", ("unified_in", "unified_out")),
    ("bybit_paired_rows", ("paired_deposits", "paired_withdrawals")),
    ("bybit_unpaired_onchain_rows", ("unpaired_onchain_deposits", "unpaired_onchain_withdrawals")),
    ("bybit_pairing_unreadable_rows", ("pairing_unreadable_rows",)),
    ("bybit_near_miss_rows", ("pairing_near_miss_rows",)),
):
    summary[name] = _count_sum(bybit, fields) if flows_complete else FIELD_ABSENT
```

The validators for these keys must become `_is_count_or_absent`, and the summary vocabulary
size, and with it the fingerprint, stays the same. Add a test with the two cases above that
asserts `field-absent`. Alternatively, or as well, make `run()` exit 1 on any non-`complete`
flow state, which is the same treatment a skipped section gets.

### WR-06 (MEDIUM): exact-first pairing can now take a row that another withdrawal could pair only through its fee, so the mirror of WR-03 still pairs 1 of 2

**File:** `analytics-service/services/bybit_unified_flows.py:318-349` (`_pair_side`, the two passes)

**Issue:** Each withdrawal accepts two amounts, `amount` and `amount + fee`. Running one greedy
pass per amount class is still not a maximum matching. WR-03 was the case where a fee match stole
an exact match. The fix runs exact matches first, which creates the reverse case: an exact match
steals a fee match. Reproduced with the real `pair_onchain_with_unified`:

- On-chain withdrawal A: 100 USDT, fee 1, at t+10h. Withdrawal B: 101 USDT, fee 1, at t+11h.
- Unified TRANSFER_OUT rows: U1 101 at t+1h, U2 102 at t+2h. This is a user who always moves
  `amount + fee` out of UNIFIED, which is the case the fee rule was added for.
- Pass 1 gives B the row U1 through an exact match. A has no row of 100. In pass 2, A looks for
  101, which is taken, and B is already paired.
- Result: `paired_withdrawals=1`, `unpaired_onchain_withdrawals=1`, `near_miss_rows=1`,
  matched ids `['B']`. The one-to-one matching A→U1, B→U2 pairs both.

The trigger is as narrow as WR-03's: two withdrawals within 30 days whose amounts differ by
exactly one fee. Its consequence is the same as well. In the probe it biases the counts toward
"ask". In the pair-aware derive that plan 186-10 would build on this function, A's money is
counted on-chain and again in U1 and U2, the double count the module docstring exists to
prevent. The docstring (`:290-296`, `:367-369`) still calls this greedy in time order, which no
longer describes an optimal rule.

**Fix:** compute a maximum-cardinality matching within each currency instead of pairing one
amount class per pass. The sizes are small: hundreds of rows per key over the 365-day floor.
Kuhn's augmenting-path algorithm, run over the on-chain rows in time order, is enough. A row's
edges go to the in-window Unified rows of the same currency whose amount equals `amount` or, for
a withdrawal with a same-currency fee, `amount + fee`. Exact edges are tried first, so a tie
between equal-size matchings still prefers exact pairs. Add the reproduction above as a test that
asserts `paired_withdrawals == 2`, next to the WR-03 test.

### Note for plan 186-04 (not fixed here, as instructed): its gate lines do not read the new keys, and Task 1's own check now contradicts the probe's exit rule

1. **Task 1's RUN_OK check rejects a run with a skipped section.** `186-04-PLAN.md:134` accepts
   only `keys_unmeasurable = 0 ∧ probe-exit = 0` or `keys_unmeasurable ≠ 0 ∧ probe-exit = 1`. A
   run where every key was measured but a section was skipped now exits 1 with
   `keys_unmeasurable = 0`, and no branch accepts it. The failure is loud, but the plan gives no
   instruction for it. Either branch should read the summed `<venue>_sections_skipped`, or the
   plan should state what a skip means (a STOP, or a `q-unmeasured`-style founder question).
2. **`g1-unmeasured:` (step 2b, `:159`) and `still_short_expected` (step 2, `:158`) do not see a
   skipped `past_cap`.** A truncated key whose continuation raised has `past_cap_skip: <class>`
   and `past_cap_reached_end: field-absent`. Step 2 counts only `past_cap_reached_end` false, and
   step 2b counts only `measured: false` and a realized `timeout` or `fetch_error`, so the key
   falls out of both. The summary key `<venue>_keys_still_short_after_ceiling` does count it. The
   plan should read that key, or count `past_cap_skip ∉ {none, field-absent}` on `g1-unmeasured:`.
   This is the same D-06 silent drop-out as CR-01 item 4, now on the plan side only.
3. **`g1-bybit-limit:` (step 3, `:160`) defaults to `set-100` from missing evidence.** A key with
   `bybit_limit_skip ≠ none`, or with `bybit_limit_probe_informative: false`, contributes nothing,
   and the rule still writes `set-100` (the CR-01 item 3 consequence). The rule should read
   `bybit_limit_skip` and `bybit_limit_probe_informative`, and should ask rather than default when
   no record is informative.
4. **The numeric rules have no branch for `field-absent`.** `okx_funding_pairs`,
   `bybit_funding_pairs`, `okx_funding_malformed` and `bybit_funding_malformed` can now be
   `field-absent` (F3). If CR-02 is fixed, the Gap 2 sums can be too. Steps 4, 6 and 7 (`:161`,
   `:163`, `:164`) and Task 2's regexes (`:167`) accept digits only. The run fails loud, but the
   plan should say what `field-absent` means: a STOP or a founder question, never a 0. Step 6
   should also read `bybit_onchain_failed`, `bybit_onchain_not_read`,
   `bybit_unified_venue_error` and `bybit_unified_not_read` until CR-02 lands.
5. **The fingerprint has moved.** `186-03-SUMMARY.md:49` records
   `derivegaps 0 1 58 51 5 4 okx,bybit,binance`. At `1b0713332` the probe prints
   `derivegaps 0 1 68 71 5 4 okx,bybit,binance`. Task 1's check (`:134`) passes only through a
   `fingerprint-deviation:` line, which the plan reserves for a merge. Re-record the expected line
   at the reviewed commit before the run. The fingerprint also counts only the size of each
   vocabulary, so a behaviour-only change with the same record shape, such as WR-04's rule, does
   not move it. This weakness predates round 2 and is not recorded as a finding.

---

_Round 3 reviewed: 2026-11-03_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
