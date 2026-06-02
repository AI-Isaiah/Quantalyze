import "server-only";
import { PostHog } from "posthog-node";
import type { UsageEvent } from "./usage-events-types";

/**
 * Server-side PostHog wrapper for allocator USAGE FUNNEL events.
 *
 * Mirrors the shape of `src/lib/analytics.ts` (the /for-quants funnel
 * wrapper). `import "server-only"` makes any accidental client-bundle
 * leak fail the build instead of silently shipping the Node SDK to the
 * browser. Client Components import `./usage-events-client` instead.
 *
 * NOTE: PostHog is the EVENT SINK + admin-page query target only — it
 * is never the source of truth in any render path. Server-side
 * `session_count` is stored in `auth.users.raw_user_meta_data` (read
 * via Supabase Auth user_metadata). The /api/usage/session-start route
 * owns the increment + 30-min debounce; this file just ships the event.
 *
 * When NEXT_PUBLIC_POSTHOG_KEY is missing (local dev, preview deploys),
 * every track call becomes a no-op and logs a single startup warning.
 */

export type { UsageEvent } from "./usage-events-types";

// ---------------------------------------------------------------------------
// Server-side PostHog client
// ---------------------------------------------------------------------------

let _serverClient: PostHog | null = null;
let _serverWarned = false;

function getServerClient(): PostHog | null {
  if (_serverClient !== null) return _serverClient;

  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!key) {
    if (!_serverWarned) {
      console.warn(
        "[usage-analytics] NEXT_PUBLIC_POSTHOG_KEY not set — server-side usage events disabled.",
      );
      _serverWarned = true;
    }
    return null;
  }

  _serverClient = new PostHog(key, {
    host: process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com",
    flushAt: 1,
    flushInterval: 0,
    // The wrapper uses captureImmediate (awaits the HTTP POST). Several LIVE
    // callers await it INLINE in a request/render path (usage/session-start,
    // onboarding-funnel → /allocations), so bound the retry budget (default
    // 3 × 3s ≈ up to ~9-20s on a PostHog incident) to 1 × 500ms — worst-case
    // ~1s added latency while still surviving a single transient blip.
    // Telemetry must never hang a request.
    fetchRetryCount: 1,
    fetchRetryDelay: 500,
  });
  return _serverClient;
}

/**
 * Fire a usage funnel event from a Server Component or API route.
 *
 * `distinctId` should be the authenticated user's id (or a stable
 * server-side identifier like `alert:<id>` for the email ack path
 * where there's no logged-in session).
 *
 * Errors are swallowed — analytics MUST NOT crash a request handler.
 */
export async function trackUsageEventServer(
  event: UsageEvent,
  distinctId: string,
  properties?: Record<string, unknown>,
): Promise<void> {
  const client = getServerClient();
  if (!client) return;

  try {
    // H-0416/M-0486 (sibling): use captureImmediate, NOT capture(). posthog-node
    // 5.29.2's capture() defers the enqueue behind an async prepareEventMessage
    // and returns void, so the event is NOT on the wire when this function's
    // awaited promise resolves — on Vercel Fluid Compute the instance can suspend
    // first and drop it. Unlike the (dead) for-quants wrapper, this one has LIVE
    // callers (usage/session-start, intro, alerts/[id]/acknowledge, alerts/ack)
    // that fire it inside after(), so the drop was real. captureImmediate() builds
    // the batch and awaits the HTTP POST in one returned promise.
    await client.captureImmediate({
      distinctId,
      event,
      properties: {
        ...(properties ?? {}),
        // M-0487 (sibling): never fall back to "quantalyze.com" (an unrelated WP
        // site; prod is quantalyze-rho.vercel.app) — that made preview/missing-env
        // session/intro/alert events masquerade as prod traffic in PostHog funnel
        // attribution. Neutral, filterable, clearly-non-prod sentinel instead.
        $host: process.env.NEXT_PUBLIC_SITE_URL ?? "unknown.local",
        source_layer: "server",
      },
    });
  } catch (err) {
    console.warn(
      "[usage-analytics] server capture failed (non-blocking):",
      err instanceof Error ? err.message : String(err),
    );
  }
}

/**
 * Reset the cached server client. Exported for tests only — do NOT call
 * from production code.
 */
export function __resetUsageAnalyticsForTest(): void {
  _serverClient = null;
  _serverWarned = false;
}
