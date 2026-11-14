---
phase: 155-parityharness
reviewed: 2026-11-13T23:17:17Z
depth: standard
round: 3
diff_base: 14299a037
head: 30abc1303
files_reviewed: 9
files_reviewed_list:
  - analytics-service/scripts/mt5_parity_run.py
  - analytics-service/services/mt5_parity_capture.py
  - analytics-service/services/mt5_parity_findings.py
  - analytics-service/tests/fixtures/mt5_parity/surface_matrix_synthetic.json
  - analytics-service/tests/test_mt5_parity_capture.py
  - analytics-service/tests/test_mt5_parity_cli.py
  - analytics-service/tests/test_mt5_parity_findings.py
  - src/__tests__/mt5-parity-capture-sql.test.ts
  - src/__tests__/mt5-parity-surfaces.test.ts
findings:
  critical: 0
  warning: 2
  info: 2
  total: 4
  necessity: 0
status: issues_found
---

# Phase 155: Code Review Report (round 3)

**Reviewed:** 2026-11-13T23:17:17Z
**Depth:** standard
**Files Reviewed:** 9 (the fix diff `14299a037..30abc1303`, `.planning` excluded)
**Status:** issues_found

## Summary

This round re-reviews fixer round 2, which landed three commits:

- `851691ae7`: manifest version 2 carries `synthetic`, and both loaders check the manifest against the contract.
- `d96144fae`: a presence check now covers every compared figure.
- `30abc1303`: the read-only SQL gate is an allowlist of calls, with block-comment, row-lock and escape rules.

I read the full source diff. I also read the code the diff depends on: the `_compare_account` comparison and gate loops, `_classify_account`, `_cmd_census` and `_verified_rows`, the surfaces harness cell builders, and `src/lib/figure-gate.ts`.

**Test runs at head, in the worktree:**
- From `analytics-service/`: `python3 -m pytest tests/test_mt5_parity_*.py tests/test_mt5_report_parser.py -q` gave **315 passed**.
- From the repo root: `npx vitest run src/__tests__/mt5-parity-*.test.ts` gave **3 files, 245 passed**.

**How each fix was proven.** On a byte copy of the tracked `analytics-service/` tree in the session scratchpad, I neutered each Python fix and watched the named test go RED, then restored from the byte backup. Neuters N1-N5 are in the table below. One copy-only failure, `test_whole_row_slices_carry_exactly_their_tables_columns`, failed before any neuter too. It reads a file outside the copied tree, so it is an artifact of the partial copy and not a finding. The TS loader fix and the SQL allowlist I verified by reading the code and its tests. For the allowlist I also ran a verbatim copy of `callNames`/`violations` against probe statements and executed one probe on a throwaway local PostgreSQL 16 cluster (WR-01). No committed file other than this one was modified.

**The real capture was not exercised this round.** Inspecting the gitignored run directory was refused by the session's permission layer, and I did not work around that. No value from it appears in this file. Note that a run directory sealed before `851691ae7` carries a version-1 manifest, so both loaders now refuse it until it is re-sealed. That is the intended effect of the WR-02 fix.

**Verdict.** Round-2 WR-01 (synthetic provenance), WR-02 (truncated manifest) and WR-03 (presence, as scoped) are fixed. The SQL-gate MEDIUM is only partly fixed: a `U&"…" UESCAPE '…'` identifier puts a literal between the function name and its `(`, so every admin builtin passes the static gate, and the database runs it under READ ONLY. The presence fix also brought a new defect to light. CAGR and Sharpe are compared across surfaces only when the gate says `shown`, and the new rule exempts `short` on the false premise that `short` withholds the figure. So an account under one year of record gets no CAGR or Sharpe parity check at all.

I read `necessity-review.md`. The fix diff adds no guard against a state that cannot occur, so `necessity: 0`.

## Round-2 disposition

| ID | Status | Evidence (code; the test that fails without it) |
|---|---|---|
| WR-01 (WR-02 residual: sealed synthetic capture judged as real via `--capture-dir`) | **fixed** | `load_bundle` writes `provenance.json` (`mt5_parity_capture.py:543`). `seal_capture` binds it into the manifest as `synthetic` (`:393-401, 452-453`). `load_capture` refuses a manifest without a boolean `synthetic` (`:486-487`) and exposes it on `Capture` (`:516`). Both CLI branches now return `capture.synthetic` (`mt5_parity_run.py:163, 168`), so the existing refusal at `:186` covers `--capture-dir` too. **N1** (force `synthetic = False` in the seal) turns RED: `test_cli_refuses_a_sealed_synthetic_capture_dir_judged_against_a_real_worksheet`, `test_a_sealed_bundle_says_it_is_synthetic_and_a_real_run_dir_says_it_is_not`, `test_cli_refuses_a_synthetic_capture_bundle_judged_against_a_real_worksheet`, `test_cli_red_proof_exits_three_when_the_expectation_is_wrong`. The two real-input red-proof tests were moved to a dir sealed without the marker (`_sealed_as_real`), so they still exercise the real branch. Residual: IN-01. |
| WR-02 (WR-03 residual: loaders accept a manifest short of the contract) | **fixed** | Python `load_capture` refuses a manifest version other than 2 (`mt5_parity_capture.py:482-485`) and any contract slice missing from `files`. **N2** (drop the missing-slice raise) turns RED: `test_load_refuses_a_manifest_that_lists_fewer_slices_than_the_contract`. Version: `test_load_refuses_a_pre_fix_manifest_and_one_without_a_synthetic_flag`. TS `loadRealCapture` throws on version ≠ 2 (`mt5-parity-surfaces.test.ts:397`) and on an unlisted slice instead of substituting `[]` (`:402`). The WR-06 test's `sealedDir` now writes a complete set of empty slices. Test (read, not neutered): `throws on a slice the manifest does not list, and on a pre-fix manifest version…` (`:1020`). |
| WR-03 (SFH-5b residual: max drawdown, Sharpe, CAGR presence) | **fixed as scoped** (a new defect it exposed is WR-02 below) | The presence rule now applies to `max_drawdown` (`mt5_parity_findings.py:551-561`), CAGR (`:594-600`) and Sharpe (`:626-632`). It honours `_NOT_CARRIED_BY_DESIGN`, extended with the panel's and the live baseline's `cagr` (`:304-310`), which matches the harness builders (`mt5-parity-surfaces.test.ts:624-625, 635-636`). The fixture's `share_card.max_drawdown` change from null to a value matches the harness, which computes `fin(h.maxDd)` (`:608`). **N3**, **N4** and **N5** (remove each presence branch) turn the matching parametrisations of `test_a_surface_that_drops_a_figure_it_is_built_to_carry_is_a_finding` RED: N3 the cagr row ×2, N4 the sharpe row ×2, N5 the three max_drawdown rows ×2. |
| SQL-gate MEDIUM (round-2 silent-failure: denylist bypassable), with round-2 IN-03 | **partly fixed**, see WR-01 below | The denylist became `ALLOWED_CALLS` (`mt5-parity-capture-sql.test.ts:110-147`). `callNames` (`:157-166`) empties strings, unquotes plain quoted identifiers and joins dotted names, and three new rules refuse `/*`, a backslash or `$`, and locking clauses (`:196-198`). The test table at `:434-516` covers every bypass named in round 2, plus `pg_sleep_for`, `pg_reload_conf` and schema-qualified calls in every spelling. A `U&"…" UESCAPE '…'` identifier still returns no violation and executes. |
| IN-01 (demo override erases the refusal reason) | not fixed (not attempted) | `services/mt5_parity.py` is not in the fix diff. |
| IN-02 (SFH-5a look-ahead scans to end of document) | not fixed (not attempted) | `services/mt5_parity_report.py` is not in the fix diff. |
| IN-03 (read-only gate admits side-effecting builtins) | **fixed** except the `UESCAPE` form | Superseded by the allowlist. The residual is WR-01. |
| IN-04 (one key without a single live strategy aborts the matrix) | not fixed (not attempted) | `buildAccount` is unchanged. |
| IN-05 (Gate A always required, undocumented; `scan` per-directory) | not fixed (not attempted) | `services/mt5_parity.py` and `scripts/mt5_parity_records.py` are not in the fix diff. |

## Narrative Findings (AI reviewer)

## Warnings

### WR-01: The read-only SQL gate passes a `U&"…" UESCAPE '…'` function call, so any admin builtin reaches a PROD capture file

**File:** `src/__tests__/mt5-parity-capture-sql.test.ts:157-166, 191-198`
**Issue:** `callNames` finds a call only where an identifier is followed directly by `(`. PostgreSQL also accepts a Unicode-escaped quoted identifier with a custom escape character: `U&"pg_sl!0065ep" UESCAPE '!'`. The lexer folds the whole construct into one identifier token, so a call can be written as `U&"…" UESCAPE '!' (…)`. The construct contains no backslash or `$`, so the escape rule does not fire. After the scan, the identifier is `__quoted__` and the `UESCAPE ''` literal sits between it and the parenthesis, so the call regex never matches.

Reproduced with a verbatim copy of `callNames` and `violations`. Each statement below returns `[]`:
```sql
SELECT U&"pg_sl!0065ep" UESCAPE '!' (1.0);
SELECT U&"pg_reload_conf" UESCAPE '!' ();
```
Run inside `BEGIN; SET TRANSACTION READ ONLY; …` on a throwaway local PostgreSQL 16 cluster, the first slept one second. The second returned `t`, and the server logged `received SIGHUP, reloading configuration files`. The exec gate (`mt5-parity-capture-sql-exec.test.ts`) uses the same READ ONLY wrapper on a cluster where every builtin exists, so it passes these too. Both gates are green for a capture file that reloads PROD's configuration or sleeps on it.

This is latent: the 14 committed files are clean, and the bypass needs a committer to write it. That is why it is not tagged user-facing or data-integrity. It is still the exact class the round-2 MEDIUM named: the gate's stated contract is "a call is refused unless this set names it" (`:104-106`), and this call is not refused.
**Fix:** Refuse the Unicode-escape forms outright, since no capture file needs them, and add a test row for each.
```ts
// in violations(), beside the escape rule
if (/\bU&["']/i.test(text) || /\bUESCAPE\b/i.test(text)) found.push("unicode-escape");
```
```ts
["a Unicode-escaped call", `SELECT U&"pg_sl!0065ep" UESCAPE '!' (1);`, "unicode-escape"],
["a Unicode-escaped name", `SELECT U&"pg_sleep"(1);`, "unicode-escape"],
```
A smaller hardening, Info-level, can go in the same edit. The syntax words in the allowlist (`as`, `by`, `from`, `in`, `select`, `then`, `when`, …) also admit a quoted function of that name, for example `"from"(1)`. Map a quoted identifier to `__quoted__` whenever its name is one of those words.

### WR-02: CAGR and Sharpe are never compared across surfaces when the gate says `short` (or is unknown), and the new presence rule exempts `short` on a false premise

**File:** `analytics-service/services/mt5_parity_findings.py:526-532` (new in `d96144fae`), `:589, 602, 621, 634` (pre-existing), `analytics-service/tests/test_mt5_parity_findings.py:444-459`
**Issue:** The figure gate in this app never withholds a figure for being short. `src/lib/figure-gate.ts:205-211` says *"The window only qualifies a figure (short or full); it never withholds one"*, and `gatedValue` (`:225-228`) returns null only for `withheld`. The harness maps `full` to `shown` and passes `short` through as `short` (`mt5-parity-surfaces.test.ts:422-424`). It maps an unknown record to a `null` gate, and that figure is also displayed (figure-gate.ts:52-54, "an absent record is unknown and shows the value"). Three problems follow:

- **Pre-existing, and conformant to plan 08:120-122.** The CAGR and Sharpe anchors require `gate == "shown"` (`:589, 621`), and the value comparisons skip any cell whose gate is not `shown` (`:602, 634`). When every surface's gate is `short`, which is every account with between 60 observations / 90 days and one year of record, no CAGR or Sharpe comparison runs at all. The gate loop sees `short` = `short` and agrees.
- **New in this diff.** `_should_carry` now also exempts a `short` gate from the presence rule, with a docstring saying `short` "legitimately withholds it" (`:527-528`). The `[short]` parametrisation of `test_a_figure_the_cells_own_gate_withholds_is_not_a_presence_finding` pins that premise.
- **Same root, `null` gate.** A cell whose gate is `null` (unknown record) and whose value differs is skipped by the value compare (`!= "shown"`) and by the gate loop (`state is None`).

Reproduced with `classify_matrix` on a copy of the committed `surface_matrix_synthetic.json`, SYN-B. The baseline has 4 findings, including `scenario_composer_book.sharpe`.

| mutation | SYN-B findings |
|---|---|
| every `shown` CAGR/Sharpe gate set to `short` | 3: the baseline's `scenario_composer_book.sharpe` finding **disappears** |
| …and `owner_list_card` drops CAGR and Sharpe (null) | 3: no presence finding |
| …and `owner_list_card` CAGR and Sharpe ×3 | 3: no value finding |
| `owner_list_card` CAGR ×3 with its gate `null`, the rest `shown` | 4: the baseline only, no CAGR finding |

A surface that shows a different CAGR or Sharpe, or a dash, beside the factsheet therefore reads as agreeing, for exactly the accounts in their first year. MT5-09's cross-surface claim does not hold for them. This conflicts with plan 08:120-122, which treats `short` like `withheld`. Under Rule 7 the more recent and more tested source wins: figure-gate.ts, together with the 2026-11-07 KPI-gate decision that zoomed and short windows always show. The plan wording needs a recorded correction, not a silent fork.
**User-facing.**
**Fix:** Treat every gate state except `withheld` as displayed, and keep `short` vs `shown` as the separate gate-disagreement finding it already is.
```python
_DISPLAYED = lambda state: state != "withheld"

def _should_carry(cell, figure):
    return (figure not in _NOT_CARRIED_BY_DESIGN.get(cell.surface, frozenset())
            and cell.gate.get(figure) != "withheld")

cagr_anchor = _first(cells, lambda c: _DISPLAYED(c.gate["cagr"]) and c.cagr is not None)
...
if cell is cagr_anchor or not _DISPLAYED(cell.gate["cagr"]) or cb is None or abs(ca - cb) <= TOL:
    continue
```
Make the same change for Sharpe. Then:
- change the `[short]` parametrisation at `test_mt5_parity_findings.py:444` so it expects a presence finding;
- add a test where every gate is `short`, one surface's Sharpe or CAGR differs, and a finding must appear;
- add the same test with a `null` gate;
- record the plan-08 correction in CONTEXT.

## Info

### IN-01: A provenance marker that is present but not exactly `{"synthetic": true}` seals as real, and the TS loader ignores `synthetic`

**File:** `analytics-service/services/mt5_parity_capture.py:396-401`, `src/__tests__/mt5-parity-surfaces.test.ts:390-397`
**Issue:**
- `seal_capture` treats a `provenance.json` that parses but is `{"synthetic": "true"}`, `[true]`, `{"synthetic": 1}` or `{}` as real. Reproduced on a scratch copy: all four loaded with `synthetic = False`. Only `load_bundle` writes the marker, so this needs a hand edit. It is still a fail-open default where the file's presence already says "this came from a bundle".
- `loadRealCapture` checks `manifest_version` but never reads `synthetic`. A sealed synthetic dir therefore builds a `mode: "real"` surface matrix, and `findings` (`mt5_parity_records.py:_cmd_findings`) also ignores `capture.synthetic`.

**Fix:** In `seal_capture`, refuse a present marker that is not exactly `{"synthetic": true}`. Have `loadRealCapture` throw when `manifest.synthetic !== false`, and have `_cmd_findings` refuse when `capture.synthetic` is true.

### IN-02: `census` renders from a version-1 manifest

**File:** `analytics-service/scripts/mt5_parity_records.py:81-90, 122-135`
**Issue:** `_cmd_census` and `_verified_rows` read `sealed/manifest.json` directly and do not apply the new version or completeness checks in `load_capture`. Both census files are still re-hashed against the manifest, so no wrong record results. It does mean a pre-fix seal still produces a tracked `155-CENSUS.md` while `verdict`, `findings` and the surface harness refuse that seal. The commands now disagree on which seals they accept.
**Fix:** Route the manifest read through one helper that applies `MANIFEST_VERSION`, or call `load_capture(run_dir)` first in `_cmd_census`.

---

_Reviewed: 2026-11-13T23:17:17Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
