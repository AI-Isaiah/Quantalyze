"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Reactive media-query hook. Returns true when the query matches.
 *
 * Implemented with useSyncExternalStore so we don't fall into the
 * "setState inside useEffect" anti-pattern the React compiler
 * (rightly) complains about. The SSR snapshot is `false` so the
 * read-only mobile UI hydrates first.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (typeof window === "undefined") return () => {};
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    [query],
  );
  const getSnapshot = useCallback(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia(query).matches;
  }, [query]);
  const getServerSnapshot = useCallback(() => false, []);
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
