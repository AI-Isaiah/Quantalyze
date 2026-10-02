---
phase: 95
slug: stitch-progress-transparency
status: approved
nyquist_compliant: true
wave_0_complete: false
created: 2026-07-12
---

# Phase 95 — Validation Strategy

> Per-phase validation contract, derived from `95-RESEARCH.md` § "Validation
> Architecture". Offline-first: every SC gets a test that fails without the fix.
> This phase touches surfaces Phase 94 JUST hardened — the frozen
> `SyncPreviewStep.composite.render.test.tsx` and the WIZ-01 secretless boundary
> MUST stay green, and the shared-hook extraction (#46) must preserve WIZ-05
> durability + the RT-1 invalidation byte-for-byte behaviorally.

## Locked decisions (autonomous, 2026-07-12)
1. **PROG-02 surfacing = Option A** — a thin secretless server route
   (`GET /api/strategies/[id]/sync-progress`) projecting ONLY
   `{seq, exchange, label, status}` (+ jobStatus/stalled). `compute_jobs` is
   RLS deny-all + REVOKE FROM authenticated; the sanctioned read is the SECDEF
   RPC `get_user_compute_jobs` (already returns `metadata`). The route projects
   — it never returns the raw metadata blob (no secret/correlation leak).
2. **PROG-03 = Option B (distinct stall surfacing)**, NOT faster reclaim — the
   `test_every_kind_has_watchdog_headroom` invariant blocks lowering the 30-min
   watchdog below the 20-min handler timeout. Surface a `stalled` flag off a
   stale `claimed_at`/heartbeat on the JOB (not `strategy_analytics` — an RT-1
   `pending`-after-complete row is re-stitching, not a stall) within the 15-min
   wizard patience, plus a manual re-enqueue CTA.
3. **Stall-retry CTA** = idempotent re-POST to `/api/keys/sync` (existing
   composite-aware kickoff, fails closed).
4. **Live granularity** = per-key status only (Successful / In process /
   Waiting / Degraded); the degrade REASON stays post-completion (Phase-93
   `degradedMembers` DQ channel already covers it — no live duplication).

## Test Infrastructure
| Property | Value |
|----------|-------|
| **Frontend** | Vitest 4.x + jsdom/Testing Library |
| **Worker** | pytest (pure-stub AsyncMock/MagicMock supabase+exchange; no live DB/creds); pinned venv Py3.12.13 + pandas 3.0.3 (local Py3.14 SIGSEGVs) |
| **SQL/RLS gate** | `supabase/tests/test_*.sql` (ONLY CI-run DB lane; `*_live.py`/`skipIf(!HAS_LIVE_DB)` SKIP in CI) |
| **FE quick run** | `npx vitest run src/app/(dashboard)/strategies/new/wizard/steps/ src/components/strategy/ src/app/api/strategies` |
| **Worker quick run** | `cd analytics-service && .venv/bin/python -m pytest tests/test_stitch_composite_job.py -x -q` (add `--no-file-parallelism` on local contention) |
| **Full** | `npm run test` + `cd analytics-service && .venv/bin/python -m pytest -n auto --dist loadgroup -q` |

## Per-Requirement Test Map (offline-first)
| Req | Seam | Type | Fails-without-fix |
|-----|------|------|-------------------|
| PROG-02 write | `_reconstruct_all` (job_worker.py:~3331) writes per-member `{seq,exchange,label,status}` to `compute_jobs.metadata` via a claim-token-fenced merge RPC; series/metrics UNCHANGED (SC-4) | pytest offline | metadata absent pre-fix |
| PROG-02 surface | `GET /api/strategies/[id]/sync-progress` → projected `{seq,exchange,label,status,jobStatus,stalled}`; owner-only (404 non-owner); NEVER the raw metadata blob / secrets | vitest route | route absent pre-fix |
| PROG-02 render | per-key panel renders Successful/In process/Waiting; debug `strategy_id/status=pending/elapsed` `<pre>` block GONE | vitest render (NEW sibling) | debug block present pre-fix |
| PROG-01 copy | user-facing copy present; literal `"Stitching composite…"` absent from user surface | vitest render/static | internal string present pre-fix |
| PROG-03 stall | stale `claimed_at`/heartbeat → route `stalled:true`; wizard renders distinct interrupted state + retry CTA; RT-1 `pending`-after-complete NOT flagged stalled | vitest route + render | infinite spin pre-fix |
| UX-03 / #46 | `useStrategySyncPoller` drives BOTH surfaces; wizard frozen tests stay green; NEW SyncProgress loop test pins 120s cap + 30s grace + transition order | vitest hook + render | — |
| SC-4 | `test_stitch_composite_job.py`, `test_golden_parity.py`, `test_metrics_parity.py`, `test_composite_headline_parity.py` byte-identical | pytest | — |

## Wave 0 (blockers — must land before dependent work)
- [ ] **`SyncProgress.poll.test.tsx`** — pin the CURRENTLY-UNPINNED poll loop (3s interval, 120s cap, 30s missing-row grace, `onStatusChange` transition order) BEFORE the #46 extraction. **This is the one genuine Wave-0 blocker** — extraction with no characterization test can silently change behavior.
- [ ] Extend `test_stitch_composite_job.py` with per-member metadata-write assertions + SC-4 re-pin (extend, don't rewrite).
- [ ] `sync-progress/route.test.ts` — owner/non-owner/secretless-projection/stalled.
- [ ] `SyncPreviewStep.progress.render.test.tsx` — NEW sibling (per-key panel + PROG-01 copy + interrupted state); frozen files stay untouched.
- [ ] Fenced-RPC SQL test (if a `set_compute_job_progress` RPC is added) in `supabase/tests/test_*.sql`, parallelism-safe (ties to Phase-97 CI-01).

## Sign-Off
- [ ] Frozen `SyncPreviewStep.composite.render.test.tsx` + WIZ-01 boundary untouched & green
- [ ] SC-4 parity pins byte-identical (worker metadata write is progress-only)
- [ ] `useStrategySyncPoller` preserves WIZ-05 durability + RT-1 invalidation on BOTH surfaces (characterization test first)
- [ ] Per-key metadata carries NO secrets (seq/exchange/label/status only)
- [ ] Each PROG/UX req has a test that fails without the fix
- [ ] `nyquist_compliant: true`

**Approval:** approved (autonomous, 2026-07-12)
