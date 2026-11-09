"use client";

import { createContext } from "react";

/**
 * Phase 196 plan 11 (D-04, LEAN-05) — the one chart hint of the document layout.
 *
 * The full layout (allocator mounts) keeps a hint per chart: a screen-reader-only `chart-help-*`
 * span on every TimeSeriesChart and a visible line on the histogram. The document layout states
 * the interactions ONCE, visibly, under the drawdown chart, and every interactive chart points
 * its `aria-describedby` at that one element. The provider's value is the element id; `null`
 * (the default, no provider) means "no shared hint: render your own", which is exactly what the
 * full layout does today.
 */
export const CHART_HINT_ID = "factsheet-chart-hint";

export const ChartHintContext = createContext<string | null>(null);

/** UI-SPEC "The one chart hint" copy. */
export const CHART_HINT_TEXT =
  "Ctrl/Cmd + wheel zooms · drag pans · drag an axis to scale it · double-click resets. On a focused chart, arrow keys pan, plus and minus zoom, Home resets.";

export function ChartHint() {
  return (
    <p id={CHART_HINT_ID} className="factsheet-v2-no-print mt-2 text-caption text-text-muted">
      {CHART_HINT_TEXT}
    </p>
  );
}
