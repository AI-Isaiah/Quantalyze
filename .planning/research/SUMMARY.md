# Project Research Summary

**Project:** Quantalyze — milestone **v1.16 Production Resilience & Reliability** (scope groups SEAM / JOB / RATE)
**Domain:** Hardening EXISTING live, money-bearing plumbing (Vercel Next.js 16 Fluid Compute ↔ Railway FastAPI `analytics-service` ↔ Supabase Postgres `compute_jobs` queue). NOT greenfield.
**Researched:** 2026-07-25
**Confidence:** HIGH on what the code does today (all four researchers read live source + migrations + git blame); MEDIUM on sizing, because the milestone premise needed three corrections and two "free win" claims are still unverified.

---

## ⚠️ Read This First — the milestone premise was contradicted by all four researchers

All four research passes independently re-derived the scope from **fresh greps + git blame against current `main`**, not from `PROJECT.md`/`TODOS.md` prose. Three of the milestone's stated premises do not survive that check. **Requirements must be written against the corrected scope below, not against the `PROJECT.md` Current Milestone text**, or the milestone will spend budget re-shipping work that landed between 2026-04-10 and 2026-07-23.

| # | Milestone said | Code says | Consequence for requirements |
|---|----------------|-----------|------------------------------|
| 1 | RATE: seven authed Python-hitting routes are "currently unlimited → arbitrary quota burn" | **All seven already call `checkLimit()`** against the shared Upstash limiter, in the canonical validate-then-limit order. Landed 2026-04-10 → 2026-07-23, i.e. the `TODOS.md` bullet was already stale when it was consolidated. | RATE is **audit + close one narrow gap**, not greenfield. Real gaps: `admin/match/eval` (no limiter, admin-gated GET) and **zero slowapi limit on the Python `routers/match.py`** (`/recompute`, `/eval`). Size RATE as ONE small phase. |
| 2 | SEAM: "`analytics-client.ts` gets a bounded fetch timeout + retry + breaker … cascade-500s `keys/sync`, `verify-strategy`" | **Timeouts already exist in BOTH clients** (`AbortSignal.timeout`, 30s default in `analytics-client.ts` / hardcoded 60s in `process-key-client.ts`) with typed timeout/network/upstream error mapping. Missing = **retry + circuit breaker only**. And there are **TWO chokepoints**, not one: `keys/sync` and `verify-strategy` **do not call `analytics-client.ts` at all** — they call `postProcessKey()` in `process-key-client.ts`. | SEAM must name BOTH files. Hardening only the one the milestone names leaves the entire money-onboarding path (key connect, CSV, resync) unprotected. The timeout leg is a **unify-and-re-derive** task, not a build task. |
| 3 | (implicit) retry safety can be decided per-route/per-path | Retry safety is a property of **`flow_type`, not path**. `process_key.py` documents `teaser` as **deliberately NON-idempotent** (each landing-page visit mints a new verification + `public_token` + lead). `resync`/`onboard`/`csv` ARE idempotent via the `compute_jobs` partial unique index + the explicit `WIZARD_DUPLICATE` return path. | The retry requirement must be written as a **per-`flow_type` / per-exported-function allowlist with a traced idempotency proof**, never "retry the endpoint." |
| 4 | JOB: the new janitor "also removes the recurring shared-test-DB fence flake — two birds" | **UNVERIFIED.** The flake was root-caused (WORKER-04, v1.13) to a *different* table/layer — `compute_jobs.status='running'` rows orphaned on the workerless TEST project — and a fix already **shipped** (`retention_compute_jobs_orphaned_running`, migrations `20260719120000` → `20260720120000`). If the new janitor targets `strategy_analytics.computation_status='computing'`, it touches none of those rows. | Do NOT write "fixes the fence flake" as an acceptance criterion inherited by inference. Either scope the janitor to the same table/predicate, or make the flake claim its own separately-verified criterion (N consecutive green CI runs against the specific fence-collision signature). This flake has already been declared "root-caused" once and then resurfaced. |
| 5 | JOB: "Unified-backbone CSV-finalize breaks if flag on — service-role client has no `auth.uid()` → 42501" | **Likely stale.** `process_key.py` (lines 1119-1156, re-verified at HEAD 2026-08-17) already forwards `X-User-Access-Token` and calls `finalize_csv_strategy` with a user-scoped client, with an inline comment describing exactly this bug and fix. `docs/runbooks/compute-queue.md` says `PROCESS_KEY_UNIFIED_BACKBONE` is **retired** (reads nowhere). | Require a **reproduction attempt against current `main` BEFORE any fix is scoped**. "Could not reproduce" is a valid outcome. The genuinely-open adjacent gap is different: csv-finalize's multi-step sequence (RPC → RPC → `after()` enqueue) is non-transactional. |

**JOB is the real meat of this milestone** — and it has an in-repo twin to clone: `reset_stalled_portfolio_analytics` (migration `20260516122247`) does exactly the right thing for a sibling table. `strategy_analytics` has **no recurring reaper** — only a one-off manual script (`analytics-service/scripts/reset_stuck_computing_rows.py`) that exists *because this already hit production once*.

---

## Executive Summary

v1.16 is a hardening milestone over plumbing that is already live and carrying real investor money (Deribit, MT5, sFOX/Nautilus keys sync through it). The work needs **zero new npm packages and zero new infrastructure**: `@upstash/redis@1.38.0` + `@upstash/ratelimit@2.0.8` are already installed and proven in prod (backing `src/lib/ratelimit.ts`), `AbortSignal.timeout()` is already the seam's deadline mechanism, and `pg_cron` already runs two retention jobs. Every recommended mechanism is either a clone of an existing in-repo pattern or ~40 lines of new code on top of already-installed dependencies. Vercel KV is discontinued and irrelevant; `cockatiel`/`opossum` are both in-memory-only and would still require a hand-written Redis adapter to be correct here — so they add an abstraction over logic you must write anyway.

After the premise corrections, the milestone's true shape is: **SEAM = add retry + a shared-store circuit breaker to two chokepoints and unify their divergent timeout budgets; JOB = build the missing `strategy_analytics` reaper plus a "data but no job row" reconciliation sweep, and settle the WR-02 DELETE-vs-reset call; RATE = audit, then close one Next.js gap and one Python gap.** Roughly: JOB ≈ half the milestone, SEAM ≈ 40%, RATE ≈ 10%.

The risks are concentrated and every one of them has an in-repo precedent that already burned this project. A naive retry duplicates teaser leads (idempotency is per-`flow_type`). An in-memory circuit breaker looks correct in unit tests and does nothing across concurrent Fluid Compute instances — the fix is the pattern this codebase already uses twice (Upstash for rate limiting, Postgres `api_keys.last_429_at` for the exchange-level breaker). A reaper threshold set from intuition reaps a live job — the WORKER-04 2h→4h correction proved the basis must be `batch_size × max_per_kind_timeout` (~2.5h legitimate batch tail), not the per-kind watchdog number. A reaper keyed on `updated_at`/`computed_at` repeats the 106-janitor revert verbatim — it needs a dedicated writer-stamped `computing_started_at` column. And a reaper that runs heavy work on the worker's asyncio loop re-creates WEDGE-01, the very crash class it exists to clean up after — which is the decisive argument for putting it in **pg_cron** (structurally immune, and independent of the worker liveness it's backstopping), not in the worker loop and not in a Vercel cron (plan cron-slot ceiling is a documented past cause of production going dark).

---

## Key Findings

### Recommended Stack

Nothing to install. The milestone is a code-and-SQL milestone on top of already-pinned, already-live dependencies.

**Core technologies (all already present):**
- **`AbortSignal.timeout()`** (Web platform, Node ≥22) — per-request seam deadline. Already in both clients; the work is **unifying two divergent budgets (30s vs 60s) into one documented, per-call-site table**, and re-deriving each against the calling route's `maxDuration` — not adding the mechanism.
- **`@upstash/redis@1.38.0` + `@upstash/ratelimit@2.0.8`** — the ONLY durable cross-Fluid-Compute-instance store already wired here. Backs the existing rate limiter and must back the **new circuit breaker** (same physical database; do not provision a second). `Ratelimit.slidingWindow(N, window)` is the correct primitive for the breaker's failure counter; a plain `SET key EX cooldown` is the open-state lock, and **TTL expiry IS the half-open transition** (no extra state machine).
- **Postgres `plpgsql` `SECURITY DEFINER` + `pg_cron`** — the reaper substrate. Clone `reset_stalled_portfolio_analytics` (`20260516122247`); extend `retention_compute_jobs_orphaned_running` (`20260720120000`) with a NEW migration rather than editing the shipped one. Copy the per-table pattern; do NOT introduce a dynamic-SQL "generic reaper" for two tables.
- **Hand-rolled `withRetry()` (~15 lines)** — exponential backoff + full jitter, 2–3 attempts max. Matches the codebase's own convention (`src/lib/retry/`) of hand-rolling these primitives. No `p-retry` / `async-retry` / `cockatiel` / `opossum`.

**Breaker fallback policy (deliberate divergence from the rate limiter):** the rate limiter fails **closed** in prod on Redis error; the breaker must fail **OPEN** (attempt the real call) on Redis error — a broken breaker must never itself become the outage.

### Corrected Per-Group Scope

#### SEAM — Vercel→Railway resilience

| Item | Status | Notes |
|------|--------|-------|
| Per-request fetch timeout | ✅ **ALREADY SHIPPED** (both clients) | `analytics-client.ts:90` (30s default, 15s override for Bridge/simulator), `process-key-client.ts:132` (hardcoded 60s). |
| Typed timeout / network / upstream error taxonomy | ✅ **ALREADY SHIPPED** | `AnalyticsTimeoutError`/`AnalyticsUpstreamError`; `{ok:false, code:"UPSTREAM_TIMEOUT"\|"UPSTREAM_NETWORK_ERROR", human_message, recoverable}` at 504/502. |
| Timeout budgets unified + documented + re-derived vs `maxDuration` | ❌ **VERIFIED GAP** | Two independent budgets, no documented reason. Must become one exported table with per-call-site budgets (sync-flow vs enqueue-only vs known-slow), each verified `timeout × (1 + retries) < route maxDuration`. |
| Retry-with-backoff | ❌ **VERIFIED GAP** | Zero retry logic anywhere in either client. Gate on a written per-`flow_type` / per-function idempotency allowlist. |
| Circuit breaker | ❌ **VERIFIED GAP** | Zero breaker. Must be Upstash-backed and **shared across both chokepoints** (one physical Railway deployment → recommend ONE `breaker:railway` key). |
| `503 CIRCUIT_OPEN` clean-error envelope | ❌ **VERIFIED GAP** (small) | Extend the existing `process-key-client.ts` envelope shape; retrofit `analytics-client.ts` callers that currently let raw errors escape to route handlers (that escape IS the cascade-500 risk the milestone names). |
| Coverage of BOTH chokepoints | ❌ **VERIFIED GAP** | `analyticsRequest()` (`analytics-client.ts:65`) AND `postProcessKey()` (`process-key-client.ts:83`). Recommendation: extract ONE shared `src/lib/resilient-fetch.ts` core both call through — the two files already independently reinvented timeout-error mapping once; two breakers against one backend can disagree. Also decide explicitly in/out for `debug-key-flow` (has its own `AbortSignal.any` + heartbeat design) and `cron/warm-analytics` (different threat model). |

**Retry-safety classification — the load-bearing artifact for SEAM requirements:**

| Class | Examples | Retry? | Basis |
|-------|----------|--------|-------|
| Pure reads | `evalMatch` (GET), sync-progress poll, portfolio-analytics GET | **YES** | No side effect. |
| `/process-key` `flow_type: resync \| onboard \| csv` | `keys/sync`, wizard finalize | **YES, conditionally** | Idempotent by construction: `compute_jobs` partial unique index + `WIZARD_DUPLICATE` path. Confirm per flow before enabling. |
| `/process-key` `flow_type: teaser` | `verify-strategy` (public) | **NO — never** | Documented non-idempotent by design; a retry mints a duplicate verification + `public_token` + lead. |
| Credential writes | `validateKey`, `encryptKey` | **NO** | Encrypt+store; a lost-response retry can double-write/race. |
| Compute-named POSTs | `recomputeMatch`, `computePortfolioAnalytics`, optimizer, simulator, bridge | **UNAUDITED — do not assume** | Names imply purity; nobody has traced side effects (audit-log rows w/ fresh UUIDs? downstream enqueues? notifications?). The `_get_recompute_lock` per-allocator lock may be **process-local, not distributed**. Requires an explicit traced audit table before any of these get retry. |

#### JOB — Job-state integrity (the real meat)

| Item | Status | Notes |
|------|--------|-------|
| In-worker per-kind watchdog (`reset_stalled_compute_jobs`, 60s) | ✅ **ALREADY SHIPPED, sound** | No JOB change needed. Handles "job hung on a LIVE worker." |
| External orphaned-`running` purge (pg_cron, daily 04:15 UTC, 4h window) | ✅ **SHIPPED but open on semantics** | Correct *layer* (independent of worker liveness). Two open items: ~24h detection latency, and it **DELETEs** — leaving no terminal row for a poller to break out on. This is the WR-02 founder call. |
| `strategy_analytics` stuck-`computing` reaper | ❌ **VERIFIED GAP — highest-value single item** | `portfolio_analytics` got one; `strategy_analytics` (written by `keys/sync`, `csv-finalize`, `finalize-wizard`, unified `/process-key`) did not. A one-off manual script exists **because this already hit prod**. |
| Dropped-enqueue / "data but no job row" sweep | ❌ **VERIFIED GAP, different failure mode** | `persist_csv_daily_returns` commits **synchronously before** `after()` is scheduled. The existing `writeFailedStrategyAnalyticsPlaceholder` guard lives INSIDE the `after()` closure — it catches "the enqueue RPC errored," it cannot catch "`after()` never ran at all" (platform kill / instance recycle). Only an EXTERNAL periodic sweep (find by *absence*, not by stale timestamp) closes this. |
| csv-finalize transactionality | ⚠️ **GAP, but re-target it** | The 42501 framing is stale (see correction #5). The real gap: `finalize_csv_strategy` → `persist_csv_daily_returns` → `after()`-enqueue are three steps with no wrapping transaction. Options: (a) fold the two RPCs into one SECURITY DEFINER transaction (cleanest; complicated by the CONTRIB-02 owner-only `p_terminal_status` variant), or (b) explicit compensating cleanup + Sentry, reusing the proven placeholder-write precedent. |
| Wizard sees a terminal state | ✅ **client side ALREADY SHIPPED** | `SyncProgress.tsx`: `POLL_MAX_ATTEMPTS=40` (~120s) + `MISSING_ROW_GRACE_POLLS=10`. The remaining gap is purely server-side — so a **page refresh** doesn't restart into the same forever-`computing` DB row. |

**Non-negotiable JOB design constraints (each has an in-repo precedent that already burned this project):**
1. **Threshold re-derived from batch-tail math, not reused.** `main_worker.py` claims batches of 5 and dispatches sequentially; with `process_key_long` at 30min, job #5 can legitimately be running ~2.5h after `claimed_at`. That's why 2h→4h. **Do not blindly reuse 4h** for a different table — re-derive for `strategy_analytics`'s own claim/dispatch pattern, and add the CI-enforced invariant (mirroring `test_every_kind_has_watchdog_headroom`) that the threshold exceeds every relevant handler's real worst case.
2. **Dedicated writer-stamped `computing_started_at`.** `updated_at`/`computed_at` is WRONG — that is precisely why the 106 janitor was reverted. Stamp it in the SAME statement/transaction that sets `computation_status='computing'`; never a separate best-effort write.
3. **pg_cron, not the worker loop, not Vercel cron.** Worker loop = same failure domain as the crash being backstopped, AND re-exposes WEDGE-01. Vercel cron = plan cron-slot ceiling (a documented past cause of production going dark) plus a third liveness dependency. pg_cron is structurally immune to WEDGE-01 by construction.
4. **WEDGE-01 discipline if any part does run in Python.** Single bounded SQL statement, or `asyncio.to_thread` + `asyncio.wait_for`, plus heartbeat refresh — with a regression test proving a large synthetic backlog does not stall `healthz` past `STALE_THRESHOLD`.
5. **Reset to a terminal `failed` with a recoverable message — never silent DELETE** on the prod path. A vanished row loses the audit trail AND leaves pollers spinning. Actual deletion belongs to the existing 30/90-day `retention_compute_jobs_failed`/`done` crons.

#### RATE — Rate limiting

| Item | Status | Notes |
|------|--------|-------|
| `verify-strategy`, `keys/sync`, `keys/validate-and-encrypt`, `admin/match/recompute`, `admin/partner-import`, `trades/upload`, `intro` | ✅ **ALL SEVEN ALREADY SHIPPED** | `publicIpLimiter` 10/min/IP; `keysSyncUserLimiter` 30/min/user **+** `userActionLimiter` 5/min/user+strategy; `userActionLimiter` 5/min; `adminActionLimiter` 20/min (×2, partner-import also has 500-row + 4MB caps); `userActionLimiter` 5/min + 5,000-row cap; `userActionLimiter` 5/min. Note: there is no separate `keys/validate` or `keys/encrypt` route — the milestone's `{validate,encrypt}` maps to one combined route. |
| Limiter infrastructure (`src/lib/ratelimit.ts`) | ✅ **MATURE** | 15 named sliding-window limiters, documented fail-closed-in-prod/fail-open-elsewhere matrix (P709), canonical `429`/`503` + `Retry-After` builders. Reuse; never fork a "v2." |
| `admin/match/eval` | ❌ **VERIFIED GAP** (Next.js layer) | Calls `evalMatch` → `analytics-client.ts`, no `checkLimit` anywhere. Admin-gated GET → lower risk. Key on `user.id`, size to real eval-tooling cadence. |
| `analytics-service/routers/match.py` (`/recompute`, `/eval`) | ❌ **VERIFIED GAP** (Python layer) | Zero `@limiter.limit`. Only protection is the Vercel-side `adminActionLimiter` → no defense-in-depth against a leaked `X-Service-Key` reaching Railway directly. Mirror `portfolio.py`'s `10/hour` pattern. |
| Wiring convention decision | ⚠️ **OPEN, decide once** | Today: per-route manual `checkLimit(...)` (no CI gate stops a new route from skipping it — same weakness flagged for the CSRF retrofit). Options: keep hand-wiring (matches convention) or add a `withRateLimit(handler, limiter)` HOF composing alongside the existing `withAuth`/`withRole`/`withAuthLimited`. Recommendation: the HOF, because it composes the way the codebase already composes — **not** a global middleware (different routes need different key identities). |
| `cron/warm-analytics` (direct fetch, no limiter) | ⚠️ **judgment call** | Cron route, different threat model. `debug-key-flow` already has its own dedicated limiter — fine. |

### Architecture Approach

Four attachment points, all additive over existing structure. Nothing is rearchitected.

1. **`src/lib/resilient-fetch.ts` (NEW)** — small composable core: `{ timeout budget, bounded retry+jitter, Upstash-backed breaker }`. One breaker identity per physical backend.
2. **`analyticsRequest()` (MODIFIED)** and **`postProcessKey()` (MODIFIED)** — both call through the shared core. Each is already a single chokepoint for its own callers, so this is additive to two functions, not N routes.
3. **New SQL migrations (NEW/EXTEND)** — `reset_stalled_strategy_analytics` + `computing_started_at` DDL + writer-stamp (new, cloning `20260516122247`); orphaned-`running` cadence + DELETE→terminal-UPDATE (a NEW migration layered on `20260720120000`, never editing the shipped one); "data but no job row" sweep (new, finds by absence).
4. **`withRateLimit` HOF (NEW, optional)** in `src/lib/api/` + one `@limiter.limit` decorator in `routers/match.py` (MODIFIED).

Unchanged and explicitly out of scope: the in-worker watchdog (sound), the `compute_jobs` queue/claim RPCs (solid foundation), the `main_worker.py` heartbeat pattern (reference precedent only).

### Critical Pitfalls

1. **Blind retry duplicates teaser leads.** Idempotency is a property of `flow_type`, not of the endpoint or the HTTP verb. Gate retry on `flow_type`; `teaser` is never retried. Add a regression test asserting two identical teaser calls produce TWO `strategy_verifications` rows — documenting the contract so a future refactor can't quietly start retrying it.
2. **Hardening only one of the two seam clients.** The milestone names `analytics-client.ts`; the money-onboarding path (`keys/sync`, `verify-strategy`, CSV) runs entirely through `process-key-client.ts`. Verification must kill a Railway mock for BOTH call-site sets.
3. **In-memory circuit breaker.** Passes unit tests, does nothing under concurrent Fluid Compute instances, silently. Must read/write a shared store — the pattern this codebase already uses twice. Test by hammering from two independent `vi.resetModules()` contexts. If a per-instance breaker is ever deliberately chosen, it must be documented as best-effort, not implied as fleet-wide.
4. **Reaper threshold from intuition + reaper keyed on `updated_at`.** Two separate already-paid-for lessons (WORKER-04 2h→4h; the 106-janitor revert). Batch-tail math + a dedicated `computing_started_at`, both with tests: a row with fresh `updated_at` but old `computing_started_at` MUST reap; the inverse MUST NOT.
5. **The janitor reintroduces WEDGE-01.** "It's just a cleanup cron" is exactly the reasoning that let the `stitch_composite` pandas assembly freeze `healthz` and get the container killed mid-job. pg_cron placement makes this structurally impossible; if any Python part remains, `to_thread` + `wait_for` + heartbeat + a large-backlog regression test.
6. **Retry without a breaker amplifies the outage.** N instances × M retries against a dying Railway. The breaker must trip BEFORE retries pile on, and retries must respect the open state — no "just this once" bypass.

---

## Implications for Roadmap

Phase numbering continues from **140** (per the founder scope decision). Six phases; 143+144 are mergeable if the requirements step settles the open decisions cleanly.

### Phase 140: SEAM — shared resilience core + circuit breaker (no retry yet)
**Rationale:** Founder's own top priority, and structurally the highest-leverage single change. Deliberately ships **breaker before retry** — fail-fast alone is a strict improvement with **zero double-execution risk**, so it can land without waiting on the idempotency audit. Extracting the shared core first also prevents the two-clients-drift the codebase has already demonstrated once.
**Delivers:** `src/lib/resilient-fetch.ts` with the Upstash-backed breaker (`slidingWindow` failure counter + `SET…EX` open lock + TTL-as-half-open, fail-OPEN on Redis error); both `analyticsRequest()` and `postProcessKey()` routed through it; ONE unified, documented, exported per-call-site timeout budget table with every budget re-derived against its route's `maxDuration`; a `503 CIRCUIT_OPEN` envelope matching the existing `process-key-client.ts` shape, with `analytics-client.ts` callers retrofitted so nothing escapes as a raw 500.
**Avoids:** Pitfalls 2 (one-file coverage), 3 (in-memory breaker), 5 (stale timeout constants), and the two-independently-flapping-breakers trap.
**Verification:** breaker state observed from two independent module contexts; Railway-mock kill exercised at call sites of BOTH clients; `timeout × (1+retries) < maxDuration` asserted per route.

### Phase 141: SEAM — retry-with-backoff, gated on a written idempotency audit
**Rationale:** Must follow 140 (retry needs the unified budget and must respect the breaker) and must not start until the audit exists — this is the phase where the teaser-duplication bug gets built if the audit is skipped.
**Delivers:** The audit table as a **committed artifact** (function → traced Python-side side effects → retry-safe yes/no/needs-key), including the currently-unaudited `recomputeMatch`/`computePortfolioAnalytics`/optimizer/simulator/bridge set and a check on whether `_get_recompute_lock` is distributed or merely process-local; then `withRetry()` (2–3 attempts, exponential + full jitter, base ~200ms) enabled ONLY for the allowlisted entries; explicit `flow_type` branch refusing retry for `teaser`.
**Avoids:** Pitfalls 1 (teaser duplication), 11 (name-inferred idempotency), and the retry-amplification performance trap.
**Verification:** per-`flow_type` fault-injection — teaser retry provably absent/refused; `resync`/`onboard`/`csv` retry proven safe against the real `WIZARD_DUPLICATE` + unique-index contract.

### Phase 142: JOB — `strategy_analytics` stuck-`computing` reaper (+ `computing_started_at` DDL)
**Rationale:** Highest-value JOB item, lowest risk, and it has a **proven in-repo twin to clone** (`reset_stalled_portfolio_analytics`, `20260516122247`). The one-off script is direct evidence this failure already occurred in production.
**Delivers:** Migration adding a dedicated writer-stamped `computing_started_at` (stamped in the same statement as the `computing` transition) + a partial index on `(strategy_id) WHERE computation_status='computing'`; `reset_stalled_strategy_analytics(p_stale_threshold INTERVAL)` using the stronger **time-threshold AND NOT-EXISTS-active-`compute_jobs`-row** predicate from the one-off script (more precise than time alone, which would need a very conservative threshold given composite stitches / MT5 backfills); scheduled via **pg_cron**; UPDATE to terminal `failed` with a user-recoverable message, never DELETE. The one-off script's logic is thereby superseded.
**Avoids:** Pitfalls 4 (threshold), 6 (WEDGE-01), 7 (`updated_at` clock), and Anti-Pattern 1 (worker loop / Vercel cron).
**Verification:** CI invariant that the threshold exceeds every relevant handler's batch-inclusive worst case; the fresh-`updated_at`/old-`computing_started_at` reap pair; a large-synthetic-backlog `healthz` regression test.

### Phase 143: JOB — dropped-enqueue ("data but no job row") reconciliation sweep
**Rationale:** A genuinely **different** failure mode from 142 — detected by *absence* of a row, not by a stale timestamp — and the only thing that can catch "`after()` never ran at all," which is architecturally undetectable from inside the route handler. Follows 142 because both sweep the same `strategies` / `strategy_analytics` / `compute_jobs` triangle and should be scheduled as one non-racing mechanism.
**Delivers:** A pg_cron sweep finding strategies with persisted daily-returns data but no `compute_jobs` row of any status and no terminal `strategy_analytics` row past a grace window → idempotent re-enqueue (safe: enqueue is a fresh row protected by the partial unique index) + Sentry alert.
**Avoids:** The `after()`-platform-kill hole the existing W-2 placeholder guard structurally cannot cover.
**Research flag:** needs a short design pass on "what counts as orphaned" per strategy source (csv vs wizard vs resync) before it's a single migration.

### Phase 144: JOB — WR-02 resolution + orphaned-`running` cadence
**Rationale:** The founder's explicitly-open DELETE-vs-reset call, which the milestone says resolves here. Architecturally it may be the SAME mechanism as 142/143 (see Open Decision 1) — if so, merge into 142; if not, it's a small standalone SQL phase.
**Delivers:** A new migration layered on `20260720120000` (never editing the shipped one) changing the cron body from bare `DELETE` to `UPDATE … SET status='failed'` (terminal, so pollers break out; actual deletion stays with the existing 30/90-day retention crons), plus a tightened cadence (e.g. hourly) at the **unchanged 4h `claimed_at` threshold** — the threshold, not the frequency, is what protects against eating a live batch-tail job. Reconciles the TEST-DELETE / PROD-reset split in one migration.
**Avoids:** Reopening the false-positive hazard the 2h→4h widening closed; the "no terminal row for the wizard to key off" gap.
**Verification:** the fence-flake claim, if asserted at all, requires N consecutive green CI runs checking the SPECIFIC fence-collision signature — never general green, never inference.

### Phase 145: JOB — csv-finalize atomicity (reproduce-first)
**Rationale:** Independent failure window (mid-request, before any worker involvement) so it can move in the order; sequenced last in JOB because its scope is the least settled — the TODOS framing is stale and the real target must be established by reproduction, not by backlog text.
**Delivers:** First, a reproduction attempt against current `main` for the 42501 claim (documented pass/fail — "could not reproduce" is a valid, budget-saving outcome). Then the real work: either (a) fold `persist_csv_daily_returns` into the same SECURITY DEFINER transaction as `finalize_csv_strategy` — preferred if the CONTRIB-02 owner-only `p_terminal_status` variant survives it — or (b) explicit compensating cleanup + Sentry on any post-strategy-creation failure, reusing the proven placeholder-write precedent.
**Avoids:** Pitfall 10 (re-fixing an already-fixed bug and mis-scoping the real one).

### Phase 146: RATE — audit + close the two verified gaps
**Rationale:** Sequenced last because it's the most mechanical and lowest-risk, and because its scope depends on a fresh grep at kickoff rather than on anything the earlier phases build. **Size it as ONE small phase** — the premise correction shrank it by roughly 85%. (It could equally open the milestone as a cheap warm-up; the only hard requirement is that it never gets sized as greenfield.)
**Delivers:** A kickoff re-grep (`grep -rl "analytics-client\|process-key-client" src/app/api --include=route.ts`, then check each for `checkLimit`) producing the authoritative gap list; `checkLimit` on `admin/match/eval` keyed on `user.id` and sized to real eval-tooling cadence; a `@limiter.limit(...)` on `routers/match.py`'s `/recompute` and `/eval` mirroring `portfolio.py`'s `10/hour`; a judgment call recorded on `cron/warm-analytics`; a one-time decision on `withRateLimit` HOF vs continued hand-wiring; and an audit of the seven existing limiter VALUES against real Python-side cost (the milestone's real remaining question is whether each route has the RIGHT limiter, not whether it has one).
**Avoids:** Pitfall 9 (copying the stale TODOS route list; duplicate no-op limiter diffs).

### Phase Ordering Rationale

- **Breaker before retry (140 → 141)** is the single most important sequencing call: fail-fast alone carries zero double-execution risk and can ship while the idempotency audit is still being written, whereas retry without a breaker actively amplifies an outage.
- **SEAM before JOB** because JOB's sweeps benefit from SEAM's error taxonomy — a clean timeout-vs-upstream-vs-network split is what lets a sweep decide "re-enqueue" vs "terminal fail" for a stranded strategy.
- **142 before 143** because both sweep the same three-table triangle; building them in sequence keeps them one non-racing mechanism instead of two competing crons.
- **145 is order-independent** within JOB (different failure window) — it's last only because its scope needs a reproduction result first.
- **RATE last** because it's mechanical and its gap list must come from a fresh grep, not from anything upstream in the milestone.
- Every JOB phase lands in **pg_cron**, so the WEDGE-01 constraint is satisfied by construction throughout.

### Research Flags

**Needs a research/design pass during planning:**
- **Phase 141** — not external research; an internal **side-effect trace** of each `analytics-client.ts` wrapper's Python handler (audit-log writes with per-call UUIDs, downstream enqueues, notifications, rate-limited external API calls) plus resolving whether `_get_recompute_lock` is distributed or process-local. The retry allowlist cannot be written without this.
- **Phase 143** — "what counts as orphaned" per strategy source (csv vs wizard vs resync); which table's presence is the authoritative "has data" signal.
- **Phase 145** — reproduction-first; and if (a) is chosen, whether the CONTRIB-02 `p_terminal_status` owner-only variant survives merging the two RPCs.

**Standard/well-precedented patterns — skip research-phase:**
- **Phase 140** — the breaker design is fully specified above on already-installed primitives; both chokepoints are already identified at file:line.
- **Phase 142** — direct clone of `20260516122247` with a known-better predicate; the one-off script is a working reference implementation.
- **Phase 144** — pure SQL, extending a migration whose own header documents the batch-tail rationale.
- **Phase 146** — 100% existing convention (`checkLimit` / `rateLimitDenyJson` / `portfolio.py`'s decorator).

---

## Open Decisions for the Requirements Step

These must be settled when requirements are written; each changes what gets built.

1. **⭐ Which table does the "worker-crash janitor" target — `compute_jobs.status='running'` or `strategy_analytics.computation_status='computing'`?** This is the load-bearing unresolved question. If `compute_jobs`, the right move is to **EXTEND the existing WORKER-04 purge migration** (`20260720120000`) and the "two birds / fence flake" claim becomes architecturally plausible. If `strategy_analytics`, it's a **new sweep** on a different table and the fence-flake claim is **not** inherited and must be independently verified or dropped. Answering this also determines whether phases 142 and 144 merge. (Most likely answer given the evidence: **both**, as two distinct mechanisms — the one-off script and the missing sibling reaper point at `strategy_analytics`, while WR-02 is squarely `compute_jobs`. Say so explicitly rather than letting one requirement imply the other.)
2. **Is the fence-flake "two birds" claim an acceptance criterion at all?** Recommend: **NO** unless decision 1 lands on `compute_jobs`. If kept, its criterion must be N consecutive green CI runs against the specific fence-collision signature, not general green.
3. **Is the 42501 / `PROCESS_KEY_UNIFIED_BACKBONE` bullet in scope?** Recommend: replaced by "reproduce first; if not reproducible, redirect phase budget to the real non-transactional-finalize gap."
4. **One shared breaker key (`breaker:railway`) or per-chokepoint keys?** Recommend **one** — both clients hit the same physical Railway deployment, so the failure modes are identical and two breakers can disagree. Keep the key identity-scoped so a future second backend can't silently share state.
5. **`withRateLimit` HOF vs continued per-route hand-wiring?** Recommend the HOF (composes like `withAuth`/`withRole`; the current pattern has no CI gate against a new route skipping the limiter). Not a global middleware — routes need different key identities (per-user / per-IP / per-user+strategy).
6. **csv-finalize: fold the RPCs (a) or compensating cleanup (b)?** Depends on the CONTRIB-02 variant; decide after the Phase 145 reproduction pass.
7. **`cron/warm-analytics`** — in or out of RATE's scope (cron route, different threat model)?
8. **Defense-in-depth beyond `match.py`** — is a Python-side limiter on `/process-key`'s other endpoints in scope? This was NOT in the milestone brief; raise as a scope question rather than assuming it in.

**Explicitly deferred (do not build in v1.16):** CRON group (match-engine health check + founder-LP/email idempotency — founder-deferred 2026-07-25); circuit-breaker ops dashboard; `Idempotency-Key` header support for normally-unsafe POSTs (would let teaser become retry-safe, but needs a Python-side dedup-key store + TTL — a new persistence contract, not a client-side change); adaptive/load-aware rate limiting (couples RATE to a breaker signal that doesn't exist yet); job-queue depth/age metrics.

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | **HIGH** | Every recommendation grounded in a direct read of installed code; versions verified against the npm registry 2026-07-25 and matched `package.json`. Zero new dependencies means zero version risk. Only MEDIUM item: the `cockatiel`/`opossum` "in-memory only" rejection came from web search, not Context7 — but it only supports a *don't-use* decision, so a wrong call there costs nothing. |
| Features | **MEDIUM-HIGH** | SEAM/JOB gaps verified in source. RATE required overturning the milestone's own premise via grep + `git log -S"checkLimit"` — high confidence in the correction itself, but it means the group's true size is much smaller than planned and the roadmap must reflect that. |
| Architecture | **HIGH** | All chokepoints, migrations, cron placements and enqueue sites read directly at file:line. The two-chokepoints finding and the pg_cron-vs-worker-loop argument are both fully evidenced. |
| Pitfalls | **HIGH** | Every pitfall is either current source or one of this project's OWN prior incidents (WEDGE-01, the 106-janitor revert, the WORKER-04 2h→4h correction, the fence flake resurfacing after being declared root-caused). Not generic advice. |

**Overall confidence:** **HIGH** on the corrected scope; **MEDIUM** on effort sizing, because two milestone claims remain unverified (items 4 and 5 above) and the retry allowlist depends on an audit nobody has run yet.

### Gaps to Address

- **Which table the janitor targets (Open Decision 1).** Blocks the phase 142/144 merge question and the fence-flake claim. Settle at requirements time from the migration history, not from the scope description.
- **Fence-flake causality is UNVERIFIED.** Handle by not making it an acceptance criterion, or by giving it its own observation-window criterion.
- **42501 reproducibility is UNVERIFIED.** Handle with a reproduce-first gate in Phase 145; document "could not reproduce" as a valid outcome.
- **Retry-safety of `recomputeMatch` / `computePortfolioAnalytics` / optimizer / simulator / bridge is UNAUDITED.** Handle by making the traced audit table a Phase 141 deliverable that gates the allowlist — default everything to no-retry until proven.
- **`_get_recompute_lock` may be process-local, not distributed.** Verify before treating it as concurrency protection for a retried call.
- **`trades/upload` Python-side limiter not verified** in this pass; **`cron/warm-analytics`** threat model undecided. Both fold into the Phase 146 kickoff grep.
- **The exact `strategy_analytics` reaper threshold** must be derived at implementation time from that table's real claim/dispatch tail — the 4h `compute_jobs` number does **not** transfer.
- **Existing limiter VALUES were not audited against real Python-side cost** — only their existence was confirmed. That audit is the substantive half of Phase 146.

---

## Sources

### Primary (HIGH confidence — direct reads of this repo at 2026-07-25)
- `src/lib/analytics-client.ts`, `src/lib/process-key-client.ts` (read in full — timeouts, error taxonomy, zero retry/breaker)
- `src/lib/ratelimit.ts`, `src/lib/api/withAuthLimited.ts`, `src/lib/retry/{index,wait,rate-limit-gate}.ts`
- `src/app/api/{verify-strategy,keys/sync,keys/validate-and-encrypt,admin/match/recompute,admin/match/eval,admin/partner-import,trades/upload,intro}/route.ts`; `src/app/api/strategies/{csv-finalize,finalize-wizard,csv-validate}/route.ts`; `src/components/strategy/SyncProgress.tsx`
- `analytics-service/main_worker.py`, `services/job_worker.py` (`_check_circuit_breaker`/`EXCHANGE_COOLDOWNS` — the existing DB-backed breaker precedent), `routers/{process_key,match,portfolio,cron,csv,exchange}.py`, `scripts/reset_stuck_computing_rows.py`
- `supabase/migrations/`: `20260411144407` (queue), `20260412094449` (+`20260516104201` residual — `reset_stalled_compute_jobs`), `20260516122247` (`reset_stalled_portfolio_analytics` — the clone target), `20260719120000` → `20260720120000` (WORKER-04 orphaned-`running`, 2h→4h batch-tail rationale in the header)
- `docs/runbooks/compute-queue.md` (confirms `PROCESS_KEY_UNIFIED_BACKBONE` / `USE_COMPUTE_JOBS_QUEUE` retired/permanent-on)
- `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/after.md` (this fork's canonical doc — `after()`/`waitUntil` semantics and the platform-kill edge case)
- `git log -S"checkLimit"` on the seven named RATE routes (2026-04-10 → 2026-07-23, all predating the 2026-07-25 milestone open)
- npm registry check 2026-07-25: `@upstash/ratelimit` 2.0.8, `@upstash/redis` 1.38.0 — both match installed
- `.planning/PROJECT.md`, `TODOS.md` (used as hypotheses, cross-checked against source — both found stale on RATE), `.planning/codebase/{ARCHITECTURE,INTEGRATIONS,CONCERNS}.md`, `.planning/RETROSPECTIVE.md`

### Secondary (MEDIUM confidence)
- [Vercel Functions limits / maxDuration docs](https://vercel.com/docs/functions/limitations) — official; informs the "client timeout must sit below route `maxDuration`" rule
- [Railway specs & limits](https://docs.railway.com/networking/public-networking/specs-and-limits) — ~5 min public-networking request ceiling, upper-bounds any seam budget over the public URL
- [Circuit Breaker pattern — Azure Architecture Center](https://learn.microsoft.com/en-us/azure/architecture/patterns/circuit-breaker) — standard closed/open/half-open semantics
- Vercel plugin knowledge-update (2026-02-27) — Vercel KV discontinued; Fluid Compute instance-reuse behavior
- Project memory ledger: `project_worker04_purge_delete_vs_reset_prod_outage`, `project_stitch_composite_wedge01_fix_and_local_prod_worker`, `project_106_janitor_deferred_needs_transition_timestamp`

### Tertiary (LOW confidence — supports "don't use" calls only)
- cockatiel 4.0.0 / opossum 10.0.0 (web search) — both in-memory-only; used only to justify NOT adopting them

---
*Research completed: 2026-07-25*
*Ready for roadmap: yes — but requirements MUST be written against the corrected scope above, not the `PROJECT.md` Current Milestone text.*
