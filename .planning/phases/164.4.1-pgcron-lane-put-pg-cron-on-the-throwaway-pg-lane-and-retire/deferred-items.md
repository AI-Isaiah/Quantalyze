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

## D-164.4.1-06-1 — plan 06 Task 2's `CLEARED` assertion passes at its own base commit

**Found during:** plan 06 Task 3, while appending to `164.4.1-TRIPWIRE-FIRED.log`.

**Measured 2026-09-05 at base `ddfd55d3`, before any plan-06 edit to that file:**

    $ grep -a -c 'CLEARED' .planning/phases/164.4.1-.../164.4.1-TRIPWIRE-FIRED.log
    1
    $ grep -an 'CLEARED' .planning/phases/164.4.1-.../164.4.1-TRIPWIRE-FIRED.log
    6:PLAN 06 APPENDS THE CLEARED HALF: this file records the tripwire FIRING. Plan 06
      appends the observation that it has been CLEARED (`lane-blocked: 0`) on a
      SHA-bound ubuntu run.

Plan 06 Task 2's `<verify>` runs
`grep -a -c 'CLEARED' <that file> | grep -v '^0$'`, whose stated `fails_when` is
"the `CLEARED` count in the evidence log is `0` (the ubuntu cleared half was not
appended)". It returns 1 on a tree where no ubuntu run has happened and no such
half exists — satisfied by plan 01's own header sentence PROMISING that plan 06
would append one. The assertion binds a bare substring to a document that talks
about itself, so it cannot distinguish the measurement from the plan to take it.

**Why it is logged and not fixed here.** The repair is to the ASSERTION, not the
document: line 6 is a dated record of plan 01's decision, and editing it so a
later grep behaves is the worse defect (the same rule that keeps every superseded
CURRENCY paragraph in place). The correct shape already exists in this phase —
plan 01 Step G binds its literals to a run id and a 40-hex head-sha on the same
section — and applying it to Task 2 is a plan edit, which an executor may not
make to its own verify.

**Consequence for reading plan 06:** a green on that one grep proves nothing.
The ubuntu half of SC-1/SC-3 is unmeasured in this executor's run and is owed to
the orchestrator; see the section plan 06 appended to the evidence log, which
deliberately withholds the ubuntu run id and head-sha rather than paraphrase them
into existence.
