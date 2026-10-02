/**
 * GREEN fixture for the `absent-table` class (scripts/live-db-fixture-drift-census.mjs
 * --self-test). Not a real test file — never imported, never run by vitest.
 */
import { describe, it } from "vitest";
import { HAS_LIVE_DB, createLiveAdminClient } from "../../src/lib/test-helpers/live-db";

describe("absent-table GREEN fixture", () => {
  it.skipIf(!HAS_LIVE_DB)("selects from a relation the catalogue DOES declare", async () => {
    const admin = createLiveAdminClient();
    const { data } = await admin.from("stub_table").select("*");
    void data;
  });
});
