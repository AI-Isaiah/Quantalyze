import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { checkFounderStrategyReadiness } from "./readiness";

/**
 * Pins the DELIBERATE LP-facing withhold decision (mig 20260707120000): a
 * `complete_with_warnings` strategy is intentionally NOT ready — the monthly
 * cron withholds the LP PDF and sends a fail-loud alert naming the status,
 * rather than mailing LPs guard-flagged returns. Before the migration the
 * queue-path RPC laundered warned → 'complete', so this gate never saw a
 * warning; now it can. Without this test a well-meaning "consistency fix"
 * switching the gate to isComputedAnalytics() would silently start emailing
 * warned months, with no red test. Per Rule 9 the intent must be encoded.
 */

/** Minimal supabase stub: from(...).select(...).eq(...).single() → {data,error}. */
function mockSupabase(row: unknown): SupabaseClient {
  const chain = {
    select: () => chain,
    eq: () => chain,
    single: () => Promise.resolve({ data: row, error: null }),
  };
  return { from: () => chain } as unknown as SupabaseClient;
}

describe("checkFounderStrategyReadiness — complete_with_warnings is withheld", () => {
  it("withholds a warned month: ok=false, reason names the warned status", async () => {
    const sb = mockSupabase({
      id: "strat-1",
      name: "Founder Fund",
      status: "published",
      strategy_analytics: { computation_status: "complete_with_warnings" },
    });
    const result = await checkFounderStrategyReadiness(sb, "strat-1");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("complete_with_warnings");
    }
  });

  it("still sends a genuinely clean month: complete → ok=true", async () => {
    const sb = mockSupabase({
      id: "strat-1",
      name: "Founder Fund",
      status: "published",
      strategy_analytics: { computation_status: "complete" },
    });
    const result = await checkFounderStrategyReadiness(sb, "strat-1");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.name).toBe("Founder Fund");
  });
});
