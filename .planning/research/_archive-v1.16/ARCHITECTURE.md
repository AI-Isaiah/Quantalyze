# Architecture Research — v1.16 Production Resilience & Reliability

**Domain:** Hardening existing Vercel↔Railway↔Supabase plumbing (SEAM + JOB + RATE)
**Researched:** 2026-07-25
**Confidence:** HIGH (all findings read directly from live source + migrations, not training data)

This is a **subsequent-milestone hardening research** doc, not greenfield domain research.
It maps the *existing* wiring for the three v1.16 capabilities and states exactly where
new code should attach. No new external technology is required — every gap below is
closable with code already-idiomatic to this codebase (AbortSignal.timeout, pg_cron,
Upstash `checkLimit`).

## System Overview (as it exists today)

```
Browser ── fetch /api/** ──▶ Next.js 16 (Vercel, Fluid Compute)
                                │
                ┌───────────────┼────────────────────────────┐
                │               │                            │
                ▼               ▼                            ▼
     src/lib/analytics-   src/lib/process-key-      src/app/api/**/route.ts
     client.ts             client.ts                 (withAuth/withRole,
     (analyticsRequest())  (postProcessKey())          checkLimit, assertSameOrigin)
                │               │
                │  X-Service-Key│  Bearer INTERNAL_API_TOKEN
                ▼               ▼
     ┌──────────────────────────────────────┐
     │   FastAPI  analytics-service/main.py  │  (Railway, HTTP)
     │   routers/{analytics,portfolio,match, │
     │   exchange,process_key,csv,internal}  │
     └───────────────┬───────────────────────┘
                      │ enqueue_compute_job RPC (sync, in same request
                      │  OR fire-and-forget via Next `after()`)
                      ▼
     ┌──────────────────────────────────────┐
     │        Supabase Postgres              │
     │  compute_jobs (queue) + RPCs:         │
     │   claim_compute_jobs_with_priority    │
     │   mark_compute_job_done/failed        │
     │   reset_stalled_compute_jobs (in-worker│
     │     watchdog, 60s loop)               │
     │  pg_cron: retention_compute_jobs_     │
     │   orphaned_running (daily 04:15 UTC,  │
     │   DELETE running rows >4h old)        │
     └───────────────┬───────────────────────┘
                      │ claim (FOR UPDATE SKIP LOCKED)
                      ▼
     ┌──────────────────────────────────────┐
     │  analytics-service/main_worker.py     │  (Railway, separate CMD,
     │  3 asyncio loops: dispatch(30s),      │   same Docker image)
     │  watchdog(60s), daily-enqueue(24h)    │
     │  + main_worker_healthz (side HTTP)    │
     └────────────────────────────────────────┘
```

**Key correction to the milestone framing:** there are **two** distinct Vercel→Railway
client chokepoints today, not one:

1. **`src/lib/analytics-client.ts`** (`analyticsRequest()`) — used by `portfolio-optimizer`,
   `bridge`, `simulator`, `admin/match/recompute`, `admin/match/eval`,
   `keys/validate-and-encrypt` (`validateKey`/`encryptKey`), `scenario/optimize`. Has its
   own `AbortSignal.timeout(30_000)` default, `X-Service-Key` auth, Zod response
   validation, `AnalyticsTimeoutError`/`AnalyticsUpstreamError` classes. **No retry, no
   circuit breaker.**
2. **`src/lib/process-key-client.ts`** (`postProcessKey()`) — a **separate, parallel**
   fetch wrapper hitting `${ANALYTICS_URL}/process-key` with `Bearer INTERNAL_API_TOKEN`
   + `X-Correlation-Id` + `X-User-Id`. Used by `keys/sync`, `verify-strategy`,
   `csv-finalize`, `finalize-wizard`, `csv-validate`. Has its **own independent**
   `AbortSignal.timeout(60_000)`, its own timeout/network-error → `504`/`502` mapping.
   **No retry, no circuit breaker. Zero code sharing with `analytics-client.ts`.**

The milestone's own description ("`analytics-client.ts` ... cascade-500s `keys/sync`,
`verify-strategy`") is imprecise: `keys/sync` and `verify-strategy` do **not** call
`analytics-client.ts` at all — they call `process-key-client.ts`. `admin/match/*` is the
one named route that genuinely goes through `analytics-client.ts` (`recomputeMatch`,
`evalMatch`). **SEAM must cover both files** or unify them behind one shared resilience
core — see Recommendation below.

## Component Responsibilities

| Component | Responsibility | Current resilience | Gap |
|-----------|-----------------|---------------------|-----|
| `src/lib/analytics-client.ts` | Typed client for `/api/*` FastAPI endpoints (validate-key, encrypt-key, portfolio-analytics/optimizer/bridge, simulator, match/recompute, match/eval) | 30s `AbortSignal.timeout`, typed timeout/upstream-error classes, Zod schema validation | No retry-with-backoff, no circuit breaker — a hung Railway pod holds the Vercel lambda open the full timeout on every call, every time |
| `src/lib/process-key-client.ts` | Single shared wrapper for the unified `/process-key` endpoint (flows: teaser, onboard, resync, csv) | 60s `AbortSignal.timeout`, distinct `UPSTREAM_TIMEOUT`/`UPSTREAM_NETWORK_ERROR` error codes | Same as above — no retry, no breaker, and **duplicated** timeout/error-mapping logic vs `analytics-client.ts` (two independent implementations of the same resilience concern) |
| `compute_jobs` (Postgres table + RPCs, migration `20260411144407`) | Durable queue: `pending → running → done/failed/done_pending_children`; partial-unique index prevents duplicate in-flight jobs per (target, kind) | `claim_compute_jobs_with_priority` (FOR UPDATE SKIP LOCKED), `mark_compute_job_done/failed` (claim-token fenced), `defer_compute_job` | None — this is the solid foundation JOB builds on |
| `main_worker.py` watchdog loop (in-process, 60s) | Resets `running` rows whose `claimed_at` exceeds a **per-kind** threshold back to `pending` | `reset_stalled_compute_jobs` RPC, `WATCHDOG_PER_KIND_OVERRIDES` dict, healthz heartbeat during long dispatches (WEDGE-01 fix) | Only runs **while the worker process is alive** — a full worker crash/outage silences this loop entirely |
| pg_cron `retention_compute_jobs_orphaned_running` (migration `20260720120000`) | External backstop: `DELETE FROM compute_jobs WHERE status='running' AND claimed_at < now() - interval '4 hours'`, daily 04:15 UTC | Runs **inside Postgres**, independent of worker liveness — this is the correct backstop for "worker died, in-worker watchdog never fires" | Daily cadence only (up to ~24h detection latency); DELETEs (not resets) — a genuinely orphaned job leaves **no terminal row** the wizard/UI can key off; this is the exact WR-02 tradeoff the memory ledger flags as still-open |
| `after()` fire-and-forget enqueue (csv-finalize, finalize-wizard) | Schedules `enqueue_compute_job` RPC + a `strategy_analytics` placeholder write **after the HTTP response is sent**, via Next 16 `after()` | Already writes a `computation_status='failed'` placeholder **if the enqueue RPC itself errors** (guarded SELECT-then-UPSERT so it never stomps a worker's `complete` row) | The placeholder write lives **inside the same `after()` callback** as the enqueue call. If `after()` itself never runs to completion (Vercel kills/freezes the instance before the callback finishes), **neither the enqueue nor the placeholder fires** — the strategy is stuck with data persisted (`persist_csv_daily_returns` already committed, synchronously, before `after()` is scheduled) but no `compute_jobs` row and no terminal `strategy_analytics` row at all. This is the literal "detect strategy-with-data-but-no-compute-job" case the JOB requirement names. |
| Upstash rate limiter (`src/lib/ratelimit.ts`) | Named `Ratelimit` instances (`userActionLimiter`, `keysSyncUserLimiter`, `adminActionLimiter`, `simulatorLimiter`, etc.), each call-site imports the specific limiter and calls `checkLimit(limiter, key)` inline | Fail-closed in prod (`VERCEL_ENV==='production'`) if Upstash misconfigured, fail-open elsewhere | **No shared middleware/wrapper** — every route hand-wires its own `checkLimit(...)` call. Extending coverage means editing N route files individually (same pattern as the existing CSRF retrofit, flagged in CONCERNS.md as "no CI gate stops a new route from skipping it") |
| slowapi (Python side, `analytics-service/main.py` + per-router `Limiter`) | Second, independent layer of rate limiting inside FastAPI itself | `/process-key` POST has ONE blanket `@limiter.limit("100/hour", key_func=_process_key_rate_limit_key)` keyed on `(token_hash, X-User-Id)` covering **all** flow_types (teaser/onboard/resync/csv) together; `portfolio.py` has per-route `10/hour` (`portfolio-analytics`, `portfolio-optimizer`, `portfolio-bridge`) and a now-dead `5/hour` on a **legacy** `/verify-strategy` Python route (superseded by the unified `/process-key` path — the Next.js route no longer calls it) | **`routers/match.py` `/recompute` and `/eval` have NO slowapi decorator at all** — their only protection today is the Vercel-side `adminActionLimiter` (20/min). This is a genuine single-layer gap (no defense-in-depth), distinct from — and narrower than — the milestone's broader "currently-unlimited" framing, which does not hold for most of the named Next.js routes (see RATE findings below). |

## RATE finding: reconcile the milestone framing against the live code

PROJECT.md's REQ description lists `verify-strategy`, `keys/{sync,validate,encrypt}`,
`admin/match/recompute`, `admin/partner-import`, `trades/upload`, `intro` as
"currently-unlimited." **Verified against the live route files, this is not accurate as
stated** — every one of these Next.js routes already calls `checkLimit(...)` with a named
Upstash limiter:

| Route | Existing Vercel-side limiter | Existing Python-side (slowapi) limiter |
|-------|------------------------------|------------------------------------------|
| `verify-strategy` | `publicIpLimiter` (10/min per IP — it's an unauthenticated public route, not "authed") | shared `/process-key` 100/hour (all flow_types combined) |
| `keys/sync` | `keysSyncUserLimiter` (30/min/user) **+** `userActionLimiter` (5/min per user+strategy) | shared `/process-key` 100/hour |
| `keys/validate-and-encrypt` (there is no separate `keys/validate` or `keys/encrypt` route — the milestone's `{validate,encrypt}` maps to this one combined route) | `userActionLimiter` (5/min/user) | none dedicated (validate-key/encrypt-key endpoints, not process-key) |
| `admin/match/recompute` | `adminActionLimiter` (20/min/admin) | **none** — `routers/match.py` has no `@limiter.limit` |
| `admin/partner-import` | `adminActionLimiter` (20/min/admin) | not applicable (no Python compute call in the hot path) |
| `trades/upload` | `userActionLimiter` (5/min/user) | not verified in this pass |
| `intro` | `userActionLimiter` (5/min/user) | not applicable |

**Implication for the roadmap/requirements phase:** RATE's real gap is narrower and more
specific than "add rate limiting to unlimited routes." The two concrete, verified gaps
are:
1. `analytics-service/routers/match.py` (`/recompute`, `/eval`) has zero Python-side
   rate limiting — a caller that reaches Railway directly (bypassing Vercel, e.g. via a
   leaked `X-Service-Key` or a compromised Vercel deploy) has no backstop. Add a
   `@limiter.limit(...)` decorator mirroring `portfolio.py`'s `10/hour` pattern.
2. The wiring pattern itself is per-route manual `checkLimit(...)` calls, not a shared
   middleware — this is the actual "minimal wiring" question RATE should answer:
   whether to keep hand-wiring (matches existing convention, `withAuth`/`withRole`
   composition) or introduce a `withRateLimit(handler, limiter)` wrapper. Given
   `withAuth`/`withAdminAuth`/`withRole` already exist as the composition point and CSRF
   already composes through them, the **lowest-friction path is a `withRateLimit`
   higher-order wrapper that composes the same way** — not a global middleware, since
   different routes need different limiter identities (per-user vs per-IP vs
   per-user+strategy). This matches Rule 11 (match codebase conventions) better than
   introducing a new cross-cutting middleware layer.
3. Re-verify against `.planning/REQUIREMENTS.md` before roadmapping: the requirements
   phase should re-confirm which specific routes/endpoints are the actual targets,
   since the founder's plain-English list in PROJECT.md does not match "currently
   unlimited" literally for the Next.js layer.

## SEAM: where timeout/retry/breaker attach

**Two chokepoints, not one.** Both need the same resilience wrapper (retry-with-backoff
on idempotent reads only + circuit breaker), but they are separate modules today:

- `analyticsRequest()` in `src/lib/analytics-client.ts:65` — the single internal function
  every exported wrapper (`validateKey`, `encryptKey`, `computePortfolioAnalytics`,
  `runPortfolioOptimizer`, `findReplacementCandidates`, `simulateAddCandidate`,
  `recomputeMatch`, `evalMatch`) funnels through. **This is already a single
  chokepoint for its own callers** — good news, SEAM work here is additive to one
  function.
- `postProcessKey()` in `src/lib/process-key-client.ts:83` — the single function every
  `flow_type` (teaser/onboard/resync/csv) funnels through, called by `keys/sync`,
  `verify-strategy`, `csv-finalize`, `finalize-wizard`, `csv-validate`. **Also already a
  single chokepoint for its own callers.**

**Recommendation:** rather than wrap each file independently (duplicating the same
breaker-state logic twice), extract a shared `src/lib/resilient-fetch.ts` (or similar)
implementing `{ timeout, retry-with-backoff, circuit breaker }` as a small composable
core, and have both `analyticsRequest()` and `postProcessKey()` call through it. This
avoids the two-clients-drift problem already visible in production (they independently
reinvented timeout-error-mapping once already). Circuit breaker state should be
**per-target** (Railway is one deployment, so effectively one breaker instance is fine,
but keep it identity-scoped so a future second backend doesn't silently share state).

**Retry-safety analysis (idempotent reads only, per the milestone's own constraint):**
- Safe to retry: `evalMatch` (GET), `computePortfolioAnalytics`, `runPortfolioOptimizer`,
  `findReplacementCandidates`, `simulateAddCandidate` (all read-and-compute, no
  mutation on the Postgres side beyond the caller's own analytics cache) — verify each
  handler is side-effect-free server-side before flipping retry on, since some (e.g.
  `recomputeMatch`) may have write side effects the SEAM work must NOT blindly retry.
- **Do not retry** `validateKey`/`encryptKey` (encrypts credentials — retrying a
  timed-out-but-actually-succeeded encrypt could double-write or race) and
  `postProcessKey()` calls (the unified `/process-key` router performs real writes —
  `finalize_csv_strategy`, `persist_csv_daily_returns`, RPC enqueues — a naive retry on
  a request that *did* succeed upstream but timed out on the response leg would
  double-execute). The `/process-key` router's existing `WIZARD_DUPLICATE` idempotency
  handling (visible in `keys/sync`'s `upstream.code === "WIZARD_DUPLICATE"` branch)
  suggests some idempotency already exists server-side for the wizard flows — SEAM
  should confirm which `/process-key` flow_types are provably idempotent (safe to
  retry) before enabling retry broadly, rather than assume none are.

## JOB: lifecycle end-to-end + where the janitor belongs

**Enqueue sites (grep-verified, using Next 16 `after()`):**
`src/app/api/strategies/csv-finalize/route.ts` (`enqueueCsvAnalyticsAfter`),
`src/app/api/strategies/finalize-wizard/route.ts` (mirrors the same pattern),
plus 20+ other `after()` call sites for non-compute-job work (audit logging, email,
notifications) — the two above are the compute-job-relevant ones.

**The actual crash point (verified in `csv-finalize/route.ts`):** `persist_csv_daily_returns`
runs **synchronously** in the request (before the response is sent) — so by the time
`after()` schedules the enqueue, the daily-returns data is already durably committed.
The enqueue + placeholder-on-failure logic then runs **inside** the `after()` closure.
Today's guard (`writeFailedStrategyAnalyticsPlaceholder`) only fires if the RPC call
inside `after()` **throws or returns an error** — it does **not** cover the case where
`after()` itself never completes (Vercel kills the lambda instance before the callback
runs — documented Vercel behavior under sustained load/instance recycling). That gap is
exactly JOB's "detect strategy-with-data-but-no-compute-job" scope: a periodic sweep
must find strategies where `csv_daily_returns` (or equivalent) rows exist for a
`strategy_id` but `compute_jobs` has no row (of any status) for it, and no
`strategy_analytics` terminal row exists — then either re-enqueue or write the failed
placeholder from *outside* the request lifecycle, where `after()` reliability is not a
factor.

**Worker crash point:** `main_worker.py`'s `dispatch_tick` claims a **batch of 5** jobs
per tick (`p_batch_size: 5`) and dispatch is **sequential** within the batch
(`for job in jobs: ... await dispatch(job)`). The longest per-kind handler timeout is
30 min (`process_key_long`, `reconstruct_allocator_history`) — so a batch's 5th job can
legitimately have a `claimed_at` up to ~2.5h old on a healthy worker (this is the exact
math the `20260720120000` migration's header derives to justify the 4h purge window).
If the **worker process itself dies** mid-dispatch (OOM, Railway restart, uncaught
exception escaping the per-job try/except), the row stays `running` forever with no
in-process watchdog to reset it (the watchdog is *also* part of the dead process).

**Reconciling with the existing orphaned-`running` purge — extend, don't duplicate:**
The correct mental model is **two tiers, already correctly separated**, and JOB should
extend the existing migration rather than build a new mechanism:
1. **In-worker watchdog** (`reset_stalled_compute_jobs`, 60s loop, per-kind thresholds
   in `WATCHDOG_PER_KIND_OVERRIDES`) — handles "job hung on a live worker," resets to
   `pending` (retryable), minutes-scale detection. **No JOB change needed here** — this
   layer is sound.
2. **External pg_cron purge** (`retention_compute_jobs_orphaned_running`, migration
   `20260720120000`, daily 04:15 UTC) — handles "worker itself died, nobody is running
   the watchdog." This is **the correct location for JOB's janitor extension**: it
   already runs independent of worker liveness (the load-bearing property a Vercel cron
   route or the worker's own loop cannot offer — a Vercel cron route adds a *third*
   liveness dependency, and the worker's own loop is exactly what's dead in this
   scenario). **Do not build a Vercel cron route or a fourth worker loop for this** —
   it would either (a) depend on the same failure domain (worker loop) or (b) add
   Vercel Hobby-plan cron-slot pressure (already at its 2-cron ceiling per CONCERNS.md)
   for a job that Postgres can already run natively and reliably.
3. **What JOB should actually add to the pg_cron layer:**
   - Tighten the *cadence* — 04:15-daily leaves up to ~24h of a stuck spinner before
     detection. The founder's WR-02 decision to widen 2h→4h fixed a false-positive
     hazard (deleting a live batch-tail job); it did not address detection latency. A
     more frequent (e.g. hourly) pg_cron run of the *same* DELETE, still gated at the
     4h `claimed_at` threshold, gets detection latency down without reopening the
     false-positive risk (the threshold, not the cron frequency, is what protects
     against eating a live job).
   - Resolve the WR-02 DELETE-vs-reset question explicitly as part of JOB, since it's
     the one open decision blocking a clean go-live gate per the memory ledger
     (`project_worker04_purge_delete_vs_reset_prod_outage`): a DELETE leaves the
     strategy with **no terminal row at all** (the wizard poller spins forever even
     after the row is gone) — JOB's "detect stuck computing" sweep (previous
     paragraph) and this purge should be **the same mechanism**: instead of a bare
     DELETE, transition truly-orphaned `running` rows to `failed` (a terminal status)
     so downstream pollers can break out, and only actually delete via the existing
     30/90-day `retention_compute_jobs_failed`/`done` crons already in place
     (migration `056`). This closes JOB's "no forever-spinners" goal and the founder's
     open WR-02 call in one change, reusing 100% of the existing migration
     infrastructure (just changing the cron body's SQL from DELETE to UPDATE ... SET
     status='failed').
   - The csv-finalize/finalize-wizard "data but no job row" case (previous section) is
     a **different failure mode** from "job row exists but stuck" — it needs its own
     sweep (a new pg_cron function or an extension of the existing daily retention
     job family) that looks for orphaned strategies by absence, not by a stale
     `claimed_at`. This is new, not an extension of `20260720120000` — flag it as a
     separate JOB sub-requirement.

**WEDGE-01 constraint (already-fixed precedent, must not be reintroduced):** the P-97
soak incident proved that heavy synchronous work sharing the worker's single asyncio
event loop starves the healthz heartbeat past `STALE_THRESHOLD` (90s) → Railway restarts
the worker mid-job. The fix already in place (`main_worker_healthz`, the
`_HEARTBEAT_INTERVAL_S` background task cancelled in `finally`, `asyncio.to_thread` for
Postgres calls in `services/db.py`) is the template: **any new JOB code that runs
inside `main_worker.py` must never block the event loop** (no synchronous pandas/CPU
work, no un-awaited blocking I/O). Because the recommended reaper lives in **pg_cron**
(a separate Postgres-native execution context, not the worker's asyncio loop), it is
**structurally immune** to WEDGE-01 by construction — this is an additional argument
for the pg_cron placement over a worker-loop-based janitor, beyond the liveness
argument above.

## New vs Modified — summary table for the roadmapper

| Item | New or Modified | Where |
|------|------------------|-------|
| Shared resilience core (timeout/retry/breaker) | **New** | e.g. `src/lib/resilient-fetch.ts` |
| `analyticsRequest()` in `analytics-client.ts` | **Modified** | call through the new shared core |
| `postProcessKey()` in `process-key-client.ts` | **Modified** | call through the new shared core |
| Retry-safety audit per exported wrapper function | **New** (analysis, then modified call sites) | both client files |
| "Data but no job" sweep (csv/wizard orphan detection) | **New** pg_cron function or migration | `supabase/migrations/` |
| Orphaned-`running` purge cadence + DELETE→UPDATE | **Modified** | extends `20260720120000` (new migration on top, do not edit the shipped one) |
| `withRateLimit` composable wrapper (if adopted) | **New** | `src/lib/api/` alongside `withAuth`/`withRole` |
| `analytics-service/routers/match.py` rate limiting | **Modified** | add `@limiter.limit(...)` mirroring `portfolio.py` |
| In-worker watchdog (`reset_stalled_compute_jobs`) | **Unchanged** | already sound, no JOB work needed |
| `main_worker.py` healthz/heartbeat pattern | **Unchanged** (reference pattern only) | precedent for WEDGE-01 discipline |

## Suggested Build Order

1. **SEAM first** (the founder's own top-priority ranking, and structurally the
   highest-leverage single change): extract the shared resilience core, wire
   `analytics-client.ts` first (it's the simpler, more clearly-idempotent set of
   callers — `bridge`, `simulator`, `portfolio-optimizer`, `match/eval`), then
   `process-key-client.ts` (needs the retry-safety-per-flow_type audit before enabling
   retry, since some flows are non-idempotent writes). Ship timeout+breaker before
   retry if sequencing needs to split further — breaker alone (fail fast, no retry)
   is a strict improvement with zero double-execution risk.
2. **JOB second**, because the "data but no job" sweep and the purge-to-failed-not-delete
   change both build on SEAM's error classification (a distinguishable
   `AnalyticsTimeoutError`/`AnalyticsUpstreamError` split is what lets a sweep decide
   "retry" vs "terminal fail" for a stuck strategy). Two independent sub-tracks that can
   run in parallel once SEAM lands:
   - 2a. Extend `20260720120000`'s purge: new migration, cadence tightened, DELETE→
     terminal-status UPDATE. Low risk, pure SQL, reuses existing retention-cron
     infrastructure.
   - 2b. New "data but no job row" sweep — needs a bit more design (what counts as
     "orphaned," which tables to check per strategy source: csv vs wizard vs
     resync) before it's a single migration.
3. **RATE last** (lowest technical risk, most mechanical): confirm the actual gap list
   against `.planning/REQUIREMENTS.md` (per the RATE finding above, several named
   routes already have limiters — don't re-wire what's already wired), add the missing
   `match.py` slowapi decorator, and decide once whether to introduce `withRateLimit`
   or continue the manual `checkLimit(...)` convention for any genuinely-new coverage.

This order respects dependencies (JOB's sweep benefits from SEAM's error taxonomy;
RATE is independent but cheapest to sequence last given the framing needs
re-verification first) and keeps the WEDGE-01 constraint satisfied throughout (no new
JOB code proposed here runs inside the worker's asyncio loop).

## Anti-Patterns to Avoid

### Anti-Pattern 1: Building the reaper as a fourth worker loop or a new Vercel cron route
**What people might do:** add a 4th `asyncio` loop to `main_worker.py`, or a new
`src/app/api/cron/reap-orphaned-jobs/route.ts` on Vercel.
**Why it's wrong:** a worker-loop reaper shares the exact failure domain it's meant to
backstop (worker died → reaper also dead). A Vercel cron route adds pressure to the
Hobby-plan 2-cron ceiling already flagged as a recurring production incident cause
(CONCERNS.md: "production was dark Sprint 4 → 2026-04-17 because of the Hobby cap
breach") and depends on Vercel Cron's own liveness instead of Postgres's.
**Instead:** pg_cron, extending the migration that already does this correctly.

### Anti-Pattern 2: Wrapping each client file's fetch call independently
**What people might do:** add retry/breaker logic separately inside
`analytics-client.ts` and `process-key-client.ts` (mirroring how they already
independently reinvented timeout-error mapping).
**Why it's wrong:** two independent circuit-breaker state machines against the same
Railway backend can disagree about whether the backend is "open" or "closed," and any
future bug fix has to land twice (exactly the drift class this codebase's memory
ledger repeatedly flags — e.g. `feedback_close_whole_batch_complete_surface`).
**Instead:** one shared core, both clients call through it.

### Anti-Pattern 3: Blanket-enabling retry on every analytics-client call
**What people might do:** wrap the whole `analyticsRequest`/`postProcessKey` function
in a generic retry-on-any-5xx-or-timeout loop.
**Why it's wrong:** several wrapped calls perform real writes (`validateKey`/
`encryptKey` encrypt+store credentials; `/process-key` flows finalize strategies,
persist daily-returns, enqueue jobs) — retrying a request whose response was lost but
whose write succeeded server-side can double-execute. The milestone description itself
scopes retry to "idempotent reads only" — honor that literally, per-function, not
per-file.
**Instead:** an explicit allowlist of retry-safe functions, verified against what each
upstream handler actually mutates.

## Sources

- `src/lib/analytics-client.ts`, `src/lib/process-key-client.ts` (read in full)
- `analytics-service/main_worker.py` (read in full)
- `analytics-service/routers/{match,portfolio,process_key,csv,exchange}.py` (grepped for
  `@router.`/`@limiter.limit`)
- `src/app/api/strategies/csv-finalize/route.ts` (read in full — representative
  `after()` enqueue + placeholder pattern, shared with `finalize-wizard`)
- `src/app/api/keys/sync/route.ts`, `src/app/api/verify-strategy/route.ts` (read in
  full)
- `supabase/migrations/20260411144407_compute_jobs_queue.sql`,
  `20260412094449_compute_jobs_admin_and_defer.sql`,
  `20260719120000_*` / `20260720120000_retention_orphaned_running_window_4h.sql` (read
  in full — the live orphaned-`running` purge + its WR-02/RT-01 rationale)
- `src/lib/ratelimit.ts` (read in full — all named limiters + fail-open/closed policy)
- `.planning/PROJECT.md` (Current Milestone section — REQ framing for SEAM/JOB/RATE)
- `.planning/codebase/ARCHITECTURE.md`, `.planning/codebase/INTEGRATIONS.md`,
  `.planning/codebase/CONCERNS.md` (2026-04-17 snapshot — cross-referenced, several
  findings there, e.g. Hobby-cron-cap fragility and the CSRF-retrofit-has-no-CI-gate
  pattern, are directly relevant precedent for how RATE coverage should NOT be wired)
- Memory ledger: `project_worker04_purge_delete_vs_reset_prod_outage`,
  `project_stitch_composite_wedge01_fix_and_local_prod_worker` (grounded the
  DELETE-vs-reset open question and the WEDGE-01 constraint against the actual shipped
  fix, not just the summary)

---
*Architecture research for: v1.16 Production Resilience & Reliability (SEAM + JOB + RATE)*
*Researched: 2026-07-25*
