@AGENTS.md

## Test Coverage

The TypeScript test suite tracks coverage via `@vitest/coverage-v8`. Run
`npm run test:coverage` to produce a v8 report (text + HTML + JSON
summary in `coverage/`).

- **Gate (ratchet)**: lines 82 / statements 80 / functions 74 / branches 72,
  configured as Vitest thresholds in `vitest.config.ts`. These are set a few
  points under measured actual (2026-06-20: 85.2 / 83.3 / 77.4 / 75.5) so a
  real regression fails CI but normal noise does not. When actual climbs
  durably, raise the thresholds to match.
- **Target**: 80%, matching the `--cov-fail-under=80` gate the
  `analytics-service/` Python suite already enforces. Lines and statements
  already clear it; functions and branches are the next ratchet.

Coverage is **a blocking CI gate** as of tech-debt #11 (2026-06-20): the
vitest shards in `.github/workflows/ci.yml` run with `--coverage` and emit
blob reports, and the `frontend-coverage` job merges them (`vitest run
--merge-reports --coverage`) and enforces the thresholds on the full-suite
numbers; the aggregator `frontend` check gates branch protection on it.
(Since 2026-07-02 the suite executes once, sharded — the old separate
full-suite coverage run is gone. The prior 60% floor was enforced nowhere —
CI ran vitest sharded without `--coverage`.)

## SQL gate integrity jobs (v0.77.0.0, Phase 164.3)

The `frontend` aggregator gates more than coverage now. Three jobs in
`.github/workflows/ci.yml` are in both its `needs:` list and its result loop, so
a failure fails the aggregate rather than passing quietly:

- **`sql-mutation`** — mutates every SQL gate arm carrying a `RED-UNDER`
  annotation, asserts the file goes RED with that arm named, restores, asserts
  GREEN. Exits 1 on an annotation that does not bite, on coverage below a
  ratchet floor pinned at the measured value, on more waived arms than
  `WAIVED_CEILING` (0) in `scripts/mutation-runner/run.mjs`, and when the
  runner's two independent arm tallies (`arms:` vs `lane-invocations:`)
  disagree (v0.77.1.0). Runs on its own throwaway PostgreSQL cluster
  (`scripts/pg-lane/run.sh`), never against shared TEST. Since 2026-09-03 it
  also prints, and MEASURE_FAILs on the absence of, a `lane-blocked:` line
  naming the four idiom gate files that probe `pg_extension` for pg_cron — 100
  sections DEFERRED by founder decision (`[REDUNDER-PGCRON]`, SCOPE AMENDMENT
  #2) because the lane has no pg_cron — beside a `lane-probe:` line measured on
  the lane itself, which is what lets the deferral expire: pg_cron AVAILABLE
  with a non-empty lane-blocked class raises `lane-blocked-stale` and exits 1.
  ⚠️ **CURRENCY 2026-09-05: the clause "because the lane has no pg_cron" is no
  longer true and the deferral it describes is RETIRED.** Phase 164.4.1 put
  pg_cron ON the lane; the four files (and an apply-list-blind fifth) are
  annotated, and the line now reads `lane-blocked: 0 file(s)` with a reason that
  says so. Both prints, the probe leg and the `lane-blocked-stale` defect are
  UNCHANGED and stay live for any future unannotated pg_cron gate — see the
  dated paragraph at the end of this section.
- **`sql-gate-lint`** — four static rules over `supabase/tests`, each shipped
  with a red and a green fixture proving the rule can fire.
- **`plan-anchor-verify`** — re-resolves every `file:line` anchor and named
  symbol a pending PLAN.md asserts, and fails loud on a miss.

Two more gates live outside the aggregator: **VAC-04** (repo-vs-PROD function
body diff) is a step in `migration-drift-check.yml` on migration PRs, and
**VAC-08** (repo-vs-TEST ledger + body drift) runs in `sql-tests`. Both exit 1
when their credential is absent — neither ever skips.

⚠️ `sql-mutation` and `sql-gate-lint` were first observed green on ubuntu on
2026-09-02 (workflow_dispatch run 33620169220 at 89cbef8b, self-test 12/12,
`arms: 30/30/0`, tallies agree — closes `.planning/WINDOWS.md` entry 28);
`plan-anchor-verify` was skipped in that run. ⚠️ CURRENCY 2026-09-03: that
`30/30/0` is the run-33620169220 quote and stays as lineage; so do plan 02's
`45/45/0`, plan 04's `86/86/0`, plan 05's `134/134/0` and plan 06's `163/163/0`
(the last two both confirmed on ubuntu — run 33785233457 at PR #735 head
`f0d19bf7`, 232 s, and run 33794810067 at PR #736 head `ba6fe1e2`, 278 s).
Plan 07's `189/189/0` at `files 17/71` also stays as lineage — and so does its
ubuntu wall clock, run 33804312706 at PR #737 head `4a9f33da`, **458 s**, which
is the one run that reported `per-arm lane time: mean 1.7s` where every other
ubuntu run and every local run measured 1.0 s. Plan 08's `219/219/0` at
`files 23/71` stays as lineage too. ⚠️ CURRENCY 2026-09-04: Phase 164.4 plan 09
then annotated five NEW gate files — the wizard-session tenant-scope index, the
wizard composite fence, the weight-snapshot seed SECDEF trigger, the
csv-finalize auth guard and the resync-retry single-job substrate —
5 + 5 + 4 + 3 + 3 = 20 sections, so the measured corpus is now
`coverage: files 28/71`, `arms: 239/239/0`, `biting: 239`,
`lane-invocations: 239`, tallies agree, `FILES_FLOOR` is pinned at 28 and
`ARMS_FLOOR` at 239, with `pending: 12` idiom files still to go. That batch was
REDUCED from the six files it planned: `test_compute_jobs_error_kind_copy_parity
.sql` is un-baselineable until the pg-lane can host pg_cron, and the founder
chose to retire `[REDUNDER-PGCRON]` by putting pg_cron ON the lane as its own
plan rather than work around it — so that file stays in `pending:` alongside the
four already-deferred ones.
⚠️ CURRENCY 2026-09-04: plan 10 then annotated the LAST FOUR non-mixed idiom
files — the allocator pre-terminus equity flag, the enqueue_compute_job
non-terminal dedupe, the metrics_json_by_basis write shape and the
set_compute_job_progress claim fence — 2 + 2 + 2 + 2 = 8 sections, so the
measured corpus is now `coverage: files 32/71`, `arms: 247/247/0`,
`biting: 247`, `lane-invocations: 247`, tallies agree, `FILES_FLOOR` is pinned
at 32 and `ARMS_FLOOR` at 247, with `pending: 8` idiom files still to go: the
SEVEN ⚠️ mixed files plan 11 takes, plus the pg_cron-deferred one above.
⚠️ The phase's end state is therefore `files 39/71`, NOT the `40/71` of SCOPE
AMENDMENT #2 — that amendment predates plan 09's deferral. Note also that
`lane-blocked:` still names only FOUR files: the deferred fifth is blocked by a
migration in its APPLY LIST rather than by its own text, which `gateNeedsPgCron`
cannot see (TODOS `[REDUNDER-LANEBLOCKED-BLIND]`), so it is reported under
`pending:` and is pinned there as a tripwire.
⚠️ CURRENCY 2026-09-04: plan 11 then annotated the SEVEN ⚠️ mixed files — the
api_keys exchange lock, the strategy-keys publish-integrity delete guard, the
api_keys client-INSERT revoke, the sync-status protected marked refresh, the
wizard-draft update guard, the profiles privileged-column lock and the
wizard-session idempotency fence — 4 + 4 + 3 + 1 + 1 + 1 + 1 = 15 sections, so
the measured corpus is `coverage: files 39/71`, `arms: 262/262/0`,
`biting: 262`, `lane-invocations: 262`, tallies agree, `FILES_FLOOR` pinned at
39 and `ARMS_FLOOR` at 262, with **`pending: 1`** — exactly
`test_compute_jobs_error_kind_copy_parity.sql`, owed to Phase 164.4.1
PGCRON-LANE. That is Phase 164.4's END STATE on today's lane: every idiom gate
file the pg-lane can reach is annotated and proven, and the 32 files outside it
are printed by name on every run (27 `unreachable:` + 4 `lane-blocked:` +
that 1 `pending:`). ⛔ `pending:` is NOT empty and must not be made to look
empty — the parser test pins it as a one-name SET so an attestation of
completeness cannot be shipped ahead of 164.4.1.
⚠️ CURRENCY 2026-09-05: Phase **164.4.1 PGCRON-LANE** is now under way and the
paragraph above is 164.4's dated end state, not the current reading. Plan 01 put
pg_cron ON the pg-lane (`shared_preload_libraries` on the single `pg_ctl -o`
start, +0.009 s/lane); plan 02 then annotated the two files that were blocked in
the two DIFFERENT ways — `test_compute_jobs_error_kind_copy_parity.sql` (3
sections, blocked only through its APPLY LIST) and
`test_derive_allocator_keys_fanout.sql` (7 sections, blocked through its own
text). MEASURED at plan 02: `coverage: files 41/71`, `arms: 272/272/0`,
`biting: 272`, `lane-invocations: 272`, tallies agree, `FILES_FLOOR` 41 and
`ARMS_FLOOR` 272, `WAIVED_CEILING` still 0 (nine arms moves, zero waivers).
⛔ The `pending:` prohibition above is SUPERSEDED and its second clause is no
longer true: `pending:` is now measured EMPTY, deliberately, as CONTEXT decision
D-04's own task, and the parser test's pin is the empty set BESIDE an AIM (`it`
title `pending AIM (D-04)`) that proves the class is still computed by
classifying a stripped copy of a real gate. Do NOT "restore" the one-name pin.
⚠️ **Every `node scripts/mutation-runner/run.mjs` in this interval EXITS 1** with
exactly one defect, `lane-blocked-stale` — pg_cron is available while three
files (`test_reconcile_dropped_enqueue_sweep.sql`,
`test_retention_orphaned_running.sql`,
`test_strategy_analytics_stuck_computing_reaper.sql`) are still classified
`lane-blocked`. That is success criterion 3's tripwire doing its job, not a
regression; it clears when plan 05 lands. A run showing any OTHER defect kind IS
a regression.
✅ **CURRENCY 2026-09-05: THAT INTERVAL IS OVER — plan 05 landed and the full
corpus EXITS 0.** The paragraph above stays as the dated record of plans 01-04.
Measured at `b6b830cf`: `coverage: files 44/71`, `lane-blocked: 0 file(s)`,
`lane-probe: pg_cron AVAILABLE`, `  pending: 0`, `arms: 363/363/0`,
`biting: 363`, `lane-invocations: 363`, tallies agree, `✅ No defects`.
`FILES_FLOOR` is pinned at 44 and `ARMS_FLOOR` at 363 (not the 365 the plan
⚠️ SUPERSEDED 2026-09-05 by the phase REVIEW (`164.4.1-REVIEW.md`, CR-01/CR-02): `ARMS_FLOOR`
is **361**, not 363. Three arms of `test_reconcile_dropped_enqueue_sweep.sql` were found either
unfalsifiable or mutating the gate's own text where a production mutation reaches them; two were
reclassified as named INVARIANTs (never waived). `FILES_FLOOR` stays 44 and `WAIVED_CEILING`
stays 0. The floor moved DOWN because two arms had never been proven against a production
regression — read `run.mjs` for the live constants, never a number restated in prose.
projected — 324 + 39, read off the run). The last file was
`test_reconcile_dropped_enqueue_sweep.sql`, 39 sections, all 39 biting on the
first proof run. The class was emptied BY ANNOTATION: `parse.mjs`, the probe
fixture and the probe/defect code in `run.mjs` are untouched and SELF-TEST 17/17
still passes, so the tripwire stays live for any future unannotated pg_cron gate.
⚠️ The runner still PRINTS `lane-probe: pg_cron AVAILABLE — lane-blocked class is
STALE` while the class is empty; that sentence is now false-reading and plan 06
corrects it at the source. From here, a run that exits NON-ZERO is a regression.
`WAIVED_CEILING` is still 0, now through TWO founder decisions that both took
the root-cause fix over an exception: plan 08's trust-signal anon-EXECUTE
assertion was resolved by a REORDER putting the precondition ahead of its
dependants (TODOS `[REDUNDER-WAIVER-01]`), and plan 09's resync-retry assertion
(b) by wrapping its INSERT in the exception idiom the SAME FILE already used, so
that a narrowed unique index reports `TEST FAILED (b)` instead of a raw 23505
naming no arm. Read the run's own `coverage:` and `arms:` lines rather than any
number restated in prose.
✅ **CURRENCY 2026-09-05 (Phase 164.4.1 plan 06) — THE PHASE'S CLOSING READING.
Every paragraph above stays as dated lineage; this one is the current state.**
* **HOW pg_cron got onto the lane.** `scripts/pg-lane/run.sh` carries
  `shared_preload_libraries=pg_cron` (with `cron.database_name` and
  `cron.max_running_jobs=0` — the lane schedules nothing, it needs the catalog
  to exist) on its SINGLE `pg_ctl -o` start, and each affected gate's
  `RED-UNDER-SETUP` apply list carries migration
  `20260513094906_enable_pg_cron.sql`. **No migration was edited anywhere in
  this phase.** Cost measured, not assumed: +0.009 s/lane isolated,
  `per-arm lane time: mean 1.1s` at corpus scale.
* **What was annotated: five files, 103 sections** — the four that were
  `lane-blocked:` plus `test_compute_jobs_error_kind_copy_parity.sql`, the
  apply-list-blind fifth that had been sitting in `pending:`.
* **END STATE, read off the run:** `coverage: files 44/71`,
  `lane-blocked: 0 file(s)`, `lane-probe: pg_cron AVAILABLE`, `  pending: 0`,
  `arms: 363/363/0`, `biting: 363`, `lane-invocations: 363` (tallies agree),
  `✅ No defects`, **exit 0**. `FILES_FLOOR` 44, `ARMS_FLOOR` 363,
  `WAIVED_CEILING` still **0** — nine files' worth of arms moved, zero waivers
  added. 44 + 0 + 27 + 0 + 0 = 71; the 27 are `unreachable:`
  (`[REDUNDER-NONIDIOM]`, still open and still printed by name every run).
* ⛔ **Both `lane-blocked: 0` and `pending: 0` are pinned as MEASURED EMPTY SETS
  BESIDE AIMs, never as bare empty assertions.** The `pending` pin has
  `it("pending AIM (D-04)…")`, which classifies a stripped copy of a real gate
  to prove the class is still computed; the `lane-blocked` class stays DERIVED
  and its tripwire is proven by SELF-TEST 17/17 on a synthetic corpus. This
  **SUPERSEDES the ⛔ `pending:` is NOT empty sentence above** — do not "restore"
  the old one-name pin, and do not replace either AIM with a bare `toEqual([])`.
* **The tripwire fired and cleared, both observed.** FIRED on the
  pre-annotation tree (`164.4.1-TRIPWIRE-FIRED.log`), and SHA-bound on ubuntu in
  workflow run 33938272686 at `f04ce51b`, whose provisioning step answered
  RESEARCH's open question by measurement: `postgresql-16-cron` comes from
  **noble/universe, not PGDG**, major 16, `.so` and `.control` both present.
  CLEARED locally at plan 05 — exit 0, class empty — with nothing in the
  classifier, the probe fixture or the defect code touched to clear it.
* **Message honesty, plan 06:** the runner used to print "which the pg-lane
  cannot host … (deferred 2026-09-03)" unconditionally and "lane-blocked class
  is STALE" over an EMPTY class. Both were corrected at the source; each arm now
  says what it means for that run, and the grep prefixes ci.yml depends on are
  byte-identical. `[REDUNDER-PGCRON]` and `[REDUNDER-LANEBLOCKED-BLIND]` are
  both closed in `TODOS.md` with their reasoning — the second DELIBERATELY: its
  proposed fix would have classified UNANNOTATED files by a line only ANNOTATED
  files carry, i.e. dead code behind a passing test, so the limit is documented
  and pinned by a hand-built calibration instead.
* ⭐ **MEASURED 2026-09-05 — the SHA-bound ubuntu run of the FINISHED tree
  exists.** workflow_dispatch run **33961609382**, head sha
  **1aa8bb7088e978320041b6a97d187b8247b8fe3d**, `sql-mutation` **success in
  567 s (9.45 min)**. Ubuntu read IDENTICAL to the authoring box:
  `coverage: files 44/71`, `arms: 363/363/0`, `biting: 363`,
  `lane-invocations: 363`, `lane-blocked: 0`, `lane-probe: pg_cron AVAILABLE`,
  `✅ No defects`, `per-arm lane time: mean 1.1s`; pg_cron came from
  noble/universe at **1.6.2-1**. LEGS: 363 arms + 44 baseline + 44 restore =
  **451 legs**. `sql-mutation`'s `timeout-minutes` therefore **stays 15** by
  applying the rule literally — 9.45 min does not reach the ~10 min trigger,
  and when it is crossed the raise is to 20 ONCE (`ci.yml:933-953` carries this
  derivation). The 445 s of run 33938272686 is the PRE-annotation tree at 262
  arms and must not be read as a figure for this corpus.
  ⚠️ Every arm/file count in this bullet is that run's DATED reading at
  `1aa8bb70`, not a live constant: read `FILES_FLOOR` and `ARMS_FLOOR` off
  `scripts/mutation-runner/run.mjs` itself, since an arm reclassified after
  this date moves the floor without moving this paragraph.
  ⛔ From here, a run that exits NON-ZERO is a regression, not the tripwire.
Read the run's own `coverage:` and `arms:` lines rather than any number
restated in prose.
VAC-04 and VAC-08 have still not run against their real credential; see entries
25 and 26.

## Which database am I on? (ask FIRST, every time)

⛔ **This checkout's Supabase CLI is linked to PRODUCTION.** `supabase/.temp/project-ref` holds
the same ref `src/lib/test-safety.ts:26` pins as prod. So `supabase db push`, `db reset --linked`,
`--project-ref` and `--db-url` from this directory all target prod. The link is deliberate — the
pre-flight migration gates diff against PROD on purpose — so do not "fix" it by unlinking.

⛔ **`current_database()` is `postgres` on BOTH projects.** It proves nothing. Neither does a
green query, a familiar-looking table, or the dashboard's own chrome. Before any statement that
writes, run:

```sql
SELECT shobj_description(oid, 'pg_database') AS which_database
  FROM pg_database WHERE datname = current_database();
```

Each project carries a hand-set `COMMENT ON DATABASE` naming itself. If it comes back NULL, the
marker was lost — re-set it before writing, do not proceed on a guess.

Guard coverage, measured 2026-09-01: the TS/e2e path is safe (`assertNotProductionSupabaseUrl`
throws before any write via `getAdmin()`), and CI's `sql-tests` uses its own `TEST_SUPABASE_DB_URL`.
The **CLI** and the **browser SQL editor** have no automated guard at all. The marker above is the
only thing standing between a dashboard tab and production.

⚠️ TEST is SHARED with other people's CI. A write there is not private, and a global assertion
there is not reliable (see `FANOUT-GLOBAL-01` in TODOS.md).

## Design System
Always read DESIGN.md before making any visual or UI decisions.
All font choices, colors, spacing, and aesthetic direction are defined there.
Do not deviate without explicit user approval.
In QA mode, flag any code that doesn't match DESIGN.md.

## Skill routing

When the user's request matches an available skill, ALWAYS invoke it using the Skill
tool as your FIRST action. Do NOT answer directly, do NOT use other tools first.
The skill has specialized workflows that produce better results than ad-hoc answers.

Key routing rules:
- Product ideas, "is this worth building", brainstorming → invoke office-hours
- Bugs, errors, "why is this broken", 500 errors → invoke investigate
- Ship, deploy, push, create PR → invoke ship
- QA, test the site, find bugs → invoke qa
- Code review, check my diff → invoke review
- Update docs after shipping → invoke document-release
- Weekly retro → invoke retro
- Design system, brand → invoke design-consultation
- Visual audit, design polish → invoke design-review
- Architecture review → invoke plan-eng-review
- Save progress, checkpoint, resume → invoke checkpoint
- Code quality, health check → invoke health
- Tech debt, "what should we refactor", "code health", refactoring priorities, maintenance backlog → invoke engineering:tech-debt
- Architecture decision, ADR, "how should we architect", evaluate architecture, system design review → invoke engineering:architecture

## PR branches — always filter transient planning artifacts

`.planning/` is TRACKED here (see `.gitignore:53-63` — untracked planning silently
breaks parallel executor worktrees, which is not a preference but a GSD hard
requirement, `gsd-core CONFIGURATION.md:670`). The consequence is that PR diffs carry
PLAN/SUMMARY/CONTEXT/RESEARCH noise into review.

GSD's tool for that is `/gsd-pr-branch`. **Nothing invokes it automatically** —
`autonomous.md` has no ship step, and `ship.md` contains zero references to it. It runs
only when a human or agent types it. This section is what makes it run.

### The step

After `/ship` has committed and before opening the PR:

1. Run `/gsd-pr-branch`. It builds `<branch>-pr` from the base, cherry-picking code and
   structural planning commits (`STATE`, `ROADMAP`, `MILESTONES`, `PROJECT`,
   `REQUIREMENTS`, `milestones/**`) while dropping transient ones (`phases/`, `quick/`,
   `research/`, `threads/`, `todos/`, `debug/`, `seeds/`, `codebase/`, `ui-reviews/`).
2. **Run the deletion guard below. It is not optional.**
3. Open the PR from `<branch>-pr`, not from the working branch.

### ⛔ Deletion guard — upstream `pr-branch` over-deletes

Its cherry-pick loop runs `git rm -r --cached ".planning/$dir/"`, which is **not scoped
to the cherry-picked commit**. The PR branch is created from the base, so the index
already holds the base's phase artifacts, and that `rm` stages every one of them for
deletion. Measured on this repo 2026-08-26: **149 of 149** `.planning/phases/` files on
`main` staged for removal. Merging such a branch deletes them from `main`.

This is the same defect that cost 14 Phase 161.1 files in v0.74.0.0 — that was a
hand-rolled version of the same filter applied to a working branch tip.

Before pushing any `-pr` branch, prove it deletes nothing that exists on the base:

```bash
BASE=$(git rev-parse --abbrev-ref origin/HEAD | sed 's|origin/||')
git diff --diff-filter=D --name-only "$BASE".."$(git branch --show-current)" -- .planning/
```

Any output is a **STOP**. A PR branch must never delete a `.planning/` file that the
base already has. Re-create it with the `rm` scoped to the commit's own paths:

```bash
git diff-tree --no-commit-id --name-only -r "$HASH" \
  | grep -E '^\.planning/(phases|quick|research|threads|todos|debug|seeds|codebase|ui-reviews)/' \
  | xargs -r git rm -q --cached --ignore-unmatch
```

### What this does and does not buy

It cleans reviewers' diffs. It does **not** keep artifacts off the public repo — phase
dirs still reach `main` when `/gsd-complete-milestone` archives them into
`.planning/milestones/v{X.Y}-phases/`, which is structural and always preserved. That
archival is the intended destination; excluding artifacts from a PR is presentation, not
privacy. Upstream's `pr_strict` mode would change that, and it is not in the installed
version (local gsd-core `1.11.0` — `grep pr_strict` returns nothing).
