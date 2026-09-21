/**
 * GREEN fixture for the `unexposed-schema` class (scripts/live-db-fixture-drift-census.mjs
 * --self-test). Not a real test file — never imported, never run by vitest.
 */
import { describe, it } from "vitest";
import { HAS_LIVE_DB, createLiveAdminClient } from "../../src/lib/test-helpers/live-db";

describe("unexposed-schema GREEN fixture", () => {
  it.skipIf(!HAS_LIVE_DB)("targets a schema config.toml DOES expose to PostgREST", async () => {
    const admin = createLiveAdminClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const scoped = (admin as any).schema("public");
    const { data } = await scoped.from("stub_table").select("known_col");
    void data;
  });
});
