/**
 * GREEN fixture for the `ambiguous-overload` class (scripts/live-db-fixture-drift-census.mjs
 * --self-test). Not a real test file — never imported, never run by vitest. Names p_unique,
 * which only the 5-arg-shaped overload declares, so exactly one overload matches.
 */
import { describe, it } from "vitest";
import { HAS_LIVE_DB, createLiveAdminClient } from "../../src/lib/test-helpers/live-db";

describe("ambiguous-overload GREEN fixture", () => {
  it.skipIf(!HAS_LIVE_DB)("calls the same function WITH enough named args to disambiguate", async () => {
    const admin = createLiveAdminClient();
    const { data } = await admin.rpc("stub_fn", { p_unique: 1 });
    void data;
  });
});
