import type { FactsheetPayload, TrustTierKind } from "./types";

/**
 * Overlay the per-request trust tier onto a built factsheet payload.
 *
 * The tier is deliberately NOT part of the cached payload (a verification flip must
 * not need a cache bust), so every page that renders a factsheet overlays it after
 * the build. Phase 164.6.6.2.1 review CR-02: a native-unit strategy's payload also
 * carries a server-built `usdView.payload`, built with `trustTier: null` like its
 * parent. The tier is a fact about the strategy, not about the unit on screen, so it
 * goes onto BOTH payloads here; two pages hand-rolling the spread is how the second
 * one was missed. This is the one overlay every factsheet page shares.
 *
 * The spread keeps the `ingestSource` discriminant, so the result stays a valid
 * member of the `FactsheetPayload` union. The input is not mutated.
 */
export function withTrustTier(
  payload: FactsheetPayload,
  trustTier: TrustTierKind | null,
): FactsheetPayload {
  if (!payload.usdView) return { ...payload, trustTier };
  return {
    ...payload,
    trustTier,
    usdView: {
      ...payload.usdView,
      payload: { ...payload.usdView.payload, trustTier },
    },
  };
}
