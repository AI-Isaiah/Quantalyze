"use client";

import type { WidgetProps } from "../../lib/types";

export default function ExposureByAsset(_props: WidgetProps) {
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
          <circle cx="12" cy="12" r="9" />
          <path d="M12 3v9l6.36 3.64" />
        </svg>
        <p className="text-sm leading-relaxed" style={{ color: "#718096" }}>
          Asset-level exposure breakdown requires position-level data from
          exchange APIs.
        </p>
      </div>
    </div>
  );
}
