import { NextRequest, NextResponse, after } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { withAuth } from "@/lib/api/withAuth";
import { NO_STORE_HEADERS } from "@/lib/api/headers";
import { userActionLimiter, checkLimit, isRateLimitMisconfigured } from "@/lib/ratelimit";
import { STRATEGY_NAMES, canonicalizeExchangeList } from "@/lib/constants";
import {
  MAGNITUDE_CAPS,
  isCryptoExchange,
  venueSupportsScopeProbe,
} from "@/lib/closed-sets";
import { isValidDollar } from "@/lib/dollar-validation";
import {
  OWN_CAPITAL,
  TEAM_REVIEW,
  isCapitalOwnership,
  type CapitalOwnership,
} from "@/lib/capital-ownership";
import { notifyFounderNewStrategy, resolveManagerName } from "@/lib/email";
import { isUuid } from "@/lib/utils";
import { postProcessKey } from "@/lib/process-key-client";
import { resilientFetch } from "@/lib/resilient-fetch";
import { CircuitOpenError } from "@/lib/seam-errors";
import { CIRCUIT_OPEN_COPY } from "@/lib/seam-copy";
import { captureToSentry } from "@/lib/sentry-capture";
import { scrubSeamError, scrubSeamString } from "@/lib/seam-redaction";
import { logAuditEventAsUser } from "@/lib/audit";
// Phase 140.1.1 / PYAPIFIX-01 — the onboard-reply narrow lives in a
// dependency-free leaf so the cross-process parity test can exercise THIS
// predicate with zero mocks. Do not re-inline it here.
// (The `ProcessKeyOnboardResponse` type is exported alongside it and is
// applied here implicitly, by the predicate's `body is` narrowing — importing
// the name explicitly would be an unused binding.)
import { isProcessKeyOnboardResponse } from "@/lib/process-key-onboard-contract";
// 140.3-03 / SEAMUX-07 — the publish gate's contract. ONE schema, shared with
// the sibling route that reads the same upstream body.
import {
  LivePermissionsSchema,
  type LivePermissions,
} from "@/lib/analytics-schemas";
import type { User } from "@supabase/supabase-js";

/**
 * POST /api/strategies/finalize-wizard — wizard SubmitStep endpoint.
 * Validates metadata, re-checks the strategy's exchange-key scopes
 * against the live exchange (force-refreshing both cache layers),
 * calls the SECURITY DEFINER `finalize_wizard_strategy` RPC to
 * promote the draft to `pending_review`, and kicks off the admin
 * notification email via `after()`. Migration 031's guard trigger
 * enforces that the RPC is the only promotion path for wizard
 * drafts.
 *
 * Phase 19 / Open Question 1
 * --------------------------
 * The force-refresh permissions probe (fetchLivePermissions below) is
 * RETAINED at the thin-adapter layer when the unified backbone path is
 * active. The probe runs BEFORE delegating to /process-key so the
 * scope-broadening defense is preserved end-to-end. Pushing the probe
 * into IngestionAdapter.validate would lose the strategies.api_key_id
 * lookup that resolves which key to probe.
 *
 * Scope-broadening defense
 * ------------------------
 * A user can connect a read-only key (which passes
 * /api/keys/validate-and-encrypt), then broaden the same key to
 * trade/withdraw on the exchange dashboard, then click Submit — the
 * /api/keys/[id]/permissions cache (60s on the Next layer + 15min on
 * the Python layer) would otherwise mask that broadening. Before
 * calling the finalize RPC we issue a force-refresh probe that
 * bypasses both caches; if the live response shows trade=true or
 * withdraw=true we abort with 403 + KEY_SCOPE_BROADENED so the wizard
 * surfaces the correct re-key copy.
 */

const STRATEGY_NAME_SET = new Set(STRATEGY_NAMES as readonly string[]);

/**
 * Vercel function ceiling for this route. Declared rather than inherited so the
 * SC-4 headroom invariant has an in-repo source of truth: the seam-budget
 * invariant test reads this export from disk and fails if it drifts from
 * `SEAM_ROUTE_BUDGETS`.
 *
 * ⚠️ WHICH BUDGETS THIS ROUTE SPENDS DEPENDS ON THE BRANCH, and this comment
 * used to name only one of them ("TWO budgets — the keys-permissions probe,
 * then the process-key enqueue"), which is the SINGLE-KEY path. The composite
 * path spends `keys-permissions` once PER MEMBER, up to
 * `MAX_COMPOSITE_MEMBERS`, and no enqueue at all — it returns through
 * `runLegacyFinalize`, whose stitch_composite enqueue is a Supabase RPC. That
 * branch is the one that can reach this ceiling, and the budget row now models
 * both (plan 140.2-10 / A-29).
 *
 * The value matches the platform default verified against the live project
 * settings in 140-01, so pinning it raises nothing.
 */
export const maxDuration = 300;

/**
 * SEAMCORE-10 (A-06 / A-29) — the hard bound on the composite member fan-out.
 *
 * WHY A CAP EXISTS AT ALL. The composite branch below re-probes EVERY member
 * key through the third Railway seam, sequentially, bypassing both cache layers
 * (`fetchLivePermissions`, `?force_refresh=true`). Each probe costs the
 * `keys-permissions` budget — 15 000 ms — plus the breaker's own store round
 * trips. The member read had no `.limit()`, so N was whatever the database
 * returned and the route's real worst case was N × 15 000 ms against a 300 s
 * function ceiling. A draft with enough members holds a lambda until Vercel
 * kills it mid-request, with no typed envelope and no finalize.
 *
 * WHY 10, and not a number that merely felt safe. Two independent bounds meet
 * here and 10 is the smaller-of / larger-of pair that satisfies both:
 *
 *   · PRODUCT. Real composites are small — the largest receipted book is a
 *     three-key venue stitch, and the wizard's multi-key connect step exists to
 *     combine a handful of accounts, not a portfolio of them. Nine usable
 *     members (see the fail-loud arm below) is roughly 3x the largest composite
 *     anyone has built.
 *   · THE FUNCTION CEILING. In the breaker's FAILING state the invariant charges
 *     each seam call 15 000 ms of request budget plus three store commands at
 *     4 250 ms each — 27 750 ms per member. Eleven members is 305 250 ms and
 *     BREACHES the 300 000 ms ceiling this route declares; ten is 277 500 ms and
 *     fits. So 10 is the largest cap that keeps SC-4b true in every breaker
 *     state, and `src/lib/seam-budgets.invariant.test.ts` recomputes exactly
 *     that arithmetic — raising this constant without lowering a budget reddens
 *     there rather than being discovered in production.
 *
 * DELIBERATELY NOT `export`ed. A Next.js route module's export surface is
 * validated against the route-segment contract, so an extra export is a build
 * error, not a style choice. The budget invariant therefore reads this
 * declaration from DISK — the same idiom it already uses for `maxDuration`, and
 * a genuine cross-file link rather than a table compared against itself.
 */
const MAX_COMPOSITE_MEMBERS = 10;

/**
 * 153 review — the shape of ONE composite member row as read by the O-1
 * per-member scope-broadening loop below (`select("api_key_id, api_keys (
 * exchange )")` off `strategy_keys`).
 *
 * ⛔ THIS REPLACES AN `as unknown as` DOUBLE CAST, and the cast is the defect.
 * A double cast asserts a shape the compiler has no evidence for and checks
 * NOTHING at runtime, so a PostgREST shape change degraded in SILENCE: the
 * named hazard is the embed arriving as an ARRAY (`api_keys: [{ exchange }]`)
 * rather than a to-one object, at which point `member.api_keys?.exchange` reads
 * `undefined`, every member resolves to a `null` venue, and the finalize path
 * proceeds on member data it never actually had. Same class the 140.3-03 note
 * below records for `LivePermissions` — an `interface` + `as` on an upstream
 * body — and the same remedy, so this file now has ONE answer to it.
 *
 * ⚠️ `api_keys` is `.nullish()`, NOT required, and the two misses are different
 * things. PostgREST returns the requested embed key as `null` when the FK does
 * not resolve, and a member whose embed is absent or null is STILL PROBED with
 * a `null` venue by the fail-toward rule the loop relies on — that is a real
 * runtime state, not drift, so it must parse. An ARRAY is neither of those and
 * is refused. Unknown keys are stripped rather than rejected (zod's default):
 * a column added to `strategy_keys` is not a reason to refuse a finalize.
 */
const compositeMemberRowsSchema = z.array(
  z.object({
    api_key_id: z.string().nullable(),
    api_keys: z
      .object({
        exchange: z.string().nullable(),
        // 153.6-04 / PARITY-04 — the SERVER-ATTESTED venue, and the field the
        // per-member gate below reads. VALIDATED, never cast, for the reason the
        // whole schema exists: this is the input to an ASVS V4 control, so a
        // shape we cannot read must be a refusal rather than a silent `undefined`.
        //
        // ⚠️ `.nullable().optional()`, and the OPTIONAL half is deliberate. A row
        // that carries no attestation KEY at all — a schema cache that has not
        // seen the column yet, or a projection change — is the same claim as an
        // attestation of `null`: nothing is attested, so the member is PROBED.
        // Refusing it instead would turn a column rollout into a
        // composite-finalize outage, and would refuse in the SAFE direction only
        // by accident. An array or a number is still rejected.
        attested_venue: z.string().nullable().optional(),
      })
      .nullish(),
  }),
);

/**
 * 140.3-03 / SEAMUX-07 — the value a body the schema could not read resolves
 * to, and the reason this route no longer declares a `LivePermissions`
 * interface of its own.
 *
 * The shape used to be an `interface` here and the body was cast to it with
 * `as`, which checks NOTHING at runtime. It is now `z.infer`red from
 * `LivePermissionsSchema` — one declaration, shared with the sibling route that
 * reads the same upstream (`keys/[id]/permissions`), so the two members of this
 * class cannot drift apart again.
 *
 * A parse miss resolves to this sentinel rather than throwing or returning a
 * fabricated triple: a body that could not be read is a probe that did not run,
 * which is the fail-CLOSED doctrine this file already states. Carrying no scope
 * fields at all is deliberate — it makes it structurally impossible for a parse
 * miss to present a scope verdict, however the gates below are later reordered.
 *
 * ⚠️ 153.2-04 / WIZFORM-04 / D-14b — IT NO LONGER SHARES THE `probe_error` ARM.
 * It used to fall through to it, because it carries the same field. It now has
 * its own arm, reached by IDENTITY (`livePerms === PROBE_PARSE_MISS`) so an
 * upstream body that happens to carry `probe_error: true` cannot be mistaken for
 * it. The security half is unchanged — both still fail CLOSED, both still block
 * finalize — but a body OUR schema cannot read stays unreadable until a deploy,
 * so it is reported as permanent instead of as a network blip with a Retry.
 * ⛔ Keep this a module-scope singleton: the identity check below is the only
 * thing separating the two, and a per-call object literal would silently merge
 * them again.
 */
const PROBE_PARSE_MISS = { probe_error: true } as const;
type ProbeParseMiss = typeof PROBE_PARSE_MISS;

/**
 * MT5-13 — a non-OK probe response, carrying the STATUS the service answered.
 *
 * It used to be a bare `Error` whose status survived only inside a message
 * string, so the catch below could not tell the two classes apart and mapped
 * every one of them to `KEY_NETWORK_TIMEOUT` — copy that says "we could not
 * reach the exchange" and offers a Retry. For a transient 5xx that is right.
 * For a PERMANENT 4xx (the venue has no probe adapter, the key row carries no
 * exchange, the key id is unknown) it is a lie in both halves: nothing was
 * unreachable, and no number of retries will change the answer. That is how a
 * blocked MT5 submit presented as a flaky network, five clicks running.
 */
class ProbeUpstreamError extends Error {
  constructor(readonly status: number) {
    super(`permissions probe failed: ${status}`);
    this.name = "ProbeUpstreamError";
  }
}

/**
 * WIZFORM-04 / D-14b — OUR OWN configuration is wrong, and no retry can fix it.
 *
 * `fetchLivePermissions` refuses to call the seam when `INTERNAL_API_TOKEN` is
 * unset. That threw a BARE `Error`, which landed on the generic tail of the
 * catch below and was reported to the user as `KEY_NETWORK_TIMEOUT` — "we could
 * not reach the exchange", with a Retry control. Every word of that is false:
 * nothing was reached because nothing was attempted, the exchange was never
 * involved, and the setting stays wrong until we fix it and redeploy. The user
 * is handed a button whose only possible outcome is the same message again,
 * which is the five-clicks behaviour this phase exists to end.
 *
 * A distinct CLASS rather than a status sniff, for the same reason
 * `ProbeUpstreamError` is one: a status that survives only inside a message
 * string cannot be branched on without parsing prose.
 */
class ProbeMisconfiguredError extends Error {
  constructor(setting: string) {
    super(`permissions probe misconfigured: ${setting} is not configured`);
    this.name = "ProbeMisconfiguredError";
  }
}

/**
 * Is this probe status permanent — i.e. will an identical retry answer the same
 * way until an operator or a deploy acts?
 *
 * The 4xx block is the service's CALLER class (see the endpoint's own PYAPI-05
 * contract): 400 unsupported venue, 403 internal-token misconfig, 404 unknown
 * key, 422 key row has no exchange. Two 4xx are carved out because they are
 * genuinely transient there and their existing timeout treatment is correct:
 *   429 — per-key probe rate limit, which an identical retry clears.
 *   424 — the VENUE did not answer; `retryable: true` in the contract.
 * 5xx stays transient-shaped too. Some of it is service-permanent, but it is
 * ours to page on and the user's remedy is the same either way, so this hotfix
 * does not re-litigate that boundary.
 */
function isPermanentProbeStatus(status: number): boolean {
  return status >= 400 && status < 500 && status !== 429 && status !== 424;
}

/**
 * Force-refresh the live `{read, trade, withdraw}` triple for an
 * api_keys row. Bypasses BOTH cache layers:
 *   - Next `unstable_cache` (60s) is sidestepped by NOT calling the
 *     /api/keys/[id]/permissions route at all — we hit the internal
 *     analytics endpoint directly with `cache: 'no-store'`.
 *   - Python in-memory TTL (15min) is sidestepped by passing
 *     `force_refresh=true` on the request URL, which makes the Python
 *     layer skip its `_cache_get`/`_cache_set` entries for this key.
 *
 * Throws on any non-OK response so the caller can decide between
 * fail-open and fail-closed (we fail-closed: a probe failure blocks
 * finalize, see route handler).
 *
 * Phase 140 / SEAM-01: this is the second of the two verbatim copies of the
 * third Railway seam (the other is /api/keys/[id]/permissions). Both now go
 * through the shared resilience core, which owns the base URL, the
 * `keys-permissions` budget and the `breaker:railway` circuit. Unlike its
 * sibling this probe deliberately bypasses both cache layers, so it crosses the
 * seam on EVERY submit — which is exactly why it must not be able to hammer a
 * Railway the breaker has already declared dead.
 */
async function fetchLivePermissions(
  keyId: string,
): Promise<LivePermissions | ProbeParseMiss> {
  const internalToken = process.env.INTERNAL_API_TOKEN;
  if (!internalToken) {
    // D-14b — a TYPED throw, so the catch can tell our own misconfiguration
    // apart from a transport failure. The setting NAME is the only payload; the
    // value is absent by definition, so there is nothing here to redact.
    throw new ProbeMisconfiguredError("INTERNAL_API_TOKEN");
  }
  const res = await resilientFetch(
    "keys-permissions",
    `/internal/keys/${encodeURIComponent(keyId)}/permissions?force_refresh=true`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Token": internalToken,
      },
      // cache: 'no-store' belt-and-braces against any future Next
      // fetch-level caching being introduced. The internal route is
      // POST so it shouldn't be cacheable today, but routes can change.
      cache: "no-store",
      // No signal: the core owns the deadline (SEAM_BUDGETS["keys-permissions"]).
      // No retry: this probe has no entry in the SEAM-06 retry-safety registry,
      // and D-08 makes stating that verdict mandatory rather than implicit.
      retriesOverride: 0,
    },
  );
  if (!res.ok) {
    throw new ProbeUpstreamError(res.status);
  }
  // SEAMCORE-02: `res.json()` is the core's INSTRUMENTED read — a body-read
  // failure records one breaker failure and throws `SeamBodyReadError`. Letting
  // it propagate is DELIBERATE and needs no new arm here: `runScopeBroadeningProbe`
  // already catches every probe failure and FAILS CLOSED (T-140-22), which is
  // the only safe answer — a key whose live scopes could not be re-checked must
  // never be promoted to pending_review. A body that stalled mid-stream is a
  // probe that did not run.
  //
  // 140.3-03 / SEAMUX-07 — THE UNCHECKED CAST IS GONE (the type name it
  // asserted is deliberately not spelled out here: the acceptance grep proving
  // the cast is gone would otherwise match this very comment — the same trap
  // the route-local-scrubber note below records). It asserted a shape and
  // verified none, and the gate below rejects only on an explicit
  // `=== true`: a 2xx `{}` or one renamed field left both scopes `undefined`,
  // both gates passed, and a key holding trade/withdraw scope was published as
  // read-only-verified. `read`/`trade`/`withdraw` are REQUIRED in the schema
  // precisely because their absence is that drift.
  //
  // The fallback direction is INVERTED relative to `src/lib/api/errorSchema.ts`,
  // which degrades an unparseable body to `{}` — right for error COPY, and the
  // vulnerability here. A miss fails CLOSED instead, on the same arm as a probe
  // that did not run.
  const parsed = LivePermissionsSchema.safeParse(await res.json());
  if (!parsed.success) {
    console.error(
      `[strategies/finalize-wizard] live permissions probe returned an ` +
        `unreadable body — failing CLOSED (fields: ` +
        `${parsed.error.issues
          .map((issue) => `${issue.path.join(".") || "<root>"}:${issue.code}`)
          .join(", ")})`,
    );
    return PROBE_PARSE_MISS;
  }
  return parsed.data;
}

function validateStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is string => typeof v === "string" && v.length > 0)
    .slice(0, 20);
}

/**
 * ⚠️ THE ROUTE-LOCAL SCRUBBER IS GONE — see `@/lib/seam-redaction`.
 *
 * A private token-scrub pair used to live here (the names are deliberately not
 * spelled out: the acceptance grep proving they are gone would otherwise match
 * this very comment — the same trap the dormant handler's base-URL note in
 * keys/validate-and-encrypt records). The IDEA was
 * right: they were promoted to module scope precisely so every error-logging
 * site in this route got them. Phase 140.2 / SEAMCORE-06 generalised them
 * instead of discarding them, because the implementation was too narrow in
 * three ways that each shipped silently — it knew exactly ONE env secret (so
 * `X-Service-Key`, the Upstash token and a live user JWT went to the log
 * verbatim), it was unreachable from the seam core and both clients where
 * undici actually produces the leak, and it had no minimum-length refusal, so a
 * short secret would substring-match prose and eat the `ECONNREFUSED` token —
 * TRAP-1's explicit over-redaction warning.
 *
 * Do not re-introduce a local copy. Two enumerations of one concept is the
 * class-not-instance defect this programme exists to close, and a comment is
 * not a mechanism: `seam-log-coverage.test.ts` fails on a bare caught
 * identifier reaching a `console.*` in this file.
 */

/**
 * M-18 — payload validator. Returns either a `{ ok: true, fields }` tuple of
 * normalized values OR an early NextResponse for the first validation error.
 * Pulled out of POST() so the validation gauntlet is testable in isolation
 * and the route handler reads as flow control, not field-by-field checks.
 */
type ValidatedPayload = {
  strategy_id: string;
  name: string;
  description: string;
  category_id: string;
  strategy_types: string[];
  subtypes: string[];
  markets: string[];
  supported_exchanges: string[];
  leverage_range: string | null;
  aumNum: number | null;
  maxCapacityNum: number | null;
  asset_class: string;
  // CONTRIB-02 (Phase 110) — which wizard entry finalized this draft. 'manager'
  // (default, back-compat: today's callers send nothing) keeps the existing
  // publish-candidate flow ('pending_review'); 'contribution' is the allocator
  // overlay, which finalizes to an owner-only terminal status ('private').
  entryContext: "manager" | "contribution";
  // Phase 150 / OWN-03 — whose capital sits behind this key, when the wizard
  // asked. UNDEFINED means the question was never put to the user, which is
  // NOT the same as an answer: the mark is left unwritten (NULL), and an
  // unmarked strategy is non-allocatable. Never default this.
  capitalOwnership?: CapitalOwnership;
};

/**
 * The server-side input-validation control for this route (ASVS V5).
 *
 * ⭐ 153.1-05 / D-09(b) — EVERY arm below carries a `code`, and that is the
 * whole point of this pass. Until now they answered a bare `error` string, so
 * `SubmitStep` had nothing to map and rendered "We could not classify this
 * failure" — the generic dead end — for a rejection the server had classified
 * perfectly well. The arm that cost the founder three submits is the
 * description one: a description of two characters produced a card that named
 * neither the field nor the rule.
 *
 * Two properties to preserve when editing anything here:
 *
 *   · ⛔ A `code` changes the response BODY, never the DECISION. Not one
 *     condition below is weakened by carrying one, and the client-side mirrors
 *     Phase 153.2 adds are UX, never enforcement — this function stays the
 *     control.
 *   · ⚠️ A code emitted here must be a member of `KNOWN_FINALIZE_CODES`
 *     (`SubmitStep.tsx`) IN THE SAME COMMIT, or it fails that membership check,
 *     falls through to `UNKNOWN`, and the fix ships invisible while every
 *     route-side test stays green. 153.1-06 turns that obligation into a
 *     derived assertion so the next author cannot forget it.
 *
 * The `error` strings stay developer-facing detail. The USER-facing sentence
 * now comes from the code's entry in `WIZARD_ERROR_COPY`, which is why the
 * detail here can name a field and a rule without being written as copy.
 */
function validatePayload(
  body: Record<string, unknown> | null,
):
  | { ok: true; fields: ValidatedPayload }
  | { ok: false; response: NextResponse } {
  if (!body || typeof body !== "object") {
    return {
      ok: false,
      response: NextResponse.json(
        // Not a field-level code: a body that is not an object was never
        // TYPED by anyone, so there is no form control to route the user
        // back to. `VALIDATION_FAILED` is the honest answer (RESEARCH Q3).
        { code: "VALIDATION_FAILED", error: "Invalid request body" },
        { status: 400, headers: NO_STORE_HEADERS },
      ),
    };
  }

  const {
    strategy_id,
    name,
    description,
    category_id,
    strategy_types,
    subtypes,
    markets,
    supported_exchanges,
    leverage_range,
    aum,
    max_capacity,
    asset_class,
    entry_context,
    capital_ownership,
  } = body;

  if (!isUuid(strategy_id)) {
    return {
      ok: false,
      response: NextResponse.json(
        // Same reasoning as the body arm: the draft id is minted by the
        // wizard, never typed by the user, so there is no field to name.
        {
          code: "VALIDATION_FAILED",
          error: "strategy_id must be a valid UUID",
        },
        { status: 400, headers: NO_STORE_HEADERS },
      ),
    };
  }
  if (typeof name !== "string" || !STRATEGY_NAME_SET.has(name)) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          code: "METADATA_NAME_INVALID",
          error: "name must be one of the allowed codenames",
        },
        { status: 400, headers: NO_STORE_HEADERS },
      ),
    };
  }
  // ⭐ 153.1-05 / D-09(b) + D-23 — THIS is the incident, and it is three arms
  // rather than one on purpose.
  //
  // It shipped as a single condition answering one sentence, "description must
  // be 10-5000 characters", with no `code`. The founder submitted a
  // two-character description three times and read "We could not classify this
  // failure" each time. The server knew exactly what was wrong.
  //
  // Splitting it is not cosmetic: UI-SPEC Surface 2 maps each field-level code
  // to exactly one field, and the two bounds are two DIFFERENT remedies — one
  // asks the user to write more, the other to cut. A single code cannot carry
  // both sentences, and the copy 153.1-04 authored is a pair for that reason.
  //
  // ⛔ D-23 — the lower bound reads `MAGNITUDE_CAPS.MIN_DESCRIPTION_CHARS`. The
  // bare `10` that used to sit here is the drift that produced the incident:
  // the constant and the sentence were free to disagree, and a client-side
  // mirror written against either could be wrong about the other. Both bounds
  // are interpolated into the developer-facing string from the same constants
  // the conditions read, so the text cannot contradict the rule it describes.
  if (typeof description !== "string") {
    return {
      ok: false,
      response: NextResponse.json(
        { code: "METADATA_DESCRIPTION_REQUIRED", error: "description is required" },
        { status: 400, headers: NO_STORE_HEADERS },
      ),
    };
  }
  if (description.length < MAGNITUDE_CAPS.MIN_DESCRIPTION_CHARS) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          code: "METADATA_DESCRIPTION_TOO_SHORT",
          error: `description must be at least ${MAGNITUDE_CAPS.MIN_DESCRIPTION_CHARS} characters`,
        },
        { status: 400, headers: NO_STORE_HEADERS },
      ),
    };
  }
  if (description.length > MAGNITUDE_CAPS.MAX_DESCRIPTION_CHARS) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          code: "METADATA_DESCRIPTION_TOO_LONG",
          error: `description must be at most ${MAGNITUDE_CAPS.MAX_DESCRIPTION_CHARS} characters`,
        },
        { status: 400, headers: NO_STORE_HEADERS },
      ),
    };
  }
  if (!isUuid(category_id)) {
    return {
      ok: false,
      response: NextResponse.json(
        // A field-level code even though the detail names a UUID: the user
        // picks a category from a <Select>, and an absent or malformed id is
        // what an unanswered picker looks like on the wire.
        {
          code: "METADATA_CATEGORY_REQUIRED",
          error: "category_id must be a valid UUID",
        },
        { status: 400, headers: NO_STORE_HEADERS },
      ),
    };
  }

  // audit-2026-05-07 H-0325/H-0326 — fail-LOUD on invalid dollar values
  // instead of coercing to NULL. Pre-fix a client typo like '-5' or
  // '1e20' silently dropped to NULL on the server and a strategy
  // finalized with missing AUM — at minimum bad UX, at worst regulatory
  // exposure for a "Verified by Quantalyze" factsheet with no AUM. The
  // contract: client must send a finite number in [0, 1e12), or omit
  // the field (null / undefined) entirely.
  // Phase 150: the validator itself moved to `@/lib/dollar-validation` so the
  // allocation route does not mint a second one; behaviour is unchanged.
  const MAX_DOLLAR_VALUE = MAGNITUDE_CAPS.MAX_DOLLAR_VALUE_USD;
  const isOmitted = (v: unknown): boolean => v === undefined || v === null;
  if (!isOmitted(aum) && !isValidDollar(aum)) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          code: "METADATA_AUM_INVALID",
          error: `aum must be a finite non-negative number under ${MAX_DOLLAR_VALUE}`,
        },
        { status: 400, headers: NO_STORE_HEADERS },
      ),
    };
  }
  if (!isOmitted(max_capacity) && !isValidDollar(max_capacity)) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          code: "METADATA_CAPACITY_INVALID",
          error: `max_capacity must be a finite non-negative number under ${MAX_DOLLAR_VALUE}`,
        },
        { status: 400, headers: NO_STORE_HEADERS },
      ),
    };
  }
  const aumNum = isValidDollar(aum) ? aum : null;
  const maxCapacityNum = isValidDollar(max_capacity) ? max_capacity : null;

  // #597 — asset class drives Sharpe/Sortino/vol annualization (√365 crypto /
  // √252 traditional). Accept only the two closed-set values; anything else
  // (absent, garbled, a future value) fails SAFE to 'traditional' — the
  // conservative √252 basis and the DB column default.
  const asset_class_validated =
    asset_class === "crypto" || asset_class === "traditional"
      ? asset_class
      : "traditional";

  // CONTRIB-02 (Phase 110) — entry_context selects the terminal-status branch.
  // Closed set {manager, contribution}; ABSENT/null → 'manager' (back-compat:
  // every caller before this phase sends nothing). A garbage value is a hard 400
  // — never silently coerced. Safe by construction: BOTH reachable terminal
  // statuses ('pending_review','private') are non-published, the admin publish
  // queue only lists 'pending_review', and the finalize_wizard_strategy RPC
  // RAISEs on any value outside ('pending_review','private') (server-side
  // enforcement, T-110-10 / V5). This flag is a trusted context selector, not a
  // client-trusted "publish=false" — the user cannot flip it to reach publication.
  if (
    entry_context !== undefined &&
    entry_context !== null &&
    entry_context !== "manager" &&
    entry_context !== "contribution"
  ) {
    return {
      ok: false,
      response: NextResponse.json(
        // `VALIDATION_FAILED`, not a field-level code: `entry_context` is a
        // trusted context selector the wizard sets from which surface the user
        // entered by. It is never typed, so there is no control to route back
        // to (RESEARCH Q3, same class as the two arms at the top).
        {
          code: "VALIDATION_FAILED",
          error: "entry_context must be 'manager' or 'contribution'",
        },
        { status: 400, headers: NO_STORE_HEADERS },
      ),
    };
  }
  const entryContextValidated =
    entry_context === "contribution" ? "contribution" : "manager";

  // OWN-03 (Phase 150) — the capital mark. Closed set {own_capital,
  // team_review}, mirroring the DB CHECK `strategies_capital_ownership_check`;
  // ABSENT/null means the wizard never asked, and the mark is simply not
  // written (the column stays NULL = unmarked = non-allocatable).
  //
  // A garbage value is a hard 400, NOT a silent coercion to the safe value.
  // Coercing would let a broken or hostile client believe it had set a mark
  // it did not set. This value is data, not privilege: marking a strategy
  // own-capital only makes it ELIGIBLE for the allocation surface, which
  // enforces ownership itself.
  //
  // ⚠️ 153.1-05 — THIS COMMENT USED TO ARGUE FOR THE DEFECT, and the paragraph
  // is deleted rather than softened. It read: "a bare `error` string with NO
  // `code`, because every code the wizard renders must exist in its error
  // roster — an unknown one renders the UNKNOWN card, which tells the user
  // nothing." The observation was true and the conclusion was backwards: the
  // remedy for a code that is not in the roster is to PUT IT IN THE ROSTER, in
  // the same commit, which is exactly what this one does. Answering with no
  // code at all does not avoid the UNKNOWN card — it GUARANTEES it, for every
  // rejection on this path, forever. WIZFORM-02 removes the premise outright:
  // the roster is asserted against the emitting sites (153.1-06), so a member
  // missed here REDS CI BY NAME instead of shipping a silent dead end.
  // Leaving the old sentence in place would invite the next reader to restore
  // the bug (RESEARCH).
  if (
    capital_ownership !== undefined &&
    capital_ownership !== null &&
    !isCapitalOwnership(capital_ownership)
  ) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          code: "METADATA_CAPITAL_OWNERSHIP_INVALID",
          error: `capital_ownership must be '${OWN_CAPITAL}' or '${TEAM_REVIEW}'`,
        },
        { status: 400, headers: NO_STORE_HEADERS },
      ),
    };
  }
  const capitalOwnershipValidated: CapitalOwnership | undefined =
    isCapitalOwnership(capital_ownership) ? capital_ownership : undefined;

  // audit-2026-05-07 H-0324 — isUuid is a type predicate (value is
  // string), so the prior `as string` casts were redundant. Removing
  // them keeps the parse boundary statically verified end-to-end.
  return {
    ok: true,
    fields: {
      strategy_id,
      name,
      description,
      category_id,
      strategy_types: validateStringArray(strategy_types),
      subtypes: validateStringArray(subtypes),
      markets: validateStringArray(markets),
      // QA report 2026-05-21 ISSUE-004 — canonicalize before persist
      // so the row stores ['Bybit'] not ['bybit', 'Bybit'] even if a
      // stale client (pre-WizardClient-canonicalize) sends mixed case.
      supported_exchanges: canonicalizeExchangeList(
        validateStringArray(supported_exchanges),
      ),
      leverage_range:
        typeof leverage_range === "string" && leverage_range.length > 0
          ? leverage_range
          : null,
      aumNum,
      maxCapacityNum,
      asset_class: asset_class_validated,
      entryContext: entryContextValidated,
      capitalOwnership: capitalOwnershipValidated,
    },
  };
}

/**
 * M-18 — force-refresh permissions probe runner. Returns either
 * `{ ok: true }` (proceed to finalize) or an early NextResponse with the
 * appropriate code (KEY_NETWORK_TIMEOUT / KEY_SCOPE_BROADENED). Encapsulates
 * the fail-CLOSED + probe_error decoding logic so the caller is just flow
 * control.
 */
async function runScopeBroadeningProbe(
  apiKeyId: string,
  venue: string | null,
): Promise<{ ok: true } | { ok: false; response: NextResponse }> {
  // WIZFORM-04 / MT5-14(a) / D-06 — THE CAPABILITY SKIP. Four things about it,
  // because this is a SECURITY control and a skip inside one needs its
  // justification written where the skip is, not in a plan file:
  //
  // 1. This is the ASVS V4 scope-broadening defence: a key broadened to
  //    trade/withdraw between Connect and Submit is caught here. The skip is a
  //    deliberate PER-VENUE exemption, not a relaxation of the control — every
  //    venue that answers a per-key permissions probe still gets probed, on
  //    every submit, exactly as before.
  //
  // 2. The exempt venue is exempt because the question has no answer, not
  //    because we decided to trust it. MT5 read-only is enforced STRUCTURALLY
  //    (`Mt5Client` composes only read methods — there is no order / withdraw /
  //    transfer surface that could be broadened) and BEHAVIOURALLY (`order_check`
  //    is rejected for a master login, proven at `_validate_mt5_key`), and the
  //    venue exposes no per-key scope endpoint at all. Demanding a ccxt
  //    permissions probe from it produced a PERMANENT failure dressed as a
  //    network blip, and that is what blocked every MT5 submit.
  //
  // 3. ⭐ THE PREDICATE ANSWERS `true` FOR null, "" AND ANY UNKNOWN VENUE, and
  //    that direction is the whole safety of this line. `venue` is `null`
  //    whenever the `api_keys` read faulted, for a composite member whose embed
  //    came back empty, and — since 153.6-04 / PARITY-04 — for every key that
  //    carries no SERVER ATTESTATION: a row the backfill has not reached, and a
  //    row whose client-supplied attestation the BEFORE INSERT trigger scrubbed.
  //    Those keys are STILL PROBED. Skipping on `null` would silently disable the
  //    defence for every key whose venue read blipped, and would hand the
  //    exemption back to anyone willing to INSERT a label — a control that fails
  //    open on a transient DB error, or on a claim by its own subject, is not a
  //    control. Read it through the predicate; never index the capability record.
  //
  //    ⛔ `venue` IS THE ATTESTED VENUE AT BOTH CALL SITES. This helper cannot
  //    enforce that — it takes a string — so the rule is stated at both callers
  //    and pinned by the PARITY-04 rows in `route.test.ts`.
  //
  // 4. ⛔ It is `venueSupportsScopeProbe(venue)` — a CAPABILITY question — and
  //    never an equality test against a particular venue's name. (The literal
  //    is not written out even in this comment: the acceptance grep proving
  //    this route never names the venue runs over these lines too, so quoting
  //    it here would make the prose satisfy its own gate — a trap three sibling
  //    plans in this phase have already walked into.) The answer lives in the
  //    capability record precisely so a second venue with the same shape costs
  //    one row instead of a repo sweep for instance checks — and so that sFOX,
  //    which asks a superficially similar question, stays BYTE-UNCHANGED (D-22)
  //    by simply not carrying the capability.
  if (!venueSupportsScopeProbe(venue)) {
    return { ok: true };
  }
  let livePerms: LivePermissions | ProbeParseMiss;
  try {
    livePerms = await fetchLivePermissions(apiKeyId);
  } catch (probeErr) {
    // ORDER IS LOAD-BEARING: CircuitOpenError FIRST, and STILL FAIL CLOSED
    // (T-140-22). A breaker trip means the scope-broadening probe did not run,
    // so finalize must be BLOCKED exactly as it is for any other probe failure
    // — a key whose live scopes could not be re-checked must never be promoted
    // to pending_review. The only thing that changes is the envelope: 503 +
    // CIRCUIT_OPEN + Retry-After tells the wizard "this will work again in
    // ~30s", where the generic 502 KEY_NETWORK_TIMEOUT tells it nothing
    // actionable. The class comes from the never-mocked `@/lib/seam-errors`
    // leaf, so this `instanceof` holds under every mock shape in the suite.
    if (probeErr instanceof CircuitOpenError) {
      console.error(
        `[strategies/finalize-wizard] live permissions probe short-circuited — ` +
          `the analytics circuit is open (retry_after_s=${probeErr.retryAfterS})`,
      );
      return {
        ok: false,
        response: NextResponse.json(
          { code: "CIRCUIT_OPEN", error: CIRCUIT_OPEN_COPY },
          {
            status: 503,
            headers: {
              ...NO_STORE_HEADERS,
              "Retry-After": String(probeErr.retryAfterS),
            },
          },
        ),
      };
    }
    // audit-2026-05-07 H-0328, generalised by SEAMCORE-06 — log only the safe
    // primitives (name + message + cause chain), scrubbed of every secret the
    // shared leaf knows. Some fetch / undici / retry-wrapper stack traces embed
    // the outgoing X-Internal-Token header in either the message or a
    // wrapper-error NAME; the leaf covers both paths, and the syscall token
    // survives so a refused connection is still distinguishable from a timeout.
    console.error(
      `[strategies/finalize-wizard] live permissions probe failed: ${scrubSeamError(probeErr)}`,
    );
    // MT5-13 — ORDER: this arm sits AFTER CircuitOpenError (which is its own
    // transient verdict) and BEFORE the generic timeout, because a permanent
    // status is the more specific claim. Same fail-CLOSED outcome as every other
    // probe failure — finalize is still blocked, nothing is promoted — but the
    // envelope stops inviting a retry that cannot work. `KEY_SCOPE_CHECK_UNAVAILABLE`
    // carries no recoverable action, so the wizard renders no Retry control at all.
    if (
      probeErr instanceof ProbeUpstreamError &&
      isPermanentProbeStatus(probeErr.status)
    ) {
      return {
        ok: false,
        response: NextResponse.json(
          {
            code: "KEY_SCOPE_CHECK_UNAVAILABLE",
            error: "Could not verify key scopes",
          },
          { status: 502, headers: NO_STORE_HEADERS },
        ),
      };
    }
    // WIZFORM-04 / D-14b — OUR CONFIGURATION IS WRONG, and it is permanent.
    // BEFORE the generic tail, for the same "more specific claim first" reason
    // the permanent-status arm above sits where it does.
    //
    // What makes it permanent: `INTERNAL_API_TOKEN` unset is a deployment
    // setting, and a setting stays wrong until a human fixes it and redeploys.
    // Reported as a network timeout it read "we could not reach the exchange"
    // and offered a Retry — three untruths and a button that can only fail.
    // `SEAM_MISCONFIGURED` carries no recoverable action, so `buildEnvelope`
    // derives `recoverable: false` and NO Retry control renders at all (the
    // structural suppression, never a prop). It is already a member of
    // `SubmitStep`'s KNOWN_FINALIZE_CODES — verified at source in this commit,
    // because an unlisted code falls to UNKNOWN, whose copy IS recoverable, and
    // the fix would ship invisible with every route-side test green.
    //
    // 500, not 502: the fault is OURS, not the venue's. That is the same status
    // `process-key-client` already answers this class with, so the two agree.
    if (probeErr instanceof ProbeMisconfiguredError) {
      return {
        ok: false,
        response: NextResponse.json(
          {
            code: "SEAM_MISCONFIGURED",
            error: "Key scope check is not configured",
          },
          { status: 500, headers: NO_STORE_HEADERS },
        ),
      };
    }
    // The generic tail keeps KEY_NETWORK_TIMEOUT for exactly what it honestly
    // describes: an unclassified TRANSPORT failure, where a retry really can
    // succeed. ⛔ No retry is issued here — the user's Retry is the only one,
    // and this route adds no loop (D-07).
    return {
      ok: false,
      response: NextResponse.json(
        { code: "KEY_NETWORK_TIMEOUT", error: "Could not verify key scopes" },
        { status: 502, headers: NO_STORE_HEADERS },
      ),
    };
  }
  // WIZFORM-04 / D-14b — THE PARSE MISS IS NOT A NETWORK BLIP.
  //
  // Two conditions used to arrive on one arm because they resolve to the same
  // SHAPE: a body our zod schema could not read (`fetchLivePermissions` returns
  // the module-scope PROBE_PARSE_MISS sentinel) and a body in which the service
  // itself reported `probe_error: true`. IDENTITY tells them apart — the
  // sentinel is one module-scope object and `fetchLivePermissions` returns THAT
  // reference, so `=== PROBE_PARSE_MISS` cannot be forged by an upstream payload
  // that happens to carry the same field. (`as const` is a TYPE-level freeze,
  // not `Object.freeze`; the guarantee here is reference identity, not
  // immutability, and nothing on this path mutates it.)
  //
  // A body our schema cannot read is not a network blip. The SERVICE-REPORTED
  // probe_error stays on KEY_NETWORK_TIMEOUT — there the upstream really did try
  // and really did fail, and a retry is a real remedy.
  //
  // ⚠️ 153.6-06 / PARITY-05 — AND IT IS NOT PERMANENT EITHER. 153.2-04 sent this
  // arm to KEY_SCOPE_CHECK_UNAVAILABLE on the reasoning that the body "stays
  // unreadable until a deploy changes one side or the other". That sentence is
  // true and it is satisfied by the deploy that is ALREADY ROLLING: during an
  // analytics release the old and new pods answer different shapes for a few
  // minutes, and this arm fires for every finalize in that window. The permanent
  // code's copy suppresses Retry structurally, so the fix for one dead end built
  // another one on the wizard's last step. The arm now carries its OWN code,
  // KEY_SCOPE_CHECK_UNREADABLE, whose copy is honestly recoverable.
  //
  // ⛔ The permanent probe-STATUS arm above keeps KEY_SCOPE_CHECK_UNAVAILABLE
  // untouched. Widening THAT code's actions instead of minting this one would
  // have leaked a Retry onto an arm where retrying is guaranteed to fail.
  // ⛔ And never back to KEY_NETWORK_TIMEOUT: the exchange answered, so "we
  // could not reach the exchange" is the lie 153.2-04 correctly removed.
  //
  // ⚠️ The sentinel's own contract is preserved: it carries NO scope fields, so
  // however these gates are later reordered a parse miss can never present a
  // scope verdict. Both arms still FAIL CLOSED — nothing is promoted either way,
  // and only what the user is TOLD changed here.
  if (livePerms === PROBE_PARSE_MISS) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          code: "KEY_SCOPE_CHECK_UNREADABLE",
          error: "Could not read the key scope response",
        },
        { status: 502, headers: NO_STORE_HEADERS },
      ),
    };
  }
  if (livePerms.probe_error) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          code: "KEY_NETWORK_TIMEOUT",
          error: "Exchange permission probe failed",
        },
        { status: 502, headers: NO_STORE_HEADERS },
      ),
    };
  }
  if (livePerms.trade === true || livePerms.withdraw === true) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          code: "KEY_SCOPE_BROADENED",
          error: "Key has been broadened beyond read-only on the exchange.",
        },
        { status: 403, headers: NO_STORE_HEADERS },
      ),
    };
  }
  return { ok: true };
}

export const POST = withAuth(async (req: NextRequest, user: User) => {
  // PR-2 silent-failure-hunter F5 (2026-05-28): explicit try/catch around
  // req.json() so the parse/transport error class is logged. req.json()
  // collapses transport read failures and JSON-parse errors into one
  // rejection — pre-fix the .catch(() => null) chain dropped both into
  // an unlogged null silently. SRE sees the err.message in console now.
  let body: unknown = null;
  try {
    body = await req.json();
  } catch (err) {
    // SEAMCORE-06 — a class member the plan's enumeration did not list: the
    // caught rejection was passed through raw. `req.json()` collapses transport
    // read failures and parse errors into one rejection, and a transport
    // failure's message is undici's, headers included.
    console.warn(
      "[finalize-wizard] body JSON parse failed:",
      scrubSeamError(err),
    );
  }

  const validation = validatePayload(body as Record<string, unknown> | null);
  if (!validation.ok) return validation.response;
  const fields = validation.fields;

  // CONTRIB-02 (Phase 110) — the contribution wizard finalizes to an owner-only
  // 'private' terminal status; the manager flow keeps 'pending_review'. Derived
  // ONCE here and threaded to every finalize writer (the legacy RPC + response).
  const terminalStatus: "pending_review" | "private" =
    fields.entryContext === "contribution" ? "private" : "pending_review";

  // B15 limiter-ordering — consume the rate-limit token AFTER input
  // validation (body parse + validatePayload), not before. A malformed /
  // invalid request now gets rejected with 400 WITHOUT burning one of the
  // caller's own tokens. Canonical order: auth → input-validation →
  // rate-limit → handler. The deny shape (503 misconfig split + 429) and
  // the exact key string are preserved verbatim.
  const rl = await checkLimit(
    userActionLimiter,
    `strategies-finalize-wizard:${user.id}`,
  );
  if (!rl.success) {
    // PR-2 full-file reviewer #5 (2026-05-28): 503 on rate-limit misconfig.
    //
    // 153.2-05 / WIZFORM-02 — BOTH ARMS NOW CARRY A CODE. They were two of the
    // five rejections this route still answered code-less, and a code-less
    // rejection renders the UNKNOWN card — "We could not classify this failure"
    // — for a failure the route classified well enough to pick a status and
    // write a sentence about. Worse, UNKNOWN's copy is RECOVERABLE, so the user
    // got a Retry button in both cases: correct for a throttle, and a control
    // that cannot work for a misconfiguration.
    //
    // ⚠️ THE TWO ARMS STAY EXPLICIT `NextResponse.json` SITES, and that is a
    // decision rather than inertia. Routing them through the deny chokepoint
    // (140.4-13 / SEAMRIM-05) was tried first and MEASURED: it drops
    // `finalize-wizard`'s derived rejection-site count from 32 to 30, because
    // the class scan in `wizardErrors.invariant.test.ts` finds sites by reading
    // 4xx/5xx `NextResponse.json` literals out of this file's source. A helper
    // call is invisible to it, so both arms would leave the population the
    // guard watches — and a guard that stops seeing an arm is exactly how a
    // future code-less rejection ships green. Status, headers and the
    // `Retry-After` stamp are byte-unchanged here; only the codes are added.
    //
    // ⚠️ `RATE_LIMITED`, NOT `KEY_RATE_LIMIT` — and the ledger that recorded
    // this debt named the wrong one. `KEY_RATE_LIMIT`'s copy opens "The
    // exchange rate-limited this request", which is FALSE here: this is
    // `userActionLimiter` on OUR own per-user key, and the exchange was never
    // contacted. `RATE_LIMITED` says "the cap is ours, not your exchange's",
    // which is the sentence 140.3-01 wrote for exactly this condition.
    // ⓘ It needs no roster entry: `SEAM_CODE_TO_WIZARD_CODE` maps it to itself
    // and the translation runs BEFORE the roster check, so `SubmitStep`
    // surfaces it as-is. (`composite/add-key` still answers `KEY_RATE_LIMIT`
    // here; that arm carries its own note saying the sentence is wrong for an
    // internal limiter, and re-cutting it is not this plan's file.)
    //
    // ⚠️ `SEAM_MISCONFIGURED` on the 503 — already a roster member, and its
    // copy is written for precisely this: "our own configuration is wrong…
    // Retrying will not clear it." It carries no recoverable action, so no
    // Retry control renders at all — the structural suppression, not a prop.
    if (isRateLimitMisconfigured(rl)) {
      return NextResponse.json(
        { code: "SEAM_MISCONFIGURED", error: "Rate limiter unavailable" },
        { status: 503, headers: { ...NO_STORE_HEADERS, "Retry-After": String(rl.retryAfter) } },
      );
    }
    return NextResponse.json(
      { code: "RATE_LIMITED", error: "Too many requests" },
      { status: 429, headers: { ...NO_STORE_HEADERS, "Retry-After": String(rl.retryAfter) } },
    );
  }

  const supabase = await createClient();

  // Scope-broadening defense — re-check the live exchange permissions
  // before calling the finalize RPC. The validation at Connect time
  // (/api/keys/validate-and-encrypt) only sees the scopes that
  // existed THEN; a user can broaden the key on the exchange
  // dashboard between Connect and Submit. We force-refresh both
  // caches (60s Next + 15min Python) so the check actually sees the
  // current scopes.
  //
  // The lookup uses the user-scoped client so RLS rejects strategies
  // the caller doesn't own. A "no api_key_id" row is the CSV branch
  // (no exchange key linked) — we skip the probe because the CSV
  // branch's data lives in csv_uploads, not api_keys.
  //
  // audit-2026-05-07 C-0119/H-0329 — belt-and-braces user_id filter so
  // ownership defense does NOT rely on RLS alone. If RLS on `strategies`
  // ever regresses, an attacker who guesses a victim's strategy_id could
  // (a) trigger the Railway probe revealing it's a real API-keyed
  // strategy, then (b) read the api_keys.exchange via the admin client.
  // The downstream SECURITY DEFINER RPC re-checks ownership, but the
  // probe + admin-client lookup BOTH fire before that point.
  // 140.3-14 / TS-33 — `wizard_session_id` is selected here, on the read this
  // handler ALREADY performs, so the dedupe id costs no extra query.
  //
  // ⚠️ IT IS READ FROM THE DRAFT ROW, NOT FROM THE REQUEST BODY, and that is a
  // deliberate improvement on the CSV path's shape rather than a deviation from
  // it. The placement it is forwarded in is identical (`postProcessKey`'s
  // `context.wizard_session_id`); only the SOURCE differs. `create-with-key`
  // and the composite RPC both persist the client's stable session id onto
  // `strategies.wizard_session_id` at draft creation (migration
  // 20260602190000, F6), and this select is already owner-scoped
  // (`.eq("user_id", user.id)`), so the value cannot be supplied, guessed or
  // swapped by the caller of THIS request. A body field would have re-opened
  // exactly the caller-supplied-id surface that migration 20260726000225
  // (140.1 / PYAPI-01) had to scope the unique index to `(strategy_id,
  // wizard_session_id)` to contain.
  //
  // It is also the only source that is STABLE across the duplicate submissions
  // this is meant to dedupe: the correlation id in `X-Correlation-Id` is
  // memoized per PAGE LOAD, so a reload — the single most likely way a user
  // double-submits — mints a new one and would key the dedupe on a value that
  // changes per request, which is worse than sending nothing.
  const { data: strategyRow, error: strategyErr } = await supabase
    .from("strategies")
    .select("api_key_id, wizard_session_id")
    .eq("id", fields.strategy_id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (strategyErr) {
    // SEAMCORE-06 — same class as the five Supabase `.message` reads this route
    // already scrubbed, and it was the one that was not. Closing the class, not
    // the instances, is the point.
    console.error(
      "[strategies/finalize-wizard] strategy lookup failed:",
      scrubSeamError(strategyErr),
    );
    return NextResponse.json(
      { error: "Could not load draft" },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
  if (!strategyRow) {
    return NextResponse.json({ code: "GATE_DRAFT_GONE", error: "Draft not found" }, { status: 404, headers: NO_STORE_HEADERS });
  }

  const apiKeyId =
    typeof strategyRow.api_key_id === "string" ? strategyRow.api_key_id : null;

  // 140.3-14 / TS-33. Narrowed the same way `apiKeyId` is, one line above: the
  // column is NULLABLE (migration 20260602190000 — "only wizard drafts set
  // it"), so a draft that predates F6, or one minted by a path that does not
  // stamp it, yields `null`.
  //
  // `null` is forwarded as ABSENCE, never as a synthesised value. Python's
  // `idempotent_by_session` reads `bool(context.get("wizard_session_id"))` and
  // mints a fresh uuid4 when it is missing, so absence reproduces today's
  // behaviour byte for byte — the dedupe is simply off for that request, which
  // is where it already was. Inventing an id to fill the gap would key the
  // dedupe on a per-request value and make it worse than absent.
  const wizardSessionId =
    typeof strategyRow.wizard_session_id === "string"
      ? strategyRow.wizard_session_id
      : null;

  // #597 — persist the strategy's asset class onto the draft row. The
  // SECURITY DEFINER `finalize_wizard_strategy` RPC signature does not carry
  // asset_class, so it is written here directly on the owner-scoped client
  // (RLS + the belt-and-braces user_id filter enforce ownership) BEFORE the
  // finalize dispatch, covering both the legacy and unified paths.
  //
  // API-keyed strategies FORCE-DERIVE off the linked key's VENUE (MT5RECON-02):
  // a crypto venue (binance/okx/bybit/deribit/sfox) → 'crypto' (√365), an mt5
  // (forex/CFD) venue → 'traditional' (√252). The picker's submitted value is
  // still ignored for api-keyed drafts — trusting it would let a resumed broker
  // draft (whose DB row carries the NOT NULL DEFAULT 'traditional') silently
  // annualize a crypto strategy on √252. Before MT5RECON-02 this arm was an
  // unconditional 'crypto' (every supported venue WAS crypto); now that mt5 is a
  // supported venue, `isCryptoExchange` (the explicit CRYPTO_EXCHANGES subset) is
  // the single source of truth, so this seam no longer overwrites the
  // create-with-key 'traditional' stamp back to crypto for an mt5 key.
  //
  // Phase 86 / F-1: a MULTI-KEY composite has api_key_id=NULL (members live in
  // strategy_keys), so the venue-aware apiKeyId arm doesn't apply — it force-
  // derives 'crypto'. Every composite member venue is a crypto exchange this
  // phase (an mt5 composite member fails LOUD at the stitch unknown-venue gate,
  // job_worker.py — honest, out of 136 scope), and run_stitch_composite_job
  // annualizes the headline on the venue blend (Deribit → √365). If asset_class
  // stayed 'traditional', every #597 surface (scenario blends, leg annualization,
  // OG card, peer-rank) would recompute √252 from the SAME returns and disagree
  // with the composite headline by ~√(365/252) ≈ 1.20×. Force 'crypto' when the
  // strategy has ≥1 member. The count is best-effort (membership isn't sensitive
  // → admin client); a count blip falling open here CANNOT silently ship a
  // mislabeled composite because the worker fails LOUD on a √365-vs-asset_class
  // mismatch (F-1b) — and that cross-check reads the Python CRYPTO_VENUES registry
  // which ALSO excludes mt5, so the TS and worker sides agree by construction —
  // and the dispatch guard fails closed on unknowable membership.
  const assetClassAdmin = createAdminClient();
  const { count: assetClassMemberCount } = await assetClassAdmin
    .from("strategy_keys")
    .select("*", { count: "exact", head: true })
    .eq("strategy_id", fields.strategy_id);
  const isCompositeForAssetClass = (assetClassMemberCount ?? 0) > 0;

  // MT5RECON-02 — resolve the single key's venue so the apiKeyId arm below can
  // stamp 'traditional' for mt5 (forex/CFD) vs 'crypto' for a crypto venue. Owner
  // scope is already enforced (the apiKeyId came off the owner-scoped strategies
  // row above); this admin read only fetches the venue string. On a lookup fault
  // apiKeyExchange stays null — and in that case the update below is SKIPPED
  // (RED-TEAM): create-with-key already stamped a venue-aware asset_class on the
  // draft, and the worker reads strategies.asset_class DIRECTLY as the
  // annualization clock (it does NOT re-derive from venue — see job_worker
  // periods_per_year_for_asset_class(strategies.asset_class)). Defaulting to
  // 'traditional' on a blip would silently mis-annualize a crypto strategy (√252
  // not √365 → inflated Sharpe), so we leave the correct draft stamp untouched.
  let apiKeyExchange: string | null = null;
  // 153.6-04 / PARITY-04 — the SERVER-ATTESTED venue, and the ONLY input the
  // scope-broadening probe gate below is allowed to read.
  //
  // ⛔ IT IS A SEPARATE BINDING FROM `apiKeyExchange`, AND THE SEPARATION IS THE
  // WHOLE FIX. `api_keys.exchange` is client-writable at INSERT — migration
  // 20260810120000 revoked UPDATE and backstopped it with a trigger, but the
  // wizard's own client INSERT path depends on INSERT staying open — so a row can
  // be created carrying a label that CLAIMS the probe exemption. Reading that
  // label made an ASVS V4 control something the client could switch off by
  // asking. `attested_venue` is written only by the two SECURITY DEFINER wizard
  // RPCs and NULLed for every non-privileged INSERT by a BEFORE INSERT trigger.
  let attestedVenue: string | null = null;
  if (apiKeyId) {
    const { data: keyVenueRow, error: keyVenueErr } = await assetClassAdmin
      .from("api_keys")
      // ⚠️ ONE COLUMN ADDED, ZERO EXTRA ROUND TRIPS. The gate must not open a
      // second seam or a second query: this route's fan-out is pinned cross-file
      // by SEAM_ROUTE_BUDGETS, and "the security read" is exactly the kind of
      // extra call that gets added once and never counted.
      .select("exchange, attested_venue")
      .eq("id", apiKeyId)
      .single();
    if (keyVenueErr) {
      console.warn(
        `[strategies/finalize-wizard] asset_class venue resolve failed (non-blocking, defaults √252): ${scrubSeamError(keyVenueErr)}`,
      );
      captureToSentry(keyVenueErr, {
        tags: { op: "finalize-wizard.asset_class_venue_resolve" },
        level: "warning",
      });
    }
    apiKeyExchange =
      typeof keyVenueRow?.exchange === "string" ? keyVenueRow.exchange : null;
    // ⚠️ THE PROBE GATE DOES NOT INHERIT THIS READ'S LENIENCY. The error arm
    // above is non-blocking BY DESIGN for the asset_class stamp — it shrugs and
    // leaves the draft's own venue-aware stamp intact. For the gate, a read that
    // faulted simply attests NOTHING, so `attestedVenue` stays null and
    // `venueSupportsScopeProbe(null)` answers true: the key is PROBED. A control
    // that fails open on a transient DB error is not a control.
    //
    // ⛔ NEVER `?? apiKeyExchange`. A null attestation is a legacy row the
    // backfill has not reached, or a client INSERT the trigger scrubbed — the two
    // states this change exists to cover. Falling back to the forgeable column
    // there would make the whole thing a no-op for every row that has one.
    attestedVenue =
      typeof keyVenueRow?.attested_venue === "string"
        ? keyVenueRow.attested_venue
        : null;
  }
  //
  // RED-TEAM: for a single-key strategy whose venue we FAILED to resolve
  // (apiKeyExchange null after a lookup fault), SKIP the write entirely. The
  // draft already carries create-with-key's venue-aware stamp, and the worker
  // treats strategies.asset_class as the authoritative annualization clock — an
  // overwrite to 'traditional' here would silently mis-annualize a crypto
  // strategy. Only write when we have a confident value (venue resolved, or a
  // composite/CSV path where apiKeyId is absent).
  const skipAssetClassWrite = Boolean(apiKeyId) && apiKeyExchange === null;
  if (skipAssetClassWrite) {
    console.warn(
      "[strategies/finalize-wizard] asset_class venue unresolved for a single-key " +
        "strategy — leaving the draft's venue-aware stamp intact (no √252 overwrite)",
    );
  } else {
    // ⚠️ 153.6-04 / OQ-2 — THIS STAMP DELIBERATELY STILL READS `apiKeyExchange`,
    // the forgeable column, and that is a scoped decision rather than an
    // oversight. PARITY-04's charter is the probe gate; widening it to the
    // money-math stamp is the natural follow-on and is now a ONE-IDENTIFIER
    // change (`apiKeyExchange` → `attestedVenue`) because the attestation
    // mechanism already exists on the read above. It is left for a follow-on
    // because the residual is self-targeted: a forged label here distorts the
    // annualization clock (√365 vs √252) of the forger's OWN strategy, where a
    // forged label on the gate switched off a security control. ⛔ Do not
    // "fix" this in passing — the swap needs its own oracle over the two
    // annualization outcomes, which is not in this plan's tests.
    //
    // ⛔ THE PRAGMA BELOW MUST STAY WITHIN 8 LINES OF THE MUTATION —
    // `audit-coverage.test.ts` scans that window, so prose inserted BETWEEN them
    // silently un-instruments the site (measured: this note, on its first
    // placement). New commentary goes ABOVE this line, never below it.
    //
    // @audit-skip: non-security annualization metadata (√365 crypto / √252
    // traditional) written as part of the already-audited strategy finalization;
    // a dedicated audit event would be noise (mirrors the last_sync_at skip below).
    const { error: assetClassErr } = await supabase
      .from("strategies")
      .update({
        asset_class: apiKeyId
          ? isCryptoExchange(apiKeyExchange)
            ? "crypto"
            : "traditional"
          : isCompositeForAssetClass
            ? "crypto"
            : fields.asset_class,
      })
      .eq("id", fields.strategy_id)
      .eq("user_id", user.id);
    if (assetClassErr) {
      console.warn(
        `[strategies/finalize-wizard] asset_class persist failed (non-blocking): ${scrubSeamError(assetClassErr)}`,
      );
      captureToSentry(assetClassErr, {
        tags: { op: "finalize-wizard.asset_class_persist" },
        level: "warning",
      });
    }
  }

  // Probe runs BEFORE both legacy and unified paths so the
  // scope-broadening defense covers either code path (Phase 19 /
  // Open Question 1 — RETAINED at the thin-adapter layer).
  //
  // WIZFORM-04 — the venue arrives on the SAME read the asset_class stamp issues
  // ~50 lines above, rather than a second lookup. It is `null` when that read
  // faulted, and the helper's gate probes on `null` — same conservative direction
  // `skipAssetClassWrite` takes just above, for the same reason.
  //
  // ⭐ 153.6-04 / PARITY-04 — AND IT IS THE ATTESTED VENUE, NOT `apiKeyExchange`.
  // The two bindings differ precisely on the rows that matter: a key whose
  // client-supplied label claims the exemption reaches here with a null (or
  // contradicting) attestation and is PROBED. See the read above for why there is
  // no fallback between them.
  if (apiKeyId) {
    const probe = await runScopeBroadeningProbe(apiKeyId, attestedVenue);
    if (!probe.ok) return probe.response;
  }

  // ── Composite-first finalize routing ──────────────────────────────
  // Phase 88 / ONB-01, D-LOCKED (CONTEXT 2026-07-10, Option A). The backbone
  // is permanent-on (Phase 106), so the unified single-key arm below always
  // runs and REJECTS composites (COMPOSITE_UNSUPPORTED_UNIFIED, ~:1004). Without this
  // hoist every wizard composite dies at submit with a 409. Branch
  // composite-vs-single-key HERE, ahead of the flag: a strategy with >=1
  // strategy_keys member ALWAYS enqueues stitch_composite (via
  // runLegacyFinalize's after() arm, :776-811) regardless of the backbone
  // flag. Single-key strategies fall through to the EXISTING unified-vs-legacy
  // split byte-unchanged.
  //
  // The hoist engages only for apiKeyId === null. A composite has
  // strategies.api_key_id = NULL (members live in strategy_keys); a strategy
  // with api_key_id SET is definitively single-key (the two are mutually
  // exclusive by construction). Scoping the branch to apiKeyId === null keeps
  // the fail-closed W-4 posture aimed at a POSSIBLE composite (never a known
  // single-key) and leaves every api_key_id-bearing path untouched.
  if (apiKeyId === null) {
    const compositeAdmin = createAdminClient();
    let compositeMemberCountN: number;
    try {
      // compositeMemberCount fails CLOSED (stamps a terminal 'failed' row,
      // then throws) on an unknowable count — never falls open to a single-key
      // dispatch of a possible composite (W-4 / T-88-10).
      compositeMemberCountN = await compositeMemberCount(
        compositeAdmin,
        fields.strategy_id,
      );
    } catch (err) {
      // Fail CLOSED: the terminal 'failed' row is already stamped inside
      // compositeMemberCount. Surface to Sentry and return 503 rather than
      // fall through to the single-key unified/legacy split. Reuses the
      // unified path's COMPOSITE_MEMBERSHIP_UNKNOWN code so the wizard client
      // maps the same retry copy off `code`.
      console.error(
        `[strategies/finalize-wizard] composite membership probe failed: ${scrubSeamError(err)}`,
      );
      captureToSentry(err, {
        tags: {
          surface: "finalize-wizard",
          step: "composite-membership-probe",
        },
        extra: { strategy_id: fields.strategy_id },
      });
      return NextResponse.json(
        {
          code: "COMPOSITE_MEMBERSHIP_UNKNOWN",
          error: "Could not determine composite membership; please retry.",
        },
        { status: 503, headers: NO_STORE_HEADERS },
      );
    }

    if (compositeMemberCountN > 0) {
      // O-1 (T-88-09) — per-member scope-broadening re-probe. The single-key
      // defense above (the apiKeyId probe) only covers strategies.api_key_id,
      // which is NULL for composites, so composite members would otherwise
      // skip the connect→submit broadening defense entirely. Re-probe EACH
      // member key (ordered by seq) BEFORE any enqueue; the first !ok returns
      // the same 403 KEY_SCOPE_BROADENED / 502 KEY_NETWORK_TIMEOUT the
      // single-key path returns. Ownership is already established by the
      // owner-scoped strategy lookup above (:427-432); membership ids are not
      // sensitive, so the admin client is used only to enumerate them.
      //
      // SEAMCORE-10 — the read is CAPPED, and the cap lives on the QUERY. A
      // bound applied inside the loop below would still let the database hand
      // this lambda an arbitrarily long list, and it is the read that the
      // SEAM_ROUTE_BUDGETS declaration has to be able to trust: that table
      // declares `keys-permissions × MAX_COMPOSITE_MEMBERS` for this branch,
      // and the two numbers are pinned to each other cross-file.
      // WIZFORM-04 — the embed carries each member's VENUE, so the same
      // capability gate the single-key arm uses can be applied per member. The
      // shape and the to-one embed idiom are lifted verbatim from
      // `composite/members/route.ts`, which already reads `api_keys ( exchange )`
      // off this table.
      //
      // Gating BOTH call sites is what makes this a CLASS fix. Leaving this one
      // ungated would be the instance fix: correct for the arm someone happened
      // to test, and a live per-member probe demand for a venue that has no
      // answer on the other.
      //
      // ⛔ `.limit(MAX_COMPOSITE_MEMBERS + 1)` below is UNTOUCHED — the +1 is the
      // truncation detector whose arrival IS the refusal, and it is pinned
      // cross-file against SEAM_ROUTE_BUDGETS.
      const { data: members, error: membersErr } = await compositeAdmin
        .from("strategy_keys")
        // 153.6-04 / PARITY-04 — the embed carries the SERVER-ATTESTED venue
        // alongside the client-writable label, and the per-member gate below
        // reads the attestation ONLY.
        //
        // ⚠️ `exchange` STAYS ON THE PROJECTION even though the gate no longer
        // reads it: the widening is ADDITIVE on purpose. The embed's shape is what
        // the 153-review array-drift refusal is written against (`api_keys:
        // [{ exchange }]`), and narrowing the projection in the same edit that
        // moves the gate's authority would change two things at once — one of
        // which nothing tests.
        .select("api_key_id, api_keys ( exchange, attested_venue )")
        .eq("strategy_id", fields.strategy_id)
        .order("seq", { ascending: true })
        // ⚠️ cap + 1, AND THE +1 IS THE WHOLE POINT (ME-02). `.limit(cap)`
        // cannot distinguish "this composite has exactly cap members" from "it
        // has more, and you are holding the first cap of them", so the refusal
        // below had to fire at `>= cap` and the usable maximum was cap - 1 — the
        // constant was off by one from the thing it names, and a user with a
        // genuine 10-member draft got a permanent 503 rendered as "please
        // retry". The extra row is a TRUNCATION DETECTOR and is never probed:
        // its arrival IS the refusal, which happens before the loop. So the
        // fan-out stays capped at `MAX_COMPOSITE_MEMBERS` and
        // `SEAM_ROUTE_BUDGETS`'s `calls: 10` plus SC-4e stay exact.
        .limit(MAX_COMPOSITE_MEMBERS + 1);
      // 153 review — VALIDATED, NOT CAST, AND VALIDATED HERE. The parse runs
      // before the cap arm because a row set we cannot read is not a member
      // list whose LENGTH means anything; `.length` is the only thing the cap
      // arm touches, so it is unaffected either way.
      const memberRowsParsed = compositeMemberRowsSchema.safeParse(
        members ?? [],
      );
      if (membersErr || !memberRowsParsed.success) {
        // A member-list read error also fails CLOSED — never enqueue a
        // composite whose members we could not enumerate to re-probe.
        //
        // 153 review — AND A SHAPE WE CANNOT PARSE IS THE SAME REFUSAL, which
        // is why it lands in THIS arm rather than a new one. Membership we
        // cannot read is membership we cannot re-probe, so it is literally
        // `COMPOSITE_MEMBERSHIP_UNKNOWN`; the alternative was a new code, and
        // a new code needs a new rejection site, which `EXPECTED_FINALIZE_
        // REJECTION_SITES` counts exactly (wizardErrors.invariant.test.ts).
        // Inventing taxonomy to describe an ops-side schema drift is not worth
        // that, so the emit is SHARED and only the operator artefacts fork.
        //
        // ⚠️ THE LOG LINE FORKS AND MUST. The read-failure sentence is asserted
        // verbatim by CR-01's test; a shape drift is a different incident with
        // a different remedy (fix the query/schema, not retry), so it gets its
        // own sentence and its own Sentry `step` — otherwise the one artefact
        // an operator has for a composite that will not finalise points at the
        // wrong cause.
        // ⛔ THE DISCRIMINATOR IS A BOOLEAN, NOT THE ERROR BINDING ITSELF, and
        // that is SEAMCORE-06's rule rather than a style choice: `console.*`
        // arguments may not contain a bare error-shaped identifier, because
        // undici embeds this seam's outgoing `Authorization: Bearer` /
        // `X-Service-Key` / `X-User-Access-Token` headers in `err.message`, and
        // a credential reaches the Vercel log with nothing at the call site
        // that looks wrong. Branching on `membersErr` INSIDE the call — even as
        // a mere truth test — puts that identifier in the argument list and is
        // refused by `seam-log-coverage.test.ts` (measured: it caught exactly
        // this shape here). Hoisting the predicate keeps every logged value
        // provably wrapped in `scrubSeamError`.
        const membershipShapeDrifted = !membersErr && !memberRowsParsed.success;
        const membershipFailure = membershipShapeDrifted
          ? memberRowsParsed.error
          : membersErr;
        console.error(
          membershipShapeDrifted
            ? `[strategies/finalize-wizard] composite member list SHAPE unrecognised (PostgREST drift; the embed is not the to-one object this route reads): ${scrubSeamError(memberRowsParsed.error)}`
            : `[strategies/finalize-wizard] composite member list read failed: ${scrubSeamError(membersErr)}`,
        );
        captureToSentry(membershipFailure, {
          tags: {
            surface: "finalize-wizard",
            step: membershipShapeDrifted
              ? "composite-member-shape"
              : "composite-member-list",
          },
          extra: { strategy_id: fields.strategy_id },
        });
        return NextResponse.json(
          {
            code: "COMPOSITE_MEMBERSHIP_UNKNOWN",
            error: "Could not load composite members; please retry.",
          },
          { status: 503, headers: NO_STORE_HEADERS },
        );
      }
      // SEAMCORE-10 / ME-02 — OVERFLOWING the cap is a REFUSAL. Sitting AT it
      // is not.
      //
      // The read above asks for `MAX_COMPOSITE_MEMBERS + 1` rows, so the two
      // readings `.limit(MAX_COMPOSITE_MEMBERS)` could not tell apart are now
      // distinguishable: exactly `MAX_COMPOSITE_MEMBERS` back means the list is
      // PROVABLY complete, and `MAX_COMPOSITE_MEMBERS + 1` back is proof the
      // draft has more members than this route can probe.
      //
      // Proceeding on a possibly-truncated list would finalise a composite whose
      // remaining member keys were never re-probed — the connect→submit
      // scope-broadening hole the O-1 loop exists to close, reintroduced by a
      // silently short list. That is still refused. What is no longer refused is
      // a legitimate MAX_COMPOSITE_MEMBERS-member draft, which used to get a
      // PERMANENT 503 wearing transient "please retry" copy, with no path
      // forward — and which made every existing composite at or above the cap
      // un-finalizable the moment the cap shipped.
      //
      // `>` rather than `===` on purpose — if the `.limit()` above were ever
      // dropped, this arm still refuses an oversized list rather than fanning
      // out over it.
      if ((members?.length ?? 0) > MAX_COMPOSITE_MEMBERS) {
        // No caught value reaches this line — every interpolated term is an
        // integer or an id this route generated. It goes through the shared
        // scrubber anyway because it is a seam-route log line and this file
        // keeps ONE mechanism for all of them (140.2-08); a future edit that
        // interpolates an error here inherits the redaction instead of
        // reintroducing a leak.
        console.error(
          scrubSeamString(
            `[strategies/finalize-wizard] composite member list EXCEEDED the ` +
              `${MAX_COMPOSITE_MEMBERS}-member cap for strategy ` +
              `${fields.strategy_id} (the cap+1 probe row came back); refusing ` +
              `rather than finalizing a truncated member list with unprobed keys`,
          ),
        );
        captureToSentry(
          new Error("composite member list EXCEEDED MAX_COMPOSITE_MEMBERS"),
          {
            tags: {
              surface: "finalize-wizard",
              step: "composite-member-cap",
            },
            extra: {
              strategy_id: fields.strategy_id,
              max_composite_members: MAX_COMPOSITE_MEMBERS,
            },
          },
        );
        // ✅ 140.3-14 / TS-37 — THE HAND-OVER THIS COMMENT USED TO REQUEST IS
        // DISCHARGED HERE. Until now the envelope was deliberately the existing
        // membership-unknown one, byte-identical to the member-list-read failure
        // above, because phase 140.2 authored no user-facing copy (that fence is
        // 140.3's). The consequence was a PERMANENT condition wearing transient
        // copy: an oversized draft was told "please retry" and handed a Retry
        // control that could only ever fail again.
        //
        // ⚠️ THIS IS ONE ARM OF FOUR, AND THE OTHER THREE DELIBERATELY KEEP
        // `COMPOSITE_MEMBERSHIP_UNKNOWN` AND THEIR RETRY. The membership-count
        // probe (~:817), the member-list read (~:872) and the unified arm's
        // probe (~:1465) are genuine transient reads — the condition really does
        // clear on retry there. Re-coding any of them would strip a correct
        // retry from a real transient fault, which is the inverse of the defect
        // this arm fixes.
        //
        // The operator half was ALREADY distinct and is unchanged: the log line
        // says "EXCEEDED the …-member cap" and the Sentry event above is tagged
        // `step: "composite-member-cap"`. Only the USER half was missing.
        //
        // The status stays 503, unchanged: this plan owns the code and the copy,
        // not the wire status. `SubmitStep` maps off `code` alone (never status),
        // so the permanent/transient distinction is carried entirely by the code.
        //
        // 153.1-05 / D-34 — the SENTENCE IS BYTE-IDENTICAL to what shipped; only
        // where it is built moved. It is held in a local const rather than
        // written inline because the emitter predicate in
        // `wizardErrors.invariant.test.ts` caps the `error:` body at
        // EMITTER_BODY_MAX_CHARS = 160 (measured: the cap must clear the longest
        // real body but stay under the 202-char distance to the next emitter's
        // `status:`, or one emitter's code gets reported against the next one's
        // status). Inline, these three interpolated lines run ~256 characters, so
        // this site — and ONLY this site — stayed invisible to the coverage
        // scanner even after its keys were reordered. Hoisting the sentence makes
        // the site scannable without relaxing a predicate to make a count come
        // out right, which is the one thing that file forbids. Same shape as the
        // `CIRCUIT_OPEN_COPY` emitter above: the scanner constrains the CODE
        // literal, never the error value.
        const compositeCapCopy =
          `This draft has more than ${MAX_COMPOSITE_MEMBERS} keys attached; ` +
          `a multi-key strategy can hold at most ${MAX_COMPOSITE_MEMBERS}. ` +
          `Remove keys until ${MAX_COMPOSITE_MEMBERS} or fewer remain, then submit again.`;
        return NextResponse.json(
          {
            code: "COMPOSITE_TOO_MANY_MEMBERS",
            error: compositeCapCopy,
          },
          { status: 503, headers: NO_STORE_HEADERS },
        );
      }
      // `api_key_id` is a to-one FK into `api_keys`, so PostgREST returns a
      // single embedded object at runtime; the generated types predate this
      // table. A member whose embed comes back `null` yields a `null` venue —
      // and is therefore STILL PROBED, by the same fail-toward rule the
      // single-key arm relies on.
      //
      // 153 review — the rows arrive from `compositeMemberRowsSchema.safeParse`
      // above, so this binding is PROVEN, not asserted. It used to be
      // `(members ?? []) as unknown as Array<…>`: a double cast that silences
      // the compiler and verifies nothing, under which an array-valued embed
      // read back as `undefined` and finalized the composite on member data it
      // never had. The unreadable-shape refusal is the arm above.
      const memberRows = memberRowsParsed.data;
      for (const member of memberRows) {
        const memberKeyId =
          typeof member.api_key_id === "string" ? member.api_key_id : null;
        if (!memberKeyId) continue;
        // 153.6-04 / PARITY-04 — THE ATTESTED VENUE, per member, and never
        // `member.api_keys.exchange`. Gating only the single-key arm on the
        // attestation would be this phase committing its own headline mistake:
        // a fix that landed on the path someone happened to test. An absent
        // embed, an absent attestation field and an explicit `null` all resolve
        // here to `null` ⇒ the member is PROBED. ⛔ No `??` fallback to the
        // client-writable label — see the single-key read for why.
        const memberVenue =
          typeof member.api_keys?.attested_venue === "string"
            ? member.api_keys.attested_venue
            : null;
        const probe = await runScopeBroadeningProbe(memberKeyId, memberVenue);
        if (!probe.ok) return probe.response;
      }
      // Route to the legacy finalize whose after() block enqueues
      // stitch_composite (memberCount re-count + enqueue) — independent of
      // the backbone flag. terminalStatus threads the CONTRIB-02 branch: a
      // composite contribution finalizes 'private' here (no per-source fork —
      // locked decision), a manager composite stays 'pending_review'.
      return await runLegacyFinalize({ supabase, user, fields, terminalStatus });
    }
    // compositeMemberCountN === 0 (CSV / no-member draft with api_key_id NULL)
    // → fall through to the existing unified-vs-legacy split byte-unchanged.
  }

  // CONTRIB-02 (Phase 110) — a single-key API contribution routes through the
  // LEGACY finalize path, NOT the unified arm below. The unified arm delegates to
  // process_key_long, which enqueues analytics but NEVER promotes strategies.status
  // (only strategy_verifications advances — W1 note, 110-01). Routed there, a
  // contribution would never reach status='private'. runLegacyFinalize calls
  // finalize_wizard_strategy with p_terminal_status='private' AND enqueues
  // sync_trades — exactly what a private contribution needs (owner-visible KPIs,
  // no admin review-queue signal). The apiKeyId scope-broadening probe (above) has
  // already run, so the contribution key is re-checked identically to the manager
  // key. Composite contributions were already diverted in the hoist above.
  if (fields.entryContext === "contribution") {
    return await runLegacyFinalize({ supabase, user, fields, terminalStatus });
  }

  // Phase 106 Stage B (D2): single-key finalize now delegates UNCONDITIONALLY
  // to the unified backbone. The former flag-off legacy fall-through
  // (`return await runLegacyFinalize(...)`) was deleted here; the kill-switch
  // reader was deleted in 106-10 (backbone permanent-on).
  // runLegacyFinalize itself STAYS: it is reachable on the composite path via the
  // composite hoist above (:618), where every composite routes through it for
  // the stitch_composite enqueue + founder-email / last_sync_at / sync_trades
  // side-effect fan-out the unified arm does NOT replicate (see :1015 comment).
  //
  // API-8: resolve the actual exchange from the linked api_keys row so we
  // don't hardcode `source: 'okx'` for non-OKX strategies. Falls back to
  // 'okx' when the strategy has no api_key (CSV branch) — the unified
  // router treats source as advisory in that case.
  let resolvedSource = "okx";
  if (apiKeyId) {
    const admin = createAdminClient();
    // audit-2026-05-07 H-0323 — capture the error so a transient admin
    // lookup failure doesn't silently fall back to the 'okx' default
    // and route a Binance/Bybit key through the wrong exchange-specific
    // code path with no forensic trail.
    const { data: keyRow, error: keyRowErr } = await admin
      .from("api_keys")
      .select("exchange")
      .eq("id", apiKeyId)
      .single();
    if (keyRowErr) {
      console.warn(
        `[strategies/finalize-wizard] api_keys.exchange lookup failed; falling back to default source: ${scrubSeamError(keyRowErr)}`,
      );
      // Mirror the H-0322 escalation pattern: console.warn on Vercel is
      // best-effort log capture, not alertable. Without Sentry a transient
      // PG blip silently routes a Binance/Bybit key through the OKX-specific
      // code path with no forensic trail.
      captureToSentry(keyRowErr, {
        tags: {
          surface: "finalize-wizard",
          step: "unified-exchange-resolve",
        },
        extra: { strategy_id: fields.strategy_id, api_key_id: apiKeyId },
      });
    }
    if (keyRow?.exchange) {
      resolvedSource = keyRow.exchange;
    }
  }
  // OWN-03 (Phase 150) — fail LOUD on a mark that cannot land. The capital
  // question is only rendered on the contribution entry, and every
  // contribution routes to runLegacyFinalize above, which is where the mark is
  // written. So a mark arriving HERE means a hand-crafted body or a future
  // drift in the routing — and the unified arm has no mark write, so it would
  // be dropped in silence. Dropping is still SAFE (unwritten = NULL =
  // non-allocatable, and nothing the user was shown is contradicted), so this
  // is not an error arm; but it must not be invisible.
  //
  // ONE RESPONSE CONTRACT ACROSS BOTH ARMS. The legacy arm has emitted
  // `capital_ownership_persisted: false` since 151 specialist F-3 when a mark
  // it was asked for did not land; this arm dropped the mark with only a
  // console.warn and a byte-identical success body, so a client that sent
  // `capital_ownership` and got routed here could not tell "saved" from
  // "discarded" — and SubmitStep's reader (151 review E8) would show plain
  // success. The flag is forwarded below so the ONE `=== false` read on the
  // client covers both arms. Console-only visibility is for US; the sidecar is
  // for the person whose answer was dropped.
  const capitalOwnershipDropped = fields.capitalOwnership !== undefined;
  if (capitalOwnershipDropped) {
    console.warn(
      `[strategies/finalize-wizard] capital_ownership sent on the unified (manager) arm for ` +
        `${fields.strategy_id}; the mark is NOT persisted here and stays NULL. ` +
        `The capital question is a contribution-entry surface only.`,
    );
  }

  return await unifiedFinalizeWizardHandler({
    strategy_id: fields.strategy_id,
    userId: user.id,
    capitalOwnershipDropped,
    // 140.3-14 / TS-33 — read off the owner-scoped draft row above.
    wizardSessionId,
    // NEW-C14-06: forward the validated+normalized `fields` object instead
    // of the raw body. Pre-fix: `payload: body as Record<string,unknown>`
    // bypassed canonicalizeExchangeList + string→number coercion so the
    // unified path persisted un-canonicalized exchanges and raw aum/max_capacity
    // strings. The 400-gate still ran, but normalization drift persisted bad
    // data. Forwarding `fields` ensures both paths (legacy + unified) persist
    // identically.
    payload: {
      strategy_id: fields.strategy_id,
      name: fields.name,
      description: fields.description,
      category_id: fields.category_id,
      strategy_types: fields.strategy_types,
      subtypes: fields.subtypes,
      markets: fields.markets,
      supported_exchanges: fields.supported_exchanges,
      leverage_range: fields.leverage_range,
      aum: fields.aumNum,
      max_capacity: fields.maxCapacityNum,
    },
    apiKeyId,
    source: resolvedSource,
  });
});

/**
 * M-18 — legacy finalize path. Calls the SECURITY DEFINER RPC, schedules the
 * after() side-effect fan-out, and returns the legacy 200 envelope. Pulled
 * out of POST() so the legacy code path is grep-able as `runLegacyFinalize`
 * for the eventual M-9 cleanup.
 */
// DEPRECATED: remove after 2026-05-15 (PR-D + 7d)
async function runLegacyFinalize(args: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  user: User;
  fields: ValidatedPayload;
  // CONTRIB-02 (Phase 110) — the terminal status the RPC writes. Defaults to
  // 'pending_review' (manager flow, byte-identical to pre-phase behavior); the
  // contribution branch passes 'private'. The RPC RAISEs on anything else.
  terminalStatus?: "pending_review" | "private";
}): Promise<NextResponse> {
  const { supabase, user, fields, terminalStatus = "pending_review" } = args;
  // CONTRIB-02: the generated database.types.ts has not been regenerated for the
  // new trailing p_terminal_status parameter (110-01 migration
  // 20260716130500_finalize_terminal_status_param.sql), so the typed .rpc()
  // overload would reject the extra key. Cast through unknown — the single place
  // to delete once the types regeneration lands (mirrors the
  // persist_csv_daily_returns cast in csv-finalize/route.ts). The underlying SQL
  // function accepts nulls for leverage_range, aum, and max_capacity (the
  // wizard's "skip optional metadata" path), so those ride through unchanged.
  const { data: finalizedId, error } = await (
    supabase.rpc as unknown as (
      fn: "finalize_wizard_strategy",
      rpcArgs: Record<string, unknown>,
    ) => Promise<{
      data: string | null;
      error: { code?: string; message?: string } | null;
    }>
  )("finalize_wizard_strategy", {
    p_strategy_id: fields.strategy_id,
    p_user_id: user.id,
    p_name: fields.name,
    p_description: fields.description,
    p_category_id: fields.category_id,
    p_strategy_types: fields.strategy_types,
    p_subtypes: fields.subtypes,
    p_markets: fields.markets,
    p_supported_exchanges: fields.supported_exchanges,
    p_leverage_range: fields.leverage_range,
    p_aum: fields.aumNum,
    p_max_capacity: fields.maxCapacityNum,
    p_terminal_status: terminalStatus,
  });

  if (error) {
    // SEAMCORE-06 — the message is scrubbed; `error.code` is a five-character
    // SQLSTATE from a closed set and is deliberately kept intact, because the
    // branches immediately below key off it and an operator reading the line
    // needs to see the same value the code did.
    console.error(
      "[strategies/finalize-wizard] RPC error:",
      scrubSeamError(error.message),
      error.code,
    );
    if (error.code === "P0002" || error.code === "02000") {
      return NextResponse.json({ code: "GATE_DRAFT_GONE", error: "Draft not found" }, { status: 404, headers: NO_STORE_HEADERS });
    }
    // audit-2026-05-07 H-0321: split the two SQLSTATEs so HTTP semantics
    // match the actual failure mode.
    //   - 42501 (insufficient_privilege) → 403 Forbidden. True RLS /
    //     ownership rejection; reserve 403 for permission denials so
    //     forensic readers can distinguish "user wrong" from "system wrong".
    //   - 22023 (invalid_parameter_value) → 409 Conflict. RPC raises this
    //     when the draft is in a non-finalizable state (already published,
    //     missing fields, stale snapshot). 409 lets the client show a
    //     refresh nudge rather than a "permission denied" sign-out prompt.
    if (error.code === "42501") {
      // H-0192 (red-team follow-up): tag with the route's own discriminator so
      // SubmitStep maps off `code`, not raw HTTP status. Keying off status
      // mislabeled pre-handler 403s (CSRF, approval-gate) as draft-finalize
      // failures and conflated them in the wizard_error funnel.
      return NextResponse.json(
        { code: "GUARD_BLOCKED", error: "This draft cannot be finalized" },
        { status: 403, headers: NO_STORE_HEADERS },
      );
    }
    if (error.code === "22023") {
      return NextResponse.json(
        {
          // 153.1-05 / D-34 — UPPERCASED from `draft_state_invalid`, which is a
          // WIRE change and the only one in this reorder. The lowercase literal
          // could never be seen by the coverage scanner (its class is
          // `[A-Z][A-Z0-9_]*`) and could never be a `WizardErrorCode`, so this
          // 409 rendered the UNKNOWN card — whose copy is RECOVERABLE, so the
          // user was handed a Retry button that re-POSTed an identical request
          // against a draft the DB had already moved past. 153.1-04 minted
          // `DRAFT_STATE_INVALID` with honest, non-recoverable copy for exactly
          // this arm; `KNOWN_FINALIZE_CODES` admits it in this same commit.
          code: "DRAFT_STATE_INVALID",
          error:
            "This draft is not in a finalizable state. Refresh and try again.",
        },
        { status: 409, headers: NO_STORE_HEADERS },
      );
    }
    return NextResponse.json(
      { error: "Could not finalize wizard draft" },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }

  const resolvedId =
    typeof finalizedId === "string" ? finalizedId : fields.strategy_id;

  // ── OWN-03 (Phase 150) — persist the capital mark ────────────────────────
  //
  // A SEPARATE owner-scoped UPDATE, deliberately NOT a 14th argument to
  // finalize_wizard_strategy. Widening that signature means a DROP/CREATE of a
  // SECURITY DEFINER function sitting on the wizard's critical path; a
  // botched deploy there costs every submission, whereas the worst case here
  // costs one metadata field. The 13-arg signature stays byte-untouched.
  //
  // The cost of that choice is real and accepted: this is not atomic with the
  // finalize. If the write fails, the strategy is finalized with a NULL mark
  // — unmarked, therefore non-allocatable, therefore SAFE — and the user can
  // set it from the Mark dialog. It must never be promoted to an error arm:
  // returning a failure here would discard a successful finalize over
  // metadata, and any error code the wizard's roster does not carry renders
  // the useless UNKNOWN card.
  //
  // Both `.eq()` predicates stay — with the justification RE-BASED onto the
  // live policy. This comment used to say "the strategies_update RLS policy has
  // no WITH CHECK clause, so the `user_id` filter is the actual thing standing
  // between this patch and another owner's row". That is FALSE: the
  // `strategies_update` policy was DROPped and recreated with an explicit
  // `WITH CHECK (user_id = auth.uid())` by the sec005 follow-ups migration,
  // whose own verification block RAISEs if that clause is missing. The real
  // ground for keeping the predicates (T-150-10): they keep this UPDATE correct
  // on its own terms if `supabase` here is ever swapped for the admin client
  // this file already constructs elsewhere — where RLS does not apply at all —
  // and the `user_id` filter is what makes the zero-row arm below
  // distinguishable from a successful write.
  // 151 specialist F-3 — the SERVER posture above is sound (never fail the
  // finalize over metadata), but the RESPONSE was a plain success with no
  // signal at all: a user who explicitly answered "my own capital" got the
  // normal success screen while their answer was dropped, and the consequence
  // (a NULL-marked strategy is non-allocatable, so `Allocate…` never appears
  // on the Holdings tab) surfaced days later as an unexplained absence. The
  // documented remedy ("set it from the Mark dialog") is discoverable only by
  // someone who already knows the mark failed. That is user-visible data loss
  // reported to the user as success.
  //
  // The honest minimum: a NON-ERROR sidecar in the 200 body. It is emitted ONLY
  // on failure, so every existing caller's response bytes are unchanged and the
  // never-fail-the-finalize contract is intact — a client that asked for a mark
  // and sees no flag got one.
  let capitalOwnershipPersisted = true;
  if (fields.capitalOwnership !== undefined) {
    // @audit-skip: strategy-level metadata written as part of the already-
    // audited finalization (mirrors the asset_class persist above).
    const { data: markRows, error: markErr } = await supabase
      .from("strategies")
      .update({ capital_ownership: fields.capitalOwnership })
      .eq("id", resolvedId)
      .eq("user_id", user.id)
      .select("id");
    if (markErr) {
      capitalOwnershipPersisted = false;
      console.error(
        `[strategies/finalize-wizard] capital_ownership persist failed for ${resolvedId} ` +
          `(non-blocking; mark stays NULL = non-allocatable): ${scrubSeamError(markErr)}`,
      );
      captureToSentry(markErr, {
        tags: { op: "finalize-wizard.capital_ownership_persist" },
        level: "warning",
        extra: { strategy_id: resolvedId },
      });
    } else if (Array.isArray(markRows) && markRows.length === 0) {
      capitalOwnershipPersisted = false;
      // Zero rows with no error means the id+user_id predicate matched
      // nothing. Different story from a transport failure and a louder one:
      // the finalized row is not the caller's, or is already gone.
      console.error(
        `[strategies/finalize-wizard] capital_ownership write matched NO row for ${resolvedId} ` +
          `(owner predicate excluded it; mark stays NULL)`,
      );
      captureToSentry(
        new Error("finalize-wizard capital_ownership write matched no row"),
        {
          tags: { op: "finalize-wizard.capital_ownership_persist" },
          level: "warning",
          extra: { strategy_id: resolvedId },
        },
      );
    }
  }

  // Both side effects are fire-and-forget: the row is already in
  // pending_review, so failures to notify or touch last_sync_at must
  // not block the response or reverse the finalize.
  after(async () => {
    const admin = createAdminClient();
    // audit-2026-05-07 H-0322 — capture the api_key_id lookup error so a
    // transient Postgres blip doesn't silently drop the last_sync_at
    // touch (Sprint-2 cleanup would then treat the key as abandoned and
    // GC it). Failure here logs to Sentry below; the founder email is
    // independent so it still runs.
    // audit-2026-05-07 H-0331 — fetch `name` from the DB row so the
    // founder email matches what the admin UI shows. The validated form
    // input (fields.name) is the user's intent, but the
    // finalize_wizard_strategy RPC may sanitize/transform it; pulling
    // from the row keeps founder email and admin UI on a single source
    // of truth.
    const [managerName, keyLinkResult] = await Promise.all([
      resolveManagerName(admin, user),
      admin
        .from("strategies")
        .select("api_key_id, name")
        .eq("id", resolvedId)
        .single(),
    ]);
    const { data: keyLink, error: keyLinkErr } = keyLinkResult;
    const canonicalName =
      keyLink && typeof keyLink.name === "string" && keyLink.name.length > 0
        ? keyLink.name
        : fields.name;
    if (keyLinkErr) {
      console.warn(
        `[strategies/finalize-wizard] api_key_id lookup failed in after(): ${scrubSeamError(keyLinkErr)}`,
      );
      captureToSentry(keyLinkErr, {
        tags: {
          surface: "finalize-wizard-after",
          side_effect: "api_key_id_lookup",
        },
        extra: { strategy_id: resolvedId },
      });
    }

    // audit-2026-05-07 G10.E.1: name each side effect so a future grep /
    // Sentry filter can disambiguate. Index-based logging (`side effect 0`)
    // was impossible to triage and didn't reach Sentry — console.warn on
    // Vercel is best-effort log capture, not alertable.
    const sideEffects: Array<{
      label:
        | "notify_founder_new_strategy"
        | "api_keys_last_sync_at_touch"
        | "enqueue_sync_trades_job";
      run: () => Promise<unknown>;
    }> = [
      // CONTRIB-02 (Phase 110) — the admin "new strategy pending review"
      // founder notification is SUPPRESSED for a private contribution: a
      // 'private' row is never a review candidate (the admin publish queue keys
      // on status='pending_review'), so signaling a review would be noise and a
      // false publish cue. Every OTHER side effect (last_sync_at touch + the
      // analytics enqueue) is KEPT — a contribution is a real track record and
      // the allocator needs its KPIs in the composer (locked decision).
      ...(terminalStatus === "private"
        ? []
        : [
            {
              label: "notify_founder_new_strategy" as const,
              run: () => notifyFounderNewStrategy(canonicalName, managerName),
            },
          ]),
      // @audit-skip: denormalization timestamp. api_keys.last_sync_at
      // is a sync-state hint, not a user-visible state change. The
      // user-intent event for this flow is the finalize_wizard_strategy
      // RPC call that promoted the draft to pending_review (which is a
      // stored-procedure call, not a .insert/.update/.delete — not
      // reached by the grep test).
      {
        label: "api_keys_last_sync_at_touch",
        run: async () => {
          if (!keyLink?.api_key_id) return;
          // @audit-skip: denormalization timestamp — see outer comment.
          // (Pragma kept within 8 lines of the .update chain so the
          // audit-coverage grep sees it.)
          await admin
            .from("api_keys")
            .update({ last_sync_at: new Date().toISOString() })
            .eq("id", keyLink.api_key_id);
        },
      },
      // audit-2026-05-07 H-0330 — enqueue the sync_trades compute job so
      // the strategy advances past computation_status='pending'. Pre-fix the
      // wizard finalize path NEVER enqueued; the only enqueue lived in
      // /api/keys/sync behind a manual "Sync now" button. Removing that
      // button on cutover would orphan every new wizard submission.
      //
      // Phase 106 Stage B: the enqueue is now unconditional (the former
      // compute-jobs queue flag gate was retired). The partial unique index
      // on compute_jobs handles double-submit, and the after()
      // Promise.allSettled wrapper means a failed enqueue does not block the
      // 200 response or reverse the finalize.
      {
        label: "enqueue_sync_trades_job",
        run: async () => {
          // Phase 86 (COMP-02) / Finding 6 — composite dispatch. A strategy with
          // one or more strategy_keys members is a MULTI-KEY composite: enqueue
          // `stitch_composite` (the worker fans out over the members, decrypts
          // each key worker-side, clips + stitches). A strategy with zero members
          // is the legacy single-key path → `sync_trades`, byte-identical.
          //
          // Finding 6: composite detection runs REGARDLESS of the (now
          // retired) compute-jobs queue flag. Pre-fix the count probe sat
          // BELOW the flag-off early-return, so a composite created while the
          // queue was off was silently orphaned (no job, no failure stamp).
          // The route reads ONLY a count — it NEVER decrypts
          // (worker-only decryption, LOCKED). resolvedId scoping is unchanged
          // (T-86-14). compositeMemberCount fails CLOSED (stamp + throw) on an
          // unknowable count (W-4 / F3 / F5(b)).
          const memberCount = await compositeMemberCount(admin, resolvedId);
          if (memberCount > 0) {
            // Phase 106 Stage B (D2): the compute-jobs queue is now the sole
            // path — the former flag-off arm (stamp 'failed' + throw when the
            // queue flag was not "true") was deleted; that guard is dormant
            // with the ratified prod pins. Enqueue stitch_composite
            // unconditionally.
            const { error: enqueueErr } = await admin.rpc("enqueue_compute_job", {
              p_strategy_id: resolvedId,
              p_kind: "stitch_composite",
              p_metadata: { source: "finalize-wizard" },
            });
            if (enqueueErr) {
              throw new Error(
                `enqueue_compute_job failed: ${enqueueErr.message}`,
              );
            }
            // Phase 89 — audit the composite dispatch, mirroring the
            // keys/sync composite-first stitch_composite kickoff (in keys/sync/route.ts):
            // a stitch_composite enqueue is a user-initiated sync.start on the
            // strategy, same class + shape as its keys/sync sibling. Idempotent
            // double-submit is absorbed by the compute_jobs partial unique index.
            logAuditEventAsUser(admin, user.id, {
              action: "sync.start",
              entity_type: "sync",
              entity_id: resolvedId,
              metadata: { path: "queue", kind: "stitch_composite" },
            });
            return;
          }
          // Single-key path (zero strategy_keys members). Phase 106 Stage B
          // (D2): the former flag-off early-return (button-driven legacy sync
          // fallback, when the queue flag was not "true") was deleted —
          // dormant with the ratified prod pins. Enqueue sync_trades
          // unconditionally.
          if (!keyLink?.api_key_id) return;
          const { error: enqueueErr } = await admin.rpc(
            "enqueue_compute_job",
            {
              p_strategy_id: resolvedId,
              p_kind: "sync_trades",
              p_metadata: { source: "finalize-wizard" },
            },
          );
          if (enqueueErr) {
            // Throw so Promise.allSettled marks this side effect as
            // rejected and the Sentry capture below picks it up.
            // Backstop: cron/reconcile-strategies re-enqueues stuck
            // computation_status='pending' rows so worst-case latency is
            // ~24h, not "forever". Disabling that cron removes the safety
            // net for this throw.
            throw new Error(
              `enqueue_compute_job failed: ${enqueueErr.message}`,
            );
          }
        },
      },
    ];

    const results = await Promise.allSettled(sideEffects.map((e) => e.run()));
    for (const [i, r] of results.entries()) {
      if (r.status === "rejected") {
        const label = sideEffects[i].label;
        // notify_founder_new_strategy is the ONLY signal a founder gets
        // that a new strategy was submitted. Failure here means the
        // strategy lands in pending_review with nobody told — escalate
        // to Sentry instead of swallowing on stdout. The cosmetic
        // last_sync_at touch goes through the same channel for parity
        // (operators want a single place to read for after()-failures).
        // Phase C simplify — scrub the rejection reason before it lands
        // in Vercel logs. Side-effect errors (notably enqueue_compute_job
        // wrappers) may stringify request init into .message.
        console.warn(
          `[strategies/finalize-wizard] side effect ${label} failed (non-blocking): ${scrubSeamError(r.reason)}`,
        );
        captureToSentry(r.reason, {
          tags: {
            surface: "finalize-wizard-after",
            side_effect: label,
          },
          extra: {
            strategy_id: resolvedId,
            manager_name: managerName,
          },
        });
      }
    }
  });

  // H-0309: uniform `ok: true` success discriminator across the wizard
  // endpoints (create-with-key / keys-sync / finalize-wizard).
  return NextResponse.json(
    {
      ok: true,
      strategy_id: resolvedId,
      // CONTRIB-02 — return the ACTUAL terminal status the RPC wrote ('private'
      // on the contribution branch, 'pending_review' for the manager flow).
      status: terminalStatus,
      // 151 specialist F-3 — present ONLY when the caller asked for a capital
      // mark and it did not land. The finalize still succeeded; this says the
      // ONE metadata field was dropped, so the strategy is unmarked (therefore
      // non-allocatable) and the user must set it from the Mark dialog. Absent
      // ⇒ nothing was lost.
      ...(capitalOwnershipPersisted ? {} : { capital_ownership_persisted: false }),
    },
    { headers: NO_STORE_HEADERS },
  );
}

/**
 * Phase 19 / BACKBONE-01 unified path. Delegates to /process-key with
 * `flow_type=onboard` (finalize step). The force-refresh permissions probe
 * has already run in the caller (Open Question 1 — RETAINED at this layer).
 *
 * ⚠️  Phase C simplify — side-effect parity gap.
 * The legacy `runLegacyFinalize` after() block fans out THREE side
 * effects after the SECURITY DEFINER RPC succeeds:
 *   - `notify_founder_new_strategy` (founder email)
 *   - `api_keys_last_sync_at_touch`  (Sprint-2 GC heartbeat)
 *   - `enqueue_sync_trades_job`      (Round-2 cutover analytics enqueue)
 * The Python unified backbone (analytics-service/routers/process_key.py)
 * only enqueues `process_key_long`. It does NOT fire the founder email,
 * does NOT touch `api_keys.last_sync_at`, and does NOT enqueue
 * `sync_trades`. Routing single-key resync through the unified backbone
 * would silently drop all three — which is why the composite/single-key
 * split above stays.
 *
 * This is an architectural decision (do these live in the Next route or
 * the Python worker?) and is OUT OF SCOPE for /simplify cleanup. The
 * load-bearing comment + Sentry warning below exist so the gap surfaces
 * on the very first unified-path request after cutover instead of
 * silently breaking the founder-notification SLA.
 */
/**
 * Phase 86 (COMP-02) / Finding 6 — composite membership probe shared by the
 * legacy and unified finalize paths. Returns the strategy_keys member count.
 *
 * Fails CLOSED (stamps a terminal 'failed' analytics row so the wizard poller
 * reaches a gate, then throws) when the count is unknowable — a query error, or
 * a null count with NO error (PostgREST can return count===null without
 * erroring; `(count ?? 0) > 0` would fall OPEN to a single-key path). Routing a
 * possible member-bearing composite through a single-key path would silently
 * produce a wrong/partial derivation, and the reconcile cron never re-drives a
 * composite (it filters RECONCILABLE_EXCHANGES / excludes deribit and enqueues
 * reconcile_strategy, not stitch_composite).
 *
 * The route reads ONLY a count — it NEVER decrypts (worker-only decryption LOCKED).
 */
async function compositeMemberCount(
  admin: ReturnType<typeof createAdminClient>,
  strategyId: string,
): Promise<number> {
  const { count, error: countErr } = await admin
    .from("strategy_keys")
    .select("*", { count: "exact", head: true })
    .eq("strategy_id", strategyId);
  if (countErr || count === null) {
    const reason = countErr
      ? `strategy_keys count failed: ${countErr.message}`
      : "strategy_keys count returned null without an error";
    await admin.from("strategy_analytics").upsert(
      {
        strategy_id: strategyId,
        computation_status: "failed",
        computation_warned: false,
        // JOB-01: clear on exit from computing (reaper key — migration 20260802120000)
        computing_started_at: null,
        computation_error:
          "Could not determine composite membership " +
          "(strategy_keys count unavailable). Please retry submission.",
        // Finding 10: membership is UNKNOWN here (the count query failed) — do NOT
        // assert `composite: true`, which claims a fact we could not establish.
        // An honest `membership_unknown` reason avoids mislabeling a single-key
        // strategy as a composite in the DQ flags.
        data_quality_flags: { csv_source: true, membership_unknown: true },
      },
      { onConflict: "strategy_id" },
    );
    throw new Error(reason);
  }
  return count;
}

async function unifiedFinalizeWizardHandler(args: {
  strategy_id: string;
  userId: string;
  /**
   * 140.3-14 / TS-33 — the draft's persisted wizard session id, or `null` when
   * the draft carries none. Forwarded into the `postProcessKey` context, which
   * is the ONE place `/process-key` reads it from; `null` is forwarded as
   * absence, never as a synthesised id.
   */
  wizardSessionId: string | null;
  /**
   * OWN-03 — TRUE when the caller asked for a `capital_ownership` mark. This
   * arm has no mark write, so asking for one here IS a drop, and the two 200
   * bodies below carry the same `capital_ownership_persisted: false` sidecar
   * the legacy arm emits on a failed persist. One contract, both arms: the
   * client's single `=== false` read (SubmitStep) never has to know which arm
   * answered.
   */
  capitalOwnershipDropped: boolean;
  payload: Record<string, unknown>;
  apiKeyId: string | null;
  source: string;
}): Promise<NextResponse> {
  // Finding 6: the unified backbone delegates to process_key_long — a SINGLE-KEY
  // derive that cannot honestly reconstruct a multi-key composite. Composite
  // dispatch (stitch_composite) is wired only through the legacy finalize path
  // this phase, so a member-bearing composite reaching the unified path would be
  // silently orphaned (process_key_long enqueued, stitch_composite never). Fail
  // LOUD at finalize (never silently create a composite that never derives):
  // stamp a terminal 'failed' and reject rather than route through process_key_long.
  // (Full composite support under the unified backbone is Phase 88's wizard work.)
  const compositeAdmin = createAdminClient();
  let compositeMembers: number;
  try {
    compositeMembers = await compositeMemberCount(compositeAdmin, args.strategy_id);
  } catch (err) {
    // fail-closed (unknowable membership): the failed row is already stamped.
    captureToSentry(err, {
      tags: { surface: "finalize-wizard", step: "unified-composite-probe" },
      extra: { strategy_id: args.strategy_id },
    });
    return NextResponse.json(
      {
        code: "COMPOSITE_MEMBERSHIP_UNKNOWN",
        error: "Could not determine composite membership; please retry.",
      },
      { status: 503, headers: NO_STORE_HEADERS },
    );
  }
  if (compositeMembers > 0) {
    await compositeAdmin.from("strategy_analytics").upsert(
      {
        strategy_id: args.strategy_id,
        computation_status: "failed",
        computation_warned: false,
        // JOB-01: clear on exit from computing (reaper key — migration 20260802120000)
        computing_started_at: null,
        computation_error:
          "Composite (multi-key) strategies are not yet supported on the " +
          "unified-backbone finalize path. Contact support.",
        data_quality_flags: { csv_source: true, composite: true },
      },
      { onConflict: "strategy_id" },
    );
    return NextResponse.json(
      {
        code: "COMPOSITE_UNSUPPORTED_UNIFIED",
        error:
          "Composite (multi-key) strategies are not yet supported on this path.",
      },
      { status: 409, headers: NO_STORE_HEADERS },
    );
  }

  const result = await postProcessKey({
    flow_type: "onboard",
    // API-8: actual exchange resolved from api_keys.exchange (or 'okx' for
    // CSV-only strategies). The unified router still server-side resolves
    // from strategies.api_keys.exchange when the linkage is present, but
    // forwarding the resolved value here keeps the contract honest.
    source: args.source,
    context: {
      ...args.payload,
      strategy_id: args.strategy_id,
      user_id: args.userId,
      api_key_id: args.apiKeyId,
      // 140.3-14 / TS-33 — ONE field, in the SAME place and the SAME shape the
      // CSV routes already use (`csv-validate` and `csv-finalize` both put
      // `wizard_session_id` in this context object, and `process_key.py` reads
      // it from exactly here). Until now `finalize-wizard` sent no id, so
      // Python's `idempotent_by_session` was FALSE on every onboard/resync and
      // the dedupe mechanism — which exists and works on the CSV path — was
      // unreachable from this route. A duplicate submit therefore created a
      // second verification row and a second job.
      //
      // ⚠️ SPREAD ORDER IS LOAD-BEARING. This sits AFTER `...args.payload`, so
      // it cannot be shadowed by a same-named key arriving from the validated
      // client fields — the same discipline `strategy_id` / `user_id` above
      // already rely on.
      //
      // Conditional spread, not `wizard_session_id: x ?? undefined`: the key is
      // ABSENT rather than present-and-undefined when the draft carries no id,
      // so the JSON body matches the pre-140.3-14 body exactly on that path.
      ...(args.wizardSessionId !== null
        ? { wizard_session_id: args.wizardSessionId }
        : {}),
      step: "finalize",
    },
    routeTag: "strategies/finalize-wizard",
    // CT-4 (army2) — forward tenant id for cross-tenant rate-limit isolation.
    userId: args.userId,
  });
  if (!result.ok) return result.response;

  // API-9: translate the unified `{queued, verification_id}` shape back to the
  // legacy `{strategy_id, status:'pending_review'}` shape that wizard chrome
  // and downstream callers read off `body.strategy_id`. Preserve
  // `verification_id` + `queued` as additive fields for callers that want them.
  //
  // CT-5 (army2) — also preserve `code` and `idempotent` when upstream
  // returns the WIZARD_DUPLICATE envelope. Pre-fix the translation
  // stripped both fields, so SubmitStep.tsx never rendered the
  // wizardErrors WIZARD_DUPLICATE copy on the idempotent-resume path.
  //
  // audit-2026-05-07 H-0327 — narrow the upstream body with a local type
  // guard so each field's type is statically verified at the read site
  // instead of probing an opaque `Record<string, unknown>`. A backbone-
  // side rename of `verification_id` / `queued` now surfaces here as a
  // missing branch, not as a silent null/false fallback.
  // CONTRIB-02 (Phase 110) — the two `status: "pending_review"` literals below
  // are correct and NOT a missed branch: contributions are diverted to
  // runLegacyFinalize in the POST handler BEFORE this unified arm, so
  // unifiedFinalizeWizardHandler is reached ONLY by the manager flow. The unified
  // backbone (process_key_long) never writes a 'private' terminal status, so
  // there is no terminalStatus to thread here — this arm always terminates
  // 'pending_review' by construction.
  const upstream = result.body;
  // OWN-03 — the dropped-mark sidecar, spelled ONCE and spread into both 200
  // arms. Emitted ONLY when the caller asked for a mark, so every existing
  // caller's response bytes are unchanged; absent still means nothing was lost.
  const markSidecar = args.capitalOwnershipDropped
    ? { capital_ownership_persisted: false as const }
    : {};
  if (isProcessKeyOnboardResponse(upstream)) {
    if (upstream.queued) {
      return NextResponse.json(
        {
          ok: true,
          strategy_id: args.strategy_id,
          status: "pending_review",
          verification_id: upstream.verification_id,
          queued: true,
          ...markSidecar,
        },
        { headers: NO_STORE_HEADERS },
      );
    }
    // queued=false discriminant — duplicate / dedup-hit envelope.
    return NextResponse.json(
      {
        ok: true,
        strategy_id: args.strategy_id,
        status: "pending_review",
        verification_id: upstream.verification_id ?? null,
        queued: false,
        code: upstream.code,
        ...(upstream.idempotent === true ? { idempotent: true } : {}),
        ...markSidecar,
      },
      { headers: NO_STORE_HEADERS },
    );
  }
  // Phase B simplify — H-0327 follow-up. The guard miss means the upstream
  // /process-key returned a 2xx body whose shape doesn't match the onboard
  // contract (rename, partial deploy, AI gateway shape drift, proxy strip).
  // Returning `upstream ?? {}` with 200 would leave wizard chrome reading
  // `body.strategy_id === undefined` and showing "success" with no draft to
  // advance — the exact silent failure the guard exists to prevent. Surface
  // via Sentry and a 502 so the contract drift is alertable.
  console.error(
    "[strategies/finalize-wizard] unified upstream returned unrecognized shape",
    {
      keys:
        upstream && typeof upstream === "object"
          ? Object.keys(upstream as Record<string, unknown>)
          : null,
    },
  );
  captureToSentry(new Error("process-key onboard contract violation"), {
    tags: {
      surface: "finalize-wizard",
      step: "unified-response-parse",
    },
    extra: {
      strategy_id: args.strategy_id,
      upstream_keys:
        upstream && typeof upstream === "object"
          ? Object.keys(upstream as Record<string, unknown>)
          : null,
    },
  });
  return NextResponse.json(
    { error: "Upstream service returned unexpected response" },
    { status: 502, headers: NO_STORE_HEADERS },
  );
}
