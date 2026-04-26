"use client";

import { useEffect, useState } from "react";

/**
 * Phase 11 review fix IN-01 — shared sessionStorage-backed boolean hook.
 *
 * Consolidates the SSR-safe "render-then-hide-after-mount" pattern used
 * by OnboardingBanner and MandateQuickSetCard (both gate visibility on
 * a sessionStorage dismissal flag). The first paint always renders the
 * surface (server has no sessionStorage); a post-mount effect reads the
 * flag and may flip the boolean to true, hiding the surface without
 * causing CLS.
 *
 * Contract:
 *   - First render returns `[false, set]` regardless of sessionStorage
 *     state — server cannot read sessionStorage, so we render the
 *     surface unconditionally for SSR/hydration parity.
 *   - Post-mount, if `sessionStorage.getItem(key) === "1"` we flip to
 *     `true` (hidden). This is the fire-AT-MOST-ONCE pattern; the
 *     setState in effect is intentional.
 *   - `set(next)` writes/removes the sessionStorage flag and updates
 *     local state. `next === true` writes "1"; `next === false` removes.
 *   - All sessionStorage access is wrapped in try/catch (private mode,
 *     blocked storage, etc.) — fail open.
 *
 * NOT a generic "read sessionStorage" hook — narrow boolean contract
 * keyed on the `=== "1"` truthy convention used across the dismissal
 * sites. Future generalisation (e.g. JSON-typed values) is a separate
 * hook.
 */
export function useSessionStorageBoolean(
  key: string,
): [boolean, (next: boolean) => void] {
  const [value, setValue] = useState(false);

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    try {
      if (sessionStorage.getItem(key) === "1") {
        setValue(true);
      }
    } catch {
      // sessionStorage unavailable (private mode, blocked storage, etc.)
      // — fail open: leave value false so the surface stays visible.
    }
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [key]);

  const set = (next: boolean) => {
    try {
      if (next) sessionStorage.setItem(key, "1");
      else sessionStorage.removeItem(key);
    } catch {
      // best-effort write — local state still updates so the UI reacts.
    }
    setValue(next);
  };

  return [value, set];
}
