# Deferred items — phase 164.4

Out-of-scope discoveries logged during execution. NOT fixed here.

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
