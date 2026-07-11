/**
 * Phase 88 / ONB-02 — cross-package drift-guard for the ONE overlap spec.
 *
 * The window-overlap convention has TWO implementations bound to ONE truth
 * table (the v1.5 "same inputs / different derivations = silent divergence"
 * lesson):
 *   - analytics-service/services/stitch_composite.py  (`windows_overlap`)
 *   - src/lib/composite/windowOverlap.ts               (`windowsOverlap`)
 *
 * The canonical truth table lives in
 * analytics-service/tests/fixtures/window_overlap_convention.json (its
 * `consumers[]` names THIS validator). This test loads that fixture via
 * fs.readFileSync across the package boundary (the exact idiom used by
 * tests/lib/admin/pii-scrub-python-parity.test.ts) and asserts the TS
 * predicate agrees with every case. A silent divergence in either direction
 * reddens CI.
 *
 * NO Python execution, NO AST parsing — the fixture is structured JSON, so we
 * parse `.cases` directly. The fixture must NOT be moved or copied (that would
 * break the Phase-86 Python consumer path and create a second source of truth).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { windowsOverlap } from "@/lib/composite/windowOverlap";

const FIXTURE = resolve(
  process.cwd(),
  "analytics-service/tests/fixtures/window_overlap_convention.json",
);

interface OverlapCase {
  name: string;
  a_start: string;
  a_end: string | null;
  b_start: string;
  b_end: string | null;
  overlaps: boolean;
}

interface OverlapSpec {
  cases: OverlapCase[];
}

const spec = JSON.parse(readFileSync(FIXTURE, "utf8")) as OverlapSpec;

describe("windowsOverlap mirrors the canonical window_overlap_convention.json", () => {
  // Silent-shrink guard (pii-scrub idiom): the fixture ships exactly 10 cases.
  // If cases are removed the corpus silently weakens — fail loud here.
  it("loads at least the 10 canonical convention cases", () => {
    expect(
      spec.cases.length,
      "window_overlap_convention.json must carry at least 10 cases (the canonical convention corpus); a shrunk fixture silently weakens the drift-guard",
    ).toBeGreaterThanOrEqual(10);
  });

  it.each(spec.cases)(
    "agrees with the fixture on case '$name' (expected overlaps=$overlaps)",
    (c) => {
      const a = { window_start: c.a_start, window_end: c.a_end };
      const b = { window_start: c.b_start, window_end: c.b_end };
      expect(windowsOverlap(a, b)).toBe(c.overlaps);
    },
  );

  it.each(spec.cases)(
    "is symmetric on case '$name' — windowsOverlap(a,b) === windowsOverlap(b,a)",
    (c) => {
      const a = { window_start: c.a_start, window_end: c.a_end };
      const b = { window_start: c.b_start, window_end: c.b_end };
      expect(windowsOverlap(a, b)).toBe(windowsOverlap(b, a));
    },
  );

  // Load-bearing edges named explicitly so a regression on any one of these
  // boundary conventions is unmistakable in the test report.
  it("adjacent_handoff_not_overlapping — a shared handoff boundary is NOT overlap", () => {
    expect(
      windowsOverlap(
        { window_start: "2025-01-01", window_end: "2025-01-04" },
        { window_start: "2025-01-04", window_end: "2025-01-07" },
      ),
    ).toBe(false);
  });

  it("single_day_adjacent_not_overlapping — single-day adjacency is NOT overlap", () => {
    expect(
      windowsOverlap(
        { window_start: "2025-01-01", window_end: "2025-01-02" },
        { window_start: "2025-01-02", window_end: "2025-01-03" },
      ),
    ).toBe(false);
  });

  it("open_ended_vs_later_start_overlaps — an open-ended window overlaps a strictly-later window", () => {
    expect(
      windowsOverlap(
        { window_start: "2025-01-01", window_end: null },
        { window_start: "2025-06-01", window_end: "2025-07-01" },
      ),
    ).toBe(true);
  });

  it("both_open_ended_overlap — two open-ended windows always overlap", () => {
    expect(
      windowsOverlap(
        { window_start: "2025-01-01", window_end: null },
        { window_start: "2025-06-01", window_end: null },
      ),
    ).toBe(true);
  });
});
