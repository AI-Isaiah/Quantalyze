"use client";

import type { ForQuantsEvent, ForQuantsEventProps } from "./analytics";

/**
 * Client-side PostHog wrapper. Split from `@/lib/analytics` (which
 * imports `posthog-node` via `server-only`) so Client Components can't
 * pull the Node SDK into the browser bundle.
 *
 * `initForQuantsClient()` caches a single init promise. Every
 * `trackForQuantsEventClient` call awaits that cached promise before
 * firing `capture`, so events can never fire against an uninitialized
 * instance.
 *
 * When NEXT_PUBLIC_POSTHOG_KEY is missing (local dev, preview deploys),
 * the init promise resolves to null and every `capture` becomes a no-op.
 */

type PostHogModule = typeof import("posthog-js").default;

let _initPromise: Promise<PostHogModule | null> | null = null;

export function initForQuantsClient(): Promise<PostHogModule | null> {
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
    posthog.init(key, {
      api_host:
        process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com",
      person_profiles: "identified_only",
      // We fire canonical page/view events from explicit calls, not
      // PostHog's auto-capture.
      capture_pageview: false,
      capture_pageleave: true,
    });
    return posthog;
  });

  return _initPromise;
}

/**
 * Fire a /for-quants event from a Client Component. Awaits the cached
 * init promise before calling `capture`, so events are never dropped
 * against an uninitialized instance.
 */
export function trackForQuantsEventClient(
  event: ForQuantsEvent,
  props: ForQuantsEventProps = {},
): void {
  if (typeof window === "undefined") return;

  void initForQuantsClient().then((posthog) => {
    if (!posthog) return;
    try {
      posthog.capture(event, {
        ...props,
        source_layer: "client",
      });
    } catch (err) {
      console.warn(
        "[analytics] client capture failed (non-blocking):",
        err instanceof Error ? err.message : String(err),
      );
    }
  });
}
