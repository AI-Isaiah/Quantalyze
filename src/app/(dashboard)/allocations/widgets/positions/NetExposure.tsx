"use client";

import { TodoPlaceholder } from "../lib/TodoPlaceholder";

export default function NetExposure() {
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
          <path d="M2 12h4l3-9 4 18 3-9h4" />
        </svg>
      }
      message="Net exposure tracking requires historical position data aggregated over time."
    />
  );
}
