import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * M-0562 — direct unit coverage for `assertPortfolioOwnership`.
 *
 * `assertPortfolioOwnership(portfolioId, userId)` is the single source of
 * truth for IDOR protection across every portfolio-* API route
 * (portfolio-alerts, portfolio-documents, portfolio-pdf, portfolio-optimizer,
 * alerts/critical). Every route test MOCKS it (`assertPortfolioOwnership:
 * async () => true`), so the function's own query shape — the
 * `.eq('id').eq('user_id').maybeSingle()` filter chain and the
 * `data !== null` return contract — was never asserted. A regression that
 * (a) swapped `.maybeSingle()` for `.single()` (which throws on miss instead
 * of returning null), or (b) dropped the `user_id` filter (turning the gate
 * into "any authenticated user can read any portfolio"), would silently
 * break every consumer with NO test failure.
 *
 * These tests pin the wire shape directly.
 */

// vi.hoisted so the mock factory can reach the recorder + per-test response.
const rec = vi.hoisted(() => ({
  // Each .eq() call records (col, value) so we can assert BOTH filters apply.
  eqCalls: [] as Array<[string, unknown]>,
  selectCols: [] as string[],
  // Which terminal resolver the function reached.
  usedMaybeSingle: false,
  usedSingle: false,
  // The row maybeSingle() resolves with (null = no matching/owned row).
  maybeSingleData: null as unknown,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (_table: string) => {
      const chain: Record<string, unknown> = {};
      chain.select = (cols: string) => {
        rec.selectCols.push(cols);
        return chain;
      };
      chain.eq = (col: string, val: unknown) => {
        rec.eqCalls.push([col, val]);
        return chain;
      };
      chain.maybeSingle = () => {
        rec.usedMaybeSingle = true;
        return Promise.resolve({ data: rec.maybeSingleData, error: null });
      };
      // `.single()` is intentionally present so a regression that swaps to it
      // would be caught by the `usedSingle === false` assertion below rather
      // than crashing the mock.
      chain.single = () => {
        rec.usedSingle = true;
        return Promise.resolve({ data: rec.maybeSingleData, error: null });
      };
      return chain;
    },
  }),
}));

// Mock admin client too — queries.ts imports it at module load.
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: () => ({}) }),
}));

vi.mock("@/lib/sentry-capture", () => ({
  captureToSentry: () => undefined,
}));

import { assertPortfolioOwnership } from "@/lib/queries";

describe("assertPortfolioOwnership — IDOR gate (M-0562)", () => {
  beforeEach(() => {
    rec.eqCalls = [];
    rec.selectCols = [];
    rec.usedMaybeSingle = false;
    rec.usedSingle = false;
    rec.maybeSingleData = null;
  });

  it("(a) returns true when a row exists for (portfolio_id, user_id)", async () => {
    rec.maybeSingleData = { id: "pf-1" };
    const owned = await assertPortfolioOwnership("pf-1", "user-1");
    expect(owned).toBe(true);
  });

  it("(b) returns false when no row matches (different user_id ⇒ maybeSingle null)", async () => {
    // The user_id filter excludes the row, so maybeSingle resolves null.
    rec.maybeSingleData = null;
    const owned = await assertPortfolioOwnership("pf-1", "attacker-2");
    expect(owned).toBe(false);
  });

  it("(c) returns false (never throws) when the query yields no data", async () => {
    rec.maybeSingleData = null;
    await expect(
      assertPortfolioOwnership("pf-missing", "user-1"),
    ).resolves.toBe(false);
  });

  it("(d) applies BOTH .eq('id', portfolioId) AND .eq('user_id', userId) before the terminal resolver", async () => {
    rec.maybeSingleData = { id: "pf-1" };
    await assertPortfolioOwnership("pf-1", "user-1");
    // Both tenancy filters must be present — dropping user_id turns the gate
    // into "any authenticated user can read any portfolio".
    expect(rec.eqCalls).toEqual([
      ["id", "pf-1"],
      ["user_id", "user-1"],
    ]);
  });

  it("uses .maybeSingle() (null-on-miss), NOT .single() (throws-on-miss)", async () => {
    rec.maybeSingleData = { id: "pf-1" };
    await assertPortfolioOwnership("pf-1", "user-1");
    expect(rec.usedMaybeSingle).toBe(true);
    expect(rec.usedSingle).toBe(false);
  });

  it("projects a minimal column ('id'), not select *", async () => {
    rec.maybeSingleData = { id: "pf-1" };
    await assertPortfolioOwnership("pf-1", "user-1");
    expect(rec.selectCols).toEqual(["id"]);
  });
});
