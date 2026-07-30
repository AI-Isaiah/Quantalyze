import { NextRequest, NextResponse } from "next/server";
import { unstable_cache } from "next/cache";
import { withAuth } from "@/lib/api/withAuth";
import { createClient } from "@/lib/supabase/server";
import { userActionLimiter, checkLimit, rateLimitDenyJson } from "@/lib/ratelimit";
import { logAuditEvent } from "@/lib/audit";
import { NO_STORE_HEADERS } from "@/lib/api/headers";
import { resilientFetch } from "@/lib/resilient-fetch";
// 140.3-01 / TS-05 — the ONE seam-envelope discriminator (140.2-06).
import { seamErrorCode, seamHumanMessage } from "@/lib/seam-discriminator";
// 140.3-03 / SEAMUX-07 — the publish gate's contract, DERIVED from the same
// LivePermissionsSchema the wizard's probe parses. Do not re-declare it here.
import {
  KeyPermissionsPayloadSchema,
  type KeyPermissionsPayload,
} from "@/lib/analytics-schemas";
import { CircuitOpenError, SeamBodyReadError } from "@/lib/seam-errors";
import { CIRCUIT_OPEN_COPY } from "@/lib/seam-copy";
// 140.3-09 / TS-34 — the ONE `Retry-After` parser. It handles the RFC 9110
// HTTP-date form and never returns NaN/0/<0, so a hostile or proxy-rewritten
// header cannot manufacture a bogus wait. Never add a second parser here.
import { parseRetryAfterSeconds } from "@/lib/retry";
import { scrubSeamError } from "@/lib/seam-redaction";
// 140.3-13a / SEAMUX-08 — the ONE lazy-Sentry helper, applied under the SINGLE
// capture policy written out in full in `src/app/api/admin/match/eval/route.ts`.
// ⚠️ The caught value is passed to it UNMODIFIED even though this file already
// imports `scrubSeamError` for its console lines: `captureToSentry` scrubs at
// the chokepoint (SEAMCORE-06), and pre-scrubbing would hand Sentry a string
// instead of an Error, destroying grouping and the stack.
import { captureToSentry } from "@/lib/sentry-capture";
import type { User } from "@supabase/supabase-js";

/**
 * GET /api/keys/[id]/permissions — live exchange-key scope viewer.
 *
 * Sprint 5 Task 5.8 — Live Key Permission Viewer.
 *
 * Returns the live `{read, trade, withdraw}` scope triple for the requested
 * api_keys row, by proxying to the Python service's
 * `POST /internal/keys/{key_id}/permissions` (VPC-only, X-Internal-Token).
 *
 * Two cache layers stack here:
 *   1. Python in-memory TTL cache — 15 minutes per (api_key_id, exchange_id),
 *      configurable via KEY_PERMISSION_CACHE_TTL.
 *   2. This Next layer — the `revalidate` window on the `unstable_cache` call
 *      in `makeCachedFetcher` below (the ONE place that number lives; see
 *      the note there for why it is not restated in prose). Conservative
 *      because the Python tier already absorbs the longer cool-down; this
 *      Next layer just collapses concurrent in-flight requests / refresh
 *      bursts so we don't flood the internal endpoint per render pass.
 *
 * Ownership: a SELECT against api_keys verifies the key belongs to the caller
 * BEFORE we proxy to Python. Returns 403 on mismatch / 404 on unknown key.
 *
 * Phase 140 / SEAM-01: the upstream call is the THIRD Railway seam. It used to
 * be a raw fetch with its own base URL and its own duplicated 15s deadline —
 * one of two verbatim copies, the other in finalize-wizard's force-refresh
 * probe. Both now route through the shared resilience core, which owns the base
 * URL, the `keys-permissions` budget and the `breaker:railway` circuit.
 */

/**
 * Vercel function ceiling for this route. Declared rather than inherited so the
 * SC-4 headroom invariant has an in-repo source of truth: the seam-budget
 * invariant test reads this export from disk and fails if it drifts from
 * `SEAM_ROUTE_BUDGETS`. The value matches the platform default verified against
 * the live project settings in 140-01, so pinning it raises nothing.
 */
export const maxDuration = 300;

/**
 * 140.3-03 / SEAMUX-07 — the payload shape is no longer declared here.
 *
 * It used to be a route-local `interface` and the upstream body was cast to it
 * with an unchecked assertion, which verifies nothing at runtime. The shape now
 * comes from `KeyPermissionsPayloadSchema`, which DERIVES from the same
 * `LivePermissionsSchema` the wizard's publish gate parses — one definition of
 * the three boolean scopes across both members of this class, so they cannot
 * drift apart again.
 *
 * `probe_error` survives the move and is still forwarded. It is true when the
 * Python service caught an exchange-side exception and returned its fail-CLOSED
 * default; the field used to be silently stripped here because the interface
 * omitted it, which made `KeyPermissionBadge` render "No read permission
 * detected — the key may have been revoked" whenever the exchange API was
 * merely down. Forwarding it lets the badge distinguish "exchange down" from
 * "key actually revoked".
 *
 * The imported `KeyPermissionsPayload` is used directly at both call sites
 * below rather than re-aliased to a route-local name — a second name for one
 * concept is how the two members of this class drifted in the first place.
 */

/**
 * 140.3-09 / TS-34 — the throttle evidence carried out of the cached callback.
 *
 * `makeCachedFetcher`'s failure path can only communicate with the handler's
 * catch by THROWING (see the notes on the callback below — an error returned as
 * a value would be memoized for 60s). So the two facts the handler needs to
 * answer a throttle correctly, and which a stringified `Error.message` destroys,
 * ride on the thrown error's `cause`:
 *
 *   - `status` — the UPSTREAM status. This is what disambiguates the two
 *     vocabularies `140.3-05` recorded as an open residual: the wire code
 *     `RATE_LIMITED` means OUR limiter in the app-global contract (429) and
 *     means the VENUE throttling us in the venue-transient contract (400).
 *     Reading the status settles it without guessing.
 *   - `retryAfterSeconds` — the wait the upstream advertised, in SECONDS,
 *     through the ONE parser. `null` when the upstream advertised none, and
 *     that stays `undefined` here: absence must never become a fabricated wait.
 *
 * `code` is what `140.3-01` already put here and is preserved unchanged.
 */
interface SeamFailureCause {
  code?: string;
  status: number;
  retryAfterSeconds?: number;
}

/**
 * Build the `cause` for a seam failure, or `undefined` when there is nothing
 * worth carrying.
 *
 * The `undefined` case is LOAD-BEARING and inherited from `140.3-01`: attaching
 * a cause changes what `console.error` prints for the failure, so a body that
 * carried no machine code, no advertised wait and no throttle status must leave
 * those operator log lines byte-identical to their pre-plan form. `140.3-09`
 * widens the condition from "a code arrived" to "a code, a wait, or a throttle
 * status arrived" — each of those is real new evidence about the failure.
 */
function buildSeamFailureCause(
  status: number,
  code: string | null,
  retryAfterSeconds: number | null,
): { cause: SeamFailureCause } | undefined {
  if (code === null && retryAfterSeconds === null && status !== 429) {
    return undefined;
  }
  return {
    cause: {
      ...(code === null ? {} : { code }),
      status,
      ...(retryAfterSeconds === null ? {} : { retryAfterSeconds }),
    },
  };
}

/**
 * Read the throttle evidence back off a caught value. Defensive on every hop —
 * this runs inside a catch block, where a second throw would surface as an
 * unhandled 500 rather than a classified response.
 */
function readSeamFailureCause(err: unknown): SeamFailureCause | null {
  const cause = (err as { cause?: unknown } | null | undefined)?.cause;
  if (typeof cause !== "object" || cause === null) return null;
  const { status, code, retryAfterSeconds } = cause as Record<string, unknown>;
  if (typeof status !== "number") return null;
  return {
    status,
    code: typeof code === "string" ? code : undefined,
    retryAfterSeconds:
      typeof retryAfterSeconds === "number" ? retryAfterSeconds : undefined,
  };
}

/**
 * Fetch the live permission triple from the Python service. Wrapped in
 * unstable_cache so concurrent callers + repeat hits inside the `revalidate`
 * window configured on the `unstable_cache` options below collapse to a single
 * upstream request.
 *
 * (140.5-04) This sentence used to name a FIVE-MINUTE window. That was a 5x
 * overstatement of the `revalidate` value set below — and it contradicted this
 * file's own header, which describes the same Next layer correctly. One file
 * disagreeing with itself about one constant is exactly what a derived
 * reference prevents, so the duration now has a single home (the `revalidate`
 * option) and this sentence points at it rather than restating it. Restating it
 * as "60 seconds" would recreate the class on the next tuning edit: never write
 * an integer or a duration in prose that a reader can derive from the code
 * beside it.
 *
 * The cache tag/key array includes the keyId so a future invalidation hook
 * (e.g., on key rotation) can call revalidateTag.
 *
 * M-0325: a real exchange-credential DECRYPT happens ONLY when the cached body
 * actually runs (i.e. a cache MISS — the only path that POSTs to Python). This
 * factory is called per request, so `didDecrypt` is a request-local flag: it
 * flips true iff THIS request's call ran the body, and stays false when
 * unstable_cache replays a memoized value (cache HIT, no decrypt). The handler
 * reads `wasFreshDecrypt()` to tag the audit row exactly — no wall-clock
 * heuristic, no sub-second-burst misclassification, no stamp-less edge case.
 * This also stays correct on unstable_cache's stale-revalidation path: when a
 * stale entry triggers a background revalidation, the body reruns (a real
 * decrypt) and `didDecrypt` flips on its first synchronous statement — before
 * the first await — so a served-stale response is still correctly counted as a
 * decrypt, not a cache hit.
 */
function makeCachedFetcher(keyId: string): {
  fetchPermissions: () => Promise<KeyPermissionsPayload>;
  wasFreshDecrypt: () => boolean;
} {
  let didDecrypt = false;
  const fetchPermissions = unstable_cache(
    async (): Promise<KeyPermissionsPayload> => {
      didDecrypt = true; // runs only on a cache MISS
      const internalToken = process.env.INTERNAL_API_TOKEN;
      if (!internalToken) {
        throw new Error(
          "INTERNAL_API_TOKEN is not configured on the Next layer.",
        );
      }

      // Phase 140 / SEAM-01 + SEAM-03. Two properties of running the seam call
      // from HERE — inside the cached callback — are deliberate:
      //
      //  1. A cache HIT never consults the breaker. The short-circuit exists to
      //     spare a dying Railway; a hit crosses nothing, so reading breaker
      //     state on it would be pure latency (and one more Redis round-trip
      //     per render pass on the wizard's busiest badge).
      //  2. On a MISS the core's CircuitOpenError is THROWN out of this
      //     callback, never returned as a value. The fork awaits the callback
      //     and writes the cache entry only after it RESOLVES, so a throw
      //     leaves no entry (verified against the real boundary in
      //     route.seam.test.ts, not assumed). That is load-bearing: this layer
      //     caches for 60s while the breaker's cooldown is 30s, so an error
      //     returned as a VALUE would keep answering 503 for half a minute
      //     after Railway had already recovered — the mitigation would have
      //     become the outage (T-140-32). The thrown error reaches the
      //     handler's catch below with its prototype intact, which is what
      //     makes the `instanceof` branch there work.
      const res = await resilientFetch(
        "keys-permissions",
        `/internal/keys/${encodeURIComponent(keyId)}/permissions`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Internal-Token": internalToken,
          },
          // No body needed — key_id is in the path. No signal either: the core
          // owns the deadline (SEAM_BUDGETS["keys-permissions"]).
        },
      );

      if (!res.ok) {
        const contentType = res.headers.get("content-type") ?? "";
        if (contentType.includes("application/json")) {
          // TWO CASES, conflated before SEAMCORE-02. A body that is genuinely
          // absent or unparseable keeps the fallback. An ABORT must not become
          // a fabricated `{ detail: statusText }`: the core has already
          // recorded that failure, so the typed error is allowed through to the
          // handler's catch — see the propagation note below.
          const err = await res.json().catch((readErr: unknown) => {
            if (readErr instanceof SeamBodyReadError) throw readErr;
            return { detail: res.statusText };
          });
          // 140.3-01 / TS-05 — read BOTH halves through the ONE discriminator.
          //
          // This route's upstream nests the envelope at `body.detail` on every
          // deliberate 4xx/5xx, so the previous `err.detail ??` read built
          // `new Error(<object>)` and the message coerced to "[object Object]"
          // — STATUS_CONTRACT.md §2.1 records that against this exact line, and
          // PYAPIFIX2-03 added this route's own per-key 429 throttle to the
          // object-detail set. The app-global 422/429 shapes carry a SCALAR
          // `detail`, which the same leaf returns unchanged; TS-07 is a
          // NEGATIVE obligation and that path is deliberately untouched.
          //
          // The `Upstream ${res.status}` fallback is LOAD-BEARING: the catch
          // below keys `PROBE_BACKEND_UNAVAILABLE` on `startsWith("Upstream 5")`.
          //
          // The machine code is carried on `cause` so the handler reads it
          // instead of re-extracting, and so the operator can see WHICH
          // contract answered.
          //
          // 140.3-09 / TS-34 — TWO MORE FACTS RIDE ALONGSIDE IT. The upstream
          // STATUS and the upstream `Retry-After` are both destroyed by the
          // stringify-to-message hop, and both are exactly what a throttle
          // needs: the status tells our own vocabularies apart (140.3-05's
          // recorded residual), and the wait is the value the whole of
          // SEAMUX-06 is about. Read through the ONE parser — never
          // `Number(header)`, which is NaN for the HTTP-date form.
          const seamCode = seamErrorCode(err);
          throw new Error(
            seamHumanMessage(err) ?? `Upstream ${res.status}`,
            buildSeamFailureCause(
              res.status,
              seamCode,
              parseRetryAfterSeconds(res.headers),
            ),
          );
        }
        // A non-JSON failure body — an edge/WAF/proxy page rather than our own
        // service. It carries no machine code, but a 429 from that layer is
        // still a real throttle and its `Retry-After` is still real, so the
        // same evidence is carried here rather than only on the JSON path.
        throw new Error(
          `Upstream ${res.status}`,
          buildSeamFailureCause(
            res.status,
            null,
            parseRetryAfterSeconds(res.headers),
          ),
        );
      }

      // 3. A body-read failure PROPAGATES out of this callback, deliberately.
      //    `res.json()` is now the core's instrumented read: it records the
      //    breaker failure and throws `SeamBodyReadError`. That throw is the
      //    DESIRED behaviour here for exactly the reason stated in 2 above —
      //    the fork writes no cache entry for a callback that rejected, so a
      //    503-shaped failure cannot outlive the 30s breaker cooldown by
      //    sitting in a 60s cache. The handler's catch below classifies it;
      //    it needs no new arm, because the message-sniffing classifier's
      //    generic `PROBE_FAILED` 502 is the correct answer for it and no new
      //    user-facing copy belongs in this plan.
      //
      // 140.3-03 / SEAMUX-07 — THE UNCHECKED CAST IS GONE (the type name it
      // asserted is deliberately not spelled out: the acceptance grep proving
      // the cast is gone would otherwise match this very comment).
      //
      // A cast verifies nothing at runtime, so a 2xx `{}` reached
      // `KeyPermissionBadge` as `{read: undefined, trade: undefined, withdraw:
      // undefined}` and rendered as a CONFIDENT read-only verdict about a
      // money-bearing key whose scopes were in fact unknown. The wizard's
      // publish gate read the same upstream through the same defect
      // (`strategies/finalize-wizard`); ONE schema and ONE fail-closed posture
      // now cover both members.
      //
      // WHY A THROW RATHER THAN A RETURNED ERROR VALUE — this is the property
      // that makes this member worse than its sibling. The fork writes the
      // cache entry only after the callback RESOLVES (see note 2 above), so a
      // throw leaves NO entry, while an error returned as a VALUE would be
      // memoized: an unvalidated scope verdict replayed for 60 seconds to
      // callers that never saw the body, surviving the request that produced
      // it. Asserted behaviourally — a second call after a rejection must
      // re-hit the upstream.
      //
      // The message is diagnostics-only and deliberately matches NONE of the
      // handler's classifier substrings (`INTERNAL_API_TOKEN`, `Upstream 5`,
      // `ECONNREFUSED`, `aborted`, `timeout`), so it lands on
      // the route's existing generic `PROBE_FAILED` 502 — the same
      // probe-failure envelope this route already returns. No new copy.
      const parsed = KeyPermissionsPayloadSchema.safeParse(await res.json());
      if (!parsed.success) {
        throw new Error(
          `permissions payload failed schema validation (fields: ` +
            `${parsed.error.issues
              .map(
                (issue) => `${issue.path.join(".") || "<root>"}:${issue.code}`,
              )
              .join(", ")})`,
        );
      }
      return parsed.data;
    },
    [`key-permissions:${keyId}`],
    { revalidate: 60, tags: [`key-permissions:${keyId}`] },
  );
  return { fetchPermissions, wasFreshDecrypt: () => didDecrypt };
}

export const GET = withAuth(
  async (req: NextRequest, user: User): Promise<NextResponse> => {
    // Extract :id from the URL path. Next 16 prefers searching the URL over
    // a `params` arg in this old route helper; we keep this compatible by
    // parsing the segment directly.
    const segments = new URL(req.url).pathname.split("/");
    const keyId = segments[segments.indexOf("keys") + 1];
    if (!keyId) {
      return NextResponse.json({ error: "Missing key id" }, { status: 400, headers: NO_STORE_HEADERS });
    }

    // Per-user rate limit on this route as well — defense in depth on top
    // of the Python per-key bucket. A malicious authed user shouldn't be
    // able to grind requests through the Next layer.
    const rl = await checkLimit(userActionLimiter, `key-perms:${user.id}`);
    if (!rl.success) {
      // 140.4-13 / SEAMRIM-05 — deny through the chokepoint so a limiter
      // misconfiguration answers 503. The 429 body is the builder's default,
      // byte-identical to what was inlined here; NO_STORE_HEADERS is kept.
      return rateLimitDenyJson(rl, { headers: NO_STORE_HEADERS });
    }

    // Ownership check — reads via the user-scoped client so RLS applies.
    const supabase = await createClient();
    const { data: keyRow, error: keyErr } = await supabase
      .from("api_keys")
      .select("id, user_id")
      .eq("id", keyId)
      .maybeSingle();

    if (keyErr) {
      return NextResponse.json({ error: "Lookup failed" }, { status: 500, headers: NO_STORE_HEADERS });
    }
    if (!keyRow) {
      return NextResponse.json({ error: "Key not found" }, { status: 404, headers: NO_STORE_HEADERS });
    }
    if (keyRow.user_id !== user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403, headers: NO_STORE_HEADERS });
    }

    try {
      const { fetchPermissions, wasFreshDecrypt } = makeCachedFetcher(keyId);
      const payload = await fetchPermissions();

      // Sprint 6 Task 7.1a — audit the decrypt event. M-0325: a real
      // exchange-credential DECRYPT only happens on a cache MISS (the fetcher
      // body actually POSTs to the Python service; see migration 052 header).
      // The 60s Next-layer cache + the Python 15-min cache mean most probes
      // inside that window decrypt NOTHING. Tag the audit row with whether THIS
      // request triggered a decrypt — exactly, via the request-local
      // `wasFreshDecrypt()` flag — so forensic "count decrypt events for key X"
      // stops over-counting by the cache-hit ratio. Fire-and-forget; does not
      // affect response latency or success.
      const cacheHit = !wasFreshDecrypt();
      logAuditEvent(supabase, {
        action: "api_key.decrypt",
        entity_type: "api_key",
        entity_id: keyId,
        metadata: {
          route: "/api/keys/[id]/permissions",
          cache_hit: cacheHit,
        },
      });

      return NextResponse.json(payload, { headers: NO_STORE_HEADERS });
    } catch (err) {
      // ORDER IS LOAD-BEARING: CircuitOpenError FIRST. The message-sniffing
      // classifier below matches none of its (static) text, so a breaker trip
      // would otherwise be reported as a generic PROBE_FAILED 502 — and the
      // caller would never see the Retry-After hint that makes it actionable.
      // The class comes from the never-mocked `@/lib/seam-errors` leaf, so this
      // `instanceof` holds under every mock shape in the suite.
      if (err instanceof CircuitOpenError) {
        console.error(
          `[keys/permissions] short-circuited for ${keyId} — the analytics circuit is open (retry_after_s=${err.retryAfterS})`,
        );
        return NextResponse.json(
          { error: CIRCUIT_OPEN_COPY, code: "CIRCUIT_OPEN" },
          {
            status: 503,
            headers: {
              ...NO_STORE_HEADERS,
              "Retry-After": String(err.retryAfterS),
            },
          },
        );
      }

      // ─────────────────────────────────────────────────────────────────────
      // 140.3-09 / TS-34 / SEAMUX-06 — THE THROTTLE ARM.
      //
      // Position is load-bearing in both directions, for the same reasons the
      // shared `classifyKeyValidationError` gives for its own middle branch:
      //   - BELOW the `CircuitOpenError` type check above. A breaker trip
      //     carries no upstream body, and the breaker verdict must never be
      //     decided by anything an upstream can set.
      //   - ABOVE the substring cascade below. A `429` upstream body whose
      //     human sentence happens to contain "timeout" would otherwise be
      //     reported as OUR probe timing out.
      //
      // WHAT WAS WRONG. The upstream's own per-key 429 throttle (PYAPIFIX2-03)
      // was flattened into an `Error.message`, matched NONE of the cascade's
      // six substrings, and came out as `PROBE_FAILED` + a hardcoded 502 with
      // the upstream's `Retry-After` discarded. A one-minute throttle read to
      // the user as an indefinite fault on OUR side, with no wait and nothing
      // to act on. The status is the repudiation: 502 says "the upstream is
      // broken", 429 says "you are being throttled and here is for how long".
      //
      // THE GATE IS THE UPSTREAM STATUS, NOT THE WIRE CODE. `140.3-05` recorded
      // the reason as an open residual: the code `RATE_LIMITED` lives in TWO
      // vocabularies and means different things in each, and telling them apart
      // needs the status the classifier discards. 429 is unambiguous, it needs
      // no lookup table, and it is also the only evidence available when the
      // 429 came from an edge/WAF layer with no JSON body at all.
      //
      // THE WAIT IS FORWARDED, NEVER FABRICATED. When the upstream advertised
      // one it is re-published verbatim, in seconds, so the caller waits exactly
      // as long as the upstream asked. When it advertised none, NO `Retry-After`
      // is attached and the copy names no duration — inventing a wait here would
      // turn a vague error into a specific lie (TRAP-3).
      // ─────────────────────────────────────────────────────────────────────
      const seamFailure = readSeamFailureCause(err);
      if (seamFailure?.status === 429) {
        // ⚠️ The scrubbed error is logged HERE as well as on the generic arm
        // below. This arm RETURNS, so it never reaches that line — and TS-07's
        // NEGATIVE obligation is that the operator sees the upstream's own
        // human sentence (the thing `seamHumanMessage` was added to preserve),
        // not merely THAT a failure happened. Dropping it here would have
        // silently re-opened that obligation at exactly the status the seam
        // documents best. Same scrubber, same reasoning as the generic arm.
        console.error(
          `[keys/permissions] upstream throttled the probe for ${keyId} ` +
            `(code=${seamFailure.code ?? "none"}, retry_after_s=${
              seamFailure.retryAfterSeconds ?? "none"
            }):`,
          scrubSeamError(err),
        );
        return NextResponse.json(
          // The route's OWN existing 429 sentence, reused verbatim rather than
          // authored fresh — 140.3-12 owns every new sentence in this phase.
          // The private `PROBE_*` code is what distinguishes an upstream
          // throttle from this route's own limiter arm above, which returns the
          // same sentence with no code.
          { error: "Too many requests", code: "PROBE_RATE_LIMITED" },
          {
            status: 429,
            headers:
              seamFailure.retryAfterSeconds === undefined
                ? NO_STORE_HEADERS
                : {
                    ...NO_STORE_HEADERS,
                    "Retry-After": String(seamFailure.retryAfterSeconds),
                  },
          },
        );
      }

      // The raw Error.message used to bubble straight into the response
      // body (e.g. "INTERNAL_API_TOKEN is not configured on the Next
      // layer."). That leaks infra detail to any authenticated client
      // and confuses the wizard alert with internal jargon. Classify
      // into a stable code + generic copy here; keep the raw message
      // server-side for debugging only.
      //
      // ⚠️ 140.3-09 — THIS CASCADE IS DELIBERATELY KEPT, and this route's
      // `PROBE_*` vocabulary is deliberately NOT replaced by the shared
      // `classifyKeyValidationError`. Measured, not assumed: routed through
      // that classifier, FIVE of this route's six real thrown messages fall to
      // `{code:"UNKNOWN", status:500}` — the terminal "our team has been
      // notified" dead end — because it classifies KEY-VALIDATION faults
      // (signature / credentials / venue scopes) and every fault reachable here
      // is a PROXY-INFRASTRUCTURE fault. See the SUMMARY for the measured
      // table. The sharing that matters is already in place above: the breaker
      // verdict comes from the shared typed `CircuitOpenError` and the ONE
      // `CIRCUIT_OPEN_COPY`.
      const rawMessage = err instanceof Error ? err.message : String(err);
      // 140.5-06 fix — config-detection is scoped to OUR OWN thrown signals, not
      // a prose-grep over the upstream body. `INTERNAL_API_TOKEN` is this route's
      // own env-var fault sentinel (thrown above); `Upstream 5` is the
      // unreadable-5xx fallback WE construct; `ECONNREFUSED` is a transport
      // rejection. A bare `includes("not configured")` clause used to sit here —
      // it was redundant (our token message already contains "not configured")
      // AND over-broad: a reached-and-answered upstream fault whose sentence
      // happens to contain the phrase (e.g. the missing-KEK 500 "Credential
      // encryption is not configured…") was mis-reported as OUR layer being
      // unreachable. Removed: such a fault now falls to the generic reached-but-
      // failed `PROBE_FAILED` envelope, like every other answered upstream body.
      const isConfigError =
        rawMessage.includes("INTERNAL_API_TOKEN") ||
        rawMessage.startsWith("Upstream 5") ||
        rawMessage.includes("ECONNREFUSED");
      const isTimeout =
        rawMessage.includes("aborted") ||
        rawMessage.toLowerCase().includes("timeout");

      const code = isConfigError
        ? "PROBE_BACKEND_UNAVAILABLE"
        : isTimeout
        ? "PROBE_TIMEOUT"
        : "PROBE_FAILED";
      const userMessage = isConfigError
        ? "Could not reach the permissions service. Try again shortly."
        : isTimeout
        ? "Permissions probe timed out. Try again."
        : "Could not check key scopes. Try again.";

      // SEAMCORE-06 — this catch sees the seam's raw transport rejection, and
      // the upstream request carried `X-Internal-Token: <INTERNAL_API_TOKEN>`,
      // which undici inlines into the message. The token is on the leaf's env
      // list, so no explicit secret is needed here: unlike the two key-connect
      // paths, this route holds NO per-request credential — the exchange
      // credentials are decrypted inside the Python service, never here, and
      // `keyId` is an opaque row id that is deliberately kept in the line
      // because it is what makes the failure triageable.
      // 140.3-13a / SEAMUX-08 — THE TERMINAL ARM, and the only capture in this
      // route, under the policy in `admin/match/eval/route.ts`.
      //
      // The two arms above capture NOTHING, both deliberately:
      //   · the `CircuitOpenError` arm — a trip is an expected infrastructure
      //     fact that fires on every seam route at once during one incident;
      //   · the 429 throttle arm — the upstream refused this caller on purpose
      //     and told us for how long. That is the limiter working, not a fault.
      // This arm is what is left: a config fault, a transport failure, a 5xx,
      // or an unreadable body — none of which we can classify further, and all
      // of which someone has to look at.
      //
      // `secrets` is EMPTY here, and that is a fact about this route rather
      // than an oversight: unlike the two key-connect paths it holds NO
      // per-request credential — exchange material is decrypted inside the
      // Python service, never here — and the one credential the outgoing
      // request DOES carry (`X-Internal-Token`, which undici inlines into the
      // error message) is `INTERNAL_API_TOKEN`, already on the leaf's env-name
      // list. `keyId` is an opaque row id and is deliberately kept, because it
      // is what makes the failure triageable.
      captureToSentry(err, {
        tags: { surface: "keys-permissions", step: "upstream-proxy" },
        extra: { key_id: keyId },
      });
      console.error(
        `[keys/permissions] proxy failed for ${keyId}:`,
        scrubSeamError(err),
      );
      return NextResponse.json({ error: userMessage, code }, { status: 502, headers: NO_STORE_HEADERS });
    }
  },
);
