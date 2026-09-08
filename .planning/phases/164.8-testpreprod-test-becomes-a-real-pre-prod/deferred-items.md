# Phase 164.8 — deferred items (out of scope for the plan that found them)

## Found during 164.8-01 execution, 2026-09-08

### 1. `.planning/WINDOWS.md` frontmatter counts disagree with its own entries — PRE-EXISTING

`gsd-tools windows append` refuses every write with:

```
Error: Ledger counts disagree with entries: frontmatter open/waived/fixed/total=37/0/10/47
       but entries yield 40/0/10/50.
```

Measured on an unmodified `WINDOWS.md` (this plan never edited it). The consequence is that
**the broken-windows ledger cannot be appended to at all**, so any executor that follows the
`summary_creation` step's "append one entry per defect" instruction silently records nothing.
Two entries that 164.8-01 would have filed are recorded here instead:

- `deviation` / `scripts/restore-test-from-baseline.sh` — TOAST relations were reported as lost
  non-public dependents by the derived `pg_depend` closure; resolved through their carrier table
  (`reltoastrelid`). Measured, not predicted: the first run of both self-test arms aborted on
  `pg_toast.pg_toast_16428`.
- `unrun-verify` / `scripts/restore-test-from-baseline.sh` — `pg_default_acl` is not in the
  derived-census `refclassid` resolution set. `ALTER DEFAULT PRIVILEGES … IN SCHEMA public`
  records a `pg_depend` row the closure cannot resolve, so it would abort a real TEST preflight
  even though the dump re-creates those grants (`supabase/schema/baseline.sql:15115-15138`).
  Left unresolved deliberately — a false abort is safe and names the object, a false pass is not
  — and Plan 04's preflight is what measures whether TEST carries any.

⛔ Not fixed here: out of scope for 164.8-01, and reconciling a defect ledger's counters is
exactly the kind of adjacent "improvement" that hides which entry moved.

### 2. GSD state handlers clobber `.planning/STATE.md` and `.planning/ROADMAP.md` — PRE-EXISTING, re-confirmed

`STATE.md`'s own ⛔ block already names SEVEN clobbering handlers. Re-confirmed this session for
`state.advance-plan` / `state.update-progress` / `state.record-metric` / `state.record-session`,
and **`roadmap.update-plan-progress` should be added to that list — it is currently absent from
it.** Measured: it appended a stray `- [ ] 164.8-06-PLAN.md` ABOVE an ordered list rather than at
its position, and inserted a blank line into an unrelated Phase 164.10 section. Both files were
reverted and the intended edits hand-applied.
