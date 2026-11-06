# Phase 158: OPS-CI — A merge means a deploy - Pattern Map

**Mapped:** 2026-08-20
**Files analyzed:** 10 new/modified surfaces
**Analogs found:** 9 / 10 (DB-types decision artifact has no code analog — it's prose)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `.github/workflows/ci.yml` (mutex adoption, 3 jobs) | config (CI workflow) | request-response (lock acquire/release) | its own `shared-test-db` blocks + `sql-tests` psql install (`ci.yml:947-1000` region) | exact (in-file) |
| `.github/workflows/ci.yml` (`frontend` aggregator + `sql-tests`) | config (CI gate) | batch (result aggregation) | existing `e2e-seeded` arm in the same aggregator (`ci.yml:794-831`) | exact (in-file) |
| NEW `.github/workflows/main-ci-cancelled-watcher.yml` | config (CI workflow) | event-driven (`workflow_run`) | `.github/workflows/analytics-deploy-verify.yml` | exact |
| NEW `.github/workflows/mutex-probe.yml` (Wave-0, deletable) | config (CI probe) | request-response | `analytics-deploy-verify.yml` skeleton (dispatch trigger, checkout, pins) | role-match |
| `analytics-service/tests/test_compute_jobs_fencing.py` (2 UPDATEs) | test | CRUD | same file's backdate-stamp pattern (`:1108-1110`, `:1277-1279`) | exact (in-file) |
| NEW `e2e/my-strategies.spec.ts` | test (Playwright seeded) | request-response | `e2e/wizard-resume.spec.ts` | exact |
| `ci.yml` seeded-batch list (wire orphans + new spec) | config | batch | seeded list `ci.yml:1774-1797` + MA-8 comment `:1757-1762` | exact (in-file) |
| NEW `scripts/drain-test-compute-backlog.ts` | utility (guarded script) | CRUD (TEST-only) | `scripts/seed-demo-data.ts` (interlock `:651-657` region) | exact |
| `MultiKeyConnectStep` test hygiene (OPS-11) | test | request-response | `vitest.config.ts:50-69` fence + `src/test-setup.leak-canary.test.ts` (DEF-16-1) | exact |
| NEW `docs/runbooks/shared-test-db-mutex.md` | docs (runbook) | n/a | `docs/runbooks/seam-breaker.md`, `compute-queue.md` (28 runbooks in that dir) | exact (location) |

## Pattern Assignments

### `.github/workflows/main-ci-cancelled-watcher.yml` (NEW — workflow, event-driven)

**Analog:** `.github/workflows/analytics-deploy-verify.yml` (also mirrored by nightly.yml, cassette-refresh.yml)

**Header doctrine to copy** (`analytics-deploy-verify.yml:17-24`, verbatim — this is the load-bearing constraint):
```yaml
# CRITICAL: this job exits 0 even when prod is stale. It MUST NOT fail the
# check. A red check on a (HEAD) commit makes Railway's "wait for CI" treat the
# commit's check-suite as red and SKIP the very deploy this probe verifies — a
# self-defeating deadlock that left prod stale on 2026-06-21 ...
```
The watcher attaches its check to main-HEAD; it must ALWAYS exit 0 — the dedup'd issue is the loud signal, never a red check.

**Permissions + concurrency pattern** (`analytics-deploy-verify.yml:45-51`):
```yaml
permissions:
  contents: read
  issues: write

concurrency:
  group: analytics-deploy-verify
  cancel-in-progress: false
```
(Add `actions: write` ONLY if the optional single-rerun ships.)

**Trigger shape** (new — no in-repo `workflow_run` precedent; per RESEARCH):
```yaml
on:
  workflow_run:
    workflows: ["CI"]        # ci.yml:1 name is exactly "CI"
    types: [completed]
    branches: [main]
  workflow_dispatch:
    inputs:
      run_id:                 # testability: exercise the issue path on a
        description: ...      # historical cancelled run (31273384829)
```
Body-gate on `github.event.workflow_run.conclusion == 'cancelled' && head_branch == 'main' && event == 'push'`.

**Checkout convention** (C-0293 invariant — every workflow, even checkout-less ones):
```yaml
      - uses: actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0  # v7.0.0
        with:
          persist-credentials: false
```
Actions pinned by FULL SHA + version comment — repo-wide convention.

**Dedup'd-issue github-script block** (`analytics-deploy-verify.yml:114-160`, copy verbatim shape; use a NEW label e.g. `main-ci-cancelled`, not `analytics-deploy-stale`):
```yaml
      - name: Open or update GitHub issue on ...
        if: steps.probe.outputs.stale == 'true'
        uses: actions/github-script@3a2844b7e9c422d3c10d287c895573f7108da1b3  # v9.0.0
        env:
          RUN_ID: ${{ github.run_id }}
          REPO_NAME: ${{ github.repository }}
        with:
          script: |
            const dedupLabel = "analytics-deploy-stale";     // <- new label here
            const { data: existing } = await github.rest.issues.listForRepo({
              owner: context.repo.owner, repo: context.repo.repo,
              state: "open", labels: dedupLabel, per_page: 1,
            });
            if (existing.length > 0) {
              await github.rest.issues.createComment({ ...issue_number: existing[0].number,
                body: `Still stale on ${today}. ${detail} Workflow run: ${runUrl}` });
              return;
            }
            await github.rest.issues.create({ ...
              title: `... — ${today}`,
              labels: ["analytics-service", "p1", dedupLabel],
            });
```
Note the pattern passes context via `env:` into the script (never interpolates `${{ }}` inside the script body — injection hygiene).

---

### `.github/workflows/ci.yml` — mutex adoption (config, three jobs)

**Analogs are in-file.** The three blocks to REMOVE (identical, verbatim):
```yaml
    concurrency:
      group: shared-test-db
      cancel-in-progress: false
```
Locations: `sql-tests` `:936-938`, `python` `:1143-1145`, `e2e-seeded` `:1540-1542`. The surrounding ⛔ comments (`:906-933`, `:1543-1550`) document the eviction mechanism and both banned fixes — rewrite them to describe the mutex, do not delete the institutional knowledge.

**psql availability pattern:** `sql-tests` already installs postgresql-client per-job (`ci.yml:947-950` region) and consumes `secrets.TEST_SUPABASE_DB_URL` with the documented DSN format at `ci.yml:1015` (pooler port 6543 — ⚠️ session-mode probe is the Wave-0 go/no-go, per RESEARCH Pitfall 3).

**Fork-PR no-op arm pattern:** mirror the composition documented at `e2e-seeded` (`ci.yml:1516-1519`): secrets are withheld on fork PRs while vars are readable — the mutex-acquire step must no-op on empty `TEST_SUPABASE_DB_URL`, never fail.

**Keep:** `sql-tests` `needs: [python]` (`ci.yml:934-935`) and the top-of-file per-PR group (`:39-41`) — both untouched.

---

### `.github/workflows/ci.yml` — `frontend` aggregator + `sql-tests` (config, batch)

**Analog:** the existing `e2e-seeded` skip-tolerance arm in the same job.

**Both-places rule** (header comment `:750-755`): wire `sql-tests` into BOTH the `needs:` list (`:780-788`) AND the result loop, or it stays advisory (the exact `frontend-seam-redis` warning at `:773-778`).

**The arm to copy** (`ci.yml:805-826`, verbatim core):
```bash
            if [ "$name" = "e2e-seeded" ]; then
              is_fork_pr='${{ github.event_name == 'pull_request' && github.event.pull_request.head.repo.full_name != github.repository }}'
              if [ "$result" = "success" ]; then
                :
              elif [ "$result" = "skipped" ] && [ "$is_fork_pr" = "true" ]; then
                echo "e2e-seeded skipped (fork PR — no test-DB access); tolerated for this row only."
              else
                echo "::error::e2e-seeded result=$result on a TRUSTED event ..."
                fail=1
              fi
            elif [ "$result" != "success" ]; then
              fail=1
            fi
```
**Divergence for `sql-tests`:** its `if:` (`:880`) also skips on `workflow_dispatch` (`event_name == 'push'` false), so its arm must tolerate skip on **fork PR OR workflow_dispatch** (add an `is_dispatch` check on `github.event_name == 'workflow_dispatch'`), and treat skip on push/same-repo-PR as failure ("E2E_TEST_DB_CONFIGURED was LOST" detection, per `:810-811`).

---

### `analytics-service/tests/test_compute_jobs_fencing.py` (test, CRUD)

**Analog:** the same file's established stamp pattern. Every other direct UPDATE that touches `claimed_at` writes it explicitly, e.g. `:1108-1110`:
```python
        admin.table("compute_jobs").update({
            "claimed_at": "2020-01-01T00:00:00Z",
        }).eq("id", job_id).execute()
```
(same shape at `:1277-1279`, `:1361`, `:1726`, `:1807`).

**The two defective UPDATEs** (`:1148-1152` in `test_defer_compute_job_token_fence`, `:1200-1204` in `test_defer_compute_job_null_token_backcompat`) set `status/claim_token/attempts` but omit `claimed_at`:
```python
        admin.table("compute_jobs").update({
            "status": "running",
            "claim_token": real_token,
            "attempts": 1,
        }).eq("id", job_id).execute()
```
**Fix pattern:** add `"claimed_at": <current ISO timestamp>` to both payloads (current, not backdated — these rows must be reapable if the test dies, per the reaper predicate `claimed_at IS NOT NULL AND claimed_at < now() - threshold`, migration `20260516104201:667-668`). Run pytest ONLY from `analytics-service/`.

---

### `e2e/my-strategies.spec.ts` (NEW — test, seeded Playwright)

**Analog:** `e2e/wizard-resume.spec.ts` (seeded batch member; canonical mint-own-user pattern).

**Seed + auth pattern** (`wizard-resume.spec.ts:82-111`):
```typescript
    test.skip(!HAS_SEED_ENV, "requires seed env");

    // Owner FIRST: the read is RLS-bound to the logged-in user.
    const allocator = await seedTestAllocator({ role: "both" });
    // ... seed the invariant this spec asserts, prefixed:
    const draft = await seedWizardDraft({ ownerUserId: allocator.userId, namePrefix: NAME_PREFIX });
    ...
    await loginViaForm(page, allocator.email, allocator.password);
```
Helpers from `e2e/helpers/seed-test-project.ts`. Cleanup via `cleanupStrategiesByNamePrefix(NAME_PREFIX)` in a `beforeEach`/`afterAll` guarded by `HAS_SEED_ENV` (`:70-73`). Do NOT use `E2E_TEST_EMAIL` — those secrets don't exist in CI.

**Binding assertion rules:**
- Assert OWN-seed invariants only, never global DB state (PR #654 lesson — the TEST project is polluted by construction).
- Selector rule (DEF-149-B): `/strategies` and `/my-strategies` both render `h1` "My Strategies" — scope by route/`href`/`data-testid` (Sidebar precedent: `a[href="/my-strategies"]`), never bare heading text.

**Batch wiring pattern:** append to the seeded list (`ci.yml:1774-1797`, one `e2e/<name>.spec.ts \` line) AND honor the MA-8 joining rule (`:1757-1762`): *"Update both this list and the `e2e/<spec>.spec.ts` HAS_SEED_ENV constant."* Twin warning on the unseeded list at `:1379-1384`. Verify ≥1 case actually executes (all-skip = false coverage).

---

### `scripts/drain-test-compute-backlog.ts` (NEW — utility, TEST-only CRUD)

**Analog:** `scripts/seed-demo-data.ts` TEST-only interlock (`:645-665`):
```typescript
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) { throw new Error("Missing ..."); }
  // Hard guard against running against production. ...
  if (/\b(prod|production)\b/i.test(url)) {
    throw new Error(`[seed] Refusing to run against production-flavored URL: ${url}`);
  }
  if (process.env.SEED_CONFIRM_STAGING !== "true") {
    throw new Error("[seed] Refusing to run without SEED_CONFIRM_STAGING=true. ...");
  }
```
**Extend the guard:** additionally hard-reject any URL containing the PROD ref `khslejtfbuezsmvmtsdn` and (optionally) require the TEST ref `qmnijlgmdhviwzwfyzlc` (verbatim named in `ci.yml:1003`). Secrets by NAME only in code/docs — repo is PUBLIC.

---

### `MultiKeyConnectStep` test hygiene (OPS-11)

**Corrected paths:** component + specs live under `src/app/(dashboard)/strategies/new/wizard/steps/` (NOT `src/components/**`): `MultiKeyConnectStep.test.tsx` (2,836 lines, 72 cases), `MultiKeyConnectStep.payload.test.ts`.

**Remedy pattern (DEF-16-1), source `src/test-setup.leak-canary.test.ts` docblock, verbatim:** *"The standing constraint is `vi.spyOn` + `restoreAllMocks`, never `vi.stubGlobal`."*

**Config fence already in place** (`vitest.config.ts:68-69`):
```ts
    unstubGlobals: true,
    unstubEnvs: true,
```
Its comment (`:51-67`) explains: config-level runs BEFORE each test, cannot be shadowed by a file-local `afterEach`; `unstubEnvs` covers only `vi.stubEnv()` — direct `process.env.X =` writes are covered by the separate snapshot restore in `src/test-setup.ts`; the leak-canary fails if either mechanism is removed (SC-HARNESS-1 / SC-ENV-1).

**In-file hygiene already present** (`MultiKeyConnectStep.test.tsx`): one file-level `vi.mock(...)` at `:37`, global `afterEach` with `vi.restoreAllMocks()` + `cleanup()` (`:93-96`), local `vi.unstubAllGlobals()` at `:1276`, `:1598`. ⇒ Reproduce at HEAD FIRST (`npx vitest run --sequence.shuffle --sequence.seed=<n>`, Node-22 PATH variant); if a leaking sibling file is found, apply the DEF-16-1 pattern there.

---

### `docs/runbooks/shared-test-db-mutex.md` (NEW — runbook)

**Location analog:** `docs/runbooks/` — 28 existing runbooks (`seam-breaker.md`, `compute-queue.md`, `railway-worker.md`, `deploy-rollback.md`, ...). Ops runbooks unambiguously live here; index in `docs/runbooks/README.md`.

**Content precedent:** the wedged-PostgREST remedy (MEMORY) already uses `pg_terminate_backend` on TEST — the manual-unlock section uses the same primitive: find the holder via `pg_stat_activity`/`pg_locks`, `SELECT pg_terminate_backend(pid)`, note the next waiter proceeds immediately. Reference secret NAMES only (`TEST_SUPABASE_DB_URL`), never values — repo is PUBLIC.

Note: `docs/runbooks/**/*.md` appears in a ci.yml paths list around `:1130` — a new runbook may trigger that path filter; harmless, but be aware.

## Shared Patterns

### Actions pinning
**Source:** every workflow in `.github/workflows/`
**Apply to:** both new workflows
```yaml
uses: actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0  # v7.0.0
uses: actions/github-script@3a2844b7e9c422d3c10d287c895573f7108da1b3  # v9.0.0
```
Full SHA + version comment; `persist-credentials: false` on every checkout (C-0293).

### Least-privilege GITHUB_TOKEN
**Source:** `ci.yml:52-53` (`permissions: contents: read`) + `analytics-deploy-verify.yml:45-47` uplift
**Apply to:** both new workflows — default `contents: read`, uplift `issues: write` only on the watcher.

### Exit-0-on-detection (never red-check main HEAD)
**Source:** `analytics-deploy-verify.yml:17-24` + the `exit 0` after the `::warning::` (`:106-111`)
**Apply to:** the watcher and (if kept) the mutex probe when attached to main SHAs.

### Env-into-github-script (no `${{ }}` inside script bodies)
**Source:** `analytics-deploy-verify.yml:116-121`
**Apply to:** the watcher's issue step.

### TEST-only interlock
**Source:** `scripts/seed-demo-data.ts:651-657`
**Apply to:** the drain script (extended with PROD-ref rejection).

### Own-seed assertion + name-prefix cleanup
**Source:** `e2e/wizard-resume.spec.ts` (`NAME_PREFIX`, `cleanupStrategiesByNamePrefix`, `HAS_SEED_ENV` skip)
**Apply to:** `my-strategies.spec.ts` and any repaired orphan spec being wired.

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `workflow_run` trigger shape (within the watcher) | config | event-driven | No existing workflow uses `on: workflow_run` — trigger shape comes from RESEARCH (GitHub docs, verified); everything else in the watcher copies `analytics-deploy-verify.yml` |
| DB-types recorded-decision artifact | docs | n/a | Prose decision, not code; compensating control = extend `src/lib/database.types.test.ts` pins (established pattern, C-0156 / PERSIST-01 docblocks) |

## Metadata

**Analog search scope:** `.github/workflows/`, `analytics-service/tests/`, `e2e/` + `e2e/helpers/`, `scripts/`, `src/app/(dashboard)/strategies/new/wizard/steps/`, `vitest.config.ts`, `src/test-setup*`, `docs/runbooks/`
**Files scanned:** ~15 read directly (targeted ranges); line anchors verified at HEAD this session
**Pattern extraction date:** 2026-08-20
