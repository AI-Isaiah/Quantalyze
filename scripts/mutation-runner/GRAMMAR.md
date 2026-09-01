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

### 3. A mutation may not change WHO the gate says it is

A mutation may change what the gate **does**. It may never change what the
first-failure identity check **reads**, nor the condition under which the gate
says it. That has **three** halves, refused in three different places, because
each is decidable somewhere the others are not.

⛔ **Read this before adding a fourth regex.** Rule 3 has been "closed" in three
consecutive review rounds and re-opened in each of them by a re-spelling —
`{"find":"ANON 1a): "}` defeated the injection rule, `'TEST FAI' || 'LED ('`
defeated the needle rule, `IF NOT raised` → `IF TRUE` defeated the identity
rule, and a `sql` step was never subject to the apply-time rule at all. **Any
rule stated over an annotation's spelling can be re-spelled around.** 3a is kept
because it is cheap and early, but it is explicitly NOT the closure. 3b is stated
over the file. 3c is stated over what the database actually printed, and is the
only one of the three that cannot be re-spelled at all.

#### 3a — it may not INJECT the literal (refused at parse time)

The injected text of every step — `replace` on an `edit`, `text` on an
`insert-after`, `stmt` on a `sql` — is **refused at parse time** when it contains
a `TEST FAILED (` literal (matched case-insensitively, with any whitespace),
**directly or after collapsing SQL string concatenation** (`'TEST FAI' || 'LED ('`).

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

The needle side is refused too: `find` on an `edit` and `anchor` on an
`insert-after` may not name a `TEST FAILED (` literal either. Rewriting a
failure message in *either* direction changes what the identity check reads
instead of what the arm does. Measured: **0 of the 49** file steps in the real
corpus target this literal.

⭐ That needle rule load-bore for 3c while 3c was the identity NONCE (until
2026-09-01): because no needle may name the literal, the runner could stamp every
identity in the gate copy **before** the mutation steps ran, without disturbing a
single `find` or occurrence count. Source-location attribution rewrites the gate
copy not at all, so 3c no longer depends on it — the needle rule now stands on 3b
alone, which is where it always belonged.

⚠️ **3a is not the closure and must never be cited as one.** Concatenation
collapsing closes one more spelling; `format('TEST FA%sED (X)', 'IL')`,
`chr(84) || …` and an unbounded set of others produce the same bytes at runtime
and are invisible here. That is not a hypothesis — the self-test fixture
`fixtures/selftest/synthesised-identity-gate.sql` is deliberately spelled with
`format()` so that only 3c can catch it.

#### 3b — it may not REWRITE a FAILURE BRANCH (refused at apply time, by CONTENT)

⛔ 3a is a rule about **how the annotation is spelled**, and a rule about
spelling can be re-spelled around. The general attack carries no `TEST FAILED`
text anywhere — it re-points an **existing** raise:

```json
{"arm":"N1 1a","apply":[{"kind":"edit","file":"supabase/tests/<gate>.sql",
  "find":"ANON 1a): ","replace":"N1 1a): ","occurrences":1}]}
```

Measured against the real gate file: that parses **clean** under 3a, and
applying it moves `ANON 1a` from 1 occurrence to 0 and `N1 1a` from 1 to 2.
`firstFailureArm` then reads `N1 1a`, the runner reports `RED (identity ok)`,
and `biting` rises for an arm whose own logic never ran — the same outcome 3a
exists to prevent, reached without the literal 3a looks for.

So the runner also states the rule over the **file**, where it cannot be
re-spelled. The unit is the **failure branch**: the exact text from the head of
the branch enclosing a `TEST FAILED (` raise through the end of that raise's
statement. The ordered list of failure branches must survive a mutation
**byte-identical**. A step that changes it is the defect kind
`identity-rewrite`, raised **before** the lane runs, in both the full run and
`--parse-only`.

⚠️ The unit used to be a **sorted multiset of identities**, and that was blind in
two measured ways, both found in round 3:

- **swaps.** Exchanging two arms' identities leaves the sorted multiset
  byte-identical, so a single `edit` spanning both raises returned "no
  violation". Ordering by position makes it visible.
- **guard negation.** `IF NOT raised THEN` → `IF TRUE THEN` preserves every
  identity exactly. Measured against the real gate it parsed clean, applied
  cleanly and passed the multiset compare — while the owner-coherence
  `WITH CHECK` the arm claims to test was never evaluated. The guard is part of
  the branch, so it is part of the invariant.

⚠️ Neuters are deliberately exempt — neutering an arm removes its identity on
purpose. The comparison is taken across a mutation step only, with the
post-neuter text as its "before".

Measured 2026-08-29 across the real corpus — 30 annotated arms, 49 file steps,
103 failure branches — **0 violations**, so the invariant refuses nothing that
exists.

⚠️ 3b does **not** see a raise injected with the literal spelled indirectly: it
is not recognised as a failure branch, so it appears in neither list. That half
belongs to 3c.

#### 3c — an identity is READ only where the RUNNER's gate RAISED it (refused at RUN time, by SOURCE LOCATION)

⛔ The measured shape that defeated both halves above, and which no text rule can
reach:

```json
{"arm":"X 1","apply":[{"kind":"sql",
  "stmt":"DO $$ BEGIN RAISE EXCEPTION '%', 'TEST FAI' || 'LED (X 1): x'; END $$"}]}
```

`errors=0 accepted=1`. At runtime the lane emits `TEST FAILED (X 1)`,
`firstFailureArm` reads `X 1`, the runner reports `RED (identity ok)` and
`biting` rises — **for an arm that never ran, against a gate file that was never
touched.** A `sql` step is not a file edit, so it was never subject to 3b at
all; and its spelling can always be changed, so 3a can always be evaded.

So the runner stops asking what the annotation *says* and asserts over what the
database *printed* — and, since 2026-09-01, over **where the database printed it
from**.

##### THE RULE

Each lane runs `psql` with `VERBOSITY=verbose`. An identity is **ATTRIBUTED** to
an arm only when **all three** of these hold — measured on PostgreSQL 16.13:

| Leg | Assertion |
|---|---|
| **(a)** | the `psql:<file>:<line>:` prefix names **this lane's gate scratch file**, at the failing statement's LAST line |
| **(b)** | the error's CONTEXT chain is **EXACTLY ONE** frame, `PL/pgSQL function inline_code_block line N at RAISE`, bounded by verbose's `LOCATION:` sentinel |
| **(c)** | `stmtStartLine + N − 1` equals the arm's raise line, resolved through the statement tokenizer's spans |

The genuine shape, and the two things that make it decidable:

```
psql:<gate scratch>:9: ERROR:  P0001: TEST FAILED (X 1): demo arm
CONTEXT:  PL/pgSQL function inline_code_block line 5 at RAISE
LOCATION:  exec_stmt_raise, pl_exec.c:3911        ← chain ended: exactly 1 frame
```

Anything else — extra frames, a named function, `at EXECUTE`, a non-gate prefix,
a severity other than `ERROR`, a SQLSTATE other than `P0001`, or an identity
carried by a CONTEXT/DETAIL **field** rather than by the message — scores
`SYNTHESISED` or `NO-IDENTITY`, and the arm is **not counted as biting**. Output
whose grammar the parser cannot read at all is a loud `MEASURE_FAIL`, never a
silent pass.

##### SUPERSEDED, kept as the lineage this design is built on: the identity NONCE

Until 2026-09-01, 3c stamped a fresh random nonce into the scratch copy of the
gate before each lane and read only stamped identities:

```
TEST FAILED (ANON 1a)   ->   TEST FAILED (7f3c9a1e|ANON 1a)
```

⛔ **[R4-C02] measured that dead.** The nonce was a *secret transmitted to the
attacker*: the stamped text sits in the query text of the statement the gate is
running, and PostgreSQL hands query text to server-side code. A trigger
installed by a `sql` step — no file read, no superuser — read it back:

```sql
RAISE EXCEPTION '%', substring(current_query() from 'TEST FAILED \([^)]*\)');
```

and an arm whose own raise was guarded by `IF FALSE` scored `RED (identity ok)`
with `biting: 1`. Source location is not a secret at all, so there is nothing to
transmit and nothing to steal.

##### ⭐ AUTHORING RULE for 164.4 (and every annotation after it)

> **An arm's `TEST FAILED (…)` raise MUST sit DIRECTLY in a `DO $$ … $$;` body.**
>
> A raise nested inside `EXECUTE`, inside a helper function, or inside a trigger
> is refused `NO-IDENTITY` — **by design, and loudly**. It is not a bug to
> report; it is the control working.

Why the rule has to be this strict: the innermost CONTEXT frame **alone is
forgeable**. A trigger running

```sql
EXECUTE 'DO $d$' || repeat(E'\n', k) || 'BEGIN RAISE EXCEPTION ''…''; END $d$'
```

produces an `inline_code_block line N at RAISE` frame whose **name and line are
both attacker-chosen**, under the gate file's own `psql:` prefix — legs (a) and
(c) both pass. MEASURED 2026-09-01: with `k = 4` the forgery landed on the
genuine arm's exact resolved line. What an attacker cannot *remove* is the rest
of the chain, so the chain's **length** is the control, and
`164.3.1-05-ATTRIBUTION.md` records it flipping to a false `RED (identity ok)`
when neutered to first-frame-only.

All 104 identities in today's corpus are single-frame direct DO-body raises, so
this rule refuses nothing that exists. It is written down here so a 164.4 author
meets it as a **contract** rather than as a surprise from the runner.

⚠️ **Honest residual.** A hostile annotation can still make the database print
arbitrary text; what it can no longer do is make that text *attributable*, and a
hostile annotation remains visibly hostile in review. The psql CONTEXT grammar is
measured on macOS / PostgreSQL 16.13 only — the `sql-mutation` CI job has never
executed on its ubuntu host (WINDOWS.md 28), so the parse rides an unobserved
host and answers that with `MEASURE_FAIL`, not with a fallback.

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
| `find` | string | yes | Byte-exact needle. Non-empty. **May not name a `TEST FAILED (` literal — rule 3a.** |
| `replace` | string | yes | May be `""` to delete the needle. **May not contain a `TEST FAILED (` literal — rule 3a.** |
| `occurrences` | positive int | **yes** | Measured total matches in the file. |
| `nth` | positive int | no (default `1`) | Which match to mutate. Must be ≤ `occurrences`. |

**`insert-after`** — insertion at a byte-exact anchor.

| Key | Type | Required | Meaning |
|---|---|---|---|
| `kind` | `"insert-after"` | yes | |
| `file` | string | yes | Repo-relative. |
| `anchor` | string | yes | Byte-exact text to insert after. **May not name a `TEST FAILED (` literal — rule 3a.** |
| `text` | string | yes | Text inserted immediately after the anchor. **May not contain a `TEST FAILED (` literal — rule 3a.** |
| `occurrences` | positive int | **yes** | Measured total anchor matches. |
| `nth` | positive int | no (default `1`) | |

**`sql`** — a statement executed on the throwaway database *after* the migrations
and *before* the gate. This is not a file edit; it is routed through the lane's
`--post-apply` hook, which exists for exactly this shape.

| Key | Type | Required | Meaning |
|---|---|---|---|
| `kind` | `"sql"` | yes | |
| `stmt` | string | yes | Non-empty. **May not contain a `TEST FAILED (` literal, directly or by concatenation — rule 3a.** ⚠️ A `sql` step is not a file edit, so rule **3b cannot apply to it**; what bounds it is rule **3c**, run-time source-location attribution. |

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
| `identity-rewrite` | **MEASURE_FAIL.** The step changed the ordered list of FAILURE BRANCHES in the file — an identity, an identity swap, an injected raise, or the guard the raise sits behind (rule 3b). The mutation was NOT applied and the arm never reached a lane. |
| `synthesised-identity` | **MEASURE_FAIL.** The lane emitted a `TEST FAILED (…)` that is not ATTRIBUTABLE to a raise in the runner's own gate copy (rule 3c: wrong file, a CONTEXT chain that is not exactly one `inline_code_block … at RAISE` frame, a line that does not resolve, a NOTICE, or an identity carried by a field rather than a message). The mutation SYNTHESISED the identity the detector reads instead of exercising the arm. The arm ran, and is NOT counted as biting. Also raised when the output grammar itself is unreadable — an unparseable format is a measurement failure, not a clean "no identity". |
| `baseline` | Pristine copies did not go GREEN before any mutation — a broken corpus. |
| `restore` | Pristine copies did not go GREEN after the arm runs. |
| `dirty-checkout` | `git status --porcelain` was non-empty after the run. Mutations must only ever touch scratch copies. |
| `floor` | Coverage fell below a pinned ratchet floor. |

All arms run before the report is printed; the runner never stops at the first
failing arm (OPS-08-F8). First-failure identity is asserted **within** an arm's
run; aggregation happens **across** arms.
