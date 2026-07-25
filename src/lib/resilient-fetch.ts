import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { CircuitOpenError } from "./seam-errors";

/**
 * Phase 140 / SEAM-02 + SEAM-03 — the ONE shared resilience core for the
 * Vercel → Railway (analytics-service) seam.
 *
 * Every outbound call to the Python analytics service routes through this
 * module: `analyticsRequest()` (analytics-client.ts), `postProcessKey()`
 * (process-key-client.ts), and the `/internal/keys/{id}/permissions` probe.
 * Hardening one client only is the documented Pitfall 2 of this phase — the
 * third seam existed for months precisely because convention alone did not
 * hold.
 *
 * IN-REPO PRECEDENT
 * -----------------
 * Breaker state in a shared store is this project's established pattern, not a
 * new idea: `analytics-service/services/job_worker.py:731 _check_circuit_breaker`
 * already runs a Postgres-backed per-exchange breaker with TTL-like cooldown
 * timestamps (`EXCHANGE_COOLDOWNS`, :416). This module is the same shape one
 * tier up, against a different resource (the Railway deployment) and a
 * different store (Upstash Redis, the only cross-Fluid-Compute-instance store
 * already wired here).
 *
 * LOCKED DECISIONS (do not re-litigate; a reviewer flagging these as defects
 * should read this block first)
 * -------------------------------------------------------------------------
 * 1. ONE core. Both clients plus the permissions probe delegate here. A
 *    module-level `let breakerState` would be per-instance and silently
 *    inadequate under Fluid Compute (instance reuse extends module lifetime
 *    but never shares memory) — see `src/app/api/debug-key-flow/rate-limit.ts`
 *    for the in-repo anti-pattern, complete with its own honest limitations
 *    block.
 * 2. ONE `breaker:railway` key. Both clients hit the same physical Railway
 *    deployment; two breakers can disagree about whether it is up.
 * 3. TTL EXPIRY IS THE HALF-OPEN TRANSITION. There is no half-open state, no
 *    probe scheduler, and no state machine. When the open-lock expires the
 *    next caller passes through naturally; a success does nothing special, a
 *    failure re-increments the counter and can re-trip. "Missing half-open" is
 *    not a defect here — it is the design.
 * 4. FAIL OPEN, ALWAYS. Every failure mode of the breaker's own store (client
 *    unconfigured, `get` throwing, malformed value) resolves to "closed,
 *    proceed" in ALL environments, production included. This is a deliberate
 *    inversion of `src/lib/ratelimit.ts`, which fails CLOSED on a production
 *    misconfiguration. The reasoning differs because the mechanisms differ: a
 *    silently-disabled rate limiter removes a regulatory cap, whereas a
 *    breaker that blocks traffic because its store is misconfigured has itself
 *    become the outage it exists to prevent. There is no environment branch
 *    anywhere in this module.
 * 5. ZERO NEW DEPENDENCIES. `@upstash/redis` and `@upstash/ratelimit` are
 *    already installed and already carry production traffic behind
 *    `ratelimit.ts`. `cockatiel`/`opossum` are explicitly out of scope.
 *
 * Retry is NOT implemented here — see `SEAM_RETRIES`.
 */

/**
 * `CircuitOpenError` is defined in the dependency-free leaf `./seam-errors` so
 * client-bundle-reachable code (`wizardErrors.ts` → ten `"use client"`
 * components) and wholesale-mocked route tests can both branch on it. It is
 * re-exported here so server-side callers already importing the core do not
 * need a second import; the class identity is the leaf's, singular.
 */
export { CircuitOpenError };

// ---------------------------------------------------------------------------
// Breaker tuning constants
//
// Exported as named constants with rationale comments (the `ratelimit.ts:94-214`
// convention) so retuning is a one-line change reviewable in isolation, rather
// than a magic number buried in a function body.
// ---------------------------------------------------------------------------

/**
 * The single breaker key, shared by every seam call site.
 *
 * MODULE CONSTANT — never interpolate user input into it (threat T-140-01).
 * A user-influenced breaker key is a trivial cross-tenant denial of service:
 * one caller could mint a key that trips the breaker for a cohort, or (worse)
 * shard the breaker so it never trips at all.
 */
export const BREAKER_KEY = "breaker:railway";

/**
 * Consecutive-ish infrastructure failures within `BREAKER_WINDOW` before the
 * circuit trips. 5 is low enough to react inside a single user's retry
 * patience and high enough that one unlucky request, or a single pod restart
 * mid-deploy, does not take the seam down.
 */
export const BREAKER_FAILURE_THRESHOLD = 5;

/**
 * Sliding window over which failures are counted (Upstash `Duration` string).
 * 30s pairs with the threshold: five failures inside half a minute is a
 * degradation signal, five spread across an hour is background noise.
 */
export const BREAKER_WINDOW = "30 s" as const;

/**
 * How long the circuit stays open. Also the `Retry-After` the 503 envelope
 * advertises. 30s is long enough for a Railway pod to finish restarting and
 * short enough that a recovered service is picked back up within one user
 * retry — and because TTL expiry IS the half-open transition, this value is
 * the entire recovery latency of the system.
 */
export const BREAKER_COOLDOWN_S = 30;

/**
 * Fallback `Retry-After` when the open-lock's TTL cannot be read (the key
 * expired between the `get` and the `ttl`, or the store returned `-1`/`-2`).
 * Matches `BREAKER_COOLDOWN_S` so a client never sees a wildly wrong hint.
 */
export const DEFAULT_RETRY_AFTER_S = 30;

/**
 * Retries performed by the core. ZERO in this phase, by design.
 *
 * Phase 141 raises this ONLY for calls the SEAM-05 idempotency audit
 * explicitly allowlists — replaying a non-idempotent `/process-key` would
 * double-enqueue a sync. It exists as a constant today so the SC-4b headroom
 * invariant `timeoutMs × callsPerRequest × (1 + SEAM_RETRIES) < maxDuration × 1000`
 * is assertable NOW, and so the assertion tightens automatically the moment
 * retries land rather than being written after the fact.
 */
export const SEAM_RETRIES = 0;

// ---------------------------------------------------------------------------
// SEAM-02 — the ONE timeout budget table
// ---------------------------------------------------------------------------

/** Identifier for a seam call site. One key per distinct budget owner. */
export type SeamBudgetKey =
  | "validate-key"
  | "encrypt-key"
  | "bridge"
  | "simulator"
  | "portfolio-optimizer"
  | "optimize-weights"
  | "match-eval"
  | "match-recompute"
  | "portfolio-analytics"
  | "process-key-enqueue"
  | "process-key-sync"
  | "keys-permissions"
  | "process-key-unified-dormant";

/**
 * Per-call-site wall-clock budgets.
 *
 * Before this table, four divergent constants owned the same concern in three
 * different places: 30s as an `analytics-client` default, 15s hardcoded inside
 * the client for two call sites, 15s as `OPTIMIZER_TIMEOUT_MS` inside a ROUTE,
 * 60s hardcoded in `process-key-client`, and 15s duplicated verbatim across two
 * files for the permissions probe. Three identical budgets, two different
 * owners. This table is the single owner.
 */
export const SEAM_BUDGETS: Record<
  SeamBudgetKey,
  { timeoutMs: number; notes: string }
> = {
  "validate-key": {
    timeoutMs: 30_000,
    notes:
      "Live exchange auth probe — genuinely slow and venue-variable (Deribit, Binance, OKX all differ). Was the analytics-client 30s default.",
  },
  "encrypt-key": {
    timeoutMs: 30_000,
    notes:
      "Same live-exchange probe class as validate-key; always runs sequentially after it, so the two budgets sum per request.",
  },
  bridge: {
    timeoutMs: 15_000,
    notes:
      "Weighted-covariance compute. Was hardcoded at analytics-client.ts:260.",
  },
  simulator: {
    timeoutMs: 15_000,
    notes:
      "Portfolio impact simulator compute. Was hardcoded at analytics-client.ts:285.",
  },
  "portfolio-optimizer": {
    timeoutMs: 15_000,
    notes:
      "Heavy compute. Was OPTIMIZER_TIMEOUT_MS declared inside the route rather than the client — the budget-ownership split this table exists to end.",
  },
  "optimize-weights": {
    timeoutMs: 30_000,
    notes: "Scenario composer optimizer. Was the analytics-client 30s default.",
  },
  "match-eval": {
    timeoutMs: 30_000,
    notes:
      "Admin eval sweep; can be slow at large lookback_days. Was the 30s default.",
  },
  "match-recompute": {
    timeoutMs: 30_000,
    notes: "Admin match engine, heavy compute. Was the 30s default.",
  },
  "portfolio-analytics": {
    timeoutMs: 30_000,
    notes:
      "ZERO CALLERS TODAY — computePortfolioAnalytics (analytics-client.ts:224) is unreachable (research §4.2). Kept rather than deleted: deleting is scope creep and it is a plausible future caller. Phase 141's idempotency audit records 'no callers' for it.",
  },
  "process-key-enqueue": {
    timeoutMs: 15_000,
    notes:
      "flow_type in {resync, onboard}: the server merely enqueues onto the worker dyno and returns 202 (verified in analytics-service/routers/process_key.py:_is_long_fetch). An enqueue that takes 15s means Railway is sick. Tightened from the blanket 60s; nothing observes these two budgets (research §6.4).",
  },
  "process-key-sync": {
    timeoutMs: 60_000,
    notes:
      "flow_type in {teaser, csv}: the full 5-method pipeline runs INLINE. MEASURE BEFORE TIGHTENING — the only latency evidence is a code comment (~10-25s typical, process-key-client CT-7); never guess a budget on the public lead-generating teaser path.",
  },
  "keys-permissions": {
    timeoutMs: 15_000,
    notes:
      "The third Railway seam (/internal/keys/{id}/permissions). Replaces two duplicated AbortSignal.timeout(15_000) constants in keys/[id]/permissions/route.ts and finalize-wizard's fetchLivePermissions.",
  },
  "process-key-unified-dormant": {
    timeoutMs: 60_000,
    notes:
      "The DEAD _unifiedValidateAndEncryptHandler fetch at keys/validate-and-encrypt/route.ts:158, which today has NO timeout at all. Routed through the core so any revival inherits a budget and a breaker rather than re-introducing an unbounded hang.",
  },
};

/**
 * Per-route declaration of the Vercel function ceiling each seam route runs
 * under, plus which budgets it spends.
 *
 * `expectedMaxDurationS` is a DECLARATION the routes are verified against, not
 * a reading of the platform. Only `keys/sync` exported a `maxDuration` before
 * this phase; the other fourteen inherited an unreadable platform default, so
 * the SC-4 invariant had no source of truth. The seam-budget invariant test
 * reads each route file from disk and fails loud if its `maxDuration` export is
 * missing or does not match this table — converting a dashboard-changeable
 * platform assumption into a checked in-repo fact.
 *
 * VERIFIED 2026-07-25 against the live project settings
 * (`vercel api /v9/projects/{projectId}` → `defaultResourceConfig`):
 * `{ fluid: true, functionDefaultTimeout: 300 }`. The declared 300 below
 * therefore MATCHES the effective platform default — pinning it does not raise
 * any route's worst-case lambda hold (threat T-140-29).
 *
 * `budgets` is an ARRAY, not a single key: three routes make two sequential
 * analyticsRequest() calls, and validate-and-encrypt nominally reaches three.
 * The invariant test SUMS `timeoutMs × calls` across the array. A per-call
 * assertion would pass while the route's real worst case is double, which is
 * wrong for a third of the analyticsRequest surface (research §6.3).
 */
export const SEAM_ROUTE_BUDGETS: Record<
  string,
  {
    expectedMaxDurationS: number;
    budgets: Array<{ key: SeamBudgetKey; calls: number }>;
  }
> = {
  "src/app/api/keys/validate-and-encrypt/route.ts": {
    expectedMaxDurationS: 300,
    budgets: [
      { key: "validate-key", calls: 1 },
      { key: "encrypt-key", calls: 1 },
      { key: "process-key-unified-dormant", calls: 1 },
    ],
  },
  "src/app/api/strategies/create-with-key/route.ts": {
    expectedMaxDurationS: 300,
    budgets: [
      { key: "validate-key", calls: 1 },
      { key: "encrypt-key", calls: 1 },
    ],
  },
  "src/app/api/strategies/composite/add-key/route.ts": {
    expectedMaxDurationS: 300,
    budgets: [
      { key: "validate-key", calls: 1 },
      { key: "encrypt-key", calls: 1 },
    ],
  },
  "src/app/api/bridge/route.ts": {
    expectedMaxDurationS: 300,
    budgets: [{ key: "bridge", calls: 1 }],
  },
  "src/app/api/simulator/route.ts": {
    expectedMaxDurationS: 300,
    budgets: [{ key: "simulator", calls: 1 }],
  },
  "src/app/api/portfolio-optimizer/route.ts": {
    expectedMaxDurationS: 300,
    budgets: [{ key: "portfolio-optimizer", calls: 1 }],
  },
  "src/app/api/scenario/optimize/route.ts": {
    expectedMaxDurationS: 300,
    budgets: [{ key: "optimize-weights", calls: 1 }],
  },
  "src/app/api/admin/match/eval/route.ts": {
    expectedMaxDurationS: 300,
    budgets: [{ key: "match-eval", calls: 1 }],
  },
  "src/app/api/admin/match/recompute/route.ts": {
    expectedMaxDurationS: 300,
    budgets: [{ key: "match-recompute", calls: 1 }],
  },
  "src/app/api/keys/sync/route.ts": {
    expectedMaxDurationS: 300,
    budgets: [{ key: "process-key-enqueue", calls: 1 }],
  },
  "src/app/api/strategies/finalize-wizard/route.ts": {
    expectedMaxDurationS: 300,
    budgets: [
      { key: "keys-permissions", calls: 1 },
      { key: "process-key-enqueue", calls: 1 },
    ],
  },
  "src/app/api/verify-strategy/route.ts": {
    expectedMaxDurationS: 300,
    budgets: [{ key: "process-key-sync", calls: 1 }],
  },
  "src/app/api/strategies/csv-validate/route.ts": {
    expectedMaxDurationS: 300,
    budgets: [{ key: "process-key-sync", calls: 1 }],
  },
  "src/app/api/strategies/csv-finalize/route.ts": {
    expectedMaxDurationS: 300,
    budgets: [{ key: "process-key-sync", calls: 1 }],
  },
  "src/app/api/keys/[id]/permissions/route.ts": {
    expectedMaxDurationS: 300,
    budgets: [{ key: "keys-permissions", calls: 1 }],
  },
};

/**
 * Railway call sites deliberately NOT routed through this core, each with its
 * reason.
 *
 * An unexplained absence from `SEAM_ROUTE_BUDGETS` is indistinguishable from an
 * oversight (research §4.5), and the third seam's existence is direct evidence
 * that silence is how drift happens. Every exclusion is written down.
 */
export const SEAM_EXCLUSIONS: Record<string, string> = {
  "src/app/api/debug-key-flow/route.ts":
    "Bespoke SSE/heartbeat design with client-abort propagation via AbortSignal.any([req.signal, ...]) that the core does not model. Already pins its own maxDuration=300.",
  "src/app/api/cron/warm-analytics/route.ts":
    "/health cold-start probe. Must NOT consume breaker failure budget — a cold probe failing IS the normal case — and must NOT be blocked by an open breaker, because a successful /health is precisely the recovery signal.",
  "src/lib/warmup-analytics.ts":
    "Same reasoning as cron/warm-analytics: a 10s fire-and-forget /health warmer. Counting its failures would trip the breaker during routine warmup.",
};

// ---------------------------------------------------------------------------
// SEAM-03 — breaker state
// ---------------------------------------------------------------------------

/**
 * Dedicated client for the breaker. Same physical Upstash database as
 * `ratelimit.ts` (the locked "do not provision a second store" constraint is
 * about the DATABASE, not the client object), but constructed here rather than
 * imported: `ratelimit.ts` does not export its singleton, and importing it
 * would drag `next/server` plus fifteen limiter constructions into every module
 * that touches the seam (research §7.4).
 */
const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? Redis.fromEnv()
    : null;

if (!redis) {
  // Unconfigured notice — ONE unconditional warning at module load, never per
  // request, and never escalated to an error.
  //
  // This is a DOUBLE inversion of the limiter's policy and both halves are
  // intentional. The limiter defers its notice inside a production-only branch
  // and then fails CLOSED in production; the breaker warns once unconditionally
  // and fails OPEN in ALL environments, production included. A limiter whose
  // store is missing silently removes a regulatory cap, so it should be loud
  // and refuse traffic. A breaker whose store is missing is simply absent — and
  // a breaker that refuses traffic because of its own misconfiguration is
  // strictly worse than having no breaker at all (SEAM-03). There is therefore
  // no environment branch here, and none anywhere else in this module.
  console.warn(
    "[resilient-fetch] Upstash not configured — the Railway circuit breaker is disabled (all seam calls pass through).",
  );
}

/**
 * Failure counter, used inversely: `.limit()` is called ONLY on a failure, so
 * exhausting the allowance means "too many failures in the window" rather than
 * "too many requests".
 *
 * `analytics: false` sidesteps the dangling `pending` promise the Upstash
 * typings warn about on Vercel (the existing `checkLimit` never awaits it) and
 * keeps breaker counters out of the rate-limit analytics dashboard.
 * `prefix: "breaker"` is distinct from the limiter's "quantalyze" so the two
 * keyspaces can never collide.
 */
const breakerLimiter = redis
  ? new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(BREAKER_FAILURE_THRESHOLD, BREAKER_WINDOW),
      analytics: false,
      prefix: "breaker",
    })
  : null;

/**
 * Is the Railway circuit currently open?
 *
 * EVERY exit path returns a value and nothing throws — that is the SEAM-03
 * contract, not an implementation detail. Unconfigured store, a `get` that
 * rejects, a malformed value: all resolve to `{ open: false }` so the caller
 * proceeds to the real request. The breaker can only ever REMOVE protection
 * when it is unhealthy; it can never itself deny traffic for that reason.
 */
export async function isBreakerOpen(): Promise<{
  open: boolean;
  retryAfterS?: number;
}> {
  if (!redis) return { open: false };
  try {
    const state = await redis.get<string>(BREAKER_KEY);
    if (state !== "open") return { open: false };
    const ttl = await redis.ttl(BREAKER_KEY);
    return { open: true, retryAfterS: ttl > 0 ? ttl : DEFAULT_RETRY_AFTER_S };
  } catch (err) {
    console.error(
      "[resilient-fetch] breaker check failed — failing OPEN:",
      err,
    );
    return { open: false };
  }
}

/**
 * Record ONE infrastructure failure and trip the circuit if the allowance for
 * `BREAKER_WINDOW` is now exhausted.
 *
 * Called only from the engine's classified failure arms (timeout, network
 * throw, 5xx) — never for a 4xx. See `resilientFetch` for that rationale.
 *
 * The whole body is swallowed on error: this runs INSIDE the caller's catch
 * arm, so a throw here would replace the real upstream error with a breaker
 * bookkeeping error. Never log request bodies or header values from this
 * module — the seam carries raw exchange API secrets and INTERNAL_API_TOKEN.
 */
export async function recordSeamFailure(): Promise<void> {
  if (!redis || !breakerLimiter) return;
  try {
    const { success, remaining } = await breakerLimiter.limit(
      `${BREAKER_KEY}:failures`,
    );
    // A sliding window of N ALLOWS the Nth call (leaving `remaining === 0`) and
    // denies the (N+1)th. The breaker must open ON the threshold-th failure,
    // not one failure later, so exhaustion counts as a trip signal alongside
    // outright denial.
    if (success && remaining > 0) return;
    // `nx: true` makes concurrent trips idempotent: the first writer's TTL
    // stands, so a second instance tripping 200ms later cannot ratchet the
    // cooldown window open. Benign race, deliberately not serialised with Lua.
    await redis.set(BREAKER_KEY, "open", {
      ex: BREAKER_COOLDOWN_S,
      nx: true,
    });
  } catch (err) {
    console.error(
      "[resilient-fetch] failed to record seam failure — breaker state may be stale:",
      err,
    );
  }
}
