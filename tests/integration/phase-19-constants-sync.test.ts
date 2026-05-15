/**
 * Phase 19 / PR-X5 — TEASER_ANCHOR_STRATEGY_ID drift guard.
 *
 * The sentinel anchor UUID is duplicated literally in three places:
 *   1. src/lib/phase-19-constants.ts                 (TS callers)
 *   2. analytics-service/services/teaser_anchor.py   (Python callers)
 *   3. supabase/migrations/132_teaser_anchor_strategy.sql (the row that satisfies the FK)
 *
 * A typo in any single location would surface only at runtime — post
 * flag flip, every teaser submission would 23503 against the
 * strategy_verifications.strategy_id FK because the sentinel the app
 * code names doesn't exist. test_migration_132.py (Python) pins
 * Python ↔ SQL. This vitest pins TS ↔ Python ↔ SQL.
 */

// @vitest-environment node

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { TEASER_ANCHOR_STRATEGY_ID } from "@/lib/phase-19-constants";

const ROOT = resolve(__dirname, "../..");

function readFile(rel: string): string {
  return readFileSync(resolve(ROOT, rel), "utf8");
}

describe("Phase 19 / PR-X5 — TEASER_ANCHOR_STRATEGY_ID drift guard", () => {
  it("TS constant matches the Python constant", () => {
    const pythonSource = readFile(
      "analytics-service/services/teaser_anchor.py",
    );
    // Python: TEASER_ANCHOR_STRATEGY_ID = "00000000-0000-0000-0000-000000000001"
    const match = pythonSource.match(
      /TEASER_ANCHOR_STRATEGY_ID\s*=\s*"([0-9a-fA-F-]+)"/,
    );
    expect(
      match,
      "Python teaser_anchor.py must declare TEASER_ANCHOR_STRATEGY_ID",
    ).not.toBeNull();
    expect(match![1]).toBe(TEASER_ANCHOR_STRATEGY_ID);
  });

  it("TS constant matches the value INSERTed by migration 132", () => {
    const migrationSource = readFile(
      "supabase/migrations/132_teaser_anchor_strategy.sql",
    );
    // The migration's strategies INSERT references the sentinel UUID
    // as a literal `'00000000-...-0001'::uuid`. Assert presence directly.
    expect(
      migrationSource.includes(TEASER_ANCHOR_STRATEGY_ID),
      "Migration 132 must INSERT the strategies row at the TS constant's UUID — drift here causes 23503 FK violation on every teaser submission post-flag-flip",
    ).toBe(true);
  });

  it("constant is a valid UUID v4-shape literal", () => {
    // Defensive: the constant should be a UUID, not an empty string or
    // a typo. Catches accidental edits like a missing segment.
    expect(TEASER_ANCHOR_STRATEGY_ID).toMatch(
      /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/,
    );
  });
});
