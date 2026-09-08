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

---

## From 164.8-03 (the workflow and its wiring pins) — 2026-09-08

### 3. `plan-anchor-verify` is RED on this branch for a PRE-EXISTING stale anchor in `164.8-06-PLAN.md`

`node scripts/verify-plan-anchors.mjs --pending` exits with:

```
MISS .planning/phases/164.8-testpreprod-test-becomes-a-real-pre-prod/164.8-06-PLAN.md:143
     [range-out-of-bounds] CLAUDE.md:328-350
     CLAUDE.md has 267 lines; the anchor claims line 350.
claims: 86 checked
FAIL: 1 stale claim(s) across 6 plan file(s).
```

**Cause, measured:** commit `19e46a22` ("docs(claude-md): split dated SQL-gate lineage out of
the governing file", -282 / +49 in `CLAUDE.md`, the commit immediately before this wave) shrank
`CLAUDE.md` from ~598 lines to 267 and moved the "Which database am I on?" section that
`164.8-06-PLAN.md:143` cites. The plan did not move with it — the exact 164-04 shape the
verifier's own message names.

**NOT fixed here, deliberately.** It is not caused by this plan's changes (both of this plan's
files are new), it does not block any of this plan's tasks, and it lives in a DIFFERENT plan's
file that a later wave will execute — editing it from wave 3 risks colliding with that
executor. Re-anchoring also requires deciding what the plan MEANT to cite now that the section
has moved, which is Plan 06's judgement, not this executor's.

**Remedy for whoever picks it up:** re-resolve `CLAUDE.md:328-350` to the current line range of
the `## Which database am I on? (ask FIRST, every time)` section, in `164.8-06-PLAN.md`'s
`<read_first>` at line 143. Re-run `node scripts/verify-plan-anchors.mjs --pending` — it must
print `claims: 86 checked` with no `MISS`.

⚠️ `plan-anchor-verify` is one of the three jobs the `frontend` aggregator gates on, so this
will show as a red check on the 164.8 PR until it is fixed. It is a stale planning claim, not a
defect in the workflow or the restore script.

### 4. The broken-windows ledger STILL refuses every write (re-confirmed 2026-09-08 by 164.8-03)

```
node gsd-tools.cjs windows append --kind unrun-verify --phase 164.8 …
→ Error: Ledger counts disagree with entries:
  frontmatter open/waived/fixed/total=37/0/10/47 but entries yield 40/0/10/50.
```

Identical to the refusal `164.8-01` recorded (item 1 above), same numbers — nothing has moved.
The entry 164.8-03 owed the ledger, recorded here instead:

- `unrun-verify` / `.github/workflows/test-restore-from-baseline.yml` — the CLI post-verify step
  (`supabase db push --include-all --dry-run --db-url …`) has NEVER run. It asserts on two
  strings measured in the LOCAL Supabase CLI binary v2.84.2 on 2026-09-08
  (`Would push these migrations:` and `Remote database is up to date.`); **CI pins 2.98.2**, where
  the wording is inferred, not executed. The step asserts BOTH directions on purpose so a wording
  change reddens instead of passing vacuously, and its own `::error::` tells the first reader to
  verify the 2.98.2 wording before concluding anything about the ledger. First real execution is
  Plan 04, behind the founder `checkpoint:decision`.

### 5. `restore-test-from-baseline.sh:821` — unescaped backticks inside the `TXN_CLOSURE` heredoc

Found by 164.8-04 while reading the preflight log (run 34258614075, head sha e6c76832), where
the script emitted, on stderr, into a PUBLIC log:

```
scripts/restore-test-from-baseline.sh: line 765: toast: command not found
```

`cat >> "$out" <<TXN_CLOSURE` uses an UNQUOTED delimiter, so backticks inside the body are
command substitutions. Line 821 quotes a measured object name in prose with bare backticks —
`` `toast table pg_toast.pg_toast_16428` `` — and bash ran that as a command. The sibling
occurrences at :799, :801, :847 and :849 are correctly escaped (`` \` ``); this one was missed.

**Measured impact: cosmetic.** The backticks sit inside a single-line `--` SQL comment, so the
generated transaction stays valid SQL and only loses that comment's quoted text. The preflight
ran the whole transaction to a byte-for-byte-equal post-census with the defect present.

**Why deferred rather than auto-fixed under Rule 1:** the script is only ever executed by
`workflow_dispatch` FROM `main`, so any edit costs another founder merge sitting between the
preflight and the restore — a real timing cost on a one-way door, spent on a lost code comment.

**Remedy when taken:** escape the pair as ``\`toast table pg_toast.pg_toast_16428\` ``, and add
a self-test arm asserting the generated `restore.sql` contains that literal text, so the class
(an unescaped backtick eating heredoc content) is caught rather than re-introduced. A future
occurrence inside SQL rather than a comment would silently DELETE statement text.
