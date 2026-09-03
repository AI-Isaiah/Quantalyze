# VAC-06 — the five vacuity mechanisms, re-introduced and observed caught

**Measured 2026-08-29** on the phase-164 corpus (`supabase/tests/test_strategy_shares_rls.sql`,
2601 lines, 30 annotated arms) using the plan-01 disposable-PostgreSQL lane, the plan-05/08
mutation runner and the plan-06 static linter. Every line quoted below is **verbatim tool
output from a run performed while writing this file** — nothing here is reconstructed or
predicted.

Criterion 6 of the ROADMAP's Phase 164.3: *"Each of the five is demonstrated against the
phase-164 corpus — re-introduce each historical mechanism and show the new machinery catches
it. A vacuity detector that has never caught a vacuity is the joke that writes itself."*

## The result

| # | Mechanism (ROADMAP :473-479) | Detector | Arm / fixture | Observed catch |
|---|---|---|---|---|
| 1 | Post-rejection probe inside `BEGIN…EXCEPTION` — the arm reads its own rollback | mutation runner (`no-red`) + linter `R1` | `TENANT 5b` | `no-red` — "this arm cannot fail" |
| 2 | `pg_get_functiondef` regex satisfied by an in-body `--` comment | linter `R2` + the D-05 normalizer | the three comment-strip sites (`:574`, `:578`, `:712`) | `R2` fires at **all 6** downstream match sites |
| 3 | A diagnostic computing `pre + 1`, overflowing in exactly the state it diagnoses | mutation runner (`wrong-first-failure`, no-identity) + linter `R3` | `N1 3a` | gate red, **no `TEST FAILED (…)` line at all** |
| 4 | Partial bitmask — a narrowed trigger satisfies every remaining term | mutation runner (`wrong-first-failure`) + linter `R4` | `SHAPE 5` | first failure was `N1 2a`, not `SHAPE 5` |
| 5 | An arm made structurally unreachable; the reachable one reports the **opposite** | mutation runner first-failure identity **only** (D-16) | `SANITIZE 1e` | first failure was `SANITIZE 1c`, not `SANITIZE 1e` |

⭐ **Mechanisms 4 and 5 reproduced their hand-measured 2026-08-28 findings exactly** — the same
wrong arm (`N1 2a`), the same inverted report (`SANITIZE 1c`). What a six-team red team found by
executing adversarially, the runner now finds in 1.7 seconds per arm, on every push.

## Preconditions, measured before any mechanism was re-introduced

```
$ node scripts/mutation-runner/run.mjs
mutation-runner: scope supabase/tests
  baseline  supabase/tests/test_strategy_shares_rls.sql — exit 0 (1.8s)
  …
  arm SHAPE 5                  exit   3  RED (identity ok)  (1.7s)
  arm TENANT 5b                exit   3  RED (identity ok)  (1.7s)
  arm SANITIZE 1e              exit   3  RED (identity ok)  (1.7s)
  arm N1 3a                    exit   3  RED (identity ok)  (1.7s)
  restore   supabase/tests/test_strategy_shares_rls.sql — exit 0 (1.7s)

coverage: files 1/71
arms: 30/30/0   (executed/annotated/waived)
per-arm lane time: mean 1.7s over 30 arm run(s)

✅ No defects. Every annotated arm bit its own arm first.
EXIT=0

$ node scripts/lint-sql-gates.mjs
lint-sql-gates: scanned 71 file(s); 0 finding(s), 0 measure-fail(s), 0 allowlist error(s).
EXIT=0

$ node scripts/lint-sql-gates.mjs --self-test
lint-sql-gates self-test OK: 4 rules, red+green each.
EXIT=0
```

Those four `RED (identity ok)` lines are the **before** half of every runner demonstration below:
each arm bites its own arm first in the repaired corpus. What follows breaks that.

## How to re-run any of this

Every demonstration is a three-step loop, run from the repo root:

```bash
# 0. byte backup — NEVER `git checkout --`, which destroys uncommitted work
cp supabase/tests/test_strategy_shares_rls.sql /tmp/gate.pristine.sql
shasum -a 256 supabase/tests/test_strategy_shares_rls.sql
#   -> ba97a98fa7c3b0d9eb55bd1b1826b788b4fbfb12efebdd86354a7b46593c2400

# 1. re-introduce (the per-mechanism command below)
# 2. detect      (the per-mechanism command below)

# 3. restore and PROVE the restore
cp /tmp/gate.pristine.sql supabase/tests/test_strategy_shares_rls.sql
shasum -a 256 supabase/tests/test_strategy_shares_rls.sql   # must match step 0
git status --porcelain --untracked-files=all                # must print nothing
```

⚠️ The mutation runner mutates only **scratch copies**; the re-introductions here edit the
checkout on purpose, because the point is to change what the runner copies. The runner's
`dirty-checkout` guard diffs `git status` before-vs-after its own run, so a pre-existing edit is
correctly not attributed to it. The sha256 in step 3 is what proves the checkout came back.

⚠️ `--arm` is the runner's DIAGNOSTIC mode and **never exits 0** — exit `2` means "narrowed run,
no defects", exit `1` means "narrowed run, defect found". Do not read `2` as failure.

---

## Mechanism 1 — post-rejection probe inside a PL/pgSQL `BEGIN…EXCEPTION`

**Where it hid** (ROADMAP :475): *"Found twice: removed at TRIGGER 1, survived undeclared at
TENANT 5d-5g. A genuine cross-tenant write placed inside the handler moved the victim's counter
**and the file went green**."* The gate file records the same measurement at `:1817-1836`: a
`service_role` `UPDATE` inside that block moved B's counter 1 → 2 and stamped B's tombstone, and
psql still exited 0 across all 106 arms of the day.

**Detector:** the mutation runner's `no-red` defect (the arm's declared mutation no longer
reddens it). The linter's `R1` is the static net for *new* files.

**Arm:** `TENANT 5b` — the end-state arm that replaced the deleted 5d-5g, whose whole design note
reads *"⛔ READ FROM OUTSIDE THE HANDLER, WHICH IS THE ENTIRE POINT"* (`:1935`).

**Re-introduce** — move `TENANT 5b`'s end-state read and its assertion back inside the implicit
subtransaction, a pure 7-line move that never retypes the assertion's bytes:

```bash
node -e 'const f="supabase/tests/test_strategy_shares_rls.sql",fs=require("fs");const L=fs.readFileSync(f,"utf8").split("\n");const p=L.findIndex((l,n)=>n>1900&&l==="    PERFORM public.create_strategy_share(strat_b);");if(L[p+1]!=="  EXCEPTION WHEN OTHERS THEN")throw new Error("anchor");const q=L.findIndex((l,n)=>n>p&&l==="  SELECT revoked_at INTO b_revoked FROM strategy_shares WHERE strategy_id = strat_b;");let e=q;while(L[e]!=="  END IF;")e++;if(e-q!==6)throw new Error("block");const b=L.slice(q,e+1);L.splice(q,7);L.splice(p+1,0,...b);fs.writeFileSync(f,L.join("\n"));console.log("mechanism 1 re-introduced: TENANT 5b end-state read + assertion moved INSIDE the BEGIN...EXCEPTION subtransaction");'
```

**Detect:**

```bash
node scripts/mutation-runner/run.mjs --arm "TENANT 5b"; echo "EXIT=$?"
```

**Observed (verbatim):**

```
mechanism 1 re-introduced: TENANT 5b end-state read + assertion moved INSIDE the BEGIN...EXCEPTION subtransaction
mutation-runner: scope supabase/tests
  baseline  supabase/tests/test_strategy_shares_rls.sql — exit 0 (1.7s)
  arm TENANT 5b                exit   0  NO-RED  (1.9s)
  restore   supabase/tests/test_strategy_shares_rls.sql — exit 0 (2.0s)
…
❌ 1 defect(s):

  KIND                  ARM                       FILE
  --------------------  ------------------------  ----
  no-red                TENANT 5b                 supabase/tests/test_strategy_shares_rls.sql
      the mutation applied (occurrence count verified) but the gate still passed — this arm cannot fail
EXIT=1
```

⭐ Read the `exit 0` on the arm line next to the `exit 3` in the preconditions. Under the identical
mutation — both RLS walls removed — the repaired arm makes psql exit 3 and names itself; the
re-introduced shape makes psql **exit 0**. That is the historical fact reproduced by machine: the
handler, not the guard, was doing all the work, and the file went green. `baseline exit 0` also
shows the defect is invisible to a normal CI run, which is why it survived review twice.

**The static half — linter `R1`.** Run against a throwaway copy of the *real* gate file with the
probe moved into the `NO-DELETE 1` exception handler (a fixture only proves the rule matches the
shape its author imagined):

```bash
cp supabase/tests/test_strategy_shares_rls.sql supabase/tests/test_zz_vac06_demo.sql
node -e 'const f="supabase/tests/test_zz_vac06_demo.sql",fs=require("fs");let t=fs.readFileSync(f,"utf8");const n="    DELETE FROM strategy_shares WHERE strategy_id = strat_a;\n  EXCEPTION WHEN insufficient_privilege THEN\n    raised := TRUE;\n";if(t.split(n).length-1!==1)throw new Error("needle count");fs.writeFileSync(f,t.replace(n,n+"    SELECT count(*) INTO row_cnt FROM strategy_shares WHERE strategy_id = strat_a;\n"));console.log("R1: probe moved INTO the NO-DELETE 1 EXCEPTION handler");'
node scripts/lint-sql-gates.mjs; echo "EXIT=$?"
rm supabase/tests/test_zz_vac06_demo.sql
```

```
R1: probe moved INTO the NO-DELETE 1 EXCEPTION handler
::error file=supabase/tests/test_zz_vac06_demo.sql,line=1099::[R1-exception-handler-probe] SELECT ... INTO inside an EXCEPTION handler: the implicit subtransaction has already rolled the block back, so this reads the state it is supposed to be verifying was never reached. Move the probe AFTER the END of the block.
lint-sql-gates: scanned 72 file(s); 1 finding(s), 0 measure-fail(s), 0 allowlist error(s).
EXIT=1
```

---

## Mechanism 2 — `pg_get_functiondef` regex satisfied by an in-body `--` comment

**Where it hid** (ROADMAP :476): *"Migration STEP 2 arms."* The same shape was measured live on
PROD (D-05): the 7-param `_enqueue_compute_job_internal` reports **0** `INTO STRICT` in code but
**1** including comments.

**Detector:** the linter's `R2`, plus the comment-strip idiom itself, pinned by the drift-check
normalizer's D-05 test. There is deliberately no runner demonstration: mechanism 2 defeats a
*text-matching* arm, and the repaired idiom is a normalizer, not an arm — so the durable pin is
static.

**Fixture:** the gate file's three comment-strip sites, `:574`, `:578`, `:712`.

**Re-introduce** — delete the `regexp_replace` wrapper at all three sites on a throwaway copy:

```bash
cp supabase/tests/test_strategy_shares_rls.sql supabase/tests/test_zz_vac06_demo.sql
node -e 'const f="supabase/tests/test_zz_vac06_demo.sql",fs=require("fs");let t=fs.readFileSync(f,"utf8");const n="regexp_replace(pg_get_functiondef(p.oid), \x27--[^\\n]*\x27, \x27\x27, \x27g\x27)";const c=t.split(n).length-1;if(c!==3)throw new Error("needle count "+c);fs.writeFileSync(f,t.split(n).join("pg_get_functiondef(p.oid)"));console.log("R2: comment-strip wrapper deleted at all "+c+" sites");'
node scripts/lint-sql-gates.mjs; echo "EXIT=$?"
rm supabase/tests/test_zz_vac06_demo.sql
```

**Observed (verbatim):**

```
R2: comment-strip wrapper deleted at all 3 sites
::error file=supabase/tests/test_zz_vac06_demo.sql,line=585::[R2-functiondef-comment-strip] `v_create_s` holds a RAW pg_get_functiondef body (assigned at line 574) and is matched here without stripping comments. A `--` comment in the body can satisfy the pattern on its own.
::error file=supabase/tests/test_zz_vac06_demo.sql,line=586::[R2-functiondef-comment-strip] `v_revoke_s` holds a RAW pg_get_functiondef body (assigned at line 578) and is matched here without stripping comments. A `--` comment in the body can satisfy the pattern on its own.
::error file=supabase/tests/test_zz_vac06_demo.sql,line=589::[R2-functiondef-comment-strip] `v_revoke_s` holds a RAW pg_get_functiondef body (assigned at line 578) and is matched here without stripping comments. A `--` comment in the body can satisfy the pattern on its own.
::error file=supabase/tests/test_zz_vac06_demo.sql,line=612::[R2-functiondef-comment-strip] `v_create_s` holds a RAW pg_get_functiondef body (assigned at line 574) and is matched here without stripping comments. A `--` comment in the body can satisfy the pattern on its own.
::error file=supabase/tests/test_zz_vac06_demo.sql,line=613::[R2-functiondef-comment-strip] `v_create_s` holds a RAW pg_get_functiondef body (assigned at line 574) and is matched here without stripping comments. A `--` comment in the body can satisfy the pattern on its own.
::error file=supabase/tests/test_zz_vac06_demo.sql,line=719::[R2-functiondef-comment-strip] `v_trigfn_s` holds a RAW pg_get_functiondef body (assigned at line 712) and is matched here without stripping comments. A `--` comment in the body can satisfy the pattern on its own.
lint-sql-gates: scanned 72 file(s); 6 finding(s), 0 measure-fail(s), 0 allowlist error(s).
EXIT=1
```

Three deletions, **six** findings — the rule fires at every downstream match site, not merely at
the assignment, so the operator is pointed at each arm that became satisfiable by a comment.

**The idiom half — D-05.** That the comment-strip is what makes two bodies comparable is pinned
by the normalizer test, which feeds it a body whose only differences are an out-of-band `--`
comment and indentation:

```bash
npx vitest run src/__tests__/drift-check-scripts.test.ts -t "D-05"
```

```
 ✓ |jsdom| src/__tests__/drift-check-scripts.test.ts > VAC-04 — scripts/prod-body-drift-check.sh > GREEN: bodies differing ONLY by comments and formatting exit 0 (D-05) 304ms
 Test Files  1 passed (1)
      Tests  1 passed | 18 skipped (19)
```

---

## Mechanism 3 — a diagnostic that overflows in exactly the state it diagnoses

**Where it hid** (ROADMAP :477): *"A diagnostic computing `pre + 1`, which overflowed in exactly
the state it was diagnosing — the arm aborted on its own arithmetic. N1 3a / N1 1c."* The gate
file's own note (`:2589-2597`): *"an arm whose report overflows exactly when it fires is a test
that cannot speak, which is barely better than one that cannot fail."*

**Detector:** the runner's first-failure identity assertion, in its no-identity form — the gate
went red but emitted no `TEST FAILED (…)` line, so the failure is attributable to no arm. Linter
`R3` is the static net.

**Arm:** `N1 3a`, whose declared mutation parks the counter at `2^63-1` and then requires the
Art. 17 erasure to complete.

**Re-introduce** — revert the subtraction idiom at **both** documented sites (the comparison and
the message's `expected %` slot):

```bash
node -e "
const fs=require('fs');
const P='supabase/tests/test_strategy_shares_rls.sql';
let t=fs.readFileSync(P,'utf8');
const edits=[
  ['     OR (gen_b_after - gen_pre_san) IS DISTINCT FROM 1 THEN','     OR gen_b_after IS DISTINCT FROM gen_pre_san + 1 THEN'],
  ['expected exactly one more than the pre-erasure value','expected %'],
  [\"      raised, COALESCE(err_msg, '(none)'), COALESCE(san_ok::TEXT, '(null)'), b_revoked, gen_pre_san, gen_b_after;\",\"      raised, COALESCE(err_msg, '(none)'), COALESCE(san_ok::TEXT, '(null)'), b_revoked, gen_pre_san, gen_b_after, gen_pre_san + 1;\"],
];
for(const [f,r] of edits){const c=t.split(f).length-1; if(c!==1) throw new Error('needle count '+c+' for '+JSON.stringify(f.slice(0,60))); t=t.split(f).join(r);}
fs.writeFileSync(P,t);
console.log('mechanism 3 re-introduced: comparison + RAISE argument slot');
"
```

**Detect:**

```bash
node scripts/mutation-runner/run.mjs --arm "N1 3a"; echo "EXIT=$?"
```

**Observed (verbatim):**

```
mechanism 3 re-introduced: comparison + RAISE argument slot
mutation-runner: scope supabase/tests
  baseline  supabase/tests/test_strategy_shares_rls.sql — exit 0 (1.6s)
  arm N1 3a                    exit   3  NO-IDENTITY  (1.6s)
  restore   supabase/tests/test_strategy_shares_rls.sql — exit 0 (1.7s)
…
❌ 1 defect(s):

  KIND                  ARM                       FILE
  --------------------  ------------------------  ----
  wrong-first-failure   N1 3a                     supabase/tests/test_strategy_shares_rls.sql
      gate exited 3 but emitted no "TEST FAILED (…)" line — the failure is not attributable to any arm
```

⭐ **The overflow site was isolated by an A/B, not asserted.** Reverting only the *comparison*
(`gen_b_after IS DISTINCT FROM gen_pre_san + 1`) left the arm biting correctly —

```
  arm N1 3a                    exit   3  RED (identity ok)  (1.7s)
  …
No defects in the narrowed scope.
EXIT=2
```

— because PL/pgSQL short-circuits the `OR` on the leading `raised` term, which is TRUE in the
failure case. Only when the `RAISE`'s `expected %` argument also carries `gen_pre_san + 1` does
the arm abort on its own arithmetic. That is precisely the site the gate file's note names
(*"the message's `expected %` slot overflow[s] and psql reports a bare `bigint out of range … at
RAISE`"*), and the two runs together prove it rather than assume it.

⚠️ **Honest limit:** the runner does not surface lane stdout, so the string `bigint out of range`
is **not** quoted here from this run. What is quoted is the runner's verdict plus the two-point
isolation above. The claim "aborted on its own arithmetic" rests on that A/B and on the gate
file's prior measurement, not on a captured psql error line.

**The static half — linter `R3`**, on a throwaway copy with `REVOKE 1c`'s idiom reverted (the
same mutation plan 06 measured):

```bash
cp supabase/tests/test_strategy_shares_rls.sql supabase/tests/test_zz_vac06_demo.sql
node -e 'const f="supabase/tests/test_zz_vac06_demo.sql",fs=require("fs");let t=fs.readFileSync(f,"utf8");const n="  IF (gen_revoked - gen_mint) IS DISTINCT FROM 1 THEN";const c=t.split(n).length-1;if(c!==1)throw new Error("needle count "+c);fs.writeFileSync(f,t.split(n).join("  IF gen_revoked IS DISTINCT FROM gen_mint + 1 THEN"));console.log("R3: REVOKE 1c subtraction idiom reverted to additive `gen_mint + 1`");'
node scripts/lint-sql-gates.mjs; echo "EXIT=$?"
rm supabase/tests/test_zz_vac06_demo.sql
```

```
R3: REVOKE 1c subtraction idiom reverted to additive `gen_mint + 1`
::error file=supabase/tests/test_zz_vac06_demo.sql,line=1129::[R3-additive-diagnostic-narrow] `gen_mint + 1` computes a diagnostic from a value read out of the database. An arm whose own arithmetic overflows in exactly the state it diagnoses raises `bigint out of range` instead of its message — a test that cannot speak. Subtract instead: `(after - before) IS DISTINCT FROM 1`.
lint-sql-gates: scanned 72 file(s); 1 finding(s), 0 measure-fail(s), 0 allowlist error(s).
EXIT=1
```

---

## Mechanism 4 — partial bitmask: a narrowed trigger satisfies every remaining term

**Where it hid** (ROADMAP :478): *"`tgtype & 16` only, so a trigger narrowed back to `BEFORE
UPDATE` satisfied every remaining term and the INSERT pin could be deleted invisibly. Fixed in
the migration, **still blind in the durable gate**."* The gate file records the measurement
(`:661-674`): *"MEASURED 2026-08-28 … SHAPE 5 PASSED and the file ran on for sixteen more arms
before N1 2a caught it BEHAVIOURALLY … A structural pin that a behavioural arm has to rescue is
not a pin."*

**Detector:** the runner's first-failure identity assertion. `R4` is the static net.

**Arm:** `SHAPE 5` — the LAYERED trigger-timing arm.

**Re-introduce** — delete the INSERT bit from the **durable gate's** mask, restoring the
pre-164-06 partial bitmask `{1, 2, 16}`:

```bash
node -e "
const fs=require('fs');
const P='supabase/tests/test_strategy_shares_rls.sql';
let t=fs.readFileSync(P,'utf8');
const f='     AND (t.tgtype & 4) = 4\n';
const c=t.split(f).length-1;
if(c!==1) throw new Error('needle count '+c);
fs.writeFileSync(P,t.split(f).join(''));
console.log('mechanism 4 re-introduced: durable gate pin narrowed back to bits {1,2,16}');
"
```

**Detect:**

```bash
node scripts/mutation-runner/run.mjs --arm "SHAPE 5"; echo "EXIT=$?"
```

**Observed (verbatim):**

```
mechanism 4 re-introduced: durable gate pin narrowed back to bits {1,2,16}
mutation-runner: scope supabase/tests
  baseline  supabase/tests/test_strategy_shares_rls.sql — exit 0 (1.6s)
  arm SHAPE 5                  exit   3  WRONG-ARM(N1 2a)  (1.6s)
  restore   supabase/tests/test_strategy_shares_rls.sql — exit 0 (1.7s)
…
❌ 1 defect(s):

  KIND                  ARM                       FILE
  --------------------  ------------------------  ----
  wrong-first-failure   SHAPE 5                   supabase/tests/test_strategy_shares_rls.sql
      first failure was "N1 2a", not "SHAPE 5" — red-anywhere is not success
```

⭐ **The runner named `N1 2a` — the identical arm the red team found by hand on 2026-08-28.** This
is also the clearest argument for D-14's first-failure rule: the file DID go red. A runner that
accepted "red anywhere" would have reported `SHAPE 5` as proven-biting while `SHAPE 5` was in fact
blind, and the vacuity detector would itself have been vacuous.

**The static half — linter `R4`:**

```bash
cp supabase/tests/test_strategy_shares_rls.sql supabase/tests/test_zz_vac06_demo.sql
node -e 'const f="supabase/tests/test_zz_vac06_demo.sql",fs=require("fs");let t=fs.readFileSync(f,"utf8");const n="     AND (t.tgtype & 1) = 1\n     AND (t.tgtype & 2) = 2\n     AND (t.tgtype & 4) = 4\n     AND (t.tgtype & 16) = 16;";const c=t.split(n).length-1;if(c!==1)throw new Error("needle count "+c);fs.writeFileSync(f,t.split(n).join("     AND (t.tgtype & 16) = 16;"));console.log("R4: SHAPE 5 durable pin narrowed from bits {1,2,4,16} to {16}");'
node scripts/lint-sql-gates.mjs; echo "EXIT=$?"
rm supabase/tests/test_zz_vac06_demo.sql
```

```
R4: SHAPE 5 durable pin narrowed from bits {1,2,4,16} to {16}
::error file=supabase/tests/test_zz_vac06_demo.sql,line=687::[R4-tgtype-bitmask-completeness] tgtype mask tests bit(s) {16} but the adjacent message claims "BEFORE INSERT OR UPDATE FOR EACH ROW", which needs {1, 2, 4, 16}. Missing: ROW, BEFORE/AFTER, INSERT. A narrowed trigger satisfies every remaining term, so this arm stays green after exactly the change it exists to catch.
lint-sql-gates: scanned 72 file(s); 1 finding(s), 0 measure-fail(s), 0 allowlist error(s).
EXIT=1
```

---

## Mechanism 5 — an arm made structurally unreachable; the reachable one reports the opposite

**Where it hid** (ROADMAP :479): *"An arm made structurally unreachable by an earlier arm covering
the same state — the reachable one then reported the defect as its **exact opposite** ("row is
STILL LIVE" when the row was deleted). SANITIZE 1c / 1e."*

**Detector: the mutation runner's first-failure identity, and nothing else.** Per **D-16** the
linter ships **no rule for mechanism 5** — it is not decidable from SQL text, and a rule that
cannot fire is the defect this phase exists to eliminate. This section is therefore the *only*
evidence that mechanism 5 is covered at all, and it is why the runner's refusal to accept
red-anywhere is load-bearing rather than fastidious.

**Arm:** `SANITIZE 1e` (the row-count arm) shadowed by `SANITIZE 1c` (the tombstone arm).

**Re-introduce** — move the row-count arm back below `1c`/`1d`, the ordering the file carried
before 2026-08-28. The gate file's note (`:2454-2469`) states the order *"is a correctness
property, not a style one"* and that `UNIQUE(strategy_id)` means *"there was no configuration in
which 1e fired first"*:

```bash
node -e "
const fs=require('fs');
const P='supabase/tests/test_strategy_shares_rls.sql';
const lines=fs.readFileSync(P,'utf8').split('\n');
const r1e=lines.findIndex(l=>l.startsWith(\"    RAISE EXCEPTION 'TEST FAILED (SANITIZE 1e)\"));
if(r1e<0) throw new Error('SANITIZE 1e raise not found');
const probe=r1e-2;
if(lines[probe]!=='  SELECT count(*) INTO row_cnt FROM strategy_shares WHERE strategy_id = strat_a;') throw new Error('probe: '+JSON.stringify(lines[probe]));
if(lines[probe+1]!=='  IF row_cnt <> 1 THEN') throw new Error('if: '+JSON.stringify(lines[probe+1]));
if(lines[probe+3]!=='  END IF;') throw new Error('endif: '+JSON.stringify(lines[probe+3]));
const block=lines.slice(probe,probe+4);
let d=lines.findIndex((l,n)=>n>probe+3 && l.startsWith(\"    RAISE EXCEPTION 'TEST FAILED (SANITIZE 1d)\"));
if(d<0) throw new Error('SANITIZE 1d raise not found');
while(lines[d]!=='  END IF;') d+=1;
lines.splice(probe,4);
lines.splice(d-4+1,0,...block);
fs.writeFileSync(P,lines.join('\n'));
console.log('mechanism 5 re-introduced: SANITIZE 1e row-count arm moved from line '+(probe+1)+' to below the 1c/1d arms');
"
```

**Detect:**

```bash
node scripts/mutation-runner/run.mjs --arm "SANITIZE 1e"; echo "EXIT=$?"
```

**Observed (verbatim):**

```
mechanism 5 re-introduced: SANITIZE 1e row-count arm moved from line 2479 to below the 1c/1d arms
mutation-runner: scope supabase/tests
  baseline  supabase/tests/test_strategy_shares_rls.sql — exit 0 (1.6s)
  arm SANITIZE 1e              exit   3  WRONG-ARM(SANITIZE 1c)  (1.6s)
  restore   supabase/tests/test_strategy_shares_rls.sql — exit 0 (1.7s)
…
❌ 1 defect(s):

  KIND                  ARM                       FILE
  --------------------  ------------------------  ----
  wrong-first-failure   SANITIZE 1e               supabase/tests/test_strategy_shares_rls.sql
      first failure was "SANITIZE 1c", not "SANITIZE 1e" — red-anywhere is not success
```

⭐ **`SANITIZE 1c`'s message is "the data subject's share row is STILL LIVE" — for a mutation that
made `sanitize_user` DELETE the row.** The exact inversion the red team found by hand: the
operator is sent to look for a statement that is present, about a row that no longer exists. The
runner exits 1 and names the mismatch; the file *did* go red, so a red-anywhere check would have
called `SANITIZE 1e` proven.

---

## Durability — what re-proves this without a human

1. **The four demo arms live in the every-push corpus.** `TENANT 5b`, `N1 3a`, `SHAPE 5` and
   `SANITIZE 1e` are four of the arms the `sql-mutation` CI job executes on every push
   (plan 08). If any of them stops biting, `ARMS_FLOOR` (pinned at the measured value) drops and the
   job exits 1. The demonstrations above are not a one-time recording — their subjects are
   continuously re-tested.
2. **`src/__tests__/vac06-mechanism-arms.test.ts`** pins that each demo arm still carries a
   line-start-anchored `RED-UNDER-M` twin, that mechanism 2's three comment-strip sites and its
   `R2` fixture pair still exist, and that this file still documents exactly five mechanisms.
   Deleting a demo arm's annotation reds vitest — observed, not assumed (see the plan-10 SUMMARY).
3. **The linter runs on every push** (`sql-gate-lint`, plan 06), so `R1`–`R4` guard *new* gate
   files against mechanisms 1, 2, 3 (narrowly) and 4 without anyone re-running this document.

## Honest limits

- **Mechanism 2 has no runner demonstration** and mechanism 5 has no linter rule (D-16). Both
  absences are deliberate and each mechanism still has exactly one real detector; neither was
  padded with a second control to make a table look complete.
- **The `bigint out of range` string is not quoted for mechanism 3** — see that section's ⚠️. The
  overflow site is established by a two-run A/B, not by a captured psql line.
- **Everything here was measured on macOS.** The `sql-mutation` and `sql-gate-lint` jobs had not
  yet run on an ubuntu runner when this was written (plan 06 D5, plan 08's carried-forward gap).
  These demonstrations prove the detectors bite; they do not prove the CI hosts execute them.
  ⚠️ CURRENCY 2026-09-02: both jobs were since observed GREEN on ubuntu
  (`workflow_dispatch` run 33620169220 at `89cbef8b`, self-test 12/12) — see `CLAUDE.md` § SQL gate
  integrity jobs. One green run is a measurement of one host, not a guarantee about the next.
- **Coverage is whatever the run log's own `coverage:` line says** — read it there, never from a
  number restated in prose. All five mechanisms live in the reference file, which is why criterion 6
  was reachable when this was written; the remaining idiom files land in Phase 164.4's batches, and
  four of them are `lane-blocked:` (they probe `pg_extension` for pg_cron, which the pg-lane cannot
  host — TODOS `[REDUNDER-PGCRON]`), so the reachable end state is below the 71 denominator.

---

*Phase: 164.3-vacuity-a-control-that-cannot-fail-must-be-caught-by-machine*
*Plan: 10 (VAC-06) — measured 2026-08-29*
