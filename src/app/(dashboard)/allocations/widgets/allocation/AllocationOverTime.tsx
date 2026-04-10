"use client";

import type { WidgetProps } from "../../lib/types";
import { TodoPlaceholder } from "../lib/TodoPlaceholder";

/**
 * Allocation Over Time -- TODO widget.
 *
 * Weight snapshots are not yet captured by the analytics pipeline.
 * Once the pipeline persists periodic weight snapshots, this widget
 * will render a stacked area chart showing how allocation weights
 * evolved over time.
 */
export default function AllocationOverTime(_props: WidgetProps) {
  return (
    <TodoPlaceholder
      testId="allocation-over-time-todo"
      icon={
        <svg
          width="28"
          height="28"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#718096"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="12" cy="12" r="9" />
          <path d="M12 3v9l6.36 3.64" />
        </svg>
      }
      message="Historical weight data not yet available. Weight snapshots will enable tracking allocation changes over time."
    />
  );
}
