import { after } from "next/server";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { CircuitOpenError, SeamBodyReadError } from "./seam-errors";
import { seamBreakerVerdict } from "./seam-discriminator";
import { scrubSeamError } from "./seam-redaction";
import { captureToSentry, shouldCaptureNow } from "./sentry-capture";
import { parseRetryAfterSeconds } from "./retry/retry-after";

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
 * new idea: `analytics-service/services/job_worker.py`'s `_check_circuit_breaker`
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
// Exported as named constants with rationale comments (the convention
// `ratelimit.ts` uses for its `makeLimiter` exports) so retuning is a one-line
// change reviewable in isolation, rather than a magic number buried in a
// function body.
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
 *
 * ⚠️ THE UNIT IS AN ATTEMPT, NOT A REQUEST, AND THIS DOCBLOCK USED TO REASON AS
 * IF THEY WERE THE SAME THING. The sentence above predates the retry loop: it
 * argued only from the under-trip direction, and it was written when one
 * `resilientFetch` call could contribute at most ONE failure. Phase 141's
 * per-attempt latch (see `recordOnce` and the Class D note at its reset) changed
 * that deliberately — a retried attempt is a distinct request as far as the
 * breaker is concerned, so a doubly-failing retried call now records TWO.
 *
 * THE ARITHMETIC, stated so this is a number rather than a wish:
 *
 *   | traffic shape                        | failures per user request | requests to trip |
 *   |--------------------------------------|---------------------------|------------------|
 *   | no retry (every row before 141)      | 1                         | 5                |
 *   | retried, both attempts failing       | 2                         | ⌈5/2⌉ = 3        |
 *
 * ⚠️ "**3 user requests instead of 5**" WAS STATED HERE UNCONDITIONALLY, and it
 * is no longer unconditional. It is kept, named, and qualified rather than
 * quietly deleted, because it is still the right summary for the traffic shape
 * it describes — and because two 141.2 decisions narrowed that shape from both
 * ends:
 *
 *   · D-06 narrowed the FAILURE class. The second row above presupposes a
 *     second attempt happened at all. A 503 that names a POSITIVE wait now
 *     fails fast (`hasContractualWait` parses the header via
 *     `parseRetryAfterSeconds` instead of testing its presence), so it records
 *     ONE failure and trips at the ordinary five. Every SERVICE-TRANSIENT 503
 *     the analytics service emits carries such a header by contract — so for
 *     that status class, which is the mandatory one, the top row applies.
 *     Two-per-request is the transport/timeout class: throws, deadlines and
 *     header-less edge 5xx.
 *   · D-01 and D-03 narrowed the CALLER set. A retry-enabled budget row no
 *     longer implies a retried call: the `/process-key` verdict is taken from
 *     `retriesForFlow` in `seam-retry-registry.ts`, which grants a retry only
 *     to `onboard`, and only when the call carries a usable idempotency key.
 *
 * So: sustained degradation trips in three user requests where a call actually
 * retries AND its failures carry no contractual wait, and in five otherwise.
 * The trip is also WIDE: `breakerKeysFor`
 * appends the global `BREAKER_KEY` to every call site's check, so an open global
 * circuit gates all fifteen routes — including the anonymous public teaser
 * (the exposure recorded and accepted at the `process-key-sync` row).
 *
 * ACCEPTED, decided 2026-07-31 (Phase 141.1 / D-02), and the direction is the
 * point: a Railway blip that reaches five COUNTED failures inside 30 s is a real
 * outage, not noise, and containing it two requests sooner is the behaviour we
 * want from a breaker. Faster containment is bought with a fail-open breaker
 * whose cooldown is 30 s, so the cost of an early trip is bounded and the cost
 * of a late one is not.
 *
 * Raising this number is therefore TWO decisions, not one: it delays protection
 * during a real outage AND it delays it further still for retried traffic, by a
 * factor this docblock's table makes explicit. The two halves are pinned in two
 * different places, on purpose: `seam-constants.pin.test.ts` pins the LITERAL,
 * and the per-attempt-latch case in `resilient-fetch.retry.test.ts` pins the
 * per-attempt BEHAVIOUR the table's second row rests on, by driving the real
 * loop and counting the recordings. This docblock used to claim the pin file
 * held both — it held the literal and an arithmetic restatement of it, which
 * 141.2 / D-05 deleted for being unable to fail (finding 13). Neither half can
 * move in silence now; before, only the literal could not.
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
 * 90 s, because the guard must span the longest budget in `SEAM_BUDGETS`
 * (`validate-key-serialized`, 120 000 ms) measured from the instant a lock is
 * armed: `(BREAKER_COOLDOWN_S + BREAKER_LOCK_TOMBSTONE_S) × 1000 = (30 + 90) ×
 * 1000 = 120 000 ≥ 120 000`, with the cooldown itself absorbing the first 30 s.
 *
 * ⚠️ THE INEQUALITY IS TIGHT ON PURPOSE — it holds with EQUALITY, not with
 * slack. This constant was 60 while the longest budget was 60 000 ms; Phase
 * 153.4 / D-26 raised the serialized validate budget to 120 000 ms and this
 * constant to 90 IN THE SAME COMMIT, because landing the budget alone leaves
 * A-25 false while every literal-vs-literal assertion about it stays green.
 * Any FURTHER budget raise must move this constant again, in its own same
 * commit: there is no headroom left to absorb one.
 *
 * Pinned in `seam-constants.pin.test.ts` three ways, and the third is the one
 * that can see this coupling break: a literal pin on this constant, the
 * literal-vs-literal A-25 inequality, and the DERIVED A-25 assertion that takes
 * `Math.max` over the live `SEAM_BUDGETS` and compares it to a ceiling built
 * from hand-typed breaker literals. The first two catch the constants moving;
 * only the third catches a budget outgrowing them.
 */
export const BREAKER_LOCK_TOMBSTONE_S = 90;

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
// SEAM-06 — the retry loop's backoff (Phase 141)
//
// Declared beside the breaker-store constants because they are the same KIND of
// value — a term in the SC-4b worst case, declared rather than defaulted so the
// headroom arithmetic can read it. The retry loop lives in `resilientFetch`; the
// wait BETWEEN a failed attempt and its one retry is `SEAM_RETRY_BACKOFF_MS +
// Math.random() × SEAM_RETRY_JITTER_MAX_MS`.
// ---------------------------------------------------------------------------

/**
 * Fixed pause before the single retry.
 *
 * FIXED, not exponential, and that is not a contradiction of SEAM-06's
 * "exponential + jitter" wording: with EXACTLY ONE retry there is a single
 * interval, and a single interval has no growth to be exponential ABOUT — the
 * first (and only) exponential term `base × 2⁰` is just `base`. So "fixed +
 * jitter" and "exponential + jitter" coincide here, and the fixed form is the
 * one the SC-4b headroom arithmetic can state as one number (the lesson
 * `BREAKER_STORE_BACKOFF_MS` above records verbatim). If a future policy widens
 * to N>1 retries this becomes the exponential base and plan 04's invariant
 * updates with it.
 */
export const SEAM_RETRY_BACKOFF_MS = 250;

/**
 * Upper bound on the random jitter added to `SEAM_RETRY_BACKOFF_MS`.
 *
 * Jitter DECORRELATES the retries of concurrent callers that all failed on the
 * same Railway blip — without it, N lambdas retry in lock-step and re-create the
 * synchronised storm the breaker exists to damp (T-141-04). The jitter is
 * `Math.random() × this`, i.e. unbounded-BELOW-only: it can only ADD to the
 * backoff, never subtract, so the worst-case interval is `SEAM_RETRY_BACKOFF_MS
 * + SEAM_RETRY_JITTER_MAX_MS` = 500ms. SC-4b (plan 04) must charge that MAX, not
 * the mean, because the headroom assertion has to hold for the slowest draw.
 */
export const SEAM_RETRY_JITTER_MAX_MS = 250;

// ---------------------------------------------------------------------------
// SEAM-02 — the ONE timeout budget table
// ---------------------------------------------------------------------------

/** Identifier for a seam call site. One key per distinct budget owner. */
export type SeamBudgetKey =
  | "validate-key"
  | "validate-key-serialized"
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
 * ⚠️ EVERY ENTRY IS EVIDENCE, NOT INTUITION. Derived by enumerating every
 * `dependency=` argument in `analytics-service/routers/**` together with the
 * status it is raised at. THIRTEEN such arguments exist and all thirteen are
 * accounted for below — that completeness is the property worth having, because
 * a MISSING row silently under-declares a real breaker key, which is a worse
 * failure than a wrong coordinate. Re-derived at HEAD on 2026-07-30 (140.5-07).
 *
 * ⚠️ ROWS ARE ANCHORED TO SYMBOLS — FUNCTION AND MACHINE CODE — NOT TO LINE
 * NUMBERS, and that is a correction, not a style preference. The previous
 * version of this table cited `exchange.py` coordinates that were ALL FOUR
 * WRONG, every one of them low by 21 lines, while the five `internal.py` /
 * `portfolio.py` / `match.py` coordinates beside them were still exact. A reader
 * checking one of the correct rows would have concluded the table was
 * trustworthy. Machine codes are unique, greppable, and are themselves the
 * contract vocabulary `error_contract.py` validates, so they cannot drift with
 * an unrelated edit above them the way a line number does.
 *
 * Only a `503` counts, so only a `503` can ever open a per-dependency key, and
 * the whole COUNTING set today is:
 *
 *   | dependency  | site                                                  | reached by               |
 *   |-------------|-------------------------------------------------------|--------------------------|
 *   | mt5-gateway | `exchange.py` `_validate_mt5_key` — `MT5_GATEWAY_UNREACHABLE` (×2: connect timeout, connect failure) | POST /api/validate-key |
 *   | supabase    | `portfolio.py` `_compute_portfolio_analytics` — `ANALYTICS_ROW_NOT_CREATED` | /api/portfolio-analytics |
 *   | supabase    | `match.py` `recompute` — `ADMIN_CHECK_UNAVAILABLE`, `ROLE_CHECK_UNAVAILABLE` | /api/match/recompute     |
 *
 * Every other `dependency=` site is breaker-inert, and each is inert for a
 * REASON rather than by accident:
 *   · `500`, never counts (SERVICE-PERMANENT, R-1 — an operator must act, so
 *     counting it guarantees a self-sustaining outage):
 *       `kek`         — `internal.py` `get_key_permissions` — `KEK_UNAVAILABLE`,
 *                       `KEY_UNDECRYPTABLE`; `exchange.py` `encrypt_key` —
 *                       `KEK_UNAVAILABLE`
 *       `egress-proxy`— `exchange.py` `_validate_sfox_key` —
 *                       `EGRESS_PROXY_MISCONFIGURED`
 *       `mt5-gateway` — `exchange.py` `_validate_mt5_key` —
 *                       `MT5_GATEWAY_UNCONFIGURED` (×2: absent host/port,
 *                       malformed port). ⚠️ SAME FUNCTION AND SAME DEPENDENCY as
 *                       the counting row above; only the STATUS separates them.
 *   · `424`, never counts, and the name is the CALLER'S VENUE rather than a
 *     dependency of ours (§4 — it must never become a breaker key):
 *       `internal.py` `get_key_permissions` — `EXCHANGE_PROBE_FAILED`;
 *       `exchange.py` `validate_key` — `EXCHANGE_PROBE_FAILED`
 *
 * `breaker:kek` and `breaker:egress-proxy` therefore cannot be opened by ANY
 * site at HEAD, so declaring them anywhere would declare a key that can never be
 * set — noise that reads as protection.
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
    /**
     * ACCOUNTING ONLY — this number does NOT turn retry on (D-08).
     *
     * It declares how many retries this call site is EXPECTED to perform, and
     * exactly two readers consume it: SC-4b's headroom arithmetic in
     * `seam-budgets.invariant.test.ts` (which must charge the retried leg's
     * wall-clock and store round trips against the route's Vercel ceiling), and
     * the `EXPECTED_RETRIES` literal pin in `seam-constants.pin.test.ts`.
     *
     * What actually gates a retry is `ResilientFetchInit.retriesOverride`, a
     * REQUIRED `0 | 1` fed by `RETRY_SAFE_FLOW_TYPES` / `RETRY_SAFE_ANALYTICS`
     * at the two client chokepoints. Editing this literal changes the BILL, not
     * the behaviour; editing it without the matching registry entry is caught by
     * the row↔registry agreement assertion in `seam-constants.pin.test.ts`.
     */
    retries: number;
    notes: string;
  }
> = {
  "validate-key": {
    timeoutMs: 30_000,
    // `exchange.py`'s `_validate_mt5_key` raises MT5_GATEWAY_UNREACHABLE —
    // service_error(503, dependency="mt5-gateway") — reached by POST
    // /api/validate-key. The sFOX and ccxt arms of the same endpoint answer 500
    // (EGRESS_PROXY_MISCONFIGURED, egress-proxy) or 424 (EXCHANGE_PROBE_FAILED,
    // venue), neither of which counts, so neither is declared. ⚠️ The SAME
    // function also raises MT5_GATEWAY_UNCONFIGURED at 500 on the same
    // dependency; the status is the only thing separating them.
    dependencies: ["mt5-gateway"],
    retries: SEAM_RETRIES,
    notes:
      "Live exchange auth probe — genuinely slow and venue-variable (Deribit, Binance, OKX all differ). Was the analytics-client 30s default.",
  },
  "validate-key-serialized": {
    timeoutMs: 120_000,
    // SAME endpoint, SAME dependency as the row above — POST /api/validate-key,
    // whose `exchange.py` `_validate_mt5_key` raises MT5_GATEWAY_UNREACHABLE at
    // service_error(503, dependency="mt5-gateway"). Declared here for the same
    // reason and no other; the MT5_GATEWAY_UNCONFIGURED arm of that same
    // function is a 500 and never counts, so the status is again the only thing
    // separating them. ⚠️ Nothing new is declared: a longer budget does not earn
    // a wider dependency set.
    dependencies: ["mt5-gateway"],
    // ⛔ NEVER a literal 1 here, and never an entry in RETRY_SAFE_ANALYTICS
    // (its NO verdict is written in `seam-retry-registry.ts`). In the OPEN state
    // CircuitOpenError is thrown BEFORE fetch, so a retry merely re-runs
    // isBreakerOpen, charges a second store round and throws again — and a
    // retried 120 000 ms leg would double the wall-clock SC-4b charges against
    // this route's Vercel ceiling. D-07 is the standing prohibition.
    retries: SEAM_RETRIES,
    notes:
      "The SERIALIZED-venue arm of the live exchange auth probe — spent by venues whose VENUE_CAPABILITIES.serialized is true (today: MT5), selected by budgetKeyFor(exchange) in analytics-client.ts. One terminal, one account at a time, so a caller's own probe waits behind whoever holds the lease. It must contain a server worst case of 105 s: a 20 s BOUNDED lease acquisition + a 75 s end-to-end probe deadline + a 10 s release that runs OUTSIDE that deadline (Phase 153.3), leaving 15 s of margin. 120 000 ms is PROVISIONAL (D-27): it is the founder's stated staleness tolerance, NOT a measurement — no uncensored successful MT5 validation exists anywhere, so no p50/p95 does either. Phase 153.3's per-stage stage/duration_ms instrumentation is what will produce one, and Phase 155 (MT5-VERIFY) owns tightening this number from that data. RECORDED, NOT MITIGATED (T-153.4-03): this arm holds a Vercel lambda four times longer than the default row, and the only bound is the per-tenant 100/hour limiter on /api/validate-key — the same accepted exposure the process-key-sync row's ME-04 note carries.",
  },
  "encrypt-key": {
    timeoutMs: 30_000,
    // `exchange.py`'s `encrypt_key` raises KEK_UNAVAILABLE at 500 naming `kek` —
    // SERVICE-PERMANENT, never counts, so `breaker:kek` cannot be open and
    // declaring it would be decorative.
    dependencies: [],
    retries: SEAM_RETRIES,
    notes:
      "Same live-exchange probe class as validate-key; always runs sequentially after it, so the two budgets sum per request.",
  },
  bridge: {
    timeoutMs: 15_000,
    dependencies: [],
    // Phase 141 / SEAM-06 — retry-safe. Registry entry: RETRY_SAFE_ANALYTICS.bridge
    // (findReplacementCandidates — pure compute, no persisted write on the path).
    retries: 1,
    notes:
      "Weighted-covariance compute. Was hardcoded inside analytics-client's findReplacementCandidates.",
  },
  simulator: {
    timeoutMs: 15_000,
    dependencies: [],
    // Phase 141 / SEAM-06 — retry-safe. Registry entry: RETRY_SAFE_ANALYTICS.simulator
    // (simulateAddCandidate — pure compute, no persisted write on the path).
    retries: 1,
    notes:
      "Portfolio impact simulator compute. Was hardcoded inside analytics-client's simulateAddCandidate.",
  },
  "portfolio-optimizer": {
    timeoutMs: 15_000,
    dependencies: [],
    // Phase 141 / SEAM-06 — retry-safe. Registry entry:
    // RETRY_SAFE_ANALYTICS["portfolio-optimizer"] (runPortfolioOptimizer — pure compute).
    retries: 1,
    notes:
      "Heavy compute. Was OPTIMIZER_TIMEOUT_MS declared inside the route rather than the client — the budget-ownership split this table exists to end.",
  },
  "optimize-weights": {
    timeoutMs: 30_000,
    dependencies: [],
    // Phase 141 / SEAM-06 — retry-safe. Registry entry:
    // RETRY_SAFE_ANALYTICS["optimize-weights"] (optimizeScenarioWeights — pure compute).
    retries: 1,
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
    // `match.py`'s `recompute` raises ADMIN_CHECK_UNAVAILABLE and
    // ROLE_CHECK_UNAVAILABLE — service_error(503, dependency="supabase").
    dependencies: ["supabase"],
    retries: SEAM_RETRIES,
    notes: "Admin match engine, heavy compute. Was the 30s default.",
  },
  "portfolio-analytics": {
    timeoutMs: 30_000,
    // `portfolio.py`'s `_compute_portfolio_analytics` raises
    // ANALYTICS_ROW_NOT_CREATED — service_error(503, dependency="supabase"). M-5,
    // recorded and NOT gated on: this budget's only TypeScript wrapper
    // (computePortfolioAnalytics) has ZERO callers, so the arm is LATENT rather
    // than live. It becomes live the moment anyone calls that wrapper, which is
    // why the declaration is written now rather than discovered later.
    dependencies: ["supabase"],
    retries: SEAM_RETRIES,
    notes:
      "ZERO CALLERS TODAY — analytics-client's computePortfolioAnalytics is unreachable (research §4.2). Kept rather than deleted: deleting is scope creep and it is a plausible future caller. Phase 141's idempotency audit records 'no callers' for it.",
  },
  "process-key-enqueue": {
    timeoutMs: 15_000,
    dependencies: [],
    // Phase 141 / SEAM-06 — retry-safe at the ROW grain, and the row is NOT the
    // retry gate for ANY seam: since D-08 the gate is the required
    // `retriesOverride`, fed by RETRY_SAFE_FLOW_TYPES / RETRY_SAFE_ANALYTICS at
    // the two client chokepoints, and `resilientFetch` no longer reads this
    // literal at all. What it IS: the accounting statement SC-4b's headroom
    // arithmetic reads (an honest row — this budget really does perform two
    // attempts in production, and the route's lambda ceiling must be charged for
    // both). ⚠️ The row is at the WRONG GRAIN to be a gate here even in
    // principle: it serves BOTH onboard AND resync (budgetKeyFor is
    // many-to-one), while the audit that authorises the retry is per flow_type.
    // Teaser/csv live on process-key-sync (retries: 0) for the same reason.
    retries: 1,
    notes:
      "flow_type in {resync, onboard}: the server merely enqueues onto the worker dyno and returns 202 (verified in analytics-service/routers/process_key.py:_is_long_fetch). An enqueue that takes 15s means Railway is sick. Tightened from the blanket 60s; nothing observes these two budgets (research §6.4).",
  },
  "process-key-sync": {
    timeoutMs: 60_000,
    // ⚠️ ME-04 — THE PUBLIC TEASER REACHES THIS BUDGET ANONYMOUSLY
    // (verify-strategy), AND `dependencies: []` IS NOT A CONTAINMENT.
    //
    // The previous comment here said declaring nothing "keeps an
    // unauthenticated caller's blast radius at the global key alone". That
    // reads as if the global key were the small one. It is the LARGEST:
    // `breakerKeysFor` appends `BREAKER_KEY` to EVERY call site's check, so a
    // lock on `breaker:railway` blocks all fifteen routes. Declaring nothing
    // therefore puts the anonymous path on the WIDEST key in the system, not
    // the narrowest. Pinned by "ME-04: the anonymous teaser's failures land on
    // the key EVERY call site checks" in resilient-fetch.test.ts, so this
    // statement cannot quietly revert to the comfortable one.
    //
    // The exposure is real and is ACCEPTED for now, not overlooked: five
    // deadline expiries or transport failures inside the 30 s window open the
    // global circuit for every authenticated user for one cooldown, and
    // Vercel's 10 req/60 s per-IP cap is no defence against a distributed
    // caller. Fail-open is doctrine and a fail-open breaker cannot be made
    // safe against this by tightening it.
    //
    // WHY IT IS NOT FIXED HERE. The obvious fix — a dedicated `breaker:teaser`
    // key — requires a new member of `SeamServiceDependency`, which is a CLOSED
    // set hand-typed in this file, re-typed in `seam-discriminator`, pinned in
    // `seam-constants.pin.test.ts`, and mirrored by `SERVICE_DEPENDENCIES` in
    // `analytics-service/services/error_contract.py`, whose `_validate` REFUSES
    // an unknown dependency. Adding one is a cross-language change, and this
    // phase's fence is zero Python. It is also not a one-line re-key: this row
    // is MIXED — the authenticated `csv-validate` / `csv-finalize` paths spend
    // it too — so containment needs keying by CALLER, not by budget row, which
    // is a change to SEAMCORE-01's keying model. Recorded for Phase 141.
    dependencies: [],
    retries: SEAM_RETRIES,
    notes:
      "flow_type in {teaser, csv}: the full 5-method pipeline runs INLINE. MEASURE BEFORE TIGHTENING — the only latency evidence is a code comment (~10-25s typical, process-key-client CT-7); never guess a budget on the public lead-generating teaser path.",
  },
  "keys-permissions": {
    timeoutMs: 15_000,
    // `internal.py`'s `get_key_permissions` raises KEK_UNAVAILABLE and
    // KEY_UNDECRYPTABLE as 500s naming `kek`, and EXCHANGE_PROBE_FAILED as a 424
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
      "The DEAD fetch inside keys/validate-and-encrypt's _unifiedValidateAndEncryptHandler, which today has NO timeout at all. Routed through the core so any revival inherits a budget and a breaker rather than re-introducing an unbounded hang.",
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
  // ---------------------------------------------------------------------
  // TWO EXCLUSIVE VENUE BRANCHES on the three routes that validate a key,
  // and none of the three rows may be read as their sum.
  //
  //   default-venue    (`venueIsSerialized(exchange)` false — binance, okx,
  //                    bybit, deribit, sfox, and every unknown / empty /
  //                    absent venue string): the request spends
  //                    `validate-key` at 30 000 ms, exactly as it did before
  //                    plan 153.4-02.
  //   serialized-venue (`venueIsSerialized(exchange)` true — mt5 today):
  //                    the request spends `validate-key-serialized` at
  //                    120 000 ms, because the venue's probe queues behind
  //                    one shared terminal lease and its honest verdict must
  //                    fit inside the client's deadline (WIZFORM-05 / D-04).
  //
  // WHY THEY ARE MUTUALLY EXCLUSIVE. One request carries exactly ONE
  // `exchange`, and `budgetKeyFor(exchange)` in `analytics-client.ts` returns
  // exactly one budget key for it. A row that summed both arms would charge a
  // request for 150 000 ms of validation on a path no request takes.
  //
  // LABELLED BY CAPABILITY, NOT BY VENUE FAMILY. `"ccxt"` would be wrong
  // twice over — sFOX is not ccxt, and a second serialized venue would have
  // no home. These two labels mirror `VENUE_CAPABILITIES.serialized`, the one
  // fact the selector reads.
  //
  // THE SHARED LEGS ARE DELIBERATELY UNLABELLED. `encrypt-key` (and, on
  // validate-and-encrypt, the dormant `process-key-unified-dormant` leg) is
  // spent whichever venue arm was taken, so it carries no `branch` and is
  // charged to BOTH branches — which is what no label means here.
  // ---------------------------------------------------------------------
  "src/app/api/keys/validate-and-encrypt/route.ts": {
    expectedMaxDurationS: 300,
    budgets: [
      { key: "validate-key", calls: 1, branch: "default-venue" },
      { key: "validate-key-serialized", calls: 1, branch: "serialized-venue" },
      { key: "encrypt-key", calls: 1 },
      { key: "process-key-unified-dormant", calls: 1 },
    ],
  },
  "src/app/api/strategies/create-with-key/route.ts": {
    expectedMaxDurationS: 300,
    budgets: [
      { key: "validate-key", calls: 1, branch: "default-venue" },
      { key: "validate-key-serialized", calls: 1, branch: "serialized-venue" },
      { key: "encrypt-key", calls: 1 },
    ],
  },
  "src/app/api/strategies/composite/add-key/route.ts": {
    expectedMaxDurationS: 300,
    budgets: [
      { key: "validate-key", calls: 1, branch: "default-venue" },
      { key: "validate-key-serialized", calls: 1, branch: "serialized-venue" },
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
 * previously undocumented here.
 *
 * OUT-OF-REPO REFERENCE — the coordinates in the next sentence point INTO A
 * DEPENDENCY, at a pinned version, and are deliberately NOT converted to symbol
 * anchors (140.5-07; this is the one expected allowlist entry for 140.5-08's
 * seam citation guard, which otherwise forbids the bare `file:line` form). The
 * reasoning: `node_modules` is not ours to anchor into, the file is a BUILD
 * ARTEFACT with no stable symbol names to cite, and the version pin is what
 * makes the coordinates meaningful — they are reproducible for
 * `@upstash/ratelimit@2.0.8` specifically and are expected to be wrong for any
 * other version, which is the opposite of the in-repo rot this phase is
 * correcting. If the pin moves, RE-READ the artefact; do not "fix" the numbers.
 *
 * `@upstash/ratelimit@2.0.8` builds one whenever the option is omitted
 * (`dist/index.mjs:757-761`); on a DENIED `limit()` it calls
 * `ctx.cache.blockUntil(identifier, reset)` (same file, lines 1580-1585) and
 * every later call for that identifier short-circuits IN MEMORY with
 * `reason: "cacheBlock"`, never reaching Redis until the bucket ends (same file,
 * lines 1560-1569).
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
 * The widest span a LEGITIMATE lock can encode: its own cooldown plus the
 * tombstone the KEY outlives the lock by. A span longer than that describes no
 * state this module can produce — see `decodeBreakerLock`.
 *
 * DERIVED from the two constants rather than hand-typed, deliberately. The bound
 * means "as long as a lock can possibly be", not "90 000 ms", so retuning either
 * constant has to move it. It cannot drift in silence in either direction:
 * `seam-constants.pin.test.ts` pins both constants literal-against-literal, and
 * the G2 case in `resilient-fetch.test.ts` pins this ceiling against its own
 * hand-typed 90 000 from the outside.
 */
const MAX_BREAKER_LOCK_SPAN_MS =
  (BREAKER_COOLDOWN_S + BREAKER_LOCK_TOMBSTONE_S) * 1_000;

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
 *
 * ⚠️ PARSEABLE IS NOT THE SAME AS PLAUSIBLE — LO-02 / TS-39, discharged here.
 * The shape above accepts any two digit strings, so `open:0:100000000000000000`
 * used to decode to a lock ~1e17 ms in the future. `isBreakerOpen` derived
 * `retryAfterS ≈ 1e14` from it, `CircuitOpenError`'s A-15 guard accepted that
 * (`Number.isInteger` is true of it), and the value went ON THE WIRE as a
 * `Retry-After` — including to the anonymous teaser. A REVERSED pair
 * (`expiresAtMs < armedAtMs`) separately made `emitBreakerTransition`'s
 * `cooldownS` negative. A-15 exists precisely to keep implausible values out of
 * that header, and this decoder was the one remaining path that could mint one
 * which PASSED it.
 *
 * The span bound is therefore part of the parse, not a caller's duty.
 *
 * ⚠️ TWO SENTENCES THAT USED TO STAND HERE WERE WRONG, AND BOTH ARE NAMED
 * RATHER THAN QUIETLY DELETED (phase 141.2, findings 10 and 11 — the review of
 * the very change that added the span bound).
 *
 *  1. "The rejection direction is `null` — i.e. CLOSED — so corruption still
 *     fails forward, UNCHANGED." True of the read side; the opposite of true of
 *     the write side, and the write side is where it mattered. `null` conflated
 *     two different store states — "key absent" and "key present but
 *     undecodable" — and `recordSeamFailure`'s trip path branched its WRITE
 *     decision on that conflation, so a corrupt-but-present value was routed
 *     into `SET NX`, which cannot overwrite an existing key. Nothing was
 *     written, no transition was emitted, and the circuit could not open for
 *     the rest of that key's TTL. What is true now: the READ side still fails
 *     forward to CLOSED, unchanged; the WRITE side distinguishes RAW presence
 *     from a failed decode, so a corrupt value is DISPLACED and the store
 *     self-heals on the next recorded failure. See the trip path's own branch.
 *
 *  2. "PARSEABLE IS NOT THE SAME AS PLAUSIBLE … discharged here", of a bound
 *     that was purely RELATIVE. A span bound cannot see an absurd PLACE on the
 *     timeline: every lock this module writes has span exactly
 *     `BREAKER_COOLDOWN_S` seconds, so ANY pair sharing that delta passed —
 *     `open:100000000000000000:100000000000030000` decoded cleanly and still
 *     minted the ~1e14 `Retry-After` the paragraph above claims it closed. The
 *     absolute bound below is what discharges LO-02 / TS-39 for real.
 *
 * ⚠️ THE ABSOLUTE BOUND IS ONE-SIDED, DELIBERATELY. A lock in the FUTURE beyond
 * its own maximum span describes no state this module can produce. A lock in the
 * PAST is a TOMBSTONE, and `isBreakerOpen` depends on decoding tombstones to
 * announce the close — locked decision 3 makes TTL expiry the half-open
 * transition, so that read is the only moment "the circuit is usable again"
 * becomes observable. A past-side bound would report CLOSED for the right reason
 * by the wrong mechanism, and take the close event with it.
 *
 * `nowMs` is a PARAMETER with a `Date.now()` default rather than a bare call, so
 * the bound stays deterministically testable without coupling every existing
 * case to the wall clock or to a fake timer. Existing callers are unchanged.
 */
export function decodeBreakerLock(
  value: unknown,
  nowMs: number = Date.now(),
): { armedAtMs: number; expiresAtMs: number } | null {
  if (typeof value !== "string") return null;
  const parsed = /^open:(\d+):(\d+)$/.exec(value);
  if (!parsed) return null;
  const armedAtMs = Number(parsed[1]);
  const expiresAtMs = Number(parsed[2]);
  // `<= 0` covers the reversed pair AND the zero-length lock, which is already
  // expired at the instant it was armed and so is not an open circuit either.
  const spanMs = expiresAtMs - armedAtMs;
  if (spanMs <= 0 || spanMs > MAX_BREAKER_LOCK_SPAN_MS) return null;
  // ABSOLUTE plausibility, future side only — see the one-sidedness note above.
  // A live lock cannot expire further out than its own widest legitimate span.
  if (expiresAtMs > nowMs + MAX_BREAKER_LOCK_SPAN_MS) return null;
  return { armedAtMs, expiresAtMs };
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
 * Schedule a capture so it survives the response flush.
 *
 * ⚠️ COPIED FROM `audit.ts`'s `logAuditEvent` AND THE FALLBACK IS NOT OPTIONAL.
 * `after()` is only valid inside a request scope; on a non-route path (cron,
 * prerender) it throws SYNCHRONOUSLY, and this module is reachable from such a
 * path. Dropping the `queueMicrotask` arm would turn an observability concern
 * into a thrown scheduling error raised from inside a catch block — replacing
 * the real upstream error with a bookkeeping one, which is the exact failure
 * `recordSeamFailure`'s whole-body swallow exists to prevent (research
 * assumption A6).
 *
 * The capture promise's rejection is swallowed at both arms: `captureToSentry`
 * already resolves on every failure path, and letting anything escape `after()`
 * becomes an unhandled rejection that changes nothing about the already-flushed
 * response.
 */
function scheduleSeamCapture(capture: Promise<void>, event: string): void {
  try {
    after(() => capture.catch(() => {}));
  } catch {
    // Outside a request scope. Announce the fallback with the module's stable
    // prefix so log aggregation can distinguish it from the `after()` path and
    // quantify the non-route drop rate, exactly as `audit.ts` does.
    console.warn(
      "[resilient-fetch] scheduling capture via queueMicrotask fallback (non-request scope):",
      { event },
    );
    queueMicrotask(() => {
      void capture.catch(() => {});
    });
  }
}

/**
 * Emit one transition.
 *
 * ⚠️ THIS DOCBLOCK USED TO SAY *"A PLAIN STRUCTURED LOG, deliberately — it
 * performs no I/O, so there is nothing to await and TRAP-7 … cannot apply. If
 * this ever gains a network sink it must become an awaited call at both sites."*
 * It has now gained that network sink, so the condition the module set for
 * itself is live: the capture is SCHEDULED with `after()` rather than fired and
 * forgotten. A bare fire-and-forget promise is orphaned by the Fluid Compute
 * freeze the moment the response flushes — during precisely the correlated
 * incident the alert exists for (TRAP-7). `after()` hands it to `waitUntil`,
 * which holds the instance alive until the capture settles; that only works
 * because `captureToSentry` returns its import chain rather than detaching it
 * (`audit.ts`'s NEW-C10-03, re-created in `sentry-capture.ts` and fixed in plan
 * 140.4-06).
 *
 * ⚠️ THE CONSOLE LINE STAYS. It is the operator's LOCAL trace — `grep`-able in
 * the Vercel function log without a Sentry round trip — and the capture is the
 * remote one. Replacing either with the other is a regression, so both are
 * asserted.
 *
 * `console.warn`, not `error`, AND `level: "warning"` on the capture for the
 * same reason: a breaker transition is an operational fact, and the OPEN half is
 * a mitigation working. Routing it to `error` would make every recovery look
 * like a fault.
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
  scheduleSeamCapture(
    captureToSentry(new Error(`[resilient-fetch] seam.breaker.${kind}`), {
      tags: {
        surface: "seam-breaker",
        transition: kind,
        breakerKey,
      },
      // The SAME four fields, and that ceiling holds here too: a breaker key is
      // a module-derived value from a frozen closed set, never caller input.
      extra: { ...payload },
      level: "warning",
    }),
    `seam.breaker.${kind}`,
  );
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
    // SEAMRIM-04 — and the fail-OPEN posture below is UNCHANGED. A breaker that
    // refuses traffic because of its own misconfiguration is strictly worse
    // than having no breaker at all (SEAM-03); what was wrong is that this arm
    // silently removed the protection with no remote record that it had.
    // `err` goes to the chokepoint RAW deliberately: `captureToSentry` scrubs
    // unconditionally (and rebuilds the Error so Sentry's grouping and stack
    // survive), whereas pre-rendering it to a string here would hand Sentry a
    // stackless message for no security gain.
    // 140.4-16 / WR-06 — EDGE-TRIGGERED, same reasoning as `ratelimit.ts`'
    // posture-2 arm: this fires on EVERY request whose breaker probe rejects,
    // which during a store outage is every request. The console.error above is
    // unconditional; only the remote capture is throttled. Keyed on the
    // (surface, stage) pair rather than on `budgetKey`, deliberately — an
    // outage that hits twelve budgets is ONE incident, and keying per budget
    // would restore twelve times the storm.
    if (shouldCaptureNow("seam-breaker:check")) {
      scheduleSeamCapture(
        captureToSentry(err, {
          tags: { surface: "seam-breaker", stage: "check", budgetKey },
          level: "error",
        }),
        "seam.breaker.check_failed",
      );
    }
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
    // ⚠️ THE RAW VALUE IS KEPT, AND THAT IS THE WHOLE OF FINDING 10 (141.2).
    // `decodeBreakerLock` answers `null` for TWO different store states — the
    // key is ABSENT, and the key is PRESENT but undecodable — and only the first
    // of them justifies the `nx` write below. Deciding the write from `existing`
    // alone therefore sent a corrupt-but-present value into `SET NX`, which
    // cannot overwrite an existing key: no lock stored, no transition emitted,
    // and the circuit unable to open for the rest of that key's TTL across every
    // seam route. The GUARDS below still read `existing` — they are questions
    // about a lock, and a value that is not a lock cannot answer them.
    const rawLock = await redis.get<string>(breakerKey);
    const existing = decodeBreakerLock(rawLock);
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
    if (rawLock === null) {
      // The key is GENUINELY ABSENT — the raw read, not the decode, is what says
      // so (finding 10; see the note at the read above).
      //
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
      // ── OVERWRITING A PRESENT VALUE — THE BRANCH THAT ACTUALLY RACES (HI-01) ──
      //
      // Reaching here means the key HOLDS something: an expired lock whose
      // evidence this failure post-dates, or — since 141.2 / finding 10 — a
      // value this module's decoder rejects. In the tombstone case a fresh
      // cooldown is right because the previous lock has expired AND this failure
      // is new evidence gathered after it was armed. In the CORRUPT case there
      // is no lock at all, so there is nothing to preserve and displacing it is
      // how the store self-heals: the value decodes to `null`, `written` is
      // therefore true, and the transition that follows is truthful — this call
      // DID arm the circuit.
      //
      // `nx` cannot express either: the key still EXISTS, so `nx` would refuse
      // every re-arm for the whole tombstone window, and would refuse the
      // corrupt key for its entire remaining TTL.
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
    // SEAMRIM-04. The swallow is preserved — this runs inside the caller's
    // catch arm, so a throw here would replace the real upstream error — but a
    // breaker whose bookkeeping is failing is a breaker that will not trip when
    // it should, and that was invisible beyond this one console line.
    // 140.4-16 / WR-06 — EDGE-TRIGGERED. See the `check` arm above; this one
    // runs inside the caller's catch, so during a correlated upstream incident
    // it fires once per FAILED REQUEST.
    if (shouldCaptureNow("seam-breaker:record")) {
      scheduleSeamCapture(
        captureToSentry(err, {
          tags: { surface: "seam-breaker", stage: "record", breakerKey },
          level: "error",
        }),
        "seam.breaker.record_failed",
      );
    }
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
  /**
   * How many retries THIS call performs — SEAM-06's only retry input.
   *
   * ⚠️ REQUIRED, AND THE ONLY THING THAT TURNS RETRY ON. There is no fallback to
   * `SEAM_BUDGETS[budgetKey].retries`: five rows carry `retries: 1`, but the row
   * is an ACCOUNTING declaration (see the field's docblock on `SEAM_BUDGETS`),
   * never a gate. Being required is the mechanism, not a style choice — while it
   * was optional, a new call site could pick a budget key whose row happened to
   * be `1` and inherit a retry with the retry-safety registry never consulted,
   * and it typechecked (Phase 141.1 / D-08, bucket C1). Now absence does not
   * compile: every call site states a verdict.
   *
   * Where the verdict comes from: `postProcessKey` reads `RETRY_SAFE_FLOW_TYPES`
   * by `flow_type` (never by `budgetKey`, which is many-to-one and would retry
   * the deliberately non-idempotent `teaser` — CONTEXT registry-keying note);
   * the analytics seam reads `RETRY_SAFE_ANALYTICS` by its 1:1 `budgetKey`. A
   * caller outside those two chokepoints passes `0` unless it can cite an audit
   * entry.
   *
   * `0 | 1` is compile-time only, so the value is ALSO validated to the integer
   * 0 or 1 ABOVE the classification window, exactly like `timeoutMsOverride`: a
   * JS caller or an `as any` still needs the throw, a bad value is a caller
   * fault and never Railway degradation, and one retry is the whole locked
   * policy (CONTEXT — "exactly ONE retry").
   */
  retriesOverride: 0 | 1;
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
 * Outgoing header NAMES whose VALUES are credentials, lower-cased for matching.
 *
 * Hand-typed, and every member is a header this seam actually sends:
 *   authorization        `Bearer <INTERNAL_API_TOKEN>` on all three seam paths.
 *   x-user-access-token  a LIVE end-user Supabase JWT.
 *   x-tenant-claim       the signed HMAC claim that SELECTS the rate-limit bucket.
 *   x-service-key        `ANALYTICS_SERVICE_KEY` on the analytics client.
 *   x-internal-token     the same internal token under its other name.
 *
 * `x-user-id` and `x-correlation-id` are deliberately ABSENT: a tenant id and a
 * trace id are diagnostics, not credentials, and redacting them would cost the
 * operator the two fields that make a seam line correlatable.
 */
const CREDENTIAL_HEADER_NAMES: readonly string[] = [
  "authorization",
  "x-user-access-token",
  "x-tenant-claim",
  "x-service-key",
  "x-internal-token",
];

/**
 * Phase 140.3-02 / TS-15 — the PER-REQUEST secret values on THIS request.
 *
 * ⚠️ WHY THIS EXISTS, AND WHY IT IS DERIVED FROM THE HEADERS RATHER THAN
 * DECLARED BY THE CALLER. `seam-redaction`'s env list (`SEAM_SECRET_ENV_NAMES`)
 * covers secrets whose values live in `process.env` — it structurally CANNOT
 * cover a live end-user Supabase JWT, which is per-request data. So the core's
 * own transport log scrubbed `Authorization` and left `X-User-Access-Token`
 * VERBATIM in the line, while the comment two lines below claimed it removed
 * "every credential undici inlined into the message".
 *
 * That was a LIVE leak, not a latent one, and it predates this plan:
 * `strategies/csv-finalize` has forwarded that JWT through this exact core since
 * Phase 19.1. The client's own log site was covered by plan 140.2-08 (it passes
 * `args.userAccessToken` explicitly); THIS site was not, because its enumeration
 * was of the CLIENT's sites. Found by execution, not by reading, when 140.3-02
 * drove a token-bearing transport error through the route — recorded in that
 * plan's SUMMARY as a correction to 140.2-08's count.
 *
 * DERIVED, NOT DECLARED, and that is the class fix rather than a point fix: any
 * credential-bearing header the core is ASKED TO SEND is scrubbed from the
 * core's own log whichever caller supplied it. A `secrets: []` option on the
 * call site would be convention — a caller who forgets is silently back to
 * leaking, which is the failure mode this whole programme exists to close.
 *
 * TOTAL BY CONSTRUCTION: it feeds a catch block, so every branch returns and
 * nothing propagates. All three `HeadersInit` shapes are handled because the
 * core does not control how a caller spells its headers.
 */
function credentialHeaderValues(init: RequestInit | undefined): string[] {
  const values: string[] = [];
  try {
    const headers = init?.headers;
    if (!headers) return values;
    const push = (name: string, value: unknown) => {
      if (
        typeof value === "string" &&
        value.length > 0 &&
        CREDENTIAL_HEADER_NAMES.includes(name.toLowerCase())
      ) {
        values.push(value);
      }
    };
    if (headers instanceof Headers) {
      headers.forEach((value, name) => push(name, value));
    } else if (Array.isArray(headers)) {
      for (const pair of headers) push(pair?.[0] ?? "", pair?.[1]);
    } else {
      for (const [name, value] of Object.entries(headers)) push(name, value);
    }
  } catch {
    // A hostile or exotic headers object must not replace the caller's real
    // error with a bookkeeping one. An empty list degrades to the pre-fix
    // behaviour for THIS line only, which is strictly no worse than throwing.
    return values;
  }
  return values;
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
      //
      // NO `&& bodyVerdict.breakerKey !== null` (140.5-07 / WP-13). `counts`
      // narrows the verdict to its counting member, on which `breakerKey` is
      // `string`, so that conjunct was dead — and its dead FALSE branch had no
      // else, i.e. it silently dropped a countable failure. See
      // `SeamBreakerVerdict`.
      const bodyVerdict = seamBreakerVerdict(null);
      if (bodyVerdict.counts) {
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
 * Does this response carry the upstream's OWN contractual wait hint?
 *
 * Phase 141.1 / D-01. `error_contract.service_error` makes `Retry-After`
 * MANDATORY on every SERVICE-TRANSIENT 503 it emits — its `_validate` refuses to
 * raise one without it — drawn from a table of 15s (supabase) / 30s
 * (mt5-gateway). A 503 that names a wait is the upstream saying "not yet", and
 * the retry backoff is three orders of magnitude shorter than the shortest wait
 * it advertises.
 *
 * WHY ONLY 503, mirroring `readDependencyBody`'s discipline exactly: 503 is the
 * ONE status the contract obliges to carry the header. The other counting 5xx
 * (502/504) come from the platform EDGE, outside that contract, so a header
 * arriving on one of those is not our upstream telling us anything and must not
 * gate the retry.
 *
 * ⚠️ CAPABILITY-CHECKED, for the same reason `readDependencyBody` checks
 * `clone`: `SeamResponse` is deliberately structural so route tests can stub the
 * core with a `Response`-shaped object, and several existing fixtures are bare
 * `{ ok, status }` literals with no `headers` at all. A missing `headers.get`
 * must degrade to "no hint", never throw — a throw here lands inside the
 * classification window and would replace the real upstream error with a
 * bookkeeping one. `parseRetryAfterSeconds` defends the same way, so the local
 * check is the belt in front of its braces, not a duplicate of it: it also
 * rejects a `get` that is present but not callable.
 *
 * ⚠️ THE VALUE IS PARSED (Phase 141.2 / D-06, finding 9). This used to read
 * `headers.get("Retry-After") !== null` and its docblock said *"Only presence is
 * tested, so a malformed or hostile value cannot influence timing or logs"*.
 * That was unsound: presence asserts the EMITTER'S contract without verifying
 * the responder is bound by it. A `Retry-After: 0` means "retry now" (RFC 9110
 * §10.2.3), and an empty or garbage value names no wait at all — yet all three
 * suppressed the retry and handed the caller attempt 1's 503, for exactly the
 * transient blip the retry exists to absorb.
 *
 * The predicate now DELEGATES to `parseRetryAfterSeconds` (B20 — the ONE
 * `Retry-After` parser in this repo, enforced by the `no-raw-retry-after-parse`
 * contract). Its contract IS this gate's predicate: strictly positive seconds,
 * or `null` for absent / empty / zero / negative / unparseable. It covers BOTH
 * RFC 9110 forms — delta-seconds, and an HTTP-date resolved against the
 * response's OWN `Date` header, so a skewed client clock cannot distort the
 * delta (no `Date` header ⇒ not reliably knowable ⇒ `null`). A date-form wait is
 * a contractual wait like any other and fails fast; there is no deliberate gap
 * here to work around. Do not hand-roll a second parse of this header.
 *
 * THE SAFETY PROPERTY SURVIVES VERBATIM: the parsed seconds are DISCARDED at the
 * `!== null`. No `Retry-After` value reaches a sleep, a log or a timer — only the
 * boolean changed.
 *
 * Scope, honestly: `error_contract.service_error` raises on a non-positive
 * `retry_after` and refuses to emit a 503 without the header, so the only
 * contract-bound emitter we own CANNOT produce the values above. Whether the
 * platform edge can is UNVERIFIED — no such response has been captured. This is
 * a repair to a check that was unsound by construction, not a fix for an
 * observed production trace.
 */
function hasContractualWait(res: Response): boolean {
  if (res.status !== 503) return false;
  if (typeof res.headers?.get !== "function") return false;
  return parseRetryAfterSeconds(res.headers) !== null;
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
/** Resolve after `ms` milliseconds — the retry backoff, extracted to one line. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function resilientFetch(
  budgetKey: SeamBudgetKey,
  path: string,
  init: ResilientFetchInit,
): Promise<SeamResponse> {
  const { timeoutMsOverride, retriesOverride, ...requestInit } = init;

  // ── ABOVE THE WINDOW ────────────────────────────────────────────────────
  // Everything from here to the `try` is a CALLER or CONFIG fault if it fails,
  // and none of it may be recorded as Railway degradation (A-22 / A-28).

  // A-28. `AbortSignal.timeout()` itself rejects these — NaN and a non-number
  // with a TypeError, a negative or absurd value with a RangeError — and it
  // used to do so from INSIDE the try. Validate at entry instead, and name the
  // offending value: it is a number the caller passed, never a secret.
  // ⚠️ A VALUE CHECK, NOT `"timeoutMsOverride" in init` (ME-03). The declared
  // type is `timeoutMsOverride?: number`, and under this repo's tsconfig (no
  // `exactOptionalPropertyTypes`) an explicit `undefined` is type-IDENTICAL to
  // an absent property. Testing PRESENCE therefore drew a distinction `tsc`
  // cannot express: `{ ...base, timeoutMsOverride: maybeOverride }` — the
  // ordinary way to forward an optional value — became a hard `SeamConfigError`
  // whenever `maybeOverride` was undefined, which both clients then render as a
  // dead upstream. `analytics-client` dodges it with a conditional spread, but
  // that is a convention at one call site, not a mechanism. An explicit
  // `undefined` now takes the row's declared budget, exactly as omitting the
  // property does.
  if (timeoutMsOverride !== undefined) {
    if (
      typeof timeoutMsOverride !== "number" ||
      !Number.isFinite(timeoutMsOverride) ||
      timeoutMsOverride < MIN_TIMEOUT_MS ||
      timeoutMsOverride > MAX_TIMEOUT_MS
    ) {
      // ME-01 — LOG BEFORE THROWING, matching both URL branches below. This
      // branch used to throw silently, so an invalid override was invisible in
      // the operator log AND wore a dead-upstream envelope downstream. The
      // value is a number the caller passed, never a secret, so naming it is
      // safe and is the whole point.
      console.error(
        `[resilient-fetch] ${budgetKey}: CONFIG fault — invalid timeoutMsOverride ${String(timeoutMsOverride)}. This is a caller/deployment misconfiguration, NOT an analytics-service failure.`,
      );
      throw new SeamConfigError(
        `[resilient-fetch] ${budgetKey}: invalid timeoutMsOverride ${String(timeoutMsOverride)} — expected a finite number of milliseconds between ${MIN_TIMEOUT_MS} and ${MAX_TIMEOUT_MS}`,
      );
    }
  }
  const timeoutMs = timeoutMsOverride ?? SEAM_BUDGETS[budgetKey].timeoutMs;

  // SEAM-06 / D-08. `retriesOverride` is a REQUIRED `0 | 1`, so there is no
  // `!== undefined` guard to write and no ME-03 present-vs-absent question to
  // answer: absence does not compile. The check below is not redundant with the
  // type — `0 | 1` erases at runtime, and a JS caller or an `as any` can still
  // hand this function a `2`, a NaN or a string. One retry is the whole locked
  // policy, so the only legal values are 0 and 1; anything else is a caller bug
  // and is raised HERE, above the classification window, so a config typo can
  // never be recorded as Railway degradation (the reason `SeamConfigError`
  // exists — see its docblock).
  if (
    typeof retriesOverride !== "number" ||
    !Number.isInteger(retriesOverride) ||
    retriesOverride < 0 ||
    retriesOverride > 1
  ) {
    console.error(
      `[resilient-fetch] ${budgetKey}: CONFIG fault — invalid retriesOverride ${String(retriesOverride)}. This is a caller misconfiguration, NOT an analytics-service failure; the only legal values are 0 and 1.`,
    );
    throw new SeamConfigError(
      `[resilient-fetch] ${budgetKey}: invalid retriesOverride ${String(retriesOverride)} — expected the integer 0 or 1`,
    );
  }
  // The caller's verdict, and nothing else. The row fallback that used to sit
  // here is gone (D-08): it let a hand-picked budget key inherit a retry with
  // the retry-safety registry never consulted.
  const retries = retriesOverride;

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
   *
   * ⚠️ A `let`, REASSIGNED PER ATTEMPT — see the per-attempt-state note below and
   * the recapture inside the loop's `attempt > 0` block.
   */
  let admittedAtMs = Date.now();

  /**
   * ONE ATTEMPT records AT MOST ONE failure, whichever arm classifies it.
   *
   * Wave 5 moved the body read inside the classification window and left this
   * interaction open deliberately: a counting status AND a body that then aborts
   * are two arms observing ONE degraded request. Recording both halves the
   * failures needed to trip, so five genuinely-distinct incidents' worth of
   * protection would fire after two or three — a breaker that opens early is
   * still an outage it created itself.
   *
   * A latch rather than an ordering rule: the arms cannot be ordered, since the
   * body read happens whenever the CALLER chooses to read it, arbitrarily later.
   *
   * ⚠️ SEAM-06 Class D — THE LATCH IS PER-ATTEMPT, RESET AT THE TOP OF EACH LOOP
   * ITERATION. Within one attempt the status+body dedup above still holds, but a
   * RETRIED attempt is a distinct request as far as the breaker is concerned:
   * two failing transient attempts must advance the counter TWICE, or a retried
   * outage would take twice as many requests to trip. `recordOnce` closes over
   * `recorded`, so resetting `recorded` below re-arms the same closure — and the
   * closure handed to `instrumentBody` after the loop therefore carries the LAST
   * attempt's latch, which is correct: a post-return body-read failure belongs
   * to the attempt that produced the response.
   *
   * ⚠️ THE LATCH IS NOT THE ONLY PER-ATTEMPT STATE — `admittedAtMs` IS THE OTHER
   * (141.2 / finding 5, D-09), and it was missed when the loop was introduced.
   * A-25's predicate, stated in `recordSeamFailure`, is "was this request
   * already IN FLIGHT when that lock was armed" — and "in flight" is a property
   * of an ATTEMPT, not of the logical request: attempt 2 is admitted separately,
   * past its own re-check of a by-then-expired lock, so its failure is evidence
   * gathered entirely AFTER the arming and must be allowed to re-arm the
   * circuit. Captured once above the loop, that timestamp made every retried
   * wave's evidence look stale — on the 30 s `optimize-weights` budget the
   * breaker could never re-arm from a retried call at all, so allocators waited
   * 60 s+ per click instead of receiving an immediate circuit error. Reassigned
   * below, immediately after the pre-attempt re-check passes, for the same
   * reason `recorded` is reset there: `recordOnce` closes over the binding, so
   * the recording arms and the post-return `instrumentBody` closure all carry
   * the LAST admitted attempt's instant — the attempt that produced what they
   * are recording.
   */
  let recorded = false;
  async function recordOnce(breakerKey: string): Promise<void> {
    if (recorded) return;
    recorded = true;
    await recordSeamFailure(breakerKey, admittedAtMs);
  }

  // ── THE RETRY LOOP (SEAM-06) ────────────────────────────────────────────
  // Bounded by `1 + retries`, with `retries ∈ {0, 1}` (validated above). At
  // retries=0 — every caller whose registry verdict is 0, which is every call
  // site outside the audited allowlist — this runs exactly once and is
  // behaviourally byte-equivalent to the pre-141 single-attempt path.
  // Retry-eligible outcomes are ONLY the
  // counting/transient classes: a transport throw (what `seamBreakerVerdict(null)`
  // counts) and a response whose `verdict.counts` is true (503/other-5xx). A
  // 2xx or a 4xx returns immediately. `SeamConfigError` was raised above the
  // loop; `CircuitOpenError` from the pre-attempt re-check is thrown from ABOVE
  // the fetch `try`, so nothing in the loop can catch or swallow it (SC4 /
  // T-141-03).
  //
  // ⚠️ Phase 141.1 / D-17 — WHY A STATUS IS CARRIED ACROSS ITERATIONS. `res` is
  // declared INSIDE the loop body and is out of scope at the pre-attempt-2
  // re-check, so the `CircuitOpenError` arm below could not name the response it
  // was discarding. This is the minimal carry: the STATUS NUMBER only.
  //
  // ⚠️ DO NOT "SIMPLIFY" THIS BY HOISTING `res` ITSELF. A `Response` hoisted out
  // of the loop keeps a body stream — and the credentials any error rendered
  // from it could inline — alive across the backoff and into the next attempt,
  // which is exactly the leak lifetime the H2 class names. A number cannot leak.
  let lastCountingStatus: number | undefined;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const lastAttempt = attempt === retries;

    if (attempt > 0) {
      // Fixed backoff + jitter, THEN re-check. Jitter (`Math.random() ×
      // SEAM_RETRY_JITTER_MAX_MS`) decorrelates concurrent callers that all
      // failed on the same blip so they do not retry in lock-step (T-141-04).
      // Waiting before the re-check means the read that gates the retry is the
      // freshest one — the breaker may have opened DURING the backoff.
      await sleep(SEAM_RETRY_BACKOFF_MS + Math.random() * SEAM_RETRY_JITTER_MAX_MS);

      // SC4 — the EXACT entry gate (the `isBreakerOpen` + `CircuitOpenError`
      // throw above this retry loop), re-run before attempt 2. The
      // breaker may have opened from attempt 1's OWN recorded failure or from a
      // concurrent caller; a retry that fired anyway would amplify the very
      // outage the breaker exists to contain. Thrown here, above the fetch try.
      const reBreaker = await isBreakerOpen(budgetKey);
      if (reBreaker.open) {
        // ⚠️ Phase 141.1 / D-17 — THE DIAGNOSIS DIES HERE OTHERWISE. The caller
        // is about to receive a `CircuitOpenError` instead of attempt 1's
        // response, and that response carried the freshest fact available: the
        // status, and on a 503 the `dependency` and `human_message` the caller
        // USED to receive on this path pre-141. The response itself cannot be
        // surfaced (the breaker is open; the point is not to serve it), so the
        // status is logged rather than silently dropped.
        //
        // Same discipline as the transport arm below: the budget key is a
        // module-derived value from a closed set, and the status is a number.
        // The path, the body and every header value stay OUT.
        console.error(
          `[resilient-fetch] ${budgetKey}: breaker opened between attempts — ` +
            `discarding attempt ${attempt}'s ` +
            (lastCountingStatus === undefined
              ? "transport failure (no status line)"
              : `${lastCountingStatus} response`) +
            " and returning a circuit error instead",
        );
        throw new CircuitOpenError(
          reBreaker.retryAfterS ?? DEFAULT_RETRY_AFTER_S,
        );
      }

      // ── PER-ATTEMPT ADMISSION RECAPTURE (141.2 / finding 5, D-09) ──────────
      // This attempt has just been admitted past a circuit re-checked HERE, and
      // this is the instant it happened. It has to be taken AFTER the throw
      // above, not before the re-check: an attempt the breaker refuses is never
      // admitted at all, and stamping it as though it were would hand A-25 an
      // admission that no request ever had. See the per-attempt-state note above
      // `recorded` for why the guard's predicate is per attempt.
      admittedAtMs = Date.now();
    }

    // Per-attempt latch reset (Class D).
    recorded = false;

    // Design A: each attempt gets its OWN fresh per-attempt deadline. Total
    // worst case is `timeoutMs × (1 + retries) + backoff`; restricting the
    // override to headroom-safe routes is plan 04's job (SC-4b). Constructed
    // after the breaker check so the budget covers the REQUEST, not the store
    // round-trip that decides whether to make one.
    const deadline = AbortSignal.timeout(timeoutMs);

    // ── THE CLASSIFICATION WINDOW ─────────────────────────────────────────
    let res: Response;
    try {
    // Headers, body, and cache pass through byte-for-byte. A dropped
    // `Authorization` turns a working call into a 401 the breaker would then
    // count as degradation, and a dropped `X-Service-Key` silently
    // unauthenticates every analytics call.
    //
    // (`X-User-Id` is forwarded too. It is SERVER-DERIVED at all five callers —
    // `process-key-client` sends `args.userId`, which is `user.id` or the
    // literal `"public"` at every caller route — but it travels UNSIGNED, so it
    // is deliberately NOT what the Python limiter buckets on; the signed
    // `X-Tenant-Claim` is.
    //
    // ⚠️ TWO CORRECTIONS HAVE NOW LANDED ON THIS ONE COMMENT, so read the next
    // edit carefully. An earlier version claimed dropping `X-User-Id` re-opens
    // the CT-4 cross-tenant rate-limit defect — false. Its replacement called
    // the header "UNSIGNED client input" — also false, and in the direction
    // that matters, because "client input" implies a caller can choose it and
    // no caller can. Unsigned ON THE WIRE is the true statement and the one
    // that actually justifies the limiter's choice.)
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
    //
    // ⚠️ Phase 140.3-02 / TS-15 — THE SECOND ARGUMENT IS LOAD-BEARING AND WAS
    // MISSING. The env list cannot reach a per-request credential, so this line
    // scrubbed `Authorization` and shipped `X-User-Access-Token` — a LIVE
    // end-user Supabase JWT — verbatim. See `credentialHeaderValues` for the
    // full statement; do not drop the argument to "simplify" the call.
    console.error(
      deadlineExceeded
        ? `[resilient-fetch] ${budgetKey}: deadline exceeded after ${timeoutMs}ms`
        : `[resilient-fetch] ${budgetKey}: network failure reaching the analytics service: ${scrubSeamError(err, credentialHeaderValues(requestInit))}`,
    );
    // No status line at all, so the verdict is TRANSPORT and the key is the
    // residual global one. Asked of the discriminator rather than hardcoded here
    // so there is exactly ONE definition of that mapping.
    // The null-key conjunct is GONE here too — see the `SeamBreakerVerdict`
    // union. `counts` is the whole discriminator; a counting verdict always
    // names a key.
    const transportVerdict = seamBreakerVerdict(null);
    if (transportVerdict.counts) {
      await recordOnce(transportVerdict.breakerKey);
    }
    // A transport failure IS retry-eligible. On the last attempt, rethrow the
    // ORIGINAL error UNWRAPPED, exactly as the single-attempt path always has —
    // both clients map `err.name` onto their own typed errors
    // (AnalyticsTimeoutError / UPSTREAM_TIMEOUT), and wrapping here would
    // silently reclassify every timeout in the codebase. Otherwise loop for the
    // one retry; the pre-attempt-2 breaker re-check runs at the top.
    if (lastAttempt) {
      throw err;
    }
    continue;
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
  //
  // ⚠️ THE THIRD AND ONLY DYNAMIC ONE. The two arms above ask
  // `seamBreakerVerdict(null)`, whose verdict is a constant; this is the site
  // where the status and body actually decide. It carried the same dead
  // `&& verdict.breakerKey !== null` conjunct, and here it mattered most: a 503
  // is the one arm that can name a dependency, so this is where a keyless
  // counting verdict would have been dropped in production. Deleted — `counts`
  // narrows `breakerKey` to `string`. Pinned at runtime by
  // `seam-breaker-failopen.regression.test.ts`.
    const verdict = seamBreakerVerdict(res.status, await readDependencyBody(res));
    if (verdict.counts) {
      await recordOnce(verdict.breakerKey);
      // A counting status is retry-eligible too. Not the last attempt → discard
      // this response and loop for the one retry; last attempt → fall through
      // and RETURN it, so a caller still sees the 503 body its contract reads.
      //
      // ⚠️ Phase 141.1 / D-01 — HONOUR THE UPSTREAM'S OWN CONTRACT. Every
      // SERVICE-TRANSIENT 503 this service emits carries a mandatory
      // `Retry-After` (see `hasContractualWait`). Retrying inside the backoff is
      // near-certain to fail AND spends a second breaker failure learning that,
      // on billed lambda wall clock. So a 503 that NAMES a wait fails fast: fall
      // through and RETURN attempt 1's response with its body intact. Attempt
      // 1's own failure is still recorded — `recordOnce` above runs first,
      // because the 503 did happen; what is not spent is the SECOND one.
      //
      // The jittered backoff above is UNCHANGED for the transport/timeout
      // class, which is the dominant Railway-blip class and carries no response
      // at all, let alone a header to honour. A 429 never reaches this arm —
      // `seamBreakerVerdict` classifies it `counts: false`.
      lastCountingStatus = res.status;
      if (!lastAttempt && !hasContractualWait(res)) {
        // ⚠️ Phase 141.1 / D-17 — THIS ARM USED TO BE SILENT, AND IT IS THE ONE
        // ARM THAT SHOULD NOT BE. A 503 that is retried and then succeeds is
        // invisible to the caller by design, and it is also the ONLY signal that
        // a dependency is degrading BELOW the breaker threshold. With no line
        // here the retry loop made the seam quieter than the single-attempt path
        // it replaced: the transport arm below logs, this one did not.
        //
        // ⚠️ THE SENTENCE SAYS "RETRYING", AND THAT IS LOAD-BEARING. Since D-01
        // this arm has TWO exits — this `continue`, and a fall-through that is
        // either the D-01 fail-fast (the 503 named its own wait) or the last
        // attempt surrendering. Only the RETRY is logged, and it says so, so a
        // line here can never be misread as a surrender. Do not generalise this
        // message to cover the fall-through without splitting it in two: a
        // fail-fast and a last-attempt surrender are different operator facts,
        // and one sentence covering both would report neither.
        //
        // Log discipline, verbatim from the transport arm: the BUDGET KEY (a
        // module-derived value from a frozen closed set) and the STATUS (a
        // number). Never the path — that is caller input — and never
        // `requestInit`, whose headers and body carry raw exchange API secrets,
        // `INTERNAL_API_TOKEN` and a live end-user Supabase JWT. If an error
        // object is ever rendered into this line it goes through
        // `scrubSeamError(err, credentialHeaderValues(requestInit))` with BOTH
        // arguments; see the TS-15 incident note on the transport arm for what
        // dropping the second one shipped. Pinned from the outside by the
        // sentinel case SC-M′.
        console.error(
          `[resilient-fetch] ${budgetKey}: attempt ${attempt + 1} of ` +
            `${retries + 1} returned ${res.status} — retrying after backoff`,
        );
        continue;
      }
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

  // Unreachable: every path inside the loop returns or throws. Present so the
  // function's control flow is total for the type checker without a non-null
  // assertion or a mutable `res` hoisted out of the loop.
  throw new Error(
    "[resilient-fetch] retry loop exited without returning — unreachable",
  );
}
