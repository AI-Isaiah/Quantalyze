"use client";

/**
 * Client-side PostHog wrapper for factsheet-v2 interactivity events.
 *
 * Tracks adoption of the new UI affordances so we can prune what nobody uses
 * and double down on what allocators reach for. All events fire from
 * existing on-* handlers and never block the UI — a failed init or capture
 * logs once and degrades to a no-op.
 *
 * Pattern mirrors `src/lib/for-quants-analytics.ts` (cached init promise,
 * non-blocking catch chain) so behavior is consistent across the platform.
 */

type PostHogModule = typeof import("posthog-js").default;

export type FactsheetV2Event =
  | "factsheet_v2_view"
  | "factsheet_v2_toggle_dark"
  | "factsheet_v2_toggle_colorblind"
  | "factsheet_v2_toggle_regimes"
  | "factsheet_v2_section_toggle"
  | "factsheet_v2_chart_export"
  | "factsheet_v2_comparator_swap"
  | "factsheet_v2_pdf_print"
  | "factsheet_v2_reset_view"
  | "factsheet_v2_compare_click"
  | "factsheet_v2_share_copy";

export type FactsheetV2EventProps = Record<string, string | number | boolean | null | undefined>;

let _initPromise: Promise<PostHogModule | null> | null = null;

function init(): Promise<PostHogModule | null> {
  if (typeof window === "undefined") return Promise.resolve(null);
  if (_initPromise) return _initPromise;

  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!key) {
    _initPromise = Promise.resolve(null);
    return _initPromise;
  }

  _initPromise = import("posthog-js")
    .then(mod => {
      const posthog = mod.default;
      try {
        // Reuse the existing global PostHog instance if /for-quants already
        // initialised it — `posthog.init` is a no-op when called twice with
        // the same key, but we still wrap to defend against init throws.
        posthog.init(key, {
          api_host:
            process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com",
          person_profiles: "identified_only",
          capture_pageview: false,
          capture_pageleave: false,
        });
      } catch {
        _initPromise = null;
        return null;
      }
      return posthog;
    })
    .catch(() => {
      _initPromise = null;
      return null;
    });
  return _initPromise;
}

export function trackFactsheetEvent(
  event: FactsheetV2Event,
  props: FactsheetV2EventProps = {},
): void {
  if (typeof window === "undefined") return;
  void init()
    .then(posthog => {
      if (!posthog) return;
      try {
        posthog.capture(event, { ...props, source_layer: "factsheet_v2" });
      } catch (err) {
        console.warn("[factsheet-v2] analytics capture failed:", err instanceof Error ? err.message : String(err));
      }
    })
    .catch(err => {
      console.warn("[factsheet-v2] analytics init failed:", err instanceof Error ? err.message : String(err));
    });
}
