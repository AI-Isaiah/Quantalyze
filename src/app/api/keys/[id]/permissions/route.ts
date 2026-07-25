import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { unstable_cache } from "next/cache";
import { withAuth } from "@/lib/api/withAuth";
import { createClient } from "@/lib/supabase/server";
import { userActionLimiter, checkLimit } from "@/lib/ratelimit";
import { logAuditEvent } from "@/lib/audit";
import { NO_STORE_HEADERS } from "@/lib/api/headers";
import { resilientFetch } from "@/lib/resilient-fetch";
import {
  AnalyticsTimeoutError,
  CircuitOpenError,
  formatUpstreamDetail,
  isSeamTransportFailure,
} from "@/lib/seam-errors";
import { captureToSentry } from "@/lib/sentry-capture";
import type { WizardErrorCode } from "@/lib/wizardErrors";
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
 * User-facing copy for the breaker's 503. STATIC by design (threat T-140-05):
 * a trip is an infrastructure fact, so the body carries no upstream URL, no
 * status and no error detail. Byte-identical to the other seam routes' copy —
 * a breaker trip should read the same wherever a user meets it.
 */
const CIRCUIT_OPEN_COPY =
  "The analytics service is temporarily unavailable. Please try again in a moment.";

/**
 * E9 — OUR-SIDE, PERMANENT faults, typed so the handler can answer honestly.
 *
 * Both used to be bare `new Error(...)` and both fell through the catch's
 * message-sniffing cascade. `PermissionContractError` landed on its terminal
 * `PROBE_FAILED` arm ("Could not check key scopes. Try again.") and
 * `InternalTokenMissingError` on `PROBE_BACKEND_UNAVAILABLE` ("Try again
 * shortly.") — both PROMISING A RETRY that cannot possibly work, on the surface
 * that tells a manager whether their money-bearing key still has the scopes they
 * think it has. Neither reached Sentry, because the cascade rendered them
 * indistinguishable from an exchange blip.
 *
 * Typed rather than message-matched for the reason `wizardErrors.ts` states at
 * its own type-check-first branch: a substring branch is simultaneously too
 * narrow (any reword silently re-opens the cascade) and too broad (an unrelated
 * upstream string containing the token is mislabelled), and ordering rather than
 * specificity decides which arm wins.
 */
class PermissionContractError extends Error {
  constructor() {
    super("Permission payload failed contract validation");
    this.name = "PermissionContractError";
  }
}

class InternalTokenMissingError extends Error {
  constructor() {
    super("INTERNAL_API_TOKEN is not configured on the Next layer.");
    this.name = "InternalTokenMissingError";
  }
}

/**
 * Runtime contract for the `/internal/keys/{id}/permissions` payload.
 *
 * VALIDATED, NOT CAST (Phase 140 review / D-6). This body used to be taken as
 * `(await res.json()) as PermissionPayload` — a compile-time assertion with no
 * runtime force whatsoever — and then CACHED FOR 60 SECONDS. The failure mode
 * is specific and bad: if the Python side renames or drops a field (say
 * `read` → `can_read`), every property reads `undefined`, the badge's
 * `read === true` test is false, and `KeyPermissionBadge` tells the user
 *
 *     "No read permission detected — the key may have been revoked"
 *
 * about a PERFECTLY HEALTHY money-bearing key. Because the bad value is
 * cached, the "Re-check" button repeats the same libel for the next minute.
 * A manager's rational response is to go revoke and re-issue a key that was
 * never broken.
 *
 * `analytics-client` already validates every response it parses with Zod
 * (`parseResponse`) and throws loudly on drift; this third seam was the one
 * that did not. Failing loudly here surfaces as the route's existing 502
 * "Failed to fetch permissions" — an honest, uncached error the badge renders
 * as an unknown state — instead of a confident false claim.
 *
 * `probe_error` stays OPTIONAL: it is genuinely absent on some Python arms and
 * defaults to false downstream.
 *
 * STRIP, NOT STRICT AND NOT PASSTHROUGH. The two requirements pull in opposite
 * directions and Zod's DEFAULT satisfies both:
 *   * the service adding a NEW field must not break a working badge — that is
 *     the failure mode this fix exists to prevent, not create — so `.strict()`
 *     is wrong;
 *   * but an unknown upstream field must not flow untyped into the response
 *     this route hands the browser (the NEW-C40-01 boundary-leak class the
 *     `quantalyze/no-passthrough-on-ipc` rule exists to stop), so
 *     `.passthrough()` is wrong too.
 * Stripping accepts the additive drift and drops the unknown field.
 */
const PermissionPayloadSchema = z
  .object({
    read: z.boolean(),
    trade: z.boolean(),
    withdraw: z.boolean(),
    detected_at: z.string(),
    /**
     * True when the Python service caught an exchange-side exception and
     * returned the fail-CLOSED default ({read,trade,withdraw}=true). The
     * field used to be silently stripped here because the interface did
     * not include it, which made the frontend `KeyPermissionBadge` render
     * the "No read permission detected — the key may have been revoked"
     * warning whenever the exchange API was just temporarily down.
     * Forwarding the flag lets the badge distinguish "exchange down" from
     * "key actually revoked".
     */
    probe_error: z.boolean().optional(),
  })
  .strip();

type PermissionPayload = z.infer<typeof PermissionPayloadSchema>;

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
  fetchPermissions: () => Promise<PermissionPayload>;
  wasFreshDecrypt: () => boolean;
} {
  let didDecrypt = false;
  const fetchPermissions = unstable_cache(
    async (): Promise<PermissionPayload> => {
      didDecrypt = true; // runs only on a cache MISS
      const internalToken = process.env.INTERNAL_API_TOKEN;
      if (!internalToken) {
        // E9 — typed. Message preserved verbatim so server logs are unchanged.
        throw new InternalTokenMissingError();
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
          const err = await res.json().catch(() => ({ detail: res.statusText }));
          // E7b — the SAME `detail`-is-not-a-string hole `analytics-client` had.
          // FastAPI's RequestValidationError returns a list of dicts, which
          // `new Error(...)` stringifies to "[object Object]" — and here that
          // string is then message-sniffed by the classifier below, so an
          // unrenderable detail also destroys the PROBE_TIMEOUT /
          // PROBE_BACKEND_UNAVAILABLE discrimination. One shared renderer.
          throw new Error(
            formatUpstreamDetail(err?.detail, `Upstream ${res.status}`),
          );
        }
        throw new Error(`Upstream ${res.status}`);
      }

      // D-6 — VALIDATE BEFORE CACHING. Inside the cached callback on purpose:
      // a throw here leaves NO cache entry (same property the CircuitOpenError
      // note above depends on), so a drift-induced failure is retried on the
      // next request instead of being pinned for 60s. Validating after the
      // cache write would have cached the bad value and defeated the fix.
      const parsed = PermissionPayloadSchema.safeParse(await res.json());
      if (!parsed.success) {
        // Loud: contract drift on a money-bearing surface is an engineering
        // event, not a user error. Issues only — never the body, which carries
        // the live permission triple for someone's exchange key.
        console.error(
          `[keys/${keyId}/permissions] upstream contract violation — refusing to cache`,
          parsed.error.issues,
        );
        // E9 — typed. Message preserved verbatim so server logs are unchanged.
        throw new PermissionContractError();
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
          {
            error: CIRCUIT_OPEN_COPY,
            // Phase 140 review (WR-01) — ONE VOCABULARY ON THE WIRE.
            // "CIRCUIT_OPEN" is not a WizardErrorCode, so every wizard surface
            // reading this response fell through to the UNKNOWN dead end.
            code: "SERVICE_UNAVAILABLE_RETRY" satisfies WizardErrorCode,
          },
          {
            status: 503,
            headers: {
              ...NO_STORE_HEADERS,
              "Retry-After": String(err.retryAfterS),
            },
          },
        );
      }

      // ⚠️ E9 — OUR OWN ENGINEERING FAULTS ARE TYPED AND BRANCH FIRST.
      //
      // Everything below this point is the message-sniffing cascade, whose
      // terminal arm is `PROBE_FAILED` / "Could not check key scopes. Try
      // again." — copy that promises the user a retry will help. That promise is
      // TRUE for an exchange blip and FALSE for a permanent, deterministic fault
      // on our side: retrying a schema violation or a missing deployment secret
      // produces the identical failure until an engineer ships something. On a
      // money-bearing surface that turns a five-minute page into a manager
      // clicking "Re-check" forever while nothing is recorded anywhere — these
      // arms never reached Sentry either, because the cascade collapsed them
      // into the same generic 502 an exchange timeout produces.
      //
      // Both are typed (not message-matched) for the reason `wizardErrors.ts`
      // spells out at its own type-check-first branch: a reword silently
      // re-opens the cascade, and ordering rather than specificity decides which
      // substring arm wins.
      if (err instanceof PermissionContractError) {
        // Contract drift on the live permission triple. `parsed.error.issues`
        // is already logged (never the body — it carries someone's live scopes).
        captureToSentry(err, {
          tags: {
            route: "/api/keys/[id]/permissions",
            reason: "upstream_contract_violation",
          },
          extra: { key_id: keyId },
        });
        return NextResponse.json(
          {
            error:
              "We can't read the permission data for this key right now. This is a fault on our side — we have been notified, and retrying will not clear it.",
            code: "PROBE_CONTRACT_VIOLATION",
          },
          { status: 502, headers: NO_STORE_HEADERS },
        );
      }
      if (err instanceof InternalTokenMissingError) {
        // A DEPLOYMENT misconfiguration: the env var is absent from this
        // environment. Same honesty rule — no "try again shortly".
        captureToSentry(err, {
          tags: {
            route: "/api/keys/[id]/permissions",
            reason: "internal_api_token_missing",
          },
          extra: { key_id: keyId },
        });
        return NextResponse.json(
          {
            error:
              "The permissions service is not configured on this deployment. This is a fault on our side — we have been notified, and retrying will not clear it.",
            code: "PROBE_MISCONFIGURED",
          },
          { status: 502, headers: NO_STORE_HEADERS },
        );
      }

      // E9b — TRANSPORT FAILURES ARE A TYPE CHECK, and the old text match was
      // DEAD. `rawMessage.includes("ECONNREFUSED")` never fired: undici surfaces
      // a refused connection as `TypeError("fetch failed")` and hides the syscall
      // code on `.cause` (documented at `resilient-fetch.ts:1347`, verified on
      // Node 22 and 25 for ECONNREFUSED, DNS and TLS). `isSeamTransportFailure`
      // was written for exactly this shape and had been applied only in
      // `finalize-wizard`.
      //
      // The deadline / unreachable split below is for COPY ONLY — both mean "we
      // could not reach our own service", both are genuinely transient, and both
      // keep the retry promise the terminal arm makes falsely.
      if (isSeamTransportFailure(err)) {
        const isDeadline =
          err instanceof AnalyticsTimeoutError ||
          ((err instanceof Error || err instanceof DOMException) &&
            (err.name === "AbortError" || err.name === "TimeoutError"));
        console.error(
          `[keys/permissions] seam transport failure for ${keyId}:`,
          err,
        );
        return NextResponse.json(
          {
            error: isDeadline
              ? "Permissions probe timed out. Try again."
              : "Could not reach the permissions service. Try again shortly.",
            code: isDeadline ? "PROBE_TIMEOUT" : "PROBE_BACKEND_UNAVAILABLE",
          },
          { status: 502, headers: NO_STORE_HEADERS },
        );
      }

      // The raw Error.message used to bubble straight into the response
      // body (e.g. "INTERNAL_API_TOKEN is not configured on the Next
      // layer."). That leaks infra detail to any authenticated client
      // and confuses the wizard alert with internal jargon. Classify
      // into a stable code + generic copy here; keep the raw message
      // server-side for debugging only.
      //
      // What still reaches this cascade is the UPSTREAM's own error text (the
      // `formatUpstreamDetail`-rendered `detail` from a non-2xx), which is the
      // only input it was ever able to classify.
      const rawMessage = err instanceof Error ? err.message : String(err);
      const isConfigError = rawMessage.startsWith("Upstream 5");
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

      console.error(`[keys/permissions] proxy failed for ${keyId}:`, err);
      return NextResponse.json({ error: userMessage, code }, { status: 502, headers: NO_STORE_HEADERS });
    }
  },
);
