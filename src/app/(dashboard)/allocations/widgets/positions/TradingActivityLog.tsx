"use client";

import type { WidgetProps } from "../../lib/types";

export default function TradingActivityLog(_props: WidgetProps) {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <div
        className="flex flex-col items-center gap-3 rounded-lg border-2 border-dashed border-[#E2E8F0] px-6 py-8 text-center"
        style={{ maxWidth: 360 }}
      >
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
        <p className="text-sm leading-relaxed" style={{ color: "#718096" }}>
          Trade log requires a trades query endpoint. Track recent trades across
          all strategies once the API is available.
        </p>
      </div>
    </div>
  );
}
