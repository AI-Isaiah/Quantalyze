---
phase: 173-rebuildgates-okx-trade-ordering-and-bybit-transfer-depth-are
reviewed: 2026-10-28T11:02:24Z
depth: standard
iteration: 2
files_reviewed: 3
files_reviewed_list:
  - analytics-service/scripts/allocator_history_probe.py
  - analytics-service/tests/test_allocator_history_probe.py
  - docs/runbooks/marksource-okx-history-correction.md
findings:
  critical: 0
  warning: 3
  info: 0
  total: 3
status: issues_found
---

# Phase 173: Code Review Report (round 2)

**Reviewed:** 2026-10-28T11:02:24Z
**Depth:** standard
**Files Reviewed:** 3
**Status:** issues_found

## Summary

Scope: the fix diff `34ec87bab..HEAD` (commits f473dc8d1, b1772495a, 6c393d241, a07a96ac1 and
03a097fbe) over the probe, its tests and the runbook. The edited `173-03-PLAN.md` GATES_OK chain was
also checked against the code's tokens. The surrounding code was read for context:
`_okx_order_reading`, `_row_inst_types`, `_pass_newest_ms`, `summarize`, the three `_probe_member`
arms, and the record assembly in `_probe_account`. The rebuild's OKX walk
(`services/equity_reconstruction.py` `_fetch_okx_inst_type_trades`, `OKX_INSTRUMENT_TYPES`) and
ccxt's `okx.fetch_my_trades` and `parse_trade` (the `timestamp` comes from the raw `ts`, so the
reach check compares like with like) were traced as well.

Measured locally:
- `pytest tests/test_allocator_history_probe.py -q`: 116 passed.
- `mypy --strict` on the probe: no issues.
- `tests/test_bybit_upnl_probe.py`: 47 passed. Its `SUMMARY_RECORD_KEYS` is independent of this one.
- Mutation probes, run through a scratch pytest plugin with no source edits:
  - a type-blind MIN in `_pass_newest_ms` goes RED (2 failed);
  - a type-blind MAX survives, but that direction only makes the check stricter;
  - a "min over each type's newest" mutant survives all 116 tests (see WR-02 below).
- Scenario probe: `_okx_order_reading` was called directly with a multi-page SWAP pass plus a SPOT
  pass of three fills in the same millisecond. It returns `('field-absent', 'none')`, and the gate
  reads `unmeasured` (see WR-01 below).

### Round-1 findings: verification

| id | status | evidence |
|---|---|---|
| WR-01 (page must reach the newest fill) | **fixed** | `allocator_history_probe.py:1188-1193`. The reach check is per type, and `_pass_newest_ms` keys on the forced-pass `type`. The test at `test_allocator_history_probe.py:594` rejects `newest - 1`, and the type-blind MIN mutant goes RED. The per-type keying is not fully pinned (WR-02 below). |
| WR-02 = SFH-1 (Bybit roll-up) | **fixed** | `summarize` derives `bybit_accounts_applicable` and `bybit_transfers_gate` (`ok` only when `applicable` is non-empty and all applicable accounts read `ok`). Both keys have emitter validators, `not-applicable` is refused as a summary token, and 9 parametrised cases pin the zero-applicable case to `unmeasured`. In plan 03, the `sed` and `grep -F` equality check extracts `ok\|unmeasured` and compares it against the summary line's `"bybit_transfers_gate":"<token>"`. That matches the emitter's `separators=(",", ":")`. `sc2-met` is guarded twice: by the new prose and by step 6's a6-label shape match, because a selection-refused record has `bybit_members=0` and cannot be a6. |
| WR-03 (agreed-arm snapshot pin) | **fixed** | `test_the_agreed_anchors_ordering_read_uses_the_forced_pass_instrument_type`. If the read used the live recorder after the diagnostic, `_row_inst_types` would add FUTURES and `raw_calls` would no longer be `["SWAP"]`. |
| WR-04 (runbook opening condition) | **partially fixed** | P4 (`:286-296`) is fixed and pinned. The runbook's opening "Where this stands" paragraph still states the old condition (WR-03 below). |
| SFH-2 (every instrument type) | **fixed, but over-tightened** | Every type with rows is now read. However, any type that "cannot say" now voids the member's whole reading, which breaks CONTEXT's discretion bound (WR-01 below). |

No CRITICAL or HIGH finding. Three MEDIUM findings are listed below. Redaction is unchanged and
sound: the new summary keys are a count and a closed token, the raw-read failure is still recorded
by allow-listed CLASS, and the leak strings stay pinned in the new SFH-2 cases.

## Narrative Findings (AI reviewer)

## Warnings

### WR-01: The SFH-2 fix voids a member's reading when ANY instrument type it read "cannot say". A multi-page OKX member with one single-order type gets no reading, which breaks CONTEXT's discretion bound and makes SC-1 unreachable (other: phase goal / locked-decision deviation, MEDIUM)

**File:** `analytics-service/scripts/allocator_history_probe.py:811-818` (`_row_inst_types`), `:1195-1199` (member aggregation)
**Issue:** `_row_inst_types` selects every type whose forced pass returned at least ONE row.
`_okx_order_reading` then returns `True` only when `len(readings) == len(inst_types)` and every
reading is `True`. Otherwise it returns `field-absent` or `None`, and `_probe_account` counts no
reading (`isinstance(r.order, bool)`). `okx_newest_first` returns `field-absent` in two cases:
- the raw page has fewer than two rows;
- all its `ts` values are equal.

Both are common shapes for a lightly used instrument type. One example: a single SPOT market order
filled against several makers in one match, which gives N fills at one millisecond.

Measured with a direct call:
- SWAP: 140 rows over two pages, raw answer newest first and reaching the newest fill.
- SPOT: 3 fills at one millisecond.
- Result: `('field-absent', 'none')`, then `okx_order_verdict(0, 0, 0, 1) == 'unmeasured'`.

Before the fix the busiest-type read gave this member `True`, so the gate read `ok`.

`173-CONTEXT.md:42` bounds this choice: "one instrument type (the busiest, as today) or every type
that returned at least two rows, **as long as each OKX member that read trades past one page carries
at least one reading**." This member read trades past one page and carries none. The phase boundary
says the OKX gate must come back `ok` or `violated`, "never `unmeasured`". Plan 03 turns `readings=0`
into `sc1-met: no` and a founder STOP. So a deploy and a PROD worker probe run can end unmet over a
type whose ordering the walk never depends on: a type whose whole window fits on one short page is
read in full whatever the order.

The new test case `{"SPOT": good, "SWAP": _fills("300")}` (`test_allocator_history_probe.py:626`)
does not show this, because there the type that cannot say is the 140-row SWAP pass, where voiding is
correct.
**Fix:** Require a reading only on types where order can be observed. Select a type only when its
forced pass read at least two distinct timestamps (the CONTEXT bound, tightened to distinct stamps
so a same-millisecond group does not count):
```python
def _row_inst_types(calls: Sequence[_Call]) -> list[str]:
    types: list[str] = []
    for kind, pass_calls in _passes(calls).items():
        stamps = [s for c in pass_calls for s in (c.newest_ts, c.oldest_ts) if s is not None]
        if isinstance(kind, str) and stamps and max(stamps) > min(stamps) and kind.upper() not in types:
            types.append(kind.upper())
    return types
```
A raw `field-absent` on a selected type still voids the member, so a type that should be measurable
but is not still fails closed. Add a case with SWAP 140 rows answered `good`, plus SPOT 3 rows at one
millisecond. Assert one raw call (SWAP), `okx_order_readings == 1`, and gate `ok`.

### WR-02: The WR-01 reach check is per instrument type, but no test can fail if it compares a type's page with ANOTHER type's newest fill. A false-ok mutant survives all 116 tests (data-integrity, MEDIUM)

**File:** `analytics-service/scripts/allocator_history_probe.py:847-857` (`_pass_newest_ms`), `:1188-1193`; `analytics-service/tests/test_allocator_history_probe.py:594`, `:626`, `:489` (`_newest_page`)
**Issue:** Every fixture that exercises the reach check gives every type the same newest fill,
`_ms(_TODAY)`: the `sp` and `sw1` pages and `_newest_page()`. So the per-type keying, the part that
makes the check sound when a member has several types, is not pinned.

The mutant `_pass_newest_ms = min over each type's max newest_ts` was run through a scratch plugin.
It compares every type's raw page with the OLDEST type's newest fill, and it passed 116/116. In
production that mutant accepts a SWAP page that starts below SWAP's own newest fill whenever SPOT's
newest fill is older. That is exactly the "descending page of the OLDEST rows" that WR-01 exists to
reject, and it would read `True` and feed `okx_order_gate: ok`.
**Fix:** Add one case with different per-type newest fills:
- the SPOT pages' newest fill is `_ms(_TODAY) - 10**9`, the SWAP pages' newest fill is `_ms(_TODAY)`;
- `order_by_type={"SPOT": <page starting at SPOT's newest>, "SWAP": <descending page starting at SPOT's newest>}`.

Assert `okx_order_readings == 0` and gate `unmeasured`. Then swap the roles: a SPOT page starting at
SWAP's newest is accepted for SPOT, and SWAP is `good`. Assert `ok`.

### WR-03: WR-04 is only half fixed. The runbook's opening paragraph still gates PROD writes on "the ordering gate reads measured with 0 violations", which a full-page-stop run satisfies (data-integrity, MEDIUM)

**File:** `docs/runbooks/marksource-okx-history-correction.md:36-38`; `analytics-service/tests/test_allocator_history_probe.py:1339`
**Issue:** The fix rewrote P4 (`:286-296`) to name `okx_order_gate` reading `ok` as the one opening
condition. The runbook's "Where this stands" paragraph, which every operator reads first, still says:
"Until the ordering gate reads measured with 0 violations, pre-flight P4 is a write STOP … nothing
from B'3a on runs."

This is the same contradiction round 1 flagged:
- `measured` is not a token of `_OKX_ORDER_GATES`;
- a run with `okx_order_violations=0` and `okx_passes_ended_full=1` prints `okx_order_gate: violated`,
  yet "measured with 0 violations" reads as satisfied.

The new pin, `test_the_runbook_names_the_code_derived_okx_gate_token_as_its_only_opening_condition`,
slices only the P4 entry (`text.index("`167.2.1.1.2.1-OKX-ORDER-UNMEASURED`: ")` up to the
ANCHOR-IMPLAUSIBLE entry). It cannot see this paragraph, so "only opening condition" is not what the
test proves. B'3a onward is the guarded enqueue of a PROD rebuild.
**Fix:** Replace the sentence with "Until the probe's summary `okx_order_gate` reads `ok`, pre-flight
P4 is a write STOP …". Widen the test so it asserts over the WHOLE runbook text:
```python
full = re.sub(r"\s+", " ", runbook.read_text(encoding="utf-8"))
assert "reads measured" not in full and "measured with 0 violations" not in full
```
and keep the P4-slice assertions as they are.

---

_Reviewed: 2026-10-28T11:02:24Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
