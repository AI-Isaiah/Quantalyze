/**
 * Phase 167.2.1 (FACTSHEETBUILDABLE) — SC1, the WR-02 mismatch reproduced on
 * REAL rows on the local-stack lane.
 *
 * THE CLAIM UNDER TEST. The owner's surfaces call a strategy "computed" when
 * its `strategy_analytics.computation_status` is a terminal success, read
 * through the owner's RLS-scoped embed. The share recipient sees whatever
 * `fetchAndBuildPayload` builds. Two real populations read 'complete' to the
 * owner and still build nothing:
 *   - a single-key row whose `daily_returns` holds ONE dated point;
 *   - a pre-Phase-86 composite (`data_quality_flags.composite` true,
 *     `metrics_json_by_basis` NULL) that has csv_daily_returns rows.
 * A CONTROL row with 30 dated points proves this harness can build at all, so a
 * green REPRO arm cannot be a harness that never builds anything.
 *
 * HOST. The live-DB lane boots a private local stack
 * (`scripts/local-stack/run.sh up`); this spec never touches a shared project.
 * It asserts only about its own rows and deletes them in dependency order.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

// The real `createAdminClient` imports `server-only`, which throws outside a
// server bundle. The lane supplies the service-role env it reads.
vi.mock("server-only", () => ({}));

import {
  HAS_LIVE_DB,
  createLiveAdminClient,
  signInAsTestUser,
  cleanupLiveDbRow,
  advertiseLiveDbSkipReason,
} from "@/lib/test-helpers/live-db";
import { fetchAndBuildPayload, probeFactsheetBuildable } from "@/lib/factsheet/fetch-and-build-payload";
import { withPublishedOrOwner } from "@/lib/visibility";

/** N consecutive synthetic calendar days from 2024-01-02, as {date, value}. */
function points(n: number): { date: string; value: number }[] {
  const out: { date: string; value: number }[] = [];
  const start = Date.parse("2024-01-02T00:00:00Z");
  for (let i = 0; i < n; i++) {
    const date = new Date(start + i * 86_400_000).toISOString().slice(0, 10);
    out.push({ date, value: ((i % 7) - 3) / 1000 });
  }
  return out;
}

async function insertStrategy(admin: SupabaseClient, userId: string, name: string): Promise<string> {
  const { data, error } = await admin
    .from("strategies")
    .insert({
      user_id: userId,
      name,
      status: "draft",
      source: "csv",
      strategy_types: [],
      subtypes: [],
      markets: [],
      supported_exchanges: [],
    } as never)
    .select("id")
    .single();
  if (error || !data) throw new Error(`seed strategies (${name}): ${error?.message}`);
  return (data as { id: string }).id;
}

advertiseLiveDbSkipReason("factsheet-buildable-live-db");

describe.skipIf(!HAS_LIVE_DB)("FACTSHEETBUILDABLE SC1 — computed to the owner, unbuildable to the recipient", () => {
  let admin: SupabaseClient;
  let owner: SupabaseClient;
  let ownerId = "";
  const strategyIds: string[] = [];
  let singleId = "";
  let compositeId = "";
  let controlId = "";
  const ownerVisibility = <Q,>(q: Q): Q => withPublishedOrOwner(q, ownerId);

  beforeAll(async () => {
    admin = createLiveAdminClient();
    const signed = await signInAsTestUser(admin, "factsheet-buildable");
    owner = signed.client;
    ownerId = signed.userId;

    singleId = await insertStrategy(admin, ownerId, "__test_fb_single_one_point");
    strategyIds.push(singleId);
    compositeId = await insertStrategy(admin, ownerId, "__test_fb_composite_pre86");
    strategyIds.push(compositeId);
    controlId = await insertStrategy(admin, ownerId, "__test_fb_control");
    strategyIds.push(controlId);

    const single = await admin.from("strategy_analytics").insert({
      strategy_id: singleId,
      computation_status: "complete",
      daily_returns: [{ date: "2024-01-02", value: 0.01 }],
      returns_series: null,
    } as never);
    if (single.error) throw new Error(`seed single analytics: ${single.error.message}`);

    const composite = await admin.from("strategy_analytics").insert({
      strategy_id: compositeId,
      computation_status: "complete",
      data_quality_flags: { composite: true },
      metrics_json_by_basis: null,
    } as never);
    if (composite.error) throw new Error(`seed composite analytics: ${composite.error.message}`);
    const csvA = await admin
      .from("csv_daily_returns")
      .insert({ strategy_id: compositeId, date: "2024-01-02", daily_return: 0.01 } as never);
    if (csvA.error) throw new Error(`seed composite csv row 1: ${csvA.error.message}`);
    const csvB = await admin
      .from("csv_daily_returns")
      .insert({ strategy_id: compositeId, date: "2024-01-03", daily_return: -0.005 } as never);
    if (csvB.error) throw new Error(`seed composite csv row 2: ${csvB.error.message}`);

    const control = await admin.from("strategy_analytics").insert({
      strategy_id: controlId,
      computation_status: "complete",
      daily_returns: points(30),
      returns_series: null,
    } as never);
    if (control.error) throw new Error(`seed control analytics: ${control.error.message}`);
  });

  afterAll(async () => {
    if (!admin) return;
    for (const id of strategyIds) {
      await admin.from("csv_daily_returns").delete().eq("strategy_id", id);
      await admin.from("strategy_analytics").delete().eq("strategy_id", id);
    }
    await cleanupLiveDbRow(admin, { strategyIds, userIds: ownerId ? [ownerId] : [] });
  });

  /** What the owner's surfaces read: the RLS-scoped embed's status. */
  async function ownerSeenStatus(id: string): Promise<unknown> {
    const { data, error } = await owner
      .from("strategies")
      .select("id, strategy_analytics ( computation_status )")
      .eq("id", id)
      .maybeSingle();
    if (error) throw new Error(`owner read ${id}: ${error.message}`);
    const embed = (data as { strategy_analytics?: unknown } | null)?.strategy_analytics;
    const row = Array.isArray(embed) ? embed[0] : embed;
    return (row as { computation_status?: unknown } | undefined)?.computation_status;
  }

  it("REPRO-SINGLE-ONE-POINT: the owner reads 'complete' and the builder returns null", async () => {
    expect(await ownerSeenStatus(singleId)).toBe("complete");
    expect(await fetchAndBuildPayload(singleId, ownerVisibility)).toBeNull();
  });

  it("REPRO-COMPOSITE-PRE86: the owner reads 'complete' and the builder returns null", async () => {
    expect(await ownerSeenStatus(compositeId)).toBe("complete");
    expect(await fetchAndBuildPayload(compositeId, ownerVisibility)).toBeNull();
  });

  it("CONTROL-BUILDABLE: a 30-point complete row builds, so the harness can build", async () => {
    expect(await ownerSeenStatus(controlId)).toBe("complete");
    const payload = await fetchAndBuildPayload(controlId, ownerVisibility);
    expect(payload).not.toBeNull();
    expect(payload?.strategyId).toBe(controlId);
  });

  // SC2 on real rows: the probe answers from the builder's own resolve stage.
  it("PROBE-SINGLE: the probe names the one-point row too_few_points", async () => {
    expect(await probeFactsheetBuildable(singleId, ownerVisibility)).toEqual({
      buildable: false,
      reason: "too_few_points",
    });
  });

  it("PROBE-COMPOSITE: the probe names the pre-Phase-86 composite composite_unbuildable", async () => {
    expect(await probeFactsheetBuildable(compositeId, ownerVisibility)).toEqual({
      buildable: false,
      reason: "composite_unbuildable",
    });
  });

  it("PROBE-CONTROL: the probe calls the 30-point row buildable", async () => {
    expect(await probeFactsheetBuildable(controlId, ownerVisibility)).toEqual({ buildable: true });
  });
});
