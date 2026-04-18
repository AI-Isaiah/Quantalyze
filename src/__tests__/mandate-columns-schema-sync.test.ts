import { describe, it, expect, vi } from "vitest";

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
