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
});
