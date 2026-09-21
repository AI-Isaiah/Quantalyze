/**
 * RED fixture for the `unexposed-schema` class (scripts/live-db-fixture-drift-census.mjs
 * --self-test). Not a real test file — never imported, never run by vitest. Mirrors the
 * ROADMAP's traced `Invalid schema: cron` defect: config.toml's [api].schemas list excludes
 * this schema on every host, local-stack included.
 */
import { describe, it } from "vitest";
import { HAS_LIVE_DB, createLiveAdminClient } from "../../src/lib/test-helpers/live-db";

describe("unexposed-schema RED fixture", () => {
  it.skipIf(!HAS_LIVE_DB)("targets a schema config.toml does not expose to PostgREST", async () => {
    const admin = createLiveAdminClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const scoped = (admin as any).schema("private_stub_schema");
    const { data } = await scoped.from("job").select("jobname");
    void data;
  });
});
