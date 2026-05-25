import { describe, it, expect, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

// @/lib/admin/match.ts imports "server-only" which throws under vitest+jsdom.
vi.mock("server-only", () => ({}));

import {
  HAS_LIVE_DB,
  createLiveAdminClient,
  advertiseLiveDbSkipReason,
} from "@/lib/test-helpers/live-db";
import { ALLOCATOR_PREFERENCES_COLUMNS } from "@/lib/admin/match";

/**
 * MANDATE-07 — ALLOCATOR_PREFERENCES_COLUMNS schema sync.
 *
 * The exported ALLOCATOR_PREFERENCES_COLUMNS constant in src/lib/admin/match.ts
 * is the contract between the TS layer and the Supabase allocator_preferences
 * table. If a migration adds/drops a column but the constant is not updated
 * in the same PR, the admin PreferencesPanel will silently render blanks for
 * the new columns. This test is the backstop.
 *
 * Two layers:
 *   1. Static: always runs. Parses the string and checks for every Phase 2
 *      required key (plus the edited_by_user_id MANDATE-07 correction).
 *      Guarantees the TS constant was updated in the same PR as migration 061.
 *   2. Live-DB (HAS_LIVE_DB gate): runs a projection-select against the live
 *      allocator_preferences. PostgREST returns HTTP 400 if any column in the
 *      projection does not exist in the table — that surfaces as a non-null
 *      error. Detects schema drift either direction (migration pulled a column,
 *      or the constant references a column that was never applied).
 */

// Parse the comma-separated column string into a Set for O(1) lookups.
const EXPECTED_COLUMNS_SET = new Set(
  ALLOCATOR_PREFERENCES_COLUMNS.split(",").map((c) => c.trim()),
);

advertiseLiveDbSkipReason("mandate-columns-schema-sync");

describe("MANDATE-07: allocator_preferences schema sync", () => {
  it("ALLOCATOR_PREFERENCES_COLUMNS (imported from @/lib/admin/match) contains all Phase 2 mandate columns + edited_by_user_id correction", () => {
    expect(EXPECTED_COLUMNS_SET.has("max_weight")).toBe(true);
    expect(EXPECTED_COLUMNS_SET.has("correlation_ceiling")).toBe(true);
    expect(EXPECTED_COLUMNS_SET.has("liquidity_preference")).toBe(true);
    expect(EXPECTED_COLUMNS_SET.has("style_exclusions")).toBe(true);
    expect(EXPECTED_COLUMNS_SET.has("mandate_edited_at")).toBe(true);
    expect(EXPECTED_COLUMNS_SET.has("edited_by_user_id")).toBe(true);
    // Phase 3 (migration 062)
    expect(EXPECTED_COLUMNS_SET.has("scoring_weight_overrides")).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // H-0020 — break the tautology: tie the TS constant to MIGRATION CONTENT.
  //
  // The static assertions above compare the constant to literals hand-copied
  // from the same PR — they cannot detect "migration added a column, but neither
  // the TS constant NOR the test were updated". This test parses the actual
  // `ADD COLUMN <name>` statements from the mandate migrations (061 + 062) and
  // asserts EVERY migrated allocator_preferences column appears in
  // ALLOCATOR_PREFERENCES_COLUMNS. A new column in a future migration that the
  // PR forgets to add to the constant now FAILS here without anyone having to
  // remember to update a literal list. Runs offline (file read, no DB).
  // ---------------------------------------------------------------------------
  it("every ADD COLUMN in the mandate migrations (061/062) is present in ALLOCATOR_PREFERENCES_COLUMNS", () => {
    const migrationsDir = path.resolve(__dirname, "..", "..", "supabase", "migrations");
    // The two migrations that add allocator_preferences columns. Named by
    // timestamp in this repo; 061 = mandate_columns, 062 = scoring_weight_overrides.
    const migrationFiles = [
      "20260418150632_mandate_columns.sql",
      "20260418194206_scoring_weight_overrides.sql",
    ];

    // Capture `ADD COLUMN [IF NOT EXISTS] <name>` only while inside an
    // `ALTER TABLE allocator_preferences` statement (so we don't pick up
    // columns added to other tables in the same migration, e.g. the
    // `allocator_id` column added to a different table in migration 062).
    const addColumnPattern =
      /\bADD COLUMN\s+(?:IF NOT EXISTS\s+)?([a-z_][a-z0-9_]*)/i;
    const alterApPattern = /ALTER TABLE\s+(?:public\.)?allocator_preferences\b/i;
    const alterOtherPattern =
      /ALTER TABLE\s+(?:public\.)?(?!allocator_preferences\b)\w/i;
    // A bare statement terminator ends the current ALTER TABLE block.
    const stmtEndPattern = /;\s*$/;

    const migratedColumns = new Set<string>();
    for (const file of migrationFiles) {
      const full = path.join(migrationsDir, file);
      const sql = fs.readFileSync(full, "utf8");
      let inAlterAp = false;
      for (const rawLine of sql.split("\n")) {
        const line = rawLine.replace(/--.*$/, ""); // strip line comments
        if (alterApPattern.test(line)) {
          inAlterAp = true;
        } else if (alterOtherPattern.test(line)) {
          inAlterAp = false;
        }
        if (inAlterAp) {
          const matched = line.match(addColumnPattern);
          if (matched) migratedColumns.add(matched[1].toLowerCase());
        }
        if (stmtEndPattern.test(line)) {
          inAlterAp = false;
        }
      }
    }

    // Sanity: the parser actually found columns (guards against a rename of the
    // migration files silently turning this into a vacuous pass).
    expect(migratedColumns.size).toBeGreaterThan(0);

    const missingFromConstant = [...migratedColumns].filter(
      (col) => !EXPECTED_COLUMNS_SET.has(col),
    );
    expect(missingFromConstant).toEqual([]);
  });

  it.skipIf(!HAS_LIVE_DB)(
    "every column in ALLOCATOR_PREFERENCES_COLUMNS actually exists in the live allocator_preferences schema",
    async () => {
      const admin = createLiveAdminClient();
      // PostgREST blocks information_schema queries from the REST layer
      // (RESEARCH.md Validation Architecture). Instead, do a minimal
      // projection select — PostgREST returns HTTP 400 if a column is
      // unknown, which surfaces as a non-null error object.
      const projection = ALLOCATOR_PREFERENCES_COLUMNS;
      const { error } = await admin
        .from("allocator_preferences")
        .select(projection)
        .limit(0);
      if (error) {
        throw new Error(
          `allocator_preferences select(${projection}) failed: ${error.message}. ` +
            `Either the migration did not apply, or ALLOCATOR_PREFERENCES_COLUMNS lists a column that was renamed/removed.`,
        );
      }
      expect(error).toBeNull();
    },
    60_000,
  );
});
