---
phase: 173-rebuildgates-okx-trade-ordering-and-bybit-transfer-depth-are
reviewed: 2026-10-28T14:00:00Z
depth: standard
iteration: 4
files_reviewed: 2
files_reviewed_list:
  - analytics-service/scripts/allocator_history_probe.py
  - analytics-service/tests/test_allocator_history_probe.py
findings:
  critical: 0
  warning: 2
  info: 0
  total: 2
status: issues_found
---

# Phase 173: Code Review Report (round 4, final re-review after fixer round 3)

**Reviewed:** 2026-10-28T14:00:00Z
**Depth:** standard
**Files Reviewed:** 2, plus the `173-03-PLAN.md` Task 1 GATES_OK chain, as the brief asked
**Status:** issues_found

## Summary

**Scope**
- The fix diff `b81e9813e..HEAD`: commits 41a4ef24d, 8800f14a2 and 35d92107c, plus the c1a7aae46 report.
- That covers `allocator_history_probe.py`, its tests, and the `173-03-PLAN.md` Task 1 verify chain, `fails_when` and acceptance criteria.

**Measured locally (read-only; no source, plan or ledger edits)**
- `pytest tests/test_allocator_history_probe.py -q` (worktree, main-checkout venv): 123 passed.
- I extracted the GATES_OK chain verbatim from `173-03-PLAN.md:107`, changing only `S` and `RG_SP`. Then I ran it in `scratchpad/r4dry/` against SUMMARY files built from the probe's own `_account_record`, `summarize` and `emit_record`. Each file has PROD's shape: a1, a2, a3 and a5 refused `account_key_not_working`; a4 OKX with a 90-day window; a6 Bybit with a 730-day window reading `ok`.
- The fixer's negatives hold. The chain refuses each of these:
  - `bybit-transfers-unread: none` beside four refused records;
  - an unread line that omits a5;
  - a kinds `gate=unmeasured` against an `ok` record.
- Three new negatives still print GATES_OK: the two cases in WR-01 and the one in WR-02.

### Round-3 findings: verification

| id | status | evidence |
|---|---|---|
| R3 WR-01 / R3-SFH-1 (summary gate over-shut on a selection refusal) | **fixed, matches D-05** | `summarize` (`allocator_history_probe.py:1697`, `:1721-1726`) is now "applicable non-empty and every applicable `ok`". A selection-refused record carries the `not-applicable` default from `_account_record` (`:1562-1564`), so it neither opens nor shuts the gate. That is D-05's wording exactly. Four cases are pinned in `test_the_summary_bybit_gate_is_ok_only_with_an_applicable_account_and_all_applicable_ok` (`test_allocator_history_probe.py:1486-1520`): PROD's shape reads `ok`, refusals alone read `unmeasured`, and a refusal never hides an `unmeasured`. Plan 03 step 8 adds the `bybit-transfers-unread:` line. The must_haves and TODO close rule (3b) use the D-05 wording, and `(no applicable label)` is now tied in both directions to `"bybit_accounts_applicable":0,`. |
| R3 WR-02 / R3-SFH-2 (kinds values unchecked; duplicate lines) | **fixed for the kinds lines and the singleton lines; residual gaps in the new unread check and the evidence lines** | Each kinds line's `gate=`, `deposits=` and `withdrawals=` is compared with exactly one account record. Kinds labels are unique, and the kinds count equals `bybit_accounts_applicable`. The summary record and the `okx-order:`, `okx-order-reading:`, `bybit-transfers:` and `bybit-transfers-unread:` lines are each count-pinned to 1. The parenthesis labels must equal the `gate=unmeasured` kinds labels. All of this was confirmed by dry run. The new `bybit-transfers-unread:` comparison can still be defeated (WR-01), and the evidence lines are still shape-only (WR-02). |
| R3 WR-03 (`_row_inst_types` skipped multi-page / stamp-less types) | **fixed** | `_row_inst_types` (`:812-827`) skips a type only when `rows < _OKX_PAGE_ROWS` and its stamps share one millisecond. A stamp-less type has empty `stamps`, so it is not skipped, and it fails shut through the `newest is None` branch (`:1201`). A multi-page type at one millisecond is read, and `okx_newest_first` returns `field-absent`. `test_a_multi_page_inst_type_with_no_usable_timestamps_still_voids_the_members_reading` (`:704`) pins both cases with `readings == 0` and gate `unmeasured`, and the round-2 short one-ms case still reads `ok`. Both docstrings now describe the shipped rule. |

**No new defect in the code half of this diff.**
- `summarize`, `_row_inst_types` and the docstrings match D-05 and CONTEXT's discretion bound.
- The short-page carve-out is sound. A page shorter than `_OKX_PAGE_ROWS` is the whole range, so the walk loses nothing to ordering on that type.
- Redaction is unchanged: no new record key, and no new value path.

Both findings below are in the operator chain this round rewrote. Both are MEDIUM and data-integrity. There is no CRITICAL or HIGH finding.

## Narrative Findings (AI reviewer)

## Warnings

### WR-01: The new `bybit-transfers-unread:` check can be satisfied while a refused account goes unnamed: duplicate labels are accepted, and the pasted account records are never counted against the summary's `accounts` (data-integrity, MEDIUM)

**File:** `.planning/phases/173-rebuildgates-okx-trade-ordering-and-bybit-transfer-depth-are/173-03-PLAN.md:107` (verify), `:108` (`fails_when`), `:111` (acceptance criteria)

**Issue:** D-05 lets a selection-refused account leave the Bybit roll-up only because "Accounts refused at selection are named on a `bybit-transfers-unread:` line". That line is now the only control that keeps those accounts visible when `bybit-transfers: ok` closes `167.2.1.1.2.1-BYBIT-TRANSFER-DEPTH-UNMEASURED` (step 3b names them from it). The chain checks it two ways:
- every named label has a pasted record with `selection` not `ok`;
- the number of named labels equals the number of pasted account records with `selection` not `ok`.

Both checks can be met while a refused account is missing from the line.

1. **Duplicate labels.** The chain has no uniqueness test on the unread labels; the kinds labels get `uniq -d`, the unread labels do not.
   - Input: PROD's shape with `bybit-transfers-unread: a1, a1, a2, a3`.
   - Each named label resolves to a refused record, and the count is 4 = 4.
   - **GATES_OK** (dry run, `scratchpad/r4dry/unread_dup.md`).
   - a5, a refused account, is never named.
2. **Records not pasted.** Nothing compares the number of `"record":"account"` lines with the summary's `"accounts":N`. Step 5 copies the records by hand out of Railway's `key=value` log view, so a partial paste is a realistic error.
   - Input: the paste keeps only a4's and a6's records, with `bybit-transfers-unread: none` (the summary still reads `"accounts":6`).
   - The refused count is 0 = 0.
   - **GATES_OK** (dry run, `scratchpad/r4dry/drop_refused.md`).
   - Four refused accounts vanish from both the records and the unread line.

Either way, `bybit-transfers: ok` and a closed BYBIT-TRANSFER-DEPTH entry go into tracked records with no trace of the unread accounts. That is the outcome D-05's unread line exists to prevent. The acceptance criterion at `:111` ("`bybit-transfers-unread:` names exactly the account records whose `selection` is not `ok`") is true only relative to whatever was pasted.

**Fix:** Inside the chain, pin the record census to the summary, and pin unique labels on both the records and the unread line:
```sh
&& test "$(grep -acF '"record":"account"' "$S")" = "$(grep -aF '"record":"summary"' "$S" | sed -E 's/.*"accounts":([0-9]+),.*/\1/')" \
&& test -z "$(grep -aF '"record":"account"' "$S" | sed -E 's/^\{"account":"([^"]+)",.*/\1/' | sort | uniq -d)" \
&& test -z "$(grep -aE '^bybit-transfers-unread: ' "$S" | sed -E 's/^bybit-transfers-unread: //; s/^none$//' | tr -d ' ' | tr ',' '\n' | grep . | sort | uniq -d)"
```
Then add "a duplicated `bybit-transfers-unread:` label" and "pasted account records fewer or more than the summary's `accounts`" to `fails_when`.

### WR-02: `bybit-transfers-evidence:` lines are only shape-checked: the label need not be an applicable label, labels may repeat, and the values are never compared with the record, yet `fails_when` says a duplicated evidence line fails (data-integrity, MEDIUM)

**File:** `.planning/phases/173-rebuildgates-okx-trade-ordering-and-bybit-transfer-depth-are/173-03-PLAN.md:107` (verify), `:108` (`fails_when`: "a `bybit-transfers-kinds:` or `bybit-transfers-evidence:` line is missing, duplicated or in excess")

**Issue:** For evidence lines, the chain checks only two things: the evidence count equals the kinds count, and every evidence line matches the shape regex. It does not check:
- that each evidence label is a kinds (applicable) label;
- that evidence labels are unique;
- any of the seven values against the label's record (`deposits_in_window`, `withdrawals_in_window`, the three age buckets, the two `fill_before` booleans).

Measured: in PROD's shape, the line `bybit-transfers-evidence: a3 …` beside the single kinds line for a6 prints **GATES_OK** (`scratchpad/r4dry/evidence_wrong_label.md`). a3 is a revoked, refused account with no record values behind any of the copied numbers. With two applicable labels, one label's evidence line can be duplicated and the other's dropped, the case `fails_when` names as failing.

These values are D-02's corroboration evidence, which "the founder judges at the checkpoint". They feed the D-04 rebuild question in Task 2 and are copied verbatim into the TODOS ledger paragraph (step 3b, "every `bybit-transfers-kinds:` and `bybit-transfers-evidence:` value"). A mis-copied `oldest_fill=` or `fill_before_deposit=` goes into tracked ledger text and informs a PROD rebuild decision that cannot be undone. Bounds:
- it cannot open the gate itself (D-02);
- it is still a stated check that does not exist.

**Fix:** Mirror the kinds loop:
```sh
&& test "$(grep -aE '^bybit-transfers-evidence: ' "$S" | cut -d' ' -f2 | sort)" = "$(grep -aE '^bybit-transfers-kinds: ' "$S" | cut -d' ' -f2 | sort)" \
&& ! { grep -aE '^bybit-transfers-evidence: ' "$S" | while read -r _ lbl diw wiw of od ow fbd fbw; do
     L=$(grep -aF "{\"account\":\"$lbl\"," "$S")
     printf '%s\n' "$L" | grep -aF "\"deposits_in_window\":${diw#*=}," | grep -aF "\"withdrawals_in_window\":${wiw#*=}," \
       | grep -aF "\"oldest_fill_age_bucket\":\"${of#*=}\"" | grep -aF "\"oldest_deposit_age_bucket\":\"${od#*=}\"" \
       | grep -aF "\"oldest_withdrawal_age_bucket\":\"${ow#*=}\"" \
       | grep -aE "\"oldest_fill_before_oldest_deposit\":\"?${fbd#*=}\"?," \
       | grep -aqE "\"oldest_fill_before_oldest_withdrawal\":\"?${fbw#*=}\"?," || echo MISMATCH
   done; } | grep -q MISMATCH
```
The kinds labels are already unique and equal the applicable set, so the sorted-set equality also proves the evidence labels are unique. As a simpler alternative, reword `fails_when` and the acceptance criteria to state that evidence lines are operator-copied and only shape-checked. The ledger paragraph would then carry an unverified value knowingly, not silently.

---

_Reviewed: 2026-10-28T14:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
