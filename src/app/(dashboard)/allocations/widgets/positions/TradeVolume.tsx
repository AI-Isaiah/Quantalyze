"use client";

import type { WidgetProps } from "../../lib/types";
import { TodoPlaceholder } from "../lib/TodoPlaceholder";

export default function TradeVolume(_props: WidgetProps) {
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
          <rect x="3" y="12" width="4" height="9" rx="1" />
          <rect x="10" y="7" width="4" height="14" rx="1" />
          <rect x="17" y="3" width="4" height="18" rx="1" />
        </svg>
      }
      message="Trade volume chart requires the same trades query endpoint as the Trading Activity Log."
    />
  );
}
