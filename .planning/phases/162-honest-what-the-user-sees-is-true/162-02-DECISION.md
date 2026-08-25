# 162-02 — Blocker resolution: where HONEST-01 copy is curated

**Decision: curate at the SQL bridge, deriving user copy from the structured `error_kind`,
never from the free-text `last_error`.** This is the executor's option 1, instantiated as the
two-surface pattern this codebase already proved for `api_keys.sync_error`.

Decided 2026-08-26 by the orchestrator under the founder's standing autonomous mandate.
Raised by the 162-02 executor, which stopped rather than average two contradicting design
claims (CLAUDE.md Rule 7). That was the right call.

## The blocker, verified independently

The plan assumed the bridge "copies what it is given". It does not:

- `sync_strategy_analytics_status` branch (b) —
  `20260825150000_sync_status_protect_marked_refresh.sql:816-825` — runs
  `INSERT … VALUES (p_strategy_id, 'failed', v_latest_error, NULL) ON CONFLICT DO UPDATE SET
  computation_error = EXCLUDED.computation_error`, with `v_latest_error` taken from
  `compute_jobs.last_error` (`:670-676`). Branch (b-prime) writes the column as well.
- It fires from inside `mark_compute_job_failed` (`PERFORM sync_strategy_analytics_status`),
  i.e. AFTER the Python stamp.

So a curated Python stamp is overwritten seconds later by raw operator text. Confirmed by
reading both ends; not taken from the report.

## Why this is NOT a conflict between two invariants

The executor found its work reddening a standing invariant
(`analytics-service/tests/test_allocator_positions.py:1330-1354`) and correctly refused to
average. But once the boundary is located properly, the two claims do not conflict — that
invariant is the *template for the fix*, not an obstacle to it. It asserts exactly three things:

1. raw text is ABSENT from the user-visible column;
2. what IS there is one of a small set of copy constants;
3. the diagnosis SURVIVES on operator surfaces (`compute_jobs.last_error`), because that is
   where an engineer reads what happened.

`strategy_analytics.computation_error` is a user-visible column that never adopted this
pattern. The bridge pipes an operator surface straight into a user surface. That is the whole
defect.

This also rules out the executor's option 2 (curating `DispatchResult.error_message` at ~14
sites): it would strip diagnosis from `compute_jobs.last_error` and break invariant (3) for
real. Option 2 is not a relocation of the fix, it is a regression. Option 3 (a new column)
adds a surface to solve a problem that curating one write already solves.

## The shape

Mirror `sync_error_copy` (`analytics-service/services/allocator_positions.py:398-426`), whose
guarantee is made **by the signature, not by vetting what callers pass** — it accepts a status
and a venue, never an exception, so it cannot leak one.

In SQL: derive `computation_error` from `error_kind`, a structured enum whose live domain is
exactly `permanent` / `unknown` / `transient` (measured in PROD: 64 / 55 / 10 of the
`failed_final` rows). A CASE over three arms with a safe default is structurally incapable of
emitting a Python exception string, because the free-text column is never read into the user
surface at all. Both branch (b) and branch (b-prime) must stop copying `last_error`.

Copy loses per-exception specificity. That is the correct trade: three honest sentences beat
`TypeError: '>' not supported between instances of 'str' and 'NoneType'`, which is what users
see today. Follow the existing arms' discipline — promise nothing about retrying that the arm
cannot guarantee.

`compute_jobs.last_error` keeps raw text, unchanged. Operator surfaces stay honest.

## Constraints for the executor

- ⭐ `sync_strategy_analytics_status` has FIVE historical definitions. Grep ALL migrations and
  `CREATE OR REPLACE` from the LATEST (`20260825150000`) only — project rule.
- The migration auto-applies to PROD on merge; header must say so. This cost is now
  unavoidable, so it is no longer an argument for the writer-only route.
- The allocator invariant at `test_allocator_positions.py:1345-1354` must stay GREEN and must
  NOT be retired. If your change reddens it, you have taken option 2 by accident — stop.
- Task 3 (wizard `Details:` appendix) is independent of this and was already clear to proceed.
  Task 2 (`portfolio.py` `_fail`) is genuinely writer-local — `portfolio_analytics` has no
  bridge — so it stays as planned.

## Falsifier

If `error_kind` is not reliably populated on the failure paths that reach branch (b), a CASE
over it degrades to the default arm for everyone and the copy becomes one generic sentence.
That would still satisfy HONEST-01 (no raw text user-facing) but would make the three-arm
structure decorative. Measure the population before building the arms; if it collapses, ship
one honest sentence and say so plainly rather than implying a specificity that is not there.
