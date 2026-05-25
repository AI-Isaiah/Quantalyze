/**
 * Regression test for audit finding H-0123 (red-team c8):
 * `removeTile` reads `config.tiles` from the stale closure captured at
 * callback creation time. Two rapid calls within the same render cycle both
 * see the pre-removal `config.tiles`, so both return the tile object and both
 * schedule a `setConfig` filter. The second call's return value is non-null,
 * which means a caller wiring `setToast`/`setRecentlyClosed` to the return
 * value gets two "undo affordance" entries for a single removal — the second
 * tile's undo affordance is overwritten and lost.
 *
 * Fix: a `pendingRemovalsRef` Set (a useRef) records each tileId as it is
 * removed; a second synchronous call for the same tileId short-circuits to
 * `null` because the Set already contains it (the tile is still read from the
 * outer `config.tiles` closure, not from `prev.tiles`). The ref is cleared by a
 * `useEffect` keyed on `[config.tiles]`, so the guard is per-render-batch only —
 * a tile can still be intentionally re-removed after the next render.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useDashboardConfig } from "./useDashboardConfig";

// ---------------------------------------------------------------------------
// Minimal localStorage mock — same pattern as the sibling test file.
// ---------------------------------------------------------------------------

const store = new Map<string, string>();

const localStorageMock = {
  getItem: vi.fn((key: string) => store.get(key) ?? null),
  setItem: vi.fn((key: string, value: string) => { store.set(key, value); }),
  removeItem: vi.fn((key: string) => { store.delete(key); }),
  clear: vi.fn(() => { store.clear(); }),
  get length() { return store.size; },
  key: vi.fn(() => null),
};
vi.stubGlobal("localStorage", localStorageMock);

const sessionStore = new Map<string, string>();
const sessionStorageMock = {
  getItem: vi.fn((key: string) => sessionStore.get(key) ?? null),
  setItem: vi.fn((key: string, value: string) => { sessionStore.set(key, value); }),
  removeItem: vi.fn((key: string) => { sessionStore.delete(key); }),
  clear: vi.fn(() => { sessionStore.clear(); }),
  get length() { return sessionStore.size; },
  key: vi.fn(() => null),
};
vi.stubGlobal("sessionStorage", sessionStorageMock);

// ---------------------------------------------------------------------------
// H-0123 — removeTile rapid double-click race (useDashboardConfig legacy hook)
// ---------------------------------------------------------------------------

describe("H-0123 — removeTile rapid double-click idempotency", () => {
  beforeEach(() => {
    store.clear();
    sessionStore.clear();
    vi.clearAllMocks();
  });

  it("second rapid removeTile call for the same tileId returns null (idempotent)", () => {
    // WHY this matters: a caller (e.g. AllocationDashboard handleClose)
    // wires removeTile's return value to setToast and setRecentlyClosed.
    // If the second call returns the same non-null tile object, the caller
    // creates a duplicate undo affordance — overwriting the first toast and
    // losing the second tile's undo path entirely. After the fix, the second
    // call returns null so the caller can guard `if (!removed) return`.
    const { result } = renderHook(() => useDashboardConfig());

    // equity-curve-1 is the first tile in LEGACY_DEFAULT_LAYOUT.
    const tileId = "equity-curve-1";
    expect(result.current.config.tiles.find((t) => t.i === tileId)).toBeDefined();

    let first: ReturnType<typeof result.current.removeTile> = null;
    let second: ReturnType<typeof result.current.removeTile> = null;

    act(() => {
      // Simulate two rapid clicks — both execute synchronously before React
      // re-renders, so the stale-closure bug fires within the same batch.
      first = result.current.removeTile(tileId);
      second = result.current.removeTile(tileId);
    });

    // First call must find and return the tile.
    expect(first).not.toBeNull();
    expect(first!.i).toBe(tileId);

    // Second call (same render cycle, tile is logically gone) must return null
    // — not the stale tile object. Pre-fix: second === first (both non-null).
    expect(second).toBeNull();

    // Tile must be absent from config after the double-click.
    expect(result.current.config.tiles.find((t) => t.i === tileId)).toBeUndefined();
    // The rest of the tiles must remain.
    expect(result.current.config.tiles.length).toBe(10); // 11 - 1
  });

  it("removeTile on a non-existent tileId returns null (baseline idempotency)", () => {
    const { result } = renderHook(() => useDashboardConfig());

    let removed: ReturnType<typeof result.current.removeTile> = null;
    act(() => {
      removed = result.current.removeTile("ghost-tile-that-does-not-exist");
    });

    expect(removed).toBeNull();
    // No tiles were harmed.
    expect(result.current.config.tiles.length).toBe(11);
  });
});
