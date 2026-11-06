---
phase: 176-legacyretire
reviewed: 2026-10-31T17:16:48Z
depth: deep
files_reviewed: 20
files_reviewed_list:
  - .github/workflows/ci.yml
  - TODOS.md
  - docs/architecture/adr-0023-audit-event-taxonomy.md
  - docs/runbooks/bridge-outcome-cron.md
  - docs/runbooks/legacyretire-go-live.md
  - e2e/helpers/seed-test-project.ts
  - scripts/baseline-content-drift-check.mjs
  - scripts/dump-sql-functions.ts
  - scripts/mutation-floors.mjs
  - src/app/(dashboard)/allocations/AllocationDashboardV2.tsx
  - src/app/(dashboard)/allocations/components/KpiStrip.tsx
  - src/app/(dashboard)/allocations/components/ScenarioComposer.tsx
  - src/lib/allocation-helpers.ts
  - src/lib/queries.ts
  - supabase/migrations/20261102120000_bridge_outcome_holding_branch_derived.sql
  - supabase/migrations/down/20261102120000-rollback.sql
  - supabase/schema/functions/compute_bridge_outcome_deltas.sql
  - supabase/schema/functions/derived_account_return_over.sql
  - supabase/schema/functions/reset_holding_bridge_outcomes_to_derived_basis.sql
  - supabase/tests/test_bridge_outcome_deltas_derived.sql
findings:
  critical: 0
  warning: 1
  info: 0
  total: 1
status: issues_found
---

# Phase 176: Code Review Report (PR 1, plans 01-06)

**Reviewed:** 2026-10-31T17:16:48Z
**Depth:** deep (cross-file: SQL batch, the derive payload writer, the TS reader and the UI consumers)
**Files Reviewed:** 20 non-test files, plus the test diffs read where they pin behaviour
**Status:** issues_found
**Scope:** `git diff origin/main...HEAD -- . ':!.planning'` in the `feat/176-legacyretire` worktree at `88c1ced92`. The report covers MEDIUM and above only, as the brief asked.

## Summary

The PR moves the readers off the legacy curve cleanly. I traced each change to its consumers and found no new MEDIUM+ defect in the TS half:

- **Warm-up count.** `snapshotCount` is `equityDailyPoints.length` only in `"ready"`, otherwise `null`. `"ready"` requires a non-null derived series (`equityHistoryReadiness`), so a ready book can never read 0 days by accident. KpiStrip's explicit `!== null` guard handles JS's `null < 30 === true`.
- **D-01.** `allocatorEligibleApiKeyIds = eligibleKeyIds` matches the derive's `eligible_key_predicate` and the key-mode fan-out, neither of which filters by link. `commit_scenario_batch` has no link filter either. Holdings and weights are already deduped per account (winner key), so the same account is not counted twice.
- **Removed fields.** No non-test reader is left for `equitySnapshots`, `minHistoryDepthMonths` or `equityBaselineUnknown`.

**The new SQL helper** (`derived_account_return_over`) matches the payload the compose writes: `{date, r}` rows, ISO day strings, one row per `(allocator_id, kind)` (it filters `kind = 'equity_curve'`, so the `key_inputs:` / `key_capture:` rows are excluded). Its NULL paths hold:
- no row, version 1, untrustworthy, a non-array `returns`, a non-number `r`, a duplicate day;
- `1 + r <= 0` and an overflowing log-sum;
- underflow is safe, because PostgreSQL `exp_var` returns 0 for large negative arguments and does not raise.

**The CHECK-window conjunct** uses the same expression as `bridge_outcomes_allocated_at_check` and the same transaction-start `CURRENT_DATE`. The D-06 reset touches only holding rows, and the only trigger it fires is `bridge_outcomes_set_updated_at`, whose pivot columns it does not change.

**Verification run on this worktree:**

| Check | Result |
|---|---|
| `npx tsc --noEmit -p .` | clean |
| `npx eslint` on the five changed TS/TSX sources | clean |
| `vitest run` on `queries.my-allocation`, `KpiStrip.warmup`, `legacyretire-runbook-forms`, `getMyAllocationDashboard.scenario`, `bridge-outcome-cron-holding` | 391 passed, 4 skipped; the live-DB file `bridge-outcome-cron-holding.test.ts` SKIPPED for lack of a local stack, so it was not exercised here |
| SQL gate `test_bridge_outcome_deltas_derived.sql` | NOT run here (no lane booted); not verified by this review |

The one finding is a defect the re-based holding branch carries over unchanged. It now decides whether D-05's +90d and +180d outcomes ever exist.

## Warnings

### WR-01: (MEDIUM, user-facing, inherited) A holding outcome never gets its +90d or +180d delta once +30d has landed. D-05's 90/180-day outcome never appears for any new decision.

**File:** `supabase/migrations/20261102120000_bridge_outcome_holding_branch_derived.sql:217` (candidate guard), `:241` (`needs_recompute = FALSE`), `:246` (UPDATE guard). The same guard is at `:166/:196` (strategy) and `:265/:295` (voluntary_add).

**Issue:** A row is a candidate only while `delta_30d IS NULL OR needs_recompute = TRUE`, and every UPDATE sets `needs_recompute = FALSE`. Nothing else ever sets `needs_recompute` back to TRUE. Three places could and none does:
- the `bridge_outcomes_set_updated_at` trigger fires only when `allocated_at`, `percent_allocated` or `kind` change;
- `src/app/api/bridge/outcome/route.ts` sets it only when an outcome is written;
- no cron or worker writes it.

So the first run where `derived_account_return_over(…, 30)` is non-NULL also writes `delta_90d = NULL` and `delta_180d = NULL`, and the row then leaves the candidate set for good.

**Failure scenario:**
1. An allocator records a holding decision with `allocated_at = 2026-11-05`.
2. On about 2026-12-07 the 03:00Z batch finds days 1-30 present and writes `delta_30d`. Days 31-90 do not exist yet, so `delta_90d` and `delta_180d` stay NULL, and the row is marked `needs_recompute = FALSE`.
3. From then on it is never a candidate. `deriveOutcomeLabel` (`src/lib/bridge-outcome-label.ts:65`) stays on "30-day: …" forever.
4. The Outcomes widget's 90d/180d columns stay "—", and `mostMatureDelta` / the win-rate KPI score the decision on its 30-day number only.

**A transient gap is permanent too.** Arm B3's shape is one example: a key that missed one day's sync, with the day back-filled by a later derive. If the gap falls inside the 90-day window when `delta_30d` lands, `delta_90d` and `delta_180d` are never filled.

**What D-06 actually delivers.** It re-measures only rows already old enough. A reset row allocated 30-89 days before the apply gets `delta_30d` on the first run, and its `delta_90d` is then never computed.

**Pre-existing, not introduced here.** The old per-symbol branch had the same guard, so this diff does not regress anything. But this phase rewrote the holding branch to deliver D-05's "+30d, +90d and +180d" outcome, and as shipped it delivers +30d only for every decision younger than 90 days at its first measurement. The new gate does not catch this:
- B1 and R1 seed a 200-day-old anchor, so all three windows land in one run;
- B3 asserts the NULLs after a single run and never the later fill.

**Fix:** keep a row a candidate until every window that has matured is filled, in the holding branch (and, separately booked, in the other two):

```sql
-- holding_candidates and holding_updated, replacing the delta_30d-only guard
AND (
  bo.needs_recompute = TRUE
  OR bo.delta_30d  IS NULL
  OR (bo.delta_90d  IS NULL AND bo.allocated_at <= CURRENT_DATE - 91)
  OR (bo.delta_180d IS NULL AND bo.allocated_at <= CURRENT_DATE - 181)
)
```

This must sit beside the existing `allocated_at >= CURRENT_DATE - '365 days'` conjunct, so it does not reopen the CHECK abort. Add a gate arm that:
1. runs the batch with only days 1-30 present and asserts `delta_30d` is set and `delta_90d` is NULL;
2. extends the derived row to 90 days, runs the batch again, and asserts `delta_90d` is now set.

The arm is RED under the current guard. A row whose 90-day window can never be covered stays a candidate until it ages out of the 365-day window. That is the existing NULL-forever behaviour, already documented in the runbook.

---

_Reviewed: 2026-10-31T17:16:48Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_

---

## Round 2 (re-review of fix round 1, F1-F5)

**Reviewed:** 2026-10-31T18:18:25Z
**Depth:** deep
**Scope:** `git diff 0dfd99f66..ec52e6bdb -- . ':!.planning'` (the migration `20261102120000`, its schema snapshots, the gate `test_bridge_outcome_deltas_derived.sql`, floors, censuses, runbook, ADR and TODOS), read against the whole PR (`git diff origin/main...HEAD`). D-05 as amended in `176-CONTEXT.md` (commit `32846453c`) is the rule I checked against.
**Status:** issues_found. 2 MEDIUM (WR-02 data integrity, WR-03 user-facing). Both were introduced by the fix round. MEDIUM and above only.

### What was verified, and how

All of this ran on throwaway local pg-lane clusters under the scratchpad. Nothing touched PROD or shared TEST.

| Check | Result |
|---|---|
| Gate `test_bridge_outcome_deltas_derived.sql` on a pg-lane with its own `RED-UNDER-SETUP` list | GREEN, `ALL 14 ARMS EXECUTED` |
| `node scripts/mutation-runner/run.mjs --file supabase/tests/test_bridge_outcome_deltas_derived.sql` | `arms: 28/28/0`, `biting: 28`, every arm `RED (identity ok)`, "No defects in the narrowed scope" (exit 2 is the diagnostic-run exit) |
| Arm census 0dfd99f66 -> ec52e6bdb | 19 -> 28 arms (+B3b, B3c, B3d, G2, G2b, H1, H1b, W1, W1b). Matches `ARMS_FLOOR` 848 -> 857 and the ci.yml sentinel note 11 -> 14 |
| vitest: `mutation-runner-floors`, `mutation-annotation-parser`, `gate-family-meta`, `drift-check-scripts`, `bridge-outcome-cron-holding` | 1171 passed, 4 skipped. The live-DB holding file SKIPPED, because there was no local Supabase stack |
| `node scripts/lint-sql-gates.mjs` | 0 findings |
| Migration function bodies vs `supabase/schema/functions/{compute_bridge_outcome_deltas,derived_account_return_over}.sql` | byte-identical |

**Per-fix verdicts:**
- **F2 holds.** An all-NULL holding row is neither stamped nor counted in `updated_count`, and `failed_count` counts it (H1/H1b, plus probe P2 below).
- **F4 holds.** The conjunct is the CHECK's own expression in both new places (G2/G2b bite).
- **F5 holds.** The reset runs inside a `DO` block, and its NOTICE carries a count only.
- **F1 and F3 work as specified on their own arms.** Each opened a hole its arms do not cover: WR-02 comes from F1 and WR-03 from F3.

### WR-02: (MEDIUM, data integrity, introduced by F1) The coverage test reads unvalidated date text, and nothing requires a returns entry inside the window. A malformed or drifted payload now writes an invented 0% (or a partial number) and stamps the row computed. Before F1 it gave NULL.

**File:** `supabase/migrations/20261102120000_bridge_outcome_holding_branch_derived.sql:146-147` (`cov` is `min(day)` and `max(day)` over every `got` row), `:159-160` (the two bounds), `:142` (raw `e->>'date'`). Mirrored in `supabase/schema/functions/derived_account_return_over.sql`.

**Issue:** The two bounds are text comparisons against the min and max of every returns entry's raw `date` text, whether or not that text is a day. The new rule treats each unmatched window day as `lg = 0`. So when no entry matches a window day, the helper still returns `exp(0) - 1 = 0` whenever the raw min sorts at or below the window start and the raw max sorts at or above its end. Under the old `count(lg) = p_days` rule every one of these cases was NULL, so F1 turned a fail-closed path into a fail-open one. The header comment at `:54` says "a malformed date text is an absent day". That holds for matching. It does not hold for coverage.

**Failure scenarios, each measured on a pg-lane** (probes `P5`, `P4` and `P3b`, using the gate's own `pg_temp.bd_*` seeders):
1. **Date-format drift.** Every returns date carries a time suffix (`YYYY-MM-DDT00:00:00Z`), the real return is 1%/day, and the curve starts 10 days before `allocated_at`. One batch run stores `delta_30d = delta_90d = delta_180d = 0.0000000000000000` with `needs_recompute = f`, `updated_count = 1` and `failed_count = 0`.
   - The row has left the candidate set: `delta_30d` is set, and `delta_90d` and `delta_180d` are set too. So the invented 0% is permanent, and the Outcomes widget and win-rate KPI score the decision as flat.
   - The same payload on the pre-F1 body gives NULL.
2. **One stray entry.** A curve that ends at day 20, plus one returns entry with date text `x-bogus` (sorts after every ISO day). `derived_account_return_over(…, 90)` returns `0.2202` (+22.0%): 20 real days, with 70 uncovered days treated as "no change".
3. **An empty window.** A curve whose returns bracket the window but has no entry inside it reads `0.0000`.
   - This is the literal D-05 amended rule ("NULL only when the curve does not cover the window's start and end").
   - It still conflicts with the standing "never invent data: uncomputable metrics are null" rule.
   - The amendment was justified by about 23% scattered gaps, not by an empty window. Per CLAUDE.md Rule 7 this is a conflict to surface to the founder, not one to average.

Scenarios 1 and 2 need a malformed or drifted payload. The compose writes ISO days today. The helper deliberately defends against malformed date text (arm B5c exists for that), and this path defeats that defence.

**Fix:** compute coverage only over well-formed day text. That closes scenarios 1 and 2 without touching D-05:

```sql
cov AS (
  SELECT min(day) AS first_day, max(day) AS last_day
    FROM got
   WHERE day ~ '^\d{4}-\d{2}-\d{2}$'
),
```

For scenario 3, if the founder confirms that an empty window should be NULL, add `AND count(got_day) > 0` to the final CASE. Add a gate arm (RED under the unfiltered `cov`) with:
- a timestamp-suffixed payload whose curve starts before the anchor, expecting all three deltas NULL and the row left `needs_recompute = TRUE`;
- a trailing `x-bogus` entry on a 20-day curve, expecting `delta_90d` NULL.

### WR-03: (MEDIUM, user-facing, introduced by F3) The matured-window refill rewrites deltas that are already stored. The runbook, the migration header and arm W1 all state that stored values are kept.

**File:** `supabase/migrations/20261102120000_bridge_outcome_holding_branch_derived.sql:276-277` (`COALESCE(hc.d30, bo.delta_30d)`, `COALESCE(hc.d90, bo.delta_90d)`: the new value wins), with the refill disjuncts at `:253` and `:286`. The contradicting text is at `:80` ("The COALESCE keeps every value already written"), `:366` ("Idempotent - re-run produces no changes once windows populate"), `docs/runbooks/bridge-outcome-cron.md:96` ("Values already written are kept"), and `supabase/tests/test_bridge_outcome_deltas_derived.sql:785` (W1: "delta_30d kept").

**Issue:**
- **Before F3,** a holding row was a candidate only while `delta_30d IS NULL OR needs_recompute = TRUE`. A stored delta changed only after someone set `needs_recompute = TRUE` on purpose.
- **F3 re-admits** rows with `needs_recompute = FALSE` and a stored `delta_30d`. The UPDATE's `COALESCE(new, old)` then overwrites every stored delta with whatever the current derived curve gives.
- **When this happens:**
  - on the day-91 run (`delta_30d`);
  - on the day-181 run (`delta_30d` and `delta_90d`);
  - on every run for as long as a matured window stays NULL, up to the 365-day edge.
- **Why it is visible:** the derived curve is re-composed in full, and NAVMTM (v0.133.1.0) restates its history. So a +30d outcome the allocator has already seen can silently change sign.
- **Why W1 misses it:** W1 re-derives the same 1%/day curve between its runs, so it cannot tell a kept value from a recomputed one.

**Failure scenarios, measured on a pg-lane:**
- **P1.** A holding row allocated 100 days back on a 30-day curve at +1%/day. Run 1 stores `delta_30d = 0.3478` (+34.8%). The curve is then restated to 90 days at -1%/day. Run 2 stores `delta_30d = -0.2603` (-26.0%), although `needs_recompute` was never set.
- **P2.** A row allocated 150 days back whose curve stops at day 60, as when a key is disconnected and its history kept. That `delta_90d` can never fill. Three consecutive runs each report `updated_count = 1`. The row is rewritten and re-stamped every night until it ages out, and every curve restatement flows into its stored `delta_30d`.

**Fix:** decide which contract is meant; it is a founder call if unclear.
- **If stored values are kept (what the three texts say):** let only an explicit `needs_recompute` re-measure a stored delta. Write only when something new filled:

  ```sql
  delta_30d  = CASE WHEN bo.needs_recompute THEN COALESCE(hc.d30,  bo.delta_30d)  ELSE COALESCE(bo.delta_30d,  hc.d30)  END,
  delta_90d  = CASE WHEN bo.needs_recompute THEN COALESCE(hc.d90,  bo.delta_90d)  ELSE COALESCE(bo.delta_90d,  hc.d90)  END,
  delta_180d = CASE WHEN bo.needs_recompute THEN COALESCE(hc.d180, bo.delta_180d) ELSE COALESCE(bo.delta_180d, hc.d180) END,
  ...
  -- in holding_updated's WHERE, beside the F2 conjunct:
  AND (bo.needs_recompute = TRUE
       OR (bo.delta_30d  IS NULL AND hc.d30  IS NOT NULL)
       OR (bo.delta_90d  IS NULL AND hc.d90  IS NOT NULL)
       OR (bo.delta_180d IS NULL AND hc.d180 IS NOT NULL))
  ```

  Then give W1 a sub-arm that restates the curve between run 1 and run 2 and asserts `delta_30d` is unchanged. It is RED under the current COALESCE order.
- **If re-measuring on refill is intended:** correct `:80`, `:366`, the runbook line and W1's message to say so, and record the decision in CONTEXT/ROADMAP.

### Below the bar (not findings, recorded so they are not re-raised)

- `failed_count` now counts every young holding row (younger than about 31 days) on every run, because its three windows are all still NULL. Nothing alerts on it (the cron discards the result). The runbook line "it is 0 when none exist" reads as "non-zero is a fault", which it is not.
- On the day a window matures, `anchor + N` is yesterday. If the derive has not run by 03:00Z the window fills a day later. That is self-healing.

---

_Round 2 reviewed: 2026-10-31T18:18:25Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_

---

## Round 3 (re-review of fix round 2, WR-02 and WR-03)

**Reviewed:** 2026-10-31T19:08:24Z
**Depth:** deep
**Scope:** commit `2f809341c` (`git show 2f809341c -- . ':!.planning'`): the migration `20261102120000`, its two schema snapshots, the gate `test_bridge_outcome_deltas_derived.sql`, `mutation-floors.mjs`, three census tests, the runbook and the ADR note. I checked it against round 2's WR-02 and WR-03, and against D-05 as amended and refined in `176-CONTEXT.md` (commit `f7f431a8e`).
**Status:** WR-02 closed and WR-03 closed. **0 MEDIUM+ findings.** The fix introduced no regression in the migration or its gate. MEDIUM and above only. The items under "Below the bar" are recorded with measurements so they are not re-raised.

### What was verified, and how

All of this ran on throwaway local pg-lane clusters under the scratchpad, at HEAD `2f809341c`. Nothing touched PROD or shared TEST.

| Check | Result |
|---|---|
| `node scripts/mutation-runner/run.mjs --file supabase/tests/test_bridge_outcome_deltas_derived.sql` | `arms: 33/33/0`, `biting: 33`, `lane-invocations: 33` (the tallies agree), every arm `RED (identity ok)`, including the new B5e, B5f, B5g, W1c and W1d, and "No defects in the narrowed scope". Exit 2 is the diagnostic-run exit. Per file: `sections 14 / judged 33 / annotated 33 / waived 0 / biting 33`, which matches the `ARMS_FLOOR` move 857 -> 862 (+5) |
| Pristine gate on a pg-lane with its own `RED-UNDER-SETUP` list | GREEN, `ALL 14 ARMS EXECUTED` |
| Function bodies in the migration vs `supabase/schema/functions/{derived_account_return_over,compute_bridge_outcome_deltas}.sql` | byte-identical (diff of the `AS $func$ ... $func$` bodies) |
| `node scripts/lint-sql-gates.mjs` | 110 files, 0 findings |
| vitest: `mutation-runner-floors`, `mutation-annotation-parser`, `gate-family-meta`, `drift-check-scripts` | 4 files, 1171 passed |

### WR-03: closed

`holding_updated` (`supabase/migrations/20261102120000_bridge_outcome_holding_branch_derived.sql:295-297`) now picks the value order from the row's own `needs_recompute`:
- set: `COALESCE(new, stored)`, so the new value wins;
- not set: `COALESCE(stored, new)`, so the stored value wins.

In an UPDATE's SET list, `bo.needs_recompute` is the value before the update, so the `needs_recompute = FALSE` assignment at `:298` cannot affect the CASE. The column is `NOT NULL DEFAULT TRUE` (`20260418060747_bridge_outcomes.sql:85`), so the CASE never takes its ELSE branch on a NULL.

The new conjunct at `:314-319` writes a re-picked row only when `needs_recompute` is set or a NULL window actually fills. That makes the COMMENT's "Idempotent - re-run produces no changes once windows populate" true again. Round 2's P1 and P2 scenarios are now pinned:
- W1c: the curve is restated between runs, `delta_30d` stays at +34.8%, and `delta_90d` fills from the restated curve.
- W1d: a row whose +90d can never fill adds 0 to `updated_count` on a re-pick.

Both arms go RED under their mutations.

Probe P3 checked a new state the fix makes reachable: `delta_30d` NULL for good (the first 30 days hold no return), with `delta_90d` and `delta_180d` measured and `needs_recompute = f`. The second run changes nothing, and the row is not counted in `failed_count`. It does not churn.

### WR-02: closed

- **Coverage.** `cov` (`:162-166`) now reads only text matching `^[0-9]{4}-[0-9]{2}-[0-9]{2}$`. PostgreSQL ARE `$` matches at end of string only, so a trailing newline does not slip through. A NULL `date` drops out of the regex test.
- **At least one return.** `AND count(got_day) > 0` (`:176`) makes an empty window NULL. `got_day` is non-NULL only for a `want` day that matched, so this is exactly the founder's "At least one day" rule.
- **Scenarios.** Round 2's time-suffixed payload, trailing `x-bogus` entry and empty bracketed window now all give NULL (arms B5e, B5f, B5g).
- **No regression found.** The existing NULL paths are unchanged: a non-number `r` (still caught by the `bool_or` at `:177`), a duplicate day (`count(*) = p_days`), and the -100% branch.

### Below the bar (measured, not findings)

- **The gate pins one of the three WR-03 value orders, and not the needs_recompute branch.**
  - **Why it is not a finding:** the shipped code is correct, so nothing behaves wrongly today. It only means that a later edit could re-open WR-03 for +90d or +180d without a red gate.
  - **Measured:** I mutated a copy of the migration, applied it through the gate's own setup list, and ran the gate unchanged. All three of these mutants survive (gate GREEN, `ALL 14 ARMS EXECUTED`):
    - the `delta_90d` ELSE branch flipped to `COALESCE(hc.d90, bo.delta_90d)`;
    - the `delta_180d` ELSE branch flipped to `COALESCE(hc.d180, bo.delta_180d)`;
    - the `delta_30d` THEN branch flipped to `COALESCE(bo.delta_30d, hc.d30)`.
  - **Why each survives:** W1c restates the curve only for the 30-day window. W1b re-derives the same 1%/day curve, so it cannot tell a kept value from a recomputed one. R1's reset NULLs every delta first, so the needs_recompute branch never has a stored value to compete with.
  - **Optional tightening:** a W1c-style restatement for a row 190 days back, with `delta_90d` stored and `delta_180d` still open. Plus one row with stored deltas and `needs_recompute = TRUE`, asserting the new value wins.
- **A digit-shaped date that is not a real day still extends coverage.**
  - **Measured (probe P1):** a 40-day curve plus one entry dated `2999-99-99` stores `delta_90d = delta_180d = 0.4889`, i.e. 40 real days with the rest read as no change.
  - **Doc overstatement:** the migration header at `:58-59` says a malformed date "cannot extend the curve's coverage", and that is not true for this shape.
  - **Why it is not a finding:** the compose builds `returns` from date objects (`analytics-service/services/allocator_equity_compose.py:1069`, `book_returns.rows`), so it cannot write such text. The realistic drift case, a format change such as a time suffix, is closed.
  - **Optional tightening:** constrain the month and day in the regex (`-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$`), or soften the header sentence.
- **`needs_recompute = TRUE` with stored deltas re-measures them.**
  - **Measured (probe P2):** a stored +34.8% becomes -26.0% after a restatement.
  - **How it happens:** the bridge outcome route upserts with `needs_recompute: true` on every write (`src/app/api/bridge/outcome/route.ts:165`), including a note-only edit, which the pivot trigger does not treat as a pivot change. If that route reaches a holding-measuring row, editing a note re-measures the outcome.
  - **Why it is not a finding:** this is D-05's stated contract ("overwrites only when `needs_recompute` is set"), and the old basis behaved the same way, so it is not a regression. It is recorded because the effect is visible to the user.

---

_Round 3 reviewed: 2026-10-31T19:08:24Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
