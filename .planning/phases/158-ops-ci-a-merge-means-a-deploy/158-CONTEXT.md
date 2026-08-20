# Phase 158: OPS-CI — A merge means a deploy - Context

**Gathered:** 2026-08-20
**Status:** Ready for planning
**Mode:** Autonomous (infrastructure phase — discuss skipped per smart-discuss infrastructure detection)

<domain>
## Phase Boundary

A merged PR always produces an honestly-reported CI verdict and a deployed analytics service — main CI can no longer conclude `cancelled` and silently skip the Railway deploy, no gate is present-but-ungating, and the two known deterministic false-reds are gone.

Covers OPS-01 (FIFO mutex + cancelled-conclusion watcher, closes #616), OPS-02 (`sql-tests` gated via aggregator `needs:`), OPS-03 (orphaned e2e specs incl. NAV-01 in a CI batch; DB-types drift regeneration gate or recorded decision), OPS-04 (TEST-only stale-`pending` drain + `claimed_at` stamps in `test_compute_jobs_fencing.py`), OPS-11 (`MultiKeyConnectStep` order-sensitive flake root-caused).

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
All implementation choices are at Claude's discretion — pure infrastructure phase. Bind to the ROADMAP success criteria and the research corrections already folded into REQUIREMENTS.md:

- **OPS-01 fix shape is binding:** external FIFO mutex for DB-touching jobs + a `cancelled`-conclusion watcher. ⚠️ Shrinking the `shared-test-db` concurrency group is NOT acceptable (eviction is cross-run). ⚠️ Do NOT add more `needs:` edges to "finish the chain" (the `if:` conditions diverge on `workflow_dispatch` and it would disable `e2e-seeded` on every manual run). The mutex needs a TTL/steal path and a documented manual-unlock runbook as part of adoption. Close #616 on the MECHANISM. Verification must simulate THREE concurrent runs, not two.
- **OPS-04 constraints are hard:** the drain is TEST-only — ⛔ never a migration, ⛔ never `cron.unschedule(9)`.
- **OPS-11:** fix the unrestored `vi.stubGlobal`/`vi.mock` root cause (`vi.spyOn` + `restoreAllMocks` pattern per prior CI-Node22 findings), not retried away.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `.github/workflows/analytics-deploy-verify.yml:111-137` — the dedup'd-issue pattern (label-keyed `listForRepo` → comment-or-create) to copy for the `cancelled`-conclusion watcher. Mirrors nightly.yml / cassette-refresh.yml.
- `.github/workflows/ci.yml:1143-1145` — the `shared-test-db` repo-wide concurrency group (`cancel-in-progress: false`) whose single-pending-slot semantics cause the cross-run eviction (documented at ci.yml:908-910).

### Established Patterns
- Top-level workflow concurrency at ci.yml:39-41 (`ci-<workflow>-<head_ref||run_id>`, cancel-in-progress: true) is per-PR isolation only — distinct from the shared-DB group.
- Minimal default GITHUB_TOKEN scope (`contents: read`) with per-job uplifts — any new watcher job needing `issues: write` must uplift explicitly, mirroring analytics-deploy-verify.yml `permissions`.
- Actions pinned by full SHA with version comments.

### Integration Points
- `ci.yml` DB-touching jobs under the `shared-test-db` group (python suite at ~L1135, e2e-seeded at ~L1540) — these adopt the FIFO mutex.
- `analytics-service/tests/test_compute_jobs_fencing.py` — two direct UPDATEs need `claimed_at` stamps (OPS-04).
- TEST Supabase project — stale-`pending` `compute_jobs` backlog drain (script/manual runbook, not a migration).
- `src/components/**/MultiKeyConnectStep*` vitest specs (OPS-11).

</code_context>

<specifics>
## Specific Ideas

- GitHub issue #616 must be closed by the mechanism fix, with the closing rationale on the mechanism (cross-run eviction), not symptom convergence.
- ROADMAP research note: mechanism already understood — skip a dedicated research phase; copy the existing dedup'd-issue pattern.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>
