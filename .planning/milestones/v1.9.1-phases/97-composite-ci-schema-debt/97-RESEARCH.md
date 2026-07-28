# Phase 97: Composite CI & Schema Debt — Research

**Researched:** 2026-07-12
**Domain:** CI/test-infrastructure — pytest-xdist parallelism safety on a shared remote Supabase test project; hermetic SQL-function snapshot drift gate; audit-coverage regression gates
**Confidence:** HIGH (all claims verified against the live working tree / the actual PR / actual gate runs, not reasoning)

## Summary

This is the milestone's last phase: close the composite path's CI and schema-snapshot debt. The work reduces to **two real tasks plus a re-justify/verify decision**, because most of the roadmap's CI-02.2 scope was **already closed** during Phases 88–96 and must be *dropped with evidence* (the roadmap explicitly requires this check).

Verified state of the world (branch `gsd/v1.9.1-composite-onboarding-hardening`, **75 commits ahead of `origin/main`** — Phases 92–96 live here, unmerged):

1. **CI-01 (unblock #610):** PR #610 already parallelizes the analytics-service python job (`pytest -n auto --dist loadgroup`) and already ships a *serial-lane* approach (an `xdist_group("shared_test_db")` marker applied by `tests/conftest.py` to every DB-touching module). It is **held** because that serial lane is *not sufficient* for `test_compute_jobs_fencing.py`: its live-DB tests assert on the **global** `compute_jobs` claim queue (`_claim_one` returns `res.data[0]` and asserts `== own job_id`), so any foreign pending row — left by an interleaved grouped DB test (drain/similarity) on the same worker — breaks the assertion. The maintainer's hold comment names the fix: **per-run-tag claim scoping** *or* a dedicated serial lane. **Recommendation: per-run-tag scoping** (scope each fence test's claim/assertion/cleanup to its own `job_id`/`strategy_id`), because it fixes the root cause (a global-queue assumption), is robust to both within-run interleave *and* cross-run/cross-job contention, adds zero CI cost, and preserves #610's full parallelization. #610 is an existing open draft — **adopt/rebase its commits and add the isolation fix on top**, don't re-author.

2. **CI-02.1 (the "#165" flaky fence tests):** "**#165" is `TODOS.md` line 165**, *not* GitHub issue #165 (which is a merged match-router PR — unrelated). The 3 deferred tests (`test_late_mark_done_with_stale_token_…`, `…mark_failed…`, `…after_w2_completed…`) are `@pytest.mark.skip` for **`httpx.ReadTimeout` at ~120s under live-DB suite load** — a *contention/latency* root cause, **different from** CI-01's foreign-row isolation. CI-01's fix does **not** directly make them safe. They can be re-enabled *only* behind the existing `_rpc_retry_timeout` guard (timeout→skip, real errors re-raise), or their deferral re-justified (mocked equivalents + the migration self-verify DO block already pin the contract server-side). This is the exact pitfall the phase warns about; treat re-enable as **NON-BLOCKING**.

3. **CI-02.2 (composite finalize/publish CI):** VERIFIED-AGAINST-BRANCH — the audit instrumentation is **already done**. `audit-coverage.test.ts` + `audit-fanout-integration.test.ts` are **GREEN (28 passed, 1 skipped)**; the `stitch_composite` enqueue at `finalize-wizard/route.ts` already carries `logAuditEventAsUser(...)`, and `audit-fanout-integration.test.ts` already has the `strategy_keys` mock (line 811). **DROP those two items.** Only the **SQL-fn snapshot** is open — and the roadmap-named functions (`enforce_strategy_keys_owner_coherence`, `sync_strategy_analytics_status`) **already have current snapshots** (landed with v1.9 #607). The **actually-owed** snapshots, confirmed against the current function set via `npm run schema:functions:check`, are three Phase-95/96 functions: `set_compute_job_progress` (missing), `cleanup_abandoned_wizard_drafts` (missing), `set_wizard_composite_members` (stale).

**Primary recommendation:** Ship one focused PR that (a) adopts #610's commits + adds per-run-`job_id` scoping to the live fence tests, (b) regenerates the 3 owed SQL-fn snapshots via `npm run schema:functions`, and (c) either re-enables the 3 TODOS-L165 tests behind `_rpc_retry_timeout` or records a re-justified deferral. The audit-coverage/fanout items are already green — verify-and-drop.

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CI-01 | analytics-service pytest green under `-n auto` with `test_compute_jobs_fencing.py` parallelism-safe; #610 landable | Root cause + recommended per-run-tag fix documented below; #610 diff read; hold reason confirmed |
| CI-02 | 3 deferred fence tests re-enabled-or-re-justified; composite finalize/publish green in CI; each sub-item checked vs main first | Per-item verified-against-branch status table below; #165=TODOS-L165 resolved; owed snapshots confirmed against current fn set |

## User Constraints (from CONTEXT.md)

No CONTEXT.md exists for this phase (`has_context: false`). No discuss-phase locked decisions. The one hard constraint is from the **ROADMAP** itself and is treated as locked:

> CI-02 items must be VERIFIED against `main` FIRST — drop any already closed, with a note.

This research performs that verification (see the CI-02.2 status table). "main" = `origin/main` (`bdedbe82`); all phase work lives on `gsd/v1.9.1-composite-onboarding-hardening` (ahead 75).

## Project Constraints (from CLAUDE.md / AGENTS.md)

- **Coverage is a blocking CI gate**: vitest thresholds lines 82 / statements 80 / functions 74 / branches 72; python suite enforces `--cov-fail-under=80`. #610 keeps `--cov-fail-under=80` and pytest-cov is xdist-aware (union coverage ≥ serial) — do not weaken it.
- **Version bump both files**: any commit bumps `VERSION` and `package.json` together (#610 already does: 0.41.0.2).
- **Commit workflow**: `/ship` to commit, `/qa` after; never manual `git commit`. Feature-branch + PR always.
- **DB test CI wiring**: RLS/SQL gates must be `supabase/tests/test_*.sql`; `*_live.py` skip in CI *unless* `E2E_TEST_DB_CONFIGURED=true` (it is, for the python job, via PR #149). prod=`khslejtfbuezsmvmtsdn`, test=`qmnijlgmdhviwzwfyzlc`.
- **Subagent branch protection / no git branch ops** for executors; leave tree clean.
- **Match existing conventions** (Rule 11) — the fencing tests already have `_rpc_retry_timeout`, `_purge_allocator_jobs`, `_allocator_id` helpers; reuse them rather than inventing isolation machinery.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Parallel pytest execution | CI runner (GitHub Actions) | Test harness (`conftest.py`) | `-n auto` is a runner-level concurrency decision; grouping is a collection-time hook |
| Shared-test-DB isolation | Test code (fence tests) | Database (test Supabase project) | Isolation must be asserted in test logic (own-row scoping); the DB is a shared global resource that cannot be partitioned per test |
| SQL-fn snapshot drift detection | Build tooling (`scripts/dump-sql-functions.ts`) | Migrations (source of truth) | Hermetic text-replay of `supabase/migrations/**`; no DB tier involved |
| Mutation audit coverage | Test code (vitest grep + integration) | API routes (`route.ts`) | Static grep + runtime fan-out assert audit emission at the mutation site |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| pytest-xdist | 3.x (unpinned; `--dist loadgroup` needs ≥2.5) | Distribute the ~3.6k offline python tests across runner vCPUs | `pytest-dev` official plugin; the canonical pytest parallelism tool. Added by #610. `[CITED: pypi.org/project/pytest-xdist]` |
| pytest-cov | (already present) | xdist-aware coverage combine before `--cov-fail-under=80` | Combines per-worker coverage; union ≥ serial number `[VERIFIED: #610 local A/B 88% combined]` |
| tsx | (already present) | Runs `scripts/dump-sql-functions.ts` (hermetic snapshot) | Existing project tool; `schema:functions` / `:check` scripts `[VERIFIED: package.json:22-23]` |
| vitest | ^4.1.2 | Runs the audit-coverage / audit-fanout regression gates | Existing suite `[VERIFIED: ran locally — 28 passed]` |

**No new package installs are required beyond `pytest-xdist`, which PR #610 already added** to `analytics-service/requirements-dev.txt`.

**Verification:** pytest-xdist is a `pytest-dev`-org plugin (same org as pytest itself); not a slop/typosquat risk. The `xdist_group` marker is registered in `pytest.ini` by #610 (avoids `PytestUnknownMarkWarning`).

## Package Legitimacy Audit

Only one external package is introduced by this phase's anchor PR (#610). slopcheck was not installable in this session (offline pip); the package is a first-party pytest-dev plugin, so risk is negligible, but per protocol it is tagged accordingly.

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| pytest-xdist | PyPI | ~10 yrs | very high (tens of M/mo) | github.com/pytest-dev/pytest-xdist | n/a (offline) | Approved — first-party pytest-dev plugin, already in #610 `[CITED: pypi.org/project/pytest-xdist]` |

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none
*slopcheck was unavailable at research time (offline). pytest-xdist is nonetheless a well-established pytest-dev plugin; the planner may still gate its install behind a `checkpoint:human-verify` if it wants strict adherence, but note it is already committed in #610.*

## The #610 Root Cause + Recommended Fix (CI-01)

### What #610 does (verified from `gh pr diff 610`)
- `.github/workflows/ci.yml` + `Makefile` `test:` → `pytest -n auto --dist loadgroup --cov=… --cov-fail-under=80` (kept byte-identical between CI and Makefile).
- `pytest.ini` registers the `xdist_group` marker.
- `requirements-dev.txt` adds `pytest-xdist`.
- `tests/conftest.py` adds a `pytest_collection_modifyitems` hook that content-scans each test module for DB sentinels (`SUPABASE_TEST_URL`, `SUPABASE_TEST_SERVICE_KEY`, `_need_supabase`, `TEST_SUPABASE_DB_URL`, `HAS_LIVE_DB`) and pins matches to `xdist_group("shared_test_db")` so **all DB-touching modules land on one worker** and serialize relative to each other.

### Why it is held (verified from the maintainer's hold comment + the test source)
- Local A/B is clean (34.6s→15.0s, 88% combined coverage, 3576 non-fencing tests pass).
- The **`python` job goes red on `test_compute_jobs_fencing.py`** under `-n auto`, and **re-running the python job alone still fails** — so this is *not* purely the concurrent Contracts/e2e workflow.
- Root cause (confirmed by reading the test): the live-DB fence helper does a **global** claim and assumes its own job is first:
  ```python
  def _claim_one(admin, worker_id):
      res = admin.rpc("claim_compute_jobs_with_priority",
                      {"p_batch_size": 50, "p_worker_id": worker_id,
                       "p_unified_backbone_active": False}).execute()
      return res.data[0] if res.data else None   # ← assumes data[0] is THIS test's job
  # e.g. test_claim_stamps_claim_token: assert claimed["id"] == job_id
  ```
  `test_compute_jobs_fencing.py` *does* match the sentinels (`SUPABASE_TEST_URL`/`_need_supabase` at lines 12/552/556), so #610 already groups it onto the shared worker. But `xdist_group` only **serializes** the grouped modules on one worker; it does **not isolate** them from each other's **rows**. When an interleaved grouped DB test (`test_drain_semantics.py`, etc.) has a pending `compute_jobs` row present, `claim_compute_jobs_with_priority(batch_size=50)` returns that **foreign** row at `data[0]` and `claimed["id"] == job_id` fails. This is the "not isolated against foreign rows / interleaved grouped DB tests" the maintainer describes.

### Recommended fix: per-run-tag (own-`job_id`) claim scoping — PREFERRED
Scope each fence test's claim result, assertion, and cleanup to the **job it inserted** rather than to `data[0]`:
```python
def _claim_one(admin, worker_id, *, want_job_id=None):
    res = admin.rpc("claim_compute_jobs_with_priority",
                    {"p_batch_size": 50, "p_worker_id": worker_id,
                     "p_unified_backbone_active": False}).execute()
    rows = res.data or []
    if want_job_id is not None:
        return next((r for r in rows if r["id"] == want_job_id), None)
    return rows[0] if rows else None
```
Each test already inserts a uniquely-identified job (`strategy_id = p97-fence-test-<uuid8>`), so the own-`job_id` is known — the assertion becomes foreign-row-tolerant. The 13 `_claim_one` call sites are threaded with `want_job_id=job_id`; direct `claim_compute_jobs_with_priority` sites in the other live tests get the same own-row filter.

**Why this over a dedicated serial lane:**

| | Per-run-tag (own-`job_id`) scoping — RECOMMENDED | Dedicated serial lane (separate `xdist_group("fence_serial")`) |
|---|---|---|
| Fixes root cause | Yes — removes the global-queue assumption | No — papers over it by controlling order |
| Robust to within-run interleave | Yes | Yes (contiguous on one worker) |
| Robust to concurrent CI runs / other jobs (e2e/contracts) touching `compute_jobs` | **Yes** (assertion depends only on own rows) | **No** — the `concurrency: shared-test-db` group serializes the *python job across runs* but not the concurrently-running e2e job vs the same test project |
| CI cost | Zero extra (full #610 parallelization preserved) | Reserves a 2nd worker for a 2nd DB group; marginally less parallelism |
| Brittleness | Low | Higher (depends on no foreign rows ever existing) |

**Side-effect note:** `claim_compute_jobs_with_priority(batch_size=50)` will still *claim* foreign rows as a side effect (stamping them `processing`). This pollutes the shared table but is self-healing via the watchdog reset; the executor may optionally lower `p_batch_size` for these tests or seed a distinguishing priority, but the own-`job_id` filter is the load-bearing fix. Keep `finally` cleanup scoped to the own `job_id` (already the case).

**How it unblocks #610:** with the live fence assertions no longer dependent on `data[0]`, the python job passes under `-n auto --dist loadgroup` in the presence of interleaved/foreign rows → #610's red `python` check goes green → the draft is un-drafted and landed. **The plan should adopt #610's existing commits (branch `ci/pytest-xdist-parallel`) and layer the fence-isolation fix on top, then rebase onto the milestone branch — not re-author the parallelization.**

## CI-02.1 — The 3 deferred fence tests ("#165" = TODOS.md L165) — re-enable assessment

**Number resolution:** GitHub issue #165 is a *merged match-router PR* — unrelated. The deferral tracker is **`TODOS.md` lines 165–186** ("PR #149 (audit-2026-05-07 P97) — flaky live-DB fence tests, deferred 2026-05-13"). Flag this to the planner so it doesn't chase the wrong issue.

The 3 `@pytest.mark.skip` tests (all in `test_compute_jobs_fencing.py`):
- `test_late_mark_done_with_stale_token_raises_serialization_failure` (~L908)
- `test_late_mark_failed_with_stale_token_raises_serialization_failure` (~L1008)
- `test_late_mark_done_after_w2_completed_raises_serialization_failure` (~L1429)

**Root cause of their skip = `httpx.ReadTimeout` at ~120s under live-DB suite load** — a *contention/latency* failure, **NOT** the foreign-row isolation that CI-01 fixes. So:

| Test | Does CI-01's fix make it safe? | Recommendation |
|------|-------------------------------|----------------|
| all 3 (same root cause) | **No** — different failure mode (timeout, not foreign-row) | **Re-enable behind the existing `_rpc_retry_timeout` guard** (timeout→`pytest.skip`, real errors incl. the asserted `serialization_failure` re-raise). The other ~9 live fence tests already pass this way. If a canary CI run still shows them flaky, **re-justify deferral**: the mocked equivalents (`_is_serialization_failure`, `LATE_MARK_IGNORED`, `dispatch_tick` token threading) plus the migration-117 self-verify DO block already pin the fence contract server-side; the live versions are supplementary. |

**This is the phase's flagged pitfall** ("re-enabling a test that's flaky for a DIFFERENT reason than #610"). Treat re-enable as **NON-BLOCKING** — it requires a live shared-test-DB run to confirm and the contract is already independently guarded. The success criterion is satisfied by *either* re-enable-behind-guard *or* a recorded re-justification.

## CI-02.2 — Verified-Against-Branch status table (drop what's closed)

Branch checked: `gsd/v1.9.1-composite-onboarding-hardening` (all Phase 92–96 work). Evidence commands run this session.

| Sub-item | Status | Evidence |
|----------|--------|----------|
| `stitch_composite` enqueue (`finalize-wizard/route.ts`) instrumented for `audit-coverage.test.ts` | **ALREADY CLOSED — DROP** | Route already has `logAuditEventAsUser(admin, user.id, {action:"sync.start", entity_type:"sync", metadata:{path:"queue", kind:"stitch_composite"}})` right after `admin.rpc("enqueue_compute_job", …)`. `enqueue_compute_job` is in `MUTATING_RPC_NAMES` (audit-coverage.test.ts:205). `npx vitest run audit-coverage.test.ts` → **PASS**. |
| `audit-fanout-integration.test.ts` `strategy_keys` mock | **ALREADY CLOSED — DROP** | Mock present at `audit-fanout-integration.test.ts:811` (`if (table === "strategy_keys") …`). Full file **PASS** in the same run. |
| audit-coverage + audit-fanout green in CI | **ALREADY GREEN — DROP** | `npx vitest run src/__tests__/audit-coverage.test.ts src/__tests__/audit-fanout-integration.test.ts` → **2 files, 28 passed, 1 skipped**. |
| SQL-fn snapshot `enforce_strategy_keys_owner_coherence` | **ALREADY CLOSED — DROP** | `supabase/schema/functions/enforce_strategy_keys_owner_coherence.sql` exists (landed with v1.9 #607, commit `044bee50`); not in the `--check` owed list. |
| SQL-fn snapshot `sync_strategy_analytics_status` | **ALREADY CLOSED — DROP** | `supabase/schema/functions/sync_strategy_analytics_status.sql` exists; not in the `--check` owed list. |
| SQL-fn snapshot drift (**actual owed set**) | **OPEN — real work** | `npm run schema:functions:check` → FAILS: `missing: set_compute_job_progress.sql`, `missing: cleanup_abandoned_wizard_drafts.sql`, `stale: set_wizard_composite_members.sql`. |

### The owed SQL-fn snapshots (confirmed against the CURRENT function set)
The roadmap named the wrong functions (those were already snapshotted with v1.9). The **actual** debt is 3 Phase-95/96 functions whose migrations changed a body without regenerating the hermetic snapshot:

| Snapshot file | Verdict | Owning migration | Phase |
|---------------|---------|------------------|-------|
| `set_compute_job_progress.sql` | missing | `20260712130000_set_compute_job_progress.sql` (commit `18de5ea6 feat(95-02): fenced set_compute_job_progress RPC + SQL gate`) | 95 |
| `cleanup_abandoned_wizard_drafts.sql` | missing | `20260713120000_cleanup_abandoned_wizard_drafts.sql` (hardened by `a8bd5a71 fix(#35)`) | 96 |
| `set_wizard_composite_members.sql` | stale | `20260712120000_wizard_composite_members_invalidate_analytics.sql` (newer body than the committed snapshot) | 95/96 |

**Fix = one command:** `npm run schema:functions` then commit `supabase/schema/functions/`. **Verified this session** that regeneration produces exactly those 3 changes (1 modified + 2 new) and nothing else drifts — the diff is bounded. The tree was left clean (regenerated files reverted/removed) for the planner.

**Why the gate is currently red on the branch but green on `origin/main`:** `sql-function-snapshot.yml` is path-filtered on `supabase/migrations/**` + `supabase/schema/**` and is **hermetic** (pure text-replay, no DB/Docker/secrets). Its last successful run was #607 (2026-07-11) on `origin/main`. The Phase-95/96 migrations that introduce the drift live only on the milestone branch (ahead 75), so the gate has not yet run against them — **it will fire and fail on the milestone→main PR** unless the snapshots are regenerated. That is precisely this phase's debt.

## Architecture Patterns

### System diagram — the three CI gates that ARE the tests
```
                         ┌─────────────────────────────────────────────┐
   git push / PR ───────▶│              GitHub Actions                  │
                         └─────────────────────────────────────────────┘
                                          │
        ┌─────────────────────────────────┼─────────────────────────────────┐
        ▼                                  ▼                                  ▼
 ┌──────────────┐              ┌───────────────────────┐          ┌────────────────────┐
 │ python job   │              │ sql-function-snapshot │          │ frontend (vitest)  │
 │ (ci.yml)     │              │ (path-filtered)       │          │ shards             │
 │ pytest -n    │              │ dump-sql-functions.ts │          │ audit-coverage +   │
 │ auto --dist  │              │ --self-test + --check │          │ audit-fanout       │
 │ loadgroup    │              │ HERMETIC (no DB)      │          │ ALREADY GREEN      │
 │ --cov-fail   │              └───────────┬───────────┘          └─────────┬──────────┘
 │ -under=80    │                          │                                │
 └──────┬───────┘              replays supabase/migrations/**    greps src/app/api/**/route.ts
        │                      → supabase/schema/functions/       for mutation↔audit pairing
  offline bulk ── parallel                                        + runtime fan-out assertion
  DB modules ── xdist_group("shared_test_db") → 1 worker
        │
  live fence tests ── claim_compute_jobs_with_priority (GLOBAL queue)
        │             ▲ FIX: scope assertion/cleanup to own job_id
        ▼
  shared test Supabase project (qmnijlgmdhviwzwfyzlc) ── also touched by e2e job (concurrent)
```

### Pattern 1: Own-row scoping for shared-global-resource tests
**What:** A test that exercises a globally-scoped queue/RPC must assert on rows it created (filter by a unique key it owns), never on positional/global results.
**When to use:** Any live-DB test against `compute_jobs`, `strategy_analytics`, or another shared table on the shared test project.
**Example:** the `_claim_one(..., want_job_id=job_id)` pattern above.

### Pattern 2: Timeout-tolerant live-DB RPC calls
**What:** Wrap contention-prone live RPCs so a genuine `ReadTimeout` degrades to `pytest.skip` while any real error (including the asserted `serialization_failure`) re-raises.
**When to use:** Re-enabling the 3 TODOS-L165 tests; already the house pattern (`_rpc_retry_timeout`).

### Anti-Patterns to Avoid
- **`res.data[0]` on a global claim** — the exact defect. Never assume your row is first/only on a shared queue.
- **Adding a 2nd serial `xdist_group` as the fence fix** — masks the root cause and stays vulnerable to the concurrent e2e job.
- **Hand-editing `supabase/schema/functions/*.sql`** — they are `@generated`; only `npm run schema:functions` may write them.
- **Re-enabling the 3 skipped tests without the timeout guard** — they will flake red for the *timeout* reason, unrelated to #610.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Serialize shared-DB tests under xdist | A custom lock/file-based mutex | `xdist_group` marker (already in #610) + own-row scoping | Built into pytest-xdist; the marker is registered in `pytest.ini` |
| Combine per-worker coverage | Manual `.coverage` merge | `pytest-cov` (xdist-aware) | Already combines; `--cov-fail-under=80` unaffected |
| Detect stale SQL-fn snapshots | A bespoke migration parser | `scripts/dump-sql-functions.ts --check` | Hermetic, self-tested, already the CI gate |
| Assert every mutation is audited | A new lint rule | `audit-coverage.test.ts` (brace-balanced grep) + `audit-fanout-integration.test.ts` | Already green; covers direct chains, mutating RPCs, and import-graph helper mutators |

**Key insight:** every capability this phase needs already exists in the repo; the work is *isolation correctness* in test assertions and a one-command snapshot regeneration — not new infrastructure.

## Common Pitfalls

### Pitfall 1: Shared-test-DB concurrency (the crux)
**What goes wrong:** live fence tests read the global `compute_jobs` queue and see foreign rows from interleaved grouped DB tests or the concurrent e2e job.
**Root cause:** global-queue assumption (`data[0]`), not parallelism per se.
**Avoid:** own-`job_id` scoping (Pattern 1). Verify by inserting a decoy foreign pending row before the claim and confirming the assertion still passes.
**Warning signs:** `claimed["id"] == job_id` AssertionError; green locally (empty queue) but red in CI (contended queue).

### Pitfall 2: A snapshot that drifts vs prod
**What goes wrong:** regenerating the snapshot from migrations captures a body that differs from what's actually applied to prod.
**Root cause:** `dump-sql-functions.ts` replays *committed migrations* (repo truth), while prod reflects *applied* migrations. This gate is **orthogonal** to `migration-drift-check.yml` (repo-vs-prod). It only guarantees migrations-produce-the-committed-bodies.
**Avoid:** don't hand-tune the snapshot to match prod; if repo≠prod that's a *migration-drift* finding, a different gate. Just run `npm run schema:functions` and commit verbatim.
**Warning signs:** manual edits to a `@generated` file; a `--check` that keeps failing after regeneration (indicates a parser edge case, run `--self-test`).

### Pitfall 3: Re-enabling a test flaky for a DIFFERENT reason than #610
**What goes wrong:** the 3 TODOS-L165 tests are re-enabled expecting CI-01's fix to cover them; they flake red on `ReadTimeout`.
**Avoid:** re-enable only behind `_rpc_retry_timeout`; treat as NON-BLOCKING; re-justify deferral if a canary CI run still flakes.
**Warning signs:** `httpx.ReadTimeout` at ~120s; failures only under full live-suite load, not python-only re-runs.

## Runtime State Inventory

This phase edits test code, CI YAML, and regenerates committed snapshots — no rename/migration of stored data. Explicit sweep:

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — no data keys renamed. The shared test project (`qmnijlgmdhviwzwfyzlc`) holds transient `compute_jobs` rows that tests create/clean; the fix changes *how tests scope claims*, not stored schema. | Code edit only (test assertions) |
| Live service config | `.github/workflows/ci.yml` `python:` step invocation (already changed by #610); `sql-function-snapshot.yml` (unchanged — path-filtered gate). CI concurrency group `shared-test-db` unchanged. | Adopt #610's ci.yml change; no new service config |
| OS-registered state | None. | None |
| Secrets/env vars | `TEST_SUPABASE_URL` / `TEST_SUPABASE_SERVICE_ROLE_KEY` + `vars.E2E_TEST_DB_CONFIGURED` gate the live fence tests (wired by PR #149). No new secrets; names unchanged. | None |
| Build artifacts | `supabase/schema/functions/*.sql` are `@generated` — 3 will change after `npm run schema:functions`. Committed, tracked. | Regenerate + commit exactly 3 files |

## Code Examples

### Regenerate the owed SQL-fn snapshots (bounded, verified this session)
```bash
# Source: package.json:22-23 (verified — produces exactly 3 changes)
npm run schema:functions
git status --short supabase/schema/functions/
#  M supabase/schema/functions/set_wizard_composite_members.sql
# ?? supabase/schema/functions/cleanup_abandoned_wizard_drafts.sql
# ?? supabase/schema/functions/set_compute_job_progress.sql
npm run schema:functions:check   # must now print nothing / exit 0
```

### Own-row-scoped claim helper (the fence fix)
```python
# Source: analytics-service/tests/test_compute_jobs_fencing.py (recommended change)
def _claim_one(admin, worker_id, *, want_job_id=None):
    res = admin.rpc("claim_compute_jobs_with_priority", {
        "p_batch_size": 50, "p_worker_id": worker_id,
        "p_unified_backbone_active": False,
    }).execute()
    rows = res.data or []
    if want_job_id is not None:
        return next((r for r in rows if r["id"] == want_job_id), None)
    return rows[0] if rows else None
# call sites (13): _claim_one(admin, "p97-claim-test", want_job_id=job_id)
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Serial python CI (~34.6s local, ~3.6k tests) | `pytest -n auto --dist loadgroup` | PR #610 (draft, 2026-07-11) | ~2× wall-clock on 4-vCPU runners; needs the fence-isolation fix to land |
| Grep-every-migration to know a fn body | Committed hermetic snapshot + `--check` gate | tech-debt #2, `4e7555c0` | Drift caught in CI; this phase settles the 3 owed Phase-95/96 snapshots |

**Deprecated/outdated:** the roadmap's named snapshots (`enforce_strategy_keys_owner_coherence`, `sync_strategy_analytics_status`) as "owed" — outdated; both already landed with v1.9 #607.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Per-run-`job_id` scoping is sufficient to make the live fence job green under `-n auto` in CI | CI-01 fix | Needs a live CI run to confirm (offline suite can't reproduce the shared-DB contention). If insufficient, fall back to a dedicated `fence_serial` xdist_group. **NON-BLOCKING** — verifiable on the PR's own CI. |
| A2 | The 3 TODOS-L165 tests become CI-safe behind `_rpc_retry_timeout` | CI-02.1 | If they still flake, re-justify deferral (mocked + DO-block coverage). NON-BLOCKING by design. |
| A3 | Regenerating snapshots yields exactly the 3 files and matches prod-applied bodies | CI-02.2 | Low — bounded diff verified this session; body-vs-prod is a *different* gate (migration-drift), out of scope. |

## Open Questions

1. **Does per-run-`job_id` scoping fully green the live fence job in CI?**
   - Known: it removes the `data[0]` foreign-row failure mode deterministically in logic.
   - Unclear: whether any *other* live fence assertion also makes a global-queue assumption under contention (13 `_claim_one` sites + direct-RPC sites to audit).
   - Recommendation: audit all live-test claim/assert sites for own-row scoping in one pass; confirm on the #610 PR CI (NON-BLOCKING locally). Add a decoy-foreign-row regression that fails without the scoping.

2. **Re-enable vs re-justify the 3 TODOS-L165 tests?**
   - Known: different (timeout) root cause; mocked + DO-block already guard the contract.
   - Recommendation: attempt re-enable behind `_rpc_retry_timeout`; if a canary run flakes, record a re-justified deferral in TODOS.md. Either outcome satisfies CI-02.1.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `gh` CLI | reading/landing #610 | ✓ | (authed) | — |
| `npx tsx` / `npm run schema:functions` | SQL-fn snapshot regen | ✓ | ran successfully | — |
| `npx vitest` | audit gate verification | ✓ | v4.1.10 (ran) | — |
| shared test Supabase project (`qmnijlgmdhviwzwfyzlc`) | live fence tests | live only in CI (`E2E_TEST_DB_CONFIGURED=true`) | — | offline suite + mocked fence tests prove no regression locally |
| `pip`/pytest-xdist locally | local python parallel run | ✗ (offline pip this session) | — | verified via #610's own local A/B + CI; not needed for research |

**Missing dependencies with no fallback:** none.
**Missing dependencies with fallback:** local live-DB fence execution — confirm on the PR's CI instead (NON-BLOCKING).

## Validation Architecture

`nyquist_validation: true` (config). **For this phase the CI gates ARE the tests.**

### Test Framework
| Property | Value |
|----------|-------|
| Frameworks | pytest (+ pytest-xdist, pytest-cov) for analytics-service; vitest ^4.1.2 for TS gates; tsx for the hermetic snapshot gate |
| Config files | `analytics-service/pytest.ini`, `analytics-service/Makefile`, `vitest.config.ts`, `.github/workflows/ci.yml`, `.github/workflows/sql-function-snapshot.yml` |
| Quick run (offline, per-commit) | `npm run schema:functions:check` · `npx vitest run src/__tests__/audit-coverage.test.ts src/__tests__/audit-fanout-integration.test.ts` |
| Full suite (per-PR / CI) | `pytest -n auto --dist loadgroup --cov=… --cov-fail-under=80` (needs the test Supabase project) |

### Phase Requirements → Test Map
| Req | Behavior | Test Type | Automated command | Fails-without-fix | Exists? |
|-----|----------|-----------|-------------------|-------------------|---------|
| CI-01 | python suite green under `-n auto`; fence parallelism-safe | integration (live-DB) | `pytest -n auto --dist loadgroup …` (CI) | live fence tests fail on foreign `data[0]` row | ✅ tests exist; fix = own-`job_id` scoping. Add a **decoy-foreign-row** unit-level regression so it fails offline too. |
| CI-02.1 | 3 deferred tests re-enabled-or-re-justified | integration (live-DB) or doc | `pytest -k "late_mark"` (CI) | tests `ReadTimeout` unless guarded | ✅ tests exist (skipped). Guard = `_rpc_retry_timeout`. |
| CI-02.2 (snapshot) | `schema:functions:check` green | hermetic build gate | `npm run schema:functions:check` | 3 owed files (2 missing, 1 stale) | ✅ gate exists; fix = regenerate + commit |
| CI-02.2 (audit) | audit-coverage + fanout green | vitest | `npx vitest run …audit-coverage.test.ts …audit-fanout-integration.test.ts` | **already green — DROP** | ✅ 28 passed |

### Sampling Rate
- **Per task/commit:** `npm run schema:functions:check` + the two audit vitest files (all offline, deterministic, seconds).
- **Per PR / wave merge:** full `pytest -n auto` against the shared test project (the only gate needing the live DB).
- **Phase gate:** #610's `python` check green **and** `sql-function-snapshot` check green on the milestone PR before `/gsd:verify-work`.

### Wave 0 Gaps
- [ ] Add a **decoy-foreign-row regression** in `test_compute_jobs_fencing.py` (insert an unrelated pending `compute_jobs` row, then assert the scoped claim still returns the test's own job) so CI-01's isolation is provable **offline/mocked** and fails without the fix — otherwise the only signal is a live CI run.
- [ ] No new framework install needed — pytest-xdist arrives with #610; vitest + tsx already present.
- *(No test-file scaffolding gaps otherwise — all target tests already exist.)*

## Security Domain

`security_enforcement` not disabled in config → included. This phase is CI/test-infra; the security surface is narrow.

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | — (test infra) |
| V4 Access Control | indirect | fence tests exercise `claim_token` fencing (a worker-ownership invariant); don't weaken the assertion when scoping to own rows |
| V5 Input Validation | no | — |
| V6 Cryptography | no | — (worker-only key decryption is LOCKED and untouched) |
| V14 Config | yes | CI YAML change keeps `--cov-fail-under=80`; hermetic snapshot gate has no secrets (can't exfiltrate); `TEST_SUPABASE_*` secrets are gated by `E2E_TEST_DB_CONFIGURED` and never printed |

### Known Threat Patterns for this stack
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| A test change silently lowers the coverage gate | Tampering | Keep `--cov-fail-under=80` byte-identical CI↔Makefile (#610 already does) |
| Snapshot gate flakes/leaks | Info disclosure / DoS | Gate is hermetic (no DB/secrets) by design — preserve that; never add a DB dependency to it |
| Scoping-to-own-rows accidentally weakens the fence assertion | Tampering | The `serialization_failure` (SQLSTATE 40001) assertion must remain; scope *which row* is claimed, never *whether* the fence raises |

## Sources

### Primary (HIGH confidence)
- `gh pr view 610` / `gh pr diff 610` / `gh pr checks 610` — #610 diff, hold comment, red `python` check (verified this session)
- `analytics-service/tests/test_compute_jobs_fencing.py` — `_claim_one`, live-DB fixtures, 3 skip reasons, `_rpc_retry_timeout` (read directly)
- `TODOS.md:165-186` — the real "flaky live-DB fence tests" tracker (PR #149)
- `npm run schema:functions:check` — owed-file verdict (ran; 3 files)
- `npm run schema:functions` — bounded regeneration (ran + reverted; exactly 3 changes)
- `npx vitest run audit-coverage.test.ts audit-fanout-integration.test.ts` — **28 passed, 1 skipped** (ran)
- `src/app/api/strategies/finalize-wizard/route.ts` — existing `logAuditEventAsUser` at the `stitch_composite` enqueue (read)
- `src/__tests__/audit-coverage.test.ts:203-241` (`MUTATING_RPC_NAMES` incl. `enqueue_compute_job`), `src/__tests__/audit-fanout-integration.test.ts:811` (`strategy_keys` mock)
- `scripts/dump-sql-functions.ts` header — hermetic text-replay design (read)
- `.github/workflows/sql-function-snapshot.yml` — path-filtered hermetic gate; `gh run list` last success = #607 (read)
- `git rev-parse` / `git status -sb` — branch ahead 75 of origin/main; migrations committed on branch

### Secondary (MEDIUM confidence)
- `pypi.org/project/pytest-xdist` — `--dist loadgroup` / `xdist_group` semantics (well-established pytest-dev plugin) `[CITED]`

### Tertiary (LOW confidence)
- none

## Metadata

**Confidence breakdown:**
- CI-01 root cause + fix: **HIGH** — read the exact failing assertion, the hold comment, and #610's diff.
- CI-02.1 assessment: **HIGH** — read all 3 skip reasons + TODOS tracker; root cause is unambiguously timeout, not isolation.
- CI-02.2 verified-against-branch: **HIGH** — ran the gates; owed set is deterministic and bounded.
- Live-CI green after the fix: **MEDIUM (A1)** — logic is sound but only a live CI run fully confirms; flagged NON-BLOCKING with a fallback.

**Research date:** 2026-07-12
**Valid until:** ~2026-07-26 (fast-moving branch; re-verify the owed-snapshot set and #610 CI state if more phases land before planning)
