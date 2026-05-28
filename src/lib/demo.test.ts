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
import {
  ACTIVE_PORTFOLIO_ID as SEED_ACTIVE_PORTFOLIO_ID,
  ALLOCATOR_ACTIVE as SEED_ALLOCATOR_ACTIVE,
  ALLOCATOR_COLD as SEED_ALLOCATOR_COLD,
  ALLOCATOR_STALLED as SEED_ALLOCATOR_STALLED,
  COLD_PORTFOLIO_ID as SEED_COLD_PORTFOLIO_ID,
  STALLED_PORTFOLIO_ID as SEED_STALLED_PORTFOLIO_ID,
} from "../../scripts/seed-demo-profiles";
import { PERSONAS } from "./personas";

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

// H-1020 (audit-2026-05-07) — anti-drift guard. The audit chain identified
// these 6 UUIDs as duplicated across src/lib/demo.ts AND scripts/seed-demo-data.ts
// (via re-export from seed-demo-profiles.ts). The original red-team finding noted
// the previously-claimed seed-integrity drift catch was unverifiable here.
// Direct equality between the two import sites pins the canonical pair so a
// future PR that edits one file without the other fails this suite, not
// /demo at runtime.
describe("demo constants ↔ seed-demo-profiles drift (H-1020)", () => {
  it("ALLOCATOR_* UUIDs are byte-identical between demo.ts and the seed module", () => {
    expect(ALLOCATOR_COLD_ID).toBe(SEED_ALLOCATOR_COLD);
    expect(ALLOCATOR_ACTIVE_ID).toBe(SEED_ALLOCATOR_ACTIVE);
    expect(ALLOCATOR_STALLED_ID).toBe(SEED_ALLOCATOR_STALLED);
  });

  it("*_PORTFOLIO_ID UUIDs are byte-identical between demo.ts and the seed module", () => {
    expect(ACTIVE_PORTFOLIO_ID).toBe(SEED_ACTIVE_PORTFOLIO_ID);
    expect(COLD_PORTFOLIO_ID).toBe(SEED_COLD_PORTFOLIO_ID);
    expect(STALLED_PORTFOLIO_ID).toBe(SEED_STALLED_PORTFOLIO_ID);
  });

  // Red-team F2 follow-up: the same 3 allocator UUIDs are ALSO encoded in
  // src/lib/personas.ts (the /demo query-param resolver). Pin those too —
  // otherwise a partial rename touches demo.ts + seed-demo-profiles.ts but
  // silently leaves personas.ts pointing at stale UUIDs, breaking the
  // public /demo?persona= lane without any test failing here.
  //
  // The matching 3 UUIDs in scripts/seed-full-app-demo.ts are out of import
  // scope for this lib-level test (script lives outside the src/ tree); they
  // are covered transitively because that script seeds the same persona
  // rows and an E2E run against a stale UUID would fail.
  it("PERSONAS UUIDs in personas.ts match the seed module (F2)", () => {
    expect(PERSONAS.active).toBe(SEED_ALLOCATOR_ACTIVE);
    expect(PERSONAS.cold).toBe(SEED_ALLOCATOR_COLD);
    expect(PERSONAS.stalled).toBe(SEED_ALLOCATOR_STALLED);
  });
});
