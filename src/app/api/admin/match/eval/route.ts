import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isAdminUser } from "@/lib/admin";
import {
  AnalyticsTimeoutError,
  AnalyticsUpstreamError,
  evalMatch,
} from "@/lib/analytics-client";
import { CircuitOpenError } from "@/lib/seam-errors";
import { CIRCUIT_OPEN_COPY } from "@/lib/seam-copy";
import { assertSameOrigin } from "@/lib/csrf";
import { NO_STORE_HEADERS } from "@/lib/api/headers";
// 140.3-13a / SEAMUX-08 — the ONE lazy-Sentry helper. Scrubbing is folded INTO
// it (SEAMCORE-06), so the caught value is passed UNMODIFIED: pre-scrubbing
// here would hand Sentry a string instead of an Error and destroy its grouping
// and stack, while re-creating the per-caller convention the chokepoint exists
// to replace. See the CAPTURE POLICY docblock below.
import { captureToSentry } from "@/lib/sentry-capture";
// 140.4-08 / SEAMRIM-06 — the CONSOLE half of the same rule. `captureToSentry`
// scrubs at its own chokepoint (above); `console.*` has no chokepoint, so every
// site standing over the caught value wraps it here. The two are not
// alternatives: the Sentry call keeps the Error instance for grouping, the log
// keeps a scrubbed rendering, and undici's header-inlining is covered on both.
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
 * assumption: this route spends one `match-eval` budget (30s), 10× headroom.
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
const TIMEOUT_COPY = "Match evaluation timed out. Please try again.";
const GENERIC_COPY = "Match evaluation failed. Please try again.";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * 140.3-13a / SEAMUX-08 — THE CAPTURE POLICY. ONE RULE, ALL NINE ROUTES.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Nine of the fifteen seam routes captured NOTHING to Sentry, while
 * `wizardErrors.ts` copy told users "our team has been notified". `140.3-12`
 * removed the claim; this is where it becomes true. `140.3-13a` owns four of
 * the nine (this route, `admin/match/recompute`, `keys/[id]/permissions`,
 * `verify-strategy`); `140.3-13b` owns the other five and applies THIS RULE
 * VERBATIM. Two halves inventing two policies is the drift this split exists
 * to prevent, so it is written down once, here, and cited from the others.
 *
 * THE RULE:
 *
 *   Capture from a seam route's TERMINAL, UNCLASSIFIED error arm — the arm
 *   reached when the caught value matched no typed branch — and from any arm
 *   that detects an UPSTREAM CONTRACT VIOLATION (a 2xx whose body cannot be
 *   used). Capture from NOTHING ELSE: not a breaker short-circuit
 *   (`CircuitOpenError`), not an upstream timeout (`AnalyticsTimeoutError`),
 *   not a forwarded upstream 4xx, and not a CSRF / auth / rate-limit /
 *   validation rejection the route makes itself. Pass the caught value
 *   UNMODIFIED to `captureToSentry`, with `tags: { surface, step }` and a
 *   `secrets: [...]` array naming every per-request credential in scope.
 *
 * WHY THE TERMINAL ARM AND ONLY THE TERMINAL ARM. Every typed branch above it
 * is a condition we already understand, already count and already answer with
 * a specific status. The terminal arm is by construction the one that means
 * "we do not know what this is" — which is exactly what a human needs to look
 * at. This also makes the rule mechanical rather than a judgement call, which
 * is what lets a second plan apply it to five more routes without
 * reinterpretation.
 *
 * ⚠️ WHY A BREAKER TRIP IS NEVER CAPTURED. A trip is an expected
 * infrastructure fact, and during the exact correlated incident Sentry exists
 * to surface, EVERY request to EVERY seam route short-circuits. Capturing them
 * would emit one issue per short-circuited request across all fifteen routes
 * at once — burying the one signal that identifies the cause under thousands
 * of copies of its symptom. The breaker's own state is the correct alerting
 * source for a trip; this is not it.
 *
 * ⚠️ WHY A TIMEOUT IS NEVER CAPTURED. `wizardErrors.ts` documents 60-second
 * Railway cold starts as normal, so `AnalyticsTimeoutError` is an expected
 * outcome of a healthy system under a cold start, and a sustained one trips the
 * breaker — which then takes over. It is already answered with a specific 504.
 *
 * ⚠️ WHY A FORWARDED 4xx IS NEVER CAPTURED. `140.3-11` gave this route an
 * `AnalyticsUpstreamError` 4xx arm precisely so a deliberate upstream refusal
 * survives with its own status. A refusal the service issued on purpose is not
 * our defect; capturing it would alert on correct behaviour. A 5xx keeps
 * falling through to the terminal arm below and IS captured, which is the
 * "service-permanent outcome" half of the rule.
 *
 * ⚠️ WHY THE VALUE IS PASSED UNMODIFIED. `captureToSentry` scrubs at the
 * chokepoint (`src/lib/sentry-capture.ts`, SEAMCORE-06) because ten sites each
 * remembering to scrub is the instance-not-class shape this programme has
 * already paid for. Calling `scrubSeamError(err)` here first would (a) double
 * scrub, (b) hand Sentry a STRING, losing Error grouping and the stack, and
 * (c) restore the per-caller convention the chokepoint replaced. TRAP-1's
 * over-redaction half matters as much as its under-redaction half, and both
 * are asserted end-to-end in this route's tests through the REAL helper.
 * ═══════════════════════════════════════════════════════════════════════════
 */

// Audit-2026-05-07 C-0041: same-origin guard runs before auth so a
// cross-origin probe with a replayed session cookie hits the CSRF wall
// before any DB/RPC work. Sibling /api/admin/match/{decisions,kill-switch,
// send-intro,recompute} POST/DELETE handlers follow the same pattern.
export async function GET(req: NextRequest): Promise<NextResponse> {
  const csrfError = assertSameOrigin(req);
  if (csrfError) return csrfError;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  // P444 (audit-2026-05-07) — RFC 7235: 401 unauthenticated, 403 forbidden.
  // ── 140.3-G8 / SEAMUX-03 — a machine `code` on every arm THIS route owns ──
  // A consumer discriminates on a stable token instead of sniffing the prose
  // (140.3-12's to reword). UNAUTHENTICATED / FORBIDDEN are inline gate codes,
  // NOT WizardErrorCode members: admin-only arms must never force wizard copy
  // (the keys/sync template ships the same non-union tokens). ⚠️ These two gate
  // arms carry ONLY the auth verdict — no seam state — because they run BEFORE
  // any breaker-aware branch (threat T-140-12): a code naming Railway health
  // here would be an unauthenticated oracle.
  if (!user) {
    return NextResponse.json({ error: "Unauthorized", code: "UNAUTHENTICATED" }, { status: 401, headers: NO_STORE_HEADERS });
  }
  if (!(await isAdminUser(supabase, user))) {
    return NextResponse.json({ error: "Forbidden", code: "FORBIDDEN" }, { status: 403, headers: NO_STORE_HEADERS });
  }

  const url = new URL(req.url);
  const lookback = url.searchParams.get("lookback_days") || "28";
  const partnerTag = url.searchParams.get("partner_tag") ?? undefined;

  try {
    const data = await evalMatch(
      {
        lookback_days: lookback,
        partner_tag: partnerTag,
      },
      // TS-04 / SC7 — INERT today (/api/match/eval has no Python limiter at
      // all, TS-21), but threaded anyway: leaving the one wrapper without an
      // identity is what would have let `tenantId` stay optional.
      { userId: user.id },
    );
    return NextResponse.json(data, { headers: NO_STORE_HEADERS });
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
        `[api/admin/match/eval] circuit open — short-circuited, retry in ${err.retryAfterS}s`,
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
        "[api/admin/match/eval] upstream timeout:",
        scrubSeamError(err),
      );
      return NextResponse.json(
        { error: TIMEOUT_COPY, code: "UPSTREAM_TIMEOUT" },
        { status: 504, headers: NO_STORE_HEADERS },
      );
    }
    // 140.3-11 / TS-19 — an upstream 4xx SURVIVES this route.
    //
    // The same arm as `src/app/api/admin/match/recompute/route.ts`, delivered
    // here in the SAME commit. These two files have the same shape and had the
    // same gap (`AnalyticsUpstreamError` appeared 0 times in each before this
    // plan); fixing one and reporting the class closed is this programme's
    // signature failure, so both counts are asserted per file.
    //
    // THE RANGE SPLIT IS THE POINT, copied from
    // the 4xx-forward arm in `src/app/api/simulator/route.ts` rather than invented. Only 4xx
    // forwards: a 4xx `detail` is operator-curated copy, while a 5xx `message`
    // carries the FastAPI detail, the `parseResponse()` contract-drift string
    // and this service's base URL — what the STATIC-bodies docblock above
    // exists to keep off the wire (T-140-11). A 5xx keeps falling through to
    // the static arm below.
    //
    // The status only. No header rides along: `AnalyticsUpstreamError` carries
    // none, so a forwarded upstream 429 reaches the client WITHOUT its
    // `Retry-After`, and inventing one would name a wait no upstream stated.
    if (
      err instanceof AnalyticsUpstreamError &&
      err.status >= 400 &&
      err.status < 500
    ) {
      // Status and machine code only — never the message, which is already
      // going to the client and would double the disclosure surface in the log.
      //
      // ⚠️ BOTH READS GO THROUGH THE LEAF EVEN THOUGH BOTH ARE SAFE VALUES, and
      // the reason is the guard, not the value. `status` is a `number` and
      // `seamCode` a machine code from a closed set (`AnalyticsUpstreamError` in `analytics-client.ts`),
      // so the scrub is a rendering no-op on each — but the source guard
      // (`seam-log-coverage.test.ts`) cannot know a type, and its allowlist is
      // `retryAfterS` / `deadlineExceeded` / `code` only. The two other ways to
      // clear it here are both worse: passing `scrubSeamError(err)` would put
      // `err.message` — the thing this comment exists to keep OUT of the log —
      // back in, and binding the reads to non-error-shaped locals would hide
      // them behind the one-hop alias hole that plan 140.4-09 exists to close.
      console.error(
        `[api/admin/match/eval] upstream ${scrubSeamError(err.status)} ` +
          `(${scrubSeamError(err.seamCode ?? "no code")})`,
      );
      // 140.3-11 / TS-18 — `dependency` rides along so a 424 can be rendered as
      // the CALLER'S venue failing rather than as our outage. It is `null` on
      // every other 4xx and on the flat 424 shape, and a consumer that sees
      // `null` must say "a venue failed" without naming one.
      //
      // 140.3-G8 / SEAMUX-03 — `code` carries the UPSTREAM'S OWN machine token,
      // completing the thread TS-19 started: `AnalyticsUpstreamError.seamCode`
      // holds the Python code (e.g. the flat-424 venue-transient codes) for
      // exactly this read. `?? "UNKNOWN"` when the upstream body carried none.
      // `error` and `dependency` are BYTE-UNCHANGED beside it (TS-18/TS-19).
      return NextResponse.json(
        { error: err.message, dependency: err.dependency, code: err.seamCode ?? "UNKNOWN" },
        { status: err.status, headers: NO_STORE_HEADERS },
      );
    }
    // 140.3-13a / SEAMUX-08 — THE TERMINAL ARM, and the only capture in this
    // route. Everything above is a condition we already classified; this is the
    // one that means "we do not know what this is", so it is the one a human
    // must see. Reached by a transport failure (ECONNREFUSED / ENOTFOUND /
    // TLS), an upstream 5xx, a `parseResponse()` contract-drift throw, and any
    // untyped throw from the client.
    //
    // The value is passed UNMODIFIED — `captureToSentry` scrubs at the
    // chokepoint. This route holds NO per-request credential: it forwards no
    // user JWT and touches no exchange material, so `secrets` is the empty
    // list and the env-name list in `seam-redaction.ts` is the whole defence.
    // (`verify-strategy` is the contrast — it names three.)
    captureToSentry(err, {
      tags: { surface: "admin-match-eval", step: "upstream-error" },
      extra: { lookback_days: lookback },
    });
    console.error(
      "[api/admin/match/eval] upstream error:",
      scrubSeamError(err),
    );
    return NextResponse.json(
      { error: GENERIC_COPY, code: "UNKNOWN" },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}
