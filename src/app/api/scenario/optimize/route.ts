import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { assertSameOrigin } from "@/lib/csrf";
import { assertProfileApproved } from "@/lib/api/approval-gate";
import {
  optimizeScenarioWeights,
  AnalyticsTimeoutError,
  AnalyticsUpstreamError,
} from "@/lib/analytics-client";
import { CircuitOpenError } from "@/lib/seam-errors";
import { CIRCUIT_OPEN_COPY } from "@/lib/seam-copy";
import { userActionLimiter, checkLimit, rateLimitDenyJson } from "@/lib/ratelimit";
import { NO_STORE_HEADERS } from "@/lib/api/headers";
// 140.3-13b / SEAMUX-08 — the ONE lazy-Sentry helper, applied under the SINGLE
// capture policy written out IN FULL in `src/app/api/admin/match/eval/route.ts`
// by `140.3-13a`. It is cited, never restated: two copies of a policy is how two
// policies start. The caught value is passed UNMODIFIED — `captureToSentry`
// scrubs at the chokepoint (SEAMCORE-06), and pre-scrubbing here would hand
// Sentry a string instead of an Error, destroying grouping and the stack.
//
// PER-REQUEST SECRETS AT THIS ROUTE: none. The body carries only draft-scoped
// daily-return series and an objective enum — no credential, no user JWT, no
// exchange material — so `secrets` is omitted and `seam-redaction.ts`'s env-name
// list is the whole defence. Stated rather than assumed, because M78b showed the
// env mechanism staying green while a per-request credential shipped verbatim.
import { captureToSentry } from "@/lib/sentry-capture";
// 140.4-08 / SEAMRIM-06 — the CONSOLE half of the same rule, and the reason it
// is a SEPARATE import rather than a redundant one: `captureToSentry` scrubs at
// its own chokepoint, `console.*` has none. The `secrets` reasoning above
// carries over unchanged — no per-request credential exists here, so no second
// argument is passed at either site.
import { scrubSeamError } from "@/lib/seam-redaction";

/**
 * Phase 28 (OPT-01/02) — suggest long-only scenario weights.
 *
 * STATELESS: the body carries the draft-scoped strategies' own daily-return
 * series (already in the allocator's browser); we forward them to the Python
 * optimizer and return the suggested weights. No DB read, no cross-tenant
 * surface — the only gate is "a logged-in, approved user" (so the CPU endpoint
 * isn't open to anonymous abuse) plus a per-user rate limit and payload caps.
 * The suggested weights write to the editable DRAFT client-side only; this route
 * never persists anything.
 */

// Defensive payload caps (the composer caps strategy count far lower; these
// bound a hand-crafted request so it can't hand the optimizer an unbounded job).
const MAX_STRATEGIES = 50;
const MAX_POINTS_PER_SERIES = 6000; // ~24 years of trading days
const OBJECTIVES = new Set(["min_vol", "max_sharpe"]);

/**
 * Phase 140 / SEAM-02 — pinned for clarity; declared counterpart of this
 * route's `SEAM_ROUTE_BUDGETS` row in `src/lib/resilient-fetch.ts`.
 *
 * 300 is the project's VERIFIED effective Vercel default
 * (`defaultResourceConfig.functionDefaultTimeout: 300`, read from the live
 * project settings on 2026-07-25), so declaring it here cannot RAISE this
 * route's worst-case lambda hold (threat T-140-29). It exists so the SC-4b
 * headroom invariant has an in-repo source of truth instead of a
 * dashboard-changeable assumption: this route spends one `optimize-weights`
 * budget (30s), i.e. 10× headroom.
 */
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const csrfError = assertSameOrigin(req);
  if (csrfError) return csrfError;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: NO_STORE_HEADERS },
    );
  }

  const denied = await assertProfileApproved(supabase, user.id);
  if (denied) return denied;

  let body: {
    series?: Record<string, Array<{ date?: unknown; value?: unknown }>>;
    objective?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  const objective = body.objective ?? "min_vol";
  if (typeof objective !== "string" || !OBJECTIVES.has(objective)) {
    return NextResponse.json(
      { error: "objective must be 'min_vol' or 'max_sharpe'" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  const series = body.series;
  if (series === null || typeof series !== "object" || Array.isArray(series)) {
    return NextResponse.json(
      { error: "series must be an object of { strategyId: [{date, value}] }" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }
  const ids = Object.keys(series);
  if (ids.length === 0 || ids.length > MAX_STRATEGIES) {
    return NextResponse.json(
      { error: `series must contain 1..${MAX_STRATEGIES} strategies` },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }
  // Validate + normalize each point at the trust boundary — a non-finite value
  // or a wrong shape must be a 400 here, never silently forwarded to the solver.
  const clean: Record<string, Array<{ date: string; value: number }>> = {};
  for (const id of ids) {
    const pts = series[id];
    if (!Array.isArray(pts) || pts.length > MAX_POINTS_PER_SERIES) {
      return NextResponse.json(
        { error: `series['${id}'] must be an array of <= ${MAX_POINTS_PER_SERIES} points` },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }
    const normalized: Array<{ date: string; value: number }> = [];
    for (const p of pts) {
      if (
        p === null ||
        typeof p !== "object" ||
        typeof p.date !== "string" ||
        typeof p.value !== "number" ||
        !Number.isFinite(p.value)
      ) {
        return NextResponse.json(
          { error: `series['${id}'] has a malformed point (need { date: string, value: finite number })` },
          { status: 400, headers: NO_STORE_HEADERS },
        );
      }
      normalized.push({ date: p.date, value: p.value });
    }
    clean[id] = normalized;
  }

  // Limiter AFTER validation (B15 ordering) so a malformed request doesn't burn
  // one of the caller's own tokens.
  const rl = await checkLimit(userActionLimiter, `scenario-optimize:${user.id}`);
  if (!rl.success) {
    // 140.4-13 / SEAMRIM-05 — deny through the chokepoint so a limiter
    // misconfiguration answers 503.
    //
    // ⚠️ `retryAfterHeader: "misconfigured-only"` IS NOT A STYLE CHOICE. This is
    // the ONE seam route whose 429 carries no `Retry-After` today, and the
    // measured contract is what this plan must preserve — its brief is the
    // 503 SPLIT, not a header audit. The 503 still carries one, because the
    // canary that the fail-CLOSED status exists to reach needs to know when to
    // look again. Adding `Retry-After` to the 429 is a defensible improvement
    // and it belongs to whoever owns this route's response contract.
    return rateLimitDenyJson(rl, {
      headers: NO_STORE_HEADERS,
      retryAfterHeader: "misconfigured-only",
      throttledBody: { error: "Too many optimize requests. Try again shortly." },
    });
  }

  try {
    // TS-04 / SC7 — the sharpest flip: /api/optimize-weights is 20/minute, a
    // PLATFORM ceiling until this claim appeared, so two allocators running
    // Scenario Composer could 429 each other. `user.id` is the server session's.
    const result = await optimizeScenarioWeights(clean, objective as "min_vol" | "max_sharpe", { userId: user.id });
    return NextResponse.json(result, { headers: NO_STORE_HEADERS });
  } catch (err) {
    // Phase 140 / SEAM-04 — the breaker arm, FIRST among the typed arms.
    //
    // An open circuit means no request was issued: 503 + a cooldown, not the
    // generic 500 this used to fall through to (which invites an immediate
    // retry against a service already known to be down).
    //
    // ⚠️ Placement: INSIDE the handler, after the 401 + approval gates above
    // (threat T-140-20) — hoisting a breaker-aware branch above them would turn
    // "is Railway degraded right now?" into an unauthenticated oracle.
    //
    // ⚠️ `CircuitOpenError` comes from the dependency-free leaf
    // `@/lib/seam-errors`, never through `@/lib/analytics-client`: this route's
    // test mocks that module wholesale, and a class read through a mocked
    // module is `undefined` — `err instanceof undefined` throws a TypeError
    // from inside this very catch block (threat T-140-30).
    if (err instanceof CircuitOpenError) {
      console.error(
        `[scenario/optimize] circuit open — short-circuited, retry in ${err.retryAfterS}s`,
      );
      return NextResponse.json(
        { error: CIRCUIT_OPEN_COPY },
        {
          status: 503,
          headers: {
            ...NO_STORE_HEADERS,
            "Retry-After": String(err.retryAfterS),
          },
        },
      );
    }
    if (err instanceof AnalyticsTimeoutError) {
      return NextResponse.json(
        { error: "The optimizer timed out. Try again shortly." },
        { status: 504, headers: NO_STORE_HEADERS },
      );
    }
    if (err instanceof AnalyticsUpstreamError) {
      // Never echo the raw upstream detail (schema/internal leak) — log it, return a clean message.
      //
      // ⚠️ `err.status` is a `number` we set (`analytics-client.ts:66`), so the
      // leaf is a rendering no-op on it. It goes through anyway because the
      // source guard cannot know a type and its safe-property allowlist is
      // `retryAfterS` / `deadlineExceeded` / `code` only — and the alternatives
      // are worse: `scrubSeamError(err)` would put the raw upstream detail this
      // very comment excludes back into the line, and binding it to a
      // non-error-shaped local would hide the read behind the one-hop alias
      // hole plan 140.4-09 exists to close. Same call as the sibling sites in
      // `src/app/api/admin/match/eval/route.ts`.
      console.error("[scenario/optimize] upstream error", {
        status: scrubSeamError(err.status),
      });
      // ⚠️ 140.3-13b / SEAMUX-08 — AMBIGUITY-1 IN THE INHERITED POLICY, and the
      // reading chosen, recorded here rather than resolved silently.
      //
      // The policy's exclusion list names "a forwarded upstream 4xx" and its
      // inclusion list names the terminal arm plus contract violations. At
      // `admin/match/eval` those two halves are separated by a RANGE SPLIT in
      // the arm itself: only 4xx is answered there, and a 5xx keeps falling
      // through to the terminal arm — which is why `140.3-13a` could write
      // "a 5xx ... IS captured — that is the policy's service-permanent outcome
      // half". THIS ROUTE HAS NO RANGE SPLIT: every `AnalyticsUpstreamError`,
      // 4xx or 5xx, is answered here with a flat 502, so a literal
      // terminal-arm-only reading would leave an upstream 5xx unreported at
      // this route while the identical failure IS reported at `eval`. That
      // asymmetry would be an accident of arm shape, not a decision.
      //
      // READING CHOSEN: apply the policy's own STATUS discrimination — the half
      // it argues explicitly — rather than the file shape it happened to be
      // written against. 5xx is captured; 4xx is not. Nothing about this
      // route's status, body or headers changes, and the 4xx exclusion is
      // pinned by a positive-status case so it cannot go vacuous.
      //
      // NOT DONE HERE: adding the range split to the RESPONSE (so a deliberate
      // upstream refusal survives with its own status, as `140.3-11` gave the
      // admin/match pair). That is a response-shape change, TS-34's family, and
      // is deliberately not smuggled into an observability plan.
      if (err.status >= 500) {
        captureToSentry(err, {
          tags: { surface: "scenario-optimize", step: "upstream-5xx" },
          extra: { upstream_status: err.status, objective, series_count: ids.length },
        });
      }
      return NextResponse.json(
        { error: "The optimizer is unavailable right now." },
        { status: 502, headers: NO_STORE_HEADERS },
      );
    }
    // 140.3-13b / SEAMUX-08 — THE TERMINAL ARM. Everything above is a condition
    // this route already classified and already answers with its own status;
    // this is the one that means "we do not know what this is", so it is the one
    // a human must see. Reached by a transport failure (ECONNREFUSED /
    // ENOTFOUND / TLS), a `parseResponse()` contract-drift throw, and any untyped
    // throw from the client.
    captureToSentry(err, {
      tags: { surface: "scenario-optimize", step: "unexpected-error" },
      extra: { objective, series_count: ids.length },
    });
    console.error("[scenario/optimize] unexpected error", scrubSeamError(err));
    return NextResponse.json(
      { error: "Could not compute suggested weights." },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}
