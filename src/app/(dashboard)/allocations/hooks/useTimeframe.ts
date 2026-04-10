"use client";

import { useState, useEffect } from "react";

const STORAGE_KEY = "quantalyze-timeframe";

export function useTimeframe(initial = "YTD") {
  const [timeframe, setTimeframe] = useState<string>(() => {
    if (typeof window === "undefined") return initial;
    return localStorage.getItem(STORAGE_KEY) || initial;
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
