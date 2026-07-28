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

/**
 * The shape a `correlation_id` must have before it may be DISPLAYED.
 *
 * ⚠️ HAND-TYPED HERE, DUPLICATING `CORRELATION_ID_SHAPE` in
 * `src/lib/correlation-id.ts`, and the duplication is forced rather than lazy:
 * that module opens with `import "server-only"` and `import { headers } from
 * "next/headers"`, so this leaf can never import it without ending the two
 * properties its purity test exists to defend. The duplication is also the
 * falsifier — two independent literals can be compared; one shared literal
 * cannot disagree with itself.
 *
 * ⚠️ IT IS A GUARD, NOT DECORATION. On the app-global handlers the value is
 * `request.headers.get("x-correlation-id")` (`analytics-service/main.py`) —
 * CALLER-SUPPLIED and echoed straight back — and a consumer renders it VERBATIM
 * into the DOM and copies it to the user's clipboard in the `QUANTALYZE_DIAG`
 * block. The allowlist excludes CR, LF, NUL and every whitespace and control
 * character, so a hostile value cannot split a log record or smuggle markup;
 * the 128-char bound exists because a value arriving over the wire has no
 * length of its own. A UUID (36), a `wizard:<uuid>` (43) and a 32-hex Sentry
 * trace id all pass cleanly, so the bound is a bound and not a ban.
 */
const CORRELATION_ID_SHAPE = /^[A-Za-z0-9._:-]{1,128}$/;

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
 * The VENUE named by a nested envelope, safe to DISPLAY — never to key on.
 *
 * 140.3-11 / TS-18. Distinct from `serviceDependencyOf` above in both direction
 * and purpose, and the pair must not be collapsed:
 *
 *   `serviceDependencyOf` answers "may this become a BREAKER KEY?" and admits
 *      ONLY the closed service set. It is private, and stays private (T-140-01).
 *   `seamDependencyName` answers "may this be SHOWN to a human as the third
 *      party that failed?" and admits only names OUTSIDE that set.
 *
 * The two vocabularies are disjoint by CONTRACT, not by hope:
 * `analytics-service/services/error_contract.py`'s `_validate` requires a
 * non-empty `dependency` on a 424, refuses one that is a member of
 * `SERVICE_DEPENDENCIES` ("a 424 names the caller's venue, and a fault in our
 * own dependency is 500/503"), and refuses a venue name on a 500. Verified at
 * that source on 2026-07-27 before this reader was written.
 *
 * The membership check below is DEFENCE IN DEPTH over that contract, and it is
 * kept because this value reaches a human as an ATTRIBUTION. A body that named
 * `supabase` here would tell an admin that the caller's exchange failed when
 * OUR datastore did — theme 2 in reverse, and the one lie SEAMUX-04 exists to
 * make impossible. Returning `null` degrades to the un-named venue state, which
 * is truthful; rendering the name would not be.
 *
 * ⚠️ THE VENUE VOCABULARY IS OPEN AND MUST STAY OPEN. There is no allow-list of
 * exchanges here and there must never be one: every venue we add would have to
 * be added twice, and the failure mode of forgetting is that a real outage
 * renders as no outage. The bound is on the SHAPE — a slug — not the value.
 * That bound is not decoration: the string arrives over the wire, and an
 * unbounded one would be rendered verbatim into an admin's screen.
 *
 * Returns `null` for BOTH flat shapes by construction (§2.1 — a scalar `detail`
 * carries no dependency), which is the common case: the flat
 * `VenueTransientHTTPException` 424 that `140.3-06` put on the wire names no
 * venue at all. A caller that gets `null` has learned "a venue failed and the
 * wire did not say which", and must render exactly that.
 */
export function seamDependencyName(body: unknown): string | null {
  const detail = nestedDetail(body);
  if (detail === null) return null;
  const dependency = detail.dependency;
  if (typeof dependency !== "string") return null;
  // A slug: 1–40 chars of lowercase alphanumerics, dot, underscore or hyphen.
  // Anchored at both ends, so a hostile value cannot smuggle a prefix or a
  // newline past it. `mt5-gateway`, `binance`, `sfox` and `bybit` all satisfy it.
  if (!/^[a-z0-9][a-z0-9._-]{0,39}$/.test(dependency)) return null;
  // Ours, not the caller's — see the defence-in-depth note above.
  if (SERVICE_DEPENDENCIES.includes(dependency)) return null;
  return dependency;
}

/**
 * The upstream `correlation_id`, safe to DISPLAY — the diagnostic 140.1-04
 * relocated rather than deleted.
 *
 * 140.3-15 / TS-20, and it is the FIFTH member of this leaf's exported surface,
 * added on EXACTLY the mechanism `140.3-11` recorded for `seamDependencyName`
 * one plan earlier: ONE narrow, purpose-named extractor over the private
 * `nestedDetail`, with `EXPECTED_EXPORTS` in `seam-discriminator.purity.test.ts`
 * edited in the SAME commit. That plan rejected exporting `nestedDetail` itself
 * (it hands every consumer the whole envelope and makes the next hand-rolled
 * `body.detail` branch a one-liner) and rejected a generic
 * `seamDetailField(body, name)` getter (an export set that cannot say WHICH
 * fields are reachable guards nothing). Reusing its decision is what keeps ONE
 * reader on record for this leaf instead of two rival ones.
 *
 * WHY IT EXISTS. Plan `140.1-04` moved the diagnostic OUT of the seam body — it
 * had been leaking raw exception text including table names, row payloads and
 * DSNs — and replaced it with this id. It is the cheapest support channel this
 * system will ever get, and if nobody renders it the diagnostic was not
 * relocated, it was deleted.
 *
 * ⚠️ IT MIRRORS `seamErrorCode`'s BOTH-SHAPE READ, and that is the whole point:
 * `correlation_id` is NESTED inside `service_error` envelopes (§2) and
 * TOP-LEVEL on the flat ones (§2.1 — `main.py`'s 422/429 handlers and
 * `process_key.py`'s own error envelopes). A nested-only reader would answer
 * `null` on every body from the other family, and a `null` here is
 * indistinguishable from a correctly-absent value — which is precisely how
 * `140.3-11`'s M77c stayed GREEN across 3163 tests.
 *
 * ⚠️ IT IS FOR DISPLAY ONLY and is consumed for NO breaker decision (TS-16).
 * `seamBreakerVerdict` below does not call it, and must not: a breaker key may
 * only ever come from the closed service set (T-140-01), and this value is
 * caller-influenceable on the app-global handlers.
 *
 * Returns `null` rather than throwing on every malformed shape and on every
 * value that fails `CORRELATION_ID_SHAPE`: a caller that gets `null` has
 * learned "the wire named no usable id" and must fall back to its own.
 */
export function seamCorrelationId(body: unknown): string | null {
  const detail = nestedDetail(body);
  const raw =
    detail !== null
      ? detail.correlation_id
      : isPlainObject(body)
        ? body.correlation_id
        : undefined;
  if (typeof raw !== "string") return null;
  // NOT trimmed first. `correlation-id.ts` trims because it is normalising an
  // INBOUND header before re-broadcasting it; here the value is already a body
  // field and a surrounding space is a sign the id is not what it claims to be,
  // so the honest answer is to fall back rather than to repair it.
  if (!CORRELATION_ID_SHAPE.test(raw)) return null;
  return raw;
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
    // ⚠️ CORRECTED by 140.3-11. This comment used to read "the CLASSIFIED
    // venue-failure path — the one that actually fires — still answers 400",
    // and that stopped being true at commit 1f8ad052: `140.3-06` remapped all
    // seven `VenueTransientHTTPException` sites from 400 to 424, so the path
    // that actually fires answers 424 now. That plan's hardest acceptance
    // criterion was zero `src/` diffs, so it routed the stale sentence here
    // rather than smuggling the fix in. The verdict below was correct
    // throughout and is unchanged — only the claim above it had rotted.
    //
    // Two 424 SHAPES are now on the wire and a consumer must handle both: the
    // nested `service_error(424, dependency=<venue>)` envelope, which names the
    // venue, and the flat `{detail, code, recoverable}` one, which carries no
    // `dependency` key at all. `seamDependencyName` above returns `null` for
    // the flat shape, and 140.3-11's consumers degrade to an un-named venue
    // state rather than inventing one.
    //
    // Every 4xx is breaker-inert BY CONSTRUCTION, so the sub-classes below
    // change only what 140.3 renders — that part was, and remains, correct.
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
