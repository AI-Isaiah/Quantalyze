import { NextRequest, NextResponse } from "next/server";
import { unstable_cache } from "next/cache";
import { withAuth } from "@/lib/api/withAuth";
import { createClient } from "@/lib/supabase/server";
import { userActionLimiter, checkLimit } from "@/lib/ratelimit";
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
import { scrubSeamError } from "@/lib/seam-redaction";
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
 *   2. This Next layer — 60 seconds via unstable_cache. Conservative window
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
 * Fetch the live permission triple from the Python service. Wrapped in
 * unstable_cache so concurrent callers + repeat hits inside 5 minutes
 * collapse to a single upstream request.
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
          // ⚠️ SCOPE. This changes ONLY the extraction. Mapping `RATE_LIMITED`
          // to a throttle state, answering 429 instead of 502 and forwarding
          // `Retry-After` is TS-34 and belongs to 140.3's response-shape plan —
          // two changes to one block in one pass is TRAP-8. The machine code is
          // carried on `cause` so that plan reads it instead of re-extracting,
          // and so the operator can see WHICH contract answered. It is omitted
          // entirely when the body carried no code, leaving those log lines
          // byte-identical to their pre-plan form.
          const seamCode = seamErrorCode(err);
          throw new Error(
            seamHumanMessage(err) ?? `Upstream ${res.status}`,
            seamCode === null ? undefined : { cause: { code: seamCode } },
          );
        }
        throw new Error(`Upstream ${res.status}`);
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
      // `ECONNREFUSED`, `not configured`, `aborted`, `timeout`), so it lands on
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
      return NextResponse.json(
        { error: "Too many requests" },
        { status: 429, headers: { ...NO_STORE_HEADERS, "Retry-After": String(rl.retryAfter) } },
      );
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

      // The raw Error.message used to bubble straight into the response
      // body (e.g. "INTERNAL_API_TOKEN is not configured on the Next
      // layer."). That leaks infra detail to any authenticated client
      // and confuses the wizard alert with internal jargon. Classify
      // into a stable code + generic copy here; keep the raw message
      // server-side for debugging only.
      const rawMessage = err instanceof Error ? err.message : String(err);
      const isConfigError =
        rawMessage.includes("INTERNAL_API_TOKEN") ||
        rawMessage.startsWith("Upstream 5") ||
        rawMessage.includes("ECONNREFUSED") ||
        rawMessage.includes("not configured");
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
      console.error(
        `[keys/permissions] proxy failed for ${keyId}:`,
        scrubSeamError(err),
      );
      return NextResponse.json({ error: userMessage, code }, { status: 502, headers: NO_STORE_HEADERS });
    }
  },
);
