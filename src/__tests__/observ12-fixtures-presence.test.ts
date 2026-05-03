import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

// Phase 16 / OBSERV-12 — restore-e2e-fixtures presence gate.
// PR #111 restored the three pre-PR-#90 files (api-key-flow.spec.ts -242 LOC,
// seed-full-app-demo.ts -1721 LOC, observability.ts -28 LOC) bit-for-bit.
// This test fails any future commit that deletes or catastrophically truncates
// any of them, protecting Phase 16's diagnostic harness (Plan 7 SSE, Plan 8
// vcrpy cassettes, all e2e replay flows) from silent regression.
//
// Lower-bound thresholds intentionally allow ~20% drift for line-ending,
// whitespace, or formatter changes; values calibrated against bytes-on-disk
// at planning time (2026-05-01).

const REPO_ROOT = join(__dirname, "..", "..");

interface FixtureSpec {
  path: string;
  minBytes: number;
  recordedBytes: number;
}

const FIXTURES: FixtureSpec[] = [
  { path: "e2e/api-key-flow.spec.ts", minBytes: 8000, recordedBytes: 9861 },
  { path: "scripts/seed-full-app-demo.ts", minBytes: 50000, recordedBytes: 59393 },
  { path: "src/lib/observability.ts", minBytes: 700, recordedBytes: 927 },
];

describe("[OBSERV-12] restore-e2e-fixtures presence gate", () => {
  for (const fixture of FIXTURES) {
    it(`${fixture.path} exists at >= ${fixture.minBytes} bytes (recorded ${fixture.recordedBytes})`, () => {
      const abs = join(REPO_ROOT, fixture.path);
      let stat;
      try {
        stat = statSync(abs);
      } catch (err) {
        throw new Error(
          `OBSERV-12: ${fixture.path} missing — PR #111 restore reverted? (${(err as Error).message})`,
        );
      }
      expect(
        stat.isFile(),
        `OBSERV-12: ${fixture.path} exists but is not a regular file`,
      ).toBe(true);
      expect(
        stat.size,
        `OBSERV-12: ${fixture.path} shrunk to ${stat.size} bytes (min ${fixture.minBytes}); was ${fixture.recordedBytes} at planning time`,
      ).toBeGreaterThanOrEqual(fixture.minBytes);
    });
  }

  it("src/lib/observability.ts exports checkStuckNotifications", () => {
    const src = readFileSync(join(REPO_ROOT, "src/lib/observability.ts"), "utf8");
    expect(
      /export\s+(async\s+)?function\s+checkStuckNotifications/.test(src),
      "OBSERV-12: src/lib/observability.ts exists but no longer exports checkStuckNotifications — PR #111 restore reverted?",
    ).toBe(true);
  });
});
