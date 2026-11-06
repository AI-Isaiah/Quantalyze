---
phase: 173-rebuildgates-okx-trade-ordering-and-bybit-transfer-depth-are
reviewed: 2026-10-28T12:30:00Z
depth: standard
iteration: 3
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

# Phase 173: Code Review Report (round 3, final)

**Reviewed:** 2026-10-28T12:30:00Z
**Depth:** standard
**Files Reviewed:** 3
**Status:** issues_found

## Summary

**Scope**
- The fix diff `b7040f092..HEAD` (commits d07645a63, 1b505c2f5, a62ae56a4, b9fcbd2ef and 8abb41d9b). It covers the probe, its tests, the runbook, and the `173-03-PLAN.md` Task 1 GATES_OK chain.
- One whole-phase pass over `git diff 4be15811a..HEAD -- analytics-service/ docs/`, looking for any path where a gate token reads `ok` without evidence.

**Measured locally (read-only, no source edits)**
- `pytest tests/test_allocator_history_probe.py -q`: 119 passed.
- A scenario script in the session scratchpad called `_okx_order_reading` directly with a fake client. Two cases: a 140-row SPOT pass with no timestamps, and a 140-row SPOT pass whose timestamps are all one millisecond, each beside a newest-first SWAP pass. Both returned `(True, 'none')` with raw calls `['SWAP']`, and `okx_order_verdict(0, 0, 1, 1) == 'ok'` (WR-03).
- The GATES_OK chain's `grep -F` comparison was run against a synthetic file holding two `okx-order:` lines. It passes when either line matches the summary (WR-02).
- The latest PROD probe record set was read with `git show feat/172-okxanchor:…/172-05-SUMMARY.md`. a1, a2, a3 and a5 read `"selection":"account_key_not_working"`, a4 reads `ok` with a 90-day window, and a6 reads `ok` with a 730-day window. TODOS.md:13241-13243 records those four accounts' Bybit keys as revoked, and the founder closed them "Accept as recorded" (WR-01).

### Round-2 findings: verification

| id | status | evidence |
|---|---|---|
| WR-01 (a type that cannot say voided the member) | **fixed, with a new fail-open edge** | `_row_inst_types` (`allocator_history_probe.py:811-822`) now needs two distinct timestamps. `test_an_inst_type_that_cannot_show_an_order_owes_the_member_no_reading` pins the named case. The new criterion also drops multi-page and stamp-less types (WR-03 below). |
| WR-02 (reach check not pinned per type) | **fixed** | In `test_each_inst_types_page_must_reach_that_types_own_newest_fill`, case 1 gives SWAP a page that starts at SPOT's newest fill. A min-over-types `_pass_newest_ms` would accept that page, giving readings 1 and `ok`, so that mutant goes RED. Case 3 RED-s the type-blind MAX mutant. |
| WR-03 (runbook opening paragraph) | **fixed** | `marksource-okx-history-correction.md:36-37` names `okx_order_gate` reads `ok`. The pin now asserts over the whole text. A grep of the runbook for `measured`, `violation` and `ordering gate` finds no other stale opening condition. |
| R2-SFH-1 (summary `ok` beside an unread Bybit account) | **fixed as stated, but over-broad** | `summarize` (`:1716-1722`) now fails shut on ANY selection refusal. With PROD's measured state, that makes the summary token permanently `unmeasured`, and plan 03 has no valid line for the result (WR-01 below). |
| R2-SFH-2 (GATES_OK compares only the Bybit token) | **partially fixed** | `okx_order_gate` and `okx_order_readings` are now compared. The per-label `gate=` comparison that the same finding named is not added, and duplicate lines defeat the comparison (WR-02 below). |
| R2-SFH-3 (zero-applicable branch could never pass) | **fixed** | The kinds and evidence greps are now conditional on `"bybit_accounts_applicable":0,`. With alphabetical keys, the next key is `bybit_transfers_gate`, so the anchor holds. |

There is no CRITICAL or HIGH finding. Three MEDIUM findings follow; two of them were introduced by this round's fixes. Redaction is unchanged and sound: no new record key, and no new value path to stdout.

## Narrative Findings (AI reviewer)

## Warnings

### WR-01: The R2-SFH-1 fix makes the summary `bybit_transfers_gate` permanently `unmeasured` at PROD's measured state. It contradicts the carried gate wording and the TODO close condition, and plan 03 step 8 has no valid `bybit-transfers:` line for the state it creates (other: locked-decision deviation and ledger integrity, MEDIUM)

**File:** `analytics-service/scripts/allocator_history_probe.py:1716-1722` (`summarize`), `:1559` (selection-refusal arm); `analytics-service/tests/test_allocator_history_probe.py:1438-1466`; `.planning/phases/173-rebuildgates-okx-trade-ordering-and-bybit-transfer-depth-are/173-03-PLAN.md:25`, `:101` (step 8), `:107` (verify)

**Issue:**

*The new rule.* `"ok" if applicable and all(g == "ok" …) and all(r["selection"] == "ok" for r in records)` fails shut on a selection refusal of ANY token, on ANY account.

*What it does at PROD's state.* The latest PROD probe (172-05, 2026-10-28) shows four of six accounts refused `account_key_not_working`: a1, a2, a3 and a5. Their only Bybit keys are revoked at the venue, and the founder closed that "Accept as recorded" (TODOS.md:13241-13243). The rebuild's own `_select_account_crawl_keys` refuses those accounts, so no rebuild can ever touch them. Even so:
- The 173-03 run's summary token is `unmeasured` whatever a6 measures. SC-2's live reading cannot open the roll-up until the founder reconnects four revoked keys.
- That contradicts the carried wording in `173-CONTEXT.md`: "`bybit-transfers: ok` only when every Bybit account **whose window reaches 729 days back** shows BOTH …". A refused account has no window, and `window_days` is `field-absent`.
- It also contradicts the CONTEXT close condition for `167.2.1.1.2.1-BYBIT-TRANSFER-DEPTH-UNMEASURED`: "closes when deposits and withdrawals older than 365 days are counted separately on a real Bybit key".
- Plan 03's must_have (`:25`) closes that entry only on the summary token. Its parenthetical, "at least one applicable label and every applicable label `ok`", no longer describes the rule, so the entry cannot close in this phase.

*The operator chain breaks on the most likely outcome.* Take a6 reading `ok`: summary `unmeasured`, `bybit_accounts_applicable` 1, and a1/a2/a3/a5 `not-applicable`. Step 8 then says to write `unmeasured (<every label whose own gate is unmeasured>)`, and that list is empty. `unmeasured (no applicable label)` is false, because 1 label applies. Neither form is valid. The verify accepts both of these wrong answers and prints GATES_OK:
- the false `(no applicable label)`, because it never checks that this form appears only with `bybit_accounts_applicable` 0;
- `(a1, a2, a3, a5)`, labels whose own gate is `not-applicable`, against the instruction.

A false sentence then goes into a tracked records file.

*The pin protects the wrong rule.* The new parametrised case `(("not-applicable","ok"), 1, "unmeasured", True)` pins this over-broad behaviour. No case models PROD's shape: four refused accounts with no Bybit window, plus a6 `ok`.

**Fix:** This is a semantic choice between two readings of the gate. Surface it to the founder rather than leaving it silently decided by a fixer. Two coherent options:

(a) **Revert the selection clause.** This restores the CONTEXT wording. A refused account cannot be rebuilt, because the rebuild refuses at the same selection, so a summary `ok` beside it opens nothing. Keep R2-SFH-1's concern visible instead of gating on it: have step 8 add a `bybit-transfers-unread: <labels refused at selection>` line.

(b) **Keep failing shut, but make it nameable.** In the selection-refusal arm, give an account that holds a Bybit key its own record gate `unmeasured`, so the label shows up in the parenthesised list:
```python
except er.ForcedRebuildRefusedError as exc:
    holds_bybit = any(str(r.get("exchange")) == "bybit" for r in account_rows)
    return _account_record(label, run_date, selection=exc.reason,
                           bybit_transfers_gate="unmeasured" if holds_bybit else "not-applicable")
```
Then drop the `selection` clause from `summarize`. The rule becomes "applicable and every applicable reads `ok`" again, so an OKX-only refusal no longer shuts the Bybit roll-up. Update the must_have parenthetical and the TODO close rule to match, and record in CONTEXT that the entry stays open until the four revoked keys are reconnected or the founder decides otherwise.

Under either option, tighten the verify so that `(no applicable label)` is accepted only beside `"bybit_accounts_applicable":0,`:
```sh
{ ! grep -aqF 'unmeasured (no applicable label)' "$S" || grep -aF '"record":"summary"' "$S" | grep -aqF '"bybit_accounts_applicable":0,'; }
```
Also add a `summarize` case for PROD's shape: four selection-refused records plus one applicable `ok` record. Assert the token the founder chooses.

### WR-02: GATES_OK still does not compare each `bybit-transfers-kinds:` line's `gate=` with its record (the unfixed half of R2-SFH-2), and duplicate gate lines turn every `grep -F` comparison into an any-of match (data-integrity, MEDIUM)

**File:** `.planning/phases/173-rebuildgates-okx-trade-ordering-and-bybit-transfer-depth-are/173-03-PLAN.md:107` (verify), `:111` (acceptance criteria)

**Issue:**

*The per-label `gate=` is never checked.* R2-SFH-2 named two gaps: the OKX tokens, and "per-label `bybit-transfers-kinds:` `gate=` is not compared with its record". Only the first was fixed. The acceptance criterion at `:111` still promises "each `bybit-transfers-kinds:` line's `gate=` equals that label's `bybit_transfers_gate` value", and nothing mechanical checks it. Three things make this gap matter now:
- After WR-01 the summary token is `unmeasured` on every run, so the per-label `gate=` is the only Bybit token Task 2 can act on. Task 2's context says to offer `rebuild` for "`bybit_transfers_gate` `ok` for a Bybit label".
- A mis-copied `gate=ok` for a6, whose record reads `unmeasured`, would offer the founder a 730-day PROD rebuild over a shut gate without the override line.
- A recompute "has no undo" (runbook "Rollback").

The verify also requires only ONE kinds line and ONE evidence line, not one per applicable label. The `deposits=` and `withdrawals=` values are never compared either.

*Duplicate lines defeat the comparison.* Each comparison builds its `grep -F` pattern from `$(grep -aE '^okx-order: ' "$S" | sed …)`. When the SUMMARY holds two such lines, the substitution yields two newline-separated patterns, and `grep -F` matches if EITHER matches. This was measured on a synthetic file with:
- summary `"okx_order_gate":"unmeasured","okx_order_readings":0`;
- an `okx-order: ok` line and an `okx-order: unmeasured` line.

The token comparison passed, and the `sc1-met: yes` precondition (`^okx-order: (ok|violated)$`) was satisfied by the stray line. The readings comparison and the `bybit-transfers:` comparison have the same shape. So does `grep -aF '"record":"summary"'` when two summary records are pasted, for example from a re-run. The plan's own words are "exactly one line", but nothing enforces that.

**Fix:** Pin the count of every copied line, and compare each label line with its own record. For example, inside the chain:
```sh
test "$(grep -acF '"record":"summary"' "$S")" = 1 \
&& test "$(grep -acE '^okx-order: ' "$S")" = 1 \
&& test "$(grep -acE '^okx-order-reading: ' "$S")" = 1 \
&& test "$(grep -acE '^bybit-transfers: ' "$S")" = 1 \
&& test "$(grep -acE '^bybit-transfers-kinds: ' "$S")" = "$(grep -aF '"record":"summary"' "$S" | sed -E 's/.*"bybit_accounts_applicable":([0-9]+),.*/\1/')" \
&& ! grep -aE '^bybit-transfers-kinds: ' "$S" | while read -r _ lbl dep wd g; do
     grep -aF "\"account\":\"$lbl\"" "$S" | grep -aF "\"bybit_transfers_gate\":\"${g#gate=}\"" \
       | grep -aF "\"deposits_older_365d\":${dep#deposits=}," | grep -aqF "\"withdrawals_older_365d\":${wd#withdrawals=}," || echo MISMATCH
   done | grep -q MISMATCH
```
In this form a mismatch prints `MISMATCH`, and the final `! … | grep -q MISMATCH` fails the chain. Also add "a duplicated gate line or summary record" and "a kinds line whose values differ from its record" to `fails_when`.

### WR-03: The R2 WR-01 fix narrows `_row_inst_types` below CONTEXT's bound ("every type that returned at least two rows"). A multi-page type whose rows carry no timestamp, or one millisecond, is now skipped, and the member reads `True`, so `okx_order_gate` can read `ok` with no evidence on that type (data-integrity, MEDIUM)

**File:** `analytics-service/scripts/allocator_history_probe.py:811-822` (`_row_inst_types`), `:1192-1197` (reach check), `:851-861` (`_pass_newest_ms`)

**Issue:**

*The new rule.* The selection keeps a type only when `stamps and max(stamps) > min(stamps)`. Before this round, a type with rows but no parseable `timestamp` was selected. `_pass_newest_ms` then returned `None`, the reach check set `FIELD_ABSENT`, and the member's reading was voided: fail shut. Now such a type is never selected. The member's reading becomes `True` from its other types, and the `newest is None` branch at `:1196` is unreachable for every selected type. A fail-shut path has been turned into a skip.

*The justification only holds for one short page.* The docstring argues that a one-millisecond type "cannot show an order, and the walk reads it in full whatever the order". That holds only for a type that fits on one short page. The rule does not check that: a pass of 100 or more rows over several calls, all at one millisecond, is also skipped, though it read past one page.

*Measured with a direct call.* SWAP 100+40 rows newest first, plus SPOT 100+40 rows. With SPOT stamp-less, and again with SPOT at one ms, the result is `(True, 'none')` with raw calls `['SWAP']`, then `okx_order_verdict(0,0,1,1) == 'ok'`.

*Bounds.*
- CONTEXT's discretion bound is "every type that returned at least two rows". Both cases returned 140 rows and are dropped.
- Likelihood is low: ccxt's OKX `parse_trade` sets `timestamp` from `ts`, and 100+ fills in one millisecond on one type is rare.
- But this is exactly an `ok` with no evidence on a type the walk paged, and it was introduced by this round.

*Stale docstrings.* The module docstring item 4 (":46-49": "EVERY instrument type that pass's own calls returned rows on") and `_okx_order_reading`'s docstring ("no typed pass with rows") still describe the old rule.

**Fix:** Skip a type only when its rows PROVE it cannot show an order AND it fits on one short page. Keep every other type with at least two rows, so stamp-less rows fail shut through the existing `newest is None` branch:
```python
def _row_inst_types(calls: Sequence[_Call]) -> list[str]:
    types: list[str] = []
    for kind, pass_calls in _passes(calls).items():
        rows = sum(c.rows for c in pass_calls)
        stamps = [s for c in pass_calls for s in (c.newest_ts, c.oldest_ts) if s is not None]
        one_ms_short_page = rows < _OKX_PAGE_ROWS and bool(stamps) and max(stamps) == min(stamps)
        if isinstance(kind, str) and rows >= 2 and not one_ms_short_page and kind.upper() not in types:
            types.append(kind.upper())
    return types
```
The round-2 test (3 SPOT fills in one ms, one page) still passes. Add two cases, each beside a good SWAP pass, and assert `okx_order_readings == 0` and gate `unmeasured` for both:
- SPOT 140 rows over two calls with `timestamp` absent;
- SPOT 140 rows over two calls at one millisecond.

Update both docstrings to the rule that ships.

---

_Reviewed: 2026-10-28T12:30:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
