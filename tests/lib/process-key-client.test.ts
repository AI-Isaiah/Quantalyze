import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * TC-4 (army2 testing-specialist) — focused unit coverage for the
 * unified-handler 503 path (INTERNAL_API_TOKEN missing).
 *
 * The existing finalize-wizard route integration test (I-T3c in
 * tests/integration/process-key-thin-adapters.test.ts:854) asserts
 * `[502, 503]` because the scope-broadening probe always intercepts
 * before the unified delegation runs — every execution lands on 502
 * (probe's KEY_NETWORK_TIMEOUT translation) and the 503 branch in
 * postProcessKey is never exercised by that test. The Testing
 * specialist flagged this as a coverage gap.
 *
 * This file exercises postProcessKey directly so the 503 envelope
 * (token-missing) is unambiguously asserted, including the no-fetch
 * invariant (the helper must short-circuit before reaching the network
 * when the token is absent).
 */

vi.mock("server-only", () => ({}));

vi.mock("@/lib/correlation-id", () => ({
  getCorrelationId: vi.fn(async () => "test-corr-id-tc4"),
}));

import { postProcessKey } from "@/lib/process-key-client";

describe("postProcessKey 503 path (TC-4)", () => {
  let originalToken: string | undefined;
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    originalToken = process.env.INTERNAL_API_TOKEN;
    delete process.env.INTERNAL_API_TOKEN;
    fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof globalThis.fetch;
    process.env.ANALYTICS_SERVICE_URL = "https://analytics.test";
  });

  afterEach(() => {
    if (originalToken !== undefined) {
      process.env.INTERNAL_API_TOKEN = originalToken;
    }
    vi.restoreAllMocks();
  });

  it("token missing → returns ok:false + 503 + no fetch (csv flow)", async () => {
    const result = await postProcessKey({
      flow_type: "csv",
      source: "okx",
      context: { wizard_session_id: "ws-1", fmt: "daily_returns" },
      userId: TEST_USER_ID,
      routeTag: "tc4-csv-finalize",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(503);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("token missing → returns ok:false + 503 + no fetch (onboard flow)", async () => {
    const result = await postProcessKey({
      flow_type: "onboard",
      source: "okx",
      context: { strategy_id: "s-1" },
      userId: TEST_USER_ID,
      routeTag: "tc4-finalize-wizard",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(503);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("token missing → returns ok:false + 503 + no fetch (teaser flow, public)", async () => {
    const result = await postProcessKey({
      flow_type: "teaser",
      source: "okx",
      context: {
        api_key: "k",
        api_secret: "s",
        email: "test@example.com",
      },
      userId: "public",
      routeTag: "tc4-verify-strategy",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(503);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("token missing → returns ok:false + 503 + no fetch (resync flow)", async () => {
    const result = await postProcessKey({
      flow_type: "resync",
      source: "binance",
      context: { strategy_id: "s-2" },
      userId: TEST_USER_ID,
      routeTag: "tc4-keys-sync",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(503);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

const TEST_USER_ID = "00000000-0000-0000-0000-000000000abc";
