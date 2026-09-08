@AGENTS.md

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
there is NOT reliable — "no stuck jobs exist", "the table is empty" measure other people's rows
too. Assert about YOUR OWN rows.
⛔ `FANOUT-GLOBAL-01` is NOT a `TODOS.md` id (measured 2026-09-08: 0 hits). It exists only as
prose here and in the ROADMAP. **Phase 164.9 TESTISOLATION owns writing the real entry** — do not
send a planner looking for a spec that was never written.

## Test Coverage

`npm run test:coverage` → v8 report (text + HTML + JSON summary in `coverage/`).

**Blocking CI gate.** The vitest shards in `.github/workflows/ci.yml` run with `--coverage` and
emit blob reports; `frontend-coverage` merges them (`vitest run --merge-reports --coverage`) and
enforces the thresholds on full-suite numbers. The `frontend` aggregator gates on it.

⛔ **Read the live thresholds from `vitest.config.ts`, never from a number restated here.** They
are a RATCHET, set a few points under measured actual so a real regression fails CI but noise
does not. When actual climbs durably, raise them to match. Target is 80%, matching the
`--cov-fail-under=80` the `analytics-service/` Python suite enforces.

## SQL gate integrity jobs (v0.77.0.0, Phase 164.3)

The `frontend` aggregator gates more than coverage now. Three jobs in
`.github/workflows/ci.yml` are in both its `needs:` list and its result loop, so
a failure fails the aggregate rather than passing quietly:

- **`sql-mutation`** — mutates every SQL gate arm carrying a `RED-UNDER` annotation, asserts
  the file goes RED with that arm named, restores, asserts GREEN. Exits 1 on an annotation that
  does not bite, on coverage below a ratchet floor pinned at the measured value, on more waived
  arms than `WAIVED_CEILING` in `scripts/mutation-runner/run.mjs`, and when the runner's two
  independent arm tallies (`arms:` vs `lane-invocations:`) disagree. Runs on its own throwaway
  PostgreSQL cluster (`scripts/pg-lane/run.sh`), never against shared TEST — the lane carries
  `shared_preload_libraries=pg_cron` (Phase 164.4.1, +0.009 s/lane), so pg_cron gates run there.
  It prints, and MEASURE_FAILs on the absence of, a `lane-blocked:` line beside a `lane-probe:`
  line measured on the lane itself; pg_cron AVAILABLE with a NON-EMPTY lane-blocked class raises
  `lane-blocked-stale` and exits 1. That tripwire stays live for any future unannotated pg_cron
  gate even though the class is currently empty — it has been observed both firing and clearing.
- **`sql-gate-lint`** — four static rules over `supabase/tests`, each shipped
  with a red and a green fixture proving the rule can fire.
- **`plan-anchor-verify`** — re-resolves every `file:line` anchor and named
  symbol a pending PLAN.md asserts, and fails loud on a miss.

Two more gates live outside the aggregator: **VAC-04** (repo-vs-PROD function
body diff) is a step in `migration-drift-check.yml` on migration PRs, and
**VAC-08** (repo-vs-TEST ledger + body drift) runs in `sql-tests`. Both exit 1
when their credential is absent — neither ever skips.

### Current reading — 2026-09-07, Phase 164.7 (a DATED reading, not a constant)

`coverage: files 46/73` · `arms: 384/384/0` · `biting: 384` · `lane-invocations: 384` (the two
independent tallies AGREE) · `lane-blocked: 0 file(s)` · `lane-probe: pg_cron AVAILABLE` ·
`pending: 0` · `per-arm lane time: mean 1.1s` · `✅ No defects` · exit 0.
46 annotated + 0 lane-blocked + 27 `unreachable:` (`[REDUNDER-NONIDIOM]`, printed by name every
run) + 0 pending = 73.

⛔ **Read `FILES_FLOOR`, `ARMS_FLOOR` and `WAIVED_CEILING` by SYMBOL from
`scripts/mutation-runner/run.mjs` — never from a number restated in this file.** Prose and
constant have diverged here before (`ARMS_FLOOR` prose said 380, shipped value was 384); the
dated record of that correction is in `docs/sql-gate-lineage.md`.

⛔ **A run that exits NON-ZERO is a regression.** `WAIVED_CEILING` is **0** and has stayed 0
through two founder decisions that each took the root-cause fix over an exception — a REORDER
putting a precondition ahead of its dependants (`[REDUNDER-WAIVER-01]`), and wrapping an INSERT
in the exception idiom its own file already used, so a narrowed unique index reports a named arm
instead of a raw 23505. Do not add a waiver; fix the cause.

⛔ **Two floors, two layers.** `run.mjs` gates on `annotatedFiles < filesFloor` and
`bitingArms < armsFloor`, so a floor set BELOW the corpus is invisible to it by construction.
The stale-low direction is caught one layer up by `src/__tests__/mutation-runner-floors.test.ts`
(`RATCHET STALE: … but FILES_FLOOR is still …`). Separating a floor "in both directions" means
the runner for the upper and the vitest ratchet for the lower.

**`sql-gate-lint` also runs `scripts/lint-app-guc.mjs`** — self-test first, then the corpus scan,
both pasted verbatim as a developer runs them. It is a SIBLING of `lint-sql-gates.mjs`, not an
eighth rule of it, because that linter masks comments and string-literal contents while this gate
must COUNT comments (decision D-05). The corpus step is at **0 findings** with five files
annotated via a dated `-- APP-GUC-LINEAGE:` header AND an agreeing, count-pinned
`LINEAGE_ALLOWLIST` entry. ⛔ A red corpus step is a regression and is NEVER cleared by widening
the allowlist or relaxing `DETECT_RE`.

**Timeout.** `sql-mutation`'s `timeout-minutes` is **20** and stays there: the rule's one
permitted raise was taken on 2026-09-05 and 20 is a declared CEILING. A future crossing is
answered by `[REDUNDER-SUBSET-SPLIT]`, never by raising again (`ci.yml` carries the derivation).

📜 **Dated lineage for Phases 164.3 → 164.7 — every historical arm tally, ubuntu run id and
superseded CURRENCY paragraph — now lives in `docs/sql-gate-lineage.md`.** It is history; nothing
in it is a live constant.

## Design System
Always read DESIGN.md before making any visual or UI decisions.
All font choices, colors, spacing, and aesthetic direction are defined there.
Do not deviate without explicit user approval.
In QA mode, flag any code that doesn't match DESIGN.md.

## Skill routing

When the user's request matches an available skill, invoke it with the Skill tool as your FIRST
action. Do NOT answer directly, do NOT use other tools first.

⛔ **If this table and a founder decision recorded in memory disagree, the DECISION wins — and
fix this table in the same turn.** Measured 2026-09-08: this table still said `ship` and `review`
months after both were reversed, and it listed a `checkpoint` skill that does not exist on disk.
A stale table here outranks a correct memory, because this file loads into every session.

Routing:
- Feature/milestone work, planning → `gsd-plan-phase` / `gsd-execute-phase` (see the GSD rules below)
- Ship, deploy, push, create PR → **`gsd-ship`** (REVERSED 2026-09-02 — not gstack `/ship`; the specialist reviewers were ported into it)
- Per-phase code review → **`gsd-code-review`** (+ `gsd-verify-work`). Standard GSD only per phase; save the big review for milestone end
- Bugs, errors, "why is this broken", 500 errors → `investigate`
- QA, test the site, find bugs → `qa`
- Product ideas, "is this worth building" → `office-hours`
- Update docs after shipping → `document-release`
- Weekly retro → `retro`
- Design system, brand → `design-consultation`; visual audit → `design-review`
- Architecture review → `plan-eng-review`; ADR / system design → `engineering:architecture`
- Tech debt, code health, refactoring priorities → `engineering:tech-debt`
- Code quality / health check → `health`

## GSD orchestration rules (measured 2026-09-08 — both of these cost time this session)

⛔ **Never dispatch a `gsd-*` agent yourself. Run the WORKFLOW'S dispatch step, preamble
included.** Invoking the Skill is NOT sufficient — you can invoke it and then hand-dispatch from
inside it, which is what happened. In `execute-phase` the preamble resolves isolation via
`gsd_run query dispatch-isolation`, and that call's SIDE EFFECT is writing
`.gsd/dispatch-isolation-sentinel.json`, which the isolation guard hooks read. Skip it and the
guard refuses the dispatch with a message that looks like a config bug and is not.
Recovery: `worktree.reap-orphans`, honour `worktree.base-check` (it auto-degrades to `none` when
`origin/HEAD` has diverged from `HEAD` — correct, since a harness worktree forks from
`origin/HEAD` and would lack the branch's work), then
`record-dispatch-isolation --isolation <verdict> --phase <n>`.
⚠️ `inspect-dispatch-isolation` reports the HOST CAPABILITY, not the recorded verdict — read the
sentinel FILE to confirm.

⛔ **`gsd-tools` state handlers CLOBBER `STATE.md` and `ROADMAP.md`.** `state.advance-plan`
returns an error AND WRITES ANYWAY; `roadmap.update-plan-progress` injects stray bullets into
unrelated phase sections. Both were hit in this repo. Prefer hand-editing those two files; if you
use a handler, `git diff` the result and revert every collateral change before committing.
Note `state.add-roadmap-evolution` also recomputes the `progress:` block from local disk as an
undocumented side effect — that count under-reports phases whose `.planning/phases/` artifacts the
`-pr` filter stripped from `main`.

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

### ⛔ Reviewers run BEFORE the filter — and `/gsd-update` will silently undo this

**Rule: the specialist/automated review pass runs on the WORKING branch, before
`filter_planning_artifacts` builds the `-pr` branch.** Only the human reviewer-request
prompt may run after the PR exists, because only that one needs a PR number.

⚠️ MEASURED 2026-09-07 (Phase 164.2.1, PR #752), all three of these happened in one run:

1. **Fixes landed on the wrong branch.** `filter_planning_artifacts` ends by checking out the
   `-pr` branch and only returns via its own final `git checkout "$CURRENT_BRANCH"`. Miss that
   line and every subsequent agent edits the derived `-pr` head, while the working branch —
   the one carrying the full history — receives nothing.
2. **A fixer could not find the file it was told to fix.** The filter strips
   `.planning/phases/` from the `-pr` branch by design, so an agent asked to correct
   `SECURITY.md` / `VERIFICATION.md` found no such path. It recovered only by building its own
   worktree; the naive outcome is a fixer reporting "file not found" or, worse, recreating the
   file empty.
3. **The PR body described a tree that no longer existed.** `generate_pr_body` runs before the
   fixes, so the PR narrated the pre-fix state and the fixes needed a force-push or trailing
   commits on an open PR.

**The global workflow was rewired on 2026-09-07** — `~/.claude/gsd-core/workflows/ship.md` now
has a `specialist_review` step positioned before `filter_planning_artifacts`, and the
success criteria assert the ordering plus a post-filter `git branch --show-current` check.

⛔ **That edit lives in the GLOBAL install and `/gsd-update` OVERWRITES it.** This has already
cost the same file its `optional_review` specialist edit once before. After every
`/gsd-update`, re-apply it: move the `**Specialist reviewers…**` and
`**External code review command…**` blocks out of `optional_review` into a new
`specialist_review` step placed immediately before `<step name="filter_planning_artifacts">`,
leaving only `**Manual review options:**` behind. A pre-rewire backup is kept at
`~/.claude/gsd-core/workflows/ship.md.bak-preview-reorder` for diffing.

**Cheap check that the ordering survived:**

```bash
grep -n '^<step name=' ~/.claude/gsd-core/workflows/ship.md \
  | grep -E 'specialist_review|filter_planning_artifacts'
```

`specialist_review` MUST print a lower line number than `filter_planning_artifacts`. If it is
missing entirely, `/gsd-update` has reverted the rewire.
