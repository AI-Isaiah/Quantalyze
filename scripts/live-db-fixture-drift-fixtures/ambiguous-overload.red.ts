/**
 * RED fixture for the `ambiguous-overload` class (scripts/live-db-fixture-drift-census.mjs
 * --self-test). Not a real test file — never imported, never run by vitest. Mirrors the
 * ROADMAP's traced `PGRST203` defect: the catalogue declares TWO overloads of the same
 * function, and this call's payload does not name enough parameters to disambiguate them (an
 * empty payload is a subset of every overload's parameter set, so it cannot select one).
 */
import { describe, it } from "vitest";
import { HAS_LIVE_DB, createLiveAdminClient } from "../../src/lib/test-helpers/live-db";

describe("ambiguous-overload RED fixture", () => {
  it.skipIf(!HAS_LIVE_DB)("calls a function the catalogue declares twice, with no disambiguation", async () => {
    const admin = createLiveAdminClient();
    const { data } = await admin.rpc("stub_fn", {});
    void data;
  });
});
