/**
 * RED fixture for the `absent-table` class (scripts/live-db-fixture-drift-census.mjs
 * --self-test). Not a real test file — never imported, never run by vitest. Its ONLY job is to
 * be fed to `classifySource` so the census can prove the rule fires.
 */
import { describe, it } from "vitest";
import { HAS_LIVE_DB, createLiveAdminClient } from "../../src/lib/test-helpers/live-db";

describe("absent-table RED fixture", () => {
  it.skipIf(!HAS_LIVE_DB)("selects from a relation the catalogue does not declare", async () => {
    const admin = createLiveAdminClient();
    const { data } = await admin.from("nonexistent_table").select("*");
    void data;
  });
});
