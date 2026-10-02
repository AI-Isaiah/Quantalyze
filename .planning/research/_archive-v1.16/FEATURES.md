# Feature Research: Production Resilience & Reliability (v1.16)

**Domain:** Service-to-service resilience (Vercel Next.js ↔ Railway FastAPI seam) + async job-state
reconciliation (Supabase-backed `compute_jobs` queue + Railway worker) + API rate limiting, for a
live money-bearing analytics platform (real Deribit/MT5/sFOX accounts already syncing).
**Researched:** 2026-07-25
**Confidence:** MEDIUM-HIGH overall — SEAM and JOB findings are grounded directly in this
codebase's existing (partial) implementations and a proven sibling pattern; RATE findings
required a **correction to the milestone's own stated premise** (see Critical Finding below),
verified via grep + git blame, not training data.

## Critical Finding — the RATE premise is stale, re-scope before planning

`PROJECT.md` / `TODOS.md` describe `verify-strategy`, `keys/{sync,validate,encrypt}`,
`admin/match/recompute`, `admin/partner-import`, `trades/upload`, and `intro` as "currently
unlimited." **Grep + `git log -S"checkLimit"` show all seven already call `checkLimit()` with a
named Upstash limiter**, added between 2026-04-10 and 2026-07-23 — i.e. *before* this milestone
was opened today (2026-07-25). Cross-checking every route that imports `analytics-client.ts` /
`process-key-client.ts` (the actual "hits the Python service" test) turns up only **one** genuinely
unlimited Python-hitting route: `admin/match/eval` (admin-gated GET, lower risk). The rate-limiting
infrastructure itself (`src/lib/ratelimit.ts`) is mature: sliding-window Upstash limiter, a documented
fail-closed-in-prod/fail-open-outside-prod matrix (P709), a canonical `429 + Retry-After` /
`503 + Retry-After` response builder, and consistent per-user keying. **This means RATE is mostly
a verification + gap-closing task, not a build-from-scratch task** — flag this to the requirements
step so RATE phases aren't sized as if starting from zero. (SEAM and JOB, by contrast, are real
gaps — see below.)

## Feature Landscape

### Table Stakes (Expected of Production Resilience Hardening)

These are the patterns any team hardens a live money-bearing seam with; missing them is what
"the plumbing has no failure handling" means concretely.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **[SEAM] Unified, bounded fetch timeout budget** | A hung Railway request must not hold a Vercel lambda open until the platform kills it. | LOW | Partially done: `analytics-client.ts` has `AbortSignal.timeout()` (30s default, per-call overrides to 15s for Bridge/simulator) and `process-key-client.ts` independently hardcodes 60s. Two divergent, undocumented budgets for the same seam is the gap — unify into one exported budget table, and verify every Vercel route's `maxDuration` (30s/60s/300s observed) is comfortably ABOVE its own client timeout so the clean timeout error fires before the platform's raw kill. |
| **[SEAM] Retry-with-backoff, idempotent reads ONLY** | Railway cold-starts (15–30s, already documented in `SyncProgress.tsx`'s `MISSING_ROW_GRACE_POLLS`) and transient network blips cause spurious read failures that a client should absorb, not surface to the user. | LOW-MED | Currently **zero** retry logic anywhere in `analytics-client.ts` / `process-key-client.ts`. Candidates: `evalMatch` (GET), the `/api/strategies/[id]/sync-progress` poll, `/api/portfolio-analytics` reads. 2-3 attempts, capped exponential backoff + jitter (thundering-herd control — this codebase already has a `RateLimitGate` primitive in `src/lib/retry/` from a DIFFERENT client-side burst-control use case that is a useful reference for the shape, not directly reusable). |
| **[SEAM] Circuit breaker (closed/open/half-open) around the seam** | Standard fault-isolation pattern: `closed` = normal traffic; `open` = fail fast with a clean error instead of every concurrent lambda hanging to its own timeout (each burning a Vercel concurrency slot + a DB connection) during a sustained Railway outage; `half-open` = a small number of probe requests decide whether to close or re-open. | MED | None exists today — every request independently times out. Needs an in-memory (per-lambda-instance, since Vercel functions don't share process state) or Redis-backed (shared, more correct but adds a dependency on `UPSTASH` already in use for rate limiting) failure counter. Given Vercel's stateless-per-invocation model, a **shared** breaker state (Redis) is the only way the breaker actually protects the fleet — a per-instance breaker only protects that one cold lambda, which usually dies before it accumulates enough failures to trip. This is the single highest-complexity SEAM item. |
| **[SEAM] Clean 503 "temporarily unavailable" on breaker-open / exhausted-retries, not cascade-500** | Users should see one honest, actionable message, never a raw stack trace or generic 500. | LOW | Precedent already exists: `process-key-client.ts` returns `{ok:false, code:"UPSTREAM_TIMEOUT"/"UPSTREAM_NETWORK_ERROR", human_message, recoverable:true}` at 504/502. Extend this same envelope shape with a `code:"CIRCUIT_OPEN"` variant at 503, and retrofit `analytics-client.ts` callers (which currently `throw` raw `AnalyticsTimeoutError`/`AnalyticsUpstreamError` up to route handlers — some of those routes may not catch cleanly, which IS the cascade-500 risk described in the milestone goal). |
| **[JOB] Stuck-`computing`-row janitor for `strategy_analytics`** | A worker crash (SIGKILL, Railway redeploy) mid-job leaves `computation_status='computing'` forever; every future page load re-polls into the same wall (client caps at 120s per-session but the DB truth never resolves). | LOW | **Direct proven twin already exists** for a sibling table: `reset_stalled_portfolio_analytics` (migration `20260516122247_portfolio_analytics_stuck_row_reaper.sql`), invoked every `cron_recompute` tick with a 30-minute staleness threshold (`analytics-service/routers/cron.py`). A one-off manual script (`analytics-service/scripts/reset_stuck_computing_rows.py`) already does the ONE-TIME version of this for `strategy_analytics` but is not a recurring job. The work is: generalize the portfolio_analytics reaper pattern to a `strategy_analytics` twin, wire it into a recurring cron tick (not a manual script), and mark reaped rows `'failed'` with a user-facing, retryable message (not silently deleted). |
| **[JOB] Dropped-enqueue detection ("has data, no job row")** | Vercel's `after()` callback is best-effort — if the lambda freezes/is killed before it runs, `finalize_csv_strategy` succeeds (strategy row exists) but `enqueue_compute_job` never fires, and no `compute_jobs` row is ever created. The wizard has nothing to poll toward a terminal state. | MED | Partially mitigated already: the existing "W-2" pattern in `csv-finalize` catches a **synchronous** enqueue failure inside the `after()` callback and writes a `strategy_analytics` placeholder row (`computation_status='failed'`) + `captureToSentry` — but this only fires if `after()` runs at all. It does NOT catch the callback never running. Needs a periodic reconciliation sweep: `strategies` rows with no matching `strategy_analytics` row AND no matching `compute_jobs` row past a grace window → auto-retry-enqueue (idempotent, since enqueue is a fresh row) + Sentry alert, exactly as TODOS.md's "Sentry alert + dashboard for pending/null rows > 2h" describes. |
| **[JOB] Transactional (or compensating) csv-finalize** | Today `finalize_csv_strategy` (strategy + verification row), `persist_csv_daily_returns` (daily series), and the `after()` enqueue are three separate steps with no wrapping transaction — a mid-sequence failure orphans a strategy row with no data and no path to recovery. | MED | Two viable approaches, either acceptable: (a) fold `persist_csv_daily_returns` into the same SECURITY DEFINER RPC transaction as `finalize_csv_strategy` (cleanest, but the RPC boundary + `p_terminal_status` branching for CONTRIB-02 makes this a real refactor); (b) keep the steps separate but add an explicit compensating cleanup + Sentry alert on any post-strategy-creation failure, reusing the placeholder-write precedent already proven in the enqueue-failure path. Prefer (a) if the RPC surface allows it without breaking the CONTRIB-02 owner-only finalize variant; fall back to (b) otherwise. |
| **[JOB] Wizard poll sees a terminal state, not forever-polling** | The user must not be stuck on a spinner that resolves neither to success nor to an actionable error. | LOW (already substantially shipped) | `SyncProgress.tsx` already caps at `POLL_MAX_ATTEMPTS=40` (~120s) and a `MISSING_ROW_GRACE_POLLS=10` grace window for Railway cold starts, converting to a client-visible `"error"` state on cap. This is presentation-layer good practice already in place — the remaining gap is purely server-side (the janitor + dropped-enqueue detection above), so the DB truth catches up with what the client already assumes, and a page **refresh** doesn't restart into the same "computing forever" DB row. |
| **[RATE] `429 + Retry-After` contract, reused not reinvented** | Standard, already-adopted convention in this codebase. | LOW | `rateLimitDenyJson`/`rateLimitDenyText` in `src/lib/ratelimit.ts` are the canonical builders (429 for throttled, 503 for a misconfigured/fail-closed limiter, `Retry-After` header on both). Any newly-covered route should call these, not invent a new shape. |
| **[RATE] Per-user keying for authed routes, per-IP for public routes** | Prevents one tenant's burst from starving another; per-IP is the only option for unauthenticated surfaces. | LOW | Already the dominant, correct convention (`` `keys-sync-user:${user.id}` ``, `` `verify-strategy:${ip}` `` for the one public-ish route). Keep this convention for `admin/match/eval` (the one confirmed gap) — key on `user.id` since it's already admin-authed. |
| **[RATE] Sensible limits sized to the actual Python-side cost** | A limit that's too tight breaks legitimate workflows (CSV iteration, multi-tab polling); too loose doesn't cap abuse. | LOW | Already well-precedented — this codebase's existing limiters are explicitly reasoned against real usage patterns (e.g. `syncProgressLimiter` sized to the wizard's 3s poll cadence, `csvValidateLimiter` sized to both user iteration AND the upstream Python 30/hour cap). Apply the same reasoning to `admin/match/eval`: size to the eval-tooling's real cadence, not an arbitrary round number. |

### Differentiators (Beyond Baseline Hardening — Optional for This Milestone)

Not required to close the SEAM/JOB/RATE gaps, but the kind of thing a genuinely mature
resilience posture eventually adds. Flag as candidates for a later milestone, not v1.16 scope
per the founder's CRON-deferred framing.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **[SEAM] Circuit-breaker state exposed on an ops/health dashboard** | Lets an operator SEE "Railway seam is open" instead of inferring it from a burst of Sentry 503s. | MED | Natural follow-on once the breaker itself exists; defer — the breaker's existence is the v1.16 win, observability of it is a nice-to-have. |
| **[SEAM] Idempotency-Key header on retried/replayed POSTs** | Lets a genuinely-safe retry of a normally-unsafe write (e.g. a user-initiated resync) be replayed without double-effect, by having the Python side dedupe on a client-supplied key. | HIGH | Requires Python-side dedup-key storage + TTL; real value, but out of scope for a hardening milestone that should stay additive over existing plumbing, not add a new persistence contract. Anti-feature to attempt as a shortcut around the retry-safety rule below (see Anti-Features). |
| **[JOB] Live job-queue depth / age metrics on an internal dashboard** | Operator visibility into `compute_jobs` backlog before it becomes a user-visible incident. | MED | Complements the janitor but isn't required to make the janitor correct. |
| **[RATE] Adaptive/dynamic limits (backoff the limiter itself under Python-side load)** | Smarter than a static per-minute ceiling — throttles harder when the Python service itself is degraded. | HIGH | Interesting but couples RATE to SEAM's circuit-breaker signal; sequence this AFTER the breaker exists, if ever. Not v1.16 scope. |

### Anti-Features (Do Not Build These)

| Anti-Feature | Why It Seems Appealing | Why It's Actually Dangerous Here | Do Instead |
|--------------|------------------------|-----------------------------------|------------|
| **Retrying non-idempotent POSTs** (`/api/keys/sync`, `/api/verify-strategy`, `csv-finalize`, `admin/match/recompute`) on timeout/network error | "Just retry everything that fails" feels like the simplest resilience win | These mutate state (enqueue a compute job, write a strategy row, kick off a live-key sync). A request that timed out on the CLIENT side may have **already succeeded** on the Railway/Python side — retrying blindly risks double-enqueue, duplicate `compute_jobs` rows racing the claim-token logic, or a second concurrent exchange-API sync hitting the same rate-limited broker key. This is explicitly the anti-feature the research question calls out. | Retry ONLY GET / idempotent-by-construction reads (`evalMatch`, sync-progress polls). For POSTs, surface the clean timeout/network error and let the EXISTING idempotency guards (F6 wizard/key submission idempotency, noted in git history) or an explicit user-initiated re-click handle re-attempts. |
| **Deleting orphaned `compute_jobs`/`strategy_analytics` rows outright** | Simpler than a reset-with-message | For a LIVE investor-facing factsheet, silently vanishing a row loses the audit trail of "a sync was attempted here" and can re-trigger the SAME class of dropped-enqueue bug on the next attempt with no diagnostic residue. This is exactly the TEST-DELETE-vs-PROD-reset tension the founder already flagged for the sibling `compute_jobs` orphaned-`running` purge (WR-02, TODOS.md) — PROD should reset to a terminal, message-bearing `'failed'` state, not DELETE. | Reset to `'failed'` with a specific, user-recoverable message (mirrors the existing `reset_stuck_computing_rows.py` script's own convention: `"Sync was interrupted... Please retry."`). |
| **A per-instance (in-memory-only) circuit breaker on Vercel** | Cheaper than wiring Redis state | Vercel functions are stateless/ephemeral per invocation (with fluid compute, an instance may live across a few invocations, but not reliably fleet-wide) — an in-memory breaker only ever sees a fraction of the traffic and typically resets on every cold start, so it never accumulates enough failures to trip before the instance recycles. It gives false confidence without the actual fail-fast protection the pattern promises. | Back the breaker with the SAME Upstash Redis instance already used for rate limiting — one shared failure counter + open-until timestamp, mirroring the existing `RateLimitGate` monotonic-forward-only design already proven in this codebase. |
| **Unbounded exponential backoff without a retry cap** | "Just keep trying, it'll eventually work" | On a Vercel lambda with a hard `maxDuration`, an uncapped backoff loop either gets killed mid-retry (worse than failing fast) or, if capped, silently eats the ENTIRE function budget retrying instead of leaving headroom for the actual work. | 2-3 attempts max, capped total wall-clock retry budget well under `maxDuration`, then surface the clean error. |
| **Building new RATE limiter infrastructure from scratch** | The milestone doc frames RATE as "unrated-limited routes" | As documented in the Critical Finding above, the infrastructure and convention are already mature and applied to 6 of the 7 named routes. Building a parallel or "v2" limiter would fragment the convention the codebase already got right. | Verify actual current coverage first (this research already did the grep), close the ONE real gap (`admin/match/eval`), and spend the RATE budget on **auditing** existing limits against real Python-side cost rather than re-inventing plumbing. |
| **Retrying against an OPEN circuit breaker "just this once"** | Feels harmless for a single high-priority user request | Defeats the entire purpose of `open` state (fail fast, give the failing dependency room to recover); a bypass path is how circuit breakers silently stop protecting anything in practice. | If a request is truly high-priority, it still must respect the breaker; consider a distinct, narrower `half-open` probe budget instead of an escape hatch. |

## Feature Dependencies

```
[SEAM: unified timeout budget]
    └──requires──> nothing new (extends existing analytics-client.ts / process-key-client.ts)

[SEAM: retry-with-backoff on reads]
    └──requires──> [SEAM: unified timeout budget]   (retry budget must fit inside the overall budget)

[SEAM: circuit breaker]
    └──requires──> [SEAM: unified timeout budget] + [SEAM: retry-with-backoff]
                       (breaker trips on a stream of individually-timed-out/retried calls;
                        building it before timeout/retry exist gives it nothing to count)
    └──shares infra with──> existing Upstash Redis (RATE's rate-limit store)

[SEAM: clean 503 on breaker-open]
    └──requires──> [SEAM: circuit breaker]
    └──enhances──> the ALREADY-EXISTING process-key-client.ts error-envelope pattern
                       (UPSTREAM_TIMEOUT / UPSTREAM_NETWORK_ERROR → add CIRCUIT_OPEN)

[JOB: stuck-computing janitor for strategy_analytics]
    └──pattern-copies──> the EXISTING reset_stalled_portfolio_analytics reaper
                             (proven in prod for a sibling table; lowest-risk JOB item)

[JOB: dropped-enqueue detection]
    └──requires──> [JOB: stuck-computing janitor]   (both are periodic reconciliation
                       sweeps over the same strategies/strategy_analytics/compute_jobs
                       triangle — natural to build/schedule together)

[JOB: transactional csv-finalize]
    └──independent of──> the other two JOB items (a different failure window:
                             mid-finalize, not post-finalize-worker-crash)

[JOB: wizard terminal-state polling]
    └──ALREADY SHIPPED client-side (SyncProgress.tsx cap)
    └──completed by──> [JOB: stuck-computing janitor]  (so DB truth matches client assumption)

[RATE: close admin/match/eval gap]
    └──independent──> reuses 100% existing infra, no new dependency

[RATE: audit existing limits vs real cost]
    └──independent──> no code dependency, a review pass over already-shipped limiters
```

### Dependency Notes

- **Circuit breaker requires timeout + retry to exist first:** a breaker's failure counter needs
  a well-defined "this call failed" signal. Building the breaker before the timeout budget is
  unified means it counts against two different definitions of "failed" depending on which
  client wrapper the call went through — build timeout unification and retry first, breaker last.
- **Circuit breaker and rate limiting share Redis infrastructure:** both need a fast, shared,
  cross-lambda-instance counter. Reusing the existing Upstash connection (already provisioned,
  already has a documented fail-open/fail-closed philosophy in `ratelimit.ts`) avoids introducing
  a second stateful dependency for what is conceptually the same kind of counter.
- **JOB's two reconciliation sweeps (stuck-janitor, dropped-enqueue) are naturally one cron tick:**
  both scan the same three tables (`strategies`, `strategy_analytics`, `compute_jobs`) for
  different failure signatures (present-row-stale-status vs absent-row-entirely). Scheduling them
  as one combined sweep (mirroring the existing `cron_recompute` pattern that already reaps
  `portfolio_analytics` inline before its main work) avoids two competing cron jobs racing the
  same tables.
- **Transactional csv-finalize is independent** — it closes a DIFFERENT failure window (mid-request,
  before any worker ever picks up a job) than the other two JOB items (post-request, worker-side).
  It can be built and shipped in any order relative to the janitor/dropped-enqueue sweep.

## MVP Definition

### Launch With (v1.16 — this milestone)

- [ ] **[SEAM] Unify the timeout budget** across `analytics-client.ts` and `process-key-client.ts`
      into one exported constant/table, with every Vercel route's `maxDuration` verified to sit
      comfortably above its own client timeout — essential because the two clients currently
      disagree (30s vs 60s) with no documented reason, and that's the seam this milestone exists
      to hardened.
- [ ] **[SEAM] Retry-with-backoff on idempotent GET/read paths only** (`evalMatch`, sync-progress
      poll, any `/api/portfolio-analytics`-style read) — 2-3 attempts, capped backoff + jitter.
      Essential: closes the "hung request" cascade for the read half of the seam cheaply.
- [ ] **[SEAM] Circuit breaker (closed/open/half-open) backed by the existing Upstash Redis**, with
      a clean `503 CIRCUIT_OPEN` envelope reusing the `process-key-client.ts` error-shape
      convention. Essential: this is the actual "top item" the milestone names first.
- [ ] **[JOB] `strategy_analytics` stuck-`computing` janitor**, copying the proven
      `reset_stalled_portfolio_analytics` pattern, wired into a recurring cron tick (not a manual
      script). Essential: directly closes "no forever-spinners."
- [ ] **[JOB] Dropped-enqueue reconciliation sweep** (strategy has data, no job/analytics row) with
      auto-retry-enqueue + Sentry alert. Essential: closes the `after()`-never-ran gap the W-2
      partial fix doesn't cover.
- [ ] **[JOB] Transactional (or compensating) csv-finalize.** Essential: closes the orphan-strategy-row
      class named explicitly in TODOS.md.
- [ ] **[RATE] Close the one confirmed gap** (`admin/match/eval`) using the existing
      `checkLimit`/`rateLimitDenyJson` convention. Essential but small — this is the entire real
      RATE gap once the stale premise is corrected.
- [ ] **[RATE] Audit existing limiter values against real Python-side cost** for the 6 routes the
      milestone named (they already have SOME limiter — verify it's the RIGHT one, not just that
      one exists). Essential to actually close the loop the milestone opened, even though it's a
      review task rather than new code.

### Add After Validation (not this milestone, but natural next step if v1.16's gaps recur)

- [ ] Circuit-breaker state on an operator dashboard — add once the breaker itself has been live
      long enough to have tripped at least once in practice.
- [ ] Idempotency-Key support for user-initiated retries of normally-unsafe POSTs — add if the
      "retry only idempotent reads" restriction in v1.16 proves too limiting in practice (e.g. users
      frequently need to manually re-click through a timed-out sync).

### Future Consideration (v2+, explicitly out of v1.16 scope per founder decision)

- [ ] CRON health-check + founder-LP/email idempotency — explicitly **deferred by the founder,
      2026-07-25**, tracked separately in TODOS.md's "Reliability / observability" section.
- [ ] Adaptive/load-aware rate limiting — couples RATE to SEAM's breaker signal; premature before
      the breaker has real production signal to react to.

## Feature Prioritization Matrix

| Feature | User/Ops Value | Implementation Cost | Priority |
|---------|-----------------|----------------------|----------|
| SEAM unified timeout budget | HIGH | LOW | P1 |
| SEAM retry (idempotent reads) | MEDIUM | LOW | P1 |
| SEAM circuit breaker | HIGH | MEDIUM | P1 |
| SEAM clean 503 envelope | HIGH | LOW | P1 |
| JOB stuck-computing janitor | HIGH | LOW | P1 |
| JOB dropped-enqueue sweep | HIGH | MEDIUM | P1 |
| JOB transactional csv-finalize | MEDIUM | MEDIUM | P1 |
| RATE close admin/match/eval gap | LOW | LOW | P2 |
| RATE audit existing limits | MEDIUM | LOW | P2 |
| Circuit-breaker ops dashboard | MEDIUM | MEDIUM | P3 |
| Idempotency-Key retries | MEDIUM | HIGH | P3 |

**Priority key:** P1 = must-have to close the milestone's stated goal ("no hung request / dropped
enqueue / worker crash can strand a factsheet"). P2 = should-have, closes the RATE group's real
(much smaller than stated) gap. P3 = defer to a later milestone.

## Idempotency / Retry-Safety Classification (by endpoint class)

Explicit per the downstream consumer's quality gate — this table is the single source of truth
for "what's safe to retry" when SEAM requirements get written.

| Endpoint class | Examples | HTTP method | Safe to auto-retry? | Why |
|----------------|----------|-------------|----------------------|-----|
| Pure reads | `evalMatch`, sync-progress poll, portfolio-analytics GET | GET | YES | No side effect; a duplicate call reads the same state. |
| Key sync / verify | `keys/sync`, `verify-strategy` | POST | **NO** | Triggers a live exchange-API sync + writes; a client-side timeout does not guarantee the server-side effect didn't complete. |
| CSV finalize / validate | `csv-finalize`, `csv-validate` | POST | **NO** (finalize) / conditionally-idempotent (validate, if purely a dry-run check with no persistence) | Finalize creates rows; validate should be confirmed side-effect-free before treating it as retry-safe — verify at implementation time, don't assume from the name. |
| Admin match/recompute | `admin/match/recompute` | POST | **NO** | Explicitly force-recomputes state; a duplicate concurrent recompute risks a race the existing in-flight/claim-token machinery is designed to prevent, not invite. |
| Optimizer / simulator / bridge | `portfolio-optimizer`, `simulator`, `bridge` | POST | **CONDITIONALLY** — these are computationally read-like (no persisted side effect, pure computation over existing data) but are POSTs by HTTP verb. Treat as retry-safe ONLY if confirmed the Python handler performs no writes; otherwise treat as unsafe by default. | HTTP method alone is not a reliable signal here — verify against the actual handler, don't retry a POST just because it "feels read-like." |

## Sources

- **Codebase (primary source, HIGH confidence):** `src/lib/analytics-client.ts`,
  `src/lib/process-key-client.ts`, `src/lib/ratelimit.ts`, `src/components/strategy/SyncProgress.tsx`,
  `src/app/api/strategies/csv-finalize/route.ts`, `analytics-service/routers/cron.py`,
  `analytics-service/services/job_worker.py`, `analytics-service/scripts/reset_stuck_computing_rows.py`,
  `supabase/migrations/20260516122247_portfolio_analytics_stuck_row_reaper.sql`, `TODOS.md`,
  `.planning/PROJECT.md`, and `git log -S"checkLimit"` on the seven named RATE routes (dates
  2026-04-10 through 2026-07-23, all predating the 2026-07-25 milestone open).
- [Circuit Breaker Pattern — Azure Architecture Center](https://learn.microsoft.com/en-us/azure/architecture/patterns/circuit-breaker) — MEDIUM confidence, standard closed/open/half-open state machine description, corroborated by multiple independent sources in the same search.
- [Vercel Functions Limits](https://vercel.com/docs/functions/limitations) / [Configuring Maximum Duration for Vercel Functions](https://vercel.com/docs/functions/configuring-functions/duration) — HIGH confidence, official docs; fluid compute raises the practical ceiling to 800s GA / 1800s beta, informing the "verify maxDuration sits above client timeout" table-stakes item.
- [Railway Specs & Limits](https://docs.railway.com/networking/public-networking/specs-and-limits) — MEDIUM confidence (community help-station corroboration), Railway's public-networking request limit is ~5 minutes, which upper-bounds any SEAM timeout budget set from the Vercel side when reaching Railway over its public URL (private networking has no such limit, relevant if the two services are ever moved onto Railway's private network together).

---
*Feature research for: Production Resilience & Reliability (v1.16) — SEAM / JOB / RATE requirement groups*
*Researched: 2026-07-25*
