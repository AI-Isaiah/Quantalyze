/**
 * RED fixture for the `absent-column` class (scripts/live-db-fixture-drift-census.mjs
 * --self-test). Not a real test file — never imported, never run by vitest. Mirrors the
 * ROADMAP's traced `key_hash` defect: an insert payload naming a column the catalogue's table
 * definition does not declare.
 */
import { describe, it } from "vitest";
import { HAS_LIVE_DB, createLiveAdminClient } from "../../src/lib/test-helpers/live-db";

describe("absent-column RED fixture", () => {
  it.skipIf(!HAS_LIVE_DB)("inserts a payload naming a column the catalogue does not declare", async () => {
    const admin = createLiveAdminClient();
    const { data } = await admin
      .from("stub_table")
      .insert({
        known_col: "present",
        missing_col: "absent from the stub_table CREATE TABLE",
      })
      .select("id")
      .single();
    void data;
  });
});
