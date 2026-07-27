import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { CircuitOpenError, SeamBodyReadError } from "./seam-errors";
import { seamBreakerVerdict } from "./seam-discriminator";
import { scrubSeamError } from "./seam-redaction";

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
 * The RESIDUAL GLOBAL breaker key.
 *
 * ⚠️ It is no longer "the single breaker key shared by every seam call site" —
 * that shape is exactly obligation OB-8's harm (A-01: one MT5 gateway restart
 * denying every Deribit user, the optimizer and CSV finalize). Since plan
 * 140.2-06 a `503` records against `breaker:<dependency>` instead, and this key
 * carries only the failures that name NO dependency: a transport throw, a
 * deadline, a body-read abort, and any counting status whose dependency is
 * absent or outside the closed set. A connection that never completed names
 * nothing, and that IS genuine Railway degradation.
 *
 * MODULE CONSTANT — never interpolate user input into it (threat T-140-01).
 * A user-influenced breaker key is a trivial cross-tenant denial of service:
 * one caller could mint a key that trips the breaker for a cohort, or (worse)
 * shard the breaker so it never trips at all. Every derived per-dependency key
 * is built from the frozen closed set inside `./seam-discriminator`, never from
 * a value read off the wire.
 */
export const BREAKER_KEY = "breaker:railway";

/**
 * The closed SERVICE-dependency vocabulary (`STATUS_CONTRACT.md` §4) — the only
 * values that may become a breaker key.
 *
 * Hand-typed HERE, deliberately duplicating the frozen set inside
 * `./seam-discriminator` and `SERVICE_DEPENDENCIES` in
 * `analytics-service/services/error_contract.py`. Two independently typed
 * vocabularies asserted equal in `seam-constants.pin.test.ts` is what makes the
 * duplication safe: either side may change, but not both silently. Importing the
 * leaf's set instead would give the core no way to disagree with it.
 *
 * ⚠️ A `424`'s `dependency` is the CALLER'S VENUE (`binance`, `deribit`, …) and
 * is NOT in this set by construction. `error_contract._validate` refuses a `424`
 * naming one of ours and refuses a `>= 500` naming anything else, so a venue
 * name on a counting status is UNCONSTRUCTABLE upstream — and the leaf
 * membership-checks anyway.
 */
export type SeamServiceDependency =
  | "mt5-gateway"
  | "kek"
  | "supabase"
  | "egress-proxy";

/**
 * The breaker key for a service dependency.
 *
 * The prefix is a module constant and the argument is a member of a closed
 * union, so this cannot produce a caller-influenced key even by mistake.
 */
export function breakerKeyFor(dependency: SeamServiceDependency): string {
  return `breaker:${dependency}`;
}

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
 * short enough that a recovered service is picked back up within one user retry.
 *
 * ⚠️ THIS IS **NOT** THE RECOVERY LATENCY OF THE SYSTEM, AND THIS DOCBLOCK USED
 * TO SAY IT WAS. The claim was that because TTL expiry IS the half-open
 * transition (locked decision 3), 30 s "is the entire recovery latency". That is
 * false, and it was corrected against MEASUREMENT rather than the other way
 * round (`140.2-VALIDATION.md` §5).
 *
 * The counter is never cleared on a trip — `recordSeamFailure` writes only the
 * lock — so when the lock expires the previous epoch bucket is still carrying
 * weight, and whether ONE failure immediately re-trips depends on WHERE in that
 * bucket the original trip landed. Plan 140.2-01's R-7 case observed both
 * outcomes against real Redis, from two runs that waited the IDENTICAL 32 s:
 *
 *   | trip at position p | carry-over floor((1−p′)·5) | one failure at +32 s |
 *   |--------------------|---------------------------|----------------------|
 *   | 0.05               | 4  ⇒ remaining 0          | RE-TRIPS instantly   |
 *   | 0.50               | 2  ⇒ remaining 2          | does NOT re-trip     |
 *
 * **OBSERVED RECOVERY BAND: [30 s, 60 s], alignment-dependent** — that is
 * `[BREAKER_COOLDOWN_S, BREAKER_COOLDOWN_S + BREAKER_WINDOW]`. The lock's own
 * life is a flat 30 s (observed [29, 30]); the time until the seam actually
 * STAYS usable is up to twice that.
 *
 * The band is ACCEPTED, not a defect to fix here. The obvious remedy — clearing
 * the counter on trip via `resetUsedTokens` — is forbidden (TRAP-6): it is a
 * full-keyspace Lua `SCAN` against the database shared with fifteen production
 * limiters. R-7 pins the band so a future retune of either constant moves a
 * measured number rather than a wish.
 */
export const BREAKER_COOLDOWN_S = 30;

/**
 * How much longer the lock KEY survives than the lock it carries — the
 * TOMBSTONE — in seconds.
 *
 * Since plan 140.2-07 the expiry lives inside the VALUE, so "the key exists" and
 * "the circuit is open" are different questions: `isBreakerOpen` reports CLOSED
 * the moment the ENCODED expiry passes, whatever the key's own TTL says. Letting
 * the key outlive its lock is what makes the A-25 guard possible at all — it is
 * the only way `recordSeamFailure` can still learn WHEN the last lock was armed
 * after that lock has expired. With `ex: BREAKER_COOLDOWN_S` the expired lock is
 * simply gone, the question is unanswerable, and the encoding would be
 * decorative: the encoded expiry could never be in the past while the key still
 * existed.
 *
 * 60 s, because the guard must span the longest budget in `SEAM_BUDGETS`
 * (`process-key-sync`, 60 000 ms) measured from the instant a lock is armed:
 * `BREAKER_COOLDOWN_S + BREAKER_LOCK_TOMBSTONE_S = 90 s ≥ 60 s`, with the
 * cooldown itself absorbing the first 30. Pinned in
 * `seam-constants.pin.test.ts`, both as a literal and as that inequality.
 */
export const BREAKER_LOCK_TOMBSTONE_S = 60;

/**
 * Fallback `Retry-After` for a caller that has an open circuit but no hint.
 *
 * ⚠️ ITS ORIGINAL REASON IS GONE, AND THAT IS RECORDED RATHER THAN QUIETLY
 * REPURPOSED. This docblock used to name the A-24 race — "the key expired
 * between the `get` and the `ttl`, or the store returned -1/-2". Plan 140.2-07
 * removed that race structurally: there is no `ttl` call left, the expiry
 * arrives inside the value, and `isBreakerOpen` never reports `open: true`
 * without a positive `retryAfterS` derived from that same read.
 *
 * It is KEPT, not deleted, for one narrow and still-real job: `retryAfterS` is
 * OPTIONAL on the returned shape, `CircuitOpenError` takes a required number,
 * and `resilientFetch` must therefore have a total answer at that boundary.
 * Deleting the constant would replace a documented 30 with an `undefined`
 * flowing into a `Retry-After` header. Matching `BREAKER_COOLDOWN_S` keeps that
 * answer honest if it is ever reached.
 */
export const DEFAULT_RETRY_AFTER_S = 30;

/**
 * Retries performed by the core. ZERO in this phase, by design.
 *
 * Phase 141 raises this ONLY for calls the SEAM-05 idempotency audit
 * explicitly allowlists — replaying a non-idempotent `/process-key` would
 * double-enqueue a sync. It exists as a constant today so the SC-4b headroom
 * invariant `timeoutMs × callsPerRequest × (1 + retries) < maxDuration × 1000`
 * is assertable NOW, and so the assertion tightens automatically the moment
 * retries land rather than being written after the fact.
 *
 * ⚠️ SINCE 140.2-06 THIS IS THE SEED, NOT THE SOURCE OF TRUTH. Every
 * `SEAM_BUDGETS` row carries its own `retries`, seeded from here, and the SC-4b
 * arithmetic reads the ROW. Phase 141 therefore flips ONE row at a time —
 * replacing that row's `SEAM_RETRIES` with a literal — instead of moving every
 * route's worst-case lambda hold with a single edit. This export stays as the
 * seeded value and as the negative pin's subject; deleting it would leave the
 * thirteen rows with no shared statement of intent.
 */
export const SEAM_RETRIES = 0;

// ---------------------------------------------------------------------------
// SEAMCORE-03 — bounding the breaker's OWN store (A-04)
//
// Before these three, the client was a bare `Redis.fromEnv()` and therefore
// took the SDK defaults, read at source in
// `node_modules/@upstash/redis/chunk-2X4SLXT7.mjs`:
//
//   attempts = (config.retry?.retries ?? 5) and the loop is `i <= attempts`,
//   so SIX fetches; backoff = `Math.exp(i) * 50`, summing to ≈4 290 ms; and
//   `signal: undefined`, so NOT ONE of the six had a deadline.
//
// Fail-open covers REJECTIONS. A HANG is not a rejection, so a degraded Upstash
// held the lambda for as long as it liked — and none of that wall clock appeared
// in the SC-4b arithmetic, which summed only `timeoutMs × calls × (1 + retries)`.
// ---------------------------------------------------------------------------

/**
 * Wall-clock deadline handed to each breaker-store command.
 *
 * ⚠️ THE SDK EVALUATES THE FACTORY ONCE PER COMMAND, NOT ONCE PER ATTEMPT
 * (`chunk-2X4SLXT7.mjs`: `requestOptions` is built before the retry loop, with
 * `signal: isSignalFunction ? signal() : signal`). So this is a per-COMMAND
 * deadline that all of that command's attempts share, and the real worst case
 * for one command is closer to `TIMEOUT + one backoff` than to
 * `attempts × TIMEOUT`. The SC-4b arithmetic nonetheless charges
 * `attempts × TIMEOUT + retries × BACKOFF`, which OVER-states the cost — the
 * safe direction for a headroom assertion, and stated rather than implied.
 *
 * 2 000 ms sits an order of magnitude above Upstash's REST latency from Vercel
 * (tens of ms in-region, low hundreds cross-region). Setting it near that
 * latency would turn healthy round trips into aborts, and an aborted breaker
 * read fails OPEN — i.e. a too-tight deadline silently DISABLES the breaker
 * rather than tightening it.
 */
export const BREAKER_STORE_TIMEOUT_MS = 2_000;

/**
 * Retries per breaker-store command, on top of the first attempt.
 *
 * One, not the SDK's five. The store's failure mode is already benign in the
 * read direction (fail OPEN, the seam call proceeds), so buying resilience with
 * five extra attempts spends the lambda's budget to protect a lookup whose
 * failure costs nothing. It is a term in the SC-4b worst case, which is the
 * whole reason it is declared rather than defaulted.
 */
export const BREAKER_STORE_RETRIES = 1;

/**
 * Fixed pause between store attempts.
 *
 * FIXED rather than exponential, deliberately. The SDK default `Math.exp(i)*50`
 * is 50 ms at i=0 and 1 004 ms at i=3, so its contribution to a worst case
 * depends on the attempt index and cannot be stated as one number in the budget
 * arithmetic. A constant is the property SC-4b needs.
 */
export const BREAKER_STORE_BACKOFF_MS = 250;

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
 *
 * ── `dependencies` — the OB-8 declaration (added 140.2-06) ──────────────────
 *
 * The service dependencies this call site can legitimately be BLOCKED by. The
 * pre-fetch open-check reads exactly these keys plus the global one, in ONE
 * `mget`, so one dependency's trip can never suppress a call that cannot touch
 * it. Two alternatives were rejected by name and must not be re-introduced:
 *   · checking all four service keys always re-creates a partial A-01 — an
 *     `egress-proxy` trip would block `/api/simulator`, which cannot reach it;
 *   · a global check with per-dependency counters FAILS OB-8 outright, because
 *     one dependency's trip still suppresses everything. Ledger row M35 is that
 *     mutation, and the isolation case is its falsifier.
 *
 * ⚠️ EVERY ENTRY IS EVIDENCE, NOT INTUITION. Derived 2026-07-27 by enumerating
 * every `dependency=` argument in `analytics-service/routers/**` together with
 * the status it is raised at. Only a `503` counts, so only a `503` can ever open
 * a per-dependency key, and the whole reachable set today is:
 *
 *   | dependency  | status | site                                      | reached by            |
 *   |-------------|--------|-------------------------------------------|-----------------------|
 *   | mt5-gateway | 503    | `exchange.py:314,324` `_validate_mt5_key`  | POST /api/validate-key |
 *   | supabase    | 503    | `portfolio.py:684` `_compute_portfolio_analytics` | /api/portfolio-analytics |
 *   | supabase    | 503    | `match.py:1657,1691` `recompute`          | /api/match/recompute  |
 *
 * Every other `dependency=` site is a `500` (never counts — `internal.py:303,319`
 * and `exchange.py:626` name `kek`, `exchange.py:132` names `egress-proxy`,
 * `exchange.py:276,287` name `mt5-gateway`) or a `424` naming a VENUE
 * (`internal.py:498`, `exchange.py:547`). `breaker:kek` and
 * `breaker:egress-proxy` therefore cannot be opened by ANY site at HEAD, so
 * declaring them anywhere would declare a key that can never be set — noise that
 * reads as protection.
 *
 * ⚠️ THE TIE-BREAK, STATED. A stale or wrong declaration silently UNDER-protects,
 * and that is the direction chosen deliberately: under-protection is FAIL-OPEN,
 * which is this module's whole doctrine (a breaker that blocks traffic because
 * of its own bookkeeping has become the outage). OVER-declaration is the A-01
 * direction — the harm this plan exists to remove. So when in doubt, declare
 * fewer. The global key is in every check regardless, so a Railway-wide outage
 * still blocks every call site.
 *
 * Every row's declaration is pinned to a hand-typed literal in
 * `seam-constants.pin.test.ts`; that pin is the only thing that makes a stale
 * declaration falsifiable (ledger row M39).
 */
export const SEAM_BUDGETS: Record<
  SeamBudgetKey,
  {
    timeoutMs: number;
    /** Service dependencies whose open breaker may block THIS call site. */
    dependencies: readonly SeamServiceDependency[];
    /** Retries this call site performs. Phase 141 flips these, one row at a time. */
    retries: number;
    notes: string;
  }
> = {
  "validate-key": {
    timeoutMs: 30_000,
    // exchange.py:314,324 raise service_error(503, dependency="mt5-gateway")
    // from _validate_mt5_key, reached by POST /api/validate-key. The sFOX and
    // ccxt arms of the same endpoint answer 500 (egress-proxy) or 424 (venue),
    // neither of which counts, so neither is declared.
    dependencies: ["mt5-gateway"],
    retries: SEAM_RETRIES,
    notes:
      "Live exchange auth probe — genuinely slow and venue-variable (Deribit, Binance, OKX all differ). Was the analytics-client 30s default.",
  },
  "encrypt-key": {
    timeoutMs: 30_000,
    // exchange.py:626 is a 500 naming `kek` — SERVICE-PERMANENT, never counts,
    // so `breaker:kek` cannot be open and declaring it would be decorative.
    dependencies: [],
    retries: SEAM_RETRIES,
    notes:
      "Same live-exchange probe class as validate-key; always runs sequentially after it, so the two budgets sum per request.",
  },
  bridge: {
    timeoutMs: 15_000,
    dependencies: [],
    retries: SEAM_RETRIES,
    notes:
      "Weighted-covariance compute. Was hardcoded at analytics-client.ts:260.",
  },
  simulator: {
    timeoutMs: 15_000,
    dependencies: [],
    retries: SEAM_RETRIES,
    notes:
      "Portfolio impact simulator compute. Was hardcoded at analytics-client.ts:285.",
  },
  "portfolio-optimizer": {
    timeoutMs: 15_000,
    dependencies: [],
    retries: SEAM_RETRIES,
    notes:
      "Heavy compute. Was OPTIMIZER_TIMEOUT_MS declared inside the route rather than the client — the budget-ownership split this table exists to end.",
  },
  "optimize-weights": {
    timeoutMs: 30_000,
    dependencies: [],
    retries: SEAM_RETRIES,
    notes: "Scenario composer optimizer. Was the analytics-client 30s default.",
  },
  "match-eval": {
    timeoutMs: 30_000,
    // match.py's 503 supabase arms are inside `recompute`, not the eval sweep.
    dependencies: [],
    retries: SEAM_RETRIES,
    notes:
      "Admin eval sweep; can be slow at large lookback_days. Was the 30s default.",
  },
  "match-recompute": {
    timeoutMs: 30_000,
    // match.py:1657,1691 raise service_error(503, dependency="supabase").
    dependencies: ["supabase"],
    retries: SEAM_RETRIES,
    notes: "Admin match engine, heavy compute. Was the 30s default.",
  },
  "portfolio-analytics": {
    timeoutMs: 30_000,
    // portfolio.py:684 raises service_error(503, dependency="supabase"). M-5,
    // recorded and NOT gated on: this budget's only TypeScript wrapper
    // (computePortfolioAnalytics) has ZERO callers, so the arm is LATENT rather
    // than live. It becomes live the moment anyone calls that wrapper, which is
    // why the declaration is written now rather than discovered later.
    dependencies: ["supabase"],
    retries: SEAM_RETRIES,
    notes:
      "ZERO CALLERS TODAY — computePortfolioAnalytics (analytics-client.ts:224) is unreachable (research §4.2). Kept rather than deleted: deleting is scope creep and it is a plausible future caller. Phase 141's idempotency audit records 'no callers' for it.",
  },
  "process-key-enqueue": {
    timeoutMs: 15_000,
    dependencies: [],
    retries: SEAM_RETRIES,
    notes:
      "flow_type in {resync, onboard}: the server merely enqueues onto the worker dyno and returns 202 (verified in analytics-service/routers/process_key.py:_is_long_fetch). An enqueue that takes 15s means Railway is sick. Tightened from the blanket 60s; nothing observes these two budgets (research §6.4).",
  },
  "process-key-sync": {
    timeoutMs: 60_000,
    // The public lead-generating teaser reaches this budget ANONYMOUSLY
    // (verify-strategy). Declaring nothing keeps an unauthenticated caller's
    // blast radius at the global key alone, and no /process-key site raises a
    // counting 503 naming a dependency at HEAD.
    dependencies: [],
    retries: SEAM_RETRIES,
    notes:
      "flow_type in {teaser, csv}: the full 5-method pipeline runs INLINE. MEASURE BEFORE TIGHTENING — the only latency evidence is a code comment (~10-25s typical, process-key-client CT-7); never guess a budget on the public lead-generating teaser path.",
  },
  "keys-permissions": {
    timeoutMs: 15_000,
    // internal.py:303,319 are 500s naming `kek`; internal.py:498 is a 424
    // naming a VENUE. No counting 503 exists on this endpoint.
    dependencies: [],
    retries: SEAM_RETRIES,
    notes:
      "The third Railway seam (/internal/keys/{id}/permissions). Replaces two duplicated AbortSignal.timeout(15_000) constants in keys/[id]/permissions/route.ts and finalize-wizard's fetchLivePermissions.",
  },
  "process-key-unified-dormant": {
    timeoutMs: 60_000,
    dependencies: [],
    retries: SEAM_RETRIES,
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
 *
 * `branch` (optional, plan 140.2-10 / A-29) names a MUTUALLY EXCLUSIVE path
 * through the route. The invariant sums within a branch and takes the MAXIMUM
 * across branches; a leg with no `branch` is spent whichever way the request
 * goes, so an unlabelled row is one implicit branch — the plain sum, which is
 * what fourteen of these fifteen rows are.
 *
 * It exists because summing legs from different branches describes a path no
 * request takes. `finalize-wizard` is the case: its composite branch re-probes
 * every member key and then returns through `runLegacyFinalize`, whose enqueue
 * is a Supabase RPC and NOT a seam call, so it spends ZERO
 * `process-key-enqueue`; its single-key branch probes once and then spends the
 * enqueue. Before this labelling the row silently described the single-key path
 * only, and the composite fan-out — the branch that can actually reach the
 * function ceiling — was not modelled at all.
 */
export const SEAM_ROUTE_BUDGETS: Record<
  string,
  {
    expectedMaxDurationS: number;
    budgets: Array<{ key: SeamBudgetKey; calls: number; branch?: string }>;
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
  // TWO EXCLUSIVE BRANCHES, and the row must not be read as their sum.
  //
  //   composite  (strategies.api_key_id IS NULL and >=1 strategy_keys member):
  //              one cache-bypassing scope-broadening probe PER MEMBER, in
  //              sequence, then `runLegacyFinalize`. Its stitch_composite
  //              enqueue is a Supabase RPC, so this branch never spends
  //              `process-key-enqueue`. The `calls` below is the route's
  //              `MAX_COMPOSITE_MEMBERS` cap — the two numbers are bound to
  //              each other by `seam-budgets.invariant.test.ts`, which reads
  //              the constant from the route file on disk.
  //   single-key (strategies.api_key_id IS NOT NULL): ONE probe for that key,
  //              then the unified arm's `/process-key` enqueue.
  //
  // A strategy cannot be both: a composite's api_key_id is NULL by
  // construction and the hoist that fans out is scoped to exactly that.
  "src/app/api/strategies/finalize-wizard/route.ts": {
    expectedMaxDurationS: 300,
    budgets: [
      { key: "keys-permissions", calls: 10, branch: "composite" },
      { key: "keys-permissions", calls: 1, branch: "single-key" },
      { key: "process-key-enqueue", calls: 1, branch: "single-key" },
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
 *
 * ⚠️ BOUNDED, AND THE `signal` IS A FACTORY (SEAMCORE-03 / A-04). `fromEnv`
 * spreads its config into the constructor, which forwards `retry` and `signal`
 * straight to the HttpClient — so this is a CONFIG change, not a rewrite.
 *
 * THE FACTORY FORM IS CHOSEN, and both reasons are read at source in
 * `@upstash/redis/chunk-2X4SLXT7.mjs`:
 *
 *  1. `signal: isSignalFunction ? signal() : signal` is evaluated once per
 *     `request()`. A single `AbortSignal` INSTANCE would therefore be
 *     already-aborted on the second store command, aborting every command after
 *     the first.
 *  2. THE ABORT SEMANTICS DIFFER. In the catch arm, `if (signal?.aborted &&
 *     isSignalFunction) throw error_;` — the factory form RETHROWS. The plain
 *     form takes the `else` branch and fabricates `new Response(blob, { status:
 *     200 })` whose body is `signal.reason ?? "Aborted"`. That fabricated 200
 *     would make an aborted `mget` look like a SUCCESSFUL read of values that
 *     are not locks (harmlessly fail-open) and an aborted `set` look like a lock
 *     that was WRITTEN — an unarmed breaker reported as armed, silently. The
 *     read direction's wrong answer is this module's doctrine; the write
 *     direction's is a lie. A rethrow gives both arms the truth and lets each
 *     decide, which is why the default is not allowed to choose.
 */
const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? Redis.fromEnv({
        retry: {
          retries: BREAKER_STORE_RETRIES,
          backoff: () => BREAKER_STORE_BACKOFF_MS,
        },
        signal: () => AbortSignal.timeout(BREAKER_STORE_TIMEOUT_MS),
      })
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
 *
 * ⚠️ `ephemeralCache` IS DELIBERATELY LEFT AT ITS DEFAULT, and that default is a
 * LIVE in-memory `Map` — discovered by the real-Redis lane in plan 140.2-01 and
 * previously undocumented here. `@upstash/ratelimit@2.0.8` builds one whenever
 * the option is omitted (`dist/index.mjs:757-761`); on a DENIED `limit()` it
 * calls `ctx.cache.blockUntil(identifier, reset)` (`:1580-1585`) and every later
 * call for that identifier short-circuits IN MEMORY with `reason: "cacheBlock"`,
 * never reaching Redis until the bucket ends (`:1560-1569`).
 *
 * Three reasons it stays (140.2-06 decision, recorded rather than inherited):
 *   1. The block is keyed by IDENTIFIER, and identifiers are now per-dependency.
 *      So the in-process suppression became per-dependency at the same moment
 *      the counters did — it now AGREES with OB-8 instead of cutting across it.
 *      Under the old single global identifier one denial muted the instance's
 *      counting for everything.
 *   2. It can only ever suppress counting AFTER a denial, and a denial can only
 *      happen once the threshold is already exceeded — i.e. after that key's
 *      circuit has tripped. It cannot cause an under-trip, and the trip itself
 *      is a direct `redis.set` outside the limiter, so it still lands.
 *   3. Setting `ephemeralCache: false` is a semantic change to the DEPLOYED
 *      breaker: it re-arms a Redis round trip per failure during precisely the
 *      correlated incident the breaker exists for, and it would invalidate the
 *      drain machinery R-3/R-6/R-7 are built on. That belongs to a plan that
 *      owns the breaker's timing behaviour, not to this one.
 *
 * The binding consequence for any future edit: NOTHING in this module may assume
 * `recordSeamFailure` performs a Redis round trip.
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
 * The breaker keys a given call site can be blocked by: the dependencies its
 * budget row DECLARES, then the residual global key.
 *
 * ORDER IS THE `retryAfterS` TIE-BREAK and nothing else. When two of these are
 * open simultaneously the first match wins and its TTL becomes the hint. The
 * dependency keys come first deliberately: a per-dependency lock is the more
 * specific fact, and its cooldown is the one that will actually clear this call
 * site. Advertising a shorter wait than the true one is the safe direction — the
 * caller retries early and gets another `CircuitOpenError`; the reverse would
 * park a user for longer than necessary.
 */
function breakerKeysFor(budgetKey: SeamBudgetKey): string[] {
  return [...SEAM_BUDGETS[budgetKey].dependencies.map(breakerKeyFor), BREAKER_KEY];
}

/**
 * The stored form of a breaker lock: `open:<armedAtMs>:<expiresAtMs>`, both in
 * epoch milliseconds.
 *
 * ⚠️ THE EXPIRY IS IN THE VALUE, AND THAT IS THE WHOLE OF THE A-24 FIX. Before
 * plan 140.2-07 the value was the bare string `"open"` and the expiry came from
 * a SECOND call (`ttl`) — two facts that could disagree in two different ways,
 * both of them live:
 *   · the lock could expire BETWEEN the two reads, so the hint fell back to the
 *     default while the function still returned open, and a recovered Railway
 *     was denied for another whole cooldown; and
 *   · the second call could REJECT after the first had already returned open,
 *     and the catch arm then reported CLOSED — discarding a KNOWN-open state,
 *     precisely the case the fallback existed for.
 * Neither is defended against with a branch. Both are gone because there is no
 * second call: one read decides open/closed AND carries the hint.
 *
 * `armedAt` is STORED rather than derived from `expiresAt − BREAKER_COOLDOWN_S`.
 * It is what the A-25 guard compares an admission instant against, and deriving
 * it would silently re-point that guard the moment the cooldown were retuned
 * between the write and the read.
 *
 * The format is deliberately not JSON. `@upstash/redis` deserialises
 * automatically, so a JSON value would come back as an object through one code
 * path and as a string through another depending on the command; a scalar that
 * `JSON.parse` rejects always arrives as the string that was written.
 */
export function encodeBreakerLock(
  armedAtMs: number,
  expiresAtMs: number,
): string {
  return `open:${armedAtMs}:${expiresAtMs}`;
}

/**
 * Parse a stored breaker lock, or `null` if the value is not one.
 *
 * ⚠️ AN UNPARSEABLE VALUE IS `null`, AND `null` READS CLOSED. That is the
 * fail-FORWARD direction locked decision 4 mandates: a corrupt byte in a store
 * shared with fifteen production limiters must not be able to deny the whole
 * seam. It has one known cost, stated rather than discovered later — across a
 * rolling deploy an instance still running the pre-140.2-07 code writes the bare
 * `"open"`, which new instances ignore. That is at most one cooldown of
 * under-protection at a deploy boundary, in the direction this module always
 * errs.
 */
export function decodeBreakerLock(
  value: unknown,
): { armedAtMs: number; expiresAtMs: number } | null {
  if (typeof value !== "string") return null;
  const parsed = /^open:(\d+):(\d+)$/.exec(value);
  if (!parsed) return null;
  return { armedAtMs: Number(parsed[1]), expiresAtMs: Number(parsed[2]) };
}

// ---------------------------------------------------------------------------
// SEAMCORE-06 — the breaker's transitions are OBSERVABLE
//
// The breaker has never emitted a transition event. Store state answered "is
// this circuit open right now"; nothing answered "when did it open, which
// dependency, and how many failures caused it" — which is the whole of an
// operator's question during an incident, and part of why A-01 (one dependency
// denying every call site) took so long to attribute.
// ---------------------------------------------------------------------------

/**
 * The transition event's payload. FOUR FIELDS, AND THAT IS A CEILING.
 *
 * `recordSeamFailure`'s constraint stays in force verbatim: never log a request
 * body or a header value from this module, because the seam carries raw exchange
 * API secrets and `INTERNAL_API_TOKEN`. There is no path here either — a breaker
 * key is a module-derived value from a frozen closed set (threat T-140-01),
 * whereas a path is caller input. `resilient-fetch.test.ts` asserts the key set
 * EXACTLY, so a future field carrying request detail reddens rather than ships.
 */
interface SeamBreakerTransition {
  /** The circuit that moved. Per-dependency since 140.2-06. */
  breakerKey: string;
  /** Failures counted in the window at the moment of the trip. */
  failures: number;
  /** The lock's own cooldown, read from the lock rather than from the constant. */
  cooldownS: number;
  /** Correlates an open with the close of the SAME lock. */
  correlationId: string;
}

/**
 * Emit one transition.
 *
 * A PLAIN STRUCTURED LOG, deliberately — it performs no I/O, so there is nothing
 * to await and TRAP-7 (a fire-and-forget promise orphaned by Fluid Compute
 * freeze) cannot apply. If this ever gains a network sink it must become an
 * awaited call at both sites, for exactly the reason the recording arms are
 * awaited inline.
 *
 * `console.warn`, not `error`: a breaker transition is an operational fact, and
 * the OPEN half is a mitigation working. Routing it to `error` would make every
 * recovery look like a fault.
 */
function emitBreakerTransition(
  kind: "open" | "close",
  breakerKey: string,
  lock: { armedAtMs: number; expiresAtMs: number },
  failures: number,
): void {
  const payload: SeamBreakerTransition = {
    breakerKey,
    failures,
    cooldownS: Math.round((lock.expiresAtMs - lock.armedAtMs) / 1000),
    // Derived from the LOCK, so the open and the close of one lock carry the
    // same id. A per-request id could not do that: the request that trips a
    // circuit is never the request that observes it heal.
    correlationId: `${breakerKey}@${lock.armedAtMs}`,
  };
  console.warn(`[resilient-fetch] seam.breaker.${kind}`, payload);
}

/**
 * Locks whose CLOSE has already been announced by this instance.
 *
 * Best-effort by nature and stated as such: module scope is per-instance under
 * Fluid Compute, so two instances observing the same recovery each announce it
 * once. That is the right trade — the alternative is a store write on the read
 * path of every healthy request, which would make the breaker's own bookkeeping
 * the seam's dominant cost.
 *
 * Bounded by clearing rather than by an LRU: entries are only added on a
 * recovery, the id includes `armedAtMs` so it never repeats, and a cleared set
 * can at worst re-announce one close.
 */
const announcedCloses = new Set<string>();
const MAX_ANNOUNCED_CLOSES = 64;

/**
 * Announce a healed circuit, at most once per lock per instance.
 *
 * ⚠️ THIS IS WHERE THE CLOSE LIVES, AND IT IS NOT A COMPROMISE. Locked decision
 * 3: TTL expiry IS the half-open transition — there is no state machine and no
 * probe scheduler. The first read that observes a lock past its ENCODED expiry
 * is therefore the only moment "the circuit is usable again" becomes a fact
 * anything can see. Inventing a scheduler to fire this event would add the very
 * machinery the design rejects, for a log line.
 */
function announceBreakerClosed(
  breakerKey: string,
  lock: { armedAtMs: number; expiresAtMs: number },
): void {
  const id = `${breakerKey}@${lock.armedAtMs}`;
  if (announcedCloses.has(id)) return;
  if (announcedCloses.size >= MAX_ANNOUNCED_CLOSES) announcedCloses.clear();
  announcedCloses.add(id);
  // A lock exists only because the threshold was reached — `recordSeamFailure`
  // has no other write path — so the failure count that caused it is
  // `BREAKER_FAILURE_THRESHOLD` by construction. It is stated here rather than
  // read back, because the counter is never cleared on a trip and reading it now
  // would report the CURRENT window, not the one that armed this lock.
  emitBreakerTransition("close", breakerKey, lock, BREAKER_FAILURE_THRESHOLD);
}

/**
 * Is a circuit this call site depends on currently open?
 *
 * ⚠️ PER CALL SITE SINCE 140.2-06 (obligation OB-8 / O-2). The check reads
 * exactly `breakerKeysFor(budgetKey)` — the row's declared dependencies plus the
 * global key — in ONE `mget`, so an `mt5-gateway` trip cannot suppress a call
 * that can only ever be blocked by `supabase`. The check stays BEFORE the fetch
 * and INSIDE the route handler after its auth gate: hoisting it into middleware
 * would turn breaker state into an unauthenticated oracle (T-140-04), and
 * middleware cannot know the call site's budget anyway.
 *
 * EVERY exit path returns a value and nothing throws — that is the SEAM-03
 * contract, not an implementation detail. Unconfigured store, an `mget` that
 * rejects, a malformed value: all resolve to `{ open: false }` so the caller
 * proceeds to the real request. The breaker can only ever REMOVE protection
 * when it is unhealthy; it can never itself deny traffic for that reason.
 *
 * ONE round trip since plan 140.2-07, for the whole check and its hint. The
 * `mget` returns each key's lock VALUE, and the value carries its own expiry —
 * see `encodeBreakerLock` for why that removes both halves of A-24 structurally
 * rather than by branching. It also halves the open state's store cost, which is
 * a term in the SC-4b headroom arithmetic.
 */
export async function isBreakerOpen(budgetKey: SeamBudgetKey): Promise<{
  open: boolean;
  retryAfterS?: number;
}> {
  if (!redis) return { open: false };
  const keys = breakerKeysFor(budgetKey);
  try {
    const states = await redis.mget<(string | null)[]>(...keys);
    const now = Date.now();
    // FIRST live lock wins, and `keys` puts the declared dependencies before the
    // global one — see `breakerKeysFor` for why the more specific cooldown is
    // the right `retryAfterS` tie-break.
    // INDEXED rather than `for…of` since SEAMCORE-06: `states` is parallel to
    // `keys`, and the close event has to name WHICH circuit healed. The
    // `mget` fake and the real client both return one slot per requested key,
    // in request order, so the index is the key.
    for (let i = 0; i < states.length; i++) {
      const lock = decodeBreakerLock(states[i]);
      // A lock whose ENCODED expiry has passed is a tombstone, not an open
      // circuit. The key deliberately outlives the lock (see
      // `BREAKER_LOCK_TOMBSTONE_S`), so "present" and "open" are different
      // questions and reading the first as the second would deny a HEALED
      // circuit for another full minute.
      if (!lock) continue;
      if (lock.expiresAtMs <= now) {
        // A tombstone this instance has not seen before IS the observed close.
        announceBreakerClosed(keys[i] ?? BREAKER_KEY, lock);
        continue;
      }
      return {
        open: true,
        retryAfterS: Math.ceil((lock.expiresAtMs - now) / 1000),
      };
    }
    return { open: false };
  } catch (err) {
    // SCRUBBED (SEAMCORE-06 / TRAP-1). This arm logs the BREAKER STORE's
    // rejection, and the store command carries `UPSTASH_REDIS_REST_TOKEN` in an
    // Authorization header — which undici inlines into the error it produces.
    // The syscall token survives, because a store that is refused and a store
    // whose certificate expired are different incidents.
    console.error(
      "[resilient-fetch] breaker check failed — failing OPEN:",
      scrubSeamError(err),
    );
    return { open: false };
  }
}

/**
 * Record ONE infrastructure failure against `breakerKey`, and trip that circuit
 * if the allowance for `BREAKER_WINDOW` is now exhausted.
 *
 * `breakerKey` comes from `seamBreakerVerdict` and from nowhere else. That
 * function builds it only from a hand-typed frozen closed set, so it is provably
 * one of `breaker:railway`, `breaker:mt5-gateway`, `breaker:kek`,
 * `breaker:supabase` or `breaker:egress-proxy` — never a value read off the wire
 * (threat T-140-01). Do not add a call site that computes this argument itself.
 *
 * Called only from the engine's classified COUNTING arms (deadline, transport
 * throw, body-read abort, and a counting status) — never for a 4xx and never for
 * a 500. See `resilientFetch` for that rationale.
 *
 * ⚠️ THE COUNTER IS PER-KEY, AND THAT IS THE POINT. The identifier is
 * `` `${breakerKey}:failures` ``, so `mt5-gateway`'s failures cannot accumulate
 * toward `supabase`'s trip. Dropping the per-dependency component here collapses
 * every dependency onto one counter and re-creates the single global breaker
 * under a per-dependency name — ledger row M20R, falsified by the real-Redis
 * lane's R-1.
 *
 * ⚠️ THE LIMITER MAY NOT REACH REDIS. `@upstash/ratelimit@2.0.8` defaults
 * `ephemeralCache` to a live in-memory `Map` and this module omits the option,
 * so after a DENIED `limit()` every later call for the SAME identifier
 * short-circuits in memory until the epoch bucket rolls over. Kept deliberately
 * (see the limiter's construction above); nothing here assumes a Redis round
 * trip, because the lock write below is a direct `redis.set` OUTSIDE the
 * limiter and therefore still lands.
 *
 * The whole body is swallowed on error: this runs INSIDE the caller's catch
 * arm, so a throw here would replace the real upstream error with a breaker
 * bookkeeping error. Never log request bodies or header values from this
 * module — the seam carries raw exchange API secrets and INTERNAL_API_TOKEN.
 */
export async function recordSeamFailure(
  breakerKey: string,
  admittedAtMs: number = Date.now(),
): Promise<void> {
  if (!redis || !breakerLimiter) return;
  try {
    const verdict = await breakerLimiter.limit(`${breakerKey}:failures`);
    // ── A-09, AND IT WAS A LIVE DEFECT ──────────────────────────────────────
    // `@upstash/ratelimit`'s `timeout` defaults to 5 000 ms, and when it fires
    // `applyTimeout` resolves `{ success: true, limit: 0, remaining: 0, reset:
    // 0, reason: "timeout" }`. The library's intent is unambiguous:
    // `success: true` means LET TRAFFIC THROUGH, because it could not reach the
    // counter. The trip test below is `success && remaining > 0`, so the
    // sentinel's `remaining === 0` fell THROUGH it and armed the lock. One
    // recorded failure plus one slow Upstash was a full trip.
    //
    // THE DISCRIMINATOR IS `reason`, not `limit === 0`. Both identify the
    // sentinel (no real limit is ever 0), but `reason` says WHICH fail-open the
    // library took, and that matters: `"cacheBlock"` is the OTHER reason the
    // limiter can answer without touching Redis, and it is a genuine DENIAL that
    // must still trip. A `limit === 0` test would be correct today only because
    // the cacheBlock path happens to carry a real limit.
    if (verdict.reason === "timeout") {
      console.error(
        `[resilient-fetch] ${breakerKey}: the failure counter was unreachable ` +
          `(store timeout) — NOT tripping the breaker. This is the store being ` +
          `slow, not the seam being degraded.`,
      );
      return;
    }
    const { success, remaining } = verdict;
    // A sliding window of N ALLOWS the Nth call (leaving `remaining === 0`) and
    // denies the (N+1)th. The breaker must open ON the threshold-th failure,
    // not one failure later, so exhaustion counts as a trip signal alongside
    // outright denial.
    if (success && remaining > 0) return;

    // Failures counted in the window at the moment of the trip, read from the
    // verdict rather than assumed to be the threshold: `limit` is what the
    // limiter was actually built with, so a retune shows up in the event instead
    // of the event asserting the constant back at the operator.
    const failures =
      typeof verdict.limit === "number" && typeof remaining === "number"
        ? verdict.limit - remaining
        : BREAKER_FAILURE_THRESHOLD;

    // ── THE TRIP PATH ───────────────────────────────────────────────────────
    // Reached once per `BREAKER_FAILURE_THRESHOLD` failures, so the extra read
    // below costs one round trip on the rarest path rather than on every
    // recorded failure. That distinction is deliberate: `ephemeralCache` is left
    // at its default in-memory `Map`, so NOTHING here may assume the limiter
    // above reached Redis at all, and adding a guaranteed round trip to every
    // failure would change the deployed breaker's timing behaviour during
    // precisely the correlated incident it exists for.
    const now = Date.now();
    const existing = decodeBreakerLock(await redis.get<string>(breakerKey));
    if (existing) {
      // Already open. Return without writing, so the FIRST writer's expiry
      // stands and a second instance tripping 200ms later cannot ratchet the
      // cooldown window open.
      if (existing.expiresAtMs > now) return;

      // ── A-25, and the failure it prevents ──────────────────────────────────
      // A call admitted at t=0 under the 60 s `process-key-sync` budget fails at
      // t≈60. The lock armed at t≈0 expired at t=30, so the write below used to
      // succeed and arm a FRESH 30 s window — on behalf of a request that was
      // already doomed before the first trip and never got to observe the
      // recovery. One wave of long-budget calls therefore held the breaker open
      // 90 s+ with NO new traffic attempted at all: the mitigation manufacturing
      // the outage.
      //
      // The predicate is "was this request already in flight when that lock was
      // armed", which is answerable only because the key outlives the lock (see
      // `BREAKER_LOCK_TOMBSTONE_S`). The rejected alternative — "skip when the
      // breaker is already open" — does NOT close A-25: at t=60 the lock is
      // expired, so that test passes and `nx` succeeds, which is exactly today's
      // behaviour.
      if (admittedAtMs <= existing.armedAtMs) return;
    }

    const expiresAtMs = now + BREAKER_COOLDOWN_S * 1_000;
    const value = encodeBreakerLock(now, expiresAtMs);
    const ttlS = BREAKER_COOLDOWN_S + BREAKER_LOCK_TOMBSTONE_S;
    let written: unknown;
    if (existing === null) {
      // `nx: true` makes CONCURRENT trips idempotent — two instances tripping
      // milliseconds apart, neither of which saw the other's write.
      //
      // ⚠️ THIS IS NOT REDUNDANT WITH THE STILL-LIVE-LOCK GUARD ABOVE, and the
      // ROADMAP said it was. The guard requires the read to have SEEN a live
      // lock; `nx` covers the case the guard structurally cannot reach — two
      // instances that both read `null` and both write. Orthogonal, not
      // layered. Falsified by "a stale-reading concurrent instance cannot
      // RATCHET a live lock", which reddens under `nx: false`.
      written = await redis.set(breakerKey, value, { ex: ttlS, nx: true });
    } else {
      // ── OVERWRITING A TOMBSTONE — THE BRANCH THAT ACTUALLY RACES (HI-01) ──
      //
      // Reaching here means the previous lock has expired AND this failure is
      // new evidence gathered after it was armed, so a fresh cooldown is right.
      // `nx` cannot express that: the key still EXISTS as a tombstone, so `nx`
      // would refuse every re-arm for the whole tombstone window.
      //
      // This used to be a BLIND write returning a truthy `"OK"` unconditionally,
      // and that made it the one door the idempotency story above does not
      // cover. A lock armed at t=0 expires at t=30 and the key survives to t=90.
      // At t=31, with Railway still degraded, N Fluid Compute instances hit this
      // path within a few milliseconds: each reads the tombstone (so the
      // still-live-lock guard does not fire), each passes the A-25 admission
      // guard, and each wrote. Every one got `"OK"`, so every one emitted
      // `seam.breaker.open` for ONE trip — the exact double-count the comment
      // below claims is prevented.
      //
      // `get: true` closes it in ONE command. `SET key value GET EX ttl` returns
      // what it DISPLACED, atomically, so the write and the read of the prior
      // state cannot be interleaved by a racer the way a separate `get` + `set`
      // can. The ownership rule is then exact: you armed this circuit iff what
      // you displaced was NOT a live lock. In the N-instance race exactly one
      // instance displaces the tombstone; every other displaces the lock a racer
      // armed microseconds earlier, and returns without claiming the event.
      //
      // ⚠️ ONE COMMAND IS NOT A MICRO-OPTIMISATION, IT IS THE CONSTRAINT. The
      // obvious alternative — claim a per-generation key with `SET NX`, then
      // write — costs a SECOND store round trip on the failing path, and
      // `seam-budgets.invariant.test.ts` SC-4b proves that breaches the Vercel
      // ceiling: finalize-wizard's composite branch goes to 320 000 ms against a
      // 300 000 ms function limit. Trading a rare double-count for a lambda
      // killed mid-request during an outage is strictly the wrong direction. A
      // Lua compare-and-set is also one command, and was rejected for a
      // different reason: the test double would have to re-implement the script,
      // i.e. a fake that cannot disagree with production, which is the exact
      // defect this phase exists to remove.
      //
      // RESIDUAL, NAMED RATHER THAN HIDDEN. The losing racers still overwrote
      // the winner's lock before they could know they had lost, so `expiresAtMs`
      // moves by the spread of the burst's write times — milliseconds against a
      // 30 s cooldown. It is BOUNDED, not compounding: once the lock is live,
      // every later read returns at the still-live-lock guard above. Closing it
      // completely needs a write this module can condition on the value it read,
      // which is the Lua/round-trip trade above. Handed to Phase 141 with the
      // rest of the breaker's timing behaviour.
      const displaced = decodeBreakerLock(
        await redis.set(breakerKey, value, { ex: ttlS, get: true }),
      );
      written = displaced === null || displaced.expiresAtMs <= now;
    }
    // SEAMCORE-06 — announce the OPEN, and only when this call is the one that
    // armed it. `nx` answers `null` when a concurrent instance won the race, and
    // that instance is emitting its own event; claiming a transition here would
    // double-count every trip across a Fluid Compute fleet.
    //
    // The key comes from the VERDICT (it is this function's argument, built only
    // by `seamBreakerVerdict` from a frozen closed set), never from
    // `BREAKER_KEY` — an event that named the global key for every trip would be
    // decorative, and indistinguishable from a correct one on the global path.
    if (written) {
      emitBreakerTransition(
        "open",
        breakerKey,
        { armedAtMs: now, expiresAtMs },
        failures,
      );
    }
  } catch (err) {
    // SCRUBBED, same reason as the read arm above: the store credential is in
    // the outgoing header this rejection describes.
    console.error(
      "[resilient-fetch] failed to record seam failure — breaker state may be stale:",
      scrubSeamError(err),
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
  recordOnce: (breakerKey: string) => Promise<void>,
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
      // The non-deadline arm carries the scrubbed rendering for the same A-10
      // reason as the transport arm: a body read that fails because the
      // connection reset and one that fails because the stream was truncated
      // are different incidents, and this site is a member of the SEAMCORE-06
      // class that plan 140.2-05 added.
      console.error(
        deadlineExceeded
          ? `[resilient-fetch] ${budgetKey}: deadline exceeded after ${timeoutMs}ms while reading the response body`
          : `[resilient-fetch] ${budgetKey}: response body read failed: ${scrubSeamError(err)}`,
      );
      // AWAITED INLINE, exactly like the transport arm. A "record in the
      // background so we don't add latency" IIFE is orphaned by Fluid Compute
      // freeze, so the breaker would never arm during precisely the correlated
      // incident it exists for (TRAP-7).
      //
      // THE GLOBAL KEY, and it is the only defensible one: the body we were
      // reading is the body that would have named a dependency, and it just
      // failed to arrive. `seamBreakerVerdict(null)` is the ONE definition of
      // "no status line, therefore global", shared with the transport arm rather
      // than re-typed here.
      //
      // `recordOnce`, not `recordSeamFailure`: a counting STATUS whose body then
      // aborts is ONE degraded request, not two. Before the shared latch a 503
      // with a stalling body recorded twice — half the failures needed to trip,
      // from the same number of requests.
      const bodyVerdict = seamBreakerVerdict(null);
      if (bodyVerdict.counts && bodyVerdict.breakerKey !== null) {
        await recordOnce(bodyVerdict.breakerKey);
      }
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
 * Peek at a `503`'s body — and ONLY a `503`'s — so the verdict can name the
 * dependency the failure belongs to.
 *
 * ⚠️ THIS MAY NOT DISTURB THE CALLER'S BODY. Status interpretation is the
 * caller's contract and every seam client reads the body itself, so the peek
 * goes through `res.clone()`: the tee leaves the caller's branch intact and, on
 * success, already buffered.
 *
 * WHY ONLY 503, and why the failure mode is a shrug:
 *   · 503 is the ONE status whose key is refinable — the only class where the
 *     contract requires a `dependency` (§1, R-2). Every other status either does
 *     not count or has nothing to name, so reading their bodies would buy
 *     nothing and cost a tee on the hot path.
 *   · If the body is absent, unparseable, or aborts, the verdict falls back to
 *     the residual global key and STILL COUNTS. The peek can therefore only ever
 *     make the key MORE specific; it can never decide whether to record. That is
 *     what keeps TRAP-2 closed with the refinement in place.
 *   · The read is bounded by the same `AbortSignal.timeout` deadline as the
 *     request, because the clone shares the underlying stream. A 503 whose body
 *     never arrives costs the remaining budget here instead of at the caller —
 *     the same wall clock, moved earlier.
 *
 * The `clone` capability check is not defensive decoration: `SeamResponse` is
 * deliberately structural so route tests can stub the core with a
 * `Response`-shaped object, and several existing fixtures are bare
 * `{ ok, status }` literals. A missing `clone` must degrade to the global key,
 * never throw — a throw here lands inside the classification window and would
 * replace the real upstream error with a bookkeeping one.
 */
async function readDependencyBody(res: Response): Promise<unknown> {
  if (res.status !== 503) return undefined;
  if (typeof res.clone !== "function") return undefined;
  try {
    return await res.clone().json();
  } catch {
    // Absent, `text/plain`, truncated or aborted. All the same answer: no
    // dependency, global key, still counts. Deliberately NOT logged — a 503 with
    // an unparseable body is already logged by whichever arm handles it, and the
    // seam carries raw exchange credentials.
    return undefined;
  }
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

  const breaker = await isBreakerOpen(budgetKey);
  if (breaker.open) {
    throw new CircuitOpenError(breaker.retryAfterS ?? DEFAULT_RETRY_AFTER_S);
  }

  /**
   * The instant this request was ADMITTED past a closed circuit.
   *
   * Carried into every recording arm below and compared, in `recordSeamFailure`,
   * against when the last lock was armed (A-25). It has to be the ADMISSION
   * instant and not `Date.now()` at recording time: by construction a request
   * records after it was admitted, and the gap between the two is the entire
   * subject of the guard.
   */
  const admittedAtMs = Date.now();

  /**
   * ONE request records AT MOST ONE failure, whichever arm classifies it.
   *
   * Wave 5 moved the body read inside the classification window and left this
   * interaction open deliberately, because this plan replaces the status branch:
   * a counting status AND a body that then aborts are two arms observing ONE
   * degraded request. Recording both halves the failures needed to trip, so five
   * genuinely-distinct incidents' worth of protection would fire after two or
   * three — a breaker that opens early is still an outage it created itself.
   *
   * A latch rather than an ordering rule: the arms cannot be ordered, since the
   * body read happens whenever the CALLER chooses to read it, arbitrarily later.
   */
  let recorded = false;
  async function recordOnce(breakerKey: string): Promise<void> {
    if (recorded) return;
    recorded = true;
    await recordSeamFailure(breakerKey, admittedAtMs);
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
    // ── A-10, AND THIS SITE GAINS INFORMATION RATHER THAN LOSING IT ─────────
    // `err` used to be DROPPED here entirely. The result was that TLS expiry, a
    // DNS `EAI_AGAIN`, a refused connection and a header `TypeError` were one
    // indistinguishable sentence — the operator could see THAT the seam failed
    // and never WHY. The scrubbed rendering restores the syscall token and the
    // TLS code while removing every credential undici inlined into the message
    // (SEAMCORE-06 / TRAP-1), so the line is both safe and diagnostic.
    //
    // ⚠️ DELIBERATELY SEPARATE FROM THE CONFIG SENTENCE plan 140.2-05 added
    // above. That sentence exists so a malformed `ANALYTICS_SERVICE_URL` stops
    // being reported as Railway degradation; merging the two would undo it.
    //
    // The budget key stays; the path, the body and every header value stay OUT.
    console.error(
      deadlineExceeded
        ? `[resilient-fetch] ${budgetKey}: deadline exceeded after ${timeoutMs}ms`
        : `[resilient-fetch] ${budgetKey}: network failure reaching the analytics service: ${scrubSeamError(err)}`,
    );
    // No status line at all, so the verdict is TRANSPORT and the key is the
    // residual global one. Asked of the discriminator rather than hardcoded here
    // so there is exactly ONE definition of that mapping.
    const transportVerdict = seamBreakerVerdict(null);
    if (transportVerdict.counts && transportVerdict.breakerKey !== null) {
      await recordOnce(transportVerdict.breakerKey);
    }
    // Rethrow the ORIGINAL error. Both clients map `err.name` onto their own
    // typed errors (AnalyticsTimeoutError / UPSTREAM_TIMEOUT); wrapping here
    // would silently reclassify every timeout in the codebase.
    throw err;
  }

  // ── ATTRIBUTABILITY (SEAMCORE-01 / ROADMAP SC2) ─────────────────────────
  //
  // `res.status >= 500` used to stand here, and it was wrong in BOTH directions.
  // A `500` is SERVICE-PERMANENT: retrying it cannot help, so counting it
  // guarantees a self-sustaining outage — an undecryptable key or an unset KEK
  // re-trips the breaker forever, and the breaker then blocks its own recovery
  // probe (R-1 / A-02 / A-25). Meanwhile a `503` naming a dependency, and a body
  // that stalls, are the failures that SHOULD count and one of them did not.
  //
  // The verdict is decided from the STATUS LINE FIRST — a bodyless
  // `500 text/plain` from Starlette's `ServerErrorMiddleware` is the single most
  // common 5xx, so a classifier that needs a body is undefined exactly there
  // (TRAP-2). The body is consulted ONLY to refine WHICH key a counting verdict
  // names, and only on the 503 arm.
  const verdict = seamBreakerVerdict(res.status, await readDependencyBody(res));
  if (verdict.counts && verdict.breakerKey !== null) {
    await recordOnce(verdict.breakerKey);
  }
  // 4xx NEVER records — including the `424` whose body names the caller's VENUE,
  // whose slug must never become a breaker key (STATUS_CONTRACT §4). A user's bad
  // API key returning 400 is Railway working CORRECTLY; `create-with-key` and
  // `composite/add-key` deliberately map that to a client fault. Counting 4xx
  // would let a handful of users fat-fingering credentials trip the breaker and
  // take key-connect down for everyone: a user error must never become an
  // outage. The accepted cost (A4, operator decision) is that if Railway 4xxes
  // during genuine degradation the breaker under-trips.

  // The window does not close here. `instrumentBody` keeps `json()` and
  // `text()` inside it, which is what makes the docblock's "classified failure
  // recording" true for a stalling upstream (SEAMCORE-02 / SC1).
  return instrumentBody(res, budgetKey, timeoutMs, recordOnce);
}
