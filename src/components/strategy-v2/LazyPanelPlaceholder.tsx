"use client";

import { useLazyPanelMetrics, type LazyPanelId } from "@/hooks/useLazyPanelMetrics";

interface LazyPanelPlaceholderProps {
  panelId: LazyPanelId;
  heading: string;
  ariaLabel: string;
  /** data-panel attribute key, e.g. "returns-distribution" — drives the panel-count test. */
  dataPanelKey: string;
}

/**
 * Placeholder card for the lazy strategy-detail panels (4–7).
 *
 * Renders the white-card chrome + H2 heading + a centered "Loading…" body
 * (Unicode U+2026) inside an `aria-live="polite"` region. The
 * `useLazyPanelMetrics` hook wires an IntersectionObserver that tracks
 * lifecycle. Callers that also need the lazy fetch flip
 * `fetchOnIntersect: true` and read the `data` field from the hook.
 *
 * Note: project tokens use `bg-surface` for the white card surface
 * (not `bg-card` — see globals.css `--color-surface: #FFFFFF`).
 */
export function LazyPanelPlaceholder({
  panelId,
  heading,
  ariaLabel,
  dataPanelKey,
}: LazyPanelPlaceholderProps) {
  const { ref } = useLazyPanelMetrics(panelId);

  return (
    <section
      ref={ref}
      data-panel={dataPanelKey}
      data-panel-status="placeholder"
      aria-label={ariaLabel}
      className="mt-8 min-h-[240px] rounded-lg border border-border bg-surface p-6 shadow-card"
    >
      <h2 className="text-base font-semibold text-text-primary">{heading}</h2>
      <div
        aria-live="polite"
        className="mt-4 flex items-center justify-center text-xs font-normal text-text-muted"
        style={{ minHeight: "180px" }}
      >
        Loading{"…"}
      </div>
    </section>
  );
}
