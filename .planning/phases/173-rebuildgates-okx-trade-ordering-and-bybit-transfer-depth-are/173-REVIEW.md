---
phase: 173-rebuildgates-okx-trade-ordering-and-bybit-transfer-depth-are
reviewed: 2026-10-28T10:45:43Z
depth: standard
files_reviewed: 3
files_reviewed_list:
  - analytics-service/scripts/allocator_history_probe.py
  - analytics-service/tests/test_allocator_history_probe.py
  - docs/runbooks/marksource-okx-history-correction.md
findings:
  critical: 0
  warning: 4
  info: 0
  total: 4
status: issues_found
---

# Phase 173: Code Review Report

**Reviewed:** 2026-10-28T10:45:43Z
**Depth:** standard
**Files Reviewed:** 3
**Status:** issues_found

## Summary

Scope: the phase diff `4be15811a..HEAD` over the probe, its tests and the runbook paragraph.
The whole files were read for context. The rebuild read paths the probe calls were traced in
`services/equity_reconstruction.py` (`_fetch_and_price_window`, `_fetch_okx_inst_type_trades`,
`_account_rebuild_window`, `ForcedRebuildRefusedError`) and `services/ccxt_flow_fetch.py`
(`fetch_ccxt_transfers`).

Measured locally: `pytest tests/test_allocator_history_probe.py -q` gives 103 passed. `mypy --strict`
on `scripts/allocator_history_probe.py` reports no issues. CI's mypy line does not cover `scripts/`,
so that run was a separate check.

What holds, traced and not assumed:
- `okx_order_verdict` tests `violated` first, and it never returns `ok` with
  `members_with_trades == 0`. A reading needs a typed pass with rows > 0, which implies
  `trades_read > 0`, so per account `readings <= members_with_trades`. Equal sums therefore mean
  equality on every account, as the `summarize` comment claims.
- Every arm takes the ordering read from the forced-pass snapshot, before the anchor diagnostic
  re-wraps the client. The raw read is not wrapped by the recorder, so the forced-pass counters do
  not move.
- The refusal arm's assumption ("raised at the END of the read") holds for the anchor refusals
  (`_fetch_and_price_window` raises after trades and transfers). Trades are fetched in full,
  instrument type by instrument type, before anything else that can refuse.
- `bybit_transfers_verdict` reads only the per-kind counts. `window_days == 730` is exactly what
  `_account_rebuild_window` returns for a Bybit account without OKX. The pooled field equals the
  per-kind sum, because both dedupe on `(kind, id)`.
- Redaction: every new field is a count, a closed token, a closed age bucket or a boolean.
  `okx_order_failure_class` goes through `classify_failure` and the allow-list validator. No id,
  amount or sub-day timestamp reaches stdout, and tests pin the leak strings.

No BLOCKER was found. The four warnings are listed below. Two are data-integrity gaps in what the
code-derived gates can claim, one is a missing pin on the arm a4 will take once OKXBILLSCHAIN lands,
and one is a runbook sentence that contradicts the code-derived gate.

## Narrative Findings (AI reviewer)

## Warnings

### WR-01: The OKX ordering reading proves only that rows inside one page descend, not that the page holds the NEWEST fills. Yet it is now the sole evidence for a code-derived `ok` (data-integrity, MEDIUM)

**File:** `analytics-service/scripts/allocator_history_probe.py:816-839` (`okx_newest_first`), `:1127-1157` (`_okx_order_reading`), `:842-859` (`okx_order_verdict`)
**Issue:** The rebuild's OKX walk (`_fetch_okx_inst_type_trades`) relies on two facts:
1. A page with no end bound returns the newest fills of the range.
2. Each later page, ending at `oldest + 1`, returns the newest fills below that end.

The raw reading checks only that the `ts` values inside the one page it gets never increase. If OKX
answered a range of more than 100 fills with its OLDEST 100, sorted descending, the reading would be
`True` and the gate would read `ok`. The real walk would then stop after page 1, on a short page or
on `oldest <= since`. It would neither raise nor count as `okx_passes_ended_full`, and every newer
fill would be lost.

The reading semantics are inherited from TRADEPAGES. Phase 173 makes them load-bearing: the token
is now printed by code, and runbook P4 and plan 03 close `OKX-ORDER-UNMEASURED` on it. The probe
already holds the evidence it would need to close this gap, because `_Call.newest_ts` is recorded
for every forced-pass call.
**Fix:** Also require the raw page to reach the newest fill the forced pass read on that type. If
it does not, there is no reading, never `True`:
```python
def _pass_newest_ms(calls: Sequence[_Call], inst_type: str) -> int | None:
    stamps = [c.newest_ts for c in calls
              if isinstance(c.params.get("type"), str)
              and c.params["type"].upper() == inst_type and c.newest_ts is not None]
    return max(stamps) if stamps else None

# in _okx_order_reading, after the raw read:
reading = okx_newest_first(raw)
if reading is True:
    first_ts = _first_ts(raw)  # int(data[0]["ts"]), already validated by okx_newest_first
    newest = _pass_newest_ms(calls, inst_type)
    if newest is None or first_ts < newest:
        return FIELD_ABSENT, "none"  # the page does not start at the newest fill: no reading
return reading, "none"
```
Add a test where the stub answers a descending page whose newest `ts` is older than the forced
pass's newest fill, and assert `okx_order_readings == 0` and `okx_order_gate == "unmeasured"`.

### WR-02: The Bybit gate has no code-derived aggregate. The summary carries `okx_order_gate` but no `bybit_transfers_gate`, so the `bybit-transfers:` line is derived by hand under a vacuous-ok rule (data-integrity, MEDIUM)

**File:** `analytics-service/scripts/allocator_history_probe.py:335-341` (`SUMMARY_RECORD_KEYS`), `:1631-1662` (`summarize`)
**Issue:** D-01 moved the OKX gate into code because a gate "worked out by hand from the printed
counts" is unreliable, as the test comment at the verdict table says. Its `members_with_trades >= 1`
guard stops vacuous truth. The Bybit half got no equivalent. `bybit_transfers_gate` exists only per
account, and plan 03 Task 1 step 8 derives the summary line by hand as "`bybit-transfers: ok` when
none is [unmeasured]". With zero applicable accounts, that rule prints `ok`. Two examples of how
that happens:
- a6 gains an OKX key, so its window is 90 days and it reads `not-applicable`;
- a6's selection is refused, so it gets the default `not-applicable`.

Plan 03's close rule for `BYBIT-TRANSFER-DEPTH-UNMEASURED` ("every applicable label's gate is `ok`")
is vacuously true in the same case. Today one guard stands in the way: plan 03's automated verify
regex demands at least one `bybit-transfers-kinds:` line. That is a planning artifact, not the
probe.
**Fix:** Derive the aggregate in code, beside the OKX one, with the same "absent evidence is never
`ok`" rule:
```python
applicable = [r["bybit_transfers_gate"] for r in records
              if r["bybit_transfers_gate"] != "not-applicable"]
bybit_gate = "ok" if applicable and all(g == "ok" for g in applicable) else "unmeasured"
# SUMMARY_RECORD_KEYS += ("bybit_accounts_applicable", "bybit_transfers_gate")
# validators: _is_count, _is_one_of(("ok", "unmeasured"))
```
Plan 03 would then copy the token instead of re-deriving it. Pin the zero-applicable case to
`unmeasured`.

### WR-03: In the success arm (`anchor_opening_agreed`), no test pins that the ordering read comes from the pre-diagnostic snapshot, and this is the arm a4 enters once its bills chain is fixed (data-integrity, MEDIUM)

**File:** `analytics-service/scripts/allocator_history_probe.py:1306-1315`; `analytics-service/tests/test_allocator_history_probe.py:2274` (`test_an_okx_anchor_that_passed_through_the_bills_check_prints_the_oracle_reading`), `:2246-2271` (`_anchoring_reader`)
**Issue:** The snapshot ordering is pinned in the refusal arm only, by
`test_the_refused_members_ordering_read_uses_the_forced_pass_instrument_type`, whose advisory pass
reads more rows on `futures`. The agreed arm also runs `_anchor_diagnostic` through the same wrapped
client. Its only test uses `_anchoring_reader`, which reads `swap` on both passes, and it sets no
`order_raw` and asserts nothing about `raw_calls` or `okx_order_readings`.

Suppose the success arm's `_okx_order_reading` call moved after the diagnostic, or was handed the
live `recorder.calls`. The reading would then describe the advisory pass and its instrument type,
and no test would fail. a4 is refused today because of the `chain_break`. Once OKXBILLSCHAIN lands
and the bills check agrees, a4 takes exactly this arm, and its reading becomes the one that decides
`okx-order:`.
**Fix:** Give `_anchoring_reader` the `advisory_inst_type` parameter that `_refusing_reader` has.
Add a test with forced `swap` pages (few rows), advisory `futures` pages (more rows) and
`order_raw=_fills("300", "200", "100")`. Assert `[c["instType"] for c in okx.raw_calls] == ["SWAP"]`,
`okx_order_readings == 1`, `trade_calls == 2`, and `anchor_diagnostic == "run"`.

### WR-04: The runbook paragraph states a different opening condition from the code-derived gate it cites (data-integrity, MEDIUM)

**File:** `docs/runbooks/marksource-okx-history-correction.md:286-295`
**Issue:** The edited P4 paragraph now says three things:
1. The entry "closes when `okx_order_readings` equals the number of OKX members that read trades
   and violations are 0". This omits full-page stops.
2. The code-derived `okx_order_gate` reads `ok` only with 0 violations AND 0 full-page stops.
3. "a rebuild runs only once the gate reads measured with 0 violations". `measured` is not a token
   of `_OKX_ORDER_GATES`.

Take a run with `okx_order_violations=0`, `okx_passes_ended_full=1` and readings equal to members.
The probe prints `okx_order_gate: violated`, yet the runbook's own sentences 1 and 3 read as
satisfied. An operator following this PROD write runbook could take that as a green light. The
rebuild's own `TruncatedTradeRead` on a full-page stop mitigates the write, but the runbook should
not contradict the token it now names.
**Fix:** State one condition and name the token in both places. For example: "It closes only when
the probe's summary `okx_order_gate` reads `ok` (readings equal OKX members with trades and above 0,
0 violations, 0 full-page stops) … and a rebuild runs only once `okx_order_gate` reads `ok`."

---

_Reviewed: 2026-10-28T10:45:43Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
