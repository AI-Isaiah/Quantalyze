# Stack Research

**Domain:** Production resilience hardening for an existing Vercel (Next.js Fluid Compute) → Railway (FastAPI) seam, backed by Supabase Postgres. NOT a new feature — closing failure-handling gaps in live plumbing (SEAM / JOB / RATE, v1.16).
**Researched:** 2026-07-25
**Confidence:** HIGH (every recommendation is grounded in a direct read of the current codebase; library versions verified against the npm registry, which matched what's already pinned in `package.json`)

## Executive framing

This milestone needs **almost no new dependencies**. The codebase already has:
- `@upstash/ratelimit@2.0.8` + `@upstash/redis@1.38.0` installed and wired (`src/lib/ratelimit.ts`) — a durable, cross-instance, fail-closed-in-prod rate limiter.
- `AbortSignal.timeout()` already used for the Vercel→Railway fetch deadline in both seam clients (`src/lib/analytics-client.ts:90`, `src/lib/process-key-client.ts:132`).
- A per-kind Postgres watchdog (`reset_stalled_compute_jobs`, migration `20260412094449_compute_jobs_admin_and_defer.sql`) and a `portfolio_analytics`-scoped sibling (`reset_stalled_portfolio_analytics`, migration `20260516122247_portfolio_analytics_stuck_row_reaper.sql`) that already implement the exact reaper pattern SEAM/JOB needs — just not yet applied to `strategy_analytics`.

The stack work for v1.16 is: (1) a ~40-line hand-rolled retry+circuit-breaker layer built ON TOP of the already-installed Upstash client (SEAM), (2) one new SQL migration that clones the existing `reset_stalled_portfolio_analytics` pattern onto `strategy_analytics` plus a scheduling hookup (JOB), and (3) a verification/closure pass on rate limiting, because **the RATE premise does not hold up against the current code** (see below) — most of it is already done.

## Recommended Stack

### Core Technologies (already installed, zero version changes)

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| `AbortSignal.timeout()` | Web platform API (no version) | Per-request fetch deadline on the Vercel→Railway seam | Already the mechanism in both `analytics-client.ts` (30s default) and `process-key-client.ts` (60s). Zero-dependency, works identically in Fluid Compute's Node.js runtime. Nothing to add — SEAM's timeout leg is DONE; only retry + breaker are missing. |
| `@upstash/redis` | 1.38.0 (current — matches npm registry HEAD) | Shared, cross-instance state store | Vercel KV is discontinued (confirmed); Upstash Redis over REST is the only durable cross-Fluid-Compute-instance store already wired into this codebase. This is the backing store for BOTH the existing rate limiter AND the new circuit breaker — no second store needed. |
| `@upstash/ratelimit` | 2.0.8 (current) | Sliding-window counters | Already used for the 15 named limiters in `ratelimit.ts`. Its `Ratelimit.slidingWindow()` primitive is ALSO the correct primitive for the circuit breaker's failure-counting (see SEAM design below) — reuse it, don't hand-roll a counter. |
| Postgres `plpgsql` functions (`SECURITY DEFINER`) | Supabase-managed | Reaper/janitor logic | `reset_stalled_compute_jobs` and `reset_stalled_portfolio_analytics` are the established pattern for this exact class of bug (worker crash / silent enqueue drop leaving a row stuck in a non-terminal state). Clone, don't reinvent. |

### Supporting additions (new code, not new packages)

| Addition | Where | Purpose | When to Use |
|----------|-------|---------|-------------|
| `withRetry()` helper | new `src/lib/analytics-client-retry.ts` (or inline in `analytics-client.ts`) | Bounded retry-with-backoff wrapping `analyticsRequest` | ONLY for idempotent GET/read calls (e.g. `evalMatch`, and any future read endpoint). Exponential backoff + full jitter, 2-3 attempts max, retries only on `AnalyticsTimeoutError`, network-throw, and 502/503/504 — never on 4xx or a POST that mutates/enqueues (`recomputeMatch`, `validateKey`/`encryptKey`, `computePortfolioAnalytics` are POST-shaped and side-effecting-adjacent; do not blanket-retry them without an idempotency key). |
| `AnalyticsCircuitBreaker` class | new `src/lib/analytics-circuit-breaker.ts` | Trip on sustained Railway failure, fail fast without hitting the network | Wraps every `analyticsRequest` call (all seam clients funnel through the one `analyticsRequest` chokepoint in `analytics-client.ts:65` — this is the single integration point). |
| `strategy_analytics` reaper | new migration cloning `20260516122247_portfolio_analytics_stuck_row_reaper.sql` | Reap `computation_status='computing'` rows with no active `compute_jobs` row | Scheduled call from the existing Railway watchdog loop (`main_worker.py`, already runs `reset_stalled_compute_jobs` on a 60s interval — add the sibling RPC to the same loop) OR from the existing `/api/cron/reconcile-strategies`-style Vercel cron. Either wire is consistent with existing conventions; prefer the worker loop since it already owns this exact responsibility for `compute_jobs` and runs every 60s (much tighter than the 24h-scoped Vercel crons). |

## SEAM — Vercel→Railway resilience

### What already exists (verified by direct read)

`src/lib/analytics-client.ts` (the primary seam, used by `validateKey`, `encryptKey`, `computePortfolioAnalytics`, `runPortfolioOptimizer`, `findReplacementCandidates`, `simulateAddCandidate`, `recomputeMatch`, `evalMatch`) and `src/lib/process-key-client.ts` (used by `verify-strategy`, `keys/sync`, `csv-validate`, `csv-finalize`, `finalize-wizard`) both ALREADY:
- Set `signal: AbortSignal.timeout(timeoutMs)` per request (30s default / 15s for Bridge+simulator / 60s for `/process-key`).
- Catch `DOMException name === "TimeoutError"` and translate it to a typed error (`AnalyticsTimeoutError` / a `504 UPSTREAM_TIMEOUT` envelope).
- Distinguish network-unreachable from timeout from non-2xx.

Neither file has ANY retry or circuit breaker. A hung/slow Railway instance today: (1) times out cleanly per-request (good), but (2) every subsequent request pays the FULL timeout again before failing, holding a Fluid Compute instance/CPU-time budget open on each attempt, and (3) there is no fast-fail signal that stops hammering an already-down Railway during an extended outage.

### Retry-with-backoff — recommendation

Add a single retry wrapper around `analyticsRequest`'s internal `fetch` call (and the equivalent in `process-key-client.ts`), NOT a new dependency:

- **Attempts:** 2 retries max (3 total attempts) — a hung seam should fail fast, not compound latency into a 300s `maxDuration` budget.
- **Backoff:** exponential with full jitter — `base * 2^attempt * random(0,1)`, base ~200ms. Hand-rolled (10-15 lines); this codebase already has `abortableWait` in `src/lib/retry/wait.ts` for a conceptually identical client-side primitive — the SERVER-side seam wrapper should mirror that shape (a `sleep(ms, signal)` that resolves early on abort) rather than importing the client helper directly (that module is intentionally client-retry-shaped per its own docstring: divergent per-caller state machines, not a generic fetch wrapper).
- **Idempotency gate:** only retry when the call is a genuine read (`evalMatch` today) OR when the Python side is provably idempotent by construction (e.g. `enqueue_compute_job` is dedup'd by a partial unique index per the `compute_jobs` schema — a retried enqueue is safe). Every other POST (`validateKey`, `encryptKey`, `recomputeMatch`, `computePortfolioAnalytics`) must NOT be blanket-retried without confirming server-side idempotency; default to no-retry-on-POST unless a specific route proves otherwise. This mirrors the "idempotent reads only" instruction in the milestone brief and the existing codebase's own security posture (comments in `keys/sync/route.ts` are explicit about "possible double-submit" being handled by DB uniqueness, not by client retry).
- **What NOT to add:** `p-retry`, `async-retry`, `cockatiel`'s retry policy, or any npm package. A bounded-attempt exponential-jitter loop is ~15 lines and the codebase's own convention (see `src/lib/retry/`) is to hand-roll these primitives rather than pull in a generic resilience library — stay consistent.

### Circuit breaker — recommendation

**The state MUST be shared across Fluid Compute instances, not per-instance in-memory.** Fluid Compute reuses instances across concurrent/sequential requests (per the platform's current behavior), which gives an in-memory breaker SOME value within one warm instance, but Vercel still runs many concurrent instances under load and cold-starts fresh ones — an in-memory-only breaker would let N different instances all independently rediscover "Railway is down" via N full timeout cycles instead of one shared trip. Given Upstash Redis is ALREADY the durable cross-instance store in this codebase (backing the rate limiter), build the breaker on it directly:

- **Failure counter:** reuse `@upstash/ratelimit`'s `Ratelimit.slidingWindow(N, window)` as the failure-rate detector — e.g. `slidingWindow(5, "30 s")` per upstream target. Call `.limit("breaker:analytics-service")` on every failed seam call (timeout, network-throw, or 5xx); when it denies (5 failures in 30s), the breaker is OPEN.
- **Open-state lock (fail-fast):** on trip, `redis.set("breaker:analytics-service:open", "1", { ex: cooldownSeconds })` (e.g. 15-30s cooldown) using a plain SET with EX. Every seam call checks this key FIRST (one Redis GET, ~5-15ms over REST) and short-circuits with a clean 503 before ever touching `fetch()` if the key is present.
- **Half-open probe:** when the key's TTL expires, the next request naturally attempts the real call again (no extra state needed — TTL expiry IS the half-open transition). On success, do nothing further (closed). On failure, `SET ... EX` again to reopen.
- **Why this and not a library:** `cockatiel@4.0.0` and `opossum@10.0.0` (both current, verified via web search 2026-07-25) are well-maintained Node circuit breakers, but BOTH are in-memory-only — neither ships a distributed backend. Adopting either would still require hand-writing a Redis-backed state adapter to get correct cross-instance semantics, at which point the library adds an abstraction layer over logic you have to write anyway. Building directly on the already-installed `@upstash/redis` + `@upstash/ratelimit` is fewer total lines, one fewer dependency, and reuses infrastructure already proven live (the existing rate limiter's fail-open/fail-closed production behavior in `ratelimit.ts` is the exact template to copy for the breaker's own Redis-unavailable fallback: **fail-open outside prod, fail-open on Redis error even in prod** — unlike the rate limiter, a broken breaker should never itself cause an outage; err toward attempting the real call over false-tripping.
- **Integration point:** the ONE chokepoint is `analyticsRequest()` in `analytics-client.ts:65` — every public wrapper (`validateKey`, `encryptKey`, `recomputeMatch`, etc.) already funnels through it, so the breaker check/trip logic goes there once. `process-key-client.ts`'s `postProcessKey()` is the second (separate) chokepoint used by the `/process-key` unified-backbone routes — it needs its OWN breaker key (`breaker:process-key`) since Railway may be healthy for one code path and not the other (unlikely but not assumed), OR both can share one `breaker:railway` key if the intent is "one physical Railway service" — recommend ONE shared key since both hit the same Railway deployment; simpler and the failure modes (Railway down) are physically identical.

## JOB — Job-state integrity

### What already exists (verified by direct read)

- `reset_stalled_compute_jobs` (migration `20260412094449_compute_jobs_admin_and_defer.sql`, hardened in `20260516104201_..._residual.sql` with `LIMIT 500 FOR UPDATE SKIP LOCKED`) — a per-kind-threshold watchdog for `compute_jobs` rows stuck in `running`. Called every 60s from `main_worker.py`'s watchdog loop (`main_worker.py:788` `_reset()`).
- `reset_stalled_portfolio_analytics` (migration `20260516122247_portfolio_analytics_stuck_row_reaper.sql`) — reaps `portfolio_analytics.computation_status='computing'` rows older than a threshold (30 min default), flips to `failed`, never deletes (preserves audit trail). Called from `routers/cron.py:876` inside the recompute cron tick.
- A retention purge for orphaned `running` `compute_jobs` rows (migrations `20260719120000_retention_orphaned_running_compute_jobs.sql` / `20260720120000_retention_orphaned_running_window_4h.sql`, WORKER-04) — this is DELETE-based in one environment and reset-based in another per the tracked WR-02 tech debt (deferred, TEST wants DELETE / PROD wants reset per the same migration — a known open item, not solved by v1.16's scope per se, but the JOB group's "worker-crash computing-row janitor" language directly references resolving this).
- A ONE-TIME manual deploy script, `analytics-service/scripts/reset_stuck_computing_rows.py` (plan D.11), that does EXACTLY what a `strategy_analytics` reaper should do on an ongoing basis: find `computation_status='computing'` rows with no active `compute_jobs` row, flip to `failed`. **This script's existence is direct evidence the bug has already happened in production once** — it was hand-run after a platform-upgrade interruption, not a recurring safeguard.

### The concrete gap

**`strategy_analytics` has NO recurring reaper.** `portfolio_analytics` got one (migration 20260516122247); `strategy_analytics` — the table `keys/sync`, `csv-finalize`, `finalize-wizard`, and the unified `/process-key` backbone all write `computation_status` into — did not. This is the exact table the milestone's "stuck computing spinner" risk describes, and the one-time script proves the failure mode is real, not hypothetical.

Additionally, `after()` itself is confirmed (via the canonical fork docs at `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/after.md`) to run "even if the response didn't complete successfully... including when an error is thrown," and is implemented via Vercel's `waitUntil` — but neither the doc nor the underlying primitive guarantees execution across a hard platform-level kill (OOM, deploy-time instance recycle, or a genuinely crashed lambda before `waitUntil`'s promise settles). This is architecturally undetectable from INSIDE the route handler — the enqueue call itself already has try/catch + a `writeFailedStrategyAnalyticsPlaceholder` fallback in `csv-finalize/route.ts` (comment tag W-2/API M-2), which is good defense for "enqueue call ran but errored." It cannot catch "the `after()` callback itself never ran at all." Only an EXTERNAL, periodic reconciliation (cron-based, comparing `strategy_analytics.computation_status='computing'` against the absence of a live `compute_jobs` row — precisely the one-time script's query shape) closes that hole.

### Recommendation

1. **New migration**, clone of `20260516122247_portfolio_analytics_stuck_row_reaper.sql`, targeting `strategy_analytics`: `reset_stalled_strategy_analytics(p_stale_threshold INTERVAL)`. Same semantics — UPDATE not DELETE, terminal `failed` with a `computation_error` tag, partial index on `(strategy_id) WHERE computation_status = 'computing'` for cheap polling.
2. **Extend the existing NOT-EXISTS-active-job check** from `reset_stuck_computing_rows.py` into the new SQL function body (the one-time script's logic — "computing AND no compute_jobs row in a non-terminal status" — is a STRONGER signal than pure time-based staleness alone, since it also catches the drop-enqueue case specifically, not just a slow/crashed worker). Recommend the SQL function accept both signals: time-threshold-only (mirrors the proven `portfolio_analytics` pattern, simplest) OR the NOT-EXISTS refinement (mirrors the one-time script, more precise). Given `strategy_analytics` computation can legitimately take longer (composite stitches, MT5 backfills) than portfolio recompute, prefer the NOT-EXISTS refinement to avoid false-positive reaping of a genuinely still-running long job — a pure time threshold would need to be set conservatively high (matching the longest `TIMEOUT_PER_KIND` entry, currently `process_key_long` at 40 min) to avoid that.
3. **Scheduling:** call it from the SAME 60s watchdog loop in `main_worker.py` that already calls `reset_stalled_compute_jobs` (`main_worker.py:788`) — this is a one-line addition to an existing, already-running, already-tested loop, not a new cron entry. This is tighter (60s) than the `portfolio_analytics` reaper's placement inside a cron tick and closes the gap faster.
4. **csv-finalize transactionality:** the current `enqueueCsvAnalyticsAfter` (csv-finalize/route.ts:688) already has a placeholder-on-enqueue-failure fallback (good), but the underlying multi-step sequence (`finalize_csv_strategy` RPC → `persist_csv_daily_returns` RPC → `after()`-deferred enqueue) is not a single transaction — a request that succeeds through the first two RPCs and then genuinely loses the `after()` callback (not merely errors inside it) is exactly the reaper's job to catch, not a new DB transaction wrapper. No new stack technology needed here; Postgres itself already offers `BEGIN`/`COMMIT` inside a single RPC if the two existing RPCs are ever merged into one SECURITY DEFINER function — that's a code-structure decision for the roadmap/phase level, not a new dependency.

## RATE — Rate limiting

### Premise check — IMPORTANT finding

The milestone brief states verify-strategy, `keys/{sync,validate,encrypt}`, `admin/match/recompute`, `admin/partner-import`, `trades/upload`, and `intro` are "UNLIMITED." **Direct code read shows this is not accurate as of the current `main` branch:**

| Route | File | Limiter already applied | Git evidence |
|---|---|---|---|
| `verify-strategy` | `src/app/api/verify-strategy/route.ts:22` | `publicIpLimiter` (10/min/IP), checked before body parse | last touched Phase 122 (`e46de4da`) |
| `keys/sync` | `src/app/api/keys/sync/route.ts:86,93` | TWO-TIER: `keysSyncUserLimiter` (30/min/user aggregate) + `userActionLimiter` (5/min per user+strategy) | pre-existing, F6 audit-2026-05-07 |
| `keys/validate-and-encrypt` (covers both "validate" and "encrypt") | `src/app/api/keys/validate-and-encrypt/route.ts:111` | `userActionLimiter` (5/min/user) | last touched Phase 135 (`035c4e42`) |
| `admin/match/recompute` | `src/app/api/admin/match/recompute/route.ts:37` | `adminActionLimiter` (20/min/user) | audit-2026-05-07 |
| `admin/partner-import` | `src/app/api/admin/partner-import/route.ts:471` | `adminActionLimiter` (20/min/user) + a 500-row body cap + a 4MB byte cap | audit-2026-05-07 |
| `trades/upload` | `src/app/api/trades/upload/route.ts:110` | `userActionLimiter` (5/min/user) + a 5,000-row cap | pre-existing |
| `intro` | `src/app/api/intro/route.ts:117` | `userActionLimiter` (5/min/user) | pre-existing |

Every one of these routes already calls `checkLimit()` against the shared Upstash-Redis-backed limiter set in `src/lib/ratelimit.ts`, in the canonical validate-then-limit order (B15 audit convention). **There is no rate-limiting stack gap on these seven routes today.**

### What this means for the roadmap

Re-scope the RATE requirement group before planning phases around it. The likely real remaining work (none of it requires new technology — all of it reuses `checkLimit` / `makeLimiter` from the existing `ratelimit.ts`):
- **Verify, don't build**: confirm the above table via a fresh grep/test pass — if this was already true when the milestone was scoped, the RATE group may already be satisfied and should be re-validated as a phase-0 audit rather than new engineering.
- **If a genuine gap is found elsewhere** (e.g., a route added after this research, or a route this pass missed), close it with the SAME `withAuthLimited` wrapper (`src/lib/api/withAuthLimited.ts`) or the same inline `checkLimit(...)` pattern — never a new library.
- **Defense-in-depth candidate** (optional, lower priority): the Python `analytics-service` itself has no independent rate limit on `/process-key`, `/validate-key`, etc. — it currently relies entirely on the Next.js edge layer's limiter plus the `X-Service-Key` / `INTERNAL_API_TOKEN` bearer check. If a threat model requires defense against a leaked internal token calling Railway directly (bypassing Vercel), that would need a Python-side limiter — but this is a NEW consideration outside what the milestone brief described, and should be raised as a scope question, not assumed into the plan.

## Installation

```bash
# Nothing to install — every recommended mechanism reuses already-installed
# packages (@upstash/ratelimit@2.0.8, @upstash/redis@1.38.0) or Web Platform
# APIs (AbortSignal.timeout) already present in the codebase.
```

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|--------------------------|
| Hand-rolled retry wrapper (~15 lines) over `analyticsRequest` | `p-retry` / `async-retry` (npm) | Only if retry logic needs to grow far more complex (e.g. per-error-type retry policies across many unrelated call sites) — not the case here; one chokepoint, one policy. |
| Redis-backed circuit breaker on `@upstash/redis` + `@upstash/ratelimit` (reused) | `cockatiel@4.0.0` | If Quantalyze ever runs a persistent long-lived Node process (not Fluid Compute lambdas) where in-memory breaker state is naturally shared — e.g. if the seam client moved server-side into `main_worker.py`'s own outbound calls instead of Vercel's. Not applicable to the Vercel→Railway direction today. |
| Redis-backed circuit breaker (reused) | `opossum@10.0.0` | Same caveat as cockatiel — in-memory only, requires Node ≥22 (this repo already targets Node ≥22 per `package.json` engines, so version compat isn't the blocker; shared-state is). |
| Clone `reset_stalled_portfolio_analytics` → `reset_stalled_strategy_analytics` | A generic "any table" reaper function parametrized by table name | Postgres `plpgsql` can't easily parametrize the target table name in a typed, injection-safe way without dynamic SQL (`EXECUTE format(...)`) — the existing codebase's convention (one function per table, copy-pasted with table-specific column knowledge) is simpler and matches `reset_stalled_compute_jobs` / `reset_stalled_portfolio_analytics` precedent. Don't introduce dynamic SQL here for two tables. |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `cockatiel` / `opossum` / any general resilience library | Both are in-memory-only; Fluid Compute runs multiple concurrent + cold-started instances, so an in-memory breaker gives incomplete protection and you'd still have to hand-write a Redis adapter on top — at which point the library is pure overhead | Hand-rolled breaker on `@upstash/redis` (already installed) |
| `p-retry`, `async-retry`, `retry` (npm) | One chokepoint (`analyticsRequest`), one retry policy, idempotent-reads-only — a generic configurable retry library adds an abstraction for a problem that's ~15 lines of exponential-jitter backoff | Hand-rolled `withRetry()`, mirroring the existing `src/lib/retry/` module's hand-rolled style |
| Vercel KV | **Discontinued** — Vercel no longer offers it; also, the codebase never adopted it in the first place (Upstash Redis direct is already the durable store) | `@upstash/redis` (already installed, already the backing store for the existing rate limiter) |
| A NEW/second Redis instance or Upstash database for the breaker | Unnecessary infra sprawl — the existing Upstash Redis instance backing `ratelimit.ts` has ample headroom for a handful of breaker keys | Reuse the SAME `Redis.fromEnv()` instance already constructed in `ratelimit.ts` (export it, or construct a second lightweight client pointed at the same env vars — either way, same physical database) |
| Dynamic-SQL "generic reaper" Postgres function | Table-name parametrization via `EXECUTE format(...)` for 2 tables is unnecessary risk/complexity for zero benefit | Copy the existing per-table `reset_stalled_*` pattern verbatim, adjusted for `strategy_analytics`'s actual columns |
| New rate-limiting engineering on the 7 named "unlimited" routes | They are already rate-limited (see Premise Check above) — building new limiters would be redundant work against a stale problem statement | A verification/audit phase, re-using `checkLimit` if any true gap is found |

## Version Compatibility

| Package A | Compatible With | Notes |
|-----------|------------------|-------|
| `@upstash/ratelimit@2.0.8` | `@upstash/redis@1.38.0` | Already the pinned, live-verified pairing in `package.json` and `ratelimit.ts`; both are current per npm registry (checked 2026-07-25) — no version bump needed for either SEAM breaker reuse or RATE work. |
| `AbortSignal.timeout()` | Node.js ≥22 (repo's `engines.node` floor) | Native since Node 17.3/18.x; no polyfill needed at this Node floor. |
| Next.js `after()` | Next.js 16.2.11 (pinned) | Stable since v15.1.0 per the canonical fork docs (`node_modules/next/dist/docs/.../after.md`) — this is a HEAVILY-MODIFIED fork per `AGENTS.md`, but the `after()` reference doc present in `node_modules` was read directly and confirms current behavior/guarantees for this exact install. |

## Sources

- Direct code read (HIGH confidence, all file:line citations above): `src/lib/analytics-client.ts`, `src/lib/process-key-client.ts`, `src/lib/ratelimit.ts`, `src/lib/api/withAuthLimited.ts`, `src/lib/retry/{index,rate-limit-gate}.ts`, `src/app/api/{verify-strategy,keys/sync,keys/validate-and-encrypt,admin/match/recompute,admin/partner-import,trades/upload,intro}/route.ts`, `src/app/api/strategies/csv-finalize/route.ts`, `analytics-service/main_worker.py`, `analytics-service/routers/cron.py`, `analytics-service/scripts/reset_stuck_computing_rows.py`, `supabase/migrations/20260516122247_portfolio_analytics_stuck_row_reaper.sql`, `supabase/migrations/20260516104201_compute_jobs_audit_2026_05_07_residual.sql`, `supabase/migrations/2026071{9,20}...retention_orphaned_running...sql`, `package.json`.
- npm registry version check (HIGH confidence, checked 2026-07-25): `@upstash/ratelimit` → 2.0.8 (matches installed); `@upstash/redis` → 1.38.0 (matches installed).
- [cockatiel GitHub / npm](https://github.com/connor4312/cockatiel) — MEDIUM confidence (web search, not Context7): current version 4.0.0, in-memory-only resilience library, used to support the "what NOT to use" reasoning.
- [opossum GitHub / npm](https://www.npmjs.com/package/opossum) — MEDIUM confidence (web search): current version 10.0.0, requires Node ≥22, in-memory-only, same reasoning as above.
- `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/after.md` — HIGH confidence (this fork's own canonical doc, read directly): confirms `after()`/`waitUntil` semantics and platform-kill edge case that motivates the JOB reaper design.
- Vercel plugin knowledge-update (system-provided, 2026-02-27 dated): confirms Vercel KV discontinued, Fluid Compute instance-reuse behavior — used to reason about circuit-breaker state sharing.

---
*Stack research for: Production resilience hardening (SEAM/JOB/RATE), v1.16 Production Resilience & Reliability milestone*
*Researched: 2026-07-25*
