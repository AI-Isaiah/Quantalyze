import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildHoldingRef,
  toBridgeOutcomeBannerProps,
  toAllocatedFormProps,
  toRejectedFormProps,
  deriveEligibleForOutcome,
  type FlaggedHolding,
} from "./holding-outcome-adapter";
import { FLAG_COMPOSITE_THRESHOLD } from "./flag-threshold";
import { buildHoldingScopeRef } from "@/lib/notes/scope-ref";
import type { BridgeOutcome } from "@/lib/bridge-outcome-schema";

const SAMPLE: FlaggedHolding = {
  venue: "binance",
  symbol: "BTC",
  holding_type: "spot",
  value_usd: 50000,
  top_candidate_strategy_id: "11111111-2222-3333-4444-555555555555",
  top_candidate_name: "Momentum-BTC-L",
  top_candidate_composite: 72,
  breach_reasons: ["max_weight"],
};

describe("buildHoldingRef", () => {
  it("returns exact format 'holding:{venue}:{symbol}:{holding_type}'", () => {
    expect(buildHoldingRef(SAMPLE)).toBe("holding:binance:BTC:spot");
  });
  it("output matches Phase 08 buildHoldingScopeRef byte-for-byte", () => {
    // buildHoldingScopeRef returns "{venue}:{symbol}:{holding_type}" (no 'holding:' prefix)
    // buildHoldingRef returns "holding:{venue}:{symbol}:{holding_type}"
    const scopeRef = buildHoldingScopeRef({ venue: "binance", symbol: "BTC", holding_type: "spot" });
    expect(buildHoldingRef(SAMPLE)).toBe(`holding:${scopeRef}`);
  });
});

describe("toBridgeOutcomeBannerProps", () => {
  it("passes top_candidate_strategy_id as strategyId (NOT the pseudo holding-id)", () => {
    const onAllocatedClick = vi.fn();
    const onRejectedClick = vi.fn();
    const onDismiss = vi.fn();
    const props = toBridgeOutcomeBannerProps(SAMPLE, { onAllocatedClick, onRejectedClick, onDismiss });
    expect(props.strategyId).toBe("11111111-2222-3333-4444-555555555555");
    expect(props.strategyId).not.toMatch(/^holding:/);
    expect(props.onAllocatedClick).toBe(onAllocatedClick);
  });
});

describe("toAllocatedFormProps", () => {
  it("passes top_candidate_strategy_id + maxWeight (nullable)", () => {
    const props = toAllocatedFormProps(SAMPLE, { onRecorded: vi.fn(), onCancel: vi.fn(), maxWeight: 0.25 });
    expect(props.strategyId).toBe("11111111-2222-3333-4444-555555555555");
    expect(props.maxWeight).toBe(0.25);
  });
  it("maxWeight defaults to null when omitted", () => {
    const props = toAllocatedFormProps(SAMPLE, { onRecorded: vi.fn(), onCancel: vi.fn() });
    expect(props.maxWeight).toBeNull();
  });
});

describe("toRejectedFormProps", () => {
  it("passes top_candidate_strategy_id as strategyId", () => {
    const onRecorded = vi.fn();
    const onCancel = vi.fn();
    const props = toRejectedFormProps(SAMPLE, { onRecorded, onCancel });
    expect(props.strategyId).toBe("11111111-2222-3333-4444-555555555555");
    expect(props.onRecorded).toBe(onRecorded);
    expect(props.onCancel).toBe(onCancel);
  });
});

describe("deriveEligibleForOutcome", () => {
  const ref = "holding:binance:BTC:spot";
  it("eligible=false when no match_decision exists", () => {
    const result = deriveEligibleForOutcome(SAMPLE, {}, {});
    expect(result).toEqual({ eligible: false, existingOutcome: null });
  });
  it("eligible=false with existingOutcome when outcome already recorded", () => {
    const existing = { id: "outcome-uuid", kind: "allocated" } as unknown as BridgeOutcome;
    const result = deriveEligibleForOutcome(
      SAMPLE,
      { [ref]: { id: "decision-uuid" } },
      { [ref]: existing }
    );
    expect(result.eligible).toBe(false);
    expect(result.existingOutcome).toBe(existing);
  });
  it("eligible=true when decision exists AND no outcome recorded", () => {
    const result = deriveEligibleForOutcome(SAMPLE, { [ref]: { id: "decision-uuid" } }, {});
    expect(result).toEqual({ eligible: true, existingOutcome: null });
  });
});

describe("FLAG_COMPOSITE_THRESHOLD parity (finding f5)", () => {
  it("SSR constant equals 50 (D-06 + RESEARCH A3)", () => {
    expect(FLAG_COMPOSITE_THRESHOLD).toBe(50);
  });
  it("Python-side analytics-service constant equals 50 (numeric parity — engine-side half of finding f5)", () => {
    const pySrc = readFileSync(join(process.cwd(), "analytics-service/routers/match.py"), "utf8");
    // Source regex: `FLAG_COMPOSITE_THRESHOLD = 50` (possibly with type annotation)
    const match = pySrc.match(/^FLAG_COMPOSITE_THRESHOLD\s*(?::\s*int\s*)?=\s*(\d+)/m);
    expect(match).not.toBeNull();
    expect(Number(match![1])).toBe(FLAG_COMPOSITE_THRESHOLD);
  });
});
