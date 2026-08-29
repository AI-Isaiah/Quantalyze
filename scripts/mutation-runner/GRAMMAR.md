# `RED-UNDER-M` — the machine-executable annotation grammar

⚠️ **Phase 164.4 backfills ~70 more gate files against this schema, and plan
164.3-08 annotates the 30 existing arms with it.** Key names and semantics are a
COSTLY decision: changing them later re-touches every annotation written against
them. This document is the contract.

Parsed by [`parse.mjs`](./parse.mjs), executed by [`run.mjs`](./run.mjs).

---

## Why a structured twin exists at all

`supabase/tests/test_strategy_shares_rls.sql` already carries 30 `RED-UNDER:`
comments. Each one claims *this arm was observed as the FIRST failure under this
mutation*. They are **prose** (D-14) — a human sentence, never re-executed. The
claim and the thing are never compared, which is this phase's entire subject.

The prose stays. It is the human claim, and it carries reasoning a JSON object
cannot. The structured twin sits on the **next line** — never in a sidecar
manifest, which would recreate exactly the drift-by-distance this phase exists to
kill.

```sql
  -- RED-UNDER: <the human claim, unchanged>
  -- RED-UNDER-M: {"arm":"…", …}
```

---

## The three annotation rules

### 1. Markers count only at comment line start

A marker is recognised as `^[ \t]*--[ \t]*MARKER`: optional whitespace, the
comment dashes, optional whitespace, the marker. **Nothing else may precede it.**

This is not fussiness. Measured on the corpus, 2026-08-29:

| Counting method | Result |
|---|---|
| naive `grep -c "RED-UNDER"` | **33** |
| `grep -c` of the marker with its colon | 31 |
| line-start-anchored (this grammar) | **30** |

The extra three are the gate file's **own header** documenting the annotation
syntax (`:46-48`) — and one of those header lines matches even a
marker-with-colon grep:

```sql
-- `-- RED-UNDER: <the exact mutation that reddens THIS arm>` comment, and each
```

A coverage number inflated by prose *about* coverage is this phase's thesis
committed inside this phase's own spec. It reached CONTEXT, RESEARCH and
PATTERNS as "33" before a line-start count corrected it. Anchoring makes the
mistake unrepresentable.

`RED-UNDER:` never matches `RED-UNDER-M:` or `RED-UNDER-SETUP:` — the character
after `RED-UNDER` is `-`, not `:`.

### 2. Every byte-edit carries a MEASURED `occurrences`

`occurrences` is **required** on every `edit` and `insert-after` step. It is the
annotator's measurement of how many times the needle appears in the file today.
The runner counts before mutating and raises the distinct defect kind
`occurrence-mismatch` (a MEASURE_FAIL) when the count differs.

This rule was bought with a real failure. `SHAPE 1c`'s prose reads *"change
`generation BIGINT` back to `generation INTEGER` in the STEP 1 CREATE TABLE"*.
Plan 164.3-01 measured it:

- the literal single-space string `generation BIGINT` occurs **exactly once** in
  migration `20260827120000` — at line 828, inside
  `RETURNS TABLE (generation BIGINT, nonce UUID)`;
- that is **not** the STEP 1 CREATE TABLE the prose names;
- mutating it trips the migration's own verification block at line 1181 and
  **aborts the apply**, so the gate never executes and no arm can be the first
  failure;
- the real column declaration at line 170 carries **two** spaces:
  `  generation  BIGINT      NOT NULL DEFAULT 1 CHECK (generation >= 1),`.

A runner that silently no-ops a zero-match find/replace reports *"mutation
applied, arm did not redden"* — a **false defect**. A runner that mutates the
wrong occurrence reads the resulting red as **success**. Both are vacuity, so
"could not locate the bytes" and "the arm did not redden" must never share a code
path. They are separate defect kinds in the report table.

### 3. A mutation may not INJECT the string the detector looks for

The injected text of every step — `replace` on an `edit`, `text` on an
`insert-after`, `stmt` on a `sql` — is **refused at parse time** when it contains
a `TEST FAILED (` literal (matched case-insensitively, with any whitespace).

The runner proves an arm bites by requiring that the **first**
`TEST FAILED (<ARM>)` in the lane's output names the intended arm. Rules 1 and 2
constrain a mutation's *shape*; nothing constrained its *content*, and the gate
file is itself in the corpus — four real steps already edit
`supabase/tests/test_strategy_shares_rls.sql`, so "annotations only touch
migrations" is not an invariant. That left this shape representable:

```json
{"arm":"X","apply":[{"kind":"edit","file":"supabase/tests/<gate>.sql",
  "find":"<any 1-occurrence line>",
  "replace":"RAISE EXCEPTION 'TEST FAILED (X): x';","occurrences":1}]}
```

It reports `RED (identity ok)`, counts toward `armsExecuted` and raises the
biting count — for an arm whose own logic never ran. The mutation satisfies the
**detector** instead of the **arm**: a vacuous check inside the vacuity
detector, and the exact defect class Phase 164.4 would inherit across seventy
more files.

Mutate the code under test, never the failure message. Measured 2026-08-29:
**0 of the 30** annotations in the real corpus inject this literal, so the rule
refuses nothing that exists.

---

## Schema

One single-line JSON object per annotation, inside a SQL comment.

### Top level

| Key | Type | Required | Meaning |
|---|---|---|---|
| `arm` | string | **yes** | The arm ID, matched against `TEST FAILED (<arm>)` in gate output. Must be unique within the file. |
| `apply` | array | exactly one of `apply`/`waiver` | Ordered mutation steps. Multi-step expresses a LAYERED mutation. |
| `waiver` | string | exactly one of `apply`/`waiver` | Reason no first-failure mutation exists. Never executed; counted and printed on every run. |
| `neuter` | array of `{"arm":"…"}` | no | Other arms whose failure must be suppressed first. Forbidden on a waiver. |

Unknown keys are a parse error. So is `apply` together with `waiver`, and so is
neither.

### `apply` steps

**`edit`** — byte-exact find/replace on a repo file.

| Key | Type | Required | Meaning |
|---|---|---|---|
| `kind` | `"edit"` | yes | |
| `file` | string | yes | Repo-relative. No leading `/`, no `..` segment. |
| `find` | string | yes | Byte-exact needle. Non-empty. |
| `replace` | string | yes | May be `""` to delete the needle. **May not contain a `TEST FAILED (` literal — rule 3.** |
| `occurrences` | positive int | **yes** | Measured total matches in the file. |
| `nth` | positive int | no (default `1`) | Which match to mutate. Must be ≤ `occurrences`. |

**`insert-after`** — insertion at a byte-exact anchor.

| Key | Type | Required | Meaning |
|---|---|---|---|
| `kind` | `"insert-after"` | yes | |
| `file` | string | yes | Repo-relative. |
| `anchor` | string | yes | Byte-exact text to insert after. |
| `text` | string | yes | Text inserted immediately after the anchor. **May not contain a `TEST FAILED (` literal — rule 3.** |
| `occurrences` | positive int | **yes** | Measured total anchor matches. |
| `nth` | positive int | no (default `1`) | |

**`sql`** — a statement executed on the throwaway database *after* the migrations
and *before* the gate. This is not a file edit; it is routed through the lane's
`--post-apply` hook, which exists for exactly this shape.

| Key | Type | Required | Meaning |
|---|---|---|---|
| `kind` | `"sql"` | yes | |
| `stmt` | string | yes | Non-empty. **May not contain a `TEST FAILED (` literal — rule 3.** |

### `RED-UNDER-SETUP` — the in-file apply list

Exactly one per annotated gate file. It declares which SQL files the lane must
apply, in order, before running this gate.

```sql
-- RED-UNDER-SETUP: {"apply":["scripts/pg-lane/fixtures/01-fixture-core.sql","supabase/migrations/20260827120000_strategy_shares_generation_model.sql"]}
```

It lives in the gate file for the same reason the twin does: a sidecar mapping of
gate → fixtures is a second place to drift. A gate file with annotations but no
`RED-UNDER-SETUP` is a hard error — the runner refuses to guess a corpus.

---

## One real example per shape

All four are drawn from `supabase/tests/test_strategy_shares_rls.sql`. The prose
lines are verbatim from the corpus.

### Shape 1 — migration-file edit (`:408-409`)

```sql
  -- RED-UNDER: change `generation BIGINT` back to `generation INTEGER` in the
  --            STEP 1 CREATE TABLE.
  -- RED-UNDER-M: {"arm":"SHAPE 1c","apply":[{"kind":"edit","file":"supabase/migrations/20260827120000_strategy_shares_generation_model.sql","find":"generation  BIGINT","replace":"generation  INTEGER","occurrences":1,"nth":1}]}
```

⚠️ Note the twin's needle carries **two** spaces and the prose's carries one.
The twin is what executes; see rule 2 above.

### Shape 1b — insertion with no exact point in the prose (`:369-378`)

```sql
  -- RED-UNDER: add a `token_hash TEXT` column to the STEP 1 CREATE TABLE in
  --            migration 20260827120000.
  -- RED-UNDER-M: {"arm":"SHAPE 1","apply":[{"kind":"insert-after","file":"…20260827120000….sql","anchor":"  generation  BIGINT      NOT NULL DEFAULT 1 CHECK (generation >= 1),","text":"\n  token_hash  TEXT,","occurrences":1},{"kind":"edit","file":"…20260827120000….sql","find":"'created_at,created_by,generation,id,nonce,revoked_at,strategy_id'","replace":"'created_at,created_by,generation,id,nonce,revoked_at,strategy_id,token_hash'","occurrences":1}]}
```

The prose says *"the STEP 1 CREATE TABLE"*; the twin names the byte the insertion
follows. This is the whole point of the grammar.

⚠️ The **second** step is not decoration. The migration's own STEP 7 pins the
same exact column set and would ABORT THE APPLY, so the gate would never run and
no arm could be the first failure. Re-baselining it in the same mutation is what
makes `SHAPE 1` reachable — the LAYERED discipline below, applied to an arm whose
prose does not mention layering at all.

### Shape 2 — live-DB `GRANT` with a prerequisite neuter (`:1533-1577`)

```sql
  -- RED-UNDER: `GRANT UPDATE (nonce) ON strategy_shares TO authenticated` on
  --            the live database. ⚠️ SHAPE 3b's exact-set pin fires first on
  --            ANY grant drift, so this arm was observed red with SHAPE 3b
  --            neutered — at which point NONCE 1b is the first failure and
  --            correctly names rule (0c) as the layer that refused.
  -- RED-UNDER-M: {"arm":"NONCE 1b","apply":[{"kind":"sql","stmt":"GRANT UPDATE (nonce) ON strategy_shares TO authenticated"}],"neuter":[{"arm":"SHAPE 3b"}]}
```

The prerequisite neuter was buried in prose. Here it is a field.

⚠️ Grant drift is a **`sql` step, never a migration edit**, and that is forced
rather than preferred: the migration's STEP 2b pins `authenticated`'s privilege
set EXACTLY and aborts the apply on any drift, so editing STEP 2 means the gate
never runs. The lane's `--post-apply` hook exists for exactly this.

### Shape 3 — LAYERED compound mutation (`:661-665`)

```sql
  -- RED-UNDER: change the CREATE TRIGGER in migration 20260827120000 STEP 1b to
  --            `BEFORE UPDATE ON strategy_shares`.
  -- ⚠️ LAYERED: migration arm (v) tests the same bit and ABORTS THE APPLY, so
  --    its `AND (t.tgtype & 4) = 4` term must be removed in the same mutation
  --    or this file never runs.
  -- RED-UNDER-M: {"arm":"SHAPE 5","apply":[{"kind":"edit","file":"…20260827120000….sql","find":"BEFORE INSERT OR UPDATE ON strategy_shares","replace":"BEFORE UPDATE ON strategy_shares","occurrences":1},{"kind":"edit","file":"…20260827120000….sql","find":" AND (t.tgtype & 4) = 4","replace":"","occurrences":1}]}
```

A multi-step `apply` is applied in order to the same scratch copies, so both
edits land in one run.

### Shape 4 — waiver

⚠️ **The real corpus has none.** All 30 arm-anchored prose markers in
`test_strategy_shares_rls.sql` were given executable twins by plan 164.3-08 and
all 30 bite (`arms: 30/30/0`, 2026-08-29). The form is documented for 164.4,
which will meet arms this file does not have. This is an ILLUSTRATION, not a
corpus quote:

```sql
  -- RED-UNDER: none — a deleted `nonce` aborts the apply, so this arm can
  --            never be the FIRST failure.
  -- RED-UNDER-M: {"arm":"<ARM>","waiver":"a deleted nonce column aborts the apply; no first-failure mutation exists"}
```

Waivers exist so an unfailable arm is **visible and counted**, not silently
absent. Every run prints `arms: <executed>/<annotated>/<waived>` with each
waiver's reason. A waiver is the honest form of "we could not prove this one";
omitting the annotation entirely is the dishonest form, and the parity gate makes
it a hard failure.

⛔ **A waiver is not free.** Converting a biting arm to a waiver lowers the biting
count and therefore trips `ARMS_FLOOR` (pinned at the measured 30). Widening a
waiver has to be a deliberate, reviewed edit to that constant — which is what
stops waiver creep from quietly hiding a non-biting arm (`T-164.3-21`).

---

## The parity gate

Per file: `count(RED-UNDER prose) == count(RED-UNDER-M twins)`, where a **waiver
counts as a twin**. Any imbalance is a `parity` defect and exits 1.

This is what keeps 164.4's backfill honest. Without it, a backfill could annotate
the easy arms, leave the hard ones prose-only, and still report a rising
"annotated files" number.

A **malformed** annotation is never counted as a twin, so a broken JSON object
breaks parity as well as raising its own `parse` defect. There is deliberately no
code path on which a bad annotation is skipped.

## Neuter semantics

A `neuter` entry names ANOTHER arm whose `RAISE EXCEPTION 'TEST FAILED (<arm>)…'`
is replaced with a no-op **in the scratch copy of the gate file**, before the
mutation runs. It exists because some arms are structurally shadowed: an
exact-set pin fires on any drift, so the narrower arm behind it can never be the
first failure while the pin is live.

After the run, the runner asserts `TEST FAILED (<neutered arm>)` does **not**
appear in the output. A neuter that silently missed its target would leave the
shadowing arm live, the annotated arm would not be first, and the run would
report a wrong-identity defect for the wrong reason. `neuter-missed` is therefore
its own defect kind.

### The abort-path cleanup goes with the RAISE

A `RESET ROLE;` sitting immediately before the neutered `RAISE` is commented out
**with it**. This is semantics, not tidying: those statements exist only to
restore state before ABORTING the file, and a neutered arm's file keeps running,
so executing its abort-path cleanup corrupts everything downstream.

MEASURED 2026-08-29, plan 164.3-08's first full-corpus run. `N1 3a` neuters
`N1 1a`, whose branch is

```sql
  IF NOT raised OR err_msg NOT LIKE '%AT MOST ONE%' THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (N1 1a): …';
  END IF;
```

and which **does** execute under that mutation — that is why it needs neutering.
With only the `RAISE` removed, the session dropped from `authenticated` to the
superuser session role for the rest of the file, and sixteen arms later
`NO-DELETE 1`'s `DELETE FROM strategy_shares` succeeded because a superuser needs
no grant. The runner reported `wrong-first-failure: NO-DELETE 1`.

⛔ **It was loud only by luck.** A leaked superuser role makes every downstream
GRANT arm pass for a reason unrelated to the grant — a vacuous PASS inside the
vacuity detector. Phase 164.4 annotates seventy more files against this
primitive, so the behaviour is pinned by
`src/__tests__/mutation-runner-neuter.test.ts` rather than left to the corpus.

Only an exact `RESET ROLE;` is absorbed. A branch that does real work before
raising is never silently swallowed.

## Defect kinds the runner reports

| Kind | Meaning |
|---|---|
| `parse` | Malformed or invalid annotation. Names the line. |
| `parity` | Prose/twin count mismatch in a file. |
| `occurrence-mismatch` | **MEASURE_FAIL.** The needle matched a different number of times than `occurrences` claims. The mutation was NOT applied. |
| `no-red` | The mutation applied, the gate still passed. The arm cannot fail. |
| `wrong-first-failure` | The gate went red, but the FIRST `TEST FAILED (…)` names a different arm. Red-anywhere is not success. |
| `neuter-missed` | A neutered arm still appeared in the output. |
| `baseline` | Pristine copies did not go GREEN before any mutation — a broken corpus. |
| `restore` | Pristine copies did not go GREEN after the arm runs. |
| `dirty-checkout` | `git status --porcelain` was non-empty after the run. Mutations must only ever touch scratch copies. |
| `floor` | Coverage fell below a pinned ratchet floor. |

All arms run before the report is printed; the runner never stops at the first
failing arm (OPS-08-F8). First-failure identity is asserted **within** an arm's
run; aggregation happens **across** arms.
