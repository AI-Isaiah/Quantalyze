"use client";

import { TodoPlaceholder } from "../lib/TodoPlaceholder";

export default function ExposureByAsset() {
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
          <circle cx="12" cy="12" r="9" />
          <path d="M12 3v9l6.36 3.64" />
        </svg>
      }
      message="Asset-level exposure breakdown requires position-level data from exchange APIs."
    />
  );
}
