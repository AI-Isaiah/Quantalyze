import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { CircuitOpenError, SeamBodyReadError } from "./seam-errors";

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
 * `CircuitOpenError` and `SeamBodyReadError` are defined in the dependency-free
 * leaf `./seam-errors` so client-bundle-reachable code (`wizardErrors.ts` → ten
 * `"use client"` components) and wholesale-mocked route tests can both branch on
 * them. They are re-exported here so server-side callers already importing the
 * core do not need a second import; the class identities are the leaf's,
 * singular.
 *
 * ⚠️ `@/lib/seam-errors` REMAINS THE CANONICAL IMPORT PATH, and every production
 * site imports from there. This alias exists for ergonomics only. Both classes
 * are thrown BY this module, which is why both appear here: an asymmetry would
 * read as meaningful and would invite a reader to "fix" it in the wrong
 * direction — importing the leaf's class from the CORE inside a
 * `"use client"`-reachable module and dragging `@upstash/redis` into the browser
 * bundle, which is the exact thing the leaf exists to prevent.
 */
export { CircuitOpenError, SeamBodyReadError };

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

// ---------------------------------------------------------------------------
// SEAM-01 — the engine
// ---------------------------------------------------------------------------

/**
 * Base URL of the Railway analytics service.
 *
 * This module is the ONLY legal home for it after Phase 140: both clients read
 * their own copy today, and the third seam plus the dormant handler each hard-
 * coded a fourth and fifth. Centralising it here is what the Wave-4
 * `no-raw-analytics-fetch` ESLint rule keys on — a raw `fetch()` against this
 * env var outside the core is how a sixth seam appears with no timeout and no
 * breaker, exactly as the third one did.
 */
const ANALYTICS_URL =
  process.env.ANALYTICS_SERVICE_URL ?? "http://localhost:8002";

/** `RequestInit` minus `signal` (the core owns the deadline), plus an escape hatch. */
export type ResilientFetchInit = Omit<RequestInit, "signal"> & {
  /**
   * Override the table's budget for this ONE call. Intended for tests and for
   * a caller that legitimately knows better; routine tuning belongs in
   * `SEAM_BUDGETS`, not at the call site — scattered budgets are the drift
   * SEAM-02 exists to end.
   */
  timeoutMsOverride?: number;
};

/**
 * A caller or configuration fault detected BEFORE the classification window.
 *
 * Deliberately NOT homed in the dependency-free leaf: nothing catches this by
 * type, it is never rendered, and it can only be produced by a call-site bug or
 * a deployment misconfiguration. Adding it to the leaf would widen a surface
 * whose every member is browser-reachable and mock-surviving, for no reader.
 *
 * What it exists to separate: an invalid `timeoutMsOverride` and a malformed
 * base URL both used to fail INSIDE the try — the override synchronously at
 * `AbortSignal.timeout()`, the URL as a `fetch` REJECTION — so both were logged
 * as "network failure reaching the analytics service" and both counted toward
 * the breaker. Five of either in a 30s window opened the global circuit from a
 * config typo, with the log pointing ops at Railway.
 */
export class SeamConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SeamConfigError";
  }
}

/**
 * Bounds for `timeoutMsOverride`, validated at function entry.
 *
 * The ceiling is the Vercel function ceiling every seam route declares
 * (`SEAM_ROUTE_BUDGETS.expectedMaxDurationS` = 300s): a deadline beyond the
 * lambda's own ceiling can never fire, so the request is unbounded in practice
 * and the SC-4b headroom invariant is violated by construction. The floor is
 * 1ms — `0` is not "no timeout", it is a deadline that fires immediately.
 */
const MIN_TIMEOUT_MS = 1;
const MAX_TIMEOUT_MS = 300_000;

/**
 * The closed surface every seam call site uses on the value the core returns —
 * enumerated by reading all five, not guessed.
 *
 * Each member is spelled as `Response["…"]` so a real `Response` remains
 * assignable to this type: route tests that stub the core with `new Response()`
 * keep type-checking, and the wrapper below can only ever narrow the surface,
 * never widen it. `json()` and `text()` are the INSTRUMENTED reads — see
 * `instrumentBody`.
 */
export interface SeamResponse {
  readonly ok: Response["ok"];
  readonly status: Response["status"];
  readonly statusText: Response["statusText"];
  readonly headers: Response["headers"];
  json: Response["json"];
  text: Response["text"];
}

/**
 * Is this rejection the wall-clock deadline firing?
 *
 * ONE definition, used by both the transport arm and the body-read arm, because
 * two copies drifted once already: the transport arm tested `err instanceof
 * Error` alone, which is correct on Node (whose `DOMException` extends `Error`)
 * and WRONG under jsdom (whose `DOMException` does not) — so every timeout in
 * the vitest environment was logged as a network failure. Only the log line
 * differed, which is exactly why it survived: no assertion could see it.
 */
function isDeadlineError(err: unknown): boolean {
  return (
    (err instanceof Error || err instanceof DOMException) &&
    (err.name === "AbortError" || err.name === "TimeoutError")
  );
}

/**
 * Wrap a settled `Response` so its body reads run INSIDE the classification
 * window (SEAMCORE-02 / ROADMAP SC1).
 *
 * WHY THE CORE OWNS THE READ. `AbortSignal.timeout` aborts the response STREAM,
 * not just the header exchange. For the modal Railway degradation — headers
 * fast, body slow — `fetch` RESOLVES, so the transport `try` closes and the
 * rejection happens later inside the caller's `res.json()`. Before this wrapper
 * the breaker was never told, and the raw `DOMException` escaped past every
 * client's `instanceof` ladder.
 *
 * WHY A WRAPPER RATHER THAN A CALLBACK. The rejected alternatives were a
 * `readBody` callback parameter or an exported `recordBodyReadFailure()` the
 * caller invokes — convention, not mechanism, and a caller who forgets is
 * silently back to today's behaviour. A returned object whose ONLY body methods
 * are the instrumented ones has no uninstrumented path to reach. It also avoids
 * making the core decide the PARSE shape, which would collide with SEAMCORE-01's
 * requirement that the breaker verdict be decidable from the status line alone,
 * before any body is read.
 */
function instrumentBody(
  res: Response,
  budgetKey: SeamBudgetKey,
  timeoutMs: number,
): SeamResponse {
  let bodyConsumed = false;

  async function read<T>(readBody: () => Promise<T>): Promise<T> {
    if (bodyConsumed) {
      // A SECOND read of the same body is a CALLER fault — the same one a raw
      // `Response` reports as "Body is unusable". Delegate so the shape is
      // unchanged, and record NOTHING: attributing a call-site bug to Railway
      // is the A-22 defect wearing different clothes.
      return readBody();
    }
    bodyConsumed = true;
    try {
      return await readBody();
    } catch (err) {
      // A PARSE failure is not a TRANSPORT failure, and conflating them would
      // rebuild the A-22 defect inside the fix: an upstream that answers 503
      // with an empty body or a `text/plain` traceback is Railway REPLYING, not
      // Railway failing to reply. `res.json()` does two things — read the bytes
      // and parse them — and only the first is this window's business.
      // `SyntaxError` is the only shape the parse half produces (undici reports
      // an aborted read as a DOMException and a dropped connection as a
      // TypeError), so it is rethrown RAW: callers' existing
      // `.catch(() => fallback)` arms keep seeing exactly what they saw before,
      // and the breaker hears nothing.
      if (err instanceof SyntaxError) {
        throw err;
      }
      const deadlineExceeded = isDeadlineError(err);
      // The budget key is logged, never the path, body or header values — the
      // seam carries raw exchange credentials and INTERNAL_API_TOKEN.
      console.error(
        deadlineExceeded
          ? `[resilient-fetch] ${budgetKey}: deadline exceeded after ${timeoutMs}ms while reading the response body`
          : `[resilient-fetch] ${budgetKey}: response body read failed`,
      );
      // AWAITED INLINE, exactly like the transport arm. A "record in the
      // background so we don't add latency" IIFE is orphaned by Fluid Compute
      // freeze, so the breaker would never arm during precisely the correlated
      // incident it exists for (TRAP-7).
      await recordSeamFailure();
      // THROWS, and must keep throwing. `keys/[id]/permissions` runs its seam
      // call inside an `unstable_cache` callback and depends on the throw to
      // leave NO cache entry; returning the failure as a VALUE would cache a
      // 503 for 60s against a 30s breaker cooldown — the mitigation becoming
      // the outage (T-140-32).
      throw new SeamBodyReadError(deadlineExceeded, err);
    }
  }

  return {
    get ok() {
      return res.ok;
    },
    get status() {
      return res.status;
    },
    get statusText() {
      return res.statusText;
    },
    get headers() {
      return res.headers;
    },
    json: () => read(() => res.json()),
    text: () => read(() => res.text()),
  };
}

/**
 * The ONE way to call the Railway analytics service.
 *
 * Sequence: caller/config validation → breaker check → budgeted fetch →
 * classified failure recording → INSTRUMENTED body read.
 *
 * "Classified" now covers the whole request lifecycle, which is the SEAMCORE-02
 * correction: the transport arm (deadline or connection failure), the `>= 500`
 * status arm, AND the body read, which `AbortSignal.timeout` can abort long
 * after `fetch` itself has resolved. Before this, the docblock claimed a
 * sequence the module did not implement — the body-read window was outside the
 * try, so the modal Railway degradation recorded nothing.
 *
 * Validation comes FIRST and deliberately sits outside the window: an invalid
 * `timeoutMsOverride` or a malformed `ANALYTICS_SERVICE_URL` is a caller or
 * deployment fault, and counting it as Railway degradation is how a config typo
 * opens the global breaker permanently.
 *
 * ⚠️ CALL ORDER RELATIVE TO AUTH. This must be invoked from INSIDE a route
 * handler body, AFTER that handler's `withAuth` / `isAdminUser` / `CRON_SECRET`
 * gate. Hoisting the breaker check above the auth gate — or into middleware —
 * would turn breaker state into an unauthenticated oracle. Middleware also runs
 * before routing and cannot know the call site's budget, which is the second
 * reason the check lives here and is per-call.
 *
 * Errors: throws `SeamConfigError` for a caller/config fault (before any store
 * or network I/O); throws `CircuitOpenError` when the circuit is open;
 * otherwise rethrows whatever `fetch` threw, UNWRAPPED. A body read that fails
 * throws `SeamBodyReadError` — the ONE place the core wraps rather than
 * rethrows, because the raw rejection arrives after every client's transport
 * `instanceof` ladder has already been passed. Non-2xx responses are RETURNED,
 * not thrown — status interpretation is the caller's contract, and only the
 * caller knows whether a 404 is an error or an expected empty result.
 */
export async function resilientFetch(
  budgetKey: SeamBudgetKey,
  path: string,
  init: ResilientFetchInit = {},
): Promise<SeamResponse> {
  const { timeoutMsOverride, ...requestInit } = init;

  // ── ABOVE THE WINDOW ────────────────────────────────────────────────────
  // Everything from here to the `try` is a CALLER or CONFIG fault if it fails,
  // and none of it may be recorded as Railway degradation (A-22 / A-28).

  // A-28. `AbortSignal.timeout()` itself rejects these — NaN and a non-number
  // with a TypeError, a negative or absurd value with a RangeError — and it
  // used to do so from INSIDE the try. Validate at entry instead, and name the
  // offending value: it is a number the caller passed, never a secret.
  if ("timeoutMsOverride" in init) {
    if (
      typeof timeoutMsOverride !== "number" ||
      !Number.isFinite(timeoutMsOverride) ||
      timeoutMsOverride < MIN_TIMEOUT_MS ||
      timeoutMsOverride > MAX_TIMEOUT_MS
    ) {
      throw new SeamConfigError(
        `[resilient-fetch] ${budgetKey}: invalid timeoutMsOverride ${String(timeoutMsOverride)} — expected a finite number of milliseconds between ${MIN_TIMEOUT_MS} and ${MAX_TIMEOUT_MS}`,
      );
    }
  }
  const timeoutMs = timeoutMsOverride ?? SEAM_BUDGETS[budgetKey].timeoutMs;

  // A-22. Hoisting the template alone is NOT sufficient: a malformed base URL
  // does not throw here, it makes `fetch` REJECT — landing in the transport
  // catch below, logged as "network failure reaching the analytics service" and
  // counted, so five requests opened the global breaker from a config typo.
  // Construct and validate eagerly instead. The env var NAME is logged, never
  // its value: a base URL can legitimately carry userinfo.
  const requestUrl = `${ANALYTICS_URL}${path}`;
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(requestUrl);
  } catch {
    console.error(
      `[resilient-fetch] ${budgetKey}: CONFIG fault — ANALYTICS_SERVICE_URL is not a usable base URL. This is a deployment misconfiguration, NOT an analytics-service failure.`,
    );
    throw new SeamConfigError(
      "[resilient-fetch] ANALYTICS_SERVICE_URL is not a usable base URL",
    );
  }
  // `new URL("localhost:8002/x")` PARSES — protocol "localhost:" — so a
  // parse-only guard would pass the single most likely typo (a missing scheme)
  // straight through to a fetch rejection and back into the network arm.
  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    console.error(
      `[resilient-fetch] ${budgetKey}: CONFIG fault — ANALYTICS_SERVICE_URL has an unusable protocol. This is a deployment misconfiguration, NOT an analytics-service failure.`,
    );
    throw new SeamConfigError(
      "[resilient-fetch] ANALYTICS_SERVICE_URL has an unusable protocol",
    );
  }

  const breaker = await isBreakerOpen();
  if (breaker.open) {
    throw new CircuitOpenError(breaker.retryAfterS ?? DEFAULT_RETRY_AFTER_S);
  }

  // Constructed after the breaker check so the budget covers the REQUEST, not
  // the store round-trip that decides whether to make one.
  const deadline = AbortSignal.timeout(timeoutMs);

  // ── THE CLASSIFICATION WINDOW ───────────────────────────────────────────
  let res: Response;
  try {
    // Headers, body, and cache pass through byte-for-byte. A dropped
    // `Authorization` turns a working call into a 401 the breaker would then
    // count as degradation, and a dropped `X-Service-Key` silently
    // unauthenticates every analytics call. (`X-User-Id` is forwarded too, but
    // it is UNSIGNED client input and is deliberately NOT what the Python
    // limiter buckets on — the signed `X-Tenant-Claim` is. An earlier comment
    // here claimed dropping `X-User-Id` re-opens the CT-4 cross-tenant
    // rate-limit defect; that is false, and a false claim that plausibly masks
    // a real defect is worth the line to correct.)
    res = await fetch(requestUrl, {
      ...requestInit,
      // A-23, and it outranks the call site deliberately: `follow` is the
      // platform default, so a caller spreading a stored init could restore the
      // old behaviour by accident rather than by decision. Across a
      // cross-origin 302 Node strips `Authorization` but forwards
      // `X-Service-Key`, `X-Internal-Token` and `X-User-Access-Token`
      // VERBATIM — this seam carries all three. It also removes the "up to 20
      // hops silently consume the budget" problem.
      redirect: "error",
      signal: deadline,
    });
  } catch (err) {
    // Both failure classes count toward the breaker: the deadline fired, or the
    // connection never completed. The name test is deliberately the BROADER of
    // the two shapes in the repo — analytics-client's `err instanceof
    // DOMException && name === "TimeoutError"` misses a plain `AbortError`,
    // which would then be misreported as "service not reachable". Only the log
    // line differs; the budget key is logged, never the path, body, or headers
    // (the seam carries raw exchange credentials and INTERNAL_API_TOKEN).
    const deadlineExceeded = isDeadlineError(err);
    console.error(
      deadlineExceeded
        ? `[resilient-fetch] ${budgetKey}: deadline exceeded after ${timeoutMs}ms`
        : `[resilient-fetch] ${budgetKey}: network failure reaching the analytics service`,
    );
    await recordSeamFailure();
    // Rethrow the ORIGINAL error. Both clients map `err.name` onto their own
    // typed errors (AnalyticsTimeoutError / UPSTREAM_TIMEOUT); wrapping here
    // would silently reclassify every timeout in the codebase.
    throw err;
  }

  if (res.status >= 500) {
    await recordSeamFailure();
  }
  // 4xx NEVER records. A user's bad API key returning 400 is Railway working
  // CORRECTLY — `create-with-key` and `composite/add-key` deliberately map that
  // to a client fault. Counting 4xx would let a handful of users fat-fingering
  // credentials trip the breaker and take key-connect down for everyone: a user
  // error must never become an outage. The accepted cost (A4, operator
  // decision) is that if Railway 4xxes during genuine degradation the breaker
  // under-trips.

  // The window does not close here. `instrumentBody` keeps `json()` and
  // `text()` inside it, which is what makes the docblock's "classified failure
  // recording" true for a stalling upstream (SEAMCORE-02 / SC1).
  return instrumentBody(res, budgetKey, timeoutMs);
}
