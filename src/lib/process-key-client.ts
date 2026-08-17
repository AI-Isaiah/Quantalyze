import { NextResponse } from "next/server";
import { getCorrelationId } from "@/lib/correlation-id";
import {
  resilientFetch,
  SeamConfigError,
  SEAM_BUDGETS,
  type SeamBudgetKey,
  type SeamResponse,
} from "@/lib/resilient-fetch";
import { CircuitOpenError, SeamBodyReadError } from "@/lib/seam-errors";
import { CIRCUIT_OPEN_COPY as CIRCUIT_OPEN_HUMAN_MESSAGE } from "@/lib/seam-copy";
import { scrubSeamError } from "@/lib/seam-redaction";
import { mintTenantClaim } from "@/lib/tenant-claim";
// Phase 141 / SEAM-05+06 — the retry-safety registry, consulted at THIS
// chokepoint (the belt). A VALUE import of a dependency-free leaf: it carries
// no runtime edge and survives the wholesale seam mocks (see that file's
// header), so importing it here does not change what the teaser bundle drags in.
import { retriesForFlow } from "@/lib/seam-retry-registry";

/**
 * Phase 19 / M-3 — shared client for the unified `/process-key` upstream.
 *
 * Every Phase-19 thin adapter (verify-strategy, keys/sync, keys/validate-and-encrypt,
 * strategies/finalize-wizard, strategies/csv-validate, and — until Phase 145
 * re-pointed it at the folded finalize RPC — strategies/csv-finalize)
 * spoke this protocol locally with copy-pasted blocks:
 *
 *   1. Read `INTERNAL_API_TOKEN` env. If missing → 503 "Service unavailable".
 *   2. Resolve a correlation id (Sentry trace or random UUID).
 *   3. POST `/process-key` on the analytics service with
 *      `{ flow_type, source, context }` and a Bearer/X-Correlation-Id pair.
 *   4. Return the upstream response as a NextResponse, preserving status.
 *
 * Centralizing it here gives one place to thread observability, retries,
 * timeouts, or the eventual unified-encrypt branch without touching each
 * route. Each thin adapter now needs ~3 lines.
 *
 * Phase 140 / SEAM-01 + SEAM-04: the transport moved to
 * `resilient-fetch.ts` — the base URL, the wall-clock budget and the
 * `breaker:railway` circuit are the core's, not this module's. In exchange,
 * this module gained the `CIRCUIT_OPEN` arm, which all five Mechanism-B
 * callers inherit for free through their existing `result.response`
 * passthrough.
 *
 * Returned shape
 * --------------
 *   { ok: true, status, body }   on a successful upstream call (2xx)
 *   { ok: false, response }      on token-missing 503, breaker-open 503,
 *                                timeout 504, network 502, or upstream non-2xx
 *
 * Callers that want a NextResponse directly can use `postProcessKey()` and
 * fall back to `result.response` when `ok === false`. Callers that need to
 * inspect/translate the body (e.g. API-9 / I-API1 response-shape mapping)
 * branch on `ok === true` and read `result.body`.
 */

export type FlowType = "teaser" | "onboard" | "resync" | "csv";

/**
 * Phase 140 / SEAM-02 — pick the wall-clock budget matching what the SERVER
 * actually does with this flow.
 *
 * `analytics-service/routers/process_key.py:_is_long_fetch` is the source of
 * this split: {resync, onboard} are merely ENQUEUED onto the worker dyno and
 * return 202 immediately, while {teaser, csv} run the full 5-method pipeline
 * INLINE. The pre-140 client spent a blanket 60s on all four, so a sick
 * Railway held a Vercel concurrency slot 45s longer than necessary on the two
 * enqueue paths. Keep this function in lockstep with `_is_long_fetch`.
 *
 * ⚠️ Phase 141 / SEAM-06 — THE RETRY DECISION IS KEYED ON `flow_type`, NOT ON
 * THIS BUDGET KEY, FOR THE SAME MANY-TO-ONE REASON THIS FUNCTION EXISTS. Because
 * `process-key-sync` serves BOTH teaser and csv, and `process-key-enqueue` serves
 * BOTH onboard and resync, keying the retry on `budgetKey` would retry teaser the
 * moment csv were allowed onto the sync budget — the SC3 landmine (a retry
 * double-mints the teaser's verification/public_token/lead). So the retry gate at
 * the `resilientFetch` init below calls `retriesForFlow` with `args.flow_type`,
 * and that helper resolves absence from the YES map to zero WITHOUT delegating to
 * the budget row — a future flip of the `process-key-sync` row can never retry
 * teaser/csv. That is the belt; 141.2 / D-01 moved it inside the helper (which
 * also narrows onboard's grant to calls carrying an idempotency key) rather than
 * leaving it as an inline `?? 0` here, so the gate and the audited evidence it
 * enforces sit in one place.
 *
 * ⚠️ Phase 141.1 / D-11 — WHY THIS IS A `never`-DEFAULTED SWITCH AND NOT THE
 * TERNARY IT USED TO BE. The ternary read
 * `flowType === "teaser" || flowType === "csv" ? "process-key-sync" :
 * "process-key-enqueue"`, so EVERY flow that was not one of those two fell
 * through to the enqueue budget. The RETRY consequence of that fall-through is
 * already covered — the belt above gives an unaudited flow zero retries whatever
 * budget key it lands on, by registry absence. The BUDGET consequence is not, and it is the
 * reason this switch exists:
 *
 *   `process-key-enqueue` is 15 000 ms; `process-key-sync` is 60 000 ms
 *   (`SEAM_BUDGETS`). A flow that runs INLINE but falls through to the enqueue
 *   key gets a quarter of the wall clock it needs and reports a healthy Railway
 *   as `UPSTREAM_TIMEOUT` 504.
 *
 * ⭐ THE FIFTH FLOW IS NOT HYPOTHETICAL. The server's own vocabulary is already
 * WIDER than this union: `FlowType` in
 * `analytics-service/services/ingestion/adapter.py` is
 * `Literal["teaser", "onboard", "internal_report", "csv", "resync"]`, and
 * `internal_report` has a live source whitelist, its own return-based scalar
 * path and its own branch through the synchronous pipeline. `_is_long_fetch`
 * returns False for it, so it runs INLINE and belongs on the 60 000 ms sync
 * budget. It has ZERO TypeScript emitters today, which is the only reason the
 * fall-through never shipped as a defect. The moment anyone widens the union
 * below to reach it, the old ternary would have handed an inline flow the 15 000
 * ms enqueue budget silently; the `default` arm now makes that a COMPILE error
 * and forces the author to choose an arm. Keep this function in lockstep with
 * `_is_long_fetch`, in BOTH directions.
 */
function budgetKeyFor(flowType: FlowType): SeamBudgetKey {
  switch (flowType) {
    // INLINE on the server (`_is_long_fetch` false): the full 5-method pipeline
    // runs before the response, so the caller waits for the whole thing.
    case "teaser":
    case "csv":
      return "process-key-sync";
    // ENQUEUED (`_is_long_fetch` true): the server hands the work to the worker
    // dyno and answers 202, so 15s here means Railway is sick, not busy.
    case "onboard":
    case "resync":
      return "process-key-enqueue";
    default: {
      // Fail loud per Rule 12 — the same shape as `pickAuditDiffFields`'s
      // schema-drift arm. There is no correct silent answer here: guessing
      // `process-key-enqueue` is the 15s-vs-60s defect above, and guessing
      // `process-key-sync` would hold a Vercel concurrency slot 45s longer than
      // an enqueue needs. Unreachable while `FlowType` has four members, which
      // is precisely what the `never` assignment asserts.
      const _exhaustive: never = flowType;
      throw new Error(
        `budgetKeyFor: unhandled flow_type — FlowType grew without a budget arm? got=${JSON.stringify(_exhaustive)}`,
      );
    }
  }
}

// User-facing copy for the SEAM-04 503, bound above as an alias of the ONE
// declaration in `@/lib/seam-copy`. STATIC by design (threat T-140-08): a
// breaker trip is an infrastructure fact, and the UNAUTHENTICATED teaser path
// renders this string directly. It carries no upstream URL, no status and no
// error detail — the diagnosable half goes to the server log with the routeTag
// and correlation_id. That teaser reachability is also why the leaf must stay
// dependency-free; `seam-copy.purity.test.ts` guards it.

/**
 * User-facing copy for "we never reached the ingestion service", shared by the
 * transport arm and by the SEAMCORE-11 ambiguous-transport arm below.
 *
 * Extracted to a constant when the second user appeared: this plan authors NO
 * new user-facing copy (140.3 owns the client-facing surface), and a second
 * hand-copied literal is how "no new copy" quietly becomes two copies that
 * drift.
 */
const UPSTREAM_NETWORK_ERROR_HUMAN_MESSAGE =
  "Could not reach the ingestion service.";

/**
 * Phase 140.3-15 / TS-38 + SEAMUX-04 — user-facing copy for "the fault is a
 * setting on OUR side", the envelope half 140.2 recorded as owed to this phase.
 *
 * ⚠️ STATIC, under the SAME constraint as `CIRCUIT_OPEN_HUMAN_MESSAGE` (threat
 * T-140-08 / T-140.3-15-02): the UNAUTHENTICATED landing-page teaser renders
 * this string directly, so it carries NO URL, NO status, NO hostname and NO env
 * variable name. The diagnosable half — which config value, which route — goes
 * to the operator log beside the `correlation_id`, where ME-01 already pins it.
 *
 * THREE CONSTRAINTS AT ONCE, and each one rules out an easier sentence:
 *   1. It must NOT blame the upstream. "Could not reach the ingestion service"
 *      is the lie TS-38 exists to remove — nothing was ever sent, and Railway
 *      is fine.
 *   2. It must NOT invite a retry. `SeamConfigError` is raised BEFORE any store
 *      or network I/O (`resilient-fetch.ts`: "throws SeamConfigError for a
 *      caller/config fault (before any store or network I/O)"), and the setting
 *      stays wrong until we redeploy. Saying so in the sentence is what stops a
 *      user burning their own time on a control that cannot work.
 *   3. It must be true on every path that reaches it. The one fact common to
 *      every `SeamConfigError` is that the request was never issued.
 *
 * DESIGN.md §Voice: declarative, sentence-case, active, no exclamation, no
 * adjective where a fact will do. The em dash is one of the five permitted
 * semantic glyphs.
 */
const SEAM_MISCONFIGURED_HUMAN_MESSAGE =
  "We could not send this request — our own configuration is wrong. Retrying will not clear it.";

/**
 * The routable status for the outcome above.
 *
 * ⚠️ THIS IS A DECISION, NOT A COPY OF THE SIBLING. Every other status on this
 * function was rejected first, and the reasons are the obligation:
 *   · 502 — "the UPSTREAM is bad". That is precisely the false attribution
 *     TS-38 exists to stop; keeping it would leave the lie in the status line
 *     after removing it from the sentence.
 *   · 503 / 504 — both signal TRANSIENCE. This condition is permanent until an
 *     operator redeploys, so a transient-signalling status invites exactly the
 *     retry `recoverable: false` is removing. (`140.3-14` recorded the same
 *     mismatch as a residual on the composite member cap; this arm does not
 *     inherit it.)
 *   · 500 — "the server that produced THIS response is at fault", which is the
 *     literal truth: we are the server, and our configuration is wrong. It is
 *     also the status `STATUS_CONTRACT.md` §1 gives the SERVICE-PERMANENT class
 *     ("a deterministic fault can only be cleared by an operator"), which is
 *     this fault exactly.
 *
 * No `Retry-After` rides with it: naming a wait no one advertised is TRAP-3,
 * and there is no wait that would help.
 */
const SEAM_MISCONFIGURED_STATUS = 500;

/**
 * Phase 140.2-11 / SEAMCORE-11 (A-27) — THE ONE DEFINED OUTCOME for an
 * ambiguous transport. Stated identically here and in
 * `src/lib/analytics-client.ts` so the next reader does not have to diff the two
 * files to find out what the seam does with a 204.
 *
 * WHAT IS AMBIGUOUS
 *   1. A 2xx whose content-type is not JSON. The modal case is a Railway edge
 *      or maintenance page served as `200 text/html`: the transport succeeded,
 *      the breaker (correctly) counts nothing, and what came back is not the
 *      service. This client used to swallow it — `res.json()` rejected, the
 *      `{}` fallback caught it, and the edge page was reported to the caller as
 *      a well-formed success.
 *   2. The three NULL-BODY statuses 204 / 205 / 304, which carry no body at all.
 *      204 and 205 are `ok`, so they returned `{ ok: true, status, body: {} }`
 *      while `analytics-client` threw on the identical response; 304 is not
 *      `ok`, so it reached the status pass-through and CRASHED.
 *
 * THE OUTCOME, in both clients
 *   A typed upstream error carrying the OBSERVED status and content-type, in a
 *   static operator-facing message that names the SEAM. `analytics-client`
 *   THROWS it as `AnalyticsUpstreamError`; here the identical message goes to
 *   the operator log and the outcome is RETURNED as an `{ ok: false, response }`
 *   502 envelope — never thrown. Plan 140.2-05 widened this function's `try`
 *   specifically to keep it non-throwing for its caller routes
 *   (strategies/csv-validate, strategies/finalize-wizard, keys/sync,
 *   verify-strategy; strategies/csv-finalize until Phase 145 re-pointed it),
 *   none of which has a catch for it; closing A-27
 *   with a throw would undo that in the same file.
 *
 * WHY THE THREE STATUSES ARE DECIDED ON THE STATUS, BEFORE ANY RESPONSE IS
 * CONSTRUCTED. Verified by execution on Node v25.8.1:
 * `Response.json(body, { status: 204 | 205 | 304 })` throws
 * `TypeError: Response constructor: Invalid response status code`. That is
 * WHATWG-spec behaviour, not a runtime quirk, so CI's Node 22 and local Node 25
 * agree. The construction ITSELF is the fault, so no arm may reach it — which
 * is why the check sits ABOVE the `!res.ok` pass-through rather than inside it.
 *
 * The 502 is the routable status: the gateway answered, unusably. The user-facing
 * envelope is the one that ALREADY exists for "we never reached it", because a
 * maintenance page is not reaching it. Zero new codes, zero new copy.
 *
 * The BREAKER VERDICT IS UNCHANGED by all of this (SEAMCORE-01): a 2xx is not a
 * service fault and a 304 is not either. This is what the CLIENT does with the
 * response, not what the core counts.
 */
const NULL_BODY_STATUSES: ReadonlySet<number> = new Set([204, 205, 304]);

/** The routable status for the outcome above: the gateway answered, unusably. */
const UNUSABLE_RESPONSE_STATUS = 502;

/**
 * The operator-facing message for the outcome above.
 *
 * DUPLICATED, byte-for-byte, in `src/lib/analytics-client.ts`, and guarded by a
 * comment-stripped drift check in `analytics-client.test.ts`. It is duplicated
 * rather than shared because neither client may import from the other (EVERY
 * ROUTE TEST THAT MOCKS A SEAM CLIENT WHOLESALE with a full factory replaces it
 * entirely, and under such a mock a cross-client import evaluates to
 * `undefined`), and it cannot move to the dependency-free error leaf either —
 * that leaf's exported surface is pinned to a two-member hand-typed set.
 *
 * 140.5-03 / WP-15 — the integer that used to stand where the predicate now
 * does was a COUNT of those route tests. It was already stale, and correcting a
 * stale count to a fresh one only resets the clock on the same defect: the
 * reason holds for one such test or for fifty, so the predicate is the honest
 * form and there is nothing left to go out of date.
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
 * Phase 140.1 / PYAPI-02 — the `X-Tenant-Claim` mint used to live HERE, as a
 * module-private `mintTenantClaim` + `TENANT_CLAIM_TTL_SECONDS` pair.
 *
 * Phase 140.2-09 / TS-04 moved it, ALGORITHM UNCHANGED, to
 * `src/lib/tenant-claim.ts`, because `analytics-client.ts` now mints the same
 * header for the six rekeyed Python routes it reaches. Two copies of an HMAC
 * construction that must also agree with a third implementation in another
 * language is the drift class this programme exists to close. The "why no new
 * secret" / "why not just X-User-Id" reasoning moved with it — read it there.
 *
 * The wire bytes are unchanged: `process-key-client.test.ts` still pins the same
 * cross-language literal `analytics-service/tests/test_process_key.py` reads.
 */

/**
 * Body-read fallback for the upstream response.
 *
 * TWO CASES, conflated before SEAMCORE-02. A genuinely absent or unparseable
 * body keeps the `{}` fallback — an upstream that answers a non-2xx with an
 * empty or non-JSON body is real and this client has always tolerated it. An
 * ABORT does not: the core has already recorded that failure against the
 * breaker, so turning it into an empty object would report a dying Railway as a
 * well-formed upstream reply, with the request's own status on the envelope.
 */
function emptyBodyUnlessSeamRead(err: unknown): Record<string, never> {
  if (err instanceof SeamBodyReadError) throw err;
  return {};
}

export interface PostProcessKeyArgs {
  flow_type: FlowType;
  source: string;
  context: Record<string, unknown>;
  /** Optional override; if omitted the helper resolves via `getCorrelationId()`. */
  correlationId?: string;
  /** Optional caller tag used in the 503 log line so failures are grep-able. */
  routeTag?: string;
  /**
   * CT-4 (army2) — required tenant identifier forwarded as `X-User-Id`
   * on the upstream POST. The Python rate limiter
   * (analytics-service/routers/process_key.py:_process_key_rate_limit_key)
   * keys on `(token_hash, X-User-Id)` so each user gets an isolated
   * 100/hour window. Pre-fix the header was never sent, so every request
   * bucketed to the same `process_key:<token_hash>:anon` key — one
   * tenant's burst could starve every other tenant.
   *
   * For unauthenticated public flows (the landing-page teaser) callers
   * MUST pass the literal string `'public'` so the limiter buckets all
   * anonymous traffic to a shared `process_key:<token_hash>:public`
   * window, isolated from any authenticated tenant.
   */
  userId: string;
  /**
   * Phase 19.1 (2026-05-27) — the END USER's Supabase access token (JWT),
   * forwarded as the `X-User-Access-Token` header so the unified router can
   * call SECURITY DEFINER RPCs that enforce `auth.uid() = p_user_id`. The
   * analytics service's service-role client has no `auth.uid()`; without
   * this such an RPC raises 42501 "called without an auth session".
   *
   * ⚠️ Phase 145: the CSV finalize step — the only caller that passed this —
   * left this seam (the route calls the folded finalize RPC directly on its
   * SSR user client, per 145-DECISION.md). The option and the header
   * forwarding are KEPT per the standing 140.x obligation (user-scoped
   * pre-checks on onboard/resync need this transport) — do not delete as
   * "unused".
   */
  userAccessToken?: string;
}

export type PostProcessKeyResult =
  | { ok: true; status: number; body: unknown }
  | { ok: false; response: NextResponse };

/**
 * Single-source the `INTERNAL_API_TOKEN` 503 branch + the upstream POST.
 *
 * Returns a discriminated union so callers can either short-circuit with
 * `result.response` on failure, or branch on `result.body` on success
 * (needed for API-9 / I-API1 response-shape translation).
 */
export async function postProcessKey(
  args: PostProcessKeyArgs,
): Promise<PostProcessKeyResult> {
  const internalToken = process.env.INTERNAL_API_TOKEN;
  if (!internalToken) {
    const tag = args.routeTag ?? "process-key-client";
    console.error(`[${tag}] INTERNAL_API_TOKEN not configured`);
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Service unavailable" },
        { status: 503 },
      ),
    };
  }

  const correlationId = args.correlationId ?? (await getCorrelationId());

  // CT-7 (army2) — wall-clock budget for the upstream POST. Without a
  // client-side timeout the Vercel function hangs until maxDuration and
  // returns a generic 504 with no clean envelope. Phase 140 moved the budget
  // itself into SEAM_BUDGETS and split it by flow type (see budgetKeyFor);
  // the core applies it and owns the breaker.
  const budgetKey = budgetKeyFor(args.flow_type);
  const timeoutMs = SEAM_BUDGETS[budgetKey].timeoutMs;

  /**
   * Phase 140.2-09 / TS-04 — the claim is minted HERE, OUTSIDE the transport
   * `try`, and that placement is load-bearing.
   *
   * The extraction to `@/lib/tenant-claim` added fail-loud refusals (empty
   * payload, dotted payload, absent secret) to a call that previously could not
   * throw. The mint used to sit inline in the headers object below — i.e. INSIDE
   * the classification window — so a refusal would have been swallowed by the
   * catch and reported to the caller as `UPSTREAM_NETWORK_ERROR` 502: a
   * configuration fault on OUR side wearing a dead-Railway costume, which is the
   * precise silent degradation the refusals exist to prevent.
   *
   * It does not THROW out of `postProcessKey` either. This function's declared
   * type is `Promise<PostProcessKeyResult>` and it has never thrown at any of
   * its five caller routes, none of which has a catch for it (see the ⚠️ block
   * on `body` below). A refusal therefore takes the SAME shape as the
   * missing-token 503 above: loud in the server log, clean envelope on the wire.
   */
  let tenantClaim: string;
  try {
    // The identity is WRAPPED, not passed bare: `mintTenantClaim`'s first
    // parameter is a `TenantIdentity` so `mintTenantClaim(internalToken,
    // args.userId)` — the transposition that would ship the platform secret in
    // an outbound header — cannot compile. See that function's docblock.
    tenantClaim = mintTenantClaim({ userId: args.userId }, internalToken);
  } catch (err) {
    const tag = args.routeTag ?? "process-key-client";
    console.error(
      `[${tag}] refusing to call /process-key — could not mint X-Tenant-Claim`,
      {
        correlation_id: correlationId,
        // SEAMCORE-06 — through the redaction leaf, not raw. The mint's own
        // messages name the env variable and never its value, so nothing is
        // expected to be scrubbed here; the guard in `seam-log-coverage.test.ts`
        // is a CLASS guard on this file's log sites, and carving out the one
        // site whose thrown value "looks safe today" is how the class re-opens.
        reason: scrubSeamError(err),
      },
    );
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Service unavailable" },
        { status: 503 },
      ),
    };
  }

  // SEAMCORE-02: the core returns a `SeamResponse`, whose `json()` / `text()`
  // run inside its classification window. Only `ok`, `status` and `json` are
  // used here, all of which the closed surface carries.
  let res: SeamResponse;
  /**
   * The upstream body.
   *
   * ⚠️ THE READ BELOW IS INSIDE THE `try` ON PURPOSE, AND MUST STAY THERE.
   * This client's `try` used to wrap ONLY the `resilientFetch` call, with both
   * body reads sitting after the catch — so a `SeamBodyReadError` from either
   * would have escaped `postProcessKey`, a function whose declared type is
   * `Promise<PostProcessKeyResult>` and which has NEVER thrown, at any of its
   * caller routes (strategies/csv-validate, strategies/finalize-wizard,
   * keys/sync, verify-strategy; strategies/csv-finalize until Phase 145),
   * none of which has a catch for it. That would be new unhandled-throw
   * paths shipped as a side effect of a body-read fix. A later refactor that
   * "simplifies" this try back to wrapping only the fetch re-opens them all.
   *
   * The two reads the plan enumerates as sites 4 and 5 were byte-identical
   * (`await res.json().catch(() => ({}))`) and sat on mutually exclusive
   * branches, so ONE instrumented read before the branch covers both without
   * calling `json()` twice.
   */
  let body: unknown;
  try {
    // Headers and body pass through the core byte-for-byte. A dropped
    // X-User-Id re-opens the CT-4 cross-tenant rate-limit-bucket defect.
    res = await resilientFetch(budgetKey, "/process-key", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${internalToken}`,
        "X-Correlation-Id": correlationId,
        // CT-4 (army2) — forward tenant id for cross-tenant rate-limit
        // isolation. See PostProcessKeyArgs.userId for the contract.
        // NOTE: this header is UNSIGNED and the Python limiter deliberately
        // ignores it for bucketing. It survives for logging/diagnostics; the
        // signed X-Tenant-Claim below is what actually selects the bucket.
        "X-User-Id": args.userId,
        // Phase 140.1 / PYAPI-02 — the signed half of the same identity. This
        // is the ONE chokepoint: all five postProcessKey callers share this
        // headers assembly, so minting here is what makes per-tenant throttling
        // live end-to-end. Teaser callers pass userId "public", which mints the
        // shared anonymous bucket rather than a tenant one. Minted ABOVE, not
        // inline: see the tenantClaim block for why the call must not sit inside
        // this try.
        "X-Tenant-Claim": tenantClaim,
        // Phase 19.1 — forward the end user's access token so the unified
        // router can call user-auth SECURITY DEFINER RPCs as the user. No
        // production caller passes it since Phase 145 (csv-finalize left this
        // seam); the transport is kept per the 140.x obligation above.
        ...(args.userAccessToken
          ? { "X-User-Access-Token": args.userAccessToken }
          : {}),
      },
      body: JSON.stringify({
        flow_type: args.flow_type,
        source: args.source,
        context: args.context,
      }),
      cache: "no-store",
      // Phase 141 / SEAM-06, narrowed by 141.2 / D-01 — the retry gate. ONE
      // function decides BOTH halves of the verdict: the flow's audited verdict
      // AND the idempotency-key antecedent that verdict rests on. `retriesForFlow`
      // lives in the registry, beside the evidence it enforces; the belt that
      // used to be an explicit `?? 0` here now lives inside it, unchanged in
      // meaning — absence from the YES map never delegates to the budget row, so
      // a future flip of the `process-key-sync` row can never retry teaser/csv.
      //
      // ⚠️ `onboard` IS THE ONLY ALLOWLISTED FLOW, and its grant is CONDITIONAL.
      // (The sentence that stood here named onboard AND resync; 141.2 / D-03
      // withdrew resync's grant, and D-01 then made onboard's contingent on a
      // truthy `wizard_session_id` in the context — because the server has
      // nothing to dedupe on without one and mints a fresh session per attempt.)
      // teaser/csv resolve to 0 by registry absence.
      //
      // ⚠️ FAIL-CLOSED AT TWO LAYERS. `PostProcessKeyArgs.context` is REQUIRED,
      // so a caller that states no context does not compile — that is the
      // stronger guarantee and it is kept deliberately; do not add a `?`.
      // `retriesForFlow`'s undefined arm is the runtime belt behind it, for the
      // access paths types cannot reach (JS callers, casts, future refactors).
      //
      // ⚠️ KEEP THIS EXPRESSION ON ONE PHYSICAL LINE. The wiring guard extracts
      // the `retriesOverride` SOURCE and compares it to a hand-typed roster; its
      // extractor is line-scoped, so a wrapped or multi-line expression is
      // captured partially and reddens. Update the roster in the SAME commit as
      // any change here — that pairing is the guard, not an inconvenience.
      retriesOverride: retriesForFlow(args.flow_type, args.context),
    });
    body = await res.json().catch(emptyBodyUnlessSeamRead);
  } catch (err) {
    const tag = args.routeTag ?? "process-key-client";
    // ORDER IS LOAD-BEARING: CircuitOpenError FIRST. The generic arms below
    // would otherwise report a breaker trip as a network failure (502), and
    // the caller would never see the Retry-After hint that makes the trip
    // actionable.
    if (err instanceof CircuitOpenError) {
      console.error(
        `[${tag}] /process-key short-circuited — the analytics circuit is open`,
        { correlation_id: correlationId, retry_after_s: err.retryAfterS },
      );
      return {
        ok: false,
        response: NextResponse.json(
          {
            ok: false,
            code: "CIRCUIT_OPEN",
            human_message: CIRCUIT_OPEN_HUMAN_MESSAGE,
            correlation_id: correlationId,
            recoverable: true,
          },
          {
            status: 503,
            headers: { "Retry-After": String(err.retryAfterS) },
          },
        ),
      };
    }
    // ME-01 — a CONFIG fault on OUR side is NAMED in the operator log before it
    // takes the generic envelope below.
    //
    // `SeamConfigError` is raised above the classification window, so the
    // breaker correctly hears nothing. What was missing is that nothing
    // downstream could tell it apart from a dead upstream: it took the
    // `UPSTREAM_NETWORK_ERROR` 502 arm with human_message "Could not reach the
    // ingestion service", so a malformed `ANALYTICS_SERVICE_URL` — our own
    // deployment typo — read to ops as Railway being down.
    //
    // ✅ 140.3-15 / TS-38 CLOSED THE ENVELOPE HALF. The paragraph above is the
    // history; below is what ships. 140.2 could fix only the LOG, because
    // giving this fault its own `code` and `human_message` is authoring
    // user-facing copy and that was 140.2's fence. `analytics-client`'s sibling
    // remedy — rethrow unwrapped — remains unavailable and always will be: this
    // function is declared never to throw at its five caller routes, none of
    // which has a catch for it. So the arm RETURNS an envelope, exactly like
    // every other arm in this catch.
    //
    // ⚠️ THE LOG LINE IS BYTE-UNCHANGED. `process-key-client.test.ts`'s ME-01
    // falsifier pins the operator half; this plan adds the user half BESIDE it
    // and must not disturb it (TRAP-9).
    if (err instanceof SeamConfigError) {
      console.error(
        `[${tag}] CONFIG fault reaching /process-key — not an upstream failure, and NOT a reason to blame Railway:`,
        scrubSeamError(err),
        { correlation_id: correlationId },
      );
      return {
        ok: false,
        response: NextResponse.json(
          {
            ok: false,
            code: "SEAM_MISCONFIGURED",
            human_message: SEAM_MISCONFIGURED_HUMAN_MESSAGE,
            correlation_id: correlationId,
            // Permanent until an operator redeploys. `recoverable: false` is
            // what stops `ErrorEnvelope` rendering a Retry control, and a
            // control that can never succeed is the second half of the defect.
            recoverable: false,
          },
          { status: SEAM_MISCONFIGURED_STATUS },
        ),
      };
    }
    // A body-read failure maps onto the taxonomy ALREADY here rather than
    // getting an envelope of its own: `deadlineExceeded` true is the same fact
    // as a transport abort (the deadline covers the response STREAM, not just
    // the header exchange), and false is the same fact as a connection that
    // never completed. Zero new codes, zero new human_message copy — 140.3 owns
    // the client-facing surface, and both envelopes below already exist.
    const isAbort =
      err instanceof SeamBodyReadError
        ? err.deadlineExceeded
        : (err instanceof Error || err instanceof DOMException) &&
          (err.name === "AbortError" || err.name === "TimeoutError");
    if (isAbort) {
      console.error(
        // The budget is no longer universally 60s — report the one that fired.
        `[${tag}] /process-key upstream timed out after ${timeoutMs}ms (CT-7)`,
        { correlation_id: correlationId },
      );
      return {
        ok: false,
        response: NextResponse.json(
          {
            ok: false,
            code: "UPSTREAM_TIMEOUT",
            human_message:
              "The ingestion service did not respond in time. Please try again.",
            correlation_id: correlationId,
            recoverable: true,
          },
          { status: 504 },
        ),
      };
    }
    // Non-timeout network errors surface as 502 so the caller can
    // distinguish "we never reached upstream" from "upstream rejected us".
    const message = err instanceof Error ? err.message : "Network error";
    // SEAMCORE-06 / TRAP-1 — THE undici site. This is the one that actually
    // leaks: undici embeds the outgoing headers in `err.message`, and this
    // request's headers are `Authorization: Bearer <INTERNAL_API_TOKEN>`,
    // `X-Tenant-Claim`, and — for any caller passing userAccessToken (none in
    // production since Phase 145, but the transport is kept) —
    // `X-User-Access-Token`, a LIVE end-user Supabase JWT. The token comes
    // from the leaf's env list; the JWT cannot, so it is passed explicitly.
    // The syscall token survives, which is the whole reason the raw message
    // is not simply dropped.
    console.error(
      `[${tag}] /process-key upstream fetch threw:`,
      scrubSeamError(message, [args.userAccessToken]),
    );
    return {
      ok: false,
      response: NextResponse.json(
        {
          ok: false,
          code: "UPSTREAM_NETWORK_ERROR",
          human_message: UPSTREAM_NETWORK_ERROR_HUMAN_MESSAGE,
          correlation_id: correlationId,
          recoverable: true,
        },
        { status: 502 },
      ),
    };
  }

  // The NextResponse construction stays OUTSIDE the try. Only the fetch and the
  // body read belong in the classification window; widening it further would
  // swallow the A-27 null-body-status crash (`NextResponse.json(body, {status:
  // 304})` throws) rather than fix it — the arm immediately below is the fix,
  // and it works by never letting that construction be reached.

  // SEAMCORE-11 / A-27 — the ambiguous transports, decided BEFORE any response
  // is constructed and BEFORE the `!res.ok` fork. Both halves land here so the
  // three null-body statuses and the non-JSON 2xx get ONE answer: split across
  // the `ok` fork they would get two, which is the divergence being closed.
  // See the NULL_BODY_STATUSES block above for the full statement.
  const contentType = res.headers.get("content-type");
  const isJsonBody = (contentType ?? "").includes("application/json");
  if (NULL_BODY_STATUSES.has(res.status) || (res.ok && !isJsonBody)) {
    const tag = args.routeTag ?? "process-key-client";
    // The ONLY place the observed status and content-type are recorded: the
    // envelope below is deliberately generic (140.3's fence). Nothing
    // error-derived is logged here — the values are this client's own
    // observations of the response line, so there is nothing for the
    // SEAMCORE-06 scrub leaf to do.
    console.error(
      `[${tag}] ${unusableSeamResponseMessage(res.status, contentType)}`,
      { correlation_id: correlationId },
    );
    return {
      ok: false,
      response: NextResponse.json(
        {
          ok: false,
          code: "UPSTREAM_NETWORK_ERROR",
          human_message: UPSTREAM_NETWORK_ERROR_HUMAN_MESSAGE,
          correlation_id: correlationId,
          recoverable: true,
        },
        { status: UNUSABLE_RESPONSE_STATUS },
      ),
    };
  }

  /**
   * Phase 140.3-02 / TS-11 — VERIFIED, NOT CHANGED. Read this before "restoring"
   * anything about the flow below.
   *
   * ⚠️ THERE ARE TWO `ok`s ON THIS SEAM AND THEY ANSWER DIFFERENT QUESTIONS.
   *
   *   · `PostProcessKeyResult.ok` (this function's) is a TRANSPORT verdict:
   *     "did the upstream answer 2xx with a usable body". Nothing more.
   *   · `body.ok` (the Python envelope's, `process_key.py:_envelope_error` and
   *     every success builder) is the SEMANTIC verdict: "did the thing the
   *     caller asked for succeed".
   *
   * They disagree in BOTH directions, which is why no caller may treat one as
   * the other and why none may branch on the STATUS instead:
   *
   *   403 write-capable-key verdict (PYAPI-10b)  → `{ok:false, response}`, the
   *       Python envelope forwarded VERBATIM at 403. No change required here;
   *       the callers' `if (!result.ok) return result.response` already emits it.
   *   403 ordinary validation failure            → the SAME arm. `_scope_rejected`
   *       is a three-arm OR behind one return, so `not val.valid` moved to 403
   *       beside the two scope arms. A caller branching on the status renders an
   *       ordinary validation failure as "you're not allowed".
   *   200 with `body.ok === false`               → `{ok:true, status:200, body}`.
   *       THIS is the case that makes a status branch wrong on the other side:
   *       `validate-only` answers 200 with `ok:false` on the IDENTICAL
   *       `not val.valid` predicate that `_scope_rejected` answers 403 on
   *       (fold-in M-6 from the 140.1 code review; STATUS_CONTRACT.md records
   *       the carve-out nowhere). A consumer branching on STATUS is therefore
   *       wrong on one of the two paths no matter which status it picks.
   *       Branching on `body.ok` is correct on both — do NOT "simplify" it back.
   *   202 enqueue                                → `{ok:true, status:202, body}`
   *       with `body` = `{ok:true, queued:true, verification_id, correlation_id}`.
   *
   * CONSEQUENCE FOR CALLERS, stated because it is the non-obvious half: every
   * caller's `if (!result.ok) return result.response` now SHORT-CIRCUITS on a
   * rejection that used to flow through the success path. A downstream shape
   * guard that used to double as the rejection handler no longer sees rejections
   * — but it still sees DRIFT (a 2xx whose body is the wrong shape), so it is
   * not dead and must not be deleted on the strength of the short-circuit alone.
   *
   * The 403-vs-422 split is deliberately HOMELESS and stays homeless: 403 is not
   * wrong (all three arms are CALLER-class and breaker-inert) but it is coarse.
   * It needs its own plan; handling the envelope by `ok` makes it a non-issue
   * here either way.
   *
   * ---------------------------------------------------------------------------
   * 140.5-03 / SEAMPROSE-02 — WHY THE `Retry-After` RELAY BELOW IS NOT THE
   * STATUS BRANCH THIS DOCBLOCK FORBIDS. Read this before reverting it.
   *
   * The prohibition above is about BEHAVIOUR SELECTION: no code path here may
   * decide WHAT TO DO by reading `res.status`, because the two `ok`s disagree in
   * both directions and any status-keyed choice is wrong on one of the paths.
   * That contract is untouched. The relay is unconditional on status — a 429, a
   * 403 and a 503 all take the identical path, and the header is copied when the
   * upstream sent one and not otherwise. `res.status` is still used for exactly
   * one thing, the thing it was always used for: forwarding itself.
   *
   * The header is METADATA THIS CONTRACT NEVER GOVERNED. `body` verbatim and
   * `body.ok` as the verdict remain the whole of the semantic story; a wait is
   * not a verdict. Dropping it was not a decision anyone recorded — this arm
   * reconstructed the response from body + status, so every upstream header died
   * here silently. `/process-key` is rate-limited on the Python side (stacked
   * `@limiter.limit` decorators on `process_key.py`'s handler; `main.py`'s
   * `RateLimitExceeded` handler answers 429 with
   * `headers={"Retry-After": str(retry_after)}`), so a Python 429 reached the
   * browser with `retry_after_seconds` in the BODY and no header at all.
   *
   * ⚠️ RELAY, NEVER PARSE. `parseRetryAfterSeconds` (`src/lib/retry/retry-after.ts`)
   * is the ONE parser and it belongs to the READ side, where a hostile or
   * HTTP-date value is resolved against the response's own `Date` header. The
   * body's `retry_after_seconds` field is deliberately NOT consulted here: two
   * extraction paths for one fact is the substring-cascade shape this milestone
   * exists to remove. Copy the string, change nothing about it.
   *
   * ⭐ THIS IS HALF A FIX AND THE OTHER HALF IS IN THE WIZARD STEPS. Every
   * caller passes through this arm (`csv-validate`, `finalize-wizard`,
   * `keys/sync`, `verify-strategy`; `csv-finalize` until Phase 145), so one
   * edit restores the header on all of them — and reaches ZERO user-visible
   * surfaces until each client reads it into its envelope. Neither half is
   * useful alone.
   */
  if (!res.ok) {
    const forwarded = NextResponse.json(body, { status: res.status });
    const advertisedWait = res.headers.get("Retry-After");
    if (advertisedWait !== null) {
      forwarded.headers.set("Retry-After", advertisedWait);
    }
    return {
      ok: false,
      response: forwarded,
    };
  }

  return { ok: true, status: res.status, body };
}
