---
phase: 158-ops-ci-a-merge-means-a-deploy
plan: 05
subsystem: testing
tags: [playwright, e2e, ci, supabase, seed-env]

requires:
  - phase: 158-ops-ci-a-merge-means-a-deploy
    provides: "158-RESEARCH.md §OPS-03 orphan census; 158-PATTERNS.md seeded-spec contract"
provides:
  - "HALT RECORD ONLY — no spec files were created or modified"
  - "Measured precondition census: exactly which env each of the 4 orphan specs needs, and where it does/does not exist"
affects: [158-06, OPS-03]

actuals:
  tokens: 3600
  tasks: 0
  commits: 1

tech-stack:
  added: []
  patterns: []

key-files:
  created:
    - .planning/phases/158-ops-ci-a-merge-means-a-deploy/158-05-SUMMARY.md
  modified: []

key-decisions:
  - "HALTED at Task 1 precondition: no runnable local Playwright environment exists in the worktree, and making one requires provisioning production-pulled secrets into a PUBLIC repo worktree — a side-effecting act, not a read-only precondition check."
  - "HALTED at Task 2 precondition: TEST_SUPABASE_URL / TEST_SUPABASE_SERVICE_ROLE_KEY are GitHub Actions secrets only; they exist nowhere on this machine under those names."
  - "Refused the tempting shortcut of repairing specs by source-reading alone. Task 1's method is empirical (run -> classify -> repair) and its acceptance criteria demand per-file executed-case reporter evidence. Blind edits would produce a SUMMARY claiming unverifiable repairs, and plan 06 would then wire never-verified specs into a BLOCKING CI batch — the exact failure this plan's objective exists to prevent."

patterns-established: []

requirements-completed: []

coverage:
  - id: D1
    description: "Repair the four named orphan specs so each executes >=1 real case (Task 1)"
    requirement: "OPS-03"
    verification: []
    human_judgment: true
    rationale: "NOT DELIVERED — halted at precondition. No runnable environment; nothing to verify."
  - id: D2
    description: "Author e2e/my-strategies.spec.ts, the NAV-01 surface (Task 2)"
    requirement: "OPS-03"
    verification: []
    human_judgment: true
    rationale: "NOT DELIVERED — halted at precondition. Seed env absent, so the executed-arm polarity could never be observed."

duration: 9min
completed: 2026-08-20
status: halted
---

# Phase 158 Plan 05: Orphan e2e spec repair — HALTED AT PRECONDITION

**No spec files were written. Both tasks' `<precondition>` elements evaluated UNMET: this worktree has no runnable Playwright environment, and the seeded-e2e credentials the plan requires are CI-only secrets that exist nowhere locally.**

## Performance

- **Duration:** ~9 min (reconnaissance + precondition evaluation only)
- **Started:** 2026-08-20T15:51:00Z
- **Completed:** 2026-08-20T16:00:45Z
- **Tasks:** 0 of 2 completed
- **Files modified:** 0 (this SUMMARY is the only artifact)

## Why this halted

The executor contract requires evaluating each task's `<precondition>` **before** any other task
work, using read-only checks, and halting rather than self-provisioning when unmet. Both failed.

### Task 1 precondition — UNMET

> "A local Playwright run is possible: node_modules installed (npm ci if absent), Playwright
> browsers installed, and the app server strategy defined by playwright.config.ts is available"

| Leg | Status | Evidence |
|---|---|---|
| `node_modules` | Absent, but **satisfiable** | `ls -d node_modules` -> absent. `npm ci` is explicitly sanctioned by the plan and by 158-RESEARCH.md:284. Not the blocker. |
| Playwright browsers | **Met** | `~/Library/Caches/ms-playwright` holds `chromium-1234` et al. |
| App server available | **BLOCKER** | `playwright.config.ts:26-33` webServer runs `npm run dev` at :3000. No server is running (`curl` -> 000). The worktree contains **only `.env.example`** — no `.env.local`, no `.env.development.local`. A dev server booted here has no Supabase URL, so every DB-backed page and API route under test fails on missing config. |

Making that leg true requires copying secret-bearing env files from the main checkout into this
worktree. That is not a read-only check, and it is actively hazardous:

- **`/Users/helios-mammut/claude-projects/quantalyze/.env.local` is a PRODUCTION pull** —
  `VERCEL_ENV="production"`, `VERCEL_TARGET_ENV="production"`, `NEXT_PUBLIC_APP_URL=https://quantalyze-rho.vercel.app`,
  and it carries the PROD `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`, `ANALYTICS_SERVICE_KEY`,
  and PROD Upstash Redis credentials. It contains **zero** references to the TEST project ref.
- The phase constraints forbid running specs against PROD.
- **This repo is PUBLIC and I was about to `git add` in this worktree.** Staging production
  secrets into a world-readable tree is threat T-158-17 in this plan's own register
  (Information Disclosure, severity **high**).
- **`csv-upload-flow.spec.ts` is a live foot-gun under ambient env.** Lines 78-81 and 316-319 read
  `process.env.SUPABASE_TEST_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL` and
  `SUPABASE_TEST_SERVICE_ROLE_KEY ?? SUPABASE_SERVICE_ROLE_KEY`. With no `SUPABASE_TEST_*` set,
  it silently seeds against **whatever ambient Supabase is configured, with the ambient
  service-role key**. Run with the main tree's `.env.local` in scope, that is production.

### Task 2 precondition — UNMET

> "Seeded-e2e env available locally: the env vars named by the HAS_SEED_ENV constant in
> e2e/wizard-resume.spec.ts resolve, pointing at the TEST project (qmnijlgmdhviwzwfyzlc)"

`HAS_SEED_ENV` (wizard-resume.spec.ts:40-42) requires `TEST_SUPABASE_URL` and
`TEST_SUPABASE_SERVICE_ROLE_KEY`. Measured:

- Neither is set in the executor's environment (`env | grep -c` -> `0` for both).
- Neither name appears in any local env file. `.env.test.local` holds only
  `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY`
  (it *does* point at the TEST project, but not under the names the constant reads).
- In CI they are **GitHub Actions secrets** — `secrets.TEST_SUPABASE_URL` /
  `secrets.TEST_SUPABASE_SERVICE_ROLE_KEY` (`ci.yml:1662, 1847-1849`), gated on
  `vars.E2E_TEST_DB_CONFIGURED`.

Self-provisioning by exporting the service-role key out of `.env.test.local` under the required
names would fabricate the very precondition the plan asked me to *verify*, while handling a
service-role credential unsupervised. Unmet preconditions are never auto-approved.

### The shortcut I deliberately refused

I could have hand-edited selectors by reading source and declared the specs "repaired". I did not,
because Task 1's acceptance criteria demand reporter evidence of `>=1` passed non-skipped case
**per file**, and Task 2's demand observing **both polarities** (executed under seed env, skipped
without). Without an environment I can only ever observe the skip arm — which is precisely the
"a test that cannot fail is worse than none" vacuity this project forbids. Worse, plan 06 consumes
this SUMMARY's batch verdicts to wire these specs into a **blocking** batch; verdicts invented
without a run would convert spec-rot into a red `frontend` aggregator on unrelated PRs, which is
the stated reason this plan exists separately from plan 06 at all.

`status: halted` is set deliberately so plan 06 is machine-reported as **blocked** rather than
proceeding on fabricated input.

## Reconnaissance gathered (valuable for the resumed run)

This survives the halt and should spare the retry the discovery cost.

### Orphan status confirmed at HEAD

- `grep -rn 'api-key-flow\|sync-analytics-flow\|full-flow\|csv-upload-flow' .github/workflows/ci.yml`
  -> **no output**. All four are genuinely unwired; the census in 158-RESEARCH.md §OPS-03 holds.
- `grep -rn 'my-strategies' e2e/` -> **no output**; `e2e/my-strategies.spec.ts` does not exist.
  Confirms it is a NEW file, as the plan states.

### Per-spec env census (measured, not inferred)

| Spec | Env its gated cases require | Exists in ci.yml? | Consequence once wired |
|---|---|---|---|
| `api-key-flow.spec.ts` | `PLAYWRIGHT_TEST_STRATEGY_ID`; `PLAYWRIGHT_TEST_EXCHANGE_KEY` + `_SECRET` | **No** | Its two gated describes self-skip. Only the anon "API endpoint contract" describe (`:27`) can execute. |
| `sync-analytics-flow.spec.ts` | `PLAYWRIGHT_TEST_STRATEGY_ID`; `PLAYWRIGHT_TEST_SLUG` | **No** | Three gated describes self-skip. The anon "Sync API endpoint contract" (`:33`) and "Discovery pages require authentication" (`:328`) describes are the executable coverage. |
| `full-flow.spec.ts` | `E2E_TEST_EMAIL`, `E2E_TEST_PASSWORD` | **No** | Matches the planner's recorded skipped-by-design decision. "Public browsing flow" (`:16`) is the executable half. |
| `csv-upload-flow.spec.ts` | `SUPABASE_TEST_URL` / `SUPABASE_TEST_SERVICE_ROLE_KEY`, **with a fallback to ambient** | Yes, at `ci.yml:1230-1231`, but only when `vars.E2E_TEST_DB_CONFIGURED == 'true'`, else `''` | Seeded batch. Note `'' ?? x` returns `''` (empty string is not nullish), so in CI it gets an empty URL rather than falling through — the fallback only bites **locally**. |

**Provisional batch verdicts** (to be CONFIRMED by an actual run, not adopted as-is): the first
three look unseeded-batch-safe once their anon cases are repaired; `csv-upload-flow` is
**seeded**. Plan 06 must not treat this row as settled — the plan requires these verdicts be
derived from what each repaired spec actually needs, and no spec has been repaired.

## Task Commits

No task commits — no task reached execution.

**Halt record:** this SUMMARY (`docs(158-05)`).

## Deviations from Plan

None. The plan was not executed; it stopped at its own first gate exactly as the precondition
mechanism specifies.

## Issues Encountered

The plan's preconditions were written as verifiable gates but the environment to satisfy them was
never provisioned for a worktree agent. 158-RESEARCH.md:284 anticipated the `node_modules` half
("GSD worktree agents get NO node_modules — the executor must `npm ci` or run from the main
tree") but no plan or research artifact supplies a recipe for a TEST-pointed dev server plus seed
credentials inside a worktree. That gap is the halt's root cause, and it will recur for any future
plan that asks a worktree agent to run seeded e2e specs.

## User Setup Required

To unblock this plan, a human must provide a runnable, TEST-pointed e2e environment. Options,
cheapest first:

1. **Re-run this plan in the main checkout, not a worktree** (`isolation: none`), where
   `.env.development.local` already points at the TEST project — then export the two seed vars
   for the run:
   `export TEST_SUPABASE_URL=...` / `export TEST_SUPABASE_SERVICE_ROLE_KEY=...`
   sourced from `.env.test.local` (which holds TEST-project values under different names).
   Confirm `npm ci` has been run and `npm run dev` serves :3000.
2. **Provision the two vars into the worktree environment** and copy `.env.development.local`
   (TEST-pointed) — explicitly **not** `.env.local` (production) — into the worktree, with a
   `.gitignore` check first. Higher risk; option 1 is preferred.

Before either: confirm no CI run is in flight against the shared TEST project. Project memory
records that a local suite racing CI reds `sql-tests`, and that concurrent writers to the shared
TEST DB are this very phase's subject matter.

**Do not** provision `E2E_TEST_EMAIL` / `E2E_TEST_PASSWORD` — the plan's recorded decision is that
`full-flow`'s authed half stays skipped-by-design with no new CI secrets.

## Next Phase Readiness

- **Plan 06 is BLOCKED on this plan.** It consumes the per-spec batch verdict table as direct
  input and must not re-derive or invent it. The provisional table above is reconnaissance, not a
  verdict.
- No repository state was changed, so there is nothing to revert. A retry starts clean from the
  same base.

---
*Phase: 158-ops-ci-a-merge-means-a-deploy*
*Halted: 2026-08-20*
