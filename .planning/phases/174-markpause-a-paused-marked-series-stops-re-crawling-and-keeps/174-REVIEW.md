---
phase: 174-markpause-a-paused-marked-series-stops-re-crawling-and-keeps
reviewed: 2026-10-27T00:00:00Z
depth: deep
diff_range: 2941b367a..382676784 (non-planning paths)
files_reviewed: 17
files_reviewed_list:
  - supabase/migrations/20261030120000_ledger_fanout_marks_paused_weekly.sql
  - supabase/schema/functions/enqueue_ledger_refresh_for_strategies.sql
  - supabase/tests/test_ledger_refresh_fanout.sql
  - scripts/pg-lane/fixtures/03-fixture-compute-jobs.sql
  - scripts/mutation-floors.mjs
  - .github/workflows/ci.yml
  - src/__tests__/drift-check-scripts.test.ts
  - src/__tests__/gate-family-meta.test.ts
  - src/__tests__/mutation-annotation-parser.test.ts
  - src/__tests__/mutation-runner-floors.test.ts
  - analytics-service/services/job_worker.py
  - analytics-service/services/nav_marks.py
  - analytics-service/tests/test_nav_marks_refusal_record.py
  - analytics-service/tests/test_derive_broker_dailies_dualmode.py
  - analytics-service/tests/test_ledger_refresh_gates.py
  - docs/runbooks/ledger-refresh-go-live.md
  - docs/runbooks/navmtm-chain-move-go-live.md
findings:
  critical: 0
  warning: 2
  info: 0
  total: 2
status: issues_found
---

# Phase 174: Code Review Report

**Reviewed:** 2026-10-27
**Depth:** deep (call chains traced into the mark seam, the trailing-flag stamp, the key-mode fan-out, the compose orphan prune and the factsheet reader)
**Files Reviewed:** 17
**Status:** issues_found
**Scope reported:** MEDIUM and above only, as the brief asks.

## Summary

The migration is a clean re-base. Extracting the `$fanout$` body of 20260924120000 and of
20261030120000 and diffing the two shows exactly one hunk: the attempt-cooldown `INTERVAL '20 hours'`
becomes the `CASE` with its comment block. The verify block reads only the catalogue and never calls
the function. The REVOKE is re-issued. `strategy_analytics.data_quality_flags` is `jsonb` and
`strategy_id` is UNIQUE on the baseline, so `?` and the `EXISTS` are well-typed and match at most one
row. Arms P1, P2 and P3 form a real matched pair plus a re-admission arm, and each twin keeps its
verify needle alive. The census moves agree with each other.

The worker half keeps the token out of `data_quality_flags`. It validates against the closed set and
never raises. It keeps `first_seen_day` and clears on both mark-yielding paths.

Two MEDIUM findings remain. One is user-facing: a transient refusal can freeze a public factsheet
for up to a week. The other concerns the integrity of the private record: refusal rows outlive their
keys.

## Narrative Findings (AI reviewer)

### MR-01 (MEDIUM, user-facing): one transient refusal freezes a deribit/sfox/mt5 factsheet for up to 7 days, although marks resume the next day

**Files:**
- `supabase/migrations/20261030120000_ledger_fanout_marks_paused_weekly.sql:514-523` (the `CASE`)
- `analytics-service/services/job_worker.py:7709-7718` (where the flag is stamped)
- `analytics-service/services/nav_marks.py:105-125` (`MARK_REFUSAL_TOKENS`)

**Issue.** The 7-day window keys on `data_quality_flags ? 'marks_trailing_since'`. That flag is
stamped whenever the last applied mark is older than the day this derive labels
(`_last_applied < _label_day`, job_worker.py:7717-7718). A single refused read is enough to cause
that. Several tokens in the closed set are plain read failures that clear on the next attempt:
`balance_error`, `upnl_unreadable`, `positions_unreadable`, `uta_totals_unreadable`,
`option_value_unreadable` and `native_unpriced`.

A second trigger needs no refusal at all. `_mark_read_at` is stamped at the equity read, but
`_label_day` is taken from `_utc_now()` at apply time (job_worker.py:7709). A derive whose read
lands before 00:00Z and whose apply lands after it therefore stamps the flag for a mark it actually
stored.

Before this phase either case cost one ~20-hour cooldown. Now it costs 7 days.

The cost lands on exactly the venues the phase targets. `DAILY_PNL_VENUES` is
`{okx, binance, bybit}` (services/exchange.py:845). For deribit, sfox and mt5 the ledger fan-out is
the only recurring strategy derive (174-RESEARCH Q1).

**Failure scenario.**
1. A published Deribit strategy hits one `balance_error` on night D. The flag `marks_trailing_since = D` is stamped.
2. On D+1 the daily key-mode fan-out (`enqueue_derive_broker_dailies_for_allocator_keys`, every active key) reads the same key. The mark succeeds and is stored, and `_clear_nav_mark_refusal` deletes the private row. The key is healthy again.
3. The strategy derive that would apply those marks and pop the flag is not re-admitted until about D+7. Key-mode derives never enqueue a strategy derive.
4. For those 6 days the public factsheet's cumulative chart shows "Marks paused from {D}" (`src/lib/factsheet/types.ts:731-736`) and the returns series stays frozen at D-1.

Both records are about the same key, and for 6 days they contradict each other: the private record
says healthy while the public flag says paused.

Under the old 20-hour cooldown the same blip cleared within about a day. D-01 decided a weekly
cadence for a series whose marks *have paused*. The implementation, however, detects "paused" with
a flag that one transient read failure sets. The plan does not measure or mention the cost of a
recovery that slows from 20 hours to 7 days. This is within D-01's letter, so the fix below is a
founder confirmation as much as a code change.

**Fix (pick one; both are a one-fragment edit to the `CASE`, plus one matched-pair arm).**
- Apply the weekly window only once the pause has *persisted*. Compare as ISO text so a malformed value cannot raise inside the SECURITY DEFINER tick:
  ```sql
  WHEN EXISTS (
    SELECT 1 FROM public.strategy_analytics sa
     WHERE sa.strategy_id = lrs.strategy_id
       AND sa.data_quality_flags ? 'marks_trailing_since'
       AND (sa.data_quality_flags ->> 'marks_trailing_since')
             < to_char(CURRENT_DATE - 3, 'YYYY-MM-DD')
  ) THEN INTERVAL '7 days'
  ```
  A fresh pause keeps the daily cadence for a few days. A long pause is throttled weekly.
- Or key the window on the private record, which the daily key-mode derive keeps current (`EXISTS (SELECT 1 FROM public.allocator_equity_derived aed WHERE aed.allocator_id = ak.user_id AND aed.kind = 'nav_mark_refusal:' || ak.id::text)`). Once key mode stores a mark again, the strategy returns to the 20-hour window within a day. Caveat: a pause that carries no token (`_mark_read_at IS NULL`) would stay on the daily window.

Either option also needs a gate arm in which a just-stamped pause, or a paused flag with no refusal row, is still admitted after 20 hours.

### MR-02 (MEDIUM, not user-facing; integrity of the private record): refusal rows outlive their key, breaking the runbook's "present means paused NOW" invariant

**Files:**
- `analytics-service/services/job_worker.py:3612-3695` (`_record_nav_mark_refusal` and `_clear_nav_mark_refusal`, the only writers and clearers)
- `analytics-service/services/job_worker.py:14409-14425` (the compose orphan prune scans `key_inputs:%` only)
- `docs/runbooks/navmtm-chain-move-go-live.md:287` and `:296-309` (the invariant and the readout)

**Issue.** Only a derive of the same key that stores or finds a mark deletes a
`nav_mark_refusal:<api_key_id>` row. `allocator_equity_derived` has an FK on `allocator_id` only,
not on the key, and the compose's orphan prune reads `kind LIKE 'key_inputs:%'`. Three cases leave a
row behind:
- **Disconnected or revoked key.** Both fan-outs exclude it (`disconnected_at IS NULL`, `sync_status IS DISTINCT FROM 'revoked'`), so no derive will ever clear its row.
- **Deleted key.** The same holds, and unlike its `key_inputs` sibling the row is never pruned.
- **Inactive key** (`is_active = FALSE`). The same.

The runbook states "the row is deleted when a derive of that key stores or finds the day's mark, so
a row that is present means the key is paused NOW" (line 287). The readout counts these rows as
currently refused keys, with no join to `api_keys` (line 305). The record that D-03 introduced so
that it would not be write-only therefore over-reports, permanently, for every key that left while
refused. An operator reading it cannot tell a live pause from a departed key.

**Failure scenario.** A manager's MT5 key is refused `native_unpriced` and then disconnected. Months
later `mark-refusals` still returns `native_unpriced | <first_seen> | <last_seen> | 1`, and the
runbook says that key is paused now.

**Fix.**
1. Restrict the readout to keys that can still be derived, keeping the output free of ids:
   ```sql
   FROM public.allocator_equity_derived aed
   JOIN public.api_keys ak
     ON aed.kind = 'nav_mark_refusal:' || ak.id::text
    AND ak.user_id = aed.allocator_id
    AND ak.disconnected_at IS NULL
    AND ak.sync_status IS DISTINCT FROM 'revoked'
    AND COALESCE(ak.is_active, TRUE)
   WHERE aed.kind LIKE 'nav_mark_refusal:%'
   ```
2. Reword line 287 to "present on an eligible key". Optionally, extend the compose's deleted-key orphan prune to the `nav_mark_refusal:` family so deleted keys do not accumulate rows.

## Checked and not reported (below MEDIUM, or verified sound)

- Re-base byte-identity: verified by diffing the extracted `$fanout$` blocks (one hunk).
- The composite arm is untouched, consistent with 161.1 D-01.
- No lost marks during the throttled week. The daily key-mode fan-out covers every active key, so marks keep being stored; only the strategy-level apply waits. MR-01 is therefore about display latency, not lost data.
- A read-then-upsert race between concurrent key-mode and strategy-mode derives can leave a stale row for one day, cleared by the next key-mode derive (LOW).
- `LIKE 'nav_mark_refusal:%'` treats `_` as a wildcard; this is harmless here (LOW, already noted in the SUMMARY).

---

_Reviewed: 2026-10-27_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
