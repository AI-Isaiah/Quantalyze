import { NextRequest, NextResponse } from "next/server";
import { unstable_cache } from "next/cache";
import { withAuth } from "@/lib/api/withAuth";
import { createClient } from "@/lib/supabase/server";
import { userActionLimiter, checkLimit } from "@/lib/ratelimit";
import { logAuditEvent } from "@/lib/audit";
import { NO_STORE_HEADERS } from "@/lib/api/headers";
import { resilientFetch } from "@/lib/resilient-fetch";
import { CircuitOpenError, SeamBodyReadError } from "@/lib/seam-errors";
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

interface PermissionPayload {
  read: boolean;
  trade: boolean;
  withdraw: boolean;
  detected_at: string;
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
  probe_error?: boolean;
}

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
          throw new Error(err.detail ?? `Upstream ${res.status}`);
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
      return (await res.json()) as PermissionPayload;
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

      console.error(`[keys/permissions] proxy failed for ${keyId}:`, err);
      return NextResponse.json({ error: userMessage, code }, { status: 502, headers: NO_STORE_HEADERS });
    }
  },
);
