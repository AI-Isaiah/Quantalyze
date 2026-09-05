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

## D-164.4.1-04-1 — a `pg_get_functiondef` text anchor is satisfied by a COMMENT inside the function body

**Found during:** plan 04 Task 2, the first drive of the `1/re-base` twin.

**Measured 2026-09-05 on a real lane.** The twin deleted BOTH
`AND d.kind = f.kind` conjuncts from the re-based bridge in
`supabase/migrations/20260802120000_strategy_analytics_stuck_computing_reaper.sql`
and re-based that migration's own STEP 7 check. The runner reported:

```
  no-red                1/re-base                 supabase/tests/test_strategy_analytics_stuck_computing_reaper.sql
      the mutation applied (occurrence count verified) but the gate still passed — this arm cannot fail
```

Reproduced by hand on scratch copies: `rc=0`, all seven `Part … OK` notices printed.
The cause is that `pg_get_functiondef` returns the function's SOURCE, comments
included, and `20260802120000:353` carries

```sql
  -- PER-KIND (d.kind = f.kind): a later done of a DIFFERENT kind can NEVER mask a
```

INSIDE the body — so `v_fn !~* 'd\.kind\s*=\s*f\.kind'` kept matching a comment
ABOUT the conjunct after the conjunct itself was gone.

**Scope of the weakness:** every `v_fn ~*` / `v_fn !~*` anchor in this file's Part 1a,
and by construction every anchor of that shape anywhere in the corpus. A revert that
removes the code and leaves the explanatory comment is invisible to all of them. The
two NEGATIVE anchors are worse in the other direction: a comment that merely MENTIONS
`computing_started_at = now()` would fire them on a correct body.

**Why it was NOT fixed here.** Fixing it means editing assertions — either stripping
comments before the regex (`regexp_replace(v_fn, '--[^\n]*', '', 'g')`) or narrowing
each anchor. Plan 04's action explicitly says *"No spelling conversion, no assertion
edits"*, and the same shape lives in `20260802120000`'s STEP 7 and in
`20260803120000`'s STEP 4, i.e. in migrations this phase must not touch at all. The
twin was instead made HONEST about it: `1/re-base` now carries a fourth step that
rewrites the comment, which is what a real revert would do to it, and the twin's prose
states the residual.

**Fix** = strip SQL line comments from `v_fn` once, at the top of Part 1a, and re-run
the `1/re-base` twin without its fourth step to prove the strip is load-bearing.
