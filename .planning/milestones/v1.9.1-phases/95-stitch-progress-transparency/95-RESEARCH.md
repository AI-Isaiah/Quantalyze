# Phase 95: Stitch Progress Transparency — Research

**Researched:** 2026-07-12
**Domain:** Brownfield — Next.js wizard poll UI + Python analytics worker (`stitch_composite`) + Supabase RPC/RLS + compute-jobs queue watchdog
**Confidence:** HIGH (all anchors read at source; no CONTEXT.md exists yet — this is standalone pre-plan research)

## Summary

Every anchor in the brief was verified against source. The phase touches three real layers, all of which
Phase 94 either created or hardened:

1. **Two poll loops** exist and are genuinely different in *lifecycle*, not just duplicated code.
   `SyncPreviewStep.tsx` (wizard) is a **self-contained** kickoff→poll→materialize→gate machine that reads
   `strategy_analytics` directly via the **browser Supabase client**. `SyncProgress.tsx` (rendered by
   `ApiKeyManager`) is a **controlled** status-only poller: the parent owns `syncStatus`, the component polls
   `strategy_analytics` on a fixed 3 s interval and calls `onStatusChange` to drive the parent's transitions,
   with a 120 s hard cap and a 30 s missing-row grace. The shared core for `useStrategySyncPoller` (#46/UX-03)
   is only the **status-poll loop** (read `computation_status`, distinguish error-as-value from `pending`,
   escalate consecutive errors, detect terminal). The wizard's heavy-fetch/gate/snapshot/composite/WIZ-05
   logic and ApiKeyManager's cap/grace/step-indicators are surface-specific and must stay out of the hook.
   `[VERIFIED: codebase]`

2. **No "poll route" exists today.** Both surfaces read `strategy_analytics` *directly* through RLS.
   `compute_jobs` is `RLS deny-all` + `REVOKE ALL … FROM authenticated` — the browser client gets **zero
   rows**. The intended user-facing read path is the existing SECURITY DEFINER RPC **`get_user_compute_jobs`**,
   which is `GRANT EXECUTE TO authenticated`, owner-scoped by `auth.uid()`, and **already returns the
   `metadata JSONB` column** (plus `status`, `claimed_at`, `updated_at`, `user_message`; `last_error` is
   redacted). So PROG-02's "poll route surfaces it" is satisfiable either by calling that RPC from the browser
   or by a thin server route that *projects* only the safe fields. `[VERIFIED: codebase]`

3. **The stall gap is real and quantified.** `stitch_composite` handler timeout = **20 min**
   (`job_worker.py:267`); its watchdog reclaim threshold = **30 min** (`main_worker.py:168`), applied by a
   60 s `watchdog_loop` → `reset_stalled_compute_jobs`. The wizard's patience `RETRY_THRESHOLD_MS` = **15 min**
   (`SyncPreviewStep.tsx:112`) — but the poll loop has **no time-based abort**; at 15 min it only swaps copy
   to "taking much longer than expected" and keeps polling forever. A worker OOM/restart mid-stitch leaves
   `strategy_analytics` at `computing`/`pending`; the user sees an indefinite spinner from 15 min onward, and
   the job isn't even reclaimed/requeued until 30 min. `[VERIFIED: codebase]`

**Primary recommendation:** Add a per-member progress heartbeat to `compute_jobs.metadata` written by the
`_reconstruct_all` member loop; surface it (plus a server-computed `stalled` flag) through a **thin secretless
server route** that wraps `get_user_compute_jobs`; render a per-key panel replacing the debug `<pre>` block and
rewrite the copy; extract a **parametrized** `useStrategySyncPoller` covering only the status-poll loop, gated
behind characterization tests captured on BOTH surfaces *before* the refactor. Close PROG-03 by **distinct
stall surfacing** (Option B), not by lowering the watchdog below the 20-min handler timeout.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| PROG-01 | In-progress copy is user-facing ("Trades are being downloaded and processed", phase-aware if cheap); internal "Stitching composite…" gone from user surface | Copy lives in `SyncPreviewStep.tsx:1551-1573` (heading + body + the inner `"Stitching composite…"` label at `:1570`). `phase-aware` maps to `computationStatus` (`pending`→fetching, `computing`→processing) already tracked at `:327`/`:605`. Pure render change. |
| PROG-02 | Per-key status panel (Key 1 Successful / Key 2 In process / Key 3 Waiting); worker writes per-member progress to `compute_jobs.metadata`, poll surfaces it, frontend renders; debug `strategy_id/status/elapsed` block gone | Write site: `_reconstruct_all` member loop `job_worker.py:3331`. `compute_jobs.metadata` is bare nullable JSONB, no CHECK (`20260411144407:136`) → additive, no migration. Surface: `get_user_compute_jobs` RPC returns `metadata` (`…181014` def). Debug block to delete: `SyncPreviewStep.tsx:1614-1623`. |
| PROG-03 | Interrupted/stalled stitch visible + recoverable within patience window; close 30-min watchdog vs 15-min patience gap | Watchdog `stitch_composite`=30 min (`main_worker.py:168`), handler=20 min (`job_worker.py:267`), loop 60 s (`main_worker.py:768`). Patience=`RETRY_THRESHOLD_MS` 15 min, no abort (`SyncPreviewStep.tsx:112`). Recommend distinct stall surfacing via `claimed_at`/heartbeat staleness + manual re-enqueue. |
| UX-03 (#46) | `SyncProgress` + `SyncPreviewStep` share one `useStrategySyncPoller`; duplicated poll loop removed, no behavior change | Two loops: `SyncPreviewStep.tsx:502-1065` (self-contained) and `SyncProgress.tsx:213-282` (controlled, `onStatusChange`). Different schedules/caps → extract must be **parametrized**; characterization tests required first. |
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Per-member reconstruction progress (writing) | Python worker (`analytics-service`) | Database (`compute_jobs.metadata`) | Only the worker knows which member it is crawling; it holds the claimed job row + claim token. Key decryption is worker-LOCKED. |
| Per-key progress surfacing (owner-scoped read) | API / Backend (Next route or `get_user_compute_jobs` RPC) | Database (RLS/SECURITY DEFINER) | `compute_jobs` is RLS deny-all to authenticated; a SECURITY DEFINER RPC or admin-client route is the ONLY owner-scoped read path. Also the natural place to enforce the secretless projection. |
| Progress panel rendering + copy | Browser / Client (React) | — | Pure presentation over the surfaced progress + `computation_status`. |
| Stall detection ("interrupted vs still working") | API / Backend (compute `stalled` from `claimed_at`/heartbeat vs `now()`) | Browser (distinct UI state + retry CTA) | Freshness math needs server clock + the job's `claimed_at`/`updated_at`, which the browser cannot read from `compute_jobs`. |
| Watchdog reclaim / requeue | Python worker (`watchdog_loop`) + DB RPC (`reset_stalled_compute_jobs`) | — | Existing infra; do NOT lower the `stitch_composite` threshold below the 20-min handler timeout. |
| Shared poll-loop mechanics (schedule, error escalation, terminal detect) | Browser / Client (`useStrategySyncPoller` hook) | — | Both surfaces poll `strategy_analytics`; the loop mechanics are the only genuinely-shared concern. |

## Current Architecture (verified at source)

### Surface A — `SyncPreviewStep.tsx` (wizard, self-contained)

- **Kickoff effect** (`:347-492`): WIZ-05 durability short-circuit (cached snapshot → `:361-366`; COMPLETE
  composite via `data_quality_flags.composite===true` skips kickoff regardless of freshness → `:398-450`;
  fresh-non-composite fails CLOSED to `SYNC_FAILED` on an unreadable marker → `:437-441`; stale falls through
  to the kickoff `POST /api/keys/sync` → `:451`). Threads `composite: true` from the **server** kickoff
  response into `isComposite` (`:472-478`). `[VERIFIED: codebase]`
- **Elapsed-timer effect** (`:494-500`): 1 s ticker while `waiting_for_complete`/`kicking_off`.
- **Poll effect** (`:502-1065`): self-scheduling `setTimeout` walking `POLL_BACKOFF_MS = [3s,3s,5s,5s,10s]`
  (`:123`). Reads `strategy_analytics(computation_status, computation_error)` **directly** via browser client
  (`:572`). Distinguishes error-as-value → `consecutiveErrors` (`:587-599`, `MAX_CONSECUTIVE_POLL_ERRORS = 3`
  `:133`); terminal `failed` short-circuits before the heavy fetch (`:614-625`); terminal success =
  `isComputedAnalytics(status)` incl. `complete_with_warnings` (`:631`). On terminal it runs a heavy
  `Promise.all` — a **composite arm** (`:655-877`, reads analytics + members + `csv_daily_returns` series +
  denominator config, R2-5 empty-series re-poll at `:775`) and a **single-key arm** (`:879-1017`, trades
  count/span + gate). Heavy-fetch throws escalate via a **separate** `heavyFetchErrors` counter (`:1018-1037`).
  `[VERIFIED: codebase]`
- **Waiting-state render** (`:1539-1626`): heading + body copy (`:1551-1559`), the pulsing status line whose
  composite label is `"Stitching composite…"` (`:1570`), SLOW/WARN/RETRY copy thresholds
  (`SLOW_HINT_MS=15s :103`, `WARN_THRESHOLD_MS=60s :104`, `RETRY_THRESHOLD_MS=900s/15min :112`), and the
  **debug `<pre>` block** printing `strategy_id / status / elapsed / error` (`:1614-1623`). `[VERIFIED: codebase]`

### Surface B — `SyncProgress.tsx` (rendered by `ApiKeyManager`, controlled)

- Props-driven: parent passes `syncStatus`, `onStatusChange` (`:78-86`). `isActive = syncing|computing`
  (`:145`). `[VERIFIED: codebase]`
- **Poll effect** (`:269-282`): fixed `setInterval(pollStatus, 3000)`. `pollStatus` (`:213-267`) reads
  `strategy_analytics(computation_status, computation_error, computed_at)` via browser client, `POLL_MAX_ATTEMPTS = 40`
  (~120 s cap → `onStatusChange("error")` `:216`), `MISSING_ROW_GRACE_POLLS = 10` (~30 s grace `:29`,`:244`),
  routes DB→UI via the exhaustive `toSyncStatus` converter (`:61-76`, `assertNever` guard). Also fetches the
  exchange name (`:148-186`) and renders 3 step-dots (`:316-349`). `[VERIFIED: codebase]`
- Consumer: `ApiKeyManager.tsx:10`/`:48` — `ApiKeyManager` owns `syncStatus` state and drives it from
  `onStatusChange`; `SyncProgress` never kicks off a sync. `SyncProgress.test.ts` pins ONLY the pure
  `toSyncStatus` mapping — **the poll loop itself is unpinned** (Wave-0 gap). `[VERIFIED: codebase]`

### Kickoff / status write path — `/api/keys/sync/route.ts`

- Composite-first kickoff hoisted ahead of `isUnifiedBackboneActive()` (`:160-289`): for
  `api_key_id === null` with `strategy_keys` count > 0, enqueues `stitch_composite` via `enqueue_compute_job`
  and returns `{ composite: true, status: "syncing" }` (202). Fails CLOSED (503, terminal-`failed` stamp) on
  an unknowable membership count. `[VERIFIED: codebase]`
- **RT-1 invalidation** is documented in this route's writer audit (`:59-65`) and implemented in migration
  `20260712120000_wizard_composite_members_invalidate_analytics.sql`: `set_wizard_composite_members` resets a
  `complete`/`complete_with_warnings` row → `pending` **only when the order-independent member signature
  changes** (`IS DISTINCT FROM`, `:169-175`), scoped to completed/idle rows (never a `computing` row the
  worker owns). An identical re-Continue is a no-op (WIZ-05 latency invariant). `[VERIFIED: codebase]`

### Worker — `run_stitch_composite_job` + `_reconstruct_all`

- `run_stitch_composite_job` (`job_worker.py:2872`) fans out over `strategy_keys` members ORDER BY `seq`.
  `_reconstruct_all(basis)` (`:3315`) is the **per-member loop** (`for m in members:` `:3331`): each iteration
  has `seq = int(m["seq"])` and a `member_job` dict carrying `job["id"]` + `job["claim_token"]` (`:3342-3347`),
  then preflight → reconstruct → clip, with degrade/transient/permanent branches. **This loop is the write
  site for per-member progress.** `[VERIFIED: codebase]`
- `cash_result = await _reconstruct_all(cash_pnl_basis)` runs first (`:3532`); when MTM is admissible a second
  pass runs — so a naive "member i of N" counter should be scoped to the cash pass (or the panel will appear
  to restart). Note this for the writer. `[VERIFIED: codebase]`

### Watchdog / reclaim (PROG-03 numbers)

- `watchdog_loop(interval=60.0)` (`main_worker.py:768`) → `watchdog_tick` → `reset_stalled_compute_jobs`
  with global `p_stale_threshold = "10 minutes"` + `WATCHDOG_PER_KIND_OVERRIDES` (`:661-662`).
- `WATCHDOG_PER_KIND_OVERRIDES["stitch_composite"] = "30 minutes"` (`:168`); comment states handler timeout
  = 20 min. Invariant `test_every_kind_has_watchdog_headroom` enforces threshold > handler timeout — so the
  threshold **cannot** be lowered below ~20 min without also lowering the handler timeout (which would
  reclaim healthy long stitches). `[VERIFIED: codebase]`

## The PROG-02 surfacing decision (important — no route exists today)

`compute_jobs` = `ENABLE ROW LEVEL SECURITY` + `CREATE POLICY compute_jobs_deny_all … USING(false)`
(`20260411144407:231-237`) and `REVOKE ALL ON TABLE compute_jobs FROM PUBLIC, anon, authenticated`
(`…104201:219`). The browser client therefore **cannot** read `compute_jobs.metadata` directly — the
existing wizard/`SyncProgress` polls only work because `strategy_analytics` is owner-readable. `[VERIFIED: codebase]`

Two viable surfacing paths:

| Option | Mechanism | Pros | Cons | Recommendation |
|--------|-----------|------|------|----------------|
| **A (recommended): thin secretless server route** | `GET /api/strategies/[id]/sync-progress` → owner-check → call `get_user_compute_jobs(p_strategy_id)` (or admin read) → **project** `{ memberProgress: [{seq,exchange,label,status}], jobStatus, stalled }` | Central place to (1) enforce the secretless projection — never return the raw `metadata` blob, (2) compute the PROG-03 `stalled` flag server-side from `claimed_at`/heartbeat vs `now()`, (3) keep `compute_jobs` reads server-side. Satisfies "poll route surfaces it" literally. | One new route + poll wiring in the wizard. | **Use this.** |
| B: direct RPC from browser | Wizard calls `supabase.rpc("get_user_compute_jobs", { p_strategy_id })`, reads `metadata.member_progress` | Zero new routes; RPC already owner-scoped + browser-callable. | Returns the **entire** `metadata` JSONB to the client — any future secret written to metadata leaks; stall math must move to the client. | Fallback only. |

`get_user_compute_jobs` return shape confirmed to include `metadata JSONB` + `status` + `claimed_at` +
`updated_at` + `user_message` (`…181014` def); `last_error` is redacted to NULL for users. `[VERIFIED: codebase]`

## The worker write mechanism (avoid clobbering existing metadata)

`compute_jobs.metadata` already carries `{ source, correlation_id }` from `enqueue_compute_job`
(`route.ts:250`). A naive `supabase.table("compute_jobs").update({"metadata": {...}})` **replaces the whole
column** and drops `correlation_id`/`source`. Two safe patterns:

- **Recommended: a fenced JSONB-merge RPC** `set_compute_job_progress(p_job_id, p_claim_token, p_progress jsonb)`
  doing `metadata = COALESCE(metadata,'{}') || jsonb_build_object('member_progress', p_progress)` with a
  claim-token fence (`WHERE id = p_job_id AND claim_token = p_claim_token`), mirroring the existing
  `mark_compute_job_*` fenced RPCs (claim-token fencing established in `…claim_token_fencing.sql`). This
  preserves other keys, is idempotent, and won't race a watchdog reclaim (a stale token no-ops). `[ASSUMED]` (pattern inferred from existing fenced RPCs; exact signature is a plan decision)
- Alternative: in-memory merge — the worker holds `job["metadata"]`, so it can write
  `{**(job.get("metadata") or {}), "member_progress": [...]}` back in a full update. Simpler but not fenced;
  a concurrent watchdog reclaim + second worker could interleave writes. Prefer the RPC.

**Heartbeat for PROG-03:** have the same write stamp a `member_progress_at` (or reuse `updated_at`, which the
job row already has) so the server route can compute `stalled = job.status in ('running') AND now() - heartbeat > STALL_SECS`.
This gives a genuine "interrupted" signal distinct from "still working," well inside the 15-min window.

## PROG-03 gap-closure — options + recommendation

| Option | What it does | Risk | Verdict |
|--------|-------------|------|---------|
| A: faster `stitch_composite` reclaim | Lower the watchdog threshold (and handler timeout) so reclaim happens < 15 min | Would reclaim **healthy** long stitches — the override map exists precisely to prevent this (`main_worker.py:124-131`); a legit N-key MTM stitch can run ~20 min. Reintroduces the wizard-hang the map fixed. | **Reject as primary.** |
| **B (recommended): distinct stall surfacing** | Server route computes `stalled` from heartbeat/`claimed_at` staleness; wizard renders a distinct "Sync was interrupted — retrying" state + a manual **re-enqueue** CTA (re-POST `/api/keys/sync`, idempotent via the partial-unique index) | UI + one route field; no change to healthy-run timing | **Use this.** Decouples UI patience from the reclaim timer; a stall surfaces in seconds, not 15–30 min. |
| C (optional add-on): modest reclaim tightening | Keep B, and additionally shorten the *detection* by having the worker heartbeat so a crashed worker's job looks stale to the watchdog sooner via a stitch-specific stale check | Additive; must still stay > active-run heartbeat cadence | Nice-to-have; not required for the SC. |

Recommendation: **B**, optionally **B+C**. Never lower the watchdog below the 20-min handler timeout.

## Phase-94 interaction constraints (DO NOT REGRESS — verified)

- **WIZ-05 durability short-circuit** (`SyncPreviewStep.tsx:398-450`): a COMPLETE composite
  (`data_quality_flags.composite===true`) skips the kickoff regardless of freshness; fresh-non-composite fails
  CLOSED to `SYNC_FAILED` on an unreadable marker; stale falls through to the kickoff POST. If the poll loop is
  extracted into `useStrategySyncPoller`, this kickoff/durability logic must **stay in the wizard** (it is not
  part of the shared loop). `[VERIFIED: codebase]`
- **RT-1 invalidation** (`set_wizard_composite_members`, mig `20260712120000`): a member-set change resets
  analytics to `pending`. The unified poller MUST show a `pending`-after-complete row as **"in progress"**
  (re-stitching), NOT as a stall — the stall detector must key off the **job** (`claimed_at`/heartbeat),
  never off "`strategy_analytics` went back to pending." `[VERIFIED: codebase]`
- **Frozen tests stay green:** `SyncPreviewStep.render.test.tsx` + `SyncPreviewStep.composite.render.test.tsx`
  + `SyncPreviewStep.test.ts` are the SC-4 neutrality/composite pins (the composite file's header explicitly
  says the render+`.test.ts` siblings are FROZEN). Any refactor must keep them untouched and green. `[VERIFIED: codebase]`
- **WIZ-01 secretless boundary:** per-key progress metadata must carry **only** `{seq, exchange, label, status}` —
  never `api_key_encrypted` or any ciphertext. Enforced structurally by the Option-A projection route. `[VERIFIED: codebase]`
- **SC-4 byte-identity:** the worker's progress write must NOT alter the stitched series/metrics. The write is
  a side-channel to `compute_jobs.metadata` only; single-key and existing composite published metrics stay
  byte-identical (parity pins: `test_composite_headline_parity.py`, `test_stitch_composite_job.py`). `[VERIFIED: codebase]`

## The `useStrategySyncPoller` extraction plan (#46 / UX-03)

The two loops are **not** identical today (backoff ladder vs fixed 3 s; SYNC_FAILED escalation vs 120 s cap +
30 s missing-row grace; wizard-only `heavyFetchErrors`/composite/R2-5). "No behavior change" therefore requires
a **parametrized** hook, not a lift-and-shift.

**Recommended hook contract** (owns ONLY the status-poll loop):

```ts
useStrategySyncPoller({
  enabled: boolean,                    // wizard: phase==='waiting_for_complete'; ApiKeyManager: isActive
  strategyId: string,
  schedule: number[] | number,         // wizard: [3000,3000,5000,5000,10000]; ApiKeyManager: 3000 (fixed)
  maxConsecutiveErrors: number,        // both: 3 (wizard) — ApiKeyManager currently has none
  maxAttempts?: number,                // ApiKeyManager: 40; wizard: undefined (no cap)
  missingRowGracePolls?: number,       // ApiKeyManager: 10; wizard: undefined
  onStatus: (status, error) => void,   // both: forward computation_status/error
  onTerminal: (status) => 'done' | 'repoll',  // wizard returns 'repoll' on empty-series (R2-5); does heavy fetch/gate itself
  onError: () => void,                 // wizard: failPolling→SYNC_FAILED; ApiKeyManager: onStatusChange('error')
});
```

Everything wizard-specific (kickoff, `isComposite` heavy arm, `heavyFetchErrors`, snapshot materialization,
gate, WIZ-05) stays in the wizard's `onTerminal`. Everything ApiKeyManager-specific (cap, grace, exchange-name,
step-dots) stays there. Only the scheduling + status-read + consecutive-error escalation + terminal detection
move into the hook.

**Provable-parity method (mandatory):**
1. **Before** the refactor, write **characterization tests** that pin each surface's *current* loop behavior:
   the wizard is already pinned by the frozen render tests; **SyncProgress's poll loop is NOT pinned** — add a
   test for the 120 s cap → `error`, the 30 s missing-row grace, and the `onStatusChange` transition sequence.
2. Extract the hook; keep both surfaces' configs at their current numbers.
3. Re-run — frozen wizard tests + new SyncProgress loop tests must stay green with zero edits. Green diff =
   behavior preserved.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Owner-scoped read of a job's progress | A new RLS policy on `compute_jobs`, or a browser read | `get_user_compute_jobs` RPC (already owner-scoped, returns `metadata`) behind a projection route | `compute_jobs` is deliberately deny-all; the SECURITY DEFINER RPC is the sanctioned path. |
| Merging progress into `metadata` | `.update({metadata:{...}})` (clobbers `correlation_id`) | Fenced JSONB `||` merge RPC mirroring `mark_compute_job_*` | Preserves existing keys; claim-token fence avoids reclaim races. |
| Reclaiming a crashed stitch | A new stall reaper | Existing `watchdog_loop` + `reset_stalled_compute_jobs` (leave the 30-min threshold) + surface a stall in UI | Reaper already exists; the gap is UI visibility, not reclaim. |
| DB→UI status mapping | New string comparisons | Existing `toSyncStatus` exhaustive converter (`SyncProgress.tsx:61`) | `assertNever` forces every new status to be handled. |
| Per-key idempotent re-enqueue | A dedup table | The partial-unique index `compute_jobs_one_inflight_per_kind_strategy` | Re-POST is already idempotent (`route.ts:267`). |

## Common Pitfalls

### Pitfall 1: Second MTM pass restarts the per-key counter
`_reconstruct_all` runs once for cash and (when MTM admissible) again for mark-to-market (`:3532`+). A
per-member counter not scoped to the cash pass makes the panel appear to reset from Key 1. **Avoid:** write
progress from the cash pass only (or key the panel off `seq` completion, not a running index).

### Pitfall 2: Treating RT-1 `pending`-after-complete as a stall
After a member-set change, `strategy_analytics` legitimately returns to `pending` and the worker re-stitches.
A stall detector keyed off "status regressed" would flag this as interrupted. **Avoid:** compute `stalled`
from the **job** (`claimed_at`/heartbeat staleness), never from `strategy_analytics`.

### Pitfall 3: Secret leak via the full metadata blob (Option B)
`get_user_compute_jobs` returns the entire `metadata` JSONB. **Avoid:** project only `{seq,exchange,label,status}`
in the server route (Option A); never write ciphertext/key material into `metadata` in the worker.

### Pitfall 4: SC-4 parity drift
Any change inside `run_stitch_composite_job` risks the byte-identity pins. **Avoid:** keep the progress write a
pure side-channel to `compute_jobs.metadata` (and/or a fenced RPC) — do not touch the series/metrics/upsert path.
Re-run `test_stitch_composite_job.py` + `test_composite_headline_parity.py`.

### Pitfall 5: Shared-test-DB fragility (documented project hazard)
`compute_jobs` fence/claim tests are flaky under parallel CI against the shared test project (MEMORY: shared-testdb
concurrent-CI flake; the v1.9.1 CI-01/Phase-97 item targets exactly this). A new fenced-RPC test that claims/marks
`compute_jobs` rows must be parallelism-safe (per-run-tag scoping) or run serial. Live-DB `*_live.py`/`skipIf(!HAS_LIVE_DB)`
tests **do not run in CI** — verify DB behavior via `supabase/tests/test_*.sql` or the offline pure-stub harness.

### Pitfall 6: "No behavior change" hook regression
The two loops differ in schedule/caps. A lift-and-shift that unifies to one schedule silently changes timing on
one surface. **Avoid:** parametrize; pin both surfaces with characterization tests first (SyncProgress loop is
currently unpinned).

## Runtime State Inventory

Rename/refactor-adjacent (the #46 extraction is a refactor), so inventoried explicitly:

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | `compute_jobs.metadata` currently holds `{source, correlation_id}` per job. Adding `member_progress`/heartbeat is **additive** to a bare JSONB column. | Code edit only (worker write); no data migration — old jobs simply lack the key. |
| Live service config | None — no external UI/service stores stitch-progress state. Watchdog thresholds live in `main_worker.py` (in git), not a live datastore. | None. |
| OS-registered state | None. Railway worker is redeployed from git; no OS-registered task carries progress state. | None. |
| Secrets/env vars | `USE_COMPUTE_JOBS_QUEUE=true` and unified-backbone `'on'` must hold for the composite queue path (MEMORY: prod backbone on). No new secret. Worker must NEVER write secrets to `metadata`. | None (verify env unchanged). |
| Build artifacts | None — no compiled artifact carries progress state. | None. |

## Validation Architecture

Test framework confirmed present; `nyquist_validation: true` in config → this section is required.

### Test Framework
| Property | Value |
|----------|-------|
| Frontend framework | Vitest 4.x (`package.json:70`), jsdom + Testing Library; coverage `@vitest/coverage-v8` |
| Frontend quick run | `npx vitest run src/app/(dashboard)/strategies/new/wizard/steps/ src/components/strategy/` |
| Frontend full suite | `npm run test` (`vitest run`) |
| Worker framework | pytest (`analytics-service/tests/`), pure-stub `AsyncMock`/`MagicMock` supabase + exchange (no live DB/creds) |
| Worker quick run | `cd analytics-service && pytest tests/test_stitch_composite_job.py -x` (add `--no-file-parallelism` if local contention flakes) |
| SQL/RLS gate | `supabase/tests/test_*.sql` (the ONLY CI-run DB lane; `*_live.py`/`skipIf(!HAS_LIVE_DB)` SKIP in CI) |

### Phase Requirements → Test Map (offline-first; each fails without the fix)
| Req | Behavior | Test Type | Command | File Exists? |
|-----|----------|-----------|---------|-------------|
| PROG-02 (write) | `_reconstruct_all` writes per-member `{seq,exchange,label,status}` to `compute_jobs.metadata` via the fenced RPC; series/metrics unchanged | unit (offline pure-stub) | `pytest tests/test_stitch_composite_job.py -k progress -x` | ❌ Wave 0 (extend existing file) |
| PROG-02 (surface) | `GET /api/strategies/[id]/sync-progress` returns projected `{seq,exchange,label,status,jobStatus,stalled}` for an owner, 404 for a non-owner, and NEVER the raw metadata blob | unit (route test, mocked RPC) | `npx vitest run src/app/api/strategies/[id]/sync-progress/route.test.ts` | ❌ Wave 0 |
| PROG-02 (render) | Per-key panel renders Successful/In process/Waiting; the debug `<pre>` block is gone | render (jsdom) | `npx vitest run …/SyncPreviewStep.progress.render.test.tsx` | ❌ Wave 0 (NEW sibling — frozen files untouched) |
| PROG-01 (copy) | User-facing copy present; the literal `"Stitching composite…"` string absent from the user surface | render / static assertion | same NEW sibling test | ❌ Wave 0 |
| PROG-03 (stall) | Given a stale `claimed_at`/heartbeat, the route sets `stalled:true`; the wizard renders the distinct interrupted state + retry CTA; an RT-1 `pending`-after-complete row is NOT flagged stalled | unit (route) + render | route test + render sibling | ❌ Wave 0 |
| UX-03 (#46) | `useStrategySyncPoller` drives both surfaces; wizard frozen tests stay green; NEW SyncProgress loop test pins 120 s cap + 30 s grace + transition order | render + hook | frozen wizard tests (unchanged) + `SyncProgress.poll.test.tsx` | ❌ Wave 0 (SyncProgress loop currently unpinned) |

### Sampling Rate
- **Per task commit:** the touched surface's quick run (wizard steps dir, or `test_stitch_composite_job.py`).
- **Per wave merge:** `npm run test` + `cd analytics-service && pytest` (both runtimes; #46 touches shared UI, worker touches parity pins).
- **Phase gate:** full suite green + frozen composite pins untouched before `/gsd:verify-work`.

### Wave 0 Gaps
- [ ] `analytics-service/tests/test_stitch_composite_job.py` — add per-member metadata-write assertions + SC-4 parity re-pin (extend, don't rewrite).
- [ ] `src/app/api/strategies/[id]/sync-progress/route.test.ts` — owner/non-owner/secretless-projection/stalled.
- [ ] `src/…/steps/SyncPreviewStep.progress.render.test.tsx` — NEW sibling (per-key panel + copy + interrupted state); frozen render/`.test.ts` files stay untouched.
- [ ] `src/components/strategy/SyncProgress.poll.test.tsx` — pin the CURRENTLY-UNPINNED poll loop (cap/grace/transitions) BEFORE the #46 extraction.
- [ ] Fenced-RPC SQL test (if a `set_compute_job_progress` RPC is added) in `supabase/tests/test_*.sql`, parallelism-safe.

## Security Domain

`security_enforcement` absent → enabled.

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V4 Access Control | yes | Owner-scope the progress read (`get_user_compute_jobs` filters `auth.uid()`; route re-checks ownership → uniform 404 like `route.ts:131-142`). |
| V5 Input Validation | yes | Validate `strategy_id` is a UUID before use (mirror `route.ts:84`). |
| V6 Cryptography | no (read/side-channel only) | Key decryption stays worker-LOCKED; never write key material to `metadata`. |
| V7 Error/Logging | yes | `last_error` already redacted by the RPC; keep the route's projection secretless; scrub any worker-written status strings. |

### Known Threat Patterns for this stack
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Reading another user's job progress | Info Disclosure | `auth.uid()`-scoped RPC + route ownership re-check; uniform 404 (no existence oracle). |
| Secret leak via `metadata` blob | Info Disclosure | Server-side projection to `{seq,exchange,label,status}`; worker discipline (never write ciphertext). |
| Enumerating strategy IDs via progress route | Info Disclosure | Same uniform-404 + rate-limit pattern as `/api/keys/sync`. |
| Watchdog reclaim race on the progress write | Tampering | Claim-token-fenced merge RPC (stale token no-ops). |

## Package Legitimacy Audit

**No external packages are installed by this phase.** All work uses libraries already in the repo (Vitest,
Testing Library, React, supabase-js, pandas/pytest on the worker). Package Legitimacy Gate: N/A — nothing to
audit. `[VERIFIED: codebase]`

## Environment Availability

Code/config-only phase against existing infra; relevant preconditions rather than new tools:

| Dependency | Required By | Available | Notes |
|------------|------------|-----------|-------|
| `USE_COMPUTE_JOBS_QUEUE=true` (prod) | composite stitch queue path | ✓ (MEMORY: set in prod) | Composite finalize/preview requires it; verify unchanged. |
| unified-backbone `'on'` (prod) | keys/sync routing | ✓ (MEMORY: on since 2026-05-25) | Composite kickoff is hoisted ahead of it — unaffected. |
| Railway worker deploy | worker metadata write | ✓ | Red-CI-skips-Railway hazard (MEMORY): land the worker change on a GREEN-first-try main commit or force-deploy. |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | A fenced `set_compute_job_progress(job_id, claim_token, progress)` JSONB-merge RPC is the right write mechanism (signature is a plan decision) | Worker write mechanism | Low — pattern matches existing `mark_compute_job_*`; in-memory-merge fallback exists. Exact name/args to be finalized in plan. |
| A2 | `phase-aware` copy can key off the existing `computationStatus` (`pending`/`computing`) without new worker state | PROG-01 | Low — states already tracked at `SyncPreviewStep.tsx:327`/`:605`; "if cheap" makes this optional. |
| A3 | Distinct stall surfacing (Option B) is preferred over lowering the watchdog | PROG-03 | Low — lowering below the 20-min handler timeout is explicitly guarded against by `test_every_kind_has_watchdog_headroom`. |

## Open Questions

1. **Which surfacing path — Option A route vs Option B direct RPC?**
   - Known: both are owner-scoped and viable; A is secretless-by-projection and centralizes stall math.
   - Recommendation: **A** (thin server route). Confirm at discuss/plan time.
2. **Progress granularity for the panel.** Per-key `{Waiting|In process|Successful|Excluded}` is the minimum
   the SC names. Whether to also surface degrade reasons (HARD-05 `degraded_members`) in the live panel or only
   post-completion is a UX call for the planner.
3. **Manual retry CTA target for a stall.** Re-POST `/api/keys/sync` (idempotent) is the natural action;
   confirm it's acceptable to expose a user-triggered re-enqueue mid-wizard.

## Sources

### Primary (HIGH — read at source this session)
- `src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.tsx` — both effects + waiting render + copy + debug block + thresholds
- `src/components/strategy/SyncProgress.tsx` — controlled poll loop, cap/grace, `toSyncStatus`
- `src/app/api/keys/sync/route.ts` — composite-first kickoff, RT-1 writer audit, idempotency
- `analytics-service/services/job_worker.py` — `run_stitch_composite_job`, `_reconstruct_all` member loop, `TIMEOUT_PER_KIND`
- `analytics-service/main_worker.py` — `WATCHDOG_PER_KIND_OVERRIDES`, `watchdog_tick`/`watchdog_loop`
- `supabase/migrations/20260411144407_compute_jobs_queue.sql` — `compute_jobs` schema (bare JSONB `metadata`), RLS deny-all, `get_user_compute_jobs`
- `supabase/migrations/20260510181014_…user_message….sql` / `…104201_…residual.sql` — `get_user_compute_jobs` return shape incl. `metadata`
- `supabase/migrations/20260712120000_wizard_composite_members_invalidate_analytics.sql` — RT-1 invalidation + WIZ-05 no-op invariant
- `.planning/phases/94-wizard-resumability/94-RESEARCH.md` — WIZ-05 durability record
- `analytics-service/tests/test_stitch_composite_job.py`, `SyncProgress.test.ts`, `SyncPreviewStep.composite.render.test.tsx` — test seams/frozen pins
- `.planning/REQUIREMENTS.md`, `.planning/ROADMAP.md` — PROG/UX scope + success criteria

### Secondary (MEDIUM — project memory, corroborated by code)
- Prod: unified backbone `'on'` + `USE_COMPUTE_JOBS_QUEUE=true`; red-CI-skips-Railway deploy; shared-test-DB concurrent-CI flake.

## Metadata

**Confidence breakdown:**
- Current architecture (both loops, route, worker, watchdog numbers): HIGH — every line-cited fact read at source.
- Surfacing path (get_user_compute_jobs returns metadata, RLS deny-all): HIGH — schema + RPC defs read.
- Write mechanism (fenced merge RPC signature): MEDIUM — pattern inferred from existing fenced RPCs (A1).
- PROG-03 recommendation: HIGH — thresholds + the headroom invariant read at source.

**Research date:** 2026-07-12
**Valid until:** ~2026-08-11 (brownfield; stable unless the wizard/worker surfaces churn again)

**Live-corroboration note (NON-BLOCKING):** Full end-to-end confidence (a real 3-key Deribit stitch showing
the per-key panel advance, and an OOM producing the interrupted state) can only be attested against a live
Railway worker + authed prod session, which cannot run in CI. Offline tests (worker metadata write, route
projection, render, hook parity, stall timing) cover every SC and are the phase gate; live corroboration is a
follow-up dogfooding check, not a blocker.

**Nyquist validation-gate readiness:** Every SC maps to at least one automated, offline test that fails without
the fix (table above). The single genuine Wave-0 blocker for #46 is that **SyncProgress's poll loop is currently
unpinned** — that characterization test must land before the hook extraction so "no behavior change" is provable
rather than asserted. With that plus the four other Wave-0 test files, the phase is gate-ready.
