"use client";

import type { WidgetProps } from "../../lib/types";

export default function NetExposure(_props: WidgetProps) {
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
          <path d="M2 12h4l3-9 4 18 3-9h4" />
        </svg>
        <p className="text-sm leading-relaxed" style={{ color: "#718096" }}>
          Net exposure tracking requires historical position data aggregated
          over time.
        </p>
      </div>
    </div>
  );
}
