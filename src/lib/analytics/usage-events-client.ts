"use client";

/**
 * Client-side wrapper for the allocator usage funnel. Mirrors
 * `src/lib/analytics-client.ts` (the /for-quants client wrapper).
 *
 * Split from `./usage-events` (which imports `posthog-node` via
 * `server-only`) so Client Components can't pull the Node SDK into the
 * browser bundle.
 *
 * When NEXT_PUBLIC_POSTHOG_KEY is missing, the init promise resolves to
 * null and every capture becomes a no-op.
 */

// IMPORTANT: this union is duplicated from `./usage-events`. It is NOT
// re-exported because re-exporting would force `server-only` into the
// client bundle. Both unions MUST stay in sync — if you add an event
// here, add it there too (and vice versa).
export type UsageEvent =
  | "session_start"
  | "widget_viewed"
  | "intro_submitted"
  | "bridge_click"
  | "alert_acknowledged";

type PostHogModule = typeof import("posthog-js").default;

let _initPromise: Promise<PostHogModule | null> | null = null;

function initUsageClient(): Promise<PostHogModule | null> {
  if (typeof window === "undefined") {
    return Promise.resolve(null);
  }
  if (_initPromise) return _initPromise;

  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!key) {
    _initPromise = Promise.resolve(null);
    return _initPromise;
  }

  _initPromise = import("posthog-js").then((mod) => {
    const posthog = mod.default;
    // Guard double-init: the /for-quants client may have already
    // booted posthog-js. posthog-js exposes `__loaded` on the
    // singleton — calling init() twice is a no-op but logs a warning,
    // so we suppress that by only calling init once per page load.
    if (!(posthog as unknown as { __loaded?: boolean }).__loaded) {
      posthog.init(key, {
        api_host:
          process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com",
        person_profiles: "identified_only",
        capture_pageview: false,
        capture_pageleave: true,
      });
    }
    return posthog;
  });

  return _initPromise;
}

/**
 * Fire a usage event from a Client Component. Awaits the cached init
 * promise before calling capture, so events are never dropped against
 * an uninitialized instance.
 */
export function trackUsageEventClient(
  event: UsageEvent,
  properties?: Record<string, unknown>,
): void {
  if (typeof window === "undefined") return;

  void initUsageClient().then((posthog) => {
    if (!posthog) return;
    try {
      posthog.capture(event, {
        ...(properties ?? {}),
        source_layer: "client",
      });
    } catch (err) {
      console.warn(
        "[usage-analytics] client capture failed (non-blocking):",
        err instanceof Error ? err.message : String(err),
      );
    }
  });
}

/**
 * Identify the current user against PostHog. Call this once after the
 * authenticated allocator id is known so subsequent client-side events
 * stitch to the same person record as the server-side events.
 */
export function identifyUsageUser(userId: string): void {
  if (typeof window === "undefined" || !userId) return;
  void initUsageClient().then((posthog) => {
    if (!posthog) return;
    try {
      posthog.identify(userId);
    } catch (err) {
      console.warn(
        "[usage-analytics] client identify failed (non-blocking):",
        err instanceof Error ? err.message : String(err),
      );
    }
  });
}
