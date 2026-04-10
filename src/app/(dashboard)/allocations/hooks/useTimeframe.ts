"use client";

import { useState, useEffect } from "react";

const STORAGE_KEY = "quantalyze-timeframe";

/** Valid timeframe keys -- must match TimeframeSelector. */
export const VALID_TIMEFRAMES = new Set([
  "1DTD", "1WTD", "1MTD", "1QTD", "1YTD", "3YTD", "ALL",
  // Legacy aliases that may exist in localStorage
  "YTD",
]);

export function useTimeframe(initial = "YTD") {
  const [timeframe, setTimeframe] = useState<string>(() => {
    if (typeof window === "undefined") return initial;
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && VALID_TIMEFRAMES.has(stored)) return stored;
    return initial;
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, timeframe);
    } catch {
      // localStorage full or unavailable
    }
  }, [timeframe]);

  return [timeframe, setTimeframe] as const;
}
