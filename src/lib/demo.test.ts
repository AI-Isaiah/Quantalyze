import { describe, it, expect } from "vitest";
import {
  ACTIVE_PORTFOLIO_ID,
  ALLOCATOR_ACTIVE_ID,
  ALLOCATOR_COLD_ID,
  ALLOCATOR_STALLED_ID,
  COLD_PORTFOLIO_ID,
  DEMO_PORTFOLIO_ALLOWLIST,
  STALLED_PORTFOLIO_ID,
  isDemoPortfolioId,
} from "./demo";

/**
 * Demo allocator + portfolio constants MUST stay in sync with
 * scripts/seed-demo-data.ts. Hard-coding values in this test is deliberate
 * — drift breaks the public /demo lane and any of these tests will catch it.
 */
describe("demo allocator UUIDs", () => {
  it("matches the seed-demo-data.ts ALLOCATOR_ACTIVE UUID", () => {
    expect(ALLOCATOR_ACTIVE_ID).toBe("aaaaaaaa-0001-4000-8000-000000000002");
  });

  it("includes COLD and STALLED allocator UUIDs", () => {
    expect(ALLOCATOR_COLD_ID).toBe("aaaaaaaa-0001-4000-8000-000000000001");
    expect(ALLOCATOR_STALLED_ID).toBe("aaaaaaaa-0001-4000-8000-000000000003");
  });

  it("is a v4 UUID string", () => {
    expect(ALLOCATOR_ACTIVE_ID).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });
});

describe("demo portfolio allowlist", () => {
  it("contains the 3 persona portfolio IDs", () => {
    expect(DEMO_PORTFOLIO_ALLOWLIST.size).toBe(3);
    expect(DEMO_PORTFOLIO_ALLOWLIST.has(ACTIVE_PORTFOLIO_ID)).toBe(true);
    expect(DEMO_PORTFOLIO_ALLOWLIST.has(COLD_PORTFOLIO_ID)).toBe(true);
    expect(DEMO_PORTFOLIO_ALLOWLIST.has(STALLED_PORTFOLIO_ID)).toBe(true);
  });

  it("rejects arbitrary portfolio IDs", () => {
    expect(isDemoPortfolioId("not-a-portfolio")).toBe(false);
    expect(
      isDemoPortfolioId("dddddddd-0000-0000-0000-000000000000"),
    ).toBe(false);
    expect(isDemoPortfolioId("")).toBe(false);
  });

  it("accepts the 3 persona portfolio IDs", () => {
    expect(isDemoPortfolioId(ACTIVE_PORTFOLIO_ID)).toBe(true);
    expect(isDemoPortfolioId(COLD_PORTFOLIO_ID)).toBe(true);
    expect(isDemoPortfolioId(STALLED_PORTFOLIO_ID)).toBe(true);
  });
});
