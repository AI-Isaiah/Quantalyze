---
phase: 229-mt5derive2
reviewed: 2026-11-24T18:55:00Z
depth: deep
reviewed_at_sha: 3e49de6a63399ad17b5359cf5cf7ddb8b3a9afd9
source_identical_at: 51f725f88
diff_base: e5759fa76
files_reviewed: 12
files_reviewed_list:
  - analytics-service/scripts/mt5_soak.py
  - analytics-service/services/allocator_equity_derive.py
  - analytics-service/services/analytics_runner.py
  - analytics-service/services/job_worker.py
  - analytics-service/services/nav_twr.py
  - analytics-service/services/transforms.py
  - analytics-service/tests/test_allocator_equity_writer_basis.py
  - analytics-service/tests/test_csv_analytics_runner.py
  - analytics-service/tests/test_job_worker.py
  - analytics-service/tests/test_mt5_soak.py
  - analytics-service/tests/test_nav_twr.py
  - analytics-service/tests/test_transforms.py
findings:
  critical: 0
  high: 0
  medium: 1
  low: 4
  info: 4
  total: 9
status: issues_found
---

# Phase 229: Code Review Report (round 1, gsd-code-reviewer)

**Reviewed:** 2026-11-24
**Depth:** deep. Callers traced: the compose read loop, `_load_allocator_daily_returns`, both key-mode exits, the `key_inputs` epilogue, `replay_key_equity`'s writer-basis gate, `departed_history_inclusion` and the `departed_unavailable` rule, the `enqueue_compute_job` dedup, the `chain_linked_twr` call site, `_build_nav_meta` and `mt5_parity_findings`.
**Files reviewed:** 12 (6 source, 6 test; the test files were read for oracle independence and to check that each test can fail)
**Status:** issues_found (1 MEDIUM, user-facing)

## Review basis

The review read every source file from `git show HEAD:` at `3e49de6a6`. While it ran, the
shared worktree held an uncommitted neuter at `analytics-service/services/job_worker.py:10137`
(`elif venue == "mt5" and …` replaced by `elif False:`), presumably a PROOF-01 run by another
agent. Re-checked before hand-back: the worktree is clean, line 10137 is restored, and HEAD is
`51f725f88`, which adds only `docs(229): phase verification`. The source is byte-identical to
the reviewed sha.

## Summary

The five intents are each implemented where the CONTEXT puts them:

- **MT5D-04** (`nav_twr._judged_cohorts`): the new `later_judged` arm only changes a day
  whose cohort 0 holds no P&L and has a bad base. On a healthy base, an empty cohort 0
  contributes a factor of exactly 1, so skipping it moves no healthy day. 188's tiny-base
  test still runs afterwards on `prev` at the `chain_linked_twr` call site, so its
  precedence holds. The D-25 `cohort_min` now leaves out the skipped base. `min()` cannot see
  an empty list, because an empty `judged` returns NaN first.
- **MT5D-05**: on day 0 with `prev0=None`, `cur - prev - flow_t` is exactly `pnl0`. The new
  keys are in `NAV_TWR_ANNOTATION_KEYS`, so they never promote status, and
  `mt5_parity_findings` classifies them `explained_acceptable`. The carry is present-only and
  `is True` at all three hops.
- **MT5D-07**: the token refactor keeps the old behaviour. The old condition
  `priced_through is not None and not hole_ends and not unpriced_iso` is now split into named
  branches. A USD MT5 key in key mode always reaches the basis branch when it has a NAV day,
  so `store_gate_unmet` is a fallback only. `_persist_key_inputs` replaces the payload whole,
  so the token clears on the next derive that stores a basis.
- **HOLD-03**: the stamp is exactly the rows each exit wrote. At the main exit the reconcile
  delete leaves the table equal to `rows_payload` inside `[span_start, span_end]`, which
  contains the stamp window. At the short exit the stamp is the measured rows. The compose
  index is ISO strings (`str(x["date"])`), so the day keys match. Floats round-trip exactly,
  because JSONB numeric and float8 both use shortest-repr output, so 1e-12 is safe. The
  comparison runs per raw key, before `stitch_shared_account`. A malformed stamp raises
  `ValueError` inside the read loop's `try`, which disposes it as a permanent corrupt input.
  Writers on the key axis of `csv_daily_returns`: only the two derive exits (`:10320`,
  `:10338`, `:10675`, `:10693`). `:14118-14171`, `okx_archive_job` and the SQL functions
  write or read the strategy axis. The api_key insert in
  `20260713120000_cleanup_abandoned_wizard_drafts.sql:281` is that migration's own cascade
  self-test. The other `allocator_equity_derived` upserts (`:3985`, `:4048`, `:4197`) write the
  `key_capture:`, `nav_mark_refusal:` and `read_incomplete:` kinds, never `key_inputs:`.
- **Tests**: the money-math oracles are hand `Fraction` arithmetic. The soak tests compare
  `_soak._walk_*` against `_fraction_walk` and typed fractions, and the `nav_twr` tracers
  import no `nav_twr` helper for their expected values. The production imports in
  `test_allocator_equity_writer_basis.py` are the code under test (readers, payload builders,
  the derive), never an oracle.
- **Logs**: the new lines carry counts and closed tokens only.

## Medium

### MR-01: A departed key carrying `writer_basis_withheld` (or a stale stamp) holds the whole book untrustworthy forever

**File:** `analytics-service/services/job_worker.py:17191-17196` (departed branch: `withheld_by_key[api_key_id] = …` and `_compare_returns_stamp(…)`), and `:17905-17910` (book-level `KEY_INPUTS_MISMATCH`)
**Scenario:** a timed MT5 native key's last derive stores `writer_basis_withheld`, for
example `calendar_day_without_close` or `unpriced_days_without_interior_hole` while a BTC close
is missing. The owner then disconnects or revokes the key. The key keeps its `key_inputs`
row so the switch stays reversible, and `departed_history_inclusion` keeps it in
`departed_end_by_key`. It is never derived again, so the token never clears, and every compose
raises the blocking `key_inputs_mismatch`. A departed key whose last derive died between the
returns upsert and the epilogue is the same: its old stamp disagrees with its rows for good.
**Why MEDIUM:** this goes against the rule the same function applies to departed keys a few
lines earlier (`:16913-16916`, D-22): *"A departed key the rule includes but that cannot be
levelled is left out under a benign flag: composing it would drop it as DROPPED_KEY and hold
the whole book untrustworthy forever."* It also breaks the premise of the MT5D-07 ruling:
the block "self-heals on the next derive once the missing close lands", and a departed key has
no next derive. The only way out is the owner turning the departed key's history off, and
nothing tells them that this is the cause.
**Impact:** user-facing. Every key in the book shows "rebuilding" with no end. PROD measured 0
such rows today. Reaching it needs a departure while a token or a torn write is present.
**Confidence:** 6/10
**Fix (minimal):** in the departed branch, do not put a withheld or mismatched departed key
into `withheld_by_key` or `stamp_mismatch_days_by_key`. Route it the way `departed_unavailable`
is routed (left out under its benign flag, so the book is "no worse than before plan 09",
D-22). Or name it on its own benign flag. Pin it with a departed-key arm in the HOLD-03 and
MT5D-07 families.

## Low

### LR-01: A HOLD-03 refusal caused by a race can last until the next compose trigger

**File:** `job_worker.py:16685` (compose reads `key_inputs` first) and `:16759` (returns second); the derive writes returns at `:10669-10703` and then `key_inputs` at `:10220`; dedup at `supabase/migrations/20261114130000_enqueue_dedup_record_retract.sql:376,383` (`status IN ('pending','running','done_pending_children')`)
**Scenario:** this is reachable. `_load_allocator_daily_returns`' docstring records sibling
derives running at the same time as the compose read (the 05:30 fan-out). The compose reads
the old row, the derive upserts new returns, and the compose reads those. If a day inside the
window moved, as in a same-terminal re-derive whose last day changed, the pair is refused. The
derive's compose enqueue then dedups onto that `running` compose, so nothing composes again
until the next trigger, which is at most the next nightly.
**Why LOW:** it is the same window and the same stuck-liveness property as the accepted
`realized_terminal_day_mismatch` transient, which already fires on every race in which the
terminal day advances. HOLD-03 adds only same-terminal re-derives, and only the last sibling
derive to finish is exposed.
**Confidence:** 5/10
**Fix:** none here. The structural fix, a re-run when an enqueue dedups onto a `running`
compose, belongs in the job queue.

### LR-02: The short exit stores a writer basis with no stamp, and the log says such rows predate 229

**File:** `job_worker.py:10297-10378` (`_returns_stamp_rows = _short_exit_stamp`, which is `None` with no marks); log at `:17863-17868`
**Scenario:** a key-mode derive reaches the under-two-days exit with no marks, with a
non-empty `_day_pnl_usd` and a realized terminal. It writes no rows, so the table keeps an
earlier derive's rows, and it stores a basis with no stamp. `replay_key_equity`'s gate catches
this pair unless every stored return day lies in W and the terminal day matches
(`allocator_equity_derive.py:1376-1381`), which needs the same deal history with nearly every
day newly refused. If both hold, it composes as trustworthy uncompared, and the info line calls
the row "written before 229 HOLD-03". If the timed days are all guarded (`timed_days` 0), no
token is written either. This is a pre-existing short-exit hole (it deletes only stated
tiny-base days), and HOLD-03 does not close it.
**Confidence:** 6/10
**Fix (minimal):** change the info line to "… carry no returns stamp (written before 229
HOLD-03, or by an exit that wrote no rows)". Record the residual as a known limit beside SC-4.

### LR-03: MT5D-04's "zero or below" has no lower bound, so a materially negative start level loses its canary

**File:** `nav_twr.py:640` (`later_judged`) and `:672`
**Scenario:** a timed day starts at `prev = -500`, deposits 1,000, and a trade opened after
the deposit earns +50. It used to raise `negative_nav_guard` (`complete_with_warnings`). Now it
is measured silently as 50 / 500, and nothing names the negative level, because a quiet day on
a non-positive carried level is not judged. The behaviour matches the CONTEXT text ("a
re-fund from zero or below … is now measured"), but that decision's probe covered only `-0.5`.
**Confidence:** 5/10
**Fix:** ask the founder whether "below" means within float noise. If so, skip the empty
cohort 0 only when `prev >= -floors.residual_abs_tol`, which keeps the `0.0` and `-0.5` pins.

### LR-04: One key's MT5D-07 or HOLD-03 state blocks the whole allocator book, against 186 D-03 "a failing or refused key affects only itself"

**File:** `job_worker.py:17905-17910`
Phase 186 D-03 and D-08 (founder) point the other way. The 229 ruling "Block it, like the
holed-key precedent" is more recent and wins under Rule 7, but its recorded wording ("changes
what an allocator book shows for such a key") does not say that the WHOLE book is held.
Record which decision won. No code change.
**Confidence:** 5/10

## Info

### IN-01: `inception_day_pnl_dropped` has no reader
`analytics_runner.py:284-289`. There is no match in `src/`, and neither the factsheet nor the
TS DQ lift reads it. SC-2 is met in the letter only.

### IN-02: `returns_stamp` makes the `key_inputs` payload larger, and the browser selects it whole
`allocator_equity_derive.py:1929-1943`; `src/components/exchanges/AllocatorExchangeManager.tsx:859-865` (`.select("kind,payload")`). It adds about +50% payload on a long Deribit history.

### IN-03: The soak's `_walk_cohorts` now encodes the same cohort rule as production
`scripts/mt5_soak.py:617-618`. The soak cross-checks the arithmetic, not the rule.
Acceptable, because the rule is a decision.

### IN-04: `stampless_basis_rows = [0]` is used as a mutable cell
`job_worker.py:17112`. `nonlocal` would be clearer.

---

_Reviewed: 2026-11-24_
_Reviewer: Claude (gsd-code-reviewer), read-only against HEAD 3e49de6a6 (source identical at 51f725f88)_
_Depth: deep_
