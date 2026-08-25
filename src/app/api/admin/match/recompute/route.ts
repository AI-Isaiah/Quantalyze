import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isAdminUser } from "@/lib/admin";
import { assertSameOrigin } from "@/lib/csrf";
import {
  AnalyticsTimeoutError,
  AnalyticsUpstreamError,
  recomputeMatch,
} from "@/lib/analytics-client";
import { CircuitOpenError } from "@/lib/seam-errors";
import { CIRCUIT_OPEN_COPY } from "@/lib/seam-copy";
import { adminActionLimiter, checkLimit, rateLimitDenyJson } from "@/lib/ratelimit";
import { NO_STORE_HEADERS } from "@/lib/api/headers";
// 140.3-13a / SEAMUX-08 — the ONE lazy-Sentry helper, applied under the SINGLE
// capture policy written out in full in `src/app/api/admin/match/eval/route.ts`.
// That docblock is the source of truth for all nine seam routes and is
// deliberately NOT duplicated here: two copies of a policy is how two policies
// start. Read it before adding, moving or removing any capture in this file.
import { captureToSentry } from "@/lib/sentry-capture";
// 140.4-08 / SEAMRIM-06 — the CONSOLE half, and it follows the sibling route
// verbatim for the same reason the capture policy does. `captureToSentry`
// scrubs at its own chokepoint; `console.*` has none, so every site standing
// over the caught value wraps it here.
import { scrubSeamError } from "@/lib/seam-redaction";

/**
 * Phase 140 / SEAM-02 — pinned for clarity; asserted against
 * SEAM_ROUTE_BUDGETS by seam-budgets.invariant.test.
 *
 * 300 is the project's VERIFIED effective Vercel default
 * (`defaultResourceConfig.functionDefaultTimeout: 300`, read from the live
 * project settings on 2026-07-25), so declaring it here cannot raise this
 * route's worst-case lambda hold. It exists so the SC-4b headroom invariant
 * has an in-repo source of truth instead of a dashboard-changeable
 * assumption: this route spends one `match-recompute` budget (30s), 10×
 * headroom.
 */
export const maxDuration = 300;

/**
 * The three STATIC bodies this handler may emit on failure.
 *
 * STATIC is the point (threat T-140-11). Until Phase 140 the generic arm
 * echoed `err.message`, which on this seam carries Python contract-drift
 * strings (the multi-line Zod issue list `parseResponse()` throws), FastAPI
 * 5xx `detail`, and the analytics service's base URL. Same defect and same
 * fix as bridge H-1062 (the breaker arm in `src/app/api/bridge/route.ts`) and
 * portfolio-optimizer M-0333 (the ownership-check arm in `src/app/api/portfolio-optimizer/route.ts`);
 * these two admin/match routes were simply never included in those passes.
 * The diagnosable half stays in `console.error`, server-side only.
 *
 * The breaker body is NOT declared here. `CIRCUIT_OPEN_COPY` is imported from
 * `@/lib/seam-copy` — the ONE declaration all ten seam emitters read — so a
 * breaker trip reads identically to a user whichever seam mechanism they happen
 * to hit, and no single route can be reworded out of step with the other nine
 * (SEAMUX-01). It still matches `process-key-client`'s
 * `CIRCUIT_OPEN_HUMAN_MESSAGE` because both are now aliases of that one leaf.
 */
const TIMEOUT_COPY = "Match recompute timed out. Please try again.";
const GENERIC_COPY = "Match recompute failed. Please try again.";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const csrfError = assertSameOrigin(req);
  if (csrfError) return csrfError;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  // ── 140.3-G8 / SEAMUX-03 — a machine `code` on every arm THIS route owns ──
  // A consumer discriminates on a stable token instead of the prose. The gate
  // codes UNAUTHENTICATED / FORBIDDEN and the named-id code MISSING_ALLOCATOR_ID
  // are inline, NOT WizardErrorCode members — an admin arm must never force
  // wizard copy (the keys/sync template ships the same non-union tokens, incl.
  // the MISSING_STRATEGY_ID precedent this MISSING_ALLOCATOR_ID mirrors).
  // MISSING_ALLOCATOR_ID names the named-id-param fact, distinct from
  // VALIDATION_FAILED which this plan set reserves for STRUCTURAL rejections
  // (the unparseable-JSON arm). ⚠️ The gate arms carry ONLY the auth verdict —
  // no seam state — because they precede any breaker-aware branch (T-140-12).
  //
  // P444 (audit-2026-05-07) — RFC 7235: 401 unauthenticated, 403 forbidden.
  if (!user) {
    return NextResponse.json({ error: "Unauthorized", code: "UNAUTHENTICATED" }, { status: 401, headers: NO_STORE_HEADERS });
  }
  if (!(await isAdminUser(supabase, user))) {
    return NextResponse.json({ error: "Forbidden", code: "FORBIDDEN" }, { status: 403, headers: NO_STORE_HEADERS });
  }

  let body: { allocator_id?: string; force?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body", code: "VALIDATION_FAILED" }, { status: 400, headers: NO_STORE_HEADERS });
  }

  if (!body.allocator_id || typeof body.allocator_id !== "string") {
    return NextResponse.json({ error: "allocator_id is required", code: "MISSING_ALLOCATOR_ID" }, { status: 400, headers: NO_STORE_HEADERS });
  }

  // B15b (audit-2026-05-07): rate-limit AFTER validating allocator_id so an
  // invalid body never consumes one of the admin's tokens.
  const rl = await checkLimit(adminActionLimiter, `match-recompute:${user!.id}`);
  if (!rl.success) {
    // 140.4-13 / SEAMRIM-05 — the ADMIN auth shape. The 503-vs-429 decision is
    // the chokepoint's; this route keeps only NO_STORE_HEADERS.
    //
    // 140.3-G8 / SEAMUX-03 — the builder's default deny bodies are CODELESS
    // (ratelimit.ts), so both are overridden to carry a machine `code` while
    // the builder-default SENTENCES stay BYTE-KEPT (keys/sync template). The
    // builder still decides 429-vs-503; the code names which the caller got.
    // RATE_LIMITED is OUR limiter's token (not KEY_RATE_LIMIT, the exchange
    // family); SEAM_MISCONFIGURED is the limiter-unavailable token.
    return rateLimitDenyJson(rl, {
      headers: NO_STORE_HEADERS,
      throttledBody: { error: "Too many requests", code: "RATE_LIMITED" },
      misconfiguredBody: {
        error: "Rate limiter unavailable",
        code: "SEAM_MISCONFIGURED",
      },
    });
  }

  try {
    // C-PR5-01 (audit-2026-05-07): forward the authenticated admin's
    // user.id as actor_id so analytics-service can assert the actor is
    // entitled to recompute this allocator. Defense-in-depth against a
    // future Next.js route that drops the admin gate above.
    const result = await recomputeMatch(
      body.allocator_id,
      body.force ?? false,
      user.id,
    );
    return NextResponse.json(result, { headers: NO_STORE_HEADERS });
  } catch (err) {
    // Phase 140 / SEAM-04 — typed arms BEFORE the generic one.
    //
    // ⚠️ These live INSIDE the handler, after the admin gate above, and must
    // stay there (threat T-140-12). Hoisting any breaker-aware branch above
    // the gate would turn "is Railway degraded right now?" into an
    // unauthenticated oracle. Pinned by the unauthenticated+open-breaker case
    // in route.test.ts and route.seam.test.ts.
    //
    // `CircuitOpenError` is imported from the dependency-free leaf
    // `@/lib/seam-errors`, never through `@/lib/analytics-client`: this
    // route's tests mock that module, and a class picked up through a mocked
    // module is `undefined` — `err instanceof undefined` throws `TypeError`
    // from inside this very catch block (threat T-140-30).
    if (err instanceof CircuitOpenError) {
      console.error(
        `[api/admin/match/recompute] circuit open — short-circuited, retry in ${err.retryAfterS}s`,
      );
      return NextResponse.json(
        { error: CIRCUIT_OPEN_COPY, code: "CIRCUIT_OPEN" },
        {
          status: 503,
          headers: {
            ...NO_STORE_HEADERS,
            // Same pairing as rateLimitDenyJson (in `src/lib/ratelimit.ts`).
            "Retry-After": String(err.retryAfterS),
          },
        },
      );
    }
    // A timed-out Python round-trip is a gateway timeout, not a server fault.
    if (err instanceof AnalyticsTimeoutError) {
      console.error(
        "[api/admin/match/recompute] upstream timeout:",
        scrubSeamError(err),
      );
      return NextResponse.json(
        { error: TIMEOUT_COPY, code: "UPSTREAM_TIMEOUT" },
        { status: 504, headers: NO_STORE_HEADERS },
      );
    }
    // 140.3-11 / TS-19 — an upstream 4xx SURVIVES this route.
    //
    // Until this arm existed the catch block branched on exactly two types, so
    // every other upstream status became the unconditional 500 below. That is
    // two losses at once: the status is gone, and a refusal the service issued
    // deliberately and immediately is reported to an admin as OUR fault, with
    // "Please try again" attached to a request that will be refused
    // identically. `analytics-service/routers/match.py` raises 400, 403, 422
    // and 429 on this endpoint, so it was the common case, not a corner.
    //
    // THE RANGE SPLIT IS THE POINT, and it is copied from
    // the 4xx-forward arm in `src/app/api/simulator/route.ts` rather than invented. Only 4xx
    // forwards. A 4xx `detail` is operator-curated copy. A 5xx `message`
    // carries the FastAPI detail, the `parseResponse()` contract-drift string
    // and this service's base URL — precisely what the STATIC-bodies docblock
    // at the top of this file exists to keep off the wire (T-140-11) — so a
    // 5xx keeps falling through to the static arm below.
    //
    // ⚠️ 161-08 / WIZERR-06 — "only 4xx forwards" is about the MESSAGE, and
    // only the message. Since WIZERR-06 the terminal arm below forwards the
    // upstream's `seamCode` too, so `code` now crosses on BOTH sides of 500
    // while `error` still crosses on the 4xx side alone. Reading this paragraph
    // as "a 5xx discloses nothing" would be wrong in one direction and reading
    // it as "the message restriction was relaxed" wrong in the other.
    //
    // The status only. No header rides along: `AnalyticsUpstreamError` carries
    // none, so a forwarded upstream 429 reaches the client WITHOUT its
    // `Retry-After`. Inventing one here would name a wait no upstream stated.
    // (`create-with-key`'s conditional-headers shape applies to the breaker
    // arm above, which already uses it.)
    if (
      err instanceof AnalyticsUpstreamError &&
      err.status >= 400 &&
      err.status < 500
    ) {
      // Status and machine code only — never the message, which is already
      // going to the client and would double the disclosure surface in the log.
      //
      // ⚠️ Both reads go through the leaf even though both are safe values —
      // the reasoning is written out once, at the sibling site in
      // `src/app/api/admin/match/eval/route.ts`, and is not duplicated here.
      console.error(
        `[api/admin/match/recompute] upstream ${scrubSeamError(err.status)} ` +
          `(${scrubSeamError(err.seamCode ?? "no code")})`,
      );
      // 140.3-11 / TS-18 — `dependency` rides along so a 424 can be rendered as
      // the CALLER'S venue failing rather than as our outage. It is `null` on
      // every other 4xx and on the flat 424 shape, and a consumer that sees
      // `null` must say "a venue failed" without naming one.
      //
      // 140.3-G8 / SEAMUX-03 — `code` carries the UPSTREAM'S OWN machine token
      // (`AnalyticsUpstreamError.seamCode`, the Python code TS-19 preserved),
      // `?? "UNKNOWN"` when the body carried none. `error` and `dependency`
      // BYTE-UNCHANGED beside it.
      return NextResponse.json(
        { error: err.message, dependency: err.dependency, code: err.seamCode ?? "UNKNOWN" },
        { status: err.status, headers: NO_STORE_HEADERS },
      );
    }
    // 140.3-13a / SEAMUX-08 — THE TERMINAL ARM, and the only capture in this
    // route, under the policy in `admin/match/eval/route.ts`. The breaker,
    // timeout and forwarded-4xx arms above deliberately capture NOTHING: each
    // is an expected, self-describing condition, and a breaker trip in
    // particular fires on every request to every seam route at once.
    //
    // Delivered in the SAME commit as the sibling route's, and asserted per
    // file: these two have the same shape and had the same gap (each read 0
    // `captureToSentry` on the untouched tree), and fixing one while reporting
    // the class closed is this programme's signature failure — the same reason
    // `140.3-11` gave when it added the 4xx arm to both.
    //
    // Value passed UNMODIFIED; `captureToSentry` scrubs at the chokepoint. No
    // per-request credential exists on this route, so `secrets` is empty.
    captureToSentry(err, {
      tags: { surface: "admin-match-recompute", step: "upstream-error" },
    });
    console.error(
      "[api/admin/match/recompute] error:",
      scrubSeamError(err),
    );
    // 161-08 / WIZERR-06 — THE CODE CROSSES; THE MESSAGE STILL DOES NOT.
    //
    // `GENERIC_COPY` is untouched and stays untouched: on a 5xx the upstream
    // `message` carries FastAPI detail, the `parseResponse()` contract-drift
    // string and this service's base URL (the STATIC-bodies rule restated at
    // the sibling `admin/match/eval` route). ONLY `code` moves — the same
    // machine token the 4xx arm above already forwards, from the seam's own
    // closed vocabulary.
    //
    // ⛔ `typeof`, NOT `instanceof AnalyticsUpstreamError`: this arm is also
    // reached by transport failures and untyped throws, and a route suite that
    // mocks `@/lib/analytics-client` wholesale makes the class `undefined`,
    // where `x instanceof undefined` throws from inside this very catch. The
    // empty string is excluded because `"" ?? "UNKNOWN"` is `""`.
    const rawSeamCode = (err as { seamCode?: unknown } | null | undefined)
      ?.seamCode;
    const seamCode =
      typeof rawSeamCode === "string" && rawSeamCode !== "" ? rawSeamCode : null;
    return NextResponse.json(
      { error: GENERIC_COPY, code: seamCode ?? "UNKNOWN" },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}
