/**
 * Phase 91 / QA-01 (CONTEXT D5) — dedicated unit test for `windowsOverlap`.
 *
 * Pins the half-open `[window_start, window_end)` convention (module docstring
 * windowOverlap.ts:16-27) directly, with hand-built `WindowBounds` pairs:
 *   - adjacency (a.end === b.start) is NOT overlap (strict `<`),
 *   - `window_end === null` open-ended semantics (OPEN_ENDED = "9999-12-31"),
 *   - symmetry (asserted in BOTH argument orders on every case).
 *
 * This file deliberately does NOT load
 * analytics-service/tests/fixtures/window_overlap_convention.json — that
 * canonical truth-table is owned by the cross-package drift-guard
 * tests/lib/composite/window-overlap-convention-parity.test.ts. Re-loading it
 * here would be the v1.5 "same inputs / different derivations" anti-pattern in
 * test form (a second copy of the fixture table). These are independent,
 * behaviour-pinning vectors instead.
 */
import { describe, it, expect } from "vitest";
import { windowsOverlap, type WindowBounds } from "./windowOverlap";

/**
 * Assert `windowsOverlap` returns `expected` for BOTH argument orders — the
 * predicate is symmetric by construction and the symmetry must be pinned.
 */
function bothOrders(a: WindowBounds, b: WindowBounds, expected: boolean): void {
  expect(windowsOverlap(a, b)).toBe(expected);
  expect(windowsOverlap(b, a)).toBe(expected);
}

describe("windowsOverlap — half-open [start, end) convention", () => {
  it("case 1 — plain overlap: two windows sharing an interior span overlap", () => {
    bothOrders(
      { window_start: "2025-01-01", window_end: "2025-01-10" },
      { window_start: "2025-01-05", window_end: "2025-01-15" },
      true,
    );
  });

  it("case 2 — disjoint: windows with a gap between them do not overlap", () => {
    bothOrders(
      { window_start: "2025-01-01", window_end: "2025-01-05" },
      { window_start: "2025-01-10", window_end: "2025-01-15" },
      false,
    );
  });

  it("case 3 — adjacency is NOT overlap: a shared handoff boundary (a.end === b.start)", () => {
    // The load-bearing half-open case: the day equal to window_end is EXCLUDED,
    // so windows that only touch at "2025-01-05" do not overlap.
    bothOrders(
      { window_start: "2025-01-01", window_end: "2025-01-05" },
      { window_start: "2025-01-05", window_end: "2025-01-10" },
      false,
    );
  });

  it("case 4 — identical windows overlap", () => {
    bothOrders(
      { window_start: "2025-01-01", window_end: "2025-01-10" },
      { window_start: "2025-01-01", window_end: "2025-01-10" },
      true,
    );
  });

  it("case 5 — containment: a window fully inside another overlaps", () => {
    bothOrders(
      { window_start: "2025-01-01", window_end: "2025-01-31" },
      { window_start: "2025-01-10", window_end: "2025-01-20" },
      true,
    );
  });

  it("case 6 — open-ended (window_end null) overlaps a later-starting window", () => {
    bothOrders(
      { window_start: "2025-01-01", window_end: null },
      { window_start: "2025-06-01", window_end: "2025-07-01" },
      true,
    );
  });

  it("case 6b — an earlier window ending exactly at an open window's start does NOT overlap it", () => {
    // Half-open: the closed window ends at "2025-06-01", the open window starts
    // there — the shared boundary is excluded, so no overlap.
    bothOrders(
      { window_start: "2025-06-01", window_end: null },
      { window_start: "2025-01-01", window_end: "2025-06-01" },
      false,
    );
  });

  it("case 6c — an earlier window ending BEFORE an open window's start does NOT overlap it", () => {
    bothOrders(
      { window_start: "2025-06-01", window_end: null },
      { window_start: "2025-01-01", window_end: "2025-05-01" },
      false,
    );
  });

  it("case 7 — both open-ended: two null-end windows always overlap (both reach OPEN_ENDED)", () => {
    bothOrders(
      { window_start: "2025-01-01", window_end: null },
      { window_start: "2025-06-01", window_end: null },
      true,
    );
  });

  it("case 8 — Zavara-shaped 3-key sequential handoff: all pairwise combinations disjoint", () => {
    // Adjacent boundaries, last key open-ended (mirrors keyWindowsSchema.test.ts
    // :145-153). A clean sequential handoff has ZERO overlapping pairs.
    const k1: WindowBounds = { window_start: "2024-01-01", window_end: "2024-06-01" };
    const k2: WindowBounds = { window_start: "2024-06-01", window_end: "2025-01-01" };
    const k3: WindowBounds = { window_start: "2025-01-01", window_end: null };

    bothOrders(k1, k2, false); // adjacent handoff
    bothOrders(k2, k3, false); // adjacent handoff into the open-ended tail
    bothOrders(k1, k3, false); // non-adjacent, gap-separated by k2
  });
});
