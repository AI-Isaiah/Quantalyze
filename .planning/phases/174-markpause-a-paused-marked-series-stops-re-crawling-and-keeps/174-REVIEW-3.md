---
phase: 174-markpause-a-paused-marked-series-stops-re-crawling-and-keeps
reviewed: 2026-10-27T11:30:00Z
depth: deep
diff_range: 53f25ac3e..8a9193bc5 (non-planning paths; primary scope fixer round 2, 8a9193bc5)
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

# Phase 174: Code Review Report, round 3

**Reviewed:** 2026-10-27
**Depth:** deep. The primary scope is fixer round 2 (`8a9193bc5`, SFH-2 N1). I re-checked the full non-planning diff `53f25ac3e..8a9193bc5` for regressions the fix could cause.
**Files Reviewed:** 17
**Status:** clean at MEDIUM and above. Per the brief, nothing below MEDIUM is reported as a finding.

## Summary

SFH-2 N1 is resolved. The ISO-shape conjunct sends the values that previously sorted at or below the cutoff (`''`, `'2026'`, `'2026-10'`, a leading space, a trailing newline) to the 20-hour branch. The conjunct cannot raise. Arm P5 is a real matched twin of P1 and bites. Arm P2's re-based twin parses inside the `CASE`, occurs exactly once, and still bites. Every census agrees with the measured arm and twin counts. I found no new MEDIUM+ defect, and no regression in the rest of the diff.

**What I measured.** All runs were on a clean export of `8a9193bc5` (`git archive` into `<scratchpad>`, with `node_modules` linked read-only), never in the shared worktree:

- **The regex, on a throwaway PG16 lane** (`scripts/pg-lane/run.sh`, loopback-only, destroyed by its EXIT trap):
  - `standard_conforming_strings` is `on`, so `'^\d{4}-\d{2}-\d{2}$'` reaches the regex engine as written.
  - Shape test results:
    - `''`, `'2026'`, `'2026-10'`, `' 2026-10-01'`, `'2026-1-01'` and `E'2026-10-01\n'`: `f`. The ARE `$` anchors at end of string, not before a newline.
    - Arabic-Indic digits: `f`.
    - `NULL`: `NULL`, so the `EXISTS` is false.
    - `'2026-10-01'`: `t`.
  - `->>` on an array or a scalar `jsonb` gives `NULL`, not an error.
  - The pattern is a static, valid literal and every operand is text, so nothing in the conjunct can raise.
  - Under `standard_conforming_strings = off` the literal would degrade to `^d{4}-…`. It would then match nothing and fall to 20 hours. That fails safe and still cannot raise.
- **The gate bites, per arm.** `node scripts/mutation-runner/run.mjs --file supabase/tests/test_ledger_refresh_fanout.sql` (lane, pg_cron AVAILABLE):
  - The baseline exits 0.
  - The tallies are `arms: 37/37/0`, `biting: 37` and `lane-invocations: 37`.
  - The file row reads `sections 37 / judged 37 / annotated 37 / waived 0 / biting 37`, and the run printed `No defects in the narrowed scope`.
  - Arm P2 and arm P5 are each `RED (identity ok)`, so the apply survived both mutations and each arm was its own first failure. The narrowed mode never exits 0, by design.
- **The P2 twin.**
  - `WHEN EXISTS (` occurs once in the raw migration file, at line 531, and nowhere in a comment.
  - The replacement gives `CASE WHEN EXISTS (<sb: flags = '{}'>) OR EXISTS (<original subquery>) THEN …`, which is valid SQL. The lane run proves the apply parses and verifies.
  - Its semantics equal the round-1 twin (`flag <= cutoff OR flags = '{}'` inside one `EXISTS`). The prepended `EXISTS` is not narrowed by the new shape conjunct, which is the point of the re-base.
- **The P5 twin.**
  - The JSON `find` decodes `\\d` to `\d` and matches migration line 535 exactly once.
  - The `find` is not in any comment, and the header's "no gate `find` string is reproduced" rule holds.
  - `AND TRUE` leaves valid SQL.
  - P1 (a real date, 5 days old) and P5 (`''`) share the same 2-day-old attempt and differ only in the value's shape. So the twin reddens P5 and leaves P1 green.
  - P5 asserts `v_cnt = 1 AND v_ret = 1`. That holds because P4 returns `s_mp4` to `draft` first, and `s_mp5` stays `draft` until its own arm.
- **The verify-block needles are unaffected.**
  - Under the P2 twin, `marks_trailing_since`, `INTERVAL '7 days'` and `CURRENT_DATE - 3` all survive.
  - Under the P5 twin, the line that follows still carries `marks_trailing_since`.
  - The new line has no `--`, so the comment strip (`--[^\n]*`) cannot eat it.
  - The verify block stays catalogue-only.
- **The snapshot matches the migration.**
  - `npm run schema:functions:check` prints `SQL function snapshot is current (132 functions)`.
  - `scripts/sql-body-normalize.mjs --normalize` keeps the regex literal intact, and `--diff-bodies` (snapshot vs snapshot) prints `MATCH`.
  - The `prod-body-ack` is of PROD's pre-apply body and correctly did not move.
- **Baseline currency.** `--replay-set` prints `carried=308 replay=1 marker-sha=match defects=0`, and the only replayed migration is `20261030120000`.
- **Lint.** `lint-sql-gates` scanned 107 files: 0 findings, 0 measure-fails.
- **Census tests pass.** vitest passed on `drift-check-scripts`, `gate-family-meta`, `mutation-annotation-parser`, `mutation-runner-floors` and `contracts/ci-anti-skip-gate.contract`: 5 files, 1200 tests. `baseline-content-drift-allowlist` also passed (18 tests).
- **Python gates pass.** pytest on `tests/test_ledger_refresh_gates.py` (run from `analytics-service/`): 37 passed.
- **The censuses agree with each other.**
  - There are 37 `RED-UNDER-M` sections (+1).
  - The sentinel reads `ALL 31 ARMS EXECUTED` and lists 31 names, P5 included. The two prose mentions also read 31.
  - In `ci.yml`, the table row is 31 and the `ARMS_FLOOR=378` addends sum to 378.
  - `ARMS_FLOOR = 808` equals the measured per-file move 36 → 37 on top of 807.
  - `stepsSeen` and `needles.length` both read 921 (+1 `edit` step).
  - Every log splice in `mutation-runner-floors.test.ts` kept its offset (807/808 and 808/809).
- **Writer compatibility (regression check).**
  - Every writer emits `date.isoformat()` (`YYYY-MM-DD`). That covers the prestamp (`job_worker.py`, `(_last_applied + timedelta(days=1)).isoformat()`) and the composite merge, which takes `min()` over member ISO strings.
  - The analytics runner re-validates and drops a non-ISO value.
  - So the shape conjunct cannot switch off the weekly window for any value the product writes.

## Narrative Findings (AI reviewer)

None at MEDIUM or above.

## Checked and not reported (below MEDIUM, or verified sound)

- **Shape-valid but impossible dates.** `'0000-00-00'` or `'2026-02-30'` pass the shape test, and when they sort at or below the cutoff they take the 7-day branch (measured `0000-00-00`: `weekly = t`). D-04's "malformed" wording reaches past what a shape test can prove. No writer can produce such a value. Below the floor.
- **P5 pins only the empty string.** A body that tests `<> ''` instead of the shape would pass P5 while giving `'2026-10'` the weekly window. This is a test-strength gap, and no shipped body has it. Below the floor.
- **Stale counts in comments.**
  - The migration header's DISJOINTNESS paragraph says "The three twins this phase adds" (there are now five P twins).
  - Needle (13) says the paused-test twin widens "around" the flag key. It now prepends an `EXISTS`, and the key still survives.
  - Check 12's comment names "P1, P2 and P3".
  - The runbook's "Gate." bullet names "Arms P1 to P4".
  - None of these is false about behaviour, and the first was already stale after round 1. Below the floor.
- **The 808 floor entry records no lane measurement.** `scripts/mutation-floors.mjs` at the 808 entry carries no "MEASURED" reading of its own, unlike the 807 entry. The per-file move (36 → 37 biting) is confirmed by the run above, so the floor is correct.

---

_Reviewed: 2026-10-27_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
