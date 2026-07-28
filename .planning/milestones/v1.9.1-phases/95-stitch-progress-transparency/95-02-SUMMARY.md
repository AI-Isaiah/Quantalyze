---
phase: 95-stitch-progress-transparency
plan: 02
subsystem: database
tags: [postgres, jsonb, claim-token-fence, compute-jobs, stitch, composite, worker]

# Dependency graph
requires:
  - phase: 95-01
    provides: SyncProgress poll-loop characterization (read side this write feeds)
provides:
  - "Claim-token-fenced JSONB-merge RPC set_compute_job_progress (migration 20260712130000)"
  - "Per-member {seq, exchange, label, status} progress + server-stamped member_progress_at heartbeat in compute_jobs.metadata"
  - "Best-effort, fail-open, cash-pass-only progress writes in run_stitch_composite_job._reconstruct_all"
affects: [95-03, 95-04, stitch-progress, wizard-poller, stall-detector]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Fenced JSONB `||` merge (preserve-not-clobber) mirroring the P97 mark/defer RPCs"
    - "Best-effort side-channel write: fail-open try/except, CancelledError re-raise"
    - "Snapshot-per-write (dict copy per entry) so shared mutable progress state emits stable payloads"

key-files:
  created:
    - supabase/migrations/20260712130000_set_compute_job_progress.sql
    - supabase/tests/test_set_compute_job_progress.sql
  modified:
    - analytics-service/services/job_worker.py
    - analytics-service/tests/test_stitch_composite_job.py

key-decisions:
  - "search_path pinned to `public, pg_catalog` (matches the mark_/defer_ fenced RPCs) rather than the plan's `public`-only — a minor hardening consistent with the sibling SECURITY DEFINER functions"
  - "WARNING-2: took the documented-12-min path (no cheap in-flight tick exists without restructuring the crawl) — heartbeat is member-boundary only; 95-03 should use a ~12-min stall threshold"
  - "Progress entries built field-by-field from ctx.key_row (never a key_row spread) to hold the WIZ-01 secretless boundary"

patterns-established:
  - "Cash-pass-only progress scoping via a report_progress flag so the MTM second pass cannot restart the per-member counter (Pitfall 1 / SC-4 byte-identity)"

requirements-completed: [PROG-02]

# Metrics
duration: ~35min
completed: 2026-07-12
---

# Phase 95 Plan 02: Stitch Progress (write side) Summary

**The composite stitch worker now publishes per-member `{seq, exchange, label, status}` progress plus a server-stamped `member_progress_at` heartbeat into `compute_jobs.metadata` through a claim-token-fenced JSONB-merge RPC — best-effort, fail-open, cash-pass-only, and with zero effect on the stitched series/metrics.**

## Performance

- **Duration:** ~35 min
- **Tasks:** 3 completed (Task 3 is a verification-only gate — no code)
- **Files created:** 2 · **Files modified:** 2

## Accomplishments
- New fenced RPC `set_compute_job_progress(p_job_id, p_claim_token, p_progress)` merges progress into `metadata` without clobbering `source` / `correlation_id` / `unified_backbone_at_claim`.
- Worker writes progress at every member boundary (all-waiting → in_process → successful/degraded), field-by-field, fail-open.
- SC-4 byte-identity preserved: all four parity pins pass **unmodified** (103 tests).

## Task Commits

1. **Task 1: Migration + SQL gate** — `18de5ea6` (feat)
2. **Task 2 (RED): failing member-progress tests** — `4cd479d8` (test)
3. **Task 2 (GREEN): worker progress writes** — `59ccaba6` (feat)
4. **Task 3: SC-4 parity re-run** — verification only, no commit (zero edits to the three pure-parity files)

## Files Created/Modified
- `supabase/migrations/20260712130000_set_compute_job_progress.sql` — the fenced JSONB-merge RPC (service-role only).
- `supabase/tests/test_set_compute_job_progress.sql` — CI sql-tests gate: privilege + fenced merge + key survival + stale/NULL/done no-ops; uuid-scoped, BEGIN/ROLLBACK.
- `analytics-service/services/job_worker.py` — `_reconstruct_all` gains `report_progress`; cash-pass call site passes `report_progress=True` (`:3612`), MTM stays False (`:3795`); `_write_member_progress` closure + boundary writes.
- `analytics-service/tests/test_stitch_composite_job.py` — `TestMemberProgress` group (6 tests) + `_FakeSupabase.raise_on_rpc` fail-open harness.

## Implementation Detail

### RPC signature + fence predicate
```sql
set_compute_job_progress(p_job_id UUID, p_claim_token UUID, p_progress JSONB) RETURNS BOOLEAN
```
Fence (WHERE clause on the UPDATE):
```sql
WHERE id = p_job_id
  AND claim_token IS NOT DISTINCT FROM p_claim_token
  AND claim_token IS NOT NULL
  AND status = 'running'
```
Merge: `metadata = COALESCE(metadata,'{}'::jsonb) || jsonb_build_object('member_progress', p_progress, 'member_progress_at', to_jsonb(now()))`. `RETURN FOUND` (best-effort, never raises). `REVOKE ALL FROM PUBLIC, anon, authenticated; GRANT EXECUTE TO service_role`.
- **Migration filename:** `supabase/migrations/20260712130000_set_compute_job_progress.sql` (after the prior latest `20260712120000`).
- **Migration discipline:** `grep -rn set_compute_job_progress supabase/migrations/` → none (new function, nothing to re-base). No delete-guard created → `sanitize_in_progress` GUC exemption N/A (stated in the migration header).

### Worker write points (job_worker.py)
- All-waiting snapshot before the loop; `in_process` at loop entry (before preflight); exchange/label back-filled field-by-field once preflight resolves; `successful` after each `clipped.append`; `degraded` at each ccxt degrade `continue`. Each write sends a **snapshot** (`dict(...)` per entry, full array sorted by seq).
- Fail-open: `try/except asyncio.CancelledError: raise / except Exception: logger.warning(...)` — never re-raises.

### RED → GREEN evidence
- **Repro-gate:** `cd analytics-service && .venv/bin/python -m pytest tests/test_stitch_composite_job.py -k member_progress -q`
  - RED (worker unmodified): `6 failed, 48 deselected` — including Test 6, which fails because no progress writes were emitted at all.
  - GREEN (worker implemented): `6 passed, 48 deselected`.
- **Test 5 (secretless):** the preflight ctx `key_row` carries all five ciphertext fields; the recursive `_walk_keys` assertion confirms none appear at any depth in any payload.

### SC-4 parity (byte-identity)
`cd analytics-service && .venv/bin/python -m pytest tests/test_stitch_composite_job.py tests/test_golden_parity.py tests/test_metrics_parity.py tests/test_composite_headline_parity.py -q` → **103 passed**. `git status --porcelain analytics-service/` shows only `services/job_worker.py` modified (the test file was already committed in the RED gate); the three pure-parity files have **zero edits**. mypy + ruff clean on `job_worker.py`.

## WARNING-2 decision (heavy-member stall false-positive)

**Path taken: documented 12-min threshold (no mid-member heartbeat).**

The per-member crawl work (`_reconstruct_deribit` → `build_deribit_native_ledger`, and `_reconstruct_ccxt_member` → the ccxt fetch layer) is a single awaited call several layers below the `_reconstruct_all` loop. There is **no cheap in-flight tick point** (page/batch boundary) exposed at the loop level; emitting a mid-crawl heartbeat would require threading a progress callback through `build_deribit_native_ledger` and the fetch primitives — a real restructure of the crawl, which WARNING-2 explicitly says not to force. Per CLAUDE.md Rule 2/3 (simplicity, surgical), the heartbeat therefore fires only at member boundaries (waiting/in_process/successful/degraded).

**Consequence for 95-03:** a single legitimately slow member (>10 min — plausible for a large Deribit history) can leave `member_progress_at` stale on a HEALTHY run. **95-03 should use a ~12-minute stall threshold, not 10 minutes**, to give a slow-but-healthy member headroom under the 15-minute wizard patience budget.

## Deviations from Plan

**1. [Rule 2 — hardening] `SET search_path = public, pg_catalog`**
- **Where:** the migration function definition.
- **Plan wrote:** `SET search_path = public`.
- **Change:** pinned `public, pg_catalog` to match the sibling fenced SECURITY DEFINER RPCs (`mark_compute_job_done/failed`, `defer_compute_job`). pg_catalog is implicitly searched regardless, so behavior is identical; this is convention-conformance (CLAUDE.md Rule 11) + defense-in-depth. Flag for the post-land rls-policy-auditor pass.

Otherwise the plan executed as written.

## Deploy Notes (for the milestone merge)
- **Migration auto-applies to PROD on main merge** (supabase-migrate-auto-on-push). Route through **migration-reviewer + rls-policy-auditor** post-land (user decision 4).
- **Worker change** needs a **GREEN-first-try main commit** or a **Railway force-deploy** (red-CI-skips-Railway hazard) to actually run the new progress writes in prod.
- The SQL gate runs in the CI `sql-tests` lane (`psql -v ON_ERROR_STOP=1`); the executor has no live-DB creds, so CI is the runtime gate (pre-migration RED / post-migration GREEN).

## Threat Flags
None — no new security surface beyond the plan's `<threat_model>` (T-95-02..T-95-05 all mitigated in-plan; the RPC is service-role-only and the payload is secretless by construction).

## Self-Check: PASSED
- `supabase/migrations/20260712130000_set_compute_job_progress.sql` — FOUND
- `supabase/tests/test_set_compute_job_progress.sql` — FOUND
- Commit `18de5ea6` — FOUND · `4cd479d8` — FOUND · `59ccaba6` — FOUND
