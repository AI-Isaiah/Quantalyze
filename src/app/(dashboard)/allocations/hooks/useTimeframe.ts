"use client";

import { useState, useEffect } from "react";
import type { TimeframeKey } from "@/components/ui/TimeframeSelector";
import { coerceTimeframe } from "../lib/types";

const STORAGE_KEY = "quantalyze-timeframe";

export function useTimeframe(initial: TimeframeKey = "1YTD"): readonly [TimeframeKey, (next: TimeframeKey) => void] {
  const [timeframe, setTimeframe] = useState<TimeframeKey>(() => {
    if (typeof window === "undefined") return initial;
    return coerceTimeframe(localStorage.getItem(STORAGE_KEY), initial);
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, timeframe);
    } catch (err) {
      if (typeof console !== "undefined") {
        console.warn(
          "[useTimeframe] localStorage write failed; timeframe will not persist",
          err,
        );
      }
    }
  }, [timeframe]);

  return [timeframe, setTimeframe] as const;
}
