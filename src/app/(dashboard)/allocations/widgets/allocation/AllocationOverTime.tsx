"use client";

import type { WidgetProps } from "../../lib/types";

/**
 * Allocation Over Time — TODO widget.
 *
 * Weight snapshots are not yet captured by the analytics pipeline.
 * Once the pipeline persists periodic weight snapshots, this widget
 * will render a stacked area chart showing how allocation weights
 * evolved over time.
 */
export default function AllocationOverTime(_props: WidgetProps) {
  return (
    <div
      className="flex h-full items-center justify-center rounded-lg border border-dashed border-[#E2E8F0] px-6 py-8"
      data-testid="allocation-over-time-todo"
    >
      <p
        className="max-w-md text-center leading-relaxed text-[#718096]"
        style={{ fontFamily: "var(--font-dm-sans), sans-serif", fontSize: 14 }}
      >
        Historical weight data not yet available. Weight snapshots will enable
        tracking allocation changes over time.
      </p>
    </div>
  );
}
