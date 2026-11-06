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

✅ **ITEM 4 IS DISCHARGED — CORRECTED 2026-09-09. The step RAN and PASSED under the pinned CLI.**
Run **`34330741339`**, head `a622df27`, `mode=restore`, 2026-09-09T08:44Z, step 24 → `success`,
printing verbatim `post-verify: the pinned CLI parses the seeded ledger and reports nothing
pending — ledger SHAPE is consistent.` Both asserted strings held under **2.98.2**, which is
precisely the uncertainty this item was written to name. Found by the Phase 164.8 verifier,
confirmed independently by the orchestrator (`gh run view 34330741339` → `conclusion=success`).
⚠️ This item stayed shipped as OPEN for ~8 hours across plan 06's book-closing, and it was also
still scoping Phase 164.9's routed item 2 — a false sentence planning work that may not be needed.
The text below is kept as lineage; it was true when written 2026-09-08. **Item 6 (the extension
guard) is NOT discharged.**

- `unrun-verify` / `.github/workflows/test-restore-from-baseline.yml` — ~~the CLI post-verify step
  (`supabase db push --include-all --dry-run --db-url …`) has NEVER run~~ (superseded, see above).
  It asserts on two
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

---

## From 164.8-04 Task 3 (the restore's own readings) — 2026-09-08

### 6. `restore-test-from-baseline.sh:1090` — the extension guard fires on a GAIN and reports it as a LOSS

Found by 164.8-04 Task 3 in restore run `34274355596` (head sha
`88581b8bc66415bfa86b7d5a019741b1cbd0ff49`, job `102223581037`), which exited 1 with:

```
##[error]restore-test-from-baseline: post-census extensions=7, pre-census had 6. An extension that lived in public was CASCADE-dropped and the dump did not put it back.
##[error]Process completed with exit code 1.
```

**The restore itself was CORRECT.** The transaction committed and every shape assertion ahead
of this guard (`:1073-1077` — tables 62, policies 154, functions 120, ledger_rows 266,
survivors 2/2) had already passed against the values derived from the dump text. The guard
that fired is the first failing one, and it is wrong three ways:

1. **DIRECTION.** `[ "$post_ext" = "$pre_ext" ]` is a strict equality, so it fires on a GAIN as
   readily as on a loss — but its message describes only the loss direction ("was
   CASCADE-dropped and the dump did not put it back"). A reader is sent hunting for a missing
   extension that does not exist.
2. **SCOPE.** The comment above it (the A12 block) reasons about "an extension that lived IN
   public". The reading it compares is `SELECT count(*) FROM pg_extension` (`:282`) — the whole
   database. An extension created in `extensions` or `pg_catalog`, which is where five of the
   six in the dump live, moves the number the guard treats as a public-schema fact.
3. **ORDERING.** It runs after the COMMIT, so it can never prevent the condition it names. It
   can only mislabel a committed result, and here it converted a correct restore into a red run
   plus a skipped post-verify.

**Which extension, measured — not inferred.** Diffing two files inside that run's own backup
artifact (`test-restore-backup-34274355596`):

- `schema-before.sql` (TEST as it was) names five: `pg_cron`, `pg_stat_statements`, `pgcrypto`,
  `supabase_vault`, `uuid-ossp`.
- `restore.sql` (the transaction the dump assembled) names six: the same five plus **`pg_net`**.

Set difference `{pg_net}`. TEST lacked it, PROD has it, the dump creates it, and `plpgsql` is
present in both counts: 5 + 1 = 6 before, 6 + 1 = 7 after. Creating `pg_net` on TEST is the
restore doing its job — the whole point is that TEST should hold PROD's catalogue.

**COLLATERAL DAMAGE, and the reason this is not merely cosmetic.** The exit 1 SKIPPED step 20,
`Post-verify with the Supabase CLI — ledger SHAPE`. ⛔ **CORRECTED 2026-09-09:** this paragraph
went on to say that step "has now never executed in any run", making the plan's
"`supabase db push --dry-run` reports nothing pending" truth UNPROVEN. That was true on
2026-09-08 and is **no longer**: the next morning's restore, run `34330741339` at head
`a622df27`, reached the step and concluded `success` under the pinned 2.98.2 — see item 4, now
DISCHARGED. The collateral-damage point still stands as the reason THIS item matters: a guard
that reddens a correct run does not just annoy, it eats the steps behind it, and on
2026-09-08 it ate exactly this one. What is corrected is the consequence, not the diagnosis.

⛔ **NOT FIXED HERE, by explicit founder instruction** scoping 164.8-04 Task 3 to
`scripts/vac08-ledger-baseline.txt` and its pin. Recorded so the fix is a decision rather than
an omission.

**Remedy when taken** — the shape matters, because the naive fix reintroduces the vacuity:

- Compare a per-schema extension CENSUS, not a scalar count: emit
  `extension\t<extnamespace>\t<extname>` lines from the census query and compare the SETs. That
  makes both the direction and the scope of any change visible in the log.
- Treat a LOSS as fatal (an extension present before and absent after is the CASCADE-drop the
  A12 block is actually about) and a GAIN as expected-and-named — the dump is allowed to create
  extensions TEST did not have; that is the restore working.
- Move the check so a failure cannot silently skip the post-verify: either run it before the
  COMMIT alongside the other shape assertions, or let the post-verify step run with
  `if: always()` so a post-commit verdict cannot cost an unrelated measurement.
- **Add a self-test arm for each direction** (GAIN tolerated-and-named, LOSS fatal) and raise
  `EXPECTED_ARMS`. The current arm count is 21; do not restate that from memory — read it from
  the script's own `--self-test` output. Without both arms the fix is a one-directional guard
  again, in the other direction.
