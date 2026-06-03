import { NextRequest, NextResponse } from "next/server";
import { unstable_cache } from "next/cache";
import { withAuth } from "@/lib/api/withAuth";
import { createClient } from "@/lib/supabase/server";
import { userActionLimiter, checkLimit } from "@/lib/ratelimit";
import { logAuditEvent } from "@/lib/audit";
import { NO_STORE_HEADERS } from "@/lib/api/headers";
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
 */

const ANALYTICS_URL = process.env.ANALYTICS_SERVICE_URL ?? "http://localhost:8002";

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
 * The cached payload carries an internal `_fetchedAt` epoch-ms stamp set at the
 * moment the upstream fetch actually ran. Because unstable_cache memoizes the
 * whole return value, a cache HIT replays the original `_fetchedAt` — so the
 * handler can tell "this request triggered a real decrypt" (fresh) from "served
 * from the 60s cache, no decrypt" (stale). Stripped before the response is
 * serialized (M-0325).
 */
type CachedPermissionPayload = PermissionPayload & { _fetchedAt: number };

/**
 * Fetch the live permission triple from the Python service. Wrapped in
 * unstable_cache so concurrent callers + repeat hits inside 5 minutes
 * collapse to a single upstream request.
 *
 * The cache tag/key array includes the keyId so a future invalidation hook
 * (e.g., on key rotation) can call revalidateTag.
 */
function makeCachedFetcher(keyId: string) {
  return unstable_cache(
    async (): Promise<CachedPermissionPayload> => {
      const internalToken = process.env.INTERNAL_API_TOKEN;
      if (!internalToken) {
        throw new Error(
          "INTERNAL_API_TOKEN is not configured on the Next layer.",
        );
      }

      const res = await fetch(
        `${ANALYTICS_URL}/internal/keys/${encodeURIComponent(keyId)}/permissions`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Internal-Token": internalToken,
          },
          // No body needed — key_id is in the path.
          signal: AbortSignal.timeout(15_000),
        },
      );

      if (!res.ok) {
        const contentType = res.headers.get("content-type") ?? "";
        if (contentType.includes("application/json")) {
          const err = await res.json().catch(() => ({ detail: res.statusText }));
          throw new Error(err.detail ?? `Upstream ${res.status}`);
        }
        throw new Error(`Upstream ${res.status}`);
      }

      const payload = (await res.json()) as PermissionPayload;
      // M-0325: stamp the real decrypt time INSIDE the cached body so it is
      // memoized with the value. A later cache hit returns this same stamp.
      return { ...payload, _fetchedAt: Date.now() };
    },
    [`key-permissions:${keyId}`],
    { revalidate: 60, tags: [`key-permissions:${keyId}`] },
  );
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
      const fetcher = makeCachedFetcher(keyId);
      const cached = await fetcher();
      const { _fetchedAt, ...payload } = cached;

      // Sprint 6 Task 7.1a — audit the decrypt event. M-0325: a real
      // exchange-credential DECRYPT only happens on a cache MISS (when the
      // fetcher body actually POSTs to the Python service; see migration 052
      // header). The 60s Next-layer cache + the Python 15-min cache mean most
      // probes inside that window decrypt NOTHING. Tag the audit row with
      // whether THIS request triggered a decrypt — derived from whether the
      // memoized `_fetchedAt` predates this request — so forensic
      // "count decrypt events for key X" stops over-counting by the cache-hit
      // ratio. Fire-and-forget; does not affect response latency or success.
      const cacheHit = Date.now() - _fetchedAt > 1000;
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
