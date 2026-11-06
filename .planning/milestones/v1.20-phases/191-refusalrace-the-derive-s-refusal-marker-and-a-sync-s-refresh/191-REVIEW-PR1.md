---
phase: 191-refusalrace-the-derive-s-refusal-marker-and-a-sync-s-refresh
scope: PR 1 (plans 191-02, 191-03, 191-04)
diff: b16e16218..HEAD (aa6d476a5), .planning excluded
reviewed: 2026-11-05T00:20:00Z
depth: deep
files_reviewed: 15
files_reviewed_list:
  - supabase/migrations/20261106120000_refusalrace_metadata_merge_rpcs.sql
  - supabase/migrations/down/20261106120000-rollback.sql
  - supabase/schema/functions/mark_compute_job_kept_figures.sql
  - supabase/schema/functions/retract_ledger_refresh_marker.sql
  - supabase/tests/test_compute_job_metadata_merge.sql
  - analytics-service/tests/test_compute_job_metadata_merge_privilege.py
  - .github/workflows/ci.yml
  - scripts/mutation-floors.mjs
  - scripts/dump-sql-functions.ts
  - scripts/baseline-content-drift-check.mjs
  - src/__tests__/drift-check-scripts.test.ts
  - src/__tests__/gate-family-meta.test.ts
  - src/__tests__/lint-sql-gates.test.ts
  - src/__tests__/mutation-annotation-parser.test.ts
  - src/__tests__/mutation-runner-floors.test.ts
findings:
  critical: 1
  warning: 1
  info: 0
  total: 2
status: issues_found
---

# Phase 191 PR 1: Code Review Report

**Reviewed:** 2026-11-05
**Depth:** deep (MEDIUM+ only, as requested)
**Files Reviewed:** 15
**Status:** issues_found

## Summary

I checked both SQL functions against D-01, D-03, D-07 and D-09, and against today's Python
and TypeScript writers. I found no defect in either function.

- `mark_compute_job_kept_figures` is one UPDATE. Its `jsonb_typeof` guard matches the Python
  writer, which turns non-object metadata into `{}`. It returns FOUND (D-07), carries no claim
  fence (D-09), and its ACL is service_role only.
- `retract_ledger_refresh_marker` is one UPDATE. It drops `source` only for the two markers,
  never touches `done` (`status <> 'done'`, which also excludes NULL status, the same as
  PostgREST's `neq`), and writes JSON null for a NULL correlation id, as Python does today. Its
  classifying SELECT runs only on a miss.
- Under READ COMMITTED, the EvalPlanQual re-check makes both merges safe in both write orders.

Census edits match measured values:
- The ci.yml sum comment re-adds to 416, and the row is in alphabetical position.
- FILES_FLOOR 80 and ARMS_FLOOR 801 match the saved run.
- `schema:functions:check` is current at 132.
- `baseline-content-drift` shows the two expected SNAPSHOT_MISSING rows and COMPARED_FLOOR 134.

These re-run here and passed:
- the static pytest (8 passed);
- nine migration-scanning and census vitest files (1222 passed, 17 pre-existing skips),
  including `ci-anti-skip-gate.contract`, `drift-check-scripts`, `critical-regressions`,
  `lint-migration-data-dependence` and `strategies-published-sole-writer-guard`.

For the auto-apply, the migration adds two functions, its verify block reads the catalogue
only, and no caller uses the functions until PR 2. I found nothing in it that breaks PROD or
TEST.

The defects are in the proof, not the product. **The SC-3 gate cannot fail on the defect the
phase exists to remove.** I measured this. A scratch copy of the migration rewrote both
functions as two-statement read-then-replace writers: a `SELECT metadata INTO v`, then an
UPDATE that writes from `v`. That is the racy shape. Under it the gate printed
`ALL 11 ARMS EXECUTED (1,...,11)` on the pg-lane, with the plan's own RED-UNDER-SETUP list.
The anti-vacuity control (arm 11) passed with it. The control cannot fail on any change to
the code under test.

## Critical Issues

### CR-01 (HIGH): SC-3's interleave arms and twins prove sequential key preservation, not the merge; the gate goes green on a re-introduced read-modify-write body

**File:** `supabase/tests/test_compute_job_metadata_merge.sql:379-477` (arms 9 and 10); the claims are at `:34-38`, `:37-38` and `:505`, in the `.github/workflows/ci.yml` sentinel-table comment (`Re-measured 2026-11-04 (Phase 191 REFUSALRACE, plan 03)`), and in the `FILES_FLOOR`/`ARMS_FLOOR` comments in `scripts/mutation-floors.mjs`.

**Issue:**
- **Arms 9 and 10 cannot see a race.** They call the two functions (and the claim-style UPDATE)
  one after another in one session. Each call reads the committed state left by the one before
  it. So any writer that is correct when run sequentially passes them, including the old
  read-then-replace shape.
- **Measured.** I built a scratch copy of the migration in which:
  - `mark_compute_job_kept_figures` does `SELECT metadata INTO v ...; UPDATE ... SET metadata = <guard>(v) || {K}`;
  - `retract_ledger_refresh_marker` does `SELECT metadata INTO v_snap ...; UPDATE ... SET metadata = (v_snap - 'source') || ...`.

  Under concurrency, both reopen exactly the lost update this phase closes. Run on
  `scripts/pg-lane/run.sh` with the gate's own setup list, the gate printed
  `ALL 11 ARMS EXECUTED (1,2,3,4,5,6,7,8,9,10,11)`.
- **The twins don't cover the shape.** None of the ten twins models "a stale read before the
  write". Each one deletes a key or widens a predicate. The runner's `biting: 10` is real, but
  it says nothing about atomicity.
- **The prose overclaims.** Arm 9's header says it is "the lost update the phase exists to
  remove", and the arm-11 comment says "a green arm 9 or 10 means the merge, not a blind
  harness". The ci.yml and floor comments and threat mitigation T-191-08 repeat this. All of
  it is false as measured.
- **The records overclaim too.** The 191-02/03/04 SUMMARY frontmatter marks SC-3 complete in
  PR 1. RESEARCH's "Honest limit" already says a single-session gate cannot prove concurrency,
  and the real two-connection probe is plan 191-09, in PR 2.
- **Why it matters.** This gate is the long-lived CI guard on these two function bodies.
  Without a can-fail arm for atomicity, a later `CREATE OR REPLACE` that adds a read before
  the write passes `sql-tests` and `sql-mutation` green.
- **What it does not affect.** PR 1 has no callers, and the functions as written are correct.
  So the gap is in the proof and in what gets recorded, not in PROD behaviour today.

**Fix:**
1. Make the gate's prose say what it proves. Arms 9 and 10 prove the merges commute and keep
   every key when run one after another, not concurrency. Make the same correction in the
   ci.yml re-measure comment and the two mutation-floors comments, and do not record SC-3 as
   met by PR 1.
2. Add a can-fail arm for the shape that makes the merge atomic: each function reads nothing
   from `compute_jobs` before its UPDATE. For example, a catalogue arm on `pg_proc.prosrc`:

   ```sql
   -- ARM 12: the marker body touches compute_jobs exactly once, in its UPDATE;
   -- the retraction's first compute_jobs statement is its UPDATE.
   SELECT prosrc INTO v_src FROM pg_proc WHERE oid = to_regprocedure('public.mark_compute_job_kept_figures(uuid)');
   IF (SELECT count(*) FROM regexp_matches(v_src, 'compute_jobs', 'g')) <> 1
      OR v_src !~ 'UPDATE\s+public\.compute_jobs' THEN
     RAISE EXCEPTION 'TEST FAILED (12): the marker reads compute_jobs outside its single UPDATE';
   END IF;
   SELECT prosrc INTO v_src FROM pg_proc WHERE oid = to_regprocedure('public.retract_ledger_refresh_marker(uuid,text)');
   IF position('UPDATE public.compute_jobs' IN v_src) = 0
      OR position('FROM public.compute_jobs' IN v_src) < position('UPDATE public.compute_jobs' IN v_src) THEN
     RAISE EXCEPTION 'TEST FAILED (12): the retraction reads compute_jobs before its UPDATE';
   END IF;
   ```

   Twin it with an `edit` that inserts `PERFORM metadata FROM public.compute_jobs WHERE id = p_job_id;`
   before the marker's UPDATE. Then move the censuses: sentinel arms, ARMS_FLOOR (ci.yml and
   mutation-floors) and the parser pins.
3. Or pull plan 191-09's two-connection live probe into PR 1, so the claim the gate makes is
   backed before the migration auto-applies.

## Warnings

### WR-01 (MEDIUM): The anti-vacuity control (arm 11) cannot fail on any change to the code under test, so it does not prove the harness can see a lost update in arms 9/10

**File:** `supabase/tests/test_compute_job_metadata_merge.sql:479-503`

**Issue:**
- **What the control runs.** It calls the real retraction, then a hand-written
  `UPDATE ... SET metadata = v_meta0 || {K}` from a copy taken before the retraction. Then it
  asserts that R is gone and S is back.
- **Why it cannot fail.** That UPDATE is a full replace written inside the test, so it loses R
  by construction. The only way the arm can raise is if the retraction itself fails to
  retract, and arm 5 reports that first.
- **No mutation of the migration can make it fail.** The file says so (`:483-484`), and the
  191-03 SUMMARY's "control arm can fail" proof edited the control's own text, not the code
  under test.
- **It does not check arms 9 and 10.** The stale-read mechanism it shows is not the one those
  arms use: they never take a stale read. So "the harness can see a lost key" holds for the
  control's own UPDATE and tells you nothing about whether arms 9 and 10 could see one. The
  measurement in CR-01 confirms it: the control stays green while both functions are racy.
- **The mitigation is overstated.** T-191-08 lists this arm as the mitigation for "a vacuous
  SC-3 gate hiding a lost key". The `ARM 11 FAILED` spelling also keeps it out of the runner's
  attribution, so nothing about it is ratcheted.

**Fix:**
- Either remove the anti-vacuity claim and keep the arm as a documented illustration of the
  old failure (no `ARMS_FLOOR` or sentinel meaning beyond "it ran"),
- or replace it with a control that runs the same procedure as arms 9 and 10 against a
  deliberately racy variant of the function, so it can actually tell a blind harness from a
  sighted one. For example, a `pg_temp` copy of the marker written as `SELECT INTO` then
  UPDATE, driven through a real second session (dblink or the plan-09 probe). That control
  must LOSE a key where the real function keeps it.

Pair this with CR-01's catalogue arm, so the property the control was meant to protect has a
twin that bites.

---

_Reviewed: 2026-11-05_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_


---

## Round 2: re-review of the fix round (`aa6d476a5..de80511c0`)

**Reviewed:** 2026-11-05
**Depth:** deep, MEDIUM+ only. Read the fix range in full and re-read the full PR 1 diff
(`b16e16218..HEAD`, `.planning` excluded) for regressions.
**Round 2 tally:** 0 HIGH, 3 MEDIUM (WR-02, WR-03, WR-04). The frontmatter above still holds the
round-1 counts and was not edited.

Every measurement below ran on `scripts/pg-lane/run.sh` with the gate's own RED-UNDER-SETUP list. I
made scratch copies of the migration and the gate outside the repo. Nothing in the repo was edited.

### Verification of the round-1 findings

| Finding | Verdict | Evidence |
|---|---|---|
| CR-01 (HIGH): the gate stayed green on a read-then-write body | **Fixed for the shape it was measured on. A narrower hole remains (WR-02, WR-03).** | The round-1 measurement was re-run: both functions rewritten as `SELECT metadata INTO v` then UPDATE from `v`. The gate is now RED: `TEST FAILED (12): the marker mentions compute_jobs 2 time(s)`. With only the retraction racy, it is RED at `TEST FAILED (13)`. Other shapes that go RED: a marker read through an unqualified, aliased relation (`FROM compute_jobs cj`) at (12); a marker `UPDATE ... FROM (SELECT ... FROM public.compute_jobs)` at (12); a retraction CTE read at (13). `run.mjs --file` on this gate prints `arm 12 RED (identity ok)`, `arm 13 RED (identity ok)`, `arms: 12/12/0`, `biting: 12`, `No defects in the narrowed scope`. The pristine gate prints `ALL 13 ARMS EXECUTED`, exit 0. |
| WR-01 (MEDIUM): control arm 11 overclaimed | **Fixed in the shipped files. Not fixed in the plan-03 SUMMARY body (WR-04).** | The gate header (`:11-18`, `:44-47`), the arm-11 comment (`:497-509`), the ci.yml re-measure comment and both mutation-floors comments now say arm 11 is an untwinned illustration. They also say arms 9 and 10 prove sequential key preservation and not concurrency. `requirements-completed` no longer lists SC-3 in any of the 191-02, 191-03 or 191-04 SUMMARY frontmatter. |

**Censuses match measured values.**
- The ci.yml `ARMS_FLOOR=418` sum re-adds to 418. `SENTINEL_FLOOR` stays 27.
- `ARMS_FLOOR` 801 -> 803, `FILES_FLOOR` stays 80 and `WAIVED_CEILING` stays 0, matching the runner's per-file line, `sections 12 / judged 12 / annotated 12 / waived 0 / biting 12`.
- The parser pins (`armsSeen` 803, `stepsSeen` and `needles.length` 898) agree with the two `edit` twins added.
- Seven census test files re-ran and passed (1462): `ci-anti-skip-gate.contract`, `mutation-runner-floors`, `mutation-annotation-parser`, `gate-family-meta`, `drift-check-scripts`, `lint-sql-gates` and `critical-regressions`.
- `node scripts/lint-sql-gates.mjs`: `scanned 107 file(s); 0 finding(s)`.

**No regression elsewhere in PR 1.** The fix range touches only the gate file, comments, census pins and planning records. The migration, the down file, the two snapshots, the privilege pytest, `dump-sql-functions.ts` and `baseline-content-drift-check.mjs` are byte-unchanged since round 1.

### New findings

### WR-02 (MEDIUM): arm 13 checks only the FIRST mention of compute_jobs, so a retraction that reads the row inside its own UPDATE passes 13/13 and loses a key under real concurrency

**File:** `supabase/tests/test_compute_job_metadata_merge.sql:553-574` (arm 13, the check at `:572`)

**Issue:**
- **What arm 13 checks.** It requires only that the first `compute_jobs` mention comes right after
  `UPDATE public.`. A stale read placed inside that same UPDATE statement therefore passes.
- **Measured.** Two retraction rewrites passed: `ALL 13 ARMS EXECUTED`, exit 0.
  - A scalar subquery in SET:
    `SET metadata = ((SELECT c.metadata FROM public.compute_jobs c WHERE c.id = p_job_id) - 'source') || ...`.
    This is an InitPlan taken at the statement snapshot, and the EvalPlanQual recheck does not
    re-run it.
  - An `UPDATE public.compute_jobs AS t ... FROM (SELECT c.id, c.metadata AS m FROM public.compute_jobs c ...) s`
    self-join.
- **Both lose the marker's key.** I ran a real two-session race on a scratch cluster with the same
  fixtures. Session A writes `read_refusal_kept_figures` and holds the row for 2 s. Session B calls
  the retraction, blocks behind A, then proceeds. Both variants ended
  `{"correlation_id": "new", "member_progress": {"a": 1}, "refresh_marker_retracted": "ledger-refresh"}`.
  K is lost, which is the exact defect the phase exists to remove. The pristine migration ended with
  K kept in both write orders.
- **The marker's arm 12 is not affected.** It requires exactly one mention, so the same shapes in
  the marker go RED at (12), as measured.

**Fix:** Pin the retraction's total mention count as well. It has exactly two: the UPDATE, and the
classifying SELECT after `IF FOUND THEN`. Then add a twin for one of the in-statement shapes (for
example, an `edit` that swaps `SET metadata = (metadata - 'source')` for the scalar-subquery form).
Measured on a scratch copy of the gate: this check stays GREEN on the real migration and goes RED at
(13) on the subquery, self-join and read-before-UPDATE retractions.

```sql
  SELECT count(*) INTO v_n FROM regexp_matches(v_src, 'compute_jobs', 'g');
  IF v_n <> 2
     OR substr(v_src, strpos(v_src, 'compute_jobs') - 14, 14) IS DISTINCT FROM 'UPDATE public.'
     OR strpos(v_src, 'IF FOUND THEN') = 0
     OR strpos(substr(v_src, strpos(v_src, 'IF FOUND THEN')), 'compute_jobs') = 0 THEN
    RAISE EXCEPTION 'TEST FAILED (13): ...';
  END IF;
```

Then move whatever censuses the new twin changes. If the runner accepts one twin per arm, split the
in-statement check into its own arm 14 (sentinel, `ARMS_FLOOR` and parser pins, each +1).

### WR-03 (MEDIUM): the two-pass comment strip lets a block comment containing `--` hide a racy read from both arms 12 and 13

**File:** `supabase/tests/test_compute_job_metadata_merge.sql:544` and `:568`. The claim is at `:531-532`: "a comment cannot satisfy or defeat the match".

**Issue:**
- **What the strip does.** It removes `--` comments first, then `/\*.*?\*/`. Take a block comment
  that contains `--`, such as `/* step 1 -- read the row */`:
  - The first pass removes everything from `--` to the end of the line, including the closing `*/`.
  - The second pass then matches from the orphaned `/*` to the next `*/` anywhere in the body, and
    deletes the real code in between.
- **Measured.** I put the racy read between `/* step 1 -- read the row */` and a later `/* step 2 */`:
  - With the marker body, the gate printed `ALL 13 ARMS EXECUTED`, exit 0.
  - With the retraction body, the gate also printed `ALL 13 ARMS EXECUTED`, exit 0.
  - The same two-session race lost K for the retraction variant and lost R (bringing `source` back)
    for the marker variant.
- **Why it matters.** The comment-stripping is what the arm says makes it immune to comments, so
  the claim at `:531-532` is false as written. `sql-gate-lint` R2 does not catch this. R2 only checks
  that a strip is present before a `~`/LIKE match, not that the strip is correct. Arms 12 and 13 use
  `regexp_matches`/`strpos`, which R2 does not inspect at all.

**Fix:** Strip both comment kinds in ONE left-to-right pass, so whichever comment starts first owns
its text. Use a block-comment pattern that cannot run past the first `*/`:

```sql
v_src := regexp_replace(pg_get_functiondef(v_oid), '--[^\n]*|/\*([^*]|\*+[^*/])*\*+/', '', 'g');
```

Measured on the probe string `x /* step 1 -- read */ SELECT ... compute_jobs; /* step 2 */ UPDATE ... -- c /* z`:
- the current strip deletes the SELECT;
- the single-pass strip keeps it, and also handles a `/*` inside a line comment.

With this strip, the scratch gate went RED at (12) and (13) on the two comment-hidden variants and
stayed GREEN on the real migration. PostgreSQL's nested block comments are still out of reach. Say so
in the arm comment instead of claiming full immunity.

### WR-04 (MEDIUM): the plan-03 SUMMARY body still records the overclaims CR-01 and WR-01 asked to remove

**File:** `.planning/phases/191-refusalrace-the-derive-s-refusal-marker-and-a-sync-s-refresh/191-03-SUMMARY.md:40`, `:15` and `:77`. Also `191-03-PLAN.md:285` (T-191-08).

**Issue:**
- **What was fixed.** The frontmatter `requirements-completed` was corrected.
- **What still overclaims.**
  - The one-liner at `:40` still says the gate "proves ... that the refusal marker, the
    ledger-refresh retraction and a claim-style write cannot undo each other in any order ... and
    proves the harness can see a lost key". That is the concurrency reading and the anti-vacuity
    reading that round 1 measured as false.
  - `:15` still lists the pattern "untwinned control arm ... to prove the harness can see a lost
    key".
  - `:77` still reports "Control arm can fail ... so a blind harness would fail loudly" as a proof.
    That proof edited the control's own text, not the code under test.
  - T-191-08 in the plan still names arm 11 as the mitigation for "a vacuous SC-3 gate hiding a
    lost key".
- **Why it matters.** The verifier and the phase close read these records. A reader of the SUMMARY
  body would conclude that SC-3's proof exists in PR 1.

**Fix:**
- Reword `:40` to "proves the three writers keep every key when run one after another in any order
  (not concurrency; plan 191-09 is that proof) and that neither function's body reads compute_jobs
  outside its UPDATE".
- Reword `:15` and `:77` to "illustrates the whole-metadata assertion style".
- Add a dated correction note under T-191-08 rather than rewriting the plan row: arm 11 is not a
  mitigation, and arms 12 and 13 plus plan 191-09 are.

### Round 2 verdict

CR-01's core is fixed: the shape round 1 measured, and the twinned arms that pin it, now fail as
they should. Three MEDIUMs remain.
- WR-02 and WR-03 are data-integrity holes in the same guard: a retraction body that loses the
  refusal marker under real concurrency passes all 13 arms.
- WR-04 is the records half of CR-01/WR-01.

None of them is a defect in the shipped functions, which are still correct as written.

_Reviewed: 2026-11-05_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_

## Round 3 (final): re-review of the fix round (`de80511c0..HEAD`: `079e41dc0`, `78187ced5`)

**Reviewed:** 2026-11-05
**Depth:** deep, MEDIUM+ only, limited to holes a realistic edit to the two functions could slip past.
**Round 3 tally:** 0 HIGH, 0 MEDIUM. The frontmatter above still holds the round-1 counts and was not edited.

Every measurement ran on `scripts/pg-lane/run.sh` with the gate's own RED-UNDER-SETUP list, against
the gate file at HEAD. The HEAD file is byte-identical (`cmp`) to the scratch `gate-new.sql` that
round 2 drafted. The round-2 racy migration copies were reused. The migration is unchanged since
`e4f39cc85`, so those copies still differ from it only in the edited function. Nothing in the repo
was edited.

### Verification of the round-2 findings

| Finding | Verdict | Evidence |
|---|---|---|
| WR-02: arm 13 missed reads inside the retraction's UPDATE | **Fixed** | Arm 13 now requires exactly two mentions: the first right after `UPDATE public.`, and a mention after `IF FOUND THEN`. The real gate on the pristine migration: `ALL 13 ARMS EXECUTED`, exit 0. All five retraction variants go RED at `TEST FAILED (13) ... 3 time(s)`, exit 3: read-before-UPDATE, CTE, scalar subquery in SET, `UPDATE ... FROM` self-join, and the comment-hidden read. The subquery and self-join variants are the two that passed 13/13 in round 2 and lost K in the two-session race. |
| WR-03: the two-pass strip could be defeated by `--` inside `/* */` | **Fixed** | Arms 12 and 13 now strip `'--[^\n]*\|/\*([^*]\|\*+[^*/])*\*+/'` in one pass. Both comment-hidden variants (marker and retraction) are RED, at (12) and (13) respectively. The other four marker variants are RED at (12): `both`, `markonly`, unqualified/aliased, and `UPDATE ... FROM`. Total: 10/10 racy variants RED on the right arm, and the pristine run is GREEN. |
| WR-04: stale overclaims in the plan-03 SUMMARY and PLAN | **Fixed for the lines named** | SUMMARY `:15`, `:40` and `:77` now say "sequential key preservation, not concurrency" and "illustrates the assertion style". T-191-08 carries a dated correction row. |

**Probe of the new strip regex** (PostgreSQL 16, `regexp_replace(..., 'g')`):
- `[^\n]` is read as "not newline", so a `--` comment containing `n` or `\` is removed whole. A misread here would leave tails of comments behind.
- `/* step 1 -- read */ READ; /* step 2 */` keeps `READ`.
- `-- note /* open` NEWLINE `READ` NEWLINE `-- close */` keeps `READ`.
- `/** doc **/`, `/***/` and `/* x * y ** z */` are removed exactly, so a match cannot run past the first `*/`.
- Nested `/* a /* b */ READ */` leaves `READ` in place. That adds a mention, so it fails RED (loud), not open.
- A string literal containing `--` (`'a--b'`) eats the rest of its own line. To slip past, a racy read would have to sit on the same line after such a literal. That needs contrived SQL, so it is not booked.
- No input can make the strip pass vacuously. An over-strip that removes the UPDATE drops the count below 1 (arm 12) or 2 (arm 13), and that goes RED.

**Runner:** `node scripts/mutation-runner/run.mjs --file supabase/tests/test_compute_job_metadata_merge.sql`
prints arms 1-10, 12 and 13 `RED (identity ok)`, `arms: 12/12/0`, `biting: 12`, `lane-invocations: 12`,
`sections 12 / judged 12 / annotated 12 / waived 0 / biting 12`, and `No defects in the narrowed scope`.

**No regression in PR 1:**
- The fix range touches only the gate and two planning files. The migration, down file, snapshots,
  privilege pytest, `dump-sql-functions.ts`, `baseline-content-drift-check.mjs`, ci.yml and the
  census files are byte-unchanged since round 2.
- No twin was added, so `ARMS_FLOOR` 803, `SENTINEL_FLOOR` 27 and the parser pins stay correct.
- `lint-sql-gates`: `scanned 107 file(s); 0 finding(s)`. `lint-app-guc`: 0 findings.
- Seven census and contract vitest files: 1462 passed.

### Notes below the bar (not booked as findings)

- **The arm-13 count clause has no twin of its own.** The only `RED-UNDER-M` for arm 13 inserts a
  read before the UPDATE, and the first-mention clause already catches that. A later gate edit that
  dropped `v_n <> 2` would therefore still look biting to the runner, even though the WR-02 shapes
  would pass again. This is a gate-maintenance gap and is not a function edit that slips past. If
  wanted, add an arm 14 whose twin swaps `SET metadata = (metadata - 'source')` for the
  scalar-subquery form.
- **The pre-execution text of `191-03-PLAN.md` still states the original intent.** The must-have at
  `:28`, the purpose at `:54` and the `<done>` at `:229` still say a control "proves the harness can
  see a lost key" and SC-3 "is proven in SQL". That matches round 2's advice to annotate the plan
  rather than rewrite it. A verifier reading the must-haves should take the SUMMARY frontmatter
  (`requirements-completed: []`, SC-3 not met) and the T-191-08 correction as authoritative.

### Round 3 verdict

**CLEAN at MEDIUM+.** WR-02, WR-03 and WR-04 are fixed and re-measured. A racy body in either
function now fails the gate in every shape measured across three rounds: read before the UPDATE,
CTE, unqualified or aliased read, `UPDATE ... FROM` self-join, scalar subquery in SET, and a read
hidden behind a comment. The shipped functions are unchanged and correct.

_Reviewed: 2026-11-05_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
