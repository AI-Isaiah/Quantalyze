/**
 * Phase 149 / 149-02 Task 1 — `deriveStrategylessKeys` truth table (Delta 5).
 *
 * Pure-function unit test: no Supabase mock beyond the module-load stubs, no
 * fetch, no DOM. The derivation answers ONE question per active key: "does the
 * owner already have a LIVE strategy covering this key?" — and a key answers
 * "no" only when neither link form covers it.
 *
 * WHY the two link forms both matter (PROD census 2026-08-05): the founder's
 * account holds 8 active keys and 4 strategies. Three strategies carry a key
 * via the direct `strategies.api_key_id` column; the fourth (Alpha Centauri)
 * is a COMPOSITE that carries its 3 keys via the `strategy_keys` join table
 * (migration 20260710120000) and has `api_key_id: null`. An `api_key_id`-only
 * anti-join therefore fabricates 3 spurious "no strategy yet" placeholders on
 * the founder's own account — the exact defect the census caught. The
 * founder-census case below is that falsifier: drop the `strategy_keys` union
 * from the implementation and it goes RED with 5 keys instead of 2.
 *
 * WHY archived is not coverage (checker W-4 ruling, 2026-08-05): an archived
 * strategy is not a live destination for a key's data — the owner archived it.
 * Its key must reappear as a placeholder so the owner can re-derive, and the
 * archived row itself is excluded from the ranked list (`getMyStrategies`
 * carries `.neq("status", "archived")`). The archived fixtures below pin BOTH
 * link forms with the `"archived"` status literal, each paired with an
 * otherwise-identical `"private"` control so the test cannot pass by ignoring
 * status entirely.
 */

import { describe, it, expect, vi } from "vitest";

// queries.ts pulls in @/lib/supabase/admin which imports `server-only`, which
// throws on any non-server-component module load (vitest runs in jsdom). This
// spec exercises only the pure derivation, so stub both clients to a no-op
// `from()` chain. Mirrors src/lib/queries.mandateIsSet.test.ts:27-39.
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

import { deriveStrategylessKeys } from "./queries";
import type { SupportedExchange } from "./utils";

type KeyFixture = {
  id: string;
  exchange: SupportedExchange;
  label: string;
  is_active: boolean;
  sync_status: string | null;
  disconnected_at: string | null;
};

/** An eligible key per `isPerKeyDailiesEligibleKey` (queries.ts:2436-2443). */
function key(id: string, overrides: Partial<KeyFixture> = {}): KeyFixture {
  return {
    id,
    exchange: "binance",
    label: `Key ${id}`,
    is_active: true,
    sync_status: "connected",
    disconnected_at: null,
    ...overrides,
  };
}

describe("deriveStrategylessKeys — founder census (both link forms)", () => {
  it("returns EXACTLY the 2 bare keys when 3 are covered directly and 3 via strategy_keys", () => {
    // PROD census 2026-08-05: 8 active keys → 4 strategies → 2 bare keys.
    const keys = [
      key("k1"),
      key("k2", { exchange: "okx" }),
      key("k3", { exchange: "bybit" }),
      key("k4", { exchange: "deribit" }),
      key("k5", { exchange: "deribit" }),
      key("k6", { exchange: "deribit" }),
      key("k7", { exchange: "sfox", label: "sFOX main" }),
      key("k8", { exchange: "mt5", label: "MT5 live" }),
    ];
    const ownStrategies = [
      { id: "s1", api_key_id: "k1", status: "private" },
      { id: "s2", api_key_id: "k2", status: "draft" },
      { id: "s3", api_key_id: "k3", status: "private" },
      // Alpha Centauri: composite, NO direct api_key_id — its 3 keys are
      // reachable ONLY through strategy_keys.
      { id: "alpha", api_key_id: null, status: "private" },
    ];
    const strategyKeyLinks = [
      { strategy_id: "alpha", api_key_id: "k4" },
      { strategy_id: "alpha", api_key_id: "k5" },
      { strategy_id: "alpha", api_key_id: "k6" },
    ];

    const result = deriveStrategylessKeys(keys, ownStrategies, strategyKeyLinks);

    // The falsifier: an api_key_id-only anti-join returns 5 (k4..k8).
    expect(result.map((k) => k.id)).toEqual(["k7", "k8"]);
  });

  it("projects exactly { id, exchange, label } and preserves input key order", () => {
    const keys = [
      key("kb", { exchange: "mt5", label: "MT5 live" }),
      key("ka", { exchange: "sfox", label: "sFOX main" }),
    ];

    const result = deriveStrategylessKeys(keys, [], []);

    expect(result).toEqual([
      { id: "kb", exchange: "mt5", label: "MT5 live" },
      { id: "ka", exchange: "sfox", label: "sFOX main" },
    ]);
  });

  it("returns all 10 eligible keys for the keys-without-strategies account", () => {
    const keys = Array.from({ length: 10 }, (_, i) => key(`k${i}`));

    const result = deriveStrategylessKeys(keys, [], []);

    expect(result).toHaveLength(10);
  });
});

describe("deriveStrategylessKeys — archived is NOT coverage (W-4 ruling)", () => {
  it("direct link: a key whose ONLY strategy is archived still yields a placeholder", () => {
    const keys = [key("k1")];
    const archived = deriveStrategylessKeys(
      keys,
      [{ id: "s1", api_key_id: "k1", status: "archived" }],
      [],
    );
    expect(archived.map((k) => k.id)).toEqual(["k1"]);

    // Control: the SAME fixture with a live status is covered. Without this
    // pair the test would also pass on an implementation that ignores every
    // strategy row.
    const live = deriveStrategylessKeys(
      keys,
      [{ id: "s1", api_key_id: "k1", status: "private" }],
      [],
    );
    expect(live).toEqual([]);
  });

  it("strategy_keys link: a key linked ONLY to an archived composite still yields a placeholder", () => {
    const keys = [key("k4", { exchange: "deribit" })];
    const links = [{ strategy_id: "alpha", api_key_id: "k4" }];

    const archived = deriveStrategylessKeys(
      keys,
      [{ id: "alpha", api_key_id: null, status: "archived" }],
      links,
    );
    expect(archived.map((k) => k.id)).toEqual(["k4"]);

    const live = deriveStrategylessKeys(
      keys,
      [{ id: "alpha", api_key_id: null, status: "private" }],
      links,
    );
    expect(live).toEqual([]);
  });
});

describe("deriveStrategylessKeys — eligibility + link hygiene", () => {
  it("never returns ineligible keys, even when totally uncovered", () => {
    const keys = [
      key("inactive", { is_active: false }),
      key("revoked", { sync_status: "revoked" }),
      key("disconnected", { disconnected_at: "2026-01-01T00:00:00Z" }),
      key("eligible"),
    ];

    const result = deriveStrategylessKeys(keys, [], []);

    expect(result.map((k) => k.id)).toEqual(["eligible"]);
  });

  it("ignores null api_key_id (CSV strategies carry no key)", () => {
    const keys = [key("k1")];

    const result = deriveStrategylessKeys(
      keys,
      [
        { id: "csv1", api_key_id: null, status: "published" },
        { id: "csv2", api_key_id: null, status: "draft" },
      ],
      [],
    );

    // A null api_key_id must not be treated as "covers the key whose id is
    // null-ish" nor suppress an unrelated key.
    expect(result.map((k) => k.id)).toEqual(["k1"]);
  });

  it("a key linked twice (two disjoint windows) is covered exactly once", () => {
    // strategy_keys has NO (strategy_id, api_key_id) uniqueness constraint —
    // one key can hold two disjoint windows on the same composite.
    const keys = [key("k4", { exchange: "deribit" }), key("k9", { exchange: "okx" })];

    const result = deriveStrategylessKeys(
      keys,
      [{ id: "alpha", api_key_id: null, status: "private" }],
      [
        { strategy_id: "alpha", api_key_id: "k4" },
        { strategy_id: "alpha", api_key_id: "k4" },
      ],
    );

    expect(result.map((k) => k.id)).toEqual(["k9"]);
  });

  it("ignores strategy_keys rows pointing at a strategy the owner does not have", () => {
    // Defence in depth: the reads are owner-scoped, but a dangling link must
    // not silently suppress a placeholder.
    const keys = [key("k1")];

    const result = deriveStrategylessKeys(
      keys,
      [],
      [{ strategy_id: "someone-elses", api_key_id: "k1" }],
    );

    expect(result.map((k) => k.id)).toEqual(["k1"]);
  });
});
