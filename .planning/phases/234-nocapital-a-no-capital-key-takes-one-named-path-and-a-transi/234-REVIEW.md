---
phase: 234-nocapital-a-no-capital-key-takes-one-named-path-and-a-transi
reviewed: 2026-11-25T11:14:08Z
depth: standard
files_reviewed: 6
files_reviewed_list:
  - analytics-service/services/allocator_equity_derive.py
  - analytics-service/services/allocator_equity_compose.py
  - analytics-service/services/job_worker.py
  - analytics-service/tests/test_allocator_equity_no_capital_exit.py
  - analytics-service/tests/test_derive_allocator_equity_job.py
  - analytics-service/tests/test_allocator_equity_inception.py
findings:
  critical: 1
  warning: 1
  info: 5
  total: 7
  necessity: 0
status: issues_found
---

# Phase 234: Code Review Report

**Reviewed:** 2026-11-25T11:14:08Z
**Depth:** standard
**Files Reviewed:** 6
**Status:** issues_found

## Summary

Scope is `git diff 29e5448e9..HEAD -- analytics-service`, judged against `234-CONTEXT.md` and the
four plans and SUMMARYs. The three phase suites pass at HEAD: `236 passed`.

Checked and clean:

- **NOCAP-02 revert.** The apply-loop revert restores every map the loop writes: anchors, null
  reasons, flows, dropped P&L, realized terminal, writer basis and departed end, and it clears
  `no_capital_exit_by_key`.
- **Compose arms.** The sibling `except NavReconstructionError` and `except Exception` arms do not
  double-handle. An exception raised inside the first handler is not caught by the second.
- **State after a compose revert.** No code after the compose reads the candidate-applied job maps
  except the empty-curve branch, and that branch reaches the same verdict either way.
- **Re-indent.** `git diff -w` of the apply loop shows only the new ledger gate, the try/except and
  the counter rename.
- **Strict `tiny_base_days` reader.** It matches the writer, which only stores canonical days:
  `tiny_base_day_list` goes through `_parse_day`'s round-trip check.
- **Out-of-window ruling.** The money math still holds after the change. A flow after the last
  return day is still unioned into the roll days and subtracted; only the counter changes.
- **NOCAP-03 cardinality.** Each key is counted once: selection, loop and compose are disjoint, and
  a revert replaces the loop's or the compose's own counts.

**The defects are in the new NOCAP-01 ledger proof.** Two shapes of stored ledger that carry no
evidence of an empty account still pass it. Both were reproduced end to end through
`run_derive_allocator_equity_job`: in each, a candidate exits and the book reads trustworthy. The
first defect shows that a premise of the locked "lower side" decision is false.

## Narrative Findings (AI reviewer)

## Critical Issues

### CR-01: The one-sided ledger proof accepts a ledger that shows itself to be incomplete, and the downstream guard the decision relies on does not run

**File:** `analytics-service/services/job_worker.py:17832` (gate), `analytics-service/services/job_worker.py:16733-16753` (`_no_capital_ledger_level` and its docstring)

**Issue:**

- The NOCAP-01 proof refuses only `ledger_level > DUST_NAV_FLOOR`, so any negative ledger sum counts as "proved empty".
- RESEARCH's own identity is `sum(F + P) = terminal - prev0`, and the proof's premise is `prev0 ≈ 0` on a full-history MT5 ledger.
- With a terminal of 0.0, a ledger of -20,000 means `prev0 = +20,000`: the stored deals are missing at least 20,000 of funding. Such a ledger is not evidence of an empty account.
- The account could be emptied: the missing deposit was withdrawn. It could also be funded: an 80,000 deposit is missing, 20,000 was withdrawn, the true balance is 60,000 and the live read is a transient zero, which is exactly the NOCAP-01 defect. The proof cannot tell these apart, yet it lets the key exit.

**The locked decision's premise fails.** CONTEXT `[Post-research]` (line 69) chose "Only the locked
'at or below DUST_NAV_FLOOR'" because "a ledger level far below zero is already refused by the
replay's zero-start and non-positive checks". The helper's docstring repeats this ("the replay's
zero-start and non-positive checks catch it downstream").

- The zero-start check (`replay_key_equity`, the `if opening_run:` block in `allocator_equity_derive.py`) runs only when `_opening_flow_run` is non-empty, that is, when a flow sits on the calendar day before the first return day. RESEARCH says the same: "whenever an opening flow run exists".
- On the writer basis, the backward roll from a 0.0 terminal through a withdrawal gives positive earlier levels, so the non-positive refusal never fires either.

**Reproduction.** A scratchpad test reusing `_nc_assemble`, `_nc_candidate`, `_nc_payload` and
`_compose_no_capital_book` builds an MT5 `nonpositive` key with returns on d1-d3, a terminal of 0.0
on d4, `composed_flows={d4: W}`, `composed_day_pnl` 0.0 on d1-d4, `dropped_pnl={d4: 0.0}`, and no
deposit anywhere.

| W | `is_trustworthy` | `degrade_reasons` | exited | field |
|---|---|---|---|---|
| -20,000 | True | `classified_rotation`, `window_truncated` | key-C exits on d3 | none |
| -500,000 | True | same | key-C exits on d3 | none |

In the -500,000 row key-C is composed at 500,000 on d1-d3 (20,000 in the -20,000 row) and then leaves; the curve totals also include key-A's 100,000. Nothing in the payload marks it.

**Why it matters.** This is the circular-proof class the phase exists to close, moved from the terminal to
the ledger. A funded MT5 key can leave a trustworthy book on a transient zero whenever its stored
deal ledger under-counts funding by at least the balance. Nothing upstream stops such a ledger from
being stored, and this was checked rather than assumed:

- `combine_mt5_deal_ledger` (`broker_dailies.py`) calls `reconstruct_nav_and_twr(..., full_history=True)`.
- In `chain_linked_twr` (`nav_twr.py`), `full_history` only decides whether day 0's near-zero base is flagged.
- A day-0 base of +20,000 is not refused anywhere on the MT5 path; only Deribit's native core runs `_assert_inception_reconciled`.

**This is a gap in the new gate, not a regression:** before this phase the same row exited on A2 alone, because a terminal of 0.0 is at or below the floor. The trigger needs an incomplete ledger. But the fix
is one comparison, and the decision explicitly relied on a guard that is conditional.

**Fix.** Make the proof two-sided, so it confirms what the premise needs: the ledger reaches about
zero. Both live PROD exits sit at -1.6e-11 (CONTEXT gate reading) and still pass. Every re-fixtured
MT5 book in the suite sums inside the band (0.0, 80.0, 0.5 x the floor), so no existing test flips:

```python
# job_worker.py, in the apply loop
if abs(_nc_ledger_level) > DUST_NAV_FLOOR:
    _nc_loop_refusals["ledger_level_funded"] += 1   # or a new closed token, e.g. "ledger_unreconciled"
    continue
```

If a new token is added, update `NO_CAPITAL_REFUSAL_REASONS` and its whole-set pin
(`test_no_capital_refusal_reasons_are_the_eleven_plan_01_to_03_tokens`). Then:

- Add the reproduction above as a RED-then-GREEN arm.
- Correct the docstring sentence and the CONTEXT line 69 rationale, both of which state a guard that does not exist for this shape.

Limits of this fix, which should be recorded with it:

- `abs()` narrows the hole but does not close it. A ledger missing a deposit D whose other deals net to about zero still sums near zero, while the real balance is D.
- A native-BTC MT5 key's sum carries RESEARCH A7's extra term, which can be negative. The two-sided check may then refuse such a key (to `dropped_key`), which is the safe direction.

## Warnings

### WR-01: A present but empty writer basis counts as proof of an empty account; the same row without the fields is refused

**File:** `analytics-service/services/job_worker.py:16750-16753`; the defect is pinned by `analytics-service/tests/test_derive_allocator_equity_job.py:4504`

**Issue:**

- `read_writer_basis` returns `({}, {})` for a row that carries `composed_flows: []` and `composed_day_pnl: []`. Only both fields absent or null returns None.
- `_no_capital_ledger_level(({}, {}))` returns `0.0`, which passes the proof. The unit test pins this: `assert _no_capital_ledger_level(({}, {})) == 0.0`.
- The job's own definition of "has a writer basis" (`job_worker.py:17756`, `if _k in stitched_kept or not _pnl_by_day_map: continue`) treats an empty day-P&L map as no basis.
- The writer never stores one: its gate requires `not _basis_day_pnl.empty`.
- So an MT5 row with empty basis lists carries no ledger evidence at all, yet it is "proved empty". The same row without the two fields is refused as `ledger_basis_absent`. Stored `key_inputs` rows are a trust boundary; that is why every neighbouring reader is strict.

**Reproduction.** An MT5 `nonpositive` key with returns on d1-d3, a terminal of 0.0 on d4, an
event flow of -20,000 on d4 and `dropped_pnl={d4: 0.0}`, composed through the job:

| Row variant | Result |
|---|---|
| with `composed_flows=[]`, `composed_day_pnl=[]` | `is_trustworthy=True`, key-C exits, no refusal field |
| without the fields | `dropped_key`, `{"ledger_basis_absent": 1}` |

**Fix.** Treat a basis with no day P&L as no proof, matching the writer's gate and line 17756.
Change the pinned assertion to `is None`.

```python
if basis is None or not basis[1]:
    return None
```

## Info

### IN-01: The candidate-fault arms leave no Sentry event and no stack, so a deterministic bug in the candidate path is absorbed silently

**File:** `analytics-service/services/job_worker.py:17899`, `analytics-service/services/job_worker.py:18336`

**Issue:**

- Both new `except Exception` arms catch programming errors (`TypeError`, `AttributeError` and so on) as well as data faults, and log one WARNING. The class-only content is the locked NOCAP-02 decision.
- The job's own comment at the `departed_history_unavailable` capture says a WARNING log reaches Sentry only as a breadcrumb.
- So a regression in the apply loop or the compose turns every affected book into `dropped_key` on every run. The only trace is the `candidate_exception` count in the stored payload and a warning with no traceback.

**Fix (compatible with the lock).** Add one `sentry_sdk.capture_message` with static text. Tag it
with the job id and `type(exc).__name__`, the pattern the `departed_history_unavailable` capture
already uses. Never include the exception text.

### IN-02: NOCAP-03's "every route" does not count a working no-capital key with inputs and no return rows

**File:** `analytics-service/services/allocator_equity_compose.py:698-703`

**Issue:**

- A working key with a `nonpositive` token, a `key_inputs` row and no return rows takes `NO_ANCHOR` + `MISSING_SERIES` + `DROPPED_KEY` in `null_anchor_without_returns`.
- The selection gate requires `api_key_id in last_return_day`, so that key never reaches a count.
- CONTEXT NOCAP-03 says the closed set "covers every route a no-capital key takes to `dropped_key`". Plan 01's route table does not record why this one is excluded.

**Fix.** Record the exclusion in the plan or SUMMARY. A key with no history was never a D-08
candidate, which is probably the right reason. Otherwise count it under its own token.

### IN-03: Only the D-10 refusal gets a job log line

**File:** `analytics-service/services/job_worker.py:17927-17934`

**Issue:** The new `ledger_basis_absent`, `ledger_level_funded`, `negative_terminal`,
`funded_terminal` and `no_stored_terminal` routes are counted in the payload, but unlike
`consumes_more_than_dust` they are never logged.

**Fix.** Log the whole merged counter once, counts only, instead of the single D-10 line.

### IN-04: Dead placeholder code in a test helper

**File:** `analytics-service/tests/test_allocator_equity_inception.py:379-380`

**Issue:** `row = inputs["derived"] if "derived" in inputs else None  # placeholder, replaced below`
followed by `del row` does nothing.

**Fix.** Delete both lines.

### IN-05: The "listed day inside the window" arm cannot fail on its own premise

**File:** `analytics-service/tests/test_allocator_equity_inception.py:482-493`

**Issue:**

- The book has no flow on the listed in-window day (day 3), and an in-window flow is never counted anyway.
- The arm only re-asserts that an unstated post-window flow counts, which `test_a_different_stated_day_keeps_the_post_window_flow_counted` already covers.
- A mutation that exempted every listed day regardless of position would still pass it. That is Rule 9: a test should encode why the behaviour matters.

**Fix.** Put the post-window flow's own day in the window as well, or delete the arm as a duplicate.
Then add an arm with a flow on a listed in-window day, asserting the replay is byte-identical to the
call without the list.

---

_Reviewed: 2026-11-25T11:14:08Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
