---
phase: 144-job-wr-02-orphaned-running
plan: 02
subsystem: infra
tags: [vitest, migration-content-gate, ci, requirements, todos, neuter-red, wont-fix]
status: complete

# Dependency graph
requires:
  - phase: 144-01
    provides: "the deployed migration 20260817120000 (the artifact under guard), the occurrence-count vocabulary recalibrated for a two-arm body, and the MEASURED finding that a word-bounded LIMIT PATTERN test is insufficient on a two-arm body (probe P8)"
  - phase: 143-job-dropped-enqueue-reconciliation-sweep
    provides: "src/__tests__/reconcile-dropped-enqueue-sweep.test.ts — the gate template: local-constant oracle independence, the cronBody() extractor, the anti-vacuity guard, body-scoping, and the later-migration re-registration scan"
provides:
  - "src/__tests__/retention-orphaned-running-terminalize.test.ts — the THIRD sibling gate, pure file text, runs in every vitest shard with no DB"
  - ".planning/REQUIREMENTS.md JOB-08 — the dated WON'T-FIX resolution block carrying the 2026-08-17 census, the structural argument, both standing traps, and the pre-merge re-measure pointer"
  - "TODOS.md 'Phase 144 — recorded deferrals' — three items with named homes"
  - "A 14-entry neuter-RED matrix extending Plan 01's, including the control measurement that both weaker bound-gate forms stay GREEN under a one-arm widening"
affects: [144-03 TEST apply + live tick + the PROD re-census this block depends on, any future edit to the orphaned-running janitor body]

actuals:
  tokens: 12240     # chars/4 over the realized diff (6c06e687..068d7e30)
  tasks: 2
  commits: 2

tech-stack:
  added: []          # ZERO packages installed this phase
  patterns:
    - "Occurrence COUNT, not presence, for any token a two-arm body names more than once — a presence test cannot fail while either arm survives"
    - "The bound gate needs BOTH halves: word-bounding (catches LIMIT 100 -> 1000 widening) AND a count of 2 (catches widening ONE arm). Measured: substring containment and the bare word-bounded pattern BOTH stay green under a one-arm widening"
    - "Adjacency-scoped regex for the schedule literal instead of a whole-file count, because STEP 2's self-verify legitimately carries two more copies of the same literal"
    - "Anti-vacuity guard on the body extraction — measured to be the ONLY thing standing between a hijacked extraction and six vacuously-green negative assertions"

key-files:
  created:
    - src/__tests__/retention-orphaned-running-terminalize.test.ts
  modified:
    - .planning/REQUIREMENTS.md
    - TODOS.md

decisions:
  - "The TS gate asserts the word-bounded LIMIT 100 match COUNT is exactly 2, not merely that one match exists — carried forward from Plan 01's neuter matrix and re-measured here"
  - "The schedule literal is asserted ADJACENT to the cron.schedule call (count of the combined regex = 1) rather than counted whole-file, because it appears 3 times in the file and 2 of those are STEP 2 prose"
  - "JOB-08 closed as WON'T-FIX; the JOB-08 and JOB-05 checkboxes are deliberately NOT flipped — phase verification owns that"
  - "analytics-service/tests/test_compute_jobs_fencing.py deliberately untouched (D-09): record and route to TODOS, do not edit in this phase"

metrics:
  duration: ~25 min
  completed: 2026-08-17
---

# Phase 144 Plan 02: TS migration-content gate + the JOB-08 WON'T-FIX Summary

The third and last sibling gate for JOB-05 — a pure-text vitest gate that pins the deployed two-arm
terminalizer body in every CI shard with no database — plus the committed JOB-08 decision: a
WON'T-FIX carrying its census, its structural argument, and both standing traps.

## What was built

### 1. `src/__tests__/retention-orphaned-running-terminalize.test.ts` (669 lines, 10 tests)

The third sibling of the migration's own STEP 2 self-verify and
`supabase/tests/test_retention_orphaned_running.sql` Part 1. Unlike both, it needs no database, so
it runs in every vitest shard.

**Counts re-derived from the artifact, not copied.** Before writing a line I extracted the deployed
`$cron$` body (1396 bytes) and counted every token independently. All 21 counts matched the
orchestrator's independent audit exactly:

| token | count | which occurrence is which |
|---|---|---|
| `public.compute_jobs` | 4 | arm A CTE + arm A UPDATE target + arm B CTE + arm B UPDATE target |
| `status = 'running'` | 4 | 2 batch predicates + 2 compare-and-set fences |
| `'failed_final'` | 2 | one terminal status per arm |
| `next_attempt_at = now()` | 2 | B3, one per SET list |
| `orphaned_running_reaped` | 2 | one fixed audit literal per arm |
| `AS MATERIALIZED` | 2 | one batch CTE per arm |
| `FOR UPDATE SKIP LOCKED` | 2 | one per arm |
| `ORDER BY` | 2 | arm A claimed_at ASC, arm B created_at ASC |
| word-bounded `LIMIT 100` | 2 | one per arm |
| `interval '4 hours'` | 1 | arm A only (RT-01, UNCHANGED) |
| `interval '48 hours'` | 1 | arm B only (derived) |
| `claimed_at IS NULL` | 1 | arm B predicate |
| `DELETE` / `IN (SELECT` / `claimed_by` / `failed_retry` / `enqueue_compute_job` / `INSERT INTO` | 0 | the negatives |

**The bound assertion carries Plan 01's finding forward.** Plan 01 measured that the word-bounded
PL/pgSQL form `v_command !~ 'LIMIT[[:space:]]+100([^0-9]|$)'` is INSUFFICIENT on a two-arm body: it
is satisfied by ONE match, so widening only arm B leaves it green. The TS gate therefore asserts
`[...body.matchAll(/LIMIT\s+100(?![0-9])/g)].length === 2`, plus a companion assertion that no
OTHER numeric LIMIT hides in the body (`allLimits === boundedLimits`).

### 2. `.planning/REQUIREMENTS.md` — JOB-08 resolution block

Appended as an indented continuation of the JOB-08 bullet (no precedent block existed in the file;
the checkbox is deliberately NOT flipped). Carries the 2026-08-17 census table verbatim from
RESEARCH §9, the structural argument in full, both traps restated per D-12, the note that TEST's
2819 is a CI artifact filed separately, and the dated-claim pointer to Plan 03's pre-merge
re-census — including what a non-zero re-census would mean (falsification, not merely staleness).

### 3. `TODOS.md` — "Phase 144 — recorded deferrals (logged 2026-08-17)", exactly three items

(i) TEST's 2819-row stale-`pending` backlog as CI hygiene, never production code (D-13); (ii) the
chain-mid residual this phase CREATES by design; (iii) fixture hygiene in
`test_compute_jobs_fencing.py` (D-09), recorded and routed but not edited.

## The neuter-RED matrix — 14 observed, verbatim

Every neuter was applied to the **migration file**, run, the RED **observed**, then restored with
`git checkout --` and re-run to green. The migration is byte-identical to Wave 1's commit
throughout (`md5 ce53a29fb402bd797e0f77aa055efa80`, verified against `git show HEAD:` after the
matrix completed). This extends Plan 01's 8-entry SQL-gate table.

| # | Neuter | Assertion that fired | Observed RED (verbatim) |
|---|---|---|---|
| **N1** ⭐ | Widen **ONLY arm B**'s bound, `LIMIT 100` → `LIMIT 1000` | bounded-LIMIT count | `the body carries 1 word-bounded LIMIT 100 clause(s), expected exactly 2 (one per arm). ONE means a single arm has been widened to LIMIT 100<digits> or unbounded while the other still satisfies a bare pattern test — the per-arm cap is the whole bound. ZERO means the bound is gone entirely: one tick would terminalize the WHOLE orphan population in a single statement, holding row locks and firing the updated_at trigger across every row at once.: expected 1 to be 2 // Object.is equality` — `Tests 1 failed \| 9 passed (10)` |
| **N2** ⭐ | Anti-vacuity: write the dollar tag twice in a HEADER COMMENT so the non-greedy regex matches the PROSE pair | `cronBody()` anti-vacuity guard | `the extracted $cron$ body does not contain the terminal UPDATE public.compute_jobs — the extraction is broken (almost certainly a dollar tag written in a COMMENT earlier in the file, which the non-greedy regex matches FIRST), so every assertion scoped to the body proves nothing. Extracted head was: " and later ": expected ' and later ' to contain 'UPDATE public.compute_jobs'` — fired in all **6** body-scoped tests; `Tests 6 failed \| 4 passed (10)` |
| **N3** | Delete **arm B entirely** (18 lines) | 4 assertions | `the body names public.compute_jobs 2 time(s), expected 4 …: expected 2 to be 4`; `the body writes 'failed_final' 1 time(s), expected 2 …: expected 1 to be 2`; `the body carries interval '48 hours' 0 time(s), expected exactly 1 (arm B) …: expected +0 to be 1`; `the body carries 1 word-bounded LIMIT 100 clause(s), expected exactly 2 …: expected 1 to be 2` — `Tests 4 failed \| 6 passed (10)` |
| **N4** | Arm A terminal status `'failed_final'` → `'failed_retry'` | terminal count + failed_retry negative | `the body writes 'failed_final' 1 time(s), expected 2 (one per arm). It is the ONLY terminal-failure value both outside the claimable set … and outside Phase 142's reaper exclusion set …: expected 1 to be 2`; `the body references failed_retry — the one terminal-looking value that terminalizes nothing: it is claimable (so the orphan is re-claimed to running on the next worker tick) AND inside 142's exclusion set (so the user-facing analytics message stays blocked forever).: expected '\n    DO $sweep$\n    BEGIN\n      WI…' not to contain 'failed_retry'` — `Tests 2 failed \| 8 passed (10)` |
| **N5** | Drop `next_attempt_at = now()` from **arm B's SET list only** (B3 half-omission) | retention-clock count | `the body sets next_attempt_at = now() 1 time(s), expected 2 (one per SET list). retention_compute_jobs_failed deletes on COALESCE(next_attempt_at, created_at) past 90 days and the claim RPC never advances that column, so a status-only flip lets an old orphan be collected on the next 03:30 tick — the audit trail this phase exists to preserve would last eleven hours instead of ninety days. Note the asymmetry that makes this easy to miss: retention_compute_jobs_done (jobid 4) DOES key on created_at (20260515113853:195-199).: expected 1 to be 2` — `Tests 1 failed \| 9 passed (10)` |
| **N6** | Change the **registered** cadence `'50 * * * *'` → `'25 * * * *'`, leaving STEP 2's two prose copies intact | schedule adjacency count | `the migration does not call cron.schedule('retention_compute_jobs_orphaned_running', '50 * * * *', ...) exactly once. Without the registration nothing runs on a schedule and the REMOVAL body of 20260720120000 stays deployed behind a green apply. Minute 50 is what keeps this janitor off 142's quarter-hour reaper grid, off 143's sweep at :35, and 10 minutes clear of the :00 stack.: expected +0 to be 1` — `Tests 1 failed \| 9 passed (10)` |
| **N7** | Reinsert a removal statement into the body (`DELETE FROM public.compute_jobs WHERE status = 'failed_final';`) | 3 assertions | `the body names public.compute_jobs 5 time(s), expected 4 …: expected 5 to be 4`; `the body writes 'failed_final' 3 time(s), expected 2 …: expected 3 to be 2`; `the body contains a row-removal statement. This janitor must TERMINALIZE and never remove: a removed row gives the wizard poller no outcome to break out on, destroys the only audit record that a worker was down past its claim window, and on PROD discards a genuine in-flight one-shot job that nothing will re-enqueue. That is the SHIPPED behaviour this migration exists to replace.: expected '\n    DO $sweep$\n    BEGIN\n      WI…' not to match /\bDELETE\b/i` — `Tests 3 failed \| 7 passed (10)` |
| **N7b** | **Count-neutral** removal (`DELETE FROM public.strategy_analytics WHERE FALSE;`) — isolates the D-01 negative so it is not merely carried by the counts | D-01 removal negative, ALONE | `the body contains a row-removal statement. This janitor must TERMINALIZE and never remove: …: expected '\n    DO $sweep$\n    BEGIN\n      WI…' not to match /\bDELETE\b/i` — `Tests 1 failed \| 9 passed (10)` |
| **N8** | Remove **arm A's compare-and-set fence** (`AND cj.status = 'running'` on the outer UPDATE) | running-scope count | `the body scopes to status = 'running' 3 time(s), expected 4 (one batch predicate and one compare-and-set fence per arm). Losing a PREDICATE widens the janitor to every status — it would terminalize done and pending rows. Losing a FENCE removes the protection against a real writer that terminalizes the row between the batch subselect and the UPDATE, so this janitor would overwrite a genuine outcome with a fabricated one.: expected 3 to be 4` — `Tests 1 failed \| 9 passed (10)` |
| **N9** ⭐ | Drop `AS MATERIALIZED` from **arm B only** | materialized count | `the body carries 1 MATERIALIZED batch CTE(s), expected exactly 2 (one per arm — this migration has TWO arms, unlike Phase 143's one-arm sweep whose sibling gate asserts 1).: expected 1 to be 2` — `Tests 1 failed \| 9 passed (10)` |
| **N10** | **Arm B copies arm A's threshold**: `interval '48 hours'` → `interval '4 hours'` | arm-A window count | `the body carries interval '4 hours' 2 time(s), expected exactly 1 (arm A). Zero means the RT-01-corrected threshold is gone: … MORE than one means a second arm has imported a threshold derived for a different mechanism.: expected 2 to be 1` — `Tests 1 failed \| 9 passed (10)` |
| **N11** | Add a LATER migration (`20260818090000_neuter_reregister_probe.sql`) that re-registers the same jobname | later-migration scan | `later migration 20260818090000_neuter_reregister_probe.sql re-registers cron job 'retention_compute_jobs_orphaned_running'. Every forward-only cron re-registration MUST move this test's FIX_TS / FIX_FILENAME constants — and the sibling counts in the migration's own STEP 2 and in supabase/tests/test_retention_orphaned_running.sql — in the SAME commit as the migration. Otherwise all three gates go on guarding a body pg_cron no longer runs, and stay green while doing it.: expected 'BEGIN;\nDO $$\nBEGIN\n  PERFORM cron.…' not to match /cron\.schedule\s*\(\s*'retention_comp…/` — `Tests 1 failed \| 9 passed (10)` |
| **N12** | Drop `FOR UPDATE SKIP LOCKED` from **arm B only** | skip-locked count | `the body carries FOR UPDATE SKIP LOCKED 1 time(s), expected 2 (one per arm). An arm that dropped it would BLOCK on any row a live writer holds instead of skipping it and taking it next tick, and under the 5s lock_timeout that turns a contended tick into a failed tick.: expected 1 to be 2` — `Tests 1 failed \| 9 passed (10)` |
| **N13** | Drop `ORDER BY` from **arm A only** (bounded but non-progressing) | ordering count | `the body orders its bounded batches 1 time(s), expected 2 (arm A by claimed_at ASC, arm B by created_at ASC). Without a deterministic ordering the LIMIT selects an arbitrary subset each tick, so the oldest orphans can be skipped indefinitely while the batch stays full — bounded but never progressing.: expected 1 to be 2` — `Tests 1 failed \| 9 passed (10)` |

## ⭐ Two control measurements — what the WEAKER forms would have done

These are the point of the exercise. A neuter that reds proves the assertion works; a control proves
the assertion was **necessary**.

**Control A — under N1 (arm B widened to `LIMIT 1000`), measured directly:**

```
  substring containment  body.includes("LIMIT 100")            = true   <- would stay GREEN (the 143 finding)
  bare word-bounded      /LIMIT\s+100(?![0-9])/.test(body)     = true   <- would ALSO stay GREEN (the 144-01 finding)
  COUNT-asserted         matches = 1                                    <- REDs, expected 2
```

Both weaker forms bless a 10x widening of one arm's per-tick blast radius. Only the count catches it.
This is the same defect class the SQL gate hit in Plan 01, reproduced in a second language.

**Control B — under N2 (hijacked extraction, body = `" and later "`), measured one assertion at a
time:** without the anti-vacuity guard, **all six** negative assertions pass:

```
    DELETE              -> PASS (VACUOUS)
    IN(SELECT..LIMIT    -> PASS (VACUOUS)
    failed_retry        -> PASS (VACUOUS)
    enqueue_compute_job -> PASS (VACUOUS)
    INSERT INTO         -> PASS (VACUOUS)
    claimed_by          -> PASS (VACUOUS)
```

The guard is the only thing between a hijacked extraction and a gate that proves nothing while
reporting green. It must never be removed as redundant.

**A third, incidental control — N9.** Had I copied Phase 143's sibling assertion
`expect(materialized).toBe(1)` (correct for its ONE-arm body), N9 would have been **GREEN**: with
arm B's keyword removed the count IS 1. The recalibration requirement is not bookkeeping; copying
143's number would have installed an assertion that passes over a half-deleted body.

## Deviations from Plan

**None — the plan executed as written.** No package was installed (T-144-SC: zero installs). No
Supabase project was touched. The migration and the Wave 1 SQL gate were not modified.

Two scoping refinements made inside the plan's own instructions, both recorded here because they
changed an assertion's FORM (never its subject):

1. **The schedule literal is asserted by adjacency, not by whole-file count.** The plan said
   "present exactly once in the cron.schedule call". Measured: `'50 * * * *'` occurs **3** times in
   the file — once in the registration and twice inside STEP 2's self-verify (the string comparison
   and its failure message). A whole-file count of 1 would false-RED at HEAD; a whole-file
   `toContain` would false-GREEN under N6. The gate therefore counts the combined
   `cron.schedule('<name>', '<schedule>'` regex and asserts it matches exactly once. N6 confirms it
   reds while the two prose copies survive untouched.
2. **N7b was added beyond the plan's neuter list.** N7's removal statement perturbed two counts, so
   the D-01 negative might have been carried by them rather than firing on its own. N7b is a
   count-neutral removal that isolates it. It fired alone.

## Threat Flags

None. No new network endpoint, auth path, file access pattern, or schema change — this plan adds
one test file and two documentation hunks. T-144-09 (public-repo disclosure) checked on the two
doc hunks: zero matches for credentials, connection strings, bearer tokens or user data; the two
Supabase project refs carried in the census were already committed in Wave 1's migration header, so
this introduces no new disclosure class.

## Verification

| Check | Result |
|---|---|
| Gate green at HEAD, local Node 25.8.1 | `Test Files 1 passed (1) / Tests 10 passed (10)` |
| Gate green under CI-parity **Node 22.22.1** | `Test Files 1 passed (1) / Tests 10 passed (10)` |
| `npx eslint` on the new file | exit 0, no output |
| `npx tsc --noEmit` | zero diagnostics mentioning the new file |
| Migration byte-identical to Wave 1 | `git diff supabase/migrations/` empty; `md5 ce53a29fb402bd797e0f77aa055efa80` == `git show HEAD:` blob |
| Wave 1 SQL gate untouched | not in any commit of this plan |
| ≥7 neuter-REDs observed | **14** observed, each restored and re-run green |
| JOB-08 / JOB-05 checkboxes not flipped | both still `- [ ]` |
| Exactly three TODOS items under the Phase 144 heading | `3` |
| `test_compute_jobs_fencing.py` untouched | `git log main..HEAD -- <file>` → 0 commits |

## Known Stubs

None.

## Commits

| Commit | Message |
|---|---|
| `6c06e687` | `test(144-02): pin the two-arm terminalizer body in every CI shard, counts recalibrated` |
| `068d7e30` | `docs(144-02): close JOB-08 as a WON'T-FIX carrying its measurement, and file three deferrals` |

## Notes for Plan 03

- **The JOB-08 block has a live dependency on Plan 03.** It states that Plan 03 re-runs the PROD
  `pending` census immediately before merge, and that a **non-zero** result **falsifies** the
  structural argument (nothing sweeps `pending`, so a non-zero count means rows HAVE stranded) and
  reopens the WON'T-FIX. That is a real kill criterion, not a formality.
- **RESEARCH §3's confirming query is still owed.** Plan 03 runs it against TEST to confirm the
  NULL-claim rows are escaped fixture residue (`claim_token` non-null, `exchange = 'okx'`,
  `priority = 'normal'`, `claimed_by` NULL, strategies named `p97-fence-test-%`) rather than a
  production writer bug.
- **Operator-signal question (RESEARCH Open Q1) considered and deferred.** No cron→Sentry bridge is
  built. A first PROD terminalization implies a >4h worker outage, which Railway and Sentry already
  surface; adding a second alarm for the same condition would be duplicate signal. Recorded here
  rather than filed to TODOS, because it is a decision not to build, with no follow-up work implied.
- **If the body ever changes, three files move in ONE commit**: the migration's STEP 2, the SQL gate
  Part 1, and this TS gate. The TS gate's later-migration scan (N11) is what catches the specific
  case of a forward-only re-registration leaving all three behind.

## Self-Check: PASSED

- `src/__tests__/retention-orphaned-running-terminalize.test.ts` — FOUND
- `.planning/REQUIREMENTS.md` (JOB-08 block, `grep -c` = 1) — FOUND
- `TODOS.md` (Phase 144 heading, `grep -c` = 1; 3 items) — FOUND
- Commit `6c06e687` — FOUND
- Commit `068d7e30` — FOUND
