import { describe, it, expect } from "vitest";
import type { FactsheetPayload, FactsheetUsdView } from "./types";
import { withTrustTier } from "./with-trust-tier";

/**
 * Phase 164.6.6.2.1 round 1, CR-02 — the tier overlay reaches BOTH payloads of a
 * native-unit strategy. A tier left null on `usdView.payload` is what turned
 * "Data source: API-verified" into a dash in the USD view.
 */
function payloadWithUsd(): FactsheetPayload {
  const usdPayload = { strategyId: "s", trustTier: null, returnsUnit: "USD", convertedFrom: "BTC" } as unknown as FactsheetPayload;
  const usdView = { payload: usdPayload, convertedFrom: "BTC" } as unknown as FactsheetUsdView;
  return { strategyId: "s", trustTier: null, returnsUnit: "BTC", usdView } as unknown as FactsheetPayload;
}

describe("withTrustTier", () => {
  it("overlays the tier on the outer payload AND on usdView.payload", () => {
    const out = withTrustTier(payloadWithUsd(), "api_verified");
    expect(out.trustTier).toBe("api_verified");
    expect(out.usdView!.payload.trustTier).toBe("api_verified");
  });

  it("overlays a null tier on both too (an unverified strategy stays unverified in both views)", () => {
    const seeded = withTrustTier(payloadWithUsd(), "csv_uploaded");
    const out = withTrustTier(seeded, null);
    expect(out.trustTier).toBeNull();
    expect(out.usdView!.payload.trustTier).toBeNull();
  });

  it("leaves every other usdView field untouched", () => {
    const base = payloadWithUsd();
    const out = withTrustTier(base, "self_reported");
    expect(out.usdView!.convertedFrom).toBe("BTC");
    expect(out.usdView!.payload.returnsUnit).toBe("USD");
  });

  it("does not mutate its input", () => {
    const base = payloadWithUsd();
    withTrustTier(base, "api_verified");
    expect(base.trustTier).toBeNull();
    expect(base.usdView!.payload.trustTier).toBeNull();
  });

  it("a payload with no usdView gains the tier and no usdView key", () => {
    const base = { strategyId: "s", trustTier: null } as unknown as FactsheetPayload;
    const out = withTrustTier(base, "api_verified");
    expect(out.trustTier).toBe("api_verified");
    expect("usdView" in out).toBe(false);
  });

  it("a payload whose USD view is unavailable keeps the reason", () => {
    const base = { strategyId: "s", trustTier: null, usdViewUnavailable: "no_priced_day" } as unknown as FactsheetPayload;
    const out = withTrustTier(base, "api_verified");
    expect(out.usdViewUnavailable).toBe("no_priced_day");
  });
});
