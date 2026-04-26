"use client";

import {
  createContext,
  useContext,
  useEffect,
  useSyncExternalStore,
  type ReactNode,
} from "react";

/**
 * Phase 09.1 Plan 11 / R5 accepted — thread `flaggedHoldings.length` from
 * the existing `/allocations` page payload through the layout tree.
 *
 * No new server query, no duplicate RLS surface — the count flows from
 * the data the page already fetches via `getMyAllocationDashboard`.
 *
 * Two consumption surfaces:
 *
 *   1. **In-tree (Context):** Components rendered _inside_ AllocationProvider
 *      can call `useAllocationContext()` to read `{ flaggedCount }`.
 *      Returns `null` when no provider is present.
 *
 *   2. **Out-of-tree (Store):** The Sidebar / DashboardChrome live in the
 *      `(dashboard)/layout.tsx` server tree, _above_ the provider in React
 *      tree order — so plain Context cannot reach them. AllocationProvider
 *      ALSO publishes its current value into a module-level store on every
 *      render; cross-tree consumers (DashboardChrome) read it via
 *      `useFlaggedCountStore()`, which is `useSyncExternalStore`-backed and
 *      stays React-strict-mode-safe.
 *
 * On non-allocations routes, no provider mounts → store reverts to `0` →
 * the sidebar badge stays hidden. The store auto-resets when the provider
 * unmounts so a stale count never leaks into a sibling route.
 */

type AllocationContextValue = {
  flaggedCount: number;
};

export const AllocationContext = createContext<AllocationContextValue | null>(
  null,
);

// ---------------------------------------------------------------------------
// Cross-tree store (out-of-tree subscribers — DashboardChrome / Sidebar).
// ---------------------------------------------------------------------------

let _flaggedCount = 0;
const _listeners = new Set<() => void>();

function setFlaggedCount(next: number) {
  if (next === _flaggedCount) return;
  _flaggedCount = next;
  _listeners.forEach((l) => l());
}

function subscribe(listener: () => void): () => void {
  _listeners.add(listener);
  return () => _listeners.delete(listener);
}

function getSnapshot(): number {
  return _flaggedCount;
}

function getServerSnapshot(): number {
  // SSR: badge defaults to hidden (0) until client-side hydration runs.
  return 0;
}

/**
 * Subscribe to the cross-tree flagged-count store. Use this from
 * components mounted _outside_ AllocationProvider (e.g. DashboardChrome,
 * Sidebar). When no provider is currently mounted the value is `0`.
 */
export function useFlaggedCountStore(): number {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

// ---------------------------------------------------------------------------
// Provider — sits inside the page payload's scope.
// ---------------------------------------------------------------------------

export function AllocationProvider({
  value,
  children,
}: {
  value: AllocationContextValue;
  children: ReactNode;
}) {
  // Publish into the cross-tree store so DashboardChrome / Sidebar
  // (mounted above us) can read the count without a new server fetch.
  //
  // WR-02 fix: split publish-on-change from clear-on-unmount. The
  // previous implementation combined both in a single effect with
  // `value.flaggedCount` in its deps, which meant the cleanup ran on
  // EVERY value change (count → 0 → newCount in two commits). Under
  // React 18 strict mode the badge also flickered count → 0 → count on
  // initial mount. Subscribers now see clean transitions between
  // non-zero counts, with the unmount cleanup intact so a stale value
  // doesn't leak into other routes' sidebars when navigating away.
  useEffect(() => {
    setFlaggedCount(value.flaggedCount);
  }, [value.flaggedCount]);

  useEffect(() => {
    return () => setFlaggedCount(0);
  }, []);

  return (
    <AllocationContext.Provider value={value}>
      {children}
    </AllocationContext.Provider>
  );
}

/**
 * Read the in-tree AllocationContext. Returns `null` when no provider
 * is mounted; consumers should typically prefer `useFlaggedCountStore`
 * if they live above the provider in the React tree.
 */
export function useAllocationContext(): AllocationContextValue | null {
  return useContext(AllocationContext);
}
