# Pitfalls Research

**Domain:** Adding failure handling (SEAM + JOB + RATE) to EXISTING live, money-bearing ingestion plumbing (Vercel Next.js ↔ Railway FastAPI analytics-service ↔ Supabase Postgres compute-jobs queue) — v1.16 Production Resilience & Reliability.
**Researched:** 2026-07-25
**Confidence:** HIGH — every pitfall below is grounded in this codebase's actual source (`src/lib/analytics-client.ts`, `src/lib/process-key-client.ts`, `analytics-service/routers/process_key.py`, `analytics-service/main_worker.py`, the `compute_jobs` migrations/runbook) or this project's own prior incidents (WEDGE-01, the 106-janitor revert, the WORKER-04 window-widening). Two findings (see Pitfall 9 and Pitfall 11) are "the backlog document is stale" discoveries made by grepping current source against `TODOS.md` claims — flagged explicitly so the roadmapper doesn't build fixes for already-shipped work.

> **REQ-group map used below:** **SEAM** = Vercel→Railway resilience (timeout/retry/circuit-breaker on `analytics-client.ts` + `process-key-client.ts`); **JOB** = job-state integrity (stuck-`computing` detection, transactional finalize, worker-crash janitor, orphaned-`running` DELETE-vs-reset); **RATE** = rate limiting on authed routes hitting Python. Phase numbers don't exist yet (roadmap not written); pitfalls are mapped to REQ-group, which the roadmapper turns into phase numbers continuing from 140.

---

## Critical Pitfalls

### Pitfall 1: Blind retry on `/process-key` duplicates the teaser lead — `flow_type` determines idempotency, the endpoint doesn't

**What goes wrong:**
`POST /process-key` is called by THREE different flows through the same FastAPI route: `teaser` (public landing-page verify), `resync`/`onboard` (authenticated key sync), and `csv` (wizard finalize). A SEAM retry policy that treats "the endpoint" as the unit of idempotency will retry all three the same way. But `process_key.py` explicitly documents (line ~630): **"teaser submissions are deliberately NOT idempotent (each landing-page [visit mints a new verification])."** A network blip between Vercel and Railway where the upstream write actually succeeded but the response was lost — then a naive SEAM retry re-fires the same POST — mints a SECOND `strategy_verifications` row (and, per `verify-strategy/route.ts`, a second `public_token` + a second lead) for one user action. `resync`/`onboard`, by contrast, IS idempotent: the partial unique index on `compute_jobs` plus the explicit `WIZARD_DUPLICATE` code path (`process_key.py` lines ~736-748, ~905-912) makes a duplicate enqueue attempt a safe no-op that returns the existing row.

**Why it happens:**
"Retry on timeout" is naturally designed at the HTTP-client layer (one wrapper, one policy), but idempotency here is a property of `flow_type`, not of the path or the HTTP verb. The three flows share one endpoint precisely because of the Phase-19 unification — which makes it easy to reason "one endpoint, one retry rule" when the reality is three different write contracts underneath.

**How to avoid:**
- Gate retry eligibility on `flow_type`, not on path: `resync`/`onboard`/`csv` (idempotent-keyed at the DB layer) are safe to retry-with-backoff on transient failures (timeout, 5xx, network error); `teaser` is NOT — a teaser timeout must surface as a clean error to the landing page, never a silent client-side retry.
- If teaser retry-safety is wanted later, it requires an actual idempotency key (e.g. hash of `email+exchange+api_key fingerprint` within a TTL window) written INTO the SECURITY DEFINER path — a schema/RPC change, not a client-side retry-loop change. Out of scope for a client-timeout-and-retry milestone; call it out as explicitly deferred rather than silently "retrying everything with a shared policy."
- Add a regression test that asserts calling `postProcessKey({flow_type: "teaser", ...})` twice with identical input produces TWO `strategy_verifications` rows (documents the non-idempotent contract) so a future refactor can't accidentally start retrying it.

**Warning signs:**
Duplicate teaser leads with the same email in `strategy_verifications`; a SEAM retry wrapper with no `flow_type` branch; a test suite that asserts idempotency for `/process-key` as a blanket endpoint property instead of per-flow.

**Maps to:** SEAM (retry-policy design). Verification: fault-injection test per `flow_type` — teaser retry is REFUSED (or absent), resync/onboard/csv retry is proven safe via the existing `WIZARD_DUPLICATE`/unique-index/RPC contract.

---

### Pitfall 2: Two separate outbound-fetch wrappers exist — hardening one and missing the other leaves half the money-path unprotected

**What goes wrong:**
There are **two** independent HTTP client wrappers calling the Railway analytics service, each with its own bare `fetch` + `AbortSignal.timeout`, zero retry, zero circuit breaker:
- `src/lib/analytics-client.ts` (`analyticsRequest`, `DEFAULT_TIMEOUT_MS = 30_000`) — used by `validateKey`, `encryptKey`, `computePortfolioAnalytics`, `runPortfolioOptimizer`, `findReplacementCandidates`, `simulateAddCandidate`, `recomputeMatch`, `evalMatch`.
- `src/lib/process-key-client.ts` (`postProcessKey`, inline 60s timeout) — used by `verify-strategy`, `keys/sync`, `keys/validate-and-encrypt`, `strategies/finalize-wizard`, `strategies/csv-validate`, `strategies/csv-finalize`.
A SEAM plan that finds and hardens only the one named in the milestone description ("`analytics-client.ts` gets a bounded fetch timeout + retry-with-backoff + circuit breaker") and stops there leaves the ENTIRE unified-backbone ingestion path (`process-key-client.ts` — the actual money-onboarding surface: key connect, CSV upload, resync) with no resilience at all.

**Why it happens:**
`process-key-client.ts` was built AFTER `analytics-client.ts` (Phase 19, to centralize the 5 thin adapters) and its own docstring literally says "Centralizing it here gives one place to thread observability, retries, timeouts... without touching each route" — the intent was always there, but the SEAM work is the first milestone to actually act on it. It's easy to grep for "`analytics-client`" in the PROJECT.md description and miss the sibling file.

**How to avoid:**
- Treat SEAM as "harden every outbound call to the Railway service," enumerated as BOTH files, not "harden `analytics-client.ts`." Grep `ANALYTICS_SERVICE_URL`/`ANALYTICS_URL` usage repo-wide at phase kickoff (this research already did: `debug-key-flow` and `cron/warm-analytics` also fetch directly — decide explicitly whether those need the same treatment or are legitimately out of scope, e.g. debug-key-flow already has its own per-step `AbortSignal.any` + heartbeat design that may not want a generic wrapper).
- Extract a SHARED resilience layer (timeout/retry/breaker) that both `analyticsRequest` and `postProcessKey` call into, rather than duplicating the policy twice — the current duplication (one has 30s default, the other has 60s inline) is exactly how a shared circuit breaker would end up with two independently-flapping breakers if built ad hoc into each file.
- Verify the breaker's OPEN state is scoped to the SHARED underlying resource (Railway is down) not per-wrapper — a `process-key-client.ts` breaker and an `analytics-client.ts` breaker that don't share state will each need to independently rediscover the outage.

**Warning signs:**
A SEAM PR that touches only `analytics-client.ts`; `verify-strategy`/`keys/sync`/CSV routes still hanging on a Railway outage after the "SEAM" phase ships; two different retry/backoff constants in two files.

**Maps to:** SEAM. Verification: an integration test that kills the Railway mock for BOTH wrapper's call sites and confirms both fail fast with the same class of clean error.

---

### Pitfall 3: In-memory circuit breaker / rate limiter is near-useless on Fluid Compute — but this codebase ALREADY has the right pattern, just not for this seam yet

**What goes wrong:**
Vercel Fluid Compute reuses function instances across concurrent requests rather than one-request-per-instance, but there are still MANY concurrent instances across regions/scale-events — a breaker or limiter implemented as a plain in-memory module-level variable (`let failureCount = 0`) is scoped to ONE instance's process memory. Under real traffic (multiple concurrent instances), each instance independently thinks the breaker is closed while the other N instances are all separately discovering the same Railway outage — the aggregate request volume hitting a dying Railway service is barely reduced, defeating the entire point of a circuit breaker. The failure mode is silent: it "works" in a single-instance local dev/preview test and quietly does nothing under real concurrent prod load.

**Why it happens:**
A circuit breaker is conceptually simple to prototype as a closure with counters, and it "looks correct" in unit tests that instantiate one breaker object and call it repeatedly in-process — the multi-instance failure mode never appears until real concurrent traffic.

**How to avoid:**
- This codebase ALREADY solved an analogous problem correctly: the exchange-level circuit breaker (`_check_circuit_breaker` in `analytics-service/services/job_worker.py`, `EXCHANGE_COOLDOWNS`) stores its state in Postgres (`api_keys.last_429_at`), not in worker process memory — every worker instance reads the same durable row. The rate limiter (`src/lib/ratelimit.ts`) is ALREADY Upstash-Redis-backed (a shared external store), not in-memory. **Mirror this pattern for the new Vercel→Railway breaker**: persist breaker state (open/half-open/closed + last-failure timestamp) in Upstash Redis (already wired, zero new infra) or a Postgres row, not a module-level variable — even though Fluid Compute instance reuse makes in-memory state live "longer" than classic one-shot Lambda, it is NOT shared across instances and must not be treated as if it were global.
- If a shared store is deliberately deferred (e.g. "best-effort per-instance breaker is good enough for this milestone"), say so EXPLICITLY in the requirement/ADR — "per-instance, best-effort, does not coordinate across Fluid Compute instances" — rather than implying global protection the design doesn't provide. A silently-inadequate breaker is worse than an honestly-scoped one.
- Test the breaker's behavior by simulating TWO separate module instances (two separate `vi.resetModules()` contexts) hammering a failing endpoint — a correct shared-store breaker trips consistently across both; an in-memory one trips independently and lets through 2x the "protected" volume.

**Warning signs:**
A breaker implemented as `let state = "closed"` at module scope in `analytics-client.ts`; no Redis/Postgres read in the breaker's check function; a breaker unit test that only ever instantiates one client instance; Railway request volume during an incident not dropping the way the breaker's math predicts.

**Maps to:** SEAM. Verification: breaker state readable from a shared store (Upstash or Postgres) that two independent module contexts both observe; load test showing aggregate request volume actually drops when the breaker trips.

---

### Pitfall 4: Reaper threshold shorter than the real Railway compute tail — this project already relearned this lesson once (WORKER-04) and must apply the same math to the NEW janitor

**What goes wrong:**
A worker-crash `computing`-row janitor (JOB scope) that marks any row `computing` for more than N minutes as `failed` will falsely kill a legitimately slow-but-alive job if N is set from a "typical" case instead of the real worst-case tail. This EXACT mistake already happened once in this codebase: the original `retention_compute_jobs_orphaned_running` purge (migration `20260719120000`) used a 2-hour window justified by "the per-kind watchdog caps a stale row at ~40 min" — but the v1.13 red team (RT-01) proved that reasoning wrong for a BATCH tail: `main_worker.py` claims a batch of 5 jobs at once and dispatches them sequentially, so job #5 of a full batch can legitimately still be `running` up to `5 × 30min (process_key_long timeout) = 2.5 hours` after `claimed_at` — the 2-hour purge could DELETE a live in-flight row. The window was corrected to 4 hours (migration `20260720120000`) using `batch_size × max_per_kind_timeout` as the real basis, not the watchdog's per-kind number.

**Why it happens:**
The intuitive threshold ("watchdog resets stale rows at 40 min, so anything past 2x that must be dead") reasons from the PER-JOB timeout, not the PER-BATCH wall-clock, when jobs are claimed and dispatched in batches rather than one-at-a-time. Any new reaper threshold designed the same intuitive way will make the identical mistake unless it explicitly re-derives the batch-tail math.

**How to avoid:**
- Derive the new `computing`-row janitor's threshold from the SAME basis: what's the maximum wall-clock a row can legitimately sit at `computing` on a healthy worker, accounting for batching, queueing ahead of it, and the specific handler's real timeout (see `TIMEOUT_PER_KIND` / `WATCHDOG_PER_KIND_OVERRIDES` in `main_worker.py` — every kind's watchdog threshold is required, CI-enforced, to exceed its handler timeout: `test_every_kind_has_watchdog_headroom`). Reuse or extend that per-kind override map rather than inventing a single flat "30 minutes" constant for all `computing` rows.
- Add the same self-verifying invariant this project already uses for cron migrations (the DO-block `RAISE EXCEPTION` self-check in the retention migrations) — a janitor threshold hardcoded without a corresponding "must exceed the longest handler timeout" test is exactly how the 2-hour mistake shipped once.
- If the janitor covers a DIFFERENT table/column than `compute_jobs.status='running'` (see Pitfall 7 — `strategy_analytics.computation_status='computing'` may be a distinct surface), re-derive the batch-tail math for THAT table's actual claim/dispatch pattern; do not assume the 4-hour number transfers.

**Warning signs:**
A flat single threshold (e.g. "30 minutes") applied to every kind of `computing` row regardless of known long-running handlers (`reconstruct_allocator_history` at 30min handler timeout, `process_key_long` at 30min); no test asserting threshold > every handler's real timeout; the janitor shipping without re-deriving the batch-claim math for its specific table.

**Maps to:** JOB. Verification: a CI-enforced invariant test (mirroring `test_every_kind_has_watchdog_headroom`) that the janitor's threshold exceeds every relevant handler's real (batch-inclusive) worst case.

---

### Pitfall 5: Client-side SEAM timeout shorter than the real synchronous-flow p99 — 60s and 30s are shorter than what this system's own comments admit is possible

**What goes wrong:**
`process-key-client.ts`'s `postProcessKey` uses a flat 60-second timeout, justified in its own comment as "60s leaves slack for typical synchronous teaser runs (~10-25s)." But the SAME endpoint also serves `csv` finalize and the general synchronous pipeline, which the code elsewhere describes as bounded only by "Vercel's 300s maxDuration ceiling" — i.e., the system's own design assumes synchronous runs CAN legitimately take much longer than 25s (large CSV parse + validation, OKX archive reads, etc.). A SEAM retry-with-backoff built on top of the EXISTING 60s timeout will fire a retry (a second full attempt against Railway) while the FIRST attempt may still be legitimately in-flight past 60s — doubling load on an already-slow Railway instance during exactly the period it's most strained, and risking the Pitfall-1 duplicate-write problem if that flow happens to be non-idempotent.
`analytics-client.ts`'s `DEFAULT_TIMEOUT_MS = 30_000` has the same shape: most call sites use the 30s default, but a few callers explicitly override to 15s (`findReplacementCandidates`, `simulateAddCandidate`) for latency reasons — the SEAM design needs a per-call-site budget, not one global constant that's either too short for the slow flows or too long for the fast ones.

**Why it happens:**
Timeouts get set once, based on the "typical" observed latency, and then never revisited against the system's own documented worst-case (Vercel's 300s ceiling, or the 15-40 minute async handler timeouts that exist for a REASON — because those operations really can take that long). Adding retry logic on top of an already-too-tight timeout compounds the problem instead of fixing it.

**How to avoid:**
- Before adding retry, audit each call site's REAL worst-case latency (not "typical"): for synchronous flows bounded by Vercel's `maxDuration=300`, the SEAM timeout should budget against that ceiling minus safety margin, not against the mean case. For flows that map to async `compute_jobs` (fire-and-forget enqueue calls), the timeout should be short because the call is JUST an enqueue, not the compute itself — those two categories need different budgets.
- Never set (client timeout × (1 + retry attempts)) to exceed Vercel's `maxDuration` for the calling route — a retry loop that can run past the platform's own function timeout produces the exact "hung lambda held open until the platform kills it" failure the SEAM work exists to prevent, just with extra steps.
- Treat the 60s/30s numbers as PER-ATTEMPT budgets to be explicitly re-derived (not inherited unchanged) once retry is added — a retry-with-backoff on an unchanged 60s timeout for a flow whose own code comments admit it can run past 25s "typical" is building resilience math on a stale assumption.

**Warning signs:**
Retry-with-backoff added without any change to the existing timeout constants; a synchronous CSV finalize timing out at 60s×N-retries well under Vercel's 300s ceiling, forcing users to see failures the platform itself would have tolerated; no per-flow-type timeout differentiation.

**Maps to:** SEAM. Verification: a documented per-call-site timeout budget table (sync vs enqueue-only vs known-slow) checked against Vercel `maxDuration` for each calling route; a test simulating a slow-but-succeeding Railway response near the OLD timeout boundary to confirm the new budget doesn't false-fail it.

---

### Pitfall 6: The reaper/janitor itself reintroduces WEDGE-01 — a "safe" cleanup job is exactly the kind of thing that quietly grows heavy

**What goes wrong:**
This project has ALREADY hit "heavy work on the shared worker event loop freezes `healthz`, Railway kills the container mid-job" once (WEDGE-01, Eclipse incident 2026-07-19, PR#632) — synchronous pandas assembly in `stitch_composite` blocked the loop long enough that the platform's own health check went stale and the platform restarted the container mid-job, which is precisely the crash scenario the new worker-crash janitor exists to clean up after. A new reaper/janitor is easy to reason about as "just a cheap SQL scan," but if it's implemented as (a) a synchronous, unbounded table scan on the SAME event loop as the interactive dispatch loop, (b) without its own `asyncio.wait_for` bound, or (c) triggered by heavy in-Python row-by-row processing (e.g., re-deriving degraded state per row instead of one batched SQL statement), it can become the NEXT thing that freezes `healthz` and gets killed mid-run — ironically becoming a new instance of the exact failure class it's supposed to clean up after.

**Why it happens:**
"It's just a cleanup cron, how heavy could it be" is the same reasoning that let the original `stitch_composite` pandas assembly go unnoticed until it caused an incident — cleanup/maintenance code paths get less scrutiny than the "real" business logic paths, but they run on the same shared loop.

**How to avoid:**
- Implement the janitor as a single bounded SQL statement (à la the existing `retention_compute_jobs_orphaned_running` cron — one `DELETE ... WHERE ... < now() - interval`) executed via `pg_cron`/`pg_net` OR, if it must run from the Python worker, wrap it in `asyncio.to_thread` + `asyncio.wait_for` exactly like the WEDGE-01 fix applied to `stitch_composite`'s pandas assembly and the sFOX/MT5 crawl bound.
- If the janitor needs to touch MANY rows with per-row logic (e.g., emitting a distinct audit/Sentry event per stuck job), batch the writes and keep the loop itself cheap — never a per-row synchronous network call inside a tight Python loop on the shared event loop.
- Add the janitor tick to the FLIPRETRY-04-style heartbeat discipline already used elsewhere in `main_worker.py` (refresh `main_worker_healthz.LAST_TICK_AT` around long-but-alive operations) so a legitimately-longer-than-expected janitor sweep doesn't itself trip a false-stale restart.
- Regression-test it the same way WEDGE-01 was closed: assert the janitor tick does not block `healthz` past `STALE_THRESHOLD` even when the scan touches a large synthetic backlog.

**Warning signs:**
The janitor implemented as a Python loop with a per-row `await supabase.table(...).update(...)` inside a `for` over an unbounded query result; no `wait_for` around the janitor tick; `healthz` latency spikes correlating with the janitor's schedule in staging/load tests.

**Maps to:** JOB. Verification: a WEDGE-01-class regression test — the janitor tick, run against a large synthetic backlog, must not stall `healthz` past `STALE_THRESHOLD`.

---

### Pitfall 7: Reusing `updated_at`/`computed_at` as the staleness clock — this project already reverted a janitor for exactly this mistake

**What goes wrong:**
A prior attempt at a similar janitor (tracked in this project's history as "106 janitor," deferred/reverted) filtered on a column that didn't exist and, more importantly, used `computed_at` as the staleness signal — which is WRONG because `computed_at` (or any generic `updated_at`) gets touched by OTHER writes unrelated to "how long has this row been stuck computing," so the janitor could reap a row mid-compute (a live job whose `computed_at` hadn't been refreshed yet for an unrelated reason) or fail to reap a genuinely stuck row whose `updated_at` was bumped by some other process. The new worker-crash `computing`-row janitor is at real risk of repeating this exact mistake if it's built against whatever timestamp column happens to already exist rather than a purpose-built one.

**Why it happens:**
Reusing an existing column ("we already have `updated_at`, why add a migration") is the path of least resistance, but a staleness clock needs a WRITER-STAMPED, single-purpose timestamp that means exactly one thing ("this row transitioned INTO the computing state at time T") — an overloaded general-purpose timestamp cannot honestly answer that question.

**How to avoid:**
- Add a dedicated `computing_started_at` (or equivalently named) column, stamped ONLY by the transition into `computing`, and cleared/left alone on transition OUT — never reused for any other write. This is the exact fix direction this project's own prior-attempt note calls for: "needs a transition-timestamp DDL... `computing_started_at` + writer-stamps."
- Verify the write path: whichever code sets `computation_status = 'computing'` must, in the SAME statement/transaction, stamp `computing_started_at = now()` — a separate best-effort write that can fail independently reintroduces the same ambiguity.
- Test the mid-compute-false-positive case explicitly: a row updated (for an unrelated reason) recently but that entered `computing` a long time ago must still be reaped; a row that entered `computing` recently must NOT be reaped even if some unrelated column is stale.

**Warning signs:**
The janitor's `WHERE` clause references `updated_at` or `computed_at` instead of a dedicated transition timestamp; no migration adding a new column alongside the janitor; the same non-existent-column bug class from the prior 106-janitor attempt.

**Maps to:** JOB. Verification: unit test with a row whose generic `updated_at` is fresh but `computing_started_at` is old (must reap) and vice versa (must not reap).

---

### Pitfall 8: "Two birds, one janitor" is a claim to verify, not assume — the fence flake and the worker-crash janitor may live at different layers

**What goes wrong:**
The v1.16 JOB scope description states the new worker-crash `computing`-row janitor "also removes the recurring shared-test-DB fence flake — two birds." But this project's OWN prior diagnosis of that flake (WORKER-04, v1.13, already shipped) root-caused it to a DIFFERENT layer: `compute_jobs.status = 'running'` rows orphaned on the WORKERLESS TEST project by the `derive-allocator-key-dailies` cron, colliding with fence-test seeds through the claim RPC's partition-dedupe `NOT EXISTS` arms keyed on `status IN ('running','done_pending_children')`. That diagnosis was ALREADY fixed by a daily retention purge cron (`retention_compute_jobs_orphaned_running`, migrations `20260719120000`→`20260720120000`, now a 4-hour window). If the NEW JOB-scope janitor targets `strategy_analytics.computation_status = 'computing'` — a DIFFERENT table and column — building it does not automatically touch the `compute_jobs.status='running'` rows the existing flake diagnosis pointed at. Shipping the new janitor and assuming the flake is now fixed (without re-running CI enough times to confirm) risks closing the JOB requirement while the flake — already once diagnosed and once "fixed" — is still live, or resurfaces because the EXISTING purge's schedule/window interacts with the new janitor in an unverified way.

**Why it happens:**
"Orphaned running/computing row" sounds like one concept, and the project's own retrospective explicitly said the WORKER-04 fix was itself "re-homed to v1.13" as the flake's root-cause fix — conflating that already-shipped fix with a NEW, differently-scoped v1.16 janitor is an easy shorthand to fall into when writing scope descriptions from memory rather than from the migration history.

**How to avoid:**
- Before scoping the new janitor, explicitly re-read the `retention_compute_jobs_orphaned_running` migration's own header (it documents the exact mechanism) and confirm: does the new `computing`-row janitor operate on the SAME table/predicate space, or a genuinely separate one? If separate, the "two birds" claim needs its OWN verification against the flake, not inheritance from the already-shipped WORKER-04 fix.
- Verify by RUNNING CI repeatedly (or checking the flake's historical recurrence cadence) after the new janitor ships, not by inference from the scope description. The project's own retrospective already flagged this exact discipline gap once: "the recurring shared-test-DB fence flake resurfaced... the root-cause retention purge is itself re-homed... it will re-fire until built" — meaning this flake has ALREADY resurfaced once after being declared "root-caused." Don't repeat that pattern a second time by declaring victory on inference.
- If the new janitor and the existing WORKER-04 purge both touch overlapping tables/predicates, make sure their schedules and windows don't fight each other (e.g., the new janitor firing an aggressive threshold that re-creates the exact race the 4-hour widening was designed to prevent).

**Warning signs:**
No CI run count/observation window cited as evidence the flake stopped; the new janitor's migration doesn't reference or reconcile with `retention_compute_jobs_orphaned_running`; "fixed" declared based on scope-description inference rather than observed CI behavior over multiple days.

**Maps to:** JOB. Verification: N consecutive green CI runs (not just "should be fixed") post-ship, explicitly checking the specific flake signature (fence-test collision with `derive-allocator-key-dailies` seeded rows) is gone — not just "tests are green" generally.

---

### Pitfall 9: Trusting `TODOS.md`'s RATE claim without re-verifying against current source — the backlog document is stale here

**What goes wrong:**
`TODOS.md` (consolidated 2026-07-23) states: "Rate limiting only on 6 routes — the authed routes that hit the Python service (`verify-strategy`, `keys/{sync,validate,encrypt}`, `admin/match/recompute`, `admin/partner-import`, `trades/upload`, `intro`) are unlimited → arbitrary quota burn." **This research checked all seven named routes against current source and every one of them already calls `checkLimit(...)` with a named Upstash-backed limiter** (`publicIpLimiter` on verify-strategy; `keysSyncUserLimiter`+`userActionLimiter` on keys/sync; `userActionLimiter` on keys/validate-and-encrypt, trades/upload, and intro; `adminActionLimiter` on admin/match/recompute and admin/partner-import). A RATE phase that takes the TODOS bullet at face value and "adds rate limiting to these 6/7 routes" will duplicate already-shipped limiters (harmless but wasted effort) OR, worse, will treat the phase as "done" once those 7 are wired and MISS the actual current gaps this research found: `admin/match/eval` (calls `analytics-client.ts`'s `evalMatch`, no `checkLimit` anywhere in the route) and the two direct-fetch routes (`debug-key-flow` — has its OWN dedicated limiter, so fine; `cron/warm-analytics` — a cron route, different threat model, needs its own judgment call rather than the same user-facing limiter).

**Why it happens:**
Backlog documents are written from memory/audit-history at a point in time and don't automatically stay in sync with intervening PRs (the audit-2026-05-07 identifiers — P709, B15, F6, C-PR5-01 — visible in the current `ratelimit.ts`/route comments show this rate-limiting work actually landed BEFORE the 2026-07-23 TODOS consolidation date, so the bullet was already stale when it was written down).

**How to avoid:**
- At RATE phase kickoff, re-grep the actual current gap (`grep -rl "analytics-client\|process-key-client" src/app/api --include=route.ts` then check each for `checkLimit`) rather than copying the TODOS.md route list into the requirement. This research already did that grep — the only genuine gap found among Python-calling routes was `admin/match/eval`.
- Treat every backlog bullet in TODOS.md the same way for THIS milestone: as a hypothesis to re-verify against current source, not a pre-verified requirement — several of the "FIX MID-TERM / Reliability" bullets this research also checked (see Pitfall 11) show the same staleness pattern.
- Scope the RATE requirement around the VERIFIED current gap (`admin/match/eval`, plus any newly-added routes since), not the copied list.

**Warning signs:**
A RATE phase plan that lists the same 7 routes from TODOS.md verbatim without a fresh grep; a PR that adds `checkLimit` calls to routes that already have them (git diff shows no-op or duplicate limiter).

**Maps to:** RATE. Verification: the phase's actual diff touches only routes independently confirmed (via fresh grep, not TODOS.md) to lack a limiter.

---

### Pitfall 10: The `42501`/unified-backbone CSV-finalize bug in TODOS.md may already be fixed — verify before re-fixing

**What goes wrong:**
`TODOS.md`'s "Money-path correctness" section lists: "Unified-backbone CSV-finalize breaks if flag on — service-role client has no `auth.uid()` → 42501 every time when `PROCESS_KEY_UNIFIED_BACKBONE=on`." Current source shows two things that complicate this claim: (1) `analytics-service/routers/process_key.py` (lines ~792-820) ALREADY forwards the end user's access token via `X-User-Access-Token` and calls `finalize_csv_strategy` with a user-scoped Supabase client specifically to avoid the 42501 — with an inline comment describing exactly this bug and its fix; (2) `docs/runbooks/compute-queue.md` states `PROCESS_KEY_UNIFIED_BACKBONE` **is retired** ("read nowhere... there is no runtime rollback switch anymore") as of Phase 106 — the flag this TODOS bullet is conditioned on no longer gates anything, because the unified backbone is now unconditional. Building a JOB-phase fix for "the flag-on 42501 bug" risks either re-fixing an already-fixed bug, or worse, mis-diagnosing a DIFFERENT still-open problem (the actual open item is "csv-finalize is non-transactional → orphan strategy rows on partial failure," a distinct multi-step-atomicity gap, not the auth.uid() issue) as the same thing.

**Why it happens:**
The TODOS bullet may describe a bug that was true at some point in the Phase-19 rollout and was fixed in a later, uncredited commit, or it may be describing a subtly different remaining case (e.g., some OTHER code path besides `finalize_csv_strategy` that still uses the bare service-role client without the token-forwarding fix). Either way, treating a backlog bullet as a ready-made bug report without re-reading the current code risks solving the wrong problem.

**How to avoid:**
- Before scoping the JOB requirement around this bullet, re-read `process_key.py`'s CSV-finalize branch (already done in this research — the `X-User-Access-Token` forwarding fix is present and commented) and confirm whether a 42501 is STILL reproducible today, or whether the TODOS bullet is describing already-resolved history.
- If the 42501 truly is resolved, redirect the JOB-phase "transactional finalize" work at the REAL remaining gap: whether `finalize_csv_strategy`'s SECURITY DEFINER transaction covers the WHOLE finalize sequence (strategy row + `strategy_verifications` row + compute-job enqueue) atomically, or whether there's a step OUTSIDE that RPC (e.g., the compute-job enqueue call) that can still leave an orphaned strategy row if it fails after the RPC commits.
- Write a regression test that reproduces (or fails to reproduce) the specific 42501 against current `main` before writing any fix — "I could not reproduce this" is a valid, useful research outcome per this project's own honesty discipline, and prevents wasted phase scope.

**Warning signs:**
A fix PR that re-adds `X-User-Access-Token` forwarding that already exists (git diff shows no functional change); a requirement written directly from the TODOS bullet text without a corresponding "reproduced on commit X" note.

**Maps to:** JOB. Verification: a reproduction test run against current `main` BEFORE the phase starts, documenting pass/fail, so the phase's actual target is the verified-real gap.

---

### Pitfall 11: `recomputeMatch` and `computePortfolioAnalytics` retry-safety hasn't been explicitly audited — "it's just a recompute" is an assumption, not a proof

**What goes wrong:**
`admin/match/recompute` and the portfolio-analytics/optimizer endpoints READ as idempotent ("recompute" implies deterministic re-derivation from current DB state), and unlike the teaser flow there is no explicit "NOT idempotent" comment anywhere near them — but that absence of a comment is not the same as a verified guarantee. `match.py`'s `recompute()` function name and the presence of a per-allocator `asyncio.Lock` (`_get_recompute_lock`) suggests concurrent-recompute protection exists, but a SEAM retry policy that blindly marks "everything under `analytics-client.ts` except the known-mutating ones" as retry-safe is asserting an idempotency property for `recomputeMatch` that was never explicitly checked against side effects (does recompute ever trigger a notification, an audit-log write with a fresh UUID each call, or a partial write followed by a crash mid-recompute that a naive retry would compound?).

**Why it happens:**
"Read/compute-shaped" function names (`recompute`, `compute*`, `optimize*`) create a strong intuition of purity/idempotency that isn't automatically true just because the name suggests it — the ONLY endpoints in this codebase explicitly documented as non-idempotent (teaser) got that documentation because someone was burned by it; the rest haven't necessarily been asked the question.

**How to avoid:**
- Before assigning retry-safety to any `analytics-client.ts` function, explicitly trace its Python handler for side effects beyond the primary DB write it's named for: does it write audit-log rows with per-call metadata that would duplicate on retry? Does it ever enqueue a downstream job, send a notification, or touch a rate-limited external API as a SIDE effect of "just recomputing"?
- For `recomputeMatch` specifically: verify the `_get_recompute_lock` per-allocator lock actually prevents a RETRIED overlapping call from racing the original (a lock held only within the Python process doesn't protect against two SEPARATE Vercel-triggered HTTP calls landing on two different Railway/worker instances if there's more than one).
- Default to "read-only GETs are safe to retry; anything that writes gets an explicit case-by-case idempotency proof" — not "compute-named functions are probably fine."

**Warning signs:**
A retry policy classification table that includes `recomputeMatch`/`computePortfolioAnalytics` as "safe to retry" with no supporting trace of the Python handler's actual side effects; the per-allocator lock assumed to be a distributed lock when it may only be process-local.

**Maps to:** SEAM. Verification: an explicit per-endpoint idempotency audit table (function → side effects traced → retry-safe: yes/no/needs-key) reviewed before the retry policy ships, not inferred from function names.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|-----------------|------------------|
| Blanket retry policy keyed on HTTP path, not `flow_type`/side-effect audit | Less code, one wrapper | Duplicate teaser leads / re-fired non-idempotent writes on transient network blips | Never — must be per-flow |
| In-memory breaker/limiter state (module-level variable) | Zero new infra, simple to write | Near-useless under concurrent Fluid Compute instances; false confidence | Never for a shared-resource breaker; only acceptable if EXPLICITLY documented as best-effort/per-instance |
| Reusing `updated_at` as a staleness clock for the new janitor | No migration needed | Repeats the exact 106-janitor revert (mid-compute false reap or missed genuine stalls) | Never — this project already paid this cost once |
| Copying TODOS.md's route list into the RATE requirement verbatim | Fast requirement-writing | Re-does already-shipped work or misses the real current gap (`admin/match/eval`) | Never — always re-grep first |
| Flat single reaper threshold for all `computing`/`running` kinds | Simple one-number config | Reaps a legitimately slow kind (mirrors the WORKER-04 2h→4h correction) | Never — derive per-kind from real batch-tail math |
| Retry-with-backoff added without revisiting the existing timeout constant | Fast to ship | Retries fire while the first attempt is still legitimately in-flight, doubling load during an outage | Never — timeout budget must be re-derived alongside retry count |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|-----------------|-------------------|
| Vercel ↔ Railway (`analytics-client.ts`) | Adding retry/breaker to this file only | Also harden `process-key-client.ts` (separate wrapper, same Railway target); ideally share ONE resilience layer between both |
| Vercel ↔ Railway (`process-key-client.ts` / `/process-key`) | Treating retry-safety as a property of the endpoint | Gate retry on `flow_type` (`teaser`=non-idempotent by design; `resync`/`onboard`/`csv`=idempotent via unique-index + `WIZARD_DUPLICATE` + RPC) |
| Upstash Redis rate limiter (`src/lib/ratelimit.ts`) | Building a NEW in-memory limiter/breaker for the SEAM work | Reuse the ALREADY-durable Upstash store this codebase has for rate limiting; extend it (or Postgres) for breaker state too |
| `compute_jobs` watchdog (`main_worker.py`) | Setting a new janitor's threshold from intuition | Reuse the `WATCHDOG_PER_KIND_OVERRIDES` batch-tail math (`p_batch_size × max_per_kind_timeout`) and its CI-enforced invariant test |
| `finalize_csv_strategy` RPC | Assuming the whole finalize sequence is one transaction because the RPC is SECURITY DEFINER | Verify what's OUTSIDE the RPC (e.g. the compute-job enqueue call) — that's where a partial-failure orphan can still occur |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|-----------------|
| Retry-with-backoff without a shared circuit breaker | Retry amplifies load on an already-struggling Railway instance (N clients × M retries) | Circuit breaker (shared-store) trips BEFORE retries pile on; retries should back off exponentially and respect the breaker's open state | First real Railway slowdown/outage under concurrent traffic |
| Reaper/janitor doing per-row synchronous work on the shared event loop | `healthz` latency spikes during the janitor's schedule; Railway restarts correlated with janitor ticks | Single bounded SQL statement or `to_thread`+`wait_for`, per WEDGE-01 fix pattern | First backlog large enough that a per-row loop takes seconds, not milliseconds |
| Two independent breakers (one per wrapper file) each rediscovering the same outage | Twice the "protected" request volume vs a single shared breaker during an incident | Share breaker state across both `analytics-client.ts` and `process-key-client.ts` | First real Railway outage that spans both code paths simultaneously |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Retrying a teaser POST that already succeeded upstream | Duplicate `strategy_verifications` rows / duplicate leads with a fresh `public_token` each time, inflating disclosure surface | Never retry `flow_type: "teaser"` at the client layer |
| Circuit-breaker "protection" that's actually per-instance and silently inadequate | False sense of DoS/cascading-failure protection while Railway still receives near-full load during an outage | Shared-store breaker (Upstash/Postgres), or explicit documented best-effort scope |
| Building a NEW janitor without the `computing_started_at` writer-stamp discipline | Reaps a live job (data loss / user-visible failure on a healthy sync) OR fails to reap a genuinely dead one (permanent spinner) | Dedicated transition-timestamp column, stamped atomically with the status write |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|------------------|
| SEAM retry silently doubles a teaser lead submission | User sees no error but the platform now has two lead rows for one landing-page visit; support/sales confusion | No client-side retry on teaser; surface a clean, honest "please try again" error instead |
| Reaper reaps a legitimately slow composite/backfill job | User's real, in-progress sync gets marked `failed` and has to restart from scratch, appearing as "flaky product" | Threshold derived from real batch-tail math (Pitfall 4), not intuition |
| A too-short client timeout fires mid-way through a real 90-day OKX archive fetch | User sees a spurious failure on an operation that would have succeeded given the platform's own 300s ceiling | Timeout budget matched to Vercel `maxDuration`, not "typical" latency |

## "Looks Done But Isn't" Checklist

- [ ] **SEAM retry policy:** Often missing a `flow_type`/side-effect audit — verify each retried call site has an explicit idempotency proof, not an inferred one from its name.
- [ ] **SEAM coverage:** Often touches only `analytics-client.ts` — verify `process-key-client.ts` (and any other direct-fetch route) got the same treatment or an explicit documented exception.
- [ ] **Circuit breaker:** Often built as an in-memory module variable — verify it reads/writes a shared store (Upstash/Postgres) observable across separate module instances.
- [ ] **Reaper/janitor threshold:** Often set from intuition — verify it's derived from real batch-tail math (`batch_size × max_per_kind_timeout`) with a CI-enforced invariant test, mirroring `test_every_kind_has_watchdog_headroom`.
- [ ] **Reaper/janitor staleness clock:** Often reuses `updated_at`/`computed_at` — verify a dedicated writer-stamped transition timestamp exists.
- [ ] **Reaper/janitor event-loop safety:** Often a per-row Python loop — verify it's a single bounded SQL statement or wrapped in `to_thread`+`wait_for`, with a WEDGE-01-class regression test.
- [ ] **"Two birds" fence-flake claim:** Often asserted from scope-description inference — verify against the ACTUAL WORKER-04 diagnosis (table/predicate) and N consecutive green CI runs, not just "should be fixed."
- [ ] **RATE route list:** Often copied from TODOS.md — verify with a fresh grep against current source before scoping (this research found all 7 named routes already wired; `admin/match/eval` is the real gap).
- [ ] **42501/transactional-finalize bug:** Often assumed still-open from a backlog bullet — verify reproducibility against current `main` (this research found the `X-User-Access-Token` fix already present) before building a fix.
- [ ] **DELETE-vs-reset semantics:** Often decided once and forgotten — verify the NEW janitor's terminal action (delete vs mark-failed vs reset-to-pending) matches the founder-decided TEST/PROD split, and is applied consistently if the janitor covers a different table than the existing `compute_jobs` purge.

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|----------------|------------------|
| Duplicate teaser rows from a retried non-idempotent write | LOW | De-dupe `strategy_verifications` by `(email, exchange, fingerprint)` within the retry window; add the missing flow_type gate; no data-loss risk (public teaser only) |
| Per-instance breaker gave false protection during a real Railway outage | MEDIUM | Migrate breaker state to Upstash/Postgres; replay the incident's request-volume math to confirm the shared-store version would have actually reduced load |
| New janitor reaped a legitimately slow job | MEDIUM-HIGH | Re-run the affected sync (data is lost only if the job had no checkpoint — see the existing "strategy sync-failure checkpointing" backlog item); widen the threshold using real batch-tail math; add the missing per-kind override |
| New janitor missed a genuinely dead job (relied on `updated_at`) | MEDIUM | Add the dedicated `computing_started_at` column + writer-stamp; backfill/re-derive the specific stuck strategy manually via `/admin/compute-jobs` |
| RATE phase duplicated existing limiters | LOW | Revert the no-op diff; redirect effort at the verified real gap (`admin/match/eval`) |
| JOB phase re-fixed an already-fixed 42501 | LOW | No functional harm (idempotent no-op fix), but redirect remaining phase time at the actual open orphan-row gap (enqueue-step atomicity outside the RPC) |

## Pitfall-to-Phase Mapping

| Pitfall | REQ Group | Verification |
|---------|-----------|---------------|
| 1. Blind retry duplicates non-idempotent teaser writes | SEAM | Fault-injection test per `flow_type`; teaser retry refused/absent, resync/onboard/csv retry proven safe |
| 2. Two wrapper files, one hardened | SEAM | Integration test kills Railway mock for both `analytics-client.ts` and `process-key-client.ts` call sites |
| 3. In-memory breaker/limiter useless across instances | SEAM | Breaker state readable from a shared store across two independent module contexts; load test confirms request-volume drop |
| 4. Reaper threshold shorter than real batch-tail | JOB | CI-enforced invariant: threshold > every relevant handler's real (batch-inclusive) worst case |
| 5. Client timeout shorter than real synchronous p99 | SEAM | Per-call-site timeout budget table checked against Vercel `maxDuration`; test near the old timeout boundary |
| 6. Janitor reintroduces WEDGE-01 | JOB | WEDGE-01-class regression: janitor tick against large synthetic backlog does not stall `healthz` |
| 7. Janitor reuses `updated_at` as staleness clock | JOB | Unit test: fresh-`updated_at`/old-`computing_started_at` row reaped; old-`updated_at`/fresh-`computing_started_at` row NOT reaped |
| 8. "Two birds" fence-flake claim unverified | JOB | N consecutive green CI runs post-ship, checking the SPECIFIC fence-collision signature, not general green |
| 9. RATE route list stale vs current source | RATE | Diff touches only routes independently confirmed (fresh grep) to lack a limiter |
| 10. 42501 bug possibly already fixed | JOB | Reproduction test against current `main` run BEFORE the phase starts |
| 11. `recomputeMatch`/compute-named retry-safety unaudited | SEAM | Explicit per-endpoint idempotency audit table (side effects traced), not name-inferred |

## Sources

- This codebase (HIGH — primary evidence for every pitfall above):
  - `src/lib/analytics-client.ts` (30s default timeout, zero retry/breaker, per-callsite overrides)
  - `src/lib/process-key-client.ts` (60s inline timeout, zero retry/breaker, docstring anticipating but not implementing retries)
  - `analytics-service/routers/process_key.py` (flow_type idempotency contracts: teaser non-idempotent by design ~line 630; `WIZARD_DUPLICATE` idempotent-hit ~lines 736-748, 905-912; CSV-finalize `X-User-Access-Token` 42501 fix ~lines 792-820)
  - `analytics-service/main_worker.py` (`WATCHDOG_PER_KIND_OVERRIDES`, `TIMEOUT_PER_KIND` invariant, FLIPRETRY-04 heartbeat discipline, `WORKER_CLAIM_ROLE` isolation)
  - `analytics-service/services/job_worker.py` (`_check_circuit_breaker`/`EXCHANGE_COOLDOWNS` — the existing DB-backed breaker pattern to mirror)
  - `src/lib/ratelimit.ts` (Upstash-backed shared rate limiter already in place; fail-open/fail-closed production matrix)
  - `supabase/migrations/20260719120000_retention_orphaned_running_compute_jobs.sql` + `20260720120000_retention_orphaned_running_window_4h.sql` (the WORKER-04/RT-01 batch-tail math correction, 2h→4h)
  - `docs/runbooks/compute-queue.md` (confirms `PROCESS_KEY_UNIFIED_BACKBONE`/`USE_COMPUTE_JOBS_QUEUE` are retired/permanent-on; watchdog/circuit-breaker/idempotent-retry operational detail)
  - Fresh grep of `src/app/api/**/route.ts` for `checkLimit` usage (this research; contradicts TODOS.md's "6 unlimited routes" claim — all 7 named routes are wired; real gap is `admin/match/eval`)
- This project's own incident/retrospective history (HIGH):
  - WEDGE-01 (Eclipse incident 2026-07-19, PR#632) — event-loop-block class, referenced 25+ times across the codebase's own comments/tests
  - The 106-janitor revert (`project_106_janitor_deferred_needs_transition_timestamp` — this project's memory) — reaper filtered a nonexistent column, `computed_at` wrong basis, needs `computing_started_at` + writer-stamps
  - `.planning/RETROSPECTIVE.md` — the fence flake "resurfaced" once already after being declared root-caused
  - `TODOS.md` — used as a hypothesis source, cross-checked against current source (Pitfalls 9, 10)

---
*Pitfalls research for: production resilience hardening (SEAM + JOB + RATE) on live money-bearing plumbing — v1.16*
*Researched: 2026-07-25*
