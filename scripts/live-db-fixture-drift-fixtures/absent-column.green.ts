/**
 * GREEN fixture for the `absent-column` class (scripts/live-db-fixture-drift-census.mjs
 * --self-test). Not a real test file — never imported, never run by vitest.
 */
import { describe, it } from "vitest";
import { HAS_LIVE_DB, createLiveAdminClient } from "../../src/lib/test-helpers/live-db";

describe("absent-column GREEN fixture", () => {
  it.skipIf(!HAS_LIVE_DB)("inserts a payload naming ONLY columns the catalogue declares", async () => {
    const admin = createLiveAdminClient();
    const { data } = await admin
      .from("stub_table")
      .insert({
        known_col: "present",
      })
      .select("id")
      .single();
    void data;
  });
});
