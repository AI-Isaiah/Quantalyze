import { NextResponse, after } from "next/server";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { scrubSeamError } from "./seam-redaction";
import { captureToSentry } from "./sentry-capture";

/**
 * Upstash rate-limit helpers for sensitive routes.
 *
 * Behavior matrix (P709, audit-2026-05-07):
 *
 *   Environment      | Upstash configured | Upstash throws | Result
 *   -----------------+--------------------+----------------+--------------------
 *   production       | yes                | no             | enforce limiter
 *   production       | yes                | yes            | fail-CLOSED → 503
 *   production       | no                 | n/a            | fail-CLOSED → 503
 *   non-prod (dev,   | yes                | no             | enforce limiter
 *   preview, test,   | yes                | yes            | fail-OPEN + warn
 *   CI)              | no                 | n/a            | fail-OPEN + warn
 *
 * Rationale: a misconfigured production deploy must NOT silently disable
 * rate limiting on cost-sensitive endpoints (GDPR export 1/day, CSV
 * validate, audit-log export). Pre-P709 behavior fell open on missing env
 * vars, which effectively removed the regulatory cadence cap. Production
 * now treats a missing limiter as a 503 Service Unavailable signal so the
 * upstream lambda startup or canary catches the misconfig before any
 * abuse window opens.
 *
 * Outside production we keep fail-OPEN so `npm run dev` works without an
 * Upstash account, with a console.warn so devs notice during the first
 * request rather than silently sailing through.
 *
 * "Production" is gated on `VERCEL_ENV === 'production'`, NOT
 * `NODE_ENV === 'production'`. `next start` always sets NODE_ENV=production
 * — including in the GitHub Actions e2e job where Upstash is intentionally
 * unwired — so the NODE_ENV gate would convert every audit-log/GDPR-export
 * call into a 503 and break the playwright download specs. `VERCEL_ENV`
 * is Vercel's authoritative deploy-target marker: `production` on real
 * prod deploys, `preview` on PR previews, `development` for `vercel dev`,
 * and unset in CI / local `next start` runs. See the regression test
 * `fails OPEN in CI (next start with NODE_ENV=production but VERCEL_ENV
 * unset)` in ratelimit.test.ts.
 *
 * Complementary to the in-memory `acquirePdfSlot` semaphore in
 * `src/lib/puppeteer.ts`. The semaphore caps per-lambda Chromium concurrency
 * (OOM protection); these limiters cap cross-lambda request rate (abuse
 * protection). Both layers should stay in place.
 */

function isProduction(): boolean {
  return process.env.VERCEL_ENV === "production";
}

const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? Redis.fromEnv()
    : null;

if (!redis) {
  if (isProduction()) {
    // Fail-CLOSED in production: surface loudly so the deploy is visibly
    // misconfigured rather than silently uncapped. process.emitWarning
    // appears in lambda startup logs alongside the boot trace.
    console.error(
      "[ratelimit] UPSTASH_REDIS_REST_URL not configured in production — rate limiting will fail-CLOSED (503).",
    );
    try {
      process.emitWarning(
        "Upstash rate-limit env vars missing in production; affected routes will respond 503.",
        "QuantalyzeRateLimitMisconfig",
      );
    } catch {
      // emitWarning is best-effort; do not crash the module load.
    }
  } else {
    // Log once at module load, not per request.
    console.warn(
      "[ratelimit] UPSTASH_REDIS_REST_URL not configured — rate limiting disabled (all requests allowed through in dev/preview).",
    );
  }
}

function makeLimiter(
  requests: number,
  window: `${number} s`,
): Ratelimit | null {
  if (!redis) return null;
  return new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(requests, window),
    analytics: true,
    prefix: "quantalyze",
  });
}

// 5/minute per authenticated user — sensitive POSTs (attestation, deletion requests).
export const userActionLimiter = makeLimiter(5, "60 s");

// 30/minute per authenticated user — AGGREGATE ceiling for /api/keys/sync, which
// is bucketed per-(user, strategy) at userActionLimiter for fairness (one
// allocator's concurrent strategy resyncs must not starve each other). This
// per-user ceiling re-caps total endpoint volume so an authenticated caller
// can't bypass the limit by varying strategy_id across unbounded UUIDs (F6
// red-team). 30/min comfortably covers a multi-strategy allocator's real syncs.
export const keysSyncUserLimiter = makeLimiter(30, "60 s");

// 60/minute per authenticated user — Phase 95 / PROG-02 stitch-progress poll.
// GET /api/strategies/[id]/sync-progress is polled by the composite wizard up to
// every 3s (~20/min) per strategy while a stitch runs; 60/min gives 2-tab
// headroom without enabling enumeration at scale. Keyed per (user, strategy) so
// a foreign id can only exhaust its own throwaway bucket, and the isUuid 400
// (before the limiter) bounds the keyspace to real UUIDs. Read-appropriate:
// higher than the write limiters since the projection read is cheap + idempotent.
export const syncProgressLimiter = makeLimiter(60, "60 s");

// 10/minute per IP — public GETs (PDF routes) exposed to crawlers and scrapers.
export const publicIpLimiter = makeLimiter(10, "60 s");

// 20/minute per IP — admin actions that burst during normal use (match recompute,
// partner imports).
export const adminActionLimiter = makeLimiter(20, "60 s");

// 20/hour per authenticated user — portfolio impact simulator. Caps the
// compute-intensive weighted-covariance Python endpoint at roughly one
// exploration session per hour.
export const simulatorLimiter = makeLimiter(20, "3600 s");

// 1/day per authenticated user — GDPR export (Task 7.3). The export route
// streams a JSON bundle of the user's entire data footprint, which is
// relatively expensive to assemble (tens of tables, potentially hundreds
// of MB of raw fills). One call per user per 24h is the regulatory cadence
// we commit to: a user who needs their bundle more often can ask an admin.
//
// Upstash's sliding window accepts arbitrary second-scale durations, so
// `86400 s` is a valid window literal. A separate limiter (not piggybacked
// onto userActionLimiter) keeps the export quota isolated from the 5/min
// budget the rest of the sensitive-action surface shares.
export const exportLimiter = makeLimiter(1, "86400 s");

// 60/minute per authenticated user — Phase 5 curves endpoint (Voice-D10,
// 2026-04-19). Widget expand-row triggers 1 fetch per
// (outcomeId, windowId) combo; ~60 expansions per exploration session
// is realistic. Kept distinct from userActionLimiter (5/min sensitive
// POSTs) so curve-exploration does not burn budget reserved for
// attestation / deletion / GDPR actions. See
// .planning/phases/05-outcomes-dashboard/VOICES-ACCEPTED.md D10.
export const bridgeOutcomeCurvesLimiter = makeLimiter(60, "60 s");

// 30/minute per authenticated user — Phase 2 mandate auto-save (WR-02).
// MandateForm fans a single mandate edit out into 8+ field-level PUTs
// (3 strategy chips + 2 exchange chips + max_weight slide + ticket-size
// blur + archetype blur is a realistic burst). userActionLimiter at
// 5/min would 429 on the 6th save and surface "Saving too fast" mid-edit.
// 30/min absorbs that burst, leaves headroom for a second pass, and
// stays well under abuse thresholds for the auth-only PUT path.
export const mandateAutoSaveLimiter = makeLimiter(30, "60 s");

// 30/minute per authenticated user — /api/notes PATCH multi-scope autosave
// (M-1140 / M-1141, audit-2026-05-07). The note editor fires a blur-driven
// upsert per scope the allocator touches (portfolio / holding /
// bridge_outcome / strategy), so a review session realistically bursts a few
// saves a minute. Before this limiter the route had NO rate cap at all: an
// authed allocator could upsert ~6 GB/hr of arbitrary text into user_notes
// (each call ran an ownership SELECT + upsert + audit RPC). 30/min mirrors the
// mandate-autosave cadence and absorbs a real burst; kept as a distinct named
// bucket so notes throughput stays independent of the mandate editor's.
export const notesUpsertLimiter = makeLimiter(30, "60 s");

// 60/minute per authenticated user — preferences GET (NEW-C07-05).
// GET /api/preferences is an unbounded SELECT * on the authenticated
// user's row with no rate-limit gate. An authenticated allocator can
// script arbitrary GETs, inflating Supabase egress with no cap. 60/min
// is well above any legitimate page-load or data-refresh cadence (a
// typical session loads this once per page mount) while still capping
// malicious scripted polling at a reasonable ceiling. Read-appropriate:
// higher than the write limiter since reads are cheaper and idempotent.
export const preferencesReadLimiter = makeLimiter(60, "60 s");

// 60/minute per authenticated user — Phase 42 / PEER-03 scenario peer-rank.
// POST /api/scenario/peer-rank ranks the composer's hypothetical blend against
// the verified-strategy cohort via the get_verified_cohort_rank SECURITY
// DEFINER RPC. This limiter is a LOAD-BEARING PROBE-RESISTANCE SECURITY CONTROL
// (rls-audit, not just UX): the RPC's three returned percentiles are continuous
// in the caller's three metric inputs, so an authed allocator scripting
// unbounded rank calls could binary-search an individual peer's metric across
// repeated probes (egress amplification + a per-peer inference oracle). The
// migration's decile-quantization and THIS rate-limit are the two documented
// load-bearing controls against that probe oracle. 60/min sits above any
// legitimate cadence — the panel fires one rank per blend recompute, and reads
// are idempotent + cheap (mirrors preferencesReadLimiter's rationale) — while
// capping a scripted probe at a low ceiling. Kept as a distinct named bucket so
// the security cap is independent of the preferences read budget.
export const scenarioPeerLimiter = makeLimiter(60, "60 s");

// 20/minute per authenticated user — Phase 15 / CSV-01..CSV-02 (WR-02).
// CSV iteration realistically spends 3-5 validations per minute as the
// user fixes monotonic_dates / nav_non_zero errors and re-uploads. The
// shared userActionLimiter (5/min) collides with attestation + deletion
// budgets: a user iterating on a CSV burns the bucket and 429s their
// next sensitive POST with no visible link between the surfaces. The
// upstream Python service has its own 30/hour cap (routers/csv.py:28),
// so 20/min on the Next.js edge is aligned with both end-user iteration
// and the upstream budget. Used by /api/strategies/csv-validate AND
// /api/strategies/csv-finalize so the wizard's validate→submit cycle
// rides the same dedicated bucket.
export const csvValidateLimiter = makeLimiter(20, "60 s");

// 10/hour per authenticated user — Phase 11 review fix IN-03 audit-log
// CSV export. The endpoint caps the SELECT at 10K rows so a single
// response is bounded at ~2 MB, but a malicious authenticated user
// could script an N-per-second hit to inflate Supabase egress without
// bound. 10/hour is well above any legitimate compliance/forensic
// review cadence (one allocator export per hour leaves room for
// re-runs after fix-ups) and well below abuse thresholds. Distinct
// from exportLimiter (1/day for the heavier full-account GDPR bundle).
export const auditLogExportLimiter = makeLimiter(10, "3600 s");

/**
 * Discriminated result of `checkLimit`. The denial branch always
 * carries `retryAfter` (so existing callers that read `rl.retryAfter`
 * after `if (!rl.success)` keep working post-P709) and OPTIONALLY
 * carries `reason: "ratelimit_misconfigured"` for the fail-CLOSED
 * production-misconfig path. Callers that want to translate misconfig
 * into a 503 should use `isRateLimitMisconfigured(rl)`; callers that
 * only need to deny continue to surface a 429.
 *
 * The `retryAfter` on the misconfig path is a synthetic 60s placeholder
 * — long enough that the canary alert can fire, short enough that
 * legitimate traffic recovers automatically once env vars are restored.
 */
export type CheckLimitResult =
  | { success: true }
  | {
      success: false;
      retryAfter: number;
      reason?: "ratelimit_misconfigured";
    };

/**
 * Narrow a CheckLimitResult to the misconfigured-fail-closed variant.
 * Routes use this to convert `{success:false, reason:'ratelimit_misconfigured'}`
 * into a 503 Service Unavailable so canary/health checks see the
 * configuration outage rather than a 429-shaped "user is being throttled"
 * response.
 */
export function isRateLimitMisconfigured(
  result: CheckLimitResult,
): result is { success: false; retryAfter: number; reason: "ratelimit_misconfigured" } {
  return (
    result.success === false && result.reason === "ratelimit_misconfigured"
  );
}

/**
 * PR-2 simplify (2026-05-28): canonical deny-response builder for the
 * misconfig-503 / throttled-429 split. Pre-extract, the admin mutator
 * surface inlined an identical 8-line branch per callsite.
 *
 * ── 140.4-13 / SEAMRIM-05 — WHY THIS DOCBLOCK WAS REWRITTEN ─────────────────
 *
 * ⚠️ IT USED TO SAY: *"Routes whose tests vi.mock("@/lib/ratelimit") still
 * inline the branch to keep their existing mocks intact — this helper is for
 * the admin surface where the real ratelimit module loads."*
 *
 * That sentence was the FIX'S OWN JUSTIFICATION FOR LEAVING THE CLASS OPEN, and
 * it is why eleven seam routes — every route that reaches the analytics service —
 * answered a limiter MISCONFIGURATION with a 429 for two years. A 429 tells the
 * caller "you are being throttled"; on the key-connect path the wizard renders
 * that as `KEY_RATE_LIMIT`, whose copy says the throttle is *"a transient,
 * exchange-side throttle and not a problem with your key"*. During an Upstash
 * outage that sentence is false for EVERY user on their FIRST click, and it
 * blames the user's exchange for our own outage.
 *
 * Test-mock convenience is not a reason to leave a correctness class open. The
 * six wholesale `vi.mock("@/lib/ratelimit", …)` factories that motivated the old
 * sentence were extended with `importActual` for the pure helpers, which costs
 * six lines and cannot drift from this implementation.
 *
 * ── THE DIVISION OF OWNERSHIP, AND WHY IT IS NOT A BLANKET ADOPTION ─────────
 *
 * THE ARTEFACT OWNS: the status (`isRateLimitMisconfigured(rl) ? 503 : 429`) and
 * the `Retry-After` VALUE. Neither is reachable from `options` — see the named
 * negative cases in `ratelimit.test.ts`. An options bag that let a route pick
 * its own status would re-open the finding at twelve call sites while still
 * satisfying a criterion that only checked "the override is honoured".
 *
 * THE ROUTE OWNS: its body and its extra headers. Measured on the untouched
 * tree, converging the seam onto this builder's FIXED body would have regressed
 * six live 429 contracts — `create-with-key` and `composite/add-key`
 * (`code: "KEY_RATE_LIMIT"`), `keys/sync` at BOTH arms (`code: "RATE_LIMITED"`),
 * `csv-validate` and `csv-finalize` (the CSV v0 envelope), and
 * `scenario/optimize` (a bespoke sentence with NO `Retry-After`) — and dropped
 * `NO_STORE_HEADERS` from ten of them, re-opening a cache-contract finding.
 * `bridge/route.ts`'s docblock states that hazard verbatim.
 */
type DenyResult = { success: false; retryAfter: number; reason?: "ratelimit_misconfigured" };

export type RateLimitDenyOptions = {
  /**
   * Extra response headers. Merged UNDERNEATH the artefact's own `Retry-After`,
   * so a caller cannot clobber the value (asserted).
   */
  headers?: Record<string, string>;
  /** Body for the genuine-throttle (429) branch. Passed through VERBATIM — key order included. */
  throttledBody?: unknown;
  /** Body for the limiter-misconfigured (503) branch. Passed through VERBATIM. */
  misconfiguredBody?: unknown;
  /**
   * Where to stamp `Retry-After`. Defaults to `"always"`, which is the
   * pre-extension behaviour.
   *
   * `"misconfigured-only"` exists for exactly one route: `scenario/optimize`'s
   * 429 carries no `Retry-After` today, and adding one would change a live
   * response contract this plan is not entitled to change. The 503 branch keeps
   * its header under BOTH settings, because the canary/health check that the
   * fail-CLOSED 503 exists to reach needs to know when to look again.
   */
  retryAfterHeader?: "always" | "misconfigured-only";
};

/**
 * THE status decision, single-sourced. Both builders call this and nothing else
 * computes it — that is the property the twelve seam adoptions inherit.
 */
function denyStatus(rl: DenyResult): 503 | 429 {
  return isRateLimitMisconfigured(rl) ? 503 : 429;
}

/** The header set, with `Retry-After` stamped LAST so the caller's bag cannot win. */
function denyHeaders(
  rl: DenyResult,
  options?: RateLimitDenyOptions,
): Record<string, string> {
  const stamp =
    isRateLimitMisconfigured(rl) ||
    (options?.retryAfterHeader ?? "always") === "always";
  return {
    ...options?.headers,
    ...(stamp ? { "Retry-After": String(rl.retryAfter) } : {}),
  };
}

export function rateLimitDenyJson(
  rl: DenyResult,
  options?: RateLimitDenyOptions,
): NextResponse {
  const misconfigured = isRateLimitMisconfigured(rl);
  const fallback = {
    error: misconfigured ? "Rate limiter unavailable" : "Too many requests",
  };
  const override = misconfigured
    ? options?.misconfiguredBody
    : options?.throttledBody;
  return NextResponse.json(override ?? fallback, {
    status: denyStatus(rl),
    headers: denyHeaders(rl, options),
  });
}

/**
 * Plain-text twin of rateLimitDenyJson for routes whose CDN cache contract
 * disallows JSON bodies (PDF + image routes typically). Same status/headers
 * shape; body is a short human-readable string instead of a JSON envelope.
 *
 * 140.4-13: deliberately NOT given the options bag. It has ZERO call sites today
 * (measured: `grep -rnE "rateLimitDeny(Json|Text)\(" src/` finds only its own
 * definition), so an options argument here would be speculative surface. What it
 * DOES now share is `denyStatus` / `denyHeaders` — so if the 503-vs-429 decision
 * ever moves, it moves for both twins at once and cannot drift apart.
 */
export function rateLimitDenyText(rl: DenyResult): NextResponse {
  const misconfigured = isRateLimitMisconfigured(rl);
  return new NextResponse(
    misconfigured ? "Service temporarily unavailable" : "Rate limit exceeded",
    {
      status: denyStatus(rl),
      headers: denyHeaders(rl),
    },
  );
}

/** Synthetic Retry-After (seconds) for the misconfigured fail-CLOSED path. */
const MISCONFIGURED_RETRY_AFTER_S = 60;

/**
 * `@upstash/ratelimit` 2.0.8's FAIL-OPEN timeout sentinel, hand-typed.
 *
 * `applyTimeout` races the real verdict against a 5 000 ms timer that resolves
 * `{ success: true, limit: 0, remaining: 0, reset: 0, reason: "timeout" }` —
 * the library saying "I could not reach the counter, let the traffic through".
 *
 * ⚠️ THE DISCRIMINATOR IS `reason`, NOT `limit === 0`. `"cacheBlock"` is the
 * OTHER reason the limiter can answer without touching Redis and it is a
 * GENUINE denial; `"denyList"` likewise. Only `"timeout"` is a fail-open.
 * `resilient-fetch.ts` reasons identically at its own copy of this branch.
 */
const LIMITER_TIMEOUT_REASON = "timeout";

/**
 * Schedule a capture so it outlives the response, with the non-request-scope
 * fallback `after()` requires. Same shape as `audit.ts`'s `logAuditEvent` and
 * `resilient-fetch.ts`'s `scheduleSeamCapture`.
 */
function scheduleLimiterCapture(capture: Promise<void>): void {
  try {
    after(() => capture.catch(() => {}));
  } catch {
    console.warn(
      "[ratelimit] scheduling capture via queueMicrotask fallback (non-request scope)",
    );
    queueMicrotask(() => {
      void capture.catch(() => {});
    });
  }
}

/**
 * Consume one rate-limit token for the given identifier. Returns success
 * with retryAfter (seconds) when the limit is exceeded.
 *
 * Fail-CLOSED in production when the limiter is null (missing Upstash env)
 * or the underlying limiter call throws — the `reason: "ratelimit_misconfigured"`
 * variant signals route handlers to emit 503 Service Unavailable. Fail-OPEN
 * outside production so local dev / preview deploys without Upstash keep
 * working. See P709 + the module docstring for the full behavior matrix.
 *
 * ── SEAMRIM-04: THERE ARE THREE POSTURES HERE, NOT TWO ──────────────────────
 *
 * The behaviour matrix above describes two, and the deployed limiter has three.
 * Which one fires depends on HOW the store is unhealthy, not on whether it is:
 *
 *   1. FAIL-CLOSED — an HTTP-5xx (or any rejection) from the store. `@upstash/
 *      redis` does not retry a non-ok HTTP response, so the rejection arrives
 *      promptly and production answers `ratelimit_misconfigured` → 503.
 *   2. FAIL-OPEN, plus up to 5 s of the user's latency — a HANGING store. The
 *      SDK never rejects; `applyTimeout`'s sentinel wins the race and says
 *      "let it through". The cap is NOT enforced for that request.
 *   3. NON-DETERMINISTIC — a REFUSED socket, where the SDK's ~4.29 s retry
 *      ladder races the 5 s sentinel and either of the two above can win.
 *
 * ⚠️ THIS FUNCTION DOES NOT CHANGE ANY OF THEM, AND THAT IS DELIBERATE. What
 * was wrong is that posture 2 was SILENT: only `{ success, reset }` were
 * destructured, so a request that passed because the regulatory cap could not
 * be consulted was byte-indistinguishable from one that passed because it was
 * under the cap. It is now recorded. Making the limiter fail CLOSED on a
 * hanging store is a different decision with its own blast radius and is not
 * taken here.
 */
export async function checkLimit(
  limiter: Ratelimit | null,
  identifier: string,
): Promise<CheckLimitResult> {
  if (!limiter) {
    if (isProduction()) {
      return {
        success: false,
        retryAfter: MISCONFIGURED_RETRY_AFTER_S,
        reason: "ratelimit_misconfigured",
      };
    }
    return { success: true };
  }
  try {
    const { success, reset, reason } = await limiter.limit(identifier);
    if (success) {
      if (reason === LIMITER_TIMEOUT_REASON) {
        // POSTURE 2 — recorded, not changed. The identifier is deliberately
        // NOT logged or captured: it is a user id or a client IP, and this
        // event says nothing about WHO was let through, only that the cap went
        // unenforced.
        console.warn(
          "[ratelimit] store timeout — the cap was NOT enforced for this " +
            "request (fail-OPEN). This is the store being unreachable, not the " +
            "caller being under the limit.",
        );
        scheduleLimiterCapture(
          captureToSentry(
            new Error("[ratelimit] store timeout — cap not enforced"),
            {
              tags: { surface: "ratelimit", posture: "fail_open_timeout" },
              level: "warning",
            },
          ),
        );
      }
      return { success: true };
    }
    const retryAfter = Math.max(1, Math.ceil((reset - Date.now()) / 1000));
    return { success: false, retryAfter };
  } catch (err) {
    // Upstash itself errored (network, rate-limit-on-ratelimit). In
    // production fail-CLOSED so a Redis outage doesn't silently unlock
    // cost-sensitive endpoints; outside production fail-OPEN so a dev
    // without Upstash can still iterate.
    //
    // ⚠️ SCRUBBED (SEAMRIM-04 / TRAP-1). The store command carries
    // `UPSTASH_REDIS_REST_TOKEN` in an Authorization header and undici inlines
    // the outgoing request into the error it produces, so logging `err` raw
    // spilled this module's own store credential into the function log.
    // `resilient-fetch.ts` scrubs both of its store-rejection arms for exactly
    // this reason; the same store reached through the same SDK was unscrubbed
    // from here. The syscall detail survives the scrub — a refused store and an
    // expired certificate are different incidents.
    console.error("[ratelimit] check failed:", scrubSeamError(err));
    if (isProduction()) {
      return {
        success: false,
        retryAfter: MISCONFIGURED_RETRY_AFTER_S,
        reason: "ratelimit_misconfigured",
      };
    }
    return { success: true };
  }
}

/**
 * Extract a client IP from request headers for rate-limit bucketing.
 *
 * Ordering:
 *   1. `x-real-ip` — ONLY trusted when `process.env.VERCEL === "1"` (set
 *      automatically by Vercel's build env). On Vercel this header is
 *      written by the edge after TCP-peer resolution and the client cannot
 *      override it. Outside Vercel (self-hosted, `next start` behind a
 *      different proxy, or vercel dev) the header is freely client-set, so
 *      a malicious client rotating it per request defeats bucket isolation.
 *      audit-2026-05-07 PR-2 (2026-05-28) code-reviewer C1.
 *   2. `x-forwarded-for` as a fallback. We take the RIGHTMOST entry,
 *      not the leftmost: the leftmost is attacker-controllable (a bot
 *      can inject its own value per request), the rightmost is the
 *      last trusted proxy's write and is stable per client.
 *
 * Returns the literal string `"unknown"` when no usable IP can be
 * extracted. Routes that need per-UA / aggregate-cap defense compose
 * their own salt on top of this value (canonical shape: see the
 * `for-quants-lead:unknown:<ua-hash>` + `for-quants-lead:unknown:_aggregate`
 * pair in src/app/api/for-quants-lead/route.ts). An earlier PR-2 attempt
 * to nonce-salt this fallback broke that aggregate cap (every request
 * got its own bucket including the cap key), so the literal stays.
 */
export function getClientIp(headers: Headers): string {
  const trustRealIp = process.env.VERCEL === "1";
  if (trustRealIp) {
    const real = headers.get("x-real-ip");
    if (real) return real.trim();
  }

  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    // Rightmost entry = last-hop proxy's write (harder to spoof).
    const parts = forwarded.split(",").map((p) => p.trim()).filter(Boolean);
    if (parts.length > 0) return parts[parts.length - 1];
  }

  // PR-2 2026-05-28: returns the literal "unknown" so routes that need
  // shared-bucket defense (e.g. for-quants-lead with per-UA salt +
  // aggregate cap, see src/app/api/for-quants-lead/route.ts) can compose
  // their own defense on top. The earlier UUID-nonce fallback broke the
  // for-quants-lead aggregate cap (every request got its own bucket
  // including the cap key). Routes that share the literal bucket
  // ("portfolio-pdf:unknown", "factsheet-pdf:unknown", etc.) ACCEPT the
  // documented tradeoff that header-stripped traffic collapses there
  // because the cross-IP throttle at the platform edge (Vercel) is the
  // outer defense; this layer's job is per-IP fairness, not global cap.
  return "unknown";
}

/**
 * Validate that a string is a real IPv4 or IPv6 address so it can be
 * safely stored in a Postgres `INET` column. Returns the IP if it
 * parses, `null` otherwise. A malformed `x-forwarded-for` header would
 * otherwise crash the whole insert with `invalid input syntax for type
 * inet`.
 */
export function sanitizeInetForDb(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed === "unknown") return null;

  // Strip optional IPv6 brackets.
  const unbracketed = trimmed.replace(/^\[/, "").replace(/\]$/, "");

  // IPv4: four dot-separated octets, each 0-255.
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
  const m4 = unbracketed.match(ipv4);
  if (m4) {
    if (m4.slice(1).every((o) => Number(o) >= 0 && Number(o) <= 255)) {
      return unbracketed;
    }
    return null;
  }

  // IPv6: hex + colons, optional zone id after `%`. Not a full validator
  // but catches the common malformed shapes Postgres rejects.
  const ipv6 = /^[0-9a-f:]+(%[0-9a-z]+)?$/i;
  if (ipv6.test(unbracketed) && unbracketed.includes(":")) {
    return unbracketed;
  }

  return null;
}
