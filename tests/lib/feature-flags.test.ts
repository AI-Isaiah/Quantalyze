import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Phase 19 / BACKBONE-05 — TS read seam parity test.
 *
 * Mirrors `analytics-service/services/feature_flags.py` semantics:
 *   1. Supabase kill-switch row wins over env var.
 *   2. Env var alone enables; anything else is OFF.
 *   3. 30s in-process cache.
 *   4. Fail-soft on Supabase outage (env decides).
 *   5. `_resetCacheForTests()` clears state between tests.
 */

// `src/lib/feature-flags.ts` imports "server-only" which throws under
// vitest+jsdom. Match the pattern from src/app/api/intro/route.test.ts.
vi.mock("server-only", () => ({}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
}));

import { createAdminClient } from "@/lib/supabase/admin";
import {
  _resetCacheForTests,
  isUnifiedBackboneActive,
} from "@/lib/feature-flags";

type MaybeSingleResult = { data: { value: string } | null; error: null };

function makeAdminMock(killSwitchValue: string | null): {
  client: { from: ReturnType<typeof vi.fn> };
  fromCalls: ReturnType<typeof vi.fn>;
} {
  const data: MaybeSingleResult["data"] =
    killSwitchValue === null ? null : { value: killSwitchValue };
  const maybeSingle = vi.fn().mockResolvedValue({ data, error: null });
  const eq = vi.fn().mockReturnValue({ maybeSingle });
  const select = vi.fn().mockReturnValue({ eq });
  const from = vi.fn().mockReturnValue({ select });
  return { client: { from }, fromCalls: from };
}

describe("isUnifiedBackboneActive (Phase 19 / BACKBONE-05)", () => {
  beforeEach(() => {
    _resetCacheForTests();
    vi.clearAllMocks();
    delete process.env.PROCESS_KEY_UNIFIED_BACKBONE;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("env=on, kill-switch=off → returns false (kill-switch wins)", async () => {
    process.env.PROCESS_KEY_UNIFIED_BACKBONE = "on";
    const { client } = makeAdminMock("off");
    vi.mocked(createAdminClient).mockReturnValue(
      client as unknown as ReturnType<typeof createAdminClient>,
    );

    const result = await isUnifiedBackboneActive();

    expect(result).toBe(false);
  });

  it("env=on, kill-switch=on (or no row) → returns true", async () => {
    process.env.PROCESS_KEY_UNIFIED_BACKBONE = "on";
    const { client } = makeAdminMock(null); // no row in feature_flags
    vi.mocked(createAdminClient).mockReturnValue(
      client as unknown as ReturnType<typeof createAdminClient>,
    );

    const result = await isUnifiedBackboneActive();

    expect(result).toBe(true);
  });

  it("env=off, kill-switch=on → returns false (env decides off)", async () => {
    process.env.PROCESS_KEY_UNIFIED_BACKBONE = "off";
    const { client } = makeAdminMock("on");
    vi.mocked(createAdminClient).mockReturnValue(
      client as unknown as ReturnType<typeof createAdminClient>,
    );

    const result = await isUnifiedBackboneActive();

    expect(result).toBe(false);
  });

  it("createAdminClient throws → falls back to env var (fail-soft)", async () => {
    process.env.PROCESS_KEY_UNIFIED_BACKBONE = "on";
    vi.mocked(createAdminClient).mockImplementation(() => {
      throw new Error("Supabase outage");
    });

    const result = await isUnifiedBackboneActive();

    // env=on AND kill-switch read failed → kill-switch is NOT off, so env decides ON.
    expect(result).toBe(true);
  });

  it("two consecutive calls within 30s read from cache (single Supabase round-trip)", async () => {
    process.env.PROCESS_KEY_UNIFIED_BACKBONE = "on";
    const { client, fromCalls } = makeAdminMock(null);
    vi.mocked(createAdminClient).mockReturnValue(
      client as unknown as ReturnType<typeof createAdminClient>,
    );

    const r1 = await isUnifiedBackboneActive();
    const r2 = await isUnifiedBackboneActive();

    expect(r1).toBe(true);
    expect(r2).toBe(true);
    // Only the first call hits Supabase; the second is served from cache.
    expect(fromCalls).toHaveBeenCalledTimes(1);
  });

  it("_resetCacheForTests() clears the cache so a follow-up call re-reads", async () => {
    process.env.PROCESS_KEY_UNIFIED_BACKBONE = "on";
    const { client, fromCalls } = makeAdminMock(null);
    vi.mocked(createAdminClient).mockReturnValue(
      client as unknown as ReturnType<typeof createAdminClient>,
    );

    await isUnifiedBackboneActive();
    _resetCacheForTests();
    await isUnifiedBackboneActive();

    expect(fromCalls).toHaveBeenCalledTimes(2);
  });

  // CT-9 (army2) — on a cache miss, 100 concurrent callers must collapse
  // to exactly ONE Supabase round-trip (single-flight). Pre-fix every
  // caller fired its own admin-client read, hammering Supabase on
  // cold-start spikes or after TTL expiry. Mirrors the asyncio.Lock
  // single-flight already added on the Python side in CR-perf-3.
  it("100 concurrent callers on cache miss collapse to one Supabase read (CT-9)", async () => {
    process.env.PROCESS_KEY_UNIFIED_BACKBONE = "on";

    // Build a controlled-delay maybeSingle so all 100 callers race.
    let resolveSupabase: (() => void) | null = null;
    const supabaseGate = new Promise<void>((resolve) => {
      resolveSupabase = resolve;
    });
    const maybeSingle = vi.fn(async () => {
      await supabaseGate;
      return { data: null, error: null };
    });
    const eq = vi.fn().mockReturnValue({ maybeSingle });
    const select = vi.fn().mockReturnValue({ eq });
    const from = vi.fn().mockReturnValue({ select });
    vi.mocked(createAdminClient).mockReturnValue(
      { from } as unknown as ReturnType<typeof createAdminClient>,
    );

    // Fire 100 concurrent callers BEFORE the supabase mock resolves.
    const callers = Array.from({ length: 100 }, () => isUnifiedBackboneActive());

    // Yield to the event loop so each caller's first await lands.
    await Promise.resolve();
    await Promise.resolve();

    // Now release the supabase mock so the in-flight read finishes.
    resolveSupabase!();
    const results = await Promise.all(callers);

    // All 100 must observe the same value.
    expect(results.every((v) => v === true)).toBe(true);
    // CT-9 invariant: only ONE Supabase round-trip across all 100 callers.
    expect(from).toHaveBeenCalledTimes(1);
    expect(maybeSingle).toHaveBeenCalledTimes(1);
  });

  // TC-1 (army2 testing-specialist) — I-API3 outage prev-cache-hold has a
  // semantically distinct branch: when supabase throws AND a prior cache
  // entry exists, the held value comes from the prior cache, NOT the env
  // var. Without this regression test, a future refactor that simplifies
  // the outage branch to env-fallback (the Python sibling's behavior) would
  // silently regress and every other TS test would still pass.
  it("supabase outage with prior cache holds prev value, not env (TC-1 / I-API3)", async () => {
    process.env.PROCESS_KEY_UNIFIED_BACKBONE = "on";

    // Step 1: prime the cache with kill_switch=null (env=on → cached value=true).
    const { client, fromCalls } = makeAdminMock(null);
    vi.mocked(createAdminClient).mockReturnValue(
      client as unknown as ReturnType<typeof createAdminClient>,
    );
    const primed = await isUnifiedBackboneActive();
    expect(primed).toBe(true);
    expect(fromCalls).toHaveBeenCalledTimes(1);

    // Step 2: flip env=off AND swap supabase mock to throw. If the outage
    // branch falls through to env (Python parity), next call returns false.
    // If it holds prev cache (TS I-API3 invariant), next call returns true.
    process.env.PROCESS_KEY_UNIFIED_BACKBONE = "off";
    vi.mocked(createAdminClient).mockImplementation(() => {
      throw new Error("Supabase outage");
    });

    // Step 3: advance time past the 30s TTL so the cache miss path runs.
    const realDateNow = Date.now;
    const advancedNow = realDateNow() + 31_000;
    vi.spyOn(Date, "now").mockReturnValue(advancedNow);

    const heldValue = await isUnifiedBackboneActive();

    // I-API3 invariant: prev cached value (true) is held across the outage
    // even though env is now off.
    expect(heldValue).toBe(true);

    vi.spyOn(Date, "now").mockRestore?.();
  });
});
