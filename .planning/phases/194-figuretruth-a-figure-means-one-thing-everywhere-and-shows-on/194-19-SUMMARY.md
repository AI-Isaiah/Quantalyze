---
phase: 194-figuretruth-a-figure-means-one-thing-everywhere-and-shows-on
plan: 19
subsystem: database
tags: [trust-05, d-11, d-15, cohort-rank, migration, pg-lane]

requires:
  - phase: 194-03
    provides: MIN_ANNUALIZATION_DAYS and MIN_ANNUALIZATION_OBS in src/lib/figure-gate.ts, the TS bounds the SQL constants are pinned to
provides:
  - "get_verified_cohort_rank leaves out every strategy whose TOTAL record determinably fails D-15's minimum, in both the count query and the rank query"
  - "v_min_span_days = 90 and v_min_obs = 60 as named constants, pinned to the TS bounds by a vitest parity test"
  - "pg-lane stand-in fixture 42 for strategies.asset_class"
affects: [194-20, 194-05]

actuals:
  tokens: 40000
  tasks: 3
  commits: 3

plan_head_before: e795d76269efcaad31e3bac7a6d713878794336a
plan_head_after: 417a62a066e140bc5dfe2f85d2538d3b60141896

tech-stack:
  added: []
  patterns: ["one record predicate, one line, character-identical in both cohort queries and in the DO block's dollar-quoted constant", "dates parsed through public.ledger_refresh_parse_series_date so a bad date leaves a record undeterminable instead of raising"]

key-files:
  created:
    - supabase/migrations/20261107140000_get_verified_cohort_rank_span_gate.sql
    - supabase/migrations/down/20261107140000-rollback.sql
    - scripts/pg-lane/fixtures/42-fixture-strategies-asset-class.sql
    - .planning/phases/194-figuretruth-a-figure-means-one-thing-everywhere-and-shows-on/194-19-REVIEW.md
  modified:
    - supabase/schema/functions/get_verified_cohort_rank.sql
    - src/lib/closed-sets.cohort-gate-parity.test.ts

key-decisions:
  - "A-194-D11-07: one cohort serves all three ranks, so a strategy that fails D-15's minimum leaves the Sharpe, Sortino and Max DD ranks together."
  - "A-194-D15-02: a non-crypto strategy without the stored record_observations falls back to the span rule; an undeterminable record stays in the cohort (null rule, as on lists)."
  - "The three record dates go through public.ledger_refresh_parse_series_date (review round 1), not a bare ::date."

requirements-completed: []  # TRUST-05 closes with the display plans that read these gates

duration: 2 sessions (checkpoint at the reviewer gate, then resume)
completed: 2026-11-07
status: complete
---

# Phase 194 Plan 19: Record-gated Scenario cohort Summary

**`get_verified_cohort_rank` now leaves out of its count and rank queries every cohort strategy whose total record fails D-15's minimum (non-crypto with a stored count: under 60 observations; any other: a span under 90 days, measured from the later of the first date and `headline_since`), with a rollback, a lane fixture, a regenerated snapshot and a SQL-to-TS bound pin.**

## Accomplishments

- **Migration `20261107140000_get_verified_cohort_rank_span_gate.sql`.** A full re-base of the `20260821120000` body. It keeps SECURITY DEFINER, `SET search_path = public, pg_catalog`, the 42501 guard, `v_min_n = 20`, the RANK-01 gate in both queries, decile quantization, the identity strip, REVOKE from PUBLIC and anon, and GRANT to authenticated and service_role. It adds `v_min_span_days CONSTANT INT := 90`, `v_min_obs CONSTANT INT := 60`, the D-15 record predicate on one line right after the RANK-01 gate line in both queries, and one COMMENT sentence. The DO block reads the catalogue only, so it applies the same on an empty TEST as on PROD. It re-asserts (a)-(g) under this migration's name and adds (h), the record predicate appears exactly twice, and (i), both constant lines are present.
- **Rollback `down/20261107140000-rollback.sql`.** Re-applies the `20260821120000` definition, grants and COMMENT verbatim. Manual, off the auto-apply path, with the ledger-row note.
- **Fixture `42-fixture-strategies-asset-class.sql`.** A pg-lane stand-in for `strategies.asset_class` with production's type, default and CHECK. The function is `plpgsql`, so without it a lane creates the function and fails at the first call with 42703.
- **Snapshot and pin.** `supabase/schema/functions/get_verified_cohort_rank.sql` regenerated; it is the only snapshot file that changed. `closed-sets.cohort-gate-parity.test.ts` reads it and pins `v_min_span_days == MIN_ANNUALIZATION_DAYS`, `v_min_obs == MIN_ANNUALIZATION_OBS` (each declared once), and the observation arm and predicate tail occurring exactly twice.

## Lane runs (final lines)

- Six-arm gate on the new definition (`lane-19-gate.log`): `ALL 6 ARMS EXECUTED (1, 2a, 2b, 3, 4a, 4b) and passed — the RANK-01 gate appears in 2 cohort predicates, SECURITY DEFINER + search_path pinned, anon lacks EXECUTE, ...`. The DO block printed `Migration 20261107140000: all assertions passed (...)`.
- Smoke (`smoke-19.log`): `SMOKE 194-19 OK`. `cohort_n` read as `authenticated` rose by exactly 5 (crypto 90 days, crypto 400 days, crypto non-date, traditional 60 observations, traditional 90-day fallback). Left out: crypto 89 days, chain-broken crypto, traditional 59 observations, traditional 89-day fallback. Fixing only the record on each excluded row brought it back in. A stored count decides for non-crypto and is ignored for crypto, and a non-integer or 11-digit count falls to the span arm.
- After rollback (`lane-19-down.log`): `ALL 6 ARMS EXECUTED`, and `DOWN 194-19 OK: no v_min_span_days after rollback`.
- After the review fix: `smoke-19b-red.log` shows the bare-cast version failing with `DateTimeParseError` on an impossible date, and `smoke-19b-green.log` ends with `SMOKE 194-19b OK` on the fixed predicate. The six-arm gate, the parity test and `schema:functions:check` passed again (reported by the fixer).

Neuter, RED, restore from byte backups: `v_min_obs` moved to 50 made the migration's DO block (i) fail, and with the DO check also moved made the smoke fail (`cohort_n went 0 -> 6, expected +5`). The snapshot's span constant set to 91 and its observation constant set to 61 each made the parity pin fail (`expected [ 91 ] to deeply equal [ 90 ]`, `[ 61 ]` vs `[ 60 ]`).

## Drift census

`node scripts/baseline-content-drift-check.mjs` exits 1 with exactly one finding, the expected stale-baseline drift until the post-merge re-dump: `content-drift — DRIFT get_verified_cohort_rank/3 snapshot=1fd8f0cd... chain=cf7395fb... differing-lines=4`. Summary: `MATCH 130, DRIFT 4, SNAPSHOT_MISSING 0, SNAPSHOT_ONLY 0, UNCOMPARABLE 0`, 3 allowlisted rows, `findings 1`. `COMPARED_FLOOR` and the name-set ratchet did not move; the drift script is untouched. This census was taken before the review fix; the fix changes the function body again and the finding still names only this function.

## Reviewer verdicts

- migration-reviewer: clean in round 1 and round 2 (`194-19-REVIEW.md`: `migration-reviewer: clean 2`).
- rls-policy-auditor: one MEDIUM in round 1 (below), clean with 0 findings at any severity in round 2 (`rls-policy-auditor: clean 2`).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Impossible calendar date raised 22008 and failed the RPC for every caller (review round 1, rls-policy-auditor MEDIUM)**
- **Found during:** Task 3 (reviewer gate), round 1
- **Issue:** The predicate cast text to `date` after a shape-only regex, so a date-shaped but impossible string such as `2026-02-31` in the first or last `returns_series` entry or in `headline_since` raised `22008`. The plan's threat T-194-38 had accepted this as low severity; the reviewer judged it MEDIUM because one bad analytics row would make the cohort RPC fail for every authenticated caller.
- **Fix:** A fixer round wrapped the three record dates in `public.ledger_refresh_parse_series_date`, which returns NULL for an impossible date. The row's record becomes undeterminable and, under the null rule, stays in the cohort. The predicate remains one line, character-identical in both queries and in the DO block's `v_rec_pred`. The helper is SECURITY INVOKER with EXECUTE revoked from PUBLIC, anon and authenticated, which is fine because `get_verified_cohort_rank` is SECURITY DEFINER and runs the call as the owner. The function snapshot was regenerated. T-194-38 is therefore mitigated rather than accepted.
- **Files modified:** `supabase/migrations/20261107140000_get_verified_cohort_rank_span_gate.sql`, `supabase/schema/functions/get_verified_cohort_rank.sql`
- **Commit:** 417a62a06

**2. [Rule 3 - Blocking] Lane wrapper script, generated migration**
- The migration and rollback were generated from `20260821120000` with a scratch script so the carried body is byte-faithful, and the lane runs went through a scratch wrapper because the sandbox refused compound lane commands. Nothing from either is committed. No effect on the deliverables.

## Auth gates

None. The reviewer gate (Task 3) was the plan's own `checkpoint:human-action`; the orchestrator ran both reviewers and resumed.

## Notes for plan 20 (gate RED-UNDER-SETUP)

- The existing `supabase/tests/test_get_verified_cohort_rank_gate.sql` RED-UNDER-SETUP list carries neither fixture nor the helper. Plan 20's lane setup for any gate that calls this function must apply, in order and after the existing fixtures: `scripts/pg-lane/fixtures/27-fixture-strategy-analytics-computation-error.sql` (declares `metrics_json`), `scripts/pg-lane/fixtures/42-fixture-strategies-asset-class.sql`, **`supabase/migrations/20260825120000_ledger_refresh_staleness_view.sql`** (defines `public.ledger_refresh_parse_series_date`, now called by the function; a lane without it fails at the first call), `supabase/migrations/20260821120000_get_verified_cohort_rank_computed_gate.sql`, and `supabase/migrations/20261107140000_get_verified_cohort_rank_span_gate.sql`. Fixtures 27 and 42 and the helper migration can be applied before the cohort migrations; the helper must exist before the first RPC call, not before CREATE.
- Plan 20 should commit an arm that seeds an impossible date (for example `2026-02-31` as the first or last `returns_series` date, and as `headline_since`), asserts the RPC does not raise and that the row stays in the cohort. That arm is the committed twin of the throwaway `smoke-19b` check and is what keeps this fix from regressing.
- The slot `20261107140000` and fixture number `42` were free at execution time, so no renumbering was needed.

## Known Stubs

None.

## Threat Flags

None. The only surface added is a call to an existing helper from an existing SECURITY DEFINER function; output stays aggregate-only and the grants are unchanged.

## Self-Check: PASSED

- FOUND: `supabase/migrations/20261107140000_get_verified_cohort_rank_span_gate.sql`, `supabase/migrations/down/20261107140000-rollback.sql`, `scripts/pg-lane/fixtures/42-fixture-strategies-asset-class.sql`, `supabase/schema/functions/get_verified_cohort_rank.sql`, `src/lib/closed-sets.cohort-gate-parity.test.ts`, `194-19-REVIEW.md`
- FOUND commits: 06537f0e2, cff0c43a5, 417a62a06 (ancestors of HEAD)
- `schema:functions:check` current (132 functions); parity test 6 of 6 passing at 417a62a06.
