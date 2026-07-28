import type { z } from "zod";
import {
  ValidateKeyResponseSchema,
  EncryptKeyResponseSchema,
  PortfolioAnalyticsResponseSchema,
  PortfolioOptimizerResponseSchema,
  RecomputeMatchResponseSchema,
  BridgeResponseSchema,
  OptimizeWeightsResponseSchema,
  type OptimizeWeightsResponse,
} from "./analytics-schemas";
import { SimulatorResponseSchema } from "./api/simulatorSchema";
import {
  resilientFetch,
  SeamConfigError,
  SEAM_BUDGETS,
  type SeamBudgetKey,
  type SeamResponse,
} from "./resilient-fetch";
// 140.3-01 / TS-05 — the ONE seam-envelope discriminator (140.2-06). Never
// hand-roll a second extractor: a second implementation of this predicate is
// the drift class this programme exists to close.
import {
  seamDependencyName,
  seamErrorCode,
  seamHumanMessage,
} from "@/lib/seam-discriminator";
import { CircuitOpenError, SeamBodyReadError } from "./seam-errors";
import { scrubSeamString } from "./seam-redaction";
import { mintTenantClaim, type TenantIdentity } from "./tenant-claim";

const SERVICE_KEY = process.env.ANALYTICS_SERVICE_KEY ?? "";

/** Client-side API contract version. Sent as X-Api-Version on every request. */
export const ANALYTICS_API_VERSION = "1";

/**
 * Phase 140 / SEAM-01 — back-compat convenience re-export ONLY.
 *
 * ⚠️ The canonical import path for `CircuitOpenError` is `@/lib/seam-errors`,
 * the dependency-free leaf. Nothing may rely on picking the class up through
 * THIS module: sixteen route test files `vi.mock("@/lib/analytics-client")`,
 * and seven of the eight seam-mocking files use a FULL factory with no
 * `importActual`. Through those mocks this re-export is `undefined`, and
 * `err instanceof undefined` throws `TypeError` from inside a catch block —
 * turning a clean 503 into a crash. Production code, route handlers, wizard
 * error classification and tests all import from the leaf.
 */
export { CircuitOpenError };

/** Thrown when the analytics service does not respond within the timeout. */
export class AnalyticsTimeoutError extends Error {
  constructor(path: string, timeoutMs: number) {
    super(`Analytics service timed out after ${timeoutMs}ms on ${path}`);
    this.name = "AnalyticsTimeoutError";
  }
}

/**
 * Thrown when the analytics service returns a non-2xx HTTP response.
 * Preserves the upstream status so route handlers can forward 4xx semantics
 * (e.g. 400 "already in portfolio", 404 "not found") instead of flattening
 * every upstream error to 500.
 */
export class AnalyticsUpstreamError extends Error {
  readonly status: number;
  /**
   * 140.3-01 / TS-05 — the stable MACHINE code from the seam envelope, or
   * `null` when the body carried none (a transport-shaped failure, a bodyless
   * 5xx, or a non-contract body).
   *
   * Additive and optional: every pre-existing construction site passes two
   * arguments and keeps `null`. It exists because closing TS-05 with only the
   * HUMAN half would leave the discriminator's other output unreachable at the
   * seam chokepoint — and the code, not the sentence, is what the copy plan and
   * TS-35 branch on. The sentence is for the user; the code is for us.
   */
  readonly seamCode: string | null;
  /**
   * 140.3-11 / TS-18 — the VENUE the nested envelope named, or `null`.
   *
   * Additive and optional on exactly the contract `seamCode` set one plan
   * earlier: every pre-existing construction site passes two or three arguments
   * and keeps `null`, and this is the SAME error type rather than a second one
   * — the seam has one error vocabulary and adding to it is not this plan's to
   * do. What is new is only that a field the wire already carried stops being
   * discarded here.
   *
   * It has to be carried HERE because this is where the body dies: the route
   * handlers downstream see only the thrown error, so a `dependency` not read
   * at this line is unreachable to every consumer. Sniffing it back out of
   * `message` later would be the substring cascade that correction C-6 caught
   * rendering a venue WAF block as the user's own IP-allowlist problem.
   *
   * `null` on BOTH flat shapes by construction, which is the common case: the
   * flat `VenueTransientHTTPException` 424 carries no `dependency` key at all.
   * `null` means "a venue failed and the wire did not say which" — never
   * "no venue failed", and never a name to invent.
   */
  readonly dependency: string | null;
  constructor(
    message: string,
    status: number,
    seamCode: string | null = null,
    dependency: string | null = null,
  ) {
    super(message);
    this.name = "AnalyticsUpstreamError";
    // H-1144: the documented contract is "preserve the UPSTREAM status so route
    // handlers can forward it as the HTTP response code". Guard the invariant at
    // construction so a malformed status (NaN, non-integer, or out of the
    // 100–599 HTTP range) fails loud here rather than surfacing downstream as an
    // invalid `NextResponse` status. All current callers pass `res.status`
    // (already a valid integer), so this never fires in practice — it's a
    // fail-loud fence against a future caller passing an unchecked number.
    if (!Number.isInteger(status) || status < 100 || status > 599) {
      throw new RangeError(
        `AnalyticsUpstreamError: invalid HTTP status ${status} (expected an integer 100–599)`,
      );
    }
    this.status = status;
    this.seamCode = seamCode;
    this.dependency = dependency;
  }
}

/**
 * The "connection never completed" copy, extracted so the transport arm and the
 * body-read arm below cannot drift apart. Byte-identical to what this module
 * has always thrown — plan 140.2-05 authors NO new user-facing copy; 140.3 owns
 * the client-facing surface.
 */
const NOT_REACHABLE_MESSAGE =
  "Analytics service is not reachable. Please ensure it is running.";

/**
 * Phase 140.2-11 / SEAMCORE-11 (A-27) — THE ONE DEFINED OUTCOME for an
 * ambiguous transport. Stated identically here and in
 * `src/lib/process-key-client.ts` so the next reader does not have to diff the
 * two files to find out what the seam does with a 204.
 *
 * WHAT IS AMBIGUOUS
 *   1. A 2xx whose content-type is not JSON. The modal case is a Railway edge
 *      or maintenance page served as `200 text/html`: the transport succeeded,
 *      the breaker (correctly) counts nothing, and what came back is not the
 *      service.
 *   2. The three NULL-BODY statuses 204 / 205 / 304, which carry no body at
 *      all and cannot carry one.
 *
 * THE OUTCOME, in both clients
 *   A typed upstream error carrying the OBSERVED status and content-type, in a
 *   static operator-facing message that names the SEAM. Here it is THROWN as
 *   `AnalyticsUpstreamError`; in `process-key-client` the identical message is
 *   logged and the outcome is RETURNED as an `{ ok: false, response }` 502
 *   envelope, because that function is declared never to throw at its five
 *   caller routes.
 *
 * WHY THE THREE STATUSES ARE DECIDED ON THE STATUS, BEFORE ANY RESPONSE IS
 * CONSTRUCTED. Verified by execution on Node v25.8.1:
 * `Response.json(body, { status: 204 | 205 | 304 })` throws
 * `TypeError: Response constructor: Invalid response status code`. That is
 * WHATWG-spec behaviour, not a runtime quirk, so CI's Node 22 and local Node 25
 * agree. The construction ITSELF is the fault, so no arm may reach it.
 *
 * WHY THE MESSAGE — AND NOT THE `status` FIELD — CARRIES THE OBSERVED STATUS.
 * `AnalyticsUpstreamError.status` is contractually the code route handlers
 * FORWARD (`simulator/route.ts` forwards 4xx verbatim). Forwarding 204 or 304
 * would move this exact crash into the route's own `NextResponse.json`, and
 * forwarding 200 would ship an error payload under a success code. So the
 * routable status is 502 — the gateway answered, unusably — and the observed
 * status lives in the message, where an operator reads it.
 *
 * The BREAKER VERDICT IS UNCHANGED by all of this (SEAMCORE-01): a 2xx is not a
 * service fault and a 304 is not either. This is what the CLIENTS do with the
 * response, not what the core counts.
 */
const NULL_BODY_STATUSES: ReadonlySet<number> = new Set([204, 205, 304]);

/** The routable status for the outcome above: the gateway answered, unusably. */
const UNUSABLE_RESPONSE_STATUS = 502;

/**
 * The operator-facing message for the outcome above.
 *
 * DUPLICATED, byte-for-byte, in `src/lib/process-key-client.ts`, and guarded by
 * a comment-stripped drift check in `analytics-client.test.ts`. It is duplicated
 * rather than shared because neither client may import from the other (sixteen
 * route test files replace one or the other wholesale with a full factory, under
 * which a cross-client import evaluates to `undefined`), and it cannot move to
 * the dependency-free error leaf either — that leaf's exported surface is pinned
 * to a two-member hand-typed set.
 *
 * Only the MEDIA TYPE is echoed, lower-cased and length-capped: the raw header
 * is upstream-controlled and its parameters carry nothing an operator needs.
 */
function unusableSeamResponseMessage(
  status: number,
  contentType: string | null,
): string {
  const mediaType =
    ((contentType ?? "").split(";")[0] ?? "").trim().toLowerCase().slice(0, 64) ||
    "absent";
  return `Analytics seam returned an unusable response (HTTP ${status}, content-type ${mediaType}). The upstream did not answer with the JSON contract.`;
}

/**
 * Map a `SeamBodyReadError` onto the taxonomy this module ALREADY has.
 *
 * The core records the breaker failure and throws this class from inside its
 * classification window; the nine wrapper consumers must keep seeing only
 * `AnalyticsTimeoutError`, `AnalyticsUpstreamError`, `CircuitOpenError` and the
 * generic not-reachable `Error` — a new type escaping here would reach every
 * caller with no arm for it. `deadlineExceeded` is the only discriminator, and
 * it means exactly what the transport arm's own name test means, because the
 * core derives both from one definition.
 *
 * Anything that is NOT a body-read failure is rethrown untouched: this helper
 * classifies, it does not swallow.
 */
function mapBodyReadFailure(err: unknown, path: string, timeoutMs: number): never {
  if (err instanceof SeamBodyReadError) {
    if (err.deadlineExceeded) {
      throw new AnalyticsTimeoutError(path, timeoutMs);
    }
    throw new Error(NOT_REACHABLE_MESSAGE);
  }
  throw err;
}

/**
 * Core fetch wrapper for the Python analytics service.
 *
 * Phase 140 / SEAM-01: the transport itself now lives in `resilient-fetch.ts`
 * — the ONE place that owns the base URL, the wall-clock budget, and the
 * `breaker:railway` circuit. This function keeps everything that is genuinely
 * analytics-client policy: header construction, the API-version drift warning,
 * and the `!ok` → `AnalyticsUpstreamError` translation the core deliberately
 * does not perform (only the caller knows whether a 404 is an error).
 *
 * @param path    - URL path (e.g. "/api/compute-analytics")
 * @param body    - JSON body to POST
 * @param options - `budgetKey` is REQUIRED: it names this call site's row in
 *                  `SEAM_BUDGETS`, which is the single owner of its deadline.
 *                  `tenantId` is REQUIRED: it is the server-derived identity the
 *                  `X-Tenant-Claim` is minted over (see below).
 *                  `timeoutMs` overrides the table for one call — TESTS ONLY
 *                  since 140-05 removed the last production override (the
 *                  optimizer route's legacy constant). `method` defaults to
 *                  "POST".
 */
async function analyticsRequest(
  path: string,
  body: Record<string, unknown> | null,
  options: {
    budgetKey: SeamBudgetKey;
    /**
     * Phase 140.2-09 / TS-04 — REQUIRED, and required ON PURPOSE.
     *
     * Every one of the nine wrappers must decide what its tenant payload is.
     * Making this optional would let a tenth wrapper be added with no identity
     * and land silently in a platform-wide bucket — the instance-not-class
     * defect this programme exists to close, and one that no test which only
     * checks the wrappers it knows about could ever see.
     *
     * MUST be server-derived (`user.id` from the authenticated session). It
     * reaches the Python limiter's key as `<scope>:t:<tenantId>` VERBATIM, so a
     * caller who controls it controls which window they spend.
     */
    tenantId: string;
    timeoutMs?: number;
    method?: string;
    correlationId?: string;
  },
) {
  // Resolved locally as well as inside the core, because AnalyticsTimeoutError's
  // message quotes the deadline that actually fired.
  const timeoutMs = options.timeoutMs ?? SEAM_BUDGETS[options.budgetKey].timeoutMs;
  const method = options.method ?? "POST";
  // Phase 16 / OBSERV-01: stamp X-Correlation-Id on every outbound fetch.
  // Wrappers (validateKey, encryptKey, ...) intentionally do NOT thread
  // this option through in this plan — Plan 7 wires the SSE endpoint to pass
  // it explicitly. Until then, every request still carries a UUID v4 so the
  // FastAPI side has a stable join key.
  const correlationId = options.correlationId ?? crypto.randomUUID();

  /**
   * Phase 140.2-09 / TS-04 / ROADMAP SC7 — the signed tenant identity the
   * Python rate limiter buckets on.
   *
   * Until this landed, `tenant_or_platform_key` saw no claim on any call from
   * this client and returned `platform:<path>` — a platform-WIDE window per
   * route. The sharpest is `/api/optimize-weights` at 20/minute, where two
   * allocators running Scenario Composer could 429 each other.
   *
   * ⚠️ READ AT CALL TIME, NOT AT MODULE SCOPE. `SERVICE_KEY` above is captured
   * at module scope, which is the env-before-import ordering hazard
   * `resilient-fetch.wiring.test.ts` documents in its header: a test that sets
   * the env after a static import gets an empty string. Here the failure mode is
   * strictly worse — an empty secret still produces a SYNTACTICALLY VALID claim
   * that simply fails `compare_digest`, so every route silently falls back to
   * `platform:<path>` with no error anywhere and SC7 no-ops in production while
   * the whole suite stays green. `mintTenantClaim` refuses instead.
   *
   * ⚠️ MINTED BEFORE THE `try`, DELIBERATELY. Inside it, a `TenantClaimError`
   * would be caught by the arms below and rewritten as "Analytics service is not
   * reachable" — a configuration fault on our side reported as a dead upstream,
   * which is the exact silent degradation the refusal exists to prevent.
   *
   * ⚠️ THE CLAIM IS INERT ON THREE PATHS AND THAT IS FINE. `/api/match/recompute`
   * and `/api/match/eval` have NO Python limiter at all (TS-21, owned by Phase
   * 146) and `/api/simulator` is the tenth, still-IP-keyed route (TS-30,
   * quarantined). Sending a claim there is harmless and forward-compatible — the
   * moment those routes gain a `tenant_or_platform_key` limiter they are
   * per-tenant with zero TS work. Do NOT "optimise" it away by special-casing
   * them: eight of nine is how this defect class comes back.
   *
   * No `X-User-Id` is added anywhere. It is unsigned client input, and
   * `verify_tenant_claim` exists precisely because it cannot be trusted to
   * select a bucket.
   */
  const tenantClaim = mintTenantClaim(
    options.tenantId,
    process.env.INTERNAL_API_TOKEN ?? "",
  );

  // SEAMCORE-02: the core returns a `SeamResponse`, whose `json()` / `text()`
  // run inside its classification window. The surface is the closed set this
  // function already used (`ok`, `status`, `statusText`, `headers.get`, `json`,
  // `text`); nothing here reaches for a `Response`-only member.
  let res: SeamResponse;
  try {
    // Headers are built HERE and passed through the core byte-for-byte. A
    // dropped X-Service-Key silently unauthenticates every analytics call.
    res = await resilientFetch(options.budgetKey, path, {
      method,
      headers: {
        "Content-Type": "application/json",
        "X-Api-Version": ANALYTICS_API_VERSION,
        "X-Correlation-Id": correlationId,
        ...(SERVICE_KEY && { "X-Service-Key": SERVICE_KEY }),
        // TS-04 / SC7 — minted above; see the tenantClaim block.
        "X-Tenant-Claim": tenantClaim,
      },
      ...(body !== null && { body: JSON.stringify(body) }),
      ...(options.timeoutMs !== undefined && {
        timeoutMsOverride: options.timeoutMs,
      }),
    });
  } catch (err) {
    // ORDER IS LOAD-BEARING.
    //
    // 1. CircuitOpenError rethrown UNWRAPPED and FIRST. Route handlers branch
    //    on it to emit the SEAM-04 503 + Retry-After envelope; if the generic
    //    arm below swallowed it, every breaker trip would surface to the user
    //    as "the analytics service is not reachable" and the entire circuit
    //    feature would be invisible.
    if (err instanceof CircuitOpenError) {
      throw err;
    }
    // 1b. ME-01 — a CONFIG fault on OUR side, rethrown UNWRAPPED and named.
    //
    // `SeamConfigError` exists "to separate" a deployment/caller fault from a
    // dead upstream, and the BREAKER half of that separation already worked:
    // the fault is raised above the classification window and records nothing.
    // But the separation stopped at the core's boundary — no client branched on
    // it, so a malformed `ANALYTICS_SERVICE_URL` or an invalid
    // `timeoutMsOverride` took arm 3 below and reached the user as "the
    // analytics service is not reachable", pointing ops at Railway for our own
    // typo. That is verbatim the silent degradation `tenant-claim.ts` cites to
    // justify a named class — and `TenantClaimError` IS handled at both call
    // sites, while this one was handled nowhere.
    //
    // Rethrowing UNWRAPPED puts it in the callers' generic arms (a 500 "we
    // failed", not a 502 "they are down"). Giving it its own ENVELOPE and copy
    // is 140.3's fence, not this phase's.
    if (err instanceof SeamConfigError) {
      console.error(
        `[analytics-client] CONFIG fault on ${path} — not an upstream failure, and NOT a reason to blame Railway:`,
        scrubSeamString(err.message),
      );
      throw err;
    }
    // 2. Deadline exceeded. STRICTLY BROADER than the pre-140 check
    //    (`err instanceof DOMException && name === "TimeoutError"`): a plain
    //    Error named "AbortError" is the shape a client-side abort produces,
    //    and it used to be misreported as a dead service rather than a slow
    //    one.
    //
    //    ⚠️ The shape guard must accept BOTH `Error` and `DOMException`, not
    //    `Error` alone. Node's DOMException extends Error (production), but
    //    jsdom's does NOT — and the core's timeout signal rejects with a
    //    DOMException. An `instanceof Error`-only guard therefore looks
    //    correct in production while silently reclassifying every timeout as
    //    "not reachable" in the vitest environment. Pinned by the
    //    "timeout (DOMException) throws AnalyticsTimeoutError" regression
    //    test in analytics-client.test.ts.
    if (
      (err instanceof Error || err instanceof DOMException) &&
      (err.name === "AbortError" || err.name === "TimeoutError")
    ) {
      throw new AnalyticsTimeoutError(path, timeoutMs);
    }
    // 3. Everything else: the connection never completed.
    throw new Error(NOT_REACHABLE_MESSAGE);
  }

  // Warn on API version mismatch (don't fail — just surface contract drift).
  const serverVersion = res.headers.get("X-Api-Version");
  if (serverVersion && serverVersion !== ANALYTICS_API_VERSION) {
    console.warn(
      `[analytics-client] API version mismatch: client=${ANALYTICS_API_VERSION}, server=${serverVersion}`,
    );
  }

  // SEAMCORE-11 / A-27 — decided on the STATUS, and decided BEFORE the `!ok`
  // fork. 204 and 205 are `ok` while 304 is not, so a check placed inside
  // either arm would give the three null-body statuses two different answers —
  // the very divergence this closes, reproduced inside one file. Before this,
  // 204/205 fell through to the local-dev port message below and 304 became an
  // AnalyticsUpstreamError carrying 304 as a forwardable status.
  if (NULL_BODY_STATUSES.has(res.status)) {
    throw new AnalyticsUpstreamError(
      unusableSeamResponseMessage(res.status, res.headers.get("content-type")),
      UNUSABLE_RESPONSE_STATUS,
    );
  }

  if (!res.ok) {
    const contentType = res.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      // TWO CASES, conflated before SEAMCORE-02. A body that is genuinely
      // absent or unparseable KEEPS the fallback — a 500 whose body is not the
      // JSON its content-type promised is real, and `{ detail: statusText }` is
      // the right answer for it. An ABORT is not: the core has already recorded
      // that failure against the breaker, so converting it into a fabricated
      // body would report a dying Railway as a well-formed upstream error.
      const error = await res.json().catch((err: unknown) => {
        if (err instanceof SeamBodyReadError) {
          mapBodyReadFailure(err, path, timeoutMs);
        }
        return { detail: res.statusText };
      });
      // 140.3-01 / TS-05 — read BOTH halves through the ONE discriminator.
      //
      // ONE LINE, TWO WIRE CONTRACTS (STATUS_CONTRACT.md §2 / §2.1). A
      // deliberate 4xx/5xx from `service_error()` nests the whole envelope at
      // `body.detail` — `{code, dependency, retryable, detail}` — so the
      // previous `error.detail ??` read handed an OBJECT to the constructor and
      // the message coerced to "[object Object]" (obligation O-5). The two
      // APP-GLOBAL handlers (422, 429) emit a SCALAR `detail` with the code at
      // the top level, and that path was already correct — TS-07 is an
      // explicitly NEGATIVE obligation and it must not be "fixed". The leaf
      // branches on the TYPE of `body.detail`, which is the only thing a
      // consumer can decide without knowing which route answered.
      //
      // The `??` fallback stays: `seamHumanMessage` returns null for a body
      // carrying no readable human string, and the static sentence is the
      // pre-plan answer for that case.
      //
      // 140.3-11 / TS-18 adds the THIRD half read through the same leaf. The
      // nested envelope is the only shape carrying `dependency`, and this is
      // the last line at which it exists — the route handlers downstream see
      // only the thrown error. `seamDependencyName` returns null for both flat
      // shapes and for any name inside OUR closed service set.
      throw new AnalyticsUpstreamError(
        seamHumanMessage(error) ?? "Analytics service error",
        res.status,
        seamErrorCode(error),
        seamDependencyName(error),
      );
    }
    // Non-JSON error (FastAPI unhandled exception returns text/plain).
    // Same distinction as above: an unreadable text/plain body falls back to
    // the status text, an abort does not.
    const text = await res.text().catch((err: unknown) => {
      if (err instanceof SeamBodyReadError) {
        mapBodyReadFailure(err, path, timeoutMs);
      }
      return res.statusText;
    });
    throw new AnalyticsUpstreamError(
      text || `Analytics service error (${res.status})`,
      res.status,
    );
  }

  // SEAMCORE-11 / A-27, second half. This threw a GENERIC, untyped Error whose
  // message asked whether the service was "running on the correct port" — a
  // local-dev question, put to an operator mid-incident while a Railway edge
  // page was being served as `200 text/html`. It is now the same typed outcome
  // the null-body statuses take above.
  const contentType = res.headers.get("content-type");
  if (!(contentType ?? "").includes("application/json")) {
    throw new AnalyticsUpstreamError(
      unusableSeamResponseMessage(res.status, contentType),
      UNUSABLE_RESPONSE_STATUS,
    );
  }

  // THE SUCCESS ARM HAD NO CATCH AT ALL. This is SC1's downstream half: the
  // deadline can fire while the body streams, long after the transport `try`
  // above has closed, so the raw rejection escaped `analyticsRequest` past
  // every `instanceof` arm at the top of this function and surfaced to nine
  // wrappers as an unclassified crash.
  try {
    return await res.json();
  } catch (err) {
    mapBodyReadFailure(err, path, timeoutMs);
  }
}

/**
 * Parse an analytics response against a Zod schema. Logs a warning on
 * validation failure and returns the raw data so existing call sites
 * don't break on unexpected extra fields. The warning gives operators
 * a loud signal that contract drift has occurred.
 */
function parseResponse<T>(
  schema: z.ZodType<T>,
  data: unknown,
  endpoint: string,
): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    // SEAMCORE-06 — a zod issue array is error-DERIVED and can echo
    // request-derived values back into the line (a `received` field on a
    // credential-shaped input, an unexpected key carrying a token). Rendered to
    // a string first so the scrub can see it: passing the array straight to
    // `console.error` hands the runtime an object the leaf never inspected.
    console.error(
      `[analytics-client] Contract validation failed for ${endpoint}:`,
      scrubSeamString(JSON.stringify(result.error.issues)),
    );
    // Throw so callers get a clear error rather than silently wrong data.
    //
    // 140.4-09 / SEAMRIM-06 — SCRUBBED, for the reason stated four lines above.
    // The rule was written for the log and applied only there; this THROW is
    // reached from 8 of the 9 wrappers, and its message is caught and logged
    // again by every one of their callers. The channel is the issue PATH rather
    // than its message — a zod `invalid_type` message renders type NAMES only,
    // but a `z.record` key is response-controlled and becomes a path segment.
    //
    // ⚠️ NO STRUCTURAL GUARD WATCHES THIS LINE. `seam-log-coverage.test.ts` is
    // scoped to `console.*`, and a thrown sink is invisible to a console-scoped
    // predicate — there is no scan that can fail when this is re-opened. The
    // cases in `analytics-client.test.ts` are the only thing holding it.
    throw new Error(
      `Analytics response contract violation on ${endpoint}: ${scrubSeamString(result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "))}`,
    );
  }
  return result.data;
}

// DOGFOOD (2026-07-18): exchange API keys/secrets are whitespace-free tokens
// (Deribit ClientId/ClientSecret, Binance 64-hex, …). A stray leading/trailing
// space or newline from a copy-paste makes the exchange reject an otherwise
// CORRECT key with an auth error (observed: Deribit 13004 invalid_credentials
// on a live production key), which reads to the user as "my correct key is
// broken". Trim here — the single chokepoint every key-entry route funnels
// through (create-with-key, composite/add-key, keys/validate-and-encrypt) — so
// validate and encrypt normalise IDENTICALLY: the ciphertext we store is the
// exact trimmed credential we validated, so later syncs authenticate too.
// Passphrase is NOT trimmed: an OKX passphrase is user-CHOSEN and whitespace
// there could be significant.
function trimCredential(value: string): string {
  return value.trim();
}

/**
 * Phase 140.2-09 / TS-04 — `tenant` is REQUIRED and must be server-derived.
 *
 * It is an object rather than a fifth bare `string` because a bare string would
 * sit directly beside `passphrase`, and a transposition would compile cleanly
 * while minting the tenant claim over a USER-CHOSEN SECRET — a credential in an
 * outbound header, and every caller collapsed into one bucket keyed on it.
 * Threat T-140.2-09-02, made a type error instead of a leak.
 *
 * All three callers (`strategies/create-with-key`, `strategies/composite/add-key`,
 * `keys/validate-and-encrypt`) are `withAuth(async (req, user) => …)` and pass
 * `user.id` from the authenticated server session.
 */
export async function validateKey(
  exchange: string,
  apiKey: string,
  apiSecret: string,
  passphrase: string | undefined,
  tenant: TenantIdentity,
) {
  const data = await analyticsRequest(
    "/api/validate-key",
    {
      exchange,
      api_key: trimCredential(apiKey),
      api_secret: trimCredential(apiSecret),
      passphrase: passphrase ?? null,
    },
    { budgetKey: "validate-key", tenantId: tenant.userId },
  );
  return parseResponse(ValidateKeyResponseSchema, data, "/api/validate-key");
}

/** See `validateKey` for why `tenant` is an object and where it comes from. */
export async function encryptKey(
  exchange: string,
  apiKey: string,
  apiSecret: string,
  passphrase: string | undefined,
  tenant: TenantIdentity,
) {
  const data = await analyticsRequest(
    "/api/encrypt-key",
    {
      exchange,
      api_key: trimCredential(apiKey),
      api_secret: trimCredential(apiSecret),
      passphrase: passphrase ?? null,
    },
    { budgetKey: "encrypt-key", tenantId: tenant.userId },
  );
  return parseResponse(EncryptKeyResponseSchema, data, "/api/encrypt-key");
}

/**
 * Phase 28 (OPT-01/02) — request suggested long-only scenario weights from the
 * Python optimizer. `series` is the draft-scoped strategies' daily-return series
 * (id -> [{date, value}]); the Next route (allocator-authed) forwards ONLY the
 * caller's own series. Returns `weights: null` on a degenerate / under-sampled
 * input (the UI renders the honest empty state) — never a fabricated vector.
 * The weights are fit IN-SAMPLE (`in_sample: true`); the UI discloses that.
 *
 * Phase 140.2-09 / TS-04 — `tenant` is REQUIRED and server-derived
 * (`scenario/optimize` passes `user.id`). This is the SHARPEST of the five live
 * flips: `/api/optimize-weights` is limited at 20/minute, which was a PLATFORM
 * ceiling until the claim appeared — two allocators running Scenario Composer
 * concurrently could 429 each other. (The per-tenant VALUE may now be wrong in
 * the other direction; auditing limits after the flip rather than before is
 * TS-22, owned by Phase 146.)
 */
export async function optimizeScenarioWeights(
  series: Record<string, Array<{ date: string; value: number }>>,
  objective: "min_vol" | "max_sharpe",
  tenant: TenantIdentity,
): Promise<OptimizeWeightsResponse> {
  const data = await analyticsRequest(
    "/api/optimize-weights",
    { series, objective },
    { budgetKey: "optimize-weights", tenantId: tenant.userId },
  );
  return parseResponse(OptimizeWeightsResponseSchema, data, "/api/optimize-weights");
}

/**
 * C-PR5-01 remainder (audit-2026-05-07, follow-up to PR #347).
 *
 * `actorId` (the authenticated user's id) is now REQUIRED on both analytics
 * compute calls. It maps to the Python service's `req.user_id` parameter
 * which the handler uses as the second ownership gate
 * (`portfolios.user_id = req.user_id`) — the only defense against an
 * X-Service-Key holder forging a request for another tenant's portfolio.
 * The relaxed Optional[str] back-compat path in
 * `analytics-service/models/schemas.py` was the C-PR5-01 attack surface
 * identified by the PR-5 security review; tightening this signature on
 * the TS side ensures the route can't drift back to the broken state.
 *
 * Symmetric to `recomputeMatch(allocatorId, force, actorId)` which closed
 * the same shape on the match endpoint via PR #347.
 */
export async function computePortfolioAnalytics(
  portfolioId: string,
  actorId: string,
) {
  const data = await analyticsRequest(
    "/api/portfolio-analytics",
    {
      portfolio_id: portfolioId,
      user_id: actorId,
    },
    // TS-04: `actorId` is already the server-derived authenticated user id, so
    // this wrapper needed no signature change — it just had to stop being the
    // one member of the class that did not mint.
    { budgetKey: "portfolio-analytics", tenantId: actorId },
  );
  return parseResponse(PortfolioAnalyticsResponseSchema, data, "/api/portfolio-analytics");
}

export async function runPortfolioOptimizer(portfolioId: string, actorId: string) {
  const data = await analyticsRequest(
    "/api/portfolio-optimizer",
    { portfolio_id: portfolioId, user_id: actorId },
    // Phase 140 / SEAM-02: no timeout override. This wrapper carried an
    // optional `timeoutMs` third parameter purely so the route could keep
    // passing its legacy `OPTIMIZER_TIMEOUT_MS = 15_000`; 140-05 deleted that
    // route-local constant (the only caller), so the parameter went with it.
    // The deadline now has exactly ONE owner: the row below.
    // TS-04: `actorId` already carries the server-derived identity.
    { budgetKey: "portfolio-optimizer", tenantId: actorId },
  );
  return parseResponse(PortfolioOptimizerResponseSchema, data, "/api/portfolio-optimizer");
}

export async function findReplacementCandidates(
  portfolioId: string,
  underperformerStrategyId: string,
  userId: string,
) {
  const data = await analyticsRequest(
    "/api/portfolio-bridge",
    {
      portfolio_id: portfolioId,
      underperformer_strategy_id: underperformerStrategyId,
      user_id: userId,
    },
    // TS-04: `userId` already carries the server-derived identity.
    { budgetKey: "bridge", tenantId: userId },
  );
  return parseResponse(BridgeResponseSchema, data, "/api/portfolio-bridge");
}

/**
 * Sprint 6 Task 6.4 — portfolio impact simulator (ADD scenario).
 *
 * Calls the Python `/api/simulator` endpoint under the `simulator` budget
 * (SEAM_BUDGETS owns the value; it was a 15s literal here before Phase 140).
 * Response is validated against SimulatorResponseSchema — parse failures
 * throw so contract drift is loud.
 */
export async function simulateAddCandidate(
  portfolioId: string,
  candidateStrategyId: string,
  userId: string,
) {
  const data = await analyticsRequest(
    "/api/simulator",
    {
      portfolio_id: portfolioId,
      candidate_strategy_id: candidateStrategyId,
      user_id: userId,
    },
    // TS-04: the claim is INERT here — /api/simulator is the tenth route and is
    // still IP-keyed (TS-30, quarantined). Sent anyway: harmless, and the route
    // becomes per-tenant for free the moment the quarantine lifts.
    { budgetKey: "simulator", tenantId: userId },
  );
  return parseResponse(
    SimulatorResponseSchema,
    data,
    "/api/simulator",
  );
}

export async function recomputeMatch(
  allocatorId: string,
  force: boolean,
  actorId: string,
) {
  // C-PR5-01 (audit-2026-05-07): `actorId` is the authenticated user's
  // id (`supabase.auth.getUser().user.id`). Forwarding it lets
  // analytics-service assert the actor is allowed to recompute this
  // allocator (either actor == allocator or actor is an admin profile)
  // — defense-in-depth against any future Next.js route that drops the
  // admin gate before calling this client. Required at the TS-side
  // signature so every call site MUST compile with the binding
  // threaded through; a refactor that drops it fails the build before
  // it can ship.
  //
  // The Python schema accepts `actor_id` as optional for backward
  // compat with non-Next.js callers (cron handlers, debug scripts)
  // during the production rollout. Once every call site is TS-side
  // (post-this-PR rollout), the Python field can be promoted to
  // required in a follow-up PR.
  const data = await analyticsRequest(
    "/api/match/recompute",
    {
      allocator_id: allocatorId,
      force,
      actor_id: actorId,
    },
    // TS-04: INERT — /api/match/recompute has NO Python limiter at all (TS-21,
    // owned by Phase 146). Sent anyway, for the same reason as the simulator.
    { budgetKey: "match-recompute", tenantId: actorId },
  );
  return parseResponse(RecomputeMatchResponseSchema, data, "/api/match/recompute");
}

/**
 * Phase 140.2-09 / TS-04 — `tenant` is REQUIRED here even though the claim is
 * INERT: `/api/match/eval` has no Python limiter at all (TS-21, owned by Phase
 * 146).
 *
 * This is the ONE wrapper that had no identity of any kind, and it is exactly
 * the member a "thread it into the three that need it" reading would have left
 * behind — after which `analyticsRequest` could not have required `tenantId`,
 * and a tenth wrapper could have been added with no identity at all. The caller
 * (`/api/admin/match/eval`) is admin-gated and already holds `user.id`.
 */
export async function evalMatch(
  params: {
    lookback_days: string;
    partner_tag?: string;
  },
  tenant: TenantIdentity,
) {
  const qs = new URLSearchParams({ lookback_days: params.lookback_days });
  if (params.partner_tag) qs.set("partner_tag", params.partner_tag);
  // evalMatch has no fixed schema — it returns variable evaluation data.
  // Validation can be added when the eval response shape stabilizes.
  return analyticsRequest(`/api/match/eval?${qs.toString()}`, null, {
    budgetKey: "match-eval",
    method: "GET",
    tenantId: tenant.userId,
  });
}

// @internal — exposed for Phase 16 / OBSERV-01 unit tests only. Public
// wrappers (validateKey, encryptKey, ...) intentionally do NOT
// expose `correlationId` per plan Task 1 Step B (minimize blast radius;
// Plan 7 wires the SSE endpoint to pass it explicitly). Production code
// MUST NOT import this — use the public wrappers above instead.
export const __INTERNAL_analyticsRequest = analyticsRequest;
