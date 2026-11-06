# Phase 158: OPS-CI — A merge means a deploy - Research

**Researched:** 2026-08-20
**Domain:** GitHub Actions CI reliability (concurrency/mutex, workflow_run watchers), shared TEST Supabase hygiene, vitest test isolation, Playwright CI batching
**Confidence:** HIGH — nearly every claim below was read out of the repo at HEAD this session (file:line + verbatim quotes); the two external claims (GitHub `workflow_run` semantics, `ben-z/gh-action-mutex` capabilities) were verified against their live docs pages this session.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
(CONTEXT.md has no `## Decisions` section — all choices are at Claude's discretion, bounded by the binding corrections below.)

### Claude's Discretion
All implementation choices are at Claude's discretion — pure infrastructure phase. Bind to the ROADMAP success criteria and the research corrections already folded into REQUIREMENTS.md:

- **OPS-01 fix shape is binding:** external FIFO mutex for DB-touching jobs + a `cancelled`-conclusion watcher. ⚠️ Shrinking the `shared-test-db` concurrency group is NOT acceptable (eviction is cross-run). ⚠️ Do NOT add more `needs:` edges to "finish the chain" (the `if:` conditions diverge on `workflow_dispatch` and it would disable `e2e-seeded` on every manual run). The mutex needs a TTL/steal path and a documented manual-unlock runbook as part of adoption. Close #616 on the MECHANISM. Verification must simulate THREE concurrent runs, not two.
- **OPS-04 constraints are hard:** the drain is TEST-only — ⛔ never a migration, ⛔ never `cron.unschedule(9)`.
- **OPS-11:** fix the unrestored `vi.stubGlobal`/`vi.mock` root cause (`vi.spyOn` + `restoreAllMocks` pattern per prior CI-Node22 findings), not retried away.

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| OPS-01 | `shared-test-db` group no longer evicts queued main-branch jobs; #616 closed on the fix (external FIFO mutex + `cancelled`-conclusion watcher) | §OPS-01: exact DB-touching jobs w/ line numbers; mutex backend survey with recommendation; watcher trigger shape + permission uplifts; the pattern file to copy; 3-run verification recipe |
| OPS-02 | `sql-tests` is in an aggregator's `needs:` | §OPS-02: the one aggregator (`frontend`) with exact `needs:` list and result-loop; the `if:` divergence table proving which skip-tolerance arm `sql-tests` needs |
| OPS-03 | Orphaned e2e specs (incl. the NAV-01 surface) run in a CI batch; DB-types drift gate OR recorded decision | §OPS-03: full 20-spec orphan census with seed/skip classification; the 4 specs + new NAV-01 spec the requirement anchors on; both CI batch mechanisms; DB-types generation reality incl. the hand-patched block that breaks naive regen gates |
| OPS-04 | TEST stale-`pending` drained TEST-only; `test_compute_jobs_fencing.py` stamps `claimed_at` in its two direct UPDATEs | §OPS-04: the two exact UPDATEs (:1148, :1200); the backlog mechanism verified at HEAD incl. the already-landed `p_kind_include` fix (re-measure!); drain shape options that honor both ⛔s; reaper predicate proof |
| OPS-11 | `MultiKeyConnectStep` order-sensitive flake root-caused, not retried away | §OPS-11: file inventory; harness state at HEAD (unstubGlobals landed AFTER the flake record — reproduce first); DEF-16-1 remedy pattern citation; reproduction recipe |
</phase_requirements>

## Summary

This phase is five verified defects in CI/test infrastructure, each already root-caused to a mechanism — the planner's job is sequencing and verification, not discovery. The central item (OPS-01) replaces GitHub's native `shared-test-db` concurrency group (which holds at most one running + one pending entry globally and **evicts** the pending entry when a third request arrives, concluding `cancelled`/grey and making Railway silently skip the analytics deploy — GitHub issue #616, still OPEN) with an external FIFO mutex on the three DB-touching jobs, plus a `workflow_run` watcher that turns a `cancelled` main-run conclusion into a loud dedup'd issue (pattern already in-repo at `analytics-deploy-verify.yml:111-137`).

Two findings materially update the ledger claims the requirements were written from, and the planner must build "re-measure at HEAD" steps around both: (1) the OPS-04 "exactly-10 deterministic red" was **structurally fixed on 2026-08-12** (PR #674, `c726a250`) by scoping the fencing tests' claim RPC with `p_kind_include` — the drain is still owed (the TEST backlog is real, unbounded-growth hygiene: thousands of permanently-`running` rows and a daily pending refill), but the drain's acceptance criterion cannot be "the 10 reds disappear" because they likely already have; (2) the OPS-11 flake was recorded 2026-07-30, and the harness gained `unstubGlobals: true` + `unstubEnvs: true` + an env-snapshot restore + a leak-canary test in Phase 140.5 (`vitest.config.ts:68-69`) — the flake may already be closed by that mechanism, so the plan must attempt reproduction at HEAD before "fixing" anything.

**Primary recommendation:** implement the FIFO mutex as a Postgres session-scoped advisory lock against the TEST project itself (creds already in CI; automatic release on job cancellation is a built-in steal path — the axis where the third-party lock actions are weakest), keep the `cancelled`-watcher as a separate `workflow_run` workflow copying the `analytics-deploy-verify.yml` dedup'd-issue block, and make every gate change observable RED before trusting it (founder rule: a test that cannot fail is worse than none).

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Cross-run serialization of DB-touching jobs (OPS-01) | CI workflow layer (`ci.yml` job steps) | TEST Postgres (if advisory-lock backend chosen) | The eviction lives in GitHub's concurrency-group layer; the replacement must live where all contending runs can reach it |
| `cancelled`-conclusion detection (OPS-01) | New standalone workflow (`workflow_run` trigger) | GitHub Issues (signal channel) | Must survive the death of the run it observes; `workflow_run` fires on the default branch independent of the cancelled run |
| Gate aggregation (OPS-02) | `ci.yml` `frontend` aggregator job | — | The only aggregator; branch protection (deferred) and human triage both key on it |
| e2e batching (OPS-03) | `ci.yml` `e2e` / `e2e-seeded` job spec lists | Playwright specs (self-skip gates) | Spec lists are hand-maintained shell invocations, not globs — the orphaning mechanism IS the list |
| DB-types freshness (OPS-03) | Decision + (optionally) a path-triggered workflow | Supabase CLI `gen types` | Generated file has a hand-patched block; a naive regen gate self-destructs (see below) |
| TEST backlog drain (OPS-04) | One-off guarded script / orchestrator MCP against TEST | TEST pg_cron (source of refill — read-only, never unscheduled) | Data intervention on one environment; ⛔ migrations auto-apply to PROD so a migration is banned |
| Test-suite state isolation (OPS-11) | vitest config + individual spec hygiene | — | Config-level fences landed in 140.5; residual leaks are per-file |

## Standard Stack

### Core (no new packages — everything is already in the repo or on the runner)
| Tool | Version | Purpose | Why Standard |
|------|---------|---------|--------------|
| GitHub Actions (`ci.yml` etc.) | n/a | All five requirements touch workflows | Existing CI |
| `actions/github-script` | `3a2844b7…` (v9.0.0, SHA-pinned) | Watcher's dedup'd-issue block | Already used by `analytics-deploy-verify.yml:114` — copy the pin |
| `psql` (postgresql-client) | apt, installed per-job | Advisory-lock mutex + drain option (b) | `sql-tests` already installs it in CI (`ci.yml:947-950`) |
| `gh` CLI | 2.92.0 local | Verification (dispatch runs, poll conclusions) | Available locally; `GITHUB_TOKEN` in CI |
| Playwright | repo-pinned | OPS-03 spec batches | Existing |
| vitest | 4.1.10 | OPS-11 | Existing (`unstubGlobals` verified against installed typings per leak-canary docblock) |
| pytest | repo-pinned | OPS-04 stamps | Existing; ⚠️ run only from `analytics-service/` (VCR cassettes) |
| Supabase CLI | 2.84.2 local / `setup-cli` v2.1.1 @ 2.98.2 in CI | OPS-03 types decision | `migration-drift-check.yml:48` pins `supabase/setup-cli@3c2f5e2a… # v2.1.1` |

### Alternatives Considered (OPS-01 mutex backend — the one real decision)

| Option | FIFO fairness | TTL / steal | Cancelled-mid-hold behavior | Manual unlock | Verdict |
|--------|--------------|-------------|------------------------------|---------------|---------|
| **Postgres session advisory lock on TEST DB (recommended)** | Postgres grants lock waiters in queue (arrival) order `[ASSUMED — PostgreSQL lock-manager behavior, training knowledge]` | TTL = `timeout-minutes` on the DB jobs (bounds hold time); steal = automatic — a killed/cancelled job's TCP session drops and Postgres releases the lock | **Auto-release** (session death releases session-scoped advisory locks) | `SELECT pg_terminate_backend(pid)` on the holder — same primitive as the repo's existing wedged-PostgREST runbook | **Use this.** Creds already in CI (`secrets.TEST_SUPABASE_DB_URL`); no third-party code; strongest on the cancellation axis, which is exactly the failure mode being fixed |
| `ben-z/gh-action-mutex` | Not strictly FIFO (git-ref spinlock) | **None documented; alpha (`v1.0.0-alpha.10`)** `[VERIFIED: github.com/ben-z/gh-action-mutex README, fetched this session]` | Unspecified — a killed holder leaks the queue entry on the mutex branch; waiters spin forever | Delete/reset the `gh-mutex` branch | Fails the adoption requirement (TTL/steal) without wrapping; alpha third-party action with push rights to a repo branch |
| `softprops/turnstyle` | Waits on *older runs of the same workflow* — effectively run-creation order | `continue-after-seconds` / `abort-after-seconds` | Waiter death is clean (it only polls); holder is just "a run in progress" | n/a | Serializes whole *runs*, not the three DB jobs — a DB job would wait on another run's unrelated jobs; polling burns API quota; wrong granularity |
| Keep native group + more `needs:` edges | — | — | — | — | ⛔ **Banned by CONTEXT** — `if:` divergence disables `e2e-seeded` on `workflow_dispatch` (trap already caught once, `ci.yml:926-933`) |
| Shrink the group | — | — | — | — | ⛔ **Banned by CONTEXT** — eviction is cross-run; membership count only changes how fast three simultaneous runs arrive |

⚠️ **The one hard prerequisite check for the advisory-lock option:** the documented DSN shape is the **pooler at port 6543** — `ci.yml:1015`: `"Format: postgresql://postgres.<project-ref>:<password>@<pooler-host>:6543/postgres"`. Transaction-mode pooling does not preserve session state across statements, so a session advisory lock through a transaction-mode pooler is unreliable `[ASSUMED — Supavisor transaction-mode semantics; session mode is served on port 5432]`. The plan MUST include a probe task: hold `pg_advisory_lock` from one connection, verify a second connection blocks, using the session-mode port (5432 on the same pooler host, or the direct connection). If session mode is unreachable from CI, fall back to `ben-z/gh-action-mutex` wrapped with an explicit timeout + the branch-delete runbook (and record the alpha-pin risk).

**Installation:** none — no npm/PyPI/crates packages are added by this phase.

## Package Legitimacy Audit

No registry packages are installed by this phase. The only third-party code candidate is the GitHub *Action* `ben-z/gh-action-mutex` (not an npm dependency): alpha-stage (`v1.0.0-alpha.10`), no TTL, undocumented cancellation behavior `[VERIFIED: repo README fetched this session]`. If adopted despite the recommendation above, it must be pinned by full commit SHA with a version comment per the repo convention (`.github/workflows/*` all pin by SHA), and treated as `[SUS]`-equivalent: a `checkpoint:human-verify` before first use. The recommended advisory-lock approach uses zero third-party code.

**Packages removed due to [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** `ben-z/gh-action-mutex` (GitHub Action, only if the fallback is taken)

## OPS-01 — FIFO mutex + cancelled-conclusion watcher

### The exact DB-touching jobs (the `shared-test-db` group members)

All three carry the identical block, verbatim `group: shared-test-db` / `cancel-in-progress: false`:

| Job | Job def | Concurrency block | `if:` condition |
|-----|---------|-------------------|-----------------|
| `sql-tests` | `ci.yml:833` | `ci.yml:936-938` | `ci.yml:880`: `if: (github.event_name == 'push' \|\| github.event.pull_request.head.repo.full_name == github.repository) && vars.E2E_TEST_DB_CONFIGURED == 'true'` |
| `python` | `ci.yml:1132` | `ci.yml:1143-1145` | **none** (always runs; live-DB tests self-skip via env demotion at `ci.yml:1230-1232`) |
| `e2e-seeded` | `ci.yml:1498` | `ci.yml:1540-1542` | `ci.yml:1519`: `if: ${{ (github.event_name != 'pull_request' \|\| github.event.pull_request.head.repo.full_name == github.repository) && vars.E2E_TEST_DB_CONFIGURED == 'true' }}` |

`sql-tests` also carries `needs: [python]` (`ci.yml:934-935`) — the 2026-08-03 *intra*-run fix. Its ⛔ comment (`ci.yml:906-933`) is the authoritative in-repo statement of the eviction mechanism and both banned "fixes"; quote (`:908-910`): *"GitHub Actions holds exactly ONE pending entry per concurrency group: 'Any previously pending job or workflow in the concurrency group will be canceled.'"* The victim *"is CANCELLED, which renders as a GREY check, not a red one"* (`:914`).

The top-of-file group (`ci.yml:39-41`) is separate and stays untouched: `group: ci-${{ github.workflow }}-${{ github.head_ref || github.run_id }}` with `cancel-in-progress: true` — per-PR force-push cancellation only.

### Fix shape (mutex half)

1. **Remove** the three `concurrency: shared-test-db` blocks (the eviction lives in that layer; anything left of it retains the bug).
2. **Add a mutex-acquire step at the top of each of the three jobs** (and release via auto-disconnect at job end): a background session-mode `psql` connection that runs `SELECT pg_advisory_lock(<constant key>)` and stays alive for the job's duration (steps within a job share the runner, so a `nohup`'d process persists across steps). Waiters block inside `pg_advisory_lock` in arrival order.
3. **TTL:** set `timeout-minutes` on all three jobs (e.g. 30) — that bounds the maximum hold; GitHub kills the job, the session drops, the lock releases. This *is* the steal path; no cron needed.
4. **Fork-PR arm:** on fork PRs the secret is withheld; the acquire step must no-op when `TEST_SUPABASE_DB_URL` is empty — which is safe because on forks the DB-touching work itself already self-skips (`sql-tests` `if:` excludes forks; `python`'s live-DB tests skip via the `E2E_TEST_DB_CONFIGURED` env demotion; `e2e-seeded` `if:` excludes forks).
5. **`needs: [python]` on `sql-tests`:** keep it. It no longer carries group-correctness weight once the group is gone, but it keeps one fewer simultaneous waiter and its removal buys nothing. Do NOT add any new `needs:` edges (banned).
6. **Manual-unlock runbook** (adoption requirement, ships in the same phase): `docs/runbooks/` is the established home (`docs/runbooks/seam-breaker.md` exists). Contents: how to find the holder (`SELECT pid, ... FROM pg_stat_activity WHERE query LIKE '%pg_advisory_lock%'` / `pg_locks` join), `SELECT pg_terminate_backend(pid)`, and the note that terminating the holder makes the next waiter proceed immediately. Precedent for the primitive: the wedged-PostgREST remedy already uses `pg_terminate_backend` on TEST.

⚠️ Wall-clock note for the plan: with the group gone, contending runs now *start* their DB jobs and wait on the lock, burning runner wall-clock instead of pending in GitHub's queue. That is the intended trade (queued-and-alive beats evicted-and-grey).

### Watcher half (`cancelled`-conclusion → loud signal)

- **Trigger:** new workflow, `on: workflow_run: workflows: ["CI"], types: [completed]` (the `name:` at `ci.yml:1` is exactly `CI`), body-gated on `github.event.workflow_run.conclusion == 'cancelled' && github.event.workflow_run.head_branch == 'main' && github.event.workflow_run.event == 'push'`. `workflow_run` only fires if the watcher file exists on the default branch, can filter `branches: [main]`, and the triggered workflow gets a secrets-capable token `[CITED: docs.github.com/en/actions/…/events-that-trigger-workflows#workflow_run, fetched this session]`. `cancelled` is a conclusion of the `completed` activity type, so `types: [completed]` catches it `[ASSUMED — conclusion enumeration from training; the body gate makes a wrong assumption fail-safe (no-op)]`.
- **Pattern to copy:** `analytics-deploy-verify.yml:111-137` — label-keyed dedup (`listForRepo` with `labels: dedupLabel, state: "open", per_page: 1` → `createComment` on the existing issue else `create`). Use a new label (e.g. `main-ci-cancelled`) so it does not collide with `analytics-deploy-stale`.
- **Permissions:** the watcher workflow needs `issues: write` (mirror `analytics-deploy-verify.yml:45-47`); add `actions: write` ONLY if auto-rerun is included (`gh run rerun <id>` / `POST /repos/{owner}/{repo}/actions/runs/{id}/rerun` require it `[CITED: GitHub REST API docs]`).
- **Rerun caveat:** an auto-rerun re-enters the same contention; guard with `run_attempt == 1` (payload field) or prefer issue-only. The requirement's wording — "issue **or** rerun" — permits issue-only; recommend **issue + optional single rerun**, never unconditional.
- **⚠️ The watcher must never exit non-zero on detection.** `analytics-deploy-verify.yml:17-24` documents the trap verbatim: *"A red check on a (HEAD) commit makes Railway's 'wait for CI' treat the commit's check-suite as red and SKIP the very deploy this probe verifies."* A `workflow_run`-triggered run attaches its check to the main-HEAD SHA; a red watcher would recreate #616. Loud = the issue, not a red check.
- **Testability:** give the watcher a second trigger, `workflow_dispatch` with a `run_id` input, so the issue-filing path can be exercised against a real historical cancelled run (one exists: CI run 31273384829 attempt 1, per PITFALLS.md) without forcing a cancellation on main.

### Closing #616 on the mechanism

Issue #616 is **OPEN** (`[VERIFIED: gh issue view 616 this session]`), title "Analytics prod is running stale code (deploy skipped?) — 2026-07-15"; its body already names the cause: *"a cancelled `python` job under the `shared-test-db` concurrency group is a known cause."* The closing comment must state: (a) the group is removed and replaced by the FIFO mutex (so a third simultaneous run queues instead of evicting), and (b) a `cancelled` main-run conclusion now files a dedup'd issue — i.e., both the eviction mechanism and the silence mechanism are gone. Do not close on "prod has converged."

### Verification (executable by the verifier)

1. **Serialization, three runs:** add a small probe workflow (`workflow_dispatch`) whose single job acquires the same mutex, sleeps ~60s, exits. Dispatch three back-to-back (`gh workflow run mutex-probe.yml` ×3), then poll: `gh run list --workflow=mutex-probe.yml --limit 3 --json databaseId,conclusion` until all complete; assert all three `conclusion == "success"` (⚠️ per PITFALLS: assert `== success`, never "not failure" — grey merges); then `gh api repos/{owner}/{repo}/actions/runs/<id>/jobs` for each and assert the three jobs' `started_at`/`completed_at` step windows for the locked section do not overlap. Three runs, not two — the eviction needed exactly three.
2. **No eviction possible:** `grep -c "shared-test-db" .github/workflows/ci.yml` → 0 occurrences as a `group:` value (comment mentions may remain).
3. **Watcher:** `gh workflow run <watcher>.yml -f run_id=31273384829` → assert the dedup'd issue is created (first run) and commented (second run), then close it.
4. **Falsifiability:** temporarily point the probe at a no-op lock (or run two probes with different keys) and observe the overlap assertion go RED — the serialization check must be able to fail.

## OPS-02 — `sql-tests` gated by an aggregator

**There is exactly one aggregator: `frontend` (`ci.yml:747`).** (`lighthouse-mobile`, `ci.yml:1892`, is deliberately advisory; `e2e` is advisory.) Current `needs:` (`ci.yml:780-788`), verbatim:

```yaml
    needs:
      - frontend-typecheck
      - frontend-lint
      - frontend-test
      - frontend-coverage
      - frontend-seam-redis
      - frontend-policy
      - frontend-build
      - e2e-seeded
    if: always()
```

The result-check loop (`ci.yml:794-826`) re-lists every job as `"name=${{ needs.name.result }}"` rows; the header comment (`:750-755`) explains why BOTH places are required: *"a bare `needs:` chain marks the aggregator as `skipped` (not `failed`) when any upstream fails, and `skipped` checks can satisfy classic GitHub branch protection rules."* `sql-tests` must be added to **both** the `needs:` list and the loop, or it stays advisory (the exact mistake `frontend-seam-redis`'s comment at `:773-778` warns about).

**The `if:` divergence trap, mapped precisely** (this is why `sql-tests` needs its own tolerance arm, and why wiring must NOT go through `e2e-seeded`'s `needs:`):

| Event | `sql-tests` `if:` (`:880`) | `e2e-seeded` `if:` (`:1519`) |
|-------|---------------------------|------------------------------|
| `push` to main | runs | runs |
| same-repo PR | runs | runs |
| fork PR | **skips** | **skips** |
| `workflow_dispatch` | **skips** (`event_name == 'push'` is false, PR field empty) | **runs** (`!= 'pull_request'` is true) |

`ci.yml:1543-1550` (on `e2e-seeded`) and `:926-933` (on `sql-tests`) both carry ⛔ comments documenting this; quote (`:1543-1546`): *"⛔ Do NOT add `sql-tests` to this `needs:` list … a skipped `needs:` job skips its dependents, and the two `if:` conditions diverge on manual dispatch."*

**Consequence for the aggregator arm:** `sql-tests` will legitimately be `skipped` on (a) fork PRs and (b) `workflow_dispatch` (which is the baseline route for the two bake inputs at `ci.yml:12-30` — a strict arm would redden every golden-bake run). Its loop arm must therefore mirror the `e2e-seeded` arm (`:805-822`) but tolerate skip on **fork PR OR workflow_dispatch**, and treat skip on push/same-repo-PR as failure (that is the "E2E_TEST_DB_CONFIGURED was LOST" detection the e2e-seeded arm already performs — `:810-811` notes a lost var *"ALSO silently disables sql-tests"*).

⚠️ Since `needs:` waits on `sql-tests` which itself `needs: [python]` (~7m) plus mutex queueing, this adds wall-clock to the aggregator on the worst path. Accept it — the alternative is the present-and-failing-with-nothing-gating state this requirement exists to kill.

**Verification:** on a branch, plant a deliberately failing `supabase/tests/test_*.sql` assertion, push a PR, observe `frontend` RED with `sql-tests=failure` in the loop output; revert; then `gh workflow run ci.yml` (dispatch) and observe `frontend` GREEN with `sql-tests=skipped` tolerated. Both polarities observed, per the every-test-must-be-able-to-fail rule.

## OPS-03 — orphaned e2e specs + DB-types drift

### Batching mechanism today

Specs are run by two hand-maintained shell lists (not globs, not shards):
- **Unseeded batch** (`e2e` job, `ci.yml:1404`): `auth, smoke, demo-public, demo-founder-view, onboarding-banner-smoke, demo-screenshot, reflow, target-size, reflow-sweep, no-clip-sweep, axe-app-wide, marketing-shell, route-redirects` (13 specs; placeholder Supabase env, no real DB).
- **Seeded batch** (`e2e-seeded` job, `ci.yml:1774-1797`): `onboarding-funnel, discovery-axe, discovery-hide-examples-default, discovery-prefs-isolation, strategy-v2-partial-data, strategy-v2-chart-parity, strategy-v2-keyboard, strategy-v2-axe, composer-axe, wizard-axe, wizard-resume, composite-onboarding, composite-factsheet-render, sfox-badge, mt5-badge, admin-compute-jobs-axe, mobile-drawer-keyboard, reflow-sweep-authed, svg-chart-parity, target-size, no-clip-sweep, axe-app-wide` (22 entries; real TEST Supabase, seeded via `scripts/seed-demo-data.ts` at `:1603`).
- The MA-8 comment (`ci.yml:1757-1762`) states the joining rule verbatim: *"Adding/removing a seed-gated spec? Update both this list and the `e2e/<spec>.spec.ts` HAS_SEED_ENV constant."* The unseeded list has the twin warning at `:1379-1384` ("Update BOTH lists or the gate silently never runs (burned >=3x)").
- `nightly.yml:109` additionally runs `e2e/portfolio-pdf-demo.spec.ts --grep @nightly` (that spec's @nightly cases only).

### The orphan census (measured this session: 53 spec files in `e2e/`, 20 in no CI batch)

| Orphaned spec | Seed-gated (`HAS_SEED_ENV`) | `test.skip(true` count | Notes |
|---|---|---|---|
| `api-key-flow.spec.ts` | no | 2 | **Named by the requirement.** Old (Task 2.2); self-skips authed cases |
| `sync-analytics-flow.spec.ts` | no | 3 | **Named.** Old (Task 2.3) |
| `full-flow.spec.ts` | no | 0 | **Named.** Needs `E2E_TEST_EMAIL`/`E2E_TEST_PASSWORD` env — **not set anywhere in `ci.yml`** (verified by grep); authed describes self-skip without them |
| `csv-upload-flow.spec.ts` | no | 0 | **Named.** CSV wizard branch (Phase 15) |
| `admin-csv-status-axe.spec.ts` | yes | 0 | Belongs in the seeded list if wired |
| `discovery-sparkline-regression.spec.ts` | yes | 0 | seeded |
| `discovery-watchlist.spec.ts` | yes | 0 | seeded |
| `for-quants-landing.spec.ts` | yes | 0 | seeded |
| `discovery.spec.ts`, `for-quants-onboarding.spec.ts`, `bridge-flow.spec.ts`, `mandate-form.spec.ts`, `match-queue.spec.ts`, `security-page.spec.ts`, `simulator-flow.spec.ts`, `strategy-detail-tabs.spec.ts`, `wizard-hydration-probe.spec.ts` | no | 0 | unclassified — triage at plan time |
| `sync-flow-queue.spec.ts` | no | 1 | triage |
| `wizard-sync-regression.spec.ts` | no | 1 | triage |
| `portfolio-pdf-demo.spec.ts` | no | 0 | @nightly cases run in `nightly.yml:109`; non-@nightly cases orphaned |

**What the requirement actually anchors on** — the pre-purge TODOS entry `E2E-NAV-01` (read at commit `aef56f82^` this session), verbatim: *"`api-key-flow`, `sync-analytics-flow`, `full-flow` and `csv-upload-flow` specs all EXIST but are wired into **no CI batch** — they never run. … **What closes it:** wire the four orphaned specs into a CI batch, then add a `my-strategies` spec."* And: *"NAV-01's entire surface has NO e2e coverage. MEASURED at the v1.17 close: `grep -rn "my-strategies" e2e/` returns **nothing**."* (Re-verified at HEAD this session: still nothing.) So "the NAV-01 surface" means **authoring a NEW `e2e/my-strategies.spec.ts`**, not wiring an existing file. ⚠️ Disambiguation: `route-redirects.spec.ts` carries a comment "Phase 51-05 / NAV-01" — that is a DIFFERENT, older NAV-01 (route-move canary) and is already wired; do not confuse them.

**Authoring pattern for the new spec:** the seeded specs mint their own users via `seedTestAllocator(...)` (`e2e/helpers/seed-test-project.ts`, used by `e2e/wizard-resume.spec.ts:82` + `loginViaForm`) — use that, NOT `E2E_TEST_EMAIL`. ⚠️ Shared-DB rule (PR #654 lesson, binding): the spec must assert its OWN seed's invariant, never a global DB state (the test project accumulates other specs' data). ⚠️ Selector rule from `DEF-149-B`: `/strategies` and `/my-strategies` both render an `h1` "My Strategies" — scope every selector by route/`href`/`data-testid`, never bare heading text (the Sidebar precedent uses `a[href="/my-strategies"]`).

**The load-bearing pitfall for wiring:** these specs have **never executed**. Wiring 4 never-run specs (some 2+ years of drift; `api-key-flow.spec.ts:212` matches copy by regex luck per TODOS) straight into a blocking batch will red CI on spec-rot, not product defects. Sequence: run each locally / in a scratch branch first, repair or explicitly-and-recordedly `test.skip` rotten cases, THEN add to the list. `full-flow`'s authed describes will silently self-skip in CI unless `E2E_TEST_EMAIL`/`E2E_TEST_PASSWORD` repo secrets are provisioned — either provision them (human task; creds live in the macOS Keychain, service `quantalyze-test`) or record that its authed half stays skipped-by-design and rely on its anon cases. A wired spec whose every case self-skips is the same false-coverage state — verify at least one case executes per newly wired spec (Playwright reports per-spec counts).

**Scope recommendation:** wire the four named + author `my-strategies.spec.ts` as the requirement's floor; triage the remaining 15 with a one-line disposition each (wire now / wire later w/ TODOS entry / delete) so "orphaned e2e specs execute in a CI batch" is closed as a CLASS decision, not a partial fix. Batch placement: seed-gated specs → seeded list (+ `HAS_SEED_ENV` const check), placeholder-safe specs → unseeded list.

### DB-types drift (regeneration gate OR recorded decision)

Measured reality at HEAD:
- `src/lib/database.types.ts` header, verbatim: *"GENERATED FILE — do not hand-edit. Produced by `npx supabase gen types typescript`"*. No `package.json` script and no CI job references `database.types` (grep verified — the only guards are the type-level pins below).
- **It is fresher than the ledger claims:** `computation_warned` and `metrics_json_by_basis` ARE present (6 hits, `database.types.ts:2576-2656`; last regen commit `a6a2dee8`, Phase 146.1) — the TODOS "four months stale" entry predates this. `src/lib/types.ts` (the hand-written interface) still has 0 hits for both — a separate, hand-maintained file outside this requirement's "generated types" scope; note it, don't conflate it.
- **The landmine that kills a naive regen gate:** `src/lib/database.types.test.ts` PERSIST-01 docblock, verbatim: *"scenarios is a HAND-PATCHED block in database.types.ts (added by migration 20260621120000; cannot be regenerated without prod DB access, and a regen linked to a project missing the migration silently reverts it)."* A CI job that runs `supabase gen types` against a target missing any hand-patched migration and diffs will either red forever or, worse, "fix" the diff by committing the reversion the type-pins exist to catch. Additionally, TEST is not schema-authoritative (migrations auto-apply to PROD on merge, `supabase-migrate.yml`; TEST is caught up manually/via MCP), and the local shadow-DB replay is broken (`P156-IN-01`: *"the migration chain cannot be replayed from scratch locally"*).
- **Existing partial guards:** `database.types.test.ts` pins specific columns type-level (C-0156, PERSIST-01) so a *stale regen that drops them* fails the build — drift-by-omission on new columns is what has no gate.

**Recommendation:** the requirement explicitly allows "an explicitly recorded decision not to" — take it, with substance: record (in the phase artifact + a TODOS/REQUIREMENTS note) that a regen gate is unsound until (a) a schema-authoritative, CI-reachable target exists and (b) the hand-patched `scenarios` block is reconciled into regenerable state; keep the compensating control (extend `database.types.test.ts` pins when columns are added — the established pattern) and the "regen when touched" convention. If the planner prefers a gate anyway, the only honest shape is path-triggered (on `supabase/migrations/**`) generate-against-PROD via `SUPABASE_ACCESS_TOKEN` (already a secret, `migration-drift-check.yml:39`) with the `scenarios` block carved out of the diff — cost and PROD-touching risk should be weighed in-plan.

## OPS-04 — TEST stale-`pending` drain + `claimed_at` stamps

### The two direct UPDATEs (exact targets)

Both in `analytics-service/tests/test_compute_jobs_fencing.py`, both flip a seeded row to `running` by direct table write "via a direct UPDATE (rather than `_claim_one`…)" and **omit `claimed_at`**:

1. `test_defer_compute_job_token_fence` (def `:1127`), UPDATE at `:1148-1152`, verbatim:
```python
        admin.table("compute_jobs").update({
            "status": "running",
            "claim_token": real_token,
            "attempts": 1,
        }).eq("id", job_id).execute()
```
2. `test_defer_compute_job_null_token_backcompat` (def `:1187`), UPDATE at `:1200-1204`, verbatim:
```python
        admin.table("compute_jobs").update({
            "status": "running",
            "claim_token": str(uuid.uuid4()),
            "attempts": 1,
        }).eq("id", job_id).execute()
```

**Why the stamp matters (verified in the latest SQL definition):** `reset_stalled_compute_jobs` (latest def in `supabase/migrations/20260516104201_compute_jobs_audit_2026_05_07_residual.sql`) only reclaims rows matching, verbatim (`:667-668`): `AND claimed_at IS NOT NULL AND claimed_at < (now() - v_threshold)`. A `running` row with `claimed_at` NULL is **permanently invisible to the watchdog** — if either test dies before its `finally` cleanup, it strands an unreapable `running` row on the shared TEST project forever. Fix: add `"claimed_at": <now ISO>` to both payloads (the other direct UPDATEs in the file at `:1108`, `:1277`, `:1361`, `:1726`, `:1807` only backdate `claimed_at` on already-claimed rows, and `:2914`/`:2924` rotate token/status in fence tests where the row was claimed via `_claim_one` — audit them in-plan but the requirement's "two" are `:1148` and `:1200`).

### The backlog mechanism — and the HEAD correction the plan must absorb

The authoritative in-repo description is `_claim_one`'s docstring (`test_compute_jobs_fencing.py:692+`), measured 2026-08-11, verbatim highlights: *"pg_cron jobid 9 fans out ONE `derive_broker_dailies` row per api_key at 05:30 UTC — **2320 rows in a single instant** — and TEST runs no worker"*; *"The claim RPC orders `priority, next_attempt_at, id`"*, so backlog rows sort ahead of anything a test seeds later; each unscoped claim *"drains 50 of those rows `pending -> running` PERMANENTLY (nothing on TEST completes or reaps them; 2325 rows sat `running`, the oldest from 2026-08-03)"*.

⚠️ **Ledger blockers are dated claims — this one moved.** PR #674 (`c726a250`, v0.57.0.1, 2026-08-12) added mandatory `kind=` / `p_kind_include` scoping to `_claim_one` and `test_drain_semantics.py` (`:133/:174/:196/:227` all pass `p_kind_include: ["process_key_long"]`), making the backlog *"STRUCTURALLY INVISIBLE rather than merely unlikely to interfere"* (docstring). So the exactly-10 deterministic red is most likely already gone at HEAD. The drain is still owed — the requirement says so, and the hygiene case stands on its own (unbounded accumulation: ~1 blocked-pending per eligible key via the `compute_jobs_one_inflight_per_kind_api_key` dedup + thousands of permanent `running` rows) — but the plan's acceptance for the drain must be **measured row counts before/after**, not "10 tests went green."

The refill source (read-only, never touched): `supabase/migrations/20260717233529_allocator_equity_derived_surface.sql:263` — *"Cron entrypoint — fans out one derive_broker_dailies job per ELIGIBLE api_key (is_active AND sync_status IS DISTINCT FROM ''revoked'' AND disconnected_at IS NULL …)"*; scheduled at `:283`.

### Drain shapes that honor both ⛔s (⛔ never a migration — `supabase/migrations/**` auto-applies to PROD on merge; ⛔ never `cron.unschedule(9)`)

| Shape | Mechanics | Durability | Notes |
|-------|-----------|------------|-------|
| (a) One-off SQL via orchestrator (Supabase MCP or `psql` w/ TEST DSN) | `UPDATE`/`DELETE` stale `pending` + stranded `running` rows, `kind='derive_broker_dailies'` (and stranded `running` of other kinds by measurement) on TEST | **Decays** — next 05:30 UTC fan-out refills pending (bounded ~1/key by the inflight dedup) | ⚠️ MCP is stripped from subagents (`anthropics/claude-code#13898`) — an MCP drain is an **orchestrator-session task**, not an executor task. Local `psql` is NOT installed (probed this session) |
| (b) Guarded re-runnable script (recommended core) | `scripts/` TS script using TEST REST + service key, copying `seed-demo-data.ts`'s interlock (`SEED_CONFIRM_STAGING=true`-style env + prod-URL hard-reject, `:651-657`) | Re-runnable; becomes the runbook's tool | Repo precedent exists; reviewable; TEST-only guard is code, not discipline |
| (c) Stop the refill at the eligibility predicate | Mark accumulated *test-artifact* `api_keys` ineligible (e.g. set `disconnected_at`) so jobid 9 fans ~0 rows tomorrow | **Durable** without touching cron — the fan-out's own predicate excludes them | The 2320 keys are e2e-seeded accumulation; ⚠️ must exclude keys live specs depend on (e.g. sfox/mt5 badge seeds) — measure and allowlist before flipping |

**Recommendation:** (b) + (c) together, with (a) as the manual fallback documented in the runbook. Confirm the target is TEST before every run: TEST ref `qmnijlgmdhviwzwfyzlc` (verbatim in `ci.yml:1003`: *"PG connection string for the test project (qmnijlgmdhviwzwfyzlc)"*); PROD is `khslejtfbuezsmvmtsdn` — the script must hard-reject any URL containing the PROD ref, mirroring the seed script's guard. WR-02's "never DELETE, terminalize" doctrine is a PROD-worker rule; on TEST, deleting worthless fan-out rows is acceptable — but terminalizing (`failed`) preserves the audit shape at trivial cost if anyone prefers symmetry. Either satisfies the requirement; record the choice.

**Verification:** before/after row counts by (kind, status) on TEST in the phase artifact; a re-run of the script is idempotent; `pytest tests/test_compute_jobs_fencing.py` from `analytics-service/` green; the two UPDATEs verified to stamp by grep + one deliberate mid-test abort showing the seeded row is now reapable (or at minimum the payload includes `claimed_at`).

## OPS-11 — `MultiKeyConnectStep` order-sensitive flake

### File inventory (paths corrected from CONTEXT's `src/components/**` guess)

- Component: `src/app/(dashboard)/strategies/new/wizard/steps/MultiKeyConnectStep.tsx`
- Specs: `…/MultiKeyConnectStep.test.tsx` (2,836 lines, 72 `it(` cases) and `…/MultiKeyConnectStep.payload.test.ts` (88 lines)
- The flake record (TODOS, 2026-07-30): *"the `MultiKeyConnectStep` WIZ-02 frontend test-isolation flake (44/44 in isolation, order/shard-sensitive) — did NOT hit PR6's `frontend-test` shard; left as tracked test-hygiene, fix if it reddens a future shard."* (Note the case count has since grown 44 → 72 — the file has been heavily extended.)

### Harness state at HEAD — the claim may already be closed; REPRODUCE FIRST

Phase 140.5-01 (landed ~2026-07-30, i.e. at/after the flake record) shipped the config-level fence, `vitest.config.ts:68-69`, verbatim:
```ts
    unstubGlobals: true,
    unstubEnvs: true,
```
plus an env-snapshot restore in `src/test-setup.ts` and the falsifiable canary `src/test-setup.leak-canary.test.ts`, whose docblock records the measurement (*"81 files call `vi.stubGlobal` (38 with no local cleanup) and 54 assign `process.env.X =` directly"*) and states the standing remedy pattern, verbatim: *"The standing constraint is `vi.spyOn` + `restoreAllMocks`, never `vi.stubGlobal` (DEF-16-1)."* Re-measured this session: 53 test files still call `vi.stubGlobal` without a local `unstubAllGlobals` — all covered by the config fence, which *"runs BEFORE each test and cannot be shadowed by a file-local `afterEach`"* (config comment `:58-60`).

`MultiKeyConnectStep.test.tsx` itself is hygienic: one file-level `vi.mock("@/lib/for-quants-analytics", …)` (`:37`), global `afterEach` with `vi.restoreAllMocks()` + `cleanup()` (`:93-96`), and its stub-using describes carry local `vi.unstubAllGlobals()` (`:1276`, `:1598`). It calls no `vi.stubGlobal` at top level. The leak, if still live, comes from **another file sharing the worker** — or from a mechanism the global-stub fence does not cover (`vi.mock` module-registry state, direct `process.env` writes pre-snapshot, jsdom document residue).

**Plan shape (root-cause, not retry):**
1. **Reproduce at HEAD** before changing anything: run the file in the full suite context under permuted orders — `npx vitest run --sequence.shuffle --sequence.seed=<n>` sweeps, the exact CI shard invocation, and the CI-Node22 environment (`PATH=/opt/homebrew/opt/node@22/bin` locally reproduces CI-only reds — established repo finding). ⚠️ Local full-suite runs red ~274 tests BY DESIGN via `.env.test.local` un-skipping `HAS_LIVE_DB` — use a worktree without the `.env` files for a valid local gate. ⚠️ GSD worktree agents get NO `node_modules` (measured) — the executor must `npm ci` or run from the main tree.
2. If reproduced: bisect the co-scheduled file set to the leaking spec, fix at the leak source with the DEF-16-1 pattern (`vi.spyOn` + `restoreAllMocks`; module mocks restored/`vi.unmock`'d), and pin with a regression demonstration — the failing order observed RED before the fix, GREEN after (founder rule: neuter → observe RED → restore).
3. If NOT reproducible after an honest sweep (documented seeds/orders/Node 22): the closure IS the 140.5 mechanism — record it as such with the reproduction-attempt evidence (seeds run, orders tried) and the leak-canary as the standing regression guard. That closes on mechanism, not on retries: the mechanism (config-level unstub + env snapshot + canary) is identified, in-tree, and falsifiable (ledger rows SC-HARNESS-1 / SC-ENV-1 documented in the canary docblock).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Cross-run mutex | A polling loop over `gh api` runs, or more `needs:` edges | Postgres session advisory lock (or, fallback, an existing lock action wrapped with timeout) | Poll loops race; `needs:` chains are ⛔ banned (workflow_dispatch divergence); advisory locks give queueing + auto-release for free |
| Lock steal/TTL | A cron that force-deletes locks | `timeout-minutes` on the jobs + session auto-release on disconnect | The steal path must not itself be a new stateful service |
| Dedup'd alerting | A new notification channel | The `analytics-deploy-verify.yml:111-137` label-keyed issue block | Third in-repo use of the identical pattern (nightly.yml, cassette-refresh.yml) |
| TEST-only guard for the drain | Trusting the operator to paste the right DSN | The `seed-demo-data.ts` interlock (`:651-657`): explicit env opt-in + prod-URL hard-reject + PROD-ref rejection | An accidental PROD run is catastrophic and the guard already exists as code |
| e2e auth for the NAV-01 spec | `E2E_TEST_EMAIL` plumbing | `seedTestAllocator` + `loginViaForm` (`e2e/helpers/seed-test-project.ts`, `wizard-resume.spec.ts:82,111`) | Established seeded-spec pattern; no new secrets |

## Common Pitfalls

### Pitfall 1: Believing the group is fixable from inside GitHub's concurrency layer
Any fix that keeps `group: shared-test-db` keeps the one-pending-slot eviction. Membership shrinking and `needs:` chaining are both ⛔ banned and both already refuted in-repo (`ci.yml:896-933`). **The group must be removed** where the mutex is adopted.

### Pitfall 2: The watcher reddening main-HEAD checks
A `workflow_run` watcher that `exit 1`s on detection attaches a red check to the main-HEAD SHA → Railway skips the deploy → the watcher recreates #616. `analytics-deploy-verify.yml:17-24` documents this deadlock from a live 2026-06-21 incident. Loud signal = dedup'd issue; check stays green.

### Pitfall 3: Advisory lock through the transaction-mode pooler
The documented DSN is port 6543 (transaction pooling). A session advisory lock through transaction pooling silently doesn't serialize. Probe session-mode connectivity FIRST; this is the go/no-go for the recommended backend.

### Pitfall 4: Wiring never-run specs straight into a blocking batch
The four named orphans have never executed in CI; wiring before a local/scratch pass converts spec-rot into a red `frontend` aggregator on an unrelated PR. Run → repair → wire, and verify at least one case actually executes per spec (all-skip = false coverage).

### Pitfall 5: A naive DB-types regen gate reverts the hand-patched `scenarios` block
`database.types.test.ts` documents that a regen against a target missing migration 20260621120000 *silently reverts* the hand-patch. Either record the decision not to gate (allowed by the requirement) or carve the block out of any diff gate.

### Pitfall 6: Closing OPS-04 on the wrong observable
The exactly-10 red was structurally fixed by PR #674 on 2026-08-12. "Tests are green after the drain" proves nothing. Close on measured row-count deltas on TEST.

### Pitfall 7: Shared-DB e2e asserting global state
Any new/wired seeded spec must assert its OWN seed's invariant (PR #654 lesson). The test project is polluted by construction.

### Pitfall 8: Verifying with two runs
Two runs never evict (1 running + 1 pending is stable). The mechanism needs THREE simultaneous runs; so does its verification. (CONTEXT-binding.)

### Pitfall 9: Editing ledgers/workflows and committing in one block
Repo discipline: edit → verify (`grep`/actionlint-style read-back) → commit as separate steps; never bundle. `.planning/` is tracked and the repo is PUBLIC — no secrets, DSNs, or usernames in any artifact this phase writes (the runbook must reference secret NAMES, never values).

## Runtime State Inventory

(This phase's OPS-04 half is a runtime-state intervention; inventory answered explicitly.)

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | TEST `compute_jobs`: daily `derive_broker_dailies` fan-out `pending` rows + thousands of permanent `running` rows (measured 2026-08-11 in `_claim_one` docstring: 2320 pending in one instant, 2325 running); TEST `api_keys`: ~2320 eligible accumulated test keys feeding the fan-out | Drain script (b) + eligibility flip (c); measure before/after |
| Live service config | TEST pg_cron jobid 9 (schedule lives in the DB, not git) — ⛔ read-only for this phase; Railway deploy-on-green behavior (external, unchanged) | None (never unschedule) |
| OS-registered state | None — CI runners are ephemeral | None — verified by construction |
| Secrets/env vars | `TEST_SUPABASE_DB_URL` (exists, used by `sql-tests`) must become available to `python`/`e2e-seeded` job env for the mutex step; possibly a session-mode variant; `E2E_TEST_EMAIL/PASSWORD` do NOT exist in CI (decide: provision or record skip) | Add job-level env wiring; any new secret provisioning is a human task |
| Build artifacts | None affected | None — verified (workflows and tests only) |

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `gh` CLI | verification (dispatch/poll runs, issue ops) | ✓ local | 2.92.0 | GitHub REST via curl |
| `psql` | drain option (a) local; mutex probes | ✗ local (probed) | — | CI installs it per-job (`ci.yml:947-950`); locally use Supabase MCP (orchestrator-only) or REST script |
| Supabase CLI | OPS-03 types decision context | ✓ local | 2.84.2 | CI `setup-cli` v2.1.1 (2.98.2) |
| Node | vitest/playwright | ✓ local | v25.8.1 (⚠️ CI is 22 — Node-22 PATH repro available at `/opt/homebrew/opt/node@22/bin`) | — |
| Python | pytest (from `analytics-service/` only) | ✓ local | 3.14.3 (⚠️ CI is 3.12) | — |
| Supabase MCP (TEST) | drain option (a), row-count measurement | orchestrator only (stripped from subagents) | — | drain script (b) via REST |

**Missing dependencies with no fallback:** none.
**Missing dependencies with fallback:** local `psql` (use CI/REST/MCP as noted).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Frameworks | vitest 4.1.10 (`vitest.config.ts`), pytest (`analytics-service/`, run from that dir), Playwright (`playwright.config.ts`), plain-SQL gates (`supabase/tests/test_*.sql` via `sql-tests`), GitHub Actions itself (probe workflows) |
| Config files | `vitest.config.ts`, `analytics-service/` pytest, `playwright.config.ts` |
| Quick run command | `npx vitest run "src/app/(dashboard)/strategies/new/wizard/steps/MultiKeyConnectStep.test.tsx"` / `cd analytics-service && python3 -m pytest tests/test_compute_jobs_fencing.py -x` |
| Full suite command | `npm run test` (⚠️ valid only in a worktree without `.env.test.local`) / `cd analytics-service && python3 -m pytest` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| OPS-01 | 3 simultaneous runs serialize; none `cancelled` | CI probe (manual-dispatch, verifier-run) | `gh workflow run mutex-probe.yml` ×3 + `gh run list/api` assertions | ❌ Wave 0 (probe workflow) |
| OPS-01 | `cancelled` main run → dedup'd issue | CI probe via watcher's `workflow_dispatch` test input | `gh workflow run <watcher>.yml -f run_id=31273384829` | ❌ Wave 0 (watcher workflow) |
| OPS-02 | failing `sql-tests` reddens `frontend`; dispatch-skip tolerated | live CI both-polarity check | plant failing SQL assertion on a branch; then a dispatch run | ✅ mechanism exists; scenario is a plan task |
| OPS-03 | wired specs execute (≥1 case each); NAV-01 spec passes seeded | Playwright | `npx playwright test e2e/my-strategies.spec.ts` (seeded env) | ❌ Wave 0 (`e2e/my-strategies.spec.ts`) |
| OPS-04 | drain measured; stamps present | SQL count queries + pytest | count-by-(kind,status) before/after; `python3 -m pytest tests/test_compute_jobs_fencing.py` | ✅ (counts are a runbook/script artifact) |
| OPS-11 | flake reproduced-or-closed with evidence; fixed order stays green | vitest ordering sweep | `npx vitest run --sequence.shuffle --sequence.seed=<n>`; Node-22 PATH variant | ✅ specs exist |

### Sampling Rate
- **Per task commit:** the targeted file/test for the touched surface (`vitest run <file>` / `pytest <file>` from `analytics-service/`); `npm run lint` before any push.
- **Per wave merge:** full vitest (clean worktree) + full pytest; `mypy --strict --follow-imports=silent services/ routers/ models/` if any `analytics-service/` file changed (GSD runs pytest only — mypy is the known latent-red gap).
- **Phase gate:** full suites green + the three live-CI verifications (mutex probe ×3, watcher dispatch, sql-tests both polarities) before `/gsd-verify-work`.

### Wave 0 Gaps
- [ ] `.github/workflows/mutex-probe.yml` — OPS-01 serialization proof (may be deleted after verification or kept as the runbook's drill)
- [ ] `.github/workflows/<main-ci-cancelled-watcher>.yml` — OPS-01 detection layer
- [ ] `e2e/my-strategies.spec.ts` — OPS-03 NAV-01 surface
- [ ] `scripts/<drain-test-compute-backlog>.ts` — OPS-04 drain tool (guarded)
- [ ] Session-mode DSN probe result — go/no-go for the advisory-lock backend (do this FIRST; it forks the OPS-01 design)

## Security Domain

CI-infrastructure phase; the applicable surface is workflow security, not app ASVS categories.

| Concern | Applies | Standard Control |
|---------|---------|-----------------|
| Secrets on fork PRs | yes | Existing composition (vars-gate + head-repo check, `ci.yml:843-864`); the mutex step must no-op on empty secret, never fail open into unauthenticated retry |
| GITHUB_TOKEN least privilege | yes | Default `contents: read` (`ci.yml:52-53`); watcher uplifts `issues: write` (+`actions: write` only if rerun ships) at workflow level, mirroring `analytics-deploy-verify.yml:45-47` |
| Third-party action supply chain | yes | Full-SHA pins with version comments (repo convention); avoid alpha actions (recommended backend uses none); banned-packages list not implicated (no npm installs) |
| Secret leakage into public artifacts | yes | Repo PUBLIC + `.planning/` tracked: runbook and RESEARCH/PLAN docs name secrets by NAME only; the drain script takes the DSN from env, never a literal |
| psql meta-command exfiltration | inherited | The Finding-6 preflight (`ci.yml:951-1000`) already guards `supabase/tests/*.sql`; any new SQL the mutex/drain adds via psql is fixed-string, no untrusted interpolation |

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Native `shared-test-db` group + `needs: [python]` chain | (this phase) external FIFO mutex + group removal + `cancelled` watcher | 158 | Eviction class removed; grey-run silence removed |
| Unscoped `_claim_one` global-head claims | `p_kind_include`/`want_job_id` scoping (PR #674, 2026-08-12) | pre-158 | The exactly-10 red is likely already dead — OPS-04 closes on row counts, not test colors |
| Per-file stub hygiene | Config-level `unstubGlobals`/`unstubEnvs` + env snapshot + leak canary (Phase 140.5) | 2026-07-30 | OPS-11 must re-reproduce before fixing |
| TODOS "shrink the group / finish the chain" remedies | Refuted in-repo (`ci.yml:896-933`) and by PITFALLS.md Pitfall 1 | 2026-08-20 | Both are ⛔ constraints, not options |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Postgres grants advisory-lock waiters in FIFO (arrival) order | OPS-01 backend table | Serialization still holds (mutual exclusion is unaffected); only strict arrival-order fairness weakens. Verify empirically in the 3-run probe (ordering assertion) |
| A2 | Supavisor session mode is available on port 5432 of the same pooler host; session advisory locks don't survive transaction-mode pooling | OPS-01 Pitfall 3 | If session mode unreachable from CI, fall back to the lock-action option; the Wave-0 probe settles this before any design commits |
| A3 | `workflow_run` `types: [completed]` fires for `cancelled` conclusions (conclusion is a payload field, not an activity type) | OPS-01 watcher | If wrong, the watcher never fires — fail-safe (no false positives); the dispatch-input test path plus one observed real cancellation settles it |
| A4 | GitHub Actions runs an action's `post:` steps best-effort on job cancellation | OPS-01 (fallback action only) | Only matters if the fallback action is adopted; the recommended backend relies on TCP disconnect, not post-steps |
| A5 | The ~2320 eligible TEST `api_keys` are e2e-seeded artifacts safe to mark ineligible (minus an allowlist) | OPS-04 shape (c) | Could break seeded badge specs that rely on specific keys — measure + allowlist before flipping; shape (b) alone still satisfies the requirement |
| A6 | `gh run rerun` on a `cancelled` completed run is permitted with `actions: write` | OPS-01 watcher (optional rerun) | Issue-only path is unaffected; rerun is optional per requirement wording |

## Open Questions

1. **Session-mode DSN reachability from CI runners** — the fork in the OPS-01 design (A2). Wave-0 probe; both branches are planned above.
2. **Provision `E2E_TEST_EMAIL`/`E2E_TEST_PASSWORD` as repo secrets, or record `full-flow`'s authed half as skipped-by-design?** Human/founder-adjacent (secret provisioning is a repo-settings action). The plan should carry it as a `checkpoint:human-verify` or an explicit recorded decision.
3. **Disposition of the 15 non-named orphan specs** — recommend a one-line triage table in the plan (wire/defer-to-TODOS/delete) so OPS-03 closes as a class; the requirement's floor is the 4 named + NAV-01.
4. **DB-types: gate vs recorded decision** — research recommends the recorded decision (soundness blockers documented above); if the planner overrides, the PROD-target + carve-out shape is the only honest gate.
5. **Drain semantics choice (DELETE vs terminalize `failed`) on TEST** — either is compliant; record which.

## Sources

### Primary (HIGH confidence — read at HEAD this session)
- `.github/workflows/ci.yml` — `:1` (name: CI), `:12-30` (dispatch inputs), `:39-41`, `:52-53`, `:747-831` (aggregator + loop), `:833-1035` (sql-tests incl. `:880` if, `:906-938` ⛔ comments + group, `:1003` TEST ref, `:1015` DSN format), `:1132-1232` (python), `:1404` (unseeded list), `:1498-1552` (e2e-seeded incl. `:1519` if, `:1540-1542` group, `:1543-1550` ⛔), `:1774-1797` (seeded list)
- `.github/workflows/analytics-deploy-verify.yml` — `:1-51` (exit-0 doctrine, permissions), `:111-137` (dedup'd-issue block)
- `.github/workflows/nightly.yml:109`; `.github/workflows/migration-drift-check.yml:39,48,55`
- `analytics-service/tests/test_compute_jobs_fencing.py` — `:692+` (`_claim_one` docstring: claim ordering, 2320/2325 measurements), `:1127/:1148-1152`, `:1187/:1200-1204` (the two UPDATEs)
- `analytics-service/tests/test_drain_semantics.py:133,174,196,227` (`p_kind_include`)
- `supabase/migrations/20260516104201_…:602-603,667-668` (reaper `claimed_at` predicate); `20260717233529_…:263,283` (cron fan-out)
- `vitest.config.ts:50-125` (unstub pair, projects, sharding); `src/test-setup.leak-canary.test.ts` (DEF-16-1 statement, 81/38/54 measurements)
- `src/app/(dashboard)/strategies/new/wizard/steps/MultiKeyConnectStep.test.tsx:37,89-96,1276,1598` (+ payload test)
- `src/lib/database.types.ts` (header, `:2576-2656`); `src/lib/database.types.test.ts` (C-0156 + PERSIST-01 docblocks); `git log` on the file (regen at `a6a2dee8`)
- `scripts/seed-demo-data.ts:651-657` (TEST-only interlock); `e2e/helpers/seed-test-project.ts`; `e2e/wizard-resume.spec.ts:82,111`
- `e2e/` directory census (53 specs) vs both CI lists → 20 orphans; per-spec `HAS_SEED_ENV`/`test.skip(true`/@nightly classification (this session)
- `git show aef56f82^:TODOS.md` — E2E-NAV-01 entry (the four named specs + new my-strategies spec); "20 of 35 Playwright specs wired to no workflow"
- GitHub issue #616 (`gh issue view` this session — OPEN, body quoted)
- `.planning/research/PITFALLS.md` (Pitfall 1 + phase mapping + backlog note), `.planning/research/SUMMARY.md:157,201-214` — v1.20 milestone research, 2026-08-20

### Secondary (MEDIUM confidence — fetched this session)
- `github.com/ben-z/gh-action-mutex` README — alpha status, no TTL, mechanism
- `docs.github.com` events-that-trigger-workflows `#workflow_run` — default-branch requirement, branch filters, token capability, 3-level chain limit

### Tertiary (LOW confidence — training knowledge, tagged `[ASSUMED]` inline)
- Postgres advisory-lock waiter ordering; Supavisor session-vs-transaction pooling ports; `cancelled` under `workflow_run: completed`; post-step behavior on cancellation; `gh run rerun` permission shape

## Metadata

**Confidence breakdown:**
- OPS-01 mechanism + constraints: HIGH — in-repo ⛔ comments + milestone research + issue #616 all read directly; backend choice carries two `[ASSUMED]` probes gated at Wave 0
- OPS-02 wiring: HIGH — both lists, both `if:`s, and the tolerance-arm precedent quoted verbatim
- OPS-03 census: HIGH — computed from the actual lists vs the actual directory this session; NAV-01 meaning pinned to the pre-purge TODOS entry
- OPS-04: HIGH — reaper predicate and both UPDATEs quoted; the HEAD-correction (PR #674) verified in git history
- OPS-11: MEDIUM — the defect is a dated claim that may already be closed; the plan's first step is reproduction, and both branches are specified

**Research date:** 2026-08-20
**Valid until:** ~2026-09-20 for repo facts (CI files churn with every phase — re-grep line anchors at plan time); external docs stable
