---
phase: 174-markpause-a-paused-marked-series-stops-re-crawling-and-keeps
reviewed: 2026-10-27T11:10:00Z
depth: deep
diff_range: 53f25ac3e..af04615ae (non-planning paths)
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
  warning: 0
  info: 0
  total: 0
status: clean
---

# Phase 174: Code Review Report, round 2

**Reviewed:** 2026-10-27
**Depth:** deep. I traced the D-04 predicate against the flag's writer (`job_worker.py`, the `_marks_trailing_since` stamp), against `mark_day_for` and against the analytics runner's validating reader. I traced the refusal record through every caller and every TS/Python reader of `allocator_equity_derived`.
**Files Reviewed:** 17
**Status:** clean at MEDIUM and above. Per the brief, nothing below MEDIUM is reported as a finding.

## Summary

The round-1 findings (MR-01, MR-02, SFH F1, F2, F3) are resolved, and the fix introduced no regression at MEDIUM or above. I found no new MEDIUM+ defect in the full diff.

**What I measured, on a clean export of `af04615ae`** (`git archive` into `<scratchpad>`, not the shared worktree; see the process note at the end):

- **The re-base is still clean.** I extracted the `$fanout$` body of 20260924120000 and of 20261030120000 and diffed them. There is exactly one hunk: `INTERVAL '20 hours'` became the comment block and the `CASE`.
- **The snapshot matches the migration.** The `$fanout$` body of `supabase/schema/functions/enqueue_ledger_refresh_for_strategies.sql` is byte-identical to the migration's body (610 lines, no diff).
- **No newer migration redefines the function** on `origin/main`. `19f63768d` touches only `CHANGELOG.md`, `VERSION`, `package.json` and the cron manifest.
- **The gate bites, per arm.** I ran `node scripts/mutation-runner/run.mjs --file supabase/tests/test_ledger_refresh_fanout.sql` on a throwaway PG16 lane with pg_cron AVAILABLE. Result: baseline exit 0, `arms: 36/36/0`, `biting: 36`, `lane-invocations: 36`. P1, P2, P3 and P4 are each `RED (identity ok)`. The single defect it printed was `dirty-checkout` (no git in an export), and a narrowed run never exits 0 by design.
- **The SQL lint is clean:** `lint-sql-gates`: 107 files, 0 findings. Self-test OK: 7 rules.
- **The census tests pass.** I ran vitest on `gate-family-meta`, `mutation-annotation-parser`, `mutation-runner-floors` and `contracts/ci-anti-skip-gate.contract` (export, 295 passed), plus `drift-check-scripts` (worktree once clean, 905 passed).
- **The censuses agree with each other.**
  - 36 `RED-UNDER-M` lines and a sentinel of `ALL 30 ARMS EXECUTED`, listing 30 names.
  - `ci.yml`: the table row is 30, and the `ARMS_FLOOR=377` addends sum to 377.
  - `scripts/mutation-floors.mjs`: `ARMS_FLOOR = 807`, which is 806 + 1, matching the measured `biting: 36` for the file.
  - The parser test's `stepsSeen` and needles moved 919 → 920, one `edit` step for P4.
- **The Python tests pass.** pytest on `test_nav_marks_refusal_record.py`, `test_ledger_refresh_gates.py` and `test_derive_broker_dailies_dualmode.py`: 96 passed.

## Round-1 findings: resolution

### MR-01 / SFH F1 — RESOLVED (D-04)

The `CASE` now reads `sa.data_quality_flags ->> 'marks_trailing_since' <= to_char(CURRENT_DATE - 3, 'YYYY-MM-DD')` at migration line 534 and snapshot line 375.

- **Off-by-one.** The flag's value is `_last_applied + 1 day` (`job_worker.py`, the `_marks_trailing_since` stamp), which is the first trailing day F. The predicate `F <= CURRENT_DATE - 3` is the same as `CURRENT_DATE - F >= 3`, which is exactly D-04's "3 or more days old".
  - Because `mark_day_for` labels yesterday, a refusal first seen at 00:10Z on day D stamps F = D-1. Its age is already 1 at detection.
  - The next tick, about 20 hours later and still on day D, sees age 1, takes the 20-hour branch and is re-admitted. MR-01's one-day blip therefore clears on the next derive.
  - The weekly window starts on D+2. This matches the letter of D-04, which keys on "the flag's own first trailing day".
  - The second MR-01 trigger, a read before 00:00Z with an apply after it, stamps F = the label day. Its age is 0 or 1, so it gets 20 hours. Resolved.
- **Text comparison.** For valid `YYYY-MM-DD` strings, the lexical order equals the date order under C collation. It also holds under glibc/ICU locales that ignore `-` at the first level, because every valid value has its hyphens at the same positions.
- **Precedence.** `->>` is a generic operator, so it binds tighter than `<=`. The predicate parses as `(flags ->> key) <= cutoff`.
- **NULL and shape.**
  - These all fall to 20 hours: a NULL `data_quality_flags`, a missing key, a JSON `null` value, and a flags value that is an array or a scalar (`->>` gives NULL, the comparison gives NULL, the EXISTS is false).
  - Nothing in the predicate can raise.
- **Timezone.** `CURRENT_DATE` follows the session `TimeZone`, and the function sets no `timezone`. The worker's days are UTC. On a UTC database, which is the Supabase default, the two agree. Only a non-UTC session would shift the cutoff by one day (below the floor; see the notes).
- **Verify block.** The new needle `v_age_needle := 'CURRENT_' || 'DATE - 3'` is concatenated, so the verify block cannot match itself.
  - It is checked against the comment-stripped `pg_get_functiondef`. The predicate line carries no `--`, so the strip cannot eat it.
  - The function body has no other `CURRENT_DATE` and no other `marks_trailing_since`, so the needles bite only the predicate.
- **Twins.** The twins keep every needle as a token: P4 rewrites to `CURRENT_DATE - 3 + 30`, P2 widens around the whole predicate, and P1 and P3 do arithmetic on `INTERVAL '7 days'`. In each case the arm, not the apply, fails first.
  - Each `find` occurs exactly once in the migration file, which matches the twins' `occurrences: 1`.
  - `INTERVAL '20 hours'` still occurs exactly twice (the `ELSE` and the failed-attempt cooldown), so the `nth: 1` / `nth: 2` twins of arms E, F and T still land on the same fragments.
- **Data dependence.** The verify block is still catalogue-only and adds no data read, so the D-04 change cannot trip `[164.8-DATA-DEPENDENT-MIGRATION-ESCAPE]`.

### MR-02 / SFH F2 — RESOLVED

- **Readout.** The readout (`navmtm-chain-move-go-live.md`, the `mark-refusals` form) now joins `public.api_keys` on `aed.kind = 'nav_mark_refusal:' || ak.id::text AND ak.user_id = aed.allocator_id`, and filters on `disconnected_at IS NULL`, `sync_status IS DISTINCT FROM 'revoked'` and `is_active`.
  - `api_keys.is_active` is `boolean DEFAULT true NOT NULL` in the baseline, so `ak.is_active` is equivalent to the fan-outs' `COALESCE(ak.is_active, TRUE)`.
  - The writer's `allocator_id` is `ctx.key_row["user_id"]` at all three call sites, so the `user_id` join matches every row the worker writes.
- **Invariant.** The "present means paused NOW" claim is replaced with "last refused on `last_seen_day`", with the stale-row causes named.
- **Warnings.** Both warnings now carry `api_key=<id>` beside the exception class and never `str(exc)`.
- **Other readers are unaffected.** Every TS reader of `allocator_equity_derived` filters by exact `kind` (`queries.ts`, `latest-holdings-per-key.ts`, `AllocatorExchangeManager.tsx`), so the new family cannot leak into a parser that expects another kind. The GDPR export (`gdpr-export-manifest.ts`) takes every row for the owner, which is correct for owner data.

### SFH F3 — RESOLVED, and the test can fail

`test_a_failed_record_delete_does_not_change_the_derive` sets `fail_refusal_delete`. It asserts four things:
- the outcome is DONE and equals the healthy run's;
- the mark is stored and the rows are equal;
- the stale row survives;
- exactly one warning names the key and `RuntimeError`, and does not carry the message.

**Neuter check,** on the `<scratchpad>` export with a byte backup restored and verified by `cmp`:
- I narrowed the clearer's `except Exception` to `except ValueError`. The test went RED with `RuntimeError: db exploded with a private detail` (1 failed, 24 passed). The other 24 tests stayed green, which confirms that before this round nothing else guarded the contract.
- By inspection, two further mutations also go RED: logging `str(exc)` instead of the class name fails both `"RuntimeError" in` and `"private detail" not in`, and dropping the key id fails `KEY in warned[0]`.

## Narrative Findings (AI reviewer)

None at MEDIUM or above.

## Checked and not reported (below MEDIUM, or verified sound)

- **Malformed values that sort low.** D-04 says "a malformed flag value falls back to 20 hours". The comments and `ledger-refresh-go-live.md` repeat it, and it holds for NULL, absent, `null` and most garbage.
  - It does not hold for a string that sorts at or below the cutoff, for example `''`, `'2026-1-5'` or a leading-space value. Those take the 7-day branch.
  - The never-raise half holds for every value.
  - The case is unreachable: the only writers are the prestamp (`date.isoformat()`) and the analytics runner, which re-validates with `_is_iso_calendar_day` and drops a malformed value. Below the floor.
  - A `~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'` conjunct would make the claim literal if anyone wants it.
- **The cutoff is pinned only loosely.** P1 (flag 5 days old) and P4 (1 day old) leave the cutoff free within [2, 5], and `<=` → `<` stays green. No arm sits at exactly 2 or 3 days. This is the same class round 1 recorded below the floor for the 7-day interval.
- **Session timezone.** `CURRENT_DATE` is session-`TimeZone` dependent. Pinning it with `(now() AT TIME ZONE 'UTC')::date` would make the function independent of a non-UTC session. The only caller is the cron tick (EXECUTE is REVOKEd from everyone else).
- **Stale `first_seen_day` after a failed clear.** It persists, and the runbook now documents it. No retry or Sentry escalation was added, which matches the `_persist_refused_key_capture` convention.
- **Deleted keys.** They still leave `nav_mark_refusal:` rows, because the compose prune scans `key_inputs:%` only. The readout no longer counts them, and the runbook says so.

## Process note (not a code finding)

While this review ran, the shared worktree `quantalyze-174` had an uncommitted, changing edit to `analytics-service/services/job_worker.py`. It first narrowed the clearer to `except ValueError`, then changed the warning to `str(exc)`, and was clean again a few minutes later. Another agent was apparently neuter-testing in place.

Every Python and SQL measurement above was therefore taken on a `git archive af04615ae` export, never on the live worktree. `drift-check-scripts` was the one exception: it needs git, so I ran it in the worktree after `git status` showed it clean.

Parallel agents in one worktree can corrupt each other's measurements. Per the project rule, each parallel agent gets its own worktree.

---

_Reviewed: 2026-10-27_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
