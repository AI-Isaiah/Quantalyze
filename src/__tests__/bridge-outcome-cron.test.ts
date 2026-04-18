/**
 * Integration test — Migration 060 compute_bridge_outcome_deltas.
 *
 * Sprint 8 Phase 1 Plan 04. Verifies the daily delta-compute cron function
 * against a live Supabase database. Seeds a synthetic linear equity curve
 * (1.00 → 1.30 across 180 days) and proves:
 *
 *   1. compute_bridge_outcome_deltas populates delta_30d/90d/180d correctly
 *      using cumulative equity math (OUTCOME-06).
 *   2. needs_recompute lifecycle: TRUE → FALSE after successful compute (OUTCOME-07).
 *   3. Idempotency — second invocation returns updated_count=0.
 *   4. kind='rejected' rows are NEVER touched (D-19 guard).
 *   5. Re-flipping needs_recompute=true triggers another update.
 *
 * Math verification for a linear curve 1.00 → 1.30 over 180 days:
 *   anchor = 2026-01-01, value = 1.00
 *   day 30  = 1.00 + (0.30 * 30/180) = 1.05  → delta_30d  = (1.05/1.00) - 1 = 0.05
 *   day 90  = 1.00 + (0.30 * 90/180) = 1.15  → delta_90d  = (1.15/1.00) - 1 = 0.15
 *   day 180 = 1.00 + (0.30 * 180/180) = 1.30 → delta_180d = (1.30/1.00) - 1 = 0.30
 *
 * Gate: requires NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
 * Skips gracefully in CI where those point to the placeholder URL.
 *
 * Run locally:
 *   export NEXT_PUBLIC_SUPABASE_URL=...
 *   export SUPABASE_SERVICE_ROLE_KEY=...
 *   npx vitest run src/__tests__/bridge-outcome-cron.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  HAS_LIVE_DB,
  createLiveAdminClient,
  createTestUser,
  cleanupLiveDbRow,
  advertiseLiveDbSkipReason,
} from "@/lib/test-helpers/live-db";
import type { SupabaseClient } from "@supabase/supabase-js";

// Stable synthetic UUIDs — test-only, deterministic for easier cleanup
const STRATEGY_A_ID = "00000000-0000-0000-0000-000000000060";
const STRATEGY_B_ID = "00000000-0000-0000-0000-000000000061";

// Anchor: linear equity curve starts 2026-01-01 at value 1.00
const ANCHOR_DATE = "2026-01-01";

/**
 * Builds a linear cumulative equity curve from 1.00 to 1.30 across `days` days.
 * At i=0: value = 1.00; at i=days: value = 1.30.
 * Shape: [{date: "YYYY-MM-DD", value: number}, ...]
 */
function buildLinearEquityCurve(
  days: number,
): Array<{ date: string; value: number }> {
  const series: Array<{ date: string; value: number }> = [];
  const start = new Date(`${ANCHOR_DATE}T00:00:00Z`).getTime();
  for (let i = 0; i <= days; i++) {
    const d = new Date(start + i * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    const v = 1.0 + (0.3 * i) / days; // 1.00 at i=0, 1.30 at i=days
    series.push({ date: d, value: Number(v.toFixed(6)) });
  }
  return series;
}

describe("bridge-outcome-cron (live-DB)", () => {
  // Advertise skip reason unconditionally — the `it.skipIf` blocks handle
  // individual test gating; this call is non-fatal when HAS_LIVE_DB=true.
  advertiseLiveDbSkipReason("bridge-outcome-cron");

  let admin: SupabaseClient;
  let allocatorId: string;
  let allocatedRowId: string;
  let rejectedRowId: string;

  beforeAll(async () => {
    if (!HAS_LIVE_DB) return;
    admin = createLiveAdminClient();
    allocatorId = await createTestUser(admin, "phase1-cron-04@test.local");

    // Seed minimal strategies rows — FK required by strategy_analytics.
    // strategies.user_id is NOT NULL and has no default; supply allocatorId.
    const stratUpsert = await admin
      .from("strategies")
      .upsert(
        [
          {
            id: STRATEGY_A_ID,
            user_id: allocatorId,
            name: "Phase1 Cron Test A (synthetic)",
          },
          {
            id: STRATEGY_B_ID,
            user_id: allocatorId,
            name: "Phase1 Cron Test B (synthetic)",
          },
        ],
        { onConflict: "id" },
      );
    if (stratUpsert.error) {
      throw new Error(`Failed to seed strategies: ${stratUpsert.error.message}`);
    }

    // Seed returns_series for strategy A (180-day linear curve)
    await admin
      .from("strategy_analytics")
      .upsert(
        {
          strategy_id: STRATEGY_A_ID,
          returns_series: buildLinearEquityCurve(180),
        },
        { onConflict: "strategy_id" },
      );

    // Seed minimal strategy_analytics for strategy B (empty series — rejected
    // row should never be touched regardless)
    await admin
      .from("strategy_analytics")
      .upsert(
        {
          strategy_id: STRATEGY_B_ID,
          returns_series: [],
        },
        { onConflict: "strategy_id" },
      );

    // Seed sent_as_intro match_decisions rows for both strategies.
    // match_decisions.decided_by is NOT NULL; use allocatorId as a synthetic value.
    // The unique partial index uniq_match_dec_sent_per_pair is a WHERE partial index —
    // PostgREST upsert cannot target partial indexes, so we insert with ignoreDuplicates
    // to handle idempotent re-runs gracefully.
    for (const stratId of [STRATEGY_A_ID, STRATEGY_B_ID]) {
      const mdIns = await admin.from("match_decisions").insert(
        {
          allocator_id: allocatorId,
          strategy_id: stratId,
          decision: "sent_as_intro",
          decided_by: allocatorId,
        },
        { ignoreDuplicates: true },
      );
      if (mdIns.error) {
        throw new Error(
          `Failed to seed match_decisions for ${stratId}: ${mdIns.error.message}`,
        );
      }
    }

    // Insert an allocated bridge_outcome at ANCHOR_DATE with needs_recompute=TRUE
    const ins1 = await admin
      .from("bridge_outcomes")
      .insert({
        allocator_id: allocatorId,
        strategy_id: STRATEGY_A_ID,
        kind: "allocated",
        percent_allocated: 10,
        allocated_at: ANCHOR_DATE,
        needs_recompute: true,
      })
      .select("id")
      .single();
    if (ins1.error || !ins1.data) {
      throw new Error(`Failed to insert allocated row: ${ins1.error?.message}`);
    }
    allocatedRowId = ins1.data.id as string;

    // Insert a rejected bridge_outcome — delta fields must remain NULL after cron
    const ins2 = await admin
      .from("bridge_outcomes")
      .insert({
        allocator_id: allocatorId,
        strategy_id: STRATEGY_B_ID,
        kind: "rejected",
        rejection_reason: "mandate_conflict",
        needs_recompute: true,
      })
      .select("id")
      .single();
    if (ins2.error || !ins2.data) {
      throw new Error(`Failed to insert rejected row: ${ins2.error?.message}`);
    }
    rejectedRowId = ins2.data.id as string;
  });

  afterAll(async () => {
    if (!HAS_LIVE_DB) return;
    // Cleanup in reverse FK order
    if (allocatedRowId || rejectedRowId) {
      const ids = [allocatedRowId, rejectedRowId].filter(Boolean);
      await admin.from("bridge_outcomes").delete().in("id", ids);
    }
    // Remove match_decisions rows seeded for this test
    await admin
      .from("match_decisions")
      .delete()
      .eq("allocator_id", allocatorId)
      .in("strategy_id", [STRATEGY_A_ID, STRATEGY_B_ID]);
    // Remove strategy_analytics (FK child of strategies)
    await admin
      .from("strategy_analytics")
      .delete()
      .in("strategy_id", [STRATEGY_A_ID, STRATEGY_B_ID]);
    // Remove strategies (FK parent — delete last)
    await admin
      .from("strategies")
      .delete()
      .in("id", [STRATEGY_A_ID, STRATEGY_B_ID]);
    // Remove test user
    await cleanupLiveDbRow(admin, { userIds: [allocatorId] });
  });

  it.skipIf(!HAS_LIVE_DB)(
    "populates delta_30d ≈ 0.05, delta_90d ≈ 0.15, delta_180d ≈ 0.30 on the allocated row",
    async () => {
      await admin.rpc("compute_bridge_outcome_deltas");

      const { data: row, error } = await admin
        .from("bridge_outcomes")
        .select(
          "delta_30d, delta_90d, delta_180d, needs_recompute, deltas_computed_at",
        )
        .eq("id", allocatedRowId)
        .single();

      expect(error).toBeNull();
      expect(row).not.toBeNull();

      // Linear curve 1.00→1.30 over 180d:
      //   day 30:  1.05/1.00 - 1 = 0.05  (tolerance ±0.002)
      //   day 90:  1.15/1.00 - 1 = 0.15  (tolerance ±0.002)
      //   day 180: 1.30/1.00 - 1 = 0.30  (tolerance ±0.002)
      expect(Number(row!.delta_30d)).toBeGreaterThan(0.048);
      expect(Number(row!.delta_30d)).toBeLessThan(0.052);
      expect(Number(row!.delta_90d)).toBeGreaterThan(0.148);
      expect(Number(row!.delta_90d)).toBeLessThan(0.152);
      expect(Number(row!.delta_180d)).toBeGreaterThan(0.298);
      expect(Number(row!.delta_180d)).toBeLessThan(0.302);

      // needs_recompute cleared after successful compute (OUTCOME-07)
      expect(row!.needs_recompute).toBe(false);
      // deltas_computed_at stamped
      expect(row!.deltas_computed_at).not.toBeNull();
    },
    30_000,
  );

  it.skipIf(!HAS_LIVE_DB)(
    "does NOT update the rejected row (D-19 guard)",
    async () => {
      const { data: row, error } = await admin
        .from("bridge_outcomes")
        .select("delta_30d, delta_90d, delta_180d, needs_recompute")
        .eq("id", rejectedRowId)
        .single();

      expect(error).toBeNull();
      expect(row).not.toBeNull();

      // All delta fields must remain NULL — cron filters on kind='allocated'
      expect(row!.delta_30d).toBeNull();
      expect(row!.delta_90d).toBeNull();
      expect(row!.delta_180d).toBeNull();
      // needs_recompute stays TRUE — cron never cleared it for rejected rows
      expect(row!.needs_recompute).toBe(true);
    },
    30_000,
  );

  it.skipIf(!HAS_LIVE_DB)(
    "is idempotent — second invocation updates 0 rows (OUTCOME-06)",
    async () => {
      const { data, error } = await admin.rpc("compute_bridge_outcome_deltas");

      expect(error).toBeNull();
      // The RPC returns a result set; handle both single-row and array shape
      const row = Array.isArray(data) ? data[0] : data;
      expect(Number(row.updated_count)).toBe(0);
    },
    30_000,
  );

  it.skipIf(!HAS_LIVE_DB)(
    "re-flipping needs_recompute=true triggers another update (OUTCOME-07)",
    async () => {
      // Reset the flag on the allocated row
      await admin
        .from("bridge_outcomes")
        .update({ needs_recompute: true })
        .eq("id", allocatedRowId);

      // Re-run the cron — should pick up the dirty row again
      const { data, error } = await admin.rpc("compute_bridge_outcome_deltas");
      expect(error).toBeNull();
      const row = Array.isArray(data) ? data[0] : data;
      expect(Number(row.updated_count)).toBeGreaterThanOrEqual(1);

      // Confirm needs_recompute is cleared again
      const { data: bo, error: boErr } = await admin
        .from("bridge_outcomes")
        .select("needs_recompute")
        .eq("id", allocatedRowId)
        .single();
      expect(boErr).toBeNull();
      expect(bo!.needs_recompute).toBe(false);
    },
    30_000,
  );
});
