import { statSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

// Phase 16 / OBSERV-12 — restore-e2e-fixtures presence gate.
// PR #111 restored three pre-PR-#90 files (api-key-flow.spec.ts -242 LOC,
// seed-full-app-demo.ts -1721 LOC, observability.ts -28 LOC) bit-for-bit.
// Two of the three are still guarded here; observability.ts was deliberately
// DELETED — see the removal record above FIXTURES.
// This test fails any future commit that deletes or catastrophically truncates
// a remaining fixture, protecting Phase 16's diagnostic harness (Plan 7 SSE,
// Plan 8 vcrpy cassettes, all e2e replay flows) from silent regression.
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

// WR-11 (Phase 163, 2026-08-26) — REMOVAL RECORD, read this before concluding a
// fixture went missing by accident. The `src/lib/observability.ts` entry
// (`{ minBytes: 700, recordedBytes: 3003 }`) and its companion export-regex test
// were removed here BECAUSE THE GUARDED MODULE WAS DELETED, deliberately, in the
// same commit. Distinguishing a decided removal from a silent drop is the entire
// purpose of an anti-deletion gate, so the decision is recorded rather than left
// as an absence.
//
// Measured immediately before deleting: `checkStuckNotifications` had ZERO
// production callers anywhere in the repo — a repo-wide grep matched only
// planning documents, the module itself, its own test, and this gate. The module
// originated in the v1.0.0 "diagnostic spike" phase and was never wired up, yet
// it was hardened twice regardless, most recently by OPS-06 earlier in this same
// phase. An uncalled monitor reads as coverage while providing none, which is the
// defect class this phase is closing — so the call was DELETE, not invent a cron
// caller nobody asked for. Its behaviour test (src/lib/observability.test.ts) went
// with it.
const FIXTURES: FixtureSpec[] = [
  { path: "e2e/api-key-flow.spec.ts", minBytes: 8000, recordedBytes: 9861 },
  { path: "scripts/seed-full-app-demo.ts", minBytes: 50000, recordedBytes: 59393 },
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

  // Scope note, so the next reader does not mistake this file for a contract
  // test: everything above is a PRESENCE gate — bytes on disk, nothing more. It
  // cannot tell a correct fixture from a corrupted one of the same size. Put
  // behavioural assertions in the fixture's own test, not here.
});
