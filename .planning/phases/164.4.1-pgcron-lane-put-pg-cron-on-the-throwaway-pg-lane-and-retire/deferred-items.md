# Phase 164.4.1 — deferred items

Out-of-scope discoveries logged during execution. Per the executor's scope boundary,
these were NOT fixed: they are pre-existing and unrelated to the task that found them.

## D-164.4.1-01-1 — `.planning/WINDOWS.md` frontmatter counts disagree with its own rows

**Found during:** plan 01 close-out, trying to book the deferred Step G as an
`unrun-verify` entry.

**Measured 2026-09-04, unmodified tree:**

```
$ node gsd-tools.cjs windows append --kind unrun-verify --phase 164.4.1 ...
Error: Ledger counts disagree with entries: frontmatter open/waived/fixed/total=26/0/2/28
       but entries yield 29/0/2/31.
```

**Pre-existing, not introduced here.** `git log -1 -- .planning/WINDOWS.md` puts the last
write at `35c0418f` (2026-09-02, v0.77.1.0, Phase 164.3.1), and the file's own
`last_updated` reads `2026-08-29`. Three rows were added without their counts being
updated, or three counts were written without their rows.

**Why it was NOT fixed here.** The tool refused to WRITE rather than compounding the
drift, which is the correct behaviour. Recomputing the frontmatter to match the rows
would be rewriting a ledger this plan never measured, on a phase that has nothing to do
with it — and the counts are the thing `/gsd-ship` gates on, so a silent correction by a
plan whose subject is a PostgreSQL extension is exactly the wrong provenance for it.

**Consequence, stated plainly:** the ledger is currently UNWRITABLE, so no phase can book
a broken window through the tool until it is reconciled. The one this plan needed to book
is instead recorded in two committed places that a reviewer cannot miss:
`164.4.1-TRIPWIRE-FIRED.log` (its own section, under a heading deliberately NOT matching
the plan's verify grep) and `164.4.1-01-SUMMARY.md` (Deviations + Deferred Issues).

**Fix** = decide which side is authoritative by reading the rows, then recompute the
frontmatter counts from them in a commit that says which three entries were the drift.
