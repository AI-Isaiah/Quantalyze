/**
 * Live-DB integration test — /api/match/decisions/holding ownership gate (T-09-03.b).
 *
 * Verifies that allocator B cannot create a match_decision referencing allocator A's
 * holding_ref. The app-layer ownership check (not just RLS) is what prevents this.
 *
 * Gate: requires NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY + BASE_URL.
 * Skips gracefully when those are absent (standard CI without live DB).
 *
 * Run locally:
 *   export NEXT_PUBLIC_SUPABASE_URL=...
 *   export SUPABASE_SERVICE_ROLE_KEY=...
 *   export BASE_URL=http://localhost:3000
 *   npx vitest run src/__tests__/match-decisions-holding-endpoint-rls.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  HAS_LIVE_DB,
  createLiveAdminClient,
  createTestUser,
  advertiseLiveDbSkipReason,
} from "@/lib/test-helpers/live-db";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";

describe("/api/match/decisions/holding ownership gate (live-DB / T-09-03.b)", () => {
  advertiseLiveDbSkipReason("match-decisions-holding-endpoint-rls");

  let allocAId: string;
  let allocBId: string;
  let allocBToken: string;
  let cleanupHoldingId: string | undefined;
  let cleanupDecisionId: string | undefined;

  beforeAll(async () => {
    if (!HAS_LIVE_DB) return;
    const admin = createLiveAdminClient();

    const tsA = Date.now();
    const tsB = tsA + 1;
    allocAId = await createTestUser(
      admin,
      `test-alloc-a-${tsA}@example-rls.test`,
    );
    allocBId = await createTestUser(
      admin,
      `test-alloc-b-${tsB}@example-rls.test`,
    );

    // Get auth tokens for A and B via sign-in
    const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const supaAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    const { createClient } = await import("@supabase/supabase-js");

    const clientB = createClient(supaUrl, supaAnonKey);
    const signInB = await clientB.auth.signInWithPassword({
      email: `test-alloc-b-${tsB}@example-rls.test`,
      password: `LiveDbTest${tsB}!`,
    });
    allocBToken = signInB.data.session?.access_token ?? "";

    // Seed: A owns holding:binance:BTC:spot
    const { data: holdingRow } = await admin
      .from("allocator_holdings")
      .insert({
        allocator_id: allocAId,
        venue: "binance",
        symbol: "BTC",
        holding_type: "spot",
        value_usd: 50000,
        asof: "2026-04-01",
      })
      .select("id")
      .single();
    cleanupHoldingId = holdingRow?.id;
  });

  afterAll(async () => {
    if (!HAS_LIVE_DB) return;
    const admin = createLiveAdminClient();
    if (cleanupDecisionId) {
      await admin.from("match_decisions").delete().eq("id", cleanupDecisionId);
    }
    if (cleanupHoldingId) {
      await admin.from("allocator_holdings").delete().eq("id", cleanupHoldingId);
    }
    if (allocAId) {
      await admin.auth.admin.deleteUser(allocAId);
    }
    if (allocBId) {
      await admin.auth.admin.deleteUser(allocBId);
    }
  });

  it.skipIf(!HAS_LIVE_DB)(
    "Allocator B POSTing with A's holding_ref → 403 Unauthorized (no match_decisions row created)",
    async () => {
      const res = await fetch(`${BASE_URL}/api/match/decisions/holding`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${allocBToken}`,
        },
        body: JSON.stringify({
          holding_ref: "holding:binance:BTC:spot",
          top_candidate_strategy_id: "11111111-2222-3333-4444-555555555555",
        }),
      });
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error).toBe("Unauthorized");

      // Verify no row landed in DB for allocator B
      const admin = createLiveAdminClient();
      const { data } = await admin
        .from("match_decisions")
        .select("id")
        .eq("allocator_id", allocBId);
      expect(data).toEqual([]);
    },
    30_000,
  );
});
