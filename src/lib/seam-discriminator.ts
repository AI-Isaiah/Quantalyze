/**
 * Phase 140.2 / SEAMCORE-01 — the seam attributability discriminator.
 *
 * ⚠️ LOAD-BEARING LEAF. **Zero imports, zero env reads, zero module-load side
 * effects.** `src/lib/seam-discriminator.purity.test.ts` enforces that, and the
 * purity is load-bearing twice over — the same two reasons `src/lib/seam-errors.ts`
 * carries:
 *
 *  1. BUNDLE BOUNDARY. Plan `140.3-01` applies this predicate at a `"use client"`
 *     component. A dependency added here therefore reaches the BROWSER bundle,
 *     and anything seam-adjacent drags `@upstash/redis`, `@upstash/ratelimit` and
 *     a `Redis.fromEnv()` module-load side effect in with it.
 *  2. MOCK SURVIVAL. Sixteen route test files replace the seam clients wholesale.
 *     A predicate reached THROUGH such a module evaluates to `undefined` and
 *     calling it throws from inside a catch block, converting a clean 503 into a
 *     crash. Nothing mocks this leaf, so it holds under every existing mock shape
 *     — a property that survives only while it imports nothing worth mocking.
 *
 * The shape is `src/lib/process-key-onboard-contract.ts`'s: extracted, zero
 * imports, ONE implementation repo-wide, reachable from a test with no mocking.
 *
 * WHAT THIS MODULE ANSWERS
 * ------------------------
 * Exactly one question, quoting `analytics-service/docs/STATUS_CONTRACT.md` §0:
 *
 *   > The status code answers exactly one question: should this response count
 *   > against the analytics service's own health?
 *
 * Everything else — user copy, remedy, retry affordance — is 140.3's.
 *
 * ⚠️ THE STATUS LINE ALONE MUST BE DECIDABLE (TRAP-2). An unhandled Python
 * exception is a bodyless `500 text/plain` (Starlette `ServerErrorMiddleware` →
 * `PlainTextResponse("Internal Server Error", 500)`), so a classifier that needs
 * a body is undefined on the single most common 5xx. `seamBreakerVerdict` decides
 * counts/does-not-count from the status BEFORE looking at any body; the body only
 * ever REFINES which key a counting verdict names, and only on the 503 arm.
 *
 * ⚠️ A BREAKER KEY MAY ONLY COME FROM THE CLOSED SET BELOW (threat T-140-01).
 * A user-influenced breaker key is a trivial cross-tenant denial of service:
 * one caller could mint a key that trips the breaker for a cohort, or — worse —
 * shard it so it never trips at all. A `424`'s `dependency` is the CALLER'S
 * VENUE (§4) and is deliberately never read here; anything unrecognised on a
 * `503` falls back to the residual global key with a loud diagnostic.
 */

// ---------------------------------------------------------------------------
// The closed vocabulary. Hand-typed HERE, deliberately duplicating
// `SERVICE_DEPENDENCIES` in `analytics-service/services/error_contract.py` and
// `BREAKER_KEY` in `src/lib/resilient-fetch.ts`.
//
// The duplication is the point, twice over. This leaf cannot import the core
// (that would make it exactly the dependency-carrying module it exists not to
// be), and a consumer that read its vocabulary out of the emitter could never
// disagree with it. `src/lib/seam-constants.pin.test.ts` asserts the two
// TypeScript literals equal, so neither side can drift silently.
// ---------------------------------------------------------------------------

/**
 * The residual GLOBAL breaker key.
 *
 * A connection that never completed, a deadline that fired, or a response body
 * that aborted mid-stream names no dependency — and that is genuine Railway
 * degradation, so it keys here. Also the fallback for any counting verdict whose
 * dependency is absent, unreadable or outside the closed set.
 */
const GLOBAL_BREAKER_KEY = "breaker:railway";

/**
 * The four SERVICE dependencies (`STATUS_CONTRACT.md` §4) — the only values that
 * may ever become a breaker key.
 *
 * Frozen so a consumer cannot mutate the vocabulary at runtime; a pushed value
 * would become a legitimate key from that moment on.
 */
const SERVICE_DEPENDENCIES: readonly string[] = Object.freeze([
  "mt5-gateway",
  "kek",
  "supabase",
  "egress-proxy",
]);

/** The prefix every breaker key carries. Never interpolated from caller input. */
const BREAKER_KEY_PREFIX = "breaker:";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * The five classes of `STATUS_CONTRACT.md` §1, plus the two the wire cannot
 * express: `success`, and `transport` for "we never got a status line at all".
 */
export type SeamAttributability =
  | "success"
  | "caller"
  | "caller-throttled"
  | "caller-exchange"
  | "service-transient"
  | "service-permanent"
  | "transport";

/** The verdict. `breakerKey` is non-null exactly when `counts` is true. */
export interface SeamBreakerVerdict {
  readonly attributability: SeamAttributability;
  /** Does this response count against the analytics service's own health? */
  readonly counts: boolean;
  /** The key to record against, or `null` when nothing is recorded. */
  readonly breakerKey: string | null;
  /** The service dependency the key was built from, or `null` for the global key. */
  readonly dependency: string | null;
}

// ---------------------------------------------------------------------------
// Internal readers. Not exported: the exported surface stays the three
// predicates, because everything exported from a leaf is browser-reachable and
// survives every wholesale seam mock — both are privileges.
// ---------------------------------------------------------------------------

/** Is this a plain object (and specifically NOT an array or null)? */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The nested `service_error` envelope's payload, or `null` for either flat shape.
 *
 * §2.1, and the branch is on the TYPE of `body.detail` rather than on which
 * route answered, because a consumer cannot know the latter:
 *   `detail` is an OBJECT → the nested envelope (§2); the ONLY shape carrying
 *                           `dependency` and `retryable`
 *   `detail` is a STRING  → one of the two flat shapes (§2.1); `code` is at the
 *                           TOP level, and there is no dependency by construction
 */
function nestedDetail(body: unknown): Record<string, unknown> | null {
  if (!isPlainObject(body)) return null;
  const detail = body.detail;
  return isPlainObject(detail) ? detail : null;
}

/**
 * The `dependency` a counting verdict may key on, or `null`.
 *
 * Membership-checked against the frozen closed set. An unrecognised value is
 * REPORTED and DISCARDED — never used to build a key. That is the whole of
 * threat T-140-01: the value arrives over the wire, and a key built from it is
 * attacker-influenceable.
 */
function serviceDependencyOf(body: unknown): string | null {
  const detail = nestedDetail(body);
  if (detail === null) return null;
  const dependency = detail.dependency;
  if (typeof dependency !== "string" || dependency.length === 0) return null;
  if (SERVICE_DEPENDENCIES.includes(dependency)) return dependency;
  // LOUD, and quoted-and-escaped rather than interpolated raw: the value came
  // over the wire, so a bare interpolation is log injection. Truncated because a
  // hostile value has no length bound. No other field of the body is logged —
  // the seam carries raw exchange credentials and INTERNAL_API_TOKEN.
  console.warn(
    "[seam-discriminator] a 5xx named a dependency outside the closed service " +
      "set; recording against the global breaker key instead. Received: " +
      `${JSON.stringify(dependency.slice(0, 64))}. Either the emit side added a ` +
      "dependency without adding it here and in error_contract.SERVICE_DEPENDENCIES, " +
      "or a venue slug reached a 5xx arm (which error_contract._validate refuses).",
  );
  return null;
}

// ---------------------------------------------------------------------------
// The exported surface — three predicates, and no more.
// ---------------------------------------------------------------------------

/**
 * The stable machine `code`, read from whichever shape the body is in.
 *
 * ⚠️ Reading `body.detail.code` UNCONDITIONALLY yields `undefined` on BOTH flat
 * shapes and falls through to `UNKNOWN` — the exact dead end PYAPIFIX2-01 exists
 * to kill, reintroduced at the layer that was supposed to consume the fix.
 * Ledger row M25 is the falsifier.
 *
 * Returns `null` rather than throwing on every malformed shape: this is called
 * from inside a catch arm, where a throw would replace the real upstream error.
 */
export function seamErrorCode(body: unknown): string | null {
  const detail = nestedDetail(body);
  const raw = detail !== null ? detail.code : isPlainObject(body) ? body.code : undefined;
  return typeof raw === "string" ? raw : null;
}

/**
 * The human-readable copy, read from whichever shape the body is in.
 *
 * Obligation O-5. Three TypeScript sites do `err.detail ?? "…"`; on the nested
 * envelope that stringifies to `"[object Object]"` in the wizard's substring
 * cascade and misses every branch — the C-14 render.
 */
export function seamHumanMessage(body: unknown): string | null {
  if (!isPlainObject(body)) return null;
  const detail = body.detail;
  if (typeof detail === "string") return detail;
  if (isPlainObject(detail)) {
    // `body.detail.detail` is ALWAYS a scalar string when present (§2) — never a
    // list, never a dict, never null.
    return typeof detail.detail === "string" ? detail.detail : null;
  }
  return null;
}

/**
 * Does this response count against the analytics service's own health, and if
 * so, against which breaker key?
 *
 * `status` is `null` for a request that produced no status line at all — a
 * transport throw, a deadline, or a response body that aborted mid-stream.
 * `body` is OPTIONAL by design: every arm reaches a terminal verdict without it.
 *
 * The table, which IS `SEAMCORE-01` (`STATUS_CONTRACT.md` §1 + §6, cross-checked
 * against `error_contract._validate`):
 *
 *   400 401 403 404 422 → CALLER            → never counts → no key
 *   429                 → CALLER, THROTTLED → never counts → no key
 *   424                 → CALLER'S EXCHANGE → never counts → no key; its
 *                         `dependency` is a VENUE slug and is never read (§4)
 *   500                 → SERVICE-PERMANENT → never counts → no key. Includes
 *                         the bodyless `text/plain` unhandled-exception shape.
 *                         A deterministic fault can only be cleared by an
 *                         operator, so counting it guarantees a self-sustaining
 *                         outage (R-1 / A-02 / A-25)
 *   503                 → SERVICE-TRANSIENT → COUNTS → `breaker:<dependency>`,
 *                         membership-checked; otherwise the global key
 *   other 5xx           → SERVICE-TRANSIENT → COUNTS → the GLOBAL key. 502/504
 *                         come from the platform EDGE, which names no dependency
 *                         of ours and is genuine degradation. This is also the
 *                         pre-phase behaviour for those statuses, so it is not a
 *                         widening
 *   < 400               → success           → no
 *   no status line      → transport         → COUNTS → the GLOBAL key
 */
export function seamBreakerVerdict(
  status: number | null,
  body?: unknown,
): SeamBreakerVerdict {
  // A status we cannot read means we never got a usable response, which is
  // degradation. Treating it as 2xx would silently disarm the breaker and
  // treating it as a caller fault would do the same, so it joins the transport
  // arm — the conservative direction, and the only one that cannot hide an
  // outage.
  //
  // The range test is deliberate and not decoration: `0` and `-1` are the two
  // values a Response-shaped stub or an opaque/errored fetch actually produces,
  // and both are `< 400`, so a bare finiteness check would classify them as
  // SUCCESS and silently disarm the breaker on exactly the shapes where nothing
  // was received.
  if (
    status === null ||
    typeof status !== "number" ||
    !Number.isInteger(status) ||
    status < 100 ||
    status > 599
  ) {
    return TRANSPORT;
  }

  if (status < 400) {
    return { attributability: "success", counts: false, breakerKey: null, dependency: null };
  }

  if (status < 500) {
    // ⚠️ 424 is NOT "the" venue signal (M-4). The CLASSIFIED venue-failure path —
    // the one that actually fires — still answers 400 in the flat
    // `{detail, code, recoverable}` shape. Every 4xx is breaker-inert BY
    // CONSTRUCTION, so the sub-classes below change only what 140.3 renders.
    if (status === 424) {
      return {
        attributability: "caller-exchange",
        counts: false,
        breakerKey: null,
        dependency: null,
      };
    }
    if (status === 429) {
      // Tolerated in all three wire shapes (TS-23), including the bare scalar
      // that carries no `code` and the four sites that carried no `Retry-After`
      // (M-9). A wait is NEVER derived by parsing prose.
      return {
        attributability: "caller-throttled",
        counts: false,
        breakerKey: null,
        dependency: null,
      };
    }
    return { attributability: "caller", counts: false, breakerKey: null, dependency: null };
  }

  if (status === 500) {
    return {
      attributability: "service-permanent",
      counts: false,
      breakerKey: null,
      dependency: null,
    };
  }

  // COUNTS from here. The body is consulted ONLY now, and only to refine which
  // key — never to decide whether to record at all.
  const dependency = status === 503 ? serviceDependencyOf(body) : null;
  return {
    attributability: "service-transient",
    counts: true,
    breakerKey:
      dependency === null ? GLOBAL_BREAKER_KEY : `${BREAKER_KEY_PREFIX}${dependency}`,
    dependency,
  };
}

/** Hoisted so the transport verdict is one object identity, not a fresh literal. */
const TRANSPORT: SeamBreakerVerdict = {
  attributability: "transport",
  counts: true,
  breakerKey: GLOBAL_BREAKER_KEY,
  dependency: null,
};
