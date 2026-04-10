"use client";

import type { WidgetProps } from "../../lib/types";

export default function TradeVolume(_props: WidgetProps) {
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
          <rect x="3" y="12" width="4" height="9" rx="1" />
          <rect x="10" y="7" width="4" height="14" rx="1" />
          <rect x="17" y="3" width="4" height="18" rx="1" />
        </svg>
        <p className="text-sm leading-relaxed" style={{ color: "#718096" }}>
          Trade volume chart requires the same trades query endpoint as the
          Trading Activity Log.
        </p>
      </div>
    </div>
  );
}
