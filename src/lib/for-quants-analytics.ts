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

  _initPromise = import("posthog-js")
    .then((mod) => {
      const posthog = mod.default;
      try {
        posthog.init(key, {
          api_host:
            process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com",
          person_profiles: "identified_only",
          // We fire canonical page/view events from explicit calls, not
          // PostHog's auto-capture.
          capture_pageview: false,
          capture_pageleave: true,
        });
      } catch (err) {
        // posthog.init can throw on corrupt local state, ad-blocker
        // mid-init injection, etc. Reset the cached promise to the
        // no-op resolution so subsequent track calls cheaply no-op
        // (matching the no-key path) instead of forever returning a
        // posthog instance that's only half-initialized. G9.B.14.
        console.warn(
          "[analytics] posthog.init failed (non-blocking):",
          err instanceof Error ? err.message : String(err),
        );
        _initPromise = Promise.resolve(null);
        return null;
      }
      return posthog;
    })
    .catch((err) => {
      // Dynamic-import rejection (ad blocker, CSP, CDN outage). Log
      // once, then reset to the no-op resolution so future track calls
      // skip cleanly instead of perpetually re-awaiting the rejected
      // promise. Without this reset, the page silently emits zero
      // events for the rest of the visitor's session. G9.B.14.
      console.warn(
        "[analytics] posthog-js dynamic import failed (non-blocking):",
        err instanceof Error ? err.message : String(err),
      );
      _initPromise = Promise.resolve(null);
      return null;
    });

  return _initPromise;
}

/**
 * Fire a /for-quants event from a Client Component. Awaits the cached
 * init promise before calling `capture`, so events are never dropped
 * against an uninitialized instance.
 *
 * Defense-in-depth: a `.catch()` is attached to the void chain so a
 * rejected init promise (dynamic import failure, ad blocker, CSP,
 * CDN outage) cannot surface as an unhandled promise rejection. The
 * rejection itself should already be neutered inside
 * `initForQuantsClient` (G9.B.14), but this catch keeps the route
 * safe even if a future refactor regresses that. G9.B.11.
 */
export function trackForQuantsEventClient(
  event: ForQuantsEvent,
  props: ForQuantsEventProps = {},
): void {
  if (typeof window === "undefined") return;

  void initForQuantsClient()
    .then((posthog) => {
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
    })
    .catch((err) => {
      console.warn(
        "[analytics] client init failed (non-blocking):",
        err instanceof Error ? err.message : String(err),
      );
    });
}
