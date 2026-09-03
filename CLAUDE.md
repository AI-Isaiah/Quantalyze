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
`30/30/0` is the run-33620169220 quote and stays as lineage. Phase 164.4 plan 02
closed the reference file's 15 un-twinned sections, so the measured corpus is now
`arms: 45/45/0`, `biting: 45`, `lane-invocations: 45`, tallies agree, and
`ARMS_FLOOR` is pinned at 45. Read the run's own `arms:` line rather than any
number restated in prose. VAC-04 and VAC-08 have still
not run against their real credential; see entries 25 and 26.

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
