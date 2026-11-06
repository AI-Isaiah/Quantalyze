---
phase: 167-credtrust
plan: 03
subsystem: database
tags: [supabase, postgres, sql-gate, react, mutation-runner, census-pins]

# Dependency graph
requires:
  - phase: 167-01
    provides: "D-09 classifier arms and the WizardErrorCode registry this phase's owner helper sits beside"
provides:
  - "sync_status = 'sign_in_failed' — the D-11 arm B migration, its self-verify DO block, its SQL gate, and its census-pin moves"
  - "AllocatorSyncStatus renders the new value as an amber 'Sign-in failed' pill with an authored, syncError-ignoring helper"
  - "PILL_STYLES is EXPORTED, so a roster test can prove every styled status renders a non-empty label"
affects: [167-04, 167-05]

# Actuals
actuals:
  tasks: 4
  commits: 12
  plan_head_before: 5f89b472
  plan_head_after: 72f94e2e

status: complete
human_approval:
  gate: checkpoint:human-verify
  decision: approved for merge
  date: "2026-09-22"
  rounds: 2
---

# Phase 167 Plan 03 — SUMMARY

**`sign_in_failed` is now representable in the database and renderable in the UI, in one commit —
and the guard that was supposed to prove no prior value was lost has been repaired, because it
could not.**

## Task commits

| task | commit | what |
|---|---|---|
| 1 | `6fe963a8` | migration + amber pill + authored helper, one commit by design (T-167-08) |
| 2 | `60120f31` | SQL gate over the widened CHECK + census pin moves |
| — | `37d262f7` | partial summary, written before the gate |
| 3 | `bc4c6947` | D-16 scope amendment (founder), folded into `167-04` |
| 4 | `2169fa2d` … `e803007b` | the review fix round, six commits |
| 4 | `c6dd7403` | `SET LOCAL`, correcting the fix round's own regression |
| 4 | `72f94e2e` | the seventh stale census restatement |

## ⛔ The human-verify gate (D-13) — what was actually run

Three reviewers, **twice**, because a fix round is where regressions enter. Round 2 was not a
re-confirmation pass: it was briefed to hunt what the FIXES broke, and it found something each time.

| reviewer | round 1 | round 2 |
|---|---|---|
| `migration-reviewer` | 2 MEDIUM, 1 LOW | **1 HIGH** — a regression the fix round introduced |
| `rls-policy-auditor` | 2 MEDIUM (one a scope call) | 0 findings at any severity |
| `silent-failure-hunter` | **BLOCK** — 1 CRITICAL, 1 HIGH, 2 MEDIUM | 1 LOW — a seventh stale pin |

⭐ **Founder approved the migration for merge on 2026-09-22**, after seeing the diff, every
finding with its disposition, the runner and gate-linter output, and a plain statement that
merging applies the constraint change to PROD.

## Findings and what was done

| # | finding | disposition |
|---|---|---|
| 1 | a stale corpus census pin left `sql-gate-lint`'s suite RED at HEAD | fixed `2169fa2d` (75 → 76) |
| 2 | the "no prior value was lost" guard is blind to the loss of `'complete'` | fixed `1a0669ba` — the IDIOM, not the one arm |
| 3 | two ACCESS EXCLUSIVE statements with no `lock_timeout` | fixed `c11a282b`, corrected `c6dd7403` |
| 4 | the DO block resolved the constraint by `conname` alone | fixed `c2f7cfbd` |
| 5 | `pillLabel`'s switch is non-exhaustive by construction | fixed `f4aa5cb1` |
| 6 | **five MORE stale census pins**, all already red at HEAD | fixed `e803007b` |
| 7 | **a seventh**, missed by both prior passes | fixed `72f94e2e` |
| 8 | the holdings surfaces render the new status as trusted | **founder decision D-16** → `167-04` |

## ⭐ The finding that matters most, and it was MEASURED rather than reasoned

`'complete'` is a SUBSTRING of `'complete_with_warnings'`. The guard whose entire job is *"every
prior value survived the DROP+ADD"* probed with bare `LIKE '%complete%'`, so a stale re-typed list
that dropped `'complete'` while keeping `'complete_with_warnings'` satisfied it. Reproduced on a
throwaway pg-lane BEFORE the fix — the gate printed `Part 1 OK` and exited 0 over a constraint
missing the most frequently written healthy status.

⛔ **The same hole sat in the SQL gate**, so the permanent gate reproduced the migration's weakness
instead of compensating for it, and its `RED-UNDER-M` arm 2 mutated by dropping `'revoked'` — a
value that IS detectable — so it went red, looked healthy, and never exercised the shape it could
not catch.

**Fixed as an idiom, in both files:** every probe now matches the quoted, delimited, cast token as
`pg_get_constraintdef` renders it (`'complete'::text`), read off a lane verbatim rather than
assumed. ⭐ `position()` replaced `LIKE` deliberately — `_` is a LIKE wildcard and three of the
nine values carry one, a second and quieter ambiguity in the same check.

A third `RED-UNDER-M` arm now carries exactly that mutation, with its own check `(c)` and its own
`TEST FAILED (3)` identity. ⚠️ The identity split was necessary, not cosmetic: the runner scores an
arm by the FIRST `TEST FAILED (…)`, so an arm reddening `(2)` could never be told from arm 2.
Coverage is preserved set-for-set — old (b) = 8 values; new (b) = 6 and new (c) = 2.

## ⚠️ The fix round introduced a regression, and round 2 is why it did not ship

`SET lock_timeout = '3s'` was added session-scoped in a file with no `BEGIN`/`COMMIT`. A session
`SET` SURVIVES COMMIT and leaks into every later migration in the same `db push --include-all`.
Found independently by BOTH `rls-policy-auditor` (handed off as apply-correctness) and
`migration-reviewer` (filed HIGH). The fix round had also mis-cited its precedent: the analog it
named wraps in an explicit transaction, so its session `SET` is a deliberate choice inside a frame
this file does not have.

⚠️ **MEASURED and recorded in the migration: the pg-lane CANNOT prove this bound is in force.** The
lane applies migrations outside a transaction, so `SET LOCAL` warns `25P01` and binds nothing there.
The gate still passes because an idle throwaway cluster never contends. The bound is real under
`db push`, whose per-migration transaction wrap is ASSERTED by `20260803150000` and was not measured
from this checkout — no database command may be run against any remote from here.

## ⭐⭐ Seven restatements of one number, across three passes

Task 2 moved three census pins. The fix round found five more, all already red at HEAD. Round 2
found a seventh inside the very file the fix round had been editing. Each pass believed it had
swept the surface.

⛔ **The defect is not any one stale number — it is that the count is RESTATED in seven places
rather than derived in one.** That is larger than this phase and is NOT fixed here.

⚠️ The quietest one was an `annotatedFiles` BY-NAME list that could only surface after the
`filesTotal` pin beside it was corrected — a stale pin hiding behind a stale pin.

## Verification at HEAD `72f94e2e` — re-run by the orchestrator, not taken from any agent

| command | result |
|---|---|
| `node scripts/mutation-runner/run.mjs` (full) | exit 0 · `arms: 426/426/0` · `biting: 426` · `lane-invocations: 426` (tallies AGREE) · `lane-blocked: 0` · `✅ No defects` |
| `node scripts/lint-sql-gates.mjs` + `--self-test` | `scanned 76 file(s); 0 finding(s)` · `7 rules, red+green each` |
| `node scripts/lint-app-guc.mjs` | 0 findings |
| `scripts/pg-lane/run.sh` over the gate | exit 0, `Part 1 OK` |
| `npx vitest run src/__tests__/mutation-runner-floors.test.ts` | 81/81 |
| `npx vitest run src/components/exchanges/` | 182 passed |
| `npm run typecheck` | clean |

Census reconciles: 49 annotated + 0 lane-blocked + 27 unreachable + 0 pending = 76.
⛔ `FILES_FLOOR 49` · `ARMS_FLOOR 426` · **`WAIVED_CEILING 0`** — nothing lowered a floor, raised a
ceiling, relaxed a timeout or added a waiver.

## Known limits

- ⚠️ **Nothing writes `sign_in_failed` yet.** `167-04` lands the writer. Widening a CHECK ahead of
  its writer is the SAFE ordering; the dangerous direction is the reverse. The commit subject of
  `6fe963a8` says "end-to-end" and overclaims on this point.
- ⚠️ **The holdings surfaces still render the new status as trusted live data** — 7 equality sites
  against `"revoked"`. Founder decision **D-16**: folded into `167-04` to land in the SAME commit as
  the writer, so no window exists in which the value is writable and the surface lies.
- ⚠️ `src/__tests__/lint-sql-gates.test.ts`'s four `EXECUTION ORACLE` cases time out at 5000 ms on a
  loaded machine and pass under a longer timeout. Load-bound, NOT assertion failures. ⛔ Not "fixed"
  by raising the in-file timeout.
- ⚠️ Recorded, not fixed, and outside this diff: `rawKey in PILL_STYLES` walks the prototype chain
  while the roster uses `Object.keys`. Unreachable in practice — the column is CHECK-constrained.
