import "server-only";
import { PostHog } from "posthog-node";

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

// Literal union instead of `string` so typos at call sites fail typecheck.
// IMPORTANT: this union MUST stay in sync with the duplicate in
// `./usage-events-client.ts`. The client file deliberately copies this
// rather than re-exports it, because re-exporting from a `server-only`
// module would force `server-only` into the browser bundle.
//
// Per the Sprint 5 plan v3, feedback_card_shown / feedback_card_dismissed
// / feedback_submitted are CUT — feedback is deferred to Sprint 7.
export type UsageEvent =
  | "session_start"
  | "widget_viewed"
  | "intro_submitted"
  | "bridge_click"
  | "alert_acknowledged";

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
    // flushAt:1 so events ship even on Vercel function cold-finish.
    flushAt: 1,
    flushInterval: 0,
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
    client.capture({
      distinctId,
      event,
      properties: {
        ...(properties ?? {}),
        $host: process.env.NEXT_PUBLIC_SITE_URL ?? "quantalyze.com",
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
