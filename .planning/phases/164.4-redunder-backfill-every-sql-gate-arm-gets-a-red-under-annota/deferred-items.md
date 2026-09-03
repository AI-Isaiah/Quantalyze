# Deferred items — phase 164.4

Out-of-scope discoveries logged during execution. NOT fixed here.

> ⭐ **PROMOTED TO `TODOS.md` 2026-09-03 by the orchestrator.** Every item below now also carries a
> root-`TODOS.md` entry — `[REDUNDER-COVGAP-01]`, `[REDUNDER-COVGAP-02]`, `[REDUNDER-WINDOWS-01]`.
> This file is under `.planning/phases/**`, which EVERY PR in this phase filters out, so an item
> booked only here does not reach `main` until milestone archival. `TODOS.md` is the single ground
> truth and is not filtered. Book here for the phase's own narrative; book to `TODOS.md` to be found.

## 2026-09-03 (plan 164.4-06) — `.planning/WINDOWS.md` frontmatter counters disagree with its own rows

`gsd-tools windows fixed 28` refuses with:

```
Error: Ledger counts disagree with entries: frontmatter open/waived/fixed/total=26/0/2/28
but entries yield 29/0/2/31.
```

So the ledger cannot be written to at all until the counters are reconciled. This is
PRE-EXISTING (the mismatch is not produced by anything this plan touched) and out of
this plan's scope, so nothing was written to `WINDOWS.md`.

Consequence for PATTERNS § P4 item 13b: `CLAUDE.md:57-59` still says entry 28 is closed
while `WINDOWS.md` row 28 still reads `open`. The EVIDENCE for closing it is now much
stronger than when that disagreement was first noted — `sql-mutation` has run green on
ubuntu four times (33620169220, 33751634051, 33774615747, 33785233457) — but the flip
cannot be made through the tool until the counters are fixed. Book the reconciliation to
`TODOS.md`, then close entry 28.

## 2026-09-03 (plan 164.4-07) — `test_funding_fees_rls.sql` Assertion 2 cannot see its own conjunct

MEASURED while authoring the twin. Dropping ONLY the `AND s.user_id = auth.uid()`
conjunct from `funding_fees_read`'s USING predicate scores **NO-RED**: the policy's
sub-select on `strategies` is itself subject to `strategies`' OWN RLS, which already
hides tenant B's DRAFT strategy from tenant A. The conjunct is the binding constraint
only for a strategy the reader can already see — i.e. a **PUBLISHED** one — and this
gate seeds only `status='draft'` strategies, so it cannot distinguish "funding_fees_read
is owner-scoped" from "strategies_read is owner-scoped".

The twin therefore replaces the whole predicate with `true`, which the arm CAN observe.
Out of scope here (the phase may not add arms): a seeded PUBLISHED strategy owned by
tenant B would make the conjunct itself falsifiable. Book to `TODOS.md`.

## 2026-09-03 (plan 164.4-07) — `test_user_notes_dashboard_scope.sql` Assertion 4 has a second, incidental fence

MEASURED while authoring the twin. Opening `user_notes_insert_own`'s
`WITH CHECK (user_id = auth.uid())` to `true` ALONE scores **NO-IDENTITY**: tenant B's
forge targets tenant A's EXISTING `(user_id, scope_kind, scope_ref)` triple, so once the
policy admits it the `user_notes_unique_multiscope` UNIQUE index refuses it with 23505 —
a SQLSTATE the arm's handler (`insufficient_privilege OR check_violation`) does not
catch, so the file dies outside every arm.

So on THIS forge the unique index, not the INSERT policy, is the outer fence. The twin
drops the UNIQUE in the same layered apply to make the policy observable. Out of scope
here: a forge at a FRESH `scope_ref` would meet the policy alone and would make the arm
self-contained. Book to `TODOS.md`.
