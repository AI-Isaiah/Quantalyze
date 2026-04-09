import { describe, it, expect } from "vitest";
import { ALLOCATOR_ACTIVE_ID } from "./demo";

/**
 * The ALLOCATOR_ACTIVE_ID constant MUST stay in sync with
 * scripts/seed-demo-data.ts::ALLOCATOR_ACTIVE. A drift between the two
 * breaks the hard-assert check in /api/demo/match/[allocator_id] and
 * the /demo page's direct lookup. Hard-coding the value in this test
 * is deliberate — if someone changes demo.ts, they'll get a failing
 * test here AND the seed script comment will remind them to update
 * the seed UUID in tandem.
 */
describe("ALLOCATOR_ACTIVE_ID", () => {
  it("matches the seed-demo-data.ts ALLOCATOR_ACTIVE UUID", () => {
    expect(ALLOCATOR_ACTIVE_ID).toBe("aaaaaaaa-0001-4000-8000-000000000002");
  });

  it("is a v4 UUID string", () => {
    expect(ALLOCATOR_ACTIVE_ID).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });
});
