"use client";

import type { WidgetProps } from "../../lib/types";
import { TodoPlaceholder } from "../lib/TodoPlaceholder";

export default function TradingActivityLog(_props: WidgetProps) {
  return (
    <TodoPlaceholder
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
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <path d="M3 9h18M9 21V9" />
        </svg>
      }
      message="Trade log requires a trades query endpoint. Track recent trades across all strategies once the API is available."
    />
  );
}
