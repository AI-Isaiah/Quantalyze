---
phase: 231-bybitreads-a-bybit-read-covers-every-coin-settle-type-window
reviewed: 2026-11-23T00:00:00Z
depth: standard
files_reviewed: 3
files_reviewed_list:
  - analytics-service/scripts/bybitreads_probe.py
  - analytics-service/tests/test_bybitreads_probe.py
  - analytics-service/tests/_trade_pages.py
findings:
  critical: 0
  warning: 4
  info: 8
  total: 12
  necessity: 0
status: issues_found
fix_status: medium_fixed
fix_iteration: 1
---

# Phase 231: Code Review Report

**Reviewed:** 2026-11-23
**Depth:** standard
**Files Reviewed:** 3
**Status:** issues_found

## Summary

Scope: the counts-only Bybit read probe from plan 231-02 (`scripts/bybitreads_probe.py`), its tests, and the venue fakes in `tests/_trade_pages.py`. I also read the code the probe calls: `ReadOnlyRecordingExchange` / `failure_token` (`scripts/derivegaps_probe.py`), `assert_sanitized`, `sig3`, `fetch_funding_bybit`, `fetch_ccxt_transfers` / `_read_bybit_transfer_window`, `fetch_bybit_unified_flows`, `pair_onchain_with_unified`, `eligible_key_predicate`, `_make_exchange_client` and the legacy reader `_fetch_raw_trades_bybit`.

**Redaction contract: holds.** Every value that `emit_record` lets through is a closed token, a non-negative int, a bool, a 3-significant-figure float, a `k<n>` label or a run date. Validation errors name the path and never the value. stderr carries only exception type names. Logging is turned off in `main()`, which the plan's wrapper invokes (`python -m scripts.bybitreads_probe`). No other stdout emitter is reachable.

**Read-only contract: holds.** Every venue call goes through a section view, and no measure function touches the raw client. I grepped the installed ccxt Bybit `fetch_balance`, `is_unified_enabled` and `fetch_currencies` for the methods they call internally, and every one is a `privateGet*` endpoint (see IN-04).

The suite passes: 74 passed.

**Main defects.** Two are about the readings themselves:
- A malformed venue reply is read as a natural end of data, so a section reports `complete` (or `ok` with a measured 0) on a truncated read.
- A failed or refused inverse closed-pnl read is not counted as a section failure.

Two are about the exit code and its tests:
- The probe exits 0 when it measured no key at all.
- The tests cannot catch either exit-code gap.

I reproduced the first two and the exit-0 case with a throwaway test file, which has been removed (the worktree status is clean).

The necessity rubric was read and applied. The call ceilings that the page caps make unreachable (A legacy: 108 of 110; A windowed: 400 of 900; C: 25 of 40) are a deliberate budget layer on a PROD key. They fall under the rubric's defence-in-depth exception, so none is a necessity finding.

Ratings use the project's five levels: MEDIUM is a `WR-` entry, and LOW and INFO are `IN-` entries. Under the project rule, only the MEDIUM findings are actionable.

## Warnings

### WR-01: A malformed venue reply reads as a natural end of data, so a cut-short read reports `complete`

**Severity:** MEDIUM (data integrity of the evidence plans 03 and 04 decide on)
**File:** `analytics-service/scripts/bybitreads_probe.py:442-449` (root cause). It feeds `:484-489` (`_walk_query`), `:598-602` (the sweep), `:764-767` (`_paged_rows`) and `:904` (funding row count).
**Issue:** `_result_page` returns `([], "")` when the reply is not a dict, `result` is not a dict, or `list` is not a list. Every caller reads that as a normal empty page:
- **Section A.** `_walk_query` returns `"empty_page"`, which is in `_NATURAL_ENDS`, so the walk counts as a clean end. Reproduced: a legacy cursor page answered `{"retCode":0,"result":null}` gives `trade_read_state: complete`, `trade_legacy_end: empty_page`, `trade_window_verdict: truncated`. A legacy walk that really does continue past week one but receives one malformed page mid-walk would print a false `truncated`. That verdict decides plan 04.
- **Sweep.** The walk reads as complete with a low page count, and `trade_sweep_pages_max_in_window` sizes plan 04's per-window cap (OQ7).
- **Section C.** `_paged_rows` returns `[]`, so the category reads `ok` with `positions_open_* = 0`. That is a measured zero from an unread answer, which breaks the module's own "never 0" rule. The inverse closed-pnl count can read 0 the same way.
- **Section D.** Row counts silently come out lower.

The repo's own readers refuse this exact shape loudly: `services/funding_fetch.py` (M-0928, "the silent-truncation pattern. Fail loud instead of reporting SUCCESS on zero rows") and `_refuse` in `services/bybit_unified_flows.py`.
**Fix:** Make `_result_page` raise on a malformed envelope. Every caller already sits inside a `try` that maps an exception to `failed` / `incomplete` / `field-absent`:
```python
def _result_page(reply: Any) -> tuple[list[dict[str, Any]], str]:
    result = reply.get("result") if isinstance(reply, dict) else None
    if not isinstance(result, dict) or not isinstance(result.get("list"), list):
        raise ValueError("execution/position reply has no result.list")  # no venue text
    items = result["list"]
    cursor = result.get("nextPageCursor")
    rows = [item for item in items if isinstance(item, dict)]
    return rows, cursor if isinstance(cursor, str) else ""
```
In `measure_funding`, which counts rows only after a completed walk, a malformed reply has already failed inside the fetcher. Raising here is still the consistent rule. Add one test per section that feeds `{"retCode":0,"result":None}` and asserts a non-`complete` / non-`ok` state.

### WR-02: A failed or refused inverse closed-pnl read is not a section failure, so the probe can exit 0 without the census C19 input

**Severity:** MEDIUM
**File:** `analytics-service/scripts/bybitreads_probe.py:836-855`, `:955-974`
**Issue:** The closed-pnl block swallows every exception (`except Exception: pass`) and leaves only `inverse_closed_pnl_rows_30d: field-absent`. `section_failures` builds its Section C test from the balance and the three position states only, so this read never counts. Reproduced: a `NetworkError` on the closed-pnl read gives `section_failures == 0`. Two contracts are broken:
- The module docstring's exit contract: "0 ... no section failed".
- The plan's run rule: "exit 1 when any eligible key is unmeasurable or any section failed".

No state token separates a venue refusal from a failure either, so the plan's derived `exposure: ... inverse_closed_pnl_30d=<n>` line has nothing to report, and the Pitfall 6 founder question (asked on `refused`/`failed`) never fires for this read.
**Fix:** Add a closed-vocabulary state key beside the count, on the pattern of the position reads, and count it in `section_failures`:
```python
# _SECTION_C_KEYS += ("inverse_closed_pnl_read",); validator _is_token_or_absent(POSITION_READ_STATES)
except (ccxt.PermissionDenied, ccxt.BadRequest):
    values["inverse_closed_pnl_read"] = "refused"
except Exception:
    values["inverse_closed_pnl_read"] = "failed"
else:
    values["inverse_closed_pnl_read"] = "ok"
# section_failures: "failed" in (*position_states, record["inverse_closed_pnl_read"])
```
The record vocabulary changes, so the fingerprint moves with it.

### WR-03: The probe exits 0 when it measured no key

**Severity:** MEDIUM
**File:** `analytics-service/scripts/bybitreads_probe.py:1096-1100`, `:1010`
**Issue:** `run()` returns `EXIT_OK` whenever `keys_unmeasurable == 0 and sections_failed == 0`. Two cases satisfy that while measuring nothing:
- An empty key list: `keys == 0`.
- Only ineligible keys: each counts as `key_not_eligible`, which is excluded from `keys_unmeasurable`.

PROD holds exactly one active Bybit key (231-CONTEXT). If it is revoked or disconnected between booking and the run, the one-shot probe reports success with no measurement. The plan's key-line count check then passes at 0 = 0, and the derived "worst over keys" verdict lines have no input. That is the vacuous pass the project's fail-loud rule forbids.
**Fix:**
```python
if summary["keys_measured"] == 0:
    print("refused: no eligible key was measured", file=sys.stderr)
    return EXIT_FAILED
```
Add a test with only a revoked key that asserts `EXIT_FAILED`. Update the EXIT CODES docstring to match.

### WR-04: The tests cannot catch a wrong exit code or a dropped `section_failures` arm

**Severity:** MEDIUM (test reliability: the exit code is the probe's gate signal)
**File:** `analytics-service/tests/test_bybitreads_probe.py:957`, `:797-833`
**Issue:**
- Line 957 asserts `exit_code == (bp.EXIT_FAILED if summary["sections_failed"] else bp.EXIT_OK)`. That restates `run()`'s own return expression, so it passes whatever the run did. The scratch run of that exact fixture shows `exit 0, sections_failed 0`, which is the value the test should pin.
- No test drives a failed section through `run()` to `EXIT_FAILED`. `test_run_a_key_that_fails_outside_the_sections...` covers only the unmeasurable-key arm.
- In `test_summarize_counts_verdicts...` the only failing section is k2's funding timeout, so the A, B and C arms of `section_failures` are never visited. Deleting the B line, or the `"failed" in position_states` term, keeps the suite green. WR-02 and WR-03 are exactly the kind of gap this blind spot lets through.

**Fix:** Change line 957 to `assert exit_code == bp.EXIT_OK and summary["sections_failed"] == 0`. Add a parametrized `section_failures` test with one row per arm: `trade_read_state="incomplete"`; `trade_sweep_complete=False`; `deposit_verdict="unread"`; `stable_non_usdt_present=FIELD_ABSENT`; a position `"failed"`; `funding_state="timeout"`. Each row expects 1, and a `"refused"` position expects 0. Add one `run()` test where a section fails (for example `closed_pnl` / funding forced to fail) and assert `EXIT_FAILED`.

## Info

### IN-01: `ccxt.BadRequest` is read as a venue refusal, so a malformed probe request looks like a scope finding

**Severity:** LOW
**File:** `analytics-service/scripts/bybitreads_probe.py:825-826`
**Issue:** ccxt maps Bybit retCode 10001 (parameter error) to `BadRequest`. A wrong request shape from the probe therefore reads `refused`. That token is not counted as a failure, yet it triggers the Pitfall 6 founder question ("refuse the whole derivative read"). This matches the repo's existing inverse-scope convention in `funding_fetch.py`, which is why it is LOW.
**Fix:** Treat only `PermissionDenied` as `refused`, or record the BadRequest arm as a separate `rejected` token so the founder question is not asked on a probe bug.

### IN-02: `_paged_rows` treats a repeated cursor as a complete read

**Severity:** LOW
**File:** `analytics-service/scripts/bybitreads_probe.py:766`
**Issue:** `next_cursor == cursor` returns the rows collected so far as a full answer, and the category reads `ok`. Section A treats the same condition as `stuck`, which is not natural and makes the read incomplete. Under `_paged_rows`'s own docstring rule, a repeated cursor is a lower bound too.
**Fix:** Return `None` when `next_cursor == cursor` (a non-empty page with a stuck cursor).

### IN-03: `funding_inverse_skipped` reads false when the fetcher skips inverse after its first page

**Severity:** LOW
**File:** `analytics-service/scripts/bybitreads_probe.py:900-908`; `services/funding_fetch.py:703-732`
**Issue:** `fetch_funding_bybit` skips the inverse category on a `BadRequest` / `PermissionDenied` on any page, not only the first. If inverse succeeds for some windows and is then refused, at least one inverse reply exists. The probe then prints `funding_inverse_skipped: false` with `funding_state: complete`, while `funding_rows_inverse` is only a lower bound.
**Fix:** Derive the skip from the call count rather than the success count. If the view counted more inverse calls than successful inverse replies, the inverse walk was cut short. This needs the view to record attempts, or wrap the call to note a refused inverse request.

### IN-04: `view.fetch_balance` runs the inner client's internal calls uncounted

**Severity:** LOW
**File:** `analytics-service/scripts/bybitreads_probe.py:794`; `scripts/derivegaps_probe.py:227-247`
**Issue:** `fetch_balance` resolves to the inner client's bound method, and the view counts it as one call. Internally, ccxt then issues `privateGetV5AccountWalletBalance`, `privateGetV5AccountInfo`, `privateGetV5UserQueryApi` (and possibly `privateGetV5AssetTransferQueryAccountCoinsBalance`) directly on the inner client, outside the view. I checked the installed ccxt and every one is a GET, so read-only holds. The module docstring's "counts each call" claim is wider than the truth.
**Fix:** Change the docstring to say a unified read counts as one call, or read the wallet balance through `private_get_v5_account_wallet_balance` on the view.

### IN-05: `deploy_fingerprint` moves only with vocabulary sizes, not with the code

**Severity:** LOW
**File:** `analytics-service/scripts/bybitreads_probe.py:1103-1118`
**Issue:** The docstring says the fingerprint shows "the worker is shown to run the reviewed code". It changes only when exit codes or tuple lengths change, so a verdict, ceiling or redaction change of the same shape gives the same line. The plan fixes this exact format, and binds the deployed commit separately through the `merge-base --is-ancestor` check, so this is LOW.
**Fix:** Append a short sha256 of `Path(__file__).read_bytes()` (for example the first 12 hex characters). If the format must stay plan-exact, narrow the docstring claim.

### IN-06: Two read-only test pins are weaker than they look

**Severity:** LOW
**File:** `analytics-service/tests/test_bybitreads_probe.py:1067-1078`, `:1093-1096`
**Issue:**
- `test_the_view_refuses_write_methods[edit_order]` cannot fail. `_Inner` has no `edit_order`, so an `AttributeError` is raised even if the view let the name through.
- `_WRITE_NAMES` has no pattern for camelCase `privatePost*`, `private_put_` / `privatePut*`, `private_delete_` / `privateDelete*`, `edit_order` or `set_leverage`.

The view refuses all of these, so this is defence in depth that is thinner than intended.
**Fix:** Add `edit_order` to `_Inner`. Extend the regex with `privatePost|private_put_|privatePut|private_delete_|privateDelete|edit_order|set_leverage`.

### IN-07: The label and date regexes accept a trailing newline

**Severity:** INFO
**File:** `analytics-service/scripts/bybitreads_probe.py:162-163`, `:282-283`
**Issue:** `^...$` with `re.match` matches `"k1\n"`. Both values are built internally (`f"k{index}"`, `strftime`), and JSON would escape the newline, so this cannot leak.
**Fix:** Use `pattern.fullmatch(x)` or end the patterns with `\Z`.

### IN-08: A row with a missing or malformed `execTime` counts toward the totals but never after the first week

**Severity:** LOW
**File:** `analytics-service/scripts/bybitreads_probe.py:452-454`
**Issue:** `_exec_time_ms` maps an unreadable `execTime` to 0. The row is counted in `trade_windowed_rows` and `trade_legacy_rows`, but `_count_after` never counts it. A field drift would push the verdict toward `undecided` with no signal.
**Fix:** Count unreadable stamps separately and treat a non-zero count as a reason to report the read as `incomplete`.

## Silent-failure hunter (parallel review, MEDIUM and above)

Run alongside this review on the same diff. M1, M2 and M3 duplicate WR-01, WR-02 and WR-03 and are fixed under those ids. The rest are new MEDIUM findings and are in the fix scope.

### SF-M4: A legacy walk that stops at its page cap or on a repeated cursor, or a cut-off start-less walk, still exits 0
`section_failures` checks only `trade_read_state` and the sweep, so `trade_legacy_end` in `page_cap`/`stuck` and an absent `trade_startless_rows` leave section A unfailed. That contradicts the module's exit contract ("no section stopped at a page ceiling"). Fix: count a non-natural legacy end, or an absent start-less count, as an A failure.

### SF-M5: A skipped inverse funding category reads as 0 (supersedes IN-03)
`funding_rows_inverse` starts at 0 and stays 0 when inverse is skipped. `summarize` adds it into `funding_rows_inverse_total: 0`. A refusal partway through the walk gives a partial count with `skipped` false. Fix: set it to `field-absent` whenever any inverse window was skipped or refused.

### SF-M6: A position-read `ccxt.BadRequest` is labelled `refused`, and `refused` does not fail the section (supersedes IN-01)
A probe parameter bug would be pasted into the public record as a venue refusal. Fix: only `PermissionDenied` maps to `refused`. A `BadRequest` maps to `failed`, or to a separate token that counts as a failure.

### SF-M7: A position row with an unparseable `size` counts as flat
`_is_open_position` returns False, so the category reads `ok` with an under-count. Fix: refuse a row without a parseable `size`, so the category reads `failed`.

### SF-M8: The summary's `trade_sweep_pages_max` is a lower bound when any sweep is incomplete
The sweep feeds plan 04's per-window page cap. Fix: compute the maximum only over keys whose sweep completed, or report `field-absent` while `trade_sweep_incomplete > 0`.

Under M1 the hunter also flagged two cases that WR-01's fix must cover: `_collect` silently dropping a row without an `execId`, and an unparseable `execTime` read as 0 (IN-08). A non-empty page with such a row must refuse.

## Round 2 (re-review of the round-1 fixes)

The code reviewer and the silent-failure hunter re-reviewed `5640ec930..c182c4452`. Both confirm that every round-1 MEDIUM is fixed. The reviewer ran 17 single-point mutants and every one was killed by that finding's own test. The fixes introduce no new problem.

### R2-WR-01 (MEDIUM, fix scope): section C reads a repeated cursor as a complete read
`_paged_rows` returns its rows when `next_cursor == cursor`, so a venue that repeats its cursor gives `ok` and a lower-bound count. This feeds positions and the inverse closed-pnl windows. SF-M4 made the same condition a failure in section A. Fix: return `None` on a repeated cursor (the caller already maps it to `failed`), and add a test.

**Fix status (round 2):** fixed in a7ac99721. `_paged_rows` returns `None` on a repeated cursor; two tests (inverse position read, closed-pnl window) pin `failed` with the count `field-absent`, each seen RED with the fix neutered. Fingerprint unchanged, `bybitreads 0 1 48 24 5 3`.

### R2-SF-1 (MEDIUM, not fixed, with the reason): `deploy_fingerprint` cannot tell `40e1303ff` from HEAD
Only the round-1 fix that added a key changed the vocabulary sizes. Not fixed, for two reasons. The ship PR is squash-merged, so no intermediate fix commit is ever deployed alone. And plan 02 Task 3 binds the run to the deployed commit separately. The fingerprint shows that the import path works; it does not identify the commit.

Round-2 LOW and INFO items (start-less cap semantics, the coupling in the SF-M5 skip rule, the section D `no_list` test gap, plan 02 record-list wording, `held > 0` against the docstring, rows dropped by the shared on-chain parser) are recorded in the scratchpad round-2 file only and are not acted on.

---

_Reviewed: 2026-11-23_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_

---

## Fix status (round 1)

Scope: WR-01, WR-02, WR-03, WR-04, SF-M4, SF-M5, SF-M6, SF-M7, SF-M8. No other IN-xx was touched.
Gates after the last fix, run from `analytics-service/`: `tests/test_bybitreads_probe.py` 116 passed;
CI mypy strict command: no issues found in 142 source files (`scripts/` is outside that surface, and
`mypy --strict` on the probe alone is clean too). The deploy fingerprint moved from
`bybitreads 0 1 47 24 5 3` to `bybitreads 0 1 48 24 5 3`, and the fingerprint test now pins the line.

| Id | Status | Commit | What changed |
|----|--------|--------|--------------|
| WR-01 (with IN-08) | fixed | c82c1a9f5 | `_result_page` raises on a reply without `result.list` or with a non-object row; `_collect` raises on a row without `execId` or a readable `execTime`; section D counts its rows inside its `try` |
| WR-02 | fixed | 40e1303ff | new closed-vocabulary key `inverse_closed_pnl_read` (`ok`, `refused`, `failed`), counted in the section C arm of `section_failures` |
| SF-M6 (with IN-01) | fixed | 40e1303ff | only `PermissionDenied` maps to `refused`; a `BadRequest` on a position or closed-pnl read is `failed` |
| SF-M4 | fixed: requires human verification | 090861d66 | a legacy end of `page_cap` or `stuck`, or an absent start-less count, fails section A. A key busy enough that its start-less walk hits its 8-page cap now exits 1 by design of the finding |
| WR-04 | fixed | 090861d66 | the run test pins exit 0 with 0 failed sections; a funding failure is driven through `run()` to exit 1; a parametrized test visits every A, B, C and D arm of `section_failures` |
| WR-03 | fixed | 9e2a3cab1 | `run()` exits 1 with `refused: no eligible key was measured` when `keys_measured` is 0; EXIT CODES docstring updated |
| SF-M5 (with IN-03) | fixed | 71a821795 | the inverse skip is derived from a call that raised (calls beyond recorded requests), so a refusal on any page reads `funding_inverse_skipped: true` and `funding_rows_inverse: field-absent` |
| SF-M7 | fixed | 8453c4412 | a position row without a readable `size` raises, so its category reads `failed` |
| SF-M8 | fixed: requires human verification | 5010077ef | `trade_sweep_pages_max` is `field-absent` while any measured sweep is incomplete (the other option, a maximum over completed keys only, was not taken) |

Not fixed, by scope: IN-02, IN-04, IN-05, IN-06, IN-07 (LOW and INFO survivors stay in this file only).
