/**
 * Phase 11 / 11-05 / W-02 — Truth-table coverage for `deriveMandateIsSet`.
 *
 * Pure-function unit test: no Supabase mock, no fetch, no DOM. Exercises
 * the 4 cases that drive the MandateQuickSetCard (S2) visibility:
 *   1. mandate row missing                        → false
 *   2. mandate row, both fields null/empty        → false
 *   3. mandate row, max_weight set                → true
 *   4. mandate row, preferred_strategy_types set  → true
 *
 * BLOCK-2 reconciliation invariant (Phase 02 D-09 LOCKED + Phase 11 D-04):
 * the helper is the canonical truth check that the MandateQuickSetCard
 * uses to determine whether to hide on next page load. Saving a typed
 * value (e.g. user types "15" → 0.15) flips Case 1/2 → Case 3 (true);
 * saving an explicit null clear (Reset, D-10) flips Case 3/4 → Case 2
 * (false). The card renders only when this returns false.
 */

import { describe, it, expect, vi } from "vitest";

// queries.ts pulls in @/lib/supabase/admin which imports `server-only`,
// which throws in any non-server-component module load (vitest runs in
// jsdom). The pure-helper test below does NOT exercise any Supabase
// path — we only call deriveMandateIsSet — so stub both clients to a
// no-op `from()` chain. Mirrors the existing src/lib/queries.test.ts
// scaffolding (lines 46-57).
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
    }),
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
    }),
  }),
}));

import { deriveMandateIsSet } from "./queries";
import type { AllocatorPreferences } from "./preferences";

/**
 * Build a stub AllocatorPreferences row with the user-saveable fields
 * the helper checks. Other fields are populated with safe defaults so
 * the cast satisfies the AllocatorPreferences shape.
 */
function pref(
  overrides: Partial<AllocatorPreferences> = {},
): AllocatorPreferences {
  return {
    user_id: "00000000-0000-0000-0000-000000000000",
    mandate_archetype: null,
    target_ticket_size_usd: null,
    excluded_exchanges: null,
    max_drawdown_tolerance: null,
    min_track_record_days: null,
    min_sharpe: null,
    max_aum_concentration: null,
    preferred_strategy_types: null,
    preferred_markets: null,
    founder_notes: null,
    edited_by_user_id: null,
    updated_at: "2026-04-26T00:00:00.000Z",
    max_weight: null,
    correlation_ceiling: null,
    liquidity_preference: null,
    style_exclusions: null,
    mandate_edited_at: null,
    scoring_weight_overrides: null,
    ...overrides,
  };
}

describe("deriveMandateIsSet — 4-case truth table (Phase 11 / W-02)", () => {
  it("Case 1: mandate row missing → false", () => {
    expect(deriveMandateIsSet(null)).toBe(false);
  });

  it("Case 2a: mandate exists, both fields null → false", () => {
    expect(
      deriveMandateIsSet(
        pref({ max_weight: null, preferred_strategy_types: null }),
      ),
    ).toBe(false);
  });

  it("Case 2b: mandate exists, max_weight null + preferred_strategy_types empty array → false", () => {
    expect(
      deriveMandateIsSet(
        pref({ max_weight: null, preferred_strategy_types: [] }),
      ),
    ).toBe(false);
  });

  it("Case 3a: mandate exists, max_weight set (0.15) + preferred_strategy_types null → true", () => {
    expect(
      deriveMandateIsSet(
        pref({ max_weight: 0.15, preferred_strategy_types: null }),
      ),
    ).toBe(true);
  });

  it("Case 3b: mandate exists, max_weight set (0.20) + preferred_strategy_types empty array → true", () => {
    expect(
      deriveMandateIsSet(
        pref({ max_weight: 0.2, preferred_strategy_types: [] }),
      ),
    ).toBe(true);
  });

  it("Case 4a: mandate exists, max_weight null + preferred_strategy_types non-empty (['Long-Only']) → true", () => {
    expect(
      deriveMandateIsSet(
        pref({ max_weight: null, preferred_strategy_types: ["Long-Only"] }),
      ),
    ).toBe(true);
  });

  it("Case 4b: mandate exists, max_weight 0 (a saved-zero edge case) treated as set → true", () => {
    // 0 is a valid persisted value; only null/undefined is "unset".
    expect(
      deriveMandateIsSet(
        pref({ max_weight: 0, preferred_strategy_types: null }),
      ),
    ).toBe(true);
  });

  it("Both set — max_weight + preferred_strategy_types both populated → true", () => {
    expect(
      deriveMandateIsSet(
        pref({
          max_weight: 0.15,
          preferred_strategy_types: ["Long-Only", "Market Neutral"],
        }),
      ),
    ).toBe(true);
  });
});
